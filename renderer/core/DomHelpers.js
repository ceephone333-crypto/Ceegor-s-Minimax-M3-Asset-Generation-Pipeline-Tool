// renderer/core/DomHelpers.js
// DOM-Selector-Wrapper. Spätere Migration auf zentrales createElement +
// escapeHtml, um XSS durch ungefilterte innerHTML-Zuweisungen zu verhindern
// (siehe Phase 5 — aktuell nur die Wrapper).

// Phase 4 Fix 16: 'var' statt 'const'. 'const' am Top-Level eines
// <script>-Tags ist NICHT global. Sections (geladen NACH DomHelpers.js,
// aber VOR app.js) rufen bare '$'/'$$' auf. 'var' macht sie global.
var $ = (sel, root = document) => root.querySelector(sel);
var $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/**
 * Erzeugt ein DOM-Element mit Attributen + Kindern.
 * @param {string} tag
 * @param {object} [attrs]
 * @param {(Node|string|null)[]} [children]
 * @returns {HTMLElement}
 */
function createElement(tag, attrs, children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class' || k === 'className') el.className = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else if (v != null && v !== false) el.setAttribute(k, v);
    }
  }
  if (children) for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

// Basic HTML-Escape. Verwendet für XSS-sichere String-Einfügungen.
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Globale Verfügbarmachung (Renderer hat keinen Module-Bundler).
window.$ = $;
window.$$ = $$;
window.createElement = createElement;
window.escapeHtml = escapeHtml;
