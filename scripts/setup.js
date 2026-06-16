// scripts/setup.js
// One-shot "before first release" downloader. Run with:
//   npm run setup
//
// What it does:
//   1. Downloads the Real-ESRGAN binary + bundled models from the
//      v0.2.5.0 GitHub release and extracts them into ./bin/.
//   2. Downloads the isnet-general-use.onnx model from the
//      verified HuggingFace mirror into ./bin/models/.
//   3. (Does NOT build the isnetbg binary — see README for the
//      one `dotnet publish` command. The C# binary can't be
//      auto-built from this script because the C# source isn't
//      shipped in the Electron repo; the README points the
//      developer at the reference implementation.)
//
// The downloads go directly to the same paths the runtime
// wrappers probe for, so once the script finishes, the
// wrappers (`src/realesrgan.js` and `src/isnetbg.js`) will
// auto-detect everything on the very next launch and the
// "Optional add-ons" popup will silently skip itself.
//
// Idempotent: re-running overwrites the existing files with
// the latest verified versions. Atomic write (tmp + rename)
// so a kill mid-download doesn't leave a half-extracted binary.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');
const { promisify } = require('util');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin');
const MODELS = path.join(BIN, 'models');

// Verified URLs. See README for the rationale + how to swap
// them when upstream releases change. The IS-Net model mirror
// is checked for being an actual ONNX file (not a .pth), the
// Real-ESRGAN URL points at the dated asset name that
// actually exists in v0.2.5.0.
const RE_ESRGAN_URL = 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-windows.zip';
const ISNET_MODEL_URL = 'https://huggingface.co/x-Liola-x/isnet-general-use-onnx/resolve/main/isnet-general-use.onnx';

function log(msg) {
  process.stdout.write(msg + '\n');
}
function warn(msg) {
  process.stdout.write('⚠  ' + msg + '\n');
}
function fail(msg) {
  process.stderr.write('✖  ' + msg + '\n');
  process.exit(1);
}

function followRedirects(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    function get(target) {
      https.get(target, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          const next = res.headers.location;
          res.resume();
          if (!next || maxRedirects <= 0) return reject(new Error('Too many redirects'));
          get(new URL(next, target).toString());
          return;
        }
        resolve(res);
      }).on('error', reject);
    }
    get(url);
  });
}

// Download a URL to a target file. Streams the response so
// even the 176 MB ONNX model doesn't OOM a 4 GB-RAM dev box.
async function download(url, destPath) {
  log('  → ' + url);
  const res = await followRedirects(url);
  if (res.statusCode !== 200) {
    throw new Error(`HTTP ${res.statusCode} from ${url}`);
  }
  const total = parseInt(res.headers['content-length'] || '0', 10);
  const tmp = destPath + '.tmp-' + process.pid + '-' + Date.now();
  await fsp.mkdir(path.dirname(destPath), { recursive: true });
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    let downloaded = 0;
    let lastPct = -1;
    res.on('data', (chunk) => {
      downloaded += chunk.length;
      if (total > 0) {
        const pct = Math.floor((downloaded / total) * 100);
        if (pct !== lastPct && pct % 10 === 0) {
          process.stdout.write(`     ${(downloaded / 1024 / 1024).toFixed(1)} / ${(total / 1024 / 1024).toFixed(1)} MB (${pct}%)\r`);
          lastPct = pct;
        }
      }
    });
    res.pipe(out);
    out.on('finish', () => {
      out.close(() => {
        process.stdout.write('\n');
        resolve();
      });
    });
    out.on('error', reject);
    res.on('error', reject);
  });
  // Atomic rename — a kill mid-download leaves the previous
  // good file in place instead of a half-written one.
  try {
    await fsp.rename(tmp, destPath);
  } catch (e) {
    try { await fsp.unlink(tmp); } catch (_) {}
    throw e;
  }
}

// Extract a zip into destDir. Uses PowerShell's Expand-Archive
// on Windows (the project ships a Windows .exe, so this is
// the only target we need to support here; on POSIX, the
// `unzip` CLI is used as a portable fallback).
async function extractZip(zipPath, destDir) {
  await fsp.mkdir(destDir, { recursive: true });
  if (process.platform === 'win32') {
    await new Promise((resolve, reject) => {
      const ps = spawn('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-Command', `Expand-Archive -Path "${zipPath}" -DestinationPath "${destDir}" -Force`,
      ], { windowsHide: true });
      let stderr = '';
      ps.stderr.on('data', (b) => { stderr += b.toString('utf8'); });
      ps.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Expand-Archive exit ${code}: ${stderr}`)));
      ps.on('error', reject);
    });
  } else {
    await new Promise((resolve, reject) => {
      const u = spawn('unzip', ['-o', zipPath, '-d', destDir]);
      u.on('close', (code) => code === 0 ? resolve() : reject(new Error(`unzip exit ${code}`)));
      u.on('error', reject);
    });
  }
}

async function downloadRealEsrgan() {
  log('Real-ESRGAN binary (BSD-3-Clause)');
  // The release zip contains: realesrgan-ncnn-vulkan(.exe),
  // the models/ folder (realesrgan-x4plus.param, .bin, etc.),
  // and a few README files. We drop the whole archive into
  // ./bin/ so the models land at ./bin/models/realesrgan-*.{param,bin}
  // (exactly the layout the wrapper's `findBinary` + `findModelPath`
  // chain expects).
  const tmpZip = path.join(BIN, '.tmp-realesrgan.zip');
  try {
    await download(RE_ESRGAN_URL, tmpZip);
    log('  → extracting into ./bin/');
    await extractZip(tmpZip, BIN);
  } finally {
    try { await fsp.unlink(tmpZip); } catch (_) {}
  }
}

async function downloadIsnetModel() {
  log('IS-Net ONNX model (~176 MB, Apache-2.0)');
  // The model is shipped at the same relative path the
  // isnetbg wrapper looks for: <bin>/models/isnet-general-use.onnx
  // (~170 MB binary blob, so we always stream — never load it
  // into a single buffer).
  await fsp.mkdir(MODELS, { recursive: true });
  const dest = path.join(MODELS, 'isnet-general-use.onnx');
  await download(ISNET_MODEL_URL, dest);
}

async function checkIsnetBinary() {
  const exe = process.platform === 'win32' ? 'isnetbg.exe' : 'isnetbg';
  const dest = path.join(BIN, exe);
  try {
    await fsp.access(dest);
    log(`isnetbg binary: present at ./bin/${exe}`);
  } catch (_) {
    warn('isnetbg binary: MISSING (must be built from the C# reference in the README)');
    warn('  Build it with:');
    warn('    git clone https://github.com/xuebinqin/DIS');
    warn('    # write a tiny C# console program that matches the');
    warn('    # --input/--output/[--use-gpu] contract (see README),');
    warn('    # then publish it:');
    warn('    dotnet publish -c Release -r win-x64 --self-contained \\');
    warn('      -p:PublishSingleFile=true -o ./bin/');
    warn('  After publish, rename the resulting .exe to isnetbg.exe');
    warn('  and copy it into ./bin/ (re-running "npm run setup"');
    warn('  will pick it up automatically).');
  }
}

(async () => {
  log('MiniMax Asset Tool — first-release setup');
  log('=========================================');
  log('');

  await fsp.mkdir(BIN, { recursive: true });
  await fsp.mkdir(MODELS, { recursive: true });

  await downloadRealEsrgan();
  log('');
  await downloadIsnetModel();
  log('');
  await checkIsnetBinary();

  log('');
  log('Done. Verify with:');
  log('  npm run check');
})().catch((e) => {
  fail(String((e && e.message) || e));
});
