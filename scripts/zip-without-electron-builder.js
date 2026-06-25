// scripts/zip-without-electron-builder.js
// Zip dist-out/win-unpacked/ into a portable .zip via .NET ZipFile
// (System.IO.Compression.FileSystem). electron-builder's own zip
// target hangs at the winCodeSign symlink stage on accounts
// without SeCreateSymbolicLinkPrivilege, so we skip the entire
// electron-builder pipeline and use .NET (already on every
// Windows machine since Windows 7+).
//
// Output: <out>/MiniMaxAssetTool-<version>-x64.zip

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist-out');
const UNPACKED = path.join(DIST, 'win-unpacked');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = PKG.version;
const OUT_DIR = process.argv[2] || DIST;
const ZIP_NAME = `MiniMaxAssetTool-${VERSION}-x64.zip`;
const ZIP_PATH = path.join(OUT_DIR, ZIP_NAME);

if (!fs.existsSync(UNPACKED)) {
  process.stderr.write('✖  ' + UNPACKED + ' not found. Run `npm run build` first.\n');
  process.exit(1);
}
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// Remove existing zip (CreateFromDirectory refuses to overwrite).
if (fs.existsSync(ZIP_PATH)) {
  fs.rmSync(ZIP_PATH, { force: true });
}

process.stdout.write('Zipping ' + UNPACKED + ' → ' + ZIP_PATH + '\n');

// PowerShell helper that uses System.IO.Compression.ZipFile.
// ZipFile.CreateFromDirectory(source, destination, compressionLevel, includeBaseDirectory).
// CompressionLevel.Optimal = 0, Fastest = 1.
const psScript = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory(
  ${JSON.stringify(UNPACKED)},
  ${JSON.stringify(ZIP_PATH)},
  [System.IO.Compression.CompressionLevel]::Optimal,
  $false
)
Write-Host "Done."
`;

try {
  execFileSync('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive',
    '-Command', psScript,
  ], { stdio: 'inherit' });
} catch (e) {
  process.stderr.write('PowerShell exited with code ' + e.status + '\n');
  if (e.stdout) process.stderr.write('STDOUT: ' + e.stdout + '\n');
  if (e.stderr) process.stderr.write('STDERR: ' + e.stderr + '\n');
  process.exit(1);
}

const stat = fs.statSync(ZIP_PATH);
process.stdout.write(`Done. ${ZIP_PATH}  (${(stat.size / 1024 / 1024).toFixed(1)} MB)\n`);