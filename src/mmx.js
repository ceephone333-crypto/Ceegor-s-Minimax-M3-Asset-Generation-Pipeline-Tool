// src/mmx.js
// Thin wrapper around the `mmx` CLI. Parses --output json, streams stderr to the renderer.
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const AGENT_FLAGS = ['--non-interactive'];

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

function runMmx({ args, apiKey, cwd, onLog }) {
  return new Promise((resolveP) => {
    const r = resolve();
    if (!r.command) {
      const msg = `[mmx] ${r.error}`;
      onLog?.(msg);
      resolveP({ ok: false, code: -1, stdout: '', stderr: r.error || 'mmx unavailable', parsed: null });
      return;
    }
    const fullArgs = [
      ...r.prefix,
      ...args,
      '--output', 'json',
      ...AGENT_FLAGS,
    ];
    if (apiKey) fullArgs.push('--api-key', apiKey);

    onLog?.(`$ ${r.command} ${fullArgs.map(quote).join(' ')}`);

    let stdout = '';
    let stderr = '';
    let lastStdoutTrim = '';
    let proc;
    try {
      proc = spawn(r.command, fullArgs, { cwd, windowsHide: true, env: process.env });
      activeProcs.add(proc);
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
        }
      }
    });
    proc.stderr.on('data', (b) => {
      const s = b.toString('utf8');
      stderr += s;
      // filter the noisy PowerShell wrapping
      const trimmed = s.replace(/^node\.exe\s*:\s*/gm, '').trimEnd();
      if (trimmed) onLog?.(trimmed);
    });
    proc.on('error', (err) => {
      // `error` fires when the process can't be spawned (ENOENT etc.) and
      // is usually followed by `close`. Resolve here in case `close` never
      // fires, and drop the entry from the active-proc set so a later
      // cancelAll() doesn't try to kill a non-existent process.
      activeProcs.delete(proc);
      resolveP({ ok: false, code: -1, stdout, stderr: stderr + '\n' + String(err), parsed: null });
    });
    proc.on('close', (code) => {
      activeProcs.delete(proc);
      const parsed = tryParseAll(stdout);
      const ok = code === 0;
      if (!ok && !parsed) {
        onLog?.(`[mmx] exit code ${code}`);
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

// Track active mmx processes so we can cancel them on demand
const activeProcs = new Set();
function cancelAll() {
  for (const proc of activeProcs) {
    try { proc.kill('SIGTERM'); } catch {}
  }
  activeProcs.clear();
}

module.exports = { runMmx, resolve, cancelAll };
