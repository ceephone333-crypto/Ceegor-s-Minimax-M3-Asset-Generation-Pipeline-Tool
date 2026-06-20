// src/isnetbg.js
// Wrapper around the optional `isnetbg` background-removal tool.
// Two backends are supported, in priority order:
//
//   1. External binary (`./bin/isnetbg.exe` or anywhere on PATH) —
//      the C# / .NET 6+ reference implementation, or any
//      compatible CLI following the documented flag contract.
//   2. Pure-Node.js implementation (`./src/isnetbg_node.js`)
//      using onnxruntime-node + sharp. This is the **default**
//      backend for the in-app pipeline because it removes the
//      C# / .NET SDK requirement — `npm install` is the only
//      build step. The C# binary remains a supported fast-path
//      for users who want to ship one.
//
// Phase 7.5: Datei von 337 Z. auf ~230 Z. geschrumpft. Binary-
// Discovery (findModelPath/findBinary/pickBackend) wurde nach
// `./isnetbg/binaryDiscovery.js` extrahiert. Backward-Compat-API
// bleibt identisch (siehe _refactoringplan.md §3.5 DAG).

const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const {
  findModelPath,
  findBinary,
  pickBackend,
  resetCache,
} = require('./isnetbg/binaryDiscovery');

/** @type {string|null} */
let cachedBinaryVersion = null;

function isAvailable() {
  return pickBackend() !== null && !!findModelPath();
}

function getBinaryPath() {
  if (pickBackend() !== 'binary') return null;
  return findBinary();
}

function getModelPath() {
  return findModelPath();
}

/**
 * Run on a single image. `opts.useGpu` is forwarded to both
 * backends (the binary's --use-gpu flag and the Node.js wrapper's
 * session EP selection).
 *
 * @param {string} srcPath
 * @param {string} dstPath
 * @param {{ useGpu?: boolean }} [opts]
 * @returns {Promise<{ ok: boolean, code: number, stderr: string, outputPath: string|null }>}
 */
function run(srcPath, dstPath, opts = {}) {
  const backend = pickBackend();
  if (!backend) {
    // v1.1.10: the previous wording pushed users to either
    // run `npm install` (which they'd already done — the bug
    // was that the npm-installed package wasn't reaching the
    // packaged app's asar) or build the C# binary themselves.
    // Neither helped. Now: surface the actual diagnosis so
    // the user can fix it (or report a useful bug). The
    // bundled Node.js wrapper IS supposed to work — when it
    // doesn't, the cause is almost always the asar sync
    // (see scripts/sync-stable-asar.js).
    const reasons = [];
    try { if (!findBinary()) reasons.push('no isnetbg.exe in ./bin/'); } catch (_) {}
    try { if (!checkNodeBackendAvailable()) reasons.push('onnxruntime-node not bundled in the app'); } catch (_) {}
    const why = reasons.length ? ' (' + reasons.join('; ') + ')' : '';
    return Promise.resolve({
      ok: false, code: -1,
      stderr: 'isnetbg backend not available' + why + '. The tool ships the Node.js wrapper + the IS-Net ONNX model out of the box; if Re-detect says "not found", re-run `node scripts/sync-stable-asar.js` to repack node_modules/ into the asar, or drop a C# isnetbg.exe into ./bin/ as an optional fast-path.',
      outputPath: null,
    });
  }
  if (!findModelPath()) {
    return Promise.resolve({
      ok: false, code: -1,
      stderr: 'Model file missing: ./bin/models/isnet-general-use.onnx (run `npm run setup` to download).',
      outputPath: null,
    });
  }
  return backend === 'binary'
    ? runBinary(srcPath, dstPath, opts)
    : runNode(srcPath, dstPath, opts);
}

function runBinary(srcPath, dstPath, opts) {
  const binary = findBinary();
  const useGpu = (opts.useGpu === false) ? '0' : '1';
  return new Promise((resolveP) => {
    const args = ['--input', srcPath, '--output', dstPath, '--use-gpu', useGpu];
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
      resetCache();
      resolveP({ ok: false, code: -1, stderr: String(err.message || err), outputPath: null });
    });
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(dstPath)) {
        resolveP({ ok: true, code, stderr, outputPath: dstPath });
      } else {
        resolveP({ ok: false, code, stderr: stderr || `isnetbg exited with code ${code}`, outputPath: null });
      }
    });
  });
}

function runNode(srcPath, dstPath, opts) {
  // Spawn src/isnetbg_node.js as a child Node process. The
  // ~170 MB model lives in a separate process that can be killed
  // by the OS without affecting the renderer.
  const useGpu = (opts.useGpu === false) ? '0' : '1';
  const scriptPath = path.join(__dirname, 'isnetbg_node.js');
  const args = [scriptPath, '--input', srcPath, '--output', dstPath, '--use-gpu', useGpu];
  const modelDir = path.dirname(findModelPath() || '');
  const binDir = path.dirname(modelDir);
  return new Promise((resolveP) => {
    let stderr = '';
    let proc;
    let killed = false;
    try {
      proc = spawn(process.execPath, args, {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          MINIMAX_BIN_DIR: binDir,
          MINIMAX_MODEL_DIR: modelDir,
        },
        windowsHide: true,
      });
    } catch (err) {
      resolveP({ ok: false, code: -1, stderr: String(err.message || err), outputPath: null });
      return;
    }
    // Hard cap on the inference time (10 min). CPU inference of a
    // 1024×1024 IS-Net mask on a typical laptop takes 1–4 s; GPU
    // is sub-second. 10 min is a generous ceiling for very large
    // images on slow hardware, but still short enough that a stuck
    // child doesn't freeze the renderer indefinitely.
    const timeoutMs = 10 * 60 * 1000;
    const killTimer = setTimeout(() => {
      killed = true;
      try { proc.kill('SIGKILL'); } catch (_) {}
      resolveP({
        ok: false, code: -1,
        stderr: `isnetbg_node timed out after ${Math.round(timeoutMs / 1000)}s and was killed. The model file may be corrupt, or the image may be unusually large.`,
        outputPath: null,
      });
    }, timeoutMs);
    proc.stderr.on('data', (b) => { stderr += b.toString('utf8'); });
    proc.on('error', (err) => {
      if (killed) return;
      clearTimeout(killTimer);
      resolveP({ ok: false, code: -1, stderr: String(err.message || err), outputPath: null });
    });
    proc.on('close', (code) => {
      clearTimeout(killTimer);
      if (killed) return;
      if (code === 0 && fs.existsSync(dstPath)) {
        resolveP({ ok: true, code, stderr, outputPath: dstPath });
      } else {
        resolveP({ ok: false, code, stderr: stderr || `isnetbg_node exited with code ${code}`, outputPath: null });
      }
    });
  });
}

function probeVersion() {
  const backend = pickBackend();
  if (backend === 'node') return 'node-onnxruntime';
  if (backend === 'binary') {
    if (cachedBinaryVersion !== null) return cachedBinaryVersion;
    const binary = findBinary();
    if (!binary) { cachedBinaryVersion = ''; return ''; }
    for (const flag of ['--version', '-v', '--help']) {
      try {
        const r = spawnSync(binary, [flag], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
        const out = (r.stdout || '') + '\n' + (r.stderr || '');
        if (!out) continue;
        const m = out.match(/isnet(?:-?bg)?[- ]?v?(\d+\.\d+\.\d+(?:\.\d+)?)/i);
        if (m) { cachedBinaryVersion = m[1]; return cachedBinaryVersion; }
        const first = out.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
        if (first) { cachedBinaryVersion = first.slice(0, 64); return cachedBinaryVersion; }
      } catch { /* try next flag */ }
    }
    cachedBinaryVersion = '';
    return '';
  }
  return '';
}

module.exports = {
  isAvailable,
  getBinaryPath,
  getModelPath,
  run,
  probeVersion,
  resetCache,
};
