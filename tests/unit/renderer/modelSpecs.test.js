// tests/unit/renderer/modelSpecs.test.js
// Tests for the authoritative parameter validator (validateValues) that
// gates both live generation and BatchGen imports. Values are the exact
// MiniMax-accepted sets (see renderer/specs/modelSpecs.js header).

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// modelSpecs.js is a classic browser script: it attaches its API to
// `window`. Shim a global window, then load it.
global.window = global.window || {};
require(path.join(__dirname, '..', '..', '..', 'renderer', 'specs', 'modelSpecs.js'));
const { validateValues } = global.window.ModelSpecs;

const errsOf = (tab, vals, opts) => validateValues(tab, vals, opts).errors;
const ok = (tab, vals, opts) => assert.deepStrictEqual(errsOf(tab, vals, opts), [], `expected no errors for ${JSON.stringify(vals)}`);
const bad = (tab, vals, re, opts) => {
  const e = errsOf(tab, vals, opts);
  assert.ok(e.length > 0, `expected an error for ${JSON.stringify(vals)}`);
  if (re) assert.ok(e.some((x) => re.test(x)), `expected an error matching ${re}; got ${JSON.stringify(e)}`);
};

test('speech: accepts a valid configuration', () => {
  ok('speech', { model: 'speech-2.8-hd', format: 'mp3', 'sample-rate': 32000, bitrate: 128000, channels: 1, speed: 1, volume: 1, pitch: 0, text: 'hi' });
});
test('speech: rejects sample-rate 48000', () => bad('speech', { 'sample-rate': 48000 }, /sample-rate/));
test('speech: rejects volume 0 (must be > 0)', () => bad('speech', { volume: 0 }, /volume/));
test('speech: accepts volume 10, rejects 11', () => { ok('speech', { volume: 10 }); bad('speech', { volume: 11 }, /volume/); });
test('speech: rejects bitrate 192000 for mp3 but ignores it for wav', () => {
  bad('speech', { format: 'mp3', bitrate: 192000 }, /bitrate/);
  ok('speech', { format: 'wav', bitrate: 192000 });
});
test('speech: rejects an unknown model', () => bad('speech', { model: 'speech-9000' }, /model/));
test('speech: accepts speech-01-hd', () => ok('speech', { model: 'speech-01-hd' }));

test('music: accepts a valid configuration', () => {
  ok('music', { model: 'music-2.6', format: 'mp3', 'sample-rate': 44100, bitrate: 256000, lyrics: 'la la' });
});
test('music: rejects sample-rate 22050 and 48000', () => { bad('music', { 'sample-rate': 22050 }); bad('music', { 'sample-rate': 48000 }); });
test('music: rejects bitrate 192000', () => bad('music', { bitrate: 192000 }, /bitrate/));
test('music: instrumental + lyrics is a conflict', () => bad('music', { instrumental: true, lyrics: 'words' }, /instrumental/i));
test('music: lyrics-optimizer + lyrics is a conflict', () => bad('music', { 'lyrics-optimizer': true, lyrics: 'words' }, /auto-lyrics/i));
test('music: lyrics-optimizer requires music-2.6', () => bad('music', { 'lyrics-optimizer': true, model: 'music-2.5+' }, /2\.6/));
test('music: missing lyrics is an error in strict mode but OK in partial', () => {
  bad('music', { model: 'music-2.6' }, /lyrics/i);
  ok('music', { model: 'music-2.6' }, { partial: true });
});
test('music: rejects the removed music-2.0 model', () => bad('music', { model: 'music-2.0' }, /model/));

test('image: accepts a valid configuration', () => {
  ok('image', { model: 'image-01', 'aspect-ratio': '16:9', n: 2, prompt: 'a cat' });
});
test('image: rejects an unknown aspect ratio', () => bad('image', { 'aspect-ratio': '5:4' }, /aspect/));
test('image: width without height is an error', () => bad('image', { width: 1024 }, /together/i));
test('image: width+height not divisible by 8', () => bad('image', { width: 1000, height: 1001 }, /multiple of 8/));
test('image: custom size on image-01-live is rejected', () => bad('image', { model: 'image-01-live', width: 1024, height: 1024 }, /image-01/));
test('image: n out of range', () => { bad('image', { n: 10 }, /n /); ok('image', { n: 9 }); });

test('video: Fast model requires a first frame', () => {
  bad('video', { model: 'MiniMax-Hailuo-2.3-Fast', prompt: 'x' }, /first-frame/);
  ok('video', { model: 'MiniMax-Hailuo-2.3-Fast', prompt: 'x', 'first-frame': 'a.png' });
});
test('video: last-frame requires first-frame', () => bad('video', { model: 'MiniMax-Hailuo-02', 'last-frame': 'b.png' }, /first-frame/));
test('video: rejects an unknown model', () => bad('video', { model: 'Hailuo-9' }, /model/));
test('video: S2V-01 requires a subject image', () => {
  bad('video', { model: 'S2V-01', prompt: 'x' }, /subject/i);
  ok('video', { model: 'S2V-01', prompt: 'x', 'subject-image': 'face.png' });
});
test('video: default T2V model needs no images', () => ok('video', { model: 'MiniMax-Hailuo-2.3', prompt: 'a cat walking' }));

test('unknown keys and missing optional values do not error', () => {
  ok('speech', { text: 'hi', somethingUnknown: 'x' });
  ok('image', { prompt: 'a cat' });
});
