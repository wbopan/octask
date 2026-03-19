const CACHE_NAME = 'octask-v3';
const SHELL_URLS = [
  '/offline',
  '/assets/dashboard.css',
  '/assets/dashboard.js',
];

self.addEventListener('install', (evt) => {
  evt.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(SHELL_URLS.map((url) =>
        fetch(url).then((res) => res.ok && cache.put(url, res))
      ))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (evt) => {
  evt.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (evt) => {
  const url = new URL(evt.request.url);
  if (url.origin !== location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    return;
  }

  if (evt.request.mode === 'navigate') {
    evt.respondWith(
      fetch(evt.request).catch(() => caches.match('/offline'))
    );
    return;
  }

  evt.respondWith(
    caches.match(evt.request).then((cached) => {
      const fresh = fetch(evt.request).then((response) => {
        if (response.ok) {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(evt.request, cloned));
        }
        return response;
      });
      return cached || fresh;
    })
  );
});
