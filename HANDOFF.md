# Handoff-Protokoll: MiniMax Assets Tool - Image-Tab bleibt leer

## Problem in einem Satz

`C:\Projects\Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool\start.cmd` startet das Electron-Tool, aber:
- Der Image-Tab ist komplett leer (nur Toolbar sichtbar)
- Ein Toast in der unteren rechten Ecke zeigt: `ReferenceError: applyFileSearch is not defined`
- Das Tool war 2 Wochen lang funktionsfähig, brach aber nach einer Code-Änderung

## Umgebung

- **OS:** Windows 11 Home Edition (private, Standard-Settings)
- **Antivirus:** Bitdefender Free
- **Projekt-Root:** `C:\Projects\Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool\`
- **Stack:** Electron 32.3.3 + Node.js + electron-builder
- **Renderer:** HTML + CSS + Vanilla JS (kein Bundler, alle Files via `<script>`-Tags geladen)
- **Haupteinstiegspunkt:** `start.cmd` → `node_modules\electron\dist\electron.exe "<Projekt-Root>"` → `main.js` → `main/index.js` → `main/window/createMainWindow.js` → `loadFile(renderer/index.html)`

## Was passiert ist (Versuch der Rekonstruktion)

### Phase 3: Atomic Refactor (vor 2 Wochen)
Die monolithische `renderer/app.js` (3000+ Zeilen) wurde in viele kleine Files aufgeteilt:
- `renderer/core/DomHelpers.js`, `EventBus.js`, `ToastService.js`, `ApiClient.js`
- `renderer/state/AppState.js`, `StatePersister.js`
- `renderer/utils/*.js` (15+ Files)
- `renderer/services/*.js` (logService, dropTarget, fileBrowser1, fileBrowser2a, fileBrowser2b)
- `renderer/components/*.js` (ParamRow, HelpTooltip, etc.)
- `renderer/tabs/*.js` (imageTab, speechTab, musicTab, videoTab, styleHelpers)
- `renderer/sections/section01_..24_*.js` (24 Sections)
- `renderer/overlays/*.js`
- `renderer/services/ThemeService.js, MmxService.js, LogService.js, LogCategories.js`
- `renderer/bootstrap.js`, `tabs/batchManager.js`
- `renderer/app.js` (bleibt für init())

### Phase 4 Fix-Versuche (alle fehlgeschlagen)

1. **Fix 6:** Neuer Asar mit `styleHelpers.js`, `batchManager.js` etc. → half nicht
2. **Fix 15:** `const state/el/$/$$/TABS` → `var` (weil `const` am Top-Level eines `<script>`-Tags NICHT global ist) → half teilweise
3. **Fix 16:** `var TABS = window.TABS` (nicht `var TABS = {}` weil das die Tabs wischte) + `DomHelpers.js` `const` → `var`
4. **Fix 17:** Versuch eine `}` in fileBrowser1.js zu entfernen — rückgängig gemacht
5. **Fix 18:** `}` von Zeile 205 verschoben auf Zeile 62 (refreshBrowser close brace) → half nicht
6. **Fix 19:** `window.applyFileSearch = function() {...}` (statt `function applyFileSearch()`)
7. **Fix 20:** Function declarations (hoisted) + `var state = window.state || {}` als Default
8. **Fix 21:** Debug-Logging via `window.api.logToFile` → `ipcMain` → `renderer-error.log`. **Log-Datei ist LEER** (nur Header), obwohl der asar das debugLog.js enthält

## Was ICH herausgefunden habe

### Verifizierte Fakten

1. **Alle 63 JS-Files sind syntaktisch OK** (`node --check` exit 0 für alle)
2. **Keine function ist in einer anderen function verschachtelt** (gecheckt mit Custom-Script)
3. **Der asar im .zip enthält alle Fixes:**
   - `main/index.js` enthält `RENDERER_LOG`
   - `preload.js` enthält `logToFile`
   - `renderer/debugLog.js` ist vorhanden (2673 bytes)
   - `renderer/app.js` enthält `window.applyFileSearch || applyFileSearch`
4. **Trotzdem:** `renderer-error.log` ist fast leer (nur die Header-Zeile). Das bedeutet die `debugLog.js` läuft nicht, oder `window.api.logToFile` ist nicht erreichbar.

### Was ich NICHT herausgefunden habe

- **Warum `renderer-error.log` leer ist**, obwohl der asar `debugLog.js` enthält
- **Wo genau `applyFileSearch` referenziert wird** das den Error wirft
- **Ob der .exe im .zip den neuesten asar lädt** oder einen Cache verwendet

## Verbleibende Verdachtsmomente (zu prüfen)

### Verdacht 1: Electron-Cache / stale process
Der User hat mehrfach behauptet keine electron-Prozesse laufen. Aber Trae IDE oder ein anderer Prozess könnte den asar cachen.

**Test:** Kompletter Neustart von Windows, dann frische Extraktion der `dist\MiniMaxAssetTool-1.1.1-x64.zip` in einen NEUEN Ordner.

### Verdacht 2: `app.asar` hat 2 Files mit gleichem Namen
Wenn der asar `renderer/app.js` UND `app.js` im Root hat, könnte Electron das falsche File laden.

**Test:** Asar auflisten mit `npx asar list app.asar | grep -E "^app\.js$|renderer/app\.js$"` und prüfen ob beide da sind.

### Verdacht 3: `<script>`-Reihenfolge lädt `app.js` BEVOR `fileBrowser1.js` fertig ist
In `renderer/index.html` (Z. 65): `<script src="app.js">` ist das LETZTE script. Aber `app.js`'s init() läuft via `DOMContentLoaded`. Wenn `fileBrowser1.js` ein synchroner Error hat, ist `window.applyFileSearch` zwar gesetzt, ABER andere Scripte sind vielleicht nicht fertig.

**Test:** `renderer/app.js` Zeile 49: `async function init()`. VORHER `document.addEventListener('DOMContentLoaded', () => { init() })`. Prüfen ob init() await für irgendetwas braucht das nicht resolved.

### Verdacht 4: `state`-Default (`var state = window.state || {}`) ist NICHT das echte state
`var state` ist eine lokale Variable im fileBrowser1.js Script-Tag. `window.state` (gesetzt von section24_State.js) ist ein anderes Object. Beide sind getrennt. Änderungen an `state.foo` in fileBrowser1.js ändern NICHT `window.state.foo`. Andere Files (die `state.foo` benutzen ohne `window.state.foo`) sehen einen anderen Wert.

**Test:** Logging hinzufügen in app.js init(): `console.log('window.state:', JSON.stringify(window.state).slice(0, 200))` und prüfen ob die Werte mit `state` aus fileBrowser1.js übereinstimmen.

### Verdacht 5: ESM vs CommonJS
Electron 32 verwendet `contextIsolation: true` standardmäßig. Das `preload.js` mit `contextBridge.exposeInMainWorld` funktioniert nur wenn das richtig konfiguriert ist. Vielleicht ist `window.api` nicht verfügbar weil contextIsolation disabled werden muss.

**Test:** In `main/window/windowSecurity.js` prüfen ob contextIsolation disabled ist. Falls nicht, ist `window.api` in renderer `undefined`.

### Verdacht 6: `<script>`-Tag-Reihenfolge lädt Tab-Files VOR styleHelpers.js
In `renderer/index.html`:
```
<script src="components/ParamRow.js"></script>   ← L29
<script src="tabs/imageTab.js"></script>          ← L30 (uses buildStyleRow)
<script src="tabs/speechTab.js"></script>         ← L31
<script src="tabs/musicTab.js"></script>          ← L32
<script src="tabs/videoTab.js"></script>          ← L33
<script src="tabs/styleHelpers.js"></script>      ← L34 (defines buildStyleRow)
```

`imageTab.js` benutzt `buildStyleRow` BEVOR `styleHelpers.js` geladen ist. `TABS.image.build()` läuft erst in init() (nach allen Scripts), aber wenn der Script-Tag CRASHT, ist `buildStyleRow` möglicherweise nicht definiert.

**Test:** `imageTab.js` am Anfang in einen try/catch wickeln und Fehler loggen.

## Empfohlene Debug-Schritte für die nächste KI

1. **Lies die aktuellen Source-Files** im Projekt (alle unter `renderer/`). Insbesondere:
   - `renderer/index.html` (Script-Reihenfolge)
   - `renderer/app.js` (init-Logik)
   - `renderer/services/fileBrowser1.js` (alle Fixes)
   - `renderer/sections/section24_State.js` (state-Definition)
   - `main/window/windowSecurity.js` (contextIsolation, webPreferences)
   - `main/window/createMainWindow.js` (loadFile)

2. **Bau den asar manuell auf** (nicht durch `npm run build`):
   ```bash
   # Source vorbereiten
   mkdir -p /tmp/asar-src
   cp -r main.js preload.js package.json main src renderer /tmp/asar-src/
   cd /tmp/asar-src
   # Asar packen
   node node_modules/@electron/asar/bin/asar.js pack . /tmp/app.asar
   # Verifizieren
   node node_modules/@electron/asar/bin/asar.js list /tmp/app.asar | head -30
   ```

3. **Ersetze den asar im `dist-stable/` Setup** (nicht im `dist-build/`):
   ```bash
   # Alte Datei ersetzen
   cp /tmp/app.asar dist-stable/MiniMaxAssetTool.app.asar
   # Oder den ganzen App-Ordner neu packen mit fester .exe
   ```

4. **Prüfe ob `window.api` im renderer verfügbar ist** durch hinzufügen einer Log-Zeile in `renderer/debugLog.js`:
   ```js
   log('window.api=' + JSON.stringify(Object.keys(window.api || {})));
   ```
   Diese Log-Datei lesen, dann Rückschlüsse ziehen.

5. **Nutze `electron --inspect=9229`** in der `start.cmd` und verbinde mit Chrome DevTools (`chrome://inspect`).

6. **Wenn alles nichts hilft:** kompletter ROLLBACK auf den letzten funktionierenden Build vor 2 Wochen:
   ```bash
   git log --oneline --all | head -30
   git checkout <commit-vor-phase-3> -- renderer/
   npm run build:full
   ```

## Wichtige Files / Pfade (alle absolut)

- Projekt-Root: `C:\Projects\Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool\`
- `start.cmd` (Launcher): `C:\Projects\Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool\start.cmd`
- `renderer/index.html` (Script-Reihenfolge): `C:\Projects\Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool\renderer\index.html`
- `renderer/app.js` (init-Logik): `C:\Projects\Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool\renderer\app.js`
- `renderer/services/fileBrowser1.js`: `C:\Projects\Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool\renderer\services\fileBrowser1.js`
- `renderer/debugLog.js` (mein Logging): `C:\Projects\Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool\renderer\debugLog.js`
- `main/index.js` (main process): `C:\Projects\Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool\main\index.js`
- `preload.js` (preload bridge): `C:\Projects\Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool\preload.js`
- `renderer-error.log` (mein Output): `C:\Projects\Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool\renderer-error.log`
- `dist/MiniMaxAssetTool-1.1.1-x64.zip` (430 MB, mit stable .exe + neuem asar): `C:\Projects\Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool\dist\MiniMaxAssetTool-1.1.1-x64.zip`
- `dist/MiniMaxAssetTool-Dev-1.1.1-x64.zip` (516 MB, komplettes Projekt): `C:\Projects\Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool\dist\MiniMaxAssetTool-Dev-1.1.1-x64.zip`
- `dist-stable/MiniMaxAssetTool.exe` (stable .exe, SHA256 `1b384ee8ea56e1a18ed0e11626fe2da8c05efda2aab44085b0576e23c6811871`): `C:\Projects\Ceegor-s-Minimax-M3-Asset-Generation-Pipeline-Tool\dist-stable\MiniMaxAssetTool.exe`

## Was ICH falsch gemacht habe

- Zu viele "Fixes" ohne die tatsächliche Ursache zu identifizieren
- Den User mehrfach gebeten manuell Dinge zu tun (F12, Task-Manager, Cache löschen) — der User ist auf Windows 11 Home mit Standard-Settings, viele dieser Dinge sind nicht möglich
- Wiederholt angenommen dass das Problem in der `state`/`el`/`$` Scoping liegt, ohne es tatsächlich zu testen
- Den asar nicht verifiziert (erst am Ende, als es zu spät war)
- Die Log-Datei nicht produktiv gemacht (leer trotz aller Mühe)

## Empfehlung an die nächste KI

1. **Starte mit `git log --oneline -50`** um die Phase-3-Commits zu finden, die das Problem eingeführt haben
2. **Lies `renderer/index.html` Zeile für Zeile** und prüfe die Script-Reihenfolge
3. **Versuche `electron --inspect=9229`** und nutze Chrome DevTools — das ist der einzig zuverlässige Weg Electron-Probleme zu debuggen
4. **Falls gar nichts hilft:** kompletter ROLLBACK auf den letzten funktionierenden Commit
