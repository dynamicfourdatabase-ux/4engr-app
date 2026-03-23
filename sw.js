// ৪ ইঞ্জিনিয়ার ব্যাটালিয়ন — Service Worker v1.1
const CACHE_NAME = '4engr-v2';
const ASSETS = [
  '/4engr-app/',
  '/4engr-app/index.html',
  '/4engr-app/manifest.json',
  '/4engr-app/icon-192.png',
  '/4engr-app/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Noto+Serif+Bengali:wght@400;600;700&family=Rajdhani:wght@400;600;700&display=swap',
];

// Install
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS).catch(err => console.log('Cache error:', err));
    })
  );
  self.skipWaiting();
});

// Activate — পুরোনো cache মুছো
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — Network first, cache fallback
self.addEventListener('fetch', (e) => {
  if (e.request.url.includes('firebase') || e.request.url.includes('googleapis.com/identitytoolkit')) {
    return;
  }
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res && res.status === 200 && e.request.method === 'GET') {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, resClone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
