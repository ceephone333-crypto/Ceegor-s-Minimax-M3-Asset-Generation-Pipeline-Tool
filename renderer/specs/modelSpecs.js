// renderer/specs/modelSpecs.js
// Per-model spec registry + 2 validation helpers. Phase 3 Block 18.
//
// Single source of truth for what each model accepts. Each tab
// builds its form from one of these specs; the spec also drives
// per-row validation (max chars, max value, min value) and the
// "show only supported parameters" rule.
//
// The values below are pulled from the official MiniMax API
// documentation at https://platform.minimax.io/docs/api-reference/
// (image / video / music / speech tabs). Adding a new model
// here is the only change required — every parameter row in the
// corresponding tab consults this table to decide whether to be
// shown, what its max is, and how to format the help text.
//
// Schema for each entry:
//   prompt: { max: <chars>, help: <human-readable> }
//   supportedFlags: [<string>, ...] — only these --flags are sent.
//     Rows whose label doesn't appear here are NOT rendered.
//   perRowOverrides: optional map of flag → { max, min, step }
//     used by a few rows whose numeric range is tighter than the
//     generic input type definition.
//
// To verify a value is in range the renderer does TWO things:
//   1. The number <input> gets min/max attributes (already does).
//   2. Before mmx is called, validateAgainstSpec() re-checks every
//      row against the spec and short-circuits with a toast if
//      anything is out of range.

const MODEL_SPECS = {
  image: {
    label: 'Image generation',
    // Currently the API exposes image-01 + image-01-live. Both
    // accept the same parameter set; the help text for --model
    // explains the style difference.
    prompt: { max: 1500, help: 'Up to 1500 characters (hard limit).' },
    supportedFlags: [
      '--prompt',           // mandatory; the textarea above the parameters grid
      '--model',            // image-01 (default) / image-01-live
      '--aspect-ratio',     // 1:1 (default) / 16:9 / 9:16 / 4:3 / 3:4 / 2:3 / 3:2 / 21:9
      '--n',                // 1–9 (renderer clamps to 4)
      '--width',            // 512–2048 multiple of 8, image-01 only
      '--height',           // 512–2048 multiple of 8, image-01 only
      '--seed',             // 0 .. 2^31-1
      '--prompt-optimizer', // boolean
      '--aigc-watermark',   // boolean
      '--subject-reference-file', // image-01 + image-01-live
      '--subject-reference-type', // 'character' (only supported value)
    ],
    perRowOverrides: {
      '--aspect-ratio': { note: '21:9 is image-01 only — hidden on image-01-live.' },
    },
    imageExtra: {
      // (image-01-only) custom width/height; aspect-ratio is
      // overridden when both are set.
    },
  },
  speech: {
    label: 'Speech generation',
    prompt: { max: 10000, help: 'Up to 10 000 characters (hard limit).' },
    supportedFlags: [
      '--model',      // speech-2.8-hd / speech-2.8-turbo / speech-2.6-hd / speech-2.6-turbo / speech-02-hd / speech-02-turbo / speech-2.6 / speech-02
      '--voice',      // voice id (loaded from `mmx speech voices`)
      '--speed',      // 0.5–2.0, step 0.05, default 1.0
      '--volume',     // 0–10, step 1, default 0
      '--pitch',      // -12..+12 semitones, step 1, default 0
      '--format',     // mp3 / wav / pcm / flac / opus / pcmu_raw / pcmu_wav
      '--sample-rate',// 8000/16000/22050/24000/32000/44100/48000
      '--bitrate',    // 32000..320000
      '--channels',   // 1 / 2
      '--language',   // 2-letter code or 'auto' (voice-dependent)
      '--subtitles',  // boolean (saves .srt alongside audio)
      '--sound-effect',
      '--pronunciation', // from=to list
      '--emotion',    // happy/sad/angry/fearful/surprised/disgusted/neutral
      '--text',       // the textarea; mandatory
    ],
    perRowOverrides: {
      // speech-2.6 and below do NOT support --emotion. The
      // renderer hides the row when one of those models is
      // selected.
      '--emotion': {
        supportedForModels: new Set(['speech-2.8-hd', 'speech-2.8-turbo', 'speech-2.6-hd', 'speech-2.6-turbo']),
        note: 'Emotion control is only available on the 2.6+ speech models.',
      },
      // --bitrate only applies to compressed formats (mp3 / opus).
      '--bitrate': {
        supportedForFormats: new Set(['mp3', 'opus']),
        note: 'Bitrate only affects MP3 / Opus; WAV / PCM / FLAC are lossless.',
      },
    },
  },
  music: {
    label: 'Music generation',
    prompt: { max: 2000, help: 'Up to 2 000 characters (hard limit).' },
    lyrics: { max: 3500, help: 'Up to 3 500 characters. Required unless is_instrumental or lyrics_optimizer is enabled.' },
    supportedFlags: [
      '--model',              // music-2.0 / music-2.5 / music-2.5+ / music-2.6
      '--prompt',             // mandatory, 10–2000 chars
      '--lyrics',             // 10–3000 chars (2.6 supports 3500); not needed for instrumental
      '--instrumental',       // boolean, music-2.5+ / music-2.6
      '--lyrics-optimizer',   // boolean (music-2.6)
      '--sample-rate',        // 8000/16000/22050/24000/32000/44100 (music-2.0 supports 8000)
      '--bitrate',            // 32000/64000/128000/256000
      '--format',             // mp3 (default) / wav / pcm
    ],
    perRowOverrides: {
      // music-2.0 does NOT support --instrumental, --lyrics, or
      // --lyrics-optimizer. music-2.5 supports --lyrics but not
      // --lyrics-optimizer. Only music-2.6 supports all three.
      '--instrumental': {
        supportedForModels: new Set(['music-2.5', 'music-2.5+', 'music-2.6']),
        note: 'Instrumental mode is supported on music-2.5 / 2.5+ / 2.6 only.',
      },
      '--lyrics-optimizer': {
        supportedForModels: new Set(['music-2.6']),
        note: 'Auto-lyrics is supported on music-2.6 only.',
      },
      '--lyrics': {
        // music-2.0 supports lyrics but the model often ignores
        // them. The renderer keeps the row visible but flags it.
        note: 'music-2.5 / 2.6 honor --lyrics reliably; music-2.0 may ignore them.',
      },
    },
  },
  video: {
    label: 'Video generation',
    prompt: { max: 2000, help: 'Up to 2 000 characters (hard limit).' },
    supportedFlags: [
      '--model',                   // MiniMax-Hailuo-2.3 / MiniMax-Hailuo-02 / S2V-01
      '--prompt',                  // mandatory, 1–2000 chars
      '--first-frame-image',       // image path or URL
      '--last-frame-image',        // image path or URL (Hailuo-02 only)
      '--subject-image',           // S2V-01 only
      '--duration',                // 6 (always) or 10 (768p only)
      '--resolution',              // 768p / 1080p (1080p = 6s only on 2.3 / 02)
      '--prompt-optimizer',        // boolean
      '--fast-pretreatment',       // boolean (Hailuo-2.3 + Hailuo-02)
    ],
    perRowOverrides: {
      '--first-frame-image': {
        supportedForModels: new Set(['MiniMax-Hailuo-2.3', 'MiniMax-Hailuo-2.3-Fast', 'MiniMax-Hailuo-02']),
        note: 'MiniMax-Hailuo-2.3-Fast and MiniMax-Hailuo-02 require a first-frame image.',
      },
      '--last-frame-image': {
        supportedForModels: new Set(['MiniMax-Hailuo-02']),
        note: 'Last-frame image is supported on MiniMax-Hailuo-02 only (first+last frame interpolation).',
      },
      '--subject-image': {
        supportedForModels: new Set(['S2V-01']),
        note: 'Subject-image (face reference) is supported on S2V-01 only.',
      },
      '--duration': {
        // 10 s is only available at 768P. The renderer drops the
        // 10 option from the dropdown when 1080P is selected.
        dependsOnResolution: true,
        note: '10-second duration is only available at 768P.',
      },
      '--resolution': {
        allowedForModels: {
          'MiniMax-Hailuo-2.3':       new Set(['768P', '1080P']),
          'MiniMax-Hailuo-2.3-Fast': new Set(['768P']),     // fast model only supports 768p
          'MiniMax-Hailuo-02':       new Set(['768P', '1080P']),
          'S2V-01':                  new Set(['768P']),     // S2V-01 only 768p
        },
        note: 'MiniMax-Hailuo-2.3-Fast and S2V-01 only support 768P.',
      },
      '--fast-pretreatment': {
        supportedForModels: new Set(['MiniMax-Hailuo-2.3', 'MiniMax-Hailuo-2.3-Fast', 'MiniMax-Hailuo-02']),
        note: 'Fast-pretreatment is supported on Hailuo-2.3 (+Fast) and Hailuo-02.',
      },
    },
  },
};

// Look up the per-model override for a row. Returns null if
// the row is generally supported for the tab but has no
// per-model restriction. Used by buildParamRow (to decide
// whether to render the row at all) and by the gen handler
// (to short-circuit before the request is sent).
function getRowSpec(tabKey, flag, currentModel, currentResolution) {
  const tab = MODEL_SPECS[tabKey];
  if (!tab || !tab.perRowOverrides) return null;
  const ov = tab.perRowOverrides[flag];
  if (!ov) return null;
  // Resolution-dependent rows: pick the option that matches
  // the current resolution dropdown value (used for the
  // video tab's --duration row, where the 10s option is
  // only valid at 768P).
  if (ov.dependsOnResolution && currentResolution && ov.resolutionOverrides) {
    return ov.resolutionOverrides[currentResolution] || ov;
  }
  return ov;
}

// Validate every value in the per-tab state against the spec.
// Returns an array of error strings (empty = OK). Called by the
// gen handler right before the request is sent so the user never
// gets a cryptic 400 from the API.
function validateTabAgainstSpec(tabKey, params, currentModel, currentResolution, isFlagVisibleForCurrentModel) {
  const errs = [];
  const tab = MODEL_SPECS[tabKey];
  if (!tab) return errs;
  for (const flag of tab.supportedFlags || []) {
    const param = params && params[flag];
    if (!param) continue;
    const v = param.getValue ? param.getValue() : (param.value ?? param.el?.value);
    if (v == null || v === '' || v === 'off') continue;
    // Skip flags that aren't visible for the current model.
    if (!isFlagVisibleForCurrentModel(tabKey, flag, currentModel, currentResolution, getRowSpec)) {
      errs.push(`${flag} is not supported on ${currentModel}. Switch models or hide this row.`);
      continue;
    }
    // Number range checks (only meaningful for numeric rows;
    // the buildParamRow already sets HTML min/max attributes
    // for native validation, but we re-check here so the
    // user sees a precise toast instead of a silent clamp).
    if (typeof v === 'number' || (typeof v === 'string' && /^-?\d/.test(v))) {
      const ov = tab.perRowOverrides && tab.perRowOverrides[flag];
      if (ov && ov.max != null && Number(v) > ov.max) {
        errs.push(`${flag} = ${v} exceeds max ${ov.max} for ${currentModel || 'this model'}.`);
      }
      if (ov && ov.min != null && Number(v) < ov.min) {
        errs.push(`${flag} = ${v} below min ${ov.min} for ${currentModel || 'this model'}.`);
      }
    }
    // Prompt max length (the textarea above the parameters
    // grid; the counter already colours itself red when over).
    if (flag === '--prompt' && tab.prompt && tab.prompt.max) {
      const len = String(v).length;
      if (len > tab.prompt.max) {
        errs.push(`Prompt is ${len} characters; max for ${tab.label} is ${tab.prompt.max}.`);
      }
    }
    if (flag === '--lyrics' && tab.lyrics && tab.lyrics.max) {
      const len = String(v).length;
      if (len > tab.lyrics.max) {
        errs.push(`Lyrics is ${len} characters; max for ${currentModel || 'this model'} is ${tab.lyrics.max}.`);
      }
    }
  }
  return errs;
}

window.ModelSpecs = { MODEL_SPECS, getRowSpec, validateTabAgainstSpec };
