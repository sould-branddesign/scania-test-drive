/* ============================================================
   SCANIA · TEST DRIVE — Service Worker
   Cache-first for assets, network-first for HTML.
   ============================================================ */
const CACHE = 'scania-td-v6';

const PRECACHE = [
  './',
  'index.html',
  'cab.html',
  'admin.html',
  'styles.css?v=178',
  'core.js?v=43',
  'test.js?v=36',
  'cab.js?v=57',
  'sheets.js?v=10',
  'assets/scania-logo.svg',
  'assets/pattern.svg',
  'assets/apple-touch-icon.png',
  'assets/app-icon.svg',
  'assets/ScaniaSans-Regular.woff2',
  'assets/ScaniaSans-Bold.woff2',
  'assets/ScaniaSansHeadline-Bold.woff2',
  'assets/ScaniaSansHeadline-Regular.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  /* HTML — network first, fall back to cache */
  if (e.request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    e.respondWith(
      fetch(e.request)
        .then((res) => { caches.open(CACHE).then((c) => c.put(e.request, res.clone())); return res; })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  /* JS/CSS/assets — cache first (versioned via ?v= params) */
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
        return res;
      });
    })
  );
});
