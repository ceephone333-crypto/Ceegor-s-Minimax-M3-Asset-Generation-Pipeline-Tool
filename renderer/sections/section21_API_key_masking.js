// renderer/sections/section21_API_key_masking.js (Phase 3 Block 29)
// Extracted: API key masking
// Source: app.js L516..522

// ----------------- API key masking -----------------
// Phase 3: extrahiert nach renderer/utils/securityUtils.js.
// Hier nur Shim-Aliase, damit der 800+-Aufruf-Code in app.js
// unverändert bleibt. Funktionen liegen auf window.SecurityUtils
// und werden über index.html VOR app.js geladen.
const { maskApiKey, maskLine, showRevealableKey } = window.SecurityUtils;

