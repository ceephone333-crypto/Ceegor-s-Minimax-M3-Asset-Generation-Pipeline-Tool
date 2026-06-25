// renderer/tabs/speechTabVoices.js
// v1.1.18 (lint-size split): speechTab.js was over the 500-line
// HARD limit after v1.1.17's help-text improvements. The
// `populateVoices` async method + `fillVoices` synchronous
// helper were extracted here. The behaviour is unchanged —
// the main speechTab file now does
// `this.populateVoices(voice.input.el || voice.input)` and
// delegates everything else to this module via the
// `speechVoices` global below.
//
// populateVoices fetches the 300+ voice list from the API
// (`window.api.voices()`) and populates the inner <select>.
// The fetch is cached in state.voices / state.voicesLoaded so
// repeated tab switches don't re-fetch.
//
// fillVoices is the synchronous helper that actually puts
// <option> elements into the <select>. We clear innerHTML
// first so a refresh (e.g. after a config change) replaces
// the old list cleanly. The current value is preserved.

(function () {
  function fillVoices(sel, voices) {
    const current = sel.value;
    sel.innerHTML = '';
    for (const v of voices) sel.appendChild(el('option', { value: v }, v));
    if (voices.includes(current)) sel.value = current;
  }

  async function populateVoices(sel, state) {
    if (state.voicesLoaded) { fillVoices(sel, state.voices); return; }
    const v = await window.api.voices();
    if (Array.isArray(v) && v.length) {
      state.voices = v;
      state.voicesLoaded = true;
      fillVoices(sel, v);
    }
  }

  window.speechVoices = { fillVoices, populateVoices };
})();