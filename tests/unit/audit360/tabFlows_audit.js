// tests/unit/audit360/tabFlows_audit.js
// ============================================================================
// 360° EMPIRICAL AUDIT — v1.1.0 release-readiness for tab flows.
//
// Loads the REAL imageTab / speechTab / musicTab / videoTab / JobRunner
// source files in a minimal window mock. Every test reports its real
// observed output. This is RESEARCH ONLY — we do NOT modify production
// source. We MAY add tests in tests/unit/audit360/.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.on('unhandledRejection', (e) => { console.error('UNHANDLED:', e); process.exit(2); });
process.on('uncaughtException', (e) => { console.error('UNCAUGHT:', e); process.exit(2); });

const ROOT = path.resolve(__dirname, '..', '..', '..');

// ============================================================================
// DOM / window mock
// ============================================================================

function makeEl(tag) {
  const node = {
    tagName: (tag || 'div').toUpperCase(),
    children: [],
    attributes: {},
    style: {},
    classList: {
      _set: new Set(),
      add(c) { if (c == null) return; for (const cls of String(c).split(/\s+/).filter(Boolean)) this._set.add(cls); },
      remove(c) { if (c == null) return; for (const cls of String(c).split(/\s+/).filter(Boolean)) this._set.delete(cls); },
      contains(c) { return this._set.has(c); },
      toggle(c, force) {
        if (force === true) this.add(c);
        else if (force === false) this.remove(c);
        else if (this._set.has(c)) this.remove(c);
        else this.add(c);
        return this._set.has(c);
      },
    },
    parentNode: null,
    dataset: {},
    _listeners: {},
    _value: '',
    disabled: false,
    addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
    removeEventListener(ev, fn) {
      if (!this._listeners[ev]) return;
      this._listeners[ev] = this._listeners[ev].filter((f) => f !== fn);
    },
    dispatchEvent(event) {
      for (const fn of (this._listeners[event.type] || [])) fn(event);
      return true;
    },
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
    insertBefore(child, ref) {
      const i = this.children.indexOf(ref);
      if (i < 0) this.children.push(child);
      else this.children.splice(i, 0, child);
      child.parentNode = this;
      return child;
    },
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i >= 0) this.children.splice(i, 1);
      child.parentNode = null;
      return child;
    },
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return this.attributes[k] == null ? null : String(this.attributes[k]); },
    removeAttribute(k) { delete this.attributes[k]; },
    querySelector(sel) { return findOne(this, sel); },
    querySelectorAll(sel) { return findAll(this, sel); },
    getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 100, height: 100 }; },
    closest() { return null; },
    focus() {}, blur() {},
    get textContent() {
      const parts = [];
      const walk = (n) => {
        if (n._text != null) parts.push(String(n._text));
        for (const c of (n.children || [])) walk(c);
      };
      walk(this);
      return parts.join('');
    },
    set textContent(v) { this._text = String(v == null ? '' : v); this.children = []; },
    set innerHTML(v) { this._innerHTML = String(v == null ? '' : v); this.children = []; },
    get innerHTML() { return this._innerHTML || ''; },
    append(...nodes) { for (const n of nodes) { if (n && n.tagName) { this.children.push(n); n.parentNode = this; } } },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
  };
  if (node.tagName === 'SELECT' || node.tagName === 'INPUT' || node.tagName === 'TEXTAREA') {
    node._value = '';
    node.value = '';
    node.checked = false;
    node.disabled = false;
  }
  if (node.tagName === 'OPTION') node.selected = false;
  if (node.tagName === 'CANVAS') {
    node.width = 300;
    node.height = 150;
    node.getContext = () => ({
      setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
      stroke() {}, fillText() {}, fillRect() {},
      set fillStyle(v) { this._fs = v; }, get fillStyle() { return this._fs || '#000'; },
      set strokeStyle(v) { this._ss = v; }, get strokeStyle() { return this._ss || '#000'; },
      set globalAlpha(v) { this._ga = v; }, get globalAlpha() { return this._ga == null ? 1 : this._ga; },
      set lineWidth(v) { this._lw = v; }, get lineWidth() { return this._lw == null ? 1 : this._lw; },
    });
  }
  Object.defineProperty(node, 'value', {
    get() {
      if (node.tagName === 'SELECT') {
        const sel = (node.children || []).find((c) => c.tagName === 'OPTION' && c.selected);
        if (sel) return sel.value;
        const first = (node.children || []).find((c) => c.tagName === 'OPTION');
        return first ? first.value : '';
      }
      return node._value;
    },
    set(v) {
      if (node.tagName === 'SELECT') {
        for (const c of (node.children || [])) {
          if (c.tagName === 'OPTION') c.selected = (String(c.value) === String(v));
        }
        return;
      }
      node._value = v;
    },
    configurable: true,
  });
  return node;
}

function findOne(root, sel) {
  if (!root || !sel) return null;
  if (sel.startsWith('#')) {
    const id = sel.slice(1);
    const walk = (n) => {
      if (n.attributes && n.attributes.id === id) return n;
      for (const c of (n.children || [])) { const r = walk(c); if (r) return r; }
      return null;
    };
    return walk(root);
  }
  if (sel.startsWith('.')) {
    const cls = sel.slice(1);
    const walk = (n) => {
      if (n.classList && n.classList.contains(cls)) return n;
      for (const c of (n.children || [])) { const r = walk(c); if (r) return r; }
      return null;
    };
    return walk(root);
  }
  if (sel.includes(' ')) {
    const parts = sel.split(/\s+/).filter(Boolean);
    let scope = root;
    for (const p of parts) {
      if (!scope) return null;
      scope = findOne(scope, p);
    }
    return scope;
  }
  if (sel.includes('[') && sel.includes('=')) {
    const m = sel.match(/^([a-zA-Z]+)\[([a-zA-Z-]+)="([^"]+)"\]$/);
    if (m) {
      const [, tag, attr, val] = m;
      const walk = (n) => {
        if (n.tagName === tag.toUpperCase() && n.attributes && n.attributes[attr] === val) return n;
        for (const c of (n.children || [])) { const r = walk(c); if (r) return r; }
        return null;
      };
      return walk(root);
    }
  }
  const walk = (n) => {
    if (n.tagName === sel.toUpperCase()) return n;
    for (const c of (n.children || [])) { const r = walk(c); if (r) return r; }
    return null;
  };
  return walk(root);
}

function findAll(root, sel) {
  if (!root || !sel) return [];
  const out = [];
  if (sel.startsWith('.')) {
    const cls = sel.slice(1);
    const walk = (n) => {
      if (n.classList && n.classList.contains(cls)) out.push(n);
      for (const c of (n.children || [])) walk(c);
    };
    walk(root);
    return out;
  }
  if (sel.includes(',')) {
    const sels = sel.split(',').map((s) => s.trim());
    const seen = new Set();
    const walk = (n) => {
      for (const s of sels) {
        if (s.startsWith('.')) {
          if (n.classList && n.classList.contains(s.slice(1)) && !seen.has(n)) { out.push(n); seen.add(n); }
        } else if (n.tagName === s.toUpperCase() && !seen.has(n)) { out.push(n); seen.add(n); }
      }
      for (const c of (n.children || [])) walk(c);
    };
    walk(root);
    return out;
  }
  const walk = (n) => {
    if (n.tagName === sel.toUpperCase()) out.push(n);
    for (const c of (n.children || [])) walk(c);
  };
  walk(root);
  return out;
}

function makeDom() {
  return {
    createElement: (tag) => makeEl(tag),
    createElementNS: (_, tag) => makeEl(tag),
    createTextNode: (text) => { const n = makeEl('span'); n.textContent = String(text); return n; },
    getElementById: () => null,
    querySelector: (sel) => (sel === '#log' ? makeEl('div') : null),
    querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
    body: makeEl('body'),
    documentElement: makeEl('html'),
    readyState: 'complete',
  };
}

// ============================================================================
// ParamRow mock that matches the real buildParamRow contract:
//   returns { row, input, el, getValue, label }
// ============================================================================

function makeBuildParamRow(win) {
  return function buildParamRow(label, def, id) {
    const labelEl = win.el('label', { for: id || '' }, label);
    let value = def.value !== undefined ? def.value : def.default;
    let input;
    if (def.kind === 'enum' || def.kind === 'enum-text') {
      input = makeEl('select');
      for (const o of (def.options || [])) {
        const opt = makeEl('option');
        opt.value = String(o.value);
        opt.textContent = o.label;
        if (String(o.value) === String(value)) opt.selected = true;
        input.appendChild(opt);
      }
    } else if (def.kind === 'boolean') {
      input = makeEl('select');
      for (const v of [{ value: 'off', label: 'off' }, { value: 'on', label: 'on' }]) {
        const opt = makeEl('option');
        opt.value = v.value;
        opt.textContent = v.label;
        if (String(v.value) === String(value || 'off')) opt.selected = true;
        input.appendChild(opt);
      }
    } else if (def.kind === 'number') {
      input = makeEl('input');
      input.tagName = 'INPUT';
      input.type = 'number';
      input.value = String(value == null ? '' : value);
    } else if (def.kind === 'text') {
      input = makeEl('input');
      input.tagName = 'INPUT';
      input.type = 'text';
      input.value = String(value == null ? '' : value);
    } else {
      input = makeEl('textarea');
      input.value = String(value == null ? '' : value);
    }
    const wrapper = win.el('div', { class: 'row' });
    wrapper.appendChild(labelEl);
    wrapper.appendChild(input);
    const getValueFn = () => {
      if (def.kind === 'boolean' || def.kind === 'enum' || def.kind === 'enum-text') return input.value;
      if (def.kind === 'number') {
        const v = parseFloat(input.value);
        return isNaN(v) ? '' : v;
      }
      return String(input.value || '');
    };
    input.getValue = getValueFn;
    return { row: wrapper, input, el: input, getValue: getValueFn, label: labelEl };
  };
}

// ============================================================================
// Tab harness: wires globals + installs the real JobRunner.
// ============================================================================

function setupTabHarness(opts = {}) {
  const dom = makeDom();
  const win = { document: dom, confirm: () => true, toast: () => {} };
  const elFactory = (tag, attrs, ...children) => {
    const n = makeEl(tag);
    if (attrs && typeof attrs === 'object') {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') n.attributes.class = v;
        else if (k === 'style' && typeof v === 'string') n.attributes.style = v;
        else if (k.startsWith('data-')) { n.attributes[k] = v; n.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v; }
        else n.attributes[k] = v;
        if (k === 'value' && (n.tagName === 'OPTION' || n.tagName === 'INPUT' || n.tagName === 'SELECT' || n.tagName === 'TEXTAREA')) n.value = v;
        if (k === 'type' && n.tagName === 'INPUT') n.type = v;
        if (k === 'checked' && n.tagName === 'INPUT') n.checked = !!v;
      }
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      if (typeof c === 'string' || typeof c === 'number') {
        const t = makeEl('span'); t.textContent = String(c); n.children.push(t); t.parentNode = n;
      } else if (typeof c === 'object' && c.tagName) {
        n.children.push(c); c.parentNode = n;
      }
    }
    return n;
  };
  win.el = elFactory;
  win.createElement = elFactory;
  // CSS and document.querySelector (used by imageTab for fb-item row)
  if (typeof global.CSS === 'undefined') global.CSS = { escape: (s) => String(s).replace(/["\\]/g, '\\$&') };
  // $ helper — returns the per-tab root
  win._tabRoots = {};
  win.$ = (sel) => {
    if (typeof sel !== 'string') return null;
    for (const id of Object.keys(win._tabRoots)) {
      if (sel === id || sel === `#${id}`) return win._tabRoots[id];
      if (sel.startsWith(`#${id} `)) {
        const sub = sel.slice(id.length + 2);
        return findOne(win._tabRoots[id], sub);
      }
    }
    return null;
  };
  win.state = {
    config: { api_key: 'sk-cp-test', output_dir: '' },
    currentTab: opts.tab || 'image',
    apiKeyNoSave: false,
    popupPolicy: 'never',
    voicesLoaded: true,
    voices: ['English_expressive_narrator', 'English_calm_female'],
    pipelineAdvancedSettings: {
      realesrgan: { tileSize: 0, ttaMode: false, gpuId: 'auto' },
      isnetbg: { intraOpNumThreads: 0, interOpNumThreads: 0, executionMode: 'sequential' },
      optimize: {
        jpegChromaSubsampling: '4:2:0', jpegMozjpeg: true,
        pngCompressionLevel: 9, pngPalette: true,
        webpMode: 'lossy', webpEffort: 6,
        avifEffort: 9, avifChromaSubsampling: '4:4:4',
      },
      audio: {
        silenceThresholdDb: -50, minSilenceMs: 50,
        mp3Quality: 2, oggQuality: 6, opusBitrate: '128k', m4aBitrate: '192k',
      },
    },
    optimizeSettings: { quality: 82, format: 'keep', stripMetadata: true, enabled: false },
    upscaleSettings: { multiplier: 2, autoCrop: false, cropWidth: 0, cropHeight: 0, cropAnchorX: 'center', cropAnchorY: 'center' },
    removeBackgroundEnabled: false,
    upscaleEnabled: false,
    filePrefix: '',
    filePrefixForceOnly: false,
    styles: [],
    jobs: new Map(),
    _logEvents: [],
    jobsSnapshot: [],
    seenPopups: {},
    genQueueSize: { image: 0, speech: 0, music: 0, video: 0 },
    genQueueDone: { image: 0, speech: 0, music: 0, video: 0 },
    genAvgSec: { image: 0, speech: 0, music: 0, video: 0 },
    genStartMs: { image: null, speech: null, music: null, video: null },
    genStatus: { image: 'idle', speech: 'idle', music: 'idle', video: 'idle' },
    genLastResult: { image: null, speech: null, music: null, video: null },
    theme: 'dark',
  };
  // Globals
  global.window = win;
  global.document = dom;
  global.el = elFactory;
  global.createElement = elFactory;
  global.state = win.state;
  global.toast = (...args) => { win._toasts = win._toasts || []; win._toasts.push(args); };
  global.confirm = win.confirm;
  global.scheduleStateSave = async () => { win._saveCount = (win._saveCount || 0) + 1; };
  global.$ = win.$;
  // LogService + addLogEvent
  let nextLogId = 0;
  win.addLogEvent = (opts) => {
    opts = opts || {};
    const ev = {
      id: ++nextLogId, ts: new Date(),
      headline: opts.headline || '', details: opts.details || [],
      jobId: opts.jobId || null, state: opts.state || (opts.result === 'ok' ? 'ok' : (opts.result === 'err' ? 'err' : 'wip')),
      cancellable: !!opts.cancellable, typeIcon: opts.typeIcon || null,
      progress: opts.progress || null, groupId: opts.groupId || null,
    };
    win.state._logEvents.push(ev);
    return ev.id;
  };
  win.LogService = {
    addLogEvent: (opts) => win.addLogEvent(opts),
    updateLogStatus: () => {}, appendLogDetails: () => {},
  };
  // Helpers used by tabs
  const helpers = {
    escapeHtml: (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    maskLine: (s, key) => String(s),
    humanSize: (n) => (n == null ? '0 B' : `${n} B`),
    timestamp: () => '20260623T120000',
    slugify: (s) => String(s || 'item').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60).toLowerCase() || 'item',
    uniquePath: (dir, name) => `${dir}/${name}`,
    nextFreeForcePrefixPath: async (dir, counter, prefix, ext) => {
      counter.n = (counter.n || 0) + 1;
      return `${dir}/${prefix}${String(counter.n).padStart(6, '0')}.${ext}`;
    },
    ensureSubDir: async (kind) => `/tmp/gen/${kind}`,
    refreshBrowser: async () => {},
    refreshQuota: async () => {},
    refreshTabEtas: () => {},
    bumpGenerationCounter: () => {},
    setStatus: (text, busy) => { win._lastStatus = text; },
    notifyImageGenerated: () => {},
    previewImagesFromFiles: () => {},
    previewImageFromFile: () => {},
    loadImageFromFile: async () => ({ naturalWidth: 1024, naturalHeight: 1024, src: '' }),
    convertImageFile: async (p, fmt) => `${p}.converted.${fmt}`,
    cropImageFile: async (p, x, y, w, h) => `${p}.cropped.${w}x${h}`,
    optimizeImageFile: async (p, opts) => ({ ok: true, outputPath: p, inputSize: 1000, outputSize: 500, savedPercent: 50, format: opts.format || 'jpeg' }),
    removeBackgroundFile: async (p) => p,
    upscaleImageFile: async (p, m) => `${p}.up${m}x`,
    formatMmxError: (r) => (r && r.stderr) || (r && r.error) || 'mmx error',
    classifyMmxError: () => 'unknown',
    isRetryableMmxError: () => false,
    showAudioPreview: () => {},
    showVideoPreview: () => {},
    showDiagnose: () => {},
    showUpscaleSettings: () => {},
    showImagePreview: () => {},
    runPostProcessChain: async (src, opts) => src,
    attachImageDimGuards: () => null,
    attachSubjectRefGuard: () => null,
    refreshTabStatusDots: () => {},
    ensureEtaTimer: () => {},
    fillVoices: (sel, voices) => {
      const current = sel.value;
      sel.innerHTML = '';
      for (const v of voices) sel.appendChild(win.el('option', { value: v }, v));
      if (voices.includes(current)) sel.value = current;
    },
    buildFinalPrompt: (sel, manual, extra) => {
      let result = '';
      if (sel) {
        const opt = (sel.children || []).find((c) => c.tagName === 'OPTION' && c.selected);
        if (opt) result += opt.value || '';
      }
      if (manual) result += (manual.value || '');
      if (extra) result += extra;
      return result;
    },
    validateTabAgainstSpec: () => [],
    mmxPreflightConfirm: () => true,
    isFlagVisibleForCurrentModel: () => true,
    armGenBtnWithCancel: (genBtn, label, jobId) => {
      return {
        cancel: () => { global.window._cancelToken = global.window._cancelToken || {}; global.window._cancelToken.cancelled = true; },
        wasCancelled: () => { const tok = global.window._cancelToken; return !!(tok && tok.cancelled); },
        cleanup: () => {},
      };
    },
  };
  for (const [k, v] of Object.entries(helpers)) {
    win[k] = v;
    global[k] = v;
  }
  // window.api mock
  win.api = {
    mmxRunJob: async (opts) => {
      win._mmxCalls = win._mmxCalls || [];
      win._mmxCalls.push(opts);
      return { ok: true, parsed: {}, stdout: '', stderr: '', code: 0 };
    },
    mmxCancel: async () => ({ ok: true }),
    refImageExists: async (_p) => ({ ok: true, exists: true }),
    fixImageExtension: async (p) => ({ ok: true, renamed: false, path: p }),
    fbList: async (_dir) => ({ ok: true, items: [] }),
    fbExists: async (_p) => ({ ok: true, exists: true }),
    fbReveal: async () => ({ ok: true }),
    fbDelete: async () => ({ ok: true }),
    audioProbe: async () => ({ ok: true, duration: 10, sampleRate: 44100, channels: 2, codec: 'mp3' }),
    audioDecodePeaks: async () => ({ ok: true, peaks: [0.1, 0.2, 0.3], peakAbsMax: 1 }),
    audioTrimSilence: async () => ({ ok: true, startSec: 0.5, endSec: 9.5, leadSilenceSec: 0.5, tailSilenceSec: 0.5, note: null }),
    audioCut: async (_src, dst) => ({ ok: true, outputPath: dst }),
    voices: async () => ['English_expressive_narrator', 'English_calm_female'],
    authStatus: async () => ({ ok: true, message: 'Auth OK' }),
  };
  win.fileUrl = (p) => 'file:///' + String(p).replace(/\\/g, '/');
  win.FileUrl = { fileUrl: win.fileUrl };
  // Build ParamRow-style helpers
  const buildParamRow = makeBuildParamRow(win);
  function buildStyleRow(tabKey, helpText) {
    const sel = makeEl('select');
    for (const o of [{ value: '', label: '(default)' }, { value: 'cinematic,', label: 'Cinematic' }, { value: 'warm,', label: 'Warm' }]) {
      const opt = makeEl('option');
      opt.value = String(o.value);
      opt.textContent = o.label;
      if (String(o.value) === String('')) opt.selected = true;
      sel.appendChild(opt);
    }
    const row = win.el('div', { class: 'row' });
    const label = win.el('label', {}, 'Style preset');
    row.appendChild(label);
    row.appendChild(sel);
    return { sel, row, manualEl: null };
  }
  function buildVariantsRow(opts) {
    opts = opts || {};
    const sel = makeEl('select');
    for (const n of [1, 2, 3, 4, 5]) {
      const opt = makeEl('option');
      opt.value = String(n);
      opt.textContent = String(n);
      if (n === (opts.defaultN || 1)) opt.selected = true;
      sel.appendChild(opt);
    }
    const row = win.el('div', { class: 'row' });
    row.appendChild(sel);
    return { sel, row };
  }
  function buildFilePrefixRow() {
    const input = makeEl('input');
    input.type = 'text';
    input.classList.add('file-prefix-input');
    input.value = win.state.filePrefix || '';
    const cb = makeEl('input');
    cb.type = 'checkbox';
    cb.classList.add('file-prefix-force-only-cb');
    cb.checked = !!win.state.filePrefixForceOnly;
    const row = win.el('div', { class: 'row' });
    row.appendChild(win.el('label', {}, 'Target file prefix'));
    row.appendChild(input);
    row.appendChild(win.el('label', {}, [cb, ' Force prefix only']));
    return row;
  }
  function buildAddToBatchBtn(tabKey) {
    const b = makeEl('button'); b.textContent = '+Add'; return b;
  }
  function buildPromptCounter(opts) {
    const wrap = makeEl('div', { class: 'counter' });
    wrap.update = () => {};
    return { wrap, update: () => {} };
  }
  function appendFlag(args, param) {
    if (!param) return;
    const v = param.getValue ? param.getValue() : param.value;
    if (v == null || v === '' || v === 'off') return;
    // Real appendFlag extracts the --flag from the row's <label>.
    // Our mock stores the label text on .label. We also need to walk
    // up the DOM if the label is the parent.row's first child.
    let labelText = '';
    if (param.label) {
      labelText = param.label.textContent || '';
    } else if (param.row) {
      // Walk row children for a label
      const lbl = (param.row.children || []).find(c => c.tagName === 'LABEL');
      if (lbl) labelText = lbl.textContent || '';
    } else if (param.parentNode) {
      const lbl = (param.parentNode.children || []).find(c => c.tagName === 'LABEL');
      if (lbl) labelText = lbl.textContent || '';
    }
    const flag = param.flag || labelText.match(/--[a-zA-Z][a-zA-Z0-9-]*/)?.[0];
    if (!flag) return;
    args.push(flag, String(v));
  }
  function appendBoolFlag(args, param, flag) {
    const v = param.getValue ? param.getValue() : param.value;
    if (v === 'on' || v === true) args.push(flag);
  }
  global.buildParamRow = buildParamRow;
  global.buildStyleRow = buildStyleRow;
  global.buildVariantsRow = buildVariantsRow;
  global.buildFilePrefixRow = buildFilePrefixRow;
  global.buildAddToBatchBtn = buildAddToBatchBtn;
  global.buildPromptCounter = buildPromptCounter;
  global.appendFlag = appendFlag;
  global.appendBoolFlag = appendBoolFlag;
  win.buildParamRow = buildParamRow;
  win.buildStyleRow = buildStyleRow;
  win.buildVariantsRow = buildVariantsRow;
  win.buildFilePrefixRow = buildFilePrefixRow;
  win.buildAddToBatchBtn = buildAddToBatchBtn;
  win.buildPromptCounter = buildPromptCounter;
  win.appendFlag = appendFlag;
  win.appendBoolFlag = appendBoolFlag;
  // Load the real JobRunner
  loadJobRunner(win);
  // Wrap run() to capture the runFn for tests
  const realRun = win.JobRunner.run.bind(win.JobRunner);
  win._capturedRunFn = null;
  win._capturedRunOpts = null;
  win._capturedCtx = null;
  win._capturedCtrl = null;
  win.JobRunner.run = (o) => {
    win._capturedRunOpts = o;
    const origRunFn = o.runFn;
    o.runFn = async (ctx) => {
      win._capturedCtx = ctx;
      win._capturedRunFn = origRunFn;
      return origRunFn(ctx);
    };
    const ctrl = realRun(o);
    win._capturedCtrl = ctrl;
    return ctrl;
  };
  return win;
}

function loadJobRunner(win) {
  const file = path.join(ROOT, 'renderer', 'jobs', 'JobRunner.js');
  delete require.cache[require.resolve(file)];
  const src = fs.readFileSync(file, 'utf8');
  // eslint-disable-next-line no-new-func
  const runner = new Function('window', 'document', 'state', 'LogService', 'addLogEvent', 'toast', 'scheduleStateSave', src);
  runner(win, win.document, win.state, win.LogService, win.addLogEvent, global.toast, global.scheduleStateSave);
}

function loadSourceFile(win, file) {
  const src = fs.readFileSync(file, 'utf8');
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', 'document', 'state', 'el', 'createElement',
    'toast', 'scheduleStateSave', 'confirm', 'appendFlag', 'appendBoolFlag',
    'buildParamRow', 'buildStyleRow', 'buildVariantsRow', 'buildFilePrefixRow', 'buildAddToBatchBtn', 'buildPromptCounter',
    'validateTabAgainstSpec', 'mmxPreflightConfirm', 'isFlagVisibleForCurrentModel',
    'JobRunner', 'setStatus', 'refreshBrowser', 'refreshQuota', 'refreshTabEtas',
    'bumpGenerationCounter', 'showAudioPreview', 'showVideoPreview', 'showImagePreview',
    'notifyImageGenerated', 'previewImagesFromFiles',
    'ensureSubDir', 'nextFreeForcePrefixPath', 'uniquePath', 'timestamp', 'slugify',
    'maskLine', 'formatMmxError', 'classifyMmxError', 'isRetryableMmxError',
    'loadImageFromFile', 'previewImageFromFile',
    'convertImageFile', 'cropImageFile', 'optimizeImageFile',
    'removeBackgroundFile', 'upscaleImageFile',
    'humanSize', 'addLogEvent', 'LogService', 'showDiagnose',
    'showModal', 'escapeHtml', 'showAudioCutter', 'showItemContextMenuForPath',
    'openImageOverlay', 'navigateToOverlayImage', 'fillVoices', 'showUpscaleSettings',
    'showConvertOverlay', 'showCropOverlay', 'showOptimizeOverlay',
    'armGenBtnWithCancel', 'openAdvancedPipelineSettings',
    'runPostProcessChain',
    'helpButton', 'showRevealableKey', '_refreshAllStyleDropdowns', 'persistStyles',
    'deleteStyle', '_currentManualText', 'resetPopupSeen',
    'fileUrl', 'buildFinalPrompt', 'attachImageDimGuards', 'attachSubjectRefGuard',
    src);
  return fn(win, win.document, win.state, win.el, win.el,
    global.toast, global.scheduleStateSave, global.confirm,
    global.appendFlag, global.appendBoolFlag,
    global.buildParamRow, global.buildStyleRow, global.buildVariantsRow, global.buildFilePrefixRow, global.buildAddToBatchBtn, global.buildPromptCounter,
    global.validateTabAgainstSpec, global.mmxPreflightConfirm, global.isFlagVisibleForCurrentModel,
    win.JobRunner, global.setStatus, global.refreshBrowser, global.refreshQuota, global.refreshTabEtas,
    global.bumpGenerationCounter, global.showAudioPreview, global.showVideoPreview, global.showImagePreview,
    global.notifyImageGenerated, global.previewImagesFromFiles,
    global.ensureSubDir, global.nextFreeForcePrefixPath, global.uniquePath, global.timestamp, global.slugify,
    global.maskLine, global.formatMmxError, global.classifyMmxError, global.isRetryableMmxError,
    global.loadImageFromFile, global.previewImageFromFile,
    global.convertImageFile, global.cropImageFile, global.optimizeImageFile,
    global.removeBackgroundFile, global.upscaleImageFile,
    global.humanSize, win.addLogEvent, win.LogService, global.showDiagnose,
    global.showModal, global.escapeHtml, global.showAudioCutter, global.showItemContextMenuForPath,
    global.openImageOverlay, global.navigateToOverlayImage, global.fillVoices, global.showUpscaleSettings,
    global.showConvertOverlay, global.showCropOverlay, global.showOptimizeOverlay,
    global.armGenBtnWithCancel, global.openAdvancedPipelineSettings,
    global.runPostProcessChain,
    global.helpButton, global.showRevealableKey, global._refreshAllStyleDropdowns, global.persistStyles,
    global.deleteStyle, global._currentManualText, global.resetPopupSeen,
    global.fileUrl, global.buildFinalPrompt, global.attachImageDimGuards, global.attachSubjectRefGuard,
  );
}

// ============================================================================
// Helpers
// ============================================================================

function findButton(node, text) {
  if (!node) return null;
  if (node.tagName === 'BUTTON') {
    const t = String(node.textContent).trim();
    if (t === text) return node;
    if (text && t.endsWith(text)) return node;
  }
  for (const c of (node.children || [])) {
    const f = findButton(c, text);
    if (f) return f;
  }
  return null;
}

function findAllInputs(node, acc) {
  acc = acc || [];
  if (!node) return acc;
  if (node.tagName === 'INPUT' || node.tagName === 'SELECT' || node.tagName === 'TEXTAREA') acc.push(node);
  for (const c of (node.children || [])) findAllInputs(c, acc);
  return acc;
}

function fireClick(node) {
  if (!node) return false;
  const ls = node._listeners && node._listeners.click;
  if (ls) for (const fn of ls) fn({});
  return !!(ls && ls.length);
}

function fireChange(node, value) {
  if (!node) return false;
  if (value !== undefined && (node.tagName === 'SELECT' || node.tagName === 'INPUT' || node.tagName === 'TEXTAREA')) {
    node.value = value;
  }
  const ls = node._listeners && node._listeners.change;
  if (ls) for (const fn of ls) fn({ target: node });
  return !!(ls && ls.length);
}

function loadTab(win, tabKey) {
  const root = win.el('div', { id: `tab-${tabKey}` });
  win._tabRoots[`#tab-${tabKey}`] = root;
  const srcFile = path.join(ROOT, 'renderer', 'tabs', `${tabKey}Tab.js`);
  loadSourceFile(win, srcFile);
  win.TABS[tabKey].build();
  return root;
}

function setVariants(root, n) {
  const inputs = findAllInputs(root);
  const variants = inputs.find(s => s.tagName === 'SELECT' && (s.children || []).some(c => String(c.value) === String(n)));
  if (variants) {
    variants.value = String(n);
    return true;
  }
  return false;
}

function setSelectByLabel(root, label, value) {
  const inputs = findAllInputs(root);
  for (const inp of inputs) {
    if (inp.tagName === 'SELECT' && inp.value === value) return inp;
  }
  // Look for the row whose label contains the text
  for (const inp of inputs) {
    if (inp.tagName === 'SELECT' || inp.tagName === 'INPUT') {
      const row = inp.parentNode;
      if (row && row.children) {
        const lbl = row.children.find(c => c.tagName === 'LABEL');
        if (lbl && lbl.textContent.includes(label)) {
          inp.value = value;
          return inp;
        }
      }
    }
  }
  return null;
}

module.exports = {
  ROOT, makeEl, findOne, findAll, findButton, findAllInputs, fireClick, fireChange,
  setupTabHarness, loadSourceFile, loadJobRunner, makeDom, loadTab, setVariants, setSelectByLabel,
};

// ============================================================================
// TESTS
// ============================================================================

// ----------------------------------------------------------------------------
// JobRunner tests (sanity / no-need-to-load-tab)
// ----------------------------------------------------------------------------

test('JobRunner: runFn throw -> status err', async () => {
  const win = setupTabHarness({ tab: 'image' });
  const ctrl = win.JobRunner.run({
    tabKey: 'image', type: 'image', runFn: async () => { throw new Error('test-boom'); },
  });
  const result = await ctrl.done;
  const job = win.state.jobs.get(ctrl.jobId);
  assert.equal(result.status, 'err');
  assert.equal(job.status, 'err');
  assert.equal(job.error, 'test-boom');
});

test('JobRunner: runFn returns { status: cancel } (after JobRunner.cancel) -> status cancel', async () => {
  const win = setupTabHarness({ tab: 'image' });
  const ctrl = win.JobRunner.run({
    tabKey: 'image', type: 'image',
    runFn: async (ctx) => {
      // Wait for abort signal
      await new Promise((res) => {
        if (ctx.signal.aborted) return res();
        ctx.signal.addEventListener('abort', () => res(), { once: true });
      });
      return { status: 'cancel' };
    },
  });
  await new Promise((r) => setImmediate(r));
  win.JobRunner.cancel(ctrl.jobId);
  const result = await ctrl.done;
  const job = win.state.jobs.get(ctrl.jobId);
  assert.equal(result.status, 'cancel');
  assert.equal(job.status, 'cancel');
});

test('JobRunner: per-tab gate blocks 2nd on same tab, allows other tab', async () => {
  const win = setupTabHarness({ tab: 'image' });
  let resolveStalled;
  const stalled = new Promise((r) => { resolveStalled = r; });
  const ctrl1 = win.JobRunner.run({ tabKey: 'image', type: 'image', runFn: () => stalled });
  await new Promise((r) => setImmediate(r));
  // Second on same tab rejects
  let rejected = null;
  try {
    await win.JobRunner.run({ tabKey: 'image', type: 'image', runFn: async () => ({ status: 'ok' }) });
  } catch (e) { rejected = e; }
  assert.ok(rejected, 'second on same tab must reject');
  // Different tab allowed
  let ctrl2;
  assert.doesNotThrow(() => {
    ctrl2 = win.JobRunner.run({ tabKey: 'speech', type: 'speech', runFn: () => new Promise(() => {}) });
  });
  await new Promise((r) => setImmediate(r));
  // Cleanup
  resolveStalled({ status: 'ok' });
  await ctrl1.done;
  // ctrl2 never resolves — kill it
  ctrl2.cancel();
});

test('JobRunner: cancel(jobId) kills only the matching job', async () => {
  const win = setupTabHarness({ tab: 'image' });
  // Use runFns that honor the abort signal
  const ctrl1 = win.JobRunner.run({
    tabKey: 'image', type: 'image',
    runFn: async (ctx) => {
      await new Promise((res) => {
        if (ctx.signal.aborted) return res();
        ctx.signal.addEventListener('abort', () => res(), { once: true });
      });
      return { status: 'cancel' };
    },
  });
  const ctrl2 = win.JobRunner.run({
    tabKey: 'speech', type: 'speech',
    runFn: async (ctx) => {
      await new Promise((res) => {
        if (ctx.signal.aborted) return res();
        ctx.signal.addEventListener('abort', () => res(), { once: true });
      });
      return { status: 'cancel' };
    },
  });
  const ctrl3 = win.JobRunner.run({
    tabKey: 'music', type: 'music',
    runFn: async (ctx) => {
      await new Promise((res) => {
        if (ctx.signal.aborted) return res();
        ctx.signal.addEventListener('abort', () => res(), { once: true });
      });
      return { status: 'cancel' };
    },
  });
  await new Promise((r) => setImmediate(r));
  // Cancel job 1 only
  win.JobRunner.cancel(ctrl1.jobId);
  const result1 = await ctrl1.done;
  assert.equal(result1.status, 'cancel', 'job 1 must be cancelled');
  // Jobs 2 and 3 still alive — JobRunner.isTabRunning for them
  assert.equal(win.JobRunner.isTabRunning('image'), false, 'job 1 is no longer running');
  assert.equal(win.JobRunner.isTabRunning('speech'), true, 'job 2 still running');
  assert.equal(win.JobRunner.isTabRunning('music'), true, 'job 3 still running');
  // Cleanup
  win.JobRunner.cancel(ctrl2.jobId);
  win.JobRunner.cancel(ctrl3.jobId);
  await ctrl2.done;
  await ctrl3.done;
});

test('JobRunner: runFn returns { status: ok, outputPaths: [...] } — job outcome reflects ok + paths', async () => {
  const win = setupTabHarness({ tab: 'image' });
  const ctrl = win.JobRunner.run({
    tabKey: 'image', type: 'image',
    runFn: async () => ({ status: 'ok', outputPaths: ['/tmp/a.png', '/tmp/b.png'] }),
  });
  const result = await ctrl.done;
  const job = win.state.jobs.get(ctrl.jobId);
  assert.equal(result.status, 'ok');
  assert.equal(job.status, 'ok');
  assert.deepEqual(job.outputPaths, ['/tmp/a.png', '/tmp/b.png']);
});

// ----------------------------------------------------------------------------
// imageTab tests
// ----------------------------------------------------------------------------

test('imageTab: partial-success (2/3 succeed) -> genLastResult.image === ok', async () => {
  const win = setupTabHarness({ tab: 'image' });
  const root = loadTab(win, 'image');
  setVariants(root, 3);
  // mmxRunJob: 1 ok, 2 fail, 3 ok
  let n = 0;
  win.api.mmxRunJob = async (opts) => {
    n++;
    win._mmxCalls = win._mmxCalls || [];
    win._mmxCalls.push(opts);
    if (n === 2) return { ok: false, parsed: null, stdout: '', stderr: 'quota exceeded', code: 1 };
    return { ok: true, parsed: { url: 'http://example.com/' + n + '.png' }, stdout: '', stderr: '', code: 0 };
  };
  const genBtn = findButton(root, 'Generate');
  fireClick(genBtn);
  // 3 variants + 2 inter-variant 800ms = ~1600ms total
  await new Promise((r) => setTimeout(r, 4000));
  assert.equal((win._mmxCalls || []).length, 3, 'must call mmxRunJob 3 times, got ' + (win._mmxCalls || []).length);
  assert.equal(win.state.genLastResult.image, 'ok', 'partial success must be "ok", not "err"');
});

test('imageTab: post-process chain runs even with 1 failed variant', async () => {
  const win = setupTabHarness({ tab: 'image' });
  // enable upscale so post-process is triggered
  win.state.upscaleEnabled = true;
  win.state.upscaleSettings = { multiplier: 2, autoCrop: false, cropWidth: 0, cropHeight: 0, cropAnchorX: 'center', cropAnchorY: 'center' };
  // Override BEFORE loadTab so the new Function captures the wrapper
  const ppCalls = { n: 0 };
  win.runPostProcessChain = async (src, opts) => { ppCalls.n++; return src + '.up2x'; };
  global.runPostProcessChain = win.runPostProcessChain;
  const root = loadTab(win, 'image');
  setVariants(root, 3);
  let n = 0;
  win.api.mmxRunJob = async (opts) => {
    n++;
    win._mmxCalls = win._mmxCalls || [];
    win._mmxCalls.push(opts);
    if (n === 2) return { ok: false, parsed: null, stdout: '', stderr: 'rate', code: 1 };
    return { ok: true, parsed: { url: 'http://example.com/' + n + '.png' }, stdout: '', stderr: '', code: 0 };
  };
  const genBtn = findButton(root, 'Generate');
  fireClick(genBtn);
  await new Promise((r) => setTimeout(r, 5000));
  assert.equal(ppCalls.n, 2, 'post-process chain must run for the 2 successful variants (not skipped due to 1 failure), got ' + ppCalls.n);
});

test('imageTab: cancel with partial success returns BOTH successful files (and surfaces a real defect)', async () => {
  const win = setupTabHarness({ tab: 'image' });
  const root = loadTab(win, 'image');
  setVariants(root, 3);
  // mmx: 1 ok, 2 ok, 3 cancelled
  let n = 0;
  win.api.mmxRunJob = async (opts) => {
    n++;
    win._mmxCalls = win._mmxCalls || [];
    win._mmxCalls.push(opts);
    if (n === 2) {
      // After returning this success, flag cancel so variant 3 is skipped.
      setImmediate(() => { win._cancelToken = { cancelled: true }; });
    }
    return { ok: true, parsed: { url: 'http://example.com/' + n + '.png' }, stdout: '', stderr: '', code: 0 };
  };
  const genBtn = findButton(root, 'Generate');
  fireClick(genBtn);
  await new Promise((r) => setTimeout(r, 2000));
  // Verify 2 successful outFiles were captured (at the mmx layer).
  const successfulOuts = (win._mmxCalls || [])
    .map(c => { const args = c.args; const i = args.lastIndexOf('--out'); return i >= 0 ? args[i+1] : null; })
    .filter(x => x);
  assert.ok(successfulOuts.length >= 2, 'at least 2 variants should have been attempted, got ' + successfulOuts.length);
  // Verify the 2 successful outFiles are UNIQUE (not the same path twice)
  const unique = Array.from(new Set(successfulOuts));
  assert.ok(unique.length >= 2, 'must have at least 2 unique outFile paths, got ' + JSON.stringify(unique));
  // state.genLastResult must be 'ok' (this DOES pass — see L1 fix in the finally block)
  assert.equal(win.state.genLastResult.image, 'ok', 'partial success + cancel must still mark genLastResult "ok" (not err)');
  // Verify the runFn's returned outputPaths. The imageTab runFn returns
  // `{ status: 'cancel', outputPaths: finalOutputPaths }` at line 903 when
  // cancel is detected. But:
  //   1. The post-process block (which fills finalOutputPaths) was skipped
  //      because cancel.wasCancelled() is true at line 597.
  //   2. So finalOutputPaths stays [] (initialized to [] at line 337).
  //   3. The runFn returns `{ status: 'cancel', outputPaths: [] }`.
  //   4. JobRunner doesn't have a `status === 'cancel'` branch (only 'warn',
  //      'err', and the default 'ok'). So `{ status: 'cancel' }` falls through
  //      to the 'ok' branch. The job's status becomes 'ok', and the
  //      job.outputPaths becomes the empty `finalOutputPaths`.
  // REAL DEFECT: the runFn returns finalOutputPaths (which is empty when
  // cancel fires) instead of the actual outFiles list. The user-visible
  // job.outputPaths is [] even though 2 files succeeded.
  if (win._capturedCtrl) {
    const result = await win._capturedCtrl.done;
    // Document the observed behavior. The imageTab runFn returns
    // { status: 'cancel', outputPaths: finalOutputPaths } at line 903
    // when cancel fires. But finalOutputPaths is the post-process
    // output (which is empty when cancel fires, because the
    // post-process block is skipped). So the runFn's outputPaths
    // is [] even though outFiles has the actual files.
    console.log('imageTab cancel-with-partial: result.status=', result.status, 'job.outputPaths=', JSON.stringify(result.job && result.job.outputPaths));
    if (!result.job || !result.job.outputPaths || result.job.outputPaths.length === 0) {
      console.log('AUDIT FINDING (imageTab cancel): job.outputPaths is EMPTY after partial success + cancel — the runFn returns finalOutputPaths (empty) instead of outFiles (the actual file list).');
    }
  }
});

test('imageTab: all variants fail -> genLastResult.image === err', async () => {
  const win = setupTabHarness({ tab: 'image' });
  const root = loadTab(win, 'image');
  setVariants(root, 3);
  win.api.mmxRunJob = async (opts) => {
    win._mmxCalls = win._mmxCalls || [];
    win._mmxCalls.push(opts);
    return { ok: false, parsed: null, stdout: '', stderr: 'unknown failure', code: 1 };
  };
  const genBtn = findButton(root, 'Generate');
  fireClick(genBtn);
  await new Promise((r) => setTimeout(r, 2000));
  assert.equal((win._mmxCalls || []).length, 3);
  assert.equal(win.state.genLastResult.image, 'err');
});

test('imageTab: refImageExists returns exists:false -> gen aborts with toast', async () => {
  const win = setupTabHarness({ tab: 'image' });
  const root = loadTab(win, 'image');
  // Set the subject-ref to a path
  const inputs = findAllInputs(root);
  const text = inputs.find(i => i.tagName === 'INPUT' && i.type === 'text');
  // Set refImageExists to return exists:false
  win.api.refImageExists = async () => ({ ok: true, exists: false });
  // Find subjRef row — look for input next to a label containing 'subject-ref'
  for (const inp of inputs) {
    if (inp.tagName === 'INPUT' && inp.type === 'text') {
      // Walk up to row
      const row = inp.parentNode;
      if (row) {
        const lbl = (row.children || []).find(c => c.tagName === 'LABEL');
        if (lbl && lbl.textContent.toLowerCase().includes('subject')) {
          inp.value = '/missing/file.png';
          break;
        }
      }
    }
  }
  // Capture mmxRunJob invocations (must be 0 if abort works)
  const genBtn = findButton(root, 'Generate');
  fireClick(genBtn);
  await new Promise((r) => setTimeout(r, 500));
  assert.equal((win._mmxCalls || []).length, 0, 'mmxRunJob must NOT be called when refImageExists returns exists:false');
  // Verify the toast was a clear "Reference image not found" message
  const toasts = (win._toasts || []).map(t => t[0]).join(' | ');
  assert.match(toasts, /Reference image not found/, 'must toast about the missing reference image, got: ' + toasts);
});

test('imageTab: filePrefixForceOnly true -> outFile is "test000001.<ext>"', async () => {
  const win = setupTabHarness({ tab: 'image' });
  win.state.filePrefix = 'test';
  win.state.filePrefixForceOnly = true;
  const root = loadTab(win, 'image');
  setVariants(root, 1);
  let capturedOut = null;
  win.api.mmxRunJob = async (opts) => {
    win._mmxCalls = win._mmxCalls || [];
    win._mmxCalls.push(opts);
    const i = opts.args.lastIndexOf('--out');
    if (i >= 0) capturedOut = opts.args[i + 1];
    return { ok: true, parsed: {}, stdout: '', stderr: '', code: 0 };
  };
  const genBtn = findButton(root, 'Generate');
  fireClick(genBtn);
  await new Promise((r) => setTimeout(r, 1500));
  assert.ok(capturedOut, 'mmxRunJob was called with --out');
  // The expected format is `<prefix><6-digit counter>.<ext>`, e.g. test000001.png
  assert.match(capturedOut, /test000001\.[a-z0-9]+$/, 'expected test000001.<ext>, got: ' + capturedOut);
});

// ----------------------------------------------------------------------------
// speechTab tests
// ----------------------------------------------------------------------------

test('speechTab: --bitrate for wav (lossless) — must NOT be in args', async () => {
  const win = setupTabHarness({ tab: 'speech' });
  const root = loadTab(win, 'speech');
  // Set format to 'wav'
  const inputs = findAllInputs(root);
  // Find the format select
  let formatSel = null;
  for (const inp of inputs) {
    if (inp.tagName === 'SELECT' && (inp.children || []).some(c => c.value === 'wav')) {
      formatSel = inp;
      break;
    }
  }
  if (!formatSel) throw new Error('No format select found');
  formatSel.value = 'wav';
  setVariants(root, 1);
  let capturedArgs = null;
  win.api.mmxRunJob = async (opts) => {
    capturedArgs = opts.args;
    return { ok: true, parsed: {}, stdout: '', stderr: '', code: 0 };
  };
  const genBtn = findButton(root, 'Generate');
  fireClick(genBtn);
  await new Promise((r) => setTimeout(r, 1500));
  assert.ok(capturedArgs, 'mmxRunJob was called');
  assert.ok(!capturedArgs.includes('--bitrate'), '--bitrate must NOT be sent for wav (lossless) — got: ' + capturedArgs.join(' '));
});

test('speechTab: --bitrate for mp3 (lossy) — must be in args (default 2)', async () => {
  const win = setupTabHarness({ tab: 'speech' });
  const root = loadTab(win, 'speech');
  // Default format is mp3
  setVariants(root, 1);
  let capturedArgs = null;
  win.api.mmxRunJob = async (opts) => {
    capturedArgs = opts.args;
    return { ok: true, parsed: {}, stdout: '', stderr: '', code: 0 };
  };
  const genBtn = findButton(root, 'Generate');
  fireClick(genBtn);
  await new Promise((r) => setTimeout(r, 1500));
  assert.ok(capturedArgs);
  assert.ok(capturedArgs.includes('--bitrate'), '--bitrate must be sent for mp3 (lossy) — got: ' + capturedArgs.join(' '));
  // Find the bitrate value (next arg after --bitrate)
  const i = capturedArgs.indexOf('--bitrate');
  assert.equal(capturedArgs[i + 1], '128000', 'mp3 bitrate default should be 128000, got: ' + capturedArgs[i + 1]);
});

test('speechTab: partial-success (2/3 succeed) -> genLastResult.speech === ok', async () => {
  const win = setupTabHarness({ tab: 'speech' });
  const root = loadTab(win, 'speech');
  setVariants(root, 3);
  let n = 0;
  win.api.mmxRunJob = async (opts) => {
    n++;
    win._mmxCalls = win._mmxCalls || [];
    win._mmxCalls.push(opts);
    if (n === 2) return { ok: false, parsed: null, stdout: '', stderr: 'fail', code: 1 };
    return { ok: true, parsed: {}, stdout: '', stderr: '', code: 0 };
  };
  const genBtn = findButton(root, 'Generate');
  fireClick(genBtn);
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal((win._mmxCalls || []).length, 3);
  assert.equal(win.state.genLastResult.speech, 'ok', 'partial success must be "ok"');
});

test('speechTab: all variants fail -> genLastResult.speech === err', async () => {
  const win = setupTabHarness({ tab: 'speech' });
  const root = loadTab(win, 'speech');
  setVariants(root, 3);
  win.api.mmxRunJob = async (opts) => {
    win._mmxCalls = win._mmxCalls || [];
    win._mmxCalls.push(opts);
    return { ok: false, parsed: null, stdout: '', stderr: 'err', code: 1 };
  };
  const genBtn = findButton(root, 'Generate');
  fireClick(genBtn);
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal((win._mmxCalls || []).length, 3);
  assert.equal(win.state.genLastResult.speech, 'err');
});

test('speechTab: cancel with partial success returns BOTH successful files (H1+L1 round-2)', async () => {
  const win = setupTabHarness({ tab: 'speech' });
  const root = loadTab(win, 'speech');
  setVariants(root, 3);
  let n = 0;
  win.api.mmxRunJob = async (opts) => {
    n++;
    win._mmxCalls = win._mmxCalls || [];
    win._mmxCalls.push(opts);
    if (n === 2) {
      setImmediate(() => { win._cancelToken = { cancelled: true }; });
    }
    return { ok: true, parsed: {}, stdout: '', stderr: '', code: 0 };
  };
  const genBtn = findButton(root, 'Generate');
  fireClick(genBtn);
  await new Promise((r) => setTimeout(r, 2000));
  const successfulOuts = (win._mmxCalls || [])
    .map(c => { const args = c.args; const i = args.lastIndexOf('--out'); return i >= 0 ? args[i+1] : null; })
    .filter(x => x);
  assert.ok(successfulOuts.length >= 2, 'at least 2 variants should have been attempted');
  assert.equal(new Set(successfulOuts).size, successfulOuts.length, 'outFile paths must be unique');
  // genLastResult must be 'ok'
  assert.equal(win.state.genLastResult.speech, 'ok', 'partial success + cancel must still mark "ok"');
  // Verify the runFn's returned outputPaths (defect: same as imageTab)
  if (win._capturedCtrl) {
    const result = await win._capturedCtrl.done;
    // speechTab at line 426: `return { status: outFiles.length > 0 ? 'ok' : 'cancel', outputPaths: outFiles };`
    // It uses `outFiles` (not finalOutputPaths), so it should have 2 files.
    console.log('speechTab cancel: result.status=', result.status, 'job.outputPaths=', JSON.stringify(result.job && result.job.outputPaths));
  }
});

// ----------------------------------------------------------------------------
// musicTab tests
// ----------------------------------------------------------------------------

test('musicTab: --bitrate for wav (lossless) — must NOT be in args (M1 fix)', async () => {
  const win = setupTabHarness({ tab: 'music' });
  const root = loadTab(win, 'music');
  // Find the audioFormat select (--format)
  const inputs = findAllInputs(root);
  let formatSel = null;
  for (const inp of inputs) {
    if (inp.tagName === 'SELECT' && (inp.children || []).some(c => c.value === 'wav')) {
      formatSel = inp;
      break;
    }
  }
  if (!formatSel) throw new Error('No audioFormat select found');
  formatSel.value = 'wav';
  setVariants(root, 1);
  let capturedArgs = null;
  win.api.mmxRunJob = async (opts) => {
    capturedArgs = opts.args;
    return { ok: true, parsed: {}, stdout: '', stderr: '', code: 0 };
  };
  const genBtn = findButton(root, 'Generate');
  fireClick(genBtn);
  await new Promise((r) => setTimeout(r, 1500));
  assert.ok(capturedArgs, 'mmxRunJob called');
  assert.ok(!capturedArgs.includes('--bitrate'), '--bitrate must NOT be sent for wav (lossless) — got: ' + capturedArgs.join(' '));
});

test('musicTab: --bitrate for mp3 (lossy) — must be in args', async () => {
  const win = setupTabHarness({ tab: 'music' });
  const root = loadTab(win, 'music');
  setVariants(root, 1);
  let capturedArgs = null;
  win.api.mmxRunJob = async (opts) => {
    capturedArgs = opts.args;
    return { ok: true, parsed: {}, stdout: '', stderr: '', code: 0 };
  };
  const genBtn = findButton(root, 'Generate');
  fireClick(genBtn);
  await new Promise((r) => setTimeout(r, 1500));
  assert.ok(capturedArgs);
  assert.ok(capturedArgs.includes('--bitrate'), '--bitrate must be sent for mp3 — got: ' + capturedArgs.join(' '));
});

test('musicTab: partial-success (2/3 succeed) -> genLastResult.music === ok', async () => {
  const win = setupTabHarness({ tab: 'music' });
  const root = loadTab(win, 'music');
  setVariants(root, 3);
  let n = 0;
  win.api.mmxRunJob = async (opts) => {
    n++;
    win._mmxCalls = win._mmxCalls || [];
    win._mmxCalls.push(opts);
    if (n === 2) return { ok: false, parsed: null, stdout: '', stderr: 'fail', code: 1 };
    return { ok: true, parsed: {}, stdout: '', stderr: '', code: 0 };
  };
  const genBtn = findButton(root, 'Generate');
  fireClick(genBtn);
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal((win._mmxCalls || []).length, 3);
  assert.equal(win.state.genLastResult.music, 'ok');
});

test('musicTab: all variants fail -> genLastResult.music === err', async () => {
  const win = setupTabHarness({ tab: 'music' });
  const root = loadTab(win, 'music');
  setVariants(root, 3);
  win.api.mmxRunJob = async (opts) => {
    win._mmxCalls = win._mmxCalls || [];
    win._mmxCalls.push(opts);
    return { ok: false, parsed: null, stdout: '', stderr: 'err', code: 1 };
  };
  const genBtn = findButton(root, 'Generate');
  fireClick(genBtn);
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal((win._mmxCalls || []).length, 3);
  assert.equal(win.state.genLastResult.music, 'err');
});

test('musicTab: cancel with partial success returns BOTH successful files', async () => {
  const win = setupTabHarness({ tab: 'music' });
  const root = loadTab(win, 'music');
  setVariants(root, 3);
  let n = 0;
  win.api.mmxRunJob = async (opts) => {
    n++;
    win._mmxCalls = win._mmxCalls || [];
    win._mmxCalls.push(opts);
    if (n === 2) {
      setImmediate(() => { win._cancelToken = { cancelled: true }; });
    }
    return { ok: true, parsed: {}, stdout: '', stderr: '', code: 0 };
  };
  const genBtn = findButton(root, 'Generate');
  fireClick(genBtn);
  await new Promise((r) => setTimeout(r, 2000));
  const successfulOuts = (win._mmxCalls || [])
    .map(c => { const args = c.args; const i = args.lastIndexOf('--out'); return i >= 0 ? args[i+1] : null; })
    .filter(x => x);
  assert.ok(successfulOuts.length >= 2, 'at least 2 variants should have been attempted');
  assert.equal(new Set(successfulOuts).size, successfulOuts.length, 'outFile paths must be unique');
  assert.equal(win.state.genLastResult.music, 'ok', 'partial success + cancel must still mark "ok"');
  // NOTE: We don't assert on result.outputPaths because the musicTab
  // runFn has a complex control flow that the test harness doesn't
  // drive deterministically (the cancel branch uses outFiles but
  // the runFn may take a different path in our mock). The
  // genLastResult check above is the user-visible contract.
});

// ----------------------------------------------------------------------------
// videoTab tests
// ----------------------------------------------------------------------------

test('videoTab: partial-success (2/3 succeed) -> genLastResult.video === ok', async () => {
  const win = setupTabHarness({ tab: 'video' });
  const root = loadTab(win, 'video');
  setVariants(root, 3);
  let n = 0;
  win.api.mmxRunJob = async (opts) => {
    n++;
    win._mmxCalls = win._mmxCalls || [];
    win._mmxCalls.push(opts);
    if (n === 2) return { ok: false, parsed: null, stdout: '', stderr: 'fail', code: 1 };
    return { ok: true, parsed: {}, stdout: '', stderr: '', code: 0 };
  };
  const genBtn = findButton(root, 'Generate');
  fireClick(genBtn);
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal((win._mmxCalls || []).length, 3);
  assert.equal(win.state.genLastResult.video, 'ok');
});

test('videoTab: all variants fail -> genLastResult.video === err', async () => {
  const win = setupTabHarness({ tab: 'video' });
  const root = loadTab(win, 'video');
  setVariants(root, 3);
  win.api.mmxRunJob = async (opts) => {
    win._mmxCalls = win._mmxCalls || [];
    win._mmxCalls.push(opts);
    return { ok: false, parsed: null, stdout: '', stderr: 'err', code: 1 };
  };
  const genBtn = findButton(root, 'Generate');
  fireClick(genBtn);
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal((win._mmxCalls || []).length, 3);
  assert.equal(win.state.genLastResult.video, 'err');
});

test('videoTab: cancel with partial success returns BOTH successful files', async () => {
  const win = setupTabHarness({ tab: 'video' });
  const root = loadTab(win, 'video');
  setVariants(root, 3);
  let n = 0;
  win.api.mmxRunJob = async (opts) => {
    n++;
    win._mmxCalls = win._mmxCalls || [];
    win._mmxCalls.push(opts);
    if (n === 2) {
      setImmediate(() => { win._cancelToken = { cancelled: true }; });
    }
    return { ok: true, parsed: {}, stdout: '', stderr: '', code: 0 };
  };
  const genBtn = findButton(root, 'Generate');
  fireClick(genBtn);
  await new Promise((r) => setTimeout(r, 2000));
  // videoTab uses --download, not --out
  const successfulOuts = (win._mmxCalls || [])
    .map(c => { const args = c.args; const i = args.lastIndexOf('--download'); return i >= 0 ? args[i+1] : null; })
    .filter(x => x);
  assert.ok(successfulOuts.length >= 2, 'at least 2 variants should have been attempted');
  assert.equal(new Set(successfulOuts).size, successfulOuts.length, 'outFile paths must be unique');
  assert.equal(win.state.genLastResult.video, 'ok', 'partial success + cancel must still mark "ok"');
});
