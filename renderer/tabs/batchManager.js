// renderer/tabs/batchManager.js (Phase 4 Fix 2)
// BatchGen management extracted from app.js (Phase 2 refactor):
//   - openBatchManager(tabKey): shows a modal for editing the
//     per-tab batch queue.
//   - startBatchGen(tabKey): starts the batch generation loop.
// Both functions are wired up by app.js init() (called via the
// toolbar Setup Batch Mode button) and the global keyboard
// shortcut Ctrl+B (see installKeyboardShortcuts in app.js).

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
        const row = el('div', { class: 'batch-row' });
        const num = el('div', { class: 'batch-num' }, String(i + 1));
        // Bug-fix #5: extract text from either shape (string or
        // {prompt, params...}); previously the textarea was seeded
        // with the raw entry, so object entries rendered as
        // "[object Object]".
        const ta = el('textarea', {}, getEntryText(entry));
        ta.placeholder = tabKey === 'speech' ? 'Text to read…' : 'Prompt for asset…';
        ta.addEventListener('input', () => {
          // Preserve params on object entries; collapse to string on
          // string entries. The helper centralises this logic.
          current[i] = setEntryText(current[i], ta.value);
        });
        // Bug-fix #5 (UX nicety): small badge on object entries so the
        // user knows settings are attached to this row.
        if (entry && typeof entry === 'object') {
          const badge = el('span', {
            class: 'batch-params-badge',
            title: 'This entry has captured settings (style, upscale, etc.) that will be applied at run time.',
            style: 'margin-left: 4px; padding: 1px 5px; border-radius: 8px; font-size: 10px; background: var(--accent, #d9a300); color: var(--bg-1, #1a1a1a); font-weight: bold;',
          }, '+params');
          row.appendChild(badge);
        }
        const up = el('button', { class: 'btn-mini', title: 'Move up', onclick: () => { if (i > 0) { [current[i-1], current[i]] = [current[i], current[i-1]]; renderList(); } } }, '↑');
        const down = el('button', { class: 'btn-mini', title: 'Move down', onclick: () => { if (i < current.length-1) { [current[i+1], current[i]] = [current[i], current[i+1]]; renderList(); } } }, '↓');
        const del = el('button', { class: 'btn-mini danger', title: 'Remove', onclick: () => { current.splice(i, 1); renderList(); } }, '✕');
        row.append(num, ta, up, down, del);
        list.appendChild(row);
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

  _batchAbort = false;
  const tabName = tabKey.charAt(0).toUpperCase() + tabKey.slice(1);
  const tabRoot = $(`#tab-${tabKey}`);
  const promptTa = tabRoot.querySelector('textarea');        // first textarea = main prompt
  const styleSel = tabRoot.querySelector('.row select');      // first select = style preset
  const genBtn = tabRoot.querySelector('button.primary');
  const preview = tabRoot.querySelector('.preview');
  const lastCmd = tabRoot.querySelector('.lastcmd');
  if (!promptTa || !genBtn) { toast('Could not locate tab controls.', 'err'); return; }

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
  stopBtn.addEventListener('click', () => { _batchAbort = true; stopBtn.disabled = true; stopBtn.textContent = 'Stopping…'; });
  overlay.append(counter, currentPrompt, elapsed, log, stopBtn);
  preview.appendChild(overlay);
  const t0 = Date.now();
  const updateElapsed = () => { const s = Math.round((Date.now() - t0) / 1000); elapsed.textContent = `Elapsed: ${Math.floor(s / 60)}m ${s % 60}s`; };
  const elapsedTimer = setInterval(updateElapsed, 1000);
  updateElapsed();

  function logLine(s, kind) {
    const e = el('div', { class: 'batch-log-line ' + (kind || '') }, s);
    log.appendChild(e);
    log.scrollTop = log.scrollHeight;
  }

  let ok = 0, fail = 0;
  let batchError = null;
  // v1.1.9: seed the per-tab "batch queue left" counter so the
  // per-tab ETA timer (section10) can include the remaining
  // batch items in its total estimate. Reset on entry; we
  // decrement on every completed / failed item. The "all types"
  // ETA span (in app.js) reads the sum across tabs.
  if (!state.batchQueueLeft) state.batchQueueLeft = { image: 0, speech: 0, music: 0, video: 0 };
  state.batchQueueLeft[tabKey] = items.length;
  try {
    for (let i = 0; i < items.length && !_batchAbort; i++) {
      const item = items[i];
      const isObj = typeof item === 'object';
      const itemPrompt = isObj ? (item.prompt || item.text || '') : item;

      counter.textContent = `${i + 1} / ${items.length}`;
      currentPrompt.textContent = itemPrompt.slice(0, 200) + (itemPrompt.length > 200 ? '…' : '');
      // Update the "items left" counter for the per-tab ETA so the
      // user can see the queue draining in real time.
      if (state.batchQueueLeft) state.batchQueueLeft[tabKey] = Math.max(0, items.length - i - 1);

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
        if (_batchAbort) break;
        // Wait until no other generation is in progress (state.generating is
        // null). armGenBtnWithCancel sets it to the tab key on entry and clears
        // it on cleanup, so this is a reliable signal.
        while (state.generating) {
          if (_batchAbort) break;
          await new Promise((r) => setTimeout(r, 50));
        }
        if (_batchAbort) break;
        // Trigger generation. The click handler is async — we poll state.generating
        // to detect when it has set the busy flag (i.e. the handler started).
        genBtn.click();
        const startDeadline = Date.now() + 8000;
        while (state.generating !== tabKey) {
          if (_batchAbort) break;
          if (Date.now() > startDeadline) { logLine(`✗ Gen did not start for item ${i + 1}.`, 'err'); fail++; break; }
          await new Promise((r) => setTimeout(r, 20));
        }
        if (_batchAbort || state.generating !== tabKey) break;
        // Wait for the generation to finish (armGenBtnWithCancel's cleanup
        // resets state.generating to null when the gen handler returns).
        while (state.generating === tabKey) {
          if (_batchAbort) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        // Inspect the preview for success/failure (best-effort: check if it has an image/video)
        const looksOk = preview.querySelector('img, video, audio');
        const variantTag = currentVariantsCount > 1 ? ` v${vi + 1}/${currentVariantsCount}` : '';
        if (looksOk) { ok++; logLine(`✓ ${i + 1}/${items.length}${variantTag} OK`, 'ok'); }
        else { fail++; logLine(`✗ ${i + 1}/${items.length}${variantTag} FAILED`, 'err'); }
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

      if (_batchAbort) { logLine(`Aborted at item ${i + 1}.`, 'warn'); break; }
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
  if (lastCmd) lastCmd.textContent = `BatchGen finished: ${ok} ok, ${fail} failed. (variants ×${variantsCount})`;

  toast(`BatchGen done: ${ok} ok, ${fail} failed.`, batchError ? 'err' : (fail === 0 ? 'ok' : 'warn'), 6000);
  await refreshBrowser();
  await refreshQuota();
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
