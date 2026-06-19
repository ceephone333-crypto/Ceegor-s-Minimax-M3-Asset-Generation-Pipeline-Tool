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
})();