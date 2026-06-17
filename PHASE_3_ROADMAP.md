# Phase 3 Roadmap — `renderer/app.js` (8433 Z.) Aufteilung

> **Stand:** Commit 75228b2 (Phase 3 Block 1+2)
> app.js: 8547 Z. → 8433 Z. (-114 Z. / -1.3 %)
> Verbleibend: ~8400 Z., 130+ Top-Level-Funktionen

## Bereits abgeschlossen (Phase 3 Blöcke 1+2)

| # | Block | Modul | Ersparte Zeilen |
|---|---|---|---|
| 1 | API-Key-Maskierung (Z. 594–701) | `renderer/utils/securityUtils.js` | 108 |
| 2 | `el()`-Helper (Z. 576–592) | Alias auf `window.createElement` aus `core/DomHelpers.js` | 12 |

## Verbleibende Blöcke (geschätzt nach Hotspots)

| # | Block | Bereich (alt) | Strategie | Geschätzter Aufwand |
|---|---|---|---|---|
| 3 | Log-Event-System | ~600–767 | Konstanten (`LOG_MAX_EVENTS`, `LOG_CATEGORIES`) in `LogService`/eigene `LogCategories.js`; `addLogEvent`/`renderLogEvent` lassen sich nur mit `state`-Refactor ziehen | 4-6 h |
| 4 | Tab-Builders (`buildImageTab`, `buildSpeechTab`, …) | ~2400–4000 (verteilt) | Pro Tab ein Modul `renderer/tabs/ImageTab.js` etc. — erfordert EventBus-Migration, damit Tabs nicht direkt in `state` schreiben | 1-2 Tage |
| 5 | File-Browser-Panel | ~5500–7300 | `renderer/panels/FileBrowserPanel.js` mit `renderFbList`, Click-Delegation, Kontext-Menü | 1 Tag |
| 6 | Preview-Panel | ~7200–7600 | `renderer/panels/PreviewPanel.js` mit `previewImageFromFile` + Multi-Image-Batch-Logik | 4-6 h |
| 7 | Settings-Dialog (Tab-System) | ~7900–8400 | `renderer/dialogs/SettingsDialog.js` mit den ~5 Tabs (API-Key, Region, Style-Presets, Upscale, Optimize) | 1 Tag |
| 8 | Optional-Addons-Dialog | ~6500–6900 | `renderer/dialogs/OptionalAddonsDialog.js` (Real-ESRGAN / IS-Net install) | 4-6 h |
| 9 | Audio-Cut-UI (Bridge) | ~7400–7900 | `renderer/dialogs/AudioCutDialog.js` (der UI-Teil, nicht die ffmpeg-Logik) | 1 Tag |
| 10 | Image-Pipeline-Dialog | ~8000–8300 | `renderer/dialogs/ImagePipelineDialog.js` (Upscale/Crop/Format/Background) | 1 Tag |
| 11 | Style-Preset-Editor | ~8240–8360 | `renderer/components/StylePresetEditor.js` (edit/add/remove) | 2-3 h |
| 12 | Help-Button-Generator | ~250–280 | `renderer/components/HelpButton.js` | 1 h |
| 13 | Tooltip-System | ~530–575 | `renderer/components/Tooltip.js` | 1-2 h |
| 14 | init()-Orchestrator | ~0–50 | Bleibt in `app.js` als Bootstrap — wird zur 50-Z.-Datei | 30 min |

**Gesamt-Schätzung:** 8-12 Personentage (1-2 Wochen) für eine vollständige Aufteilung.

## Block-Extraktions-Pattern (für Folge-Sessions)

Jeder Block folgt diesem Muster:

1. **Read** den genauen Zeilenbereich in `app.js` (`Read`-Tool mit Offset/Limit).
2. **Identifiziere** die Top-Level-Funktionen + Konstanten, die isoliert sind.
3. **Erstelle** die neue Datei in `renderer/{core,state,services,utils,panels,dialogs,tabs,components}/`.
4. **Schreibe** die neue Datei mit denselben Funktionen + JSDoc.
5. **Ersetze** den Block in `app.js` durch einen Shim-Alias:
   ```js
   const { func1, func2, CONST } = window.ModuleName;
   ```
6. **Aktualisiere** `renderer/index.html`: füge `<script src="…/ModuleName.js">` VOR `app.js` ein.
7. **Commit** mit Pre-Commit-Hook (lint + test).
8. **Verifiziere** mit `node scripts/lint.js` und `node --test 'tests/unit/**/*.test.js'`.

## Kritische Abhängigkeiten (für die Refactoring-Reihenfolge)

- **`state` ist ein global mutable singleton** (`let state = {...}`). Module, die darauf zugreifen, sind implizit gekoppelt. VOR Tab-Extraktionen muss `state` zu `window.AppState` werden (das AppState.js-Skeleton existiert schon).
- **`$()`/`el()` sind lokale Aliase** in app.js. Sie funktionieren jetzt über `window` (DomHelpers.js), aber Folge-Extraktionen müssen `const { $, el } = window;` oder direkte `window`-Zugriffe verwenden.
- **`maskApiKey`/`maskLine`/`showRevealableKey`** sind schon extrahiert — alle Aufrufer in app.js funktionieren weiterhin über den Shim-Alias.

## Was NICHT extrahiert werden sollte

- **Tab-Switcher-Logik** (`showTab`, `switchTab`): zu eng mit `state.currentTab` und `state.genStatus` verbandelt; besser direkt in `bootstrap.js` migrieren.
- **Quota-Display-Logik**: 80 Zeilen, aber cross-tab — verbleibt in `app.js` bis Tab-Migration abgeschlossen.
- **Global-Keyboard-Handler**: einzelne Funktion, bleibt in `app.js`.

## Empfohlene nächste Session

**Fokus: Block 3 (Log-Event-System Konstanten)** — der kleinste verbleibende Block mit klarem Scope.

1. `renderer/services/LogCategories.js` (~30 Z.): `LOG_CATEGORIES` + `LOG_MAX_EVENTS`.
2. `renderer/state/LogState.js` (~30 Z.): `_logIdCounter` + `_logSelected` Set.
3. Shim in app.js:
   ```js
   const { LOG_CATEGORIES, LOG_MAX_EVENTS } = window.LogCategories;
   const { nextLogId, isLogSelected, toggleLogSelection } = window.LogState;
   ```
4. Erwartete Reduktion: ~30-50 Zeilen.

**Danach:** Block 4 (Tab-Builders) — erfordert zuerst `state` → `window.AppState`-Migration (separater Block). Siehe nächsten Eintrag.
