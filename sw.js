/**
 * TotemForge v1.4 — offline shell (cache-first).
 * Precaches HTML, JS, manifest, icons, ceremony audio, and activation art for airplane mode.
 */

const CACHE_NAME = "totemforge-v1-4-static";

const JS_FILES = [
  "config.js",
  "haptics.js",
  "geometry.js",
  "physics.js",
  "audio.js",
  "engine.js",
];

function scopeBaseUrl() {
  const scope = self.registration?.scope;
  if (scope) return new URL(scope);
  return new URL("./", self.location);
}

function precacheRequiredUrls() {
  const base = scopeBaseUrl();
  const indexUrl = new URL("index.html", base).href;
  const jsUrls = JS_FILES.map((name) => new URL(`js/${name}`, base).href);
  const manifestUrl = new URL("manifest.json", base).href;
  return [indexUrl, ...jsUrls, manifestUrl];
}

/** Branding — precached when present (activation screen + install icons). */
function precacheOptionalUrls() {
  const base = scopeBaseUrl();
  return [
    "totemforge-logo-icon.png",
    "favicon.ico",
    "icon-192.png",
    "icon-512.png",
    "ceremony.mp3",
    "assets/TripleOrca.svg",
  ].map((path) => new URL(path, base).href);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(precacheRequiredUrls());
      for (const url of precacheOptionalUrls()) {
        try {
          await cache.add(url);
        } catch {
          /* optional branding assets may be absent until added to the repo */
        }
      }
      await self.skipWaiting();
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    (async () => {
      const hit = await caches.match(event.request);
      if (hit) return hit;

      const indexUrl = new URL("index.html", scopeBaseUrl()).href;
      if (event.request.mode === "navigate") {
        const page = await caches.match(indexUrl);
        if (page) return page;
        try {
          return await fetch(event.request);
        } catch {
          const fallback = await caches.match(indexUrl);
          if (fallback) return fallback;
          throw new TypeError("Offline and index.html is not cached.");
        }
      }

      return fetch(event.request);
    })()
  );
});
