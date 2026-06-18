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
  // messy fast â€” closing the inner modal left an inconsistent
  // half-saved settings dialog, and the layered stack could
  // trap the focus on the wrong sub-section. The new layout is
  // one modal with a sidebar of tabs (General / Image /
  // Styles / Popups / Shortcuts). Switching tabs swaps the
  // pane content without ever stacking a second modal.
  showModal((m, close) => {
    m.classList.add('settings-modal');
    m.appendChild(el('h2', {}, 'âš™ Settings'));
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
      { id: 'general',  label: 'ðŸ”‘ General',     build: () => buildSettingsGeneralPane() },
      { id: 'image',    label: 'ðŸ–¼ Image',        build: () => buildSettingsImagePane() },
      { id: 'styles',   label: 'ðŸŽ¨ Style presets', build: () => buildSettingsStylesPane() },
      { id: 'popups',   label: 'ðŸ’¬ Popups',        build: () => buildSettingsPopupsPane() },
      { id: 'shortcuts',label: 'âŒ¨ Shortcuts',      build: () => buildSettingsShortcutsPane() },
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
    // currently visible â€” we collect pending changes into a
    // single setConfig call on save so config.txt is updated
    // atomically, just like the old single-modal save).
    const saveBtn = el('button', { class: 'primary' }, 'Save');
    const cancelBtn = el('button', { onclick: close }, 'Cancel');
    saveBtn.addEventListener('click', async () => {
      const merged = { ...state.config };
      for (const tdef of tabDefs) {
        const inst = panes[tdef.id].instance;
        if (inst && typeof inst.collect === 'function') {
          Object.assign(merged, inst.collect());
        }
      }
      // CRITICAL: merge with the current config â€” do NOT replace it.
      // The previous version of this code built a fresh
      // {api_key,output_dir,region} object which silently dropped
      // `theme` and `styles` on every save. We preserve every
      // unknown key so future config fields aren't wiped.
      state.config = await window.api.setConfig(merged);
      toast('Saved.', 'ok');
      close();
      refreshQuota();
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

