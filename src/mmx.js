// src/mmx.js
// Thin wrapper around the `mmx` CLI. Parses --output json, streams stderr to the renderer.
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
// v1.1 (lint-size split): the stdout/stderr cap + truncation-marker
// logic was extracted to its own file so src/mmx.js stays under
// the 500-line HARD limit. See src/mmxStreamCaps.js for the
// rationale and the marker-emission contract.
const { MAX_STDOUT_BYTES, MAX_STDERR_BYTES, makeCappedAppender } = require('./mmxStreamCaps');

const AGENT_FLAGS = ['--non-interactive'];

// v1.1 (audit L14): pre-v1.1 passed the API key via `--api-key <value>`
// argv. On Windows, any local process can read every other process's
// argv via WMI, exposing the key for the entire call duration. mmx-cli
// resolves auth from its own ~/.mmx/config.json (verified via
// `mmx config show`) — so we sync the key INTO that file before each
// spawn and let mmx-cli read it directly. File exposure requires
// filesystem access (which already implies the attacker could read our
// config.txt), so this is a real narrowing of the exposure surface.
// The sync is best-effort: a failure falls back to the legacy
// --api-key argv path so the call still works on a locked-down user
// profile where ~/.mmx is unwritable.
// v1.1 (audit BUG-N4 + lint-size split): the API-key sync was
// extracted to src/mmxApiKeySync.js so this file stays under
// the 500-line HARD limit. The sync tracks the file's
// mtime+size so an external `mmx config set` is detected
// even when the in-memory hash matches. Note: the test
// harness clears both the mmx.js and mmxApiKeySync.js
// module caches in withMmxMocks so the latest `fs` mock
// is picked up — see tests/unit/audit360/v11ReleaseAudit_audit.js.
const { syncApiKeyToMmxCliConfig: _syncApiKeyToMmxCliConfig } = require('./mmxApiKeySync');

// Build a minimal env for the spawned mmx process. We deliberately do
// NOT pass `process.env` wholesale: that would leak every environment
// variable the parent shell set (AWS_*, GITHUB_TOKEN, SSH_AUTH_SOCK,
// MINIMAX_NODE_PATH and any other secrets the user has loaded) into the
// mmx child, which then forwards them to the network when it talks to
// the mmx API. The whitelist below keeps the child functional on
// Windows / macOS / Linux while making sure we don't accidentally pass
// anything that isn't strictly required to locate node + load the CLI.
function buildChildEnv() {
  const env = {};
  // PATH so node (when on POSIX) / mmx (when on Windows resolving the
  // shim) can find the executables they need.
  if (process.env.PATH) env.PATH = process.env.PATH;
  // Platform-specific home / profile so the child can find user
  // configs (npm global node_modules on Windows lives under APPDATA).
  if (process.platform === 'win32') {
    if (process.env.SYSTEMROOT) env.SYSTEMROOT = process.env.SYSTEMROOT;
    if (process.env.APPDATA) env.APPDATA = process.env.APPDATA;
    if (process.env.LOCALAPPDATA) env.LOCALAPPDATA = process.env.LOCALAPPDATA;
    if (process.env.USERPROFILE) env.USERPROFILE = process.env.USERPROFILE;
    if (process.env.TEMP) env.TEMP = process.env.TEMP;
    if (process.env.TMP) env.TMP = process.env.TMP;
    if (process.env.HOMEDRIVE) env.HOMEDRIVE = process.env.HOMEDRIVE;
    if (process.env.HOMEPATH) env.HOMEPATH = process.env.HOMEPATH;
    // PATHEXT so .cmd / .bat lookups work
    if (process.env.PATHEXT) env.PATHEXT = process.env.PATHEXT;
  } else {
    if (process.env.HOME) env.HOME = process.env.HOME;
    if (process.env.USER) env.USER = process.env.USER;
    if (process.env.LANG) env.LANG = process.env.LANG;
    if (process.env.LC_ALL) env.LC_ALL = process.env.LC_ALL;
    if (process.env.TMPDIR) env.TMPDIR = process.env.TMPDIR;
  }
  // Allow the user to opt-in to a custom node path (used by the
  // findNodeExe resolver) — but only that one explicit variable, not
  // every MINIMAX_* var.
  if (process.env.MINIMAX_NODE_PATH) env.MINIMAX_NODE_PATH = process.env.MINIMAX_NODE_PATH;
  // Node-specific: tell node where to find the mmx-cli module.
  if (process.env.NODE_PATH) env.NODE_PATH = process.env.NODE_PATH;
  return env;
}

// Cache the resolved mmx.mjs path + the node executable to use.
let resolved = null;

function isWindows() {
  return process.platform === 'win32';
}

function findNodeExe() {
  // Try common locations for a real node.exe.
  // We avoid process.execPath because in the Electron main process it points to
  // the Electron .exe (which only acts as node if ELECTRON_RUN_AS_NODE=1).
  const candidates = [];
  if (process.env.MINIMAX_NODE_PATH) candidates.push(process.env.MINIMAX_NODE_PATH);
  if (isWindows()) {
    // Look in standard install dirs + where npm puts things
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFiles86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    candidates.push(
      path.join(programFiles, 'nodejs', 'node.exe'),
      path.join(programFiles86, 'nodejs', 'node.exe'),
    );
    // PATH-based lookup
    try {
      const r = spawnSync('where', ['node'], { encoding: 'utf8', windowsHide: true });
      if (r.status === 0 && r.stdout) {
        for (const line of r.stdout.split(/\r?\n/)) {
          const t = line.trim();
          if (t && t.toLowerCase().endsWith('node.exe')) candidates.push(t);
        }
      }
    } catch { /* ignore */ }
  } else {
    try {
      const r = spawnSync('which', ['node'], { encoding: 'utf8' });
      if (r.status === 0 && r.stdout) candidates.push(r.stdout.trim());
    } catch { /* ignore */ }
  }
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  return null;
}

function findMmxEntry() {
  // Look for the mmx-cli install root on disk
  const roots = [];
  if (isWindows()) {
    const appdata = process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming');
    roots.push(path.join(appdata, 'npm', 'node_modules', 'mmx-cli'));
    // Bundled fallback: in-tree
    roots.push(path.join(__dirname, 'node_modules', 'mmx-cli'));
    roots.push(path.join(__dirname, '..', 'node_modules', 'mmx-cli'));
  } else {
    roots.push('/usr/lib/node_modules/mmx-cli', '/usr/local/lib/node_modules/mmx-cli');
    roots.push(path.join(__dirname, 'node_modules', 'mmx-cli'));
    roots.push(path.join(__dirname, '..', 'node_modules', 'mmx-cli'));
  }
  for (const r of roots) {
    const entry = path.join(r, 'dist', 'mmx.mjs');
    if (fs.existsSync(entry)) return entry;
  }
  return null;
}

// v1.1 (audit AUDIT-10): safeCall wraps a best-effort renderer
// callback so a throw (e.g. a buggy onLog in the LogService)
// cannot abort a long-running mmx job. Used for every onLog /
// onChunk call site. The IPC wrapper in registerMmxIpc.js already
// catches runMmx rejections, but that path was masking a real
// defect — a buggy renderer should not nuke the main process's
// view of a healthy job. safeCall also logs the throw to the
// main process console (without the user's input data) so a
// future crash is diagnosable.
function safeCall(cb, ...args) {
  if (typeof cb !== 'function') return;
  try {
    cb(...args);
  } catch (e) {
    try { console.error('[mmx] safeCall: callback threw:', e && (e.message || e)); } catch (_) { /* ignore */ }
  }
}

// v1.1 (audit BUG-R2-11): see src/mmxCwd.js for the rationale.
// We accept cwd only when it is one of:
//   (a) undefined / null (use the OS default — process.cwd())
//   (b) an absolute path
// Anything else is silently coerced to undefined. The full
// validation is in src/mmxCwd.js (extracted so src/mmx.js
// stays under the 500-line HARD limit).
const { safeCwd: _safeCwd } = require('./mmxCwd');

function resolve() {
  if (resolved) return resolved;
  if (!isWindows()) {
    resolved = { command: 'mmx', prefix: [], node: null };
    return resolved;
  }
  const node = findNodeExe();
  const entry = findMmxEntry();
  if (!node) {
    resolved = { command: null, prefix: [], node: null, entry, error: 'Could not find node.exe on PATH. Install Node.js 18+ so `mmx` can run.' };
    return resolved;
  }
  if (!entry) {
    resolved = { command: node, prefix: [], node, entry: null, error: 'Could not find mmx-cli installation. Run `npm install -g mmx-cli`.' };
    return resolved;
  }
  resolved = { command: node, prefix: [entry], node, entry, error: null };
  return resolved;
}

function runMmx({ args, apiKey, cwd, onLog, onChunk, jobId }) {
  return new Promise((resolveP) => {
    const r = resolve();
    if (!r.command) {
      const msg = `[mmx] ${r.error}`;
      safeCall(onLog, msg);
      safeCall(onChunk, { line: msg, jobId: jobId || null, kind: 'stderr' });
      // v1.1 (audit L16): include command/argv on the early-fail path.
      resolveP({ ok: false, code: -1, stdout: '', stderr: r.error || 'mmx unavailable', parsed: null, command: r.command || '', argv: [] });
      return;
    }
    // v1.1 (audit BUG-R2-11): see _safeCwd below for the rationale.
    const safeCwd = _safeCwd(cwd);
    // Defensive: the renderer always passes an array, but a future caller
    // (or a corrupted IPC payload) might not. Bail out cleanly instead of
    // throwing a cryptic "args is not iterable" from the spread below.
    if (!Array.isArray(args)) {
      resolveP({ ok: false, code: -1, stdout: '', stderr: 'mmx: args must be an array', parsed: null, command: r.command || '', argv: [] });
      return;
    }
    const fullArgs = [
      ...r.prefix,
      ...args,
      '--output', 'json',
      ...AGENT_FLAGS,
    ];
    // v1.1 (audit L14): route the API key through mmx-cli's own
    // ~/.mmx/config.json instead of --api-key argv. argv is
    // readable by any local process on Windows via WMI; the file
    // path is readable only via filesystem access (which already
    // implies the attacker could read our config.txt). When the
    // sync fails (e.g. ~/.mmx is read-only), we fall back to the
    // legacy --api-key argv so the call still works.
    let keySyncedToConfig = false;
    if (apiKey) keySyncedToConfig = _syncApiKeyToMmxCliConfig(apiKey);
    if (apiKey && !keySyncedToConfig) fullArgs.push('--api-key', apiKey);

    // Log the command line, but redact the API key — otherwise the user
    // accidentally leaks their key when they click "Copy log" to share an
    // error with support. The match handles both `--api-key <value>` and
    // the quoted form `--api-key "<value>"`.
    const cmdLine = `$ ${r.command} ${fullArgs.map(quote).join(' ')}`
      .replace(/--api-key(?:\s+(?:"[^"]*"|'[^']*'|\S+))?/, '--api-key ***');
    // v1.1 (audit AUDIT-10): wrap renderer callbacks in safeCall so
    // a buggy onLog / onChunk can't abort a 30-min mmx job. The
    // callbacks are best-effort by definition (UI notifications);
    // their failure must NOT propagate back to runMmx.
    safeCall(onLog, cmdLine);
    safeCall(onChunk, { line: cmdLine, jobId: jobId || null, kind: 'stderr' });

    let stdout = '';
    let stderr = '';
    let lastStdoutTrim = '';
    // v1.1 (lint-size split): the cap constants and the
    // _appendCapped closure now live in src/mmxStreamCaps.js.
    // We get a fresh appender per runMmx() call so the
    // truncation flag is per-job (a slow mmx child that fills
    // the cap does not affect the NEXT run's marker).
    const _appendCapped = makeCappedAppender();
    // v1.1 (audit H2): hard timeout so a hung mmx child cannot leave
    // the JobRunner row stuck on "running" forever. 30 min is the
    // generous ceiling — the longest legitimate job (a 6-second video
    // at the API's slowest) takes ~3 min; we leave a lot of headroom
    // for slow connections + retries. A timed-out proc is SIGKILLed
    // so even a child that catches SIGTERM is reaped.
    const TIMEOUT_MS = 30 * 60 * 1000;
    let killed = false;
    const killTimer = setTimeout(() => {
      killed = true;
      try { proc.kill(); } catch (_) {}
    // Windows: proc.kill uses TerminateProcess (no signal). POSIX:
    // SIGTERM by default. Give the child a 2s grace, then SIGKILL.
    setTimeout(() => { try { proc.kill('SIGKILL'); } catch (_) {} }, 2000).unref();
      const msg = `[mmx] timed out after ${Math.round(TIMEOUT_MS / 60000)} min and was killed.`;
      safeCall(onLog, msg);
      safeCall(onChunk, { line: msg, jobId: jobId || null, kind: 'stderr' });
      currentGenProcs.delete(proc);
      if (jobId) procsByJobId.delete(jobId);
      // v1.1 (audit L16): include command/argv so the diagnostic
      // surface matches the success path.
      resolveP({ ok: false, code: -1, stdout, stderr: stderr + '\n' + msg, parsed: null, command: r.command || '', argv: fullArgs });
    }, TIMEOUT_MS).unref();
    let proc;
    try {
      // Use a whitelisted env instead of the full process.env — see
      // buildChildEnv for the rationale.
      proc = spawn(r.command, fullArgs, { cwd: safeCwd, windowsHide: true, env: buildChildEnv() });
      // Phase A: track every active proc in a Set. The legacy
      // currentGenProc slot is now a Set so cancelOne(proc) can kill
      // a specific in-flight generation while leaving sibling procs
      // (e.g. a parallel quota check) alone. cancelAll() still works
      // as the "panic" button.
      currentGenProcs.add(proc);
      // bug-fix H4/Phase1 (_temp4.md): also index by jobId so
      // cancelByJobId (JobRunner.cancel -> mmx:cancel {jobId}) can
      // kill exactly this proc without touching sibling jobs.
      // v1.1 (audit L15): if a duplicate jobId arrives (rare — the
      // renderer's JobRunner hands out unique ids, but a corrupted
      // state or a hand-crafted IPC payload could collide), the
      // pre-v1.1 code silently overwrote the map entry, orphaning
      // the first proc — it kept running but cancelByJobId(jobId)
      // would now target the second proc. We kill the orphan
      // explicitly so it can't leak.
      if (jobId) {
        const priorProc = procsByJobId.get(jobId);
        if (priorProc && priorProc !== proc) {
          try { _killWithEscalation(priorProc); } catch (_) {}
          currentGenProcs.delete(priorProc);
        }
        procsByJobId.set(jobId, proc);
      }
    } catch (err) {
      clearTimeout(killTimer);
      // v1.1 (audit L16): include command/argv on every error path
      // so diagnostics degrade gracefully (the success path already
      // returns them). r.command is null when resolve() failed; the
      // empty string is a safer placeholder than undefined for the
      // IPC marshal.
      resolveP({ ok: false, code: -1, stdout: '', stderr: String(err), parsed: null, command: r.command || '', argv: fullArgs });
      return;
    }

    proc.stdout.on('data', (b) => {
      const s = b.toString('utf8');
      stdout = _appendCapped('stdout', stdout, s, MAX_STDOUT_BYTES);
      // Forward a trimmed view of stdout to the log so the user sees
      // multi-line JSON responses broken into readable chunks. Skip empty
      // chunks (common with TTY-style output) and skip the last chunk if
      // it duplicates what we already logged, to avoid noise.
      const trimmed = s.trim();
      if (trimmed && trimmed !== lastStdoutTrim) {
        lastStdoutTrim = trimmed;
        // Only log if it looks like JSON or contains an error keyword — we
        // don't want to spam the log with progress lines if mmx-cli ever
        // grows them.
        if (/^[\s]*[{[]/.test(trimmed) || /error|warning|failed/i.test(trimmed)) {
          safeCall(onLog, trimmed);
          safeCall(onChunk, { line: trimmed, jobId: jobId || null, kind: 'stdout' });
        }
      }
    });
    proc.stderr.on('data', (b) => {
      const s = b.toString('utf8');
      stderr = _appendCapped('stderr', stderr, s, MAX_STDERR_BYTES);
      // filter the noisy PowerShell wrapping
      const trimmed = s.replace(/^node\.exe\s*:\s*/gm, '').trimEnd();
      if (trimmed) {
        safeCall(onLog, trimmed);
        safeCall(onChunk, { line: trimmed, jobId: jobId || null, kind: 'stderr' });
      }
    });
    proc.on('error', (err) => {
      if (killed) return;
      clearTimeout(killTimer);
      // `error` fires when the process can't be spawned (ENOENT etc.) and
      // is usually followed by `close`. Resolve here in case `close` never
      // fires, and clear the proc slot so a later cancelAll() doesn't
      // try to kill a non-existent process.
      currentGenProcs.delete(proc);
      if (jobId) procsByJobId.delete(jobId);
      // v1.1 (audit L16): include command/argv on the error path.
      resolveP({ ok: false, code: -1, stdout, stderr: stderr + '\n' + String(err), parsed: null, command: r.command || '', argv: fullArgs });
    });
    proc.on('close', (code) => {
      if (killed) return;
      clearTimeout(killTimer);
      currentGenProcs.delete(proc);
      if (jobId) procsByJobId.delete(jobId);
      const parsed = tryParseAll(stdout);
      const ok = code === 0;
      if (!ok && !parsed) {
        const exitLine = `[mmx] exit code ${code}`;
        safeCall(onLog, exitLine);
        safeCall(onChunk, { line: exitLine, jobId: jobId || null, kind: 'stderr' });
      }
      resolveP({ ok, code, stdout, stderr, parsed, command: r.command, argv: fullArgs });
    });
  });
}

function tryParseAll(text) {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  try { return JSON.parse(trimmed); } catch (_) { /* fallthrough */ }
  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1) {
    const arr = [];
    for (const l of lines) {
      try { arr.push(JSON.parse(l)); } catch (_) { return trimmed; }
    }
    return arr;
  }
  return trimmed;
}

function quote(v) {
  if (v == null) return '""';
  const s = String(v);
  if (/[\s"']/.test(s)) return '"' + s.replace(/"/g, '\\"') + '"';
  return s;
}

// Track every active mmx proc so we can cancel individual jobs on
// demand. Phase A: the renderer runs multiple jobs in parallel (one
// per tab + secondary jobs for post-processing), so a single-slot
// `currentGenProc` no longer works. We track the whole Set and
// expose cancelOne(proc) / getActiveProcs() / cancelAll() helpers
// (see _plan3.md §4.3). cancelAll() remains as the "panic" button.
const currentGenProcs = new Set();
// bug-fix H4/Phase1 (_temp4.md): Map<jobId, proc> alongside the Set
// above, populated only when runMmx({..., jobId}) is given one. Lets
// JobRunner.cancel(jobId) kill exactly that job's proc instead of
// every in-flight generation (the previous mmx:cancel{jobId} payload
// was already half-specced but had no way to resolve jobId -> proc).
const procsByJobId = new Map();
function getActiveProcs() {
  return Array.from(currentGenProcs);
}
// v1.1 (audit L13): SIGKILL escalation. The pre-v1.1 cancel paths
// sent SIGTERM only. Windows is fine (proc.kill uses TerminateProcess
// which can't be caught), but on macOS/Linux a mmx child that catches
// SIGTERM survives. We send SIGTERM, then SIGKILL after 2s, mirroring
// the isnetbg timeout pattern.
function _killWithEscalation(proc) {
  try { proc.kill('SIGTERM'); } catch (_) {}
  setTimeout(() => {
    try {
      // Only escalate if the proc is still running. proc.killed is
      // true after a successful kill(); on Windows TerminateProcess
      // already reaped the proc so this is a no-op.
      if (!proc.killed) proc.kill('SIGKILL');
    } catch (_) {}
  }, 2000).unref();
}
function cancelOne(proc) {
  if (!proc) return false;
  if (!currentGenProcs.has(proc)) return false;
  _killWithEscalation(proc);
  return true;
}
function cancelByJobId(jobId) {
  if (!jobId) return false;
  const proc = procsByJobId.get(jobId);
  if (!proc) return false;
  return cancelOne(proc);
}
function cancelAll() {
  for (const p of currentGenProcs) {
    _killWithEscalation(p);
  }
  currentGenProcs.clear();
  procsByJobId.clear();
}

module.exports = { runMmx, resolve, cancelAll, cancelOne, cancelByJobId, getActiveProcs };
