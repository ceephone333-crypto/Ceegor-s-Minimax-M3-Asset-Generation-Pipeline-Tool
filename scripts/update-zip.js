// scripts/update-zip.js
//
// Phase 4 Fix 9: Erstellt die auslieferbare .zip mit dem STABILEN
// .exe + dem frisch gebauten asar.
//
// Schritte:
//   1. Build frischen asar (via @electron/asar) im tmp-Verzeichnis
//   2. Kopiere STABLES .exe aus dist-stable/MiniMaxAssetTool.exe
//      (Hash aendert sich NICHT, SmartScreen bleibt still)
//   3. Packe alles in die .zip (mit realesrgan etc. aus dist-build)

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STABLE_EXE = path.join(ROOT, 'dist-stable', 'MiniMaxAssetTool.exe');
const DIST_BUILD = path.join(ROOT, 'dist-build', 'win-unpacked');
const STAGE = path.join(ROOT, '.zip-stage');
const OUT_DIR = path.join(ROOT, 'dist');
const ZIP_NAME = 'MiniMaxAssetTool-1.1.3-x64.zip';

const ASAR_STAGE_FILES = [
  'main.js', 'preload.js', 'package.json',
  'main', 'src', 'renderer',
];

function rimraf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {} }

async function main() {
  if (!fs.existsSync(STABLE_EXE)) {
    console.error('FEHLER: ' + STABLE_EXE + ' nicht gefunden.');
    console.error('Bitte zuerst einmal einen vollen Build + dist-stable Setup machen:');
    console.error('  npx electron-builder --win dir --x64');
    console.error('  copy dist-build\\win-unpacked\\MiniMaxAssetTool.exe dist-stable\\');
    process.exit(1);
  }
  if (!fs.existsSync(DIST_BUILD)) {
    console.error('FEHLER: ' + DIST_BUILD + ' nicht gefunden.');
    console.error('Build mit: npx electron-builder --win dir --x64');
    process.exit(1);
  }

  // 1. Stable stage vorbereiten
  rimraf(STAGE);
  fs.mkdirSync(STAGE + '/win-unpacked', { recursive: true });

  // 2. Kopiere ALLE Files aus dist-build/win-unpacked (ausser .exe)
  copyDirFiltered(DIST_BUILD, STAGE + '/win-unpacked', (p) => {
    if (p === 'MiniMaxAssetTool.exe') return false; // stable .exe kommt aus dist-stable
    return true;
  });

  // 3. Frisch gepackten asar reinkopieren (as Integrity per Default aus)
  // Zuerst: asar bauen aus Source
  const asarStage = path.join(ROOT, '.asar-stage');
  rimraf(asarStage);
  fs.mkdirSync(asarStage, { recursive: true });
  for (const f of ASAR_STAGE_FILES) {
    const src = path.join(ROOT, f);
    if (!fs.existsSync(src)) { console.warn('  (skip) ' + f); continue; }
    const dst = path.join(asarStage, f);
    if (fs.statSync(src).isDirectory()) copyDir(src, dst);
    else { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); }
  }
  const asarBin = path.join(ROOT, 'node_modules', '@electron', 'asar', 'bin', 'asar.js');
  const asarOut = path.join(STAGE, 'win-unpacked', 'resources', 'app.asar');
  await runCmd(process.execPath, [asarBin, 'pack', asarStage, asarOut]);

  // 4. STABLES .exe reinkopieren (immer das gleiche SHA256)
  fs.copyFileSync(STABLE_EXE, path.join(STAGE, 'win-unpacked', 'MiniMaxAssetTool.exe'));
  const hash = require('crypto').createHash('sha256').update(fs.readFileSync(STABLE_EXE)).digest('hex');
  console.log('[OK] Stable .exe copied (SHA256: ' + hash + ')');
  console.log('     SmartScreen lernt diesen Hash einmal und ist dann still.');

  // 5. Zip bauen
  const zipPath = path.join(OUT_DIR, ZIP_NAME);
  try { fs.unlinkSync(zipPath); } catch (_) {}
  await runCmd(
    path.join(ROOT, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe'),
    ['a', '-snl-', '-mx=7', zipPath, STAGE + '/win-unpacked']
  );

  rimraf(asarStage);
  rimraf(STAGE);
  console.log('\n[FERTIG] ' + zipPath);
  console.log('  enthaelt das STABILE .exe (' + hash.slice(0, 12) + '...) + frischen asar.');
}

function copyDirFiltered(src, dst, filter) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const sp = path.join(src, entry.name);
    const dp = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDirFiltered(sp, dp, filter);
    else if (filter(entry.name)) fs.copyFileSync(sp, dp);
  }
}
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const sp = path.join(src, entry.name);
    const dp = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(sp, dp);
    else fs.copyFileSync(sp, dp);
  }
}
function runCmd(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: 'inherit', windowsHide: true });
    proc.on('close', (code) => code === 0 ? resolve() : reject(new Error('exit ' + code)));
    proc.on('error', reject);
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
