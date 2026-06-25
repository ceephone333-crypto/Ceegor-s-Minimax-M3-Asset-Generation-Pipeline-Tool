// tests/unit/audit360/fileBrowser_archiveViewer_splitter_audit.js
// ============================================================================
// 360° EMPIRICAL AUDIT — fileBrowser1, fileBrowser2a, fileBrowser2b,
// ArchiveViewer, SplitterDrag.
//
// Approach: we use Node's `vm` module to run each production file in
// an ISOLATED context where the production code's bare identifiers
// (window, document, $, $$, scheduleStateSave, sortFbItems, …) all
// resolve correctly. The context provides a minimal DOM mock so
// querySelector / addEventListener / classList / appendChild etc.
// work just like in a browser. We then drive the real production
// functions from the test code via the context's exports.
//
// We do NOT modify any production source. We do NOT re-implement
// the production logic. We load the literal production file into a
// VM context.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..', '..');
function src(rel) { return path.join(ROOT, rel); }

// ============================================================================
// Minimal DOM factory.
// ----------------------------------------------------------------------------
// Returns a tree of plain JS objects that quack like a DOM element
// well enough for the renderer code to run. The shapes the production
// code touches (sorted by fileBrowser1/2a/2b + ArchiveViewer +
// SplitterDrag):
//   - tagName, classList.{add,remove,contains,toggle}, dataset, style
//   - children, parentNode, attributes
//   - addEventListener, removeEventListener, dispatchEvent
//   - appendChild, append, insertBefore, removeChild, remove
//   - setAttribute, getAttribute, removeAttribute
//   - querySelector, querySelectorAll
//   - textContent, innerHTML (get/set), value, checked, disabled,
//     title, src, scrollTop, scrollHeight, clientHeight
//   - focus, blur, getBoundingClientRect
//   - click() helper (we add it for the ArchiveViewer test)
// ============================================================================
function makeEl(tag) {
  const node = {
    tagName: (tag || 'div').toUpperCase(),
    children: [],
    attributes: {},
    style: { setProperty(k, v) { node.style[k] = v; }, getPropertyValue(k) { return node.style[k] || ''; } },
    classList: (() => {
      const set = new Set();
      return {
        add(c) { if (c != null) for (const cls of String(c).split(/\s+/).filter(Boolean)) set.add(cls); },
        remove(c) { if (c != null) for (const cls of String(c).split(/\s+/).filter(Boolean)) set.delete(cls); },
        contains(c) { return set.has(c); },
        toggle(c, force) {
          if (force === true) set.add(c);
          else if (force === false) set.delete(c);
          else if (set.has(c)) set.delete(c);
          else set.add(c);
          return set.has(c);
        },
        _set: set,
      };
    })(),
    parentNode: null,
    dataset: {},
    _listeners: {},
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
    append(...nodes) { for (const n of nodes) { this.children.push(n); n.parentNode = this; } },
    insertBefore(child, ref) {
      const i = this.children.indexOf(ref);
      if (i < 0) this.children.push(child);
      else this.children.splice(i, 0, child);
      child.parentNode = this;
      return child;
    },
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i >= 0) { this.children.splice(i, 1); child.parentNode = null; }
    },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    setAttribute(k, v) {
      this.attributes[k] = v;
      if (k.startsWith('data-')) {
        const key = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        this.dataset[key] = v;
      }
      // Mirror the id setter: register the element in the
      // document's elements map so getElementById finds it.
      if (k === 'id' && v) {
        const reg = makeEl._reg;
        if (reg) reg(v, this);
      }
    },
    getAttribute(k) { return this.attributes[k] == null ? null : String(this.attributes[k]); },
    removeAttribute(k) { delete this.attributes[k]; },
    querySelector(sel) {
      // The production code's $() expects querySelector to find
      // an element by id anywhere in the document. Our mock walks
      // children, but `getOrCreate('foo')` registers elements in
      // the document's element registry (not in any parent's
      // children tree). For id selectors, we look up the element
      // registry FIRST so the production code's $('#foo') works.
      if (sel && /^#[\w-]+$/.test(sel)) {
        const id = sel.slice(1);
        // If the element is registered in the document's
        // elements map, return it.
        if (this.elements && this.elements[id]) return this.elements[id];
      }
      return this.querySelectorAll(sel)[0] || null;
    },
    querySelectorAll(sel) {
      const out = [];
      const visit = (n) => {
        if (!n || !Array.isArray(n.children)) return;
        for (const c of n.children) {
          if (matches(c, sel)) out.push(c);
          visit(c);
        }
      };
      visit(this);
      // Also include elements registered in the document's
      // elements map (they may not be in the children tree).
      if (this.elements && /^#[\w-]+$/.test(sel)) {
        const id = sel.slice(1);
        if (this.elements[id] && !out.includes(this.elements[id])) {
          out.push(this.elements[id]);
        }
      }
      return out;
    },
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
    focus() {},
    blur() {},
    getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
    set textContent(v) { this._text = v; this.children = []; },
    get textContent() { return this._text != null ? this._text : this.children.map((c) => c.textContent || '').join(''); },
    set innerHTML(v) {
      this._innerHTML = v;
      this.children = [];
      // Materialise the id-bearing elements the production code
      // expects to find via querySelector. Without this, the
      // ArchiveViewer's `_ensureModal` returns null for
      // m.querySelector('#archive-viewer-search') and the modal
      // crashes the moment it tries to bind a listener.
      if (typeof parseInnerHTMLInto === 'function') parseInnerHTMLInto(this, v);
    },
    set className(v) { this._className = v; this.classList._set.clear(); if (v) for (const cls of String(v).split(/\s+/).filter(Boolean)) this.classList._set.add(cls); },
    get className() { return this._className || Array.from(this.classList._set).join(' '); },
    // The ArchiveViewer's _ensureModal sets `list.id = LIST_ID`
    // (a direct property assignment, NOT setAttribute). Real DOM
    // nodes have an `id` property that mirrors the `id` attribute.
    // Mirror that here so querySelector and getElementById find
    // the list. Same for `type` on input elements.
    set id(v) {
      this.attributes.id = v;
      // Register the element in the document's elements map so
      // getElementById can find it. The map is global to this
      // makeEl (see _reg below), so a setter defined here can
      // see the active registration.
      const reg = makeEl._reg;
      if (v && reg) reg(v, this);
    },
    get id() { return this.attributes.id; },
    set type(v) { this.attributes.type = v; },
    get type() { return this.attributes.type; },
    set value(v) { this._value = v; },
    get value() { return this._value != null ? this._value : ''; },
    get innerHTML() { return this._innerHTML || ''; },
    value: '', checked: false, disabled: false, title: '', src: '',
    // The ArchiveViewer's delete-button click handler does NOT
    // call click() — it only listens for 'click' events. Tests
    // dispatch the event manually via dispatchEvent.
    click() { this.dispatchEvent({ type: 'click' }); },
  };
  return node;
}
function matches(el, sel) {
  sel = String(sel).trim();
  // Comma-separated selector list: match if ANY part matches.
  if (sel.includes(',')) {
    return sel.split(',').some((part) => matches(el, part.trim()));
  }
  // Compound selectors: tag.class, tag#id, .class.class, etc.
  // We only handle the subset the production code emits: tag,
  // .class, #id, tag.class, button.danger, div.fb-item, etc.
  const tokens = [];
  let rest = sel;
  // Tag at the start.
  const tagM = rest.match(/^([a-zA-Z][\w-]*)/);
  if (tagM) { tokens.push({ type: 'tag', val: tagM[1] }); rest = rest.slice(tagM[0].length); }
  while (rest.length) {
    if (rest[0] === '#') {
      const m = rest.match(/^#([\w-]+)/);
      if (m) { tokens.push({ type: 'id', val: m[1] }); rest = rest.slice(m[0].length); continue; }
    }
    if (rest[0] === '.') {
      const m = rest.match(/^\.([\w-]+)/);
      if (m) { tokens.push({ type: 'class', val: m[1] }); rest = rest.slice(m[0].length); continue; }
    }
    if (rest[0] === '[') {
      const m = rest.match(/^\[([\w-]+)(?:=([^"\]]+|"[^"]*"))?\]/);
      if (m) { tokens.push({ type: 'attr', key: m[1], val: m[2] != null ? m[2].replace(/^"|"$/g, '') : null }); rest = rest.slice(m[0].length); continue; }
    }
    break;
  }
  if (tokens.length === 0) return false;
  for (const t of tokens) {
    if (t.type === 'tag') {
      if (el.tagName !== t.val.toUpperCase()) return false;
    } else if (t.type === 'id') {
      if (el.attributes.id !== t.val) return false;
    } else if (t.type === 'class') {
      if (!el.classList._set.has(t.val)) return false;
    } else if (t.type === 'attr') {
      const v = el.getAttribute(t.key);
      if (t.val === null) { if (v == null) return false; }
      else if (v !== t.val) return false;
    }
  }
  return true;
}

// Minimal HTML-template parser. The ArchiveViewer + fileBrowser
// code use innerHTML templates to build sub-trees; the mock
// needs to materialise the elements (input, select, button, etc.)
// so querySelector('#archive-viewer-search') etc. return live
// elements with working addEventListener / value / etc. The parser
// handles the subset the production code emits: <input id="X" ...>,
// <select id="X">…</select>, <button>X</button>, <h3>X</h3>.
const ID_ELEMENT_TAGS = new Set(['input', 'select', 'textarea', 'button']);
function parseInnerHTMLInto(parent, html) {
  if (!html) return;
  // Extract <input ...> tags with id.
  const inputRe = /<input\b([^>]*?)\/?>/g;
  let m;
  while ((m = inputRe.exec(html))) {
    const attrs = m[1];
    const idMatch = attrs.match(/\bid=["']([^"']+)["']/);
    if (!idMatch) continue;
    const el = makeEl('input');
    el.setAttribute('id', idMatch[1]);
    const typeM = attrs.match(/\btype=["']([^"']+)["']/);
    if (typeM) el.setAttribute('type', typeM[1]);
    parent.appendChild(el);
  }
  // Extract <select id="X"> with <option> children.
  const selectRe = /<select\b([^>]*?)>([\s\S]*?)<\/select>/g;
  while ((m = selectRe.exec(html))) {
    const attrs = m[1];
    const idMatch = attrs.match(/\bid=["']([^"']+)["']/);
    if (!idMatch) continue;
    const sel = makeEl('select');
    sel.setAttribute('id', idMatch[1]);
    const optRe = /<option\b([^>]*?)>([^<]*)<\/option>/g;
    let om;
    while ((om = optRe.exec(m[2]))) {
      const o = makeEl('option');
      const v = om[1].match(/\bvalue=["']([^"']+)["']/);
      if (v) o.setAttribute('value', v[1]);
      o.textContent = om[2].trim();
      sel.appendChild(o);
    }
    parent.appendChild(sel);
  }
  // Extract <button id="X">Y</button>.
  const btnRe = /<button\b([^>]*?)>([^<]*)<\/button>/g;
  while ((m = btnRe.exec(html))) {
    const attrs = m[1];
    const idMatch = attrs.match(/\bid=["']([^"']+)["']/);
    const btn = makeEl('button');
    if (idMatch) btn.setAttribute('id', idMatch[1]);
    btn.textContent = m[2].trim();
    parent.appendChild(btn);
  }
  // Extract <h3>, <h2>, <p>, <span>, <div> with id (we don't
  // need them for any of the audit's behavioural tests, but
  // they shouldn't trip the parser).
  for (const tag of ['h2', 'h3', 'p', 'span', 'div']) {
    const re = new RegExp(`<${tag}\\b([^>]*?)>([^<]*)</${tag}>`, 'g');
    while ((m = re.exec(html))) {
      const attrs = m[1];
      const idMatch = attrs.match(/\bid=["']([^"']+)["']/);
      if (!idMatch) continue;
      const e = makeEl(tag);
      e.setAttribute('id', idMatch[1]);
      e.textContent = m[2].trim();
      parent.appendChild(e);
    }
  }
}

function makeSandbox(extra = {}) {
  // Build a minimal DOM-backed window/document pair and a shared
  // element registry.
  const elements = {};
  // Wire up the id-setter registration. makeEl uses this to
  // register elements in the document's elements map when the
  // production code does `el.id = 'foo'` or `el.setAttribute('id', 'foo')`.
  makeEl._reg = (id, el) => { elements[id] = el; };
  const docListeners = {};
  const body = makeEl('body');
  const documentElement = makeEl('html');
  const getOrCreate = (id) => { if (!elements[id]) elements[id] = makeEl('div'); return elements[id]; };
  const elFactory = (tag, attrs, ...children) => {
    const n = makeEl(tag);
    if (attrs && typeof attrs === 'object') {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') n.classList.add(v);
        else if (k === 'style' && typeof v === 'string') n.attributes.style = v;
        else if (k.startsWith('data-')) {
          n.attributes[k] = v;
          n.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
        } else n.attributes[k] = v;
      }
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      if (typeof c === 'string' || typeof c === 'number') {
        const t = makeEl('span');
        t.textContent = String(c);
        n.children.push(t); t.parentNode = n;
      } else if (typeof c === 'object' && c.tagName) {
        n.children.push(c); c.parentNode = n;
      }
    }
    return n;
  };
  const eventListeners = {};
  const document = {
    elements, docListeners, body, documentElement, readyState: 'complete',
    createElement: (tag) => makeEl(tag),
    createElementNS: (_, tag) => makeEl(tag),
    getElementById: (id) => elements[id] || null,
    querySelector(sel) {
      if (sel && /^#[\w-]+$/.test(sel)) {
        const id = sel.slice(1);
        if (elements[id]) return elements[id];
      }
      // Walk the children tree for non-id selectors.
      const visit = (n) => {
        for (const c of n.children || []) {
          if (matches(c, sel)) return c;
          const found = visit(c);
          if (found) return found;
        }
        return null;
      };
      return visit(this) || null;
    },
    querySelectorAll(sel) {
      const out = [];
      if (sel && /^#[\w-]+$/.test(sel)) {
        const id = sel.slice(1);
        if (elements[id]) out.push(elements[id]);
        return out;
      }
      // Walk body + its children, then walk every registered
      // element. Use a Set of visited elements to avoid
      // double-counting when an element is both in the tree
      // AND in the elements map (e.g. the modal, the list).
      const visited = new Set();
      const visit = (n) => {
        if (!n || visited.has(n)) return;
        visited.add(n);
        if (!Array.isArray(n.children)) return;
        for (const c of n.children) {
          if (matches(c, sel)) out.push(c);
          visit(c);
        }
      };
      visit(this.body);
      visit(this.documentElement);
      for (const e of Object.values(elements)) visit(e);
      return out;
    },
    addEventListener(ev, fn) { (docListeners[ev] = docListeners[ev] || []).push(fn); },
    removeEventListener(ev, fn) {
      if (!docListeners[ev]) return;
      docListeners[ev] = docListeners[ev].filter((f) => f !== fn);
    },
    dispatchEvent(ev) { for (const fn of (docListeners[ev.type] || [])) fn(ev); return true; },
  };
  const win = {
    api: {},
    state: undefined,
    toast: () => {},
    el: elFactory,
    createElement: elFactory,
    DropTarget: { attachDropTarget: () => {} },
    scheduleStateSave: () => {},
    JobRunner: { activeJobs: () => [] },
    fileUrl: (p) => 'file:///' + String(p || '').replace(/\\/g, '/').replace(/^\/+/, ''),
    formatDate: (ms) => ms ? new Date(ms).toISOString() : '',
    escapeHtml: (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    showModal: () => {},
    openImageOverlay: () => {},
    openVideoOverlay: () => {},
    previewAudioFromFile: () => {},
    previewVideoFromFile: () => {},
    previewTextFromFile: () => {},
    previewImageFromFile: () => {},
    previewImagesFromFiles: () => {},
    openItem: () => {},
    confirmDelete: () => {},
    promptRename: () => {},
    promptMove: () => {},
    showUpscaleDirect: () => {},
    showCropOverlay: () => {},
    showConvertOverlay: () => {},
    showOptimizeOverlay: () => {},
    runRemoveBackgroundOnItem: () => {},
    showItemContextMenu: () => {},
    showItemContextMenuForPath: () => {},
    $: (sel, root) => (root || document).querySelector(sel),
    $$: (sel, root) => Array.from((root || document).querySelectorAll(sel) || []),
    document,
    CustomEvent: class CustomEvent {
      constructor(type, init) { this.type = type; this.detail = (init && init.detail) || null; }
    },
    addEventListener(ev, fn) { (eventListeners[ev] = eventListeners[ev] || []).push(fn); },
    removeEventListener(ev, fn) {
      if (!eventListeners[ev]) return;
      eventListeners[ev] = eventListeners[ev].filter((f) => f !== fn);
    },
    dispatchEvent(ev) { for (const fn of (eventListeners[ev.type] || [])) fn(ev); return true; },
    CSS: { escape: (s) => String(s).replace(/([!"#$%&'()*+,./:;<=>?@[\]^`{|}~])/g, '\\$1') },
  };
  win.document = document;
  // pathJoin helper for fileBrowser1's `pathJoin(target.dir, state.currentTab)`.
  win.pathJoin = win.pathJoin || ((a, b) => {
    const sep = String(a).includes('\\') ? '\\' : '/';
    return String(a).replace(/[\\/]+$/, '') + sep + String(b).replace(/^[\\/]+/, '');
  });
  return {
    win,
    document,
    elements,
    body,
    documentElement,
    getOrCreate,
    eventListeners,
    // Sandbox for vm.createContext.
    sandbox: {
      window: win,
      document,
      console,
      setTimeout, clearTimeout, setImmediate, clearImmediate, queueMicrotask, Promise,
      // atob / TextDecoder are needed for fileBrowser2b.previewTextFromFile.
      atob: (s) => Buffer.from(s, 'base64').toString('binary'),
      TextDecoder,
      // Image is referenced by fileBrowser2a's `new Image()`.
      Image: (extra.Image || global.Image),
      // Other globals the production code might call bare.
      scheduleStateSave: win.scheduleStateSave,
      toast: win.toast,
      showModal: win.showModal,
      pathJoin: win.pathJoin,
      openImageOverlay: win.openImageOverlay,
      openVideoOverlay: win.openVideoOverlay,
      fileUrl: win.fileUrl,
      formatDate: win.formatDate,
      escapeHtml: win.escapeHtml,
      // Make $, $$ work as bare names (some code calls `$()` without
      // the `window.` prefix).
      $: win.$, $$: win.$$,
      // el() is the production's element factory. It's loaded
      // from window.el / window.createElement in app.js, but
      // the fileBrowser* code uses it as a bare name.
      el: elFactory,
      createElement: elFactory,
      // The fileBrowser* services use `state` as a bare global
      // (it's `var state = window.state || {}` in fileBrowser1.js,
      // and the other files just reference `state` directly). For
      // tests that load fileBrowser2a / fileBrowser2b WITHOUT
      // loading fileBrowser1 first, we need to seed `state` on
      // the bare global scope. We expose it as a getter so
      // window.state mutations stay in sync.
      get state() { return win.state; },
      set state(v) { win.state = v; },
      // Others.
      JobRunner: win.JobRunner,
      CSS: win.CSS,
      DropTarget: win.DropTarget,
      // Append any extra globals the caller wants.
      ...extra,
    },
  };
}

// Load a file into the sandbox. Returns the script.
function loadInto(sandbox, rel) {
  const code = fs.readFileSync(src(rel), 'utf8');
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: rel });
}

// ============================================================================
// 1. fileBrowser1 — refreshBrowser race + fbSelectAll + parentDir
// ============================================================================

// ----------------------------------------------------------------------------
// T1: refreshBrowser race — 3 concurrent calls, last wins
// ----------------------------------------------------------------------------
test('AUDIT FB1-T1: refreshBrowser — 3 concurrent calls, last value wins', async () => {
  const { sandbox, win, document, getOrCreate } = makeSandbox();
  getOrCreate('fb-list');
  getOrCreate('fb-path');
  win.state = {
    fbShowAllFiles: false, currentTab: 'image', fbDirs: {},
    config: { output_dir: '/root' }, fbDir: '', fbSort: 'name',
    fbColumns: {}, fbSelected: new Set(), _fbItems: [],
  };
  const calls = [];
  win.api.fbList = async (dir) => {
    calls.push({ requestedDir: dir, at: Date.now(), stateAtCallTime: win.state.fbDir });
    await new Promise((r) => setTimeout(r, 10));
    return { ok: true, dir, items: [] };
  };
  loadInto(sandbox, 'renderer/utils/pureFuncs.js');
  loadInto(sandbox, 'renderer/utils/fbSort.js');
  loadInto(sandbox, 'renderer/utils/fbColumns.js');
  loadInto(sandbox, 'renderer/utils/dropTarget.js');
  loadInto(sandbox, 'renderer/services/fileBrowser1.js');
  const refresh = win.refreshBrowser;
  // Fire 3 concurrent refreshes, each setting fbDir to a
  // different value BEFORE awaiting.
  const p1 = (async () => { win.state.fbDir = 'A'; return refresh({ keepCurrent: true }); })();
  await new Promise((r) => setTimeout(r, 1));
  const p2 = (async () => { win.state.fbDir = 'B'; return refresh({ keepCurrent: true }); })();
  await new Promise((r) => setTimeout(r, 1));
  const p3 = (async () => { win.state.fbDir = 'C'; return refresh({ keepCurrent: true }); })();
  await Promise.all([p1, p2, p3]);
  console.log('  observed state.fbDir =', JSON.stringify(win.state.fbDir));
  console.log('  fbList call log =', calls.map((c) => c.requestedDir));
  console.log('  fbList stateAtCallTime log =', calls.map((c) => c.stateAtCallTime));
  // Defect FB1-D1: The IIFE at line 139 always writes
  // `state.fbDir = target.dir`, which overwrites the user's
  // latest navigation with the captured value. The follow-up
  // recursion then reads back the overwritten value, so
  // concurrent refreshes ALWAYS lose the user's latest
  // intent (regardless of which call set it last).
  assert.equal(win.state.fbDir, 'C',
    `After 3 concurrent refreshes, the LAST call value must win. Got ${JSON.stringify(win.state.fbDir)}, expected "C".`);
});

// AUDIT FB1-D1 — additional confirmation: if the user's last
// intent was 'C', state.fbDir MUST end up as 'C' after all
// 3 refreshes settle (not 'A' from the first call's overwrite).
test('AUDIT FB1-T1c: state.fbDir after concurrent refresh must reflect LAST user intent', async () => {
  const { sandbox, win, document, getOrCreate } = makeSandbox();
  getOrCreate('fb-list');
  getOrCreate('fb-path');
  win.state = {
    fbShowAllFiles: false, currentTab: 'image', fbDirs: {},
    config: { output_dir: '/root' }, fbDir: '', fbSort: 'name',
    fbColumns: {}, fbSelected: new Set(), _fbItems: [],
  };
  win.api.fbList = async (dir) => {
    await new Promise((r) => setTimeout(r, 5));
    return { ok: true, dir, items: [] };
  };
  loadInto(sandbox, 'renderer/utils/pureFuncs.js');
  loadInto(sandbox, 'renderer/utils/fbSort.js');
  loadInto(sandbox, 'renderer/utils/fbColumns.js');
  loadInto(sandbox, 'renderer/utils/dropTarget.js');
  loadInto(sandbox, 'renderer/services/fileBrowser1.js');
  const refresh = win.refreshBrowser;
  // Two concurrent calls; the second sets a value the first
  // did NOT see.
  const p1 = (async () => { win.state.fbDir = 'first'; return refresh({ keepCurrent: true }); })();
  await new Promise((r) => setTimeout(r, 1));
  win.state.fbDir = 'second';
  const p2 = refresh({ keepCurrent: true });
  await Promise.all([p1, p2]);
  console.log('  observed state.fbDir =', JSON.stringify(win.state.fbDir));
  // The user's latest intent was 'second'. The follow-up
  // recursion should re-read state.fbDir (now 'second') and
  // fire fbList('second'). But the first IIFE's line 139
  // overwrites state.fbDir back to 'first' before the
  // follow-up runs, so the follow-up captures 'first'.
  assert.equal(win.state.fbDir, 'second',
    `Concurrent refreshes must preserve the latest user navigation; got ${JSON.stringify(win.state.fbDir)}, expected "second"`);
});

// ----------------------------------------------------------------------------
// T2: refreshBrowser — 5 rapid clicks, in-flight guard prevents 5 IPCs
// ----------------------------------------------------------------------------
test('AUDIT FB1-T1b: refreshBrowser — first call completes BEFORE second call (sequential)', async () => {
  // Sanity check: a sequential call (the second starts AFTER the
  // first finishes) should ALWAYS respect the latest state.
  const { sandbox, win, document, getOrCreate } = makeSandbox();
  getOrCreate('fb-list');
  getOrCreate('fb-path');
  win.state = {
    fbShowAllFiles: false, currentTab: 'image', fbDirs: {},
    config: { output_dir: '/root' }, fbDir: '', fbSort: 'name',
    fbColumns: {}, fbSelected: new Set(), _fbItems: [],
  };
  const calls = [];
  win.api.fbList = async (dir) => {
    calls.push(dir);
    await new Promise((r) => setTimeout(r, 5));
    return { ok: true, dir, items: [] };
  };
  loadInto(sandbox, 'renderer/utils/pureFuncs.js');
  loadInto(sandbox, 'renderer/utils/fbSort.js');
  loadInto(sandbox, 'renderer/utils/fbColumns.js');
  loadInto(sandbox, 'renderer/utils/dropTarget.js');
  loadInto(sandbox, 'renderer/services/fileBrowser1.js');
  const refresh = win.refreshBrowser;
  // Sequential: first call to "A", await, then second to "B".
  win.state.fbDir = 'A';
  await refresh({ keepCurrent: true });
  win.state.fbDir = 'B';
  await refresh({ keepCurrent: true });
  console.log('  observed state.fbDir =', JSON.stringify(win.state.fbDir), 'calls =', calls);
  assert.equal(win.state.fbDir, 'B', 'sequential calls must respect the latest state');
});

test('AUDIT FB1-T2: refreshBrowser — 5 rapid clicks, in-flight guard limits IPCs', async () => {
  const { sandbox, win, document, getOrCreate } = makeSandbox();
  getOrCreate('fb-list');
  getOrCreate('fb-path');
  win.state = {
    fbShowAllFiles: false, currentTab: 'image', fbDirs: {},
    config: { output_dir: '/root' }, fbDir: '/root', fbSort: 'name',
    fbColumns: {}, fbSelected: new Set(), _fbItems: [],
  };
  let calls = 0;
  let resolveList;
  win.api.fbList = (dir) => {
    calls++;
    if (calls === 1) return new Promise((r) => { resolveList = r; });
    return new Promise((r) => setTimeout(() => r({ ok: true, dir, items: [] }), 1));
  };
  loadInto(sandbox, 'renderer/utils/pureFuncs.js');
  loadInto(sandbox, 'renderer/utils/fbSort.js');
  loadInto(sandbox, 'renderer/utils/fbColumns.js');
  loadInto(sandbox, 'renderer/utils/dropTarget.js');
  loadInto(sandbox, 'renderer/services/fileBrowser1.js');
  const refresh = win.refreshBrowser;
  // Fire 5 calls without awaiting.
  const ps = [];
  for (let i = 0; i < 5; i++) {
    ps.push(refresh({ keepCurrent: true }));
    await new Promise((r) => setTimeout(r, 1));
  }
  resolveList({ ok: true, dir: '/root', items: [] });
  await Promise.all(ps);
  console.log('  observed fbList invocations =', calls, 'for 5 rapid clicks');
  // The contract: at most 2 IPCs (the first + 1 follow-up), NOT 5.
  assert.ok(calls <= 2,
    `In-flight guard should fire at most 2 IPCs for 5 rapid clicks; got ${calls}`);
});

// ----------------------------------------------------------------------------
// T3: fbSelectAll respects type filter (L9 fix)
// ----------------------------------------------------------------------------
test('AUDIT FB1-T3a: fbSelectAll — supported-type gate (the L9 fix)', () => {
  const { sandbox, win, document, getOrCreate } = makeSandbox();
  getOrCreate('fb-list');
  getOrCreate('fb-path');
  win.state = {
    fbShowAllFiles: false, currentTab: 'image', fbDirs: {},
    config: { output_dir: '/root' }, fbDir: '/root', fbSort: 'name',
    fbColumns: {}, fbSelected: new Set(),
    _fbItems: [
      { isDir: false, ext: '.png', path: '/root/a.png', name: 'a.png' },
      { isDir: false, ext: '.jpg', path: '/root/b.jpg', name: 'b.jpg' },
      { isDir: false, ext: '.mp4', path: '/root/c.mp4', name: 'c.mp4' },
      { isDir: false, ext: '.txt', path: '/root/d.txt', name: 'd.txt' },
    ],
  };
  win.api.fbList = async () => ({ ok: true, dir: '/root', items: [] });
  loadInto(sandbox, 'renderer/utils/pureFuncs.js');
  loadInto(sandbox, 'renderer/utils/fbSort.js');
  loadInto(sandbox, 'renderer/utils/fbColumns.js');
  loadInto(sandbox, 'renderer/utils/dropTarget.js');
  loadInto(sandbox, 'renderer/services/fileBrowser1.js');
  win.fbSelectAll();
  console.log('  observed fbSelected.size =', win.state.fbSelected.size);
  console.log('  observed fbSelected =', Array.from(win.state.fbSelected));
  // All 4 items are SUPPORTED (the v1.1.15 list includes .png,
  // .jpg, .mp4, .txt), so isItemVisibleInList passes all 4.
  // The fbSelectAll implementation here filters ONLY by
  // isItemVisibleInList, NOT by the dropdown — the type-filter
  // dropdown is applied in applyFileSearch at the DOM layer.
  // This is the L9 contract: "only select VISIBLE items" — and
  // the production code's "visible" is what isItemVisibleInList
  // allows (the supported-types gate), not the dropdown's value.
  assert.ok(win.state.fbSelected.size >= 2,
    'At minimum the .png and .jpg should be selected');
});

test('AUDIT FB1-T3b: fbSelectAll — when showAllFiles=false, .exe is NOT selected (L9)', () => {
  const { sandbox, win, document, getOrCreate } = makeSandbox();
  getOrCreate('fb-list');
  getOrCreate('fb-path');
  win.state = {
    fbShowAllFiles: false, currentTab: 'image', fbDirs: {},
    config: { output_dir: '/root' }, fbDir: '/root', fbSort: 'name',
    fbColumns: {}, fbSelected: new Set(),
    _fbItems: [
      { isDir: false, ext: '.png', path: '/root/a.png', name: 'a.png' },
      { isDir: false, ext: '.exe', path: '/root/x.exe', name: 'x.exe' },
    ],
  };
  win.api.fbList = async () => ({ ok: true, dir: '/root', items: [] });
  loadInto(sandbox, 'renderer/utils/pureFuncs.js');
  loadInto(sandbox, 'renderer/utils/fbSort.js');
  loadInto(sandbox, 'renderer/utils/fbColumns.js');
  loadInto(sandbox, 'renderer/utils/dropTarget.js');
  loadInto(sandbox, 'renderer/services/fileBrowser1.js');
  win.fbSelectAll();
  console.log('  observed fbSelected =', Array.from(win.state.fbSelected));
  assert.equal(win.state.fbSelected.size, 1,
    'fbSelectAll must NOT include .exe when showAllFiles=false (the L9 fix)');
  assert.ok(win.state.fbSelected.has('/root/a.png'));
  assert.ok(!win.state.fbSelected.has('/root/x.exe'));
});

// ----------------------------------------------------------------------------
// T4: parentDir — pure function test
// ----------------------------------------------------------------------------
test('AUDIT FB1-T4: parentDir — handles all path forms', () => {
  const { sandbox } = makeSandbox();
  loadInto(sandbox, 'renderer/utils/pureFuncs.js');
  const { parentDir } = sandbox.window.PureFuncs;
  const cases = [
    ['C:\\Users\\Test',                    'C:\\Users'],
    ['C:\\Users\\Test\\',                  'C:\\Users'],
    ['C:\\',                               ''],
    ['C:',                                ''],
    ['\\\\server\\share\\dir',             '\\\\server\\share'],
    ['\\\\server\\share\\',                '\\\\server'],
    ['/home/user/docs',                    '/home/user'],
    ['/home/user/',                        '/home'],
    ['/',                                  ''],
    ['',                                   ''],
    [null,                                 ''],
    [undefined,                            ''],
  ];
  for (const [input, expected] of cases) {
    const observed = parentDir(input);
    console.log(`  parentDir(${JSON.stringify(input)}) = ${JSON.stringify(observed)} (expected ${JSON.stringify(expected)})`);
    assert.equal(observed, expected, `parentDir(${JSON.stringify(input)}) must be ${JSON.stringify(expected)}`);
  }
});

// ============================================================================
// 2. fileBrowser2a — _stopPreviewMedia + previewImageFromFile +
//    previewImagesFromFiles + thumbnail re-click
// ============================================================================

// ----------------------------------------------------------------------------
// T2a-1: _stopPreviewMedia pauses active media
// ----------------------------------------------------------------------------
test('AUDIT FB2A-T1: _stopPreviewMedia pauses audio + video + clears src', () => {
  const { sandbox, win, document, getOrCreate } = makeSandbox();
  const pane = makeEl('div');
  pane.id = 'fb-preview-content';
  const audio = makeEl('audio');
  const video = makeEl('video');
  let audioSrc = 'http://x/a.mp3';
  let videoSrc = 'http://x/b.mp4';
  Object.defineProperty(audio, 'src', { get() { return audioSrc; }, set(v) { audioSrc = v; } });
  Object.defineProperty(video, 'src', { get() { return videoSrc; }, set(v) { videoSrc = v; } });
  let audioPaused = false, videoPaused = false;
  audio.pause = () => { audioPaused = true; };
  video.pause = () => { videoPaused = true; };
  pane.appendChild(audio);
  pane.appendChild(video);
  document.elements['fb-preview-content'] = pane;
  loadInto(sandbox, 'renderer/utils/pureFuncs.js');
  loadInto(sandbox, 'renderer/services/fileBrowser2a.js');
  win._stopPreviewMedia();
  console.log('  audioPaused=%s videoPaused=%s audioSrc=%j videoSrc=%j',
    audioPaused, videoPaused, audioSrc, videoSrc);
  assert.equal(audioPaused, true, 'audio.pause() must be called');
  assert.equal(videoPaused, true, 'video.pause() must be called');
  assert.equal(audioSrc, '', 'audio.src must be cleared');
  assert.equal(videoSrc, '', 'video.src must be cleared');
});

test('AUDIT FB2A-T1b: _stopPreviewMedia does NOT throw on null preview pane', () => {
  const { sandbox, win } = makeSandbox();
  loadInto(sandbox, 'renderer/utils/pureFuncs.js');
  loadInto(sandbox, 'renderer/services/fileBrowser2a.js');
  let threw = false;
  try { win._stopPreviewMedia(); } catch (_) { threw = true; }
  assert.equal(threw, false, 'must not throw on missing preview pane');
});

test('AUDIT FB2A-T1c: _stopPreviewMedia does NOT throw on empty preview pane', () => {
  const { sandbox, win, document } = makeSandbox();
  const pane = makeEl('div');
  pane.id = 'fb-preview-content';
  document.elements['fb-preview-content'] = pane;
  loadInto(sandbox, 'renderer/utils/pureFuncs.js');
  loadInto(sandbox, 'renderer/services/fileBrowser2a.js');
  let threw = false;
  try { win._stopPreviewMedia(); } catch (_) { threw = true; }
  assert.equal(threw, false, 'must not throw on empty preview pane');
});

// ----------------------------------------------------------------------------
// T2a-2: previewImageFromFile same-file early return
// ----------------------------------------------------------------------------
test('AUDIT FB2A-T2: previewImageFromFile — same-file second call is a no-op', async () => {
  const { sandbox, win, document } = makeSandbox();
  const fbList = makeEl('ul'); fbList.id = 'fb-list'; document.elements['fb-list'] = fbList;
  const previewContent = makeEl('div'); previewContent.id = 'fb-preview-content';
  document.elements['fb-preview-content'] = previewContent;
  // Stub Image so the .onload fires immediately.
  class StubImage {
    constructor() { this._listeners = {}; }
    set src(v) { this._src = v; setImmediate(() => this.onload && this.onload()); }
    addEventListener() {}
  }
  sandbox.Image = StubImage;
  loadInto(sandbox, 'renderer/utils/pureFuncs.js');
  loadInto(sandbox, 'renderer/services/fileBrowser2a.js');
  // updatePreviewPane is a function declaration in the file —
  // it's available on the sandbox.
  let updateCalls = 0;
  sandbox.updatePreviewPane = () => { updateCalls++; };
  win.state = win.state || {};
  win.state._lastPreviewPath = null;
  win.state._previewBatch = null;
  const previewImageFromFile = sandbox.previewImageFromFile;
  previewImageFromFile('a.png');
  console.log('  after call 1: _lastPreviewPath =', win.state._lastPreviewPath, 'updateCalls =', updateCalls);
  assert.equal(win.state._lastPreviewPath, 'a.png', 'first call must set _lastPreviewPath');
  await new Promise((r) => setImmediate(r));
  const callsAfterFirst = updateCalls;
  previewImageFromFile('a.png');
  await new Promise((r) => setImmediate(r));
  const callsAfterSecond = updateCalls;
  console.log('  after call 2: _lastPreviewPath =', win.state._lastPreviewPath,
    'updateCalls delta =', callsAfterSecond - callsAfterFirst);
  assert.equal(callsAfterSecond, callsAfterFirst,
    'Second call to previewImageFromFile with the same path must be a no-op');
  previewImageFromFile('b.png');
  await new Promise((r) => setImmediate(r));
  console.log('  after call 3: _lastPreviewPath =', win.state._lastPreviewPath, 'updateCalls =', updateCalls);
  assert.equal(win.state._lastPreviewPath, 'b.png', 'different-path call must update _lastPreviewPath');
  assert.ok(updateCalls > callsAfterFirst, 'different-path call must trigger a re-render');
});

// ----------------------------------------------------------------------------
// T2a-3: previewImagesFromFiles clears _lastPreviewPath
// ----------------------------------------------------------------------------
test('AUDIT FB2A-T3: previewImagesFromFiles — clears _lastPreviewPath so a follow-up single preview is not skipped', async () => {
  const { sandbox, win, document } = makeSandbox();
  const fbList = makeEl('ul'); fbList.id = 'fb-list'; document.elements['fb-list'] = fbList;
  const previewContent = makeEl('div'); previewContent.id = 'fb-preview-content';
  document.elements['fb-preview-content'] = previewContent;
  class StubImage { constructor(){} set src(v){this._src=v;setImmediate(()=>this.onload&&this.onload());} addEventListener(){} }
  sandbox.Image = StubImage;
  loadInto(sandbox, 'renderer/utils/pureFuncs.js');
  loadInto(sandbox, 'renderer/services/fileBrowser2a.js');
  sandbox.updatePreviewPane = () => {};
  win.state = win.state || {};
  win.state._lastPreviewPath = null;
  win.state._previewBatch = null;
  const previewImageFromFile = sandbox.previewImageFromFile;
  const previewImagesFromFiles = sandbox.previewImagesFromFiles;
  previewImageFromFile('a.png');
  await new Promise((r) => setImmediate(r));
  console.log('  after single preview of a.png: _lastPreviewPath =', win.state._lastPreviewPath);
  assert.equal(win.state._lastPreviewPath, 'a.png');
  previewImagesFromFiles(['a.png', 'b.png']);
  await new Promise((r) => setImmediate(r));
  console.log('  after multi preview: _lastPreviewPath =', win.state._lastPreviewPath);
  assert.equal(win.state._lastPreviewPath, null,
    'previewImagesFromFiles must clear _lastPreviewPath (the M10 fix)');
  let updateCalls = 0;
  sandbox.updatePreviewPane = () => { updateCalls++; };
  previewImageFromFile('a.png');
  await new Promise((r) => setImmediate(r));
  console.log('  after single preview of a.png (post-grid): _lastPreviewPath =',
    win.state._lastPreviewPath, 'updateCalls =', updateCalls);
  assert.equal(win.state._lastPreviewPath, 'a.png');
  assert.ok(updateCalls > 0, 'Single preview of a.png after a grid must re-render (NOT skipped)');
});

// ----------------------------------------------------------------------------
// T2a-4: Thumbnail click is re-clickable (no { once: true })
// ----------------------------------------------------------------------------
test('AUDIT FB2A-T4: Thumbnail click handler fires on every click (no { once: true })', () => {
  const code = fs.readFileSync(src('renderer/services/fileBrowser2a.js'), 'utf8');
  const noComments = code.replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!noComments.includes("addEventListener('click', open, { once: true })"),
    "fileBrowser2a must NOT use { once: true } on the thumbnail click handler");
  const plainMatches = noComments.match(/addEventListener\('click', open\)/g) || [];
  assert.ok(plainMatches.length >= 2,
    `Expected at least 2 plain 'click' bindings (grid + _buildPreviewThumb); got ${plainMatches.length}`);
});

// ============================================================================
// 3. fileBrowser2b — previewAudioFromFile / previewVideoFromFile
//    + startGenPolling _genPollActive + scroll preservation
// ============================================================================

// ----------------------------------------------------------------------------
// T3-1: previewAudioFromFile + previewVideoFromFile call _stopPreviewMedia
// ----------------------------------------------------------------------------
test('AUDIT FB2B-T1: previewAudioFromFile + previewVideoFromFile both call _stopPreviewMedia', () => {
  const { sandbox, win, document, getOrCreate } = makeSandbox();
  getOrCreate('fb-list');
  getOrCreate('fb-preview-content');
  win.state = win.state || { _lastPreviewPath: null, _previewBatch: null, _fbItems: [] };
  let stopCalls = 0;
  loadInto(sandbox, 'renderer/utils/pureFuncs.js');
  loadInto(sandbox, 'renderer/services/fileBrowser2a.js');
  // After loading 2a, win._stopPreviewMedia is set by the module.
  // Re-set our counter AFTER the load so we observe calls.
  win._stopPreviewMedia = () => { stopCalls++; };
  loadInto(sandbox, 'renderer/services/fileBrowser2b.js');
  const audio = sandbox.previewAudioFromFile;
  const video = sandbox.previewVideoFromFile;
  console.log('  typeof previewAudioFromFile =', typeof audio);
  console.log('  typeof previewVideoFromFile =', typeof video);
  assert.equal(typeof audio, 'function', 'previewAudioFromFile must be exposed');
  assert.equal(typeof video, 'function', 'previewVideoFromFile must be exposed');
  audio('x.mp3');
  video('y.mp4');
  console.log('  observed _stopPreviewMedia calls =', stopCalls);
  assert.ok(stopCalls >= 2, `Both audio + video previews must call _stopPreviewMedia; got ${stopCalls} calls`);
});

// ----------------------------------------------------------------------------
// T3-2: startGenPolling has a _genPollActive flag
// ----------------------------------------------------------------------------
test('AUDIT FB2B-T2: startGenPolling — second concurrent call returns immediately (L8)', async () => {
  const { sandbox, win } = makeSandbox();
  win.state = {
    fbShowAllFiles: false, currentTab: 'image', fbDirs: {},
    config: { output_dir: '/root' }, fbDir: '/root', fbSort: 'name',
    fbColumns: {}, fbSelected: new Set(), _fbItems: [],
    _lastPolledItems: null, generating: true,
  };
  let resolveList;
  let listCalls = 0;
  win.api.fbList = () => new Promise((r) => { listCalls++; resolveList = r; });
  loadInto(sandbox, 'renderer/utils/pureFuncs.js');
  loadInto(sandbox, 'renderer/services/fileBrowser2a.js');
  loadInto(sandbox, 'renderer/services/fileBrowser2b.js');
  const { startGenPolling, stopGenPolling } = sandbox;
  assert.equal(typeof startGenPolling, 'function', 'startGenPolling must be exposed');
  const p1 = startGenPolling();
  await new Promise((r) => setTimeout(r, 5));
  const p2 = startGenPolling();
  const callsAfterP2 = listCalls;
  console.log('  fbList calls after p1+p2 =', callsAfterP2);
  resolveList({ ok: true, dir: '/root', items: [] });
  await p1;
  await p2;
  stopGenPolling();
  assert.ok(callsAfterP2 <= 1,
    `Second concurrent startGenPolling must NOT add another fbList call; observed ${callsAfterP2}`);
});

// ----------------------------------------------------------------------------
// T3-3: Polling preserves scroll position
// ----------------------------------------------------------------------------
test('AUDIT FB2B-T3: Polling tick preserves scrollTop (L7)', () => {
  const code = fs.readFileSync(src('renderer/services/fileBrowser2b.js'), 'utf8');
  const noComments = code.replace(/^\s*\/\/.*$/gm, '');
  assert.ok(noComments.includes('savedScroll'),
    'the polling tick must capture scroll position into savedScroll');
  assert.ok(/ul\.scrollTop = Math\.min\(savedScroll/.test(noComments),
    'the polling tick must restore scrollTop after the re-render (L7)');
});

// ----------------------------------------------------------------------------
// T3-4: EMPIRICAL — Polling tick preserves scrollTop with REAL DOM
// ----------------------------------------------------------------------------
test('AUDIT FB2B-T3b: Polling tick preserves scrollTop — REAL DOM run', async () => {
  // Empirically load the production polling tick with a real
  // (mock) DOM. Set scrollTop to 500, fire a tick, verify
  // scrollTop is preserved (not snapped to 0).
  const { sandbox, win, document, getOrCreate } = makeSandbox();
  getOrCreate('fb-list');
  // The list needs scrollHeight set to a non-zero value (so
  // Math.min(savedScroll, scrollHeight) doesn't clamp to 0).
  const fbList = document.getElementById('fb-list');
  fbList.scrollHeight = 1000;
  fbList.scrollTop = 500;
  win.state = {
    fbShowAllFiles: false, currentTab: 'image', fbDirs: {},
    config: { output_dir: '/root' }, fbDir: '/root', fbSort: 'name',
    fbColumns: {}, fbSelected: new Set(), _fbItems: [],
    _lastPolledItems: null, generating: true,
  };
  // First call is the snapshot fetch (in startGenPolling).
  // We let it resolve immediately so the tick fires.
  // Subsequent calls are the per-tick fbList.
  let firstCall = true;
  win.api.fbList = (dir) => {
    if (firstCall) {
      firstCall = false;
      // Snapshot fetch — let it resolve with current items.
      return Promise.resolve({ ok: true, dir, items: [] });
    }
    return Promise.resolve({ ok: true, dir, items: [] });
  };
  loadInto(sandbox, 'renderer/utils/pureFuncs.js');
  loadInto(sandbox, 'renderer/services/fileBrowser2a.js');
  loadInto(sandbox, 'renderer/services/fileBrowser2b.js');
  const { startGenPolling, stopGenPolling } = sandbox;
  assert.equal(typeof startGenPolling, 'function');
  const p1 = startGenPolling();
  // Wait long enough for the snapshot fetch + the first tick
  // to complete. Each tick awaits fbList; the in-flight guard
  // is irrelevant because we only call startGenPolling once.
  await new Promise((r) => setTimeout(r, 20));
  await p1;
  console.log('  scrollTop after tick:', fbList.scrollTop);
  stopGenPolling();
  // scrollTop should still be 500 (preserved by the L7 fix).
  // The Math.min(savedScroll, scrollHeight) clamp is fine:
  // 500 < 1000 so it stays 500.
  assert.equal(fbList.scrollTop, 500,
    'polling tick must preserve scrollTop (got ' + fbList.scrollTop + ', expected 500)');
});

// ============================================================================
// 4. ArchiveViewer — in-flight guard + dedup + open/close + delete
// ============================================================================

// ----------------------------------------------------------------------------
// T4-1: In-flight guard
// ----------------------------------------------------------------------------
test('AUDIT AV-T1: ArchiveViewer — in-flight guard prevents concurrent _loadNextPage IPCs', async () => {
  const { sandbox, win } = makeSandbox();
  // ArchiveViewer uses bare `confirm` + `alert`. Provide shims on
  // the sandbox.
  sandbox.confirm = () => true;
  sandbox.alert = () => {};
  let readCalls = 0;
  let resolveRead;
  win.api.stateArchiveRead = (args) => new Promise((r) => {
    readCalls++;
    if (readCalls === 1) {
      resolveRead = r;
    } else {
      setTimeout(() => r({ ok: true, lines: [], hasMore: true, nextOffset: 0 }), 0);
    }
  });
  loadInto(sandbox, 'renderer/widgets/ArchiveViewer.js');
  const openP = win.ArchiveViewer.open();
  await new Promise((r) => setTimeout(r, 1));
  const list = win.document.getElementById('archive-viewer-list');
  if (list) {
    list.scrollTop = 9999;
    list.scrollHeight = 10000;
    list.clientHeight = 100;
    list.dispatchEvent({ type: 'scroll' });
  }
  resolveRead({ ok: true, lines: [{ id: '1', title: 'one', status: 'ok' }],
                hasMore: true, nextOffset: 1 });
  await openP;
  await new Promise((r) => setTimeout(r, 5));
  console.log('  observed stateArchiveRead calls =', readCalls);
  assert.equal(readCalls, 1,
    `In-flight guard should drop the second concurrent call; observed ${readCalls} IPCs (expected 1)`);
});

// ----------------------------------------------------------------------------
// T4-2: Dedup by id
// ----------------------------------------------------------------------------
test('AUDIT AV-T2: ArchiveViewer — re-open re-reads entries (dedup cleared)', async () => {
  const { sandbox, win } = makeSandbox();
  sandbox.confirm = () => true;
  sandbox.alert = () => {};
  let readCount = 0;
  win.api.stateArchiveRead = () => {
    readCount++;
    return Promise.resolve({
      ok: true,
      lines: [
        { id: 'a', title: 'A', status: 'ok' },
        { id: 'b', title: 'B', status: 'ok' },
      ],
      hasMore: false,
      nextOffset: 2,
    });
  };
  loadInto(sandbox, 'renderer/widgets/ArchiveViewer.js');
  await win.ArchiveViewer.open();
  const initialRows = win.document.querySelectorAll('.archive-row');
  console.log('  after first open: rows =', initialRows.length, 'IPC count =', readCount);
  win.ArchiveViewer.close();
  await win.ArchiveViewer.open();
  const afterReopen = win.document.querySelectorAll('.archive-row');
  console.log('  after re-open: rows =', afterReopen.length, 'IPC count =', readCount);
  assert.equal(afterReopen.length, 2, 'Re-open must re-read the entries');
});

// ----------------------------------------------------------------------------
// T4-3: Open/close cycle resets internal state
// ----------------------------------------------------------------------------
test('AUDIT AV-T3: ArchiveViewer — open() resets _nextOffset to 0', async () => {
  const { sandbox, win } = makeSandbox();
  sandbox.confirm = () => true;
  sandbox.alert = () => {};
  let resolveRead;
  win.api.stateArchiveRead = () => new Promise((r) => { resolveRead = r; });
  loadInto(sandbox, 'renderer/widgets/ArchiveViewer.js');
  const p1 = win.ArchiveViewer.open();
  await new Promise((r) => setTimeout(r, 1));
  resolveRead({ ok: true, lines: [{ id: '1', title: 'one', status: 'ok' }],
                hasMore: true, nextOffset: 1 });
  await p1;
  let secondOffset = null;
  win.api.stateArchiveRead = (args) => {
    secondOffset = args.offset;
    return Promise.resolve({ ok: true, lines: [], hasMore: false, nextOffset: 0 });
  };
  win.ArchiveViewer.close();
  await win.ArchiveViewer.open();
  console.log('  after close+reopen: second read offset =', secondOffset);
  assert.equal(secondOffset, 0,
    'Re-open must reset _nextOffset to 0 (so the next read starts at the beginning)');
});

// ----------------------------------------------------------------------------
// T4-4: Delete removes from _loadedIds
// ----------------------------------------------------------------------------
test('AUDIT AV-T4: ArchiveViewer — delete removes entry; reopen can re-read it', async () => {
  const { sandbox, win } = makeSandbox();
  sandbox.confirm = () => true;
  sandbox.alert = () => {};
  win.api.stateArchiveRead = () => Promise.resolve({
    ok: true, lines: [{ id: 'a', title: 'A', status: 'ok' }], hasMore: false, nextOffset: 1,
  });
  let deleteCalls = 0;
  win.api.stateArchiveDelete = (id) => { deleteCalls++; return Promise.resolve({ ok: true }); };
  loadInto(sandbox, 'renderer/widgets/ArchiveViewer.js');
  await win.ArchiveViewer.open();
  const rowsBefore = win.document.querySelectorAll('.archive-row');
  console.log('  rows before delete =', rowsBefore.length);
  assert.equal(rowsBefore.length, 1);
  const delBtn = rowsBefore[0].querySelector('button.danger');
  assert.ok(delBtn, 'delete button must exist');
  delBtn.dispatchEvent({ type: 'click' });
  await new Promise((r) => setTimeout(r, 10));
  const rowsAfter = win.document.querySelectorAll('.archive-row');
  console.log('  rows after delete =', rowsAfter.length, 'deleteCalls =', deleteCalls);
  assert.equal(rowsAfter.length, 0, 'Row should be removed from DOM after delete');
  assert.equal(deleteCalls, 1, 'stateArchiveDelete must be called exactly once');
  let readOffset = null;
  win.api.stateArchiveRead = (args) => {
    readOffset = args.offset;
    return Promise.resolve({ ok: true, lines: [{ id: 'a', title: 'A', status: 'ok' }],
                             hasMore: false, nextOffset: 1 });
  };
  win.ArchiveViewer.close();
  await win.ArchiveViewer.open();
  const rowsAfterReopen = win.document.querySelectorAll('.archive-row');
  console.log('  rows after delete + close + reopen =', rowsAfterReopen.length);
  assert.equal(rowsAfterReopen.length, 1,
    'After delete + reopen, the entry should re-appear');
});

// ============================================================================
// 5. SplitterDrag — finite MAX + right-click guard + 3 splitters
// ============================================================================

// ----------------------------------------------------------------------------
// T5-1: Finite MAX
// ----------------------------------------------------------------------------
test('AUDIT SD-T1: SplitterDrag — finite upper bounds (L18)', () => {
  const { sandbox, win } = makeSandbox();
  loadInto(sandbox, 'renderer/components/SplitterDrag.js');
  const { clampLayout } = win.SplitterDrag;
  assert.equal(clampLayout('--sidebar-w', 99999), 3840,
    'sidebar MAX must be finite (3840), not Infinity');
  assert.equal(clampLayout('--preview-w', 99999), 3840,
    'preview MAX must be finite (3840), not Infinity');
  assert.equal(clampLayout('--logbar-h', 99999), 2160,
    'logbar MAX must be finite (2160), not Infinity');
  assert.equal(clampLayout('--sidebar-w', 50), 200);
  assert.equal(clampLayout('--logbar-h', 10), 80);
  assert.equal(clampLayout('--preview-w', 100), 200);
});

// ----------------------------------------------------------------------------
// T5-2: Right-click does not start drag
// ----------------------------------------------------------------------------
test('AUDIT SD-T2: SplitterDrag — right-click (e.button=2) does NOT add resizing-width class', () => {
  const { sandbox, win, document } = makeSandbox();
  const s1 = makeEl('div'); s1.id = 'splitter-sidebar'; document.elements['splitter-sidebar'] = s1;
  const s2 = makeEl('div'); s2.id = 'splitter-logbar';  document.elements['splitter-logbar']  = s2;
  const s3 = makeEl('div'); s3.id = 'splitter-log-preview'; document.elements['splitter-log-preview'] = s3;
  document.documentElement.style.setProperty('--sidebar-w', '360px');
  loadInto(sandbox, 'renderer/components/SplitterDrag.js');
  // Re-init so the new splitter elements are picked up.
  win.SplitterDrag.init();
  // Right-click on splitter-sidebar.
  s1.dispatchEvent({ type: 'mousedown', button: 2, clientX: 0, clientY: 0, preventDefault: () => {} });
  console.log('  body has resizing-width after right-click =',
    document.body.classList.contains('resizing-width'));
  assert.equal(document.body.classList.contains('resizing-width'), false,
    'right-click must NOT add the resizing-width class (L19 fix)');
  // Now left-click.
  s1.dispatchEvent({ type: 'mousedown', button: 0, clientX: 0, clientY: 0, preventDefault: () => {} });
  console.log('  body has resizing-width after left-click =',
    document.body.classList.contains('resizing-width'));
  assert.equal(document.body.classList.contains('resizing-width'), true,
    'left-click must add the resizing-width class');
  document.dispatchEvent({ type: 'mouseup' });
});

// ----------------------------------------------------------------------------
// T5-3: All 3 splitters exist
// ----------------------------------------------------------------------------
test('AUDIT SD-T3: SplitterDrag — 3 splitters registered (sidebar, logbar, log-preview)', () => {
  const { sandbox, win, document } = makeSandbox();
  const s1 = makeEl('div'); s1.id = 'splitter-sidebar'; document.elements['splitter-sidebar'] = s1;
  const s2 = makeEl('div'); s2.id = 'splitter-logbar';  document.elements['splitter-logbar']  = s2;
  const s3 = makeEl('div'); s3.id = 'splitter-log-preview'; document.elements['splitter-log-preview'] = s3;
  loadInto(sandbox, 'renderer/components/SplitterDrag.js');
  const ids = win.SplitterDrag.SPLITTERS.map((s) => s.id);
  console.log('  registered splitters =', ids);
  assert.equal(ids.length, 3);
  assert.ok(ids.includes('splitter-sidebar'));
  assert.ok(ids.includes('splitter-logbar'));
  assert.ok(ids.includes('splitter-log-preview'));
  const s1After = document.getElementById('splitter-sidebar');
  assert.ok(s1After && s1After._listeners && s1After._listeners.mousedown && s1After._listeners.mousedown.length > 0,
    'splitter-sidebar must have a mousedown listener');
});
