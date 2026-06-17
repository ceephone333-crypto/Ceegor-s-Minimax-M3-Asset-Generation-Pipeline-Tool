// renderer/core/ToastService.js
// Zentrale Toast-Notification. Hängt in #toast-root (siehe index.html).

const DEFAULT_TIMEOUT_MS = 4000;

function show(message, opts) {
  opts = opts || {};
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = 'toast' + (opts.type ? ' toast-' + opts.type : '');
  el.textContent = message;
  if (opts.actionLabel && typeof opts.onAction === 'function') {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = opts.actionLabel;
    btn.addEventListener('click', () => {
      try { opts.onAction(); } catch (_) {}
      el.remove();
    });
    el.appendChild(btn);
  }
  root.appendChild(el);
  const t = setTimeout(() => el.remove(), opts.timeoutMs || DEFAULT_TIMEOUT_MS);
  el.addEventListener('click', (e) => {
    if (e.target === btn) return;
    clearTimeout(t);
    el.remove();
  });
}

window.ToastService = { show };
