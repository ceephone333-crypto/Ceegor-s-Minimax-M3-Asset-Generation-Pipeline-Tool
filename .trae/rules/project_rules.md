# Project Rules — MiniMax Asset Generation Pipeline Tool

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
