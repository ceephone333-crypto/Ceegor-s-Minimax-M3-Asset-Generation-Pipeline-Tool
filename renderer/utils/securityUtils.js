// renderer/utils/securityUtils.js
// API-Key-Maskierung + Reveal-on-Demand Input-Row.
// Extrahiert aus renderer/app.js (Phase 3, Block 1 von N).
//
// Sensible Standardwerte:
//   maskApiKey(key)      -> "abcde***" oder "***" für kurze/empty Keys
//   maskLine(line, key)  -> ersetzt jedes Vorkommen des Keys in `line`
//   showRevealableKey()  -> gibt { row, input, getValue, isRevealed } zurück

/**
 * Maskiert einen API-Key für die Anzeige.
 * Kurze / leere Keys werden vollständig zu "***".
 * @param {string} key
 * @returns {string}
 */
function maskApiKey(key) {
  if (!key || typeof key !== 'string') return '';
  if (key.length <= 5) return '***';
  return key.slice(0, 5) + '***';
}

/**
 * Ersetzt jedes Vorkommen des rohen Keys in `line` durch die
 * maskierte Form. Sicher für Log-Output.
 * @param {string} line
 * @param {string} apiKey
 * @returns {string}
 */
function maskLine(line, apiKey) {
  if (!apiKey || typeof line !== 'string') return line;
  return line.split(apiKey).join(maskApiKey(apiKey));
}

/**
 * Baut eine Input-Row, die den Key maskierter Form anzeigt und
 * erst nach Klick auf "Show" / "Hide" enthüllt.
 *
 * SECURITY:
 *   - Wenn ein Wert existiert und NICHT revealed ist, ist das
 *     Input `readonly` (verhindert versehentliches Tippen über
 *     die Maske).
 *   - Wenn der Wert leer ist, ist das Input editierbar (so
 *     funktioniert Paste beim First-Run).
 *   - getValue() liefert IMMER den rohen Wert — Save-Handler
 *     können ihn bedenkenlos lesen.
 *
 * @param {string} realKey
 * @param {{ label?: string, placeholder?: string }} [opts]
 * @returns {{ row: HTMLElement, input: HTMLInputElement, getValue: () => string, isRevealed: () => boolean }}
 */
function showRevealableKey(realKey, opts) {
  opts = opts || {};
  const placeholder = opts.placeholder || '';
  const label = opts.label || 'API key';
  let curValue = realKey || '';
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.placeholder = placeholder;
  inp.autocomplete = 'off';
  let revealed = false;
  const toggle = document.createElement('button');
  toggle.className = 'btn-mini';
  toggle.type = 'button';
  toggle.textContent = 'Show';

  function refresh() {
    const hasValue = !!curValue;
    if (hasValue) {
      inp.value = revealed ? curValue : maskApiKey(curValue);
      inp.readOnly = !revealed;
    } else {
      inp.value = '';
      inp.readOnly = false;
    }
    toggle.textContent = revealed ? 'Hide' : 'Show';
  }
  inp.addEventListener('input', () => {
    // Wenn der User tippt, ist das die *neue* Real-Value. Wir
    // setzen curValue und refreshed — readonly wird automatisch
    // wieder aktiv, sobald hasValue true ist.
    curValue = inp.value;
    if (curValue && !revealed) {
      // Force-show: tippen über die Maske darf nicht möglich sein.
      revealed = true;
    }
    refresh();
  });
  inp.addEventListener('focus', () => {
    if (!curValue && !revealed) inp.readOnly = false;
  });
  toggle.addEventListener('click', () => {
    revealed = !revealed;
    refresh();
  });
  const labelEl = document.createElement('label');
  labelEl.textContent = label;
  const combo = document.createElement('div');
  combo.className = 'combo';
  combo.appendChild(inp);
  combo.appendChild(toggle);
  const row = document.createElement('div');
  row.className = 'row';
  row.appendChild(labelEl);
  row.appendChild(combo);
  refresh();
  return { row, input: inp, getValue: () => curValue, isRevealed: () => revealed };
}

window.SecurityUtils = { maskApiKey, maskLine, showRevealableKey };
