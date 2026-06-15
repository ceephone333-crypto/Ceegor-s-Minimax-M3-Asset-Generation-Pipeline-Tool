# sync-dist.ps1
# Copies the latest source files into the dist/ build so end-users running
# `start.bat` (or the portable MiniMaxAssetTool.exe) get the same fixes as
# developers running `npm start`.
# Run this any time you change the source and want the dist to reflect it.
#
# Usage (PowerShell, from the project root):
#   .\sync-dist.ps1
#
# Or with -WhatIf to preview:
#   .\sync-dist.ps1 -WhatIf

param([switch]$WhatIf)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

# productName in package.json is "MiniMaxAssetTool" -> dist\MiniMaxAssetTool\app
$productName = 'MiniMaxAssetTool'
$distApp = Join-Path $root "dist\$productName\app"

# Fallback: auto-detect if productName was renamed.
if (-not (Test-Path $distApp)) {
  $candidates = @()
  if (Test-Path (Join-Path $root 'dist')) {
    Get-ChildItem -Path (Join-Path $root 'dist') -Directory -ErrorAction SilentlyContinue |
      Where-Object { Test-Path (Join-Path $_.FullName 'app') } |
      ForEach-Object { $candidates += (Join-Path $_.FullName 'app') }
  }
  if ($candidates.Count -eq 1) {
    $distApp = $candidates[0]
    Write-Host "Note: using auto-detected dist app dir: $distApp" -ForegroundColor DarkCyan
  } elseif ($candidates.Count -gt 1) {
    Write-Host "ERROR: multiple dist app dirs found under dist\:" -ForegroundColor Red
    $candidates | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    Write-Host "  Rename the productName in package.json or delete the stale dist\ subfolder." -ForegroundColor Red
    exit 1
  }
}

if (-not (Test-Path $distApp)) {
  Write-Host "ERROR: dist app dir not found at $distApp" -ForegroundColor Red
  Write-Host "  Run 'npm run build:dir' first to create the dist." -ForegroundColor Red
  exit 1
}

# Use a flat list of (src, dst) pairs — no hashtables so the script
# works under any PowerShell locale.
# Note: voices.json only lives under src/ in this repo (no root copy).
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
  $dstPath = Join-Path $distApp $dstRel
  if (-not (Test-Path $srcPath)) {
    Write-Host "SKIP  (missing source): $srcRel" -ForegroundColor Yellow
    continue
  }
  if ($WhatIf) {
    Write-Host "WOULD COPY $srcRel -> dist\$dstRel"
  } else {
    Copy-Item -Path $srcPath -Destination $dstPath -Force
    Write-Host "OK    $srcRel -> dist\$dstRel" -ForegroundColor Green
  }
}

if (-not $WhatIf) {
  Write-Host ""
  Write-Host "Dist is now in sync with the source." -ForegroundColor Cyan
  Write-Host "Restart the app (start.bat or dist\MiniMaxAssetTool.exe) to pick up the new code." -ForegroundColor Cyan
}
