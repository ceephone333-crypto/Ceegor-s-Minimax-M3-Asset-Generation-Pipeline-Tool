// Preload bridge: expose a small, typed API to the renderer
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // ---- config ----
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (cfg) => ipcRenderer.invoke('config:set', cfg),
  pickFolder: () => ipcRenderer.invoke('config:pickFolder'),
  configPath: () => ipcRenderer.invoke('config:path'),

  // ---- mmx ----
  mmxRun: (args) => ipcRenderer.invoke('mmx:run', args),
  voices: () => ipcRenderer.invoke('mmx:voices'),
  quota: () => ipcRenderer.invoke('mmx:quota'),
  authStatus: () => ipcRenderer.invoke('mmx:authStatus'),
  diagnose: () => ipcRenderer.invoke('mmx:diagnose'),
  mmxCancel: () => ipcRenderer.invoke('mmx:cancel'),

  // ---- file browser ----
  fbList: (dir) => ipcRenderer.invoke('fb:list', dir),
  fbMkdir: (dir, name) => ipcRenderer.invoke('fb:mkdir', dir, name),
  fbRename: (path, newName) => ipcRenderer.invoke('fb:rename', path, newName),
  fbDelete: (path) => ipcRenderer.invoke('fb:delete', path),
  fbMove: (src, destDir) => ipcRenderer.invoke('fb:move', src, destDir),
  fbCopy: (src, destDir) => ipcRenderer.invoke('fb:copy', src, destDir),
  fbReveal: (path) => ipcRenderer.invoke('fb:reveal', path),
  fbRead: (path) => ipcRenderer.invoke('fb:read', path),
  fbWrite: (outPath, base64Data) => ipcRenderer.invoke('fb:write', outPath, base64Data),

  // ---- batches (BatchGen storage) ----
  batchesGet: () => ipcRenderer.invoke('batches:get'),
  batchesSet: (batches) => ipcRenderer.invoke('batches:set', batches),

  // ---- file picker ----
  pickFile: (opts) => ipcRenderer.invoke('file:pick', opts),

  // ---- state autosave (tab settings) ----
  stateGet: () => ipcRenderer.invoke('state:get'),
  stateSet: (s) => ipcRenderer.invoke('state:set', s),

  // ---- events ----
  onLog: (cb) => {
    const fn = (_e, line) => cb(line);
    ipcRenderer.on('mmx:log', fn);
    return () => ipcRenderer.removeListener('mmx:log', fn);
  },
});
