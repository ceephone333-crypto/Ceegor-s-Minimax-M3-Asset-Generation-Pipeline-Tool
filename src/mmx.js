// src/mmx.js
// Thin wrapper around the `mmx` CLI. Parses --output json, streams stderr to the renderer.
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const AGENT_FLAGS = ['--non-interactive'];

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
      onLog?.(msg);
      onChunk?.({ line: msg, jobId: jobId || null, kind: 'stderr' });
      resolveP({ ok: false, code: -1, stdout: '', stderr: r.error || 'mmx unavailable', parsed: null });
      return;
    }
    // Defensive: the renderer always passes an array, but a future caller
    // (or a corrupted IPC payload) might not. Bail out cleanly instead of
    // throwing a cryptic "args is not iterable" from the spread below.
    if (!Array.isArray(args)) {
      resolveP({ ok: false, code: -1, stdout: '', stderr: 'mmx: args must be an array', parsed: null });
      return;
    }
    const fullArgs = [
      ...r.prefix,
      ...args,
      '--output', 'json',
      ...AGENT_FLAGS,
    ];
    if (apiKey) fullArgs.push('--api-key', apiKey);

    // Log the command line, but redact the API key — otherwise the user
    // accidentally leaks their key when they click "Copy log" to share an
    // error with support. The match handles both `--api-key <value>` and
    // the quoted form `--api-key "<value>"`.
    const cmdLine = `$ ${r.command} ${fullArgs.map(quote).join(' ')}`
      .replace(/--api-key(?:\s+(?:"[^"]*"|'[^']*'|\S+))?/, '--api-key ***');
    onLog?.(cmdLine);
    onChunk?.({ line: cmdLine, jobId: jobId || null, kind: 'stderr' });

    let stdout = '';
    let stderr = '';
    let lastStdoutTrim = '';
    let proc;
    try {
      // Use a whitelisted env instead of the full process.env — see
      // buildChildEnv for the rationale.
      proc = spawn(r.command, fullArgs, { cwd, windowsHide: true, env: buildChildEnv() });
      // Phase A: track every active proc in a Set. The legacy
      // currentGenProc slot is now a Set so cancelOne(proc) can kill
      // a specific in-flight generation while leaving sibling procs
      // (e.g. a parallel quota check) alone. cancelAll() still works
      // as the "panic" button.
      currentGenProcs.add(proc);
    } catch (err) {
      resolveP({ ok: false, code: -1, stdout: '', stderr: String(err), parsed: null });
      return;
    }

    proc.stdout.on('data', (b) => {
      const s = b.toString('utf8');
      stdout += s;
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
          onLog?.(trimmed);
          onChunk?.({ line: trimmed, jobId: jobId || null, kind: 'stdout' });
        }
      }
    });
    proc.stderr.on('data', (b) => {
      const s = b.toString('utf8');
      stderr += s;
      // filter the noisy PowerShell wrapping
      const trimmed = s.replace(/^node\.exe\s*:\s*/gm, '').trimEnd();
      if (trimmed) {
        onLog?.(trimmed);
        onChunk?.({ line: trimmed, jobId: jobId || null, kind: 'stderr' });
      }
    });
    proc.on('error', (err) => {
      // `error` fires when the process can't be spawned (ENOENT etc.) and
      // is usually followed by `close`. Resolve here in case `close` never
      // fires, and clear the proc slot so a later cancelAll() doesn't
      // try to kill a non-existent process.
      currentGenProcs.delete(proc);
      resolveP({ ok: false, code: -1, stdout, stderr: stderr + '\n' + String(err), parsed: null });
    });
    proc.on('close', (code) => {
      currentGenProcs.delete(proc);
      const parsed = tryParseAll(stdout);
      const ok = code === 0;
      if (!ok && !parsed) {
        const exitLine = `[mmx] exit code ${code}`;
        onLog?.(exitLine);
        onChunk?.({ line: exitLine, jobId: jobId || null, kind: 'stderr' });
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
function getActiveProcs() {
  return Array.from(currentGenProcs);
}
function cancelOne(proc) {
  if (!proc) return false;
  if (!currentGenProcs.has(proc)) return false;
  try { proc.kill('SIGTERM'); } catch {}
  return true;
}
function cancelAll() {
  for (const p of currentGenProcs) {
    try { p.kill('SIGTERM'); } catch {}
  }
  currentGenProcs.clear();
}

module.exports = { runMmx, resolve, cancelAll, cancelOne, getActiveProcs };
