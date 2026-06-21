// main/ipc/registerFileBrowserIpc.js
// IPC-Handler: `fb:*` (list, mkdir, rename, delete, move, copy, reveal,
// read, exists, write). ALLE Pfad-Argumente durch PathSecurityService.

const { ipcMain } = require('electron');
const fsp = require('fs').promises;
const fs = require('fs');
const fb = require('../../src/fileBrowser');
const pathUtils = require('../../src/pathUtils');
const pathSecurity = require('../services/PathSecurityService');

const MAX_WRITE_BYTES = 25 * 1024 * 1024;

/**
 * @param {{ appRoot: string }} deps
 */
function register(_deps) {
  ipcMain.handle('fb:list', async (_e, dir) => {
    if (!pathUtils.isPathUnderAny(dir, pathSecurity.getAllowedRoots())) {
      return { ok: false, error: 'Path is outside the allowed directories.' };
    }
    try { return { ok: true, ...(await fb.list(dir)) }; }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  ipcMain.handle('fb:mkdir', async (_e, dir, name) => {
    if (!pathUtils.isPathUnderAny(dir, pathSecurity.getAllowedRoots())) {
      return { ok: false, error: `Parent path "${dir}" is outside the allowed directories. Pick this folder via the file browser (which auto-trusts it) or via ⚙ Settings → Output folder, then re-run.` };
    }
    try { return { ok: true, path: await fb.mkdir(dir, name) }; }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  ipcMain.handle('fb:rename', async (_e, p, newName) => {
    if (!pathUtils.isPathUnderAny(p, pathSecurity.getAllowedRoots())) {
      return { ok: false, error: 'Source path is outside the allowed directories.' };
    }
    try { return { ok: true, path: await fb.rename(p, newName) }; }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  ipcMain.handle('fb:delete', async (_e, p) => {
    if (!pathUtils.isPathUnderAny(p, pathSecurity.getAllowedRoots())) {
      return { ok: false, error: 'Path is outside the allowed directories.' };
    }
    try { return { ok: true, path: await fb.deletePath(p) }; }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  ipcMain.handle('fb:move', async (_e, src, destDir) => {
    if (!pathUtils.isPathUnderAny(src, pathSecurity.getAllowedRoots())) {
      return { ok: false, error: 'Source path is outside the allowed directories.' };
    }
    if (!pathUtils.isPathUnderAny(destDir, pathSecurity.getAllowedRoots())) {
      return { ok: false, error: 'Destination path is outside the allowed directories.' };
    }
    try { return { ok: true, path: await fb.moveTo(src, destDir) }; }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  ipcMain.handle('fb:copy', async (_e, src, destDir) => {
    if (!pathUtils.isPathUnderAny(src, pathSecurity.getAllowedRoots())) {
      return { ok: false, error: 'Source path is outside the allowed directories.' };
    }
    if (!pathUtils.isPathUnderAny(destDir, pathSecurity.getAllowedRoots())) {
      return { ok: false, error: 'Destination path is outside the allowed directories.' };
    }
    try { return { ok: true, path: await fb.copyTo(src, destDir) }; }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  ipcMain.handle('fb:reveal', (_e, p) => {
    if (!pathUtils.isPathUnderAny(p, pathSecurity.getAllowedRoots())) {
      return { ok: false, error: 'Path is outside the allowed directories.' };
    }
    fb.reveal(p);
    return { ok: true };
  });

  // v1.1.15 (reported by user): open a NEW Windows Explorer
  // window at the file's parent folder. The previous
  // "Reveal in Explorer" action (fb:reveal) only highlights
  // the file in an existing window via shell.showItemInFolder;
  // the user explicitly asked for the standard Windows
  // "Open in Explorer" shell verb, which opens a fresh
  // Explorer window at the containing folder. Same
  // allow-list as the rest of the fb:* handlers.
  ipcMain.handle('fb:openInExplorer', async (_e, p) => {
    if (!pathUtils.isPathUnderAny(p, pathSecurity.getAllowedRoots())) {
      return { ok: false, error: 'Path is outside the allowed directories.' };
    }
    try {
      await fb.openInExplorer(p);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  });

  ipcMain.handle('fb:read', async (_e, p) => {
    if (!pathUtils.isPathUnderAny(p, pathSecurity.getAllowedRoots())) {
      return { ok: false, error: 'Path is outside the allowed directories.' };
    }
    try {
      const buf = await fb.readFile(p);
      return { ok: true, base64: buf.toString('base64') };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  ipcMain.handle('fb:exists', async (_e, p) => {
    if (!p || typeof p !== 'string') return false;
    if (!pathUtils.isPathUnderAny(p, pathSecurity.getAllowedRoots())) return false;
    try { await fsp.access(p, fs.constants.F_OK); return true; }
    catch { return false; }
  });

  ipcMain.handle('fb:write', async (_e, outPath, base64Data) => {
    try {
      if (!outPath || typeof outPath !== 'string') {
        return { ok: false, error: 'Output path is required.' };
      }
      if (!base64Data || typeof base64Data !== 'string') {
        return { ok: false, error: 'Base64 data is required.' };
      }
      // Resolve the path FIRST so any `..` segments collapse to the
      // directory the OS will actually see.
      const outAbs = pathUtils.normalize(outPath);
      if (!outAbs) return { ok: false, error: 'Output path is invalid.' };
      if (!pathUtils.isParentUnderAny(outAbs, pathSecurity.getAllowedRoots())) {
        return { ok: false, error: 'Refusing to write outside the output directory.' };
      }
      // Cap the write size.
      const buf = Buffer.from(base64Data, 'base64');
      if (buf.length > MAX_WRITE_BYTES) {
        return { ok: false, error: `Refusing to write more than ${MAX_WRITE_BYTES} bytes at once.` };
      }
      // Atomic write: tmp + rename.
      const tmp = outAbs + '.tmp-' + process.pid + '-' + Date.now();
      await fsp.writeFile(tmp, buf);
      try {
        await fsp.rename(tmp, outAbs);
      } catch (renameErr) {
        try { await fsp.unlink(tmp); } catch {}
        throw renameErr;
      }
      return { ok: true, path: outAbs };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });
}

module.exports = { register };
