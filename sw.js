/* ============================================================
   SCANIA · TEST DRIVE — Service Worker
   Cache-first for assets, network-first for HTML.
   ============================================================ */
const CACHE = 'scania-td-v55';

const PRECACHE = [
  './',
  'index.html',
  'cab.html',
  'admin.html',
  'styles.css?v=211',
  'core.js?v=48',
  'test.js?v=47',
  'cab.js?v=64',
  'sheets.js?v=15',
  'assets/scania-logo.svg',
  'assets/pattern.svg',
  'assets/app-icon.svg',
  'assets/apple-touch-icon.png',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/icon-192-maskable.png',
  'assets/icon-512-maskable.png',
  /* Cab Assessment's category-hub icons — precached explicitly (unlike
     before) so they're fetched once, up front, at install time — likely on
     a stable network — instead of opportunistically whenever someone first
     reaches that screen, where a bad network moment on show-floor wifi
     could leave a broken copy cached until the next full cache reset. */
  'assets/icons/boarding-exiting.svg?v=3',
  'assets/icons/ergonomics-reachability.svg?v=6',
  'assets/icons/fit-finish.svg?v=7',
  'assets/icons/safety-visibility.svg?v=6',
  'manifest.json',
  'manifest-cab.json',
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

  /* Never touch cross-origin requests (the Google Sheets sync calls) — the
     "cache first" branch below would otherwise permanently cache the first
     successful action=data/action=config response (Apps Script sends
     Access-Control-Allow-Origin: *, so those GETs aren't opaque and pass the
     res.ok check) and keep serving that stale snapshot forever, hiding every
     submission and config change made after that first fetch. Let the page's
     own fetch() talk to Apps Script directly, uncached. */
  if (url.origin !== self.location.origin) return;

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
