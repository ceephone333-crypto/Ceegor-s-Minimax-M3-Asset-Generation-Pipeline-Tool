// renderer/sections/section12_Prompt_character_counter.js (Phase 3 Block 29)
// Extracted: Prompt character counter
// Source: app.js L1386..1415

// ----------------- Prompt character counter -----------------
// Builds a small "X / 2000" counter for the --prompt argument. The API
// limit is on the --prompt VALUE only (not the entire command line), so
// we count exactly what would be sent in the --prompt argument:
//   extraPrefix + styleText + manual
function computePromptSize(selEl, manualEl, extraPrefix = '') {
  const selVal = selEl ? selEl.value : '';
  const manual = manualEl ? manualEl.value.trim() : '';
  const styleText = getStyleText(selVal);
  return (extraPrefix + styleText + manual).length;
}
function buildPromptCounter({ selEl, manualEl, getExtraPrefix = () => '', max = 2000, id = '' }) {
  const lbl = el('span', { class: 'prompt-counter-label' }, 'Prompt length:');
  const val = el('span', { class: 'prompt-counter-val' }, '0');
  const maxEl = el('span', { class: 'prompt-counter-max' }, ` / ${max}`);
  const wrap = el('div', { class: 'prompt-counter', id: id ? `counter-${id}` : '' }, [lbl, val, maxEl]);
  const update = () => {
    const extra = getExtraPrefix() || '';
    const n = computePromptSize(selEl, manualEl, extra);
    val.textContent = String(n);
    wrap.classList.toggle('warn', n > max * 0.9 && n <= max);
    wrap.classList.toggle('err', n > max);
  };
  if (selEl) selEl.addEventListener('change', update);
  if (manualEl) manualEl.addEventListener('input', update);
  // Initial
  update();
  return { wrap, update };
}

