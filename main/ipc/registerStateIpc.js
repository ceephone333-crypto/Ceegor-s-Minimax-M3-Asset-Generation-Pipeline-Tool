// main/ipc/registerStateIpc.js
// IPC-Handler: `state:get` / `state:set`.
// Persistenz der Tab-Settings (per-Tab-Folder, File-Prefix, Realesrgan-Model).

const { ipcMain } = require('electron');
const stateMod = require('../../src/state');

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
}

module.exports = { register };
