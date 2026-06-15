# Changelog

All notable changes to the MiniMax Asset Generation Pipeline Tool are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0] — 2026-06-15

### Added
- **Image generation tab** — model, aspect ratio, width/height, negative prompt, prompt optimizer, watermark, subject reference, count, response format. Up to 5 variants per click with per-variant retry (3 attempts, exponential backoff).
- **Speech generation tab** — 300+ voices in 18 languages, speed, volume, pitch, sample rate, bitrate, channels, pronunciation dictionary.
- **Music generation tab** — instrumental mode, lyrics (free text or file), genre / mood / instruments / key / tempo / structure, use case, output format.
- **Video generation tab** — model, duration, resolution, polling interval, reference images.
- **Local image pipeline (no API, no ML libs)**:
  - **🔍 Upscale** — 2× / 3× / 4× upscale via Canvas API. Toggle in the image tab to upscale every generated image automatically.
  - **✂ Crop** — fullscreen crop overlay with W × H inputs, green draggable frame (see-through middle), drag with mouse or touch.
  - **⇄ Convert format** — PNG / JPEG / WebP via `canvas.toDataURL`.
- **Per-tab persistence** — every form value autosaves to `state.json` (atomic writes) and survives restarts.
- **Per-tab output folder** — generated files land in the folder currently shown in the file browser (e.g. you can keep the file browser on `_assets/images/spellquake` and every image goes there).
- **BatchGen** — paste up to 100 prompts per tab, run them sequentially. State-save is suppressed during batch runs to prevent the last batch item from overwriting your saved prompt.
- **Per-tab ETA timer** — while generating, each tab shows a small mm:ss countdown (with sensible defaults on first run: image 35s, speech 12s, music 75s, video 90s).
- **Classified error UI** — failed generations show a panel with categorized tips (auth / rate / quota / network / server / unknown) and one-click **Test connection / Diagnose / Retry / Copy error** actions.
- **File browser** with right-click context menu (Open / Reveal / Copy / Cut / Rename / Move / Paste / Delete / Upscale / Crop / Convert), single-click image preview in the bottom-right **Picture preview** pane (fit-to-content, click for 1:1 + zoom dropdown), and internal drag-and-drop to move files between folders.
- **Sticky log pane** at the bottom-left with Copy / Clear / Collapse buttons, and a new **Picture preview** pane at the bottom-right (in place of the previous full-width log). Log pane auto-streams `mmx` stderr + JSON stdout.
- **Keyboard shortcuts**: `Ctrl+Enter` Generate · `Ctrl+1/2/3/4` switch tab · `Ctrl+B` BatchGen · `Ctrl+S` Settings · `Ctrl+T` Styles · `Ctrl+L` Toggle theme · `Ctrl+F` Focus search · `Ctrl+R` Refresh quota · `Esc` close overlay.
- **Dark + light themes** — both have tuned contrast, and the per-theme color tokens are documented in `renderer/styles.css`.
- **portable Windows build** via `npm run build` (electron-builder, single-file `.exe`).
- **mmx stdout streaming** — JSON responses from `mmx` are forwarded to the log pane so you can see the actual server payload on errors.
