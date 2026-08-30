/* Offline shell. Cache-first for the app files, network-first for content
   so a new module appears without waiting for a cache expiry. */
const VERSION = 'ehd-v1';
const SHELL = [
  './', './index.html', './teaching.html', './archive.html', './alerts.html',
  './night-handover.html', './about.html',
  './assets/style.css', './assets/app.js', './assets/alerts.js',
  './assets/papers.js', './assets/qr.js',
  './manifest.webmanifest'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== location.origin) return;            // never cache gov.uk

  if (url.pathname.includes('/data/')) {                  // content: network first
    e.respondWith(
      fetch(e.request)
        .then(r => { const copy = r.clone();
          caches.open(VERSION).then(c => c.put(e.request, copy)); return r; })
        .catch(() => caches.match(e.request))
    );
    return;
  }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
