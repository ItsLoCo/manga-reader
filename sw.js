const CACHE_NAME = 'zero-reader-v2';
const ASSETS = [
  'index.html',
  'style.css',
  'app.js',
  'manifest.json'
];

// Установка воркера и кэширование базовой верстки интерфейса
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Активация и очистка старых версий кэша
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// ГЛАВНЫЙ СЕТЕВОЙ ФИЛЬТР: Обходим CORS блокировки Apple на лету
self.addEventListener('fetch', (e) => {
  const url = e.request.url;

  // Если запрос идет к API или серверам картинок MangaDex
  if (url.includes('api.mangadex.org') || url.includes('uploads.mangadex.org')) {
    e.respondWith(
      // Клонируем исходный запрос, чтобы модифицировать заголовки
      fetch(e.request, {
        mode: 'cors',
        credentials: 'omit',
        headers: {
          'Origin': 'https://mangadex.org',
          'Referer': 'https://mangadex.org'
        }
      }).catch(err => {
        console.error('Ошибка сетевого фильтра SW:', err);
        // Если сеть отвалилась, возвращаем пустой ответ вместо падения скрипта
        return new Response('', { status: 408, statusText: 'Network Error' });
      })
    );
    return;
  }

  // Для обычных файлов нашего сайта (HTML, CSS, JS) используем кэш
  e.respondWith(
    fetch(e.request).catch(() => {
      return caches.match(e.request);
    })
  );
});
