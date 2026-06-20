// scripts/smoke-eval.js — boot the real renderer headless, run the JS in
// process.env.EVAL after init() completes, print the JSON result.
// A debugging companion to smoke-renderer.js (same isolated-config boot).
const path = require('path');
const fs = require('fs');
const os = require('os');

const APP_ROOT = path.resolve(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mmx-eval-'));
const OUT = path.join(TMP, 'out');
fs.mkdirSync(OUT, { recursive: true });
process.env.MINIMAX_CONFIG_DIR = TMP;
fs.writeFileSync(path.join(TMP, 'config.txt'),
  `api_key=sk-smoke-test-key-0000000000\noutput_dir=${OUT}\nregion=global\ntheme=dark\n`, 'utf8');

const { app, BrowserWindow, ipcMain } = require('electron');
try { require(path.join(APP_ROOT, 'main', 'window', 'windowSecurity')); } catch (_) {}

// stub mmx so no backend is needed. SMOKE_SUCCESS=1 → write a real
// output file + return ok:true so success/preview/batch paths run.
const SUCCESS = process.env.SMOKE_SUCCESS === '1';
ipcMain.handle('mmx:run', async (_e, args) => {
  args = Array.isArray(args) ? args : [];
  // Simulate a realistic backend latency so the BatchGen runner (which
  // polls state.generating to detect start/finish) behaves as it would
  // against the real, slow mmx backend. A 0ms (instant) stub races the
  // poll loop and is not representative.
  const delay = Number(process.env.SMOKE_DELAY_MS) || 0;
  if (delay) await new Promise((r) => setTimeout(r, delay));
  if (SUCCESS) {
    let outFile = null;
    for (let i = 0; i < args.length - 1; i++) if (args[i] === '--out' || args[i] === '--download') outFile = args[i + 1];
    if (!outFile) for (const a of args) if (typeof a === 'string' && a.toLowerCase().startsWith(OUT.toLowerCase())) outFile = a;
    if (outFile) {
      // Do NOT create the parent dir (the real mmx doesn't) so the probe
      // reflects whether ensureSubDir actually made the folder.
      try { fs.writeFileSync(outFile, Buffer.from([0, 1, 2, 3])); }
      catch (e) { return { ok: false, code: 1, stdout: '', stderr: 'ENOENT (eval): ' + e.message, parsed: null }; }
    }
    return { ok: true, code: 0, stdout: 'ok', stderr: '', parsed: { smoke: true } };
  }
  return ({ ok: false, code: 1, stdout: '', stderr: 'eval-stub', parsed: null });
});
ipcMain.handle('mmx:voices', async () => []);
ipcMain.handle('mmx:quota', async () => ({ ok: false, error: 'eval-stub' }));
ipcMain.handle('mmx:cancel', () => ({ ok: true }));
ipcMain.handle('mmx:authStatus', async () => ({ ok: false, error: 'eval-stub' }));
ipcMain.handle('mmx:diagnose', async () => ({ platform: process.platform }));

const REGISTRARS = ['registerAppIpc', 'registerConfigIpc', 'registerUpscaleIpc', 'registerIsnetbgIpc',
  'registerImageIpc', 'registerAudioIpc', 'registerFileBrowserIpc', 'registerBatchesIpc',
  'registerStateIpc', 'registerInstallIpc', 'registerFilePickerIpc'];

let win = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const killer = setTimeout(() => { process.stdout.write('\nEVAL_TIMEOUT\n'); app.exit(2); }, Number(process.env.EVAL_TIMEOUT_MS) || 30000);
  try {
    for (const r of REGISTRARS) {
      try { require(path.join(APP_ROOT, 'main', 'ipc', r)).register({ appRoot: APP_ROOT, getMainWindow: () => win }); }
      catch (e) { /* ignore */ }
    }
    win = new BrowserWindow({ width: 1400, height: 900, show: false, webPreferences: {
      preload: path.join(APP_ROOT, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false } });
    const logs = [];
    win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) logs.push(message); });
    await win.loadFile(path.join(APP_ROOT, 'renderer', 'index.html'));
    await win.webContents.executeJavaScript(`window.__err=[];addEventListener('error',e=>__err.push(''+(e.error&&e.error.stack||e.message)));addEventListener('unhandledrejection',e=>__err.push('rej:'+((e.reason&&e.reason.stack)||e.reason)));window.confirm=()=>true;true`);
    for (let i = 0; i < 40; i++) {
      const ok = await win.webContents.executeJavaScript(`!!(document.querySelector('#tab-image')&&document.querySelector('#tab-image').children.length>0)`).catch(() => false);
      if (ok) break; await sleep(250);
    }
    const out = await win.webContents.executeJavaScript(`(async () => { ${process.env.EVAL || 'return "no EVAL"'} })()`);
    process.stdout.write('\nEVAL_BEGIN\n' + JSON.stringify({ out, consoleErrors: logs }, null, 2) + '\nEVAL_END\n');
  } catch (e) {
    process.stdout.write('\nEVAL_FATAL\n' + (e && e.stack || e) + '\n');
  } finally {
    clearTimeout(killer);
    try { if (win) win.destroy(); } catch (_) {}
    app.quit();
    setTimeout(() => app.exit(0), 200);
  }
});
