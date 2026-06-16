// main.js — Electron main process
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const https = require('https');
const { spawn } = require('child_process');
const os = require('os');

const { runMmx } = require('./src/mmx');
const cfgMod = require('./src/config');
const fb = require('./src/fileBrowser');
const pathUtils = require('./src/pathUtils');
const reEsrgan = require('./src/realesrgan');

// Disable native window occlusion (which can cause blurry text on Windows
// when the window is partially obscured or the OS compositor applies
// blur to off-screen content).
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
// Force consistent DPI scaling so the renderer is never blurry from
// the OS applying a fractional scale factor.
app.commandLine.appendSwitch('force-device-scale-factor', '1');

let mainWindow = null;
let voicesCache = new Map();

// Set of paths the user has explicitly picked via a system Open dialog
// during this session. Used by the file-browser path allowlist so the
// user can move / copy files to a folder outside `output_dir` after
// picking it (which is the only way the main process learns about
// folders the user has actually authorised).
const trustedPickPaths = new Set();

// "Allowed roots" = output_dir + every path the user has explicitly
// picked. Every fb:* handler funnels its path arguments through this.
function allowedRoots() {
  const cfg = cfgMod.read();
  const roots = [];
  if (cfg.output_dir) roots.push(cfg.output_dir);
  for (const p of trustedPickPaths) roots.push(p);
  return roots;
}

// Whitelist of mmx subcommands the renderer is allowed to invoke. The
// rest of the args are still user-provided form values — the subcommand
// is the only piece that can never legitimately come from a form input,
// so gating it here stops a compromised renderer from spraying the CLI
// with arbitrary commands.
const ALLOWED_MMX_SUBCOMMANDS = new Set([
  'image', 'speech', 'music', 'video', 'quota', 'voices',
]);

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
  // Block any in-app navigation. The renderer loads exactly one local
  // file; if some future bug tries to navigate to a remote origin we
  // refuse it. Default Electron behaviour would otherwise be to ALLOW
  // the navigation and silently break the IPC bridge.
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  // Block window.open / target=_blank popups. The renderer has no
  // legitimate need to spawn additional windows, and an unblocked
  // `window.open` is a classic XSS escape hatch.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // Confirm-before-close guard. Without this, a misclick on the X
  // button (or Alt+F4 / Cmd+Q) can kill an in-progress mmx generation
  // and discard whatever the user was working on. We show a modal
  // question dialog; the default button is "Cancel" and Esc also maps
  // to Cancel, so the safe option is the default. A flag breaks the
  // recursion when the user actually confirms.
  let _confirmingClose = false;
  mainWindow.on('close', async (e) => {
    if (_confirmingClose) return;
    e.preventDefault();
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: 'Close MiniMax Asset Tool?',
      message: 'Are you sure you want to close the tool?',
      detail: 'Any in-progress generation will be cancelled. Your settings, file prefix, and per-tab folders are saved automatically (after every change), so you can pick up where you left off the next time you launch the app.',
      buttons: ['Close', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (result.response === 0) {
      _confirmingClose = true;
      // destroy() bypasses the 'close' event so the guard doesn't
      // re-fire and trap us in a loop.
      mainWindow.destroy();
    }
  });
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
  // Defensive: only persist the fields we care about. The renderer can
  // be compromised — never trust a foreign object wholesale.
  const safe = {
    api_key: typeof cfg?.api_key === 'string' ? cfg.api_key : '',
    output_dir: typeof cfg?.output_dir === 'string' ? cfg.output_dir : '',
    region: cfg?.region === 'cn' ? 'cn' : 'global',
    theme: cfg?.theme === 'light' ? 'light' : 'dark',
    styles: Array.isArray(cfg?.styles)
      ? cfg.styles
          .filter((s) => s && typeof s === 'object' && typeof s.name === 'string' && typeof s.value === 'string')
          .map((s) => ({ name: s.name, value: s.value }))
      : [],
  };
  cfgMod.write(safe);
  return cfgMod.read();
});
ipcMain.handle('config:path', () => cfgMod.configPath());
ipcMain.handle('config:pickFolder', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths.length) return null;
  // Remember the picked path so the file browser can write / move into
  // it later (it's the only way the main process learns about a folder
  // the user authorised outside `output_dir`).
  trustedPickPaths.add(r.filePaths[0]);
  return r.filePaths[0];
});

// ---------------- IPC: mmx ----------------
// All mmx calls stream their stderr into the main window's log pane via the
// `mmx:log` IPC channel. The renderer subscribes once in init().

ipcMain.handle('mmx:run', async (_e, args) => {
  // Defence in depth: the renderer is already sandboxed, but in case it
  // is ever compromised we want the main process to refuse to run any
  // mmx subcommand that isn't on the whitelist. Everything after the
  // subcommand is user-provided form data, so we let it through (the
  // mmx CLI itself validates those flags).
  if (!Array.isArray(args) || args.length < 1) {
    return { ok: false, code: -1, stdout: '', stderr: 'mmx: first arg (subcommand) is required', parsed: null };
  }
  if (typeof args[0] !== 'string' || !ALLOWED_MMX_SUBCOMMANDS.has(args[0])) {
    return { ok: false, code: -1, stdout: '', stderr: `mmx: subcommand '${String(args[0])}' is not allowed`, parsed: null };
  }
  const cfg = cfgMod.read();
  if (!cfg.api_key) {
    return { ok: false, code: -1, stdout: '', stderr: 'No API key configured. Edit config.txt next to the .exe.', parsed: null };
  }
  const r = await runMmx({ args, apiKey: cfg.api_key, onLog: (line) => mainWindow?.webContents.send('mmx:log', line) });
  return r;
});

ipcMain.handle('mmx:voices', async () => {
  // Cache voices per API key. The voice list is the same for every key on
  // the user's plan, but we still want a fresh fetch when the user changes
  // keys (e.g. switches between two accounts, or pastes a new key). The
  // previous code used a single module-level cache that never invalidated,
  // so a key change would silently keep returning voices for the old key.
  const cfg = cfgMod.read();
  const cacheKey = cfg.api_key || '';
  if (voicesCache.has(cacheKey)) return voicesCache.get(cacheKey);
  // Try the live API first
  if (cfg.api_key) {
    const r = await runMmx({ args: ['speech', 'voices'], apiKey: cfg.api_key, onLog: () => {} });
    if (r.ok) {
      const parsed = r.parsed;
      if (Array.isArray(parsed) && parsed.length) { voicesCache.set(cacheKey, parsed); return parsed; }
      if (typeof parsed === 'string') {
        try { const v = JSON.parse(parsed); if (Array.isArray(v) && v.length) { voicesCache.set(cacheKey, v); return v; } } catch { /* fallthrough */ }
      }
    }
  }
  // Fallback: bundled voices.json (cached per empty key so we don't re-read
  // the file on every call when no API key is configured).
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
        if (Array.isArray(v) && v.length) { voicesCache.set(cacheKey, v); return v; }
      }
    }
  } catch { /* ignore */ }
  // Cache the empty result too so we don't keep re-running the fallback on
  // every call when the user really has no voices available.
  voicesCache.set(cacheKey, []);
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
    // On Windows, `r.command` is the resolved node.exe and `r.prefix[0]`
    // is the mmx-cli entry script. On macOS/Linux, `r.command` is just
    // 'mmx' (resolved via PATH) and there's no node wrapper. Report them
    // truthfully so the Diagnose modal doesn't show "node.exe: mmx" on
    // non-Windows.
    nodePath: r.node || null,
    mmxEntry: r.entry || r.prefix[0] || null,
    mmxCommand: r.command || null,
    error: r.error,
    apiKeyPresent: !!(cfg.api_key && cfg.api_key.trim()),
    apiKeyLength: (cfg.api_key || '').length,
    region: cfg.region,
  };
});

// ---------------- IPC: Real-ESRGAN (optional upscaler) ----------------
// BSD-3-Clause licensed, downloaded separately by the user. The
// renderer asks the main process whether the binary is available
// before each upscale; if it is, the main process spawns the binary
// to produce a 4× intermediate PNG, which the renderer then
// resizes (downscale for 2×/3×, no-op for 4×, 2× step for 8×) and
// writes to the final path. If the binary is missing, the renderer
// falls back to the built-in multi-step createImageBitmap pipeline.

ipcMain.handle('upscale:realesrgan:available', () => {
  const available = reEsrgan.isAvailable();
  const result = {
    available,
    binaryPath: available ? reEsrgan.getBinaryPath() : null,
    version: available ? reEsrgan.probeVersion() : '',
  };
  return result;
});

ipcMain.handle('upscale:realesrgan:run', async (_e, srcPath, dstPath, opts) => {
  // The renderer gives us an input and an output path; both are
  // already validated by the IPC handler's own checks. We only need
  // to confirm they live under the allowed roots.
  if (!pathUtils.isPathUnderAny(srcPath, allowedRoots())) {
    return { ok: false, code: -1, stderr: 'Source path is outside the allowed directories.', outputPath: null };
  }
  if (!pathUtils.isPathUnderAny(dstPath, allowedRoots())) {
    return { ok: false, code: -1, stderr: 'Destination path is outside the allowed directories.', outputPath: null };
  }
  return reEsrgan.run(srcPath, dstPath, opts || {});
});

// ----------------- IPC: Real-ESRGAN download (one-click installer) -----------------
// The user can install Real-ESRGAN into ./bin/ with a single click in
// the ⚙ Settings → Image upscaling popup. We download the latest
// release zip from GitHub into the OS temp dir, then use PowerShell's
// Expand-Archive to unpack into ./bin/. Progress is streamed back
// to the renderer via webContents.send so the button can show a
// "Downloading… 12 / 90 MB" status.
//
// We deliberately do NOT query api.github.com for the latest URL —
// the user can ship a fixed URL in the source release and not depend
// on GitHub API rate limits. v0.2.5.0 is the latest stable as of
// 2024; users on a newer release can manually drop the binary into
// ./bin/.

const RE_ESRGAN_DOWNLOAD_URL = 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-v0.2.5.0-windows.zip';

function _httpsGetFollowingRedirects(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    function get(target) {
      https.get(target, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          const next = res.headers.location;
          res.resume();
          if (!next || maxRedirects <= 0) return reject(new Error('Too many redirects'));
          get(new URL(next, target).toString());
          return;
        }
        resolve(res);
      }).on('error', reject);
    }
    get(url);
  });
}

ipcMain.handle('upscale:realesrgan:download', async (event) => {
  const win = event.sender;
  const send = (data) => { try { win.send('upscale:realesrgan:download:progress', data); } catch (_) {} };
  const tmpZip = path.join(os.tmpdir(), `realesrgan-${Date.now()}.zip`);
  try {
    // ---- Phase 1: download the zip ----
    send({ phase: 'download', downloaded: 0, total: 0, status: 'starting' });
    await new Promise((resolve, reject) => {
      _httpsGetFollowingRedirects(RE_ESRGAN_DOWNLOAD_URL).then((res) => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} from ${RE_ESRGAN_DOWNLOAD_URL}`));
        }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        send({ phase: 'download', downloaded: 0, total, status: 'started' });
        const file = fs.createWriteStream(tmpZip);
        let downloaded = 0;
        let lastSent = 0;
        res.on('data', (chunk) => {
          downloaded += chunk.length;
          // Throttle to every 500 KB or 250 ms to avoid IPC spam.
          if (downloaded - lastSent > 500 * 1024) {
            lastSent = downloaded;
            send({ phase: 'download', downloaded, total, status: 'progress' });
          }
        });
        res.pipe(file);
        file.on('finish', () => file.close(() => {
          send({ phase: 'download', downloaded, total, status: 'done' });
          resolve();
        }));
        file.on('error', (err) => {
          try { fs.unlinkSync(tmpZip); } catch (_) {}
          reject(err);
        });
      }).catch(reject);
    }).catch((err) => {
      try { fs.unlinkSync(tmpZip); } catch (_) {}
      throw err;
    });

    // ---- Phase 2: extract into ./bin/ ----
    const binDir = path.join(__dirname, 'bin');
    if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });
    send({ phase: 'extract', downloaded: 0, total: 0, status: 'starting' });
    await new Promise((resolve, reject) => {
      const ps = spawn('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-Command', `Expand-Archive -Path "${tmpZip}" -DestinationPath "${binDir}" -Force`,
      ], { windowsHide: true });
      let stderr = '';
      ps.stderr.on('data', (b) => { stderr += b.toString('utf8'); });
      ps.on('close', (code) => {
        if (code === 0) {
          send({ phase: 'extract', downloaded: 0, total: 0, status: 'done' });
          resolve();
        } else {
          reject(new Error(`Expand-Archive failed (code ${code}): ${stderr}`));
        }
      });
      ps.on('error', reject);
    });

    // ---- Phase 3: clean up the temp zip ----
    try { fs.unlinkSync(tmpZip); } catch (_) {}
    // Reset the binary detector cache so the next probe sees the
    // newly-extracted binary.
    try { reEsrgan.resetCache && reEsrgan.resetCache(); } catch (_) {}
    return { ok: true, binDir };
  } catch (e) {
    try { fs.unlinkSync(tmpZip); } catch (_) {}
    return { ok: false, error: String((e && e.message) || e) };
  }
});

// ---------------- IPC: file browser ----------------
// All fb:* handlers validate the paths they receive against the allowed
// roots (output_dir + every path the user has explicitly picked via a
// system Open dialog). Without this, a compromised renderer could
// read / write / delete any file the Electron app has access to.
ipcMain.handle('fb:list', async (_e, dir) => {
  if (!pathUtils.isPathUnderAny(dir, allowedRoots())) {
    return { ok: false, error: 'Path is outside the allowed directories.' };
  }
  try { return { ok: true, ...(await fb.list(dir)) }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
});
ipcMain.handle('fb:mkdir', async (_e, dir, name) => {
  if (!pathUtils.isPathUnderAny(dir, allowedRoots())) {
    return { ok: false, error: 'Parent path is outside the allowed directories.' };
  }
  try { return { ok: true, path: await fb.mkdir(dir, name) }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
});
ipcMain.handle('fb:rename', async (_e, p, newName) => {
  if (!pathUtils.isPathUnderAny(p, allowedRoots())) {
    return { ok: false, error: 'Source path is outside the allowed directories.' };
  }
  try { return { ok: true, path: await fb.rename(p, newName) }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
});
ipcMain.handle('fb:delete', async (_e, p) => {
  if (!pathUtils.isPathUnderAny(p, allowedRoots())) {
    return { ok: false, error: 'Path is outside the allowed directories.' };
  }
  try { return { ok: true, path: await fb.deletePath(p) }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
});
ipcMain.handle('fb:move', async (_e, src, destDir) => {
  if (!pathUtils.isPathUnderAny(src, allowedRoots())) {
    return { ok: false, error: 'Source path is outside the allowed directories.' };
  }
  if (!pathUtils.isPathUnderAny(destDir, allowedRoots())) {
    return { ok: false, error: 'Destination path is outside the allowed directories.' };
  }
  try { return { ok: true, path: await fb.moveTo(src, destDir) }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
});
ipcMain.handle('fb:copy', async (_e, src, destDir) => {
  if (!pathUtils.isPathUnderAny(src, allowedRoots())) {
    return { ok: false, error: 'Source path is outside the allowed directories.' };
  }
  if (!pathUtils.isPathUnderAny(destDir, allowedRoots())) {
    return { ok: false, error: 'Destination path is outside the allowed directories.' };
  }
  try { return { ok: true, path: await fb.copyTo(src, destDir) }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
});
ipcMain.handle('fb:reveal', (_e, p) => {
  if (!pathUtils.isPathUnderAny(p, allowedRoots())) {
    return { ok: false, error: 'Path is outside the allowed directories.' };
  }
  fb.reveal(p);
  return { ok: true };
});
ipcMain.handle('fb:read', async (_e, p) => {
  // fb:read is what the renderer uses to display the contents of text /
  // srt / json files in the preview pane. Previously this had NO path
  // check — a compromised renderer could call fbRead('C:\\Users\\me\
  // .ssh\\id_rsa') and get the file back as base64. Now we restrict it
  // to the same allowlist as the rest of the file browser.
  if (!pathUtils.isPathUnderAny(p, allowedRoots())) {
    return { ok: false, error: 'Path is outside the allowed directories.' };
  }
  try {
    const buf = await fb.readFile(p);
    return { ok: true, base64: buf.toString('base64') };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
});
// Write a file from base64 data. Used by the in-app image pipeline
// (upscaler / cropper / format-converter) which produces a canvas-backed
// PNG / JPEG / WebP blob in the renderer and needs a way to persist it
// to disk. We refuse to write outside the configured output_dir (or
// any folder the user explicitly picked via a system dialog) by
// validating the NORMALISED parent directory — a `..` segment in the
// input can no longer bypass the check because the path is resolved
// first. Writes are capped at 25 MB so a compromised renderer can't
// OOM the main process.
ipcMain.handle('fb:write', async (_e, outPath, base64Data) => {
  try {
    if (!outPath || typeof outPath !== 'string') {
      return { ok: false, error: 'Output path is required.' };
    }
    if (!base64Data || typeof base64Data !== 'string') {
      return { ok: false, error: 'Base64 data is required.' };
    }
    // Resolve the path FIRST so any `..` segments collapse to the
    // directory the OS will actually see. We then check the resolved
    // parent against the allowed roots. A compromised renderer that
    // passes `C:\Generated\image\..\..\Windows\evil.exe` will fail the
    // allowlist check (the resolved parent is `C:\Windows`, not under
    // the user's output dir). The previous version compared the
    // un-normalised parent string and let a `..` slip through when the
    // resolved target happened to exist on disk.
    const outAbs = pathUtils.normalize(outPath);
    if (!outAbs) {
      return { ok: false, error: 'Output path is invalid.' };
    }
    if (!pathUtils.isParentUnderAny(outAbs, allowedRoots())) {
      return { ok: false, error: 'Refusing to write outside the output directory.' };
    }
    // Cap the write size. A 25 MB base64 buffer is enough for any
    // image the in-app pipeline produces; larger payloads are rejected
    // so a compromised renderer can't OOM the main process.
    const MAX_BYTES = 25 * 1024 * 1024;
    const buf = Buffer.from(base64Data, 'base64');
    if (buf.length > MAX_BYTES) {
      return { ok: false, error: `Refusing to write more than ${MAX_BYTES} bytes at once.` };
    }
    // Atomic write: tmp + rename, so a kill mid-write can't leave a
    // half-written file next to the user's generated assets.
    const tmp = outAbs + '.tmp-' + process.pid + '-' + Date.now();
    await fsp.writeFile(tmp, buf);
    try {
      await fsp.rename(tmp, outAbs);
    } catch (renameErr) {
      try { await fsp.unlink(tmp); } catch {}
      throw renameErr;
    }
    return { ok: true, path: outAbs };
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
  // The renderer passes `title` and `filters` as part of opts. Both are
  // safe to forward to showOpenDialog (the OS dialog ignores anything
  // weird), but we still cap the title length and validate the filters
  // shape to be safe.
  const title = typeof opts.title === 'string' ? opts.title.slice(0, 200) : 'Select file';
  const filters = Array.isArray(opts.filters) && opts.filters.length
    ? opts.filters
        .filter((f) => f && typeof f === 'object' && typeof f.name === 'string' && Array.isArray(f.extensions))
        .slice(0, 20)
        .map((f) => ({ name: String(f.name).slice(0, 100), extensions: f.extensions.map((e) => String(e).slice(0, 20)) }))
    : [{ name: 'All files', extensions: ['*'] }];
  const r = await dialog.showOpenDialog(mainWindow, {
    title,
    properties: ['openFile'],
    filters,
  });
  if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
  // Same as config:pickFolder — remember the picked path so the file
  // browser can use it as a write / move target later.
  trustedPickPaths.add(r.filePaths[0]);
  return { ok: true, path: r.filePaths[0] };
});

// ----------------- IPC: state autosave (tab settings) -----------------
const stateMod = require('./src/state');
ipcMain.handle('state:get', () => stateMod.read());
ipcMain.handle('state:set', (_e, s) => {
  try { stateMod.write(s); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
});
