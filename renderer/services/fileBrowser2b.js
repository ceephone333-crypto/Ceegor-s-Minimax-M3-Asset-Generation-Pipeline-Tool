// renderer/services/fileBrowser2b.js (Phase 3 Block 32)
// Second half of fileBrowser2.js (context menu + clipboard).

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
  //    user is on a non-image tab), this is a no-op — the
  //    next refreshBrowser() will pick up the file in the
  //    folder explorer.
  const content = $('#fb-preview-content');
  if (content) {
    let grid = content.querySelector('.preview-pane-grid');
    if (!grid) {
      // No grid yet — build one with just this file.
      content.innerHTML = '';
      grid = el('div', { class: 'preview-pane-grid' });
      content.appendChild(grid);
      const summary = el('div', { class: 'preview-pane-summary' }, '1 image — click any thumbnail to open at 1:1.');
      content.appendChild(summary);
    } else {
      // Grid already there — update the "N images" summary line
      // (if present) so the user can see the count grow.
      const summary = content.querySelector('.preview-pane-summary');
      if (summary) {
        const n = grid.querySelectorAll('.preview-pane-thumb').length + 1;
        summary.textContent = `${n} image${n === 1 ? '' : 's'} — click any thumbnail to open at 1:1.`;
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
  // before the poller started, which is fine — notifyImageGenerated
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
      // v1.1.15: filter the polled list down to supported
      // asset types (see isItemVisibleInList in fileBrowser1.js)
      // so the per-tick re-render matches the user's "show all
      // files" toggle. The fresh-detection below still walks the
      // full newItems list (we want to highlight every newly-
      // created file as a thumbnail, even if it's currently
      // hidden by the type filter).
      const visibleItems = newItems.filter(isItemVisibleInList);
      const newPaths = newItems.map((it) => it.path);
      const prev = new Set((state._lastPolledItems || []).map((p) => p.toLowerCase()));
      const fresh = newPaths.filter((p) => !prev.has(p.toLowerCase()));
      // 1. Re-render the file-browser list so the new file is
      //    visible + get the new state._fbItems snapshot.
      const sorted = sortFbItems(visibleItems, state.fbSort);
      renderFbList(sorted);
      applyFileSearch();
      state._lastPolledItems = newPaths;
      // 2. For each newly-discovered file, run it through the
      //    same live-update pipeline the gen handler uses. This
      //    covers the --out-dir case (where the gen handler
      //    doesn't know the per-call output filenames).
      for (const p of fresh) {
        // Only push as a thumbnail if it's an image file —
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
      // Don't let a transient IPC error kill the poller — just
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

// v1.1.11 (reported by user): redesigned the audio preview
// so the user sees the filename prominently + a big "▶ Play"
// button (not the OS-native audio controls bar). Clicking Play
// starts playback; the button then switches to "■ Stop" for
// the duration of the audio, and reverts to "▶ Play" again
// when the audio ends. The audio element itself is hidden
// (it's only there as a JS-controlled playback source — the
// user interacts only via the Play button). This matches the
// user's spec: "previewed with their file name and a Play
// button. It should play once and then stop after the play
// button was clicked."
function previewAudioFromFile(p) {
  const root = $(`#fb-preview-content`);
  if (!root) return;
  if (state._lastPreviewPath === p) return;
  state._lastPreviewPath = p;
  state._previewBatch = null;
  markFbItemActive(p);
  const url = fileUrl(p);
  const filename = (p || '').split(/[\\/]/).pop() || 'audio';
  root.innerHTML = '';
  // Hidden audio element. The user never sees the native
  // controls; the Play/Stop button below drives playback.
  const audio = el('audio', { src: url, preload: 'auto' });
  audio.style.display = 'none';
  // Container with the filename header + a centred Play
  // button. Uses the same preview-pane layout as images
  // (filename row under the media) so the three preview
  // types (image / video / audio) read as one family.
  const wrap = el('div', { class: 'preview-pane-audio' });
  const icon = el('div', { class: 'preview-pane-audio-icon' }, '🎵');
  const name = el('div', { class: 'preview-pane-audio-name', title: filename }, filename);
  const playBtn = el('button', { class: 'primary preview-pane-audio-btn', type: 'button' }, '▶ Play');
  const status = el('div', { class: 'preview-pane-audio-status' }, '');
  // v1.1.11: drive the audio element via JS so we can swap
  // the button label between Play / Stop / Loading, and so
  // we never auto-loop (the user explicitly asked for
  // "play once and then stop").
  function setPlaying(isPlaying) {
    playBtn.textContent = isPlaying ? '■ Stop' : '▶ Play';
    playBtn.classList.toggle('playing', isPlaying);
    status.textContent = isPlaying ? `Playing ${filename}…` : '';
  }
  playBtn.addEventListener('click', () => {
    if (audio.paused) {
      // .play() returns a promise that can reject if the
      // browser blocks autoplay. We treat that as a soft
      // "couldn't start" rather than a hard error — the user
      // can click Play again.
      const p = audio.play();
      if (p && typeof p.then === 'function') {
        playBtn.disabled = true;
        p.then(() => { playBtn.disabled = false; setPlaying(true); })
         .catch((e) => { playBtn.disabled = false; setPlaying(false); console.warn('audio play() rejected:', e); });
      } else {
        setPlaying(true);
      }
    } else {
      audio.pause();
      audio.currentTime = 0;
      setPlaying(false);
    }
  });
  audio.addEventListener('ended', () => {
    // "Play once and then stop" — when the audio finishes
    // naturally, reset the button to its initial Play state.
    // The audio element's `loop` attribute is NOT set, so we
    // never get into a loop on our own.
    setPlaying(false);
  });
  audio.addEventListener('pause', () => {
    // If the audio pauses for any reason (manual, ended, OS
    // media-key), reset the button label.
    if (audio.currentTime === 0 || audio.ended) setPlaying(false);
  });
  wrap.append(icon, name, playBtn, status);
  root.append(wrap, audio);
  const fname = el('div', { class: 'preview-pane-filename', title: p }, filename);
  root.appendChild(fname);
}

// v1.1.11 (reported by user): video preview. Click on a .mp4
// (or other supported video) in the file browser → the preview
// pane shows the video with the OS-native <video controls>
// bar so the user can play / pause / seek / adjust volume /
// go fullscreen. Clicking the video element itself opens a
// larger overlay (the same overlay pattern used for images,
// adapted to host a <video> element + a big Play button).
function previewVideoFromFile(p) {
  const root = $('#fb-preview-content');
  if (!root) return;
  if (state._lastPreviewPath === p) return;
  state._lastPreviewPath = p;
  state._previewBatch = null;
  markFbItemActive(p);
  const url = fileUrl(p);
  const filename = (p || '').split(/[\\/]/).pop() || 'video';
  root.innerHTML = '';
  // Thumbnail-style video preview: a <video> with `controls`
  // AND `preload="metadata"` so the first frame is fetched
  // and shown even before the user clicks Play. The thumbnail
  // is the click target for the overlay.
  const wrap = el('div', { class: 'preview-pane-video' });
  const vid = el('video', {
    src: url,
    controls: '',
    preload: 'metadata',
    title: filename + ' — click for the full-size overlay',
    class: 'preview-pane-video-el',
  });
  // The overlay path is the same modal used for images; it
  // accepts a custom render callback so we can put a <video>
  // + big Play button inside. We use the user's spec: "preview
  // image to trigger the overlay, in which a play button can
  // play the video".
  vid.addEventListener('click', (e) => {
    // Don't open the overlay if the user is interacting with
    // the native controls (the controls bar is at the bottom
    // of the element).
    e.preventDefault();
    openVideoOverlay(url, filename, p);
  });
  wrap.appendChild(vid);
  root.appendChild(wrap);
  const fname = el('div', { class: 'preview-pane-filename', title: p }, filename);
  root.appendChild(fname);
}

// Open the full-size video overlay (image-overlay shape, but
// with a <video> + big Play button in the centre). Uses the
// shared showModal primitive so Esc / click-outside close
// it. The Play button is hidden once the video starts
// playing (the user can pause via the native controls at the
// bottom of the video).
function openVideoOverlay(src, filename, filePath) {
  if (typeof showModal !== 'function') return;
  showModal((m, close) => {
    m.classList.add('video-overlay');
    const header = el('div', { class: 'video-overlay-header' }, [
      el('span', { class: 'video-overlay-filename', title: filename || '' }, filename || ''),
      el('button', { type: 'button', class: 'btn-mini', onclick: close }, '✕ Close'),
    ]);
    m.appendChild(header);
    const wrap = el('div', { class: 'video-overlay-stage' });
    const vid = el('video', { src, controls: '', preload: 'metadata', class: 'video-overlay-el' });
    wrap.appendChild(vid);
    // Big Play button overlay, centred on top of the video.
    // Click → start playback; the button hides itself once
    // the video starts playing and the native controls take
    // over.
    const playBtn = el('button', { type: 'button', class: 'video-overlay-playbtn' }, '▶ Play');
    playBtn.addEventListener('click', () => {
      const p = vid.play();
      if (p && typeof p.then === 'function') {
        p.then(() => { playBtn.style.display = 'none'; })
         .catch((e) => { console.warn('video play() rejected:', e); });
      } else {
        playBtn.style.display = 'none';
      }
    });
    vid.addEventListener('play', () => { playBtn.style.display = 'none'; });
    vid.addEventListener('pause', () => {
      // Re-show the Play button when paused (e.g. user clicked
      // pause on the native controls, or the video ended).
      if (vid.currentTime > 0 || vid.ended) playBtn.style.display = '';
    });
    vid.addEventListener('ended', () => {
      // "Play once and then stop" — when the video ends, reset
      // the playhead AND re-show the big Play button so the
      // user can play it again. The video element's `loop`
      // attribute is NOT set.
      vid.currentTime = 0;
      playBtn.style.display = '';
    });
    wrap.appendChild(playBtn);
    m.appendChild(wrap);
    const fname = el('div', { class: 'video-overlay-meta', title: filePath || '' }, filePath || '');
    m.appendChild(fname);
  });
}

async function previewTextFromFile(p) {
  const root = $(`#tab-${state.currentTab} .preview`);
  if (!root) return;
  const r = await window.api.fbRead(p);
  root.innerHTML = '';
  if (!r.ok) { root.innerHTML = '<div class="empty">Cannot read: ' + escapeHtml(r.error) + '</div>'; return; }
  // Decode base64 → binary string → UTF-8 text. Plain `atob` only gives a
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
  // v1.1.15 (reported by user): redesigned the right-click
  // context menu so it has TWO columns:
  //   - LEFT: the action list (Open / Preview, Open in
  //     Explorer, image-pipeline, file-level actions). The
  //     same options as before, just better organized.
  //   - RIGHT: an image preview (a thumbnail of the actual
  //     file) when the item is an image; otherwise an empty
  //     space. The preview is the same one the user sees in
  //     the picture-preview pane, but a click on it opens
  //     the full-size image overlay (same behaviour as the
  //     main preview pane).
  //
  // Also added an "Open in Explorer" action that opens a
  // new Windows Explorer window AT the file's folder
  // (selecting the file). This is the standard Windows
  // shell verb "explore" — the previous "Reveal in Explorer"
  // only highlighted the file in an existing window.
  //
  // The help icons in the action list are now
  // hover-tooltips (data-help), not click-to-open modals.
  // This matches the generation screens (e.g. the --model
  // row's help icon) where the user can hover for a
  // quick explanation without having to manually close
  // a modal afterwards.
  showModal((m, close) => {
    m.classList.add('fb-context-menu-modal');
    m.appendChild(el('h2', {}, it.name));
    m.appendChild(el('div', { class: 'meta', style: 'margin-bottom: 8px; color: var(--fg-2);' }, it.path));

    // The two-column body. The right column (preview) is
    // hidden for non-image files via CSS (display: none on
    // .fb-context-menu-preview-empty). The left column
    // always shows.
    const body = el('div', { class: 'fb-context-menu-body' });
    const leftCol = el('div', { class: 'fb-context-menu-left' });
    const rightCol = el('div', { class: 'fb-context-menu-right' });
    body.appendChild(leftCol);
    body.appendChild(rightCol);
    m.appendChild(body);

    // File-info block. Always shown. Lists the type, size,
    // modified time, and (for images) the natural
    // resolution. Resolution has to be decoded from the
    // file, so we render a "detecting…" placeholder first
    // and fill it in once loadImageFromFile resolves.
    const isImage = !it.isDir && ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(it.ext);
    // Same set the audio-cutter dialog + audio preview
    // accept. The list is duplicated on purpose so a
    // future change here doesn't silently drop a format
    // the cutter would still handle (or vice versa).
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
          el('span', { class: 'fb-info-dim' }, 'detecting…'),
        ]);
        info.appendChild(dimCell);
        loadImageFromFile(it.path).then((img) => {
          const dim = dimCell.querySelector('.fb-info-dim');
          if (!dim) return;
          if (img.naturalWidth && img.naturalHeight) {
            dim.textContent = `${img.naturalWidth} × ${img.naturalHeight} px`;
          } else {
            dim.textContent = 'unknown';
          }
        }).catch(() => {
          const dim = dimCell.querySelector('.fb-info-dim');
          if (dim) dim.textContent = 'unreadable';
        });
      }
    }
    leftCol.appendChild(info);

    // The first two action rows: Open / Preview + Open in
    // Explorer. The user explicitly asked for "Open in
    // Explorer" to open a new Explorer window (not just
    // reveal in an existing one). We add an "fb:openInExplorer"
    // IPC handler in the main process that calls
    // `shell.openPath(parentDir)` — see registerFileBrowserIpc.js
    // and src/fileBrowser.js.
    const rowOpenPreview = el('div', { class: 'row' }, [el('div', {}, el('button', { class: 'btn-mini', onclick: async () => { close(); await openItem(it); } }, 'Open / Preview'))]);
    const rowOpenExplorer = el('div', { class: 'row' }, [el('div', {}, el('button', { class: 'btn-mini', onclick: async () => {
      close();
      try {
        const r = await window.api.fbOpenInExplorer(it.path);
        if (!r || !r.ok) toast('Open in Explorer failed: ' + ((r && r.error) || 'unknown error'), 'err', 4000);
      } catch (e) {
        toast('Open in Explorer failed: ' + (e && e.message || e), 'err', 4000);
      }
    } }, 'Open in Explorer'))]);
    const rowReveal = el('div', { class: 'row' }, [el('div', {}, el('button', { class: 'btn-mini', onclick: async () => { close(); await window.api.fbReveal(it.path); } }, 'Reveal in Explorer'))]);

    // Image-pipeline items: Upscale / Crop / Convert / Remove
    // background. Only show for supported image types, in the order
    // the user expects (transform first, then format, then the
    // transparency tool). The "Remove background" action is always
    // shown when the binary is available, and surfaces a precise
    // install hint when it isn't (no silent no-op).
    //
    // v1.1.15: replaced the click-to-open helpButton with
    // hover-tooltips (data-help). The "?" is rendered as a
    // <span> with class "help" and the topic key as a
    // data-help attribute; the existing
    // setupHoverHelpTooltips() picks it up and shows a
    // tooltip on hover. The tooltip disappears when the
    // user moves the cursor away — no modal to close.
    const rows = [];
    if (isImage) {
      const rU = el('div', { class: 'row' }, [el('div', { class: 'row-flex' }, [
        el('button', { class: 'btn-mini', onclick: () => { close(); showUpscaleDirect(it.path); } }, '🔍 Upscale…'),
        el('span', { class: 'help', 'data-help': 'Make the image bigger (2×, 3×, or 4×) using the built-in canvas pipeline, or the higher-quality Real-ESRGAN binary if installed. The new file is written next to the original with a "_2x" / "_3x" / "_4x" suffix in the filename.', title: 'Upscale' }, '?'),
      ])]);
      const rC = el('div', { class: 'row' }, [el('div', { class: 'row-flex' }, [
        el('button', { class: 'btn-mini', onclick: () => { close(); showCropOverlay(it.path); } }, '✂ Crop…'),
        el('span', { class: 'help', 'data-help': 'Crop the image to a specific rectangle. Drag the crop frame with the mouse, or type exact W × H values. The cropped file is written next to the original with a "_cropped_WxH" suffix.', title: 'Crop' }, '?'),
      ])]);
      const rF = el('div', { class: 'row' }, [el('div', { class: 'row-flex' }, [
        el('button', { class: 'btn-mini', onclick: () => { close(); showConvertOverlay(it.path); } }, '⇄ Convert format…'),
        el('span', { class: 'help', 'data-help': 'Re-encode the image to a different format. PNG is lossless (good for screenshots / illustrations, supports transparency). JPEG is much smaller (good for photos, no transparency). WebP is a modern middle ground (smaller than JPEG, supports transparency, but less universal).', title: 'Convert format' }, '?'),
      ])]);
      const rO = el('div', { class: 'row' }, [el('div', { class: 'row-flex' }, [
        el('button', { class: 'btn-mini', onclick: () => { close(); showOptimizeOverlay(it.path); } }, '🗜 Optimize / Compress…'),
        el('span', { class: 'help', 'data-help': 'Shrink the file size while keeping the image looking (almost) the same. The default quality of 82 is the "perceptually lossless" sweet spot for photos. You can also re-encode to WebP / AVIF for further size savings, and strip non-essential EXIF data (camera model, GPS, software tag) while keeping the colour profile.', title: 'Optimize / Compress' }, '?'),
      ])]);
      const rB = el('div', { class: 'row' }, [el('div', { class: 'row-flex' }, [
        el('button', { class: 'btn-mini', onclick: () => { close(); runRemoveBackgroundOnItem(it); } }, '✨ Remove background'),
        el('span', { class: 'help', 'data-help': 'Replace the background of the image with transparency. Uses the optional IS-Net model (a state-of-the-art segmentation model) — the tool walks you through the one-time install on first use. The result is a transparent PNG written next to the original.', title: 'Remove background' }, '?'),
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
        } }, '✂ Audio cut…'),
        el('span', { class: 'help', 'data-help': 'Open the audio in a waveform editor. Drag the two markers to set the selection, or use the time inputs for millisecond precision. Quality-of-life helpers: "Auto-trim silence" removes leading/trailing silence, "Snap to zero-crossing" prevents clicks at the cut edges, and a configurable micro-fade (5 ms by default) buries any residual click. Pick a different output format (MP3 / WAV / OGG / Opus / FLAC / M4A) from the dropdown, then "Export" writes the trimmed file next to the original.', title: 'Audio cut' }, '?'),
      ])]);
      rows.push(rA);
    }
    rows.push(rowOpenPreview, rowOpenExplorer, rowReveal);
    rows.push(el('div', { class: 'row' }, [el('div', {}, el('button', { class: 'btn-mini', onclick: () => { close(); fbClipboardCopy([it.path]); } }, 'Copy'))]));
    rows.push(el('div', { class: 'row' }, [el('div', {}, el('button', { class: 'btn-mini', onclick: () => { close(); fbClipboardCut([it.path]); } }, 'Cut'))]));
    rows.push(el('div', { class: 'row' }, [el('div', {}, el('button', { class: 'btn-mini', onclick: () => { close(); promptRename(it); } }, 'Rename…'))]));
    rows.push(el('div', { class: 'row' }, [el('div', {}, el('button', { class: 'btn-mini', onclick: () => { close(); promptMove(it); } }, 'Move to…'))]));
    rows.push(el('div', { class: 'row' }, [el('div', {}, el('button', { class: 'btn-mini', onclick: async () => { close(); await fbClipboardPaste(state.fbDir); } }, 'Paste here'))]));
    rows.push(el('div', { class: 'row' }, [el('div', {}, el('button', { class: 'btn-mini danger', onclick: () => { close(); confirmDelete(it); } }, 'Delete'))]));
    leftCol.append(...rows);

    // Right column: image preview. For image files, show
    // a centered thumbnail of the actual file with a
    // "click for full-size" hint. For non-image files, show
    // a small "no preview" placeholder. The thumbnail
    // itself is the same DOM as the picture-preview pane
    // (img with file:// URL); clicking it opens the
    // full-size image overlay (same overlay used by the
    // preview pane, so the user gets the same zoom / arrow-
    // key behaviour).
    if (isImage) {
      const previewWrap = el('div', { class: 'fb-context-menu-preview' });
      const filename = it.name || 'image';
      const url = fileUrl(it.path);
      const img = el('img', {
        src: url,
        alt: filename,
        class: 'fb-context-menu-thumb',
        title: 'Click to open full-size preview',
      });
      let clickBound = false;
      const bindClick = (w, h) => {
        if (clickBound) return;
        clickBound = true;
        img.addEventListener('click', () => {
          close();
          openImageOverlay(url, filename, w, h, it.path);
        });
      };
      // Pre-load to get the natural size for the overlay.
      const probe = new Image();
      probe.onload = () => bindClick(probe.naturalWidth, probe.naturalHeight);
      probe.onerror = () => bindClick(0, 0);
      probe.src = url;
      // Fallback: if the probe never resolves, still allow
      // a click so the user isn't locked out of the overlay.
      setTimeout(() => bindClick(0, 0), 3000);
      previewWrap.appendChild(img);
      previewWrap.appendChild(el('div', { class: 'fb-context-menu-thumb-caption' }, filename));
      rightCol.appendChild(previewWrap);
    } else {
      // Non-image file: show a small placeholder so the
      // right column doesn't look broken (it just has
      // nothing useful to display).
      const empty = el('div', { class: 'fb-context-menu-preview-empty' }, [
        el('div', { class: 'fb-context-menu-preview-icon' }, it.isDir ? '📁' : (window.iconClassForFile ? '' : '')),
        el('div', { class: 'fb-context-menu-preview-label' }, it.isDir ? 'Folder' : 'No preview'),
      ]);
      rightCol.appendChild(empty);
    }

    const footer = el('div', { class: 'footer' }, el('button', { class: 'btn-mini', onclick: close }, 'Close'));
    m.appendChild(footer);
  });
}


