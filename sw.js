/**
 * Coast Salish Formline Carving Canvas offline shell.
 */

const CACHE_NAME = "formline-canvas-v2-static";

const REQUIRED_URLS = ["index.html", "js/haptics.js", "js/engine.js", "manifest.json"];
const OPTIONAL_URLS = ["favicon.ico", "icon-192.png", "icon-512.png"];

function scopeBaseUrl() {
  const scope = self.registration?.scope;
  if (scope) return new URL(scope);
  return new URL("./", self.location);
}

function toScopedUrl(path) {
  return new URL(path, scopeBaseUrl()).href;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(REQUIRED_URLS.map(toScopedUrl));
      for (const path of OPTIONAL_URLS) {
        try {
          await cache.add(toScopedUrl(path));
        } catch {
          // Optional install assets can be absent in preview environments.
        }
      }
      await self.skipWaiting();
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;

      if (event.request.mode === "navigate") {
        const page = await caches.match(toScopedUrl("index.html"));
        if (page) return page;
      }

      return fetch(event.request);
    })()
  );
});
