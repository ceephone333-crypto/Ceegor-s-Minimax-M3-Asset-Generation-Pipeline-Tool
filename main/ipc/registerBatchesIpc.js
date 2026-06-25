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
    // Bug-fix M3 (_temp5.md 360° audit): the error path used to return
    // `[]`, which violates the BatchesState contract (an object keyed
    // by tab). The renderer's defensive reads happened not to crash on
    // an empty array, but any future code that spread state.batches
    // would silently produce junk keys. Return the proper default
    // shape (same as batchMod.read's own error fallback).
    try { return batchMod.read(); }
    catch (e) { return batchMod.defaultBatches(); }
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
- \`--width\`: 512 to 2048 px (multiple of 8). Overrides aspect ratio when paired with \`--height\`. **image-01 only.**
- \`--height\`: 512 to 2048 px (multiple of 8). Overrides aspect ratio when paired with \`--width\`. **image-01 only.**
- \`--n\`: 1 to 4 (number of images per mmx call; tool spawns N×Variants calls total).
- \`--seed\`: integer (for reproducible generation).
- \`--prompt-optimizer\`: \`true\` or \`false\` (lets the model optimize the prompt).
- \`--aigc-watermark\`: \`true\` or \`false\` (embeds a digital watermark).
- \`--subject-ref\`: path or URL to character reference image (consistency across generations). Format: \`type=character,image=<path-or-url>\`.
- \`--response-format\`: \`url\` (default, downloads to disk) or \`base64\` (bypasses CDN, embeds in JSON).
- \`--variants\`: 1 to 5 (re-spawns mmx N times in the BatchGen runner for one prompt).
- \`--upscale\`: \`true\` or \`false\` (enable local post-generation upscaling).
- \`--upscale-multiplier\`: \`2\` or \`4\` (upscale multiplier when \`--upscale true\`).

> [!IMPORTANT]
> **Resolution Limit Handling for AI**:
> The model supports a maximum native resolution of 2048x2048. If the user request asks for a resolution larger than 2048 px (e.g. a 3840x2160 4K image), you MUST:
> 1. Calculate a base resolution supported by the model that has the same aspect ratio (e.g. 1920x1080).
> 2. Set \`--width\` and \`--height\` to this base resolution (e.g. \`--width 1920 --height 1080\`).
> 3. Add the upscale flag \`--upscale true --upscale-multiplier 2\` to double the size, reaching 3840x2160!

> [!IMPORTANT]
> **--n combined with --variants** (BUG-9-08): \`--n=2 --variants=2\` spawns 2 mmx calls each requesting 2 images = 4 images total. Rapid back-to-back mmx calls can trigger API rate limits (observed: silent "mmx exited with code -1" on the 2nd call). The tool warns on Generate; consider using just one of \`--n\` or \`--variants\`.

### 2. Speech Synthesis / TTS (\`type: speech\`)
- \`--model\`: \`speech-2.8-hd\` (default), \`speech-2.8-turbo\`, \`speech-2.6-hd\`, \`speech-2.6-turbo\`, \`speech-02-hd\`, \`speech-02-turbo\`, \`speech-01-hd\`, \`speech-01-turbo\`.
- \`--voice\`: Voice ID (default \`English_expressive_narrator\`). List other voices in the app under the Voice dropdown.
- \`--speed\`: 0.5 to 2.0 (default \`1.0\`).
- \`--volume\`: 0 to 10 (default \`1\`; the API treats 0 as "no volume", so use a small positive value like 0.1).
- \`--pitch\`: -12 to 12 semitones (default \`0\`).
- \`--format\`: \`mp3\` (default), \`wav\`, \`pcm\`, \`flac\`, \`opus\`.
- \`--sample-rate\`: \`8000\`, \`16000\`, \`22050\`, \`24000\`, \`32000\` (default), \`44100\`, \`48000\`.
- \`--bitrate\`: \`32000\` to \`320000\` (default \`128000\`). Only affects MP3 / Opus.
- \`--channels\`: \`1\` (default, mono) or \`2\` (stereo).
- \`--language\`: \`auto\`, \`en\`, \`zh\`, \`ja\`, \`ko\`.
- \`--subtitles\`: \`true\` or \`false\` (saves an \`.srt\` alongside the audio).
- \`--sound-effect\`: path/URL to a sound effect to mix in.
- \`--pronunciation\`: \`from=to\` pair (repeatable; e.g. \`--pronunciation tomato=tom-ah-to\`).
- \`--emotion\`: \`happy\`, \`sad\`, \`angry\`, \`fearful\`, \`surprised\`, \`disgusted\`, \`neutral\`. **speech-2.6+ only** — the API rejects it on 2.6/02/01.
- \`--variants\`: 1 to 5.

### 3. Music Generation (\`type: music\`)
- \`--model\`: \`music-2.6\` (default, newest), \`music-2.5+\`, \`music-2.5\`. (The legacy \`music-2.0\` was removed in v1.1.17; the tool now rejects it.)
- \`--instrumental\`: \`true\` or \`false\` (generate an instrumental track with no vocals). Requires \`music-2.5\` or newer.
- \`--lyrics\`: the song lyrics with structure tags (\`[Verse]\`, \`[Chorus]\`, …). Max 3500 chars. Required unless \`--instrumental\` or \`--lyrics-optimizer\` is set.
- \`--lyrics-optimizer\`: \`true\` or \`false\` (auto-generate lyrics from the prompt). **music-2.6 only.** Mutually exclusive with \`--lyrics\` and \`--instrumental\`.
- \`--genre\`: e.g. \`pop\`, \`synthwave\`, \`classical\`, \`jazz\`, \`electronic\`, \`folk\`, \`hip-hop\`, \`r&b\`, \`rock\`.
- \`--mood\`: e.g. \`happy\`, \`sad\`, \`epic\`, \`calm\`, \`energetic\`, \`melancholic\`, \`uplifting\`, \`nostalgic\`.
- \`--vocals\`: e.g. \`male\`, \`female\`, \`baritone\`, \`soprano\`, \`choir\`. Ignored when \`--instrumental true\`.
- \`--instruments\`: e.g. \`guitar\`, \`piano\`, \`synthesizer\`, \`strings\`, \`drums\`.
- \`--bpm\`: 40 to 220 (exact tempo in beats per minute).
- \`--tempo\`: \`slow\`, \`moderate\`, \`fast\` (coarse alternative to \`--bpm\`).
- \`--key\`: musical key, e.g. \`C major\`, \`A minor\`, \`G sharp\`.
- \`--references\`: free-form style reference, e.g. \`similar to Ed Sheeran\`.
- \`--avoid\`: elements to keep OUT, e.g. \`no brass, no saxophone\`.
- \`--format\`: \`mp3\` (default), \`wav\`, \`pcm\`.
- \`--sample-rate\`: \`16000\`, \`24000\`, \`32000\`, \`44100\` (default).
- \`--bitrate\`: \`32000\`, \`64000\`, \`128000\`, \`256000\`.
- \`--aigc-watermark\`: \`true\` or \`false\`.
- \`--variants\`: 1 to 5.

### 4. Video Generation (\`type: video\`)
- \`--model\`: \`MiniMax-Hailuo-2.3\` (default, T2V/I2V), \`MiniMax-Hailuo-2.3-Fast\` (fast I2V; **requires \`--first-frame-image\`**), \`MiniMax-Hailuo-02\` (T2V/I2V/SEF; supports \`--last-frame-image\`), \`S2V-01\` (subject-driven; **requires \`--subject-image\`**).
- \`--first-frame-image\`: path or URL to the starting frame (image-to-video). Required on \`MiniMax-Hailuo-2.3-Fast\`.
- \`--last-frame-image\`: path or URL to the ending frame (start-end interpolation on \`MiniMax-Hailuo-02\` only).
- \`--subject-image\`: path or URL to the subject reference (character consistency on \`S2V-01\` only).
- \`--duration\`: \`6\` (always available) or \`10\` seconds (768P only; 1080P caps at 6s).
- \`--resolution\`: \`768P\` (default) or \`1080P\` (Hailuo-2.3-Fast and S2V-01 only support 768P).
- \`--prompt-optimizer\`: \`true\` or \`false\`.
- \`--fast-pretreatment\`: \`true\` or \`false\` (Hailuo-2.3 / Hailuo-2.3-Fast / Hailuo-02 only).
- \`--variants\`: 1 to 5.

---

## Example Import Table
| Type | Prompt / Text | Parameters |
|---|---|---|
| image | A futuristic cityscape with glowing neon lights | --model image-01 --aspect-ratio 16:9 --variants 3 --upscale true --upscale-multiplier 2 |
| speech | Hello, this is a batch voice recording | --model speech-2.8-hd --voice English_expressive_narrator --speed 1.05 |
| music | Upbeat 80s style retro arcade theme | --model music-2.6 --genre synthwave --instrumental true --bpm 120 |
| video | A drone shot flying through a forest valley | --model MiniMax-Hailuo-2.3 --duration 6 --resolution 768P |
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
- --width: 512 to 2048 px (multiple of 8). Overrides aspect ratio when paired with --height. image-01 only.
- --height: 512 to 2048 px (multiple of 8). Overrides aspect ratio when paired with --width. image-01 only.
- --n: 1 to 4 (number of images per mmx call; tool spawns N * Variants calls total).
- --seed: integer (for reproducible generation).
- --prompt-optimizer: true/false (lets the model optimize the prompt).
- --aigc-watermark: true/false (embeds a digital watermark).
- --subject-ref: path or URL to character reference image. Format: type=character,image=<path-or-url>.
- --response-format: url (default, downloads to disk) or base64 (bypasses CDN).
- --variants: 1 to 5 (re-spawns mmx N times in the BatchGen runner for one prompt).
- --upscale: true/false (enable local post-generation upscaling).
- --upscale-multiplier: 2 or 4 (upscale multiplier when --upscale true).

* IMPORTANT: RESOLUTION LIMITS FOR AI *
The model maximum native resolution is 2048x2048. If the user asks for a resolution larger than 2048 px (e.g., 3840x2160), you MUST:
1. Scale the requested dimensions down to a supported base resolution of the same aspect ratio (e.g., 1920x1080).
2. Set --width 1920 --height 1080.
3. Add --upscale true --upscale-multiplier 2 to scale it back up post-generation.

* IMPORTANT: --n COMBINED WITH --variants (BUG-9-08) *
--n=2 --variants=2 spawns 2 mmx calls each requesting 2 images = 4 images total. Rapid back-to-back mmx calls can trigger API rate limits (observed: silent "mmx exited with code -1" on the 2nd call). The tool warns on Generate; consider using just one of --n or --variants.

2. SPEECH SYNTHESIS / TTS (type: speech)
- --model: speech-2.8-hd (default), speech-2.8-turbo, speech-2.6-hd, speech-2.6-turbo, speech-02-hd, speech-02-turbo, speech-01-hd, speech-01-turbo.
- --voice: Voice ID (default English_expressive_narrator).
- --speed: 0.5 to 2.0 (default 1.0).
- --volume: 0 to 10 (default 1; treat 0 as muted -- use a small positive value).
- --pitch: -12 to 12 semitones (default 0).
- --format: mp3 (default), wav, pcm, flac, opus.
- --sample-rate: 8000, 16000, 22050, 24000, 32000 (default), 44100, 48000.
- --bitrate: 32000 to 320000 (default 128000). Only affects MP3 / Opus.
- --channels: 1 (default, mono) or 2 (stereo).
- --language: auto, en, zh, ja, ko.
- --subtitles: true/false (saves an .srt alongside the audio).
- --sound-effect: path or URL to a sound effect to mix in.
- --pronunciation: from=to pair (repeatable). Example: --pronunciation tomato=tom-ah-to.
- --emotion: happy, sad, angry, fearful, surprised, disgusted, neutral. speech-2.6+ only -- API rejects on 2.6/02/01.
- --variants: 1 to 5.

3. MUSIC GENERATION (type: music)
- --model: music-2.6 (default, newest), music-2.5+, music-2.5. (Legacy music-2.0 was removed in v1.1.17; the tool rejects it.)
- --instrumental: true/false (no vocals). Requires music-2.5 or newer.
- --lyrics: song lyrics with structure tags ([Verse], [Chorus], ...). Max 3500 chars. Required unless --instrumental or --lyrics-optimizer is set.
- --lyrics-optimizer: true/false (auto-generate lyrics from the prompt). music-2.6 only. Mutually exclusive with --lyrics and --instrumental.
- --genre: pop, synthwave, classical, jazz, electronic, folk, hip-hop, r&b, rock, etc.
- --mood: happy, sad, epic, calm, energetic, melancholic, uplifting, nostalgic, etc.
- --vocals: male, female, baritone, soprano, choir, etc. Ignored when --instrumental true.
- --instruments: guitar, piano, synthesizer, strings, drums, etc.
- --bpm: 40 to 220 (exact tempo in beats per minute).
- --tempo: slow, moderate, fast (coarse alternative to --bpm).
- --key: musical key, e.g. C major, A minor, G sharp.
- --references: free-form style reference, e.g. similar to Ed Sheeran.
- --avoid: elements to keep OUT, e.g. no brass, no saxophone.
- --format: mp3 (default), wav, pcm.
- --sample-rate: 16000, 24000, 32000, 44100 (default).
- --bitrate: 32000, 64000, 128000, 256000.
- --aigc-watermark: true/false.
- --variants: 1 to 5.

4. VIDEO GENERATION (type: video)
- --model: MiniMax-Hailuo-2.3 (default, T2V/I2V), MiniMax-Hailuo-2.3-Fast (fast I2V; requires --first-frame-image), MiniMax-Hailuo-02 (T2V/I2V/SEF; supports --last-frame-image), S2V-01 (subject-driven; requires --subject-image).
- --first-frame-image: path or URL to the starting frame. Required on MiniMax-Hailuo-2.3-Fast.
- --last-frame-image: path or URL to the ending frame. MiniMax-Hailuo-02 only.
- --subject-image: path or URL to the subject reference. S2V-01 only.
- --duration: 6 (always) or 10 seconds (768P only; 1080P caps at 6s).
- --resolution: 768P (default) or 1080P. Hailuo-2.3-Fast and S2V-01 only support 768P.
- --prompt-optimizer: true/false.
- --fast-pretreatment: true/false (Hailuo-2.3 / Hailuo-2.3-Fast / Hailuo-02 only).
- --variants: 1 to 5.

---
EXAMPLE IMPORT ROWS:
image | A futuristic cityscape with glowing neon lights | --model image-01 --aspect-ratio 16:9 --variants 3 --upscale true --upscale-multiplier 2
speech | Hello, this is a batch voice recording | --model speech-2.8-hd --voice English_expressive_narrator --speed 1.05
music | Upbeat 80s style retro arcade theme | --model music-2.6 --genre synthwave --instrumental true --bpm 120
video | A drone shot flying through a forest valley | --model MiniMax-Hailuo-2.3 --duration 6 --resolution 768P
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
