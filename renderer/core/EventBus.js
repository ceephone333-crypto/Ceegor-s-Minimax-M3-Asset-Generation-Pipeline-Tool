// renderer/core/EventBus.js
// Minimaler Pub/Sub für die Entkopplung Tabs ↔ Panels (Phase 5).
// Stand Phase 3: existiert nur als Skeleton; Renderer-Module rufen
// die `on/emit/off`-Helfer direkt auf, sobald Phase 5 aktiviert wird.

const listeners = new Map();

function on(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
  return () => off(event, handler);
}

function off(event, handler) {
  const set = listeners.get(event);
  if (set) set.delete(handler);
}

function emit(event, payload) {
  const set = listeners.get(event);
  if (!set) return;
  for (const h of set) {
    try { h(payload); }
    catch (e) { console.error('[EventBus] handler for', event, 'threw:', e); }
  }
}

window.EventBus = { on, off, emit };
