const { execSync } = require('child_process');
const fs = require('fs');
try {
  execSync('node --check renderer/app.js', { encoding: 'utf8', stdio: 'pipe' });
  fs.writeFileSync('result.txt', 'OK');
} catch (e) {
  fs.writeFileSync('result.txt', 'ERROR:\n' + e.stderr);
}
