// src/audio/AudioTrimCut.js
// Höhere Audio-Operationen: Silence-Trim (heuristisch über Peaks) +
// Cut-Export (Stream src[start..end] → dst, mit optionalem Fade).

const path = require('path');
const { spawn } = require('child_process');
const { findBinary } = require('./AudioBinary');
const { probe } = require('./AudioMetadata');
const { decodePeaks } = require('./AudioWaveform');

/**
 * Detektiert die längste sub-threshold-Run am Anfang und Ende der Datei
 * und liefert [startSec, endSec] zum Trimming.
 *
 * @param {string} filePath
 * @param {{ thresholdDb?: number, minSilenceMs?: number }} [opts]
 */
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

  // Head silence
  let leadSilentCount = 0;
  let leadEndIdx = -1;
  for (let i = 0; i < peaks.length; i++) {
    if (peaks[i] < linearThreshold) leadSilentCount++;
    else { leadEndIdx = i; break; }
  }
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

  // Tail silence
  let tailSilentCount = 0;
  let tailLoudIdx = -1;
  for (let i = peaks.length - 1; i >= 0; i--) {
    if (peaks[i] < linearThreshold) tailSilentCount++;
    else { tailLoudIdx = i; break; }
  }
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

/**
 * Codec-Auswahl pro Container-Extension.
 * Default-Qualität pro Codec — kann pro-Call über die
 * `quality`-Option überschrieben werden (v1.1 advanced pipeline
 * settings overlay). Map ist stabil: Renderer / Tests greifen
 * über `CODEC_BY_EXT` auf die Default-Args zu.
 * @type {Record<string, string[]>}
 */
const CODEC_BY_EXT = {
  wav:  ['-c:a', 'pcm_s16le'],
  mp3:  ['-c:a', 'libmp3lame', '-q:a', '2'],
  ogg:  ['-c:a', 'libvorbis', '-q:a', '6'],
  opus: ['-c:a', 'libopus', '-b:a', '128k'],
  flac: ['-c:a', 'flac'],
  m4a:  ['-c:a', 'aac', '-b:a', '192k'],
  aac:  ['-c:a', 'aac', '-b:a', '192k'],
};

/**
 * Build the codec argv for the chosen extension, substituting
 * the user-tuned quality values when present. `quality` is the
 * v1.1 advanced-pipeline-settings shape:
 *   { mp3Quality, oggQuality, opusBitrate, m4aBitrate }
 * Each field is optional; missing fields keep the codec default.
 */
function codecArgsFor(ext, quality) {
  const base = CODEC_BY_EXT[ext] || ['-c:a', 'pcm_s16le'];
  if (!quality || typeof quality !== 'object') return base.slice();
  // The codec arrays are stable 2/4-tuples. Substitute the
  // quality-bearing token (the LAST element of the relevant
  // codec array) when the user provided an override.
  //
  // v1.1 (audit AUDIT-06): coerce the input. The pre-v1.1
  // check used `Number.isFinite(q.mp3Quality)`, which is false
  // for the string "5" (a value state.js NEVER sends, but an
  // external IPC handler or a test might). Coerce via
  // `Number(value)` first, then validate. The result is the
  // same for the in-app flow (state.js always normalises to
  // numbers) and correct for the other call sites.
  const q = quality;
  const numQ = (v) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };
  if (ext === 'mp3' && Number.isFinite(numQ(q.mp3Quality))) {
    return ['-c:a', 'libmp3lame', '-q:a', String(Math.max(0, Math.min(9, Math.round(numQ(q.mp3Quality)))))];
  }
  if (ext === 'ogg' && Number.isFinite(numQ(q.oggQuality))) {
    return ['-c:a', 'libvorbis', '-q:a', String(Math.max(0, Math.min(10, Math.round(numQ(q.oggQuality)))))];
  }
  if (ext === 'opus' && typeof q.opusBitrate === 'string' && /^\d+k$/.test(q.opusBitrate)) {
    return ['-c:a', 'libopus', '-b:a', q.opusBitrate];
  }
  if ((ext === 'm4a' || ext === 'aac') && typeof q.m4aBitrate === 'string' && /^\d+k$/.test(q.m4aBitrate)) {
    return ['-c:a', 'aac', '-b:a', q.m4aBitrate];
  }
  return base.slice();
}

/**
 * Cut-Export. Streams srcPath[startSec..endSec] nach dstPath, optional
 * mit Micro-Fade an beiden Rändern.
 *
 * @param {string} srcPath
 * @param {string} dstPath
 * @param {{ startSec?: number, endSec?: number, fadeMs?: number, fade?: boolean, copy?: boolean, meta?: object }} [opts]
 */
async function cut(srcPath, dstPath, opts = {}) {
  const startSec = Math.max(0, opts.startSec || 0);
  const endSec   = Math.max(startSec + 0.001, opts.endSec || 0);
  const duration = endSec - startSec;
  const fadeMs   = opts.fadeMs != null ? opts.fadeMs : 5;
  const wantFade = !!opts.fade && fadeMs > 0;

  const ext = (path.extname(dstPath).toLowerCase().replace(/^\./, '') || 'wav');
  const codec = codecArgsFor(ext, opts.quality);

  // For "copy" mode (-c copy), the rules are different: ffmpeg needs
  // the fast seek (before -i) to keep stream-copying working. We keep
  // `-ss` before -i in that branch only.
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
      const fadeSec = (fadeMs / 1000).toFixed(4);
      args.push(
        '-af', `afade=t=in:st=0:d=${fadeSec},afade=t=out:st=${(duration - fadeMs / 1000).toFixed(4)}:d=${fadeSec}`,
      );
    }
  }
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
      resolve({ ok: true, outputPath: dstPath, startSec, endSec, duration });
    });
  });
}

module.exports = { trimSilence, cut, codecArgsFor, CODEC_BY_EXT };
