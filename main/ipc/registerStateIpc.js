// main/ipc/registerStateIpc.js
// IPC-Handler: `state:get` / `state:set` / `state:archiveRead` /
// `state:archiveClear` / `state:archiveSize` / `state:archiveDelete`.
// Persistenz der Tab-Settings (per-Tab-Folder, File-Prefix, Realesrgan-Model).

const { ipcMain } = require('electron');
const path = require('path');
const stateMod = require('../../src/state');
const { configDir } = require('../../src/config');
const archive = require('../../src/services/ArchiveService');

/**
 * @param {{ appRoot: string }} deps
 */
function register(_deps) {
  ipcMain.handle('state:get', () => {
    try { return stateMod.read(); }
    catch (e) { return {}; }
  });
  // v1.1 (audit BUG-R2-08 / SEC-06): the previous version
  // passed the renderer's payload straight to stateMod.write
  // without ANY top-level type check. The write() function
  // builds a `clean` object from a hard-coded schema so
  // unknown fields are dropped on disk — that's the second
  // layer of defence. The first layer (this handler) now
  // rejects payloads that aren't plain objects BEFORE write
  // is even called, so a renderer that sends "tabs" as a
  // string or "fbDirs" as a number fails fast with a clear
  // error instead of writing a half-broken state.json.
  ipcMain.handle('state:set', (_e, s) => {
    try {
      if (s != null && typeof s !== 'object') {
        return { ok: false, error: 'state payload must be a plain object.' };
      }
      if (Array.isArray(s)) {
        return { ok: false, error: 'state payload must be a plain object (got an array).' };
      }
      // The renderer's "tabs" sub-object is the biggest one; the
      // rest of the state is small enough to be a top-level
      // primitive. Sanitise the shape so a malformed payload
      // can't crash stateMod.write() deep inside a try/catch.
      if (s && s.tabs != null && (typeof s.tabs !== 'object' || Array.isArray(s.tabs))) {
        return { ok: false, error: 'state.tabs must be a plain object (tab id -> form values).' };
      }
      stateMod.write(s);
      return { ok: true };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
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
