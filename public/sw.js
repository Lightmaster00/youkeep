// YouKeep service worker.
//
// It only ever caches versioned static assets: the hashed build files under
// /_nuxt/ and the app icons. HTML pages, /api/* and media files always go to
// the network, so no signed-in page or private data is ever stored here and a
// new build never serves stale HTML pointing at deleted bundles.
//
// The page registers this file as /sw.js?v=<buildId>: a new build changes the
// URL, which installs a new worker with a new cache name; activation deletes
// every other cache.

const BUILD_ID = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE_PREFIX = 'youkeep-static-';
const CACHE_NAME = CACHE_PREFIX + BUILD_ID;
const PRECACHE = ['/favicon.ico', '/icon.svg'];
const STATIC_FILES = ['/favicon.ico', '/icon.svg', '/default-playlist.png'];

// 'cache' (cache-first, versioned static asset) or 'network' (do not touch:
// the browser handles it, offline navigations simply fail).
function strategyFor(request) {
  if (request.method !== 'GET') return 'network';
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return 'network';
  if (request.mode === 'navigate') return 'network';
  if (url.search) return 'network';
  if (url.pathname.startsWith('/_nuxt/') && !url.pathname.startsWith('/_nuxt/builds/')) return 'cache';
  if (STATIC_FILES.includes(url.pathname)) return 'cache';
  return 'network';
}

function deleteCaches(keep) {
  return caches.keys().then((keys) =>
    Promise.all(keys.filter((key) => key !== keep).map((key) => caches.delete(key)))
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(deleteCaches(CACHE_NAME).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  if (strategyFor(event.request) !== 'cache') return;
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response && response.ok && response.type === 'basic') {
            cache.put(event.request, response.clone());
          }
          return response;
        });
      })
    )
  );
});

// Sent by the page on logout: nothing of the previous session stays behind.
self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'clear-caches') return;
  const done = deleteCaches(null).then(() => {
    if (event.ports && event.ports[0]) event.ports[0].postMessage({ cleared: true });
  });
  if (event.waitUntil) event.waitUntil(done);
});
