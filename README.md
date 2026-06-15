# MiniMax Asset Generation Pipeline Tool

A cross-modal asset generation GUI for the [MiniMax Token Plan](https://MiniMax.io) — image, speech, music, and video — packaged with a local image pipeline (upscale, crop, format conversion) that runs entirely in the browser. No ML libraries, no external services, no API calls beyond the MiniMax CLI itself. Perfect for spending the last available weekly tokens and not waste them.

Built on Electron. Ships as a portable Windows .exe or as a runnable source tree. MIT licensed.

---

## Features

### Cross-modal generation
- **Image** — `image-01` / `image-01-live` etc., aspect ratio, width/height, negative prompt, prompt optimizer, watermark, subject reference, count, response format. Up to 5 variants per click.
- **Speech** — 300+ voices in 18 languages, speed, volume, pitch, sample rate, bitrate, channels, pronunciation dictionary.
- **Music** — instrumental mode, lyrics, genre / mood / instruments / key / tempo / structure, use case, output format.
- **Video** — model, duration, resolution, polling interval, reference images.

### Per-tab UX
- All form values autosave per tab to `state.json` and survive restarts.
- Per-tab output folder — generated files land in the folder currently shown in the file browser.
- BatchGen — paste up to 100 prompts per tab, run them sequentially.
- Auto-retry with exponential backoff on transient backend errors.
- Classified error UI (auth / rate / quota / network / server) with one-click **Test connection**, **Diagnose**, **Retry**, **Copy error** actions.

### Local image pipeline
- **🔍 Upscale** — toggle in the image tab to upscale every generated image locally (2× / 3× / 4× / 8×) using the Canvas API. Output keeps the input extension and lands next to the original as `<name>_Nx.png`. The renderer walks the source up to the target in 2× steps and uses `createImageBitmap` with `resizeQuality: 'high'` (Lanczos-style) for each step, so the result is noticeably sharper than a single-shot N× canvas resize.
- **✂ Crop** — right-click any image → fullscreen crop overlay with W × H inputs, green draggable frame (see-through middle), writes `<name>_cropped_WxH.<ext>`. New "auto-size" checkbox on by default scales the image and the frame to fit the stage so a 4K source no longer overflows the modal.
- **⇄ Convert format** — right-click any image → convert between **PNG / JPEG / WebP** natively via `canvas.toDataURL`. JPEG is flattened onto white.

### File browser
- Single-click on an image opens it in the bottom-right **Picture preview** pane (fit-to-content, click for 1:1 + zoom).
- Right-click for Open / Reveal / Copy / Cut / Rename / Move / Paste / Delete.
- Internal drag-and-drop to move files between folders (custom MIME type; external OS drops are ignored).
- Sticky search filter, ⏎ / up-down navigation.

### Reliability
- Atomic state writes (tmp file → rename) so a killed process never leaves a corrupt `state.json`.
- `mmx` stderr is streamed live into a collapsible log pane; Copy / Clear / Collapse buttons in the header.
- `mmx` stdout is forwarded to the log when it looks like JSON or contains an error keyword.
- Disk writes from the in-app image pipeline are restricted to a path that lives under the configured `output_dir`.

### Optional: Real-ESRGAN upscaling (BSD-3-Clause)

The built-in Canvas/`createImageBitmap` pipeline does a solid job for 2×–4×, but for noticeably more detail (and better handling of noise / JPEG artifacts) the tool can also shell out to the [Real-ESRGAN ncnn-vulkan](https://github.com/xinntao/Real-ESRGAN) command-line tool. The user provides the binary — the source release stays small and standalone, and the upgrade is opt-in.

Detection order (first hit wins, cached after first success):
1. Cached path from a previous successful detection in this run.
2. `where realesrgan-ncnn-vulkan.exe` (Windows) / `which realesrgan-ncnn-vulkan` (POSIX) on `PATH`.
3. `./bin/realesrgan-ncnn-vulkan[.exe]` next to the package root.

If none of those are present, the upscale function uses the built-in multi-step pipeline and a one-time toast reminds the user that the upgrade is available. If Real-ESRGAN is available but fails (corrupt model, GPU OOM, etc.), the tool logs the error and falls back to the built-in path so the user still gets a result.

#### Install
1. Download the latest **`realesrgan-ncnn-vulkan`** portable for your OS from the [Real-ESRGAN releases page](https://github.com/xinntao/Real-ESRGAN/releases) (BSD-3-Clause).
2. Extract the archive.
3. Drop the binary + the `models/` folder into `./bin/` next to the package root (or anywhere on `PATH`):
   ```
   bin/
   ├── realesrgan-ncnn-vulkan(.exe)
   └── models/
       ├── realesrgan-x4plus.param
       ├── realesrgan-x4plus.bin
       └── …
   ```
4. Restart the app. The ⚙ Settings popup will show "Real-ESRGAN vX.Y.Z detected" under the **Image upscaling** section. Use the **Re-detect** button there if you installed it after launch.

#### Model
The default model is **`realesrgan-x4plus`** (general-purpose, BSD-3-Clause). The x4plus model always outputs at 4×; the renderer resizes the result to the requested multiplier — 2× / 3× are downscales from the 4× (super-sampling, very high quality), 4× is used as-is, 8× is a 2× step on top. You can pick a different model in ⚙ Settings → Image upscaling → Model if you have a more specialised `.param` + `.bin` pair installed.

---

## Quick start

### Run from source (Windows 10 / 11)

Requirements:
- [Node.js 18+](https://nodejs.org/)
- [`mmx-cli`](https://www.npmjs.com/package/mmx-cli) installed globally (`npm i -g mmx-cli`)
- A MiniMax Token Plan API key

Steps:
```bat
git clone https://github.com/ceephone333-crypto/Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool
cd Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool
copy config.txt.example config.txt
notepad config.txt                 REM paste your mmx API key
start.bat                          REM first run: installs electron + launches
```

`start.bat` will:
1. Check Node.js is on `PATH`.
2. Run `npm install --omit=dev` on the first run (downloads Electron).
3. Copy `config.txt.example` → `config.txt` if missing.
4. Launch the app via `node_modules\.bin\electron.cmd .`

### Run the portable .exe

```bat
npm run build
dist\MiniMaxAssetTool.exe
```

The portable single-file build drops a self-contained binary (Node runtime + Electron + app) in `dist/`. Copy it to any Windows 10/11 PC and double-click.

### Run on macOS / Linux

```bash
npm install
npm start
```

The same `mmx-cli` requirement applies.

---

## Project layout

```
.
├── main.js                  # Electron main process — window, IPC, file browser
├── preload.js              # contextBridge — exposes a safe `window.api` to the renderer
├── package.json
├── start.bat                # Windows launcher (handles first-run install)
├── config.txt.example       # template — copy to config.txt, paste your API key
├── LICENSE                  # MIT
├── README.md                # this file
├── src/
│   ├── mmx.js               # spawns the mmx CLI, streams stdout/stderr
│   ├── config.js            # reads / writes config.txt next to the .exe
│   ├── state.js             # per-tab autosave (state.json) — atomic writes
│   ├── fileBrowser.js       # list / mkdir / rename / move / copy / delete / read
│   ├── batches.js           # BatchGen batch-list persistence
│   ├── realesrgan.js        # optional Real-ESRGAN upscaler wrapper
│   ├── pathUtils.js         # safe path checks (the fb:* allowlist helpers)
│   └── voices.json          # bundled voice catalog (300+ entries)
└── renderer/
    ├── index.html
    ├── app.js               # all UI logic, IPC plumbing, image pipeline
    └── styles.css           # dark + light themes
```

User data is written to the same directory as the .exe / package root:
- `config.txt` — your API key and preferences (created from `config.txt.example` on first run).
- `state.json` — autosaved tab settings, per-tab output folder, last-active tab, upscale toggle.
- `batches.json` — BatchGen batch lists per tab.
- `<output_dir>/<tab>/...` — generated assets land here. You pick the output dir in ⚙ Settings.

---

## Configuration

`config.txt` (created from `config.txt.example` on first run):

```ini
# Your MiniMax Token Plan API key.
api_key=sk-cp-xxxxxxxx

# Where generated assets are written. Created if missing.
# Leave blank to use ./generated/ next to the executable.
output_dir=

# Region: global (default) or cn.
region=global
```

Everything else (per-tab form values, batch lists, current folder) is auto-managed under `state.json` / `batches.json`.

---

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

---

## Tech stack

- **[Electron 32](https://www.electronjs.org/)** — cross-platform desktop wrapper, IPC, native file dialogs.
- **[mmx-cli](https://www.npmjs.com/package/mmx-cli)** — the official MiniMax CLI; we shell out to it.
- **HTML5 Canvas API + `createImageBitmap`** — all image pipeline operations (upscale, crop, format conversion) run locally. The upscale path walks the source up to the target in 2× steps using `createImageBitmap` with `resizeQuality: 'high'` (Lanczos-style). No `sharp`, no `jimp`, no other image lib.
- **[Real-ESRGAN ncnn-vulkan](https://github.com/xinntao/Real-ESRGAN) (optional, BSD-3-Clause)** — when the binary is installed, the upscale path shells out to it for noticeably higher-quality output (especially 2× / 3× / 4×). Detected automatically; the source release works without it.
- **Node.js `fs` + `path`** — the only Node modules used by the in-app image pipeline.

### Licensing & open-source

This project is MIT licensed. Every dependency in the build chain is also MIT-licensed (Electron, electron-builder) or permissive. The image pipeline is Canvas-only by default. The optional Real-ESRGAN upgrade is BSD-3-Clause (commercial use is fine) — attribution to [xinntao/Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) is appreciated if you ship a release with the binary bundled.

---

## Contributing

Bug reports and PRs welcome. The codebase is intentionally small enough to read end-to-end; the most useful places to start are:

- `renderer/app.js` — TABS dict at the top-level (4 tabs, each a `build()` + click handler). Search for `state.genStatus` for the in-flight / done / idle status dot logic.
- `src/mmx.js` — the spawn-and-stream wrapper.
- `src/fileBrowser.js` — all FS operations (read, list, move, copy, delete).

When reporting an issue, please attach the relevant lines from the log pane (the 📋 Copy button captures the full log).

---

## Roadmap

- [ ] In-pane prompt-history with one-click re-use
- [ ] Asset tagging & search across generated files
- [ ] macOS / Linux portable builds (currently Win portable + source)

---

## License

MIT — see [LICENSE](LICENSE).

Generated assets remain your property. This tool is a UI on top of the MiniMax API; you are responsible for complying with the MiniMax Terms of Service for any content you generate.
