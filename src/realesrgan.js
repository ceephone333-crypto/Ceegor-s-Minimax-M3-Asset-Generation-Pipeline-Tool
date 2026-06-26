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
// 4ׅ" status line via setStatus). The binary's exit code is the
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
    // Advanced opts (v1.1 advanced pipeline settings overlay):
    //   -t <tile>  tile size for VRAM-constrained GPUs. 0 = auto
    //              (the binary's default). Values <32 are rejected
    //              by the binary; we sanitise at the state layer so
    //              only the whitelist [0,32,64,128,256,512,1024,2048]
    //              reaches here.
    //   -x         enable TTA (test-time augmentation) mode. Boosts
    //              quality at the cost of ~2× runtime. Off by default.
    //   -g <id>    pin to a specific GPU. 'auto' (the default) lets
    //              the binary pick. We only forward the flag when the
    //              user explicitly chose a numeric id, so the default
    //              spawn argv stays unchanged for users who never
    //              opened the advanced overlay.
    //   -j l:p:s   thread count for load/proc/save. Power-user knob;
    //              we don't expose it in the overlay (the default
    //              1:2:2 is optimal for almost every workload) but
    //              the wrapper still honours it if a future caller
    //              passes it.
    // v1.1 (audit AUDIT-03): tileSize must be a valid number in
    // [0, 4096] (the renderer's documented Custom-input range).
    // Pre-v1.1 the wrapper silently clamped tileSize<32 up to 32
    // AND silently dropped tileSize=0 (the auto value), so a
    // caller who picked "auto" got an explicit -t 32 instead.
    // The state.js whitelist mirror in nOr() is the first
    // defence (silently drop out-of-range values on read AND
    // write). This wrapper check is the second: only emit -t
    // when the value is a finite, in-range number. tileSize=0
    // means "auto" and the binary's default — do NOT emit -t.
    if (Number.isFinite(Number(opts.tileSize))) {
      const t = Math.round(Number(opts.tileSize));
      // v1.1.2 (BUG-C from _temp12.md): the binary rejects a tile size
      // below 32 ("invalid tilesize argument"), which used to bubble
      // up as a hard Real-ESRGAN failure and silently downgrade every
      // upscale to the canvas pipeline. Only emit -t for a value the
      // binary actually accepts ([32, 4096]); 0 / 1..31 / out-of-range
      // all drop the flag (binary default = auto). The state layer
      // already maps 1..31 → 0, so this is the defensive mirror for a
      // hand-edited state.json or a programmatic caller.
      if (t >= 32 && t <= 4096) {
        args.push('-t', String(t));
      }
    }
    if (opts.ttaMode === true) {
      args.push('-x');
    }
    // v1.1 (audit L5): gpuId resolution. The advanced overlay sends
    // opts.gpuId as 'auto' | '0' | '1' | '2' | '3'. Legacy callers
    // (pre-v1.1 renderer) sent opts.gpu as a number; that path is
    // kept for one release so a stale renderer still works after a
    // main-process upgrade, but we ONLY honour it when no opts.gpuId
    // was supplied at all (so a user's explicit 'auto' is respected).
    // v1.1 (audit AUDIT-04): whitelist mirror. The pre-v1.1 check
    // accepted ANY digit string for gpuId, so a hand-edited
    // state.json with gpuId='99' pinned the binary to a non-
    // existent GPU. We now mirror the state whitelist
    // [0, 1, 2, 3] (as strings) here as a defensive layer; any
    // value outside the set is dropped (binary default = auto).
    // v1.1.2 (BUG-C from _temp12.md): widen the accepted GPU-id range
    // to [0, 15] (was [0, 3]). The overlay help text explicitly invites
    // "4 for a 5th GPU", and a real multi-GPU rig can have more than 4
    // devices. 'auto' (the default) never emits -g. An id outside the
    // range is dropped (auto); an id that exists in the range but not
    // on this machine makes the binary error → canvas fallback.
    if (typeof opts.gpuId === 'string' && /^\d+$/.test(opts.gpuId)
        && Number(opts.gpuId) >= 0 && Number(opts.gpuId) <= 15) {
      args.push('-g', opts.gpuId);
    } else if (opts.gpuId === undefined && opts.gpu !== undefined && opts.gpu !== null) {
      // Legacy single-release shim: accept a number here too, but
      // ALSO validate it against the same [0, 15] range so a corrupted
      // legacy caller can't pin a nonsensical device.
      const n = Number(opts.gpu);
      if (Number.isInteger(n) && n >= 0 && n <= 15) args.push('-g', String(n));
    }
    if (typeof opts.threads === 'string' && /^\d+:\d+:\d+$/.test(opts.threads)) {
      args.push('-j', opts.threads);
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
