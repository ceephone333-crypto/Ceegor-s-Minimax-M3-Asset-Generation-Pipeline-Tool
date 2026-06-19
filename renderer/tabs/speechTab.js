// renderer/tabs/speechTab.js (Phase 3 Block 28)
// ----------------- SPEECH TAB -----------------
window.TABS = window.TABS || {};
window.TABS.speech = {
  prefilled: 'Welcome to MiniMax — Token Plan or PAYG, both work here.',
  build() {
    const root = $('#tab-speech');
    root.innerHTML = '';

    const text = buildParamRow('Text to read (prefilled, editable)',
      { kind: 'textarea', value: this.prefilled, help: 'What the voice will say. Up to 10 000 characters across all models.' });
    const styleRow = buildStyleRow('speech', 'Select a style preset. Its value is prepended (with a comma) to your text before the request is sent. Useful for narration tone, language hints, etc.');
    const stylePreview = buildStylePreviewBlock();
    const tabState = { previewEl: stylePreview._previewEl, selEl: styleRow.sel, manualEl: text.input };
    const update = () => updateStylePreview(tabState);
    styleRow.sel.addEventListener('change', update);
    text.input.addEventListener('input', update);
    update();
    // Speech API actually accepts up to 10 000 chars, but we still show the
    // same counter pattern so the user has a constant reference.
    const counter = buildPromptCounter({ selEl: styleRow.sel, manualEl: text.input, max: 10000, id: 'speech' });
    root.appendChild(el('div', { class: 'section' }, [
      el('h3', {}, 'Text'),
      styleRow.row,
      text.row,
      stylePreview,
      counter.wrap,
    ]));

    const model = buildParamRow('--model', {
      kind: 'enum', default: 'speech-2.8-hd',
      options: [
        { value: 'speech-2.8-hd', label: 'speech-2.8-hd (newest, best quality — default)' },
        { value: 'speech-2.8-turbo', label: 'speech-2.8-turbo (faster, lower latency)' },
        { value: 'speech-2.6-hd', label: 'speech-2.6-hd' },
        { value: 'speech-2.6-turbo', label: 'speech-2.6-turbo' },
        { value: 'speech-02-hd', label: 'speech-02-hd' },
        { value: 'speech-02-turbo', label: 'speech-02-turbo' },
        { value: 'speech-2.6', label: 'speech-2.6 (legacy)' },
        { value: 'speech-02', label: 'speech-02 (legacy)' },
      ],
      help: 'Text-to-speech model.\n\nspeech-2.8-hd (default): Newest, best audio quality, supports sound tags.\nspeech-2.8-turbo: Same quality tier but lower latency.\nspeech-2.6-hd / 2.6-turbo: Previous generation, still high quality.\nspeech-02-hd / 02-turbo: Older generation, 24 languages.\nLegacy 2.6 / 02: Use only if you hit issues with 2.8.\n\nAll models: up to 10 000 chars input, --speed / --volume / --pitch supported.',
    });
    const voice = buildParamRow('--voice', {
      kind: 'enum', default: 'English_expressive_narrator',
      options: [{ value: 'English_expressive_narrator', label: 'English_expressive_narrator (default)' }],
      help: 'Which voice speaks. 300+ voices available — list loaded from `mmx speech voices`.',
    });
    const speed = buildParamRow('--speed', {
      kind: 'number', default: 1.0, step: 0.05,
      options: [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0].map((v) => ({ value: v, label: String(v) })),
      help: 'Playback speed multiplier. 1.0 = normal.',
    });
    const volume = buildParamRow('--volume', {
      kind: 'number', default: 1, min: 0, max: 10, step: 1,
      options: [0, 1, 2, 3, 5, 7, 10].map((v) => ({ value: v, label: String(v) })),
      help: 'Volume level 0 (silent) – 10 (loudest).',
    });
    const pitch = buildParamRow('--pitch', {
      kind: 'number', default: 0, min: -12, max: 12, step: 1,
      options: [-12, -6, -3, 0, 3, 6, 12].map((v) => ({ value: v, label: String(v) })),
      help: 'Pitch shift in semitones. 0 = no change.',
    });
    const format = buildParamRow('--format', {
      kind: 'enum', default: 'mp3',
      options: [
        { value: 'mp3', label: 'mp3 (default)' },
        { value: 'wav', label: 'wav' },
        { value: 'pcm', label: 'pcm' },
        { value: 'flac', label: 'flac' },
        { value: 'opus', label: 'opus' },
        { value: 'pcmu_raw', label: 'pcmu_raw' },
        { value: 'pcmu_wav', label: 'pcmu_wav' },
      ],
      help: 'Output audio container.',
    });
    const sampleRate = buildParamRow('--sample-rate', {
      kind: 'number', default: 32000, step: 1000,
      options: [8000, 16000, 22050, 24000, 32000, 44100, 48000].map((v) => ({ value: v, label: String(v) })),
      help: 'Sample rate in Hz.',
    });
    const bitrate = buildParamRow('--bitrate', {
      kind: 'number', default: 128000, step: 1000,
      options: [32000, 64000, 96000, 128000, 192000, 256000, 320000].map((v) => ({ value: v, label: String(v) })),
      help: 'Bitrate in bits/second.',
    });
    const channels = buildParamRow('--channels', {
      kind: 'enum', default: 1,
      options: [{ value: 1, label: '1 (mono)' }, { value: 2, label: '2 (stereo)' }],
      help: 'Number of audio channels.',
    });
    const language = buildParamRow('--language (boost)', {
      kind: 'enum-text', default: '',
      options: [
        { value: '', label: '(none)' },
        { value: 'auto', label: 'auto' },
        { value: 'en', label: 'en' },
        { value: 'zh', label: 'zh' },
        { value: 'ja', label: 'ja' },
        { value: 'ko', label: 'ko' },
        { value: 'es', label: 'es' },
        { value: 'fr', label: 'fr' },
        { value: 'de', label: 'de' },
        { value: 'pt', label: 'pt' },
        { value: 'ru', label: 'ru' },
        { value: 'it', label: 'it' },
        { value: 'ar', label: 'ar' },
        { value: 'hi', label: 'hi' },
      ],
      help: 'Boost recognition for a specific language code (e.g. "en", "zh").',
    });
    const subtitles = buildParamRow('--subtitles', {
      kind: 'boolean', default: false, help: 'Also save an .srt subtitle file alongside the audio.',
    });
    const soundEffect = buildParamRow('--sound-effect', {
      kind: 'enum-text', default: '',
      options: [{ value: '', label: '(none)' }],
      help: 'Optional background sound effect (model-dependent).',
    });
    const pronunciation = buildParamRow('--pronunciation (repeatable)', {
      kind: 'text', default: '', help: 'Custom pronunciation rule in the form from=to. Add multiple via comma.',
    });

    root.appendChild(el('div', { class: 'section' }, [
      el('h3', {}, 'Parameters'),
      el('div', { class: 'grid' }, [
        model.row, voice.row,
        speed.row, volume.row,
        pitch.row, format.row,
        sampleRate.row, bitrate.row,
        channels.row, language.row,
        subtitles.row, soundEffect.row,
        pronunciation.row,
      ]),
    ]));

    const actions = el('div', { class: 'actions' });
    const genBtn = el('button', { class: 'primary' }, 'Generate');
    const lastCmd = el('span', { class: 'lastcmd' }, '');
    const batchControls = el('span', { 'data-batch-controls': 'speech', class: 'batch-controls' });
    // Variants dropdown (speech tab has no seed, so always enabled)
    const variants = buildVariantsRow({ id: 'variants-speech' });
    actions.append(buildAddToBatchBtn('speech'), genBtn, variants.row, batchControls, lastCmd);
    const preview = el('div', { class: 'preview' }, el('div', { class: 'empty' }, 'No audio generated yet.'));
    // Preview ABOVE the actions row so the Generate / +Add buttons
    // sit at the very bottom of the tab. See the image tab's
    // tabFooter comment for the rationale.
    const tabFooter = el('div', { class: 'tab-footer' }, [preview, actions]);
    root.appendChild(tabFooter);

    // Populate voices list
    this.populateVoices(voice.input).catch(() => {});

    genBtn.addEventListener('click', async () => {
      // Re-entrancy guard: another generation is in progress.
      if (state.generating) return;
      if (!state.config.api_key) { toast('No API key configured. Click ⚙ to open Settings.', 'err'); return; }
      const txt = text.input.value.trim();
      if (!txt) { toast('Text is required.', 'warn'); return; }
      // Pre-flight: validate visible parameters against MODEL_SPECS.
      // --emotion only exists on 2.6+ speech models; the row is
      // hidden in the form via isFlagVisibleForCurrentModel, but
      // an old saved value could still be set when the user
      // switches models — we strip it here so the API never
      // receives an unsupported flag.
      const speechParams = {
        '--text': text.input,
        '--model': model.input,
        '--voice': voice.input,
        '--speed': speed.input,
        '--volume': volume.input,
        '--pitch': pitch.input,
        '--format': format.input,
        '--sample-rate': sampleRate.input,
        '--bitrate': bitrate.input,
        '--channels': channels.input,
        '--language': language.input,
        '--subtitles': subtitles.input,
        '--sound-effect': soundEffect.input,
        '--pronunciation': pronunciation.input,
        '--emotion': emotion && emotion.input ? emotion.input : null,
      };
      const speechModel = model.input.getValue();
      const speechErrs = [];
      for (const k of Object.keys(speechParams)) {
        if (!speechParams[k]) { delete speechParams[k]; continue; }
      }
      const preErrs = validateTabAgainstSpec('speech', speechParams, speechModel, null, isFlagVisibleForCurrentModel);
      if (preErrs.length) {
        for (const e of preErrs) toast(e, 'err', 6000);
        return;
      }
      // Speech-specific gate: --bitrate only matters when the
      // output format is a lossy codec (mp3 / opus). The spec
      // table's perRowOverrides flags this so we suppress a
      // useless --bitrate send when the user picked WAV / PCM /
      // FLAC, otherwise the API may reject it or ignore it
      // silently.
      const speechFormat = (format.input.value || 'mp3').split('_')[0];
      if (!['mp3', 'opus'].includes(speechFormat)) {
        // Clear the value so appendFlag skips it (we keep the
        // dropdown visible because the spec is "always show,
        // greyed when irrelevant").
        bitrate.input.value = '';
      }
      const variantsCount = Math.max(1, Math.min(5, parseInt(variants.sel.value, 10) || 1));
      let outDir;
      try { outDir = await ensureSubDir('speech'); }
      catch (e) { toast('No output directory set. Open Settings.', 'err'); return; }
      const slug = slugify(txt).slice(0, 60) || 'speech';
      const ext = (format.input.value || 'mp3').split('_')[0];
      // Total assets this run will produce. The per-tab ETA timer reads
      // this from state.genQueueSize[tabKey] to compute a "remaining
      // time for the whole batch" estimate that ticks down as each
      // variant completes.
      if (!state.genQueueSize) state.genQueueSize = { image: 0, speech: 0, music: 0, video: 0 };
      if (!state.genQueueDone) state.genQueueDone = { image: 0, speech: 0, music: 0, video: 0 };
      state.genQueueSize.speech = variantsCount;
      state.genQueueDone.speech = 0;
      const cancel = armGenBtnWithCancel(genBtn, 'Generate');
      let allOk = true;
      let lastPreview = null;
      let lastOutFile = null;
      let threw = null;
      try {
        for (let v = 1; v <= variantsCount; v++) {
          if (cancel.wasCancelled()) break;
          const itemStart = Date.now();
          const args = ['speech', 'synthesize'];
          args.push('--text', txt);
          appendFlag(args, model.input);
          appendFlag(args, voice.input);
          appendFlag(args, speed.input);
          appendFlag(args, volume.input);
          appendFlag(args, pitch.input);
          appendFlag(args, format.input);
          appendFlag(args, sampleRate.input);
          appendFlag(args, bitrate.input);
          appendFlag(args, channels.input);
          if (language.input.getValue()) args.push('--language', String(language.input.getValue()));
          appendBoolFlag(args, subtitles.input, '--subtitles');
          if (soundEffect.input.getValue()) args.push('--sound-effect', String(soundEffect.input.getValue()));
          if (pronunciation.input.value && pronunciation.input.value.trim()) {
            for (const rule of pronunciation.input.value.split(',').map(s => s.trim()).filter(Boolean)) {
              args.push('--pronunciation', rule);
            }
          }
          const ts = timestamp();
          const variantTag = variantsCount > 1 ? `_v${v}` : '';
          const prefix = (state.filePrefix || '').trim();
          const outFile = uniquePath(outDir, `${prefix}${ts}_${slug}${variantTag}.${ext}`);
          args.push('--out', outFile);
          lastCmd.textContent = maskLine(`mmx ${args.join(' ')}`, state.config && state.config.api_key);
          const statusMsg = variantsCount > 1
            ? `Generating speech… variant ${v}/${variantsCount}`
            : 'Generating speech…';
          setStatus(statusMsg, true);
          preview.innerHTML = `<div class="empty"><span class="spinner"></span> ${escapeHtml(statusMsg)}</div>`;
          const r = await window.api.mmxRun(args);
          if (cancel.wasCancelled()) { allOk = false; break; }
          if (!r.ok) {
            const msg = formatMmxError(r);
            preview.innerHTML = `<div class="empty">Generation failed (variant ${v}/${variantsCount}).</div><div class="meta">${escapeHtml(msg)}</div>`;
            toast('Speech generation failed: ' + msg, 'err', 6000);
            allOk = false;
            break;
          }
          // Update the per-item average + advance the queue counter so
          // the ETA ticks down per item. See the image-tab comment
          // for the full rationale.
          const itemDur = (Date.now() - itemStart) / 1000;
          if (!state.genAvgSec) state.genAvgSec = {};
          const prevAvg = state.genAvgSec.speech || 0;
          state.genAvgSec.speech = prevAvg === 0 ? itemDur : (prevAvg * 0.6 + itemDur * 0.4);
          state.genQueueDone.speech = (state.genQueueDone.speech || 0) + 1;
          refreshTabEtas();
          lastPreview = r.parsed;
          lastOutFile = outFile;
        }
      } catch (e) {
        threw = e;
        allOk = false;
        console.error('Speech generation threw:', e);
        toast('Generation error: ' + (e && e.message || String(e)), 'err', 6000);
      } finally {
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
        showAudioPreview(preview, lastOutFile, lastPreview);
        bumpGenerationCounter('speech', variantsCount);
      }
      if (allOk) {
        toast(variantsCount > 1
          ? `Speech generated. ${variantsCount} variants saved.`
          : 'Speech generated.', 'ok');
      }
    });
  },
  async populateVoices(sel) {
    if (state.voicesLoaded) { fillVoices(sel, state.voices); return; }
    const v = await window.api.voices();
    if (Array.isArray(v) && v.length) {
      state.voices = v; state.voicesLoaded = true;
      fillVoices(sel, v);
    }
  },
};

function fillVoices(sel, voices) {
  const current = sel.value;
  sel.innerHTML = '';
  for (const v of voices) sel.appendChild(el('option', { value: v }, v));
  if (voices.includes(current)) sel.value = current;
}

window.SpeechTab = window.TABS.speech;
