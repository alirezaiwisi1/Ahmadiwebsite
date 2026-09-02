/* sw.js — offline shell for Ahmadiwebsite.
 *
 * Strategies:
 *  - App shell (HTML/CSS/JS/manifest/fonts): network-first with cache fallback,
 *    so visitors always get the newest version when online.
 *  - Book PDFs: network-first with cache fallback, so a stale full copy is never
 *    served to PDF.js (which reads books via byte-range requests that bypass
 *    this worker entirely).
 *  - Images/fonts: cache-first (immutable content).
 *
 * Range requests are intentionally left to the browser's default handling so
 * partial-content responses for PDF.js reach the network untouched.
 *
 * OCR (Tesseract) is intentionally not included — the reader does not use OCR;
 * PDF.js (jsDelivr npm mirror of pdfjs-dist) is cached opportunistically at
 * runtime.
 */

const VERSION = "ahmadi-v2.1.0";
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
  "./reader.html",
  "./404.html",
  "./assets/css/style.css",
  "./assets/js/main.js",
  "./assets/js/pdf-core.js",
  "./assets/js/pdf-reader.js",
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

/* Range requests (used by PDF.js for large books) must not be intercepted;
   let the browser handle them natively so partial-content works. */
function isRangeRequest(request) {
  return request.headers.has("range");
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  if (isRangeRequest(request)) return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;

  /* Book PDFs: network-first with cache fallback. PDF.js always issues range
     requests that bypass this handler, so we must never serve a *stale* full
     copy from cache when online, otherwise byte ranges can mismatch. */
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

  /* network-first for everything else (app shell, cdnjs pdf.js) */
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
