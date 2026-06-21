// main/index.js — Electron-Main-Bootstrap (Composition Root).
// Setzt app.commandLine-Switches, registriert alle IPC-Handler und
// startet das Haupt-BrowserWindow. Enthält **keine** Geschäftslogik.

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain } = require('electron');

const APP_ROOT = __dirname;
const PARENT_ROOT = path.resolve(APP_ROOT, '..'); // __dirname = main/, parent = project root
const DEBUG_ENV_PATH = path.join(PARENT_ROOT, '.dbg', 'full-tool-sweep.env');

let debugServerUrl = '';
let debugSessionId = '';
function reportIpcDebugEvent(runId, hypothesisId, location, msg, data) {
  if (debugServerUrl === '') {
    debugServerUrl = null;
    debugSessionId = 'full-tool-sweep';
    try {
      const envText = fs.readFileSync(DEBUG_ENV_PATH, 'utf8');
      debugServerUrl = envText.match(/DEBUG_SERVER_URL=(.+)/)?.[1]?.trim() || null;
      debugSessionId = envText.match(/DEBUG_SESSION_ID=(.+)/)?.[1]?.trim() || debugSessionId;
    } catch {
      debugServerUrl = null;
    }
  }
  if (!debugServerUrl || typeof fetch !== 'function') return;
  fetch(debugServerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: debugSessionId,
      runId,
      hypothesisId,
      location,
      msg,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {});
}

const originalIpcHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => {
  // #region debug-point A:ipc-registration
  reportIpcDebugEvent('pre-fix', 'A', 'main/index.js:ipcMain.handle', `[DEBUG] register ${channel}`, { channel });
  // #endregion
  return originalIpcHandle(channel, async (event, ...args) => {
    // #region debug-point B:ipc-invoke
    reportIpcDebugEvent('pre-fix', 'B', `ipc:${channel}:enter`, `[DEBUG] invoke ${channel}`, {
      channel,
      argc: args.length,
      senderId: event?.sender?.id ?? null,
    });
    // #endregion
    try {
      const result = await handler(event, ...args);
      // #region debug-point C:ipc-result
      reportIpcDebugEvent('pre-fix', 'C', `ipc:${channel}:result`, `[DEBUG] result ${channel}`, {
        channel,
        ok: result?.ok ?? null,
        keys: result && typeof result === 'object' ? Object.keys(result).slice(0, 12) : [],
      });
      // #endregion
      return result;
    } catch (error) {
      // #region debug-point D:ipc-throw
      reportIpcDebugEvent('pre-fix', 'D', `ipc:${channel}:throw`, `[DEBUG] throw ${channel}`, {
        channel,
        error: String((error && error.message) || error),
      });
      // #endregion
      throw error;
    }
  });
};

// Phase 4 Fix 21: renderer-error.log Handler. Schreibt alle
// Errors aus dem Renderer in eine Datei im Projekt-Root, damit
// wir ohne DevTools sehen was passiert.
const RENDERER_LOG = path.join(PARENT_ROOT, 'renderer-error.log');
ipcMain.on('renderer:log', (event, line) => {
  try {
    const ts = new Date().toISOString().slice(11, 23);
    fs.appendFileSync(RENDERER_LOG, ts + ' ' + line + '\n');
  } catch (e) { /* ignore - secondary failure */ }
});
// Truncate log on app start
try { fs.writeFileSync(RENDERER_LOG, '=== renderer-error.log @ ' + new Date().toISOString() + ' ===\n'); } catch (_) {}

process.on('uncaughtException', (err) => {
  try {
    const ts = new Date().toISOString().slice(11, 23);
    const msg = `[main] uncaughtException: ${err && err.stack ? err.stack : err}`;
    fs.appendFileSync(RENDERER_LOG, ts + ' ' + msg + '\n');
    console.error(msg);
  } catch (_) {}
});

process.on('unhandledRejection', (reason) => {
  try {
    const ts = new Date().toISOString().slice(11, 23);
    const msg = `[main] unhandledRejection: ${reason && reason.stack ? reason.stack : reason}`;
    fs.appendFileSync(RENDERER_LOG, ts + ' ' + msg + '\n');
    console.error(msg);
  } catch (_) {}
});

// Side-Effect: setzt globale Electron-Switches (DPI, Occlusion).
require('./window/windowSecurity');

const { createMainWindow } = require('./window/createMainWindow');

// IPC-Registrierungen (jede Datei kapselt eine Domäne).
// Bug-fix #9 (2026-06-19): dropped the unused voicesCache
// require here — the cache is constructed lazily by
// registerMmxIpc, and reset() is now invoked from
// registerConfigIpc when the user changes their API key.
const ipcRegistrars = [
  require('./ipc/registerAppIpc'),
  require('./ipc/registerConfigIpc'),
  require('./ipc/registerMmxIpc'),
  require('./ipc/registerUpscaleIpc'),
  require('./ipc/registerIsnetbgIpc'),
  require('./ipc/registerImageIpc'),
  require('./ipc/registerAudioIpc'),
  require('./ipc/registerFileBrowserIpc'),
  require('./ipc/registerBatchesIpc'),
  require('./ipc/registerStateIpc'),
  require('./ipc/registerInstallIpc'),
  require('./ipc/registerFilePickerIpc'),
];

let mainWindow = null;

const getMainWindow = () => mainWindow;

app.whenReady().then(() => {
  // 1) IPC-Handler registrieren
  for (const r of ipcRegistrars) {
    try { r.register({ appRoot: PARENT_ROOT, getMainWindow }); }
    catch (e) { console.error('[main] IPC registrar failed:', e); }
  }

  // 2) Haupt-Fenster
  mainWindow = createMainWindow(PARENT_ROOT, {
    cancelActiveJobs: () => {
      // Best-effort: laufende mmx-Spawns abbrechen.
      try { require('../src/mmx').cancelAll(); } catch (_) {}
    },
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow(PARENT_ROOT, {
        cancelActiveJobs: () => {
          try { require('../src/mmx').cancelAll(); } catch (_) {}
        },
      });
    }
  });
});

app.on('window-all-closed', () => {
  // Audio-Spawns / Voices-Cache sind nicht persistent → kein expliziter Cleanup nötig.
  if (process.platform !== 'darwin') app.quit();
});
