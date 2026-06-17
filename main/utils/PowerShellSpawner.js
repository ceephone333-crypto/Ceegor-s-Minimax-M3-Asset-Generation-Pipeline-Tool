// main/utils/PowerShellSpawner.js
// Wrapper für Windows-PowerShell-Expand-Archive.
// Hidden-Window-Flag + Bypass-Execution-Policy + NoProfile sind
// Pflicht, sonst blitzt kurz ein Konsolenfenster auf und/oder das
// Expand-Archive schlägt wegen restriktiver Policy fehl.

const { spawn } = require('child_process');

/**
 * Extrahiert eine ZIP-Datei in einen Ziel-Ordner.
 * @param {string} zipPath     Absoluter Pfad zur .zip-Datei.
 * @param {string} destDir     Ziel-Ordner (wird erstellt, falls nötig).
 * @returns {Promise<void>}    Resolved bei exit code 0; rejected sonst.
 */
function expandArchive(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    const ps = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-Command',
        `Expand-Archive -Path "${zipPath}" -DestinationPath "${destDir}" -Force`,
      ],
      { windowsHide: true }
    );
    let stderr = '';
    ps.stderr.on('data', (b) => { stderr += b.toString('utf8'); });
    ps.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Expand-Archive failed (code ${code}): ${stderr}`));
    });
    ps.on('error', reject);
  });
}

module.exports = { expandArchive };
