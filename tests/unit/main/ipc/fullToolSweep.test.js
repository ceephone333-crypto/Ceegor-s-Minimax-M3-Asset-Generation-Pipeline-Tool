const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const PACKAGE_JSON = require(path.join(ROOT, 'package.json'));

function purgeProjectCache() {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(ROOT) && key !== __filename) delete require.cache[key];
  }
}

async function withModuleMocks(mocks, run) {
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return await run();
  } finally {
    Module._load = originalLoad;
  }
}

function createElectronMock(overrides = {}) {
  const handlers = {};
  const listeners = {};
  const sends = [];
  const showItemInFolderCalls = [];
  const openPathCalls = [];
  const openExternalCalls = [];
  const userDataPath = overrides.userDataPath || path.join(process.cwd(), 'tmp-user-data');
  return {
    handlers,
    listeners,
    sends,
    showItemInFolderCalls,
    openPathCalls,
    openExternalCalls,
    module: {
      ipcMain: {
        handle(channel, fn) { handlers[channel] = fn; },
        on(channel, fn) { listeners[channel] = fn; },
      },
      dialog: {
        showOpenDialog: overrides.showOpenDialog || (async () => ({ canceled: true, filePaths: [] })),
      },
      shell: {
        showItemInFolder(p) { showItemInFolderCalls.push(p); },
        openPath: overrides.openPath || (async (p) => { openPathCalls.push(p); return ''; }),
        openExternal: overrides.openExternal || (async (url) => { openExternalCalls.push(url); }),
      },
      app: {
        getPath(name) {
          if (name === 'userData') return userDataPath;
          if (name === 'exe') return path.join(userDataPath, 'MiniMaxAssetTool.exe');
          return userDataPath;
        },
      },
      BrowserWindow: class BrowserWindow {},
      contextBridge: overrides.contextBridge,
      ipcRenderer: overrides.ipcRenderer,
    },
  };
}

async function withIsolatedProject(options, run) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'full-tool-sweep-'));
  const outputDir = path.join(tmp, 'output');
  const userDataDir = path.join(tmp, 'userData');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(userDataDir, { recursive: true });
  const previousConfigDir = process.env.MINIMAX_CONFIG_DIR;
  process.env.MINIMAX_CONFIG_DIR = tmp;
  purgeProjectCache();
  const electron = createElectronMock({
    userDataPath: userDataDir,
    showOpenDialog: options?.showOpenDialog,
    openPath: options?.openPath,
    openExternal: options?.openExternal,
    contextBridge: options?.contextBridge,
    ipcRenderer: options?.ipcRenderer,
  });
  try {
    return await withModuleMocks(
      { electron: electron.module, ...(options?.mocks || {}) },
      async () => run({
        tmp,
        outputDir,
        userDataDir,
        electron,
        load: (relPath) => require(path.join(ROOT, relPath)),
      }),
    );
  } finally {
    if (previousConfigDir == null) delete process.env.MINIMAX_CONFIG_DIR;
    else process.env.MINIMAX_CONFIG_DIR = previousConfigDir;
    purgeProjectCache();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

function makeSender(sendLog) {
  return {
    id: 17,
    send(channel, data) {
      sendLog.push({ channel, data });
    },
  };
}

test('preload bridge exposes every tool function and maps to the expected channels', async () => {
  const invokes = [];
  const sent = [];
  const listeners = [];
  let exposedName = null;
  let api = null;

  const ipcRenderer = {
    invoke(channel, ...args) {
      invokes.push({ channel, args });
      return Promise.resolve({ channel, args });
    },
    on(channel, fn) {
      listeners.push({ type: 'on', channel, fn });
    },
    removeListener(channel, fn) {
      listeners.push({ type: 'remove', channel, fn });
    },
    send(channel, ...args) {
      sent.push({ channel, args });
    },
  };

  await withIsolatedProject({
    contextBridge: {
      exposeInMainWorld(name, exposed) {
        exposedName = name;
        api = exposed;
      },
    },
    ipcRenderer,
  }, async ({ load }) => {
    load('preload.js');
  });

  assert.equal(exposedName, 'api');
  assert.ok(api);

  const expectedKeys = [
    'getAppVersion',
    'getConfig',
    'setConfig',
    'pickFolder',
    'configPath',
    'defaultOutputDir',
    'mmxRun',
    'mmxRunJob',
    'mmxProfile',
    'voices',
    'quota',
    'authStatus',
    'diagnose',
    'mmxCancel',
    'fbList',
    // v1.1 (audit BUG-2): fbListDrives is the new IPC channel
    // that powers the file browser's "drives list" view (the
    // Up button now navigates to a list of mounted drives when
    // the user is at a drive root). The handler was added in
    // main/ipc/registerFileBrowserIpc.js + preload.js, and the
    // contract test below expects every key the preload
    // bridge exposes. This entry keeps the contract test
    // honest — it will keep failing every time a new IPC
    // surface is added until the list is manually updated, so
    // any new channel must be added here in the same commit
    // that adds it to preload.js.
    'fbListDrives',
    // v1.1.28: fbTrustAncestors — walks up from an already-
    // trusted root and adds each ancestor to the security
    // allow-list. Used by the file browser's Up button so
    // clicking Up out of output_dir keeps working without the
    // user re-picking the parent through the system dialog.
    // The renderer can't ask for arbitrary paths — the main
    // process rejects any dir that's not already a descendant
    // of a trusted root.
    'fbTrustAncestors',
    'fbMkdir',
    'fbEnsureDir',
    'fbRename',
    'fbDelete',
    'fbMove',
    'fbCopy',
    'fbReveal',
    'fbOpenInExplorer',
    'fbRead',
    'fbExists',
    'fbWrite',
    'realesrganAvailable',
    'realesrganRun',
    'realesrganDownload',
    'onRealesrganDownloadProgress',
    'installOpenUrl',
    'installPickAndCopy',
    'isnetbgAvailable',
    'isnetbgRun',
    'optimizeImage',
    'fixImageExtension',
    'refImageExists',
    'audioAvailable',
    'audioProbe',
    'audioDecodePeaks',
    'audioFindZeroCrossing',
    'audioTrimSilence',
    'audioCut',
    'batchesGet',
    'batchesSet',
    'pickFile',
    'stateGet',
    'stateSet',
    'stateArchiveRead',
    'stateArchiveClear',
    'stateArchiveSize',
    'stateArchiveDelete',
    'onBeforeQuit',
    'batchesGenerateExamples',
    'onLog',
    'onLogRich',
    'logToFile',
  ];
  assert.deepEqual(Object.keys(api).sort(), expectedKeys.slice().sort());

  const checks = [
    ['getAppVersion', [], 'app:version'],
    ['getConfig', [], 'config:get'],
    ['setConfig', [{ api_key: 'sk-test' }], 'config:set'],
    ['pickFolder', [], 'config:pickFolder'],
    ['configPath', [], 'config:path'],
    ['defaultOutputDir', [], 'config:defaultOutputDir'],
    ['mmxRun', [['image', '--prompt', 'hello']], 'mmx:run'],
    ['mmxRunJob', [{ args: ['image', 'generate'], jobId: 'j1' }], 'mmx:run:job'],
    ['mmxProfile', [], 'mmx:profile'],
    ['voices', [], 'mmx:voices'],
    ['quota', [], 'mmx:quota'],
    ['authStatus', [], 'mmx:authStatus'],
    ['diagnose', [], 'mmx:diagnose'],
    ['mmxCancel', [], 'mmx:cancel'],
    ['fbList', ['C:\\work'], 'fb:list'],
    ['fbTrustAncestors', ['C:\\work\\sub'], 'fb:trust-ancestors'],
    ['fbMkdir', ['C:\\work', 'sub'], 'fb:mkdir'],
    ['fbEnsureDir', ['C:\\work\\newdir'], 'fb:ensureDir'],
    ['fbRename', ['C:\\work\\a.txt', 'b.txt'], 'fb:rename'],
    ['fbDelete', ['C:\\work\\a.txt'], 'fb:delete'],
    ['fbMove', ['C:\\work\\a.txt', 'C:\\work\\out'], 'fb:move'],
    ['fbCopy', ['C:\\work\\a.txt', 'C:\\work\\out'], 'fb:copy'],
    ['fbReveal', ['C:\\work\\a.txt'], 'fb:reveal'],
    ['fbOpenInExplorer', ['C:\\work\\a.txt'], 'fb:openInExplorer'],
    ['fbRead', ['C:\\work\\a.txt'], 'fb:read'],
    ['fbExists', ['C:\\work\\a.txt'], 'fb:exists'],
    ['fbWrite', ['C:\\work\\a.txt', 'Zm9v'], 'fb:write'],
    ['realesrganAvailable', [], 'upscale:realesrgan:available'],
    ['realesrganRun', ['C:\\in.png', 'C:\\out.png', { model: 'realesrgan-x4plus' }], 'upscale:realesrgan:run'],
    ['realesrganDownload', [], 'upscale:realesrgan:download'],
    ['installOpenUrl', ['https://example.com'], 'install:openUrl'],
    ['installPickAndCopy', ['realesrgan-binary'], 'install:pickAndCopy'],
    ['isnetbgAvailable', [], 'isnetbg:available'],
    ['isnetbgRun', ['C:\\in.png', 'C:\\out.png', { useGpu: true }], 'isnetbg:run'],
    ['optimizeImage', ['C:\\in.png', { quality: 82 }], 'image:optimize'],
    ['fixImageExtension', ['C:\\in.png'], 'image:fixExtension'],
    ['refImageExists', ['C:\\ref.png'], 'image:refExists'],
    ['audioAvailable', [], 'audio:available'],
    ['audioProbe', ['C:\\tone.wav'], 'audio:probe'],
    ['audioDecodePeaks', ['C:\\tone.wav', { maxBuckets: 32 }], 'audio:decodePeaks'],
    ['audioFindZeroCrossing', [[1, -1, 1], 5, 12], 'audio:findZeroCrossing'],
    ['audioTrimSilence', ['C:\\tone.wav', { thresholdDb: -40 }], 'audio:trimSilence'],
    ['audioCut', ['C:\\tone.wav', 'C:\\cut.wav', { startSec: 1, endSec: 2 }], 'audio:cut'],
    ['batchesGet', [], 'batches:get'],
    ['batchesSet', [{ image: ['one'], speech: [], music: [], video: [] }], 'batches:set'],
    ['pickFile', [{ title: 'Pick a file' }], 'file:pick'],
    ['stateGet', [], 'state:get'],
    ['stateSet', [{ currentTab: 'image' }], 'state:set'],
    ['batchesGenerateExamples', [], 'batches:generateExamples'],
  ];

  for (const [method, args, channel] of checks) {
    invokes.length = 0;
    const result = await api[method](...args);
    assert.equal(invokes.length, 1, `${method} should invoke exactly once`);
    assert.equal(invokes[0].channel, channel);
    assert.deepEqual(invokes[0].args, args);
    assert.equal(result.channel, channel);
  }

  const offProgress = api.onRealesrganDownloadProgress(() => {});
  assert.equal(listeners[0].type, 'on');
  assert.equal(listeners[0].channel, 'upscale:realesrgan:download:progress');
  offProgress();
  assert.equal(listeners[1].type, 'remove');
  assert.equal(listeners[1].channel, 'upscale:realesrgan:download:progress');

  const offLog = api.onLog(() => {});
  assert.equal(listeners[2].type, 'on');
  assert.equal(listeners[2].channel, 'mmx:log');
  offLog();
  assert.equal(listeners[3].type, 'remove');
  assert.equal(listeners[3].channel, 'mmx:log');

  // v1.1 (audit BUG-N8): onBeforeQuit is the renderer-side
  // listener for the main process's before-quit signal. The
  // previous test only asserted the bridge method exists
  // (via `expectedKeys`); it didn't verify the call returns
  // a working unsubscribe function. We add a full
  // subscribe-and-unsubscribe cycle below — same shape as
  // the onLog / onRealesrganDownloadProgress tests above.
  const onBeforeQuitCount = listeners.length;
  const offBeforeQuit = api.onBeforeQuit(() => {});
  assert.equal(typeof offBeforeQuit, 'function', 'onBeforeQuit must return a function (the unsubscribe handle)');
  assert.equal(listeners[onBeforeQuitCount].type, 'on');
  assert.equal(listeners[onBeforeQuitCount].channel, 'app:before-quit');
  offBeforeQuit();
  assert.equal(listeners[onBeforeQuitCount + 1].type, 'remove');
  assert.equal(listeners[onBeforeQuitCount + 1].channel, 'app:before-quit');

  api.logToFile('[renderer] boom');
  assert.deepEqual(sent, [{ channel: 'renderer:log', args: ['[renderer] boom'] }]);
});

test('app, config, state, batches, and file browser handlers pass a real filesystem sweep', async () => {
  await withIsolatedProject({
    showOpenDialog: async () => ({ canceled: false, filePaths: [] }),
  }, async ({ outputDir, tmp, electron, load }) => {
    const config = load('src/config.js');
    config.write({
      api_key: 'sk-initial',
      output_dir: outputDir,
      region: 'global',
      theme: 'dark',
      styles: [{ name: 'Default', value: 'Cinematic' }],
    });

    const trustedDir = path.join(tmp, 'trusted-folder');
    fs.mkdirSync(trustedDir, { recursive: true });
    fs.writeFileSync(path.join(trustedDir, 'trusted.txt'), 'trusted', 'utf8');
    electron.module.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [trustedDir] });

    const registrars = [
      'main/ipc/registerAppIpc.js',
      'main/ipc/registerConfigIpc.js',
      'main/ipc/registerStateIpc.js',
      'main/ipc/registerBatchesIpc.js',
      'main/ipc/registerFileBrowserIpc.js',
    ];
    for (const rel of registrars) {
      load(rel).register({ appRoot: ROOT, getMainWindow: () => null });
    }

    const appVersion = electron.handlers['app:version']();
    assert.equal(appVersion.version, PACKAGE_JSON.version);
    assert.equal(appVersion.name, PACKAGE_JSON.name);
    assert.equal(appVersion.productName, PACKAGE_JSON.build.productName);

    const currentConfig = electron.handlers['config:get']();
    assert.equal(currentConfig.api_key, 'sk-initial');
    assert.equal(currentConfig.output_dir, outputDir);

    const savedResult = electron.handlers['config:set'](null, {
      api_key: 'sk-updated',
      output_dir: outputDir,
      region: 'cn',
      theme: 'light',
      styles: [{ name: 'Moody', value: 'Noir' }],
      ignored: 'nope',
    });
    // Bug-fix M2 (_temp5.md 360° audit): config:set now returns an
    // envelope `{ ok, config, error }` instead of the bare config
    // (which was null on failure and crashed callers).
    assert.equal(savedResult.ok, true);
    assert.equal(savedResult.error, null);
    const savedConfig = savedResult.config;
    assert.equal(savedConfig.api_key, 'sk-updated');
    assert.equal(savedConfig.region, 'cn');
    assert.equal(savedConfig.theme, 'light');
    assert.equal(savedConfig.ignored, undefined);
    assert.equal(electron.handlers['config:path'](), path.join(tmp, 'config.txt'));
    assert.equal(electron.handlers['config:defaultOutputDir'](), path.join(path.join(tmp, 'userData'), 'generated'));

    const pickedFolder = await electron.handlers['config:pickFolder']();
    assert.equal(pickedFolder, trustedDir);

    const trustedList = await electron.handlers['fb:list'](null, trustedDir);
    assert.equal(trustedList.ok, true);
    assert.ok(trustedList.items.some((item) => item.name === 'trusted.txt'));

    const base64 = Buffer.from('hello world', 'utf8').toString('base64');
    const rootFile = path.join(outputDir, 'note.txt');
    const writeRes = await electron.handlers['fb:write'](null, rootFile, base64);
    assert.deepEqual(writeRes, { ok: true, path: rootFile });
    // v1.1 (audit BUG-R2-09): fb:exists now returns the
    // { ok, exists } envelope. The test asserts both fields.
    const existsRes = await electron.handlers['fb:exists'](null, rootFile);
    assert.equal(existsRes.ok, true, 'fb:exists should return ok=true on success');
    assert.equal(existsRes.exists, true, 'fb:exists should report the file exists');
    const readRes = await electron.handlers['fb:read'](null, rootFile);
    assert.equal(Buffer.from(readRes.base64, 'base64').toString('utf8'), 'hello world');

    const mkdirRes = await electron.handlers['fb:mkdir'](null, outputDir, 'sub');
    assert.equal(mkdirRes.ok, true);
    assert.equal(fs.existsSync(path.join(outputDir, 'sub')), true);

    // bug-fix D1 (_temp4.md): fb:ensureDir must create a path that does
    // not exist yet directly (no named-child requirement like fb:mkdir),
    // and must still be gated by the same allow-list as every other fb:*
    // handler.
    const notYetCreated = path.join(outputDir, 'ensured-root-child');
    assert.equal(fs.existsSync(notYetCreated), false);
    const ensureRes = await electron.handlers['fb:ensureDir'](null, notYetCreated);
    assert.deepEqual(ensureRes, { ok: true, path: notYetCreated });
    assert.equal(fs.existsSync(notYetCreated), true);

    const deniedEnsure = await electron.handlers['fb:ensureDir'](null, path.join(tmp, 'outside', 'denied'));
    assert.equal(deniedEnsure.ok, false);
    assert.match(deniedEnsure.error, /outside the allowed directories/i);

    const renameRes = await electron.handlers['fb:rename'](null, rootFile, 'renamed.txt');
    assert.equal(renameRes.ok, true);
    const renamedFile = renameRes.path;
    assert.equal(path.basename(renamedFile), 'renamed.txt');

    const copyRes = await electron.handlers['fb:copy'](null, renamedFile, path.join(outputDir, 'sub'));
    assert.equal(copyRes.ok, true);
    assert.equal(fs.existsSync(copyRes.path), true);

    const moveRes = await electron.handlers['fb:move'](null, renamedFile, path.join(outputDir, 'sub'));
    assert.equal(moveRes.ok, true);
    assert.equal(fs.existsSync(moveRes.path), true);
    assert.equal(path.dirname(moveRes.path), path.join(outputDir, 'sub'));

    const listRes = await electron.handlers['fb:list'](null, path.join(outputDir, 'sub'));
    assert.equal(listRes.ok, true);
    assert.ok(listRes.items.some((item) => item.name === path.basename(copyRes.path)));
    assert.ok(listRes.items.some((item) => item.name === path.basename(moveRes.path)));

    const revealRes = electron.handlers['fb:reveal'](null, moveRes.path);
    assert.deepEqual(revealRes, { ok: true });
    assert.deepEqual(electron.showItemInFolderCalls, [moveRes.path]);

    const openExplorerRes = await electron.handlers['fb:openInExplorer'](null, moveRes.path);
    assert.deepEqual(openExplorerRes, { ok: true });
    assert.deepEqual(electron.openPathCalls, [path.dirname(moveRes.path)]);

    const deniedWrite = await electron.handlers['fb:write'](null, path.join(tmp, 'outside', 'bad.txt'), base64);
    assert.equal(deniedWrite.ok, false);
    assert.match(deniedWrite.error, /outside the output directory/i);

    const deleteRes = await electron.handlers['fb:delete'](null, moveRes.path);
    assert.deepEqual(deleteRes, { ok: true, path: moveRes.path });
    assert.equal(fs.existsSync(moveRes.path), false);

    const stateSet = electron.handlers['state:set'](null, {
      tabs: { image: { prompt: 'robot' } },
      currentTab: 'image',
      filePrefix: 'demo-',
      filePrefixForceOnly: true,
    });
    assert.deepEqual(stateSet, { ok: true });
    const savedState = electron.handlers['state:get']();
    assert.equal(savedState.currentTab, 'image');
    assert.equal(savedState.filePrefix, 'demo-');
    assert.equal(savedState.filePrefixForceOnly, true);

    const batchesData = { image: ['one'], speech: ['two'], music: [], video: [] };
    assert.deepEqual(electron.handlers['batches:set'](null, batchesData), { ok: true });
    assert.deepEqual(electron.handlers['batches:get'](), batchesData);

    const examplesRes = await electron.handlers['batches:generateExamples'](null, 'txt');
    assert.equal(examplesRes.ok, true);
    assert.equal(examplesRes.format, 'txt');
    assert.equal(fs.existsSync(examplesRes.path), true);
    assert.equal(fs.existsSync(path.join(outputDir, 'example_batch_import.txt')), true);
    assert.equal(fs.existsSync(path.join(outputDir, 'example_batch_import.md')), false);
  });
});

test('file picker returns structured envelopes for success, cancel, and dialog failures', async () => {
  await withIsolatedProject({}, async ({ electron, load }) => {
    load('main/ipc/registerFilePickerIpc.js').register({ getMainWindow: () => null });
    const pick = electron.handlers['file:pick'];

    electron.module.dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: ['C:\\picked\\asset.png'],
    });
    const ok = await pick(null, {
      title: 'Pick an image',
      filters: [{ name: 'Images', extensions: ['png', 'jpg'] }],
    });
    assert.deepEqual(ok, { ok: true, path: 'C:\\picked\\asset.png' });

    electron.module.dialog.showOpenDialog = async () => ({
      canceled: true,
      filePaths: [],
    });
    const canceled = await pick(null, {});
    assert.deepEqual(canceled, { ok: false, canceled: true });

    electron.module.dialog.showOpenDialog = async () => {
      throw new Error('dialog exploded');
    };
    const failed = await pick(null, {});
    assert.equal(failed.ok, false);
    assert.match(failed.error, /dialog exploded/);
  });
});

test('install IPC returns structured results for URL open and pick-and-copy failure paths', async () => {
  let copyMode = 'ok';
  let resetCounts = { real: 0, isnet: 0 };

  await withIsolatedProject({
    mocks: {
      '../../src/realesrgan': { resetCache() { resetCounts.real += 1; } },
      '../../src/isnetbg': { resetCache() { resetCounts.isnet += 1; } },
      '../services/InstallPickCopyService': {
        async pickAndCopy(kind) {
          if (copyMode === 'throw') throw new Error('copy failed');
          return { ok: true, kind, destPath: 'C:\\bin\\tool.exe' };
        },
      },
    },
  }, async ({ electron, load }) => {
    load('main/ipc/registerInstallIpc.js').register({ appRoot: ROOT, getMainWindow: () => null });
    const openUrl = electron.handlers['install:openUrl'];
    const pickAndCopy = electron.handlers['install:pickAndCopy'];

    const invalid = await openUrl(null, 'javascript:alert(1)');
    assert.equal(invalid.ok, false);
    assert.match(invalid.error, /Only http\(s\) URLs are allowed/i);

    const valid = await openUrl(null, 'https://example.com/download');
    assert.deepEqual(valid, { ok: true });
    assert.deepEqual(electron.openExternalCalls, ['https://example.com/download']);

    const senderEvents = [];
    const success = await pickAndCopy({ sender: makeSender(senderEvents) }, 'realesrgan-binary');
    assert.deepEqual(success, {
      ok: true,
      kind: 'realesrgan-binary',
      destPath: 'C:\\bin\\tool.exe',
    });
    assert.deepEqual(resetCounts, { real: 1, isnet: 1 });

    copyMode = 'throw';
    const failed = await pickAndCopy({ sender: makeSender(senderEvents) }, 'realesrgan-binary');
    assert.equal(failed.ok, false);
    assert.match(failed.error, /copy failed/);
  });
});

test('image, upscale, and background-removal handlers keep returning envelopes when dependencies fail', async () => {
  let imageMode = 'ok';
  let upscaleMode = 'ok';
  let downloadMode = 'ok';
  let isnetMode = 'ok';
  let upscaleResetCount = 0;

  await withIsolatedProject({
    mocks: {
      '../../src/imageOptimizer': {
        async optimize(srcPath, opts) {
          if (imageMode === 'throw') throw new Error('optimizer boom');
          return { ok: true, outputPath: opts.outputPath || srcPath, inputSize: 1, outputSize: 1, savedBytes: 0, savedPercent: 0, format: 'png', width: 1, height: 1 };
        },
        async fixExtensionToMatchContent(filePath) {
          if (imageMode === 'throw') throw new Error('optimizer boom');
          return { ok: true, path: filePath, renamed: false };
        },
      },
      '../../src/realesrgan': {
        isAvailable: () => true,
        getBinaryPath: () => 'C:\\bin\\realesrgan.exe',
        probeVersion: () => '0.2.0',
        async run(_srcPath, dstPath) {
          if (upscaleMode === 'throw') throw new Error('upscale boom');
          return { ok: true, code: 0, stderr: '', outputPath: dstPath };
        },
        resetCache() { upscaleResetCount += 1; },
      },
      '../services/InstallDownloadService': {
        async downloadRealesrgan(_appRoot, send) {
          send({ phase: 'download', downloaded: 5, total: 10 });
          if (downloadMode === 'throw') throw new Error('download boom');
          return { ok: true, binDir: 'C:\\bin' };
        },
      },
      '../../src/isnetbg': {
        isAvailable: () => true,
        getBinaryPath: () => 'C:\\bin\\isnetbg.exe',
        getModelPath: () => 'C:\\bin\\models\\isnet-general-use.onnx',
        probeVersion: () => '1.0.0',
        async run(_srcPath, dstPath) {
          if (isnetMode === 'throw') throw new Error('isnet boom');
          return { ok: true, code: 0, stderr: '', outputPath: dstPath };
        },
      },
    },
  }, async ({ outputDir, electron, load }) => {
    load('src/config.js').write({
      api_key: 'sk-tool',
      output_dir: outputDir,
      region: 'global',
      theme: 'dark',
      styles: [],
    });
    load('main/ipc/registerImageIpc.js').register({ appRoot: ROOT });
    load('main/ipc/registerUpscaleIpc.js').register({ appRoot: ROOT, getMainWindow: () => null });
    load('main/ipc/registerIsnetbgIpc.js').register({ appRoot: ROOT });

    const srcPath = path.join(outputDir, 'in.png');
    const dstPath = path.join(outputDir, 'out.png');

    const imageOk = await electron.handlers['image:optimize'](null, srcPath, { outputPath: dstPath });
    assert.equal(imageOk.ok, true);

    imageMode = 'throw';
    const imageFail = await electron.handlers['image:optimize'](null, srcPath, { outputPath: dstPath });
    assert.equal(imageFail.ok, false);
    assert.match(imageFail.error, /optimizer boom/);
    imageMode = 'ok';

    // bug-fix M6 (_temp4.md)
    const fixOk = await electron.handlers['image:fixExtension'](null, srcPath);
    assert.deepEqual(fixOk, { ok: true, path: srcPath, renamed: false });

    const fixDenied = await electron.handlers['image:fixExtension'](null, path.join(outputDir, '..', 'outside.png'));
    assert.equal(fixDenied.ok, false);
    assert.match(fixDenied.error, /outside the allowed directories/i);

    imageMode = 'throw';
    const fixFail = await electron.handlers['image:fixExtension'](null, srcPath);
    assert.equal(fixFail.ok, false);
    assert.match(fixFail.error, /optimizer boom/);
    imageMode = 'ok';

    const upscaleAvailable = electron.handlers['upscale:realesrgan:available']();
    assert.deepEqual(upscaleAvailable, {
      available: true,
      binaryPath: 'C:\\bin\\realesrgan.exe',
      version: '0.2.0',
    });

    const upscaleOk = await electron.handlers['upscale:realesrgan:run'](null, srcPath, dstPath, { model: 'realesrgan-x4plus' });
    assert.equal(upscaleOk.ok, true);

    upscaleMode = 'throw';
    const upscaleFail = await electron.handlers['upscale:realesrgan:run'](null, srcPath, dstPath, {});
    assert.equal(upscaleFail.ok, false);
    assert.match(upscaleFail.stderr || upscaleFail.error, /upscale boom/);

    const senderEvents = [];
    const downloadOk = await electron.handlers['upscale:realesrgan:download']({ sender: makeSender(senderEvents) });
    assert.deepEqual(downloadOk, { ok: true, binDir: 'C:\\bin' });
    assert.deepEqual(senderEvents, [
      {
        channel: 'upscale:realesrgan:download:progress',
        data: { phase: 'download', downloaded: 5, total: 10 },
      },
    ]);
    assert.equal(upscaleResetCount, 1);

    downloadMode = 'throw';
    const downloadFail = await electron.handlers['upscale:realesrgan:download']({ sender: makeSender([]) });
    assert.equal(downloadFail.ok, false);
    assert.match(downloadFail.error, /download boom/);

    const isnetAvailable = electron.handlers['isnetbg:available']();
    assert.deepEqual(isnetAvailable, {
      available: true,
      binaryPath: 'C:\\bin\\isnetbg.exe',
      modelPath: 'C:\\bin\\models\\isnet-general-use.onnx',
      modelPresent: true,
      version: '1.0.0',
    });

    const isnetOk = await electron.handlers['isnetbg:run'](null, srcPath, dstPath, { useGpu: true });
    assert.equal(isnetOk.ok, true);

    isnetMode = 'throw';
    const isnetFail = await electron.handlers['isnetbg:run'](null, srcPath, dstPath, {});
    assert.equal(isnetFail.ok, false);
    assert.match(isnetFail.stderr || isnetFail.error, /isnet boom/);
  });
});

test('audio handlers cover happy paths, typed-array conversion, and path validation', async () => {
  await withIsolatedProject({
    mocks: {
      '../../src/audioCutter': {
        isAvailable: () => true,
        findBinary: () => 'C:\\bin\\ffmpeg.exe',
        async probe(srcPath) {
          return { ok: true, duration: 2, path: srcPath };
        },
        async decodePeaks() {
          return {
            ok: true,
            peaks: new Float32Array([0.25, 0.75]),
            pcm: new Float32Array([1, -1, 1]),
          };
        },
        findZeroCrossing() {
          return 9;
        },
        async trimSilence() {
          return { ok: true, startSec: 0.2, endSec: 1.8 };
        },
        async cut(_srcPath, dstPath) {
          return { ok: true, outputPath: dstPath };
        },
      },
    },
  }, async ({ outputDir, electron, load }) => {
    load('src/config.js').write({
      api_key: 'sk-audio',
      output_dir: outputDir,
      region: 'global',
      theme: 'dark',
      styles: [],
    });
    load('main/ipc/registerAudioIpc.js').register({ appRoot: ROOT });

    const srcPath = path.join(outputDir, 'tone.wav');
    const dstPath = path.join(outputDir, 'trimmed.wav');

    assert.deepEqual(electron.handlers['audio:available'](), {
      available: true,
      path: 'C:\\bin\\ffmpeg.exe',
    });

    const probe = await electron.handlers['audio:probe'](null, srcPath);
    assert.equal(probe.ok, true);
    assert.equal(probe.duration, 2);

    const peaks = await electron.handlers['audio:decodePeaks'](null, srcPath, { withPcm: true });
    assert.deepEqual(peaks.peaks, [0.25, 0.75]);
    assert.deepEqual(peaks.pcm, [1, -1, 1]);

    const zero = await electron.handlers['audio:findZeroCrossing'](null, new Float32Array([1, -1, 1]), 4, 12);
    assert.deepEqual(zero, { ok: true, index: 9 });

    const trim = await electron.handlers['audio:trimSilence'](null, srcPath, {});
    assert.equal(trim.ok, true);
    assert.equal(trim.startSec, 0.2);

    const cut = await electron.handlers['audio:cut'](null, srcPath, dstPath, {});
    assert.deepEqual(cut, { ok: true, outputPath: dstPath });

    const denied = await electron.handlers['audio:probe'](null, path.join(outputDir, '..', '..', 'forbidden.wav'));
    assert.equal(denied.ok, false);
    assert.match(denied.error, /outside the allowed directories/i);

    const samePath = await electron.handlers['audio:cut'](null, srcPath, srcPath, {});
    assert.equal(samePath.ok, false);
    assert.match(samePath.error, /must differ from the source/i);
  });
});

test('mmx handlers cover validation, streaming logs, voices, quota, auth, cancel, and diagnose', async () => {
  let cfg = { api_key: 'sk-mmx', region: 'global' };
  let runMode = 'ok';
  let cancelCount = 0;
  let voiceKeys = [];
  const cancelByJobIdCalls = [];

  await withIsolatedProject({
    mocks: {
      '../../src/config': {
        read() { return cfg; },
      },
      '../../src/mmx': {
        async runMmx({ args, onLog }) {
          onLog?.(`[log] ${args.join(' ')}`);
          if (runMode === 'quota-fail') {
            return { ok: false, code: 1, stdout: '', stderr: 'quota failed', parsed: null, command: 'mmx', argv: args };
          }
          if (runMode === 'auth-fail') {
            return {
              ok: false,
              code: 1,
              stdout: '',
              stderr: 'node.exe : auth failed',
              parsed: null,
              command: 'mmx',
              argv: args,
            };
          }
          if (runMode === 'auth-api-error') {
            return {
              ok: true,
              code: 0,
              stdout: '',
              stderr: '',
              parsed: { base_resp: { status_code: 401, status_msg: 'bad key' } },
              command: 'mmx',
              argv: args,
            };
          }
          return {
            ok: true,
            code: 0,
            stdout: '{"ok":true}',
            stderr: '',
            parsed: { base_resp: { status_code: 0 } },
            command: 'mmx',
            argv: args,
          };
        },
        cancelAll() {
          cancelCount += 1;
        },
        cancelByJobId(jobId) {
          cancelByJobIdCalls.push(jobId);
          return jobId === 'job-known';
        },
        resolve() {
          return {
            command: 'node.exe',
            prefix: ['mmx.mjs'],
            node: 'C:\\Program Files\\nodejs\\node.exe',
            entry: 'C:\\Users\\AppData\\Roaming\\npm\\node_modules\\mmx-cli\\dist\\mmx.mjs',
            error: null,
          };
        },
      },
      '../services/VoicesCacheService': {
        async get(apiKey) {
          voiceKeys.push(apiKey);
          return [{ id: apiKey || 'none' }];
        },
      },
    },
  }, async ({ electron, load }) => {
    const sent = [];
    const fakeWindow = { webContents: { send(channel, data) { sent.push({ channel, data }); } } };
    load('main/ipc/registerMmxIpc.js').register({ appRoot: ROOT, getMainWindow: () => fakeWindow });

    const run = electron.handlers['mmx:run'];
    const voices = electron.handlers['mmx:voices'];
    const quota = electron.handlers['mmx:quota'];
    const cancel = electron.handlers['mmx:cancel'];
    const authStatus = electron.handlers['mmx:authStatus'];
    const diagnose = electron.handlers['mmx:diagnose'];

    const missingArgs = await run(null, []);
    assert.equal(missingArgs.ok, false);
    assert.match(missingArgs.stderr, /first arg/i);

    const badSubcommand = await run(null, ['rm-all']);
    assert.equal(badSubcommand.ok, false);
    assert.match(badSubcommand.stderr, /not allowed/i);

    cfg = { api_key: '', region: 'global' };
    const noKey = await run(null, ['image']);
    assert.equal(noKey.ok, false);
    assert.match(noKey.stderr, /No API key configured/i);

    cfg = { api_key: 'sk-mmx', region: 'global' };
    runMode = 'ok';
    const okRun = await run(null, ['image', '--prompt', 'robot']);
    assert.equal(okRun.ok, true);
    // Phase A: the new wire format is { line, jobId, kind } (the
    // legacy plain-string fallback would still satisfy the renderer
    // via preload.js onLog's backwards-compat shim).
    assert.deepEqual(sent, [{
      channel: 'mmx:log',
      data: { line: '[log] image --prompt robot', jobId: null, kind: 'stderr' },
    }]);

    const voiceList = await voices();
    assert.deepEqual(voiceList, [{ id: 'sk-mmx' }]);
    assert.deepEqual(voiceKeys, ['sk-mmx']);

    const quotaOk = await quota();
    assert.deepEqual(quotaOk, { ok: true, parsed: { base_resp: { status_code: 0 } } });

    runMode = 'quota-fail';
    const quotaFail = await quota();
    assert.equal(quotaFail.ok, false);
    assert.match(quotaFail.error, /quota failed/i);

    runMode = 'ok';
    const authOk = await authStatus();
    assert.deepEqual(authOk, {
      ok: true,
      message: 'Authenticated. Quota snapshot loaded.',
      command: 'mmx',
    });

    runMode = 'auth-fail';
    const authFail = await authStatus();
    assert.equal(authFail.ok, false);
    assert.equal(authFail.error, 'auth failed');

    runMode = 'auth-api-error';
    const authApiError = await authStatus();
    assert.equal(authApiError.ok, false);
    assert.equal(authApiError.error, 'bad key');

    assert.deepEqual(cancel(), { ok: true });
    assert.equal(cancelCount, 1);

    // bug-fix H4/Phase1 (_temp4.md): a jobId-scoped cancel must call
    // cancelByJobId, NOT the panic-button cancelAll — it must not kill
    // sibling jobs on other tabs/batch items.
    assert.deepEqual(cancel(null, { jobId: 'job-known' }), { ok: true });
    assert.deepEqual(cancelByJobIdCalls, ['job-known']);
    assert.equal(cancelCount, 1, 'a jobId-scoped cancel must not also fall through to cancelAll');

    const diag = await diagnose();
    assert.equal(diag.platform, process.platform);
    assert.equal(diag.nodePath, 'C:\\Program Files\\nodejs\\node.exe');
    assert.equal(diag.mmxCommand, 'node.exe');
    assert.equal(diag.apiKeyPresent, true);
    assert.equal(diag.region, 'global');
  });
});

// bug-fix S1 (_temp4.md): mmx:run / mmx:run:job used to pass --out /
// --out-dir / --download straight through to the spawned mmx process
// with no allow-list check, unlike every other path-taking IPC handler.
// Uses the REAL src/config.js + PathSecurityService (only src/mmx is
// mocked, so no process is actually spawned) so the allow-list check
// runs for real against a real isolated output directory.
test('mmx:run / mmx:run:job reject --out / --out-dir / --download paths outside the allowed directories (S1)', async () => {
  const runCalls = [];
  await withIsolatedProject({
    mocks: {
      '../../src/mmx': {
        async runMmx({ args }) {
          runCalls.push(args);
          return { ok: true, code: 0, stdout: '{"ok":true}', stderr: '', parsed: { ok: true }, command: 'mmx', argv: args };
        },
        cancelAll() {},
        resolve() { return { command: 'mmx', prefix: [], node: null, entry: null, error: null }; },
      },
    },
  }, async ({ outputDir, tmp, electron, load }) => {
    load('src/config.js').write({
      api_key: 'sk-s1',
      output_dir: outputDir,
      region: 'global',
      theme: 'dark',
      styles: [],
    });
    load('main/ipc/registerMmxIpc.js').register({ appRoot: ROOT, getMainWindow: () => null });
    const run = electron.handlers['mmx:run'];
    const runJob = electron.handlers['mmx:run:job'];

    // --- mmx:run -------------------------------------------------------
    const okOut = await run(null, ['image', '--prompt', 'x', '--out', path.join(outputDir, 'a.png')]);
    assert.equal(okOut.ok, true);

    const okOutDir = await run(null, ['image', '--prompt', 'x', '--n', '2', '--out-dir', outputDir]);
    assert.equal(okOutDir.ok, true);

    const noPathFlags = await run(null, ['quota']);
    assert.equal(noPathFlags.ok, true, 'a call with no path flags must be unaffected by the new check');

    const deniedOut = await run(null, ['image', '--prompt', 'x', '--out', path.join(tmp, 'outside', 'a.png')]);
    assert.equal(deniedOut.ok, false);
    assert.match(deniedOut.stderr, /outside the allowed directories/i);
    assert.match(deniedOut.stderr, /--out/);

    const deniedOutDir = await run(null, ['image', '--prompt', 'x', '--n', '2', '--out-dir', path.join(tmp, 'outside')]);
    assert.equal(deniedOutDir.ok, false);
    assert.match(deniedOutDir.stderr, /outside the allowed directories/i);
    assert.match(deniedOutDir.stderr, /--out-dir/);

    const deniedDownload = await run(null, ['video', '--prompt', 'x', '--download', path.join(tmp, 'outside', 'clip.mp4')]);
    assert.equal(deniedDownload.ok, false);
    assert.match(deniedDownload.stderr, /outside the allowed directories/i);

    // A traversal attempt must also be rejected (not just a sibling dir).
    const traversal = await run(null, ['image', '--prompt', 'x', '--out', path.join(outputDir, '..', 'escape.png')]);
    assert.equal(traversal.ok, false);
    assert.match(traversal.stderr, /outside the allowed directories/i);

    // --- mmx:run:job -----------------------------------------------------
    const jobOk = await runJob(null, { args: ['image', '--prompt', 'x', '--out', path.join(outputDir, 'b.png')], jobId: 'j1' });
    assert.equal(jobOk.ok, true);

    const jobDenied = await runJob(null, { args: ['image', '--prompt', 'x', '--out', path.join(tmp, 'outside', 'b.png')], jobId: 'j2' });
    assert.equal(jobDenied.ok, false);
    assert.match(jobDenied.stderr, /outside the allowed directories/i);

    // Exactly the allowed calls reached the spawn layer — none of the
    // denied ones did.
    assert.equal(runCalls.length, 4);
  });
});
