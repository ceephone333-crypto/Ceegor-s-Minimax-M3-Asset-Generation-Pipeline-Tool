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
| `src/batches.js` | BatchGen batch-list persistence (`batches.json`). |
| `src/voices.json` | Bundled voice catalog — 300+ entries used as a fallback when the live API is unavailable. |
| `renderer/app.js` | All UI logic. The most important global is the `state` object at the top, and the `TABS` dict below it (4 entries, each a `build()` + click handler). |
| `renderer/index.html` | Minimal HTML. The 4 tab panes are populated by JS on startup; the bottom bar (log + picture preview) is a 2-column grid. |
| `renderer/styles.css` | Dark + light themes, exposed as CSS custom properties on `:root`. The `image-overlay` and `crop-frame` classes drive the two most visually distinctive UI elements. |

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
| `Esc` | Close the image overlay |
