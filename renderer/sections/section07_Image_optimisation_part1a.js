// renderer/sections/section07_Image_optimisation_part1a.js (Phase 3 Block 31)
// Part 1a.

// renderer/sections/section07_Image_optimisation_part1.js (Phase 3 Block 30)
// First half of Image optimisation section.

// renderer/sections/section07_Image_optimisation___compression.js (Phase 3 Block 29)
// Extracted: Image optimisation / compression
// Source: app.js L2015..2945

// ----------------- Image optimisation / compression -----------------
// Thin wrapper around the main-process `image:optimize` IPC. The
// actual Sharp / libvips work happens in src/imageOptimizer.js; the
// renderer just translates UI choices into the IPC envelope and
// returns a structured result.
//
// `opts`:
//   {
//     quality:       1..100,                  // default 82
//     format:        'keep'|'jpeg'|'png'|'webp'|'avif',
//                                            // default 'keep'
//     stripMetadata: boolean,                 // default true
//     // `overwriteSource: true` writes the optimised bytes
//     // back to `srcPath` (atomic temp-file + rename on the
//     // main side). The post-generation pipeline uses this so
//     // the file the user just paid API credits to generate
//     // ends up as the smaller, optimised file â€” no
//     // intermediate "_optimized" sibling cluttering the
//     // output folder. The folder-browser right-click overlay
//     // leaves this off and uses a sibling file instead so
//     // the user can A/B the original against the optimised
//     // version.
//     overwriteSource: boolean,               // default false
//   }
//
// Returns the IPC envelope (see src/imageOptimizer.js header for
// the full shape). Throws an Error on the rare `!ok` path so the
// caller's catch block can show a single toast; the envelope
// itself also carries the message in `.error` for callers that
// want to render it inline (e.g. a results block in the dialog).
async function optimizeImageFile(srcPath, opts) {
  opts = opts || {};
  // Defensive: derive the actual `format` to pass to the IPC
  // from the UI's `format: 'keep' | 'jpeg' | ...` value. The
  // 'keep' alias is renderer-side only â€” the IPC expects
  // either a real format string or null/undefined for
  // "preserve source format".
  const fmt = (opts.format === 'keep' || !opts.format) ? null : opts.format;
  const overwrite = !!opts.overwriteSource;
  const out = overwrite
    ? srcPath
    : await uniqueOutputPath(derivedOutputPath(srcPath, '_optimized' + (fmt ? ('.' + fmt) : '')));
  const r = await window.api.optimizeImage(srcPath, {
    quality: opts.quality,
    format: fmt,
    stripMetadata: opts.stripMetadata !== false,
    outputPath: out,
  });
  if (!r || !r.ok) {
    const msg = (r && r.error) || 'Image optimisation failed.';
    const err = new Error(msg);
    err.result = r;
    throw err;
  }
  return r;
}

// Apply the full post-processing chain (upscale â†’ auto-crop â†’ remove
// background â†’ optimize) to a single generated image. The previous
// implementation of this chain in the image-tab gen handler only
// applied the steps to the LAST variant, which silently dropped the
// upscale / crop / no-bg / optimise work for variants 1..N-1. This
// helper is the per-file version of the same chain, called once per
// generated file by the gen handler.
//
// Each step is wrapped in its own try/catch and falls back to the
// best-available path on failure. The chain returns the final path
// (which may equal `srcPath` if every step was a no-op or failed).
//
// Args:
//   srcPath: the generated file to process
//   opts:
//     label:    optional suffix to add to status messages (e.g. " (2/3)")
//     onStatus: optional callback (msg) => void for the
//               "Upscaling 2Ã—â€¦" / "Croppingâ€¦" / "Removing backgroundâ€¦"
//               / "Optimizingâ€¦" status lines. If absent, the helper
//               just calls setStatus() + updates the image-tab preview
//               pane (legacy single-file behaviour).
//     onRefresh: optional callback to call after a step that writes
//               a new file (so the folder explorer can update right
//               away). The legacy code called refreshBrowser() after
//               each successful step; this helper calls onRefresh()
//               instead so callers (the image-tab gen handler, the
//               right-click "Optimize" overlay, etc.) can decide when
//               to refresh.
async function runPostProcessChain(srcPath, opts) {
  opts = opts || {};
  const label = opts.label || '';
  const onStatus = opts.onStatus || ((msg) => {
    setStatus(msg, true);
    const preview = $(`#tab-${state.currentTab} .preview`);
    if (preview) preview.innerHTML = `<div class="empty"><span class="spinner"></span> ${escapeHtml(msg)}</div>`;
  });
  const onRefresh = opts.onRefresh || (() => { try { refreshBrowser(); } catch (_) {} });
  let displayFile = srcPath;
  // If the Upscale checkbox is on, run the generated image through
  // the local upscaler after the mmx call returns. The preview then
  // shows the upscaled version, and the file browser gets the
  // new "<name>_Nx.png" file next to the original.
  if (state.upscaleEnabled && state.upscaleSettings) {
    try {
      onStatus(`Upscaling ${state.upscaleSettings.multiplier}Ã—${label}â€¦`);
      displayFile = await upscaleImageFile(displayFile, state.upscaleSettings.multiplier);
      addLogEvent({
        category: 'upscale',
        result: 'ok',
        headline: `Upscaled ${state.upscaleSettings.multiplier}Ã—${label ? ' ' + label.trim() : ''} â†’ ${displayFile.split(/[\\/]/).pop()}`,
        details: [
          `Source: ${srcPath}`,
          `Output: ${displayFile}`,
          `Multiplier: ${state.upscaleSettings.multiplier}Ã—`,
        ],
      });
      toast(`Upscaled to ${state.upscaleSettings.multiplier}Ã— â†’ ${displayFile}`, 'ok', 3000);
      // If auto-crop is also on, apply it now. The flow mirrors
      // showUpscaleDirect: load the upscaled file, compute the
      // crop frame at the chosen anchor, write the cropped file
      // and delete the intermediate.
      if (state.upscaleSettings.autoCrop) {
        const a = state.upscaleSettings;
        const upImg = await loadImageFromFile(displayFile);
        const uW = upImg.naturalWidth;
        const uH = upImg.naturalHeight;
        const wantW = a.cropWidth || uW;
        const wantH = a.cropHeight || uH;
        const w = Math.min(wantW, uW);
        const h = Math.min(wantH, uH);
        const maxX = uW - w;
        const maxY = uH - h;
        let x, y;
        if (a.cropAnchorX === 'left')        x = 0;
        else if (a.cropAnchorX === 'right') x = maxX;
        else                                x = Math.floor(maxX / 2);
        if (a.cropAnchorY === 'top')         y = 0;
        else if (a.cropAnchorY === 'bottom') y = maxY;
        else                                y = Math.floor(maxY / 2);
        onStatus(`Cropping to ${w} Ã— ${h}${label}â€¦`);
        const cropped = await cropImageFile(displayFile, x, y, w, h);
        // Drop the intermediate (full-upscaled) file.
        window.api.fbDelete(displayFile).catch(() => {});
        displayFile = cropped;
        toast(`Upscaled ${state.upscaleSettings.multiplier}Ã— and cropped to ${w} Ã— ${h} â†’ ${cropped}`, 'ok', 4000);
      }
      onRefresh();
    } catch (e) {
      console.error('Upscale failed:', e);
      toast('Upscale failed (kept original): ' + (e && e.message || e), 'warn', 4000);
      displayFile = srcPath;
    }
  }
  // "Remove background" stage â€” runs after upscale (if any) so
  // the user gets the transparent version of their final
  // image, not the raw generated file. Runs even when Upscale
  // is off (in that case the input is the raw generated file).
  // A failure here is non-fatal â€” we keep the (possibly
  // upscaled) displayFile and surface a warning, so the user
  // never loses the image they just paid API credits to
  // generate.
  if (state.removeBackgroundEnabled && displayFile) {
    try {
      onStatus(`Removing background${label}â€¦`);
      const noBg = await removeBackgroundFile(displayFile);
      // The intermediate (upscaled / cropped / raw) is now
      // redundant â€” the transparent version is the user's
      // actual deliverable. Delete the intermediate to keep
      // the output folder tidy; the user can still find it
      // in the file browser's lastN listing if they need it
      // back, and the original API-generated file is
      // untouched.
      if (noBg !== displayFile) {
        window.api.fbDelete(displayFile).catch(() => {});
        displayFile = noBg;
      }
      addLogEvent({
        category: 'bg',
        result: 'ok',
        headline: `Background removed${label ? ' ' + label.trim() : ''} â†’ ${displayFile.split(/[\\/]/).pop()}`,
        details: [
          `Source: ${srcPath}`,
          `Output: ${displayFile}`,
        ],
      });
      toast(`Background removed â†’ ${displayFile}`, 'ok', 4000);
      onRefresh();
    } catch (e) {
      console.error('Remove background failed:', e);
      toast('Background removal failed (kept image): ' + (e && e.message || e), 'warn', 5000);
    }
  }
  // "Optimize / Compress" stage â€” runs as the LAST step of the
  // post-processing chain (generate â†’ upscale â†’ crop â†’ remove
  // background â†’ optimize) so the user's final deliverable
  // ends up in the smallest possible file. Uses the Sharp +
  // libvips pipeline in src/imageOptimizer.js, with
  // overwriteSource: true so the optimised bytes replace
  // the post-background-removal file in place (atomic
  // temp-file + rename on the main side). A failure here is
  // non-fatal â€” we keep the (possibly upscaled / no-bg)
  // displayFile and surface a warning, so the user never
  // loses the image they just paid API credits to generate.
  if (state.optimizeSettings && state.optimizeSettings.enabled && displayFile) {
    try {
      const oSet = state.optimizeSettings;
      const inFmt = (displayFile.split('.').pop() || '').toLowerCase();
      const fmtLbl = (oSet.format && oSet.format !== 'keep') ? oSet.format.toUpperCase() : inFmt.toUpperCase();
      onStatus(`Optimizing${label} (Q${oSet.quality} â†’ ${fmtLbl})â€¦`);
      const r = await optimizeImageFile(displayFile, {
        quality: oSet.quality,
        format: oSet.format,
        stripMetadata: oSet.stripMetadata !== false,
        overwriteSource: true,
      });
      // The Sharp wrapper always writes to outputPath; with
      // overwriteSource: true that's the same path as the
      // input. The renderer doesn't get a new path back, so
      // displayFile stays the same â€” the bytes behind it
      // are now the smaller, optimised version.
      const inSize = humanSize(r.inputSize);
      const outSize = humanSize(r.outputSize);
      const saved = r.savedPercent || 0;
      const tone = saved >= 1 ? 'ok' : 'info';
      const savedSuffix = saved >= 1 ? ` (âˆ’${saved}%)` : '';
      addLogEvent({
        category: 'optimize',
        result: 'ok',
        headline: `Optimized${label ? ' ' + label.trim() : ''} ${fmtLbl} ${inSize} â†’ ${outSize}${savedSuffix}`,
        details: [
          `File: ${displayFile}`,
          `Quality: ${oSet.quality}`,
          `Format: ${fmtLbl}`,
          `Strip metadata: ${oSet.stripMetadata !== false ? 'yes' : 'no'}`,
          `Size: ${inSize} â†’ ${outSize} (${saved >= 0 ? 'âˆ’' : '+'}${Math.abs(saved)}%)`,
        ],
      });
      toast(`Optimized ${fmtLbl} ${inSize} â†’ ${outSize}${savedSuffix}`, tone, 4000);
      onRefresh();
    } catch (e) {
      console.error('Optimize failed:', e);
      toast('Optimize failed (kept image): ' + (e && e.message || e), 'warn', 5000);
    }
  }
  return displayFile;
}

// =================== Image-pipeline overlays ===================
// All three (Upscale settings, Crop, Convert) are pure modals built on
// showModal(). They share the same panel layout: title, description,
// form fields, action button, cancel.

// Settings overlay used by the "Upscale" checkbox in the image tab.
// Saves the chosen multiplier to state.upscaleSettings and closes; the
// checkbox stays checked so the next generation is upscaled.
function showUpscaleSettings() {
  if (!state.upscaleSettings) {
    state.upscaleSettings = { multiplier: 2, autoCrop: false, cropWidth: 0, cropHeight: 0, cropAnchorX: 'center', cropAnchorY: 'center' };
  }
  // Defensive: also fill in any missing fields on old state.js that
  // pre-dated the auto-crop support.
  const s = state.upscaleSettings;
  if (typeof s.autoCrop !== 'boolean') s.autoCrop = false;
  if (typeof s.cropWidth !== 'number') s.cropWidth = 0;
  if (typeof s.cropHeight !== 'number') s.cropHeight = 0;
  if (typeof s.cropAnchorX !== 'string') s.cropAnchorX = 'center';
  if (typeof s.cropAnchorY !== 'string') s.cropAnchorY = 'center';

  showModal((m, close) => {
    m.appendChild(el('h2', {}, 'ðŸ” Upscale settings'));
    m.appendChild(el('p', { style: 'color: var(--fg-2); font-size: 12px; margin-top: 0;' },
      'When the Upscale checkbox is on, every generated image is upscaled locally with the settings below before being shown. Pure browser Canvas â€” no API call, no network. The "auto-crop" options here are also picked up by the "Add" button on the image tab and applied to every entry in a batch.'));

    // Multiplier
    const multSel = el('select', {});
    for (const m2 of [2, 3, 4]) {
      const opt = el('option', { value: String(m2) }, `${m2}Ã— (larger)`);
      if (m2 === s.multiplier) opt.selected = true;
      multSel.appendChild(opt);
    }
    m.appendChild(el('div', { class: 'row' }, [el('label', {}, 'Multiplier'), multSel]));

    // auto-crop checkbox
    const autoCropCb = el('input', { type: 'checkbox', class: 'auto-crop-cb' });
    autoCropCb.checked = !!s.autoCrop;
    m.appendChild(el('div', { class: 'row' }, [
      el('label', { class: 'auto-crop-label' }, [autoCropCb, ' auto-crop to resolution']),
    ]));

    // crop W/H inputs (hidden by default)
    const cropWInput = el('input', { type: 'number', min: '0', value: String(s.cropWidth || 0) });
    const cropHInput = el('input', { type: 'number', min: '0', value: String(s.cropHeight || 0) });
    const cropSizeRow = el('div', { class: 'row auto-crop-only' }, [
      el('label', {}, 'Crop target W Ã— H (0 = use post-upscale target)'),
      cropWInput, el('span', {}, ' Ã— '), cropHInput,
    ]);
    cropSizeRow.style.display = s.autoCrop ? '' : 'none';
    m.appendChild(cropSizeRow);

    // 3Ã—3 anchor grid (hidden by default)
    const anchor = { x: s.cropAnchorX, y: s.cropAnchorY };
    const anchorGrid = el('div', { class: 'anchor-grid' });
    const cells = [];
    const GLYPHS = [
      ['â†–', 'top-left',     'left',    'top'],
      ['â†‘', 'top-center',   'center',  'top'],
      ['â†—', 'top-right',    'right',   'top'],
      ['â†', 'middle-left',  'left',    'center'],
      ['Â·', 'center',       'center',  'center'],
      ['â†’', 'middle-right', 'right',   'center'],
      ['â†™', 'bottom-left',  'left',    'bottom'],
      ['â†“', 'bottom-center','center',  'bottom'],
      ['â†˜', 'bottom-right', 'right',   'bottom'],
    ];
    for (let i = 0; i < GLYPHS.length; i++) {
      const [glyph, name, x, y] = GLYPHS[i];
      const cell = el('button', {
        type: 'button',
        class: 'anchor-cell' + (x === anchor.x && y === anchor.y ? ' selected' : ''),
        title: `Anchor: ${name} (crop keeps the ${name} corner)`,
        'data-x': x, 'data-y': y,
      }, glyph);
      cell.addEventListener('click', () => {
        for (const c of cells) c.classList.remove('selected');
        cell.classList.add('selected');
        anchor.x = x;
        anchor.y = y;
      });
      cells.push(cell);
      anchorGrid.appendChild(cell);
    }
    anchorGrid.style.display = s.autoCrop ? '' : 'none';
    m.appendChild(anchorGrid);

    function setAutoCropVisible(on) {
      cropSizeRow.style.display = on ? '' : 'none';
      anchorGrid.style.display = on ? '' : 'none';
    }
    autoCropCb.addEventListener('change', () => setAutoCropVisible(autoCropCb.checked));

    // ---- "Remove background" sub-section ----
    // Sits BELOW the upscale + auto-crop controls because it's the
    // last step in the pipeline (generate â†’ upscale â†’ crop â†’
    // background removal). The checkbox only saves the boolean
    // (and gates the whole section); the right-click "Remove
    // background" item still works regardless of this toggle.
    // We probe the isnetbg binary in the background so the UI can
    // show a precise "not installed" hint when needed (rather than
    // letting the user enable the toggle and only discover the
    // missing binary at generation time).
    const removeBgCb = el('input', { type: 'checkbox' });
    removeBgCb.checked = !!state.removeBackgroundEnabled;
    const removeBgStatus = el('span', { class: 'meta', style: 'color: var(--fg-2); font-size: 11px; margin-left: 8px;' }, '');
    const removeBgRow = el('div', { class: 'row' }, [
      el('label', { class: 'auto-crop-label' }, [removeBgCb, ' âœ¨ Remove background after upscale']),
      removeBgStatus,
    ]);
    m.appendChild(removeBgRow);
    m.appendChild(el('p', { class: 'meta', style: 'color: var(--fg-2); font-size: 11px; margin: 2px 0 0;' },
      'Runs the optional isnetbg binary on the upscaled (and optionally cropped) image and writes a transparent PNG. The original file is preserved as the input to this step.'));
    // GPU sub-toggle. Visible only when the main checkbox is on, so
    // we don't tease a knob the user can't currently act on.
    const useGpuCb = el('input', { type: 'checkbox' });
    useGpuCb.checked = state.removeBackgroundUseGpu !== false;
    const useGpuRow = el('div', { class: 'row auto-crop-only' }, [
      el('label', { class: 'auto-crop-label' }, [useGpuCb, ' use GPU acceleration (DirectML / CUDA)']),
    ]);
    useGpuRow.style.display = removeBgCb.checked ? '' : 'none';
    m.appendChild(useGpuRow);
    function setRemoveBgVisible(on) {
      useGpuRow.style.display = on ? '' : 'none';
    }
    removeBgCb.addEventListener('change', () => setRemoveBgVisible(removeBgCb.checked));
    // Probe the binary in the background and surface a precise
    // status. We use a small helper so the right-click "Remove
    // background" action can reuse the same probe + status text.
    probeIsnetbgStatus().then((st) => {
      if (!st.checked) return;
      if (st.available && st.modelPresent) {
        // Same binary/node disambiguation as the add-ons popup.
        const isNode = st.version === 'node-onnxruntime';
        if (isNode) {
          removeBgStatus.textContent = '(IS-Net Node.js wrapper + model detected)';
        } else {
          const v = st.version ? ` v${st.version}` : '';
          removeBgStatus.textContent = `(isnetbg binary${v} + model detected)`;
        }
        removeBgStatus.style.color = 'var(--fg-2)';
      } else if (st.available && !st.modelPresent) {
        removeBgStatus.textContent = '(binary installed, model missing â€” see README)';
        removeBgStatus.style.color = 'var(--warn, #d9a300)';
      } else {
        removeBgStatus.textContent = '(not installed â€” see README)';
        removeBgStatus.style.color = 'var(--warn, #d9a300)';
      }
    });

    // "Re-open add-ons" link. The full install UI lives in
    // openOptionalAddons() and is shown as a first-run popup;
    // this link gives the user a one-click re-entry from the
    // settings popup without having to dig through the README.
    // Cached probe is invalidated inside openOptionalAddons
    // after every install, so the next time the user opens
    // THIS popup the new status is reflected.
    const reopenLink = el('button', {
      class: 'btn-mini',
      style: 'margin-top: 6px;',
      onclick: () => openOptionalAddons({ autoOpened: false }),
    }, 'ðŸ§© Re-open add-ons managerâ€¦');
    m.appendChild(reopenLink);

    // ---- Section 3: ðŸ—œ Optimize / Compress (post-generation) ----
    // Re-encodes every generated image with the Sharp + libvips
    // pipeline in src/imageOptimizer.js. Sits at the END of the
    // post-processing chain (generate â†’ upscale â†’ crop â†’ remove
    // background â†’ optimize) so the user's final deliverable
    // lands in the smallest possible file. The right-click
    // "Optimize / Compressâ€¦" entry in the folder browser uses
    // the same settings as defaults.
    if (!state.optimizeSettings) {
      state.optimizeSettings = { enabled: false, quality: 82, format: 'keep', stripMetadata: true };
    }
    const oSet = state.optimizeSettings;
    if (typeof oSet.enabled !== 'boolean') oSet.enabled = false;
    if (typeof oSet.quality !== 'number') oSet.quality = 82;
    if (typeof oSet.format !== 'string') oSet.format = 'keep';
    if (typeof oSet.stripMetadata !== 'boolean') oSet.stripMetadata = true;

    const optimizeCb = el('input', { type: 'checkbox' });
    optimizeCb.checked = !!oSet.enabled;
    m.appendChild(el('div', { class: 'row' }, [
      el('label', { class: 'auto-crop-label' }, [optimizeCb, ' ðŸ—œ Optimize / compress the final image']),
    ]));
    m.appendChild(el('p', { class: 'meta', style: 'color: var(--fg-2); font-size: 11px; margin: 2px 0 0;' },
      'Re-encodes the final image with Sharp + libvips to shrink its file size while preserving best-possible visual quality. Runs as the LAST step of the post-generation pipeline so the output you end up with is the smallest version that still looks the same.'));

    // Quality slider (1..100, default 82 â€” the perceptual sweet
    // spot for JPEG / WebP). Visible only when the master
    // checkbox is on, so we don't tease a knob the user can't
    // currently act on.
    const qualityInput = el('input', { type: 'range', min: '1', max: '100', step: '1', value: String(oSet.quality) });
    const qualityLabel = el('span', { class: 'meta', style: 'min-width: 32px; text-align: right;' }, String(qualityInput.value));
    function syncQuality() { qualityLabel.textContent = String(qualityInput.value); }
    qualityInput.addEventListener('input', syncQuality);
    const qualityRow = el('div', { class: 'row auto-crop-only' }, [
      el('label', {}, 'Quality'),
