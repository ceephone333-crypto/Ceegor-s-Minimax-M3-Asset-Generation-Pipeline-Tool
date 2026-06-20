// renderer/tabs/musicTab.js (Phase 3 Block 28)
// ----------------- MUSIC TAB -----------------
window.TABS = window.TABS || {};
window.TABS.music = {
  prefilled: 'calm piano melody, 15 seconds',
  build() {
    const root = $('#tab-music');
    root.innerHTML = '';

    const prompt = buildParamRow('Music prompt (prefilled, editable)',
      { kind: 'textarea', value: this.prefilled, help: 'Describe the music: genre, mood, instruments, tempo, length (e.g. "30 seconds", "2 minutes"). The most up-to-date model (music-2.6) supports up to about 6 minutes. Max 2 000 characters.' });
    const styleRow = buildStyleRow('music', 'Select a style preset. Its value is prepended (with a comma) to your music prompt before the request is sent. Use it for repeated genre/mood tags.');
    const stylePreview = buildStylePreviewBlock();
    const tabState = { previewEl: stylePreview._previewEl, selEl: styleRow.sel, manualEl: prompt.input };
    // extraPrefix is filled in AFTER the vocal-mode `mode` row is defined below.
    let extraPrefix = () => '';
    const updatePreview = () => updateStylePreview(tabState, extraPrefix());
    styleRow.sel.addEventListener('change', updatePreview);
    prompt.input.addEventListener('input', updatePreview);
    updatePreview();
    // Character counter for the --prompt argument value.
    // NOTE: extraPrefix is a `let` that gets REASSIGNED below (after `mode`
    // and `instrumental` are defined). Passing it directly would freeze the
    // counter to the initial empty function. Wrap it so the counter always
    // reads the current extraPrefix value.
    const counter = buildPromptCounter({
      selEl: styleRow.sel,
      manualEl: prompt.input,
      getExtraPrefix: () => extraPrefix(),
      id: 'music',
    });
    // Placeholder for the mode listener, attached after `mode` is built below.
    root.appendChild(el('div', { class: 'section' }, [
      el('h3', {}, 'Prompt'),
      styleRow.row,
      prompt.row,
      stylePreview,
      counter.wrap,
    ]));

    // === Instrumental toggle (a normal parameter entry) ===
    // The user-facing "make this song voice-less" toggle. ON sets
    // the vocal mode to "instrumental" and prepends a strong
    // no-vocals clause to the prompt, which the music-2.6 model
    // honors more reliably than `--instrumental` alone (per
    // MiniMax docs).
    //
    // Layout: rendered as a regular row in the Vocals & Lyrics
    // section (same `.row` styling as every other param), with a
    // small 🎵 marking + a per-row warning banner that appears
    // when the toggle is ON. No more separate "prominent" section
    // — the user wanted it in the normal parameter list.
    const instrumental = buildParamRow('🎵 Instrumental (voice-less)', {
      kind: 'boolean',
      default: false,
      help: 'Generate a voice-less / instrumental track. ON sets the vocal mode to "instrumental" AND auto-prepends "no vocals, no lyrics, no human voice," to the prompt — the model-2.6 API ignores --instrumental without this hint. Requires music-2.5+ or music-2.6.',
    });
    // Per-row warning that appears directly under the
    // instrumental row when the toggle is ON. Same
    // .info-banner styling as the lyrics-mode banner so the
    // visual weight is identical (instead of the old
    // bigger "prominent section" treatment that used to break
    // the normal parameter rhythm).
    const instrBanner = el('div', { class: 'info-banner instrumental-banner', style: 'display:none;' });
    instrBanner.appendChild(el('div', { class: 'info-banner-title' }, '🎵 Instrumental mode is on'));
    instrBanner.appendChild(el('div', {}, [
      'Lyrics will be ignored and ',
      el('strong', {}, '"no vocals, no lyrics, no human voice, "'),
      ' will be prepended to the prompt so the model stays voice-less.',
    ]));

    // Mode
    const mode = buildParamRow('Vocal mode', {
      kind: 'enum', default: 'lyrics-optimizer',
      options: [
        { value: 'lyrics-optimizer', label: 'Auto-generate lyrics from prompt' },
        { value: 'lyrics', label: 'Use my custom lyrics' },
        { value: 'instrumental', label: 'Instrumental (no vocals)' },
      ],
      help: 'How vocals/lyrics are handled. (Auto-overridden when "Instrumental mode" is ON above.)',
    });
    // When vocal mode is "instrumental", the model still tends to add vocals unless
    // the prompt explicitly forbids them. We auto-prepend a strong no-vocals clause.
    // (Bound here so `mode` is in scope.)
    const INSTRUMENTAL_PREFIX = 'no vocals, no lyrics, no human voice, ';
    extraPrefix = () => (mode.input.value === 'instrumental' || instrumental.input.value === 'on')
      ? INSTRUMENTAL_PREFIX : '';
    const onInstrumentalChange = () => {
      // If the toggle is ON, force the mode to instrumental
      if (instrumental.input.value === 'on') {
        mode.input.value = 'instrumental';
        mode.input.disabled = true;
        mode.row.classList.add('locked-by-instrumental');
      } else {
        mode.input.disabled = false;
        mode.row.classList.remove('locked-by-instrumental');
        if (mode.input.value === 'instrumental') mode.input.value = 'lyrics-optimizer';
      }
      instrBanner.style.display = instrumental.input.value === 'on' ? '' : 'none';
      counter.update();
      updatePreview();
    };
    instrumental.input.addEventListener('change', onInstrumentalChange);
    mode.input.addEventListener('change', () => { counter.update(); updatePreview(); });
    // Re-render once now that the prefix logic is in place
    updatePreview();
    counter.update();
    const lyrics = buildParamRow('Custom lyrics', {
      kind: 'textarea', value: '', help: 'Used when "Use my custom lyrics" is selected. Supports structure tags: [Verse], [Chorus], [Bridge], [Intro], [Outro], [Pre Chorus], [Interlude], [Post Chorus], [Transition], [Break], [Hook], [Build Up], [Inst], [Solo]. Max 3500 chars.\nNote: only music-2.5+ and music-2.6 reliably support --lyrics. If the output ignores the lyrics, switch the model in the dropdown below.',
    });
    const lyricsFile = buildParamRow('Lyrics file path (alt)', {
      kind: 'text', default: '',
      placeholder: 'Path to .txt file with lyrics',
      fileFilters: [
        { name: 'Text files', extensions: ['txt', 'md', 'lrc'] },
        { name: 'All files', extensions: ['*'] },
      ],
      browseTitle: 'Select lyrics text file',
      help: 'Read lyrics from a text file instead of pasting them.\nFormat: structure tags ([Verse], [Chorus], [Bridge], etc.) + free text.\nMax 3500 chars per song.\nNote: only music-2.5+ and music-2.6 reliably support --lyrics. If the\noutput ignores the lyrics, switch the model in the dropdown above.',
    });
    // Lyrics-mode info banner (shown only when mode === 'lyrics')
    const lyricsModeBanner = el('div', { class: 'info-banner', style: 'display:none;' });
    lyricsModeBanner.appendChild(el('div', { class: 'info-banner-title' }, '🎤 Custom Lyrics mode'));
    const bannerBody = el('div', {});
    const bannerText = document.createTextNode('Fill the textarea above (or use a .txt file). Ensure --model is set to ');
    bannerBody.appendChild(bannerText);
    const m1 = el('strong', {}, 'music-2.6');
    bannerBody.appendChild(m1);
    bannerBody.appendChild(document.createTextNode(' or '));
    const m2 = el('strong', {}, 'music-2.5+');
    bannerBody.appendChild(m2);
    bannerBody.appendChild(document.createTextNode('. music-2.0 ignores --lyrics. Max 3500 chars; structure tags like '));
    bannerBody.appendChild(el('code', {}, '[Verse]'));
    bannerBody.appendChild(document.createTextNode(', '));
    bannerBody.appendChild(el('code', {}, '[Chorus]'));
    bannerBody.appendChild(document.createTextNode(', '));
    bannerBody.appendChild(el('code', {}, '[Bridge]'));
    bannerBody.appendChild(document.createTextNode(' are supported.'));
    lyricsModeBanner.appendChild(bannerBody);
    function updateLyricsBanner() {
      const isLyrics = mode.input.value === 'lyrics';
      lyricsModeBanner.style.display = isLyrics ? '' : 'none';
      // Hide lyrics + lyricsFile when mode is not 'lyrics' (they'd be ignored otherwise)
      lyrics.row.style.display = isLyrics ? '' : 'none';
      lyricsFile.row.style.display = isLyrics ? '' : 'none';
    }
    mode.input.addEventListener('change', updateLyricsBanner);
    updateLyricsBanner();

    // Vocals & Lyrics section. The Instrumental toggle is now a
    // normal entry INSIDE this section (not a separate prominent
    // box). It still has the 🎵 prefix + a per-row warning banner
    // when ON, so the user gets the same visual cue without the
    // rhythm-breaking separate-section layout.
    const lyricsSection = el('div', { class: 'section' }, [
      el('h3', {}, 'Vocals & Lyrics'),
      instrumental.row,
      instrBanner,
      mode.row,
      lyrics.row,
      lyricsFile.row,
      lyricsModeBanner,
    ]);
    root.appendChild(lyricsSection);
    const model = buildParamRow('--model', {
      kind: 'enum', default: 'music-2.6',
      options: [
        { value: 'music-2.6', label: 'music-2.6 (newest — cover, instrumental, lyrics-optimizer, default)' },
        { value: 'music-2.5+', label: 'music-2.5+ (instrumental unlocked, richer arrangements)' },
        { value: 'music-2.5', label: 'music-2.5 (paragraph-level precision, 14+ structure tags)' },
        { value: 'music-2.0', label: 'music-2.0 (legacy)' },
      ],
      help: 'Music generation model.\n\nmusic-2.6 (default): Newest. Supports --lyrics-optimizer, --instrumental,\n  --lyrics, --cover. Best for full-length songs with vocals.\n\nmusic-2.5+: Instrumental mode unlocked natively, richer multi-instrument\n  arrangements. Use when music-2.6 instrumental sounds too thin.\n\nmusic-2.5: 14+ structure tags with paragraph-level precision. Good\n  when you need fine-grained control over song structure.\n\nmusic-2.0: Legacy. May not support --lyrics or --instrumental.',
    });
    const genre = buildParamRow('--genre', {
      kind: 'enum-text', default: '',
      options: [
        { value: '', label: '(any)' },
        { value: 'pop', label: 'pop' },
        { value: 'rock', label: 'rock' },
        { value: 'jazz', label: 'jazz' },
        { value: 'classical', label: 'classical' },
        { value: 'hip-hop', label: 'hip-hop' },
        { value: 'electronic', label: 'electronic' },
        { value: 'folk', label: 'folk' },
        { value: 'cinematic', label: 'cinematic' },
        { value: 'lo-fi', label: 'lo-fi' },
        { value: 'ambient', label: 'ambient' },
        { value: 'country', label: 'country' },
        { value: 'r&b', label: 'r&b' },
        { value: 'metal', label: 'metal' },
        { value: 'indie', label: 'indie' },
      ],
      help: 'Music genre tag. Free-text fallback if you pick "Custom…".',
    });
    const mood = buildParamRow('--mood', {
      kind: 'enum-text', default: '',
      options: [
        { value: '', label: '(any)' },
        { value: 'happy', label: 'happy' },
        { value: 'sad', label: 'sad' },
        { value: 'energetic', label: 'energetic' },
        { value: 'calm', label: 'calm' },
        { value: 'melancholic', label: 'melancholic' },
        { value: 'aggressive', label: 'aggressive' },
        { value: 'romantic', label: 'romantic' },
        { value: 'dark', label: 'dark' },
        { value: 'uplifting', label: 'uplifting' },
        { value: 'dreamy', label: 'dreamy' },
      ],
      help: 'Mood or emotion. Free-text fallback if you pick "Custom…".',
    });
    const vocals = buildParamRow('--vocals', {
      kind: 'enum-text', default: '',
      options: [
        { value: '', label: '(any)' },
        { value: 'warm male baritone', label: 'warm male baritone' },
        { value: 'bright female soprano', label: 'bright female soprano' },
        { value: 'duet with harmonies', label: 'duet with harmonies' },
        { value: 'choir', label: 'choir' },
      ],
      help: 'Vocal style descriptor. Free-text fallback if you pick "Custom…".',
    });
    const instruments = buildParamRow('--instruments', {
      kind: 'enum-text', default: '',
      options: [
        { value: '', label: '(any)' },
        { value: 'piano', label: 'piano' },
        { value: 'acoustic guitar', label: 'acoustic guitar' },
        { value: 'electric guitar', label: 'electric guitar' },
        { value: 'drums', label: 'drums' },
        { value: 'strings', label: 'strings' },
        { value: 'synth', label: 'synth' },
        { value: 'orchestral', label: 'orchestral' },
      ],
      help: 'Featured instruments. Free-text fallback if you pick "Custom…".',
    });
    const bpm = buildParamRow('--bpm', {
      kind: 'number', default: '', min: 40, max: 220, step: 1,
      options: [
        { value: '', label: '(unset)' },
        { value: 60, label: '60' }, { value: 80, label: '80' }, { value: 90, label: '90' },
        { value: 100, label: '100' }, { value: 110, label: '110' }, { value: 120, label: '120' },
        { value: 128, label: '128' }, { value: 140, label: '140' }, { value: 160, label: '160' },
      ],
      help: 'Exact tempo in BPM.',
    });
    const key = buildParamRow('--key', {
      kind: 'enum-text', default: '',
      options: [
        { value: '', label: '(any)' },
        { value: 'C major', label: 'C major' },
        { value: 'C minor', label: 'C minor' },
        { value: 'D major', label: 'D major' },
        { value: 'D minor', label: 'D minor' },
        { value: 'E major', label: 'E major' },
        { value: 'E minor', label: 'E minor' },
        { value: 'F major', label: 'F major' },
        { value: 'F minor', label: 'F minor' },
        { value: 'G major', label: 'G major' },
        { value: 'G minor', label: 'G minor' },
        { value: 'A major', label: 'A major' },
        { value: 'A minor', label: 'A minor' },
        { value: 'B major', label: 'B major' },
      ],
      help: 'Musical key. Free-text fallback if you pick "Custom…".',
    });
    const tempo = buildParamRow('--tempo', {
      kind: 'enum-text', default: '',
      options: [
        { value: '', label: '(any)' },
        { value: 'slow', label: 'slow' },
        { value: 'moderate', label: 'moderate' },
        { value: 'fast', label: 'fast' },
      ],
      help: 'Coarse tempo hint.',
    });
    const structure = buildParamRow('--structure', {
      kind: 'enum-text', default: '',
      options: [
        { value: '', label: '(any)' },
        { value: 'verse-chorus-verse-chorus', label: 'verse-chorus-verse-chorus' },
        { value: 'verse-chorus-bridge-chorus', label: 'verse-chorus-bridge-chorus' },
        { value: 'intro-verse-chorus', label: 'intro-verse-chorus' },
      ],
      help: 'Song structure description.',
    });
    const references = buildParamRow('--references', {
      kind: 'text', default: '', help: 'Reference tracks or artists, e.g. "similar to Ed Sheeran".',
    });
    const avoid = buildParamRow('--avoid', {
      kind: 'text', default: '', help: 'Elements to avoid in the generated music.',
    });
    const useCase = buildParamRow('--use-case', {
      kind: 'enum-text', default: '',
      options: [
        { value: '', label: '(any)' },
        { value: 'background music for video', label: 'background music for video' },
        { value: 'theme song', label: 'theme song' },
        { value: 'jingle', label: 'jingle' },
        { value: 'podcast intro', label: 'podcast intro' },
      ],
      help: 'Use case context.',
    });
    const extra = buildParamRow('--extra', {
      kind: 'text', default: '', help: 'Additional fine-grained requirements not covered above.',
    });
    const audioFormat = buildParamRow('--format', {
      kind: 'enum', default: 'mp3',
      options: [
        { value: 'mp3', label: 'mp3 (default)' },
        { value: 'wav', label: 'wav' },
        { value: 'pcm', label: 'pcm' },
      ],
      help: 'Output audio container.',
    });
    const sampleRate = buildParamRow('--sample-rate', {
      kind: 'number', default: 44100, step: 1000,
      options: [22050, 32000, 44100, 48000].map((v) => ({ value: v, label: String(v) })),
      help: 'Sample rate in Hz.',
    });
    const bitrate = buildParamRow('--bitrate', {
      kind: 'number', default: 256000, step: 1000,
      options: [128000, 192000, 256000, 320000].map((v) => ({ value: v, label: String(v) })),
      help: 'Bitrate in bits/second.',
    });
    const watermark = buildParamRow('--aigc-watermark', {
      kind: 'boolean', default: false, help: 'Embed an AI-generated content watermark in the audio.',
    });
    const outputFormat = buildParamRow('--output-format', {
      kind: 'enum', default: 'hex',
      options: [
        { value: 'hex', label: 'hex (default, saved to file)' },
        { value: 'url', label: 'url (24h expiry — download promptly)' },
      ],
      help: 'How audio bytes come back. hex is saved directly; url requires separate download.',
    });

    root.appendChild(el('div', { class: 'section' }, [
      el('h3', {}, 'Parameters'),
      buildFilePrefixRow(),
      el('div', { class: 'grid' }, [
        mode.row, model.row,
        lyrics.row, lyricsFile.row,
        genre.row, mood.row,
        vocals.row, instruments.row,
        bpm.row, key.row,
        tempo.row, structure.row,
        references.row, avoid.row,
        useCase.row, extra.row,
        audioFormat.row, sampleRate.row,
        bitrate.row, watermark.row,
        outputFormat.row,
      ]),
    ]));

    const actions = el('div', { class: 'actions' });
    const genBtn = el('button', { class: 'primary' }, 'Generate');
    const lastCmd = el('span', { class: 'lastcmd' }, '');
    const batchControls = el('span', { 'data-batch-controls': 'music', class: 'batch-controls' });
    // Variants dropdown (music tab has no seed, so always enabled)
    const variants = buildVariantsRow({ id: 'variants-music' });
    actions.append(buildAddToBatchBtn('music'), genBtn, variants.row, batchControls, lastCmd);
    const preview = el('div', { class: 'preview' }, el('div', { class: 'empty' }, 'No audio generated yet.'));
    // Preview ABOVE the actions row so the Generate / +Add buttons
    // sit at the very bottom of the tab. See the image tab's
    // tabFooter comment for the rationale.
    const tabFooter = el('div', { class: 'tab-footer' }, [preview, actions]);
    root.appendChild(tabFooter);

    genBtn.addEventListener('click', async () => {
      // Bug-fix (2026-06-20): wrap the WHOLE click handler in a
      // try/catch. The previous layout only caught errors inside the
      // variant for-loop, so a ReferenceError thrown during pre-flight
      // (e.g. a missing helper or undefined state key) would reject
      // the async handler silently and the user saw no progress.
      // With this outer guard any unexpected throw surfaces as a
      // toast (and the button is reset by the re-entrancy guard
      // because we never set state.generating on a pre-flight failure).
      try {
      // Re-entrancy guard: another generation is in progress.
      if (state.generating) return;
      if (!state.config.api_key) { toast('No API key configured. Click ⚙ to open Settings.', 'err'); return; }
      const promptText = buildFinalPrompt(styleRow.sel, prompt.input, extraPrefix());
      if (!promptText) { toast('Prompt is required (style or manual input).', 'warn'); return; }
      // Validate lyrics-mode input once, before looping variants
      if (mode.input.value === 'lyrics') {
        // Bug-fix (2026-06-20, reported by user): `lyricsFile` is a
        // `text` row with a Browse button, so `lyricsFile.input` is
        // a div wrapper, not the inner <input>. Reading `.value` on
        // the div returns `undefined`, and `.trim()` on `undefined`
        // throws a TypeError that the previous try/catch (around
        // the for-loop only) didn't catch — so the click handler
        // rejected silently and the user saw no progress. Use
        // .getValue() which ParamRow attaches to the wrapper.
        const lyricsFileVal = lyricsFile.input.getValue().trim();
        const lyricsVal = lyrics.input.value.trim();
        if (!lyricsFileVal && !lyricsVal) {
          toast('Custom lyrics mode selected but no lyrics provided.', 'warn');
          return;
        }
      }
      // Pre-flight: validate against MODEL_SPECS so the user
      // never gets a cryptic 400 for an out-of-range prompt,
      // unsupported flag for the current model, or a too-long
      // lyrics block. --instrumental / --lyrics-optimizer only
      // exist on the 2.5+ / 2.6 models; --lyrics is supported
      // on every model but unreliable on music-2.0.
      const musicModel = model.input.getValue();
      const musicParams = {
        '--model': model.input,
        '--prompt': prompt.input,
        '--lyrics': lyrics.input,
        '--instrumental': instrumental.input,
        '--lyrics-optimizer': mode.input, // mode maps to --lyrics-optimizer
        '--sample-rate': sampleRate.input,
        // v1.1.12 (reported by user): the variable is `bitrate`
        // (declared by the buildParamRow('--bitrate', …) call
        // a few lines above). The previous code referenced
        // `audioBitrate.input` which was a bare identifier that
        // was never declared anywhere, so the click handler
        // threw a ReferenceError on the first click. The
        // outer try/catch surfaced it as a toast ("Generation
        // failed before starting: audioBitrate is not
        // defined") but the user had to read the toast to
        // discover the typo. The pre-flight spec check + the
        // arg builder now both use the actual local name.
        '--bitrate': bitrate.input,
        '--format': audioFormat.input,
      };
      const preErrs = validateTabAgainstSpec('music', musicParams, musicModel, null, isFlagVisibleForCurrentModel);
      if (preErrs.length) {
        for (const e of preErrs) toast(e, 'err', 6000);
        return;
      }
      // music-2.0 doesn't have --sample-rate 8000 in its accepted
      // set, so we already validate. But for safety: if the user
      // picked music-2.0 and a 8000Hz sample rate, the API
      // returns the closest supported rate. We don't block it.
      // Lyrics length: 3500 chars max for music-2.6; shorter for
      // older models. The spec table's lyrics.max covers all
      // models in one number (3500).

      const variantsCount = Math.max(1, Math.min(5, parseInt(variants.sel.value, 10) || 1));
      let outDir;
      try { outDir = await ensureSubDir('music'); }
      catch (e) {
        const msg = (e && e.message) || String(e);
        toast('Cannot resolve output folder: ' + msg, 'err', 6000);
        return;
      }
      const slug = slugify(promptText).slice(0, 60) || 'music';
      const ext = (audioFormat.input.value || 'mp3');
      // Total assets this run will produce. The per-tab ETA timer reads
      // this from state.genQueueSize[tabKey] to compute a "remaining
      // time for the whole batch" estimate that ticks down as each
      // variant completes.
      if (!state.genQueueSize) state.genQueueSize = { image: 0, speech: 0, music: 0, video: 0 };
      if (!state.genQueueDone) state.genQueueDone = { image: 0, speech: 0, music: 0, video: 0 };
      state.genQueueSize.music = variantsCount;
      state.genQueueDone.music = 0;
      const cancel = armGenBtnWithCancel(genBtn, 'Generate');
      let allOk = true;
      let lastPreview = null;
      let lastOutFile = null;
      let threw = null;
      try {
        for (let v = 1; v <= variantsCount; v++) {
          if (cancel.wasCancelled()) break;
          const itemStart = Date.now();
          const args = ['music', 'generate'];
          args.push('--prompt', promptText);
          // Mode
          if (mode.input.value === 'lyrics-optimizer') args.push('--lyrics-optimizer');
          else if (mode.input.value === 'instrumental') args.push('--instrumental');
          else if (mode.input.value === 'lyrics') {
            // Same .value-vs-.getValue() fix as the pre-flight check
            // above — lyricsFile is a `text` row with a Browse
            // button, so its input is a div wrapper.
            const lyricsFileVal = lyricsFile.input.getValue().trim();
            if (lyricsFileVal) args.push('--lyrics-file', lyricsFileVal);
            else {
              const lyricsVal = lyrics.input.value.trim();
              if (lyricsVal) args.push('--lyrics', lyricsVal);
            }
          }
          appendFlag(args, model.input);
          appendFlag(args, genre.input);
          appendFlag(args, mood.input);
          appendFlag(args, vocals.input);
          appendFlag(args, instruments.input);
          if (bpm.input.getValue() !== '') args.push('--bpm', String(bpm.input.getValue()));
          appendFlag(args, key.input);
          appendFlag(args, tempo.input);
          appendFlag(args, structure.input);
          if (references.input.value.trim()) args.push('--references', references.input.value.trim());
          if (avoid.input.value.trim()) args.push('--avoid', avoid.input.value.trim());
          appendFlag(args, useCase.input);
          if (extra.input.value.trim()) args.push('--extra', extra.input.value.trim());
          appendFlag(args, audioFormat.input);
          appendFlag(args, sampleRate.input);
          appendFlag(args, bitrate.input);
          appendBoolFlag(args, watermark.input, '--aigc-watermark');
          if (outputFormat.input.value && outputFormat.input.value !== 'hex') {
            args.push('--output-format', outputFormat.input.value);
          }
          // Unique output file per variant
          const ts = timestamp();
          const variantTag = variantsCount > 1 ? `_v${v}` : '';
          const outFile = uniquePath(outDir, `${ts}_${slug}${variantTag}.${ext}`);
          args.push('--out', outFile);
          lastCmd.textContent = maskLine(`mmx ${args.join(' ')}`, state.config && state.config.api_key);
          const statusMsg = variantsCount > 1
            ? `Generating music… variant ${v}/${variantsCount} (may take 30s–2min each)`
            : 'Generating music… (may take 30s–2min)';
          setStatus(statusMsg, true);
          preview.innerHTML = `<div class="empty"><span class="spinner"></span> ${escapeHtml(statusMsg)}</div>`;
          const r = await window.api.mmxRun(args);
          if (cancel.wasCancelled()) { allOk = false; break; }
          if (!r.ok) {
            const msg = formatMmxError(r);
            preview.innerHTML = `<div class="empty">Generation failed (variant ${v}/${variantsCount}).</div><div class="meta">${escapeHtml(msg)}</div>`;
            toast(`Music generation failed: ${msg}`, 'err', 6000);
            allOk = false;
            break;
          }
          // Update the per-item average + advance the queue counter so
          // the ETA ticks down per item. See the image-tab comment
          // for the full rationale.
          const itemDur = (Date.now() - itemStart) / 1000;
          if (!state.genAvgSec) state.genAvgSec = {};
          const prevAvg = state.genAvgSec.music || 0;
          state.genAvgSec.music = prevAvg === 0 ? itemDur : (prevAvg * 0.6 + itemDur * 0.4);
          state.genQueueDone.music = (state.genQueueDone.music || 0) + 1;
          refreshTabEtas();
          lastPreview = r.parsed;
          lastOutFile = outFile;
        }
      } catch (e) {
        threw = e;
        allOk = false;
        console.error('Music generation threw:', e);
        toast('Generation error: ' + (e && e.message || String(e)), 'err', 6000);
      } finally {
        // Record outcome BEFORE cleanup() clears state.generating so the
        // BatchGen runner (which polls state.generating) always reads the
        // final result, never a stale value left over from a prior item.
        state.genLastResult = state.genLastResult || { image: null, speech: null, music: null, video: null };
        state.genLastResult.music = (allOk && !threw && !cancel.wasCancelled()) ? 'ok' : 'err';
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
        bumpGenerationCounter('music', variantsCount);
      }
      if (allOk) {
        toast(variantsCount > 1
          ? `Music generated. ${variantsCount} variants saved.`
          : 'Music generated.', 'ok');
      }
      } catch (e) {
        // Outer guard: any error thrown by pre-flight (state lookups,
        // helpers that weren't loaded yet, etc.) lands here as a
        // visible toast instead of a silent async-reject. The
        // re-entrancy guard above is unaffected because state.generating
        // is only set inside armGenBtnWithCancel (which we may not
        // have reached).
        console.error('Music generation pre-flight failed:', e);
        toast('Generation failed before starting: ' + (e && e.message || String(e)), 'err', 6000);
      }
    });
  },
};

// Phase 3 Block 10: fileUrl() extrahiert nach
// renderer/utils/fileUrl.js. Pure Funktion, 0 App-Coupling.
var { fileUrl } = window.FileUrl;

function showImagePreview(rootEl, file, parsed) {
  // Use file:// to let the renderer display the local file.
  // We add a cache-busting query string in case the same path is regenerated.
  // The preview now renders a 400×400 thumbnail instead of the full image
  // (the preview pane was locking the screen when the generation produced
  // a large image). Clicking the thumbnail opens the image overlay at
  // 1:1 pixel mode with a zoom dropdown.
  const url = fileUrl(file) + '?t=' + Date.now();
  const filename = (file || '').split(/[\\/]/).pop() || 'image';
  const preLoad = new Image();
  preLoad.onload = () => {
    rootEl.innerHTML = '';
    const thumb = el('img', {
      src: url,
      alt: filename,
      class: 'preview-thumb',
      title: `${preLoad.naturalWidth}×${preLoad.naturalHeight} — click to view full size`,
    });
    thumb.addEventListener('click', () => {
      openImageOverlay(url, filename, preLoad.naturalWidth, preLoad.naturalHeight, file);
    });
    rootEl.appendChild(thumb);
    const meta = el('div', { class: 'meta' });
    meta.appendChild(document.createTextNode(file));
    meta.appendChild(el('div', { class: 'preview-thumb-size' },
      `${preLoad.naturalWidth}×${preLoad.naturalHeight} — click for 1:1 view`));
    if (parsed) meta.appendChild(el('div', {}, '[mmx] ' + safeStringify(parsed)));
    rootEl.appendChild(meta);
  };
  preLoad.onerror = () => {
    // Fallback when pre-loading fails (e.g. file still being written to disk).
    rootEl.innerHTML = '';
    const thumb = el('img', { src: url, alt: filename, class: 'preview-thumb' });
    thumb.addEventListener('click', () => openImageOverlay(url, filename, 0, 0, file));
    rootEl.appendChild(thumb);
    const meta = el('div', { class: 'meta' }, file);
    rootEl.appendChild(meta);
  };
  preLoad.src = url;
}

function showAudioPreview(rootEl, file, parsed) {
  const url = fileUrl(file) + '?t=' + Date.now();
  rootEl.innerHTML = '';
  const audio = el('audio', { controls: '', src: url });
  rootEl.appendChild(audio);
  const meta = el('div', { class: 'meta' });
  meta.appendChild(document.createTextNode(file));
  if (parsed) meta.appendChild(el('div', {}, '[mmx] ' + safeStringify(parsed)));
  rootEl.appendChild(meta);
}

// Open the image overlay: a full-screen modal showing the image at
// 1:1 pixel mode by default, with a zoom dropdown (75% / 50% / 25% /
// Fit-to-window). Used by both the generation preview thumbnail and the
// file-browser preview pane.
// Track the most recent overlay's close function so a re-open can
// dispose the previous one cleanly (removes its document-level
// keydown listener). Without this, every rapid thumbnail click
// leaked one Esc listener on `document`, and the user had to
// press Esc N times to dismiss a single overlay after N re-opens.
let _openImageOverlayClose = null;

// Set of extensions the overlay's arrow-key navigation considers
// "browsable" — i.e. an image file the user can step through.
// Mirrors the same set the file browser / preview pane use to
// decide what to render.
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'];

// Build the list of image paths the user can step through with
// the arrow keys in the overlay. Prefers the active multi-image
// batch (state._previewBatch) when the current path is in it;
// otherwise falls back to the folder explorer's currently-rendered
// image list, which is sorted the same way as the folder explorer
// (because the file browser sorts server-side and the renderer
// displays the items in the order it received them).
//
// Returns { paths: string[], index: number } or null when no list
// could be built (e.g. no folder context, no batch, no match).
function buildOverlayNavList(currentPath) {
  const cur = (currentPath || '').toLowerCase();
  // 1) Multi-image batch — only if the current path is actually in it.
  if (state._previewBatch && Array.isArray(state._previewBatch.paths) && state._previewBatch.paths.length > 1) {
    const idx = state._previewBatch.paths.findIndex((p) => (p || '').toLowerCase() === cur);
    if (idx >= 0) {
      return { paths: state._previewBatch.paths, index: idx };
    }
  }
  // 2) Fallback: all image files in the current folder, in the
  //    same order the folder explorer renders them. The
  //    file-browser renderer stores the items on state._fbItems
  //    (added in feature #2) and they arrive pre-sorted from the
  //    main process (name + dirs-first). We further filter to
  //    image files so the arrow keys only step through images
  //    and not, say, the user's text notes.
  if (Array.isArray(state._fbItems) && state._fbItems.length) {
    const paths = state._fbItems
      .filter((it) => !it.isDir && IMAGE_EXTS.includes((it.ext || '').toLowerCase()))
      .map((it) => it.path);
    if (!paths.length) return null;
    const idx = paths.findIndex((p) => (p || '').toLowerCase() === cur);
    return { paths, index: idx >= 0 ? idx : 0 };
  }
  return null;
}

function openImageOverlay(src, filename, naturalWidth, naturalHeight, filePath) {
  // If there's already an overlay open, close it cleanly (this
  // removes the previous keydown listener before we open a new one).
  if (_openImageOverlayClose) {
    try { _openImageOverlayClose(); } catch (_) {}
    _openImageOverlayClose = null;
  }
  // The previous code did `existing.remove()` here, which
  // removed the DOM but never called close() — so the keydown
  // listener stayed attached forever. The cleanup is now in
  // _openImageOverlayClose above.
  const overlay = el('div', { class: 'image-overlay', id: 'image-overlay' });
  // Header
  const fname = el('span', { class: 'image-overlay-filename', title: filename || '' }, filename || '');
  const size = el('span', { class: 'image-overlay-size' },
    (naturalWidth && naturalHeight) ? `${naturalWidth}×${naturalHeight}` : '');
  // Position counter (e.g. "3 / 12") on the overlay header. Shown
  // when the arrow keys can navigate, hidden otherwise. Built
  // from the same nav list the arrow keys use, so the two stay
  // in lock-step.
  const navList = buildOverlayNavList(filePath);
  const pos = el('span', { class: 'image-overlay-pos' }, '');
  if (navList && navList.paths.length > 1) {
    pos.textContent = ` (${navList.index + 1} / ${navList.paths.length})`;
  }
  const zoom = el('select', { class: 'image-overlay-zoom', title: 'Zoom level' });
  for (const [val, label] of [
    ['100', '100% (1:1)'],
    ['75', '75%'],
    ['50', '50%'],
    ['25', '25%'],
    ['fit', 'Fit to window'],
  ]) {
    const opt = el('option', { value: val }, label);
    if (val === '100') opt.selected = true;
    zoom.appendChild(opt);
  }
  const closeBtn = el('button', { class: 'btn-mini image-overlay-close', title: 'Close (Esc)' }, '×');
  // Prev / next arrow buttons on the header. Same keyboard / click
  // behaviour — the buttons exist so the user can navigate on a
  // touch device or with the mouse without using the keyboard.
  const prevBtn = el('button', { class: 'btn-mini image-overlay-prev', title: 'Previous (←)' }, '‹');
  const nextBtn = el('button', { class: 'btn-mini image-overlay-next', title: 'Next (→)' }, '›');
  if (!navList || navList.paths.length <= 1) {
    // Single-image overlay — hide the nav controls so the user
    // doesn't think there's more to see.
    prevBtn.style.display = 'none';
    nextBtn.style.display = 'none';
  }
  const header = el('div', { class: 'image-overlay-header' }, [fname, pos, size, prevBtn, nextBtn, zoom, closeBtn]);
  // Content
  const img = el('img', { class: 'image-overlay-img zoom-100', src, alt: filename || '' });
  if (naturalWidth && naturalHeight) {
    // Hint the browser at the natural size for layout (CSS then scales
    // according to .zoom-100/75/50/25/fit).
    img.width = naturalWidth;
    img.height = naturalHeight;
  }
  const content = el('div', { class: 'image-overlay-content' }, [img]);
  overlay.append(header, content);
  document.body.appendChild(overlay);
  // Zoom on change
  zoom.addEventListener('change', () => {
    img.className = 'image-overlay-img zoom-' + zoom.value;
  });
  // Close on button click
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (_openImageOverlayClose === close) _openImageOverlayClose = null;
  };
  closeBtn.addEventListener('click', close);
  // Close on background click (not on the image)
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  // The keyboard handler covers:
  //   Esc   → close the overlay
  //   ← / → → step to the previous / next image (with wrap-around
  //           when the user reaches the ends, so the keyboard
  //           navigation matches what the user expects from a
  //           typical image viewer)
  // Other keys are ignored. We compute the nav list lazily on
  // each arrow press so a newly-shown multi-image batch is picked
  // up the moment the user opens the overlay (and so the list
  // stays accurate even if the user clicks into a different
  // thumbnail in the preview pane while the overlay is open —
  // which is currently not possible, but defensive code is cheap).
  const onKey = (e) => {
    if (e.key === 'Escape') { close(); return; }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const list = buildOverlayNavList(filePath);
    if (!list || list.paths.length <= 1) return;
    const delta = e.key === 'ArrowLeft' ? -1 : +1;
    // Wrap-around: at the end, ← jumps to the last; at the start,
    // → jumps to the first. The preview-pane highlight + the
    // folder-explorer .selected row follow.
    const nextIdx = (list.index + delta + list.paths.length) % list.paths.length;
    navigateToOverlayImage(list.paths[nextIdx], { wrap: true });
  };
  document.addEventListener('keydown', onKey);
  // Wire the prev/next header buttons to the same navigateToOverlayImage
  // path so mouse-only users get the same behaviour.
  if (navList && navList.paths.length > 1) {
    prevBtn.addEventListener('click', () => {
      const list = buildOverlayNavList(filePath);
      if (!list || list.paths.length <= 1) return;
      const nextIdx = (list.index - 1 + list.paths.length) % list.paths.length;
      navigateToOverlayImage(list.paths[nextIdx], { wrap: true });
    });
    nextBtn.addEventListener('click', () => {
      const list = buildOverlayNavList(filePath);
      if (!list || list.paths.length <= 1) return;
      const nextIdx = (list.index + 1) % list.paths.length;
      navigateToOverlayImage(list.paths[nextIdx], { wrap: true });
    });
  }
  // Stop propagation on the image so clicking the image doesn't close
  // the overlay (the user is likely trying to interact with the image).
  img.addEventListener('click', (e) => e.stopPropagation());
  // Right-click on the overlay image: open the same
  // folder-browser context menu (Upscale / Crop / Convert /
  // Optimize / Remove background + file-level Copy / Cut /
  // Rename / Move / Delete). Mirrors the preview-pane-thumbnail
  // right-click behaviour so the user gets the same options
  // from either entry point.
  if (filePath) {
    img.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { showItemContextMenuForPath(filePath, e.clientX, e.clientY); }
      catch (_) { /* best-effort */ }
    });
    // Same right-click on the header filename (the "Image.png"
    // label in the overlay's top bar) — useful when the user
    // wants the context menu without aiming at the image.
    fname.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { showItemContextMenuForPath(filePath, e.clientX, e.clientY); }
      catch (_) { /* best-effort */ }
    });
  }
  // Hand the close function to the next open call so a re-open
  // disposes this one cleanly.
  _openImageOverlayClose = close;
}

// Open the next / previous image in the current overlay nav list.
// Called by the arrow-key / prev-next-button handlers inside
// openImageOverlay. Closes the current overlay, re-opens a new
// one for `path`, and updates the multi-image preview-pane
// highlight (if a batch is shown) + the folder-explorer's
// .selected row. The "wrap" option is accepted for future use
// (e.g. disabling wrap-around when the user explicitly clicks
// a thumbnail), but currently the keyboard always wraps.
function navigateToOverlayImage(path, opts) {
  if (!path) return;
  // Update the multi-image preview-pane highlight so the new
  // "current" thumbnail gets the .preview-active class. We
  // update _previewBatch.index even if the path is not in the
  // batch — buildOverlayNavList falls back to the folder list
  // in that case.
  if (state._previewBatch && Array.isArray(state._previewBatch.paths)) {
    const idx = state._previewBatch.paths.findIndex((p) => (p || '').toLowerCase() === path.toLowerCase());
    if (idx >= 0) state._previewBatch.index = idx;
  }
  // Folder-explorer's .selected row follows the user, so the
  // file they're navigating to is always the active row.
  markFbItemActive(path);
  // Re-render the preview-pane highlight (the .preview-active
  // class on the thumbnail). We do this by walking the
  // current grid and toggling the class.
  const grid = document.querySelector('#fb-preview-content .preview-pane-grid');
  if (grid) {
    let activeSlot = null;
    $$('.preview-pane-thumb', grid).forEach((slot) => {
      // The slot's `title` attribute is the filename, which is
      // not a reliable key. Instead, the click handler stores
      // the path on a data attribute when it binds; for the
      // public path we read it from the slot's stored state.
      // As a fallback, the slot's first child <img> has a
      // src that includes a cache-buster; we can't reverse
      // that into a path. So we just look up by data-path
      // if the slot has it (we set it below in
      // previewImagesFromFiles).
      const slotPath = slot.getAttribute('data-path');
      const isMatch = slotPath && slotPath.toLowerCase() === path.toLowerCase();
      slot.classList.toggle('preview-active', !!isMatch);
      if (isMatch) activeSlot = slot;
    });
    if (activeSlot) {
      try { activeSlot.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) {}
    }
  }
  // Close the current overlay (which also unregisters the
  // keyboard listener) and open a new one for the new path.
  // The close() inside openImageOverlay() handles the
  // _openImageOverlayClose cleanup; we then load the natural
  // size async so the new overlay's title shows the right
  // dimensions.
  const url = fileUrl(path) + '?t=' + Date.now();
  const filename = (path || '').split(/[\\/]/).pop() || 'image';
  const probe = new Image();
  probe.onload = () => {
    openImageOverlay(url, filename, probe.naturalWidth, probe.naturalHeight, path);
  };
  probe.onerror = () => {
    openImageOverlay(url, filename, 0, 0, path);
  };
  probe.src = url;
}

// Phase 3 Block 6: escapeHtml() ist schon in DomHelpers.js
// verfügbar. Drop-in-Alias unten.
var { escapeHtml } = window;

window.MusicTab = window.TABS.music;
