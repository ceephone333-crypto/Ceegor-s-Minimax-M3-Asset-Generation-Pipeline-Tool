// main/ipc/registerConfigIpc.js
// IPC-Handler: `config:get` / `config:set` / `config:path` / `config:pickFolder`.
// Schreibt nur sanitierte Felder (main/models/ConfigSchema.js).

const { ipcMain, dialog } = require('electron');

const cfgMod = require('../../src/config');
const { sanitize } = require('../models/ConfigSchema');
const pathSecurity = require('../services/PathSecurityService');
// Bug-fix #9 (2026-06-19): wire voicesCache.reset() into
// config:set so a user who swaps API keys (or switches between
// Token Plan and PAYG) sees the new key's voice list on the
// next call to mmx speech voices — previously the cache was
// keyed by api_key but never invalidated, so the stale voices
// silently stuck around until app restart.
const voicesCache = require('../services/VoicesCacheService');

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
      // API key changed → drop the cached voice list so the next
      // fetch hits the live API (or bundled voices.json as a
      // fallback) instead of returning a stale result.
      if (typeof voicesCache?.reset === 'function') {
        try { voicesCache.reset(); } catch { /* best-effort */ }
      }
      return cfgMod.read();
    } catch (e) { return null; }
  });
  ipcMain.handle('config:path', () => {
    try { return cfgMod.configPath(); } catch (e) { return null; }
  });
  // Bug-fix (2026-06-19): return the resolved default output
  // directory (which encodes the same `<userData>/generated`
  // fallback as the main process's `effectiveOutputDir()`). The
  // renderer needs this at init() time so a fresh launch with a
  // blank output_dir can still pre-populate the in-memory
  // state.config.output_dir and the file browser can land on a
  // real, writable directory instead of throwing "no output dir"
  // when the user clicks Generate. Without this IPC the renderer
  // had to fake a default by appending "/generated" to the
  // config.txt path — which (a) is the exe dir for packaged
  // builds (not what the user asked for) and (b) doesn't exist.
  ipcMain.handle('config:defaultOutputDir', () => {
    try { return cfgMod.defaultOutputDir(); } catch (e) { return null; }
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
