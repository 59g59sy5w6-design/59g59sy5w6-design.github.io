/* Cabas hors ligne : l'appli et le dernier relevé de prix restent disponibles sans réseau.
   Changer VERSION à chaque mise en ligne pour que les téléphones récupèrent les nouveaux fichiers. */
const VERSION = "cabas-2026-10-31-4";
/* l'appli : toujours rechargée du réseau à l'installation d'une version */
const SHELL = [
  "./", "index.html", "app.css", "app.js", "packs.js", "scan.js", "optimizer.js", "worker.js", "manifest.webmanifest",
  "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/favicon-32.png",
];
/* les prix : repris du cache de la version précédente à l'installation, puis servis tout de suite depuis le cache à
   chaque ouverture et revérifiés derrière ; l'appli est prévenue quand une version plus récente est arrivée */
const DATA = ["data/catalog.json", "data/retailers.json", "data/meta.json", "data/status.json", "data/recettes.json", "data/history.json"];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(SHELL.map((f) => new Request(f, { cache: "reload" })));
    const old = (await caches.keys()).filter((k) => k !== VERSION);
    for (const f of DATA) {
      let hit = null;
      for (const k of old) { hit = await (await caches.open(k)).match(f); if (hit) break; }
      if (hit) await c.put(f, hit);
      else await c.add(new Request(f)).catch(() => { /* mis en cache à la première lecture */ });
    }
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const sameVersion = (a, b) => {
  for (const h of ["etag", "last-modified", "content-length"]) {
    const x = a.headers.get(h), y = b.headers.get(h);
    if (x && y) return x === y;
  }
  return false;
};
async function tellClients(path) {
  for (const cl of await self.clients.matchAll({ type: "window" })) cl.postMessage({ type: "data", path });
}
/* fichier de prix : la copie en cache d'abord, le réseau derrière ; avec « ?fresh », le réseau d'abord (vérification
   périodique de l'appli), la copie en cache seulement hors ligne */
async function serveData(e, req, url) {
  const key = url.origin + url.pathname, c = await caches.open(VERSION);
  const hit = await c.match(key);
  const net = fetch(req).then(async (res) => {
    if (res.ok) {
      const changed = !hit || !sameVersion(hit, res);
      await c.put(key, res.clone());
      if (changed && hit) await tellClients(url.pathname);
    }
    return res;
  });
  try { e.waitUntil(net.catch(() => {})); } catch (err) { /* navigateur qui refuse un waitUntil tardif : la revérification se fait quand même */ }
  if (url.searchParams.has("fresh")) return net.catch(() => hit || Response.error());
  if (hit) return hit;
  return net.catch(() => Response.error());
}
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
    e.respondWith(serveData(e, req, url));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
    return res;
  })));
});
