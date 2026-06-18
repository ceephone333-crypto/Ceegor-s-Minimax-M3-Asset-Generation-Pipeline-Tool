// renderer/utils/pureFuncs.js
// 4 kleine, reine Helper-Funktionen aus app.js (Phase 3 Block 15).
// Keine State-, Window- oder DOM-Coupling. 0 App-Kopplung.

// Parse a "W:H" aspect ratio string. Returns {w, h} or null.
function parseAspect(v) {
  if (!v) return null;
  const m = String(v).match(/^(\d+):(\d+)$/);
  if (!m) return null;
  return { w: parseInt(m[1], 10), h: parseInt(m[2], 10) };
}

// Human-readable byte count: 1234 -> "1.2 KB", 12345678 -> "11.8 MB".
function humanSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

// Get the parent directory of a path, handling both Windows \ and Unix /.
function parentDir(p) {
  if (!p) return '';
  const sep = p.includes('\\') ? '\\' : '/';
  const parts = p.split(/[\\/]/).filter(Boolean);
  parts.pop();
  return parts.length ? parts.join(sep) : '';
}

// Map a file extension to a single-emoji icon for the file browser.
function iconForFile(ext) {
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(ext)) return '🖼';
  if (['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.opus', '.pcm'].includes(ext)) return '🎵';
  if (['.mp4', '.mov', '.webm', '.mkv'].includes(ext)) return '🎬';
  if (['.srt', '.txt', '.json', '.md'].includes(ext)) return '📄';
  return '📄';
}

window.PureFuncs = { parseAspect, humanSize, parentDir, iconForFile };

// Load a local file:// image as a usable Image object (resolves once
// it is fully decoded). Used by upscale / crop / convert.
function loadImageFromFile(filePath) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image: " + filePath));
    img.src = fileUrl(filePath);
  });
}

// Pick a non-clobbering output path next to the source. Inserts a
// `_2x`, `_cropped_WxH`, or `_converted` infix between the stem and
// the extension. If the result already exists, a numeric suffix is
// appended to keep the original safe.
function derivedOutputPath(srcPath, infix) {
  const sep = srcPath.includes("\\") ? "\\" : "/";
  const lastSep = srcPath.lastIndexOf(sep);
  const dir = lastSep >= 0 ? srcPath.slice(0, lastSep) : "";
  const lastDot = srcPath.lastIndexOf(".");
  const stem = lastDot > lastSep ? srcPath.slice(0, lastDot) : srcPath;
  const ext = lastDot > lastSep ? srcPath.slice(lastDot) : "";
  return dir + sep + stem.split(sep).pop() + infix + ext;
}

window.PureFuncs = Object.assign(window.PureFuncs || {}, { loadImageFromFile, derivedOutputPath });
