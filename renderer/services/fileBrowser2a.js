// renderer/services/fileBrowser2a.js (Phase 3 Block 32)
// First half of fileBrowser2.js (preview + thumbs).

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
