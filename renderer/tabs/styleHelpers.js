// renderer/tabs/styleHelpers.js (Phase 4 Fix 4)
// Style-preset helpers + status-bar setter. These were originally
// defined in app.js but were not captured by the Phase 3 refactor
// (the section-boundary regex missed them). They are called from
// imageTabA/B, musicTabA/B, speechTab, videoTab, and the
// context-menu section.

function setStatus(text, busy = false) {
  const s = $('#status');
  if (!s) return;
  s.textContent = text;
  s.classList.toggle('busy', !!busy);
}

function getStyleById(id) {
  return (state.config.styles || []).find((s) => s.name === id);
}

function getStyleText(id) {
  const s = getStyleById(id);
  return s && s.value ? s.value.trim() : '';
}

function buildStyleRow(tabKey, helpText) {
  // Dropdown listing all style presets. Empty value = no style.
  // The `style-select` class is queried by _refreshAllStyleDropdowns so
  // style add/edit/delete reflects in every open tab without a refresh.
  const sel = el('select', { class: 'style-select' });
  sel.appendChild(el('option', { value: '' }, '(no style)'));
  for (const s of (state.config.styles || [])) {
    const opt = el('option', { value: s.name }, s.name);
    if (s.value && s.value.length > 60) opt.title = s.value;
    sel.appendChild(opt);
  }
  const manage = el('button', { class: 'btn-mini', onclick: () => openStyleSettings(tabKey) }, '⚙');
  const combo = el('div', { class: 'combo' }, [sel, manage]);
  const lbl = el('label', {}, [
    'Style preset (prepended to your prompt)',
    el('span', { class: 'help', 'data-help': helpText, title: helpText }, '?'),
  ]);
  const row = el('div', { class: 'row' }, [lbl, combo]);
  return { row, sel };
}

function buildStylePreviewBlock() {
  return el('div', { class: 'style-preview' });
}

function updateStylePreview(tab, extraPrefix = '') {
  // tab = { previewEl, selEl, manualEl }
  if (!tab || !tab.previewEl) return;
  const selVal = tab.selEl ? tab.selEl.value : '';
  const manual = tab.manualEl ? tab.manualEl.value.trim() : '';
  const styleText = getStyleText(selVal);
  const preview = tab.previewEl;
  preview.innerHTML = '';
  if (!extraPrefix && !styleText && !manual) {
    preview.appendChild(el('span', { class: 'empty' }, 'Will send: (empty prompt)'));
    return;
  }
  if (extraPrefix) {
    preview.appendChild(el('div', {}, [el('span', { class: 'prefix' }, extraPrefix), el('span', {}, ', ')]));
  }
  if (styleText) {
    preview.appendChild(el('div', {}, [el('span', { class: 'prefix' }, styleText), el('span', {}, ', ')]));
  }
  if (manual) {
    preview.appendChild(el('div', {}, [el('span', {}, manual)]));
  }
}

function buildFinalPrompt(selEl, manualEl, extraPrefix = '') {
  const selVal = selEl ? selEl.value : '';
  const manual = manualEl ? manualEl.value.trim() : '';
  const styleText = getStyleText(selVal);
  // Compose: extraPrefix, styleText, manual
  const parts = [extraPrefix, styleText, manual].filter(Boolean);
  return parts.join(', ');
}

window.StyleHelpers = { setStatus, getStyleText, buildStyleRow, buildStylePreviewBlock, updateStylePreview, buildFinalPrompt };
