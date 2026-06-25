// scripts/build-dev-zip.js
//
// Phase 4 Fix 11: Dev-Build-Zip mit node_modules.
//
// Zweck:
//   Statt eine signatur-pflichtige MiniMaxAssetTool.exe zu bauen
//   (die Bitdefender / SmartScreen / Defender immer wieder bei
//   neuen Hashes warnt), packen wir einfach das gesamte Projekt
//   inkl. node_modules in einen Zip. Der User entpackt und
//   doppelklickt start.cmd - das startet die offiziell Microsoft-
//   signierte electron.exe aus node_modules. Diese Binary hat
//   Bitdefender-Reputation, weil sie Teil jedes Electron-npm-
//   Pakets ist.
//
// Vorteile gegen ueber den gebauten .exe:
//   1. Bitdefender / SmartScreen / Defender warnt nicht
//   2. Kein Code-Signing noetig
//   3. start.cmd ist ein Textfile - sein Hash aendert sich NIE
//   4. Friends brauchen kein node.js - alles ist im Zip
//
// Nachteile:
//   1. Zip ist ~1.1 GB gross (node_modules + bin + source)
//   2. User kann den Zip nicht ohne weiteres signieren
//
// Aufruf:
//   node scripts/build-dev-zip.js

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STAGE = path.join(ROOT, '.dev-zip-stage');
const ZIP_PATH = path.join(ROOT, 'dist', 'MiniMaxAssetTool-Dev-1.1.0-x64.zip');

// Was alles in den Zip soll. node_modules + bin + source + start.cmd.
// NICHT enthalten: dist, dist-stable, .asar-stage, etc.
const FILES_TO_INCLUDE = [
  'package.json',
  'package-lock.json',
  'main.js',
  'preload.js',
  'main',
  'src',
  'renderer',
  'scripts',
  'start.cmd',
  'bin',
  'node_modules',
  '.gitignore',
  '.githooks',
  'README.md',
  'LICENSE',
  'linter',  // falls vorhanden
  'tests',
];

const SEVEN_ZIP = path.join(ROOT, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');

function rimraf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {} }
function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const sp = path.join(src, entry.name);
    const dp = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(sp, dp);
    else fs.copyFileSync(sp, dp);
  }
}
function copyFile(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

async function main() {
  console.log('=== Dev-Zip Builder (Phase 4 Fix 11) ===');
  console.log();
  console.log('Idee: Wir packen das ganze Projekt inkl. node_modules in einen Zip.');
  console.log('       Der User entpackt und doppelklickt start.cmd. Das ruft');
  console.log('       die Microsoft-signierte electron.exe auf. Kein Bitdefender-Trigger.');
  console.log();

  // 1. Stage aufbauen
  rimraf(STAGE);
  fs.mkdirSync(STAGE, { recursive: true });

  let totalSize = 0;
  for (const f of FILES_TO_INCLUDE) {
    const src = path.join(ROOT, f);
    const dst = path.join(STAGE, f);
    if (!fs.existsSync(src)) {
      console.log('  [skip] ' + f + ' (nicht vorhanden)');
      continue;
    }
    const st = fs.statSync(src);
    if (st.isDirectory()) {
      copyDir(src, dst);
      const size = (function dirSize(dir) {
        let s = 0;
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) s += dirSize(p);
          else s += fs.statSync(p).size;
        }
        return s;
      })(src);
      totalSize += size;
      console.log('  [dir ] ' + f + ' (' + (size / 1024 / 1024).toFixed(1) + ' MB)');
    } else {
      copyFile(src, dst);
      totalSize += st.size;
      console.log('  [file] ' + f + ' (' + (st.size / 1024).toFixed(1) + ' KB)');
    }
  }

  console.log();
  console.log('Stage-Groesse: ' + (totalSize / 1024 / 1024).toFixed(1) + ' MB');
  console.log();

  // 2. Zip bauen
  try { fs.unlinkSync(ZIP_PATH); } catch (_) {}
  await new Promise((resolve, reject) => {
    const proc = spawn(SEVEN_ZIP, ['a', '-snl-', '-mx=7', ZIP_PATH, STAGE + '/*'], { stdio: 'inherit', windowsHide: true });
    proc.on('close', (code) => code === 0 ? resolve() : reject(new Error('exit ' + code)));
  });

  rimraf(STAGE);
  const zSize = fs.statSync(ZIP_PATH).size;
  console.log();
  console.log('=== FERTIG ===');
  console.log('  ' + ZIP_PATH);
  console.log('  Groesse: ' + (zSize / 1024 / 1024).toFixed(1) + ' MB');
  console.log();
  console.log('Anwendung:');
  console.log('  1. Zip entpacken in beliebigen Ordner');
  console.log('  2. start.cmd doppelklicken');
  console.log('  3. Tool startet (kein Bitdefender, kein SmartScreen, kein Klick noetig)');
}

main().catch((e) => { console.error(e); process.exit(1); });
