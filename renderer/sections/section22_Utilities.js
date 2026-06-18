// renderer/sections/section22_Utilities.js (Phase 3 Block 29)
// Extracted: Utilities
// Source: app.js L445..515

// ----------------- Utilities -----------------
// Phase 3: lokale el()-Definition entfernt. Verwendet jetzt
// window.createElement aus core/DomHelpers.js (semantisch
// identisch, inkl. Array-Children-Flatten via [].concat()).
const el = window.createElement;
// Phase 3 Block 28: SPEECH TAB + MUSIC TAB extrahiert nach
// renderer/tabs/speechTab.js + musicTab.js.


// Phase 3 Block 26: 3 Image-Overlays (showConvertOverlay,
// showCropOverlay, showOptimizeOverlay) extrahiert nach
// renderer/overlays/imageOverlays.js.
const {
  showConvertOverlay, showCropOverlay, showOptimizeOverlay,
} = window.ImageOverlays;


// Phase 3 Block 23: IMAGE TAB (732 Z.) extrahiert nach
// renderer/tabs/imageTab.js. window.ImageTab enthaelt den Tab.

// Phase 3 Block 22: buildParamRow + attachImageDimGuards extrahiert
// nach renderer/components/ParamRow.js. (helpButton bleibt in app.js
// weil es historisch eng mit helpTopics verkoppelt ist.)
const { buildParamRow, attachImageDimGuards } = window.ParamRow;


// Phase 3 Block 21: LOG-Section (addLogEvent, renderLogEvent,
// _logSelected, toggleLogSelection, clearLogSelection, selectLogRange,
// formatLogEventForCopy, collectLogCopyText, setupLogClicks, log) extrahiert
// nach renderer/services/logService.js.
const {
  addLogEvent, renderLogEvent, formatLogEventForCopy, collectLogCopyText,
  setupLogClicks, log, isLogSelected, toggleLogSelection, clearLogSelection, selectLogRange,
} = window.LogService;


// Phase 3 Block 20: loadImageFromFile + derivedOutputPath extrahiert
// nach renderer/utils/pureFuncs.js.
const { loadImageFromFile, derivedOutputPath } = window.PureFuncs;


// Phase 3 Block 19: FB_COLUMNS + normalizeFbColumns extrahiert
// nach renderer/utils/fbColumns.js. Drop-in-Aliase unten.
const { FB_COLUMNS, normalizeFbColumns } = window.FbColumns;


// Phase 3 Block 18: MODEL_SPECS + getRowSpec + validateTabAgainstSpec
// extrahiert nach renderer/specs/modelSpecs.js. Drop-in-Aliase unten.
const { MODEL_SPECS, getRowSpec, validateTabAgainstSpec } = window.ModelSpecs;


// Phase 3 Block 17: appendFlag + _flagForParam extrahiert nach
// renderer/utils/tinyUtils.js. Drop-in-Aliase unten.
const { appendFlag, _flagForParam } = window.TinyUtils;


// Phase 3 Block 16: mimeFromPath + isFlagVisibleForCurrentModel
// extrahiert nach renderer/utils/imageUtils.js.
const { mimeFromPath, isFlagVisibleForCurrentModel } = window.ImageUtils;


// Phase 3 Block 15: 4 pure helpers (parseAspect, humanSize,
// parentDir, iconForFile) extrahiert nach renderer/utils/pureFuncs.js.
const { parseAspect, humanSize, parentDir, iconForFile } = window.PureFuncs;


// Phase 3 Block 14: 5 tiny pure helpers extrahiert nach
// renderer/utils/tinyUtils.js. Drop-in-Aliase unten.
const { pathJoin, safeStringify, extFromMime, _isImageExt, appendBoolFlag } = window.TinyUtils;


