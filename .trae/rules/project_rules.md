# Project Rules — MiniMax Asset Generation Pipeline Tool

## ⚠️ AI WORKING ON THIS PROJECT — READ THIS FIRST  ⚠️

You keep making the **same three mistakes**, and they are why bugs "come back"
even after you mark them fixed. Read this before you touch renderer code or
claim anything works. (Source: _temp9.md — the audit that finally pinned this
down after the 9th "why is the Up button still broken?" round.)

### Mistake 1 — You trust green unit tests and your own "fixed" claim instead of running the app.

`node --test` passing proves *nothing* about the renderer. The renderer is
build-free vanilla JS loaded into one browser global scope; most bugs only
fire when a real DOM event handler runs (a button click, a tab build). A
green suite + a confident commit message is the exact state the app is in
*while a core button is dead.* **Never write "fixed" unless you executed the
real renderer and watched the behaviour change.** To execute it: boot the
headless renderer (`scripts/smoke-renderer.js` via `npm run test:smoke`, or
extend `scripts/smoke-eval.js` with an `EVAL=…` snippet), click the actual
element, and read back the state you claim changed.

### Mistake 2 — Your renderer tests fake browser globals, which hides real `ReferenceError`s.

Several vm-sandbox tests inject things the real renderer does NOT have — e.g.
`tests/unit/renderer/fbUpButtonBehavior.test.js` used to set
`process: { platform: 'win32' }` in its sandbox. So code that says
`process.platform` runs fine in the test and **throws `ReferenceError: process
is not defined` in the real app.** When you add a renderer test, do NOT add
`process`, `require`, `module`, `Buffer`, `__dirname`, or `global` to the
sandbox to "make it pass." If the test needs them, the code under test is
wrong — that is the bug, not the test setup. (A dedicated
`process`-absent test now lives in `fbUpButtonBehavior.test.js` so a future
regression of this exact bug is caught.)

### Mistake 3 — You write Node code in the renderer.

The renderer is a browser (`contextIsolation: true`, `nodeIntegration: false`).
These do **not exist** there and throw the instant the line runs: `process`,
`require()`, `__dirname`, `__filename`, `Buffer`, `global`, `fs`, `path`.
Anything the renderer needs from Node must go through `window.api.*` (the
preload bridge). Platform detection in the renderer: use a path-shape regex
(`/^[A-Za-z]:[\\\/]?$/.test(p) || p === '/'`) or expose `platform` via the
preload — never `process.platform`.

### Mechanical checklist you must run every time (no diagnosis skill required)

1. `node scripts/check-renderer-no-node-globals.js`
   → must print `OK`. Every hit is a latent white-screen / dead handler.
2. For any UI fix, boot the real renderer and **click the thing**; assert
   the observable state (`state.fbDir`, a toast, a new DOM node) actually
   changed. If you can't observe the change, you did not fix it.
3. Before telling the user it's fixed, run `node scripts/sync-stable-asar.js`
   and confirm the asar version matches `package.json` (extract `package.json`
   from `dist-stable/win-unpacked/resources/app.asar` and check
   `version`). If the user launches `dist-stable`, an un-synced asar means
   they never receive your fix — which looks identical to "the bug is
   still there." (See the "Fresh-version Folder" section below.)
4. Do not delete or rewrite a passing test to make red turn green. A red
   test that mirrors real renderer behaviour is telling you the truth; a
   green test that injects fake globals is lying.

**Bottom line:** the renderer is a browser, your tests sometimes pretend
it's Node, and the user runs a packaged build you forgot to rebuild. Those
three together are the whole pattern. Verify in the running app, keep Node
out of the renderer, and re-sync the asar — and the "unfixable" bugs stop
recurring.

## Fresh-version Folder (MANDATORY for every agent)

The user has exactly ONE folder they use to start the most recent version.
**Always keep it up to date after every source change, and always post the
full path + .exe filename in your reply.**

### Path
```
C:\Projects\Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool\dist-stable\win-unpacked\MiniMaxAssetTool.exe
```

### Required workflow after every source change

```bash
# 1. Commit your changes (lint + tests run via pre-commit hook).
git add -A .
git commit -m "..."

# 2. Sync the asar inside dist-stable/ with the new source so the user
#    can immediately run the latest code without a full electron-builder
#    pass (which needs Win32 Developer Mode + admin privileges).
node scripts/sync-stable-asar.js

# 3. In your reply to the user, ALWAYS include this line:
#
#    Vollständiger Pfad: C:\Projects\Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool\dist-stable\win-unpacked\MiniMaxAssetTool.exe
#
#    so they know which exe to launch.
```

### Re-create from scratch

If `dist-stable/` is ever deleted, recreate it from the latest production
zip + sync the asar:

```powershell
mkdir dist-stable
Expand-Archive -Path 'dist\MiniMaxAssetTool-1.1.1-x64.zip' -DestinationPath 'dist-stable' -Force
node scripts/sync-stable-asar.js
```

The zip at `dist/MiniMaxAssetTool-1.1.1-x64.zip` is committed in every
release commit, so this recipe always works after a `git pull`.

### Why this folder?

- The `.exe` here has a **stable SHA256** (`1b384ee8ea56e1a18ed0e11626fe2da8c05efda2aab44085b0576e23c6811871`).
  Windows SmartScreen / Defender flag it only the FIRST time; subsequent
  launches run clean. Rebuilding the exe every time would change the
  hash and re-trigger the SmartScreen prompt.
- The `app.asar` next to it holds the renderer + main source. We re-pack
  it from the latest source via `scripts/sync-stable-asar.js`. No
  electron-builder pass needed → fast, no admin needed.
- The user only has to remember one path.

See [HANDOFF.md](../../HANDOFF.md) for the full background and history.

## Pre-commit hooks (do not skip)

The pre-commit hook runs:
- `scripts/lint.js` (file-size + structural checks; warnings OK, errors fail)
- `scripts/check.js` (asset presence in `./bin/`)
- `npm test` (77 unit tests)

If lint complains about new size warnings, that's fine. Errors fail the commit.
If tests fail, fix them — don't `--no-verify`.

## Don't touch without asking

- `package.json` `version`, `productName`, `appId` — these are tied to
  release tags.
- `dist/MiniMaxAssetTool-*.zip` — the user commits these for releases;
  rebuild via `node scripts/zip-portable.js` (needs Developer Mode + admin)
  or `npm run build`.
- The stable `.exe` in `dist-stable/win-unpacked/MiniMaxAssetTool.exe` —
  its SHA256 must stay `1b384ee8…`. If electron-builder rebuilds it, copy
  the OLD `.exe` back to preserve the hash.
