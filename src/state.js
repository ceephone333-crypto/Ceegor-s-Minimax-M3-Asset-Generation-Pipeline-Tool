// src/state.js
// Per-tab UI state autosave. Persists all form values across all 4 tabs
// to state.json next to config.txt.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function statePath() {
  try {
    return path.join(path.dirname(app.getPath('exe')), 'state.json');
  } catch {
    return path.join(process.cwd(), 'state.json');
  }
}

function read() {
  const p = statePath();
  if (!fs.existsSync(p)) return { tabs: {} };
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!raw || typeof raw !== 'object') return { tabs: {} };
    if (!raw.tabs) raw.tabs = {};
    return raw;
  } catch {
    return { tabs: {} };
  }
}

function write(s) {
  const p = statePath();
  // Preserve everything: tabs (per-tab form values), currentTab (last active
  // tab), fbDirs (per-tab output folder), and the upscale-on-Generate
  // toggle + settings. The previous version only persisted `tabs`, which
  // silently dropped the per-tab folder map and the last-active-tab on
  // every save.
  const clean = {
    tabs: (s && s.tabs && typeof s.tabs === 'object') ? s.tabs : {},
    currentTab: (s && typeof s.currentTab === 'string') ? s.currentTab : null,
    fbDirs: (s && s.fbDirs && typeof s.fbDirs === 'object') ? s.fbDirs : {},
    upscaleEnabled: !!(s && s.upscaleEnabled),
    // The upscale settings now include the auto-crop options. They're
    // surfaced in ⚙ Settings → Upscale Settings, captured by the
    // Image tab's "Add" button into the batch queue, and applied
    // by the image tab's generate handler when state.upscaleEnabled
    // is on. The renderer whitelists cropAnchorX/Y against the
    // anchor cell values; we double-check here too in case a
    // corrupted state.json tries to sneak an arbitrary string
    // through.
    upscaleSettings: (s && s.upscaleSettings && typeof s.upscaleSettings === 'object')
      ? {
          multiplier: parseInt(s.upscaleSettings.multiplier, 10) || 2,
          autoCrop: !!(s.upscaleSettings.autoCrop),
          cropWidth: Math.max(0, parseInt(s.upscaleSettings.cropWidth, 10) || 0),
          cropHeight: Math.max(0, parseInt(s.upscaleSettings.cropHeight, 10) || 0),
          cropAnchorX: ['left', 'center', 'right'].includes(s.upscaleSettings.cropAnchorX)
            ? s.upscaleSettings.cropAnchorX : 'center',
          cropAnchorY: ['top', 'center', 'bottom'].includes(s.upscaleSettings.cropAnchorY)
            ? s.upscaleSettings.cropAnchorY : 'center',
        }
      : { multiplier: 2, autoCrop: false, cropWidth: 0, cropHeight: 0, cropAnchorX: 'center', cropAnchorY: 'center' },
    // Real-ESRGAN model name (default: the general-purpose 4× BSD-3
    // model). Whitelisted in app.js to a known set so a corrupted
    // state.json can't inject a path-traversal arg into the spawn.
    realesrganModel: (typeof s?.realesrganModel === 'string' && s.realesrganModel.trim())
      ? s.realesrganModel.trim().slice(0, 64)
      : 'realesrgan-x4plus',
    // IS-Net background removal toggle. When true, the image tab's
    // generation handler and the right-click "Upscale" dialog will
    // run the optional isnetbg binary on the output. The standalone
    // right-click "Remove background" action does NOT depend on this
    // flag — it's an explicit user gesture every time.
    removeBackgroundEnabled: !!(s && s.removeBackgroundEnabled),
    // True = ask the binary to use the GPU (DirectML / CUDA / Vulkan,
    // whatever the binary supports); false = CPU. We coerce to a
    // boolean so a corrupted state.json can't sneak a string that
    // would be passed to --use-gpu as-is.
    removeBackgroundUseGpu: s?.removeBackgroundUseGpu === false ? false : true,
    // Global "Target file prefix" — prepended to every generated file's
    // name on all four tabs. Capped at 64 chars so a corrupted state.json
    // can't inject a long prefix. The renderer mirrors this string into
    // four inputs (one per tab) on every change. Without this field, the
    // user's prefix silently reset to "" on every app restart.
    filePrefix: (typeof s?.filePrefix === 'string')
      ? s.filePrefix.slice(0, 64)
      : '',
    // First-run prompt for the optional Real-ESRGAN binary. The
    // built-in multi-step canvas pipeline is always available, so the
    // prompt is informational only — but if the user dismisses it
    // once, we honour that and don't re-ask on every launch. Stored
    // here so the dismissal survives restarts.
    realesrganFirstRunDismissed: s?.realesrganFirstRunDismissed === true,
  };
  // Atomic write: write to a temp file then rename. Avoids a corrupt
  // state.json if the process is killed mid-write.
  const tmp = p + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(clean, null, 2), 'utf8');
  try {
    fs.renameSync(tmp, p);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  }
  return clean;
}

module.exports = { read, write, statePath };
