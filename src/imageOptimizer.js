// src/imageOptimizer.js
// Image optimization / file-size reduction service.
//
// Wraps the `sharp` library (already a runtime dependency — see
// package.json) to compress JPEG, PNG, and (optionally) WebP /
// AVIF images while preserving best-possible visual quality.
//
// Phase 7.5: Datei von 440 Z. auf ~270 Z. geschrumpft — Konstanten,
// Format- und Quality-Helfer sind nach `src/imageOptimizer/formatUtils.js`
// extrahiert. Backward-Compat-Shim unten re-exportiert die
// Helfer-Konstanten, damit `require('./imageOptimizer')` weiterhin
// dieselbe API hat (siehe auch _refactoringplan.md §3.5 DAG).

const fsp = require('fs').promises;
const path = require('path');

const {
  sharp,                  // may be null if install missing
  DEFAULT_QUALITY,
  SUPPORTED_INPUT,
  SUPPORTED_OUTPUT,
  normaliseFormat,
  normaliseQuality,
  inferFormatFromPath,
  ensureSharp,
  emptyResult,
} = require('./imageOptimizer/formatUtils');

/**
 * Optimise / compress an image on disk.
 *
 * @param {string} srcPath Absolute path to the source image.
 * @param {object} [opts]  See the module header for the full shape.
 * @returns {Promise<object>} Result envelope (see module header).
 */
async function optimize(srcPath, opts) {
  opts = opts || {};

  // --- Defensive checks --------------------------------------------------
  if (!srcPath || typeof srcPath !== 'string') {
    return emptyResult('Source path is required.');
  }

  const sharpErr = ensureSharp();
  if (sharpErr) return emptyResult(sharpErr);

  let inputStat;
  try {
    inputStat = await fsp.stat(srcPath);
  } catch (e) {
    return emptyResult('Source file is not readable: ' + (e && e.message || e));
  }
  if (!inputStat.isFile()) {
    return { ...emptyResult(), inputSize: inputStat.size,
             error: 'Source path is not a regular file.' };
  }

  // --- Format / quality normalisation ------------------------------------
  const inputFormat = inferFormatFromPath(srcPath);
  if (!inputFormat) {
    return { ...emptyResult('Unsupported input format. Supported: JPEG, PNG, WebP.'),
             inputSize: inputStat.size };
  }
  let targetFormat = normaliseFormat(opts.format);
  if (targetFormat === null) {
    targetFormat = inputFormat === 'webp' ? 'webp' : inputFormat;
  }
  if (!SUPPORTED_OUTPUT.has(targetFormat)) {
    return { ...emptyResult('Unsupported output format: ' + targetFormat),
             inputSize: inputStat.size };
  }
  const quality = normaliseQuality(opts.quality);
  const stripMetadata = opts.stripMetadata !== false;

  // --- Output path -------------------------------------------------------
  let outputPath = (typeof opts.outputPath === 'string' && opts.outputPath) ? opts.outputPath : null;
  if (!outputPath) {
    const dir = path.dirname(srcPath);
    const stem = path.basename(srcPath, path.extname(srcPath));
    const ext = targetFormat === 'jpeg' ? 'jpg' : targetFormat;
    outputPath = path.join(dir, `${stem}_optimized.${ext}`);
  }

  // --- Sharp pipeline ----------------------------------------------------
  let pipeline;
  try {
    pipeline = sharp(srcPath, { failOn: 'error' });
  } catch (e) {
    return { ...emptyResult('Could not read source image: ' + (e && e.message || e)),
             inputSize: inputStat.size, format: targetFormat };
  }

  if (stripMetadata) {
    pipeline = pipeline.withMetadata({ orientation: undefined });
    pipeline = pipeline.keepIccProfile();
  } else {
    pipeline = pipeline.withMetadata({});
  }

  // Format-specific encoders
  switch (targetFormat) {
    case 'jpeg':
      pipeline = pipeline.jpeg({
        quality, mozjpeg: true, progressive: true, chromaSubsampling: '4:2:0',
      });
      break;
    case 'png':
      pipeline = pipeline.png({
        quality, compressionLevel: 9, palette: true, effort: 10,
      });
      break;
    case 'webp':
      pipeline = pipeline.webp({ quality, effort: 6, lossless: false });
      break;
    case 'avif':
      pipeline = pipeline.avif({
        quality, effort: 9, lossless: false, chromaSubsampling: '4:2:0',
      });
      break;
  }

  // --- Run the pipeline --------------------------------------------------
  let outBuf;
  try {
    outBuf = await pipeline.toBuffer();
  } catch (e) {
    return { ...emptyResult('Compression failed: ' + (e && e.message || e)),
             inputSize: inputStat.size, format: targetFormat };
  }

  // --- Write the output --------------------------------------------------
  // Atomic write: tmp + rename. Same path / different path share
  // the same logic; Windows needs delete-before-rename for an
  // existing target.
  let outputSize = 0;
  try {
    const tmp = outputPath + '.opt-' + process.pid + '-' + Date.now() + '.tmp';
    await fsp.writeFile(tmp, outBuf);
    await fsp.rename(tmp, outputPath);
    const st = await fsp.stat(outputPath);
    outputSize = st.size;
  } catch (e) {
    return { ...emptyResult('Could not write output file: ' + (e && e.message || e)),
             inputSize: inputStat.size, format: targetFormat };
  }

  // --- Metadata for the UI ----------------------------------------------
  let width = 0, height = 0;
  try {
    const meta = await sharp(outputPath).metadata();
    width = meta.width || 0;
    height = meta.height || 0;
  } catch (_) { /* best-effort */ }

  const savedBytes = Math.max(0, inputStat.size - outputSize);
  const savedPercent = inputStat.size > 0
    ? Math.round((savedBytes / inputStat.size) * 100)
    : 0;

  return {
    ok: true,
    outputPath,
    inputSize: inputStat.size,
    outputSize,
    savedBytes,
    savedPercent,
    format: targetFormat,
    width,
    height,
  };
}

module.exports = {
  optimize,
  DEFAULT_QUALITY,
  SUPPORTED_INPUT: Array.from(SUPPORTED_INPUT),
  SUPPORTED_OUTPUT: Array.from(SUPPORTED_OUTPUT),
};
