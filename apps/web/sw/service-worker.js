/*
 * FiberGIS service worker, hand-written. The build (vite.config.ts, plugin "fibergis-service-worker")
 * replaces the two placeholders below with the list of built files and a version, and writes the
 * result to dist/sw.js. It is registered only in production builds and only on https or localhost.
 *
 * What works offline: the app opens (all built JavaScript, styles, fonts and the QR decoder are
 * stored at install), capture saves to the phone, and recorded audio clips play. What does not:
 * map pictures (tiles are never stored) and anything that needs the server.
 */
const VERSION = '__FIBERGIS_SW_VERSION__';
const PRECACHE = /** @type {string[]} */ (__FIBERGIS_PRECACHE__);

const SHELL_CACHE = `fibergis-shell-${VERSION}`;
const RUNTIME_CACHE = 'fibergis-runtime-v1';
const AUDIO_CACHE = 'fibergis-audio-v1';
const NAVIGATION_TIMEOUT_MS = 4000;
/** Cross-origin files worth keeping: the map's stylesheet. Map tiles are deliberately left out. */
const CACHEABLE_CROSS_ORIGIN = ['https://unpkg.com/leaflet@'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(PRECACHE);
      await cacheAudioClips();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith('fibergis-shell-') && name !== SHELL_CACHE).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

/** Stores every clip listed in /audio/manifest.json, so the speaker works with no signal. */
async function cacheAudioClips() {
  try {
    const response = await fetch('/audio/manifest.json', { cache: 'no-cache' });
    if (!response.ok) return;
    const cache = await caches.open(AUDIO_CACHE);
    await cache.put('/audio/manifest.json', response.clone());
    const { clips = {} } = await response.json();
    const urls = Object.entries(clips).flatMap(([lang, keys]) =>
      Array.isArray(keys) ? keys.map((key) => `/audio/${lang}/${encodeURIComponent(key)}.mp3`) : [],
    );
    await Promise.all(urls.map((url) => cache.add(url).catch(() => undefined)));
  } catch {
    // No clips yet, or offline during install.
  }
}

async function networkFirstPage(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NAVIGATION_TIMEOUT_MS)),
    ]);
    if (response.ok) await cache.put('/index.html', response.clone());
    return response;
  } catch {
    // Every page is the same single-page app, so the stored shell serves any address.
    return (await cache.match('/index.html')) ?? Response.error();
  }
}

async function cacheFirst(request, cacheName) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) (await caches.open(cacheName)).put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const hit = await cache.match(request);
  const refresh = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  return hit ?? (await refresh) ?? Response.error();
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) ?? Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    if (CACHEABLE_CROSS_ORIGIN.some((prefix) => request.url.startsWith(prefix))) event.respondWith(staleWhileRevalidate(request));
    return;
  }
  // The API is never answered from a cache: an old network would look current.
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname === '/sw.js') return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(request));
    return;
  }
  if (url.pathname === '/audio/manifest.json') {
    event.respondWith(networkFirst(request, AUDIO_CACHE));
    return;
  }
  if (url.pathname.startsWith('/audio/')) {
    event.respondWith(cacheFirst(request, AUDIO_CACHE));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
    return;
  }
  event.respondWith(staleWhileRevalidate(request));
});
