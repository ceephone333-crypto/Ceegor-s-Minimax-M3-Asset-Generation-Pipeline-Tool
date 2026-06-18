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
