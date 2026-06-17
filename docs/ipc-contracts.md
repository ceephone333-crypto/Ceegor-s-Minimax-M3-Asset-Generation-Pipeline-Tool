# IPC Contracts — `window.api` Bridge

> Verbindlicher Vertrag zwischen Electron **Main-Process** und **Renderer-Process**.
> Quelle: [`preload.js`](../../preload.js) (Renderer-Sicht) + [`main.js`](../../main.js) (Handler).
> Stand: Phase 1 (vor Refactoring). Änderungen müssen hier nachgezogen werden.

## Konventionen

- **Channel-Name** folgt dem Muster `<domäne>:<aktion>` (z. B. `mmx:run`, `fb:list`).
- **Renderer-Brücke** heißt `window.api.<camelCase>(…)` — Mapping ist 1:1 und überlebt das Refactoring unverändert.
- **Alle Handler** geben entweder `{ ok: true, … }` oder `{ ok: false, error: '…' }` zurück. Exceptions werden vom Main-Process eingefangen und in `{ ok: false, error: String(e.message) }` übersetzt.
- **Pflicht-Sicherheit:** Alle Pfad-Argumente werden im Main-Process gegen `allowedRoots()` validiert (Output aus `output_dir` + `trustedPickPaths`). Handler ohne Pfad-Argumente sind explizit markiert.
- **Streaming:** Nur `mmx:log` und `upscale:realesrgan:download:progress` nutzen `webContents.send` (Renderer-zu-Renderer via `on*`-Listener); alle anderen Kanäle sind request/response.

---

## 1. App-Metadaten

| Channel | Renderer | Handler-Datei (Soll) | Eingabe | Ausgabe | Sicherheit |
|---|---|---|---|---|---|
| `app:version` | `getAppVersion()` | `main/ipc/registerAppIpc.js` | — | `{ version, name, productName, error? }` | liest nur `package.json` |

## 2. Config

| Channel | Renderer | Handler-Datei (Soll) | Eingabe | Ausgabe | Sicherheit |
|---|---|---|---|---|---|
| `config:get` | `getConfig()` | `main/ipc/registerConfigIpc.js` | — | `Config` (siehe Schema) | liest `config.txt` |
| `config:set` | `setConfig(cfg)` | `main/ipc/registerConfigIpc.js` | `Partial<Config>` | `Config` | **Sanitizer** in `main/models/ConfigSchema.js` filtert unbekannte Felder |
| `config:path` | `configPath()` | `main/ipc/registerConfigIpc.js` | — | `string` (absoluter Pfad) | — |
| `config:pickFolder` | `pickFolder()` | `main/ipc/registerConfigIpc.js` | — | `string \| null` | fügt `r.filePaths[0]` zu `trustedPickPaths` hinzu |

**Config-Schema** (siehe [`src/config.js`](../src/config.js)):

```ts
type Config = {
  api_key: string;        // '' wenn nicht gesetzt
  output_dir: string;     // absoluter Pfad
  region: 'global' | 'cn';
  theme: 'light' | 'dark';
  styles: Array<{ name: string; value: string }>;
};
```

## 3. mmx (CLI-Wrapper für `mmx image|speech|music|video|quota|voices`)

| Channel | Renderer | Handler-Datei (Soll) | Eingabe | Ausgabe |
|---|---|---|---|---|
| `mmx:run` | `mmxRun(args)` | `main/ipc/registerMmxIpc.js` | `string[]` (args[0] ∈ Allowlist) | `{ ok, code, stdout, stderr, parsed }` |
| `mmx:voices` | `voices()` | `main/ipc/registerMmxIpc.js` | — | `Voice[]` (per API-Key gecached) |
| `mmx:quota` | `quota()` | `main/ipc/registerMmxIpc.js` | — | `{ ok, parsed? , error? }` |
| `mmx:authStatus` | `authStatus()` | `main/ipc/registerMmxIpc.js` | — | `{ ok, message?, error?, command?, argv? }` |
| `mmx:diagnose` | `diagnose()` | `main/ipc/registerMmxIpc.js` | — | `DiagnoseReport` |
| `mmx:cancel` | `mmxCancel()` | `main/ipc/registerMmxIpc.js` | — | `{ ok: true }` (brich alle laufenden mmx-Spawns ab) |
| `mmx:log` (event) | `onLog(cb)` | (Main sendet via `webContents.send`) | — | `string` (eine Log-Zeile) |

**Allowlist** in [`main/models/MmxSubcommandAllowlist.js`](../main/models/MmxSubcommandAllowlist.js): `image | speech | music | video | quota | voices`. Andere Subcommands → `{ ok: false, error: 'subcommand … is not allowed' }`.

## 4. File-Browser (`fb:*`)

| Channel | Renderer | Handler-Datei (Soll) | Eingabe | Ausgabe |
|---|---|---|---|---|
| `fb:list` | `fbList(dir)` | `main/ipc/registerFileBrowserIpc.js` | `string` (dir) | `{ ok, entries?, error? }` |
| `fb:mkdir` | `fbMkdir(dir, name)` | `main/ipc/registerFileBrowserIpc.js` | `string, string` | `{ ok, path?, error? }` |
| `fb:rename` | `fbRename(p, newName)` | `main/ipc/registerFileBrowserIpc.js` | `string, string` | `{ ok, path?, error? }` |
| `fb:delete` | `fbDelete(p)` | `main/ipc/registerFileBrowserIpc.js` | `string` | `{ ok, path?, error? }` |
| `fb:move` | `fbMove(src, destDir)` | `main/ipc/registerFileBrowserIpc.js` | `string, string` | `{ ok, path?, error? }` |
| `fb:copy` | `fbCopy(src, destDir)` | `main/ipc/registerFileBrowserIpc.js` | `string, string` | `{ ok, path?, error? }` |
| `fb:reveal` | `fbReveal(p)` | `main/ipc/registerFileBrowserIpc.js` | `string` | `{ ok: true }` (öffnet Explorer) |
| `fb:read` | `fbRead(p)` | `main/ipc/registerFileBrowserIpc.js` | `string` | `{ ok, base64?, error? }` (≤ Größe sinnvoll handhabbar) |
| `fb:exists` | `fbExists(p)` | `main/ipc/registerFileBrowserIpc.js` | `string` | `boolean` |
| `fb:write` | `fbWrite(outPath, base64Data)` | `main/ipc/registerFileBrowserIpc.js` | `string, string` (Base64) | `{ ok, path?, error? }` (≤ 25 MB; atomar via tmp+rename) |

**Sicherheit:** alle Pfad-Argumente werden via [`main/services/PathSecurityService.js`](../main/services/PathSecurityService.js) (`isPathUnderAny` / `isParentUnderAny`) gegen `allowedRoots()` geprüft.

## 5. Real-ESRGAN (Upscaler, optional)

| Channel | Renderer | Handler-Datei (Soll) | Eingabe | Ausgabe |
|---|---|---|---|---|
| `upscale:realesrgan:available` | `realesrganAvailable()` | `main/ipc/registerUpscaleIpc.js` | — | `{ available, binaryPath?, version }` |
| `upscale:realesrgan:run` | `realesrganRun(src, dst, opts)` | `main/ipc/registerUpscaleIpc.js` | `string, string, { model?, scale?, gpu? }` | `{ ok, code, stderr?, outputPath }` |
| `upscale:realesrgan:download` | `realesrganDownload()` | `main/ipc/registerUpscaleIpc.js` | — | `{ ok, binDir?, error? }` (streamt Fortschritt) |
| `upscale:realesrgan:download:progress` (event) | `onRealesrganDownloadProgress(cb)` | (Main sendet) | — | `{ phase, downloaded, total, status }` |

**Implementierung** lebt in [`main/services/InstallDownloadService.js`](../main/services/InstallDownloadService.js) + [`main/services/DownloadProgressEmitter.js`](../main/services/DownloadProgressEmitter.js) + [`main/services/HttpsRedirect.js`](../main/services/HttpsRedirect.js) + [`main/utils/PowerShellSpawner.js`](../main/utils/PowerShellSpawner.js).

## 6. IS-Net Background-Removal (optional)

| Channel | Renderer | Handler-Datei (Soll) | Eingabe | Ausgabe |
|---|---|---|---|---|
| `isnetbg:available` | `isnetbgAvailable()` | `main/ipc/registerIsnetbgIpc.js` | — | `{ available, binaryPath?, modelPath?, modelPresent, version }` |
| `isnetbg:run` | `isnetbgRun(src, dst, opts)` | `main/ipc/registerIsnetbgIpc.js` | `string, string, { useGpu? }` | `{ ok, code, stderr?, outputPath }` |

## 7. Image-Optimization (Sharp)

| Channel | Renderer | Handler-Datei (Soll) | Eingabe | Ausgabe |
|---|---|---|---|---|
| `image:optimize` | `optimizeImage(src, opts)` | `main/ipc/registerImageIpc.js` | `string, { quality?, format?, stripMetadata?, outputPath? }` | `{ ok, outputPath, inputSize, outputSize, savedBytes, savedPercent, format, width, height, error? }` |

## 8. Audio (ffmpeg-static)

| Channel | Renderer | Handler-Datei (Soll) | Eingabe | Ausgabe |
|---|---|---|---|---|
| `audio:available` | `audioAvailable()` | `main/ipc/registerAudioIpc.js` | — | `{ available, path }` |
| `audio:probe` | `audioProbe(src)` | `main/ipc/registerAudioIpc.js` | `string` | `{ ok, duration, codec, sampleRate, channels, channelLayout, bitRate, format, size, error? }` |
| `audio:decodePeaks` | `audioDecodePeaks(src, opts)` | `main/ipc/registerAudioIpc.js` | `string, { duration, targetRate, maxBuckets, startSec, endSec, withPcm }` | `{ ok, peaks: number[], pcm?: number[], …, error? }` |
| `audio:findZeroCrossing` | `audioFindZeroCrossing(pcm, targetSample, window)` | `main/ipc/registerAudioIpc.js` | `number[], number, number` | `{ ok, index, error? }` |
| `audio:trimSilence` | `audioTrimSilence(src, opts)` | `main/ipc/registerAudioIpc.js` | `string, { … }` | `{ ok, startSec, endSec, leadSilenceSec, tailSilenceSec, …, error? }` |
| `audio:cut` | `audioCut(src, dst, opts)` | `main/ipc/registerAudioIpc.js` | `string, string, { startSec, endSec, fadeMs, fade, copy }` | `{ ok, outputPath, …, error? }` |

## 9. Batches (BatchGen-Speicher)

| Channel | Renderer | Handler-Datei (Soll) | Eingabe | Ausgabe |
|---|---|---|---|---|
| `batches:get` | `batchesGet()` | `main/ipc/registerBatchesIpc.js` | — | `BatchesState` |
| `batches:set` | `batchesSet(batches)` | `main/ipc/registerBatchesIpc.js` | `BatchesState` | `{ ok, error? }` |

## 10. State (Tab-Settings-Autosave)

| Channel | Renderer | Handler-Datei (Soll) | Eingabe | Ausgabe |
|---|---|---|---|---|
| `state:get` | `stateGet()` | `main/ipc/registerStateIpc.js` | — | `AppState` |
| `state:set` | `stateSet(s)` | `main/ipc/registerStateIpc.js` | `AppState` | `{ ok, error? }` |

## 11. File-Picker

| Channel | Renderer | Handler-Datei (Soll) | Eingabe | Ausgabe |
|---|---|---|---|---|
| `file:pick` | `pickFile(opts)` | `main/ipc/registerFilePickerIpc.js` | `{ title?, filters? }` | `{ ok, path?, canceled?, error? }` (fügt Pfad zu `trustedPickPaths` hinzu) |

## 12. Install (Optional-Addons-Popup)

| Channel | Renderer | Handler-Datei (Soll) | Eingabe | Ausgabe |
|---|---|---|---|---|
| `install:openUrl` | `installOpenUrl(url)` | `main/ipc/registerInstallIpc.js` | `string` (http/https) | `{ ok, error? }` (sanitized via [`main/utils/UrlSanitizer.js`](../main/utils/UrlSanitizer.js)) |
| `install:pickAndCopy` | `installPickAndCopy(kind)` | `main/ipc/registerInstallIpc.js` | `'realesrgan-binary' \| 'isnetbg-binary' \| 'isnetbg-model'` | `{ ok, destPath?, kind?, canceled?, error? }` |

**Logik** in [`main/services/InstallPickCopyService.js`](../main/services/InstallPickCopyService.js) + [`main/models/InstallKindsTable.js`](../main/models/InstallKindsTable.js).

---

## Cross-Cutting Concerns (für Refactoring verbindlich)

### `allowedRoots()` — Pflicht für alle Pfad-Handler
[`main/services/PathSecurityService.js`](../main/services/PathSecurityService.js) exportiert:
- `getAllowedRoots()` → `string[]` (`output_dir` + `trustedPickPaths`)
- `isPathUnderAny(p, roots)` → `boolean`
- `isParentUnderAny(p, roots)` → `boolean`
- `addTrusted(p)` → `void` (vom File-Picker aufgerufen)

### `voicesCache` — per-API-Key invalidierbar
[`main/services/VoicesCacheService.js`](../main/services/VoicesCacheService.js) exportiert:
- `get(apiKey)` → `Promise<Voice[]>` (lazy, cached)
- `reset()` → bei `config:set` mit neuer API-Key

### `cancelAll()` — globaler Kill-Switch
[`src/mmx.js`](../src/mmx.js) exportiert `cancelAll()` → bricht alle offenen mmx-Spawns ab.
Wird vom `mmx:cancel`-Handler und vom Close-Confirm-Guard aufgerufen.

---

## Renderer-Module-Map (Phase 3, vorläufig)

| Feature in `app.js` | Z. (geschätzt) | Soll-Datei |
|---|---|---|
| `BUILD_VERSION`, `TOOL_NAME`, `TOOL_INFO` | 20 | `renderer/bootstrap.js` |
| `state`-Objekt (zentral) | 80 | `renderer/state/AppState.js` |
| `init()` / globale Setup-Logik | 300 | `renderer/bootstrap.js` |
| Tab-Logik `image` | 600 | `renderer/tabs/ImageTab.js` |
| Tab-Logik `speech` | 400 | `renderer/tabs/SpeechTab.js` |
| Tab-Logik `music` | 350 | `renderer/tabs/MusicTab.js` |
| Tab-Logik `video` | 350 | `renderer/tabs/VideoTab.js` |
| File-Browser (Tree + Kontext-Menü) | 1200 | `renderer/panels/FileBrowserPanel.js` |
| Preview-Pane (Bild/Text/SRT/JSON) | 600 | `renderer/panels/PreviewPanel.js` |
| Quota-Anzeige | 200 | `renderer/panels/QuotaPanel.js` |
| Settings-Dialog | 400 | `renderer/dialogs/SettingsDialog.js` |
| Optional-Addons-Dialog | 500 | `renderer/dialogs/OptionalAddonsDialog.js` |
| Greetings-Popup | 150 | `renderer/dialogs/GreetingsDialog.js` |
| Diagnose-Dialog | 200 | `renderer/dialogs/DiagnoseDialog.js` |
| Image-Pipeline (Upscale/Crop/Format/BG) | 800 | `renderer/dialogs/ImagePipelineDialog.js` + Sub-Widgets |
| Batch-Runner | 300 | `renderer/tabs/BatchRunner.js` |
| Style-Preset-Editor | 250 | `renderer/components/StylePresetEditor.js` |
| Drag-and-Drop | 150 | `renderer/utils/DragDropHandler.js` |
| Format-Helpers (`bytesToHuman`, `secondsToHMS`) | 80 | `renderer/utils/FormatUtils.js` |
| Pfad-Konstruktoren (`derivedOutputPath`, `uniqueOutputPath`) | 100 | `renderer/utils/PathBuilder.js` |
| Toast-Service | 80 | `renderer/core/ToastService.js` |
| EventBus | 60 | `renderer/core/EventBus.js` |
| ApiClient-Wrapper | 120 | `renderer/core/ApiClient.js` |
| DOM-Helpers | 50 | `renderer/core/DomHelpers.js` |
| Theme-Service | 80 | `renderer/services/ThemeService.js` |
| MmxService | 200 | `renderer/services/MmxService.js` |
| FilePickerService | 100 | `renderer/services/FilePickerService.js` |
| ImagePipelineService | 300 | `renderer/services/ImagePipelineService.js` |

→ Ziel: **~ 30 Module**, max. 500 Z., Durchschnitt ~ 245 Z.

---

**Stand:** Phase 1 abgeschlossen. Dieses Dokument ist die Single Source of Truth für alle IPC-Verträge und das Migrations-Mapping. Änderungen an der Brücke erfordern eine Aktualisierung dieser Datei.
