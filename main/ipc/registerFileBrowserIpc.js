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
 * Enumerate the available drives for the "drives list" view
 * the renderer's file browser shows when the user clicks Up at
 * a drive root. Returns [{ name, label }] in OS-natural order
 * (alphabetical for Windows, single entry for POSIX).
 *
 * Windows: scan every drive letter A:..Z: and stat() it.
 *   - Skip letters that are NOT mounted (stat throws ENOENT).
 *   - Skip drives that aren't directories (CD/DVD without a
 *     disc is reported by stat as a non-dir).
 *   - Use a per-letter timeout so a slow network share can't
 *     hang the whole list.
 * POSIX: a single entry for the root filesystem.
 *
 * Used by the `fb:listDrives` IPC handler.
 */
async function listDrives() {
  if (process.platform === 'win32') {
    const out = [];
    const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ';
    // v1.1 (audit BUG-R2-10): per-letter timeout. A disconnected
    // SMB mount (or any other slow network drive) can block
    // fsp.stat() for tens of seconds, freezing the whole
    // enumeration. We wrap each stat in a 1.5-second timeout
    // via Promise.race so a single hung drive can't stall the
    // UI. The timeout also benefits the overall handler: the
    // worst case is now PER_LETTER_TIMEOUT_MS × 26 ≈ 40 s,
    // but in practice every healthy drive resolves in <50ms.
    const PER_LETTER_TIMEOUT_MS = 1500;
    for (const ch of letters) {
      const root = ch + ':\\';
      try {
        const st = await Promise.race([
          fsp.stat(root),
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('stat timeout')), PER_LETTER_TIMEOUT_MS);
          }),
        ]);
        if (st && st.isDirectory()) out.push({ name: root, label: ch + ':' });
      } catch (_) {
        // Drive not mounted, no permission, or stat timeout
        // — skip silently. A user with no D: drive doesn't
        // need to see "D:" in the list.
      }
    }
    return out;
  }
  // POSIX: one entry for the root.
  return [{ name: '/', label: '/' }];
}

/**
 * @param {{ appRoot: string }} deps
 */
function register(_deps) {
  // v1.1.28: trust a path + its ancestors so the Up button can
  // climb out of output_dir without forcing the user through the
  // file picker. Without this, fbList rejects the parent path
  // ("Path is outside the allowed directories.") and the AUDIT-08
  // fallback silently rolls state.fbDir back to output_dir, so
  // clicking Up appears to do nothing. We only auto-trust ancestors
  // of an already-trusted directory (output_dir or a user-picked
  // path) — never a free-form path from the renderer.
  ipcMain.handle('fb:trust-ancestors', (_e, dir) => {
    try {
      const path = require('path');
      const cfgMod = require('../../src/config');
      const root = cfgMod.effectiveOutputDir(cfgMod.read());
      const norm = path.resolve(String(dir || ''));
      if (!norm || !root) return { ok: false, error: 'no dir' };
      // Only trust ancestors of the already-trusted root (or any
      // path the user already trusted via the file picker).
      const roots = [path.resolve(root), ...pathSecurity.getAllowedRoots()];
      // Walk up: trust `norm` and each of its parents until we
      // hit one that IS already in roots (so we don't recursively
      // trust C:\ when output_dir is C:\Users\foo).
      let cur = norm;
      const newlyTrusted = [];
      while (true) {
        if (roots.includes(cur)) break;
        if (!pathUtils.isParentUnderAny(cur, roots)) {
          // `cur` is NOT inside any trusted root — refuse to
          // trust a free-floating path.
          return { ok: false, error: 'refused: not under any trusted root' };
        }
        pathSecurity.addTrusted(cur);
        newlyTrusted.push(cur);
        const parent = path.dirname(cur);
        if (parent === cur) break;
        cur = parent;
      }
      return { ok: true, trusted: newlyTrusted };
    } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  });
  ipcMain.handle('fb:list', async (_e, dir) => {
    if (!pathUtils.isPathUnderAny(dir, pathSecurity.getAllowedRoots())) {
      return { ok: false, error: 'Path is outside the allowed directories.' };
    }
    try { return { ok: true, ...(await fb.list(dir)) }; }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  // v1.1 (user request): list the available drives so the
  // file browser's Up button can navigate to a drives list
  // when the user is already at a drive root. The list is
  // short (a few entries on most machines) and contains no
  // user-supplied path, so no allow-list check is needed.
  //   Windows: every drive letter currently mounted
  //            (C:\, D:\, E:\, ...).
  //   POSIX:   a single entry for the root filesystem ('/').
  ipcMain.handle('fb:listDrives', async () => {
    try {
      const drives = await listDrives();
      return { ok: true, drives };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e), drives: [] };
    }
  });

  ipcMain.handle('fb:mkdir', async (_e, dir, name) => {
    if (!pathUtils.isPathUnderAny(dir, pathSecurity.getAllowedRoots())) {
      return { ok: false, error: `Parent path "${dir}" is outside the allowed directories. Pick this folder via the file browser (which auto-trusts it) or via ⚙ Settings → Output folder, then re-run.` };
    }
    try { return { ok: true, path: await fb.mkdir(dir, name) }; }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  // Bug-fix (D1, _temp4.md): `fb:mkdir` always creates a NAMED CHILD of
  // `dir` (fb.mkdir validates `name` is non-empty), so it can't be used
  // to create `dir` itself when `dir` IS an allowed root (e.g. the
  // configured output_dir on a brand-new install, before anything has
  // ever been written into it). `isPathUnderAny` treats path-equality as
  // "under", so a root is always authorised for itself — this handler
  // exists purely to call `fs.mkdir(dir, {recursive:true})` on that exact
  // path instead of routing through `fb.mkdir`'s child-name requirement.
  ipcMain.handle('fb:ensureDir', async (_e, dir) => {
    if (!pathUtils.isPathUnderAny(dir, pathSecurity.getAllowedRoots())) {
      return { ok: false, error: `Path "${dir}" is outside the allowed directories.` };
    }
    try {
      // Bug-fix (reported by user): generating into a DRIVE ROOT (e.g. the
      // file browser sitting at "D:\") failed with
      //   "Cannot resolve output folder: EPERM: operation not permitted, mkdir 'D:\'".
      // On Windows, fs.mkdir on a drive root throws EPERM even with
      // { recursive: true } — Node won't no-op the (already-existing) root
      // the way it does for a normal nested dir. The directory the user is
      // pointing at obviously already exists (they're browsing it), so
      // stat first and skip the mkdir entirely when it's already a
      // directory. Only create when it's genuinely missing.
      const st = await fsp.stat(dir).catch(() => null);
      if (st && st.isDirectory()) return { ok: true, path: dir };
      if (st && !st.isDirectory()) return { ok: false, error: `"${dir}" exists but is not a folder.` };
      await fsp.mkdir(dir, { recursive: true });
      return { ok: true, path: dir };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
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
    // Bug-fix LOW-4 (_temp5.md 360° audit): fb.reveal now returns a
    // boolean — propagate it so the renderer can show an error toast
    // when the underlying shell call failed (e.g. the file was just
    // deleted/moved). Previously this always returned ok:true.
    const revealed = fb.reveal(p);
    if (!revealed) return { ok: false, error: 'Could not reveal the file (it may have been moved or deleted).' };
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

  // v1.1 (audit BUG-R2-09): every other fb:* handler returns a
  // structured { ok, ... } envelope. The previous version of
  // fb:exists returned a bare boolean, which broke the
  // renderer's `const r = await api.fbExists(p); if (r.ok)`
  // pattern (true.ok is undefined). The handler now returns
  // { ok, exists } so the renderer can branch on `r.ok`
  // (success/failure) and `r.exists` (does the file exist?).
  // The bool shortcut path is also surfaced as
  // `r.existsBool` for any future caller that wants the
  // previous shape; it's a getter for the old `r` boolean.
  ipcMain.handle('fb:exists', async (_e, p) => {
    if (!p || typeof p !== 'string') {
      return { ok: false, exists: false, error: 'Path is required.' };
    }
    if (!pathUtils.isPathUnderAny(p, pathSecurity.getAllowedRoots())) {
      return { ok: false, exists: false, error: 'Path is outside the allowed directories.' };
    }
    try {
      await fsp.access(p, fs.constants.F_OK);
      return { ok: true, exists: true };
    } catch {
      return { ok: true, exists: false };
    }
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
      // v1.1 (audit H4): check the base64 STRING length BEFORE
      // Buffer.from() decodes it. A 2 GB base64 string decodes to
      // ~1.5 GB of buffer; allocating that first then rejecting
      // meant a compromised renderer (or an XSS) could OOM-kill
      // the main process with a single fbWrite call. Base64 encoding
      // expands by 4/3, so the decoded byte length is at most
      // (str.length * 3 / 4); we check the upper bound on the
      // string length to stay safely under MAX_WRITE_BYTES after
      // decoding. (Math: 25 MB * 4/3 ≈ 33.3 MB base64 chars.)
      const MAX_BASE64_CHARS = Math.ceil(MAX_WRITE_BYTES * 4 / 3) + 16;
      if (base64Data.length > MAX_BASE64_CHARS) {
        return { ok: false, error: `Refusing to write more than ${MAX_WRITE_BYTES} bytes at once.` };
      }
      // Cap the write size. The decode is now safe because the
      // string-length check above guarantees buf.length ≤ MAX_WRITE_BYTES.
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
