// Service Worker — Roadside Interview
// กลยุทธ์: network-first สำหรับทุกอย่าง, fall back cache เมื่อ offline
// ทุก deploy ใหม่ขึ้น CACHE_VERSION → cache เก่าโดนล้างอัตโนมัติ
const CACHE_VERSION = 'ri-v5-wiz-soft';
const CORE_ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/data.js',
  './js/app.js',
  './js/firebase.js',
  './js/map.js',
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
  // ข้าม cross-origin (Firebase, Longdo Maps API ฯลฯ) — ให้ผ่านปกติ
  if (new URL(req.url).origin !== self.location.origin) return;
  // ข้าม method นอกจาก GET
  if (req.method !== 'GET') return;

  e.respondWith(
    fetch(req)
      .then(res => {
        // เก็บ copy เข้า cache (เฉพาะ 200)
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
  );
});
