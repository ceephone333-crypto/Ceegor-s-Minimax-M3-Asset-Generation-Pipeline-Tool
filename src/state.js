// src/state.js
// Per-tab UI state autosave. Persists all form values across all 4 tabs
// to state.json next to config.txt.
const fs = require('fs');
const path = require('path');
// Bug-fix #6 (2026-06-19): route through configDir() so state.json
// honours MINIMAX_CONFIG_DIR and the exe/cwd fallback chain the
// same way config.txt does. Previously state.json always landed
// next to the exe (or cwd if no electron app), which split storage
// when a launcher set the override.
const { configDir } = require('./config');
// Phase C: append-only archive for trimmed L2 entries. We require it
// lazily so this file remains usable from unit tests that don't have
// the ArchiveService on the classpath (the test harness uses a stub).
let _archiveService = null;
function _archive() {
  if (_archiveService) return _archiveService;
  try {
    // eslint-disable-next-line global-require
    _archiveService = require('./services/ArchiveService');
  } catch (_) {
    _archiveService = null;
  }
  return _archiveService;
}

function statePath() {
  return path.join(configDir(), 'state.json');
}

// v1.1 (audit AUDIT-01 + AUDIT-05): the pipelineAdvancedSettings
// sanitiser. Extracted from the inline write() expression so the
// same logic runs on BOTH the write path and the read path
// (hand-edited state.json / a future writer that bypasses
// sanitisation). Also fixes the AUDIT-01 falsy-fallback bug:
// `Math.round(Number(x)) || <default>` rejected 0 for the seven
// zero-valid fields (mp3Quality 0 = highest quality, webpEffort 0
// = fastest, pngCompressionLevel 0 = fastest, etc.). The new
// helper uses `Number.isFinite(n = Number(x)) ? Math.round(n) :
// <default>` so 0 is accepted as long as it is in range.
function sanitisePipelineAdvancedSettings(input) {
  if (!input || typeof input !== 'object') {
    return {
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
  // Parse a number from any input, returning `fallback` when the
  // result is non-finite OR outside [min, max]. Unlike the old
  // `Number(x) || default` (AUDIT-01), this accepts an explicit 0.
  // null / undefined / '' are treated as "missing" → fallback (so a
  // hand-edited `mp3Quality: null` keeps the documented default).
  function nOr(value, min, max, fallback) {
    if (value == null || value === '') return fallback;
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    const r = Math.round(n);
    if (r < min || r > max) return fallback;
    return r;
  }
  const r = input.realesrgan && typeof input.realesrgan === 'object' ? input.realesrgan : {};
  const i = input.isnetbg && typeof input.isnetbg === 'object' ? input.isnetbg : {};
  const o = input.optimize && typeof input.optimize === 'object' ? input.optimize : {};
  const a = input.audio && typeof input.audio === 'object' ? input.audio : {};
  // v1.1 (audit AUDIT-07): opusBitrate / m4aBitrate whitelist. The
  // overlay only offers the renderer's documented set, so accepting
  // any `/^\d+k$/` value lets a corrupted write sneak in 500k (or
  // 1k, 9999k) which the AudioCutter would happily forward to
  // ffmpeg. We narrow the regex to the union of the overlay's
  // options to keep the persisted value in lock-step with what the
  // UI can re-select.
  const ALLOWED_OPUS_BITRATES = ['64k', '96k', '128k', '160k', '192k', '256k'];
  const ALLOWED_M4A_BITRATES = ['96k', '128k', '160k', '192k', '256k', '320k'];
  return {
    realesrgan: {
      // v1.1.2 (BUG-C, _temp12.md): valid tile set is {0=auto} ∪ [32,4096]
      // (the binary rejects <32); 1..31 / out-of-range → 0 (auto).
      tileSize: (() => { const t = nOr(r.tileSize, 0, 4096, 0); return (t === 0 || (t >= 32 && t <= 4096)) ? t : 0; })(),
      ttaMode: r.ttaMode === true,
      // v1.1.2 (BUG-C, _temp12.md): GPU id whitelist widened to [0,15]
      // (was [0,3]) so multi-GPU rigs can pin a real device; else 'auto'.
      gpuId: (r.gpuId === 'auto' || (/^\d+$/.test(String(r.gpuId)) && Number(r.gpuId) >= 0 && Number(r.gpuId) <= 15)) ? String(r.gpuId) : 'auto',
    },
    isnetbg: {
      intraOpNumThreads: nOr(i.intraOpNumThreads, 0, 64, 0),
      interOpNumThreads: nOr(i.interOpNumThreads, 0, 64, 0),
      executionMode: ['sequential', 'parallel'].includes(i.executionMode) ? i.executionMode : 'sequential',
    },
    optimize: {
      jpegChromaSubsampling: ['4:2:0', '4:4:4'].includes(o.jpegChromaSubsampling) ? o.jpegChromaSubsampling : '4:2:0',
      jpegMozjpeg: o.jpegMozjpeg !== false,
      pngCompressionLevel: nOr(o.pngCompressionLevel, 0, 9, 9),
      pngPalette: o.pngPalette !== false,
      webpMode: ['lossy', 'lossless', 'nearLossless'].includes(o.webpMode) ? o.webpMode : 'lossy',
      webpEffort: nOr(o.webpEffort, 0, 6, 6),
      avifEffort: nOr(o.avifEffort, 0, 9, 9),
      avifChromaSubsampling: ['4:4:4', '4:2:0'].includes(o.avifChromaSubsampling) ? o.avifChromaSubsampling : '4:4:4',
    },
    audio: {
      silenceThresholdDb: nOr(a.silenceThresholdDb, -100, 0, -50),
      minSilenceMs: nOr(a.minSilenceMs, 0, 10000, 50),
      mp3Quality: nOr(a.mp3Quality, 0, 9, 2),
      oggQuality: nOr(a.oggQuality, 0, 10, 6),
      opusBitrate: ALLOWED_OPUS_BITRATES.includes(a.opusBitrate) ? a.opusBitrate : '128k',
      m4aBitrate: ALLOWED_M4A_BITRATES.includes(a.m4aBitrate) ? a.m4aBitrate : '192k',
    },
  };
}

// v1.1.23: legacy popupPolicy migration. Pre-v1.1.18 default was
// 'once-fresh' which fires every gated popup until dismissed.
// Users who upgraded in-place from v1.1.0 still have
// `popupPolicy: 'once-fresh'` + empty `seenPopups` in their
// state.json, so the v1.1.18 'default off' change had no effect
// for them. Applied on BOTH read and write so the very first
// launch of v1.1.23+ resolves a legacy 'once-fresh' to 'never'
// immediately (write-side alone wouldn't trigger until first save).
const WL_POPUP = ['once-fresh', 'per-session', 'never', 'always'];
function _migrateLegacyPopupPolicy(raw) {
  const ls = (typeof raw?.lastSeenVersion === 'string') ? raw.lastSeenVersion : '';
  const persisted = WL_POPUP.includes(raw?.popupPolicy) ? raw.popupPolicy : 'never';
  const legacy = raw?.popupPolicy === 'once-fresh' && (!ls || ls < '1.1.18');
  raw.popupPolicy = legacy ? 'never' : persisted;
}

function read() {
  const p = statePath();
  if (!fs.existsSync(p)) return { tabs: {} };
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!raw || typeof raw !== 'object') return { tabs: {} };
    if (!raw.tabs) raw.tabs = {};
    _migrateLegacyPopupPolicy(raw);
    // Phase C: clamp the L2 cap on read so a corrupted state.json
    // (e.g. `jobsArchiveCap: 5000`) never lands in the renderer.
    // We clamp on read AND on write — the write-side clamp is the
    // authoritative one (it gets persisted), the read-side clamp
    // is defensive in case a future writer skips the clamp.
    //
    // Any invalid value (negative, zero, NaN, non-numeric, out of
    // range) falls back to the default (200). The clamp [20, 1000]
    // is a separate defensive layer.
    if (raw.jobsArchiveCap != null) {
      const n = Number(raw.jobsArchiveCap);
      if (Number.isFinite(n) && n > 0) {
        raw.jobsArchiveCap = Math.max(20, Math.min(1000, Math.round(n)));
      } else {
        raw.jobsArchiveCap = 200;
      }
    }
    // v1.1 (audit AUDIT-05): read-side sanitisation of
    // pipelineAdvancedSettings. Without this, a hand-edited state.json
    // (or a future writer that bypasses the write-side sanitiser)
    // can land bogus values in the renderer (e.g. tileSize=99999
    // would silently become the binary's default, OR a future bug
    // would crash a write). We use the SAME sanitise helper as
    // write() so the two paths can never drift.
    if (raw.pipelineAdvancedSettings && typeof raw.pipelineAdvancedSettings === 'object') {
      raw.pipelineAdvancedSettings = sanitisePipelineAdvancedSettings(raw.pipelineAdvancedSettings);
    }
    // v1.1.23 (reported by user — "we still see lots of popups,
    // even though they are turned off"): the write-side migration
    // alone is not enough — it only takes effect after the user
    // triggers a save (which the very first launch of v1.1.23
    // does not, because the renderer reads the on-disk value
    // BEFORE anything saves). Apply the same migration on read so
    // a legacy 'once-fresh' from a pre-v1.1.18 install is
    // downgraded to 'never' immediately, on the first launch.
    _migrateLegacyPopupPolicy(raw);
    return raw;
  } catch {
    return { tabs: {} };
  }
}

function write(s) {
  const p = statePath();
  // Preserve everything: tabs (per-tab form values), currentTab (last active
  // tab), fbDirs (per-tab output folder), and the upscale-on-Generate
  // toggle + settings. The previous version only persisted `tabs`, which
  // silently dropped the per-tab folder map and the last-active-tab on
  // every save.
  // v1.1.23: run the shared migration helper here too (mutates
  // s.popupPolicy in place) so the on-disk value is resolved on
  // first save. read() applies the same migration so the very
  // first launch of v1.1.23 already sees the resolved value.
  _migrateLegacyPopupPolicy(s);
  const clean = {
    tabs: (s && s.tabs && typeof s.tabs === 'object') ? s.tabs : {},
    currentTab: (s && typeof s.currentTab === 'string') ? s.currentTab : null,
    fbDirs: (s && s.fbDirs && typeof s.fbDirs === 'object') ? s.fbDirs : {},
    upscaleEnabled: !!(s && s.upscaleEnabled),
    // The upscale settings now include the auto-crop options. They're
    // surfaced in ⚙ Settings → Upscale Settings, captured by the
    // Image tab's "Add" button into the batch queue, and applied
    // by the image tab's generate handler when state.upscaleEnabled
    // is on. The renderer whitelists cropAnchorX/Y against the
    // anchor cell values; we double-check here too in case a
    // corrupted state.json tries to sneak an arbitrary string
    // through.
    upscaleSettings: (s && s.upscaleSettings && typeof s.upscaleSettings === 'object')
      ? {
          multiplier: parseInt(s.upscaleSettings.multiplier, 10) || 2,
          autoCrop: !!(s.upscaleSettings.autoCrop),
          cropWidth: Math.max(0, parseInt(s.upscaleSettings.cropWidth, 10) || 0),
          cropHeight: Math.max(0, parseInt(s.upscaleSettings.cropHeight, 10) || 0),
          cropAnchorX: ['left', 'center', 'right'].includes(s.upscaleSettings.cropAnchorX)
            ? s.upscaleSettings.cropAnchorX : 'center',
          cropAnchorY: ['top', 'center', 'bottom'].includes(s.upscaleSettings.cropAnchorY)
            ? s.upscaleSettings.cropAnchorY : 'center',
        }
      : { multiplier: 2, autoCrop: false, cropWidth: 0, cropHeight: 0, cropAnchorX: 'center', cropAnchorY: 'center' },
    // Real-ESRGAN model name (default: the general-purpose 4× BSD-3
    // model). Whitelisted in app.js to a known set so a corrupted
    // state.json can't inject a path-traversal arg into the spawn.
    realesrganModel: (typeof s?.realesrganModel === 'string' && s.realesrganModel.trim())
      ? s.realesrganModel.trim().slice(0, 64)
      : 'realesrgan-x4plus',
    // IS-Net background removal toggle. When true, the image tab's
    // generation handler and the right-click "Upscale" dialog will
    // run the optional isnetbg binary on the output. The standalone
    // right-click "Remove background" action does NOT depend on this
    // flag — it's an explicit user gesture every time.
    removeBackgroundEnabled: !!(s && s.removeBackgroundEnabled),
    // True = ask the binary to use the GPU (DirectML / CUDA / Vulkan,
    // whatever the binary supports); false = CPU. We coerce to a
    // boolean so a corrupted state.json can't sneak a string that
    // would be passed to --use-gpu as-is.
    removeBackgroundUseGpu: s?.removeBackgroundUseGpu === false ? false : true,
    // Global "Target file prefix" — prepended to every generated file's
    // name on all four tabs. Capped at 64 chars so a corrupted state.json
    // can't inject a long prefix. The renderer mirrors this string into
    // four inputs (one per tab) on every change. Without this field, the
    // user's prefix silently reset to "" on every app restart.
    filePrefix: (typeof s?.filePrefix === 'string')
      ? s.filePrefix.slice(0, 64)
      : '',
    // v1.1.15 (reported by user): when true, every generated
    // file is named only `<prefix><6-digit number>.<ext>`.
    // The "6-digit number, starting at 000001" is the user's
    // spec; the counter is per-run, NOT per-prefix, so a user
    // who switches from "temp" to "out" gets `out000001.jpg`,
    // not `out000006.jpg`. Default: false (legacy slugified
    // filenames).
    filePrefixForceOnly: s?.filePrefixForceOnly === true,
    // First-run prompt for the optional Real-ESRGAN binary. The
    // built-in multi-step canvas pipeline is always available, so the
    // prompt is informational only — but if the user dismisses it
    // once, we honour that and don't re-ask on every launch. Stored
    // here so the dismissal survives restarts.
    realesrganFirstRunDismissed: s?.realesrganFirstRunDismissed === true,
    // Image optimisation settings (post-generation pipeline +
    // folder-browser right-click menu). Persisted across launches
    // so the user only has to pick their preferred quality /
    // format / metadata policy once.
    //
    //   enabled:        master toggle for the post-generation flow
    //                   (the right-click menu ignores this and
    //                   always shows the dialog).
    //   quality:        1..100, the Sharp quality slider. We
    //                   hard-clamp to [1,100] here so a corrupted
    //                   state.json can't inject a 0 or a
    //                   negative number that would otherwise be
    //                   silently passed to libvips.
    //   format:         'keep' (preserve source format) | 'jpeg'
    //                   | 'png' | 'webp' | 'avif'. Whitelisted
    //                   against the same set the Sharp wrapper
    //                   accepts.
    //   stripMetadata:  drop non-essential EXIF (camera model,
    //                   GPS, software tag, etc.) but keep the
    //                   ICC colour profile so the image still
    //                   renders correctly on colour-managed
    //                   displays. The renderer passes this
    //                   through to window.api.optimizeImage
    //                   unchanged.
    optimizeSettings: (s && s.optimizeSettings && typeof s.optimizeSettings === 'object')
      ? {
          enabled: !!s.optimizeSettings.enabled,
          quality: Math.max(1, Math.min(100, Math.round(Number(s.optimizeSettings.quality) || 82))),
          format: ['keep', 'jpeg', 'png', 'webp', 'avif'].includes(s.optimizeSettings.format)
            ? s.optimizeSettings.format
            : 'keep',
          stripMetadata: s.optimizeSettings.stripMetadata !== false,
        }
      : { enabled: false, quality: 82, format: 'keep', stripMetadata: true },
    // Layout / splitter sizes for the 4 main areas (content,
    // folder browser, log, picture preview). All four are
    // pixel values; the JS drag handler clamps them to a
    // sensible range (matching the CSS min/max in
    // styles.css) before writing here, so a corrupted
    // state.json with a -1 or 999999 can never break the
    // layout. Defaults here mirror the CSS `:root` block
    // (sidebar 360px, logbar 280px, preview 360px) so a
    // fresh install opens with the same sizes the CSS
    // expects. Persisted across restarts so the user only
    // has to set their preferred column widths once.
    layoutSettings: (s && s.layoutSettings && typeof s.layoutSettings === 'object')
      ? {
          sidebarW: Math.max(180, Math.min(2000, Math.round(Number(s.layoutSettings.sidebarW) || 360))),
          logbarH:  Math.max(60,  Math.min(2000, Math.round(Number(s.layoutSettings.logbarH)  || 280))),
          previewW: Math.max(160, Math.min(2000, Math.round(Number(s.layoutSettings.previewW) || 360))),
        }
      : { sidebarW: 360, logbarH: 280, previewW: 360 },
    // File-browser sort mode (Name ↑/↓, Size ↑/↓, Newest / Oldest,
    // Created ↑/↓, Type). Whitelisted to the same set the dropdown
    // offers so a corrupted state.json can't inject a value that
    // would later be used in a comparator. The renderer also
    // re-validates on read.
    fbSort: (typeof s?.fbSort === 'string' && [
      'name-asc', 'name-desc',
      'size-desc', 'size-asc',
      'mtime-desc', 'mtime-asc',
      'created-desc', 'created-asc',
      'type-asc',
    ].includes(s.fbSort)) ? s.fbSort : 'name-asc',
    // File-browser column visibility (size, type, mtime, created,
    // path). Object keyed by column id with boolean values. The
    // main process round-trips the object verbatim — the renderer
    // is the source of truth on what columns are valid, so a
    // future column id added in a newer renderer survives the
    // round trip. We only defend against the file being a
    // non-object so a corrupted write can't crash the JSON parse.
    fbColumns: (s && typeof s.fbColumns === 'object' && s.fbColumns !== null)
      ? s.fbColumns
      : { size: true, type: false, mtime: false, created: false, path: false },
    // File-browser image thumbnail toggle. When true, image rows
    // in the folder explorer render a small centered thumbnail
    // of the actual image file (instead of the generic 🖼 icon).
    // Folder rows are unchanged either way. The renderer is the
    // source of truth on which files are images; we just
    // round-trip the boolean here so a corrupted state.json can't
    // sneak a string through.
    fbThumbnails: !!(s && s.fbThumbnails),
    // v1.1.15 (reported by user): the file browser used to
    // show every file in the folder (.exe, .md, .json helpers,
    // etc.) which cluttered the list. Default: false — the
    // renderer filters down to image / audio / video / text
    // assets + folders. The user can opt out via the Folder
    // options dialog to see every file.
    fbShowAllFiles: s?.fbShowAllFiles === true,
    // v1.1.1 polish: the package.json version the user last
    // dismissed the "What's new" toast for. The renderer
    // shows the toast only when the current version is
    // different from this string, so a returning user
    // sees the new changelog once per upgrade and never
    // again. Whitelisted as a plain string with a sane
    // length cap (corrupted write defence).
    lastSeenVersion: (typeof s?.lastSeenVersion === 'string')
      ? s.lastSeenVersion.slice(0, 32)
      : '',
    // Popup display policy. Controls how the optional "first run"
    // / "tab intro" popups behave:
    //   'once-fresh'   — Show each popup until the user dismisses it;
    //                    then never show it again (across restarts).
    //   'per-session'  — Show each popup the first time it's
    //                    triggered after each app start; reset on
    //                    every launch.
    //   'never'        — default. Never show these informational popups
    //                    (welcome / tab-intro / optional add-ons).
    //   'always'       — Always show these popups (ignoring any
    //                    prior dismissal).
    // Bug-fix (reported by user — "make popups off default off"): the
    // default is now 'never' so a fresh install shows none of the
    // informational popups. The required first-time setup (API key +
    // output folder) is NOT one of these — it shows whenever the config
    // is incomplete, independent of this policy (see openFirstTimeSetup).
    // Whitelisted so a corrupted state.json can't inject an
    // arbitrary value. The legacy-default migration is applied at the
    // top of write() (mutates s.popupPolicy in place) AND on read()
    // (mutates raw.popupPolicy in place), so by this point `s.popupPolicy`
    // is already the resolved value.
    popupPolicy: s?.popupPolicy,
    // Map of popup-id → ISO timestamp of when the user dismissed
    // it. Used by the 'once-fresh' policy to decide whether the
    // popup should still fire. Capped to a small set (popups a
    // user has dismissed + a small ring buffer for transient
    // entries) so the file doesn't grow unbounded if the app
    // ever logs a lot of popup ids.
    seenPopups: (s && typeof s.seenPopups === 'object' && s.seenPopups !== null && !Array.isArray(s.seenPopups))
      ? Object.fromEntries(Object.entries(s.seenPopups)
          .filter(([k, v]) => typeof k === 'string' && k.length <= 64 && typeof v === 'string' && v.length <= 32)
          .slice(-64))
      : {},
    // Phase C: L2 list of finished jobs (recent summary). The
    // renderer appends a job summary every time a job finishes.
    // The list is FIFO-capped at `state.config.lastFinishedCap`
    // (default 200, configurable 20..1000 in ⚙ Settings →
    // History). The cap is enforced on every write; trimmed
    // entries are appended to the JSONL archive
    // (state.jobs.archive.jsonl) so the user can search / clear
    // long-term history without bloating state.json. The list is
    // `null` (not `[]`) until the first job finishes — saves a
    // needless empty array in state.json.
    jobsSnapshot: (s && Array.isArray(s.jobsSnapshot) ? s.jobsSnapshot : null),
    // L2 cap. Clamped to [20, 1000] so a corrupted state.json
    // cannot make the cap insanely high.
    jobsArchiveCap: (() => {
      const n = Number(s && s.jobsArchiveCap);
      if (!Number.isFinite(n) || n <= 0) return 200;
      return Math.max(20, Math.min(1000, Math.round(n)));
    })(),
    // Bug-fix B5 (_temp5.md): the four settings below were
    // documented "Persisted to state.json" but were absent from
    // BOTH the renderer's STATE_PERSIST_KEYS and this whitelist,
    // so they silently reset on every restart. Each is sanitised
    // the same way its neighbours are (boolean coercion / string
    // whitelist) so a corrupted state.json can't sneak a bad
    // value through.
    // "Don't save my API key" checkbox state (v1.1.13).
    apiKeyNoSave: s?.apiKeyNoSave === true,
    // File-browser type filter (v1.1.11). Empty string = "All
    // types". Capped at 256 chars (the comma-separated extension
    // list is short in practice) so a corrupted write can't bloat
    // state.json.
    fbTypeFilter: (typeof s?.fbTypeFilter === 'string')
      ? s.fbTypeFilter.slice(0, 256)
      : '',
    // BatchGen "keep completed items" toggle (v1.1.14). Default
    // true matches the original behaviour (the user explicitly
    // asked for auto-remove, so the default IS auto-remove).
    batchesAutoRemove: s?.batchesAutoRemove !== false,
    // BatchGen example-export format (v1.1.13). Whitelisted to
    // the two formats the export button actually emits.
    batchesExportFormat: ['md', 'txt'].includes(s?.batchesExportFormat)
      ? s.batchesExportFormat
      : 'md',
    // v1.1 (advanced pipeline settings overlay): per-feature
    // advanced parameters that the user can tune in ⚙ Settings →
    // Image → "Advanced pipeline settings…". Each sub-object is
    // sanitised independently so a corrupted state.json can't
    // inject an out-of-range number / a non-whitelisted string
    // into a CLI arg or a sharp encoder option. The defaults
    // match the previous hard-coded behaviour so existing flows
    // produce identical output until the user explicitly changes
    // something.
    //
    // v1.1 (audit AUDIT-01 + AUDIT-05): the sanitisation is now
    // delegated to the shared sanitisePipelineAdvancedSettings
    // helper so the read path uses the same logic. The previous
    // inline expression had a `Number(x) || default` falsy-fallback
    // bug that silently rejected 0 (so a user could never select
    // "highest quality mp3", "no filter", or "fastest encode").
    pipelineAdvancedSettings: sanitisePipelineAdvancedSettings(s && s.pipelineAdvancedSettings),
  };
  // Phase C: enforce the L2 cap and move the overflow to L3
  // (the JSONL archive). The move is best-effort: a failing
  // archive write (disk full, permission error) does NOT block
  // the main state save — we still persist the trimmed L2
  // list. The trimmed entries are lost from L2 but the
  // user-visible "the file was saved" toast is honest.
  if (Array.isArray(clean.jobsSnapshot) && clean.jobsSnapshot.length > clean.jobsArchiveCap) {
    // Bug-fix B3 (_temp5.md): removed a leftover debug
    // `fs.appendFileSync(%TEMP%/state-trace.log, ...)` here. It was
    // dormant only while B1 kept jobsSnapshot null, and would have
    // started growing a temp file on every save once B1 was fixed.
    const overflow = clean.jobsSnapshot.slice(0, clean.jobsSnapshot.length - clean.jobsArchiveCap);
    clean.jobsSnapshot = clean.jobsSnapshot.slice(-clean.jobsArchiveCap);
    const archive = _archive();
    if (archive) {
      try {
        for (const entry of overflow) {
          archive.append(configDir(), entry);
        }
      } catch (_) {
        // Best-effort: a failing archive write (disk full,
        // permission error) does NOT block the main state save.
        // The trimmed entries are lost from L2 but the
        // user-visible "the file was saved" toast is honest.
      }
    }
  }
  // Atomic write: write to a temp file then rename. Avoids a corrupt
  // state.json if the process is killed mid-write.
  const tmp = p + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(clean, null, 2), 'utf8');
  try {
    fs.renameSync(tmp, p);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  }
  return clean;
}

module.exports = { read, write, statePath, _migrateLegacyPopupPolicy };
