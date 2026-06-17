// main.js — Shim für Backward-Compatibility.
// Phase 2 hat die Logik in main/* (Composition Root + Services + IPC) verschoben.
// Dieser Einzeiler hält start.bat, package.json "main" und alle externen
// Aufrufer kompatibel, ohne dass weitere Migrationen nötig sind.
//
// Frühere monolithische Implementierung: siehe git history vor pre-atomic-refactor.

require('./main/index.js');
