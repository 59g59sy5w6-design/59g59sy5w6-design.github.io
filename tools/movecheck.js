// Déménagement de l'appli vers https://cabas.mmt-advisory.com, service worker actif. Les deux adresses (l'ancienne,
// 59g59sy5w6-design.github.io, et la nouvelle) sont servies par un serveur HTTPS local : un certificat de test fait par
// openssl, et Chromium dirige les deux noms vers ce serveur (--host-resolver-rules) ; les autres noms ne mènent nulle
// part. Contrairement à ctx.route, dont les redirections ne repassent pas par la route, ce sont de vraies redirections,
// suivies par le navigateur et par le service worker, avec Access-Control-Allow-Origin: * comme GitHub Pages.
// Parcours : 1. avant la bascule, l'ancienne adresse s'ouvre comme d'habitude (pas d'écran de déménagement, même sur
// #/demenage tapé) ; 2. la bascule : l'ancienne adresse répond 301 vers la nouvelle, chemin gardé, pour tout (pages,
// sw.js, prix) ; l'appli restée ouverte le dit quand les prix arrivent de la nouvelle adresse ; 3. rouvrir l'ancienne
// adresse montre « Cabas a déménagé », avec ce qu'il y a à emporter, et garde le # demandé pour « Ouvrir sans mes
// données » ; 4. « Emporter » ouvre la nouvelle adresse avec les données dans le lien après le # (jamais envoyé au
// serveur) : un téléphone déjà rempli n'est pas écrasé sans confirmation, « Ne rien changer » le garde ; 5. une fois
// emportées, le bouton plein ouvre la nouvelle adresse, « Emporter à nouveau » reprend les données après confirmation,
// toutes les clés d'une copie (brouillon, codes-barres appris compris), la barre d'adresse est nettoyée ; 6. sans
// données, l'ancienne adresse ouvre directement la nouvelle.
// Code de sortie 1 en cas de problème. Usage : node tools/movecheck.js [--shots=dossier] (MVDEBUG=1 : la console de la page)
const https = require("https");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".txt": "text/plain", ".xml": "application/xml" };
const SHOTS = (process.argv.find((a) => a.startsWith("--shots=")) || "").slice(8);
const OLD_HOST = "59g59sy5w6-design.github.io", NEW_HOST = "cabas.mmt-advisory.com";
const OLD = "https://" + OLD_HOST, NEW = "https://" + NEW_HOST;

let chromium;
try { ({ chromium } = require("playwright")); } catch (e) {
  console.log("Playwright n'est pas installé ici : test sauté (npm i playwright pour l'activer).");
  process.exit(0);
}

/* un certificat de test pour les deux noms, dans un dossier temporaire effacé à la fin */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "cabas-movecheck-"));
try {
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(TMP, "key.pem"), "-out", path.join(TMP, "cert.pem"), "-days", "2", "-subj", "/CN=cabas-movecheck", "-addext", `subjectAltName=DNS:${OLD_HOST},DNS:${NEW_HOST}`], { stdio: "ignore" });
} catch (e) {
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log("openssl n'est pas installé ici : test sauté (il fait le certificat de test).");
  process.exit(0);
}

/* le serveur : le dépôt pour les deux adresses ; après la bascule, l'ancienne redirige tout vers la nouvelle */
let bascule = false;
const seen = [];
const server = https.createServer({ key: fs.readFileSync(path.join(TMP, "key.pem")), cert: fs.readFileSync(path.join(TMP, "cert.pem")) }, (req, res) => {
  const host = String(req.headers.host || "").split(":")[0];
  seen.push({ host, method: req.method, url: req.url });
  const H = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache" };
  if (host === OLD_HOST && bascule) { res.writeHead(301, Object.assign({ Location: NEW + req.url, "Content-Type": "text/html" }, H)); res.end(); return; }
  if (host !== OLD_HOST && host !== NEW_HOST) { res.writeHead(421, H); res.end(); return; }
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, H); res.end(); return; }
  const p = decodeURIComponent(req.url.split("?")[0]);
  const f = path.join(ROOT, p === "/" ? "index.html" : p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404, H); res.end(); return; }
  res.writeHead(200, Object.assign({ "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" }, H));
  if (req.method === "HEAD") { res.end(); return; }
  fs.createReadStream(f).pipe(res);
});

const iso = (d) => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); };
const plus = (n) => iso(new Date(Date.now() + n * 864e5));
const STATE = {
  basket: { "candia-lait-1-2-ecreme-6-x-1-l": 2, "barilla-pates-capellini-n-1-500-g": 3 },
  lists: [{ id: "l1", name: "Courses du samedi", items: { "candia-lait-1-2-ecreme-6-x-1-l": 1 }, at: plus(-3) }],
  prefs: { off: { leclerc: true }, offv: 1, foyer: 3, shopDay: 6, zoom: "1.12" },
  seen: { welcome: 1 }, recent: ["lait"],
  /* deux clés qu'un lien d'envoi vers un autre téléphone ne porte pas : le déménagement les emporte aussi */
  draft: "lait\npâtes",
  eans: { "2000000000015": { id: "candia-lait-1-2-ecreme-6-x-1-l", at: plus(-2) } },
};
const NEW_STATE = { basket: { "barilla-pates-capellini-n-1-500-g": 1 }, seen: { welcome: 1 } };

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const problems = [];
  const fail = (m) => problems.push(m);
  /* le navigateur va droit au serveur local : ni proxy, ni autre adresse */
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/proxy/i.test(k)));
  const browser = await chromium.launch({ env, args: ["--ignore-certificate-errors", "--no-proxy-server", `--host-resolver-rules=MAP ${OLD_HOST} 127.0.0.1:${port}, MAP ${NEW_HOST} 127.0.0.1:${port}, MAP * ~NOTFOUND`] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "allow", locale: "fr-FR", timezoneId: "Europe/Paris" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => fail("erreur JS : " + e.message + " " + (e.stack || "").slice(0, 400)));
  if (process.env.MVDEBUG) page.on("console", (m) => console.log("console", m.type(), m.text().slice(0, 300)));
  /* attente par page.evaluate plutôt que page.waitForFunction : avec un service worker actif, Playwright 1.48 (celui du
     robot de relevé) évalue la condition d'une façon que la règle de contenu de la page refuse (unsafe-eval) */
  const until = async (fn, ms, what) => {
    const end = Date.now() + ms;
    for (;;) {
      if (await page.evaluate(fn).catch(() => false)) return;
      if (Date.now() > end) throw new Error(what + " : délai dépassé");
      await page.waitForTimeout(150);
    }
  };
  const ready = () => until(() => !document.querySelector("#view .sk") && !!document.querySelector("#view .wrap > *"), 30000, "chargement de l'appli");
  const all = () => page.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith("cabas.")) o[k.slice(6)] = JSON.parse(localStorage.getItem(k)); } return o; });
  const viewText = () => page.evaluate(() => document.getElementById("view").textContent.replace(/\s+/g, " "));
  const toastText = () => page.evaluate(() => { const t = document.getElementById("toast"); return t.hidden ? "" : t.textContent; });
  const shot = async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: true }); } };
  const over = async (where) => { const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); if (o > 0) fail(`${where} : déborde de ${o} px en largeur`); };
  /* une vraie navigation (pas un simple changement de #) : la page passe d'abord par about:blank */
  const open = async (url) => { await page.goto("about:blank"); await page.goto(url); };
  const setAll = (s) => page.evaluate((s) => { localStorage.clear(); for (const k of Object.keys(s)) localStorage.setItem("cabas." + k, JSON.stringify(s[k])); }, s);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  try {
    /* 1. avant la bascule : service worker installé, actif et maître de la page, données remplies */
    await page.goto(OLD + "/#/"); await ready();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload(); await ready();
    if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) throw new Error("le service worker ne contrôle pas la page");
    await setAll(STATE);
    await open(OLD + "/?source=pwa#/panier"); await ready(); await page.waitForTimeout(600);
    if (await page.evaluate(() => location.search.includes("demenage") || location.hash !== "#/panier")) fail("avant la bascule : l'adresse a changé (" + page.url() + ")");
    if (/Cabas a déménagé/.test(await viewText())) fail("avant la bascule : l'écran du déménagement s'affiche");
    await page.evaluate(() => { location.hash = "#/demenage"; }); await page.waitForTimeout(500);
    if (/Cabas a déménagé/.test(await viewText())) fail("avant la bascule : #/demenage tapé montre le déménagement");
    await page.evaluate(() => { location.hash = "#/"; }); await page.waitForTimeout(300);

    /* 2. la bascule : l'appli restée ouverte le dit dès que les prix arrivent de la nouvelle adresse */
    bascule = true;
    await page.evaluate(() => fetch("data/status.json?fresh=1", { cache: "no-cache" }).catch(() => null));
    await until(() => /déménagé/.test(document.getElementById("toast").textContent) && !document.getElementById("toast").hidden, 10000, "toast").catch(() => fail("appli ouverte : pas de toast « Cabas a déménagé » quand les prix viennent de la nouvelle adresse"));
    if (/déménagé/.test(await toastText())) {
      await page.click("#toast button"); await page.waitForTimeout(600);
      if (!/Cabas a déménagé/.test(await viewText())) fail("appli ouverte : « Voir » ne mène pas à l'écran du déménagement");
    }

    /* 3. rouvrir l'ancienne adresse : l'écran du déménagement, depuis le cache, avec ses données ; le # est gardé */
    await open(OLD + "/#/liste/l1");
    await page.waitForURL(/#\/demenage$/, { timeout: 15000 }).catch(() => fail("ancienne adresse : #/demenage attendu, " + page.url()));
    await ready(); await page.waitForTimeout(400);
    if (!page.url().startsWith(OLD + "/") || (await page.evaluate(() => location.search))) fail("ancienne adresse : l'adresse n'est pas nettoyée (" + page.url() + ")");
    let tv = await viewText();
    if (!/Cabas a déménagé/.test(tv) || !tv.includes(NEW_HOST) || !/2\s+produits au panier/.test(tv) || !/1\s+liste/.test(tv) || !/tes réglages/.test(tv)) fail("écran du déménagement : « " + tv.slice(0, 260) + " »");
    const carry = page.locator("#view [data-act=moveok]");
    if (!(await carry.count()) || !/Emporter mes courses sur cabas\.mmt-advisory\.com/.test((await carry.textContent()).replace(/\s+/g, " ")) || (await carry.getAttribute("class")).trim() !== "btn") fail("écran du déménagement : bouton plein « Emporter mes courses sur cabas.mmt-advisory.com » attendu");
    if (await page.locator("#view .btn:not(.tint):not(.ghost):not(.plain):not(.danger)").count() !== 1) fail("écran du déménagement : un seul bouton plein attendu");
    if (await page.locator("#dock .mini").count()) fail("écran du déménagement : le mini panier ne doit pas s'afficher");
    await page.waitForTimeout(800);
    if (/déménagé/.test(await toastText())) fail("écran du déménagement : le toast « Cabas a déménagé » s'y ajoute");
    await over("écran du déménagement"); await shot("1-demenage");
    /* « Ouvrir sans mes données » : la nouvelle adresse, au # demandé, sans données */
    await page.click("#view [data-act=moveopen]");
    await page.waitForURL(NEW + "/#/liste/l1", { timeout: 15000 }).catch(() => fail("« Ouvrir sans mes données » : " + NEW + "/#/liste/l1 attendu, " + page.url()));
    await ready();
    if ((await all()).basket) fail("« Ouvrir sans mes données » : un panier est arrivé sur la nouvelle adresse");

    /* 4. « Emporter » vers un téléphone déjà rempli : rien n'est écrasé sans confirmation */
    await setAll(NEW_STATE);
    await open(OLD + "/"); await page.waitForURL(/#\/demenage$/, { timeout: 15000 }); await ready();
    seen.length = 0;
    await page.click("#view [data-act=moveok]");
    await page.waitForURL(/^https:\/\/cabas\.mmt-advisory\.com\/#\/transfert\/[jz]/, { timeout: 15000 }).catch(() => fail("« Emporter » : la nouvelle adresse avec #/transfert attendue, " + page.url()));
    await ready(); await page.waitForTimeout(800);
    tv = await viewText();
    if (!/Tes courses arrivent/.test(tv) || !/ancienne adresse/.test(tv) || !/2\s+produits au panier/.test(tv) || !/Elles remplaceront celles de ce téléphone/.test(tv)) fail("arrivée sur un téléphone rempli : « " + tv.slice(0, 260) + " »");
    if (!same((await all()).basket, NEW_STATE.basket)) fail("arrivée : le panier de la nouvelle adresse est remplacé avant la confirmation");
    if (seen.some((x) => /transfert|candia|barilla/.test(decodeURIComponent(x.url)) || (x.method !== "GET" && x.method !== "HEAD"))) fail("« Emporter » : les données sont parties au serveur : " + seen.map((x) => x.method + " " + x.url).join(", ").slice(0, 300));
    await over("arrivée"); await shot("2-arrivee");
    await page.click("#view [data-act=xferno]"); await page.waitForTimeout(600);
    if (!same((await all()).basket, NEW_STATE.basket)) fail("« Ne rien changer » : le panier de la nouvelle adresse a changé");
    if (/transfert/.test(page.url())) fail("« Ne rien changer » : le lien reste dans la barre d'adresse");

    /* 5. une fois emportées : le bouton plein ouvre la nouvelle adresse ; « Emporter à nouveau » puis confirmation */
    await open(OLD + "/"); await page.waitForURL(/#\/demenage$/, { timeout: 15000 }); await ready(); await page.waitForTimeout(300);
    tv = await viewText();
    const primary = await page.locator("#view .btn:not(.tint):not(.ghost):not(.plain):not(.danger)").first();
    if (!/Tu as emporté tes courses/.test(tv) || (await primary.getAttribute("data-act")) !== "moveopen" || !(await page.locator("#view .btn.ghost[data-act=moveok]").count())) fail("déjà emportées : bouton plein « Ouvrir cabas.mmt-advisory.com » et « Emporter à nouveau » attendus, « " + tv.slice(0, 200) + " »");
    await shot("3-deja-emportees");
    const oldData = await all();
    await page.click("#view [data-act=moveok]");
    await page.waitForURL(/^https:\/\/cabas\.mmt-advisory\.com\/#\/transfert\//, { timeout: 15000 }); await ready(); await page.waitForTimeout(800);
    await page.click("#view [data-act=xferok]"); await page.waitForTimeout(800);
    const got = await all();
    if (!same(got.basket, STATE.basket) || !same((got.lists || []).map((l) => l.name), ["Courses du samedi"]) || (got.prefs || {}).shopDay !== 6 || (got.prefs || {}).zoom !== "1.12") fail("après confirmation : données de la nouvelle adresse " + JSON.stringify(got).slice(0, 240));
    if (got.draft !== STATE.draft || !got.eans || !got.eans["2000000000015"]) fail("après confirmation : le brouillon de Ma liste et les codes-barres appris ne sont pas arrivés");
    if (got.moved) fail("après confirmation : cabas.moved ne doit pas être copié");
    if (page.url() !== NEW + "/#/") fail("après confirmation : la barre d'adresse garde le lien (" + page.url().slice(0, 80) + ")");
    if (!/Tes courses ont déménagé/.test(await toastText())) fail("après confirmation : toast « " + (await toastText()) + " »");
    if (!same(oldData.basket, STATE.basket)) fail("ancienne adresse : les données ne doivent pas être effacées");

    /* 6. sans données sur l'ancienne adresse : la nouvelle s'ouvre directement */
    await open(OLD + "/"); await page.waitForURL(/#\/demenage$/, { timeout: 15000 }); await ready();
    await page.evaluate(() => localStorage.clear());
    await open(OLD + "/#/rayons");
    await page.waitForURL(NEW + "/#/rayons", { timeout: 15000 }).catch(() => fail("sans données : " + NEW + "/#/rayons attendu, " + page.url()));
    await ready();
    if (/Cabas a déménagé/.test(await viewText())) fail("sans données : l'écran du déménagement s'affiche");
    /* la nouvelle adresse n'a pas d'écran du déménagement */
    await page.evaluate(() => { location.hash = "#/demenage"; }); await page.waitForTimeout(500);
    if (/Cabas a déménagé/.test(await viewText())) fail("nouvelle adresse : #/demenage montre le déménagement");
  } catch (e) {
    fail("parcours interrompu : " + e.message.split("\n")[0]);
  }
  await browser.close();
  server.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  if (problems.length) { console.log("Problèmes :\n- " + problems.join("\n- ")); process.exit(1); }
  console.log("Déménagement vérifié : rien ne change avant la bascule ; après, l'ancienne adresse s'ouvre depuis le cache sur « Cabas a déménagé », les données partent dans le lien après le # et n'écrasent rien sans confirmation, la barre d'adresse est nettoyée, sans données la nouvelle adresse s'ouvre directement.");
})();
