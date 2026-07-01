# Changelog

## 1.1.4 — 2026-07-01

User-requested feature release: output-folder auto-navigation in the file
explorer, and a combined "style preset + batch import" flow. Verified end-to-end
with 26 new unit tests (7 source-pinned structural + 6 adversarial + 13
behavioural side-effect audits) on top of the existing 602-test suite.

### Added

- **Output-folder change auto-navigates the file browser.** When the user
  changes `output_dir` in ⚙ Settings (or in the first-time-setup popup), the
  file browser now re-points to the new folder instead of just refreshing
  in place. Every per-tab saved folder is also updated, so a tab switch
  after the change lands on the new location too. When the user blanks
  the field to use the platform default (`%APPDATA%\MiniMaxAssetTool
  \generated` on Windows), the explorer follows the new effective
  location instead of staying on the old folder.

- **Batch-import + style preset, combined.** The batch-import summary
  modal now has an "Apply a style preset to all items in this batch"
  section (checkbox + name + value). When enabled:
  - The preset is added to the global style list (`config.styles`,
    de-duped by name) and persisted to `config.txt`, so it survives a
    restart and shows in every tab's style dropdown.
  - Every imported entry is stamped with `style: <name>`, which the
    existing BatchGen runner (`batchManager.js` `item.style` handling)
    picks up to pre-select the dropdown and prepend the value via
    `buildFinalPrompt` when the row generates. No more re-typing the
    same style hint on every prompt.

  The feature is opt-in: a user who just wants the prompts can leave
  the checkbox off and the import is unchanged from v1.1.3.

### Verified

- Full unit suite: 628 / 628 green (26 new tests for the features above).
- Lint clean.
- Renderer no-node-globals check clean.

## 1.1.3 — 2026-07-01

Bug-fix release addressing three user-reported issues in BatchGen import and the
folder-explorer image pipeline. Every fix was verified end-to-end in the real
renderer (booted headless with live IPC), not just by unit tests.

### Fixed

- **Imported BatchGen requests ignored `--n` — and, in fact, every other
  per-row parameter.** A row imported from a `.md`/`.txt` document such as
  `image | a red apple | --n 3` only ever generated **one** image. Root cause:
  the batch runner maps each imported flag to its tab input by the parameter
  label, but the label text was read *including* the injected help-button "?",
  so every derived key came out as `n?` / `width?` / … and never matched the
  clean key (`n`) parsed from the row. The help button is now stripped before
  the key is derived, so `--n`, `--aspect-ratio`, `--width`, `--seed`,
  `--response-format`, etc. all apply. Verified: an imported `--n 2` now
  forwards `--n 2 --out-dir …` to the backend.
- **Right-click image-pipeline actions only processed one image when several
  were checked.** Checking three images in the folder explorer and choosing
  Upscale (or Crop / Convert / Optimize / Remove background) processed only the
  right-clicked image. The context menu is now multi-select-aware: when the
  right-clicked image is part of a ≥2-image checkbox selection, the action's
  dialog collects its settings once and applies them to **every** checked image
  (sequential run with a progress line + summary). Buttons relabel accordingly
  ("Upscale 3 images…"). Single-image behaviour, and the preview-pane / audio
  context menus, are unchanged.
- **The image tab had no model selector, and imported `--model` was ignored.**
  The `--model` row (image-01 / image-01-live) was built but never mounted in
  the DOM, so it neither appeared in the UI nor received an imported `--model`
  value. It is now mounted at the top of the Parameters grid.

## 1.1.2 — 2026-06-26

Bug-fix release. Closes the multi-image generation defect and three issues found
in a follow-up adversarial audit (see the verification notes for reproducers).

### Fixed

- **Image Count (`--n`) > 1 reported "Generation failed" even though every image
  succeeded.** Multi-image runs wrote all images to disk, but the UI showed a
  fabricated *"mmx exited with code -1 (silent) … reduce --n"* error — no preview,
  no folder refresh, and the quota counter under-counted the run. The
  success / preview / post-process path now keys off a per-variant success counter
  instead of a file list that was structurally empty for `--out-dir` (multi-image)
  runs.
- **Image-optimiser "fastest" effort settings were silently ignored.** Selecting
  WebP or AVIF encode effort `0` (or PNG compression level `0`) — the fastest
  setting — silently applied the *slowest* setting instead, due to a falsy-fallback
  (`x || default`) in the encoder. Effort `0` is now honoured.
- **Real-ESRGAN advanced settings offered values the tool then rejected.** A custom
  tile size below 32 made the upscaler fail with *"invalid tilesize argument"* and
  silently downgraded every upscale to the built-in canvas pipeline; tile sizes
  above 2048 and GPU ids above 3 — both explicitly suggested by the overlay's own
  help text — were silently discarded. The accepted ranges are now consistent end
  to end: tile size `0` (auto) or `32–4096`, GPU id `0–15`.
- **Cancelling a multi-image run lost its output list.** A cancelled `--n > 1` run
  that had already written files recorded zero outputs in the job history /
  recent-jobs panel; it now records the files it actually produced.

### Verification

- Full unit suite: 602 / 602 green (9 new regression tests for the fixes above).
- Headless renderer smoke harness: pass, 0 console / main-process errors.
- Live `--n = 2` generation through the real renderer + API: 2 images written, UI
  reports success.
- Real Real-ESRGAN binary: a sub-32 tile size now resolves to auto and succeeds.
