// scripts/sync-stable-asar.js
// Re-pack dist-stable/win-unpacked/resources/app.asar from the current
// source files so the user can immediately run the latest fixes from
// dist-stable/ without waiting for a full electron-builder + zip run.
//
// Mirrors what scripts/sync-asar.ps1 does for dist-stable/. Kept as JS
// (not PowerShell) so the same npm-style flow can drive it from any
// agent — no pwsh dependency.
//
// Files synced (matches the package.json `files` whitelist):
//   main.js, preload.js, package.json, main/, src/, renderer/
//
// Existing app.asar is backed up to app.asar.bak before replacement so
// a failed repack can be reverted by renaming the backup back.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ASAR = path.join(ROOT, 'dist-stable', 'win-unpacked', 'resources', 'app.asar');
const BACKUP = ASAR + '.bak';
const WORK = path.join(ROOT, 'dist-stable', 'asar-work');

const SYNC_ENTRIES = [
  'main.js',
  'preload.js',
  'package.json',
  'main',
  'src',
  'renderer',
];

function rimraf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {} }
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const sp = path.join(src, entry.name);
    const dp = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(sp, dp);
    else fs.copyFileSync(sp, dp);
  }
}
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: 'inherit', windowsHide: true });
    proc.on('close', (code) => code === 0 ? resolve() : reject(new Error('exit ' + code)));
    proc.on('error', reject);
  });
}

async function main() {
  if (!fs.existsSync(ASAR)) {
    console.error('ERROR: asar not found at', ASAR);
    console.error('Re-create dist-stable/ by extracting dist/MiniMaxAssetTool-1.1.1-x64.zip');
    process.exit(1);
  }
  const asarBin = path.join(ROOT, 'node_modules', '@electron', 'asar', 'bin', 'asar.js');
  if (!fs.existsSync(asarBin)) {
    console.error('ERROR: asar CLI not found at', asarBin);
    console.error('Reinstall: npm install');
    process.exit(1);
  }

  console.log('[1/4] Extracting existing asar...');
  rimraf(WORK);
  await run(process.execPath, [asarBin, 'extract', ASAR, WORK]);

  console.log('[2/4] Replacing source files from', ROOT, '...');
  for (const f of SYNC_ENTRIES) {
    const src = path.join(ROOT, f);
    const dst = path.join(WORK, f);
    if (!fs.existsSync(src)) {
      console.warn('  (skip)  ' + f + '  (not in source)');
      continue;
    }
    rimraf(dst);
    if (fs.statSync(src).isDirectory()) copyDir(src, dst);
    else { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); }
    console.log('  (sync)  ' + f);
  }

  if (!fs.existsSync(BACKUP)) {
    console.log('[3/4] Backing up original asar...');
    fs.copyFileSync(ASAR, BACKUP);
  } else {
    console.log('[3/4] Backup already present at', BACKUP, '— keeping it');
  }

  console.log('[4/4] Repacking asar...');
  await run(process.execPath, [asarBin, 'pack', WORK, ASAR]);
  rimraf(WORK);

  const stat = fs.statSync(ASAR);
  console.log('\n[DONE] ' + ASAR);
  console.log('       size: ' + (stat.size / 1024 / 1024).toFixed(1) + ' MB');
  console.log('       backup: ' + BACKUP);
  console.log('       Restart dist-stable/win-unpacked/MiniMaxAssetTool.exe to pick up the new code.');
}

main().catch((e) => { console.error(e); process.exit(1); });
