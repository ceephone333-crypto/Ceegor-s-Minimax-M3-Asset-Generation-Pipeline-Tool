// renderer/overlays/imageOverlays.js (Phase 3 Block 26)
// 3 Image-Pipeline-Overlays: showConvertOverlay (Format-Convert),
// showCropOverlay (Crop), showOptimizeOverlay (Compress).

// Format-converter overlay. Shows the source format and a dropdown of
// supported targets (PNG, JPEG, WebP). Output file uses the new
// extension; quality is fixed at 0.95.
function showConvertOverlay(srcPath, targets) {
  // Multi-select batch (2026-07-01): when ≥2 images are checked in the
  // folder explorer, `targets` holds all of them and the confirm loops
  // over every one with the chosen output format. The dialog UI still
  // reflects the primary (right-clicked) srcPath.
  const batch = Array.isArray(targets) && targets.length > 1 ? targets.slice() : null;
  // v1.1 (audit M11): use path-based extension extraction, NOT
  // split('.').pop(). The pre-v1.1 code returned the WHOLE filename
  // for an extension-less source, which then failed to match any
  // format and pre-selected ALL THREE format options, leaving the
  // <select> on whichever was last (webp) regardless of source.
  const lastDot = Math.max(srcPath.lastIndexOf('.'), srcPath.lastIndexOf('/'), srcPath.lastIndexOf('\\'));
  const hasExt = lastDot >= 0 && srcPath.indexOf('.', lastDot) === lastDot && srcPath.slice(lastDot + 1).length > 0;
  const ext = hasExt ? srcPath.slice(lastDot + 1).toLowerCase() : '';
  const srcFmt = ext.toUpperCase() || '?';
  showModal((m, close) => {
    m.appendChild(el('h2', {}, '⇄ Convert image format'));
    m.appendChild(el('p', { class: 'meta', style: 'color: var(--fg-2); font-size: 12px;' },
      batch ? `Converting ${batch.length} selected images` : 'Source: ' + srcPath));
    const srcFmtLabel = el('input', { type: 'text', value: srcFmt, readonly: '' });
    const outSel = el('select', {});
    // Supported output targets. All three are written natively by
    // canvas.toDataURL (Chromium supports image/webp since v32).
    for (const [v, lbl] of [
      ['png',  'PNG  (lossless, supports transparency)'],
      ['jpeg', 'JPEG (smaller files, no transparency)'],
      ['webp', 'WebP (modern, smaller files)'],
    ]) {
      const opt = el('option', { value: v }, lbl);
      // Default to a different format than the source
      if (v !== ext) opt.selected = true;
      outSel.appendChild(opt);
    }
    m.appendChild(el('div', { class: 'row' }, [el('label', {}, 'Input format'), srcFmtLabel]));
    m.appendChild(el('div', { class: 'row' }, [el('label', {}, 'Output format'), outSel]));
    const convertBtn = el('button', { class: 'primary' }, 'Convert');
    const cancelBtn = el('button', { onclick: close }, 'Cancel');
    convertBtn.addEventListener('click', async () => {
      const target = outSel.value;
      // The "same format, nothing to do" guard only makes sense for a
      // single source; a batch can contain mixed source formats.
      if (!batch && target === ext) {
        toast('Source and target format are the same — nothing to do.', 'warn', 3000);
        return;
      }
      convertBtn.disabled = true; convertBtn.textContent = 'Converting…';
      try {
        if (batch) {
          // Loop every checked image through the same target format.
          await runImagePipelineBatch(`Convert → ${target.toUpperCase()}`, batch, (p) => convertImageFile(p, target));
          close();
          return;
        }
        const out = await convertImageFile(srcPath, target);
        toast(`Converted to ${target.toUpperCase()} → ${out}`, 'ok', 4000);
        await refreshBrowser();
        // v1.1 (audit M3): guard + invoke the SAME function. The
        // pre-v1.1 code tested `typeof updatePreviewPane` then
        // called `previewImageFromFile` — a latent ReferenceError
        // hidden by the surrounding try/catch. We now check the
        // function we actually call.
        if (typeof previewImageFromFile === 'function') {
          try { previewImageFromFile(out); } catch (_) {}
        }
        close();
      } catch (e) {
        toast('Convert failed: ' + (e && e.message || e), 'err', 6000);
        convertBtn.disabled = false; convertBtn.textContent = 'Convert';
      }
    });
    m.appendChild(el('div', { class: 'footer' }, [cancelBtn, convertBtn]));
  });
}

// Crop overlay. The image is rendered at its natural pixel size inside
// a scrollable container; the user enters W x H, clicks Apply, and a
// green-bordered draggable frame appears at the specified size. The
// user can drag the frame to position it; clicking Crop finalizes.
function showCropOverlay(srcPath, targets) {
  // Multi-select batch (2026-07-01): apply the SAME crop rectangle
  // (position + W × H, as dragged on the primary image) to every checked
  // image. cropImageFile clamps the rectangle to each image's own bounds
  // and throws if it falls entirely outside — those count as failures in
  // the batch summary. Best suited to same-sized images (the common case
  // for a batch of generated assets).
  const batch = Array.isArray(targets) && targets.length > 1 ? targets.slice() : null;
  showModal((m, close) => {
    m.appendChild(el('h2', {}, '✂ Crop image'));
    m.appendChild(el('p', { class: 'meta', style: 'color: var(--fg-2); font-size: 12px;' },
      batch ? `Cropping ${batch.length} selected images — the frame below is set on the first; the same rectangle is applied to all.` : 'Source: ' + srcPath));

    // Inputs row: auto-size checkbox, Width, Height, Apply
    // The "auto-size" checkbox is on by default: when checked, the
    // image and the green crop frame are both scaled to fit inside the
    // stage so a 4K source doesn't overflow the modal. The W/H inputs
    // still describe the crop in image pixels (the scale only affects
    // the on-screen display).
    const autoSizeCb = el('input', { type: 'checkbox', class: 'auto-size-cb' });
    autoSizeCb.checked = true;
    const wInput = el('input', { type: 'number', min: '1', value: '1024' });
    const hInput = el('input', { type: 'number', min: '1', value: '1024' });
    const applyBtn = el('button', { class: 'btn-mini' }, 'Apply');
    const cropBtn = el('button', { class: 'primary' }, 'Crop');
    const cancelBtn = el('button', { onclick: close }, 'Cancel');
    // The image stage: image + draggable frame overlay.
    const stage = el('div', { class: 'crop-stage' });
    const img = el('img', { class: 'crop-image' });
    // Hidden until we know the image's natural size.
    img.style.visibility = 'hidden';
    stage.appendChild(img);
    let frame = null;
    let frameX = 0, frameY = 0;
    // displayScale converts image pixels -> display pixels:
    //   displayW = imageW * displayScale
    //   displayH = imageH * displayScale
    // When auto-size is on and the image is bigger than the stage,
    // displayScale < 1 so the whole image + frame fit on screen. When
    // auto-size is off, displayScale = 1 (natural size, the original
    // behaviour). The drag handler uses this value to convert
    // display-pixel mouse deltas back into image-pixel positions.
    let displayScale = 1;

    m.appendChild(el('div', { class: 'crop-dim-row' }, [
      el('label', { class: 'auto-size-label' }, [autoSizeCb, ' auto-size']),
      el('label', {}, 'Width'), wInput, el('label', {}, 'Height'), hInput, applyBtn,
    ]));
    m.appendChild(stage);
    m.appendChild(el('div', { class: 'footer' }, [cancelBtn, cropBtn]));

    // Recompute the image's CSS size + the displayScale. Called when
    // the image finishes loading and when the user toggles the
    // checkbox. Reads the stage's actual client size (subtracting the
    // 4px padding on each side) so the math holds even after the
    // modal has been resized by the user.
    function applyAutoSize() {
      if (!img.naturalW) return;
      const stageW = stage.clientWidth || 1;
      const stageH = stage.clientHeight || 1;
      if (autoSizeCb.checked) {
        // Fit completely; never upscale beyond 1:1 (so we don't
        // bloat a small image to look pixelated).
        const s = Math.min(stageW / img.naturalW, stageH / img.naturalH, 1);
        displayScale = isFinite(s) && s > 0 ? s : 1;
      } else {
        displayScale = 1;
      }
      img.style.width = (img.naturalW * displayScale) + 'px';
      img.style.height = (img.naturalH * displayScale) + 'px';
    }
    autoSizeCb.addEventListener('change', () => {
      applyAutoSize();
      if (frame) showFrame();
    });

    // Load the image. Once decoded, show it and pre-fill W/H with the
    // natural size so the user can immediately Apply.
    // v1.1 (audit M2): the previous version unconditionally mutated
    // the modal DOM on resolve and called close() on reject. If the
    // user pressed Esc while a huge image was still decoding, the
    // .then callback ran on a detached modal (no-op at best, throws
    // at worst) and the .catch re-fired close() (calling onClose
    // hooks twice). We track a `closed` flag and skip both branches
    // when the modal has already gone.
    let closed = false;
    const origClose = close;
    close = () => { closed = true; origClose(); };
    loadImageFromFile(srcPath).then((loaded) => {
      if (closed) return; // Esc pressed mid-decode — modal is gone
      img.naturalW = loaded.naturalWidth;
      img.naturalH = loaded.naturalHeight;
      img.src = loaded.src;
      img.style.visibility = '';
      wInput.value = String(loaded.naturalWidth);
      hInput.value = String(loaded.naturalHeight);
      applyAutoSize();
    }).catch((e) => {
      if (closed) return; // already closed via Esc — don't double-close
      toast('Failed to load image: ' + e.message, 'err', 6000);
      origClose();
    });

    // Create / recreate the frame at the specified W x H, centered.
    // frameX/frameY are always in IMAGE pixels; the CSS left/top are
    // scaled by displayScale so the frame visually fits the image.
    function showFrame() {
      const w = Math.max(1, parseInt(wInput.value, 10) || 1);
      const h = Math.max(1, parseInt(hInput.value, 10) || 1);
      if (img.naturalW && (w > img.naturalW || h > img.naturalH)) {
        toast(`Frame size ${w}×${h} exceeds image size ${img.naturalW}×${img.naturalH}.`, 'warn', 4000);
        return;
      }
      if (frame) frame.remove();
      frame = el('div', { class: 'crop-frame', title: 'Drag to position' });
      // Display size = image size * scale
      frame.style.width = (w * displayScale) + 'px';
      frame.style.height = (h * displayScale) + 'px';
      // Center the frame initially
      frameX = Math.max(0, Math.floor((img.naturalW - w) / 2));
      frameY = Math.max(0, Math.floor((img.naturalH - h) / 2));
      // Display position = image position * scale
      frame.style.left = (frameX * displayScale) + 'px';
      frame.style.top = (frameY * displayScale) + 'px';
      stage.appendChild(frame);
      // Pass displayScale so the drag handler can convert
      // display-pixel mouse deltas to image-pixel positions.
      setupCropFrameDrag(frame, stage, () => img.naturalW, () => img.naturalH,
        (x, y) => { frameX = x; frameY = y; }, displayScale);
    }
    applyBtn.addEventListener('click', showFrame);

    cropBtn.addEventListener('click', async () => {
      if (!frame) { toast('Click Apply first to position the crop frame.', 'warn'); return; }
      const w = parseInt(wInput.value, 10) || 1;
      const h = parseInt(hInput.value, 10) || 1;
      cropBtn.disabled = true; cropBtn.textContent = 'Cropping…';
      try {
        if (batch) {
          // Same rectangle for every checked image (clamped per-image).
          await runImagePipelineBatch(`Crop ${w}×${h}`, batch, (p) => cropImageFile(p, frameX, frameY, w, h));
          close();
          return;
        }
        const out = await cropImageFile(srcPath, frameX, frameY, w, h);
        toast(`Cropped to ${w}×${h} → ${out}`, 'ok', 4000);
        await refreshBrowser();
        // v1.1 (audit M3): guard + invoke the SAME function.
        if (typeof previewImageFromFile === 'function') {
          try { previewImageFromFile(out); } catch (_) {}
        }
        close();
      } catch (e) {
        toast('Crop failed: ' + (e && e.message || e), 'err', 6000);
        cropBtn.disabled = false; cropBtn.textContent = 'Crop';
      }
    });
  });
}

// Image-optimisation overlay used by the folder-browser right-click
// menu ("🗜 Optimize / Compress…"). Lets the user re-encode a
// single image to shrink its file size while preserving best-
// possible visual quality, using the Sharp-backed `image:optimize`
// IPC.
//
// Three controls, matching the spec:
//   - Quality slider (1..100, default 82 — the perceptual sweet
//     spot for JPEG / WebP).
//   - Format dropdown (Keep / JPEG / PNG / WebP / AVIF). "Keep"
//     preserves the source format; the other four re-encode the
//     image to the target format (e.g. PNG → WebP for ~30%
//     smaller files at the same Q).
//   - "Strip non-essential EXIF (keep ICC profile)" checkbox, on
//     by default — drops camera model / GPS / software tags but
//     keeps the colour profile so the image still renders
//     correctly on colour-managed displays.
//
// On success, the dialog stays open and shows a results block
// ("4.2 MB → 612 KB · 85% smaller") with a one-click "Open
// folder" link. The user can keep clicking "Run" with different
// settings without re-opening the dialog (the slider
// reposition would otherwise re-trigger the action).
function showOptimizeOverlay(srcPath, targets) {
  // Multi-select batch (2026-07-01): when ≥2 images are checked, run the
  // chosen quality/format/strip settings across every one. The dialog UI
  // reflects the primary srcPath; the per-file results block is replaced
  // by a batch summary line.
  const batch = Array.isArray(targets) && targets.length > 1 ? targets.slice() : null;
  // v1.1 (audit M11): same path-aware extraction as showConvertOverlay.
  // The pre-v1.1 split('.').pop() returned the WHOLE filename for an
  // extension-less source path, mis-classifying it as a known format.
  const lastDot = Math.max(srcPath.lastIndexOf('.'), srcPath.lastIndexOf('/'), srcPath.lastIndexOf('\\'));
  const hasExt = lastDot >= 0 && srcPath.indexOf('.', lastDot) === lastDot && srcPath.slice(lastDot + 1).length > 0;
  const ext = hasExt ? srcPath.slice(lastDot + 1).toLowerCase() : '';
  const srcFmt = (ext === 'jpg' ? 'jpeg' : ext) || 'jpeg';
  // Pre-fill from the persisted settings so the user only has to
  // override the field they care about on a given run. The
  // settings dialog (Upscale settings → "Optimize" sub-section)
  // shares the same state, so a user who picked Q=70 for
  // "all generated images" gets the same starting point here.
  const cfg = state.optimizeSettings || { quality: 82, format: 'keep', stripMetadata: true };
  showModal((m, close) => {
    m.appendChild(el('h2', {}, '🗜 Optimize / Compress image'));
    m.appendChild(el('p', { class: 'meta', style: 'color: var(--fg-2); font-size: 12px;' },
      batch ? `Optimizing ${batch.length} selected images` : 'Source: ' + srcPath));

    // ---- Quality slider ----
    // The slider's range is 1..100. We display the current value
    // next to the slider so the user always knows the exact
    // number they're picking. Default 82 (perceptually lossless
    // on photographic content).
    const qualityInput = el('input', { type: 'range', min: '1', max: '100', step: '1', value: String(cfg.quality || 82) });
    const qualityLabel = el('span', { class: 'meta', style: 'min-width: 32px; text-align: right;' }, String(qualityInput.value));
    function syncQuality() { qualityLabel.textContent = String(qualityInput.value); }
    qualityInput.addEventListener('input', syncQuality);
    m.appendChild(el('div', { class: 'row' }, [
      el('label', {}, 'Quality'),
      qualityInput,
      qualityLabel,
    ]));
    // Tiny "presets" row so a user who's new to the concept can
    // jump to the canonical "sweet spot" with one click. The
    // explicit slider next to it is still the source of truth.
    const presetRow = el('div', { class: 'row', style: 'gap: 4px; flex-wrap: wrap;' });
    for (const [q, lbl] of [[60, 'small (60)'], [75, 'balanced (75)'], [82, 'max quality (82)'], [95, 'near-lossless (95)']]) {
      const b = el('button', { class: 'btn-mini', type: 'button' }, lbl);
      b.addEventListener('click', () => {
        qualityInput.value = String(q);
        syncQuality();
      });
      presetRow.appendChild(b);
    }
    m.appendChild(presetRow);

    // ---- Format dropdown ----
    // "Keep" preserves the source format; the other four re-encode
    // the image. We never show the current source format as a
    // separate "Same" option — that's exactly what "Keep" means.
    const fmtSel = el('select', {});
    const fmtDefs = [
      ['keep', `Keep source (${srcFmt.toUpperCase()})`],
      ['jpeg', 'JPEG (smallest lossy, no transparency)'],
      ['png',  'PNG  (lossless, supports transparency)'],
      ['webp', 'WebP (modern, ~30% smaller than JPEG)'],
      ['avif', 'AVIF (newest, smallest files, slow encode)'],
    ];
    for (const [v, lbl] of fmtDefs) {
      const opt = el('option', { value: v }, lbl);
      if ((cfg.format || 'keep') === v) opt.selected = true;
      fmtSel.appendChild(opt);
    }
    m.appendChild(el('div', { class: 'row' }, [el('label', {}, 'Output format'), fmtSel]));

    // ---- Strip-metadata checkbox ----
    // On by default. Drops EXIF (camera model, GPS, software
    // tag) but keeps the ICC colour profile (see
    // src/imageOptimizer.js for the exact pipeline).
    const stripCb = el('input', { type: 'checkbox' });
    stripCb.checked = cfg.stripMetadata !== false;
    m.appendChild(el('div', { class: 'row' }, [
      el('label', { class: 'auto-crop-label' }, [stripCb, ' Strip non-essential EXIF (keeps ICC colour profile)']),
    ]));

    // ---- Run / status / results block ----
    // The status row + results block live inside the same
    // container so the dialog can be re-used for multiple
    // consecutive runs (e.g. user picks a different Q, hits
    // Run again). Results are wiped on each click.
    const runBtn = el('button', { class: 'primary' }, '🗜 Optimize');
    const cancelBtn = el('button', { onclick: close }, 'Cancel');
    const status = el('div', { class: 'meta', style: 'color: var(--fg-2); font-size: 12px; min-height: 16px; margin: 4px 0;' }, '');
    const resultsBox = el('div', { style: 'margin: 8px 0; display: none;' });
    m.appendChild(status);
    m.appendChild(resultsBox);

    // Run handler. Catches failures into a single toast and
    // keeps the dialog open (with the Run button re-enabled) so
    // the user can fix a corrupt file or change settings and
    // retry without re-opening the dialog.
    runBtn.addEventListener('click', async () => {
      const quality = Math.max(1, Math.min(100, parseInt(qualityInput.value, 10) || 82));
      const format = fmtSel.value;
      const stripMetadata = stripCb.checked;
      // Persist the latest values so a subsequent "Optimize" run
      // from the right-click menu pre-fills the same settings.
      state.optimizeSettings = { quality, format, stripMetadata };
      await scheduleStateSave();

      runBtn.disabled = true;
      runBtn.textContent = 'Optimizing…';
      status.textContent = `Re-encoding at quality ${quality}…`;
      resultsBox.style.display = 'none';
      resultsBox.innerHTML = '';
      // Batch: run every checked image through the same settings, then
      // report a summary. The per-file results block (bytes saved etc.)
      // is single-file only; the batch worker's toast carries the roll-up.
      if (batch) {
        try {
          const { ok, fail } = await runImagePipelineBatch(`Optimize q${quality}`, batch,
            (p) => optimizeImageFile(p, { quality, format, stripMetadata }));
          status.textContent = `Done. ${ok} optimized${fail ? `, ${fail} failed (kept in selection)` : ''}.`;
        } catch (e) {
          status.textContent = 'Failed: ' + (e && e.message || e);
          toast('Optimize failed: ' + (e && e.message || e), 'err', 6000);
        }
        runBtn.disabled = false;
        runBtn.textContent = '🗜 Optimize';
        return;
      }
      try {
        const r = await optimizeImageFile(srcPath, { quality, format, stripMetadata });
        // Build a human-friendly results block. The exact bytes
        // and percent saved are shown so the user can see
        // whether the slider change was worth it. The link
        // re-selects the optimised file in the file browser
        // and opens its containing folder in Explorer.
        const fmtLbl = (r.format || '').toUpperCase() || '?';
        const inSize = humanSize(r.inputSize);
        const outSize = humanSize(r.outputSize);
        const saved = r.savedPercent || 0;
        const colorClass = saved >= 30 ? 'ok' : (saved >= 10 ? 'meta' : 'warn');
        const dimLbl = r.width && r.height ? `${r.width} × ${r.height}` : '';
        resultsBox.innerHTML = '';
        resultsBox.style.display = '';
        resultsBox.appendChild(el('div', { class: 'fb-item-info' }, [
          el('div', { class: 'fb-info-row' }, [
            el('span', { class: 'fb-info-key' }, 'Result'),
            el('span', { style: 'color: var(--' + (saved >= 30 ? 'ok' : 'fg-1') + ');' },
              `${inSize} → ${outSize}  (−${saved}%)`),
          ]),
          el('div', { class: 'fb-info-row' }, [
            el('span', { class: 'fb-info-key' }, 'Format'),
            el('span', {}, fmtLbl + (dimLbl ? ` · ${dimLbl}` : '')),
          ]),
          el('div', { class: 'fb-info-row' }, [
            el('span', { class: 'fb-info-key' }, 'Output'),
            el('span', { style: 'word-break: break-all;' }, r.outputPath),
          ]),
        ]));
        // "Reveal in Explorer" + "Preview" buttons, so the user
        // doesn't have to dig through the folder browser to
        // find the result.
        const revealBtn = el('button', { class: 'btn-mini', onclick: () => window.api.fbReveal(r.outputPath) }, '↗ Reveal in Explorer');
        const previewBtn = el('button', { class: 'btn-mini', onclick: () => { try { previewImageFromFile(r.outputPath); } catch (_) {} } }, '🖼 Preview');
        resultsBox.appendChild(el('div', { class: 'row', style: 'margin-top: 6px; gap: 6px;' }, [revealBtn, previewBtn]));
        // Refresh the file browser so the new sibling shows up
        // in the listing.
        try { await refreshBrowser(); } catch (_) {}
        // Toast + status so the user gets a clear "it worked"
        // signal even if they missed the inline result block.
        const tone = saved >= 1 ? 'ok' : 'info';
        toast(`Optimized ${inSize} → ${outSize} (−${saved}%) → ${r.outputPath}`, tone, 4000);
        status.textContent = `Done. ${inSize} → ${outSize} (−${saved}%).`;
        // Mark the saved settings as "the ones the user just
        // ran with" so a follow-up right-click on the optimised
        // file pre-fills the same choices.
        runBtn.disabled = false;
        runBtn.textContent = '🗜 Optimize';
      } catch (e) {
        // Structured failure from the IPC. Show the precise
        // message in the status line (toast is redundant here
        // because the user is staring at the dialog).
        status.textContent = 'Failed: ' + (e && e.message || e);
        toast('Optimize failed: ' + (e && e.message || e), 'err', 6000);
        runBtn.disabled = false;
        runBtn.textContent = '🗜 Optimize';
      }
    });
    m.appendChild(el('div', { class: 'footer' }, [cancelBtn, runBtn]));
  });
}

window.ImageOverlays = {
  showConvertOverlay,
  showCropOverlay,
  showOptimizeOverlay
};
