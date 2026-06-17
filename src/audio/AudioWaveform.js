// src/audio/AudioWaveform.js
// Waveform-Peak-Decode: ffmpeg → s16le mono PCM → Bucket-Folding.
// Gibt ein Float32Array "peaks" zurück (0..1 pro Bucket), optional einen
// Float32Array "pcm" für Zero-Crossing-Snap.

const { spawn } = require('child_process');
const { findBinary } = require('./AudioBinary');

/**
 * @typedef {object} DecodePeaksOpts
 * @property {number} [targetRate=8000]
 * @property {number} [maxBuckets=4000]
 * @property {number} [duration]        Gesamtlänge (Sekunden)
 * @property {number} [startSec=0]
 * @property {number} [endSec]
 * @property {boolean} [withPcm=false]  PCM-Buffer zusätzlich zurückgeben
 */

/**
 * @param {string} filePath
 * @param {DecodePeaksOpts} [opts]
 */
async function decodePeaks(filePath, opts = {}) {
  const targetRate = opts.targetRate || 8000;
  const maxBuckets = opts.maxBuckets || 4000;
  const duration = opts.duration;
  const startSec = opts.startSec != null ? Math.max(0, opts.startSec) : 0;
  let endSec = opts.endSec != null ? opts.endSec : (duration || startSec + 1);
  if (!(endSec > startSec)) {
    endSec = Math.max(startSec + 0.001, (duration || startSec + 1));
  }
  const wantPcm = !!opts.withPcm;

  // We intentionally do NOT pass `-ss` before `-i` for the seek — that's
  // ffmpeg's "fast seek" which snaps to the nearest keyframe. For
  // audio, putting `-ss` AFTER `-i` does a sample-accurate "input seek".
  const args = ['-i', filePath];
  if (startSec > 0) args.push('-ss', startSec.toFixed(6));
  if (endSec > startSec && duration && endSec < duration) {
    args.push('-t', (endSec - startSec).toFixed(6));
  }
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
    const sampleBytes = [];
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
      const totalSamples = Math.floor(totalBytes / 2);
      if (totalSamples === 0) {
        resolve({ ok: false, error: 'No audio decoded.', stderr });
        return;
      }
      const buf = Buffer.concat(sampleBytes, totalBytes);
      const pcm = wantPcm ? new Float32Array(totalSamples) : null;
      const samplesPerBucket = Math.max(1, Math.floor(totalSamples / maxBuckets));
      const bucketCount = Math.ceil(totalSamples / samplesPerBucket);
      const peaks = new Float32Array(bucketCount);
      let peakAbsMax = 0;
      for (let b = 0; b < bucketCount; b++) {
        const start = b * samplesPerBucket;
        const end = Math.min(totalSamples, start + samplesPerBucket);
        let m = 0;
        for (let i = start; i < end; i++) {
          const s = buf.readInt16LE(i * 2);
          const a = s < 0 ? -s : s;
          if (a > m) m = a;
          if (pcm) pcm[i] = s / 32768;
        }
        peaks[b] = m / 32768;
        if (peaks[b] > peakAbsMax) peakAbsMax = peaks[b];
      }
      const decodedSec = totalSamples / targetRate;
      const bucketSec = decodedSec / bucketCount;
      resolve({
        ok: true,
        peaks,
        bucketSec,
        bucketCount,
        startSec,
        durationSec: decodedSec,
        targetRate,
        peakAbsMax,
        pcm,
      });
    });
  });
}

module.exports = { decodePeaks };
