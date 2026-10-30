/* Cabas hors ligne : l'appli et le dernier relevé de prix restent disponibles sans réseau.
   Changer VERSION à chaque mise en ligne pour que les téléphones récupèrent les nouveaux fichiers. */
const VERSION = "cabas-2026-10-29-16";
const FILES = [
  "./", "index.html", "app.css", "app.js", "packs.js", "optimizer.js", "worker.js", "manifest.webmanifest",
  "data/catalog.json", "data/retailers.json", "data/meta.json", "data/status.json",
  "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/favicon-32.png",
];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put("index.html", copy)); return res; }).catch(() => caches.match("index.html")));
    return;
  }
  if (url.pathname.includes("/data/")) {
    // prix : toujours la dernière version publiée, la copie en cache ne sert que hors ligne
    e.respondWith(fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return res; }).catch(() => caches.match(req, { ignoreSearch: true })));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
    return res;
  })));
});
