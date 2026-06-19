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
const { parseParams } = window.BatchManager;

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
