// renderer/debugLog.js - Phase 4 Fix 21
// Wird ZUERST geladen (vor allen anderen script-Tags). Installiert
// globale Error-Handler die JEDEN Fehler im Renderer in eine
// Datei schreiben:  C:\Projects\Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool\renderer-error.log
//
// Verwendung: tool starten, crashen lassen, dann die Log-Datei
// im Projekt-Root lesen.

(function installDebugLogger() {
  const sendToFile = (line) => {
    // window.api existiert noch nicht (wird von preload spaeter
    // gesetzt). Wir versuchen es immer, wenn verfuegbar.
    try {
      if (window.api && typeof window.api.logToFile === 'function') {
        window.api.logToFile(line);
      }
    } catch (_) {}
  };
  // Buffer bis window.api verfuegbar ist
  const buffer = [];
  const flush = () => {
    while (buffer.length) sendToFile(buffer.shift());
  };
  let flushHandle = setInterval(() => {
    if (window.api && typeof window.api.logToFile === 'function') {
      clearInterval(flushHandle); flushHandle = null;
      flush();
    }
  }, 50);
  const log = (msg) => {
    sendToFile(msg);
    buffer.push(msg);
  };
  log('=== renderer-debug started (pid=' + (process?.pid || 'n/a') + ') ===');
  log('location=' + location.href);
  log('userAgent=' + navigator.userAgent);

  // Error-Handler SO FRUEH wie moeglich registrieren
  window.addEventListener('error', (e) => {
    const s = 'ERR ' + (e.filename || '?') + ':' + (e.lineno || '?') + ':' + (e.colno || '?') + ' ' + (e.error?.stack || e.error?.message || e.message || 'unknown');
    log(s);
  }, true);
  window.addEventListener('unhandledrejection', (e) => {
    log('REJ ' + (e.reason?.stack || e.reason?.message || e.reason || 'unknown'));
  }, true);
  const origErr = console.error;
  console.error = function() {
    try { log('CE: ' + Array.from(arguments).map(a => a?.stack || a?.message || String(a)).join(' | ')); } catch (_) {}
    origErr.apply(console, arguments);
  };
  const origWarn = console.warn;
  console.warn = function() {
    try { log('CW: ' + Array.from(arguments).map(a => String(a)).join(' | ')); } catch (_) {}
    origWarn.apply(console, arguments);
  };
  // Probe (nach allen script-Tags): pruefe ob bekannte Vars/Funcs da sind
  const probe = setInterval(() => {
    log('probe: applyFileSearch=' + (typeof applyFileSearch) +
        ' refreshBrowser=' + (typeof refreshBrowser) +
        ' state=' + (typeof state) + ' window.state=' + (typeof window.state) +
        ' TABS.image=' + (typeof TABS?.image) + ' TABS.speech=' + (typeof TABS?.speech) +
        ' init=' + (typeof init));
  }, 500);
  // Stop probing nach 30s
  setTimeout(() => clearInterval(probe), 30000);
})();
