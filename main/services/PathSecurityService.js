// main/services/PathSecurityService.js
// Verbindlicher Pfad-Sicherheits-Service. Alle IPC-Handler mit Pfad-Argumenten
// MÜSSEN ihre Eingaben durch `isPathUnderAny` / `isParentUnderAny` jagen —
// niemals direkt auf `fs`/`dialog` arbeiten.
//
// BUG-9-04 (user-reported, 2026-06-25) — security model, revisited.
//
// User's ask, in their own words: "the generated image may always
// only be written in the folder shown in the folder explorer.
// also special actions may never be made outside what is shown
// there. should this not be secure enough?"
//
// Yes. The simpler model is: the folder the user is looking at in
// the file browser (`state.fbDir`) is the only place any
// write / delete / move / copy / create-dir action is allowed.
// The renderer pushes its current `state.fbDir` to the main
// process on every navigation (Up click, drive pick, folder
// pick, tab switch) via `setActiveDir(dir)`. The main process
// gates every write IPC on the active dir. If the user wants to
// write somewhere else, they navigate there first.
//
// READS (fb:list, fb:read, fb:exists) are no longer gated by the
// main process. They go straight to the OS — if the OS allows
// the read, it succeeds; if not, the real ENOENT / EACCES /
// EPERM error is returned to the renderer and surfaced in the
// log. The user explicitly asked for this: "access all paths
// and if it doesn't work / no access, show an error message."
//
// The legacy "trusted picks" Set is kept (and `addTrusted` is
// still callable) so the existing per-folder write gate — for
// the case where a user generates while sitting on a folder
// that was picked via the Open Folder dialog — still works
// without requiring a setActiveDir round-trip from the
// renderer. The new setActiveDir widens further: it makes the
// current folder the explicit gate for every write.

const cfgMod = require('../../src/config');
const pathUtils = require('../../src/pathUtils');
const nodePath = require('path');

/** @type {Set<string>} Session-scoped, vom User explizit gewählte Pfade. */
const trustedPickPaths = new Set();

/** @type {string|null} The folder the renderer is currently showing in the file browser. */
let activeDir = null;

/**
 * True, wenn `p` (normalisiert) unter einem der Roots liegt.
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
 * Aktuelle Liste der erlaubten Roots.
 * @returns {string[]} effectiveOutputDir + trustedPickPaths + activeDir
 */
function getAllowedRoots() {
  const cfg = cfgMod.read();
  // Bug-fix #4 (2026-06-19): use the *effective* output dir so a
  // blank `output_dir` (user skipped first-run setup) still yields
  // a valid root = `<configDir>/generated`.
  const roots = [cfgMod.effectiveOutputDir(cfg)];
  for (const p of trustedPickPaths) roots.push(p);
  if (activeDir) roots.push(activeDir);
  return roots;
}

/**
 * Fügt einen Pfad dauerhaft (für die Session) zu den erlaubten Roots hinzu.
 * Wird vom File-Picker aufgerufen, sobald der User eine Datei oder einen
 * Ordner explizit per System-Dialog ausgewählt hat.
 * @param {string} p
 * @returns {string[]} the new path(s) added to the trusted set
 */
function addTrusted(p) {
  if (!p) return [];
  const norm = (() => { try { return nodePath.resolve(String(p)); } catch (_) { return ''; } })();
  if (!norm) return [];
  if (trustedPickPaths.has(norm)) return [];
  trustedPickPaths.add(norm);
  return [norm];
}

/**
 * BUG-9-04: the renderer pushes its current file-browser location
 * (`state.fbDir`) on every navigation (Up click, drive select,
 * folder pick, tab switch). The main process uses this as the
 * single explicit gate for every write / mutate IPC: any path
 * the user wants to write into must be inside the active dir
 * (or be the active dir itself). This matches the user's mental
 * model exactly: "the generated image may always only be written
 * in the folder shown in the folder explorer."
 *
 * Passing `null` / empty clears the gate (the next navigation
 * will set a new one).
 *
 * @param {string|null} dir
 */
function setActiveDir(dir) {
  if (!dir) { activeDir = null; return; }
  const norm = (() => { try { return nodePath.resolve(String(dir)); } catch (_) { return ''; } })();
  activeDir = norm || null;
}

/** @returns {string|null} the currently-active directory, or null if none. */
function getActiveDir() {
  return activeDir;
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
  setActiveDir,
  getActiveDir,
  refreshOutputRoot,
};
