// tests/unit/renderer/tabs/batchImportHelper.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
// Mock standard globals used by batchImportHelper.js on file-load
global.state = { batches: {} };
global.toast = () => {};
global.showModal = () => {};
global.el = () => {};
global.$ = () => null;

require('../../../../renderer/tabs/batchImportHelper.js');
const { parseParams, batchEntryText, withBatchEntryText } = window.BatchManager;

test('parseParams: returns empty object for empty/null input', () => {
  assert.deepEqual(parseParams(''), {});
  assert.deepEqual(parseParams(null), {});
  assert.deepEqual(parseParams(undefined), {});
});

test('parseParams: parses key-value pairs with equals sign', () => {
  const result = parseParams('--width=1024 --height=768');
  assert.deepEqual(result, { width: '1024', height: '768' });
});

test('parseParams: parses key-value pairs with colon', () => {
  const result = parseParams('width: 1024 height: 768');
  assert.deepEqual(result, { width: '1024', height: '768' });
});

test('parseParams: parses standard CLI space-separated options', () => {
  const result = parseParams('--width 1024 --height 768');
  assert.deepEqual(result, { width: '1024', height: '768' });
});

test('parseParams: handles simple flags without values', () => {
  const result = parseParams('--instrumental --stereo');
  assert.deepEqual(result, { instrumental: 'true', stereo: 'true' });
});

test('parseParams: handles quoted values with spaces', () => {
  const result = parseParams('--voice "English Expressive Narrator" --speed 1.2');
  assert.deepEqual(result, { voice: 'English Expressive Narrator', speed: '1.2' });
});

test('parseParams: handles single-quoted values with spaces', () => {
  const result = parseParams("--voice 'German Female' --speed 0.95");
  assert.deepEqual(result, { voice: 'German Female', speed: '0.95' });
});

test('parseParams: normalizes keys to lowercase and removes leading dashes', () => {
  const result = parseParams('--Aspect-Ratio 16:9 --bpm 120');
  assert.deepEqual(result, { 'aspect-ratio': '16:9', bpm: '120' });
});

// ----- Bug-fix #5 (2026-06-19): batch entry shape helpers -----
// The BatchGen editor needs to round-trip entries of two shapes
// (string or {prompt, params...}). These tests pin the contract so
// future changes can't silently start dropping params.

test('batchEntryText: returns the string for legacy string entries', () => {
  assert.equal(batchEntryText('hello world'), 'hello world');
  assert.equal(batchEntryText(''), '');
});

test('batchEntryText: returns prompt for snapshot object entries', () => {
  assert.equal(batchEntryText({ prompt: 'a quiet alley', style: 'Pixel Art' }), 'a quiet alley');
  assert.equal(batchEntryText({ prompt: '' }), '');
});

test('batchEntryText: handles null / undefined / non-object without throwing', () => {
  assert.equal(batchEntryText(null), '');
  assert.equal(batchEntryText(undefined), '');
  assert.equal(batchEntryText(42), '');
  assert.equal(batchEntryText({}), ''); // no .prompt
});

test('withBatchEntryText: leaves legacy string entries as strings', () => {
  assert.equal(withBatchEntryText('old prompt', 'new prompt'), 'new prompt');
  assert.equal(withBatchEntryText(undefined, 'text'), 'text');
});

test('withBatchEntryText: preserves params on object entries', () => {
  const entry = { prompt: 'old', style: 'Pixel Art', width: 1024, label: 'demo' };
  const next = withBatchEntryText(entry, 'new prompt');
  assert.equal(next.prompt, 'new prompt');
  assert.equal(next.style, 'Pixel Art');
  assert.equal(next.width, 1024);
  assert.equal(next.label, 'demo');
  // Original is not mutated (defensive copy).
  assert.equal(entry.prompt, 'old');
});

test('withBatchEntryText: returns "" for empty text on object entries (keeps shape)', () => {
  const entry = { prompt: 'old', style: 'Pixel Art' };
  const next = withBatchEntryText(entry, '');
  assert.equal(next.prompt, '');
  assert.equal(next.style, 'Pixel Art');
});

test('end-to-end: edit a snapshot entry keeps params intact', () => {
  // Simulates what batchManager.js does when the user edits a
  // textbox seeded from a snapshot entry, then saves.
  const original = { prompt: 'original', style: 'Neon Cyberpunk', upscale: 'on' };
  const edited = withBatchEntryText(original, 'edited by user');
  assert.equal(edited.prompt, 'edited by user');
  assert.equal(edited.style, 'Neon Cyberpunk');
  assert.equal(edited.upscale, 'on');
});
