// Service Worker — Home Interview
const CACHE_VERSION = 'hi-v10-places-ttl';
const CORE_ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/data.js',
  './js/app.js',
  './js/firebase.js',
  './js/place-service.js',
  './js/map-leaflet.js',
  './manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_VERSION).then(c => c.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (new URL(req.url).origin !== self.location.origin) return;
  if (req.method !== 'GET') return;
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
  );
});
