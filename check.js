const { execSync } = require('child_process');
try { execSync('node --check renderer/app.js', { encoding: 'utf8' }); fs.writeFileSync('result.txt', 'OK'); } catch (e) { fs.writeFileSync('result.txt', 'ERROR:\n' + e.stderr); }
