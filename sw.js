// KidsWallet Service Worker
const CACHE_NAME = 'kidswallet-v8';
const BASE_PATH = '/KidsWallet';

const STATIC_ASSETS = [
  `${BASE_PATH}/shared.css`,
  `${BASE_PATH}/firebase-config.js`,
  `${BASE_PATH}/manifest.json`,
  `${BASE_PATH}/icons/icon-192.png`,
  `${BASE_PATH}/icons/icon-512.png`
];

// JS files with logic that must always be current
const LOGIC_FILES = [
  `${BASE_PATH}/shared.js`
];

const HTML_PAGES = [
  `${BASE_PATH}/`,
  `${BASE_PATH}/index.html`,
  `${BASE_PATH}/wallet.html`,
  `${BASE_PATH}/goals.html`,
  `${BASE_PATH}/admin.html`,
  `${BASE_PATH}/setup.html`
];

// Install event - pre-cache static assets only
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Pre-caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting()) // Activate new SW immediately
  );
});

// Activate event - clean old caches, claim clients right away
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim()) // Take control of existing tabs immediately
  );
});

// Fetch event
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip Firebase / Google requests entirely
  if (event.request.url.includes('firestore') ||
      event.request.url.includes('firebase') ||
      event.request.url.includes('gstatic') ||
      event.request.url.includes('googleapis')) {
    return;
  }

  const url = new URL(event.request.url);
  const isHTML = HTML_PAGES.some(p => url.pathname === p || url.pathname.endsWith('.html'))
                 || event.request.mode === 'navigate';
  const isLogicFile = LOGIC_FILES.some(p => url.pathname === p);

  if (isHTML || isLogicFile) {
    // NETWORK-FIRST for HTML pages and logic JS files: always try to get the latest version
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          // Offline fallback: serve from cache
          console.log('[SW] Offline - serving cached file for:', event.request.url);
          return caches.match(event.request)
            || caches.match(`${BASE_PATH}/index.html`);
        })
    );
  } else {
    // CACHE-FIRST for static assets (CSS, JS, icons): fast loads, revalidate in background
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const networkFetch = fetch(event.request).then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        });
        // Return cache immediately, but always revalidate in background
        return cached || networkFetch;
      })
    );
  }
});
