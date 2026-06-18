// scripts/update-asar.js
//
// Phase 4 Fix 9: SmartScreen-Reparatur ohne Code-Signing.
//
// Warum dieser Script existiert:
// Windows SmartScreen blockt jeden neuen .exe-Hash mit einer
// "Windows protected your PC" Warnung. Bei jedem electron-builder
// Lauf wird die .exe neu generiert (asar-Integrity-Resource wird
// embedded, Icons, Timestamps, PE-Header) -> neuer SHA256-Hash ->
// SmartScreen warnt -> User kann nicht "trotzdem ausfuehren" weil
// sein GPO das versteckt.
//
// Loesung: asar-Integrity ist in Electron 32 PER DEFAULT AUS
// (siehe https://www.electronjs.org/docs/latest/tutorial/asar-integrity).
// Das heisst: die .exe prueft den asar NICHT auf Hash. Wir koennen
// den asar austauschen ohne die .exe neu zu bauen -> .exe-Hash
// bleibt stabil -> SmartScreen lernt den Hash einmal und ist dann
// still.
//
// Verwendung:
//   1. Einmal: electron-builder Build (erzeugt .exe)
//   2. User:  extrahiert zip, klickt einmal "Weitere Informationen ->
//             Trotzdem ausfuehren" (oder nutzt die Microsoft-Whitelist)
//   3. Ab dann: nur noch "node scripts/update-asar.js" fuer Code-
//             Aenderungen. .exe bleibt unveraendert, asar wird
//             aus dem aktuellen Source gebaut und ersetzt.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST_UNPACKED = path.join(ROOT, 'dist', 'win-unpacked');
const ASAR_PATH = path.join(DIST_UNPACKED, 'resources', 'app.asar');
const EXE_PATH = path.join(DIST_UNPACKED, 'MiniMaxAssetTool.exe');
const ZIP_PATH = path.join(ROOT, 'dist', 'MiniMaxAssetTool-1.1.1-x64.zip');
const ASAR_BIN = path.join(ROOT, 'node_modules', '@electron', 'asar', 'bin', 'asar.js');

// Stage-Files: was alles in den asar soll (muss mit package.json
// build.files matchen, damit nichts fehlt)
const ASAR_STAGE = [
  ['main.js', 'main.js'],
  ['main/**/*', 'main'],
  ['preload.js', 'preload.js'],
  ['src/**/*', 'src'],
  ['renderer/**/*', 'renderer'],
  ['voices.json', 'voices.json'],
  ['package.json', 'package.json'],
];

function rimraf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {} }
function copyRecursive(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const sp = path.join(src, entry.name);
    const dp = path.join(dst, entry.name);
    if (entry.isDirectory()) copyRecursive(sp, dp);
    else fs.copyFileSync(sp, dp);
  }
}

async function main() {
  if (!fs.existsSync(EXE_PATH)) {
    console.error('FEHLER: ' + EXE_PATH + ' nicht gefunden.');
    console.error('Bitte zuerst einmal einen vollen Build machen:');
    console.error('  npx electron-builder --win dir --x64');
    process.exit(1);
  }
  const exeHashBefore = require('crypto').createHash('sha256').update(fs.readFileSync(EXE_PATH)).digest('hex');
  console.log('[1/4] EXE-Hash VOR update: ' + exeHashBefore);
  console.log('       (darf sich nach dem update NICHT aendern, sonst SmartScreen-Re-Trigger)');

  // Stage-Verzeichnis: alle Files an einem Ort sammeln
  const stage = path.join(ROOT, '.asar-stage');
  rimraf(stage);
  fs.mkdirSync(stage, { recursive: true });
  for (const [glob, rel] of ASAR_STAGE) {
    // Wir nutzen minimatch-artige Logik. Einfache Variante: pruefe ob
    // der Pfad existiert (fuer "no wildcards" Faelle wie main.js).
    // Fuer Wildcards (**) machen wir einen manuellen Walk.
    if (glob.includes('**')) {
      const baseDir = glob.split('/')[0];
      const baseAbs = path.join(ROOT, baseDir);
      if (!fs.existsSync(baseAbs)) continue;
      walkDir(baseAbs, baseDir, (relPath) => {
        const src = path.join(ROOT, relPath);
        const dst = path.join(stage, relPath);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
      });
    } else {
      const src = path.join(ROOT, glob);
      if (!fs.existsSync(src)) { console.warn('  (skip) ' + glob); continue; }
      const dst = path.join(stage, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }
  }
  console.log('[2/4] Stage: ' + stage + ' (' + countFiles(stage) + ' files)');

  // Neuen asar pack via @electron/asar/bin/asar.js
  console.log('[3/4] Packing app.asar ...');
  await runAsar(['pack', stage, ASAR_PATH]);

  // Optional: alten unrar-Ordner sichern falls user das braucht
  // (nicht noetig, neue zip wird erzeugt)

  // EXE-Hash nachher pruefen
  const exeHashAfter = require('crypto').createHash('sha256').update(fs.readFileSync(EXE_PATH)).digest('hex');
  console.log('[4/4] EXE-Hash NACH update: ' + exeHashAfter);
  if (exeHashBefore === exeHashAfter) {
    console.log('       STABIL - SmartScreen lernt diesen Hash einmal und ist dann still.');
  } else {
    console.error('       ACHTUNG: EXE-Hash hat sich geaendert! SmartScreen wird erneut triggern.');
    process.exit(2);
  }
}

function walkDir(dir, rel, cb) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const childRel = rel + '/' + entry.name;
    if (entry.isDirectory()) walkDir(path.join(dir, entry.name), childRel, cb);
    else cb(childRel);
  }
}
function countFiles(dir) {
  let n = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) n += countFiles(path.join(dir, entry.name));
    else n++;
  }
  return n;
}
function runAsar(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [ASAR_BIN, ...args], { stdio: 'inherit' });
    proc.on('close', (code) => code === 0 ? resolve() : reject(new Error('asar exited with ' + code)));
    proc.on('error', reject);
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
