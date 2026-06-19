// tests/unit/src/config.test.js
// Bug-fix (2026-06-19, reported by user): the default output
// directory must land in `%APPDATA%/<productName>/generated`
// (i.e. Electron's `app.getPath('userData') + /generated`),
// NOT in `<exe-dir>/generated` (which is what the user sees as
// "<dist-stable>/win-unpacked/generated" for packaged builds —
// an unexpected location that may not even exist on disk).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Each test isolates its own config dir + electron stub so we
// can drive the module's `app.getPath('userData')` return value
// deterministically without colliding with other test files.
function loadFresh(userDataPath) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmx-config-test-'));
  process.env.MINIMAX_CONFIG_DIR = tmpDir;
  require.cache[require.resolve('electron')] = {
    exports: { app: { getPath: (k) => (k === 'userData' ? userDataPath : tmpDir) } },
  };
  delete require.cache[require.resolve('../../../src/config')];
  const cfgMod = require('../../../src/config');
  return { cfgMod, tmpDir };
}

test('defaultOutputDir returns <userData>/generated', () => {
  const userData = 'C:\\Users\\tester\\AppData\\Roaming\\MiniMaxAssetTool';
  const { cfgMod, tmpDir } = loadFresh(userData);
  try {
    const d = cfgMod.defaultOutputDir();
    assert.equal(d, path.join(userData, 'generated'));
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});

test('defaultOutputDir does NOT land inside the exe dir', () => {
  // The old default was <configDir>/generated — i.e. <exe-dir>/generated.
  // For a packaged build that's <dist-stable>/win-unpacked/generated,
  // which the user explicitly asked NOT to use.
  const userData = 'C:\\Users\\tester\\AppData\\Roaming\\MiniMaxAssetTool';
  const exeDir = 'C:\\Projects\\app\\dist-stable\\win-unpacked';
  const { cfgMod, tmpDir } = loadFresh(userData);
  try {
    // Make configDir() resolve to the packaged-exe layout.
    require.cache[require.resolve('electron')] = {
      exports: {
        app: {
          getPath: (k) => (k === 'userData' ? userData : exeDir),
        },
      },
    };
    delete require.cache[require.resolve('../../../src/config')];
    const cfgMod2 = require('../../../src/config');
    const d = cfgMod2.defaultOutputDir();
    assert.notEqual(d, path.join(exeDir, 'generated'));
    assert.ok(d.startsWith(userData), `expected ${d} to start with ${userData}`);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});

test('effectiveOutputDir falls back to defaultOutputDir when cfg.output_dir is blank', () => {
  const userData = 'C:\\Users\\tester\\AppData\\Roaming\\MiniMaxAssetTool';
  const { cfgMod, tmpDir } = loadFresh(userData);
  try {
    const d = cfgMod.effectiveOutputDir({ output_dir: '' });
    assert.equal(d, path.join(userData, 'generated'));
    const d2 = cfgMod.effectiveOutputDir({ output_dir: '   ' });
    assert.equal(d2, path.join(userData, 'generated'));
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});

test('effectiveOutputDir respects a configured output_dir', () => {
  const userData = 'C:\\Users\\tester\\AppData\\Roaming\\MiniMaxAssetTool';
  const { cfgMod, tmpDir } = loadFresh(userData);
  try {
    const customDir = 'D:\\my-assets';
    const d = cfgMod.effectiveOutputDir({ output_dir: customDir });
    assert.equal(d, customDir);
    // Trimming whitespace is preserved.
    const d2 = cfgMod.effectiveOutputDir({ output_dir: '  ' + customDir + '  ' });
    assert.equal(d2, customDir);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});

test('defaultOutputDir falls back to %APPDATA% even if electron is unavailable', () => {
  // Drive the fallback branch (electron's app.getPath throws).
  // The function must still produce a stable, %APPDATA%-based
  // path so tests in non-Electron contexts keep working.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmx-cfg-fallback-'));
  process.env.MINIMAX_CONFIG_DIR = tmpDir;
  process.env.APPDATA = 'C:\\Users\\tester\\AppData\\Roaming';
  // Stub electron so require('electron') succeeds but
  // app.getPath throws — that puts us in the catch branch.
  require.cache[require.resolve('electron')] = {
    exports: { app: { getPath: () => { throw new Error('not in electron context'); } } },
  };
  try {
    delete require.cache[require.resolve('../../../src/config')];
    const cfgMod = require('../../../src/config');
    const d = cfgMod.defaultOutputDir();
    assert.ok(d.startsWith('C:\\Users\\tester\\AppData\\Roaming'));
    assert.ok(d.endsWith(path.join('MiniMaxAssetTool', 'generated')));
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});