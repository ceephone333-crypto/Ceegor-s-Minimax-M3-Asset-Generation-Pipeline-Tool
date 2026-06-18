// renderer/sections/section07_Image_optimisation_part2.js (Phase 3 Block 30)
// Second half of Image optimisation section.

async function showUpscaleDirect(srcPath) {
  // We need the source's natural resolution to compute the target.
  // If the image is unreadable, surface the error and bail â€” the
  // dialog needs a known sourceW Ã— sourceH to do anything useful.
  let srcW = 0, srcH = 0;
  try {
    const img = await loadImageFromFile(srcPath);
    srcW = img.naturalWidth;
    srcH = img.naturalHeight;
    if (!srcW || !srcH) throw new Error('Image has no natural dimensions');
  } catch (e) {
    toast('Failed to load image: ' + (e && e.message || e), 'err', 6000);
    return;
  }
  // Pull defaults from the global upscale settings so the
  // right-click "Upscale" dialog and the tab's "Upscale Settings"
  // dialog are in sync. The user can still change anything for
  // this one-off run; the Save below updates state.upscaleSettings
  // if they do, so the next right-click / next generation sees
  // the new values.
  const us = state.upscaleSettings || { multiplier: 2, autoCrop: false, cropWidth: 0, cropHeight: 0, cropAnchorX: 'center', cropAnchorY: 'center' };
  showModal((m, close) => {
    m.appendChild(el('h2', {}, 'ðŸ” Upscale image'));
    m.appendChild(el('p', { class: 'meta', style: 'color: var(--fg-2); font-size: 12px;' },
      'Source: ' + srcPath));

    // Resolution row: source (immutable) + target after upscale (live).
    // The target updates whenever the multiplier or crop W/H changes.
    const targetText = el('div', { class: 'meta' }, '');
    function refreshTarget() {
      const mult = parseInt(multSel.value, 10) || 2;
      const tW = srcW * mult;
      const tH = srcH * mult;
      // 0 = use post-upscale target. Negative is impossible (the
      // min="0" attribute + Math.max in the save handler guard it).
      const wantCropW = parseInt(cropWInput.value, 10);
      const wantCropH = parseInt(cropHInput.value, 10);
      const cropW = (isNaN(wantCropW) || wantCropW <= 0) ? tW : wantCropW;
      const cropH = (isNaN(wantCropH) || wantCropH <= 0) ? tH : wantCropH;
      const w = Math.min(cropW, tW);
      const h = Math.min(cropH, tH);
      const cropNote = autoCropCb.checked ? ` Â· after auto-crop: ${w} Ã— ${h} px` : '';
      targetText.textContent = `Source ${srcW} Ã— ${srcH} px  â†’  after upscale: ${tW} Ã— ${tH} px${cropNote}`;
    }

    m.appendChild(el('div', { class: 'row' }, [el('label', {}, 'Resolution'), targetText]));

    // Multiplier selector (2Ã— / 3Ã— / 4Ã— / 8Ã—).
    const multSel = el('select', {});
    for (const m2 of [2, 3, 4, 8]) {
      const opt = el('option', { value: String(m2) }, `${m2}Ã—`);
      if (m2 === (us.multiplier || 2)) opt.selected = true;
      multSel.appendChild(opt);
    }
    m.appendChild(el('div', { class: 'row' }, [el('label', {}, 'Multiplier'), multSel]));

    // auto-crop checkbox. Pre-checked from state.upscaleSettings.
    const autoCropCb = el('input', { type: 'checkbox', class: 'auto-crop-cb' });
    autoCropCb.checked = !!us.autoCrop;
    m.appendChild(el('div', { class: 'row' }, [
      el('label', { class: 'auto-crop-label' }, [autoCropCb, ' auto-crop to resolution']),
    ]));

    // Crop W / H inputs. Hidden by default; revealed when auto-crop
    // is checked. Pre-filled from state.upscaleSettings (or 0 = use
    // post-upscale target).
    const cropWInput = el('input', { type: 'number', min: '0', value: String(us.cropWidth || 0) });
    const cropHInput = el('input', { type: 'number', min: '0', value: String(us.cropHeight || 0) });
    const cropSizeRow = el('div', { class: 'row auto-crop-only' }, [
      el('label', {}, 'Crop target W Ã— H (0 = use post-upscale target)'),
      cropWInput, el('span', {}, ' Ã— '), cropHInput,
    ]);
    cropSizeRow.style.display = us.autoCrop ? '' : 'none';
    m.appendChild(cropSizeRow);

    // 3Ã—3 anchor grid. Each cell = an (x, y) anchor in {left,
    // center, right} Ã— {top, center, bottom}. The selected cell
    // comes from state.upscaleSettings.
    const anchor = { x: us.cropAnchorX || 'center', y: us.cropAnchorY || 'center' };
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
    anchorGrid.style.display = us.autoCrop ? '' : 'none';
    m.appendChild(anchorGrid);

    // A short explanation of the cropping section, so the user
    // doesn't have to guess what the 3Ã—3 grid + W Ã— H inputs
    // actually do. Uses inline <code> tags for the glyphs.
    const cropExplanation = el('div', { class: 'crop-explanation' }, [
      'When you click Upscale, the image is first scaled up by ',
      el('strong', {}, `${us.multiplier || 2}Ã—`),
      ' (using the Real-ESRGAN binary if installed, otherwise multi-step canvas upscaling), then ',
      el('strong', {}, 'cropped'),
      ' to the target W Ã— H at the chosen anchor. The 3Ã—3 grid above picks the anchor: ',
      el('code', {}, 'â†–'),
      ' keeps the ',
      el('strong', {}, 'top-left'),
      ' corner, ',
      el('code', {}, 'Â·'),
      ' keeps equal borders on all four sides, ',
      el('code', {}, 'â†˜'),
      ' keeps the ',
      el('strong', {}, 'bottom-right'),
      '.',
    ]);
    cropExplanation.style.display = us.autoCrop ? '' : 'none';
    m.appendChild(cropExplanation);

    // Blank-image crop preview: a fixed 200Ã—150 "source" with a
    // green crop frame overlay that updates whenever the user
    // picks a different anchor (or changes the W Ã— H inputs).
    // The frame is sized proportionally to the post-upscale
    // target W Ã— H so the user can see how much of the image
    // is actually kept.
    const cropPreviewBlock = el('div', { class: 'crop-preview' });
    const stage = el('div', { class: 'crop-preview-stage' });
    const blank = el('div', { class: 'crop-preview-image' });
    const frame = el('div', { class: 'crop-preview-frame' });
    stage.append(blank, frame);
    cropPreviewBlock.appendChild(stage);
    const legend = el('div', { class: 'crop-preview-legend' });
    cropPreviewBlock.appendChild(legend);
    const ANCHOR_LABELS = {
      'left-top':       'top-left',
      'center-top':     'top-center',
      'right-top':      'top-right',
      'left-center':    'middle-left',
      'center-center':  'center',
      'right-center':   'middle-right',
      'left-bottom':    'bottom-left',
      'center-bottom':  'bottom-center',
      'right-bottom':   'bottom-right',
    };
    function refreshCropPreview() {
      const mult = parseInt(multSel.value, 10) || 2;
      const stageW = 200, stageH = 150;
      // The stage represents the post-upscale source. We scale
      // it to fit the stage keeping its real aspect ratio.
      const aspect = srcW / srcH;
      let dispSrcW, dispSrcH;
      if (aspect >= stageW / stageH) {
        dispSrcW = stageW;
        dispSrcH = stageW / aspect;
      } else {
        dispSrcH = stageH;
        dispSrcW = stageH * aspect;
      }
      const srcOffsetX = (stageW - dispSrcW) / 2;
      const srcOffsetY = (stageH - dispSrcH) / 2;
      // Frame size: use the user's W Ã— H if set, otherwise the
      // full post-upscale target.
      const tW = srcW * mult;
      const tH = srcH * mult;
      const wantW = parseInt(cropWInput.value, 10);
      const wantH = parseInt(cropHInput.value, 10);
      let cropW = (Number.isFinite(wantW) && wantW > 0) ? Math.min(wantW, tW) : tW;
      let cropH = (Number.isFinite(wantH) && wantH > 0) ? Math.min(wantH, tH) : tH;
      // Scale the frame to the displayed source size.
      const scale = dispSrcW / tW;
      const frameW = cropW * scale;
      const frameH = cropH * scale;
      const maxX = dispSrcW - frameW;
      const maxY = dispSrcH - frameH;
      let x, y;
      if (anchor.x === 'left')       x = 0;
      else if (anchor.x === 'right') x = maxX;
      else                            x = Math.floor(maxX / 2);
      if (anchor.y === 'top')         y = 0;
      else if (anchor.y === 'bottom') y = maxY;
      else                            y = Math.floor(maxY / 2);
      frame.style.width = frameW + 'px';
      frame.style.height = frameH + 'px';
      frame.style.left = (srcOffsetX + x) + 'px';
      frame.style.top = (srcOffsetY + y) + 'px';
      // Position the blank "image" to match the source size.
      blank.style.left = srcOffsetX + 'px';
      blank.style.top = srcOffsetY + 'px';
      blank.style.width = dispSrcW + 'px';
      blank.style.height = dispSrcH + 'px';
      // Legend.
      legend.innerHTML = '';
      const name = ANCHOR_LABELS[anchor.x + '-' + anchor.y] || 'center';
      legend.appendChild(document.createTextNode('Anchor: '));
      legend.appendChild(el('span', { class: 'crop-preview-anchor-name' }, name));
      legend.appendChild(document.createTextNode(' â€” the green frame shows what will be kept.'));
    }
    cropPreviewBlock.style.display = us.autoCrop ? '' : 'none';
    m.appendChild(cropPreviewBlock);

    // Toggle the auto-crop sub-UI. We do this in a single place so
    // the show / hide stays in sync and the target text always
    // reflects the current state.
    function setAutoCropVisible(on) {
      cropSizeRow.style.display = on ? '' : 'none';
      anchorGrid.style.display = on ? '' : 'none';
      cropExplanation.style.display = on ? '' : 'none';
      cropPreviewBlock.style.display = on ? '' : 'none';
      if (on) {
        // The preview depends on a few derived values; recompute
        // on show so the user sees the current W Ã— H + anchor.
        refreshCropPreview();
      }
      refreshTarget();
    }
    autoCropCb.addEventListener('change', () => setAutoCropVisible(autoCropCb.checked));
    multSel.addEventListener('change', refreshTarget);
    cropWInput.addEventListener('input', refreshTarget);
    cropHInput.addEventListener('input', refreshTarget);
    // The crop preview also re-renders on any input change.
    multSel.addEventListener('change', refreshCropPreview);
    cropWInput.addEventListener('input', refreshCropPreview);
    cropHInput.addEventListener('input', refreshCropPreview);
    // Each anchor cell already updates anchor.x/y; we also
    // re-render the crop preview on click.
    for (const cell of cells) cell.addEventListener('click', refreshCropPreview);
    setAutoCropVisible(!!us.autoCrop); // also primes the W/H inputs + target text
    if (us.autoCrop) refreshCropPreview();

    // ---- "Remove background" sub-section for the right-click dialog ----
    // Pre-checked from state.removeBackgroundEnabled (same default as
    // the in-tab flow). Lives BELOW the upscale + crop UI so it reads
    // as the final pipeline step. A status badge next to the checkbox
    // tells the user whether the binary + model are installed, so they
    // don't click "Upscale" expecting a transparent result and only
    // discover the missing binary halfway through.
    const noBgCb = el('input', { type: 'checkbox' });
    noBgCb.checked = !!state.removeBackgroundEnabled;
    const noBgStatus = el('span', { class: 'meta', style: 'color: var(--fg-2); font-size: 11px; margin-left: 8px;' }, '');
    m.appendChild(el('div', { class: 'row' }, [
      el('label', { class: 'auto-crop-label' }, [noBgCb, ' âœ¨ Remove background after upscale']),
      noBgStatus,
    ]));
    probeIsnetbgStatus().then((st) => {
      if (!st.checked) return;
      if (st.available && st.modelPresent) {
        // Same binary/node disambiguation as the add-ons popup.
        const isNode = st.version === 'node-onnxruntime';
        if (isNode) {
          noBgStatus.textContent = '(IS-Net Node.js wrapper + model detected)';
        } else {
          const v = st.version ? ` v${st.version}` : '';
          noBgStatus.textContent = `(isnetbg binary${v} + model detected)`;
        }
        noBgStatus.style.color = 'var(--fg-2)';
      } else if (st.available && !st.modelPresent) {
        noBgStatus.textContent = '(model missing â€” see README)';
        noBgStatus.style.color = 'var(--warn, #d9a300)';
      } else {
        noBgStatus.textContent = '(not installed)';
        noBgStatus.style.color = 'var(--warn, #d9a300)';
      }
    });

    const upscaleBtn = el('button', { class: 'primary' }, 'Upscale');
    const cancelBtn = el('button', { onclick: close }, 'Cancel');
    upscaleBtn.addEventListener('click', async () => {
      const multiplier = parseInt(multSel.value, 10) || 2;
      // Persist whatever the user just configured so the next
      // right-click / next batch / next âš™ Settings visit sees
      // the same values. We don't scheduleStateSave() here
      // (the action is fire-and-forget and the user can cancel);
      // scheduleStateSave() is called below on success.
      state.upscaleSettings = {
        multiplier,
        autoCrop: !!autoCropCb.checked,
        cropWidth: Math.max(0, parseInt(cropWInput.value, 10) || 0),
        cropHeight: Math.max(0, parseInt(cropHInput.value, 10) || 0),
        cropAnchorX: anchor.x,
        cropAnchorY: anchor.y,
      };
      // Persist the background-removal toggle too. The right-click
      // dialog is the natural place for users to flip this on /
      // off; making it sticky avoids re-checking the same box on
      // the next image.
      state.removeBackgroundEnabled = !!noBgCb.checked;
      state.upscaleEnabled = true;
      upscaleBtn.disabled = true; upscaleBtn.textContent = 'Upscalingâ€¦';
      // `final` is the path to the file we want to preview at the
      // end of the pipeline. It gets reassigned by the optional
      // crop + background-removal steps, and is the only file
      // that should be left on disk for the user to see.
      let final = null;
      try {
        // Step 1: upscale.
        const upscaled = await upscaleImageFile(srcPath, multiplier);
        // Step 2: optionally crop.
        if (autoCropCb.checked) {
          upscaleBtn.textContent = 'Croppingâ€¦';
          const cropW = Math.max(1, parseInt(cropWInput.value, 10) || 1);
          const cropH = Math.max(1, parseInt(cropHInput.value, 10) || 1);
          // Need the actual upscaled dimensions to anchor correctly.
          const upImg = await loadImageFromFile(upscaled);
          const uW = upImg.naturalWidth;
          const uH = upImg.naturalHeight;
          // Clamp the crop to the upscaled size; anchor otherwise.
          const w = Math.min(cropW, uW);
          const h = Math.min(cropH, uH);
          const maxX = uW - w;
          const maxY = uH - h;
          let x, y;
          if (anchor.x === 'left')       x = 0;
          else if (anchor.x === 'right') x = maxX;
          else                            x = Math.floor(maxX / 2);
          if (anchor.y === 'top')         y = 0;
          else if (anchor.y === 'bottom') y = maxY;
          else                            y = Math.floor(maxY / 2);
          const cropped = await cropImageFile(upscaled, x, y, w, h);
          // Drop the intermediate (full-upscaled) file â€” the user
          // asked for the cropped one, not the raw intermediate.
          window.api.fbDelete(upscaled).catch(() => {});
          final = cropped;
        } else {
          final = upscaled;
        }
        // Step 3: optionally remove the background. Non-fatal: a
        // missing / failed binary keeps the upscaled (or cropped)
        // file as the deliverable and surfaces a warning toast,
        // so the user never loses the image they already paid
        // API credits to generate.
        if (noBgCb.checked) {
          upscaleBtn.textContent = 'Removing backgroundâ€¦';
          try {
            const noBg = await removeBackgroundFile(final);
            if (noBg !== final) {
              window.api.fbDelete(final).catch(() => {});
              final = noBg;
            }
            toast(`Upscaled ${multiplier}Ã— + background removed â†’ ${final}`, 'ok', 4500);
          } catch (e) {
            console.error('Remove background failed:', e);
            toast('Background removal failed (kept upscaled image): ' + (e && e.message || e), 'warn', 5000);
          }
        } else {
          toast(`Upscaled to ${multiplier}Ã— â†’ ${final}`, 'ok', 4000);
        }
        await refreshBrowser();
        if (typeof updatePreviewPane === 'function' && final) {
          try { previewImageFromFile(final); } catch (_) {}
        }
        // Persist the new upscale settings now that we know the
        // upscale succeeded. (The setting is also updated in-place
        // by the input listeners, but a state.json round-trip
        // through the debounced scheduleStateSave isn't guaranteed
        // to have fired yet.)
        try { await scheduleStateSave(); } catch (_) {}
        close();
      } catch (e) {
        toast('Upscale' + (autoCropCb.checked ? '+crop' : '') + ' failed: ' + (e && e.message || e), 'err', 6000);
        upscaleBtn.disabled = false;
        upscaleBtn.textContent = 'Upscale';
      }
    });
    m.appendChild(el('div', { class: 'footer' }, [cancelBtn, upscaleBtn]));
  });
}

// Phase 3 Block 9: setupCropFrameDrag() extrahiert nach
// renderer/components/CropFrameDrag.js. Pure Funktion, keine App-State-Coupling.
const { setupCropFrameDrag } = window.CropFrameDrag;


// Phase 3 Block 7: setupLastCmdTooltips() extrahiert nach
// renderer/components/LastCmdTooltip.js. Drop-in-Alias unten.
const { setupLastCmdTooltips } = window.LastCmdTooltip;


