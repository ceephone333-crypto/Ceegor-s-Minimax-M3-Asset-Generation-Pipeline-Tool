// main/interfaces/IConfigProvider.d.ts
// Verbindlicher Vertrag für den Config-Provider.
// Implementierung: main/services/ConfigProvider.js (Phase 2).

/**
 * Persistierte Konfiguration. Felder sind explizit — der Sanitizer
 * in main/models/ConfigSchema.js filtert alle anderen Eingaben.
 *
 * @typedef {object} Config
 * @property {string} api_key
 *   '' wenn nicht gesetzt; sonst der Roh-Key (Renderer maskiert vor UI).
 * @property {string} output_dir
 *   Absoluter Pfad zum Output-Verzeichnis.
 * @property {'global' | 'cn'} region
 * @property {'light' | 'dark'} theme
 * @property {Array<{name: string, value: string}>} styles
 *   Vom User definierte Style-Presets.
 */

/**
 * Liest / schreibt / saniert die User-Config (`config.txt` neben
 * der .exe). Sanitizer: nur die in `Config` deklarierten Felder
 * werden in die Datei zurückgeschrieben — ein kompromittierter
 * Renderer kann keine zusätzlichen Schlüssel einschleusen.
 *
 * @typedef {object} IConfigProvider
 * @property {() => Config} read
 *   Aktuelle Config. Wird **nicht** durch den Provider validiert —
 *   Aufrufer können davon ausgehen, dass die Datei konsistent ist.
 * @property {(cfg: Partial<Config>) => Config} write
 *   Schreibt die bereinigte Config zurück und gibt die final
 *   gespeicherte Version zurück.
 * @property {() => string} configPath
 *   Absoluter Pfad zur `config.txt`. Wird im Diagnose-Dialog
 *   angezeigt, damit der User die Datei manuell prüfen kann.
 */

module.exports = {};
