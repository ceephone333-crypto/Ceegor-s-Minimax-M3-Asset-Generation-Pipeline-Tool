// tests/unit/main/models/ConfigSchema.test.js
// Unit-Tests für den Config-Sanitizer.

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitize } = require('../../../../main/models/ConfigSchema');

test('sanitize accepts a complete valid config', () => {
  const out = sanitize({
    api_key: 'sk-abc',
    output_dir: 'C:/out',
    region: 'cn',
    theme: 'light',
    styles: [{ name: 'cinematic', value: 'cinematic, 8k' }],
  });
  assert.equal(out.api_key, 'sk-abc');
  assert.equal(out.output_dir, 'C:/out');
  assert.equal(out.region, 'cn');
  assert.equal(out.theme, 'light');
  assert.deepEqual(out.styles, [{ name: 'cinematic', value: 'cinematic, 8k' }]);
});

test('sanitize filters unknown region to "global"', () => {
  assert.equal(sanitize({ region: 'pluto' }).region, 'global');
  assert.equal(sanitize({ region: 'cn' }).region, 'cn');
  assert.equal(sanitize({ region: 'GLOBAL' }).region, 'global');
});

test('sanitize filters unknown theme to "dark"', () => {
  assert.equal(sanitize({ theme: 'pink' }).theme, 'dark');
  assert.equal(sanitize({ theme: 'light' }).theme, 'light');
});

test('sanitize coerces non-string api_key to empty string', () => {
  assert.equal(sanitize({ api_key: 42 }).api_key, '');
  assert.equal(sanitize({ api_key: null }).api_key, '');
  assert.equal(sanitize({ api_key: { x: 1 } }).api_key, '');
});

test('sanitize drops styles with missing name/value', () => {
  const out = sanitize({
    styles: [
      { name: 'good', value: 'ok' },
      { name: 'no-value' },
      { value: 'no-name' },
      null,
      'string',
      { name: 'a', value: 'b', extra: 'dropped' },
    ],
  });
  assert.deepEqual(out.styles, [
    { name: 'good', value: 'ok' },
    { name: 'a', value: 'b' },
  ]);
});

test('sanitize strips unknown top-level keys', () => {
  const out = sanitize({
    api_key: 'k',
    malicious: 'rm -rf /',
    prototype: { hacked: true },
  });
  assert.equal(out.api_key, 'k');
  assert.equal('malicious' in out, false);
  assert.equal('prototype' in out, false);
});

test('sanitize handles null/undefined input', () => {
  const out1 = sanitize(null);
  const out2 = sanitize(undefined);
  assert.equal(out1.api_key, '');
  assert.equal(out1.theme, 'dark');
  assert.equal(out2.region, 'global');
});
