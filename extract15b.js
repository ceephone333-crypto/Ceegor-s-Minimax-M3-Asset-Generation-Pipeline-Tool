// Extract parseAspect (nested function)
const fs = require('fs');
const path = 'renderer/app.js';
const cur = fs.readFileSync(path, 'utf8').split(/\r?\n/);
const startLine = cur.findIndex(l => /parseAspect\s*\(/.test(l) && l.includes('function'));
if (startLine === -1) { console.log('NOT FOUND'); process.exit(1); }
console.log('parseAspect at L' + (startLine+1) + ':', cur[startLine].slice(0, 80));
let depth = 0; let endLine = -1;
for (let i = startLine; i < cur.length; i++) {
  for (const ch of cur[i]) {
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0 && i > startLine) { endLine = i; break; } }
  }
  if (endLine !== -1) break;
}
console.log('end L' + (endLine+1));
const before = cur.slice(0, startLine);
const after = cur.slice(endLine + 1);
const out = before.concat(after).join('\n');
fs.writeFileSync(path, out);
console.log('removed', endLine + 1 - startLine, 'lines, new total:', out.split('\n').length);
