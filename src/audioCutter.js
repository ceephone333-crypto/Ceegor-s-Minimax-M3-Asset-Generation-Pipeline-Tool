// src/audioCutter.js
// Backward-Compat-Re-Export. Phase 4 hat die 660-Zeilen-Datei in
// 5 fokussierte Module unter src/audio/ zerlegt. Dieser Shim hält den
// `require('../../src/audioCutter')`-Pfad in main/ipc/registerAudioIpc.js
// stabil.
//
// Layout (siehe _refactoringplan.md §2):
//   src/audio/AudioBinary.js      ffmpeg-Binary-Auflösung + Cache
//   src/audio/AudioRunner.js      low-level ffmpeg-Spawn-Wrapper
//   src/audio/AudioMetadata.js    probe(filePath) — ffmpeg -i parsing
//   src/audio/AudioWaveform.js    decodePeaks() — s16le PCM → peaks
//   src/audio/AudioMath.js        findZeroCrossing() — pure, no ffmpeg
//   src/audio/AudioTrimCut.js     trimSilence() + cut()

const { findBinary, isAvailable } = require('./audio/AudioBinary');
const { runFFmpeg } = require('./audio/AudioRunner'); // re-exported for tests
const { probe } = require('./audio/AudioMetadata');
const { decodePeaks } = require('./audio/AudioWaveform');
const { findZeroCrossing } = require('./audio/AudioMath');
const { trimSilence, cut } = require('./audio/AudioTrimCut');

module.exports = {
  // Binary
  isAvailable,
  findBinary,
  // Probe + decode
  probe,
  decodePeaks,
  // Pure
  findZeroCrossing,
  // High-level
  trimSilence,
  cut,
  // Internals (re-exported for tests + future use)
  runFFmpeg,
};
