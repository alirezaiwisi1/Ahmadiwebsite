/* sw.js — offline shell for Ahmadiwebsite.
 *
 * Strategies:
 *  - App shell (HTML/CSS/JS/manifest/fonts): network-first with cache fallback,
 *    so visitors always get the newest version when online.
 *  - Book PDFs: network-first with cache fallback.
 *  - Images/fonts: cache-first (immutable content).
 */

const VERSION = "ahmadi-v2.2.0";
const SHELL_CACHE = VERSION + "-shell";
const ASSET_CACHE = VERSION + "-assets";

const SHELL_FILES = [
  "./",
  "./index.html",
  "./about.html",
  "./teachings.html",
  "./mahdi.html",
  "./manifesto.html",
  "./wisdom.html",
  "./resources.html",
  "./faq.html",
  "./contact.html",
  "./404.html",
  "./assets/css/style.css",
  "./assets/js/main.js",
  "./manifest.json",
  "./favicon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !key.startsWith(VERSION))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;

  /* Book PDFs: network-first with cache fallback. */
  if (isSameOrigin && url.pathname.includes("/assets/pdf/")) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        try {
          const response = await fetch(request);
          if (response && response.status === 200 && response.headers.get("content-type")?.includes("pdf")) {
            cache.put(request, response.clone());
          }
          return response;
        } catch (err) {
          if (cached) return cached;
          return Response.error();
        }
      })
    );
    return;
  }

  /* cache-first for immutable-ish local assets (images, fonts) */
  const isAsset =
    isSameOrigin &&
    (url.pathname.includes("/assets/images/") ||
      url.pathname.includes("/assets/fonts/") ||
      url.pathname.endsWith(".woff2"));

  if (isAsset) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const response = await fetch(request);
          if (response && response.status === 200) {
            cache.put(request, response.clone());
          }
          return response;
        } catch (err) {
          return Response.error();
        }
      })
    );
    return;
  }

  /* network-first for everything else (app shell) */
  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request);
        if (response && response.status === 200) {
          const cache = await caches.open(
            url.origin === self.location.origin ? SHELL_CACHE : ASSET_CACHE
          );
          cache.put(request, response.clone());
        }
        return response;
      } catch (err) {
        const cached =
          (await caches.match(request)) ||
          (request.mode === "navigate" && (await caches.match("./index.html")));
        if (cached) return cached;
        return Response.error();
      }
    })()
  );
});