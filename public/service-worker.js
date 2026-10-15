// Простой service worker: кэширует оболочку приложения, чтобы иконка/запуск
// работали как отдельное приложение. Данные (API-запросы) всегда идут в сеть.
// Оболочка — «сначала сеть»: телефон всегда получает свежую версию программы,
// кэш нужен только без интернета (раньше старая версия могла жить на телефоне вечно).
const CACHE_NAME = 'expenses-shell-v2';
const SHELL_FILES = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) {
    return; // API всегда напрямую из сети
  }
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request, { cache: 'no-cache' })
      .then((resp) => {
        if (resp && resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
        }
        return resp;
      })
      .catch(() => caches.match(event.request))
  );
});
