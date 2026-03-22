/* ══════════════════════════════════════════════════════════
   ৪ ইঞ্জিনিয়ার ব্যাটালিয়ন — Service Worker
   Version: 3.0.1
   Strategy:
     • App Shell  → Cache First (HTML, fonts, Firebase SDK)
     • Firebase   → Network First (Firestore real-time)
     • Images     → Cache First with fallback
     • API calls  → Network Only
══════════════════════════════════════════════════════════ */

const CACHE_NAME   = '4engr-v3.0.1';
const SHELL_CACHE  = '4engr-shell-v3.0.1';
const IMAGE_CACHE  = '4engr-images-v3.0.1';

/* ── App Shell — এগুলো সবসময় cache এ থাকবে ── */
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

/* ── External assets (fonts, Firebase SDK) ── */
const EXTERNAL_ASSETS = [
  'https://fonts.googleapis.com/css2?family=Noto+Serif+Bengali:wght@400;600;700&family=Cormorant+Garamond:wght@400;600;700&family=Rajdhani:wght@400;600;700&display=swap',
  'https://www.gstatic.com/firebasejs/12.11.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/12.11.0/firebase-app-check-compat.js',
  'https://www.gstatic.com/firebasejs/12.11.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore-compat.js',
  'https://www.gstatic.com/firebasejs/12.11.0/firebase-storage-compat.js',
];

/* ── যেসব URL এ Network Only strategy ── */
const NETWORK_ONLY_PATTERNS = [
  /firestore\.googleapis\.com/,
  /identitytoolkit\.googleapis\.com/,
  /securetoken\.googleapis\.com/,
  /firebase\.googleapis\.com/,
  /firebasestorage\.googleapis\.com/,
  /appcheck\.googleapis\.com/,
];

/* ── Image hosts ── */
const IMAGE_PATTERNS = [
  /firebasestorage\.googleapis\.com.*\/o\//,
  /\.png$/i,
  /\.jpg$/i,
  /\.jpeg$/i,
  /\.webp$/i,
];

/* ══════════════════════════════
   INSTALL — Shell cache তৈরি
══════════════════════════════ */
self.addEventListener('install', event => {
  console.log('[SW] Installing v3.0.1...');
  event.waitUntil(
    Promise.all([
      /* App shell (local files) */
      caches.open(SHELL_CACHE).then(cache => {
        return cache.addAll(
          SHELL_ASSETS.map(url => new Request(url, { cache: 'reload' }))
        ).catch(err => {
          console.warn('[SW] Shell cache partial fail:', err.message);
        });
      }),
      /* External assets (fonts, Firebase SDKs) */
      caches.open(CACHE_NAME).then(cache => {
        return Promise.allSettled(
          EXTERNAL_ASSETS.map(url =>
            cache.add(url).catch(e => console.warn('[SW] External cache skip:', url, e.message))
          )
        );
      }),
    ]).then(() => {
      console.log('[SW] Install complete');
      return self.skipWaiting(); // নতুন SW তাৎক্ষণিক active হবে
    })
  );
});

/* ══════════════════════════════
   ACTIVATE — পুরনো cache মুছো
══════════════════════════════ */
self.addEventListener('activate', event => {
  console.log('[SW] Activating v3.0.1...');
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys
          .filter(key => ![CACHE_NAME, SHELL_CACHE, IMAGE_CACHE].includes(key))
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      );
    }).then(() => {
      console.log('[SW] Activated, claiming clients...');
      return self.clients.claim(); // সব open tab এ নতুন SW নিয়ন্ত্রণ নেবে
    })
  );
});

/* ══════════════════════════════
   FETCH — Request interceptor
══════════════════════════════ */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  /* ── শুধু GET request handle করো ── */
  if (request.method !== 'GET') return;

  /* ── Chrome extension requests skip ── */
  if (url.protocol === 'chrome-extension:') return;

  /* ── Firebase API — Network Only (real-time data) ── */
  if (NETWORK_ONLY_PATTERNS.some(p => p.test(request.url))) {
    event.respondWith(
      fetch(request).catch(() => {
        /* Firestore offline হলে Firebase নিজেই IndexedDB থেকে serve করে */
        return new Response(
          JSON.stringify({ error: 'offline', message: 'অফলাইনে আছেন' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  /* ── Profile photos (Storage) — Cache First ── */
  if (IMAGE_PATTERNS.some(p => p.test(request.url))) {
    event.respondWith(cacheFirstWithFallback(request, IMAGE_CACHE));
    return;
  }

  /* ── Google Fonts — Cache First ── */
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirstWithFallback(request, CACHE_NAME));
    return;
  }

  /* ── Firebase SDK (gstatic) — Cache First ── */
  if (url.hostname === 'www.gstatic.com') {
    event.respondWith(cacheFirstWithFallback(request, CACHE_NAME));
    return;
  }

  /* ── App Shell (local HTML/assets) — Network First, Cache Fallback ── */
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirstWithCache(request));
    return;
  }

  /* ── বাকি সব — Network First ── */
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});

/* ══════════════════════════════
   STRATEGY HELPERS
══════════════════════════════ */

/**
 * Cache First — cache এ থাকলে cache থেকে, না থাকলে network থেকে এনে cache করো
 */
async function cacheFirstWithFallback(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    console.warn('[SW] Cache first fetch failed:', request.url);
    return new Response('অফলাইনে রিসোর্স পাওয়া যায়নি', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

/**
 * Network First — network থেকে এনে cache করো; offline হলে cache fallback
 */
async function networkFirstWithCache(request) {
  const cache = await caches.open(SHELL_CACHE);

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    /* অফলাইন — cache থেকে দাও */
    const cached = await cache.match(request);
    if (cached) {
      console.log('[SW] Serving from cache (offline):', request.url);
      return cached;
    }

    /* HTML request হলে app shell দাও */
    if (request.headers.get('accept')?.includes('text/html')) {
      const shell = await cache.match('./index.html') || await cache.match('./');
      if (shell) return shell;
    }

    return new Response(offlinePage(), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
}

/* ══════════════════════════════
   OFFLINE FALLBACK PAGE
══════════════════════════════ */
function offlinePage() {
  return `<!DOCTYPE html>
<html lang="bn">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>অফলাইন — ৪ ইঞ্জিনিয়ার ব্যাটালিয়ন</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #0d1117; color: #e6e6e6;
    font-family: 'Segoe UI', sans-serif;
    min-height: 100vh; display: flex;
    align-items: center; justify-content: center;
    padding: 20px; text-align: center;
  }
  .box {
    background: #161b22; border: 1px solid rgba(200,169,74,0.25);
    border-radius: 16px; padding: 40px 28px; max-width: 360px; width: 100%;
  }
  .icon { font-size: 52px; margin-bottom: 16px; }
  h1 { color: #c8a94a; font-size: 1.2rem; margin-bottom: 10px; }
  p { color: #8b949e; font-size: 0.85rem; line-height: 1.7; margin-bottom: 20px; }
  button {
    background: linear-gradient(135deg, #c8a94a, #9a7210);
    border: none; border-radius: 10px; padding: 13px 24px;
    color: #0a0c10; font-weight: 700; font-size: 0.9rem;
    cursor: pointer; width: 100%;
  }
</style>
</head>
<body>
<div class="box">
  <div class="icon">📡</div>
  <h1>ইন্টারনেট সংযোগ নেই</h1>
  <p>আপনি অফলাইনে আছেন। ইন্টারনেট সংযোগ স্থাপন করে আবার চেষ্টা করুন।<br><br>
  Firebase Firestore-এর ক্যাশড ডেটা এখনও দেখা যেতে পারে।</p>
  <button onclick="location.reload()">🔄 আবার চেষ্টা করুন</button>
</div>
</body>
</html>`;
}

/* ══════════════════════════════
   MESSAGE — cache force refresh
══════════════════════════════ */
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'CLEAR_CACHE') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
  }
});
