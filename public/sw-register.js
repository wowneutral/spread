/* Registers the Spread service worker in production only.
 * Plain script (no module imports) — include from index.html:
 *   <script src="/sw-register.js" defer></script>
 * (use a relative "sw-register.js" src if the site is served from a subpath).
 */
'use strict';

(function () {
  var isLocal =
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1' ||
    location.hostname === '[::1]';

  if (!('serviceWorker' in navigator)) return;
  if (isLocal) return;
  if (location.protocol !== 'https:') return;

  window.addEventListener('load', function () {
    // Relative URL so the worker registers under the app's base path
    // (works at a domain root and at username.github.io/REPO/).
    navigator.serviceWorker.register('sw.js').catch(function (err) {
      console.warn('Service worker registration failed:', err);
    });
  });
})();
