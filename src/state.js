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

function read() {
  const p = statePath();
  if (!fs.existsSync(p)) return { tabs: {} };
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!raw || typeof raw !== 'object') return { tabs: {} };
    if (!raw.tabs) raw.tabs = {};
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
    //   'once-fresh'   — default. Show each popup until the user
    //                    dismisses it; then never show it again
    //                    (across restarts).
    //   'per-session'  — Show each popup the first time it's
    //                    triggered after each app start; reset on
    //                    every launch.
    //   'never'        — Never show these popups.
    //   'always'       — Always show these popups (ignoring any
    //                    prior dismissal).
    // Whitelisted so a corrupted state.json can't inject an
    // arbitrary value.
    popupPolicy: ['once-fresh', 'per-session', 'never', 'always'].includes(s?.popupPolicy)
      ? s.popupPolicy
      : 'once-fresh',
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
  };
  // Phase C: enforce the L2 cap and move the overflow to L3
  // (the JSONL archive). The move is best-effort: a failing
  // archive write (disk full, permission error) does NOT block
  // the main state save — we still persist the trimmed L2
  // list. The trimmed entries are lost from L2 but the
  // user-visible "the file was saved" toast is honest.
  if (Array.isArray(clean.jobsSnapshot) && clean.jobsSnapshot.length > clean.jobsArchiveCap) {
    fs.appendFileSync(require('os').tmpdir() + '/state-trace.log',
      'TRIM: ' + clean.jobsSnapshot.length + ' cap=' + clean.jobsArchiveCap + ' dir=' + configDir() + '\n');
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

module.exports = { read, write, statePath };
