/* Cabas hors ligne : l'appli et le dernier relevé de prix restent disponibles sans réseau.
   Changer VERSION à chaque mise en ligne pour que les téléphones récupèrent les nouveaux fichiers. */
const VERSION = "cabas-2026-11-01-8";
/* l'appli : toujours rechargée du réseau à l'installation d'une version */
const SHELL = [
  "./", "index.html", "app.css", "boot.js", "app.js", "packs.js", "scan.js", "optimizer.js", "worker.js", "manifest.webmanifest",
  "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/favicon-32.png",
];
/* les prix : repris du cache de la version précédente à l'installation, puis servis tout de suite depuis le cache à
   chaque ouverture et revérifiés derrière ; l'appli est prévenue quand une version plus récente est arrivée */
const DATA = ["data/catalog.json", "data/retailers.json", "data/meta.json", "data/status.json", "data/recettes.json", "data/history.json", "data/listes.json"];
/* les détails par univers (data/details/<univers>.json : noms chez l'enseigne, liens, offres) sont chargés à la demande,
   servis comme les autres données (cache d'abord) et repris du cache précédent à l'installation d'une version */
const DETAILS = /\/data\/details\/[^/]+\.json$/;
/* partage vers Cabas (share_target du manifeste, en POST) : le texte reçu reste dans le téléphone. Il est gardé dans ce
   cache, que la page lit puis vide, et la page s'ouvre sur Ma liste ; rien ne part sur le réseau */
const SHARE = "cabas-partage";
const SHARE_KEYS = ["title", "text", "url"];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(SHELL.map((f) => new Request(f, { cache: "reload" })));
    const old = (await caches.keys()).filter((k) => k !== VERSION && k !== SHARE);
    for (const f of DATA) {
      let hit = null;
      for (const k of old) { hit = await (await caches.open(k)).match(f); if (hit) break; }
      if (hit) await c.put(f, hit);
      else await c.add(new Request(f)).catch(() => { /* mis en cache à la première lecture */ });
    }
    for (const k of old) {
      const oc = await caches.open(k);
      for (const req of await oc.keys()) if (DETAILS.test(new URL(req.url).pathname) && !(await c.match(req))) { const hit = await oc.match(req); if (hit) await c.put(req, hit); }
    }
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== SHARE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
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
async function shareIn(req) {
  const d = {};
  try { const f = await req.formData(); for (const k of SHARE_KEYS) d[k] = String(f.get(k) || "").slice(0, 8000); } catch (err) { /* formulaire illisible : Ma liste s'ouvre vide */ }
  await (await caches.open(SHARE)).put("partage", new Response(JSON.stringify(d), { headers: { "Content-Type": "application/json" } }));
  return Response.redirect(new URL("./?partage=1#/ecrire", self.registration.scope).href, 303);
}
/* la page de l'appli sans toucher au réseau : pour une adresse qui porte un texte partagé (ancienne cible en GET) */
async function shell() {
  const hit = (await caches.match("index.html")) || (await caches.match("./"));
  return hit || fetch(new URL("./", self.registration.scope).href);
}
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.method === "POST" && req.mode === "navigate") { e.respondWith(shareIn(req)); return; }
  if (req.method !== "GET") return;
  if (req.mode === "navigate" && SHARE_KEYS.concat("partage").some((k) => url.searchParams.has(k))) { e.respondWith(shell()); return; }
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
