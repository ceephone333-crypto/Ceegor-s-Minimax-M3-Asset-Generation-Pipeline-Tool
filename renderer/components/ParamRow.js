// renderer/components/ParamRow.js
// UI helper functions. Phase 3 Block 22.
// Extracted from app.js: helpButton, buildParamRow, attachImageDimGuards.
//
// All functions are pure (or DOM-only) — no state coupling.
//
// `el` (create-element helper) is exposed on window so the other
// renderer files (imageTabA, speechTab, musicTab, etc.) can call
// it without having to re-import. The old monolithic app.js had it
// at top-level, so it was already a global. The refactor that moved
// it here into a `const` accidentally scoped it to this script tag
// only — the other tab files (which are separate <script> tags in
// index.html) couldn't see it, so TABS.image.build() threw on the
// first `el('div', ...)` call and the image-tab content was empty.

// Expose the helper on window so it survives across <script> tags.
window.el = window.createElement || (window.DomHelpers && window.DomHelpers.createElement) || (() => document.createElement('div'));
// Phase 4 Fix 15: 'var' statt 'const'. 'const' am Top-Level eines
// <script>-Tags ist NICHT global. Aeltere Dateien (imageTab,
// musicTab, ...) referenzieren 'el' direkt. 'var el' am Top-Level
// eines <script>-Tags WIRD global und macht den helper ueberall
// sichtbar — gleicher Trick wie bei 'state' in section24_State.js.
var el = window.el;

// Render a small "?" button next to a label. Click opens a
// modal with the help text for the given topic. The topic can
// be a string (1-line hover summary) or a key into the central
// helpTopics map (richer text).
function helpButton(topic) {
  const b = el('button', { type: 'button', class: 'help-button', title: 'Help' }, '?');
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    // The shim (app.js) is the authoritative showHelp impl.
    if (window.showHelp) window.showHelp(topic);
  });
  return b;
}

// Build a "parameter row" with label, dropdown, optional help tooltip.
// `def = { kind, options, default, help, customType }`
//   kind: 'enum' | 'boolean' | 'text' | 'number' | 'enum-text' (enum with custom text override)
//   options: [{ value, label }]   value==='' means "off / default"
//   fileFilters (for kind:'text'): adds a Browse button with these filters
//   id: explicit DOM id (used for state save/load + cross-tab unique key)
function buildParamRow(label, def, id) {
  const helpEl = def.help ? helpButton(def.help) : null;
  const lbl = el('label', {}, [label, helpEl].filter(Boolean));

  let input;
  const value = def.value ?? def.default ?? '';

  if (def.kind === 'boolean') {
    const sel = el('select', {});
    sel.appendChild(el('option', { value: 'off' }, 'Off'));
    sel.appendChild(el('option', { value: 'on' }, 'On'));
    sel.value = value ? 'on' : 'off';
    if (id) sel.id = id;
    input = sel;
  } else if (def.kind === 'number' || def.kind === 'enum-number') {
    const sel = el('select', {});
    for (const o of def.options) {
      sel.appendChild(el('option', { value: String(o.value) }, o.label ?? String(o.value)));
    }
    if (def.allowCustom !== false) {
      sel.appendChild(el('option', { value: '__custom__' }, 'Custom…'));
    }
    const num = el('input', { type: 'number', value: def.customDefault ?? '', placeholder: 'value', min: def.min, max: def.max, step: def.step ?? 1 });
    num.style.display = 'none';
    const current = (def.options || []).find((o) => String(o.value) === String(value));
    if (current) sel.value = String(current.value);
    else if (def.allowCustom !== false) {
      sel.value = '__custom__';
      num.style.display = '';
      num.value = String(value);
    }
    sel.addEventListener('change', () => {
      if (sel.value === '__custom__') {
        num.style.display = '';
        if (def.allowCustom !== false) num.focus();
      } else {
        num.style.display = 'none';
        num.value = '';
      }
    });
    input = el('div', { class: 'combo-select-number', style: 'display: flex; gap: 4px; align-items: center;' }, [sel, num]);
    input.getValue = () => {
      if (sel.value === '__custom__') return num.value;
      return sel.value;
    };
    input.el = sel;
  } else if (def.kind === 'text' && def.fileFilters) {
    const text = el('input', { type: 'text', value: String(value), placeholder: def.placeholder || '', class: 'text-input-with-browse' });
    if (id) text.id = id;
    const browseBtn = el('button', { type: 'button', class: 'btn-mini' }, 'Browse…');
    browseBtn.addEventListener('click', async () => {
      try {
        const r = await window.api.fbOpenDialog({ filters: def.fileFilters });
        if (r && r.ok && r.path) text.value = r.path;
      } catch (_) { /* user cancelled */ }
    });
    input = el('div', { class: 'text-browse-row', style: 'display: flex; gap: 4px; align-items: center;' }, [text, browseBtn]);
    input.getValue = () => text.value;
    input.el = text;
  } else if (def.kind === 'enum-text') {
    const sel = el('select', {});
    for (const o of def.options) {
      sel.appendChild(el('option', { value: String(o.value) }, o.label ?? String(o.value)));
    }
    const text = el('input', { type: 'text', value: '', placeholder: 'or type custom…' });
    if (id) text.id = id + '-custom';
    const current = (def.options || []).find((o) => String(o.value) === String(value));
    if (current) sel.value = String(current.value);
    else text.value = String(value);
    sel.addEventListener('change', () => { text.value = ''; });
    input = el('div', { class: 'enum-text-row', style: 'display: flex; gap: 4px; align-items: center;' }, [sel, text]);
    input.getValue = () => text.value || sel.value;
    input.el = sel;
  } else if (def.kind === 'enum') {
    const sel = el('select', {});
    for (const o of def.options) {
      sel.appendChild(el('option', { value: String(o.value) }, o.label ?? String(o.value)));
    }
    const current = (def.options || []).find((o) => String(o.value) === String(value));
    if (current) sel.value = String(current.value);
    if (id) sel.id = id;
    input = sel;
  } else if (def.kind === 'textarea') {
    // Multi-line textarea for prompt-style fields. Defaults to a
    // generous 8 rows + 2000-char cap (matches the spec the user
    // asked for: "prompts can have up to 2000 characters and we
    // want them to be shown completely"). The textarea uses
    // wrap="soft" so long single lines wrap visually rather than
    // forcing a horizontal scroll inside the field; combined with
    // the .prompt-textarea CSS rule the field grows with its
    // content up to a sensible max-height before falling back to
    // internal scrolling.
    const taMax = (typeof def.maxLength === 'number') ? def.maxLength : 2000;
    const taRows = (typeof def.rows === 'number') ? def.rows : 8;
    const ta = el('textarea', {
      class: 'prompt-textarea',
      rows: String(taRows),
      maxLength: String(taMax),
      spellcheck: 'false',
      placeholder: def.placeholder || '',
      style: 'resize: vertical; min-height: 96px; max-height: 360px; width: 100%; box-sizing: border-box; font-family: inherit; font-size: 13px; line-height: 1.45; padding: 8px 10px;',
    });
    ta.value = String(value);
    if (id) ta.id = id;
    input = ta;
  } else if (def.kind === 'text') {
    input = el('input', { type: 'text', value: String(value), placeholder: def.placeholder || '' });
    if (id) input.id = id;
  } else {
    input = el('input', { type: 'text', value: String(value) });
  }
  const row = el('div', { class: 'row' }, [lbl, input.el || input]);
  const elAlias = input.el || input;
  const getValueAlias = input.getValue || (() => input.value);
  input.getValue = getValueAlias;
  return { row, input, el: elAlias, getValue: getValueAlias };
}

// Attach a runtime aspect-ratio / width / height guard to the
// three params (aspect, width, height) returned by
// buildParamRow. Validates w/h ranges, warns on bad combos.
function attachImageDimGuards(aspect, width, height) {
  const warning = el('div', { class: 'image-dim-warning', style: 'display: none;' });
  function recheck() {
    const a = aspect.input.getValue();
    const w = parseInt(width.input.getValue(), 10);
    const h = parseInt(height.input.getValue(), 10);
    warning.style.display = 'none';
    warning.innerHTML = '';
    if (!a && (!w || !h)) return;
    if (a) {
      const m = String(a).match(/^(\d+):(\d+)$/);
      if (!m) {
        warning.appendChild(el('span', { style: 'color: var(--err);' },
          `Aspect ratio "${a}" is not in the form W:H. Use 16:9 etc.`));
        warning.style.display = '';
        return;
      }
    }
    if (w && w < 512) { warning.appendChild(el('span', { style: 'color: var(--err);' }, 'Width must be at least 512.')); warning.style.display = ''; return; }
    if (w && w > 2048) { warning.appendChild(el('span', { style: 'color: var(--err);' }, 'Width cannot exceed 2048.')); warning.style.display = ''; return; }
    if (h && h < 512) { warning.appendChild(el('span', { style: 'color: var(--err);' }, 'Height must be at least 512.')); warning.style.display = ''; return; }
    if (h && h > 2048) { warning.appendChild(el('span', { style: 'color: var(--err);' }, 'Height cannot exceed 2048.')); warning.style.display = ''; return; }
    if (w && w % 8 !== 0) { warning.appendChild(el('span', { style: 'color: var(--warn);' }, `Width ${w} is not a multiple of 8; will be rounded.`)); warning.style.display = ''; }
    if (h && h % 8 !== 0) { warning.appendChild(el('span', { style: 'color: var(--warn);' }, `Height ${h} is not a multiple of 8; will be rounded.`)); warning.style.display = ''; }
  }
  aspect.el.addEventListener('change', recheck);
  width.el.addEventListener('change', recheck);
  height.el.addEventListener('change', recheck);
  recheck();
  setTimeout(recheck, 0);
  return warning;
}

window.ParamRow = { helpButton, buildParamRow, attachImageDimGuards };
