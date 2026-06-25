// renderer/audioCutter.js
// The "✂ Audio cut…" modal — the renderer half of the audio-trim feature.
//
// History / why this file exists: the right-click "✂ Audio cut…" menu
// (fileBrowser2b.js) and the bulk "✂ Trim" toolbar button (app.js) both
// call window.showAudioCutter(path). The full main-process backend
// (audio:probe / decodePeaks / findZeroCrossing / trimSilence / cut)
// and all the .ac-* CSS were shipped, but the renderer module that draws
// the waveform UI and wires it to the backend was never committed — so
// every invocation hit the "Audio cutter module not loaded." fallback.
// This file implements that missing module.
//
// What it does:
//   - probes the file (duration / codec / sample-rate / channels),
//   - decodes a downsampled peak list and draws a mirror waveform on a
//     <canvas>,
//   - lets the user set a start + end selection by dragging on the
//     waveform or dragging the two markers, or by typing m:ss.mmm times,
//   - previews the selection with an <audio> element (play / stop, with
//     a moving play cursor),
//   - offers a one-click "Auto-detect silence" that calls trimSilence,
//   - exports the trimmed range via audio:cut (optional micro-fade to
//     mask edge clicks; optional lossless stream-copy), then refreshes
//     the folder browser so the new file appears.
//
// Everything is best-effort and non-throwing: any backend failure shows
// the inline .ac-error banner / a toast instead of rejecting.

(function () {
  const el = window.el || window.createElement || ((t) => document.createElement(t));

  // ---- small helpers ----------------------------------------------------
  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.round((sec - Math.floor(sec)) * 1000);
    return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  }
  // Parse "m:ss.mmm", "ss.mmm", or a bare seconds number.
  // v1.1 (audit BUG-N5): the previous version split on EVERY
  // `:` and took parts[0] (minutes) and parts[1] (seconds).
  // An input like "1:2:3" would split into ["1","2","3"], and
  // parseFloat("2") + parseFloat("3") would silently swallow
  // the "3" — the user got 1*60 + 2 = 62 seconds when they
  // probably meant an error or 3723 seconds. We now accept
  // AT MOST ONE colon: anything more is rejected with NaN
  // so the input field's onChange handler can surface a
  // "invalid format" error.
  function parseTime(str) {
    if (str == null) return NaN;
    str = String(str).trim();
    if (!str) return NaN;
    if (str.includes(':')) {
      const parts = str.split(':');
      if (parts.length > 2) return NaN; // v1.1: too many colons
      const m = parseFloat(parts[0]);
      const s = parseFloat(parts[1]);
      if (!isFinite(m) || !isFinite(s)) return NaN;
      return m * 60 + s;
    }
    const v = parseFloat(str);
    return isFinite(v) ? v : NaN;
  }
  function baseName(p) {
    const s = String(p || '').replace(/\\/g, '/');
    const i = s.lastIndexOf('/');
    return i >= 0 ? s.slice(i + 1) : s;
  }
  function dirName(p) {
    const s = String(p || '');
    const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
    return i >= 0 ? s.slice(0, i) : '';
  }
  function extOf(name) {
    const b = baseName(name);
    const i = b.lastIndexOf('.');
    return i > 0 ? b.slice(i + 1).toLowerCase() : '';
  }
  function stripExt(name) {
    const b = baseName(name);
    const i = b.lastIndexOf('.');
    return i > 0 ? b.slice(0, i) : b;
  }
  function joinPath(dir, name) {
    if (!dir) return name;
    const sep = dir.includes('\\') ? '\\' : '/';
    return dir.replace(/[\\/]+$/, '') + sep + name;
  }
  const toast = (m, k, ms) => (typeof window.toast === 'function' ? window.toast(m, k, ms) : undefined);
  // v1.1.26: single-line breadcrumb helper for the audio-cut
  // modal — saves ~10 lines vs. repeating the logAction call
  // pattern at every site.
  const _logAct = (act, det) => { if (typeof window.logAction === 'function') window.logAction('audio-cut', act, det); };
  const _logWarn = (act, det) => { if (typeof window.logWarn === 'function') window.logWarn('audio-cut', act, det); };

  async function showAudioCutter(srcPath) {
    if (!srcPath) { toast('No file selected.', 'warn'); return; }
    if (typeof showModal !== 'function') { toast('Modal system not available.', 'err'); return; }
    if (!window.api || typeof window.api.audioProbe !== 'function') {
      _logWarn('open-failed', 'audio tools unavailable');
      toast('Audio tools are not available in this build.', 'err');
      return;
    }
    _logAct('open', { src: srcPath });

    showModal((m, close) => {
      m.classList.add('audio-cutter-modal');
      // ---- header + meta ----
      m.appendChild(el('h2', {}, ['✂ Audio cut', el('span', { class: 'ac-status', id: '' }, '')]));
      const meta = el('div', { class: 'ac-meta' }, [
        el('span', { class: 'ac-filename' }, baseName(srcPath)),
      ]);
      m.appendChild(meta);
      const errBox = el('div', { class: 'ac-error' }, '');
      m.appendChild(errBox);
      const showErr = (msg) => { errBox.textContent = msg; errBox.style.display = msg ? 'block' : 'none'; };
      // ---- waveform stage ----
      const stage = el('div', { class: 'ac-stage' });
      const canvas = el('canvas', { class: 'ac-canvas' });
      const selOverlay = el('div', { class: 'ac-sel-overlay' });
      const playCursor = el('div', { class: 'ac-play-cursor' });
      const mStart = el('div', { class: 'ac-marker ac-marker-start' }, [el('div', { class: 'ac-marker-handle' })]);
      const mEnd = el('div', { class: 'ac-marker ac-marker-end' }, [el('div', { class: 'ac-marker-handle' })]);
      stage.append(canvas, selOverlay, mStart, mEnd, playCursor);
      m.appendChild(stage);

      // ---- time row ----
      const startInp = el('input', { type: 'text', class: 'ac-time-inp', value: '0:00.000' });
      const endInp = el('input', { type: 'text', class: 'ac-time-inp', value: '0:00.000' });
      const selLabel = el('span', { class: 'ac-playtime' }, '');
      m.appendChild(el('div', { class: 'ac-time-row' }, [
        el('label', {}, 'Start'), startInp,
        el('label', {}, 'End'), endInp,
        selLabel,
      ]));

      // ---- tool row (play / stop / auto-silence / reset) ----
      const playBtn = el('button', { class: 'btn-mini', type: 'button' }, '▶ Play selection');
      const stopBtn = el('button', { class: 'btn-mini', type: 'button' }, '■ Stop');
      const silenceBtn = el('button', { class: 'btn-mini', type: 'button', title: 'Auto-detect leading / trailing silence and set the markers' }, '✨ Auto-trim silence');
      const resetBtn = el('button', { class: 'btn-mini', type: 'button', title: 'Reset the selection to the whole file' }, '↺ Whole file');
      const playtime = el('span', { class: 'ac-playtime' }, '');
      m.appendChild(el('div', { class: 'ac-tool-row' }, [playBtn, stopBtn, silenceBtn, resetBtn, playtime]));
      // ---- export row ----
      const fadeCb = el('input', { type: 'checkbox' });
      fadeCb.checked = true;
      const fadeMsInp = el('input', { type: 'number', class: 'ac-fade-ms', value: '5', min: '0', max: '200', step: '1', title: 'Fade length in milliseconds applied to both edges' });
      const losslessCb = el('input', { type: 'checkbox', title: 'Stream-copy without re-encoding (faster, lossless, but cut points snap to the nearest keyframe so they may be slightly off)' });
      const fmtSel = el('select', { class: 'ac-format', title: 'Output container / codec' });
      const srcExt = extOf(srcPath) || 'mp3';
      for (const f of ['(keep source)', 'mp3', 'wav', 'flac', 'ogg', 'm4a', 'opus']) {
        const v = f === '(keep source)' ? srcExt : f;
        fmtSel.appendChild(el('option', { value: v }, f === '(keep source)' ? `Keep source (.${srcExt})` : `.${f}`));
      }
      const nameInp = el('input', { type: 'text', class: 'ac-name-inp', value: `${stripExt(srcPath)}_trim.${srcExt}` });
      const exportBtn = el('button', { class: 'primary', type: 'button' }, '✂ Export trimmed clip');
      m.appendChild(el('div', { class: 'ac-tool-row' }, [
        el('label', {}, [fadeCb, 'Fade edges']), fadeMsInp, el('span', {}, 'ms'),
        el('label', {}, [losslessCb, 'Lossless (stream copy)']),
      ]));
      m.appendChild(el('div', { class: 'ac-exp-row' }, [
        el('label', {}, 'Format'), fmtSel,
        el('label', {}, 'Save as'), nameInp,
        el('span', { class: 'ac-ctrl-spacer' }),
        exportBtn,
      ]));

      // close row
      m.appendChild(el('div', { class: 'footer' }, [el('button', { type: 'button', onclick: close }, 'Close')]));
      // ---- state ----
      let duration = 0;
      let peaks = null;       // Float32Array-like (plain array from IPC)
      let peakAbsMax = 1;
      let startSec = 0;
      let endSec = 0;
      let dragging = null;    // 'start' | 'end' | 'new' | null
      const audio = new Audio();
      audio.src = (window.FileUrl ? window.FileUrl.fileUrl(srcPath) : ('file:///' + String(srcPath).replace(/\\/g, '/'))) + '?t=' + Date.now();
      audio.preload = 'metadata';

      function stageWidth() { return stage.clientWidth || 1; }
      function secToX(sec) { return duration > 0 ? (sec / duration) * stageWidth() : 0; }
      function xToSec(x) { return duration > 0 ? Math.max(0, Math.min(duration, (x / stageWidth()) * duration)) : 0; }

      function syncInputs() {
        startInp.value = fmtTime(startSec);
        endInp.value = fmtTime(endSec);
        const len = Math.max(0, endSec - startSec);
        selLabel.textContent = `Selection: ${fmtTime(len)} (${fmtTime(startSec)} → ${fmtTime(endSec)})`;
      }
      function layoutMarkers() {
        const sx = secToX(startSec);
        const ex = secToX(endSec);
        mStart.style.transform = `translateX(${sx}px)`;
        mEnd.style.transform = `translateX(${ex}px)`;
        selOverlay.style.left = Math.min(sx, ex) + 'px';
        selOverlay.style.width = Math.abs(ex - sx) + 'px';
      }
      function drawWave() {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const dpr = window.devicePixelRatio || 1;
        const w = stageWidth();
        const h = stage.clientHeight || 200;
        canvas.width = Math.max(1, Math.floor(w * dpr));
        canvas.height = Math.max(1, Math.floor(h * dpr));
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        if (!peaks || !peaks.length) {
          ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--fg-3') || '#888';
          ctx.font = '12px sans-serif';
          ctx.fillText('Decoding waveform…', 10, h / 2);
          return;
        }
        const mid = h / 2;
        const norm = peakAbsMax > 0 ? peakAbsMax : 1;
        const accent = (getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#4d9aff').trim() || '#4d9aff';
        ctx.strokeStyle = (getComputedStyle(document.documentElement).getPropertyValue('--fg-2') || '#aaa').trim();
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = 0; x < w; x++) {
          const b = Math.floor((x / w) * peaks.length);
          const amp = (peaks[b] || 0) / norm * (mid - 2);
          ctx.moveTo(x + 0.5, mid - amp);
          ctx.lineTo(x + 0.5, mid + amp);
        }
        ctx.stroke();
        // centre line
        ctx.strokeStyle = accent;
        ctx.globalAlpha = 0.25;
        ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      function redraw() { drawWave(); layoutMarkers(); syncInputs(); }

      // ---- pointer interaction on the stage ----
      function clampSel() {
        startSec = Math.max(0, Math.min(duration, startSec));
        endSec = Math.max(0, Math.min(duration, endSec));
        if (endSec < startSec) { const t = startSec; startSec = endSec; endSec = t; }
      }
      function nearestMarker(x) {
        const ds = Math.abs(x - secToX(startSec));
        const de = Math.abs(x - secToX(endSec));
        return ds <= de ? 'start' : 'end';
      }
      function onPointerDown(e) {
        if (!duration) return;
        const rect = stage.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const target = e.target;
        if (target === mStart || mStart.contains(target)) dragging = 'start';
        else if (target === mEnd || mEnd.contains(target)) dragging = 'end';
        else {
          // Click on the waveform: if close to a marker grab it, else
          // start a brand-new selection from this point.
          const near = nearestMarker(x);
          const dist = Math.abs(x - secToX(near === 'start' ? startSec : endSec));
          if (dist < 8) dragging = near;
          else { startSec = xToSec(x); endSec = startSec; dragging = 'new'; }
        }
        try { stage.setPointerCapture(e.pointerId); } catch (_) {}
        onPointerMove(e);
      }
      function onPointerMove(e) {
        if (!dragging) return;
        const rect = stage.getBoundingClientRect();
        const sec = xToSec(e.clientX - rect.left);
        if (dragging === 'start') startSec = sec;
        else if (dragging === 'end') endSec = sec;
        else if (dragging === 'new') endSec = sec;
        clampSel();
        redraw();
      }
      function onPointerUp(e) {
        if (!dragging) return;
        dragging = null;
        try { stage.releasePointerCapture(e.pointerId); } catch (_) {}
        clampSel();
        redraw();
      }
      stage.addEventListener('pointerdown', onPointerDown);
      stage.addEventListener('pointermove', onPointerMove);
      stage.addEventListener('pointerup', onPointerUp);
      stage.addEventListener('pointercancel', onPointerUp);

      // ---- time input editing ----
      startInp.addEventListener('change', () => {
        const v = parseTime(startInp.value);
        if (isFinite(v)) { startSec = v; clampSel(); redraw(); } else syncInputs();
      });
      endInp.addEventListener('change', () => {
        const v = parseTime(endInp.value);
        if (isFinite(v)) { endSec = v; clampSel(); redraw(); } else syncInputs();
      });

      // ---- playback ----
      let rafId = null;
      function tickCursor() {
        if (audio.paused) { rafId = null; return; }
        const x = secToX(audio.currentTime);
        playCursor.style.transform = `translateX(${x}px)`;
        playtime.textContent = fmtTime(audio.currentTime);
        if (audio.currentTime >= endSec) { audio.pause(); }
        rafId = requestAnimationFrame(tickCursor);
      }
      function stopPlay() {
        try { audio.pause(); } catch (_) {}
        playCursor.style.display = 'none';
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;
      }
      playBtn.addEventListener('click', () => {
        if (!duration) return;
        try {
          audio.currentTime = startSec;
          playCursor.style.display = 'block';
          audio.play().then(() => { if (!rafId) rafId = requestAnimationFrame(tickCursor); }).catch(() => {});
        } catch (_) {}
      });
      stopBtn.addEventListener('click', stopPlay);

      resetBtn.addEventListener('click', () => { startSec = 0; endSec = duration; clampSel(); redraw(); });

      silenceBtn.addEventListener('click', async () => {
        silenceBtn.disabled = true; silenceBtn.textContent = 'Detecting…';
        try {
          // v1.1 (advanced pipeline settings): forward the
          // user-tuned silence-detection values when present.
          // The wrapper falls back to -50 dB / 50 ms when the
          // advanced overlay has never been opened.
          const adv = (window.state && window.state.pipelineAdvancedSettings && window.state.pipelineAdvancedSettings.audio) || {};
          const r = await window.api.audioTrimSilence(srcPath, {
            thresholdDb: adv.silenceThresholdDb,
            minSilenceMs: adv.minSilenceMs,
          });
          if (r && r.ok) {
            startSec = r.startSec || 0;
            endSec = (r.endSec != null) ? r.endSec : duration;
            clampSel(); redraw();
            if (r.note) toast(`Silence detection: ${r.note}`, 'warn', 4000);
            else toast(`Trimmed ${fmtTime(r.leadSilenceSec || 0)} lead + ${fmtTime(r.tailSilenceSec || 0)} tail.`, 'ok', 3000);
          } else {
            showErr('Silence detection failed: ' + ((r && r.error) || 'unknown'));
          }
        } catch (e) { showErr('Silence detection error: ' + (e && e.message || e)); }
        silenceBtn.disabled = false; silenceBtn.textContent = '✨ Auto-trim silence';
      });

      // Keep the output extension in sync with the chosen format.
      fmtSel.addEventListener('change', () => {
        const ext = fmtSel.value || srcExt;
        nameInp.value = stripExt(nameInp.value) + '.' + ext;
      });

      exportBtn.addEventListener('click', async () => {
        showErr('');
        _logAct('click-export', { src: srcPath, has_duration: !!duration });
        if (!duration) { _logWarn('export-blocked', 'no-duration'); showErr('Audio not loaded yet.'); return; }
        clampSel();
        if (endSec - startSec < 0.02) { _logWarn('export-blocked', 'selection-too-short'); showErr('Selection is too short (min 20 ms).'); return; }
        const outName = (nameInp.value || '').trim();
        if (!outName) { _logWarn('export-blocked', 'no-name'); showErr('Enter an output file name.'); return; }
        const dstPath = joinPath(dirName(srcPath), baseName(outName));
        _logAct('export-start', { src: srcPath, dst: dstPath });
        exportBtn.disabled = true; exportBtn.textContent = 'Exporting…';
        stopPlay();
        // v1.1.15 (reported by user): the previous version
        // never logged audio trim actions. Log the start
        // here so the user can see the trim ran, and the
        // success/failure at the end (with a groupId so
        // they cluster visually). Same pattern as the
        // image pipeline (upscale / crop / convert /
        // optimize).
        const cutGroup = 'cut-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
        const addLog = (opts) => {
          if (typeof window.addLogEvent === 'function') {
            try { window.addLogEvent(opts); } catch (_) { /* best-effort */ }
          }
        };
        addLog({
          category: 'gen',
          groupId: cutGroup,
          headline: `Audio trim started: ${baseName(srcPath)}`,
          details: [
            `Source: ${srcPath}`,
            `Selection: ${fmtTime(startSec)} → ${fmtTime(endSec)} (${(endSec - startSec).toFixed(2)}s)`,
            `Fade: ${fadeCb.checked ? Math.max(0, parseInt(fadeMsInp.value, 10) || 0) + 'ms' : 'off'}`,
            `Lossless: ${!!losslessCb.checked}`,
            `Output: ${baseName(outName)}`,
          ],
        });
        try {
          // v1.1 (advanced pipeline settings): forward the
          // user-tuned codec quality values when present.
          const adv = (window.state && window.state.pipelineAdvancedSettings && window.state.pipelineAdvancedSettings.audio) || {};
          const r = await window.api.audioCut(srcPath, dstPath, {
            startSec, endSec,
            fade: !!fadeCb.checked,
            fadeMs: Math.max(0, parseInt(fadeMsInp.value, 10) || 0),
            copy: !!losslessCb.checked,
            quality: {
              mp3Quality: adv.mp3Quality,
              oggQuality: adv.oggQuality,
              opusBitrate: adv.opusBitrate,
              m4aBitrate: adv.m4aBitrate,
            },
          });
          if (r && r.ok) {
            addLog({
              category: 'gen',
              groupId: cutGroup,
              result: 'ok',
              headline: `Audio trim complete: ${baseName(r.outputPath || dstPath)}`,
              details: [`Output: ${r.outputPath || dstPath}`],
            });
            toast(`Saved trimmed clip: ${baseName(r.outputPath || dstPath)}`, 'ok', 4000);
            if (typeof refreshBrowser === 'function') { try { await refreshBrowser(); } catch (_) {} }
            close();
          } else {
            addLog({
              category: 'error',
              groupId: cutGroup,
              result: 'err',
              headline: `Audio trim failed: ${(r && r.error) || 'unknown error'}`,
            });
            showErr('Export failed: ' + ((r && r.error) || 'unknown error'));
          }
        } catch (e) {
          addLog({
            category: 'error',
            groupId: cutGroup,
            result: 'err',
            headline: `Audio trim failed: ${(e && e.message) || e}`,
          });
          showErr('Export error: ' + (e && e.message || e));
        }
        exportBtn.disabled = false; exportBtn.textContent = '✂ Export trimmed clip';
      });

      // Redraw on window resize so the canvas + markers stay aligned.
      const onResize = () => redraw();
      window.addEventListener('resize', onResize);

      // Tidy up (stop playback, drop the resize listener, release the
      // audio element) whenever the modal is removed — Esc, the Close
      // button, and the X all funnel through showModal's m.remove().
      const origRemove = m.remove.bind(m);
      m.remove = () => {
        stopPlay();
        window.removeEventListener('resize', onResize);
        try { audio.src = ''; } catch (_) {}
        origRemove();
      };

      // ---- load: probe + decode peaks ----
      (async () => {
        try {
          const p = await window.api.audioProbe(srcPath);
          if (!p || !p.ok) { showErr('Could not read the audio file: ' + ((p && p.error) || 'unknown')); return; }
          duration = p.duration || 0;
          endSec = duration;
          meta.append(
            el('span', { class: 'ac-meta-sep' }, '·'),
            el('span', {}, `${fmtTime(duration)}`),
            el('span', { class: 'ac-meta-sep' }, '·'),
            el('span', {}, `${p.sampleRate || '?'} Hz`),
            el('span', { class: 'ac-meta-sep' }, '·'),
            el('span', {}, `${p.channels === 1 ? 'mono' : (p.channels === 2 ? 'stereo' : (p.channels + 'ch'))}`),
            el('span', { class: 'ac-meta-sep' }, '·'),
            el('span', {}, (p.codec || p.format || '').toUpperCase()),
          );
          syncInputs();
          layoutMarkers();
          drawWave();
          // Decode peaks for the whole file (no PCM — the fade option
          // already masks edge clicks, so we don't need zero-crossing).
          const pk = await window.api.audioDecodePeaks(srcPath, { maxBuckets: 2000, withPcm: false });
          if (pk && pk.ok && Array.isArray(pk.peaks)) {
            peaks = pk.peaks;
            peakAbsMax = pk.peakAbsMax || 1;
          } else {
            showErr('Waveform preview unavailable: ' + ((pk && pk.error) || 'decode failed') + ' (you can still trim by typing times).');
          }
          redraw();
        } catch (e) {
          showErr('Failed to load audio: ' + (e && e.message || e));
        }
      })();

      // First layout after the modal is on screen (clientWidth is 0
      // until then).
      requestAnimationFrame(() => redraw());
    }, { id: 'audio-cutter:' + srcPath });
  }

  window.showAudioCutter = showAudioCutter;
})();
