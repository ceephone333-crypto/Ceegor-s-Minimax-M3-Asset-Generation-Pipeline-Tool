// renderer/sections/section08_Image_pipeline__Upscale___Crop___Convert_.js (Phase 3 Block 29)
// Extracted: Image pipeline (Upscale / Crop / Convert)
// Source: app.js L1652..2014

// ----------------- Image pipeline (Upscale / Crop / Convert) -----------------
// All three operations are pure browser/Electron — no external libraries,
// no network calls, fully open source. They all use the HTML5 Canvas
// API to read the source image into a canvas, then export it to the
// target format via canvas.toDataURL. The main process only handles
// persisting the resulting base64 blob to disk via the new fb:write IPC.

// Load a local file:// image as a usable Image object (resolves once
// it's fully decoded). Used by upscale / crop / convert.

// Pick a non-clashing output path for the upscale / crop pipeline.
// Tries `basePath`, `basePath (2)`, `basePath (3)`, ... via
// window.api.fbExists. Caps at 1000 attempts (which would only
// realistically happen if a script is bulk-renaming to the same
// stem — the user can still rename / move existing files). On
// exhaustion, falls back to a timestamp suffix so the operation
// never silently overwrites a file.
async function uniqueOutputPath(basePath) {
  const dot = basePath.lastIndexOf('.');
  const stem = dot > 0 ? basePath.slice(0, dot) : basePath;
  const ext = dot > 0 ? basePath.slice(dot) : '';
  for (let i = 1; i < 1000; i++) {
    const candidate = i === 1 ? basePath : `${stem} (${i})${ext}`;
    if (!await window.api.fbExists(candidate)) return candidate;
  }
  return `${stem}_${Date.now()}${ext}`;
}

// Module-level re-render of the "🔍 Upscale 2×" label in the image
// tab. The label is created (and its refreshUpscaleCheckboxUI
// closure is defined) inside the image tab's build(), so by the
// time the user opens the ⚙ Settings → Upscale popup, that
// closure is long gone. This module-level helper re-queries the
// DOM by class and updates the label + .active class on save
// and on every render-pass. (For "one-off" upscale/crop flows
// via the right-click menu, the in-tab function still runs
// because the build() closure is still in scope at that point.)
function refreshUpscaleLabel() {
  const label = document.querySelector('.upscale-checkbox');
  if (!label) return;
  const mult = label.querySelector('.upscale-mult');
  const m = (state.upscaleSettings && state.upscaleSettings.multiplier) || 2;
  if (mult) mult.textContent = state.upscaleEnabled ? ` (${m}×)` : '';
  label.classList.toggle('active', !!state.upscaleEnabled);
}

// Derive the output MIME from a file extension. Used to export the
// canvas in the same format as the input. WebP is detected too (since
// the Canvas API supports exporting to image/webp in modern Chromium).

// Pick a non-clobbering output path next to the source. Inserts a
// `_2x`, `_cropped_WxH`, or `_converted` infix between the stem and
// the extension. If the result already exists, a numeric suffix is
// appended to keep the original safe.

// One resize step. Prefers createImageBitmap with resizeQuality: 'high'
// — Chromium uses a Lanczos-style resampler for that, which is
// noticeably sharper than the default canvas drawImage path. Falls
// back to canvas drawImage with imageSmoothingQuality = 'high' for
// older runtimes that don't expose createImageBitmap.
async function upscaleStep(src, w, h) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(src, {
        resizeWidth: w,
        resizeHeight: h,
        resizeQuality: 'high',
      });
    } catch (_) { /* fall through to canvas path */ }
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return canvas;
}

// Toast-once latch: don't re-spam the user with the "Real-ESRGAN
// missing" message on every upscale. Resetting it requires a restart
// of the app, which is what we want — a single reminder per session
// is enough.
let _reEsrganNotified = false;

// Cache the isnetbg availability probe. The IPC is cheap (just a
// `which` + an fs.stat on the binary + model) but the right-click
// context menu re-asks the main process every time it's opened, and
// probing 5 times / second when the user is hammering the menu adds
// up. One probe per session, refreshed only on user request
// (e.g. after a future "install isnetbg" flow that calls
// `resetCache()` on the main side).
let _isnetbgStatusCache = null;
async function probeIsnetbgStatus(forceRefresh = false) {
  if (!forceRefresh && _isnetbgStatusCache) return _isnetbgStatusCache;
  let st = { available: false, binaryPath: null, modelPath: null, modelPresent: false, version: '', checked: true };
  try { st = await window.api.isnetbgAvailable(); st.checked = true; }
  catch (_) { st.checked = false; }
  _isnetbgStatusCache = st;
  return st;
}

// Run the optional isnetbg binary on a local image and return the
// path to the transparent PNG it wrote. Refuses to do anything when
// the binary / model is missing — the caller is expected to probe
// via `probeIsnetbgStatus()` first and show a precise error.
//
// We never overwrite the source: the output is written to
// `<stem>_nobg.png` next to the input (with a numeric suffix on
// collision). The caller can then delete / rename the source or
// hand the new path to the preview pane.
async function removeBackgroundFile(srcPath, opts = {}) {
  const st = await probeIsnetbgStatus();
  if (!st.checked) throw new Error('Could not contact background-removal backend.');
  if (!st.available) {
    throw new Error('Background removal is not set up. Run `npm run setup` in the project root to download the IS-Net model into ./bin/models/. The Optional add-ons popup (⚙ Settings → Image upscaling → "Re-open add-ons") walks you through every install path.');
  }
  if (!st.modelPresent) throw new Error('Background-removal model file missing. Run `npm run setup` (or place isnet-general-use.onnx in ./bin/models/ by hand).');

  const useGpu = (opts.useGpu !== undefined) ? !!opts.useGpu : (state.removeBackgroundUseGpu !== false);
  const sep = srcPath.includes('\\') ? '\\' : '/';
  const lastSep = srcPath.lastIndexOf(sep);
  const dir = lastSep >= 0 ? srcPath.slice(0, lastSep) : '';
  const lastDot = srcPath.lastIndexOf('.');
  // Same infix pattern as upscale (`_2x` → `_nobg`). PNG is the
  // only sensible output for a transparent image; we keep the
  // input extension only for human-readability (the actual file is
  // always PNG inside, since the isnetbg binary writes a PNG).
  const baseName = lastDot > lastSep ? srcPath.slice(lastSep + 1, lastDot) : srcPath.slice(lastSep + 1);
  const target = await uniqueOutputPath(`${dir}${sep}${baseName}_nobg.png`);
  const r = await window.api.isnetbgRun(srcPath, target, { useGpu });
  if (!r || !r.ok) {
    const msg = (r && r.stderr) || (r && ('isnetbg exited with code ' + r.code)) || 'isnetbg failed';
    // v1.1.15: log the failure to the structured log pane
    // so the user can see what went wrong (and copy the
    // error from the log for support).
    if (typeof window.addLogEvent === 'function') {
      try {
        window.addLogEvent({
          category: 'error',
          result: 'err',
          headline: `Background removal failed: ${msg.split('\n')[0]}`,
          details: [`Source: ${srcPath}`, `Stderr: ${(r && r.stderr) || '(empty)'}`],
        });
      } catch (_) { /* best-effort */ }
    }
    throw new Error(msg);
  }
  const outPath = r.outputPath || target;
  // v1.1.15: log the success. (The post-process chain
  // also logs it with extra context, so a duplicate entry
  // may appear in the post-process path — that's
  // intentional, the user wants the chain to log the
  // result regardless of which entry point ran the
  // operation.)
  if (typeof window.addLogEvent === 'function') {
    try {
      window.addLogEvent({
        category: 'bg',
        result: 'ok',
        headline: `Background removed → ${(outPath || '').split(/[\\/]/).pop()}`,
        details: [`Source: ${srcPath}`, `Output: ${outPath}`],
      });
    } catch (_) { /* best-effort */ }
  }
  return outPath;
}

// Upscale an image to multiplier× its original size. If the
// realesrgan-ncnn-vulkan binary is installed (PATH or ./bin/), we
// run it to get a high-quality 4× intermediate, then resize the
// result down to the requested multiplier (or do an extra 2× step
// for 8×). Real-ESRGAN's x4plus model is BSD-3-Clause licensed and
// produces noticeably more detail than the built-in
// multi-step createImageBitmap pipeline. If the binary is missing,
// we fall back to the multi-step pipeline so the tool is never
// blocked.
//
// Returns the output path on disk.
async function upscaleImageFile(srcPath, multiplier) {
  multiplier = Math.max(1, Math.min(8, Math.floor(Number(multiplier) || 2)));

  // v1.1.15 (reported by user): the previous version
  // never logged upscale actions. The user wanted every
  // pipeline step to appear in the structured log pane so
  // they can see at a glance what ran. We log the start
  // here and the success/failure at the end of the
  // function (with a groupId so the start + end cluster
  // visually).
  const upGroup = 'up-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
  const addLog = (opts) => {
    if (typeof window.addLogEvent === 'function') {
      try { window.addLogEvent(opts); } catch (_) { /* best-effort */ }
    }
  };
  addLog({
    category: 'upscale',
    groupId: upGroup,
    headline: `Upscale started: ${multiplier}× → ${(srcPath || '').split(/[\\/]/).pop() || 'image'}`,
    details: [`Source: ${srcPath}`, `Multiplier: ${multiplier}×`],
  });

  // Probe Real-ESRGAN availability. Cheap IPC (just a `which` /
  // bundled-file stat); the result is cached in the main process.
  let reStatus = null;
  try { reStatus = await window.api.realesrganAvailable(); } catch (_) {}

  if (reStatus && reStatus.available) {
    try {
      const outPath = await upscaleImageFileRealesrgan(srcPath, multiplier, reStatus);
      addLog({
        category: 'upscale',
        groupId: upGroup,
        result: 'ok',
        headline: `Upscale complete (Real-ESRGAN ${multiplier}×)`,
        details: [`Output: ${outPath}`],
      });
      return outPath;
    } catch (e) {
      // Real-ESRGAN is available but failed (corrupt model, GPU OOM,
      // etc.). Log the error and fall back to the built-in pipeline
      // so the user still gets a result.
      console.error('Real-ESRGAN upscale failed, falling back to built-in:', e);
      toast('Real-ESRGAN upscale failed (' + (e.message || e) + '). Using built-in upscale.', 'warn', 4000);
      addLog({
        category: 'upscale',
        groupId: upGroup,
        headline: `Real-ESRGAN failed, falling back to built-in: ${e.message || e}`,
      });
      // fall through to built-in
    }
  } else if (!_reEsrganNotified) {
    _reEsrganNotified = true;
    toast(
      'Real-ESRGAN not installed — using the built-in upscale. ' +
      'Drop the binary into ./bin/ (or add it to PATH) for noticeably higher-quality output. ' +
      'See README for the download link.',
      'info', 6000,
    );
  }

  // Built-in multi-step path.
  const srcImg = await loadImageFromFile(srcPath);
  const targetW = Math.max(1, Math.floor(srcImg.naturalWidth * multiplier));
  const targetH = Math.max(1, Math.floor(srcImg.naturalHeight * multiplier));
  let curW = srcImg.naturalWidth;
  let curH = srcImg.naturalHeight;
  let cur = srcImg;
  while (curW < targetW || curH < targetH) {
    const stepW = Math.min(targetW, curW * 2);
    const stepH = Math.min(targetH, curH * 2);
    cur = await upscaleStep(cur, stepW, stepH);
    curW = stepW;
    curH = stepH;
  }
  const mime = mimeFromPath(srcPath);
  const out = document.createElement('canvas');
  out.width = targetW;
  out.height = targetH;
  const octx = out.getContext('2d');
  if (mime === 'image/jpeg') {
    octx.fillStyle = '#ffffff';
    octx.fillRect(0, 0, targetW, targetH);
  }
  octx.drawImage(cur, 0, 0);
  const dataUrl = out.toDataURL(mime, 0.95);
  const b64 = dataUrl.split(',')[1];
  // uniqueOutputPath appends " (2)", " (3)", ... to a clashing
  // name so re-running the same upscale twice doesn't silently
  // overwrite the previous output.
  const outPath = await uniqueOutputPath(derivedOutputPath(srcPath, `_${multiplier}x`));
  const r = await window.api.fbWrite(outPath, b64);
  if (!r.ok) {
    addLog({
      category: 'upscale',
      groupId: upGroup,
      result: 'err',
      headline: `Upscale failed: ${r.error || 'fbWrite failed'}`,
    });
    throw new Error(r.error || 'fbWrite failed');
  }
  // v1.1.15: log the success of the built-in upscale
  // path so the structured log pane shows every pipeline
  // step the user ran. (The Real-ESRGAN path logs its
  // own success above.)
  addLog({
    category: 'upscale',
    groupId: upGroup,
    result: 'ok',
    headline: `Upscale complete (built-in ${multiplier}×, ${targetW}×${targetH})`,
    details: [`Output: ${r.path}`],
  });
  return r.path;
}

// Whitelist of Real-ESRGAN model names we know about. The model
// becomes the `-n` flag value of the spawn, so this is also a
// defence against a corrupted state.json / compromised renderer
// injecting an arbitrary flag into the binary's argv. Update
// when a new model is added to ./bin/models/.
const REAL_ESRGAN_MODELS = new Set([
  'realesrgan-x4plus',
  'realesrgan-x4plus-anime',
  'realesrgan-animevideov3',
  'realesr-general-x4v3',
]);

// Real-ESRGAN path. The ncnn-vulkan binary always outputs at the
// model's native scale (4× for x4plus). For multipliers other than
// 4×, we resize the intermediate using the same createImageBitmap
// step the built-in path uses:
//   - 2×: 4× → 2×  (downscale)
//   - 3×: 4× → 3×  (downscale)
//   - 4×: 4× as-is
//   - 8×: 4× → 8×  (extra 2× step)
async function upscaleImageFileRealesrgan(srcPath, multiplier, reStatus) {
  // Pick a model: prefer the user's saved choice, but only if it's on
  // the whitelist. Anything else (default, typo, exploit attempt)
  // falls back to the general-purpose 4× BSD-3 model.
  const wanted = (state.realesrganModel || '').trim();
  const model = REAL_ESRGAN_MODELS.has(wanted) ? wanted : 'realesrgan-x4plus';

  // The Real-ESRGAN binary needs a writable output path. Write its
  // 4× intermediate to a `.realesrgan_tmp.png` next to the source
  // (in output_dir, so it's already in the allowed roots) and
  // clean it up in `finally`.
  const sep = srcPath.includes('\\') ? '\\' : '/';
  const dot = srcPath.lastIndexOf('.');
  const stem = dot > 0 ? srcPath.slice(0, dot) : srcPath;
  const tempOut = stem + '.realesrgan_tmp.png';

  let r;
  try {
    r = await window.api.realesrganRun(srcPath, tempOut, {
      model,
      scale: 4,
    });
  } catch (e) {
    throw new Error('Real-ESRGAN run threw: ' + (e.message || e));
  }
  if (!r || !r.ok) {
    const msg = (r && r.stderr) || 'Real-ESRGAN returned a non-zero exit';
    throw new Error(msg);
  }

  try {
    // Load the 4× intermediate and resize to the user's multiplier.
    const reImg = await loadImageFromFile(tempOut);
    const naturalW = reImg.naturalWidth / 4;
    const naturalH = reImg.naturalHeight / 4;
    const targetW = Math.max(1, Math.floor(naturalW * multiplier));
    const targetH = Math.max(1, Math.floor(naturalH * multiplier));
    let cur = reImg;
    let curW = reImg.naturalWidth;
    let curH = reImg.naturalHeight;
    if (multiplier !== 4) {
      cur = await upscaleStep(cur, targetW, targetH);
      curW = targetW;
      curH = targetH;
    }

    const mime = mimeFromPath(srcPath);
    const out = document.createElement('canvas');
    out.width = curW;
    out.height = curH;
    const octx = out.getContext('2d');
    if (mime === 'image/jpeg') {
      octx.fillStyle = '#ffffff';
      octx.fillRect(0, 0, curW, curH);
    }
    octx.drawImage(cur, 0, 0);
    const dataUrl = out.toDataURL(mime, 0.95);
    const b64 = dataUrl.split(',')[1];
    const outPath = await uniqueOutputPath(derivedOutputPath(srcPath, `_${multiplier}x`));
    const w = await window.api.fbWrite(outPath, b64);
    if (!w.ok) throw new Error(w.error || 'fbWrite failed');
    return w.path;
  } finally {
    // Best-effort cleanup of the intermediate. If the user is
    // hammering the upscale button the file may already be
    // re-created; fbDelete tolerates ENOENT.
    window.api.fbDelete(tempOut).catch(() => {});
  }
}

// Crop an image to the given pixel rectangle (in image coordinates).
// Output file uses the same extension as the source.
async function cropImageFile(srcPath, x, y, w, h) {
  x = Math.max(0, Math.floor(Number(x) || 0));
  y = Math.max(0, Math.floor(Number(y) || 0));
  w = Math.max(1, Math.floor(Number(w) || 1));
  h = Math.max(1, Math.floor(Number(h) || 1));
  const img = await loadImageFromFile(srcPath);
  // Clamp to image bounds
  if (x + w > img.naturalWidth) w = img.naturalWidth - x;
  if (y + h > img.naturalHeight) h = img.naturalHeight - y;
  if (w <= 0 || h <= 0) throw new Error('Crop region is outside the image.');
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
  const mime = mimeFromPath(srcPath);
  const dataUrl = canvas.toDataURL(mime);
  const b64 = dataUrl.split(',')[1];
  // Same collision-avoidance as upscale: re-cropping the same file
  // to the same W × H now produces " (2)" / " (3)" instead of
  // silently overwriting the previous output.
  const out = await uniqueOutputPath(derivedOutputPath(srcPath, `_cropped_${w}x${h}`));
  const r = await window.api.fbWrite(out, b64);
  // v1.1.15: log the crop action to the structured log pane
  // so the user can see every pipeline step at a glance.
  // (Same pattern as upscale / background-removal / optimize.)
  if (typeof window.addLogEvent === 'function') {
    try {
      window.addLogEvent({
        category: r.ok ? 'upscale' : 'error',
        result: r.ok ? 'ok' : 'err',
        headline: r.ok
          ? `Cropped to ${w}×${h} → ${(out || '').split(/[\\/]/).pop()}`
          : `Crop failed: ${r.error || 'fbWrite failed'}`,
        details: r.ok
          ? [`Source: ${srcPath}`, `Region: ${x},${y} ${w}×${h}`, `Output: ${out}`]
          : [`Source: ${srcPath}`, `Region: ${x},${y} ${w}×${h}`],
      });
    } catch (_) { /* best-effort */ }
  }
  if (!r.ok) throw new Error(r.error || 'fbWrite failed');
  return r.path;
}

// Convert an image to a different format (png / jpeg / webp). Returns
// the output path. The new file has the target extension.
async function convertImageFile(srcPath, targetFormat) {
  const targetMime = `image/${targetFormat}`;
  const img = await loadImageFromFile(srcPath);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  // JPEG: no alpha; flatten onto white background.
  if (targetMime === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0);
  const dataUrl = canvas.toDataURL(targetMime, 0.95);
  const b64 = dataUrl.split(',')[1];
  const ext = extFromMime(targetMime);
  // Build the output path: same stem, new extension.
  const sep = srcPath.includes('\\') ? '\\' : '/';
  const lastSep = srcPath.lastIndexOf(sep);
  const dir = lastSep >= 0 ? srcPath.slice(0, lastSep) : '';
  const lastDot = srcPath.lastIndexOf('.');
  const stem = lastDot > lastSep ? srcPath.slice(0, lastDot) : srcPath;
  const out = `${dir}${sep}${stem.split(sep).pop()}_converted.${ext}`;
  const r = await window.api.fbWrite(out, b64);
  // v1.1.15: log the convert action to the structured log
  // pane. The user wants every pipeline step to be
  // visible at a glance.
  if (typeof window.addLogEvent === 'function') {
    try {
      window.addLogEvent({
        category: r.ok ? 'upscale' : 'error',
        result: r.ok ? 'ok' : 'err',
        headline: r.ok
          ? `Converted to ${targetFormat} → ${(out || '').split(/[\\/]/).pop()}`
          : `Convert failed: ${r.error || 'fbWrite failed'}`,
        details: r.ok
          ? [`Source: ${srcPath}`, `Format: ${targetFormat}`, `Output: ${out}`]
          : [`Source: ${srcPath}`, `Format: ${targetFormat}`],
      });
    } catch (_) { /* best-effort */ }
  }
  if (!r.ok) throw new Error(r.error || 'fbWrite failed');
  return r.path;
}

