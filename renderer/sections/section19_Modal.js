// renderer/sections/section19_Modal.js (Phase 3 Block 29)
// Extracted: Modal
// Source: app.js L639..721

// ----------------- Modal -----------------
// Stack-based modal manager. The previous version used a single
// `_modalClose` slot and wiped `modal-root` on every `showModal` call —
// that destroyed any underlying modal (e.g. opening the bulk-paste
// dialog from the BatchGen manager wiped the BatchGen modal entirely,
// and the user lost Esc-to-close on the parent). Stacking keeps each
// modal's DOM around until its own close is called, and Esc closes the
// topmost modal first.
//
// Focus restoration: when a modal opens we remember the
// document.activeElement so we can restore focus on close. Without
// this, clicking into the folder-browser filter opened the
// help modal AND stripped focus from the input; after dismissing
// the modal the user had to click the input again, which would
// re-trigger the same help modal — an infinite loop. Restoring
// focus on close breaks the cycle.
//
// Stack dedup: every modal can carry an optional `id` string.
// If a modal with the same id is already on the stack, the new
// call is treated as a no-op (returns the existing modal's close
// fn). Without this, mashing a help button on a glitchy trackpad
// could pile up five identical help modals on top of each other.
let _modalClose = null;
const _modalStack = [];
function showModal(build, opts) {
  const root = $('#modal-root');
  const id = (opts && opts.id) || null;
  // Stack dedup: refuse to open a second modal with the same id
  // when one is already showing. The user gets the existing one
  // (and its focus) — clicking the same help button twice is a
  // no-op rather than stacking two copies.
  if (id) {
    for (const entry of _modalStack) {
      if (entry && entry.id === id) return entry.close;
    }
  }
  root.classList.add('active');
  const m = el('div', { class: 'modal' });
  root.appendChild(m);
  // Remember the currently-focused element so we can restore it
  // on close. We capture this BEFORE we run the builder, because
  // the builder typically focuses its primary button (which would
  // otherwise become the "previously focused" element).
  const prevFocus = document.activeElement;
  const stackEntry = { id, close: null };
  const close = () => {
    if (m.parentNode) m.remove();
    if (root.children.length === 0) {
      root.classList.remove('active');
    }
    const idx = _modalStack.indexOf(stackEntry);
    if (idx >= 0) _modalStack.splice(idx, 1);
    if (_modalStack.length > 0) {
      _modalClose = _modalStack[_modalStack.length - 1].close;
    } else if (_modalClose === close) {
      _modalClose = null;
    }
    // Restore focus to the element that was focused when the
    // modal opened. Falls back to <body> if the original element
    // was removed from the DOM in the meantime (e.g. a settings
    // dialog re-rendered its form).
    try {
      if (prevFocus && prevFocus.focus && document.contains(prevFocus)) {
        prevFocus.focus();
      }
    } catch (_) { /* ignore */ }
  };
  stackEntry.close = close;
  _modalStack.push(stackEntry);
  _modalClose = close;
  build(m, close);
  return close;
}

// Close the active modal when the user presses Escape. Also auto-focus the
// first primary button so Enter triggers it.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && _modalClose) {
    e.preventDefault();
    _modalClose();
  }
});

