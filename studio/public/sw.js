'use strict';

// Cache the application shell only. Conversations, roles, API responses, and
// event streams always go directly to the local server and are never cached.
const CACHE_PREFIX = 'meeting-notes-static-';
const CACHE_NAME = `${CACHE_PREFIX}v5`;
const PRECACHE_URLS = [
  '/',
  '/app.js',
  '/styles.css',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon.svg',
];
const STATIC_PATHS = new Set([...PRECACHE_URLS, '/index.html']);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(PRECACHE_URLS.map(url => new Request(url, { cache: 'reload' })));
    // First installation may become active immediately. Updates wait for the
    // user-facing application to request activation, so meetings keep running.
    if (!self.registration.active) await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function networkFirst(request, pathname) {
  const cache = await caches.open(CACHE_NAME);
  const cacheKey = pathname === '/index.html' ? '/' : pathname;
  try {
    const response = await fetch(request);
    if (response.ok && (response.type === 'basic' || response.type === 'default')) {
      // A full cache or storage restriction must not replace a valid live page
      // with an older cached page.
      try { await cache.put(cacheKey, response.clone()); } catch { /* live response remains usable */ }
    }
    return response;
  } catch (error) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    return new Response('오프라인 상태입니다. PC의 회의 프로그램을 실행한 뒤 다시 열어 주세요.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !STATIC_PATHS.has(url.pathname)) return;
  if (request.headers.get('accept')?.includes('text/event-stream')) return;
  event.respondWith(networkFirst(request, url.pathname));
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
  } else if (event.data?.type === 'GET_VERSION') {
    event.source?.postMessage({ type: 'SW_VERSION', version: CACHE_NAME });
  }
});
