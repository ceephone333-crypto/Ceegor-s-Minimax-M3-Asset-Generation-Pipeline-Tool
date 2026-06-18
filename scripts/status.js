// scripts/status.js
//
// Phase 4 Fix 14: Zeigt mit VOLLEN ABSOLUTEN PFADEN wo alles liegt,
// sodass Copy-Paste in den Explorer funktioniert. Auch fuer mich
// (AI) eine Single-Source-of-Truth: ich sage nie mehr "die zip",
// sondern verweise auf den Output dieses Scripts.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

function line(label, value) {
  console.log('  ' + label.padEnd(28) + ' : ' + value);
}

function infoFor(absPath) {
  try {
    const st = fs.statSync(absPath);
    const hash = crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
    const mtime = st.mtime.toISOString().replace('T', ' ').slice(0, 19);
    return { size: st.size, hash, mtime, exists: true };
  } catch (e) {
    return { exists: false };
  }
}

function fmtSize(b) {
  if (b > 1e9) return (b / 1e9).toFixed(2) + ' GB';
  if (b > 1e6) return (b / 1e6).toFixed(1) + ' MB';
  if (b > 1e3) return (b / 1e3).toFixed(1) + ' KB';
  return b + ' B';
}

function section(title) {
  console.log('');
  console.log('--- ' + title + ' ---');
}

console.log('');
console.log('=========================================================');
console.log('  MiniMax Assets Tool - Build-Status');
console.log('  Projekt-Root: ' + ROOT);
console.log('=========================================================');

section('1. Der Launcher (Doppelklick)');
const startCmd = path.join(ROOT, 'start.cmd');
const i1 = infoFor(startCmd);
line('start.cmd', startCmd);
if (i1.exists) {
  line('  Groesse / Hash', fmtSize(i1.size) + ' / ' + i1.hash.slice(0, 16) + '...');
}

section('2. Die .exe (Signatur-stabil)');
const stableExe = path.join(ROOT, 'dist-stable', 'MiniMaxAssetTool.exe');
const i2 = infoFor(stableExe);
line('dist-stable/MiniMaxAssetTool.exe', stableExe);
if (i2.exists) {
  line('  SHA256', i2.hash);
  line('  Groesse / Datum', fmtSize(i2.size) + ' / ' + i2.mtime);
}

section('3. Die auslieferbare .zip (portable)');
const portableZip = path.join(ROOT, 'dist', 'MiniMaxAssetTool-1.1.1-x64.zip');
const i3 = infoFor(portableZip);
line('dist/MiniMaxAssetTool-1.1.1-x64.zip', portableZip);
if (i3.exists) {
  line('  Groesse / Datum', fmtSize(i3.size) + ' / ' + i3.mtime);
}

section('4. Die auslieferbare .zip (dev, Doppelklick-fuer-Freunde)');
const devZip = path.join(ROOT, 'dist', 'MiniMaxAssetTool-Dev-1.1.1-x64.zip');
const i4 = infoFor(devZip);
line('dist/MiniMaxAssetTool-Dev-1.1.1-x64.zip', devZip);
if (i4.exists) {
  line('  Groesse / Datum', fmtSize(i4.size) + ' / ' + i4.mtime);
}

section('5. Die ungepackten Built-Files');
const unpacked = path.join(ROOT, 'dist', 'win-unpacked');
const i5 = infoFor(path.join(unpacked, 'MiniMaxAssetTool.exe'));
line('dist/win-unpacked/', unpacked);
if (i5.exists) {
  line('  MiniMaxAssetTool.exe SHA256', i5.hash);
  line('  (sollte GLEICH wie dist-stable sein)', '');
}

section('6. Verfuegbare Build-Scripts');
console.log('  npm run dev            = electron .           (Dev-Mode zum Testen)');
console.log('  npm run build:asar     = baut dist/.zip neu   (asar-only Update)');
console.log('  npm run build:full     = baut .exe + .zip neu (voller Rebuild)');
console.log('  node scripts/build-dev-zip.js = baut 516 MB Dev-Zip neu');
console.log('  node scripts/status.js        = DIESER Status-Output');

console.log('');
console.log('=========================================================');
console.log('');
console.log('  COPY-PASTE-BEREIT (doppelklicken um den Ordner im Explorer zu oeffnen):');
console.log('');
console.log('  Portable-zip:  explorer.exe /select,"' + portableZip + '"');
console.log('  Dev-zip:       explorer.exe /select,"' + devZip + '"');
console.log('  Stable .exe:   explorer.exe /select,"' + stableExe + '"');
console.log('');
console.log('  ODER direkt per PowerShell oeffnen:');
console.log('');
console.log('  Invoke-Item "' + portableZip + '"');
console.log('  Invoke-Item "' + devZip + '"');
console.log('');
console.log('=========================================================');
console.log('');
