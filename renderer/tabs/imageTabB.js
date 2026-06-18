// renderer/tabs/imageTabB.js (Phase 3 Block 33)
// Second half of imageTab.js (generation handler).

        // state.generating guard stays set until every post-processing
        // step has completed, matching what the UI promises.
        if (allOk && lastOutFile && !cancel.wasCancelled()) {
        // Resolve the full list of output files. For --out-dir runs
        // (--n > 1), the per-call filenames are not known to the
        // renderer (mmx writes them with its own naming scheme), so
        // we scan outDir for files that were created during this
        // run. We use the run start time + a small 1.5s pre-roll as
        // the lower bound, and "now" as the upper bound. For single-
        // file runs (useOutDir=false), we already have the file list
        // from the variant loop in `outFiles`.
        let sourceFiles = outFiles.slice();
        if (useOutDir) {
          try {
            const dirList = await window.api.fbList(outDir);
            if (dirList && dirList.ok && Array.isArray(dirList.items)) {
              const startMs = (state.genStartMs && state.genStartMs.image) || (Date.now() - 600000);
              const nowMs = Date.now();
              const matches = dirList.items
                .filter((it) => !it.isDir && ['.png', '.jpg', '.jpeg', '.webp'].includes(it.ext))
                .filter((it) => {
                  const m = it.mtimeMs || 0;
                  return m >= startMs - 1500 && m <= nowMs + 5000;
                })
                .sort((a, b) => (a.mtimeMs || 0) - (b.mtimeMs || 0));
              if (matches.length) sourceFiles = matches.map((m) => m.path);
            }
          } catch (_) { /* fall back to whatever we have */ }
        }
        // Post-processing chain: for EVERY generated file (not just
        // the last one â€” that was the bug fixed in this revision),
        // run the upscale â†’ crop â†’ remove-background â†’ optimize chain
        // and collect the final paths. Each step is independently
        // non-fatal: a failure on variant N keeps the original file
        // for variant N and continues with the next one, so the user
        // never loses an image they paid API credits to generate.
        const displayFiles = [];
        const postProcessEach = state.upscaleEnabled
          || state.removeBackgroundEnabled
          || (state.optimizeSettings && state.optimizeSettings.enabled);
        const lastIdx = sourceFiles.length - 1;
        for (let i = 0; i < sourceFiles.length; i++) {
          if (cancel.wasCancelled()) {
            // Cancel mid-chain: any files we haven't processed yet
            // stay as their raw generated path. The files we have
            // processed stay as their processed paths.
            for (let j = i; j < sourceFiles.length; j++) {
              if (!displayFiles.includes(sourceFiles[j])) displayFiles.push(sourceFiles[j]);
            }
            break;
          }
          const src = sourceFiles[i];
          const tag = sourceFiles.length > 1 ? ` (${i + 1}/${sourceFiles.length})` : '';
          try {
            if (postProcessEach) {
              const finalPath = await runPostProcessChain(src, {
                label: tag,
                onStatus: (msg) => {
                  setStatus(msg, true);
                  preview.innerHTML = `<div class="empty"><span class="spinner"></span> ${escapeHtml(msg)}</div>`;
                },
                onRefresh: () => { try { refreshBrowser(); } catch (_) {} },
              });
              displayFiles.push(finalPath);
            } else {
              displayFiles.push(src);
            }
          } catch (e) {
            // runPostProcessChain is supposed to swallow per-step
            // errors and return the best-available path, so we only
            // land here on a truly unexpected throw. Be defensive:
            // fall back to the source file so the user still gets
            // the raw generated image in the preview pane.
            console.error('Post-process failed for', src, e);
            displayFiles.push(src);
          }
          // Refresh the folder browser once per processed file so
          // the new (upscaled / no-bg / optimised) files appear in
          // the right-hand file list as soon as they're written.
          // Cheap, and the user explicitly asked for live updates
          // during batchgen (see feature #6).
          if (i === lastIdx) {
            try { await refreshBrowser(); } catch (_) {}
          }
        }
        // The last entry of displayFiles is the most recently
        // processed path â€” treat it as the canonical "last preview"
        // for legacy callers (toast messages that reference it, the
        // preview-ready message at the end, etc.). For a single-
        // file run, this is the same file as the raw generated
        // output (or its post-processed replacement).
        const displayFile = displayFiles.length ? displayFiles[displayFiles.length - 1] : lastOutFile;
        // The image tab's left-side preview no longer shows the
        // generated image â€” per the user's request, the picture
        // preview lives in the right-side folder-explorer's preview
        // pane (which subdivides into N thumbnails for N images).
        // The left-side area only carries a short status line so the
        // layout doesn't collapse but the prompt / parameter inputs
        // are no longer obscured.
        preview.innerHTML = '';
        // v1.1.1 polish: include a "â†» Regenerate" button on the
        // success state so the user can re-run the same prompt
        // with one click instead of scrolling up to the Generate
        // button. Power users iterate a lot on the same prompt
        // (e.g. trying different aspect ratios, switching the
        // seed off, etc.) and this is the single biggest workflow
        // improvement we can make to the success state.
        const readyWrap = el('div', { class: 'empty' });
        const readyMsg = el('div', { class: 'preview-ready-msg' }, [
          'âœ… ',
          String(displayFiles.length),
          (displayFiles.length === 1 ? ' image' : ' images'),
          ' ready â€” see the preview pane on the right. Click any thumbnail to open it at 1:1.',
        ]);
        const regenBtn = el('button', { class: 'btn-mini preview-regen-btn', type: 'button' }, 'â†» Regenerate');
        regenBtn.title = 'Re-run the same prompt (no changes to inputs)';
        regenBtn.addEventListener('click', () => { try { genBtn.click(); } catch (_) {} });
        readyWrap.appendChild(readyMsg);
        readyWrap.appendChild(el('div', { class: 'preview-ready-actions' }, [regenBtn]));
        preview.appendChild(readyWrap);
        try { previewImagesFromFiles(displayFiles); } catch (_) {}
        bumpGenerationCounter('image', totalImages);
        // Log a "generation completed" event so the user has
        // a single row to copy / expand that summarises the
        // run. The full file list is in the details (one per
        // line) so the user can paste it into a support
        // ticket.
        addLogEvent({
          category: 'gen',
          result: 'ok',
          headline: `Generated ${displayFiles.length} image${displayFiles.length === 1 ? '' : 's'}`,
          details: displayFiles.map((p) => 'â€¢ ' + p),
        });
      } else if (!allOk) {
        // Log a "generation failed" event so the user can copy
        // the structured error from the log pane (e.g. into a
        // support ticket). The full classified error message +
        // stderr / stdout are included in the details so the
        // helper doesn't have to ask the user "what did it
        // say?".
        try {
          const failedMsg = formatMmxError(lastFailedR || { stderr: '', stdout: '', code: -1 });
          const failedClass = classifyMmxError(lastFailedR || {}, failedMsg);
          addLogEvent({
            category: 'error',
            result: 'err',
            headline: `Image generation failed: ${failedMsg}`,
            details: [
              `Classification: ${failedClass}`,
              `Stderr: ${(lastFailedR && lastFailedR.stderr) || '(empty)'}`,
              `Stdout: ${(lastFailedR && lastFailedR.stdout) || '(empty)'}`,
              `Exit code: ${(lastFailedR && lastFailedR.code) != null ? String(lastFailedR.code) : '(unknown)'}`,
            ],
          });
        } catch (_) { /* never block the rest of the error UI on log */ }
        // Build a detailed, actionable error block. The user has been
        // hitting "API error: system error (HTTP 200)" which is opaque â€”
        // we now classify the error (auth, rate, quota, network, server,
        // unknown) and show targeted tips + buttons to diagnose / retry /
        // copy the raw error for support.
        const lastErrMsg = formatMmxError(lastFailedR || { stderr: '', stdout: '', code: -1 });
        const classification = classifyMmxError(lastFailedR || {}, lastErrMsg);
        const tips = {
          auth: [
            'Your API key may be invalid, expired, or revoked.',
            'Click "Test connection" below to verify.',
            'Re-paste your key in âš™ Settings if needed.',
          ],
          rate: [
            'The service is rate-limiting your account.',
            'Wait 30â€“60 seconds, then click Retry.',
            'Avoid running many batches back-to-back.',
          ],
          quota: [
            'Your Token Plan quota is exhausted for this model.',
            'Wait for the rolling window to reset, or upgrade your plan.',
            'Check the âš¡ quota display in the top bar.',
          ],
          network: [
            'Could not reach the service (DNS / firewall / offline).',
            'Verify your internet connection and any VPN / proxy settings.',
            'Click "Diagnose" below to check the installation.',
          ],
          server: [
            'The service returned a server-side error. Usually transient.',
            'Wait a few seconds and click Retry.',
            'If it persists, the service may be degraded â€” try again later.',
          ],
          unknown: [
            'The service returned an unrecognised error.',
            'Click "Copy error" to share the details with support.',
            'Click "Diagnose" to verify the mmx installation.',
          ],
        };
        const tipList = tips[classification] || tips.unknown;
        preview.innerHTML = '';
        const wrap = el('div', { class: 'empty preview-error' });
        wrap.appendChild(el('div', { class: 'preview-error-title' }, 'âš  Generation failed'));
        const detail = el('div', { class: 'preview-error-message' });
        detail.textContent = lastErrMsg || 'Unknown error (see log pane for details).';
        wrap.appendChild(detail);
        // Classified troubleshooting tips
        const tipsBlock = el('div', { class: 'preview-error-tips' });
        for (const t of tipList) {
          const li = el('div', { class: 'preview-error-tip' }, 'â€¢ ' + t);
          tipsBlock.appendChild(li);
        }
        wrap.appendChild(tipsBlock);
        // Action buttons: Retry / Test connection / Diagnose / Copy error
        const retryBtn = el('button', { class: 'primary' }, 'ðŸ”„ Retry');
        const testBtn = el('button', { class: 'btn-mini' }, 'ðŸ”‘ Test connection');
        const diagBtn = el('button', { class: 'btn-mini' }, 'ðŸ©º Diagnose');
        const copyBtn = el('button', { class: 'btn-mini' }, 'ðŸ“‹ Copy error');
        retryBtn.addEventListener('click', () => genBtn.click());
        testBtn.addEventListener('click', async () => {
          testBtn.disabled = true; testBtn.textContent = 'Testingâ€¦';
          const r = await window.api.authStatus();
          testBtn.disabled = false; testBtn.textContent = 'ðŸ”‘ Test connection';
          if (r.ok) {
            toast(r.message || 'API key is valid.', 'ok', 4000);
          } else {
            toast('Auth failed: ' + (r.error || 'unknown'), 'err', 6000);
          }
        });
        diagBtn.addEventListener('click', () => showDiagnose());
        copyBtn.addEventListener('click', async () => {
          const blob = JSON.stringify({
            classification,
            message: lastErrMsg,
            code: lastFailedR?.code,
            stderr: (lastFailedR?.stderr || '').slice(0, 4000),
            stdout: (lastFailedR?.stdout || '').slice(0, 4000),
            parsed: lastFailedR?.parsed,
            ts: new Date().toISOString(),
          }, null, 2);
          try {
            await navigator.clipboard.writeText(blob);
            toast('Error details copied to clipboard.', 'ok', 1500);
          } catch (_) {
            // Fallback: just toast the message
            toast('Clipboard unavailable â€” error: ' + lastErrMsg, 'warn', 6000);
          }
        });
        const actions = el('div', { class: 'preview-error-actions' }, [retryBtn, testBtn, diagBtn, copyBtn]);
        wrap.appendChild(actions);
        preview.appendChild(wrap);
        // Also surface a short toast
        const shortMsg = classification === 'auth'
          ? 'Auth failed. Click Test connection.'
          : classification === 'rate'
            ? 'Rate limited. Wait 30s and Retry.'
            : classification === 'quota'
              ? 'Quota exhausted.'
              : 'Generation failed. See preview for details.';
        toast(shortMsg, 'warn', 4000);
      }
      } catch (e) {
        threw = e;
        allOk = false;
        console.error('Image generation threw:', e);
        toast('Generation error: ' + (e && e.message || String(e)), 'err', 6000);
      } finally {
        cancel.cleanup();
        setStatus('Ready', false);
        // Always refresh â€” even on cancel/failure, partial files may exist
        // on disk and the user should see them.
        try { await refreshBrowser(); } catch {}
        try { await refreshQuota(); } catch {}
      }
      if (threw) return;
      if (cancel.wasCancelled()) {
        preview.innerHTML = '<div class="empty">Generation cancelled.</div>';
        toast('Cancelled.', 'warn');
        return;
      }
      if (allOk) {
        toast(variantsCount > 1
          ? `Image generated. ${variantsCount} variants saved.`
          : 'Image generated.', 'ok');
      }
    });
  },
};

window.ImageTab = window.TABS.image;

