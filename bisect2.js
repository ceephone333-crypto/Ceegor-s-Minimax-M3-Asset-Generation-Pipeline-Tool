// Find unclosed functions by bisection
const fs = require('fs');
const vm = require('vm');
const lines = fs.readFileSync('renderer/app.js', 'utf8');

// Use a different approach: track which top-level function declarations
// don't have a matching close before EOF
const topLevelFuncs = [];
let inString = false, strChar = '', inComment = false, inBlock = false, inRegex = false, inTpl = false;
let line = 1, lineStart = 0;

for (let i = 0; i < lines.length; i++) {
  // First, detect function declarations
  const l = lines[i];
  // Quick check: does this line contain 'function NAME(' at start?
  const m = l.match(/^(\s*)function\s+(\w+)\s*\(/);
  if (m) {
    topLevelFuncs.push({ name: m[2], start: i+1, indent: m[1].length });
  }
}

// Now check each function: find its closing } at the same indentation
for (const f of topLevelFuncs) {
  let depth = 0;
  let inS = false, inD = false, inT = false, inBC = false, inLC = false, inR = false;
  let closeLine = -1;
  for (let i = f.start - 1; i < lines.length; i++) {
    const lineText = lines[i];
    for (let j = 0; j < lineText.length; j++) {
      const ch = lineText[j];
      const next = lineText[j+1];
      if (inBC) { if (ch === '*' && next === '/') { inBC = false; j++; } continue; }
      if (inLC) break;  // line comment, skip rest of line
      if (inS) { if (ch === '\\') { j++; continue; } if (ch === "'") inS = false; continue; }
      if (inD) { if (ch === '\\') { j++; continue; } if (ch === '"') inD = false; continue; }
      if (inT) { if (ch === '\\') { j++; continue; } if (ch === '`') inT = false; continue; }
      if (inR) { if (ch === '\\') { j++; continue; } if (ch === '/') inR = false; continue; }
      if (ch === '/' && next === '*') { inBC = true; j++; continue; }
      if (ch === '/' && next === '/') { inLC = true; continue; }
      if (ch === "'") { inS = true; continue; }
      if (ch === '"') { inD = true; continue; }
      if (ch === '`') { inT = true; continue; }
      // Regex check
      if (ch === '/' && !inR) {
        let k = j - 1;
        while (k >= 0 && /\s/.test(lineText[k])) k--;
        const prev = k >= 0 ? lineText[k] : '';
        if (prev === '' || '=([{!&|?:;+-*%^~,'.includes(prev)) {
          inR = true;
          continue;
        }
      }
      if (inR) continue;
      if (ch === '{') { depth++; }
      else if (ch === '}') {
        depth--;
        if (depth === 0) { closeLine = i + 1; break; }
      }
    }
    if (closeLine > 0) break;
  }
  f.closeLine = closeLine;
}

// Show unclosed functions
console.log('Functions without proper close:');
for (const f of topLevelFuncs) {
  if (f.closeLine === -1) {
    console.log(`  L${f.start}: ${f.name} — UNCLOSED (EOF)`);
  }
}
