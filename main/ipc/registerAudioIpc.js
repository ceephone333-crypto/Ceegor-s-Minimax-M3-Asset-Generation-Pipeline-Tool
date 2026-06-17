// main/ipc/registerAudioIpc.js
// IPC-Handler: `audio:*` (available, probe, decodePeaks, findZeroCrossing,
// trimSilence, cut). Treibt den Right-Click "✂ Audio cut…" Dialog.
// Pfad-Argumente durch main/services/PathSecurityService.js validiert.

const { ipcMain } = require('electron');
const path = require('path');
const audioCutter = require('../../src/audioCutter');
const pathUtils = require('../../src/pathUtils');
const pathSecurity = require('../services/PathSecurityService');

/**
 * @param {{ appRoot: string }} deps
 */
function register(_deps) {
  ipcMain.handle('audio:available', () => {
    return { available: audioCutter.isAvailable(), path: audioCutter.findBinary() };
  });

  ipcMain.handle('audio:probe', async (_e, srcPath) => {
    if (!srcPath || typeof srcPath !== 'string') {
      return { ok: false, error: 'Source path is required.' };
    }
    if (!pathUtils.isPathUnderAny(srcPath, pathSecurity.getAllowedRoots())) {
      return { ok: false, error: 'Source path is outside the allowed directories.' };
    }
    try { return await audioCutter.probe(srcPath); }
    catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  });

  ipcMain.handle('audio:decodePeaks', async (_e, srcPath, opts) => {
    if (!srcPath || typeof srcPath !== 'string') {
      return { ok: false, error: 'Source path is required.' };
    }
    if (!pathUtils.isPathUnderAny(srcPath, pathSecurity.getAllowedRoots())) {
      return { ok: false, error: 'Source path is outside the allowed directories.' };
    }
    try {
      const r = await audioCutter.decodePeaks(srcPath, opts || {});
      // Float32Array / buffers don't survive IPC structured-clone as
      // typed arrays — we serialise them to a plain array + an extra
      // peakAbsMax field the renderer can pre-normalise with.
      if (r && r.ok && r.peaks && typeof r.peaks === 'object' && 'length' in r.peaks) {
        r.peaks = Array.from(r.peaks);
      }
      if (r && r.ok && r.pcm && typeof r.pcm === 'object' && 'length' in r.pcm) {
        r.pcm = Array.from(r.pcm);
      }
      return r;
    } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  });

  ipcMain.handle('audio:findZeroCrossing', async (_e, pcm, targetSample, window) => {
    // The PCM comes back from the renderer as a plain array (the IPC
    // marshal round-trip strips typed-array-ness). We restore it here.
    let arr = pcm;
    if (arr && !Array.isArray(arr) && typeof arr.length === 'number') {
      arr = Array.from(arr);
    }
    if (!Array.isArray(arr)) return { ok: false, error: 'PCM data required.' };
    try {
      const f32 = new Float32Array(arr);
      const idx = audioCutter.findZeroCrossing(f32, targetSample | 0, window | 0);
      return { ok: true, index: idx };
    } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  });

  ipcMain.handle('audio:trimSilence', async (_e, srcPath, opts) => {
    if (!srcPath || typeof srcPath !== 'string') {
      return { ok: false, error: 'Source path is required.' };
    }
    if (!pathUtils.isPathUnderAny(srcPath, pathSecurity.getAllowedRoots())) {
      return { ok: false, error: 'Source path is outside the allowed directories.' };
    }
    try { return await audioCutter.trimSilence(srcPath, opts || {}); }
    catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  });

  ipcMain.handle('audio:cut', async (_e, srcPath, dstPath, opts) => {
    if (!srcPath || typeof srcPath !== 'string') {
      return { ok: false, error: 'Source path is required.' };
    }
    if (!dstPath || typeof dstPath !== 'string') {
      return { ok: false, error: 'Destination path is required.' };
    }
    if (!pathUtils.isPathUnderAny(srcPath, pathSecurity.getAllowedRoots())) {
      return { ok: false, error: 'Source path is outside the allowed directories.' };
    }
    if (!pathUtils.isParentUnderAny(dstPath, pathSecurity.getAllowedRoots())) {
      return { ok: false, error: 'Destination path is outside the allowed directories.' };
    }
    // Refuse to overwrite the source file.
    const srcAbs = pathUtils.normalize(srcPath);
    const dstAbs = pathUtils.normalize(dstPath);
    if (srcAbs && dstAbs && srcAbs.toLowerCase() === dstAbs.toLowerCase()) {
      return { ok: false, error: 'Destination must differ from the source.' };
    }
    try { return await audioCutter.cut(srcPath, dstPath, opts || {}); }
    catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  });

  // `path` import remains in DI scope for future audio-output dirs.
  void path;
}

module.exports = { register };
