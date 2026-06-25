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
  // v1.1.26: breadcrumb every tab switch so the file log
  // captures the user's actual flow (which tab they were on
  // when something broke).
  if (typeof window.logAction === 'function') {
    window.logAction('tab', 'switch', { from: prev || '(none)', to: name });
  }

  state.currentTab = name;
  // Restore the saved folder for the tab we're entering. refreshBrowser
  // will pick it up via state.fbDirs[currentTab].
  //
  // Bug-fix (D3, _temp4.md): when the entering tab has no saved folder
  // (never visited), `state.fbDir` used to be left untouched — silently
  // inheriting whatever folder the tab we just LEFT was showing. The
  // browser would then display (and ensureSubDir would write into) the
  // previous tab's folder, e.g. switching image -> music (music never
  // visited) put music files in the image folder. Reset to the
  // output_dir root instead — refreshBrowser() below will still prefer
  // <output_dir>/music if that subfolder already exists, so a returning
  // user's per-tab grouping is unaffected; only the "no folder at all
  // recorded yet" case changes.
  const saved = state.fbDirs[name];
  if (saved) state.fbDir = saved;
  // v1.1.16 (reported by user — "we still have the behavior for
  // new users, that if they don't setup a folder, they end up in a
  // folder explorer view of a not existing folder, including an
  // error message"): the previous fallback was
  // `state.config.output_dir || ''`. For a fresh install with an
  // empty config, that's '' and the file browser shows an
  // "outside allowed directories" error. We now leave state.fbDir
  // empty here when nothing is set, and let refreshBrowser() (in
  // fileBrowser1.js) resolve the platform-default output dir
  // (%APPDATA%\MiniMaxAssetTool\generated) as the last-ditch
  // fallback. That path always exists and is on the
  // `getAllowedRoots()` allow-list, so the user lands on a real
  // folder instead of an error screen.
  else if (state.config.output_dir) state.fbDir = state.config.output_dir;
  else state.fbDir = '';
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
  //
  // Bug-fix: if the welcome / first-time-setup / optional-addons
  // popup chain is still running on launch, do NOT show the intro
  // popup on top of it — defer until the chain drains. The chain
  // counter is maintained by section18 / section17 / section15.
  if (typeof _introStartupChainOpen !== 'undefined' && _introStartupChainOpen > 0) {
    _pendingTabIntro = name;
  } else {
    maybeShowTabIntro(name);
  }
}

