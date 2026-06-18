// Use jsdom to simulate DOM and load all scripts
const fs = require('fs');
const { JSDOM } = require('jsdom');
const { extractFile } = require('@electron/asar');

const asar = 'dist/win-unpacked/resources/app.asar';
const html = fs.readFileSync('renderer/index.html', 'utf8');
const out = fs.createWriteStream('out.txt');
const log = (m) => { out.write(m + '\n'); };

async function main() {
  const dom = new JSDOM(html, { runScripts: 'outside-only', resources: 'usable' });
  const w = dom.window;
  // Forward logs
  w.console = {
    log: (...a) => log('[log] ' + a.join(' ')),
    warn: (...a) => log('[warn] ' + a.join(' ')),
    error: (...a) => log('[error] ' + a.join(' ')),
    info: (...a) => log('[info] ' + a.join(' ')),
  };
  // Preload window.api (defined by preload.js)
  w.api = {
    stateGet: async () => ({}),
    stateSet: async () => {},
    getConfig: async () => ({ api_key: '', output_dir: '', region: 'global', theme: 'dark', styles: [] }),
    setConfig: async () => {},
    batchesGet: async () => ({ image: [], speech: [], music: [], video: [] }),
    configPath: async () => 'C:/test/config.txt',
    fbReveal: () => {},
    onLog: () => {},
    getAppVersion: async () => ({ version: '1.1.1' }),
  };
  // Load all scripts
  const re = /<script src="([^"]+)"/g;
  const scripts = [];
  let m;
  while ((m = re.exec(html))) scripts.push(m[1]);
  log('Loading ' + scripts.length + ' scripts...');
  for (const s of scripts) {
    const asarPath = s.replace(/\//g, '\\');
    try {
      const code = extractFile(asar, asarPath).toString('utf8');
      try {
        w.eval(code);
        log('OK   ' + s);
      } catch (e) {
        log('ERR  ' + s + ': ' + e.message);
        if (e.stack) log(e.stack.split('\n').slice(0, 4).join('\n'));
      }
    } catch (e) {
      log('MISS ' + s + ': ' + e.message);
    }
  }
  // Check if init was called
  log('\n--- AFTER LOAD ---');
  log('TABS keys: ' + Object.keys(w.TABS || {}).join(', '));
  log('state.config: ' + JSON.stringify(w.state && w.state.config));
  log('init was called: ' + (typeof w.TABS?.image?.build === 'function'));
  // Try to manually call build
  if (w.TABS && w.TABS.image && typeof w.TABS.image.build === 'function') {
    try {
      w.TABS.image.build();
      log('TABS.image.build() ran OK');
    } catch (e) {
      log('TABS.image.build() ERROR: ' + e.message);
      if (e.stack) log(e.stack.split('\n').slice(0, 8).join('\n'));
    }
  } else {
    log('TABS.image.build is not a function');
  }
  // Check tab-image content
  const tab = w.document.getElementById('tab-image');
  if (tab) log('tab-image innerHTML length: ' + tab.innerHTML.length);
  out.end();
}
main().catch(e => { log('FATAL: ' + e.message); out.end(); });
