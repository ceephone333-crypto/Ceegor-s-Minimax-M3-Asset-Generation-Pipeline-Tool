// main/ipc/registerMmxIpc.js
// IPC-Handler: `mmx:run` / `mmx:run:job` / `mmx:voices` / `mmx:quota` /
// `mmx:profile` / `mmx:cancel` / `mmx:authStatus` / `mmx:diagnose`.
// Subcommands durch main/models/MmxSubcommandAllowlist.js geprüft.

const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const { runMmx, cancelAll, resolve, cancelOne } = require('../../src/mmx');
const cfgMod = require('../../src/config');
const { ALLOWED_MMX_SUBCOMMANDS } = require('../models/MmxSubcommandAllowlist');
const voicesCache = require('../services/VoicesCacheService');

/**
 * @param {{ getMainWindow: () => (Electron.BrowserWindow|null), appRoot: string }} deps
 */
function register({ getMainWindow, appRoot }) {
  // Streamt mmx-Logs in den Log-Pane des Renderers. Phase A: the wire
  // format is now { line, jobId, kind }. The preload bridge (preload.js)
  // wraps the legacy string payload so older renderer builds still work
  // — see preload.js onLogRich.
  const sendLog = (line, jobId, kind) => {
    const win = getMainWindow();
    if (win) {
      try { win.webContents.send('mmx:log', { line, jobId: jobId || null, kind: kind || 'stderr' }); } catch (_) {}
    }
  };

  // Legacy: `mmx:run` still takes the raw args array (no jobId). Used
  // by the Diagnose / voices cache paths which don't need job tracking.
  ipcMain.handle('mmx:run', async (_e, args) => {
    try {
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
      return await runMmx({ args, apiKey: cfg.api_key, onLog: sendLog });
    } catch (e) {
      return { ok: false, code: -1, stdout: '', stderr: `IPC error: ${e.message}`, parsed: null };
    }
  });

  // Phase A: `mmx:run:job` is the new multi-job-aware handler. The
  // payload is `{ args, jobId, cwd? }` — the runMmx child process
  // attaches every emitted chunk to the jobId so the renderer's
  // LogService routes the line into the right primary log row.
  ipcMain.handle('mmx:run:job', async (_e, payload) => {
    try {
      const args = payload && payload.args;
      const jobId = payload && payload.jobId;
      const cwd = payload && payload.cwd;
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
      return await runMmx({
        args,
        apiKey: cfg.api_key,
        cwd: cwd || undefined,
        onLog: (line) => sendLog(line, jobId, 'stderr'),
        onChunk: (p) => sendLog(p.line, p.jobId, p.kind),
        jobId: jobId || null,
      });
    } catch (e) {
      return { ok: false, code: -1, stdout: '', stderr: `IPC error: ${e.message}`, parsed: null };
    }
  });

  ipcMain.handle('mmx:voices', async () => {
    try {
      const cfg = cfgMod.read();
      return await voicesCache.get(cfg.api_key || '');
    } catch (e) {
      return [];
    }
  });

  ipcMain.handle('mmx:quota', async () => {
    try {
      const cfg = cfgMod.read();
      if (!cfg.api_key) return { ok: false, error: 'No API key configured.' };
      const r = await runMmx({ args: ['quota'], apiKey: cfg.api_key, onLog: () => {} });
      if (!r.ok) return { ok: false, error: r.stderr || r.stdout || 'mmx quota failed', parsed: r.parsed };
      return { ok: true, parsed: r.parsed };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Phase B: mmx:profile returns a lightweight, 5-minute-cached
  // profile derived from the quota response. The Diagnose modal uses
  // it to show a "your plan allows N concurrent calls" hint. If the
  // upstream does not expose an explicit concurrentLimit we return
  // { ok: true, concurrentLimit: null } so the renderer can show a
  // neutral "parallel is enabled; upstream may throttle" message.
  const PROFILE_TTL_MS = 5 * 60 * 1000;
  let _profileCache = null;
  ipcMain.handle('mmx:profile', async () => {
    try {
      if (_profileCache && (Date.now() - _profileCache.ts) < PROFILE_TTL_MS) {
        return _profileCache.payload;
      }
      const cfg = cfgMod.read();
      if (!cfg.api_key) return { ok: false, error: 'No API key configured.', concurrentLimit: null };
      const r = await runMmx({ args: ['quota'], apiKey: cfg.api_key, onLog: () => {} });
      const payload = parseProfile(r);
      _profileCache = { ts: Date.now(), payload };
      return payload;
    } catch (e) {
      return { ok: false, error: e.message, concurrentLimit: null };
    }
  });
  function parseProfile(r) {
    const out = { ok: true, concurrentLimit: null, planType: null };
    if (!r || !r.ok) {
      out.ok = false;
      out.error = (r && (r.stderr || r.stdout)) || 'mmx quota failed';
      return out;
    }
    const p = r.parsed;
    if (!p) return out;
    // Heuristic: look for known concurrency / plan fields across the
    // possible response shapes. We do NOT invent numbers; if the
    // upstream doesn't expose them, we return null so the renderer
    // shows a neutral message.
    const obj = (typeof p === 'object' && !Array.isArray(p)) ? p : null;
    if (!obj) return out;
    const candidates = ['concurrent_limit', 'concurrentLimit', 'max_concurrency', 'maxConcurrency', 'concurrency'];
    for (const k of candidates) {
      if (typeof obj[k] === 'number' && obj[k] > 0 && obj[k] < 1000) {
        out.concurrentLimit = obj[k];
        break;
      }
    }
    const planCandidates = ['plan_type', 'planType', 'plan', 'tier'];
    for (const k of planCandidates) {
      if (typeof obj[k] === 'string' && obj[k]) {
        out.planType = obj[k];
        break;
      }
    }
    return out;
  }

  ipcMain.handle('mmx:cancel', (_e, opts) => {
    try {
      // Phase A: `mmx:cancel` accepts either no payload (panic, kill
      // everything) or `{ jobId }` (Phase B+ per-job cancel). For
      // Phase A we always treat no-payload as the panic path because
      // the per-proc cancel needs the actual proc reference, which
      // the renderer doesn't have. The renderer-side JobRunner.cancel
      // already calls cancelAll() and the per-tab UI is still
      // responsive (per-tab gate), so this is a safe default.
      if (opts && opts.jobId) {
        // Phase A: kill all in-flight procs. (Per-proc targeting
        // requires the renderer to pass the proc ref, which the
        // preload bridge doesn't expose. The panic behaviour is
        // acceptable for Phase A because the JobRunner tracks the
        // tab key and stops polling; the next user click on a
        // different tab re-enables that tab's Generate button.)
        cancelAll();
        return { ok: true };
      }
      cancelAll();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('mmx:authStatus', async () => {
    try {
      const cfg = cfgMod.read();
      if (!cfg.api_key) return { ok: false, error: 'No API key configured.' };
      // The most reliable "is this key valid?" signal is a real API call.
      // We use `mmx quota --output json` and inspect the response.
      const r = await runMmx({ args: ['quota'], apiKey: cfg.api_key, onLog: sendLog });
      if (!r.command) {
        return { ok: false, error: r.stderr || 'mmx unavailable', command: null, argv: null };
      }
      if (!r.ok) {
        let detail = r.stderr || r.stdout || `mmx exited with code ${r.code}`;
        // PowerShell on Windows wraps stderr in "node.exe :" — strip it
        detail = String(detail).replace(/^node\.exe\s*:\s*/gm, '').trim();
        return { ok: false, error: detail || `mmx exited with code ${r.code}`, command: r.command, argv: r.argv };
      }
      const parsed = r.parsed;
      if (parsed && typeof parsed === 'object' && parsed.base_resp) {
        const sc = parsed.base_resp.status_code;
        if (sc === 0) {
          return { ok: true, message: 'Authenticated. Quota snapshot loaded.', command: r.command };
        }
        return { ok: false, error: parsed.base_resp.status_msg || `API status_code ${sc}`, command: r.command };
      }
      return { ok: true, message: 'mmx quota returned a response.', command: r.command };
    } catch (e) {
      return { ok: false, error: e.message, command: null, argv: null };
    }
  });

  ipcMain.handle('mmx:diagnose', async () => {
    try {
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
    } catch (e) {
      return { error: e.message };
    }
  });

  // Sanity-check: appRoot wird in dieser Version nicht aktiv benutzt
  // (Logs gehen direkt an die Main-Window), bleibt aber im DI-Vertrag
  // für künftige Log-File-Persistierung.
  void appRoot;
}

module.exports = { register };
