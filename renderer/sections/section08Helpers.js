// renderer/sections/section08Helpers.js
// v1.1 (lint-size split + audit BUG-N6): extracted helpers
// from section08_Image_pipeline__Upscale___Crop___Convert_.js
// so that file stays under the 500-line HARD limit. Loaded
// BEFORE section08 in index.html.

// v1.1 (audit BUG-N6): resilient addLogEvent wrapper. The
// upscale section logs the start / success / failure of an
// upscale action to the structured log pane. If LogService.js
// failed to load, `window.addLogEvent` is undefined and the
// action would be invisible in the log pane. The wrapper
// falls back to:
//   (1) `window.LogService.addLogEvent` (the underlying
//       service exposes the same API on most code paths), then
//   (2) `console.log` so a developer running DevTools still
//       sees the event.
window.Section08Helpers = (function () {
  function makeResilientAddLog() {
    return function addLog(opts) {
      if (typeof window.addLogEvent === 'function') {
        try { window.addLogEvent(opts); return; } catch (_) { /* fall through */ }
      }
      if (window.LogService && typeof window.LogService.addLogEvent === 'function') {
        try { window.LogService.addLogEvent(opts); return; } catch (_) { /* fall through */ }
      }
      try {
        // eslint-disable-next-line no-console
        console.log('[upscale-log-fallback]', opts && opts.headline, '|', (opts && opts.details || []).join(' | '));
      } catch (_) { /* give up */ }
    };
  }
  return { makeResilientAddLog };
})();
