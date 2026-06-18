const fs = require('fs');
function checkBrackets(s) {
  let braces = 0, parens = 0, brackets = 0;
  let inStr = null, esc = false, inLineCom = false, inBlockCom = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i], n = s[i+1];
    if (esc) { esc = false; continue; }
    if (inLineCom) { if (c === '\n') inLineCom = false; continue; }
    if (inBlockCom) { if (c === '*' && n === '/') { inBlockCom = false; i++; } continue; }
    if (inStr) { if (c === '\\') esc = true; else if (c === inStr) inStr = null; continue; }
    if (c === '/' && n === '/') { inLineCom = true; i++; continue; }
    if (c === '/' && n === '*') { inBlockCom = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') braces++; else if (c === '}') braces--;
    else if (c === '(') parens++; else if (c === ')') parens--;
    else if (c === '[') brackets++; else if (c === ']') brackets--;
  }
  return { braces, parens, brackets };
}
for (const f of [
  'renderer/sections/section07_Image_optimisation___compression.js',
  'renderer/tabs/imageTab.js',
  'renderer/tabs/musicTab.js',
  'renderer/tabs/speechTab.js',
  'renderer/tabs/videoTab.js',
  'renderer/tabs/batchManager.js',
  'renderer/tabs/styleHelpers.js',
  'renderer/app.js',
]) {
  try {
    new Function(fs.readFileSync(f, 'utf8'));
    const c = fs.readFileSync(f, 'utf8');
    const b = checkBrackets(c);
    console.log('OK ', f.replace('renderer/', ''), '(', c.split('\n').length, 'Z.,', JSON.stringify(b), ')');
  } catch (e) {
    console.log('ERR', f.replace('renderer/', ''), ':', e.message);
  }
}
