// main/window/createMainWindow.js
// Factory für das Haupt-BrowserWindow. Enthält:
//  - WebPreferences (preload, contextIsolation, sandbox, backgroundThrottling)
//  - will-navigate + setWindowOpenHandler (XSS-Härtung)
//  - Confirm-Close-Guard (kein versehentliches Kill bei X / Alt+F4)

const path = require('path');
const { BrowserWindow, dialog } = require('electron');

/**
 * Erzeugt das Haupt-Fenster und gibt das Promise zurück, mit dem
 * der Aufrufer auf ready-to-show warten kann (optional — wir
 * geben das Window selbst zurück, weil der close-Guard asynchron ist).
 *
 * @param {string} appRoot
 * @param {{ cancelActiveJobs?: () => void }} [hooks]
 * @returns {Electron.BrowserWindow}
 */
function createMainWindow(appRoot, hooks = {}) {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'MiniMax Assets Tool — Token Plan & PAYG',
    backgroundColor: '#1f1f23',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(appRoot, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(appRoot, 'renderer', 'index.html'));

  // ---- Sicherheit ----
  // Block any in-app navigation. The renderer loads exactly one local
  // file; if some future bug tries to navigate to a remote origin we
  // refuse it. Default Electron behaviour would otherwise be to ALLOW
  // the navigation and silently break the IPC bridge.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  // Block window.open / target=_blank popups. The renderer has no
  // legitimate need to spawn additional windows, and an unblocked
  // `window.open` is a classic XSS escape hatch.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // ---- Confirm-before-close guard ----
  // Without this, a misclick on the X button (or Alt+F4 / Cmd+Q) can
  // kill an in-progress mmx generation and discard whatever the user
  // was working on. We show a modal question dialog; the default
  // button is "Cancel" and Esc also maps to Cancel, so the safe
  // option is the default. A flag breaks the recursion when the
  // user actually confirms.
  let confirmingClose = false;
  win.on('close', async (e) => {
    if (confirmingClose) return;
    e.preventDefault();
    if (hooks.cancelActiveJobs) {
      try { hooks.cancelActiveJobs(); } catch (_) {}
    }
    const result = await dialog.showMessageBox(win, {
      type: 'question',
      title: 'Close MiniMax Asset Tool?',
      message: 'Are you sure you want to close the tool?',
      detail: 'Any in-progress generation will be cancelled. Your settings, file prefix, and per-tab folders are saved automatically (after every change), so you can pick up where you left off the next time you launch the app.',
      buttons: ['Close', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (result.response === 0) {
      confirmingClose = true;
      // destroy() bypasses the 'close' event so the guard doesn't
      // re-fire and trap us in a loop.
      win.destroy();
    }
  });

  return win;
}

module.exports = { createMainWindow };
