// main/services/InstallDownloadService.js
// One-Click-Installer für Real-ESRGAN: lädt die v0.2.5.0 Windows-Zip
// von GitHub, entpackt sie via PowerShell in ./bin/.
//
// Der vorherige Code zeigte auf `realesrgan-ncnn-vulkan-v0.2.5.0-windows.zip`,
// was auf GitHub nie existierte. Der korrekte Asset-Name in v0.2.5.0 ist
// datiert (`realesrgan-ncnn-vulkan-20220424-windows.zip`). Falls der
// Upstream-Asset je entfernt wird, fängt der "Pick file…" Button
// (main/services/InstallPickCopyService.js) den Fallback ab.

const fs = require('fs');
const path = require('path');
const os = require('os');

const { httpsGetFollowingRedirects } = require('./HttpsRedirect');
const { createProgressEmitter } = require('./DownloadProgressEmitter');
const { expandArchive } = require('../utils/PowerShellSpawner');

const RE_ESRGAN_DOWNLOAD_URL =
  'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-windows.zip';

/**
 * @typedef {object} DownloadProgress
 * @property {'download' | 'extract'} phase
 * @property {number} downloaded
 * @property {number} total
 * @property {'starting' | 'started' | 'progress' | 'done' | 'error'} status
 */

/**
 * Lädt Real-ESRGAN herunter und entpackt es nach `<appRoot>/bin/`.
 * Fortschritt wird via `send` an den Renderer gestreamt.
 *
 * @param {string} appRoot                  __dirname
 * @param {(p: DownloadProgress) => void} send
 * @returns {Promise<{ok: boolean, binDir?: string, error?: string}>}
 */
async function downloadRealesrgan(appRoot, send) {
  const tmpZip = path.join(os.tmpdir(), `realesrgan-${Date.now()}.zip`);

  const safeSend = (data) => { try { send(data); } catch (_) {} };

  try {
    // ---- Phase 1: Download ----
    safeSend({ phase: 'download', downloaded: 0, total: 0, status: 'starting' });
    await new Promise((resolve, reject) => {
      httpsGetFollowingRedirects(RE_ESRGAN_DOWNLOAD_URL).then((res) => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} from ${RE_ESRGAN_DOWNLOAD_URL}`));
        }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        safeSend({ phase: 'download', downloaded: 0, total, status: 'started' });
        const file = fs.createWriteStream(tmpZip);
        const emit = createProgressEmitter(
          (data) => safeSend({ phase: 'download', status: 'progress', ...data }),
          () => ({ phase: 'download', downloaded: 0, total, status: 'started' })
        );
        let downloaded = 0;
        res.on('data', (chunk) => {
          downloaded += chunk.length;
          emit(downloaded, total);
        });
        res.pipe(file);
        file.on('finish', () => file.close(() => {
          safeSend({ phase: 'download', downloaded, total, status: 'done' });
          resolve();
        }));
        file.on('error', (err) => {
          try { fs.unlinkSync(tmpZip); } catch (_) {}
          reject(err);
        });
      }).catch(reject);
    }).catch((err) => {
      try { fs.unlinkSync(tmpZip); } catch (_) {}
      throw err;
    });

    // ---- Phase 2: Extract ----
    const binDir = path.join(appRoot, 'bin');
    if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });
    safeSend({ phase: 'extract', downloaded: 0, total: 0, status: 'starting' });
    await expandArchive(tmpZip, binDir);
    safeSend({ phase: 'extract', downloaded: 0, total: 0, status: 'done' });

    // ---- Phase 3: Cleanup ----
    try { fs.unlinkSync(tmpZip); } catch (_) {}
    return { ok: true, binDir };
  } catch (e) {
    try { fs.unlinkSync(tmpZip); } catch (_) {}
    return { ok: false, error: String((e && e.message) || e) };
  }
}

module.exports = { downloadRealesrgan, RE_ESRGAN_DOWNLOAD_URL };
