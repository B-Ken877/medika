/*
 * Medika service worker — deliberate, security-first caching policy:
 *
 *   NEVER cached:  /api/*, /ws, /uploads/*  (auth responses, medical data,
 *                  chat media, tokens — always hit the network)
 *   Precached:     /offline (the offline fallback page), manifest, icons
 *   Cache-first:   /_next/static/*, /icons/*  (versioned, immutable assets)
 *   Network-first: navigations (fresh app shell), falling back to /offline
 *                  only when the network is unreachable — never a stale
 *                  authenticated page after logout.
 *
 * There is intentionally NO runtime caching of HTML documents: after logout
 * nothing sensitive can resurface from Cache Storage.
 */

const VERSION = "medika-v1";
const STATIC_CACHE = `${VERSION}-static`;
const PRECACHE = `${VERSION}-precache`;

const PRECACHE_URLS = [
  "/offline",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PRECACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

function isNeverCached(url) {
  return (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/uploads/") ||
    url.pathname === "/ws" ||
    url.pathname.startsWith("/admin") // admin panel is a different app entirely
  );
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".woff2") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".webmanifest")
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // mutations always go to network

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // cross-origin (LiveKit, MonCash): untouched

  // Security rule #1: data endpoints are network-only, pass-through.
  if (isNeverCached(url)) return;

  // Navigations: network-first with offline fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches
          .open(PRECACHE)
          .then((cache) => cache.match("/offline"))
          .then((resp) => resp || new Response("Hors ligne", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })),
      ),
    );
    return;
  }

  // Versioned static assets: cache-first.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const fresh = await fetch(request);
          if (fresh.ok) cache.put(request, fresh.clone());
          return fresh;
        } catch (err) {
          return cached || Response.error();
        }
      }),
    );
    return;
  }

  // Everything else: plain network (no opaque caching, no surprises).
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
