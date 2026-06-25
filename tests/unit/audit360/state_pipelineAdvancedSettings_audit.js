// tests/unit/audit360/state_pipelineAdvancedSettings_audit.js
// ============================================================================
// 360° EMPIRICAL AUDIT — state.js pipelineAdvancedSettings round-trip.
// This harness runs state.write() + state.read() with EVERY documented
// sub-key shape (omitted, valid, corrupt) and reports what actually
// happened. NO assumptions — the asserts are derived from the actual
// behaviour, not from the comments in state.js.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const STATE_PATH = path.join(ROOT, 'src', 'state.js');

// ----------------------------------------------------------------------------
// Electron mock — state.js requires './config' which transitively requires
// electron's app.getPath. We use MINIMAX_CONFIG_DIR so we don't touch the
// user's real state.json.
// ----------------------------------------------------------------------------
function withElectronMock(fn) {
  const Module = require('module');
  const origLoad = Module._load;
  Module._load = function (request, parent, ...rest) {
    if (request === 'electron') {
      return {
        app: { getPath: () => process.env.MINIMAX_CONFIG_DIR || os.tmpdir() },
        shell: { openPath: async () => '' },
      };
    }
    return origLoad.call(this, request, parent, ...rest);
  };
  try { return fn(); } finally { Module._load = origLoad; }
}

function freshState() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-state-'));
  process.env.MINIMAX_CONFIG_DIR = tmp;
  // Drop any cached state.js so it picks up the new configDir() result.
  delete require.cache[require.resolve(STATE_PATH)];
  let mod;
  withElectronMock(() => { mod = require(STATE_PATH); });
  return { tmp, state: mod };
}

function cleanup(tmp) {
  delete process.env.MINIMAX_CONFIG_DIR;
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
}

function assertShapeValid(s) {
  // Helper: every documented sub-key MUST be present on a fresh write.
  assert.ok(s.pipelineAdvancedSettings, 'pipelineAdvancedSettings must exist');
  const a = s.pipelineAdvancedSettings;
  assert.ok(a.realesrgan, 'realesrgan sub-object must exist');
  assert.ok(a.isnetbg, 'isnetbg sub-object must exist');
  assert.ok(a.optimize, 'optimize sub-object must exist');
  assert.ok(a.audio, 'audio sub-object must exist');
  for (const k of ['tileSize', 'ttaMode', 'gpuId']) {
    assert.ok(k in a.realesrgan, `realesrgan.${k} must be present`);
  }
  for (const k of ['intraOpNumThreads', 'interOpNumThreads', 'executionMode']) {
    assert.ok(k in a.isnetbg, `isnetbg.${k} must be present`);
  }
  for (const k of ['jpegChromaSubsampling', 'jpegMozjpeg', 'pngCompressionLevel', 'pngPalette',
                    'webpMode', 'webpEffort', 'avifEffort', 'avifChromaSubsampling']) {
    assert.ok(k in a.optimize, `optimize.${k} must be present`);
  }
  for (const k of ['silenceThresholdDb', 'minSilenceMs', 'mp3Quality', 'oggQuality', 'opusBitrate', 'm4aBitrate']) {
    assert.ok(k in a.audio, `audio.${k} must be present`);
  }
}

// =============================================================================
// T1: DEFAULT block — no pipelineAdvancedSettings at all. What shape does
// write() produce? The comments claim a full default; verify empirically.
// =============================================================================
test('AUDIT T1: write({tabs:{}}) WITHOUT pipelineAdvancedSettings produces a FULL default shape', () => {
  const { tmp, state } = freshState();
  try {
    const written = state.write({ tabs: {} });
    // Must be present.
    assert.ok(written.pipelineAdvancedSettings, 'a fresh write must include pipelineAdvancedSettings (the documented contract)');
    assertShapeValid(written);
    // Spot-check the documented defaults.
    assert.equal(written.pipelineAdvancedSettings.realesrgan.tileSize, 0, 'default tileSize=0 (auto)');
    assert.equal(written.pipelineAdvancedSettings.realesrgan.ttaMode, false, 'default ttaMode=false');
    assert.equal(written.pipelineAdvancedSettings.realesrgan.gpuId, 'auto', 'default gpuId=auto');
    assert.equal(written.pipelineAdvancedSettings.isnetbg.intraOpNumThreads, 0);
    assert.equal(written.pipelineAdvancedSettings.isnetbg.interOpNumThreads, 0);
    assert.equal(written.pipelineAdvancedSettings.isnetbg.executionMode, 'sequential');
    assert.equal(written.pipelineAdvancedSettings.optimize.jpegChromaSubsampling, '4:2:0');
    assert.equal(written.pipelineAdvancedSettings.optimize.jpegMozjpeg, true);
    assert.equal(written.pipelineAdvancedSettings.optimize.pngCompressionLevel, 9);
    assert.equal(written.pipelineAdvancedSettings.optimize.pngPalette, true);
    assert.equal(written.pipelineAdvancedSettings.optimize.webpMode, 'lossy');
    assert.equal(written.pipelineAdvancedSettings.optimize.webpEffort, 6);
    assert.equal(written.pipelineAdvancedSettings.optimize.avifEffort, 9);
    assert.equal(written.pipelineAdvancedSettings.optimize.avifChromaSubsampling, '4:4:4');
    assert.equal(written.pipelineAdvancedSettings.audio.silenceThresholdDb, -50);
    assert.equal(written.pipelineAdvancedSettings.audio.minSilenceMs, 50);
    assert.equal(written.pipelineAdvancedSettings.audio.mp3Quality, 2);
    assert.equal(written.pipelineAdvancedSettings.audio.oggQuality, 6);
    assert.equal(written.pipelineAdvancedSettings.audio.opusBitrate, '128k');
    assert.equal(written.pipelineAdvancedSettings.audio.m4aBitrate, '192k');
    // read() must return the same defaults.
    const r = state.read();
    assert.equal(r.pipelineAdvancedSettings.realesrgan.gpuId, 'auto');
    assert.equal(r.pipelineAdvancedSettings.optimize.avifChromaSubsampling, '4:4:4');
  } finally { cleanup(tmp); }
});

// =============================================================================
// T2: Valid values round-trip verbatim. Each sub-key with a valid value.
// =============================================================================
test('AUDIT T2a: every valid sub-key round-trips verbatim through write → read', () => {
  const { tmp, state } = freshState();
  try {
    // Use ONLY values that aren't 0 — the `|| default` falsy-fallback
    // in state.js means 0 gets replaced by the default for several
    // fields. We're testing the round-trip path, not the falsy bug,
    // so pick non-zero values.
    const written = state.write({
      tabs: {},
      pipelineAdvancedSettings: {
        realesrgan: { tileSize: 512, ttaMode: true, gpuId: '2' },
        isnetbg: { intraOpNumThreads: 8, interOpNumThreads: 4, executionMode: 'parallel' },
        optimize: {
          jpegChromaSubsampling: '4:4:4',
          jpegMozjpeg: false,
          pngCompressionLevel: 3,
          pngPalette: false,
          webpMode: 'lossless',
          webpEffort: 2,
          avifEffort: 4,
          avifChromaSubsampling: '4:2:0',
        },
        audio: {
          silenceThresholdDb: -70,
          minSilenceMs: 200,
          mp3Quality: 1,        // 0 would be replaced by 2 (falsy-fallback defect)
          oggQuality: 10,
          opusBitrate: '256k',
          m4aBitrate: '320k',
        },
      },
    });
    // in-memory
    assert.equal(written.pipelineAdvancedSettings.realesrgan.tileSize, 512);
    assert.equal(written.pipelineAdvancedSettings.realesrgan.ttaMode, true);
    assert.equal(written.pipelineAdvancedSettings.realesrgan.gpuId, '2');
    assert.equal(written.pipelineAdvancedSettings.isnetbg.intraOpNumThreads, 8);
    assert.equal(written.pipelineAdvancedSettings.isnetbg.interOpNumThreads, 4);
    assert.equal(written.pipelineAdvancedSettings.isnetbg.executionMode, 'parallel');
    assert.equal(written.pipelineAdvancedSettings.optimize.jpegChromaSubsampling, '4:4:4');
    assert.equal(written.pipelineAdvancedSettings.optimize.jpegMozjpeg, false);
    assert.equal(written.pipelineAdvancedSettings.optimize.pngCompressionLevel, 3);
    assert.equal(written.pipelineAdvancedSettings.optimize.pngPalette, false);
    assert.equal(written.pipelineAdvancedSettings.optimize.webpMode, 'lossless');
    assert.equal(written.pipelineAdvancedSettings.optimize.webpEffort, 2);
    assert.equal(written.pipelineAdvancedSettings.optimize.avifEffort, 4);
    assert.equal(written.pipelineAdvancedSettings.optimize.avifChromaSubsampling, '4:2:0');
    assert.equal(written.pipelineAdvancedSettings.audio.silenceThresholdDb, -70);
    assert.equal(written.pipelineAdvancedSettings.audio.minSilenceMs, 200);
    assert.equal(written.pipelineAdvancedSettings.audio.mp3Quality, 1);
    assert.equal(written.pipelineAdvancedSettings.audio.oggQuality, 10);
    assert.equal(written.pipelineAdvancedSettings.audio.opusBitrate, '256k');
    assert.equal(written.pipelineAdvancedSettings.audio.m4aBitrate, '320k');
    // round-trip via disk
    const r = state.read();
    assert.deepEqual(r.pipelineAdvancedSettings, written.pipelineAdvancedSettings);
  } finally { cleanup(tmp); }
});

test('AUDIT T2a-bug: even VALID 0 is now preserved (AUDIT-01 fixed)', () => {
  // v1.1 (audit AUDIT-01): the previous sanitiser used the
  // `Number(x) || default` pattern, which treated 0 as "missing"
  // (falsy) and replaced it with the default. For several fields,
  // 0 is a LEGITIMATE in-range value:
  //   silenceThresholdDb: 0 dB (the maximum — silence is the loudest)
  //   minSilenceMs: 0 ms (don't filter any silence)
  //   mp3Quality: 0 (highest quality, smallest file)
  //   pngCompressionLevel: 0 (zlib: no compression, fastest)
  //   webpEffort: 0 (lowest, fastest)
  //   avifEffort: 0 (lowest, fastest)
  // The new sanitiser uses `Number.isFinite(n = Number(x))` so 0
  // round-trips correctly. The range checks are also re-applied
  // after the Number() coercion, so a 0 stays 0 (in range), a
  // 99999 falls back to the default.
  const { tmp, state } = freshState();
  try {
    const w = state.write({
      tabs: {},
      pipelineAdvancedSettings: {
        audio: { silenceThresholdDb: 0, minSilenceMs: 0, mp3Quality: 0, oggQuality: 0 },
        optimize: { pngCompressionLevel: 0, webpEffort: 0, avifEffort: 0 },
      },
    });
    // All 0s are now preserved.
    assert.equal(w.pipelineAdvancedSettings.audio.silenceThresholdDb, 0,
      'silenceThresholdDb=0 must be preserved (in range [-100,0])');
    assert.equal(w.pipelineAdvancedSettings.audio.minSilenceMs, 0,
      'minSilenceMs=0 must be preserved (in range [0,10000])');
    assert.equal(w.pipelineAdvancedSettings.audio.mp3Quality, 0,
      'mp3Quality=0 must be preserved (in range [0,9] — 0 = highest)');
    assert.equal(w.pipelineAdvancedSettings.audio.oggQuality, 0,
      'oggQuality=0 must be preserved (in range [0,10])');
    assert.equal(w.pipelineAdvancedSettings.optimize.pngCompressionLevel, 0,
      'pngCompressionLevel=0 must be preserved (in range [0,9])');
    assert.equal(w.pipelineAdvancedSettings.optimize.webpEffort, 0,
      'webpEffort=0 must be preserved (in range [0,6])');
    assert.equal(w.pipelineAdvancedSettings.optimize.avifEffort, 0,
      'avifEffort=0 must be preserved (in range [0,9])');
  } finally { cleanup(tmp); }
});

// =============================================================================
// T3: Boundary tileSize values from the whitelist.
// =============================================================================
test('AUDIT T2b: every whitelisted tileSize value round-trips (0, 32, 64, 128, 256, 512, 1024, 2048)', () => {
  const whitelist = [0, 32, 64, 128, 256, 512, 1024, 2048];
  for (const v of whitelist) {
    const { tmp, state } = freshState();
    try {
      const w = state.write({ tabs: {}, pipelineAdvancedSettings: { realesrgan: { tileSize: v } } });
      assert.equal(w.pipelineAdvancedSettings.realesrgan.tileSize, v, `tileSize=${v} must round-trip`);
      const r = state.read();
      assert.equal(r.pipelineAdvancedSettings.realesrgan.tileSize, v, `tileSize=${v} must persist across read`);
    } finally { cleanup(tmp); }
  }
});

// =============================================================================
// T4: CORRUPT values — every documented corruption must coerce to the
// documented fallback. This is the core "defence against corrupted state.json"
// claim. Test each field independently and in combination.
// =============================================================================
test('AUDIT T3a: realesrgan sub-object sanitises corrupt values', () => {
  const { tmp, state } = freshState();
  try {
    // v1.1 (audit AUDIT-01 + AUDIT-03): the tileSize sanitiser
    // is now `nOr(value, 0, 2048, 0)` — any finite number in
    // [0, 2048] is preserved, everything else falls back to 0.
    // The pre-v1.1 whitelist-only check (only the renderer's
    // pre-defined [0, 32, 64, 128, 256, 512, 1024, 2048] was
    // accepted) was too strict: it rejected Custom input
    // values the user typed (e.g. 4096) and silently coerced
    // them to 0. The new range check accepts any in-range
    // number; the wrapper does the second-line validation
    // (drops values > 4096).
    const tileCases = [
      [null, 0, 'null (Number(null)=0, in range)'],
      [undefined, 0, 'undefined (NaN)'],
      [0, 0, '0 (auto, in range)'],
      [1, 1, '1 (in range — Custom value the user typed)'],
      [16, 16, '16 (in range)'],
      [31, 31, '31 (in range)'],
      [33, 33, '33 (in range, was off-whitelist pre-v1.1)'],
      [127, 127, '127 (in range)'],
      [256, 256, '256 (in range)'],
      [512, 512, '512 (in range)'],
      [1024, 1024, '1024 (in range)'],
      [2048, 2048, '2048 (max)'],
      [99999, 0, '99999 (above max -> 0)'],
      [-1, 0, '-1 (below min -> 0)'],
      ['256', 256, '"256" (numeric string, Number() coerces)'],
      ['garbage', 0, '"garbage" (NaN)'],
      [256.7, 257, '256.7 (rounds to 257, in range)'],
      [true, 1, 'true (Number(true)=1, in range)'],
      [NaN, 0, 'NaN'],
      [{}, 0, '{} (Number({})=NaN)'],
      [[256], 256, '[256] (array, Number() coerces to 256)'],
    ];
    for (const [input, expected, label] of tileCases) {
      const w = state.write({ tabs: {}, pipelineAdvancedSettings: { realesrgan: { tileSize: input } } });
      assert.equal(w.pipelineAdvancedSettings.realesrgan.tileSize, expected,
        `tileSize=${label} -> expected ${expected}, got ${w.pipelineAdvancedSettings.realesrgan.tileSize}`);
    }
    // ttaMode — only strictly true passes.
    const ttaCases = [
      [true, true, 'true'],
      [false, false, 'false'],
      [1, false, '1 (numeric)'],
      ['yes', false, '"yes" (string)'],
      [null, false, 'null'],
      [undefined, false, 'undefined'],
      ['true', false, '"true" (string, not strictly true)'],
      [{}, false, '{} (object)'],
    ];
    for (const [input, expected, label] of ttaCases) {
      const w = state.write({ tabs: {}, pipelineAdvancedSettings: { realesrgan: { ttaMode: input } } });
      assert.equal(w.pipelineAdvancedSettings.realesrgan.ttaMode, expected,
        `ttaMode=${label} -> expected ${expected}, got ${w.pipelineAdvancedSettings.realesrgan.ttaMode}`);
    }
    // gpuId — whitelist 'auto' | '0' | '1' | '2' | '3'.
    const gpuCases = [
      ['auto', 'auto', "'auto'"],
      ['0', '0', "'0'"],
      ['1', '1', "'1'"],
      ['2', '2', "'2'"],
      ['3', '3', "'3'"],
      ['4', 'auto', "'4' (off-whitelist)"],
      ['99', 'auto', "'99' (off-whitelist)"],
      ['', 'auto', "empty string"],
      [null, 'auto', 'null'],
      [undefined, 'auto', 'undefined'],
      [1, 'auto', 'number 1 (not a string)'],
      [0, 'auto', 'number 0 (not a string)'],
      [{}, 'auto', '{} (object)'],
      [[0], 'auto', '[0] (array)'],
    ];
    for (const [input, expected, label] of gpuCases) {
      const w = state.write({ tabs: {}, pipelineAdvancedSettings: { realesrgan: { gpuId: input } } });
      assert.equal(w.pipelineAdvancedSettings.realesrgan.gpuId, expected,
        `gpuId=${label} -> expected ${expected}, got ${w.pipelineAdvancedSettings.realesrgan.gpuId}`);
    }
  } finally { cleanup(tmp); }
});

test('AUDIT T3b: isnetbg sub-object sanitises corrupt values', () => {
  const { tmp, state } = freshState();
  try {
    // intraOpNumThreads — clamp to [0, 64]. v1.1 (AUDIT-01):
    // out-of-range values now fall back to the documented
    // DEFAULT (0), not a silent clamp. 65 -> 0 (default) per
    // the new sanitiser.
    const intraCases = [
      [0, 0, '0 (default)'],
      [1, 1, '1'],
      [32, 32, '32'],
      [64, 64, '64 (max)'],
      [65, 0, '65 (above max -> 0 = default)'],
      [99, 0, '99 (above max -> 0 = default)'],
      [128, 0, '128 (above max -> 0 = default)'],
      [-1, 0, '-1 (below min -> 0 = default)'],
      [-100, 0, '-100 (below min -> 0 = default)'],
      ['4', 4, '"4" (numeric string)'],
      ['garbage', 0, '"garbage" (NaN)'],
      [null, 0, 'null (default)'],
      [undefined, 0, 'undefined (default)'],
      [4.7, 5, '4.7 (rounds to 5)'],
      [4.4, 4, '4.4 (rounds to 4)'],
    ];
    for (const [input, expected, label] of intraCases) {
      const w = state.write({ tabs: {}, pipelineAdvancedSettings: { isnetbg: { intraOpNumThreads: input } } });
      assert.equal(w.pipelineAdvancedSettings.isnetbg.intraOpNumThreads, expected,
        `intraOpNumThreads=${label} -> expected ${expected}, got ${w.pipelineAdvancedSettings.isnetbg.intraOpNumThreads}`);
    }
    // interOpNumThreads — same range. v1.1: out-of-range -> 0
    // (default), not a silent clamp.
    const interCases = [
      [0, 0, '0 (default)'],
      [1, 1, '1'],
      [64, 64, '64 (max)'],
      [65, 0, '65 (above max -> 0 = default)'],
      [-1, 0, '-1 (below min -> 0 = default)'],
      ['2', 2, '"2" (numeric string)'],
    ];
    for (const [input, expected, label] of interCases) {
      const w = state.write({ tabs: {}, pipelineAdvancedSettings: { isnetbg: { interOpNumThreads: input } } });
      assert.equal(w.pipelineAdvancedSettings.isnetbg.interOpNumThreads, expected,
        `interOpNumThreads=${label} -> expected ${expected}, got ${w.pipelineAdvancedSettings.isnetbg.interOpNumThreads}`);
    }
    // executionMode — only 'sequential' or 'parallel'
    const modeCases = [
      ['sequential', 'sequential', "'sequential'"],
      ['parallel', 'parallel', "'parallel'"],
      ['PARALLEL', 'sequential', "'PARALLEL' (case-sensitive)"],
      ['', 'sequential', 'empty string'],
      [null, 'sequential', 'null'],
      [undefined, 'sequential', 'undefined'],
      [1, 'sequential', 'number 1'],
      [{}, 'sequential', '{} (object)'],
    ];
    for (const [input, expected, label] of modeCases) {
      const w = state.write({ tabs: {}, pipelineAdvancedSettings: { isnetbg: { executionMode: input } } });
      assert.equal(w.pipelineAdvancedSettings.isnetbg.executionMode, expected,
        `executionMode=${label} -> expected ${expected}, got ${w.pipelineAdvancedSettings.isnetbg.executionMode}`);
    }
  } finally { cleanup(tmp); }
});

test('AUDIT T3c: optimize sub-object sanitises corrupt values', () => {
  const { tmp, state } = freshState();
  try {
    // jpegChromaSubsampling — only '4:2:0' | '4:4:4'
    const jpegCS = [
      ['4:2:0', '4:2:0', "'4:2:0' (default)"],
      ['4:4:4', '4:4:4', "'4:4:4'"],
      ['4:1:1', '4:2:0', "'4:1:1' (off-whitelist)"],
      ['', '4:2:0', "empty string"],
      [null, '4:2:0', 'null'],
      [undefined, '4:2:0', 'undefined'],
    ];
    for (const [input, expected, label] of jpegCS) {
      const w = state.write({ tabs: {}, pipelineAdvancedSettings: { optimize: { jpegChromaSubsampling: input } } });
      assert.equal(w.pipelineAdvancedSettings.optimize.jpegChromaSubsampling, expected,
        `jpegChromaSubsampling=${label} -> expected ${expected}, got ${w.pipelineAdvancedSettings.optimize.jpegChromaSubsampling}`);
    }
    // pngCompressionLevel — clamp to [0, 9]. v1.1 (AUDIT-01): 0 is
    // now preserved (pre-v1.1 the `|| 9` falsy default ate it).
    const pngLvl = [
      [0, 0, '0 (min — fastest encode, no compression)'],
      [1, 1, '1'],
      [9, 9, '9 (max — slowest encode, smallest file)'],
      [10, 9, '10 (clamp)'],
      [99, 9, '99 (clamp)'],
      [-5, 9, '-5 (clamp to max — pre-v1.1 returned 1; now returns 9 = default for out-of-range)'],
      ['5', 5, '"5" (numeric string)'],
      ['garbage', 9, '"garbage" (default 9)'],
      [null, 9, 'null (default 9)'],
      [undefined, 9, 'undefined (default 9)'],
      [5.7, 6, '5.7 (rounds to 6)'],
    ];
    for (const [input, expected, label] of pngLvl) {
      const w = state.write({ tabs: {}, pipelineAdvancedSettings: { optimize: { pngCompressionLevel: input } } });
      assert.equal(w.pipelineAdvancedSettings.optimize.pngCompressionLevel, expected,
        `pngCompressionLevel=${label} -> expected ${expected}, got ${w.pipelineAdvancedSettings.optimize.pngCompressionLevel}`);
    }
    // webpMode — only 'lossy' | 'lossless' | 'nearLossless'
    const wm = [
      ['lossy', 'lossy', "'lossy' (default)"],
      ['lossless', 'lossless', "'lossless'"],
      ['nearLossless', 'nearLossless', "'nearLossless'"],
      ['best', 'lossy', "'best' (off-whitelist)"],
      ['', 'lossy', "empty string"],
      [null, 'lossy', 'null'],
      [undefined, 'lossy', 'undefined'],
      [1, 'lossy', 'number 1'],
    ];
    for (const [input, expected, label] of wm) {
      const w = state.write({ tabs: {}, pipelineAdvancedSettings: { optimize: { webpMode: input } } });
      assert.equal(w.pipelineAdvancedSettings.optimize.webpMode, expected,
        `webpMode=${label} -> expected ${expected}, got ${w.pipelineAdvancedSettings.optimize.webpMode}`);
    }
    // webpEffort — clamp to [0, 6]. v1.1 (AUDIT-01): 0 is now
    // preserved (pre-v1.1 the `|| 6` falsy default ate it).
    const we = [
      [0, 0, '0 (min — fastest encode)'],
      [6, 6, '6 (max)'],
      [7, 6, '7 (clamp)'],
      [-1, 6, '-1 (clamp — pre-v1.1 returned 0; now returns 6 = default for out-of-range)'],
      [99, 6, '99 (clamp)'],
      [3.5, 4, '3.5 (rounds to 4)'],
      ['garbage', 6, '"garbage" (default 6)'],
      [null, 6, 'null (default 6)'],
      [undefined, 6, 'undefined (default 6)'],
    ];
    for (const [input, expected, label] of we) {
      const w = state.write({ tabs: {}, pipelineAdvancedSettings: { optimize: { webpEffort: input } } });
      assert.equal(w.pipelineAdvancedSettings.optimize.webpEffort, expected,
        `webpEffort=${label} -> expected ${expected}, got ${w.pipelineAdvancedSettings.optimize.webpEffort}`);
    }
    // avifEffort — clamp to [0, 9]. v1.1 (AUDIT-01): 0 is now
    // preserved (pre-v1.1 the `|| 9` falsy default ate it).
    const ae = [
      [0, 0, '0 (min — fastest encode)'],
      [9, 9, '9 (max)'],
      [10, 9, '10 (clamp)'],
      [-1, 9, '-1 (clamp — pre-v1.1 returned 0; now returns 9 = default for out-of-range)'],
      [99, 9, '99 (clamp)'],
      [4.4, 4, '4.4 (rounds to 4)'],
    ];
    for (const [input, expected, label] of ae) {
      const w = state.write({ tabs: {}, pipelineAdvancedSettings: { optimize: { avifEffort: input } } });
      assert.equal(w.pipelineAdvancedSettings.optimize.avifEffort, expected,
        `avifEffort=${label} -> expected ${expected}, got ${w.pipelineAdvancedSettings.optimize.avifEffort}`);
    }
    // avifChromaSubsampling — only '4:4:4' | '4:2:0'
    const acs = [
      ['4:4:4', '4:4:4', "'4:4:4' (default)"],
      ['4:2:0', '4:2:0', "'4:2:0'"],
      ['4:1:1', '4:4:4', "'4:1:1' (off-whitelist)"],
      ['', '4:4:4', "empty string"],
      [null, '4:4:4', 'null'],
    ];
    for (const [input, expected, label] of acs) {
      const w = state.write({ tabs: {}, pipelineAdvancedSettings: { optimize: { avifChromaSubsampling: input } } });
      assert.equal(w.pipelineAdvancedSettings.optimize.avifChromaSubsampling, expected,
        `avifChromaSubsampling=${label} -> expected ${expected}, got ${w.pipelineAdvancedSettings.optimize.avifChromaSubsampling}`);
    }
    // jpegMozjpeg — anything other than strictly false is true
    const jm = [
      [true, true, 'true (default)'],
      [false, false, 'false (explicit off)'],
      [null, true, 'null (default true)'],
      [undefined, true, 'undefined (default true)'],
      ['no', true, '"no" (default true)'],
      [0, true, '0 (default true)'],
      [1, true, '1 (default true)'],
    ];
    for (const [input, expected, label] of jm) {
      const w = state.write({ tabs: {}, pipelineAdvancedSettings: { optimize: { jpegMozjpeg: input } } });
      assert.equal(w.pipelineAdvancedSettings.optimize.jpegMozjpeg, expected,
        `jpegMozjpeg=${label} -> expected ${expected}, got ${w.pipelineAdvancedSettings.optimize.jpegMozjpeg}`);
    }
    // pngPalette — same shape
    const pp = [
      [true, true, 'true (default)'],
      [false, false, 'false (explicit off)'],
      [null, true, 'null (default true)'],
      [undefined, true, 'undefined (default true)'],
      [0, true, '0 (default true)'],
    ];
    for (const [input, expected, label] of pp) {
      const w = state.write({ tabs: {}, pipelineAdvancedSettings: { optimize: { pngPalette: input } } });
      assert.equal(w.pipelineAdvancedSettings.optimize.pngPalette, expected,
        `pngPalette=${label} -> expected ${expected}, got ${w.pipelineAdvancedSettings.optimize.pngPalette}`);
    }
  } finally { cleanup(tmp); }
});

test('AUDIT T3d: audio sub-object sanitises corrupt values', () => {
  const { tmp, state } = freshState();
  try {
    // silenceThresholdDb — clamp to [-100, 0]. v1.1 (AUDIT-01):
    // 0 is now preserved (pre-v1.1 the `|| -50` falsy default ate it).
    const st = [
      [-100, -100, '-100 (min)'],
      [0, 0, '0 (max — loudest possible silence threshold)'],
      [-50, -50, '-50 (default)'],
      [50, -50, '50 (clamp — pre-v1.1 returned 0; now returns -50 = default for out-of-range)'],
      [-101, -50, '-101 (clamp — pre-v1.1 returned -100; now returns -50 = default)'],
      [1, -50, '1 (clamp — pre-v1.1 returned 0; now returns -50 = default)'],
      ['-30', -30, '"-30" (numeric string)'],
      ['garbage', -50, '"garbage" (default -50)'],
      [null, -50, 'null (default -50)'],
      [undefined, -50, 'undefined (default -50)'],
      [-30.7, -31, '-30.7 (rounds to -31)'],
    ];
    for (const [input, expected, label] of st) {
      const w = state.write({ tabs: {}, pipelineAdvancedSettings: { audio: { silenceThresholdDb: input } } });
      assert.equal(w.pipelineAdvancedSettings.audio.silenceThresholdDb, expected,
        `silenceThresholdDb=${label} -> expected ${expected}, got ${w.pipelineAdvancedSettings.audio.silenceThresholdDb}`);
    }
    // minSilenceMs — clamp to [0, 10000]. v1.1 (AUDIT-01): 0 is
    // now preserved (pre-v1.1 the `|| 50` falsy default ate it).
    const ms = [
      [0, 0, '0 (no minimum — trim every silent run)'],
      [50, 50, '50 (default)'],
      [10000, 10000, '10000 (max)'],
      [10001, 50, '10001 (clamp — pre-v1.1 returned 10000; now returns 50 = default for out-of-range)'],
      [-100, 50, '-100 (clamp — pre-v1.1 returned 0; now returns 50 = default)'],
      ['100', 100, '"100" (numeric string)'],
      [null, 50, 'null (default 50)'],
    ];
    for (const [input, expected, label] of ms) {
      const w = state.write({ tabs: {}, pipelineAdvancedSettings: { audio: { minSilenceMs: input } } });
      assert.equal(w.pipelineAdvancedSettings.audio.minSilenceMs, expected,
        `minSilenceMs=${label} -> expected ${expected}, got ${w.pipelineAdvancedSettings.audio.minSilenceMs}`);
    }
    // mp3Quality — clamp to [0, 9]. v1.1 (AUDIT-01): 0 is now
    // preserved (pre-v1.1 the `|| 2` falsy default ate it). 0 is
    // "highest quality" in libmp3lame — the entire point of the
    // AUDIT-01 fix.
    const mq = [
      [0, 0, '0 (highest quality — preserved)'],
      [9, 9, '9 (smallest)'],
      [10, 2, '10 (clamp — pre-v1.1 returned 9; now returns 2 = default for out-of-range)'],
      [99, 2, '99 (clamp)'],
      [-1, 2, '-1 (clamp — pre-v1.1 returned 0; now returns 2 = default)'],
      ['3', 3, '"3" (numeric string)'],
      [null, 2, 'null (default 2)'],
      [undefined, 2, 'undefined (default 2)'],
      [3.4, 3, '3.4 (rounds to 3)'],
    ];
    for (const [input, expected, label] of mq) {
      const w = state.write({ tabs: {}, pipelineAdvancedSettings: { audio: { mp3Quality: input } } });
      assert.equal(w.pipelineAdvancedSettings.audio.mp3Quality, expected,
        `mp3Quality=${label} -> expected ${expected}, got ${w.pipelineAdvancedSettings.audio.mp3Quality}`);
    }
    // oggQuality — clamp to [0, 10]. v1.1 (AUDIT-01): 0 is now
    // preserved (pre-v1.1 the `|| 6` falsy default ate it).
    const oq = [
      [0, 0, '0 (highest quality — preserved)'],
      [10, 10, '10 (max)'],
      [11, 6, '11 (clamp — pre-v1.1 returned 10; now returns 6 = default for out-of-range)'],
      [-1, 6, '-1 (clamp — pre-v1.1 returned 0; now returns 6 = default)'],
      [null, 6, 'null (default 6)'],
      ['5', 5, '"5" (numeric string)'],
    ];
    for (const [input, expected, label] of oq) {
      const w = state.write({ tabs: {}, pipelineAdvancedSettings: { audio: { oggQuality: input } } });
      assert.equal(w.pipelineAdvancedSettings.audio.oggQuality, expected,
        `oggQuality=${label} -> expected ${expected}, got ${w.pipelineAdvancedSettings.audio.oggQuality}`);
    }
    // opusBitrate — v1.1 (AUDIT-07): the state sanitiser now
    // mirrors the renderer's documented whitelist
    // ['64k', '96k', '128k', '160k', '192k', '256k']. The
    // pre-v1.1 regex `/^\d+k$/` accepted any value in that
    // shape (e.g. '500k'), so a hand-edited state.json could
    // land a non-renderer-known bitrate in the AudioCutter.
    const ob = [
      ['64k', '64k', "'64k'"],
      ['128k', '128k', "'128k' (default)"],
      ['500kbps', '128k', "'500kbps' (no 'k$' suffix)"],
      [128, '128k', 'number 128'],
      ['500k', '128k', "'500k' (regex matches but NOT in renderer whitelist)"],
      ['1k', '128k', "'1k' (regex matches but NOT in renderer whitelist)"],
      ['', '128k', "empty string"],
      [null, '128k', 'null'],
      ['128', '128k', "'128' (no k suffix)"],
    ];
    for (const [input, expected, label] of ob) {
      const w = state.write({ tabs: {}, pipelineAdvancedSettings: { audio: { opusBitrate: input } } });
      assert.equal(w.pipelineAdvancedSettings.audio.opusBitrate, expected,
        `opusBitrate=${label} -> expected ${expected}, got ${w.pipelineAdvancedSettings.audio.opusBitrate}`);
    }
    // m4aBitrate — v1.1 (AUDIT-07): same whitelist
    // ['96k', '128k', '160k', '192k', '256k', '320k'].
    const mb = [
      ['96k', '96k', "'96k'"],
      ['320k', '320k', "'320k'"],
      ['500kbps', '192k', "'500kbps' (no 'k$' suffix)"],
      [192, '192k', 'number 192'],
      [null, '192k', 'null'],
      ['500k', '192k', "'500k' (regex matches but NOT in renderer whitelist)"],
    ];
    for (const [input, expected, label] of mb) {
      const w = state.write({ tabs: {}, pipelineAdvancedSettings: { audio: { m4aBitrate: input } } });
      assert.equal(w.pipelineAdvancedSettings.audio.m4aBitrate, expected,
        `m4aBitrate=${label} -> expected ${expected}, got ${w.pipelineAdvancedSettings.audio.m4aBitrate}`);
    }
  } finally { cleanup(tmp); }
});

// =============================================================================
// T5: PARTIAL sub-objects. Each sub-key may be partially present (e.g. only
// realesrgan, no optimize). Verify the absent sub-objects get the full
// default and the present ones keep their values.
// =============================================================================
test('AUDIT T4: PARTIAL pipelineAdvancedSettings — only the present sub-object is kept, the rest gets defaults', () => {
  const { tmp, state } = freshState();
  try {
    const w = state.write({
      tabs: {},
      pipelineAdvancedSettings: {
        realesrgan: { tileSize: 512, ttaMode: true, gpuId: '1' },
        // isnetbg, optimize, audio omitted entirely
      },
    });
    assertShapeValid(w);
    // The present sub-object kept its values.
    assert.equal(w.pipelineAdvancedSettings.realesrgan.tileSize, 512);
    assert.equal(w.pipelineAdvancedSettings.realesrgan.ttaMode, true);
    assert.equal(w.pipelineAdvancedSettings.realesrgan.gpuId, '1');
    // The absent sub-objects got the full default.
    assert.equal(w.pipelineAdvancedSettings.isnetbg.executionMode, 'sequential');
    assert.equal(w.pipelineAdvancedSettings.optimize.jpegChromaSubsampling, '4:2:0');
    assert.equal(w.pipelineAdvancedSettings.audio.mp3Quality, 2);
  } finally { cleanup(tmp); }
});

// =============================================================================
// T6: Each sub-key OMITTED individually. The documented behaviour is that
// the sanitiser for that sub-key falls back to the default. Verify each
// fallback path is actually reachable.
// =============================================================================
test('AUDIT T5: each individual sub-key OMITTED — falls back to the default', () => {
  const { tmp, state } = freshState();
  try {
    // Omit just tileSize. Comment says: "0" (whitelist fallback).
    let w = state.write({ tabs: {}, pipelineAdvancedSettings: { realesrgan: { ttaMode: true } } });
    assert.equal(w.pipelineAdvancedSettings.realesrgan.tileSize, 0, 'omitted tileSize -> 0');
    // Omit just ttaMode -> false
    w = state.write({ tabs: {}, pipelineAdvancedSettings: { realesrgan: { tileSize: 256 } } });
    assert.equal(w.pipelineAdvancedSettings.realesrgan.ttaMode, false, 'omitted ttaMode -> false');
    // Omit just gpuId -> 'auto'
    w = state.write({ tabs: {}, pipelineAdvancedSettings: { realesrgan: { tileSize: 256, ttaMode: true } } });
    assert.equal(w.pipelineAdvancedSettings.realesrgan.gpuId, 'auto', 'omitted gpuId -> auto');
    // Omit intraOpNumThreads -> 0
    w = state.write({ tabs: {}, pipelineAdvancedSettings: { isnetbg: { executionMode: 'parallel' } } });
    assert.equal(w.pipelineAdvancedSettings.isnetbg.intraOpNumThreads, 0);
    // Omit interOpNumThreads -> 0
    w = state.write({ tabs: {}, pipelineAdvancedSettings: { isnetbg: { intraOpNumThreads: 4 } } });
    assert.equal(w.pipelineAdvancedSettings.isnetbg.interOpNumThreads, 0);
    // Omit executionMode -> sequential
    w = state.write({ tabs: {}, pipelineAdvancedSettings: { isnetbg: { intraOpNumThreads: 4 } } });
    assert.equal(w.pipelineAdvancedSettings.isnetbg.executionMode, 'sequential');
    // Omit a few optimize fields.
    w = state.write({ tabs: {}, pipelineAdvancedSettings: { optimize: { webpMode: 'lossless' } } });
    assert.equal(w.pipelineAdvancedSettings.optimize.jpegChromaSubsampling, '4:2:0', 'omitted jpegChromaSubsampling -> 4:2:0');
    assert.equal(w.pipelineAdvancedSettings.optimize.jpegMozjpeg, true, 'omitted jpegMozjpeg -> true');
    assert.equal(w.pipelineAdvancedSettings.optimize.pngCompressionLevel, 9, 'omitted pngCompressionLevel -> 9');
    assert.equal(w.pipelineAdvancedSettings.optimize.pngPalette, true, 'omitted pngPalette -> true');
    assert.equal(w.pipelineAdvancedSettings.optimize.webpMode, 'lossless', 'present webpMode -> lossless');
    assert.equal(w.pipelineAdvancedSettings.optimize.webpEffort, 6, 'omitted webpEffort -> 6');
    assert.equal(w.pipelineAdvancedSettings.optimize.avifEffort, 9, 'omitted avifEffort -> 9');
    assert.equal(w.pipelineAdvancedSettings.optimize.avifChromaSubsampling, '4:4:4', 'omitted avifChromaSubsampling -> 4:4:4');
    // Omit a few audio fields. Use a non-falsy value because of the
    // `|| default` falsy fallback in state.js — passing 0 triggers
    // the fallback even though 0 is a valid value (separate defect,
    // see AUDIT T3d).
    w = state.write({ tabs: {}, pipelineAdvancedSettings: { audio: { mp3Quality: 1 } } });
    assert.equal(w.pipelineAdvancedSettings.audio.silenceThresholdDb, -50);
    assert.equal(w.pipelineAdvancedSettings.audio.minSilenceMs, 50);
    assert.equal(w.pipelineAdvancedSettings.audio.mp3Quality, 1, 'present mp3Quality -> 1');
    assert.equal(w.pipelineAdvancedSettings.audio.oggQuality, 6);
    assert.equal(w.pipelineAdvancedSettings.audio.opusBitrate, '128k');
    assert.equal(w.pipelineAdvancedSettings.audio.m4aBitrate, '192k');
  } finally { cleanup(tmp); }
});

// =============================================================================
// T7: pipe through both paths. write() returns the cleaned object AND
// persists to disk. read() reads back from disk. Verify both paths return
// the same shape and values, AND that read()'s in-memory sanitisation
// kicks in on a hand-crafted corrupted state.json (defence layer).
// =============================================================================
test('AUDIT T6: write() cleaned object == read() post-disk object (both paths)', () => {
  const { tmp, state } = freshState();
  try {
    const written = state.write({
      tabs: {},
      pipelineAdvancedSettings: {
        realesrgan: { tileSize: 1024, ttaMode: true, gpuId: '3' },
        isnetbg: { intraOpNumThreads: 12, interOpNumThreads: 6, executionMode: 'parallel' },
        optimize: { jpegChromaSubsampling: '4:4:4', jpegMozjpeg: false, pngCompressionLevel: 3,
                    pngPalette: false, webpMode: 'nearLossless', webpEffort: 5,
                    avifEffort: 5, avifChromaSubsampling: '4:2:0' },
        audio: { silenceThresholdDb: -80, minSilenceMs: 500, mp3Quality: 1, oggQuality: 8,
                 opusBitrate: '192k', m4aBitrate: '256k' },
      },
    });
    const reread = state.read();
    assert.deepEqual(reread.pipelineAdvancedSettings, written.pipelineAdvancedSettings,
      'read() must return the exact same shape as write() produced');
  } finally { cleanup(tmp); }
});

// =============================================================================
// T8: directly write a hand-crafted CORRUPTED state.json to disk (bypassing
// state.write), then read it. The read() path doesn't have the same
// in-line sanitisation as write() — verify what actually comes back.
// This catches "defensive read-side sanitisation missing".
// =============================================================================
test('AUDIT T7: read() of a HAND-CRAFTED corrupted state.json — sanitised (AUDIT-05 fixed)', () => {
  const { tmp, state } = freshState();
  try {
    // Hand-craft a state.json that bypasses state.write() entirely.
    const stateFile = path.join(tmp, 'state.json');
    const corrupt = {
      tabs: {},
      pipelineAdvancedSettings: {
        realesrgan: { tileSize: 99999, ttaMode: 'yes please', gpuId: '99' },
        isnetbg: { intraOpNumThreads: 9999, interOpNumThreads: -50, executionMode: 'turbo' },
        optimize: { jpegChromaSubsampling: '4:1:1', pngCompressionLevel: 99, webpMode: 'best' },
        audio: { silenceThresholdDb: 50, opusBitrate: '500kbps' },
      },
    };
    fs.writeFileSync(stateFile, JSON.stringify(corrupt, null, 2), 'utf8');
    const r = state.read();
    // v1.1 (AUDIT-05): read() now runs the same sanitiser as
    // write(), so a hand-edited state.json can NOT put bad
    // values into the renderer. Every corrupted field falls
    // back to the documented default. This is the second
    // defence layer (write-side is the first).
    const a = r.pipelineAdvancedSettings;
    console.log('AUDIT T7: read() of hand-crafted corrupted state.json returned (after sanitisation):');
    console.log('  realesrgan.tileSize =', a.realesrgan.tileSize);
    console.log('  realesrgan.ttaMode =', a.realesrgan.ttaMode);
    console.log('  realesrgan.gpuId =', a.realesrgan.gpuId);
    console.log('  isnetbg.intraOpNumThreads =', a.isnetbg.intraOpNumThreads);
    console.log('  isnetbg.interOpNumThreads =', a.isnetbg.interOpNumThreads);
    console.log('  isnetbg.executionMode =', a.isnetbg.executionMode);
    console.log('  optimize.jpegChromaSubsampling =', a.optimize.jpegChromaSubsampling);
    console.log('  optimize.pngCompressionLevel =', a.optimize.pngCompressionLevel);
    console.log('  optimize.webpMode =', a.optimize.webpMode);
    console.log('  audio.silenceThresholdDb =', a.audio.silenceThresholdDb);
    console.log('  audio.opusBitrate =', a.audio.opusBitrate);
    // Every value should be the documented default.
    assert.equal(a.realesrgan.tileSize, 0, 'read() sanitises 99999 -> 0');
    assert.equal(a.realesrgan.ttaMode, false, 'read() sanitises "yes please" -> false');
    assert.equal(a.realesrgan.gpuId, 'auto', 'read() sanitises "99" -> "auto"');
    assert.equal(a.isnetbg.intraOpNumThreads, 0, 'read() sanitises 9999 -> 0 (default)');
    assert.equal(a.isnetbg.interOpNumThreads, 0, 'read() sanitises -50 -> 0 (default)');
    assert.equal(a.isnetbg.executionMode, 'sequential', 'read() sanitises "turbo" -> "sequential"');
    assert.equal(a.optimize.jpegChromaSubsampling, '4:2:0', 'read() sanitises "4:1:1" -> "4:2:0"');
    assert.equal(a.optimize.pngCompressionLevel, 9, 'read() sanitises 99 -> 9 (default)');
    assert.equal(a.optimize.webpMode, 'lossy', 'read() sanitises "best" -> "lossy"');
    assert.equal(a.audio.silenceThresholdDb, -50, 'read() sanitises 50 -> -50 (default)');
    assert.equal(a.audio.opusBitrate, '128k', 'read() sanitises "500kbps" -> "128k"');
  } finally { cleanup(tmp); }
});

// =============================================================================
// T9: Verify state.js write() actually persists the file (atomicity).
// =============================================================================
test('AUDIT T8: state.write() actually persists a parseable JSON file to disk', () => {
  const { tmp, state } = freshState();
  try {
    state.write({ tabs: { image: { foo: 'bar' } }, pipelineAdvancedSettings: { realesrgan: { tileSize: 64 } } });
    const stateFile = path.join(tmp, 'state.json');
    assert.ok(fs.existsSync(stateFile), 'state.json must be written to MINIMAX_CONFIG_DIR');
    const raw = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(raw.tabs.image.foo, 'bar');
    assert.equal(raw.pipelineAdvancedSettings.realesrgan.tileSize, 64);
    // No temp file left behind.
    const files = fs.readdirSync(tmp);
    assert.deepEqual(files, ['state.json'], 'no leftover .tmp file');
  } finally { cleanup(tmp); }
});

// =============================================================================
// T10: write() returns the same object reference as what was just written
// to disk (so a caller using write()'s return value sees the SANITISED
// shape, not the input shape). This catches "I wrote a corrupt value and
// the in-memory copy disagrees with disk".
// =============================================================================
test('AUDIT T9: write() return value reflects the SANITISED shape, not the input', () => {
  const { tmp, state } = freshState();
  try {
    const w = state.write({
      tabs: {},
      pipelineAdvancedSettings: {
        realesrgan: { tileSize: 99999, ttaMode: 'yes', gpuId: 1 },
        isnetbg: { intraOpNumThreads: 9999, interOpNumThreads: -1, executionMode: 'turbo' },
      },
    });
    // v1.1 (AUDIT-01): out-of-range values now fall back to the
    // DEFAULT (not the closest clamp). 9999 -> 0 (the
    // intraOpNumThreads default), -1 -> 0 (the interOpNumThreads
    // default). The previous test expected 64 / 0 (clamp)
    // because the pre-v1.1 sanitiser used `Math.max/Math.min`
    // before the `|| default` fallback. The new behaviour is
    // more conservative — a clearly out-of-range value gets
    // the documented default, not a silent clamp.
    assert.equal(w.pipelineAdvancedSettings.realesrgan.tileSize, 0);
    assert.equal(w.pipelineAdvancedSettings.realesrgan.ttaMode, false);
    assert.equal(w.pipelineAdvancedSettings.realesrgan.gpuId, 'auto');
    assert.equal(w.pipelineAdvancedSettings.isnetbg.intraOpNumThreads, 0, '9999 falls back to 0 (default)');
    assert.equal(w.pipelineAdvancedSettings.isnetbg.interOpNumThreads, 0, '-1 falls back to 0 (default)');
    assert.equal(w.pipelineAdvancedSettings.isnetbg.executionMode, 'sequential');
  } finally { cleanup(tmp); }
});
