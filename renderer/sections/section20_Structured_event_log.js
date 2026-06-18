// renderer/sections/section20_Structured_event_log.js (Phase 3 Block 29)
// Extracted: Structured event log
// Source: app.js L523..638

// ----------------- Structured event log -----------------
// The new log pane is a list of structured events (one per row)
// instead of the old raw-text <pre>. Each event has:
//   { id, ts, category, headline, details, result, expanded, raw }
// and is rendered as a row with time stamp + category icon + result
// icon + headline. The user can multi-select rows with the mouse
// (click / ctrl-click / shift-click), expand a row to see its
// details, and copy the selected events (or all) to the clipboard
// in a plain-text format that includes both the headline and the
// expanded details â€” so pasting into a support ticket gives the
// helper every piece of information the renderer has.
// Phase 3 Block 3: extrahiert nach renderer/services/LogCategories.js
const { LOG_MAX_EVENTS, LOG_CATEGORIES } = window.LogCategories;

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
//                    trailing âœ… / âŒ icon.
//   opts.ts        : Date | null (default: now). Pass a custom

function toast(msg, kind = 'info', ms = 3000) {
  const root = $('#toast-root');
  const t = el('div', { class: 'toast ' + (kind === 'err' ? 'err' : kind === 'ok' ? 'ok' : kind === 'warn' ? 'warn' : '') }, msg);
  root.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.3s'; }, ms - 300);
  setTimeout(() => t.remove(), ms);
}

// v1.1.1 polish: a "What's new" toast that fires the first time
// the user launches a build with a newer package.json version
// than what they last saw. The flag is per-version (not just
// a one-time "saw it" boolean) so future upgrades also surface
// their changelog. The user can dismiss the toast with the X
// button; it never auto-shows again until the next upgrade.
//
// The toast is intentionally compact (a single line of headline
// + a few bullets) so it doesn't block the user's first
// action. It can be expanded by clicking the title.
async function maybeShowWhatsNewToast() {
  try {
    const meta = await window.api.getAppVersion();
    if (!meta || !meta.version) return;
    const seen = (state.state && state.state.lastSeenVersion) || '';
    if (seen === meta.version) return;
    // v1.1.1 is the first release to use this mechanism, so
    // anyone upgrading from anything earlier sees the
    // changelog. If the user is on a brand-new install (no
    // saved state at all) the startup popup already covers
    // the onboarding case; we just want to surface WHAT
    // changed for returning users.
    const headline = `v${meta.version} is here`;
    const items = [
      'Folder options: choose your columns (size, type, modified, created, path)',
      'Live batchgen: watch files appear in the preview as each variant finishes',
      'New log pane: time-stamped, multi-select, click-to-expand, structured copy',
      'Arrow keys in image overlay: ← / → to step through your batch / folder',
      'Mark active in browser: the file you\'re previewing is always highlighted',
    ];
    showWhatsNewToast(headline, items, async () => {
      // Persist "I've seen this version" so the toast doesn't
      // fire again on the next launch of the same build.
      try {
        if (!state.state) state.state = {};
        state.state.lastSeenVersion = meta.version;
        await window.api.stateSet(state.state);
      } catch (_) { /* non-fatal */ }
    });
  } catch (_) { /* non-fatal */ }
}

function showWhatsNewToast(headline, items, onDismiss) {
  const root = $('#toast-root');
  // The toast is a compact card (single column, ~380px wide
  // — see styles.css .whats-new-toast) with a header row
  // (X button) + the headline + a collapsed bullet list.
  // Clicking the headline expands the bullets. The 380px
  // width + 15px headline font was bumped from the original
  // 320/13 because the user reported the headline was being
  // cut off on smaller windows.
  const t = el('div', { class: 'whats-new-toast' });
  const header = el('div', { class: 'whats-new-header' });
  const h = el('span', { class: 'whats-new-headline' }, headline);
  h.title = 'Click to expand';
  const x = el('button', { class: 'btn-mini whats-new-x', type: 'button' }, '×');
  header.append(h, x);
  t.appendChild(header);
  const list = el('ul', { class: 'whats-new-list' });
  for (const item of items) list.appendChild(el('li', {}, item));
  t.appendChild(list);
  // Click anywhere on the toast body to expand. Click X to
  // dismiss.
  h.addEventListener('click', () => { t.classList.toggle('expanded'); });
  t.addEventListener('click', (e) => { if (e.target === t) t.classList.toggle('expanded'); });
  x.addEventListener('click', (e) => {
    e.stopPropagation();
    t.style.transition = 'opacity 200ms ease, transform 200ms ease';
    t.style.opacity = '0';
    t.style.transform = 'translateY(-8px)';
    setTimeout(() => { t.remove(); if (onDismiss) onDismiss(); }, 220);
  });
  root.appendChild(t);
  // Don't auto-dismiss â€” the user should explicitly close it
  // (or accept that it stays). Persisting `lastSeenVersion` only
  // happens on X click so an unexpected reload still shows the
  // toast next launch.
}

