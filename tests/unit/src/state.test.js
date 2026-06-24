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
    // Bug-fix B1 (_temp5.md): Phase C L2 jobs snapshot + cap.
    jobsSnapshot: [
      { id: 'job-1', type: 'image', tab: 'image', title: 'Test job 1', subtitle: '', status: 'ok', finishedAt: '2026-06-22T10:00:00.000Z', outputPaths: ['C:/out/a.png'], error: null },
      { id: 'job-2', type: 'music', tab: 'music', title: 'Test job 2', subtitle: 'batch', status: 'err', finishedAt: '2026-06-22T11:00:00.000Z', outputPaths: [], error: 'boom' },
    ],
    jobsArchiveCap: 300,
    // Bug-fix B5 (_temp5.md): four settings that used to reset on restart.
    apiKeyNoSave: true,
    fbTypeFilter: 'png,jpg',
    batchesAutoRemove: false,
    batchesExportFormat: 'txt',
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
  // Bug-fix B1 (_temp5.md): Phase C L2 snapshot + cap must round-trip.
  assert.deepEqual(back.jobsSnapshot, snap.jobsSnapshot);
  assert.equal(back.jobsArchiveCap, 300);
  // Bug-fix B5 (_temp5.md): the four previously-lost settings must
  // round-trip through the main-side whitelist.
  assert.equal(back.apiKeyNoSave, true);
  assert.equal(back.fbTypeFilter, 'png,jpg');
  assert.equal(back.batchesAutoRemove, false);
  assert.equal(back.batchesExportFormat, 'txt');
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
  // Bug-fix (reported by user — "make popups off default off"): the
  // default is now 'never' so a fresh / corrupted state shows no
  // informational popups.
  assert.equal(stateMod.read().popupPolicy, 'never');
});
test('popupPolicy defaults to never on a brand-new (empty) state', () => {
  stateMod.write({});
  assert.equal(stateMod.read().popupPolicy, 'never');
});
test('popupPolicy: legacy "once-fresh" from pre-v1.1.18 install is auto-downgraded to "never"', () => {
  // v1.1.23: pre-v1.1.18 the default was 'once-fresh', which fires
  // every gated popup until dismissed. Users who upgraded in-place
  // from v1.1.0 had `popupPolicy: 'once-fresh'` + empty
  // `seenPopups` in their state.json, so the "popups off by
  // default" change in v1.1.18 silently had no effect for them.
  // The migration: if the persisted value is 'once-fresh' AND the
  // user never confirmed a v1.1.18+ build (lastSeenVersion is
  // empty or < '1.1.18'), downgrade to 'never'.
  stateMod.write({ popupPolicy: 'once-fresh', lastSeenVersion: '' });
  assert.equal(stateMod.read().popupPolicy, 'never');
  stateMod.write({ popupPolicy: 'once-fresh', lastSeenVersion: '1.1.0' });
  assert.equal(stateMod.read().popupPolicy, 'never');
  stateMod.write({ popupPolicy: 'once-fresh', lastSeenVersion: '1.1.17' });
  assert.equal(stateMod.read().popupPolicy, 'never');
});
test('popupPolicy: explicit "once-fresh" from v1.1.18+ install is preserved', () => {
  // The user actively chose 'once-fresh' in the Settings dialog
  // AFTER the v1.1.18 default change — lastSeenVersion reflects
  // a build from that era — so the migration leaves their
  // preference alone.
  stateMod.write({ popupPolicy: 'once-fresh', lastSeenVersion: '1.1.18' });
  assert.equal(stateMod.read().popupPolicy, 'once-fresh');
  stateMod.write({ popupPolicy: 'once-fresh', lastSeenVersion: '1.1.22' });
  assert.equal(stateMod.read().popupPolicy, 'once-fresh');
});
test('popupPolicy: "always", "per-session", "never" are never auto-downgraded', () => {
  // Migration only touches the legacy 'once-fresh' value. Other
  // policies are always preserved (or defaulted to 'never' if
  // the value is not whitelisted).
  stateMod.write({ popupPolicy: 'always', lastSeenVersion: '1.1.0' });
  assert.equal(stateMod.read().popupPolicy, 'always');
  stateMod.write({ popupPolicy: 'per-session', lastSeenVersion: '' });
  assert.equal(stateMod.read().popupPolicy, 'per-session');
  stateMod.write({ popupPolicy: 'never', lastSeenVersion: '' });
  assert.equal(stateMod.read().popupPolicy, 'never');
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

// Bug-fix B1 (_temp5.md): the L2 cap is enforced on write and the
// overflow entries are moved to the L3 archive. We pin the exact
// trim boundary so a future change can't silently drop entries or
// keep the snapshot unbounded. The archive is lazily required; in
// the test environment it may not load (no ArchiveService on the
// classpath), which is fine — the trim still happens, the entries
// just don't get archived. We only assert the post-write snapshot
// length + that the NEWEST entries survived (FIFO eviction).
test('B1: jobsSnapshot is trimmed to jobsArchiveCap on write, keeping the newest entries', () => {
  const cap = 20;
  const snap = [];
  for (let i = 0; i < cap + 5; i++) {
    snap.push({ id: 'job-' + i, type: 'image', status: 'ok', finishedAt: '2026-06-22T10:00:0' + i + 'Z', outputPaths: [], title: 'Job ' + i, subtitle: '', tab: 'image', error: null });
  }
  stateMod.write({ jobsSnapshot: snap, jobsArchiveCap: cap });
  const back = stateMod.read();
  assert.ok(Array.isArray(back.jobsSnapshot), 'jobsSnapshot should be an array after write');
  assert.equal(back.jobsSnapshot.length, cap, 'jobsSnapshot should be trimmed to the cap');
  // FIFO eviction: the OLDEST cap entries are dropped, the NEWEST
  // cap survive. The snapshot is appended-to over time, so index 0
  // is the oldest. After trimming cap+5 down to cap, the first 5
  // entries are gone and the last cap survive.
  assert.equal(back.jobsSnapshot[0].id, 'job-5', 'oldest entry after trim should be job-5 (first 5 evicted)');
  assert.equal(back.jobsSnapshot[back.jobsSnapshot.length - 1].id, 'job-' + (cap + 5 - 1), 'newest entry should survive');
});

// Bug-fix B1 (_temp5.md): a null/missing jobsSnapshot stays null
// (NOT coerced to []) so a fresh state.json doesn't bloat with an
// empty array, and a renderer reading `null` can tell "no jobs yet"
// apart from "jobs were cleared".
test('B1: jobsSnapshot stays null when not set or set to null', () => {
  stateMod.write({});
  assert.equal(stateMod.read().jobsSnapshot, null);
  stateMod.write({ jobsSnapshot: null });
  assert.equal(stateMod.read().jobsSnapshot, null);
});

// Bug-fix B1 (_temp5.md): jobsArchiveCap clamps to [20, 1000] and
// falls back to 200 on invalid input, so a corrupted state.json
// can't make the cap absurdly high (which would defeat the L3
// archive overflow) or zero/negative (which would break trimming).
test('B1: jobsArchiveCap clamps to [20, 1000] and defaults to 200 on invalid input', () => {
  stateMod.write({ jobsArchiveCap: 5000 });
  assert.equal(stateMod.read().jobsArchiveCap, 1000);
  stateMod.write({ jobsArchiveCap: 1 });
  assert.equal(stateMod.read().jobsArchiveCap, 20);
  stateMod.write({ jobsArchiveCap: -5 });
  assert.equal(stateMod.read().jobsArchiveCap, 200);
  stateMod.write({ jobsArchiveCap: 'not-a-number' });
  assert.equal(stateMod.read().jobsArchiveCap, 200);
  stateMod.write({ jobsArchiveCap: null });
  assert.equal(stateMod.read().jobsArchiveCap, 200);
});

// Bug-fix B3 (_temp5.md): the overflow-trim path in write() used
// to append a debug line to %TEMP%/state-trace.log on every trim.
// That would have started growing a temp file on every save once
// B1 re-activated the snapshot persistence. This test asserts the
// trace file is NOT created by a write that triggers the trim.
test('B3: trim-path write does NOT create a state-trace.log debug file', () => {
  const os = require('os');
  const tracePath = path.join(os.tmpdir(), 'state-trace.log');
  // Pre-clean: if a previous run left a trace file, delete it so
  // our assertion is honest about THIS write's effect.
  try { fs.unlinkSync(tracePath); } catch (_) { /* ignore */ }
  // Trigger the trim path: cap+1 entries forces an overflow write.
  const cap = 20;
  const snap = [];
  for (let i = 0; i < cap + 1; i++) {
    snap.push({ id: 'trace-job-' + i, type: 'image', status: 'ok', finishedAt: '2026-06-22T10:00:00Z', outputPaths: [], title: 'T' +i, subtitle:'', tab:'image', error:null });
  }
  stateMod.write({ jobsSnapshot: snap, jobsArchiveCap: cap });
  assert.equal(fs.existsSync(tracePath), false,
    'state-trace.log must NOT be created — the debug appendFileSync was removed (B3)');
});

// Bug-fix B5 (_temp5.md): each of the four previously-lost settings
// has its own sanitisation rule. Pin them individually so a future
// change can't silently let a bad value through.
test('B5: apiKeyNoSave coerces to boolean (default false)', () => {
  stateMod.write({ apiKeyNoSave: 'true' });
  assert.equal(stateMod.read().apiKeyNoSave, false, 'string "true" should NOT be truthy — strict boolean');
  stateMod.write({ apiKeyNoSave: 1 });
  assert.equal(stateMod.read().apiKeyNoSave, false, 'number 1 should NOT be truthy — strict boolean');
  stateMod.write({ apiKeyNoSave: true });
  assert.equal(stateMod.read().apiKeyNoSave, true);
  stateMod.write({});
  assert.equal(stateMod.read().apiKeyNoSave, false);
});

test('B5: fbTypeFilter sanitises to a capped string (default empty)', () => {
  stateMod.write({ fbTypeFilter: 'png,jpg,mp3' });
  assert.equal(stateMod.read().fbTypeFilter, 'png,jpg,mp3');
  stateMod.write({ fbTypeFilter: 123 });
  assert.equal(stateMod.read().fbTypeFilter, '', 'non-string falls back to empty');
  const long = 'x'.repeat(500);
  stateMod.write({ fbTypeFilter: long });
  assert.equal(stateMod.read().fbTypeFilter.length, 256, 'string is capped at 256 chars');
});

test('B5: batchesAutoRemove coerces to boolean (default true — opt-OUT semantics)', () => {
  stateMod.write({ batchesAutoRemove: false });
  assert.equal(stateMod.read().batchesAutoRemove, false);
  stateMod.write({ batchesAutoRemove: 'no' });
  assert.equal(stateMod.read().batchesAutoRemove, true, 'non-false falls back to default true');
  stateMod.write({});
  assert.equal(stateMod.read().batchesAutoRemove, true, 'default is true (auto-remove ON)');
});

test('B5: batchesExportFormat whitelists to md|txt (default md)', () => {
  stateMod.write({ batchesExportFormat: 'txt' });
  assert.equal(stateMod.read().batchesExportFormat, 'txt');
  stateMod.write({ batchesExportFormat: 'pdf' });
  assert.equal(stateMod.read().batchesExportFormat, 'md', 'non-whitelisted value falls back to md');
  stateMod.write({});
  assert.equal(stateMod.read().batchesExportFormat, 'md');
});