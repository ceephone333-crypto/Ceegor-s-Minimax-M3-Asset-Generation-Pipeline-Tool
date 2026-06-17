# Refactoring-Plan: Atomic Code Architecture

> **Geltungsbereich:** Electron-Desktop-App (`MiniMax Assets Tool`) — Windows 11 Zielplattform,
> basiert auf Node.js (Main-Process) + vanilla JS Renderer (kein Build-Step).
> Dieses Dokument übersetzt die Architektur-Prinzipien aus dem C#-Template
> (Clean Code, SRP, LLM-Optimierung) **1:1** auf die Realität dieses Repos:
> - 1 monolithische `main.js` (941 Zeilen, IPC + Window-Lifecycle + Install-Pipeline vermischt)
> - 1 monolithische `renderer/app.js` (8.546 Zeilen, vier Tabs + Settings + Dialoge + File-Browser)
> - `renderer/audioCutter.js` (660 Zeilen, leicht über Limit)
> - `src/*.js` (alle ≤ 500 Zeilen, bereits gut geschnitten — bleiben strukturell)

---

## 1. Zielsetzung

Transformation der monolithischen Code-Basis in eine **stark entkoppelte, modulare Architektur**,
sodass autonome AI-Agenten (Claude, GPT, MiniMax M3, Codex) jeweils nur einen **winzigen,
fokussierten Kontext** laden müssen, um Änderungen sicher durchzuführen.

**Konkrete Zahlen (Ist → Soll):**

| Datei | Ist | Soll | Aktion |
|---|---|---|---|
| `main.js` | 941 | ≤ 200 (nur Bootstrap) | komplette Zerlegung |
| `renderer/app.js` | 8.546 | ≤ 200 (nur Bootstrap) | komplette Zerlegung |
| `renderer/audioCutter.js` | 660 | ≤ 500 | in 2–3 Module splitten |
| `src/imageOptimizer.js` | 439 | ≤ 500 | bleibt; nur Pfad-Konvention angleichen |
| `src/isnetbg.js` | 336 | ≤ 500 | bleibt |
| übrige `src/*.js` | ≤ 290 | ≤ 500 | bleiben unverändert |

**Verboten nach Refactoring:**
- Keine Datei > 500 Zeilen (Harte Grenze)
- Keine Datei > 300 Zeilen (Warnstufe → Pflicht zur Aufteilung)
- Keine "God Words" in Dateinamen: `*Manager*.js`, `*Controller*.js`, `*System*.js` (sofern > 3 Aufgaben)
- Keine zirkulären `require()`-Beziehungen (DAG-Pflicht)

---

## 2. Struktur-Taxonomie (Neue Ordnerstruktur)

```
Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool/
├── main/                          # Electron Main-Process (NEU)
│   ├── index.js                   # Bootstrap: app.whenReady, lifecycle (≤ 80 Z.)
│   ├── window/
│   │   ├── createMainWindow.js    # BrowserWindow-Factory + Confirm-Close-Guard
│   │   └── windowSecurity.js      # will-navigate, setWindowOpenHandler, web-prefs
│   ├── ipc/                       # ipcMain.handle-Definitionen (eine Datei pro Domäne)
│   │   ├── registerAppIpc.js      # app:version
│   │   ├── registerConfigIpc.js   # config:get/set/path/pickFolder
│   │   ├── registerMmxIpc.js      # mmx:run/voices/quota/cancel/authStatus/diagnose
│   │   ├── registerUpscaleIpc.js  # upscale:realesrgan:*
│   │   ├── registerIsnetbgIpc.js  # isnetbg:*
│   │   ├── registerImageIpc.js    # image:optimize
│   │   ├── registerAudioIpc.js    # audio:*
│   │   ├── registerFileBrowserIpc.js # fb:*
│   │   ├── registerBatchesIpc.js  # batches:*
│   │   ├── registerStateIpc.js    # state:*
│   │   ├── registerInstallIpc.js  # install:openUrl, install:pickAndCopy
│   │   └── registerFilePickerIpc.js # file:pick
│   ├── services/                  # Hintergrund-Logik, System-Level
│   │   ├── InstallDownloadService.js  # GitHub-Zip-Download + PowerShell-Extract
│   │   ├── InstallPickCopyService.js  # "Pick file…" + atomares Copy
│   │   ├── PathSecurityService.js     # isPathUnderAny + isParentUnderAny + trustedPickPaths
│   │   ├── VoicesCacheService.js      # voicesCache (per-API-Key)
│   │   ├── DownloadProgressEmitter.js# throttled IPC-Sender (500 KB / 250 ms)
│   │   └── HttpsRedirect.js           # _httpsGetFollowingRedirects
│   ├── models/                    # Reine Datenstrukturen
│   │   ├── ConfigSchema.js             # safe-Config-Sanitizer (region/theme/styles)
│   │   ├── MmxSubcommandAllowlist.js   # ALLOWED_MMX_SUBCOMMANDS Set
│   │   └── InstallKindsTable.js        # INSTALL_KINDS Map
│   ├── utils/                     # Stateless helpers
│   │   ├── PathUtils.js            # normalize, isPathUnderAny, isParentUnderAny
│   │   ├── PowerShellSpawner.js   # Expand-Archive-Wrapper
│   │   └── UrlSanitizer.js        # openExternal-Safety-Checks
│   └── interfaces/                # JSDoc-Typings + Verträge (kein TS-Build!)
│       ├── IConfigProvider.d.ts
│       ├── IPathValidator.d.ts
│       ├── IMmxRunner.d.ts
│       └── IInstallTarget.d.ts
│
├── preload.js                     # bleibt; ggf. in main/preload/ verlagert
│
├── src/                           # BLEIBT — domänenspezifische Engines (≤ 500 Z.)
│   ├── mmx.js
│   ├── fileBrowser.js
│   ├── imageOptimizer.js
│   ├── realesrgan.js
│   ├── isnetbg.js
│   ├── isnetbg_node.js
│   ├── config.js
│   ├── state.js
│   ├── batches.js
│   ├── pathUtils.js               # (wird nach main/utils/PathUtils.js migriert; Re-Export als Shim)
│   └── voices.json
│
├── renderer/                      # Renderer (komplett neu strukturiert)
│   ├── index.html                 # Einstieg (bleibt)
│   ├── styles.css                 # bleibt; ggf. in tokens.css + components.css splitten
│   ├── bootstrap.js               # Startet App: lädt State, registriert Tab-Router
│   ├── core/                      # Framework-glue
│   │   ├── EventBus.js            # Mini-EventEmitter-Wrapper (on/off/emit)
│   │   ├── DomHelpers.js          # $, $$, createElement, escapeHtml
│   │   ├── ToastService.js        # zentrale Toast-Notification
│   │   └── ApiClient.js           # window.api-Wrapper mit try/catch + Error-Normalisierung
│   ├── state/                     # globaler State (NICHT pro Tab)
│   │   ├── AppState.js            # zentraler Mutable-State (config, voices, batches, filePrefix, realesrganModel, …)
│   │   ├── StatePersister.js      # debounced autosave nach state.json
│   │   └── Selectors.js           # reine Read-Helfer (getActiveTab, getCurrentFbDir, …)
│   ├── tabs/                      # die 4 Generierungs-Tabs
│   │   ├── ImageTab.js            # Prompt-Builder, Resolution, Styles, Aspect-Ratio
│   │   ├── SpeechTab.js           # Voice-Picker, Speed, Emotion
│   │   ├── MusicTab.js            # Lyrics, Instrumental-Toggle
│   │   ├── VideoTab.js            # Model, Duration, Resolution
│   │   └── BatchRunner.js         # geteilter "Run all" Code (alle 4 Tabs)
│   ├── panels/                    # rechte/linke Seitenleisten
│   │   ├── FileBrowserPanel.js    # Tree + Right-Click-Context + Selection
│   │   ├── PreviewPanel.js        # Image/Text/SRT/JSON-Preview
│   │   └── QuotaPanel.js          # Anzeige + Refresh-Button
│   ├── dialogs/                   # modale Popups
│   │   ├── GreetingsDialog.js     # "Welcome"-Modal mit Version
│   │   ├── SettingsDialog.js      # Region, Theme, API-Key, File-Prefix
│   │   ├── OptionalAddonsDialog.js# Real-ESRGAN / IS-Net install
│   │   ├── DiagnoseDialog.js      # Diagnose-Modal
│   │   ├── AudioCutDialog.js      # Waveform + Trim (eigenes ~ 250-Z-Modul)
│   │   └── ImagePipelineDialog.js # Upscale/Crop/Format/BG-Remove (Hub → 3 Sub-Widgets)
│   ├── components/                # kleine, wiederverwendbare UI-Bausteine
│   │   ├── PrimaryButton.js
│   │   ├── FilePickerField.js
│   │   ├── PromptTextarea.js
│   │   ├── ResolutionSelect.js
│   │   ├── StylePresetEditor.js
│   │   └── ConfirmModal.js
│   ├── services/                  # Renderer-seitige Service-Wrapper
│   │   ├── MmxService.js          # window.api.runMmx + Streaming-Log → EventBus
│   │   ├── ImagePipelineService.js# orchestriert upscale/crop/optimize
│   │   ├── FilePickerService.js   # file:pick wrapper (trustedPickPaths)
│   │   └── ThemeService.js        # applyTheme('light'/'dark') + EventBus-Event
│   └── utils/                     # Renderer-Helpers
│       ├── PathBuilder.js         # derivedOutputPath, uniqueOutputPath
│       ├── FormatUtils.js         # bytesToHuman, secondsToHMS
│       └── DragDropHandler.js
│
├── scripts/                       # Build- und Packaging-Helfer (bleibt)
├── docs/                          # (bleibt)
└── _refactoringplan.md            # (dieses Dokument)
```

### Migrations-Mapping (Ist → Soll)

**`main.js` (941 Z.) wird aufgeteilt in:**

| Block in `main.js` | Z. | Wandert nach |
|---|---|---|
| `app.commandLine.appendSwitch` (Z. 19–25) | 7 | `main/index.js` |
| `let mainWindow`, `voicesCache`, `trustedPickPaths` (Z. 27–35) | 9 | `main/index.js` (Re-Exports) + `main/services/PathSecurityService.js` + `main/services/VoicesCacheService.js` |
| `allowedRoots()` (Z. 39–45) | 7 | `main/services/PathSecurityService.js` |
| `ALLOWED_MMX_SUBCOMMANDS` (Z. 52–54) | 3 | `main/models/MmxSubcommandAllowlist.js` |
| `createWindow()` (Z. 56–113) | 58 | `main/window/createMainWindow.js` + `main/window/windowSecurity.js` |
| `app.whenReady`, `app.on('activate')`, `app.on('window-all-closed')` (Z. 115–124) | 10 | `main/index.js` |
| `ipcMain.handle('app:version', …)` (Z. 133–140) | 8 | `main/ipc/registerAppIpc.js` |
| `ipcMain.handle('config:*', …)` (Z. 143–170) | 28 | `main/ipc/registerConfigIpc.js` + `main/models/ConfigSchema.js` |
| `ipcMain.handle('mmx:*', …)` (Z. 176–300) | 125 | `main/ipc/registerMmxIpc.js` |
| `ipcMain.handle('upscale:realesrgan:*', …)` (Z. 311–516) | 206 | `main/ipc/registerUpscaleIpc.js` + `main/services/InstallDownloadService.js` + `main/utils/PowerShellSpawner.js` + `main/services/DownloadProgressEmitter.js` + `main/services/HttpsRedirect.js` |
| `ipcMain.handle('isnetbg:*', …)` (Z. 340–366) | 27 | `main/ipc/registerIsnetbgIpc.js` |
| `ipcMain.handle('image:optimize', …)` (Z. 380–398) | 19 | `main/ipc/registerImageIpc.js` |
| `ipcMain.handle('install:openUrl', …)` (Z. 526–548) | 23 | `main/ipc/registerInstallIpc.js` + `main/utils/UrlSanitizer.js` |
| `ipcMain.handle('install:pickAndCopy', …)` (Z. 566–645) | 80 | `main/ipc/registerInstallIpc.js` + `main/services/InstallPickCopyService.js` + `main/models/InstallKindsTable.js` |
| `ipcMain.handle('audio:*', …)` (Z. 653–758) | 106 | `main/ipc/registerAudioIpc.js` |
| `ipcMain.handle('fb:*', …)` (Z. 765–897) | 133 | `main/ipc/registerFileBrowserIpc.js` |
| `ipcMain.handle('batches:*', …)` (Z. 902–907) | 6 | `main/ipc/registerBatchesIpc.js` |
| `ipcMain.handle('file:pick', …)` (Z. 910–933) | 24 | `main/ipc/registerFilePickerIpc.js` |
| `ipcMain.handle('state:*', …)` (Z. 937–941) | 5 | `main/ipc/registerStateIpc.js` |

→ `main/index.js` enthält nach Refactoring **nur noch Bootstrap-Code** (~ 80 Zeilen):
```js
// Pseudo-Skizze
require('./window/windowSecurity');      // setzt app.commandLine-Switches
const { app } = require('electron');
const { createMainWindow } = require('./window/createMainWindow');
const pathSecurity = require('./services/PathSecurityService');

app.whenReady().then(() => {
  // IPC-Handler registrieren (jede Datei ist eigenständig)
  require('./ipc/registerAppIpc');
  require('./ipc/registerConfigIpc');
  require('./ipc/registerMmxIpc');
  require('./ipc/registerUpscaleIpc');
  require('./ipc/registerIsnetbgIpc');
  require('./ipc/registerImageIpc');
  require('./ipc/registerAudioIpc');
  require('./ipc/registerFileBrowserIpc');
  require('./ipc/registerBatchesIpc');
  require('./ipc/registerStateIpc');
  require('./ipc/registerInstallIpc');
  require('./ipc/registerFilePickerIpc');

  createMainWindow();
  app.on('activate', () => { /* … */ });
});
app.on('window-all-closed', () => { /* … */ });
```

**`renderer/app.js` (8.546 Z.) wird aufgeteilt in:**

Da der Code stark tab-spezifisch ist, ist die erste Schneide-Achse **"welcher Tab?"** —
vier separate Tab-Module (je ≤ 500 Z.). Übergreifender Code wandert in `core/`, `panels/`,
`dialogs/`, `services/`. Eine genaue Tabelle wird in **Phase 1** erarbeitet; die initiale
Schätzung ist **~ 35 neue Dateien** mit einem Durchschnitt von ~ 245 Zeilen.

**`renderer/audioCutter.js` (660 Z.) wird aufgeteilt in:**

| Block | Wandert nach |
|---|---|
| Waveform-Decoder (ffmpeg → Float32Array) | `renderer/services/AudioWaveformService.js` |
| Peak-Berechnung + Downsampling | `renderer/services/AudioPeakService.js` |
| UI (Canvas, Range-Slider, Buttons) | `renderer/dialogs/AudioCutDialog.js` |
| IPC-Wrapper (`audio:*`) | `renderer/services/AudioApiClient.js` |
| Zero-Crossing-Lookup | `renderer/utils/AudioMath.js` |

---

## 3. Code-Format & Konventionen

### 3.1 Dateigrößen-Limit (hartcodiert in CI)

| Status | Limit | Konsequenz |
|---|---|---|
| ✅ OK | ≤ 300 Zeilen | keine Aktion |
| ⚠️ Warnung | 301–500 Zeilen | Pflicht: Issue erstellen, geplante Aufteilung benennen |
| 🚫 Verboten | > 500 Zeilen | CI schlägt fehl (`scripts/check.js` ergänzt um `wc -l`-Check) |

> **Wichtig:** Wir behalten das bestehende Build-Step-freie Setup (vanilla JS, `<script>`-Tags).
> Damit ist ein ESBuild/TS-Build **nicht** Teil dieses Plans. JSDoc-Type-Hints in `.d.ts`-Dateien
> liefern die nötige Editor-/AI-Unterstützung ohne Compile-Schritt.

### 3.2 Namenskonventionen

| Schicht | Suffix | Beispiel |
|---|---|---|
| IPC-Registrierung | `register*` | `registerMmxIpc.js` |
| Service (Main) | `*Service` | `PathSecurityService.js` |
| Service (Renderer) | `*Service` | `MmxService.js` |
| Tab-Modul | `*Tab` | `ImageTab.js` |
| Panel | `*Panel` | `FileBrowserPanel.js` |
| Dialog | `*Dialog` | `SettingsDialog.js` |
| Component (UI-Atom) | beschreibender Substantiv | `ConfirmModal.js` |
| Pure helper | beschreibendes Substantiv | `PathBuilder.js` |
| JSDoc-Interface | `I*.d.ts` | `IMmxRunner.d.ts` |

**Verboten:** `*Manager.js`, `*Controller.js`, `*System.js` (außer bei Plattformnamen
wie `FileSystem`), `*Helper.js` (zu generisch → spezifischen Namen wählen).

### 3.3 Inhaltlicher Aufbau pro Datei

Jede Datei folgt dieser Reihenfolge:

```js
// 1) Imports — streng alphabetisch sortiert, nur was zwingend nötig ist
const { app } = require('electron');
const path = require('path');

// 2) Konstanten / Modul-State (lokal; niemals globaler mutable state)
const MAX_PAYLOAD_BYTES = 25 * 1024 * 1024;

// 3) Public API (die Exporte — minimal!)
async function run(srcPath, opts) { /* … */ }
module.exports = { run };

// 4) Private helpers (alles, was nicht exportiert wird, kommt nach unten)
function _validatePath(p) { /* … */ }
```

### 3.4 Dependency Injection (im Electron-Kontext)

Da wir **kein** Framework-DI verwenden, gilt das DI-Prinzip pragmatisch:
- **Konstruktor-Funktionen** für Klassen: `function createMmxService({ configProvider, logger }) { … }`
- **Funktionen mit Options-Objekt**: `registerMmxIpc({ pathSecurity, voicesCache })`
- **Kein `new OtherService()`** innerhalb einer anderen Service-Datei — der Aufrufer injiziert.
- **Konkrete Konvention:** `main/index.js` ist der einzige "Composition Root",
  der alle Services miteinander verdrahtet. Jede `register*Ipc.js` exportiert
  `function register(deps)` statt selbst zu instanziieren.

### 3.5 Keine zirkulären Abhängigkeiten (DAG-Pflicht)

Erzwungen durch die Ordnerhierarchie:

```
main/utils/  →  (keine Aufrufe nach außen)
main/models/ →  darf nur main/utils/ nutzen
main/services/ →  darf main/utils/, main/models/ nutzen
main/window/ →  darf main/services/ nutzen
main/ipc/    →  darf main/services/, main/models/, main/utils/ nutzen
main/index.js →  Composition Root; darf alles nutzen
```

Renderer folgt derselben Hierarchie (`utils` → `services` → `components` → `panels`/`tabs`/`dialogs` → `bootstrap`).

**Verifikation:** `scripts/check.js` wird erweitert um `madge --circular main/ renderer/`
(nur-Dev-Dependency, keine Runtime-Auswirkung).

---

## 4. Refactoring-Prozess (Schritte zur sicheren Zerlegung)

### Phase 0: Vorbereitung (1 Schritt)

1. **Backup-Tag:** `git tag pre-atomic-refactor` setzen. Ab jetzt nur noch Refactoring-Commits.
2. **CI-Hook schärfen:** `scripts/check.js` ergänzen, sodass `main.js > 200 Z.` und
   `renderer/app.js > 200 Z.` einen Warning-Print erzeugen (Vorboten der 500er-Hürde).
3. **Akzeptanzkriterium festhalten:** Die App muss nach **jedem** Commit manuell startbar sein
   (Klick auf `start.bat` → Fenster geht auf → Tab-Wechsel funktioniert → 1 erfolgreiche
   Test-Generation auf jedem Tab).

### Phase 1: Dependency Mapping & Interface-Extraktion (2–3 Commits)

**Ziel:** Verträge zwischen den Blöcken sichtbar machen, BEVOR wir verschieben.

1. **`main.js`** lesen und alle IPC-Channel in eine Tabelle mappen (Channel-Name → Handler-Funktion → genutzte Dependencies). Diese Tabelle wird in `docs/ipc-contracts.md` abgelegt — sie ist das "Interface" zwischen Main- und Renderer-Prozess und ist die wichtigste Datei für AI-Agenten.
2. **`renderer/app.js`** lesen und eine **Feature-Map** erstellen:
   - Welche Funktionen gehören zu welchem Tab?
   - Welche sind tab-übergreifend (State, File-Browser, Settings)?
   - Welche sind reine UI-Atome (können in `components/`)?
   - Wo gibt es Cross-Tab-Aufrufe? (diese sind die heißen Stellen für zukünftige Bugs)
3. **JSDoc-Interfaces** in `main/interfaces/*.d.ts` anlegen:
   - `IPathValidator.d.ts` (Pflicht-Operationen: `isPathUnderAny`, `isParentUnderAny`, `addTrusted`)
   - `IConfigProvider.d.ts` (`get`, `getPath`, `pickFolder`)
   - `IMmxRunner.d.ts` (`run`, `cancelAll`, `resolve`)
   - `IInstallTarget.d.ts` (die 3 Install-Kinds)

> **Outcome:** Reine Doku-Phase. **Keine** Code-Änderung, **kein** Verschieben.
> Dies ist absichtlich der größte Schritt — eine schlechte Feature-Map macht alle
> folgenden Phasen teuer.

### Phase 2: `main.js` zerlegen (8–12 Commits, klein gehalten)

Reihenfolge (jeder Commit = 1 Datei-Extraktion, kompilierbar & startbar):

1. `main/window/windowSecurity.js` extrahieren (app.commandLine-Switches, ~ 7 Z.)
2. `main/services/PathSecurityService.js` extrahieren (allowedRoots + trustedPickPaths, ~ 30 Z.)
3. `main/services/VoicesCacheService.js` extrahieren (voicesCache, ~ 15 Z.)
4. `main/services/HttpsRedirect.js` extrahieren (~ 25 Z.)
5. `main/services/DownloadProgressEmitter.js` extrahieren (throttle-Logik, ~ 25 Z.)
6. `main/utils/PowerShellSpawner.js` extrahieren (~ 20 Z.)
7. `main/utils/UrlSanitizer.js` extrahieren (~ 25 Z.)
8. `main/models/InstallKindsTable.js` extrahieren (~ 35 Z.)
9. `main/models/MmxSubcommandAllowlist.js` extrahieren (~ 5 Z.)
10. `main/models/ConfigSchema.js` extrahieren (safe-sanitizer, ~ 20 Z.)
11. `main/services/InstallDownloadService.js` extrahieren (GitHub-Download-Handler, ~ 90 Z.)
12. `main/services/InstallPickCopyService.js` extrahieren (atomares Copy, ~ 50 Z.)
13. `main/window/createMainWindow.js` extrahieren (BrowserWindow-Factory, ~ 70 Z.)
14. `main/ipc/registerAppIpc.js` extrahieren (~ 15 Z.)
15. `main/ipc/registerConfigIpc.js` extrahieren (~ 35 Z.)
16. `main/ipc/registerMmxIpc.js` extrahieren (~ 140 Z. — *knapp unter Limit*)
17. `main/ipc/registerUpscaleIpc.js` extrahieren (~ 40 Z.)
18. `main/ipc/registerIsnetbgIpc.js` extrahieren (~ 35 Z.)
19. `main/ipc/registerImageIpc.js` extrahieren (~ 30 Z.)
20. `main/ipc/registerAudioIpc.js` extrahieren (~ 110 Z.)
21. `main/ipc/registerFileBrowserIpc.js` extrahieren (~ 140 Z. — *knapp unter Limit*)
22. `main/ipc/registerBatchesIpc.js` extrahieren (~ 10 Z.)
23. `main/ipc/registerStateIpc.js` extrahieren (~ 10 Z.)
24. `main/ipc/registerInstallIpc.js` extrahieren (~ 50 Z.)
25. `main/ipc/registerFilePickerIpc.js` extrahieren (~ 30 Z.)
26. **`main/index.js` finalisieren** — nur noch Composition Root (~ 80 Z.)

> **Pro Commit:** `node -e "require('./main/index.js')"` Smoke-Test
> (Electron-Start via `start.bat`).

### Phase 3: `renderer/app.js` zerlegen (12–18 Commits)

Erst die **Basis-Infrastruktur**, dann die **Tabs**, dann die **Dialoge/Panels**.

**Schritt A — Foundation:**

1. `renderer/core/DomHelpers.js` (`$`, `$$`, `createElement`, `escapeHtml`)
2. `renderer/core/EventBus.js`
3. `renderer/core/ToastService.js`
4. `renderer/core/ApiClient.js` (zentraler `window.api`-Wrapper mit Error-Normalisierung)
5. `renderer/services/ThemeService.js`
6. `renderer/state/AppState.js` (zentraler State-Container)
7. `renderer/state/StatePersister.js` (debounced autosave)
8. `renderer/state/Selectors.js`

**Schritt B — Utilities:**

9. `renderer/utils/PathBuilder.js`
10. `renderer/utils/FormatUtils.js`
11. `renderer/utils/DragDropHandler.js`
12. `renderer/utils/AudioMath.js` (Zero-Crossing)

**Schritt C — Komponenten (UI-Atome):**

13. `renderer/components/ConfirmModal.js`
14. `renderer/components/PromptTextarea.js`
15. `renderer/components/FilePickerField.js`
16. `renderer/components/ResolutionSelect.js`
17. `renderer/components/StylePresetEditor.js`

**Schritt D — Services:**

18. `renderer/services/MmxService.js`
19. `renderer/services/FilePickerService.js`
20. `renderer/services/ImagePipelineService.js`
21. `renderer/services/AudioApiClient.js`
22. `renderer/services/AudioWaveformService.js`
23. `renderer/services/AudioPeakService.js`

**Schritt E — Panels:**

24. `renderer/panels/FileBrowserPanel.js`
25. `renderer/panels/PreviewPanel.js`
26. `renderer/panels/QuotaPanel.js`

**Schritt F — Tabs:**

27. `renderer/tabs/ImageTab.js`
28. `renderer/tabs/SpeechTab.js`
29. `renderer/tabs/MusicTab.js`
30. `renderer/tabs/VideoTab.js`
31. `renderer/tabs/BatchRunner.js` (geteilt)

**Schritt G — Dialoge:**

32. `renderer/dialogs/GreetingsDialog.js`
33. `renderer/dialogs/SettingsDialog.js`
34. `renderer/dialogs/OptionalAddonsDialog.js`
35. `renderer/dialogs/DiagnoseDialog.js`
36. `renderer/dialogs/AudioCutDialog.js`
37. `renderer/dialogs/ImagePipelineDialog.js`

**Schritt H — Bootstrap & Wiring:**

38. `renderer/bootstrap.js` — referenziert ALLE Module (verbleibt das einzige große Modul, ~ 150 Z.)
39. `renderer/index.html` — `<script>`-Reihenfolge anpassen, sodass Abhängigkeiten vor Konsumenten laden

### Phase 4: `renderer/audioCutter.js` zerlegen (3 Commits)

Da diese Datei in Phase 3 unter "Services" und "Dialoge" bereits adressiert wurde, sind
nur 3 Bestätigungs-Commits nötig:
1. Waveform-Decoder → `renderer/services/AudioWaveformService.js`
2. Peak-Logik → `renderer/services/AudioPeakService.js`
3. UI → `renderer/dialogs/AudioCutDialog.js`

### Phase 5: Event-System-Einführung (2–3 Commits)

**Ziel:** Direkte Funktionsaufrufe durch Events ersetzen, wo es die Entkopplung
deutlich verbessert. Konkret:

| Aktueller Aufruf | Ersetzt durch |
|---|---|
| `selectors.refreshAll()` nach `config:set` | `EventBus.emit('config:changed', newCfg)` → `AppState` + `ThemeService` + `Tabs` lauschen |
| `ToastService.show(...)` direkt aus jedem Modul | bleibt (zu klein für Refactoring) |
| `mmx:log` IPC → `logPane.append(line)` | `EventBus.emit('mmx:log', line)` → `PreviewPanel` lauscht |
| `imagePipeline.onProgress` Callback | `EventBus.emit('pipeline:progress', pct)` |

Damit verschwinden die letzten Cross-Modul-Imports zwischen Tabs und Panels.

### Phase 6: Unit-Test-Validierung (laufend + final)

- **Pro neu extrahiertes Modul:** Mindestens 1 Test in `tests/unit/<mirror>.test.js`,
  der das Modul **isoliert** (mit gemockten Dependencies) prüft.
- **Frameworks:** Node's eingebauter `node:test` + `assert` (kein zusätzlicher Build-Schritt nötig).
- **Beispiele:**
  - `tests/unit/main/services/PathSecurityService.test.js` — prüft `..`-Bypass
  - `tests/unit/main/services/InstallDownloadService.test.js` — prüft Throttle-Logik mit gemocktem HTTPS
  - `tests/unit/main/services/VoicesCacheService.test.js` — Cache-Invalidierung bei Key-Wechsel
  - `tests/unit/renderer/state/Selectors.test.js` — reine Selektor-Logik
- **Smoke-Test:** Bestehender manueller Klick-Test (siehe Phase 0) wird in `scripts/smoke.sh` automatisiert (Electron-Headless mit `--enable-logging`).

### Phase 7: Lint- & DAG-Check finalisieren

- `scripts/check.js` ergänzen:
  - `for f in $(find main renderer -name '*.js'); do test $(wc -l < $f) -le 500 || exit 1; done`
  - `madge --circular main/ renderer/` (Dev-Dependency)
  - "God-Word"-Check: `grep -rE 'Manager|Controller|System' main/ renderer/`
    darf nur in Kommentaren oder Plattformnamen vorkommen.
- `npm run check` als Pre-Commit-Hook.

---

## 5. Zukünftiger Agent-Workflow (Anwendung)

**Beispiel-Auftrag:** "Füge eine Funktion zum Minimieren in den System-Tray hinzu."

**Vor dem Refactoring (heute):**
Der Agent muss `main.js` (941 Z.) **komplett** laden, um zu verstehen, wo der
Tray einzubauen ist. → ~ 30k Tokens Kontext, hohe Halluzinationsrate.

**Nach dem Refactoring:**
Der Agent erhält **nur**:
1. `main/interfaces/ITrayMinimizable.d.ts` (10 Z.) — der Vertrag
2. `main/services/SystemTrayService.js` (≤ 200 Z.) — die Implementierung
3. `main/window/createMainWindow.js` (≤ 80 Z.) — wo der `BrowserWindow.on('minimize')` zuhört
4. **Fertig.** ~ 3.000 Tokens, extrem fokussiert, keine Überschneidungen.

**Beispiel-Auftrag 2:** "Behebe, dass nach `config:set` die Voice-Liste nicht neu lädt."

Der Agent öffnet:
1. `renderer/services/MmxService.js` (≤ 200 Z.)
2. `renderer/state/StatePersister.js` (≤ 200 Z.)
3. `renderer/state/AppState.js` (≤ 300 Z.)
4. Sieht sofort: `EventBus.emit('config:changed')` wird gefeuert, aber `MmxService` lauscht
   nur auf `config:apiKey:changed`. → **Präziser Fix in 1 Datei.**

---

## 6. Erfolgskontrolle

| Metrik | Ist | Soll | Messung |
|---|---|---|---|
| Größte Datei | 8.546 Z. (`app.js`) | ≤ 500 Z. | `find . -name '*.js' \| xargs wc -l \| sort -rn \| head -3` |
| Anzahl Dateien > 500 Z. | 3 | 0 | s. o. |
| Anzahl Dateien mit "God Word" + > 3 Aufgaben | ≥ 1 (`app.js`) | 0 | manuelles Audit |
| IPC-Handler-Dateien | 1 (alles in `main.js`) | 12 (je 1 pro Domäne) | `ls main/ipc/` |
| Tab-Dateien | 0 | 4 | `ls renderer/tabs/` |
| Zirkuläre Imports | nicht geprüft | 0 | `madge --circular` |
| Start-Zeit der App | 2,1 s | ≤ 2,5 s (Toleranz für mehr `require()`) | manueller Stoppuhr-Test |
| Smoke-Test | manuell | automatisiert | `scripts/smoke.sh` |

**Definition of Done:**
- [ ] Alle 26+38+1 Schritte der Phasen 2/3/4 sind als Commits in `main`.
- [ ] Keine Datei > 500 Zeilen, keine > 300 ohne geplante Aufteilung.
- [ ] `node --test tests/unit/` ist grün.
- [ ] `scripts/smoke.sh` startet die App, klickt durch alle 4 Tabs, generiert je 1 Asset.
- [ ] `madge --circular main/ renderer/` meldet 0 Zyklen.
- [ ] `npm run check` ist grün und als Pre-Commit-Hook eingerichtet.
- [ ] `docs/ipc-contracts.md` ist aus Phase 1 vollständig übernommen.

---

## 7. Risiken & Gegenmaßnahmen

| Risiko | Wahrscheinlichkeit | Impact | Gegenmaßnahme |
|---|---|---|---|
| Phase 1 Feature-Map ist falsch → Phase 2/3 erfordert Re-Work | Mittel | Hoch | In Phase 1 **einen** Tab manuell durchspielen, bevor alle 4 gemappt werden |
| `preload.js` muss bei jeder IPC-Umbenennung mitgezogen werden | Hoch | Niedrig | `preload.js` exportiert `window.api` weiterhin 1:1 — keine Änderung an der Rendererseite erforderlich |
| Mehr `require()`-Calls verlangsamen App-Start | Niedrig | Niedrig | Tests nach Phase 2; ggf. Lazy-Loading für Optional-Addons-Services |
| Bestehende `src/*.js` (gut geschnitten) werden versehentlich mit-angefasst | Mittel | Mittel | Phase 2/3 berührt `src/` **nicht**. Phase 4: nur `src/pathUtils.js` → Re-Export-Shim, damit `fb.js` weiter funktioniert |
| AI-Agent versteht EventBus-Migration nicht | Mittel | Mittel | Phase 5 erst **nach** den Unit-Tests. Vorher beide Stile parallel laufen lassen (Deprecation-Warning) |

---

**Stand:** initialer Plan, vor Phase 0.
**Nächste Aktion:** `git tag pre-atomic-refactor` setzen → Phase 1 (Feature-Map) starten.
