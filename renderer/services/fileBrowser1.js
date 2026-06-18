// renderer/services/fileBrowser1.js (Phase 3 Block 27)
// First half of the File browser section.

// ----------------- File browser -----------------
async function refreshBrowser(opts = {}) {
  // Prefer the per-tab saved folder (set when the user last visited this
  // tab), then the current fbDir, then the output root.
  const saved = (state.currentTab && state.fbDirs[state.currentTab]) || '';
  let startDir = state.fbDir || saved || state.config.output_dir || '';
  let out = await window.api.fbList(startDir);
  // If the user had a per-tab folder persisted but it's gone (deleted,
  // drive removed, etc.) â€” fall back to the output root instead of just
  // showing an error and forcing the user to click "Refresh". Same
  // fallback if the live fbDir fails for the same reason.
  if (!out.ok && startDir && startDir !== (state.config.output_dir || '')) {
    if (state.currentTab && state.fbDirs[state.currentTab]) {
      state.fbDirs[state.currentTab] = '';
      scheduleStateSave();
    }
    state.fbDir = '';
    const fallback = state.config.output_dir || '';
    if (fallback) {
      startDir = fallback;
      out = await window.api.fbList(fallback);
    }
  }
  if (!out.ok) {
    $('#fb-list').innerHTML = '';
    $('#fb-path').textContent = out.error || '(no output dir)';
    return;
  }
  // For the file browser, default to current tab's subfolder if it exists.
  // Skip this when:
  //   - opts.keepCurrent is set (e.g. the Up button)
  //   - we already have a saved per-tab folder (the user has navigated
  //     within this tab before â€” respect their choice)
  let target = out;
  if (!opts.keepCurrent && !saved) {
    const sub = pathJoin(target.dir, state.currentTab);
    const subTry = await window.api.fbList(sub);
    if (subTry.ok) target = subTry;
  }
  state.fbDir = target.dir;
  // Keep the per-tab slot in sync with the actual browser location so
  // navigating within a tab (e.g. via the Up button) is remembered. Also
  // trigger an autosave so the new folder survives an app restart even
  // if the user never switches tabs afterwards.
  if (state.currentTab && state.fbDirs[state.currentTab] !== target.dir) {
    state.fbDirs[state.currentTab] = target.dir;
    scheduleStateSave();
  }
  $('#fb-path').textContent = target.dir;
  $('#fb-path').title = target.dir;
  // Apply the user's preferred sort before rendering so the DOM
  // is created in the right order on the first paint (avoids a
  // flicker of "server-side default" â†’ "user's sort" on every
  // refresh). sortFbItems never mutates the input array.
  const sorted = sortFbItems(target.items, state.fbSort);
  renderFbList(sorted);
  // Apply current search filter if any
  applyFileSearch();
}
// Phase 3 Block 11: FB_SORT_MODES + normalizeFbSort + naturalCompare +
// sortFbItems extrahiert nach renderer/utils/fbSort.js. Pure Modul,
// 0 App-Coupling.
const { FB_SORT_MODES, normalizeFbSort, naturalCompare, sortFbItems } = window.FbSort;

// Build the CSS grid-template-columns string for the file
// browser rows. Order: icon + name (mandatory), then the
// user-enabled columns in declaration order.
//
// The icon column is wider (40px) when the image-thumbnail
// toggle is on so a small thumbnail can be centered in the
// cell. The 16px default matches the old behaviour for plain
// icons â€” the change is invisible to the user unless they
// enable thumbnails.
function buildFbGridTemplate() {
  const iconW = state.fbThumbnails ? '44px' : '16px';
  const cols = [iconW, 'minmax(120px, 1fr)'];
  const fbCols = normalizeFbColumns(state.fbColumns);
  for (const c of FB_COLUMNS) {
    if (fbCols[c.id]) cols.push(c.gridTemplate);
  }
  return cols.join(' ');
}
// Build the icon cell (the first column) for a file-browser row.
// Renders either a centered thumbnail of the actual image file or
// the regular text icon. The cell carries a CSS class
// ('fb-thumb' or 'fb-icon') so styles.css can pick the right
// alignment per mode.
function _buildFbIconCell(it) {
  if (state.fbThumbnails && !it.isDir && _isImageExt(it.ext)) {
    const wrap = el('span', { class: 'icon fb-thumb', title: it.name + ' â€” thumbnail' });
    const img = el('img', {
      src: fileUrl(it.path),
      alt: '',
      loading: 'lazy',
      // Decoding async keeps the list scroll smooth even when a
      // folder contains hundreds of images.
      decoding: 'async',
    });
    img.addEventListener('error', () => {
      // If the thumbnail can't load (deleted file, permission
      // problem) fall back to the regular icon so the row still
      // shows something. We replace the <img> in-place rather
      // than recreating the row so the row's click handlers stay
      // attached.
      wrap.classList.remove('fb-thumb');
      wrap.classList.add('fb-icon');
      wrap.textContent = iconForFile(it.ext);
      wrap.title = it.name;
    });
    wrap.appendChild(img);
    return wrap;
  }
  return el('span', { class: 'icon fb-icon', title: '' }, it.isDir ? 'ðŸ“' : iconForFile(it.ext));
}

// Open the folder-options overlay. Lists every optional column
// as a checkbox (the "name" column is shown but locked on), and
// the "Sort" dropdown. The user toggles a column, clicks
// "Apply" (or just sees the change live via the change event),
// and the folder explorer re-renders with the new layout. The
// overlay re-renders the folder explorer immediately on every
// change so the user can see the columns appear / disappear
// before closing the modal.
function openFolderOptions() {
  showModal((m, close) => {
    m.classList.add('folder-options-modal');
    m.appendChild(el('h2', {}, 'ðŸ“ Folder options'));
    m.appendChild(el('p', { style: 'color: var(--fg-2); font-size: 12px; margin-top: 0;' },
      'Pick which columns the folder explorer shows. The file-name column is always visible â€” turning it off would make the list unscannable. The horizontal scroll bar at the bottom of the list appears automatically when the columns don\'t fit the available width. Changes apply immediately.'));

    // Image-thumbnail toggle. When on, image rows in the file
    // browser show a centered thumbnail of the actual file
    // instead of the ðŸ–¼ icon. Row heights grow automatically so
    // the thumbnail is fully visible even when every column is
    // enabled. Folder rows and non-image files are unaffected.
    const thumbCb = el('input', { type: 'checkbox', class: 'folder-options-thumbnail-cb' });
    thumbCb.checked = !!state.fbThumbnails;
    thumbCb.addEventListener('change', () => {
      state.fbThumbnails = !!thumbCb.checked;
      scheduleStateSave();
      if (Array.isArray(state._fbItems) && state._fbItems.length) {
        renderFbList(sortFbItems(state._fbItems, state.fbSort));
        applyFileSearch();
      }
    });
    const thumbLabel = el('label', { class: 'folder-options-thumbnail-label' }, [
      thumbCb,
      el('span', {}, 'Show image thumbnails in the folder list'),
    ]);
    m.appendChild(thumbLabel);

    // Column checkboxes
    const cols = normalizeFbColumns(state.fbColumns);
    const colGrid = el('div', { class: 'folder-options-cols' });
    for (const c of FB_COLUMNS) {
      const cb = el('input', { type: 'checkbox', class: 'folder-options-col-cb' });
      cb.checked = !!cols[c.id];
      cb.addEventListener('change', () => {
        state.fbColumns[c.id] = !!cb.checked;
        scheduleStateSave();
        // Re-render the live list so the user sees the column
        // appear / disappear immediately, without having to
        // close the modal first.
        if (Array.isArray(state._fbItems) && state._fbItems.length) {
          renderFbList(sortFbItems(state._fbItems, state.fbSort));
          applyFileSearch();
        }
      });
      const label = el('label', { class: 'folder-options-col-label' }, [
        cb,
        el('span', { class: 'folder-options-col-name' }, c.label),
      ]);
      colGrid.appendChild(label);
    }
    // "Name" column (mandatory) â€” shown but locked, so the user
    // knows the column order but can't accidentally remove it.
    {
      const cb = el('input', { type: 'checkbox', checked: 'checked', disabled: 'disabled' });
      const label = el('label', { class: 'folder-options-col-label folder-options-col-locked' }, [
        cb,
        el('span', { class: 'folder-options-col-name' }, 'File name (always shown)'),
      ]);
      colGrid.appendChild(label);
    }
    m.appendChild(colGrid);

    // Footer with Close.
    m.appendChild(el('div', { class: 'footer' }, [
      el('button', { class: 'primary', onclick: close }, 'Close'),
    ]));
  });
}


function applyFileSearch() {
  const q = ($('#fb-search')?.value || '').toLowerCase();
  for (const item of $$('.fb-item')) {
    if (!q) { item.style.display = ''; continue; }
    const name = (item.dataset.name || item.querySelector('.name')?.textContent || '').toLowerCase();
    item.style.display = name.includes(q) ? '' : 'none';
  }
}

// Phase 3 Block 13: _attachDropTarget() extrahiert nach
// renderer/utils/dropTarget.js. Shim-Alias unten.
const { attachDropTarget: _attachDropTarget } = window.DropTarget;

function renderFbList(items) {
  const ul = $('#fb-list');
  ul.innerHTML = '';
  // v1.1.1 polish: empty-state hint. The previous version
  // rendered an empty <ul> with no message, which made a
  // new or empty folder look like a broken page. The hint
  // tells the user what to do next (pick a folder, or
  // generate an image) and dismisses itself as soon as a
  // file appears. Rendered inside the <ul> so the layout
  // flexes correctly with the splitter resizes.
  if (!items || items.length === 0) {
    const empty = el('li', { class: 'fb-empty' });
    const isOutput = state.fbDir && state.config.output_dir
      && state.fbDir.toLowerCase() === state.config.output_dir.toLowerCase();
    empty.appendChild(el('div', { class: 'fb-empty-title' }, isOutput ? 'This folder is empty' : 'No items'));
    empty.appendChild(el('div', { class: 'fb-empty-hint' },
      isOutput
        ? 'Click Generate on a tab above to create your first asset.'
        : 'Click ðŸ“‚ to pick a folder, or â†‘ to go up.'));
    ul.appendChild(empty);
    return;
  }
  // Apply the user's selected columns by setting a CSS
  // grid-template-columns on the <ul>. The column definitions in
  // FB_COLUMNS (see above) drive the template string. The
  // <ul> uses `min-width: max-content` so the grid expands
  // beyond the available width when necessary â€” the
  // overflow-x: auto on the list then kicks in to provide a
  // horizontal scroll bar (see styles.css). The "name" column
  // uses minmax(120px, 1fr) so the file name always gets at
  // least 120px, and the path column (when enabled) takes the
  // remaining 1fr.
  ul.style.gridTemplateColumns = buildFbGridTemplate();
  // Tag the <ul> so CSS knows which alignment to apply: thumbs
  // get a taller row + centered image; plain icons are
  // left-aligned (the user explicitly asked for left-alignment
  // when thumbnails are off). The class is also useful for the
  // zebra-striping rule which uses :nth-child(even) and would
  // otherwise re-paint the wrong row in the wider thumbnail
  // variant.
  ul.classList.toggle('fb-thumbs-on', !!state.fbThumbnails);
  ul.classList.toggle('fb-thumbs-off', !state.fbThumbnails);
  // Snapshot the rendered items on state so other helpers (e.g.
  // markFbItemActive when the user is shown a preview/overlay for a
  // path) can look up the full fs-item record (size, ext, mtime)
  // without re-fetching from the main process. This was previously
  // only available via DOM lookups, which limited context-menu code
  // to operations that only needed the path.
  state._fbItems = Array.isArray(items) ? items.slice() : [];
  // Show ".. (up)" whenever we're inside a real subdir of the output root.
  const outRoot = state.config.output_dir || '';
  if (state.fbDir && outRoot && state.fbDir.toLowerCase() !== outRoot.toLowerCase()) {
    const parent = el('li', { class: 'fb-item' }, [
      el('span', { class: 'icon fb-icon' }, 'â†©'),
      el('span', { class: 'name' }, '.. (up)'),
      // .. gets a "size" column so the row stays aligned with
      // the regular rows below it; the other columns (if any)
      // are not rendered for the parent row to keep the visual
      // noise down.
      el('span', { class: 'size' }, 'â€”'),
    ]);
    parent.addEventListener('click', () => {
      // Go up one level
      const sep = state.fbDir.includes('\\') ? '\\' : '/';
      const parts = state.fbDir.split(/[\\/]/).filter(Boolean);
      parts.pop();
      state.fbDir = parts.join(sep) || outRoot;
      refreshBrowser();
    });
    // Drop a file on ".." to move it into the parent dir.
    const _parentDir = parentDir(state.fbDir) || outRoot;
    _attachDropTarget(parent, _parentDir);
    ul.appendChild(parent);
  } else if (state.fbDir && outRoot && state.fbDir.toLowerCase() === outRoot.toLowerCase()) {
    // At the output root, but allow one "Open in Explorer" hint as a no-op row? Skip.
  }
  // Sanitise the column flags once per render so the inner loop
  // can read the booleans without re-checking the object shape.
  const fbCols = normalizeFbColumns(state.fbColumns);
  for (const it of items) {
    // Build the row's children. Icon + name are mandatory; the
    // rest of the cells come from FB_COLUMNS, in order, with a
    // CSS class matching the column id (so user styles can
    // target e.g. ".fb-item .col-size" without false-positives
    // on incidental matches).
    const cellEls = [
      _buildFbIconCell(it),
      el('span', { class: 'name', title: it.name }, it.name),
    ];
    for (const c of FB_COLUMNS) {
      if (!fbCols[c.id]) continue;
      const [text, title] = c.render(it);
      const cls = `col-${c.id}`;
      cellEls.push(el('span', { class: cls, title: title || '' }, text));
    }
    const li = el('li', {
      class: 'fb-item',
      'data-path': it.path,
      'data-isdir': it.isDir ? '1' : '0',
      'data-name': it.name,
      draggable: it.isDir ? 'false' : 'true',
    }, cellEls);
    li.addEventListener('click', (e) => {
      $$('.fb-item', ul).forEach((n) => n.classList.remove('selected'));
      li.classList.add('selected');
      state._selected = it;
      // Single-click on an image: also push it into the bottom-right
      // Picture preview pane so the user gets immediate visual feedback
      // without having to double-click first. Audio/text still need
      // double-click to open in the tab preview (they need a real
      // <audio> / <pre> element which lives inside a tab).
      if (!it.isDir && ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(it.ext)) {
        previewImageFromFile(it.path);
      }
    });
    li.addEventListener('dblclick', () => openItem(it));
    // Drag-and-drop: dragging a file over a folder moves it there. We do NOT
    // expose the actual native file path (Electron doesn't allow it), so the
    // drag is internal to the app. We use a custom MIME type so external
    // drops are ignored.
    if (!it.isDir) {
      li.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/x-minimax-fb', it.path);
        e.dataTransfer.effectAllowed = 'move';
      });
    }
    // Folders accept drops: dropping a file onto a folder moves it inside.
    if (it.isDir) {
      _attachDropTarget(li, it.path);
    }
    li.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      $$('.fb-item', ul).forEach((n) => n.classList.remove('selected'));
      li.classList.add('selected');
      state._selected = it;
      showItemContextMenu(it, e.clientX, e.clientY);
    });
    ul.appendChild(li);
  }
}



async function openItem(it) {
  // Defensive: items from the FS list always have {path, ext, isDir}, but
  // a future caller might pass a partial object. Bail out cleanly instead
  // of dereferencing undefined and getting a confusing stack trace.
  if (!it || !it.path) { toast('Invalid file item.', 'err'); return; }
  if (it.isDir) {
    state.fbDir = it.path;
    await refreshBrowser();
  } else if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(it.ext)) {
    previewImageFromFile(it.path);
  } else if (['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.opus', '.pcm'].includes(it.ext)) {
    previewAudioFromFile(it.path);
  } else if (['.txt', '.srt', '.json', '.md', '.lrc'].includes(it.ext)) {
    previewTextFromFile(it.path);
  } else {
    await window.api.fbReveal(it.path);
  }
}

// Mark the file-browser row that corresponds to `path` as the
// currently-active item (the same `.selected` class that the click
// handler in renderFbList applies when the user clicks the row).
// Also scrolls the row into view if it's currently off-screen.
//
// The user's spec is: "the file clicked and shown last in the image
// preview element (and its full image viewer) should always be marked
// as active in the folder explorer". This helper is the single place
// that enforces that. Every preview path / overlay open should call
// it with the path the user is currently looking at, so the row in
// the file browser never lags behind the preview pane.
//
// `path` is matched case-insensitively (Windows paths are
// case-insensitive in practice) and against the `data-path` attribute
// set by renderFbList. We deliberately ignore the `..` (up) row
// because it has no data-path.
