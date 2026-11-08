const CACHE_NAME = 'zero-reader-v1';
const ASSETS = ['index.html', 'style.css', 'app.js', 'manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => { if (k !== CACHE_NAME) return caches.delete(k); }))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.url.includes('mangadex') || e.request.url.includes('placehold.co')) return;
  e.respondWith(caches.match(e.request).then((res) => res || fetch(e.request)));
});
