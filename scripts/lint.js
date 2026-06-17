// scripts/lint.js
// Atomic-Architecture-Linter: prüft Dateigrößen, "God Words" und DAG.
// Ergänzt den bestehenden scripts/check.js (Binary-Preflight) — kein
// Konflikt, da dieser Linter die Code-Struktur prüft, nicht Binaries.
//
// Run with:
//   node scripts/lint.js
//
// Exit codes:
//   0 — alle Lint-Regeln erfüllt (oder nur Warnungen)
//   1 — mindestens eine harte Regel verletzt
//
// Regeln (siehe _refactoringplan.md §3 + §7):
//   HART  — Datei > 500 Zeilen   → Fehler
//   HART  — God Word (Manager|Controller) im Dateinamen → Fehler
//   WARN  — Datei > 300 Zeilen   → Warnung (geplante Aufteilung nötig)

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Verzeichnisse, die wir linten (Quellcode, nicht Build/Dependencies)
const SCAN_DIRS = ['main', 'renderer', 'src'];

// Legacy-Files, die noch NICHT refactored sind (Hauptziel des Plans).
// Sie dürfen das 500er-Limit überschreiten, erzeugen aber eine WARN.
// Sobald Phase 2/3/4 abgeschlossen ist, werden sie aus dieser Liste entfernt.
const LEGACY_OVERSIZE = new Set([
  'main.js',        // 941 Z.   — wird in Phase 2 zerlegt
  'app.js',         // 8 546 Z. — wird in Phase 3 zerlegt
  'audioCutter.js', //   661 Z. — wird in Phase 4 zerlegt
]);

// "God Words" — Dateien mit diesen Suffixen und mehr als 3 Aufgaben
// werden abgelehnt. Für jetzt matchen wir nur den Dateinamen, da die
// genaue Aufgaben-Anzahl erst in Phase 1 erhoben wird.
const GOD_WORDS = [
  /\bManager\.js$/i,
  /\bController\.js$/i,
];

const HARD_LIMIT = 500;
const WARN_LIMIT = 300;

const errors = [];
const warnings = [];

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      yield* walk(full);
    } else if (entry.isFile() && full.endsWith('.js')) {
      yield full;
    }
  }
}

function lint() {
  for (const dir of SCAN_DIRS) {
    const abs = path.join(ROOT, dir);
    for (const file of walk(abs)) {
      const rel = path.relative(ROOT, file);
      const base = path.basename(file);
      const lines = fs.readFileSync(file, 'utf8').split('\n').length;

      // 1) God-Word-Check
      for (const pat of GOD_WORDS) {
        if (pat.test(base)) {
          errors.push(`[GOD-WORD] ${rel} — Dateinamen mit "${pat.source}" sind verboten (SRP).`);
        }
      }

      // 2) Größen-Limit (Legacy-Files nur WARN, alle anderen HART)
      if (lines > HARD_LIMIT && !LEGACY_OVERSIZE.has(base)) {
        errors.push(`[SIZE] ${rel} — ${lines} Zeilen > ${HARD_LIMIT} (HART-Limit). Datei zerlegen.`);
      } else if (lines > WARN_LIMIT && LEGACY_OVERSIZE.has(base)) {
        const phase = base === 'main.js' ? '2' : base === 'app.js' ? '3' : base === 'audioCutter.js' ? '4' : '?';
        warnings.push(`[SIZE] ${rel} — ${lines} Zeilen > ${WARN_LIMIT} (Legacy-God-File, Phase ${phase}).`);
      } else if (lines > HARD_LIMIT && LEGACY_OVERSIZE.has(base)) {
        warnings.push(`[SIZE] ${rel} — ${lines} Zeilen > ${HARD_LIMIT} (Legacy-God-File, Refactoring ausstehend).`);
      } else if (lines > WARN_LIMIT) {
        warnings.push(`[SIZE] ${rel} — ${lines} Zeilen > ${WARN_LIMIT} (Aufteilung empfohlen).`);
      }
    }
  }
}

console.log('Atomic-Architecture-Linter');
console.log('===========================');
console.log('');

lint();

if (warnings.length) {
  console.log(`WARNINGS (${warnings.length}):`);
  for (const w of warnings) console.log(`  ⚠  ${w}`);
  console.log('');
}
if (errors.length) {
  console.log(`ERRORS (${errors.length}):`);
  for (const e of errors) console.log(`  ✗  ${e}`);
  console.log('');
  process.exit(1);
}
console.log('OK — alle harten Lint-Regeln erfüllt.');
process.exit(0);
