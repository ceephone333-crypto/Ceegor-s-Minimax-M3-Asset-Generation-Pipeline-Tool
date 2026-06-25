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
      { kind: 'textarea', value: this.prefilled, help: 'The description of the image you want. This text is sent to the API as the --prompt flag.\n\nTips for best results:\n  • Be specific — include subject, setting, lighting, mood, camera angle, artistic style.\n  • Avoid negative instructions ("no cats"); use the model\'s --negative-prompt if available, or rephrase positively ("dogs playing in a sunny park").\n  • For style consistency across a series, set a Style preset (the dropdown above) — it prepends a fixed prefix to every prompt.\n  • Max 1500 characters. The counter below the textarea shows the remaining quota.' });
    const styleRow = buildStyleRow('image', 'Select a style preset. Its value is prepended (with a comma) to your manual prompt before the request is sent.');
    // v1.1.15 (reported by user): the previous version also
    // rendered a `buildStylePreviewBlock()` element under
    // the prompt, which showed the final composed prompt
    // (style + manual + extra prefix). The user found it
    // empty-looking and wanted it removed. We keep the
    // helper exported so other callers don't break, but
    // the tab no longer mounts it.
    const tabState = { selEl: styleRow.sel, manualEl: prompt.input };
    const counter = buildPromptCounter({ selEl: styleRow.sel, manualEl: prompt.input, max: 2000, id: 'image' });
    root.appendChild(el('div', { class: 'section' }, [
      el('h3', {}, 'Prompt'),
      styleRow.row,
      prompt.row,
      counter.wrap,
    ]));

    // Parameters
    const model = buildParamRow('--model', {
      kind: 'enum', default: 'image-01',
      options: [
        { value: 'image-01', label: 'image-01 (default — general purpose)' },
        { value: 'image-01-live', label: 'image-01-live (hand-drawn, cartoon, style control)' },
      ],
      help: 'Image generation model.\n\nimage-01 (default):\n  • General-purpose text-to-image\n  • Aspect ratios: 1:1, 16:9, 9:16, 4:3, 3:4, 2:3, 3:2, 21:9\n  • Custom width/height: 512-2048 px (multiple of 8)\n  • --subject-ref, --prompt-optimizer, --aigc-watermark, --seed\n\nimage-01-live:\n  • Hand-drawn / cartoon / stylized outputs\n  • Finer style control\n  • Same flags as image-01',
    });
    const aspect = buildParamRow('--aspect-ratio', {
      kind: 'enum', default: '',
      options: [
        { value: '', label: '(default — let the model pick)' },
        { value: '1:1', label: '1:1 — square' },
        { value: '16:9', label: '16:9 — widescreen' },
        { value: '9:16', label: '9:16 — portrait / phone' },
        { value: '4:3', label: '4:3 — classic' },
        { value: '3:4', label: '3:4 — portrait classic' },
        { value: '2:3', label: '2:3 — photo portrait' },
        { value: '3:2', label: '3:2 — photo landscape' },
        { value: '21:9', label: '21:9 — ultrawide / cinematic' },
      ],
      help: 'Output aspect ratio. The default (empty) lets the model pick its own ratio (image-01 falls back to 1:1). Ignored if you set both --width and --height. The 21:9 ultrawide option is image-01 only.',
    });
    const n = buildParamRow('--n (count)', {
      kind: 'number', default: 1, min: 1, max: 4, customDefault: 1, step: 1,
      options: [1, 2, 3, 4].map((v) => ({ value: v, label: String(v) })),
      help: 'How many images to generate in ONE mmx call. Each unit counts as one generation against your quota.\n\nFor --n > 1, the tool uses --out-dir instead of --out (the mmx CLI rejects the per-file --out when --n > 1). You can also use the "Variants" dropdown (further down) for an alternative multi-generation workflow that re-spawns mmx N times with the same prompt — useful when you want each variant in its own file with its own seed.',
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
      help: 'Pixel width (512–2048, multiple of 8). Overrides --aspect-ratio when paired with --height. image-01 only.',
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
      help: 'Pixel height (512–2048, multiple of 8). Overrides --aspect-ratio when paired with --width. image-01 only.',
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
      help: 'Random seed for reproducible generation. Same prompt + same seed always produces (approximately) the same image. Useful when you want to iterate on a prompt — change one word, keep the seed, and the result changes in a predictable way.\n\nBest practices:\n  • Pick a memorable seed (e.g. 42, 1337, your birthday) so you can recreate the look later.\n  • When "Variants" is set > 1 the seed field is locked (variants + seed would defeat the purpose — you\'d get N copies of the same image).\n  • Different models / aspect ratios / resolutions produce DIFFERENT images from the same (prompt, seed) pair. The seed pins the random pattern, not the image itself.',
    });
    const promptOpt = buildParamRow('--prompt-optimizer', {
      kind: 'boolean', default: false,
      help: 'Let the model rewrite your prompt before sending it to the API.\n\nON (recommended for short or vague prompts): the model expands your prompt with extra descriptive detail (lighting, composition, style) — usually produces a noticeably better image, costs one extra API step.\n\nOFF (use for precise control): the tool sends your exact prompt text. Recommended when you have a carefully crafted prompt and don\'t want the model to second-guess you, or when you\'re testing exact prompt wording.',
    });
    const watermark = buildParamRow('--aigc-watermark', {
      kind: 'boolean', default: false,
      help: 'Embed an invisible AI-generated content watermark in the output image.\n\nThe watermark is metadata-only — invisible to the human eye, no visual quality change, no extra file size. Used by content moderation systems to identify AI-generated images.\n\nRecommended ON for public-facing content (the watermark helps with platform compliance in the EU, China, and other jurisdictions that require AI disclosure). OFF for private / personal use where the metadata isn\'t needed.',
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
      help: 'How the image bytes come back from the API.\n\nurl (default): the API uploads the image to a CDN and returns a URL. The tool then downloads it to your output folder. Faster (the model finishes sooner), works behind corporate firewalls that block arbitrary CDN domains.\n\nbase64: the API embeds the image bytes directly in the JSON response (no CDN round-trip). Slower end-to-end (the response is bigger), but no external CDN dependency. Useful when debugging CDN-blocked networks, or for offline workflows.',
    });

    root.appendChild(el('div', { class: 'section' }, [
      el('h3', {}, 'Parameters'),
      buildFilePrefixRow(),
      el('div', { class: 'grid' }, [aspect.row, width.row, height.row, n.row, seed.row, respFmt.row, promptOpt.row, watermark.row, subjRef.row]),
      // Live validity warnings for the W × H combo and the subject
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
    upscaleLabel.append(upscaleCb, '🔍 Upscale', upscaleMult);
    // Reflect persisted state
    if (state.upscaleEnabled) upscaleCb.checked = true;
    function refreshUpscaleCheckboxUI() {
      const m = (state.upscaleSettings && state.upscaleSettings.multiplier) || 2;
      upscaleMult.textContent = state.upscaleEnabled ? ` (${m}×)` : '';
      upscaleLabel.classList.toggle('active', !!state.upscaleEnabled);
    }
    refreshUpscaleCheckboxUI();
    upscaleLabel.addEventListener('click', (e) => {
      // Only open the settings overlay when the user clicks the label
      // text (not the input itself — clicking the input toggles it).
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
      // v1.1.26: log the click as soon as we know the user pressed
      // Generate, BEFORE the guards (re-entrancy / api_key). A
      // guarded-out click is still a real user intent and should
      // appear in the breadcrumb so "I clicked Generate and nothing
      // happened" leaves a trail.
      if (typeof window.logAction === 'function') {
        window.logAction('generate', 'click-generate', {
          tab: 'image',
          has_api_key: !!state.config.api_key,
          upscale_enabled: !!state.upscaleEnabled,
        });
      }
      // Re-entrancy guard: another generation is in progress. The cancel
      // click handler (added by armGenBtnWithCancel) will run for clicks
      // that should cancel instead. Phase A: per-tab gate so a job on
      // the music / speech / video tab does NOT block the image tab.
      // Bug-fix (C3): window.JobRunner always exists but never has jobs in
      // production (only unit tests populate it), so the old two-line guard
      // (`JobRunner && isTabRunning` / `!JobRunner && state.generating`) was
      // always false on both lines — no re-entrancy protection at all. This
      // single condition restores the legacy guard. state.generating holds
      // the busy tab's key (set/cleared by armGenBtnWithCancel in app.js),
      // so comparing to 'image' (not just truthiness) keeps the Phase A
      // per-tab gate intact — a job on music/speech/video must NOT block image.
      if ((window.JobRunner && window.JobRunner.isTabRunning('image')) || state.generating === 'image') {
        if (typeof window.logAction === 'function') {
          window.logAction('generate', 'guard-blocked', { reason: 'already-running', tab: 'image' });
        }
        return;
      }
      if (!state.config.api_key) {
        if (typeof window.logAction === 'function') {
          window.logAction('generate', 'guard-blocked', { reason: 'no-api-key', tab: 'image' });
        }
        toast('No API key configured. Click ⚙ to open Settings.', 'err'); return;
      }
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
      // Compute variantsCount UP-FRONT so the preflight can warn about
      // --n × Variants combos (validateToolCombos reads it from toolCtx).
      // The hard cap [1..5] is enforced here, mirroring the dropdown's
      // own options, so validateToolCombos can safely multiply without
      // re-checking bounds.
      const variantsCount = Math.max(1, Math.min(5, parseInt(variants.sel.value, 10) || 1));
      // Authoritative allowed-value / combination check (warn + proceed).
      if (typeof mmxPreflightConfirm === 'function' && !mmxPreflightConfirm('image', {
        model: model.input.getValue(), 'aspect-ratio': aspect.input.getValue(),
        n: n.input.getValue(), width: width.input.getValue(), height: height.input.getValue(),
        'response-format': respFmt.input.getValue(),
        prompt: promptText,
      }, { variantsCount })) return;
      const seedVal = seed.input.getValue();
      const seedLocked = String(seedVal) !== '' && variantsCount > 1;
      if (seedLocked) {
        // Defensive: shouldn't happen since the dropdown is disabled, but just in case
        toast('Variants are disabled while a fixed seed is set (would produce identical images).', 'warn');
        return;
      }
      let outDir;
      try { outDir = await ensureSubDir('image'); }
      catch (e) {
        // Surface the real reason instead of the old hard-coded
        // "No output directory set" — that was misleading when
        // the actual cause was an fs/allow-list error.
        const msg = (e && e.message) || String(e);
        toast('Cannot resolve output folder: ' + msg, 'err', 6000);
        return;
      }
      // Bug-fix (reported by user): pre-flight the --subject-ref reference
      // image. A stale/missing path used to reach the mmx subprocess and
      // fail with a cryptic "File system error: ENOENT … reference.jpeg"
      // that was then retried 4×. Catch it here with a clear, actionable
      // message and never spawn a doomed run. http(s) URLs are validated
      // server-side, so refImageExists reports them as present.
      const subjRefPreflight = (subjRef.input.getValue() || '').trim();
      if (subjRefPreflight && window.api && typeof window.api.refImageExists === 'function') {
        try {
          const ex = await window.api.refImageExists(subjRefPreflight);
          if (ex && ex.ok && !ex.exists) {
            toast(`Reference image not found:\n${subjRefPreflight}\nPick a new file (Browse…) or clear the field, then Generate again.`, 'err', 8000);
            return;
          }
        } catch (_) { /* probe unavailable — fall through and let mmx report */ }
      }
      const slug = slugify(promptText).slice(0, 60) || 'image';
      const promptShort = (promptText || '').replace(/\s+/g, ' ').slice(0, 120);
      // bug-fix Phase1 (_temp4.md): wrap the existing generation flow in
      // JobRunner.run() so ActiveJobsWidget shows it during the run and
      // its inline ✕ can cancel just this job (not every in-flight
      // generation on every tab). suppressLogRow:true keeps every
      // existing addLogEvent call below completely unchanged — no
      // duplicate primary row is created; JobRunner is purely a
      // tracking/cancellation layer here, not a logging one. `ctrl` is
      // declared with `let` and assigned by the JobRunner.run() call
      // itself, but runFn (below) only executes in a later microtask,
      // by which time the assignment has already completed — so runFn
      // can safely read ctrl.jobId via closure.
      let ctrl;
      ctrl = window.JobRunner.run({
        tabKey: 'image',
        type: 'image',
        title: `Image generation: ${promptShort}${promptText && promptText.length > 120 ? '…' : ''}`,
        subtitle: `Variants: ${variantsCount}`,
        suppressLogRow: true,
        runFn: async (ctx) => {
      const cancel = armGenBtnWithCancel(genBtn, 'Generate', ctrl.jobId);
      // External cancellation (ActiveJobsWidget ✕, or the Cancel button
      // which now routes through armGenBtnWithCancel -> JobRunner.cancel)
      // aborts ctx.signal — bridge that into the legacy `cancel` token so
      // every existing cancel.wasCancelled() check below keeps working
      // unchanged.
      ctx.signal.addEventListener('abort', () => cancel.cancel());
      // Log a "generation started" event up front so the user
      // sees one row per click in the new structured log pane,
      // and so the "completed" / "failed" events below can be
      // read as part of the same group. We use the prompt text
      // (truncated) as the headline; the full prompt stays
      // available in the expand-on-click details.
      // v1.1.9: pin all log events for this run to the same group
      // id so the renderer tints "started" / "completed" /
      // "failed" with the same colour and the user can visually
      // trace which lines belong to which generation. The id is
      // the run's start timestamp (ms) — unique per click,
      // stable across all events of that one run.
      const runGroupId = 'img-' + Date.now();
      const genStartEvId = addLogEvent({
        category: 'gen',
        groupId: runGroupId,
        headline: `Image generation started: ${promptShort}${promptText && promptText.length > 120 ? '…' : ''}`,
        fullText: promptText,
        details: [
          `Variants: ${variantsCount}`,
          `Seed: ${seedVal === '' ? '(random)' : String(seedVal)}`,
          `Aspect: ${aspect.input.getValue() || '(default)'}`,
          `Model: ${model.input.getValue() || '(default)'}`,
          `Reference: ${(() => { const v = subjRef.input.getValue(); return v && v.trim() ? v.trim() : '(none)'; })()}`,
        ],
      });
      let allOk = true;
      let lastPreview = null;
      let lastOutFile = null;
      // bug-fix Phase1 (_temp4.md): carries the final file list out of
      // the `if (allOk && lastOutFile...)` block below (where
      // displayFiles is declared) so the JobRunner runFn wrapper can
      // return it as the job's outputPaths after the block closes.
      // v1.1 (audit AUDIT-11): the original assignment was INSIDE the
      // post-process block, so a cancel BEFORE that block ran left
      // finalOutputPaths as []. We now seed finalOutputPaths from
      // outFiles as soon as the variants complete, so a cancel after
      // partial success returns the real file list (not empty) as
      // the job's outputPaths. The post-process block may later
      // OVERWRITE this with its post-processed list — that's
      // correct (upscaled / no-bg / optimised paths are more
      // useful than the raw generated paths).
      let finalOutputPaths = [];
      // outFiles tracks every image file we know about after generation
      // completes. For variants without --out-dir, each variant produces
      // one known file we push here. For --out-dir, the per-call output
      // files are unknown at gen time, so we scan the directory at the
      // end of the loop (see resolveOutDirFiles). After the upscale +
      // crop step, the original file is replaced by the upscaled (and
      // optionally cropped) one — we update the list in place.
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
      // Build the argv once and reuse it across variant attempts — the prompt
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
        // Bug-fix (2026-06-20): subjRef is a `text` row with a Browse
        // button, so `subjRef.input` is a div wrapper, not the inner
        // <input>. Reading `.value` on the div returns `undefined`,
        // which the `&&` short-circuit hid — but that meant
        // `--subject-ref` was silently NEVER sent even when the user
        // typed a path (or picked a file via Browse). Use .getValue()
        // which ParamRow attaches to the wrapper for exactly this
        // case.
        const subjRefVal = subjRef.input.getValue().trim();
        if (subjRefVal) {
          args.push('--subject-ref', `type=character,image=${subjRefVal}`);
        }
        appendFlag(args, respFmt.input);
        if (useOutDir) {
          args.push('--out-dir', outDir);
        }
        return args;
      }
      // Returns the resolved outFile for this variant (or outDir when --out-dir).
      // v1.1.15 (reported by user): when the "force prefix only"
      // checkbox is on, every generated file is named
      // `<prefix><6-digit counter>.png` (e.g. `temp000001.png`).
      // The counter is per-run (NOT per-prefix) and resets to 0
      // at the start of every Generate click so the first file
      // is `<prefix>000001.<ext>`, the second is
      // `<prefix>000002.<ext>`, and so on.
      const forceCounter = { n: 0 };
      async function makeOutPath(v) {
        if (useOutDir) return outDir;
        const ts = timestamp();
        const variantTag = variantsCount > 1 ? `_v${v}` : '';
        const prefix = (state.filePrefix || '').trim();
        if (state.filePrefixForceOnly) {
          // Force-prefix-only: counter is per-run, so the
          // first variant of the first item is 000001. The
          // _v tag is dropped because the user explicitly
          // asked for the counter alone (no slug, no
          // timestamp, no variant tag). Bug-fix (C4): use the
          // exact name (no random uniquePath suffix); collision
          // safety comes from bumping the counter past existing
          // files instead. Bug-fix (M6): also check sibling
          // extensions at the same counter value, since
          // fixImageExtension() may have renamed an earlier file
          // from .png to its real format.
          return nextFreeForcePrefixPath(outDir, forceCounter, prefix, 'png', ['jpg', 'jpeg', 'webp', 'gif', 'bmp']);
        }
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
          let outFile = await makeOutPath(v);
          const args = baseArgs.slice();
          if (!useOutDir) args.push('--out', outFile);
          lastCmd.textContent = maskLine(`mmx ${args.join(' ')}`, state.config && state.config.api_key);

          // Per-variant start time. We use this (not the whole-run start
          // time) to update the per-item average as each item finishes,
          // so the ETA ticks down more accurately as the run progresses.
          const itemStart = Date.now();
          const statusMsg = variantsCount > 1
            ? `Generating image… variant ${v}/${variantsCount}`
            : (useOutDir ? `Generating image… (${nCount} images to ${outDir})` : 'Generating image…');
          setStatus(statusMsg, true);
          preview.innerHTML = `<div class="empty"><span class="spinner"></span> ${escapeHtml(statusMsg)}</div>`;

          // Try the call, then retry up to 3 times with exponential backoff
          // on transient errors. The "API error: system error (HTTP 200)"
          // pattern we see in the field is almost always a backend hiccup
          // that succeeds on retry. We also detect rate-limit messages and
          // wait longer for those.
          let r = await window.api.mmxRunJob({ args, jobId: ctrl.jobId });
          if (!r.ok && !cancel.wasCancelled() && !isRetryableMmxError(r, formatMmxError(r))) {
            // Bug-fix (reported by user): a missing --subject-ref image
            // (or any permanent input/auth/quota error) used to be retried
            // 3 more times with exponential backoff, turning one clear
            // "File or directory not found" into a 4×-repeated, confusing
            // failure. Permanent errors can't succeed on retry, so surface
            // the real reason once, immediately. The reference-image path
            // is pre-flighted before we even get here (see the
            // existence check above buildImageArgs), so this mainly
            // catches server-side input rejections.
            const permMsg = formatMmxError(r);
            toast(`Image variant ${v}/${variantsCount} failed: ${permMsg}`, 'err', 7000);
          } else if (!r.ok && !cancel.wasCancelled()) {
            const firstMsg = formatMmxError(r);
            const isRateLimit = /rate|limit|throttl|too many|429/i.test(firstMsg);
            const maxRetries = 3;
            for (let attempt = 1; attempt <= maxRetries && !cancel.wasCancelled(); attempt++) {
              // Exponential backoff: 1.5s, 3s, 6s (×2 if rate-limited)
              const baseDelay = 1500 * Math.pow(2, attempt - 1);
              const delay = isRateLimit ? baseDelay * 2 : baseDelay;
              await new Promise((res) => setTimeout(res, delay));
              if (cancel.wasCancelled()) break;
              setStatus(`Retrying image variant ${v}/${variantsCount} (attempt ${attempt + 1}/${maxRetries + 1})…`, true);
              preview.innerHTML = `<div class="empty"><span class="spinner"></span> ${escapeHtml(`Retrying variant ${v}/${variantsCount} (attempt ${attempt + 1})…`)}</div>`;
              r = await window.api.mmxRunJob({ args, jobId: ctrl.jobId });
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
            preview.innerHTML = `<div class="empty">Generation failed (variant ${v}/${variantsCount}). Continuing with next variant…</div><div class="meta">${escapeHtml(formatMmxError(r))}</div>`;
            // Advance the queue counter even on failure so the ETA
            // doesn't keep counting this variant as "still in flight"
            // for the rest of the run. Failed variants still consume
            // wall-clock time, so we add their elapsed time to the
            // per-item average (so the ETA reflects the real pace of
            // the call, not just the successful ones — otherwise a
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
          // bug-fix M6 (_temp4.md): mmx wrote whatever bytes the CDN
          // returned to outFile — the image API has no output-format
          // parameter, so the CDN sometimes returns JPEG even though
          // makeOutPath() always asks for ".png". Sniff the real
          // format and rename before any downstream code (preview,
          // notifyImageGenerated, the post-process chain) captures
          // the old name.
          if (!useOutDir) {
            try {
              const fix = await window.api.fixImageExtension(outFile);
              if (fix && fix.ok && fix.renamed && fix.path) outFile = fix.path;
            } catch (_) { /* best-effort; keep the original name on failure */ }
          }
          lastPreview = r.parsed;
          lastOutFile = outFile;
          if (!useOutDir) outFiles.push(outFile);
          // Live-update the folder explorer + preview pane. The
          // gen handler knows the output path for non-(--out-dir)
          // runs, so we don't have to wait for the 1s polling
          // to discover the file — the UI reacts on the same
          // tick the file is written. The polling is still
          // running in the background as a safety net for the
          // --out-dir case (and for the post-processed upscaled
          // / cropped / no-bg / optimised files the gen handler
          // creates after the raw mmx call returns). Idempotent
          // — calling it with the same path twice is a no-op.
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
        // Post-processing INSIDE the try block — the previous layout ran
        // the upscale + crop + background-removal AFTER the finally, which
        // meant cancel.cleanup() had already restored the Generate button
        // to its idle state and cleared state.generating. The post-
        // processing then ran for several seconds under a "Generate"
        // button that the user could click again, racing the still-
        // running upscale and — when they did — the new click would
        // arm another cancel handler while the old run's pending
        // promises leaked. Now the button stays as "Cancel" and the
        // state.generating guard stays set until every post-processing
        // step has completed, matching what the UI promises.
        // v1.1 (HIGH-severity bug fix, audit H1): the previous
        // version gated this whole success/post-process block on
        // `allOk`, which meant a SINGLE failed variant (out of 5)
        // skipped post-processing for every successful variant
        // AND routed the user to the full-failure UI. The correct
        // gate is "we have at least one output file" — partial
        // success is still success from the user's point of view.
        // BatchGen (audit H2) reads genLastResult.image, which we
        // also fix below to mirror this gate so a 4/5-success run
        // is not flagged as a retryable failure.
        // v1.1 (audit AUDIT-11): seed finalOutputPaths from
        // outFiles BEFORE the post-process block so a cancel AFTER
        // the variants loop but BEFORE post-processing still has
        // the real file list to return. The post-process block
        // below may overwrite this with its post-processed list
        // (which is the better outcome when it runs to
        // completion).
        if (outFiles.length > 0) finalOutputPaths = outFiles.slice();
        if (outFiles.length > 0 && !cancel.wasCancelled()) {
        // Resolve the full list of output files. For --out-dir runs
        // (--n > 1), the per-call filenames are not known to the
        // renderer (mmx writes them with its own naming scheme), so
        // we scan outDir for files that were created during this
        // run. We use the run start time + a small 1.5s pre-roll as
        // the lower bound, and "now" as the upper bound. For single-
        // file runs (useOutDir=false), we already have the file list
        // from the variant loop in `outFiles`.
        let sourceFiles = outFiles.slice();
        if (useOutDir) {
          try {
            const dirList = await window.api.fbList(outDir);
            if (dirList && dirList.ok && Array.isArray(dirList.items)) {
              const startMs = (state.genStartMs && state.genStartMs.image) || (Date.now() - 600000);
              const nowMs = Date.now();
              const matches = dirList.items
                .filter((it) => !it.isDir && ['.png', '.jpg', '.jpeg', '.webp'].includes(it.ext))
                .filter((it) => {
                  const m = it.mtimeMs || 0;
                  return m >= startMs - 1500 && m <= nowMs + 5000;
                })
                .sort((a, b) => (a.mtimeMs || 0) - (b.mtimeMs || 0));
              if (matches.length) sourceFiles = matches.map((m) => m.path);
            }
          } catch (_) { /* fall back to whatever we have */ }
          // bug-fix M6 (_temp4.md): --out-dir runs let mmx pick its
          // own filenames per image, so the same hardcoded-extension
          // mismatch can apply here too — fix each one up front,
          // before the post-process chain runs on them.
          try {
            sourceFiles = await Promise.all(sourceFiles.map(async (f) => {
              try {
                const fix = await window.api.fixImageExtension(f);
                return (fix && fix.ok && fix.renamed && fix.path) ? fix.path : f;
              } catch (_) { return f; }
            }));
          } catch (_) { /* best-effort */ }
        }
        // Post-processing chain: for EVERY generated file (not just
        // the last one — that was the bug fixed in this revision),
        // run the upscale → crop → remove-background → optimize chain
        // and collect the final paths. Each step is independently
        // non-fatal: a failure on variant N keeps the original file
        // for variant N and continues with the next one, so the user
        // never loses an image they paid API credits to generate.
        const displayFiles = [];
        const postProcessEach = state.upscaleEnabled
          || state.removeBackgroundEnabled
          || (state.optimizeSettings && state.optimizeSettings.enabled);
        const lastIdx = sourceFiles.length - 1;
        for (let i = 0; i < sourceFiles.length; i++) {
          if (cancel.wasCancelled()) {
            // Cancel mid-chain: any files we haven't processed yet
            // stay as their raw generated path. The files we have
            // processed stay as their processed paths.
            for (let j = i; j < sourceFiles.length; j++) {
              if (!displayFiles.includes(sourceFiles[j])) displayFiles.push(sourceFiles[j]);
            }
            break;
          }
          const src = sourceFiles[i];
          const tag = sourceFiles.length > 1 ? ` (${i + 1}/${sourceFiles.length})` : '';
          try {
            if (postProcessEach) {
              const finalPath = await runPostProcessChain(src, {
                label: tag,
                onStatus: (msg) => {
                  setStatus(msg, true);
                  preview.innerHTML = `<div class="empty"><span class="spinner"></span> ${escapeHtml(msg)}</div>`;
                },
                onRefresh: () => { try { refreshBrowser(); } catch (_) {} },
              });
              displayFiles.push(finalPath);
            } else {
              displayFiles.push(src);
            }
          } catch (e) {
            // runPostProcessChain is supposed to swallow per-step
            // errors and return the best-available path, so we only
            // land here on a truly unexpected throw. Be defensive:
            // fall back to the source file so the user still gets
            // the raw generated image in the preview pane.
            console.error('Post-process failed for', src, e);
            displayFiles.push(src);
          }
          // Refresh the folder browser once per processed file so
          // the new (upscaled / no-bg / optimised) files appear in
          // the right-hand file list as soon as they're written.
          // Cheap, and the user explicitly asked for live updates
          // during batchgen (see feature #6).
          if (i === lastIdx) {
            try { await refreshBrowser(); } catch (_) {}
          }
        }
        finalOutputPaths = displayFiles.slice();
        // The last entry of displayFiles is the most recently
        // processed path — treat it as the canonical "last preview"
        // for legacy callers (toast messages that reference it, the
        // preview-ready message at the end, etc.). For a single-
        // file run, this is the same file as the raw generated
        // output (or its post-processed replacement).
        const displayFile = displayFiles.length ? displayFiles[displayFiles.length - 1] : lastOutFile;
        // The image tab's left-side preview no longer shows the
        // generated image — per the user's request, the picture
        // preview lives in the right-side folder-explorer's preview
        // pane (which subdivides into N thumbnails for N images).
        // The left-side area only carries a short status line so the
        // layout doesn't collapse but the prompt / parameter inputs
        // are no longer obscured.
        preview.innerHTML = '';
        // v1.1.1 polish: include a "↻ Regenerate" button on the
        // success state so the user can re-run the same prompt
        // with one click instead of scrolling up to the Generate
        // button. Power users iterate a lot on the same prompt
        // (e.g. trying different aspect ratios, switching the
        // seed off, etc.) and this is the single biggest workflow
        // improvement we can make to the success state.
        const readyWrap = el('div', { class: 'empty' });
        const readyMsg = el('div', { class: 'preview-ready-msg' }, [
          '✅ ',
          String(displayFiles.length),
          (displayFiles.length === 1 ? ' image' : ' images'),
          ' ready — see the preview pane on the right. Click any thumbnail to open it at 1:1.',
        ]);
        const regenBtn = el('button', { class: 'btn-mini preview-regen-btn', type: 'button' }, '↻ Regenerate');
        regenBtn.title = 'Re-run the same prompt (no changes to inputs)';
        regenBtn.addEventListener('click', () => { try { genBtn.click(); } catch (_) {} });
        readyWrap.appendChild(readyMsg);
        readyWrap.appendChild(el('div', { class: 'preview-ready-actions' }, [regenBtn]));
        preview.appendChild(readyWrap);
        try { previewImagesFromFiles(displayFiles); } catch (_) {}
        bumpGenerationCounter('image', totalImages);
        // Log a "generation completed" event so the user has
        // a single row to copy / expand that summarises the
        // run. The full file list is in the details (one per
        // line) so the user can paste it into a support
        // ticket.
        addLogEvent({
          category: 'gen',
          groupId: runGroupId,
          result: 'ok',
          headline: `Generated ${displayFiles.length} image${displayFiles.length === 1 ? '' : 's'}`,
          details: displayFiles.map((p) => '• ' + p),
        });
      } else if (outFiles.length === 0 && !cancel.wasCancelled()) {
        // Pure failure: NO variant succeeded. Partial-success runs
        // (outFiles.length > 0 but !allOk) now go through the success
        // branch above with their post-process chain applied, so the
        // user keeps the images they paid API credits for.
        // Log a "generation failed" event so the user can copy
        // the structured error from the log pane (e.g. into a
        // support ticket). The full classified error message +
        // stderr / stdout are included in the details so the
        // helper doesn't have to ask the user "what did it
        // say?".
        try {
          const failedMsg = formatMmxError(lastFailedR || { stderr: '', stdout: '', code: -1 });
          const failedClass = classifyMmxError(lastFailedR || {}, failedMsg);
          addLogEvent({
            category: 'error',
            groupId: runGroupId,
            result: 'err',
            headline: `Image generation failed: ${failedMsg}`,
            details: [
              `Classification: ${failedClass}`,
              `Stderr: ${(lastFailedR && lastFailedR.stderr) || '(empty)'}`,
              `Stdout: ${(lastFailedR && lastFailedR.stdout) || '(empty)'}`,
              `Exit code: ${(lastFailedR && lastFailedR.code) != null ? String(lastFailedR.code) : '(unknown)'}`,
            ],
          });
        } catch (_) { /* never block the rest of the error UI on log */ }
        // Build a detailed, actionable error block. The user has been
        // hitting "API error: system error (HTTP 200)" which is opaque —
        // we now classify the error (auth, rate, quota, network, server,
        // unknown) and show targeted tips + buttons to diagnose / retry /
        // copy the raw error for support.
        const lastErrMsg = formatMmxError(lastFailedR || { stderr: '', stdout: '', code: -1 });
        const classification = classifyMmxError(lastFailedR || {}, lastErrMsg);
        const tips = {
          auth: [
            'Your API key may be invalid, expired, or revoked.',
            'Click "Test connection" below to verify.',
            'Re-paste your key in ⚙ Settings if needed.',
          ],
          rate: [
            'The service is rate-limiting your account.',
            'Wait 30–60 seconds, then click Retry.',
            'Avoid running many batches back-to-back.',
          ],
          quota: [
            'Your Token Plan quota is exhausted for this model.',
            'Wait for the rolling window to reset, or upgrade your plan.',
            'Check the ⚡ quota display in the top bar.',
          ],
          network: [
            'Could not reach the service (DNS / firewall / offline).',
            'Verify your internet connection and any VPN / proxy settings.',
            'Click "Diagnose" below to check the installation.',
          ],
          server: [
            'The service returned a server-side error. Usually transient.',
            'Wait a few seconds and click Retry.',
            'If it persists, the service may be degraded — try again later.',
          ],
          // BUG-9-08 (reported 2026-06-25): mmx exited with code -1 and
          // produced NO stderr/stdout. The main process's `proc.on('error')`
          // path fires when the Node child cannot be spawned OR dies before
          // reaching mmx's own error handler. mmx normally prints "Error:
          // <msg>" to stderr before exit, so a truly empty stderr is the
          // smoking gun for "mmx crashed before it could print anything".
          // Observed cause: rate-limit crash on a rapid 2nd variant when
          // the user runs --n × Variants. Targeted tips for that pattern.
          silent: [
            'mmx exited silently with no error output (code -1).',
            'This commonly happens after rapid back-to-back mmx calls (e.g. Variants + --n).',
            'Wait 30–60 seconds, then retry with one variant at a time.',
            'Reduce Variants or --n to avoid hitting rate limits.',
            'Click "Diagnose" to verify the mmx-cli installation.',
          ],
          unknown: [
            'The service returned an unrecognised error.',
            'Click "Copy error" to share the details with support.',
            'Click "Diagnose" to verify the mmx installation.',
          ],
        };
        const tipList = tips[classification] || tips.unknown;
        preview.innerHTML = '';
        const wrap = el('div', { class: 'empty preview-error' });
        wrap.appendChild(el('div', { class: 'preview-error-title' }, '⚠ Generation failed'));
        const detail = el('div', { class: 'preview-error-message' });
        detail.textContent = lastErrMsg || 'Unknown error (see log pane for details).';
        wrap.appendChild(detail);
        // Classified troubleshooting tips
        const tipsBlock = el('div', { class: 'preview-error-tips' });
        for (const t of tipList) {
          const li = el('div', { class: 'preview-error-tip' }, '• ' + t);
          tipsBlock.appendChild(li);
        }
        wrap.appendChild(tipsBlock);
        // Action buttons: Retry / Test connection / Diagnose / Copy error
        const retryBtn = el('button', { class: 'primary' }, '🔄 Retry');
        const testBtn = el('button', { class: 'btn-mini' }, '🔑 Test connection');
        const diagBtn = el('button', { class: 'btn-mini' }, '🩺 Diagnose');
        const copyBtn = el('button', { class: 'btn-mini' }, '📋 Copy error');
        retryBtn.addEventListener('click', () => genBtn.click());
        testBtn.addEventListener('click', async () => {
          testBtn.disabled = true; testBtn.textContent = 'Testing…';
          const r = await window.api.authStatus();
          testBtn.disabled = false; testBtn.textContent = '🔑 Test connection';
          if (r.ok) {
            toast(r.message || 'API key is valid.', 'ok', 4000);
          } else {
            toast('Auth failed: ' + (r.error || 'unknown'), 'err', 6000);
          }
        });
        diagBtn.addEventListener('click', () => showDiagnose());
        copyBtn.addEventListener('click', async () => {
          const blob = JSON.stringify({
            classification,
            message: lastErrMsg,
            code: lastFailedR?.code,
            stderr: (lastFailedR?.stderr || '').slice(0, 4000),
            stdout: (lastFailedR?.stdout || '').slice(0, 4000),
            parsed: lastFailedR?.parsed,
            ts: new Date().toISOString(),
          }, null, 2);
          try {
            await navigator.clipboard.writeText(blob);
            toast('Error details copied to clipboard.', 'ok', 1500);
          } catch (_) {
            // Fallback: just toast the message
            toast('Clipboard unavailable — error: ' + lastErrMsg, 'warn', 6000);
          }
        });
        const actions = el('div', { class: 'preview-error-actions' }, [retryBtn, testBtn, diagBtn, copyBtn]);
        wrap.appendChild(actions);
        preview.appendChild(wrap);
        // Also surface a short toast
        const shortMsg = classification === 'auth'
          ? 'Auth failed. Click Test connection.'
          : classification === 'rate'
            ? 'Rate limited. Wait 30s and Retry.'
            : classification === 'quota'
              ? 'Quota exhausted.'
              : classification === 'silent'
                ? 'mmx exited silently. Wait 30s and retry with fewer variants.'
                : 'Generation failed. See preview for details.';
        toast(shortMsg, 'warn', 4000);
      }
      } catch (e) {
        threw = e;
        allOk = false;
        console.error('Image generation threw:', e);
        toast('Generation error: ' + (e && e.message || String(e)), 'err', 6000);
      } finally {
        // Record the run outcome on state BEFORE cleanup() clears
        // state.generating. The BatchGen runner detects the end of a run
        // by polling state.generating, so the outcome must be set first
        // or the runner reads a stale value. We can't scrape the preview
        // DOM instead: the image tab deliberately no longer renders an
        // <img> in .preview (the picture lives in the right-hand preview
        // pane), which made the old preview.querySelector check report
        // every image batch item as "failed".
        state.genLastResult = state.genLastResult || { image: null, speech: null, music: null, video: null };
        // v1.1 (audit H1 + L1): mark the run as 'ok' when ANY variant
        // succeeded, so BatchGen does NOT auto-retry a partial-success
        // run (which would waste API quota re-generating the variants
        // that already landed). A cancel AFTER partial success still
        // leaves real files on disk, so we treat that as 'ok' too —
        // the cancel flag only matters for runs that produced nothing.
        state.genLastResult.image = (outFiles.length > 0 && !threw) ? 'ok' : 'err';
        cancel.cleanup();
        setStatus('Ready', false);
        // Always refresh — even on cancel/failure, partial files may exist
        // on disk and the user should see them.
        try { await refreshBrowser(); } catch {}
        try { await refreshQuota(); } catch {}
      }
      if (threw) return { status: 'err', error: (threw && threw.message) || String(threw), outputPaths: finalOutputPaths };
      if (cancel.wasCancelled()) {
        preview.innerHTML = '<div class="empty">Generation cancelled.</div>';
        toast('Cancelled.', 'warn');
        return { status: 'cancel', outputPaths: finalOutputPaths };
      }
      // v1.1 (audit H1): same partial-success gate as the post-process
      // block — a 4/5-success run returns 'ok' (with a toast that names
      // the partial outcome) so the BatchGen runner does NOT re-spawn it.
      if (outFiles.length > 0) {
        const okCount = outFiles.length;
        const failCount = variantsCount - okCount;
        toast(failCount > 0
          ? `Image generated. ${okCount}/${variantsCount} variants saved (${failCount} failed — see log).`
          : (variantsCount > 1 ? `Image generated. ${variantsCount} variants saved.` : 'Image generated.'),
          failCount > 0 ? 'warn' : 'ok');
        return { status: 'ok', outputPaths: finalOutputPaths };
      }
      return { status: 'err', outputPaths: finalOutputPaths };
        },
      });
      if (ctrl && typeof ctrl.catch === 'function') {
        // JobRunner.run() rejected synchronously (hard cap, or the same
        // tab somehow started a second job in the gap since the guard
        // above ran) — there is no job and runFn above never executes.
        // Swallow it here so it doesn't surface as an unhandled
        // rejection; JobRunner.run() already shows its own toast.
        ctrl.catch(() => {});
      } else {
        await ctrl.done;
      }
    });
  },
};

window.ImageTab = window.TABS.image;
