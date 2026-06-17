// renderer/services/ThemeService.js
// Wendet light/dark auf <body data-theme="…"> an und feuert
// `theme:changed` über den EventBus.

function apply(theme) {
  theme = theme === 'light' ? 'light' : 'dark';
  document.body.setAttribute('data-theme', theme);
  window.AppState.theme = theme;
  if (window.EventBus) window.EventBus.emit('theme:changed', theme);
}

function toggle() {
  apply(window.AppState.theme === 'light' ? 'dark' : 'light');
  if (window.StatePersister) window.StatePersister.onChange();
}

window.ThemeService = { apply, toggle };
