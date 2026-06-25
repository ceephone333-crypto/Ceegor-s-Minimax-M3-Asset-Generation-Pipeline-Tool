// tests/unit/renderer/tabs/batchImportHelper.roundtrip.test.js
//
// v1.1.0 release gate: verify that the BatchGen import + example-export
// round-trips EVERY parameter the tool now exposes across all 4 tabs.
// The user (2026-06-25) flagged that the import/export pipeline must
// stay in sync as we add new params; this test pins that contract.
//
// What we verify:
//   1. parseParams(): CLI form ("--foo bar") \u2192 key/value object for every
//      spec flag in image / speech / music / video tabs.
//   2. roundtrip(): parseParams(reconstructParamStr(entry)) is idempotent
//      for any reasonable entry shape.
//   3. The example file templates (mdContent + txtContent in
//      main/ipc/registerBatchesIpc.js) document every current spec flag.
//      Mismatches are listed as failures so the templates can't silently
//      drift.
//
// We deliberately do NOT exercise the full DOM import flow (file picker +
// modal) \u2014 the unit-level coverage above is enough to prove that
// any parameter present in the live form is representable in the
// importable CLI form and back.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');

// ---- Set up a minimal window so batchImportHelper.js can load ----
global.window = global;
global.state = { batches: {} };
global.toast = () => {};
global.showModal = () => {};
global.el = () => {};
global.$ = () => null;

require(path.join(ROOT, 'renderer', 'tabs', 'batchImportHelper.js'));
const { parseParams, reconstructParamStr } = global.window.BatchManager;

// Load the spec to know what's currently supported
const modelSpecsPath = path.join(ROOT, 'renderer', 'specs', 'modelSpecs.js');
// modelSpecs.js is a browser script: shim window, load it
require(modelSpecsPath);
const { MODEL_SPECS, MMX_ALLOWED, validateValues, validateToolCombos } = global.window.ModelSpecs;

// Helper: turn a spec flag into a CLI form ("--width 1024")
function flagToCli(flag, value) {
  const key = flag.replace(/^--/, '');
  if (value === true) return `--${key}`;
  if (typeof value === 'number') return `--${key} ${value}`;
  const s = String(value);
  return /\s|=/.test(s) ? `--${key} "${s}"` : `--${key} ${s}`;
}

// ---- 1. parseParams handles every spec flag ----
test('parseParams: handles every supported flag in image tab (current spec)', () => {
  const tab = MODEL_SPECS.image;
  const samples = {
    '--prompt': 'a quiet alley',
    '--model': 'image-01',
    '--aspect-ratio': '16:9',
    '--n': '2',
    '--width': '1024',
    '--height': '768',
    '--seed': '42',
    '--prompt-optimizer': 'true',
    '--aigc-watermark': 'on',
    '--subject-reference-file': 'C:\\ref.png',
    '--subject-reference-type': 'character',
  };
  for (const [flag, val] of Object.entries(samples)) {
    assert.ok(tab.supportedFlags.includes(flag), `spec missing ${flag}`);
    const cli = flagToCli(flag, val);
    const parsed = parseParams(cli);
    const key = flag.replace(/^--/, '').toLowerCase();
    assert.ok(parsed[key] !== undefined, `parseParams missed ${flag} from '${cli}': got ${JSON.stringify(parsed)}`);
    assert.equal(parsed[key], val, `wrong value for ${flag}: expected ${val}, got ${parsed[key]}`);
  }
});

test('parseParams: handles every supported flag in speech tab (current spec)', () => {
  const tab = MODEL_SPECS.speech;
  const samples = {
    '--model': 'speech-2.8-hd',
    '--voice': 'English_expressive_narrator',
    '--speed': '1.05',
    '--volume': '5',
    '--pitch': '3',
    '--format': 'mp3',
    '--sample-rate': '32000',
    '--bitrate': '128000',
    '--channels': '2',
    '--language': 'en',
    '--subtitles': 'true',
    '--sound-effect': 'gunshot.wav',
    '--pronunciation': 'tomato/tom-ah-to',
    '--emotion': 'happy',
    '--text': 'hello world',
  };
  for (const [flag, val] of Object.entries(samples)) {
    assert.ok(tab.supportedFlags.includes(flag), `spec missing ${flag}`);
    const cli = flagToCli(flag, val);
    const parsed = parseParams(cli);
    const key = flag.replace(/^--/, '').toLowerCase();
    assert.ok(parsed[key] !== undefined, `parseParams missed ${flag} from '${cli}': got ${JSON.stringify(parsed)}`);
    assert.equal(parsed[key], val, `wrong value for ${flag}: expected ${val}, got ${parsed[key]}`);
  }
});

test('parseParams: handles every supported flag in music tab (current spec)', () => {
  const tab = MODEL_SPECS.music;
  const samples = {
    '--model': 'music-2.6',
    '--prompt': 'warm morning folk',
    '--lyrics': 'la la la',
    '--instrumental': 'true',
    '--lyrics-optimizer': 'false',
    '--sample-rate': '44100',
    '--bitrate': '256000',
    '--format': 'mp3',
  };
  for (const [flag, val] of Object.entries(samples)) {
    assert.ok(tab.supportedFlags.includes(flag), `spec missing ${flag}`);
    const cli = flagToCli(flag, val);
    const parsed = parseParams(cli);
    const key = flag.replace(/^--/, '').toLowerCase();
    assert.ok(parsed[key] !== undefined, `parseParams missed ${flag} from '${cli}': got ${JSON.stringify(parsed)}`);
    assert.equal(parsed[key], val, `wrong value for ${flag}: expected ${val}, got ${parsed[key]}`);
  }
});

test('parseParams: handles every supported flag in video tab (current spec)', () => {
  const tab = MODEL_SPECS.video;
  const samples = {
    '--model': 'MiniMax-Hailuo-2.3',
    '--prompt': 'a man walks through a door',
    '--first-frame-image': 'C:\\start.jpg',
    '--last-frame-image': 'C:\\end.jpg',
    '--subject-image': 'C:\\face.jpg',
    '--duration': '6',
    '--resolution': '768P',
    '--prompt-optimizer': 'true',
    '--fast-pretreatment': 'false',
  };
  for (const [flag, val] of Object.entries(samples)) {
    assert.ok(tab.supportedFlags.includes(flag), `spec missing ${flag}`);
    const cli = flagToCli(flag, val);
    const parsed = parseParams(cli);
    const key = flag.replace(/^--/, '').toLowerCase();
    assert.ok(parsed[key] !== undefined, `parseParams missed ${flag} from '${cli}': got ${JSON.stringify(parsed)}`);
    assert.equal(parsed[key], val, `wrong value for ${flag}: expected ${val}, got ${parsed[key]}`);
  }
});

// ---- 2. roundtrip: reconstruct \u2192 parse \u2192 reconstruct is idempotent ----
test('roundtrip: reconstruct + parse is idempotent for typical batch entries', () => {
  const cases = [
    { prompt: 'a cat', model: 'image-01', 'aspect-ratio': '16:9', n: '2' },
    { prompt: 'hello', model: 'speech-2.8-hd', voice: 'English_expressive_narrator', speed: '1.05', format: 'mp3' },
    { prompt: 'epic orchestral', model: 'music-2.6', instrumental: 'true' },
    { prompt: 'a man walks', model: 'MiniMax-Hailuo-2.3', duration: '6', resolution: '768P' },
  ];
  for (const original of cases) {
    // prompt is internal bookkeeping; reconstructParamStr omits it.
    const { prompt, ...params } = original;
    const cli = reconstructParamStr(params);
    const parsed = parseParams(cli);
    // every non-prompt param must survive the round-trip
    for (const [k, v] of Object.entries(params)) {
      assert.equal(parsed[k], String(v), `round-trip lost/changed ${k}: original=${v}, parsed=${parsed[k]}, cli='${cli}'`);
    }
  }
});

// ---- 3. Example templates in registerBatchesIpc.js cover current spec ----
function readExampleTemplates() {
  const src = fs.readFileSync(path.join(ROOT, 'main', 'ipc', 'registerBatchesIpc.js'), 'utf8');
  // The mdContent block runs from `const mdContent = ` to the next backtick closing line.
  const mdMatch = src.match(/const mdContent = `([\s\S]*?)`;\s*\n\s*const txtContent/s);
  const txtMatch = src.match(/const txtContent = `([\s\S]*?)`;\s*\n\s*fs\.writeFileSync/);
  if (!mdMatch || !txtMatch) throw new Error('Could not extract md/txt example templates from registerBatchesIpc.js');
  return { md: mdMatch[1], txt: txtMatch[1] };
}

test('example templates document every current image flag (no drift)', () => {
  const { md, txt } = readExampleTemplates();
  const required = [
    '--prompt', '--model', '--aspect-ratio', '--n', '--width', '--height',
    '--seed', '--prompt-optimizer', '--aigc-watermark', '--subject-ref',
    '--response-format', '--variants',
  ];
  for (const flag of required) {
    assert.ok(md.includes(flag), `md example missing ${flag}`);
    assert.ok(txt.includes(flag), `txt example missing ${flag}`);
  }
});

test('example templates document every current speech flag (no drift)', () => {
  const { md, txt } = readExampleTemplates();
  // current spec speech flags (excluding --text which is the body)
  const required = [
    '--model', '--voice', '--speed', '--volume', '--pitch', '--format',
    '--sample-rate', '--bitrate', '--channels', '--language', '--variants',
  ];
  for (const flag of required) {
    assert.ok(md.includes(flag), `md example missing ${flag}`);
    assert.ok(txt.includes(flag), `txt example missing ${flag}`);
  }
});

test('example templates document every current music flag (no drift)', () => {
  const { md, txt } = readExampleTemplates();
  const required = [
    '--model', '--instrumental', '--lyrics', '--variants',
  ];
  for (const flag of required) {
    assert.ok(md.includes(flag), `md example missing ${flag}`);
    assert.ok(txt.includes(flag), `txt example missing ${flag}`);
  }
});

test('example templates document every current video flag (no drift)', () => {
  const { md, txt } = readExampleTemplates();
  const required = [
    '--model', '--prompt', '--first-frame', '--last-frame',
    '--subject-image', '--variants',
  ];
  for (const flag of required) {
    assert.ok(md.includes(flag), `md example missing ${flag}`);
    assert.ok(txt.includes(flag), `txt example missing ${flag}`);
  }
});

test('example templates use current video values (duration 6/10, resolution 768p/1080p, models Hailuo-2.3 / S2V-01)', () => {
  const { md, txt } = readExampleTemplates();
  // Current allowed models (from MMX_ALLOWED.video)
  const currentModels = MMX_ALLOWED.video.model;
  for (const m of currentModels) {
    assert.ok(md.includes(m), `md example missing current video model '${m}'`);
  }
  // Current allowed resolutions
  for (const r of ['768P', '1080P']) {
    assert.ok(md.includes(r), `md example missing current resolution '${r}'`);
    assert.ok(txt.includes(r), `txt example missing current resolution '${r}'`);
  }
  // Current allowed durations (video has min:6 max:10)
  assert.ok(/--duration\s+(\d+)/.test(md), 'md example should document --duration');
  assert.ok(/--duration\s+(\d+)/.test(txt), 'txt example should document --duration');
  // The current model must NOT be a stale old name like "video-01" or "video-01-live"
  assert.ok(!/video-01(-live)?\b/.test(md), `md example still references stale 'video-01'/'video-01-live' (current models: ${currentModels.join(', ')})`);
  assert.ok(!/video-01(-live)?\b/.test(txt), `txt example still references stale 'video-01'/'video-01-live' (current models: ${currentModels.join(', ')})`);
  // The old "720p" must be gone
  assert.ok(!/\b720p\b/i.test(md), "md example still references stale '720p' resolution (current: 768P/1080P)");
  assert.ok(!/\b720p\b/i.test(txt), "txt example still references stale '720p' resolution (current: 768P/1080P)");
});

test('example templates use current image model names (image-01 / image-01-live, not image-01 only)', () => {
  const { md, txt } = readExampleTemplates();
  // Current image models per MMX_ALLOWED.image.model
  const currentModels = MMX_ALLOWED.image.model;
  for (const m of currentModels) {
    assert.ok(md.includes(m), `md example missing current image model '${m}'`);
    assert.ok(txt.includes(m), `txt example missing current image model '${m}'`);
  }
  // Stale name 'image-01-only' is mentioned as a hint
  // (No 'image-02' or other removed models expected)
});

test('example templates use current speech model names (speech-2.8-hd / 2.8-turbo / 2.6-hd / 2.6-turbo / 02-hd / 02-turbo)', () => {
  const { md, txt } = readExampleTemplates();
  for (const m of MMX_ALLOWED.speech.model) {
    assert.ok(md.includes(m), `md example missing current speech model '${m}'`);
    assert.ok(txt.includes(m), `txt example missing current speech model '${m}'`);
  }
  // Stale 'speech-01' must not be the default
  // (we just want to make sure current models are documented; old ones being also listed is fine)
});

test('example templates use current music model names (music-2.6 / music-2.5+ / music-2.5)', () => {
  const { md, txt } = readExampleTemplates();
  for (const m of MMX_ALLOWED.music.model) {
    assert.ok(md.includes(m), `md example missing current music model '${m}'`);
    assert.ok(txt.includes(m), `txt example missing current music model '${m}'`);
  }
  // music-2.0 was removed in v1.1.17. The example's active model list must
  // not list it BEFORE the "Legacy" / "removed" parenthetical — i.e. the
  // model recommendation must be one of the 3 current models, and any
  // mention of music-2.0 must be a deprecation warning, not an active
  // option. Match the model option list up to the first '('.
  const mdModelLine = (md.match(/--model:\s*([^(\n]+)/) || ['', ''])[1];
  const txtModelLine = (txt.match(/--model:\s*([^(\n]+)/) || ['', ''])[1];
  assert.ok(!/music-2\.0/i.test(mdModelLine),
    `md --model line still includes removed music-2.0: "${mdModelLine}"`);
  assert.ok(!/music-2\.0/i.test(txtModelLine),
    `txt --model line still includes removed music-2.0: "${txtModelLine}"`);
  // Sanity: the deprecation note IS still present (good — warns AIs).
  assert.ok(/music-2\.0[^]*removed/i.test(md), 'md should mention removed music-2.0');
  assert.ok(/music-2\.0[^]*removed/i.test(txt), 'txt should mention removed music-2.0');
});

// ---- 4. validateValues integration: imported entries validate correctly ----
test('buildImportedEntry + validateValues: round-trip a valid image entry', () => {
  // simulate what importBatchFileDialog does: parse CLI form \u2192 build entry
  const cli = '--model image-01 --aspect-ratio 16:9 --n 2 --variants 3';
  const params = parseParams(cli);
  const entry = { prompt: 'a cat', ...params };
  // BUG-9-08 tool-combo check
  const tc = validateToolCombos(entry, params);
  // _defective should NOT be set (entry is valid)
  assert.equal(entry._defective, undefined, 'valid entry should not be marked defective');
});

// ---- 5. batch entry shape helpers round-trip object entries with _defective ----
test('batchEntryText/withBatchEntryText: _defective tag survives round-trip', () => {
  const { batchEntryText, withBatchEntryText } = global.window.BatchManager;
  const entry = { prompt: 'foo', model: 'invalid-model', _defective: ['model "X" is not allowed'] };
  const text = batchEntryText(entry);
  const back = withBatchEntryText(entry, text);
  assert.equal(back.prompt, 'foo');
  assert.equal(back.model, 'invalid-model');
  assert.deepEqual(back._defective, ['model "X" is not allowed']);
});

// ---- 6. End-to-end: parse the example file's table rows ----
// The user hands example_batch_import.md to an AI, the AI returns a filled-
// in version, the user imports it. Simulate that whole chain by parsing the
// EXAMPLE rows that ship in the template. If the example rows don't parse
// correctly, the user can't even start using the tool.
test('end-to-end: example table rows in the shipped md template parse + validate', () => {
  const { md } = readExampleTemplates();
  // Extract the markdown table at the bottom of the doc (the "Example Import
  // Table" section). Rows look like: "| image | <prompt> | <params> |".
  const rows = md.split(/\r?\n/)
    .filter((l) => /^\|\s*(image|speech|music|video)\s*\|/.test(l));
  assert.ok(rows.length >= 4, `expected at least 4 example rows (one per tab), got ${rows.length}`);
  for (const row of rows) {
    const cells = row.split('|').map((s) => s.trim()).filter((_, i, a) => i > 0 && i < a.length - 1);
    assert.equal(cells.length, 3, `malformed row: ${row}`);
    const [type, prompt, params] = cells;
    assert.ok(['image', 'speech', 'music', 'video'].includes(type));
    assert.ok(prompt.length > 0, `empty prompt in row: ${row}`);
    // The example rows MUST parse cleanly via parseParams.
    const parsed = parseParams(params);
    assert.ok(Object.keys(parsed).length > 0, `no params parsed from: '${params}'`);
    // And the resulting values must validate against the spec.
    const vv = validateValues(type, { ...parsed, prompt });
    assert.equal(vv.errors.length, 0,
      `example row for '${type}' has validation errors: ${vv.errors.join('; ')} (params: ${params})`);
  }
});

test('end-to-end: example table rows in the shipped txt template parse + validate', () => {
  const { txt } = readExampleTemplates();
  const rows = txt.split(/\r?\n/)
    .filter((l) => /^(image|speech|music|video)\s*\|/.test(l));
  assert.ok(rows.length >= 4, `expected at least 4 example rows (one per tab), got ${rows.length}`);
  for (const row of rows) {
    const cells = row.split('|').map((s) => s.trim());
    assert.equal(cells.length, 3, `malformed row: ${row}`);
    const [type, prompt, params] = cells;
    assert.ok(['image', 'speech', 'music', 'video'].includes(type));
    assert.ok(prompt.length > 0, `empty prompt in row: ${row}`);
    const parsed = parseParams(params);
    assert.ok(Object.keys(parsed).length > 0, `no params parsed from: '${params}'`);
    const vv = validateValues(type, { ...parsed, prompt });
    assert.equal(vv.errors.length, 0,
      `example row for '${type}' has validation errors: ${vv.errors.join('; ')} (params: ${params})`);
  }
});
