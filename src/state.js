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
    upscaleSettings: (s && s.upscaleSettings && typeof s.upscaleSettings === 'object')
      ? { multiplier: parseInt(s.upscaleSettings.multiplier, 10) || 2 }
      : { multiplier: 2 },
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
