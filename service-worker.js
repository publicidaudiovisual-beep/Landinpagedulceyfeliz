const CACHE_NAME = 'dulce-feliz-app-assets-v2';
const APP_ASSETS = new Set([
  '/manifest.webmanifest',
  '/Logo%20Dulce%20y%20Feliz%20Logo%20Nuevo.png',
  '/icon-180.png',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png'
]);

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll([...APP_ASSETS]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key.startsWith('dulce-feliz-app-assets-') && key !== CACHE_NAME)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== 'GET' || requestUrl.origin !== self.location.origin
    || !APP_ASSETS.has(requestUrl.pathname)) return;

  event.respondWith(
    caches.match(event.request).then(cachedResponse => cachedResponse || fetch(event.request))
  );
});
