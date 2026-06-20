// renderer/tabs/videoTab.js (Phase 4 Fix 3)
// VIDEO TAB extracted from the original app.js. Each <script> tag
// in index.html has its own scope, so we use window.TABS to make
// sure the assignment reaches the global TABS container that the
// other tab files (imageTabA, speechTab, musicTabA) write into.

window.TABS = window.TABS || {};
// ----------------- VIDEO TAB -----------------
window.TABS.video = {
  prefilled: 'A serene mountain landscape at golden hour, drone shot slowly panning over the valley',
  build() {
    const root = $('#tab-video');
    root.innerHTML = '';

    // Prompt
    const prompt = buildParamRow('Video prompt (prefilled, editable)',
      { kind: 'textarea', value: this.prefilled, help: 'Describe the scene + motion. Up to 2000 chars. Use [Push in], [Pan left], [Static shot] etc. to control camera (15 commands supported).' });
    const styleRow = buildStyleRow('video', 'Select a style preset. Its value is prepended (with a comma) to your video prompt before being sent to mmx.');
    const stylePreview = buildStylePreviewBlock();
    const tabState = { previewEl: stylePreview, selEl: styleRow.sel, manualEl: prompt.input };
    const updatePreview = () => updateStylePreview(tabState);
    styleRow.sel.addEventListener('change', updatePreview);
    prompt.input.addEventListener('input', updatePreview);
    updatePreview();
    const counter = buildPromptCounter({ selEl: styleRow.sel, manualEl: prompt.input, id: 'video' });
    root.appendChild(el('div', { class: 'section' }, [
      el('h3', {}, 'Prompt'),
      styleRow.row,
      prompt.row,
      stylePreview,
      counter.wrap,
    ]));

    // Parameters
    const model = buildParamRow('--model', {
      kind: 'enum', default: 'MiniMax-Hailuo-2.3',
      options: [
        { value: 'MiniMax-Hailuo-2.3', label: 'MiniMax-Hailuo-2.3 (T2V + I2V, default, best quality)' },
        { value: 'MiniMax-Hailuo-2.3-Fast', label: 'MiniMax-Hailuo-2.3-Fast (faster, I2V only — needs --first-frame)' },
        { value: 'MiniMax-Hailuo-02', label: 'MiniMax-Hailuo-02 (SEF: needs --first-frame + --last-frame)' },
        { value: 'S2V-01', label: 'S2V-01 (subject reference — needs --subject-image)' },
      ],
      help: 'Video generation model.\n\nMiniMax-Hailuo-2.3 (default): Newest + best quality.\n  • T2V (text-to-video) and I2V (image-to-video)\n  • Resolutions: 768P (default), 1080P (6s only)\n  • Durations: 6s, 10s\n  • Supports --prompt-optimizer, --fast-pretreatment, 15 camera commands\n\nMiniMax-Hailuo-2.3-Fast: Faster variant, I2V only.\n  REQUIRES --first-frame. Use for quick iterations.\n\nMiniMax-Hailuo-02: Used for first+last frame interpolation (SEF).\n  REQUIRES both --first-frame and --last-frame.\n  Resolutions: 512P, 768P, 1080P.\n\nS2V-01: Subject reference (face consistency across video).\n  REQUIRES --subject-image.',
    });
    const firstFrame = buildParamRow('--first-frame (I2V/SEF)', {
      kind: 'text', default: '',
      placeholder: 'Path or URL to first-frame image',
      fileFilters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
        { name: 'All files', extensions: ['*'] },
      ],
      browseTitle: 'Select first-frame image',
      help: 'Path or URL to a starting image. Triggers I2V (image-to-video).\nFor MiniMax-Hailuo-2.3-Fast this is required.\nSupported formats: JPG, JPEG, PNG, WebP.\nMax 20MB. Aspect 2:5 to 5:2. Short edge > 300px.\nYou can also paste a public URL (https://...).',
    });
    const lastFrame = buildParamRow('--last-frame (SEF only)', {
      kind: 'text', default: '',
      placeholder: 'Path or URL to last-frame image',
      fileFilters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
        { name: 'All files', extensions: ['*'] },
      ],
      browseTitle: 'Select last-frame image',
      help: 'Path or URL to an ending image. Combined with --first-frame,\nswitches to Hailuo-02 in start-end-frame (SEF) interpolation mode.\nSupported formats: JPG, JPEG, PNG, WebP. Max 20MB.',
    });
    const subjectImage = buildParamRow('--subject-image (S2V-01)', {
      kind: 'text', default: '',
      placeholder: 'Path or URL to subject reference photo',
      fileFilters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
        { name: 'All files', extensions: ['*'] },
      ],
      browseTitle: 'Select subject reference photo',
      help: 'Path or URL to a character reference photo. Switches to S2V-01 model\nfor face consistency across the video.\nSupported formats: JPG, JPEG, PNG, WebP.',
    });
    const duration = buildParamRow('--duration (seconds)', {
      kind: 'number', default: 6, min: 6, max: 10, step: 1,
      options: [{ value: 6, label: '6s' }, { value: 10, label: '10s' }],
      help: 'Video length in seconds. 6s is default; 10s only on certain models/resolutions.',
    });
    const resolution = buildParamRow('--resolution', {
      kind: 'enum', default: '768P',
      options: [
        { value: '512P', label: '512P (Hailuo-02 only)' },
        { value: '720P', label: '720P (legacy default)' },
        { value: '768P', label: '768P (recommended, default)' },
        { value: '1080P', label: '1080P (6s only on 2.3 / 2.3-Fast)' },
      ],
      help: 'Output resolution. 1080P only works for 6s videos on Hailuo-2.3 / 2.3-Fast.',
    });
    const promptOpt = buildParamRow('--prompt-optimizer', {
      kind: 'boolean', default: true, help: 'Auto-rewrite your prompt for better results (default true). Set off for precise control.',
    });
    const fastPretreat = buildParamRow('--fast-pretreatment', {
      kind: 'boolean', default: false, help: 'Speeds up the optimizer step. Only for Hailuo-2.3, 2.3-Fast, 02. Default off.',
    });
    const pollInterval = buildParamRow('--poll-interval (seconds)', {
      kind: 'number', default: 5, min: 2, max: 60, step: 1,
      options: [3, 5, 10, 15, 30, 60].map((v) => ({ value: v, label: String(v) })),
      help: 'How often to poll the API while waiting for the video. Default 5s. Lower = faster status updates but more API calls.',
    });

    root.appendChild(el('div', { class: 'section' }, [
      el('h3', {}, 'Parameters'),
      el('div', { class: 'grid' }, [
        model.row, firstFrame.row,
        lastFrame.row, subjectImage.row,
        duration.row, resolution.row,
        promptOpt.row, fastPretreat.row,
        pollInterval.row,
      ]),
    ]));

    // Actions
    const actions = el('div', { class: 'actions' });
    const genBtn = el('button', { class: 'primary' }, 'Generate');
    const lastCmd = el('span', { class: 'lastcmd' }, '');
    const batchControls = el('span', { 'data-batch-controls': 'video', class: 'batch-controls' });
    // Variants dropdown (video tab has no seed, so always enabled)
    const variants = buildVariantsRow({ id: 'variants-video' });
    actions.append(genBtn, variants.row, batchControls, lastCmd);
    const preview = el('div', { class: 'preview' }, el('div', { class: 'empty' }, 'No video generated yet. Note: video generation is async and may take 1-3 minutes.'));
    const tabFooter = el('div', { class: 'tab-footer' }, [actions, preview]);
    root.appendChild(tabFooter);

    genBtn.addEventListener('click', async () => {
      // Bug-fix (2026-06-20): wrap the WHOLE click handler in a
      // try/catch. The previous layout only caught errors inside the
      // variant for-loop, so a ReferenceError thrown during pre-flight
      // (e.g. the missing `emotion` row in the speech tab) would
      // reject the async handler silently and the user saw no
      // progress. With this outer guard any unexpected throw surfaces
      // as a toast (and the button is reset by the re-entrancy guard
      // because we never set state.generating on a pre-flight failure).
      try {
      // Re-entrancy guard: another generation is in progress.
      if (state.generating) return;
      if (!state.config.api_key) { toast('No API key configured. Click ⚙ to open Settings.', 'err'); return; }
      const promptText = buildFinalPrompt(styleRow.sel, prompt.input);
      if (!promptText) { toast('Prompt is required (style or manual input).', 'warn'); return; }
      // Authoritative combination check (warn + proceed). Catches e.g.
      // the Fast model without a first-frame, or a last-frame without a
      // first-frame — both of which the API rejects.
      if (typeof mmxPreflightConfirm === 'function' && !mmxPreflightConfirm('video', {
        model: model.input.getValue(), prompt: promptText,
        'first-frame': firstFrame.input.getValue(),
        'last-frame': lastFrame.input.getValue(),
        'subject-image': subjectImage.input.getValue(),
      })) return;
      const variantsCount = Math.max(1, Math.min(5, parseInt(variants.sel.value, 10) || 1));
      let outDir;
      try { outDir = await ensureSubDir('video'); }
      catch (e) {
        const msg = (e && e.message) || String(e);
        toast('Cannot resolve output folder: ' + msg, 'err', 6000);
        return;
      }
      const slug = slugify(promptText).slice(0, 60) || 'video';
      const cancel = armGenBtnWithCancel(genBtn, 'Generate');
      let allOk = true;
      let lastPreview = null;
      let lastOutFile = null;
      let threw = null;
      try {
        for (let v = 1; v <= variantsCount; v++) {
          if (cancel.wasCancelled()) break;
          const args = ['video', 'generate'];
          args.push('--prompt', promptText);
          appendFlag(args, model.input);
          // Bug-fix (2026-06-20, reported by user): firstFrame / lastFrame
          // / subjectImage are `text` rows with a Browse button, so
          // `firstFrame.input` is a div wrapper, not the inner <input>.
          // Reading `.value` on the div returns `undefined`, so the
          // previous `if (firstFrame.input.value && ...)` always
          // short-circuited to false — meaning --first-frame was
          // NEVER sent even when the user typed a path. This broke
          // Hailuo-2.3-Fast / Hailuo-02 (which REQUIRE a first-frame
          // image) and silently downgraded every other model to T2V
          // mode. Use .getValue() which ParamRow attaches to the
          // wrapper for exactly this case.
          const firstFrameVal = firstFrame.input.getValue().trim();
          if (firstFrameVal) args.push('--first-frame', firstFrameVal);
          const lastFrameVal = lastFrame.input.getValue().trim();
          if (lastFrameVal) args.push('--last-frame', lastFrameVal);
          const subjectImageVal = subjectImage.input.getValue().trim();
          if (subjectImageVal) args.push('--subject-image', subjectImageVal);
          appendFlag(args, duration.input);
          appendFlag(args, resolution.input);
          appendBoolFlag(args, promptOpt.input, '--prompt-optimizer');
          appendBoolFlag(args, fastPretreat.input, '--fast-pretreatment');
          appendFlag(args, pollInterval.input);
          const ts = timestamp();
          const variantTag = variantsCount > 1 ? `_v${v}` : '';
          const outFile = uniquePath(outDir, `${ts}_${slug}${variantTag}.mp4`);
          args.push('--download', outFile);
          lastCmd.textContent = `mmx ${args.join(' ')}`;
          const statusMsg = variantsCount > 1
            ? `Submitting video job… variant ${v}/${variantsCount} (each takes 1-3 min)`
            : 'Submitting video job…';
          setStatus(statusMsg, true);
          let elapsedTimer = null;
          const updateStatus = (msg) => { preview.innerHTML = `<div class="empty"><span class="spinner"></span> ${escapeHtml(msg)}</div>`; };
          updateStatus(variantsCount > 1
            ? `Submitting video job ${v}/${variantsCount}…`
            : 'Submitting video job (may take a few seconds)…');
          const start = Date.now();
          elapsedTimer = setInterval(() => { const s = Math.round((Date.now() - start) / 1000); updateStatus(`Generating video ${v}/${variantsCount}… elapsed ${s}s (typical: 60-180s)`); }, 1000);
          const r = await window.api.mmxRun(args);
          clearInterval(elapsedTimer);
          if (cancel.wasCancelled()) { allOk = false; break; }
          if (!r.ok) {
            const msg = formatMmxError(r);
            preview.innerHTML = `<div class="empty">Generation failed (variant ${v}/${variantsCount}).</div><div class="meta">${escapeHtml(msg)}</div>`;
            toast('Video generation failed: ' + msg, 'err', 6000);
            allOk = false;
            break;
          }
          // v1.1.12 (reported by user): verify the file actually
          // landed on disk. mmx returns success (exit 0) even
          // when something downstream (e.g. the download step)
          // fails silently, leaving the user staring at an
          // empty folder with the tool claiming the video was
          // generated. The fix: after a "successful" mmxRun,
          // probe the output path via fbExists. If the file
          // is missing, surface a clear "file not on disk"
          // error instead of "Video generated." (which was the
          // previous behaviour).
          const fileExists = await window.api.fbExists(outFile);
          if (!fileExists) {
            const msg = `mmx reported success but the expected output file is missing on disk.\n\n` +
              `Expected: ${outFile}\n\n` +
              `This usually means the API call succeeded but the download step failed silently (quota / network / etc.). ` +
              `Try Generate again, or check ⚙ Settings → Output folder.`;
            preview.innerHTML = `<div class="empty">Generation failed (variant ${v}/${variantsCount}).</div><div class="meta">${escapeHtml(msg)}</div>`;
            toast('Video generation failed: output file missing on disk.', 'err', 6000);
            allOk = false;
            break;
          }
          lastPreview = r.parsed;
          lastOutFile = outFile;
        }
      } catch (e) {
        threw = e;
        allOk = false;
        console.error('Video generation threw:', e);
        toast('Generation error: ' + (e && e.message || String(e)), 'err', 6000);
      } finally {
        // Record outcome BEFORE cleanup() clears state.generating so the
        // BatchGen runner (which polls state.generating) always reads the
        // final result, never a stale value left over from a prior item.
        state.genLastResult = state.genLastResult || { image: null, speech: null, music: null, video: null };
        state.genLastResult.video = (allOk && !threw && !cancel.wasCancelled()) ? 'ok' : 'err';
        cancel.cleanup();
        setStatus('Ready', false);
        try { await refreshBrowser(); } catch {}
        try { await refreshQuota(); } catch {}
      }
      if (threw) return;
      if (cancel.wasCancelled()) {
        preview.innerHTML = '<div class="empty">Generation cancelled.</div>';
        toast('Cancelled.', 'warn');
        return;
      }
      if (allOk && lastOutFile) {
        showVideoPreview(preview, lastOutFile, lastPreview);
        bumpGenerationCounter('video', variantsCount);
      }
      if (allOk) {
        toast(variantsCount > 1
          ? `Video generated. ${variantsCount} variants saved.`
          : 'Video generated.', 'ok');
      }
      } catch (e) {
        // Outer guard: any error thrown by pre-flight (state lookups,
        // helpers that weren't loaded yet, etc.) lands here as a
        // visible toast instead of a silent async-reject. The
        // re-entrancy guard above is unaffected because state.generating
        // is only set inside armGenBtnWithCancel (which we may not
        // have reached).
        console.error('Video generation pre-flight failed:', e);
        toast('Generation failed before starting: ' + (e && e.message || String(e)), 'err', 6000);
      }
    });
  },
};

function showVideoPreview(rootEl, file, parsed) {
  const url = fileUrl(file) + '?t=' + Date.now();
  rootEl.innerHTML = '';
  const vid = el('video', { controls: '', src: url, style: 'max-width: 100%; max-height: 60vh; display: block; margin: 0 auto;' });
  vid.preload = 'metadata';
  rootEl.appendChild(vid);
  const meta = el('div', { class: 'meta' });
  meta.appendChild(document.createTextNode(file));
  if (parsed) meta.appendChild(el('div', {}, '[mmx] ' + safeStringify(parsed)));
  rootEl.appendChild(meta);
}


window.VideoTab = window.TABS.video;
