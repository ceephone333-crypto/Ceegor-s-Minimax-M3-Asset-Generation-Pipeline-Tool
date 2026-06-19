// renderer/sections/section03_Settings_tab_panes.js (Phase 3 Block 29)
// Extracted: Settings tab panes
// Source: app.js L4336..4701

// ----------------- Settings tab panes -----------------
// Each pane factory returns { root, instance }. The `instance`
// object carries a `collect()` method that returns the pane's
// pending changes as a partial config object — the parent
// `openSettings()` merges these into one setConfig call so the
// save button works regardless of which tab the user is on.
//
// Panes that have no pending state (e.g. Shortcuts) return
// { root, instance: null }.

function buildSettingsGeneralPane() {
  // API key (with reveal toggle), output dir, region, theme.
  const root = el('div', {});
  const apiKeyRow = showRevealableKey(state.config.api_key || '', {
    placeholder: 'sk-cp-xxxxxxxx  (or your PAYG key)',
    label: 'API key',
  });
  try {
    const lbl = apiKeyRow.row.querySelector('label');
    if (lbl) lbl.appendChild(helpButton('settings.apiKey'));
  } catch (_) {}
  const outInput = el('input', { type: 'text', value: state.config.output_dir || '', placeholder: '(default: ./generated/)' });
  const regInput = el('select', {});
  for (const r of ['global', 'cn']) regInput.appendChild(el('option', { value: r }, r));
  regInput.value = state.config.region || 'global';
  const themeSel = el('select', {});
  for (const [val, lbl] of [['dark', 'Dark'], ['light', 'Light']]) themeSel.appendChild(el('option', { value: val }, lbl));
  themeSel.value = state.theme || state.config.theme || 'dark';

  root.appendChild(apiKeyRow.row);
  root.appendChild(el('div', { class: 'row' }, [
    el('label', {}, ['Output directory', helpButton('settings.outputDir')]),
    el('div', { class: 'combo' }, [outInput, el('button', { class: 'btn-mini', onclick: async () => { const p = await window.api.pickFolder(); if (p) outInput.value = p; } }, 'Browse…')]),
  ]));
  root.appendChild(el('div', { class: 'row' }, [el('label', {}, ['Region', helpButton('settings.region')]), regInput]));
  root.appendChild(el('div', { class: 'row' }, [el('label', {}, ['Theme', helpButton('settings.theme')]), themeSel]));

  // Connection-test row (same behaviour as the old inline
  // buttons). Pushed to the bottom of the pane so the main
  // fields are visible without scrolling.
  const test = el('button', { class: 'btn-mini' }, 'Test connection');
  const diag = el('button', { class: 'btn-mini' }, 'Diagnose');
  test.addEventListener('click', async () => {
    test.disabled = true; test.innerHTML = '<span class="spinner"></span> Testing…';
    const r = await window.api.authStatus();
    test.disabled = false; test.textContent = 'Test connection';
    if (r.ok) {
      toast((r.message || 'Authentication OK.') + (r.command ? `  (via ${r.command})` : ''), 'ok', 4000);
    } else {
      toast('Auth failed: ' + (r.error || 'unknown error'), 'err', 6000);
    }
  });
  diag.addEventListener('click', () => { showDiagnose(); });
  root.appendChild(el('div', { class: 'settings-pane-actions' }, [test, diag]));

  // Config-file path row (read-only, shows the user where
  // the file lives on disk so they can back it up).
  const cp = el('div', { class: 'row' }, [el('label', {}, 'Config file'), el('input', { type: 'text', value: '', readonly: '' })]);
  root.appendChild(cp);
  window.api.configPath().then((p) => { cp.querySelector('input').value = p; });

  return {
    root,
    instance: {
      collect() {
        return {
          api_key: apiKeyRow.getValue().trim(),
          output_dir: outInput.value.trim(),
          region: regInput.value || 'global',
          theme: themeSel.value || 'dark',
        };
      },
    },
  };
}

function buildSettingsImagePane() {
  // Image pipeline: Real-ESRGAN upscaler status + model
  // selector, and (in a future change) IS-Net background-
  // removal status. Wrapped in a single scrollable section so
  // the pane layout matches the General pane.
  const root = el('div', {});
  root.appendChild(el('p', { style: 'color: var(--fg-2); font-size: 12px; margin-top: 0;' },
    'The built-in pipeline is always available. Real-ESRGAN (BSD-3-Clause) gives noticeably better detail when the binary is installed.'));

  // ---- Real-ESRGAN status ----
  const statusText = el('div', { class: 're-status' }, 'Detecting…');
  const reBtn = el('button', { class: 'btn-mini' }, '🔄 Re-detect');
  const installBtnStatus = el('button', { class: 'btn-mini' }, '⬇ Download & install');
  installBtnStatus.style.display = 'none';
  root.appendChild(el('div', { class: 'row' }, [
    el('label', {}, 'Real-ESRGAN upscaler'), statusText, installBtnStatus, reBtn,
  ]));

  // ---- Real-ESRGAN model selector ----
  const modelSel = el('select', {});
  for (const [val, lbl] of [
    ['realesrgan-x4plus', 'realesrgan-x4plus  (general-purpose 4×, default)'],
    ['realesrgan-x4plus-anime', 'realesrgan-x4plus-anime  (anime / illustration)'],
    ['realesrgan-animevideov3', 'realesrgan-animevideov3  (video frames)'],
    ['realesr-general-x4v3', 'realesr-general-x4v3  (latest general, smaller)'],
  ]) {
    const opt = el('option', { value: val }, lbl);
    if (val === (state.realesrganModel || 'realesrgan-x4plus')) opt.selected = true;
    modelSel.appendChild(opt);
  }
  modelSel.addEventListener('change', () => {
    state.realesrganModel = modelSel.value;
    scheduleStateSave();
  });
  root.appendChild(el('div', { class: 'row' }, [
    el('label', {}, 'Upscale model'), modelSel,
  ]));

  // ---- One-click installer ----
  const installBtn = el('button', { class: 'btn-mini' }, '⬇ Download Real-ESRGAN');
  const installProgress = el('div', { class: 're-progress' });
  installProgress.style.display = 'none';
  installProgress.style.color = 'var(--fg-2)';
  installProgress.style.fontSize = '12px';
  root.appendChild(el('div', { class: 'row' }, [
    el('label', {}, 'One-click install'),
    el('div', { style: 'display: flex; gap: 8px; align-items: center; flex-wrap: wrap;' }, [installBtn, installProgress]),
  ]));

  async function refreshStatus() {
    statusText.textContent = 'Detecting…';
    try {
      const r = await window.api.realesrganAvailable();
      if (r && r.available) {
        const v = r.version ? '  (v' + r.version + ')' : '';
        statusText.textContent = 'Detected: ' + (r.binaryPath || '') + v;
        statusText.style.color = 'var(--success)';
        installBtnStatus.style.display = 'none';
      } else {
        statusText.textContent = 'Not found. Click "Download & install" to add it to ./bin/ automatically.';
        statusText.style.color = 'var(--fg-2)';
        installBtnStatus.style.display = '';
      }
    } catch (e) {
      statusText.textContent = 'Probe failed: ' + (e.message || e);
      statusText.style.color = 'var(--danger)';
      installBtnStatus.style.display = '';
    }
  }
  reBtn.addEventListener('click', () => { refreshStatus(); });
  refreshStatus();

  async function runInstall() {
    installBtn.disabled = true;
    reBtn.disabled = true;
    installBtnStatus.disabled = true;
    installProgress.style.display = '';
    installProgress.textContent = 'Starting download…';
    const offProgress = window.api.onRealesrganDownloadProgress((data) => {
      if (data.phase === 'download') {
        if (data.total > 0) {
          const pct = (data.downloaded / data.total) * 100;
          const mb = (data.downloaded / 1024 / 1024).toFixed(1);
          const totalMb = (data.total / 1024 / 1024).toFixed(1);
          installProgress.textContent = `Downloading… ${mb} / ${totalMb} MB (${pct.toFixed(0)}%)`;
        } else {
          installProgress.textContent = 'Downloading…';
        }
      } else if (data.phase === 'extract') {
        installProgress.textContent = 'Extracting…';
      } else if (data.phase === 'done') {
        installProgress.textContent = 'Done. Refreshing status…';
      }
    });
    try {
      const r = await window.api.realesrganDownload();
      offProgress();
      if (r && r.ok) {
        installProgress.textContent = 'Installed to ' + (r.binDir || './bin') + '. Re-detecting…';
        await refreshStatus();
      } else {
        installProgress.textContent = 'Download failed: ' + ((r && r.error) || 'unknown');
        installProgress.style.color = 'var(--danger)';
      }
    } catch (e) {
      offProgress();
      installProgress.textContent = 'Download failed: ' + (e && e.message || e);
      installProgress.style.color = 'var(--danger)';
    } finally {
      installBtn.disabled = false;
      reBtn.disabled = false;
      installBtnStatus.disabled = false;
    }
  }
  installBtn.addEventListener('click', runInstall);
  installBtnStatus.addEventListener('click', runInstall);

  // ---- Optional add-ons link (opens the addons popup so the
  // user can install IS-Net + the model file). Kept as a
  // separate popup because the addons install can stream
  // progress for minutes; embedding it in the settings pane
  // would freeze the rest of the dialog. ----
  const openAddonsBtn = el('button', { class: 'btn-mini' }, '🧩 Open add-ons installer');
  openAddonsBtn.addEventListener('click', () => openOptionalAddons({ force: true }).catch(() => {}));
  root.appendChild(el('div', { class: 'row' }, [
    el('label', {}, 'Optional add-ons'),
    openAddonsBtn,
  ]));

  // The pane does not modify config.txt directly — its writes
  // go to state.json (realesrganModel), so collect() returns
  // an empty object. The save button still works.
  return { root, instance: { collect: () => ({}) } };
}

function buildSettingsStylesPane() {
  // The style-presets pane shows the existing list with
  // add/edit/delete + the "Save current prompt as style"
  // button. Implemented as a thin wrapper that calls the
  // existing openStyleSettings() modal — but here we render
  // the same UI inline so the user doesn't have to dismiss a
  // second modal to save settings.
  const root = el('div', {});
  root.appendChild(el('p', { style: 'color: var(--fg-2); font-size: 12px; margin-top: 0;' },
    'Style presets are short text snippets (a genre, mood, camera hint) that get prepended to every prompt so you can keep the same look across many generations without retyping.'));

  // Render the list
  const list = el('ul', { class: 'style-list' });
  function renderList() {
    list.innerHTML = '';
    const styles = state.config.styles || [];
    if (!styles.length) {
      list.appendChild(el('li', { class: 'empty-row' }, 'No styles yet. Add one below, or click "Save current prompt as style".'));
      return;
    }
    styles.forEach((s, i) => {
      const actions = el('div', { class: 'sactions' }, [
        el('button', { class: 'btn-mini', onclick: () => { editStyle(i); } }, '✎'),
        el('button', { class: 'btn-mini danger', onclick: () => { deleteStyle(i, () => { renderList(); }); } }, '✕'),
      ]);
      list.appendChild(el('li', {}, [
        el('div', {}, [
          el('div', { class: 'sname' }, s.name),
          el('div', { class: 'sval' }, s.value),
        ]),
        actions,
      ]));
    });
  }
  renderList();
  root.appendChild(list);

  const nameInput = el('input', { type: 'text', placeholder: 'Style name (e.g. "Pixel Art Berlin")' });
  const valInput = el('textarea', { placeholder: 'Style value — the text that gets prepended to your prompt (e.g. "Pixel art, neon red lighting, dramatic shadows")' });
  valInput.style.minHeight = '70px';
  const editingIdx = { value: -1 };
  root.appendChild(el('div', { class: 'row' }, [el('label', {}, 'Name'), nameInput]));
  root.appendChild(el('div', { class: 'row' }, [el('label', {}, 'Value (prepended to your prompt)'), valInput]));

  function editStyle(i) {
    const s = (state.config.styles || [])[i];
    if (!s) return;
    editingIdx.value = i;
    nameInput.value = s.name;
    valInput.value = s.value;
  }
  // (deleteStyle is shared with the standalone popup — it
  // already calls persistStyles on the renderer's state.)
  const saveBtn = el('button', { class: 'btn-mini' }, '💾 Save style');
  const saveCurrentBtn = el('button', { class: 'btn-mini' }, '✚ Save current prompt as style…');
  saveBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    const value = valInput.value.trim();
    if (!name) { toast('Name is required.', 'warn'); return; }
    if (!value) { toast('Value is required.', 'warn'); return; }
    if (name.includes('=')) { toast('Style name cannot contain "=" (would break config parsing).', 'err'); return; }
    const styles = state.config.styles || [];
    if (editingIdx.value >= 0) styles[editingIdx.value] = { name, value };
    else styles.push({ name, value });
    await persistStyles();
    _refreshAllStyleDropdowns();
    renderList();
    toast(`Saved "${name}".`, 'ok');
    nameInput.value = ''; valInput.value = '';
    editingIdx.value = -1;
  });
  saveCurrentBtn.addEventListener('click', () => {
    // Pull the active tab's manual prompt into the value
    // field. The standalone popup does the same.
    const cur = _currentManualText();
    if (!cur) { toast('Active tab has no prompt to save.', 'warn'); return; }
    valInput.value = cur;
    if (!nameInput.value.trim()) nameInput.value = 'My style';
    nameInput.focus();
  });
  root.appendChild(el('div', { class: 'settings-pane-actions' }, [saveBtn, saveCurrentBtn]));

  return { root, instance: null /* styles persist immediately on save */ };
}

function buildSettingsPopupsPane() {
  // Popups policy + reset history (was the standalone popup).
  const root = el('div', {});
  root.appendChild(el('p', { style: 'color: var(--fg-2); font-size: 12px; margin-top: 0;' },
    'Control how often the optional popups appear: the welcome screen on every fresh launch, the first-time setup, the optional add-ons installer, and the per-tab intro messages.'));

  const polSel = el('select', { class: 'popup-policy-select' });
  for (const [val, lbl] of [
    ['once-fresh',  'Show once to fresh users, then never (default)'],
    ['per-session', 'Show first time each app start'],
    ['never',       'Never show these popups'],
    ['always',      'Always show (even after dismissal)'],
  ]) polSel.appendChild(el('option', { value: val }, lbl));
  polSel.value = state.popupPolicy || 'once-fresh';
  polSel.addEventListener('change', () => { state.popupPolicy = polSel.value; scheduleStateSave(); });
  root.appendChild(el('div', { class: 'row' }, [
    el('label', {}, ['Popup behaviour', helpButton('settings.popupPolicy')]),
    polSel,
  ]));

  const resetBtn = el('button', { class: 'btn-mini' }, '🔄 Reset popup history');
  resetBtn.addEventListener('click', async () => {
    if (!confirm('Reset all popup "seen" history? Every popup will fire again the next time it is triggered (until you dismiss it).')) return;
    resetPopupSeen();
    toast('Popup history reset.', 'ok');
    refreshSeenCount();
  });
  const seenSpan = el('span', { style: 'color: var(--fg-3); font-size: 11px;' }, '');
  function refreshSeenCount() {
    const seenCount = (state.seenPopups && typeof state.seenPopups === 'object') ? Object.keys(state.seenPopups).length : 0;
    seenSpan.textContent = `Currently remembers ${seenCount} popup${seenCount === 1 ? '' : 's'} as seen.`;
  }
  refreshSeenCount();
  root.appendChild(el('div', { class: 'row' }, [
    el('label', {}, 'Reset'),
    el('div', { style: 'display: flex; gap: 8px; align-items: center;' }, [resetBtn, seenSpan]),
  ]));

  return { root, instance: { collect: () => ({}) /* popupPolicy lives in state.json */ } };
}

function buildSettingsShortcutsPane() {
  // Read-only keyboard shortcut reference. Lives in the
  // settings dialog so the user doesn't have to dig through
  // the README.
  const root = el('div', {});
  root.appendChild(el('p', { style: 'color: var(--fg-2); font-size: 12px; margin-top: 0;' },
    'Keyboard shortcuts work from anywhere in the app (no need to click into a specific tab first).'));
  const box = el('div', { class: 'shortcuts-box' });
  box.appendChild(el('h4', {}, '⌨ Keyboard shortcuts'));
  const shortcuts = [
    ['Ctrl+Enter', 'Generate on the active tab'],
    ['Ctrl+1 / 2 / 3 / 4', 'Switch to Image / Speech / Music / Video'],
    ['Ctrl+B', 'Open BatchGen for the active tab'],
    ['Ctrl+T', 'Open Style Settings (also in Settings → Style presets)'],
    ['Ctrl+S', 'Open this Settings dialog'],
    ['Ctrl+L', 'Toggle dark / light mode'],
    ['Ctrl+F', 'Focus the file-browser filter'],
    ['Ctrl+R', 'Refresh quota'],
  ];
  for (const [keys, desc] of shortcuts) {
    box.appendChild(el('div', { class: 'shortcut-row' }, [
      el('kbd', {}, keys),
      el('span', {}, desc),
    ]));
  }
  root.appendChild(box);
  return { root, instance: null };
}

