// renderer/services/MmxService.js
// Renderer-seitiger Wrapper für mmx-Runs. Kapselt window.api.mmxRun
// + onLog-Streaming. Streamt Logs über den EventBus als `mmx:log`.

async function run(args) {
  if (window.AppState && window.AppState.config && !window.AppState.config.api_key) {
    return { ok: false, code: -1, stdout: '', stderr: 'No API key configured.', parsed: null };
  }
  try {
    const r = await window.api.mmxRun(args);
    return r;
  } catch (e) {
    return { ok: false, code: -1, stdout: '', stderr: String((e && e.message) || e), parsed: null };
  }
}

function cancel() {
  if (window.api && typeof window.api.mmxCancel === 'function') {
    return window.api.mmxCancel();
  }
  return Promise.resolve({ ok: false, error: 'mmxCancel not available' });
}

// Streamt Live-Logs in den Renderer. Wird in bootstrap.js einmalig
// beim App-Start aufgerufen, um die IPC-Log-Brücke zu aktivieren.
function attachLogStream() {
  if (!window.api || typeof window.api.onLog !== 'function') return () => {};
  return window.api.onLog((line) => {
    if (window.EventBus) window.EventBus.emit('mmx:log', line);
  });
}

window.MmxService = { run, cancel, attachLogStream };
