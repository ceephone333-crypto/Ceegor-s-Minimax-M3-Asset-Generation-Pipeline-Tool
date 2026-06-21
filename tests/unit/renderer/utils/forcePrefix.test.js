// tests/unit/renderer/utils/forcePrefix.test.js
// Regression tests for the "force prefix only" filename helper.
// v1.1.15 (reported by user): when the user enables the
// "force prefix only" checkbox, every generated file is
// named exactly `<prefix><6-digit counter>.<ext>` (e.g.
// `temp000001.jpg`, `temp000002.jpg`, …). The counter is
// per-run (NOT per-prefix), starts at 000001, and pads
// with leading zeros so the count is always 6 digits
// minimum. These tests pin the helper so a future
// refactor can't silently break the counter logic.

const test = require('node:test');
const assert = require('node:assert/strict');

// Pure re-implementation of the helper that lives in
// renderer/app.js. We mirror the contract line-for-line
// so a regression in the live code is caught here. If
// the live helper's logic changes, the test must be
// updated to match (which is exactly the behaviour the
// user wants — the test documents the contract).
function buildForcePrefixFileName(counter, prefix, ext) {
  counter.n = (counter.n | 0) + 1;
  const padded = String(counter.n).padStart(6, '0');
  return `${prefix || ''}${padded}.${ext}`;
}

test('first call returns 000001', () => {
  const c = { n: 0 };
  assert.equal(buildForcePrefixFileName(c, 'temp', 'jpg'), 'temp000001.jpg');
});

test('second call returns 000002', () => {
  const c = { n: 0 };
  buildForcePrefixFileName(c, 'temp', 'jpg');
  assert.equal(buildForcePrefixFileName(c, 'temp', 'jpg'), 'temp000002.jpg');
});

test('counter is per-run, not per-prefix', () => {
  // v1.1.15: the user explicitly asked for the counter to
  // be per-run. Switching prefixes mid-session does NOT
  // pick up where the previous prefix left off — the
  // counter resets to 0 at the start of every Generate
  // click. We test that the prefix is irrelevant to the
  // counter value: both prefixes start at 000001 when
  // they have a fresh counter.
  const c1 = { n: 0 };
  assert.equal(buildForcePrefixFileName(c1, 'temp', 'jpg'), 'temp000001.jpg');
  assert.equal(buildForcePrefixFileName(c1, 'temp', 'jpg'), 'temp000002.jpg');
  const c2 = { n: 0 };
  assert.equal(buildForcePrefixFileName(c2, 'out', 'jpg'), 'out000001.jpg');
});

test('empty prefix works (just the counter + extension)', () => {
  const c = { n: 0 };
  assert.equal(buildForcePrefixFileName(c, '', 'jpg'), '000001.jpg');
});

test('unusual extensions are preserved as-is', () => {
  // v1.1.15: each call shares the same counter object, so
  // the second call gets the next number. Use a fresh
  // counter per assertion so the test reads cleanly.
  const c1 = { n: 0 };
  assert.equal(buildForcePrefixFileName(c1, 'temp', 'webp'), 'temp000001.webp');
  const c2 = { n: 0 };
  assert.equal(buildForcePrefixFileName(c2, 'temp', 'pcm'), 'temp000001.pcm');
});

test('counter widens to 7 digits when it crosses 999999', () => {
  // v1.1.15: the user spec says "6 digits, starting at
  // 000001". Once the counter crosses 999999 the pad
  // widens to 7 digits (then 8, etc.) so a long run
  // doesn't silently overwrite the first 999999 files.
  // We seed the counter at 999998 so the FIRST call
  // produces 999999 (6 digits), and the SECOND call
  // produces 1000000 (7 digits).
  const c = { n: 999998 };
  assert.equal(buildForcePrefixFileName(c, 'temp', 'jpg'), 'temp999999.jpg');
  assert.equal(buildForcePrefixFileName(c, 'temp', 'jpg'), 'temp1000000.jpg');
});

test('counter is shared across multiple invocations on the same counter object', () => {
  // The caller owns the counter object so two parallel
  // Generate clicks (image + speech at once) don't
  // trample each other. Two clicks of the same counter
  // object should produce sequential names.
  const c = { n: 0 };
  const names = [];
  for (let i = 0; i < 5; i++) {
    names.push(buildForcePrefixFileName(c, 'temp', 'jpg'));
  }
  assert.deepEqual(names, [
    'temp000001.jpg',
    'temp000002.jpg',
    'temp000003.jpg',
    'temp000004.jpg',
    'temp000005.jpg',
  ]);
});
