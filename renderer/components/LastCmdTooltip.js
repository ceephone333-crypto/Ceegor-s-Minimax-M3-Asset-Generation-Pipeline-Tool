// renderer/components/LastCmdTooltip.js
// Long-Hover-Tooltip für `.lastcmd` Elemente. Phase 3 Block 7.
// Zeigt nach 1s Hover den vollen Text (statt ellipsisiert) in
// einem position:fixed Popup. Event-Delegation auf document, so
// jeder Tab-Builder ohne weiteres Setup davon profitiert.

/**
 * Idempotent: installiert die Event-Listener genau einmal auf
 * document/window. Mehrfacher Aufruf ist sicher.
 */
function setupLastCmdTooltips() {
  let timer = null;
  let popup = null;
  let activeEl = null;
  let hideTimer = null;

  const cancel = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (popup) { popup.remove(); popup = null; }
    activeEl = null;
  };
  const scheduleHide = () => {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(cancel, 250);
  };

  document.addEventListener('mouseover', (e) => {
    const t = e.target && e.target.closest && e.target.closest('.lastcmd');
    if (!t) return;
    if (t === activeEl) return;
    cancel();
    activeEl = t;
    const text = (t.textContent || '').trim();
    if (!text) return;
    timer = setTimeout(() => {
      if (activeEl !== t) return;
      popup = document.createElement('div');
      popup.className = 'long-hover-tooltip';
      popup.textContent = text;
      // Allow text selection inside the popup so the user can copy the
      // command. Also pause auto-hide while the pointer is over the popup.
      popup.addEventListener('mouseenter', () => { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } });
      popup.addEventListener('mouseleave', scheduleHide);
      document.body.appendChild(popup);
      const r = t.getBoundingClientRect();
      const pr = popup.getBoundingClientRect();
      let top = r.top - pr.height - 6;
      let left = r.left;
      if (top < 4) top = r.bottom + 6;
      // Right clamp
      if (left + pr.width > window.innerWidth - 8) left = window.innerWidth - pr.width - 8;
      // Left clamp
      if (left < 8) left = 8;
      popup.style.position = 'fixed';
      popup.style.top = top + 'px';
      popup.style.left = left + 'px';
      timer = null;
    }, 1000);
  });
  document.addEventListener('mouseout', (e) => {
    const t = e.target && e.target.closest && e.target.closest('.lastcmd');
    if (!t) return;
    // If the mouse is moving into the popup, keep it visible.
    if (popup && e.relatedTarget && (e.relatedTarget === popup || popup.contains(e.relatedTarget))) return;
    scheduleHide();
  });
  // Cancel on scroll/resize so the popup never drifts from its anchor
  window.addEventListener('scroll', cancel, true);
  window.addEventListener('resize', cancel);
  // Click anywhere dismisses the popup
  document.addEventListener('click', (e) => {
    if (popup && e.target !== popup && !popup.contains(e.target)) cancel();
  }, true);
}

window.LastCmdTooltip = { setupLastCmdTooltips };
