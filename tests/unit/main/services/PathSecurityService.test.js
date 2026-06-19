// tests/unit/main/services/PathSecurityService.test.js
// Bug-fix #4 (2026-06-19): guard the allow-list so a blank
// `output_dir` still yields `<configDir>/generated` as the
// single effective root. Previously the allow-list was empty
// in that case, which rejected every fb:* / image:optimize /
// upscale / audio IPC on freshly generated files.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Point config.js at a throw-away dir BEFORE requiring it.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmx-pathsec-'));
process.env.MINIMAX_CONFIG_DIR = tmpDir;

// Stub electron so config.js can resolve `app.getPath('exe')`.
require.cache[require.resolve('electron')] = {
  exports: { app: { getPath: () => tmpDir } },
};

delete require.cache[require.resolve('../../../../src/config')];
delete require.cache[require.resolve('../../../../src/pathUtils')];
delete require.cache[require.resolve('../../../../main/services/PathSecurityService')];

const cfgMod = require('../../../../src/config');
const pathSecurity = require('../../../../main/services/PathSecurityService');

function withConfig(cfg, fn) {
  const original = cfgMod.read;
  cfgMod.read = () => cfg;
  try { fn(); } finally { cfgMod.read = original; }
}

test('getAllowedRoots includes <configDir>/generated when output_dir is blank', () => {
  withConfig({ output_dir: '', api_key: 'x', region: 'global', theme: 'dark', styles: [], raw: '' }, () => {
    const roots = pathSecurity.getAllowedRoots();
    assert.ok(roots.includes(cfgMod.effectiveOutputDir({ output_dir: '' })));
    // Single root, no trustedPickPaths yet.
    assert.equal(roots.length, 1);
  });
});

test('isPathUnderAny allows a generated file under the effective output dir', () => {
  const eff = cfgMod.effectiveOutputDir({ output_dir: '' });
  const filePath = path.join(eff, 'subdir', 'asset.png');
  withConfig({ output_dir: '', api_key: '', region: 'global', theme: 'dark', styles: [], raw: '' }, () => {
    assert.equal(pathSecurity.isPathUnderAny(filePath), true);
  });
});

test('getAllowedRoots uses the configured output_dir when set', () => {
  const customDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmx-custom-'));
  try {
    withConfig({ output_dir: customDir, api_key: '', region: 'global', theme: 'dark', styles: [], raw: '' }, () => {
      const roots = pathSecurity.getAllowedRoots();
      assert.ok(roots.includes(customDir));
      assert.equal(pathSecurity.isPathUnderAny(path.join(customDir, 'a.png')), true);
    });
  } finally {
    try { fs.rmSync(customDir, { recursive: true, force: true }); } catch {}
  }
});

test('addTrusted adds a non-output_dir path to the allow-list', () => {
  withConfig({ output_dir: '', api_key: '', region: 'global', theme: 'dark', styles: [], raw: '' }, () => {
    pathSecurity.addTrusted('C:/user/picked/folder');
    const roots = pathSecurity.getAllowedRoots();
    assert.ok(roots.includes('C:/user/picked/folder'));
    assert.equal(pathSecurity.isPathUnderAny('C:/user/picked/folder/x.png'), true);
  });
});

test.after(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});