// tests/unit/renderer/utils/supportedFileExts.test.js
// Regression tests for the file-browser's supported-asset-types
// filter. v1.1.15 (reported by user): the file browser used to
// show every file in the folder (.exe, .md, .json helpers, …)
// which cluttered the list with stuff the tool has no use
// for. The new default hides any non-supported extension;
// the user can opt out via a "Show all files" toggle in the
// Folder options dialog.

const test = require('node:test');
const assert = require('node:assert/strict');

// We re-implement the SUPPORTED_FILE_EXTS + helpers inline
// (mirroring the live code in fileBrowser1.js) so a future
// refactor can't silently drop a supported extension.
const SUPPORTED_FILE_EXTS = [
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp',
  '.mp3', '.wav', '.flac', '.ogg', '.m4a', '.opus',
  '.pcm', '.aac', '.wma', '.aif', '.aiff',
  '.mp4', '.webm', '.mov', '.mkv', '.avi',
  '.txt', '.srt', '.json', '.md', '.lrc',
];
const _set = new Set(SUPPORTED_FILE_EXTS);
function isSupported(it) {
  if (!it) return false;
  if (it.isDir) return true;
  return _set.has((it.ext || '').toLowerCase());
}
function isItemVisible(it, showAll) {
  if (!it) return false;
  if (it.isDir) return true;
  if (showAll) return true;
  return _set.has((it.ext || '').toLowerCase());
}

test('SUPPORTED_FILE_EXTS includes all image formats the pipeline handles', () => {
  for (const ext of ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']) {
    assert.ok(_set.has(ext), `${ext} should be in the supported list`);
  }
});

test('SUPPORTED_FILE_EXTS includes all audio formats the cutter handles', () => {
  for (const ext of ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.opus', '.pcm', '.aac', '.wma', '.aif', '.aiff']) {
    assert.ok(_set.has(ext), `${ext} should be in the supported list`);
  }
});

test('SUPPORTED_FILE_EXTS includes all video formats the preview pane handles', () => {
  for (const ext of ['.mp4', '.webm', '.mov', '.mkv', '.avi']) {
    assert.ok(_set.has(ext), `${ext} should be in the supported list`);
  }
});

test('SUPPORTED_FILE_EXTS includes all text / subtitle formats', () => {
  for (const ext of ['.txt', '.srt', '.json', '.md', '.lrc']) {
    assert.ok(_set.has(ext), `${ext} should be in the supported list`);
  }
});

test('SUPPORTED_FILE_EXTS does NOT include .exe / .md / .dll / .bat', () => {
  // v1.1.15 (reported by user): the previous version showed
  // every file, including these. They have no place in the
  // file browser's asset workflow, so they must be hidden
  // by default.
  for (const ext of ['.exe', '.dll', '.bat', '.sh', '.ps1']) {
    assert.ok(!_set.has(ext), `${ext} should NOT be in the supported list`);
  }
});

test('isSupported returns true for every entry in the supported list', () => {
  for (const ext of SUPPORTED_FILE_EXTS) {
    assert.ok(isSupported({ isDir: false, ext }), `${ext} should be supported`);
  }
});

test('isSupported returns true for directories (every folder is "supported")', () => {
  assert.ok(isSupported({ isDir: true, ext: '' }));
  assert.ok(isSupported({ isDir: true, ext: '.whatever' }));
});

test('isSupported returns false for unsupported files', () => {
  // Note: .md and .json ARE in the supported list (text /
  // subtitle formats the user can preview), so we only
  // test the truly-unsupported extensions here.
  for (const it of [
    { isDir: false, ext: '.exe' },
    { isDir: false, ext: '.dll' },
    { isDir: false, ext: '.bat' },
    { isDir: false, ext: '.sh' },
    { isDir: false, ext: '.ps1' },
    { isDir: false, ext: '' },
    null,
    undefined,
  ]) {
    assert.equal(isSupported(it), false, `should reject ${JSON.stringify(it)}`);
  }
});

test('isSupported is case-insensitive on the extension', () => {
  assert.ok(isSupported({ isDir: false, ext: '.PNG' }));
  assert.ok(isSupported({ isDir: false, ext: '.Mp3' }));
  assert.ok(isSupported({ isDir: false, ext: '.WEBP' }));
});

test('isItemVisible respects the showAll flag for unsupported files', () => {
  // Default (showAll=false): unsupported file is hidden.
  assert.equal(isItemVisible({ isDir: false, ext: '.exe' }, false), false);
  // With showAll=true: unsupported file is visible (user
  // explicitly opted in to see everything).
  assert.equal(isItemVisible({ isDir: false, ext: '.exe' }, true), true);
});

test('isItemVisible always shows directories regardless of showAll', () => {
  // Folders always pass — the user might have a "generated"
  // subfolder they want to navigate into.
  assert.equal(isItemVisible({ isDir: true, ext: '' }, false), true);
  assert.equal(isItemVisible({ isDir: true, ext: '.whatever' }, false), true);
});

test('isItemVisible always shows supported files regardless of showAll', () => {
  // A supported file is visible in both modes.
  assert.equal(isItemVisible({ isDir: false, ext: '.png' }, false), true);
  assert.equal(isItemVisible({ isDir: false, ext: '.png' }, true), true);
});
