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
// Runtime dependency ROOTS. The full set of packages synced into the
// asar is the transitive closure of these (computed below) PLUS the whole
// @img scope (sharp's prebuilt native wrapper).
//
// Bug-fix (2026-06-20, reported by user): the previous static list synced
// ONLY these three (+@img) and NOT their transitive dependencies, so the
// packaged app threw at runtime — "Cannot find module 'onnxruntime-common'"
// (background removal) and "Sharp is not installed" (image optimise),
// because onnxruntime-common / color / detect-libc / semver / … were
// never bundled. We now walk each package's dependencies +
// optionalDependencies and include every reachable package that's
// actually installed.
const RUNTIME_DEP_ROOTS = [
  // IS-NET (background removal) — Node.js wrapper around onnxruntime-node.
  'onnxruntime-node',
  // Image pipeline (resize, format conversion, optimise). Native binding
  // lives in app.asar.unpacked; the JS + its deps go in the asar.
  'sharp',
  // Audio (cut, metadata, waveform) — ffmpeg-static. The .exe is unpacked.
  'ffmpeg-static',
];

// Read dependencies + optionalDependencies of a package directory.
function readPkgDeps(pkgDir) {
  try {
    const pj = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
    return Object.assign({}, pj.dependencies || {}, pj.optionalDependencies || {});
  } catch (_) { return {}; }
}
// Transitive closure of the runtime roots over (optional)dependencies,
// limited to packages actually present in node_modules.
function collectClosure(nmRoot, roots) {
  const seen = new Set();
  const stack = roots.slice();
  while (stack.length) {
    const name = stack.pop();
    if (seen.has(name)) continue;
    const dir = path.join(nmRoot, name);
    if (!fs.existsSync(path.join(dir, 'package.json'))) continue; // not installed / skip
    seen.add(name);
    for (const dep of Object.keys(readPkgDeps(dir))) if (!seen.has(dep)) stack.push(dep);
  }
  // Always include the whole @img scope (sharp's prebuilt native wrapper);
  // its members are referenced via optionalDependencies and may not all be
  // declared, but the installed one(s) must ship.
  const imgDir = path.join(nmRoot, '@img');
  if (fs.existsSync(imgDir)) {
    for (const m of fs.readdirSync(imgDir)) seen.add('@img/' + m);
  }
  return [...seen].sort();
}

// Single glob passed to `asar pack --unpack` so native binaries are
// written to app.asar.unpacked AND marked in the asar header (so Electron
// redirects native loads there). MUST be ONE pattern: the asar CLI's
// --unpack takes a single value (repeating the flag keeps only the last),
// so we brace-expand every native extension into one matchBase glob.
// Without this, native .node/.dll stay inside the asar; Electron then
// extracts a .node to a temp dir WITHOUT its sibling DLLs (e.g. sharp's
// libvips), and dlopen fails with "The specified module could not be
// found".
const UNPACK_GLOB = '*.{node,exe,dll,dylib,so}';

// Subdirs that are pure noise (docs/tests) — skipped to keep the asar
// lean. We deliberately do NOT skip build/prebuilds/bin: those hold the
// native binaries, which we now KEEP and let --unpack handle.
const NOISE_DIRS = new Set(['test', 'tests', 'doc', 'docs', '.github', 'example', 'examples', '__tests__']);

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
// Copy a node_modules package in full (including native binaries — those
// are unpacked at pack time, NOT skipped here; skipping them lost the
// asar's "unpacked" markers so Electron couldn't find the .node files).
function copyPackage(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.isDirectory() && NOISE_DIRS.has(entry.name)) continue;
    const sp = path.join(src, entry.name);
    const dp = path.join(dst, entry.name);
    if (entry.isDirectory()) copyPackage(sp, dp);
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
    console.error('Re-create dist-stable/ by extracting dist/MiniMaxAssetTool-1.1.3-x64.zip');
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
  const pkgsToSync = collectClosure(nmSrc, RUNTIME_DEP_ROOTS);
  console.log('  resolved ' + pkgsToSync.length + ' runtime packages (deps closure): ' + pkgsToSync.join(', '));
  let pkgBytes = 0;
  for (const pkg of pkgsToSync) {
    const src = path.join(nmSrc, pkg);
    const dst = path.join(nmDst, pkg);
    if (!fs.existsSync(src)) {
      console.warn('  (skip-nm)  ' + pkg + '  (not installed — run `npm install`)');
      continue;
    }
    rimraf(dst);
    copyPackage(src, dst);
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

  console.log('[4/4] Repacking asar (unpacking native binaries)...');
  // Regenerate app.asar.unpacked from scratch so stale leftovers from the
  // original electron-builder layout don't linger.
  rimraf(ASAR + '.unpacked');
  await run(process.execPath, [asarBin, 'pack', WORK, ASAR, '--unpack', UNPACK_GLOB]);
  rimraf(WORK);

  const stat = fs.statSync(ASAR);
  console.log('\n[DONE] ' + ASAR);
  console.log('       size: ' + (stat.size / 1024 / 1024).toFixed(1) + ' MB');
  console.log('       backup: ' + BACKUP);
  console.log('       Restart dist-stable/win-unpacked/MiniMaxAssetTool.exe to pick up the new code.');
}

main().catch((e) => { console.error(e); process.exit(1); });
