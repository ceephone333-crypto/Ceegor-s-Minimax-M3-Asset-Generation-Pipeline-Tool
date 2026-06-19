// renderer/sections/section10_Tab_intro_popups.js (Phase 3 Block 29)
// Extracted: Tab intro popups
// Source: app.js L1489..1629

// ----------------- Tab intro popups -----------------
// A short, friendly "what's this tab about" popup shown the first
// time the user opens each tab. Gated by the popup policy in
// state.popupPolicy (configured in ⚙ Settings → Popups). The popup
// is rendered with the same showModal() primitive so it gets the
// full Esc/click-outside/stack behaviour. The default text is short
// on purpose: the detailed field-level help is still available via
// the `?` icons on every input.

// _pendingTabIntro / _introStartupChainOpen coordinate the
// "defer intro while the startup popup chain is running" behaviour
// (Bug: the intro used to pop up on top of the welcome / first-time
// setup / optional-addons popups). The chain includes welcome
// (section18), first-time setup (section17), and the optional add-ons
// auto-open (section15). While ANY of these is open we stash the
// requested intro tab in _pendingTabIntro instead of showing it. As
// soon as the chain drains, we fire the pending intro IF the
// requested tab is still the active one — switching tabs while the
// chain is open cancels the pending intro.
var _pendingTabIntro = null;
var _introStartupChainOpen = 0;
function _enterIntroStartupChain() {
  _introStartupChainOpen++;
}
function _maybeFirePendingTabIntro() {
  if (_introStartupChainOpen > 0) return; // chain still running
  const tabName = _pendingTabIntro;
  _pendingTabIntro = null;
  if (!tabName) return;
  // Only fire if the user is still on the same tab. If they
  // switched to another tab while the welcome popup was open,
  // they don't want a popup for the tab they navigated AWAY from.
  if (typeof state !== 'undefined' && state.currentTab === tabName) {
    // Defer one tick so the modal stack settles (the chain popup's
    // own focus-restore runs before this fires).
    setTimeout(() => {
      try { maybeShowTabIntro(tabName); } catch (_) { /* ignore */ }
    }, 0);
  }
}
function _exitIntroStartupChain() {
  if (_introStartupChainOpen > 0) _introStartupChainOpen--;
  _maybeFirePendingTabIntro();
}

function maybeShowTabIntro(tabName) {
  const intros = {
    image:  '🖼 Image tab — describe what you want to generate in the prompt, tweak the model + aspect + variants, then click Generate. Enable the Upscale / Optimize toggle to run a local pipeline after the API returns.',
    speech: '🗣 Speech tab — type or paste the text, pick a voice, then click Generate. Use the ▶ button next to each voice to hear a quick preview. The output is an MP3 (or your chosen format) saved to the folder browser on the right.',
    music:  '🎵 Music tab — describe the music you want (genre, mood, instruments, tempo). Toggle "Instrumental only" to skip vocals. Each click of Generate produces one short track and writes it to the folder browser.',
    video:  '🎬 Video tab — describe the short video you want, pick the model + resolution + duration, then click Generate. Note: Token Plan keys allow only 3 video generations per week; pay-as-you-go (PAYG) keys are billed per video with no weekly cap. Each video takes a few minutes to render.',
  };
  const text = intros[tabName];
  if (!text) return;
  openGatedPopup('tab-intro:' + tabName, (m, close, markSeen) => {
    m.classList.add('tab-intro-modal');
    const titles = { image: 'Image', speech: 'Speech', music: 'Music', video: 'Video' };
    m.appendChild(el('h2', {}, '👋 Welcome to the ' + (titles[tabName] || tabName) + ' tab'));
    m.appendChild(el('p', { style: 'color: var(--fg-2); font-size: 13px; line-height: 1.55;' }, text));
    m.appendChild(el('p', { style: 'color: var(--fg-3); font-size: 11px;' },
      'You can disable these intro popups in ⚙ Settings → Popups.'));
    m.appendChild(el('div', { class: 'footer' }, [
      el('button', { class: 'primary', onclick: () => { markSeen(); close(); } }, 'Got it'),
    ]));
    setTimeout(() => { m.querySelector('button.primary')?.focus(); }, 0);
  });
}

// Update the colored status dots on the tab buttons. The rules are:
//   - genStatus === 'running'  → red dot
//   - genStatus === 'done' and tab !== currentTab → green dot
//   - genStatus === 'done' and tab === currentTab → no dot (the user has
//     effectively "seen" the result by switching into the tab)
//   - genStatus === 'idle'     → no dot
function refreshTabStatusDots() {
  for (const tabKey of ['image', 'speech', 'music', 'video']) {
    const t = $(`.tab[data-tab="${tabKey}"]`);
    if (!t) continue;
    // Remove any prior dot
    t.classList.remove('tab-dot-red', 'tab-dot-green');
    const st = state.genStatus[tabKey] || 'idle';
    if (st === 'running') t.classList.add('tab-dot-red');
    else if (st === 'done' && state.currentTab !== tabKey) t.classList.add('tab-dot-green');
  }
  refreshTabEtas();
}

// Per-tab ETA timer. While a generation is running, show a small mm:ss
// countdown next to the tab label, based on the average time of the last
// successful generation in that tab. For batch runs (variants, --n > 1),
// the countdown reflects the TOTAL remaining time for all items in the
// queue (current item + future items). As each item completes, the
// running average is updated and the ETA is recomputed on the next
// 1-second tick. The countdown is an estimate, not a guarantee — but it
// gives the user a sense of how long the current call will still take.
function refreshTabEtas() {
  for (const tabKey of ['image', 'speech', 'music', 'video']) {
    const t = $(`.tab[data-tab="${tabKey}"]`);
    if (!t) continue;
    // Lazily create the eta span the first time we need it.
    let eta = t.querySelector('.tab-eta');
    if (!eta) {
      eta = el('span', { class: 'tab-eta' }, '');
      t.appendChild(eta);
    }
    eta.textContent = _formatTabEta(tabKey);
  }
}
function _formatTabEta(tabKey) {
  const status = state.genStatus[tabKey];
  if (status !== 'running') return '';
  const start = state.genStartMs && state.genStartMs[tabKey];
  if (!start) return '...';
  // Use the running average if we have one; otherwise a sensible per-tab
  // default so the user always sees an estimate even on the very first
  // generation. (If they only see "...", the timer looks broken.)
  let avg = (state.genAvgSec && state.genAvgSec[tabKey]) || 0;
  if (!avg) {
    const defaults = { image: 35, speech: 12, music: 75, video: 90 };
    avg = defaults[tabKey] || 30;
  }
  // Total queue size for the current run (variants × n, where n is the
  // --n count). When the gen handler kicks off, it sets
  // state.genQueueSize[tabKey] and increments state.genQueueDone[tabKey]
  // after each completed item. -1 for "the item currently in flight".
  const queueSize = Math.max(1, (state.genQueueSize && state.genQueueSize[tabKey]) || 1);
  const queueDone = Math.max(0, (state.genQueueDone && state.genQueueDone[tabKey]) || 0);
  const itemsLeft = Math.max(1, queueSize - queueDone);
  // How much of the CURRENT item is still pending. When the user just
  // kicked off the run, genStartMs is the start of the whole run (not
  // the current item), so we approximate per-item elapsed as
  // (now - runStart) / itemsLeft. This is a slight underestimate for
  // the first few items (a long first item pushes the per-item avg up),
  // but it's the best we can do without per-item timestamps and it
  // self-corrects as soon as the first item finishes. Clamp to [0, avg]
  // so a race condition (e.g. startMs=0 right after arm) can't produce
  // a negative remaining time.
  const runElapsed = Math.max(0, (Date.now() - start) / 1000);
  const rawPerItem = runElapsed / itemsLeft;
  const currentItemElapsed = Math.max(0, Math.min(avg, rawPerItem));
  const currentItemRemaining = Math.max(0, avg - currentItemElapsed);
  const futureItems = Math.max(0, itemsLeft - 1);
  const futureTime = futureItems * avg;
  const totalRemaining = currentItemRemaining + futureTime;
  // If the user just kicked off the run and genQueueSize hasn't been
  // written yet (race during the first tick), itemsLeft === 1 so we
  // fall back to the old "remaining for the current item only" math.
  const remaining = Math.max(0, Math.round(totalRemaining));
  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  return `- ${m}:${String(s).padStart(2, '0')}`;
}
// Update the ETA once a second while a tab is running. Cheap text update —
// the tab has only 4 instances.
let _etaTimer = null;
function ensureEtaTimer() {
  if (_etaTimer) return;
  _etaTimer = setInterval(() => {
    let anyRunning = false;
    for (const k of ['image', 'speech', 'music', 'video']) {
      if (state.genStatus[k] === 'running') { anyRunning = true; break; }
    }
    if (!anyRunning) {
      clearInterval(_etaTimer);
      _etaTimer = null;
      // Clear the ETA labels one last time.
      for (const k of ['image', 'speech', 'music', 'video']) {
        const t = $(`.tab[data-tab="${k}"]`);
        if (!t) continue;
        const eta = t.querySelector('.tab-eta');
        if (eta) eta.textContent = '';
      }
      return;
    }
    refreshTabEtas();
  }, 1000);
}

