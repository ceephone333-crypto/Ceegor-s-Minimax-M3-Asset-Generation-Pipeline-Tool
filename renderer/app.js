/* renderer/app.js â€” UI logic, no build step. */
// We use globals (window.api from preload) to stay build-free.

// Tool version: bump / refresh this whenever you ship a build. The
// string is read from package.json via window.api.getAppVersion()
// at startup (added in the same change that bumped it to 1.1.1), so
// the renderer always shows the version that ships in this build's
// package.json â€” no risk of a stale string in the source when
// someone forgets to bump it. The format is "<version> Â· <compile
// date> <compile time>" so the user can see at a glance which
// build they have.
let BUILD_VERSION = '1.1.1 Â· loadingâ€¦';
const TOOL_NAME = 'MiniMax Assets Tool';
const TOOL_INFO =
  'A friendly desktop app for the MiniMax AI service. ' +
  'Generate images, speech, music, and short videos from text prompts in one window. ' +
  'Works with both Token Plan keys and pay-as-you-go (PAYG) API keys. ' +
  'Includes style presets (so you can keep the same look across many generations), ' +
  'batch generation (run a whole list of prompts in one click), ' +
  'and built-in tools to upscale, crop, remove backgrounds, and shrink the file size of every result.';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ----------------- Tabs -----------------
const TABS = {};

