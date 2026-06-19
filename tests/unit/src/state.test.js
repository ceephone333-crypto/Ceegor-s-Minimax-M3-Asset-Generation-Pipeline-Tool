// tests/unit/src/state.test.js
// Bug-fix #1 (2026-06-19): the renderer's snapshot now relies on
// src/state.js write() to round-trip the full persistent shape
// (filePrefix, fbSort, fbColumns, popupPolicy, …). This test
// guards the main-side contract so a future sanitisation change
// can't silently drop a field the renderer now sends.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Point config.js at a throw-away dir BEFORE requiring it, so
// statePath() (which delegates to configDir()) writes the test
// file under a directory we can clean up.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmx-state-test-'));
process.env.MINIMAX_CONFIG_DIR = tmpDir;

// Provide a stub for the `electron` module so config.js / state.js
// can resolve `app.getPath('exe')` without booting the runtime.
require.cache[require.resolve('electron')] = {
  exports: { app: { getPath: () => tmpDir } },
};

// Drop any cached copies of these modules — they were already
// loaded above (electron was, even though we just stubbed it).
delete require.cache[require.resolve('../../../src/config')];
delete require.cache[require.resolve('../../../src/state')];

const stateMod = require('../../../src/state');
const cfgMod = require('../../../src/config');

function makeFullSnapshot() {
  return {
    tabs: { image: { 'image.prompt': 'hello' } },
    currentTab: 'speech',
    fbDirs: { image: 'C:/out/img', speech: 'C:/out/sp', music: '', video: '' },
    filePrefix: 'ceegor_',
    realesrganModel: 'realesrgan-x4plus',
    realesrganFirstRunDismissed: true,
    upscaleEnabled: true,
    upscaleSettings: {
      multiplier: 4,
      autoCrop: true,
      cropWidth: 1024,
      cropHeight: 1024,
      cropAnchorX: 'right',
      cropAnchorY: 'bottom',
    },
    removeBackgroundEnabled: true,
    removeBackgroundUseGpu: false,
    optimizeSettings: {
      enabled: true,
      quality: 75,
      format: 'webp',
      stripMetadata: false,
    },
    layoutSettings: { sidebarW: 420, logbarH: 320, previewW: 540 },
    fbSort: 'mtime-desc',
    fbColumns: { size: true, type: true, mtime: true, created: false, path: true },
    fbThumbnails: true,
    lastSeenVersion: '1.1.0',
    popupPolicy: 'per-session',
    seenPopups: { 'realesrgan.firstRun': '2026-06-19T10:00:00.000Z' },
  };
}

test('state write+read round-trips every persistent field', () => {
  const snap = makeFullSnapshot();
  stateMod.write(snap);
  const back = stateMod.read();

  assert.equal(back.currentTab, 'speech');
  assert.deepEqual(back.fbDirs, snap.fbDirs);
  assert.equal(back.filePrefix, 'ceegor_');
  assert.equal(back.realesrganModel, 'realesrgan-x4plus');
  assert.equal(back.realesrganFirstRunDismissed, true);
  assert.equal(back.upscaleEnabled, true);
  // Bug-fix #2: crop fields must survive.
  assert.deepEqual(back.upscaleSettings, snap.upscaleSettings);
  assert.equal(back.removeBackgroundEnabled, true);
  assert.equal(back.removeBackgroundUseGpu, false);
  assert.deepEqual(back.optimizeSettings, snap.optimizeSettings);
  assert.deepEqual(back.layoutSettings, snap.layoutSettings);
  assert.equal(back.fbSort, 'mtime-desc');
  assert.deepEqual(back.fbColumns, snap.fbColumns);
  assert.equal(back.fbThumbnails, true);
  assert.equal(back.lastSeenVersion, '1.1.0');
  assert.equal(back.popupPolicy, 'per-session');
  assert.deepEqual(back.seenPopups, snap.seenPopups);
  assert.deepEqual(back.tabs, snap.tabs);
});

test('upscaleSettings clamps crop size to >= 0 and anchors to whitelist', () => {
  stateMod.write({
    upscaleSettings: {
      multiplier: 'not-a-number',
      autoCrop: 'yes',
      cropWidth: -50,
      cropHeight: 99999,
      cropAnchorX: 'nowhere',
      cropAnchorY: 'up',
    },
  });
  const back = stateMod.read();
  assert.equal(back.upscaleSettings.multiplier, 2);       // bad parse → default
  assert.equal(back.upscaleSettings.autoCrop, true);       // truthy string → true
  assert.equal(back.upscaleSettings.cropWidth, 0);         // negative clamped
  // 99999 stays — main process only clamps to >=0; the CSS drag handler
  // is responsible for the upper bound.
  assert.equal(back.upscaleSettings.cropHeight, 99999);
  assert.equal(back.upscaleSettings.cropAnchorX, 'center'); // bad value → default
  assert.equal(back.upscaleSettings.cropAnchorY, 'center'); // 'up' not in whitelist
});

test('fbSort falls back to default when value is not whitelisted', () => {
  stateMod.write({ fbSort: 'random-string' });
  assert.equal(stateMod.read().fbSort, 'name-asc');
});

test('popupPolicy falls back to default when value is not whitelisted', () => {
  stateMod.write({ popupPolicy: 'sometimes' });
  assert.equal(stateMod.read().popupPolicy, 'once-fresh');
});

test('seenPopups drops entries with non-string values and oversize keys', () => {
  stateMod.write({
    seenPopups: {
      good: '2026-01-01T00:00:00.000Z',
      badValue: { not: 'a string' }, // dropped (typeof !== 'string')
      longValue: 'x'.repeat(100),    // dropped (>32 chars)
      tooLongKey: 'y'.repeat(70),    // dropped (key length > 64)
    },
  });
  const back = stateMod.read();
  assert.equal(back.seenPopups.good, '2026-01-01T00:00:00.000Z');
  assert.equal(back.seenPopups.badValue, undefined);
  assert.equal(back.seenPopups.longValue, undefined);
  assert.equal(back.seenPopups.tooLongKey, undefined);
});

test('write is atomic and recovers from corrupt JSON', () => {
  // First, write something good.
  stateMod.write({ filePrefix: 'good' });
  assert.equal(stateMod.read().filePrefix, 'good');

  // Now corrupt the file directly and confirm read() returns
  // a sane default instead of throwing.
  fs.writeFileSync(stateMod.statePath(), '{not json', 'utf8');
  const back = stateMod.read();
  assert.ok(back && typeof back === 'object');
  assert.deepEqual(back.tabs, {});
});

// Cleanup the temp dir at the end.
test.after(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

// Bug-fix #6: statePath + batchesPath honour MINIMAX_CONFIG_DIR.
test('statePath and batchesPath land under MINIMAX_CONFIG_DIR', () => {
  const overrideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmx-override-'));
  process.env.MINIMAX_CONFIG_DIR = overrideDir;
  try {
    // Re-require both modules so they pick up the new env value.
    delete require.cache[require.resolve('../../../src/state')];
    delete require.cache[require.resolve('../../../src/batches')];
    const sMod = require('../../../src/state');
    const bMod = require('../../../src/batches');
    assert.equal(sMod.statePath(), path.join(overrideDir, 'state.json'));
    assert.equal(bMod.batchesPath(), path.join(overrideDir, 'batches.json'));
  } finally {
    process.env.MINIMAX_CONFIG_DIR = tmpDir;
    // Restore the cached modules with the original temp dir.
    delete require.cache[require.resolve('../../../src/state')];
    delete require.cache[require.resolve('../../../src/batches')];
    try { fs.rmSync(overrideDir, { recursive: true, force: true }); } catch {}
  }
});