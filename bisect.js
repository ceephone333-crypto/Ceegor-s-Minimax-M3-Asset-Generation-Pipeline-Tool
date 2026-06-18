// Bisect: find the first line that breaks parse
const fs = require('fs');
const lines = fs.readFileSync('renderer/app.js', 'utf8').split(/\r?\n/);
const N = lines.length;
let low = 1, high = N;
while (low < high) {
  const mid = Math.floor((low + high) / 2);
  const src = lines.slice(0, mid).join('\n');
  try { new Function(src); low = mid + 1; } catch (e) { high = mid; }
}
// Binary search gives us the first failing range. Get the actual line.
const exactSrc = lines.slice(0, low).join('\n');
let errLine = -1;
try { new Function(exactSrc); } catch (e) { errLine = low; }
// Now narrow down by trying shorter prefixes
let hi = errLine;
let lo = Math.max(1, errLine - 50);
while (lo < hi) {
  const mid = Math.floor((lo + hi) / 2);
  const src = lines.slice(0, mid).join('\n');
  try { new Function(src); lo = mid + 1; } catch (e) { hi = mid; }
}
console.log('Last OK line:', lo - 1);
console.log('First FAIL line:', lo);
console.log('Context around FAIL:');
for (let i = Math.max(0, lo - 3); i <= Math.min(N, lo + 2); i++) {
  console.log('  L' + (i+1) + (i+1 === lo ? '> ' : '  ') + lines[i].slice(0, 120));
}
