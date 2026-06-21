// main/ipc/registerUpscaleIpc.js
// IPC-Handler: `upscale:realesrgan:available` / `:run` / `:download`.

const { ipcMain } = require('electron');
const pathUtils = require('../../src/pathUtils');
const reEsrgan = require('../../src/realesrgan');
const pathSecurity = require('../services/PathSecurityService');
const { downloadRealesrgan } = require('../services/InstallDownloadService');

/**
 * @param {{ getMainWindow: () => (Electron.BrowserWindow|null), appRoot: string }} deps
 */
function register({ getMainWindow, appRoot }) {
  ipcMain.handle('upscale:realesrgan:available', () => {
    const available = reEsrgan.isAvailable();
    return {
      available,
      binaryPath: available ? reEsrgan.getBinaryPath() : null,
      version: available ? reEsrgan.probeVersion() : '',
    };
  });

  ipcMain.handle('upscale:realesrgan:run', async (_e, srcPath, dstPath, opts) => {
    if (!pathUtils.isPathUnderAny(srcPath, pathSecurity.getAllowedRoots())) {
      return { ok: false, code: -1, stderr: 'Source path is outside the allowed directories.', outputPath: null };
    }
    if (!pathUtils.isPathUnderAny(dstPath, pathSecurity.getAllowedRoots())) {
      return { ok: false, code: -1, stderr: 'Destination path is outside the allowed directories.', outputPath: null };
    }
    try {
      return await reEsrgan.run(srcPath, dstPath, opts || {});
    } catch (e) {
      return { ok: false, code: -1, stderr: String((e && e.message) || e), outputPath: null };
    }
  });

  ipcMain.handle('upscale:realesrgan:download', async (event) => {
    try {
      const win = event.sender;
      const send = (data) => { try { win.send('upscale:realesrgan:download:progress', data); } catch (_) {} };
      const r = await downloadRealesrgan(appRoot, send);
      // Reset the binary detector cache so the next probe sees the
      // newly-extracted binary.
      try { reEsrgan.resetCache && reEsrgan.resetCache(); } catch (_) {}
      return r;
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  });
}

module.exports = { register };
