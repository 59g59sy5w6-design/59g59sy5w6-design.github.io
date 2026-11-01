/* Cabas hors ligne : l'appli et le dernier relevé de prix restent disponibles sans réseau.
   Changer VERSION à chaque mise en ligne pour que les téléphones récupèrent les nouveaux fichiers. */
const VERSION = "cabas-2026-11-01-11";
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
/* déménagement : l'appli passe de l'ancienne adresse à https://cabas.mmt-advisory.com. Le navigateur garde les données
   (panier, listes, réglages) par adresse : quand GitHub Pages redirige l'ancienne adresse vers la nouvelle, la page de
   l'appli n'est pas suivie, elle s'ouvre depuis le cache sur l'ancienne adresse, avec ses données (./?demenage=1), et
   l'appli propose de les emporter dans un lien (#/demenage, puis #/transfert sur la nouvelle adresse). Ailleurs (la
   nouvelle adresse, localhost), rien ne change. */
const OLD_HOST = "59g59sy5w6-design.github.io";
const NEW_ORIGIN = "https://cabas.mmt-advisory.com";
const MOVING = self.location.host === OLD_HOST;
/* sur l'ancienne adresse redirigée, une réponse venue de la nouvelle est rendue comme venue d'ici (même contenu, sans
   son adresse d'arrivée) : la règle de contenu de la page refuserait sinon les prix arrivés d'une autre adresse, et
   l'appli restée sur l'ancienne adresse continue de marcher, prix à jour compris. Avant la bascule, rien ne change. */
const fromNew = (res) => MOVING && res.redirected && new URL(res.url).origin === NEW_ORIGIN;
async function here(res) {
  if (!fromNew(res)) return res;
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
}

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
async function tellClients(path, type) {
  for (const cl of await self.clients.matchAll({ type: "window" })) cl.postMessage({ type: type || "data", path });
}
/* fichier de prix : la copie en cache d'abord, le réseau derrière ; avec « ?fresh », le réseau d'abord (vérification
   périodique de l'appli), la copie en cache seulement hors ligne */
async function serveData(e, req, url) {
  const key = url.origin + url.pathname, c = await caches.open(VERSION);
  const hit = await c.match(key);
  const net = fetch(req).then(async (res) => {
    /* l'ancienne adresse redirige déjà vers la nouvelle : l'appli ouverte le dit */
    if (fromNew(res)) { await tellClients(url.pathname, "moved"); res = await here(res); }
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
/* la page de l'appli sans toucher au réseau : pour une adresse qui porte un texte partagé (ancienne cible en GET) ou
   le marqueur du déménagement */
async function shell() {
  const hit = (await caches.match("index.html")) || (await caches.match("./"));
  return hit || fetch(new URL("./", self.registration.scope).href);
}
/* une page de l'appli (la racine ou index.html), pas un autre fichier ouvert dans un onglet */
const appPage = (url) => { const root = new URL(self.registration.scope).pathname; return url.pathname === root || url.pathname === root + "index.html"; };
/* la page de l'appli redirigée par l'ancienne adresse. Une redirection opaque ne dit pas où elle mène : la même adresse
   est redemandée en CORS, sans cookie ni cache (GitHub Pages répond Access-Control-Allow-Origin: *), et l'adresse
   d'arrivée est lue. Vers la nouvelle adresse, ou vers une arrivée illisible (certificat pas encore prêt, redirection
   en http), l'appli s'ouvre depuis le cache avec le marqueur ; le # de l'adresse demandée est gardé par le navigateur.
   Vers une autre adresse, ou sans copie de l'appli en cache, la redirection est suivie comme avant. */
async function moved(req, res) {
  let to = res.redirected ? new URL(res.url).origin : "";
  if (res.type === "opaqueredirect") to = await fetch(req.url, { method: "HEAD", mode: "cors", credentials: "omit", cache: "no-store" }).then((r) => (r.redirected ? new URL(r.url).origin : ""), () => "?");
  if (to !== NEW_ORIGIN && to !== "?") return res;
  if (!(await caches.match("index.html"))) return res;
  return Response.redirect(new URL("./?demenage=1", self.registration.scope).href, 302);
}
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.method === "POST" && req.mode === "navigate") { e.respondWith(shareIn(req)); return; }
  if (req.method !== "GET") return;
  if (req.mode === "navigate" && SHARE_KEYS.concat("partage", "demenage").some((k) => url.searchParams.has(k))) { e.respondWith(shell()); return; }
  if (req.mode === "navigate") {
    /* seule une page reçue entière remplace la copie de l'appli : jamais une redirection ni une page d'erreur */
    e.respondWith(fetch(req).then((res) => {
      if (MOVING && (res.type === "opaqueredirect" || res.redirected) && appPage(url)) return moved(req, res);
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put("index.html", copy)); }
      return res;
    }).catch(() => caches.match("index.html")));
    return;
  }
  if (url.pathname.includes("/data/")) {
    e.respondWith(serveData(e, req, url));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then(here).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
    return res;
  })));
});
