// tests/unit/audit360/realesrgan_argv_audit.js
// ============================================================================
// 360° EMPIRICAL AUDIT — src/realesrgan.js run() argv building.
// Intercepts child_process.spawn via Module._load and captures every
// argv realesrgan.run() builds for every documented opts combination.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const RE_PATH = path.join(ROOT, 'src', 'realesrgan.js');

function withMocks(opts, fn) {
  const Module = require('module');
  const origLoad = Module._load;
  const captured = { args: null, bin: null, calls: 0 };
  const cpMock = {
    spawn: (bin, args) => {
      captured.bin = bin;
      captured.args = args;
      captured.calls += 1;
      return {
        stderr: { on() {} },
        on(ev, fn) {
          if (ev === 'close') setImmediate(() => fn(0));
        },
      };
    },
    spawnSync: (cmd /* , args */) => {
      // Simulate the binary being found at a stable location.
      if (cmd === 'where' || cmd === 'which') {
        return { status: 0, stdout: 'C:\\fake\\realesrgan-ncnn-vulkan.exe\n', stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
  };
  const fsMock = {
    existsSync: () => true,
    renameSync: () => {},
    unlinkSync: () => {},
  };
  Module._load = function (request, parent, ...rest) {
    if (request === 'child_process') return cpMock;
    if (request === 'fs') return fsMock;
    return origLoad.call(this, request, parent, ...rest);
  };
  try {
    delete require.cache[require.resolve(RE_PATH)];
    const re = require(RE_PATH);
    return fn(re, captured);
  } finally {
    Module._load = origLoad;
  }
}

function argsToObj(args) {
  // Convert ['-i', 'in', '-o', 'out', '-t', '128', '-x', '-g', '1']
  // into { i: 'in', o: 'out', t: 128, x: true, g: '1' }
  const out = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('-')) {
      const k = args[i].slice(1);
      const v = args[i + 1];
      if (v !== undefined && !v.startsWith('-')) {
        out[k] = v;
        i += 1;
      } else {
        out[k] = true;
      }
    }
  }
  return out;
}

// =============================================================================
// T1: Default opts — no -t, -x, or -g flags. Only -i, -o, -n, -s, -f.
// =============================================================================
test('AUDIT RE-T1: default run() emits ONLY -i, -o, -n, -s, -f (no -t/-x/-g)', async () => {
  const captured = await withMocks({}, (re, cap) => {
    return re.run('in.png', 'out.png', { model: 'realesrgan-x4plus', scale: 4 }).then(() => cap);
  });
  const args = captured.args;
  console.log('AUDIT RE-T1: argv =', args);
  assert.deepEqual(args, ['-i', 'in.png', '-o', 'out.png', '-n', 'realesrgan-x4plus', '-s', '4', '-f', 'png'],
    'default argv must be exactly the 5 documented flags + values');
});

// =============================================================================
// T2: tileSize matrix — the v1.1 wrapper accepts any finite, in-range
// number [1, 4096] (the renderer's Custom-input range). The pre-v1.1
// wrapper silently clamped below-32 values up to 32 AND dropped 0;
// v1.1 emits -t N for any positive in-range N and drops -t for 0
// (binary default) and out-of-range values.
// =============================================================================
test('AUDIT RE-T2: tileSize matrix — in-range positive emits -t, others omit', async () => {
  const cases = [
    { tileSize: 0, expectEmit: false, expectVal: null },            // 0 = auto, drop flag
    { tileSize: 32, expectEmit: true, expectVal: '32' },
    { tileSize: 64, expectEmit: true, expectVal: '64' },
    { tileSize: 128, expectEmit: true, expectVal: '128' },
    { tileSize: 256, expectEmit: true, expectVal: '256' },
    { tileSize: 512, expectEmit: true, expectVal: '512' },
    { tileSize: 1024, expectEmit: true, expectVal: '1024' },
    { tileSize: 2048, expectEmit: true, expectVal: '2048' },
    // v1.1 (AUDIT-03): below-min tile sizes are NO LONGER silently
    // clamped. tileSize=16 used to emit -t 32 (silent clamp); it
    // now passes through as -t 16 (the user's value). The state
    // sanitiser is the gate, but the wrapper doesn't second-guess
    // the sanitiser — it just forwards the in-range value.
    { tileSize: 16, expectEmit: true, expectVal: '16' },
    { tileSize: -1, expectEmit: false, expectVal: null },           // negative -> not > 0 -> no -t
    // Custom-input values from the advanced overlay
    { tileSize: 4096, expectEmit: true, expectVal: '4096' },        // max from overlay
    { tileSize: 4097, expectEmit: false, expectVal: null },         // out of range -> drop
  ];
  for (const c of cases) {
    const captured = await withMocks({}, (re, cap) => {
      return re.run('in.png', 'out.png', { model: 'realesrgan-x4plus', scale: 4, tileSize: c.tileSize }).then(() => cap);
    });
    const args = captured.args;
    const tIdx = args.indexOf('-t');
    if (c.expectEmit) {
      assert.ok(tIdx >= 0, `tileSize=${c.tileSize} must emit -t, got argv=${JSON.stringify(args)}`);
      assert.equal(args[tIdx + 1], c.expectVal, `tileSize=${c.tileSize} must emit -t ${c.expectVal}, got ${args[tIdx + 1]}`);
    } else {
      assert.equal(tIdx, -1, `tileSize=${c.tileSize} must NOT emit -t, got argv=${JSON.stringify(args)}`);
    }
  }
});

// =============================================================================
// T3: tileSize=128 (mid-range) — verify ONLY -t is emitted, not -x or -g.
// =============================================================================
test('AUDIT RE-T3: tileSize=128 emits ONLY -t (no -x, no -g)', async () => {
  const captured = await withMocks({}, (re, cap) => {
    return re.run('in.png', 'out.png', { model: 'realesrgan-x4plus', scale: 4, tileSize: 128 }).then(() => cap);
  });
  const args = captured.args;
  assert.ok(args.includes('-t') && args.includes('128'));
  assert.ok(!args.includes('-x'), 'no -x (ttaMode off)');
  assert.ok(!args.includes('-g'), 'no -g (gpuId auto)');
});

// =============================================================================
// T4: ttaMode boolean matrix.
// =============================================================================
test('AUDIT RE-T4: ttaMode matrix — true emits -x, false/garbage omits', async () => {
  const cases = [
    { ttaMode: true, expectX: true },
    { ttaMode: false, expectX: false },
    { ttaMode: 'yes', expectX: false }, // non-strict
    { ttaMode: 1, expectX: false },
    { ttaMode: null, expectX: false },
    { ttaMode: undefined, expectX: false },
  ];
  for (const c of cases) {
    const captured = await withMocks({}, (re, cap) => {
      return re.run('in.png', 'out.png', { model: 'realesrgan-x4plus', scale: 4, ttaMode: c.ttaMode }).then(() => cap);
    });
    const args = captured.args;
    const hasX = args.includes('-x');
    assert.equal(hasX, c.expectX, `ttaMode=${JSON.stringify(c.ttaMode)} expected -x=${c.expectX}, got ${hasX}`);
  }
});

// =============================================================================
// T5: gpuId matrix — v1.1 (AUDIT-04) now mirrors the state whitelist
// [auto, 0, 1, 2, 3] in the wrapper, so a hand-edited state.json
// with gpuId='99' is rejected by BOTH the state sanitiser AND the
// wrapper. The pre-v1.1 wrapper accepted any digit string,
// letting a corrupted state.json pin the binary to a non-existent
// GPU. Garbage / off-whitespace values drop the -g flag (binary
// default = auto).
// =============================================================================
test('AUDIT RE-T5: gpuId matrix — auto/garbage omit -g, valid id emits -g N', async () => {
  const cases = [
    { gpuId: 'auto', expectG: null },
    { gpuId: '0', expectG: '0' },
    { gpuId: '1', expectG: '1' },
    { gpuId: '2', expectG: '2' },
    { gpuId: '3', expectG: '3' },
    // v1.1 (AUDIT-04): off-whitelist values are now rejected
    // (the wrapper mirrors the state whitelist). The pre-v1.1
    // code passed these through, which let a corrupted state.json
    // pin a non-existent GPU. Now: '4', '99', '999' all drop -g.
    { gpuId: '4', expectG: null },       // off-whitelist -> no -g
    { gpuId: '99', expectG: null },      // off-whitelist -> no -g
    { gpuId: '999', expectG: null },     // off-whitelist -> no -g
    { gpuId: 'garbage', expectG: null }, // non-digit -> regex fails
    { gpuId: '', expectG: null },
    { gpuId: null, expectG: null },
    { gpuId: undefined, expectG: null },
  ];
  for (const c of cases) {
    const captured = await withMocks({}, (re, cap) => {
      return re.run('in.png', 'out.png', { model: 'realesrgan-x4plus', scale: 4, gpuId: c.gpuId }).then(() => cap);
    });
    const args = captured.args;
    const gIdx = args.indexOf('-g');
    if (c.expectG === null) {
      assert.equal(gIdx, -1, `gpuId=${JSON.stringify(c.gpuId)} must NOT emit -g, got ${JSON.stringify(args)}`);
    } else {
      assert.ok(gIdx >= 0, `gpuId=${JSON.stringify(c.gpuId)} must emit -g, got ${JSON.stringify(args)}`);
      assert.equal(args[gIdx + 1], c.expectG, `gpuId=${JSON.stringify(c.gpuId)} must emit -g ${c.expectG}, got ${args[gIdx + 1]}`);
    }
  }
});

// =============================================================================
// T6: threads matrix — string format validation.
// =============================================================================
test('AUDIT RE-T6: threads matrix — only "1:2:2"-shape emits -j', async () => {
  const cases = [
    { threads: '1:2:2', expectJ: '1:2:2' },
    { threads: '4:8:8', expectJ: '4:8:8' },
    { threads: '1:1:1', expectJ: '1:1:1' },
    { threads: 'garbage', expectJ: null },
    { threads: '', expectJ: null },
    { threads: '1:2', expectJ: null },     // not 3-tuple
    { threads: '1:2:2:4', expectJ: null }, // 4-tuple, not 3-tuple
    { threads: 4, expectJ: null },          // number, not string
  ];
  for (const c of cases) {
    const captured = await withMocks({}, (re, cap) => {
      return re.run('in.png', 'out.png', { model: 'realesrgan-x4plus', scale: 4, threads: c.threads }).then(() => cap);
    });
    const args = captured.args;
    const jIdx = args.indexOf('-j');
    if (c.expectJ === null) {
      assert.equal(jIdx, -1, `threads=${JSON.stringify(c.threads)} must NOT emit -j, got ${JSON.stringify(args)}`);
    } else {
      assert.ok(jIdx >= 0, `threads=${JSON.stringify(c.threads)} must emit -j, got ${JSON.stringify(args)}`);
      assert.equal(args[jIdx + 1], c.expectJ, `threads=${JSON.stringify(c.threads)} must emit -j ${c.expectJ}`);
    }
  }
});

// =============================================================================
// T7: scale matrix — the binary only natively supports 4. The wrapper
// accepts whatever the renderer passes (documented: "2/3/4/8"). Verify
// the wrapper passes scale through unchanged.
// =============================================================================
test('AUDIT RE-T7: scale is passed through to -s unchanged (2/3/4)', async () => {
  for (const s of [2, 3, 4]) {
    const captured = await withMocks({}, (re, cap) => {
      return re.run('in.png', 'out.png', { model: 'realesrgan-x4plus', scale: s }).then(() => cap);
    });
    const args = captured.args;
    const sIdx = args.indexOf('-s');
    assert.ok(sIdx >= 0, `scale=${s} must emit -s`);
    assert.equal(args[sIdx + 1], String(s), `scale=${s} must emit -s ${s}`);
  }
});

// =============================================================================
// T8: ALL advanced opts on — the final argv shape. Specifically verify
// flag ORDER: -i, -o, -n, -s, -f, then -t, -x, -g, -j.
// =============================================================================
test('AUDIT RE-T8: all advanced opts on — argv has the documented order', async () => {
  const captured = await withMocks({}, (re, cap) => {
    return re.run('in.png', 'out.png', {
      model: 'realesrgan-x4plus', scale: 4,
      tileSize: 256, ttaMode: true, gpuId: '1', threads: '1:2:2',
    }).then(() => cap);
  });
  const args = captured.args;
  console.log('AUDIT RE-T8: full argv =', args);
  // Documented order in realesrgan.js:
  //   -i <src> -o <dst> -n <model> -s <scale> -f <fmt>
  //   then optionally -t <tile> -x -g <gpu> -j <threads>
  const obj = argsToObj(args);
  assert.equal(obj.i, 'in.png');
  assert.equal(obj.o, 'out.png');
  assert.equal(obj.n, 'realesrgan-x4plus');
  assert.equal(obj.s, '4');
  assert.equal(obj.f, 'png');
  assert.equal(obj.t, '256');
  assert.equal(obj.x, true);
  assert.equal(obj.g, '1');
  assert.equal(obj.j, '1:2:2');
  // Verify the exact sequence in the args array.
  const expectedSequence = [
    '-i', 'in.png', '-o', 'out.png', '-n', 'realesrgan-x4plus',
    '-s', '4', '-f', 'png', '-t', '256', '-x', '-g', '1', '-j', '1:2:2',
  ];
  assert.deepEqual(args, expectedSequence, 'argv order must match the documented sequence');
});

// =============================================================================
// T9: LEGACY opts.gpu path. When opts.gpuId is undefined and opts.gpu
// is provided, the legacy -g flag is honoured. When opts.gpuId is set
// (even to 'auto'), opts.gpu is IGNORED.
// =============================================================================
test('AUDIT RE-T9: legacy opts.gpu honoured only when opts.gpuId is undefined', async () => {
  // 9a: opts.gpuId undefined, opts.gpu=2 -> -g 2
  const a = await withMocks({}, (re, cap) => {
    return re.run('in.png', 'out.png', { model: 'realesrgan-x4plus', scale: 4, gpu: 2 }).then(() => cap);
  });
  const args = a.args;
  const gIdx = args.indexOf('-g');
  assert.ok(gIdx >= 0, 'legacy opts.gpu=2 must emit -g');
  assert.equal(args[gIdx + 1], '2', 'legacy opts.gpu=2 must emit -g 2');
  // 9b: opts.gpuId='auto' (the default), opts.gpu=2 -> NO -g (auto wins)
  const b = await withMocks({}, (re, cap) => {
    return re.run('in.png', 'out.png', { model: 'realesrgan-x4plus', scale: 4, gpuId: 'auto', gpu: 2 }).then(() => cap);
  });
  const args2 = b.args;
  assert.equal(args2.indexOf('-g'), -1, 'opts.gpuId="auto" must OVERRIDE legacy opts.gpu=2 (audit L5 fix)');
  // 9c: opts.gpuId='1', opts.gpu=2 -> -g 1 (gpuId wins)
  const c = await withMocks({}, (re, cap) => {
    return re.run('in.png', 'out.png', { model: 'realesrgan-x4plus', scale: 4, gpuId: '1', gpu: 2 }).then(() => cap);
  });
  const args3 = c.args;
  const gIdx3 = args3.indexOf('-g');
  assert.equal(args3[gIdx3 + 1], '1', 'opts.gpuId="1" wins over legacy opts.gpu=2');
});

// =============================================================================
// T10: Model name is honoured (renderer might pass any whitelisted name).
// =============================================================================
test('AUDIT RE-T10: model name is forwarded to -n verbatim', async () => {
  for (const m of ['realesrgan-x4plus', 'realesrgan-x4plus-anime', 'realesrgan-animevideov3']) {
    const captured = await withMocks({}, (re, cap) => {
      return re.run('in.png', 'out.png', { model: m, scale: 4 }).then(() => cap);
    });
    const args = captured.args;
    const nIdx = args.indexOf('-n');
    assert.equal(args[nIdx + 1], m, `model=${m} must emit -n ${m}`);
  }
});

// =============================================================================
// T11: When the binary is NOT found, run() returns ok:false and does
// NOT call spawn.
// =============================================================================
test('AUDIT RE-T11: when the binary is missing, run() returns ok:false without spawning', async () => {
  // Custom mock: existsSync always false -> findBinary returns null.
  const Module = require('module');
  const origLoad = Module._load;
  const cpMock = {
    spawn: () => { throw new Error('spawn should NOT be called when binary is missing'); },
    spawnSync: () => ({ status: 1, stdout: '', stderr: 'not found' }),
  };
  const fsMock = {
    existsSync: () => false,
    renameSync: () => {},
    unlinkSync: () => {},
  };
  Module._load = function (request, parent, ...rest) {
    if (request === 'child_process') return cpMock;
    if (request === 'fs') return fsMock;
    return origLoad.call(this, request, parent, ...rest);
  };
  try {
    delete require.cache[require.resolve(RE_PATH)];
    const re = require(RE_PATH);
    const r = await re.run('in.png', 'out.png', { model: 'realesrgan-x4plus', scale: 4 });
    assert.equal(r.ok, false);
    assert.equal(r.code, -1);
    assert.match(r.stderr, /not found/, 'error message must explain the binary is missing');
  } finally {
    Module._load = origLoad;
  }
});
