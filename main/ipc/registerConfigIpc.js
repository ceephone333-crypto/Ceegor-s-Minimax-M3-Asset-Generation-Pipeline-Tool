// main/ipc/registerConfigIpc.js
// IPC-Handler: `config:get` / `config:set` / `config:path` / `config:pickFolder`.
// Schreibt nur sanitierte Felder (main/models/ConfigSchema.js).

const { ipcMain, dialog } = require('electron');

const cfgMod = require('../../src/config');
const { sanitize } = require('../models/ConfigSchema');
const pathSecurity = require('../services/PathSecurityService');

/**
 * @param {{ getMainWindow: () => (Electron.BrowserWindow|null) }} deps
 */
function register({ getMainWindow }) {
  ipcMain.handle('config:get', () => {
    try { return cfgMod.read(); } catch (e) { return null; }
  });
  ipcMain.handle('config:set', (_e, cfg) => {
    try {
      const safe = sanitize(cfg);
      cfgMod.write(safe);
      return cfgMod.read();
    } catch (e) { return null; }
  });
  ipcMain.handle('config:path', () => {
    try { return cfgMod.configPath(); } catch (e) { return null; }
  });
  ipcMain.handle('config:pickFolder', async () => {
    try {
      const win = getMainWindow();
      const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
      if (r.canceled || !r.filePaths.length) return null;
      // Remember the picked path so the file browser can write / move into
      // it later (it's the only way the main process learns about a folder
      // the user authorised outside `output_dir`).
      pathSecurity.addTrusted(r.filePaths[0]);
      return r.filePaths[0];
    } catch (e) { return null; }
  });
}

module.exports = { register };
