// renderer/services/LogService.js
// Log pane + log event API. Phase 3 Block 21.
//
// Exports: addLogEvent, renderLogEvent, formatLogEventForCopy,
// collectLogCopyText, setupLogClicks, log, isLogSelected,
// toggleLogSelection, clearLogSelection, selectLogRange.
//
// Internal state: _logIdCounter, _logSelected. Reachable via
// the global `state._logEvents` and `state._logLastClickedId`.

var { el, $ } = window.createElement ? { el: window.createElement, $: (s) => document.querySelector(s) } : window.DomHelpers || {};
var $$ = (sel) => Array.from(document.querySelectorAll(sel));
var { maskLine } = window.securityUtils || (() => String);  // fallback

// Add a new event to the log. Returns the new event id so the
// caller can reference it later (e.g. for a "background
// generation complete" event that needs to update a prior
// "background generation started" event).
//
// Args:
//   opts.headline  : string, short one-line description (required)
//   opts.category  : string, one of LOG_CATEGORIES keys (default 'info')
//   opts.details   : string | string[] | null, extra lines shown
//                    when the row is expanded. Strings are split
//                    on \n into multiple lines; null is no details.
//   opts.result    : 'ok' | 'err' | null (default null). Drives the
//                    trailing ✓ / ✕ icon.
//   opts.ts        : Date | null (default: now). Pass a custom
//                    timestamp for events that happened earlier
//                    (e.g. after a delay).
//   opts.select    : boolean (default false). If true, the new
//                    event is also added to the current selection.
//   opts.raw       : string | null. Free-form text (used by the
//                    legacy log() wrapper). Included in the
//                    copy output but not shown in the row.
//   opts.groupId   : string | number | null. Free-form tag the
//                    caller can use to group related events
//                    (e.g. one generation run produces a
//                    "started" + "completed" event that share
//                    the same groupId). The renderer tints
//                    all events with the same groupId the
//                    same colour so the user can visually
//                    trace which log lines belong to which
//                    generated picture. The ID itself is
//                    not shown — it's only used as a CSS
//                    class hash (group-1, group-2, …) so a
//                    long session doesn't grow an unbounded
//                    stylesheet. We cap to 12 distinct hues
//                    and cycle.
//
// Masking: the headline + details are passed through maskLine()
// so a full API key never appears in a log event the user
// might paste into a support ticket.
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
function addLogEvent(opts) {
  var { LOG_MAX_EVENTS, LOG_CATEGORIES } = window.LogCategories;
  opts = opts || {};
  const cfg = window.state && window.state.config || {};
  const mask = (s) => maskLine(String(s == null ? '' : s), cfg.api_key);
  const ev = {
    id: (_logNextId()),
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
    // v1.1.9: optional groupId the caller can use to colour-code
    // related events. Stored on the event AND resolved into a
    // log-group-N CSS class (capped to 12 distinct hues, cycled)
    // when the row is rendered.
    groupId: opts.groupId != null ? String(opts.groupId) : null,
  };
  window.state._logEvents.push(ev);
  // Cap the buffer. Drop the oldest events (FIFO) so the
  // visible scroll position stays near the bottom (newest
  // event). The user can still scroll up to see what's left
  // of the dropped events (they're gone from memory but the
  // UI re-renders only the live buffer).
  if (window.state._logEvents.length > LOG_MAX_EVENTS) {
    window.state._logEvents.splice(0, window.state._logEvents.length - LOG_MAX_EVENTS);
  }
  renderLogEvent(ev);
  // Auto-scroll the container to the new event unless the user
  // has scrolled up to read older events (a "stick to bottom"
  // toggle is a future enhancement; the simple "always scroll
  // to bottom on new event" is the right default for a log).
  const root = document.querySelector('#log');
  if (root) root.scrollTop = root.scrollHeight;
  if (opts.select) toggleLogSelection(ev.id, true, false);
  return ev.id;
}

let _logIdCounter = 0;
function _logNextId() { return ++_logIdCounter; }

// Render a single event into the log pane. Builds the row's
// DOM once and appends it. The row carries the event id on a
// data attribute so click handlers can look up the underlying
// event in window.state._logEvents.
function renderLogEvent(ev) {
  var { LOG_CATEGORIES } = window.LogCategories;
  const root = document.querySelector('#log');
  if (!root) return;
  const cat = LOG_CATEGORIES[ev.category] || LOG_CATEGORIES.info;
  // v1.1.9: tint the row with a group-N class if the event has
  // a groupId, so the user can visually trace which log lines
  // belong to which generated picture / generation run. The
  // group class is resolved to one of 12 stable hues (see
  // _groupClass above) and cycled for new IDs.
  // v1.1.15: also tag the row with a result class so the
  // CSS can colour the WHOLE row (not just the small icon)
  // based on the result. Green for ok, red for err, no class
  // for info. The user reported that the small icon at the
  // start of the row was easy to miss in a long log, so the
  // row-level tint makes the success/failure status obvious
  // at a glance.
  const groupCls = _groupClass(ev.groupId);
  const resultCls = ev.result === 'ok' ? ' log-result-ok'
    : ev.result === 'err' ? ' log-result-err' : '';
  const row = el('div', {
    class: 'log-event' + (groupCls ? ' ' + groupCls : '') + resultCls,
    'data-log-id': ev.id,
    'data-log-cat': ev.category,
    'data-log-group': ev.groupId || '',
  });
  // 1. Time stamp
  const tsText = ev.ts.toLocaleTimeString('en-GB', { hour12: false });
  row.appendChild(el('span', { class: 'log-event-ts', title: ev.ts.toISOString() }, tsText));
  // 2. Category icon (single character so the row stays compact)
  row.appendChild(el('span', { class: 'log-event-cat', title: cat.label }, cat.icon));
  // 3. Result icon. "ok" → green check, "err" → red cross, null → no icon.
  let resChar = '';
  let resTitle = '';
  if (ev.result === 'ok') { resChar = '✓'; resTitle = 'Success'; }
  else if (ev.result === 'err') { resChar = '✕'; resTitle = 'Error'; }
  if (resChar) {
    const cls = 'log-event-res ' + (ev.result === 'ok' ? 'ok' : 'err');
    row.appendChild(el('span', { class: cls, title: resTitle }, resChar));
  } else {
    row.appendChild(el('span', { class: 'log-event-res none' }, ''));
  }
  // 4. Headline + the (collapsed) details, shown as a single
  //    text node. The user-visible headline is truncated with
  //    ellipsis if it overflows the row, but the full text is
  //    available on hover via the title attribute.
  const headlineEl = el('span', { class: 'log-event-headline', title: ev.headline }, ev.headline);
  row.appendChild(headlineEl);
  // 5. Expand chevron. Toggles the details section on click.
  //    We always render it (even when details is empty) so the
  //    visual position of the column is stable. The chevron is
  //    visually-disabled (lower opacity, no hover) when there
  //    are no details to show.
  const hasDetails = ev.details.length > 0 || !!ev.raw;
  const chev = el('button', {
    type: 'button',
    class: 'log-event-chev' + (hasDetails ? '' : ' log-event-chev-empty'),
    'aria-label': hasDetails ? 'Toggle details' : 'No details',
  }, ev.expanded ? '▾' : '▸');
  row.appendChild(chev);
  // 6. Details section (rendered but hidden when not expanded).
  //    Each detail line is its own <div> for clean wrapping.
  //    When the user copies selected events, both the headline
  //    and every detail line are included (so the clipboard
  //    contains everything, not just the visible one-liner).
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
  // Selection state. If this event id is currently in the
  // selection set, add the class so the row shows the
  // highlight. The toggle is done in the click handler.
  if (isLogSelected(ev.id)) row.classList.add('selected');
  if (ev.expanded) row.classList.add('expanded');
  root.appendChild(row);
  // Click delegation: the row-level click listener is attached
  // once on the root element (see setupLogClicks below), so
  // individual rows don't need per-row listeners.
}

// Track which events are currently in the multi-selection. A
// Set is used so the copy path can do a fast ordered iteration
// (Set preserves insertion order). The set is NOT exposed on
// window.state — it's an internal implementation detail of the log
// pane.
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
// Range-select helper: select every event between `fromId` and
// `toId` (inclusive) by document order. Used by shift-click.
function selectLogRange(fromId, toId) {
  const ids = window.state._logEvents.map((e) => e.id);
  const a = ids.indexOf(fromId);
  const b = ids.indexOf(toId);
  if (a < 0 || b < 0) return;
  const lo = Math.min(a, b), hi = Math.max(a, b);
  for (let i = lo; i <= hi; i++) toggleLogSelection(ids[i], true, false);
}

// Serialize a single event for the clipboard. Returns a string
// with the event's headline + every detail line, separated by
// \n so the paste target can render it correctly. The format
// is intentionally simple (no markdown) — a support ticket
// should display it as-is.
function formatLogEventForCopy(ev) {
  var { LOG_CATEGORIES } = window.LogCategories;
  const parts = [];
  const ts = ev.ts.toLocaleString();
  const cat = (LOG_CATEGORIES[ev.category] || LOG_CATEGORIES.info).label;
  const res = ev.result === 'ok' ? ' [OK]' : ev.result === 'err' ? ' [ERR]' : '';
  // v1.1.9: include the group tag in the copy so a help-desk
  // helper can see which events came from the same run even
  // when the colour-coding isn't visible (plain text email,
  // monospaced log viewer, etc.).
  const grp = ev.groupId ? ` [group=${ev.groupId}]` : '';
  parts.push(`[${ts}] [${cat}]${res}${grp} ${ev.headline}`);
  for (const d of ev.details) parts.push('    ' + d);
  if (ev.raw) parts.push('    ' + ev.raw);
  return parts.join('\n');
}

// Serialize the current selection (or all events, if the
// selection is empty) for the clipboard. Returns the joined
// string the caller writes to the clipboard. The order is the
// same as the document order so a multi-line copy reads top
// to bottom.
function collectLogCopyText() {
  const events = window.state._logEvents;
  if (!events.length) return '';
  // If the user has a selection, only copy those. Otherwise
  // copy every event currently in memory.
  let chosen;
  if (_logSelected.size > 0) {
    const selSet = _logSelected;
    chosen = events.filter((e) => selSet.has(e.id));
    // Sort by document order (events are pushed in order so
    // _logEvents is already sorted by id, but we re-derive the
    // order to be safe against future changes).
    chosen.sort((a, b) => a.id - b.id);
  } else {
    chosen = events.slice();
  }
  return chosen.map(formatLogEventForCopy).join('\n');
}

// Wire click + keydown on the log root. Click handling:
//   click on a row              → toggle that row's selection
//                                 (single-click replaces; ctrl
//                                 adds; shift range-selects)
//   click on the chevron        → toggle that row's expand
//                                 (NOT the selection)
// We attach the listener once, on the root, and let event
// delegation do the rest (so dynamically-added events get
// the behaviour for free).
function setupLogClicks() {
  const root = document.querySelector('#log');
  if (!root) return;
  root.addEventListener('click', (e) => {
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
    // Multi-select on row click.
    e.preventDefault();
    if (e.shiftKey && window.state._logLastClickedId != null) {
      selectLogRange(window.state._logLastClickedId, id);
    } else if (e.ctrlKey || e.metaKey) {
      toggleLogSelection(id, !isLogSelected(id), false);
    } else {
      clearLogSelection();
      toggleLogSelection(id, true, false);
    }
    window.state._logLastClickedId = id;
  });
}

function log(line) {
  // Legacy free-form log line (used for mmx stderr streaming).
  // We now route these through addLogEvent() so the new
  // structured pane picks them up. The 'info' category + a
  // 'headline' that is the full line preserves the original
  // text; the headline is also used by the new pane (one
  // line per event) so a casual user sees a one-line
  // summary, and a help-desk helper can click the chevron
  // to see the full line.
  if (!line) return;
  addLogEvent({
    category: 'info',
    headline: maskLine(String(line), window.state && window.state.config && window.state.config.api_key),
  });
}

window.LogService = {
  init: setupLogClicks,
  addLogEvent, renderLogEvent, formatLogEventForCopy, collectLogCopyText,
  setupLogClicks, log, isLogSelected, toggleLogSelection, clearLogSelection, selectLogRange,
};
