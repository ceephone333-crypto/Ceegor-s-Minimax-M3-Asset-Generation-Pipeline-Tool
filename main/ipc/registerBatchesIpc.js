// main/ipc/registerBatchesIpc.js
// IPC-Handler: `batches:get` / `batches:set` / `batches:generateExamples`.
// Speicherung als separate JSON-Datei neben config.txt.

const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const batchMod = require('../../src/batches');
const cfgMod = require('../../src/config');

/**
 * @param {{ appRoot: string }} deps
 */
function register(deps) {
  ipcMain.handle('batches:get', () => {
    try { return batchMod.read(); }
    catch (e) { return []; }
  });
  ipcMain.handle('batches:set', (_e, batches) => {
    try { batchMod.write(batches); return { ok: true }; }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  ipcMain.handle('batches:generateExamples', async (_e, format) => {
    try {
      // Bug-fix (2026-06-19, reported by user): the example files
      // used to be written to `deps.appRoot/example_batch_import.{md,txt}`,
      // where `appRoot = path.resolve(APP_ROOT, '..')`. In dev
      // that's the project root (writable). In a packaged build
      // (electron-builder `dir` target) `APP_ROOT` resolves to
      // `<dist-stable>/win-unpacked/resources/app.asar/main`, so
      // `appRoot` resolves to `<...>/resources/app.asar/` — INSIDE
      // the asar archive, which is mounted read-only. fs.writeFileSync
      // throws ENOENT/EROFS, the renderer surfaces it as
      // "Failed to generate examples: ENOENT: no such file or
      // directory, open '.../resources/app.asar/example_batch_import.md'",
      // and the user can't get the example files at all.
      //
      // The example files are user-facing documentation — they
      // belong next to the user's actual generated assets. Write
      // them to the effective output dir instead (which is what
      // the renderer already shows in the file browser). We
      // mkdir-p so the directory exists on first run.
      const cfg = cfgMod.read();
      const targetDir = cfgMod.effectiveOutputDir(cfg);
      try { fs.mkdirSync(targetDir, { recursive: true }); } catch (_) { /* best-effort */ }
      
      const mdContent = `# MiniMax Asset Import Instructions (AI-Readable)

This document serves as a template and instruction manual for an AI assistant to convert unstructured asset generation requests into a structured markdown table that the MiniMax Asset Tool can parse and import into its BatchGen queues.

## Expected Format
Your output must be a single markdown table with the following columns:
| Type | Prompt / Text | Parameters |

- **Type**: Must be exactly one of: \`image\`, \`speech\`, \`music\`, \`video\`.
- **Prompt / Text**: The main text input or prompt for the asset.
- **Parameters**: A space-separated list of flags and settings (e.g. \`--model image-01 --width 1024 --height 1024 --variants 3\`). Do NOT include the prompt text in this column.

---

## Detailed Parameters Reference Table

### 1. Image Generation (\`type: image\`)
- \`--model\`: \`image-01\` (default, general purpose) or \`image-01-live\` (artistic/cartoon).
- \`--aspect-ratio\`: \`1:1\`, \`16:9\`, \`9:16\`, \`4:3\`, \`3:4\`, \`2:3\`, \`3:2\`, \`21:9\`.
- \`--width\`: 512 to 2048 px (multiple of 8). Overrides aspect ratio when paired with \`--height\`.
- \`--height\`: 512 to 2048 px (multiple of 8). Overrides aspect ratio when paired with \`--width\`.
- \`--n\`: 1 to 4 (number of images generated per batch item).
- \`--seed\`: integer (for reproducible generation).
- \`--prompt-optimizer\`: \`true\` or \`false\` (lets model optimize prompt).
- \`--aigc-watermark\`: \`true\` or \`false\` (embeds digital watermark).
- \`--subject-ref\`: path or URL to character reference image (consistency).
- \`--response-format\`: \`url\` (default) or \`base64\`.
- \`--variants\`: 1 to 5 (number of variants to generate for this batch item in the UI runner).
- \`--upscale\`: \`true\` or \`false\` (enable local post-generation upscaling).
- \`--upscale-multiplier\`: \`2\` or \`4\` (upscale multiplier).

> [!IMPORTANT]
> **Resolution Limit Handling for AI**:
> The model supports a maximum native resolution of 2048x2048. If the user request asks for a resolution larger than 2048 px (e.g. a 3840x2160 4K image), you MUST:
> 1. Calculate a base resolution supported by the model that has the same aspect ratio (e.g. 1920x1080).
> 2. Set \`--width\` and \`--height\` to this base resolution (e.g. \`--width 1920 --height 1080\`).
> 3. Add the upscale flag \`--upscale true --upscale-multiplier 2\` to double the size, reaching 3840x2160!

### 2. Speech Synthesis / TTS (\`type: speech\`)
- \`--model\`: \`speech-2.8-hd\` (default), \`speech-2.8-turbo\`, \`speech-2.6-hd\`, \`speech-2.6-turbo\`, \`speech-02-hd\`, \`speech-02-turbo\`.
- \`--voice\`: Voice ID (default \`English_expressive_narrator\`). List other voices in the app.
- \`--speed\`: 0.5 to 2.0 (default \`1.0\`).
- \`--volume\`: 0 to 10 (default \`1\`).
- \`--pitch\`: -12 to 12 (default \`0\`).
- \`--format\`: \`mp3\` (default), \`wav\`, \`pcm\`, \`flac\`, \`opus\`.
- \`--sample-rate\`: \`8000\`, \`16000\`, \`22050\`, \`24000\`, \`32000\` (default), \`44100\`, \`48000\`.
- \`--bitrate\`: \`32000\` to \`320000\` (default \`128000\`).
- \`--channels\`: \`1\` (default, mono) or \`2\` (stereo).
- \`--language\`: \`auto\`, \`en\`, \`zh\`, \`ja\`, \`ko\`.
- \`--variants\`: 1 to 5.

### 3. Music Generation (\`type: music\`)
- \`--model\`: \`music-2.6\` (default), \`music-2.5\`, \`music-2.0\`.
- \`--instrumental\`: \`true\` or \`false\` (generate instrumental music without vocals).
- \`--vocal-mode\`: \`lyrics-optimizer\` (default, auto lyrics), \`lyrics\` (custom lyrics), \`instrumental\` (no vocals).
- \`--custom-lyrics\`: custom lyric text (only if vocal mode is \`lyrics\`).
- \`--genre\`: e.g. \`pop\`, \`synthwave\`, \`classical\`.
- \`--mood\`: e.g. \`happy\`, \`sad\`, \`epic\`.
- \`--vocals\`: e.g. \`male\`, \`female\`.
- \`--instruments\`: e.g. \`guitar\`, \`piano\`, \`synthesizer\`.
- \`--bpm\`: e.g. \`120\`.
- \`--tempo\`: e.g. \`fast\`, \`medium\`, \`slow\`.
- \`--format\`: \`mp3\` (default), \`wav\`.
- \`--aigc-watermark\`: \`true\` or \`false\`.
- \`--variants\`: 1 to 5.

### 4. Video Generation (\`type: video\`)
- \`--model\`: \`video-01-live\` (default, high quality), \`video-01\` (legacy).
- \`--duration\`: \`5\` (default) or \`10\` seconds.
- \`--resolution\`: \`720p\` (default, 1280x720) or \`1080p\` (1920x1080).
- \`--first-frame\`: path to start frame image (I2V / SEF).
- \`--last-frame\`: path to end frame image (SEF only).
- \`--subject-image\`: path to subject character/object (S2V-01).
- \`--prompt-optimizer\`: \`true\` or \`false\`.
- \`--fast-pretreatment\`: \`true\` or \`false\`.
- \`--variants\`: 1 to 5.

---

## Example Import Table
| Type | Prompt / Text | Parameters |
|---|---|---|
| image | A futuristic cityscape with glowing neon lights | --model image-01 --aspect-ratio 16:9 --variants 3 --upscale true --upscale-multiplier 2 |
| speech | Hello, this is a batch voice recording | --model speech-2.8-hd --voice English_expressive_narrator --speed 1.05 |
| music | Upbeat 80s style retro arcade theme | --model music-2.6 --genre synthwave --instrumental true |
| video | A drone shot flying through a forest valley | --model video-01-live --duration 5 --resolution 1080p |
`;

      const txtContent = `MiniMax Asset Import Instructions (AI-Readable Plain-Text Template)

This plain text document serves as a template and instruction manual for an AI assistant to convert unstructured asset generation requests into a pipe-separated (|) text table that the MiniMax Asset Tool can parse and import into its BatchGen queues.

EXPECTED FORMAT:
Each line should be a pipe-separated row containing exactly:
Type | Prompt / Text | Parameters

Type must be one of: image, speech, music, video.
Prompt / Text is the main prompt or speech text.
Parameters is a space-separated list of flags (e.g., --model image-01 --width 1024 --height 1024).

---
DETAILED PARAMETERS REFERENCE TABLE:

1. IMAGE GENERATION (type: image)
- --model: image-01 (default) or image-01-live
- --aspect-ratio: 1:1, 16:9, 9:16, 4:3, 3:4, 2:3, 3:2, 21:9
- --width: 512 to 2048 px (multiple of 8). Overrides aspect ratio when paired with --height.
- --height: 512 to 2048 px (multiple of 8). Overrides aspect ratio when paired with --width.
- --n: 1 to 4
- --seed: integer
- --prompt-optimizer: true/false
- --aigc-watermark: true/false
- --subject-ref: path/URL to character reference image
- --response-format: url/base64
- --variants: 1 to 5
- --upscale: true/false
- --upscale-multiplier: 2 or 4

* IMPORTANT: RESOLUTION LIMITS FOR AI *
The model maximum native resolution is 2048x2048. If the user asks for a resolution larger than 2048 px (e.g., 3840x2160), you MUST:
1. Scale the requested dimensions down to a supported base resolution of the same aspect ratio (e.g., 1920x1080).
2. Set --width 1920 --height 1080.
3. Add --upscale true --upscale-multiplier 2 to scale it back up post-generation.

2. SPEECH SYNTHESIS / TTS (type: speech)
- --model: speech-2.8-hd (default), speech-2.8-turbo, speech-2.6-hd, speech-2.6-turbo, speech-02-hd, speech-02-turbo
- --voice: Voice ID (default English_expressive_narrator)
- --speed: 0.5 to 2.0 (default 1.0)
- --volume: 0 to 10 (default 1)
- --pitch: -12 to 12 (default 0)
- --format: mp3, wav, pcm, flac, opus
- --sample-rate: 8000 to 48000 (default 32000)
- --bitrate: 32000 to 320000 (default 128000)
- --channels: 1 (mono) or 2 (stereo)
- --language: auto, en, zh, ja, ko
- --variants: 1 to 5

3. MUSIC GENERATION (type: music)
- --model: music-2.6 (default), music-2.5, music-2.0
- --instrumental: true/false
- --vocal-mode: lyrics-optimizer, lyrics, instrumental
- --custom-lyrics: lyric text (only if vocal-mode is lyrics)
- --genre: e.g. pop, synthwave
- --mood: e.g. happy, sad, epic
- --vocals: e.g. male, female
- --instruments: e.g. guitar, piano, synthesizer
- --bpm: e.g. 120
- --tempo: fast, medium, slow
- --format: mp3, wav
- --aigc-watermark: true/false
- --variants: 1 to 5

4. VIDEO GENERATION (type: video)
- --model: video-01-live (default), video-01
- --duration: 5 or 10 seconds
- --resolution: 720p or 1080p
- --first-frame: path to start frame image
- --last-frame: path to end frame image
- --subject-image: path to subject reference image
- --prompt-optimizer: true/false
- --fast-pretreatment: true/false
- --variants: 1 to 5

---
EXAMPLE IMPORT ROWS:
image | A futuristic cityscape with glowing neon lights | --model image-01 --aspect-ratio 16:9 --variants 3 --upscale true --upscale-multiplier 2
speech | Hello, this is a batch voice recording | --model speech-2.8-hd --voice English_expressive_narrator --speed 1.05
music | Upbeat 80s style retro arcade theme | --model music-2.6 --genre synthwave --instrumental true
video | A drone shot flying through a forest valley | --model video-01-live --duration 5 --resolution 1080p
`;

      fs.writeFileSync(path.join(targetDir, 'example_batch_import.md'), mdContent, 'utf8');
      fs.writeFileSync(path.join(targetDir, 'example_batch_import.txt'), txtContent, 'utf8');
      // v1.1.13 (reported by user): the previous version hard-
      // wrote BOTH files even when the user only wanted one.
      // The renderer now passes the format the user picked in
      // ⚙ Settings → BatchGen ('md' or 'txt'); we delete the
      // other one so the user only sees the format they
      // chose. Unknown / missing → fall back to 'md'.
      const chosenFormat = (format === 'txt') ? 'txt' : 'md';
      let finalPath;
      if (chosenFormat === 'md') {
        try { fs.unlinkSync(path.join(targetDir, 'example_batch_import.txt')); } catch (_) { /* may not exist — fine */ }
        finalPath = path.join(targetDir, 'example_batch_import.md');
      } else {
        try { fs.unlinkSync(path.join(targetDir, 'example_batch_import.md')); } catch (_) { /* may not exist — fine */ }
        finalPath = path.join(targetDir, 'example_batch_import.txt');
      }
      return {
        ok: true,
        format: chosenFormat,
        path: finalPath,
        // Legacy keys (kept for renderer backwards-compat; the
        // toast code uses path now, mdPath/txtPath still
        // present in case any older code reads them).
        mdPath: path.join(targetDir, 'example_batch_import.md'),
        txtPath: path.join(targetDir, 'example_batch_import.txt'),
      };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  });
}

module.exports = { register };
