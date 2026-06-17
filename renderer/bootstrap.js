// renderer/bootstrap.js
// Phase 3 Skeleton-Bootstrap. Wird VOR app.js geladen (siehe index.html).
// Seine Aufgabe in dieser Phase: die neuen Foundation-Module initialisieren
// und sie auf `window.*` verfügbar machen. Die alte app.js kann die neuen
// Module schrittweise übernehmen.
//
// In einer späteren Phase wird app.js zu einem reinen "Legacy-Rest"-
// Loader; irgendwann verschwindet es ganz und der Bootstrap übernimmt
// das vollständige `init()`-Setup.

(function bootstrapRenderer() {
  // 1) Theme aus dem persistierten State anwenden (frühester Punkt, damit
  //    der User keinen FOUC sieht).
  if (window.ThemeService && window.AppState) {
    window.ThemeService.apply(window.AppState.theme);
  }

  // 2) Live-Log-Stream vom Main-Process an den EventBus weiterreichen.
  //    MmxService.emit('mmx:log', line); LogService hört mit.
  if (window.MmxService) {
    window.MmxService.attachLogStream();
  }

  // 3) LogService: bounded Ring-Buffer für UI-Konsumenten. Wird VOR
  //    der ersten mmx-Aktivität gestartet, damit keine Logs verloren
  //    gehen.
  if (window.LogService) {
    window.LogService.init();
  }

  // 4) State aus state.json in den AppState laden (best-effort; schlägt
  //    beim ersten Start fehl → Default-Werte bleiben).
  if (window.api && typeof window.api.stateGet === 'function') {
    window.api.stateGet().then((persisted) => {
      if (!persisted || typeof persisted !== 'object') return;
      Object.assign(window.AppState, persisted);
      if (window.ThemeService) window.ThemeService.apply(window.AppState.theme);
    }).catch((e) => console.warn('[bootstrap] stateGet failed:', e));
  }

  // 5) Versions-String (BRAND_VERSION) in den Topbar stempeln.
  if (window.api && typeof window.api.getAppVersion === 'function') {
    window.api.getAppVersion().then((info) => {
      const v = (info && info.version) || 'unknown';
      const el = document.getElementById('brand-version');
      if (el) el.textContent = 'v' + v;
    }).catch(() => {});
  }
})();
