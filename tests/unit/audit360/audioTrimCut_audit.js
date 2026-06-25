// tests/unit/audit360/audioTrimCut_audit.js
// ============================================================================
// 360° EMPIRICAL AUDIT — src/audio/AudioTrimCut.js codecArgsFor
// Verifies the per-codec quality substitution is correct, the CODEC_BY_EXT
// defaults are stable, and that quality fields for unrelated codecs are
// ignored. We test codecArgsFor as a pure function (no ffmpeg / fs / spawn).
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const ATC_PATH = path.join(ROOT, 'src', 'audio', 'AudioTrimCut.js');

const { codecArgsFor, CODEC_BY_EXT } = require(ATC_PATH);

// =============================================================================
// T1: Default CODEC_BY_EXT shape — every entry has the documented codec.
// =============================================================================
test('AUDIT ATC-T1: CODEC_BY_EXT shape matches the documented default map', () => {
  assert.deepEqual(CODEC_BY_EXT, {
    wav:  ['-c:a', 'pcm_s16le'],
    mp3:  ['-c:a', 'libmp3lame', '-q:a', '2'],
    ogg:  ['-c:a', 'libvorbis', '-q:a', '6'],
    opus: ['-c:a', 'libopus', '-b:a', '128k'],
    flac: ['-c:a', 'flac'],
    m4a:  ['-c:a', 'aac', '-b:a', '192k'],
    aac:  ['-c:a', 'aac', '-b:a', '192k'],
  }, 'CODEC_BY_EXT must match the documented default map (regression pin)');
});

// =============================================================================
// T2: codecArgsFor(ext) without quality returns a COPY of the default.
// =============================================================================
test('AUDIT ATC-T2: codecArgsFor(ext) without quality returns a copy of the default', () => {
  for (const ext of ['wav', 'mp3', 'ogg', 'opus', 'flac', 'm4a', 'aac']) {
    const args = codecArgsFor(ext);
    assert.deepEqual(args, CODEC_BY_EXT[ext], `${ext} without quality must match default`);
    // Must be a NEW array (not the same reference) — otherwise a caller
    // mutating the result would mutate the module's default.
    assert.notEqual(args, CODEC_BY_EXT[ext], `${ext} must return a COPY of the default array`);
  }
});

// =============================================================================
// T3: Unknown extension falls back to pcm_s16le.
// =============================================================================
test('AUDIT ATC-T3: unknown extension falls back to pcm_s16le', () => {
  assert.deepEqual(codecArgsFor('xyz'), ['-c:a', 'pcm_s16le']);
  assert.deepEqual(codecArgsFor(''), ['-c:a', 'pcm_s16le']);
});

  // =============================================================================
  // T4: MP3 quality override substitutes -q:a with the new value.
  // =============================================================================
  test('AUDIT ATC-T4: MP3 quality override — every valid + edge value', () => {
    // MP3: range [0, 9]. 0 = highest, 9 = smallest.
    // v1.1 (AUDIT-06): string numbers ('5', '0') are now coerced
    // via Number(value) and accepted. Pre-v1.1 the strict
    // Number.isFinite() check rejected them, falling back to the
    // default '-q:a 2'. The new behaviour matches the public API
    // (any caller can pass a number or a numeric string).
    const cases = [
      { q: 0, expect: '0' },
      { q: 1, expect: '1' },
      { q: 2, expect: '2' }, // default
      { q: 5, expect: '5' },
      { q: 9, expect: '9' },
      { q: -1, expect: '0' },   // clamp
      { q: 10, expect: '9' },   // clamp
      { q: 99, expect: '9' },   // clamp
      { q: 3.7, expect: '4' },  // rounds
      // v1.1 (AUDIT-06): string numbers are now coerced.
      { q: '5', expect: '5' },
      { q: '0', expect: '0' },
      { q: '9', expect: '9' },
      // Non-numeric strings still fall back to the default.
      { q: 'abc', expect: '2' },
    ];
    for (const c of cases) {
      const args = codecArgsFor('mp3', { mp3Quality: c.q });
      assert.deepEqual(args, ['-c:a', 'libmp3lame', '-q:a', c.expect],
        `mp3 mp3Quality=${JSON.stringify(c.q)} -> -q:a ${c.expect}`);
    }
  });

// =============================================================================
// T5: OGG quality override — range [0, 10], different from MP3.
// =============================================================================
test('AUDIT ATC-T5: OGG quality override — every valid + edge value', () => {
  const cases = [
    { q: 0, expect: '0' },
    { q: 1, expect: '1' },
    { q: 6, expect: '6' }, // default
    { q: 10, expect: '10' },
    { q: -1, expect: '0' },
    { q: 11, expect: '10' },
    { q: 99, expect: '10' },
    { q: 5.5, expect: '6' },
  ];
  for (const c of cases) {
    const args = codecArgsFor('ogg', { oggQuality: c.q });
    assert.deepEqual(args, ['-c:a', 'libvorbis', '-q:a', c.expect],
      `ogg oggQuality=${JSON.stringify(c.q)} -> -q:a ${c.expect}`);
  }
});

// =============================================================================
// T6: Opus bitrate override substitutes -b:a.
// =============================================================================
test('AUDIT ATC-T6: Opus bitrate override — only valid "<digits>k" strings are accepted', () => {
  const cases = [
    { q: '64k', expect: '64k' },
    { q: '96k', expect: '96k' },
    { q: '128k', expect: '128k' }, // default
    { q: '160k', expect: '160k' },
    { q: '192k', expect: '192k' },
    { q: '256k', expect: '256k' },
    { q: '500kbps', expect: null },   // wrong suffix
    { q: '128', expect: null },        // no k
    { q: 128, expect: null },          // number
    { q: '', expect: null },
    { q: null, expect: null },
    { q: undefined, expect: null },
  ];
  for (const c of cases) {
    const args = codecArgsFor('opus', { opusBitrate: c.q });
    if (c.expect === null) {
      // Falls back to default.
      assert.deepEqual(args, CODEC_BY_EXT.opus,
        `opus opusBitrate=${JSON.stringify(c.q)} must fall back to default`);
    } else {
      assert.deepEqual(args, ['-c:a', 'libopus', '-b:a', c.expect],
        `opus opusBitrate=${JSON.stringify(c.q)} -> -b:a ${c.expect}`);
    }
  }
});

// =============================================================================
// T7: M4A / AAC bitrate override.
// =============================================================================
test('AUDIT ATC-T7: M4A / AAC bitrate override — applies to both m4a and aac extensions', () => {
  // M4A
  const m4a = codecArgsFor('m4a', { m4aBitrate: '256k' });
  assert.deepEqual(m4a, ['-c:a', 'aac', '-b:a', '256k']);
  // AAC extension is also accepted.
  const aac = codecArgsFor('aac', { m4aBitrate: '256k' });
  assert.deepEqual(aac, ['-c:a', 'aac', '-b:a', '256k']);
  // Garbage falls back.
  const bad = codecArgsFor('m4a', { m4aBitrate: '500kbps' });
  assert.deepEqual(bad, CODEC_BY_EXT.m4a, 'invalid m4aBitrate falls back to default');
});

// =============================================================================
// T8: Cross-codec isolation — MP3 quality doesn't affect OGG output, etc.
// =============================================================================
test('AUDIT ATC-T8: cross-codec isolation — quality for codec A does NOT change codec B output', () => {
  // MP3 quality passed when asking for ogg -> ogg default.
  const o = codecArgsFor('ogg', { mp3Quality: 0 });
  assert.deepEqual(o, CODEC_BY_EXT.ogg, 'mp3 quality must not affect ogg');
  // Opus bitrate passed when asking for mp3 -> mp3 default.
  const m = codecArgsFor('mp3', { opusBitrate: '64k' });
  assert.deepEqual(m, CODEC_BY_EXT.mp3, 'opus bitrate must not affect mp3');
  // M4A bitrate passed when asking for opus -> opus default.
  const p = codecArgsFor('opus', { m4aBitrate: '64k' });
  assert.deepEqual(p, CODEC_BY_EXT.opus, 'm4a bitrate must not affect opus');
  // OGG quality passed when asking for flac -> flac default.
  const f = codecArgsFor('flac', { oggQuality: 0 });
  assert.deepEqual(f, CODEC_BY_EXT.flac, 'ogg quality must not affect flac');
  // FLAC has no quality knob — passing any quality must return FLAC default.
  const f2 = codecArgsFor('flac', { mp3Quality: 0, opusBitrate: '64k', oggQuality: 9, m4aBitrate: '128k' });
  assert.deepEqual(f2, CODEC_BY_EXT.flac, 'flac must ignore every quality override');
});

// =============================================================================
// T9: WAV has no quality knob — overrides are ignored.
// =============================================================================
test('AUDIT ATC-T9: wav (pcm_s16le) ignores every quality override (no quality knob)', () => {
  const wavIgnored = codecArgsFor('wav', { mp3Quality: 0, opusBitrate: '64k', oggQuality: 9, m4aBitrate: '128k' });
  assert.deepEqual(wavIgnored, CODEC_BY_EXT.wav, 'wav must ignore every quality override');
});

// =============================================================================
// T10: PCM extension (treated like wav) ignores overrides.
// =============================================================================
test('AUDIT ATC-T10: pcm extension — falls back to pcm_s16le and ignores overrides', () => {
  // 'pcm' is not in CODEC_BY_EXT so the default fallback kicks in.
  const pcm = codecArgsFor('pcm', { mp3Quality: 0, opusBitrate: '64k' });
  assert.deepEqual(pcm, ['-c:a', 'pcm_s16le'], 'pcm extension falls back to pcm_s16le');
});

// =============================================================================
// T11: FLAC has no quality knob — overrides are ignored.
// =============================================================================
test('AUDIT ATC-T11: flac ignores every quality override (the audit asked about this)', () => {
  // Comment in the spec said: "The pre-v1.1 implicit 'no quality knob
  // for lossless' was for wav/pcm; what about flac? opus?" Verify flac
  // behaviour.
  const flacIgnored = codecArgsFor('flac', { mp3Quality: 0, opusBitrate: '64k', oggQuality: 9, m4aBitrate: '128k' });
  assert.deepEqual(flacIgnored, CODEC_BY_EXT.flac, 'flac must ignore every quality override');
});

// =============================================================================
// T12: Opus has no mp3Quality / oggQuality / m4aBitrate knob — those are ignored.
// =============================================================================
test('AUDIT ATC-T12: opus only honours opusBitrate (other fields are ignored)', () => {
  // Pass every field except opusBitrate — result should be the default.
  const noOpus = codecArgsFor('opus', { mp3Quality: 0, oggQuality: 9, m4aBitrate: '128k' });
  assert.deepEqual(noOpus, CODEC_BY_EXT.opus, 'opus without opusBitrate must return default');
});

// =============================================================================
// T13: codecArgsFor is a pure function — calling it doesn't mutate
// CODEC_BY_EXT or the input quality object.
// =============================================================================
test('AUDIT ATC-T13: codecArgsFor is pure (no input/output mutation)', () => {
  const quality = { mp3Quality: 5 };
  const snapshot = JSON.stringify(quality);
  const r1 = codecArgsFor('mp3', quality);
  // Mutate the result.
  r1.push('-x', 'malicious');
  // The default must be unchanged.
  assert.deepEqual(CODEC_BY_EXT.mp3, ['-c:a', 'libmp3lame', '-q:a', '2'],
    'CODEC_BY_EXT.mp3 must be unchanged after mutating the result');
  // The input must be unchanged.
  assert.equal(JSON.stringify(quality), snapshot, 'input quality must be unchanged');
});

// =============================================================================
// T14: Returned array is a new array reference (defence against the
// "caller mutates the result, breaks the next call" bug).
// =============================================================================
test('AUDIT ATC-T14: every call returns a new array (no shared references)', () => {
  const a = codecArgsFor('mp3');
  const b = codecArgsFor('mp3');
  assert.notEqual(a, b, 'two calls must return DIFFERENT array instances');
  assert.deepEqual(a, b, 'but the VALUES must be equal');
  // And the module default must still be intact.
  assert.deepEqual(CODEC_BY_EXT.mp3, ['-c:a', 'libmp3lame', '-q:a', '2']);
});

// =============================================================================
// T15: The full (ext, quality) cross-product (smoke test) — every
// combination of ext + quality that could be passed must not throw.
// =============================================================================
test('AUDIT ATC-T15: every (ext, quality) combination runs without throwing', () => {
  const exts = ['mp3', 'wav', 'pcm', 'ogg', 'opus', 'flac', 'm4a', 'aac', 'unknown'];
  const qualities = [
    undefined,
    {},
    { mp3Quality: 5, oggQuality: 5, opusBitrate: '192k', m4aBitrate: '256k' },
    { mp3Quality: 0 },
    { opusBitrate: '64k' },
    { m4aBitrate: '128k' },
    { mp3Quality: -100, oggQuality: 999, opusBitrate: 'garbage', m4aBitrate: null },
  ];
  for (const ext of exts) {
    for (const q of qualities) {
      assert.doesNotThrow(() => codecArgsFor(ext, q), `(${ext}, ${JSON.stringify(q)}) must not throw`);
    }
  }
});

// =============================================================================
// T16: audioCutter.js re-exports codecArgsFor + CODEC_BY_EXT for tests.
// =============================================================================
test('AUDIT ATC-T16: audioCutter.js re-exports codecArgsFor + CODEC_BY_EXT', () => {
  const shim = require(path.join(ROOT, 'src', 'audioCutter.js'));
  assert.deepEqual(shim.CODEC_BY_EXT, CODEC_BY_EXT, 'audioCutter must re-export CODEC_BY_EXT');
  assert.equal(typeof shim.codecArgsFor, 'function', 'audioCutter must re-export codecArgsFor');
});

// =============================================================================
// T17: cut() function builds the right argv. We don't run ffmpeg; we
// verify the constructed args via a stubbed spawn. (This is a more
// behavioural test of the full cut() pipeline.)
// =============================================================================
test('AUDIT ATC-T17: cut() builds the right argv (no ffmpeg actually run)', async () => {
  // Mock AudioBinary.findBinary to return a fake path, and
  // AudioRunner.spawn to capture argv without running.
  // We do this by intercepting the module's child_process spawn.
  // (The AudioBinary module uses child_process.spawnSync for `where/which`.)
  const Module = require('module');
  const origLoad = Module._load;
  const captured = { args: null, bin: null };
  const cpMock = {
    spawn: (bin, args) => {
      captured.bin = bin;
      captured.args = args;
      // Capture close/error handlers so we can fire them after the
      // process is returned. setImmediate keeps it on the event loop.
      const handlers = {};
      const proc = {
        stderr: { on() {} },
        on(ev, fn) { handlers[ev] = fn; return proc; },
      };
      setImmediate(() => {
        if (handlers.close) handlers.close(0);
        if (handlers.error) handlers.error(new Error('test error'));
      });
      return proc;
    },
    spawnSync: (cmd) => {
      if (cmd === 'where' || cmd === 'which') {
        return { status: 0, stdout: 'C:\\fake\\ffmpeg.exe\n', stderr: '' };
      }
      return { status: 1, stdout: '', stderr: '' };
    },
  };
  const fsMock = {
    existsSync: () => true,
    renameSync: () => {},
    unlinkSync: () => {},
    statSync: () => ({ isFile: () => true, size: 100 }),
    promises: { stat: async () => ({ isFile: () => true, size: 100 }) },
  };
  Module._load = function (request, parent, ...rest) {
    if (request === 'child_process') return cpMock;
    if (request === 'fs') return fsMock;
    return origLoad.call(this, request, parent, ...rest);
  };
  try {
    // Re-require the AudioTrimCut module so the mocked child_process
    // and fs are picked up by the AudioBinary helper.
    delete require.cache[require.resolve(ATC_PATH)];
    delete require.cache[require.resolve(path.join(ROOT, 'src', 'audio', 'AudioBinary.js'))];
    const atc = require(ATC_PATH);
    const r = await atc.cut('in.mp3', 'out.mp3', { startSec: 1, endSec: 5, fadeMs: 0, fade: false });
    assert.equal(r.ok, true);
    console.log('AUDIT ATC-T17: cut argv =', captured.args);
    // The argv must start with ffmpeg flags + input + seek + duration.
    assert.ok(captured.args.includes('-hide_banner'));
    assert.ok(captured.args.includes('-nostdin'));
    assert.ok(captured.args.includes('-i'));
    assert.ok(captured.args.includes('in.mp3'));
    assert.ok(captured.args.includes('-ss'));
    assert.ok(captured.args.includes('-t'));
    assert.ok(captured.args.includes('-c:a'));
    assert.ok(captured.args.includes('libmp3lame'));
    assert.ok(captured.args.includes('-y'));
    assert.ok(captured.args.includes('out.mp3'));
  } finally {
    Module._load = origLoad;
  }
});

// =============================================================================
// T18: cut() with copy mode uses the stream-copy argv (fast seek).
// =============================================================================
test('AUDIT ATC-T18: cut() with copy: true uses -ss before -i', async () => {
  const Module = require('module');
  const origLoad = Module._load;
  const captured = { args: null, bin: null };
  const cpMock = {
    spawn: (bin, args) => {
      captured.bin = bin;
      captured.args = args;
      const handlers = {};
      const proc = {
        stderr: { on() {} },
        on(ev, fn) { handlers[ev] = fn; return proc; },
      };
      setImmediate(() => {
        if (handlers.close) handlers.close(0);
      });
      return proc;
    },
    spawnSync: (cmd) => {
      if (cmd === 'where' || cmd === 'which') {
        return { status: 0, stdout: 'C:\\fake\\ffmpeg.exe\n', stderr: '' };
      }
      return { status: 1, stdout: '', stderr: '' };
    },
  };
  const fsMock = {
    existsSync: () => true,
    renameSync: () => {},
    unlinkSync: () => {},
    statSync: () => ({ isFile: () => true, size: 100 }),
    promises: { stat: async () => ({ isFile: () => true, size: 100 }) },
  };
  Module._load = function (request, parent, ...rest) {
    if (request === 'child_process') return cpMock;
    if (request === 'fs') return fsMock;
    return origLoad.call(this, request, parent, ...rest);
  };
  try {
    delete require.cache[require.resolve(ATC_PATH)];
    delete require.cache[require.resolve(path.join(ROOT, 'src', 'audio', 'AudioBinary.js'))];
    const atc = require(ATC_PATH);
    const r = await atc.cut('in.mp3', 'out.mp3', { startSec: 1, endSec: 5, copy: true });
    assert.equal(r.ok, true);
    console.log('AUDIT ATC-T18: copy-mode argv =', captured.args);
    // In copy mode, -ss must come BEFORE -i (fast seek).
    const ssIdx = captured.args.indexOf('-ss');
    const iIdx = captured.args.indexOf('-i');
    assert.ok(ssIdx >= 0 && iIdx >= 0, '-ss and -i must both be present');
    assert.ok(ssIdx < iIdx, 'copy mode must put -ss before -i (fast seek)');
    // And the codec is 'copy', not the default libmp3lame.
    assert.ok(captured.args.includes('-c') && captured.args.includes('copy'));
    assert.ok(!captured.args.includes('libmp3lame'),
      'copy mode must NOT use the libmp3lame codec args');
  } finally {
    Module._load = origLoad;
  }
});
