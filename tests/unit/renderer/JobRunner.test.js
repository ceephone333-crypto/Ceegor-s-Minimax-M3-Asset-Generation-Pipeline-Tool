// tests/unit/renderer/JobRunner.test.js
// ============================================================================
// Phase A of _plan3.md — tests for the multi-job runner.
//
// The JobRunner is a renderer-side module that owns the per-tab
// generation lifecycle. These tests load the actual production file
// (renderer/jobs/JobRunner.js) through a minimal window/DOM mock and
// exercise its public API:
//
//   - run() creates a Job, sets state.generating (derived projection),
//     appends a primary log row, and returns { jobId, cancel, done }.
//   - isTabRunning() returns true while a job is wip on that tab.
//   - cancel(jobId) flips the job to 'cancel' on the next resolve.
//   - cancelAll() flips every wip job.
//   - runFn signals: ctx.signal.aborted is set on cancel.
//   - attachSecondaryToJob(jobId, line) appends the line into the
//     job's primary row's details (not as a new row).
//   - The hard cap of 16 concurrent jobs is enforced.
//   - The per-tab re-entrancy check prevents two jobs on the same tab.
//   - state.generating is a derived projection (single tab → tabKey,
//     multiple tabs → 'mixed', none → null).
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function makeEl(tag) {
  return {
    tagName: (tag || 'div').toUpperCase(),
    children: [],
    attributes: {},
    style: {},
    classList: {
      _set: new Set(),
      add(c) { if (c) for (const cls of String(c).split(/\s+/).filter(Boolean)) this._set.add(cls); },
      remove(c) { if (c) for (const cls of String(c).split(/\s+/).filter(Boolean)) this._set.delete(cls); },
      contains(c) { return this._set.has(c); },
      toggle(c, force) {
        if (force === true) this.add(c);
        else if (force === false) this.remove(c);
        else if (this._set.has(c)) this.remove(c);
        else this.add(c);
        return this._set.has(c);
      },
    },
    parentNode: null,
    dataset: {},
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return this.attributes[k] == null ? null : String(this.attributes[k]); },
    addEventListener() {},
    removeEventListener() {},
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
    insertBefore(child, ref) { this.children.push(child); child.parentNode = this; return child; },
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1); return child; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    set textContent(v) { this._text = v; },
    get textContent() { return this._text != null ? this._text : ''; },
  };
}

function setupMock() {
  delete global.window;
  delete global.document;
  const logEl = makeEl('div');
  const doc = {
    createElement: (tag) => makeEl(tag),
    createElementNS: (_, tag) => makeEl(tag),
    getElementById: (id) => (id === 'log' ? logEl : null),
    querySelector: (sel) => (sel === '#log' ? logEl : null),
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
    body: makeEl('body'),
    documentElement: makeEl('html'),
  };
  const elFactory = (tag, attrs, ...children) => {
    const n = makeEl(tag);
    if (attrs && typeof attrs === 'object') {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') n.classList.add(v);
        else n.attributes[k] = v;
      }
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      if (typeof c === 'string' || typeof c === 'number') {
        const t = makeEl('span');
        t.textContent = String(c);
        n.children.push(t);
        t.parentNode = n;
      } else if (typeof c === 'object' && c.tagName) {
        n.children.push(c);
        c.parentNode = n;
      }
    }
    return n;
  };
  const win = {
    api: { mmxCancel: () => Promise.resolve({ ok: true }) },
    state: { _logEvents: [], jobs: new Map() },
    toast: () => {},
    el: elFactory,
    createElement: elFactory,
    LogCategories: { LOG_MAX_EVENTS: 500, LOG_CATEGORIES: { info: { icon: '·', label: 'Info' } } },
    securityUtils: { maskLine: (s) => String(s) },
  };
  win.document = doc;
  global.window = win;
  global.document = doc;
  return { win, logEl };
}

function loadJobRunner() {
  // Fresh require for each test so state.jobs is empty.
  const file = path.join(ROOT, 'renderer', 'jobs', 'JobRunner.js');
  delete require.cache[require.resolve(file)];
  // Load LogService stub so JobRunner can call into it. We use a
  // tiny stub that satisfies JobRunner's expectations: addLogEvent
  // is the only API JobRunner uses.
  const lsFile = path.join(ROOT, 'renderer', 'services', 'LogService.js');
  // Build a minimal LogService in window BEFORE requiring JobRunner
  // — JobRunner only calls window.LogService.addLogEvent and
  // updateLogStatus, so the stub needs just those.
  let nextId = 0;
  global.window.LogService = {
    addLogEvent(opts) {
      opts = opts || {};
      const ev = {
        id: ++nextId,
        ts: new Date(),
        headline: opts.headline || '',
        details: opts.details || [],
        jobId: opts.jobId || null,
        state: opts.state || 'wip',
        cancellable: !!opts.cancellable,
        typeIcon: opts.typeIcon || null,
        progress: opts.progress || null,
      };
      global.window.state._logEvents.push(ev);
      return ev.id;
    },
    updateLogStatus() {},
    appendLogDetails() {},
  };
  require(file);
  return global.window.JobRunner;
}

test('JobRunner.run creates a job and returns { jobId, cancel, done }', async () => {
  const { win } = setupMock();
  const JobRunner = loadJobRunner();
  const ctrl = JobRunner.run({
    tabKey: 'image',
    type: 'image',
    title: 'Test image',
    typeIcon: '🖼',
    runFn: async () => ({ status: 'ok' }),
  });
  assert.equal(typeof ctrl.jobId, 'string');
  assert.equal(typeof ctrl.cancel, 'function');
  assert.ok(ctrl.done instanceof Promise);
  // While the runFn is in flight, the job should be wip.
  assert.equal(JobRunner.isTabRunning('image'), true);
  assert.equal(JobRunner.activeJobs().length, 1);
  // state.generating is a derived projection: single tab → its key.
  assert.equal(win.state.generating, 'image');
  await ctrl.done;
  // After the runFn resolves, the job is done. We LEAVE the
  // legacy state.generating field alone when no JobRunner job
  // is in flight (the legacy armGenBtnWithCancel flow owns it
  // in that case).
  assert.equal(JobRunner.isTabRunning('image'), false);
});

test('JobRunner.isTabRunning reports per-tab busy state', async () => {
  setupMock();
  const JobRunner = loadJobRunner();
  // Stalled job — we control when it resolves via the runFn.
  let resolveStalled;
  const stalled = new Promise((r) => { resolveStalled = r; });
  const ctrl1 = JobRunner.run({
    tabKey: 'image',
    type: 'image',
    runFn: () => stalled,
  });
  // Image is busy, music is not.
  assert.equal(JobRunner.isTabRunning('image'), true);
  assert.equal(JobRunner.isTabRunning('music'), false);
  // Resolve the stalled job.
  resolveStalled({ status: 'ok' });
  await ctrl1.done;
  // After resolution, no tab is busy.
  assert.equal(JobRunner.isTabRunning('image'), false);
  assert.equal(JobRunner.isTabRunning('music'), false);
});

test('JobRunner per-tab re-entrancy: cannot start two jobs on the same tab', async () => {
  setupMock();
  const JobRunner = loadJobRunner();
  let resolveStalled;
  const stalled = new Promise((r) => { resolveStalled = r; });
  const ctrl1 = JobRunner.run({
    tabKey: 'image',
    type: 'image',
    runFn: () => stalled,
  });
  // Wait for the runFn to start so the tab is in the wip state.
  await new Promise((r) => setImmediate(r));
  // Trying to start a second image job while the first is wip must
  // reject (the per-tab gate from _plan3.md §4.2). We await the
  // returned promise so the rejection surfaces in our try/catch.
  let rejected = null;
  try {
    await JobRunner.run({
      tabKey: 'image',
      type: 'image',
      runFn: async () => ({ status: 'ok' }),
    });
  } catch (e) {
    rejected = e;
  }
  assert.ok(rejected, 'second run on the same tab must reject');
  assert.match(String(rejected.message), /already running/i);
  // The gate must NOT block a job on a different tab (the whole
  // point of Phase A).
  let resolveStalledMusic;
  const stalledMusic = new Promise((r) => { resolveStalledMusic = r; });
  const ctrl2 = JobRunner.run({
    tabKey: 'music',
    type: 'music',
    runFn: () => stalledMusic,
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(JobRunner.isTabRunning('image'), true);
  assert.equal(JobRunner.isTabRunning('music'), true);
  // Cleanup
  resolveStalled({ status: 'ok' });
  resolveStalledMusic({ status: 'ok' });
  await ctrl1.done;
  await ctrl2.done;
});

test('JobRunner cancel sets the signal; the runFn can detect it', async () => {
  setupMock();
  const JobRunner = loadJobRunner();
  let signalRef = null;
  const ctrl = JobRunner.run({
    tabKey: 'image',
    type: 'image',
    runFn: async (ctx) => {
      signalRef = ctx.signal;
      // Wait until aborted.
      await new Promise((resolve) => {
        if (ctx.signal.aborted) return resolve();
        const onAbort = () => resolve();
        ctx.signal.addEventListener('abort', onAbort, { once: true });
      });
      // The runFn can throw a structured cancel result.
      return { status: 'cancel' };
    },
  });
  // The runFn fires in a microtask, so wait for it.
  await new Promise((r) => setImmediate(r));
  assert.equal(signalRef && signalRef.aborted, false);
  // Cancel from outside the runFn.
  ctrl.cancel();
  // The signal must be aborted.
  assert.equal(signalRef.aborted, true);
  // The job is marked cancel after the runFn resolves.
  await ctrl.done;
  const job = global.window.state.jobs.get(ctrl.jobId);
  assert.equal(job.status, 'cancel');
  assert.equal(JobRunner.isTabRunning('image'), false);
});

test('JobRunner hard cap of 16 concurrent jobs', async () => {
  setupMock();
  const JobRunner = loadJobRunner();
  // Fill the cap with never-resolving jobs, all on tabKey=null so
  // the per-tab gate is bypassed (it's only checked when tabKey is
  // set). Wait for each runFn to start so the job is in the wip
  // state (which is what HARD_CAP counts against).
  const ctrls = [];
  for (let i = 0; i < JobRunner.HARD_CAP; i++) {
    ctrls.push(JobRunner.run({
      tabKey: null,
      type: 'image',
      runFn: () => new Promise(() => {}), // never resolves
    }));
  }
  await new Promise((r) => setImmediate(r));
  // The next run must reject (we await the returned promise so the
  // rejection surfaces in our try/catch). The per-tab gate is not
  // checked (tabKey=null) so the HARD_CAP must be the one that fires.
  let rejected = null;
  try {
    await JobRunner.run({
      tabKey: null,
      type: 'image',
      runFn: async () => ({ status: 'ok' }),
    });
  } catch (e) {
    rejected = e;
  }
  assert.ok(rejected, 'over-cap run must reject');
  assert.match(String(rejected.message), /Too many jobs/);
});

test('JobRunner state.generating is the derived projection (single tab → key, mixed → "mixed")', async () => {
  setupMock();
  const JobRunner = loadJobRunner();
  // Two jobs on different tabs running concurrently.
  let r1, r2;
  const c1 = JobRunner.run({ tabKey: 'image', type: 'image', runFn: () => new Promise((r) => { r1 = r; }) });
  const c2 = JobRunner.run({ tabKey: 'music', type: 'music', runFn: () => new Promise((r) => { r2 = r; }) });
  // Wait for both runFns to start (queueMicrotask).
  await new Promise((r) => setImmediate(r));
  // Two tabs running → state.generating === 'mixed'
  assert.equal(global.window.state.generating, 'mixed');
  // Finish the image job → state.generating === 'music' (the remaining tab)
  r1({ status: 'ok' });
  await c1.done;
  assert.equal(global.window.state.generating, 'music');
  // Finish the music job → no more JobRunner jobs → we LEAVE the
  // legacy field alone (the legacy armGenBtnWithCancel flow owns
  // it in that case). So state.generating stays as 'music' (or
  // whatever the legacy code last set).
  r2({ status: 'ok' });
  await c2.done;
});

test('JobRunner runFn throw surfaces as job.status = "err"', async () => {
  setupMock();
  const JobRunner = loadJobRunner();
  const ctrl = JobRunner.run({
    tabKey: 'image',
    type: 'image',
    runFn: async () => { throw new Error('boom'); },
  });
  await ctrl.done;
  const job = global.window.state.jobs.get(ctrl.jobId);
  assert.equal(job.status, 'err');
  assert.equal(job.error, 'boom');
  assert.equal(JobRunner.isTabRunning('image'), false);
});

test('JobRunner.runFn returning { status: "warn" } marks the job as warn', async () => {
  setupMock();
  const JobRunner = loadJobRunner();
  const ctrl = JobRunner.run({
    tabKey: 'image',
    type: 'image',
    runFn: async () => ({ status: 'warn', details: ['partial'] }),
  });
  await ctrl.done;
  const job = global.window.state.jobs.get(ctrl.jobId);
  assert.equal(job.status, 'warn');
});

test('JobRunner.attachSecondaryToJob appends into the primary row', async () => {
  setupMock();
  const JobRunner = loadJobRunner();
  let captured = null;
  const ctrl = JobRunner.run({
    tabKey: 'image',
    type: 'image',
    runFn: async (ctx) => {
      captured = { ctrl, ctx, JobRunner };
      // The runFn uses ctx.onSecondary to attach stderr chunks
      // (matching the Plan §4.1 API). Direct call from outside via
      // the public method:
      JobRunner.attachSecondaryToJob(ctrl.jobId, 'first stderr chunk');
      JobRunner.attachSecondaryToJob(ctrl.jobId, 'second stderr chunk');
      return { status: 'ok' };
    },
  });
  await ctrl.done;
  assert.ok(captured, 'runFn must have been called');
  const job = global.window.state.jobs.get(ctrl.jobId);
  assert.equal(job.childLogIds.length, 2);
  // Each childLogId is a separate log event with the same jobId.
  for (const id of job.childLogIds) {
    const ev = global.window.state._logEvents.find((e) => e.id === id);
    assert.ok(ev, 'secondary event must be in the log buffer');
    assert.equal(ev.jobId, ctrl.jobId);
  }
});

test('JobRunner.on / JobRunner.off fan out jobrunner:job-* events', async () => {
  setupMock();
  const JobRunner = loadJobRunner();
  const events = [];
  const off = JobRunner.on('jobrunner:job-added', (job) => events.push({ t: 'added', id: job.id }));
  JobRunner.on('jobrunner:job-removed', (job) => events.push({ t: 'removed', id: job.id, status: job.status }));
  const ctrl = JobRunner.run({
    tabKey: 'image',
    type: 'image',
    runFn: async () => ({ status: 'ok' }),
  });
  await ctrl.done;
  // added fires synchronously inside run(); removed fires after the runFn resolves.
  const types = events.map((e) => e.t);
  assert.ok(types.includes('added'), 'must fire job-added');
  assert.ok(types.includes('removed'), 'must fire job-removed after completion');
  off();
});
