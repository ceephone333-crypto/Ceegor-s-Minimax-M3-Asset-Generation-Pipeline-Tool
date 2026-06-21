// main/ipc/registerInstallIpc.js
// IPC-Handler: `install:openUrl` / `install:pickAndCopy`.
// Optional-Addons-Popup: URL öffnen + Universal-Pick-File-Fallback.

const { ipcMain, dialog, shell } = require('electron');
const reEsrgan = require('../../src/realesrgan');
const isNetBg = require('../../src/isnetbg');
const { sanitize: sanitizeUrl } = require('../utils/UrlSanitizer');
const { pickAndCopy } = require('../services/InstallPickCopyService');

/**
 * @param {{ getMainWindow: () => (Electron.BrowserWindow|null), appRoot: string }} deps
 */
function register({ getMainWindow, appRoot }) {
  ipcMain.handle('install:openUrl', async (_e, url) => {
    const r = sanitizeUrl(url);
    if (!r.ok) return r;
    try {
      await shell.openExternal(url);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  });

  ipcMain.handle('install:pickAndCopy', async (event, kind) => {
    try {
      const win = event.sender;
      const showOpenDialog = (opts) => dialog.showOpenDialog(win, opts);
      const r = await pickAndCopy(kind, showOpenDialog, appRoot);
      // Reset detector cache so the next probe sees the new file.
      if (r && r.ok) {
        try { reEsrgan.resetCache && reEsrgan.resetCache(); } catch (_) {}
        try { isNetBg.resetCache && isNetBg.resetCache(); } catch (_) {}
      }
      return r;
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  });
}

module.exports = { register };
