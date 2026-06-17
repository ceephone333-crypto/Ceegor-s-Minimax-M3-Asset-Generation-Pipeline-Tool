// src/config.js
// Read/write config.txt that lives next to the executable (or in dev: next to package.json).
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function configDir() {
  // 1) Env override (lets the launcher.bat force a specific dir)
  if (process.env.MINIMAX_CONFIG_DIR) return process.env.MINIMAX_CONFIG_DIR;
  // 2) Packaged .exe: the directory holding MiniMaxAssetsTool.exe
  try {
    return path.dirname(app.getPath('exe'));
  } catch { /* fall through */ }
  // 3) Launcher / dev: the working directory (where start.bat or `electron .` was run from)
  return process.cwd();
}

function configPath() {
  return path.join(configDir(), 'config.txt');
}

function defaultConfig() {
  return {
    api_key: '',
    output_dir: '',
    region: 'global',
    theme: 'dark',
    styles: [],          // [{ name, value }]
    raw: '',
  };
}

function parse(text) {
  const out = defaultConfig();
  out.raw = text || '';
  if (!text) return out;
  let inStyles = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { inStyles = false; continue; }
    if (line.startsWith('#') || line.startsWith(';')) continue;
    if (/^\[\s*styles\s*\]$/i.test(line)) { inStyles = true; continue; }
    if (/^\[.+\]$/.test(line)) { inStyles = false; continue; }
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    if (inStyles) {
      // style entry: name = value
      if (k && v) out.styles.push({ name: k, value: v });
      continue;
    }
    if (k === 'api_key') out.api_key = v;
    else if (k === 'output_dir') out.output_dir = v;
    else if (k === 'region') out.region = v || 'global';
    else if (k === 'theme') out.theme = (v === 'light' ? 'light' : 'dark');
  }
  return out;
}

function serialize(cfg) {
  const styles = Array.isArray(cfg.styles) ? cfg.styles : [];
  const lines = [
    '# MiniMax Assets Tool configuration',
    '# Put your MiniMax API key on the line below, save as config.txt next to the .exe.',
    '# Both Token Plan keys (sk-cp-…) and pay-as-you-go keys are accepted.',
    '',
    `api_key=${cfg.api_key || ''}`,
    '',
    '# Default output directory for generated assets (created if missing).',
    '# Leave blank to use ./generated/ next to the executable.',
    `output_dir=${cfg.output_dir || ''}`,
    '',
    '# Region: global (default) or cn',
    `region=${cfg.region || 'global'}`,
    '',
    '# Theme: dark (default) or light',
    `theme=${cfg.theme === 'light' ? 'light' : 'dark'}`,
    '',
    '# ---------- Style presets ----------',
    '# Each line: <name> = <prompt prefix to prepend>',
    '# Used in every tab to prepend a style to your manual prompt.',
    '# Manage via the gear icon → "Style Settings".',
    '',
  ];
  if (styles.length) {
    lines.push('[styles]');
    for (const s of styles) {
      // escape '=' inside value to avoid parse ambiguity
      const safeName = String(s.name || '').replace(/[\r\n]+/g, ' ').slice(0, 80);
      const safeVal = String(s.value || '').replace(/[\r\n]+/g, ' ').slice(0, 2000);
      lines.push(`${safeName} = ${safeVal}`);
    }
    lines.push('');
  } else {
    lines.push('# [styles]');
    lines.push('# (no styles yet — open the app, click ⚙ → "Style Settings" to add some)');
    lines.push('');
  }
  return lines.join('\n');
}

function read() {
  const p = configPath();
  if (!fs.existsSync(p)) return defaultConfig();
  try {
    return parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    // Don't silently lose the user's API key when parse fails — back the
    // file up so a human (or a future write) can recover it. The next
    // successful write overwrites the backup.
    try {
      const backup = p + '.corrupt-' + Date.now();
      fs.copyFileSync(p, backup);
      // eslint-disable-next-line no-console
      console.error('[config] parse failed, backed up to', backup, e);
    } catch { /* backup may fail (read-only fs), continue with default */ }
    return defaultConfig();
  }
}

function write(cfg) {
  const p = configPath();
  // Atomic write: write to a temp file in the same directory then rename.
  // If the process is killed mid-write the original is untouched.
  const tmp = p + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, serialize(cfg), 'utf8');
  try {
    fs.renameSync(tmp, p);
  } catch (e) {
    // Best-effort cleanup of the temp file on rename failure
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  }
}

function effectiveOutputDir(cfg) {
  if (cfg.output_dir && cfg.output_dir.trim()) return cfg.output_dir.trim();
  return path.join(configDir(), 'generated');
}

module.exports = { configPath, read, write, effectiveOutputDir, defaultConfig, parse, serialize };
