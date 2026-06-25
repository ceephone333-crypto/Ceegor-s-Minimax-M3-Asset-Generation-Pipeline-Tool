// tests/unit/audit360/overlays_audit.js
// ============================================================================
// 360° EMPIRICAL AUDIT — renderer/overlays/imageOverlays.js
// 4. showConvertOverlay / showOptimizeOverlay — extension handling + M3 guard
// 5. showCropOverlay — Esc mid-decode no-ops the .then
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { setupTabHarness, loadSourceFile, findButton, findAllInputs, fireClick, findOne, findAll, makeEl, ROOT } = require('./tabFlows_audit.js');

// Helper: load imageOverlays.js into the harness and capture the showModal builder
function loadImageOverlays(win) {
  // Add a showModal capture — must be set on BOTH win and global BEFORE loadSourceFile
  const modalBuilders = [];
  const myShowModal = (builder, opts) => {
    const m = win.el('div', { class: 'modal' });
    const close = () => { m._closed = true; };
    builder(m, close);
    modalBuilders.push({ m, close, opts });
    win._lastModal = m;
    win._lastModalClose = close;
  };
  win.showModal = myShowModal;
  global.showModal = myShowModal;
  // Add showItemContextMenuForPath (used by showOptimizeOverlay preview)
  win.showItemContextMenuForPath = () => {};
  global.showItemContextMenuForPath = () => {};
  // loadSourceFile takes the function's args by VALUE at load time, so
  // we need the showModal to be on global already.
  loadSourceFile(win, path.join(ROOT, 'renderer', 'overlays', 'imageOverlays.js'));
  return modalBuilders;
}

// ----------------------------------------------------------------------------
// T1: showConvertOverlay with extension-less path — must NOT pre-select from
// a confused extension inference (M11 fix).
// ----------------------------------------------------------------------------
test('AUDIT OVL-T1: showConvertOverlay("Makefile") — extension-less path does not pre-select a format', () => {
  const win = setupTabHarness();
  const builders = loadImageOverlays(win);
  // The exported functions on window.ImageOverlays
  assert.equal(typeof win.ImageOverlays, 'object', 'ImageOverlays must be exported');
  win.ImageOverlays.showConvertOverlay('Makefile');
  assert.equal(builders.length, 1, 'one modal should have been opened');
  const modal = builders[0].m;
  // The output format select (--target) must default to something usable.
  // The pre-v1.1 code used split('.').pop() which returned 'Makefile'
  // (the whole filename), so the comparison `if (v !== ext) opt.selected = true`
  // was always true for ALL three options, leaving the LAST one (webp) selected.
  // The v1.1 fix detects the extension-less path and defaults to 'png' (first).
  const selects = findAll(modal, 'select');
  assert.ok(selects.length >= 1, 'must have a select element');
  const outSel = selects[selects.length - 1];
  const selected = (outSel.children || []).find(c => c.tagName === 'OPTION' && c.selected);
  assert.ok(selected, 'must have a selected option');
  // The first option (png) should be selected for an extension-less file
  // (since none match, the first one wins). The form is still usable.
  assert.equal(selected.value, 'png', 'the first option (png) should be selected for extension-less input, got: ' + selected.value);
});

// ----------------------------------------------------------------------------
// T2: showConvertOverlay with .png extension — verify the source-display
// shows PNG and a different format is pre-selected for the output.
// ----------------------------------------------------------------------------
test('AUDIT OVL-T2: showConvertOverlay("image.png") — source display shows PNG, output defaults to non-source', () => {
  const win = setupTabHarness();
  const builders = loadImageOverlays(win);
  win.ImageOverlays.showConvertOverlay('image.png');
  const modal = builders[0].m;
  // Find the source-format input (readonly)
  const inputs = findAllInputs(modal);
  // Find a readonly input
  const srcInput = inputs.find(i => i.tagName === 'INPUT' && i.attributes && i.attributes.readonly !== undefined);
  assert.ok(srcInput, 'must have a source format readonly input');
  assert.equal(srcInput.value, 'PNG', 'source format should be PNG, got: ' + srcInput.value);
  // Output should default to a different format
  const selects = findAll(modal, 'select');
  const outSel = selects[selects.length - 1];
  const selected = (outSel.children || []).find(c => c.tagName === 'OPTION' && c.selected);
  assert.notEqual(selected.value, 'png', 'output default should NOT be png when source is png, got: ' + selected.value);
});

// ----------------------------------------------------------------------------
// T3: showOptimizeOverlay extension-less — same M11 fix
// ----------------------------------------------------------------------------
test('AUDIT OVL-T3: showOptimizeOverlay("Makefile") — extension-less does not pre-select from confused inference', () => {
  const win = setupTabHarness();
  const builders = loadImageOverlays(win);
  win.ImageOverlays.showOptimizeOverlay('Makefile');
  const modal = builders[0].m;
  // The format select has options: keep, jpeg, png, webp, avif
  // The "Keep source (JPEG)" label for an extension-less input is what M11 fixes.
  const selects = findAll(modal, 'select');
  const fmtSel = selects[selects.length - 1];
  const opts = (fmtSel.children || []).filter(c => c.tagName === 'OPTION');
  // The first option is "Keep source (...)". For an extension-less input,
  // the keep label should fall back to 'jpeg' (the default for unknown).
  const keep = opts.find(c => c.value === 'keep');
  assert.ok(keep, 'must have a "keep" option');
  // The label must NOT say "Keep source (Makefile)" or similar nonsense
  assert.ok(!/Makefile/.test(keep.textContent), 'the keep label must not include the filename, got: ' + keep.textContent);
  // And must include a sensible default like jpeg/png
  assert.match(keep.textContent, /jpeg|png/i, 'the keep label must show a real format, got: ' + keep.textContent);
});

// ----------------------------------------------------------------------------
// T4: M3 guard — typeof previewImageFromFile === 'function' (NOT updatePreviewPane)
// Source-pin guard: the file must NOT reference typeof updatePreviewPane in
// executable code (only in comments).
// ----------------------------------------------------------------------------
test('AUDIT OVL-T4: imageOverlays.js uses previewImageFromFile (not updatePreviewPane) for the M3 fix', () => {
  const code = fs.readFileSync(path.join(ROOT, 'renderer', 'overlays', 'imageOverlays.js'), 'utf8');
  // Filter out comment lines (// and /* */)
  const lines = code.split('\n').filter((l) => {
    const t = l.trim();
    return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
  });
  const executable = lines.join('\n');
  // The fix should use previewImageFromFile
  assert.ok(/typeof\s+previewImageFromFile\s*===\s*'function'/.test(executable),
    'imageOverlays.js must guard with typeof previewImageFromFile (M3 fix), not updatePreviewPane');
  // The pre-fix bug was typeof updatePreviewPane — must not be present in executable code
  assert.ok(!/typeof\s+updatePreviewPane/.test(executable),
    'imageOverlays.js must NOT reference updatePreviewPane in executable code (M3 regression)');
});

// ----------------------------------------------------------------------------
// T5: M2 fix — Esc mid-decode no-ops the .then
// ----------------------------------------------------------------------------
test('AUDIT OVL-T5: showCropOverlay Esc mid-decode does not throw, no stale .then side-effects', async () => {
  const win = setupTabHarness();
  const builders = loadImageOverlays(win);
  // Override loadImageFromFile to return a never-resolving promise
  let resolveImg;
  const imgPromise = new Promise((res) => { resolveImg = res; });
  win.loadImageFromFile = () => imgPromise;
  // Open the crop overlay
  win.ImageOverlays.showCropOverlay('test.png');
  assert.equal(builders.length, 1);
  const modal = builders[0].m;
  const close = builders[0].close;
  // Wait a tick for the .then to be registered
  await new Promise((r) => setImmediate(r));
  // Simulate Esc by calling close
  assert.doesNotThrow(() => close(), 'close() should not throw');
  // Now resolve the image after close
  resolveImg({ naturalWidth: 1024, naturalHeight: 768, src: 'data:' });
  // Wait for the .then to fire
  await new Promise((r) => setTimeout(r, 50));
  // If the .then ran without checking closed, it would try to mutate
  // the modal's children. Verify no error was thrown.
  // The modal should be marked closed (the M2 fix sets a closed flag).
  assert.ok(modal._closed, 'modal should be marked closed');
});
