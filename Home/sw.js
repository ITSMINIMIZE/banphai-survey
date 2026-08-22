// Service Worker — Home Interview
const CACHE_VERSION = 'hi-v73-survfilter';
const CORE_ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/data.js',
  './js/auth-role.js',
  './js/zone-service.js',
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
  // ข้าม HTTP cache ของเบราว์เซอร์ — GitHub Pages ส่ง Cache-Control: max-age=600
  // ถ้าไม่ข้าม เบราว์เซอร์จะคืนไฟล์เก่าให้ SW ได้นานถึง 10 นาทีหลัง deploy
  // (แต่ sw.js เบราว์เซอร์เช็คใหม่เสมอ → ป้ายเวอร์ชันขึ้นเลขใหม่ทั้งที่ JS ยังเก่า)
  const fresh = new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' });

  e.respondWith(
    fetch(fresh)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(req, copy));   // key = req เดิม
        }
        return res;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
  );
});

// ตอบเวอร์ชัน cache ให้หน้าเว็บ (ใช้แสดงป้ายเวอร์ชันมุมจอ — เช็ค cache freshness)
self.addEventListener('message', (e) => {
  if (e.data === 'getVersion' && e.source) e.source.postMessage({ type: 'version', version: CACHE_VERSION });
});
