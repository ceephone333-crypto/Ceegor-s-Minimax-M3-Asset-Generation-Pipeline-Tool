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
      current.forEach((text, i) => {
        const row = el('div', { class: 'batch-row' });
        const num = el('div', { class: 'batch-num' }, String(i + 1));
        const ta = el('textarea', {}, text);
        ta.placeholder = tabKey === 'speech' ? 'Text to read…' : 'Prompt for asset…';
        ta.addEventListener('input', () => { current[i] = ta.value; });
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
      // Trim + filter empties
      const cleaned = current.map((s) => String(s || '').trim()).filter(Boolean).slice(0, 100);
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
  // Variants dropdown (if present) — batch honors the same value
  const variantsSel = tabRoot.querySelector('.variants-select');
  const savedVariants = variantsSel ? variantsSel.value : '1';
  const variantsCount = Math.max(1, Math.min(5, parseInt(savedVariants, 10) || 1));

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
  try {
    for (let i = 0; i < items.length && !_batchAbort; i++) {
      counter.textContent = `${i + 1} / ${items.length}`;
      currentPrompt.textContent = items[i].slice(0, 200) + (items[i].length > 200 ? '…' : '');
      // Set the prompt + fire input event so the style preview updates.
      // We suppress the global state-save (scheduled by the input event)
      // so a batch item doesn't overwrite the user's saved prompt.
      suppressStateSave(() => {
        promptTa.value = items[i];
        promptTa.dispatchEvent(new Event('input', { bubbles: true }));
      });
      // Run N variants for this batch item
      for (let vi = 0; vi < variantsCount; vi++) {
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
        const variantTag = variantsCount > 1 ? ` v${vi + 1}/${variantsCount}` : '';
        if (looksOk) { ok++; logLine(`✓ ${i + 1}/${items.length}${variantTag} OK`, 'ok'); }
        else { fail++; logLine(`✗ ${i + 1}/${items.length}${variantTag} FAILED`, 'err'); }
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

window.BatchManager = { openBatchManager, startBatchGen, buildAddToBatchBtn };
