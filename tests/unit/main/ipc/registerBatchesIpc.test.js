// tests/unit/main/ipc/registerBatchesIpc.test.js
// Bug-fix (2026-06-19, reported by user): the example generator
// (`batches:generateExamples`) used to write the docs into the
// `appRoot` path, which in a packaged build resolves to
// `<dist-stable>/win-unpacked/resources/app.asar/` — INSIDE the
// read-only asar archive. fs.writeFileSync throws ENOENT and the
// user can't get the example files at all.
//
// The fix writes them to `cfgMod.effectiveOutputDir(cfg)` instead
// (the same folder the file browser shows). This test pins the
// destination so a future regression can't silently flip it back
// to the asar.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { EventEmitter } = require('events');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmx-batches-test-'));
process.env.MINIMAX_CONFIG_DIR = tmpDir;

// Stub electron. ipcMain.handle stores handlers in a Map-like
// structure; we replicate just enough to invoke the handler
// synchronously.
const handlers = new Map();
const fakeIpcMain = {
  handle: (channel, fn) => handlers.set(channel, fn),
  removeHandler: (channel) => handlers.delete(channel),
};

// userData = where the default output dir lands.
const userData = path.join(tmpDir, 'userData');
require.cache[require.resolve('electron')] = {
  exports: {
    app: {
      getPath: (k) => (k === 'userData' ? userData : tmpDir),
    },
    ipcMain: fakeIpcMain,
  },
};

delete require.cache[require.resolve('../../../../main/ipc/registerBatchesIpc')];
delete require.cache[require.resolve('../../../../src/batches')];
delete require.cache[require.resolve('../../../../src/config')];

// The register function signature is `register({ appRoot })`.
// We pass a fake appRoot pointing at the asar — exactly the
// case the bug report describes — so a regression that uses
// `deps.appRoot` would write to the read-only asar and the
// test would fail.
const asarRoot = path.join(tmpDir, 'resources', 'app.asar');
const registerBatchesIpc = require('../../../../main/ipc/registerBatchesIpc');
registerBatchesIpc.register({ appRoot: asarRoot });

const cfgMod = require('../../../../src/config');
const configPath = path.join(tmpDir, 'config.txt');

test('batches:generateExamples writes to the effective output dir, NOT the asar', async () => {
  // Write a config.txt with output_dir = userData/generated (so
  // effectiveOutputDir(cfg) resolves to that exact path and we
  // don't depend on the defaultOutputDir() fallback.
  const outDir = cfgMod.effectiveOutputDir(cfgMod.defaultConfig());
  fs.mkdirSync(outDir, { recursive: true });
  // Sanity: outDir is NOT inside the asar.
  assert.ok(!outDir.startsWith(asarRoot + path.sep) && outDir !== asarRoot,
    `test setup error: outDir ${outDir} must not be inside asar ${asarRoot}`);

  const handler = handlers.get('batches:generateExamples');
  assert.ok(handler, 'batches:generateExamples handler not registered');
  const r = await handler({});
  assert.equal(r.ok, true);
  // The example files must exist in the effective output dir…
  assert.ok(fs.existsSync(r.mdPath), `expected ${r.mdPath} to exist`);
  assert.ok(fs.existsSync(r.txtPath), `expected ${r.txtPath} to exist`);
  // …and the .md / .txt filenames match the contract.
  assert.equal(path.basename(r.mdPath), 'example_batch_import.md');
  assert.equal(path.basename(r.txtPath), 'example_batch_import.txt');
  // …and crucially, NOTHING was written inside the asar.
  assert.ok(!fs.existsSync(path.join(asarRoot, 'example_batch_import.md')),
    'example file leaked into the asar (read-only)');
  assert.ok(!fs.existsSync(path.join(asarRoot, 'example_batch_import.txt')),
    'example file leaked into the asar (read-only)');
});

test('batches:get returns an empty default for a fresh user', async () => {
  const handler = handlers.get('batches:get');
  const r = await handler({});
  assert.deepEqual(r, { image: [], speech: [], music: [], video: [] });
});

test('batches:set persists + reads back', async () => {
  const handler = handlers.get('batches:set');
  const input = { image: ['first prompt', 'second prompt'], speech: [], music: [], video: [] };
  const writeResult = await handler({}, input);
  assert.equal(writeResult.ok, true);
  const read = await handlers.get('batches:get')({});
  assert.deepEqual(read.image, ['first prompt', 'second prompt']);
  // Strings get trimmed + length-capped (existing behaviour);
  // verify it round-trips a 8001-char string as 8000 chars.
  const long = 'x'.repeat(8001);
  const writeLong = await handler({}, { image: [long], speech: [], music: [], video: [] });
  assert.equal(writeLong.ok, true);
  const readLong = await handlers.get('batches:get')({});
  assert.equal(readLong.image[0].length, 8000);
});

test.after(() => {
  // Best-effort cleanup; we accept failure on Windows where
  // some files may still be open.
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});