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
// Flag contract (identical for both backends):
//
//   isnetbg --input <path> --output <path> [--use-gpu <0|1>]
//
// On success: exit code 0, a PNG with transparent background at
// <path>. On failure: non-zero exit code and a human-readable
// diagnostic on stderr.
//
// Detection order for the binary backend (first match wins):
//   1. Cached path from a previous successful detection (this run).
//   2. `where isnetbg.exe` (Windows) / `which isnetbg` (POSIX) on PATH.
//   3. `./bin/isnetbg[.exe]` next to the package root.
//
// The Node.js backend is always available when onnxruntime-node
// is installed (it's a runtime dep of this project) and the
// model file is present. We probe the model file at
// `./bin/models/isnet-general-use.onnx` regardless of which
// backend is active, since both need it.

const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const BINARY_NAME = process.platform === 'win32' ? 'isnetbg.exe' : 'isnetbg';
const MODEL_NAME = 'isnet-general-use.onnx';
const MODELS_DIR_NAME = 'models';

let cachedBinaryPath = null;
let cachedBinaryVersion = null;
let cachedBackend = null; // 'binary' | 'node' | null

function findModelPath() {
  // The model lives at ./bin/models/isnet-general-use.onnx,
  // regardless of which backend is active. We check three
  // locations so the wrapper works in dev, in the packaged
  // app (where the build script copies bin/ next to the
  // resourcesPath), and in case the user runs the script from
  // an arbitrary cwd.
  const candidates = [
    // Production: the build script copies ./bin/ to
    // <resourcesPath>/bin/, so this is the canonical location
    // for the packaged app.
    process.resourcesPath ? path.join(process.resourcesPath, 'bin', MODELS_DIR_NAME, MODEL_NAME) : null,
    // Development: src/isnetbg.js -> ../bin/.
    path.join(__dirname, '..', 'bin', MODELS_DIR_NAME, MODEL_NAME),
    // Fallback: cwd-relative (rare, but harmless to try).
    path.join(process.cwd(), 'bin', MODELS_DIR_NAME, MODEL_NAME),
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function findBinary() {
  if (cachedBinaryPath && fs.existsSync(cachedBinaryPath)) return cachedBinaryPath;

  // 1. System PATH lookup via `where` / `which`.
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

  // 3. Development: ./bin/ next to the package root.
  const bundled = path.join(__dirname, '..', 'bin', BINARY_NAME);
  if (fs.existsSync(bundled)) {
    cachedBinaryPath = bundled;
    return bundled;
  }

  return null;
}

// True iff onnxruntime-node is installed. We use a require() in
// a try/catch so a missing optional dep (e.g. a developer who
// deleted it) doesn't crash the whole probe.
function nodeBackendAvailable() {
  try {
    require.resolve('onnxruntime-node');
    return true;
  } catch (_) {
    return false;
  }
}

// Resolve the active backend. The Node.js backend is preferred
// because it removes the C# toolchain dependency; the binary
// backend is used if the developer shipped a C# build for
// max performance. Cached after first successful resolution.
function pickBackend() {
  if (cachedBackend) return cachedBackend;
  const modelOk = !!findModelPath();
  const bin = findBinary();
  const nodeOk = nodeBackendAvailable();
  if (bin && modelOk) {
    cachedBackend = 'binary';
  } else if (nodeOk && modelOk) {
    cachedBackend = 'node';
  } else if (bin) {
    // Binary present but model missing — fall back to node if
    // available; the wrapper's run() will surface the precise
    // "model missing" error.
    cachedBackend = nodeOk ? 'node' : 'binary';
  } else {
    cachedBackend = nodeOk ? 'node' : null;
  }
  return cachedBackend;
}

function isAvailable() {
  return pickBackend() !== null && !!findModelPath();
}

function getBinaryPath() {
  // Returns the binary path if the binary backend is in use,
  // null otherwise. Kept for backwards-compat with the UI which
  // uses this to show "Detected: <path>" — when the node
  // backend is active, the UI shows a more general "Node.js
  // IS-Net wrapper (onnxruntime-node)" hint instead.
  if (pickBackend() !== 'binary') return null;
  return findBinary();
}

function getModelPath() {
  return findModelPath();
}

// Run on a single image. `opts.useGpu` is forwarded to both
// backends (the binary's --use-gpu flag and the Node.js wrapper's
// session EP selection).
function run(srcPath, dstPath, opts = {}) {
  const backend = pickBackend();
  if (!backend) {
    return Promise.resolve({
      ok: false,
      code: -1,
      stderr: 'isnetbg backend not available: no ./bin/isnetbg.exe and onnxruntime-node is not installed. Run `npm install` to pick it up, or drop a C# isnetbg.exe into ./bin/.',
      outputPath: null,
    });
  }
  if (!findModelPath()) {
    return Promise.resolve({
      ok: false,
      code: -1,
      stderr: 'Model file missing: ./bin/models/isnet-general-use.onnx (run `npm run setup` to download).',
      outputPath: null,
    });
  }

  if (backend === 'binary') {
    return runBinary(srcPath, dstPath, opts);
  }
  return runNode(srcPath, dstPath, opts);
}

function runBinary(srcPath, dstPath, opts) {
  const binary = findBinary();
  const useGpu = (opts.useGpu === false) ? '0' : '1';
  return new Promise((resolveP) => {
    const args = [
      '--input', srcPath,
      '--output', dstPath,
      '--use-gpu', useGpu,
    ];
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
      cachedBinaryPath = null;
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
  // Spawn src/isnetbg_node.js as a child Node process. We do this
  // rather than inlining the inference into the main process so
  // (a) the ~170 MB model lives in a separate process that can
  // be killed by the OS without affecting the renderer, and
  // (b) a future swap to a different backend (e.g. WASM) only
  // touches one file.
  const useGpu = (opts.useGpu === false) ? '0' : '1';
  const scriptPath = path.join(__dirname, 'isnetbg_node.js');
  const args = [
    scriptPath,
    '--input', srcPath,
    '--output', dstPath,
    '--use-gpu', useGpu,
  ];
  // Resolve the model dir in the parent process (which has
  // process.resourcesPath), and pass it to the child via env.
  // The child Node process spawned via process.execPath +
  // ELECTRON_RUN_AS_NODE=1 does NOT inherit process.resourcesPath
  // — it sees Electron's own resources, not the app's. Passing
  // the absolute path via env is the only way to bridge the gap
  // without the child having to know the install layout. We also
  // pass the bin dir as a fallback for the (rare) C# binary
  // setup, so a hand-built isnetbg.exe placed by the user can
  // find the model next to itself.
  const modelDir = path.dirname(findModelPath() || '');
  const binDir = path.dirname(modelDir); // <...>/bin
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
    // Hard cap on the inference time. CPU inference of a 1024×1024
    // IS-Net mask on a typical laptop takes 1–4 s; GPU is sub-second.
    // 10 minutes is a generous ceiling for very large images on slow
    // hardware, but still short enough that a stuck child doesn't
    // freeze the renderer indefinitely. The user's toast says
    // "Removing background…" with no progress — without a timeout
    // a hang would lock up the whole image pipeline.
    const timeoutMs = 10 * 60 * 1000;
    const killTimer = setTimeout(() => {
      killed = true;
      try { proc.kill('SIGKILL'); } catch (_) {}
      resolveP({
        ok: false,
        code: -1,
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
      if (killed) return; // already resolved by the timeout
      if (code === 0 && fs.existsSync(dstPath)) {
        resolveP({ ok: true, code, stderr, outputPath: dstPath });
      } else {
        resolveP({ ok: false, code, stderr: stderr || `isnetbg_node exited with code ${code}`, outputPath: null });
      }
    });
  });
}

function probeVersion() {
  if (cachedBackend === 'node') return 'node-onnxruntime';
  if (cachedBackend === 'binary') {
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

function resetCache() {
  cachedBinaryPath = null;
  cachedBinaryVersion = null;
  cachedBackend = null;
}

module.exports = {
  isAvailable,
  getBinaryPath,
  getModelPath,
  run,
  probeVersion,
  resetCache,
};
