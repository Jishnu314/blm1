const VERSION = "monthly-reports-shell-v2";
const basePath = new URL("./", self.location.href).pathname;
const shell = [
  basePath,
  `${basePath}form/`,
  `${basePath}admin/`,
  `${basePath}form.webmanifest`,
  `${basePath}admin.webmanifest`,
  `${basePath}manifest.webmanifest`,
  `${basePath}app-icon.svg`,
  `${basePath}app-icon-192.png`,
  `${basePath}app-icon-512.png`,
  `${basePath}app-icon-maskable.png`,
  `${basePath}apple-touch-icon.png`,
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(shell)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || !url.pathname.startsWith(basePath)) return;
  // Never cache database/API answers, even if the API shares this origin.
  if (url.pathname.includes("/api/") || url.pathname.includes("/functions/v1/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).then((response) => {
        if (response.ok) caches.open(VERSION).then((cache) => cache.put(request, response.clone()));
        return response;
      }).catch(async () => (await caches.match(request)) || (await caches.match(`${basePath}form/`))),
    );
    return;
  }

  if (/\/assets\/|\.(?:svg|png|webp|woff2?)$/i.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response.ok) caches.open(VERSION).then((cache) => cache.put(request, response.clone()));
        return response;
      })),
    );
  }
});
