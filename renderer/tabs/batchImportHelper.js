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
    
    let label = labelEl.textContent.trim().toLowerCase();
    
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

window.BatchManager = window.BatchManager || {};
window.BatchManager.buildImportedEntry = buildImportedEntry;
window.BatchManager.reconstructParamStr = reconstructParamStr;

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

      const overwriteBtn = el('button', { class: 'primary' }, 'Overwrite existing queues');
      const appendBtn = el('button', {}, 'Append to existing queues');
      const cancelBtn = el('button', { class: 'btn-mini' }, 'Cancel');

      overwriteBtn.addEventListener('click', async () => {
        const next = { ...state.batches };
        for (const type of ['image', 'speech', 'music', 'video']) {
          next[type] = importedBatches[type].slice(0, 100);
        }
        await saveImported(next);
        close();
      });

      appendBtn.addEventListener('click', async () => {
        const next = { ...state.batches };
        for (const type of ['image', 'speech', 'music', 'video']) {
          next[type] = [...(state.batches[type] || []), ...importedBatches[type]].slice(0, 100);
        }
        await saveImported(next);
        close();
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

  _batchAbort = false;
  
  for (const type of tabsToRun) {
    if (_batchAbort) {
      toast('Global batch generation aborted.', 'warn');
      break;
    }
    
    // Switch to the active generating tab so the user sees progress
    showTab(type);
    
    // Start batchgen and wait for completion
    await startBatchGen(type);
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
