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

// v1.1 (audit AUDIT-02): sharp reports AVIF files as format 'heif'
// (because AVIF is technically a brand of HEIF — the file uses
// HEIF container + AV1 codec). Without this addition, an
// optimisation request for an .avif file is rejected with
// "Unsupported input format. Supported: JPEG, PNG, WebP." even
// though the advanced settings overlay advertises AVIF as an
// output format. We accept 'avif' (the canonical name) AND
// 'heif' (sharp's raw report) as valid input formats; the
// detectRealFormat() function normalises both to 'avif' for
// downstream consumers.
const SUPPORTED_INPUT = new Set(['jpeg', 'png', 'webp', 'avif', 'heif']);
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

// bug-fix M6 (_temp4.md): the file extension is whatever the caller
// asked mmx to write to (e.g. always ".png" for the image tab — the
// mmx image API has no output-format parameter), but mmx writes the
// CDN's actual bytes verbatim, which are sometimes JPEG. sharp reads
// the real format from the file's content (magic bytes), not its
// extension, so this is the source of truth `inferFormatFromPath`
// cannot provide.
//
// v1.1 (audit AUDIT-02): sharp reports AVIF as 'heif' (HEIF
// container with AV1 codec). We normalise that to 'avif' so the
// rest of the pipeline (and the format-detection round-trip) can
// use a single canonical name. The `compression === 'av1'` check
// distinguishes true AVIF from HEIC / HEIF (which use HEVC /
// H.265 — those are still rejected by SUPPORTED_INPUT).
async function detectRealFormat(filePath) {
  if (!sharp || !filePath) return null;
  try {
    const meta = await sharp(filePath).metadata();
    if (!meta || !meta.format) return null;
    const fmt = String(meta.format).toLowerCase();
    if (fmt === 'heif' && meta.compression === 'av1') return 'avif';
    return fmt;
  } catch (e) {
    return null;
  }
}

// jpeg's canonical extension is "jpg" throughout this codebase (see
// the targetFormat->ext mapping below in optimize()).
const EXT_FOR_FORMAT = { jpeg: 'jpg', png: 'png', webp: 'webp', gif: 'gif', bmp: 'bmp' };

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
  EXT_FOR_FORMAT,
  normaliseFormat,
  normaliseQuality,
  inferFormatFromPath,
  detectRealFormat,
  ensureSharp,
  emptyResult,
};
