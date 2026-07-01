// renderer/tabs/batchImportHelper.js
// Helper functions for BatchGen unstructured file import, example template generation,
// and multi-tab batch generation.

// ---- Bug-fix #5 (2026-06-19): pure helpers for the batch entry shape ----
//
// The renderer stores TWO per-entry shapes:
//   1. Legacy: a non-empty trimmed string (the prompt itself).
//   2. Snapshot: an object { prompt, settings, ts, label, upscale? … }
//      captured via the "+ Add" button next to Generate. These carry
//      per-entry form state so the BatchGen runner can re-apply the
//      exact settings at run time.
//
// The BatchGen editor (batchManager.js → openBatchManager) needs to
// (a) seed each textarea from either shape, (b) write the edited
// prompt back into the same shape (preserving the snapshot's params),
// and (c) trim + filter empty rows without dropping params.
//
// These helpers centralise the shape logic so it's testable and so a
// future third shape (e.g. array of segments) only needs one edit.

// Extract the editable prompt text from a batch entry of either shape.
function batchEntryText(entry) {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object') return String((entry && entry.prompt) || '');
  return '';
}

// Return a new entry of the same shape with the given prompt text.
// Strings stay strings; objects keep their params and just update
// `prompt`. null/undefined yields an empty string (consistent with
// the legacy shape so the editor doesn't have to special-case it).
function withBatchEntryText(entry, text) {
  if (typeof entry === 'string') return String(text || '');
  if (entry && typeof entry === 'object') return Object.assign({}, entry, { prompt: String(text || '') });
  return String(text || '');
}

// ---- Helper Functions for Custom Option Extraction & Mapping ----

function getTabInputs(tabKey) {
  const root = document.getElementById(`tab-${tabKey}`);
  if (!root) return {};
  const inputs = {};
  
  const rows = root.querySelectorAll('.row');
  for (const row of rows) {
    const labelEl = row.querySelector('label');
    if (!labelEl) continue;

    // Bug-fix (2026-07-01, user-reported "--n from imported .md is
    // ignored"): the centralized help system (section23) injects a help
    // "?" button (class .help-btn, text "?") as a child of every param
    // label. labelEl.textContent therefore included that trailing "?",
    // so EVERY derived key came out as "n?" / "width?" / … instead of
    // "n" / "width". The batch runner (batchManager.js) looks up
    // tabFields[cleanKey] with the CLEAN key parsed from the imported
    // row ("n"), so the lookup ALWAYS missed and every generic imported
    // param (--n, --width, --seed, …) was silently dropped — only the
    // specially-cased keys (upscale/style) ever applied. Strip ALL
    // buttons (help-btn today, the legacy help-button, and any future
    // affordance — a param label's semantic text is never inside a
    // button) from a clone before reading the text so keys are clean.
    const labelClone = labelEl.cloneNode(true);
    labelClone.querySelectorAll('button').forEach((b) => b.remove());
    let label = labelClone.textContent.trim().toLowerCase();

    // Clean label text:
    label = label.replace(/^[^\w-]+/, ''); // remove leading symbols/emojis
    label = label.replace(/^--/, ''); // remove CLI dashes
    label = label.replace(/\s*\(.*?\)/, ''); // remove parenthesized details
    label = label.split('\n')[0].trim();
    
    const inputContainer = row.children[1];
    if (inputContainer) {
      inputs[label] = inputContainer;
    }
  }
  return inputs;
}

function getTabInputValue(container) {
  if (container.tagName === 'SELECT' || container.tagName === 'TEXTAREA' || container.tagName === 'INPUT') {
    return container.value;
  }
  if (container.classList && container.classList.contains('combo-select-number')) {
    const sel = container.querySelector('select');
    const num = container.querySelector('input');
    if (sel.value === '__custom__') return num.value;
    return sel.value;
  }
  // Bug-fix H3 (_temp5.md 360° audit): `combo-select-enum` (the
  // v1.1.15 enum wrapper from ParamRow.js) was missing — the
  // fallback below querySelector('input, select, textarea') matches
  // the <select> first, so when the user picked "Custom…" the
  // snapshot stored '__custom__' (the select's value) instead of
  // the typed text. BatchGen then re-ran with the literal string
  // '__custom__' as the model/mode/etc. Handle it explicitly,
  // mirroring the combo-select-number branch.
  if (container.classList && container.classList.contains('combo-select-enum')) {
    const sel = container.querySelector('select');
    const txt = container.querySelector('input');
    if (sel.value === '__custom__') return txt ? txt.value : '';
    return sel.value;
  }
  if (container.classList && container.classList.contains('enum-text-row')) {
    const sel = container.querySelector('select');
    const txt = container.querySelector('input');
    return txt.value || sel.value;
  }
  if (container.classList && container.classList.contains('text-browse-row')) {
    const txt = container.querySelector('input');
    return txt ? txt.value : '';
  }
  const firstInput = container.querySelector('input, select, textarea');
  return firstInput ? firstInput.value : '';
}

function setTabInputValue(container, val) {
  const sel = container.querySelector ? container.querySelector('select') : null;

  // Boolean normalization
  if (sel && sel.options && sel.options.length === 2 && sel.options[0].value === 'off' && sel.options[1].value === 'on') {
    const isTrue = String(val).toLowerCase() === 'true' || String(val).toLowerCase() === 'on' || val === true;
    val = isTrue ? 'on' : 'off';
  }

  if (container.tagName === 'SELECT') {
    container.value = String(val);
    container.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (container.tagName === 'TEXTAREA' || container.tagName === 'INPUT') {
    container.value = String(val);
    container.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (container.classList && container.classList.contains('combo-select-number')) {
    const num = container.querySelector('input');
    if (sel && num) {
      const optionExists = Array.from(sel.options).some(o => o.value === String(val));
      if (optionExists) {
        sel.value = String(val);
        num.value = '';
        num.style.display = 'none';
      } else {
        sel.value = '__custom__';
        num.value = String(val);
        num.style.display = '';
      }
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      num.dispatchEvent(new Event('input', { bubbles: true }));
    }
  } else if (container.classList && container.classList.contains('combo-select-enum')) {
    // Bug-fix H3 (_temp5.md 360° audit): mirror combo-select-number
    // for the enum wrapper. The wrapper has a <select>, a hidden
    // text input, AND an OK button; setCustomVisible (in ParamRow)
    // is driven by the select's change event, so dispatching change
    // here makes the 50/50 layout flip on for custom values.
    const txt = container.querySelector('input.enum-custom-input');
    if (sel && txt) {
      const optionExists = Array.from(sel.options).some(o => o.value === String(val));
      if (optionExists) {
        sel.value = String(val);
        txt.value = '';
      } else {
        sel.value = '__custom__';
        txt.value = String(val);
      }
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      txt.dispatchEvent(new Event('input', { bubbles: true }));
    }
  } else if (container.classList && container.classList.contains('enum-text-row')) {
    const txt = container.querySelector('input');
    if (sel && txt) {
      const optionExists = Array.from(sel.options).some(o => o.value === String(val));
      if (optionExists) {
        sel.value = String(val);
        txt.value = '';
      } else {
        sel.value = '';
        txt.value = String(val);
      }
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      txt.dispatchEvent(new Event('input', { bubbles: true }));
    }
  } else if (container.classList && container.classList.contains('text-browse-row')) {
    const txt = container.querySelector('input');
    if (txt) {
      txt.value = String(val);
      txt.dispatchEvent(new Event('input', { bubbles: true }));
    }
  } else {
    const firstInput = container.querySelector('input, select, textarea');
    if (firstInput) {
      firstInput.value = String(val);
      firstInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
}

// Tokenizes parameters, respecting double-dashes, colons, equal signs, and quotes
function parseParams(paramStr) {
  const params = {};
  if (!paramStr) return params;
  
  const tokens = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';
  for (let i = 0; i < paramStr.length; i++) {
    const c = paramStr[i];
    if ((c === '"' || c === "'") && (i === 0 || paramStr[i-1] !== '\\')) {
      if (inQuote && c === quoteChar) {
        inQuote = false;
      } else if (!inQuote) {
        inQuote = true;
        quoteChar = c;
      } else {
        current += c;
      }
    } else if (c === ' ' && !inQuote) {
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += c;
    }
  }
  if (current) tokens.push(current);

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token.includes('=')) {
      const parts = token.split('=');
      const key = parts[0].replace(/^--/, '').replace(/:$/, '').trim().toLowerCase();
      const val = parts.slice(1).join('=').trim();
      params[key] = val;
      i++;
    } else if (token.endsWith(':') && i + 1 < tokens.length) {
      const key = token.slice(0, -1).replace(/^--/, '').trim().toLowerCase();
      const val = tokens[i+1].trim();
      params[key] = val;
      i += 2;
    } else if (token.startsWith('--') && i + 1 < tokens.length && !tokens[i+1].startsWith('--')) {
      const key = token.slice(2).trim().toLowerCase();
      const val = tokens[i+1].trim();
      params[key] = val;
      i += 2;
    } else if (token.startsWith('--')) {
      const key = token.slice(2).trim().toLowerCase();
      params[key] = 'true';
      i++;
    } else {
      i++;
    }
  }
  return params;
}

// Build a batch entry from an imported row, running the authoritative
// parameter check. Invalid rows are STILL imported (so the user keeps
// their prompt) but tagged with `_defective: [reasons]` — the BatchGen
// runner skips defective rows, and the queue editor shows the reasons +
// lets the user repair them. This is the "validate on import, mark
// defective, repair in the editor" behaviour the user asked for.
function buildImportedEntry(type, prompt, params) {
  const entry = { prompt, ...params };
  try {
    const vv = window.ModelSpecs && window.ModelSpecs.validateValues;
    if (vv) {
      const { errors } = vv(type, Object.assign({}, params, { prompt }), { partial: true });
      if (errors && errors.length) entry._defective = errors;
      else if (entry._defective) delete entry._defective;
    }
  } catch (_) { /* validation must never block import */ }
  return entry;
}
// Reconstruct a CLI-style flag string from a batch entry's params so the
// queue editor can display + re-edit them. Skips the prompt and internal
// bookkeeping keys.
function reconstructParamStr(entry) {
  if (!entry || typeof entry !== 'object') return '';
  const skip = new Set(['prompt', 'text', '_defective', 'ts', 'label', 'settings']);
  const parts = [];
  for (const [k, val] of Object.entries(entry)) {
    if (skip.has(k)) continue;
    if (val === true || val === 'true') { parts.push('--' + k); continue; }
    if (val == null || val === '') continue;
    const s = String(val);
    parts.push('--' + k + ' ' + (/\s/.test(s) ? '"' + s + '"' : s));
  }
  return parts.join(' ');
}

// v1.1.29: apply a style preset to a freshly-imported batch.
//   - Saves {name, value} to the global config.styles list (de-duped
//     by name — overwrites an existing style of the same name without
//     asking, so the import flow is one-click). The list is persisted
//     to config.txt via setConfig so the style is available across
//     sessions and surfaces in every tab's style dropdown.
//   - Stamps `style: name` on every entry of every importedBatches
//     slot, so the existing BatchGen runner (batchManager.js
//     `item.style` handling) pre-selects the style on each entry's
//     per-tab dropdown and prepends it via buildFinalPrompt when the
//     row generates.
//   - Returns the chosen name (or '' if nothing was applied) so the
//     caller can refresh dropdowns + toast.
//
// Bug-fix history (v1.1.29 hot-fix):
//   A3 — idempotence: if (name, value) already matches the in-memory
//        style, return early without re-persisting. A double-click
//        of Overwrite / Append used to re-run the full flow (two
//        setConfig round-trips, two _refreshAllStyleDropdowns
//        sweeps).
//   A4 — mutation order: state.config.styles is mutated ONLY after
//        setConfig resolves with ok=true. A failed IPC used to leave
//        a half-applied style in state.config.styles that leaked
//        into the next setConfig save.
async function applyStyleToImportedBatch({ name, value }) {
  const n = String(name || '').trim();
  const v = String(value || '').trim();
  if (!n || !v) return '';
  // 'config.txt' style name round-trip: '=' would break parsing
  // (the line format is `<name> = <value>` and the first '=' is
  // the name/value separator). Reject up-front with a toast — the
  // user can rename and re-import.
  if (n.includes('=')) {
    toast('Style name cannot contain "=" (would break config parsing). Rename and re-import.', 'err', 6000);
    return '';
  }
  state.config = state.config || {};
  state.config.styles = Array.isArray(state.config.styles) ? state.config.styles : [];
  // Bug-fix A3 (idempotence): if a style of the same name is
  // already in state.config.styles AND its value is identical to
  // what the user just entered, there's nothing to do — the
  // in-memory state is already correct, the dropdown is already
  // showing the name, and the persisted config.txt already has
  // the value. Return the name so the caller can stamp the
  // entries without doing a redundant setConfig round-trip.
  const existing = state.config.styles.find((s) => s && s.name === n);
  if (existing && String(existing.value || '').trim() === v) {
    return n;
  }
  // Build the NEW styles array (de-duped by name) WITHOUT
  // mutating state.config.styles yet — we apply the mutation
  // only after setConfig confirms the write succeeded. Bug-fix
  // A4 used to mutate the in-memory array first and then
  // discover the IPC failed, leaving a half-applied style in
  // state.config.styles that leaked into the next save.
  const newStyles = state.config.styles
    .filter((s) => s && s.name !== n)
    .concat([{ name: n, value: v }]);
  const nextConfig = Object.assign({}, state.config, { styles: newStyles });
  let res;
  try {
    res = await window.api.setConfig(nextConfig);
  } catch (e) {
    toast('Could not save style preset: ' + (e && e.message || e), 'err', 5000);
    return '';
  }
  if (!res || res.ok !== true) {
    const msg = (res && res.error) || 'unknown error';
    toast('Could not save style preset: ' + msg, 'err', 5000);
    return '';
  }
  // Persist succeeded → commit the mutation to state.config.
  // The IPC returned the sanitised full config; use it
  // wholesale so other concurrently-edited fields stay in
  // lock-step with disk.
  state.config = res.config || nextConfig;
  // Refresh every per-tab <select class="style-select"> so the
  // just-added name shows up in the dropdowns immediately.
  if (typeof _refreshAllStyleDropdowns === 'function') {
    try { _refreshAllStyleDropdowns(); } catch (_) {}
  }
  return n;
}

// Stamp `style: <name>` on every non-empty entry of an importedBatches
// object so the existing BatchGen runner picks it up. Mutates and
// returns the same object. Pure helper — no I/O.
function stampStyleOnImportedBatch(importedBatches, styleName) {
  const n = String(styleName || '').trim();
  if (!n) return importedBatches;
  for (const type of ['image', 'speech', 'music', 'video']) {
    const list = importedBatches[type] || [];
    for (const entry of list) {
      if (entry && typeof entry === 'object') entry.style = n;
    }
  }
  return importedBatches;
}

window.BatchManager = window.BatchManager || {};
window.BatchManager.buildImportedEntry = buildImportedEntry;
window.BatchManager.reconstructParamStr = reconstructParamStr;
window.BatchManager.applyStyleToImportedBatch = applyStyleToImportedBatch;
window.BatchManager.stampStyleOnImportedBatch = stampStyleOnImportedBatch;

async function importBatchFileDialog() {
  try {
    const pickResult = await window.api.pickFile({
      title: 'Import Batch File',
      filters: [{ name: 'Text and Markdown files', extensions: ['txt', 'md'] }]
    });
    if (!pickResult.ok || pickResult.canceled) return;

    const readResult = await window.api.fbRead(pickResult.path);
    if (!readResult.ok) {
      toast('Failed to read file: ' + readResult.error, 'err');
      return;
    }

    const base64 = readResult.base64;
    const content = decodeURIComponent(escape(atob(base64)));

    const lines = content.split(/\r?\n/);
    const importedBatches = { image: [], speech: [], music: [], video: [] };
    let importCount = 0;
    let defectiveCount = 0;

    for (let line of lines) {
      line = line.trim();
      if (!line) continue;

      if (line.startsWith('|') && line.endsWith('|')) {
        const parts = line.split('|').map(s => s.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
        if (parts.every(p => p.startsWith('-') || p === '')) continue;
        if (parts[0].toLowerCase() === 'type' || parts[1]?.toLowerCase().includes('prompt')) continue;

        if (parts.length >= 2) {
          const type = parts[0].toLowerCase();
          const prompt = parts[1];
          const paramStr = parts[2] || '';

          if (['image', 'speech', 'music', 'video'].includes(type) && prompt) {
            const params = parseParams(paramStr);
            const entry = buildImportedEntry(type, prompt, params);
            if (entry._defective) defectiveCount++;
            importedBatches[type].push(entry);
            importCount++;
          }
        }
      } else if (line.includes('|')) {
        const parts = line.split('|').map(s => s.trim());
        if (parts.length >= 2) {
          const type = parts[0].toLowerCase();
          const prompt = parts[1];
          const paramStr = parts[2] || '';

          if (['image', 'speech', 'music', 'video'].includes(type) && prompt) {
            const params = parseParams(paramStr);
            const entry = buildImportedEntry(type, prompt, params);
            if (entry._defective) defectiveCount++;
            importedBatches[type].push(entry);
            importCount++;
          }
        }
      }
    }

    if (importCount === 0) {
      toast('No valid asset requests found in the file. Check formatting.', 'warn');
      return;
    }

    showModal((m, close) => {
      m.appendChild(el('h2', {}, 'Import Batch Requests'));
      m.appendChild(el('p', { style: 'color: var(--fg-2); font-size: 13px;' },
        `Found ${importCount} asset requests in the file:`));
      
      const countsList = el('ul', { style: 'margin: 8px 0 16px 20px; font-size: 12px; color: var(--fg-2);' });
      for (const [type, list] of Object.entries(importedBatches)) {
        if (list.length > 0) {
          countsList.appendChild(el('li', {}, `${type.toUpperCase()}: ${list.length} item(s)`));
        }
      }
      m.appendChild(countsList);

      // Warn about entries that failed the parameter check. They are
      // imported but marked defective: the BatchGen runner skips them and
      // the queue editor (✎) lets the user fix the flagged settings.
      if (defectiveCount > 0) {
        m.appendChild(el('div', {
          style: 'margin: 0 0 12px; padding: 8px 10px; border: 1px solid var(--danger); border-radius: var(--radius-sm); background: rgba(255,138,138,0.08); color: var(--danger); font-size: 12.5px;',
        }, `⚠ ${defectiveCount} item${defectiveCount === 1 ? '' : 's'} ha${defectiveCount === 1 ? 's' : 've'} invalid settings and ${defectiveCount === 1 ? 'is' : 'are'} marked defective. They will be imported and kept in the queue but skipped during generation until you repair them in the queue editor (✎).`));
      }

      m.appendChild(el('p', { style: 'font-size: 12px; font-weight: bold;' }, 'Choose how to import these items:'));

      // v1.1.29 (user request): combined styles + import. The user
      // can attach a style preset to the imported batch in one
      // step. When enabled:
      //   - The preset is saved into the global config.styles list
      //     (de-duped by name) so it persists across sessions and
      //     shows up in every tab's style dropdown.
      //   - Every imported entry gets `style: <name>` stamped on it,
      //     which the existing BatchGen runner (batchManager.js
      //     `item.style` handling) picks up to pre-select the
      //     dropdown + prepend the value via buildFinalPrompt when
      //     the row generates.
      // The whole "style preset" feature is opt-in: a user who just
      // wants the prompts and will pick a style per-tab in the
      // editor can leave the checkbox off and the import is
      // unchanged.
      const styleBox = el('div', {
        style: 'margin: 4px 0 14px; padding: 10px 12px; border: 1px solid var(--border-2); border-radius: var(--radius-sm); background: rgba(255,255,255,0.02);',
      });
      const styleCb = el('input', { type: 'checkbox' });
      styleCb.id = 'batch-import-style-enabled';
      const styleCbLabel = el('label', {
        for: 'batch-import-style-enabled',
        style: 'font-size: 12.5px; cursor: pointer; user-select: none;',
      }, ' Apply a style preset to all items in this batch');
      const styleCbRow = el('div', {}, [styleCb, styleCbLabel]);
      const styleFields = el('div', { style: 'margin: 8px 0 0 22px; display: none;' });
      const styleNameInput = el('input', {
        type: 'text',
        placeholder: 'Style name (e.g. "Imported batch — Watercolour")',
        style: 'width: 100%; margin-bottom: 6px;',
      });
      const styleValueInput = el('textarea', {
        placeholder: 'Style value — text prepended to every prompt (e.g. "watercolour, soft lighting, 35mm")',
        style: 'width: 100%; min-height: 56px;',
      });
      styleFields.appendChild(styleNameInput);
      styleFields.appendChild(styleValueInput);
      styleFields.appendChild(el('p', {
        style: 'margin: 6px 0 0; font-size: 11.5px; color: var(--fg-2);',
      }, 'The preset is saved to the global style list (used by every tab) AND pre-selected for every imported entry, so BatchGen prepends it automatically when each item runs.'));
      styleBox.appendChild(styleCbRow);
      styleBox.appendChild(styleFields);
      m.appendChild(styleBox);
      styleCb.addEventListener('change', () => {
        styleFields.style.display = styleCb.checked ? '' : 'none';
      });

      const overwriteBtn = el('button', { class: 'primary' }, 'Overwrite existing queues');
      const appendBtn = el('button', {}, 'Append to existing queues');
      const cancelBtn = el('button', { class: 'btn-mini' }, 'Cancel');

      // Bug-fix A5 (double-click guard): disable the
      // committing buttons (Overwrite + Append) for the
      // duration of the in-flight applyStyleIfRequested await,
      // so an impatient double-click can't fire two
      // setConfig / batchesSet round-trips in parallel.
      // Cancel stays enabled — the user must always be able to
      // abort. The buttons are re-enabled on every return path
      // (success, validation failure, IPC failure) so a
      // rejected style write doesn't permanently lock the
      // dialog.
      const setCommitButtonsBusy = (busy) => {
        overwriteBtn.disabled = !!busy;
        appendBtn.disabled = !!busy;
        // also re-style so the user can see the lock visually
        overwriteBtn.style.opacity = busy ? '0.5' : '';
        appendBtn.style.opacity = busy ? '0.5' : '';
        overwriteBtn.style.cursor = busy ? 'wait' : '';
        appendBtn.style.cursor = busy ? 'wait' : '';
      };

      async function applyStyleIfRequested() {
        if (!styleCb.checked) return '';
        const n = String(styleNameInput.value || '').trim();
        const v = String(styleValueInput.value || '').trim();
        if (!n || !v) {
          toast('Style name and value are required to apply a style, or uncheck the box.', 'warn', 5000);
          return '';
        }
        const savedName = await applyStyleToImportedBatch({ name: n, value: v });
        if (savedName) stampStyleOnImportedBatch(importedBatches, savedName);
        return savedName;
      }

      overwriteBtn.addEventListener('click', async () => {
        if (overwriteBtn.disabled) return;
        setCommitButtonsBusy(true);
        try {
          const applied = await applyStyleIfRequested();
          if (styleCb.checked && !applied) return;
          const next = { ...state.batches };
          for (const type of ['image', 'speech', 'music', 'video']) {
            next[type] = importedBatches[type].slice(0, 100);
          }
          await saveImported(next);
          close();
        } finally {
          setCommitButtonsBusy(false);
        }
      });

      appendBtn.addEventListener('click', async () => {
        if (appendBtn.disabled) return;
        setCommitButtonsBusy(true);
        try {
          const applied = await applyStyleIfRequested();
          if (styleCb.checked && !applied) return;
          const next = { ...state.batches };
          for (const type of ['image', 'speech', 'music', 'video']) {
            next[type] = [...(state.batches[type] || []), ...importedBatches[type]].slice(0, 100);
          }
          await saveImported(next);
          close();
        } finally {
          setCommitButtonsBusy(false);
        }
      });

      cancelBtn.addEventListener('click', () => close());

      const footer = el('div', { class: 'footer', style: 'display: flex; gap: 8px; justify-content: flex-end;' }, [cancelBtn, appendBtn, overwriteBtn]);
      m.appendChild(footer);
    });

    async function saveImported(nextBatches) {
      const r = await window.api.batchesSet(nextBatches);
      if (!r.ok) {
        toast('Failed to save imported batches: ' + r.error, 'err');
        return;
      }
      state.batches = nextBatches;
      _refreshBatchButtons();
      toast(`Successfully imported batch requests!`, 'ok');
    }

  } catch (err) {
    toast('Error parsing file: ' + err.message, 'err');
    console.error(err);
  }
}

async function generateExampleFiles() {
  try {
    // v1.1.13 (reported by user): the user's picked format
    // (⚙ Settings → BatchGen → "Example export format") is
    // passed to the IPC. The IPC writes BOTH files first (so
    // the other one is always fresh if the user switches
    // formats later), then deletes the one the user did NOT
    // pick. So the user only ever sees a single file in their
    // output folder.
    const fmt = state.batchesExportFormat || 'md';
    const r = await window.api.batchesGenerateExamples(fmt);
    if (r.ok) {
      // Bug-fix (2026-06-19): examples now land in the user's
      // output folder (the same one the file browser shows), not
      // next to the .exe. The old message was misleading because
      // the examples were actually written inside the asar
      // archive (read-only) and the user got an ENOENT error.
      const finalPath = r.path || '';
      const dir = finalPath
        ? finalPath.replace(/[\\/]example_batch_import\.[a-z]+$/i, '')
        : (r.mdPath || '').replace(/[\\/]example_batch_import\.[a-z]+$/i, '') || 'your output folder';
      const finalName = finalPath ? finalPath.split(/[\\/]/).pop() : (fmt === 'txt' ? 'example_batch_import.txt' : 'example_batch_import.md');
      toast(`Examples generated in ${dir}: ${finalName}`, 'ok', 5000);
    } else {
      toast('Failed to generate examples: ' + r.error, 'err');
    }
  } catch (err) {
    toast('Error: ' + err.message, 'err');
  }
}

async function startAllBatchGen() {
  const tabsToRun = [];
  for (const type of ['image', 'speech', 'music', 'video']) {
    const n = (state.batches[type] || []).length;
    if (n > 0) {
      tabsToRun.push(type);
    }
  }

  if (tabsToRun.length === 0) {
    toast('All batch queues are empty.', 'warn');
    return;
  }

  if (!state.config.api_key) {
    toast('No API key configured. Click ⚙ to open Settings.', 'err');
    return;
  }

  const confirmMsg = `This will generate batch items across all tabs sequentially:\n` +
    tabsToRun.map(t => `- ${t.toUpperCase()}: ${(state.batches[t] || []).length} items`).join('\n') +
    `\n\nStart processing now?`;
  if (!confirm(confirmMsg)) return;

  // bug-fix Phase2 (_temp4.md): startBatchGen owns window._batchAbortByTab
  // (keyed per tab — see batchManager.js for why the old shared
  // `_batchAbort` was wrong). This loop runs each tab SEQUENTIALLY
  // (awaited, never concurrent with itself), so after each tab finishes
  // we check whether ITS flag was set — i.e. the user clicked "■ Stop
  // batch" on that tab's overlay DURING this dashboard-driven run — and
  // if so, stop walking the rest of the tabs too (preserving the
  // existing "one stop halts the whole sequential chain" behaviour
  // without reintroducing a flag shared with independent, concurrent
  // per-tab "Start BatchGen" runs).
  for (const type of tabsToRun) {
    // Switch to the active generating tab so the user sees progress
    showTab(type);

    // Start batchgen and wait for completion
    await startBatchGen(type);

    if (window._batchAbortByTab && window._batchAbortByTab[type]) {
      toast('Global batch generation aborted.', 'warn');
      break;
    }
  }
}

// Bind to window
window.BatchManager = window.BatchManager || {};
window.BatchManager.importBatchFileDialog = importBatchFileDialog;
window.BatchManager.generateExampleFiles = generateExampleFiles;
window.BatchManager.startAllBatchGen = startAllBatchGen;
window.BatchManager.parseParams = parseParams;
// Bug-fix #5 (2026-06-19): exposed so batchManager.js (the editor)
// can call them and so tests can import them without DOM shims.
window.BatchManager.batchEntryText = batchEntryText;
window.BatchManager.withBatchEntryText = withBatchEntryText;
