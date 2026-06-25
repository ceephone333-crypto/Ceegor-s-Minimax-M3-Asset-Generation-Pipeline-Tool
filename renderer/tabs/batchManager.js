// renderer/tabs/batchManager.js (Phase 4 Fix 2)
// BatchGen management extracted from app.js (Phase 2 refactor):
//   - openBatchManager(tabKey): shows a modal for editing the
//     per-tab batch queue.
//   - startBatchGen(tabKey): starts the batch generation loop.
// Both functions are wired up by app.js init() (called via the
// toolbar Setup Batch Mode button) and the global keyboard
// shortcut Ctrl+B (see installKeyboardShortcuts in app.js).

// reconstructParamStr is defined in batchImportHelper.js (loaded first)
// and read via window.BatchManager below — NOT re-declared here (a global
// const of the same name would collide and break this script).

// bug-fix Phase2 (_temp4.md): per-tab abort flags. `_batchAbort` used to
// be a single bare (implicitly global, shared by ALL tabs) variable —
// `startBatchGen('music')` and `startBatchGen('image')` are two
// independent entry points (separate "Start BatchGen" buttons per tab,
// app.js:930), and with Phase1's JobRunner migration they now genuinely
// run in parallel. Sharing one abort flag meant clicking "■ Stop batch"
// on EITHER tab's overlay silently aborted the OTHER tab's batch too —
// directly undermining the user's core ask ("a music batch + image
// batch... can run simultaneously"). Keyed by tabKey so each tab's
// Stop button only ever affects its own run.
window._batchAbortByTab = window._batchAbortByTab || {};

// Phase A: the per-tab "is anything running?" gate. Replaces the old
// `state.generating === tabKey` check which couldn't tell which tab
// a job belonged to once the new multi-job model landed.
//
// The check is the OR of two sources of truth:
//   1. JobRunner.isTabRunning(tabKey) — true when a JobRunner job
//      is in flight for this tab (Phase A flow).
//   2. state.generating === tabKey — true when the LEGACY
//      `armGenBtnWithCancel` flow is running a job for this tab
//      (pre-Phase-A flow; still used by the tab gen handlers until
//      they're individually migrated to JobRunner.run).
// Either being true means "this tab is busy, don't start another
// job on it".
function _isTabRunningNow(tabKey) {
  if (window.JobRunner && typeof window.JobRunner.isTabRunning === 'function'
      && window.JobRunner.isTabRunning(tabKey)) {
    return true;
  }
  return !!(window.state && window.state.generating === tabKey);
}
function openBatchManager(tabKey) {
  const tabName = tabKey.charAt(0).toUpperCase() + tabKey.slice(1);
  const current = (state.batches[tabKey] || []).slice();
  // Bug-fix #5 (2026-06-19): resolve the helpers defensively — the
  // editor's <script> tag (this file) is loaded AFTER batchImportHelper,
  // but tests and bundling reshuffles can break that ordering, and a
  // missing helper here would mean every imported batch entry
  // stringified to "[object Object]".
  const getEntryText = (window.BatchManager && window.BatchManager.batchEntryText)
    || ((e) => (typeof e === 'string' ? e : ''));
  const setEntryText = (window.BatchManager && window.BatchManager.withBatchEntryText)
    || ((e, t) => (typeof e === 'string' ? String(t || '') : ''));
  showModal((m, close) => {
    m.appendChild(el('h2', {}, `BatchGen — ${tabName} Tab`));
    m.appendChild(el('p', { style: 'color: var(--fg-2); font-size: 12px; margin-top: 0;' },
      `Enter up to 100 prompts/texts. They will be generated one after another with the tab's current options + the selected style preset. "Start Batch" runs them sequentially in the tab. "${tabName === 'Video' ? 'Note: your plan includes 3 free video generations per week — the rest will fail with quota errors.' : ''}"`));

    // List of textareas
    const list = el('div', { class: 'batch-list' });
    function renderList() {
      list.innerHTML = '';
      if (!current.length) {
        list.appendChild(el('div', { class: 'batch-empty' }, 'No prompts yet. Click "+ Add prompt" below to add the first one.'));
        return;
      }
      current.forEach((entry, i) => {
        const isObj = entry && typeof entry === 'object';
        const entryWrap = el('div', { class: 'batch-entry' });
        const row = el('div', { class: 'batch-row' });
        const num = el('div', { class: 'batch-num' }, String(i + 1));
        // Bug-fix #5: extract text from either shape (string or
        // {prompt, params...}); previously the textarea was seeded
        // with the raw entry, so object entries rendered as
        // "[object Object]".
        const ta = el('textarea', {}, getEntryText(entry));
        ta.placeholder = tabKey === 'speech' ? 'Text to read…' : 'Prompt for asset…';
        const up = el('button', { class: 'btn-mini', title: 'Move up', onclick: () => { if (i > 0) { [current[i-1], current[i]] = [current[i], current[i-1]]; renderList(); } } }, '↑');
        const down = el('button', { class: 'btn-mini', title: 'Move down', onclick: () => { if (i < current.length-1) { [current[i+1], current[i]] = [current[i], current[i+1]]; renderList(); } } }, '↓');
        const del = el('button', { class: 'btn-mini danger', title: 'Remove', onclick: () => { current.splice(i, 1); renderList(); } }, '✕');
        row.append(num, ta, up, down, del);
        entryWrap.appendChild(row);

        // Per-entry parameters editor + live defective check. Object
        // entries (imported rows, or "+ Add" snapshots) carry CLI-style
        // flags; we surface them as an editable field so the user can
        // REPAIR a defective entry right here (the user's explicit ask).
        // Pure string entries have no params and stay simple.
        let reasonsEl = null;
        let paramsInp = null;
        const refreshDefective = () => {
          const cur = current[i];
          const def = cur && typeof cur === 'object' && Array.isArray(cur._defective) ? cur._defective : null;
          if (def && def.length) { entryWrap.classList.add('batch-entry-defective'); if (reasonsEl) reasonsEl.textContent = '⚠ ' + def.join('  •  '); }
          else { entryWrap.classList.remove('batch-entry-defective'); if (reasonsEl) reasonsEl.textContent = ''; }
        };
        const revalidate = () => {
          if (!paramsInp) return;
          const parse = (window.BatchManager && window.BatchManager.parseParams) || (() => ({}));
          const make = (window.BatchManager && window.BatchManager.buildImportedEntry) || ((t, p, pr) => ({ prompt: p, ...pr }));
          const np = parse(paramsInp.value);
          current[i] = make(tabKey, getEntryText(current[i]), np);
          refreshDefective();
        };
        ta.addEventListener('input', () => {
          current[i] = setEntryText(current[i], ta.value);
          revalidate();
        });
        if (isObj) {
          paramsInp = el('input', {
            type: 'text', class: 'batch-params-input',
            value: ((window.BatchManager && window.BatchManager.reconstructParamStr) || (() => ''))(entry),
            placeholder: '--model … --bitrate … (CLI-style flags)',
            title: 'Per-entry parameters. Edit these to repair a defective entry; valid values clear the ⚠ flag.',
          });
          paramsInp.addEventListener('input', revalidate);
          reasonsEl = el('div', { class: 'batch-defective-reasons' });
          entryWrap.appendChild(paramsInp);
          entryWrap.appendChild(reasonsEl);
        }
        refreshDefective();
        list.appendChild(entryWrap);
      });
    }
    renderList();
    m.appendChild(list);

    // Add / Clear / Paste-many controls
    const ctrls = el('div', { class: 'row', style: 'margin-top: 8px; flex-direction: row; gap: 6px; align-items: center;' });
    const addBtn = el('button', { class: 'btn-mini', onclick: () => { if (current.length >= 100) { toast('Max 100 entries.', 'warn'); return; } current.push(''); renderList(); setTimeout(() => { const ta = list.querySelectorAll('textarea'); ta[ta.length-1]?.focus(); }, 0); } }, '+ Add prompt');
    const clearBtn = el('button', { class: 'btn-mini', onclick: () => { if (current.length && !confirm('Clear all ' + current.length + ' entries?')) return; current.length = 0; renderList(); } }, 'Clear all');
    const pasteBtn = el('button', { class: 'btn-mini', onclick: () => {
      const ta = el('textarea', { placeholder: 'Paste one prompt per line, then click Import.' });
      const dialog = showModal((dm, dclose) => {
        dm.appendChild(el('h2', {}, 'Bulk import'));
        dm.appendChild(el('p', { style: 'color: var(--fg-2); font-size: 12px;' }, 'One prompt per line. Empty lines are ignored.'));
        dm.appendChild(el('div', { class: 'row' }, [el('label', {}, 'Prompts'), ta]));
        const ok = el('button', { class: 'primary' }, 'Import');
        const cancel = el('button', { onclick: dclose }, 'Cancel');
        dm.appendChild(el('div', { class: 'footer' }, [cancel, ok]));
        ok.addEventListener('click', async () => {
          const lines = ta.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
          const room = 100 - current.length;
          const toAdd = lines.slice(0, room);
          for (const l of toAdd) current.push(l);
          dclose();
          renderList();
          if (lines.length > room) toast(`Imported ${room} (skipped ${lines.length - room} to stay under 100).`, 'warn');
          else toast(`Imported ${toAdd.length} prompts.`, 'ok');
        });
      });
    } }, 'Bulk paste…');
    ctrls.append(addBtn, pasteBtn, clearBtn);
    m.appendChild(ctrls);

    // Save / Close
    const save = el('button', { class: 'primary' }, `Save (${current.length})`);
    const closeBtn = el('button', { onclick: close }, 'Close');
    save.addEventListener('click', async () => {
      // Bug-fix #5: trim + filter empties via the shape-aware helpers
      // so a snapshot entry keeps its params after the user edits the
      // prompt. Previous version stringified everything (`String(s)`
      // on an object → "[object Object]"), losing all the per-entry
      // settings that the BatchGen runner reads at run time.
      const cleaned = current
        .map((e) => setEntryText(e, getEntryText(e).trim()))
        .filter((e) => getEntryText(e).length > 0)
        .slice(0, 100);
      if (cleaned.length === 0) {
        if (!confirm('Save an EMPTY batch (this removes the Start Batch button)?')) return;
      }
      const next = { ...state.batches, [tabKey]: cleaned };
      const r = await window.api.batchesSet(next);
      if (!r.ok) { toast('Save failed: ' + r.error, 'err'); return; }
      state.batches = { ...state.batches, [tabKey]: cleaned };
      toast(`Saved ${cleaned.length} prompt${cleaned.length === 1 ? '' : 's'} for ${tabName}.`, 'ok');
      _refreshBatchButtons();
      close();
    });
    m.appendChild(el('div', { class: 'footer' }, [closeBtn, save]));
  });
}

async function startBatchGen(tabKey) {
  const items = (state.batches[tabKey] || []).slice();
  if (!items.length) { toast('Batch is empty.', 'warn'); return; }
  if (!state.config.api_key) { toast('No API key configured. Click ⚙ to open Settings.', 'err'); return; }
  if (tabKey === 'video' && items.length > 3) {
    if (!confirm(`This batch has ${items.length} videos. Your Token Plan includes only 3 free video generations per week — the rest will fail with a quota error. Continue?`)) return;
  }

  window._batchAbortByTab[tabKey] = false;
  // v1.1.14 (reported by user): default behaviour is now to
  // remove a successful item from state.batches[tabKey]
  // immediately after it finishes, so the list always
  // reflects only upcoming work. The user can opt out in
  // ⚙ Settings → BatchGen ("Keep completed items in
  // list"). Failed items are NEVER removed — the user
  // decides whether to retry or skip them.
  const autoRemove = state.batchesAutoRemove !== false;
  const tabName = tabKey.charAt(0).toUpperCase() + tabKey.slice(1);
  // bug-fix (spawned follow-up, _temp4.md Phase2): represent the WHOLE
  // batch as one parent JobRunner job (so ActiveJobsWidget shows a
  // single "Batch: Music (12/20)" row instead of N individual jobs
  // flickering by) and feed JobSummary.emit() at the end (previously
  // built but never wired to anything — see _temp4.md's "the new Phase
  // A/B/C modules work in isolation" finding).
  //
  // tabKey: null is deliberate: JobRunner.run()'s per-tab gate
  // (isTabRunning(tabKey)) checks ANY job on that tab, regardless of
  // parent/child relationship. Each ITEM's own genBtn.click() ALSO
  // calls JobRunner.run({tabKey}) for the SAME tab (via the migrated
  // tab handlers, Phase1) — if the parent occupied that tab's "wip"
  // slot, every child item would immediately self-reject. The parent
  // is tracked (shows in ActiveJobsWidget, gets a progress bar, is
  // cancellable) without participating in the per-tab mutual exclusion
  // that only makes sense between actual generation attempts.
  const batchResults = [];
  let batchCtrl;
  batchCtrl = window.JobRunner.run({
    tabKey: null,
    type: tabKey,
    title: `Batch: ${tabName} (${items.length} item${items.length === 1 ? '' : 's'})`,
    subtitle: '',
    typeIcon: '∑',
    runFn: async (ctx) => {
      // External cancellation (ActiveJobsWidget ✕ on the parent row)
      // must behave exactly like clicking "■ Stop batch" in the
      // overlay — both ultimately just flip the same per-tab flag the
      // loop below already polls.
      ctx.signal.addEventListener('abort', () => { window._batchAbortByTab[tabKey] = true; });
  const tabRoot = $(`#tab-${tabKey}`);
  const promptTa = tabRoot.querySelector('textarea');        // first textarea = main prompt
  const styleSel = tabRoot.querySelector('.row select');      // first select = style preset
  const genBtn = tabRoot.querySelector('button.primary');
  const preview = tabRoot.querySelector('.preview');
  const lastCmd = tabRoot.querySelector('.lastcmd');
  if (!promptTa || !genBtn) { toast('Could not locate tab controls.', 'err'); return { status: 'err', error: 'Could not locate tab controls.' }; }
  // v1.1 (audit L3): guard preview + lastCmd — they CAN be null in
  // edge cases (e.g. a future tab layout that omits .preview, or a
  // DOM mutation race). The previous code dereferenced
  // preview.parentNode unconditionally on line ~282, which would
  // throw outside the try block (it starts at line ~309) and reject
  // runFn directly. Fall back to a no-op stub so the rest of the
  // batch still runs even when the per-tab preview is missing.
  const previewEl = preview || { parentNode: null, innerHTML: '' };

  // Save current state
  const savedPrompt = promptTa.value;
  const savedStyle = styleSel ? styleSel.value : '';
  const variantsSel = tabRoot.querySelector('.variants-select');
  const savedVariants = variantsSel ? variantsSel.value : '1';
  const variantsCount = Math.max(1, Math.min(5, parseInt(savedVariants, 10) || 1));

  const savedUpscaleEnabled = state.upscaleEnabled;
  const savedUpscaleSettings = state.upscaleSettings ? { ...state.upscaleSettings } : null;

  // Show progress overlay
  const overlay = el('div', { class: 'batch-overlay' });
  overlay.appendChild(el('div', { class: 'batch-overlay-title' }, `BatchGen — ${tabName}`));
  const counter = el('div', { class: 'batch-overlay-counter' }, `0 / ${items.length}`);
  const currentPrompt = el('div', { class: 'batch-overlay-prompt' }, '');
  const elapsed = el('div', { class: 'batch-overlay-elapsed' }, '');
  const log = el('div', { class: 'batch-overlay-log' });
  const stopBtn = el('button', { class: 'danger' }, '■ Stop batch');
  stopBtn.addEventListener('click', () => {
    window._batchAbortByTab[tabKey] = true;
    // Route through the parent job's own cancel() (not just the abort
    // flag) so JobRunner marks the parent job 'cancel' instead of 'ok'
    // when it settles — _markJobDone only sees 'cancel' if ac.signal
    // was actually aborted; setting the flag alone leaves the signal
    // un-aborted and the job would otherwise log as a false "ok".
    if (batchCtrl && typeof batchCtrl.cancel === 'function') batchCtrl.cancel();
    stopBtn.disabled = true;
    stopBtn.textContent = 'Stopping…';
  });
  overlay.append(counter, currentPrompt, elapsed, log, stopBtn);
  // bug-fix (spawned follow-up, _temp4.md Phase2): the overlay used to be
  // appended INSIDE .preview, but the tab's own generate handler writes
  // its per-variant status text via `preview.innerHTML = '<spinner...>'`
  // during generation — which replaces ALL of .preview's children,
  // wiping the overlay (and its "■ Stop batch" button) out of the DOM
  // within the first item's generation, almost immediately. Insert it
  // as a SIBLING of .preview instead (same parent, .tab-footer for every
  // tab) so the tab's own preview updates can never touch it.
  // v1.1 (audit L3): only insert the overlay when preview.parentNode
  // exists. The previous code dereferenced preview.parentNode
  // unconditionally; a null preview (e.g. a future tab layout
  // without .preview) would throw outside the try block.
  if (previewEl.parentNode) {
    previewEl.parentNode.insertBefore(overlay, previewEl);
  } else {
    // Fallback: append the overlay to the tab root so the user
    // still sees the batch progress + Stop button.
    try { tabRoot.appendChild(overlay); } catch (_) { /* best-effort */ }
  }
  const t0 = Date.now();
  const updateElapsed = () => { const s = Math.round((Date.now() - t0) / 1000); elapsed.textContent = `Elapsed: ${Math.floor(s / 60)}m ${s % 60}s`; };
  const elapsedTimer = setInterval(updateElapsed, 1000);
  updateElapsed();

  function logLine(s, kind) {
    const e = el('div', { class: 'batch-log-line ' + (kind || '') }, s);
    log.appendChild(e);
    log.scrollTop = log.scrollHeight;
  }

  let ok = 0, fail = 0, skipped = 0;
  let batchError = null;
  // v1.1.9: seed the per-tab "batch queue left" counter so the
  // per-tab ETA timer (section10) can include the remaining
  // batch items in its total estimate. Reset on entry; we
  // decrement on every completed / failed item. The "all types"
  // ETA span (in app.js) reads the sum across tabs.
  if (!state.batchQueueLeft) state.batchQueueLeft = { image: 0, speech: 0, music: 0, video: 0 };
  state.batchQueueLeft[tabKey] = items.length;
  // Track which (original-snapshot) indices completed successfully so
  // auto-remove can rebuild the queue from the immutable `items`
  // snapshot. Removing by live index while iterating (the previous
  // splice(i,1) approach) shifts every later index by one, so only the
  // FIRST successful item was ever removed.
  const removedIdx = new Set();
  try {
    for (let i = 0; i < items.length && !window._batchAbortByTab[tabKey]; i++) {
      const item = items[i];
      const isObj = typeof item === 'object';
      const itemPrompt = isObj ? (item.prompt || item.text || '') : item;

      counter.textContent = `${i + 1} / ${items.length}`;
      ctx.onProgress(i + 1, items.length);
      currentPrompt.textContent = itemPrompt.slice(0, 200) + (itemPrompt.length > 200 ? '…' : '');
      // Update the "items left" counter for the per-tab ETA so the
      // user can see the queue draining in real time.
      if (state.batchQueueLeft) state.batchQueueLeft[tabKey] = Math.max(0, items.length - i - 1);

      // Skip entries marked defective (failed the parameter check on
      // import or in the editor). They stay in the queue — never
      // auto-removed — so the user can repair them in the editor (✎) and
      // re-run. Sending them would just burn a request on a guaranteed
      // API rejection.
      if (isObj && Array.isArray(item._defective) && item._defective.length) {
        skipped++;
        logLine(`⚠ ${i + 1}/${items.length} skipped — defective: ${item._defective[0]}`, 'warn');
        continue;
      }

      let currentVariantsCount = variantsCount;
      if (isObj) {
        const vVal = item.variants || item['--variants'];
        if (vVal !== undefined) {
          currentVariantsCount = Math.max(1, Math.min(5, parseInt(vVal, 10) || 1));
        }
      }

      // Temporarily apply parameters for this item
      const modifiedFields = {};
      if (isObj) {
        const tabFields = getTabInputs(tabKey);
        for (const [key, val] of Object.entries(item)) {
          if (key === 'prompt' || key === 'text') continue;
          const cleanKey = key.replace(/^--/, '').toLowerCase();
          
          if (cleanKey === 'upscale' || cleanKey === 'upscale-enabled') {
            modifiedFields['upscale'] = state.upscaleEnabled;
            const isTrue = String(val).toLowerCase() === 'true' || String(val).toLowerCase() === 'on' || val === true;
            state.upscaleEnabled = isTrue;
            const upscaleCb = tabRoot.querySelector('.upscale-checkbox input');
            if (upscaleCb) upscaleCb.checked = isTrue;
            continue;
          }
          if (cleanKey === 'upscale-multiplier' || cleanKey === 'scale') {
            modifiedFields['upscale-settings'] = state.upscaleSettings ? { ...state.upscaleSettings } : null;
            const num = parseInt(val, 10);
            if (num === 2 || num === 4) {
              state.upscaleSettings = state.upscaleSettings || {};
              state.upscaleSettings.multiplier = num;
              const multSpan = tabRoot.querySelector('.upscale-mult');
              if (multSpan) multSpan.textContent = `(${num}x)`;
            }
            continue;
          }
          if (cleanKey === 'style') {
            if (styleSel) {
              modifiedFields['style'] = styleSel.value;
              styleSel.value = String(val);
              styleSel.dispatchEvent(new Event('change', { bubbles: true }));
            }
            continue;
          }

          const input = tabFields[cleanKey];
          if (input) {
            modifiedFields[cleanKey] = getTabInputValue(input);
            setTabInputValue(input, val);
          }
        }
      }

      // Set the prompt + fire input event so the style preview updates.
      // We suppress the global state-save (scheduled by the input event)
      // so a batch item doesn't overwrite the user's saved prompt.
      suppressStateSave(() => {
        promptTa.value = itemPrompt;
        promptTa.dispatchEvent(new Event('input', { bubbles: true }));
      });

      // Run N variants for this batch item
      for (let vi = 0; vi < currentVariantsCount; vi++) {
        if (window._batchAbortByTab[tabKey]) break;
        // Wait until no other generation is in progress for THIS tab.
        // (Phase A: replaced the old `state.generating` single-slot
        // check with _isTabRunningNow(tabKey) so a parallel job on a
        // different tab doesn't block the batch.)
        while (_isTabRunningNow(tabKey)) {
          if (window._batchAbortByTab[tabKey]) break;
          await new Promise((r) => setTimeout(r, 50));
        }
        if (window._batchAbortByTab[tabKey]) break;
        // Reset the per-tab run-outcome signal so we read THIS item's
        // result (not a stale 'ok' from the previous item). The gen
        // handlers set state.genLastResult[tabKey] = 'ok' | 'err' at the
        // end of the run; see the looksOk check below for why we can't
        // just scrape the preview DOM.
        state.genLastResult = state.genLastResult || { image: null, speech: null, music: null, video: null };
        state.genLastResult[tabKey] = null;
        // Trigger generation. The click handler is async — we poll
        // the per-tab running flag to detect when it has set the busy
        // signal (i.e. the handler started).
        genBtn.click();
        const startDeadline = Date.now() + 8000;
        while (!_isTabRunningNow(tabKey)) {
          if (window._batchAbortByTab[tabKey]) break;
          if (Date.now() > startDeadline) { logLine(`✗ Gen did not start for item ${i + 1}.`, 'err'); fail++; batchResults.push({ status: 'err', error: `item ${i + 1} did not start` }); break; }
          await new Promise((r) => setTimeout(r, 20));
        }
        if (window._batchAbortByTab[tabKey] || !_isTabRunningNow(tabKey)) break;
        // Wait for the generation to finish (armGenBtnWithCancel's cleanup
        // resets state.generating to null when the gen handler returns).
        while (_isTabRunningNow(tabKey)) {
          if (window._batchAbortByTab[tabKey]) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        // Determine success. PRIMARY signal: the per-tab run outcome the
        // gen handler records on state.genLastResult[tabKey]. This is
        // authoritative and decoupled from how each tab renders its
        // preview. FALLBACK (older tabs / unset): scrape the preview for
        // a media element. The image tab no longer puts an <img> in
        // .preview (it shows "see preview pane on the right" + renders
        // the image in the folder-explorer pane), so the DOM-only check
        // reported EVERY image batch item as failed and auto-remove never
        // fired — this is the fix for that bug.
        const outcome = state.genLastResult && state.genLastResult[tabKey];
        // v1.1 (audit L3): guard the DOM-scrape fallback for a null
        // preview. Pre-v1.1 this would throw when outcome was null
        // AND preview was null (rare, but possible in a future tab
        // layout without .preview).
        const looksOk = outcome === 'ok'
          || (outcome == null && preview && preview.querySelector('img, video, audio'));
        const variantTag = currentVariantsCount > 1 ? ` v${vi + 1}/${currentVariantsCount}` : '';
        if (looksOk) { ok++; logLine(`✓ ${i + 1}/${items.length}${variantTag} OK`, 'ok'); batchResults.push({ status: 'ok' }); }
        else { fail++; logLine(`✗ ${i + 1}/${items.length}${variantTag} FAILED`, 'err'); batchResults.push({ status: 'err', error: `item ${i + 1}${variantTag} failed` }); }
        // v1.1.14 (reported by user): default behaviour is to
        // remove successful items from state.batches[tabKey]
        // immediately. We do this after the LAST variant of the
        // current item so a multi-variant run still generates
        // every variant of the prompt before the entry is
        // dropped. Failed items stay so the user can retry.
        if (looksOk && autoRemove && vi === currentVariantsCount - 1) {
          // Mark this snapshot index as done and rebuild the live queue
          // from the immutable `items` snapshot, dropping every
          // completed index. Rebuilding (instead of an in-place splice)
          // keeps indices stable across the rest of the loop and works
          // correctly even with duplicate prompts. Persist so a restart
          // doesn't bring the entry back.
          removedIdx.add(i);
          state.batches[tabKey] = items.filter((_, idx) => !removedIdx.has(idx));
          try { await window.api.batchesSet(state.batches); } catch (_) { /* best-effort persist */ }
          logLine(`✓ ${i + 1}/${items.length} removed from queue (auto-remove on)`, 'ok');
        }
      }

      // Restore modified fields for this item
      if (isObj) {
        const tabFields = getTabInputs(tabKey);
        for (const [cleanKey, origVal] of Object.entries(modifiedFields)) {
          if (cleanKey === 'upscale') {
            state.upscaleEnabled = origVal;
            const upscaleCb = tabRoot.querySelector('.upscale-checkbox input');
            if (upscaleCb) upscaleCb.checked = !!origVal;
          } else if (cleanKey === 'upscale-settings') {
            state.upscaleSettings = origVal;
            const multSpan = tabRoot.querySelector('.upscale-mult');
            if (multSpan) multSpan.textContent = origVal ? `(${origVal.multiplier}x)` : '';
          } else if (cleanKey === 'style') {
            if (styleSel) {
              styleSel.value = origVal;
              styleSel.dispatchEvent(new Event('change', { bubbles: true }));
            }
          } else {
            const input = tabFields[cleanKey];
            if (input) {
              setTabInputValue(input, origVal);
            }
          }
        }
      }

      if (window._batchAbortByTab[tabKey]) { logLine(`Aborted at item ${i + 1}.`, 'warn'); break; }
    }
  } catch (e) {
    batchError = e;
    console.error('BatchGen threw:', e);
    logLine(`⚠ Batch error: ${e && e.message || String(e)}`, 'err');
  } finally {
    // Always clear the timer and reset the stop button — even on an
    // uncaught exception in the loop.
    clearInterval(elapsedTimer);
    stopBtn.textContent = 'Close';
    stopBtn.disabled = false;
    stopBtn.onclick = () => overlay.remove();
    // v1.1.9: clear the per-tab batch-queue counter so the ETA
    // timer stops showing batch left-over. Done in finally so an
    // aborted / errored batch still resets the counter.
    if (state.batchQueueLeft) state.batchQueueLeft[tabKey] = 0;

    // Restore global upscale state
    state.upscaleEnabled = savedUpscaleEnabled;
    state.upscaleSettings = savedUpscaleSettings;
    const upscaleCb = tabRoot.querySelector('.upscale-checkbox input');
    if (upscaleCb) {
      upscaleCb.checked = !!state.upscaleEnabled;
      const multSpan = tabRoot.querySelector('.upscale-mult');
      if (multSpan) {
        multSpan.textContent = state.upscaleEnabled && state.upscaleSettings ? `(${state.upscaleSettings.multiplier}x)` : '';
      }
    }
  }

  // Restore original state. Suppress the input-event-driven state save for
  // the same reason as the per-item overwrite: we don't want the batch to
  // leave behind any transient state.
  suppressStateSave(() => {
    promptTa.value = savedPrompt;
    promptTa.dispatchEvent(new Event('input', { bubbles: true }));
    if (styleSel) styleSel.value = savedStyle;
    if (variantsSel) variantsSel.value = savedVariants;
  });
  const skipNote = skipped > 0 ? `, ${skipped} skipped (defective)` : '';
  if (lastCmd) lastCmd.textContent = `BatchGen finished: ${ok} ok, ${fail} failed${skipNote}. (variants ×${variantsCount})`;

  toast(`BatchGen done: ${ok} ok, ${fail} failed${skipNote}.`, batchError ? 'err' : ((fail === 0 && skipped === 0) ? 'ok' : 'warn'), 6000);
  // Refresh the per-tab batch buttons so the "Start BatchGen (N)" count
  // reflects any items auto-removed during this run (otherwise the count
  // stays stale until the next manual refresh / tab rebuild).
  if (typeof _refreshBatchButtons === 'function') _refreshBatchButtons();
  await refreshBrowser();
  await refreshQuota();
      // Mirrors the toast logic 3 lines up so the parent job's logged
      // outcome (ActiveJobsWidget colour, history row) agrees with what
      // the user was just shown. When aborted, JobRunner's own
      // ac.signal.aborted check overrides this to 'cancel' regardless
      // of what we return here (see _markJobDone in JobRunner.js).
      if (batchError) return { status: 'err', error: batchError.message || String(batchError), details: [`${ok} ok, ${fail} failed${skipNote}`] };
      if (fail > 0 || skipped > 0) return { status: 'warn', details: [`${ok} ok, ${fail} failed${skipNote}`] };
      return { status: 'ok', details: [`${ok} ok, ${fail} failed${skipNote}. (variants ×${variantsCount})`] };
    },
  });
  if (batchCtrl && typeof batchCtrl.catch === 'function') {
    // Hard-cap rejection (Promise.reject from JobRunner.run itself,
    // before runFn ever ran) — the toast was already shown by run().
    batchCtrl.catch(() => {});
  } else {
    await batchCtrl.done;
    // bug-fix (spawned follow-up, _temp4.md Phase2): JobSummary.emit
    // was built (renderer/jobs/JobSummary.js) but had zero call sites
    // anywhere in the codebase. Called AFTER (not during) runFn so the
    // parent row has already settled out of 'wip' — addLogEvent's
    // fold-into-primary-row routing only applies while a jobId's
    // status is still 'wip', so emitting here creates a genuinely
    // separate "Batch finished: N/M ok" summary row instead of
    // silently merging into the row that's about to disappear.
    if (batchResults.length && window.JobSummary && typeof window.JobSummary.emit === 'function') {
      window.JobSummary.emit(batchCtrl.jobId, batchResults);
    }
  }
}

function buildAddToBatchBtn(tabKey) {
  const btn = el('button', {
    class: 'btn-mini batch-add',
    title: 'Add current prompt/text to BatchGen list',
    onclick: async (e) => {
      e.preventDefault();
      const tabRoot = $(`#tab-${tabKey}`);
      const promptTa = tabRoot ? tabRoot.querySelector('textarea') : null;
      const val = promptTa ? promptTa.value.trim() : '';
      if (!val) {
        toast('Prompt is empty.', 'warn');
        return;
      }
      const current = state.batches[tabKey] || [];
      if (current.includes(val)) {
        toast('Prompt is already in the batch list.', 'warn');
        return;
      }
      if (current.length >= 100) {
        toast('Batch is full (max 100 entries).', 'warn');
        return;
      }
      const next = { ...state.batches, [tabKey]: [...current, val] };
      const r = await window.api.batchesSet(next);
      if (!r.ok) {
        toast('Failed to add to batch: ' + r.error, 'err');
        return;
      }
      state.batches = { ...state.batches, [tabKey]: [...current, val] };
      toast('Added to batch list.', 'ok');
      _refreshBatchButtons();
    }
  }, '+ Batch');
  return btn;
}

// Bind to window
window.BatchManager = window.BatchManager || {};
window.BatchManager.openBatchManager = openBatchManager;
window.BatchManager.startBatchGen = startBatchGen;
window.BatchManager.buildAddToBatchBtn = buildAddToBatchBtn;
