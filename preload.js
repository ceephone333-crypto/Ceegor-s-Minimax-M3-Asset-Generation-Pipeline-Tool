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

  // ---- mmx ----
  mmxRun: (args) => ipcRenderer.invoke('mmx:run', args),
  voices: () => ipcRenderer.invoke('mmx:voices'),
  quota: () => ipcRenderer.invoke('mmx:quota'),
  authStatus: () => ipcRenderer.invoke('mmx:authStatus'),
  diagnose: () => ipcRenderer.invoke('mmx:diagnose'),
  mmxCancel: () => ipcRenderer.invoke('mmx:cancel'),

  // ---- file browser ----
  fbList: (dir) => ipcRenderer.invoke('fb:list', dir),
  fbMkdir: (dir, name) => ipcRenderer.invoke('fb:mkdir', dir, name),
  fbRename: (path, newName) => ipcRenderer.invoke('fb:rename', path, newName),
  fbDelete: (path) => ipcRenderer.invoke('fb:delete', path),
  fbMove: (src, destDir) => ipcRenderer.invoke('fb:move', src, destDir),
  fbCopy: (src, destDir) => ipcRenderer.invoke('fb:copy', src, destDir),
  fbReveal: (path) => ipcRenderer.invoke('fb:reveal', path),
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
  batchesGenerateExamples: () => ipcRenderer.invoke('batches:generateExamples'),

  // ---- events ----
  onLog: (cb) => {
    const fn = (_e, line) => cb(line);
    ipcRenderer.on('mmx:log', fn);
    return () => ipcRenderer.removeListener('mmx:log', fn);
  },

  // ---- Phase 4 Fix 21: renderer-side error log ----
  // Schreibt eine Zeile in renderer-error.log im Projekt-Root.
  // Wird vom debugLog.js benutzt um JEDEN Error einzusammeln
  // ohne DevTools (F12) zu brauchen.
  logToFile: (line) => ipcRenderer.send('renderer:log', line),
});
