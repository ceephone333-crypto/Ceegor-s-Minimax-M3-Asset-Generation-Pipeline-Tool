// renderer/tabs/musicTabB.js (Phase 3 Block 34)
// Second half of musicTab.js (overlays + previews).

          if (bpm.input.getValue() !== '') args.push('--bpm', String(bpm.input.getValue()));
          appendFlag(args, key.input);
          appendFlag(args, tempo.input);
          appendFlag(args, structure.input);
          if (references.input.value.trim()) args.push('--references', references.input.value.trim());
          if (avoid.input.value.trim()) args.push('--avoid', avoid.input.value.trim());
          appendFlag(args, useCase.input);
          if (extra.input.value.trim()) args.push('--extra', extra.input.value.trim());
          appendFlag(args, audioFormat.input);
          appendFlag(args, sampleRate.input);
          appendFlag(args, bitrate.input);
          appendBoolFlag(args, watermark.input, '--aigc-watermark');
          if (outputFormat.input.value && outputFormat.input.value !== 'hex') {
            args.push('--output-format', outputFormat.input.value);
          }
          // Unique output file per variant
          const ts = timestamp();
          const variantTag = variantsCount > 1 ? `_v${v}` : '';
          const outFile = uniquePath(outDir, `${ts}_${slug}${variantTag}.${ext}`);
          args.push('--out', outFile);
          lastCmd.textContent = maskLine(`mmx ${args.join(' ')}`, state.config && state.config.api_key);
          const statusMsg = variantsCount > 1
            ? `Generating musicâ€¦ variant ${v}/${variantsCount} (may take 30sâ€“2min each)`
            : 'Generating musicâ€¦ (may take 30sâ€“2min)';
          setStatus(statusMsg, true);
          preview.innerHTML = `<div class="empty"><span class="spinner"></span> ${escapeHtml(statusMsg)}</div>`;
          const r = await window.api.mmxRun(args);
          if (cancel.wasCancelled()) { allOk = false; break; }
          if (!r.ok) {
            const msg = formatMmxError(r);
            preview.innerHTML = `<div class="empty">Generation failed (variant ${v}/${variantsCount}).</div><div class="meta">${escapeHtml(msg)}</div>`;
            toast(`Music generation failed: ${msg}`, 'err', 6000);
            allOk = false;
            break;
          }
          // Update the per-item average + advance the queue counter so
          // the ETA ticks down per item. See the image-tab comment
          // for the full rationale.
          const itemDur = (Date.now() - itemStart) / 1000;
          if (!state.genAvgSec) state.genAvgSec = {};
          const prevAvg = state.genAvgSec.music || 0;
          state.genAvgSec.music = prevAvg === 0 ? itemDur : (prevAvg * 0.6 + itemDur * 0.4);
          state.genQueueDone.music = (state.genQueueDone.music || 0) + 1;
          refreshTabEtas();
          lastPreview = r.parsed;
          lastOutFile = outFile;
        }
      } catch (e) {
        threw = e;
        allOk = false;
        console.error('Music generation threw:', e);
        toast('Generation error: ' + (e && e.message || String(e)), 'err', 6000);
      } finally {
        cancel.cleanup();
        setStatus('Ready', false);
        try { await refreshBrowser(); } catch {}
        try { await refreshQuota(); } catch {}
      }
      if (threw) return;
      if (cancel.wasCancelled()) {
        preview.innerHTML = '<div class="empty">Generation cancelled.</div>';
        toast('Cancelled.', 'warn');
        return;
      }
      if (allOk && lastOutFile) {
        showAudioPreview(preview, lastOutFile, lastPreview);
        bumpGenerationCounter('music', variantsCount);
      }
      if (allOk) {
        toast(variantsCount > 1
          ? `Music generated. ${variantsCount} variants saved.`
          : 'Music generated.', 'ok');
      }
    });
  },
};

// Phase 3 Block 10: fileUrl() extrahiert nach
// renderer/utils/fileUrl.js. Pure Funktion, 0 App-Coupling.
const { fileUrl } = window.FileUrl;

function showImagePreview(rootEl, file, parsed) {
  // Use file:// to let the renderer display the local file.
  // We add a cache-busting query string in case the same path is regenerated.
  // The preview now renders a 400Ã—400 thumbnail instead of the full image
  // (the preview pane was locking the screen when the generation produced
  // a large image). Clicking the thumbnail opens the image overlay at
  // 1:1 pixel mode with a zoom dropdown.
  const url = fileUrl(file) + '?t=' + Date.now();
  const filename = (file || '').split(/[\\/]/).pop() || 'image';
  const preLoad = new Image();
  preLoad.onload = () => {
    rootEl.innerHTML = '';
    const thumb = el('img', {
      src: url,
      alt: filename,
      class: 'preview-thumb',
      title: `${preLoad.naturalWidth}Ã—${preLoad.naturalHeight} â€” click to view full size`,
    });
    thumb.addEventListener('click', () => {
      openImageOverlay(url, filename, preLoad.naturalWidth, preLoad.naturalHeight, file);
    });
    rootEl.appendChild(thumb);
    const meta = el('div', { class: 'meta' });
    meta.appendChild(document.createTextNode(file));
    meta.appendChild(el('div', { class: 'preview-thumb-size' },
      `${preLoad.naturalWidth}Ã—${preLoad.naturalHeight} â€” click for 1:1 view`));
    if (parsed) meta.appendChild(el('div', {}, '[mmx] ' + safeStringify(parsed)));
    rootEl.appendChild(meta);
  };
  preLoad.onerror = () => {
    // Fallback when pre-loading fails (e.g. file still being written to disk).
    rootEl.innerHTML = '';
    const thumb = el('img', { src: url, alt: filename, class: 'preview-thumb' });
    thumb.addEventListener('click', () => openImageOverlay(url, filename, 0, 0, file));
    rootEl.appendChild(thumb);
    const meta = el('div', { class: 'meta' }, file);
    rootEl.appendChild(meta);
  };
  preLoad.src = url;
}

function showAudioPreview(rootEl, file, parsed) {
  const url = fileUrl(file) + '?t=' + Date.now();
  rootEl.innerHTML = '';
  const audio = el('audio', { controls: '', src: url });
  rootEl.appendChild(audio);
  const meta = el('div', { class: 'meta' });
  meta.appendChild(document.createTextNode(file));
  if (parsed) meta.appendChild(el('div', {}, '[mmx] ' + safeStringify(parsed)));
  rootEl.appendChild(meta);
}

// Open the image overlay: a full-screen modal showing the image at
// 1:1 pixel mode by default, with a zoom dropdown (75% / 50% / 25% /
// Fit-to-window). Used by both the generation preview thumbnail and the
// file-browser preview pane.
// Track the most recent overlay's close function so a re-open can
// dispose the previous one cleanly (removes its document-level
// keydown listener). Without this, every rapid thumbnail click
// leaked one Esc listener on `document`, and the user had to
// press Esc N times to dismiss a single overlay after N re-opens.
let _openImageOverlayClose = null;

// Set of extensions the overlay's arrow-key navigation considers
// "browsable" â€” i.e. an image file the user can step through.
// Mirrors the same set the file browser / preview pane use to
// decide what to render.
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'];

// Build the list of image paths the user can step through with
// the arrow keys in the overlay. Prefers the active multi-image
// batch (state._previewBatch) when the current path is in it;
// otherwise falls back to the folder explorer's currently-rendered
// image list, which is sorted the same way as the folder explorer
// (because the file browser sorts server-side and the renderer
// displays the items in the order it received them).
//
// Returns { paths: string[], index: number } or null when no list
// could be built (e.g. no folder context, no batch, no match).
function buildOverlayNavList(currentPath) {
  const cur = (currentPath || '').toLowerCase();
  // 1) Multi-image batch â€” only if the current path is actually in it.
  if (state._previewBatch && Array.isArray(state._previewBatch.paths) && state._previewBatch.paths.length > 1) {
    const idx = state._previewBatch.paths.findIndex((p) => (p || '').toLowerCase() === cur);
    if (idx >= 0) {
      return { paths: state._previewBatch.paths, index: idx };
    }
  }
  // 2) Fallback: all image files in the current folder, in the
  //    same order the folder explorer renders them. The
  //    file-browser renderer stores the items on state._fbItems
  //    (added in feature #2) and they arrive pre-sorted from the
  //    main process (name + dirs-first). We further filter to
  //    image files so the arrow keys only step through images
  //    and not, say, the user's text notes.
  if (Array.isArray(state._fbItems) && state._fbItems.length) {
    const paths = state._fbItems
      .filter((it) => !it.isDir && IMAGE_EXTS.includes((it.ext || '').toLowerCase()))
      .map((it) => it.path);
    if (!paths.length) return null;
    const idx = paths.findIndex((p) => (p || '').toLowerCase() === cur);
    return { paths, index: idx >= 0 ? idx : 0 };
  }
  return null;
}

function openImageOverlay(src, filename, naturalWidth, naturalHeight, filePath) {
  // If there's already an overlay open, close it cleanly (this
  // removes the previous keydown listener before we open a new one).
  if (_openImageOverlayClose) {
    try { _openImageOverlayClose(); } catch (_) {}
    _openImageOverlayClose = null;
  }
  // The previous code did `existing.remove()` here, which
  // removed the DOM but never called close() â€” so the keydown
  // listener stayed attached forever. The cleanup is now in
  // _openImageOverlayClose above.
  const overlay = el('div', { class: 'image-overlay', id: 'image-overlay' });
  // Header
  const fname = el('span', { class: 'image-overlay-filename', title: filename || '' }, filename || '');
  const size = el('span', { class: 'image-overlay-size' },
    (naturalWidth && naturalHeight) ? `${naturalWidth}Ã—${naturalHeight}` : '');
  // Position counter (e.g. "3 / 12") on the overlay header. Shown
  // when the arrow keys can navigate, hidden otherwise. Built
  // from the same nav list the arrow keys use, so the two stay
  // in lock-step.
  const navList = buildOverlayNavList(filePath);
  const pos = el('span', { class: 'image-overlay-pos' }, '');
  if (navList && navList.paths.length > 1) {
    pos.textContent = ` (${navList.index + 1} / ${navList.paths.length})`;
  }
  const zoom = el('select', { class: 'image-overlay-zoom', title: 'Zoom level' });
  for (const [val, label] of [
    ['100', '100% (1:1)'],
    ['75', '75%'],
    ['50', '50%'],
    ['25', '25%'],
    ['fit', 'Fit to window'],
  ]) {
    const opt = el('option', { value: val }, label);
    if (val === '100') opt.selected = true;
    zoom.appendChild(opt);
  }
  const closeBtn = el('button', { class: 'btn-mini image-overlay-close', title: 'Close (Esc)' }, 'Ã—');
  // Prev / next arrow buttons on the header. Same keyboard / click
  // behaviour â€” the buttons exist so the user can navigate on a
  // touch device or with the mouse without using the keyboard.
  const prevBtn = el('button', { class: 'btn-mini image-overlay-prev', title: 'Previous (â†)' }, 'â€¹');
  const nextBtn = el('button', { class: 'btn-mini image-overlay-next', title: 'Next (â†’)' }, 'â€º');
  if (!navList || navList.paths.length <= 1) {
    // Single-image overlay â€” hide the nav controls so the user
    // doesn't think there's more to see.
    prevBtn.style.display = 'none';
    nextBtn.style.display = 'none';
  }
  const header = el('div', { class: 'image-overlay-header' }, [fname, pos, size, prevBtn, nextBtn, zoom, closeBtn]);
  // Content
  const img = el('img', { class: 'image-overlay-img zoom-100', src, alt: filename || '' });
  if (naturalWidth && naturalHeight) {
    // Hint the browser at the natural size for layout (CSS then scales
    // according to .zoom-100/75/50/25/fit).
    img.width = naturalWidth;
    img.height = naturalHeight;
  }
  const content = el('div', { class: 'image-overlay-content' }, [img]);
  overlay.append(header, content);
  document.body.appendChild(overlay);
  // Zoom on change
  zoom.addEventListener('change', () => {
    img.className = 'image-overlay-img zoom-' + zoom.value;
  });
  // Close on button click
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (_openImageOverlayClose === close) _openImageOverlayClose = null;
  };
  closeBtn.addEventListener('click', close);
  // Close on background click (not on the image)
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  // The keyboard handler covers:
  //   Esc   â†’ close the overlay
  //   â† / â†’ â†’ step to the previous / next image (with wrap-around
  //           when the user reaches the ends, so the keyboard
  //           navigation matches what the user expects from a
  //           typical image viewer)
  // Other keys are ignored. We compute the nav list lazily on
  // each arrow press so a newly-shown multi-image batch is picked
  // up the moment the user opens the overlay (and so the list
  // stays accurate even if the user clicks into a different
  // thumbnail in the preview pane while the overlay is open â€”
  // which is currently not possible, but defensive code is cheap).
  const onKey = (e) => {
    if (e.key === 'Escape') { close(); return; }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const list = buildOverlayNavList(filePath);
    if (!list || list.paths.length <= 1) return;
    const delta = e.key === 'ArrowLeft' ? -1 : +1;
    // Wrap-around: at the end, â† jumps to the last; at the start,
    // â†’ jumps to the first. The preview-pane highlight + the
    // folder-explorer .selected row follow.
    const nextIdx = (list.index + delta + list.paths.length) % list.paths.length;
    navigateToOverlayImage(list.paths[nextIdx], { wrap: true });
  };
  document.addEventListener('keydown', onKey);
  // Wire the prev/next header buttons to the same navigateToOverlayImage
  // path so mouse-only users get the same behaviour.
  if (navList && navList.paths.length > 1) {
    prevBtn.addEventListener('click', () => {
      const list = buildOverlayNavList(filePath);
      if (!list || list.paths.length <= 1) return;
      const nextIdx = (list.index - 1 + list.paths.length) % list.paths.length;
      navigateToOverlayImage(list.paths[nextIdx], { wrap: true });
    });
    nextBtn.addEventListener('click', () => {
      const list = buildOverlayNavList(filePath);
      if (!list || list.paths.length <= 1) return;
      const nextIdx = (list.index + 1) % list.paths.length;
      navigateToOverlayImage(list.paths[nextIdx], { wrap: true });
    });
  }
  // Stop propagation on the image so clicking the image doesn't close
  // the overlay (the user is likely trying to interact with the image).
  img.addEventListener('click', (e) => e.stopPropagation());
  // Right-click on the overlay image: open the same
  // folder-browser context menu (Upscale / Crop / Convert /
  // Optimize / Remove background + file-level Copy / Cut /
  // Rename / Move / Delete). Mirrors the preview-pane-thumbnail
  // right-click behaviour so the user gets the same options
  // from either entry point.
  if (filePath) {
    img.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { showItemContextMenuForPath(filePath, e.clientX, e.clientY); }
      catch (_) { /* best-effort */ }
    });
    // Same right-click on the header filename (the "Image.png"
    // label in the overlay's top bar) — useful when the user
    // wants the context menu without aiming at the image.
    fname.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { showItemContextMenuForPath(filePath, e.clientX, e.clientY); }
      catch (_) { /* best-effort */ }
    });
  }
  // Hand the close function to the next open call so a re-open
  // disposes this one cleanly.
  _openImageOverlayClose = close;
}

// Open the next / previous image in the current overlay nav list.
// Called by the arrow-key / prev-next-button handlers inside
// openImageOverlay. Closes the current overlay, re-opens a new
// one for `path`, and updates the multi-image preview-pane
// highlight (if a batch is shown) + the folder-explorer's
// .selected row. The "wrap" option is accepted for future use
// (e.g. disabling wrap-around when the user explicitly clicks
// a thumbnail), but currently the keyboard always wraps.
function navigateToOverlayImage(path, opts) {
  if (!path) return;
  // Update the multi-image preview-pane highlight so the new
  // "current" thumbnail gets the .preview-active class. We
  // update _previewBatch.index even if the path is not in the
  // batch â€” buildOverlayNavList falls back to the folder list
  // in that case.
  if (state._previewBatch && Array.isArray(state._previewBatch.paths)) {
    const idx = state._previewBatch.paths.findIndex((p) => (p || '').toLowerCase() === path.toLowerCase());
    if (idx >= 0) state._previewBatch.index = idx;
  }
  // Folder-explorer's .selected row follows the user, so the
  // file they're navigating to is always the active row.
  markFbItemActive(path);
  // Re-render the preview-pane highlight (the .preview-active
  // class on the thumbnail). We do this by walking the
  // current grid and toggling the class.
  const grid = document.querySelector('#fb-preview-content .preview-pane-grid');
  if (grid) {
    let activeSlot = null;
    $$('.preview-pane-thumb', grid).forEach((slot) => {
      // The slot's `title` attribute is the filename, which is
      // not a reliable key. Instead, the click handler stores
      // the path on a data attribute when it binds; for the
      // public path we read it from the slot's stored state.
      // As a fallback, the slot's first child <img> has a
      // src that includes a cache-buster; we can't reverse
      // that into a path. So we just look up by data-path
      // if the slot has it (we set it below in
      // previewImagesFromFiles).
      const slotPath = slot.getAttribute('data-path');
      const isMatch = slotPath && slotPath.toLowerCase() === path.toLowerCase();
      slot.classList.toggle('preview-active', !!isMatch);
      if (isMatch) activeSlot = slot;
    });
    if (activeSlot) {
      try { activeSlot.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) {}
    }
  }
  // Close the current overlay (which also unregisters the
  // keyboard listener) and open a new one for the new path.
  // The close() inside openImageOverlay() handles the
  // _openImageOverlayClose cleanup; we then load the natural
  // size async so the new overlay's title shows the right
  // dimensions.
  const url = fileUrl(path) + '?t=' + Date.now();
  const filename = (path || '').split(/[\\/]/).pop() || 'image';
  const probe = new Image();
  probe.onload = () => {
    openImageOverlay(url, filename, probe.naturalWidth, probe.naturalHeight, path);
  };
  probe.onerror = () => {
    openImageOverlay(url, filename, 0, 0, path);
  };
  probe.src = url;
}

// Phase 3 Block 6: escapeHtml() ist schon in DomHelpers.js
// verfügbar. Drop-in-Alias unten.
const { escapeHtml } = window;

window.MusicTab = window.TABS.music;

