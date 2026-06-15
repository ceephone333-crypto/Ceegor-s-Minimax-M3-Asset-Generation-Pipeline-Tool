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
  if (targetResolved !== dirResolved && !targetResolved.startsWith(dirResolved + path.sep)) {
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
  await fs.rename(src, dest);
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
  try { shell.showItemInFolder(p); } catch (_) { /* ignore */ }
}

async function readFile(p, maxBytes = 2 * 1024 * 1024) {
  const st = await fs.stat(p);
  if (st.size > maxBytes) throw new Error(`File too large to preview (${st.size} bytes).`);
  return fs.readFile(p);
}

module.exports = { list, mkdir, rename, moveTo, copyTo, deletePath, reveal, readFile, validateName };
