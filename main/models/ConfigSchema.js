// main/models/ConfigSchema.js
// Sanitizer für Renderer-eingehende Config-Objekte.
// Entfernt alle Felder, die nicht im Schema definiert sind, und
// erzwingt Typen. Ein kompromittierter Renderer kann so keine
// unbekannten Schlüssel in config.txt einschleusen.

/**
 * @typedef {object} RawConfig
 * @property {*} [api_key]
 * @property {*} [output_dir]
 * @property {*} [region]
 * @property {*} [theme]
 * @property {*} [styles]
 */

/**
 * Sanitiert eine vom Renderer (oder von beliebigem Caller) übergebene
 * Config auf das im IConfigProvider-Vertrag deklarierte Schema.
 *
 * @param {RawConfig|undefined|null} cfg
 * @returns {{
 *   api_key: string,
 *   output_dir: string,
 *   region: 'global' | 'cn',
 *   theme: 'light' | 'dark',
 *   styles: Array<{name: string, value: string}>,
 * }}
 */
function sanitize(cfg) {
  cfg = cfg || {};
  return {
    api_key: typeof cfg.api_key === 'string' ? cfg.api_key : '',
    output_dir: typeof cfg.output_dir === 'string' ? cfg.output_dir : '',
    region: cfg.region === 'cn' ? 'cn' : 'global',
    theme: cfg.theme === 'light' ? 'light' : 'dark',
    styles: Array.isArray(cfg.styles)
      ? cfg.styles
          .filter((s) => s && typeof s === 'object' && typeof s.name === 'string' && typeof s.value === 'string')
          .map((s) => ({ name: s.name, value: s.value }))
      : [],
  };
}

module.exports = { sanitize };
