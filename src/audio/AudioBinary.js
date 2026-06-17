// src/audio/AudioBinary.js
// Auflösung des ffmpeg-Binärpfads. Cache, damit wiederholte Probes
// den Filesystem nicht unnötig belasten.

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

let cachedBinaryPath = null;

function findBinary() {
  if (cachedBinaryPath && fs.existsSync(cachedBinaryPath)) return cachedBinaryPath;

  // 1. Bundled binary from `ffmpeg-static`. The package returns the
  // absolute path to the prebuilt exe on the current platform.
  try {
    const bundled = require('ffmpeg-static');
    if (bundled && fs.existsSync(bundled)) {
      cachedBinaryPath = bundled;
      return bundled;
    }
  } catch (_) { /* not installed */ }

  // 2. Dev fallback: `where ffmpeg` / `which ffmpeg` on PATH.
  try {
    const whichCmd = process.platform === 'win32' ? 'where' : 'which';
    const r = spawnSync(whichCmd, ['ffmpeg'], { encoding: 'utf8', windowsHide: true });
    if (r.status === 0 && r.stdout) {
      const found = r.stdout.split(/\r?\n/).map((s) => s.trim()).find((s) => s && fs.existsSync(s));
      if (found) {
        cachedBinaryPath = found;
        return found;
      }
    }
  } catch (_) { /* ignore */ }

  // 3. Production fallback: ./bin/ffmpeg[.exe] next to the package root.
  try {
    const candidates = [
      path.join(__dirname, '..', '..', 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
      process.resourcesPath ? path.join(process.resourcesPath, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg') : null,
    ].filter(Boolean);
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        cachedBinaryPath = p;
        return p;
      }
    }
  } catch (_) { /* ignore */ }

  return null;
}

function isAvailable() {
  return !!findBinary();
}

function resetCache() {
  cachedBinaryPath = null;
}

module.exports = { findBinary, isAvailable, resetCache };
