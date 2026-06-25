// renderer/sections/section18_Startup_popup.js (Phase 3 Block 29)
// Extracted: Startup popup
// Source: app.js L722..824

// ----------------- Startup popup -----------------
// Shown on every fresh launch. Single OK button to dismiss. Reachable later
// from the ⚙ Settings menu (TODO: wire into settings if needed).
//
// Honours the user-configurable popup policy (state.popupPolicy):
//   'once-fresh'   — default. Show on every fresh launch until the user
//                    dismisses it; once dismissed, never show again.
//   'per-session'  — Show once per app start.
//   'never'        — Skip entirely.
//   'always'       — Always show (ignoring any prior dismissal).
// The popup id is 'startup'. openGatedPopup() is the central dispatcher;
// new tab-triggered popups should reuse it with their own stable id.
function shouldShowPopup(id) {
  // v1.1 (user request — "make popups off default off"): the
  // fallback when state.popupPolicy is undefined was 'once-fresh',
  // which would actually SHOW the popup. The pre-v1.1 default in
  // state.js / section24_State.js is 'never', so a normal install
  // never hits this branch — but a defensive code path (e.g. a
  // future caller that explicitly nulls state.popupPolicy) used
  // to fall through to the wrong default. We now mirror the
  // 'never' default so every undefined / null / empty-string case
  // hides the popup, matching the user-visible "default off"
  // expectation.
  const policy = state.popupPolicy || 'never';
  if (policy === 'always') return true;
  if (policy === 'never') return false;
  if (policy === 'per-session') {
    return !_popupSeenThisSession.has(id);
  }
  // 'once-fresh' (default): persist dismissal in state.seenPopups so
  // a returning user never sees the popup again unless they reset
  // the seen set from ⚙ Settings → Popups.
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
  // "Reset all popup history" action in ⚙ Settings immediately
  // re-triggers every popup on the very next trigger.
  state.seenPopups = {};
  _popupSeenThisSession.clear();
  scheduleStateSave();
}
function openGatedPopup(id, build, opts) {
  // Centralised dispatcher: gates a popup behind the user's chosen
  // popup policy, then opens it via the standard showModal() so it
  // gets all the same Esc/click-outside/stack behaviour as every
  // other dialog. Callers wrap the popup body in `build(m, close,
  // markSeen)` and MUST call `markSeen()` exactly once (typically
  // from every close path) so the 'once-fresh' / 'per-session'
  // policies don't re-fire it.
  //
  // `opts` is forwarded to showModal so callers can attach an
  // `onClose` hook (e.g. the startup-popup chain uses it to
  // decrement a counter and fire the pending tab-intro popup).
  // `opts.force` bypasses the policy gate for popups that are NOT
  // informational nags but required flows (the first-time setup form).
  if (!(opts && opts.force) && !shouldShowPopup(id)) {
    // v1.1.26: log the suppression too — when the user reports
    // "I never see the welcome popup", the breadcrumb must show
    // the policy decision.
    if (typeof window.logAction === 'function') {
      window.logAction('popup', 'suppressed-by-policy', {
        id,
        policy: state.popupPolicy || '(unset)',
      });
    }
    // Bug-fix (reported by user — popups behaviour): even when the popup
    // is suppressed by policy, fire the caller's onClose hook so any
    // bookkeeping it set up BEFORE calling us is balanced. The
    // startup-popup chain increments _introStartupChainOpen before
    // calling openGatedPopup and relies on onClose to decrement it;
    // without this, a suppressed startup/first-time popup left the
    // counter stuck > 0 and every later tab-intro popup was deferred
    // forever (so toggling the policy back on appeared to do nothing).
    if (opts && typeof opts.onClose === 'function') {
      try { opts.onClose(); }
      catch (err) {
        // v1.1.25: a popup's onClose hook is part of the startup
        // chain bookkeeping; if it throws (e.g. a buggy listener),
        // we used to swallow it and end up with the chain counter
        // stuck — every later gated popup got deferred forever.
        if (typeof window.logError === 'function') {
          window.logError('popup-onClose', `renderer/sections/section18_Startup_popup.js:openGatedPopup:${id}`, err);
        }
      }
    }
    return null;
  }
  if (typeof window.logAction === 'function') {
    window.logAction('popup', 'show', { id, forced: !!(opts && opts.force) });
  }
  const markSeen = () => {
    if (typeof window.logAction === 'function') {
      window.logAction('popup', 'mark-seen', { id });
    }
    markPopupSeen(id);
  };
  return showModal((m, close) => {
    build(m, close, markSeen);
  }, opts || null);
}
function showStartupPopup() {
  // Enter the startup-popup chain so showTab() defers any
  // tab-intro popup until the user has dismissed welcome +
  // (optional) first-time-setup + (optional) optional-addons.
  if (typeof _enterIntroStartupChain === 'function') _enterIntroStartupChain();
  // Exit the chain whenever this popup closes (any path: OK, Esc,
  // click-outside). If a follow-up popup (setup / addons) is about
  // to open, it will re-enter the chain itself, so the counter
  // stays balanced.
  const _exit = () => { if (typeof _exitIntroStartupChain === 'function') _exitIntroStartupChain(); };
  // Bug-fix (reported by user — "we still see lots of popups, even
  // though they are turned off"): the previous version auto-fired
  // `openFirstTimeSetup()` here whenever the welcome popup was
  // suppressed by policy and the user had an incomplete config.
  // That made "default off" a lie — the user would see the
  // first-time-setup modal even when they had explicitly turned
  // every informational popup off. The user's request is now
  // honored literally: when the popup policy suppresses the
  // welcome popup, we DO NOT trigger any follow-up popup. The
  // user can still run the first-time setup manually from ⚙
  // Settings → "Run first-time setup" (see
  // buildSettingsAccountPane in section03). The follow-up addon
  // popup (in openFirstTimeSetup's onClose) is also gated by
  // `shouldShowPopup('optional-addons')` so it won't nag either.
  openGatedPopup('startup', (m, close, markSeen) => {
    m.classList.add('startup-modal');
    m.appendChild(el('h2', {}, TOOL_NAME));
    m.appendChild(el('div', { class: 'startup-version' }, BUILD_VERSION));
    m.appendChild(el('p', { class: 'startup-info' }, TOOL_INFO));
    const shortcuts = el('div', { class: 'shortcuts-box' });
    shortcuts.appendChild(el('h4', {}, '⌨ Keyboard shortcuts'));
    const list = [
      ['Ctrl+Enter', 'Generate on the active tab (same as clicking the big Generate button)'],
      ['Ctrl+1 / 2 / 3 / 4', 'Switch to the Image / Speech / Music / Video tab'],
      ['Ctrl+B', 'Open BatchGen for the active tab (queue multiple prompts to run in sequence)'],
      ['Ctrl+T', 'Open Style Settings (manage your saved prompt prefixes)'],
      ['Ctrl+S', 'Open Settings (API key, output folder, region, theme, image pipeline)'],
      ['Ctrl+L', 'Switch between dark and light mode'],
      ['Ctrl+F', 'Focus the file-browser filter (start typing to filter the file list)'],
      ['Ctrl+R', 'Refresh the quota counter (how many generations you have left)'],
      ['← / →', 'When the image overlay is open: step to the previous / next image (multi-image batch, or all images in the current folder)'],
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
  }, { onClose: _exit });
}