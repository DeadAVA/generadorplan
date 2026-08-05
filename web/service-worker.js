'use strict';

const CACHE = 'andres-trainer-v8';
const SHELL = [
  '/', '/static/styles.css', '/static/app.js',
  '/static/oxyfield.js', '/static/runstats.js',
  '/static/icon.svg', '/manifest.webmanifest'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      cache.addAll(SHELL.map(url => new Request(url, { cache: 'no-cache' })))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;

  event.respondWith(
    // cache:'no-cache' fuerza ir a la red ignorando la caché HTTP del browser
    // (evita que Cloudflare max-age=14400 sirva archivos viejos al SW)
    fetch(event.request, { cache: 'no-cache' })
      .then(response => {
        const toCache = (response.ok && url.origin === self.location.origin)
          ? response.clone()
          : null;
        if (toCache) {
          caches.open(CACHE).then(cache => cache.put(event.request, toCache));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then(cached => cached || caches.match('/'))
      )
  );
});
