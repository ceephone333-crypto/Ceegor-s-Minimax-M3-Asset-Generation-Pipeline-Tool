// src/audio/AudioRunner.js
// Low-level ffmpeg-Spawn-Wrapper. Resolved die Binary, kapselt stdout/stderr
// in eine Promise mit dem Standard-Shape { ok, code, stdout, stderr }.

const { spawn } = require('child_process');
const { findBinary } = require('./AudioBinary');

/**
 * @param {string[]} args        ffmpeg-Argumente (ohne -hide_banner/-nostdin).
 * @param {{ onSpawn?: (proc) => void }} [opts]
 * @returns {Promise<{ok: boolean, code: number, stdout: string, stderr: string}>}
 */
function runFFmpeg(args, opts = {}) {
  const bin = findBinary();
  if (!bin) {
    return Promise.resolve({
      ok: false,
      code: -1,
      stdout: '',
      stderr: 'ffmpeg binary not found (install ffmpeg-static or add ffmpeg.exe to PATH)',
    });
  }
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(bin, ['-hide_banner', '-nostdin', ...args], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      resolve({ ok: false, code: -1, stdout: '', stderr: String((e && e.message) || e) });
      return;
    }
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (b) => { stdout += b.toString('utf8'); });
    proc.stderr.on('data', (b) => { stderr += b.toString('utf8'); });
    proc.on('error', (e) => {
      resolve({ ok: false, code: -1, stdout, stderr: String((e && e.message) || e) });
    });
    proc.on('close', (code) => {
      resolve({ ok: code === 0, code, stdout, stderr });
    });
    if (opts.onSpawn) opts.onSpawn(proc);
  });
}

module.exports = { runFFmpeg };
