// renderer/bootstrap.js
// Bug-fix #9 (2026-06-19): trimmed to the one live job (version
// stamp in the topbar). The previous version also initialised
// ThemeService / AppState / MmxService.attachLogStream / LogService
// and loaded state into the now-removed window.AppState — none
// of those modules are loaded any more (they were dead: ThemeService
// had zero subscribers, the AppState the bootstrap wrote to was
// never read by the actual app — it uses `window.state` from
// section24_State.js — and the live log pane is fed by app.js's
// `window.api.onLog`, not the EventBus bridge).

(function bootstrapRenderer() {
  // Version-String in den Topbar stempeln.
  if (window.api && typeof window.api.getAppVersion === 'function') {
    window.api.getAppVersion().then((info) => {
      const v = (info && info.version) || 'unknown';
      const el = document.getElementById('brand-version');
      if (el) el.textContent = 'v' + v;
    }).catch(() => {});
  }
  // v1.1.15 (reported by user): the hover-help tooltip
  // (`data-help` icons) and the click-delegation for topic-
  // keyed help (`data-help-topic`) were both defined but
  // NEVER WIRED UP — the renderer loaded the modules but
  // bootstrap.js never called their setup functions, so a
  // hover over any `data-help` icon did nothing AND clicking
  // a `data-help-topic` element did nothing. Wire them up
  // here (after the modules have loaded) so the hover
  // tooltips and topic-keyed help actually fire. Both are
  // event-delegation-based so calling setup once is
  // sufficient for the whole lifetime of the renderer.
  try {
    if (window.HelpTooltip && typeof window.HelpTooltip.setupHoverHelpTooltips === 'function') {
      window.HelpTooltip.setupHoverHelpTooltips();
    }
  } catch (e) { console.warn('setupHoverHelpTooltips failed:', e); }
  try {
    if (window.HelpDelegation && typeof window.HelpDelegation.setupHelpDelegation === 'function') {
      window.HelpDelegation.setupHelpDelegation();
    }
  } catch (e) { console.warn('setupHelpDelegation failed:', e); }
  // Phase B: boot the active-jobs widget. The widget is a pure
  // projection of state.jobs so it doesn't need any extra setup;
  // it just subscribes to JobRunner events and renders.
  try {
    if (window.ActiveJobsWidget && typeof window.ActiveJobsWidget.init === 'function') {
      window.ActiveJobsWidget.init();
    }
  } catch (e) { console.warn('ActiveJobsWidget.init failed:', e); }
  // LogService wiring — the log pane needs two pieces of setup:
  //   (a) the click + keyboard listener on #log that toggles
  //       row expansion when the user clicks the chev (the `>`
  //       glyph on the right of each log row) — BUG-9-06
  //       (user-reported, 2026-06-25): the previous render of
  //       this file forgot to call LogService.init(), so the
  //       chev click was a dead button and the log text was
  //       not selectable. Wire it up here.
  //   (b) the toolbar wiring (#log-collapse-all, #log-expand-all,
  //       #log-clear, #log-copy, #log-jump-newest, #log-jump-oldest)
  //       — `setupLogToolbar()` (already called from app.js init).
  try {
    if (window.LogService && typeof window.LogService.init === 'function') {
      window.LogService.init();
    }
  } catch (e) { console.warn('LogService.init failed:', e); }
  // Phase C (bug-fix B1b, _temp5.md): the persisted-L2 render call
  // used to live HERE — at script-parse time. But the disk state is
  // loaded later in app.js init() (on DOMContentLoaded, well after
  // this IIFE runs), so state.jobsSnapshot was ALWAYS null/undefined
  // at the moment renderPersistedL2 ran, and the call was never
  // repeated. The "previous session" log rows therefore never
  // showed. The call now lives in init() right after the
  // persist-keys load loop populates state.jobsSnapshot.
})();