// scripts/extract-app-asar-from-zip.js
// Verify the build .zip contains the latest app.asar by extracting
// resources/app.asar and checking a sentinel string from a recently
// modified file (e.g. the new section04_Settings.js -- the M2
// regression guard is a unique phrase in the new code).

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ZIP_PATH = process.argv[2];
if (!ZIP_PATH) {
  process.stderr.write('Usage: node scripts/extract-app-asar-from-zip.js <zip-path>\n');
  process.exit(1);
}

const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(ROOT, 'dist-out', 'verify-asar');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

// Step 1: extract resources/app.asar out of the zip via PowerShell.
const psScript = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead(${JSON.stringify(ZIP_PATH)})
foreach ($e in $zip.Entries) {
  if ($e.FullName -eq 'resources/app.asar') {
    $out = [System.IO.File]::OpenWrite(${JSON.stringify(path.join(TMP, 'app.asar'))})
    $e.Open().CopyTo($out)
    $out.Close()
    break
  }
}
$zip.Dispose()
`;
spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', psScript], { stdio: 'inherit' });

// Step 2: extract the asar.
spawnSync(
  process.execPath,
  [path.join(ROOT, 'node_modules', '@electron', 'asar', 'bin', 'asar.js'),
   'extract',
   path.join(TMP, 'app.asar'),
   path.join(TMP, 'extracted')],
  { stdio: 'inherit' }
);

// Step 3: check the package.json version + a sentinel string.
const pkg = JSON.parse(fs.readFileSync(path.join(TMP, 'extracted', 'package.json'), 'utf8'));
process.stdout.write('app.asar version: ' + pkg.version + '\n');

const settingsSrc = fs.readFileSync(
  path.join(TMP, 'extracted', 'renderer', 'sections', 'section04_Settings.js'),
  'utf8'
);
const hasM2Guard = /preserve every\s*\n?\s*unknown key so future config fields aren't wiped/.test(settingsSrc);
process.stdout.write('section04_Settings.js has M2 regression guard: ' + hasM2Guard + '\n');

// Check that the new behavior tests are present.
const testDir = path.join(ROOT, 'tests', 'unit', 'renderer');
// These tests are loaded by node --test from outside app.asar, but
// check that the source files they reference are current (e.g.
// section04_Settings.js was last modified recently).
const settingsStat = fs.statSync(path.join(ROOT, 'renderer', 'sections', 'section04_Settings.js'));
process.stdout.write('section04_Settings.js source mtime: ' + settingsStat.mtime.toISOString() + '\n');