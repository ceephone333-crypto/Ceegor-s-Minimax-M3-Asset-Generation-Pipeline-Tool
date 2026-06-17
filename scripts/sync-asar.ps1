# scripts/sync-asar.ps1
# Updates dist\win-unpacked\resources\app.asar with the current source files
# so the packaged build reflects local changes without a full electron-builder
# run (which requires elevated privileges due to winCodeSign symlink issues
# on Windows). Mirrors what sync-dist.ps1 does for the unpacked-format dist.
#
# Usage (PowerShell, from the project root):
#   .\scripts\sync-asar.ps1
#
# Requires: node + the asar CLI (already installed in node_modules\.bin\asar.cmd
# via electron-builder's deps). The script writes a backup .bak next to
# the original asar before replacing it, so a failed repack can be reverted.

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot | Split-Path -Parent
$asar = Join-Path $root 'dist\win-unpacked\resources\app.asar'
$backup = "$asar.bak"
$workDir = Join-Path $root 'dist\asar-work'

if (-not (Test-Path $asar)) {
  Write-Host "ERROR: app.asar not found at $asar" -ForegroundColor Red
  Write-Host "  Run 'npm run build:dir' (or 'npm run build') first." -ForegroundColor Red
  exit 1
}

# Wipe any prior extraction dir + temp dirs from a previous failed run.
if (Test-Path $workDir) {
  Remove-Item -Recurse -Force $workDir
}
New-Item -ItemType Directory -Path $workDir | Out-Null

$asarBin = Join-Path $root 'node_modules\.bin\asar.cmd'

Write-Host "Extracting $asar ..." -ForegroundColor Cyan
& $asarBin extract $asar $workDir
if ($LASTEXITCODE -ne 0) {
  Write-Host "ERROR: asar extract failed" -ForegroundColor Red
  exit 1
}

# Mirror the same file list that sync-dist.ps1 uses, plus config.js
# (config.js lives under src/ in this repo and is mirrored by the
# package.json `files` config into the packaged asar).
$pairs = @(
  'main.js|main.js',
  'preload.js|preload.js',
  'src\mmx.js|src\mmx.js',
  'src\config.js|src\config.js',
  'src\fileBrowser.js|src\fileBrowser.js',
  'src\state.js|src\state.js',
  'src\batches.js|src\batches.js',
  'src\voices.json|src\voices.json',
  'renderer\app.js|renderer\app.js',
  'renderer\index.html|renderer\index.html',
  'renderer\styles.css|renderer\styles.css'
)

foreach ($p in $pairs) {
  $parts = $p -split '\|', 2
  $srcRel = $parts[0]
  $dstRel = $parts[1]
  $srcPath = Join-Path $root $srcRel
  $dstPath = Join-Path $workDir $dstRel
  if (-not (Test-Path $srcPath)) {
    Write-Host "SKIP  (missing source): $srcRel" -ForegroundColor Yellow
    continue
  }
  $dstDir = Split-Path $dstPath -Parent
  if (-not (Test-Path $dstDir)) {
    New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
  }
  Copy-Item -Path $srcPath -Destination $dstPath -Force
  Write-Host "OK    $srcRel -> asar\$dstRel" -ForegroundColor Green
}

# Backup the original asar, then repack. The backup lives next to
# the asar so a failed repack can be reverted by renaming it back.
if (-not (Test-Path $backup)) {
  Copy-Item -Path $asar -Destination $backup -Force
  Write-Host "Backup saved to $backup" -ForegroundColor DarkCyan
}

Write-Host "Repacking $asar ..." -ForegroundColor Cyan
& $asarBin pack $workDir $asar
if ($LASTEXITCODE -ne 0) {
  Write-Host "ERROR: asar pack failed; original backup is at $backup" -ForegroundColor Red
  exit 1
}

# Clean up the extraction dir.
Remove-Item -Recurse -Force $workDir

Write-Host ""
Write-Host "app.asar is now in sync with the source." -ForegroundColor Cyan
Write-Host "Restart MiniMaxAssetTool.exe to pick up the new code." -ForegroundColor Cyan
