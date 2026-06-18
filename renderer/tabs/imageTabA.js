// renderer/tabs/imageTabA.js (Phase 3 Block 33)
// First half of imageTab.js (form build).

// renderer/tabs/imageTab.js (Phase 3 Block 23)
// ----------------- IMAGE TAB -----------------
window.TABS = window.TABS || {};
window.TABS.image = {
  prefilled: 'a cyberpunk city night scene in 16:9',
  build() {
    const root = $('#tab-image');
    root.innerHTML = '';

    // Prompt
    const prompt = buildParamRow('Prompt (prefilled, editable)',
      { kind: 'textarea', value: this.prefilled, help: 'The description of the image to generate. Sent as --prompt. Max 1500 characters.' });
    const styleRow = buildStyleRow('image', 'Select a style preset. Its value is prepended (with a comma) to your manual prompt before the request is sent.');
    const stylePreview = buildStylePreviewBlock();
    const tabState = { previewEl: stylePreview._previewEl, selEl: styleRow.sel, manualEl: prompt.input };
    const updatePreview = () => updateStylePreview(tabState);
    styleRow.sel.addEventListener('change', updatePreview);
    prompt.input.addEventListener('input', updatePreview);
    updatePreview();
    // mmx image API hard limit is 1500 chars on --prompt; counter goes red above.
    const counter = buildPromptCounter({ selEl: styleRow.sel, manualEl: prompt.input, max: 1500, id: 'image' });
    root.appendChild(el('div', { class: 'section' }, [
      el('h3', {}, 'Prompt'),
      styleRow.row,
      prompt.row,
      stylePreview,
      counter.wrap,
    ]));

    // Parameters
    const model = buildParamRow('--model', {
      kind: 'enum', default: 'image-01',
      options: [
        { value: 'image-01', label: 'image-01 (default â€” general purpose)' },
        { value: 'image-01-live', label: 'image-01-live (hand-drawn, cartoon, style control)' },
      ],
      help: 'Image generation model.\n\nimage-01 (default):\n  â€¢ General-purpose text-to-image\n  â€¢ Aspect ratios: 1:1, 16:9, 9:16, 4:3, 3:4, 2:3, 3:2, 21:9\n  â€¢ Custom width/height: 512-2048 px (multiple of 8)\n  â€¢ --subject-ref, --prompt-optimizer, --aigc-watermark, --seed\n\nimage-01-live:\n  â€¢ Hand-drawn / cartoon / stylized outputs\n  â€¢ Finer style control\n  â€¢ Same flags as image-01',
    });
    const aspect = buildParamRow('--aspect-ratio', {
      kind: 'enum', default: '',
      options: [
        { value: '', label: '(default — let the model pick)' },
        { value: '1:1', label: '1:1 â€” square' },
        { value: '16:9', label: '16:9 â€” widescreen' },
        { value: '9:16', label: '9:16 â€” portrait / phone' },
        { value: '4:3', label: '4:3 â€” classic' },
        { value: '3:4', label: '3:4 â€” portrait classic' },
        { value: '2:3', label: '2:3 â€” photo portrait' },
        { value: '3:2', label: '3:2 â€” photo landscape' },
        { value: '21:9', label: '21:9 â€” ultrawide / cinematic' },
      ],
      help: 'Output aspect ratio. The default (empty) lets the model pick its own ratio (image-01 falls back to 1:1). Ignored if you set both --width and --height. The 21:9 ultrawide option is image-01 only.',
    });
    const n = buildParamRow('--n (count)', {
      kind: 'number', default: 1, min: 1, max: 4, customDefault: 1, step: 1,
      options: [1, 2, 3, 4].map((v) => ({ value: v, label: String(v) })),
      help: 'How many images to generate in one call.',
    });
    const width = buildParamRow('--width (px)', {
      kind: 'number', default: '', min: 512, max: 2048, step: 8,
      options: [
        { value: '', label: '(unset)' },
        { value: 768, label: '768' },
        { value: 1024, label: '1024' },
        { value: 1280, label: '1280' },
        { value: 1536, label: '1536' },
        { value: 1792, label: '1792' },
        { value: 1920, label: '1920' },
        { value: 2048, label: '2048' },
      ],
      help: 'Pixel width (512â€“2048, multiple of 8). Overrides --aspect-ratio when paired with --height. image-01 only.',
    });
    const height = buildParamRow('--height (px)', {
      kind: 'number', default: '', min: 512, max: 2048, step: 8,
      options: [
        { value: '', label: '(unset)' },
        { value: 768, label: '768' },
        { value: 1024, label: '1024' },
        { value: 1280, label: '1280' },
        { value: 1536, label: '1536' },
        { value: 1792, label: '1792' },
        { value: 1080, label: '1080' },
        { value: 2048, label: '2048' },
      ],
      help: 'Pixel height (512â€“2048, multiple of 8). Overrides --aspect-ratio when paired with --width. image-01 only.',
    });
    const seed = buildParamRow('--seed', {
      kind: 'number', default: '', min: 0, max: 2_147_483_647, step: 1,
      options: [
        { value: '', label: 'Random' },
        { value: 0, label: '0' },
        { value: 1, label: '1' },
        { value: 42, label: '42' },
        { value: 12345, label: '12345' },
        { value: 1337, label: '1337' },
        { value: 9999, label: '9999' },
      ],
      help: 'Random seed for reproducible generation. Same seed + prompt = identical output.',
    });
    const promptOpt = buildParamRow('--prompt-optimizer', {
      kind: 'boolean', default: false, help: 'Let the model rewrite your prompt for better results.',
    });
    const watermark = buildParamRow('--aigc-watermark', {
      kind: 'boolean', default: false, help: 'Embed an AI-generated content watermark into the output image.',
    });
    const subjRef = buildParamRow('--subject-ref', {
      kind: 'text', default: '',
      placeholder: 'Path or URL to character image',
      fileFilters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
        { name: 'All files', extensions: ['*'] },
      ],
      browseTitle: 'Select character reference image',
      help: 'Character consistency reference.\nFormat: type=character,image=<value>\nYou can also paste a public URL (https://...).\nSupported formats: PNG, JPG, JPEG, WebP.',
    });
    const respFmt = buildParamRow('--response-format', {
      kind: 'enum', default: 'url',
      options: [
        { value: 'url', label: 'url (CDN, downloaded to disk)' },
        { value: 'base64', label: 'base64 (no CDN)' },
      ],
      help: 'How the image bytes come back. base64 bypasses the CDN.',
    });

    root.appendChild(el('div', { class: 'section' }, [
      el('h3', {}, 'Parameters'),
      buildFilePrefixRow(),
      el('div', { class: 'grid' }, [aspect.row, n.row, width.row, height.row, seed.row, respFmt.row, promptOpt.row, watermark.row, subjRef.row]),
      // Live validity warnings for the W Ã— H combo and the subject
      // ref field. attachImageDimGuards wires the aspect/W/H
      // listeners (auto-fill on aspect change, ratio-mismatch
      // warning, div-by-8 warning) and returns the warning div
      // for the .section. attachSubjectRefGuard does the same for
      // the --subject-ref field (must be a path or http(s) URL
      // with a recognised image extension). Both are hidden when
      // the inputs are valid.
      attachImageDimGuards(aspect, width, height),
      attachSubjectRefGuard(subjRef),
    ]));

    // Action bar + preview
    const actions = el('div', { class: 'actions' });
    const genBtn = el('button', { class: 'primary' }, 'Generate');
    // Upscale checkbox: when on, every generated image is upscaled locally
    // after generation using the saved settings. Clicking the label
    // (or the box) opens the settings overlay.
    const upscaleCb = el('input', { type: 'checkbox', title: 'Upscale the generated image after creation' });
    const upscaleLabel = el('label', { class: 'upscale-checkbox', title: 'Click to configure upscale settings' });
    const upscaleMult = el('span', { class: 'upscale-mult' }, '');
    upscaleLabel.append(upscaleCb, 'ðŸ” Upscale', upscaleMult);
    // Reflect persisted state
    if (state.upscaleEnabled) upscaleCb.checked = true;
    function refreshUpscaleCheckboxUI() {
      const m = (state.upscaleSettings && state.upscaleSettings.multiplier) || 2;
      upscaleMult.textContent = state.upscaleEnabled ? ` (${m}Ã—)` : '';
      upscaleLabel.classList.toggle('active', !!state.upscaleEnabled);
    }
    refreshUpscaleCheckboxUI();
    upscaleLabel.addEventListener('click', (e) => {
      // Only open the settings overlay when the user clicks the label
      // text (not the input itself â€” clicking the input toggles it).
      if (e.target === upscaleCb) return; // let the input toggle
      e.preventDefault();
      showUpscaleSettings();
    });
    upscaleCb.addEventListener('change', async () => {
      state.upscaleEnabled = !!upscaleCb.checked;
      if (state.upscaleEnabled && !state.upscaleSettings) {
        state.upscaleSettings = { multiplier: 2 };
      }
      refreshUpscaleCheckboxUI();
      await scheduleStateSave();
    });
    const lastCmd = el('span', { class: 'lastcmd' }, '');
    const batchControls = el('span', { 'data-batch-controls': 'image', class: 'batch-controls' });
    // Variants dropdown (image tab: disabled when seed is set)
    const variants = buildVariantsRow({ id: 'variants-image', seedInput: seed });
    actions.append(buildAddToBatchBtn('image'), genBtn, upscaleLabel, variants.row, batchControls, lastCmd);
    const preview = el('div', { class: 'preview' }, el('div', { class: 'empty' }, 'No image generated yet.'));

    // Sticky footer: actions + preview stay visible while the rest of the
    // tab scrolls. CSS uses position: sticky on .tab-footer.
    // Tab footer: the preview area goes ABOVE the actions row so
    // the Generate / +Add / batch controls sit at the very bottom
    // of the tab. The user asked to move them down so there is
    // no visible "scrolling content behind a small area below
    // them" — the fix is to keep the actions row as the LAST
    // element in the sticky footer. The preview is still sticky-
    // attached to the actions row via the tab-footer flex column.
    const tabFooter = el('div', { class: 'tab-footer' }, [preview, actions]);
    root.appendChild(tabFooter);

    // ---- Generate handler ----
    genBtn.addEventListener('click', async () => {
      // Re-entrancy guard: another generation is in progress. The cancel
      // click handler (added by armGenBtnWithCancel) will run for clicks
      // that should cancel instead.
      if (state.generating) return;
      if (!state.config.api_key) { toast('No API key configured. Click ⚙ to open Settings.', 'err'); return; }
      const promptText = buildFinalPrompt(styleRow.sel, prompt.input);
      if (!promptText) { toast('Prompt is required (style or manual input).', 'warn'); return; }
      // Pre-flight: validate every visible parameter against the
      // MODEL_SPECS registry. We do this BEFORE building argv so
      // the user sees a precise "X exceeds max Y" toast instead of
      // a cryptic 400 from the API. The registry also tells us
      // which rows are supported on the selected model — a flag
      // that's been left over from a different model would otherwise
      // be sent verbatim and rejected by the backend.
      const imageParams = {
        '--prompt': prompt.input,
        '--model': model.input,
        '--aspect-ratio': aspect.input,
        '--n': n.input,
        '--width': width.input,
        '--height': height.input,
        '--seed': seed.input,
        '--prompt-optimizer': promptOpt.input,
        '--aigc-watermark': watermark.input,
        '--subject-reference-file': subjRef.input,
      };
      const preErrs = validateTabAgainstSpec('image', imageParams, model.input.getValue(), null, isFlagVisibleForCurrentModel);
      if (preErrs.length) {
        for (const e of preErrs) toast(e, 'err', 6000);
        return;
      }
      const variantsCount = Math.max(1, Math.min(5, parseInt(variants.sel.value, 10) || 1));
      const seedVal = seed.input.getValue();
      const seedLocked = String(seedVal) !== '' && variantsCount > 1;
      if (seedLocked) {
        // Defensive: shouldn't happen since the dropdown is disabled, but just in case
        toast('Variants are disabled while a fixed seed is set (would produce identical images).', 'warn');
        return;
      }
      let outDir;
      try { outDir = await ensureSubDir('image'); }
      catch (e) { toast('No output directory set. Open Settings.', 'err'); return; }
      const slug = slugify(promptText).slice(0, 60) || 'image';
      const cancel = armGenBtnWithCancel(genBtn, 'Generate');
      // Log a "generation started" event up front so the user
      // sees one row per click in the new structured log pane,
      // and so the "completed" / "failed" events below can be
      // read as part of the same group. We use the prompt text
      // (truncated) as the headline; the full prompt stays
      // available in the expand-on-click details.
      const promptShort = (promptText || '').replace(/\s+/g, ' ').slice(0, 120);
      const genStartEvId = addLogEvent({
        category: 'gen',
        headline: `Image generation started: ${promptShort}${promptText && promptText.length > 120 ? 'â€¦' : ''}`,
        details: [
          `Variants: ${variantsCount}`,
          `Seed: ${seedVal === '' ? '(random)' : String(seedVal)}`,
          `Aspect: ${aspect.input.getValue() || '(default)'}`,
          `Model: ${model.input.getValue() || '(default)'}`,
          `Reference: ${subjRef.input.value && subjRef.input.value.trim() ? subjRef.input.value.trim() : '(none)'}`,
        ],
      });
      let allOk = true;
      let lastPreview = null;
      let lastOutFile = null;
      // outFiles tracks every image file we know about after generation
      // completes. For variants without --out-dir, each variant produces
      // one known file we push here. For --out-dir, the per-call output
      // files are unknown at gen time, so we scan the directory at the
      // end of the loop (see resolveOutDirFiles). After the upscale +
      // crop step, the original file is replaced by the upscaled (and
      // optionally cropped) one â€” we update the list in place.
      const outFiles = [];
      // lastFailedR captures the most recent failed mmxRun result so the
      // error UI (preview + toast) can surface its full details, including
      // the classified type and a copy-paste blob for support.
      let lastFailedR = null;
      let threw = null;
      // The mmx CLI rejects `--out` when `--n > 1` ("--out cannot be used with
      // --n > 1. Use --out-dir instead."). When the user requested multiple
      // images via the --n (count) dropdown, we omit --out and let mmx write
      // numbered files into outDir.
      const nRaw = n.input.getValue();
      const nCount = nRaw === '' || nRaw == null ? 1 : Math.max(1, parseInt(String(nRaw), 10) || 1);
      const useOutDir = nCount > 1;
      // Total images this run will produce. The per-tab ETA timer reads
      // this from state.genQueueSize[tabKey] to compute a "remaining
      // time for the whole batch" estimate that ticks down as each
      // variant completes.
      const totalImages = variantsCount * nCount;
      if (!state.genQueueSize) state.genQueueSize = { image: 0, speech: 0, music: 0, video: 0 };
      if (!state.genQueueDone) state.genQueueDone = { image: 0, speech: 0, music: 0, video: 0 };
      state.genQueueSize.image = totalImages;
      state.genQueueDone.image = 0;
      // Validate width/height pairing once (would otherwise warn on every variant).
      const wv0 = width.input.getValue();
      const hv0 = height.input.getValue();
      if ((wv0 && !hv0) || (!wv0 && hv0)) {
        toast('Width and height must both be set (or both unset). Width/height ignored.', 'warn');
      }
      // Build the argv once and reuse it across variant attempts â€” the prompt
      // and parameters don't change between retries.
      function buildImageArgs() {
        const args = ['image', 'generate'];
        args.push('--prompt', promptText);
        appendFlag(args, model.input);
        appendFlag(args, aspect.input);
        appendFlag(args, n.input);
        if (wv0 && hv0) { args.push('--width', String(wv0)); args.push('--height', String(hv0)); }
        if (String(seedVal) !== '') args.push('--seed', String(seedVal));
        appendBoolFlag(args, promptOpt.input, '--prompt-optimizer');
        appendBoolFlag(args, watermark.input, '--aigc-watermark');
        if (subjRef.input.value && subjRef.input.value.trim()) {
          args.push('--subject-ref', `type=character,image=${subjRef.input.value.trim()}`);
        }
        appendFlag(args, respFmt.input);
        if (useOutDir) {
          args.push('--out-dir', outDir);
        }
        return args;
      }
      // Returns the resolved outFile for this variant (or outDir when --out-dir).
      function makeOutPath(v) {
        if (useOutDir) return outDir;
        const ts = timestamp();
        const variantTag = variantsCount > 1 ? `_v${v}` : '';
        const prefix = (state.filePrefix || '').trim();
        return uniquePath(outDir, `${prefix}${ts}_${slug}${variantTag}.png`);
      }
      try {
        for (let v = 1; v <= variantsCount; v++) {
          if (cancel.wasCancelled()) break;
          // Small breather between variants to avoid hitting the mmx rate
          // limiter (especially right after a failed call).
          if (v > 1) await new Promise((r) => setTimeout(r, 800));
          if (cancel.wasCancelled()) break;

          // Build the per-variant argv. The base args are identical except
          // for --out, which gets a unique filename per variant.
          const baseArgs = buildImageArgs();
          const outFile = makeOutPath(v);
          const args = baseArgs.slice();
          if (!useOutDir) args.push('--out', outFile);
          lastCmd.textContent = maskLine(`mmx ${args.join(' ')}`, state.config && state.config.api_key);

          // Per-variant start time. We use this (not the whole-run start
          // time) to update the per-item average as each item finishes,
          // so the ETA ticks down more accurately as the run progresses.
          const itemStart = Date.now();
          const statusMsg = variantsCount > 1
            ? `Generating imageâ€¦ variant ${v}/${variantsCount}`
            : (useOutDir ? `Generating imageâ€¦ (${nCount} images to ${outDir})` : 'Generating imageâ€¦');
          setStatus(statusMsg, true);
          preview.innerHTML = `<div class="empty"><span class="spinner"></span> ${escapeHtml(statusMsg)}</div>`;

          // Try the call, then retry up to 3 times with exponential backoff
          // on transient errors. The "API error: system error (HTTP 200)"
          // pattern we see in the field is almost always a backend hiccup
          // that succeeds on retry. We also detect rate-limit messages and
          // wait longer for those.
          let r = await window.api.mmxRun(args);
          if (!r.ok && !cancel.wasCancelled()) {
            const firstMsg = formatMmxError(r);
            const isRateLimit = /rate|limit|throttl|too many|429/i.test(firstMsg);
            const maxRetries = 3;
            for (let attempt = 1; attempt <= maxRetries && !cancel.wasCancelled(); attempt++) {
              // Exponential backoff: 1.5s, 3s, 6s (Ã—2 if rate-limited)
              const baseDelay = 1500 * Math.pow(2, attempt - 1);
              const delay = isRateLimit ? baseDelay * 2 : baseDelay;
              await new Promise((res) => setTimeout(res, delay));
              if (cancel.wasCancelled()) break;
              setStatus(`Retrying image variant ${v}/${variantsCount} (attempt ${attempt + 1}/${maxRetries + 1})â€¦`, true);
              preview.innerHTML = `<div class="empty"><span class="spinner"></span> ${escapeHtml(`Retrying variant ${v}/${variantsCount} (attempt ${attempt + 1})â€¦`)}</div>`;
              r = await window.api.mmxRun(args);
              if (r.ok) {
                toast(`Image variant ${v}/${variantsCount} succeeded on retry ${attempt}.`, 'ok', 2500);
                break;
              }
            }
            if (!r.ok) toast(`Image variant ${v}/${variantsCount} failed after ${maxRetries + 1} attempts: ${firstMsg}`, 'err', 6000);
          }
          if (cancel.wasCancelled()) { allOk = false; break; }
          if (!r.ok) {
            // Mark this variant as failed but continue with the next one so
            // the user gets the remaining variants (e.g. 1, 2 OK, 3 failed,
            // 4, 5 still attempted). We also expose a "Retry" button so the
            // user can manually re-attempt this exact variant.
            allOk = false;
            lastFailedR = r;
            preview.innerHTML = `<div class="empty">Generation failed (variant ${v}/${variantsCount}). Continuing with next variantâ€¦</div><div class="meta">${escapeHtml(formatMmxError(r))}</div>`;
            // Advance the queue counter even on failure so the ETA
            // doesn't keep counting this variant as "still in flight"
            // for the rest of the run. Failed variants still consume
            // wall-clock time, so we add their elapsed time to the
            // per-item average (so the ETA reflects the real pace of
            // the call, not just the successful ones â€” otherwise a
            // string of slow failures would under-estimate the time
            // for the remaining variants).
            const failDur = (Date.now() - itemStart) / 1000;
            if (!state.genAvgSec) state.genAvgSec = {};
            const prevAvgFail = state.genAvgSec.image || 0;
            state.genAvgSec.image = prevAvgFail === 0 ? failDur : (prevAvgFail * 0.6 + failDur * 0.4);
            state.genQueueDone.image = (state.genQueueDone.image || 0) + nCount;
            refreshTabEtas();
            continue;
          }
          // Update the per-item average so the ETA improves with each
          // completion. The previous version only updated the avg in
          // armGenBtnWithCancel's cleanup (i.e. once at the end of the
          // whole run), so for a 5-variant batch the ETA stayed pinned
          // to the default for the first 4 items.
          const itemDur = (Date.now() - itemStart) / 1000;
          if (!state.genAvgSec) state.genAvgSec = {};
          const prevAvg = state.genAvgSec.image || 0;
          state.genAvgSec.image = prevAvg === 0 ? itemDur : (prevAvg * 0.6 + itemDur * 0.4);
          // Each mmx call with --n > 1 produces nCount images, so
          // queueDone advances by nCount for those calls. For single
          // images (useOutDir=false) it's 1.
          state.genQueueDone.image = (state.genQueueDone.image || 0) + nCount;
          refreshTabEtas();
          lastPreview = r.parsed;
          lastOutFile = outFile;
          if (!useOutDir) outFiles.push(outFile);
          // Live-update the folder explorer + preview pane. The
          // gen handler knows the output path for non-(--out-dir)
          // runs, so we don't have to wait for the 1s polling
          // to discover the file â€” the UI reacts on the same
          // tick the file is written. The polling is still
          // running in the background as a safety net for the
          // --out-dir case (and for the post-processed upscaled
          // / cropped / no-bg / optimised files the gen handler
          // creates after the raw mmx call returns). Idempotent
          // â€” calling it with the same path twice is a no-op.
          if (!useOutDir) {
            try { notifyImageGenerated(outFile); } catch (_) {}
            // Add the blink class to the row for the CSS animation.
            // We use a microtask so the row exists in the DOM
            // (the folder explorer was re-rendered by
            // startGenPolling's tick on the previous second, or
            // by the user's last refresh). If the row isn't there
            // yet, the next polling tick will add the class.
            queueMicrotask(() => {
              const row = document.querySelector(`.fb-item[data-path="${CSS.escape(outFile)}"]`);
              if (row) row.classList.add('fb-item-new');
            });
          }
        }
        // Post-processing INSIDE the try block â€” the previous layout ran
        // the upscale + crop + background-removal AFTER the finally, which
        // meant cancel.cleanup() had already restored the Generate button
        // to its idle state and cleared state.generating. The post-
        // processing then ran for several seconds under a "Generate"
        // button that the user could click again, racing the still-
        // running upscale and â€” when they did â€” the new click would
        // arm another cancel handler while the old run's pending
        // promises leaked. Now the button stays as "Cancel" and the
