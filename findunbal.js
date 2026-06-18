// Find unclosed string before line 254
const fs = require('fs');
const lines = fs.readFileSync('renderer/app.js', 'utf8').split(/\r?\n/);

// Walk the file character by character, tracking strings and comments.
// For each line, find where in the parser state we are.
let inSingle = false;  // ' string
let inDouble = false;  // " string
let inTpl = false;     // ` template
let inBlockComment = false;  // /* */
let inLineComment = false;  // // to end of line

// Function: check a single line in a given starting state
function checkLine(line, startState) {
  let s = { ...startState };
  for (let j = 0; j < line.length; j++) {
    const ch = line[j];
    const next = line[j+1];
    if (s.inBlockComment) {
      if (ch === '*' && next === '/') { s.inBlockComment = false; j++; }
      continue;
    }
    if (s.inLineComment) {
      // rest of line is comment
      s.inLineComment = false;
      return { s, endPos: j - 1 };
    }
    if (s.inSingle) {
      if (ch === '\\') { j++; continue; }
      if (ch === "'") s.inSingle = false;
      continue;
    }
    if (s.inDouble) {
      if (ch === '\\') { j++; continue; }
      if (ch === '"') s.inDouble = false;
      continue;
    }
    if (s.inTpl) {
      if (ch === '\\') { j++; continue; }
      if (ch === '`') s.inTpl = false;
      continue;
    }
    // Not in string
    if (ch === '/' && next === '*') { s.inBlockComment = true; j++; continue; }
    if (ch === '/' && next === '/') { s.inLineComment = true; j++; continue; }
    if (ch === "'") { s.inSingle = true; continue; }
    if (ch === '"') { s.inDouble = true; continue; }
    if (ch === '`') { s.inTpl = true; continue; }
  }
  return { s, endPos: line.length - 1 };
}

let state = { inSingle: false, inDouble: false, inTpl: false, inBlockComment: false, inLineComment: false };
for (let i = 0; i < 254; i++) {
  const r = checkLine(lines[i], state);
  state = r.s;
  if (i > 230 && i < 254) {
    const s = state;
    const marker = (s.inSingle || s.inDouble || s.inTpl || s.inBlockComment) ? '*' : ' ';
    console.log(`L${String(i+1).padStart(4)} ${marker} ${s.inSingle ? 'SQ' : '  '} ${s.inDouble ? 'DQ' : '  '} ${s.inTpl ? 'TQ' : '  '} ${s.inBlockComment ? 'BC' : '  '}`);
  }
}
console.log('Final state:', state);
