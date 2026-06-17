// src/imageOptimizer/formatUtils.js
// Format- und Quality-Helper für den Image-Optimizer.
// Stateless — keine sharp-Abhängigkeit in diesem Modul (außer die
// Initialisierung des require() mit Fallback).

const path = require('path');

// `sharp` ist ein Hard-Dep (siehe package.json). Trotzdem try/catch
// um den require, damit ein korruptes node_modules-Tree den Main-
// Process nicht zum Absturz bringt — wir liefern stattdessen einen
// präzisen Fehler in jedem Export.
let sharp = null;
try {
  sharp = require('sharp');
} catch (e) {
  // eslint-disable-next-line no-console
  console.error('imageOptimizer: failed to require("sharp"):', e && (e.message || e));
}

const DEFAULT_QUALITY = 82;

const SUPPORTED_INPUT = new Set(['jpeg', 'png', 'webp']);
const SUPPORTED_OUTPUT = new Set(['jpeg', 'png', 'webp', 'avif']);

// User-friendly aliases. `jpg` ist erlaubt, weil die Datei-Extension
// "jpg" lautet, nicht "jpeg".
const FORMAT_ALIASES = {
  jpg: 'jpeg',
  same: null,
  auto: null,
  source: null,
  input: null,
};

function normaliseFormat(value) {
  if (value == null) return null;
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (v === '' || v === 'keep' || v === 'preserve') return null;
  const aliased = Object.prototype.hasOwnProperty.call(FORMAT_ALIASES, v) ? FORMAT_ALIASES[v] : v;
  if (aliased === null) return null;
  return SUPPORTED_OUTPUT.has(aliased) ? aliased : null;
}

function normaliseQuality(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_QUALITY;
  return Math.max(1, Math.min(100, Math.round(n)));
}

function inferFormatFromPath(p) {
  if (!p) return null;
  const ext = (path.extname(p) || '').replace(/^\./, '').toLowerCase();
  if (ext === 'jpg') return 'jpeg';
  if (SUPPORTED_INPUT.has(ext)) return ext;
  return null;
}

function ensureSharp() {
  if (sharp) return null;
  return (
    'Sharp is not installed. Run `npm install` in the project root to install ' +
    'sharp + libvips (it is a runtime dependency of this project).'
  );
}

function emptyResult(error) {
  return {
    ok: false,
    outputPath: null,
    inputSize: 0,
    outputSize: 0,
    savedBytes: 0,
    savedPercent: 0,
    format: '',
    width: 0,
    height: 0,
    error: error || '',
  };
}

module.exports = {
  sharp,
  DEFAULT_QUALITY,
  SUPPORTED_INPUT,
  SUPPORTED_OUTPUT,
  normaliseFormat,
  normaliseQuality,
  inferFormatFromPath,
  ensureSharp,
  emptyResult,
};
