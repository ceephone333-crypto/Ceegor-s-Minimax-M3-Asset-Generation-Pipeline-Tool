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
  // Bug-fix M2 (_temp5.md 360° audit): `config:set` used to return
  // `null` on a write failure, which crashed the Settings modal
  // (`saved.api_key = ...` on null) and the first-time-setup popup
  // (`state.config = null` then `refreshQuota` reads `.api_key`).
  // Return an envelope `{ ok, config, error }` so callers can branch
  // on ok without crashing. On failure, `config` is the re-read
  // previous config (the write didn't take) so assigning it back to
  // state.config is always safe; if even the re-read fails, fall
  // back to a minimal valid shape. The success return keeps the
  // full config object so existing callers that only use `.config`
  // keep working once they unwrap.
  ipcMain.handle('config:set', (_e, cfg) => {
    try {
      // v1.1 (audit BUG-R2-14): the type check happens BEFORE
      // sanitize so a non-object payload fails fast with a clear
      // error instead of being passed to sanitize (which would
      // throw a generic "Invalid payload" error). The previous
      // version passed any input straight to sanitize and the
      // renderer's `await api.setConfig(cfg)` would have
      // returned an opaque TypeError if `cfg` was null.
      if (cfg != null && (typeof cfg !== 'object' || Array.isArray(cfg))) {
        return { ok: false, config: cfgMod.read(), error: 'Config must be a plain object.' };
      }
      const safe = sanitize(cfg);
      cfgMod.write(safe);
      // API key changed → drop the cached voice list so the next
      // fetch hits the live API (or bundled voices.json as a
      // fallback) instead of returning a stale result.
      if (typeof voicesCache?.reset === 'function') {
        try { voicesCache.reset(); } catch { /* best-effort */ }
      }
      return { ok: true, config: cfgMod.read(), error: null };
    } catch (e) {
      // v1.1 (audit BUG-R2-14): the previous version's
      // hardcoded fallback
      //   prev = { api_key: '', output_dir: '', region: 'global',
      //            theme: 'dark', styles: [] }
      // was wrong in two ways:
      //   1. The user might have an existing api_key + output_dir
      //      on disk; returning `''` made the renderer's
      //      "API key field" appear empty even though the key
      //      is still saved on disk. The user would then think
      //      the save wiped their key and re-enter it.
      //   2. `styles: []` lost all of the user's saved styles
      //      in the same way.
      // We now use a richer fallback that calls cfgMod.read()
      // TWICE — once to get the actual on-disk state, and if
      // that fails (e.g. the config file was just corrupted by
      // a partial write), we fall back to a minimal shape that
      // is at least the documented contract of configSchema.
      let prev = null;
      try { prev = cfgMod.read(); } catch (_) { /* ignore */ }
      if (!prev || typeof prev !== 'object') {
        prev = { api_key: '', output_dir: '', region: 'global', theme: 'dark', styles: [] };
      }
      return { ok: false, config: prev, error: (e && e.message) || String(e) };
    }
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
