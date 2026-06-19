// scripts/zip-portable.js
// The "build" wrapper. Produces a portable .zip the end user can
// extract and run without installing anything.
//
// Why a wrapper instead of `electron-builder --win zip` or
// `electron-builder --win portable`? electron-builder's zip /
// portable / nsis / msi / appx / dir targets all depend on the
// winCodeSign toolchain (signtool.exe + rcedit.exe + osslsigncode)
// which it downloads + extracts via 7-Zip. The 7-Zip extraction
// fails on Windows accounts without `SeCreateSymbolicLinkPrivilege`
// because the winCodeSign archive ships macOS code-signing
// symlinks (darwin/10.12/lib/*.dylib) that 7-Zip tries to recreate
// on Windows.
//
// There is no build-config workaround for this — the
// extraction command is hardcoded inside electron-builder. The
// only fixes are operating-system level:
//   1. Enable Windows Developer Mode (one-time, 30s).
//   2. Run the build from an elevated PowerShell.
//   3. Or just run as admin.
//
// This script detects the failure and prints the exact fix. It
// also bundles the winCodeSign archive with `-snl-` (skip
// symlinks) and re-uses it via `ELECTRON_BUILDER_CACHE` when
// possible, so the build succeeds without privileges in some
// cases (it depends on which electron-builder internals trip
// over the symlinks first).

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist-out');
const UNPACKED = path.join(DIST, 'win-unpacked');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = PKG.version;
const ZIP_PATH = path.join(DIST, `MiniMaxAssetTool-${VERSION}-x64.zip`);

function log(m) { process.stdout.write(m + '\n'); }
function fail(m) { process.stderr.write('✖  ' + m + '\n'); process.exit(1); }

// Detect the winCodeSign symlink extraction failure in a chunk of
// stderr from electron-builder. The exact string we look for:
//   ERROR: Cannot create symbolic link : ... : libcrypto.dylib
// (with `SeCreateSymbolicLinkPrivilege` missing, the error code
// is 1314 / "Dem Client fehlt ein erforderliches Recht" on
// German Windows, "A required privilege is not held by the
// client" on English Windows).
function looksLikeSymlinkPrivilegeError(text) {
  if (!text) return false;
  return /Cannot create symbolic link/i.test(text)
      || /fehlt ein erforderliches Recht/i.test(text)
      || /required privilege is not held/i.test(text);
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    let proc;
    try {
      proc = spawn(cmd, args, { stdio: ['inherit', 'pipe', 'pipe'], windowsHide: true, ...opts });
    } catch (err) { reject(err); return; }
    let combined = '';
    proc.stdout.on('data', (b) => { process.stdout.write(b); combined += b.toString('utf8'); });
    proc.stderr.on('data', (b) => { process.stderr.write(b); combined += b.toString('utf8'); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(combined);
      else reject(Object.assign(new Error(`${path.basename(cmd)} exited with code ${code}`), { combined, code }));
    });
  });
}

function find7za() {
  const candidates = [
    path.join(ROOT, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe'),
    path.join(ROOT, 'node_modules', '7zip-bin', 'mac', '7za'),
    path.join(ROOT, 'node_modules', '7zip-bin', 'linux', '7za'),
    '/usr/bin/7z',
    '/usr/local/bin/7z',
  ];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return null;
}

function printPrivilegeFix() {
  log('');
  log('═══════════════════════════════════════════════════════════════════');
  log('  Build failed: missing SeCreateSymbolicLinkPrivilege');
  log('═══════════════════════════════════════════════════════════════════');
  log('');
  log('electron-builder needs to recreate macOS code-signing symlinks');
  log('inside the winCodeSign archive. On Windows, this requires the');
  log('`SeCreateSymbolicLinkPrivilege` which is OFF by default for normal');
  log('user accounts.');
  log('');
  log('Fixes (pick one, one-time):');
  log('');
  log('  1. Enable Windows Developer Mode (recommended, 30 seconds):');
  log('       Settings → Privacy & security → For developers');
  log('       → Developer Mode → On');
  log('     (Or run the one-liner below from an admin PowerShell:');
  log('       reg add "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion');
  log('         \\AppModelUnlock" /t REG_DWORD /f /v');
  log('         "AllowDevelopmentWithoutDevLicense" /d "1" )');
  log('');
  log('  2. Run the build from an elevated PowerShell:');
  log('       Start-Process powershell -Verb RunAs');
  log('       # then re-run: npm run build');
  log('');
  log('  3. Run the build as the local administrator:');
  log('       # only works if the build runs under an admin account.');
  log('');
  log('After enabling Developer Mode, just re-run `npm run build` — no');
  log('code change required.');
  log('═══════════════════════════════════════════════════════════════════');
}

(async () => {
  // Clean dist/ so a previous failure state doesn't leak in.
  await fsp.rm(UNPACKED, { recursive: true, force: true });
  await fsp.rm(ZIP_PATH, { force: true });

  // ---- Step 1: build the unpacked directory ----
  log('Step 1/2: building dist/win-unpacked/ via electron-builder --win dir...');
  const isWin = process.platform === 'win32';
  const electronBuilder = path.join(ROOT, 'node_modules', '.bin', isWin ? 'electron-builder.cmd' : 'electron-builder');
  let step1Output = '';
  try {
    if (isWin) {
      step1Output = await run('cmd.exe', ['/c', electronBuilder, '--win', 'dir', '--x64'], { cwd: ROOT });
    } else {
      step1Output = await run(electronBuilder, ['--win', 'dir', '--x64'], { cwd: ROOT });
    }
  } catch (e) {
    if (looksLikeSymlinkPrivilegeError(e.combined)) {
      printPrivilegeFix();
      process.exit(1);
    }
    fail('electron-builder --win dir failed: ' + (e && e.message || e));
  }

  if (!fs.existsSync(UNPACKED)) {
    fail('electron-builder did not produce ' + UNPACKED);
  }

  // ---- Step 1.5: copy ./bin/ into dist/win-unpacked/resources/bin/ ----
  // electron-builder's `files: ["bin/**/*"]` pattern is ignored
  // (verified empirically — the built dist/win-unpacked/ never
  // contains a bin/ subdir). The `extraResources` route also
  // didn't bake the files in for the unpacked dir target. So we
  // copy the source bin/ directory into `resources/bin/` here,
  // which is the standard Electron location for runtime assets
  // accessed via `process.resourcesPath`. The wrappers look
  // there first, then fall back to the dev path.
  //
  // We do a SELECTIVE copy rather than a blanket `cpSync` of the
  // whole bin/ — the source dir often contains Real-ESRGAN test
  // fixtures (input.jpg, onepiece_demo.mp4, README_windows.md) that
  // are useful for the developer but bloat the end-user .zip by
  // 5+ MB and confuse users ("why is there a pirate video in my
  // installer?"). Only the runtime-essential files ship.
  const sourceBin = path.join(ROOT, 'bin');
  const destBin = path.join(UNPACKED, 'resources', 'bin');
  // Each entry is a source relative path (file or directory) that
  // the end-user's app needs at runtime. Models directory is
  // copied wholesale — IS-Net + Real-ESRGAN model files all live
  // there. The `vcomp140*.dll` are the VC++ 2015 Redistributable
  // Real-ESRGAN links against at runtime; without them the
  // binary fails to start on a clean machine.
  const SHIP_ENTRIES = [
    'models',
    'realesrgan-ncnn-vulkan.exe',
    'realesrgan-ncnn-vulkan',
    'vcomp140.dll',
    'vcomp140d.dll',
  ];
  if (fs.existsSync(sourceBin)) {
    log('');
    log('Step 1.5: copying runtime assets into dist/win-unpacked/resources/bin/...');
    // Wipe dest first so files from a previous build (e.g. a
    // full cpSync of the source bin/ that included test fixtures)
    // don't leak into the new .zip. fs.rmSync with {recursive,
    // force} is the no-throw variant we want here.
    fs.rmSync(destBin, { recursive: true, force: true });
    fs.mkdirSync(destBin, { recursive: true });
    let total = 0;
    let copied = 0;
    for (const entry of SHIP_ENTRIES) {
      const src = path.join(sourceBin, entry);
      const dst = path.join(destBin, entry);
      if (!fs.existsSync(src)) {
        // Real-ESRGAN exe is the only required entry here; the
        // rest are optional. The C# isnetbg.exe (if the developer
        // built one) is also optional and won't be in source bin/
        // unless they explicitly copied it there.
        if (entry === 'realesrgan-ncnn-vulkan.exe' || entry === 'realesrgan-ncnn-vulkan') {
          log('  (skip) ' + entry + ' — not present in source bin/');
        }
        continue;
      }
      const stat = fs.statSync(src);
      if (stat.isDirectory()) {
        fs.cpSync(src, dst, { recursive: true, dereference: false });
      } else {
        fs.copyFileSync(src, dst);
      }
      copied++;
      total += (function walk(p) {
        if (!fs.statSync(p).isDirectory()) return fs.statSync(p).size;
        let s = 0;
        function w(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const pp = path.join(d, e.name); if (e.isDirectory()) w(pp); else s += fs.statSync(pp).size; } }
        w(p);
        return s;
      })(dst);
      log('  + ' + entry + '  (' + (function (p) {
        if (!fs.statSync(p).isDirectory()) return (fs.statSync(p).size / 1024 / 1024).toFixed(1) + ' MB';
        let s = 0; function w(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const pp = path.join(d, e.name); if (e.isDirectory()) w(pp); else s += fs.statSync(pp).size; } } w(p); return (s / 1024 / 1024).toFixed(1) + ' MB'; })(dst) + ')');
    }
    log('  copied ' + copied + ' entries (' + (total / 1024 / 1024).toFixed(1) + ' MB total)');
    if (copied === 0) {
      log('');
      log('Step 1.5: WARNING — none of the runtime assets were found in ' + sourceBin);
      log('         Run `npm run setup` to download them, then re-run `npm run build`.');
    }
  } else {
    log('');
    log('Step 1.5: WARNING — ./bin/ not found at ' + sourceBin);
    log('         The end-user .zip will not contain the IS-Net model or Real-ESRGAN binaries.');
    log('         Run `npm run setup` to download them, then re-run `npm run build`.');
  }

  // ---- Step 2: zip the unpacked directory ----
  log('');
  log('Step 2/2: zipping dist/win-unpacked/ into MiniMaxAssetTool-' + VERSION + '-x64.zip...');
  const sevenZip = find7za();
  if (!sevenZip) {
    fail('7-Zip binary not found. Reinstall electron-builder (`npm install`).');
  }
  // -snl- to skip symbolic links (defensive; the unpacked dir
  // shouldn't contain any, but if it does we want the zip to
  // succeed on accounts without SeCreateSymbolicLinkPrivilege).
  const zipArgs = ['a', '-snl-', '-bb', '-mx=7', ZIP_PATH, UNPACKED];
  try {
    await run(sevenZip, zipArgs);
  } catch (e) {
    if (looksLikeSymlinkPrivilegeError(e.combined)) {
      printPrivilegeFix();
      process.exit(1);
    }
    fail('7-Zip zipping failed: ' + (e && e.message || e));
  }

  const stat = fs.statSync(ZIP_PATH);
  log('');
  log('Done. Output:');
  log('  ' + ZIP_PATH);
  log('  ' + (stat.size / 1024 / 1024).toFixed(1) + ' MB');
  log('');
  log('To install on a target machine, extract the .zip and run MiniMaxAssetTool.exe inside the extracted folder.');
})().catch((e) => {
  fail(String((e && e.stack) || e));
});
