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
      _abortController: null,  // AbortController for the runFn signal
      _cancellable: true,      // matches opts.cancellable
    };
  }

  function _addLogSecondary(job, line) {
    if (!job || !line) return;
    const Log = (typeof window !== 'undefined' && window.LogService) || null;
    if (!Log || typeof Log.addLogEvent !== 'function') return;
    // Cap secondary events per job to avoid runaway log spam.
    if (job.childLogIds.length >= 500) {
      // Drop the oldest. Cheap: we keep an array, the DOM stays small
      // because the details section is the only place they're rendered.
      job.childLogIds.shift();
    }
    const evId = Log.addLogEvent({
      category: 'info',
      headline: String(line).slice(0, 200),
      details: [String(line)],
      jobId: job.id,
      // _internal: true tells addLogEvent NOT to route through
      // attachSecondaryToJob again (would be infinite recursion).
      _internal: true,
    });
    if (evId != null) job.childLogIds.push(evId);
  }

  function _markJobDone(job, status, errorMsg, details) {
    job.status = status;
    job.finishedAt = new Date();
    if (errorMsg) job.error = String(errorMsg).slice(0, 500);
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
    _emit('jobrunner:job-removed', job);
    _syncLegacyGenerating();
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
    if (_jobs.size >= HARD_CAP) {
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
    _emit('jobrunner:job-added', job);
    _syncLegacyGenerating();

    // Append the primary log row up front. The caller gets a stable
    // logEventId back so it can attach stderr chunks etc.
    let logEventId = null;
    if (typeof window !== 'undefined' && window.LogService && window.LogService.addLogEvent) {
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
        if (ac.signal.aborted) {
          _markJobDone(job, 'cancel', threw ? (threw.message || String(threw)) : null, ['Cancelled by user.']);
        } else if (threw) {
          _markJobDone(job, 'err', threw.message || String(threw), ['Error: ' + (threw.message || String(threw))]);
        } else if (result && result.status === 'warn') {
          _markJobDone(job, 'warn', null, result.details || []);
        } else if (result && result.status === 'err') {
          _markJobDone(job, 'err', result.error || null, result.details || []);
        } else {
          _markJobDone(job, 'ok', null, result && result.details ? result.details : []);
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
    if (typeof window !== 'undefined' && window.api && typeof window.api.mmxCancel === 'function' && job.tab) {
      // Best-effort: ask main to kill any in-flight mmx child for this
      // tab. Phase A keeps the legacy `mmx:cancel` (panic) behaviour
      // for simplicity; the per-proc cancel is Phase B+.
      try { window.api.mmxCancel(); } catch (_) { /* ignore */ }
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

  // ---- expose ----
  window.JobRunner = {
    run,
    cancel,
    cancelAll,
    jobsForTab,
    isTabRunning,
    activeJobs,
    attachSecondaryToJob,
    on,
    off,
    HARD_CAP,
  };
})();
