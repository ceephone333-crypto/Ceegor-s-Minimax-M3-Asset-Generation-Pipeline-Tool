// src/batches.js
// Per-tab batch storage for BatchGen. Lives in batches.json next to config.txt.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function batchesPath() {
  try {
    return path.join(path.dirname(app.getPath('exe')), 'batches.json');
  } catch {
    return path.join(process.cwd(), 'batches.json');
  }
}

function defaultBatches() {
  return { image: [], speech: [], music: [], video: [] };
}

function normalize(raw) {
  const out = defaultBatches();
  if (!raw || typeof raw !== 'object') return out;
  for (const k of Object.keys(out)) {
    const v = raw[k];
    if (Array.isArray(v)) {
      // Keep only non-empty trimmed strings, cap at 100.
      // Strict typeof check first — without it, a corrupted batches.json
      // containing objects would produce entries like "[object Object]"
      // that get sent to the CLI as prompts.
      out[k] = v
        .filter((s) => typeof s === 'string')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 100);
    }
  }
  return out;
}

function read() {
  const p = batchesPath();
  if (!fs.existsSync(p)) return defaultBatches();
  try {
    return normalize(JSON.parse(fs.readFileSync(p, 'utf8')));
  } catch {
    return defaultBatches();
  }
}

function write(batches) {
  const p = batchesPath();
  const clean = normalize(batches);
  // Atomic write: write to a temp file then rename. Avoids a corrupt
  // batches.json if the process is killed mid-write.
  const tmp = p + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(clean, null, 2), 'utf8');
  try {
    fs.renameSync(tmp, p);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  }
  return clean;
}

module.exports = { read, write, batchesPath, defaultBatches };
