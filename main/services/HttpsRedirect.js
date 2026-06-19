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
 * Bug-fix #3 (2026-06-19): the previous version captured
 * `maxRedirects` by closure but never decremented it, so the guard
 * (`maxRedirects <= 0`) was dead — a malicious or buggy server that
 * kept returning 3xx in a tight loop would have pinned the function
 * in an infinite recursion (until the socket eventually errored).
 * We now thread a `remaining` counter through the recursion and
 * reject with "Too many redirects" once it hits zero.
 *
 * The `{ get = https.get }` DI seam lets tests substitute the http
 * transport without spinning up a TLS server; production behaviour
 * is unchanged.
 *
 * @param {string} url
 * @param {number} [maxRedirects=5]
 * @param {{ get?: typeof https.get }} [deps]
 * @returns {Promise<import('http').IncomingMessage>}
 */
function httpsGetFollowingRedirects(url, maxRedirects = DEFAULT_MAX_REDIRECTS, deps = {}) {
  const transport = deps.get || https.get;
  return new Promise((resolve, reject) => {
    function get(target, remaining) {
      transport(target, (res) => {
        if (REDIRECT_CODES.has(res.statusCode)) {
          const next = res.headers.location;
          res.resume(); // Drain socket, damit es nicht leakt.
          if (!next || remaining <= 0) return reject(new Error('Too many redirects'));
          get(new URL(next, target).toString(), remaining - 1);
          return;
        }
        resolve(res);
      }).on('error', reject);
    }
    get(url, maxRedirects);
  });
}

module.exports = { httpsGetFollowingRedirects };
