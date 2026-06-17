// renderer/utils/fileUrl.js
// File-URL-Builder. Phase 3 Block 10: pure Funktion, 0 App-Coupling.
//
// Normalisiert Windows-Backslashes zu Forward-Slashes, encoded
// Sonderzeichen (insbesondere '#' und '?' die encodeURI nicht
// escaped) und sorgt für genau 3 Slashes nach "file:" — manche
// Chromium-Clients und ältere Electron-Versionen lehnen
// file:////home/... als malformed ab.

/**
 * @param {string} p  Absoluter Dateipfad
 * @returns {string}  file://-URL
 */
function fileUrl(p) {
  if (!p) return '';
  let normalized = p.replace(/\\/g, '/');
  const encoded = encodeURI(normalized)
    .replace(/#/g, '%23')
    .replace(/\?/g, '%3F');
  const body = encoded.startsWith('/') ? encoded.slice(1) : encoded;
  return 'file:///' + body;
}

window.FileUrl = { fileUrl };
