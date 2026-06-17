// renderer/utils/dropTarget.js
// Drag-and-Drop-Target-Setup für den File-Browser.
// Phase 3 Block 13: aus app.js extrahiert.

/**
 * Markiert ein Element als Drag-and-Drop-Target. Wenn eine Datei
 * (oder ".."-Eintrag) aus dem File-Browser drauf gedroppt wird,
 * wird sie nach `destDir` verschoben. Hebt das Element während
 * eines Drag-Over visuell hervor.
 *
 * Erwartet `window.toast` (ToastService) und `window.refreshBrowser`.
 *
 * @param {HTMLElement} elNode  Das Ziel-Element (z. B. ein Verzeichnis-Listen-Eintrag)
 * @param {string} destDir      Ziel-Verzeichnis (absoluter Pfad)
 */
function attachDropTarget(elNode, destDir) {
  if (!elNode || !destDir) return;
  elNode.addEventListener('dragover', (e) => {
    // Only accept our internal MIME type; ignore OS file drops.
    if (Array.from(e.dataTransfer.types || []).includes('application/x-minimax-fb')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      elNode.classList.add('fb-drop-target');
    }
  });
  elNode.addEventListener('dragleave', () => {
    elNode.classList.remove('fb-drop-target');
  });
  elNode.addEventListener('drop', async (e) => {
    e.preventDefault();
    elNode.classList.remove('fb-drop-target');
    const path = e.dataTransfer.getData('application/x-minimax-fb');
    if (!path) return;
    if (path.toLowerCase() === destDir.toLowerCase()) return;
    // Refuse to move a folder into itself or any descendant.
    const pLow = path.replace(/[\\/]+$/, '').toLowerCase();
    const dLow = destDir.replace(/[\\/]+$/, '').toLowerCase();
    if (dLow.startsWith(pLow + (destDir.includes('\\') ? '\\' : '/'))) {
      if (window.ToastService) window.ToastService.show('Cannot move a folder into itself.', { type: 'warn' });
      return;
    }
    const r = await window.api.fbMove(path, destDir);
    if (r.ok) {
      if (window.ToastService) window.ToastService.show('Moved.', { type: 'ok' });
      if (typeof window.refreshBrowser === 'function') await window.refreshBrowser();
    } else {
      if (window.ToastService) window.ToastService.show('Move failed: ' + (r.error || 'unknown error'), { type: 'err' });
    }
  });
}

window.DropTarget = { attachDropTarget };
