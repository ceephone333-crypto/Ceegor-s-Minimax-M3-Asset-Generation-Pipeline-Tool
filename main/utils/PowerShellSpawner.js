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
    // Bug-fix #10 (2026-06-19): pass the paths as environment
    // variables and reference them as `$env:…` instead of
    // interpolating them into the -Command string. PowerShell
    // expands $env:FOO to the exact value with no quoting
    // hazards, so a `"`/backtick in either path can't break
    // the command or smuggle extra arguments. Today both paths
    // are app-controlled (os.tmpdir() zip + appRoot/bin), so this
    // isn't exploitable — but the previous version also broke
    // for any path with a `"` in it, which the user-reported
    // crash logs occasionally hit when the install dir lived
    // under a OneDrive redirected profile.
    const ps = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-Command',
        'Expand-Archive -Path $env:MMX_SRC_ZIP -DestinationPath $env:MMX_DEST_DIR -Force',
      ],
      {
        windowsHide: true,
        env: { ...process.env, MMX_SRC_ZIP: zipPath, MMX_DEST_DIR: destDir },
      }
    );
    let stderr = '';
    ps.stderr.on('data', (b) => { stderr += b.toString('utf8'); });
    // v1.1 (audit L11): hard timeout. Antivirus / locked-file /
    // UAC scenarios used to hang ps.on('close') forever, freezing
    // the install UI. 5 min is the generous ceiling — Expand-
    // Archive of the 200 MB Real-ESRGAN zip takes <30 s on any
    // modern disk. SIGKILL escalation mirrors the isnetbg pattern.
    let killed = false;
    const killTimer = setTimeout(() => {
      killed = true;
      try { ps.kill(); } catch (_) {}
      setTimeout(() => { try { ps.kill('SIGKILL'); } catch (_) {} }, 2000).unref();
      reject(new Error(`Expand-Archive timed out after 5 min and was killed. ${stderr ? 'Last stderr: ' + stderr : ''}`));
    }, 5 * 60 * 1000).unref();
    ps.on('close', (code) => {
      if (killed) return;
      clearTimeout(killTimer);
      if (code === 0) resolve();
      else reject(new Error(`Expand-Archive failed (code ${code}): ${stderr}`));
    });
    ps.on('error', (err) => {
      if (killed) return;
      clearTimeout(killTimer);
      reject(err);
    });
  });
}

module.exports = { expandArchive };
