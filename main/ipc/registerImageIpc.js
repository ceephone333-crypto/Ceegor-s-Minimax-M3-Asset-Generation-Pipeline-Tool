// main/ipc/registerImageIpc.js
// IPC-Handler: `image:optimize`.
// Wrapper um src/imageOptimizer.js (Sharp + libvips). Validiert Pfade
// gegen PathSecurityService.

const { ipcMain } = require('electron');
const fsp = require('fs').promises;
const fs = require('fs');
const path = require('path');
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
    try {
      return await imageOptimizer.optimize(srcPath, opts || {});
    } catch (e) {
      return { ...empty, error: String((e && e.message) || e) };
    }
  });

  // bug-fix M6 (_temp4.md): mmx hardcodes the image tab's output
  // extension to .png, but the CDN bytes it downloads are sometimes
  // JPEG. Called right after a successful generation so the on-disk
  // name always matches the real content.
  ipcMain.handle('image:fixExtension', async (_e, filePath) => {
    const empty = { ok: false, path: filePath, renamed: false, error: '' };
    if (!filePath || typeof filePath !== 'string') {
      return { ...empty, error: 'Path is required.' };
    }
    if (!pathUtils.isPathUnderAny(filePath, pathSecurity.getAllowedRoots())) {
      return { ...empty, error: 'Path is outside the allowed directories.' };
    }
    try {
      return await imageOptimizer.fixExtensionToMatchContent(filePath);
    } catch (e) {
      return { ...empty, error: String((e && e.message) || e) };
    }
  });

  // Bug-fix (reported by user): a --subject-ref reference image that no
  // longer exists on disk made the image tab spawn mmx (which failed with
  // a cryptic "File system error: ENOENT … reference.jpeg") and then
  // retry it 4×. The renderer pre-flights the reference path through this
  // handler so it can show a clear "Reference image not found" message
  // and never spawn a doomed run.
  //
  // v1.1 (audit BUG-R2-07 / SEC-02): the previous version was an
  // unrestricted filesystem existence oracle — a compromised renderer
  // could probe for ANY file on the system (C:\Windows\System32\…,
  // ~/.ssh/id_rsa, etc.) and learn whether it exists. The handler is
  // now restricted to paths that look like a real local image file:
  //   1. Must be an absolute path (no relative paths — the user
  //      provides the full path when picking a reference image).
  //   2. Must have an image-like extension (the renderer only ever
  //      asks about image references for --subject-ref).
  //   3. The normalised path must NOT be under a system-only
  //      directory (Windows, Program Files, /etc, ~/.ssh, etc.) —
  //      a reference image is a USER file.
  // http(s) URLs are still accepted as "exists" (the API server
  // validates them, not the filesystem).
  ipcMain.handle('image:refExists', async (_e, p) => {
    if (!p || typeof p !== 'string') return { ok: true, exists: false };
    const trimmed = p.trim();
    // http(s) references are validated by the API server, not the
    // filesystem — report them as "exists" so the renderer doesn't block
    // a valid URL.
    if (/^https?:\/\//i.test(trimmed)) return { ok: true, exists: true, url: true };
    // The path must look like an absolute local path with an image
    // extension. This filter is intentionally lenient on extension
    // (so a JPEG saved with a .jpg / .jpeg / .JPG all work) and
    // strict on shape (must be absolute, must have an image ext).
    const imgExtRe = /\.(png|jpe?g|webp|gif|bmp|tiff?|heic|heif|avif)$/i;
    if (!path.isAbsolute(trimmed) || !imgExtRe.test(trimmed)) {
      return { ok: true, exists: false, reason: 'not an absolute image path' };
    }
    const abs = pathUtils.normalize(trimmed);
    if (!abs) return { ok: true, exists: false };
    // v1.1 (SEC-02): explicitly block well-known sensitive
    // directories. The check is by segment, not by full-string
    // match, so a nested path like
    //   "C:\Users\me\Documents\Windows\photo.jpg"
    // is still allowed (the "Windows" segment there is just a
    // folder name, not the system directory). We only block
    // paths whose FIRST non-drive component is one of the
    // sensitive names.
    const sensitiveRootRe = /^(?:[A-Za-z]:[\\\/])?(Windows|Program Files(?: \(x86\))?|ProgramData|System32|SysWOW64|etc|private|var\/lib|root|home\/[^\\/]+[\\\/]\.(?:ssh|aws|gnupg)|Users[\\\/][^\\/]+[\\\/]\.(?:ssh|aws|gnupg)|Users[\\\/][^\\/]+[\\\/]AppData)$/i;
    // Strip the leading drive letter (if any) and the first separator
    // so sensitiveRootRe can match against the path's first
    // "directory" component.
    const pathBody = abs.replace(/^[A-Za-z]:[\\\/]/, '');
    if (sensitiveRootRe.test(pathBody) || sensitiveRootRe.test(abs)) {
      return { ok: true, exists: false, reason: 'sensitive directory' };
    }
    try { await fsp.access(abs, fs.constants.F_OK); return { ok: true, exists: true }; }
    catch { return { ok: true, exists: false }; }
  });
}

module.exports = { register };
