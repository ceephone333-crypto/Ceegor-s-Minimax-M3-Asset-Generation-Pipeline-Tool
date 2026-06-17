// renderer/utils/fbSort.js
// File-Browser Sort-Logik. Phase 3 Block 11: 3 pure Funktionen +
// 1 Konstante extrahiert (insgesamt 79 Z. → 0 App-Coupling).

/** Erlaubte Sort-Modi für den File-Browser. */
const FB_SORT_MODES = new Set([
  'name-asc', 'name-desc',
  'size-desc', 'size-asc',
  'mtime-desc', 'mtime-asc',
  'created-desc', 'created-asc',
  'type-asc',
]);

/** Whitelist-Check: ungültige Modi fallen auf 'name-asc' zurück. */
function normalizeFbSort(mode) {
  return (typeof mode === 'string' && FB_SORT_MODES.has(mode)) ? mode : 'name-asc';
}

/**
 * Natürlicher String-Vergleich mit Zahlen-Erkennung.
 * "file2" < "file10" (nicht "file10" < "file2" wie bei normalem <).
 */
function naturalCompare(a, b) {
  // Pure implementation; Referenz: app.js Original.
  const re = /(\d+|\D+)/g;
  const ax = [], bx = [];
  let m;
  while ((m = re.exec(String(a))) !== null) ax.push(m[1]);
  while ((m = re.exec(String(b))) !== null) bx.push(m[1]);
  while (ax.length && bx.length) {
    const a0 = ax.shift(), b0 = bx.shift();
    const an = parseInt(a0, 10), bn = parseInt(b0, 10);
    if (!isNaN(an) && !isNaN(bn) && String(an) === a0.trim() && String(bn) === b0.trim()) {
      if (an !== bn) return an - bn;
    } else if (a0 !== b0) {
      return a0 < b0 ? -1 : 1;
    }
  }
  return ax.length - bx.length;
}

/**
 * Sortiert eine File-Browser-Item-Liste nach dem gewählten Modus.
 * Directories kommen immer zuerst (Windows-Explorer-Konvention).
 * @param {Array<object>} items  fs-Items mit {name, isDir, size, mtimeMs, birthtimeMs, ext}
 * @param {string} mode
 * @returns {Array<object>}  Neue sortierte Liste (Input wird nicht mutiert)
 */
function sortFbItems(items, mode) {
  const m = normalizeFbSort(mode);
  const arr = Array.isArray(items) ? items.slice() : [];
  const cmp = (a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    switch (m) {
      case 'name-desc':     return naturalCompare(b.name, a.name);
      case 'size-desc':     return (Number(b.size) || 0) - (Number(a.size) || 0);
      case 'size-asc':      return (Number(a.size) || 0) - (Number(b.size) || 0);
      case 'mtime-desc':    return (Number(b.mtimeMs) || 0) - (Number(a.mtimeMs) || 0);
      case 'mtime-asc':     return (Number(a.mtimeMs) || 0) - (Number(b.mtimeMs) || 0);
      case 'created-desc': {
        const av = Number(a.birthtimeMs) || Number(a.mtimeMs) || 0;
        const bv = Number(b.birthtimeMs) || Number(b.mtimeMs) || 0;
        return bv - av;
      }
      case 'created-asc': {
        const av = Number(a.birthtimeMs) || Number(a.mtimeMs) || 0;
        const bv = Number(b.birthtimeMs) || Number(b.mtimeMs) || 0;
        return av - bv;
      }
      case 'type-asc': {
        const ae = (a.ext || '').toLowerCase();
        const be = (b.ext || '').toLowerCase();
        if (ae !== be) return ae.localeCompare(be);
        return naturalCompare(a.name, b.name);
      }
      case 'name-asc':
      default:
        return naturalCompare(a.name, b.name);
    }
  };
  arr.sort(cmp);
  return arr;
}

window.FbSort = { FB_SORT_MODES, normalizeFbSort, naturalCompare, sortFbItems };
