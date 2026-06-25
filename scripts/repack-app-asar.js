// scripts/repack-app-asar.js
// Rebuilt-from-source version of app.asar. Reads the existing
// dist-out/win-unpacked/resources/app.asar, replaces its renderer/
// main/ src/ and preload.js with the current source tree, and
// repacks. This lets us ship new patches WITHOUT re-running
// electron-builder (which hangs at the winCodeSign symlink stage
// on accounts without SeCreateSymbolicLinkPrivilege).
//
// We never modify any binary / model files — bin/ stays untouched.

'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const UNPACKED = path.join(ROOT, 'dist-out', 'win-unpacked');
const OLD_ASAR = path.join(UNPACKED, 'resources', 'app.asar');
const WORK = path.join(ROOT, 'dist-out', 'asar-extracted');
const NEW_ASAR = OLD_ASAR;

function log(m) { process.stdout.write(m + '\n'); }

function rsyncDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      rsyncDir(s, d);
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d);
    }
  }
}

(async () => {
  // 1. Extract old asar (clean slate so removed files vanish).
  log('Step 1/4: removing old extracted dir + extracting old asar...');
  fs.rmSync(WORK, { recursive: true, force: true });
  const ASAR_JS = path.join(ROOT, 'node_modules', '@electron', 'asar', 'bin', 'asar.js');
  const r1 = spawnSync(process.execPath, [ASAR_JS, 'extract', OLD_ASAR, WORK], { stdio: 'inherit' });
  if (r1.status !== 0) {
    process.stderr.write('stdout: ' + r1.stdout + '\nstderr: ' + r1.stderr + '\n');
    throw new Error('asar extract failed (status=' + r1.status + ')');
  }

  // 2. Overwrite renderer/, main/, src/, preload.js, package.json.
  //    Each is a wholesale copy of the current source.
  log('Step 2/4: syncing current source tree into extracted dir...');
  const SOURCE_TARGETS = [
    ['renderer', path.join(WORK, 'renderer')],
    ['main',     path.join(WORK, 'main')],
    ['src',      path.join(WORK, 'src')],
  ];
  for (const [name, dst] of SOURCE_TARGETS) {
    const src = path.join(ROOT, name);
    fs.rmSync(dst, { recursive: true, force: true });
    rsyncDir(src, dst);
    log('  + ' + name + '/  →  ' + path.relative(WORK, dst) + '/');
  }
  for (const f of ['preload.js', 'package.json', 'main.js']) {
    const src = path.join(ROOT, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(WORK, f));
      log('  + ' + f);
    }
  }

  // 3. Repack into a fresh app.asar.
  log('Step 3/4: repacking app.asar...');
  fs.rmSync(NEW_ASAR, { force: true });
  const r3 = spawnSync(process.execPath, [ASAR_JS, 'pack', WORK, NEW_ASAR], { stdio: 'inherit' });
  if (r3.status !== 0) {
    process.stderr.write('stdout: ' + r3.stdout + '\nstderr: ' + r3.stderr + '\n');
    throw new Error('asar pack failed (status=' + r3.status + ')');
  }

  const stat = fs.statSync(NEW_ASAR);
  log('Step 4/4: done. app.asar is ' + (stat.size / 1024 / 1024).toFixed(1) + ' MB.');
})().catch((e) => {
  process.stderr.write('✖  ' + (e && e.stack || e) + '\n');
  process.exit(1);
});