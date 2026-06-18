// renderer/sections/section14_Form_helpers.js (Phase 3 Block 29)
// Extracted: Form helpers
// Source: app.js L1235..1319

// ----------------- Form helpers -----------------

// Build the "Target file prefix" input row. The same row is mounted on
// every tab (image/speech/music/video) but the value is global â€” when
// the user types in one tab, the other tabs' inputs are updated in
// place so they always show the same prefix. The prefix is prepended
// verbatim to the generated file's name in every gen handler (see
// image/speech/music/video .gen-btn click listeners). The value lives
// in state.filePrefix and is persisted to state.json via saveAllStates.
function buildFilePrefixRow() {
  const input = el('input', {
    type: 'text',
    class: 'file-prefix-input',
    value: state.filePrefix || '',
    placeholder: '(no prefix)',
  });
  // Keep the four mirrored inputs in sync and bump the autosave debounce
  // so the value lands in state.json within ~500ms of the last keystroke.
  input.addEventListener('input', () => {
    state.filePrefix = input.value;
    for (const other of document.querySelectorAll('input.file-prefix-input')) {
      if (other !== input) other.value = state.filePrefix;
    }
    scheduleStateSave();
  });
  // +1 button: scan the input value for the rightmost run of digits
  // and increment it by 1, padding with leading zeros to preserve
  // the original width. The rightmost match (not necessarily at the
  // end of the string) means the user can use prefixes like
  // "BildserieFÃ¼rSpiel_Reihe1_" and have the trailing series counter
  // bump. The regex `(\d+)(?=\D*$)` matches the last digit run that
  // is followed by zero or more non-digits to the end-of-string
  // anchor; e.g. for "Reihe10_v2" it matches "10", for "abc" nothing.
  // When no number is present we surface a hint toast rather than
  // silently doing nothing.
  const plusOneBtn = el('button', {
    class: 'btn-mini plus-one-btn',
    type: 'button',
    title: 'Increment the rightmost number in the prefix by 1',
  }, '+1');
  plusOneBtn.addEventListener('click', () => {
    const val = input.value;
    const match = val.match(/(\d+)(?=\D*$)/);
    if (!match) {
      toast('No number in the prefix to increment. Add a number (e.g. "..._Reihe1_") first.', 'warn', 3500);
      return;
    }
    const numStr = match[1];
    const num = parseInt(numStr, 10);
    const newNum = num + 1;
    // Keep the leading-zero padding so "001" â†’ "002", not "2".
    const newNumStr = String(newNum).padStart(numStr.length, '0');
    const newVal = val.substring(0, match.index) + newNumStr + val.substring(match.index + numStr.length);
    input.value = newVal;
    // Re-fire the input event so the four mirrored inputs across the
    // tabs stay in sync AND state.filePrefix + state.json are updated
    // (the input listener above does both).
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return el('div', { class: 'row file-prefix-row' }, [
    el('label', {}, [
      'Target file prefix',
      el('span', {
        class: 'help',
        'data-help': 'Prepended to every generated file name. Empty = original name. Example: prefix "ZYX" turns abc123.jpg into ZYXabc.jpg.',
        title: 'Prepended to every generated file name. Empty = original name. Example: prefix "ZYX" turns abc123.jpg into ZYXabc.jpg.',
      }, '?'),
    ]),
    input,
    plusOneBtn,
  ]);
}

// Build a "parameter row" with label, dropdown, optional help tooltip.
// `def = { kind, options, default, help, customType }`
//   kind: 'enum' | 'boolean' | 'text' | 'number' | 'enum-text' (enum with custom text override)
//   options: [{ value, label }]   value==='' means "off / default"
//   fileFilters (for kind:'text'): adds a Browse button with these filters
//   id: explicit DOM id (used for state save/load + cross-tab unique key)

// Extract the --flag from a param's enclosing .row label (e.g. "--model (hd)"
// â†’ "--model"). The flag is the first "--xxx" token in the label. Returns
// null if the row is unlabeled (e.g. prompt, lyrics textarea, variants row).


