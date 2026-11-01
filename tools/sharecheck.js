// Partage vers Cabas sans rien envoyer au serveur du site (share_target du manifeste en POST, traité par sw.js). Le
// service worker est installé et actif ; puis : 1. un partage en POST (formulaire multipart, comme la feuille de partage
// d'Android) ouvre Ma liste avec le texte partagé, et le serveur ne reçoit ni le POST ni le texte ; 2. l'ancienne cible
// en GET (?title=&text=&url=, manifeste pas encore relu par le téléphone) est servie depuis le cache, sans que l'adresse
// parte au serveur ; 3. un lien de liste Cabas partagé ouvre sa page ; 4. le cache du partage est vidé après lecture.
// Code de sortie 1 en cas de problème.
// Usage : node tools/sharecheck.js
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml" };

let chromium;
try { ({ chromium } = require("playwright")); } catch (e) {
  console.log("Playwright n'est pas installé ici : test sauté (npm i playwright pour l'activer).");
  process.exit(0);
}

/* le serveur note chaque requête : méthode, adresse et corps */
const seen = [];
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    seen.push({ method: req.method, url: req.url, body });
    if (req.method !== "GET") { res.writeHead(405); res.end(); return; }
    const p = decodeURIComponent(req.url.split("?")[0]);
    const f = path.join(ROOT, p === "/" ? "index.html" : p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
});

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`, base = origin + "/";
  const problems = [];
  const fail = (m) => problems.push(m);
  const SECRET = "Mme Exemple 12 rue Imaginaire";
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "allow", locale: "fr-FR" });
  await ctx.route((url) => !String(url).startsWith(origin), (r) => r.abort());
  const page = await ctx.newPage();
  page.on("pageerror", (e) => fail("erreur JS : " + e.message));
  const ready = () => page.waitForFunction(() => !document.querySelector("#view .sk") && document.querySelector("#view .wrap > *"), null, { timeout: 30000 });
  const leaked = () => seen.filter((x) => x.method !== "GET" || /title=|text=|url=|Exemple|Imaginaire/.test(decodeURIComponent(x.url) + x.body));
  try {
    /* service worker installé, actif et maître de la page */
    await page.goto(base + "#/"); await ready();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload(); await ready();
    if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) throw new Error("le service worker ne contrôle pas la page");
    await page.evaluate(() => localStorage.setItem("cabas.seen", JSON.stringify({ welcome: 1 })));

    /* 1. partage en POST : un formulaire multipart vers ./, comme la cible du manifeste */
    seen.length = 0;
    await page.evaluate((secret) => {
      const f = document.createElement("form");
      f.method = "post"; f.enctype = "multipart/form-data"; f.action = "./";
      for (const [k, v] of [["title", "Courses"], ["text", "beurre doux\nriz basmati\n" + secret + "\nhttps://exemple.fr/liste"], ["url", ""]]) { const i = document.createElement("textarea"); i.name = k; i.value = v; f.appendChild(i); }
      document.body.appendChild(f); f.submit();
    }, SECRET);
    await page.waitForURL(/#\/ecrire/, { timeout: 15000 }); await ready(); await page.waitForTimeout(1200);
    if (await page.evaluate(() => location.search)) fail("POST : l'adresse garde ses paramètres (" + (await page.evaluate(() => location.search)) + ")");
    const lines = await page.locator(".wli").count();
    if (lines !== 3) fail(`POST : 3 lignes attendues dans Ma liste (le lien est écarté), ${lines}`);
    if (leaked().length) fail("POST : le serveur a reçu le partage : " + leaked().map((x) => x.method + " " + x.url).join(", "));
    const left = await page.evaluate(async () => { const c = await caches.open("cabas-partage"); return (await c.keys()).length; });
    if (left) fail("POST : le texte partagé reste dans le cache après lecture");

    /* 2. ancienne cible en GET : servie depuis le cache, l'adresse ne part pas au serveur */
    seen.length = 0;
    await page.goto(base + "?title=&text=" + encodeURIComponent("lait\npâtes\n" + SECRET)); await ready(); await page.waitForTimeout(1200);
    if ((await page.evaluate(() => location.hash)) !== "#/ecrire") fail("GET : Ma liste attendue, " + (await page.evaluate(() => location.hash)));
    if (await page.evaluate(() => location.search)) fail("GET : l'adresse garde ses paramètres");
    if (leaked().length) fail("GET : le serveur a reçu l'adresse partagée : " + leaked().map((x) => x.method + " " + x.url).join(", "));

    /* 3. un lien de liste Cabas partagé ouvre sa page : de l'adresse de l'appli, puis de l'ancienne (envoyé avant le
       déménagement) */
    const code = Buffer.from(JSON.stringify({ n: "Liste de test", i: [] }), "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    for (const site of ["https://cabas.mmt-advisory.com/", "https://59g59sy5w6-design.github.io/"]) {
      seen.length = 0;
      await page.goto(base + "#/"); await ready();
      await page.evaluate((u) => {
        const f = document.createElement("form");
        f.method = "post"; f.enctype = "multipart/form-data"; f.action = "./";
        for (const [k, v] of [["title", "Ma liste"], ["text", "Ma liste sur Cabas"], ["url", u]]) { const i = document.createElement("textarea"); i.name = k; i.value = v; f.appendChild(i); }
        document.body.appendChild(f); f.submit();
      }, site + "#/partage/" + code);
      await page.waitForURL(/#\/partage\//, { timeout: 15000 }).catch(() => fail("lien de liste partagé (" + site + ") : #/partage attendu, " + page.url()));
      if (leaked().length) fail("lien de liste (" + site + ") : le serveur a reçu le partage");
    }

    /* le manifeste annonce bien la cible en POST */
    const man = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.webmanifest"), "utf8"));
    if (!man.share_target || man.share_target.method !== "POST" || man.share_target.enctype !== "multipart/form-data") fail("manifeste : share_target en POST multipart attendu");
  } catch (e) {
    fail("parcours interrompu : " + e.message.split("\n")[0]);
  }
  await browser.close();
  server.close();
  if (problems.length) { console.log("Problèmes :\n- " + problems.join("\n- ")); process.exit(1); }
  console.log("Partage vers Cabas : rien n'est envoyé au serveur (POST et ancienne cible en GET), Ma liste reçoit le texte, le cache est vidé.");
})();
