/* Spread service worker: cache-first with background network update.
 *
 * BUILD_ID is a cache-name placeholder. Bump it (or have the build pipeline
 * replace __BUILD_ID__ with a commit hash / timestamp) to invalidate old
 * caches: activation deletes every spread-* cache whose name differs.
 */
'use strict';

const BUILD_ID = '__BUILD_ID__';
const CACHE_NAME = 'spread-' + BUILD_ID;

/* App shell, relative to the service worker's location so it works both at a
 * domain root and under a subpath (e.g. username.github.io/REPO/). */
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './favicon.ico',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((n) => n.startsWith('spread-') && n !== CACHE_NAME)
            .map((n) => caches.delete(n))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Never cache non-GET requests.
  if (request.method !== 'GET') return;

  // Never cache cross-origin requests.
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(request).then((cached) => {
        // Refresh the cached copy from the network in the background.
        const network = fetch(request)
          .then((response) => {
            if (response && response.ok && response.type === 'basic') {
              cache.put(request, response.clone());
            }
            return response;
          })
          .catch(() => cached); // offline: fall back to cache (or fail)

        // Cache-first: serve the cached copy immediately when we have one.
        return cached || network;
      })
    )
  );
});
