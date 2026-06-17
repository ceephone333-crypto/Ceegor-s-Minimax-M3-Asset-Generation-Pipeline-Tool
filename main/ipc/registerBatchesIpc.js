// main/ipc/registerBatchesIpc.js
// IPC-Handler: `batches:get` / `batches:set`.
// Speicherung als separate JSON-Datei neben config.txt.

const { ipcMain } = require('electron');
const batchMod = require('../../src/batches');

/**
 * @param {{ appRoot: string }} deps
 */
function register(_deps) {
  ipcMain.handle('batches:get', () => batchMod.read());
  ipcMain.handle('batches:set', (_e, batches) => {
    try { batchMod.write(batches); return { ok: true }; }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
  });
}

module.exports = { register };
