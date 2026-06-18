const fs = require('fs');
const path = require('path');
function walk(d) {
  const out = [];
  for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.name.endsWith('.js')) out.push(p);
  }
  return out;
}
const all = walk('renderer').filter(f => !f.includes('node_modules'));
const contents = {};
for (const f of all) contents[f] = fs.readFileSync(f, 'utf8');
const critical = ['buildStyleRow', 'buildStylePreviewBlock', 'updateStylePreview', 'showModal', 'showImagePreview', 'showAudioPreview', 'openImageOverlay', 'openAudioOverlay', 'buildOverlayNavList', 'navigateToOverlayImage', 'log', 'toast', 'parentDir', 'showTab', 'refreshBrowser', 'applyFileSearch', 'refreshQuota', 'openSettings', 'openStyleSettings', 'showStartupPopup', 'setStatus', 'installKeyboardShortcuts', 'setupLastCmdTooltips', 'assignTabFormIds', 'applyTabState', 'setupTabAutosave', 'slugifyLabel', 'scheduleStateSave', 'saveAllStates', 'applyTheme', 'toggleTheme', 'el', 'getStyleText', 'buildFinalPrompt', 'normalizeStyles', 'promptNewFolder', 'openBatchManager', 'startBatchGen'];
for (const fn of critical) {
  let defs = [];
  for (const f of all) {
    if (new RegExp('^function ' + fn + '\\s*\\(').test(contents[f]) ||
        new RegExp('^async function ' + fn + '\\s*\\(').test(contents[f])) defs.push(f.replace('renderer/', ''));
  }
  console.log((defs.length ? 'OK  ' : 'MISS') + ' ' + fn + (defs.length > 0 ? ' -> ' + defs[0] : ''));
}
