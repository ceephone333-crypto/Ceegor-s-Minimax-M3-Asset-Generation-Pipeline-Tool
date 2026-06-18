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
    if (c === '{') braces++;
    else if (c === '}') braces--;
    else if (c === '(') parens++;
    else if (c === ')') parens--;
    else if (c === '[') brackets++;
    else if (c === ']') brackets--;
  }
  return { braces, parens, brackets };
}
const files = [
  'renderer/sections/section07_Image_optimisation_part1a.js',
  'renderer/sections/section07_Image_optimisation_part1b.js',
  'renderer/sections/section07_Image_optimisation_part2.js',
  'renderer/tabs/imageTabA.js',
  'renderer/tabs/imageTabB.js',
  'renderer/tabs/musicTabA.js',
  'renderer/tabs/musicTabB.js',
];
for (const f of files) {
  const c = fs.readFileSync(f, 'utf8');
  const b = checkBrackets(c);
  console.log(f.replace('renderer/', ''), '->', JSON.stringify(b));
}
