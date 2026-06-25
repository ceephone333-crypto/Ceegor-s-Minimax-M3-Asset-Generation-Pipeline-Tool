# MiniMax Asset Generation Pipeline Tool

A cross-modal asset generation GUI for the [MiniMax Token Plan](https://MiniMax.io) — image, speech, music, and video — packaged with a local image pipeline (upscale, crop, format conversion) that runs entirely in the browser. No ML libraries, no external services, no API calls beyond the MiniMax CLI itself. Perfect for spending the last available weekly tokens and not waste them.

Built on Electron. Ships as a portable Windows .exe or as a runnable source tree. MIT licensed.

**Current release: v1.1.0** — adds the Advanced pipeline settings overlay (18 tunable knobs for Real-ESRGAN, IS-Net, Sharp, and the ffmpeg audio cutter), drives-list navigation in the file browser, default-off popups, and an empirical full-code audit (1 CRITICAL + 4 HIGH + 6 MEDIUM + 2 LOW defects fixed). See [Release notes](CHANGELOG.md) for the full list.

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
- **✨ Remove background** — right-click any image for a one-shot "drop the alpha, write `<name>_nobg.png` next to it". A checkbox in the Upscale Settings popup chains the same step onto the generate / upscale / crop pipeline, so every generated image can end up transparent without an extra click. Uses an optional local IS-Net binary (see below) — no API call, no cloud upload, fully offline.

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

The built-in Canvas/`createImageBitmap` pipeline does a solid job for 2ז4×, but for noticeably more detail (and better handling of noise / JPEG artifacts) the tool can also shell out to the [Real-ESRGAN ncnn-vulkan](https://github.com/xinntao/Real-ESRGAN) command-line tool. The user provides the binary — the source release stays small and standalone, and the upgrade is opt-in.

Detection order (first hit wins, cached after first success):
1. Cached path from a previous successful detection in this run.
2. `where realesrgan-ncnn-vulkan.exe` (Windows) / `which realesrgan-ncnn-vulkan` (POSIX) on `PATH`.
3. `./bin/realesrgan-ncnn-vulkan[.exe]` next to the package root.

If none of those are present, the upscale function uses the built-in multi-step pipeline and a one-time toast reminds the user that the upgrade is available. If Real-ESRGAN is available but fails (corrupt model, GPU OOM, etc.), the tool logs the error and falls back to the built-in path so the user still gets a result.

#### Install

The single "Optional add-ons" popup (shown as a first-run prompt and re-openable from ⚙ Settings → Image upscaling → "Re-open add-ons") handles every Real-ESRGAN install path:

- **One-click download** — fetches the v0.2.5.0 Windows release from GitHub and extracts it into `./bin/`. (The asset name in that release is dated, e.g. `realesrgan-ncnn-vulkan-20220424-windows.zip`; the previous code pointed at a non-existent asset name which 404'd.)
- **Open releases page** — drops the user on the GitHub releases page so they can pick a different version themselves.
- **Pick file…** — file-picker copies an already-downloaded binary into `./bin/`. Universal fallback for when the upstream URL is moved or the user has the file on a different drive.

For pre-bundled portable builds, place the files manually:

1. Download the **`realesrgan-ncnn-vulkan`** portable for your OS from the [Real-ESRGAN releases page](https://github.com/xinntao/Real-ESRGAN/releases) (BSD-3-Clause).
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
4. Restart the app. The ⚙ Settings popup will show "Real-ESRGAN vX.Y.Z detected" under the **Image upscaling** section. Use the **Re-detect** button there (or "Re-open add-ons") if you installed it after launch.

#### Model
The default model is **`realesrgan-x4plus`** (general-purpose, BSD-3-Clause). The x4plus model always outputs at 4×; the renderer resizes the result to the requested multiplier — 2× / 3× are downscales from the 4× (super-sampling, very high quality), 4× is used as-is, 8× is a 2× step on top. You can pick a different model in ⚙ Settings → Image upscaling → Model if you have a more specialised `.param` + `.bin` pair installed.

---

### Optional: IS-Net background removal (MIT)

The in-app image pipeline can also run a local background-removal pass so generated assets are ready to drop onto other graphics without an alpha-channel round-trip. The same opt-in model applies: the tool ships with the runtime, but the model file and the optional Real-ESRGAN binary live in `./bin/`. Running `npm run setup` once before the first release downloads them from verified URLs.

#### Two backends, same flag contract

The wrapper at `src/isnetbg.js` supports two interchangeable backends, identical from the UI's point of view:

| Backend | When it's used | How you ship it |
| --- | --- | --- |
| **Pure-Node.js** (`src/isnetbg_node.js` + `onnxruntime-node` + `sharp`) | **Default.** No extra toolchain. | Already in the source tree; nothing to build. |
| **External binary** (`./bin/isnetbg.exe`, the C# / .NET 6+ reference) | Faster GPU inference on a developer's box. | Build once with `dotnet publish` (optional). |

Both backends share the same CLI contract and the same model file:

```
isnetbg --input <path> --output <path> [--use-gpu <0|1>]
```

On success: exit code `0`, a PNG with a transparent alpha channel at `<output>`. The same 4-step pipeline (1024×1024 Bicubic pre-resize, ONNX inference with DirectML/CPU fallback, Bicubic mask upsample, transparent PNG export) — the Node.js implementation follows the C# reference byte-for-byte at the algorithm level.

#### Install (before the first release)

```sh
npm install          # picks up onnxruntime-node + sharp
npm run setup        # downloads Real-ESRGAN + isnet-general-use.onnx into ./bin/
npm run check        # confirms everything the runtime needs is in place
npm run build        # packages the portable .exe with the .bin/ + the model baked in
```

End users who download the resulting .zip run the .exe directly — no install prompts, no downloads, the "Optional add-ons" popup auto-dismisses because everything is already there.

If the end user has the same setup on a fresh install (no `./bin/`), the popup re-appears with three buttons per component (Download / Open page / Pick file) — see the **Install** matrix in the *Optional: Real-ESRGAN upscaling* section above.

#### Manual install (skip `npm run setup`)

1. **Real-ESRGAN binary** — download the Windows release from [xinntao/Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN/releases/tag/v0.2.5.0) and place `realesrgan-ncnn-vulkan.exe` + the `models/` folder under `./bin/`.
2. **isnet-general-use.onnx model** — download from the verified HuggingFace mirror `https://huggingface.co/x-Liola-x/isnet-general-use-onnx/resolve/main/isnet-general-use.onnx` (~170 MB) and place it at `./bin/models/isnet-general-use.onnx`.
3. (Optional) **isnetbg C# binary** — if you want the faster GPU path, build a C# console program against the contract above (Microsoft.ML.OnnxRuntime + SixLabors.ImageSharp) and place the result at `./bin/isnetbg.exe`. The Node.js backend already covers the same use case without this step.
4. Restart the app. The ⚙ Settings → Upscale Settings popup will show "isnetbg node-onnxruntime detected" (or the C# binary version) under the **Remove background** section. The right-click "Remove background" item in the folder browser becomes a real action.

#### Detected model behaviour
- **Binary missing** → "not installed — see README" hint in the popup, the right-click action shows an error toast with the same hint. The Upscale pipeline silently skips the background-removal step.
- **Binary present, model missing** → "binary installed, model missing — see README" hint, action shows "model file missing — drop isnet-general-use.onnx into ./bin/models/."
- **Binary + model present** → the Upscale Settings popup and the right-click Upscale dialog both gain a "✨ Remove background" checkbox. The right-click "Remove background" item in the folder browser becomes fully functional.

#### GPU
The popup exposes a "use GPU acceleration" sub-toggle that forwards `--use-gpu 1|0` to the binary. Default is `1` (DirectML / CUDA / Vulkan, whatever the binary supports). On a CPU-only run, IS-Net at 1024×1024 takes a few seconds; GPU acceleration brings this down to under a second on most modern cards.

#### Why IS-Net
IS-Net (isnet-general-use) is the sweet spot for a desktop image tool: very high segmentation quality on portraits, objects, and general scenes, MIT-licensed, single ONNX file, runs offline. Comparable alternatives that also work as a drop-in for the same binary contract (only the model file changes):
- **BRIA RMBG-2.0** (Apache 2.0) — strong on portraits, slightly faster.
- **InSPyReNet** (Apache 2.0) — very high quality, slower.
- **MODNet** (Apache 2.0) — fastest of the four, lower quality on complex scenes.

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
2. Run `npm install` on the first run (downloads Electron + the optional add-on runtime deps `onnxruntime-node` and `sharp`).
3. Copy `config.txt.example` → `config.txt` if missing.
4. Launch the app via `node_modules\.bin\electron.cmd .`

### Before the first release

If you're a developer shipping a portable .zip that should work **without** any post-install downloads, run these once before `npm run build`:

```sh
npm install
npm run setup        # downloads Real-ESRGAN + isnet-general-use.onnx into ./bin/
npm run check        # preflight: confirms every required file is in place
npm run build        # packages the portable .exe with ./bin/ + node_modules/ baked in
```

The resulting `.zip` contains every file the user needs to use the optional quality upgrades (Real-ESRGAN upscaler, IS-Net background removal) with zero install steps on their end. See the *Optional: IS-Net background removal* section below for the architecture details.

#### Build on Windows accounts without `SeCreateSymbolicLinkPrivilege`

If `npm run build` aborts during the winCodeSign extraction with `ERROR: Cannot create symbolic link : Dem Client fehlt ein erforderliches Recht.` (or the English equivalent "A required privilege is not held by the client"), the 7-Zip binary can't recreate the macOS code-signing symlinks inside the winCodeSign archive. The Windows portable build never uses those macOS files, but electron-builder's 7-Zip extraction is hardcoded with the symlink-creating flag and there's no build-config workaround.

The build wrapper detects this exact failure and prints a clear fix message. The one-time fix on the dev box is:

```sh
npm run enable-devmode
```

This re-launches PowerShell as admin (UAC prompt) and sets the `AllowDevelopmentWithoutDevLicense` registry value to `1`, which is the same key that "Developer Mode" toggles in the Windows Settings UI. After it runs, `SeCreateSymbolicLinkPrivilege` is granted to your user and `npm run build` works without admin elevation.

If you'd rather do it manually:
1. **Settings → Privacy & security → For developers → Developer Mode → On** (Settings UI, 30s, recommended).
2. From an admin PowerShell:
   ```powershell
   reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock" /t REG_DWORD /f /v "AllowDevelopmentWithoutDevLicense" /d "1"
   ```
3. Just run `npm run build` from an elevated PowerShell each time.

After enabling Developer Mode, no other changes are needed — `npm run build` produces a self-contained `MiniMaxAssetTool-x.y.z-x64.zip` in `dist/`.

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
│   ├── isnetbg.js           # optional IS-Net background-removal wrapper
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
- **IS-Net `isnet-general-use` (optional, MIT)** — when the `isnetbg` CLI is installed, the right-click "Remove background" item and the "✨ Remove background" checkbox in the Upscale Settings popup shell out to it for a transparent PNG. The same opt-in model: source release works without it, and the UI shows a precise "binary / model missing" hint when the tool is partially installed.
- **Node.js `fs` + `path`** — the only Node modules used by the in-app image pipeline.

### v1.1 — Advanced pipeline settings overlay

⚙ Settings → Image → **Advanced pipeline settings…** opens a single overlay with every library-level knob the four special features actually accept. Defaults match the previous hard-coded behaviour — change them only if you have a specific reason (a slow GPU, a need for lossless screenshots, a preferred MP3 quality, etc.).

| Section | Knobs | Library |
|---|---|---|
| 🔍 Real-ESRGAN upscaler | Tile size (-t), TTA mode (-x), GPU device id (-g) | [realesrgan-ncnn-vulkan](https://github.com/xinntao/Real-ESRGAN) |
| ✨ IS-Net background remover | intra-op threads, inter-op threads, execution mode (CPU only) | [onnxruntime-node](https://www.npmjs.com/package/onnxruntime-node) |
| 🗜 Image optimiser (Sharp) | JPEG chroma subsampling + mozjpeg, PNG compression level + palette, WebP mode + effort, AVIF effort + chroma | [Sharp / libvips](https://sharp.pixelplumbing.com/) |
| ✂ Audio cutter (ffmpeg) | Silence threshold (dB) + min silence (ms), MP3 / Ogg quality, Opus + M4A bitrate | [ffmpeg](https://ffmpeg.org/) |

Every select dropdown offers a **Custom…** entry that reveals a small text input (and an OK button) next to the dropdown, so the user can enter a value not in the pre-defined list. The dropdown shrinks to 50% width and the input takes the other 50%, matching the same pattern used in every other ParamRow combo in the app. The input is validated against a per-knob spec (number range, string pattern) so a typo is caught with a toast before it's applied.

### v1.1 — File browser drives-list navigation

The file browser's ↑ (Up) button now navigates through four levels, with the button **disabled at the lowest** (the drives list, on Windows; `/` on POSIX):

1. A real folder inside `output_dir` → one level up
2. `output_dir` itself → one level up (parentDir)
3. A drive root (e.g. `D:\`) → the **DRIVES list**
4. The DRIVES list → **DISABLED** (the button is greyed out, the cursor is `not-allowed`, and the click is a no-op)

A user whose `output_dir` is at a drive root (e.g. `D:\`) can now reach any folder on a different drive without closing the tool.

### v1.1 — Default-off popups

Per the user's spec, the default popup policy is now `never` so a fresh install shows none of the informational popups (welcome / tab-intro / optional add-ons). The required first-time setup (API key + output folder) is NOT gated by this policy — it shows whenever the config is incomplete, independent of the popup setting. Change the policy in ⚙ Settings → Popups.

### Licensing & open-source

This project is MIT licensed. Every dependency in the build chain is also MIT-licensed (Electron, electron-builder) or permissive. The image pipeline is Canvas-only by default. The optional Real-ESRGAN upgrade is BSD-3-Clause (commercial use is fine) — attribution to [xinntao/Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) is appreciated if you ship a release with the binary bundled. The optional IS-Net background-removal upgrade is MIT-licensed — attribution to [xuebinqin/DIS](https://github.com/xuebinqin/DIS) is appreciated if you ship a release with the binary + model bundled.

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
