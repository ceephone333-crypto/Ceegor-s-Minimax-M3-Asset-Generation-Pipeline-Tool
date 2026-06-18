// Find lines that look like TABS.music closing
const fs = require('fs');
const lines = fs.readFileSync('renderer/app.js', 'utf8').split(/\r?\n/);
for (let i = 3419; i < 4500; i++) {
  const t = lines[i].trim();
  if (t === '};' || t === '}' || /^};?\s*\/\/\s*-{3,}/.test(t) || /^};?\s*\/\/\s*(MUSIC|VOICE|VIDEO|TAB|TABS)/i.test(t)) {
    console.log('L' + (i+1) + ':', lines[i].slice(0, 100));
  }
}
