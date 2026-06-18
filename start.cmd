@echo off
REM ============================================================
REM MiniMax Assets Tool - Launcher
REM ============================================================
REM Phase 4 Fix 12: Trailing-backslash-Fix fuer Pfade mit Leerzeichen.
REM
REM Startet die App via der offiziell Microsoft-signierten
REM electron.exe aus node_modules. Diese Binary hat bei
REM Bitdefender / SmartScreen / Defender Reputation weil sie
REM Teil jedes Electron-npm-Pakets ist.
REM
REM Doppelklick -> App startet. Keine Warnungen, keine
REM Bestaetigungen, kein Whitelisting.
REM ============================================================

setlocal EnableDelayedExpansion
cd /d "%~dp0"

REM Pfad OHNE trailing backslash (vermeidet Quoting-Bug bei Pfaden
REM mit Leerzeichen wie "C:\Projects 1\..."):
REM   %~dp0.  (der Punkt strippt den letzten Backslash)
set "ROOT_DIR=%~dp0."

REM Electron-Binary aus node_modules
set "ELECTRON_BIN=%ROOT_DIR%\node_modules\electron\dist\electron.exe"

if not exist "%ELECTRON_BIN%" (
  echo FEHLER: Electron-Binary nicht gefunden:
  echo   %ELECTRON_BIN%
  echo Bitte zuerst ausfuehren: npm install
  pause
  exit /b 1
)

echo Starte MiniMax Assets Tool...
echo   Pfad: %ROOT_DIR%
echo   Electron: %ELECTRON_BIN%
"%ELECTRON_BIN%" "%ROOT_DIR%" %*
endlocal
