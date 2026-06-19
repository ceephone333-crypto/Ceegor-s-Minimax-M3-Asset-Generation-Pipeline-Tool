# Bug-Fix Plan — 360° Hunt Remediation

Status: **planning only — nothing implemented yet.**
Date: 2026-06-19
Scope: fixes for every finding from the bug-hunt sweep, ordered by severity.

## Ground rules for the implementation pass
- Renderer stays **build-free** (plain `<script>` globals, no bundler). No new runtime deps.
- No behaviour regressions: each fix keeps the existing happy path working.
- `npm test` must stay green; add tests where a fix is unit-testable.
- Atomic writes (`tmp` + `rename`) and the path allow-list model are preserved.
- One logical change per commit so each fix is revertable in isolation.

## Suggested sequencing
1. #1 + #2 (state round-trip) — highest impact, self-contained.
2. #6 (config-dir unification) — small, removes a storage split.
3. #4 (allow-list fallback) — small, unblocks first-run.
4. #5 (batch editor) — medium, extract + test helpers.
5. #3 (redirect decrement), #10 (PowerShell), #12 (symlink) — main-process hardening, add tests.
6. #8 (script case), #7 (test glob), #13 (CSP) — low-risk one-liners.
7. #14 (splitters) + #9 (dead code) — cleanup, do last so the state fixes above are settled.

---

## #1 — State autosave persists only 5 of ~18 fields  🔴 HIGH

**Root cause**
`saveAllStates()` ([renderer/app.js:481](renderer/app.js:481)) sends a hard-coded object with only
`{ tabs, currentTab, fbDirs, upscaleEnabled, upscaleSettings }`. `src/state.js write()` rebuilds the
file from scratch (no merge), so every omitted key is reset to its default on **every** autosave.
`init()` ([renderer/app.js:141-159](renderer/app.js:141)) also only loads that same subset back.
Net effect: `filePrefix`, `realesrganModel`, `realesrganFirstRunDismissed`, `removeBackgroundEnabled`,
`removeBackgroundUseGpu`, `optimizeSettings`, `layoutSettings`, `fbSort`, `fbColumns`, `fbThumbnails`,
`lastSeenVersion`, `popupPolicy`, `seenPopups` never survive a restart, even though ~12 call sites
mutate them and call `scheduleStateSave()` expecting persistence.

**Fix — single source of truth for persistent keys**
1. In `renderer/sections/section24_State.js` (where `window.state` is defined), add a canonical list
   constant that mirrors exactly the keys written by `src/state.js`:
   ```js
   // Keys persisted to state.json. MUST match the shape produced by src/state.js write().
   // `tabs` is special-cased (renderer holds it as state.tabSettings).
   window.STATE_PERSIST_KEYS = [
     'currentTab', 'fbDirs', 'filePrefix', 'realesrganModel', 'realesrganFirstRunDismissed',
     'upscaleEnabled', 'upscaleSettings', 'removeBackgroundEnabled', 'removeBackgroundUseGpu',
     'optimizeSettings', 'layoutSettings', 'fbSort', 'fbColumns', 'fbThumbnails',
     'lastSeenVersion', 'popupPolicy', 'seenPopups',
   ];
   ```
   Also add any missing default fields to `window.state` so reads aren't `undefined`
   (verify `lastSeenVersion` is declared — currently it is not; add `lastSeenVersion: ''`).
2. Rewrite `saveAllStates()` ([renderer/app.js:481-500](renderer/app.js:481)) to build the snapshot
   from that list plus the `tabs` remap:
   ```js
   const snapshot = { tabs: state.tabSettings };
   for (const k of window.STATE_PERSIST_KEYS) snapshot[k] = state[k];
   window.api.stateSet(snapshot).catch(() => {});
   ```
3. Rewrite the load block in `init()` to apply the same list:
   ```js
   state.tabSettings = savedState.tabs || {};
   for (const k of window.STATE_PERSIST_KEYS) {
     if (savedState[k] !== undefined && savedState[k] !== null) state[k] = savedState[k];
   }
   ```
   Keep the existing per-key string guard for `fbDirs` (a corrupted entry shouldn't replace the
   whole map) — apply `fbDirs` explicitly before/after the loop, or guard inside.
   `currentTab` whitelist check (`['image','speech','music','video']`) stays.

**Why this way:** the main process (`src/state.js`) already deep-sanitizes every field on write, so the
renderer can round-trip the whole set safely. Centralizing the key list prevents the exact drift that
caused this bug.

**Tests / verification**
- Add `tests/unit/src/state.test.js` (new): write a fully-populated object, read it back, assert all
  fields round-trip (this guards the main-side contract the renderer now relies on).
- Manual: set a file prefix + folder sort + optimize toggle, type in a prompt (triggers autosave),
  restart → all retained. Dismiss a startup popup → stays dismissed next launch.

**Risk:** low. Larger snapshot per save, negligible. Watch the `tabs` vs `tabSettings` naming.

---

## #2 — Crop fields dropped from upscaleSettings on load  🔴 HIGH

**Root cause** [renderer/app.js:149-151](renderer/app.js:149) collapses the saved object to
`{ multiplier }`, discarding `autoCrop`, `cropWidth`, `cropHeight`, `cropAnchorX/Y`.

**Fix** Folded into #1: assign the whole object (`state.upscaleSettings = savedState.upscaleSettings`)
via the generic loop. Delete the special-case lines 148-151. `src/state.js` already clamps/whitelists
all crop sub-fields on write, so the loaded object is safe to use verbatim.

**Verification:** set auto-crop W×H + anchor in ⚙ Upscale Settings, restart, confirm a generate still
crops with the saved values.

---

## #3 — Redirect-loop guard is dead code  🟠 MEDIUM

**Root cause** [main/services/HttpsRedirect.js:21-37](main/services/HttpsRedirect.js:21):
`maxRedirects` is closed over but never decremented, so `maxRedirects <= 0` is never true.

**Fix** Thread a `remaining` counter through the recursion:
```js
function get(target, remaining) {
  https.get(target, (res) => {
    if (REDIRECT_CODES.has(res.statusCode)) {
      const next = res.headers.location;
      res.resume();
      if (!next || remaining <= 0) return reject(new Error('Too many redirects'));
      get(new URL(next, target).toString(), remaining - 1);
      return;
    }
    resolve(res);
  }).on('error', reject);
}
get(url, maxRedirects);
```

**Tests / verification**
- Add `tests/unit/main/services/HttpsRedirect.test.js`: spin up two local `http` servers that 302 to
  each other and assert the helper rejects with “Too many redirects”. To make this testable without
  TLS, optionally parameterize the transport (`{ get = https.get } = {}`) — small DI seam, keeps prod
  behaviour identical. If DI is deemed over-engineering, cover it with an `http`-based manual check and
  document it.

**Risk:** none for the real (fixed GitHub→S3) download path.

---

## #4 — Blank output_dir → generated files unbrowsable  🟠 MEDIUM

**Root cause** When `output_dir` is empty (user skipped first-run setup), the renderer fabricates a
default `./generated` in memory only ([renderer/app.js:171-172](renderer/app.js:171)), but
`getAllowedRoots()` only pushes `cfg.output_dir` when truthy
([main/services/PathSecurityService.js:21-27](main/services/PathSecurityService.js:21)). All `fb:*`,
`image:optimize`, `upscale`, `audio` IPC on generated files are then rejected.

**Fix** Make the allow-list use the **effective** output dir (which already encodes the same default):
```js
function getAllowedRoots() {
  const cfg = cfgMod.read();
  const roots = [cfgMod.effectiveOutputDir(cfg)]; // configured dir, or <configDir>/generated
  for (const p of trustedPickPaths) roots.push(p);
  return roots;
}
```
`effectiveOutputDir` ([src/config.js:137](src/config.js:137)) returns `path.join(configDir(),
'generated')` when unset — identical to the renderer’s computed default.

Optionally, ensure the dir exists at startup (`fs.mkdirSync(effectiveOutputDir(cfg), { recursive:true })`
in the app-ready hook) so the very first `fb:list` doesn’t ENOENT before any generation.

**Tests / verification**
- Extend the (new) PathSecurityService coverage or add a focused test: with `output_dir=''`, assert
  `getAllowedRoots()` includes `<configDir>/generated` and `isPathUnderAny('<configDir>/generated/x.png')`
  is true.
- Manual: fresh profile, skip setup, generate an image, confirm it appears in the browser and
  upscale/optimize work.

**Risk:** low — slightly widens the allow-list to a directory the app already writes to by design.

---

## #5 — Batch editor corrupts imported (object) entries  🟠 MEDIUM

**Root cause** Imported rows are objects `{ prompt, ...params }`
([batchImportHelper.js:214,227](renderer/tabs/batchImportHelper.js:214)), but
`openBatchManager` renders each entry directly into a textarea and stringifies on save
([batchManager.js:29](renderer/tabs/batchManager.js:29), [:75](renderer/tabs/batchManager.js:75)),
turning objects into the literal `"[object Object]"` and dropping their params.

**Fix — make the editor object-aware (extract pure helpers, then test them)**
1. Add two pure helpers (in `batchImportHelper.js` or a small `batchEntry.js`), exported on `window`:
   ```js
   function batchEntryText(entry) {
     return typeof entry === 'string' ? entry : String((entry && entry.prompt) || '');
   }
   function withBatchEntryText(entry, text) {
     if (typeof entry === 'string') return text;
     return { ...entry, prompt: text };   // preserve params
   }
   ```
2. In `renderList()` use `batchEntryText(entry)` for the textarea content; on `input` do
   `current[i] = withBatchEntryText(current[i], ta.value)`.
3. In Save, map with the helper and filter on the extracted text:
   ```js
   const cleaned = current
     .map((e) => withBatchEntryText(e, batchEntryText(e).trim()))
     .filter((e) => batchEntryText(e).length > 0)
     .slice(0, 100);
   ```
4. (UX nicety, optional) show a small “+params” badge on rows whose entry is an object so the user
   knows settings are attached.

**Tests / verification**
- Add cases to `tests/unit/renderer/tabs/batchImportHelper.test.js` for `batchEntryText` /
  `withBatchEntryText` (string and object shapes, params preserved).
- Manual: import a `.md` batch with params, open the editor, reorder + edit a prompt, save, run —
  params must still apply.

**Risk:** low; reorder/delete already operate on whole entries.

---

## #6 — state.json / batches.json ignore MINIMAX_CONFIG_DIR  🟠 MEDIUM

**Root cause** `src/config.js` honours the `MINIMAX_CONFIG_DIR` override and an exe/cwd fallback chain
([src/config.js:7-16](src/config.js:7)), but `src/state.js` ([:8](src/state.js:8)) and
`src/batches.js` ([:7](src/batches.js:7)) independently use `app.getPath('exe')` only — so with the
override set, config lives in one place and state/batches in another.

**Fix — one directory resolver**
1. Export `configDir` from `src/config.js` (`module.exports = { ..., configDir }`).
2. `src/state.js` `statePath()` → `path.join(require('./config').configDir(), 'state.json')`.
3. `src/batches.js` `batchesPath()` → `path.join(require('./config').configDir(), 'batches.json')`.
   Drop the now-redundant local `try/catch app.getPath('exe')` blocks.

No require cycle: `config.js` does not depend on `state.js`/`batches.js`.

**Tests / verification**
- Unit: set `process.env.MINIMAX_CONFIG_DIR` to a temp dir, assert `statePath()` and `batchesPath()`
  resolve under it (mirror the existing config tests).
- Manual: launch with `MINIMAX_CONFIG_DIR` set; confirm all three files land together.

**Risk:** low. Note: existing users who relied on the exe-dir location will get fresh state/batches if
they’ve been using the override (acceptable; the override is advanced/launcher-only).

---

## #7 — `npm test` glob is environment-fragile  🟡 LOW

**Root cause** [package.json:13](package.json:13) `node --test tests/unit/**/*.test.js` relies on
shell/Node glob expansion that only works on Node ≥21 (or a globstar-enabled shell); on the documented
minimum (Node 18/20) most tests silently don’t run.

**Fix** Pass a **directory** (Node’s test runner recurses and matches the `*.test.js` convention on
18+):
```json
"test": "node --test tests/unit"
```
Also declare the floor explicitly:
```json
"engines": { "node": ">=18" }
```

**Verification** Run on Node 18/20/25 (or at least confirm count = 77 via `npm test`).

**Risk:** none.

---

## #8 — Case-mismatched script include  🟡 LOW

**Root cause** [renderer/index.html:109](renderer/index.html:109) loads `services/logService.js`
(lowercase) but the tracked file is `renderer/services/LogService.js` (capital). Works only on
case-insensitive Windows; on a case-sensitive FS the **entire log pane** (`addLogEvent`, `log`, …)
fails to load and `bootstrap.js`’s `LogService.init()` throws.

**Fix** Make the include match the tracked filename:
```html
<script src="services/LogService.js"></script>
```
Update the file’s own header comment (`// renderer/services/logService.js`) to the capitalized name for
consistency. Grep the rest of `index.html` for any other case drift (none found, but confirm).

**Verification** `git ls-files | grep -i logservice` to confirm canonical casing; load the app.

**Risk:** none on Windows; fixes portability/CI.

---

## #9 — Dead / half-wired parallel state system  🟡 LOW (cleanup)

**Findings (verified no live consumers)**
- `main/index.js:49` imports `voicesCache` but never uses it.
- `VoicesCacheService.reset()` is never called on `config:set` (the documented contract).
- `renderer/state/StatePersister.js` is never invoked (only `ThemeService.toggle` would call it, and
  `ThemeService.toggle` itself is never called — the live theme button uses `app.js toggleTheme`).
- `EventBus` / `MmxService` / `ThemeService` emissions have **no subscribers**:
  `MmxService.attachLogStream()` emits `mmx:log` to a bus nobody listens on; the real log pane is fed by
  `app.js`’s `window.api.onLog`. `MmxService.run/cancel` are unused (app calls `window.api` directly).
- `bootstrap.js` loads persisted state into `window.AppState`, which the app never reads (it uses
  `window.state`).

**Fix — collapse to one owner (`window.state`), keep what’s genuinely used**
1. `main/index.js`: delete the unused `voicesCache` require (line 49).
2. `main/ipc/registerConfigIpc.js`: import `VoicesCacheService` and call `voicesCache.reset()` inside
   `config:set` after a successful write (so a key change invalidates cached voices — correctness, cheap).
3. Delete `renderer/state/StatePersister.js` and its `<script>` include
   ([index.html:101](renderer/index.html:101)) — it is the footgun that *looks* like it persists
   everything but never runs.
4. Trim `bootstrap.js` to the one live job (version stamp `#brand-version`). Remove the
   `AppState` state-load block and the `MmxService.attachLogStream()` call. Theme is owned by
   `app.js init()` (`applyTheme(config.theme)`); to avoid a dark→light FOUC for light-theme users,
   leave `<html data-theme="dark">` as the pre-paint default (matches `backgroundColor`).
5. With bootstrap no longer calling them, `AppState.js`, `ThemeService.js`, `MmxService.js` become
   fully unused. **Either** remove the three files + their includes (preferred — less confusion),
   **or** keep `AppState.js` only and delete the other two. `EventBus.js` has a passing unit test;
   keep it (and its test) or remove file+test together — do not orphan the test.

   > Before deleting each file, re-grep for `Window.<Name>`/`<Name>.` usage to confirm zero live
   > references (do this at implementation time, not from memory).

**Tests / verification**
- `npm test` still green (adjust/keep `EventBus.test.js` consistently with the keep/remove decision).
- Manual: app boots, version chip shows, logs stream, theme applies, voices refresh after a key change.

**Risk:** low if the pre-deletion grep is honoured. This is the only item that removes files — do it last.

---

## #10 — PowerShell `Expand-Archive` built via string interpolation  🟡 LOW (hardening)

**Root cause** [main/utils/PowerShellSpawner.js:23](main/utils/PowerShellSpawner.js:23) interpolates
paths into the `-Command` string. Today both paths are app-controlled (`os.tmpdir()` zip + `appRoot/bin`),
so it’s not exploitable, but a `"`/backtick in either path would break or inject.

**Fix — pass paths as environment variables, reference them in the command (no interpolation):**
```js
const ps = spawn('powershell.exe', [
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
  'Expand-Archive -Path $env:MMX_SRC_ZIP -DestinationPath $env:MMX_DEST_DIR -Force',
], { windowsHide: true, env: { ...process.env, MMX_SRC_ZIP: zipPath, MMX_DEST_DIR: destDir } });
```
PowerShell expands `$env:…` to the exact string with no quoting hazards. No new deps; behaviour identical.

**Verification** Trigger the one-click Real-ESRGAN download/extract; confirm `./bin/` is populated.
Optionally test with a temp dir containing a space and a quote in the path.

**Risk:** none.

---

## #11 — subject-ref validation key  ✅ VERIFIED, NO ACTION

Re-examined: `renderer/specs/modelSpecs.js` uses `--subject-reference-file` as the spec key, which is
exactly what `imageTab.js` passes to the validator. The differing `--subject-ref` is the correct **CLI
flag** built into argv. Both are internally consistent — the original report over-flagged this. No change.

---

## #12 — Symlink traversal not closed  🟡 LOW (hardening)

**Root cause** `src/pathUtils.js` validates with `path.resolve` (`normalize`) but never `realpath`, so a
symlink placed *inside* an allowed root that points outside is followable. `realIfExists()` exists but is
unused. (The header comment already scopes hardlinks out; symlinks are closeable.)

**Fix — make the under-root check realpath-aware**
In `isPathUnder` ([src/pathUtils.js:49](src/pathUtils.js:49)), after `normalize`, resolve symlinks for
existing paths before comparison:
```js
function isPathUnder(p, root) {
  const pNorm = normalize(p), rNorm = normalize(root);
  if (!pNorm || !rNorm) return false;
  const pLow = canon(realIfExists(pNorm));   // resolves symlinks when the path exists
  const rLow = canon(realIfExists(rNorm));
  return pLow === rLow || pLow.startsWith(rLow + path.sep);
}
```
For write targets that don’t exist yet (`fb:write`, `audio:cut` dst), `isParentUnderAny` already checks
`dirname`, which **does** exist and will be realpath-resolved — closing the symlinked-parent case.
`realIfExists` falls back to the normalized path when realpath throws, so non-existent leaves still work.

**Tests / verification**
- Add `tests/unit/src/pathUtils.test.js` (new): cover (a) plain under-root true, (b) `..` traversal
  false, (c) a symlink inside the root pointing outside → false, (d) write-target whose parent is the
  root → `isParentUnderAny` true. Use `fs.symlinkSync` in a temp dir; skip the symlink case gracefully
  on platforms where symlink creation is denied (Windows without privilege).

**Risk:** low. `realpathSync` per validated path is cheap at our call volumes; Windows long-path/casing
is absorbed by `canon` (lowercase). Verify normal generate/browse flows still pass after the change.

---

## #13 — CSP `connect-src https:` broader than needed  🟡 LOW (hardening)

**Root cause** [renderer/index.html:5](renderer/index.html:5) allows `connect-src 'self' https:`, but the
renderer makes **no** direct network calls — everything goes through IPC to the main process / mmx CLI.

**Fix** Tighten to `connect-src 'self';`. Keep `img-src 'self' data: blob:` and `media-src` as-is
(already exclude remote).

**Verification** After the change, exercise: image/speech/music/video generate, voices fetch, quota,
file preview, audio waveform. If anything legitimately needs a remote origin (none expected), revert
just this token. Watch the devtools console for CSP violations.

**Risk:** low; revertable single token.

---

## #14 — Resizable splitters are unimplemented (NEW)  🟠 MEDIUM

**Root cause** `index.html` renders three `[data-splitter]` bars and the help text + `state.layoutSettings`
+ CSS advertise drag-to-resize panes “remembered for next launch”, but **no JS attaches any drag handler
to `[data-splitter]`** (grep confirms: only `CropFrameDrag` binds mousedown, for the crop frame). So the
bars do nothing and `layoutSettings` is dead. (Surfaced while planning the #1 layout persistence.)

**Fix — implement the feature (preferred), now that #1 persists `layoutSettings`:**
1. New `renderer/components/SplitterDrag.js` (loaded before `app.js`): on `mousedown` of each
   `[data-splitter]`, track pointer delta, clamp to the same min/max the CSS uses, and write the CSS
   custom properties that `styles.css` reads for sidebar width / logbar height / preview width. On
   `mouseup`, store into `state.layoutSettings.{sidebarW,logbarH,previewW}` and call `scheduleStateSave()`.
2. Add `applyLayoutSettings()` (call from `init()` after state load) that seeds the CSS variables from
   `state.layoutSettings`, mirroring the `:root` defaults. Recompute `previewW` default to ~half the row
   if unset, per the section24 comment.
3. Confirm the CSS variable names by reading `styles.css` (the `:root` block around lines 433 / 1145).

**Fallback (if implementing is out of scope for this pass):** remove the dead `layoutSettings` field
from `src/state.js` + `window.state` + `STATE_PERSIST_KEYS`, delete the `layout.splitter` help entry and
the “remembered for next launch” wording so the UI stops advertising a non-feature.

**Recommendation:** implement (1–3); the CSS + state plumbing already exist, only the handler is missing.

**Tests / verification**
- Manual: drag each splitter, confirm panes resize and clamp; restart → sizes restored.
- Unit (optional): extract the clamp math into a pure function and test min/max bounds.

**Risk:** medium (new interactive code). Keep it isolated in its own file/commit so it can be reverted
without touching the state fixes.

---

## Post-implementation checklist
- [ ] `npm test` green (with new tests for #1, #3, #5, #6, #12).
- [ ] `npm run lint` shows no new hard violations.
- [ ] Manual smoke: fresh profile → first-run skip → generate → browse/upscale/optimize work (#4).
- [ ] Settings round-trip across restart: prefix, sort, columns, optimize, bg, model, popups (#1/#2).
- [ ] Import batch w/ params → edit → run; params survive (#5).
- [ ] Real-ESRGAN one-click download/extract still works (#3/#10).
- [ ] Splitters drag + persist, or dead references removed (#14).
- [ ] Grep confirms removed dead modules have zero references (#9).
