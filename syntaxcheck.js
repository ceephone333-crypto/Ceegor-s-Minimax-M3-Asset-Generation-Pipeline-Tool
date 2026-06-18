// Run node --check and write result to a file
const { execSync } = require('child_process');
const fs = require('fs');
let out = '';
let err = '';
try {
  out = execSync('node --check renderer/app.js', { encoding: 'utf8' });
} catch (e) {
  out = e.stdout || '';
  err = e.stderr || '';
}
fs.writeFileSync('syntaxout.txt', 'STDOUT:\n' + out + '\n\nSTDERR:\n' + err);
console.log('Done. Output written to syntaxout.txt');
