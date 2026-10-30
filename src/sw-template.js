// Service worker template; vite.config.ts fills in the version and file list.
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const CACHE = `lonekoll-${VERSION}`;
// OCR files are large and rarely change, so they live in their own cache.
const OCR_CACHE = 'lonekoll-ocr-v1';
// Earlier versions' caches kept, so a page still running one can load its parts.
const KEEP_VERSIONS = 3;
// Servers may send "Vary: Origin"; module script requests carry an Origin
// header that the precache requests don't, which would make every lookup miss.
const MATCH = { ignoreVary: true };
// The page itself always comes from the server when online. GitHub Pages lets
// browsers keep files for 10 minutes; a page kept from before an update would
// ask for the old version's files, which are gone from the server.
const FRESH = { cache: 'no-store' };

self.addEventListener('install', (event) => {
  // Straight from the server, not from the browser's own short-term cache
  // (which could hold the previous version's page). The new version takes
  // over at once: pages are fetched fresh and older parts stay cached, so a
  // page that is open keeps working, and one that went blank recovers when
  // it is opened again.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((file) => new Request(file, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        // Oldest first (created order); keep the newest few versions.
        const versions = keys.filter((k) => k.startsWith('lonekoll-') && k !== OCR_CACHE && k !== CACHE);
        const old = versions.slice(0, Math.max(0, versions.length - (KEEP_VERSIONS - 1)));
        return Promise.all(old.map((k) => caches.delete(k)));
      })
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
    // The server's page when online; this version's saved one when offline.
    const saved = () => caches.open(CACHE).then((cache) => cache.match('index.html', MATCH));
    event.respondWith(
      fetch(request, FRESH)
        .then((response) => (response.ok ? response : saved().then((hit) => hit || response)))
        .catch(() => saved().then((hit) => hit || Response.error())),
    );
    return;
  }

  event.respondWith(caches.match(request, MATCH).then((hit) => hit || fetch(request)));
});
