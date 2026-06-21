# Multi-Job Generation + Redesigned Log — Implementation Plan (Phase A / B / C)

**Goal.** Let multiple generations run in parallel across asset types (image, speech, music, video) and post-processing tasks (upscale, optimize, IS-Net background removal), while the new log gives a clear, single-line, color-coded overview of every job with expand/collapse, multi-select copy, jump-to-top/bottom, and collapse-all/expand-all.

**Scope.** Renderer-side state + UI refactor, log model rewrite, mmx runner + IPC adjustment, and crash-safe state persistence. No backend API changes. No package upgrades.

**Non-goals.**
- Not building a real-time progress stream from the mmx CLI (mmx does not currently emit progress). The "..." animation is a deterministic time-based spinner, not a byte counter.
- Not changing the upstream MMX contract.
- Not migrating to a build step / framework. Renderer stays vanilla + global scripts.

**Environment.** Windows-only desktop tool. We do **not** need to support `Cmd` as a modifier key on macOS — `Ctrl` is the multi-select modifier on every platform this tool runs on.

---

## 0. Current state audit (what we are replacing)

| Area | Today | Risk if left as-is |
|---|---|---|
| `state.generating` ([src/state.js](file:///C:/Projects/Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool/src/state.js)) | Single string per app; one slot across all tabs | Tab B blocks while tab A runs |
| `armGenBtnWithCancel` ([renderer/app.js](file:///C:/Projects/Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool/renderer/app.js)) | Disables generate button on its tab, single `currentGenProc` in [src/mmx.js](file:///C:/Projects/Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool/src/mmx.js) | Cancel-kills everything |
| Log events | [LogService.js](file:///C:/Projects/Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool/renderer/services/LogService.js) renders one row per `addLogEvent`; `LOG_MAX_EVENTS` is global | A 20-image batch floods the log and pushes other tabs off the buffer |
| mmx log stream | `window.api.onLog(line)` in [renderer/app.js](file:///C:/Projects/Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool/renderer/app.js) calls `log(line)` (one row per stderr chunk) | Same flooding; no way to know which job a line belongs to |
| Log colour coding | Category + result tint on the row; `groupId` adds 12-cycle hue in [LogService.js](file:///C:/Projects/Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool/renderer/services/LogService.js) | 12 stripes cycle; long sessions look like confetti |
| Selection / copy | Ctrl+click adds, Shift+click range, click replaces, copy of all-or-selected via [LogService.js](file:///C:/Projects/Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool/renderer/services/LogService.js) | Works but: no jump-to-top/bottom, no collapse-all/expand-all, "selected" shows only one line color, copy is the whole row including raw stderr |
| `state` persistence | `scheduleStateSave` debounced; per-form keys whitelisted in [src/state.js](file:///C:/Projects/Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool/src/state.js) | Job IDs not persisted → no resumability after crash |

**Decision principle.** Treat the log as the *primary* status surface for multi-job mode. Every job has exactly **one** primary log line, plus N secondary lines (stderr chunks, progress, warnings) that are folded into the expanded view. This makes the plan's UI changes real and the existing floods stop.

---

## 1. Storage tiers (L1 / L2 / L3)

History is split across three tiers, each with its own storage and lifetime. The hot list the user actually sees stays small; the archive is never the bottleneck.

| Tier | Storage | Default size | Loaded on | Purpose |
|---|---|---|---|---|
| **L1 — Live (this session)** | `state._logEvents` in memory | bounded by the existing `LOG_MAX_EVENTS` in [LogService.js](file:///C:/Projects/Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool/renderer/services/LogService.js) | always | The thing the user is actively watching while jobs run. |
| **L2 — Recent (across sessions)** | `state.jobs.snapshot` inside `state.json` | last **200** finished jobs (user-configurable, range `[20, 1000]`) | every launch | The `↻` summary footer. Cheap to render, always present. |
| **L3 — Archive (older)** | append-only `state.jobs.archive.jsonl` next to `state.json` (JSON Lines) | unbounded, but **only loaded on demand** | only when the user opens the "History" panel | Long-term reference; user can search / filter / delete / clear. |

**Why 200 by default.** 200 entries × ~200 B ≈ 40 KB on disk. A power user running five 30-image batches + a few music/speech jobs in one day stays comfortably under 200. The number is a default, not a hard cap, and there is **no "indefinite" option** — the archive (L3) is the indefinite part. A user who wants more visible history either raises the L2 cap or opens the archive.

**Move policy.** On every state save, jobs older than the L2 cap (FIFO by `finishedAt`) are moved from L2 into L3. Move, not copy: the L2 list shrinks, the archive grows. The move is implemented as `slice(-cap)` on L2 (existing pattern from `seenPopups` in [src/state.js](file:///C:/Projects/Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool/src/state.js)) followed by a single `fs.appendFileSync` for the trimmed entries.

**Archive file format.** `state.jobs.archive.jsonl`, one job per line, append-only. A partial final line (process killed mid-write) is re-trimmed on the next save. We do **not** use the temp-file + rename pattern for the archive — that would defeat the append-only simplicity and the gain is zero for a stream of small appends.

**Archive access.** The archive file is **never** read at launch. It is read only when the user opens a new "History" panel in the log footer (a small button next to the `↻` summary: **Open archive**). The panel reads the file lazily, in chunks of 100 lines, and shows a virtualised list (a 200-line DOM window over an N-line in-memory buffer). Scrolling near the bottom triggers the next chunk read — the "only load if the user scrolls that far down" pattern, applied at the file level rather than the DOM level, which is simpler to reason about.

**Archive operations.** A `Delete` button on each row removes a single entry (rewrites the file without that line, atomically); a **Clear archive** button in ⚙ Settings empties the whole file.

**Settings fields added (Phase C).**
- `state.config.lastFinishedCap` — number, default `200`, range `[20, 1000]`. Clamped in [src/state.js](file:///C:/Projects/Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool/src/state.js) so a corrupted write can't sneak a `0` or a `99999` through.
- A `Clear archive` button in ⚙ Settings → History. One click, confirm dialog, empties L3.

---

## 2. New data model

### 2.1 Jobs (renderer state)

```js
// state.jobs
//   Map<jobId, Job>   (insertion order = display order; insertion is FIFO)
//
// Job = {
//   id:              string  // stable across restarts: `${type}-${n}` per session,
//                              // globally-unique enough within a session.
//   type:            'image' | 'speech' | 'music' | 'video' | 'upscale' | 'optimize' | 'isnetbg'
//   tab:             'image' | 'speech' | 'music' | 'video' | null  // source tab
//   parentJobId:     string | null   // upscale/optimize/isnetbg link to a generation job
//   title:           string          // e.g. "img · sunset over ruins"
//   subtitle:        string          // e.g. model, params summary
//   status:          'wip' | 'ok' | 'err' | 'warn' | 'cancel'
//   startedAt:       ISO string
//   finishedAt:      ISO string | null
//   progress:        { step: number, total: number } | null  // for batch children
//   error:           string | null
//   logEventId:      number          // links to the primary row in state._logEvents
//   childLogIds:     number[]        // additional rows belonging to this job (stderr chunks etc.)
// }
```

`state.generating` becomes `state.jobs` (a Map). Each tab's "is anything running?" check becomes `Array.from(state.jobs.values()).some(j => j.tab === tab && j.status === 'wip')`.

### 2.2 Log events (re-shaped)

The current `addLogEvent` is kept (it is the universal hook), but every job has a **primary event id** that lives in the log buffer and points back to the job:

```js
// state._logEvents   (existing, kept)
// LogEvent additions:
//   jobId:           string | null   // links to state.jobs
//   pinToBottom:     boolean         // true for the primary job row, so jobs
//                                    // always stay near the top regardless of
//                                    // oldest-first FIFO for secondary events
//   progress:        { step, total } | null  // visible when row is collapsed;
//                                              drives the "..." / counter UI
//   cancellable:     boolean         // shows a small "✕" inline to cancel this job
```

The new collapse/expand behaviour, jump-to-top/bottom, Ctrl+click multi-select, and Ctrl+C copy use only the existing `data-log-id` attribute and the new `jobId`. No new data attributes are required.

### 2.3 Persistence

`state.jobs` is **not** persisted across restarts (mmx children die with the app, and partial work is gone). What is persisted is the L2 list — a list of the most recent finished jobs (default 200). The archive (L3) holds the overflow. Both are managed by [src/state.js](file:///C:/Projects/Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool/src/state.js) via the existing atomic write path. The live log buffer itself is **not** persisted.

---

## 3. New log UI contract (the part you specified)

This is the exact contract Phase A delivers. Phases B and C are built on top.

### 3.1 Visual rules

- **Every job = exactly one primary log row**, visible at all times while the job exists.
- Row state colors:
  - `wip`   → blue (`--log-wip`, e.g. `#4d8bff`)
  - `ok`    → green (`--log-ok`, e.g. `#3ecf8e`)
  - `warn`  → yellow / amber (`--log-warn`, e.g. `#f5b400`) — reserved for jobs that finished but reported a non-fatal issue (e.g. file saved but couldn't be thumbnailed, quota below 5 %, partial result with N/M children OK).
  - `err`   → red (`--log-err`, e.g. `#ff5757`)
  - `cancel`→ grey (`--log-cancel`, e.g. `#8a8f99`)
- The full row is tinted with the state color (a left border bar + a soft background tint), not just an icon, so the user sees status at a glance.
- WIP rows also show an animated `...` indicator on the right edge. Implementation: three dots, each `opacity` oscillates with a 400 ms offset via CSS `@keyframes`. No JS timers; pure CSS. We deliberately do **not** use a JS-driven `setInterval` per row — too easy to leak timers if rows are GC'd.
- Collapsed row contents (left to right):
  - `[hh:mm:ss]`
  - `[type-icon]` (e.g. `🖼` `🎵` `🗣` `🎬` `⬆` `⚙` `✂` — the post-processing icons are derived from the job type)
  - `title` (truncated with ellipsis on overflow; full title is in the `title=` tooltip)
  - optional `subtitle` (model + parameters summary, max 60 chars, separated by `·`)
  - progress fraction `3/20` for batch children
  - `...` animated indicator (wip only)
  - chevron `▸` / `▾` (always present for layout stability)
  - inline `✕` cancel button (only when `cancellable` and `status === 'wip'`)

### 3.2 Expanded view

- A second `details` block below the row (same DOM as today).
- Multi-line, monospace, no row-level colour. Colours inside details are only used for stderr keywords (`error` red, `warning` yellow) — already used in [src/mmx.js](file:///C:/Projects/Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool/src/mmx.js).
- Lines that belong to the same job (the secondary rows) are rendered **inline inside the expanded view** of the primary row, not as their own rows. This is the single biggest UX win — the user's log buffer doesn't grow during a 20-image batch; the secondary events are folded into the primary row's details.
- A secondary event that arrives while its parent is collapsed: we **re-attach it to the primary row's expanded details** the next time the user expands.

### 3.3 Interaction

| Action | Result |
|---|---|
| Click on row (no modifier) | Toggle expand/collapse of that single row. Selection is **not** changed. |
| `Ctrl+Click` on row | Toggle membership in the copy selection. Selected rows get a thin highlight ring. |
| `Shift+Click` on row | Range-select by **document order** (existing `selectLogRange` reused; we keep the existing range logic and just stop toggling expand on plain click). |
| `Ctrl+C` (anywhere on the log pane, with focus) | Copy all selected rows. If a row is collapsed, **only the primary one-liner is included**. If a row is expanded, the full expanded body is included with indentation. |
| `Ctrl+A` on the log pane | Select all rows in the visible (filtered) set. |
| `Ctrl+Shift+C` | Copy the **visible row count** + every visible row, even unselected (handy when "select all" is overkill). |
| `Esc` | Clear the selection. |
| `Home` / `End` while the log pane has focus | Jump to top / bottom (autoscroll respected; see 3.4). |
| Click on `▲ Top` button | Smooth-scroll the pane to the top, regardless of autoscroll mode. |
| Click on `▼ Bottom` button | Smooth-scroll to the bottom; if autoscroll is on, this is a no-op visually but useful when autoscroll is off. |
| Click on `− Collapse all` | Collapse every row; preserve current selection. |
| Click on `+ Expand all` | Expand every row. |
| Toggle `auto-scroll` (default ON) | When ON, the newest row is kept in view as it arrives; when OFF, the user's scroll position is preserved. (Default ON, persisted.) |

### 3.4 Jump-to-top/bottom semantics

- "Top" = visual top of the pane. Today the log uses `flex-direction: column-reverse` so the newest event is at the top. "Top" therefore means **newest**, and "Bottom" means **oldest visible**. The toggle button labels are `▲ Newest` and `▼ Oldest` to be unambiguous.
- A small chip next to the buttons shows the current mode (`Auto: ON` / `Auto: OFF`).
- When autoscroll is OFF, the user sees a small floating `↓ N new` pill at the top edge if new events arrived while they were scrolled away; clicking the pill jumps to the newest and re-enables autoscroll.

### 3.5 `addLogEvent` changes (the only public log API change)

A single new optional field:

```js
addLogEvent({
  ...existing fields...,
  jobId:        string | null,   // links to a job; null for free-form lines
  pinToBottom:  boolean,         // primary job rows use this; see 3.5.1
  progress:     { step, total } | null,
  cancellable:  boolean,
});
```

Behaviour changes inside the function:

- If `jobId` is set and the linked job's `status` is `wip`, the event is **not** appended as its own row. It is rendered into the linked job's primary row's `details` (creating the row if it doesn't exist yet).
- If `jobId` is set and the linked job is finished (`ok`/`err`/`warn`/`cancel`), the event is appended as its own row at the end. (Avoids silently appending new text to a closed job's history.)
- If `jobId` is null, the event is appended as its own row (free-form).

#### 3.5.1 `pinToBottom` and FIFO ordering

- The log buffer is a FIFO of `LOG_MAX_EVENTS` items per the existing cap in [LogService.js](file:///C:/Projects/Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool/renderer/services/LogService.js). We keep that.
- `pinToBottom: true` is a display-time hint: the row is rendered **last** in the DOM tree regardless of when it was added. This keeps the newest job always near the visible bottom of the visible list, even when older completed jobs are above it.
- Implementation: render the row at creation time in the right place; on re-paint, reorder only if the buffer was trimmed. We **do not** re-sort the entire DOM on every `addLogEvent` call.

### 3.6 Helpers added in `LogService`

- `attachSecondaryToJob(jobId, ev)` — moves/inserts a free-form event into a job's expanded details.
- `collapseAll()`, `expandAll()`.
- `jumpToNewest()`, `jumpToOldest()`.
- `setAutoscroll(on)` / `getAutoscroll()`.
- `countSelected()` (replaces inline `_logSelected.size` reads; tiny but tests want it).
- `selectedRowsExpanded()` — returns true if **every** selected row is currently expanded; used to drive the "Collapse all" button label.

All of these are exported via `window.LogService` (matches the current pattern in [LogService.js](file:///C:/Projects/Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool/renderer/services/LogService.js)).

---

## 4. New job runner (replacing `armGenBtnWithCancel`)

### 4.1 API

```js
// renderer/jobs/JobRunner.js
window.JobRunner = {
  run({ tabKey, type, title, subtitle, runFn, parentJobId = null })
    -> { jobId, cancel, done }
// runFn is an async (ctx) => { onProgress, onSecondary, onWarn, signal } => Result
// ctx.signal is an AbortSignal; runFn must throw or return a structured result
// on abort.
};
```

Internally:

1. Create a `Job`, append to `state.jobs`.
2. Create the primary log event with `jobId`, `pinToBottom: true`, `cancellable: true`, status `wip`.
3. Run `runFn(ctx)`.
4. On success: update `Job.status = 'ok'`, set `finishedAt`, set progress to `total`. Update the primary row: remove `wip` class, add `ok` class, remove the `...` indicator, replace it with a static `✓`.
5. On warn: same as `ok` but with `warn` color and the warning message included in `details`.
6. On error (caught or thrown): `Job.status = 'err'`. The primary row shows the error in `details` automatically.
7. On cancel: `Job.status = 'cancel'`.
8. The mmx child process is tracked in `state.jobs` (not in `currentGenProc` in [src/mmx.js](file:///C:/Projects/Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool/src/mmx.js)) — see 4.3.

### 4.2 What changes for tabs

- Each tab's generate handler wraps the existing body in `JobRunner.run(...)`.
- The tab button no longer toggles its own "Cancel" label. Instead, the **primary log row** for the running job shows a small `✕` (per 3.1) that calls `JobRunner.cancel(jobId)`. The `✕` is **permanently visible** while the job is WIP (works on touch + a11y; matches today's always-visible Cancel button on the per-tab).
- Each tab's "is anything running?" guard becomes a per-tab check on the job list, not on `state.generating`. This means the user can start a 5-music batch in the music tab and click Generate in the image tab immediately.

### 4.3 mmx runner

- [src/mmx.js](file:///C:/Projects/Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool/src/mmx.js) keeps its `runMmx` signature, but `currentGenProc` is replaced with a `Set<proc>` exposed as `getActiveProcs()` and a `cancelOne(proc)` helper. `cancelAll()` is kept as the "panic" button (kills everything, logs a one-line summary).
- A new optional callback `onChunk` (line, kind: 'stdout' | 'stderr' | 'progress') is added; the mmx IPC handler in [main/ipc/registerMmxIpc.js](file:///C:/Projects/Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool/main/ipc/registerMmxIpc.js) routes each chunk via `webContents.send('mmx:log', { jobId, line, kind })`. Today the IPC sends a plain string; the wire format changes (see 4.4).
- The renderer routes each chunk: if `jobId` is set, attach the line as a secondary event on that job; otherwise, treat as a free-form log line.

### 4.4 mmx:log wire format — keep the legacy string fallback

- Pre-Phase A: `ipcRenderer.on('mmx:log', (_e, line: string) => …)`.
- Post-Phase A: `ipcRenderer.on('mmx:log', (_e, payload: { jobId?: string; line: string; kind?: 'stdout' | 'stderr' }) => …)`.
- The preload in [preload.js](file:///C:/Projects/Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool/preload.js) keeps a **backwards-compat fallback**: if `payload` is a string, it wraps it as `{ line: payload, jobId: null, kind: 'stderr' }`. This means the new main process and an older renderer (or a stale dev build) both still render **something** instead of crashing.
- This is the only safe choice given the [project_rules.md](file:///C:/Projects/Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool/.trae/rules/project_rules.md) workflow: the production `.exe` in [dist-stable/win-unpacked](file:///C:/Projects/Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool/dist-stable/win-unpacked/MiniMaxAssetTool.exe) has a stable SHA256 and is never rebuilt; only `app.asar` changes via `node scripts/sync-stable-asar.js`. A hard cut to the new payload would break every in-place `.asar` refresh until the `.exe` is rebuilt.
- The fallback is ~6 lines in `preload.js`; we drop it in a later phase when the stable `.exe` is rebuilt to a version that always sends the new shape.

### 4.5 IPC + preload changes

- [preload.js](file:///C:/Projects/Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool/preload.js): `onLog(cb)` continues to take `(line)` for backwards compat; a new `onLogRich(cb)` takes `(payload)`. We register `onLogRich` if it exists in the renderer, else fall back to `onLog`. (Tiny wrapper, no preload contract break for any third party that happened to use the bridge.)
- [main/ipc/registerMmxIpc.js](file:///C:/Projects/Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool/main/ipc/registerMmxIpc.js) adds a new handler `mmx:run:job` that takes `{ args, apiKey, cwd, jobId }` and uses the new `runMmx({ ..., jobId })` signature. The existing `mmx:run` stays for the legacy single-job path (still used by `Diagnose` and `voices` cache).
- `mmx:cancel` is generalized: payload is `{ jobId?: string }`. If `jobId` is provided, only kill the matching proc; otherwise, kill all (panic).

---

## 5. Phased execution plan

### Phase A — Renderer-only multi-job + new log

**Effort: 1 day of focused work. Risk: low. Touches renderer only.**

Files:
- NEW: `renderer/jobs/JobRunner.js` (≈200 lines)
- NEW: `renderer/jobs/jobs.css` (only what `styles.css` cannot express; no global pollution)
- EDIT: `renderer/services/LogService.js` (rewrite the row layout + add helpers in §3.5–3.6; **do not** rename public methods)
- EDIT: `renderer/app.js` (wire new buttons, replace the per-tab button-gate)
- EDIT: `renderer/index.html` (button bar above the log pane: `▲ Newest`, `▼ Oldest`, `− Collapse all`, `+ Expand all`, autoscroll chip; also a small "↓ N new" pill element)
- EDIT: `renderer/styles.css` (new CSS variables `--log-wip/--log-ok/--log-warn/--log-err/--log-cancel`; `...` keyframes; selected-row ring; jump pill)
- EDIT: `renderer/sections/imageTab.js` (and music / speech / video) — wrap generate handler in `JobRunner.run(...)`. **No behaviour change** beyond the wrapping.
- EDIT: `renderer/bootstrap.js` (load `JobRunner.js` before `app.js`; existing pattern)

Acceptance:
- Clicking Generate on the image tab while the music tab is running a batch **does not** disable the image tab's Generate button.
- Each job is exactly one primary log row. Secondary stderr chunks attach to the primary row's expanded details.
- New log buttons exist and work as in §3.3.
- `Ctrl+C` copies selected rows' full bodies when expanded, only the one-liner when collapsed.
- Autoscroll default ON, with the floating "N new" pill when OFF and events arrive.
- Pre-commit lint + tests + the full-sweep harness from the previous step all stay green.

Risks & mitigations:
- **Log selection regression**: the old plain-click toggled selection AND expand. The new plain-click toggles expand only. Selection moves to Ctrl+Click. This is a deliberate, user-visible behaviour change. We add a one-time tooltip on the log bar after the first launch (`data-help-topic="log.select"`, gated by the existing `seenPopups` system in [src/state.js](file:///C:/Projects/Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool/src/state.js)) so users discover the change.
- **CSS perf with many rows**: confirmed via the existing log cap (`LOG_MAX_EVENTS`); even at 500 rows, the new DOM is well under any renderer cost threshold on Windows. No virtualization needed in Phase A.
- **Cancellation race**: when the user clicks the inline `✕` on a job's primary row, the job's `signal` aborts. The mmx runner kills the proc and resolves the runFn with `{ status: 'cancel' }`. We **do not** await the proc close before updating the row color; we mark `cancellable: false` immediately and let the row flip to `cancel` once the close event arrives. (Existing behaviour in [src/mmx.js](file:///C:/Projects/Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool/src/mmx.js#L218-L226) already returns the right shape.)

---

### Phase B — Progress widgets + per-job cancel + Diagnose concurrency advisor

**Effort: 1 day. Risk: medium. Touches renderer + a small main-side metadata fetch.**

Goal: the user has a real-time "what's running" widget (not buried inside the log), per-job cancel, and the Diagnose dialog tells them whether parallel is safe for their plan.

Files:
- NEW: `renderer/widgets/ActiveJobsWidget.js` — small fixed-position widget (bottom-right of the content area). Shows each running job with: icon, title, age (`12.3 s`), progress fraction (if batch child), and a cancel button. Click on a widget row scrolls the log pane to the corresponding primary row and expands it.
- EDIT: `renderer/index.html` — add the widget host element.
- EDIT: `renderer/jobs/JobRunner.js` — emit `state.jobs` change events (`jobrunner:job-added`, `jobrunner:job-updated`, `jobrunner:job-removed`) so the widget stays in sync without polling.
- EDIT: `renderer/services/LogService.js` — add `scrollToJob(jobId)` helper.
- EDIT: `main/ipc/registerMmxIpc.js` — new handler `mmx:quota` is already present; we add a lightweight `mmx:profile` that returns `{ concurrentLimit, planType }` (read from the same `quota` response we already parse) and cache it for 5 minutes.
- EDIT: `renderer/sections/diagnoseSection.js` — when a parallel scenario is detected (more than one in-flight job), show a coloured hint: "Your plan allows N concurrent calls; you currently have M running." If M > N, suggest sequential mode with a one-click switch.

Risks & mitigations:
- **Widget becomes a second source of truth**: we avoid this by making the widget a pure projection of `state.jobs`. It subscribes to events, never owns data. The widget can be removed without affecting the rest of the app.
- **mmx does not return a real concurrency number**: today `quota` returns a rate/quota response, not an explicit concurrency cap. We treat the absence of an explicit `concurrentLimit` as "unknown" and show a neutral message ("Parallel mode is enabled; the upstream may throttle you. If generations are slow, switch to sequential in Settings."). No invented numbers.
- **Autoscroll confusion with the widget**: when the user clicks a widget row, the log pane scrolls to the corresponding primary row and expands it. Autoscroll mode is **not** changed by this — the user already opted out, so they stay opted out.

---

### Phase C — Persistence (L2 + L3), hardening, end-of-job summaries

**Effort: 1 day. Risk: medium-low. Touches renderer, main, and [src/state.js](file:///C:/Projects/Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool/src/state.js).**

Goal: surviving a crash or a forced quit does not silently lose track of what was running; users get a clear post-batch summary; the per-job log cap holds up across long sessions; old history is reachable but never the bottleneck.

Files:
- EDIT: `src/state.js` — add `state.jobs.snapshot: { lastFinished: JobSummary[] }` to the persisted whitelist. Default cap **200** (configurable, see §1). Each entry is `{ id, type, title, subtitle, status, startedAt, finishedAt, outputPaths, groupId }`. **Job summaries only — no in-flight jobs are persisted**, because the mmx children are gone after a crash.
- EDIT: `src/state.js` — same write pass enforces the L2 cap with `slice(-cap)` and **moves** the trimmed entries to L3 via a single `fs.appendFileSync` to `state.jobs.archive.jsonl`. A try/catch around the append ensures a failing archive write does not block the main state save.
- NEW: `main/services/ArchiveService.js` — small wrapper around the JSONL file: `append(entries)`, `readChunk(offset, limit)`, `deleteOne(id)`, `clear()`, `size()`. No dependencies. Crash-safe trim of a partial final line on the next `append`.
- EDIT: `main/ipc/registerStateIpc.js` — two new handlers: `state:archiveRead({ offset, limit })` and `state:archiveClear()`. Both return `{ ok, ... }` envelopes.
- EDIT: `renderer/services/LogService.js` — replace the global `LOG_MAX_EVENTS` cap with a per-job cap (default 500 secondary events per job). On overflow, drop the **oldest secondary events** of the **currently least-recently-viewed** job (LRU based on last expand). A single global FIFO is preserved for the primary rows.
- NEW: `renderer/jobs/JobSummary.js` — at the end of a batch (when the last child finishes), emit a single "Batch finished: 18/20 ok, 2 failed (1 quota, 1 network)" log event with `jobId` pointing to the **batch parent**. The summary line uses the `warn` color if anything failed, else `ok`.
- NEW: `renderer/widgets/ArchiveViewer.js` — opens on demand, lazy chunked read, virtualised list. Only loaded the first time the user clicks **Open archive**.
- NEW: `renderer/widgets/archiveViewer.css` — styles for the archive list and the search/filter toolbar.
- EDIT: `renderer/sections/section03_Settings_tab_panes.js` — adds a "History" subsection in ⚙ Settings: number input for `lastFinishedCap` + **Clear archive** button + archive size label.
- EDIT: `renderer/bootstrap.js` — on app start, render the persisted L2 list as collapsed rows at the bottom of the log (status-coloured, not interactive, marked with a `↻` icon meaning "from previous session"). They are **not** clickable for re-run in this phase; that is a deliberate non-goal (re-running requires parameter round-tripping, which is out of scope).
- EDIT: `main/index.js` — add a graceful-shutdown handler that, on `before-quit`, asks the renderer to flush any in-flight job summaries synchronously. This is best-effort; if the renderer doesn't respond in 500 ms, the app exits anyway.

Risks & mitigations:
- **`state.json` growth**: the L2 cap (default 200) keeps `state.json` well under 50 KB even with all entries populated. The L3 archive is append-only and does not bloat `state.json`.
- **Re-clicking Generate on a still-running job**: the per-tab gate in Phase A already prevents this. We **do not** weaken the gate in Phase C.
- **mmx `signal` race on app quit**: if the user quits the app while a batch is running, we attempt to send SIGTERM to every active proc (existing `cancelAll`), wait up to 1.5 s, then SIGKILL. This is already supported in [src/mmx.js](file:///C:/Projects/Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool/src/mmx.js). We just call it from the `before-quit` hook.

---

## 6. Detailed risks across all phases

| # | Risk | Phase | Mitigation |
|---|---|---|---|
| R1 | Click semantics change breaks muscle memory (old: click = select+expand; new: click = expand only) | A | One-time in-app tooltip (`seenPopups`-gated); first item in the release notes; the Ctrl+Click path still produces a highlight ring, so the visual cue is consistent with "select" |
| R2 | Many in-flight jobs exhaust the OS file-handle / process table | A | Hard cap of 16 concurrent jobs (renderer-enforced; `state.jobs.size >= 16` blocks the next start with a friendly toast). Most users will never hit this |
| R3 | Log `addLogEvent` overload grows accidentally (callers pass `jobId` they didn't intend) | A | All Phase A callers go through `JobRunner.run`, which is the **only** place that creates a `jobId`. Free-form callers must not pass `jobId`. Add a runtime warning in dev builds (`if (jobId && !state.jobs.has(jobId)) console.warn(...))`. |
| R4 | `mmx:log` payload change breaks renderer/main version skew | A | Backwards-compat wrapper in `preload.js` (string payload → `{ line, jobId: null, kind: 'stderr' }`). The only safe choice given the [project_rules.md](file:///C:/Projects/Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool/.trae/rules/project_rules.md) workflow where the stable `.exe` is never rebuilt. |
| R5 | The new per-job log cap interacts badly with copy-all | C | When copying, we walk **job summaries** first, then expand the selected primary rows. The cap is enforced on render, not on copy — so Ctrl+A still copies everything currently in the buffer. |
| R6 | Autoscroll fight between the widget and the log pane | B | The widget never autoscrolls the log pane on its own. Only an explicit user click on a widget row scrolls. |
| R7 | mmx child outliving the renderer during shutdown | C | The `before-quit` hook in [main/index.js](file:///C:/Projects/Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool/main/index.js) calls the existing `cancelAll()` and waits 1.5 s before force-kill. We do **not** add new logic in mmx; we just wire what already exists. |
| R8 | Persisted `lastFinished` reveals a path the user did not want on disk | C | Only `outputPaths` (string[]) is persisted, never the file contents. The user can clear L2 via the existing "Clear log" button, which now also clears the in-memory L2 list. L3 is cleared separately via the **Clear archive** button in ⚙ Settings. |
| R9 | The `...` CSS keyframes cause paint thrash on low-end laptops | A | The keyframe animates only `opacity`. We test on a representative low-end config (Intel UHD, 1080p) with 50 WIP rows open. If the frame budget is tight, we switch to `transform: translate3d` of a small pseudo-element (no layout impact, identical visual). |
| R10 | `JobRunner.run` swallows errors silently | A | The function always resolves to a structured `{ status, error? }`. The caller does not need to wrap in try/catch. We add a test that asserts every error path produces a row with `status === 'err'` |
| R11 | A user's clipboard is full (e.g. images in clipboard history) and `navigator.clipboard.writeText` rejects | A | The existing fallback in [renderer/app.js](file:///C:/Projects/Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool/renderer/app.js#L265-L281) handles this for the legacy copy button. We reuse the same fallback for the new Ctrl+C path on the log pane. |
| R12 | The Ctrl+A handler on the log pane captures Ctrl+A inside an input field | A | The handler checks `e.target.tagName` and bails out when the user is typing in an `input` / `textarea` / `select`. Same pattern as the existing `installKeyboardShortcuts` in [renderer/app.js](file:///C:/Projects/Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool/renderer/app.js) |
| R13 | Existing tests depend on the old `addLogEvent` contract | A | The new `jobId` / `pinToBottom` / `progress` / `cancellable` fields are optional. Every existing test continues to pass with default values. The full-sweep harness from the previous session is the gate. |
| R14 | The button bar above the log pane overflows on narrow windows | A | The bar wraps with `flex-wrap: wrap`. On widths < 720 px the autoscroll chip moves to a second line. We confirm with the existing layout-settings persistence (sidebar / logbar / preview widths) — none of those should regress. |
| R15 | A user clicks the inline `✕` on a job whose `runFn` is in a tight loop and ignores the abort signal | A | We add a 250 ms grace period; if the proc hasn't exited, the row flips to `cancel` color but the proc keeps running in the background. The user can see "still terminating…" via the `...` indicator for up to 2 s, then we surface a clear "Could not stop — see log" entry. This matches the existing behaviour of `cancelAll()` in [src/mmx.js](file:///C:/Projects/Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool/src/mmx.js). |
| R16 | Archive file grows unbounded over months of heavy use | C | L3 is unbounded by design, but each line is ~200 B. A user running 1 000 jobs/day accumulates ~70 KB/day, ~25 MB/year. We surface the current size in ⚙ Settings → History so the user sees the growth. No auto-prune; the user clicks **Clear archive** when they want to reset. |
| R17 | A partial final line in the archive file corrupts read-back | C | `ArchiveService.append` checks the file size after write; if the last byte is not `\n`, it rewrites the file (atomic temp + rename) to drop the partial line. Crash-safe; one extra read+write on every save that touched the archive. |
| R18 | The archive viewer loads slowly on huge files | C | The viewer reads in chunks of 100 lines and only requests the next chunk when the user scrolls within 20 lines of the bottom. Cold-open cost is one 100-line read (~5 ms for a 10 MB archive). |
| R19 | `lastFinishedCap` slider changes the value while the app is running, leaving L2 in an inconsistent state | C | The cap is read on every save pass, so the next save re-applies `slice(-cap)` to L2 and moves the overflow to L3. No "inconsistent" intermediate state is observable. |

---

## 7. Test plan (gates every phase)

For each phase, the following must stay green:

1. `node scripts/lint.js` — zero errors.
2. `node scripts/check.js` — asset presence in `./bin/`.
3. `npm test` — 203 tests pass, no new failures.
4. `node --test tests/unit/main/ipc/fullToolSweep.test.js` — the new full-sweep harness stays green.
5. New unit tests per phase:
   - **Phase A**: `tests/unit/renderer/JobRunner.test.js` (lifecycle, error paths, cancel race); `tests/unit/renderer/LogService.layout.test.js` (collapse-all, expand-all, jump, selection copy).
   - **Phase B**: `tests/unit/renderer/ActiveJobsWidget.test.js` (event subscription, click → log scroll).
   - **Phase C**: `tests/unit/main/ArchiveService.test.js` (append, read chunk, clear, crash-safe trim, deleteOne); `tests/unit/main/state.persistence.test.js` (L2 cap enforced, L3 move happens, partial-line trim).

Manual smoke (a short checklist we run before tagging a build):

- [ ] Start a 5-image batch, then start a 2-music batch, then a single speech. All three run with separate primary log rows.
- [ ] Click the inline `✕` on the music job's primary row. The music job flips to `cancel`; image and speech keep running.
- [ ] Ctrl+Click three log rows. Ctrl+C. Paste into a text editor. Each row's content matches the visible state (collapsed = one-liner, expanded = full body).
- [ ] Click `▼ Oldest`. Scroll the log. New events arrive. The floating `↓ N new` pill appears. Click it → jumps to the newest and the pill hides.
- [ ] Quit the app while a 20-image batch is running. Re-open. The `↻` summary rows at the bottom show the partial result (`3/20 ok, 17 interrupted`).
- [ ] Open the **Open archive** viewer. Filter by `image`. Scroll. The next 100-line chunk loads lazily when the scroll position nears the end.
- [ ] In ⚙ Settings → History, lower `lastFinishedCap` to 20. Save. Verify the 21st-oldest entry was moved to the archive (archive size grew by 1).
- [ ] Click **Clear archive**. The archive size goes to 0; L2 is unchanged.
- [ ] Open Diagnose with 3 in-flight jobs. The concurrency hint is visible and accurate.
- [ ] Run the full-sweep harness, the lint, the pre-commit test suite — all green.

---

## 8. Rollout / commit strategy

- Phase A is shipped in one commit. It is purely additive on the renderer side and the wire-format change is backwards-compatible. After Phase A we are already delivering the scenario you described: 20 images + 5 music + manual speech, all live, with one primary log line per job.
- Phase B is shipped in one commit. It depends on Phase A's events.
- Phase C is shipped in one commit. It is the largest of the three but the easiest to revert (one config field, one new file, two IPC handlers, one widget).
- After each phase: `git add -A . && git commit -m "..."` (pre-commit runs lint + tests), then `node scripts/sync-stable-asar.js` to refresh the stable `app.asar` next to the production `.exe` in [dist-stable/win-unpacked](file:///C:/Projects/Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool/dist-stable/win-unpacked/MiniMaxAssetTool.exe).

---

## 9. Resolved decisions (locked in)

| # | Question | Decision | Why |
|---|---|---|---|
| 1 | Multi-select modifier on macOS | **N/A — Windows-only tool.** We bind `Ctrl` only. No `Cmd` handling. | Avoids code paths that can never be exercised in this product. |
| 2 | WIP animation | **Three animated dots** (CSS keyframes, no JS timers). | Simplest correct implementation; matches "least problems" goal; no per-row timers means no leaks. |
| 3 | Inline `✕` cancel visibility | **Permanently visible** while the job is WIP. | Works on touch + a11y; matches today's always-visible Cancel button on the per-tab. |
| 4 | History cap | **L1 = live (LOG_MAX_EVENTS) + L2 = last 200 finished jobs in `state.json` (configurable 20–1000) + L3 = JSONL archive (unbounded, lazy-loaded).** | Indefinite was rightly rejected (state.json growth, render cost, memory). A 200 default hits the "good enough" sweet spot; the archive absorbs the long tail without ever blocking the hot path. |
| 5 | `mmx:log` wire format | **Keep the legacy string fallback** in `preload.js`. | The only safe choice given the [project_rules.md](file:///C:/Projects/Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool/.trae/rules/project_rules.md) workflow: the stable `.exe` SHA256 must stay `1b384ee8…`, so the renderer must accept both payload shapes. |
