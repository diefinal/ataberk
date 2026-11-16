const VERSION = "ataberk-public-v1";
const SAFE = [
  "/offline.html",
  "/css/family.css",
  "/css/family-base.css",
  "/css/experiences.css",
  "/css/community.css",
  "/js/new-games.js",
  "/js/workshop.js",
  "/icons/app-192.png",
  "/icons/app-512.png",
  "/app.webmanifest",
];
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SAFE))
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("ataberk-public-") && k !== VERSION)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  const req = event.request,
    url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (SAFE.includes(url.pathname) && !url.search) {
    event.respondWith(
      fetch(req)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(
              caches.open(VERSION).then((cache) => cache.put(req, copy)),
            );
          }
          return response;
        })
        .catch(() => caches.match(req)),
    );
    return;
  }
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match("/offline.html")));
  }
});
