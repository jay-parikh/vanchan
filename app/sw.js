/*
 * Offline support: every app file is cached on install and served from the
 * cache. A new VERSION makes the browser install a fresh copy; the app checks
 * for one each time it is opened or brought back, and reloads into it.
 */
const VERSION = 'vanchan-v15';
const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/gujlegacy.js',
  'js/pdfbook.js',
  'js/epubbook.js',
  'js/mdbook.js',
  'js/cards.js',
  'js/marks.js',
  'js/ink.js',
  'js/db.js',
  'js/config.js',
  'js/sync.js',
  'js/app.js',
  'vendor/pdf.min.js',
  'vendor/pdf.worker.min.js',
  'vendor/jszip.min.js',
  'fonts/NotoSerifGujarati.woff2',
  'fonts/NotoSansGujarati.woff2',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png'
];

self.addEventListener('install', (e) => {
  // 'reload' skips the browser's HTTP cache, so the new version never stores an old file
  e.waitUntil(caches.open(VERSION)
    .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    // the page itself: cached copy first, so the app opens instantly offline
    e.respondWith(caches.match('index.html').then((r) => r || fetch(req)));
    return;
  }
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((r) => r || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }))
  );
});
