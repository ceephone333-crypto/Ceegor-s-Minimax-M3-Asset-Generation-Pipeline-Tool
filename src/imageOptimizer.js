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
  EXT_FOR_FORMAT,
  normaliseFormat,
  normaliseQuality,
  inferFormatFromPath,
  detectRealFormat,
  ensureSharp,
  emptyResult,
} = require('./imageOptimizer/formatUtils');

// v1.1.2 (BUG-A from _temp12.md): clamp `value` to the integer range
// [min, max], returning `fallback` ONLY when the value is non-finite.
// The previous `Math.round(x) || fallback` pattern was the AUDIT-01
// falsy-fallback bug surviving in this consumer: `Math.round(0)` is 0
// (falsy), so a user-selected effort/compression of 0 ("fastest")
// silently became the slowest default. `Number.isFinite` correctly
// accepts 0 and only rejects NaN / Infinity / non-numeric input — so
// the value the user picked (and state.js already persists) is honoured.
function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

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
  // bug-fix M6 (_temp4.md): sniff the real format from file content
  // first — mmx writes the CDN's actual bytes verbatim regardless of
  // the --out extension (e.g. a JPEG written to "foo.png"), so trusting
  // the extension here used to silently re-encode photographic JPEGs
  // as PNG (large size bloat) whenever opts.format asked to "keep" the
  // source format. Fall back to the extension only if content
  // detection is unavailable/inconclusive.
  const sniffedFormat = await detectRealFormat(srcPath);
  const inputFormat = SUPPORTED_INPUT.has(sniffedFormat) ? sniffedFormat : inferFormatFromPath(srcPath);
  if (!inputFormat) {
    // v1.1 (audit AUDIT-02): include AVIF in the supported list.
    // sharp reports AVIF as 'heif' (HEIF container with AV1
    // codec) and SUPPORTED_INPUT now includes 'heif', so a
    // real AVIF file no longer lands here. The error message
    // reflects the full supported set.
    return { ...emptyResult('Unsupported input format. Supported: JPEG, PNG, WebP, AVIF.'),
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
    // Bug-fix (v1.1 audit): the previous version called
    // `.withMetadata({ orientation: undefined }).keepIccProfile()`
    // here, which actually PRESERVES all metadata (withMetadata is
    // the OPPOSITE of stripping in sharp — by default sharp strips
    // everything). The user-facing label says "Strip non-essential
    // EXIF (keeps ICC colour profile)" — to honour that, we keep
    // ONLY the ICC profile and let sharp strip EXIF/XMP/IPTC plus
    // the orientation tag. `keepIccProfile()` alone (without
    // withMetadata) does exactly that.
    pipeline = pipeline.keepIccProfile();
  } else {
    // User explicitly asked to keep all metadata. withMetadata({})
    // preserves EXIF/XMP/IPTC and attaches a web-friendly sRGB ICC
    // profile when appropriate.
    pipeline = pipeline.withMetadata({});
  }

  // Format-specific encoders. The advanced settings overlay
  // (renderer/sections/section25_*.js) can pass per-format knobs:
  //   jpeg: chromaSubsampling ('4:2:0' | '4:4:4'), mozjpeg (bool)
  //   png:  compressionLevel (1..9), palette (bool)
  //   webp: mode ('lossy' | 'lossless' | 'nearLossless'), effort (0..6)
  //   avif: effort (0..9), chromaSubsampling ('4:4:4' | '4:2:0')
  // When the caller doesn't pass any of these, the defaults below
  // match the previous hard-coded behaviour so existing flows
  // (post-generation chain, right-click Optimise overlay) keep
  // producing identical bytes.
  const enc = opts.encoders || {};
  switch (targetFormat) {
    case 'jpeg':
      pipeline = pipeline.jpeg({
        quality,
        mozjpeg: enc.jpegMozjpeg !== false,
        progressive: true,
        chromaSubsampling: enc.jpegChromaSubsampling === '4:4:4' ? '4:4:4' : '4:2:0',
      });
      break;
    case 'png': {
      // v1.1 (audit L4): sharp silently ignores `quality` for PNG
      // (PNG is lossless). We omit it so the encoder doesn't see a
      // confusing knob, and so a future sharp version that DOES
      // honour `quality` for PNG (e.g. palette-quantisation quality)
      // doesn't silently change behaviour.
      const pngOpts = {
        compressionLevel: clampInt(enc.pngCompressionLevel, 0, 9, 9),
        palette: enc.pngPalette !== false,
        effort: 10,
      };
      pipeline = pipeline.png(pngOpts);
      break;
    }
    case 'webp': {
      // webpMode: 'lossy' (default, smallest) | 'lossless' (for
      // screenshots / line art) | 'nearLossless' (middle ground).
      const mode = enc.webpMode || 'lossy';
      if (mode === 'lossless') {
        pipeline = pipeline.webp({ quality, effort: clampInt(enc.webpEffort, 0, 6, 6), lossless: true });
      } else if (mode === 'nearLossless') {
        pipeline = pipeline.webp({ quality, effort: clampInt(enc.webpEffort, 0, 6, 6), nearLossless: true });
      } else {
        pipeline = pipeline.webp({ quality, effort: clampInt(enc.webpEffort, 0, 6, 6), lossless: false });
      }
      break;
    }
    case 'avif':
      pipeline = pipeline.avif({
        quality,
        effort: clampInt(enc.avifEffort, 0, 9, 9),
        lossless: false,
        chromaSubsampling: enc.avifChromaSubsampling === '4:2:0' ? '4:2:0' : '4:4:4',
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
  // Read from the in-memory outBuf (the exact bytes just written) rather
  // than re-opening outputPath from disk: sharp/libvips can hold a file
  // handle open briefly after a path-based read (observed with the webp
  // decoder), which then races a caller that immediately tries to
  // rename/delete the file on Windows.
  let width = 0, height = 0;
  try {
    const meta = await sharp(outBuf).metadata();
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

/**
 * bug-fix M6 (_temp4.md): mmx downloads the CDN's actual image bytes
 * and writes them verbatim to --out — but the renderer hardcodes the
 * file's extension (always .png for the image tab) because the mmx
 * image API has no output-format parameter. The CDN sometimes returns
 * JPEG bytes, producing a "name.png" file that is actually a JPEG.
 * Sniff the real format from content and rename the file to match
 * when they disagree, so the on-disk name always reflects the real
 * bytes (force-prefix's "exact name" promise, and imageOptimizer's
 * own format inference, both depend on this).
 *
 * @param {string} filePath Absolute path to a just-written image file.
 * @returns {Promise<{ ok: boolean, path: string, renamed: boolean, error?: string }>}
 */
async function fixExtensionToMatchContent(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return { ok: false, path: filePath, renamed: false, error: 'Path is required.' };
  }
  const sharpErr = ensureSharp();
  if (sharpErr) return { ok: false, path: filePath, renamed: false, error: sharpErr };

  const realFormat = await detectRealFormat(filePath);
  const realExt = realFormat && EXT_FOR_FORMAT[realFormat];
  if (!realExt) {
    // Undetectable / not a format we know how to name — leave the
    // file alone rather than guess.
    return { ok: true, path: filePath, renamed: false };
  }
  const currentExtRaw = (path.extname(filePath) || '').replace(/^\./, '').toLowerCase();
  const currentFormat = currentExtRaw === 'jpg' ? 'jpeg' : currentExtRaw;
  if (currentFormat === realFormat) {
    return { ok: true, path: filePath, renamed: false };
  }

  const dir = path.dirname(filePath);
  const stem = path.basename(filePath, path.extname(filePath));
  let newPath = path.join(dir, `${stem}.${realExt}`);
  try {
    let n = 1;
    while (await fsp.access(newPath).then(() => true, () => false)) {
      newPath = path.join(dir, `${stem}_${n}.${realExt}`);
      n += 1;
    }
    await fsp.rename(filePath, newPath);
    return { ok: true, path: newPath, renamed: true, fromExt: currentExtRaw, toExt: realExt };
  } catch (e) {
    return { ok: false, path: filePath, renamed: false, error: String((e && e.message) || e) };
  }
}

module.exports = {
  optimize,
  fixExtensionToMatchContent,
  DEFAULT_QUALITY,
  SUPPORTED_INPUT: Array.from(SUPPORTED_INPUT),
  SUPPORTED_OUTPUT: Array.from(SUPPORTED_OUTPUT),
};
