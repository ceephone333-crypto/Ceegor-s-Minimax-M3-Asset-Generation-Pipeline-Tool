// renderer/components/HelpTooltip.js
// Hover-driven Tooltip für inline `data-help` Icons.
// Phase 3 Block 4: aus app.js extrahiert.
//
// Replaces the previous CSS pseudo-element approach
// ([data-help]:hover::after) which positioned the tooltip
// `absolute` next to the icon and was clipped by the content
// area's `overflow: auto`. Long tooltips (e.g. for --width,
// --model) routinely extended past the right edge of #content
// and were rendered invisible behind the folder-explorer area.
// The new tooltip is `position: fixed` so no parent container
// can clip it.
//
// A SINGLE tooltip element is created and reused. Event
// delegation on `document` so dynamically added icons (e.g. the
// per-tab build() calls) pick up the behaviour for free.

/**
 * @returns {{ showFor: (el: HTMLElement) => void, hide: () => void }}
 */
function setupHoverHelpTooltips() {
  const tip = document.createElement('div');
  tip.className = 'help-hover-tooltip';
  tip.setAttribute('role', 'tooltip');
  tip.style.display = 'none';
  document.body.appendChild(tip);
  let activeEl = null;

  function showFor(el) {
    const text = el.getAttribute('data-help') || el.getAttribute('title') || '';
    if (!text) { hide(); return; }
    tip.textContent = text;
    tip.style.display = '';
    activeEl = el;
    position(tip, el);
  }
  function hide() {
    tip.style.display = 'none';
    activeEl = null;
  }
  function position(tipEl, anchor) {
    // Position below the icon by default. If the tooltip would
    // overflow the bottom of the viewport, flip it above the
    // icon instead. If it would overflow the right edge, clamp
    // the left position so the right edge stays inside the
    // viewport. We use getBoundingClientRect (relative to the
    // viewport) because the tooltip itself is position: fixed.
    const r = anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8; // px from the viewport edge
    // Measure the tooltip after we set the text but BEFORE we
    // position it. display:none / display:'' flicker is
    // unavoidable but lasts one frame, which is fine.
    const tipR = tipEl.getBoundingClientRect();
    let top = r.bottom + 6;
    let left = r.left;
    if (top + tipR.height > vh - margin) {
      const above = r.top - tipR.height - 6;
      if (above >= margin) top = above;
      else top = Math.max(margin, vh - tipR.height - margin);
    }
    if (left + tipR.width > vw - margin) {
      left = vw - tipR.width - margin;
    }
    if (left < margin) left = margin;
    tipEl.style.left = left + 'px';
    tipEl.style.top = top + 'px';
  }
  // Event delegation on the document. We use mouseover /
  // mouseout (NOT mouseenter / mouseleave) because they bubble
  // — critical for delegation.
  document.addEventListener('mouseover', (e) => {
    const t = e.target && e.target.closest && e.target.closest('[data-help]');
    if (!t) return;
    showFor(t);
  });
  document.addEventListener('mouseout', (e) => {
    const t = e.target && e.target.closest && e.target.closest('[data-help]');
    if (!t) return;
    // Only hide if we're really leaving the icon (not just
    // moving to a child node inside the icon). relatedTarget
    // is the element the pointer is moving to; if it's still
    // inside `[data-help]`, we keep the tooltip open.
    const to = e.relatedTarget;
    if (to && t.contains(to)) return;
    hide();
  });
  // Hide on Esc and on window blur (alt-tabbing away).
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && activeEl) hide();
  });
  window.addEventListener('blur', hide);
  // Reposition on scroll / resize so the tooltip stays glued.
  // capture: true on the scroll listener so we catch scrolls
  // inside the scrollable #content (which doesn't bubble to
  // window).
  window.addEventListener('scroll', () => {
    if (activeEl) position(tip, activeEl);
  }, true);
  window.addEventListener('resize', () => {
    if (activeEl) position(tip, activeEl);
  });
  return { showFor, hide };
}

window.HelpTooltip = { setupHoverHelpTooltips };
