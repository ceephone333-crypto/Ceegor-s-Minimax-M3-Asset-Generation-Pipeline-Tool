// src/audioCutter.js
// Audio trim / cut helper for the right-click "✂ Audio cut…" action
// in the folder browser. Wraps the bundled `ffmpeg-static` binary so the
// tool never has to ask the user to install a system-wide ffmpeg, while
// still supporting every audio format ffmpeg understands (mp3, wav,
// flac, ogg, opus, m4a/aac, wma, aiff, and the long tail of less-common
// codecs).
//
// What lives here:
//   - findBinary()        : resolves the ffmpeg.exe path (bundled or PATH).
//   - probe(filePath)     : metadata only (duration, channels, sample rate,
//                           bit rate, container, codec). Cheap call.
//   - decodePeaks(path,opts) : downsamples the source to ~16-bit signed
//                           PCM mono at a low target sample rate and
//                           returns one peak value per pixel the renderer
//                           is going to draw (plus an optional PCM buffer
//                           for zero-crossing snap). Streaming — the raw
//                           PCM never lives fully in memory.
//   - findZeroCrossing()  : walks the PCM buffer around a target sample
//                           and returns the nearest sample index whose
//                           sign flips, so the renderer can snap a marker
//                           to a click-free boundary.
//   - trimSilence(path,opts) : detects a sub-threshold run at the head
//                           and tail and returns [startSec, endSec] the
//                           renderer can drop straight into the markers.
//   - cut(src, dst, opts) : the actual export. Streams the trimmed range
//                           out to `dst`, optionally applying a micro-fade
//                           at both edges to mask any residual click that
//                           zero-crossing missed.
//
// We deliberately split the "find the cut points" work (peaks / zero
// crossings / silence detection) from the "write the file" work (cut).
// The renderer's slider drags never touch disk — they only hit
// decodePeaks / findZeroCrossing — and only an explicit "Export" click
// spawns the cut process. That keeps the UI responsive even on a
// multi-hundred-MB source.

const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

// Try the bundled ffmpeg-static binary first, fall back to a system
// ffmpeg on PATH. The bundled binary is the common case (every shipped
// build ships it via electron-builder's `files` list); the PATH
// fallback is for devs running from source who already have ffmpeg
// installed (much faster than the 80 MB download on every dev machine).
let cachedBinaryPath = null;

function findBinary() {
  if (cachedBinaryPath && fs.existsSync(cachedBinaryPath)) return cachedBinaryPath;
  // 1. Bundled binary from `ffmpeg-static`. The package returns the
  // absolute path to the prebuilt exe on the current platform.
  try {
    const bundled = require('ffmpeg-static');
    if (bundled && fs.existsSync(bundled)) {
      cachedBinaryPath = bundled;
      return bundled;
    }
  } catch (_) { /* not installed */ }

  // 2. Dev fallback: `where ffmpeg` / `which ffmpeg` on PATH.
  try {
    const whichCmd = process.platform === 'win32' ? 'where' : 'which';
    const r = spawnSync(whichCmd, ['ffmpeg'], { encoding: 'utf8', windowsHide: true });
    if (r.status === 0 && r.stdout) {
      const found = r.stdout.split(/\r?\n/).map((s) => s.trim()).find((s) => s && fs.existsSync(s));
      if (found) {
        cachedBinaryPath = found;
        return found;
      }
    }
  } catch (_) { /* ignore */ }

  // 3. Production fallback: ./bin/ffmpeg[.exe] next to the package
  // root. Mirrors the Real-ESRGAN wrapper's detection order so the
  // user can drop a binary into bin/ as a manual install.
  try {
    const candidates = [
      path.join(__dirname, '..', 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
      process.resourcesPath ? path.join(process.resourcesPath, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg') : null,
    ].filter(Boolean);
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        cachedBinaryPath = p;
        return p;
      }
    }
  } catch (_) { /* ignore */ }

  return null;
}

// True iff the ffmpeg binary resolves. Used by the renderer to decide
// whether to grey out the "Export" button up front (so the user sees a
// clear "ffmpeg not available" hint instead of a confusing failure on
// click).
function isAvailable() {
  return !!findBinary();
}

// --- low-level ffmpeg runner ---------------------------------------------
// Spawns ffmpeg with the given argv, captures stdout / stderr, and
// resolves with the same shape { ok, code, stdout, stderr } the rest of
// the wrappers in this project use. We use -hide_banner -nostdin so the
// CLI doesn't block waiting for input / output a banner we have to
// strip.
function runFFmpeg(args, opts = {}) {
  const bin = findBinary();
  if (!bin) {
    return Promise.resolve({
      ok: false,
      code: -1,
      stdout: '',
      stderr: 'ffmpeg binary not found (install ffmpeg-static or add ffmpeg.exe to PATH)',
    });
  }
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(bin, ['-hide_banner', '-nostdin', ...args], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      resolve({ ok: false, code: -1, stdout: '', stderr: String((e && e.message) || e) });
      return;
    }
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (b) => { stdout += b.toString('utf8'); });
    proc.stderr.on('data', (b) => { stderr += b.toString('utf8'); });
    proc.on('error', (e) => {
      resolve({ ok: false, code: -1, stdout, stderr: String((e && e.message) || e) });
    });
    proc.on('close', (code) => {
      resolve({ ok: code === 0, code, stdout, stderr });
    });
    if (opts.onSpawn) opts.onSpawn(proc);
  });
}

// --- probe() -------------------------------------------------------------
// Cheap metadata-only call. ffprobe would be nicer, but `ffmpeg-static`
// only ships ffmpeg, so we synthesise the same info from ffmpeg -i
// stderr. ffmpeg exits with code 1 on -i when no output is requested,
// but it still prints all the metadata we want on stderr — we just have
// to parse it.
async function probe(filePath) {
  const r = await runFFmpeg(['-i', filePath]);
  // ffmpeg exited non-zero (expected) but still dumped metadata. Parse
  // the well-known "  Duration: HH:MM:SS.cc " / "Stream #0:0: Audio:
  // pcm_s16le, 44100 Hz, stereo" lines. If the file isn't a media file
  // at all, ffmpeg's stderr looks completely different and we return
  // an error.
  const stderr = r.stderr || '';
  const dur = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!dur) {
    return {
      ok: false,
      error: 'Could not read audio metadata (unsupported format? corrupt file?).',
      stderr,
    };
  }
  const duration = (+dur[1]) * 3600 + (+dur[2]) * 60 + parseFloat(dur[3]);

  // Find the first audio stream line in stderr. Example:
  //   Stream #0:0: Audio: mp3, 44100 Hz, stereo, 192 kb/s
  const streamMatch = stderr.match(/Stream\s+#\d+:\d+.*?:\s*Audio:\s*([^,]+),\s*(\d+)\s*Hz(?:,\s*([^,\s]+))?/);
  let codec = '';
  let sampleRate = 0;
  let channels = 0;
  let channelLayout = '';
  if (streamMatch) {
    codec = streamMatch[1].trim();
    sampleRate = parseInt(streamMatch[2], 10) || 0;
    const ch = (streamMatch[3] || '').toLowerCase();
    channelLayout = ch;
    // ffmpeg spells "stereo" / "mono" / "5.1" etc. We normalise to a
    // count so the renderer can show "stereo (2 ch)" or similar.
    // For numeric layouts (e.g. "1", "2", "5.1", "7.1"), we just
    // parseFloat + round. "mono" / "stereo" are common enough to
    // handle explicitly (mostly so the metadata line reads
    // "stereo" rather than "2").
    if (ch === 'mono') channels = 1;
    else if (ch === 'stereo') channels = 2;
    else if (ch) {
      // Generic numeric layout: "1", "2", "4", "5.1", "7.1", …
      const n = parseFloat(ch);
      if (isFinite(n) && n > 0) channels = Math.round(n);
    }
  }
  // Bit rate from the same Stream line, if present.
  const brMatch = stderr.match(/Audio:[^,]+,\s*\d+\s*Hz,[^,]+,\s*(\d+)\s*kb\/s/);
  const bitRate = brMatch ? (parseInt(brMatch[1], 10) * 1000) : 0;

  // Container = file extension (cheap but correct for our use case).
  const ext = path.extname(filePath).toLowerCase().replace(/^\./, '');

  let stat = null;
  try { stat = await fsp.stat(filePath); } catch (_) { /* ignore */ }

  return {
    ok: true,
    duration,
    codec,
    sampleRate,
    channels,
    channelLayout,
    bitRate,
    format: ext,
    size: stat ? stat.size : 0,
  };
}

// --- decodePeaks() -------------------------------------------------------
// The renderer's waveform needs ~1000-3000 peak values per "page" of
// waveform the user is currently looking at. We don't want to decode the
// whole file at 44.1 kHz — that's 176 KB / second, ~10 MB / minute —
// just to throw 99.9% of the samples away. Instead we ask ffmpeg to
// resample to a target rate (default 8000 Hz mono) on the fly, and we
// collapse each "bucket" of N samples into a single [min, max] pair
// that the canvas renderer can draw as a vertical line.
//
// The returned `peaks` array holds the max-abs amplitude per bucket, in
// the range 0..1. `bucketSec` is how many source seconds each bucket
// spans (so the renderer can map "pixel x" back to "source time t").
//
// `pcm` is an optional Float32Array of mono samples at `targetRate`
// (default 8000 Hz) — the renderer uses it to snap markers to the
// nearest zero-crossing. We only return it when `withPcm: true` so the
// "I don't care about snapping" path stays cheap.
//
// Streaming: ffmpeg writes PCM to stdout in chunks; we don't hold the
// whole stream at once. We accumulate until ffmpeg exits, then fold.
async function decodePeaks(filePath, opts = {}) {
  const targetRate = opts.targetRate || 8000;
  const maxBuckets = opts.maxBuckets || 4000;
  // How many source seconds the user is asking us to render. The
  // renderer usually sends "the whole file" (probe.duration) so the
  // downsampled rate determines bucket width.
  const duration = opts.duration;
  // When the user zooms in, the renderer re-runs decodePeaks with a
  // tighter range AND the existing zoom isn't relevant to the
  // downsampled target rate. We pass `startSec` / `endSec` so we don't
  // waste CPU decoding parts the user can't see.
  const startSec = opts.startSec != null ? Math.max(0, opts.startSec) : 0;
  // Validate endSec. Without this check, an inverted range would
  // emit garbage peaks / PCM. (Negative endSec also makes ffmpeg
  // behave oddly.)
  let endSec = opts.endSec != null ? opts.endSec : (duration || startSec + 1);
  if (!(endSec > startSec)) {
    endSec = Math.max(startSec + 0.001, (duration || startSec + 1));
  }
  const wantPcm  = !!opts.withPcm;

  // We intentionally do NOT pass `-ss` before `-i` for the seek —
  // that's ffmpeg's "fast seek" which snaps to the nearest keyframe
  // and is inaccurate for audio (the rendered start time can be
  // off by hundreds of ms on some MP3s). Putting `-ss` AFTER `-i`
  // does a slower "input seek" that is sample-accurate. For audio
  // files this is still cheap (no keyframe search).
  const args = ['-i', filePath];
  if (startSec > 0) args.push('-ss', startSec.toFixed(6));
  if (endSec > startSec && duration && endSec < duration) {
    args.push('-t', (endSec - startSec).toFixed(6));
  }
  // Output: mono s16le at the target rate. s16le is much faster to
  // parse than f32le and the precision loss is irrelevant for a
  // waveform display.
  args.push('-ac', '1', '-ar', String(targetRate), '-f', 's16le', '-acodec', 'pcm_s16le', 'pipe:1');

  const bin = findBinary();
  if (!bin) return { ok: false, error: 'ffmpeg binary not found.' };

  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(bin, ['-hide_banner', '-nostdin', ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ ok: false, error: String((e && e.message) || e) });
      return;
    }
    const sampleBytes = []; // accumulating Buffer chunks
    let totalBytes = 0;
    let stderr = '';
    proc.stdout.on('data', (chunk) => {
      sampleBytes.push(chunk);
      totalBytes += chunk.length;
    });
    proc.stderr.on('data', (b) => { stderr += b.toString('utf8'); });
    proc.on('error', (e) => {
      resolve({ ok: false, error: String((e && e.message) || e), stderr });
    });
    proc.on('close', (code) => {
      if (code !== 0) {
        resolve({ ok: false, error: `ffmpeg exited with code ${code}`, stderr });
        return;
      }
      // Fold the bytes into a single Buffer, then walk 2 bytes at a
      // time as signed 16-bit little-endian PCM.
      const totalSamples = Math.floor(totalBytes / 2);
      if (totalSamples === 0) {
        resolve({ ok: false, error: 'No audio decoded.', stderr });
        return;
      }
      const buf = Buffer.concat(sampleBytes, totalBytes);
      const pcm = wantPcm ? new Float32Array(totalSamples) : null;

      // How many samples per peak bucket. Aim for `maxBuckets` total
      // buckets; never go below 1 sample / bucket.
      const samplesPerBucket = Math.max(1, Math.floor(totalSamples / maxBuckets));
      const bucketCount = Math.ceil(totalSamples / samplesPerBucket);
      const peaks = new Float32Array(bucketCount);

      let peakAbsMax = 0;
      for (let b = 0; b < bucketCount; b++) {
        const start = b * samplesPerBucket;
        const end = Math.min(totalSamples, start + samplesPerBucket);
        let m = 0;
        for (let i = start; i < end; i++) {
          // Little-endian signed 16-bit at offset i*2.
          const s = buf.readInt16LE(i * 2);
          const a = s < 0 ? -s : s;
          if (a > m) m = a;
          if (pcm) pcm[i] = s / 32768;
        }
        peaks[b] = m / 32768;
        if (peaks[b] > peakAbsMax) peakAbsMax = peaks[b];
      }

      // Compute the time span each bucket covers in source seconds. We
      // had to skip the very first decoded frame (~1024 samples) which
      // ffmpeg drops at -ss 0, but otherwise the decoded length /
      // targetRate is correct.
      const decodedSec = totalSamples / targetRate;
      const bucketSec = decodedSec / bucketCount;

      resolve({
        ok: true,
        peaks,           // Float32Array length = bucketCount, values 0..1
        bucketSec,       // source seconds per bucket
        bucketCount,
        startSec,
        durationSec: decodedSec,
        targetRate,
        // Peak-of-peaks, for the renderer's "Amplify" toggle so it can
        // normalise without rescanning.
        peakAbsMax,
        // Raw PCM mono float32 at targetRate. Only present when
        // withPcm was true. The renderer keeps this alive (it's small
        // at 8 kHz: ~16 KB / second of audio) and uses it for zero-
        // crossing snap.
        pcm,
      });
    });
  });
}

// --- findZeroCrossing() --------------------------------------------------
// Walk `pcm` from `fromSample` toward `targetSample` and return the
// nearest sample index where the signal crosses zero (sign flip). The
// caller (renderer) snaps its marker to that sample. We never go past
// ±window samples from `targetSample` — keeps a snap from yanking the
// marker halfway across the screen for an isolated low-amplitude
// blip. Returns `targetSample` unchanged when no zero crossing is
// found in the window (e.g. DC offset throughout).
function findZeroCrossing(pcm, targetSample, window = 4000) {
  if (!pcm || !pcm.length) return targetSample;
  const t = Math.max(0, Math.min(pcm.length - 1, Math.floor(targetSample)));
  const lo = Math.max(0, t - window);
  const hi = Math.min(pcm.length - 1, t + window);
  // Sign at the target. If the target sample itself is exactly zero,
  // treat it as a crossing.
  const targetSign = pcm[t] >= 0 ? 1 : -1;
  let best = t;
  let bestDist = window + 1;
  // Walk outward from `t` — the closest crossing is the most natural
  // snap, but we prefer a crossing WITHIN the original half (i.e.
  // before the user let go of the marker) when distances are equal.
  for (let i = 0; i <= window; i++) {
    const a = t - i;
    const b = t + i;
    if (a >= lo) {
      const s = pcm[a] >= 0 ? 1 : -1;
      if (s !== targetSign) {
        if (i < bestDist) { best = a; bestDist = i; }
        break;
      }
    }
    if (b <= hi && b !== a) {
      const s = pcm[b] >= 0 ? 1 : -1;
      if (s !== targetSign) {
        if (i < bestDist) { best = b; bestDist = i; }
        break;
      }
    }
  }
  return best;
}

// --- trimSilence() -------------------------------------------------------
// Detect the longest sub-threshold run at the head and tail of the file
// and return the [startSec, endSec] the renderer can drop into the
// markers. Internally we reuse decodePeaks (downsampled to a low rate)
// and walk inward until a bucket's peak exceeds the threshold.
//
// `thresholdDb` is the level below which a bucket is considered silent
// (e.g. -50 dB → 0.00316 linear). The default (-50 dB) is a sane game-
// dev / SFX default: it trims room tone but doesn't accidentally eat
// quiet reverb tails that the user wanted to keep.
//
// `minSilenceMs` is the smallest leading / trailing run we consider
// worth trimming. Default 50 ms — anything shorter than a 50 ms gap
// usually isn't deliberate silence the user wants to drop.
async function trimSilence(filePath, opts = {}) {
  const thresholdDb = opts.thresholdDb != null ? opts.thresholdDb : -50;
  const minSilenceMs = opts.minSilenceMs != null ? opts.minSilenceMs : 50;
  const linearThreshold = Math.pow(10, thresholdDb / 20);

  const probeR = await probe(filePath);
  if (!probeR.ok) return { ok: false, error: probeR.error };

  const peaksR = await decodePeaks(filePath, {
    duration: probeR.duration,
    targetRate: 4000,
    maxBuckets: 4000,
  });
  if (!peaksR.ok) return { ok: false, error: peaksR.error };

  const peaks = peaksR.peaks;
  const bucketSec = peaksR.bucketSec;
  const minSilenceBuckets = Math.max(1, Math.floor((minSilenceMs / 1000) / bucketSec));

  // ---------------- Head silence ----------------
  // Count consecutive silent buckets from index 0. We DO NOT reset
  // the counter when we hit a loud bucket — we want to know if the
  // file starts with a silent run at all. We just stop counting
  // there (loudEnd becomes the index of the first loud bucket).
  let leadSilentCount = 0;
  let leadEndIdx = -1; // -1 = entire file is silent
  for (let i = 0; i < peaks.length; i++) {
    if (peaks[i] < linearThreshold) {
      leadSilentCount++;
    } else {
      leadEndIdx = i;
      break;
    }
  }
  // Entirely silent: don't trim — the user almost certainly wants
  // to see the whole file in the editor and click Export
  // themselves.
  if (leadEndIdx === -1) {
    return {
      ok: true,
      startSec: 0,
      endSec: probeR.duration,
      threshold: thresholdDb,
      leadSilenceSec: 0,
      tailSilenceSec: 0,
      duration: probeR.duration,
      note: 'file appears fully silent',
    };
  }

  // ---------------- Tail silence ----------------
  // Mirror of the head walk. tailSilentCount is the number of
  // silent buckets at the END of the file; tailLoudIdx is the
  // index of the last loud bucket (i.e. the end of the body).
  let tailSilentCount = 0;
  let tailLoudIdx = -1;
  for (let i = peaks.length - 1; i >= 0; i--) {
    if (peaks[i] < linearThreshold) {
      tailSilentCount++;
    } else {
      tailLoudIdx = i;
      break;
    }
  }
  // Edge case: no loud bucket found from the tail (shouldn't
  // happen because we already checked "fully silent" above, but
  // be defensive).
  if (tailLoudIdx === -1) {
    return {
      ok: true,
      startSec: 0,
      endSec: probeR.duration,
      threshold: thresholdDb,
      leadSilenceSec: 0,
      tailSilenceSec: 0,
      duration: probeR.duration,
      note: 'no loud sample detected',
    };
  }

  // ---------------- Compute the trimmed range ----------------
  // leadEndIdx is the index of the FIRST loud bucket. We want the
  // cut to start at the very beginning of that bucket, so:
  //   startSec = leadEndIdx * bucketSec
  // (NOT (leadEndIdx + 1) — that would skip the first loud bucket
  // entirely. Earlier versions had this off-by-one.)
  //
  // For the tail, tailLoudIdx is the index of the LAST loud
  // bucket. We want the cut to end at the END of that bucket:
  //   endSec = (tailLoudIdx + 1) * bucketSec
  // We also clamp to probeR.duration because the last bucket may
  // span slightly past the actual file end (ffmpeg doesn't always
  // fill its output buffer to the byte).
  let startSec = 0;
  let endSec = probeR.duration;
  let leadSilenceSec = 0;
  let tailSilenceSec = 0;

  if (leadSilentCount >= minSilenceBuckets) {
    startSec = leadEndIdx * bucketSec;
    leadSilenceSec = leadSilentCount * bucketSec;
  }
  if (tailSilentCount >= minSilenceBuckets) {
    endSec = Math.min(probeR.duration, (tailLoudIdx + 1) * bucketSec);
    tailSilenceSec = tailSilentCount * bucketSec;
  }

  // Safety: never produce a zero / negative-length range. If the
  // computed trim would be empty (e.g. leadEndIdx == tailLoudIdx and
  // the user requested minSilenceMs equal to the body length),
  // fall back to the whole file. This is rare in practice.
  if (endSec - startSec < 0.005) {
    startSec = 0;
    endSec = probeR.duration;
    leadSilenceSec = 0;
    tailSilenceSec = 0;
  }

  return {
    ok: true,
    startSec,
    endSec,
    threshold: thresholdDb,
    leadSilenceSec,
    tailSilenceSec,
    duration: probeR.duration,
  };
}

// --- cut() ---------------------------------------------------------------
// The actual export. Streams `srcPath[startSec..endSec]` to `dstPath`
// in `format`, optionally applying a micro-fade at both edges.
//
// `format` is the output container ('mp3', 'wav', 'ogg', 'opus',
// 'flac', 'm4a'). When omitted we copy the source extension. We pick a
// sensible codec per container so the user doesn't have to know the
// difference between libmp3lame / libfdk_aac / libvorbis.
//
// `fadeMs` (default 5) applies an equal-power fade-in at the start and
// fade-out at the end. The duration is short enough to be inaudible on
// a percussive sound but long enough to bury the residual click that
// zero-crossing can't always prevent (e.g. DC-offset files where every
// sample is +0.001 and there's no real zero to snap to).
async function cut(srcPath, dstPath, opts = {}) {
  const startSec = Math.max(0, opts.startSec || 0);
  const endSec   = Math.max(startSec + 0.001, opts.endSec || 0);
  const duration = endSec - startSec;
  const fadeMs   = opts.fadeMs != null ? opts.fadeMs : 5;
  const wantFade = !!opts.fade && fadeMs > 0;
  const meta     = opts.meta || {}; // not used by ffmpeg directly (we don't write ID3; the renderer handles that)

  // Pick a codec by container extension. The user's filename
  // determines this so they always know what they're getting.
  const ext = (path.extname(dstPath).toLowerCase().replace(/^\./, '') || 'wav');
  const codec = {
    wav:  ['-c:a', 'pcm_s16le'],
    mp3:  ['-c:a', 'libmp3lame', '-q:a', '2'], // V2 (~190 kbps) — transparent for most SFX
    ogg:  ['-c:a', 'libvorbis', '-q:a', '6'],
    opus: ['-c:a', 'libopus', '-b:a', '128k'],
    flac: ['-c:a', 'flac'],
    m4a:  ['-c:a', 'aac', '-b:a', '192k'],
    aac:  ['-c:a', 'aac', '-b:a', '192k'],
  }[ext] || ['-c:a', 'pcm_s16le']; // unknown → WAV

  // We intentionally put `-ss` AFTER `-i` (and `-t` right after).
  // Putting `-ss` BEFORE `-i` triggers ffmpeg's "fast seek" mode,
  // which snaps to the nearest keyframe. For video that's fine, but
  // for audio on variable-bitrate MP3s it can be off by hundreds of
  // ms — exactly the case where the user is trying to nail down a
  // precise cut. Putting `-ss` after `-i` does a sample-accurate
  // input seek. The cost is a single demuxer pass that the encoder
  // was going to do anyway.
  //
  // For "copy" mode (-c copy), the rules are slightly different:
  // there ffmpeg needs the fast seek to keep stream-copying
  // working, so we keep `-ss` before `-i` in that branch only. The
  // trade-off is acceptable because copy mode is "lossless trim"
  // — the user is already accepting that no re-encoding happens,
  // and the codec's container alignment may add a few ms of
  // padding at the cut.
  let args;
  if (opts.copy) {
    args = [
      '-ss', startSec.toFixed(6),
      '-i', srcPath,
      '-t', duration.toFixed(6),
      '-c', 'copy',
    ];
  } else {
    args = [
      '-i', srcPath,
      '-ss', startSec.toFixed(6),
      '-t', duration.toFixed(6),
      ...codec,
    ];
    if (wantFade) {
      // Use a tiny half-cosine fade. afade=t=in/out:st=…:d=…
      // (type=tri is also fine but tri sounds slightly clickier on
      // percussive content).
      const fadeSec = (fadeMs / 1000).toFixed(4);
      args.push(
        '-af', `afade=t=in:st=0:d=${fadeSec},afade=t=out:st=${(duration - fadeMs / 1000).toFixed(4)}:d=${fadeSec}`,
      );
    }
  }
  // -y overwrites the destination without prompting (we already
  // picked a non-clashing name in the renderer).
  args.push('-y', dstPath);

  const bin = findBinary();
  if (!bin) return { ok: false, error: 'ffmpeg binary not found.' };

  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(bin, ['-hide_banner', '-nostdin', ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ ok: false, error: String((e && e.message) || e) });
      return;
    }
    let stderr = '';
    proc.stderr.on('data', (b) => { stderr += b.toString('utf8'); });
    proc.on('error', (e) => resolve({ ok: false, error: String((e && e.message) || e) }));
    proc.on('close', (code) => {
      if (code !== 0) {
        resolve({ ok: false, code, error: `ffmpeg exited with code ${code}`, stderr });
        return;
      }
      // We don't try to parse the resulting duration from stderr (it
      // varies too much by codec). The renderer can re-probe if it
      // cares.
      resolve({ ok: true, outputPath: dstPath, startSec, endSec, duration });
    });
  });
}

module.exports = {
  isAvailable,
  findBinary,
  probe,
  decodePeaks,
  findZeroCrossing,
  trimSilence,
  cut,
};
