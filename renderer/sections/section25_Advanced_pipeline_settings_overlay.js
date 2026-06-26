// renderer/sections/section25_Advanced_pipeline_settings_overlay.js
// v1.1 (research-driven): a small modal that exposes the
// library-level parameters the special features (Real-ESRGAN
// upscaler, IS-Net background remover, Sharp image optimiser,
// ffmpeg audio cutter) actually accept. The Settings → Image
// pane has an "Advanced pipeline settings…" button that opens
// this overlay so the user can tune the knobs without the rest
// of the settings dialog getting crowded.
//
// Why an overlay instead of inline rows:
//   The Image pane already carries Real-ESRGAN status / model /
//   install + the add-ons link. Adding 15+ more rows for the
//   advanced parameters would push the frequently-used controls
//   below the fold. The overlay keeps the pane scannable while
//   still letting power users reach every knob the underlying
//   library supports.
//
// What's exposed (per the web research on each library's CLI /
// API surface — see evaluation doc for the rationale):
//
//   Real-ESRGAN ncnn-vulkan (BSD-3-Clause upstream):
//     • Tile size (-t): smaller tiles use less VRAM, useful for
//       low-end GPUs on large images. 0 = auto (the binary's
//       default, optimal for most setups).
//     • TTA mode (-x): test-time augmentation. Noticeably better
//       quality at ~2× runtime cost. Off by default.
//     • GPU device id (-g): for multi-GPU systems. 'auto' lets
//       the binary pick.
//
//   IS-Net (Node.js backend via onnxruntime-node):
//     • intra-op thread count: only honoured by the CPU execution
//       provider. 0 = let onnxruntime pick.
//     • inter-op thread count: same.
//     • Execution mode: 'sequential' (default) or 'parallel'.
//   The external isnetbg.exe binary (the C# reference) only
//   accepts --use-gpu, so these knobs are Node-backend-only —
//   the overlay shows a hint when the binary backend is active.
//
//   Sharp / libvips (image optimiser):
//     • JPEG chroma subsampling: '4:2:0' (default, smaller) or
//       '4:4:4' (max colour fidelity, ~30% larger).
//     • JPEG mozjpeg: trellis quantisation + overshoot deringing
//       + optimised scans. On by default; turning it off is faster.
//     • PNG compression level (1-9): default 9 (smallest). Lower
//       levels are faster but produce larger files.
//     • PNG palette: quantise to an indexed palette. On by default.
//     • WebP mode: 'lossy' (default, smallest) | 'lossless'
//       (best for screenshots / line art) | 'nearLossless'.
//     • WebP effort (0-6): higher = smaller files at slower encode.
//     • AVIF effort (0-9): higher = smaller files at slower encode.
//     • AVIF chroma subsampling: '4:4:4' (default) or '4:2:0'.
//
//   ffmpeg audio cutter:
//     • Silence threshold (dB): amplitudes below this count as
//       "silent" during auto-trim. Default -50 dB.
//     • Min silence (ms): a run must be this long to be trimmed.
//       Default 50 ms.
//     • MP3 quality (-q:a): 0 (highest) to 9. Default 2.
//     • Ogg/Vorbis quality (-q:a): 0 to 10. Default 6.
//     • Opus bitrate: default 128k.
//     • M4A/AAC bitrate: default 192k.

function openAdvancedPipelineSettings() {
  // Defensive defaults: if state.pipelineAdvancedSettings is
  // missing entirely (e.g. an old state.json from before this
  // feature shipped), seed it with the documented defaults so
  // the dropdowns show a sensible initial value instead of
  // "undefined". The seed mirrors src/state.js' default block.
  if (!state.pipelineAdvancedSettings || typeof state.pipelineAdvancedSettings !== 'object') {
    state.pipelineAdvancedSettings = {
      realesrgan: { tileSize: 0, ttaMode: false, gpuId: 'auto' },
      isnetbg: { intraOpNumThreads: 0, interOpNumThreads: 0, executionMode: 'sequential' },
      optimize: {
        jpegChromaSubsampling: '4:2:0', jpegMozjpeg: true,
        pngCompressionLevel: 9, pngPalette: true,
        webpMode: 'lossy', webpEffort: 6,
        avifEffort: 9, avifChromaSubsampling: '4:4:4',
      },
      audio: {
        silenceThresholdDb: -50, minSilenceMs: 50,
        mp3Quality: 2, oggQuality: 6, opusBitrate: '128k', m4aBitrate: '192k',
      },
    };
  }
  const s = state.pipelineAdvancedSettings;
  // v1.1 (audit L3): snapshot the state on open so Cancel can restore
  // it. Pre-v1.1, change handlers mutated state in-place immediately
  // (so the changes took effect for the next run even if the user
  // clicked Cancel — confusing "Cancel" semantics). We deep-clone
  // here, and the Cancel button restores the clone before closing.
  const snapshot = JSON.parse(JSON.stringify(s));
  // Backfill any missing sub-key (defence against a partially-
  // migrated state.json from an early v1.1 build).
  if (!s.realesrgan) s.realesrgan = { tileSize: 0, ttaMode: false, gpuId: 'auto' };
  if (!s.isnetbg) s.isnetbg = { intraOpNumThreads: 0, interOpNumThreads: 0, executionMode: 'sequential' };
  if (!s.optimize) s.optimize = {
    jpegChromaSubsampling: '4:2:0', jpegMozjpeg: true, pngCompressionLevel: 9, pngPalette: true,
    webpMode: 'lossy', webpEffort: 6, avifEffort: 9, avifChromaSubsampling: '4:4:4',
  };
  if (!s.audio) s.audio = {
    silenceThresholdDb: -50, minSilenceMs: 50, mp3Quality: 2, oggQuality: 6, opusBitrate: '128k', m4aBitrate: '192k',
  };

  showModal((m, close) => {
    m.classList.add('advanced-pipeline-modal');

    m.appendChild(el('h2', {}, '🔧 Advanced pipeline settings'));
    m.appendChild(el('p', { style: 'color: var(--fg-2); font-size: 12px; margin-top: 0;' },
      'Low-level parameters for the upscaler, background remover, image optimiser, and audio cutter. The defaults match the previous hard-coded behaviour — change them only if you have a specific reason (a slow GPU, a need for lossless screenshots, a preferred MP3 quality, etc.). Hover any label for a one-line hint.'));

    // v1.1 (lint SIZE): selRow / cbRow / numRow / sectionTitle are
    // extracted into `section25_Advanced_pipeline_settings_helpers.js`
    // so this file stays under the 500-line HARD limit. The helpers
    // are pure DOM builders (no state coupling, no IPC) and read the
    // shared `el` + `toast` globals.
    const { selRow, cbRow, numRow, sectionTitle } = window.Section25Helpers;

    // ==========================================================
    // Section 1: Real-ESRGAN upscaler
    // ==========================================================
    m.appendChild(sectionTitle('🔍', 'Real-ESRGAN upscaler',
      'CLI flags forwarded to the realesrgan-ncnn-vulkan binary. Ignored when the binary is not installed (the built-in Canvas pipeline takes over).'));

    m.appendChild(selRow(
      'Tile size',
      'Smaller tiles fit on lower-VRAM GPUs (a 4K image at tile=128 can run on 2 GB). 0 = auto — the binary picks based on the image size and your GPU. Increase only if you see GPU OOM errors. Pick "Custom…" to enter a value not listed — must be 32–4096 (the binary rejects anything below 32; pick "0 — auto" to let it decide).',
      s.realesrgan.tileSize,
      [
        [0, '0 — auto (default, recommended)'],
        [128, '128 — smallest VRAM (slowest)'],
        [256, '256 — low VRAM'],
        [512, '512 — moderate VRAM'],
        [1024, '1024 — high VRAM (faster)'],
        [2048, '2048 — max VRAM (fastest on big GPUs)'],
      ],
      (v) => { s.realesrgan.tileSize = Number(v); },
      // v1.1.2 (BUG-C from _temp12.md): the binary rejects a tile size
      // below 32, so the custom input floor is 32 (the "0 — auto"
      // preset above still covers the let-the-binary-decide case).
      { kind: 'number', min: 32, max: 4096, step: 1 },
    ));

    m.appendChild(cbRow(
      'TTA mode (test-time augmentation)',
      'Boosts output quality at the cost of roughly 2× runtime. Recommended only for final-quality renders where speed is not a concern.',
      s.realesrgan.ttaMode,
      (v) => { s.realesrgan.ttaMode = v; },
    ));

    m.appendChild(selRow(
      'GPU device id',
      'For systems with more than one GPU. "auto" lets the binary pick the first available device. Pick "Custom…" to enter a different device id, 0–15 (e.g. 4 for a 5th GPU). An id that does not exist on your machine falls back to the built-in upscaler.',
      s.realesrgan.gpuId,
      [
        ['auto', 'auto — let the binary pick (default)'],
        ['0', '0 — first GPU'],
        ['1', '1 — second GPU'],
        ['2', '2 — third GPU'],
        ['3', '3 — fourth GPU'],
      ],
      (v) => { s.realesrgan.gpuId = v; },
      // v1.1.2 (BUG-C from _temp12.md): constrain the custom id to the
      // same [0, 15] range the state layer + wrapper now accept, so the
      // overlay can no longer offer a value that is silently discarded.
      { kind: 'string', pattern: '^(auto|[0-9]|1[0-5])$' },
    ));

    // ==========================================================
    // Section 2: IS-Net background remover
    // ==========================================================
    m.appendChild(sectionTitle('✨', 'IS-Net background remover',
      'Session options forwarded to the Node.js onnxruntime-node backend. The external isnetbg.exe binary only accepts --use-gpu, so these knobs are ignored when the C# binary is the active backend.'));

    m.appendChild(numRow(
      'intra-op threads (CPU only)',
      'Number of threads used WITHIN each onnxruntime operator. Only honoured by the CPU execution provider. 0 = let onnxruntime pick (recommended unless you want to pin CPU usage).',
      s.isnetbg.intraOpNumThreads, 0, 64, 1,
      (v) => { s.isnetbg.intraOpNumThreads = v; },
    ));

    m.appendChild(numRow(
      'inter-op threads (CPU only)',
      'Number of threads used BETWEEN independent operators. Only honoured by the CPU execution provider. 0 = let onnxruntime pick.',
      s.isnetbg.interOpNumThreads, 0, 64, 1,
      (v) => { s.isnetbg.interOpNumThreads = v; },
    ));

    m.appendChild(selRow(
      'Execution mode',
      'Parallel runs independent operators concurrently — usually faster on multi-core CPUs, slightly higher memory.',
      s.isnetbg.executionMode,
      [
        ['sequential', 'sequential (default, lower memory)'],
        ['parallel', 'parallel (faster on multi-core CPUs)'],
      ],
      (v) => { s.isnetbg.executionMode = v; },
    ));

    // ==========================================================
    // Section 3: Image optimiser (Sharp / libvips)
    // ==========================================================
    m.appendChild(sectionTitle('🗜', 'Image optimiser (Sharp)',
      'Per-format encoder knobs forwarded to the Sharp / libvips pipeline. Only the knobs relevant to the active output format are applied — the rest are ignored.'));

    m.appendChild(selRow(
      'JPEG chroma subsampling',
      '4:2:0 (default) trades colour fidelity for ~30% smaller files. 4:4:4 keeps full colour resolution — recommended for images with text or sharp colour transitions.',
      s.optimize.jpegChromaSubsampling,
      [
        ['4:2:0', "4:2:0 — default, smaller files"],
        ['4:4:4', "4:4:4 — full colour, ~30% larger"],
      ],
      (v) => { s.optimize.jpegChromaSubsampling = v; },
    ));

    m.appendChild(cbRow(
      'JPEG mozjpeg (trellis quantisation)',
      'On by default. Combines trellis quantisation + overshoot deringing + optimised progressive scans for ~10% smaller files at the same quality. Turn off for the fastest possible encode.',
      s.optimize.jpegMozjpeg,
      (v) => { s.optimize.jpegMozjpeg = v; },
    ));

    m.appendChild(numRow(
      'PNG compression level (1-9)',
      ' zlib compression level. 9 (default) = smallest file, slowest encode. Lower levels are faster but produce larger files.',
      s.optimize.pngCompressionLevel, 1, 9, 1,
      (v) => { s.optimize.pngCompressionLevel = v; },
    ));

    m.appendChild(cbRow(
      'PNG palette quantisation',
      'On by default. Quantises the image to an indexed palette — much smaller files for logos / illustrations / flat-colour art. Turn off for true-colour photographic output.',
      s.optimize.pngPalette,
      (v) => { s.optimize.pngPalette = v; },
    ));

    m.appendChild(selRow(
      'WebP mode',
      'lossy (default) = smallest files for photos. lossless = best for screenshots, line art, and images with very few colours. nearLossless = a configurable middle ground.',
      s.optimize.webpMode,
      [
        ['lossy', 'lossy — default, smallest for photos'],
        ['lossless', 'lossless — best for screenshots / line art'],
        ['nearLossless', 'near-lossless — middle ground'],
      ],
      (v) => { s.optimize.webpMode = v; },
    ));

    m.appendChild(numRow(
      'WebP effort (0-6)',
      'Higher effort = smaller files at slower encode. 6 is the libwebp default.',
      s.optimize.webpEffort, 0, 6, 1,
      (v) => { s.optimize.webpEffort = v; },
    ));

    m.appendChild(numRow(
      'AVIF effort (0-9)',
      'Higher effort = smaller files at slower encode. 9 is the slowest/most thorough. AVIF encodes are CPU-heavy — drop to 4 if you optimise many images per session.',
      s.optimize.avifEffort, 0, 9, 1,
      (v) => { s.optimize.avifEffort = v; },
    ));

    m.appendChild(selRow(
      'AVIF chroma subsampling',
      '4:4:4 (default) keeps full colour. 4:2:0 saves ~20% on photographic content at the cost of colour detail.',
      s.optimize.avifChromaSubsampling,
      [
        ['4:4:4', '4:4:4 — full colour (default)'],
        ['4:2:0', '4:2:0 — smaller, less colour detail'],
      ],
      (v) => { s.optimize.avifChromaSubsampling = v; },
    ));

    // ==========================================================
    // Section 4: ffmpeg audio cutter
    // ==========================================================
    m.appendChild(sectionTitle('✂', 'Audio cutter (ffmpeg)',
      'Knobs for the right-click "✂ Audio cut…" modal and the bulk "✂ Trim" action. The silence-detection values are used by the auto-trim button; the codec quality values are applied on export.'));

    m.appendChild(numRow(
      'Silence threshold (dB, -100..0)',
      'Amplitudes below this count as "silent" during auto-trim. -50 dB (default) matches a typical quiet room. Lower (e.g. -60) = only very quiet samples count as silence.',
      s.audio.silenceThresholdDb, -100, 0, 1,
      (v) => { s.audio.silenceThresholdDb = v; },
    ));

    m.appendChild(numRow(
      'Min silence (ms, 0..10000)',
      'How long a run of silent samples must be before auto-trim removes it. 50 ms (default) filters out brief gaps between words without trimming legitimate pauses.',
      s.audio.minSilenceMs, 0, 10000, 10,
      (v) => { s.audio.minSilenceMs = v; },
    ));

    m.appendChild(numRow(
      'MP3 quality (0=high .. 9=low)',
      'Passed to ffmpeg -q:a for the libmp3lame encoder. 2 (default) is a transparent sweet spot. 0 = highest quality, 9 = smallest file.',
      s.audio.mp3Quality, 0, 9, 1,
      (v) => { s.audio.mp3Quality = v; },
    ));

    m.appendChild(numRow(
      'Ogg/Vorbis quality (0..10)',
      'Passed to ffmpeg -q:a for libvorbis. 6 (default) ≈ 192 kbps for stereo.',
      s.audio.oggQuality, 0, 10, 1,
      (v) => { s.audio.oggQuality = v; },
    ));

    m.appendChild(selRow(
      'Opus bitrate',
      'Passed to ffmpeg -b:a for libopus. 128k (default) is transparent for stereo music. Pick "Custom…" to enter a different bitrate (e.g. 320k).',
      s.audio.opusBitrate,
      [
        ['64k',  '64k  — speech / low-bitrate'],
        ['96k',  '96k  — high-quality speech / low-bitrate music'],
        ['128k', '128k — default, transparent for stereo music'],
        ['160k', '160k — high quality'],
        ['192k', '192k — max recommended for stereo'],
        ['256k', '256k — archival / multi-channel'],
      ],
      (v) => { s.audio.opusBitrate = v; },
      { kind: 'string', pattern: '^\\d+k$' },
    ));

    m.appendChild(selRow(
      'M4A / AAC bitrate',
      'Passed to ffmpeg -b:a for the native AAC encoder. 192k (default) is high quality for stereo music. Pick "Custom…" to enter a different bitrate.',
      s.audio.m4aBitrate,
      [
        ['96k',  '96k  — low-bitrate'],
        ['128k', '128k — medium'],
        ['160k', '160k — good'],
        ['192k', '192k — default, high quality'],
        ['256k', '256k — very high quality'],
        ['320k', '320k — max quality'],
      ],
      (v) => { s.audio.m4aBitrate = v; },
      { kind: 'string', pattern: '^\\d+k$' },
    ));

    // ==========================================================
    // Footer: Reset / Cancel / Save
    // ==========================================================
    const saveBtn = el('button', { class: 'primary' }, 'Save');
    const resetBtn = el('button', { class: 'btn-mini', title: 'Reset every knob on this overlay to its default. The state is saved immediately.' }, '↺ Reset to defaults');
    // v1.1 (audit L3): Cancel restores the snapshot so the user's
    // changes do NOT leak into the next run if they back out.
    const cancelBtn = el('button', {}, 'Cancel');
    cancelBtn.addEventListener('click', () => {
      state.pipelineAdvancedSettings = snapshot;
      close();
    });

    saveBtn.addEventListener('click', async () => {
      // The change handlers above mutate state.pipelineAdvancedSettings
      // in-place, so all we need to do here is persist + close.
      // scheduleStateSave is debounced — the user sees "Saved."
      // immediately even if the disk write is still queued.
      try { await scheduleStateSave(); } catch (_) {}
      if (typeof toast === 'function') toast('Advanced pipeline settings saved.', 'ok', 2000);
      close();
    });

    resetBtn.addEventListener('click', async () => {
      if (!confirm('Reset every advanced pipeline setting to its default? This affects the upscaler, background remover, image optimiser, and audio cutter.')) return;
      state.pipelineAdvancedSettings = {
        realesrgan: { tileSize: 0, ttaMode: false, gpuId: 'auto' },
        isnetbg: { intraOpNumThreads: 0, interOpNumThreads: 0, executionMode: 'sequential' },
        optimize: {
          jpegChromaSubsampling: '4:2:0', jpegMozjpeg: true,
          pngCompressionLevel: 9, pngPalette: true,
          webpMode: 'lossy', webpEffort: 6,
          avifEffort: 9, avifChromaSubsampling: '4:4:4',
        },
        audio: {
          silenceThresholdDb: -50, minSilenceMs: 50,
          mp3Quality: 2, oggQuality: 6, opusBitrate: '128k', m4aBitrate: '192k',
        },
      };
      // v1.1 (audit L2): await the save (Save does too) so the user
      // sees "Reset to defaults." only after the disk write queued.
      try { await scheduleStateSave(); } catch (_) {}
      if (typeof toast === 'function') toast('Advanced settings reset to defaults.', 'ok', 2000);
      close();
    });

    m.appendChild(el('div', { class: 'footer settings-footer', style: 'margin-top: 16px;' }, [resetBtn, cancelBtn, saveBtn]));
  }, { id: 'advanced-pipeline-settings' });
}
