// Find unbalanced delimiter (paren, bracket, brace) in app.js
const fs = require('fs');
const lines = fs.readFileSync('renderer/app.js', 'utf8').split(/\r?\n/);

// Stack-based parser
const stack = [];  // {ch, line, col}
let inS = false, inD = false, inT = false, inBC = false, inLC = false, inR = false;
let ch, next, prev;

for (let i = 0; i < lines.length; i++) {
  const lt = lines[i];
  for (let j = 0; j < lt.length; j++) {
    ch = lt[j];
    next = lt[j+1];
    prev = j > 0 ? lt[j-1] : '';
    if (inBC) {
      if (ch === '*' && next === '/') { inBC = false; j++; }
      continue;
    }
    if (inLC) { inLC = false; break; }
    if (inS) {
      if (ch === '\\') { j++; continue; }
      if (ch === "'") inS = false;
      continue;
    }
    if (inD) {
      if (ch === '\\') { j++; continue; }
      if (ch === '"') inD = false;
      continue;
    }
    if (inT) {
      if (ch === '\\') { j++; continue; }
      if (ch === '`') inT = false;
      continue;
    }
    if (inR) {
      if (ch === '\\') { j++; continue; }
      if (ch === '/') inR = false;
      continue;
    }
    // Not in anything - check for start
    if (ch === '/' && next === '*') { inBC = true; j++; continue; }
    if (ch === '/' && next === '/') { inLC = true; continue; }
    if (ch === "'") { inS = true; continue; }
    if (ch === '"') { inD = true; continue; }
    if (ch === '`') { inT = true; continue; }
    if (ch === '/' && !inR) {
      // Check if regex: prev non-whitespace is an operator
      let k = j - 1;
      while (k >= 0 && /\s/.test(lt[k])) k--;
      const p = k >= 0 ? lt[k] : '';
      if (p === '' || '=([{!&|?:;+-*%^~,'.includes(p)) {
        inR = true;
        continue;
      }
    }
    // Open/close delimiters
    if (ch === '{' || ch === '(' || ch === '[') stack.push({ ch, line: i+1, col: j+1 });
    else if (ch === '}' || ch === ')' || ch === ']') {
      if (stack.length === 0) {
        console.log('UNMATCHED close', ch, 'at L' + (i+1) + ':' + (j+1));
      } else {
        const top = stack[stack.length - 1];
        const expected = top.ch === '{' ? '}' : top.ch === '(' ? ')' : ']';
        if (ch !== expected) {
          console.log('MISMATCH at L' + (i+1) + ':' + (j+1) + ': got ' + ch + ', expected ' + expected + ' (top: ' + top.ch + ' opened L' + top.line + ':' + top.col + ')');
        }
        stack.pop();
      }
    }
  }
}
console.log('\nUnclosed stack (' + stack.length + ' items):');
for (const s of stack.slice(0, 30)) {
  console.log('  ' + s.ch + ' opened at L' + s.line + ':' + s.col);
}
