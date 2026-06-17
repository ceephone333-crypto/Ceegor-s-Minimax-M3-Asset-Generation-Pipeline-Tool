// main/ipc/registerIsnetbgIpc.js
// IPC-Handler: `isnetbg:available` / `isnetbg:run`.
// Pfad-Argumente durch main/services/PathSecurityService.js validiert.

const { ipcMain } = require('electron');
const pathUtils = require('../../src/pathUtils');
const isNetBg = require('../../src/isnetbg');
const pathSecurity = require('../services/PathSecurityService');

/**
 * @param {{ appRoot: string }} deps
 */
function register(_deps) {
  ipcMain.handle('isnetbg:available', () => {
    const available = isNetBg.isAvailable();
    const binaryPath = available ? isNetBg.getBinaryPath() : null;
    const modelPath = isNetBg.getModelPath();
    const version = available ? isNetBg.probeVersion() : '';
    return {
      available,
      binaryPath,
      modelPath,
      // Distinct from `available`: the binary can be present while the
      // model file is missing. The UI uses this to show a precise
      // "binary installed, but model missing" hint instead of failing
      // silently at run time.
      modelPresent: !!modelPath,
      version,
    };
  });

  ipcMain.handle('isnetbg:run', async (_e, srcPath, dstPath, opts) => {
    if (!pathUtils.isPathUnderAny(srcPath, pathSecurity.getAllowedRoots())) {
      return { ok: false, code: -1, stderr: 'Source path is outside the allowed directories.', outputPath: null };
    }
    if (!pathUtils.isPathUnderAny(dstPath, pathSecurity.getAllowedRoots())) {
      return { ok: false, code: -1, stderr: 'Destination path is outside the allowed directories.', outputPath: null };
    }
    return isNetBg.run(srcPath, dstPath, opts || {});
  });
}

module.exports = { register };
