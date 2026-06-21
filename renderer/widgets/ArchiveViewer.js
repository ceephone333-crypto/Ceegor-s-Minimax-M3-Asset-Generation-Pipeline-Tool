// renderer/widgets/ArchiveViewer.js — Phase C of _plan3.md
// ============================================================================
// On-demand viewer for the JSONL archive (L3). Opened from ⚙ Settings
// → History → Open archive. Reads in chunks of 100 lines; requests the
// next chunk when the user scrolls within 20 lines of the bottom.
//
// The widget is loaded lazily — it ships as a separate script and is
// only required on first open.
//
// Public API:
//   window.ArchiveViewer.open()    → opens the modal
//   window.ArchiveViewer.close()   → closes (no-op if already closed)
// ============================================================================

(function () {
  const MODAL_ID = 'archive-viewer-modal';
  const LIST_ID = 'archive-viewer-list';
  const PAGE = 100;
  const SCROLL_NEAR_BOTTOM_PX = 20;

  let _entries = []; // currently loaded entries
  let _nextOffset = 0;
  let _hasMore = false;
  let _filter = '';   // text filter (matches title/subtitle/type/status)
  let _statusFilter = 'all'; // 'all' | 'ok' | 'err' | 'warn' | 'cancel'

  function _ensureModal() {
    let m = document.getElementById(MODAL_ID);
    if (m) return m;
    m = document.createElement('div');
    m.id = MODAL_ID;
    m.className = 'modal archive-viewer-modal';
    const header = document.createElement('div');
    header.className = 'archive-viewer-header';
    header.innerHTML = `
      <h3 style="margin: 0 0 8px;">Archive (L3 history)</h3>
      <div class="archive-viewer-toolbar">
        <input id="archive-viewer-search" type="search" placeholder="Filter by title, type, status…"
          style="flex: 1; padding: 4px 8px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg-2); color: var(--fg);">
        <select id="archive-viewer-status" class="archive-viewer-status"
          style="padding: 4px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg-2); color: var(--fg);">
          <option value="all">All</option>
          <option value="ok">OK</option>
          <option value="err">Failed</option>
          <option value="warn">Partial</option>
          <option value="cancel">Cancelled</option>
        </select>
        <span id="archive-viewer-info" style="font-size: 11px; color: var(--fg-3); margin-left: 8px;"></span>
      </div>
    `;
    const list = document.createElement('div');
    list.id = LIST_ID;
    list.className = 'archive-viewer-list';
    list.addEventListener('scroll', _onListScroll);
    const footer = document.createElement('div');
    footer.className = 'archive-viewer-footer';
    const close = document.createElement('button');
    close.textContent = 'Close';
    close.className = 'btn-mini';
    close.addEventListener('click', close);
    footer.appendChild(close);
    m.append(header, list, footer);
    document.body.appendChild(m);

    // Wire filter inputs.
    const search = m.querySelector('#archive-viewer-search');
    search.addEventListener('input', (e) => {
      _filter = (e.target.value || '').toLowerCase();
      _applyFilter();
    });
    const statusSel = m.querySelector('#archive-viewer-status');
    statusSel.addEventListener('change', (e) => {
      _statusFilter = e.target.value;
      _applyFilter();
    });
    // Close on Escape.
    m.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });
    return m;
  }

  function _formatInfo() {
    const m = document.getElementById('archive-viewer-info');
    if (!m) return;
    const filteredCount = _entries.filter(_matchesFilter).length;
    m.textContent =
      `${filteredCount} shown${_hasMore ? ` (+more loaded)` : ''} · ${_entries.length} loaded in memory`;
  }

  function _matchesFilter(entry) {
    if (_statusFilter !== 'all' && entry.status !== _statusFilter) return false;
    if (!_filter) return true;
    const haystack = [
      entry.title || '',
      entry.subtitle || '',
      entry.type || '',
      entry.status || '',
      Array.isArray(entry.outputPaths) ? entry.outputPaths.join(' ') : '',
    ].join(' ').toLowerCase();
    return haystack.includes(_filter);
  }

  function _applyFilter() {
    const list = document.getElementById(LIST_ID);
    if (!list) return;
    list.innerHTML = '';
    for (const e of _entries) {
      if (_matchesFilter(e)) list.appendChild(_renderRow(e));
    }
    _formatInfo();
  }

  function _renderRow(entry) {
    const row = document.createElement('div');
    row.className = 'archive-row archive-status-' + (entry.status || 'ok');
    const head = document.createElement('div');
    head.className = 'archive-row-head';
    const title = document.createElement('span');
    title.className = 'archive-row-title';
    title.textContent = entry.title || entry.type || 'Job';
    const meta = document.createElement('span');
    meta.className = 'archive-row-meta';
    const parts = [];
    parts.push(entry.type || '?');
    parts.push(entry.status || '?');
    if (entry.finishedAt) parts.push(new Date(entry.finishedAt).toLocaleString());
    meta.textContent = parts.join(' · ');
    head.append(title, meta);

    const body = document.createElement('div');
    body.className = 'archive-row-body';
    if (entry.subtitle) {
      const sub = document.createElement('div');
      sub.textContent = entry.subtitle;
      body.appendChild(sub);
    }
    if (Array.isArray(entry.outputPaths) && entry.outputPaths.length) {
      const outHead = document.createElement('div');
      outHead.className = 'archive-row-out-head';
      outHead.textContent = `Output (${entry.outputPaths.length})`;
      body.appendChild(outHead);
      for (const p of entry.outputPaths.slice(0, 6)) {
        const pe = document.createElement('div');
        pe.className = 'archive-row-out';
        pe.textContent = '  ↳ ' + p;
        body.appendChild(pe);
      }
      if (entry.outputPaths.length > 6) {
        const more = document.createElement('div');
        more.className = 'archive-row-out';
        more.textContent = `  ↳ … and ${entry.outputPaths.length - 6} more`;
        body.appendChild(more);
      }
    }
    const actions = document.createElement('div');
    actions.className = 'archive-row-actions';
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-mini danger';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', async () => {
      if (!confirm('Delete this archive entry?')) return;
      try {
        const r = await window.api.stateArchiveDelete(entry.id);
        if (r && r.ok) {
          // Remove from local state and re-render.
          _entries = _entries.filter((e) => e.id !== entry.id);
          row.remove();
          _formatInfo();
        } else {
          alert('Delete failed: ' + ((r && r.error) || 'unknown'));
        }
      } catch (e) {
        alert('Delete failed: ' + (e && e.message ? e.message : String(e)));
      }
    });
    actions.appendChild(delBtn);

    row.append(head, body, actions);
    return row;
  }

  function _onListScroll() {
    const list = document.getElementById(LIST_ID);
    if (!list) return;
    const dist = list.scrollHeight - (list.scrollTop + list.clientHeight);
    if (dist <= SCROLL_NEAR_BOTTOM_PX && _hasMore) {
      _loadNextPage();
    }
  }

  async function _loadNextPage() {
    if (!_hasMore) return;
    if (!window.api || typeof window.api.stateArchiveRead !== 'function') return;
    try {
      const r = await window.api.stateArchiveRead({ offset: _nextOffset, limit: PAGE });
      if (!r || !r.ok) {
        _hasMore = false;
        _formatInfo();
        return;
      }
      const incoming = Array.isArray(r.lines) ? r.lines : [];
      _entries = _entries.concat(incoming);
      _nextOffset = r.nextOffset || _nextOffset;
      _hasMore = !!r.hasMore;
      const list = document.getElementById(LIST_ID);
      if (list) {
        for (const e of incoming) {
          if (_matchesFilter(e)) list.appendChild(_renderRow(e));
        }
      }
      _formatInfo();
    } catch (_) {
      _hasMore = false;
      _formatInfo();
    }
  }

  async function open() {
    const m = _ensureModal();
    m.style.display = 'flex';
    // Reset state.
    _entries = [];
    _nextOffset = 0;
    _hasMore = true;
    _filter = '';
    _statusFilter = 'all';
    const search = m.querySelector('#archive-viewer-search');
    if (search) search.value = '';
    const statusSel = m.querySelector('#archive-viewer-status');
    if (statusSel) statusSel.value = 'all';
    const list = document.getElementById(LIST_ID);
    if (list) list.innerHTML = '';
    _formatInfo();
    await _loadNextPage();
    setTimeout(() => { if (search) search.focus(); }, 0);
  }

  function close() {
    const m = document.getElementById(MODAL_ID);
    if (m) m.style.display = 'none';
  }

  window.ArchiveViewer = { open, close };
})();