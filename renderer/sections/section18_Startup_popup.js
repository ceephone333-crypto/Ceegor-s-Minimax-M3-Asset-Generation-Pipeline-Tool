// renderer/sections/section18_Startup_popup.js (Phase 3 Block 29)
// Extracted: Startup popup
// Source: app.js L722..824

// ----------------- Startup popup -----------------
// Shown on every fresh launch. Single OK button to dismiss. Reachable later
// from the âš™ Settings menu (TODO: wire into settings if needed).
//
// Honours the user-configurable popup policy (state.popupPolicy):
//   'once-fresh'   â€” default. Show on every fresh launch until the user
//                    dismisses it; once dismissed, never show again.
//   'per-session'  â€” Show once per app start.
//   'never'        â€” Skip entirely.
//   'always'       â€” Always show (ignoring any prior dismissal).
// The popup id is 'startup'. openGatedPopup() is the central dispatcher;
// new tab-triggered popups should reuse it with their own stable id.
function shouldShowPopup(id) {
  const policy = state.popupPolicy || 'once-fresh';
  if (policy === 'always') return true;
  if (policy === 'never') return false;
  if (policy === 'per-session') {
    return !_popupSeenThisSession.has(id);
  }
  // 'once-fresh' (default): persist dismissal in state.seenPopups so
  // a returning user never sees the popup again unless they reset
  // the seen set from âš™ Settings â†’ Popups.
  return !(state.seenPopups && state.seenPopups[id]);
}
function markPopupSeen(id) {
  if (!id) return;
  _popupSeenThisSession.add(id);
  if (!state.seenPopups || typeof state.seenPopups !== 'object') state.seenPopups = {};
  state.seenPopups[id] = new Date().toISOString();
  scheduleStateSave();
}
function resetPopupSeen() {
  // Wipe both the persistent record AND the per-session set so a
  // "Reset all popup history" action in âš™ Settings immediately
  // re-triggers every popup on the very next trigger.
  state.seenPopups = {};
  _popupSeenThisSession.clear();
  scheduleStateSave();
}
function openGatedPopup(id, build) {
  // Centralised dispatcher: gates a popup behind the user's chosen
  // popup policy, then opens it via the standard showModal() so it
  // gets all the same Esc/click-outside/stack behaviour as every
  // other dialog. Callers wrap the popup body in `build(m, close,
  // markSeen)` and MUST call `markSeen()` exactly once (typically
  // from every close path) so the 'once-fresh' / 'per-session'
  // policies don't re-fire it.
  if (!shouldShowPopup(id)) return null;
  const markSeen = () => markPopupSeen(id);
  return showModal((m, close) => {
    build(m, close, markSeen);
  });
}
function showStartupPopup() {
  openGatedPopup('startup', (m, close, markSeen) => {
    m.classList.add('startup-modal');
    m.appendChild(el('h2', {}, TOOL_NAME));
    m.appendChild(el('div', { class: 'startup-version' }, BUILD_VERSION));
    m.appendChild(el('p', { class: 'startup-info' }, TOOL_INFO));
    const shortcuts = el('div', { class: 'shortcuts-box' });
    shortcuts.appendChild(el('h4', {}, 'âŒ¨ Keyboard shortcuts'));
    const list = [
      ['Ctrl+Enter', 'Generate on the active tab (same as clicking the big Generate button)'],
      ['Ctrl+1 / 2 / 3 / 4', 'Switch to the Image / Speech / Music / Video tab'],
      ['Ctrl+B', 'Open BatchGen for the active tab (queue multiple prompts to run in sequence)'],
      ['Ctrl+T', 'Open Style Settings (manage your saved prompt prefixes)'],
      ['Ctrl+S', 'Open Settings (API key, output folder, region, theme, image pipeline)'],
      ['Ctrl+L', 'Switch between dark and light mode'],
      ['Ctrl+F', 'Focus the file-browser filter (start typing to filter the file list)'],
      ['Ctrl+R', 'Refresh the quota counter (how many generations you have left)'],
      ['â† / â†’', 'When the image overlay is open: step to the previous / next image (multi-image batch, or all images in the current folder)'],
    ];
    for (const [keys, desc] of list) {
      shortcuts.appendChild(el('div', { class: 'shortcut-row' }, [
        el('kbd', {}, keys),
        el('span', {}, desc),
      ]));
    }
    m.appendChild(shortcuts);
    m.appendChild(el('div', { class: 'footer' }, [
      el('button', { class: 'primary', onclick: () => {
        markSeen();
        close();
        // After the user dismisses the greetings popup, if any of the
        // essential settings (api_key, output_dir) are still empty, walk
        // them through the first-time setup form. The folder field uses
        // the standard Windows folder-selection dialog via pickFolder.
        // Otherwise (config already valid), skip straight to the
        // unified "Optional add-ons" popup so a user with a fresh
        // ./bin/ also discovers the one-click installers for
        // Real-ESRGAN, the IS-Net binary, and the IS-Net model.
        if (!state.config.api_key || !state.config.output_dir) {
          openFirstTimeSetup();
        } else if (!state.realesrganFirstRunDismissed) {
          openOptionalAddons({ autoOpened: true }).catch(() => {});
        }
      } }, 'OK'),
    ]));
    // OK on Enter for convenience
    setTimeout(() => { m.querySelector('button.primary')?.focus(); }, 0);
  });
}

