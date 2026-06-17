// main/index.js — Electron-Main-Bootstrap (Composition Root).
// Setzt app.commandLine-Switches, registriert alle IPC-Handler und
// startet das Haupt-BrowserWindow. Enthält **keine** Geschäftslogik.

const path = require('path');
const { app, BrowserWindow } = require('electron');

const APP_ROOT = __dirname;
const PARENT_ROOT = path.resolve(APP_ROOT, '..'); // __dirname = main/, parent = project root

// Side-Effect: setzt globale Electron-Switches (DPI, Occlusion).
require('./window/windowSecurity');

const { createMainWindow } = require('./window/createMainWindow');

// Service: Cache für Voice-Liste (per API-Key).
const voicesCache = require('./services/VoicesCacheService');

// IPC-Registrierungen (jede Datei kapselt eine Domäne).
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
