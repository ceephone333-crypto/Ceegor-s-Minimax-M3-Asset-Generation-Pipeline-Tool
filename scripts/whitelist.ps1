# scripts/whitelist.ps1
#
# Phase 4 Fix 10: Windows-Defender-Ausnahme fuer unseren Build-Ordner.
#
# Wann du das brauchst:
#   Wenn SmartScreen-Dialog kommt aber "Weitere Informationen -> Trotzdem
#   ausfuehren" fehlt ODER Rechtsklick -> Eigenschaften -> "Zulassen" fehlt.
#   In dem Fall blockt *nicht* SmartScreen, sondern Microsoft Defender
#   Antivirus. Defender wird ueber den gleichen Exclusions-Mechanismus
#   konfiguriert wie jedes andere dev tool (VSCode, Git, Node).
#
# Was es tut:
#   Fuegt den Build-Ordner (mit dem stabilen .exe) zur Microsoft-Defender
#   Exclusion-List hinzu. Defender prueft diesen Ordner nicht mehr.
#   Defender bleibt global aktiv - nur dieser eine Ordner ist ausgenommen.
#   Das ist das gleiche Verfahren das jeder Entwickler fuer VSCode, Git,
#   WebStorm usw. macht.
#
# Wie:
#   PowerShell als Administrator ausfuehren:
#     powershell -ExecutionPolicy Bypass -File scripts\whitelist.ps1
#
# Was nicht passiert:
#   - Defender wird nicht deaktiviert
#   - SmartScreen wird nicht deaktiviert
#   - Real-time protection bleibt an
#   - Nur dieser Ordner wird ueberprueft-ausgenommen

#Requires -RunAsAdministrator

$ErrorActionPreference = 'Stop'

$paths = @(
  Join-Path $PSScriptRoot '..\dist-stable\MiniMaxAssetTool.exe' | Resolve-Path
  Join-Path $PSScriptRoot '..\dist\win-unpacked' | Resolve-Path
)

Write-Host ''
Write-Host '=== Microsoft Defender: Ausnahmen hinzufuegen ===' -ForegroundColor Cyan
Write-Host ''
Write-Host 'Hinweis: Real-time Protection bleibt aktiv. Defender prueft nur' -ForegroundColor Gray
Write-Host '         die unten gelisteten Pfade NICHT. Gleiche Methode wie fuer' -ForegroundColor Gray
Write-Host '         VSCode/Git/WebStorm-Whitelisting.' -ForegroundColor Gray
Write-Host ''

foreach ($p in $paths) {
  if (-not (Test-Path $p)) {
    Write-Host ('  [SKIP] nicht gefunden: ' + $p) -ForegroundColor Yellow
    continue
  }
  # Process exclusion (falls es eine .exe ist)
  if ($p.EndsWith('.exe', [StringComparison]::OrdinalIgnoreCase)) {
    Add-MpPreference -ExclusionProcess $p -ErrorAction SilentlyContinue
    Write-Host ('  [OK] Process-Exclusion: ' + $p) -ForegroundColor Green
  }
  # Path exclusion
  Add-MpPreference -ExclusionPath $p -ErrorAction SilentlyContinue
  Write-Host ('  [OK] Pfad-Exclusion:    ' + $p) -ForegroundColor Green
}

Write-Host ''
Write-Host 'Verifikation:' -ForegroundColor Cyan
(Get-MpPreference | Select-Object -Property ExclusionPath, ExclusionProcess | Format-List | Out-String) -split "`n" | ForEach-Object { Write-Host ('  ' + $_) }
Write-Host ''
Write-Host 'Fertig. Tool sollte jetzt ohne Defender-Warnung starten.' -ForegroundColor Green
Write-Host 'Falls immer noch eine Meldung kommt: bitte den EXAKTEN Text des' -ForegroundColor Gray
Write-Host 'Dialogs abfotografieren oder abtippen, damit ich gezielt helfen kann.' -ForegroundColor Gray
Write-Host ''
