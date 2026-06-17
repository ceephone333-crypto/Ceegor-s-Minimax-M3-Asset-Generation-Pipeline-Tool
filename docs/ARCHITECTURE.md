# Architecture

> **Stand:** v1.2.0+ (Atomic-Architecture-Refactoring abgeschlossen, Phase 0–7).
> Frühere monolithische Struktur (`main.js` 941 Z. + `app.js` 8546 Z.) ist auf
> ~60 kleine Module verteilt. Siehe [_refactoringplan.md](../_refactoringplan.md)
> und [ipc-contracts.md](ipc-contracts.md) für die volle Migrations-Geschichte.

A short tour of the codebase. The whole project is small enough to read end-to-end; the most useful places to start are linked below.

## Process model

The app is a standard Electron 32 setup with two processes. Both processes
now have an **Atomic Architecture** — small, single-purpose modules in
strict DAG order (no cross-tier imports, no `Manager` / `Controller` files).

```
                ┌─────────────────────────────────────────────┐
   IPC ────────►│  main/  (Node, privileged, ~26 modules)     │
                │  - main/index.js (Composition Root, 51 Z.)  │
                │  - main/window/  (BrowserWindow + Security) │
                │  - main/ipc/     (12 register*Handler)      │
                │  - main/services/ (PathSecurity, …)         │
                │  - main/models/   (Allowlists, Sanitizer)   │
                │  - main/utils/    (PowerShell, UrlSan)      │
                │  - main/interfaces/ (JSDoc-Verträge)        │
                └──────────────┬──────────────────────────────┘
                               │  preload.js (contextBridge, 154 Z.)
                ┌──────────────▼──────────────────────────────┐
                │  renderer/  (sandboxed, 14 Module)          │
                │  - bootstrap.js        (init-Orchestrator)  │
                │  - core/  (EventBus, Toast, ApiClient, …)   │
                │  - state/ (AppState, StatePersister)        │
                │  - services/ (MmxService, LogService, …)    │
                │  - utils/   (FormatUtils, PathBuilder)      │
                │  - app.js   (Legacy, 8546 Z. — Phase 3 NB)  │
                └─────────────────────────────────────────────┘
```

`contextIsolation: true` + `nodeIntegration: false` + `sandbox: false` are
configured in [main/window/createMainWindow.js](../main/window/createMainWindow.js).
The renderer has **no direct Node access**. All file / spawn operations
happen in the main process, exposed through `window.api.*` defined in
[preload.js](../preload.js). The 30 IPC channels are documented in
[ipc-contracts.md](ipc-contracts.md).

## Module map

### Main process (`main/`)

| Path | Role |
|---|---|
| `main/index.js` | **Composition Root.** Setzt app.commandLine-Switches (Side-Effect-Import von `window/windowSecurity.js`), registriert 12 IPC-Handler, startet das Haupt-Window. |
| `main/window/windowSecurity.js` | Setzt `disable-features=CalculateNativeWinOcclusion` + `force-device-scale-factor=1` (DPI + Compositor). |
| `main/window/createMainWindow.js` | `BrowserWindow`-Factory + Confirm-Close-Guard (`destroy()` bypass für Re-Entry-Schutz). |
| `main/ipc/register*.js` | 12 fokussierte Handler, je 10–140 Z. Eine Datei pro Domäne. |
| `main/services/PathSecurityService.js` | `getAllowedRoots()`, `isPathUnderAny()`, `isParentUnderAny()`, `addTrusted()`. Jeder IPC-Handler mit Pfad-Argument routet durch diese eine Quelle. |
| `main/services/VoicesCacheService.js` | Voice-Liste-Cache, **per API-Key** invalidierbar (verhindert das Cross-Account-Leak der alten Single-Cache-Version). |
| `main/services/InstallDownloadService.js` | GitHub-Zip-Download + PowerShell-Expand-Archive + throttled IPC-Progress-Stream. |
| `main/services/InstallPickCopyService.js` | "Pick file…" Universal-Fallback. Ziel vom Main-Process festgelegt (immun gegen kompromittierten Renderer). |
| `main/services/HttpsRedirect.js` / `DownloadProgressEmitter.js` | Low-level helpers. |
| `main/models/MmxSubcommandAllowlist.js` | Whitelist: `image | speech | music | video | quota | voices`. Andere Subcommands werden abgelehnt. |
| `main/models/ConfigSchema.js` | Sanitizer: filtert unbekannte Felder aus dem Renderer-Input, erzwingt Typen. |
| `main/models/InstallKindsTable.js` | `INSTALL_KINDS` Map mit Titel/Filtern/destSubdir/destName. |
| `main/utils/PowerShellSpawner.js` | Wrapper um `Expand-Archive` mit `windowsHide`-Flag. |
| `main/utils/UrlSanitizer.js` | `shell.openExternal`-Pre-Check: erlaubt nur http(s), lehnt Kontrollzeichen + Credentials ab. |
| `main/interfaces/*.d.ts` | JSDoc-Verträge: `IPathValidator`, `IConfigProvider`, `IMmxRunner`, `IInstallTarget`. |

### Renderer (`renderer/`)

| Path | Role |
|---|---|
| `renderer/bootstrap.js` | **Init-Orchestrator.** Lädt `state.json` in `AppState`, ruft `ThemeService.apply()`, startet `MmxService.attachLogStream()` + `LogService.init()`, stempelt die Version. |
| `renderer/core/EventBus.js` | Minimaler Pub/Sub (`on/emit/off`). Cross-Modul-Entkopplung (Phase 5). |
| `renderer/core/ToastService.js` | Zentrale Toast-Notification in `#toast-root`. |
| `renderer/core/ApiClient.js` | Wrapper um `window.api.*` mit try/catch + Error-Normalisierung. |
| `renderer/core/DomHelpers.js` | `$` / `$$` + XSS-sicheres `createElement` / `escapeHtml`. |
| `renderer/state/AppState.js` | Zentraler UI-State (config, voices, batches, currentTab, …). |
| `renderer/state/StatePersister.js` | Debounced Autosave nach `state.json`. Persistiert nur die ~14 dokumentierten Felder. |
| `renderer/services/ThemeService.js` | `apply(theme)` / `toggle()`. Emittiert `theme:changed` auf den Bus. |
| `renderer/services/MmxService.js` | `run(args)` + `cancel()` + `attachLogStream()`. Emittiert `mmx:log` auf den Bus. |
| `renderer/services/LogService.js` | Bounded Ring-Buffer (5000 events). Lauscht auf `mmx:log`, emittiert `log:appended`. |
| `renderer/utils/FormatUtils.js` | `bytesToHuman`, `secondsToHMS`, `pad2`, `isoLocal`. |
| `renderer/utils/PathBuilder.js` | `derivedOutputPath` + `resolveUniqueOutputPath` (kollisionsfreier nächster Name). |
| `renderer/app.js` | **Legacy.** 8546 Z. — wird in Phase 3 inkrementell in Tabs/Panels/Dialoge aufgeteilt. Läuft aktuell parallel zur neuen Modul-Welt. |
| `renderer/index.html` | Minimal HTML. 4 Tab-Panes, Sidebar (File-Browser), Bottom-Bar (Log + Preview). Lädt 11 neue Foundation-Module vor `app.js`. |

### Engine modules (`src/`)

| Path | Role |
|---|---|
| `src/mmx.js` | Spawnt die `mmx` CLI. Streams stderr live in den Log-Pane, parsed stdout als JSON. `cancelAll()` für Cancel-Button. |
| `src/config.js` | Liest / schreibt `config.txt`. Normalisiert das Config-Objekt. |
| `src/state.js` | Per-Tab-Autosave (`state.json`). Atomic writes (tmp + rename). |
| `src/fileBrowser.js` | Alle FS-Operationen: list, mkdir, rename, move, copy, delete, read, reveal. |
| `src/audioCutter.js` | **Backward-Compat-Shim** (37 Z.). Re-exportiert die 5 Module unter `src/audio/`. |
| `src/audio/AudioBinary.js` | `findBinary()` / `isAvailable()` mit Cache. |
| `src/audio/AudioRunner.js` | Low-level ffmpeg-Spawn-Wrapper. |
| `src/audio/AudioMetadata.js` | `probe(filePath)` — parst `ffmpeg -i` stderr. |
| `src/audio/AudioWaveform.js` | `decodePeaks()` — s16le mono PCM → Float32-Buckets. |
| `src/audio/AudioMath.js` | `findZeroCrossing()` — pure, **kein** ffmpeg, vollständig testbar. |
| `src/audio/AudioTrimCut.js` | `trimSilence()` + `cut()` (mit optionalem Fade). |
| `src/batches.js` | BatchGen batch-list persistence (`batches.json`). |
| `src/imageOptimizer.js` | Sharp-Wrapper (image compression). |
| `src/realesrgan.js` | Real-ESRGAN-Binary-Wrapper. |
| `src/isnetbg.js` | IS-Net Background-Removal-Wrapper. |
| `src/isnetbg_node.js` | Node.js-Implementation (Fallback). |
| `src/pathUtils.js` | `normalize`, `isPathUnderAny`, `isParentUnderAny`. |
| `src/voices.json` | Bundled voice catalog — 300+ entries (Fallback). |

### Tests (`tests/unit/`)

39 Unit-Tests mit Node's eingebautem `node:test`:

| Pfad | Was wird getestet |
|---|---|
| `main/models/ConfigSchema.test.js` | Sanitizer: 7 Tests (Region/Theme-Filter, Style-Drop, unbekannte Felder, Null-Input). |
| `main/utils/UrlSanitizer.test.js` | URL-Sanity: 7 Tests (Schemes, Control-Characters, Credentials, Malformed). |
| `renderer/core/EventBus.test.js` | Pub/Sub: 6 Tests (Subscribe, Unsubscribe, Multi-Handler, Error-Isolation). |
| `renderer/utils/FormatUtils.test.js` | Format-Helfer: 6 Tests (Bytes, HMS, pad, ISO-Local). |
| `renderer/utils/PathBuilder.test.js` | Pfad-Konstruktor: 7 Tests (Suffix, Dotfiles, No-Extension, ResolveUnique). |
| `src/audio/AudioMath.test.js` | Zero-Crossing: 6 Tests (Clamping, sign-flip, window-behaviour). |

Run via `npm test`. Linter via `npm run lint`.

## State that survives a restart

| File | Lives where | What |
|---|---|---|
| `config.txt` | next to the .exe | API key, output dir, region |
| `state.json` | next to the .exe | per-tab form values, current tab, per-tab output folder, upscale-on-Generate toggle |
| `batches.json` | next to the .exe | BatchGen batch lists (per tab, up to 100 prompts each) |
| `<output_dir>/<tab>/…` | wherever the user pointed `output_dir` | the generated assets themselves |

`config.txt` is the only file that contains anything sensitive (your API key). It is created from `config.txt.example` on the first run; if you delete it, the next launch re-creates it and asks you to fill it in.

## IPC channel overview

30 Kanäle, einer pro Domäne. Volle Spezifikation in [ipc-contracts.md](ipc-contracts.md).

| Domäne | Channels |
|---|---|
| App-Metadata | `app:version` |
| Config | `config:get`, `config:set`, `config:path`, `config:pickFolder` |
| mmx | `mmx:run`, `mmx:voices`, `mmx:quota`, `mmx:authStatus`, `mmx:diagnose`, `mmx:cancel`, `mmx:log` (event) |
| File-Browser | `fb:list`, `fb:mkdir`, `fb:rename`, `fb:delete`, `fb:move`, `fb:copy`, `fb:reveal`, `fb:read`, `fb:exists`, `fb:write` |
| Real-ESRGAN | `upscale:realesrgan:available`, `:run`, `:download`, `:download:progress` (event) |
| IS-Net | `isnetbg:available`, `isnetbg:run` |
| Image-Opt | `image:optimize` |
| Audio | `audio:available`, `:probe`, `:decodePeaks`, `:findZeroCrossing`, `:trimSilence`, `:cut` |
| Batches | `batches:get`, `batches:set` |
| State | `state:get`, `state:set` |
| File-Picker | `file:pick` |
| Install | `install:openUrl`, `install:pickAndCopy` |

**Pflicht-Sicherheit:** Alle Pfad-Argumente werden via `main/services/PathSecurityService.js` (`isPathUnderAny` / `isParentUnderAny`) gegen `allowedRoots()` validiert — `output_dir` + `trustedPickPaths` (vom User explizit gewählte Pfade). Handler ohne Pfad-Argumente sind explizit markiert.

**Streaming-Kanäle** (nur diese nutzen `webContents.send`): `mmx:log`, `upscale:realesrgan:download:progress`. Alle anderen sind request/response.

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

### Module-Layout (Phase 4)

```
src/audioCutter.js                  ← Backward-Compat-Re-Export (37 Z.)
  ├─ AudioBinary.js        bundled ffmpeg.exe or system ffmpeg
  ├─ AudioRunner.js        ffmpeg-Spawn-Wrapper (Promise-Shape)
  ├─ AudioMetadata.js      probe(path) — ffmpeg -i stderr parsing
  ├─ AudioWaveform.js      decodePeaks(path, opts)
  │                        ffmpeg s16le mono @ 8 kHz → Float32 peaks
  │                        (one bucket per canvas pixel-column) +
  │                        raw PCM for snap-to-zero. Streaming.
  ├─ AudioMath.js          findZeroCrossing(pcm, target, window) — PURE
  │                        walk the cached PCM toward the target
  │                        sample until a sign flip, return that index.
  │                        Keine ffmpeg-Abhängigkeit → vollständig testbar.
  └─ AudioTrimCut.js       trimSilence() + cut()
                           ffmpeg -ss <start> -t <dur> -i src
                           [+ afade in/out when fade=true]
                           [-c:a <codec> per output container]
                           → write to dst.
```

Renderer-side (`renderer/audioCutter.js` — Legacy, noch nicht zerlegt) wraps these in a modal with:

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

## Quality gates (CI-lokal)

- **Linter** (`npm run lint` → `scripts/lint.js`): Dateigrößen-Limit (500 HART / 300 WARN), God-Word-Check (`Manager` / `Controller` verboten), Cross-Tier-DAG-Check (`main/↔renderer/`, `main/→src/` ist OK; `src/→main/` und `renderer/→main/` sind Fehler).
- **Tests** (`npm test`): 39 Unit-Tests über alle Pure-Module (Config-Sanitizer, URL-Sanitizer, EventBus, FormatUtils, PathBuilder, AudioMath).
- **Pre-Commit-Hook** (`.githooks/pre-commit`, aktiv via `git config core.hooksPath .githooks`): läuft `lint` + `test` automatisch vor jedem Commit. Mit `--no-verify` überspringbar.
