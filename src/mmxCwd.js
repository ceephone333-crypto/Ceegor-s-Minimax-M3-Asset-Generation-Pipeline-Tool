// src/mmxCwd.js
// v1.1 (audit BUG-R2-11): cwd validation for runMmx. Extracted
// from src/mmx.js so the main file stays under the 500-line
// HARD limit. A malicious cwd could:
//   - point at a UNC path that the user isn't supposed
//     to see, and mmx-cli would happily chdir into it
//     before running
//   - trigger a path-traversal-amplified arg-injection
//     attack via cwd-relative resource lookups
// We accept cwd only when it is one of:
//   (a) undefined / null (use the OS default — process.cwd())
//   (b) an absolute path
// Anything else (relative paths, paths with NUL bytes,
// empty strings, non-strings) is silently coerced to
// undefined.

const path = require('path');

function safeCwd(cwd) {
  if (cwd === undefined || cwd === null) return undefined;
  if (typeof cwd !== 'string') return undefined;
  if (cwd.indexOf('\0') !== -1) return undefined;
  if (cwd === '' || cwd === '.' || cwd === './') return undefined;
  return path.isAbsolute(cwd) ? cwd : undefined;
}

module.exports = { safeCwd };
