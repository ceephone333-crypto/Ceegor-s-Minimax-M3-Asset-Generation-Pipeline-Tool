// src/realesrgan.js
// Wrapper around the `realesrgan-ncnn-vulkan` command-line tool from
// https://github.com/xinntao/Real-ESRGAN. BSD-3-Clause license
// (commercial use is fine, attribution appreciated).
//
// We deliberately do NOT bundle the binary. The user installs it
// themselves — see the README for the exact `bin/` placement or
// PATH instructions. If the binary isn't found, the upscale
// function in the renderer falls back to the built-in multi-step
// canvas/createImageBitmap path so the tool is never blocked.
//
// Detection order (first match wins, cached after first success):
//   1. Cached path from a previous successful detection (this run).
//   2. `where realesrgan-ncnn-vulkan.exe` (Windows) /
//      `which realesrgan-ncnn-vulkan` (POSIX) on PATH.
//   3. `./bin/realesrgan-ncnn-vulkan[.exe]` next to the package root.

const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const BINARY_NAME = process.platform === 'win32'
  ? 'realesrgan-ncnn-vulkan.exe'
  : 'realesrgan-ncnn-vulkan';

let cachedBinaryPath = null;
let cachedBinaryVersion = null;

function findBinary() {
  if (cachedBinaryPath && fs.existsSync(cachedBinaryPath)) return cachedBinaryPath;

  // 1. System PATH lookup via `where` / `which`. On a fresh shell the
  // PATH may not include the binary's directory yet, so we also probe
  // the well-known bundled location below.
  try {
    const whichCmd = process.platform === 'win32' ? 'where' : 'which';
    const r = spawnSync(whichCmd, [BINARY_NAME], { encoding: 'utf8', windowsHide: true });
    if (r.status === 0 && r.stdout) {
      const found = r.stdout.split(/\r?\n/).map((s) => s.trim()).find((s) => s && fs.existsSync(s));
      if (found) {
        cachedBinaryPath = found;
        return found;
      }
    }
  } catch { /* ignore */ }

  // 2. Production: <resourcesPath>/bin/<BINARY_NAME>
  // (the build script copies ./bin/ here in dist/win-unpacked/resources/bin/).
  if (process.resourcesPath) {
    const resBundled = path.join(process.resourcesPath, 'bin', BINARY_NAME);
    if (fs.existsSync(resBundled)) {
      cachedBinaryPath = resBundled;
      return resBundled;
    }
  }

  // 3. ./bin/ next to the package root (works for dev and the
  //     packaged-electron layout that copies bin/ there directly).
  const bundled = path.join(__dirname, '..', 'bin', BINARY_NAME);
  if (fs.existsSync(bundled)) {
    cachedBinaryPath = bundled;
    return bundled;
  }

  return null;
}

function isAvailable() {
  return findBinary() !== null;
}

function getBinaryPath() {
  return findBinary();
}

// Run the binary on a single image. Returns a Promise that resolves
// with { ok, code, stderr, outputPath } on completion.
//
// The binary's stdout is mostly progress lines; we don't surface
// them to the renderer (the renderer already has its own "Upscaling
// 4×…" status line via setStatus). The binary's exit code is the
// signal of success — we also check the output file actually exists.
function run(srcPath, dstPath, opts = {}) {
  const binary = findBinary();
  if (!binary) {
    return Promise.resolve({
      ok: false,
      code: -1,
      stderr: 'realesrgan-ncnn-vulkan binary not found. See README for installation.',
      outputPath: null,
    });
  }

  // Default model: realesrgan-x4plus (general-purpose, BSD-3-Clause).
  // The renderer passes the model name from settings (or this
  // default if not set).
  const model = String(opts.model || 'realesrgan-x4plus');
  // The ncnn-vulkan binary always outputs at the model's NATIVE scale
  // (4 for x4plus). The renderer is responsible for downscaling
  // back to the user's chosen multiplier (2x/3x) or upscaling
  // further (8x) using the built-in createImageBitmap step.
  const scale = String(opts.scale || 4);
  // Output format. PNG is lossless, fine for the intermediate.
  const fmt = 'png';

  return new Promise((resolveP) => {
    const args = [
      '-i', srcPath,
      '-o', dstPath,
      '-n', model,
      '-s', scale,
      '-f', fmt,
    ];
    if (opts.gpu !== undefined && opts.gpu !== null) {
      args.push('-g', String(opts.gpu));
    }

    let stderr = '';
    let proc;
    try {
      proc = spawn(binary, args, { windowsHide: true });
    } catch (err) {
      resolveP({ ok: false, code: -1, stderr: String(err.message || err), outputPath: null });
      return;
    }
    proc.stderr.on('data', (b) => { stderr += b.toString('utf8'); });
    proc.on('error', (err) => {
      // ENOENT etc. — the binary disappeared between find and spawn.
      cachedBinaryPath = null;
      resolveP({ ok: false, code: -1, stderr: String(err.message || err), outputPath: null });
    });
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(dstPath)) {
        resolveP({ ok: true, code, stderr, outputPath: dstPath });
      } else {
        resolveP({ ok: false, code, stderr: stderr || `realesrgan exited with code ${code}`, outputPath: null });
      }
    });
  });
}

// One-shot probe: run with --help to check that the binary is
// actually working (not just present on disk). Returns a string
// version (or "" if unknown) so the renderer can display "Real-ESRGAN
// v0.2.5.0 detected" if the user is curious. Best-effort: never
// throws.
function probeVersion() {
  if (cachedBinaryVersion !== null) return cachedBinaryVersion;
  const binary = findBinary();
  if (!binary) { cachedBinaryVersion = ''; return ''; }
  try {
    const r = spawnSync(binary, ['--help'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    const out = (r.stdout || '') + '\n' + (r.stderr || '');
    const m = out.match(/realesrgan[- ]?ncnn[- ]?vulkan[^\n]*?v?(\d+\.\d+\.\d+(?:\.\d+)?)/i);
    cachedBinaryVersion = m ? m[1] : '';
    return cachedBinaryVersion;
  } catch {
    cachedBinaryVersion = '';
    return '';
  }
}

// Forget the cached "is the binary installed?" answer. The main
// process calls this after a successful in-app install of the
// binary (upscale:realesrgan:download), so the next probe re-runs
// the detection and finds the new file.
function resetCache() {
  cachedBinaryPath = null;
  cachedBinaryVersion = null;
}

module.exports = { isAvailable, getBinaryPath, run, probeVersion, resetCache };
