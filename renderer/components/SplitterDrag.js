// renderer/components/SplitterDrag.js
// Bug-fix #14 (2026-06-19): drag-to-resize the three splitters
// declared in index.html (sidebar, logbar, log/preview split).
//
// The CSS + state plumbing already existed — styles.css reads
// --sidebar-w / --logbar-h / --preview-w / --log-w from :root,
// and state.layoutSettings.* is the persisted source of truth.
// What's missing was the actual mousedown handler. Without it the
// bars do nothing and `layoutSettings` is dead.
//
// This file:
//   1. Wires mousedown on every [data-splitter].
//   2. On drag, tracks pointer delta and writes the CSS variable
//      that the corresponding pane reads.
//   3. On mouseup, clamps the final value into [min, max] (the
//      same bounds the CSS uses), writes to state.layoutSettings,
//      and schedules a state save so the choice survives a
//      restart.
//   4. Exposes `applyLayoutSettings()` which seeds the CSS
//      variables from state.layoutSettings — call it once at
//      startup after the saved state is loaded.
//
// We do NOT add new dependencies — drag uses plain pointer
// events on `document` so the cursor keeps tracking even when
// the pointer leaves the 8-px handle.
//
// Splitter orientation comes from the `splitter-v` / `splitter-h`
// class already on the element (kept for the cursor styling
// styles.css relies on).

(function initSplitterDrag() {
  // Resolve DOM + state at click time so a renderer that loads
  // this file BEFORE section24_State.js / app.js still works.
  function getState() {
    return (typeof window !== 'undefined' && window.state) ? window.state : null;
  }

  // Map splitter id → (cssVar, stateKey, axis).
  // axis = 'x' means horizontal movement changes the width
  // (sidebar / preview / log columns).
  // axis = 'y' means vertical movement changes the height
  // (logbar row).
  const SPLITTERS = [
    { id: 'splitter-sidebar',    axis: 'x', cssVar: '--sidebar-w', stateKey: 'sidebarW' },
    { id: 'splitter-logbar',     axis: 'y', cssVar: '--logbar-h',  stateKey: 'logbarH'  },
    { id: 'splitter-log-preview',axis: 'x', cssVar: '--preview-w', stateKey: 'previewW' },
  ];

  // Bounds (must mirror the :root defaults in styles.css).
  const MIN = { '--sidebar-w': 200, '--logbar-h': 80,  '--preview-w': 200 };
  const MAX = { '--sidebar-w': Infinity, '--logbar-h': Infinity, '--preview-w': Infinity };

  function getRoot() { return document.documentElement; }

  function readVar(name) {
    const v = getRoot().style.getPropertyValue(name);
    if (!v) return null;
    const m = v.match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : null;
  }
  function writeVar(name, px) {
    getRoot().style.setProperty(name, `${Math.round(px)}px`);
  }
  function clamp(name, px) {
    // For unknown var names (no bounds registered) pass through.
    // This keeps the helper testable in isolation: a stray
    // variable from a future feature won't silently snap to 0.
    if (MIN[name] == null && (MAX[name] == null || MAX[name] === Infinity)) return px;
    const lo = MIN[name] != null ? MIN[name] : -Infinity;
    const hi = MAX[name] != null && MAX[name] !== Infinity ? MAX[name] : Infinity;
    return Math.max(lo, Math.min(hi, px));
  }

  // Pure helper exposed for tests + reuse.
  function clampLayout(name, px) { return clamp(name, px); }

  function applyLayoutSettings() {
    const s = getState();
    if (!s || !s.layoutSettings) return;
    const ls = s.layoutSettings;
    if (typeof ls.sidebarW === 'number') writeVar('--sidebar-w', clamp('--sidebar-w', ls.sidebarW));
    if (typeof ls.logbarH  === 'number') writeVar('--logbar-h',  clamp('--logbar-h',  ls.logbarH));
    if (typeof ls.previewW === 'number') writeVar('--preview-w', clamp('--preview-w', ls.previewW));
    // --log-w is the *remaining* width inside #logbar; leave it
    // at 1fr so flex handles it.
  }

  function attach(splitter) {
    const el = document.getElementById(splitter.id);
    if (!el) return;
    let startCoord = 0;
    let startVal = 0;
    let dragging = false;

    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      dragging = true;
      startCoord = splitter.axis === 'x' ? e.clientX : e.clientY;
      startVal = readVar(splitter.cssVar) || 0;
      // v1.1.15 (reported by user): the previous version
      // only set `document.body.style.cursor` on mousedown,
      // which the browser would silently drop in some
      // situations (e.g. the cursor leaves the body and
      // re-enters a child element). Use a body class
      // instead, so the CSS keeps the resize cursor stuck
      // to the entire body for the duration of the drag.
      document.body.classList.add(splitter.axis === 'x' ? 'resizing-width' : 'resizing-height');
      document.body.style.userSelect = 'none';
      // Add the .dragging class to the splitter itself so
      // the visual hover state stays on while the user
      // drags (otherwise the hover would fade the moment
      // the cursor leaves the 4-px handle).
      el.classList.add('dragging');
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const now = splitter.axis === 'x' ? e.clientX : e.clientY;
      const delta = now - startCoord;
      // v1.1.15 (reported by user): the previous sign
      // convention was the opposite of standard Windows
      // behaviour. The user explicitly asked for
      // "normal Windows" behaviour, where dragging the
      // divider to the right makes the divider follow the
      // cursor (and the LEFT pane grows, the RIGHT pane
      // shrinks). This matches Windows Explorer's
      // "drag the divider to position it" convention: the
      // divider follows the cursor, and the pane on the
      // side you're dragging TOWARDS shrinks to make
      // room. The previous code (`startVal + delta`) made
      // the right pane grow when dragged right, which is
      // the opposite of what Windows does.
      const next = clamp(splitter.cssVar, startVal - delta);
      writeVar(splitter.cssVar, next);
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('resizing-width');
      document.body.classList.remove('resizing-height');
      document.body.style.userSelect = '';
      // Clear the per-splitter dragging class so the
      // hover state returns to its pre-drag visual.
      el.classList.remove('dragging');
      const final = readVar(splitter.cssVar);
      if (final == null) return;
      const s = getState();
      if (!s) return;
      s.layoutSettings = s.layoutSettings || {};
      s.layoutSettings[splitter.stateKey] = Math.round(final);
      // Persist — scheduleStateSave() is defined in app.js.
      if (typeof window.scheduleStateSave === 'function') {
        window.scheduleStateSave();
      }
    });
  }

  function init() {
    for (const sp of SPLITTERS) attach(sp);
    applyLayoutSettings();
  }

  // Expose for app.js to call after state load + for tests.
  window.SplitterDrag = {
    init,
    applyLayoutSettings,
    SPLITTERS,
    clampLayout,
  };

  // Run on DOMContentLoaded; safe even if the script loads
  // before the elements exist (we just no-op until they do).
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();