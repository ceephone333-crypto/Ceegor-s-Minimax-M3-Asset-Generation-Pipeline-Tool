// src/mmxApiKeySync.js
// v1.1 (lint-size split): the API-key sync logic was extracted
// from src/mmx.js so the main file stays under the 500-line
// HARD limit. We expose the state variables here too — they're
// stateful (mtime, size, last hash) and need to persist across
// runMmx() calls.
//
// v1.1 (audit BUG-N4): the implementation tracks the file's
// mtime+size so an external `mmx config set` is detected
// even when the in-memory hash matches.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

let _lastSyncedKeyHash = '';
let _lastSyncedConfigMtime = 0;
let _lastSyncedConfigSize = -1;

function _homeDir() {
  return process.env.USERPROFILE || process.env.HOME
    || (os.userInfo && os.userInfo().homedir);
}

function syncApiKeyToMmxCliConfig(apiKey) {
  if (!apiKey || typeof apiKey !== 'string') return false;
  const hash = crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
  const home = _homeDir();
  if (!home) return false;
  const mmxDir = path.join(home, '.mmx');
  const mmxCfg = path.join(mmxDir, 'config.json');
  let needsVerify = hash !== _lastSyncedKeyHash;
  if (!needsVerify) {
    try {
      const st = fs.statSync(mmxCfg);
      if (st.mtimeMs !== _lastSyncedConfigMtime || st.size !== _lastSyncedConfigSize) {
        needsVerify = true;
      }
    } catch (_) {
      needsVerify = true;
    }
  }
  if (!needsVerify) return true;
  try {
    if (!fs.existsSync(mmxDir)) fs.mkdirSync(mmxDir, { recursive: true });
    let existing = {};
    try { existing = JSON.parse(fs.readFileSync(mmxCfg, 'utf8')); } catch (_) {}
    if (existing && typeof existing === 'object' && existing.api_key === apiKey) {
      _lastSyncedKeyHash = hash;
      try {
        const st = fs.statSync(mmxCfg);
        _lastSyncedConfigMtime = st.mtimeMs;
        _lastSyncedConfigSize = st.size;
      } catch (_) { /* file vanished */ }
      return true;
    }
    existing = (existing && typeof existing === 'object') ? existing : {};
    existing.api_key = apiKey;
    const tmp = mmxCfg + '.tmp-' + process.pid + '-' + Date.now();
    fs.writeFileSync(tmp, JSON.stringify(existing, null, 2));
    try { fs.chmodSync(tmp, 0o600); } catch (_) { /* Windows: noop */ }
    fs.renameSync(tmp, mmxCfg);
    _lastSyncedKeyHash = hash;
    try {
      const st = fs.statSync(mmxCfg);
      _lastSyncedConfigMtime = st.mtimeMs;
      _lastSyncedConfigSize = st.size;
    } catch (_) { /* give up */ }
    return true;
  } catch (_) {
    return false;
  }
}

// v1.1 (test hook): exposes a way to clear the in-memory cache
// between tests so a previous test's HOME doesn't leak into the
// next. The test harness can call this via the module's
// `__resetForTest()` entry point.
function _resetForTest() {
  _lastSyncedKeyHash = '';
  _lastSyncedConfigMtime = 0;
  _lastSyncedConfigSize = -1;
}

module.exports = { syncApiKeyToMmxCliConfig, _resetForTest };
