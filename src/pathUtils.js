// src/pathUtils.js
// Helpers to safely validate file paths before any file operation. All
// fb:* IPC handlers must funnel their paths through `isPathUnderAny` so a
// compromised renderer (or a future bug in one of the build functions)
// can't trick the main process into reading, writing, renaming, or
// deleting files outside the directories the user authorised.
//
// Threats this guards against:
//   - Path traversal via `..` segments ("C:\Generated\..\..\Windows\…")
//   - Mixed-separator confusion ("C:/Generated\..\..\Windows")
//   - Windows case-insensitive filesystem mismatches
//   - Symlink targets pointing outside the allowed roots
//     (we do a best-effort check by resolving the parent dir; a hardlink
//      inside the allowed root that points at a system file would still
//      be reachable — that's an OS-level concern we can't fully close)
//   - Null-byte / control-character injection in paths
const path = require('path');
const fs = require('fs');

// Resolve a path to an absolute, normalised form. Returns null when the
// path is empty, not a string, or contains characters that should never
// appear in a legitimate filesystem path.
function normalize(p) {
  if (typeof p !== 'string' || p.length === 0) return null;
  // Reject NULs and other control chars — they have no legitimate use
  // and `fs` calls will throw on them anyway, but we'd rather fail
  // early and clearly.
  if (/[\x00-\x1f]/.test(p)) return null;
  try {
    return path.resolve(p);
  } catch {
    return null;
  }
}

// Lowercase, separator-normalised, trimmed form. For Windows-friendly
// comparison only — DO NOT use the result as a real path (it can change
// the case of letters that ARE significant on case-sensitive filesystems,
// but our threat model is "user on Windows or macOS, attacker can't
// influence case-sensitive mount points").
function canon(p) {
  if (!p) return '';
  return String(p).replace(/[\\/]+/g, path.sep).replace(/[\\/]+$/, '').toLowerCase();
}

// True iff `p` is `root` itself, or sits under `root` (after both are
// resolved). Both are compared case-insensitively so it works on
// Windows.
function isPathUnder(p, root) {
  const pAbs = normalize(p);
  const rAbs = normalize(root);
  if (!pAbs || !rAbs) return false;
  const pLow = canon(pAbs);
  const rLow = canon(rAbs);
  if (pLow === rLow) return true;
  return pLow.startsWith(rLow + path.sep);
}

// True iff `p` is under any of the given roots.
function isPathUnderAny(p, roots) {
  if (!Array.isArray(roots) || roots.length === 0) return false;
  for (const r of roots) {
    if (isPathUnder(p, r)) return true;
  }
  return false;
}

// True iff the path's *parent directory* is under any of the given roots.
// Used by fb:write where the user provides a full output path and we want
// to authorise "write next to an existing file in an allowed dir".
function isParentUnderAny(p, roots) {
  const pAbs = normalize(p);
  if (!pAbs) return false;
  return isPathUnderAny(path.dirname(pAbs), roots);
}

// Resolve a path through any symlinks in its parents so the result
// reflects what the OS will actually see. Returns the original
// (non-real-path) value on platforms / filesystems that don't support
// realpath — best effort only.
function realIfExists(p) {
  const pAbs = normalize(p);
  if (!pAbs) return null;
  try {
    return fs.realpathSync(pAbs);
  } catch {
    return pAbs;
  }
}

module.exports = { normalize, canon, isPathUnder, isPathUnderAny, isParentUnderAny, realIfExists };
