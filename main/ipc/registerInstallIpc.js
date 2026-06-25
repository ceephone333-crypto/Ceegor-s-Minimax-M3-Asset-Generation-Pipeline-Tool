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
    // v1.1 (audit BUG-R2-01): defense-in-depth. The sanitizer
    // is the AUTHORITATIVE gate — anything not passing it is
    // dropped on the floor before we even think about handing
    // it to the OS. We re-ran sanitizeUrl() a second time
    // right before shell.openExternal as an extra guard
    // against renderer-side mutation, but the audit
    // (_temp9.md OBS-2) noted that a second call against the
    // SAME `url` string is meaningless (sanitizeUrl is
    // pure); it only catches a TOCTOU window if some
    // untrusted code mutated `url` between the two calls,
    // and the renderer is already sandboxed. Removed the
    // duplicate check — one authoritative call, then hand
    // the URL to the OS (which has its own protocol/handler
    // validation).
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
