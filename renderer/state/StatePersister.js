// renderer/state/StatePersister.js
// Debounced Autosave nach state.json (via window.api.stateSet).
// Persistiert nur persistente Felder (nicht die "Live"-Felder wie
// genStatus, _logEvents, _lastPreviewPath, _fbItems, _previewBatch,
// _logLastClickedId).

const PERSISTENT_KEYS = [
  'currentTab', 'theme', 'fbDirs', 'filePrefix', 'realesrganModel',
  'realesrganFirstRunDismissed', 'upscaleEnabled', 'upscaleSettings',
  'removeBackgroundEnabled', 'removeBackgroundUseGpu', 'optimizeSettings',
  'layoutSettings', 'fbSort', 'fbColumns', 'fbThumbnails',
];

const DEBOUNCE_MS = 250;
let timer = null;
let pending = null;

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, DEBOUNCE_MS);
}

function flush() {
  if (!pending) return;
  const snapshot = pending;
  pending = null;
  timer = null;
  if (!window.api || typeof window.api.stateSet !== 'function') return;
  try { window.api.stateSet(snapshot); }
  catch (e) { console.error('[StatePersister] save failed:', e); }
}

function persistNow() {
  if (timer) { clearTimeout(timer); timer = null; }
  const snap = {};
  for (const k of PERSISTENT_KEYS) {
    if (k in window.AppState) snap[k] = window.AppState[k];
  }
  pending = snap;
  flush();
}

function onChange() {
  const snap = {};
  for (const k of PERSISTENT_KEYS) {
    if (k in window.AppState) snap[k] = window.AppState[k];
  }
  pending = snap;
  schedule();
}

window.StatePersister = { onChange, persistNow };
