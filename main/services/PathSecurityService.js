// main/services/PathSecurityService.js
// Verbindlicher Pfad-Sicherheits-Service. Alle IPC-Handler mit Pfad-Argumenten
// MÜSSEN ihre Eingaben durch `isPathUnderAny` / `isParentUnderAny` jagen —
// niemals direkt auf `fs`/`dialog` arbeiten.
//
// "Allowed roots" = output_dir + jeder Pfad, den der User explizit
// per System-Open-Dialog gewählt hat. Letzterer ist die einzige
// Möglichkeit für den Main-Process, von einem "autorisierten" Pfad
// außerhalb von `output_dir` zu erfahren.

const cfgMod = require('../../src/config');
const pathUtils = require('../../src/pathUtils');

/** @type {Set<string>} Session-scoped, vom User explizit gewählte Pfade. */
const trustedPickPaths = new Set();

/**
 * Aktuelle Liste der erlaubten Roots.
 * @returns {string[]} effectiveOutputDir + trustedPickPaths
 */
function getAllowedRoots() {
  const cfg = cfgMod.read();
  // Bug-fix #4 (2026-06-19): use the *effective* output dir so a
  // blank `output_dir` (user skipped first-run setup) still yields
  // a valid root = `<configDir>/generated`. That's exactly the path
  // the renderer fabricates as its in-memory default and the path
  // the app actually writes generated files into. Before this
  // change, every fb:*/image:optimize/upscale/audio IPC on a freshly
  // generated file was rejected because the allow-list was empty.
  const roots = [cfgMod.effectiveOutputDir(cfg)];
  for (const p of trustedPickPaths) roots.push(p);
  return roots;
}

/**
 * True, wenn `p` (normalisiert) unter einem der Roots liegt.
 * Delegiert an `src/pathUtils` — keine eigene Logik, damit sich
 * die Normalisierungs-Regeln (z. B. Trailing-Slashes) nicht
 * zwischen Service und Utils unterscheiden.
 * @param {string} p
 * @param {string[]} [roots]
 * @returns {boolean}
 */
function isPathUnderAny(p, roots) {
  return pathUtils.isPathUnderAny(p, roots || getAllowedRoots());
}

/**
 * True, wenn der **Parent** von `p` unter einem Root liegt.
 * @param {string} p
 * @param {string[]} [roots]
 * @returns {boolean}
 */
function isParentUnderAny(p, roots) {
  return pathUtils.isParentUnderAny(p, roots || getAllowedRoots());
}

/**
 * Fügt einen Pfad dauerhaft (für die Session) zu den erlaubten Roots hinzu.
 * Wird vom File-Picker aufgerufen, sobald der User eine Datei oder einen
 * Ordner explizit per System-Dialog ausgewählt hat.
 * @param {string} p
 */
function addTrusted(p) {
  if (p) trustedPickPaths.add(p);
}

/**
 * Liest `config.output_dir` erneut ein. Aufzurufen nach `config:set`,
 * damit Root-Listen konsistent bleiben.
 */
function refreshOutputRoot() {
  // Set ist read-only-by-design; `getAllowedRoots()` liest bei jedem
  // Aufruf frisch aus `cfgMod`, also gibt es hier nichts zu tun.
  // Diese Funktion existiert nur als expliziter "Refresh-Hook"
  // für zukünftige Caching-Optimierungen.
}

module.exports = {
  getAllowedRoots,
  isPathUnderAny,
  isParentUnderAny,
  addTrusted,
  refreshOutputRoot,
};
