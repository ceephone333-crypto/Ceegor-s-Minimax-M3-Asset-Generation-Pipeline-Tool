// renderer/state/AppState.js
// Zentraler, mutabler UI-State. Wird per Default-Export in
// `window.AppState` abgelegt. Alle Module lesen/schreiben über
// dieselbe Instanz (kein Build-Step → kein ESM-Import).
//
// In Phase 5 wird dieser State read-only; Module subscriben über
// den EventBus auf Änderungen.

function createDefault() {
  return {
    config: { api_key: '', output_dir: '', region: 'global', theme: 'dark', styles: [] },
    voices: [],
    voicesLoaded: false,
    fbDir: '',
    currentTab: 'image',
    theme: 'dark',
    batches: { image: [], speech: [], music: [], video: [] },
    fbDirs: { image: '', speech: '', music: '', video: '' },
    filePrefix: '',
    realesrganModel: 'realesrgan-x4plus',
    realesrganFirstRunDismissed: false,
    upscaleEnabled: false,
    upscaleSettings: { multiplier: 2, autoCrop: false, cropWidth: 0, cropHeight: 0, cropAnchorX: 'center', cropAnchorY: 'center' },
    removeBackgroundEnabled: false,
    removeBackgroundUseGpu: true,
    optimizeSettings: { enabled: false, quality: 82, format: 'keep', stripMetadata: true },
    layoutSettings: { sidebarW: 360, logbarH: 280, previewW: 480 },
    genStatus: { image: 'idle', speech: 'idle', music: 'idle', video: 'idle' },
    generating: null,
    genQueueSize: { image: 0, speech: 0, music: 0, video: 0 },
    genQueueDone: { image: 0, speech: 0, music: 0, video: 0 },
    _lastPreviewPath: null,
    _fbItems: [],
    _previewBatch: null,
    fbSort: 'name-asc',
    fbColumns: { size: true, type: false, mtime: false, created: false, path: false },
    fbThumbnails: false,
    _logEvents: [],
    _logLastClickedId: null,
  };
}

window.AppState = createDefault();
