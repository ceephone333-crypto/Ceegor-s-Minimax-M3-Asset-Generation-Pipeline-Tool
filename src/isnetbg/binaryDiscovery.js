// src/isnetbg/binaryDiscovery.js
// Erkennung des isnetbg-Backends (Binary oder Node.js-Wrapper).
// Cache für Path-Resolution + Backend-Auswahl.

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const BINARY_NAME = process.platform === 'win32' ? 'isnetbg.exe' : 'isnetbg';
const MODEL_NAME = 'isnet-general-use.onnx';
const MODELS_DIR_NAME = 'models';

/** @type {string|null} */
let cachedBinaryPath = null;

/** @type {string|null} */
let cachedBackend = null; // 'binary' | 'node' | null

function findModelPath() {
  // The model lives at ./bin/models/isnet-general-use.onnx,
  // regardless of which backend is active. We check three
  // locations so the wrapper works in dev, in the packaged
  // app (where the build script copies bin/ next to the
  // exe), and in source-tree dev mode.
  const candidates = [
    // 1) Packaged-app layout: <resourcesPath>/bin/models/<MODEL_NAME>
    process.resourcesPath ? path.join(process.resourcesPath, 'bin', MODELS_DIR_NAME, MODEL_NAME) : null,
    // 2) Local dev: <project>/bin/models/<MODEL_NAME>
    path.join(__dirname, '..', '..', 'bin', MODELS_DIR_NAME, MODEL_NAME),
    // 3) App-root layout: <project>/bin/<MODEL_NAME> (rare, no models/ subdir)
    path.join(__dirname, '..', '..', 'bin', MODEL_NAME),
  ].filter(Boolean);
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch (_) { /* ignore */ }
  }
  return null;
}

function findBinary() {
  if (cachedBinaryPath) {
    try { if (fs.existsSync(cachedBinaryPath)) return cachedBinaryPath; } catch (_) { /* ignore */ }
    cachedBinaryPath = null;
  }
  // 1) where isnetbg.exe / which isnetbg on PATH
  try {
    const whichCmd = process.platform === 'win32' ? 'where' : 'which';
    const r = spawnSync(whichCmd, [BINARY_NAME], { encoding: 'utf8', windowsHide: true });
    if (r.status === 0 && r.stdout) {
      const found = r.stdout.split(/\r?\n/).map((s) => s.trim()).find((s) => s && fs.existsSync(s));
      if (found) { cachedBinaryPath = found; return found; }
    }
  } catch (_) { /* ignore */ }
  // 2) ./bin/isnetbg[.exe] next to package root
  try {
    const candidates = [
      path.join(__dirname, '..', '..', 'bin', BINARY_NAME),
      process.resourcesPath ? path.join(process.resourcesPath, 'bin', BINARY_NAME) : null,
    ].filter(Boolean);
    for (const p of candidates) {
      if (fs.existsSync(p)) { cachedBinaryPath = p; return p; }
    }
  } catch (_) { /* ignore */ }
  return null;
}

function checkNodeBackendAvailable() {
  // The Node.js backend lives in src/isnetbg_node.js and needs
  // onnxruntime-node to be installed. We don't actually import
  // the module here (that would be expensive) — we just check
  // whether the file can be resolved.
  try {
    require.resolve('onnxruntime-node', { paths: [path.join(__dirname, '..', '..')] });
    return true;
  } catch (_) { return false; }
}

/**
 * Wählt das beste verfügbare Backend. Binary hat Vorrang (vom User
 * explizit installiert), Node ist der Fallback.
 * @returns {'binary' | 'node' | null}
 */
function pickBackend() {
  if (cachedBackend !== null) return cachedBackend;
  const bin = findBinary();
  const nodeOk = checkNodeBackendAvailable();
  if (bin) {
    cachedBackend = 'binary';
  } else if (nodeOk) {
    cachedBackend = 'node';
  } else {
    cachedBackend = null;
  }
  return cachedBackend;
}

function resetCache() {
  cachedBinaryPath = null;
  cachedBackend = null;
}

module.exports = {
  BINARY_NAME,
  MODEL_NAME,
  findModelPath,
  findBinary,
  pickBackend,
  resetCache,
};
