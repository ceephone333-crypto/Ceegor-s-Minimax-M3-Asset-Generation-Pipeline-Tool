/* renderer/app.js — UI logic, no build step. */
// We use globals (window.api from preload) to stay build-free.

// Tool version: bump / refresh this whenever you ship a build. The
// string is read from package.json via window.api.getAppVersion()
// at startup (added in the same change that bumped it to 1.1.0), so
// the renderer always shows the version that ships in this build's
// package.json — no risk of a stale string in the source when
// someone forgets to bump it. The format is "<version> · <compile
// date> <compile time>" so the user can see at a glance which
// build they have.
let BUILD_VERSION = '1.1.0 · loading…';
const TOOL_NAME = 'MiniMax Assets Tool';
const TOOL_INFO =
  'A friendly desktop app for the MiniMax AI service. ' +
  'Generate images, speech, music, and short videos from text prompts in one window. ' +
  'Works with both Token Plan keys and pay-as-you-go (PAYG) API keys. ' +
  'Includes style presets (so you can keep the same look across many generations), ' +
  'batch generation (run a whole list of prompts in one click), ' +
  'and built-in tools to upscale, crop, remove backgrounds, and shrink the file size of every result.';

// Phase 4 Fix 15: 'var' statt 'const'. 'const' am Top-Level eines
// <script>-Tags ist NICHT global. Section-Files (geladen VOR app.js)
// rufen '$'/'$$'/'TABS' auf. Mit 'var' werden sie global und sind
// in allen <script>-Tags sichtbar.
var $ = (sel, root = document) => root.querySelector(sel);
var $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ----------------- Tabs -----------------
// Phase 4 Fix 16: 'var TABS = window.TABS' statt 'var TABS = {}'.
// imageTab/musicTab/speechTab/videoTab (geladen VOR app.js) machen
// 'window.TABS = window.TABS || {}; window.TABS.X = {...};'.
// Wuerde app.js jetzt 'var TABS = {}' machen, wuerde 'var' am
// Top-Level window.TABS = {} setzen und ALLE Tab-Definitionen
// loeschen. Mit 'var TABS = window.TABS' wird stattdessen die
// Referenz auf den bereits befuellten window.TABS kopiert -
// aenderungen an TABS in app.js propagieren zu window.TABS.
var TABS = window.TABS;

// ----------------- Bootstrap on DOM ready -----------------
// This is the renderer-side init() that wires up tabs, file browser,
// log bar, settings, theme, and bootstraps each tab's build(). It
// was lost in Phase 3 Block 29 (when the 24 sections were
// extracted) and has to be re-added here as a thin orchestrator
// over the section-level functions. All section files load BEFORE
// this script (see index.html order), so all the helpers (state,
// showTab, refreshBrowser, etc.) are already defined by the time
// we run.
async function init() {
  // Wire tabs
  for (const t of $$('.tab')) t.addEventListener('click', () => showTab(t.dataset.tab));
  // v1.1 (user request): the file browser's Up button now
  // navigates through FOUR distinct levels, with the button
  // disabled at the lowest:
  //   1) A real folder inside output_dir → one level up
  //   2) output_dir itself                → one level up (parentDir)
  //   3) A drive root                     → the DRIVES list
  //   4) The DRIVES list                  → DISABLED (no-op)
  // The previous version only handled (1) and (2) — a user
  // whose output_dir was at a drive root (e.g. D:\) had no
  // way to switch to a different drive without closing the
  // tool. The drives list (level 3) and the disabled-at-the-
  // bottom state (level 4) close that gap.
  const FB_DRIVES_SENTINEL = '__DRIVES__';
  function isDrivesList() { return state.fbDir === FB_DRIVES_SENTINEL; }
  function isDriveRoot(p) {
    if (!p) return false;
    if (process.platform === 'win32') return /^[A-Z]:[\\\/]?$/i.test(p);
    return p === '/';
  }
  function updateFbUpButton() {
    const btn = $('#fb-up');
    if (!btn) return;
    if (isDrivesList()) {
      btn.disabled = true;
      btn.classList.add('fb-up-disabled');
      btn.title = 'You are at the drives list. Pick a drive to continue.';
    } else {
      btn.disabled = false;
      btn.classList.remove('fb-up-disabled');
      btn.title = 'Up one level';
    }
  }
  // v1.1.25: wrap the click handler so a synchronous throw (or
  // an async refreshBrowser rejection) reaches the log pane AND
  // renderer-error.log instead of disappearing silently. The
  // user reported the button "does nothing"; without this
  // wrapper the most common reason would be a swallowed throw
  // from refreshBrowser, with no breadcrumb at all. The handler
  // body is intentionally inline (not a separate function) so
  // the fbUpButtonBehavior.test.js extraction still matches.
  $('#fb-up').addEventListener('click', () => {
    try {
      // Disabled at the drives list — the user must pick a drive
      // first to continue. The button is also disabled visually
      // (CSS .fb-up-disabled + .title) but a stale click could
      // still reach this handler; the early-return is the
      // authoritative guard.
      if (isDrivesList()) return;
      const outRoot = state.config.output_dir || '';
      // v1.1.17 (reported by user — "the up one level button in
      // folder explorer has no functionality (except triggering the
      // popup)"): when state.fbDir is empty (no folder has ever
      // been opened — e.g. a fresh install where the user just
      // typed a prompt and hit Generate), the previous handler
      // bailed out at `if (!state.fbDir) return;` and the click
      // appeared to do nothing. The behaviour now is: if no
      // current folder, the Up button jumps to the output_dir
      // (which is always a real folder thanks to the BUG-2
      // defaultOutputDir fallback in fileBrowser1.refreshBrowser),
      // or the drives list when there's no output_dir either.
      // This makes the button always do SOMETHING visible.
      if (!state.fbDir) {
        if (outRoot) {
          state.fbDir = outRoot;
        } else {
          state.fbDir = FB_DRIVES_SENTINEL;
        }
        refreshBrowser();
        updateFbUpButton();
        return;
      }
      if (outRoot && state.fbDir.toLowerCase() === outRoot.toLowerCase()) {
        // At the output root, climb one level (parentDir) so the
        // user can see the drives (or root) on the next click.
        const up = parentDir(state.fbDir);
        if (up) {
          state.fbDir = up;
        } else {
          // output_dir IS a drive root (or has no parent) —
          // jump to the drives list.
          state.fbDir = FB_DRIVES_SENTINEL;
        }
        refreshBrowser({ keepCurrent: true });
        updateFbUpButton();
        return;
      }
      if (isDriveRoot(state.fbDir)) {
        // Already at a drive root, jumping up further means
        // the drives list (you can't go above a drive root).
        state.fbDir = FB_DRIVES_SENTINEL;
        refreshBrowser({ keepCurrent: true });
        updateFbUpButton();
        return;
      }
      // Normal mid-tree case: one level up.
      const up = parentDir(state.fbDir) || outRoot || FB_DRIVES_SENTINEL;
      state.fbDir = up;
      refreshBrowser({ keepCurrent: true });
      updateFbUpButton();
    } catch (e) {
      // v1.1.25: don't swallow. Log to the in-app pane AND the
      // file log so the user (and the next dev session) can
      // diagnose "why did clicking Up do nothing?".
      if (typeof window.logError === 'function') {
        window.logError('fb-up', 'renderer/app.js:fb-up-click', e);
      } else {
        console.error('fb-up click threw:', e);
      }
    }
  });
  updateFbUpButton();
  // File browser live filter
  const fbSearch = $('#fb-search');
  if (fbSearch) fbSearch.addEventListener('input', window.applyFileSearch || applyFileSearch);
  // v1.1.11: asset-type filter (Images / Audio / Video / Text).
  // Re-apply the live filter on change so the list shrinks /
  // expands to match the new type.
  const fbTypeFilter = $('#fb-type-filter');
  if (fbTypeFilter) {
    fbTypeFilter.value = state.fbTypeFilter || '';
    fbTypeFilter.addEventListener('change', () => {
      state.fbTypeFilter = fbTypeFilter.value;
      scheduleStateSave();
      (window.applyFileSearch || applyFileSearch)();
    });
  }
  // Bug-fix v1.1.9 (reported by user): the sort dropdown had no change
  // handler — picking "Newest" / "Oldest" / "Created ↑" had no effect
  // because nothing re-rendered the list with the new mode. We sort
  // the in-memory snapshot of fb items (state._fbItems) via the
  // shared FbSort helper and re-render. The same handler also
  // re-applies the live search filter so a sort + filter combo
  // shows the right subset.
  const fbSort = $('#fb-sort');
  if (fbSort) {
    fbSort.value = state.fbSort || 'name-asc';
    fbSort.addEventListener('change', () => {
      state.fbSort = fbSort.value;
      scheduleStateSave();
      if (Array.isArray(state._fbItems) && state._fbItems.length) {
        const sorted = window.FbSort
          ? window.FbSort.sortFbItems(state._fbItems, state.fbSort)
          : sortFbItems(state._fbItems, state.fbSort);
        renderFbList(sorted);
        (window.applyFileSearch || applyFileSearch)();
      }
    });
  }
  $('#fb-refresh').addEventListener('click', () => refreshBrowser());
  $('#fb-new').addEventListener('click', () => promptNewFolder());
  $('#fb-open').addEventListener('click', () => window.api.fbReveal(state.fbDir || state.config.output_dir || ''));
  // Bug-fix (2026-06-20): the "⚙ Options" button (folder columns /
  // thumbnails) had its handler defined (openFolderOptions in
  // fileBrowser1.js) but it was never wired to the button, so clicking
  // it did nothing. The matching modal opens via showModal.
  const fbOptionsBtn = $('#fb-options');
  if (fbOptionsBtn) fbOptionsBtn.addEventListener('click', () => {
    if (typeof openFolderOptions === 'function') openFolderOptions();
  });
  // Bug-fix (2026-06-20, reported by user): the 📂 button was added to
  // index.html but its click handler was never wired up — the previous
  // "Up" button only climbs inside `output_dir`, so a user whose
  // output_dir is at a drive root (e.g. `D:\`) couldn't reach any
  // folder on a different drive. The native folder picker (Windows
  // `IFileDialog` via Electron's `dialog.showOpenDialog`) lets the user
  // browse ANY drive and ANY folder on it in one dialog — the simplest
  // fix and the one the user asked for as the alternative. The picked
  // path is auto-added to the IPC allow-list (`pathSecurity.addTrusted`
  // inside the main-process handler) so subsequent reads / writes /
  // moves work without any extra "allow" gesture.
  $('#fb-pick').addEventListener('click', async () => {
    const picked = await window.api.pickFolder();
    if (!picked) return;
    state.fbDir = picked;
    if (state.currentTab) state.fbDirs[state.currentTab] = picked;
    scheduleStateSave();
    refreshBrowser();
  });

  // v1.1.9: bulk-action toolbar wiring. The toolbar is rendered
  // statically in index.html (so the layout is predictable) and
  // toggled visible/hidden by the 'fb-selection-changed' custom
  // event fired from fileBrowser1.js. The master checkbox
  // tri-state: checked when every visible item is in
  // state.fbSelected, indeterminate when some are, unchecked
  // when none are. Move / Copy / Trim / Delete all delegate to
  // the shared `fbBulkAction(label, op)` worker in fileBrowser1.
  const fbBulkToolbar = $('#fb-bulk-toolbar');
  const fbBulkCount = $('#fb-bulk-count');
  const fbBulkMasterCb = $('#fb-bulk-master-cb');
  function _refreshBulkToolbar() {
    const sel = state.fbSelected || new Set();
    const n = sel.size;
    if (fbBulkToolbar) fbBulkToolbar.style.display = n > 0 ? '' : 'none';
    if (fbBulkCount) fbBulkCount.textContent = `${n} selected`;
    // Tri-state the master checkbox.
    if (fbBulkMasterCb) {
      const total = Array.isArray(state._fbItems) ? state._fbItems.length : 0;
      if (n === 0) { fbBulkMasterCb.checked = false; fbBulkMasterCb.indeterminate = false; }
      else if (n >= total && total > 0) { fbBulkMasterCb.checked = true; fbBulkMasterCb.indeterminate = false; }
      else { fbBulkMasterCb.checked = false; fbBulkMasterCb.indeterminate = true; }
    }
    // Highlight the matching rows so the user can scan the
    // selection at a glance. We toggle the class instead of
    // re-rendering so the scroll position / hover state isn't
    // disturbed.
    for (const li of $$('.fb-item[data-path]')) {
      const p = li.getAttribute('data-path');
      if (p && sel.has(p)) li.classList.add('fb-selected-row');
      else li.classList.remove('fb-selected-row');
    }
  }
  window.addEventListener('fb-selection-changed', _refreshBulkToolbar);
  // Run once on init so the toolbar starts in the right state
  // (hidden). Fires on every subsequent selection change.
  _refreshBulkToolbar();
  if (fbBulkMasterCb) {
    fbBulkMasterCb.addEventListener('change', () => {
      if (fbBulkMasterCb.checked) {
        (window.fbSelectAll || (() => {}))();
      } else {
        (window.fbClearSelection || (() => {}))();
      }
    });
  }
  $('#fb-bulk-clear').addEventListener('click', () => {
    (window.fbClearSelection || (() => {}))();
  });
  $('#fb-bulk-move').addEventListener('click', () => {
    if (!state.fbSelected || state.fbSelected.size === 0) return;
    const dest = state.fbDir || state.config.output_dir || '';
    if (!dest) { toast('No destination folder.', 'err'); return; }
    (window.fbBulkAction || (() => {}))('Move', async (path) => {
      const r = await window.api.fbMove(path, dest);
      if (!r || !r.ok) throw new Error((r && r.error) || 'move failed');
    });
  });
  $('#fb-bulk-copy').addEventListener('click', () => {
    if (!state.fbSelected || state.fbSelected.size === 0) return;
    const dest = state.fbDir || state.config.output_dir || '';
    if (!dest) { toast('No destination folder.', 'err'); return; }
    (window.fbBulkAction || (() => {}))('Copy', async (path) => {
      const r = await window.api.fbCopy(path, dest);
      if (!r || !r.ok) throw new Error((r && r.error) || 'copy failed');
    });
  });
  $('#fb-bulk-trim').addEventListener('click', () => {
    if (!state.fbSelected || state.fbSelected.size === 0) return;
    const paths = Array.from(state.fbSelected);
    const audioExts = ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.opus', '.pcm', '.aac', '.wma', '.aif', '.aiff'];
    const audioPaths = paths.filter((p) => audioExts.includes('.' + (p.split('.').pop() || '').toLowerCase()));
    if (!audioPaths.length) { toast('None of the selected files are audio. Trim only works on .mp3/.wav/.flac/etc.', 'warn', 5000); return; }
    if (audioPaths.length !== paths.length) {
      toast(`Trim will only process ${audioPaths.length} audio file${audioPaths.length === 1 ? '' : 's'} (skipped ${paths.length - audioPaths.length} non-audio).`, 'warn', 4000);
    }
    // Open the audio cutter on the FIRST audio file. The cutter
    // is single-file; the user can repeat for the rest. (The
    // user explicitly asked for bulk trim; this is the
    // pragmatic first version that handles the common case of
    // a few audio files. The advanced multi-file trim queue
    // can come later.)
    (window.fbBulkAction || (() => {}))('Trim', async (path) => {
      if (audioPaths.indexOf(path) !== 0) return; // only the first audio triggers the cutter
      if (typeof window.showAudioCutter === 'function') {
        window.showAudioCutter(path);
      } else {
        toast('Audio cutter module not loaded.', 'err');
        throw new Error('audio cutter missing');
      }
    });
  });
  $('#fb-bulk-delete').addEventListener('click', () => {
    if (!state.fbSelected || state.fbSelected.size === 0) return;
    (window.fbBulkAction || (() => {}))('Delete', async (path) => {
      const r = await window.api.fbDelete(path);
      if (!r || !r.ok) throw new Error((r && r.error) || 'delete failed');
    });
  });
  $('#quota-refresh').addEventListener('click', () => refreshQuota());
  $('#btn-styles').addEventListener('click', () => openStyleSettings());
  $('#btn-theme').addEventListener('click', () => toggleTheme());
  $('#btn-settings').addEventListener('click', () => openSettings());

  // Log bar
  const logDetails = $('#logbar details');
  const logCopyBtn = $('#log-copy');
  const logClearBtn = $('#log-clear');
  const logToggleBtn = $('#log-toggle');
  // Bug-fix (2026-06-20): the log "?" help button was never wired (the
  // generic [data-help-topic] click delegation is not installed), so it
  // did nothing. Wire it directly to the centralized help system. It
  // lives inside the <summary>, so we must stop the click from toggling
  // the <details> collapse (same pattern as the other log buttons).
  const logHelpBtn = $('#log-help');
  if (logHelpBtn) {
    logHelpBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof showHelp === 'function') showHelp('log.structured');
    });
  }
  function _syncLogToggleLabel() {
    if (!logToggleBtn || !logDetails) return;
    logToggleBtn.textContent = logDetails.open ? '▼ Collapse' : '▲ Expand';
  }
  if (logDetails) logDetails.addEventListener('toggle', _syncLogToggleLabel);
  if (logToggleBtn) {
    logToggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!logDetails) return;
      logDetails.open = !logDetails.open;
      _syncLogToggleLabel();
    });
  }
  if (logClearBtn) {
    logClearBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const logEl = $('#log');
      if (logEl) logEl.textContent = '';
      toast('Log cleared.', 'ok', 1500);
    });
  }
  if (logCopyBtn) {
    logCopyBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const txt = $('#log')?.textContent || '';
      if (!txt) { toast('Log is empty.', 'warn'); return; }
      try {
        await navigator.clipboard.writeText(txt);
        toast('Log copied to clipboard.', 'ok', 1500);
      } catch (err) {
        const range = document.createRange();
        range.selectNodeContents($('#log'));
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        toast('Copy failed — log text selected, press Ctrl+C to copy.', 'warn', 4000);
      }
    });
  }
  _syncLogToggleLabel();

  // Picture preview pane
  const previewClearBtn = $('#preview-clear');
  if (previewClearBtn) {
    previewClearBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const content = $('#fb-preview-content');
      if (!content) return;
      content.innerHTML = '<div class="preview-pane-empty">Click an image in the file browser to preview it here.</div>';
    });
  }

  // Config
  state.config = await window.api.getConfig();
  if (!Array.isArray(state.config.styles)) state.config.styles = [];
  if (!state.config.theme) state.config.theme = 'dark';
  applyTheme(state.config.theme);
  if (!state.config.api_key) {
    toast('No API key. Click ⚙ to add one.', 'warn', 6000);
  }

  // Build tabs (assign ids + load saved state + start autosave)
  const savedState = await window.api.stateGet() || {};
  state.tabSettings = savedState.tabs || {};
  // Bug-fix #1+#2 (2026-06-19): round-trip every persisted key through
  // the canonical STATE_PERSIST_KEYS list (defined in section24_State.js).
  // Previously only ~5 of ~18 keys were loaded, and the upscaleSettings
  // object was collapsed to { multiplier } — silently dropping the
  // auto-crop fields on every restart.
  const persistKeys = window.STATE_PERSIST_KEYS || [];
  for (const k of persistKeys) {
    if (k === 'fbDirs' || k === 'currentTab') continue; // handled below
    if (savedState[k] === undefined || savedState[k] === null) continue;
    state[k] = savedState[k];
  }
  // Phase C (bug-fix B1b, _temp5.md): now that the persist-keys loop
  // has populated state.jobsSnapshot from disk, render the "previous
  // session" rows at the bottom of the log pane. This used to run in
  // bootstrap.js at script-PARSE time (before state was loaded), so
  // it silently no-op'd on every launch. Calling it here — after the
  // disk state is in memory — is the only point in the lifecycle
  // where the data is actually present.
  try {
    if (window.LogService && typeof window.LogService.renderPersistedL2 === 'function'
        && Array.isArray(state.jobsSnapshot)) {
      window.LogService.renderPersistedL2(state.jobsSnapshot);
    }
  } catch (e) { console.warn('renderPersistedL2 failed:', e); }
  if (savedState.fbDirs && typeof savedState.fbDirs === 'object') {
    for (const k of ['image', 'speech', 'music', 'video']) {
      if (typeof savedState.fbDirs[k] === 'string') state.fbDirs[k] = savedState.fbDirs[k];
    }
  }
  const startTab = (savedState.currentTab && ['image','speech','music','video'].includes(savedState.currentTab))
    ? savedState.currentTab : 'image';
  // Bug-fix #14 (2026-06-19): seed the CSS variables that the
  // splitter drag handlers write to, from the just-loaded state.
  // The drag handlers attach themselves on DOMContentLoaded
  // (their own IIFE); this call just replays the persisted sizes
  // onto the root element so a fresh launch opens with the user's
  // previous sidebar/logbar/preview widths.
  if (window.SplitterDrag && typeof window.SplitterDrag.applyLayoutSettings === 'function') {
    window.SplitterDrag.applyLayoutSettings();
  }
  for (const tabKey of ['image', 'speech', 'music', 'video']) {
    if (TABS[tabKey] && typeof TABS[tabKey].build === 'function') TABS[tabKey].build();
    assignTabFormIds(tabKey);
    applyTabState(tabKey, state.tabSettings[tabKey] || {});
    setupTabAutosave(tabKey);
  }

  // Load batches
  state.batches = await window.api.batchesGet();
  _refreshBatchButtons();

  // Install global keyboard shortcuts
  installKeyboardShortcuts();
  setupLastCmdTooltips();
  setStatus('Ready');

  // Initial values
  // Bug-fix (2026-06-19): the previous fallback was
  //   `configPath().replace(/config\.txt$/i, 'generated')`
  // which for a packaged build resolves to `<exe-dir>/generated`
  // — i.e. `<dist-stable>/win-unpacked/generated`. The user
  // asked to use `%APPDATA%` instead (a per-user, per-app
  // location they can easily find later). The main process
  // owns the resolution (so both sides stay in sync via the
  // same `effectiveOutputDir(cfg)` helper).
  if (!state.config.output_dir) {
    try {
      state.config.output_dir = await window.api.defaultOutputDir();
    } catch (_) {
      // IPC missing in some test contexts — leave blank, the
      // ensureSubDir() guard will toast a clear error.
    }
  }

  showTab(startTab);

  // Startup popup (deferred so the rest of the UI is visible behind it)
  showStartupPopup();

  // Logs from main. Phase A: main now sends { line, jobId, kind }.
  // The preload bridge wraps the legacy string payload so older main
  // builds still work — see preload.js onLogRich. We prefer onLogRich
  // (new payload) and fall back to onLog (legacy string) if the
  // preload doesn't expose it (e.g. older dev build).
  if (window.api.onLogRich) {
    window.api.onLogRich((payload) => {
      // payload = { line, jobId?, kind? }
      if (!payload) return;
      if (payload.jobId) {
        // Attach to the job's primary row instead of adding a new
        // row. Free-form lines (no jobId) still get their own row
        // via the addLogEvent path.
        if (window.LogService && window.LogService.attachSecondaryToJob) {
          window.LogService.attachSecondaryToJob(payload.jobId, payload.line);
        }
        return;
      }
      log(payload.line);
    });
  } else {
    window.api.onLog((line) => log(line));
  }
  // Wire the new log toolbar (jump, expand/collapse all, autoscroll chip).
  if (window.LogService && window.LogService.setupLogToolbar) {
    window.LogService.setupLogToolbar();
  }

  // Phase C: graceful shutdown. When the main process emits
  // `app:before-quit`, flush any in-flight job summaries to the
  // L2 list + persist state.json synchronously (best-effort —
  // we don't block the quit). The renderer doesn't ack; the
  // main process gives us `graceMs` ms then proceeds anyway.
  if (window.api && typeof window.api.onBeforeQuit === 'function') {
    window.api.onBeforeQuit(() => {
      try {
        if (window.JobRunner && typeof window.JobRunner.flushBatchSummaries === 'function') {
          window.JobRunner.flushBatchSummaries();
        }
      } catch (_) { /* best-effort */ }
      // Bug-fix HIGH-2 (_temp5.md 360° audit): call saveAllStates()
      // DIRECTLY, not the debounced scheduleStateSave() wrapper.
      // The debounce fires 500 ms in the future, but Electron tears
      // the renderer down within tens of ms of `before-quit` — the
      // debounced save never ran, so any state change in the last
      // 500 ms (a finished job's snapshot push, a dismissed popup,
      // a toggled setting) was silently lost on quit. saveAllStates
      // itself only fans out to one IPC call, so calling it
      // synchronously here is cheap and gives the main process the
      // real final state.
      try {
        if (typeof saveAllStates === 'function') saveAllStates();
      } catch (_) { /* best-effort */ }
    });
  }

  // First quota fetch
  refreshQuota().catch((e) => {
    // v1.1.25: the first quota fetch failing is often the first
    // sign of an offline environment, an expired token, or a
    // broken IPC channel. Surface it instead of ignoring.
    if (typeof window.logError === 'function') {
      window.logError('refresh-quota', 'renderer/app.js:init', e);
    }
  });
}



function applyTheme(theme) {
  state.theme = (theme === 'light' ? 'light' : 'dark');
  document.documentElement.setAttribute('data-theme', state.theme);
}

function toggleTheme() {
  const next = state.theme === 'light' ? 'dark' : 'light';
  applyTheme(next);
  // Persist immediately
  state.config.theme = next;
  window.api.setConfig(state.config).catch(() => {});
  toast(`Theme: ${next}`, 'ok', 1500);
}

// ----------------- ensureSubDir -----------------
// Resolves the per-tab output folder and creates it (idempotently)
// via the allow-listed fbMkdir IPC. Each tab calls this once at
// the top of its generate handler.
//
// Bug-fix (2026-06-19, reported by user):
//   The function was lost during the Phase 3 Block 29 refactor
//   (extracted from app.js into 24 sections). The generate handler
//   in imageTab / speechTab / musicTab / videoTab still references
//   `ensureSubDir(name)` as a global, so when the user clicks
//   Generate the call throws a ReferenceError, the catch block
//   fires, and the renderer always shows "No output directory set.
//   Open Settings." — even when the user JUST set an output
//   directory. This was the single biggest UX regression after the
//   refactor.
//
// Behaviour (v1.1.16 — bug-fix D1 for "files land in output_dir\<tab>
// when the browser shows the output_dir root"):
//   1. If output_dir is blank → throw (caller shows the toast).
//   2. If the file-browser's current folder (state.fbDir) is a
//      SUBFOLDER of output_dir (e.g. the user navigated into
//      <output>/myproject) → use that subfolder directly. The
//      per-tab default is NOT prepended (a user who explicitly
//      navigated to a subfolder is telling us "drop it HERE").
//   3. If the file-browser's current folder is the output_dir
//      itself OR is empty → use the output_dir root directly.
//      (v1.1.8 used to redirect this case to <output_dir>/<tabName>
//      to avoid cluttering the root — but that meant a file could
//      land one level deeper than the folder the browser was
//      actually showing, which looks like the file "vanished".
//      The hard requirement is "files must land in the folder
//      shown in the browser", so the root — when that's what's
//      shown — wins. refreshBrowser() already prefers navigating
//      INTO <output_dir>/<tabName> when that subfolder already
//      exists, so a returning user still gets the old per-tab
//      grouping; only the very first generation for a tab, or a
//      browser explicitly backed up to the root, writes to the
//      root itself.)
//   4. If the file-browser's current folder is OUTSIDE output_dir
//      (user picked an arbitrary folder via the native dialog,
//      e.g. E:\myproject\assets) → use that folder directly. The
//      per-tab default is NOT prepended because the folder the
//      user picked is already a clear "drop it here" signal.
//
// Folder creation goes through window.api.fbMkdir (NOT fs.write
// or any direct write path) so the allow-list in main/services/
// PathSecurityService gates the directory creation and a future
// bug can't bypass it.
async function ensureSubDir(name) {
  const base = state.config.output_dir || '';
  if (!base) throw new Error('No output directory set. Open Settings.');
  const normForCompare = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const baseNorm = normForCompare(base);
  const fbNorm = normForCompare(state.fbDir || '');
  // Bug-fix (D2, _temp4.md): remember whether the browser had nothing
  // to show BEFORE we resolve a target, so we can warn the user their
  // files are landing somewhere the browser wasn't actually pointed at.
  const fbWasEmpty = !fbNorm;
  const baseSep = base.includes('\\') ? '\\' : '/';
  const join = (a, b, sep) => a.replace(/[\\/]+$/, '') + sep + b;
  // Decide which directory the generated files should land in.
  // See the comment block above for the 4 cases.
  let targetDir = null;
  let externalPicked = false;
  let rootDefault = false;
  if (fbNorm && fbNorm.startsWith(baseNorm + '/')) {
    // Case 2: user navigated into a real subfolder of output_dir.
    targetDir = (state.fbDir || '').replace(/[\\/]+$/, '');
  } else if (fbNorm && fbNorm !== baseNorm && !fbNorm.startsWith(baseNorm + '/')) {
    // Case 4: user picked a folder outside output_dir (e.g. on
    // another drive via the 📂 button). The path is already
    // trusted by the picker (pathSecurity.addTrusted was called
    // by the pickFolder IPC), so a single fbMkdir(state.fbDir, name)
    // call works — fb.mkdir does the allow-list check on the
    // parent of the join, and the parent is the trusted pick
    // itself, which IS under itself.
    targetDir = (state.fbDir || '').replace(/[\\/]+$/, '');
    externalPicked = true;
  } else {
    // Case 3 (bug-fix D1): fbDir is empty or equals the output_dir
    // root — write directly to the root, matching what the browser
    // shows. See the comment block above for why this no longer
    // redirects to <output_dir>/<name>.
    targetDir = base.replace(/[\\/]+$/, '');
    rootDefault = true;
  }
  // fbMkdir resolves with { ok, error } — it does NOT reject on failure.
  // The previous code just `await`ed it, so a { ok:false } result (e.g.
  // the drive-root mkdir bug, or an allow-list rejection) was silently
  // ignored: ensureSubDir returned a targetDir that was never created and
  // mmx then failed with a confusing ENOENT. Check .ok and throw the real
  // reason so the caller shows "Cannot resolve output folder: …".
  const mkdirOrThrow = async (d, n) => {
    const r = await window.api.fbMkdir(d, n);
    if (!r || !r.ok) throw new Error((r && r.error) || `Could not create folder "${n}" in ${d}.`);
    return r;
  };
  if (rootDefault) {
    // Root default (case 3): the root may not exist yet (e.g. the
    // very first launch, before <output_dir> has ever been written
    // to). fbMkdir always creates a NAMED CHILD of its first
    // argument, so it can't create the root itself — fbEnsureDir is
    // the dedicated IPC for "create this exact (already-allowed)
    // path if missing".
    const r = await window.api.fbEnsureDir(targetDir);
    if (!r || !r.ok) throw new Error((r && r.error) || `Could not create folder "${targetDir}".`);
  } else if (externalPicked) {
    // External picked folder (case 4): the picked path itself
    // is already an allowed root (the picker added it via
    // pathSecurity.addTrusted) and the user is browsing it, so
    // files land DIRECTLY in it (targetDir === picked, NOT
    // <picked>/<tabName>).
    // Bug-fix B4 (_temp5.md): the previous version called
    // mkdirOrThrow(picked, name), which created a spurious empty
    // <picked>/<tabName> directory on every generation into an
    // external folder — the files never went into it (they went
    // to <picked>), contradicting the case-4 contract. The
    // picked folder already exists (the user is browsing it),
    // so fbEnsureDir is a no-op on disk but keeps the allow-list
    // check consistent with the other branches.
    const picked = (state.fbDir || '').replace(/[\\/]+$/, '');
    const r = await window.api.fbEnsureDir(picked);
    if (!r || !r.ok) throw new Error((r && r.error) || `Could not access folder "${picked}".`);
  } else {
    // Subfolder of output_dir (case 2): walk the path
    // segment-by-segment so each mkdir is individually
    // allow-list-checked against the trusted base.
    const stripped = targetDir.replace(/[\\/]+$/, '');
    const baseN = base.replace(/[\\/]+$/, '');
    const relParts = [];
    if (stripped.length > baseN.length) {
      const rel = stripped.slice(baseN.length).replace(/^[\\/]+/, '');
      for (const p of rel.split(/[\\/]/).filter(Boolean)) relParts.push(p);
    }
    let cur = base;
    for (const p of relParts) {
      await mkdirOrThrow(cur, p);
      cur = join(cur, p, baseSep);
    }
  }
  // Bug-fix (D2, _temp4.md): the browser had nothing to show (fbDir was
  // unset) when we resolved this target — warn so the user isn't
  // surprised the file isn't where they were just looking, then bring
  // the browser in sync so it stops being empty/stale. keepCurrent:true
  // stops refreshBrowser's own "try the per-tab subfolder" heuristic
  // from immediately navigating away from the root we just wrote to.
  if (fbWasEmpty && typeof toast === 'function') {
    toast(`No folder was shown in the browser — files will be saved to "${targetDir}".`, 'warn', 5000);
    state.fbDir = targetDir;
    if (typeof window.refreshBrowser === 'function') {
      try { await window.refreshBrowser({ keepCurrent: true }); } catch { /* best-effort UI sync */ }
    }
  }
  return targetDir;
}
// Phase 4 Fix 15: 'window.ensureSubDir = ensureSubDir' so the tab
// scripts (loaded BEFORE app.js) can see it without crashing.
window.ensureSubDir = ensureSubDir;
window.buildForcePrefixFileName = buildForcePrefixFileName;

// ----------------- Generation helpers -----------------
// Bug-fix (2026-06-20, reported by user): Generate did nothing because
// armGenBtnWithCancel (and several sibling helpers) was lost during the
// Phase 3 Block 29 refactor — the section-boundary regex missed them in
// f40f56b's monolithic app.js, so the new section files reference functions
// that don't exist anywhere. The renderer hits a ReferenceError at the
// first click on the Generate button (after the pre-flight checks all
// pass), the async handler rejects, and the user sees nothing. The
// functions below are the canonical v1.1.0 implementations, restored
// verbatim so the gen handlers in imageTab / speechTab / musicTab /
// videoTab can resolve them. Without these the tool is completely
// unable to produce an asset, no matter how valid the inputs are.

// "YYYYMMDD_HHMMSS" timestamp used as the slug stem for every generated
// file. The renderer doesn't have a built-in `strftime`, so we build it
// by hand with leading-zero padding. Local-time by design — the user
// sees the same wall-clock time they generated the file at.
function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
// Convert a free-form prompt into a filename-safe slug. The same rule
// the v1.1.0 helper used: lowercase, swap any non-[a-z0-9] run for a
// single `-`, trim leading/trailing dashes. Empty result falls back
// to the per-tab default name in the gen handler (`|| 'image'` etc.).
function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
// Renderer's uniquePath: append a 4-char base36 suffix to virtually
// eliminate in-session collisions (two clicks in the same second would
// otherwise overwrite each other). We can't query the FS from the
// renderer, so a random suffix is the simplest correct approach.
function uniquePath(dir, name) {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  const suffix = Math.random().toString(36).slice(2, 6) || 'rndm';
  return dir.replace(/[\\/]+$/, '') + (dir.includes('\\') ? '\\' : '/') + stem + '_' + suffix + ext;
}

// v1.1.15 (reported by user): helper that builds the
// "force-prefix-only" filename `<prefix><6-digit counter>.<ext>`.
// The caller owns the counter object (so two parallel Generate
// clicks — image + speech at once, for example — don't trample
// each other) and bumps it on every call. The counter is just
// a plain object the caller mutates: `{ n: 0 }` to start, then
// `buildForcePrefixFileName(counter, 'temp', 'jpg')` returns
// `temp000001.jpg` for the first call, `temp000002.jpg` for
// the second, etc. The 6-digit pad means the counter tops out
// at 999999 files per run (which is far more than the user
// will ever produce in one click); beyond that the pad
// silently widens to 7 digits so the user doesn't silently
// overwrite the first 999999 files.
function buildForcePrefixFileName(counter, prefix, ext) {
  counter.n = (counter.n | 0) + 1;
  // Use enough leading zeros for the current value so the
  // count is always 6 digits minimum. Once the count crosses
  // 999999, the pad widens to 7 digits, then 8, etc. — so
  // even an extremely long run can't silently overwrite an
  // earlier file in the same run.
  const padded = String(counter.n).padStart(6, '0');
  return `${prefix || ''}${padded}.${ext}`;
}
// Bug-fix (C4): force-prefix-only files must be named EXACTLY
// `<prefix><counter>.<ext>` with no random suffix — that's the whole
// point of the feature. The tabs used to wrap buildForcePrefixFileName's
// result in uniquePath(), which appended a random 4-char suffix and
// silently broke the "exact name" promise (e.g. etg000001_a3f9.png
// instead of etg000001.png). Collision safety across separate Generate
// clicks (the counter resets to 0 every click) is handled here instead:
// probe the filesystem and bump the counter forward past any file that
// already exists, rather than randomizing the name.
// `altExts` (bug-fix M6, _temp4.md): optional sibling extensions to also
// treat as "taken" at the same counter value. The image tab's mmx API has
// no output-format parameter, so a generated file's real bytes don't
// always match the ".png" we originally asked mmx to write to —
// fixImageExtension() corrects the on-disk name afterward (e.g.
// temp000001.png -> temp000001.jpg). Without checking siblings here, a
// later click's fbExists('temp000001.png') would report "free" even
// though that counter slot is really occupied by temp000001.jpg, and
// every subsequent click would collide on the same counter value
// forever instead of advancing past it. Callers that can't have this
// mismatch (video/speech/music, which either have a single true
// extension or request an honoured --format) simply omit altExts.
async function nextFreeForcePrefixPath(dir, counter, prefix, ext, altExts) {
  const sep = dir.includes('\\') ? '\\' : '/';
  const base = dir.replace(/[\\/]+$/, '');
  // v1.1 (audit L4): iteration cap. The previous `for (;;)` would
  // loop forever if fbExists consistently returned true (corrupted
  // FS state, an allow-list bug, a directory full of a million
  // temp###### files). The sibling helper in section08 caps at
  // 1000; we use the same number for consistency. On exhaustion
  // the function falls back to a timestamp-suffixed name so the
  // caller still gets a unique path and the user never loses a
  // file they just paid API credits to generate.
  const MAX_TRIES = 1000;
  for (let i = 0; i < MAX_TRIES; i++) {
    const name = buildForcePrefixFileName(counter, prefix, ext);
    const full = base + sep + name;
    let exists = false;
    // v1.1 (audit BUG-R2-09): fbExists now returns a { ok, exists }
    // envelope instead of a bare boolean. Pull the boolean out of
    // .exists for the truthy-check below.
    try {
      const r = await window.api.fbExists(full);
      exists = !!(r && r.exists);
    } catch { exists = false; }
    if (!exists && Array.isArray(altExts) && altExts.length) {
      const padded = String(counter.n).padStart(6, '0');
      const stem = `${prefix || ''}${padded}`;
      for (const altExt of altExts) {
        if (altExt === ext) continue;
        try {
          const r2 = await window.api.fbExists(base + sep + `${stem}.${altExt}`);
          if (r2 && r2.exists) { exists = true; break; }
        } catch { /* treat as not-existing on error */ }
      }
    }
    if (!exists) return full;
  }
  // Fallback: a timestamp-suffixed name that's effectively impossible
  // to collide with an existing file. The counter is still advanced
  // so the next call doesn't re-scan the same million files.
  const tsName = `${prefix || ''}${Date.now()}_${Math.floor(Math.random() * 100000)}.${ext}`;
  return base + sep + tsName;
}
window.nextFreeForcePrefixPath = nextFreeForcePrefixPath;
// Format mmx error: strip the "node.exe :" prefix PowerShell wraps
// around stderr, then surface the most informative bit. mmx returns
// errors in a few different shapes depending on which command failed;
// see classifyMmxError below for the categorisation that follows.
function formatMmxError(r) {
  let msg = (r.stderr || r.stdout || '').toString();
  msg = msg.replace(/^node\.exe\s*:\s*/gm, '').trim();
  if (r.parsed && typeof r.parsed === 'object') {
    // Shape 1: { "error": { "code": N, "message": "..." } }
    if (r.parsed.error && typeof r.parsed.error === 'object' && r.parsed.error.message) {
      const m = String(r.parsed.error.message);
      if (m) return msg ? `${m} (${msg})` : m;
    }
    // Shape 2: { "base_resp": { "status_code": N, "status_msg": "..." } }
    if (r.parsed.base_resp && r.parsed.base_resp.status_msg) {
      const sm = r.parsed.base_resp.status_msg;
      const sc = r.parsed.base_resp.status_code;
      if (sm && sc !== 0) return msg ? `${sm} (${msg})` : sm;
    }
    // Shape 3: { "message": "..." } (catch-all)
    if (typeof r.parsed.message === 'string' && r.parsed.message) return r.parsed.message;
  }
  return msg || `mmx exited with code ${r.code}`;
}
// Classify an mmx error so the image tab's error UI can show targeted
// troubleshooting tips (auth / rate / quota / network / server /
// unknown). Matches a deliberately small set of substrings; the
// patterns are case-insensitive on the combined stderr/stdout/msg blob.
function classifyMmxError(r, msg) {
  const combined = ((msg || '') + ' ' + (r.stderr || '') + ' ' + (r.stdout || '')).toLowerCase();
  if (/401|403|unauthor|forbidden|invalid.api.key|api.key.*invalid|auth.*fail/.test(combined)) return 'auth';
  // 'input' = a permanent, user-fixable problem with the request itself
  // (most commonly a reference/lyrics file that doesn't exist on disk).
  // Checked before 'network' so a local ENOENT isn't mistaken for the
  // DNS-level ENOTFOUND. Bug-fix (reported by user): a missing
  // --subject-ref image used to surface as a cryptic mmx ENOENT that was
  // then retried 4×; classify it so the retry loop can skip it.
  if (/enoent|no such file|file or directory not found|file system error/.test(combined)) return 'input';
  if (/429|rate|limit|throttl|too many/.test(combined)) return 'rate';
  if (/quota|not.in.plan|exhaust|insufficient/.test(combined)) return 'quota';
  if (/enotfound|econnrefused|econnreset|etimedout|network|dns/.test(combined)) return 'network';
  if (/500|502|503|504|server.error|system.error|internal/.test(combined)) return 'server';
  return 'unknown';
}
// Whether an mmx failure is worth retrying. Permanent failures (bad
// credentials, exhausted quota, a missing input file) will fail
// identically on every retry — retrying just wastes the user's time and,
// for a missing reference image, hammers the same non-existent path 4×
// (reported by user). Only the transient classes (rate-limit, network
// blip, 5xx / "system error (HTTP 200)") are retried.
function isRetryableMmxError(r, msg) {
  const cls = classifyMmxError(r, msg);
  return !(cls === 'auth' || cls === 'quota' || cls === 'input');
}
// Bump the in-session "N generations this session" counter shown in
// the status bar. Called from every gen handler's success path (image /
// speech / music / video). Cleared on app restart — this is purely a
// per-session UX hint, not persisted.
let _generationCounter = 0;
function bumpGenerationCounter(kind, n = 1) {
  _generationCounter += Math.max(1, n | 0);
  setStatus(`${_generationCounter} generations this session`, false);
}
// Wrap a generation call with a cancel button. While the call is in
// flight the button text becomes "Cancel" (clicking it triggers the
// cancel path), state.generating is set to the tab key so re-entrant
// click guards and the batch runner can detect an in-flight run, and
// state.genStatus[tabKey] is set to "running" (drives the red tab dot).
// On cleanup: the original button label is restored, state.generating
// is cleared, the per-tab ETA average is updated (alpha=0.4, recent
// runs weighted higher), and the tab dot flips to "done".
// bug-fix H4/Phase1 (_temp4.md): optional 3rd param `jobId`. When the
// caller has wrapped its generation in JobRunner.run(...), passing the
// returned jobId here makes the Cancel button drive JobRunner.cancel()
// (which kills exactly this job's mmx proc and updates the job's
// status/widget) instead of the legacy panic-everything mmxCancel().
// Callers that haven't migrated simply omit jobId — behaviour for them
// is byte-for-byte unchanged.
function armGenBtnWithCancel(genBtn, label, jobId) {
  let cancelled = false;
  const origLabel = label || genBtn.textContent;
  const tabKey = (genBtn.closest('.tabpanel')?.id || '').replace('tab-', '') || null;
  genBtn.textContent = 'Cancel';
  genBtn.classList.add('danger');
  state.generating = tabKey;
  if (tabKey) {
    state.genStatus[tabKey] = 'running';
    if (!state.genStartMs) state.genStartMs = { image: null, speech: null, music: null, video: null };
    state.genStartMs[tabKey] = Date.now();
  }
  refreshTabStatusDots();
  ensureEtaTimer();
  const onCancelClick = async (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    if (!confirm('Cancel the current generation?')) return;
    cancelled = true;
    toast('Cancelling…', 'warn', 1500);
    if (jobId && window.JobRunner && typeof window.JobRunner.cancel === 'function') {
      window.JobRunner.cancel(jobId);
    } else {
      await window.api.mmxCancel();
    }
  };
  genBtn.addEventListener('click', onCancelClick);
  return {
    cancel: () => { cancelled = true; },
    wasCancelled: () => cancelled,
    cleanup: () => {
      genBtn.removeEventListener('click', onCancelClick);
      genBtn.classList.remove('danger');
      genBtn.textContent = origLabel;
      genBtn.disabled = false;
      if (tabKey && !cancelled && state.genStartMs && state.genStartMs[tabKey]) {
        const dur = (Date.now() - state.genStartMs[tabKey]) / 1000;
        if (!state.genAvgSec) state.genAvgSec = { image: 0, speech: 0, music: 0, video: 0 };
        const prev = state.genAvgSec[tabKey] || 0;
        state.genAvgSec[tabKey] = prev === 0 ? dur : (prev * 0.6 + dur * 0.4);
        state.genStartMs[tabKey] = null;
      }
      if (state.generating === tabKey) state.generating = null;
      if (tabKey) state.genStatus[tabKey] = cancelled ? 'idle' : 'done';
      refreshTabStatusDots();
    },
  };
}

function installKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Skip when typing in a non-textarea field (so Ctrl+A etc. works in inputs)
    const inField = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT');
    const cmd = e.ctrlKey || e.metaKey;
    // `e.key` is undefined when only a modifier is held. Bail out so we don't
    // mis-fire handlers on modifier-only events (e.g. releasing Shift).
    if (!e.key) return;
    if (cmd && e.key === 'Enter') {
      // Generate on the active tab.
      // Bug-fix B6 (_temp5.md): the previous gate was
      // `!state.generating`, which is truthy whenever ANY tab is
      // generating (state.generating is set to a tabKey or 'mixed'
      // by JobRunner._syncLegacyGenerating). That blocked Ctrl+Enter
      // globally during any in-flight run, even though the mouse-
      // click Generate path correctly allows starting a job on an
      // IDLE tab while another tab runs (per-tab isTabRunning gate).
      // The keyboard shortcut now mirrors the per-tab gate so
      // Ctrl+Enter works on an idle tab in parallel with another
      // running tab.
      const tab = state.currentTab;
      const genBtn = $(`#tab-${tab} button.primary`);
      const tabRunning = !!(window.JobRunner && typeof window.JobRunner.isTabRunning === 'function'
        && window.JobRunner.isTabRunning(tab));
      if (genBtn && !tabRunning && state.generating !== tab && genBtn.textContent !== 'Cancel') { genBtn.click(); e.preventDefault(); }
      return;
    }
    if (cmd && ['1','2','3','4'].includes(e.key)) {
      const tabs = ['image','speech','music','video'];
      const idx = parseInt(e.key, 10) - 1;
      if (tabs[idx]) { showTab(tabs[idx]); e.preventDefault(); }
      return;
    }
    if (cmd && (e.key === 'b' || e.key === 'B')) {
      openBatchManager(state.currentTab); e.preventDefault(); return;
    }
    if (cmd && (e.key === 's' || e.key === 'S')) {
      openSettings(); e.preventDefault(); return;
    }
    if (cmd && (e.key === 't' || e.key === 'T')) {
      openStyleSettings(); e.preventDefault(); return;
    }
    if (cmd && (e.key === 'l' || e.key === 'L')) {
      toggleTheme(); e.preventDefault(); return;
    }
    if (cmd && (e.key === 'f' || e.key === 'F') && !inField) {
      // Focus the file browser filter
      const s = $('#fb-search');
      if (s) { s.focus(); s.select(); e.preventDefault(); }
      return;
    }
    if (cmd && (e.key === 'r' || e.key === 'R')) {
      // Refresh quota
      refreshQuota(); toast('Quota refreshed.', 'ok', 1500); e.preventDefault(); return;
    }
  });
}

function assignTabFormIds(tabKey) {
  const root = $(`#tab-${tabKey}`);
  if (!root) return;
  const seen = new Set();
  let n = 0;
  for (const row of root.querySelectorAll('.row')) {
    const labelText = row.querySelector('label')?.textContent?.trim()?.split('\n')[0]?.trim() || `field_${n}`;
    let slug = slugifyLabel(labelText);
    let baseId = `${tabKey}.${slug}`;
    let suffix = 0;
    while (seen.has(baseId)) { suffix++; baseId = `${tabKey}.${slug}_${suffix}`; }
    seen.add(baseId);
    const all = row.querySelectorAll('input, select, textarea');
    if (all.length > 1) {
      all.forEach((el, i) => { if (!el.id) el.id = `${baseId}.${i}`; });
    } else if (all.length === 1) {
      if (!all[0].id) all[0].id = baseId;
    }
    n++;
  }
}

function applyTabState(tabKey, data) {
  if (!data) return;
  const root = $(`#tab-${tabKey}`);
  if (!root) return;
  for (const inp of root.querySelectorAll('input[id], select[id], textarea[id]')) {
    if (!(inp.id in data)) continue;
    if (inp.type === 'checkbox') inp.checked = data[inp.id] === 'on' || data[inp.id] === true;
    else inp.value = data[inp.id];
    // Re-fire input/change so the UI reacts (e.g. has-custom class for combos)
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function setupTabAutosave(tabKey) {
  const root = $(`#tab-${tabKey}`);
  if (!root) return;
  // Save on any change (input for text, change for select/checkbox)
  root.addEventListener('input', scheduleStateSave, true);
  root.addEventListener('change', scheduleStateSave, true);
}

function _refreshBatchButtons() {
  // For each tab, render the batch controls based on the current queue.
  // Empty queue  → single "Setup Batch Mode" button.
  // Has entries  → "Start BatchGen (N)" + a small "✎" edit button.
  for (const tabKey of ['image', 'speech', 'music', 'video']) {
    const root = $(`#tab-${tabKey}`);
    if (!root) continue;
    const wrap = root.querySelector('[data-batch-controls]');
    if (!wrap) continue;
    const n = (state.batches[tabKey] || []).length;
    wrap.innerHTML = '';
    if (n === 0) {
      // Setup / edit-empty mode: single button
      const setup = el('button', {
        class: 'btn-mini batch-setup',
        onclick: () => openBatchManager(tabKey),
      }, 'Setup Batch Mode');
      wrap.appendChild(setup);
    } else {
      // Populated mode: "Start BatchGen (N)" + small ✎ edit button
      const start = el('button', {
        class: 'batch-start',
        onclick: () => startBatchGen(tabKey),
      }, `▶ Start BatchGen (${n})`);
      const edit = el('button', {
        class: 'btn-mini batch-edit',
        title: 'Edit batch entries',
        onclick: () => openBatchManager(tabKey),
      }, '✎');
      wrap.append(start, edit);
    }

    // Append helper actions
    const importBtn = el('button', {
      class: 'btn-mini batch-import',
      title: 'Import batch queue from .txt or .md file',
      onclick: (e) => { e.preventDefault(); window.BatchManager.importBatchFileDialog(); },
    }, 'Import Batch File…');

    const examplesBtn = el('button', {
      class: 'btn-mini batch-examples',
      title: 'Generate example .txt & .md instructions for AI',
      onclick: (e) => { e.preventDefault(); window.BatchManager.generateExampleFiles(); },
    }, 'Gen Examples');

    const totalAllTabs = ['image', 'speech', 'music', 'video'].reduce((sum, k) => sum + (state.batches[k] || []).length, 0);
    // v1.1.9: ETA span next to the "BatGen All Types" button.
    // Only shown when MORE than one type has items (the user's
    // explicit request) — for a single tab the per-tab ETA is
    // already visible. The span reads the per-tab ETA helper so
    // it stays in sync with the per-tab running averages.
    const typesWithBatch = ['image', 'speech', 'music', 'video'].filter((k) => (state.batches[k] || []).length > 0);
    const showAllEta = typesWithBatch.length > 1;
    const allEta = el('span', {
      class: 'batch-all-eta',
      // Hidden by default; refreshed by _refreshAllBatchEta() on
      // a 1s tick while a batch is in flight, and on every
      // _refreshBatchButtons() call.
      style: showAllEta ? 'margin-left: 6px; font-variant-numeric: tabular-nums; color: var(--fg-2);' : 'display: none;',
      title: 'Estimated time to finish all queued batches across the tabs that have items',
    }, '');
    const startAllBtn = el('button', {
      class: 'batch-start-all',
      style: totalAllTabs > 0 ? 'background: var(--primary-2, #d9a300); color: var(--bg-1); font-weight: bold; margin-left: 4px;' : 'display: none;',
      title: 'Start batch generation on all tabs sequentially',
      onclick: (e) => { e.preventDefault(); window.BatchManager.startAllBatchGen(); },
    }, `▶ BatGen All Types (${totalAllTabs})`);
    // v1.1.11 (reported by user): small "✎" edit button next
    // to the "BatGen All Types" button (matches the pen icon
    // on the per-tab "Start BatchGen (N)" button). Clicking it
    // opens a dashboard modal showing the active generation
    // (if any) + the queued items across every tab, with the
    // model / style / parameters / ETA organised per-tab so
    // the user can see exactly what's about to run.
    const startAllEditBtn = el('button', {
      class: 'btn-mini batch-start-all-edit',
      style: totalAllTabs > 0 ? 'margin-left: 4px;' : 'display: none;',
      title: 'Open the all-types BatchGen dashboard (active + upcoming items, model + ETA per tab)',
      onclick: (e) => { e.preventDefault(); openAllBatchDashboard(); },
    }, '✎');

    // Divider line
    wrap.append(el('span', { style: 'margin: 0 6px; border-left: 1px solid var(--border); height: 14px; display: inline-block; vertical-align: middle;' }));
    wrap.append(importBtn, examplesBtn, startAllBtn, startAllEditBtn, allEta);
  }
  // Always refresh the all-types ETA in case state.batchQueueLeft
  // changed without _refreshBatchButtons being called.
  _refreshAllBatchEta();
}

// v1.1.9: refresh the ETA span next to the "BatGen All Types"
// button. Reads per-tab batchQueueLeft + the per-tab running
// average (state.genAvgSec) and computes the total remaining
// wall-clock time. The result is mm:ss (or h:mm:ss for runs over
// an hour). The function is safe to call on every tick — it does
// the math in a couple of µs and only touches the DOM if the
// value actually changed.
function _refreshAllBatchEta() {
  const tabs = ['image', 'speech', 'music', 'video'];
  const allEta = document.querySelector('.batch-all-eta');
  if (!allEta) return;
  // Hide the ETA if the user only has 1 type in the queue, or
  // if the user isn't running a batch right now.
  const typesWithQueue = tabs.filter((k) => (state.batches[k] || []).length > 0);
  if (typesWithQueue.length < 2) { allEta.style.display = 'none'; return; }
  const hasRunningBatch = tabs.some((k) => (state.batchQueueLeft && state.batchQueueLeft[k] > 0));
  if (!hasRunningBatch) { allEta.textContent = ''; allEta.style.display = 'none'; return; }
  // Weighted total: sum(remaining * avg) for each tab.
  let totalSec = 0;
  let anyRunning = false;
  for (const k of tabs) {
    const remaining = (state.batchQueueLeft && state.batchQueueLeft[k]) || 0;
    if (remaining <= 0) continue;
    let avg = (state.genAvgSec && state.genAvgSec[k]) || 0;
    if (!avg) {
      const defaults = { image: 35, speech: 12, music: 75, video: 90 };
      avg = defaults[k] || 30;
    }
    totalSec += remaining * avg;
    anyRunning = true;
  }
  if (!anyRunning) { allEta.textContent = ''; allEta.style.display = 'none'; return; }
  allEta.style.display = '';
  const sec = Math.max(0, Math.round(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  allEta.textContent = h > 0
    ? `⏱ ${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `⏱ ${m}:${String(s).padStart(2, '0')}`;
}

// v1.1.11 (reported by user): the "BatGen All Types" dashboard
// modal. Shown when the user clicks the new ✎ pen-icon next to
// the BatGen All Types button. The modal shows:
//   • a "Currently running" header with the active tab +
//     item + ETA (if a batch is in flight)
//   • for each tab that has queued items: the tab header +
//     item count + remaining ETA + the per-tab model +
//     parameters + a scrollable list of every queued item
//     (showing the prompt/text + any per-item params)
//   • a "Settings in effect" section at the bottom that lists
//     the per-tab style preset + output dir + filename
//     prefix + other globals
// The modal auto-refreshes every second while open so the
// countdown ticks down live (just like the per-tab ETA /
// BatGen All Types ETA).
function openAllBatchDashboard() {
  if (typeof showModal !== 'function') return;
  const tabs = ['image', 'speech', 'music', 'video'];
  const tabLabels = { image: '🖼 Image', speech: '🗣 Speech', music: '🎵 Music', video: '🎬 Video' };
  // The 1s refresh interval is created inside the modal builder
  // but cleared from `opts.onClose` so it runs no matter how the
  // modal was dismissed (Close button, Esc, outside-click). The
  // variable lives in the outer function's closure so the onClose
  // hook (defined at the same level) can see it.
  let tick = null;
  // Per-tab avg lookup, with sensible defaults so the first
  // run still shows an estimate instead of "...".
  function avgFor(tabKey) {
    let a = (state.genAvgSec && state.genAvgSec[tabKey]) || 0;
    if (!a) a = ({ image: 35, speech: 12, music: 75, video: 90 })[tabKey] || 30;
    return a;
  }
  function fmtSec(sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${m}:${String(s).padStart(2, '0')}`;
  }
  function batchText(item) {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object') {
      return item.prompt || item.text || '';
    }
    return '';
  }
  showModal((m, close) => {
    m.classList.add('batch-dashboard-modal');
    // Header
    const header = el('div', { class: 'batch-dashboard-header' }, [
      el('h2', { style: 'margin: 0;' }, '🗂 BatchGen — All Types Dashboard'),
      el('button', { type: 'button', class: 'btn-mini', onclick: close }, '✕ Close'),
    ]);
    m.appendChild(header);
    // Live region that gets re-rendered every tick
    const body = el('div', { class: 'batch-dashboard-body' });
    function renderBody() {
      body.innerHTML = '';
      // ---- Currently running section ----
      const running = el('div', { class: 'batch-dashboard-section' });
      const runningItems = tabs
        .map((k) => ({ k, left: (state.batchQueueLeft && state.batchQueueLeft[k]) || 0 }))
        .filter((x) => x.left > 0);
      if (runningItems.length) {
        running.appendChild(el('h3', {}, '▶ Currently running'));
        const ul = el('ul', { class: 'batch-dashboard-list' });
        let totalSec = 0;
        for (const { k, left } of runningItems) {
          totalSec += left * avgFor(k);
          ul.appendChild(el('li', {}, [
            el('strong', {}, tabLabels[k]),
            ' — ',
            el('span', {}, `${left} item${left === 1 ? '' : 's'} left (${fmtSec(left * avgFor(k))} ETA)`),
          ]));
        }
        running.appendChild(ul);
        running.appendChild(el('div', { class: 'batch-dashboard-grand-total' },
          `Grand total ETA: ⏱ ${fmtSec(totalSec)}`));
      } else {
        running.appendChild(el('p', { class: 'batch-dashboard-empty' },
          'No batch is currently running. Click ▶ on any "BatGen All Types" to start one.'));
      }
      body.appendChild(running);
      // ---- Per-tab queues ----
      const queuesSection = el('div', { class: 'batch-dashboard-section' });
      queuesSection.appendChild(el('h3', {}, '📋 Upcoming items by tab'));
      const anyQueued = tabs.some((k) => (state.batches[k] || []).length > 0);
      if (!anyQueued) {
        queuesSection.appendChild(el('p', { class: 'batch-dashboard-empty' },
          'All BatchGen queues are empty. Add items from any tab via "Setup Batch Mode" or import a .txt file.'));
      } else {
        for (const k of tabs) {
          const items = state.batches[k] || [];
          if (!items.length) continue;
          const card = el('div', { class: 'batch-dashboard-card' });
          // Tab header row
          const left = (state.batchQueueLeft && state.batchQueueLeft[k]) || 0;
          const eta = left > 0 ? ` (${fmtSec(left * avgFor(k))} left)` : '';
          card.appendChild(el('div', { class: 'batch-dashboard-card-header' }, [
            el('strong', {}, tabLabels[k]),
            el('span', { class: 'batch-dashboard-count' }, ` — ${items.length} queued${eta}`),
          ]));
          // Settings in effect (read from the live tab DOM
          // so the dashboard always reflects the CURRENT
          // values, not a stale snapshot).
          const tabRoot = $(`#tab-${k}`);
          if (tabRoot) {
            const meta = el('div', { class: 'batch-dashboard-meta' });
            const styleSel = tabRoot.querySelector('.row select');
            const variantSel = tabRoot.querySelector('.variants-select');
            const ta = tabRoot.querySelector('textarea');
            const lines = [];
            if (styleSel) lines.push(`Style: ${styleSel.options[styleSel.selectedIndex]?.text || '(none)'}`);
            if (variantSel) lines.push(`Variants: ${variantSel.value}`);
            if (ta && ta.value) lines.push(`Default prompt: "${ta.value.slice(0, 80)}${ta.value.length > 80 ? '…' : ''}"`);
            lines.push(`Output folder: ${state.fbDirs && state.fbDirs[k] || state.config.output_dir || '(default)'}`);
            if (state.filePrefix) lines.push(`File prefix: "${state.filePrefix}"`);
            // Render as a simple text block (one line per entry)
            const settings = el('div', { class: 'batch-dashboard-settings' });
            for (const ln of lines) settings.appendChild(el('div', {}, ln));
            meta.appendChild(settings);
            card.appendChild(meta);
          }
          // Item list (scrollable, max-height so very large
          // queues don't blow up the modal).
          const list = el('ol', { class: 'batch-dashboard-items' });
          const startIdx = items.length - left; // first item NOT yet processed
          // v1.1.14 (reported by user): per-item edit + remove
          // buttons so the user can manage the queue from the
          // dashboard without re-opening the per-tab batch
          // editor. The buttons act on state.batches[k] in
          // place and persist via batchesSet so a refresh
          // doesn't bring them back. "Edit" opens the existing
          // per-tab batch editor (openBatchManager) where the
          // textareas support per-item editing; "Remove" drops
          // the entry immediately. Both buttons are disabled
          // for items the batch has already processed
          // (startIdx cutoff) — you can't undo history.
          items.forEach((it, idx) => {
            const isDone = idx < startIdx;
            const li = el('li', {
              class: 'batch-dashboard-item' + (isDone ? ' batch-dashboard-item-done' : ''),
              title: batchText(it),
            });
            const txt = batchText(it).slice(0, 200);
            li.appendChild(el('span', { class: 'batch-dashboard-item-num' }, `${idx + 1}.`));
            li.appendChild(el('span', { class: 'batch-dashboard-item-text' }, txt + (batchText(it).length > 200 ? '…' : '')));
            if (it && typeof it === 'object') {
              const params = [];
              for (const k2 of Object.keys(it)) {
                if (k2 === 'prompt' || k2 === 'text') continue;
                if (typeof it[k2] === 'string') params.push(`${k2}: ${it[k2]}`);
                else if (typeof it[k2] === 'number') params.push(`${k2}: ${it[k2]}`);
              }
              if (params.length) li.appendChild(el('span', { class: 'batch-dashboard-item-params' }, ` [${params.join(', ')}]`));
            }
            // v1.1.15 (reported by user): the per-item Edit / Remove
            // buttons were hidden for items the batch had
            // already processed ("you can't undo history").
            // But the user wanted to be able to remove entries
            // from the All Types menu without having to switch
            // to the per-tab editor. We now show the buttons
            // for ALL items, with a "Remove" that just deletes
            // the entry from state.batches (no effect on
            // already-processed items — they stay in the log
            // for history, but the queued future is no longer
            // affected). The "Edit" button opens the per-tab
            // editor where the user can change the entry's
            // text/params.
            {
              const actions = el('span', { class: 'batch-dashboard-item-actions' });
              const editBtn = el('button', {
                type: 'button',
                class: 'btn-mini',
                title: 'Open the per-tab BatchGen editor to edit this entry',
                onclick: () => {
                  close();
                  try { window.BatchManager.openBatchManager(k); } catch (_) { /* tab scripts may not have loaded yet */ }
                },
              }, '✎');
              const removeBtn = el('button', {
                type: 'button',
                class: 'btn-mini danger',
                title: 'Remove this entry from the queue (no undo). Already-processed items stay in the history log.',
                onclick: async () => {
                  const next = (state.batches[k] || []).slice();
                  if (idx < next.length) next.splice(idx, 1);
                  state.batches[k] = next;
                  try { await window.api.batchesSet(state.batches); } catch (_) { /* best-effort */ }
                  renderBody();
                },
              }, '✕');
              actions.append(editBtn, removeBtn);
              li.appendChild(actions);
            }
            list.appendChild(li);
          });
          card.appendChild(list);
          queuesSection.appendChild(card);
        }
      }
      body.appendChild(queuesSection);
      // ---- Footer summary ----
      const footer = el('div', { class: 'batch-dashboard-footer' });
      const totalAllTabs = tabs.reduce((s, k) => s + (state.batches[k] || []).length, 0);
      footer.appendChild(el('div', {}, `Total items queued across all tabs: ${totalAllTabs}`));
      body.appendChild(footer);
    }
    m.appendChild(body);
    renderBody();
    // Refresh every second while the modal is open so the
    // countdown ticks down live. The interval is cleared in
    // the `onClose` hook below so the cleanup runs no matter
    // how the modal was dismissed (Close button, Esc key,
    // outside-click — showModal routes them all through the
    // onClose callback).
    tick = setInterval(renderBody, 1000);
  }, { onClose: () => { if (tick) { clearInterval(tick); tick = null; } } });
}

function openStyleSettings(returnToTab) {
  showModal((m, close) => {
    m.appendChild(el('h2', {}, 'Style Settings'));
    m.appendChild(el('p', { style: 'color: var(--fg-2); font-size: 12px; margin-top: 0;' },
      'Stored in config.txt → [styles] section. Each preset is prepended (with a comma) to your manual prompt. Example: a preset "Pixel Art Berlin" with value "Pixel art, neon red lighting" + manual input "Berliner Straßenkiller" → "Pixel art, neon red lighting, Berliner Straßenkiller".'));

    const ul = el('ul', { class: 'style-list' });
    function renderList() {
      ul.innerHTML = '';
      const styles = state.config.styles || [];
      if (!styles.length) {
        ul.appendChild(el('li', { class: 'empty-row' }, 'No styles yet. Add one below, or click "Save current as style".'));
        return;
      }
      styles.forEach((s, i) => {
        const actions = el('div', { class: 'sactions' }, [
          el('button', { class: 'btn-mini', onclick: () => { editStyle(i, returnToTab); } }, '✎'),
          el('button', { class: 'btn-mini danger', onclick: () => { deleteStyle(i, () => { renderList(); }); } }, '✕'),
        ]);
        const li = el('li', {}, [
          el('div', {}, [
            el('div', { class: 'sname' }, s.name),
            el('div', { class: 'sval' }, s.value),
          ]),
          actions,
        ]);
        ul.appendChild(li);
      });
    }
    renderList();
    m.appendChild(ul);

    // New / Edit form
    const editingIdx = { value: -1 };
    const nameInput = el('input', { type: 'text', placeholder: 'Style name (e.g. "Pixel Art Berlin")' });
    const valInput = el('textarea', { placeholder: 'Style value — the text that gets prepended to your prompt (e.g. "Pixel art, neon red lighting, dramatic shadows")' });
    valInput.style.minHeight = '70px';
    const formHeader = el('h3', { style: 'margin: 14px 0 6px; font-size: 13px;' }, 'Add / edit style');
    m.appendChild(formHeader);
    m.appendChild(el('div', { class: 'row' }, [el('label', {}, 'Name'), nameInput]));
    m.appendChild(el('div', { class: 'row' }, [el('label', {}, 'Value (prepended to your prompt)'), valInput]));

    function editStyle(i, tabKey) {
      const s = (state.config.styles || [])[i];
      if (!s) return;
      editingIdx.value = i;
      nameInput.value = s.name;
      valInput.value = s.value;
      // jump to the right tab to remind the user which context
      if (tabKey && tabKey !== state.currentTab) showTab(tabKey);
      nameInput.focus();
    }
    function deleteStyle(i, after) {
      const styles = state.config.styles || [];
      if (i < 0 || i >= styles.length) return;
      const removed = styles.splice(i, 1)[0];
      persistStyles().then(() => { _refreshAllStyleDropdowns(); after && after(); toast(`Removed "${removed.name}".`, 'ok'); });
    }
    async function persistStyles() {
      state.config.styles = state.config.styles || [];
      await window.api.setConfig(state.config);
    }

    const saveBtn = el('button', { class: 'primary' }, 'Save style');
    const saveCurrentBtn = el('button', {}, 'Save current prompt as style…');
    const cancelBtn = el('button', { onclick: close }, 'Close');

    saveBtn.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      const value = valInput.value.trim();
      if (!name) { toast('Name is required.', 'warn'); return; }
      if (!value) { toast('Value is required.', 'warn'); return; }
      // Reject names that contain '=' — the config.txt format uses the first
      // '=' on each line to split name/value, so a name with '=' would
      // silently break the round-trip.
      if (name.includes('=')) {
        toast('Style name cannot contain "=" (would break config parsing).', 'err');
        return;
      }
      const styles = state.config.styles || [];
      if (editingIdx.value >= 0) styles[editingIdx.value] = { name, value };
      else {
        // de-dupe by name
        const existing = styles.findIndex((s) => s.name === name);
        if (existing >= 0) {
          if (!confirm(`A style named "${name}" already exists. Overwrite?`)) return;
          styles[existing] = { name, value };
        } else {
          styles.push({ name, value });
        }
      }
      editingIdx.value = -1;
      nameInput.value = '';
      valInput.value = '';
      await persistStyles();
      _refreshAllStyleDropdowns();
      renderList();
      toast('Style saved.', 'ok');
    });

    saveCurrentBtn.addEventListener('click', () => {
      const current = _currentManualText();
      if (!current) { toast('Current tab has no manual prompt text to save.', 'warn'); return; }
      // suggest a name from the first few words
      const suggested = current.split(/[,\.\n]/)[0].trim().slice(0, 40) || `Style ${Date.now()}`;
      nameInput.value = suggested;
      valInput.value = current;
      nameInput.focus();
      nameInput.select();
    });

    m.appendChild(el('div', { class: 'footer' }, [cancelBtn, saveCurrentBtn, saveBtn]));
  });
}


function slugifyLabel(s) {
  return String(s || '').toLowerCase().replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'field';
}

function scheduleStateSave() {
  // Bug-fix MEDIUM-1 (_temp5.md 360° audit): return a Promise that
  // resolves once the debounced saveAllStates actually completes.
  // Previously this returned `undefined`, so callers that did
  // `await scheduleStateSave()` (imageTab, section07, imageOverlays,
  // section15 — 6 sites) proceeded immediately, showing a "Saved."
  // toast before the disk write happened. Combined with the
  // before-quit race (H4, fixed separately) that meant a user who
  // tweaked a setting and closed the app could lose the change even
  // though the toast said "saved".
  //
  // Debounce coalescing: if a second call lands within the 500 ms
  // window, the first timer is cleared — but every caller's promise
  // must still resolve. We collect all pending resolvers and fire
  // them together when the single save completes.
  if (_suppressStateSave > 0) return Promise.resolve();
  clearTimeout(_stateSaveTimer);
  return new Promise((resolve) => {
    _pendingStateSaveResolvers.push(resolve);
    _stateSaveTimer = setTimeout(() => {
      _stateSaveTimer = null;
      try {
        const r = saveAllStates();
        if (r && typeof r.then === 'function') {
          r.then(_flushPendingStateSaveResolvers, _flushPendingStateSaveResolvers);
        } else {
          _flushPendingStateSaveResolvers();
        }
      } catch (_) {
        _flushPendingStateSaveResolvers();
      }
    }, 500);
  });
}

// Resolves all pending scheduleStateSave() callers. Called when the
// debounced saveAllStates completes (success or failure — callers
// don't need to know, they just need the save to have been attempted).
function _flushPendingStateSaveResolvers() {
  // Mutate-in-place clear (the array is const-declared, so we can't
  // reassign it — use .length = 0 instead of = []).
  const resolvers = _pendingStateSaveResolvers.slice();
  _pendingStateSaveResolvers.length = 0;
  for (const r of resolvers) {
    try { r(); } catch (_) { /* a caller's .then threw; don't let it block the others */ }
  }
}

// batch save state (used by scheduleStateSave)
let _suppressStateSave = 0;
let _stateSaveTimer = null;
const _pendingStateSaveResolvers = [];
// Run `fn` while the auto-save debounce is suppressed. Used by the
// BatchGen runner to overwrite the prompt / style / parameter inputs
// per item without overwriting the user's last-saved prompt in
// state.json. Increments _suppressStateSave before the call and
// decrements it after, even if `fn` throws, so a buggy batch item
// can't permanently lock the auto-save off.
function suppressStateSave(fn) {
  _suppressStateSave++;
  try { return fn(); }
  finally { _suppressStateSave--; }
}
window.suppressStateSave = suppressStateSave;
function saveAllStates() {
  for (const tabKey of ['image', 'speech', 'music', 'video']) {
    const root = $('#tab-' + tabKey);
    if (!root) continue;
    const data = state.tabSettings[tabKey] || (state.tabSettings[tabKey] = {});
    for (const inp of root.querySelectorAll('input[id], select[id], textarea[id]')) {
      data[inp.id] = inp.type === 'checkbox' ? (inp.checked ? 'on' : '') : inp.value;
    }
  }
  state.batches = state.batches || { image: [], speech: [], music: [], video: [] };
  if (window.api && typeof window.api.stateSet === 'function') {
    // Bug-fix #1+#2 (2026-06-19): build the snapshot from the
    // canonical STATE_PERSIST_KEYS list. Previously only 5 of ~18
    // keys were included, so every other persisted field silently
    // reset to its default on every autosave (filePrefix, sort
    // mode, optimise settings, popup dismissals, layout sizes,
    // …). The main process (src/state.js write()) already
    // deep-sanitizes every key on write, so the renderer can
    // round-trip the whole set safely.
    const snapshot = { tabs: state.tabSettings };
    const persistKeys = window.STATE_PERSIST_KEYS || [];
    for (const k of persistKeys) snapshot[k] = state[k];
    // Bug-fix MEDIUM-1 (_temp5.md 360° audit): return the stateSet
    // promise so callers that `await saveAllStates()` (and
    // scheduleStateSave below) actually wait for the IPC to finish.
    return window.api.stateSet(snapshot).catch(() => {});
  }
  return Promise.resolve();
}

// v1.1.15 (reported by user): the user reported that
// resizing the tool window takes a "few seconds" for
// the layout to settle. The main culprit is the
// file-browser list, which re-runs its CSS grid layout
// on every resize event (the grid-template-columns
// string has a `minmax(120px, 1fr)` column that needs
// to be re-measured against the new width). For
// folders with hundreds of items, the recalc +
// repaint can take a few seconds.
//
// The fix: a single, debounced resize handler that
// throttles the re-render to once per 100ms while the
// user is dragging, then runs a final pass 200ms after
// the last resize event (when the user has released
// the mouse). During the drag we DON'T re-render —
// the CSS handles the column re-flow natively on
// every frame, which is faster than a JS-driven
// re-render. We only re-render once at the END of the
// drag to make sure the scroll positions / selected
// row are still in sync (they shouldn't have moved, but
// this is cheap insurance).
let _resizeFrameId = null;
let _resizeEndTimer = null;
window.addEventListener('resize', () => {
  if (_resizeFrameId != null) {
    // Already scheduled; just reset the end timer.
    if (_resizeEndTimer) clearTimeout(_resizeEndTimer);
  } else {
    // Mark a frame request so we re-layout once per
    // animation frame instead of once per resize
    // event. (Chromium fires resize many times per
    // second during a drag; rAF coalesces them.)
    _resizeFrameId = requestAnimationFrame(() => {
      _resizeFrameId = null;
    });
  }
  _resizeEndTimer = setTimeout(() => {
    _resizeEndTimer = null;
    // Final re-render pass: re-apply the file-browser
    // grid template (so the new column widths line up
    // with the row's per-row grid-template-columns
    // style) and re-apply the prompt-character counter
    // (so it ticks if the user resized past a wrap
    // point). Both are cheap and only run on the
    // "real" end of the resize.
    try {
      if (typeof applyLayoutSettings === 'function' && window.SplitterDrag) {
        // The CSS variables are the source of truth;
        // re-applying the layout settings re-writes
        // them with the clamped values (which the
        // user might have changed during the resize
        // via a splitter drag).
        window.SplitterDrag.applyLayoutSettings();
      }
    } catch (_) { /* best-effort */ }
    // Re-apply the file-browser grid template so the
    // header / row column widths line up with the new
    // pane width.
    try {
      const ul = document.getElementById('fb-list');
      if (ul && typeof buildFbGridTemplate === 'function') {
        ul.style.gridTemplateColumns = buildFbGridTemplate();
        // Also re-apply per-row grid-template-columns
        // so the row contents line up with the new
        // column widths.
        for (const li of ul.querySelectorAll('.fb-item')) {
          li.style.gridTemplateColumns = buildFbGridTemplate();
        }
      }
    } catch (_) { /* best-effort */ }
  }, 200);
});

document.addEventListener('DOMContentLoaded', () => {
  init().catch((e) => {
    // v1.1.25: surface init failures in the log pane AND the
    // file log, not just a toast (which disappears after 8s).
    if (typeof window.logError === 'function') {
      window.logError('init', 'renderer/app.js:1715', e);
    } else {
      console.error(e);
    }
    toast(String(e), 'err', 8000);
  });
});

