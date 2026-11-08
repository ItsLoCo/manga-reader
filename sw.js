const CACHE_NAME = 'zero-reader-v7'; // <-- Версия обновлена
const ASSETS = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.json'
];

// Установка воркера и кэширование базовой верстки
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Используем Promise.allSettled, чтобы падение одного файла не ломало установку
      return Promise.allSettled(
        ASSETS.map(url => cache.add(url).catch(err => console.warn('SW: Ошибка кэширования', url, err)))
      );
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
            console.log('SW: Удаляем старый кэш', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Стратегия кэширования (Network First с откатом на кэш)
self.addEventListener('fetch', (e) => {
  // Пропускаем запросы, которые не являются GET (например, POST)
  if (e.request.method !== 'GET') return;

  const url = e.request.url;

  // Запросы к API и картинкам (внешние ресурсы) - пропускаем напрямую в сеть
  if (!url.startsWith(self.location.origin)) {
    return; // Позволяем браузеру загружать картинки и данные напрямую
  }

  // Для локальных файлов (HTML, CSS, JS) используем Network First
  e.respondWith(
    fetch(e.request)
      .then((response) => {
        // Если ответ успешный, клонируем его в кэш
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Если сети нет, отдаем из кэша
        return caches.match(e.request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          
          // Если это навигация по сайту (открытие index.html), отдаем главную страницу из кэша
          if (e.request.mode === 'navigate') {
            return caches.match('index.html');
          }
          // Если ничего нет, возвращаем пустую ошибку
          return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
        });
      })
  );
});
