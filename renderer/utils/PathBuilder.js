// renderer/utils/PathBuilder.js
// Reine Helfer für Output-Pfade (derivedOutputPath, uniqueOutputPath).
// Stateless — hängt nur am globalen window.

/**
 * Hängt einen Suffix an einen Pfad (vor der Extension).
 * Beispiele:
 *   "C:/out/foo.png" + "_optimized" → "C:/out/foo_optimized.png"
 *   "C:/out/foo" + "_cut"          → "C:/out/foo_cut"
 */
function derivedOutputPath(srcPath, suffix) {
  if (!srcPath) return srcPath;
  const lastDot = srcPath.lastIndexOf('.');
  const lastSlash = Math.max(srcPath.lastIndexOf('/'), srcPath.lastIndexOf('\\'));
  if (lastDot > lastSlash && lastDot !== -1) {
    return srcPath.slice(0, lastDot) + suffix + srcPath.slice(lastDot);
  }
  return srcPath + suffix;
}

/**
 * Liefert einen Pfad, der nicht mit einer existierenden Datei kollidiert.
 * Existiert "out.png" bereits, wird "out (1).png", "out (2).png" probiert.
 * Existenzprüfung via window.api.fbExists (async) — diese Funktion
 * ist die Sync-Variante und prüft NICHT; sie produziert nur den nächsten
 * freien Namen. Caller müssen das asynchrone `resolveUniqueOutputPath`
 * benutzen, wenn eine kollisionsfreie Garantie gebraucht wird.
 */
function nextFreeName(srcPath) {
  const lastDot = srcPath.lastIndexOf('.');
  const lastSlash = Math.max(srcPath.lastIndexOf('/'), srcPath.lastIndexOf('\\'));
  const base = lastDot > lastSlash && lastDot !== -1 ? srcPath.slice(0, lastDot) : srcPath;
  const ext = lastDot > lastSlash && lastDot !== -1 ? srcPath.slice(lastDot) : '';
  return function tryN(n) {
    return n === 0 ? srcPath : `${base} (${n})${ext}`;
  };
}

/**
 * Async: gibt einen garantiert nicht-existenten Pfad zurück.
 * @param {string} srcPath
 * @param {number} [maxAttempts=1000]
 */
async function resolveUniqueOutputPath(srcPath, maxAttempts = 1000) {
  if (!srcPath) return srcPath;
  const tryN = nextFreeName(srcPath);
  for (let i = 0; i < maxAttempts; i++) {
    const cand = tryN(i);
    const exists = await window.api.fbExists(cand);
    if (!exists) return cand;
  }
  // Fallback: Zufalls-Suffix
  const lastDot = srcPath.lastIndexOf('.');
  const ext = lastDot > 0 ? srcPath.slice(lastDot) : '';
  return srcPath + '-' + Date.now() + ext;
}

window.PathBuilder = { derivedOutputPath, resolveUniqueOutputPath, nextFreeName };
