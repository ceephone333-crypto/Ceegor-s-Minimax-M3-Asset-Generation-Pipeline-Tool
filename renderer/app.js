/* renderer/app.js â€” UI logic, no build step. */
// We use globals (window.api from preload) to stay build-free.

// Tool version: bump / refresh this whenever you ship a build. The
// string is read from package.json via window.api.getAppVersion()
// at startup (added in the same change that bumped it to 1.1.1), so
// the renderer always shows the version that ships in this build's
// package.json â€” no risk of a stale string in the source when
// someone forgets to bump it. The format is "<version> Â· <compile
// date> <compile time>" so the user can see at a glance which
// build they have.
let BUILD_VERSION = '1.1.1 Â· loadingâ€¦';
const TOOL_NAME = 'MiniMax Assets Tool';
const TOOL_INFO =
  'A friendly desktop app for the MiniMax AI service. ' +
  'Generate images, speech, music, and short videos from text prompts in one window. ' +
  'Works with both Token Plan keys and pay-as-you-go (PAYG) API keys. ' +
  'Includes style presets (so you can keep the same look across many generations), ' +
  'batch generation (run a whole list of prompts in one click), ' +
  'and built-in tools to upscale, crop, remove backgrounds, and shrink the file size of every result.';

// Phase 4 Fix 15: 'var' statt 'const'. 'const' am Top-Level eines
// <script>-Tags ist NICHT global. Section-Files (geladen VOR app.js)
// rufen '$'/'$$'/'TABS' auf. Mit 'var' werden sie global und sind
// in allen <script>-Tags sichtbar.
var $ = (sel, root = document) => root.querySelector(sel);
var $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ----------------- Tabs -----------------
var TABS = {};

// ----------------- Bootstrap on DOM ready -----------------
// This is the renderer-side init() that wires up tabs, file browser,
// log bar, settings, theme, and bootstraps each tab's build(). It
// was lost in Phase 3 Block 29 (when the 24 sections were
// extracted) and has to be re-added here as a thin orchestrator
// over the section-level functions. All section files load BEFORE
// this script (see index.html order), so all the helpers (state,
// showTab, refreshBrowser, etc.) are already defined by the time
// we run.
async function init() {
  // Wire tabs
  for (const t of $$('.tab')) t.addEventListener('click', () => showTab(t.dataset.tab));
  $('#fb-up').addEventListener('click', () => {
    const outRoot = state.config.output_dir || '';
    if (!state.fbDir) return;
    if (outRoot && state.fbDir.toLowerCase() === outRoot.toLowerCase()) return;
    state.fbDir = parentDir(state.fbDir) || outRoot;
    refreshBrowser({ keepCurrent: true });
  });
  // File browser live filter
  const fbSearch = $('#fb-search');
  if (fbSearch) fbSearch.addEventListener('input', applyFileSearch);
  $('#fb-refresh').addEventListener('click', () => refreshBrowser());
  $('#fb-new').addEventListener('click', () => promptNewFolder());
  $('#fb-open').addEventListener('click', () => window.api.fbReveal(state.fbDir || state.config.output_dir || ''));
  $('#quota-refresh').addEventListener('click', () => refreshQuota());
  $('#btn-styles').addEventListener('click', () => openStyleSettings());
  $('#btn-theme').addEventListener('click', () => toggleTheme());
  $('#btn-settings').addEventListener('click', () => openSettings());

  // Log bar
  const logDetails = $('#logbar details');
  const logCopyBtn = $('#log-copy');
  const logClearBtn = $('#log-clear');
  const logToggleBtn = $('#log-toggle');
  function _syncLogToggleLabel() {
    if (!logToggleBtn || !logDetails) return;
    logToggleBtn.textContent = logDetails.open ? '▼ Collapse' : '▲ Expand';
  }
  if (logDetails) logDetails.addEventListener('toggle', _syncLogToggleLabel);
  if (logToggleBtn) {
    logToggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!logDetails) return;
      logDetails.open = !logDetails.open;
      _syncLogToggleLabel();
    });
  }
  if (logClearBtn) {
    logClearBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const logEl = $('#log');
      if (logEl) logEl.textContent = '';
      toast('Log cleared.', 'ok', 1500);
    });
  }
  if (logCopyBtn) {
    logCopyBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const txt = $('#log')?.textContent || '';
      if (!txt) { toast('Log is empty.', 'warn'); return; }
      try {
        await navigator.clipboard.writeText(txt);
        toast('Log copied to clipboard.', 'ok', 1500);
      } catch (err) {
        const range = document.createRange();
        range.selectNodeContents($('#log'));
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        toast('Copy failed — log text selected, press Ctrl+C to copy.', 'warn', 4000);
      }
    });
  }
  _syncLogToggleLabel();

  // Picture preview pane
  const previewClearBtn = $('#preview-clear');
  if (previewClearBtn) {
    previewClearBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const content = $('#fb-preview-content');
      if (!content) return;
      content.innerHTML = '<div class="preview-pane-empty">Click an image in the file browser to preview it here.</div>';
    });
  }

  // Config
  state.config = await window.api.getConfig();
  if (!Array.isArray(state.config.styles)) state.config.styles = [];
  if (!state.config.theme) state.config.theme = 'dark';
  applyTheme(state.config.theme);
  if (!state.config.api_key) {
    toast('No API key. Click ⚙ to add one.', 'warn', 6000);
  }

  // Build tabs (assign ids + load saved state + start autosave)
  const savedState = await window.api.stateGet() || {};
  state.tabSettings = savedState.tabs || {};
  if (savedState.fbDirs && typeof savedState.fbDirs === 'object') {
    for (const k of ['image', 'speech', 'music', 'video']) {
      if (typeof savedState.fbDirs[k] === 'string') state.fbDirs[k] = savedState.fbDirs[k];
    }
  }
  if (typeof savedState.upscaleEnabled === 'boolean') state.upscaleEnabled = savedState.upscaleEnabled;
  if (savedState.upscaleSettings && typeof savedState.upscaleSettings === 'object' && savedState.upscaleSettings.multiplier) {
    state.upscaleSettings = { multiplier: parseInt(savedState.upscaleSettings.multiplier, 10) || 2 };
  }
  const startTab = (savedState.currentTab && ['image','speech','music','video'].includes(savedState.currentTab))
    ? savedState.currentTab : 'image';
  for (const tabKey of ['image', 'speech', 'music', 'video']) {
    if (TABS[tabKey] && typeof TABS[tabKey].build === 'function') TABS[tabKey].build();
    assignTabFormIds(tabKey);
    applyTabState(tabKey, state.tabSettings[tabKey] || {});
    setupTabAutosave(tabKey);
  }

  // Load batches
  state.batches = await window.api.batchesGet();
  _refreshBatchButtons();

  // Install global keyboard shortcuts
  installKeyboardShortcuts();
  setupLastCmdTooltips();
  setStatus('Ready');

  // Initial values
  if (!state.config.output_dir) {
    state.config.output_dir = await window.api.configPath().then((p) => p.replace(/config\.txt$/i, 'generated'));
  }

  showTab(startTab);

  // Startup popup (deferred so the rest of the UI is visible behind it)
  showStartupPopup();

  // Logs from main
  window.api.onLog((line) => log(line));

  // First quota fetch
  refreshQuota().catch(() => {});
}



function applyTheme(theme) {
  state.theme = (theme === 'light' ? 'light' : 'dark');
  document.documentElement.setAttribute('data-theme', state.theme);
}

function toggleTheme() {
  const next = state.theme === 'light' ? 'dark' : 'light';
  applyTheme(next);
  // Persist immediately
  state.config.theme = next;
  window.api.setConfig(state.config).catch(() => {});
  toast(`Theme: ${next}`, 'ok', 1500);
}

function installKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Skip when typing in a non-textarea field (so Ctrl+A etc. works in inputs)
    const inField = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT');
    const cmd = e.ctrlKey || e.metaKey;
    // `e.key` is undefined when only a modifier is held. Bail out so we don't
    // mis-fire handlers on modifier-only events (e.g. releasing Shift).
    if (!e.key) return;
    if (cmd && e.key === 'Enter') {
      // Generate on the active tab
      const tab = state.currentTab;
      const genBtn = $(`#tab-${tab} button.primary`);
      if (genBtn && !state.generating && genBtn.textContent !== 'Cancel') { genBtn.click(); e.preventDefault(); }
      return;
    }
    if (cmd && ['1','2','3','4'].includes(e.key)) {
      const tabs = ['image','speech','music','video'];
      const idx = parseInt(e.key, 10) - 1;
      if (tabs[idx]) { showTab(tabs[idx]); e.preventDefault(); }
      return;
    }
    if (cmd && (e.key === 'b' || e.key === 'B')) {
      openBatchManager(state.currentTab); e.preventDefault(); return;
    }
    if (cmd && (e.key === 's' || e.key === 'S')) {
      openSettings(); e.preventDefault(); return;
    }
    if (cmd && (e.key === 't' || e.key === 'T')) {
      openStyleSettings(); e.preventDefault(); return;
    }
    if (cmd && (e.key === 'l' || e.key === 'L')) {
      toggleTheme(); e.preventDefault(); return;
    }
    if (cmd && (e.key === 'f' || e.key === 'F') && !inField) {
      // Focus the file browser filter
      const s = $('#fb-search');
      if (s) { s.focus(); s.select(); e.preventDefault(); }
      return;
    }
    if (cmd && (e.key === 'r' || e.key === 'R')) {
      // Refresh quota
      refreshQuota(); toast('Quota refreshed.', 'ok', 1500); e.preventDefault(); return;
    }
  });
}

function assignTabFormIds(tabKey) {
  const root = $(`#tab-${tabKey}`);
  if (!root) return;
  const seen = new Set();
  let n = 0;
  for (const row of root.querySelectorAll('.row')) {
    const labelText = row.querySelector('label')?.textContent?.trim()?.split('\n')[0]?.trim() || `field_${n}`;
    let slug = slugifyLabel(labelText);
    let baseId = `${tabKey}.${slug}`;
    let suffix = 0;
    while (seen.has(baseId)) { suffix++; baseId = `${tabKey}.${slug}_${suffix}`; }
    seen.add(baseId);
    const all = row.querySelectorAll('input, select, textarea');
    if (all.length > 1) {
      all.forEach((el, i) => { if (!el.id) el.id = `${baseId}.${i}`; });
    } else if (all.length === 1) {
      if (!all[0].id) all[0].id = baseId;
    }
    n++;
  }
}

function applyTabState(tabKey, data) {
  if (!data) return;
  const root = $(`#tab-${tabKey}`);
  if (!root) return;
  for (const inp of root.querySelectorAll('input[id], select[id], textarea[id]')) {
    if (!(inp.id in data)) continue;
    if (inp.type === 'checkbox') inp.checked = data[inp.id] === 'on' || data[inp.id] === true;
    else inp.value = data[inp.id];
    // Re-fire input/change so the UI reacts (e.g. has-custom class for combos)
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function setupTabAutosave(tabKey) {
  const root = $(`#tab-${tabKey}`);
  if (!root) return;
  // Save on any change (input for text, change for select/checkbox)
  root.addEventListener('input', scheduleStateSave, true);
  root.addEventListener('change', scheduleStateSave, true);
}

function _refreshBatchButtons() {
  // For each tab, render the batch controls based on the current queue.
  // Empty queue  → single "Setup Batch Mode" button.
  // Has entries  → "Start BatchGen (N)" + a small "✎" edit button.
  for (const tabKey of ['image', 'speech', 'music', 'video']) {
    const root = $(`#tab-${tabKey}`);
    if (!root) continue;
    const wrap = root.querySelector('[data-batch-controls]');
    if (!wrap) continue;
    const n = (state.batches[tabKey] || []).length;
    wrap.innerHTML = '';
    if (n === 0) {
      // Setup / edit-empty mode: single button
      const setup = el('button', {
        class: 'btn-mini batch-setup',
        onclick: () => openBatchManager(tabKey),
      }, 'Setup Batch Mode');
      wrap.appendChild(setup);
    } else {
      // Populated mode: "Start BatchGen (N)" + small ✎ edit button
      const start = el('button', {
        class: 'batch-start',
        onclick: () => startBatchGen(tabKey),
      }, `▶ Start BatchGen (${n})`);
      const edit = el('button', {
        class: 'btn-mini batch-edit',
        title: 'Edit batch entries',
        onclick: () => openBatchManager(tabKey),
      }, '✎');
      wrap.append(start, edit);
    }
  }
}

function openStyleSettings(returnToTab) {
  showModal((m, close) => {
    m.appendChild(el('h2', {}, 'Style Settings'));
    m.appendChild(el('p', { style: 'color: var(--fg-2); font-size: 12px; margin-top: 0;' },
      'Stored in config.txt → [styles] section. Each preset is prepended (with a comma) to your manual prompt. Example: a preset "Pixel Art Berlin" with value "Pixel art, neon red lighting" + manual input "Berliner Straßenkiller" → "Pixel art, neon red lighting, Berliner Straßenkiller".'));

    const ul = el('ul', { class: 'style-list' });
    function renderList() {
      ul.innerHTML = '';
      const styles = state.config.styles || [];
      if (!styles.length) {
        ul.appendChild(el('li', { class: 'empty-row' }, 'No styles yet. Add one below, or click "Save current as style".'));
        return;
      }
      styles.forEach((s, i) => {
        const actions = el('div', { class: 'sactions' }, [
          el('button', { class: 'btn-mini', onclick: () => { editStyle(i, returnToTab); } }, '✎'),
          el('button', { class: 'btn-mini danger', onclick: () => { deleteStyle(i, () => { renderList(); }); } }, '✕'),
        ]);
        const li = el('li', {}, [
          el('div', {}, [
            el('div', { class: 'sname' }, s.name),
            el('div', { class: 'sval' }, s.value),
          ]),
          actions,
        ]);
        ul.appendChild(li);
      });
    }
    renderList();
    m.appendChild(ul);

    // New / Edit form
    const editingIdx = { value: -1 };
    const nameInput = el('input', { type: 'text', placeholder: 'Style name (e.g. "Pixel Art Berlin")' });
    const valInput = el('textarea', { placeholder: 'Style value — the text that gets prepended to your prompt (e.g. "Pixel art, neon red lighting, dramatic shadows")' });
    valInput.style.minHeight = '70px';
    const formHeader = el('h3', { style: 'margin: 14px 0 6px; font-size: 13px;' }, 'Add / edit style');
    m.appendChild(formHeader);
    m.appendChild(el('div', { class: 'row' }, [el('label', {}, 'Name'), nameInput]));
    m.appendChild(el('div', { class: 'row' }, [el('label', {}, 'Value (prepended to your prompt)'), valInput]));

    function editStyle(i, tabKey) {
      const s = (state.config.styles || [])[i];
      if (!s) return;
      editingIdx.value = i;
      nameInput.value = s.name;
      valInput.value = s.value;
      // jump to the right tab to remind the user which context
      if (tabKey && tabKey !== state.currentTab) showTab(tabKey);
      nameInput.focus();
    }
    function deleteStyle(i, after) {
      const styles = state.config.styles || [];
      if (i < 0 || i >= styles.length) return;
      const removed = styles.splice(i, 1)[0];
      persistStyles().then(() => { _refreshAllStyleDropdowns(); after && after(); toast(`Removed "${removed.name}".`, 'ok'); });
    }
    async function persistStyles() {
      state.config.styles = state.config.styles || [];
      await window.api.setConfig(state.config);
    }

    const saveBtn = el('button', { class: 'primary' }, 'Save style');
    const saveCurrentBtn = el('button', {}, 'Save current prompt as style…');
    const cancelBtn = el('button', { onclick: close }, 'Close');

    saveBtn.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      const value = valInput.value.trim();
      if (!name) { toast('Name is required.', 'warn'); return; }
      if (!value) { toast('Value is required.', 'warn'); return; }
      // Reject names that contain '=' — the config.txt format uses the first
      // '=' on each line to split name/value, so a name with '=' would
      // silently break the round-trip.
      if (name.includes('=')) {
        toast('Style name cannot contain "=" (would break config parsing).', 'err');
        return;
      }
      const styles = state.config.styles || [];
      if (editingIdx.value >= 0) styles[editingIdx.value] = { name, value };
      else {
        // de-dupe by name
        const existing = styles.findIndex((s) => s.name === name);
        if (existing >= 0) {
          if (!confirm(`A style named "${name}" already exists. Overwrite?`)) return;
          styles[existing] = { name, value };
        } else {
          styles.push({ name, value });
        }
      }
      editingIdx.value = -1;
      nameInput.value = '';
      valInput.value = '';
      await persistStyles();
      _refreshAllStyleDropdowns();
      renderList();
      toast('Style saved.', 'ok');
    });

    saveCurrentBtn.addEventListener('click', () => {
      const current = _currentManualText();
      if (!current) { toast('Current tab has no manual prompt text to save.', 'warn'); return; }
      // suggest a name from the first few words
      const suggested = current.split(/[,\.\n]/)[0].trim().slice(0, 40) || `Style ${Date.now()}`;
      nameInput.value = suggested;
      valInput.value = current;
      nameInput.focus();
      nameInput.select();
    });

    m.appendChild(el('div', { class: 'footer' }, [cancelBtn, saveCurrentBtn, saveBtn]));
  });
}


function slugifyLabel(s) {
  return String(s || '').toLowerCase().replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'field';
}

function scheduleStateSave() {
  if (_suppressStateSave > 0) return;
  clearTimeout(_stateSaveTimer);
  _stateSaveTimer = setTimeout(saveAllStates, 500);
}

// batch save state (used by scheduleStateSave)
let _suppressStateSave = 0;
let _stateSaveTimer = null;
function saveAllStates() {
  for (const tabKey of ['image', 'speech', 'music', 'video']) {
    const root = $('#tab-' + tabKey);
    if (!root) continue;
    const data = state.tabSettings[tabKey] || (state.tabSettings[tabKey] = {});
    for (const inp of root.querySelectorAll('input[id], select[id], textarea[id]')) {
      data[inp.id] = inp.type === 'checkbox' ? (inp.checked ? 'on' : '') : inp.value;
    }
  }
  state.batches = state.batches || { image: [], speech: [], music: [], video: [] };
  if (window.api && typeof window.api.stateSet === 'function') {
    window.api.stateSet({
      currentTab: state.currentTab,
      fbDirs: state.fbDirs,
      upscaleEnabled: state.upscaleEnabled,
      upscaleSettings: state.upscaleSettings,
      tabs: state.tabSettings,
    }).catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch((e) => { console.error(e); toast(String(e), 'err', 8000); });
});

