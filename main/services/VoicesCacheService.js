// main/services/VoicesCacheService.js
// Cache für die Voice-Liste der MiniMax-API, **per API-Key**.
// Frühere Versionen hatten einen einzigen modul-globalen Cache,
// der bei Key-Wechsel nie invalidiert wurde → User mit zwei
// Accounts bekamen die Voices des ersten Keys für den zweiten.

const path = require('path');
const fs = require('fs');
const { runMmx } = require('../../src/mmx');

/** @type {Map<string, Array>} key = api_key || ''; value = Voice[] */
const voicesCache = new Map();

/**
 * Liefert die Voice-Liste für den gegebenen API-Key.
 * 1. Cache-Hit → sofort zurück.
 * 2. Cache-Miss + Key gesetzt → Live-API (`mmx speech voices`).
 * 3. Cache-Miss + kein Key → bundled `voices.json` (Fallback).
 *
 * @param {string} apiKey
 * @returns {Promise<Array>}
 */
async function get(apiKey) {
  const cacheKey = apiKey || '';
  if (voicesCache.has(cacheKey)) return voicesCache.get(cacheKey);

  // Phase 1: Live-API
  if (apiKey) {
    const r = await runMmx({ args: ['speech', 'voices'], apiKey, onLog: () => {} });
    if (r.ok) {
      const parsed = r.parsed;
      if (Array.isArray(parsed) && parsed.length) {
        voicesCache.set(cacheKey, parsed);
        return parsed;
      }
      if (typeof parsed === 'string') {
        try {
          const v = JSON.parse(parsed);
          if (Array.isArray(v) && v.length) {
            voicesCache.set(cacheKey, v);
            return v;
          }
        } catch { /* fallthrough */ }
      }
    }
  }

  // Phase 2: Fallback auf bundled voices.json
  try {
    const candidates = [
      path.join(__dirname, '..', '..', 'voices.json'),
      path.join(__dirname, '..', '..', 'src', 'voices.json'),
      path.join(process.resourcesPath || '', 'voices.json'),
    ];
    for (const c of candidates) {
      if (c && fs.existsSync(c)) {
        const v = JSON.parse(fs.readFileSync(c, 'utf8'));
        if (Array.isArray(v) && v.length) {
          voicesCache.set(cacheKey, v);
          return v;
        }
      }
    }
  } catch { /* ignore */ }

  // Phase 3: leeres Resultat auch cachen (kein wiederholter Fallback-Roundtrip)
  voicesCache.set(cacheKey, []);
  return [];
}

/**
 * Komplett-Reset. Aufzurufen bei config:set mit neuer API-Key.
 */
function reset() {
  voicesCache.clear();
}

module.exports = { get, reset };
