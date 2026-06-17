// renderer/utils/quotaFormatter.js
// Quota-Display-Formatter. Phase 3 Block 12: 2 pure Funktionen.
// mmx liefert Quota-Infos je Modell; diese Helfer formatieren sie
// als HTML-Spans mit CSS-Klassen (quota-low / quota-warn / quota-in-plan
// / quota-not-in-plan). Field-Aliase decken alte/neue mmx-Versionen ab.

function quotaSeg(name, used, total, label) {
  if (!total || total <= 0) return '';
  const remaining = Math.max(0, total - used);
  const usedPct = Math.round((used / total) * 100);
  const cls = usedPct >= 90 ? 'quota-low' : (usedPct >= 50 ? 'quota-warn' : '');
  return `<span class="${cls}" title="${escapeHtml(`${name} · ${label}: ${used}/${total} (${usedPct}% used)`)}">${used}/${total} ${label} <small>(${usedPct}%)</small></span>`;
}

/**
 * @param {object} m  Quota-Eintrag aus mmx (modell-spezifisch)
 * @returns {string}  HTML-String mit formatierten Quota-Spans
 */
function formatQuotaModel(m) {
  const name = m.model_name || m.name || m.model || '?';
  // All values are rendered into innerHTML below — escape to avoid XSS via a
  // hostile model name returned by the API.
  const e = (s) => escapeHtml(String(s == null ? '' : s));
  // mmx quota fields have changed between versions. Read them with a few
  // aliases so we survive both old and new shapes.
  const iTotal = m.current_interval_total_count ?? m.interval_total ?? m.daily_total ?? 0;
  const iUsed  = m.current_interval_usage_count ?? m.interval_used ?? m.daily_used ?? 0;
  const iStatus = m.current_interval_status ?? m.interval_status ?? m.daily_status;
  const iPct    = m.current_interval_remaining_percent ?? m.interval_remaining_percent ?? m.daily_remaining_percent;
  const wTotal = m.current_weekly_total_count ?? m.weekly_total ?? 0;
  const wUsed  = m.current_weekly_usage_count ?? m.weekly_used ?? 0;
  const wStatus = m.current_weekly_status ?? m.weekly_status;
  const wPct    = m.current_weekly_remaining_percent ?? m.weekly_remaining_percent;
  // "Not in plan" only when BOTH statuses are explicitly 3. (The previous
  // version also matched `null`, which mis-classified every model that
  // didn't return a status field — that's why the user saw "general: not
  // in plan" even though generations worked.) The remaining_percent fields
  // are then used as a fallback so the user still sees *something* useful.
  const explicitlyNotInPlan = (iStatus === 3) && (wStatus === 3);
  if (explicitlyNotInPlan) {
    return `<span class="quota-not-in-plan">${e(name)}: not in plan</span>`;
  }
  const parts = [];
  if (iTotal && iTotal > 0) parts.push(quotaSeg(name, iUsed || 0, iTotal, 'today'));
  if (wTotal && wTotal > 0) parts.push(quotaSeg(name, wUsed || 0, wTotal, 'week'));
  if (parts.length === 0) {
    // In plan but no counts (e.g. general returned 0/0 with status=1).
    // Fall back to the *_remaining_percent field (note: this is "remaining"
    // percent — invert it to show "used" percent, which the user expects).
    const segs = [];
    if (iPct != null) {
      const usedPct = 100 - iPct;
      const cls = usedPct >= 90 ? 'quota-low' : (usedPct >= 50 ? 'quota-warn' : '');
      segs.push(`<span class="${cls}">${iPct}% today <small>(${usedPct}% used)</small></span>`);
    }
    if (wPct != null) {
      const usedPct = 100 - wPct;
      const cls = usedPct >= 90 ? 'quota-low' : (usedPct >= 50 ? 'quota-warn' : '');
      segs.push(`<span class="${cls}">${wPct}% week <small>(${usedPct}% used)</small></span>`);
    }
    if (segs.length === 0) {
      return `<span class="quota-in-plan">${e(name)}: in plan</span>`;
    }
    return `<span class="quota-in-plan">${e(name)}:</span> ${segs.join(' · ')}`;
  }
  return parts.join(' · ');
}

window.QuotaFormatter = { quotaSeg, formatQuotaModel };
