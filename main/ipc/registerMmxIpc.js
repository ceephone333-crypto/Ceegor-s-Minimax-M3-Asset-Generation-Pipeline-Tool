// main/ipc/registerMmxIpc.js
// IPC-Handler: `mmx:run` / `mmx:voices` / `mmx:quota` / `mmx:cancel` /
// `mmx:authStatus` / `mmx:diagnose`.
// Subcommands durch main/models/MmxSubcommandAllowlist.js geprüft.

const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const { runMmx, cancelAll, resolve } = require('../../src/mmx');
const cfgMod = require('../../src/config');
const { ALLOWED_MMX_SUBCOMMANDS } = require('../models/MmxSubcommandAllowlist');
const voicesCache = require('../services/VoicesCacheService');

/**
 * @param {{ getMainWindow: () => (Electron.BrowserWindow|null), appRoot: string }} deps
 */
function register({ getMainWindow, appRoot }) {
  // Streamt mmx-Logs in den Log-Pane des Renderers.
  const sendLog = (line) => {
    const win = getMainWindow();
    if (win) {
      try { win.webContents.send('mmx:log', line); } catch (_) {}
    }
  };

  ipcMain.handle('mmx:run', async (_e, args) => {
    try {
      if (!Array.isArray(args) || args.length < 1) {
        return { ok: false, code: -1, stdout: '', stderr: 'mmx: first arg (subcommand) is required', parsed: null };
      }
      if (typeof args[0] !== 'string' || !ALLOWED_MMX_SUBCOMMANDS.has(args[0])) {
        return { ok: false, code: -1, stdout: '', stderr: `mmx: subcommand '${String(args[0])}' is not allowed`, parsed: null };
      }
      const cfg = cfgMod.read();
      if (!cfg.api_key) {
        return { ok: false, code: -1, stdout: '', stderr: 'No API key configured. Edit config.txt next to the .exe.', parsed: null };
      }
      return await runMmx({ args, apiKey: cfg.api_key, onLog: sendLog });
    } catch (e) {
      return { ok: false, code: -1, stdout: '', stderr: `IPC error: ${e.message}`, parsed: null };
    }
  });

  ipcMain.handle('mmx:voices', async () => {
    try {
      const cfg = cfgMod.read();
      return await voicesCache.get(cfg.api_key || '');
    } catch (e) {
      return [];
    }
  });

  ipcMain.handle('mmx:quota', async () => {
    try {
      const cfg = cfgMod.read();
      if (!cfg.api_key) return { ok: false, error: 'No API key configured.' };
      const r = await runMmx({ args: ['quota'], apiKey: cfg.api_key, onLog: () => {} });
      if (!r.ok) return { ok: false, error: r.stderr || r.stdout || 'mmx quota failed', parsed: r.parsed };
      return { ok: true, parsed: r.parsed };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('mmx:cancel', () => { 
    try { cancelAll(); return { ok: true }; } 
    catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('mmx:authStatus', async () => {
    try {
      const cfg = cfgMod.read();
      if (!cfg.api_key) return { ok: false, error: 'No API key configured.' };
      // The most reliable "is this key valid?" signal is a real API call.
      // We use `mmx quota --output json` and inspect the response.
      const r = await runMmx({ args: ['quota'], apiKey: cfg.api_key, onLog: sendLog });
      if (!r.command) {
        return { ok: false, error: r.stderr || 'mmx unavailable', command: null, argv: null };
      }
      if (!r.ok) {
        let detail = r.stderr || r.stdout || `mmx exited with code ${r.code}`;
        // PowerShell on Windows wraps stderr in "node.exe :" — strip it
        detail = String(detail).replace(/^node\.exe\s*:\s*/gm, '').trim();
        return { ok: false, error: detail || `mmx exited with code ${r.code}`, command: r.command, argv: r.argv };
      }
      const parsed = r.parsed;
      if (parsed && typeof parsed === 'object' && parsed.base_resp) {
        const sc = parsed.base_resp.status_code;
        if (sc === 0) {
          return { ok: true, message: 'Authenticated. Quota snapshot loaded.', command: r.command };
        }
        return { ok: false, error: parsed.base_resp.status_msg || `API status_code ${sc}`, command: r.command };
      }
      return { ok: true, message: 'mmx quota returned a response.', command: r.command };
    } catch (e) {
      return { ok: false, error: e.message, command: null, argv: null };
    }
  });

  ipcMain.handle('mmx:diagnose', async () => {
    try {
      const cfg = cfgMod.read();
      const r = resolve();
      return {
        platform: process.platform,
        electronVersion: process.versions.electron || 'n/a',
        nodeVersion: process.versions.node,
        // On Windows, `r.command` is the resolved node.exe and `r.prefix[0]`
        // is the mmx-cli entry script. On macOS/Linux, `r.command` is just
        // 'mmx' (resolved via PATH) and there's no node wrapper. Report them
        // truthfully so the Diagnose modal doesn't show "node.exe: mmx" on
        // non-Windows.
        nodePath: r.node || null,
        mmxEntry: r.entry || r.prefix[0] || null,
        mmxCommand: r.command || null,
        error: r.error,
        apiKeyPresent: !!(cfg.api_key && cfg.api_key.trim()),
        apiKeyLength: (cfg.api_key || '').length,
        region: cfg.region,
      };
    } catch (e) {
      return { error: e.message };
    }
  });

  // Sanity-check: appRoot wird in dieser Version nicht aktiv benutzt
  // (Logs gehen direkt an die Main-Window), bleibt aber im DI-Vertrag
  // für künftige Log-File-Persistierung.
  void appRoot;
}

module.exports = { register };
