// renderer/sections/section11_Variants_dropdown.js (Phase 3 Block 29)
// Extracted: Variants dropdown
// Source: app.js L1416..1488

// ----------------- Variants dropdown -----------------
// "Variants" = run the same generation N times (each becomes a separate
// output file). Disabled when a seed is set (would produce identical
// results, wasting API quota). The disabled handler is run initially and
// after every change to the seed control.
function buildVariantsRow({ id, seedInput = null, defaultN = 1, label = '--variants' } = {}) {
  const sel = el('select', { class: 'variants-select', id: id || 'variants' });
  for (let i = 1; i <= 5; i++) {
    sel.appendChild(el('option', { value: String(i) }, `${i}×`));
  }
  sel.value = String(defaultN);
  const lbl = el('label', { class: 'variants-label' }, [
    label,
    el('span', { class: 'help', 'data-help': 'Run this generation N times in a row. Each variant gets its own file. Disabled when a seed is set (all variants would be identical).', title: 'Run this generation N times in a row. Each variant gets its own file. Disabled when a seed is set (all variants would be identical).' }, '?'),
  ]);
  const row = el('div', { class: 'row variants-row' }, [lbl, sel]);
  // seedInput can be:
  //   - a raw element with .value
  //   - the result of buildParamRow: { row, input: { el, getValue, type } }
  //   - the input portion of that: { el, getValue, type }
  const seedEl = seedInput && (seedInput.input ? seedInput.input.el : (seedInput.el || seedInput));
  const readSeed = () => {
    if (!seedInput) return '';
    if (seedInput.input && typeof seedInput.input.getValue === 'function') return seedInput.input.getValue();
    if (typeof seedInput.getValue === 'function') return seedInput.getValue();
    return (seedEl && seedEl.value) || '';
  };
  const updateDisabled = () => {
    if (!seedInput) return;
    const v = readSeed();
    const seeded = String(v) !== '' && String(v) !== 'undefined';
    sel.disabled = seeded;
    if (seeded) sel.title = 'Disabled: a fixed seed would produce identical variants';
    else sel.title = '';
  };
  if (seedEl) {
    seedEl.addEventListener('change', updateDisabled);
    seedEl.addEventListener('input', updateDisabled);
    updateDisabled();
  }
  return { row, sel, updateDisabled };
}

function showTab(name) {
  // Save the current fbDir into the slot for the tab we're leaving so we
  // can restore it on the next visit (per-tab folder persistence).
  const prev = state.currentTab;
  if (prev && state.fbDir) state.fbDirs[prev] = state.fbDir;

  state.currentTab = name;
  // Restore the saved folder for the tab we're entering. refreshBrowser
  // will pick it up via state.fbDirs[currentTab].
  const saved = state.fbDirs[name];
  if (saved) state.fbDir = saved;
  for (const t of $$('.tab')) t.classList.toggle('active', t.dataset.tab === name);
  for (const p of $$('.tabpanel')) p.classList.toggle('active', p.id === `tab-${name}`);
  // Refresh file browser to the matching subfolder if present
  refreshBrowser().catch(() => {});
  // Switching into a tab clears the green "finished" indicator for that tab
  // (the user has effectively seen the result by opening the tab). Red
  // "running" indicators must remain visible.
  if (state.genStatus[name] === 'done') state.genStatus[name] = 'idle';
  refreshTabStatusDots();
  // Persist current tab selection
  scheduleStateSave();
  // First-time intro popup for the tab. Gated by the same popup
  // policy as the startup / first-time-setup popups, so the user
  // can flip "never" in ⚙ Settings → Popups to silence every
  // intro popup in one go. The popup id is `tab-intro:<name>` so
  // each tab's intro is independently dismissable.
  maybeShowTabIntro(name);
}

