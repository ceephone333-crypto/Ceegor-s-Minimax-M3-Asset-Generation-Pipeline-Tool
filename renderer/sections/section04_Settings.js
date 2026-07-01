// renderer/sections/section04_Settings.js (Phase 3 Block 29)
// Extracted: Settings
// Source: app.js L4219..4335

// ----------------- Settings -----------------
// showSettingsAndSwitchTab(tabId) opens the Settings dialog and
// immediately switches to the named tab. Used by the legacy
// standalone helpers (showPopupSettings, showRealesrganSettings)
// that were replaced by inline tabs in the multi-tab layout.
// The function still uses the same `id: 'settings'` slot as
// openSettings() so the modal-stack dedup guarantees we don't
// open two settings dialogs.
function showSettingsAndSwitchTab(tabId) {
  // Close the existing settings dialog (if any) before opening
  // a new one with the requested tab active. We can't just
  // activate the existing dialog's tab from here because the
  // tab buttons live inside its DOM scope.
  for (let i = _modalStack.length - 1; i >= 0; i--) {
    if (_modalStack[i] && _modalStack[i].id === 'settings') {
      try { _modalStack[i].close(); } catch (_) {}
      break;
    }
  }
  openSettings();
  // The modal is rendered synchronously inside openSettings, so
  // the tab buttons are already in the DOM. Find the requested
  // one and click it (which fires the same activateSettingsTab
  // path a real user click would).
  setTimeout(() => {
    const btn = document.querySelector(`.settings-tab-button[data-tab-button="${tabId}"]`);
    if (btn) btn.click();
  }, 0);
}
function openSettings() {
  // Multi-tab settings dialog. The previous version was a
  // single big modal plus two layered modals on top (Real-ESRGAN
  // + Popups) that the user had to dismiss in order. That got
  // messy fast — closing the inner modal left an inconsistent
  // half-saved settings dialog, and the layered stack could
  // trap the focus on the wrong sub-section. The new layout is
  // one modal with a sidebar of tabs (General / Image /
  // Styles / Popups / Shortcuts). Switching tabs swaps the
  // pane content without ever stacking a second modal.
  showModal((m, close) => {
    m.classList.add('settings-modal');
    m.appendChild(el('h2', {}, '⚙ Settings'));
    m.appendChild(el('p', { style: 'color: var(--fg-2); font-size: 12px; margin-top: 0;' },
      'All your settings (API key, output folder, region, theme, styles, image pipeline, popups) are stored in config.txt next to the executable. Your API key is never sent to the cloud by this tool, never embedded in the binary, and is masked in the log pane by default. Click any tab on the left to switch sections.'));

    // Build the tabbed layout. We render all panes up front
    // and toggle a hidden class so switching tabs is instant
    // (no re-render) and any half-filled inputs survive a
    // round trip between tabs.
    const layout = el('div', { class: 'settings-tabs' });
    const sidebar = el('div', { class: 'settings-tabs-sidebar' });
    const paneHost = el('div', { class: 'settings-tabs-panehost' });

    const tabDefs = [
      { id: 'general',  label: '🔑 General',     build: () => buildSettingsGeneralPane() },
      { id: 'image',    label: '🖼 Image',        build: () => buildSettingsImagePane() },
      { id: 'batchgen', label: '📦 BatchGen',     build: () => buildSettingsBatchgenPane() },
      { id: 'styles',   label: '🎨 Style presets', build: () => buildSettingsStylesPane() },
      { id: 'popups',   label: '💬 Popups',        build: () => buildSettingsPopupsPane() },
      { id: 'history',  label: '↻ History',         build: () => buildSettingsHistoryPane() },
      { id: 'shortcuts',label: '⌨ Shortcuts',      build: () => buildSettingsShortcutsPane() },
    ];
    const panes = {};
    const tabButtons = {};
    for (const tdef of tabDefs) {
      const pane = el('div', { class: 'settings-tab-pane', 'data-tab-pane': tdef.id });
      const built = tdef.build();
      pane.appendChild(built.root);
      panes[tdef.id] = { el: pane, instance: built.instance };
      paneHost.appendChild(pane);
      const tabBtn = el('button', { class: 'settings-tab-button', 'data-tab-button': tdef.id, type: 'button' }, tdef.label);
      tabBtn.addEventListener('click', () => activateSettingsTab(tdef.id));
      tabButtons[tdef.id] = tabBtn;
      sidebar.appendChild(tabBtn);
    }
    layout.appendChild(sidebar);
    layout.appendChild(paneHost);
    m.appendChild(layout);

    // Save / cancel buttons act on every pane (whichever is
    // currently visible — we collect pending changes into a
    // single setConfig call on save so config.txt is updated
    // atomically, just like the old single-modal save).
    const saveBtn = el('button', { class: 'primary' }, 'Save');
    const cancelBtn = el('button', { onclick: close }, 'Cancel');
    saveBtn.addEventListener('click', async () => {
      const merged = { ...state.config };
      let apiKeyNoSave = false;
      let apiKeyInMemory = '';
      for (const tdef of tabDefs) {
        const inst = panes[tdef.id].instance;
        if (inst && typeof inst.collect === 'function') {
          const partial = inst.collect();
          // v1.1.13: General pane carries three transient
          // keys (_apiKeyNoSave, _apiKeyValue) that are NOT
          // part of the saved config schema — they're just a
          // channel between the pane and the Save handler. Strip
          // them before setConfig so config.txt stays clean.
          if (partial && typeof partial === 'object') {
            if (typeof partial._apiKeyNoSave === 'boolean') {
              apiKeyNoSave = partial._apiKeyNoSave;
              delete partial._apiKeyNoSave;
            }
            if (typeof partial._apiKeyValue === 'string') {
              apiKeyInMemory = partial._apiKeyValue;
              delete partial._apiKeyValue;
            }
          }
          Object.assign(merged, partial);
        }
      }
      // v1.1.13: when the user checked "Don't save" on the
      // API-key row, strip api_key from `merged` so it never
      // reaches config.txt. The entered value (in
      // apiKeyInMemory) IS assigned to state.config.api_key
      // below so the current session keeps working — only the
      // persisted form is suppressed.
      if (apiKeyNoSave) {
        merged.api_key = '';
      }
      // v1.1.29 (bug-fix A1 + A2): capture the OLD output_dir
      // from the pre-save snapshot (state.config, before the
      // Object.assign(merged, partial) above mutated merged)
      // so the change-detection below can compare the right
      // values. For navigation we also resolve the EFFECTIVE
      // output dir (the actual folder the explorer should land
      // on) — when the user blanks the field, the effective
      // output dir falls back to the platform default
      // (<userData>/generated) and the explorer must follow
      // it. Pre-A1/A2 fix, the explorer was stuck on the OLD
      // folder even when the user had deliberately cleared
      // the field to use the default.
      const oldOut = (state.config && state.config.output_dir) || '';
      // CRITICAL: merge with the current config — do NOT replace it.
      // The previous version of this code built a fresh
      // {api_key,output_dir,region} object which silently dropped
      // `theme` and `styles` on every save. We preserve every
      // unknown key so future config fields aren't wiped.
      const result = await window.api.setConfig(merged);
      // Bug-fix M2 (_temp5.md 360° audit): config:set now returns an
      // envelope `{ ok, config, error }`. A write failure (read-only
      // fs, disk full, permission revoked) used to return `null`,
      // which crashed the next line (`saved.api_key = ...`). Now we
      // branch on ok and show the real error instead of lying
      // "Saved.".
      if (!result || result.ok !== true) {
        const msg = (result && result.error) || 'Could not write config.txt (disk full, read-only, or permission denied).';
        toast('Save failed: ' + msg, 'err', 8000);
        // Still assign the returned (previous) config so state.config
        // stays a valid object — downstream code reads .api_key etc.
        if (result && result.config) state.config = result.config;
        return;
      }
      const saved = result.config;
      // If the user enabled "Don't save" but entered a key,
      // assign it in-memory (state.config.api_key) so the
      // session works, then CLEAR it from the saved config so
      // a subsequent restart starts with an empty key.
      if (apiKeyNoSave && apiKeyInMemory) {
        saved.api_key = apiKeyInMemory;
      }
      state.config = saved;
      state.apiKeyNoSave = !!apiKeyNoSave;
      scheduleStateSave();
      toast('Saved.', 'ok');
      close();
      refreshQuota();
      // v1.1.29: when the user changed output_dir, re-point the
      // file browser at the new folder too — not just refresh
      // the current view. Pre-v1.1.29, the explorer stayed on
      // whatever folder it was showing (often the OLD output_dir
      // or a subfolder of it) so a user who picked a new
      // destination in Settings had to manually click the new
      // path in the explorer to land there. We always navigate
      // to the new output_dir; clear every per-tab saved
      // folder too so a tab switch also lands on the new
      // location.
      //
      // Bug-fix A2: also navigate when the user CLEARED the
      // output_dir field. In that case the new effective
      // output dir is the platform default (<userData>/generated
      // on Windows, per src/config.js#defaultOutputDir) — we
      // resolve it via the same `config:defaultOutputDir` IPC
      // the file browser's last-ditch fallback uses
      // (fileBrowser1.js refreshBrowser). The explorer then
      // follows the user's intent ("use the default") instead
      // of staying on the OLD folder.
      const rawNew = (saved && saved.output_dir) || '';
      const rawOld = oldOut || '';
      const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
      // Resolve the effective dir for the NEW state: if the
      // user blanked the field, ask main for the platform
      // default. We try the IPC synchronously-looking but the
      // result is awaited below.
      const newEffectivePromise = rawNew
        ? Promise.resolve(rawNew)
        : (window.api && typeof window.api.defaultOutputDir === 'function'
            ? window.api.defaultOutputDir().then((d) => d || '').catch(() => '')
            : Promise.resolve(''));
      const oldEffectivePromise = rawOld
        ? Promise.resolve(rawOld)
        : (window.api && typeof window.api.defaultOutputDir === 'function'
            ? window.api.defaultOutputDir().then((d) => d || '').catch(() => '')
            : Promise.resolve(''));
      const [newEffective, oldEffective] = await Promise.all([newEffectivePromise, oldEffectivePromise]);
      if (norm(newEffective) !== norm(oldEffective)) {
        // Prefer the user-supplied path when present (rawNew),
        // else use the resolved default so the explorer lands
        // on the actual folder, not the empty string that would
        // make refreshBrowser() show a "no output dir" error.
        const target = rawNew || newEffective;
        state.fbDir = target;
        if (state.fbDirs) for (const k of Object.keys(state.fbDirs)) state.fbDirs[k] = target;
        scheduleStateSave();
      }
      refreshBrowser();
    });
    m.appendChild(el('div', { class: 'footer settings-footer' }, [cancelBtn, saveBtn]));

    function activateSettingsTab(id) {
      for (const tdef of tabDefs) {
        const isActive = tdef.id === id;
        tabButtons[tdef.id].classList.toggle('active', isActive);
        panes[tdef.id].el.classList.toggle('active', isActive);
      }
    }
    // Default to the General tab. The previous single-modal
    // design showed API key first so we keep that ordering.
    activateSettingsTab('general');
  }, { id: 'settings' });
}

