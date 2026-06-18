// Find lines in app.js with unbalanced single quotes
const fs = require('fs');
const lines = fs.readFileSync('renderer/app.js', 'utf8').split(/\r?\n/);
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  let logicalCount = 0;
  for (let j = 0; j < line.length; j++) {
    if (line[j] === "'" && (j === 0 || line[j-1] !== '\\')) logicalCount++;
  }
  if (logicalCount % 2 !== 0) {
    console.log('L' + (i+1) + ' (' + logicalCount + ' logical quotes):');
    console.log('  ', line);
  }
}
