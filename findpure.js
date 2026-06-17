// Helper script: find top-level functions in app.js with 0 state/el usage.
const fs = require('fs');
const path = 'c:/Projects/Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool/renderer/app.js';
const s = fs.readFileSync(path, 'utf8');
const lines = s.split(/\r?\n/);
const funcs = [];
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^function ([a-zA-Z_]+)\(/);
  if (m) funcs.push({ name: m[1], line: i + 1, idx: i });
}
const candidates = [];
for (let i = 0; i < funcs.length; i++) {
  const f = funcs[i];
  let depth = 0; let end = -1;
  for (let j = f.idx; j < lines.length; j++) {
    for (const ch of lines[j]) {
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { end = j; break; } }
    }
    if (end !== -1) break;
  }
  if (end === -1) continue;
  let stateUsage = 0, elUsage = 0;
  const reState = new RegExp('[^a-zA-Z_]state\\.');
  const reEl = new RegExp('[^a-zA-Z_]el\\(');
  for (let j = f.idx; j <= end; j++) {
    if (reState.test(lines[j])) stateUsage++;
    if (reEl.test(lines[j])) elUsage++;
  }
  const len = end - f.idx + 1;
  candidates.push({ name: f.name, line: f.line, len, stateUsage, elUsage });
}
candidates.sort((a, b) => b.len - a.len);
console.log('Pure functions (0 state, 0 el), len >= 20:');
for (const c of candidates) {
  if (c.stateUsage === 0 && c.elUsage === 0 && c.len >= 20) {
    console.log('  L' + c.line.toString().padStart(5), c.name.padEnd(30), 'len=' + c.len);
  }
}
