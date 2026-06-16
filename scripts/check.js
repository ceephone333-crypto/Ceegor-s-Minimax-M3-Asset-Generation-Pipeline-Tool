// scripts/check.js
// Preflight check for the optional add-ons. Run with:
//   npm run check
//
// Verifies that everything the runtime wrappers (src/realesrgan.js,
// src/isnetbg.js) need is present, so a portable .zip built
// with `npm run build` will let the end user run the tool with
// zero install steps.
//
// Exit codes:
//   0 — every required file is present (or only optional
//       additions like extra Real-ESRGAN models are missing).
//   1 — at least one required file is missing; the script
//       prints the exact `npm run setup` (or build) command
//       to fix it.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin');
const MODELS = path.join(BIN, 'models');

const CHECKS = [
  // The Real-ESRGAN binary. Optional but recommended — the
  // built-in multi-step canvas upscaler still works without
  // it, so we mark it OPTIONAL.
  {
    label: 'Real-ESRGAN binary (BSD-3-Clause, optional)',
    path: path.join(BIN, process.platform === 'win32' ? 'realesrgan-ncnn-vulkan.exe' : 'realesrgan-ncnn-vulkan'),
    optional: true,
  },
  // Real-ESRGAN default model. Optional — the binary still
  // works without it (it can fetch the model at first run), but
  // the in-app wrapper expects it for instant 4× upscale.
  {
    label: 'Real-ESRGAN model: realesrgan-x4plus.param',
    path: path.join(MODELS, 'realesrgan-x4plus.param'),
    optional: true,
  },
  {
    label: 'Real-ESRGAN model: realesrgan-x4plus.bin',
    path: path.join(MODELS, 'realesrgan-x4plus.bin'),
    optional: true,
  },
  // The isnetbg binary. Optional — the Node.js backend covers
  // the same use case without a separate C# build. Kept here
  // so a developer who ships a hand-built C# binary gets a
  // "Detected" status in the popup instead of the
  // Node.js default.
  {
    label: 'isnetbg binary (C# / .NET 6+, optional — Node.js backend is the default)',
    path: path.join(BIN, process.platform === 'win32' ? 'isnetbg.exe' : 'isnetbg'),
    optional: true,
  },
  // The IS-Net ONNX model. REQUIRED for background removal —
  // both backends (C# binary and Node.js wrapper) load this
  // same file.
  {
    label: 'IS-Net ONNX model: isnet-general-use.onnx',
    path: path.join(MODELS, 'isnet-general-use.onnx'),
    requiredMinBytes: 100 * 1024 * 1024, // 100 MB; the real file is ~170 MB
  },
  // The onnxruntime-node npm package. Required for the Node.js
  // background-removal backend. We require.resolve() it the
  // same way src/isnetbg.js does at runtime.
  {
    label: 'npm dep: onnxruntime-node',
    resolve: () => require.resolve('onnxruntime-node', { paths: [ROOT] }),
  },
  // Sharp is a transitive dep of onnxruntime-node on some
  // platforms, but we also need it directly for the image I/O
  // in src/isnetbg_node.js.
  {
    label: 'npm dep: sharp',
    resolve: () => require.resolve('sharp', { paths: [ROOT] }),
  },
];

let requiredMissing = 0;
let optionalMissing = 0;

console.log('Pre-release preflight check');
console.log('===========================');
console.log('');

for (const c of CHECKS) {
  let ok = true;
  let detail = '';
  try {
    if (c.resolve) {
      c.resolve();
      detail = 'present';
    } else {
      const stat = fs.statSync(c.path);
      if (c.requiredMinBytes && stat.size < c.requiredMinBytes) {
        ok = false;
        detail = `present but TOO SMALL (${(stat.size / 1024 / 1024).toFixed(1)} MB, expected ≥ ${(c.requiredMinBytes / 1024 / 1024).toFixed(0)} MB)`;
      } else {
        detail = `present (${(stat.size / 1024 / 1024).toFixed(1)} MB)`;
      }
    }
  } catch (_) {
    ok = false;
    detail = c.optional ? 'missing (optional)' : 'MISSING';
  }
  const tag = ok ? '✓' : (c.optional ? '○' : '✗');
  console.log(`  ${tag}  ${c.label}`);
  console.log(`       ${detail}`);
  if (!ok) {
    if (c.optional) optionalMissing++;
    else requiredMissing++;
  }
}

console.log('');
if (requiredMissing === 0) {
  console.log(`All required files are in place. (${optionalMissing} optional add-on(s) missing — see above.)`);
  console.log('You can now run:');
  console.log('  npm run build');
  process.exit(0);
} else {
  console.log(`${requiredMissing} required file(s) missing.`);
  console.log('');
  console.log('To fix, run the one-shot setup:');
  console.log('  npm run setup');
  console.log('');
  console.log('(That downloads Real-ESRGAN + the IS-Net model from verified URLs. The C# isnetbg binary is optional — the bundled Node.js backend covers the same use case without a .NET toolchain.)');
  process.exit(1);
}
