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
