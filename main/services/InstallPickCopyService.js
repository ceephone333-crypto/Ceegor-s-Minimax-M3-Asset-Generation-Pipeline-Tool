// main/services/InstallPickCopyService.js
// "Pick file…" Universal-Fallback für den Optional-Addons-Popup.
// User hat die Datei schon heruntergeladen (oder gebaut); wir öffnen
// den Datei-Picker, kopieren atomar ins Ziel unter ./bin/.
//
// Sicherheit: das Ziel wird vom Main-Process festgelegt (InstallKindsTable),
// nicht vom Renderer. Ein kompromittierter Renderer kann nicht auf
// C:\Windows zeigen.

const fsp = require('fs').promises;
const path = require('path');

const { getSpec, getDestPath } = require('../models/InstallKindsTable');

/**
 * @typedef {(
 *   'realesrgan-binary' | 'isnetbg-binary' | 'isnetbg-model'
 * )} InstallKind
 */

/**
 * @param {string} kind
 * @param {(opts: object) => Promise<{canceled: boolean, filePaths: string[]}>} showOpenDialog
 *   Wird per DI injiziert — typischerweise `dialog.showOpenDialog` aus Electron.
 *   Tests können ein Stub-Objekt übergeben.
 * @param {string} appRoot
 * @returns {Promise<{ok: boolean, destPath?: string, kind?: InstallKind, canceled?: boolean, error?: string}>}
 */
async function pickAndCopy(kind, showOpenDialog, appRoot) {
  const spec = getSpec(kind);
  if (!spec) return { ok: false, error: 'Unknown install kind: ' + String(kind) };

  // Phase 1: File-Picker öffnen
  const r = await showOpenDialog({
    title: spec.title,
    properties: ['openFile'],
    filters: spec.filters,
  });
  if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
  const srcPath = r.filePaths[0];

  // Phase 2: Ziel berechnen (immer <appRoot>/bin[/<subdir>]/<destName>)
  const destPath = getDestPath(kind, appRoot);
  if (!destPath) return { ok: false, error: 'Failed to resolve destination for ' + kind };

  // Phase 3: Atomares Copy (tmp + rename)
  const destDir = path.dirname(destPath);
  try {
    await fsp.mkdir(destDir, { recursive: true });
    const tmp = destPath + '.tmp-' + process.pid + '-' + Date.now();
    await fsp.copyFile(srcPath, tmp);
    try {
      await fsp.rename(tmp, destPath);
    } catch (renameErr) {
      try { await fsp.unlink(tmp); } catch {}
      throw renameErr;
    }
    return { ok: true, destPath, kind };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

module.exports = { pickAndCopy };
