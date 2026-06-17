// renderer/components/HelpDelegation.js
// Help-Button-Delegation auf document. Phase 3 Block 8.
// Vermeidet das Anhängen von Click-Listenern an jeden einzelnen
// Help-Button (auch dynamisch hinzugefügte funktionieren automatisch,
// solange sie das Attribut tragen).

/**
 * @param {(topic: string, fallback: string|null) => void} [showHelp]
 *   Default: window.showHelp (gesetzt von app.js am File-Ende).
 */
function setupHelpDelegation(showHelp) {
  const handler = showHelp || window.showHelp;
  if (typeof handler !== 'function') {
    // Fail-soft: loggen, aber keinen Crash werfen. Setup läuft
    // einfach leer.
    console.warn('HelpDelegation: no showHelp callback available');
    return;
  }
  document.addEventListener('click', (e) => {
    const t = e.target && e.target.closest && e.target.closest('[data-help-topic]');
    if (!t) return;
    // Suppress help for form controls (INPUT/SELECT/TEXTAREA)
    // — clicking into the folder-browser filter, a prompt
    // textarea, or a model dropdown should focus the control,
    // not pop a help modal. The help is still reachable via
    // the surrounding label / the explicit ? icon.
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const topic = t.getAttribute('data-help-topic');
    handler(topic, t.getAttribute('title') || null);
  });
}

window.HelpDelegation = { setupHelpDelegation };
