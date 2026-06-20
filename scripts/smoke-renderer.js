// scripts/smoke-renderer.js — comprehensive headless renderer regression test.
//
// Boots the REAL renderer (index.html + every <script>) in a hidden
// Electron BrowserWindow with the REAL preload + REAL main-process IPC
// (only the mmx generation backend is stubbed, so no network / no mmx
// binary is needed). It then exercises the main user flows and asserts
// they actually work — catching the class of bug that unit tests on the
// pure helpers cannot see, because that code only runs when the real DOM
// handlers fire.
//
// Coverage (each is a hard assertion; any failure → exit code 1):
//   1. init() completes and every tab builds.
//   2. The critical global helpers are all defined.
//   3. Clicking Generate on every tab runs the full happy path
//      (ReferenceError-free) and resets the button.
//   4. BatchGen auto-remove drains completed items from the queue.
//   5. The folder-browser asset-type filter shows matching files only.
//   6. The audio-cutter modal (window.showAudioCutter) opens, probes,
//      and exports a trimmed clip.
//   7. The "⚙ Options" and log "?" buttons open their modals.
//   8. No uncaught errors / error-level console messages anywhere.
//
// Run via:  node scripts/run-smoke.js   (sets up env + electron)
// Output:   JSON report between SMOKE_BEGIN/SMOKE_END, then PASS/FAIL.

const path = require('path');
const fs = require('fs');
const os = require('os');

const APP_ROOT = path.resolve(__dirname, '..');
// Backend latency so the BatchGen runner (which polls state.generating)
// behaves like it would against the real, slow mmx backend.
const DELAY = Number(process.env.SMOKE_DELAY_MS) || 250;

// ---- isolated temp config dir (never touch the user's real config) ----
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mmx-smoke-'));
const OUT = path.join(TMP, 'out');
fs.mkdirSync(OUT, { recursive: true });
process.env.MINIMAX_CONFIG_DIR = TMP;
fs.writeFileSync(path.join(TMP, 'config.txt'),
  `api_key=sk-smoke-test-key-0000000000\noutput_dir=${OUT}\nregion=global\ntheme=dark\n`, 'utf8');

const { app, BrowserWindow, ipcMain } = require('electron');
try { require(path.join(APP_ROOT, 'main', 'window', 'windowSecurity')); } catch (_) {}

const consoleMsgs = [];
const mainErrors = [];

// ---- fake mmx backend: writes a real output file + returns ok:true ----
function findOutPath(args) {
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === '--out' || args[i] === '--download' || args[i] === '-o') return args[i + 1];
  }
  for (const a of args) if (typeof a === 'string' && a.toLowerCase().startsWith(OUT.toLowerCase())) return a;
  return null;
}
function registerFakeMmx() {
  ipcMain.handle('mmx:run', async (_e, args) => {
    args = Array.isArray(args) ? args : [];
    if (DELAY) await new Promise((r) => setTimeout(r, DELAY));
    const outFile = findOutPath(args);
    if (outFile) {
      // IMPORTANT: do NOT create the parent directory — the real mmx
      // does not. This makes the test actually verify that ensureSubDir
      // created the per-tab output folder. If it didn't, the write fails
      // with ENOENT and we return a failure, exactly like the real mmx
      // (this is the regression guard for the drive-root mkdir bug).
      try { fs.writeFileSync(outFile, Buffer.from([0, 1, 2, 3])); }
      catch (e) { return { ok: false, code: 1, stdout: '', stderr: 'ENOENT (smoke): ' + e.message, parsed: null, command: 'mmx', argv: args }; }
    }
    return { ok: true, code: 0, stdout: 'smoke ok', stderr: '', parsed: { smoke: true }, command: 'mmx', argv: args };
  });
  ipcMain.handle('mmx:voices', async () => []);
  ipcMain.handle('mmx:quota', async () => ({ ok: false, error: 'smoke-stub' }));
  ipcMain.handle('mmx:cancel', () => ({ ok: true }));
  ipcMain.handle('mmx:authStatus', async () => ({ ok: false, error: 'smoke-stub' }));
  ipcMain.handle('mmx:diagnose', async () => ({ platform: process.platform, smoke: true }));
}

const REGISTRARS = ['registerAppIpc', 'registerConfigIpc', 'registerUpscaleIpc', 'registerIsnetbgIpc',
  'registerImageIpc', 'registerAudioIpc', 'registerFileBrowserIpc', 'registerBatchesIpc',
  'registerStateIpc', 'registerInstallIpc', 'registerFilePickerIpc'];

let win = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exec = (js) => win.webContents.executeJavaScript(js);

const problems = [];
function check(cond, label) { if (!cond) problems.push(label); return !!cond; }

async function run() {
  registerFakeMmx();
  for (const r of REGISTRARS) {
    try { require(path.join(APP_ROOT, 'main', 'ipc', r)).register({ appRoot: APP_ROOT, getMainWindow: () => win }); }
    catch (e) { mainErrors.push(`registrar ${r} failed: ${e && e.stack || e}`); }
  }

  win = new BrowserWindow({ width: 1400, height: 900, show: false, webPreferences: {
    preload: path.join(APP_ROOT, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false } });
  win.webContents.on('console-message', (_e, level, message, line, sourceId) =>
    consoleMsgs.push({ level, message, source: sourceId ? path.basename(String(sourceId)) : '', line }));
  win.webContents.on('render-process-gone', (_e, d) => mainErrors.push('render-process-gone ' + JSON.stringify(d)));
  win.webContents.on('preload-error', (_e, p, err) => mainErrors.push('preload-error ' + (err && err.stack || err)));

  await win.loadFile(path.join(APP_ROOT, 'renderer', 'index.html'));
  await exec(`window.__smoke = { errors: [] };
    addEventListener('error', (e) => window.__smoke.errors.push('error: ' + ((e.error && e.error.stack) || e.message)));
    addEventListener('unhandledrejection', (e) => window.__smoke.errors.push('rejection: ' + ((e.reason && e.reason.stack) || e.reason)));
    // Auto-confirm so a pre-generation warning dialog can never block the
    // headless run (the validator's correctness is covered by unit tests).
    window.confirm = () => true; true;`);

  // 1) init completes
  let inited = false;
  for (let i = 0; i < 80; i++) {
    if (await exec(`!!(document.querySelector('#tab-image') && document.querySelector('#tab-image').children.length > 0)`).catch(() => false)) { inited = true; break; }
    await sleep(250);
  }
  check(inited, 'init() did not complete (image tab never built)');

  // dismiss startup popups so they don't sit over later interactions
  await exec(`for (let i=0;i<6;i++) document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); true;`);
  await sleep(150);

  // 2) critical globals
  const CRIT = ['ensureSubDir','slugify','timestamp','uniquePath','formatMmxError','classifyMmxError','bumpGenerationCounter',
    'armGenBtnWithCancel','applyFileSearch','showModal','showTab','refreshBrowser','buildParamRow','buildStyleRow',
    'validateTabAgainstSpec','appendFlag','escapeHtml','buildFinalPrompt','showAudioPreview','showVideoPreview',
    'notifyImageGenerated','openAllBatchDashboard','openFolderOptions','showHelp','showAudioCutter','startBatchGen','openBatchManager'];
  const globals = await exec(`(() => { const o={}; for (const n of ${JSON.stringify(CRIT)}) { try { o[n]=typeof window[n]; } catch(e){ o[n]='throw'; } } return o; })()`);
  for (const n of CRIT) check(globals[n] === 'function', `global ${n} is not a function (got ${globals[n]})`);

  // 3) generate on every tab
  const tabs = {};
  for (const key of ['image', 'speech', 'music', 'video']) {
    const res = { built: false, clicked: false, generating: null, toasts: '', errors: [] };
    res.built = await exec(`(() => { try { showTab('${key}'); } catch(e){} const p=document.querySelector('#tab-${key}'); return !!(p && p.children.length>0); })()`);
    await exec(`(() => { window.__smoke.errors=[]; if (typeof state!=='undefined') state.generating=null;
      const p=document.querySelector('#tab-${key}'); if(p) for (const ta of p.querySelectorAll('textarea')) { ta.value='smoke ${key}'; ta.dispatchEvent(new Event('input',{bubbles:true})); } return true; })()`);
    res.clicked = await exec(`(() => { const p=document.querySelector('#tab-${key}'); const b=[...p.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='Generate'); if(!b) return false; b.click(); return true; })()`);
    await sleep(DELAY + 900);
    const after = await exec(`(() => ({ generating: (typeof state!=='undefined'? state.generating : null), errors: window.__smoke.errors||[], toasts: (document.querySelector('#toast-root')||{textContent:''}).textContent }))()`);
    res.generating = after.generating; res.errors = after.errors; res.toasts = (after.toasts || '').replace(/\s+/g, ' ').trim();
    tabs[key] = res;
    check(res.built, `tab ${key} did not build`);
    check(res.clicked, `tab ${key} Generate button not found`);
    check(res.errors.length === 0, `tab ${key} threw on generate: ${JSON.stringify(res.errors).slice(0, 300)}`);
    check(/generated/i.test(res.toasts), `tab ${key} did not report success (toast: ${res.toasts.slice(-120)})`);
    check(res.generating == null, `tab ${key} left state.generating set (stuck button)`);
  }

  // 4) batch auto-remove drains the queue
  const batch = await exec(`(async () => {
    window.__smoke.errors=[];
    state.batchesAutoRemove = true;
    state.batches.image = ['ba','bb','bc'];
    await window.api.batchesSet(state.batches);
    _refreshBatchButtons();
    await startBatchGen('image');
    return { remaining: (state.batches.image||[]).length, errors: window.__smoke.errors };
  })()`);
  check(batch.remaining === 0, `batch auto-remove failed: ${batch.remaining} items left (expected 0)`);
  check((batch.errors || []).length === 0, `batch threw: ${JSON.stringify(batch.errors).slice(0, 200)}`);

  // 5) asset-type filter
  const filter = await exec(`(async () => {
    const out = state.config.output_dir; const b64 = btoa('x');
    for (const f of ['ta.png','tb.mp3']) await window.api.fbWrite(out + '\\\\' + f, b64);
    state.fbDir = out; await refreshBrowser(); await new Promise(r=>setTimeout(r,200));
    const tf = document.querySelector('#fb-type-filter'); tf.value='png,jpg,jpeg,webp,gif,bmp'; tf.dispatchEvent(new Event('change'));
    await new Promise(r=>setTimeout(r,150));
    const items=[...document.querySelectorAll('#fb-list .fb-item')].filter(li=>li.dataset.name);
    const shown=items.filter(li=>li.style.display!=='none').map(li=>li.dataset.name);
    tf.value=''; tf.dispatchEvent(new Event('change'));
    return { shown };
  })()`);
  check(filter.shown.includes('ta.png') && !filter.shown.includes('tb.mp3'),
    `type filter broken (images filter showed: ${JSON.stringify(filter.shown)})`);

  // 6) audio cutter open + probe + export
  const audio = await exec(`(async () => {
    function wav(sec, sr){ const n=Math.floor(sec*sr), dl=n*2, buf=new ArrayBuffer(44+dl), dv=new DataView(buf);
      const ws=(o,s)=>{for(let i=0;i<s.length;i++)dv.setUint8(o+i,s.charCodeAt(i));};
      ws(0,'RIFF');dv.setUint32(4,36+dl,true);ws(8,'WAVE');ws(12,'fmt ');dv.setUint32(16,16,true);dv.setUint16(20,1,true);
      dv.setUint16(22,1,true);dv.setUint32(24,sr,true);dv.setUint32(28,sr*2,true);dv.setUint16(32,2,true);dv.setUint16(34,16,true);
      ws(36,'data');dv.setUint32(40,dl,true);
      for(let i=0;i<n;i++)dv.setInt16(44+i*2,Math.round(Math.sin(2*Math.PI*440*i/sr)*30000),true);
      let bin='';const b=new Uint8Array(buf);for(let i=0;i<b.length;i++)bin+=String.fromCharCode(b[i]);return btoa(bin); }
    const out = state.config.output_dir; const src = out + '\\\\sm_tone.wav';
    await window.api.fbWrite(src, wav(2.0, 8000));
    const mr = document.querySelector('#modal-root'); mr.innerHTML=''; mr.classList.remove('active');
    window.showAudioCutter(src); await new Promise(r=>setTimeout(r,1200));
    const m = mr.querySelector('.audio-cutter-modal'); if (!m) return { opened:false };
    const inps = m.querySelectorAll('.ac-time-inp');
    inps[0].value='0:00.500'; inps[0].dispatchEvent(new Event('change'));
    inps[1].value='0:01.500'; inps[1].dispatchEvent(new Event('change'));
    m.querySelector('.ac-name-inp').value='sm_tone_cut.wav';
    [...m.querySelectorAll('button')].find(b=>/Export/.test(b.textContent)).click();
    await new Promise(r=>setTimeout(r,2500));
    const exists = await window.api.fbExists(out + '\\\\sm_tone_cut.wav');
    const pr = await window.api.audioProbe(out + '\\\\sm_tone_cut.wav');
    return { opened:true, exists, dur: pr && pr.duration };
  })()`);
  check(audio.opened, 'audio cutter modal did not open');
  check(audio.exists, 'audio cutter did not produce a trimmed file');
  check(audio.dur && Math.abs(audio.dur - 1.0) < 0.2, `audio cutter trim duration wrong (${audio.dur}, expected ~1.0)`);

  // 7) dead-control modals
  const ctrls = await exec(`(async () => {
    const mr = document.querySelector('#modal-root');
    mr.innerHTML=''; mr.classList.remove('active');
    document.querySelector('#fb-options').click(); await new Promise(r=>setTimeout(r,150));
    const opt = !!mr.querySelector('.folder-options-modal') || [...mr.querySelectorAll('h2')].some(h=>/Folder options/.test(h.textContent));
    mr.innerHTML=''; mr.classList.remove('active');
    document.querySelector('#log-help').click(); await new Promise(r=>setTimeout(r,150));
    const help = mr.children.length > 0;
    mr.innerHTML=''; mr.classList.remove('active');
    return { opt, help };
  })()`);
  check(ctrls.opt, 'fb-options button did not open the Folder options modal');
  check(ctrls.help, 'log-help button did not open the help modal');

  // 8) no uncaught / error-console anywhere
  const consoleErrors = consoleMsgs.filter((m) => /uncaught|referenceerror|typeerror|is not defined|is not a function|cannot read|syntaxerror/i.test(m.message));
  check(consoleErrors.length === 0, `console errors: ${JSON.stringify(consoleErrors).slice(0, 400)}`);
  check(mainErrors.length === 0, `main-process errors: ${JSON.stringify(mainErrors).slice(0, 400)}`);

  const result = { inited, globals, tabs, batch, filter, audio, ctrls, consoleErrors, mainErrors, problems };
  process.stdout.write('\nSMOKE_BEGIN\n' + JSON.stringify(result, null, 2) + '\nSMOKE_END\n');
  process.stdout.write(problems.length ? `\nSMOKE_FAIL (${problems.length}):\n - ${problems.join('\n - ')}\n` : '\nSMOKE_PASS\n');
}

let exitCode = 0;
app.whenReady().then(async () => {
  const killer = setTimeout(() => { process.stdout.write('\nSMOKE_TIMEOUT\n'); app.exit(2); }, 90000);
  try {
    await run();
    exitCode = problems.length ? 1 : 0;
  } catch (e) {
    process.stdout.write('\nSMOKE_FATAL\n' + (e && e.stack || e) + '\n');
    exitCode = 1;
  } finally {
    clearTimeout(killer);
    try { if (win) win.destroy(); } catch (_) {}
    // app.exit(code) force-exits with the given code immediately. We do
    // NOT call app.quit() first — it races this and the process would
    // exit 0 before app.exit(exitCode) runs, masking a SMOKE_FAIL.
    app.exit(exitCode);
  }
});
