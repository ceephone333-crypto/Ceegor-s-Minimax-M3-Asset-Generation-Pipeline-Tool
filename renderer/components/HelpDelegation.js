// renderer/components/HelpDelegation.js
// Click delegation for the `?` help icons. BUG-9-05
// (user-reported, 2026-06-25): per the user's spec, the `?`
// icons are HOVER-ONLY — the click handler is a no-op (it
// preventDefault + stopPropagation so the button never submits
// or bubbles), and the help text is shown on mouseover via the
// HelpTooltip system (renderer/components/HelpTooltip.js). No
// modal opens on click any more. The legacy `data-help-topic`
// attribute is still on the icons (it was used by the previous
// click-to-open-modal path) but the new behaviour is hover-only
// and the attribute is no longer read.
//
// We still gate on `.help-button` / `.help-btn` class names
// (so unrelated clicks on the page don't hit this listener)
// and the tag is not INPUT/SELECT/TEXTAREA (so a click on a
// form control inside a `?`-bearing element doesn't trigger
// the no-op).

/**
 * @param {(topic: string, fallback: string|null) => void} [showHelp]
 *   Default: window.showHelp (gesetzt von app.js am File-Ende).
 *   NOTE: with BUG-9-05, this callback is no longer called —
 *   kept as a parameter for backwards compatibility with any
 *   caller that still wires it up.
 */
function setupHelpDelegation(showHelp) {
  // Backwards-compat: if a caller passes showHelp, we ignore
  // it now (the user asked for hover-only, no modals on click).
  // We keep the parameter so existing bootstrap code that
  // calls `HelpDelegation.setupHelpDelegation(showHelp)` doesn't
  // have to change.
  void showHelp;
  document.addEventListener('click', (e) => {
    // Only react to clicks on a real help icon — otherwise
    // this delegation would intercept every click on the page.
    const t = e.target && e.target.closest && e.target.closest('.help-button, .help-btn');
    if (!t) return;
    // Don't hijack clicks on form controls (a `?` icon next
    // to a form control shouldn't break the control's click).
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
      return;
    }
    // No modal opens. We just preventDefault + stopPropagation
    // so the button never submits a form / never bubbles to
    // another listener that would re-interpret the click.
    e.preventDefault();
    e.stopPropagation();
    // (The hover tooltip is wired by HelpTooltip.js + the
    //  `data-help` attribute on the icon.)
  });
}

window.HelpDelegation = { setupHelpDelegation };
