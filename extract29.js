// Block 29: extract many sections (fixed regex)
const fs = require('fs');
const path = 'renderer/app.js';
const orig = fs.readFileSync(path, 'utf8');
const lines = orig.split(/\r?\n/);

// All section starts: `// ---...--- NAME ---...---`
const sectionStarts = [];
for (let i = 0; i < lines.length; i++) {
  // Match: // then -+ then space then NAME then space then -+ then end (no trailing space)
  const m = lines[i].match(/^\/\/ -+ ([^-].+?[^-]) -+ *$/);
  if (m) sectionStarts.push({ name: m[1], line: i });
}
console.log('Found', sectionStarts.length, 'sections');
if (sectionStarts.length === 0) {
  // Show some sample lines
  for (let i = 0; i < 20; i++) console.log('  L' + (i+1) + ': ' + lines[i].slice(0, 80));
  process.exit(1);
}

const sectionBounds = [];
for (let i = 0; i < sectionStarts.length; i++) {
  const start = sectionStarts[i].line;
  const end = (i + 1 < sectionStarts.length) ? sectionStarts[i + 1].line - 1 : lines.length - 1;
  sectionBounds.push({ name: sectionStarts[i].name, start, end });
}

let newLines = lines.slice();
let fileIndex = 1;
const outputs = [];

for (let i = sectionBounds.length - 1; i >= 0; i--) {
  const sec = sectionBounds[i];
  if (sec.end - sec.start < 5) continue;
  const block = lines.slice(sec.start, sec.end + 1);
  const fname = `renderer/sections/section${String(fileIndex).padStart(2, '0')}_${sec.name.replace(/[^A-Za-z0-9]/g, '_')}.js`;
  const content = `// ${fname} (Phase 3 Block 29)\n// Extracted: ${sec.name}\n// Source: app.js L${sec.start + 1}..${sec.end + 1}\n\n` + block.join('\n') + '\n';
  fs.mkdirSync('renderer/sections', { recursive: true });
  fs.writeFileSync(fname, content);
  console.log('  ' + fname + ': ' + block.length + ' Z.');
  outputs.push({ name: sec.name, file: fname, start: sec.start, end: sec.end });
  fileIndex++;
}

outputs.sort((a, b) => b.start - a.start);
for (const o of outputs) {
  newLines.splice(o.start, o.end - o.start + 1);
}

fs.writeFileSync(path, newLines.join('\n'));
console.log('app.js now:', newLines.length, 'lines, extracted:', outputs.length);
