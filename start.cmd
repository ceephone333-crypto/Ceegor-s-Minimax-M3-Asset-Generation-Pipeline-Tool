@echo off
REM ============================================================
REM MiniMax Assets Tool - Launcher
REM ============================================================
REM Phase 4 Fix 11: Bitdefender-kompatibler Launcher.
REM
REM Startet die App via der offiziell Microsoft-signierten
REM electron.exe aus node_modules. Diese Binary hat bei
REM Bitdefender / SmartScreen / Defender Reputation weil sie
REM Teil jedes Electron-npm-Pakets ist - die wird nicht
REM als "unbekannter Herausgeber" eingestuft.
REM
REM Doppelklick -> App startet. Keine Warnungen, keine
REM Bestaetigungen, kein Whitelisting.
REM
REM Im Gegensatz zum vorherigen "MiniMaxAssetTool.exe" brauchen
REM wir hier keinen Code-Signing-Cert, weil die Binary
REM (electron.exe) bereits von Microsoft ueber den npm-
REM Vertriebsweg signiert wurde.
REM ============================================================

setlocal
cd /d "%~dp0"

REM Electron-Binary aus node_modules verwenden
set "ELECTRON_BIN=%~dp0node_modules\electron\dist\electron.exe"

if not exist "%ELECTRON_BIN%" (
  echo FEHLER: Electron-Binary nicht gefunden:
  echo   %ELECTRON_BIN%
  echo Bitte zuerst ausfuehren: npm install
  pause
  exit /b 1
)

echo Starte MiniMax Assets Tool...
"%ELECTRON_BIN%" "%~dp0" %*
endlocal
