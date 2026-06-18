// Find the closing } of TABS.music in app.js
const fs = require('fs');
const lines = fs.readFileSync('renderer/app.js', 'utf8').split(/\r?\n/);
// Find all lines that have a top-level `}` (depth 0 at that point)
function findClosingOf(marker, endSearch) {
  const startIdx = lines.findIndex(l => l.includes(marker));
  if (startIdx === -1) { console.log('marker not found:', marker); return; }
  let depth = 0;
  let inSingle = false, inDouble = false, inTpl = false, inBlockComment = false, inLineComment = false;
  for (let i = startIdx; i < Math.min(endSearch, lines.length); i++) {
    const line = lines[i];
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      const next = line[j+1];
      if (inBlockComment) {
        if (ch === '*' && next === '/') { inBlockComment = false; j++; }
        continue;
      }
      if (inLineComment) { inLineComment = false; break; }
      if (inSingle) { if (ch === '\\') { j++; continue; } if (ch === "'") inSingle = false; continue; }
      if (inDouble) { if (ch === '\\') { j++; continue; } if (ch === '"') inDouble = false; continue; }
      if (inTpl) { if (ch === '\\') { j++; continue; } if (ch === '`') inTpl = false; continue; }
      if (ch === '/' && next === '*') { inBlockComment = true; j++; continue; }
      if (ch === '/' && next === '/') { inLineComment = true; j++; continue; }
      if (ch === "'") { inSingle = true; continue; }
      if (ch === '"') { inDouble = true; continue; }
      if (ch === '`') { inTpl = true; continue; }
      if (ch === '/' && next === '/') { inLineComment = true; j++; continue; }  // duplicate
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) { console.log(marker, 'closes at line', i+1, '|', line.slice(0, 80)); return; }
      }
    }
  }
  console.log(marker, 'never closes; final depth', depth);
}

findClosingOf('TABS.music = {', 5000);
findClosingOf('TABS.image = {', 5000);
findClosingOf('TABS.speech = {', 5000);
