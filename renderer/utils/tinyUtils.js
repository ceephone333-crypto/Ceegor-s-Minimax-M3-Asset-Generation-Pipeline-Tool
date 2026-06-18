// renderer/utils/tinyUtils.js
// Sammlung von 5 kleinen, reinen Helper-Funktionen aus app.js.
// Phase 3 Block 14: 15 Z. extrahiert (0 Coupling, 0 State).

function pathJoin(a, b) {
  if (!a) return b;
  const sep = a.includes('\\') ? '\\' : '/';
  return a.replace(/[\\/]+$/, '') + sep + b;
}

function safeStringify(o) {
  try { return JSON.stringify(o, null, 2).slice(0, 4000); }
  catch { return String(o); }
}

function extFromMime(mime) {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  return 'png';
}

function _isImageExt(ext) {
  return ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes((ext || '').toLowerCase());
}

function appendBoolFlag(args, param, flag) {
  const v = param.getValue ? param.getValue() : param.value;
  if (v === 'on' || v === true) args.push(flag);
}

window.TinyUtils = { pathJoin, safeStringify, extFromMime, _isImageExt, appendBoolFlag };
