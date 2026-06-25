// tests/unit/renderer/v11BugFixes.test.js
// ============================================================================
// v1.1 bug-fix regression tests. Each test pins a specific defect
// found during the final bug-hunting pass so a future regression
// is caught immediately. Source-level pins + behavioural checks
// where the surrounding code can be loaded safely.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
function src(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

// ============================================================================
// H1 + H2 (imageTab.js): partial-variant-success runs must NOT skip
// the post-process chain OR report failure to BatchGen.
//
// Pre-v1.1: a single failed variant out of 5 caused the WHOLE
// success branch to be skipped (gated on `allOk`), so 4 successful
// images lost their upscale / background-removal / optimisation
// pass. BatchGen also saw the run as a failure and re-ran all 5
// variants on Retry — wasting API quota.
// ============================================================================
test('H1+H2 FIX: imageTab gates success on outFiles.length, not allOk', () => {
  const s = src('renderer/tabs/imageTab.js');
  // The success branch must check `outFiles.length > 0`, not `allOk`.
  // We assert the literal source token so the regression is caught
  // even if someone refactors the surrounding condition.
  assert.ok(s.includes('if (outFiles.length > 0 && !cancel.wasCancelled())'),
    'the post-process + success branch must be gated on outFiles.length > 0 (was allOk pre-v1.1)');
  // The pure-failure branch must require zero successful variants.
  assert.ok(s.includes("} else if (outFiles.length === 0 && !cancel.wasCancelled())"),
    'the pure-failure UI branch must require outFiles.length === 0 (no successful variants)');
  // genLastResult (read by BatchGen) must mirror the same gate so a
  // 4/5-success run is NOT flagged as retryable. The gate does NOT
  // include cancel.wasCancelled() — a cancel after partial success
  // still leaves real files on disk, so we mark 'ok' (v1.1 L1 fix).
  assert.ok(s.includes("(outFiles.length > 0 && !threw) ? 'ok' : 'err'"),
    'genLastResult.image must be "ok" when ANY variant succeeded (BatchGen retry contract, v1.1 L1: cancel after partial success still counts as ok)');
  // The post-run return value must NOT use `if (allOk)` — that
  // would route partial-success through the 'err' return.
  assert.ok(!/\bif \(allOk\) \{[\s\S]*?return \{ status: 'ok'/.test(s),
    'the return-value branch must NOT be gated on `allOk` (gating on outFiles.length is the v1.1 fix)');
  // The success toast must mention partial-success so the user
  // knows not every variant landed.
  assert.ok(s.includes('variants saved') && s.includes('failed — see log'),
    'the success toast must surface partial-success (count + "see log")');
});

// ============================================================================
// M2 (videoTab.js): the elapsed-timer setInterval must be cleared
// in a finally block so an mmxRunJob rejection does not leak the
// timer forever.
// ============================================================================
test('M2 FIX: videoTab clears the elapsed interval in a finally block', () => {
  const s = src('renderer/tabs/videoTab.js');
  assert.ok(s.includes('try {') && s.includes('const r = await window.api.mmxRunJob('),
    'the mmxRunJob await must be wrapped in a try block');
  assert.ok(/} finally \{\s*clearInterval\(elapsedTimer\);\s*\}/.test(s),
    'clearInterval(elapsedTimer) must run in a finally block (was on happy path only pre-v1.1)');
});

// ============================================================================
// M3 (videoTab.js): the footer element order must be [preview, actions],
// matching the other 3 tabs (image / speech / music).
// ============================================================================
test('M3 FIX: videoTab footer order is [preview, actions]', () => {
  const s = src('renderer/tabs/videoTab.js');
  // We check the literal construction call. The other tabs all use
  // `[preview, actions]` — video used `[actions, preview]` pre-v1.1.
  assert.ok(s.includes("el('div', { class: 'tab-footer' }, [preview, actions])"),
    'videoTab footer must be [preview, actions] (matches image / speech / music tabs)');
  assert.ok(!s.includes("el('div', { class: 'tab-footer' }, [actions, preview])"),
    'the pre-v1.1 [actions, preview] order must NOT be present');
});

// ============================================================================
// M4 (speechTab.js): --bitrate must be suppressed for lossless
// formats by GATING the appendFlag call, not by mutating the
// bitrate select's value (which leaked state across click handlers
// and permanently dropped the user's chosen bitrate).
// ============================================================================
test('M4 FIX: speechTab gates appendFlag for bitrate instead of mutating value', () => {
  const s = src('renderer/tabs/speechTab.js');
  // The mutating line must be gone from the executable code. We
  // strip //-comments before the search so the fix's own explanation
  // (which references the old buggy line) doesn't trip the check.
  const noComments = s.replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!noComments.includes("bitrate.el.value = ''"),
    'speechTab must NOT mutate bitrate.el.value in executable code (the leak was the bug)');
  // The gate must be at the appendFlag call site.
  assert.ok(/if \(lossyFormat\) appendFlag\(args, bitrate\.input\)/.test(s),
    'speechTab must gate appendFlag(bitrate) on the lossyFormat flag');
  // The lossyFormat flag must be derived from the format select.
  assert.ok(s.includes("const lossyFormat = ['mp3', 'opus'].includes(speechFormat);"),
    'speechTab must derive lossyFormat from the current format selection');
});

// ============================================================================
// isnetbg.js v1.1 bug fix (checkNodeBackendAvailable was called but
// never imported). Already covered by ADV 3 in advancedPipelineHarness;
// adding a second pin here keeps the bug-fix tests grouped.
// ============================================================================
test('ISNETBG FIX: checkNodeBackendAvailable is imported + exported', () => {
  const wrapper = src('src/isnetbg.js');
  const disc = src('src/isnetbg/binaryDiscovery.js');
  assert.ok(wrapper.includes('checkNodeBackendAvailable,'),
    'isnetbg.js must import checkNodeBackendAvailable (was missing pre-v1.1)');
  assert.ok(disc.includes('checkNodeBackendAvailable'),
    'binaryDiscovery.js must export checkNodeBackendAvailable (was internal-only pre-v1.1)');
});

// ============================================================================
// imageOptimizer.js v1.1 bug fix (stripMetadata=true used withMetadata
// in BOTH branches, so it never actually stripped). Behavioural
// coverage is in ADV 5; this test pins the source-level contract.
// ============================================================================
test('IMGOPT FIX: stripMetadata=true uses keepIccProfile alone, not withMetadata', () => {
  const s = src('src/imageOptimizer.js');
  // Strip comments so the fix's explanatory comment (which mentions
  // the old withMetadata call) doesn't trip the check.
  const noComments = s.replace(/^\s*\/\/.*$/gm, '');
  // The stripMetadata=true branch must call keepIccProfile() alone.
  assert.ok(/if \(stripMetadata\) \{[\s\S]*?pipeline\.keepIccProfile\(\);/.test(noComments),
    'stripMetadata=true must call keepIccProfile() alone (preserves ICC, strips everything else)');
  // The stripMetadata=true branch must NOT call withMetadata in
  // executable code. The pre-v1.1 bug: withMetadata is the OPPOSITE
  // of stripping in sharp, so the previous code preserved ALL
  // metadata in both branches.
  const stripBranch = noComments.match(/if \(stripMetadata\) \{[\s\S]*?\} else \{/);
  assert.ok(stripBranch, 'must be able to isolate the stripMetadata=true branch');
  assert.ok(!stripBranch[0].includes('withMetadata'),
    'stripMetadata=true branch must NOT call withMetadata (was the bug pre-v1.1)');
});
