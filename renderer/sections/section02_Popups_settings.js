// renderer/sections/section02_Popups_settings.js (Phase 3 Block 29)
// Extracted: Popups settings
// Source: app.js L4702..4717

// ----------------- Popups settings -----------------
// Sub-modal inside âš™ Settings that lets the user change the popup
// display policy (which controls the startup / first-time-setup /
// optional-addons / tab-intro popups) and reset the "seen" history
// so every popup fires again on the next trigger. Persisted to
// state.json via scheduleStateSave â€” the policy itself is part of
// state.popupPolicy, and the seen record is state.seenPopups.
function showPopupSettings() {
  // Removed: the standalone Popups modal was replaced by the
  // Popups tab inside the new multi-tab Settings dialog
  // (buildSettingsPopupsPane). The function stub remains so
  // any stale references don't crash, but it just opens the
  // settings dialog and switches to the Popups tab.
  showSettingsAndSwitchTab('popups');
}

