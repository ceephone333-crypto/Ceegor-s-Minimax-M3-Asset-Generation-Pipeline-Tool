// main/ipc/registerStateIpc.js
// IPC-Handler: `state:get` / `state:set` / `state:archiveRead` /
// `state:archiveClear` / `state:archiveSize` / `state:archiveDelete`.
// Persistenz der Tab-Settings (per-Tab-Folder, File-Prefix, Realesrgan-Model).

const { ipcMain } = require('electron');
const path = require('path');
const stateMod = require('../../src/state');
const { configDir } = require('../../src/config');
const archive = require('../services/ArchiveService');

/**
 * @param {{ appRoot: string }} deps
 */
function register(_deps) {
  ipcMain.handle('state:get', () => {
    try { return stateMod.read(); }
    catch (e) { return {}; }
  });
  ipcMain.handle('state:set', (_e, s) => {
    try { stateMod.write(s); return { ok: true }; }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
  });
  // Phase C: archive IPCs. All four return { ok, ... } envelopes.
  ipcMain.handle('state:archiveRead', (_e, opts) => {
    try {
      const r = archive.readChunk(configDir(), opts || {});
      return { ok: true, ...r };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });
  ipcMain.handle('state:archiveClear', () => {
    try { const removed = archive.clear(configDir()); return { ok: true, removedBytes: removed }; }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
  });
  ipcMain.handle('state:archiveSize', () => {
    try { return { ok: true, bytes: archive.size(configDir()) }; }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
  });
  ipcMain.handle('state:archiveDelete', (_e, payload) => {
    try {
      const id = payload && payload.id;
      const removed = archive.deleteOne(configDir(), id);
      return { ok: true, removed };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });
}

module.exports = { register };
