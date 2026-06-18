// Find unclosed functions in app.js
// Tracks: strings, template literals, single-line + block comments,
// and regex literals (in expression position).
const fs = require('fs');
const src = fs.readFileSync('renderer/app.js', 'utf8');

let i = 0;
let state = { inSingle: false, inDouble: false, inTpl: false, inBlockComment: false, inLineComment: false, inRegex: false };
let depth = 0;
const funcs = [];  // stack of {name, openLine, depthAtOpen}
let currentFunc = null;
let lastBrace = -1;

function setState(ch, next) {
  if (state.inBlockComment) {
    if (ch === '*' && next === '/') { state.inBlockComment = false; return true; }
    return false;
  }
  if (state.inLineComment) { state.inLineComment = false; return false; }
  if (state.inSingle) { if (ch === '\\') return true; if (ch === "'") state.inSingle = false; return false; }
  if (state.inDouble) { if (ch === '\\') return true; if (ch === '"') state.inDouble = false; return false; }
  if (state.inTpl) { if (ch === '\\') return true; if (ch === '`') state.inTpl = false; return false; }
  if (state.inRegex) { if (ch === '\\') return true; if (ch === '/') state.inRegex = false; return false; }
  // Not in anything
  if (ch === '/' && next === '*') { state.inBlockComment = true; return true; }
  if (ch === '/' && next === '/') { state.inLineComment = true; return true; }
  if (ch === "'") { state.inSingle = true; return false; }
  if (ch === '"') { state.inDouble = true; return false; }
  if (ch === '`') { state.inTpl = true; return false; }
  return false;
}

let line = 1;
let lineStart = 0;
for (let k = 0; k < src.length; k++) {
  const ch = src[k];
  const next = src[k+1];
  if (ch === '\n') { line++; lineStart = k+1; }
  if (setState(ch, next)) continue;

  // Track regex literals: only in expression position (after =, (, etc.)
  // Heuristic: if char is `/` and not in string/comment, and prev non-whitespace
  // is one of: = ( , [ { ! & | ? : ; , + - * / % ^ ~ then start regex
  if (ch === '/' && !state.inSingle && !state.inDouble && !state.inTpl && !state.inBlockComment && !state.inLineComment && !state.inRegex) {
    // Check prev non-whitespace
    let j = k - 1;
    while (j >= lineStart && /\s/.test(src[j])) j--;
    const prev = j >= lineStart ? src[j] : '';
    if (prev === '' || '=([{!&|?:;+-*%^~,'.includes(prev)) {
      state.inRegex = true;
      continue;
    }
  }

  if (state.inRegex) continue;
  if (state.inBlockComment || state.inLineComment || state.inSingle || state.inDouble || state.inTpl) continue;

  if (ch === '{') {
    // Check if this opens a function
    let m = k;
    while (m > lineStart && /\s/.test(src[m-1])) m--;
    const wordStart = m;
    while (wordStart > lineStart && /[a-zA-Z_$0-9]/.test(src[wordStart - 1])) wordStart--;
    const word = src.slice(wordStart, m);
    if (word === 'function' || word.startsWith('function')) {
      // Check what follows
      let n = m;
      while (n < src.length && /\s/.test(src[n])) n++;
      if (src[n] === '(') {
        // Try to find function name
        let nameStart = wordStart - 1;
        while (nameStart > 0 && /[a-zA-Z_$0-9]/.test(src[nameStart - 1])) nameStart--;
        const name = src.slice(nameStart, wordStart);
        funcs.push({ name: name || '?', openLine: line, depthAtOpen: depth });
        currentFunc = funcs[funcs.length - 1];
      }
    }
    depth++;
    lastBrace = line;
  } else if (ch === '}') {
    depth--;
    if (depth === 0 && funcs.length > 0) {
      // All functions closed
      funcs.length = 0;
      currentFunc = null;
    } else if (currentFunc && depth < currentFunc.depthAtOpen) {
      const f = funcs.pop();
      currentFunc = funcs[funcs.length - 1] || null;
    }
    lastBrace = line;
  }
}

// Now we have unclosed functions
console.log('Total unclosed functions (stack remaining):', funcs.length);
for (const f of funcs.slice(0, 30)) {
  console.log(`  L${f.openLine}: ${f.name} (depth at open: ${f.depthAtOpen})`);
}
