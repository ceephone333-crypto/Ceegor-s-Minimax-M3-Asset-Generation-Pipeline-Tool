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
})();