// renderer/tabs/musicTabA.js (Phase 3 Block 34)
// First half of musicTab.js (form build).

// renderer/tabs/musicTab.js (Phase 3 Block 28)
window.TABS = window.TABS || {};
window.TABS.music = // ----------------- MUSIC TAB -----------------
TABS.music = {
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
    lyricsModeBanner.appendChild(el('div', { class: 'info-banner-title' }, 'ðŸŽ¤ Custom Lyrics mode'));
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
        { value: 'music-2.6', label: 'music-2.6 (newest â€” cover, instrumental, lyrics-optimizer, default)' },
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
      help: 'Music genre tag. Free-text fallback if you pick "Customâ€¦".',
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
      help: 'Mood or emotion. Free-text fallback if you pick "Customâ€¦".',
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
      help: 'Vocal style descriptor. Free-text fallback if you pick "Customâ€¦".',
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
      help: 'Featured instruments. Free-text fallback if you pick "Customâ€¦".',
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
      help: 'Musical key. Free-text fallback if you pick "Customâ€¦".',
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
        { value: 'url', label: 'url (24h expiry â€” download promptly)' },
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
      // Re-entrancy guard: another generation is in progress.
      if (state.generating) return;
      if (!state.config.api_key) { toast('No API key configured. Click ⚙ to open Settings.', 'err'); return; }
      const promptText = buildFinalPrompt(styleRow.sel, prompt.input, extraPrefix());
      if (!promptText) { toast('Prompt is required (style or manual input).', 'warn'); return; }
      // Validate lyrics-mode input once, before looping variants
      if (mode.input.value === 'lyrics') {
        if (!lyricsFile.input.value.trim() && !lyrics.input.value.trim()) {
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
        '--bitrate': audioBitrate.input,
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
      catch (e) { toast('No output directory set. Open Settings.', 'err'); return; }
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
            if (lyricsFile.input.value.trim()) args.push('--lyrics-file', lyricsFile.input.value.trim());
            else if (lyrics.input.value.trim()) args.push('--lyrics', lyrics.input.value.trim());
          }
          appendFlag(args, model.input);
          appendFlag(args, genre.input);
          appendFlag(args, mood.input);
          appendFlag(args, vocals.input);
          appendFlag(args, instruments.input);
