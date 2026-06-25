// scripts/check-renderer-no-node-globals.js
//
// BUG-9-01 regression guard (_temp9.md). The renderer is a browser
// (contextIsolation:true, nodeIntegration:false). It does NOT have
// the following Node-only globals, and touching any of them throws
// `ReferenceError: <name> is not defined` at the first call site:
//
//   process        — the exact bug that broke #fb-up and the drives list
//   require()      — load-time throw (renderer/pathUtils.js, OBS-1)
//   __dirname      — node-only path info
//   __filename     — node-only path info
//   Buffer         — node-only binary buffer
//   global         — node-only process-level globals bag
//
// This script greps every .js file under renderer/ for those tokens
// and FAILS the build if any hit is found OUTSIDE a comment. The audit
// recommends a future agent never sees a `process.platform` (or
// similar) get reintroduced into a click handler without noticing.
//
// Run via:   node scripts/check-renderer-no-node-globals.js
// Exit 0     — no offending references
// Exit 1     — at least one hit (build fails loudly, with file:line)
//
// This is intentionally a standalone script (not part of scripts/lint.js)
// so it can be wired into pre-commit + CI in one step later without
// touching the linter's other rules.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RENDERER = path.join(ROOT, 'renderer');

// Forbidden tokens and a short explanation. Order matters only for the
// error message — the regex still tries them all in one pass.
const FORBIDDEN = [
  { token: 'process.',         label: 'process' },
  { token: 'require(',         label: 'require()' },
  { token: '__dirname',        label: '__dirname' },
  { token: '__filename',       label: '__filename' },
  { token: 'Buffer',           label: 'Buffer' },
  { token: 'global.',          label: 'global' },
];

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      yield* walk(full);
    } else if (entry.isFile() && full.endsWith('.js')) {
      yield full;
    }
  }
}

// Strip line + block comments so the grep only flags REAL code, not
// documentation that mentions the forbidden token. A token in a string
// literal is also legitimate (e.g. log messages naming the token), so
// we strip string literals too. The remaining text is what would
// actually execute.
function stripCommentsAndStrings(src) {
  let out = '';
  let i = 0;
  let mode = 'code'; // 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tq'
  while (i < src.length) {
    const c = src[i];
    const c2 = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && c2 === '/') { mode = 'line'; i += 2; continue; }
      if (c === '/' && c2 === '*') { mode = 'block'; i += 2; continue; }
      if (c === "'")  { mode = 'sq'; i++; continue; }
      if (c === '"')  { mode = 'dq'; i++; continue; }
      if (c === '`')  { mode = 'tq'; i++; continue; }
      out += c; i++;
    } else if (mode === 'line') {
      if (c === '\n') { mode = 'code'; out += '\n'; }
      i++;
    } else if (mode === 'block') {
      if (c === '*' && c2 === '/') { mode = 'code'; i += 2; continue; }
      if (c === '\n') out += '\n';
      i++;
    } else if (mode === 'sq') {
      if (c === '\\') { i += 2; continue; }
      if (c === "'")  { mode = 'code'; }
      if (c === '\n') out += '\n';
      i++;
    } else if (mode === 'dq') {
      if (c === '\\') { i += 2; continue; }
      if (c === '"')  { mode = 'code'; }
      if (c === '\n') out += '\n';
      i++;
    } else if (mode === 'tq') {
      if (c === '\\') { i += 2; continue; }
      if (c === '`')  { mode = 'code'; i++; continue; }
      if (c === '\n') out += '\n';
      i++;
    }
  }
  return out;
}

const hits = [];
for (const file of walk(RENDERER)) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const raw = fs.readFileSync(file, 'utf8');
  // Skip the renderer entry file's window-typed property declarations
  // (e.g. `window.api.process = ...` is also forbidden in real code,
  // but the script only catches real code uses of `process.`).
  const code = stripCommentsAndStrings(raw);
  for (const { token, label } of FORBIDDEN) {
    // Word-boundary on the LEFT only. The token's LAST char is
    // already disambiguating (a `process.` ends in `.`, a
    // `require(` ends in `(`, etc., and no normal identifier
    // ends in those), so we don't need a right-side boundary —
    // adding one would incorrectly reject the dangerous form
    // `process.platform` because `p` is an identifier char.
    const re = new RegExp('(^|[^A-Za-z0-9_$])' + token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'm');
    if (re.test(code)) {
      // Find the actual line number in the ORIGINAL file (so the
      // developer can jump to it in their editor). Walk the raw
      // file line-by-line and test the same regex against the
      // joined-and-stripped prefix — the first line that
      // contributes a hit gets reported.
      const rawLines = raw.split('\n');
      let lineNo = 0;
      for (let ln = 0; ln < rawLines.length; ln++) {
        const prefix = stripCommentsAndStrings(rawLines.slice(0, ln + 1).join('\n'));
        if (re.test(prefix)) {
          lineNo = ln + 1;
          break;
        }
      }
      hits.push({ rel, lineNo, label, token });
    }
  }
}

if (hits.length === 0) {
  console.log('OK — no Node-only globals (process / require / __dirname / __filename / Buffer / global) found in renderer/.');
  process.exit(0);
}

console.error('FAIL — Node-only globals found in renderer/ (the renderer is a browser and has none of these):');
for (const h of hits) {
  console.error(`  ${h.rel}:${h.lineNo}  →  ${h.label} (${h.token})`);
}
console.error('');
console.error('These would throw "ReferenceError: <name> is not defined" the instant the line ran in the live renderer.');
console.error('See _temp9.md BUG-9-01 for the exact failure pattern (the Up button + drives list were both dead because of this).');
console.error('Expose what you need via window.api.* (preload bridge), use a path-shape regex, or remove the call entirely.');
process.exit(1);
