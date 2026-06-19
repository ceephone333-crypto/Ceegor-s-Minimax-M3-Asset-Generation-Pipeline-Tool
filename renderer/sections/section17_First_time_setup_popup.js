// renderer/sections/section17_First_time_setup_popup.js (Phase 3 Block 29)
// Extracted: First-time setup popup
// Source: app.js L825..943

// ----------------- First-time setup popup -----------------
// Shown right after the greetings popup if either the API key or the
// output directory is missing. Fields are pre-filled with whatever
// values are already in config.txt so the user only has to fix the
// gaps. The "Save" button validates that both required fields are
// present and writes the config before closing. "Skip for now" closes
// without saving — the user can fill the values in later from ⚙
// Settings.
function openFirstTimeSetup() {
  // Enter the startup-popup chain so the pending tab-intro
  // popup stays deferred while the first-time setup form is open.
  if (typeof _enterIntroStartupChain === 'function') _enterIntroStartupChain();
  const _exit = () => { if (typeof _exitIntroStartupChain === 'function') _exitIntroStartupChain(); };
  openGatedPopup('first-time-setup', (m, close, markSeen) => {
    m.classList.add('first-time-setup-modal');
    m.appendChild(el('h2', {}, 'First-time setup'));
    // Plain-language description. Avoids jargon ("endpoint",
    // "config") and tells the user exactly what each value is
    // for and where it ends up.
    m.appendChild(el('p', { style: 'color: var(--fg-2); font-size: 12px; margin-top: 0;' },
      'Welcome! The tool needs two pieces of information to work: your MiniMax API key (so the tool can talk to the model) and the folder where you want generated files to be saved. Both can be changed later in ⚙ Settings. Click the "?" next to any field for a longer explanation.'));

    const cfg = { ...state.config };

    // API key. We use the showRevealableKey helper so the first-time
    // setup behaves the same as the regular ⚙ Settings popup: the
    // real key is hidden behind a "Show" toggle by default, but
    // the user can reveal it (or type a new one) with one click.
    // Without the toggle, the placeholder is a generic "sk-cp-xxx…"
    // so the user knows what shape to paste, but the value field
    // never contains the real key unless the user explicitly asked
    // for it. See the comment on showRevealableKey for the full
    // security rationale.
    //
    // Both Token Plan keys (sk-cp-…) and pay-as-you-go (PAYG) keys
    // are accepted. The placeholder shows the Token Plan shape as a
    // hint but the input is plain text — we do not enforce a prefix.
    const apiRow = showRevealableKey(cfg.api_key || '', {
      placeholder: 'sk-cp-xxxxxxxx  (or your PAYG key)',
      label: 'API key (MiniMax Token Plan or PAYG)',
    });
    // Help icon for the API-key field — the same one used in the
    // Settings dialog so the user gets a consistent explanation
    // regardless of which entry point they came from.
    try {
      const lbl = apiRow.row.querySelector('label');
      if (lbl) lbl.appendChild(helpButton('settings.apiKey'));
    } catch (_) {}
    m.appendChild(apiRow.row);
    const apiInput = apiRow.input;

    // Output directory — text input + Browse button that opens the
    // standard Windows folder-selection dialog (the same one the
    // ⚙ Settings popup uses).
    const outInput = el('input', { type: 'text', value: cfg.output_dir || '', placeholder: 'C:\\Users\\me\\Pictures\\MiniMax-Assets' });
    const browse = el('button', { class: 'btn-mini', type: 'button' }, 'Browse…');
    browse.addEventListener('click', async () => {
      const picked = await window.api.pickFolder();
      if (picked) outInput.value = picked;
    });
    m.appendChild(el('div', { class: 'row' }, [
      el('label', {}, ['Output directory', helpButton('settings.outputDir')]),
      el('div', { class: 'combo' }, [outInput, browse]),
    ]));

    // Region (already has a default of 'global' but show it so the
    // user can confirm / change it on first launch).
    const regInput = el('select', {});
    for (const r of ['global', 'cn']) regInput.appendChild(el('option', { value: r }, r));
    regInput.value = cfg.region || 'global';
    m.appendChild(el('div', { class: 'row' }, [el('label', {}, ['Region', helpButton('settings.region')]), regInput]));

    const save = el('button', { class: 'primary' }, 'Save');
    const skip = el('button', { onclick: () => { markSeen(); close(); } }, 'Skip for now');
    save.addEventListener('click', async () => {
      // Use the helper's getValue() (not apiInput.value) so we
      // never accidentally persist the masked version. The helper
      // returns the real current value regardless of whether the
      // field is currently shown or hidden.
      const api_key = apiRow.getValue().trim();
      const output_dir = outInput.value.trim();
      const region = regInput.value || 'global';
      if (!api_key) { toast('API key is required. Paste it into the API key field above, or click "Skip for now" and set it later in ⚙ Settings.', 'err', 5000); return; }
      if (!output_dir) { toast('Output directory is required. Pick a folder with the Browse… button, or click "Skip for now".', 'err', 5000); return; }
      const newCfg = { ...state.config, api_key, output_dir, region };
      state.config = await window.api.setConfig(newCfg);
      toast('Settings saved.', 'ok');
      markSeen();
      close();
      // Reload anything that depends on config (quota + the file
      // browser, so the freshly-set output_dir is shown).
      refreshQuota();
      refreshBrowser();
    });
    m.appendChild(el('div', { class: 'footer' }, [skip, save]));

    // Focus the first empty field, then the second — saves the user a
    // click when both are blank.
    setTimeout(() => {
      if (!cfg.api_key) apiInput.focus();
      else if (!cfg.output_dir) outInput.focus();
      else apiInput.focus();
    }, 0);
  }, { onClose: _exit });

  // After the first-time setup popup (Save or Skip), walk the user
  // through the optional Real-ESRGAN install. Without this, a user
  // who picked the built-in upscaler without ever opening ⚙
  // Settings would never see the one-click installer, and would
  // wonder "why doesn't this upscale as well as the screenshots
  // show?" later. The install IS automated (one click) — the issue
  // is purely discoverability. The popup is gated on
  //   - Real-ESRGAN binary not present
  //   - user hasn't already dismissed it
  // so it never nags. It is intentionally NOT gated on
  // "config was just set on this launch" — a user who already had a
  // valid config but a fresh install (no ./bin/) should still see
  // it on first launch.
  if (!state.realesrganFirstRunDismissed) {
    openOptionalAddons({ autoOpened: true }).catch(() => {});
  }
}

