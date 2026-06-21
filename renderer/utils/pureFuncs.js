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
// v1.1.15: re-picked the icons so they read more clearly at small
// sizes on the dark background. The previous set used 🖼 / 🎵 / 🎬
// / 📄 — 🖼 is a single (low-detail) emoji that disappears into
// the dark theme, and 🎵 is a dark-blue note that effectively
// vanishes against the dark-bg row. The new set uses higher-
// contrast glyphs (the variation selectors on each emoji force
// the colourful emoji presentation rather than the line-drawn
// glyph), and added a few more categories so the icon always
// matches the file's purpose.
function iconForFile(ext) {
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(ext)) return '🖼️';
  // v1.1.15 (reported by user): the previous music-note icon
  // (🎵) was almost invisible on the dark theme — the emoji
  // renders as a dark-blue glyph with no fill, so on a near-
  // black row the user couldn't tell the row was an audio file
  // at a glance. Switched to 🎶 (a brighter, more colourful
  // glyph) AND added a CSS class (.fb-icon-audio) so the file
  // browser can boost the contrast with a coloured background
  // if needed (kept here as a safety net).
  if (['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.opus', '.pcm', '.aac', '.wma', '.aif', '.aiff'].includes(ext)) return '🎶';
  if (['.mp4', '.mov', '.webm', '.mkv', '.avi'].includes(ext)) return '🎞️';
  if (['.srt', '.txt', '.json', '.md', '.lrc'].includes(ext)) return '📝';
  return '📄';
}
// v1.1.15: stable id of the icon CSS class for the file-type
// icons. The file browser row uses this to colour-tint the
// icon's background (so the music-note icon stays visible on
// the dark theme). Keeping it here (next to iconForFile) means
// any future icon change can be paired with a class change in
// one place.
function iconClassForFile(ext) {
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(ext)) return 'fb-icon-image';
  if (['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.opus', '.pcm', '.aac', '.wma', '.aif', '.aiff'].includes(ext)) return 'fb-icon-audio';
  if (['.mp4', '.mov', '.webm', '.mkv', '.avi'].includes(ext)) return 'fb-icon-video';
  if (['.srt', '.txt', '.json', '.md', '.lrc'].includes(ext)) return 'fb-icon-text';
  return 'fb-icon-other';
}

window.PureFuncs = { parseAspect, humanSize, parentDir, iconForFile, iconClassForFile };

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
