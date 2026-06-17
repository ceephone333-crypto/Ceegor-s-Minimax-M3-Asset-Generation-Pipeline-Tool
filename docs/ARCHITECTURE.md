# Architecture

A short tour of the codebase. The whole project is small enough to read end-to-end; the most useful places to start are linked below.

## Process model

The app is a standard Electron 32 setup with two processes:

```
                ┌──────────────────────────────┐
   IPC ────────►│  main.js  (Node, privileged) │
                │  - BrowserWindow             │
                │  - file browser (fs)         │
                │  - config.txt, state.json    │
                │  - spawn mmx CLI             │
                └──────────────┬───────────────┘
                               │  preload.js (contextBridge)
                ┌──────────────▼───────────────┐
                │  renderer/app.js (sandboxed) │
                │  - 4 tabs (image/speech/…)  │
                │  - file browser UI           │
                │  - local image pipeline      │
                │    (Canvas API: upscale,     │
                │     crop, format-convert)    │
                └──────────────────────────────┘
```

`contextIsolation: true` + `nodeIntegration: false` in `main.js` — the renderer has no direct Node access. All file / spawn operations happen in the main process, exposed through a small `window.api` surface defined in `preload.js`.

## Module map

| File | Role |
|---|---|
| `main.js` | Electron main process. Owns the window, wires all `ipcMain.handle(...)` endpoints, and exposes the file-browser operations to the renderer. |
| `preload.js` | The only `contextBridge` surface — `window.api.{mmxRun, fbRead, fbWrite, …}`. Keep this small; everything that goes here is renderer-callable. |
| `src/mmx.js` | Spawns the `mmx` CLI (`node mmx.mjs <args> --output json --api-key … --non-interactive`). Streams stderr live into the log pane, parses stdout once the process exits. Includes `cancelAll()` for the in-flight Cancel button. |
| `src/config.js` | Reads / writes `config.txt` next to the executable. Returns a normalized object so the renderer can pass it through unchecked. |
| `src/state.js` | Per-tab autosave (`state.json`). Atomic writes (tmp + rename) so a killed process never leaves a corrupt file. |
| `src/fileBrowser.js` | All FS operations behind the file browser: list, mkdir, rename, move, copy, delete, read, reveal. |
| `src/audioCutter.js` | Wrapper around `ffmpeg-static`. Used by the right-click "✂ Audio cut…" action. Provides probe, downsampled peak decode, zero-crossing snap, silence trim, and the actual cut-with-fade export. |
| `src/batches.js` | BatchGen batch-list persistence (`batches.json`). |
| `src/voices.json` | Bundled voice catalog — 300+ entries used as a fallback when the live API is unavailable. |
| `renderer/app.js` | All UI logic. The most important global is the `state` object at the top, and the `TABS` dict below it (4 entries, each a `build()` + click handler). |
| `renderer/audioCutter.js` | The "✂ Audio cut…" modal: Canvas waveform with draggable start / end markers, minimap, snap-to-zero, auto-trim silence, playback (play / loop / pre-roll / post-roll), zoom, micro-fade export, and a configurable output format / filename template. |
| `renderer/index.html` | Minimal HTML. The 4 tab panes are populated by JS on startup; the bottom bar (log + picture preview) is a 2-column grid. |
| `renderer/styles.css` | Dark + light themes, exposed as CSS custom properties on `:root`. The `image-overlay`, `crop-frame`, and `.ac-*` (audio cutter) classes drive the most visually distinctive UI elements. |

## State that survives a restart

| File | Lives where | What |
|---|---|---|
| `config.txt` | next to the .exe | API key, output dir, region |
| `state.json` | next to the .exe | per-tab form values, current tab, per-tab output folder, upscale-on-Generate toggle |
| `batches.json` | next to the .exe | BatchGen batch lists (per tab, up to 100 prompts each) |
| `<output_dir>/<tab>/…` | wherever the user pointed `output_dir` | the generated assets themselves |

`config.txt` is the only file that contains anything sensitive (your API key). It is created from `config.txt.example` on the first run; if you delete it, the next launch re-creates it and asks you to fill it in.

## Image pipeline

All three operations (upscale, crop, convert) are pure renderer-side:

```
loadImageFromFile(path)        → Image element (waits for onload)
  → offscreen Canvas
  → ctx.imageSmoothingQuality = 'high' (upscale)
  → ctx.drawImage with src/dst rects (crop)
  → canvas.toDataURL('image/png' | 'image/jpeg' | 'image/webp')
  → strip data: prefix
  → window.api.fbWrite(outPath, base64)
  → main process: path-allowlist guardrail + fs.writeFileSync
```

The main process only handles persistence (and the path-allowlist check that prevents the pipeline from writing outside `output_dir`). All pixel work happens in the renderer.

## Audio pipeline (✂ Audio cut…)

Right-click any audio file in the folder browser → "✂ Audio cut…" opens a waveform editor. Unlike the image pipeline, **all heavy work happens in the main process** because we need ffmpeg (bundled via `ffmpeg-static`) for decode / encode and for the micro-fade filter.

```
src/audioCutter.js
  ├─ findBinary()         bundled ffmpeg.exe or system ffmpeg
  ├─ probe(path)          cheap metadata parse from `ffmpeg -i` stderr
  ├─ decodePeaks(path,opts)
  │                        ffmpeg s16le mono @ 8 kHz → Float32 peaks
  │                        (one bucket per canvas pixel-column) +
  │                        raw PCM for snap-to-zero. Streaming.
  ├─ findZeroCrossing(pcm, target, window)
  │                        walk the cached PCM toward the target
  │                        sample until a sign flip, return that index.
  │                        Lives both in main (for the IPC variant) and
  │                        in renderer/audioCutter.js (for instant drag
  │                        snap without round-tripping).
  ├─ trimSilence(path,opts)
  │                        decodePeaks at 4 kHz, walk inward, return
  │                        [startSec, endSec] of the loud body.
  └─ cut(src, dst, opts)  ffmpeg -ss <start> -t <dur> -i src
                          [+ afade in/out when fade=true]
                          [-c:a <codec> per output container]
                          → write to dst.
```

Renderer-side (`renderer/audioCutter.js`) wraps these in a modal with:

- Canvas waveform with draggable start / end markers + a click-on-waveform jump behaviour.
- Minimap (always visible) showing the full file + a viewport rectangle for the current zoom window.
- Mouse-wheel zoom around the cursor, double-click = zoom to selection, "⤢ Fit" button = reset zoom.
- rAF-driven playback loop (the HTML5 `timeupdate` event fires only ~4×/sec on some Chromium builds — too choppy for a smooth playhead). Plays the selection with optional looping, plus 2-second pre-roll / post-roll buttons to preview the cut edges.
- **Zero-crossing snap** (toggleable) — when the user drags a marker, the local PCM is scanned ±50 ms for the nearest sign flip. This eliminates the audible click that a "mid-wave" cut produces.
- **Auto-trim silence** — a single button calls `audio:trimSilence` to find the head / tail silence and snaps both markers to the first / last loud samples. Then zooms to the new selection so the user can verify.
- **Amplify view** — visually scales quiet passages so you can see reverb tails, room tone, etc. Audio data is unchanged; only the waveform display is re-normalised.
- **Micro-fade export** — applies a tiny `afade` (5 ms by default) at both cut edges. Belt-and-suspenders with the zero-crossing snap: even on files where there's no real zero to snap to (DC offset), the fade buries any residual click.
- **Format dropdown** — pick the output container at export time: WAV (PCM), MP3 (libmp3lame V2), OGG Vorbis, Opus, FLAC, M4A/AAC. ffmpeg handles the codec selection automatically based on the file extension.
- **Filename template** — `{name}` / `{n}` / `{ext}` tokens, with auto-incrementing `{n}` when the destination already exists (same pattern as the image pipeline).

Keyboard shortcuts (when no input is focused): `Space` play / stop, `I` / `O` set start / end at the playhead (DAW-style), `Z` zoom to selection, `F` fit, `A` amplify view, `S` snap-to-zero, `L` loop.

Settings persist in `state.json` under `audioCutter` (snap, amplify, fade, fadeMs, outputFormat, counter, loop) so the dialog remembers them next time.

The exported file is auto-revealed in Explorer (`window.api.fbReveal`) so the user can drag it straight into their DAW or game project.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl + Enter` | Generate in the active tab |
| `Ctrl + 1 / 2 / 3 / 4` | Switch to Image / Speech / Music / Video |
| `Ctrl + B` | Open BatchGen for the active tab |
| `Ctrl + S` | ⚙ Settings |
| `Ctrl + T` | Style presets |
| `Ctrl + L` | Toggle theme |
| `Ctrl + F` | Focus the file-browser search box |
| `Ctrl + R` | Refresh the quota display |
| `Esc` | Close the image overlay / the active modal |

The ✂ Audio cut… dialog adds its own local shortcuts when focused
(no global binding — they only fire while the modal is open):

| Shortcut | Action |
|---|---|
| `Space` | Play / stop the selection |
| `I` / `O` | Set the start / end marker at the current playhead |
| `Z` | Zoom to selection |
| `F` | Fit the whole file in the waveform |
| `A` | Toggle amplify view |
| `S` | Toggle zero-crossing snap |
| `L` | Toggle loop playback |
| `Home` | Select the whole file |
| `Enter` | Stop playback |
| `↑ / ↓` (in time input) | Fine-tune ±1 ms (Shift = ±10 ms, Ctrl = ±100 ms) |
| Mouse wheel | Zoom around the cursor |
| Shift-drag | Pan the view |
| Double-click | Zoom to selection |
