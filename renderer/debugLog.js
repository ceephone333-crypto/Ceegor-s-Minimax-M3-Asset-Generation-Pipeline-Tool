// renderer/debugLog.js - Phase 4 Fix 21 + v1.1.25 logging expansion
// Wird ZUERST geladen (vor allen anderen script-Tags). Installiert
// globale Error-Handler die JEDEN Fehler im Renderer in eine
// Datei schreiben:  C:\Projects\Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool\renderer-error.log
//
// Verwendung: tool starten, crashen lassen, dann die Log-Datei
// im Projekt-Root lesen.
//
// v1.1.25: also exposes window.logError(category, location, err)
// — a thin wrapper that calls addLogEvent (so the in-app log pane
// shows the error AND it's persisted in the log buffer) AND
// console.error (so the file logger above captures it). Catch
// blocks across the renderer should use this instead of plain
// `console.error` so the user sees the error in the log pane too.

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
  log('=== renderer-debug started (pid=' + (typeof process !== 'undefined' && process?.pid || 'n/a') + ') ===');
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

  // v1.1.25: window.logError — call from catch blocks across the
  // renderer so a swallowed error (a) reaches renderer-error.log
  // via the console.error wrapper above, AND (b) appears in the
  // in-app log pane via addLogEvent. Without this helper, a
  // `catch (_) { /* ignore */ }` block silently loses the error
  // and the user has to re-trigger the bug to report it.
  //
  //   logError(category, location, err)
  //     category : short tag for the call-site (e.g. 'fb-up',
  //                'audio-cut', 'state-save'). Used as the log
  //                headline prefix and in the file log line.
  //     location : "path/to/file.js:lineno" — where the error
  //                happened. Becomes part of the details.
  //     err      : the error object (or string, or null). We
  //                pull .message/.stack if present, else stringify.
  //
  // We deliberately do NOT throw if any sub-step fails — the
  // logger must never crash the caller.
  function _stringifyErr(err) {
    if (err == null) return '(no error object)';
    if (typeof err === 'string') return err;
    if (err.stack) return err.stack;
    if (err.message) return err.message;
    try { return String(err); } catch (_) { return '(unstringifiable error)'; }
  }
  window.logError = function logError(category, location, err) {
    try {
      const text = _stringifyErr(err);
      const cat = String(category || 'uncaught');
      const loc = String(location || 'unknown');
      const headline = `[${cat}] error at ${loc}`;
      // 1) File log (via console.error wrapper).
      console.error(cat, loc, text);
      // 2) In-app log pane (when addLogEvent is loaded).
      try {
        if (typeof window.addLogEvent === 'function') {
          window.addLogEvent({
            category: 'error',
            headline,
            details: [text],
            result: 'err',
          });
        } else if (window.LogService && typeof window.LogService.addLogEvent === 'function') {
          window.LogService.addLogEvent({
            category: 'error',
            headline,
            details: [text],
            result: 'err',
          });
        }
      } catch (_) { /* addLogEvent itself failed — console.error already fired */ }
    } catch (_) { /* never throw from the logger */ }
  };
  // v1.1.25: window.logWarn — same shape, severity 'warn' (used
  // for non-fatal anomalies a developer would want to see — e.g.
  // a retryable IPC timeout that succeeded on the second try).
  window.logWarn = function logWarn(category, location, msg) {
    try {
      const cat = String(category || 'warn');
      const loc = String(location || 'unknown');
      const text = (msg && msg.stack) || String(msg || '');
      const headline = `[${cat}] warning at ${loc}`;
      console.warn(cat, loc, text);
      try {
        if (typeof window.addLogEvent === 'function') {
          window.addLogEvent({ category: 'info', headline, details: [text] });
        } else if (window.LogService && typeof window.LogService.addLogEvent === 'function') {
          window.LogService.addLogEvent({ category: 'info', headline, details: [text] });
        }
      } catch (_) {}
    } catch (_) {}
  };
})();
