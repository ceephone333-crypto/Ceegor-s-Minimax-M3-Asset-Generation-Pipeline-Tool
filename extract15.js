// Block 15 extraction script
const fs = require('fs');
const path = 'renderer/app.js';
const targets = ['iconForFile', 'humanSize', 'parentDir', 'parseAspect'];

for (const name of targets) {
  const cur = fs.readFileSync(path, 'utf8').split(/\r?\n/);
  const startLine = cur.findIndex(l => new RegExp('^function ' + name + '\\s*\\(').test(l));
  if (startLine === -1) { console.log('SKIP', name, '(not found)'); continue; }
  let depth = 0; let endLine = -1;
  for (let i = startLine; i < cur.length; i++) {
    for (const ch of cur[i]) {
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0 && i > startLine) { endLine = i; break; } }
    }
    if (endLine !== -1) break;
  }
  if (endLine === -1) { console.log('SKIP', name, '(no end)'); continue; }
  const before = cur.slice(0, startLine);
  const after = cur.slice(endLine + 1);
  const out = before.concat(after).join('\n');
  fs.writeFileSync(path, out);
  console.log('removed', name, '| L' + (startLine+1) + '..' + (endLine+1) + ' | lines:', endLine + 1 - startLine);
}

// Add shim
const final = fs.readFileSync(path, 'utf8');
const shim = '// Phase 3 Block 15: 4 pure helpers (parseAspect, humanSize,\n// parentDir, iconForFile) extrahiert nach renderer/utils/pureFuncs.js.\nconst { parseAspect, humanSize, parentDir, iconForFile } = window.PureFuncs;\n\n';
const shimInsertAt = final.indexOf('const el = window.createElement;') + 'const el = window.createElement;'.length + 1;
const out2 = final.slice(0, shimInsertAt) + '\n' + shim + final.slice(shimInsertAt);
fs.writeFileSync(path, out2);
console.log('final line count:', out2.split('\n').length);
