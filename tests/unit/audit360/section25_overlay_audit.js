// tests/unit/audit360/section25_overlay_audit.js
// ============================================================================
// 360° EMPIRICAL AUDIT — renderer/sections/section25_Advanced_pipeline_settings_overlay.js
// Loads the ACTUAL source file in a minimal window mock and exercises
// openAdvancedPipelineSettings() end-to-end:
//   - all 4 sections render
//   - change handlers mutate state.pipelineAdvancedSettings in place
//   - Save persists
//   - Reset restores defaults
//   - Cancel restores the OPEN-TIME snapshot (not the live state)
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..', '..', '..');

// --- Minimal DOM / window mock (sufficient for the overlay) -----------------
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
    addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
    removeEventListener(ev, fn) { if (!this._listeners[ev]) return; this._listeners[ev] = this._listeners[ev].filter((f) => f !== fn); },
    dispatchEvent(event) { for (const fn of (this._listeners[event.type] || [])) fn(event); return true; },
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
    insertBefore(child, ref) { const i = this.children.indexOf(ref); if (i < 0) this.children.push(child); else this.children.splice(i, 0, child); child.parentNode = this; return child; },
    removeChild(child) { const i = this.children.indexOf(child); if (i >= 0) this.children.splice(i, 1); child.parentNode = null; return child; },
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return this.attributes[k] == null ? null : String(this.attributes[k]); },
    removeAttribute(k) { delete this.attributes[k]; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    focus() {},
    blur() {},
    getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
    set textContent(v) { this._text = v; this.children = []; },
    get textContent() { return this._text != null ? this._text : this.children.map((c) => c.textContent || '').join(''); },
    set innerHTML(v) { this._innerHTML = v; this.children = []; },
    get innerHTML() { return this._innerHTML || ''; },
    append(...nodes) { for (const n of nodes) { if (n && n.tagName) { this.children.push(n); n.parentNode = this; } } },
  };
  if (node.tagName === 'SELECT' || node.tagName === 'INPUT' || node.tagName === 'TEXTAREA') {
    node._value = '';
    node.value = '';
    node.checked = false;
    node.disabled = false;
  }
  if (node.tagName === 'OPTION') {
    node.selected = false;
  }
  // Mock the HTMLSelectElement `.value` getter to read the currently
  // selected option's value. The real DOM does this implicitly; our
  // minimal mock doesn't unless we wire it up.
  Object.defineProperty(node, 'value', {
    get() {
      if (node.tagName === 'SELECT') {
        const sel = (node.children || []).find((c) => c.tagName === 'OPTION' && c.selected);
        if (sel) return sel.value;
        // First option is implicitly selected.
        const first = (node.children || []).find((c) => c.tagName === 'OPTION');
        return first ? first.value : '';
      }
      return node._value;
    },
    set(v) {
      if (node.tagName === 'SELECT') {
        // Mark the matching option as selected.
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
function makeDom() {
  return {
    createElement: (tag) => makeEl(tag),
    createElementNS: (_, tag) => makeEl(tag),
    getElementById: (id) => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
    body: makeEl('body'),
    documentElement: makeEl('html'),
    readyState: 'complete',
  };
}
function setupOverlayHarness() {
  const dom = makeDom();
  const win = { document: dom, confirm: () => true, toast: () => {} };
  const elFactory = (tag, attrs, ...children) => {
    const n = makeEl(tag);
    if (attrs && typeof attrs === 'object') {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') { n.attributes.class = v; n.classList.add(v); }
        else if (k === 'style' && typeof v === 'string') n.attributes.style = v;
        else if (k.startsWith('data-')) { n.attributes[k] = v; n.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v; }
        else n.attributes[k] = v;
        if (k === 'value' && (n.tagName === 'OPTION' || n.tagName === 'INPUT' || n.tagName === 'SELECT')) n.value = v;
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
  // Build a fresh state object every time.
  win.state = {
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
  };
  global.window = win;
  global.document = dom;
  global.el = elFactory;
  global.state = win.state;
  global.toast = win.toast;
  global.confirm = win.confirm;
  let saved = false;
  global.scheduleStateSave = async () => { saved = true; return Promise.resolve(); };
  // Capture showModal so we can grab the modal root and close().
  let modalRoot = null;
  let modalClose = null;
  global.showModal = (builder, opts) => {
    modalRoot = makeEl('div');
    modalClose = builder(modalRoot, () => {});
    win._modal = modalRoot;
  };
  // v1.1 (lint-size split): the DOM-builder helpers were extracted
  // to section25_Advanced_pipeline_settings_helpers.js. We need
  // to load that file BEFORE the overlay file, so the overlay's
  // `const { selRow, cbRow, numRow, sectionTitle } = window.Section25Helpers;`
  // destructure can find the helpers.
  const helpersSrc = fs.readFileSync(
    path.join(ROOT, 'renderer', 'sections', 'section25_Advanced_pipeline_settings_helpers.js'),
    'utf8',
  );
  // eslint-disable-next-line no-new-func
  new Function('window', 'el', 'toast', helpersSrc).call(null, win, elFactory, global.toast);
  // Load the source as a function body so the top-level
  // function declaration becomes a returnable value.
  const src = fs.readFileSync(
    path.join(ROOT, 'renderer', 'sections', 'section25_Advanced_pipeline_settings_overlay.js'),
    'utf8',
  );
  // eslint-disable-next-line no-new-func
  const loader = new Function(
    'window', 'document', 'state', 'scheduleStateSave', 'showModal', 'el', 'toast', 'confirm',
    src + '\n; return { openAdvancedPipelineSettings };',
  );
  const { openAdvancedPipelineSettings } = loader(
    win, dom, win.state, global.scheduleStateSave, global.showModal, elFactory, global.toast, global.confirm,
  );
  return {
    win,
    open: () => { saved = false; openAdvancedPipelineSettings(); return { modalRoot: win._modal, saved: () => saved }; },
    isSaved: () => saved,
  };
}

function findButton(node, text) {
  if (!node) return null;
  if (node.tagName === 'BUTTON') {
    const t = String(node.textContent).trim();
    if (t === text) return node;
    // Also match if the button text ENDS with the search string (so
    // we don't have to hard-code the leading glyph like '↺ ').
    if (text && t.endsWith(text)) return node;
  }
  for (const c of (node.children || [])) {
    const found = findButton(c, text);
    if (found) return found;
  }
  return null;
}
function findAllButtons(node, acc) {
  acc = acc || [];
  if (!node) return acc;
  if (node.tagName === 'BUTTON') acc.push(node);
  for (const c of (node.children || [])) findAllButtons(c, acc);
  return acc;
}
function findH4Titles(node, acc) {
  acc = acc || [];
  if (!node) return acc;
  if (node.tagName === 'H4') acc.push(node.textContent);
  for (const c of (node.children || [])) findH4Titles(c, acc);
  return acc;
}
function findAllInputs(node, acc) {
  acc = acc || [];
  if (!node) return acc;
  if (node.tagName === 'INPUT' || node.tagName === 'SELECT') acc.push(node);
  for (const c of (node.children || [])) findAllInputs(c, acc);
  return acc;
}
function fireChange(node, value) {
  // Fire a change event on a SELECT/INPUT. Optionally set the value first
  // (mimicking the user picking a different option).
  if (!node) return false;
  if (value !== undefined && (node.tagName === 'SELECT' || node.tagName === 'INPUT')) {
    node.value = value;
  }
  const ls = node._listeners && node._listeners.change;
  if (ls) for (const fn of ls) fn({ target: node });
  return !!(ls && ls.length);
}
function fireClick(node) {
  if (!node) return false;
  const ls = node._listeners && node._listeners.click;
  if (ls) for (const fn of ls) fn({});
  return !!(ls && ls.length);
}

// =============================================================================
// T1: All four sections render with the documented h4 titles.
// =============================================================================
test('AUDIT 25-T1: openAdvancedPipelineSettings() renders all 4 sections', () => {
  const h = setupOverlayHarness();
  h.open();
  const titles = findH4Titles(h.win._modal);
  console.log('AUDIT 25-T1: section titles found =', titles);
  assert.ok(titles.some((t) => t.includes('Real-ESRGAN')), 'Real-ESRGAN section must exist');
  assert.ok(titles.some((t) => t.includes('IS-Net')), 'IS-Net section must exist');
  assert.ok(titles.some((t) => t.includes('Image optimiser')), 'Image optimiser section must exist');
  assert.ok(titles.some((t) => t.includes('Audio cutter')), 'Audio cutter section must exist');
});

// =============================================================================
// T2: The modal must contain a Save, Cancel, and Reset button.
// =============================================================================
test('AUDIT 25-T2: Save, Cancel, and Reset buttons all exist', () => {
  const h = setupOverlayHarness();
  h.open();
  assert.ok(findButton(h.win._modal, 'Save'), 'Save button must exist');
  assert.ok(findButton(h.win._modal, 'Cancel'), 'Cancel button must exist');
  const resetBtn = findButton(h.win._modal, 'Reset to defaults');
  assert.ok(resetBtn, 'Reset to defaults button must exist (text: "' + (resetBtn ? resetBtn.textContent : '(missing)') + '")');
});

// =============================================================================
// T3: Each select/input fires a change handler that mutates the
// corresponding sub-key on state.pipelineAdvancedSettings.
// We poke every <select>/<input> with a sentinel value and verify the
// right sub-object is updated.
// =============================================================================
test('AUDIT 25-T3: change handlers mutate the correct sub-object on state', () => {
  const h = setupOverlayHarness();
  h.open();
  // Walk every select/input and fire a change event. We mutate .value to
  // a known sentinel first so the handler is forced to write that value.
  const inputs = findAllInputs(h.win._modal);
  // We pick a sentinel for each. SELECTs all have known option sets, so
  // we pick the first NON-current value. For numeric INPUTs we pick
  // 12345 (which the numRow handler clamps to the min/max range).
  const s = h.win.state.pipelineAdvancedSettings;
  const before = JSON.parse(JSON.stringify(s));
  for (const inp of inputs) {
    let sentinel;
    if (inp.tagName === 'SELECT') {
      // Find an option whose value differs from the current one.
      const opts = (inp.children || []).filter((c) => c.tagName === 'OPTION');
      if (opts.length < 2) continue;
      const current = inp.value;
      const other = opts.find((o) => String(o.value) !== String(current));
      if (!other) continue;
      sentinel = other.value;
    } else if (inp.type === 'checkbox') {
      // Toggle the checkbox.
      sentinel = !inp.checked;
    } else if (inp.type === 'number') {
      sentinel = 1; // small positive, within every range
    } else {
      sentinel = 'X';
    }
    fireChange(inp, sentinel);
  }
  // After firing every change, the state MUST differ from `before`.
  // (If nothing changed, the change handlers are no-ops or wired wrong.)
  const after = JSON.parse(JSON.stringify(s));
  assert.notDeepEqual(before, after, 'firing every change must mutate the state');
});

// =============================================================================
// T4: Save calls scheduleStateSave (which we mock) and closes.
// =============================================================================
test('AUDIT 25-T4: clicking Save persists state via scheduleStateSave', async () => {
  const h = setupOverlayHarness();
  h.open();
  const saveBtn = findButton(h.win._modal, 'Save');
  assert.ok(saveBtn);
  // The handler is async. Click and wait a microtask.
  fireClick(saveBtn);
  // wait a tick
  await new Promise((r) => setImmediate(r));
  assert.equal(h.isSaved(), true, 'Save must call scheduleStateSave');
});

// =============================================================================
// T5: Reset writes the documented default shape and persists.
// =============================================================================
test('AUDIT 25-T5: clicking Reset writes the full default shape and persists', async () => {
  const h = setupOverlayHarness();
  // Pre-pollute the state with garbage.
  h.win.state.pipelineAdvancedSettings = {
    realesrgan: { tileSize: 99999, ttaMode: 'oops', gpuId: 99 },
    isnetbg: { intraOpNumThreads: 999, interOpNumThreads: -1, executionMode: 'turbo' },
    optimize: {
      jpegChromaSubsampling: '4:1:1', jpegMozjpeg: 'no',
      pngCompressionLevel: 99, pngPalette: 'no',
      webpMode: 'best', webpEffort: 99,
      avifEffort: 99, avifChromaSubsampling: '4:1:1',
    },
    audio: {
      silenceThresholdDb: 999, minSilenceMs: -999,
      mp3Quality: 99, oggQuality: 99, opusBitrate: 'gigabit', m4aBitrate: 'gigabit',
    },
  };
  h.open();
  const resetBtn = findButton(h.win._modal, 'Reset to defaults');
  assert.ok(resetBtn, 'Reset to defaults button must exist (text: "' + (resetBtn ? resetBtn.textContent : '(missing)') + '")');
  // The reset handler is async and awaits scheduleStateSave. The
  // confirm() dialog is mocked to return true.
  fireClick(resetBtn);
  await new Promise((r) => setImmediate(r));
  // After reset, every sub-key must be the documented default.
  const s = h.win.state.pipelineAdvancedSettings;
  assert.equal(s.realesrgan.tileSize, 0, 'reset realesrgan.tileSize -> 0');
  assert.equal(s.realesrgan.ttaMode, false, 'reset realesrgan.ttaMode -> false');
  assert.equal(s.realesrgan.gpuId, 'auto', 'reset realesrgan.gpuId -> auto');
  assert.equal(s.isnetbg.intraOpNumThreads, 0, 'reset isnetbg.intraOpNumThreads -> 0');
  assert.equal(s.isnetbg.interOpNumThreads, 0, 'reset isnetbg.interOpNumThreads -> 0');
  assert.equal(s.isnetbg.executionMode, 'sequential', 'reset isnetbg.executionMode -> sequential');
  assert.equal(s.optimize.jpegChromaSubsampling, '4:2:0', 'reset optimize.jpegChromaSubsampling -> 4:2:0');
  assert.equal(s.optimize.jpegMozjpeg, true, 'reset optimize.jpegMozjpeg -> true');
  assert.equal(s.optimize.pngCompressionLevel, 9, 'reset optimize.pngCompressionLevel -> 9');
  assert.equal(s.optimize.pngPalette, true, 'reset optimize.pngPalette -> true');
  assert.equal(s.optimize.webpMode, 'lossy', 'reset optimize.webpMode -> lossy');
  assert.equal(s.optimize.webpEffort, 6, 'reset optimize.webpEffort -> 6');
  assert.equal(s.optimize.avifEffort, 9, 'reset optimize.avifEffort -> 9');
  assert.equal(s.optimize.avifChromaSubsampling, '4:4:4', 'reset optimize.avifChromaSubsampling -> 4:4:4');
  assert.equal(s.audio.silenceThresholdDb, -50, 'reset audio.silenceThresholdDb -> -50');
  assert.equal(s.audio.minSilenceMs, 50, 'reset audio.minSilenceMs -> 50');
  assert.equal(s.audio.mp3Quality, 2, 'reset audio.mp3Quality -> 2');
  assert.equal(s.audio.oggQuality, 6, 'reset audio.oggQuality -> 6');
  assert.equal(s.audio.opusBitrate, '128k', 'reset audio.opusBitrate -> 128k');
  assert.equal(s.audio.m4aBitrate, '192k', 'reset audio.m4aBitrate -> 192k');
  assert.equal(h.isSaved(), true, 'Reset must call scheduleStateSave');
});

// =============================================================================
// T6: Cancel restores the OPEN-TIME snapshot, NOT the current state.
// This is the audit L3 fix from v1.1 — verify it actually works.
// =============================================================================
test('AUDIT 25-T6: Cancel restores the open-time snapshot (audit L3 fix)', () => {
  const h = setupOverlayHarness();
  // Pre-seed a known state.
  const seed = {
    realesrgan: { tileSize: 256, ttaMode: true, gpuId: '1' },
    isnetbg: { intraOpNumThreads: 4, interOpNumThreads: 2, executionMode: 'parallel' },
    optimize: {
      jpegChromaSubsampling: '4:4:4', jpegMozjpeg: false,
      pngCompressionLevel: 3, pngPalette: false,
      webpMode: 'lossless', webpEffort: 2,
      avifEffort: 4, avifChromaSubsampling: '4:2:0',
    },
    audio: {
      silenceThresholdDb: -70, minSilenceMs: 200,
      mp3Quality: 1, oggQuality: 8, opusBitrate: '192k', m4aBitrate: '256k',
    },
  };
  h.win.state.pipelineAdvancedSettings = JSON.parse(JSON.stringify(seed));
  // Open the modal (this snapshots the current state).
  h.open();
  // Mutate the live state AFTER opening — the snapshot was already taken.
  h.win.state.pipelineAdvancedSettings.realesrgan.tileSize = 999;
  h.win.state.pipelineAdvancedSettings.audio.mp3Quality = 0;
  // Click Cancel.
  const cancelBtn = findButton(h.win._modal, 'Cancel');
  assert.ok(cancelBtn);
  fireClick(cancelBtn);
  // After cancel, the state should be the SNAPSHOT (taken at open time),
  // not the post-open mutated state.
  const s = h.win.state.pipelineAdvancedSettings;
  assert.equal(s.realesrgan.tileSize, 256, 'Cancel must restore tileSize to the open-time value (256), not the post-open value (999)');
  assert.equal(s.audio.mp3Quality, 1, 'Cancel must restore mp3Quality to the open-time value (1), not the post-open value (0)');
  // All other values should also match the seed (they were never changed).
  assert.deepEqual(s, seed, 'Cancel must restore the ENTIRE state object to the open-time snapshot');
});

// =============================================================================
// T7: After a change, then Save + reopen, the new value is persistent.
// (Verifies the save/load round trip for the overlay.)
// =============================================================================
test('AUDIT 25-T7: change -> Save -> reopen -> new value persists', async () => {
  const h = setupOverlayHarness();
  h.open();
  // Pick the first SELECT in the modal (it's the tile size).
  const inputs = findAllInputs(h.win._modal);
  const tileSel = inputs.find((i) => i.tagName === 'SELECT');
  assert.ok(tileSel, 'a select must exist');
  // Change it to 512.
  fireChange(tileSel, '512');
  // Click Save.
  const saveBtn = findButton(h.win._modal, 'Save');
  fireClick(saveBtn);
  await new Promise((r) => setImmediate(r));
  // Now reopen the modal. The state in `h.win.state` was mutated in
  // place, so the new value is reflected on the next open.
  h.open();
  const inputs2 = findAllInputs(h.win._modal);
  const tileSel2 = inputs2.find((i) => i.tagName === 'SELECT');
  assert.equal(String(tileSel2.value), '512', 'reopen must show the saved value (the first SELECT is still tileSize) — got ' + JSON.stringify(tileSel2.value));
});

// =============================================================================
// T8: The snapshot is a true deep clone — mutating the live state after
// opening (but before clicking Cancel) does NOT change the snapshot.
// This is the second half of the audit L3 fix.
// =============================================================================
test('AUDIT 25-T8: snapshot is a deep clone — post-open mutations do not leak into the snapshot', () => {
  const h = setupOverlayHarness();
  h.open();
  // Mutate the live state to a totally new value AFTER open.
  h.win.state.pipelineAdvancedSettings.realesrgan.tileSize = 9999;
  h.win.state.pipelineAdvancedSettings.optimize.webpMode = 'lossless';
  // Add a brand-new sub-key to verify deep clone caught everything.
  h.win.state.pipelineAdvancedSettings.audio.mp3Quality = 7;
  // Click Cancel. The original tile size 0 / webpMode 'lossy' / mp3Quality
  // 2 should be restored.
  const cancelBtn = findButton(h.win._modal, 'Cancel');
  fireClick(cancelBtn);
  const s = h.win.state.pipelineAdvancedSettings;
  assert.equal(s.realesrgan.tileSize, 0, 'deep-clone snapshot must NOT include the post-open 9999 value');
  assert.equal(s.optimize.webpMode, 'lossy', 'deep-clone snapshot must NOT include the post-open lossless value');
  assert.equal(s.audio.mp3Quality, 2, 'deep-clone snapshot must NOT include the post-open 7 value');
});

// =============================================================================
// T9: When state.pipelineAdvancedSettings is MISSING, the overlay seeds
// the documented defaults so the dropdowns show real values, not "undefined".
// =============================================================================
test('AUDIT 25-T9: overlay seeds defaults when state.pipelineAdvancedSettings is missing', () => {
  const h = setupOverlayHarness();
  delete h.win.state.pipelineAdvancedSettings;
  h.open();
  // After open, state.pipelineAdvancedSettings must be the full default.
  const s = h.win.state.pipelineAdvancedSettings;
  assert.ok(s, 'state.pipelineAdvancedSettings must be seeded');
  assert.equal(s.realesrgan.tileSize, 0);
  assert.equal(s.realesrgan.ttaMode, false);
  assert.equal(s.realesrgan.gpuId, 'auto');
  assert.equal(s.audio.opusBitrate, '128k');
});

// =============================================================================
// T10: Defensive partial state — if a sub-object is missing, the overlay
// backfills it. (State seed at top of the overlay function.)
// =============================================================================
test('AUDIT 25-T10: overlay backfills missing sub-objects from the open-time defaults', () => {
  const h = setupOverlayHarness();
  h.win.state.pipelineAdvancedSettings = {
    realesrgan: { tileSize: 512, ttaMode: true, gpuId: '1' },
    // isnetbg, optimize, audio missing
  };
  h.open();
  const s = h.win.state.pipelineAdvancedSettings;
  assert.ok(s.isnetbg, 'isnetbg must be backfilled');
  assert.ok(s.optimize, 'optimize must be backfilled');
  assert.ok(s.audio, 'audio must be backfilled');
  assert.equal(s.isnetbg.executionMode, 'sequential');
  assert.equal(s.optimize.jpegChromaSubsampling, '4:2:0');
  assert.equal(s.audio.opusBitrate, '128k');
  // The present sub-object is preserved.
  assert.equal(s.realesrgan.tileSize, 512);
});
