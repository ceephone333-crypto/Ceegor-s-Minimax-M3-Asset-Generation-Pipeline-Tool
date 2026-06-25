// renderer/jobs/JobRunner.js — Multi-job runner (Phase A of _plan3).
//
// Owns the renderer's job lifecycle. Each tab's generate handler wraps
// its body in JobRunner.run({ tabKey, type, title, subtitle, runFn,
// parentJobId }) instead of the old per-tab `state.generating` slot
// (which only allowed one in-flight job at a time across all tabs).
//
// The new model:
//   • state.jobs is a Map<jobId, Job>. Multiple jobs in different tabs
//     can run in parallel.
//   • Each job has exactly one primary log row (the log event with
//     jobId set in addLogEvent). Secondary stderr chunks are folded
//     into that row's expanded details via attachSecondaryToJob.
//   • Per-tab "is anything running?" check is `jobsForTab(tabKey)`
//     (any wip job for that tab), NOT the global `state.generating`.
//     We keep `state.generating` as a DERIVED projection (one tabKey
//     or 'mixed' or null) so the legacy readers in batchManager /
//     fileBrowser2b / the smoke test continue to work — see
//     _syncLegacyGenerating below.
//
// Public API (see _plan3.md §4.1):
//   JobRunner.run({ tabKey, type, title, subtitle, runFn, parentJobId })
//     -> { jobId, cancel, done }
//   JobRunner.cancel(jobId)
//   JobRunner.cancelAll()
//   JobRunner.jobsForTab(tabKey)   -> Job[]
//   JobRunner.isTabRunning(tabKey) -> boolean
//   JobRunner.on(event, cb) / off()  — for ActiveJobsWidget
//
// Events (Phase B; the widget is the only consumer in this phase):
//   'jobrunner:job-added'
//   'jobrunner:job-updated'
//   'jobrunner:job-removed'
//
// Hard cap: 16 concurrent jobs. Past that, run() rejects with a
// friendly toast and the caller is expected to bail (the per-tab
// re-entrancy check makes the cap practically unreachable; the limit
// is just a safety net against runaway loops).

(function () {
  const HARD_CAP = 16;
  // Bug-fix B7 (_temp5.md): cap on the number of FINISHED jobs we
  // keep in `_jobs` for query/scrollback. Finished jobs are
  // intentionally NOT pruned at completion (see _wipJobCount above)
  // because tests/UI (scrollToJob, childLogIds lookups right after
  // `await ctrl.done`) expect a finished job to stay queryable in
  // the same tick. Without a cap, a marathon batch session would
  // accumulate finished-job records for the whole session with no
  // bound. We keep the most recent FINISHED_JOB_KEEP entries (in
  // insertion order, which is chronological because ids are
  // monotonic) and evict the oldest finished ones whenever a new
  // job is added. WIP jobs are NEVER evicted.
  const FINISHED_JOB_KEEP = 200;
  const _jobs = new Map();
  const _listeners = new Map(); // event -> Set<cb>

  // Persist a `state.jobs` reference so legacy code (and tests) that
  // look at `state.jobs` see the same Map.
  if (typeof window !== 'undefined' && window.state) {
    window.state.jobs = _jobs;
  }

  function _emit(event, payload) {
    const set = _listeners.get(event);
    if (!set) return;
    for (const cb of set) {
      try { cb(payload); } catch (e) { console.warn('JobRunner listener failed:', e); }
    }
  }

  function on(event, cb) {
    if (!_listeners.has(event)) _listeners.set(event, new Set());
    _listeners.get(event).add(cb);
    return () => off(event, cb);
  }
  function off(event, cb) {
    const set = _listeners.get(event);
    if (set) set.delete(cb);
  }

  function _newJobId() {
    // Session-unique id. `${type}-${counter}` per type, monotonic.
    _jobs._idCounter = (_jobs._idCounter || 0) + 1;
    return `job-${Date.now().toString(36)}-${_jobs._idCounter}`;
  }

  function jobsForTab(tabKey) {
    if (!tabKey) return [];
    const out = [];
    for (const j of _jobs.values()) {
      if (j.tab === tabKey) out.push(j);
    }
    return out;
  }
  function isTabRunning(tabKey) {
    if (!tabKey) return false;
    for (const j of _jobs.values()) {
      if (j.tab === tabKey && j.status === 'wip') return true;
    }
    return false;
  }
  function activeJobs() {
    const out = [];
    for (const j of _jobs.values()) if (j.status === 'wip') out.push(j);
    return out;
  }

  // bug-fix H1 (_temp4.md): finished jobs used to stay in `_jobs`
  // forever (nothing ever deleted them), so once 16 jobs had EVER run
  // in a session the HARD_CAP check below would block every future
  // generation with "Too many jobs running" — even with zero jobs
  // actually in flight. Existing tests/UI (scrollToJob, the
  // childLogIds/job.status lookups right after `await ctrl.done`)
  // expect a finished job to stay queryable in `_jobs`/`state.jobs`,
  // so the fix counts only WIP jobs against the cap instead of
  // pruning the map.
  function _wipJobCount() {
    let n = 0;
    for (const j of _jobs.values()) if (j.status === 'wip') n++;
    return n;
  }

  // bug-fix B7 (_temp5.md): bound the finished-job history. Called
  // from run() right after a new job is inserted. Walks the map in
  // insertion order (Map iteration is insertion-ordered, and ids
  // are monotonic by _newJobId, so "oldest" == "first inserted")
  // and evicts finished jobs past FINISHED_JOB_KEEP. WIP jobs and
  // the just-inserted job are always retained. Emits
  // jobrunner:job-removed for each eviction so ActiveJobsWidget /
  // listeners stay in sync. Best-effort: a listener throwing does
  // not abort the sweep.
  // v1.1 (audit BUG-N7): also strip evicted ids from
  // state.jobsSnapshot so the snapshot and _jobs stay
  // consistent (snapshot ⊂ _jobs).
  function _pruneFinishedJobs() {
    if (_jobs.size <= FINISHED_JOB_KEEP) return;
    let finishedCount = 0;
    for (const j of _jobs.values()) {
      if (j.status !== 'wip') finishedCount++;
    }
    if (finishedCount <= FINISHED_JOB_KEEP) return;
    const toEvict = finishedCount - FINISHED_JOB_KEEP;
    const evictedIds = []; // v1.1: collected for snapshot cleanup
    let evicted = 0;
    for (const [id, j] of _jobs) {
      if (evicted >= toEvict) break;
      if (j.status === 'wip') continue;
      _jobs.delete(id);
      evictedIds.push(id);
      try { _emit('jobrunner:job-removed', j); } catch (_) { /* best-effort */ }
      evicted++;
    }
    // v1.1 (audit BUG-N7): strip evicted ids from
    // state.jobsSnapshot so the snapshot and _jobs stay in lock-step.
    if (evictedIds.length && typeof window !== 'undefined' && window.state
        && Array.isArray(window.state.jobsSnapshot)) {
      const evictedSet = new Set(evictedIds);
      window.state.jobsSnapshot = window.state.jobsSnapshot.filter(
        (e) => !evictedSet.has(e && e.id),
      );
    }
  }

  // Legacy projection: keep `state.generating` truthy while ANY
  // JobRunner job is running. Single tab -> its key, multiple ->
  // 'mixed'. When NO JobRunner job is in flight we LEAVE the legacy
  // field alone (the legacy `armGenBtnWithCancel` flow uses it
  // directly; overwriting it would clobber the legacy signal).
  // The existing batchManager / fileBrowser2b / smoke test code
  // that reads `state.generating` keeps working unchanged.
  function _syncLegacyGenerating() {
    if (typeof window === 'undefined' || !window.state) return;
    const tabs = new Set();
    for (const j of _jobs.values()) {
      if (j.status === 'wip' && j.tab) tabs.add(j.tab);
    }
    if (tabs.size === 0) {
      // Don't touch window.state.generating when no JobRunner job
      // is running. The legacy `armGenBtnWithCancel` flow owns
      // the field in that case.
      return;
    }
    if (tabs.size === 1) window.state.generating = Array.from(tabs)[0];
    else window.state.generating = 'mixed';
  }

  function _createJob(opts) {
    const id = _newJobId();
    const now = new Date();
    return {
      id,
      type: opts.type || 'image',
      tab: opts.tabKey || null,
      parentJobId: opts.parentJobId || null,
      title: opts.title || 'Generation',
      subtitle: opts.subtitle || '',
      status: 'wip',
      startedAt: now,
      finishedAt: null,
      progress: opts.progress || null,
      error: null,
      logEventId: null,        // primary row id (filled in by addLogEvent)
      childLogIds: [],         // secondary stderr chunks
      outputPaths: [],         // bug-fix Phase1 (_temp4.md): filled from runFn's result on completion
      _abortController: null,  // AbortController for the runFn signal
      _cancellable: true,      // matches opts.cancellable
    };
  }

  // bug-fix Phase1/H1 (_temp4.md): persist a summary of a finished job
  // into state.jobsSnapshot so the L2 boot-render (bootstrap.js),
  // History/ArchiveViewer, and JobSummary panel actually get data —
  // before this, jobsSnapshot stayed null forever because nothing
  // wrote to it (Phase C's UI was built but never fed). The shape
  // mirrors what LogService.renderPersistedL2 / ArchiveViewer already
  // read: { id, type, tab, title, subtitle, status, finishedAt,
  // outputPaths, error }. Does NOT remove the job from `_jobs` — see
  // _wipJobCount above for why finished jobs intentionally stay
  // queryable.
  function _pushJobSnapshot(job) {
    if (typeof window === 'undefined' || !window.state) return;
    if (!Array.isArray(window.state.jobsSnapshot)) window.state.jobsSnapshot = [];
    window.state.jobsSnapshot.push({
      id: job.id,
      type: job.type,
      tab: job.tab,
      title: job.title,
      subtitle: job.subtitle,
      status: job.status,
      finishedAt: job.finishedAt,
      outputPaths: Array.isArray(job.outputPaths) ? job.outputPaths.slice() : [],
      error: job.error || null,
    });
    // Bug-fix HIGH-1 (_temp5.md 360° audit): trim the in-memory L2
    // list to jobsArchiveCap RIGHT HERE, after every push. Previously
    // the renderer's jobsSnapshot only ever grew, and saveAllStates()
    // sent the full untrimmed array on every save — so src/state.js
    // write() re-archived the SAME overflow entries on every save
    // (live-reproduced: 5 → 10 → 15 archive lines on 3 identical
    // writes). Trimming client-side means the array we persist is
    // already the post-trim shape, and the server-side trim becomes
    // a defensive no-op for the normal path. The cap is clamped to
    // [20, 1000] to match src/state.js write()'s clamp.
    const cap = Math.max(20, Math.min(1000, Number(window.state.jobsArchiveCap) || 200));
    if (window.state.jobsSnapshot.length > cap) {
      window.state.jobsSnapshot = window.state.jobsSnapshot.slice(-cap);
    }
    if (typeof window.scheduleStateSave === 'function') {
      try { window.scheduleStateSave(); } catch (_) { /* ignore */ }
    }
  }

  function _addLogSecondary(job, line) {
    if (!job || !line) return;
    const Log = (typeof window !== 'undefined' && window.LogService) || null;
    if (!Log) return;
    const safeLine = String(line);
    // BUG-9-07 fix (user-reported, 2026-06-25): if the job has a
    // primary row, fold the line into the row's `details` array
    // (so it shows in the expanded view of the primary row, not
    // as a separate standalone row). The previous version always
    // called `addLogEvent({ _internal: true, ... })`, which
    // `addLogEvent`'s routing check (`!ev._internal`) skipped, so
    // every line became its own separate log row. Combined with
    // the main process sending each line TWICE (onLog + onChunk
    // — see main/ipc/registerMmxIpc.js), the user saw every mmx
    // line (e.g. "[Model: image-01]", "$ node mmx.mjs ...",
    // `{"saved": "..."}`) twice in the log pane. Folding into the
    // primary row's details also matches the documented intent of
    // attachSecondaryToJob: "any line with a jobId is appended
    // into the row's details, NOT as its own row."
    if (job.logEventId != null
        && typeof Log.appendLogDetails === 'function') {
      // Cap secondary lines per job to avoid runaway log spam.
      // The DOM stays small because the details section is the
      // only place they're rendered, but a runaway mmx process
      // could otherwise grow the array unbounded.
      if (job.childLogIds.length >= 500) {
        // Drop the oldest. We don't bother removing it from the
        // DOM (appendLogDetails is incremental), but the cap
        // prevents the array from growing without bound.
        job.childLogIds.shift();
      }
      Log.appendLogDetails(job.logEventId, [safeLine]);
      job.childLogIds.push(job.logEventId);
      return;
    }
    // No primary row (suppressLogRow: true) — fall back to
    // creating a separate log row so the user still sees the
    // mmx output. We use addLogEvent WITHOUT the _internal
    // flag so the routing check still applies (free-form, no
    // jobId, so no routing anyway).
    if (typeof Log.addLogEvent !== 'function') return;
    if (job.childLogIds.length >= 500) job.childLogIds.shift();
    const evId = Log.addLogEvent({
      category: 'info',
      headline: safeLine.slice(0, 200),
      details: [safeLine],
      jobId: job.id,
      // _internal: true tells addLogEvent NOT to re-route through
      // attachSecondaryToJob (infinite recursion safeguard). The
      // routing check (`!ev._internal`) means this event won't
      // fold into the primary row — but we already established
      // above that there IS no primary row (logEventId is null),
      // so the routing check is moot.
      _internal: true,
    });
    if (evId != null) job.childLogIds.push(evId);
  }

  function _markJobDone(job, status, errorMsg, details, outputPaths) {
    job.status = status;
    job.finishedAt = new Date();
    if (errorMsg) job.error = String(errorMsg).slice(0, 500);
    if (Array.isArray(outputPaths)) job.outputPaths = outputPaths.slice();
    job._cancellable = false;
    if (job.logEventId != null && typeof window.LogService !== 'undefined') {
      // Update the primary row's status classes + add an "ok"/"err"
      // detail line so the user sees the final outcome in the
      // expanded view.
      window.LogService.updateLogStatus && window.LogService.updateLogStatus(job.logEventId, {
        status,
        result: status === 'ok' ? 'ok' : status === 'warn' ? null : 'err',
      });
    }
    if (details && details.length && typeof window.LogService !== 'undefined') {
      window.LogService.appendLogDetails && window.LogService.appendLogDetails(job.logEventId, details);
    }
    _emit('jobrunner:job-updated', job);
    // Bug-fix M2 (_temp5.md 360° audit): do NOT emit 'job-removed'
    // here. The job is still in `_jobs` (intentionally — finished
    // jobs stay queryable for scrollback/`await ctrl.done` lookups,
    // and are only evicted later by _pruneFinishedJobs once the
    // FINISHED_JOB_KEEP cap is crossed). Emitting 'job-removed' for
    // a job that's still in the map was a semantic trap for any
    // listener that treats the event as "this id is gone from
    // state.jobs" — and it caused every finishing job to fire
    // 'job-removed' twice (once here, once when eventually pruned).
    _syncLegacyGenerating();
    _pushJobSnapshot(job);
  }

  // Attach a free-form log line to a job's primary row (not as its own
  // row). Used by the IPC layer to route `mmx:log` chunks to the right
  // job. Returns the new event id.
  function attachSecondaryToJob(jobId, line) {
    const job = _jobs.get(jobId);
    if (!job) return null;
    _addLogSecondary(job, line);
    return job.logEventId;
  }

  // Public: run a job. The caller's `runFn` is an async function that
  // receives { signal, onProgress, onSecondary, onWarn } and either
  // resolves to a structured result or throws. The job is created
  // synchronously, the primary log row is appended up front, and the
  // runFn is invoked in the next microtask so the caller can register
  // listeners on the returned job before the first event fires.
  function run(opts) {
    opts = opts || {};
    // bug-fix H2 (_temp4.md): the one-time assignment below (outside
    // this function, at script-load time) silently no-ops if
    // window.state doesn't exist yet — JobRunner.js loads before
    // section24_State.js defines it. Re-assert it here too: by the
    // time run() is called a real generation is starting, so state is
    // guaranteed to exist. Idempotent and cheap.
    if (typeof window !== 'undefined' && window.state && window.state.jobs !== _jobs) {
      window.state.jobs = _jobs;
    }
    if (_wipJobCount() >= HARD_CAP) {
      const msg = `Too many jobs running (limit ${HARD_CAP}). Wait for one to finish and try again.`;
      if (typeof window !== 'undefined' && window.toast) window.toast(msg, 'err', 5000);
      return Promise.reject(new Error(msg));
    }
    const tabKey = opts.tabKey || null;
    // Per-tab gate (replaces the old `state.generating` check in each
    // tab's gen handler). The plan (§4.2) is explicit: different tabs
    // can run in parallel, but the SAME tab cannot start a second job
    // while one is wip.
    if (tabKey && isTabRunning(tabKey)) {
      const msg = `A generation is already running on the ${tabKey} tab.`;
      if (typeof window !== 'undefined' && window.toast) window.toast(msg, 'warn', 3000);
      return Promise.reject(new Error(msg));
    }

    const job = _createJob(opts);
    _jobs.set(job.id, job);
    // bug-fix B7 (_temp5.md): bound finished-job history so a long
    // batch session can't grow `_jobs` without limit. The new job
    // (still wip here) is always retained; only old FINISHED jobs
    // past FINISHED_JOB_KEEP are evicted.
    _pruneFinishedJobs();
    _emit('jobrunner:job-added', job);
    _syncLegacyGenerating();

    // Append the primary log row up front. The caller gets a stable
    // logEventId back so it can attach stderr chunks etc.
    // bug-fix Phase1 (_temp4.md): opts.suppressLogRow lets a caller that
    // already does its OWN manual logging (the legacy tab handlers,
    // pre-migration) register with JobRunner for ActiveJobsWidget /
    // jobId-scoped cancel WITHOUT also getting a second, redundant
    // primary row — job.logEventId stays null, and every downstream
    // LogService call in _markJobDone is already guarded on
    // `logEventId != null`, so it safely no-ops.
    let logEventId = null;
    if (!opts.suppressLogRow && typeof window !== 'undefined' && window.LogService && window.LogService.addLogEvent) {
      logEventId = window.LogService.addLogEvent({
        category: opts.logCategory || 'gen',
        headline: opts.title || 'Generation',
        details: opts.subtitle ? [opts.subtitle] : [],
        jobId: job.id,
        pinToBottom: true,
        cancellable: true,
        typeIcon: opts.typeIcon,
      });
    }
    job.logEventId = logEventId;
    _emit('jobrunner:job-updated', job);

    // The runFn runs in the next microtask so the caller can wire up
    // cancellation on the returned object before any event fires.
    const ac = new AbortController();
    job._abortController = ac;
    const done = new Promise((resolve) => {
      queueMicrotask(async () => {
        const ctx = {
          signal: ac.signal,
          onProgress: (step, total) => {
            job.progress = { step: step | 0, total: total | 0 };
            _emit('jobrunner:job-updated', job);
          },
          onSecondary: (line) => _addLogSecondary(job, line),
          onWarn: (msg) => _addLogSecondary(job, '[warn] ' + msg),
        };
        let result = null;
        let threw = null;
        try {
          result = await opts.runFn(ctx);
        } catch (e) {
          threw = e;
        }
        const outputPaths = (result && Array.isArray(result.outputPaths)) ? result.outputPaths : [];
        if (ac.signal.aborted) {
          _markJobDone(job, 'cancel', threw ? (threw.message || String(threw)) : null, ['Cancelled by user.'], outputPaths);
        } else if (threw) {
          _markJobDone(job, 'err', threw.message || String(threw), ['Error: ' + (threw.message || String(threw))], outputPaths);
        } else if (result && result.status === 'warn') {
          _markJobDone(job, 'warn', null, result.details || [], outputPaths);
        } else if (result && result.status === 'err') {
          _markJobDone(job, 'err', result.error || null, result.details || [], outputPaths);
        } else if (result && result.status === 'cancel') {
          // v1.1 (audit AUDIT-13): in the rare case a runFn returns
          // {status: 'cancel'} WITHOUT going through the abort
          // signal (e.g. a programmatic cancel), map it to
          // 'cancel' instead of falling through to 'ok'. The abort
          // path above covers the common case (user clicks Cancel
          // → ac.signal.aborted === true), but this branch
          // protects future callers.
          _markJobDone(job, 'cancel', null, ['Cancelled.'], outputPaths);
        } else {
          _markJobDone(job, 'ok', null, result && result.details ? result.details : [], outputPaths);
        }
        resolve({ job, status: job.status, error: job.error });
      });
    });

    return { jobId: job.id, cancel: () => _cancelJob(job), done };
  }

  function _cancelJob(job) {
    if (!job || job.status !== 'wip') return;
    job._cancellable = false;
    if (job._abortController) {
      try { job._abortController.abort('user-cancel'); } catch (_) { /* ignore */ }
    }
    // The runFn is expected to honour the abort signal. We DON'T
    // delete the job here — _markJobDone will fire when the runFn
    // resolves / rejects and the cleanup below keeps the row visible
    // long enough for the user to see the cancel colour.
    if (typeof window !== 'undefined' && window.api && typeof window.api.mmxCancel === 'function') {
      // bug-fix H4/Phase1 (_temp4.md): pass the jobId so main can kill
      // ONLY this job's mmx proc (src/mmx.js#cancelByJobId), not every
      // in-flight generation on every tab. Requires the tab handler to
      // route its mmx call through mmxRunJob({ args, jobId: job.id })
      // — if it doesn't (legacy mmxRun, no jobId tracked on the main
      // side), main falls through to a no-op for this jobId rather
      // than silently cancelling unrelated jobs.
      try { window.api.mmxCancel({ jobId: job.id }); } catch (_) { /* ignore */ }
    }
  }

  function cancel(jobId) {
    const job = _jobs.get(jobId);
    if (job) _cancelJob(job);
  }
  function cancelAll() {
    for (const j of _jobs.values()) {
      if (j.status === 'wip') _cancelJob(j);
    }
  }

  // bug-fix H3 (_temp4.md): app.js's graceful-shutdown handler already
  // calls window.JobRunner.flushBatchSummaries() (guarded by
  // typeof === 'function'), but the method never existed — a silent
  // no-op, so in-flight jobs' summaries were never flushed on quit.
  // Any job still wip when the app is about to exit is interrupted
  // (its mmx child is about to be killed along with the process), so
  // we persist an honest 'cancel' record rather than silently
  // dropping it from history.
  function flushBatchSummaries() {
    for (const job of _jobs.values()) {
      if (job.status === 'wip') {
        job.status = 'cancel';
        job.finishedAt = new Date();
        if (!job.error) job.error = 'Interrupted by app shutdown.';
        _pushJobSnapshot(job);
      }
    }
  }

  // ---- expose ----
  window.JobRunner = {
    run,
    cancel,
    cancelAll,
    jobsForTab,
    isTabRunning,
    activeJobs,
    attachSecondaryToJob,
    flushBatchSummaries,
    on,
    off,
    HARD_CAP,
  };
})();
