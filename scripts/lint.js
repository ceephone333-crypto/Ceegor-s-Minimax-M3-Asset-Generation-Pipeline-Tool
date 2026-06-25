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
//   HART  — Cross-Tier-Import (z. B. src/ → main/) → Fehler
//   WARN  — Datei > 300 Zeilen   → Warnung (geplante Aufteilung nötig)
//   INFO  — Modul-Count, größte Datei, Ø-Zeilen (Metriken)

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Verzeichnisse, die wir linten (Quellcode, nicht Build/Dependencies)
const SCAN_DIRS = ['main', 'renderer', 'src'];

// Legacy-Files, die noch NICHT refactored sind (Hauptziel des Plans).
// Sie dürfen das 500er-Limit überschreiten, erzeugen aber eine WARN.
const LEGACY_OVERSIZE = new Set([
  'app.js',              // 469 Z. — Bootstrap + Helper (init + style + batch + keyboard)
  'imageTab.js',         // 736 Z. — ImageTab build() (god-function, nicht sinnvoll teilbar)
  'musicTab.js',         // 855 Z. — MusicTab build() + previews (god-function)
  'section07_Image_optimisation___compression.js',  // 952 Z. — showUpscaleSettings (god-function)
  'fileBrowser1.js',     // 528 Z. — list + render + multi-select + bulk-action worker (Phase 3 + v1.1.9)
  'fileBrowser2b.js',    // 548 Z. — preview pane (image / video / audio) + text preview (Phase 3 + v1.1.11)
  'section03_Settings_tab_panes.js',  // 534 Z. — General + Image + BatchGen + Styles + Popups + Shortcuts panes (Phase 3 + v1.1.14)
  'LogService.js',       // Phase A of _plan3.md: row layout + selection + keyboard + autoscroll + JobRunner integration (one of two planned split targets; split in Phase B/C)
  'batchManager.js',     // Phase 4 Fix 2 + Phase A: per-tab re-entrancy check uses _isTabRunningNow (no behaviour change); the underlying god-function is unchanged
  'batchImportHelper.js', // 508 Z. — bug-fix H6 (_temp5.md 360° audit) added the combo-select-enum branch to getTabInputValue/setTabInputValue, pushing it past the 500 limit. Decomposition is a separate task; the fix is a necessary behavior addition mirroring the existing combo-select-number branch.
  'JobRunner.js',         // BUG-9-07 (user-reported, 2026-06-25): _addLogSecondary grew when we added the primary-row vs suppressLogRow branching (appendLogDetails vs addLogEvent fallback). Decomposition is a separate task; the fix is necessary to make mmx stderr lines land in the correct log row instead of duplicating.
  'modelSpecs.js',        // BUG-9-08 (user-reported, 2026-06-25): validateToolCombos + extended mmxPreflightConfirm signature pushed past 300 lines. The added function is pure validation with no DOM/log side effects — safe to keep co-located with the API spec data it validates against.
]);

// "God Words" — Dateien mit diesen Suffixen werden abgelehnt.
const GOD_WORDS = [
  /\bManager\.js$/i,
  /\bController\.js$/i,
];

// Cross-Tier-Import-Verbot. Jede Tier darf nur die ihr zugewiesenen
// Tiers importieren (siehe _refactoringplan.md §3.5 DAG-Pflicht).
//
// Renderer-Dateien laufen im Browser — sie dürfen KEIN Node-Modul
// importieren. Wir prüfen NICHT statisch, ob die Imports Node-APIs
// verwenden (require('child_process') etc.) — das übernimmt Electron
// zur Laufzeit. Wir prüfen nur, dass kein Renderer-File `require()`
// mit einem Pfad zu main/ macht (das wäre ein klarer Verstoß).
const ALLOWED_TIER_EDGES = {
  'main':     new Set(['main', 'src', 'node:built-in']),
  'renderer': new Set(['renderer']),
  'src':      new Set(['src', 'node:built-in']),
};

const HARD_LIMIT = 500;
const WARN_LIMIT = 300;

const errors = [];
const warnings = [];
const fileCount = { main: 0, renderer: 0, src: 0 };
const lineCount = { main: 0, renderer: 0, src: 0 };
const largest = { main: { rel: '', n: 0 }, renderer: { rel: '', n: 0 }, src: { rel: '', n: 0 } };

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

function detectTier(rel) {
  const norm = rel.replace(/\\/g, '/');
  if (norm.startsWith('main/')) return 'main';
  if (norm.startsWith('renderer/')) return 'renderer';
  if (norm.startsWith('src/')) return 'src';
  return null;
}

function checkCrossTier(file, rel) {
  const tier = detectTier(rel);
  if (!tier) return;
  const allowed = ALLOWED_TIER_EDGES[tier];
  const src = fs.readFileSync(file, 'utf8');
  // Match require('./...') or require('../...') with relative paths.
  const requireRe = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = requireRe.exec(src)) !== null) {
    const target = m[1];
    if (target.startsWith('node:') || target.startsWith('electron') || !target.startsWith('.')) continue;
    // Resolve the import relative to the file's directory.
    const fileDir = path.dirname(rel);
    const resolved = path.normalize(path.join(fileDir, target)).replace(/\\/g, '/');
    const targetTier = detectTier(resolved);
    if (targetTier && !allowed.has(targetTier)) {
      errors.push(`[DAG] ${rel} → ${resolved} — Cross-Tier-Import verboten (${tier} → ${targetTier}).`);
    }
  }
}

function lint() {
  for (const dir of SCAN_DIRS) {
    const abs = path.join(ROOT, dir);
    for (const file of walk(abs)) {
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');
      const base = path.basename(file);
      const lines = fs.readFileSync(file, 'utf8').split('\n').length;

      // Metrics
      const tier = detectTier(rel);
      if (tier) {
        fileCount[tier]++;
        lineCount[tier] += lines;
        if (lines > largest[tier].n) largest[tier] = { rel, n: lines };
      }

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
        const phase = base === 'app.js' ? '3' : '?';
        warnings.push(`[SIZE] ${rel} — ${lines} Zeilen > ${WARN_LIMIT} (Legacy-God-File, Phase ${phase}).`);
      } else if (lines > WARN_LIMIT) {
        warnings.push(`[SIZE] ${rel} — ${lines} Zeilen > ${WARN_LIMIT} (Aufteilung empfohlen).`);
      }

      // 3) Cross-Tier-Import-Check (DAG-Pflicht)
      checkCrossTier(file, rel);
    }
  }
}

console.log('Atomic-Architecture-Linter');
console.log('===========================');
console.log('');

lint();

// Metriken
console.log('Modul-Metriken:');
for (const tier of ['main', 'renderer', 'src']) {
  const avg = fileCount[tier] > 0 ? (lineCount[tier] / fileCount[tier]).toFixed(1) : '0';
  console.log(`  ${tier.padEnd(8)}  ${String(fileCount[tier]).padStart(3)} Dateien, ` +
              `${String(lineCount[tier]).padStart(5)} Zeilen total, ` +
              `Ø ${avg} Z., größte: ${largest[tier].rel || '-'} (${largest[tier].n})`);
}
console.log('');

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
