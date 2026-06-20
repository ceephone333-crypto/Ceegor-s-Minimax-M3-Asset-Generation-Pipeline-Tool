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
  // v1.1.14 (reported by user): the General pane used to be
  // a flat list of 5 fields in declaration order. The user
  // found it confusing — "where do I start?" / "is theme
  // more important than region?" — because nothing told them
  // what each field was FOR. The new layout groups the fields
  // into 4 sections in a fixed top-to-bottom reading order,
  // each preceded by a small uppercase section header so the
  // pane reads like a checklist:
  //   1. Authentication  (you cannot generate anything without this)
  //   2. Storage         (where every generated file lands)
  //   3. Generation defaults (region / theme — both have safe defaults)
  //   4. Diagnostics     (read-only info + ad-hoc test buttons)
  const root = el('div', {});
  root.appendChild(el('p', { style: 'color: var(--fg-2); font-size: 12px; margin: 0 0 8px;' },
    'Your core settings — the tool needs (1) a working API key and (2) an output folder before it can generate anything. The rest has safe defaults.'));

  // ---- Section 1: Authentication ----
  root.appendChild(el('h4', { class: 'settings-group-title' }, '🔐 Authentication'));
  const apiKeyRow = showRevealableKey(state.config.api_key || '', {
    placeholder: 'sk-cp-xxxxxxxx  (or your PAYG key)',
    label: 'API key',
  });
  try {
    const lbl = apiKeyRow.row.querySelector('label');
    if (lbl) lbl.appendChild(helpButton('settings.apiKey'));
  } catch (_) {}
  // v1.1.13 (reported by user): "Don't save" checkbox on the
  // API-key row. When checked, the entered key is kept in
  // memory (so the current session works) but is NOT written
  // to config.txt on Save, and the next launch starts with an
  // empty key (the user re-enters it). When unchecked,
  // behaviour is unchanged — the key persists across
  // restarts.
  const noSaveCb = el('input', {
    type: 'checkbox',
    class: 'api-key-no-save',
    id: 'api-key-no-save',
  });
  noSaveCb.checked = !!state.apiKeyNoSave;
  const noSaveRow = el('div', { class: 'row api-key-no-save-row' }, [
    el('label', { for: 'api-key-no-save', class: 'api-key-no-save-label' }, [
      noSaveCb,
      el('span', {}, [
        el('strong', {}, "Don't save"),
        '  — key is used this session only, never written to config.txt. Re-enter on next start.',
        helpButton('settings.apiKeyNoSave'),
      ]),
    ]),
  ]);
  function syncNoSaveStyle() {
    apiKeyRow.input.classList.toggle('api-key-no-save-active', noSaveCb.checked);
  }
  noSaveCb.addEventListener('change', () => {
    state.apiKeyNoSave = noSaveCb.checked;
    syncNoSaveStyle();
  });
  syncNoSaveStyle();
  root.appendChild(apiKeyRow.row);
  root.appendChild(noSaveRow);

  // ---- Section 2: Storage ----
  root.appendChild(el('h4', { class: 'settings-group-title' }, '📁 Storage'));
  const outInput = el('input', { type: 'text', value: state.config.output_dir || '', placeholder: '(default: ./generated/)' });
  root.appendChild(el('div', { class: 'row' }, [
    el('label', {}, ['Output directory', helpButton('settings.outputDir')]),
    el('div', { class: 'combo' }, [outInput, el('button', { class: 'btn-mini', onclick: async () => { const p = await window.api.pickFolder(); if (p) outInput.value = p; } }, 'Browse…')]),
  ]));
  const cp = el('div', { class: 'row' }, [el('label', {}, ['Config file location', helpButton('settings.configFile')]), el('input', { type: 'text', value: '', readonly: '', title: 'Where config.txt (api_key, output_dir, region, styles) is stored on disk' })]);
  root.appendChild(cp);
  window.api.configPath().then((p) => { cp.querySelector('input').value = p; });

  // ---- Section 3: Generation defaults ----
  root.appendChild(el('h4', { class: 'settings-group-title' }, '🌐 Generation defaults'));
  const regInput = el('select', {});
  for (const r of ['global', 'cn']) regInput.appendChild(el('option', { value: r }, r));
  regInput.value = state.config.region || 'global';
  root.appendChild(el('div', { class: 'row' }, [el('label', {}, ['Region', helpButton('settings.region')]), regInput]));
  const themeSel = el('select', {});
  for (const [val, lbl] of [['dark', 'Dark'], ['light', 'Light']]) themeSel.appendChild(el('option', { value: val }, lbl));
  themeSel.value = state.theme || state.config.theme || 'dark';
  root.appendChild(el('div', { class: 'row' }, [el('label', {}, ['Theme', helpButton('settings.theme')]), themeSel]));

  // ---- Section 4: Diagnostics ----
  root.appendChild(el('h4', { class: 'settings-group-title' }, '🔧 Diagnostics'));
  root.appendChild(el('p', { style: 'color: var(--fg-3); font-size: 11.5px; margin: 4px 0 8px;' },
    'Ad-hoc tools. They do not change any setting — they just probe the current state (auth status, mmx binary path, etc.).'));
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

  return {
    root,
    instance: {
      collect() {
        return {
          api_key: noSaveCb.checked ? '' : apiKeyRow.getValue().trim(),
          _apiKeyNoSave: noSaveCb.checked,
          _apiKeyValue: noSaveCb.checked ? apiKeyRow.getValue().trim() : '',
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
  //
  // v1.1.14 (reported by user): the pane was a flat list of
  // 6 rows with no visual grouping — the user couldn't tell
  // which rows were "status" vs "controls" vs "installers".
  // The new layout uses the same .settings-group-title pattern
  // as General / BatchGen so the pane reads like a checklist:
  //   1. Status (read-only)
  //   2. Upscale model (control)
  //   3. Installation (one-click + add-ons link)
  const root = el('div', {});
  root.appendChild(el('p', { style: 'color: var(--fg-2); font-size: 12px; margin: 0 0 8px;' },
    'Local image pipeline. The built-in multi-step pipeline always works (no install). Real-ESRGAN (BSD-3-Clause) + IS-Net (MIT) are optional quality upgrades.'));

  // ---- Section 1: Status ----
  root.appendChild(el('h4', { class: 'settings-group-title' }, '📊 Status'));
  const statusText = el('div', { class: 're-status' }, 'Detecting…');
  const reBtn = el('button', { class: 'btn-mini' }, '🔄 Re-detect');
  root.appendChild(el('div', { class: 'row' }, [
    el('label', {}, ['Real-ESRGAN', helpButton('settings.upscale')]), statusText, reBtn,
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
  // ---- Section 2: Upscale model ----
  root.appendChild(el('h4', { class: 'settings-group-title' }, '🔍 Upscale model'));
  root.appendChild(el('p', { class: 'meta', style: 'color: var(--fg-2); font-size: 12px; margin: 4px 0 8px;' },
    'Which Real-ESRGAN model to use when the upscale post-processing step runs. Change this if you primarily generate a specific style.'));
  root.appendChild(el('div', { class: 'row' }, [
    el('label', {}, 'Upscale model'), modelSel,
  ]));

  // ---- Section 3: Installation ----
  root.appendChild(el('h4', { class: 'settings-group-title' }, '📥 Installation'));
  root.appendChild(el('p', { class: 'meta', style: 'color: var(--fg-2); font-size: 12px; margin: 4px 0 8px;' },
    'Install or replace the optional binaries. The Real-ESRGAN download streams progress below; the add-ons installer covers IS-Net (binary + ONNX model) plus manual install paths.'));

  // ---- One-click installer ----
  const installBtn = el('button', { class: 'btn-mini' }, '⬇ Download Real-ESRGAN');
  const installBtnStatus = el('button', { class: 'btn-mini' }, '⬇ Install (when missing)');
  installBtnStatus.style.display = 'none';
  const installProgress = el('div', { class: 're-progress' });
  installProgress.style.display = 'none';
  installProgress.style.color = 'var(--fg-2)';
  installProgress.style.fontSize = '12px';
  root.appendChild(el('div', { class: 'row' }, [
    el('label', {}, 'One-click install'),
    el('div', { style: 'display: flex; gap: 8px; align-items: center; flex-wrap: wrap;' }, [installBtn, installBtnStatus, installProgress]),
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
    el('label', {}, ['Optional add-ons', helpButton('settings.optionalAddons')]),
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
  // v1.1.14: two logical sections — Behaviour (the dropdown)
  // and Reset (the destructive action). Same .settings-group-
  // title pattern as General / BatchGen so the whole settings
  // dialog reads consistently.
  const root = el('div', {});
  root.appendChild(el('p', { style: 'color: var(--fg-2); font-size: 12px; margin: 0 0 8px;' },
    'Control how often the optional popups appear: the welcome screen, the first-time setup, the optional add-ons installer, and the per-tab intro messages.'));

  // ---- Section 1: Behaviour ----
  root.appendChild(el('h4', { class: 'settings-group-title' }, '💬 Behaviour'));
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

  // ---- Section 2: Reset ----
  root.appendChild(el('h4', { class: 'settings-group-title' }, '🔄 Reset'));
  root.appendChild(el('p', { class: 'meta', style: 'color: var(--fg-2); font-size: 12px; margin: 4px 0 8px;' },
    'Force every dismissed popup to fire again on its next trigger. Useful while you\'re still learning the tool.'));
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
    el('label', {}, 'Reset history'),
    el('div', { style: 'display: flex; gap: 8px; align-items: center;' }, [resetBtn, seenSpan]),
  ]));

  return { root, instance: { collect: () => ({}) /* popupPolicy lives in state.json */ } };
}

function buildSettingsBatchgenPane() {
  // v1.1.13 (reported by user): settings for the BatchGen
  // feature. The previous version hard-wrote BOTH a .md and a
  // .txt example file every time the user clicked the "Gen
  // Examples" button on the BatchGen controls. The user
  // wanted to choose the format so they don't get a folder
  // with two files when they only need one. The format is
  // chosen here and used by batchesGenerateExamples (both
  // the renderer + the main-process IPC).
  //
  // v1.1.14 (reported by user): added an opt-out switch for
  // the "auto-remove completed items" behaviour (which is now
  // the default — see startBatchGen() in batchManager.js for
  // the per-item splice logic).
  const root = el('div', {});
  root.appendChild(el('p', { style: 'color: var(--fg-2); font-size: 12px; margin-top: 0;' },
    'Settings for BatchGen — the bulk runner that executes every prompt/text you queue in the per-tab batch editors. Each setting below controls a behaviour that affects every batch run (per tab + the all-types runner).'));

  // ---- Group 1: Example export format ----
  root.appendChild(el('h4', { class: 'settings-group-title' }, '📋 Example export'));
  root.appendChild(el('p', { class: 'meta', style: 'color: var(--fg-2); font-size: 12px; margin: 4px 0 8px;' },
    'The "Gen Examples" button (next to "BatGen All Types") writes a template you can hand to an AI to generate a batch import file. Pick whichever single format you actually use.'));

  const fmtSel = el('select', { class: 'batches-export-format-select' });
  for (const [val, lbl] of [
    ['md',  '📝 Markdown (.md) — AI-friendly table with header rows (recommended)'],
    ['txt', '📄 Plain text (.txt) — pipe-separated rows, no formatting'],
  ]) fmtSel.appendChild(el('option', { value: val }, lbl));
  fmtSel.value = state.batchesExportFormat || 'md';
  // Apply immediately on change so the next click on "Gen
  // Examples" uses the new format even if the user doesn't
  // hit Save in the meantime. scheduleStateSave persists the
  // pick to state.json so a restart uses the same format.
  fmtSel.addEventListener('change', () => {
    state.batchesExportFormat = fmtSel.value;
    scheduleStateSave();
  });
  root.appendChild(el('div', { class: 'row' }, [
    el('label', {}, ['Example export format', helpButton('settings.batchesExportFormat')]),
    fmtSel,
  ]));

  // ---- Group 2: Auto-remove behaviour ----
  root.appendChild(el('h4', { class: 'settings-group-title', style: 'margin-top: 18px;' }, '🧹 Queue cleanup'));
  root.appendChild(el('p', { class: 'meta', style: 'color: var(--fg-2); font-size: 12px; margin: 4px 0 8px;' },
    'After a batch item finishes generating, what should happen to the entry in the BatchGen list? Default behaviour is to remove it (so the list always reflects only upcoming work); failed items are NEVER removed — you decide whether to retry or skip them.'));

  const autoRemoveCb = el('input', {
    type: 'checkbox',
    class: 'batches-auto-remove-cb',
    id: 'batches-auto-remove-cb',
  });
  autoRemoveCb.checked = state.batchesAutoRemove !== false;  // default true
  autoRemoveCb.addEventListener('change', () => {
    state.batchesAutoRemove = autoRemoveCb.checked;
    scheduleStateSave();
  });
  root.appendChild(el('div', { class: 'row batches-auto-remove-row' }, [
    el('label', { for: 'batches-auto-remove-cb' }, [
      autoRemoveCb,
      el('span', {}, [
        el('strong', {}, 'Auto-remove completed items'),
        '  — each successful generation is removed from the BatchGen list immediately. Failed items stay until you decide.',
        helpButton('settings.batchesAutoRemove'),
      ]),
    ]),
  ]));

  return {
    root,
    instance: {
      collect() {
        // Both batchesExportFormat and batchesAutoRemove live
        // in state.json (persisted via scheduleStateSave on
        // change), not in config.txt — so the collect() returns
        // an empty partial and the Save handler merges state
        // JSON + config in-place without re-writing these.
        return {};
      },
    },
  };
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

