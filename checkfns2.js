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
const critical = ['buildStyleRow', 'buildStylePreviewBlock', 'updateStylePreview', 'showModal', 'showImagePreview', 'showAudioPreview', 'openImageOverlay', 'openAudioOverlay', 'buildOverlayNavList', 'navigateToOverlayImage', 'log', 'toast', 'parentDir', 'showTab', 'refreshBrowser', 'applyFileSearch', 'refreshQuota', 'openSettings', 'openStyleSettings', 'showStartupPopup', 'setStatus', 'installKeyboardShortcuts', 'setupLastCmdTooltips', 'assignTabFormIds', 'applyTabState', 'setupTabAutosave', 'slugifyLabel', 'scheduleStateSave', 'saveAllStates', 'applyTheme', 'toggleTheme', 'getStyleText', 'buildFinalPrompt', 'normalizeStyles', 'promptNewFolder', 'openBatchManager', 'startBatchGen', '_refreshBatchButtons'];
for (const fn of critical) {
  let defs = [];
  for (const f of all) {
    const c = contents[f];
    // Match any of: function, async function, const = function, const = ()=>
    if (new RegExp('^(async\\s+)?function\\s+' + fn + '\\s*\\(').test(c) ||
        new RegExp('^const\\s+' + fn + '\\s*=').test(c) ||
        new RegExp('^let\\s+' + fn + '\\s*=').test(c) ||
        new RegExp('^var\\s+' + fn + '\\s*=').test(c) ||
        new RegExp('^window\\.' + fn + '\\s*=').test(c)) defs.push(f.replace('renderer/', ''));
  }
  console.log((defs.length ? 'OK  ' : 'MISS') + ' ' + fn + (defs.length > 0 ? ' -> ' + defs[0] : ''));
}
