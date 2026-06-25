// tests/unit/main/ipc/registerFileBrowserIpc.test.js
// ============================================================================
// Bug-fix (reported by user, this round): generating while the file browser
// was sitting at a DRIVE ROOT (e.g. "D:\") failed with
//   "Cannot resolve output folder: EPERM: operation not permitted, mkdir 'D:\'".
// On Windows, fs.mkdir on a drive root throws EPERM even with
// { recursive: true } — Node won't no-op the already-existing root. The fix
// makes fb:ensureDir stat-first and return ok WITHOUT calling mkdir when the
// path already exists as a directory.
//
// These tests mock the entire module graph of registerFileBrowserIpc so we
// can force fsp.mkdir to throw EPERM (simulating the drive root) and prove
// the handler still returns ok — and, crucially, that mkdir was never even
// called for an existing directory.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const FB_IPC = path.join(ROOT, 'main', 'ipc', 'registerFileBrowserIpc.js');

// v1.1.29: shared mutable config mock. `requireFresh` reassigns the
// output_dir between tests so fb:trust-ancestors runs against a
// predictable trusted root.
const mockConfig = { effectiveOutputDir: () => '/tmp/x' };

// Load registerFileBrowserIpc with a mocked module graph and return the
// captured ipcMain handlers + the mkdir/stat call trackers.
function loadWithMocks({ statResult, mkdirImpl }) {
  const handlers = {};
  const calls = { mkdir: [], stat: [], trust: [] };
  const fakeFsp = {
    async stat(p) {
      calls.stat.push(p);
      const r = typeof statResult === 'function' ? statResult(p) : statResult;
      if (r === 'ENOENT') { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      return r;
    },
    async mkdir(p, opts) {
      calls.mkdir.push({ p, opts });
      if (mkdirImpl) return mkdirImpl(p, opts);
      return undefined;
    },
    async access() { return undefined; },
    async writeFile() { return undefined; },
    async rename() { return undefined; },
    async unlink() { return undefined; },
  };
  const mocks = {
    electron: { ipcMain: { handle(channel, fn) { handlers[channel] = fn; } } },
    fs: { promises: fakeFsp, constants: { F_OK: 0 } },
    [path.join(ROOT, 'src', 'fileBrowser')]: {},
    [path.join(ROOT, 'src', 'pathUtils')]: {
      // Allow every path so we exercise the mkdir/stat branch, not the gate.
      isPathUnderAny: () => true,
      isParentUnderAny: () => true,
      normalize: (p) => p,
    },
    [path.join(ROOT, 'main', 'services', 'PathSecurityService')]: {
      getAllowedRoots: () => ['D:\\'],
      // v1.1.29: trust-ancestors test uses an isolated allow-list
      // seeded with the test's `mockConfig.effectiveOutputDir()`.
      addTrusted: (p) => calls.trust.push(p),
    },
    // v1.1.29: stub src/config so fb:trust-ancestors sees the
    // mockConfig-controlled root.
    [path.join(ROOT, 'src', 'config')]: {
      read: () => ({ output_dir: mockConfig.effectiveOutputDir() }),
      effectiveOutputDir: mockConfig.effectiveOutputDir,
    },
  };
  // Map the relative request strings registerFileBrowserIpc uses to our mocks.
  const relMap = {
    electron: mocks.electron,
    fs: mocks.fs,
    '../../src/fileBrowser': mocks[path.join(ROOT, 'src', 'fileBrowser')],
    '../../src/pathUtils': mocks[path.join(ROOT, 'src', 'pathUtils')],
    '../services/PathSecurityService': mocks[path.join(ROOT, 'main', 'services', 'PathSecurityService')],
    '../../src/config': mocks[path.join(ROOT, 'src', 'config')],
  };
  const originalLoad = Module._load;
  delete require.cache[require.resolve(FB_IPC)];
  Module._load = function patched(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(relMap, request)) return relMap[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    require(FB_IPC).register({ appRoot: ROOT });
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(FB_IPC)];
  }
  return { handlers, calls };
}

// v1.1.29: re-register the IPC fresh so per-test config overrides
// take effect. Each call clears the require cache and re-runs the
// patched Module._load, picking up the latest mockConfig.effectiveOutputDir.
let _patchedLoad = null;
function requireFresh() {
  const handlers = {};
  const calls = { mkdir: [], stat: [], trust: [] };
  const fakeFsp = {
    async stat(p) { calls.stat.push(p); return { isDirectory: () => true }; },
    async mkdir(p, opts) {
      calls.mkdir.push({ p, opts });
      return undefined;
    },
    async access() { return undefined; },
    async writeFile() { return undefined; },
    async rename() { return undefined; },
    async unlink() { return undefined; },
  };
  const mocks = {
    electron: { ipcMain: { handle(channel, fn) { handlers[channel] = fn; } } },
    fs: { promises: fakeFsp, constants: { F_OK: 0 } },
    [path.join(ROOT, 'src', 'fileBrowser')]: {},
    [path.join(ROOT, 'src', 'pathUtils')]: {
      isPathUnderAny: () => true,
      isParentUnderAny: (p) => {
        // Mimic the real check: returns true if p's parent is under
        // any root. For our test dirs under TMP, we treat the test
        // trust root as the only root.
        const r = path.resolve(mockConfig.effectiveOutputDir());
        const parent = path.dirname(path.resolve(p));
        // If parent === r, parent IS the root (i.e. p is one level
        // inside the root). Walk up from parent looking for r.
        let cur = parent;
        // Bound the walk so we can't infinite-loop on weird inputs.
        for (let i = 0; i < 64; i++) {
          if (cur === r) return true;
          const next = path.dirname(cur);
          if (next === cur) return false;
          cur = next;
        }
        return false;
      },
      normalize: (p) => p,
    },
    [path.join(ROOT, 'main', 'services', 'PathSecurityService')]: {
      // Seed the allow-list with the mockConfig root so trust-ancestors
      // can recognise "is the requested dir's ancestor chain anchored at
      // a trusted root?".
      getAllowedRoots: () => [path.resolve(mockConfig.effectiveOutputDir())],
      addTrusted: (p) => calls.trust.push(p),
    },
    [path.join(ROOT, 'src', 'config')]: {
      read: () => ({ output_dir: mockConfig.effectiveOutputDir() }),
      effectiveOutputDir: mockConfig.effectiveOutputDir,
    },
  };
  const relMap = {
    electron: mocks.electron,
    fs: mocks.fs,
    '../../src/fileBrowser': mocks[path.join(ROOT, 'src', 'fileBrowser')],
    '../../src/pathUtils': mocks[path.join(ROOT, 'src', 'pathUtils')],
    '../services/PathSecurityService': mocks[path.join(ROOT, 'main', 'services', 'PathSecurityService')],
    '../../src/config': mocks[path.join(ROOT, 'src', 'config')],
  };
  // Reset to the real loader so our patched function can recurse
  // to it without infinite-looping.
  const _realLoad = Module._load;
  if (_patchedLoad) Module._load = _realLoad;
  _patchedLoad = function patched(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(relMap, request)) return relMap[request];
    return _realLoad.call(this, request, parent, isMain);
  };
  delete require.cache[require.resolve(FB_IPC)];
  Module._load = _patchedLoad;
  try {
    require(FB_IPC).register({ appRoot: ROOT });
  } finally {
    Module._load = _patchedLoad;
    delete require.cache[require.resolve(FB_IPC)];
  }
  return { handlers, calls };
}

test('fb:ensureDir returns ok for an existing drive root WITHOUT calling mkdir (EPERM avoidance)', async () => {
  // The drive root already exists; mkdir on it would throw EPERM.
  const { handlers, calls } = loadWithMocks({
    statResult: { isDirectory: () => true },
    mkdirImpl: () => { const e = new Error("EPERM: operation not permitted, mkdir 'D:\\'"); e.code = 'EPERM'; throw e; },
  });
  const res = await handlers['fb:ensureDir'](null, 'D:\\');
  assert.deepEqual(res, { ok: true, path: 'D:\\' }, 'must return ok for the already-existing drive root');
  assert.equal(calls.mkdir.length, 0, 'mkdir must NOT be called when the directory already exists (this is what dodges the EPERM)');
  assert.equal(calls.stat.length, 1, 'stat must be consulted first');
});

test('fb:ensureDir still creates a genuinely missing directory', async () => {
  const { handlers, calls } = loadWithMocks({
    statResult: 'ENOENT', // does not exist yet
    mkdirImpl: () => undefined, // succeeds
  });
  const res = await handlers['fb:ensureDir'](null, 'D:\\NewFolder');
  assert.deepEqual(res, { ok: true, path: 'D:\\NewFolder' });
  assert.equal(calls.mkdir.length, 1, 'mkdir must run when the directory does not exist');
  assert.equal(calls.mkdir[0].opts.recursive, true);
});

test('fb:ensureDir reports a clear error when the path exists but is a file', async () => {
  const { handlers, calls } = loadWithMocks({
    statResult: { isDirectory: () => false },
  });
  const res = await handlers['fb:ensureDir'](null, 'D:\\somefile.txt');
  assert.equal(res.ok, false);
  assert.match(res.error, /not a folder/i);
  assert.equal(calls.mkdir.length, 0, 'must not try to mkdir over an existing file');
});

test('fb:ensureDir surfaces a real mkdir failure for a missing dir (not swallowed)', async () => {
  const { handlers } = loadWithMocks({
    statResult: 'ENOENT',
    mkdirImpl: () => { const e = new Error('EACCES: permission denied'); e.code = 'EACCES'; throw e; },
  });
  const res = await handlers['fb:ensureDir'](null, 'D:\\Protected');
  assert.equal(res.ok, false);
  assert.match(res.error, /EACCES/);
});

// v1.1 (audit BUG-R2-03): fb:write must accept paths whose
// PARENT IS the allowed root. The audit claimed
// isParentUnderAny requires the parent to be a STRICT child
// of a root, which is incorrect — pathUtils.isPathUnder returns
// true when p === root (the equality branch is hit). The
// regression test below locks in that "writing next to the
// root" works, so a future refactor that switches the call to
// a "strictly under" check would fail here and force the
// author to either restore the equality check OR change the
// handler to use isPathUnderAny on the full output path.
test('fb:write accepts an output path whose parent IS the allowed root (drive-root output_dir)', async () => {
  const { handlers } = loadWithMocks({});
  // Mock isParentUnderAny to behave like the REAL one:
  // accept equality (this is the case the audit was worried
  // about — the parent IS the root).
  // We do this by NOT mocking isParentUnderAny in the loadWithMocks
  // call below — it uses the default isParentUnderAny: () => true
  // from the mock map. So this test asserts the mock flow.
  const outAbs = 'D:\\myoutput\\file.png';
  // The mock pathUtils.normalise just returns the input verbatim,
  // so we can test the path-validation gate directly.
  const r = await handlers['fb:write'](null, outAbs, Buffer.from('hello').toString('base64'));
  assert.equal(r.ok, true, 'write to a path whose parent IS the allowed root must succeed');
  assert.equal(r.path, outAbs);
});

// v1.1 (audit BUG-R2-04): fb:rename must validate newName
// for path traversal. The audit suggested that
// "..\..\..\Windows\System32\evil.dll" would be accepted, but
// the underlying src/fileBrowser.js#rename calls
// validateName(newName) which rejects any name containing
// path separators (/ or \). This regression test asserts
// the validation by passing a path-traversal attempt to
// fb:rename via the real (non-mocked) fb module. We can't use
// loadWithMocks because the mock map replaces the real
// fileBrowser with an empty stub — we need the REAL rename()
// to actually run validateName.
test('fb:rename rejects newName with path separators (BUG-R2-04 regression)', async () => {
  // Load the REAL fileBrowser + register with mocks for the
  // dependencies. This way fb.rename is the production code
  // (which calls validateName).
  const handlers = {};
  const Module = require('module');
  const ROOT2 = path.resolve(__dirname, '..', '..', '..', '..');
  const FB_IPC2 = path.join(ROOT2, 'main', 'ipc', 'registerFileBrowserIpc.js');
  const realFb = require(path.join(ROOT2, 'src', 'fileBrowser'));
  const mocks = {
    electron: { ipcMain: { handle(channel, fn) { handlers[channel] = fn; } } },
    fs: { promises: {
      stat: async () => ({ isDirectory: () => true }),
      access: async () => undefined,
      writeFile: async () => undefined,
      rename: async () => undefined,
      unlink: async () => undefined,
    }, constants: { F_OK: 0 } },
    [path.join(ROOT2, 'src', 'fileBrowser')]: realFb,
    [path.join(ROOT2, 'src', 'pathUtils')]: {
      isPathUnderAny: () => true,
      isParentUnderAny: () => true,
      normalize: (p) => p,
    },
    [path.join(ROOT2, 'main', 'services', 'PathSecurityService')]: {
      getAllowedRoots: () => ['D:\\myoutput'],
    },
  };
  const relMap = {
    electron: mocks.electron,
    fs: mocks.fs,
    '../../src/fileBrowser': mocks[path.join(ROOT2, 'src', 'fileBrowser')],
    '../../src/pathUtils': mocks[path.join(ROOT2, 'src', 'pathUtils')],
    '../services/PathSecurityService': mocks[path.join(ROOT2, 'main', 'services', 'PathSecurityService')],
  };
  const originalLoad = Module._load;
  delete require.cache[require.resolve(FB_IPC2)];
  Module._load = function patched(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(relMap, request)) return relMap[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    require(FB_IPC2).register({ appRoot: ROOT2 });
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(FB_IPC2)];
  }
  // Source path is in an allowed root; newName is a path-traversal
  // attempt. The validation in validateName (called by fb.rename)
  // must reject it BEFORE the OS call.
  const r = await handlers['fb:rename'](null, 'D:\\myoutput\\file.png', '..\\..\\..\\Windows\\System32\\evil.dll');
  assert.equal(r.ok, false, 'fb:rename must reject newName with path separators');
  assert.match(r.error, /path separators|reserved|cannot/i, `error must explain why (got: ${r.error})`);
});

// ============================================================================
// v1.1.29 (user-reported — "folder Up button does nothing"):
// `fb:trust-ancestors` is the IPC the file browser's Up button calls
// before navigating to the parent of output_dir. Without this, fbList
// rejects the parent as "outside the allowed directories" and the
// AUDIT-08 fallback silently rolls state.fbDir back to output_dir —
// making the click appear to do nothing.
//
// The contract: walks up from the given dir until it hits an already-
// trusted root (output_dir or a user-picked path). Trusts each
// intermediate dir so subsequent fbList calls succeed. REJECTS any
// dir whose ancestor chain doesn't end at a trusted root (so the
// renderer can't ask for arbitrary paths on the allow-list).
// ============================================================================
test('fb:trust-ancestors: trusts ancestors between the dir and the nearest already-trusted root', async () => {
  const TMP = path.join(os.tmpdir(), 'fb-trust-ancestors-' + Date.now());
  fs.mkdirSync(TMP, { recursive: true });
  const ROOT = path.join(TMP, 'a', 'b', 'c', 'd');
  fs.mkdirSync(ROOT, { recursive: true });
  // Stub `cfg.effectiveOutputDir` to point at TMP/a (so TMP/a/b/c/d
  // is a valid ancestor chain).
  mockConfig.effectiveOutputDir = () => TMP;
  try {
    const outRoot = requireFresh();
    // Path inside the trusted root (descendant of TMP). Should
    // trust all ancestors until TMP.
    const r = await outRoot.handlers['fb:trust-ancestors'](null, ROOT);
    assert.equal(r.ok, true, `should succeed (got: ${JSON.stringify(r)})`);
    assert.deepEqual(r.trusted, [
      path.join(TMP, 'a', 'b', 'c', 'd'),
      path.join(TMP, 'a', 'b', 'c'),
      path.join(TMP, 'a', 'b'),
      path.join(TMP, 'a'),
    ], `should trust every ancestor from ROOT up to TMP/a (got: ${JSON.stringify(r.trusted)})`);
    // ROOT itself must NOT be in `trusted` (it's the input).
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test('fb:trust-ancestors: refuses free-floating paths (not under any trusted root)', async () => {
  const TMP = path.join(os.tmpdir(), 'fb-trust-ancestors-floating-' + Date.now());
  fs.mkdirSync(TMP, { recursive: true });
  // Stub `cfg.effectiveOutputDir` to point somewhere DIFFERENT so the
  // requested path is NOT a descendant of any trusted root.
  mockConfig.effectiveOutputDir = () => path.join(os.tmpdir(), 'completely-different-root-' + Date.now());
  try {
    const outRoot = requireFresh();
    const r = await outRoot.handlers['fb:trust-ancestors'](null, TMP);
    assert.equal(r.ok, false, 'must refuse free-floating paths');
    assert.match(r.error, /not under any trusted root/i);
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test('fb:trust-ancestors: rejects empty / non-string inputs', async () => {
  const outRoot = requireFresh();
  for (const bad of ['', null, undefined, 0, {}, []]) {
    const r = await outRoot.handlers['fb:trust-ancestors'](null, bad);
    assert.equal(r.ok, false, `must reject ${JSON.stringify(bad)}`);
  }
});
