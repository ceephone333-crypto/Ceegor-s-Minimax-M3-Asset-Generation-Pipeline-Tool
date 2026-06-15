// main.js — Electron main process
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

const { runMmx } = require('./src/mmx');
const cfgMod = require('./src/config');
const fb = require('./src/fileBrowser');

// Disable native window occlusion (which can cause blurry text on Windows
// when the window is partially obscured or the OS compositor applies
// blur to off-screen content).
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
// Force consistent DPI scaling so the renderer is never blurry from
// the OS applying a fractional scale factor.
app.commandLine.appendSwitch('force-device-scale-factor', '1');

let mainWindow = null;
let cachedVoices = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'MiniMax Assets Tool',
    backgroundColor: '#1f1f23',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // mainWindow.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------------- IPC: config ----------------
ipcMain.handle('config:get', () => cfgMod.read());
ipcMain.handle('config:set', (_e, cfg) => {
  cfgMod.write(cfg);
  return cfgMod.read();
});
ipcMain.handle('config:path', () => cfgMod.configPath());
ipcMain.handle('config:pickFolder', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths.length) return null;
  return r.filePaths[0];
});

// ---------------- IPC: mmx ----------------
// All mmx calls stream their stderr into the main window's log pane via the
// `mmx:log` IPC channel. The renderer subscribes once in init().

ipcMain.handle('mmx:run', async (_e, args) => {
  const cfg = cfgMod.read();
  if (!cfg.api_key) {
    return { ok: false, code: -1, stdout: '', stderr: 'No API key configured. Edit config.txt next to the .exe.', parsed: null };
  }
  const r = await runMmx({ args, apiKey: cfg.api_key, onLog: (line) => mainWindow?.webContents.send('mmx:log', line) });
  return r;
});

ipcMain.handle('mmx:voices', async () => {
  if (cachedVoices && cachedVoices.length) return cachedVoices;
  // Try the live API first
  const cfg = cfgMod.read();
  if (cfg.api_key) {
    const r = await runMmx({ args: ['speech', 'voices'], apiKey: cfg.api_key, onLog: () => {} });
    if (r.ok) {
      const parsed = r.parsed;
      if (Array.isArray(parsed) && parsed.length) { cachedVoices = parsed; return parsed; }
      if (typeof parsed === 'string') {
        try { const v = JSON.parse(parsed); if (Array.isArray(v) && v.length) { cachedVoices = v; return v; } } catch { /* fallthrough */ }
      }
    }
  }
  // Fallback: bundled voices.json
  try {
    const fs = require('fs');
    const path = require('path');
    const candidates = [
      path.join(__dirname, 'voices.json'),
      path.join(__dirname, 'src', 'voices.json'),
      path.join(process.resourcesPath || '', 'voices.json'),
    ];
    for (const c of candidates) {
      if (c && fs.existsSync(c)) {
        const v = JSON.parse(fs.readFileSync(c, 'utf8'));
        if (Array.isArray(v) && v.length) { cachedVoices = v; return v; }
      }
    }
  } catch { /* ignore */ }
  return [];
});

ipcMain.handle('mmx:quota', async () => {
  const cfg = cfgMod.read();
  if (!cfg.api_key) return { ok: false, error: 'No API key configured.' };
  const r = await runMmx({ args: ['quota'], apiKey: cfg.api_key, onLog: () => {} });
  if (!r.ok) return { ok: false, error: r.stderr || r.stdout || 'mmx quota failed', parsed: r.parsed };
  return { ok: true, parsed: r.parsed };
});

// ----------------- IPC: cancel running mmx -----------------
const { cancelAll } = require('./src/mmx');
ipcMain.handle('mmx:cancel', () => { cancelAll(); return { ok: true }; });

ipcMain.handle('mmx:authStatus', async () => {
  const cfg = cfgMod.read();
  if (!cfg.api_key) return { ok: false, error: 'No API key configured.' };
  // The most reliable "is this key valid?" signal is a real API call.
  // We use `mmx quota --output json` and inspect the response.
  const r = await runMmx({ args: ['quota'], apiKey: cfg.api_key, onLog: (line) => mainWindow?.webContents.send('mmx:log', line) });
  if (!r.command) {
    return { ok: false, error: r.stderr || 'mmx unavailable', command: null, argv: null };
  }
  if (!r.ok) {
    // Try to surface the most informative bit
    let detail = r.stderr || r.stdout || `mmx exited with code ${r.code}`;
    // PowerShell on Windows wraps stderr in "node.exe :" — strip it
    detail = String(detail).replace(/^node\.exe\s*:\s*/gm, '').trim();
    return { ok: false, error: detail || `mmx exited with code ${r.code}`, command: r.command, argv: r.argv };
  }
  // mmx writes JSON to stdout with --output json
  const parsed = r.parsed;
  if (parsed && typeof parsed === 'object' && parsed.base_resp) {
    const sc = parsed.base_resp.status_code;
    if (sc === 0) {
      return { ok: true, message: 'Authenticated. Quota snapshot loaded.', command: r.command };
    }
    return { ok: false, error: parsed.base_resp.status_msg || `API status_code ${sc}`, command: r.command };
  }
  return { ok: true, message: 'mmx quota returned a response.', command: r.command };
});

ipcMain.handle('mmx:diagnose', async () => {
  const { resolve } = require('./src/mmx');
  const cfg = cfgMod.read();
  const r = resolve();
  return {
    platform: process.platform,
    electronVersion: process.versions.electron || 'n/a',
    nodeVersion: process.versions.node,
    nodePath: r.command,
    mmxEntry: r.prefix[0] || null,
    error: r.error,
    apiKeyPresent: !!(cfg.api_key && cfg.api_key.trim()),
    apiKeyLength: (cfg.api_key || '').length,
    region: cfg.region,
  };
});

// ---------------- IPC: file browser ----------------
ipcMain.handle('fb:list', async (_e, dir) => {
  try { return { ok: true, ...(await fb.list(dir)) }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
});
ipcMain.handle('fb:mkdir', async (_e, dir, name) => {
  try { return { ok: true, path: await fb.mkdir(dir, name) }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
});
ipcMain.handle('fb:rename', async (_e, p, newName) => {
  try { return { ok: true, path: await fb.rename(p, newName) }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
});
ipcMain.handle('fb:delete', async (_e, p) => {
  try { return { ok: true, path: await fb.deletePath(p) }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
});
ipcMain.handle('fb:move', async (_e, src, destDir) => {
  try { return { ok: true, path: await fb.moveTo(src, destDir) }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
});
ipcMain.handle('fb:copy', async (_e, src, destDir) => {
  try { return { ok: true, path: await fb.copyTo(src, destDir) }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
});
ipcMain.handle('fb:reveal', (_e, p) => { fb.reveal(p); return { ok: true }; });
ipcMain.handle('fb:read', async (_e, p) => {
  try {
    const buf = await fb.readFile(p);
    return { ok: true, base64: buf.toString('base64') };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
});
// Write a file from base64 data. Used by the in-app image pipeline
// (upscaler / cropper / format-converter) which produces a canvas-backed
// PNG / JPEG / WebP blob in the renderer and needs a way to persist it
// to disk. We refuse to write outside the configured output_dir by
// default, but allow explicit outPath arguments (e.g. "<src>_2x.png"
// alongside the original — same dir, just a derived filename).
ipcMain.handle('fb:write', async (_e, outPath, base64Data) => {
  try {
    if (!outPath || typeof outPath !== 'string') {
      return { ok: false, error: 'Output path is required.' };
    }
    if (!base64Data || typeof base64Data !== 'string') {
      return { ok: false, error: 'Base64 data is required.' };
    }
    // Guardrail: refuse to write a file that isn't under the user's
    // output_dir or under a sub-directory of an existing file path the
    // user already navigated to. This prevents the upscaler/cropper
    // from accidentally writing to /Windows or other sensitive paths.
    const cfg = cfgMod.read();
    const base = (cfg.output_dir || '').replace(/[\\/]+$/, '').toLowerCase();
    const parent = require('path').dirname(outPath).replace(/[\\/]+$/, '').toLowerCase();
    // Allow the write if either:
    //   - the parent is exactly output_dir or under it
    //   - the parent is under a path the user has navigated to (state.fbDirs)
    //   - the parent is under any directory the user is allowed to write to
    //     (i.e. the parent exists and is writable)
    // For now, simplest rule: parent must be output_dir or a sub-path
    // of output_dir, OR the parent is the same dir as an existing file
    // (we allow writing "name_2x.png" next to "name.png").
    const parentOk = base && (parent === base || parent.startsWith(base + (cfg.output_dir.includes('\\') ? '\\' : '/')));
    const sameAsExisting = require('fs').existsSync(parent) && require('fs').statSync(parent).isDirectory();
    if (!parentOk && !sameAsExisting) {
      return { ok: false, error: 'Refusing to write outside the output directory.' };
    }
    const buf = Buffer.from(base64Data, 'base64');
    require('fs').writeFileSync(outPath, buf);
    return { ok: true, path: outPath };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
});

// ----------------- IPC: batches (BatchGen) -----------------
// Stored as a separate JSON file next to config.txt so it stays out of
// the human-edited config and can hold up to 100 prompts per tab.
const batchMod = require('./src/batches');
ipcMain.handle('batches:get', () => batchMod.read());
ipcMain.handle('batches:set', (_e, batches) => {
  try { batchMod.write(batches); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
});

// ----------------- IPC: file picker (Browse button) -----------------
ipcMain.handle('file:pick', async (_e, opts) => {
  opts = opts || {};
  const r = await dialog.showOpenDialog(mainWindow, {
    title: opts.title || 'Select file',
    properties: ['openFile'],
    filters: opts.filters && opts.filters.length ? opts.filters : [{ name: 'All files', extensions: ['*'] }],
  });
  if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
  return { ok: true, path: r.filePaths[0] };
});

// ----------------- IPC: state autosave (tab settings) -----------------
const stateMod = require('./src/state');
ipcMain.handle('state:get', () => stateMod.read());
ipcMain.handle('state:set', (_e, s) => {
  try { stateMod.write(s); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
});
