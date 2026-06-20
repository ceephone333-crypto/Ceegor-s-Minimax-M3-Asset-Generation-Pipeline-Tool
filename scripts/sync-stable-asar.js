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
//   + a curated set of node_modules/ entries the app actually
//     `require()`s at runtime. Native bindings (.node / .dll /
//     .exe) stay in app.asar.unpacked (electron-builder's
//     `asarUnpack` whitelist handles them); we sync the JS
//     wrappers + their plain .js siblings here.
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

// Curated list of node_modules subtrees to sync into the asar.
// Each entry is a top-level package directory; the sync copies
// the directory recursively but skips files electron-builder's
// `asarUnpack` already handles (the native bindings stay in
// app.asar.unpacked, where Node can dlopen them).
//
// Why a curated list and not "everything in node_modules":
// the user's node_modules has dozens of dev-only packages
// (electron, electron-builder, …) that must NOT end up in the
// shipped app. We only sync what the running renderer/main
// `require()`s.
//
// Bug-fix v1.1.10 (reported by user): IS-NET was "not installed"
// in the packaged app because onnxruntime-node wasn't in the
// asar — `require.resolve('onnxruntime-node')` failed and the
// background-removal pipeline silently fell through to
// "unavailable", even though the npm package was installed
// in node_modules. Same root cause for sharp (image
// optimisation), ffmpeg-static (audio), and @img (sharp's
// prebuilt binaries wrapper). Syncing these in fixes the
// whole "needs a manual install" UX failure in one go.
const SYNC_ENTRIES = [
  'main.js',
  'preload.js',
  'package.json',
  'main',
  'src',
  'renderer',
];
const SYNC_NODE_MODULES = [
  // IS-NET (background removal) — Node.js wrapper around
  // onnxruntime-node. Without this in the asar, `pickBackend()`
  // returns null and the Re-detect button reports "not found"
  // even though the package is on disk.
  'onnxruntime-node',
  // Image pipeline (resize, format conversion, the auto-rotate
  // pass). sharp ships a native binding in app.asar.unpacked
  // and the JS entry in the asar.
  'sharp',
  '@img',
  // Audio (cut, metadata, waveform) uses ffmpeg-static for the
  // conversion pass. The .exe lives in app.asar.unpacked.
  'ffmpeg-static',
];

// Inside each synced node_modules package, skip files that
// electron-builder already unpacks. Their entries in the asar
// would just shadow the unpacked version and cause weird
// behaviour. The patterns match the `asarUnpack` whitelist
// in package.json.
const NODE_MODULES_SKIP_PATTERNS = [
  /\.node$/,                 // N-API native bindings (dlopen'd from .unpacked)
  /[/\\]bin[/\\].*\.dll$/i,  // sharp's bundled OpenCV / codec DLLs
  /[/\\]bin[/\\]ffmpeg\.exe$/i,
  /[/\\]prebuilds?[/\\]/i,   // sharp's prebuild cache
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
// Like copyDir but skips files that match any of
// NODE_MODULES_SKIP_PATTERNS (native bindings / prebuilds /
// the ffmpeg.exe that lives in asar.unpacked). Walks the
// tree non-recursively (we don't want to descend into
// `bin/napi-v6/linux` on a Windows build, etc.) by skipping
// known-noise subdirectories per top-level package.
const NOISE_DIRS = new Set([
  'prebuilds', 'prebuild', 'node-gyp', 'gyp', 'build', 'test', 'tests', 'doc', 'docs',
]);
function copyPackage(src, dst, skipPatterns) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (NOISE_DIRS.has(entry.name)) continue; // skip noisy subdirs
    const sp = path.join(src, entry.name);
    const dp = path.join(dst, entry.name);
    if (entry.isDirectory()) copyPackage(sp, dp, skipPatterns);
    else if (!skipPatterns.some((re) => re.test(sp))) fs.copyFileSync(sp, dp);
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

  // v1.1.10: sync a curated set of node_modules packages so the
  // packaged app can resolve them at runtime. The native
  // bindings stay in app.asar.unpacked (electron-builder's
  // `asarUnpack` whitelist handles them via package.json).
  // We only sync what's needed at runtime — the dev-only
  // packages (electron, electron-builder, etc.) are skipped to
  // keep the asar small and avoid bundling a 200 MB Electron
  // binary twice.
  const nmSrc = path.join(ROOT, 'node_modules');
  const nmDst = path.join(WORK, 'node_modules');
  fs.mkdirSync(nmDst, { recursive: true });
  let pkgBytes = 0;
  for (const pkg of SYNC_NODE_MODULES) {
    const src = path.join(nmSrc, pkg);
    const dst = path.join(nmDst, pkg);
    if (!fs.existsSync(src)) {
      console.warn('  (skip-nm)  ' + pkg + '  (not installed — run `npm install`)');
      continue;
    }
    rimraf(dst);
    copyPackage(src, dst, NODE_MODULES_SKIP_PATTERNS);
    // Crude size estimate: count of bytes in the synced subtree.
    let bytes = 0;
    function walk(p) {
      const st = fs.statSync(p);
      if (st.isDirectory()) for (const e of fs.readdirSync(p)) walk(path.join(p, e));
      else bytes += st.size;
    }
    walk(dst);
    pkgBytes += bytes;
    console.log('  (sync-nm) ' + pkg + '  (' + (bytes / 1024 / 1024).toFixed(1) + ' MB)');
  }
  console.log('  ── total node_modules in asar: ' + (pkgBytes / 1024 / 1024).toFixed(1) + ' MB');

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
