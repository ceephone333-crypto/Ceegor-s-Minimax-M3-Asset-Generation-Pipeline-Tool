// main/ipc/registerFilePickerIpc.js
// IPC-Handler: `file:pick` (Browse-Button). Validiert Filter/Titel und
// fügt den gewählten Pfad den trustedPickPaths hinzu.

const { ipcMain, dialog } = require('electron');
const pathSecurity = require('../services/PathSecurityService');

const TITLE_MAX = 200;
const FILTER_NAME_MAX = 100;
const FILTER_EXT_MAX = 20;
const FILTERS_MAX = 20;

/**
 * @param {{ getMainWindow: () => (Electron.BrowserWindow|null) }} deps
 */
function register({ getMainWindow }) {
  ipcMain.handle('file:pick', async (_e, opts) => {
    try {
      opts = opts || {};
      const title = typeof opts.title === 'string' ? opts.title.slice(0, TITLE_MAX) : 'Select file';
      const filters = Array.isArray(opts.filters) && opts.filters.length
        ? opts.filters
            .filter((f) => f && typeof f === 'object' && typeof f.name === 'string' && Array.isArray(f.extensions))
            .slice(0, FILTERS_MAX)
            .map((f) => ({
              name: String(f.name).slice(0, FILTER_NAME_MAX),
              extensions: f.extensions.map((e) => String(e).slice(0, FILTER_EXT_MAX)),
            }))
        : [{ name: 'All files', extensions: ['*'] }];
      const r = await dialog.showOpenDialog(getMainWindow(), {
        title,
        properties: ['openFile'],
        filters,
      });
      if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
      pathSecurity.addTrusted(r.filePaths[0]);
      return { ok: true, path: r.filePaths[0] };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  });
}

module.exports = { register };
