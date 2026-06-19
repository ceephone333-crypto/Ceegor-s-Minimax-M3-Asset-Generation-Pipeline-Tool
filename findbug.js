const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = __dirname;
const html = fs.readFileSync(path.join(ROOT, 'renderer/index.html'), 'utf8');
const errs = [];
function makeEl(tag) {
  return { tagName: tag.toUpperCase(), style: {}, dataset: {}, classList: { add: () => {}, remove: () => {}, contains: () => false, toggle: () => {} }, children: [], attributes: {}, parentNode: null, innerHTML: '', textContent: '', value: '', checked: false, title: '', href: '', src: '',
    appendChild: function(c) { this.children.push(c); if (typeof c === 'object') c.parentNode = this; return c; },
    addEventListener: function() {}, setAttribute: function(k, v) { this.attributes[k] = v; }, getAttribute: function(k) { return this.attributes[k]; },
    querySelector: function() { return null; }, querySelectorAll: function() { return []; }, dispatchEvent: function() {},
    isConnected: true, click: () => {}, focus: () => {}, select: () => {} };
}
const elements = {};
for (const id of ['brand-version', 'tab-image', 'tab-speech', 'tab-music', 'tab-video', 'fb-up', 'fb-search', 'fb-refresh', 'fb-new', 'fb-open', 'quota-refresh', 'btn-styles', 'btn-theme', 'btn-settings', 'logbar', 'log', 'log-copy', 'log-clear', 'log-toggle', 'preview-clear', 'fb-preview-content', 'fb-quota', 'status', 'toast-root', 'modal-root']) elements[id] = makeEl('div');
const document = { _elements: elements, getElementById: (id) => elements[id] || null, querySelector: () => null, querySelectorAll: () => [], createElement: (tag) => makeEl(tag), addEventListener: () => {}, body: makeEl('body'), documentElement: makeEl('html'), hidden: false, title: 'Test' };
const window = { api: { stateGet: async () => ({}), stateSet: async () => {}, getConfig: async () => ({ api_key: '', output_dir: '', region: 'global', theme: 'dark', styles: [] }), setConfig: async () => {}, batchesGet: async () => ({ image: [], speech: [], music: [], video: [] }), configPath: async () => 'C:/test/config.txt', fbReveal: () => {}, onLog: () => {}, getAppVersion: async () => ({ version: '1.1.1' }) }, TABS: {}, addEventListener: () => {}, dispatchEvent: () => {} };
window.window = window; window.document = document; window.navigator = { clipboard: { writeText: async () => {} } }; window.location = { href: '' };
const sandbox = { window, document, navigator, console: { log: () => {}, warn: () => {}, error: (...a) => errs.push(a.join(' ')) } };
sandbox.global = sandbox;
vm.createContext(sandbox);
const re = /<script src="([^"]+)"/g;
const scripts = []; let m;
while ((m = re.exec(html))) scripts.push(m[1]);
for (const s of scripts) {
  const srcPath = path.join(ROOT, 'renderer', s);
  if (!fs.existsSync(srcPath)) continue;
  try { const code = fs.readFileSync(srcPath, 'utf8'); try { vm.runInContext(code, sandbox, { filename: s }); } catch (e) { console.log('ERR', s, ':', e.message); } } catch (e) {}
}
console.log('TABS:', Object.keys(window.TABS || {}).join(', '));
console.log('window.state:', typeof window.state, window.state ? 'OK' : 'MISSING');
console.log('window.el:', typeof window.el);
try { console.log('Calling TABS.image.build()...'); window.TABS.image.build(); console.log('build() OK'); } catch (e) { console.log('build() FAILED:', e.message); }
try { console.log('Calling TABS.speech.build()...'); window.TABS.speech.build(); console.log('OK'); } catch (e) { console.log('FAILED:', e.message); }
try { console.log('Calling TABS.music.build()...'); window.TABS.music.build(); console.log('OK'); } catch (e) { console.log('FAILED:', e.message); }
try { console.log('Calling TABS.video.build()...'); window.TABS.video.build(); console.log('OK'); } catch (e) { console.log('FAILED:', e.message); }
console.log('--- console.error messages ---');
for (const e of errs.slice(0, 10)) console.log('  ' + e);
