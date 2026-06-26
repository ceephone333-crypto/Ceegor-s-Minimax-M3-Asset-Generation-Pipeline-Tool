# Changelog

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
