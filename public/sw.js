// Service Worker para SREI - Modo Offline y Ultra-Bajo Consumo de Datos Móviles
const CACHE_NAME = 'srei-cache-v3';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/estudiantes.html',
  '/docentes.html',
  '/admin.html',
  '/login.html'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // APIs siempre directas a la red
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(JSON.stringify({
          success: false,
          offline: true,
          message: 'Sin conexión al servidor local.'
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // Navegación (HTML): Red primero para reflejar cambios en tiempo real, respaldo en caché
  if (event.request.mode === 'navigate' || event.request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          return networkResponse;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Estáticos restantes
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      return fetch(event.request);
    })
  );
});
