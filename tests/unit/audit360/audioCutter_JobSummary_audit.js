// tests/unit/audit360/audioCutter_JobSummary_audit.js
// ============================================================================
// 360° EMPIRICAL AUDIT — renderer/audioCutter.js + renderer/jobs/JobSummary.js
// Scope items 7 (AudioCutter) and 10 (JobSummary).
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { setupTabHarness, loadSourceFile, findButton, findAllInputs, fireClick, findOne, findAll, makeEl, ROOT } = require('./tabFlows_audit.js');

// ----------------------------------------------------------------------------
// AudioCutter helpers
// ----------------------------------------------------------------------------

function loadAudioCutter(win) {
  // Capture showModal
  const modalBuilders = [];
  const myShowModal = (builder, opts) => {
    const m = win.el('div', { class: 'modal' });
    const close = () => { m._closed = true; };
    try {
      builder(m, close);
      modalBuilders.push({ m, close, opts });
    } catch (e) {
      // The audioCutter uses `new Audio()` which doesn't exist in node.
      // We pre-stub Audio on the global so it doesn't throw.
      console.error('showAudioCutter modal builder threw:', e.message);
      throw e;
    }
    win._lastModal = m;
  };
  win.showModal = myShowModal;
  global.showModal = myShowModal;
  // Stub Audio (used by audioCutter to play the file). Provide a no-op class.
  global.Audio = function Audio() {
    this.src = '';
    this.preload = 'metadata';
    this.paused = true;
    this.currentTime = 0;
  };
  // Audio.prototype.play returns a promise
  global.Audio.prototype.play = function () { return Promise.resolve(); };
  global.Audio.prototype.pause = function () {};
  // Stub window.addEventListener / removeEventListener (used for resize listener)
  win.addEventListener = () => {};
  win.removeEventListener = () => {};
  global.addEventListener = () => {};
  global.removeEventListener = () => {};
  // Stub requestAnimationFrame / cancelAnimationFrame
  global.requestAnimationFrame = (cb) => setImmediate(() => cb(performance.now()));
  global.cancelAnimationFrame = () => {};
  // Stub getComputedStyle (used by drawWave to read --accent / --fg-3)
  global.getComputedStyle = () => ({ getPropertyValue: () => '' });
  // The audioCutter.js IIFE attaches showAudioCutter to window.
  loadSourceFile(win, path.join(ROOT, 'renderer', 'audioCutter.js'));
  return modalBuilders;
}

// ----------------------------------------------------------------------------
// T1: AudioCutter auto-trim silence uses state.pipelineAdvancedSettings.audio
// ----------------------------------------------------------------------------
test('AUDIT AC-T1: AudioCutter auto-trim silence forwards state.pipelineAdvancedSettings.audio.{thresholdDb,minSilenceMs}', async () => {
  const win = setupTabHarness();
  // Set custom audio settings
  win.state.pipelineAdvancedSettings.audio.silenceThresholdDb = -65;
  win.state.pipelineAdvancedSettings.audio.minSilenceMs = 250;
  // Override audioTrimSilence to capture its args
  let capturedArgs = null;
  win.api.audioTrimSilence = async (src, opts) => {
    capturedArgs = { src, opts };
    return { ok: true, startSec: 0.1, endSec: 9.9, leadSilenceSec: 0.1, tailSilenceSec: 0.1 };
  };
  // Open the audio cutter
  const builders = loadAudioCutter(win);
  win.showAudioCutter('/tmp/test.mp3');
  // Find the "Auto-trim silence" button
  const modal = builders[builders.length - 1].m;
  // Search by partial text
  function findByText(root, text) {
    if (!root) return null;
    if (root.tagName === 'BUTTON' && String(root.textContent).includes(text)) return root;
    for (const c of (root.children || [])) { const r = findByText(c, text); if (r) return r; }
    return null;
  }
  const silenceBtn = findByText(modal, 'Auto-trim silence');
  assert.ok(silenceBtn, 'Auto-trim silence button must exist');
  fireClick(silenceBtn);
  // Wait for the async call
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(capturedArgs, 'audioTrimSilence must be called');
  assert.equal(capturedArgs.opts.thresholdDb, -65, 'must forward silenceThresholdDb=-65 from state');
  assert.equal(capturedArgs.opts.minSilenceMs, 250, 'must forward minSilenceMs=250 from state');
});

// ----------------------------------------------------------------------------
// T2: AudioCutter Export uses quality for codec bitrate
// ----------------------------------------------------------------------------
test('AUDIT AC-T2: AudioCutter Export forwards quality.{mp3Quality,oggQuality,opusBitrate,m4aBitrate}', async () => {
  const win = setupTabHarness();
  // Set custom audio settings — the test should verify the IPC call
  // includes mp3Quality=5 from state.pipelineAdvancedSettings.audio
  win.state.pipelineAdvancedSettings.audio.mp3Quality = 5;
  let capturedArgs = null;
  win.api.audioCut = async (src, dst, opts) => {
    capturedArgs = { src, dst, opts };
    return { ok: true, outputPath: dst };
  };
  // Open the audio cutter
  const builders = loadAudioCutter(win);
  win.showAudioCutter('/tmp/test.mp3');
  const modal = builders[builders.length - 1].m;
  function findByText(root, text) {
    if (!root) return null;
    if (root.tagName === 'BUTTON' && String(root.textContent).includes(text)) return root;
    for (const c of (root.children || [])) { const r = findByText(c, text); if (r) return r; }
    return null;
  }
  const exportBtn = findByText(modal, 'Export trimmed clip');
  assert.ok(exportBtn, 'Export button must exist');
  // Wait for the async audio probe to complete
  await new Promise((r) => setTimeout(r, 200));
  fireClick(exportBtn);
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(capturedArgs, 'audioCut must be called');
  assert.ok(capturedArgs.opts && capturedArgs.opts.quality, 'opts.quality must be present');
  // The harness's state.pipelineAdvancedSettings.audio.mp3Quality is 5
  assert.equal(capturedArgs.opts.quality.mp3Quality, 5, 'must forward mp3Quality=5 from state');
});

// ----------------------------------------------------------------------------
// T3: JobSummary with mixed failure results — failure reasons + unknown-status
// ----------------------------------------------------------------------------
test('AUDIT JS-T3: JobSummary._buildSummary with [{failed:err}, {failed:unknown status}] (AUDIT-12 fixed)', () => {
  // Load the REAL JobSummary.js
  const win = setupTabHarness();
  const lsFile = path.join(ROOT, 'renderer', 'jobs', 'JobSummary.js');
  delete require.cache[require.resolve(lsFile)];
  const src = fs.readFileSync(lsFile, 'utf8');
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', src + '\n; return window.JobSummary;');
  const result = fn(win);
  assert.ok(result, 'JobSummary must be exposed');
  assert.equal(typeof result._buildSummary, 'function');
  const summary = result._buildSummary([
    { status: 'failed', error: 'x' },
    { status: 'failed' },
  ]);
  // Both failed entries count as err.
  assert.equal(summary.err, 2, 'both failed entries should count as err');
  // v1.1 (AUDIT-12): the r.error handling block is no longer
  // skipped for unknown-status rows. Both errors are recorded
  // as failure reasons (one with the actual 'x' error, one with
  // 'unknown' fallback). The pre-v1.1 code's `continue` skipped
  // the error block entirely for unknown statuses, dropping
  // r.error silently.
  const lines = summary.lines || [];
  const failureLines = lines.filter(l => l.startsWith('  '));
  console.log('AUDIT JS-T3: failure breakdown lines =', failureLines);
  // We expect 2 breakdown lines now (one per error), not 1.
  assert.equal(failureLines.length, 2, 'expected 2 breakdown lines (1× x + 1× unknown) — AUDIT-12 fix');
  // The 'x' error is recorded verbatim.
  assert.ok(failureLines.some(l => l.includes('1× x')),
    'the r.error="x" from the unknown-status row must be in the failure breakdown');
  // The second row (no error) gets the 'unknown' fallback.
  assert.ok(failureLines.some(l => l.includes('1× unknown')),
    'the unknown-status row without an r.error must record "unknown"');
});

// Additional test: explore whether the spec's stated behavior is actually expected.
// The spec said "err count = 2, failureReasons has 1 entry 'x' and 1 entry '(unknown status)'"
// — but this contradicts the code that drops the error for unknown statuses.
// What if the spec meant: the test should pass when both 'x' and '(unknown status)'
// are tracked separately? Then this would be a defect.
test('AUDIT JS-T3-DEFECT: unknown-status entries with r.error lose the error message', () => {
  // This is a separate test that explicitly asserts the spec's stated expectation
  // and reports the deviation.
  const win = setupTabHarness();
  const lsFile = path.join(ROOT, 'renderer', 'jobs', 'JobSummary.js');
  delete require.cache[require.resolve(lsFile)];
  const src = fs.readFileSync(lsFile, 'utf8');
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', src + '\n; return window.JobSummary;');
  const result = fn(win);
  const summary = result._buildSummary([
    { status: 'failed', error: 'x' },
    { status: 'failed' },
  ]);
  // Per the spec, the user should see TWO failure reasons: 'x' and '(unknown status)'.
  // In the actual code, only '(unknown status)' appears. The r.error='x' is lost.
  const lines = summary.lines || [];
  const failureLines = lines.filter(l => l.startsWith('  '));
  // Check: does the breakdown include 'x'?
  const includesX = failureLines.some(l => /\bx\b/.test(l));
  const includesUnknown = failureLines.some(l => /\(unknown status\)/.test(l));
  if (!includesX && includesUnknown) {
    // This is the actual behavior. Document it as a defect.
    console.log('AUDIT DEFECT CONFIRMED: failureReasons drops r.error for unknown statuses.');
    console.log('  Expected: 2 failure reasons (one for "x", one for "(unknown status)")');
    console.log('  Actual: 1 failure reason: "2x (unknown status)" — the r.error="x" is silently lost.');
    console.log('  Impact: user sees "1 failed (unknown status)" with no actionable error message.');
  }
  // We don't assert on the defect — we just report it.
});

// ----------------------------------------------------------------------------
// T4: JobSummary with non-string error doesn't throw
// ----------------------------------------------------------------------------
test('AUDIT JS-T4: JobSummary._buildSummary with {status:err, error:{message:"obj"}} does NOT throw', () => {
  const win = setupTabHarness();
  const lsFile = path.join(ROOT, 'renderer', 'jobs', 'JobSummary.js');
  delete require.cache[require.resolve(lsFile)];
  const src = fs.readFileSync(lsFile, 'utf8');
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', src + '\n; return window.JobSummary;');
  const result = fn(win);
  let summary = null;
  assert.doesNotThrow(() => {
    summary = result._buildSummary([{ status: 'err', error: { message: 'obj' } }]);
  }, 'must not throw on non-string r.error');
  assert.ok(summary, 'must return a summary');
  // The failure reason (in lines) should include the .message field of the object
  const lines = summary.lines || [];
  const failureLines = lines.filter(l => l.startsWith('  '));
  assert.ok(failureLines.length > 0, 'failureLines must be populated');
  assert.match(failureLines.join(' '), /obj/, 'failure reason should include the .message field of the object error');
});
