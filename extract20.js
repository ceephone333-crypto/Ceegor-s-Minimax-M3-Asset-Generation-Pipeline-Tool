// Block 20: extract loadImageFromFile + derivedOutputPath
const fs = require('fs');
const path = 'renderer/app.js';
const targets = ['loadImageFromFile', 'derivedOutputPath'];

for (const name of targets) {
  const cur = fs.readFileSync(path, 'utf8').split(/\r?\n/);
  const startLine = cur.findIndex(l => new RegExp('^function ' + name + '\\s*\\(').test(l));
  if (startLine === -1) { console.log('SKIP', name); continue; }
  let depth = 0; let endLine = -1;
  for (let i = startLine; i < cur.length; i++) {
    for (const ch of cur[i]) {
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0 && i > startLine) { endLine = i; break; } }
    }
    if (endLine !== -1) break;
  }
  const before = cur.slice(0, startLine);
  const after = cur.slice(endLine + 1);
  const out = before.concat(after).join('\n');
  fs.writeFileSync(path, out);
  console.log('removed', name, '| L' + (startLine+1) + '..' + (endLine+1) + ' | lines:', endLine + 1 - startLine);
}

// Read current pureFuncs.js
let pf = fs.readFileSync('renderer/utils/pureFuncs.js', 'utf8');
if (!pf.includes('loadImageFromFile')) {
  // Build the new code in one string using an array join (safer than multiline)
  const additions = [
    '',
    '// Load a local file:// image as a usable Image object (resolves once',
    '// it is fully decoded). Used by upscale / crop / convert.',
    'function loadImageFromFile(filePath) {',
    '  return new Promise((resolve, reject) => {',
    '    const img = new Image();',
    '    img.onload = () => resolve(img);',
    '    img.onerror = () => reject(new Error("Failed to load image: " + filePath));',
    '    img.src = fileUrl(filePath);',
    '  });',
    '}',
    '',
    '// Pick a non-clobbering output path next to the source. Inserts a',
    '// `_2x`, `_cropped_WxH`, or `_converted` infix between the stem and',
    '// the extension. If the result already exists, a numeric suffix is',
    '// appended to keep the original safe.',
    'function derivedOutputPath(srcPath, infix) {',
    '  const sep = srcPath.includes("\\\\") ? "\\\\" : "/";',
    '  const lastSep = srcPath.lastIndexOf(sep);',
    '  const dir = lastSep >= 0 ? srcPath.slice(0, lastSep) : "";',
    '  const lastDot = srcPath.lastIndexOf(".");',
    '  const stem = lastDot > lastSep ? srcPath.slice(0, lastDot) : srcPath;',
    '  const ext = lastDot > lastSep ? srcPath.slice(lastDot) : "";',
    '  return dir + sep + stem.split(sep).pop() + infix + ext;',
    '}',
    '',
    'window.PureFuncs = Object.assign(window.PureFuncs || {}, { loadImageFromFile, derivedOutputPath });',
  ].join('\n');
  pf = pf.replace('window.PureFuncs = { parseAspect, humanSize, parentDir, iconForFile };',
                  'window.PureFuncs = { parseAspect, humanSize, parentDir, iconForFile };\n' + additions);
  fs.writeFileSync('renderer/utils/pureFuncs.js', pf);
  console.log('Updated pureFuncs.js');
}

// Add shim
const final = fs.readFileSync(path, 'utf8');
const shim = '// Phase 3 Block 20: loadImageFromFile + derivedOutputPath extrahiert\n// nach renderer/utils/pureFuncs.js.\nconst { loadImageFromFile, derivedOutputPath } = window.PureFuncs;\n\n';
const shimInsertAt = final.indexOf('const el = window.createElement;') + 'const el = window.createElement;'.length + 1;
const out2 = final.slice(0, shimInsertAt) + '\n' + shim + final.slice(shimInsertAt);
fs.writeFileSync(path, out2);
console.log('final line count:', out2.split('\n').length);
