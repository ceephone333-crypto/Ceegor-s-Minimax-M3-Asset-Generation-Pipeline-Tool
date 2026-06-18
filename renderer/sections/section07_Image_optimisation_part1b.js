// renderer/sections/section07_Image_optimisation_part1b.js (Phase 3 Block 31)
// Part 1b.

      qualityInput,
      qualityLabel,
    ]);
    qualityRow.style.display = optimizeCb.checked ? '' : 'none';
    m.appendChild(qualityRow);

    // Format dropdown (Keep / JPEG / PNG / WebP / AVIF). Same
    // shape as the right-click overlay; "Keep" preserves the
    // source format.
    const fmtSel = el('select', {});
    for (const [v, lbl] of [
      ['keep', 'Keep source format'],
      ['jpeg', 'JPEG (smallest lossy, no transparency)'],
      ['png',  'PNG  (lossless, supports transparency)'],
      ['webp', 'WebP (modern, ~30% smaller than JPEG)'],
      ['avif', 'AVIF (newest, smallest files, slow encode)'],
    ]) {
      const opt = el('option', { value: v }, lbl);
      if (oSet.format === v) opt.selected = true;
      fmtSel.appendChild(opt);
    }
    const fmtRow = el('div', { class: 'row auto-crop-only' }, [el('label', {}, 'Output format'), fmtSel]);
    fmtRow.style.display = optimizeCb.checked ? '' : 'none';
    m.appendChild(fmtRow);

    // Strip-metadata checkbox. On by default â€” drops EXIF
    // (camera model, GPS, software tag) but keeps the ICC
    // colour profile.
    const stripCb = el('input', { type: 'checkbox' });
    stripCb.checked = oSet.stripMetadata !== false;
    const stripRow = el('div', { class: 'row auto-crop-only' }, [
      el('label', { class: 'auto-crop-label' }, [stripCb, ' Strip non-essential EXIF (keeps ICC colour profile)']),
    ]);
    stripRow.style.display = optimizeCb.checked ? '' : 'none';
    m.appendChild(stripRow);
    function setOptimizeVisible(on) {
      qualityRow.style.display = on ? '' : 'none';
      fmtRow.style.display = on ? '' : 'none';
      stripRow.style.display = on ? '' : 'none';
    }
    optimizeCb.addEventListener('change', () => setOptimizeVisible(optimizeCb.checked));

    // Save
    const saveBtn = el('button', { class: 'primary' }, 'Save');
    const cancelBtn = el('button', { onclick: close }, 'Cancel');
    saveBtn.addEventListener('click', async () => {
      state.upscaleSettings = {
        multiplier: parseInt(multSel.value, 10) || 2,
        autoCrop: autoCropCb.checked,
        cropWidth: Math.max(0, parseInt(cropWInput.value, 10) || 0),
        cropHeight: Math.max(0, parseInt(cropHInput.value, 10) || 0),
        cropAnchorX: anchor.x,
        cropAnchorY: anchor.y,
      };
      state.removeBackgroundEnabled = !!removeBgCb.checked;
      state.removeBackgroundUseGpu = !!useGpuCb.checked;
      state.optimizeSettings = {
        enabled: !!optimizeCb.checked,
        quality: Math.max(1, Math.min(100, parseInt(qualityInput.value, 10) || 82)),
        format: ['keep', 'jpeg', 'png', 'webp', 'avif'].includes(fmtSel.value) ? fmtSel.value : 'keep',
        stripMetadata: !!stripCb.checked,
      };
      state.upscaleEnabled = true;
      await scheduleStateSave();
      if (typeof refreshUpscaleCheckboxUI === 'function') refreshUpscaleCheckboxUI();
      const extras = [];
      if (state.upscaleSettings.autoCrop) extras.push('auto-crop');
      if (state.removeBackgroundEnabled) extras.push('remove-background');
      if (state.optimizeSettings.enabled) {
        extras.push('optimize Q' + state.optimizeSettings.quality);
      }
      const extra = extras.length ? ' + ' + extras.join(' + ') : '';
      // The "ðŸ” Upscale 2Ã—" label in the image tab was updated by
      // a closure inside build(); that closure is long gone by
      // the time the user opens this modal. refreshUpscaleLabel
      // is the module-level re-render that picks up the new
      // multiplier + .active class via DOM query.
      if (typeof refreshUpscaleLabel === 'function') refreshUpscaleLabel();
      toast(`Upscale settings saved (${state.upscaleSettings.multiplier}Ã—${extra}).`, 'ok', 2000);
      close();
    });
    m.appendChild(el('div', { class: 'footer' }, [cancelBtn, saveBtn]));
  });
}

// Direct upscale overlay used by the right-click menu on an image
// in the file browser. Shows the source resolution + the target
// resolution after upscaling, an "auto-crop to resolution" toggle,
// and (when that toggle is on) a 3Ã—3 anchor grid + W/H inputs so
// the user can upscale AND crop in one step. The flow:
//   1. upscaleImageFile() writes `<name>_Nx.png` to output_dir.
//   2. If auto-crop is on, cropImageFile() reads it back, places
//      the crop frame at the chosen anchor (top-left, center,
//      bottom-right, etc.), writes `<name>_Nx_cropped_WxH.png`,
//      and the intermediate `_Nx` file is deleted.
//   3. The cropped file is shown in the preview pane.

