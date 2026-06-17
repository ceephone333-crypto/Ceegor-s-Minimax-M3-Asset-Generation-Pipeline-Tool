// main/services/HttpsRedirect.js
// HTTPS-GET mit manuellem Redirect-Handling (3xx).
// Node hat keinen nativen "followRedirects"-Toggle für `https.get`,
// und GitHub-Releases-URLs können einen Location-Header auf eine
// S3-URL liefern — also müssen wir den Sprung selber machen.

const https = require('https');

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_MAX_REDIRECTS = 5;

/**
 * Followed Redirects, gibt den **finalen** IncomingMessage zurück.
 * Der Caller ist für `.on('data')` und das Schließen der Streams
 * verantwortlich (sonst leakt das Socket).
 *
 * @param {string} url
 * @param {number} [maxRedirects=5]
 * @returns {Promise<import('http').IncomingMessage>}
 */
function httpsGetFollowingRedirects(url, maxRedirects = DEFAULT_MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    function get(target) {
      https.get(target, (res) => {
        if (REDIRECT_CODES.has(res.statusCode)) {
          const next = res.headers.location;
          res.resume(); // Drain socket, damit es nicht leakt.
          if (!next || maxRedirects <= 0) return reject(new Error('Too many redirects'));
          get(new URL(next, target).toString());
          return;
        }
        resolve(res);
      }).on('error', reject);
    }
    get(url);
  });
}

module.exports = { httpsGetFollowingRedirects };
