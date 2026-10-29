// Service worker template; vite.config.ts fills in the version and file list.
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const CACHE = `lonekoll-${VERSION}`;
// OCR files are large and rarely change, so they live in their own cache.
const OCR_CACHE = 'lonekoll-ocr-v1';
// Servers may send "Vary: Origin"; module script requests carry an Origin
// header that the precache requests don't, which would make every lookup miss.
const MATCH = { ignoreVary: true };

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== OCR_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes('/ocr/')) {
    event.respondWith(
      caches.open(OCR_CACHE).then(async (cache) => {
        const hit = await cache.match(request, MATCH);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(caches.match('index.html', MATCH).then((hit) => hit || fetch(request)));
    return;
  }

  event.respondWith(caches.match(request, MATCH).then((hit) => hit || fetch(request)));
});
