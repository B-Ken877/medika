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

/*
 * ─── Web Push (issue #36) ─────────────────────────────────────────────────
 * Deliberately added AFTER the caching policy: push handling shares nothing
 * with the fetch pipeline. Rules:
 *   - payloads are UNTRUSTED input: malformed JSON or missing fields fall
 *     back to a generic, privacy-safe notification;
 *   - the deep link is validated to be a SAME-ORIGIN app path (never let a
 *     payload open arbitrary URLs);
 *   - stable tags per category coalesce retries so duplicate visible
 *     notifications are replaced, not stacked;
 *   - click focuses an existing Medika window (navigating it when a URL is
 *     given) or opens a new one; normal authentication applies afterwards.
 */

const PUSH_DEFAULT_TITLE = "Medika";
const PUSH_DEFAULT_BODY = "Ou gen yon nouvo mizajou sou Medika.";
const PUSH_DEFAULT_URL = "/app/notifications";

function safePushUrl(candidate) {
  if (typeof candidate !== "string" || candidate.length === 0) return PUSH_DEFAULT_URL;
  // Same-origin app paths only: "/..." without protocol tricks. Absolute or
  // cross-origin values (and anything scheme-relative) are rejected.
  if (!/^\/(?!\/)[A-Za-z0-9\-._~!$&'()*+,;=:@%/]*$/.test(candidate)) return PUSH_DEFAULT_URL;
  try {
    const resolved = new URL(candidate, self.location.origin);
    if (resolved.origin !== self.location.origin) return PUSH_DEFAULT_URL;
    return resolved.pathname + resolved.search;
  } catch {
    return PUSH_DEFAULT_URL;
  }
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {}; // malformed payload → generic fallback copy
  }
  const title = typeof payload.title === "string" && payload.title ? payload.title : PUSH_DEFAULT_TITLE;
  const body = typeof payload.body === "string" && payload.body ? payload.body : PUSH_DEFAULT_BODY;
  const url = safePushUrl(payload.url);
  const tag = typeof payload.tag === "string" && payload.tag ? payload.tag : "medika";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag, // stable tag: retries replace instead of stacking
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = safePushUrl(event.notification.data && event.notification.data.url);

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clients) {
        if (client.url.startsWith(self.location.origin)) {
          if ("focus" in client) {
            await client.focus();
            if (client.url !== self.location.origin + url && "navigate" in client) {
              try { await client.navigate(url); } catch { /* stay on the current page */ }
            }
            return;
          }
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  // The push service renewed the subscription: resubscribe silently. The
  // server re-binds the endpoint to its owner on the next registration the
  // app performs (the app also refreshes on login).
  event.waitUntil(
    self.registration.pushManager
      .subscribe(event.oldSubscription ? { userVisibleOnly: true } : { userVisibleOnly: true })
      .catch(() => undefined),
  );
});
