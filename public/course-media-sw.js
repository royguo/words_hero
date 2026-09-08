import {
  MEDIA_CACHE,
  isStoredMedia,
  mediaHash,
  mediaResponse,
  pruneMedia,
} from './course-media-cache.js';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches
        .open(MEDIA_CACHE)
        .then(pruneMedia)
        .catch(() => {}),
    ]),
  );
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // No HTML, API, login, classroom or student data interception/caching.
  if (
    url.origin !== self.location.origin ||
    url.search ||
    !['GET', 'HEAD'].includes(request.method) ||
    !mediaHash(url.pathname)
  )
    return;
  event.respondWith(
    (async () => {
      try {
        const cache = await caches.open(MEDIA_CACHE);
        const response = await cache.match(url.href);
        if (isStoredMedia(response, url.pathname))
          return await mediaResponse(request, response);
        if (response) await cache.delete(url.href);
      } catch {
        // Browser storage restrictions must never prevent ordinary online playback.
      }
      return fetch(request);
    })(),
  );
});
