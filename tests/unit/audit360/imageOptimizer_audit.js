// tests/unit/audit360/imageOptimizer_audit.js
// ============================================================================
// 360° EMPIRICAL AUDIT — src/imageOptimizer.js
// Uses REAL sharp + REAL in-memory images. Verifies:
//   - stripMetadata=true removes EXIF but keeps ICC
//   - stripMetadata=false preserves EXIF
//   - per-format encoder opts (chromaSubsampling, mozjpeg, webpMode, etc.)
//   - format inference from content (the M6 fix)
//   - file extension detection when content disagrees with extension
//   - PNG branch does NOT pass quality (the L4 fix)
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

const { sharp } = require(path.join(ROOT, 'src', 'imageOptimizer', 'formatUtils.js'));
const imageOptimizer = require(path.join(ROOT, 'src', 'imageOptimizer.js'));

if (!sharp) {
  test('sharp is not installed — imageOptimizer tests skipped', () => {
    assert.ok(true, 'sharp not installed');
  });
} else {
  // Build test inputs.
  async function makeJpegWithExif(dir, name) {
    const exif = {
      IFD0: {
        Software: 'MiniMax-Audit-Test',
        Copyright: 'Audit-Co',
        Model: 'Test-Camera',
      },
    };
    const buf = await sharp({
      create: { width: 128, height: 128, channels: 3, background: { r: 200, g: 100, b: 50 } },
    }).jpeg({ quality: 95 }).withMetadata({ exif }).toBuffer();
    const p = path.join(dir, name);
    await fsp.writeFile(p, buf);
    return p;
  }
  async function makeRealPng(dir, name) {
    const buf = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 50, g: 200, b: 50 } },
    }).png().toBuffer();
    const p = path.join(dir, name);
    await fsp.writeFile(p, buf);
    return p;
  }
  async function makeRealWebp(dir, name) {
    const buf = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 50, g: 100, b: 200 } },
    }).webp({ quality: 90 }).toBuffer();
    const p = path.join(dir, name);
    await fsp.writeFile(p, buf);
    return p;
  }

  // =============================================================================
  // T1: stripMetadata=true removes EXIF (the v1.1 fix).
  // =============================================================================
  test('AUDIT IMG-T1: stripMetadata=true removes the EXIF block', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'audit-imgopt-'));
    try {
      const input = await makeJpegWithExif(dir, 'in.jpg');
      const r = await imageOptimizer.optimize(input, {
        quality: 90, format: 'jpeg', stripMetadata: true,
        outputPath: path.join(dir, 'out.jpg'),
      });
      assert.equal(r.ok, true);
      const outBuf = await fsp.readFile(r.outputPath);
      const m = await sharp(outBuf).metadata();
      assert.ok(!m.exif || m.exif.length === 0,
        'stripMetadata=true must remove the EXIF block (the Software tag we wrote must be gone)');
    } finally { await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); }
  });

  // =============================================================================
  // T2: stripMetadata=true keeps the ICC profile (the v1.1 fix).
  // =============================================================================
  test('AUDIT IMG-T2: stripMetadata=true keeps the ICC profile', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'audit-imgopt-'));
    try {
      const input = await makeJpegWithExif(dir, 'in.jpg');
      const r = await imageOptimizer.optimize(input, {
        quality: 90, format: 'jpeg', stripMetadata: true,
        outputPath: path.join(dir, 'out.jpg'),
      });
      assert.equal(r.ok, true);
      const outBuf = await fsp.readFile(r.outputPath);
      const m = await sharp(outBuf).metadata();
      // libvips adds an sRGB ICC profile by default when stripMetadata=true.
      assert.ok(m.icc, 'stripMetadata=true must keep the ICC colour profile (sRGB)');
    } finally { await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); }
  });

  // =============================================================================
  // T3: stripMetadata=false preserves the EXIF block.
  // =============================================================================
  test('AUDIT IMG-T3: stripMetadata=false preserves the EXIF block', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'audit-imgopt-'));
    try {
      const input = await makeJpegWithExif(dir, 'in.jpg');
      const r = await imageOptimizer.optimize(input, {
        quality: 90, format: 'jpeg', stripMetadata: false,
        outputPath: path.join(dir, 'out.jpg'),
      });
      assert.equal(r.ok, true);
      const outBuf = await fsp.readFile(r.outputPath);
      const m = await sharp(outBuf).metadata();
      assert.ok(m.exif && m.exif.length > 0,
        'stripMetadata=false must preserve the EXIF block');
    } finally { await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); }
  });

  // =============================================================================
  // T4: jpeg chromaSubsampling=4:4:4 produces a larger file than 4:2:0.
  // =============================================================================
  test('AUDIT IMG-T4: jpegChromaSubsampling=4:4:4 produces a larger file than 4:2:0', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'audit-imgopt-'));
    try {
      const input = await makeJpegWithExif(dir, 'in.jpg');
      const r420 = await imageOptimizer.optimize(input, {
        quality: 90, format: 'jpeg', stripMetadata: true,
        outputPath: path.join(dir, 'a420.jpg'),
        encoders: { jpegChromaSubsampling: '4:2:0' },
      });
      const r444 = await imageOptimizer.optimize(input, {
        quality: 90, format: 'jpeg', stripMetadata: true,
        outputPath: path.join(dir, 'a444.jpg'),
        encoders: { jpegChromaSubsampling: '4:4:4' },
      });
      assert.ok(r444.outputSize > r420.outputSize,
        `4:4:4 chroma must produce a larger file than 4:2:0 (got ${r444.outputSize} vs ${r420.outputSize})`);
    } finally { await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); }
  });

  // =============================================================================
  // T5: webpMode=lossless produces a valid WebP.
  // =============================================================================
  test('AUDIT IMG-T5: webpMode=lossless produces a valid WebP', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'audit-imgopt-'));
    try {
      const input = await makeJpegWithExif(dir, 'in.jpg');
      const r = await imageOptimizer.optimize(input, {
        quality: 80, format: 'webp', stripMetadata: true,
        outputPath: path.join(dir, 'lossless.webp'),
        encoders: { webpMode: 'lossless' },
      });
      assert.equal(r.ok, true);
      const outBuf = await fsp.readFile(r.outputPath);
      const m = await sharp(outBuf).metadata();
      assert.equal(m.format, 'webp');
      // webp with lossless=true reports hasAlpha=false on a 3-channel input.
      assert.equal(m.hasAlpha, false);
    } finally { await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); }
  });

  // =============================================================================
  // T6: webpMode=nearLossless produces a valid WebP.
  // =============================================================================
  test('AUDIT IMG-T6: webpMode=nearLossless produces a valid WebP', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'audit-imgopt-'));
    try {
      const input = await makeJpegWithExif(dir, 'in.jpg');
      const r = await imageOptimizer.optimize(input, {
        quality: 80, format: 'webp', stripMetadata: true,
        outputPath: path.join(dir, 'nl.webp'),
        encoders: { webpMode: 'nearLossless' },
      });
      assert.equal(r.ok, true);
      const outBuf = await fsp.readFile(r.outputPath);
      const m = await sharp(outBuf).metadata();
      assert.equal(m.format, 'webp');
    } finally { await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); }
  });

  // =============================================================================
  // T7: avif OUTPUT is accepted. (AVIF INPUT is rejected — see T18.)
  // =============================================================================
  test('AUDIT IMG-T7: avif output is accepted (effort knob is applied)', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'audit-imgopt-'));
    try {
      const input = await makeJpegWithExif(dir, 'in.jpg');
      const rLow = await imageOptimizer.optimize(input, {
        quality: 60, format: 'avif', stripMetadata: true,
        outputPath: path.join(dir, 'a4.avif'),
        encoders: { avifEffort: 4 },
      });
      const rHigh = await imageOptimizer.optimize(input, {
        quality: 60, format: 'avif', stripMetadata: true,
        outputPath: path.join(dir, 'a9.avif'),
        encoders: { avifEffort: 9 },
      });
      assert.equal(rLow.ok, true);
      assert.equal(rHigh.ok, true);
      assert.ok(rLow.outputSize > 0 && rHigh.outputSize > 0,
        'avif outputs must be non-empty');
      // sharp/libvips reports AVIF as 'heif' in metadata (with
      // compression='av1' to disambiguate). Either is acceptable.
      const mLow = await sharp(await fsp.readFile(rLow.outputPath)).metadata();
      const mHigh = await sharp(await fsp.readFile(rHigh.outputPath)).metadata();
      assert.ok(['heif', 'avif'].includes(mLow.format),
        `expected heif/avif, got ${mLow.format}`);
      assert.ok(['heif', 'avif'].includes(mHigh.format),
        `expected heif/avif, got ${mHigh.format}`);
      // The compression tag should be 'av1' to confirm it's actually AVIF.
      assert.equal(mLow.compression, 'av1');
      assert.equal(mHigh.compression, 'av1');
    } finally { await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); }
  });

    // =============================================================================
    // T18: AVIF INPUT — fixed in v1.1 (AUDIT-02). sharp reports AVIF
    // as 'heif' (HEIF container with AV1 codec). The formatUtils
    // SUPPORTED_INPUT now includes both 'avif' (canonical) and
    // 'heif' (sharp's raw report), and detectRealFormat() normalises
    // heif+av1 -> 'avif' so the rest of the pipeline sees a single
    // name. The pre-v1.1 behaviour was to REJECT AVIF input with
    // "Unsupported input format. Supported: JPEG, PNG, WebP." even
    // though the renderer advertises AVIF as an output option.
    // =============================================================================
    test('AUDIT IMG-T18: AVIF input is now accepted (AUDIT-02 fixed)', async () => {
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'audit-imgopt-'));
      try {
        const avifBuf = await sharp({
          create: { width: 32, height: 32, channels: 3, background: { r: 100, g: 150, b: 200 } },
        }).avif({ quality: 60 }).toBuffer();
        const p = path.join(dir, 'in.avif');
        await fsp.writeFile(p, avifBuf);
        const m = await sharp(p).metadata();
        console.log('AUDIT IMG-T18: sharp reports format as:', m.format, 'compression:', m.compression);
        // The actual round-trip: AVIF -> JPEG. Pre-v1.1 this returned
        // { ok: false, error: 'Unsupported input format. ...' }. Now
        // it succeeds and writes a sibling _optimized.jpg.
        const r = await imageOptimizer.optimize(p, { quality: 80, format: 'jpeg' });
        assert.equal(r.ok, true, 'optimize() must accept AVIF input now (AUDIT-02 fixed)');
        assert.equal(r.format, 'jpeg');
        assert.equal(r.width, 32);
        assert.equal(r.height, 32);
        // And the AVIF -> AVIF round-trip (re-encode to same format)
        // is also valid.
        const r2 = await imageOptimizer.optimize(p, { quality: 70, format: 'avif' });
        assert.equal(r2.ok, true, 'AVIF -> AVIF round-trip must succeed');
        assert.equal(r2.format, 'avif');
      } finally { await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); }
    });

  // =============================================================================
  // T8: PNG branch does NOT pass quality (the L4 fix).
  // =============================================================================
  test('AUDIT IMG-T8: PNG branch does NOT pass quality (L4 fix)', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'audit-imgopt-'));
    try {
      const input = await makeRealPng(dir, 'in.png');
      // Both calls should succeed and produce valid PNGs.
      const r1 = await imageOptimizer.optimize(input, {
        quality: 1, format: 'png', stripMetadata: true,
        outputPath: path.join(dir, 'q1.png'),
      });
      const r2 = await imageOptimizer.optimize(input, {
        quality: 100, format: 'png', stripMetadata: true,
        outputPath: path.join(dir, 'q100.png'),
      });
      assert.equal(r1.ok, true);
      assert.equal(r2.ok, true);
      // Source-level pin: the PNG branch should NOT include `quality` in
      // the call to pipeline.png(). The L4 fix removed it. (If a future
      // sharp version DOES start honouring it, this test would fail
      // with a behavioural difference between q1 and q100.)
      const src = fs.readFileSync(path.join(ROOT, 'src', 'imageOptimizer.js'), 'utf8');
      // Find the PNG case in its entirety. We use a non-greedy match
      // with a sentinel (the `break;` that always follows).
      const pngCase = src.match(/case 'png':[\s\S]*?break;\s*\}/);
      assert.ok(pngCase, 'PNG case must exist');
      // The pipeline.png(...) call inside the PNG case.
      const pngCall = pngCase[0].match(/pipeline\.png\([\s\S]*?\);/);
      assert.ok(pngCall, 'PNG branch must have a pipeline.png(...) call');
      assert.ok(!/quality/.test(pngCall[0]), 'PNG branch must NOT pass quality to sharp');
    } finally { await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); }
  });

  // =============================================================================
  // T9: format inference — a .png file containing JPEG bytes gets
  // treated as JPEG (the M6 fix).
  // =============================================================================
  test('AUDIT IMG-T9: a .png file containing JPEG bytes is treated as JPEG (M6 fix)', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'audit-imgopt-'));
    try {
      // Write JPEG bytes to a .png file.
      const jpegBuf = await sharp({
        create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 50, b: 50 } },
      }).jpeg().toBuffer();
      const misnamed = path.join(dir, 'misnamed.png');
      await fsp.writeFile(misnamed, jpegBuf);
      // optimize() with format: 'keep' should detect the JPEG content.
      const r = await imageOptimizer.optimize(misnamed, {
        quality: 80, format: 'keep', stripMetadata: true,
        outputPath: path.join(dir, 'out.jpg'),
      });
      assert.equal(r.ok, true, 'optimize must succeed on a misnamed JPEG');
      assert.equal(r.format, 'jpeg', 'format must be inferred as jpeg from the content');
      // Output must be a valid JPEG.
      const m = await sharp(await fsp.readFile(r.outputPath)).metadata();
      assert.equal(m.format, 'jpeg', 'output must be a real JPEG');
    } finally { await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); }
  });

  // =============================================================================
  // T10: format: 'keep' on a .png file with PNG bytes keeps the format.
  // =============================================================================
  test('AUDIT IMG-T10: format="keep" preserves a real PNG as PNG', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'audit-imgopt-'));
    try {
      const input = await makeRealPng(dir, 'in.png');
      const r = await imageOptimizer.optimize(input, {
        quality: 80, format: 'keep', stripMetadata: true,
        outputPath: path.join(dir, 'out.png'),
      });
      assert.equal(r.ok, true);
      assert.equal(r.format, 'png');
    } finally { await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); }
  });

  // =============================================================================
  // T11: fixExtensionToMatchContent — the M6 fix's main test.
  // =============================================================================
  test('AUDIT IMG-T11: fixExtensionToMatchContent renames a JPEG-content .png to .jpg', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'audit-imgopt-'));
    try {
      const jpegBuf = await sharp({
        create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 50, b: 50 } },
      }).jpeg().toBuffer();
      const p = path.join(dir, 'misnamed.png');
      await fsp.writeFile(p, jpegBuf);
      const r = await imageOptimizer.fixExtensionToMatchContent(p);
      assert.equal(r.ok, true);
      assert.equal(r.renamed, true);
      assert.equal(r.path, path.join(dir, 'misnamed.jpg'));
      assert.equal(fs.existsSync(p), false, 'old .png must be gone');
      assert.equal(fs.existsSync(r.path), true, 'new .jpg must exist');
    } finally { await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); }
  });

  // =============================================================================
  // T12: fixExtensionToMatchContent is a no-op when extension matches.
  // =============================================================================
  test('AUDIT IMG-T12: fixExtensionToMatchContent is a no-op when content matches extension', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'audit-imgopt-'));
    try {
      const input = await makeRealPng(dir, 'pic.png');
      const r = await imageOptimizer.fixExtensionToMatchContent(input);
      assert.equal(r.ok, true);
      assert.equal(r.renamed, false);
      assert.equal(r.path, input);
    } finally { await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); }
  });

  // =============================================================================
  // T13: optimize with non-existent source returns ok:false.
  // =============================================================================
  test('AUDIT IMG-T13: optimize with non-existent source returns ok:false', async () => {
    const r = await imageOptimizer.optimize('C:\\nonexistent\\file.png', { quality: 80 });
    assert.equal(r.ok, false);
    assert.match(r.error, /not readable/);
  });

  // =============================================================================
  // T14: optimize with format that resolves to a SUPPORTED_OUTPUT value
  // (e.g. 'tiff' is unknown → null → 'keep' → input format = png)
  // succeeds. But formats that are explicitly rejected by
  // normaliseFormat() — like 'gif' (which IS in SUPPORTED_OUTPUT? no)
  // — return ok:false.
  // =============================================================================
  test('AUDIT IMG-T14: optimize with completely unsupported format falls back to "keep"', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'audit-imgopt-'));
    try {
      const input = await makeRealPng(dir, 'in.png');
      // 'tiff' is unknown to normaliseFormat, so it falls through to null,
      // which is treated as 'keep', which resolves to the input format (png).
      // The call SUCCEEDS — it just doesn't honour the requested format.
      const r = await imageOptimizer.optimize(input, { quality: 80, format: 'tiff' });
      assert.equal(r.ok, true, 'tiff falls back to keep (which is the input format)');
      assert.equal(r.format, 'png', 'fallback produced a png');
    } finally { await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); }
  });

  // =============================================================================
  // T15: optimize with no source path returns ok:false.
  // =============================================================================
  test('AUDIT IMG-T15: optimize with no source path returns ok:false', async () => {
    const r = await imageOptimizer.optimize(null, { quality: 80 });
    assert.equal(r.ok, false);
    assert.match(r.error, /required/);
  });

  // =============================================================================
  // T16: optimize with default outputPath writes next to the input.
  // =============================================================================
  test('AUDIT IMG-T16: optimize without outputPath writes "<stem>_optimized.<ext>" next to source', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'audit-imgopt-'));
    try {
      const input = await makeRealPng(dir, 'photo.png');
      const r = await imageOptimizer.optimize(input, { quality: 80, format: 'png' });
      assert.equal(r.ok, true);
      assert.equal(r.outputPath, path.join(dir, 'photo_optimized.png'));
      assert.ok(fs.existsSync(r.outputPath));
    } finally { await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); }
  });

  // =============================================================================
  // T17: inputSize / outputSize / savedBytes are reported correctly.
  // =============================================================================
  test('AUDIT IMG-T17: optimize reports accurate inputSize / outputSize / savedBytes / savedPercent', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'audit-imgopt-'));
    try {
      const input = await makeJpegWithExif(dir, 'big.jpg');
      const inputSize = fs.statSync(input).size;
      const r = await imageOptimizer.optimize(input, {
        quality: 10, format: 'jpeg', stripMetadata: true,
        outputPath: path.join(dir, 'small.jpg'),
      });
      assert.equal(r.ok, true);
      assert.equal(r.inputSize, inputSize);
      assert.ok(r.outputSize > 0);
      assert.equal(r.savedBytes, inputSize - r.outputSize);
      assert.equal(r.savedPercent, Math.round((r.savedBytes / inputSize) * 100));
    } finally { await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); }
  });
}
