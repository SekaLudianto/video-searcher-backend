// Nama cache
const CACHE_NAME = 'video-searcher-cache-v1';
// Daftar file yang akan di-cache
const urlsToCache = [
  '/',
  '/index.html',
  'https://cdn.tailwindcss.com'
];

// Event 'install': Dipicu saat service worker diinstal
self.addEventListener('install', event => {
  // Tunggu hingga proses caching selesai
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Cache dibuka');
        return cache.addAll(urlsToCache);
      })
  );
});

// Event 'fetch': Dipicu setiap kali ada permintaan jaringan dari aplikasi
self.addEventListener('fetch', event => {
  event.respondWith(
    // Coba cari respons dari cache terlebih dahulu
    caches.match(event.request)
      .then(response => {
        // Jika ditemukan di cache, kembalikan dari cache
        if (response) {
          return response;
        }
        // Jika tidak, lanjutkan dengan permintaan jaringan
        return fetch(event.request);
      }
    )
  );
});

// Event 'activate': Membersihkan cache lama
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
