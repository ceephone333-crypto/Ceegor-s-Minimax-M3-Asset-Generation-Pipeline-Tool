// Preload bridge: expose a small, typed API to the renderer
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // ---- app metadata ----
  // Read by the renderer's startup popup to stamp the build
  // version on the greetings screen. Resolved from
  // package.json at runtime so the source of truth stays
  // single (no risk of a stale "1.1.0" string lingering in
  // the renderer after someone bumps the version in
  // package.json).
  getAppVersion: () => ipcRenderer.invoke('app:version'),

  // ---- config ----
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (cfg) => ipcRenderer.invoke('config:set', cfg),
  pickFolder: () => ipcRenderer.invoke('config:pickFolder'),
  configPath: () => ipcRenderer.invoke('config:path'),
  defaultOutputDir: () => ipcRenderer.invoke('config:defaultOutputDir'),

  // ---- mmx ----
  mmxRun: (args) => ipcRenderer.invoke('mmx:run', args),
  // Phase A: job-aware mmx run. The handler attaches every chunk
  // to the jobId so the renderer's LogService routes the line into
  // the right primary log row.
  mmxRunJob: (payload) => ipcRenderer.invoke('mmx:run:job', payload),
  voices: () => ipcRenderer.invoke('mmx:voices'),
  quota: () => ipcRenderer.invoke('mmx:quota'),
  // Phase B: profile returns { ok, concurrentLimit, planType } with
  // a 5-minute main-side cache. Used by the Diagnose modal to show
  // a "your plan allows N concurrent calls" hint.
  mmxProfile: () => ipcRenderer.invoke('mmx:profile'),
  authStatus: () => ipcRenderer.invoke('mmx:authStatus'),
  diagnose: () => ipcRenderer.invoke('mmx:diagnose'),
  // Phase A: mmxCancel accepts an optional { jobId } payload for
  // per-job cancel (Phase B+). With no payload it's the panic
  // button and kills every in-flight proc.
  // Note: we forward `opts` as-is; the legacy `mmxCancel()` (no
  // args) ends up with `args.length === 0` at the test layer, which
  // matches the pre-Phase-A contract.
  mmxCancel: (opts) => opts ? ipcRenderer.invoke('mmx:cancel', opts) : ipcRenderer.invoke('mmx:cancel'),

  // ---- file browser ----
  fbList: (dir) => ipcRenderer.invoke('fb:list', dir),
  // BUG-9-04 (user-reported, 2026-06-25): the renderer pushes
  // its current `state.fbDir` to the main process on every
  // navigation. The main process uses this as the single
  // explicit gate for every write IPC ("you can only write in
  // the folder you're looking at"). The IPC mirrors
  // setActiveDir() in main/services/PathSecurityService.js.
  fbSetActiveDir: (dir) => ipcRenderer.invoke('fb:set-active-dir', dir),
  // v1.1.28: trust a path + its ancestors so the Up button can
  // climb out of output_dir without forcing the user through the
  // file picker. Only walks up from an already-trusted root.
  fbTrustAncestors: (dir) => ipcRenderer.invoke('fb:trust-ancestors', dir),
  // v1.1 (user request): the file browser's Up button now
  // navigates to a list of available drives when the user is
  // already at a drive root. The main process enumerates the
  // drives (Windows: C:\, D:\, ...; POSIX: /) and returns them
  // as { ok, drives: [{ name, label }] } so the renderer's
  // folder explorer can render the list. No path-allowlist
  // check needed (no user-supplied path).
  fbListDrives: () => ipcRenderer.invoke('fb:listDrives'),
  fbMkdir: (dir, name) => ipcRenderer.invoke('fb:mkdir', dir, name),
  fbEnsureDir: (dir) => ipcRenderer.invoke('fb:ensureDir', dir),
  fbRename: (path, newName) => ipcRenderer.invoke('fb:rename', path, newName),
  fbDelete: (path) => ipcRenderer.invoke('fb:delete', path),
  fbMove: (src, destDir) => ipcRenderer.invoke('fb:move', src, destDir),
  fbCopy: (src, destDir) => ipcRenderer.invoke('fb:copy', src, destDir),
  fbReveal: (path) => ipcRenderer.invoke('fb:reveal', path),
  // v1.1.15: open a NEW Windows Explorer window at the
  // file's parent folder. Used by the right-click "Open
  // in Explorer" action. The previous "Reveal in Explorer"
  // (fbReveal) only highlights the file in an existing
  // window; this opens a fresh one. Both honour the same
  // allow-list in the main process.
  fbOpenInExplorer: (path) => ipcRenderer.invoke('fb:openInExplorer', path),
  fbRead: (path) => ipcRenderer.invoke('fb:read', path),
  // True if the given path exists and is inside the allowed roots.
  // Used by the upscale/crop pipeline to pick a non-clashing
  // output path. The async check goes through the same allow-list
  // the other fb:* handlers use, so a corrupted renderer can't
  // probe arbitrary paths.
  fbExists: (path) => ipcRenderer.invoke('fb:exists', path),
  fbWrite: (outPath, base64Data) => ipcRenderer.invoke('fb:write', outPath, base64Data),

  // ---- Real-ESRGAN (optional upscaler, BSD-3-Clause) ----
  // Returns { available, binaryPath, version }. When unavailable, the
  // renderer falls back to the built-in multi-step createImageBitmap
  // pipeline.
  realesrganAvailable: () => ipcRenderer.invoke('upscale:realesrgan:available'),
  // Spawn the binary. srcPath/dstPath must live under the allowed
  // roots (validated in main.js). opts: { model, scale, gpu? }.
  realesrganRun: (srcPath, dstPath, opts) => ipcRenderer.invoke('upscale:realesrgan:run', srcPath, dstPath, opts),
  // One-click install of the Real-ESRGAN binary into ./bin/. The
  // main process streams download + extract progress back to the
  // renderer through the 'upscale:realesrgan:download:progress'
  // channel. Returns { ok, binDir } when done, or { ok: false, error }
  // on failure. The fixed GitHub URL is documented in main.js; the
  // "Pick file…" button (installPickAndCopy) is the universal
  // fallback if the upstream asset is ever removed.
  realesrganDownload: () => ipcRenderer.invoke('upscale:realesrgan:download'),
  onRealesrganDownloadProgress: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('upscale:realesrgan:download:progress', listener);
    return () => ipcRenderer.removeListener('upscale:realesrgan:download:progress', listener);
  },

  // ---- Optional add-ons install (unified popup) ----
  // Open a URL in the user's default browser. Used by the popup
  // to send the user to the Real-ESRGAN releases page, the IS-Net
  // model mirror, or the project README without us trying to
  // auto-download a specific URL that may break later.
  installOpenUrl: (url) => ipcRenderer.invoke('install:openUrl', url),
  // Universal fallback: open a file picker and copy the picked
  // file into ./bin/ (or ./bin/models/) at the name the wrapper
  // probes for. `kind` is one of: 'realesrgan-binary' |
  // 'isnetbg-binary' | 'isnetbg-model'. Returns { ok, destPath, kind }
  // on success, { ok: false, canceled: true } if the user cancelled,
  // or { ok: false, error } on copy failure. Resets the binary
  // detector cache so the next probe sees the new file.
  installPickAndCopy: (kind) => ipcRenderer.invoke('install:pickAndCopy', kind),

  // ---- IS-Net background removal (optional, user-supplied binary) ----
  // Returns { available, binaryPath, modelPath, modelPresent, version }.
  // When unavailable (no binary, no model), the renderer's
  // "Remove background" actions show a clear install hint instead of
  // silently failing.
  isnetbgAvailable: () => ipcRenderer.invoke('isnetbg:available'),
  // Spawn the binary. srcPath/dstPath are validated against the
  // allowedRoots() allowlist in main.js. opts: { useGpu?: boolean }.
  // On success the binary writes a transparent PNG to dstPath.
  isnetbgRun: (srcPath, dstPath, opts) => ipcRenderer.invoke('isnetbg:run', srcPath, dstPath, opts),

  // ---- Image optimization / compression (Sharp + libvips) ----
  // Re-encodes the source image to shrink its file size while
  // preserving best-possible visual quality. opts:
  //   {
  //     quality:       1..100,                  // default 82
  //     format:        'jpeg'|'png'|'webp'|'avif'|null, // null = keep source
  //     stripMetadata: boolean,                 // default true (keeps ICC)
  //     outputPath:    string|null,             // null = sibling with _optimized
  //   }
  // Returns a structured result envelope:
  //   { ok, outputPath, inputSize, outputSize, savedBytes,
  //     savedPercent, format, width, height, error? }
  // Failures (corrupt file, sharp not installed, etc.) are
  // returned as { ok: false, error: '...' } — never thrown.
  optimizeImage: (srcPath, opts) => ipcRenderer.invoke('image:optimize', srcPath, opts),
  // bug-fix M6 (_temp4.md): sniffs the real format from content and
  // renames the file to match when mmx's downloaded CDN bytes (e.g.
  // JPEG) disagree with the hardcoded --out extension (always .png).
  //   fixImageExtension(path) → { ok, path, renamed, error? }
  fixImageExtension: (filePath) => ipcRenderer.invoke('image:fixExtension', filePath),
  // Bug-fix (reported by user): pre-flight existence check for a
  // --subject-ref reference image so a stale/missing path is caught with
  // a clear message instead of a cryptic, 4×-retried mmx ENOENT. URLs
  // (http/https) report exists:true (validated server-side, not on disk).
  //   refImageExists(path) → { ok, exists, url? }
  refImageExists: (filePath) => ipcRenderer.invoke('image:refExists', filePath),

  // ---- Audio cut / probe (folder-browser right-click) ----
  // Wraps the bundled ffmpeg-static binary. Used by the
  // "✂ Audio cut…" overlay opened from the right-click menu on
  // any audio file the file browser recognises. The wrapper
  // enforces the same path-allowlist as fb:* / image:*.
  //   audioAvailable()     → { available, path }
  //   audioProbe(src)      → { ok, duration, codec, sampleRate,
  //                            channels, channelLayout, bitRate,
  //                            format, size }
  //   audioDecodePeaks(src, opts) → downsampled peak buckets +
  //                            optional raw mono PCM for snap-to-zero.
  //                            opts: { duration, targetRate=8000,
  //                                    maxBuckets=4000,
  //                                    startSec, endSec, withPcm }
  //   audioFindZeroCrossing(pcm, targetSample, window) → { ok, index }
  //   audioTrimSilence(src, opts) → { ok, startSec, endSec,
  //                            leadSilenceSec, tailSilenceSec, … }
  //   audioCut(src, dst, opts) → streams the trimmed range to dst,
  //                            applying the requested micro-fade.
  //                            opts: { startSec, endSec, fadeMs=5,
  //                                    fade=true, copy=false }
  audioAvailable: () => ipcRenderer.invoke('audio:available'),
  audioProbe: (srcPath) => ipcRenderer.invoke('audio:probe', srcPath),
  audioDecodePeaks: (srcPath, opts) => ipcRenderer.invoke('audio:decodePeaks', srcPath, opts),
  audioFindZeroCrossing: (pcm, targetSample, window) => ipcRenderer.invoke('audio:findZeroCrossing', pcm, targetSample, window),
  audioTrimSilence: (srcPath, opts) => ipcRenderer.invoke('audio:trimSilence', srcPath, opts),
  audioCut: (srcPath, dstPath, opts) => ipcRenderer.invoke('audio:cut', srcPath, dstPath, opts),

  // ---- batches (BatchGen storage) ----
  batchesGet: () => ipcRenderer.invoke('batches:get'),
  batchesSet: (batches) => ipcRenderer.invoke('batches:set', batches),

  // ---- file picker ----
  pickFile: (opts) => ipcRenderer.invoke('file:pick', opts),

  // ---- state autosave (tab settings) ----
  stateGet: () => ipcRenderer.invoke('state:get'),
  stateSet: (s) => ipcRenderer.invoke('state:set', s),
  // Phase C: archive IPCs (L3 history).
  stateArchiveRead: (opts) => ipcRenderer.invoke('state:archiveRead', opts),
  stateArchiveClear: () => ipcRenderer.invoke('state:archiveClear'),
  stateArchiveSize: () => ipcRenderer.invoke('state:archiveSize'),
  stateArchiveDelete: (id) => ipcRenderer.invoke('state:archiveDelete', { id }),
  // Phase C: graceful shutdown signal from main → renderer. The
  // main process emits this on `before-quit`; the renderer has
  // `graceMs` (default 500) to flush in-flight state. We do not
  // ack the main process — the quit proceeds regardless.
  onBeforeQuit: (cb) => {
    const fn = (_e, payload) => { try { cb(payload); } catch (_) {} };
    ipcRenderer.on('app:before-quit', fn);
    return () => ipcRenderer.removeListener('app:before-quit', fn);
  },
  batchesGenerateExamples: () => ipcRenderer.invoke('batches:generateExamples'),

  // ---- events ----
  onLog: (cb) => {
    // Backwards-compat: the legacy `onLog(cb)` callback receives a
    // plain string. The new main-side handler sends { line, jobId,
    // kind }; we unwrap the `line` here so the renderer's legacy
    // `log(line)` wrapper keeps working. New code should prefer
    // `onLogRich(cb)` which receives the full payload.
    const fn = (_e, payload) => {
      if (payload == null) return;
      if (typeof payload === 'string') {
        cb(payload);
        return;
      }
      cb(payload.line != null ? payload.line : '');
    };
    ipcRenderer.on('mmx:log', fn);
    return () => ipcRenderer.removeListener('mmx:log', fn);
  },
  // Phase A: onLogRich(cb) receives the full payload
  // { line, jobId, kind } so the renderer can route the chunk to
  // the right job primary row.
  onLogRich: (cb) => {
    const fn = (_e, payload) => {
      if (payload == null) return;
      if (typeof payload === 'string') {
        // Legacy main build that still sends strings — wrap so the
        // renderer's payload-only code path doesn't need its own
        // shim. The jobId is null (free-form line).
        cb({ line: payload, jobId: null, kind: 'stderr' });
        return;
      }
      cb(payload);
    };
    ipcRenderer.on('mmx:log', fn);
    return () => ipcRenderer.removeListener('mmx:log', fn);
  },

  // ---- Phase 4 Fix 21: renderer-side error log ----
  // Schreibt eine Zeile in renderer-error.log im Projekt-Root.
  // Wird vom debugLog.js benutzt um JEDEN Error einzusammeln
  // ohne DevTools (F12) zu brauchen.
  logToFile: (line) => ipcRenderer.send('renderer:log', line),
});
