// main/ipc/registerImageIpc.js
// IPC-Handler: `image:optimize`.
// Wrapper um src/imageOptimizer.js (Sharp + libvips). Validiert Pfade
// gegen PathSecurityService.

const { ipcMain } = require('electron');
const pathUtils = require('../../src/pathUtils');
const imageOptimizer = require('../../src/imageOptimizer');
const pathSecurity = require('../services/PathSecurityService');

/**
 * @param {{ appRoot: string }} deps
 */
function register(_deps) {
  ipcMain.handle('image:optimize', async (_e, srcPath, opts) => {
    const empty = {
      ok: false, error: '', outputPath: null,
      inputSize: 0, outputSize: 0, savedBytes: 0, savedPercent: 0,
      format: '', width: 0, height: 0,
    };
    if (!srcPath || typeof srcPath !== 'string') {
      return { ...empty, error: 'Source path is required.' };
    }
    if (!pathUtils.isPathUnderAny(srcPath, pathSecurity.getAllowedRoots())) {
      return { ...empty, error: 'Source path is outside the allowed directories.' };
    }
    if (opts && opts.outputPath && typeof opts.outputPath === 'string'
        && !pathUtils.isPathUnderAny(opts.outputPath, pathSecurity.getAllowedRoots())) {
      return { ...empty, error: 'Destination path is outside the allowed directories.' };
    }
    return imageOptimizer.optimize(srcPath, opts || {});
  });
}

module.exports = { register };
