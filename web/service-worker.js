'use strict';

const CACHE = 'andres-trainer-v7';
const SHELL = [
  '/', '/static/styles.css', '/static/app.js',
  '/static/oxyfield.js', '/static/runstats.js',
  '/static/icon.svg', '/manifest.webmanifest'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(SHELL))
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

  // Ignorar métodos no-GET y llamadas a la API
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Clonar PRIMERO (síncronamente) antes de que nada consuma el body
        const toCache = (response.ok && url.origin === self.location.origin)
          ? response.clone()
          : null;

        if (toCache) {
          caches.open(CACHE).then(cache => cache.put(event.request, toCache));
        }

        return response;
      })
      .catch(() =>
        // Red caída: servir desde caché, fallback a raíz
        caches.match(event.request).then(cached => cached || caches.match('/'))
      )
  );
});
