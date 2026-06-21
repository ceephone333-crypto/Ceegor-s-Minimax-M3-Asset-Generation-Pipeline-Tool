// renderer/services/LogService.js
// Log pane + log event API. Phase 3 Block 21 + Phase A of _plan3.md
// (multi-job primary row + new toolbar + jump pill + autoscroll +
// Ctrl+Click multi-select + per-job secondary events).
//
// The new row layout (Phase A):
//   Every job has exactly ONE primary log row. Secondary stderr
//   chunks attached to a job are rendered into the primary row's
//   expanded details, NOT as their own rows. Free-form events
//   (no jobId) still get their own row.
//
// The new public API additions (all optional, existing callers
// continue to work):
//   addLogEvent({ ..., jobId, pinToBottom, progress, cancellable })
//   collapseAll() / expandAll()
//   jumpToNewest() / jumpToOldest()
//   setAutoscroll(on) / getAutoscroll()
//   countSelected() / selectedRowsExpanded()
//   attachSecondaryToJob(jobId, line)
//   updateLogStatus(logEventId, { status, result })
//   appendLogDetails(logEventId, lines)
//   scrollToJob(jobId)
//
// Keyboard (Phase A):
//   Ctrl+Click         toggle selection
//   Shift+Click        range select
//   Plain click        toggle expand (no longer toggles selection)
//   Ctrl+C             copy selected rows
//   Ctrl+A             select all (in the visible pane)
//   Ctrl+Shift+C       copy all visible rows
//   Esc                clear selection
//   Home / End         jump to newest / oldest

var { el } = window.createElement ? { el: window.createElement } : window.DomHelpers || { el: (tag, attrs, children) => {
  const node = document.createElement(tag);
  if (attrs) for (const k of Object.keys(attrs)) {
    const v = attrs[k];
    if (v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  if (children != null) {
    if (!Array.isArray(children)) children = [children];
    for (const c of children) {
      if (c == null) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
  }
  return node;
}};
var $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
var { maskLine } = window.securityUtils || (() => String);

// Default per-job secondary-event cap. Phase C moves this to a config
// field; the constant here is the safe baseline.
const SECONDARY_PER_JOB_CAP = 500;
const _LOG_GROUP_HUE_COUNT = 12;
const _logGroupSeen = new Map();
let _logGroupNextIdx = 0;
function _groupClass(gid) {
  if (gid == null || gid === '') return null;
  const key = String(gid);
  let idx = _logGroupSeen.get(key);
  if (idx == null) {
    idx = _logGroupNextIdx % _LOG_GROUP_HUE_COUNT;
    _logGroupSeen.set(key, idx);
    _logGroupNextIdx++;
  }
  return 'log-group-' + idx;
}

// Map of logId -> jobId for fast lookups by row clicks. Populated by
// addLogEvent / renderLogEvent, pruned when the buffer is trimmed.
const _logJobIndex = new Map();

// ----- autoscroll state (persisted via state.json by app.js if desired) -----
let _autoscroll = true;
function getAutoscroll() { return _autoscroll; }
function setAutoscroll(on) {
  _autoscroll = !!on;
  if (_autoscroll) {
    _hideJumpPill();
    _scrollPaneToNewest();
  }
  _updateAutoscrollChip();
}

function _updateAutoscrollChip() {
  const chip = document.querySelector('#log-autoscroll-chip');
  if (!chip) return;
  chip.classList.toggle('on', _autoscroll);
  chip.classList.toggle('off', !_autoscroll);
  chip.textContent = `Auto: ${_autoscroll ? 'ON' : 'OFF'}`;
}

function _scrollPaneToNewest() {
  const root = document.querySelector('#log');
  if (!root) return;
  // With flex-direction: column-reverse, scrollTop=0 IS the visual
  // top (newest row). This is intentional — see styles.css comments.
  root.scrollTop = 0;
}
function _scrollPaneToOldest() {
  const root = document.querySelector('#log');
  if (!root) return;
  root.scrollTop = root.scrollHeight;
}

let _pendingNewCount = 0;
function _onPaneScroll() {
  if (_autoscroll) return;
  const root = document.querySelector('#log');
  if (!root) return;
  // If the user is near the top (column-reverse => scrollTop=0),
  // they're "at newest" — clear the pill and re-enable autoscroll.
  if (root.scrollTop <= 4) {
    _autoscroll = true;
    _pendingNewCount = 0;
    _hideJumpPill();
    _updateAutoscrollChip();
  }
}
function _bumpNewCount() {
  if (_autoscroll) return;
  const root = document.querySelector('#log');
  if (!root) return;
  if (root.scrollTop <= 4) return; // already at newest
  _pendingNewCount++;
  _showJumpPill(_pendingNewCount);
}
function _showJumpPill(n) {
  const pill = document.querySelector('#log-jump-pill');
  if (!pill) return;
  pill.textContent = `↓ ${n} new`;
  pill.classList.add('visible');
}
function _hideJumpPill() {
  const pill = document.querySelector('#log-jump-pill');
  if (pill) pill.classList.remove('visible');
}

function jumpToNewest() {
  _autoscroll = true;
  _pendingNewCount = 0;
  _hideJumpPill();
  _updateAutoscrollChip();
  _scrollPaneToNewest();
}
function jumpToOldest() {
  _scrollPaneToOldest();
}

// ----- addLogEvent (Phase A extended) -----
//
// New optional fields:
//   jobId          string | null   links the row to a Job
//   pinToBottom    boolean         primary job rows are rendered "last"
//                                  visually (in a column-reverse flex
//                                  container that means at the top of
//                                  the visible list, which is the
//                                  newest). We just append normally —
//                                  the column-reverse flex does the
//                                  rest; the flag is informational and
//                                  affects ordering only when older
//                                  jobs are present.
//   progress       { step, total } | null   shows a small "step/total"
//                                  fraction on the row.
//   cancellable    boolean         shows an inline ✕ on the row.
//   typeIcon       string          emoji or short glyph (🖼 🎵 🗣 🎬 ⬆ ⚙ ✂).
//   state          'wip' | 'ok' | 'warn' | 'err' | 'cancel'  default 'wip'
//   expanded       boolean         open the details on first render.
//
// Backwards compat: every existing caller (the tab gen handlers, the
// legacy log() wrapper, etc.) passes the OLD signature and continues
// to work. New fields default to safe nulls.
function addLogEvent(opts) {
  var { LOG_MAX_EVENTS, LOG_CATEGORIES } = window.LogCategories;
  opts = opts || {};
  const cfg = window.state && window.state.config || {};
  const mask = (s) => maskLine(String(s == null ? '' : s), cfg.api_key);
  const ev = {
    id: _logNextId(),
    ts: opts.ts instanceof Date ? opts.ts : new Date(),
    category: LOG_CATEGORIES[opts.category] ? opts.category : 'info',
    headline: mask(opts.headline || ''),
    details: (function () {
      const d = opts.details;
      if (d == null) return [];
      const arr = Array.isArray(d) ? d : String(d).split(/\r?\n/);
      return arr.map((s) => mask(s)).filter((s) => s !== '');
    })(),
    result: opts.result === 'ok' || opts.result === 'err' ? opts.result : null,
    expanded: !!opts.expanded,
    raw: opts.raw != null ? mask(String(opts.raw)) : null,
    groupId: opts.groupId != null ? String(opts.groupId) : null,
    // Phase A fields
    jobId: opts.jobId != null ? String(opts.jobId) : null,
    pinToBottom: !!opts.pinToBottom,
    progress: opts.progress && typeof opts.progress === 'object'
      ? { step: opts.progress.step | 0, total: opts.progress.total | 0 }
      : null,
    cancellable: !!opts.cancellable,
    typeIcon: opts.typeIcon || null,
    state: opts.state || 'wip',
    // Internal flag used by JobRunner._addLogSecondary to bypass
    // the wip-jobId routing (avoids infinite recursion: the
    // routing would call attachSecondaryToJob, which calls
    // addLogEvent again with the same jobId).
    _internal: !!opts._internal,
  };
  // If a jobId is set, the JobRunner owns the row; the job is the
  // source of truth. Free-form events get their own row. The
  // `_internal` flag tells us we're already inside the
  // attachSecondaryToJob flow and must NOT re-route.
  if (ev.jobId && _jobStatusFor(ev.jobId) === 'wip' && !ev._internal) {
    // Append the line into the job's primary row's details, not as
    // its own row. (attachSecondaryToJob is the public path; this
    // branch keeps `addLogEvent({ jobId })` working for callers that
    // prefer to talk to addLogEvent directly.)
    if (window.JobRunner && typeof window.JobRunner.attachSecondaryToJob === 'function') {
      window.JobRunner.attachSecondaryToJob(ev.jobId, ev.headline);
    }
    return ev.id;
  }
  return _appendEvent(ev, opts);
}

// _appendEvent is the common code path used by both addLogEvent
// (public) and the internal recursive call from JobRunner. It
// creates the event, appends to the buffer, renders the row, and
// scrolls the pane.
function _appendEvent(ev, opts) {
  var { LOG_MAX_EVENTS } = window.LogCategories;
  window.state._logEvents.push(ev);
  _logJobIndex.set(ev.id, ev.jobId);
  // Cap the buffer. Drop the oldest events (FIFO) so the visible
  // scroll position stays near the bottom (newest event). The user
  // can still scroll up to see what's left of the dropped events.
  if (window.state._logEvents.length > LOG_MAX_EVENTS) {
    const dropped = window.state._logEvents.length - LOG_MAX_EVENTS;
    const removed = window.state._logEvents.splice(0, dropped);
    for (const r of removed) _logJobIndex.delete(r.id);
  }
  renderLogEvent(ev);
  if (_autoscroll) _scrollPaneToNewest();
  else _bumpNewCount();
  if (opts && opts.select) toggleLogSelection(ev.id, true, false);
  return ev.id;
}

let _logIdCounter = 0;
function _logNextId() { return ++_logIdCounter; }

// _jobStatusFor looks up the status of a job in state.jobs. Used to
// decide whether a `jobId`-tagged event should become its own row or
// attach to the primary row.
function _jobStatusFor(jobId) {
  if (!jobId || !window.state || !window.state.jobs) return null;
  const j = window.state.jobs.get(jobId);
  return j ? j.status : null;
}

// Render a single event into the log pane. Builds the row's DOM once
// and appends it. The row carries the event id on a data attribute
// so click handlers can look up the underlying event in
// window.state._logEvents.
function renderLogEvent(ev) {
  var { LOG_CATEGORIES } = window.LogCategories;
  const root = document.querySelector('#log');
  if (!root) return;
  const cat = LOG_CATEGORIES[ev.category] || LOG_CATEGORIES.info;
  const groupCls = _groupClass(ev.groupId);
  const resultCls = ev.result === 'ok' ? ' log-result-ok'
    : ev.result === 'err' ? ' log-result-err' : '';
  const stateCls = ' log-state-' + (ev.state || 'wip');
  // The icon column shows the type icon (for jobs) or the category
  // icon (for free-form events). The user gets one glyph per row.
  const icon = ev.typeIcon || cat.icon;
  const row = el('div', {
    class: 'log-event' + (groupCls ? ' ' + groupCls : '') + resultCls + stateCls,
    'data-log-id': ev.id,
    'data-log-cat': ev.category,
    'data-log-group': ev.groupId || '',
    'data-log-state': ev.state || 'wip',
  });
  // 1. Time stamp
  const tsText = ev.ts.toLocaleTimeString('en-GB', { hour12: false });
  row.appendChild(el('span', { class: 'log-event-ts', title: ev.ts.toISOString() }, tsText));
  // 2. Type / category icon
  row.appendChild(el('span', { class: 'log-type-icon', title: cat.label }, icon));
  // 3. Headline. Truncated with ellipsis on overflow; full text on
  //    hover.
  const headlineEl = el('span', { class: 'log-event-headline', title: ev.headline }, ev.headline);
  row.appendChild(headlineEl);
  // 3b. WIP animated dots (only on wip state).
  if (ev.state === 'wip' && !ev.cancellable) {
    // No inline cancel but still wip — show the dots to indicate
    // activity. (Most wip rows are also cancellable; this is the
    // rare "free-form wip" case.)
    const dots = el('span', { class: 'log-wip-dots' }, [el('span', {}), el('span', {}), el('span', {})]);
    row.appendChild(dots);
  } else if (ev.state === 'wip' && ev.cancellable) {
    // WIP + cancellable: dots are appended AFTER the cancel button
    // (below) so the dots sit just left of the chevron.
  }
  // 3c. Progress fraction (e.g. "3/20")
  if (ev.progress && ev.progress.total > 0) {
    row.appendChild(el('span', { class: 'log-progress', title: 'Progress' },
      `${ev.progress.step}/${ev.progress.total}`));
  }
  // 3d. Animated dots for wip + cancellable rows
  if (ev.state === 'wip' && ev.cancellable) {
    const dots = el('span', { class: 'log-wip-dots' }, [el('span', {}), el('span', {}), el('span', {})]);
    row.appendChild(dots);
  }
  // 4. Inline cancel button (cancellable + wip only).
  let cancelBtn = null;
  if (ev.cancellable && ev.state === 'wip') {
    cancelBtn = el('button', {
      type: 'button',
      class: 'log-cancel-btn',
      title: 'Cancel this job',
      'aria-label': 'Cancel',
    }, '✕');
    row.appendChild(cancelBtn);
  }
  // 5. Expand chevron
  const hasDetails = ev.details.length > 0 || !!ev.raw;
  const chev = el('button', {
    type: 'button',
    class: 'log-event-chev' + (hasDetails ? '' : ' log-event-chev-empty'),
    'aria-label': hasDetails ? 'Toggle details' : 'No details',
  }, ev.expanded ? '▾' : '▸');
  row.appendChild(chev);
  // 6. Details section
  if (hasDetails) {
    const det = el('div', { class: 'log-event-details' });
    if (!ev.expanded) det.style.display = 'none';
    for (const line of ev.details) {
      det.appendChild(el('div', { class: 'log-event-detail-line' }, line));
    }
    if (ev.raw) {
      det.appendChild(el('div', { class: 'log-event-detail-line log-event-detail-raw' }, ev.raw));
    }
    row.appendChild(det);
  }
  // Selection state
  if (isLogSelected(ev.id)) row.classList.add('selected');
  if (ev.expanded) row.classList.add('expanded');
  root.appendChild(row);
}

// ----- selection helpers -----
const _logSelected = new Set();
function isLogSelected(id) { return _logSelected.has(id); }
function toggleLogSelection(id, selected, scrollIntoView) {
  if (selected) _logSelected.add(id);
  else _logSelected.delete(id);
  const row = document.querySelector(`.log-event[data-log-id="${id}"]`);
  if (row) {
    row.classList.toggle('selected', selected);
    if (scrollIntoView) {
      try { row.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) {}
    }
  }
}
function clearLogSelection() {
  _logSelected.clear();
  $$('.log-event.selected').forEach((n) => n.classList.remove('selected'));
}
function selectLogRange(fromId, toId) {
  const ids = window.state._logEvents.map((e) => e.id);
  const a = ids.indexOf(fromId);
  const b = ids.indexOf(toId);
  if (a < 0 || b < 0) return;
  const lo = Math.min(a, b), hi = Math.max(a, b);
  for (let i = lo; i <= hi; i++) toggleLogSelection(ids[i], true, false);
}
function selectAllLog() {
  clearLogSelection();
  for (const ev of window.state._logEvents) toggleLogSelection(ev.id, true, false);
}
function countSelected() { return _logSelected.size; }
function selectedRowsExpanded() {
  if (_logSelected.size === 0) return false;
  for (const id of _logSelected) {
    const ev = window.state._logEvents.find((x) => x.id === id);
    if (!ev) continue;
    if (!ev.expanded) return false;
  }
  return true;
}

// ----- format / copy -----
function formatLogEventForCopy(ev) {
  var { LOG_CATEGORIES } = window.LogCategories;
  const parts = [];
  const ts = ev.ts.toLocaleString();
  const cat = (LOG_CATEGORIES[ev.category] || LOG_CATEGORIES.info).label;
  const res = ev.result === 'ok' ? ' [OK]' : ev.result === 'err' ? ' [ERR]' : '';
  const grp = ev.groupId ? ` [group=${ev.groupId}]` : '';
  // Phase A: include the state so a help-desk helper can see "this row
  // was wip when the user copied" without having to open DevTools.
  const st = ev.state && ev.state !== 'wip' ? ` [${ev.state}]` : '';
  parts.push(`[${ts}] [${cat}]${res}${st}${grp} ${ev.headline}`);
  for (const d of ev.details) parts.push('    ' + d);
  if (ev.raw) parts.push('    ' + ev.raw);
  return parts.join('\n');
}
function collectLogCopyText(opts) {
  opts = opts || {};
  const events = window.state._logEvents;
  if (!events.length) return '';
  let chosen;
  if (opts.all || _logSelected.size === 0) {
    chosen = events.slice();
  } else {
    const selSet = _logSelected;
    chosen = events.filter((e) => selSet.has(e.id));
    chosen.sort((a, b) => a.id - b.id);
  }
  return chosen.map(formatLogEventForCopy).join('\n');
}

// ----- expand / collapse all -----
function collapseAll() {
  for (const ev of window.state._logEvents) {
    if (ev.expanded) {
      ev.expanded = false;
      const row = document.querySelector(`.log-event[data-log-id="${ev.id}"]`);
      if (!row) continue;
      row.classList.remove('expanded');
      const det = row.querySelector('.log-event-details');
      if (det) det.style.display = 'none';
      const chev = row.querySelector('.log-event-chev');
      if (chev) chev.textContent = '▸';
    }
  }
}
function expandAll() {
  for (const ev of window.state._logEvents) {
    if (!ev.expanded) {
      ev.expanded = true;
      const row = document.querySelector(`.log-event[data-log-id="${ev.id}"]`);
      if (!row) continue;
      row.classList.add('expanded');
      const det = row.querySelector('.log-event-details');
      if (det) det.style.display = '';
      const chev = row.querySelector('.log-event-chev');
      if (chev) chev.textContent = '▾';
    }
  }
}

// ----- update log status (Phase A) -----
// Called by JobRunner when a job finishes; updates the row's state
// class + result + removes the inline cancel button.
function updateLogStatus(logEventId, patch) {
  if (logEventId == null) return;
  patch = patch || {};
  const ev = window.state._logEvents.find((x) => x.id === logEventId);
  const row = document.querySelector(`.log-event[data-log-id="${logEventId}"]`);
  if (!row) return;
  if (ev) {
    if (patch.status) ev.state = patch.status;
    if (patch.result) ev.result = patch.result;
  }
  // Replace state class
  const oldStates = ['log-state-wip', 'log-state-ok', 'log-state-warn', 'log-state-err', 'log-state-cancel'];
  for (const c of oldStates) row.classList.remove(c);
  const newState = (patch && patch.status) || (ev && ev.state) || 'wip';
  row.classList.add('log-state-' + newState);
  row.setAttribute('data-log-state', newState);
  // Replace result class
  row.classList.remove('log-result-ok', 'log-result-err');
  if (patch.result === 'ok') row.classList.add('log-result-ok');
  if (patch.result === 'err') row.classList.add('log-result-err');
  // Remove the wip dots + cancel button (the row is done)
  const dots = row.querySelector('.log-wip-dots');
  if (dots) dots.remove();
  const cancelBtn = row.querySelector('.log-cancel-btn');
  if (cancelBtn) cancelBtn.remove();
  // WIP was a 4px progress; the result column was empty. Put a
  // small static marker so the row is still easy to scan.
  // (The result-ok / result-err class already drives the colour.)
}
function appendLogDetails(logEventId, lines) {
  if (logEventId == null || !lines || !lines.length) return;
  const ev = window.state._logEvents.find((x) => x.id === logEventId);
  const row = document.querySelector(`.log-event[data-log-id="${logEventId}"]`);
  if (!ev || !row) return;
  const det = row.querySelector('.log-event-details');
  if (!det) return;
  for (const line of lines) {
    const safe = String(line == null ? '' : line);
    ev.details.push(safe);
    det.appendChild(el('div', { class: 'log-event-detail-line' }, safe));
  }
}

// ----- attach a free-form line to a job's primary row -----
// Used by the mmx:log handler: any line with a jobId is appended
// into the row's details, NOT as its own row.
function attachSecondaryToJob(jobId, line) {
  if (!jobId || !line) return;
  if (!window.JobRunner) return;
  if (typeof window.JobRunner.attachSecondaryToJob === 'function') {
    window.JobRunner.attachSecondaryToJob(jobId, line);
  }
}

// ----- scrollToJob (Phase B helper, declared here for completeness) -----
function scrollToJob(jobId) {
  if (!jobId || !window.state || !window.state.jobs) return;
  const job = window.state.jobs.get(jobId);
  if (!job || job.logEventId == null) return;
  const row = document.querySelector(`.log-event[data-log-id="${job.logEventId}"]`);
  if (!row) return;
  // Expand the row.
  const ev = window.state._logEvents.find((x) => x.id === job.logEventId);
  if (ev && !ev.expanded) {
    ev.expanded = true;
    row.classList.add('expanded');
    const det = row.querySelector('.log-event-details');
    if (det) det.style.display = '';
    const chev = row.querySelector('.log-event-chev');
    if (chev) chev.textContent = '▾';
  }
  row.scrollIntoView({ block: 'center' });
}

// ----- click + keyboard wiring -----
function setupLogClicks() {
  const root = document.querySelector('#log');
  if (!root) return;
  root.addEventListener('click', (e) => {
    // Inline cancel button
    const cancelEl = e.target.closest('.log-cancel-btn');
    if (cancelEl) {
      e.preventDefault();
      e.stopPropagation();
      const row = cancelEl.closest('.log-event');
      if (!row) return;
      const ev = window.state._logEvents.find((x) => x.id === parseInt(row.getAttribute('data-log-id') || '0', 10));
      if (!ev || !ev.jobId) return;
      if (window.JobRunner && typeof window.JobRunner.cancel === 'function') {
        window.JobRunner.cancel(ev.jobId);
      }
      return;
    }
    const row = e.target.closest('.log-event');
    if (!row) return;
    const id = parseInt(row.getAttribute('data-log-id') || '0', 10);
    if (!id) return;
    // Chevron click — toggle expand only.
    if (e.target.classList.contains('log-event-chev')) {
      e.stopPropagation();
      const ev = window.state._logEvents.find((x) => x.id === id);
      if (!ev) return;
      if (!ev.details.length && !ev.raw) return;
      ev.expanded = !ev.expanded;
      row.classList.toggle('expanded', ev.expanded);
      const det = row.querySelector('.log-event-details');
      if (det) det.style.display = ev.expanded ? '' : 'none';
      const chev = row.querySelector('.log-event-chev');
      if (chev) chev.textContent = ev.expanded ? '▾' : '▸';
      return;
    }
    // Multi-select on Ctrl+Click, range on Shift+Click, expand on plain click.
    if (e.shiftKey && window.state._logLastClickedId != null) {
      e.preventDefault();
      selectLogRange(window.state._logLastClickedId, id);
    } else if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      toggleLogSelection(id, !isLogSelected(id), false);
      window.state._logLastClickedId = id;
    } else {
      // Plain click: toggle expand. Selection is NOT changed.
      e.preventDefault();
      const ev = window.state._logEvents.find((x) => x.id === id);
      if (ev && (ev.details.length || ev.raw)) {
        ev.expanded = !ev.expanded;
        row.classList.toggle('expanded', ev.expanded);
        const det = row.querySelector('.log-event-details');
        if (det) det.style.display = ev.expanded ? '' : 'none';
        const chev = row.querySelector('.log-event-chev');
        if (chev) chev.textContent = ev.expanded ? '▾' : '▸';
      }
      window.state._logLastClickedId = id;
    }
  });
  // Scroll listener for the "↓ N new" pill
  root.addEventListener('scroll', _onPaneScroll, { passive: true });
  // Keyboard handlers (delegated on document, with input-focus bail-out)
  document.addEventListener('keydown', (e) => {
    const tag = e.target && e.target.tagName;
    const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (inField) return;
    // Only react when the log pane is "in focus" (i.e. no focused
    // input). Ctrl-modifier handlers still fire — they bail out
    // explicitly via inField above for non-Ctrl shortcuts.
    const cmd = e.ctrlKey || e.metaKey;
    if (!e.key) return;
    if (cmd && (e.key === 'c' || e.key === 'C') && e.shiftKey) {
      // Ctrl+Shift+C → copy all visible rows
      e.preventDefault();
      const txt = collectLogCopyText({ all: true });
      _writeToClipboard(txt, 'All log rows copied.');
      return;
    }
    if (cmd && (e.key === 'c' || e.key === 'C')) {
      // Ctrl+C → copy selected
      e.preventDefault();
      const txt = collectLogCopyText();
      _writeToClipboard(txt, _logSelected.size > 0 ? `${_logSelected.size} row(s) copied.` : 'Log copied.');
      return;
    }
    if (cmd && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault();
      selectAllLog();
      return;
    }
    if (e.key === 'Escape') {
      if (_logSelected.size > 0) {
        clearLogSelection();
        e.preventDefault();
      }
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      jumpToNewest();
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      jumpToOldest();
      return;
    }
  });
}

function _writeToClipboard(txt, successMsg) {
  if (!txt) {
    if (window.toast) window.toast('Log is empty.', 'warn');
    return;
  }
  // navigator.clipboard.writeText can reject when the user has a
  // full clipboard history (e.g. recent images). Fall back to the
  // legacy text-range + execCommand path that the existing Copy
  // button uses — it never rejects, just works.
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(() => {
      if (window.toast && successMsg) window.toast(successMsg, 'ok', 1500);
    }).catch(() => {
      _legacyCopyFallback(txt);
      if (window.toast && successMsg) window.toast(successMsg + ' (fallback)', 'ok', 1500);
    });
  } else {
    _legacyCopyFallback(txt);
    if (window.toast && successMsg) window.toast(successMsg, 'ok', 1500);
  }
}
function _legacyCopyFallback(txt) {
  try {
    const ta = document.createElement('textarea');
    ta.value = txt;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  } catch (_) { /* ignore */ }
}

// ----- legacy log() wrapper -----
function log(line) {
  if (!line) return;
  addLogEvent({
    category: 'info',
    headline: maskLine(String(line), window.state && window.state.config && window.state.config.api_key),
  });
}

// ----- toolbar wire-up (Phase A) -----
// The buttons live inside the <details><summary> in index.html. We
// wire them here so the markup stays in the template.
function setupLogToolbar() {
  const newBtn = document.querySelector('#log-jump-newest');
  const oldBtn = document.querySelector('#log-jump-oldest');
  const collapseBtn = document.querySelector('#log-collapse-all');
  const expandBtn = document.querySelector('#log-expand-all');
  const chip = document.querySelector('#log-autoscroll-chip');
  const pill = document.querySelector('#log-jump-pill');
  if (newBtn) newBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); jumpToNewest(); });
  if (oldBtn) oldBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); jumpToOldest(); });
  if (collapseBtn) collapseBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); collapseAll(); });
  if (expandBtn) expandBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); expandAll(); });
  if (chip) chip.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); setAutoscroll(!_autoscroll); });
  if (pill) pill.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); jumpToNewest(); });
  _updateAutoscrollChip();
}

window.LogService = {
  init: setupLogClicks,
  setupLogToolbar,
  addLogEvent, renderLogEvent, formatLogEventForCopy, collectLogCopyText,
  setupLogClicks, log,
  isLogSelected, toggleLogSelection, clearLogSelection, selectLogRange, selectAllLog,
  countSelected, selectedRowsExpanded,
  collapseAll, expandAll,
  jumpToNewest, jumpToOldest,
  setAutoscroll, getAutoscroll,
  attachSecondaryToJob,
  updateLogStatus, appendLogDetails,
  scrollToJob,
  SECONDARY_PER_JOB_CAP,
};
