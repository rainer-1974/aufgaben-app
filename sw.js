/* Aufgaben-App – hält nur die App-Dateien offline vor. Anfragen an Dropbox werden nie
   abgefangen oder zwischengespeichert. */
const CACHE = "aufgabenapp-v1";
const DATEIEN = [
  "./", "index.html", "styles.css", "kern.js", "dropbox.js", "app.js",
  "manifest.json", "icon.svg", "icon-180.png", "icon-192.png", "icon-512.png",
  "vendor/xlsx.mini.min.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(DATEIEN)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((namen) => Promise.all(namen.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Eigene Dateien: sofort aus dem Speicher, im Hintergrund aktualisieren.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (c) => {
      const treffer = await c.match(e.request, { ignoreSearch: true });
      const netz = fetch(e.request)
        .then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; })
        .catch(() => treffer);
      return treffer || netz;
    })
  );
});
