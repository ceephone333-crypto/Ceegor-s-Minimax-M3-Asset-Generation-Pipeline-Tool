// renderer/sections/section01_Diagnose_dialog.js (Phase 3 Block 29)
// Extracted: Diagnose dialog
// Source: app.js L4718..4776

// ----------------- Diagnose dialog -----------------
// Read-only diagnostic dump that walks the user through what the
// app sees on their machine: platform, Electron + Node versions,
// the node.exe and CLI entry it found, API key presence, region.
// Opened from the "Diagnose" button in ⚙ Settings → General.
// Useful when "Test connection" fails and the user wants to know
// which prerequisite is missing (e.g. mmx-cli not installed,
// node.js not on PATH, wrong region).
function showDiagnose() {
  showModal(async (m, close) => {
    m.appendChild(el('h2', {}, 'Diagnose'));
    m.appendChild(el('p', { style: 'color: var(--fg-2); font-size: 12px; margin-top: 0;' },
      'Shows what the app sees on your machine. Useful when "Test connection" fails — copy the output and share it with support if you need help.'));
    const box = el('pre', { style: 'background: var(--bg-3); padding: 10px; border-radius: var(--radius); font-size: 12px; white-space: pre-wrap; max-height: 50vh; overflow: auto;' }, 'Loading…');
    m.appendChild(box);

    const d = await window.api.diagnose();
    const lines = [
      `Platform:               ${d.platform}`,
      `Electron version:       ${d.electronVersion}`,
      `Node version:           ${d.nodeVersion}`,
      `Detected node.exe:      ${d.nodePath || '(NOT FOUND)'}`,
      `Detected mmx-cli entry: ${d.mmxEntry || '(NOT FOUND)'}`,
      `Region:                 ${d.region || 'global'}`,
      `API key present:        ${d.apiKeyPresent ? 'yes' : 'no'}`,
      `API key length:         ${d.apiKeyLength} chars`,
      '',
      d.error ? '⚠ ' + d.error : '✓ All prerequisites found.',
    ];
    box.textContent = lines.join('\n');

    if (d.nodePath && d.mmxEntry) {
      const test = el('button', { class: 'btn-mini' }, 'Run real quota test');
      m.appendChild(el('div', { style: 'margin-top: 12px;' }, test));
      const out = el('pre', { style: 'background: var(--bg-3); padding: 10px; border-radius: var(--radius); font-size: 12px; white-space: pre-wrap; max-height: 200px; overflow: auto; margin-top: 8px; display: none;' });
      m.appendChild(out);
      test.addEventListener('click', async () => {
        test.disabled = true; test.innerHTML = '<span class="spinner"></span> Running…';
        out.style.display = 'block';
        out.textContent = 'Running quota check…\n';
        const r = await window.api.authStatus();
        out.textContent += `exit code: ${r.code ?? 'n/a'}\n`;
        out.textContent += `ok flag:   ${r.ok}\n`;
        out.textContent += `error:     ${r.error || '(none)'}\n`;
        out.textContent += `command:   ${r.command || '(none)'}\n`;
        if (r.argv) out.textContent += `argv:      ${r.argv.join(' ')}\n`;
        test.disabled = false; test.textContent = 'Run real quota test';
      });
    }

    m.appendChild(el('div', { class: 'footer' }, el('button', { onclick: close }, 'Close')));
  });
}

// Phase 3: exportiere showHelp auf window, damit
// components/HelpButton.js (und zukünftige Help-Module) es aufrufen
// können, ohne den Function-Scope zu verlassen.
window.showHelp = showHelp;

