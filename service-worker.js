const CACHE_NAME = 'dulce-feliz-app-assets-v5';
const APP_ASSETS = new Set([
  '/manifest.webmanifest',
  '/Logo%20Dulce%20y%20Feliz%20Logo%20Nuevo.png',
  '/logo-bienvenida-v4.webp',
  '/logo-banner-instalacion.webp',
  '/icon-180-v4.png',
  '/icon-192-v4.png',
  '/icon-512-v4.png',
  '/icon-maskable-512-v4.png'
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
