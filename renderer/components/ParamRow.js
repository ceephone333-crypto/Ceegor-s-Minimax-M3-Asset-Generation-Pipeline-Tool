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

// Render a small "?" button next to a label. BUG-9-05
// (user-reported, 2026-06-25): the previous version opened a
// modal on click. The user asked: "the ones relating to ?
// buttons [should] only [be] shown while hovering over them" —
// so the ? icon is now HOVER-ONLY. The click handler is removed
// entirely; the `data-help` attribute carries the full text so
// the HelpTooltip system (renderer/components/HelpTooltip.js,
// wired in bootstrap.js) shows a tooltip on mouseover. No modal,
// no popup, no interruption.
function helpButton(topic) {
  const b = el('button', {
    type: 'button',
    class: 'help-button',
    title: 'Help',
    'aria-label': 'Help',
    // The inline topic text (1-line summary) is rendered as a
    // hover tooltip via HelpTooltip. HelpTooltip reads
    // `data-help` first, falling back to `title` (see
    // renderer/components/HelpTooltip.js).
    'data-help': topic,
  }, '?');
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
    // v1.1.17 (reported by user): the previous "Custom… + OK" affordance
    // was actively harmful — the OK button ran a min/max clamp that
    // silently replaced a typed value of 10 (for an --n dropdown with
    // max 4) with 4, with only a brief toast. The user's request is
    // clear: "The OK buttons are not needed actually, as long as the
    // tool reads the typed values after starting generation." So the
    // new behaviour is:
    //   - NO OK button — the typed value is what gets read.
    //   - NO client-side clamp on the typed value — the preflight
    //     validateValues() (renderer/specs/modelSpecs.js) already
    //     checks against the spec's min/max, AND the mmx CLI itself
    //     rejects out-of-range values with a clear error.
    //   - On Generate, if the typed value is empty / NaN, the
    //     preflight warn fires ("Value must be a number") and the
    //     user can fix it without ever losing what they typed.
    //   - The dropdown still offers the whitelisted preset values
    //     (1/2/3/4 for --n, the supported sample-rates for
    //     --sample-rate, etc.) so the user has a fast path.
    // The class kept as 'combo-select-number' (NOT renamed) because
    // batchImportHelper.js's getTabInputValue/setTabInputValue check
    // for this exact class name.
    const num = el('input', {
      type: 'number', value: def.customDefault ?? '', placeholder: 'value',
      min: def.min, max: def.max, step: def.step ?? 1, class: 'number-custom-input',
    });
    num.style.display = 'none';
    const numWrap = el('div', { class: 'combo-select-number', style: 'display: flex; gap: 4px; align-items: center;' }, [sel, num]);
    function setNumCustomVisible(visible) {
      if (visible) {
        num.style.display = '';
        numWrap.classList.add('number-custom-active');
      } else {
        num.style.display = 'none';
        numWrap.classList.remove('number-custom-active');
      }
    }
    const current = (def.options || []).find((o) => String(o.value) === String(value));
    if (current) sel.value = String(current.value);
    else if (def.allowCustom !== false && String(value) !== '') {
      // The persisted value doesn't match any dropdown option —
      // treat it as a custom value so the user can see + edit it
      // after a restart. An empty persisted value stays on the
      // first preset (don't auto-open Custom for empty state).
      sel.value = '__custom__';
      num.value = String(value);
      setNumCustomVisible(true);
    }
    sel.addEventListener('change', () => {
      if (sel.value === '__custom__') {
        setNumCustomVisible(true);
        if (def.allowCustom !== false) num.focus();
      } else {
        setNumCustomVisible(false);
        num.value = '';
      }
    });
    input = numWrap;
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
    // v1.1.15 (reported by user): the previous version of
    // the 'enum' kind had NO 'Custom…' option, so a user
    // who wanted to enter a value that wasn't in the
    // dropdown (e.g. a brand-new model name) had no way
    // to do it. Add the same 'Custom…' option the
    // 'number' kind uses, which reveals a small text
    // input next to the dropdown. The dropdown's effective
    // value is then the typed text (or the selected option
    // when not in Custom mode). Honoured the user's
    // `def.allowCustom` opt-out (default: true) so a
    // future caller can still lock the enum to a fixed
    // set.
    if (def.allowCustom !== false) {
      sel.appendChild(el('option', { value: '__custom__' }, 'Custom…'));
    }
    // Hidden text input that shows when 'Custom…' is
    // selected. Per the v1.1.15 spec (user): the dropdown
    // shrinks to 50% width, the text input takes the other
    // 50%, and there's an OK button next to the input.
    // The user has to explicitly type + click OK to apply
    // the custom value (the previous version auto-applied
    // on input, which made typos hard to catch).
    const text = el('input', { type: 'text', value: '', placeholder: 'type custom…', class: 'enum-custom-input' });
    text.style.display = 'none';
    if (id) text.id = id + '-custom';
    // v1.1.17 (reported by user): the previous "Custom… + OK" affordance
    // was actively harmful — the OK button ran no real validation but
    // the user thought clicking it was the only way to "lock in" the
    // typed value. The user's request: "The OK buttons are not needed
    // actually, as long as the tool reads the typed values after
    // starting generation." So the new behaviour is:
    //   - NO OK button. The text input value IS the effective value.
    //   - On Generate, the preflight validateValues() (renderer/specs
    //     /modelSpecs.js) + the mmx CLI both reject unknown values
    //     with a clear error. We don't preempt that with a silent
    //     client-side rewrite.
    //   - The dropdown still offers the whitelisted preset values so
    //     the user has a fast path.
    // The CSS class 'enum-custom-active' on the wrapper still drives
    // the 50/50 layout (dropdown shrinks to 50%, text input takes the
    // other 50%) — only the OK button is gone.
    const wrap = el('div', { class: 'combo-select-enum', style: 'display: flex; gap: 4px; align-items: center;' }, [sel, text]);
    function setCustomVisible(visible) {
      if (visible) {
        text.style.display = '';
        wrap.classList.add('enum-custom-active');
      } else {
        text.style.display = 'none';
        wrap.classList.remove('enum-custom-active');
      }
    }
    const current = (def.options || []).find((o) => String(o.value) === String(value));
    if (current) sel.value = String(current.value);
    else if (def.allowCustom !== false && String(value) !== '') {
      // The persisted value doesn't match any dropdown option —
      // treat it as a custom value so the user can see + edit it
      // after a restart. Empty persisted value stays on the first
      // preset (don't auto-open Custom for empty state).
      sel.value = '__custom__';
      text.value = String(value);
      setCustomVisible(true);
    }
    sel.addEventListener('change', () => {
      if (sel.value === '__custom__') {
        setCustomVisible(true);
        text.focus();
      } else {
        setCustomVisible(false);
        text.value = '';
      }
    });
    if (id) sel.id = id;
    input = wrap;
    input.el = sel;
    input.getValue = () => {
      if (sel.value === '__custom__') return text.value;
      return sel.value;
    };
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
  // Bug-fix (reported by user — "we still don't see input fields for
  // custom options"): for the COMPOSITE kinds (enum, number, enum-text,
  // text+fileFilters) `input` is the WRAPPER div that holds the <select>
  // PLUS the hidden custom text input, the OK button, and the Browse
  // button, while `input.el` is just the inner <select>/<input> kept as a
  // value-reference. The row used to append `input.el || input`, i.e. the
  // bare inner control — so the wrapper (and therefore the "Custom…" text
  // field, the OK button, and the Browse button) was NEVER inserted into
  // the DOM. Selecting "Custom…" revealed nothing because the field
  // didn't exist on the page. Append `input` itself (which for the simple
  // kinds IS the control), and keep `input.el` only as the `.el`
  // value-reference alias. This also restores the Browse button on
  // file-picker rows (e.g. the image --subject-ref field) and makes
  // batchImportHelper's `.combo-select-*` wrapper detection work.
  const row = el('div', { class: 'row' }, [lbl, input]);
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
  // v1.1 (audit H8): also listen on the inner custom-number input.
  // The number-kind OK button dispatches `input` on the inner input
  // (NOT `change` on the outer select), so the guards never fired
  // when the user typed a custom W/H and pressed OK. The user saw
  // "no warning", clicked Generate, and got a server-side 400.
  for (const param of [width, height]) {
    const inner = param.input && param.input.querySelector
      ? param.input.querySelector('.number-custom-input')
      : null;
    if (inner) {
      inner.addEventListener('input', recheck);
    }
  }
  recheck();
  setTimeout(recheck, 0);
  return warning;
}

window.ParamRow = { helpButton, buildParamRow, attachImageDimGuards };
