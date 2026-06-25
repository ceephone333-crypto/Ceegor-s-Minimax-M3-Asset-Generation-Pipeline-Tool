// tests/unit/src/imageOptimizer.test.js
// Regression tests for bug-fix M6 (_temp4.md): mmx's image API has no
// output-format parameter, so the CDN bytes it downloads (and the
// renderer writes verbatim to --out) are sometimes JPEG even though the
// renderer always asks for a ".png" extension. Real sharp-encoded bytes
// (not mocks) are used throughout so these tests catch the actual
// content/extension mismatch the way `sharp(file).metadata()` did when
// the bug was first discovered.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

const imageOptimizer = require('../../../src/imageOptimizer');
const { sharp } = require('../../../src/imageOptimizer/formatUtils');

test('sharp must be installed for these tests to be meaningful', () => {
  assert.ok(sharp, 'sharp failed to load — see formatUtils.js require() error on stderr');
});

async function writeJpegNamedPng(dir, name) {
  const p = path.join(dir, name);
  const buf = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 50, b: 50 } },
  }).jpeg().toBuffer();
  await fsp.writeFile(p, buf);
  return p;
}

// Windows note: sharp/libvips can briefly hold an open file handle on a
// path it just read via `sharp(path)`, which then races the test's own
// `fsp.rm(dir, ...)` cleanup with EBUSY. Reading the bytes into a Buffer
// first (sharp(buffer) never opens a file handle) sidesteps the race
// entirely instead of retrying the delete.
async function metadataOf(filePath) {
  const buf = await fsp.readFile(filePath);
  return sharp(buf).metadata();
}

async function writeRealPng(dir, name) {
  const p = path.join(dir, name);
  const buf = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 50, g: 200, b: 50 } },
  }).png().toBuffer();
  await fsp.writeFile(p, buf);
  return p;
}

test('fixExtensionToMatchContent renames a JPEG-content file with a .png name to .jpg', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'imgopt-'));
  try {
    const pngNamedJpeg = await writeJpegNamedPng(dir, 'temp000001.png');
    const result = await imageOptimizer.fixExtensionToMatchContent(pngNamedJpeg);
    assert.equal(result.ok, true);
    assert.equal(result.renamed, true);
    assert.equal(result.path, path.join(dir, 'temp000001.jpg'));
    assert.equal(fs.existsSync(pngNamedJpeg), false, 'the old .png path must no longer exist');
    assert.equal(fs.existsSync(result.path), true, 'the corrected .jpg path must exist');
  } finally {
    await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  }
});

test('fixExtensionToMatchContent is a no-op when the extension already matches content', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'imgopt-'));
  try {
    const realPng = await writeRealPng(dir, 'pic.png');
    const result = await imageOptimizer.fixExtensionToMatchContent(realPng);
    assert.equal(result.ok, true);
    assert.equal(result.renamed, false);
    assert.equal(result.path, realPng);
    assert.equal(fs.existsSync(realPng), true);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  }
});

test('fixExtensionToMatchContent treats .jpg and .jpeg as already matching JPEG content', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'imgopt-'));
  try {
    const p = path.join(dir, 'photo.jpeg');
    const buf = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    await fsp.writeFile(p, buf);
    const result = await imageOptimizer.fixExtensionToMatchContent(p);
    assert.equal(result.renamed, false);
    assert.equal(result.path, p);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  }
});

test('fixExtensionToMatchContent avoids clobbering an existing file at the corrected name', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'imgopt-'));
  try {
    // temp000001.jpg already exists (e.g. from an earlier run that was
    // already corrected); a NEW temp000001.png that is also really a
    // JPEG must not silently overwrite it.
    await writeJpegNamedPng(dir, 'temp000001.jpg');
    const pngNamedJpeg = await writeJpegNamedPng(dir, 'temp000001.png');
    const result = await imageOptimizer.fixExtensionToMatchContent(pngNamedJpeg);
    assert.equal(result.ok, true);
    assert.equal(result.renamed, true);
    assert.equal(result.path, path.join(dir, 'temp000001_1.jpg'));
    assert.equal(fs.existsSync(path.join(dir, 'temp000001.jpg')), true, 'the pre-existing file must be untouched');
    assert.equal(fs.existsSync(result.path), true);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  }
});

test('fixExtensionToMatchContent rejects a missing/invalid path without throwing', async () => {
  const result = await imageOptimizer.fixExtensionToMatchContent('');
  assert.equal(result.ok, false);
  assert.match(result.error, /required/i);

  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'imgopt-'));
  try {
    const missing = path.join(dir, 'does-not-exist.png');
    const result2 = await imageOptimizer.fixExtensionToMatchContent(missing);
    // sharp can't read a nonexistent file -> detectRealFormat returns
    // null -> treated as "leave it alone", not an error.
    assert.equal(result2.ok, true);
    assert.equal(result2.renamed, false);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  }
});

test('optimize() with format:null (keep source) re-encodes a JPEG-content .png file as JPEG, not bloated PNG', async () => {
  // This is the exact M6 mis-detection: imageOptimizer used to call
  // inferFormatFromPath (extension-based) to decide the "keep source"
  // target format, so a JPEG-content file misnamed ".png" was
  // re-encoded AS png (large size bloat for photographic content)
  // instead of being kept as jpeg.
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'imgopt-'));
  try {
    const pngNamedJpeg = await writeJpegNamedPng(dir, 'photo.png');
    const result = await imageOptimizer.optimize(pngNamedJpeg, { format: null, quality: 80 });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.format, 'jpeg', 'keep-source must resolve to the REAL content format, not the misleading .png extension');
    const meta = await metadataOf(result.outputPath);
    assert.equal(meta.format, 'jpeg', 'the bytes actually written must really be JPEG-encoded');
  } finally {
    await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  }
});

test('optimize() with format:null on a genuinely-PNG file still keeps it as PNG (no regression)', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'imgopt-'));
  try {
    const realPng = await writeRealPng(dir, 'photo.png');
    const result = await imageOptimizer.optimize(realPng, { format: null, quality: 80 });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.format, 'png');
    const meta = await metadataOf(result.outputPath);
    assert.equal(meta.format, 'png');
  } finally {
    await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  }
});

test('optimize() with an explicit format request still honours it regardless of source content', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'imgopt-'));
  try {
    const pngNamedJpeg = await writeJpegNamedPng(dir, 'photo.png');
    const result = await imageOptimizer.optimize(pngNamedJpeg, { format: 'webp', quality: 80 });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.format, 'webp');
    const meta = await metadataOf(result.outputPath);
    assert.equal(meta.format, 'webp');
  } finally {
    await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  }
});
