// Find the next unclosed function by trying to parse shorter prefixes
const fs = require('fs');
const vm = require('vm');
const lines = fs.readFileSync('renderer/app.js', 'utf8');
const N = lines.length;
let low = 1, high = N;
while (low < high) {
  const mid = Math.floor((low + high) / 2);
  const src = lines.slice(0, mid).join('\n');
  try { new vm.Script(src); low = mid + 1; } catch (e) { high = mid; }
}
console.log('Last OK line:', low - 1);
console.log('First FAIL line:', low);
console.log('Context:');
for (let i = Math.max(0, low - 5); i <= Math.min(N, low + 2); i++) {
  console.log('  L' + (i+1) + (i+1 === low ? '> ' : '  ') + lines[i].slice(0, 100));
}
