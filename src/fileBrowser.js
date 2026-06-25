// src/fileBrowser.js
// File-system operations for the right-pane browser.
const fs = require('fs').promises;
const fssync = require('fs');
const path = require('path');
const { shell } = require('electron');

async function safeStat(p) {
  try { return await fs.stat(p); } catch { return null; }
}

// Reject names that could escape the parent directory or that contain
// characters Windows / POSIX reserve. This guards against path-traversal
// (`..`, slashes) and shell metachars even though our renderer's UI is
// already constrained.
function validateName(name) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('Name is required.');
  }
  if (name.length > 255) {
    throw new Error('Name is too long (max 255 chars).');
  }
  if (name === '.' || name === '..') {
    throw new Error('Name cannot be "." or "..".');
  }
  if (/[\\/]/.test(name)) {
    throw new Error('Name cannot contain path separators (/ or \\).');
  }
  if (/[<>:"|?*\x00-\x1f]/.test(name)) {
    throw new Error('Name contains characters that are not allowed: < > : " | ? * or control chars.');
  }
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) {
    throw new Error('"' + name + '" is a reserved Windows name.');
  }
  // Trim trailing dots/spaces — Windows strips these on disk, which would
  // make the new file appear under a different name than the user typed.
  if (/[. ]$/.test(name)) {
    throw new Error('Name cannot end with a dot or space.');
  }
}

async function list(dir) {
  const target = dir || '.';
  const resolved = path.resolve(target);
  const entries = await fs.readdir(resolved, { withFileTypes: true });
  const items = [];
  for (const e of entries) {
    const full = path.join(resolved, e.name);
    const st = await safeStat(full);
    if (!st) continue;
    items.push({
      name: e.name,
      path: full,
      isDir: e.isDirectory(),
      size: st.size,
      mtimeMs: st.mtimeMs,
      // Creation time. On some filesystems (notably FAT32 and
      // some non-NTFS volumes) the value is 0 / not available;
      // the renderer-side sort falls back to mtimeMs in that case
      // so the user still gets a sensible "newest first" order
      // instead of all-zero ties.
      birthtimeMs: st.birthtimeMs || 0,
      ctimeMs: st.ctimeMs || 0,
      ext: path.extname(e.name).toLowerCase(),
    });
  }
  items.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return { dir: resolved, parent: path.dirname(resolved), items };
}

async function mkdir(dir, name) {
  validateName(name);
  const target = path.join(dir, name);
  // Defense in depth: ensure the resolved target is still inside `dir`.
  const dirResolved = path.resolve(dir);
  const targetResolved = path.resolve(target);
  // Bug-fix (2026-06-20, reported by user): when `dir` is a DRIVE ROOT
  // (e.g. `D:\`, a common output_dir), path.resolve already returns it
  // WITH a trailing separator ("D:\"), so `dirResolved + path.sep` became
  // "D:\\" (double sep) and a legitimate child like "D:\speech" failed
  // the startsWith() check → fb.mkdir threw "escapes the parent
  // directory" → fb:mkdir returned {ok:false} → ensureSubDir created no
  // folder → mmx wrote to a missing dir → ENOENT, and NO asset could be
  // generated. Normalise so a root that already ends in a separator
  // isn't doubled.
  const dirWithSep = dirResolved.endsWith(path.sep) ? dirResolved : dirResolved + path.sep;
  if (targetResolved !== dirResolved && !targetResolved.startsWith(dirWithSep)) {
    throw new Error('Resolved path escapes the parent directory.');
  }
  // recursive + force-ok-on-EEXIST: lets us call this to "ensure" a dir exists.
  await fs.mkdir(target, { recursive: true });
  return target;
}

async function rename(p, newName) {
  validateName(newName);
  const dir = path.dirname(p);
  const dest = path.join(dir, newName);
  if (fssync.existsSync(dest)) throw new Error('A file/folder with that name already exists.');
  await fs.rename(p, dest);
  return dest;
}

async function moveTo(src, destDir) {
  const name = path.basename(src);
  let dest = path.join(destDir, name);
  if (fssync.existsSync(dest)) {
    // Auto-rename to avoid clobber
    const { name: base, ext } = path.parse(name);
    let i = 1;
    while (fssync.existsSync(dest)) {
      dest = path.join(destDir, `${base} (${i})${ext}`);
      i++;
    }
  }
  // v1.1 (audit M7): EXDEV fallback. fs.rename throws EXDEV across
  // drive letters — extremely common on Windows (output_dir on D:,
  // source on C:). The pre-v1.1 code surfaced this as a generic
  // error with no recovery. We fall back to copy+delete so cross-
  // device moves work transparently. (POSIX rename inside the same
  // FS stays atomic; the fallback only fires on EXDEV.)
  try {
    await fs.rename(src, dest);
  } catch (e) {
    if (e && (e.code === 'EXDEV' || /cross-device|spans devices/i.test(String(e.message || '')))) {
      await fs.cp(src, dest, { recursive: true, force: false, errorOnExist: true });
      await fs.rm(src, { recursive: true, force: true });
    } else {
      throw e;
    }
  }
  return dest;
}

async function copyTo(src, destDir) {
  const name = path.basename(src);
  let dest = path.join(destDir, name);
  if (fssync.existsSync(dest)) {
    // Auto-rename to avoid clobber
    const { name: base, ext } = path.parse(name);
    let i = 1;
    while (fssync.existsSync(dest)) {
      dest = path.join(destDir, `${base} (${i})${ext}`);
      i++;
    }
  }
  const st = await fs.stat(src);
  if (st.isDirectory()) {
    // Recursive directory copy. We use fssync.cpSync for a fast, OS-friendly
    // copy that preserves the directory tree.
    fssync.cpSync(src, dest, { recursive: true, errorOnExist: true });
  } else {
    await fs.copyFile(src, dest);
  }
  return dest;
}

async function deletePath(p) {
  const st = await fs.stat(p);
  if (st.isDirectory()) await fs.rm(p, { recursive: true, force: false });
  else await fs.unlink(p);
  return p;
}

function reveal(p) {
  // Bug-fix LOW-4 (_temp5.md 360° audit): return a boolean so the
  // IPC handler can report a real failure instead of always ok:true.
  // Electron's shell.showItemInFolder returns void, so we catch any
  // throw (e.g. the file was deleted/moved between the user's click
  // and this call) and report false.
  try { shell.showItemInFolder(p); return true; } catch (_) { return false; }
}

// v1.1.15 (reported by user): open a NEW Windows Explorer
// window at the file's parent folder. This is the standard
// "explore" shell verb — `shell.showItemInFolder` (above) only
// highlights the file in an existing window, whereas
// `shell.openPath(parentDir)` opens a fresh Explorer window.
// The caller passes a file path; we resolve the parent dir
// here so the renderer doesn't have to know the platform-
// specific separator logic.
function openInExplorer(p) {
  if (!p || typeof p !== 'string') {
    throw new Error('Path is required.');
  }
  const path = require('path');
  // `path.dirname` returns the parent dir for a file path,
  // and the path itself for a directory path. We want the
  // "containing" folder either way, so the resulting
  // Explorer window always lands on a folder.
  const parent = path.dirname(p);
  // shell.openPath returns a Promise<string> ('' on success,
  // an error string on failure). We wrap it so the IPC
  // handler gets a clean {ok, error} shape.
  return shell.openPath(parent).then((err) => {
    if (err) throw new Error(String(err));
  });
}

async function readFile(p, maxBytes = 2 * 1024 * 1024) {
  const st = await fs.stat(p);
  if (st.size > maxBytes) throw new Error(`File too large to preview (${st.size} bytes).`);
  return fs.readFile(p);
}

module.exports = { list, mkdir, rename, moveTo, copyTo, deletePath, reveal, openInExplorer, readFile, validateName };
