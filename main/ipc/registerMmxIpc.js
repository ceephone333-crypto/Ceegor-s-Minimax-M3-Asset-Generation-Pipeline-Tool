// main/ipc/registerMmxIpc.js
// IPC-Handler: `mmx:run` / `mmx:run:job` / `mmx:voices` / `mmx:quota` /
// `mmx:profile` / `mmx:cancel` / `mmx:authStatus` / `mmx:diagnose`.
// Subcommands durch main/models/MmxSubcommandAllowlist.js geprüft.

const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const { runMmx, cancelAll, resolve, cancelOne, cancelByJobId } = require('../../src/mmx');
const cfgMod = require('../../src/config');
const { ALLOWED_MMX_SUBCOMMANDS } = require('../models/MmxSubcommandAllowlist');
const voicesCache = require('../services/VoicesCacheService');
const pathSecurity = require('../services/PathSecurityService');

// bug-fix S1 (_temp4.md): every other path-taking IPC handler (fb:*,
// image:*, upscale:*, isnetbg:*, audio:*) validates its path arguments
// against PathSecurityService's allow-list — mmx:run / mmx:run:job were
// the one gap, passing the renderer's `args` straight through to the
// spawned mmx process unchecked. A compromised/buggy renderer could
// otherwise make mmx write a generated media file to an arbitrary
// filesystem location the process can write to. `--out`/`--download`
// name a FILE (so we check the parent dir, which may not exist yet);
// `--out-dir` names a DIRECTORY mmx writes directly into (so we check
// the directory itself — it must already exist, created by the
// renderer's ensureSubDir before mmx is ever invoked).
const MMX_FILE_PATH_FLAGS = new Set(['--out', '--download', '-o']);
const MMX_DIR_PATH_FLAGS = new Set(['--out-dir']);
function findInvalidMmxPath(args) {
  // v1.1 (audit M13): support both `--flag value` (two tokens) and
  // `--flag=value` (one token) forms. The pre-v1.1 validator only
  // matched the exact-token form, so `--out=C:\\evil` was invisible
  // to the check. We split each arg on `=` first, then walk the
  // resulting flag tokens. Same whitelist applies to both forms.
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (typeof a !== 'string') continue;
    // `--flag=value` form: split and validate the value inline.
    const eq = a.indexOf('=');
    if (eq > 0) {
      const flag = a.slice(0, eq);
      const value = a.slice(eq + 1);
      if (!value) continue;
      if (MMX_FILE_PATH_FLAGS.has(flag) && !pathSecurity.isParentUnderAny(value)) {
        return `mmx: "${flag}" path "${value}" is outside the allowed directories.`;
      }
      if (MMX_DIR_PATH_FLAGS.has(flag) && !pathSecurity.isPathUnderAny(value)) {
        return `mmx: "${flag}" path "${value}" is outside the allowed directories.`;
      }
      continue;
    }
    // `--flag value` form: peek at the next token. v1.1
    // (audit BUG-R2-05): if the next token is a value (not a
    // flag) AND the current flag takes a path arg, we MUST
    // skip the value token. Otherwise the next loop iteration
    // treats it as a new flag, and if it happens to start
    // with `--` (e.g. `--out` as a literal value), the path
    // validator below would reject it as an unknown flag
    // and the whole mmx call would be blocked. We track
    // `valueConsumed` so the for-loop's `i++` advances past
    // the value (or we manually advance below).
    if (i >= args.length - 1) continue;
    const value = args[i + 1];
    if (typeof value !== 'string' || !value) continue;
    let valueConsumed = false;
    if (MMX_FILE_PATH_FLAGS.has(a) && !pathSecurity.isParentUnderAny(value)) {
      return `mmx: "${a}" path "${value}" is outside the allowed directories.`;
    }
    if (MMX_DIR_PATH_FLAGS.has(a) && !pathSecurity.isPathUnderAny(value)) {
      return `mmx: "${a}" path "${value}" is outside the allowed directories.`;
    }
    if (MMX_FILE_PATH_FLAGS.has(a) || MMX_DIR_PATH_FLAGS.has(a)) {
      // The current flag accepts a value, AND the next token
      // doesn't start with '-' (it would be a flag, not a
      // value, in mmx-cli convention). Consume it.
      if (!value.startsWith('-')) valueConsumed = true;
    }
    if (valueConsumed) i++;
  }
  return null;
}
/**
 * v1.1 (audit M13): validate the optional `cwd` payload field. The
 * pre-v1.1 handler forwarded `payload.cwd` straight to spawn() with
 * no path-safety check — a compromised renderer could set cwd to an
 * arbitrary directory and influence the spawned child's relative
 * path resolution. We refuse anything outside the allow-list.
 */
function validateMmxCwd(cwd) {
  if (!cwd || typeof cwd !== 'string') return null;
  if (!pathSecurity.isPathUnderAny(cwd)) {
    return `mmx: cwd "${cwd}" is outside the allowed directories.`;
  }
  return null;
}

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
      const pathErr = findInvalidMmxPath(args);
      if (pathErr) {
        return { ok: false, code: -1, stdout: '', stderr: pathErr, parsed: null };
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
      const pathErr = findInvalidMmxPath(args);
      if (pathErr) {
        return { ok: false, code: -1, stdout: '', stderr: pathErr, parsed: null };
      }
      // v1.1 (audit M13): validate cwd before forwarding it to spawn().
      const cwdErr = validateMmxCwd(cwd);
      if (cwdErr) {
        return { ok: false, code: -1, stdout: '', stderr: cwdErr, parsed: null };
      }
      const cfg = cfgMod.read();
      if (!cfg.api_key) {
        return { ok: false, code: -1, stdout: '', stderr: 'No API key configured. Edit config.txt next to the .exe.', parsed: null };
      }
      return await runMmx({
        args,
        apiKey: cfg.api_key,
        cwd: cwd || undefined,
        // BUG-9-07 fix (user-reported, 2026-06-25): pass ONLY
        // `onChunk` here, not `onLog` + `onChunk`. The previous
        // version passed BOTH, and src/mmx.js's runMmx() calls
        // BOTH callbacks with the SAME line for every mmx
        // stdout/stderr chunk (and for the synthetic $ ... command
        // line, and the [exit code N] line). Both callbacks routed
        // to the same `sendLog` IPC channel, which sent one
        // `mmx:log` event per call. The renderer's `onLogRich`
        // callback therefore received the same line TWICE, called
        // `attachSecondaryToJob(jobId, line)` twice, and appended
        // TWO identical rows to the log pane. The user saw
        // every mmx line duplicated (e.g. the [Model: image-01]
        // line, the $ node mmx.mjs ... command echo, and the
        // {"saved": "..."} final-result line all appeared twice).
        // `onChunk` is the new structured callback and is the
        // one the renderer consumes; `onLog` is the legacy
        // string-only callback kept for backwards-compat. With
        // the renderer now on the structured path (and gated on
        // `onLogRich`), the legacy `onLog` callback is dead —
        // passing it would only re-introduce the duplicate. The
        // legacy `mmx:run` (line 130) still uses `onLog` for
        // older callers.
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
      // v1.1 (audit BUG-R2-02): only cache SUCCESSFUL responses.
      // Caching the error envelope would mean a single transient
      // failure (network blip, auth hiccup, 5xx from upstream)
      // left the user staring at "quota failed" for the next 5
      // minutes with no way to retry. The renderer can re-trigger
      // a fresh fetch by calling mmx:profile again — we just
      // don't short-circuit on a stale error.
      if (payload && payload.ok === true) {
        _profileCache = { ts: Date.now(), payload };
      } else {
        // Invalidate any stale cache so a previously-good
        // response doesn't outlive a fresh error. (If the
        // previous fetch was OK and the next is not, the
        // renderer's "concurrent limit" hint is still better
        // than nothing for the 5 minutes, but we lean toward
        // honesty: surface the error immediately.)
        _profileCache = null;
      }
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
      // `mmx:cancel` accepts either no payload (panic, kill
      // everything) or `{ jobId }` (per-job cancel).
      // bug-fix H4/Phase1 (_temp4.md): the per-proc cancel needed the
      // renderer to pass a jobId AND main to track jobId->proc
      // (src/mmx.js#cancelByJobId) — both now exist, so a job-scoped
      // cancel kills only that job's proc, leaving sibling jobs on
      // other tabs (or parallel batch items) running. An unrecognized
      // jobId (already finished, or started via the legacy mmxRun
      // with no jobId) is a harmless no-op rather than falling back
      // to killing everything.
      if (opts && opts.jobId) {
        cancelByJobId(opts.jobId);
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
        // v1.1 (audit BUG-R2-06): the previous version leaked
        // `apiKeyLength` — the exact char count of the user's
        // API key. Even though the full key isn't disclosed, the
        // length is information that aids brute-forcing
        // (narrowing the search space by an order of magnitude).
        // A boolean `apiKeyPresent` is sufficient for the
        // Diagnose modal's UI: it shows "API key configured" or
        // "no API key set", no length needed.
        // apiKeyLength: (cfg.api_key || '').length,  // <-- removed
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
