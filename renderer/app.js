/* renderer/app.js — UI logic, no build step. */
// We use globals (window.api from preload) to stay build-free.

// Tool version: bump / refresh this whenever you ship a build. Format is
// free-form (typically "<semver> · <compile date> <compile time>").
// For now we just stamp the current build date/time. A real build pipeline
// can replace this string at packaging time.
const BUILD_VERSION = `0.1.0 · ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC`;
const TOOL_NAME = 'MiniMax Assets Tool';
const TOOL_INFO =
  'Standalone Windows 11 tool for the MiniMax (mmx) CLI. ' +
  'Generate images, speech, music, and videos from a single UI, ' +
  'with style presets, batch generation, and per-tab output folders.';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ----------------- State -----------------
const state = {
  config: { api_key: '', output_dir: '', region: 'global', theme: 'dark', styles: [] },
  voices: [],
  voicesLoaded: false,
  fbDir: '',
  currentTab: 'image',
  theme: 'dark',
  batches: { image: [], speech: [], music: [], video: [] },
  // Per-tab last visited folder (for per-tab folder persistence, see showTab)
  fbDirs: { image: '', speech: '', music: '', video: '' },
  // Global "Target file prefix" — prepended to every generated file's
  // name. Mirrored on all 4 tabs (one input on each) so the user can
  // tweak it without switching tabs. Persisted to state.json.
  filePrefix: '',
  // Real-ESRGAN model name (passed to the ncnn-vulkan binary via
  // `-n <model>`). The default is the general-purpose 4× BSD-3 model.
  // Users pick a different one in ⚙ Settings → Image upscaling →
  // Model. The actual spawn is whitelisted in src/realesrgan.js to a
  // short known set so a corrupted state.json can't inject an
  // arbitrary model name (or argv flag) into the binary.
  realesrganModel: 'realesrgan-x4plus',
  // Upscale-on-Generate: when true, every newly generated image is
  // upscaled locally (Canvas API) after the mmx call returns, using the
  // settings below. Persisted to state.json so it survives restarts.
  upscaleEnabled: false,
  // The auto-crop options are now part of the upscale settings — they
  // live here so the Add button in the image tab can capture them as
  // part of the batch entry snapshot, and the image tab's generate
  // handler can apply them after the upscale. The ⚙ Settings →
  // Upscale Settings popup exposes all five fields (multiplier,
  // autoCrop, cropWidth, cropHeight, cropAnchorX/Y) so the user can
  // configure everything in one place.
  upscaleSettings: { multiplier: 2, autoCrop: false, cropWidth: 0, cropHeight: 0, cropAnchorX: 'center', cropAnchorY: 'center' },
  // Per-tab generation state used for status dots and the batch runner.
  // "running" while mmx is in flight, "done" after success, "idle" otherwise.
  // Green dot is only shown when the tab is not the active one.
  genStatus: { image: 'idle', speech: 'idle', music: 'idle', video: 'idle' },
  // Set to the tab key while a generation is in progress. Cleared by
  // armGenBtnWithCancel's cleanup. Used by startBatchGen to wait for
  // completion between batch entries.
  generating: null,
};

// ----------------- Utilities -----------------
function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v === false || v == null) { /* skip */ }
    else e.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

function log(line) {
  const logEl = $('#log');
  if (!logEl) return;
  const ts = new Date().toLocaleTimeString();
  logEl.textContent += `[${ts}] ${line}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function toast(msg, kind = 'info', ms = 3000) {
  const root = $('#toast-root');
  const t = el('div', { class: 'toast ' + (kind === 'err' ? 'err' : kind === 'ok' ? 'ok' : kind === 'warn' ? 'warn' : '') }, msg);
  root.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.3s'; }, ms - 300);
  setTimeout(() => t.remove(), ms);
}

// ----------------- Modal -----------------
// Stack-based modal manager. The previous version used a single
// `_modalClose` slot and wiped `modal-root` on every `showModal` call —
// that destroyed any underlying modal (e.g. opening the bulk-paste
// dialog from the BatchGen manager wiped the BatchGen modal entirely,
// and the user lost Esc-to-close on the parent). Stacking keeps each
// modal's DOM around until its own close is called, and Esc closes the
// topmost modal first.
let _modalClose = null;
const _modalStack = [];
function showModal(build) {
  const root = $('#modal-root');
  root.classList.add('active');
  const m = el('div', { class: 'modal' });
  root.appendChild(m);
  const close = () => {
    m.remove();
    if (root.children.length === 0) {
      root.classList.remove('active');
    }
    const idx = _modalStack.indexOf(close);
    if (idx >= 0) _modalStack.splice(idx, 1);
    if (_modalStack.length > 0) {
      _modalClose = _modalStack[_modalStack.length - 1];
    } else if (_modalClose === close) {
      _modalClose = null;
    }
  };
  _modalStack.push(close);
  _modalClose = close;
  build(m, close);
  return close;
}

// Close the active modal when the user presses Escape. Also auto-focus the
// first primary button so Enter triggers it.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && _modalClose) {
    e.preventDefault();
    _modalClose();
  }
});

// ----------------- Startup popup -----------------
// Shown on every fresh launch. Single OK button to dismiss. Reachable later
// from the ⚙ Settings menu (TODO: wire into settings if needed).
function showStartupPopup() {
  showModal((m, close) => {
    m.classList.add('startup-modal');
    m.appendChild(el('h2', {}, TOOL_NAME));
    m.appendChild(el('div', { class: 'startup-version' }, BUILD_VERSION));
    m.appendChild(el('p', { class: 'startup-info' }, TOOL_INFO));
    const shortcuts = el('div', { class: 'shortcuts-box' });
    shortcuts.appendChild(el('h4', {}, '⌨ Keyboard shortcuts'));
    const list = [
      ['Ctrl+Enter', 'Generate on the active tab'],
      ['Ctrl+1 / 2 / 3 / 4', 'Switch to Image / Speech / Music / Video'],
      ['Ctrl+B', 'Open BatchGen for the active tab'],
      ['Ctrl+T', 'Open Style Settings'],
      ['Ctrl+S', 'Open Settings'],
      ['Ctrl+L', 'Toggle dark / light mode'],
      ['Ctrl+F', 'Focus the file-browser filter'],
      ['Ctrl+R', 'Refresh quota'],
    ];
    for (const [keys, desc] of list) {
      shortcuts.appendChild(el('div', { class: 'shortcut-row' }, [
        el('kbd', {}, keys),
        el('span', {}, desc),
      ]));
    }
    m.appendChild(shortcuts);
    m.appendChild(el('div', { class: 'footer' }, [
      el('button', { class: 'primary', onclick: () => {
        close();
        // After the user dismisses the greetings popup, if any of the
        // essential settings (api_key, output_dir) are still empty, walk
        // them through the first-time setup form. The folder field uses
        // the standard Windows folder-selection dialog via pickFolder.
        if (!state.config.api_key || !state.config.output_dir) {
          openFirstTimeSetup();
        }
      } }, 'OK'),
    ]));
    // OK on Enter for convenience
    setTimeout(() => { m.querySelector('button.primary')?.focus(); }, 0);
  });
}

// ----------------- First-time setup popup -----------------
// Shown right after the greetings popup if either the API key or the
// output directory is missing. Fields are pre-filled with whatever
// values are already in config.txt so the user only has to fix the
// gaps. The "Save" button validates that both required fields are
// present and writes the config before closing. "Skip for now" closes
// without saving — the user can fill the values in later from ⚙
// Settings.
function openFirstTimeSetup() {
  showModal((m, close) => {
    m.classList.add('first-time-setup-modal');
    m.appendChild(el('h2', {}, 'First-time setup'));
    m.appendChild(el('p', { style: 'color: var(--fg-2); font-size: 12px; margin-top: 0;' },
      'A few required settings are still empty. Please fill them in to start using the tool. You can change all of these later in ⚙ Settings.'));

    const cfg = { ...state.config };

    // API key
    const apiInput = el('input', { type: 'text', value: cfg.api_key || '', placeholder: 'sk-cp-xxxxxxxx' });
    m.appendChild(el('div', { class: 'row' }, [el('label', {}, 'API key (MiniMax Token Plan)'), apiInput]));

    // Output directory — text input + Browse button that opens the
    // standard Windows folder-selection dialog (the same one the
    // ⚙ Settings popup uses).
    const outInput = el('input', { type: 'text', value: cfg.output_dir || '', placeholder: 'C:\\Users\\me\\Pictures\\MiniMax' });
    const browse = el('button', { class: 'btn-mini', type: 'button' }, 'Browse…');
    browse.addEventListener('click', async () => {
      const picked = await window.api.pickFolder();
      if (picked) outInput.value = picked;
    });
    m.appendChild(el('div', { class: 'row' }, [
      el('label', {}, 'Output directory'),
      el('div', { class: 'combo' }, [outInput, browse]),
    ]));

    // Region (already has a default of 'global' but show it so the
    // user can confirm / change it on first launch).
    const regInput = el('select', {});
    for (const r of ['global', 'cn']) regInput.appendChild(el('option', { value: r }, r));
    regInput.value = cfg.region || 'global';
    m.appendChild(el('div', { class: 'row' }, [el('label', {}, 'Region'), regInput]));

    const save = el('button', { class: 'primary' }, 'Save');
    const skip = el('button', { onclick: close }, 'Skip for now');
    save.addEventListener('click', async () => {
      const api_key = apiInput.value.trim();
      const output_dir = outInput.value.trim();
      const region = regInput.value || 'global';
      if (!api_key) { toast('API key is required. Edit it now or click "Skip for now" and set it later in ⚙ Settings.', 'err', 5000); return; }
      if (!output_dir) { toast('Output directory is required. Pick a folder with the Browse… button, or click "Skip for now".', 'err', 5000); return; }
      const newCfg = { ...state.config, api_key, output_dir, region };
      state.config = await window.api.setConfig(newCfg);
      toast('Settings saved.', 'ok');
      close();
      // Reload anything that depends on config (quota + the file
      // browser, so the freshly-set output_dir is shown).
      refreshQuota();
      refreshBrowser();
    });
    m.appendChild(el('div', { class: 'footer' }, [skip, save]));

    // Focus the first empty field, then the second — saves the user a
    // click when both are blank.
    setTimeout(() => {
      if (!cfg.api_key) apiInput.focus();
      else if (!cfg.output_dir) outInput.focus();
      else apiInput.focus();
    }, 0);
  });
}

// ----------------- Form helpers -----------------

// Build the "Target file prefix" input row. The same row is mounted on
// every tab (image/speech/music/video) but the value is global — when
// the user types in one tab, the other tabs' inputs are updated in
// place so they always show the same prefix. The prefix is prepended
// verbatim to the generated file's name in every gen handler (see
// image/speech/music/video .gen-btn click listeners). The value lives
// in state.filePrefix and is persisted to state.json via saveAllStates.
function buildFilePrefixRow() {
  const input = el('input', {
    type: 'text',
    class: 'file-prefix-input',
    value: state.filePrefix || '',
    placeholder: '(no prefix)',
  });
  // Keep the four mirrored inputs in sync and bump the autosave debounce
  // so the value lands in state.json within ~500ms of the last keystroke.
  input.addEventListener('input', () => {
    state.filePrefix = input.value;
    for (const other of document.querySelectorAll('input.file-prefix-input')) {
      if (other !== input) other.value = state.filePrefix;
    }
    scheduleStateSave();
  });
  return el('div', { class: 'row file-prefix-row' }, [
    el('label', {}, [
      'Target file prefix',
      el('span', {
        class: 'help',
        'data-help': 'Prepended to every generated file name. Empty = original name. Example: prefix "ZYX" turns abc123.jpg into ZYXabc123.jpg.',
        title: 'Prepended to every generated file name. Empty = original name. Example: prefix "ZYX" turns abc123.jpg into ZYXabc123.jpg.',
      }, '?'),
    ]),
    input,
  ]);
}

// Build a "parameter row" with label, dropdown, optional help tooltip.
// `def = { kind, options, default, help, customType }`
//   kind: 'enum' | 'boolean' | 'text' | 'number' | 'enum-text' (enum with custom text override)
//   options: [{ value, label }]   value==='' means "off / default"
//   fileFilters (for kind:'text'): adds a Browse button with these filters
//   id: explicit DOM id (used for state save/load + cross-tab unique key)
function buildParamRow(label, def, id) {
  const helpSpan = def.help ? el('span', { class: 'help', title: def.help, 'data-help': def.help }, '?') : null;
  const lbl = el('label', {}, [label, helpSpan].filter(Boolean));

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
    else if (value !== '' && value != null) { sel.value = '__custom__'; num.value = value; num.style.display = ''; }
    const combo = el('div', { class: 'combo' });
    if (sel.value === '__custom__') combo.classList.add('has-custom');
    sel.addEventListener('change', () => {
      num.style.display = sel.value === '__custom__' ? '' : 'none';
      combo.classList.toggle('has-custom', sel.value === '__custom__');
      if (sel.value !== '__custom__') num.value = '';
    });
    combo.append(sel, num);
    if (id) { sel.id = id + '.sel'; num.id = id + '.num'; }
    input = { el: combo, getValue: () => sel.value === '__custom__' ? num.value : sel.value, type: 'number' };
  } else if (def.kind === 'enum-text') {
    const sel = el('select', {});
    for (const o of def.options) {
      sel.appendChild(el('option', { value: String(o.value) }, o.label ?? String(o.value)));
    }
    if (def.allowCustom !== false) sel.appendChild(el('option', { value: '__custom__' }, 'Custom…'));
    const txt = el('input', { type: 'text', value: def.customDefault ?? '', placeholder: 'custom value' });
    txt.style.display = 'none';
    const current = (def.options || []).find((o) => String(o.value) === String(value));
    if (current) sel.value = String(current.value);
    else if (value) { sel.value = '__custom__'; txt.value = value; txt.style.display = ''; }
    const combo = el('div', { class: 'combo' });
    if (sel.value === '__custom__') combo.classList.add('has-custom');
    sel.addEventListener('change', () => {
      txt.style.display = sel.value === '__custom__' ? '' : 'none';
      combo.classList.toggle('has-custom', sel.value === '__custom__');
    });
    combo.append(sel, txt);
    if (id) { sel.id = id + '.sel'; txt.id = id + '.txt'; }
    input = { el: combo, getValue: () => sel.value === '__custom__' ? txt.value : sel.value, type: 'text' };
  } else if (def.kind === 'text') {
    const inp = el('input', { type: 'text', value, placeholder: def.placeholder || '' });
    if (id) inp.id = id;
    if (def.fileFilters && def.fileFilters.length) {
      // File-picker text input with Browse button
      const browse = el('button', { class: 'btn-mini', type: 'button' }, 'Browse…');
      browse.addEventListener('click', async () => {
        const r = await window.api.pickFile({ title: def.browseTitle || 'Select file', filters: def.fileFilters });
        if (r.ok) { inp.value = r.path; inp.dispatchEvent(new Event('input', { bubbles: true })); }
      });
      const combo = el('div', { class: 'combo' }, [inp, browse]);
      input = inp;  // raw element; arg builder uses inp.value
      const row = el('div', { class: 'row' }, [lbl, combo]);
      return { row, input };
    }
    input = inp;
  } else if (def.kind === 'textarea') {
    input = el('textarea', {}, value);
    if (id) input.id = id;
  } else {
    // enum
    const sel = el('select', {});
    for (const o of def.options) {
      sel.appendChild(el('option', { value: String(o.value) }, o.label ?? String(o.value)));
    }
    sel.value = value ?? def.options?.[0]?.value ?? '';
    if (id) sel.id = id;
    input = sel;
  }

  const row = el('div', { class: 'row' }, [lbl, input.el || input]);
  return { row, input };
}

// Extract the --flag from a param's enclosing .row label (e.g. "--model (hd)"
// → "--model"). The flag is the first "--xxx" token in the label. Returns
// null if the row is unlabeled (e.g. prompt, lyrics textarea, variants row).
function _flagForParam(param) {
  if (!param) return null;
  const el = param.el || param;
  if (!el || !el.closest) return null;
  const row = el.closest('.row');
  if (!row) return null;
  const lbl = row.querySelector('label');
  if (!lbl) return null;
  const m = lbl.textContent && lbl.textContent.match(/--[a-zA-Z][a-zA-Z0-9-]*/);
  return m ? m[0] : null;
}

function appendFlag(args, param) {
  if (!param) return;
  const v = param.getValue ? param.getValue() : (param.value ?? param.el?.value);
  if (v == null || v === '' || v === 'off') return;
  const flag = param.flag || _flagForParam(param);
  if (!flag) {
    console.warn('[appendFlag] could not determine flag for param, skipping', param);
    return;
  }
  args.push(flag, String(v));
}
function appendBoolFlag(args, param, flag) {
  const v = param.getValue ? param.getValue() : param.value;
  if (v === 'on' || v === true) args.push(flag);
}

// ----------------- Image-dim guards -----------------
// Three live warnings below the image tab's W × H row:
//   1. "W × H doesn't match aspect ratio 1:1" — when the user
//      has an aspect ratio selected AND has manually entered both
//      W and H such that their ratio is off by more than 1%.
//      "Correct" auto-fills the offending dimension (W is the
//      source of truth, per the user's spec).
//   2. "W must be a multiple of 8" / "H must be a multiple of
//      8" — mmx rejects non-multiple-of-8 dimensions with a
//      cryptic 400. "Correct" rounds to the nearest multiple.
//   3. Same for the subject-ref field — it must be a valid
//      filesystem path or http(s) URL; mmx rejects everything
//      else.
//
// All three are wired to the param objects returned by
// buildParamRow() so they read the current value via getValue()
// and write back via the underlying input/select (which also
// fires 'input' / 'change' for the per-tab state autosave).
function attachImageDimGuards(aspect, width, height) {
  const warning = el('div', { class: 'image-dim-warning', style: 'display: none;' });
  // We insert the warning into the .section that owns the W × H
  // row, right after the .grid. The caller is responsible for
  // appending the warning element to the right parent.
  // (We return the element so the caller can do that.)
  function setValue(param, v) {
    // Write a numeric value into a buildParamRow number param.
    // The combo (sel + num input) has a "Custom…" option that
    // reveals the num input; we select it, set the value, and
    // dispatch the input event so has-custom class flips.
    const combo = param.el;
    const sel = combo.querySelector('select');
    const num = combo.querySelector('input[type="number"]');
    const options = Array.from(sel.options).map((o) => o.value);
    if (options.includes(String(v))) {
      sel.value = String(v);
      num.style.display = 'none';
      num.value = '';
    } else {
      sel.value = '__custom__';
      num.style.display = '';
      num.value = String(v);
    }
    combo.classList.toggle('has-custom', sel.value === '__custom__');
    num.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function show(text, onCorrect) {
    warning.innerHTML = '';
    const span = el('span', { style: 'flex: 1;' }, text);
    warning.appendChild(span);
    if (onCorrect) {
      const btn = el('button', { class: 'correct-btn', type: 'button' }, 'Correct');
      btn.addEventListener('click', onCorrect);
      warning.appendChild(btn);
    }
    warning.style.display = '';
  }
  function hide() {
    warning.style.display = 'none';
    warning.innerHTML = '';
  }
  function parseAspect(v) {
    if (!v) return null;
    const m = String(v).match(/^(\d+):(\d+)$/);
    if (!m) return null;
    return { w: parseInt(m[1], 10), h: parseInt(m[2], 10) };
  }
  function recheck() {
    const aspectVal = aspect.getValue();
    const w = parseInt(width.getValue(), 10);
    const h = parseInt(height.getValue(), 10);
    const ap = parseAspect(aspectVal);
    // 1. Aspect ratio mismatch.
    if (ap && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      const actual = w / h;
      const expected = ap.w / ap.h;
      // Allow 1% slop for float rounding.
      if (Math.abs(actual - expected) / expected > 0.01) {
        show(
          `W × H (${w}×${h}) doesn't match the selected aspect ratio ${aspectVal}. The API will likely reject this or auto-override one of the values.`,
          () => {
            // Prioritise W as the source of truth: H = W * ratio.
            const newH = Math.max(8, Math.round((w * ap.h) / ap.w / 8) * 8);
            setValue(height, newH);
            recheck();
          },
        );
        return;
      }
    }
    // 2. Divisible-by-8 checks.
    if (Number.isFinite(w) && w > 0 && w % 8 !== 0) {
      show(
        `W (${w}) must be a multiple of 8 (the API rejects other values with a 400).`,
        () => {
          setValue(width, Math.max(8, Math.round(w / 8) * 8));
          recheck();
        },
      );
      return;
    }
    if (Number.isFinite(h) && h > 0 && h % 8 !== 0) {
      show(
        `H (${h}) must be a multiple of 8 (the API rejects other values with a 400).`,
        () => {
          setValue(height, Math.max(8, Math.round(h / 8) * 8));
          recheck();
        },
      );
      return;
    }
    hide();
  }
  // Wire the listeners. buildParamRow number params are combos;
  // the 'input' event bubbles from the inner num input.
  width.el.addEventListener('input', recheck);
  width.el.addEventListener('change', recheck);
  height.el.addEventListener('input', recheck);
  height.el.addEventListener('change', recheck);
  // The aspect select lives in aspect.el directly.
  aspect.el.addEventListener('change', () => {
    // If the user picks a new aspect ratio, auto-fill whichever
    // of W or H is already set (or both, if both are empty, to
    // the first preset value that matches the aspect).
    const aspectVal = aspect.getValue();
    const ap = parseAspect(aspectVal);
    if (!ap) { recheck(); return; }
    const w = parseInt(width.getValue(), 10);
    const h = parseInt(height.getValue(), 10);
    if (Number.isFinite(w) && w > 0) {
      const newH = Math.max(8, Math.round((w * ap.h) / ap.w / 8) * 8);
      setValue(height, newH);
    } else if (Number.isFinite(h) && h > 0) {
      const newW = Math.max(8, Math.round((h * ap.w) / ap.h / 8) * 8);
      setValue(width, newW);
    }
    recheck();
  });
  // Initial pass — picks up restored state on first paint.
  recheck();
  return warning;
}

// Validate the --subject-ref value. mmx accepts:
//   - a local filesystem path that exists (PNG / JPG / JPEG / WebP)
//   - an http(s) URL (and seemingly URLs to a CDN)
//   - an empty string (no character ref)
// Everything else is rejected with a "file not found" or
// "invalid URL" 400. We watch the input and surface a warning
// when the value doesn't look like one of the above.
function attachSubjectRefGuard(subjRef) {
  const warning = el('div', { class: 'subject-ref-warning', style: 'display: none;' });
  const input = subjRef.el;
  function recheck() {
    const v = (input.value || '').trim();
    if (!v) { warning.style.display = 'none'; warning.innerHTML = ''; return; }
    if (/^https?:\/\//i.test(v)) { warning.style.display = 'none'; warning.innerHTML = ''; return; }
    // For local paths we can't easily async-check existence from
    // the renderer (no fs access in the renderer's main world),
    // and the renderer's fb:list already validates this on click.
    // We just sanity-check the shape: must look like a path and
    // have a recognised image extension.
    const looksLikePath = /[\\/]/.test(v) || /^[a-zA-Z]:[\\/]/.test(v) || v.startsWith('./') || v.startsWith('../') || v.startsWith('/') || /^[a-zA-Z0-9_.-]+\.[a-zA-Z0-9]+$/.test(v);
    if (!looksLikePath) {
      warning.innerHTML = '';
      warning.appendChild(el('span', { style: 'flex: 1;' },
        'Subject reference must be a local image path or an http(s) URL. Examples: C:\\Users\\me\\char.png  ·  https://example.com/char.png'));
      warning.style.display = '';
      return;
    }
    const ext = v.toLowerCase().split('.').pop();
    if (!['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      warning.innerHTML = '';
      warning.appendChild(el('span', { style: 'flex: 1;' },
        `Subject reference must be a .png, .jpg, .jpeg or .webp file. Got: .${ext}`));
      warning.style.display = '';
      return;
    }
    warning.style.display = 'none';
    warning.innerHTML = '';
  }
  input.addEventListener('input', recheck);
  recheck();
  return warning;
}

// ----------------- Tabs -----------------
const TABS = {};

// ----------------- Prompt character counter -----------------
// Builds a small "X / 2000" counter for the --prompt argument. The API
// limit is on the --prompt VALUE only (not the entire command line), so
// we count exactly what would be sent in the --prompt argument:
//   extraPrefix + styleText + manual
function computePromptSize(selEl, manualEl, extraPrefix = '') {
  const selVal = selEl ? selEl.value : '';
  const manual = manualEl ? manualEl.value.trim() : '';
  const styleText = getStyleText(selVal);
  return (extraPrefix + styleText + manual).length;
}
function buildPromptCounter({ selEl, manualEl, getExtraPrefix = () => '', max = 2000, id = '' }) {
  const lbl = el('span', { class: 'prompt-counter-label' }, 'Prompt length:');
  const val = el('span', { class: 'prompt-counter-val' }, '0');
  const maxEl = el('span', { class: 'prompt-counter-max' }, ` / ${max}`);
  const wrap = el('div', { class: 'prompt-counter', id: id ? `counter-${id}` : '' }, [lbl, val, maxEl]);
  const update = () => {
    const extra = getExtraPrefix() || '';
    const n = computePromptSize(selEl, manualEl, extra);
    val.textContent = String(n);
    wrap.classList.toggle('warn', n > max * 0.9 && n <= max);
    wrap.classList.toggle('err', n > max);
  };
  if (selEl) selEl.addEventListener('change', update);
  if (manualEl) manualEl.addEventListener('input', update);
  // Initial
  update();
  return { wrap, update };
}

// ----------------- Variants dropdown -----------------
// "Variants" = run the same generation N times (each becomes a separate
// output file). Disabled when a seed is set (would produce identical
// results, wasting API quota). The disabled handler is run initially and
// after every change to the seed control.
function buildVariantsRow({ id, seedInput = null, defaultN = 1, label = '--variants' } = {}) {
  const sel = el('select', { class: 'variants-select', id: id || 'variants' });
  for (let i = 1; i <= 5; i++) {
    sel.appendChild(el('option', { value: String(i) }, `${i}×`));
  }
  sel.value = String(defaultN);
  const lbl = el('label', { class: 'variants-label' }, [
    label,
    el('span', { class: 'help', 'data-help': 'Run this generation N times in a row. Each variant gets its own file. Disabled when a seed is set (all variants would be identical).', title: 'Run this generation N times in a row. Each variant gets its own file. Disabled when a seed is set (all variants would be identical).' }, '?'),
  ]);
  const row = el('div', { class: 'row variants-row' }, [lbl, sel]);
  // seedInput can be:
  //   - a raw element with .value
  //   - the result of buildParamRow: { row, input: { el, getValue, type } }
  //   - the input portion of that: { el, getValue, type }
  const seedEl = seedInput && (seedInput.input ? seedInput.input.el : (seedInput.el || seedInput));
  const readSeed = () => {
    if (!seedInput) return '';
    if (seedInput.input && typeof seedInput.input.getValue === 'function') return seedInput.input.getValue();
    if (typeof seedInput.getValue === 'function') return seedInput.getValue();
    return (seedEl && seedEl.value) || '';
  };
  const updateDisabled = () => {
    if (!seedInput) return;
    const v = readSeed();
    const seeded = String(v) !== '' && String(v) !== 'undefined';
    sel.disabled = seeded;
    if (seeded) sel.title = 'Disabled: a fixed seed would produce identical variants';
    else sel.title = '';
  };
  if (seedEl) {
    seedEl.addEventListener('change', updateDisabled);
    seedEl.addEventListener('input', updateDisabled);
    updateDisabled();
  }
  return { row, sel, updateDisabled };
}

function showTab(name) {
  // Save the current fbDir into the slot for the tab we're leaving so we
  // can restore it on the next visit (per-tab folder persistence).
  const prev = state.currentTab;
  if (prev && state.fbDir) state.fbDirs[prev] = state.fbDir;

  state.currentTab = name;
  // Restore the saved folder for the tab we're entering. refreshBrowser
  // will pick it up via state.fbDirs[currentTab].
  const saved = state.fbDirs[name];
  if (saved) state.fbDir = saved;
  for (const t of $$('.tab')) t.classList.toggle('active', t.dataset.tab === name);
  for (const p of $$('.tabpanel')) p.classList.toggle('active', p.id === `tab-${name}`);
  // Refresh file browser to the matching subfolder if present
  refreshBrowser().catch(() => {});
  // Switching into a tab clears the green "finished" indicator for that tab
  // (the user has effectively seen the result by opening the tab). Red
  // "running" indicators must remain visible.
  if (state.genStatus[name] === 'done') state.genStatus[name] = 'idle';
  refreshTabStatusDots();
  // Persist current tab selection
  scheduleStateSave();
}

// Update the colored status dots on the tab buttons. The rules are:
//   - genStatus === 'running'  → red dot
//   - genStatus === 'done' and tab !== currentTab → green dot
//   - genStatus === 'done' and tab === currentTab → no dot (the user has
//     effectively "seen" the result by switching into the tab)
//   - genStatus === 'idle'     → no dot
function refreshTabStatusDots() {
  for (const tabKey of ['image', 'speech', 'music', 'video']) {
    const t = $(`.tab[data-tab="${tabKey}"]`);
    if (!t) continue;
    // Remove any prior dot
    t.classList.remove('tab-dot-red', 'tab-dot-green');
    const st = state.genStatus[tabKey] || 'idle';
    if (st === 'running') t.classList.add('tab-dot-red');
    else if (st === 'done' && state.currentTab !== tabKey) t.classList.add('tab-dot-green');
  }
  refreshTabEtas();
}

// Per-tab ETA timer. While a generation is running, show a small mm:ss
// countdown next to the tab label, based on the average time of the last
// successful generation in that tab. The countdown is an estimate, not a
// guarantee — but it gives the user a sense of how long the current call
// will still take.
function refreshTabEtas() {
  for (const tabKey of ['image', 'speech', 'music', 'video']) {
    const t = $(`.tab[data-tab="${tabKey}"]`);
    if (!t) continue;
    // Lazily create the eta span the first time we need it.
    let eta = t.querySelector('.tab-eta');
    if (!eta) {
      eta = el('span', { class: 'tab-eta' }, '');
      t.appendChild(eta);
    }
    eta.textContent = _formatTabEta(tabKey);
  }
}
function _formatTabEta(tabKey) {
  const status = state.genStatus[tabKey];
  if (status !== 'running') return '';
  const start = state.genStartMs && state.genStartMs[tabKey];
  if (!start) return '...';
  // Use the running average if we have one; otherwise a sensible per-tab
  // default so the user always sees an estimate even on the very first
  // generation. (If they only see "...", the timer looks broken.)
  let total = (state.genAvgSec && state.genAvgSec[tabKey]) || 0;
  if (!total) {
    const defaults = { image: 35, speech: 12, music: 75, video: 90 };
    total = defaults[tabKey] || 30;
  }
  const elapsed = Math.max(0, (Date.now() - start) / 1000);
  const remaining = Math.max(0, Math.round(total - elapsed));
  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  return `- ${m}:${String(s).padStart(2, '0')}`;
}
// Update the ETA once a second while a tab is running. Cheap text update —
// the tab has only 4 instances.
let _etaTimer = null;
function ensureEtaTimer() {
  if (_etaTimer) return;
  _etaTimer = setInterval(() => {
    let anyRunning = false;
    for (const k of ['image', 'speech', 'music', 'video']) {
      if (state.genStatus[k] === 'running') { anyRunning = true; break; }
    }
    if (!anyRunning) {
      clearInterval(_etaTimer);
      _etaTimer = null;
      // Clear the ETA labels one last time.
      for (const k of ['image', 'speech', 'music', 'video']) {
        const t = $(`.tab[data-tab="${k}"]`);
        if (!t) continue;
        const eta = t.querySelector('.tab-eta');
        if (eta) eta.textContent = '';
      }
      return;
    }
    refreshTabEtas();
  }, 1000);
}

// ----------------- Style dropdown refresh -----------------
// Refresh every open style-preset dropdown so the new list of styles is
// immediately reflected after add/edit/delete — without requiring the user
// to switch tabs. Implemented as a class query so detached dropdowns
// (from rebuilt tabs) are automatically ignored.
function _refreshAllStyleDropdowns() {
  for (const sel of document.querySelectorAll('select.style-select')) {
    // Skip if the select is no longer in the document
    if (!sel.isConnected) continue;
    const cur = sel.value;
    sel.innerHTML = '';
    sel.appendChild(el('option', { value: '' }, '(no style)'));
    for (const s of (state.config.styles || [])) {
      const opt = el('option', { value: s.name }, s.name);
      if (s.value && s.value.length > 60) opt.title = s.value;
      sel.appendChild(opt);
    }
    // Try to preserve the current selection
    if (cur && (state.config.styles || []).some((s) => s.name === cur)) sel.value = cur;
  }
}

// ----------------- IMAGE TAB -----------------
TABS.image = {
  prefilled: 'a cyberpunk city night scene in 16:9',
  build() {
    const root = $('#tab-image');
    root.innerHTML = '';

    // Prompt
    const prompt = buildParamRow('Prompt (prefilled, editable)',
      { kind: 'textarea', value: this.prefilled, help: 'The description of the image to generate. Sent as --prompt. Max ~1500 chars (mmx image API limit).' });
    const styleRow = buildStyleRow('image', 'Select a style preset. Its value is prepended (with a comma) to your manual prompt before being sent to mmx.');
    const stylePreview = buildStylePreviewBlock();
    const tabState = { previewEl: stylePreview, selEl: styleRow.sel, manualEl: prompt.input };
    const updatePreview = () => updateStylePreview(tabState);
    styleRow.sel.addEventListener('change', updatePreview);
    prompt.input.addEventListener('input', updatePreview);
    updatePreview();
    // mmx image API hard limit is 1500 chars on --prompt; counter goes red above.
    const counter = buildPromptCounter({ selEl: styleRow.sel, manualEl: prompt.input, max: 1500, id: 'image' });
    root.appendChild(el('div', { class: 'section' }, [
      el('h3', {}, 'Prompt'),
      styleRow.row,
      prompt.row,
      stylePreview,
      counter.wrap,
    ]));

    // Parameters
    const model = buildParamRow('--model', {
      kind: 'enum', default: 'image-01',
      options: [
        { value: 'image-01', label: 'image-01 (default — general purpose)' },
        { value: 'image-01-live', label: 'image-01-live (hand-drawn, cartoon, style control)' },
      ],
      help: 'Image generation model.\n\nimage-01 (default):\n  • General-purpose text-to-image\n  • Aspect ratios: 1:1, 16:9, 9:16, 4:3, 3:4, 2:3, 3:2, 21:9\n  • Custom width/height: 512-2048 px (multiple of 8)\n  • --subject-ref, --prompt-optimizer, --aigc-watermark, --seed\n\nimage-01-live:\n  • Hand-drawn / cartoon / stylized outputs\n  • Finer style control\n  • Same flags as image-01',
    });
    const aspect = buildParamRow('--aspect-ratio', {
      kind: 'enum', default: '16:9',
      options: [
        { value: '', label: '(default)' },
        { value: '1:1', label: '1:1 — square' },
        { value: '16:9', label: '16:9 — widescreen' },
        { value: '9:16', label: '9:16 — portrait / phone' },
        { value: '4:3', label: '4:3 — classic' },
        { value: '3:4', label: '3:4 — portrait classic' },
        { value: '2:3', label: '2:3 — photo portrait' },
        { value: '3:2', label: '3:2 — photo landscape' },
        { value: '21:9', label: '21:9 — ultrawide / cinematic' },
      ],
      help: 'Output aspect ratio. Ignored if you set both --width and --height.',
    });
    const n = buildParamRow('--n (count)', {
      kind: 'number', default: 1, min: 1, max: 4, customDefault: 1, step: 1,
      options: [1, 2, 3, 4].map((v) => ({ value: v, label: String(v) })),
      help: 'How many images to generate in one call.',
    });
    const width = buildParamRow('--width (px)', {
      kind: 'number', default: '', min: 512, max: 2048, step: 8,
      options: [
        { value: '', label: '(unset)' },
        { value: 768, label: '768' },
        { value: 1024, label: '1024' },
        { value: 1280, label: '1280' },
        { value: 1536, label: '1536' },
        { value: 1792, label: '1792' },
        { value: 1920, label: '1920' },
        { value: 2048, label: '2048' },
      ],
      help: 'Pixel width (512–2048, multiple of 8). Overrides --aspect-ratio when paired with --height. image-01 only.',
    });
    const height = buildParamRow('--height (px)', {
      kind: 'number', default: '', min: 512, max: 2048, step: 8,
      options: [
        { value: '', label: '(unset)' },
        { value: 768, label: '768' },
        { value: 1024, label: '1024' },
        { value: 1280, label: '1280' },
        { value: 1536, label: '1536' },
        { value: 1792, label: '1792' },
        { value: 1080, label: '1080' },
        { value: 2048, label: '2048' },
      ],
      help: 'Pixel height (512–2048, multiple of 8). Overrides --aspect-ratio when paired with --width. image-01 only.',
    });
    const seed = buildParamRow('--seed', {
      kind: 'number', default: '', min: 0, max: 2_147_483_647, step: 1,
      options: [
        { value: '', label: 'Random' },
        { value: 0, label: '0' },
        { value: 1, label: '1' },
        { value: 42, label: '42' },
        { value: 12345, label: '12345' },
        { value: 1337, label: '1337' },
        { value: 9999, label: '9999' },
      ],
      help: 'Random seed for reproducible generation. Same seed + prompt = identical output.',
    });
    const promptOpt = buildParamRow('--prompt-optimizer', {
      kind: 'boolean', default: false, help: 'Let the model rewrite your prompt for better results.',
    });
    const watermark = buildParamRow('--aigc-watermark', {
      kind: 'boolean', default: false, help: 'Embed an AI-generated content watermark into the output image.',
    });
    const subjRef = buildParamRow('--subject-ref', {
      kind: 'text', default: '',
      placeholder: 'Path or URL to character image',
      fileFilters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
        { name: 'All files', extensions: ['*'] },
      ],
      browseTitle: 'Select character reference image',
      help: 'Character consistency reference.\nFormat passed to mmx: type=character,image=<value>\nYou can also paste a public URL (https://...).\nSupported formats: PNG, JPG, JPEG, WebP.',
    });
    const respFmt = buildParamRow('--response-format', {
      kind: 'enum', default: 'url',
      options: [
        { value: 'url', label: 'url (CDN, downloaded to disk)' },
        { value: 'base64', label: 'base64 (no CDN)' },
      ],
      help: 'How the image bytes come back. base64 bypasses the CDN.',
    });

    root.appendChild(el('div', { class: 'section' }, [
      el('h3', {}, 'Parameters'),
      buildFilePrefixRow(),
      el('div', { class: 'grid' }, [aspect.row, n.row, width.row, height.row, seed.row, respFmt.row, promptOpt.row, watermark.row, subjRef.row]),
      // Live validity warnings for the W × H combo and the subject
      // ref field. attachImageDimGuards wires the aspect/W/H
      // listeners (auto-fill on aspect change, ratio-mismatch
      // warning, div-by-8 warning) and returns the warning div
      // for the .section. attachSubjectRefGuard does the same for
      // the --subject-ref field (must be a path or http(s) URL
      // with a recognised image extension). Both are hidden when
      // the inputs are valid.
      attachImageDimGuards(aspect, width, height),
      attachSubjectRefGuard(subjRef),
    ]));

    // Action bar + preview
    const actions = el('div', { class: 'actions' });
    const genBtn = el('button', { class: 'primary' }, 'Generate');
    // Upscale checkbox: when on, every generated image is upscaled locally
    // after generation using the saved settings. Clicking the label
    // (or the box) opens the settings overlay.
    const upscaleCb = el('input', { type: 'checkbox', title: 'Upscale the generated image after creation' });
    const upscaleLabel = el('label', { class: 'upscale-checkbox', title: 'Click to configure upscale settings' });
    const upscaleMult = el('span', { class: 'upscale-mult' }, '');
    upscaleLabel.append(upscaleCb, '🔍 Upscale', upscaleMult);
    // Reflect persisted state
    if (state.upscaleEnabled) upscaleCb.checked = true;
    function refreshUpscaleCheckboxUI() {
      const m = (state.upscaleSettings && state.upscaleSettings.multiplier) || 2;
      upscaleMult.textContent = state.upscaleEnabled ? ` (${m}×)` : '';
      upscaleLabel.classList.toggle('active', !!state.upscaleEnabled);
    }
    refreshUpscaleCheckboxUI();
    upscaleLabel.addEventListener('click', (e) => {
      // Only open the settings overlay when the user clicks the label
      // text (not the input itself — clicking the input toggles it).
      if (e.target === upscaleCb) return; // let the input toggle
      e.preventDefault();
      showUpscaleSettings();
    });
    upscaleCb.addEventListener('change', async () => {
      state.upscaleEnabled = !!upscaleCb.checked;
      if (state.upscaleEnabled && !state.upscaleSettings) {
        state.upscaleSettings = { multiplier: 2 };
      }
      refreshUpscaleCheckboxUI();
      await scheduleStateSave();
    });
    const lastCmd = el('span', { class: 'lastcmd' }, '');
    const batchControls = el('span', { 'data-batch-controls': 'image', class: 'batch-controls' });
    // Variants dropdown (image tab: disabled when seed is set)
    const variants = buildVariantsRow({ id: 'variants-image', seedInput: seed });
    actions.append(buildAddToBatchBtn('image'), genBtn, upscaleLabel, variants.row, batchControls, lastCmd);
    const preview = el('div', { class: 'preview' }, el('div', { class: 'empty' }, 'No image generated yet.'));

    // Sticky footer: actions + preview stay visible while the rest of the
    // tab scrolls. CSS uses position: sticky on .tab-footer.
    const tabFooter = el('div', { class: 'tab-footer' }, [actions, preview]);
    root.appendChild(tabFooter);

    // ---- Generate handler ----
    genBtn.addEventListener('click', async () => {
      // Re-entrancy guard: another generation is in progress. The cancel
      // click handler (added by armGenBtnWithCancel) will run for clicks
      // that should cancel instead.
      if (state.generating) return;
      if (!state.config.api_key) { toast('No API key configured. Click ⚙ to open Settings.', 'err'); return; }
      const promptText = buildFinalPrompt(styleRow.sel, prompt.input);
      if (!promptText) { toast('Prompt is required (style or manual input).', 'warn'); return; }
      const variantsCount = Math.max(1, Math.min(5, parseInt(variants.sel.value, 10) || 1));
      const seedVal = seed.input.getValue();
      const seedLocked = String(seedVal) !== '' && variantsCount > 1;
      if (seedLocked) {
        // Defensive: shouldn't happen since the dropdown is disabled, but just in case
        toast('Variants are disabled while a fixed seed is set (would produce identical images).', 'warn');
        return;
      }
      let outDir;
      try { outDir = await ensureSubDir('image'); }
      catch (e) { toast('No output directory set. Open Settings.', 'err'); return; }
      const slug = slugify(promptText).slice(0, 60) || 'image';
      const cancel = armGenBtnWithCancel(genBtn, 'Generate');
      let allOk = true;
      let lastPreview = null;
      let lastOutFile = null;
      // lastFailedR captures the most recent failed mmxRun result so the
      // error UI (preview + toast) can surface its full details, including
      // the classified type and a copy-paste blob for support.
      let lastFailedR = null;
      let threw = null;
      // The mmx CLI rejects `--out` when `--n > 1` ("--out cannot be used with
      // --n > 1. Use --out-dir instead."). When the user requested multiple
      // images via the --n (count) dropdown, we omit --out and let mmx write
      // numbered files into outDir.
      const nRaw = n.input.getValue();
      const nCount = nRaw === '' || nRaw == null ? 1 : Math.max(1, parseInt(String(nRaw), 10) || 1);
      const useOutDir = nCount > 1;
      // Validate width/height pairing once (would otherwise warn on every variant).
      const wv0 = width.input.getValue();
      const hv0 = height.input.getValue();
      if ((wv0 && !hv0) || (!wv0 && hv0)) {
        toast('Width and height must both be set (or both unset). Width/height ignored.', 'warn');
      }
      // Build the argv once and reuse it across variant attempts — the prompt
      // and parameters don't change between retries.
      function buildImageArgs() {
        const args = ['image', 'generate'];
        args.push('--prompt', promptText);
        appendFlag(args, model.input);
        appendFlag(args, aspect.input);
        appendFlag(args, n.input);
        if (wv0 && hv0) { args.push('--width', String(wv0)); args.push('--height', String(hv0)); }
        if (String(seedVal) !== '') args.push('--seed', String(seedVal));
        appendBoolFlag(args, promptOpt.input, '--prompt-optimizer');
        appendBoolFlag(args, watermark.input, '--aigc-watermark');
        if (subjRef.input.value && subjRef.input.value.trim()) {
          args.push('--subject-ref', `type=character,image=${subjRef.input.value.trim()}`);
        }
        appendFlag(args, respFmt.input);
        if (useOutDir) {
          args.push('--out-dir', outDir);
        }
        return args;
      }
      // Returns the resolved outFile for this variant (or outDir when --out-dir).
      function makeOutPath(v) {
        if (useOutDir) return outDir;
        const ts = timestamp();
        const variantTag = variantsCount > 1 ? `_v${v}` : '';
        const prefix = (state.filePrefix || '').trim();
        return uniquePath(outDir, `${prefix}${ts}_${slug}${variantTag}.png`);
      }
      try {
        for (let v = 1; v <= variantsCount; v++) {
          if (cancel.wasCancelled()) break;
          // Small breather between variants to avoid hitting the mmx rate
          // limiter (especially right after a failed call).
          if (v > 1) await new Promise((r) => setTimeout(r, 800));
          if (cancel.wasCancelled()) break;

          // Build the per-variant argv. The base args are identical except
          // for --out, which gets a unique filename per variant.
          const baseArgs = buildImageArgs();
          const outFile = makeOutPath(v);
          const args = baseArgs.slice();
          if (!useOutDir) args.push('--out', outFile);
          lastCmd.textContent = `mmx ${args.join(' ')}`;

          const statusMsg = variantsCount > 1
            ? `Generating image… variant ${v}/${variantsCount}`
            : (useOutDir ? `Generating image… (${nCount} images to ${outDir})` : 'Generating image…');
          setStatus(statusMsg, true);
          preview.innerHTML = `<div class="empty"><span class="spinner"></span> ${escapeHtml(statusMsg)}</div>`;

          // Try the call, then retry up to 3 times with exponential backoff
          // on transient errors. The "API error: system error (HTTP 200)"
          // pattern we see in the field is almost always a backend hiccup
          // that succeeds on retry. We also detect rate-limit messages and
          // wait longer for those.
          let r = await window.api.mmxRun(args);
          if (!r.ok && !cancel.wasCancelled()) {
            const firstMsg = formatMmxError(r);
            const isRateLimit = /rate|limit|throttl|too many|429/i.test(firstMsg);
            const maxRetries = 3;
            for (let attempt = 1; attempt <= maxRetries && !cancel.wasCancelled(); attempt++) {
              // Exponential backoff: 1.5s, 3s, 6s (×2 if rate-limited)
              const baseDelay = 1500 * Math.pow(2, attempt - 1);
              const delay = isRateLimit ? baseDelay * 2 : baseDelay;
              await new Promise((res) => setTimeout(res, delay));
              if (cancel.wasCancelled()) break;
              setStatus(`Retrying image variant ${v}/${variantsCount} (attempt ${attempt + 1}/${maxRetries + 1})…`, true);
              preview.innerHTML = `<div class="empty"><span class="spinner"></span> ${escapeHtml(`Retrying variant ${v}/${variantsCount} (attempt ${attempt + 1})…`)}</div>`;
              r = await window.api.mmxRun(args);
              if (r.ok) {
                toast(`Image variant ${v}/${variantsCount} succeeded on retry ${attempt}.`, 'ok', 2500);
                break;
              }
            }
            if (!r.ok) toast(`Image variant ${v}/${variantsCount} failed after ${maxRetries + 1} attempts: ${firstMsg}`, 'err', 6000);
          }
          if (cancel.wasCancelled()) { allOk = false; break; }
          if (!r.ok) {
            // Mark this variant as failed but continue with the next one so
            // the user gets the remaining variants (e.g. 1, 2 OK, 3 failed,
            // 4, 5 still attempted). We also expose a "Retry" button so the
            // user can manually re-attempt this exact variant.
            allOk = false;
            lastFailedR = r;
            preview.innerHTML = `<div class="empty">Generation failed (variant ${v}/${variantsCount}). Continuing with next variant…</div><div class="meta">${escapeHtml(formatMmxError(r))}</div>`;
            continue;
          }
          lastPreview = r.parsed;
          lastOutFile = outFile;
        }
      } catch (e) {
        threw = e;
        allOk = false;
        console.error('Image generation threw:', e);
        toast('Generation error: ' + (e && e.message || String(e)), 'err', 6000);
      } finally {
        cancel.cleanup();
        setStatus('Ready', false);
        // Always refresh — even on cancel/failure, partial files may exist
        // on disk and the user should see them.
        try { await refreshBrowser(); } catch {}
        try { await refreshQuota(); } catch {}
      }
      if (threw) return;
      if (cancel.wasCancelled()) {
        preview.innerHTML = '<div class="empty">Generation cancelled.</div>';
        toast('Cancelled.', 'warn');
        return;
      }
      if (allOk && lastOutFile) {
        // If the Upscale checkbox is on, run the generated image through
        // the local upscaler after the mmx call returns. The preview then
        // shows the upscaled version, and the file browser gets the
        // new "<name>_Nx.png" file next to the original.
        let displayFile = lastOutFile;
        if (state.upscaleEnabled && state.upscaleSettings) {
          try {
            setStatus(`Upscaling ${state.upscaleSettings.multiplier}×…`, true);
            preview.innerHTML = `<div class="empty"><span class="spinner"></span> Upscaling ${state.upscaleSettings.multiplier}×…</div>`;
            displayFile = await upscaleImageFile(lastOutFile, state.upscaleSettings.multiplier);
            toast(`Upscaled to ${state.upscaleSettings.multiplier}× → ${displayFile}`, 'ok', 3000);
            // If auto-crop is also on, apply it now. The flow mirrors
            // showUpscaleDirect: load the upscaled file, compute the
            // crop frame at the chosen anchor, write the cropped file
            // and delete the intermediate.
            if (state.upscaleSettings.autoCrop) {
              const a = state.upscaleSettings;
              const upImg = await loadImageFromFile(displayFile);
              const uW = upImg.naturalWidth;
              const uH = upImg.naturalHeight;
              const wantW = a.cropWidth || uW;
              const wantH = a.cropHeight || uH;
              const w = Math.min(wantW, uW);
              const h = Math.min(wantH, uH);
              const maxX = uW - w;
              const maxY = uH - h;
              let x, y;
              if (a.cropAnchorX === 'left')        x = 0;
              else if (a.cropAnchorX === 'right') x = maxX;
              else                                x = Math.floor(maxX / 2);
              if (a.cropAnchorY === 'top')         y = 0;
              else if (a.cropAnchorY === 'bottom') y = maxY;
              else                                y = Math.floor(maxY / 2);
              setStatus(`Cropping to ${w} × ${h}…`, true);
              preview.innerHTML = `<div class="empty"><span class="spinner"></span> Cropping to ${w} × ${h}…</div>`;
              const cropped = await cropImageFile(displayFile, x, y, w, h);
              // Drop the intermediate (full-upscaled) file.
              window.api.fbDelete(displayFile).catch(() => {});
              displayFile = cropped;
              toast(`Upscaled ${state.upscaleSettings.multiplier}× and cropped to ${w} × ${h} → ${cropped}`, 'ok', 4000);
            }
            try { await refreshBrowser(); } catch (_) {}
          } catch (e) {
            console.error('Upscale failed:', e);
            toast('Upscale failed (kept original): ' + (e && e.message || e), 'warn', 4000);
            displayFile = lastOutFile;
          }
        }
        // The per-tab preview used to render a 400×400 thumbnail
        // here (showImagePreview). Per the user's request, the
        // generated image now lives in the right-side
        // folder-explorer's preview pane — the left-side area
        // only carries a short "Image ready, see preview on the
        // right" message so the layout doesn't collapse.
        preview.innerHTML = '';
        preview.appendChild(el('div', { class: 'empty' },
          el('div', { class: 'preview-ready-msg' }, [
            '✅ Image ready — ',
            el('strong', {}, 'preview on the right'),
            '. Click the filename in the file browser or ',
            el('strong', {}, 'the image in the preview pane'),
            ' to open at 1:1.',
          ]),
        ));
        try { previewImageFromFile(displayFile); } catch (_) {}
        bumpGenerationCounter('image', variantsCount);
      } else if (!allOk) {
        // Build a detailed, actionable error block. The user has been
        // hitting "API error: system error (HTTP 200)" which is opaque —
        // we now classify the error (auth, rate, quota, network, server,
        // unknown) and show targeted tips + buttons to diagnose / retry /
        // copy the raw error for support.
        const lastErrMsg = formatMmxError(lastFailedR || { stderr: '', stdout: '', code: -1 });
        const classification = classifyMmxError(lastFailedR || {}, lastErrMsg);
        const tips = {
          auth: [
            'Your API key may be invalid, expired, or revoked.',
            'Click "Test connection" below to verify.',
            'Re-paste your key in ⚙ Settings if needed.',
          ],
          rate: [
            'mmx is rate-limiting your account.',
            'Wait 30–60 seconds, then click Retry.',
            'Avoid running many batches back-to-back.',
          ],
          quota: [
            'Your Token Plan quota is exhausted for this model.',
            'Wait for the rolling window to reset, or upgrade your plan.',
            'Check the ⚡ quota display in the top bar.',
          ],
          network: [
            'Could not reach the mmx API (DNS / firewall / offline).',
            'Verify your internet connection and any VPN / proxy settings.',
            'Click "Diagnose" below to check the mmx installation.',
          ],
          server: [
            'mmx returned a server-side error. Usually transient.',
            'Wait a few seconds and click Retry.',
            'If it persists, the mmx service may be degraded — try again later.',
          ],
          unknown: [
            'mmx returned an unrecognised error.',
            'Click "Copy error" to share the details with support.',
            'Click "Diagnose" to verify the mmx installation.',
          ],
        };
        const tipList = tips[classification] || tips.unknown;
        preview.innerHTML = '';
        const wrap = el('div', { class: 'empty preview-error' });
        wrap.appendChild(el('div', { class: 'preview-error-title' }, '⚠ Generation failed'));
        const detail = el('div', { class: 'preview-error-message' });
        detail.textContent = lastErrMsg || 'Unknown error (see log pane for details).';
        wrap.appendChild(detail);
        // Classified troubleshooting tips
        const tipsBlock = el('div', { class: 'preview-error-tips' });
        for (const t of tipList) {
          const li = el('div', { class: 'preview-error-tip' }, '• ' + t);
          tipsBlock.appendChild(li);
        }
        wrap.appendChild(tipsBlock);
        // Action buttons: Retry / Test connection / Diagnose / Copy error
        const retryBtn = el('button', { class: 'primary' }, '🔄 Retry');
        const testBtn = el('button', { class: 'btn-mini' }, '🔑 Test connection');
        const diagBtn = el('button', { class: 'btn-mini' }, '🩺 Diagnose');
        const copyBtn = el('button', { class: 'btn-mini' }, '📋 Copy error');
        retryBtn.addEventListener('click', () => genBtn.click());
        testBtn.addEventListener('click', async () => {
          testBtn.disabled = true; testBtn.textContent = 'Testing…';
          const r = await window.api.authStatus();
          testBtn.disabled = false; testBtn.textContent = '🔑 Test connection';
          if (r.ok) {
            toast(r.message || 'API key is valid.', 'ok', 4000);
          } else {
            toast('Auth failed: ' + (r.error || 'unknown'), 'err', 6000);
          }
        });
        diagBtn.addEventListener('click', () => showDiagnose());
        copyBtn.addEventListener('click', async () => {
          const blob = JSON.stringify({
            classification,
            message: lastErrMsg,
            code: lastFailedR?.code,
            stderr: (lastFailedR?.stderr || '').slice(0, 4000),
            stdout: (lastFailedR?.stdout || '').slice(0, 4000),
            parsed: lastFailedR?.parsed,
            ts: new Date().toISOString(),
          }, null, 2);
          try {
            await navigator.clipboard.writeText(blob);
            toast('Error details copied to clipboard.', 'ok', 1500);
          } catch (_) {
            // Fallback: just toast the message
            toast('Clipboard unavailable — error: ' + lastErrMsg, 'warn', 6000);
          }
        });
        const actions = el('div', { class: 'preview-error-actions' }, [retryBtn, testBtn, diagBtn, copyBtn]);
        wrap.appendChild(actions);
        preview.appendChild(wrap);
        // Also surface a short toast
        const shortMsg = classification === 'auth'
          ? 'Auth failed. Click Test connection.'
          : classification === 'rate'
            ? 'Rate limited. Wait 30s and Retry.'
            : classification === 'quota'
              ? 'Quota exhausted.'
              : 'Generation failed. See preview for details.';
        toast(shortMsg, 'warn', 4000);
      }
      if (allOk) {
        toast(variantsCount > 1
          ? `Image generated. ${variantsCount} variants saved.`
          : 'Image generated.', 'ok');
      }
    });
  },
};

// ----------------- SPEECH TAB -----------------
TABS.speech = {
  prefilled: 'Welcome to MiniMax Token Plan',
  build() {
    const root = $('#tab-speech');
    root.innerHTML = '';

    const text = buildParamRow('Text to read (prefilled, editable)',
      { kind: 'textarea', value: this.prefilled, help: 'What the voice will say. Max 10 000 chars.' });
    const styleRow = buildStyleRow('speech', 'Select a style preset. Its value is prepended (with a comma) to your text before being sent to mmx. Useful for narration tone, language hints, etc.');
    const stylePreview = buildStylePreviewBlock();
    const tabState = { previewEl: stylePreview, selEl: styleRow.sel, manualEl: text.input };
    const update = () => updateStylePreview(tabState);
    styleRow.sel.addEventListener('change', update);
    text.input.addEventListener('input', update);
    update();
    // Speech API actually accepts up to 10 000 chars, but we still show the
    // same counter pattern so the user has a constant reference.
    const counter = buildPromptCounter({ selEl: styleRow.sel, manualEl: text.input, max: 10000, id: 'speech' });
    root.appendChild(el('div', { class: 'section' }, [
      el('h3', {}, 'Text'),
      styleRow.row,
      text.row,
      stylePreview,
      counter.wrap,
    ]));

    const model = buildParamRow('--model', {
      kind: 'enum', default: 'speech-2.8-hd',
      options: [
        { value: 'speech-2.8-hd', label: 'speech-2.8-hd (newest, best quality — default)' },
        { value: 'speech-2.8-turbo', label: 'speech-2.8-turbo (faster, lower latency)' },
        { value: 'speech-2.6-hd', label: 'speech-2.6-hd' },
        { value: 'speech-2.6-turbo', label: 'speech-2.6-turbo' },
        { value: 'speech-02-hd', label: 'speech-02-hd' },
        { value: 'speech-02-turbo', label: 'speech-02-turbo' },
        { value: 'speech-2.6', label: 'speech-2.6 (legacy)' },
        { value: 'speech-02', label: 'speech-02 (legacy)' },
      ],
      help: 'Text-to-speech model.\n\nspeech-2.8-hd (default): Newest, best audio quality, supports sound tags.\nspeech-2.8-turbo: Same quality tier but lower latency.\nspeech-2.6-hd / 2.6-turbo: Previous generation, still high quality.\nspeech-02-hd / 02-turbo: Older generation, 24 languages.\nLegacy 2.6 / 02: Use only if you hit issues with 2.8.\n\nAll models: up to 10 000 chars input, --speed / --volume / --pitch supported.',
    });
    const voice = buildParamRow('--voice', {
      kind: 'enum', default: 'English_expressive_narrator',
      options: [{ value: 'English_expressive_narrator', label: 'English_expressive_narrator (default)' }],
      help: 'Which voice speaks. 300+ voices available — list loaded from `mmx speech voices`.',
    });
    const speed = buildParamRow('--speed', {
      kind: 'number', default: 1.0, step: 0.05,
      options: [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0].map((v) => ({ value: v, label: String(v) })),
      help: 'Playback speed multiplier. 1.0 = normal.',
    });
    const volume = buildParamRow('--volume', {
      kind: 'number', default: 1, min: 0, max: 10, step: 1,
      options: [0, 1, 2, 3, 5, 7, 10].map((v) => ({ value: v, label: String(v) })),
      help: 'Volume level 0 (silent) – 10 (loudest).',
    });
    const pitch = buildParamRow('--pitch', {
      kind: 'number', default: 0, min: -12, max: 12, step: 1,
      options: [-12, -6, -3, 0, 3, 6, 12].map((v) => ({ value: v, label: String(v) })),
      help: 'Pitch shift in semitones. 0 = no change.',
    });
    const format = buildParamRow('--format', {
      kind: 'enum', default: 'mp3',
      options: [
        { value: 'mp3', label: 'mp3 (default)' },
        { value: 'wav', label: 'wav' },
        { value: 'pcm', label: 'pcm' },
        { value: 'flac', label: 'flac' },
        { value: 'opus', label: 'opus' },
        { value: 'pcmu_raw', label: 'pcmu_raw' },
        { value: 'pcmu_wav', label: 'pcmu_wav' },
      ],
      help: 'Output audio container.',
    });
    const sampleRate = buildParamRow('--sample-rate', {
      kind: 'number', default: 32000, step: 1000,
      options: [8000, 16000, 22050, 24000, 32000, 44100, 48000].map((v) => ({ value: v, label: String(v) })),
      help: 'Sample rate in Hz.',
    });
    const bitrate = buildParamRow('--bitrate', {
      kind: 'number', default: 128000, step: 1000,
      options: [32000, 64000, 96000, 128000, 192000, 256000, 320000].map((v) => ({ value: v, label: String(v) })),
      help: 'Bitrate in bits/second.',
    });
    const channels = buildParamRow('--channels', {
      kind: 'enum', default: 1,
      options: [{ value: 1, label: '1 (mono)' }, { value: 2, label: '2 (stereo)' }],
      help: 'Number of audio channels.',
    });
    const language = buildParamRow('--language (boost)', {
      kind: 'enum-text', default: '',
      options: [
        { value: '', label: '(none)' },
        { value: 'auto', label: 'auto' },
        { value: 'en', label: 'en' },
        { value: 'zh', label: 'zh' },
        { value: 'ja', label: 'ja' },
        { value: 'ko', label: 'ko' },
        { value: 'es', label: 'es' },
        { value: 'fr', label: 'fr' },
        { value: 'de', label: 'de' },
        { value: 'pt', label: 'pt' },
        { value: 'ru', label: 'ru' },
        { value: 'it', label: 'it' },
        { value: 'ar', label: 'ar' },
        { value: 'hi', label: 'hi' },
      ],
      help: 'Boost recognition for a specific language code (e.g. "en", "zh").',
    });
    const subtitles = buildParamRow('--subtitles', {
      kind: 'boolean', default: false, help: 'Also save an .srt subtitle file alongside the audio.',
    });
    const soundEffect = buildParamRow('--sound-effect', {
      kind: 'enum-text', default: '',
      options: [{ value: '', label: '(none)' }],
      help: 'Optional background sound effect (model-dependent).',
    });
    const pronunciation = buildParamRow('--pronunciation (repeatable)', {
      kind: 'text', default: '', help: 'Custom pronunciation rule in the form from=to. Add multiple via comma.',
    });

    root.appendChild(el('div', { class: 'section' }, [
      el('h3', {}, 'Parameters'),
      el('div', { class: 'grid' }, [
        model.row, voice.row,
        speed.row, volume.row,
        pitch.row, format.row,
        sampleRate.row, bitrate.row,
        channels.row, language.row,
        subtitles.row, soundEffect.row,
        pronunciation.row,
      ]),
    ]));

    const actions = el('div', { class: 'actions' });
    const genBtn = el('button', { class: 'primary' }, 'Generate');
    const lastCmd = el('span', { class: 'lastcmd' }, '');
    const batchControls = el('span', { 'data-batch-controls': 'speech', class: 'batch-controls' });
    // Variants dropdown (speech tab has no seed, so always enabled)
    const variants = buildVariantsRow({ id: 'variants-speech' });
    actions.append(buildAddToBatchBtn('speech'), genBtn, variants.row, batchControls, lastCmd);
    const preview = el('div', { class: 'preview' }, el('div', { class: 'empty' }, 'No audio generated yet.'));
    const tabFooter = el('div', { class: 'tab-footer' }, [actions, preview]);
    root.appendChild(tabFooter);

    // Populate voices list
    this.populateVoices(voice.input).catch(() => {});

    genBtn.addEventListener('click', async () => {
      // Re-entrancy guard: another generation is in progress.
      if (state.generating) return;
      if (!state.config.api_key) { toast('No API key configured. Click ⚙ to open Settings.', 'err'); return; }
      const txt = text.input.value.trim();
      if (!txt) { toast('Text is required.', 'warn'); return; }
      const variantsCount = Math.max(1, Math.min(5, parseInt(variants.sel.value, 10) || 1));
      let outDir;
      try { outDir = await ensureSubDir('speech'); }
      catch (e) { toast('No output directory set. Open Settings.', 'err'); return; }
      const slug = slugify(txt).slice(0, 60) || 'speech';
      const ext = (format.input.value || 'mp3').split('_')[0];
      const cancel = armGenBtnWithCancel(genBtn, 'Generate');
      let allOk = true;
      let lastPreview = null;
      let lastOutFile = null;
      let threw = null;
      try {
        for (let v = 1; v <= variantsCount; v++) {
          if (cancel.wasCancelled()) break;
          const args = ['speech', 'synthesize'];
          args.push('--text', txt);
          appendFlag(args, model.input);
          appendFlag(args, voice.input);
          appendFlag(args, speed.input);
          appendFlag(args, volume.input);
          appendFlag(args, pitch.input);
          appendFlag(args, format.input);
          appendFlag(args, sampleRate.input);
          appendFlag(args, bitrate.input);
          appendFlag(args, channels.input);
          if (language.input.getValue()) args.push('--language', String(language.input.getValue()));
          appendBoolFlag(args, subtitles.input, '--subtitles');
          if (soundEffect.input.getValue()) args.push('--sound-effect', String(soundEffect.input.getValue()));
          if (pronunciation.input.value && pronunciation.input.value.trim()) {
            for (const rule of pronunciation.input.value.split(',').map(s => s.trim()).filter(Boolean)) {
              args.push('--pronunciation', rule);
            }
          }
          const ts = timestamp();
          const variantTag = variantsCount > 1 ? `_v${v}` : '';
          const prefix = (state.filePrefix || '').trim();
          const outFile = uniquePath(outDir, `${prefix}${ts}_${slug}${variantTag}.${ext}`);
          args.push('--out', outFile);
          lastCmd.textContent = `mmx ${args.join(' ')}`;
          const statusMsg = variantsCount > 1
            ? `Generating speech… variant ${v}/${variantsCount}`
            : 'Generating speech…';
          setStatus(statusMsg, true);
          preview.innerHTML = `<div class="empty"><span class="spinner"></span> ${escapeHtml(statusMsg)}</div>`;
          const r = await window.api.mmxRun(args);
          if (cancel.wasCancelled()) { allOk = false; break; }
          if (!r.ok) {
            const msg = formatMmxError(r);
            preview.innerHTML = `<div class="empty">Generation failed (variant ${v}/${variantsCount}).</div><div class="meta">${escapeHtml(msg)}</div>`;
            toast('Speech generation failed: ' + msg, 'err', 6000);
            allOk = false;
            break;
          }
          lastPreview = r.parsed;
          lastOutFile = outFile;
        }
      } catch (e) {
        threw = e;
        allOk = false;
        console.error('Speech generation threw:', e);
        toast('Generation error: ' + (e && e.message || String(e)), 'err', 6000);
      } finally {
        cancel.cleanup();
        setStatus('Ready', false);
        try { await refreshBrowser(); } catch {}
        try { await refreshQuota(); } catch {}
      }
      if (threw) return;
      if (cancel.wasCancelled()) {
        preview.innerHTML = '<div class="empty">Generation cancelled.</div>';
        toast('Cancelled.', 'warn');
        return;
      }
      if (allOk && lastOutFile) {
        showAudioPreview(preview, lastOutFile, lastPreview);
        bumpGenerationCounter('speech', variantsCount);
      }
      if (allOk) {
        toast(variantsCount > 1
          ? `Speech generated. ${variantsCount} variants saved.`
          : 'Speech generated.', 'ok');
      }
    });
  },
  async populateVoices(sel) {
    if (state.voicesLoaded) { fillVoices(sel, state.voices); return; }
    const v = await window.api.voices();
    if (Array.isArray(v) && v.length) {
      state.voices = v; state.voicesLoaded = true;
      fillVoices(sel, v);
    }
  },
};

function fillVoices(sel, voices) {
  const current = sel.value;
  sel.innerHTML = '';
  for (const v of voices) sel.appendChild(el('option', { value: v }, v));
  if (voices.includes(current)) sel.value = current;
}

// ----------------- MUSIC TAB -----------------
TABS.music = {
  prefilled: 'calm piano melody, 15 seconds',
  build() {
    const root = $('#tab-music');
    root.innerHTML = '';

    const prompt = buildParamRow('Music prompt (prefilled, editable)',
      { kind: 'textarea', value: this.prefilled, help: 'Style/genre/mood description. Set length here (e.g. "30 seconds", "2 minutes"). Max 5 min. Max 2000 chars combined with structured flags.' });
    const styleRow = buildStyleRow('music', 'Select a style preset. Its value is prepended (with a comma) to your music prompt before being sent to mmx. Use it for repeated genre/mood tags.');
    const stylePreview = buildStylePreviewBlock();
    const tabState = { previewEl: stylePreview, selEl: styleRow.sel, manualEl: prompt.input };
    // extraPrefix is filled in AFTER the vocal-mode `mode` row is defined below.
    let extraPrefix = () => '';
    const updatePreview = () => updateStylePreview(tabState, extraPrefix());
    styleRow.sel.addEventListener('change', updatePreview);
    prompt.input.addEventListener('input', updatePreview);
    updatePreview();
    // Character counter for the --prompt argument value.
    // NOTE: extraPrefix is a `let` that gets REASSIGNED below (after `mode`
    // and `instrumental` are defined). Passing it directly would freeze the
    // counter to the initial empty function. Wrap it so the counter always
    // reads the current extraPrefix value.
    const counter = buildPromptCounter({
      selEl: styleRow.sel,
      manualEl: prompt.input,
      getExtraPrefix: () => extraPrefix(),
      id: 'music',
    });
    // Placeholder for the mode listener, attached after `mode` is built below.
    root.appendChild(el('div', { class: 'section' }, [
      el('h3', {}, 'Prompt'),
      styleRow.row,
      prompt.row,
      stylePreview,
      counter.wrap,
    ]));

    // === Prominent Instrumental toggle (the most common music request) ===
    // The user-facing "make this song voice-less" button. ON sets the vocal
    // mode to "instrumental" and prepends a strong no-vocals clause to the
    // prompt, which the music-2.6 model honors more reliably than
    // `--instrumental` alone (per MiniMax docs).
    const instrumental = buildParamRow('🎵 Instrumental mode (voice-less)', {
      kind: 'boolean',
      default: false,
      help: 'Generate a voice-less / instrumental track. ON sets the vocal mode to "instrumental" AND auto-prepends "no vocals, no lyrics, no human voice," to the prompt — the model-2.6 API ignores --instrumental without this hint. Requires music-2.5+ or music-2.6.',
    });
    // Banner that appears under the toggle when ON
    const instrBanner = el('div', { class: 'info-banner instrumental-banner', style: 'display:none;' });
    instrBanner.appendChild(el('div', { class: 'info-banner-title' }, '🎵 Instrumental mode active'));
    instrBanner.appendChild(el('div', {}, [
      'Lyrics will be ignored and ',
      el('strong', {}, '"no vocals, no lyrics, no human voice, "'),
      ' will be prepended to the prompt.',
    ]));

    // Mode
    const mode = buildParamRow('Vocal mode', {
      kind: 'enum', default: 'lyrics-optimizer',
      options: [
        { value: 'lyrics-optimizer', label: 'Auto-generate lyrics from prompt' },
        { value: 'lyrics', label: 'Use my custom lyrics' },
        { value: 'instrumental', label: 'Instrumental (no vocals)' },
      ],
      help: 'How vocals/lyrics are handled. (Auto-overridden when "Instrumental mode" is ON above.)',
    });
    // When vocal mode is "instrumental", the model still tends to add vocals unless
    // the prompt explicitly forbids them. We auto-prepend a strong no-vocals clause.
    // (Bound here so `mode` is in scope.)
    const INSTRUMENTAL_PREFIX = 'no vocals, no lyrics, no human voice, ';
    extraPrefix = () => (mode.input.value === 'instrumental' || instrumental.input.value === 'on')
      ? INSTRUMENTAL_PREFIX : '';
    const onInstrumentalChange = () => {
      // If the toggle is ON, force the mode to instrumental
      if (instrumental.input.value === 'on') {
        mode.input.value = 'instrumental';
        mode.input.disabled = true;
        mode.row.classList.add('locked-by-instrumental');
      } else {
        mode.input.disabled = false;
        mode.row.classList.remove('locked-by-instrumental');
        if (mode.input.value === 'instrumental') mode.input.value = 'lyrics-optimizer';
      }
      instrBanner.style.display = instrumental.input.value === 'on' ? '' : 'none';
      counter.update();
      updatePreview();
    };
    instrumental.input.addEventListener('change', onInstrumentalChange);
    mode.input.addEventListener('change', () => { counter.update(); updatePreview(); });
    // Re-render once now that the prefix logic is in place
    updatePreview();
    counter.update();
    const lyrics = buildParamRow('Custom lyrics', {
      kind: 'textarea', value: '', help: 'Used when "Use my custom lyrics" is selected. Supports structure tags: [Verse], [Chorus], [Bridge], [Intro], [Outro], [Pre Chorus], [Interlude], [Post Chorus], [Transition], [Break], [Hook], [Build Up], [Inst], [Solo]. Max 3500 chars.\nNote: only music-2.5+ and music-2.6 reliably support --lyrics. If the output ignores the lyrics, switch the model in the dropdown below.',
    });
    const lyricsFile = buildParamRow('Lyrics file path (alt)', {
      kind: 'text', default: '',
      placeholder: 'Path to .txt file with lyrics',
      fileFilters: [
        { name: 'Text files', extensions: ['txt', 'md', 'lrc'] },
        { name: 'All files', extensions: ['*'] },
      ],
      browseTitle: 'Select lyrics text file',
      help: 'Read lyrics from a text file instead of pasting them.\nFormat: structure tags ([Verse], [Chorus], [Bridge], etc.) + free text.\nMax 3500 chars per song.\nNote: only music-2.5+ and music-2.6 reliably support --lyrics. If the\noutput ignores the lyrics, switch the model in the dropdown above.',
    });
    // Lyrics-mode info banner (shown only when mode === 'lyrics')
    const lyricsModeBanner = el('div', { class: 'info-banner', style: 'display:none;' });
    lyricsModeBanner.appendChild(el('div', { class: 'info-banner-title' }, '🎤 Custom Lyrics mode'));
    const bannerBody = el('div', {});
    const bannerText = document.createTextNode('Fill the textarea above (or use a .txt file). Ensure --model is set to ');
    bannerBody.appendChild(bannerText);
    const m1 = el('strong', {}, 'music-2.6');
    bannerBody.appendChild(m1);
    bannerBody.appendChild(document.createTextNode(' or '));
    const m2 = el('strong', {}, 'music-2.5+');
    bannerBody.appendChild(m2);
    bannerBody.appendChild(document.createTextNode('. music-2.0 ignores --lyrics. Max 3500 chars; structure tags like '));
    bannerBody.appendChild(el('code', {}, '[Verse]'));
    bannerBody.appendChild(document.createTextNode(', '));
    bannerBody.appendChild(el('code', {}, '[Chorus]'));
    bannerBody.appendChild(document.createTextNode(', '));
    bannerBody.appendChild(el('code', {}, '[Bridge]'));
    bannerBody.appendChild(document.createTextNode(' are supported.'));
    lyricsModeBanner.appendChild(bannerBody);
    function updateLyricsBanner() {
      const isLyrics = mode.input.value === 'lyrics';
      lyricsModeBanner.style.display = isLyrics ? '' : 'none';
      // Hide lyrics + lyricsFile when mode is not 'lyrics' (they'd be ignored otherwise)
      lyrics.row.style.display = isLyrics ? '' : 'none';
      lyricsFile.row.style.display = isLyrics ? '' : 'none';
    }
    mode.input.addEventListener('change', updateLyricsBanner);
    updateLyricsBanner();

    // Prominent "Instrumental" section — visible right after the Prompt
    // section so the user can immediately see the voice-less option.
    const instrumentalSection = el('div', { class: 'section instrumental-section' }, [
      el('h3', {}, '🎵 Instrumental (voice-less)'),
      instrumental.row,
      instrBanner,
    ]);
    root.appendChild(instrumentalSection);

    // Vocals & Lyrics section (with the lyrics-mode banner inside)
    const lyricsSection = el('div', { class: 'section' }, [
      el('h3', {}, 'Vocals & Lyrics'),
      mode.row,
      lyrics.row,
      lyricsFile.row,
      lyricsModeBanner,
    ]);
    root.appendChild(lyricsSection);
    const model = buildParamRow('--model', {
      kind: 'enum', default: 'music-2.6',
      options: [
        { value: 'music-2.6', label: 'music-2.6 (newest — cover, instrumental, lyrics-optimizer, default)' },
        { value: 'music-2.5+', label: 'music-2.5+ (instrumental unlocked, richer arrangements)' },
        { value: 'music-2.5', label: 'music-2.5 (paragraph-level precision, 14+ structure tags)' },
        { value: 'music-2.0', label: 'music-2.0 (legacy)' },
      ],
      help: 'Music generation model.\n\nmusic-2.6 (default): Newest. Supports --lyrics-optimizer, --instrumental,\n  --lyrics, --cover. Best for full-length songs with vocals.\n\nmusic-2.5+: Instrumental mode unlocked natively, richer multi-instrument\n  arrangements. Use when music-2.6 instrumental sounds too thin.\n\nmusic-2.5: 14+ structure tags with paragraph-level precision. Good\n  when you need fine-grained control over song structure.\n\nmusic-2.0: Legacy. May not support --lyrics or --instrumental.',
    });
    const genre = buildParamRow('--genre', {
      kind: 'enum-text', default: '',
      options: [
        { value: '', label: '(any)' },
        { value: 'pop', label: 'pop' },
        { value: 'rock', label: 'rock' },
        { value: 'jazz', label: 'jazz' },
        { value: 'classical', label: 'classical' },
        { value: 'hip-hop', label: 'hip-hop' },
        { value: 'electronic', label: 'electronic' },
        { value: 'folk', label: 'folk' },
        { value: 'cinematic', label: 'cinematic' },
        { value: 'lo-fi', label: 'lo-fi' },
        { value: 'ambient', label: 'ambient' },
        { value: 'country', label: 'country' },
        { value: 'r&b', label: 'r&b' },
        { value: 'metal', label: 'metal' },
        { value: 'indie', label: 'indie' },
      ],
      help: 'Music genre tag. Free-text fallback if you pick "Custom…".',
    });
    const mood = buildParamRow('--mood', {
      kind: 'enum-text', default: '',
      options: [
        { value: '', label: '(any)' },
        { value: 'happy', label: 'happy' },
        { value: 'sad', label: 'sad' },
        { value: 'energetic', label: 'energetic' },
        { value: 'calm', label: 'calm' },
        { value: 'melancholic', label: 'melancholic' },
        { value: 'aggressive', label: 'aggressive' },
        { value: 'romantic', label: 'romantic' },
        { value: 'dark', label: 'dark' },
        { value: 'uplifting', label: 'uplifting' },
        { value: 'dreamy', label: 'dreamy' },
      ],
      help: 'Mood or emotion. Free-text fallback if you pick "Custom…".',
    });
    const vocals = buildParamRow('--vocals', {
      kind: 'enum-text', default: '',
      options: [
        { value: '', label: '(any)' },
        { value: 'warm male baritone', label: 'warm male baritone' },
        { value: 'bright female soprano', label: 'bright female soprano' },
        { value: 'duet with harmonies', label: 'duet with harmonies' },
        { value: 'choir', label: 'choir' },
      ],
      help: 'Vocal style descriptor. Free-text fallback if you pick "Custom…".',
    });
    const instruments = buildParamRow('--instruments', {
      kind: 'enum-text', default: '',
      options: [
        { value: '', label: '(any)' },
        { value: 'piano', label: 'piano' },
        { value: 'acoustic guitar', label: 'acoustic guitar' },
        { value: 'electric guitar', label: 'electric guitar' },
        { value: 'drums', label: 'drums' },
        { value: 'strings', label: 'strings' },
        { value: 'synth', label: 'synth' },
        { value: 'orchestral', label: 'orchestral' },
      ],
      help: 'Featured instruments. Free-text fallback if you pick "Custom…".',
    });
    const bpm = buildParamRow('--bpm', {
      kind: 'number', default: '', min: 40, max: 220, step: 1,
      options: [
        { value: '', label: '(unset)' },
        { value: 60, label: '60' }, { value: 80, label: '80' }, { value: 90, label: '90' },
        { value: 100, label: '100' }, { value: 110, label: '110' }, { value: 120, label: '120' },
        { value: 128, label: '128' }, { value: 140, label: '140' }, { value: 160, label: '160' },
      ],
      help: 'Exact tempo in BPM.',
    });
    const key = buildParamRow('--key', {
      kind: 'enum-text', default: '',
      options: [
        { value: '', label: '(any)' },
        { value: 'C major', label: 'C major' },
        { value: 'C minor', label: 'C minor' },
        { value: 'D major', label: 'D major' },
        { value: 'D minor', label: 'D minor' },
        { value: 'E major', label: 'E major' },
        { value: 'E minor', label: 'E minor' },
        { value: 'F major', label: 'F major' },
        { value: 'F minor', label: 'F minor' },
        { value: 'G major', label: 'G major' },
        { value: 'G minor', label: 'G minor' },
        { value: 'A major', label: 'A major' },
        { value: 'A minor', label: 'A minor' },
        { value: 'B major', label: 'B major' },
      ],
      help: 'Musical key. Free-text fallback if you pick "Custom…".',
    });
    const tempo = buildParamRow('--tempo', {
      kind: 'enum-text', default: '',
      options: [
        { value: '', label: '(any)' },
        { value: 'slow', label: 'slow' },
        { value: 'moderate', label: 'moderate' },
        { value: 'fast', label: 'fast' },
      ],
      help: 'Coarse tempo hint.',
    });
    const structure = buildParamRow('--structure', {
      kind: 'enum-text', default: '',
      options: [
        { value: '', label: '(any)' },
        { value: 'verse-chorus-verse-chorus', label: 'verse-chorus-verse-chorus' },
        { value: 'verse-chorus-bridge-chorus', label: 'verse-chorus-bridge-chorus' },
        { value: 'intro-verse-chorus', label: 'intro-verse-chorus' },
      ],
      help: 'Song structure description.',
    });
    const references = buildParamRow('--references', {
      kind: 'text', default: '', help: 'Reference tracks or artists, e.g. "similar to Ed Sheeran".',
    });
    const avoid = buildParamRow('--avoid', {
      kind: 'text', default: '', help: 'Elements to avoid in the generated music.',
    });
    const useCase = buildParamRow('--use-case', {
      kind: 'enum-text', default: '',
      options: [
        { value: '', label: '(any)' },
        { value: 'background music for video', label: 'background music for video' },
        { value: 'theme song', label: 'theme song' },
        { value: 'jingle', label: 'jingle' },
        { value: 'podcast intro', label: 'podcast intro' },
      ],
      help: 'Use case context.',
    });
    const extra = buildParamRow('--extra', {
      kind: 'text', default: '', help: 'Additional fine-grained requirements not covered above.',
    });
    const audioFormat = buildParamRow('--format', {
      kind: 'enum', default: 'mp3',
      options: [
        { value: 'mp3', label: 'mp3 (default)' },
        { value: 'wav', label: 'wav' },
        { value: 'pcm', label: 'pcm' },
      ],
      help: 'Output audio container.',
    });
    const sampleRate = buildParamRow('--sample-rate', {
      kind: 'number', default: 44100, step: 1000,
      options: [22050, 32000, 44100, 48000].map((v) => ({ value: v, label: String(v) })),
      help: 'Sample rate in Hz.',
    });
    const bitrate = buildParamRow('--bitrate', {
      kind: 'number', default: 256000, step: 1000,
      options: [128000, 192000, 256000, 320000].map((v) => ({ value: v, label: String(v) })),
      help: 'Bitrate in bits/second.',
    });
    const watermark = buildParamRow('--aigc-watermark', {
      kind: 'boolean', default: false, help: 'Embed an AI-generated content watermark in the audio.',
    });
    const outputFormat = buildParamRow('--output-format', {
      kind: 'enum', default: 'hex',
      options: [
        { value: 'hex', label: 'hex (default, saved to file)' },
        { value: 'url', label: 'url (24h expiry — download promptly)' },
      ],
      help: 'How audio bytes come back. hex is saved directly; url requires separate download.',
    });

    root.appendChild(el('div', { class: 'section' }, [
      el('h3', {}, 'Parameters'),
      buildFilePrefixRow(),
      el('div', { class: 'grid' }, [
        mode.row, model.row,
        lyrics.row, lyricsFile.row,
        genre.row, mood.row,
        vocals.row, instruments.row,
        bpm.row, key.row,
        tempo.row, structure.row,
        references.row, avoid.row,
        useCase.row, extra.row,
        audioFormat.row, sampleRate.row,
        bitrate.row, watermark.row,
        outputFormat.row,
      ]),
    ]));

    const actions = el('div', { class: 'actions' });
    const genBtn = el('button', { class: 'primary' }, 'Generate');
    const lastCmd = el('span', { class: 'lastcmd' }, '');
    const batchControls = el('span', { 'data-batch-controls': 'music', class: 'batch-controls' });
    // Variants dropdown (music tab has no seed, so always enabled)
    const variants = buildVariantsRow({ id: 'variants-music' });
    actions.append(buildAddToBatchBtn('music'), genBtn, variants.row, batchControls, lastCmd);
    const preview = el('div', { class: 'preview' }, el('div', { class: 'empty' }, 'No audio generated yet.'));
    const tabFooter = el('div', { class: 'tab-footer' }, [actions, preview]);
    root.appendChild(tabFooter);

    genBtn.addEventListener('click', async () => {
      // Re-entrancy guard: another generation is in progress.
      if (state.generating) return;
      if (!state.config.api_key) { toast('No API key configured. Click ⚙ to open Settings.', 'err'); return; }
      const promptText = buildFinalPrompt(styleRow.sel, prompt.input, extraPrefix());
      if (!promptText) { toast('Prompt is required (style or manual input).', 'warn'); return; }
      // Validate lyrics-mode input once, before looping variants
      if (mode.input.value === 'lyrics') {
        if (!lyricsFile.input.value.trim() && !lyrics.input.value.trim()) {
          toast('Custom lyrics mode selected but no lyrics provided.', 'warn');
          return;
        }
      }

      const variantsCount = Math.max(1, Math.min(5, parseInt(variants.sel.value, 10) || 1));
      let outDir;
      try { outDir = await ensureSubDir('music'); }
      catch (e) { toast('No output directory set. Open Settings.', 'err'); return; }
      const slug = slugify(promptText).slice(0, 60) || 'music';
      const ext = (audioFormat.input.value || 'mp3');
      const cancel = armGenBtnWithCancel(genBtn, 'Generate');
      let allOk = true;
      let lastPreview = null;
      let lastOutFile = null;
      let threw = null;
      try {
        for (let v = 1; v <= variantsCount; v++) {
          if (cancel.wasCancelled()) break;
          const args = ['music', 'generate'];
          args.push('--prompt', promptText);
          // Mode
          if (mode.input.value === 'lyrics-optimizer') args.push('--lyrics-optimizer');
          else if (mode.input.value === 'instrumental') args.push('--instrumental');
          else if (mode.input.value === 'lyrics') {
            if (lyricsFile.input.value.trim()) args.push('--lyrics-file', lyricsFile.input.value.trim());
            else if (lyrics.input.value.trim()) args.push('--lyrics', lyrics.input.value.trim());
          }
          appendFlag(args, model.input);
          appendFlag(args, genre.input);
          appendFlag(args, mood.input);
          appendFlag(args, vocals.input);
          appendFlag(args, instruments.input);
          if (bpm.input.getValue() !== '') args.push('--bpm', String(bpm.input.getValue()));
          appendFlag(args, key.input);
          appendFlag(args, tempo.input);
          appendFlag(args, structure.input);
          if (references.input.value.trim()) args.push('--references', references.input.value.trim());
          if (avoid.input.value.trim()) args.push('--avoid', avoid.input.value.trim());
          appendFlag(args, useCase.input);
          if (extra.input.value.trim()) args.push('--extra', extra.input.value.trim());
          appendFlag(args, audioFormat.input);
          appendFlag(args, sampleRate.input);
          appendFlag(args, bitrate.input);
          appendBoolFlag(args, watermark.input, '--aigc-watermark');
          if (outputFormat.input.value && outputFormat.input.value !== 'hex') {
            args.push('--output-format', outputFormat.input.value);
          }
          // Unique output file per variant
          const ts = timestamp();
          const variantTag = variantsCount > 1 ? `_v${v}` : '';
          const outFile = uniquePath(outDir, `${ts}_${slug}${variantTag}.${ext}`);
          args.push('--out', outFile);
          lastCmd.textContent = `mmx ${args.join(' ')}`;
          const statusMsg = variantsCount > 1
            ? `Generating music… variant ${v}/${variantsCount} (may take 30s–2min each)`
            : 'Generating music… (may take 30s–2min)';
          setStatus(statusMsg, true);
          preview.innerHTML = `<div class="empty"><span class="spinner"></span> ${escapeHtml(statusMsg)}</div>`;
          const r = await window.api.mmxRun(args);
          if (cancel.wasCancelled()) { allOk = false; break; }
          if (!r.ok) {
            const msg = formatMmxError(r);
            preview.innerHTML = `<div class="empty">Generation failed (variant ${v}/${variantsCount}).</div><div class="meta">${escapeHtml(msg)}</div>`;
            toast(`Music generation failed: ${msg}`, 'err', 6000);
            allOk = false;
            break;
          }
          lastPreview = r.parsed;
          lastOutFile = outFile;
        }
      } catch (e) {
        threw = e;
        allOk = false;
        console.error('Music generation threw:', e);
        toast('Generation error: ' + (e && e.message || String(e)), 'err', 6000);
      } finally {
        cancel.cleanup();
        setStatus('Ready', false);
        try { await refreshBrowser(); } catch {}
        try { await refreshQuota(); } catch {}
      }
      if (threw) return;
      if (cancel.wasCancelled()) {
        preview.innerHTML = '<div class="empty">Generation cancelled.</div>';
        toast('Cancelled.', 'warn');
        return;
      }
      if (allOk && lastOutFile) {
        showAudioPreview(preview, lastOutFile, lastPreview);
        bumpGenerationCounter('music', variantsCount);
      }
      if (allOk) {
        toast(variantsCount > 1
          ? `Music generated. ${variantsCount} variants saved.`
          : 'Music generated.', 'ok');
      }
    });
  },
};

// ----------------- Previews -----------------
// Build a file:// URL that works in the renderer. The path may contain
// characters that are special in a URL (#, ?, %, &) — these MUST be percent-
// encoded or the file fails to load (e.g. a folder named "v2 #3" would
// otherwise have the "#3" parsed as a fragment).
function fileUrl(p) {
  if (!p) return '';
  // Use encodeURI on the path part so / and : survive while #, ?, etc. are escaped.
  // Forward slashes inside the path are valid URL characters and need no encoding.
  let normalized = p.replace(/\\/g, '/');
  // encodeURI keeps / and : intact, encodes everything else. Perfect for file paths.
  return 'file:///' + encodeURI(normalized);
}

function showImagePreview(rootEl, file, parsed) {
  // Use file:// to let the renderer display the local file.
  // We add a cache-busting query string in case the same path is regenerated.
  // The preview now renders a 400×400 thumbnail instead of the full image
  // (the preview pane was locking the screen when the generation produced
  // a large image). Clicking the thumbnail opens the image overlay at
  // 1:1 pixel mode with a zoom dropdown.
  const url = fileUrl(file) + '?t=' + Date.now();
  const filename = (file || '').split(/[\\/]/).pop() || 'image';
  const preLoad = new Image();
  preLoad.onload = () => {
    rootEl.innerHTML = '';
    const thumb = el('img', {
      src: url,
      alt: filename,
      class: 'preview-thumb',
      title: `${preLoad.naturalWidth}×${preLoad.naturalHeight} — click to view full size`,
    });
    thumb.addEventListener('click', () => {
      openImageOverlay(url, filename, preLoad.naturalWidth, preLoad.naturalHeight);
    });
    rootEl.appendChild(thumb);
    const meta = el('div', { class: 'meta' });
    meta.appendChild(document.createTextNode(file));
    meta.appendChild(el('div', { class: 'preview-thumb-size' },
      `${preLoad.naturalWidth}×${preLoad.naturalHeight} — click for 1:1 view`));
    if (parsed) meta.appendChild(el('div', {}, '[mmx] ' + safeStringify(parsed)));
    rootEl.appendChild(meta);
  };
  preLoad.onerror = () => {
    // Fallback when pre-loading fails (e.g. file still being written to disk).
    rootEl.innerHTML = '';
    const thumb = el('img', { src: url, alt: filename, class: 'preview-thumb' });
    thumb.addEventListener('click', () => openImageOverlay(url, filename));
    rootEl.appendChild(thumb);
    const meta = el('div', { class: 'meta' }, file);
    rootEl.appendChild(meta);
  };
  preLoad.src = url;
}

function showAudioPreview(rootEl, file, parsed) {
  const url = fileUrl(file) + '?t=' + Date.now();
  rootEl.innerHTML = '';
  const audio = el('audio', { controls: '', src: url });
  rootEl.appendChild(audio);
  const meta = el('div', { class: 'meta' });
  meta.appendChild(document.createTextNode(file));
  if (parsed) meta.appendChild(el('div', {}, '[mmx] ' + safeStringify(parsed)));
  rootEl.appendChild(meta);
}

// Open the image overlay: a full-screen modal showing the image at
// 1:1 pixel mode by default, with a zoom dropdown (75% / 50% / 25% /
// Fit-to-window). Used by both the generation preview thumbnail and the
// file-browser preview pane.
function openImageOverlay(src, filename, naturalWidth, naturalHeight) {
  // Remove any existing overlay so we never stack them.
  const existing = document.getElementById('image-overlay');
  if (existing) existing.remove();
  const overlay = el('div', { class: 'image-overlay', id: 'image-overlay' });
  // Header
  const fname = el('span', { class: 'image-overlay-filename', title: filename || '' }, filename || '');
  const size = el('span', { class: 'image-overlay-size' },
    (naturalWidth && naturalHeight) ? `${naturalWidth}×${naturalHeight}` : '');
  const zoom = el('select', { class: 'image-overlay-zoom', title: 'Zoom level' });
  for (const [val, label] of [
    ['100', '100% (1:1)'],
    ['75', '75%'],
    ['50', '50%'],
    ['25', '25%'],
    ['fit', 'Fit to window'],
  ]) {
    const opt = el('option', { value: val }, label);
    if (val === '100') opt.selected = true;
    zoom.appendChild(opt);
  }
  const closeBtn = el('button', { class: 'btn-mini image-overlay-close', title: 'Close (Esc)' }, '×');
  const header = el('div', { class: 'image-overlay-header' }, [fname, size, zoom, closeBtn]);
  // Content
  const img = el('img', { class: 'image-overlay-img zoom-100', src, alt: filename || '' });
  if (naturalWidth && naturalHeight) {
    // Hint the browser at the natural size for layout (CSS then scales
    // according to .zoom-100/75/50/25/fit).
    img.width = naturalWidth;
    img.height = naturalHeight;
  }
  const content = el('div', { class: 'image-overlay-content' }, [img]);
  overlay.append(header, content);
  document.body.appendChild(overlay);
  // Zoom on change
  zoom.addEventListener('change', () => {
    img.className = 'image-overlay-img zoom-' + zoom.value;
  });
  // Close on button click
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  closeBtn.addEventListener('click', close);
  // Close on background click (not on the image)
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  // Close on Esc
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  // Stop propagation on the image so clicking the image doesn't close
  // the overlay (the user is likely trying to interact with the image).
  img.addEventListener('click', (e) => e.stopPropagation());
}

function safeStringify(o) {
  try { return JSON.stringify(o, null, 2).slice(0, 4000); } catch { return String(o); }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ----------------- Image pipeline (Upscale / Crop / Convert) -----------------
// All three operations are pure browser/Electron — no external libraries,
// no network calls, fully open source. They all use the HTML5 Canvas
// API to read the source image into a canvas, then export it to the
// target format via canvas.toDataURL. The main process only handles
// persisting the resulting base64 blob to disk via the new fb:write IPC.

// Load a local file:// image as a usable Image object (resolves once
// it's fully decoded). Used by upscale / crop / convert.
function loadImageFromFile(filePath) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image: ' + filePath));
    img.src = fileUrl(filePath);
  });
}

// Derive the output MIME from a file extension. Used to export the
// canvas in the same format as the input. WebP is detected too (since
// the Canvas API supports exporting to image/webp in modern Chromium).
function mimeFromPath(p) {
  const ext = (p.split('.').pop() || '').toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/png'; // GIF can't be exported from canvas;
                                        // we fall back to PNG (first frame)
  return 'image/png';
}

// Derive the output file extension from a MIME type. Used by the
// format-converter.
function extFromMime(mime) {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  return 'png';
}

// Pick a non-clobbering output path next to the source. Inserts a
// `_2x`, `_cropped_WxH`, or `_converted` infix between the stem and
// the extension. If the result already exists, a numeric suffix is
// appended to keep the original safe.
function derivedOutputPath(srcPath, infix) {
  const sep = srcPath.includes('\\') ? '\\' : '/';
  const lastSep = srcPath.lastIndexOf(sep);
  const dir = lastSep >= 0 ? srcPath.slice(0, lastSep) : '';
  const lastDot = srcPath.lastIndexOf('.');
  const stem = lastDot > lastSep ? srcPath.slice(0, lastDot) : srcPath;
  const ext = lastDot > lastSep ? srcPath.slice(lastDot) : '';
  let candidate = `${dir}${sep}${stem.split(sep).pop()}${infix}${ext}`;
  // Append numeric suffix on collision
  let i = 1;
  // We don't have a direct "exists" IPC here in the renderer; the
  // fbWrite will succeed (overwrite) if the file doesn't exist or
  // will fail with EEXIST. To avoid clobbering, we just keep the
  // name as-is and trust the user (or rely on fbWrite rejecting
  // existing files in the future). For now: no auto-suffix.
  return candidate;
}

// One resize step. Prefers createImageBitmap with resizeQuality: 'high'
// — Chromium uses a Lanczos-style resampler for that, which is
// noticeably sharper than the default canvas drawImage path. Falls
// back to canvas drawImage with imageSmoothingQuality = 'high' for
// older runtimes that don't expose createImageBitmap.
async function upscaleStep(src, w, h) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(src, {
        resizeWidth: w,
        resizeHeight: h,
        resizeQuality: 'high',
      });
    } catch (_) { /* fall through to canvas path */ }
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return canvas;
}

// Toast-once latch: don't re-spam the user with the "Real-ESRGAN
// missing" message on every upscale. Resetting it requires a restart
// of the app, which is what we want — a single reminder per session
// is enough.
let _reEsrganNotified = false;

// Upscale an image to multiplier× its original size. If the
// realesrgan-ncnn-vulkan binary is installed (PATH or ./bin/), we
// run it to get a high-quality 4× intermediate, then resize the
// result down to the requested multiplier (or do an extra 2× step
// for 8×). Real-ESRGAN's x4plus model is BSD-3-Clause licensed and
// produces noticeably more detail than the built-in
// multi-step createImageBitmap pipeline. If the binary is missing,
// we fall back to the multi-step pipeline so the tool is never
// blocked.
//
// Returns the output path on disk.
async function upscaleImageFile(srcPath, multiplier) {
  multiplier = Math.max(1, Math.min(8, Math.floor(Number(multiplier) || 2)));

  // Probe Real-ESRGAN availability. Cheap IPC (just a `which` /
  // bundled-file stat); the result is cached in the main process.
  let reStatus = null;
  try { reStatus = await window.api.realesrganAvailable(); } catch (_) {}

  if (reStatus && reStatus.available) {
    try {
      return await upscaleImageFileRealesrgan(srcPath, multiplier, reStatus);
    } catch (e) {
      // Real-ESRGAN is available but failed (corrupt model, GPU OOM,
      // etc.). Log the error and fall back to the built-in pipeline
      // so the user still gets a result.
      console.error('Real-ESRGAN upscale failed, falling back to built-in:', e);
      toast('Real-ESRGAN upscale failed (' + (e.message || e) + '). Using built-in upscale.', 'warn', 4000);
      // fall through to built-in
    }
  } else if (!_reEsrganNotified) {
    _reEsrganNotified = true;
    toast(
      'Real-ESRGAN not installed — using the built-in upscale. ' +
      'Drop the binary into ./bin/ (or add it to PATH) for noticeably higher-quality output. ' +
      'See README for the download link.',
      'info', 6000,
    );
  }

  // Built-in multi-step path.
  const srcImg = await loadImageFromFile(srcPath);
  const targetW = Math.max(1, Math.floor(srcImg.naturalWidth * multiplier));
  const targetH = Math.max(1, Math.floor(srcImg.naturalHeight * multiplier));
  let curW = srcImg.naturalWidth;
  let curH = srcImg.naturalHeight;
  let cur = srcImg;
  while (curW < targetW || curH < targetH) {
    const stepW = Math.min(targetW, curW * 2);
    const stepH = Math.min(targetH, curH * 2);
    cur = await upscaleStep(cur, stepW, stepH);
    curW = stepW;
    curH = stepH;
  }
  const mime = mimeFromPath(srcPath);
  const out = document.createElement('canvas');
  out.width = targetW;
  out.height = targetH;
  const octx = out.getContext('2d');
  if (mime === 'image/jpeg') {
    octx.fillStyle = '#ffffff';
    octx.fillRect(0, 0, targetW, targetH);
  }
  octx.drawImage(cur, 0, 0);
  const dataUrl = out.toDataURL(mime, 0.95);
  const b64 = dataUrl.split(',')[1];
  const outPath = derivedOutputPath(srcPath, `_${multiplier}x`);
  const r = await window.api.fbWrite(outPath, b64);
  if (!r.ok) throw new Error(r.error || 'fbWrite failed');
  return r.path;
}

// Whitelist of Real-ESRGAN model names we know about. The model
// becomes the `-n` flag value of the spawn, so this is also a
// defence against a corrupted state.json / compromised renderer
// injecting an arbitrary flag into the binary's argv. Update
// when a new model is added to ./bin/models/.
const REAL_ESRGAN_MODELS = new Set([
  'realesrgan-x4plus',
  'realesrgan-x4plus-anime',
  'realesrgan-animevideov3',
  'realesr-general-x4v3',
]);

// Real-ESRGAN path. The ncnn-vulkan binary always outputs at the
// model's native scale (4× for x4plus). For multipliers other than
// 4×, we resize the intermediate using the same createImageBitmap
// step the built-in path uses:
//   - 2×: 4× → 2×  (downscale)
//   - 3×: 4× → 3×  (downscale)
//   - 4×: 4× as-is
//   - 8×: 4× → 8×  (extra 2× step)
async function upscaleImageFileRealesrgan(srcPath, multiplier, reStatus) {
  // Pick a model: prefer the user's saved choice, but only if it's on
  // the whitelist. Anything else (default, typo, exploit attempt)
  // falls back to the general-purpose 4× BSD-3 model.
  const wanted = (state.realesrganModel || '').trim();
  const model = REAL_ESRGAN_MODELS.has(wanted) ? wanted : 'realesrgan-x4plus';

  // The Real-ESRGAN binary needs a writable output path. Write its
  // 4× intermediate to a `.realesrgan_tmp.png` next to the source
  // (in output_dir, so it's already in the allowed roots) and
  // clean it up in `finally`.
  const sep = srcPath.includes('\\') ? '\\' : '/';
  const dot = srcPath.lastIndexOf('.');
  const stem = dot > 0 ? srcPath.slice(0, dot) : srcPath;
  const tempOut = stem + '.realesrgan_tmp.png';

  let r;
  try {
    r = await window.api.realesrganRun(srcPath, tempOut, {
      model,
      scale: 4,
    });
  } catch (e) {
    throw new Error('Real-ESRGAN run threw: ' + (e.message || e));
  }
  if (!r || !r.ok) {
    const msg = (r && r.stderr) || 'Real-ESRGAN returned a non-zero exit';
    throw new Error(msg);
  }

  try {
    // Load the 4× intermediate and resize to the user's multiplier.
    const reImg = await loadImageFromFile(tempOut);
    const naturalW = reImg.naturalWidth / 4;
    const naturalH = reImg.naturalHeight / 4;
    const targetW = Math.max(1, Math.floor(naturalW * multiplier));
    const targetH = Math.max(1, Math.floor(naturalH * multiplier));
    let cur = reImg;
    let curW = reImg.naturalWidth;
    let curH = reImg.naturalHeight;
    if (multiplier !== 4) {
      cur = await upscaleStep(cur, targetW, targetH);
      curW = targetW;
      curH = targetH;
    }

    const mime = mimeFromPath(srcPath);
    const out = document.createElement('canvas');
    out.width = curW;
    out.height = curH;
    const octx = out.getContext('2d');
    if (mime === 'image/jpeg') {
      octx.fillStyle = '#ffffff';
      octx.fillRect(0, 0, curW, curH);
    }
    octx.drawImage(cur, 0, 0);
    const dataUrl = out.toDataURL(mime, 0.95);
    const b64 = dataUrl.split(',')[1];
    const outPath = derivedOutputPath(srcPath, `_${multiplier}x`);
    const w = await window.api.fbWrite(outPath, b64);
    if (!w.ok) throw new Error(w.error || 'fbWrite failed');
    return w.path;
  } finally {
    // Best-effort cleanup of the intermediate. If the user is
    // hammering the upscale button the file may already be
    // re-created; fbDelete tolerates ENOENT.
    window.api.fbDelete(tempOut).catch(() => {});
  }
}

// Crop an image to the given pixel rectangle (in image coordinates).
// Output file uses the same extension as the source.
async function cropImageFile(srcPath, x, y, w, h) {
  x = Math.max(0, Math.floor(Number(x) || 0));
  y = Math.max(0, Math.floor(Number(y) || 0));
  w = Math.max(1, Math.floor(Number(w) || 1));
  h = Math.max(1, Math.floor(Number(h) || 1));
  const img = await loadImageFromFile(srcPath);
  // Clamp to image bounds
  if (x + w > img.naturalWidth) w = img.naturalWidth - x;
  if (y + h > img.naturalHeight) h = img.naturalHeight - y;
  if (w <= 0 || h <= 0) throw new Error('Crop region is outside the image.');
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
  const mime = mimeFromPath(srcPath);
  const dataUrl = canvas.toDataURL(mime);
  const b64 = dataUrl.split(',')[1];
  const out = derivedOutputPath(srcPath, `_cropped_${w}x${h}`);
  const r = await window.api.fbWrite(out, b64);
  if (!r.ok) throw new Error(r.error || 'fbWrite failed');
  return r.path;
}

// Convert an image to a different format (png / jpeg / webp). Returns
// the output path. The new file has the target extension.
async function convertImageFile(srcPath, targetFormat) {
  const targetMime = `image/${targetFormat}`;
  const img = await loadImageFromFile(srcPath);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  // JPEG: no alpha; flatten onto white background.
  if (targetMime === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0);
  const dataUrl = canvas.toDataURL(targetMime, 0.95);
  const b64 = dataUrl.split(',')[1];
  const ext = extFromMime(targetMime);
  // Build the output path: same stem, new extension.
  const sep = srcPath.includes('\\') ? '\\' : '/';
  const lastSep = srcPath.lastIndexOf(sep);
  const dir = lastSep >= 0 ? srcPath.slice(0, lastSep) : '';
  const lastDot = srcPath.lastIndexOf('.');
  const stem = lastDot > lastSep ? srcPath.slice(0, lastDot) : srcPath;
  const out = `${dir}${sep}${stem.split(sep).pop()}_converted.${ext}`;
  const r = await window.api.fbWrite(out, b64);
  if (!r.ok) throw new Error(r.error || 'fbWrite failed');
  return r.path;
}

// =================== Image-pipeline overlays ===================
// All three (Upscale settings, Crop, Convert) are pure modals built on
// showModal(). They share the same panel layout: title, description,
// form fields, action button, cancel.

// Settings overlay used by the "Upscale" checkbox in the image tab.
// Saves the chosen multiplier to state.upscaleSettings and closes; the
// checkbox stays checked so the next generation is upscaled.
function showUpscaleSettings() {
  if (!state.upscaleSettings) {
    state.upscaleSettings = { multiplier: 2, autoCrop: false, cropWidth: 0, cropHeight: 0, cropAnchorX: 'center', cropAnchorY: 'center' };
  }
  // Defensive: also fill in any missing fields on old state.js that
  // pre-dated the auto-crop support.
  const s = state.upscaleSettings;
  if (typeof s.autoCrop !== 'boolean') s.autoCrop = false;
  if (typeof s.cropWidth !== 'number') s.cropWidth = 0;
  if (typeof s.cropHeight !== 'number') s.cropHeight = 0;
  if (typeof s.cropAnchorX !== 'string') s.cropAnchorX = 'center';
  if (typeof s.cropAnchorY !== 'string') s.cropAnchorY = 'center';

  showModal((m, close) => {
    m.appendChild(el('h2', {}, '🔍 Upscale settings'));
    m.appendChild(el('p', { style: 'color: var(--fg-2); font-size: 12px; margin-top: 0;' },
      'When the Upscale checkbox is on, every generated image is upscaled locally with the settings below before being shown. Pure browser Canvas — no API call, no network. The "auto-crop" options here are also picked up by the "Add" button on the image tab and applied to every entry in a batch.'));

    // Multiplier
    const multSel = el('select', {});
    for (const m2 of [2, 3, 4]) {
      const opt = el('option', { value: String(m2) }, `${m2}× (larger)`);
      if (m2 === s.multiplier) opt.selected = true;
      multSel.appendChild(opt);
    }
    m.appendChild(el('div', { class: 'row' }, [el('label', {}, 'Multiplier'), multSel]));

    // auto-crop checkbox
    const autoCropCb = el('input', { type: 'checkbox', class: 'auto-crop-cb' });
    autoCropCb.checked = !!s.autoCrop;
    m.appendChild(el('div', { class: 'row' }, [
      el('label', { class: 'auto-crop-label' }, [autoCropCb, ' auto-crop to resolution']),
    ]));

    // crop W/H inputs (hidden by default)
    const cropWInput = el('input', { type: 'number', min: '0', value: String(s.cropWidth || 0) });
    const cropHInput = el('input', { type: 'number', min: '0', value: String(s.cropHeight || 0) });
    const cropSizeRow = el('div', { class: 'row auto-crop-only' }, [
      el('label', {}, 'Crop target W × H (0 = use post-upscale target)'),
      cropWInput, el('span', {}, ' × '), cropHInput,
    ]);
    cropSizeRow.style.display = s.autoCrop ? '' : 'none';
    m.appendChild(cropSizeRow);

    // 3×3 anchor grid (hidden by default)
    const anchor = { x: s.cropAnchorX, y: s.cropAnchorY };
    const anchorGrid = el('div', { class: 'anchor-grid' });
    const cells = [];
    const GLYPHS = [
      ['↖', 'top-left',     'left',    'top'],
      ['↑', 'top-center',   'center',  'top'],
      ['↗', 'top-right',    'right',   'top'],
      ['←', 'middle-left',  'left',    'center'],
      ['·', 'center',       'center',  'center'],
      ['→', 'middle-right', 'right',   'center'],
      ['↙', 'bottom-left',  'left',    'bottom'],
      ['↓', 'bottom-center','center',  'bottom'],
      ['↘', 'bottom-right', 'right',   'bottom'],
    ];
    for (let i = 0; i < GLYPHS.length; i++) {
      const [glyph, name, x, y] = GLYPHS[i];
      const cell = el('button', {
        type: 'button',
        class: 'anchor-cell' + (x === anchor.x && y === anchor.y ? ' selected' : ''),
        title: `Anchor: ${name} (crop keeps the ${name} corner)`,
        'data-x': x, 'data-y': y,
      }, glyph);
      cell.addEventListener('click', () => {
        for (const c of cells) c.classList.remove('selected');
        cell.classList.add('selected');
        anchor.x = x;
        anchor.y = y;
      });
      cells.push(cell);
      anchorGrid.appendChild(cell);
    }
    anchorGrid.style.display = s.autoCrop ? '' : 'none';
    m.appendChild(anchorGrid);

    function setAutoCropVisible(on) {
      cropSizeRow.style.display = on ? '' : 'none';
      anchorGrid.style.display = on ? '' : 'none';
    }
    autoCropCb.addEventListener('change', () => setAutoCropVisible(autoCropCb.checked));

    // Save
    const saveBtn = el('button', { class: 'primary' }, 'Save');
    const cancelBtn = el('button', { onclick: close }, 'Cancel');
    saveBtn.addEventListener('click', async () => {
      state.upscaleSettings = {
        multiplier: parseInt(multSel.value, 10) || 2,
        autoCrop: autoCropCb.checked,
        cropWidth: Math.max(0, parseInt(cropWInput.value, 10) || 0),
        cropHeight: Math.max(0, parseInt(cropHInput.value, 10) || 0),
        cropAnchorX: anchor.x,
        cropAnchorY: anchor.y,
      };
      state.upscaleEnabled = true;
      await scheduleStateSave();
      if (typeof refreshUpscaleCheckboxUI === 'function') refreshUpscaleCheckboxUI();
      const extra = state.upscaleSettings.autoCrop ? ' + auto-crop' : '';
      toast(`Upscale settings saved (${state.upscaleSettings.multiplier}×${extra}).`, 'ok', 2000);
      close();
    });
    m.appendChild(el('div', { class: 'footer' }, [cancelBtn, saveBtn]));
  });
}

// Direct upscale overlay used by the right-click menu on an image
// in the file browser. Shows the source resolution + the target
// resolution after upscaling, an "auto-crop to resolution" toggle,
// and (when that toggle is on) a 3×3 anchor grid + W/H inputs so
// the user can upscale AND crop in one step. The flow:
//   1. upscaleImageFile() writes `<name>_Nx.png` to output_dir.
//   2. If auto-crop is on, cropImageFile() reads it back, places
//      the crop frame at the chosen anchor (top-left, center,
//      bottom-right, etc.), writes `<name>_Nx_cropped_WxH.png`,
//      and the intermediate `_Nx` file is deleted.
//   3. The cropped file is shown in the preview pane.
async function showUpscaleDirect(srcPath) {
  // We need the source's natural resolution to compute the target.
  // If the image is unreadable, surface the error and bail — the
  // dialog needs a known sourceW × sourceH to do anything useful.
  let srcW = 0, srcH = 0;
  try {
    const img = await loadImageFromFile(srcPath);
    srcW = img.naturalWidth;
    srcH = img.naturalHeight;
    if (!srcW || !srcH) throw new Error('Image has no natural dimensions');
  } catch (e) {
    toast('Failed to load image: ' + (e && e.message || e), 'err', 6000);
    return;
  }
  // Pull defaults from the global upscale settings so the
  // right-click "Upscale" dialog and the tab's "Upscale Settings"
  // dialog are in sync. The user can still change anything for
  // this one-off run; the Save below updates state.upscaleSettings
  // if they do, so the next right-click / next generation sees
  // the new values.
  const us = state.upscaleSettings || { multiplier: 2, autoCrop: false, cropWidth: 0, cropHeight: 0, cropAnchorX: 'center', cropAnchorY: 'center' };
  showModal((m, close) => {
    m.appendChild(el('h2', {}, '🔍 Upscale image'));
    m.appendChild(el('p', { class: 'meta', style: 'color: var(--fg-2); font-size: 12px;' },
      'Source: ' + srcPath));

    // Resolution row: source (immutable) + target after upscale (live).
    // The target updates whenever the multiplier or crop W/H changes.
    const targetText = el('div', { class: 'meta' }, '');
    function refreshTarget() {
      const mult = parseInt(multSel.value, 10) || 2;
      const tW = srcW * mult;
      const tH = srcH * mult;
      // 0 = use post-upscale target. Negative is impossible (the
      // min="0" attribute + Math.max in the save handler guard it).
      const wantCropW = parseInt(cropWInput.value, 10);
      const wantCropH = parseInt(cropHInput.value, 10);
      const cropW = (isNaN(wantCropW) || wantCropW <= 0) ? tW : wantCropW;
      const cropH = (isNaN(wantCropH) || wantCropH <= 0) ? tH : wantCropH;
      const w = Math.min(cropW, tW);
      const h = Math.min(cropH, tH);
      const cropNote = autoCropCb.checked ? ` · after auto-crop: ${w} × ${h} px` : '';
      targetText.textContent = `Source ${srcW} × ${srcH} px  →  after upscale: ${tW} × ${tH} px${cropNote}`;
    }

    m.appendChild(el('div', { class: 'row' }, [el('label', {}, 'Resolution'), targetText]));

    // Multiplier selector (2× / 3× / 4× / 8×).
    const multSel = el('select', {});
    for (const m2 of [2, 3, 4, 8]) {
      const opt = el('option', { value: String(m2) }, `${m2}×`);
      if (m2 === (us.multiplier || 2)) opt.selected = true;
      multSel.appendChild(opt);
    }
    m.appendChild(el('div', { class: 'row' }, [el('label', {}, 'Multiplier'), multSel]));

    // auto-crop checkbox. Pre-checked from state.upscaleSettings.
    const autoCropCb = el('input', { type: 'checkbox', class: 'auto-crop-cb' });
    autoCropCb.checked = !!us.autoCrop;
    m.appendChild(el('div', { class: 'row' }, [
      el('label', { class: 'auto-crop-label' }, [autoCropCb, ' auto-crop to resolution']),
    ]));

    // Crop W / H inputs. Hidden by default; revealed when auto-crop
    // is checked. Pre-filled from state.upscaleSettings (or 0 = use
    // post-upscale target).
    const cropWInput = el('input', { type: 'number', min: '0', value: String(us.cropWidth || 0) });
    const cropHInput = el('input', { type: 'number', min: '0', value: String(us.cropHeight || 0) });
    const cropSizeRow = el('div', { class: 'row auto-crop-only' }, [
      el('label', {}, 'Crop target W × H (0 = use post-upscale target)'),
      cropWInput, el('span', {}, ' × '), cropHInput,
    ]);
    cropSizeRow.style.display = us.autoCrop ? '' : 'none';
    m.appendChild(cropSizeRow);

    // 3×3 anchor grid. Each cell = an (x, y) anchor in {left,
    // center, right} × {top, center, bottom}. The selected cell
    // comes from state.upscaleSettings.
    const anchor = { x: us.cropAnchorX || 'center', y: us.cropAnchorY || 'center' };
    const anchorGrid = el('div', { class: 'anchor-grid' });
    const cells = [];
    const GLYPHS = [
      ['↖', 'top-left',     'left',    'top'],
      ['↑', 'top-center',   'center',  'top'],
      ['↗', 'top-right',    'right',   'top'],
      ['←', 'middle-left',  'left',    'center'],
      ['·', 'center',       'center',  'center'],
      ['→', 'middle-right', 'right',   'center'],
      ['↙', 'bottom-left',  'left',    'bottom'],
      ['↓', 'bottom-center','center',  'bottom'],
      ['↘', 'bottom-right', 'right',   'bottom'],
    ];
    for (let i = 0; i < GLYPHS.length; i++) {
      const [glyph, name, x, y] = GLYPHS[i];
      const cell = el('button', {
        type: 'button',
        class: 'anchor-cell' + (x === anchor.x && y === anchor.y ? ' selected' : ''),
        title: `Anchor: ${name} (crop keeps the ${name} corner)`,
        'data-x': x, 'data-y': y,
      }, glyph);
      cell.addEventListener('click', () => {
        for (const c of cells) c.classList.remove('selected');
        cell.classList.add('selected');
        anchor.x = x;
        anchor.y = y;
      });
      cells.push(cell);
      anchorGrid.appendChild(cell);
    }
    anchorGrid.style.display = us.autoCrop ? '' : 'none';
    m.appendChild(anchorGrid);

    // A short explanation of the cropping section, so the user
    // doesn't have to guess what the 3×3 grid + W × H inputs
    // actually do. Uses inline <code> tags for the glyphs.
    const cropExplanation = el('div', { class: 'crop-explanation' }, [
      'When you click Upscale, the image is first scaled up by ',
      el('strong', {}, `${us.multiplier || 2}×`),
      ' (using the Real-ESRGAN binary if installed, otherwise multi-step canvas upscaling), then ',
      el('strong', {}, 'cropped'),
      ' to the target W × H at the chosen anchor. The 3×3 grid above picks the anchor: ',
      el('code', {}, '↖'),
      ' keeps the ',
      el('strong', {}, 'top-left'),
      ' corner, ',
      el('code', {}, '·'),
      ' keeps equal borders on all four sides, ',
      el('code', {}, '↘'),
      ' keeps the ',
      el('strong', {}, 'bottom-right'),
      '.',
    ]);
    cropExplanation.style.display = us.autoCrop ? '' : 'none';
    m.appendChild(cropExplanation);

    // Blank-image crop preview: a fixed 200×150 "source" with a
    // green crop frame overlay that updates whenever the user
    // picks a different anchor (or changes the W × H inputs).
    // The frame is sized proportionally to the post-upscale
    // target W × H so the user can see how much of the image
    // is actually kept.
    const cropPreviewBlock = el('div', { class: 'crop-preview' });
    const stage = el('div', { class: 'crop-preview-stage' });
    const blank = el('div', { class: 'crop-preview-image' });
    const frame = el('div', { class: 'crop-preview-frame' });
    stage.append(blank, frame);
    cropPreviewBlock.appendChild(stage);
    const legend = el('div', { class: 'crop-preview-legend' });
    cropPreviewBlock.appendChild(legend);
    const ANCHOR_LABELS = {
      'left-top':       'top-left',
      'center-top':     'top-center',
      'right-top':      'top-right',
      'left-center':    'middle-left',
      'center-center':  'center',
      'right-center':   'middle-right',
      'left-bottom':    'bottom-left',
      'center-bottom':  'bottom-center',
      'right-bottom':   'bottom-right',
    };
    function refreshCropPreview() {
      const mult = parseInt(multSel.value, 10) || 2;
      const stageW = 200, stageH = 150;
      // The stage represents the post-upscale source. We scale
      // it to fit the stage keeping its real aspect ratio.
      const aspect = srcW / srcH;
      let dispSrcW, dispSrcH;
      if (aspect >= stageW / stageH) {
        dispSrcW = stageW;
        dispSrcH = stageW / aspect;
      } else {
        dispSrcH = stageH;
        dispSrcW = stageH * aspect;
      }
      const srcOffsetX = (stageW - dispSrcW) / 2;
      const srcOffsetY = (stageH - dispSrcH) / 2;
      // Frame size: use the user's W × H if set, otherwise the
      // full post-upscale target.
      const tW = srcW * mult;
      const tH = srcH * mult;
      const wantW = parseInt(cropWInput.value, 10);
      const wantH = parseInt(cropHInput.value, 10);
      let cropW = (Number.isFinite(wantW) && wantW > 0) ? Math.min(wantW, tW) : tW;
      let cropH = (Number.isFinite(wantH) && wantH > 0) ? Math.min(wantH, tH) : tH;
      // Scale the frame to the displayed source size.
      const scale = dispSrcW / tW;
      const frameW = cropW * scale;
      const frameH = cropH * scale;
      const maxX = dispSrcW - frameW;
      const maxY = dispSrcH - frameH;
      let x, y;
      if (anchor.x === 'left')       x = 0;
      else if (anchor.x === 'right') x = maxX;
      else                            x = Math.floor(maxX / 2);
      if (anchor.y === 'top')         y = 0;
      else if (anchor.y === 'bottom') y = maxY;
      else                            y = Math.floor(maxY / 2);
      frame.style.width = frameW + 'px';
      frame.style.height = frameH + 'px';
      frame.style.left = (srcOffsetX + x) + 'px';
      frame.style.top = (srcOffsetY + y) + 'px';
      // Position the blank "image" to match the source size.
      blank.style.left = srcOffsetX + 'px';
      blank.style.top = srcOffsetY + 'px';
      blank.style.width = dispSrcW + 'px';
      blank.style.height = dispSrcH + 'px';
      // Legend.
      legend.innerHTML = '';
      const name = ANCHOR_LABELS[anchor.x + '-' + anchor.y] || 'center';
      legend.appendChild(document.createTextNode('Anchor: '));
      legend.appendChild(el('span', { class: 'crop-preview-anchor-name' }, name));
      legend.appendChild(document.createTextNode(' — the green frame shows what will be kept.'));
    }
    cropPreviewBlock.style.display = us.autoCrop ? '' : 'none';
    m.appendChild(cropPreviewBlock);

    // Toggle the auto-crop sub-UI. We do this in a single place so
    // the show / hide stays in sync and the target text always
    // reflects the current state.
    function setAutoCropVisible(on) {
      cropSizeRow.style.display = on ? '' : 'none';
      anchorGrid.style.display = on ? '' : 'none';
      cropExplanation.style.display = on ? '' : 'none';
      cropPreviewBlock.style.display = on ? '' : 'none';
      if (on) {
        // The preview depends on a few derived values; recompute
        // on show so the user sees the current W × H + anchor.
        refreshCropPreview();
      }
      refreshTarget();
    }
    autoCropCb.addEventListener('change', () => setAutoCropVisible(autoCropCb.checked));
    multSel.addEventListener('change', refreshTarget);
    cropWInput.addEventListener('input', refreshTarget);
    cropHInput.addEventListener('input', refreshTarget);
    // The crop preview also re-renders on any input change.
    multSel.addEventListener('change', refreshCropPreview);
    cropWInput.addEventListener('input', refreshCropPreview);
    cropHInput.addEventListener('input', refreshCropPreview);
    // Each anchor cell already updates anchor.x/y; we also
    // re-render the crop preview on click.
    for (const cell of cells) cell.addEventListener('click', refreshCropPreview);
    setAutoCropVisible(!!us.autoCrop); // also primes the W/H inputs + target text
    if (us.autoCrop) refreshCropPreview();

    const upscaleBtn = el('button', { class: 'primary' }, 'Upscale');
    const cancelBtn = el('button', { onclick: close }, 'Cancel');
    upscaleBtn.addEventListener('click', async () => {
      const multiplier = parseInt(multSel.value, 10) || 2;
      // Persist whatever the user just configured so the next
      // right-click / next batch / next ⚙ Settings visit sees
      // the same values. We don't scheduleStateSave() here
      // (the action is fire-and-forget and the user can cancel);
      // scheduleStateSave() is called below on success.
      state.upscaleSettings = {
        multiplier,
        autoCrop: !!autoCropCb.checked,
        cropWidth: Math.max(0, parseInt(cropWInput.value, 10) || 0),
        cropHeight: Math.max(0, parseInt(cropHInput.value, 10) || 0),
        cropAnchorX: anchor.x,
        cropAnchorY: anchor.y,
      };
      state.upscaleEnabled = true;
      upscaleBtn.disabled = true; upscaleBtn.textContent = 'Upscaling…';
      try {
        // Step 1: upscale.
        const upscaled = await upscaleImageFile(srcPath, multiplier);
        // Step 2: optionally crop.
        if (autoCropCb.checked) {
          upscaleBtn.textContent = 'Cropping…';
          const cropW = Math.max(1, parseInt(cropWInput.value, 10) || 1);
          const cropH = Math.max(1, parseInt(cropHInput.value, 10) || 1);
          // Need the actual upscaled dimensions to anchor correctly.
          const upImg = await loadImageFromFile(upscaled);
          const uW = upImg.naturalWidth;
          const uH = upImg.naturalHeight;
          // Clamp the crop to the upscaled size; anchor otherwise.
          const w = Math.min(cropW, uW);
          const h = Math.min(cropH, uH);
          const maxX = uW - w;
          const maxY = uH - h;
          let x, y;
          if (anchor.x === 'left')       x = 0;
          else if (anchor.x === 'right') x = maxX;
          else                            x = Math.floor(maxX / 2);
          if (anchor.y === 'top')         y = 0;
          else if (anchor.y === 'bottom') y = maxY;
          else                            y = Math.floor(maxY / 2);
          const final = await cropImageFile(upscaled, x, y, w, h);
          // Drop the intermediate (full-upscaled) file — the user
          // asked for the cropped one, not the raw intermediate.
          window.api.fbDelete(upscaled).catch(() => {});
          toast(`Upscaled ${multiplier}× and cropped to ${w} × ${h} px → ${final}`, 'ok', 4000);
          await refreshBrowser();
          if (typeof updatePreviewPane === 'function') {
            try { previewImageFromFile(final); } catch (_) {}
          }
        } else {
          toast(`Upscaled to ${multiplier}× → ${upscaled}`, 'ok', 4000);
          await refreshBrowser();
          if (typeof updatePreviewPane === 'function') {
            try { previewImageFromFile(upscaled); } catch (_) {}
          }
        }
        // Persist the new upscale settings now that we know the
        // upscale succeeded. (The setting is also updated in-place
        // by the input listeners, but a state.json round-trip
        // through the debounced scheduleStateSave isn't guaranteed
        // to have fired yet.)
        try { await scheduleStateSave(); } catch (_) {}
        close();
      } catch (e) {
        toast('Upscale' + (autoCropCb.checked ? '+crop' : '') + ' failed: ' + (e && e.message || e), 'err', 6000);
        upscaleBtn.disabled = false;
        upscaleBtn.textContent = 'Upscale';
      }
    });
    m.appendChild(el('div', { class: 'footer' }, [cancelBtn, upscaleBtn]));
  });
}

// Crop overlay. The image is rendered at its natural pixel size inside
// a scrollable container; the user enters W x H, clicks Apply, and a
// green-bordered draggable frame appears at the specified size. The
// user can drag the frame to position it; clicking Crop finalizes.
function showCropOverlay(srcPath) {
  showModal((m, close) => {
    m.appendChild(el('h2', {}, '✂ Crop image'));
    m.appendChild(el('p', { class: 'meta', style: 'color: var(--fg-2); font-size: 12px;' },
      'Source: ' + srcPath));

    // Inputs row: auto-size checkbox, Width, Height, Apply
    // The "auto-size" checkbox is on by default: when checked, the
    // image and the green crop frame are both scaled to fit inside the
    // stage so a 4K source doesn't overflow the modal. The W/H inputs
    // still describe the crop in image pixels (the scale only affects
    // the on-screen display).
    const autoSizeCb = el('input', { type: 'checkbox', class: 'auto-size-cb' });
    autoSizeCb.checked = true;
    const wInput = el('input', { type: 'number', min: '1', value: '1024' });
    const hInput = el('input', { type: 'number', min: '1', value: '1024' });
    const applyBtn = el('button', { class: 'btn-mini' }, 'Apply');
    const cropBtn = el('button', { class: 'primary' }, 'Crop');
    const cancelBtn = el('button', { onclick: close }, 'Cancel');
    // The image stage: image + draggable frame overlay.
    const stage = el('div', { class: 'crop-stage' });
    const img = el('img', { class: 'crop-image' });
    // Hidden until we know the image's natural size.
    img.style.visibility = 'hidden';
    stage.appendChild(img);
    let frame = null;
    let frameX = 0, frameY = 0;
    // displayScale converts image pixels -> display pixels:
    //   displayW = imageW * displayScale
    //   displayH = imageH * displayScale
    // When auto-size is on and the image is bigger than the stage,
    // displayScale < 1 so the whole image + frame fit on screen. When
    // auto-size is off, displayScale = 1 (natural size, the original
    // behaviour). The drag handler uses this value to convert
    // display-pixel mouse deltas back into image-pixel positions.
    let displayScale = 1;

    m.appendChild(el('div', { class: 'crop-dim-row' }, [
      el('label', { class: 'auto-size-label' }, [autoSizeCb, ' auto-size']),
      el('label', {}, 'Width'), wInput, el('label', {}, 'Height'), hInput, applyBtn,
    ]));
    m.appendChild(stage);
    m.appendChild(el('div', { class: 'footer' }, [cancelBtn, cropBtn]));

    // Recompute the image's CSS size + the displayScale. Called when
    // the image finishes loading and when the user toggles the
    // checkbox. Reads the stage's actual client size (subtracting the
    // 4px padding on each side) so the math holds even after the
    // modal has been resized by the user.
    function applyAutoSize() {
      if (!img.naturalW) return;
      const stageW = stage.clientWidth || 1;
      const stageH = stage.clientHeight || 1;
      if (autoSizeCb.checked) {
        // Fit completely; never upscale beyond 1:1 (so we don't
        // bloat a small image to look pixelated).
        const s = Math.min(stageW / img.naturalW, stageH / img.naturalH, 1);
        displayScale = isFinite(s) && s > 0 ? s : 1;
      } else {
        displayScale = 1;
      }
      img.style.width = (img.naturalW * displayScale) + 'px';
      img.style.height = (img.naturalH * displayScale) + 'px';
    }
    autoSizeCb.addEventListener('change', () => {
      applyAutoSize();
      if (frame) showFrame();
    });

    // Load the image. Once decoded, show it and pre-fill W/H with the
    // natural size so the user can immediately Apply.
    loadImageFromFile(srcPath).then((loaded) => {
      img.naturalW = loaded.naturalWidth;
      img.naturalH = loaded.naturalHeight;
      img.src = loaded.src;
      img.style.visibility = '';
      wInput.value = String(loaded.naturalWidth);
      hInput.value = String(loaded.naturalHeight);
      applyAutoSize();
    }).catch((e) => {
      toast('Failed to load image: ' + e.message, 'err', 6000);
      close();
    });

    // Create / recreate the frame at the specified W x H, centered.
    // frameX/frameY are always in IMAGE pixels; the CSS left/top are
    // scaled by displayScale so the frame visually fits the image.
    function showFrame() {
      const w = Math.max(1, parseInt(wInput.value, 10) || 1);
      const h = Math.max(1, parseInt(hInput.value, 10) || 1);
      if (img.naturalW && (w > img.naturalW || h > img.naturalH)) {
        toast(`Frame size ${w}×${h} exceeds image size ${img.naturalW}×${img.naturalH}.`, 'warn', 4000);
        return;
      }
      if (frame) frame.remove();
      frame = el('div', { class: 'crop-frame', title: 'Drag to position' });
      // Display size = image size * scale
      frame.style.width = (w * displayScale) + 'px';
      frame.style.height = (h * displayScale) + 'px';
      // Center the frame initially
      frameX = Math.max(0, Math.floor((img.naturalW - w) / 2));
      frameY = Math.max(0, Math.floor((img.naturalH - h) / 2));
      // Display position = image position * scale
      frame.style.left = (frameX * displayScale) + 'px';
      frame.style.top = (frameY * displayScale) + 'px';
      stage.appendChild(frame);
      // Pass displayScale so the drag handler can convert
      // display-pixel mouse deltas to image-pixel positions.
      setupCropFrameDrag(frame, stage, () => img.naturalW, () => img.naturalH,
        (x, y) => { frameX = x; frameY = y; }, displayScale);
    }
    applyBtn.addEventListener('click', showFrame);

    cropBtn.addEventListener('click', async () => {
      if (!frame) { toast('Click Apply first to position the crop frame.', 'warn'); return; }
      const w = parseInt(wInput.value, 10) || 1;
      const h = parseInt(hInput.value, 10) || 1;
      cropBtn.disabled = true; cropBtn.textContent = 'Cropping…';
      try {
        const out = await cropImageFile(srcPath, frameX, frameY, w, h);
        toast(`Cropped to ${w}×${h} → ${out}`, 'ok', 4000);
        await refreshBrowser();
        if (typeof updatePreviewPane === 'function') {
          try { previewImageFromFile(out); } catch (_) {}
        }
        close();
      } catch (e) {
        toast('Crop failed: ' + (e && e.message || e), 'err', 6000);
        cropBtn.disabled = false; cropBtn.textContent = 'Crop';
      }
    });
  });
}

// Make the crop frame draggable, constrained to the image bounds.
// `displayScale` is the image-pixel-to-display-pixel ratio used by
// the parent overlay (1.0 = no scaling). When the image is rendered
// smaller than its natural size (because the auto-size checkbox is
// on and the source is larger than the stage), the frame's CSS
// width/height/left/top are in display pixels but the bounds checks
// and the position we report back to the caller are in image
// pixels. We convert at the boundary.
function setupCropFrameDrag(frame, stage, getImageW, getImageH, onMove, displayScale = 1) {
  let dragging = false;
  let startX, startY, frameStartImgX, frameStartImgY;
  function onDown(e) {
    e.preventDefault();
    dragging = true;
    const pt = e.touches ? e.touches[0] : e;
    startX = pt.clientX; startY = pt.clientY;
    // The frame's CSS left/top is in display pixels. Convert to
    // image pixels so the move deltas below are in the right space.
    frameStartImgX = Math.round((parseInt(frame.style.left, 10) || 0) / displayScale);
    frameStartImgY = Math.round((parseInt(frame.style.top, 10) || 0) / displayScale);
    document.addEventListener('mousemove', onMv);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onMv, { passive: false });
    document.addEventListener('touchend', onUp);
  }
  function onMv(e) {
    if (!dragging) return;
    e.preventDefault && e.preventDefault();
    const pt = e.touches ? e.touches[0] : e;
    const dx = pt.clientX - startX;
    const dy = pt.clientY - startY;
    // Frame size in image pixels = CSS size / displayScale.
    const w = Math.round((parseInt(frame.style.width, 10) || 1) / displayScale);
    const h = Math.round((parseInt(frame.style.height, 10) || 1) / displayScale);
    const iw = getImageW() || 1;
    const ih = getImageH() || 1;
    // Convert display-pixel mouse deltas to image pixels.
    const dImgX = Math.round(dx / displayScale);
    const dImgY = Math.round(dy / displayScale);
    let nx = Math.max(0, Math.min(frameStartImgX + dImgX, iw - w));
    let ny = Math.max(0, Math.min(frameStartImgY + dImgY, ih - h));
    // Write back as display pixels.
    frame.style.left = (nx * displayScale) + 'px';
    frame.style.top = (ny * displayScale) + 'px';
    if (onMove) onMove(nx, ny);
  }
  function onUp() {
    dragging = false;
    document.removeEventListener('mousemove', onMv);
    document.removeEventListener('mouseup', onUp);
    document.removeEventListener('touchmove', onMv);
    document.removeEventListener('touchend', onUp);
  }
  frame.addEventListener('mousedown', onDown);
  frame.addEventListener('touchstart', onDown, { passive: false });
}

// Format-converter overlay. Shows the source format and a dropdown of
// supported targets (PNG, JPEG, WebP). Output file uses the new
// extension; quality is fixed at 0.95.
function showConvertOverlay(srcPath) {
  const ext = (srcPath.split('.').pop() || '').toLowerCase();
  const srcFmt = ext.toUpperCase() || '?';
  showModal((m, close) => {
    m.appendChild(el('h2', {}, '⇄ Convert image format'));
    m.appendChild(el('p', { class: 'meta', style: 'color: var(--fg-2); font-size: 12px;' },
      'Source: ' + srcPath));
    const srcFmtLabel = el('input', { type: 'text', value: srcFmt, readonly: '' });
    const outSel = el('select', {});
    // Supported output targets. All three are written natively by
    // canvas.toDataURL (Chromium supports image/webp since v32).
    for (const [v, lbl] of [
      ['png',  'PNG  (lossless, supports transparency)'],
      ['jpeg', 'JPEG (smaller files, no transparency)'],
      ['webp', 'WebP (modern, smaller files)'],
    ]) {
      const opt = el('option', { value: v }, lbl);
      // Default to a different format than the source
      if (v !== ext) opt.selected = true;
      outSel.appendChild(opt);
    }
    m.appendChild(el('div', { class: 'row' }, [el('label', {}, 'Input format'), srcFmtLabel]));
    m.appendChild(el('div', { class: 'row' }, [el('label', {}, 'Output format'), outSel]));
    const convertBtn = el('button', { class: 'primary' }, 'Convert');
    const cancelBtn = el('button', { onclick: close }, 'Cancel');
    convertBtn.addEventListener('click', async () => {
      const target = outSel.value;
      if (target === ext) {
        toast('Source and target format are the same — nothing to do.', 'warn', 3000);
        return;
      }
      convertBtn.disabled = true; convertBtn.textContent = 'Converting…';
      try {
        const out = await convertImageFile(srcPath, target);
        toast(`Converted to ${target.toUpperCase()} → ${out}`, 'ok', 4000);
        await refreshBrowser();
        if (typeof updatePreviewPane === 'function') {
          try { previewImageFromFile(out); } catch (_) {}
        }
        close();
      } catch (e) {
        toast('Convert failed: ' + (e && e.message || e), 'err', 6000);
        convertBtn.disabled = false; convertBtn.textContent = 'Convert';
      }
    });
    m.appendChild(el('div', { class: 'footer' }, [cancelBtn, convertBtn]));
  });
}

// ----------------- Long-hover tooltip -----------------

// ----------------- Long-hover tooltip -----------------
// The .lastcmd element shows a single line of the most recent mmx command,
// but the command is usually longer than the visible area (ellipsized). On
// hover >1s, show the full text in a floating popup. Event-delegated so it
// works for every tab's lastcmd without explicit setup per build().
function setupLastCmdTooltips() {
  let timer = null;
  let popup = null;
  let activeEl = null;
  let hideTimer = null;
  const cancel = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (popup) { popup.remove(); popup = null; }
    activeEl = null;
  };
  const scheduleHide = () => {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(cancel, 250);
  };
  document.addEventListener('mouseover', (e) => {
    const t = e.target && e.target.closest && e.target.closest('.lastcmd');
    if (!t) return;
    if (t === activeEl) return;
    cancel();
    activeEl = t;
    const text = (t.textContent || '').trim();
    if (!text) return;
    timer = setTimeout(() => {
      if (activeEl !== t) return;
      popup = document.createElement('div');
      popup.className = 'long-hover-tooltip';
      popup.textContent = text;
      // Allow text selection inside the popup so the user can copy the
      // command. Also pause auto-hide while the pointer is over the popup.
      popup.addEventListener('mouseenter', () => { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } });
      popup.addEventListener('mouseleave', scheduleHide);
      document.body.appendChild(popup);
      const r = t.getBoundingClientRect();
      const pr = popup.getBoundingClientRect();
      let top = r.top - pr.height - 6;
      let left = r.left;
      if (top < 4) top = r.bottom + 6;
      // Right clamp
      if (left + pr.width > window.innerWidth - 8) left = window.innerWidth - pr.width - 8;
      // Left clamp
      if (left < 8) left = 8;
      popup.style.position = 'fixed';
      popup.style.top = top + 'px';
      popup.style.left = left + 'px';
      timer = null;
    }, 1000);
  });
  document.addEventListener('mouseout', (e) => {
    const t = e.target && e.target.closest && e.target.closest('.lastcmd');
    if (!t) return;
    // If the mouse is moving into the popup, keep it visible.
    if (popup && e.relatedTarget && (e.relatedTarget === popup || popup.contains(e.relatedTarget))) return;
    scheduleHide();
  });
  // Cancel on scroll/resize so the popup never drifts from its anchor
  window.addEventListener('scroll', cancel, true);
  window.addEventListener('resize', cancel);
  // Click anywhere dismisses the popup
  document.addEventListener('click', (e) => {
    if (popup && e.target !== popup && !popup.contains(e.target)) cancel();
  }, true);
}

// ----------------- File browser -----------------
async function refreshBrowser(opts = {}) {
  // Prefer the per-tab saved folder (set when the user last visited this
  // tab), then the current fbDir, then the output root.
  const saved = (state.currentTab && state.fbDirs[state.currentTab]) || '';
  let startDir = state.fbDir || saved || state.config.output_dir || '';
  let out = await window.api.fbList(startDir);
  // If the user had a per-tab folder persisted but it's gone (deleted,
  // drive removed, etc.) — fall back to the output root instead of just
  // showing an error and forcing the user to click "Refresh". Same
  // fallback if the live fbDir fails for the same reason.
  if (!out.ok && startDir && startDir !== (state.config.output_dir || '')) {
    if (state.currentTab && state.fbDirs[state.currentTab]) {
      state.fbDirs[state.currentTab] = '';
      scheduleStateSave();
    }
    state.fbDir = '';
    const fallback = state.config.output_dir || '';
    if (fallback) {
      startDir = fallback;
      out = await window.api.fbList(fallback);
    }
  }
  if (!out.ok) {
    $('#fb-list').innerHTML = '';
    $('#fb-path').textContent = out.error || '(no output dir)';
    return;
  }
  // For the file browser, default to current tab's subfolder if it exists.
  // Skip this when:
  //   - opts.keepCurrent is set (e.g. the Up button)
  //   - we already have a saved per-tab folder (the user has navigated
  //     within this tab before — respect their choice)
  let target = out;
  if (!opts.keepCurrent && !saved) {
    const sub = pathJoin(target.dir, state.currentTab);
    const subTry = await window.api.fbList(sub);
    if (subTry.ok) target = subTry;
  }
  state.fbDir = target.dir;
  // Keep the per-tab slot in sync with the actual browser location so
  // navigating within a tab (e.g. via the Up button) is remembered. Also
  // trigger an autosave so the new folder survives an app restart even
  // if the user never switches tabs afterwards.
  if (state.currentTab && state.fbDirs[state.currentTab] !== target.dir) {
    state.fbDirs[state.currentTab] = target.dir;
    scheduleStateSave();
  }
  $('#fb-path').textContent = target.dir;
  $('#fb-path').title = target.dir;
  renderFbList(target.items);
  // Apply current search filter if any
  applyFileSearch();
}

function parentDir(p) {
  if (!p) return '';
  const sep = p.includes('\\') ? '\\' : '/';
  const parts = p.split(/[\\/]/).filter(Boolean);
  parts.pop();
  return parts.length ? parts.join(sep) : '';
}

function applyFileSearch() {
  const q = ($('#fb-search')?.value || '').toLowerCase();
  for (const item of $$('.fb-item')) {
    if (!q) { item.style.display = ''; continue; }
    const name = (item.dataset.name || item.querySelector('.name')?.textContent || '').toLowerCase();
    item.style.display = name.includes(q) ? '' : 'none';
  }
}

function pathJoin(a, b) {
  if (!a) return b;
  const sep = a.includes('\\') ? '\\' : '/';
  return a.replace(/[\\/]+$/, '') + sep + b;
}

// Mark an element as a drag-and-drop target. When a file from this list (or
// the ".." entry) is dropped on it, the file is moved to `destDir`. Highlights
// the element while a drag is hovering over it.
function _attachDropTarget(elNode, destDir) {
  if (!elNode || !destDir) return;
  elNode.addEventListener('dragover', (e) => {
    // Only accept our internal MIME type; ignore OS file drops.
    if (Array.from(e.dataTransfer.types || []).includes('application/x-minimax-fb')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      elNode.classList.add('fb-drop-target');
    }
  });
  elNode.addEventListener('dragleave', () => {
    elNode.classList.remove('fb-drop-target');
  });
  elNode.addEventListener('drop', async (e) => {
    e.preventDefault();
    elNode.classList.remove('fb-drop-target');
    const path = e.dataTransfer.getData('application/x-minimax-fb');
    if (!path) return;
    if (path.toLowerCase() === destDir.toLowerCase()) return;
    // Refuse to move a folder into itself or any descendant.
    const pLow = path.replace(/[\\/]+$/, '').toLowerCase();
    const dLow = destDir.replace(/[\\/]+$/, '').toLowerCase();
    if (dLow.startsWith(pLow + (destDir.includes('\\') ? '\\' : '/'))) {
      toast('Cannot move a folder into itself.', 'warn');
      return;
    }
    const r = await window.api.fbMove(path, destDir);
    if (r.ok) {
      toast('Moved.', 'ok');
      await refreshBrowser();
    } else {
      toast('Move failed: ' + (r.error || 'unknown error'), 'err');
    }
  });
}

function renderFbList(items) {
  const ul = $('#fb-list');
  ul.innerHTML = '';
  // Show ".. (up)" whenever we're inside a real subdir of the output root.
  const outRoot = state.config.output_dir || '';
  if (state.fbDir && outRoot && state.fbDir.toLowerCase() !== outRoot.toLowerCase()) {
    const parent = el('li', { class: 'fb-item' }, [
      el('span', { class: 'icon' }, '↩'),
      el('span', { class: 'name' }, '.. (up)'),
    ]);
    parent.addEventListener('click', () => {
      // Go up one level
      const sep = state.fbDir.includes('\\') ? '\\' : '/';
      const parts = state.fbDir.split(/[\\/]/).filter(Boolean);
      parts.pop();
      state.fbDir = parts.join(sep) || outRoot;
      refreshBrowser();
    });
    // Drop a file on ".." to move it into the parent dir.
    const _parentDir = parentDir(state.fbDir) || outRoot;
    _attachDropTarget(parent, _parentDir);
    ul.appendChild(parent);
  } else if (state.fbDir && outRoot && state.fbDir.toLowerCase() === outRoot.toLowerCase()) {
    // At the output root, but allow one "Open in Explorer" hint as a no-op row? Skip.
  }
  for (const it of items) {
    const li = el('li', { class: 'fb-item', 'data-path': it.path, 'data-isdir': it.isDir ? '1' : '0', 'data-name': it.name, draggable: it.isDir ? 'false' : 'true' }, [
      el('span', { class: 'icon' }, it.isDir ? '📁' : iconForFile(it.ext)),
      el('span', { class: 'name', title: it.name }, it.name),
      el('span', { class: 'size' }, it.isDir ? '' : humanSize(it.size)),
    ]);
    li.addEventListener('click', (e) => {
      $$('.fb-item', ul).forEach((n) => n.classList.remove('selected'));
      li.classList.add('selected');
      state._selected = it;
      // Single-click on an image: also push it into the bottom-right
      // Picture preview pane so the user gets immediate visual feedback
      // without having to double-click first. Audio/text still need
      // double-click to open in the tab preview (they need a real
      // <audio> / <pre> element which lives inside a tab).
      if (!it.isDir && ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(it.ext)) {
        previewImageFromFile(it.path);
      }
    });
    li.addEventListener('dblclick', () => openItem(it));
    // Drag-and-drop: dragging a file over a folder moves it there. We do NOT
    // expose the actual native file path (Electron doesn't allow it), so the
    // drag is internal to the app. We use a custom MIME type so external
    // drops are ignored.
    if (!it.isDir) {
      li.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/x-minimax-fb', it.path);
        e.dataTransfer.effectAllowed = 'move';
      });
    }
    // Folders accept drops: dropping a file onto a folder moves it inside.
    if (it.isDir) {
      _attachDropTarget(li, it.path);
    }
    li.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      $$('.fb-item', ul).forEach((n) => n.classList.remove('selected'));
      li.classList.add('selected');
      state._selected = it;
      showItemContextMenu(it, e.clientX, e.clientY);
    });
    ul.appendChild(li);
  }
}

function iconForFile(ext) {
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(ext)) return '🖼';
  if (['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.opus', '.pcm'].includes(ext)) return '🎵';
  if (['.mp4', '.mov', '.webm', '.mkv'].includes(ext)) return '🎬';
  if (['.srt', '.txt', '.json', '.md'].includes(ext)) return '📄';
  return '📄';
}

function humanSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

async function openItem(it) {
  // Defensive: items from the FS list always have {path, ext, isDir}, but
  // a future caller might pass a partial object. Bail out cleanly instead
  // of dereferencing undefined and getting a confusing stack trace.
  if (!it || !it.path) { toast('Invalid file item.', 'err'); return; }
  if (it.isDir) {
    state.fbDir = it.path;
    await refreshBrowser();
  } else if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(it.ext)) {
    previewImageFromFile(it.path);
  } else if (['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.opus', '.pcm'].includes(it.ext)) {
    previewAudioFromFile(it.path);
  } else if (['.txt', '.srt', '.json', '.md', '.lrc'].includes(it.ext)) {
    previewTextFromFile(it.path);
  } else {
    await window.api.fbReveal(it.path);
  }
}

function previewImageFromFile(p) {
  // Images from the file browser go to the new Picture preview pane
  // (bottom-right of the log bar), not the tab's generation preview.
  // The tab's generation preview is reserved for content that the user
  // just generated. We pre-load the image to grab the natural dimensions
  // so the overlay has the right size info, and so the title hint shows.
  const url = fileUrl(p);
  const filename = (p || '').split(/[\\/]/).pop() || 'image';
  const preLoad = new Image();
  preLoad.onload = () => updatePreviewPane(url, filename, preLoad.naturalWidth, preLoad.naturalHeight);
  preLoad.onerror = () => updatePreviewPane(url, filename, 0, 0);
  preLoad.src = url;
}

// Render the file-browser image into the new Picture preview pane.
// The image is fit-to-content (object-fit: contain in the CSS) so a
// 4K screenshot is shown shrunken and a tiny icon stays at its natural
// size — both rendered completely, no cropping. Clicking the image
// (or the filename) opens the image overlay at 1:1 mode.
function updatePreviewPane(src, filename, naturalWidth, naturalHeight) {
  const content = $('#fb-preview-content');
  if (!content) return;
  content.innerHTML = '';
  const size = (naturalWidth && naturalHeight) ? ` (${naturalWidth}×${naturalHeight})` : '';
  const img = el('img', {
    src,
    alt: filename || '',
    title: (filename || '') + size + ' — click to view 1:1',
  });
  img.addEventListener('click', () => {
    openImageOverlay(src, filename, naturalWidth, naturalHeight);
  });
  content.appendChild(img);
  const fname = el('div', { class: 'preview-pane-filename', title: filename || '' },
    (filename || '') + size);
  content.appendChild(fname);
}

function previewAudioFromFile(p) {
  const root = $(`#tab-${state.currentTab} .preview`);
  if (!root) return;
  const url = fileUrl(p);
  root.innerHTML = '';
  root.appendChild(el('audio', { controls: '', src: url }));
  root.appendChild(el('div', { class: 'meta' }, p));
}

async function previewTextFromFile(p) {
  const root = $(`#tab-${state.currentTab} .preview`);
  if (!root) return;
  const r = await window.api.fbRead(p);
  root.innerHTML = '';
  if (!r.ok) { root.innerHTML = '<div class="empty">Cannot read: ' + escapeHtml(r.error) + '</div>'; return; }
  // Decode base64 → binary string → UTF-8 text. Plain `atob` only gives a
  // Latin-1 binary string, which mangles non-ASCII characters. TextDecoder
  // with {fatal: false} replaces invalid sequences with U+FFFD instead of
  // throwing, so partially-decodable files still display.
  let txt = '';
  try {
    const bin = atob(r.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    txt = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch (_) {
    // Fallback to the old (Latin-1-ish) decoding if TextDecoder is missing
    txt = atob(r.base64);
  }
  const pre = el('pre', { class: 'meta', style: 'white-space: pre-wrap; max-height: 60vh; overflow: auto;' }, txt);
  root.appendChild(pre);
  root.appendChild(el('div', { class: 'meta' }, p));
}

// In-app clipboard for the file browser. The OS clipboard is shared via the
// browser's native copy/paste (Ctrl+C / Ctrl+X / Ctrl+V on selected items),
// but the in-app file ops use this list so we can track cut vs. copy
// semantics and undo a paste on failure.
let _fbClipboard = null; // { op: 'copy' | 'cut', paths: string[] }

function fbClipboardCopy(paths) {
  _fbClipboard = { op: 'copy', paths: paths.slice() };
  toast(`Copied ${paths.length} item${paths.length === 1 ? '' : 's'} to clipboard.`, 'ok', 1500);
}
function fbClipboardCut(paths) {
  _fbClipboard = { op: 'cut', paths: paths.slice() };
  toast(`Cut ${paths.length} item${paths.length === 1 ? '' : 's'} to clipboard.`, 'ok', 1500);
}
async function fbClipboardPaste(destDir) {
  if (!_fbClipboard || !_fbClipboard.paths.length) {
    toast('Clipboard is empty.', 'warn'); return;
  }
  if (!destDir) { toast('No destination folder selected.', 'err'); return; }
  const op = _fbClipboard.op;
  const src = _fbClipboard.paths;
  let ok = 0, fail = 0, skipped = 0;
  for (const p of src) {
    // Refuse to copy/cut a folder into itself or any of its descendants.
    const pLow = p.replace(/[\\/]+$/, '').toLowerCase();
    const dLow = destDir.replace(/[\\/]+$/, '').toLowerCase();
    if (pLow === dLow || dLow.startsWith(pLow + (destDir.includes('\\') ? '\\' : '/'))) {
      toast('Skipped: cannot paste a folder into itself.', 'warn');
      skipped++;
      continue;
    }
    if (op === 'cut') {
      // Move: prefer fbMove (handles clobber auto-rename in the main process)
      const r = await window.api.fbMove(p, destDir);
      if (r.ok) ok++; else fail++;
    } else {
      // Copy: read + write via the main process. We don't have a fbCopy
      // yet; fall back to reading + writing a file at a time. For folders,
      // skip with a warning (the main process doesn't recurse-copy).
      const r = await window.api.fbCopy(p, destDir).catch(() => null);
      if (r && r.ok) ok++;
      else if (r && r.error) { toast(r.error, 'err'); fail++; }
      else { toast('Copy not supported for this item.', 'err'); fail++; }
    }
  }
  toast(`${op === 'cut' ? 'Moved' : 'Copied'} ${ok}${fail ? `, ${fail} failed` : ''}${skipped ? `, ${skipped} skipped` : ''}.`,
        fail ? 'warn' : 'ok');
  if (op === 'cut' && ok) _fbClipboard = null;
  await refreshBrowser();
}

function showItemContextMenu(it, x, y) {
  showModal((m, close) => {
    m.appendChild(el('h2', {}, it.name));
    m.appendChild(el('div', { class: 'meta', style: 'margin-bottom: 8px; color: var(--fg-2);' }, it.path));

    // File-info block. Always shown. Lists the type, size, modified
    // time, and (for images) the natural resolution. Resolution
    // has to be decoded from the file, so we render a "detecting…"
    // placeholder first and fill it in once loadImageFromFile
    // resolves.
    const isImage = !it.isDir && ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(it.ext);
    const info = el('div', { class: 'fb-item-info' });
    if (it.isDir) {
      info.appendChild(el('div', { class: 'fb-info-row' }, [
        el('span', { class: 'fb-info-key' }, 'Type'),
        el('span', {}, 'Folder'),
      ]));
    } else {
      const extLabel = (it.ext || '').replace('.', '').toUpperCase() || 'file';
      info.appendChild(el('div', { class: 'fb-info-row' }, [
        el('span', { class: 'fb-info-key' }, 'Type'),
        el('span', {}, extLabel),
      ]));
      info.appendChild(el('div', { class: 'fb-info-row' }, [
        el('span', { class: 'fb-info-key' }, 'Size'),
        el('span', {}, humanSize(it.size || 0)),
      ]));
      info.appendChild(el('div', { class: 'fb-info-row' }, [
        el('span', { class: 'fb-info-key' }, 'Modified'),
        el('span', {}, formatDate(it.mtimeMs)),
      ]));
      if (isImage) {
        const dimCell = el('div', { class: 'fb-info-row' }, [
          el('span', { class: 'fb-info-key' }, 'Dimensions'),
          el('span', { class: 'fb-info-dim' }, 'detecting…'),
        ]);
        info.appendChild(dimCell);
        loadImageFromFile(it.path).then((img) => {
          const dim = dimCell.querySelector('.fb-info-dim');
          if (!dim) return;
          if (img.naturalWidth && img.naturalHeight) {
            dim.textContent = `${img.naturalWidth} × ${img.naturalHeight} px`;
          } else {
            dim.textContent = 'unknown';
          }
        }).catch(() => {
          const dim = dimCell.querySelector('.fb-info-dim');
          if (dim) dim.textContent = 'unreadable';
        });
      }
    }
    m.appendChild(info);

    const row1 = el('div', { class: 'row' }, [el('div', {}, el('button', { class: 'btn-mini', onclick: async () => { close(); await openItem(it); } }, 'Open / Preview'))]);
    const row2 = el('div', { class: 'row' }, [el('div', {}, el('button', { class: 'btn-mini', onclick: async () => { close(); await window.api.fbReveal(it.path); } }, 'Reveal in Explorer'))]);
    // Image-pipeline items: Upscale / Crop / Convert. Only show for
    // supported image types, in the order the user expects (transform
    // first, then format).
    let nextRow = 3;
    const rows = [];
    if (isImage) {
      const rU = el('div', { class: 'row' }, [el('div', {}, el('button', { class: 'btn-mini', onclick: () => { close(); showUpscaleDirect(it.path); } }, '🔍 Upscale…'))]);
      const rC = el('div', { class: 'row' }, [el('div', {}, el('button', { class: 'btn-mini', onclick: () => { close(); showCropOverlay(it.path); } }, '✂ Crop…'))]);
      const rF = el('div', { class: 'row' }, [el('div', {}, el('button', { class: 'btn-mini', onclick: () => { close(); showConvertOverlay(it.path); } }, '⇄ Convert format…'))]);
      rows.push(rU, rC, rF);
    }
    rows.push(el('div', { class: 'row' }, [el('div', {}, el('button', { class: 'btn-mini', onclick: () => { close(); fbClipboardCopy([it.path]); } }, 'Copy'))]));
    rows.push(el('div', { class: 'row' }, [el('div', {}, el('button', { class: 'btn-mini', onclick: () => { close(); fbClipboardCut([it.path]); } }, 'Cut'))]));
    rows.push(el('div', { class: 'row' }, [el('div', {}, el('button', { class: 'btn-mini', onclick: () => { close(); promptRename(it); } }, 'Rename…'))]));
    rows.push(el('div', { class: 'row' }, [el('div', {}, el('button', { class: 'btn-mini', onclick: () => { close(); promptMove(it); } }, 'Move to…'))]));
    rows.push(el('div', { class: 'row' }, [el('div', {}, el('button', { class: 'btn-mini', onclick: async () => { close(); await fbClipboardPaste(state.fbDir); } }, 'Paste here'))]));
    rows.push(el('div', { class: 'row' }, [el('div', {}, el('button', { class: 'btn-mini danger', onclick: () => { close(); confirmDelete(it); } }, 'Delete'))]));
    m.append(...rows);
    const footer = el('div', { class: 'footer' }, el('button', { class: 'btn-mini', onclick: close }, 'Close'));
    m.appendChild(footer);
  });
}

// Format a mtimeMs timestamp as a human-readable local string.
// Returns "—" for null / NaN / 0 (we treat 0 as "no timestamp",
// which happens for some FS drivers that don't expose mtime).
function formatDate(ms) {
  if (!ms || typeof ms !== 'number') return '—';
  const d = new Date(ms);
  if (isNaN(d.getTime())) return '—';
  // YYYY-MM-DD HH:MM in the user's local timezone. Locale-agnostic
  // on purpose so two users in different regions see the same text
  // in a shared screenshot.
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
       + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function promptRename(it) {
  showModal((m, close) => {
    m.appendChild(el('h2', {}, 'Rename'));
    const inp = el('input', { type: 'text', value: it.name });
    m.appendChild(el('div', { class: 'row' }, [el('label', {}, 'New name'), inp]));
    const ok = el('button', { class: 'primary' }, 'Rename');
    const cancel = el('button', { onclick: close }, 'Cancel');
    ok.addEventListener('click', async () => {
      const newName = inp.value.trim();
      if (!newName) { toast('Name is required.', 'warn'); return; }
      if (newName === it.name) { close(); return; }
      const r = await window.api.fbRename(it.path, newName);
      if (!r.ok) { toast('Rename failed: ' + r.error, 'err'); return; }
      toast('Renamed.', 'ok');
      await refreshBrowser();
      close();
    });
    m.appendChild(el('div', { class: 'footer' }, [cancel, ok]));
  });
}

async function promptMove(it) {
  const dest = await window.api.pickFolder();
  if (!dest) return;
  const r = await window.api.fbMove(it.path, dest);
  if (!r.ok) toast(r.error, 'err'); else { toast('Moved.', 'ok'); await refreshBrowser(); }
}

async function confirmDelete(it) {
  showModal((m, close) => {
    m.appendChild(el('h2', {}, 'Delete ' + (it.isDir ? 'folder' : 'file') + '?'));
    m.appendChild(el('p', {}, it.path));
    if (it.isDir) m.appendChild(el('p', { style: 'color: var(--danger);' }, 'This will recursively delete the folder and all its contents.'));
    const ok = el('button', { class: 'danger' }, 'Delete');
    const cancel = el('button', { onclick: close }, 'Cancel');
    ok.addEventListener('click', async () => {
      const r = await window.api.fbDelete(it.path);
      if (!r.ok) toast(r.error, 'err'); else { toast('Deleted.', 'ok'); await refreshBrowser(); }
      close();
    });
    m.appendChild(el('div', { class: 'footer' }, [cancel, ok]));
  });
}

async function promptNewFolder() {
  const dir = state.fbDir || state.config.output_dir || '';
  if (!dir) { toast('No output directory set. Configure in Settings.', 'warn'); return; }
  showModal((m, close) => {
    m.appendChild(el('h2', {}, 'New folder'));
    const inp = el('input', { type: 'text', value: 'New folder' });
    m.appendChild(el('div', { class: 'row' }, [el('label', {}, 'Folder name'), inp]));
    m.appendChild(el('div', { class: 'footer' }, [
      el('button', { onclick: close }, 'Cancel'),
      el('button', { class: 'primary', onclick: async () => {
        const name = inp.value.trim();
        if (!name) { toast('Folder name is required.', 'warn'); return; }
        const r = await window.api.fbMkdir(dir, name);
        if (!r.ok) { toast('Create failed: ' + r.error, 'err'); return; }
        toast('Created.', 'ok');
        await refreshBrowser();
        close();
      } }, 'Create'),
    ]));
  });
}

// ----------------- Quota -----------------
// The mmx CLI quota endpoint returns a list of "model_remains" entries.
// Each model has BOTH a daily interval AND a weekly quota:
//   - current_interval_total_count / current_interval_usage_count
//   - current_interval_remaining_percent  (sometimes 100% when counts=0/0 even
//     when the model is not in plan — see MiniMax-AI/cli#173)
//   - current_interval_status   (1 = in plan, 3 = not in plan)
//   - current_weekly_total_count / current_weekly_usage_count
//   - current_weekly_remaining_percent
//   - current_weekly_status
//
// Old display logic showed "X% this week" and called anything with total=0
// "not in plan" — but the *_status field is the source of truth, AND for
// some models (e.g. video) the *daily* interval is what matters. We now:
//   - use *_status to decide plan inclusion
//   - show BOTH daily + weekly segments when both have non-zero totals
//   - compute used/total % ourselves (the API's *_remaining_percent is
//     unreliable, e.g. reports 100% remaining for 0/0 when status=3)
function _quotaSeg(name, used, total, label) {
  if (!total || total <= 0) return '';
  const remaining = Math.max(0, total - used);
  const usedPct = Math.round((used / total) * 100);
  const cls = usedPct >= 90 ? 'quota-low' : (usedPct >= 50 ? 'quota-warn' : '');
  return `<span class="${cls}" title="${escapeHtml(`${name} · ${label}: ${used}/${total} (${usedPct}% used)`)}">${used}/${total} ${label} <small>(${usedPct}%)</small></span>`;
}
function _formatQuotaModel(m) {
  const name = m.model_name || m.name || m.model || '?';
  // All values are rendered into innerHTML below — escape to avoid XSS via a
  // hostile model name returned by the API.
  const e = (s) => escapeHtml(String(s == null ? '' : s));
  // mmx quota fields have changed between versions. Read them with a few
  // aliases so we survive both old and new shapes.
  const iTotal = m.current_interval_total_count ?? m.interval_total ?? m.daily_total ?? 0;
  const iUsed  = m.current_interval_usage_count ?? m.interval_used ?? m.daily_used ?? 0;
  const iStatus = m.current_interval_status ?? m.interval_status ?? m.daily_status;
  const iPct    = m.current_interval_remaining_percent ?? m.interval_remaining_percent ?? m.daily_remaining_percent;
  const wTotal = m.current_weekly_total_count ?? m.weekly_total ?? 0;
  const wUsed  = m.current_weekly_usage_count ?? m.weekly_used ?? 0;
  const wStatus = m.current_weekly_status ?? m.weekly_status;
  const wPct    = m.current_weekly_remaining_percent ?? m.weekly_remaining_percent;
  // "Not in plan" only when BOTH statuses are explicitly 3. (The previous
  // version also matched `null`, which mis-classified every model that
  // didn't return a status field — that's why the user saw "general: not
  // in plan" even though generations worked.) The remaining_percent fields
  // are then used as a fallback so the user still sees *something* useful.
  const explicitlyNotInPlan =
    (iStatus === 3) && (wStatus === 3);
  if (explicitlyNotInPlan) {
    return `<span class="quota-not-in-plan">${e(name)}: not in plan</span>`;
  }
  const parts = [];
  // Daily interval (e.g. "today"): only when there's a non-zero total
  if (iTotal && iTotal > 0) parts.push(_quotaSeg(name, iUsed || 0, iTotal, 'today'));
  // Weekly: only when there's a non-zero total
  if (wTotal && wTotal > 0) parts.push(_quotaSeg(name, wUsed || 0, wTotal, 'week'));
  if (parts.length === 0) {
    // In plan but no counts (e.g. general returned 0/0 with status=1).
    // Fall back to the *_remaining_percent field (note: this is "remaining"
    // percent — invert it to show "used" percent, which the user expects).
    const segs = [];
    if (iPct != null) {
      const usedPct = 100 - iPct;
      const cls = usedPct >= 90 ? 'quota-low' : (usedPct >= 50 ? 'quota-warn' : '');
      segs.push(`<span class="${cls}">${iPct}% today <small>(${usedPct}% used)</small></span>`);
    }
    if (wPct != null) {
      const usedPct = 100 - wPct;
      const cls = usedPct >= 90 ? 'quota-low' : (usedPct >= 50 ? 'quota-warn' : '');
      segs.push(`<span class="${cls}">${wPct}% week <small>(${usedPct}% used)</small></span>`);
    }
    if (segs.length === 0) {
      // We have a model entry but no usable data. Show it as in-plan with
      // a hint so the user knows we got something, just no counters.
      return `<span class="quota-in-plan">${e(name)}: in plan</span>`;
    }
    return `<span class="quota-in-plan">${e(name)}:</span> ${segs.join(' · ')}`;
  }
  return parts.join(' · ');
}
async function refreshQuota() {
  const el2 = $('#quota-value');
  el2.innerHTML = '<span class="spinner"></span>';
  const r = await window.api.quota();
  if (!r.ok) { el2.textContent = r.error || '—'; return; }
  // The mmx CLI has returned the quota in a few different shapes depending
  // on the version. Try the documented one first (`model_remains` at root
  // or under `data`), then fall back to other common shapes.
  const data = r.parsed;
  let models = null;
  if (data) {
    if (Array.isArray(data.model_remains)) models = data.model_remains;
    else if (Array.isArray(data.models)) models = data.models;
    else if (Array.isArray(data.data && data.data.model_remains)) models = data.data.model_remains;
    else if (Array.isArray(data.quota)) models = data.quota;
  }
  if (!models || !models.length) {
    // No recognizable models — log the raw response so the user can see
    // exactly what the API is returning (helps diagnose shape changes
    // between mmx-cli versions). Truncate to keep the log readable.
    try {
      const raw = JSON.stringify(data).slice(0, 4000);
      log(`[quota] unexpected response shape — raw: ${raw}${raw.length >= 4000 ? '…' : ''}`);
    } catch (_) { /* ignore circular refs etc. */ }
    el2.textContent = 'no data';
    return;
  }
  const parts = models.map(_formatQuotaModel);
  el2.innerHTML = parts.join(' · ');
}

// ----------------- Settings -----------------
function openSettings() {
  showModal((m, close) => {
    m.appendChild(el('h2', {}, 'Settings'));
    m.appendChild(el('p', { style: 'color: var(--fg-2); font-size: 12px;' }, 'Config is stored in config.txt next to the executable. API key is never embedded in the binary.'));

    const apiInput = el('input', { type: 'text', value: state.config.api_key || '' });
    const outInput = el('input', { type: 'text', value: state.config.output_dir || '', placeholder: '(default: ./generated/)' });
    const regInput = el('select', {});
    for (const r of ['global', 'cn']) regInput.appendChild(el('option', { value: r }, r));
    regInput.value = state.config.region || 'global';

    m.appendChild(el('div', { class: 'row' }, [el('label', {}, 'API key (MiniMax Token Plan)'), apiInput]));
    m.appendChild(el('div', { class: 'row' }, [
      el('label', {}, 'Output directory'),
      el('div', { class: 'combo' }, [outInput, el('button', { class: 'btn-mini', onclick: async () => { const p = await window.api.pickFolder(); if (p) outInput.value = p; } }, 'Browse…')]),
    ]));
    m.appendChild(el('div', { class: 'row' }, [el('label', {}, 'Region'), regInput]));

    // Keyboard shortcuts reference
    const shortcutsBox = el('div', { class: 'shortcuts-box' });
    shortcutsBox.appendChild(el('h4', {}, '⌨ Keyboard shortcuts'));
    const shortcuts = [
      ['Ctrl+Enter', 'Generate on the active tab'],
      ['Ctrl+1 / 2 / 3 / 4', 'Switch to Image / Speech / Music / Video'],
      ['Ctrl+B', 'Open BatchGen for the active tab'],
      ['Ctrl+T', 'Open Style Settings'],
      ['Ctrl+S', 'Open this Settings dialog'],
      ['Ctrl+L', 'Toggle dark / light mode'],
      ['Ctrl+F', 'Focus the file-browser filter'],
      ['Ctrl+R', 'Refresh quota'],
    ];
    for (const [keys, desc] of shortcuts) {
      const row = el('div', { class: 'shortcut-row' }, [
        el('kbd', {}, keys),
        el('span', {}, desc),
      ]);
      shortcutsBox.appendChild(row);
    }
    m.appendChild(shortcutsBox);

    const cp = el('div', { class: 'row' }, [el('label', {}, 'Config file'), el('input', { type: 'text', value: '', readonly: '' })]);
    window.api.configPath().then((p) => { cp.querySelector('input').value = p; });
    m.appendChild(cp);

    const test = el('button', { class: 'btn-mini' }, 'Test connection');
    const diag = el('button', { class: 'btn-mini' }, 'Diagnose');
    const save = el('button', { class: 'primary' }, 'Save');
    const cancel = el('button', { onclick: close }, 'Cancel');
    test.addEventListener('click', async () => {
      test.disabled = true; test.innerHTML = '<span class="spinner"></span> Testing…';
      const r = await window.api.authStatus();
      test.disabled = false; test.textContent = 'Test connection';
      if (r.ok) {
        toast((r.message || 'Authentication OK.') + (r.command ? `  (via ${r.command})` : ''), 'ok', 4000);
      } else {
        toast('Auth failed: ' + (r.error || 'unknown error'), 'err', 6000);
      }
    });
    diag.addEventListener('click', async () => { showDiagnose(); });
    save.addEventListener('click', async () => {
      // CRITICAL: merge with the current config — do NOT replace it. The
      // previous version of this code built a fresh {api_key,output_dir,region}
      // object which silently dropped `theme` and `styles` on every save.
      const cfg = {
        ...state.config,
        api_key: apiInput.value.trim(),
        output_dir: outInput.value.trim(),
        region: regInput.value || 'global',
      };
      state.config = await window.api.setConfig(cfg);
      toast('Saved.', 'ok');
      close();
      refreshQuota();
      refreshBrowser();
    });
    m.appendChild(el('div', { class: 'footer' }, [cancel, test, diag, save]));
  });

  // After the main settings popup is built, append a "Image
  // upscaling" section with Real-ESRGAN status + re-detect + model
  // selector. This is a second showModal call layered on top of the
  // outer one — the renderer's modal stack handles Esc to close the
  // topmost first, so the user gets a clean back-out.
  showRealesrganSettings();
}

// ----------------- Real-ESRGAN settings -----------------
// A second modal layer inside ⚙ Settings, on top of the regular
// settings popup. Shows: status (detected / not found / version),
// a Re-detect button (re-runs the IPC probe in case the user
// installed the binary after launch), and a model selector. The
// model choice is persisted to state.json via scheduleStateSave.
function showRealesrganSettings() {
  showModal(async (m, close) => {
    m.classList.add('realesrgan-settings-modal');
    m.appendChild(el('h2', {}, 'Image upscaling'));
    m.appendChild(el('p', { style: 'color: var(--fg-2); font-size: 12px; margin-top: 0;' },
      'The built-in pipeline (multi-step createImageBitmap) is always available. Real-ESRGAN (BSD-3-Clause) gives noticeably better detail when the binary is installed.'));

    // Status row. We probe once on open, then a "Re-detect" button
    // re-runs the probe.
    const statusText = el('div', { class: 're-status' }, 'Detecting…');
    const reBtn = el('button', { class: 'btn-mini' }, 'Re-detect');
    m.appendChild(el('div', { class: 'row' }, [
      el('label', {}, 'Real-ESRGAN status'), statusText, reBtn,
    ]));

    // Model selector — same four canonical model names as the
    // REAL_ESRGAN_MODELS whitelist in upscaleImageFileRealesrgan.
    const modelSel = el('select', {});
    for (const [val, lbl] of [
      ['realesrgan-x4plus', 'realesrgan-x4plus  (general-purpose 4×, default)'],
      ['realesrgan-x4plus-anime', 'realesrgan-x4plus-anime  (anime / illustration)'],
      ['realesrgan-animevideov3', 'realesrgan-animevideov3  (video frames)'],
      ['realesr-general-x4v3', 'realesr-general-x4v3  (latest general, smaller)'],
    ]) {
      const opt = el('option', { value: val }, lbl);
      if (val === (state.realesrganModel || 'realesrgan-x4plus')) opt.selected = true;
      modelSel.appendChild(opt);
    }
    modelSel.addEventListener('change', () => {
      state.realesrganModel = modelSel.value;
      scheduleStateSave();
    });
    m.appendChild(el('div', { class: 'row' }, [
      el('label', {}, 'Model'), modelSel,
    ]));

    async function refreshStatus() {
      statusText.textContent = 'Detecting…';
      try {
        const r = await window.api.realesrganAvailable();
        if (r && r.available) {
          statusText.textContent = 'Detected: ' + (r.binaryPath || '') +
            (r.version ? '  (v' + r.version + ')' : '');
          statusText.style.color = 'var(--success)';
        } else {
          statusText.textContent = 'Not found. Download realesrgan-ncnn-vulkan and drop the binary into ./bin/ (or onto PATH). See README for the link.';
          statusText.style.color = 'var(--fg-2)';
        }
      } catch (e) {
        statusText.textContent = 'Probe failed: ' + (e.message || e);
        statusText.style.color = 'var(--danger)';
      }
    }
    reBtn.addEventListener('click', () => { refreshStatus(); });
    refreshStatus();

    m.appendChild(el('div', { class: 'footer' }, [
      el('button', { class: 'primary', onclick: close }, 'Done'),
    ]));
  });
}

function showDiagnose() {
  showModal(async (m, close) => {
    m.appendChild(el('h2', {}, 'Diagnose mmx setup'));
    m.appendChild(el('p', { style: 'color: var(--fg-2); font-size: 12px; margin-top: 0;' },
      'This shows what the app sees on your machine. Useful when "Test connection" fails.'));
    const box = el('pre', { style: 'background: var(--bg-3); padding: 10px; border-radius: var(--radius); font-size: 12px; white-space: pre-wrap; max-height: 50vh; overflow: auto;' }, 'Loading…');
    m.appendChild(box);

    const d = await window.api.diagnose();
    const lines = [
      `Platform:               ${d.platform}`,
      `Electron version:       ${d.electronVersion}`,
      `Node version:           ${d.nodeVersion}`,
      `Detected node.exe:      ${d.nodePath || '(NOT FOUND)'}`,
      `Detected mmx-cli entry: ${d.mmxEntry || '(NOT FOUND)'}`,
      `Region:                 ${d.region || 'global'}`,
      `API key present:        ${d.apiKeyPresent ? 'yes' : 'no'}`,
      `API key length:         ${d.apiKeyLength} chars`,
      '',
      d.error ? `⚠ ${d.error}` : '✓ All mmx prerequisites found.',
    ];
    box.textContent = lines.join('\n');

    if (d.nodePath && d.mmxEntry) {
      // Also run a real test
      const test = el('button', { class: 'btn-mini' }, 'Run real mmx quota test');
      m.appendChild(el('div', { style: 'margin-top: 12px;' }, test));
      const out = el('pre', { style: 'background: var(--bg-3); padding: 10px; border-radius: var(--radius); font-size: 12px; white-space: pre-wrap; max-height: 200px; overflow: auto; margin-top: 8px; display: none;' });
      m.appendChild(out);
      test.addEventListener('click', async () => {
        test.disabled = true; test.innerHTML = '<span class="spinner"></span> Running…';
        out.style.display = 'block';
        out.textContent = 'Calling mmx quota --output json…\n';
        const r = await window.api.authStatus();
        out.textContent += `exit code: ${r.code ?? 'n/a'}\n`;
        out.textContent += `ok flag:   ${r.ok}\n`;
        out.textContent += `error:     ${r.error || '(none)'}\n`;
        out.textContent += `command:   ${r.command || '(none)'}\n`;
        if (r.argv) out.textContent += `argv:      ${r.argv.join(' ')}\n`;
        test.disabled = false; test.textContent = 'Run real mmx quota test';
      });
    }

    m.appendChild(el('div', { class: 'footer' }, el('button', { onclick: close }, 'Close')));
  });
}

// ----------------- Style Settings modal -----------------
// (Style dropdown refresh moved next to refreshTabStatusDots — it now
// queries the DOM by class instead of tracking a Set of references, so
// detached dropdowns are never iterated and there's no leak.)

function _currentManualText() {
  // Grab the current tab's manual prompt textarea value
  const tab = state.currentTab;
  const root = $(`#tab-${tab}`);
  if (!root) return '';
  const ta = root.querySelector('textarea');
  return ta ? ta.value.trim() : '';
}

function openStyleSettings(returnToTab) {
  showModal((m, close) => {
    m.appendChild(el('h2', {}, 'Style Settings'));
    m.appendChild(el('p', { style: 'color: var(--fg-2); font-size: 12px; margin-top: 0;' },
      'Stored in config.txt → [styles] section. Each preset is prepended (with a comma) to your manual prompt. Example: a preset "Pixel Art Berlin" with value "Pixel art, neon red lighting" + manual input "Berliner Straßenkiller" → "Pixel art, neon red lighting, Berliner Straßenkiller".'));

    const ul = el('ul', { class: 'style-list' });
    function renderList() {
      ul.innerHTML = '';
      const styles = state.config.styles || [];
      if (!styles.length) {
        ul.appendChild(el('li', { class: 'empty-row' }, 'No styles yet. Add one below, or click "Save current as style".'));
        return;
      }
      styles.forEach((s, i) => {
        const actions = el('div', { class: 'sactions' }, [
          el('button', { class: 'btn-mini', onclick: () => { editStyle(i, returnToTab); } }, '✎'),
          el('button', { class: 'btn-mini danger', onclick: () => { deleteStyle(i, () => { renderList(); }); } }, '✕'),
        ]);
        const li = el('li', {}, [
          el('div', {}, [
            el('div', { class: 'sname' }, s.name),
            el('div', { class: 'sval' }, s.value),
          ]),
          actions,
        ]);
        ul.appendChild(li);
      });
    }
    renderList();
    m.appendChild(ul);

    // New / Edit form
    const editingIdx = { value: -1 };
    const nameInput = el('input', { type: 'text', placeholder: 'Style name (e.g. "Pixel Art Berlin")' });
    const valInput = el('textarea', { placeholder: 'Style value — the text that gets prepended to your prompt (e.g. "Pixel art, neon red lighting, dramatic shadows")' });
    valInput.style.minHeight = '70px';
    const formHeader = el('h3', { style: 'margin: 14px 0 6px; font-size: 13px;' }, 'Add / edit style');
    m.appendChild(formHeader);
    m.appendChild(el('div', { class: 'row' }, [el('label', {}, 'Name'), nameInput]));
    m.appendChild(el('div', { class: 'row' }, [el('label', {}, 'Value (prepended to your prompt)'), valInput]));

    function editStyle(i, tabKey) {
      const s = (state.config.styles || [])[i];
      if (!s) return;
      editingIdx.value = i;
      nameInput.value = s.name;
      valInput.value = s.value;
      // jump to the right tab to remind the user which context
      if (tabKey && tabKey !== state.currentTab) showTab(tabKey);
      nameInput.focus();
    }
    function deleteStyle(i, after) {
      const styles = state.config.styles || [];
      if (i < 0 || i >= styles.length) return;
      const removed = styles.splice(i, 1)[0];
      persistStyles().then(() => { _refreshAllStyleDropdowns(); after && after(); toast(`Removed "${removed.name}".`, 'ok'); });
    }
    async function persistStyles() {
      state.config.styles = state.config.styles || [];
      await window.api.setConfig(state.config);
    }

    const saveBtn = el('button', { class: 'primary' }, 'Save style');
    const saveCurrentBtn = el('button', {}, 'Save current prompt as style…');
    const cancelBtn = el('button', { onclick: close }, 'Close');

    saveBtn.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      const value = valInput.value.trim();
      if (!name) { toast('Name is required.', 'warn'); return; }
      if (!value) { toast('Value is required.', 'warn'); return; }
      // Reject names that contain '=' — the config.txt format uses the first
      // '=' on each line to split name/value, so a name with '=' would
      // silently break the round-trip.
      if (name.includes('=')) {
        toast('Style name cannot contain "=" (would break config parsing).', 'err');
        return;
      }
      const styles = state.config.styles || [];
      if (editingIdx.value >= 0) styles[editingIdx.value] = { name, value };
      else {
        // de-dupe by name
        const existing = styles.findIndex((s) => s.name === name);
        if (existing >= 0) {
          if (!confirm(`A style named "${name}" already exists. Overwrite?`)) return;
          styles[existing] = { name, value };
        } else {
          styles.push({ name, value });
        }
      }
      editingIdx.value = -1;
      nameInput.value = '';
      valInput.value = '';
      await persistStyles();
      _refreshAllStyleDropdowns();
      renderList();
      toast('Style saved.', 'ok');
    });

    saveCurrentBtn.addEventListener('click', () => {
      const current = _currentManualText();
      if (!current) { toast('Current tab has no manual prompt text to save.', 'warn'); return; }
      // suggest a name from the first few words
      const suggested = current.split(/[,\.\n]/)[0].trim().slice(0, 40) || `Style ${Date.now()}`;
      nameInput.value = suggested;
      valInput.value = current;
      nameInput.focus();
      nameInput.select();
    });

    m.appendChild(el('div', { class: 'footer' }, [cancelBtn, saveCurrentBtn, saveBtn]));
  });
}

// ----------------- BatchGen helpers -----------------

// Capture the current "momentary task" for a tab: the main prompt
// text plus a full snapshot of every per-tab form field. This is
// what the new "Add" button (left of Generate) puts onto the batch
// queue. The queue can also contain plain-text entries (legacy
// format, still used by the "Bulk paste" + "+ Add prompt" buttons
// in the popup) — those are just a string. New snapshot entries
// are objects with { prompt, settings, ts, label }.
//
// The settings snapshot is the same shape captureTabState()
// returns, so applyTabState() can rehydrate the entire form
// before the batch runner fires Generate on each entry. That
// keeps the user's per-entry overrides intact (e.g. a 4× upscale
// configured when the entry was queued, not the tab's current
// upscale state when the batch is started).
function captureBatchEntry(tabKey) {
  const root = $(`#tab-${tabKey}`);
  if (!root) return null;
  // captureTabState walks every input/select/textarea in the tab
  // and returns { id: value, ... }. The main prompt is in there
  // (its textarea has an id) but we hoist it to the top level
  // so the popup can edit it without the user having to remember
  // which id to target.
  const raw = captureTabState(tabKey);
  // Heuristic: the first textarea in the tab is always the main
  // prompt. (buildParamRow only puts a textarea kind on the main
  // prompt field; everything else is an enum/number/boolean.)
  const promptTa = root.querySelector('textarea');
  const promptId = promptTa ? promptTa.id : null;
  const prompt = promptId ? (raw[promptId] || '') : '';
  // Remove the prompt from the settings snapshot — we'll re-apply
  // the settings first, then overwrite the promptTa.value with
  // entry.prompt (in case the user edited it in the popup).
  const settings = Object.assign({}, raw);
  if (promptId) delete settings[promptId];
  const entry = {
    prompt,
    settings,
    ts: Date.now(),
    label: summarizeEntrySettings(settings, tabKey),
  };
  // If the upscale-on-Generate flag is on, capture the full upscale
  // settings (incl. the auto-crop options) so the batch runner
  // applies the same upscale + crop pipeline per entry. The deep
  // clone is so a future mutate of state.upscaleSettings doesn't
  // retroactively change already-queued entries.
  if (state.upscaleEnabled && state.upscaleSettings) {
    entry.upscale = JSON.parse(JSON.stringify(state.upscaleSettings));
  }
  return entry;
}

// Normalize a batch entry to the canonical { prompt, settings,
// ts, label, upscale? } shape. Accepts the legacy string form
// (prompt only) for backwards compat with old batches.json files.
function normalizeBatchEntry(e) {
  if (e == null) return null;
  if (typeof e === 'string') {
    return { prompt: e, settings: null, ts: 0, label: '', upscale: null };
  }
  if (typeof e === 'object' && typeof e.prompt === 'string') {
    // Deep-validate the upscale snapshot. A corrupted state.json
    // could try to inject anything here; we whitelist the keys
    // and clamp the values to safe defaults. The batch runner
    // also re-clamps, but doing it here means the popup's
    // summary tag is accurate.
    let up = null;
    if (e.upscale && typeof e.upscale === 'object') {
      const u = e.upscale;
      up = {
        multiplier: Math.max(1, Math.min(8, parseInt(u.multiplier, 10) || 2)),
        autoCrop: !!(u.autoCrop),
        cropWidth: Math.max(0, parseInt(u.cropWidth, 10) || 0),
        cropHeight: Math.max(0, parseInt(u.cropHeight, 10) || 0),
        cropAnchorX: ['left', 'center', 'right'].includes(u.cropAnchorX) ? u.cropAnchorX : 'center',
        cropAnchorY: ['top', 'center', 'bottom'].includes(u.cropAnchorY) ? u.cropAnchorY : 'center',
      };
    }
    return {
      prompt: e.prompt,
      settings: e.settings && typeof e.settings === 'object' ? e.settings : null,
      ts: typeof e.ts === 'number' ? e.ts : 0,
      label: typeof e.label === 'string' ? e.label : summarizeEntrySettings(e.settings || {}, ''),
      upscale: up,
    };
  }
  return null;
}

// One-line summary of a settings snapshot for the popup's snapshot
// tag. The goal is to make snapshot entries visually distinct
// from legacy plain-text entries, and to give the user a quick
// "this is what was captured" read at a glance. Unknown / missing
// settings collapse to an empty tag.
function summarizeEntrySettings(settings, tabKey) {
  if (!settings) return '';
  const parts = [];
  // Variant count (selected via the variants dropdown — common to
  // every tab; the id is the tab-prefixed variants select).
  for (const k of Object.keys(settings)) {
    const v = settings[k];
    if (v == null) continue;
    if (k.endsWith('.variants') || k === 'variants') {
      const n = parseInt(v, 10);
      if (n && n > 1) parts.push(`${n} variants`);
      continue;
    }
  }
  // Tab-specific bits.
  if (tabKey === 'image') {
    if (settings['image.model']) parts.push(`model ${settings['image.model']}`);
    if (settings['image.aspect_ratio'] || settings['image.aspect']) {
      const a = settings['image.aspect_ratio'] || settings['image.aspect'];
      if (a) parts.push(a);
    }
    if (settings['image.upscale_enabled'] === 'on' || settings['image.upscale_enabled'] === true) {
      const mult = settings['image.upscale_multiplier'] || settings.upscaleSettings?.multiplier;
      parts.push(`upscale ${mult || ''}×`.replace(/\s+x\s*$/, '×').trim());
    }
  } else if (tabKey === 'speech') {
    if (settings['speech.model']) parts.push(`model ${settings['speech.model']}`);
    if (settings['speech.voice']) parts.push(`voice ${settings['speech.voice']}`);
  } else if (tabKey === 'music') {
    if (settings['music.model']) parts.push(`model ${settings['music.model']}`);
    if (settings['music.mode'] === 'instrumental' || settings['music.mode'] === 'instr') {
      parts.push('instr');
    }
  } else if (tabKey === 'video') {
    if (settings['video.model']) parts.push(`model ${settings['video.model']}`);
    if (settings['video.duration']) parts.push(`${settings['video.duration']}s`);
  }
  // Global "Target file prefix" (mirrored on every tab but the
  // settings-dict in the snapshot uses the canonical name).
  const prefix = settings.filePrefix || (tabKey && settings[tabKey + '.filePrefix']);
  if (prefix) parts.unshift(`"${prefix}"`);
  return parts.join(' · ');
}

// Build the "+ Add" button that sits LEFT of Generate on every
// tab. Clicking it captures the current form state (prompt +
// every per-tab input/select) via captureBatchEntry(), appends
// the entry to state.batches[tabKey], persists via the
// batchesSet IPC, refreshes the tab's "Start Batch" button, and
// shows a confirmation toast with the queue size.
function buildAddToBatchBtn(tabKey) {
  const btn = el('button', {
    class: 'btn-mini batch-add',
    title: 'Queue this exact generation (current prompt + all settings) for the batch runner. The snapshot is stored, so each entry runs with the settings you had at queue time, not the ones you have at run time.',
  }, '+ Add');
  btn.addEventListener('click', async () => {
    const entry = captureBatchEntry(tabKey);
    if (!entry) { toast('Could not capture the current tab state.', 'err'); return; }
    if (!entry.prompt.trim()) {
      toast('Prompt is required to queue a generation. Fill in the prompt first.', 'warn', 4000);
      return;
    }
    const cur = state.batches[tabKey] || [];
    if (cur.length >= 100) { toast('Batch is full (max 100 entries).', 'warn'); return; }
    const next = [...cur, entry];
    const r = await window.api.batchesSet({ ...state.batches, [tabKey]: next });
    if (!r.ok) { toast('Save failed: ' + r.error, 'err'); return; }
    state.batches = { ...state.batches, [tabKey]: next };
    const shortPrompt = entry.prompt.length > 30
      ? entry.prompt.slice(0, 30) + '…'
      : entry.prompt;
    toast(`Queued "${shortPrompt}" (${next.length} in queue).`, 'ok', 3000);
    _refreshBatchButtons();
  });
  return btn;
}

// ----------------- BatchGen Manager -----------------
// Opens a modal with up to 100 prompt inputs for a single tab.
// Save persists to batches.json and refreshes the tab's "Start Batch" button.
function openBatchManager(tabKey) {
  const tabName = tabKey.charAt(0).toUpperCase() + tabKey.slice(1);
  // Normalize every entry to the canonical shape so the renderer
  // doesn't have to special-case legacy strings vs new objects.
  const current = (state.batches[tabKey] || []).map(normalizeBatchEntry).filter(Boolean);
  showModal((m, close) => {
    m.appendChild(el('h2', {}, `BatchGen — ${tabName} Tab`));
    m.appendChild(el('p', { style: 'color: var(--fg-2); font-size: 12px; margin-top: 0;' },
      `Enter up to 100 prompts/texts. They will be generated one after another with the tab's current options + the selected style preset. Entries with the "📸 snapshot" tag were captured via the new "Add" button on the tab — they remember the form settings (model, upscale, crop, etc.) that were active at queue time and re-apply them before each generation. "Start Batch" runs them sequentially in the tab. "${tabName === 'Video' ? 'Note: your plan includes 3 free video generations per week — the rest will fail with quota errors.' : ''}"`));

    // List of textareas
    const list = el('div', { class: 'batch-list' });
    function renderList() {
      list.innerHTML = '';
      if (!current.length) {
        list.appendChild(el('div', { class: 'batch-empty' }, 'No prompts yet. Click "+ Add prompt" below to add a plain-text entry, or use the new "+ Add" button on the tab to capture the full current config.'));
        return;
      }
      current.forEach((entry, i) => {
        const row = el('div', { class: 'batch-row' });
        const num = el('div', { class: 'batch-num' }, String(i + 1));
        // Vertical stack: textarea on top, snapshot tags below.
        const editor = el('div', { class: 'batch-row-editor' });
        const ta = el('textarea', {}, entry.prompt);
        ta.placeholder = tabKey === 'speech' ? 'Text to read…' : 'Prompt for asset…';
        ta.addEventListener('input', () => { entry.prompt = ta.value; });
        editor.appendChild(ta);
        if (entry.upscale && tabKey === 'image') {
          // Image-only — upscale only makes sense for the image tab.
          const a = entry.upscale;
          const autoCropStr = a.autoCrop ? ' · auto-crop' : '';
          const cropStr = a.autoCrop
            ? ` (${a.cropWidth || `${a.multiplier}× post-upscale W`} × ${a.cropHeight || `${a.multiplier}× post-upscale H`} @ ${a.cropAnchorX}-${a.cropAnchorY})`
            : '';
          const tag = el('div', { class: 'batch-snapshot-tag', title: 'Upscale + auto-crop options captured when this entry was queued. Applied to the generated image after every generation.' },
            [`🔍 upscale ${a.multiplier}×${autoCropStr}${cropStr}`]);
          editor.appendChild(tag);
        }
        if (entry.label) {
          const tag = el('div', { class: 'batch-snapshot-tag', title: 'This entry was captured from the current tab state. The form fields will be restored to these values before this entry is generated.' },
            ['📸 snapshot · ' + entry.label]);
          editor.appendChild(tag);
        }
        const up = el('button', { class: 'btn-mini', title: 'Move up', onclick: () => { if (i > 0) { [current[i-1], current[i]] = [current[i], current[i-1]]; renderList(); } } }, '↑');
        const down = el('button', { class: 'btn-mini', title: 'Move down', onclick: () => { if (i < current.length-1) { [current[i+1], current[i]] = [current[i], current[i+1]]; renderList(); } } }, '↓');
        const del = el('button', { class: 'btn-mini danger', title: 'Remove', onclick: () => { current.splice(i, 1); renderList(); } }, '✕');
        row.append(num, editor, up, down, del);
        list.appendChild(row);
      });
    }
    renderList();
    m.appendChild(list);

    // Add / Clear / Paste-many controls
    const ctrls = el('div', { class: 'row', style: 'margin-top: 8px; flex-direction: row; gap: 6px; align-items: center;' });
    const addBtn = el('button', { class: 'btn-mini', onclick: () => { if (current.length >= 100) { toast('Max 100 entries.', 'warn'); return; } current.push({ prompt: '', settings: null, ts: Date.now(), label: '', upscale: null }); renderList(); setTimeout(() => { const tas = list.querySelectorAll('textarea'); tas[tas.length-1]?.focus(); }, 0); } }, '+ Add prompt');
    const clearBtn = el('button', { class: 'btn-mini', onclick: () => { if (current.length && !confirm('Clear all ' + current.length + ' entries?')) return; current.length = 0; renderList(); } }, 'Clear all');
    const pasteBtn = el('button', { class: 'btn-mini', onclick: () => {
      const ta = el('textarea', { placeholder: 'Paste one prompt per line, then click Import.' });
      const dialog = showModal((dm, dclose) => {
        dm.appendChild(el('h2', {}, 'Bulk import'));
        dm.appendChild(el('p', { style: 'color: var(--fg-2); font-size: 12px;' }, 'One prompt per line. Empty lines are ignored.'));
        dm.appendChild(el('div', { class: 'row' }, [el('label', {}, 'Prompts'), ta]));
        const ok = el('button', { class: 'primary' }, 'Import');
        const cancel = el('button', { onclick: dclose }, 'Cancel');
        dm.appendChild(el('div', { class: 'footer' }, [cancel, ok]));
        ok.addEventListener('click', async () => {
          const lines = ta.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
          const room = 100 - current.length;
          const toAdd = lines.slice(0, room);
          for (const l of toAdd) current.push({ prompt: l, settings: null, ts: Date.now(), label: '', upscale: null });
          dclose();
          renderList();
          if (lines.length > room) toast(`Imported ${room} (skipped ${lines.length - room} to stay under 100).`, 'warn');
          else toast(`Imported ${toAdd.length} prompts.`, 'ok');
        });
      });
    } }, 'Bulk paste…');
    ctrls.append(addBtn, pasteBtn, clearBtn);
    m.appendChild(ctrls);

    // Save / Close
    const save = el('button', { class: 'primary' }, `Save (${current.length})`);
    const closeBtn = el('button', { onclick: close }, 'Close');
    save.addEventListener('click', async () => {
      // Normalize + drop empties + cap at 100. Preserves the
      // object shape so the per-entry settings survive the round-trip.
      const cleaned = current
        .map((e) => ({
          prompt: String(e.prompt || '').trim(),
          settings: (e.settings && typeof e.settings === 'object') ? e.settings : null,
          ts: typeof e.ts === 'number' ? e.ts : 0,
          label: typeof e.label === 'string' ? e.label : '',
          upscale: (e.upscale && typeof e.upscale === 'object') ? e.upscale : null,
        }))
        .filter((e) => e.prompt.length > 0)
        .slice(0, 100);
      if (cleaned.length === 0) {
        if (!confirm('Save an EMPTY batch (this removes the Start Batch button)?')) return;
      }
      const next = { ...state.batches, [tabKey]: cleaned };
      const r = await window.api.batchesSet(next);
      if (!r.ok) { toast('Save failed: ' + r.error, 'err'); return; }
      state.batches = { ...state.batches, [tabKey]: cleaned };
      toast(`Saved ${cleaned.length} prompt${cleaned.length === 1 ? '' : 's'} for ${tabName}.`, 'ok');
      _refreshBatchButtons();
      close();
    });
    m.appendChild(el('div', { class: 'footer' }, [closeBtn, save]));
  });
}

function _refreshBatchButtons() {
  // For each tab, render the batch controls based on the current queue.
  // Empty queue  → single "Setup Batch Mode" button.
  // Has entries  → "Start BatchGen (N)" + a small "✎" edit button.
  for (const tabKey of ['image', 'speech', 'music', 'video']) {
    const root = $(`#tab-${tabKey}`);
    if (!root) continue;
    const wrap = root.querySelector('[data-batch-controls]');
    if (!wrap) continue;
    const n = (state.batches[tabKey] || []).length;
    wrap.innerHTML = '';
    if (n === 0) {
      // Setup / edit-empty mode: single button
      const setup = el('button', {
        class: 'btn-mini batch-setup',
        onclick: () => openBatchManager(tabKey),
      }, 'Setup Batch Mode');
      wrap.appendChild(setup);
    } else {
      // Populated mode: "Start BatchGen (N)" + small ✎ edit button
      const start = el('button', {
        class: 'batch-start',
        onclick: () => startBatchGen(tabKey),
      }, `▶ Start BatchGen (${n})`);
      const edit = el('button', {
        class: 'btn-mini batch-edit',
        title: 'Edit batch entries',
        onclick: () => openBatchManager(tabKey),
      }, '✎');
      wrap.append(start, edit);
    }
  }
}

// ----------------- BatchGen Runner -----------------
let _batchAbort = false;
async function startBatchGen(tabKey) {
  // Normalize every entry to the canonical { prompt, settings, ts,
  // label } shape — legacy plain-text entries become { prompt: text,
  // settings: null, ... } so the rest of the runner doesn't have
  // to special-case the two shapes.
  const items = (state.batches[tabKey] || []).map(normalizeBatchEntry).filter(Boolean);
  if (!items.length) { toast('Batch is empty.', 'warn'); return; }
  if (!state.config.api_key) { toast('No API key configured. Click ⚙ to open Settings.', 'err'); return; }
  if (tabKey === 'video' && items.length > 3) {
    if (!confirm(`This batch has ${items.length} videos. Your Token Plan includes only 3 free video generations per week — the rest will fail with a quota error. Continue?`)) return;
  }

  _batchAbort = false;
  const tabName = tabKey.charAt(0).toUpperCase() + tabKey.slice(1);
  const tabRoot = $(`#tab-${tabKey}`);
  const promptTa = tabRoot.querySelector('textarea');        // first textarea = main prompt
  const styleSel = tabRoot.querySelector('.row select');      // first select = style preset
  const genBtn = tabRoot.querySelector('button.primary');
  const preview = tabRoot.querySelector('.preview');
  const lastCmd = tabRoot.querySelector('.lastcmd');
  if (!promptTa || !genBtn) { toast('Could not locate tab controls.', 'err'); return; }

  // Save current state for restoration after the batch is done.
  // We don't include the prompt here because the per-entry
  // snapshot's prompt overrides it below.
  const savedSnapshot = captureTabState(tabKey);
  // Also save the user's actual upscale + auto-crop state so we
  // can restore it after the batch (the per-entry upscale is
  // applied on top of this for each entry).
  const savedUpscaleEnabled = state.upscaleEnabled;
  const savedUpscaleSettings = state.upscaleSettings ? JSON.parse(JSON.stringify(state.upscaleSettings)) : null;

  // Show progress overlay
  const overlay = el('div', { class: 'batch-overlay' });
  overlay.appendChild(el('div', { class: 'batch-overlay-title' }, `BatchGen — ${tabName}`));
  const counter = el('div', { class: 'batch-overlay-counter' }, `0 / ${items.length}`);
  const currentPrompt = el('div', { class: 'batch-overlay-prompt' }, '');
  const elapsed = el('div', { class: 'batch-overlay-elapsed' }, '');
  const log = el('div', { class: 'batch-overlay-log' });
  const stopBtn = el('button', { class: 'danger' }, '■ Stop batch');
  stopBtn.addEventListener('click', () => { _batchAbort = true; stopBtn.disabled = true; stopBtn.textContent = 'Stopping…'; });
  overlay.append(counter, currentPrompt, elapsed, log, stopBtn);
  preview.appendChild(overlay);
  const t0 = Date.now();
  const updateElapsed = () => { const s = Math.round((Date.now() - t0) / 1000); elapsed.textContent = `Elapsed: ${Math.floor(s / 60)}m ${s % 60}s`; };
  const elapsedTimer = setInterval(updateElapsed, 1000);
  updateElapsed();

  function logLine(s, kind) {
    const e = el('div', { class: 'batch-log-line ' + (kind || '') }, s);
    log.appendChild(e);
    log.scrollTop = log.scrollHeight;
  }

  let ok = 0, fail = 0;
  let batchError = null;
  let stoppedAt = 0; // 1-based index of the item we stopped on (0 = didn't stop)
  let totalVariants = 0;
  try {
    for (let i = 0; i < items.length && !_batchAbort; i++) {
      const entry = items[i];
      counter.textContent = `${i + 1} / ${items.length}`;
      currentPrompt.textContent = (entry.prompt || '').slice(0, 200) + ((entry.prompt || '').length > 200 ? '…' : '');

      // Per-entry snapshot: if the entry has a settings snapshot,
      // re-apply it BEFORE we set the prompt so the prompt value
      // in the snapshot (which we deleted in captureBatchEntry)
      // doesn't fight us. suppressStateSave wraps the whole thing
      // so a batch run doesn't blow away the user's saved state.
      const variantsSel = tabRoot.querySelector('.variants-select');
      suppressStateSave(() => {
        if (entry.settings && typeof entry.settings === 'object') {
          // applyTabState fires input/change on every input it
          // touches, which is exactly what we want — the style
          // preview, has-custom class, etc. all need the event
          // to update.
          applyTabState(tabKey, entry.settings);
        } else {
          // Legacy entry (no snapshot): just set the prompt.
          promptTa.value = entry.prompt;
          promptTa.dispatchEvent(new Event('input', { bubbles: true }));
        }
        // Always set the prompt last so an in-popup edit of the
        // prompt text wins over the snapshot's stored prompt.
        promptTa.value = entry.prompt;
        promptTa.dispatchEvent(new Event('input', { bubbles: true }));
      });
      // Read the variants count from the (now-restored) variants
      // dropdown. Legacy entries fall back to 1.
      const variantsSel2 = tabRoot.querySelector('.variants-select');
      const variantsCount = Math.max(1, Math.min(5, parseInt(variantsSel2 ? variantsSel2.value : '1', 10) || 1));
      totalVariants += variantsCount;

      // Apply the per-entry upscale snapshot (if any). The image
      // tab's generate handler reads state.upscaleSettings /
      // state.upscaleEnabled to decide whether to upscale + crop
      // after the mmx call, so flipping these flags here is all
      // we need to do.
      if (entry.upscale && typeof entry.upscale === 'object') {
        state.upscaleSettings = JSON.parse(JSON.stringify(entry.upscale));
        state.upscaleEnabled = true;
      } else {
        // No upscale snapshot in this entry: temporarily disable
        // upscale so the user's saved upscale state doesn't leak
        // into a batch entry that was queued without it.
        state.upscaleEnabled = false;
      }

      // Run N variants for this batch item
      for (let vi = 0; vi < variantsCount; vi++) {
        if (_batchAbort) break;
        // Wait until no other generation is in progress (state.generating is
        // null). armGenBtnWithCancel sets it to the tab key on entry and clears
        // it on cleanup, so this is a reliable signal.
        while (state.generating) {
          if (_batchAbort) break;
          await new Promise((r) => setTimeout(r, 50));
        }
        if (_batchAbort) break;
        // Trigger generation. The click handler is async — we poll state.generating
        // to detect when it has set the busy flag (i.e. the handler started).
        genBtn.click();
        const startDeadline = Date.now() + 8000;
        while (state.generating !== tabKey) {
          if (_batchAbort) break;
          if (Date.now() > startDeadline) { logLine(`✗ Gen did not start for item ${i + 1}.`, 'err'); fail++; break; }
          await new Promise((r) => setTimeout(r, 20));
        }
        if (_batchAbort || state.generating !== tabKey) break;
        // Wait for the generation to finish (armGenBtnWithCancel's cleanup
        // resets state.generating to null when the gen handler returns).
        while (state.generating === tabKey) {
          if (_batchAbort) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        // Inspect the preview for success/failure (best-effort: check if it has an image/video)
        const looksOk = preview.querySelector('img, video, audio');
        const variantTag = variantsCount > 1 ? ` v${vi + 1}/${variantsCount}` : '';
        if (looksOk) { ok++; logLine(`✓ ${i + 1}/${items.length}${variantTag} OK`, 'ok'); }
        else { fail++; logLine(`✗ ${i + 1}/${items.length}${variantTag} FAILED`, 'err'); }
      }
      if (_batchAbort) { stoppedAt = i + 1; logLine(`Aborted at item ${i + 1}.`, 'warn'); break; }
    }
  } catch (e) {
    batchError = e;
    console.error('BatchGen threw:', e);
    logLine(`⚠ Batch error: ${e && e.message || String(e)}`, 'err');
  } finally {
    // Always clear the timer and reset the stop button — even on an
    // uncaught exception in the loop.
    clearInterval(elapsedTimer);
    stopBtn.textContent = 'Close';
    stopBtn.disabled = false;
    stopBtn.onclick = () => overlay.remove();
  }

  // Restore original state. The user's last view of the tab
  // (the settings they had before clicking Start Batch) is
  // reapplied via captureTabState → applyTabState round-trip.
  // suppressStateSave ensures the per-item transient form
  // changes don't leak into the persisted state.json.
  suppressStateSave(() => {
    applyTabState(tabKey, savedSnapshot);
  });
  // Restore the user's actual upscale + auto-crop state too (the
  // per-entry snapshots may have overwritten state.upscaleSettings
  // for individual entries). Outside suppressStateSave so a
  // scheduleStateSave() from the input events doesn't get
  // re-suppressed at the wrong time — we want the user's
  // settings to land in state.json.
  state.upscaleEnabled = !!savedUpscaleEnabled;
  if (savedUpscaleSettings) state.upscaleSettings = savedUpscaleSettings;
  // Distinguish a user-stopped batch from a completed one — previously
  // both said "done", which was confusing.
  const summary = stoppedAt
    ? `BatchGen stopped at item ${stoppedAt}: ${ok} ok, ${fail} failed.`
    : `BatchGen finished: ${ok} ok, ${fail} failed. (${totalVariants} variants total)`;
  if (lastCmd) lastCmd.textContent = summary;
  toast(stoppedAt
    ? `BatchGen stopped. ${ok} ok, ${fail} failed.`
    : `BatchGen done: ${ok} ok, ${fail} failed.`, batchError ? 'err' : (fail === 0 ? 'ok' : 'warn'), 6000);
  await refreshBrowser();
  await refreshQuota();
}

// ----------------- VIDEO TAB -----------------
TABS.video = {
  prefilled: 'A serene mountain landscape at golden hour, drone shot slowly panning over the valley',
  build() {
    const root = $('#tab-video');
    root.innerHTML = '';

    // Prompt
    const prompt = buildParamRow('Video prompt (prefilled, editable)',
      { kind: 'textarea', value: this.prefilled, help: 'Describe the scene + motion. Up to 2000 chars. Use [Push in], [Pan left], [Static shot] etc. to control camera (15 commands supported).' });
    const styleRow = buildStyleRow('video', 'Select a style preset. Its value is prepended (with a comma) to your video prompt before being sent to mmx.');
    const stylePreview = buildStylePreviewBlock();
    const tabState = { previewEl: stylePreview, selEl: styleRow.sel, manualEl: prompt.input };
    const updatePreview = () => updateStylePreview(tabState);
    styleRow.sel.addEventListener('change', updatePreview);
    prompt.input.addEventListener('input', updatePreview);
    updatePreview();
    const counter = buildPromptCounter({ selEl: styleRow.sel, manualEl: prompt.input, id: 'video' });
    root.appendChild(el('div', { class: 'section' }, [
      el('h3', {}, 'Prompt'),
      styleRow.row,
      prompt.row,
      stylePreview,
      counter.wrap,
    ]));

    // Parameters
    const model = buildParamRow('--model', {
      kind: 'enum', default: 'MiniMax-Hailuo-2.3',
      options: [
        { value: 'MiniMax-Hailuo-2.3', label: 'MiniMax-Hailuo-2.3 (T2V + I2V, default, best quality)' },
        { value: 'MiniMax-Hailuo-2.3-Fast', label: 'MiniMax-Hailuo-2.3-Fast (faster, I2V only — needs --first-frame)' },
        { value: 'MiniMax-Hailuo-02', label: 'MiniMax-Hailuo-02 (SEF: needs --first-frame + --last-frame)' },
        { value: 'S2V-01', label: 'S2V-01 (subject reference — needs --subject-image)' },
      ],
      help: 'Video generation model.\n\nMiniMax-Hailuo-2.3 (default): Newest + best quality.\n  • T2V (text-to-video) and I2V (image-to-video)\n  • Resolutions: 768P (default), 1080P (6s only)\n  • Durations: 6s, 10s\n  • Supports --prompt-optimizer, --fast-pretreatment, 15 camera commands\n\nMiniMax-Hailuo-2.3-Fast: Faster variant, I2V only.\n  REQUIRES --first-frame. Use for quick iterations.\n\nMiniMax-Hailuo-02: Used for first+last frame interpolation (SEF).\n  REQUIRES both --first-frame and --last-frame.\n  Resolutions: 512P, 768P, 1080P.\n\nS2V-01: Subject reference (face consistency across video).\n  REQUIRES --subject-image.',
    });
    const firstFrame = buildParamRow('--first-frame (I2V/SEF)', {
      kind: 'text', default: '',
      placeholder: 'Path or URL to first-frame image',
      fileFilters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
        { name: 'All files', extensions: ['*'] },
      ],
      browseTitle: 'Select first-frame image',
      help: 'Path or URL to a starting image. Triggers I2V (image-to-video).\nFor MiniMax-Hailuo-2.3-Fast this is required.\nSupported formats: JPG, JPEG, PNG, WebP.\nMax 20MB. Aspect 2:5 to 5:2. Short edge > 300px.\nYou can also paste a public URL (https://...).',
    });
    const lastFrame = buildParamRow('--last-frame (SEF only)', {
      kind: 'text', default: '',
      placeholder: 'Path or URL to last-frame image',
      fileFilters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
        { name: 'All files', extensions: ['*'] },
      ],
      browseTitle: 'Select last-frame image',
      help: 'Path or URL to an ending image. Combined with --first-frame,\nswitches to Hailuo-02 in start-end-frame (SEF) interpolation mode.\nSupported formats: JPG, JPEG, PNG, WebP. Max 20MB.',
    });
    const subjectImage = buildParamRow('--subject-image (S2V-01)', {
      kind: 'text', default: '',
      placeholder: 'Path or URL to subject reference photo',
      fileFilters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
        { name: 'All files', extensions: ['*'] },
      ],
      browseTitle: 'Select subject reference photo',
      help: 'Path or URL to a character reference photo. Switches to S2V-01 model\nfor face consistency across the video.\nSupported formats: JPG, JPEG, PNG, WebP.',
    });
    const duration = buildParamRow('--duration (seconds)', {
      kind: 'number', default: 6, min: 6, max: 10, step: 1,
      options: [{ value: 6, label: '6s' }, { value: 10, label: '10s' }],
      help: 'Video length in seconds. 6s is default; 10s only on certain models/resolutions.',
    });
    const resolution = buildParamRow('--resolution', {
      kind: 'enum', default: '768P',
      options: [
        { value: '512P', label: '512P (Hailuo-02 only)' },
        { value: '720P', label: '720P (legacy default)' },
        { value: '768P', label: '768P (recommended, default)' },
        { value: '1080P', label: '1080P (6s only on 2.3 / 2.3-Fast)' },
      ],
      help: 'Output resolution. 1080P only works for 6s videos on Hailuo-2.3 / 2.3-Fast.',
    });
    const promptOpt = buildParamRow('--prompt-optimizer', {
      kind: 'boolean', default: true, help: 'Auto-rewrite your prompt for better results (default true). Set off for precise control.',
    });
    const fastPretreat = buildParamRow('--fast-pretreatment', {
      kind: 'boolean', default: false, help: 'Speeds up the optimizer step. Only for Hailuo-2.3, 2.3-Fast, 02. Default off.',
    });
    const pollInterval = buildParamRow('--poll-interval (seconds)', {
      kind: 'number', default: 5, min: 2, max: 60, step: 1,
      options: [3, 5, 10, 15, 30, 60].map((v) => ({ value: v, label: String(v) })),
      help: 'How often to poll the API while waiting for the video. Default 5s. Lower = faster status updates but more API calls.',
    });

    root.appendChild(el('div', { class: 'section' }, [
      el('h3', {}, 'Parameters'),
      buildFilePrefixRow(),
      el('div', { class: 'grid' }, [
        model.row, firstFrame.row,
        lastFrame.row, subjectImage.row,
        duration.row, resolution.row,
        promptOpt.row, fastPretreat.row,
        pollInterval.row,
      ]),
    ]));

    // Actions
    const actions = el('div', { class: 'actions' });
    const genBtn = el('button', { class: 'primary' }, 'Generate');
    const lastCmd = el('span', { class: 'lastcmd' }, '');
    const batchControls = el('span', { 'data-batch-controls': 'video', class: 'batch-controls' });
    // Variants dropdown (video tab has no seed, so always enabled)
    const variants = buildVariantsRow({ id: 'variants-video' });
    actions.append(buildAddToBatchBtn('video'), genBtn, variants.row, batchControls, lastCmd);
    const preview = el('div', { class: 'preview' }, el('div', { class: 'empty' }, 'No video generated yet. Note: video generation is async and may take 1-3 minutes.'));
    const tabFooter = el('div', { class: 'tab-footer' }, [actions, preview]);
    root.appendChild(tabFooter);

    genBtn.addEventListener('click', async () => {
      // Re-entrancy guard: another generation is in progress.
      if (state.generating) return;
      if (!state.config.api_key) { toast('No API key configured. Click ⚙ to open Settings.', 'err'); return; }
      const promptText = buildFinalPrompt(styleRow.sel, prompt.input);
      if (!promptText) { toast('Prompt is required (style or manual input).', 'warn'); return; }
      const variantsCount = Math.max(1, Math.min(5, parseInt(variants.sel.value, 10) || 1));
      let outDir;
      try { outDir = await ensureSubDir('video'); }
      catch (e) { toast('No output directory set. Open Settings.', 'err'); return; }
      const slug = slugify(promptText).slice(0, 60) || 'video';
      const cancel = armGenBtnWithCancel(genBtn, 'Generate');
      let allOk = true;
      let lastPreview = null;
      let lastOutFile = null;
      let threw = null;
      try {
        for (let v = 1; v <= variantsCount; v++) {
          if (cancel.wasCancelled()) break;
          const args = ['video', 'generate'];
          args.push('--prompt', promptText);
          appendFlag(args, model.input);
          if (firstFrame.input.value && firstFrame.input.value.trim()) args.push('--first-frame', firstFrame.input.value.trim());
          if (lastFrame.input.value && lastFrame.input.value.trim()) args.push('--last-frame', lastFrame.input.value.trim());
          if (subjectImage.input.value && subjectImage.input.value.trim()) args.push('--subject-image', subjectImage.input.value.trim());
          appendFlag(args, duration.input);
          appendFlag(args, resolution.input);
          appendBoolFlag(args, promptOpt.input, '--prompt-optimizer');
          appendBoolFlag(args, fastPretreat.input, '--fast-pretreatment');
          appendFlag(args, pollInterval.input);
          const ts = timestamp();
          const variantTag = variantsCount > 1 ? `_v${v}` : '';
          const prefix = (state.filePrefix || '').trim();
          const outFile = uniquePath(outDir, `${prefix}${ts}_${slug}${variantTag}.mp4`);
          args.push('--download', outFile);
          lastCmd.textContent = `mmx ${args.join(' ')}`;
          const statusMsg = variantsCount > 1
            ? `Submitting video job… variant ${v}/${variantsCount} (each takes 1-3 min)`
            : 'Submitting video job…';
          setStatus(statusMsg, true);
          let elapsedTimer = null;
          const updateStatus = (msg) => { preview.innerHTML = `<div class="empty"><span class="spinner"></span> ${escapeHtml(msg)}</div>`; };
          updateStatus(variantsCount > 1
            ? `Submitting video job ${v}/${variantsCount}…`
            : 'Submitting video job (may take a few seconds)…');
          const start = Date.now();
          elapsedTimer = setInterval(() => { const s = Math.round((Date.now() - start) / 1000); updateStatus(`Generating video ${v}/${variantsCount}… elapsed ${s}s (typical: 60-180s)`); }, 1000);
          const r = await window.api.mmxRun(args);
          clearInterval(elapsedTimer);
          if (cancel.wasCancelled()) { allOk = false; break; }
          if (!r.ok) {
            const msg = formatMmxError(r);
            preview.innerHTML = `<div class="empty">Generation failed (variant ${v}/${variantsCount}).</div><div class="meta">${escapeHtml(msg)}</div>`;
            toast('Video generation failed: ' + msg, 'err', 6000);
            allOk = false;
            break;
          }
          lastPreview = r.parsed;
          lastOutFile = outFile;
        }
      } catch (e) {
        threw = e;
        allOk = false;
        console.error('Video generation threw:', e);
        toast('Generation error: ' + (e && e.message || String(e)), 'err', 6000);
      } finally {
        cancel.cleanup();
        setStatus('Ready', false);
        try { await refreshBrowser(); } catch {}
        try { await refreshQuota(); } catch {}
      }
      if (threw) return;
      if (cancel.wasCancelled()) {
        preview.innerHTML = '<div class="empty">Generation cancelled.</div>';
        toast('Cancelled.', 'warn');
        return;
      }
      if (allOk && lastOutFile) {
        showVideoPreview(preview, lastOutFile, lastPreview);
        bumpGenerationCounter('video', variantsCount);
      }
      if (allOk) {
        toast(variantsCount > 1
          ? `Video generated. ${variantsCount} variants saved.`
          : 'Video generated.', 'ok');
      }
    });
  },
};

function showVideoPreview(rootEl, file, parsed) {
  const url = fileUrl(file) + '?t=' + Date.now();
  rootEl.innerHTML = '';
  const vid = el('video', { controls: '', src: url, style: 'max-width: 100%; max-height: 60vh; display: block; margin: 0 auto;' });
  vid.preload = 'metadata';
  rootEl.appendChild(vid);
  const meta = el('div', { class: 'meta' });
  meta.appendChild(document.createTextNode(file));
  if (parsed) meta.appendChild(el('div', {}, '[mmx] ' + safeStringify(parsed)));
  rootEl.appendChild(meta);
}

// ----------------- Helpers -----------------
function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function uniquePath(dir, name) {
  // We can't easily ask the FS from the renderer, so we append a short random
  // suffix to virtually eliminate in-session collisions. The previous version
  // returned the raw joined path, which let two clicks in the same second
  // (or any duplicate-prompt collision) silently overwrite the previous file.
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  // 4-char base36 suffix, e.g. "_a3f9"
  const suffix = Math.random().toString(36).slice(2, 6) || 'rndm';
  return dir.replace(/[\\/]+$/, '') + (dir.includes('\\') ? '\\' : '/') + stem + '_' + suffix + ext;
}
async function ensureSubDir(name) {
  const base = state.config.output_dir || '';
  if (!base) throw new Error('No output directory set. Open Settings.');
  // Prefer the file-browser's current folder if it's a real subdir of
  // `output_dir`; otherwise fall back to the per-tab default subdir. Both
  // paths are normalized to forward slashes before the startsWith check
  // so mixed separators (e.g. `base` uses `\`, `fb` uses `/`) don't
  // silently drop the user's navigated folder.
  const normForCompare = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const baseNorm = normForCompare(base);
  const fbNorm = normForCompare(state.fbDir || '');
  // Use the separator that `base` uses for the on-disk path.
  const baseSep = base.includes('\\') ? '\\' : '/';
  const fbSep = (state.fbDir || '').includes('\\') ? '\\' : '/';
  const join = (a, b, sep) => (a.replace(/[\\/]+$/, '')) + sep + b;
  let targetDir = null;
  if (fbNorm && (fbNorm === baseNorm || fbNorm.startsWith(baseNorm + '/'))) {
    // The file browser's current folder is the output_dir or a subdir of it.
    // Use it as the generation target.
    targetDir = (state.fbDir || '').replace(/[\\/]+$/, '');
  } else {
    // Not under output_dir (or empty) — fall back to the per-tab default.
    targetDir = join(base, name, baseSep);
  }
  // Ensure the dir exists. If we picked the per-tab default, we can use
  // fbMkdir's idempotent behaviour directly. If we picked a deeper folder
  // (e.g. _assets/images/spellquake), create the chain segment by segment.
  if (targetDir === join(base, name, baseSep)) {
    await window.api.fbMkdir(base, name).catch(() => null);
  } else {
    // Strip the base prefix and walk the remaining path segments.
    const stripped = targetDir.replace(/[\\/]+$/, '');
    const relParts = [];
    // Walk both with the user's original separator.
    const baseN = base.replace(/[\\/]+$/, '');
    if (stripped.length > baseN.length) {
      const rel = stripped.slice(baseN.length).replace(/^[\\/]+/, '');
      for (const p of rel.split(/[\\/]/).filter(Boolean)) relParts.push(p);
    }
    let cur = base;
    for (const p of relParts) {
      await window.api.fbMkdir(cur, p).catch(() => null);
      cur = join(cur, p, baseSep);
    }
  }
  return targetDir;
}

// ----------------- Bootstrap -----------------
async function init() {
  // Wire tabs
  for (const t of $$('.tab')) t.addEventListener('click', () => showTab(t.dataset.tab));
  $('#fb-up').addEventListener('click', () => {
    // Go up one level. Stop at the output root.
    const outRoot = state.config.output_dir || '';
    if (!state.fbDir) return;
    if (outRoot && state.fbDir.toLowerCase() === outRoot.toLowerCase()) return;
    state.fbDir = parentDir(state.fbDir) || outRoot;
    refreshBrowser({ keepCurrent: true });
  });
  // Navigate to a folder chosen via the standard Windows folder-selection
  // dialog. The picked path is stored as the current browser location
  // for the active tab and persisted across restarts (via fbDirs in
  // state.json), and is also added to the trusted-pick set in the
  // main process so any subsequent fb:* operation in this folder is
  // authorised.
  $('#fb-pick').addEventListener('click', async () => {
    const picked = await window.api.pickFolder();
    if (!picked) return; // user cancelled the dialog
    state.fbDir = picked;
    if (state.currentTab) state.fbDirs[state.currentTab] = picked;
    scheduleStateSave();
    await refreshBrowser({ keepCurrent: true });
  });
  // File browser live filter
  const fbSearch = $('#fb-search');
  if (fbSearch) fbSearch.addEventListener('input', applyFileSearch);
  $('#fb-refresh').addEventListener('click', () => refreshBrowser());
  $('#fb-new').addEventListener('click', () => promptNewFolder());
  $('#fb-open').addEventListener('click', () => window.api.fbReveal(state.fbDir || state.config.output_dir || ''));
  $('#quota-refresh').addEventListener('click', () => refreshQuota());
  $('#btn-styles').addEventListener('click', () => openStyleSettings());
  $('#btn-theme').addEventListener('click', () => toggleTheme());
  $('#btn-settings').addEventListener('click', () => openSettings());

  // Log bar: wire up the Copy / Clear / Collapse buttons. The collapse button
  // also keeps its label in sync with the <details> open state.
  const logDetails = $('#logbar details');
  const logCopyBtn = $('#log-copy');
  const logClearBtn = $('#log-clear');
  const logToggleBtn = $('#log-toggle');
  function _syncLogToggleLabel() {
    if (!logToggleBtn || !logDetails) return;
    logToggleBtn.textContent = logDetails.open ? '▼ Collapse' : '▲ Expand';
  }
  if (logDetails) logDetails.addEventListener('toggle', _syncLogToggleLabel);
  if (logToggleBtn) {
    logToggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!logDetails) return;
      logDetails.open = !logDetails.open;
      _syncLogToggleLabel();
    });
  }
  if (logClearBtn) {
    logClearBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const logEl = $('#log');
      if (logEl) logEl.textContent = '';
      toast('Log cleared.', 'ok', 1500);
    });
  }
  if (logCopyBtn) {
    logCopyBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const txt = $('#log')?.textContent || '';
      if (!txt) { toast('Log is empty.', 'warn'); return; }
      try {
        await navigator.clipboard.writeText(txt);
        toast('Log copied to clipboard.', 'ok', 1500);
      } catch (err) {
        // Fallback: select the text so the user can Ctrl+C manually
        const range = document.createRange();
        range.selectNodeContents($('#log'));
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        toast('Copy failed — log text selected, press Ctrl+C to copy.', 'warn', 4000);
      }
    });
  }
  _syncLogToggleLabel();

  // Picture preview pane — clear button
  const previewClearBtn = $('#preview-clear');
  if (previewClearBtn) {
    previewClearBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const content = $('#fb-preview-content');
      if (!content) return;
      content.innerHTML = '<div class="preview-pane-empty">Click an image in the file browser to preview it here.</div>';
    });
  }

  // Config
  state.config = await window.api.getConfig();
  // Ensure new fields exist
  if (!Array.isArray(state.config.styles)) state.config.styles = [];
  if (!state.config.theme) state.config.theme = 'dark';
  // Apply theme as early as possible
  applyTheme(state.config.theme);
  if (!state.config.api_key) {
    toast('No API key. Click ⚙ to add one.', 'warn', 6000);
  }

  // Build tabs (assign ids + load saved state + start autosave)
  const savedState = await window.api.stateGet() || {};
  state.tabSettings = savedState.tabs || {};
  // Restore per-tab folder map (per-tab folder persistence)
  if (savedState.fbDirs && typeof savedState.fbDirs === 'object') {
    for (const k of ['image', 'speech', 'music', 'video']) {
      if (typeof savedState.fbDirs[k] === 'string') state.fbDirs[k] = savedState.fbDirs[k];
    }
  }
  // Restore the upscale-on-Generate state
  if (typeof savedState.upscaleEnabled === 'boolean') state.upscaleEnabled = savedState.upscaleEnabled;
  if (savedState.upscaleSettings && typeof savedState.upscaleSettings === 'object' && savedState.upscaleSettings.multiplier) {
    state.upscaleSettings = { multiplier: parseInt(savedState.upscaleSettings.multiplier, 10) || 2 };
  }
  // Restore the global file-name prefix (mirrored on every tab).
  if (typeof savedState.filePrefix === 'string') state.filePrefix = savedState.filePrefix;
  // Restore the Real-ESRGAN model choice. Same sanitisation as
  // state.js: capped length, falls back to the default on any
  // garbage value. App-level whitelisting happens in the call site.
  if (typeof savedState.realesrganModel === 'string' && savedState.realesrganModel.trim()) {
    state.realesrganModel = savedState.realesrganModel.trim().slice(0, 64);
  }
  const startTab = (savedState.currentTab && ['image','speech','music','video'].includes(savedState.currentTab))
    ? savedState.currentTab : 'image';
  for (const tabKey of ['image', 'speech', 'music', 'video']) {
    TABS[tabKey].build();
    assignTabFormIds(tabKey);
    applyTabState(tabKey, state.tabSettings[tabKey] || {});
    setupTabAutosave(tabKey);
  }

  // Load batches
  state.batches = await window.api.batchesGet();
  _refreshBatchButtons();

  // Install global keyboard shortcuts
  installKeyboardShortcuts();
  // Long-hover tooltip for the truncated .lastcmd span
  setupLastCmdTooltips();
  setStatus('Ready');

  // Initial values
  if (!state.config.output_dir) {
    // Set a sensible default in state for path display
    state.config.output_dir = await window.api.configPath().then((p) => p.replace(/config\.txt$/i, 'generated'));
  }

  showTab(startTab);

  // Startup popup — show after the first tab is rendered so the user
  // immediately sees the rest of the UI behind the modal.
  showStartupPopup();

  // Logs from main
  window.api.onLog((line) => log(line));

  // First quota fetch
  refreshQuota().catch(() => {});
}

// ----------------- App status + keyboard shortcuts + cancel -----------------
function setStatus(text, busy = false) {
  const s = $('#status');
  if (!s) return;
  s.textContent = text;
  s.classList.toggle('busy', !!busy);
}
let _generationCounter = 0;
function bumpGenerationCounter(kind, n = 1) {
  _generationCounter += Math.max(1, n | 0);
  setStatus(`${_generationCounter} generations this session`, false);
}

// Wrap a generation call with a cancel button. While the call is in flight:
//   - the button text becomes "Cancel" (clicking it triggers the cancel path)
//   - state.generating is set to the tab key so other code (the batch runner,
//     re-entrant click guards) can detect that a generation is in progress.
//   - state.genStatus[tabKey] is set to "running" (drives the red tab dot).
// On cleanup:
//   - the original button label is restored
//   - state.generating is cleared
//   - state.genStatus[tabKey] is bumped to "done" so the green dot appears
//     (unless the user is currently on this tab — that case is handled in
//     refreshTabStatusDots).
function armGenBtnWithCancel(genBtn, label) {
  let cancelled = false;
  const origLabel = label || genBtn.textContent;
  const tabKey = (genBtn.closest('.tabpanel')?.id || '').replace('tab-', '') || null;
  genBtn.textContent = 'Cancel';
  genBtn.classList.add('danger');
  state.generating = tabKey;
  if (tabKey) {
    state.genStatus[tabKey] = 'running';
    // Record the wall-clock start time for the ETA timer.
    if (!state.genStartMs) state.genStartMs = {};
    state.genStartMs[tabKey] = Date.now();
  }
  refreshTabStatusDots();
  ensureEtaTimer();
  const onCancelClick = async (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    if (!confirm('Cancel the current generation?')) return;
    cancelled = true;
    toast('Cancelling…', 'warn', 1500);
    await window.api.mmxCancel();
  };
  genBtn.addEventListener('click', onCancelClick);
  return {
    cancel: () => { cancelled = true; },
    wasCancelled: () => cancelled,
    cleanup: () => {
      genBtn.removeEventListener('click', onCancelClick);
      genBtn.classList.remove('danger');
      genBtn.textContent = origLabel;
      genBtn.disabled = false;
      // Update the per-tab average (only on successful, non-cancelled runs).
      // Always clear the start time so a later ETA tick doesn't read a
      // stale value (the previous code only nulled it on success, which
      // meant a cancelled run kept its start timestamp and the ETA timer
      // would briefly show "elapsed: 999s" until it auto-cleared).
      if (tabKey && state.genStartMs && state.genStartMs[tabKey]) {
        if (!cancelled) {
          const dur = (Date.now() - state.genStartMs[tabKey]) / 1000;
          if (!state.genAvgSec) state.genAvgSec = {};
          const prev = state.genAvgSec[tabKey] || 0;
          // Exponential moving average, alpha=0.4 — recent runs weighted higher.
          state.genAvgSec[tabKey] = prev === 0 ? dur : (prev * 0.6 + dur * 0.4);
        }
        state.genStartMs[tabKey] = null;
      }
      // Only clear the busy flag if it still points to this tab.
      if (state.generating === tabKey) state.generating = null;
      if (tabKey) state.genStatus[tabKey] = cancelled ? 'idle' : 'done';
      refreshTabStatusDots();
    },
  };
}
// Format mmx error: strip "node.exe :" prefix, then surface the most
// informative bit. mmx returns errors in a few different shapes depending
// on which command failed:
//   - { "error": { "code": 1, "message": "API error: ..." } }   ← the
//     "API error: system error (HTTP 200)" pattern we see on transient
//     mmx backend hiccups.
//   - { "base_resp": { "status_code": N, "status_msg": "..." } }  ←
//     the legacy structured error from older mmx versions.
//   - plain stderr text (caught all of the above if our parser misses).
function formatMmxError(r) {
  let msg = (r.stderr || r.stdout || '').toString();
  msg = msg.replace(/^node\.exe\s*:\s*/gm, '').trim();
  if (r.parsed && typeof r.parsed === 'object') {
    // Shape 1: { "error": { "code": N, "message": "..." } }
    if (r.parsed.error && typeof r.parsed.error === 'object' && r.parsed.error.message) {
      const m = String(r.parsed.error.message);
      if (m) return msg ? `${m} (${msg})` : m;
    }
    // Shape 2: { "base_resp": { "status_code": N, "status_msg": "..." } }
    if (r.parsed.base_resp && r.parsed.base_resp.status_msg) {
      const sm = r.parsed.base_resp.status_msg;
      const sc = r.parsed.base_resp.status_code;
      if (sm && sc !== 0) {
        return msg ? `${sm} (${msg})` : sm;
      }
    }
    // Shape 3: { "message": "..." } (catch-all)
    if (typeof r.parsed.message === 'string' && r.parsed.message) {
      return r.parsed.message;
    }
  }
  return msg || `mmx exited with code ${r.code}`;
}

// Classify an mmx error so the UI can show targeted troubleshooting tips.
// Returns one of: 'auth' (401/403/invalid key), 'rate' (429/rate limit),
// 'quota' (out of plan / quota exhausted), 'network' (DNS/socket),
// 'server' (5xx or generic system error), 'unknown'.
function classifyMmxError(r, msg) {
  const combined = ((msg || '') + ' ' + (r.stderr || '') + ' ' + (r.stdout || '')).toLowerCase();
  if (/401|403|unauthor|forbidden|invalid.api.key|api.key.*invalid|auth.*fail/.test(combined)) return 'auth';
  if (/429|rate|limit|throttl|too many/.test(combined)) return 'rate';
  if (/quota|not.in.plan|exhaust|insufficient/.test(combined)) return 'quota';
  if (/enotfound|econnrefused|econnreset|etimedout|network|dns/.test(combined)) return 'network';
  if (/500|502|503|504|server.error|system.error|internal/.test(combined)) return 'server';
  return 'unknown';
}
function installKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Skip when typing in a non-textarea field (so Ctrl+A etc. works in inputs)
    const inField = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT');
    const cmd = e.ctrlKey || e.metaKey;
    // `e.key` is undefined when only a modifier is held. Bail out so we don't
    // mis-fire handlers on modifier-only events (e.g. releasing Shift).
    if (!e.key) return;
    if (cmd && e.key === 'Enter') {
      // Generate on the active tab
      const tab = state.currentTab;
      const genBtn = $(`#tab-${tab} button.primary`);
      if (genBtn && !state.generating && genBtn.textContent !== 'Cancel') { genBtn.click(); e.preventDefault(); }
      return;
    }
    if (cmd && ['1','2','3','4'].includes(e.key)) {
      const tabs = ['image','speech','music','video'];
      const idx = parseInt(e.key, 10) - 1;
      if (tabs[idx]) { showTab(tabs[idx]); e.preventDefault(); }
      return;
    }
    if (cmd && (e.key === 'b' || e.key === 'B')) {
      openBatchManager(state.currentTab); e.preventDefault(); return;
    }
    if (cmd && (e.key === 's' || e.key === 'S')) {
      openSettings(); e.preventDefault(); return;
    }
    if (cmd && (e.key === 't' || e.key === 'T')) {
      openStyleSettings(); e.preventDefault(); return;
    }
    if (cmd && (e.key === 'l' || e.key === 'L')) {
      toggleTheme(); e.preventDefault(); return;
    }
    if (cmd && (e.key === 'f' || e.key === 'F') && !inField) {
      // Focus the file browser filter
      const s = $('#fb-search');
      if (s) { s.focus(); s.select(); e.preventDefault(); }
      return;
    }
    if (cmd && (e.key === 'r' || e.key === 'R')) {
      // Refresh quota
      refreshQuota(); toast('Quota refreshed.', 'ok', 1500); e.preventDefault(); return;
    }
  });
}

// ----------------- State autosave (per-tab form values) -----------------
// After every tab builds, assign id="<tabKey>.<slug>" to each form control,
// then on every input/change event, capture+save the active tab state.
function slugifyLabel(s) {
  return String(s || '').toLowerCase().replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'field';
}
function assignTabFormIds(tabKey) {
  const root = $(`#tab-${tabKey}`);
  if (!root) return;
  const seen = new Set();
  let n = 0;
  for (const row of root.querySelectorAll('.row')) {
    const labelText = row.querySelector('label')?.textContent?.trim()?.split('\n')[0]?.trim() || `field_${n}`;
    let slug = slugifyLabel(labelText);
    let baseId = `${tabKey}.${slug}`;
    let suffix = 0;
    while (seen.has(baseId)) { suffix++; baseId = `${tabKey}.${slug}_${suffix}`; }
    seen.add(baseId);
    const all = row.querySelectorAll('input, select, textarea');
    if (all.length > 1) {
      all.forEach((el, i) => { if (!el.id) el.id = `${baseId}.${i}`; });
    } else if (all.length === 1) {
      if (!all[0].id) all[0].id = baseId;
    }
    n++;
  }
}
function captureTabState(tabKey) {
  const root = $(`#tab-${tabKey}`);
  if (!root) return {};
  const data = {};
  for (const inp of root.querySelectorAll('input[id], select[id], textarea[id]')) {
    if (inp.type === 'checkbox') data[inp.id] = inp.checked ? 'on' : 'off';
    else data[inp.id] = inp.value;
  }
  return data;
}
function applyTabState(tabKey, data) {
  if (!data) return;
  const root = $(`#tab-${tabKey}`);
  if (!root) return;
  for (const inp of root.querySelectorAll('input[id], select[id], textarea[id]')) {
    if (!(inp.id in data)) continue;
    if (inp.type === 'checkbox') inp.checked = data[inp.id] === 'on' || data[inp.id] === true;
    else inp.value = data[inp.id];
    // Re-fire input/change so the UI reacts (e.g. has-custom class for combos)
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  }
}
let _stateSaveTimer = null;
// While a batch is running, the prompt textarea is repeatedly overwritten with
// the batch items. Each overwrite fires an `input` event that would otherwise
// schedule a state-save and persist the *batch item* text as the user's
// permanent prompt. Suppress those saves during a batch run.
let _suppressStateSave = 0;
function suppressStateSave(fn) {
  _suppressStateSave++;
  try { return fn(); } finally { _suppressStateSave--; }
}
function scheduleStateSave() {
  if (_suppressStateSave > 0) return;
  clearTimeout(_stateSaveTimer);
  _stateSaveTimer = setTimeout(saveAllStates, 500);
}
async function saveAllStates() {
  const tabs = {};
  for (const tabKey of ['image', 'speech', 'music', 'video']) {
    tabs[tabKey] = captureTabState(tabKey);
  }
  state.tabSettings = tabs;
  await window.api.stateSet({
    tabs,
    currentTab: state.currentTab,
    fbDirs: state.fbDirs,
    // Persist the upscale-on-Generate state alongside the tabs.
    upscaleEnabled: !!state.upscaleEnabled,
    upscaleSettings: state.upscaleSettings || { multiplier: 2 },
    // Global file-name prefix (mirrored on every tab; prepended to
    // every generated file).
    filePrefix: state.filePrefix || '',
    // Real-ESRGAN model name (defaults to the general-purpose 4×
    // BSD-3 model).
    realesrganModel: state.realesrganModel || 'realesrgan-x4plus',
  }).catch(() => {});
}
function setupTabAutosave(tabKey) {
  const root = $(`#tab-${tabKey}`);
  if (!root) return;
  // Save on any change (input for text, change for select/checkbox)
  root.addEventListener('input', scheduleStateSave, true);
  root.addEventListener('change', scheduleStateSave, true);
}

// ----------------- Theme -----------------
function applyTheme(theme) {
  state.theme = (theme === 'light' ? 'light' : 'dark');
  document.documentElement.setAttribute('data-theme', state.theme);
}
function toggleTheme() {
  const next = state.theme === 'light' ? 'dark' : 'light';
  applyTheme(next);
  // Persist immediately
  state.config.theme = next;
  window.api.setConfig(state.config).catch(() => {});
  toast(`Theme: ${next}`, 'ok', 1500);
}

// ----------------- Styles -----------------
function getStyleById(id) {
  if (!id) return null;
  return (state.config.styles || []).find((s) => String(s.name) === id) || null;
}
function getStyleText(id) {
  const s = getStyleById(id);
  return s && s.value ? s.value.trim() : '';
}
function buildStyleRow(tabKey, helpText) {
  // Dropdown listing all style presets. Empty value = no style.
  // The `style-select` class is queried by _refreshAllStyleDropdowns so
  // style add/edit/delete reflects in every open tab without a refresh.
  const sel = el('select', { class: 'style-select' });
  sel.appendChild(el('option', { value: '' }, '(no style)'));
  for (const s of (state.config.styles || [])) {
    const opt = el('option', { value: s.name }, s.name);
    if (s.value && s.value.length > 60) opt.title = s.value;
    sel.appendChild(opt);
  }
  const manage = el('button', { class: 'btn-mini', onclick: () => openStyleSettings(tabKey) }, '⚙');
  const combo = el('div', { class: 'combo' }, [sel, manage]);
  const lbl = el('label', {}, [
    'Style preset (prepended to your prompt)',
    el('span', { class: 'help', 'data-help': helpText, title: helpText }, '?'),
  ]);
  const row = el('div', { class: 'row' }, [lbl, combo]);
  return { row, sel };
}
function buildStylePreviewBlock() {
  return el('div', { class: 'style-preview' });
}
function updateStylePreview(tab, extraPrefix = '') {
  // tab = { previewEl, selEl, manualEl }
  if (!tab || !tab.previewEl) return;
  const selVal = tab.selEl ? tab.selEl.value : '';
  const manual = tab.manualEl ? tab.manualEl.value.trim() : '';
  const styleText = getStyleText(selVal);
  const preview = tab.previewEl;
  preview.innerHTML = '';
  if (!extraPrefix && !styleText && !manual) {
    preview.appendChild(el('span', { class: 'empty' }, 'Will send: (empty prompt)'));
    return;
  }
  if (extraPrefix) {
    preview.appendChild(el('div', {}, [el('span', { class: 'prefix' }, extraPrefix), el('span', {}, ', ')]));
  }
  if (styleText) {
    preview.appendChild(el('div', {}, [el('span', { class: 'prefix' }, styleText), el('span', {}, ', ')]));
  }
  if (manual) {
    preview.appendChild(el('div', {}, [el('span', {}, manual)]));
  }
}
function buildFinalPrompt(selEl, manualEl, extraPrefix = '') {
  const selVal = selEl ? selEl.value : '';
  const manual = manualEl ? manualEl.value.trim() : '';
  const styleText = getStyleText(selVal);
  // Strip trailing whitespace + commas from each part before joining.
  // The instrumental-mode prefix and some style presets already end with
  // a trailing comma — joining with ", " would otherwise produce
  // "no vocals, , manual" (double comma). The trim keeps the join clean.
  const clean = (s) => String(s || '').replace(/[\s,]+$/, '');
  const parts = [extraPrefix, styleText, manual].map(clean).filter(Boolean);
  return parts.join(', ');
}

// ----------------- Bootstrap on DOM ready -----------------
document.addEventListener('DOMContentLoaded', () => {
  init().catch((e) => { console.error(e); toast(String(e), 'err', 8000); });
});
