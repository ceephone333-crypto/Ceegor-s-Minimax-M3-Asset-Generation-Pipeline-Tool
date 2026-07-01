// renderer/sections/section05_Context_menu_for_preview_thumbnails___overlay.js (Phase 3 Block 29)
// Extracted: Context menu for preview thumbnails + overlay
// Source: app.js L4013..4218

// ----------------- Context menu for preview thumbnails + overlay -----------------
// Right-click context menu for image thumbnails in the picture
// preview pane and for the full-size image overlay. Mirrors the
// folder-browser context menu (showItemContextMenu) — the same
// Upscale / Crop / Convert / Optimize / Remove-background pipeline
// entries are available, plus the file-level Copy / Cut / Rename /
// Move / Delete actions. The same context menu is reused for both
// entry points so behaviour stays consistent.
//
// The helpers accept either:
//   - a full fs-item record (as returned by the main process and
//     cached in state._fbItems), or
//   - just a path string (for the preview pane / overlay where the
//     caller doesn't have the full record). When only a path is
//     given we synthesise a minimal item on the fly so the same
//     action handlers can be reused.
function buildItemFromPath(path) {
  if (!path || typeof path !== 'string') return null;
  const parts = path.split(/[\\/]/).filter(Boolean);
  const name = parts.length ? parts[parts.length - 1] : path;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot).toLowerCase() : '';
  return {
    path,
    name,
    ext,
    isDir: false,
    size: 0,
    mtimeMs: 0,
    birthtimeMs: 0,
    _synthesised: true,
  };
}
function showItemContextMenuForPath(path, x, y) {
  let it = (state._fbItems || []).find((it) => it.path === path);
  if (!it) it = buildItemFromPath(path);
  if (!it) return;
  showItemContextMenu(it, x, y);
}

// Standalone "Remove background" action triggered by the folder
// browser's right-click context menu. Unlike the in-tab flow
// (which is gated on the upscaling popup's checkbox) and the
// right-click "Upscale" dialog (which can chain upscale →
// crop → background removal in one step), this is a single-shot
// "drop the alpha, write <name>_nobg.png next to it" — the user
// picks an existing image, the wrapper runs, the result appears
// in the preview pane + the file browser.
//
// We pre-flight the binary / model probe so the user sees a
// precise error message ("binary not installed" vs "model
// missing") instead of a generic failure toast.
async function runRemoveBackgroundOnItem(it, targets) {
  // Multi-select batch (2026-07-01): when ≥2 images are checked in the
  // folder explorer, run background removal on every one after the
  // binary/model pre-flight passes once.
  const batch = Array.isArray(targets) && targets.length > 1 ? targets.slice() : null;
  let st = await probeIsnetbgStatus();
  if (!st.checked) {
    toast('Could not contact background-removal backend.', 'err', 5000);
    return;
  }
  if (!st.available) {
    toast('Background removal not set up. Run "npm run setup" to download the IS-Net model, or open the add-ons manager (⚙ Settings → Image upscaling → Re-open add-ons).', 'err', 8000);
    return;
  }
  if (!st.modelPresent) {
    toast('isnetbg model file missing — drop isnet-general-use.onnx into ./bin/models/.', 'err', 6000);
    return;
  }
  if (batch) {
    // One pre-flight, then loop every checked image.
    toast(`Removing background from ${batch.length} images…`, 'info', 2500);
    await runImagePipelineBatch('Remove background', batch, (p) => removeBackgroundFile(p));
    return;
  }
  // Show a brief progress toast so the user knows the action was
  // received. The actual binary run can take a few seconds on CPU
  // (longer on large images), and the binary doesn't stream
  // progress — so we rely on a single "Working…" toast and then a
  // final success / failure toast.
  setStatus('Removing background…', true);
  toast('Removing background…', 'info', 2000);
  try {
    const out = await removeBackgroundFile(it.path);
    setStatus('Background removed.', false);
    toast(`Background removed → ${out}`, 'ok', 4000);
    try { await refreshBrowser(); } catch (_) {}
    if (typeof previewImageFromFile === 'function') {
      try { previewImageFromFile(out); } catch (_) {}
    }
  } catch (e) {
    console.error('Remove background failed:', e);
    setStatus('Background removal failed.', false);
    toast('Background removal failed: ' + (e && e.message || e), 'err', 6000);
  }
}
// Phase 3 Block 5: formatDate() extrahiert nach FormatUtils.js
// als formatLocalShort(). Drop-in-Alias unten.
const { formatLocalShort: formatDate } = window.FormatUtils;

function promptRename(it) {
  showModal((m, close) => {
    m.appendChild(el('h2', {}, 'Rename'));
    const inp = el('input', { type: 'text', value: it.name });
    m.appendChild(el('div', { class: 'row' }, [el('label', {}, 'New name'), inp]));
    const ok = el('button', { class: 'primary' }, 'Rename');
    const cancel = el('button', { onclick: close }, 'Cancel');
    ok.addEventListener('click', async () => {
      const newName = inp.value.trim();
      if (!newName) { toast('Name is required.', 'warn'); return; }
      if (newName === it.name) { close(); return; }
      const r = await window.api.fbRename(it.path, newName);
      if (!r.ok) { toast('Rename failed: ' + r.error, 'err'); return; }
      toast('Renamed.', 'ok');
      await refreshBrowser();
      close();
    });
    m.appendChild(el('div', { class: 'footer' }, [cancel, ok]));
  });
}

async function promptMove(it) {
  const dest = await window.api.pickFolder();
  if (!dest) return;
  const r = await window.api.fbMove(it.path, dest);
  if (!r.ok) toast(r.error, 'err'); else {
    toast('Moved.', 'ok');
    // Same as confirmDelete: if the moved file was being previewed,
    // the preview pane now has a broken file:// URL. Clear it.
    if (!it.isDir && state._selected && state._selected.path === it.path) {
      previewImageFromFile(null);
    }
    await refreshBrowser();
  }
}

async function confirmDelete(it) {
  showModal((m, close) => {
    m.appendChild(el('h2', {}, 'Delete ' + (it.isDir ? 'folder' : 'file') + '?'));
    m.appendChild(el('p', {}, it.path));
    if (it.isDir) m.appendChild(el('p', { style: 'color: var(--danger);' }, 'This will recursively delete the folder and all its contents.'));
    const ok = el('button', { class: 'danger' }, 'Delete');
    const cancel = el('button', { onclick: close }, 'Cancel');
    ok.addEventListener('click', async () => {
      const r = await window.api.fbDelete(it.path);
      if (!r.ok) toast(r.error, 'err'); else { toast('Deleted.', 'ok'); await refreshBrowser(); }
      // If the deleted file was the one being previewed, clear the
      // preview pane — the previous code left a broken <img> with an
      // invalid file:// URL, which Chromium would log as a console
      // error every time the user opened a different file.
      if (!it.isDir && state._selected && state._selected.path === it.path) {
        previewImageFromFile(null);
      }
      close();
    });
    m.appendChild(el('div', { class: 'footer' }, [cancel, ok]));
  });
}

async function promptNewFolder() {
  const dir = state.fbDir || state.config.output_dir || '';
  if (!dir) { toast('No output directory set. Configure in Settings.', 'warn'); return; }
  showModal((m, close) => {
    m.appendChild(el('h2', {}, 'New folder'));
    const inp = el('input', { type: 'text', value: 'New folder' });
    m.appendChild(el('div', { class: 'row' }, [el('label', {}, 'Folder name'), inp]));
    m.appendChild(el('div', { class: 'footer' }, [
      el('button', { onclick: close }, 'Cancel'),
      el('button', { class: 'primary', onclick: async () => {
        const name = inp.value.trim();
        if (!name) { toast('Folder name is required.', 'warn'); return; }
        const r = await window.api.fbMkdir(dir, name);
        if (!r.ok) { toast('Create failed: ' + r.error, 'err'); return; }
        toast('Created.', 'ok');
        await refreshBrowser();
        close();
      } }, 'Create'),
    ]));
  });
}
// Phase 3 Block 12: _quotaSeg() + _formatQuotaModel() extrahiert
// nach renderer/utils/quotaFormatter.js. Pure Format-Logik,
// 0 App-Coupling (nur escapeHtml über window).
const { quotaSeg: _quotaSeg, formatQuotaModel: _formatQuotaModel } = window.QuotaFormatter;
async function refreshQuota() {
  if (typeof window.logAction === 'function') window.logAction('quota', 'refresh-start');
  const el2 = $('#quota-value');
  el2.innerHTML = '<span class="spinner"></span>';
  const r = await window.api.quota();
  if (!r.ok) { el2.textContent = r.error || '—'; return; }
  // The mmx CLI has returned the quota in a few different shapes depending
  // on the version. Try the documented one first (`model_remains` at root
  // or under `data`), then fall back to other common shapes.
  const data = r.parsed;
  let models = null;
  if (data) {
    if (Array.isArray(data.model_remains)) models = data.model_remains;
    else if (Array.isArray(data.models)) models = data.models;
    else if (Array.isArray(data.data && data.data.model_remains)) models = data.data.model_remains;
    else if (Array.isArray(data.quota)) models = data.quota;
  }
  if (!models || !models.length) {
    // No recognizable models — log the raw response so the user can see
    // exactly what the API is returning (helps diagnose shape changes
    // between mmx-cli versions). Truncate to keep the log readable.
    try {
      const raw = JSON.stringify(data).slice(0, 4000);
      log(`[quota] unexpected response shape — raw: ${raw}${raw.length >= 4000 ? '…' : ''}`);
    } catch (_) { /* ignore circular refs etc. */ }
    el2.textContent = 'no data';
    return;
  }
  const parts = models.map(_formatQuotaModel);
  el2.innerHTML = parts.join(' · ');
}

