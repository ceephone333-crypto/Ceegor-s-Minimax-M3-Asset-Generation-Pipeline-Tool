// renderer/services/fileBrowser2.js (Phase 3 Block 27)
// Second half of the File browser section.

function markFbItemActive(path) {
  if (!path || typeof path !== 'string') return;
  const ul = $('#fb-list');
  if (!ul) return;
  // De-select all rows, then select the one matching `path`. The
  // pre-existing click handler also removes `.selected` from every
  // row first, so the behaviour is consistent.
  const target = path.toLowerCase();
  const rows = $$('.fb-item', ul);
  let match = null;
  for (const li of rows) {
    const isMatch = (li.getAttribute('data-path') || '').toLowerCase() === target;
    li.classList.toggle('selected', isMatch);
    if (isMatch) match = li;
  }
  if (match) {
    // Update state._selected so the right-click context menu operates
    // on the same item the user sees as "active" in the preview pane.
    // We only set _selected to a directory-shaped object if we have
    // an existing fs-item record; otherwise the context menu would
    // be missing the size/ext metadata. Look it up by path from the
    // last-rendered list (state._fbItems is populated by
    // refreshBrowser when we wired it up â€” see the read in the
    // helper below).
    if (Array.isArray(state._fbItems)) {
      const found = state._fbItems.find((it) => (it.path || '').toLowerCase() === target);
      if (found) state._selected = found;
    }
    // Scroll into view if needed. The "nearest" choice keeps the
    // current scroll position when the row is already visible, so
    // a click within the visible area doesn't jump the view.
    try { match.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) {}
  }
}

function previewImageFromFile(p) {
  // Images from the file browser go to the new Picture preview pane
  // (bottom-right of the log bar), not the tab's generation preview.
  // The tab's generation preview is reserved for content that the user
  // just generated. We pre-load the image to grab the natural dimensions
  // so the overlay has the right size info, and so the title hint shows.
  if (!p) {
    // Defensive: a null/empty path used to silently render a broken
    // img with src="" (the <img> onerror fired and the pane got a
    // tiny invisible placeholder). Reset to the empty state instead
    // so the user sees the "Click an image" hint again.
    const content = $('#fb-preview-content');
    if (content) content.innerHTML = '<div class="preview-pane-empty">Click an image in the file browser to preview it here.</div>';
    state._lastPreviewPath = null;
    state._previewBatch = null;
    return;
  }
  // If the user clicks the same file twice, the preview is already
  // showing it â€” don't waste a re-decode + flicker on the redundant
  // click. We compare on the file path (the naturalWidth wouldn't
  // have changed since the file didn't change).
  if (state._lastPreviewPath === p) return;
  state._lastPreviewPath = p;
  // A single-image preview always replaces the multi-image grid (if
  // any was showing). Clear _previewBatch so the image-overlay's
  // arrow-key handler doesn't try to navigate the now-stale batch.
  state._previewBatch = null;
  // Per the user's spec, the file shown in the preview pane should
  // always be the active row in the folder explorer. We mark it
  // BEFORE the async image decode so the highlight is instant and
  // does not flicker after the image paints.
  markFbItemActive(p);
  const url = fileUrl(p);
  const filename = (p || '').split(/[\\/]/).pop() || 'image';
  const preLoad = new Image();
  preLoad.onload = () => updatePreviewPane(url, filename, preLoad.naturalWidth, preLoad.naturalHeight, p);
  preLoad.onerror = () => updatePreviewPane(url, filename, 0, 0, p);
  preLoad.src = url;
}

// Multi-file variant of previewImageFromFile. Used by the image tab's
// generate handler after a batch (or --n > 1) run completes, so the
// user can see ALL the generated images at once in the right-side
// folder-explorer's preview pane. Single-file runs delegate to
// previewImageFromFile (the one big image looks the same as before).
//
// For 1 file: show a single fit-to-pane image (no behaviour change).
// For N files: divide the pane into N equal-width slots. Each slot
// shows a small thumbnail + the filename; clicking any thumbnail
// opens the image overlay at 1:1 mode (same flow as the file browser).
// The pane scrolls horizontally if there are too many thumbs to fit
// at the current pane width.
function previewImagesFromFiles(paths) {
  const content = $('#fb-preview-content');
  if (!content) return;
  if (!Array.isArray(paths) || !paths.length) {
    previewImageFromFile(null);
    return;
  }
  // Filter out null / empty paths so a single bad file in a batch
  // doesn't break the whole preview pane.
  const valid = paths.filter((p) => p && typeof p === 'string');
  if (!valid.length) {
    previewImageFromFile(null);
    return;
  }
  if (valid.length === 1) {
    // Single image â†’ the old behaviour, no subdivision needed.
    return previewImageFromFile(valid[0]);
  }
  // N > 1 â†’ grid of thumbnails. Build the container once, then async-
  // resolve each path's natural dimensions for the title hint.
  content.innerHTML = '';
  // Stash the current batch on state so the image overlay's
  // arrow-key handler (added in a later feature) can navigate to
  // the previous / next thumbnail without re-fetching the list
  // from the DOM. The first item in the list is marked as the
  // "currently active" one in the folder explorer (and the
  // preview-pane highlight) until the user clicks a different
  // thumbnail or uses the arrow keys.
  state._previewBatch = {
    paths: valid.slice(),
    // Index of the path that is currently considered "selected"
    // (mirrors what the folder explorer's .selected row is). The
    // openImageOverlay handler updates this on every arrow press.
    index: 0,
  };
  // Per the user's spec, the file shown in the preview pane (or
  // its full image viewer) must always be the active row in the
  // folder explorer. The first image of a freshly-shown batch is
  // the natural default.
  markFbItemActive(valid[0]);
  const grid = el('div', { class: 'preview-pane-grid' });
  for (let i = 0; i < valid.length; i++) {
    const p = valid[i];
    const filename = (p || '').split(/[\\/]/).pop() || 'image';
    const url = fileUrl(p) + '?t=' + Date.now();
    // data-path stores the filesystem path the slot represents.
    // The overlay's arrow-key handler reads it (via
    // navigateToOverlayImage) so the user can step through the
    // multi-image preview-pane thumbnails without losing track of
    // which file is currently highlighted.
    const slot = el('div', {
      class: 'preview-pane-thumb',
      title: filename + ' â€” click to view 1:1',
      'data-path': p,
    });
    if (i === 0) slot.classList.add('preview-active');
    const img = el('img', { src: url, alt: filename, loading: 'lazy' });
    const caption = el('div', { class: 'preview-pane-thumb-caption' }, filename);
    slot.append(img, caption);
    // Flag the click handler attachment so the slow-disk fallback
    // below doesn't double-bind (the previous code used
    // `if (!slot.onclick)`, but addEventListener doesn't write to
    // `.onclick` â€” so both the onload path and the setTimeout path
    // attached a listener, and a single click opened the overlay
    // twice in a row).
    let clickBound = false;
    const bind = (w, h) => {
      if (clickBound) return;
      clickBound = true;
      const open = () => {
        // Update the "selected" thumbnail + folder-explorer's
        // active row so both stay in sync with the user's last
        // action. (The arrow-key handler in openImageOverlay
        // does the same thing on every keypress.) We look up
        // the index in `state._previewBatch.paths` (which is a
        // slice copy of `valid`) rather than comparing array
        // references â€” the previous `===` check was always false
        // because `valid` is created fresh and then sliced into
        // the batch, so the index update was silently dropped.
        if (state._previewBatch && Array.isArray(state._previewBatch.paths)) {
          const found = state._previewBatch.paths.findIndex((q) => (q || '').toLowerCase() === p.toLowerCase());
          if (found >= 0) state._previewBatch.index = found;
        }
        $$('.preview-pane-thumb', grid).forEach((n) => n.classList.remove('preview-active'));
        slot.classList.add('preview-active');
        markFbItemActive(p);
        if (w && h) openImageOverlay(url, filename, w, h, p);
        else openImageOverlay(url, filename, 0, 0, p);
      };
      slot.addEventListener('click', open, { once: true });
    };
    // Resolve the natural size async so the overlay can show it.
    const probe = new Image();
    probe.onload = () => {
      slot.title = `${filename} (${probe.naturalWidth}Ã—${probe.naturalHeight}) â€” click to view 1:1`;
      bind(probe.naturalWidth, probe.naturalHeight);
    };
    probe.onerror = () => bind(0, 0);
    probe.src = url;
    // Fallback: if the probe never resolves (slow disk), still allow a
    // click so the user isn't locked out of the overlay.
    setTimeout(() => bind(0, 0), 3000);
    grid.appendChild(slot);
  }
  content.appendChild(grid);
  // Below the grid, a small summary line so the user knows how many
  // images they got (and the click hint).
  const summary = el('div', { class: 'preview-pane-summary' },
    `${valid.length} image${valid.length === 1 ? '' : 's'} â€” click any thumbnail to open at 1:1.`);
  content.appendChild(summary);
}

// Render the file-browser image into the new Picture preview pane.
// The image is fit-to-content (object-fit: contain in the CSS) so a
// 4K screenshot is shown shrunken and a tiny icon stays at its natural
// size â€” both rendered completely, no cropping. Clicking the image
// (or the filename) opens the image overlay at 1:1 mode.
function updatePreviewPane(src, filename, naturalWidth, naturalHeight, filePath) {
  const content = $('#fb-preview-content');
  if (!content) return;
  content.innerHTML = '';
  const size = (naturalWidth && naturalHeight) ? ` (${naturalWidth}Ã—${naturalHeight})` : '';
  const img = el('img', {
    src,
    alt: filename || '',
    title: (filename || '') + size + ' â€” click to view 1:1',
  });
  img.addEventListener('click', () => {
    openImageOverlay(src, filename, naturalWidth, naturalHeight, filePath);
  });
  content.appendChild(img);
  const fname = el('div', { class: 'preview-pane-filename', title: filename || '' },
    (filename || '') + size);
  content.appendChild(fname);
}

// Track the paths that have already been pushed to the preview
// pane for the current multi-image batch (or single-image preview).
// Used by notifyImageGenerated() to dedupe â€” the same file can
// arrive via the gen handler's "variant complete" callback AND
// the 1s polling, so without this set we'd double-add thumbnails.
// Keyed on lowercase path so a Windows path-case change doesn't
// produce duplicates either.
let _previewedPaths = new Set();
function _resetPreviewedPaths() {
  _previewedPaths = new Set();
}

// Build a single thumbnail slot for the multi-image preview pane.
// Extracted from previewImagesFromFiles so notifyImageGenerated
// can use the same DOM shape when appending new variants. The
// returned slot is already wired up (click handler + data-path)
// and the "preview-active" class is applied if `isActive` is
// true.
function _buildPreviewThumb(p, options) {
  const opts = options || {};
  const filename = (p || '').split(/[\\/]/).pop() || 'image';
  const cacheBust = opts.cacheBust !== false ? ('?t=' + Date.now()) : '';
  const url = fileUrl(p) + cacheBust;
  const slot = el('div', {
    class: 'preview-pane-thumb',
    title: filename + ' â€” click to view 1:1',
    'data-path': p,
  });
  if (opts.isActive) slot.classList.add('preview-active');
  if (opts.isNew) slot.classList.add('preview-new');
  const img = el('img', { src: url, alt: filename, loading: 'lazy' });
  const caption = el('div', { class: 'preview-pane-thumb-caption' }, filename);
  slot.append(img, caption);
  let clickBound = false;
  const bind = (w, h) => {
    if (clickBound) return;
    clickBound = true;
    const open = () => {
      // Update active selection â€” the user's last action wins.
      $$('.preview-pane-thumb').forEach((n) => n.classList.remove('preview-active'));
      slot.classList.add('preview-active');
      if (state._previewBatch) {
        const i = state._previewBatch.paths.findIndex((q) => (q || '').toLowerCase() === p.toLowerCase());
        if (i >= 0) state._previewBatch.index = i;
      }
      markFbItemActive(p);
      if (w && h) openImageOverlay(url, filename, w, h, p);
      else openImageOverlay(url, filename, 0, 0, p);
    };
    slot.addEventListener('click', open, { once: true });
    // Right-click: open the full folder-browser context menu
    // for this path. The preview pane is just a shortcut to
    // the same actions (Upscale / Crop / Convert / Optimize /
    // Remove background + file-level Copy / Cut / Rename /
    // Move / Delete).
    slot.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { showItemContextMenuForPath(p, e.clientX, e.clientY); }
      catch (_) { /* silent — context menu is best-effort */ }
    });
  };
  const probe = new Image();
  probe.onload = () => {
    slot.title = `${filename} (${probe.naturalWidth}Ã—${probe.naturalHeight}) â€” click to view 1:1`;
    bind(probe.naturalWidth, probe.naturalHeight);
  };
  probe.onerror = () => bind(0, 0);
  probe.src = url;
  setTimeout(() => bind(0, 0), 3000);
  return slot;
}

// Live-update hook: an image was just generated and the user
// wants the UI to react instantly (folder-explorer blink +
// preview-pane thumbnail + active-row mark) without waiting
// for the full generation run to finish. Called from:
//   1. The image tab's gen handler after each variant (when
//      the output path is known in advance â€” i.e. not
//      --out-dir runs).
//   2. The 1s polling timer in startGenPolling() that watches
//      the output directory for new files (catches --out-dir
//      runs, plus any variant the gen handler missed).
//
// Idempotent: if the same path is reported twice (e.g. both
// the gen handler AND the polling saw it), the second call
// is a no-op â€” we use the lowercased path as the dedup key
// via _previewedPaths.
function notifyImageGenerated(p) {
  if (!p || typeof p !== 'string') return;
  const key = p.toLowerCase();
  if (_previewedPaths.has(key)) return;
  _previewedPaths.add(key);
  // 1. Push the path to the multi-image batch so the thumbnail
  //    shows up in the preview pane. If no batch is currently
  //    active, we start one with just this file (the user can
  //    then continue to add more). The new thumbnail is marked
  //    with the "preview-new" class so the CSS can briefly
  //    highlight it.
  if (!state._previewBatch) {
    state._previewBatch = { paths: [p], index: 0 };
  } else if (!state._previewBatch.paths.includes(p)) {
    state._previewBatch.paths.push(p);
  }
  // 2. Re-render the preview pane. If a grid already exists,
  //    we APPEND a new slot instead of re-creating everything
  //    (preserves the existing thumbnails + their click
  //    handlers). If the grid doesn't exist yet (e.g. the
  //    user is on a non-image tab), this is a no-op â€” the
  //    next refreshBrowser() will pick up the file in the
  //    folder explorer.
  const content = $('#fb-preview-content');
  if (content) {
    let grid = content.querySelector('.preview-pane-grid');
    if (!grid) {
      // No grid yet â€” build one with just this file.
      content.innerHTML = '';
      grid = el('div', { class: 'preview-pane-grid' });
      content.appendChild(grid);
      const summary = el('div', { class: 'preview-pane-summary' }, '1 image â€” click any thumbnail to open at 1:1.');
      content.appendChild(summary);
    } else {
      // Grid already there â€” update the "N images" summary line
      // (if present) so the user can see the count grow.
      const summary = content.querySelector('.preview-pane-summary');
      if (summary) {
        const n = grid.querySelectorAll('.preview-pane-thumb').length + 1;
        summary.textContent = `${n} image${n === 1 ? '' : 's'} â€” click any thumbnail to open at 1:1.`;
      }
    }
    const slot = _buildPreviewThumb(p, { isActive: true, isNew: true });
    grid.appendChild(slot);
  }
  // 3. Mark the file as active in the folder explorer (and scroll
  //    the row into view if it's off-screen).
  markFbItemActive(p);
}

// Polling timer for "live" updates to the folder explorer while
// a generation is in flight. We poll every 1s instead of using
// a more reactive mechanism (chokidar / fs.watch) because:
//   - Polling is OS-agnostic and doesn't add a dependency.
//   - 1s is fast enough for the user to feel "live" but slow
//     enough to be invisible on the IPC channel.
//   - It gracefully handles the --out-dir case where the
//     renderer doesn't know the per-call output filenames and
//     so can't be told by the gen handler.
//
// The poll only runs while state.generating is set; we start
// it from startGenPolling() and stop it from stopGenPolling(),
// both called from armGenBtnWithCancel (start) and its cleanup
// (stop). The poller's main work is:
//   1. List the current fbDir.
//   2. Diff against the previous list (state._lastPolledItems).
//   3. For each new file, call notifyImageGenerated(path) +
//      add a ".fb-item-new" class to its row in the folder
//      explorer so the CSS blink animation runs.
//   4. Refresh the folder explorer's items snapshot.
let _genPollTimer = null;
let _genPollBusy = false;
async function startGenPolling() {
  // Defensive: never start two pollers at once.
  if (_genPollTimer) return;
  // Snapshot the current items so the first tick doesn't see
  // "everything is new" (the generation might have started
  // with files already in the folder).
  try {
    const r = await window.api.fbList(state.fbDir);
    if (r && r.ok) state._lastPolledItems = (r.items || []).map((it) => it.path);
  } catch (_) {
    state._lastPolledItems = [];
  }
  // Reset the dedup set so the polling starts fresh for this
  // run (the gen handler may have already pushed some files
  // before the poller started, which is fine â€” notifyImageGenerated
  // is idempotent and the polling won't see them as new).
  _resetPreviewedPaths();
  const tick = async () => {
    _genPollTimer = null;
    if (!state.generating) return;
    if (_genPollBusy) return; // skip overlapping ticks
    _genPollBusy = true;
    try {
      const r = await window.api.fbList(state.fbDir);
      if (!r || !r.ok) return;
      const newItems = r.items || [];
      const newPaths = newItems.map((it) => it.path);
      const prev = new Set((state._lastPolledItems || []).map((p) => p.toLowerCase()));
      const fresh = newPaths.filter((p) => !prev.has(p.toLowerCase()));
      // 1. Re-render the file-browser list so the new file is
      //    visible + get the new state._fbItems snapshot.
      const sorted = sortFbItems(newItems, state.fbSort);
      renderFbList(sorted);
      applyFileSearch();
      state._lastPolledItems = newPaths;
      // 2. For each newly-discovered file, run it through the
      //    same live-update pipeline the gen handler uses. This
      //    covers the --out-dir case (where the gen handler
      //    doesn't know the per-call output filenames).
      for (const p of fresh) {
        // Only push as a thumbnail if it's an image file â€”
        // the gen pipeline produces .png / .jpg / .jpeg / .webp.
        const ext = (p.split('.').pop() || '').toLowerCase();
        if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
          notifyImageGenerated(p);
        }
        // Add the .fb-item-new class to the matching row so the
        // CSS blink animation runs. We look it up by data-path
        // because the re-render above just created fresh DOM
        // nodes (so the old node references are stale).
        const row = document.querySelector(`.fb-item[data-path="${CSS.escape(p)}"]`);
        if (row) row.classList.add('fb-item-new');
      }
    } catch (_) {
      // Don't let a transient IPC error kill the poller â€” just
      // try again on the next tick.
    } finally {
      _genPollBusy = false;
      // Schedule the next tick only if we're still generating.
      // The next tick is re-armed here (rather than via a
      // setInterval) so an error inside tick() doesn't queue
      // up overlapping polls.
      if (state.generating) _genPollTimer = setTimeout(tick, 1000);
    }
  };
  _genPollTimer = setTimeout(tick, 1000);
}
function stopGenPolling() {
  if (_genPollTimer) { clearTimeout(_genPollTimer); _genPollTimer = null; }
  state._lastPolledItems = null;
}

function previewAudioFromFile(p) {
  const root = $(`#tab-${state.currentTab} .preview`);
  if (!root) return;
  const url = fileUrl(p);
  root.innerHTML = '';
  root.appendChild(el('audio', { controls: '', src: url }));
  root.appendChild(el('div', { class: 'meta' }, p));
}

async function previewTextFromFile(p) {
  const root = $(`#tab-${state.currentTab} .preview`);
  if (!root) return;
  const r = await window.api.fbRead(p);
  root.innerHTML = '';
  if (!r.ok) { root.innerHTML = '<div class="empty">Cannot read: ' + escapeHtml(r.error) + '</div>'; return; }
  // Decode base64 â†’ binary string â†’ UTF-8 text. Plain `atob` only gives a
  // Latin-1 binary string, which mangles non-ASCII characters. TextDecoder
  // with {fatal: false} replaces invalid sequences with U+FFFD instead of
  // throwing, so partially-decodable files still display.
  let txt = '';
  try {
    const bin = atob(r.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    txt = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch (_) {
    // Fallback to the old (Latin-1-ish) decoding if TextDecoder is missing
    txt = atob(r.base64);
  }
  const pre = el('pre', { class: 'meta', style: 'white-space: pre-wrap; max-height: 60vh; overflow: auto;' }, txt);
  root.appendChild(pre);
  root.appendChild(el('div', { class: 'meta' }, p));
}

// In-app clipboard for the file browser. The OS clipboard is shared via the
// browser's native copy/paste (Ctrl+C / Ctrl+X / Ctrl+V on selected items),
// but the in-app file ops use this list so we can track cut vs. copy
// semantics and undo a paste on failure.
let _fbClipboard = null; // { op: 'copy' | 'cut', paths: string[] }

function fbClipboardCopy(paths) {
  _fbClipboard = { op: 'copy', paths: paths.slice() };
  toast(`Copied ${paths.length} item${paths.length === 1 ? '' : 's'} to clipboard.`, 'ok', 1500);
}
function fbClipboardCut(paths) {
  _fbClipboard = { op: 'cut', paths: paths.slice() };
  toast(`Cut ${paths.length} item${paths.length === 1 ? '' : 's'} to clipboard.`, 'ok', 1500);
}
async function fbClipboardPaste(destDir) {
  if (!_fbClipboard || !_fbClipboard.paths.length) {
    toast('Clipboard is empty.', 'warn'); return;
  }
  if (!destDir) { toast('No destination folder selected.', 'err'); return; }
  const op = _fbClipboard.op;
  const src = _fbClipboard.paths;
  let ok = 0, fail = 0, skipped = 0;
  for (const p of src) {
    // Refuse to copy/cut a folder into itself or any of its descendants.
    const pLow = p.replace(/[\\/]+$/, '').toLowerCase();
    const dLow = destDir.replace(/[\\/]+$/, '').toLowerCase();
    if (pLow === dLow || dLow.startsWith(pLow + (destDir.includes('\\') ? '\\' : '/'))) {
      toast('Skipped: cannot paste a folder into itself.', 'warn');
      skipped++;
      continue;
    }
    if (op === 'cut') {
      // Move: prefer fbMove (handles clobber auto-rename in the main process)
      const r = await window.api.fbMove(p, destDir);
      if (r.ok) ok++; else fail++;
    } else {
      // Copy: read + write via the main process. We don't have a fbCopy
      // yet; fall back to reading + writing a file at a time. For folders,
      // skip with a warning (the main process doesn't recurse-copy).
      const r = await window.api.fbCopy(p, destDir).catch(() => null);
      if (r && r.ok) ok++;
      else if (r && r.error) { toast(r.error, 'err'); fail++; }
      else { toast('Copy not supported for this item.', 'err'); fail++; }
    }
  }
  toast(`${op === 'cut' ? 'Moved' : 'Copied'} ${ok}${fail ? `, ${fail} failed` : ''}${skipped ? `, ${skipped} skipped` : ''}.`,
        fail ? 'warn' : 'ok');
  if (op === 'cut' && ok) _fbClipboard = null;
  await refreshBrowser();
}

function showItemContextMenu(it, x, y) {
  showModal((m, close) => {
    m.appendChild(el('h2', {}, it.name));
    m.appendChild(el('div', { class: 'meta', style: 'margin-bottom: 8px; color: var(--fg-2);' }, it.path));

    // File-info block. Always shown. Lists the type, size, modified
    // time, and (for images) the natural resolution. Resolution
    // has to be decoded from the file, so we render a "detectingâ€¦"
    // placeholder first and fill it in once loadImageFromFile
    // resolves.
    const isImage = !it.isDir && ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(it.ext);
    // Same set the audio-cutter dialog + audio preview accept. The
    // list is duplicated on purpose so a future change here doesn't
    // silently drop a format the cutter would still handle (or vice
    // versa).
    const isAudio = !it.isDir && ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.opus', '.aac', '.wma', '.aif', '.aiff'].includes(it.ext);
    const info = el('div', { class: 'fb-item-info' });
    if (it.isDir) {
      info.appendChild(el('div', { class: 'fb-info-row' }, [
        el('span', { class: 'fb-info-key' }, 'Type'),
        el('span', {}, 'Folder'),
      ]));
    } else {
      const extLabel = (it.ext || '').replace('.', '').toUpperCase() || 'file';
      info.appendChild(el('div', { class: 'fb-info-row' }, [
        el('span', { class: 'fb-info-key' }, 'Type'),
        el('span', {}, extLabel),
      ]));
      info.appendChild(el('div', { class: 'fb-info-row' }, [
        el('span', { class: 'fb-info-key' }, 'Size'),
        el('span', {}, humanSize(it.size || 0)),
      ]));
      info.appendChild(el('div', { class: 'fb-info-row' }, [
        el('span', { class: 'fb-info-key' }, 'Modified'),
        el('span', {}, formatDate(it.mtimeMs)),
      ]));
      if (isImage) {
        const dimCell = el('div', { class: 'fb-info-row' }, [
          el('span', { class: 'fb-info-key' }, 'Dimensions'),
          el('span', { class: 'fb-info-dim' }, 'detectingâ€¦'),
        ]);
        info.appendChild(dimCell);
        loadImageFromFile(it.path).then((img) => {
          const dim = dimCell.querySelector('.fb-info-dim');
          if (!dim) return;
          if (img.naturalWidth && img.naturalHeight) {
            dim.textContent = `${img.naturalWidth} Ã— ${img.naturalHeight} px`;
          } else {
            dim.textContent = 'unknown';
          }
        }).catch(() => {
          const dim = dimCell.querySelector('.fb-info-dim');
          if (dim) dim.textContent = 'unreadable';
        });
      }
    }
    m.appendChild(info);

    const row1 = el('div', { class: 'row' }, [el('div', {}, el('button', { class: 'btn-mini', onclick: async () => { close(); await openItem(it); } }, 'Open / Preview'))]);
    const row2 = el('div', { class: 'row' }, [el('div', {}, el('button', { class: 'btn-mini', onclick: async () => { close(); await window.api.fbReveal(it.path); } }, 'Reveal in Explorer'))]);
    // Image-pipeline items: Upscale / Crop / Convert / Remove
    // background. Only show for supported image types, in the order
    // the user expects (transform first, then format, then the
    // transparency tool). The "Remove background" action is always
    // shown when the binary is available, and surfaces a precise
    // install hint when it isn't (no silent no-op).
    let nextRow = 3;
    const rows = [];
    if (isImage) {
      // Each row gets a small help "?" button next to the
      // action button so the user can read a longer
      // explanation of what each pipeline step does before
      // they trigger it. This is the same helpButton factory
      // the form labels use â€” clicking the "?" opens the
      // help modal for the topic; the action button itself
      // still runs the action.
      const rU = el('div', { class: 'row' }, [el('div', { class: 'row-flex' }, [
        el('button', { class: 'btn-mini', onclick: () => { close(); showUpscaleDirect(it.path); } }, 'ðŸ” Upscaleâ€¦'),
        helpButton('ctx.upscale'),
      ])]);
      const rC = el('div', { class: 'row' }, [el('div', { class: 'row-flex' }, [
        el('button', { class: 'btn-mini', onclick: () => { close(); showCropOverlay(it.path); } }, 'âœ‚ Cropâ€¦'),
        helpButton('ctx.crop'),
      ])]);
      const rF = el('div', { class: 'row' }, [el('div', { class: 'row-flex' }, [
        el('button', { class: 'btn-mini', onclick: () => { close(); showConvertOverlay(it.path); } }, 'â‡„ Convert formatâ€¦'),
        helpButton('ctx.convert'),
      ])]);
      // "Optimize / Compress" â€” re-encodes the image to shrink its
      // file size with Sharp / libvips while preserving the best-
      // possible visual quality. Sits between "Convert format" and
      // "Remove background" in the menu order because it's a
      // quality / size operation (similar to convert) and the user
      // typically runs the size-shrink BEFORE the more expensive
      // background-removal step. The dialog is always available
      // (no binary / model check needed) because Sharp is a hard
      // dep of the project â€” if it isn't installed the IPC will
      // return a precise "sharp is not installed" error.
      const rO = el('div', { class: 'row' }, [el('div', { class: 'row-flex' }, [
        el('button', { class: 'btn-mini', onclick: () => { close(); showOptimizeOverlay(it.path); } }, 'ðŸ—œ Optimize / Compressâ€¦'),
        helpButton('ctx.optimize'),
      ])]);
      const rB = el('div', { class: 'row' }, [el('div', { class: 'row-flex' }, [
        el('button', { class: 'btn-mini', onclick: () => { close(); runRemoveBackgroundOnItem(it); } }, 'âœ¨ Remove background'),
        helpButton('ctx.removeBackground'),
      ])]);
      rows.push(rU, rC, rF, rO, rB);
    }
    // Audio pipeline: trim / cut with a click-free waveform editor
    // (zero-crossing snap, micro-fade, auto-trim silence, format
    // conversion, smart naming). The dialog opens via the global
    // window.showAudioCutter() exposed by renderer/audioCutter.js.
    if (isAudio) {
      const rA = el('div', { class: 'row' }, [el('div', { class: 'row-flex' }, [
        el('button', { class: 'btn-mini', onclick: () => {
          close();
          try {
            if (typeof window.showAudioCutter === 'function') {
              window.showAudioCutter(it.path);
            } else {
              toast('Audio cutter module not loaded.', 'err');
            }
          } catch (e) {
            toast('Audio cutter failed: ' + (e && e.message || e), 'err', 5000);
          }
        } }, 'âœ‚ Audio cutâ€¦'),
        helpButton('ctx.audioCut'),
      ])]);
      rows.push(rA);
    }
    rows.push(el('div', { class: 'row' }, [el('div', {}, el('button', { class: 'btn-mini', onclick: () => { close(); fbClipboardCopy([it.path]); } }, 'Copy'))]));
    rows.push(el('div', { class: 'row' }, [el('div', {}, el('button', { class: 'btn-mini', onclick: () => { close(); fbClipboardCut([it.path]); } }, 'Cut'))]));
    rows.push(el('div', { class: 'row' }, [el('div', {}, el('button', { class: 'btn-mini', onclick: () => { close(); promptRename(it); } }, 'Renameâ€¦'))]));
    rows.push(el('div', { class: 'row' }, [el('div', {}, el('button', { class: 'btn-mini', onclick: () => { close(); promptMove(it); } }, 'Move toâ€¦'))]));
    rows.push(el('div', { class: 'row' }, [el('div', {}, el('button', { class: 'btn-mini', onclick: async () => { close(); await fbClipboardPaste(state.fbDir); } }, 'Paste here'))]));
    rows.push(el('div', { class: 'row' }, [el('div', {}, el('button', { class: 'btn-mini danger', onclick: () => { close(); confirmDelete(it); } }, 'Delete'))]));
    m.append(...rows);
    const footer = el('div', { class: 'footer' }, el('button', { class: 'btn-mini', onclick: close }, 'Close'));
    m.appendChild(footer);
  });
}

