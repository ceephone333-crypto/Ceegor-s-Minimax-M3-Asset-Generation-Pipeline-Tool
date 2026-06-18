// Find unbalanced braces (not just functions)
const fs = require('fs');
const vm = require('vm');
const lines = fs.readFileSync('renderer/app.js', 'utf8');

// Find object literals: e.g. `foo = {` or `bar({\n` etc.
const starts = [];
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  // Look for top-level object assignments (single '=' or ':')
  if (/^\s*(const|let|var)\s+\w+\s*=\s*\{/.test(l) || /^\s*window\.\w+\s*=\s*\{/.test(l)) {
    starts.push({ line: i + 1, text: l.trim().slice(0, 60) });
  }
}

// For each, count braces
function findClose(startLine) {
  let depth = 0;
  let inS = false, inD = false, inT = false, inBC = false, inLC = false, inR = false;
  for (let i = startLine - 1; i < lines.length; i++) {
    const lt = lines[i];
    for (let j = 0; j < lt.length; j++) {
      const ch = lt[j];
      const next = lt[j+1];
      if (inBC) { if (ch === '*' && next === '/') { inBC = false; j++; } continue; }
      if (inLC) break;
      if (inS) { if (ch === '\\') { j++; continue; } if (ch === "'") inS = false; continue; }
      if (inD) { if (ch === '\\') { j++; continue; } if (ch === '"') inD = false; continue; }
      if (inT) { if (ch === '\\') { j++; continue; } if (ch === '`') inT = false; continue; }
      if (inR) { if (ch === '\\') { j++; continue; } if (ch === '/') inR = false; continue; }
      if (ch === '/' && next === '*') { inBC = true; j++; continue; }
      if (ch === '/' && next === '/') { inLC = true; continue; }
      if (ch === "'") { inS = true; continue; }
      if (ch === '"') { inD = true; continue; }
      if (ch === '`') { inT = true; continue; }
      if (ch === '/' && !inR) {
        let k = j - 1;
        while (k >= 0 && /\s/.test(lt[k])) k--;
        const prev = k >= 0 ? lt[k] : '';
        if (prev === '' || '=([{!&|?:;+-*%^~,'.includes(prev)) { inR = true; continue; }
      }
      if (inR) continue;
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return i + 1;
      }
    }
  }
  return -1;
}

for (const s of starts) {
  const cl = findClose(s.line);
  if (cl === -1) console.log('L' + s.line + ': ' + s.text + ' — UNCLOSED');
}
