// Déménagement de l'appli vers https://cabas.mmt-advisory.com, service worker actif. Les deux adresses (l'ancienne,
// 59g59sy5w6-design.github.io, et la nouvelle) sont servies par un serveur HTTPS local : un certificat de test fait par
// openssl, et Chromium dirige les deux noms vers ce serveur (--host-resolver-rules) ; les autres noms ne mènent nulle
// part. Contrairement à ctx.route, dont les redirections ne repassent pas par la route, ce sont de vraies redirections,
// suivies par le navigateur et par le service worker. Comme GitHub Pages : les pages ont Access-Control-Allow-Origin: *,
// la redirection 301 n'a ni Access-Control-Allow-Origin ni Cache-Control (Chromium la garde alors indéfiniment).
// Parcours : 1. avant la bascule, l'ancienne adresse s'ouvre comme d'habitude (pas d'écran de déménagement, même sur
// #/demenage tapé ou une adresse fabriquée avec ?demenage=1), un partage n'appelle pas le réseau, un fichier ouvert dans
// un onglet ne remplace pas la copie de l'appli ; 2. la bascule : l'ancienne adresse répond 301 vers la nouvelle,
// chemin gardé, pour tout (pages, sw.js, prix) ; l'appli restée ouverte le dit quand les prix arrivent de la nouvelle
// adresse ; 3. rouvrir l'ancienne adresse montre « Cabas a déménagé », avec ce qu'il y a à emporter, et garde le #
// demandé ; « Emporter » hors ligne ne note rien ; 4. « Emporter » ouvre la nouvelle adresse avec les données dans le
// lien après le # (jamais envoyé au serveur), la taille du texte de la personne tout de suite : un téléphone déjà rempli
// n'est pas écrasé sans confirmation, « Ne rien changer » le garde et rend son affichage ; 5. une fois emportées, le
// bouton plein ouvre la nouvelle adresse, « Emporter à nouveau » reprend les données après confirmation, toutes les clés
// d'une copie, puis la page demandée sur l'ancienne adresse ; 6. un partage vers l'ancienne appli installée passe par le
// déménagement (le texte dans Ma liste emportée, ou copié quand tout est déjà parti) ; 7. sans données, l'ancienne
// adresse ouvre directement la nouvelle ; 8. certificat pas prêt (301 vers http, https refusé) : l'appli continue de
// marcher sur l'ancienne adresse, sans écran ni toast, jusqu'à ce que la nouvelle réponde en https ; 9. iPhone, appli
// installée : le code de déménagement copié, puis « Coller mon code » dans la nouvelle appli vide.
// Code de sortie 1 en cas de problème. Usage : node tools/movecheck.js [--shots=dossier] (MVDEBUG=1 : la console de la page)
const https = require("https");
const tls = require("tls");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".txt": "text/plain", ".xml": "application/xml" };
const SHOTS = (process.argv.find((a) => a.startsWith("--shots=")) || "").slice(8);
const OLD_HOST = "59g59sy5w6-design.github.io", NEW_HOST = "cabas.mmt-advisory.com";
const OLD = "https://" + OLD_HOST, NEW = "https://" + NEW_HOST;
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

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

/* le serveur : le dépôt pour les deux adresses ; après la bascule, l'ancienne redirige tout vers la nouvelle, en https
   (« Enforce HTTPS » coché) ou en http (certificat de la nouvelle adresse pas encore prêt : W.newTls faux, la nouvelle
   adresse refuse alors la poignée de main TLS) */
const W = { mode: "avant", newTls: true };
const seen = [];
const KEY = fs.readFileSync(path.join(TMP, "key.pem")), CERT = fs.readFileSync(path.join(TMP, "cert.pem"));
const SC = tls.createSecureContext({ key: KEY, cert: CERT });
const server = https.createServer({ key: KEY, cert: CERT, SNICallback: (name, cb) => (name === NEW_HOST && !W.newTls ? cb(new Error("certificat pas prêt")) : cb(null, SC)) }, (req, res) => {
  const host = String(req.headers.host || "").split(":")[0];
  seen.push({ host, method: req.method, url: req.url });
  if (host === OLD_HOST && W.mode !== "avant") { res.writeHead(301, { Location: (W.mode === "http" ? "http://" : "https://") + NEW_HOST + req.url, "Content-Type": "text/html", Server: "GitHub.com" }); res.end("<html>301</html>"); return; }
  const H = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache" };
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
  /* un téléphone : contexte neuf (son propre cache), service worker actif, presse-papiers permis sur les deux adresses */
  const phone = async (o, init) => {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "allow", locale: "fr-FR", timezoneId: "Europe/Paris" }, o || {}));
    for (const origin of [OLD, NEW]) await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
    if (init) await ctx.addInitScript(init);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => fail("erreur JS : " + e.message + " " + (e.stack || "").slice(0, 400)));
    if (process.env.MVDEBUG) page.on("console", (m) => console.log("console", m.type(), m.text().slice(0, 300)));
    const cdp = await ctx.newCDPSession(page);
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
    const T = {
      ctx, page, until,
      ready: () => until(() => !document.querySelector("#view .sk") && !!document.querySelector("#view .wrap > *"), 30000, "chargement de l'appli"),
      all: () => page.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith("cabas.")) o[k.slice(6)] = JSON.parse(localStorage.getItem(k)); } return o; }),
      viewText: () => page.evaluate(() => document.getElementById("view").textContent.replace(/\s+/g, " ")),
      toastText: () => page.evaluate(() => { const t = document.getElementById("toast"); return t.hidden ? "" : t.textContent; }),
      shot: async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: true }); } },
      over: async (where) => { const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); if (o > 0) fail(`${where} : déborde de ${o} px en largeur`); },
      /* une vraie navigation (pas un simple changement de #) : la page passe d'abord par about:blank */
      open: async (url) => { await page.goto("about:blank"); await page.goto(url); },
      setAll: (s) => page.evaluate((s) => { localStorage.clear(); for (const k of Object.keys(s)) localStorage.setItem("cabas." + k, JSON.stringify(s[k])); }, s),
      clearHttp: () => cdp.send("Network.clearBrowserCache"),
      primaries: () => page.locator("#view .btn:not(.tint):not(.ghost):not(.plain):not(.danger)"),
      /* le service worker installé, actif et maître de la page, sur l'ancienne adresse */
      install: async () => {
        await page.goto(OLD + "/#/"); await T.ready();
        await page.evaluate(() => navigator.serviceWorker.ready);
        await page.reload(); await T.ready();
        if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) throw new Error("le service worker ne contrôle pas la page");
      },
      /* un partage vers Cabas (share_target, en POST) depuis la page ouverte */
      share: (text) => page.evaluate((text) => { const f = document.createElement("form"); f.method = "post"; f.enctype = "multipart/form-data"; f.action = "./"; for (const [k, v] of [["title", "Liste"], ["text", text]]) { const i = document.createElement("textarea"); i.name = k; i.value = v; f.appendChild(i); } document.body.appendChild(f); f.submit(); }, text),
    };
    return T;
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const dataText = (T) => T.page.evaluate(() => document.documentElement.getAttribute("data-text"));
  try {
    const T = await phone(), { page } = T;
    W.mode = "avant"; W.newTls = true;
    /* 1. avant la bascule : service worker installé, données remplies */
    await T.install();
    await T.setAll(STATE);
    await T.open(OLD + "/?source=pwa#/panier"); await T.ready(); await page.waitForTimeout(600);
    if (await page.evaluate(() => location.search.includes("demenage") || location.hash !== "#/panier")) fail("avant la bascule : l'adresse a changé (" + page.url() + ")");
    if (/Cabas a déménagé/.test(await T.viewText())) fail("avant la bascule : l'écran du déménagement s'affiche");
    await page.evaluate(() => { location.hash = "#/demenage"; }); await page.waitForTimeout(500);
    if (/Cabas a déménagé/.test(await T.viewText())) fail("avant la bascule : #/demenage tapé montre le déménagement");
    /* une adresse fabriquée avec le marqueur, sans le jeton du service worker : l'appli s'ouvre comme d'habitude */
    await T.open(OLD + "/?demenage=1#/panier"); await T.ready(); await page.waitForTimeout(600);
    if (page.url() !== OLD + "/#/panier" || /Cabas a déménagé/.test(await T.viewText()) || (await T.all()).moved) fail("avant la bascule : ?demenage=1 fabriqué mène à " + page.url() + " « " + (await T.viewText()).slice(0, 80) + " »");
    await T.setAll({ seen: { welcome: 1 } });
    await T.open(OLD + "/?demenage=1#/rayons"); await page.waitForTimeout(1500); await T.ready();
    if (page.url() !== OLD + "/#/rayons") fail("avant la bascule : ?demenage=1 fabriqué, sans données, mène à " + page.url());
    await T.setAll(STATE);
    /* un partage vers Cabas avant la bascule : Ma liste, sans redemander la page de l'appli au serveur */
    await T.open(OLD + "/#/"); await T.ready();
    seen.length = 0;
    await T.share("café\nbeurre");
    await page.waitForURL(OLD + "/#/ecrire", { timeout: 15000 }).catch(() => fail("avant la bascule : le partage mène à " + page.url()));
    await T.ready(); await page.waitForTimeout(400);
    if (seen.some((x) => x.method !== "GET" || x.url === "/" || /partage|demenage/.test(x.url))) fail("avant la bascule : le partage appelle le serveur (" + seen.map((x) => x.method + " " + x.url).join(", ").slice(0, 200) + ")");
    await T.setAll(STATE);
    /* un fichier ouvert dans un onglet ne remplace pas la copie de l'appli */
    await T.open(OLD + "/robots.txt"); await page.waitForTimeout(300);
    if (!(await page.evaluate(async () => { const r = await caches.match("index.html"); return !!r && /<html/i.test(await r.text()); }))) fail("avant la bascule : robots.txt ouvert dans un onglet a remplacé la copie de l'appli");
    await T.open(OLD + "/#/"); await T.ready();

    /* 2. la bascule : l'appli restée ouverte le dit dès que les prix arrivent de la nouvelle adresse */
    W.mode = "https";
    await page.evaluate(() => fetch("data/status.json?fresh=1", { cache: "no-cache" }).catch(() => null));
    await T.until(() => /déménagé/.test(document.getElementById("toast").textContent) && !document.getElementById("toast").hidden, 10000, "toast").catch(() => fail("appli ouverte : pas de toast « Cabas a déménagé » quand les prix viennent de la nouvelle adresse"));
    if (/déménagé/.test(await T.toastText())) {
      await page.click("#toast button"); await page.waitForTimeout(600);
      if (!/Cabas a déménagé/.test(await T.viewText())) fail("appli ouverte : « Voir » ne mène pas à l'écran du déménagement");
    }

    /* 3. rouvrir l'ancienne adresse : l'écran du déménagement, depuis le cache, avec ses données ; le # est gardé */
    await T.open(OLD + "/#/liste/l1");
    await page.waitForURL(/#\/demenage$/, { timeout: 15000 }).catch(() => fail("ancienne adresse : #/demenage attendu, " + page.url()));
    await T.ready(); await page.waitForTimeout(400);
    if (!page.url().startsWith(OLD + "/") || (await page.evaluate(() => location.search))) fail("ancienne adresse : l'adresse n'est pas nettoyée (" + page.url() + ")");
    let tv = await T.viewText();
    if (!/Cabas a déménagé/.test(tv) || !tv.includes(NEW_HOST) || !/2\s+produits au panier/.test(tv) || !/1\s+liste/.test(tv) || !/tes réglages/.test(tv)) fail("écran du déménagement : « " + tv.slice(0, 260) + " »");
    if (/après le #/.test(tv) || !/sans passer par Internet/.test(tv)) fail("écran du déménagement : « après le # » au lieu de « sans passer par Internet »");
    const carry = page.locator("#view [data-act=moveok]");
    if (!(await carry.count()) || !/Emporter mes courses sur cabas\.mmt-advisory\.com/.test((await carry.textContent()).replace(/\s+/g, " ")) || (await carry.getAttribute("class")).trim() !== "btn") fail("écran du déménagement : bouton plein « Emporter mes courses sur cabas.mmt-advisory.com » attendu");
    if (await T.primaries().count() !== 1) fail("écran du déménagement : un seul bouton plein attendu");
    if (await page.locator("#dock .mini").count()) fail("écran du déménagement : le mini panier ne doit pas s'afficher");
    await page.waitForTimeout(800);
    if (/déménagé/.test(await T.toastText())) fail("écran du déménagement : le toast « Cabas a déménagé » s'y ajoute");
    await T.over("écran du déménagement"); await T.shot("1-demenage");
    /* « Emporter » hors ligne : rien n'est noté comme envoyé */
    await T.ctx.setOffline(true);
    await page.click("#view [data-act=moveok]"); await page.waitForTimeout(800);
    await T.ctx.setOffline(false);
    if (!page.url().startsWith(OLD + "/") || (await T.all()).moved || !/Pas de connexion/.test(await T.toastText())) fail("« Emporter » hors ligne : " + page.url() + ", toast « " + (await T.toastText()) + " », moved " + JSON.stringify((await T.all()).moved || null));
    /* « Ouvrir sans mes données » : la nouvelle adresse, au # demandé, sans données */
    await page.click("#view [data-act=moveopen]");
    await page.waitForURL(NEW + "/#/liste/l1", { timeout: 15000 }).catch(() => fail("« Ouvrir sans mes données » : " + NEW + "/#/liste/l1 attendu, " + page.url()));
    await T.ready();
    if ((await T.all()).basket) fail("« Ouvrir sans mes données » : un panier est arrivé sur la nouvelle adresse");

    /* 4. « Emporter » vers un téléphone déjà rempli : rien n'est écrasé sans confirmation ; la taille du texte de la
       personne (1.12) est posée tout de suite, sans être enregistrée */
    await T.setAll(NEW_STATE);
    await T.open(OLD + "/"); await page.waitForURL(/#\/demenage$/, { timeout: 15000 }); await T.ready();
    seen.length = 0;
    await page.click("#view [data-act=moveok]");
    await page.waitForURL(/^https:\/\/cabas\.mmt-advisory\.com\/#\/transfert\/[jz]/, { timeout: 15000 }).catch(() => fail("« Emporter » : la nouvelle adresse avec #/transfert attendue, " + page.url()));
    await T.ready(); await page.waitForTimeout(800);
    tv = await T.viewText();
    if (!/Tes courses arrivent/.test(tv) || !/ancienne adresse/.test(tv) || !/2\s+produits au panier/.test(tv) || !/Elles remplaceront celles de ce téléphone/.test(tv)) fail("arrivée sur un téléphone rempli : « " + tv.slice(0, 260) + " »");
    if ((await dataText(T)) !== "1.12") fail("arrivée : la taille du texte de la personne n'est pas posée (" + (await dataText(T)) + ")");
    if (!same((await T.all()).basket, NEW_STATE.basket) || ((await T.all()).prefs || {}).zoom) fail("arrivée : la nouvelle adresse a changé avant la confirmation");
    if (seen.some((x) => /transfert|candia|barilla/.test(decodeURIComponent(x.url)) || (x.method !== "GET" && x.method !== "HEAD"))) fail("« Emporter » : les données sont parties au serveur : " + seen.map((x) => x.method + " " + x.url).join(", ").slice(0, 300));
    await T.over("arrivée"); await T.shot("2-arrivee");
    await page.click("#view [data-act=xferno]"); await page.waitForTimeout(600);
    if (!same((await T.all()).basket, NEW_STATE.basket)) fail("« Ne rien changer » : le panier de la nouvelle adresse a changé");
    if (/transfert/.test(page.url())) fail("« Ne rien changer » : le lien reste dans la barre d'adresse");
    if ((await dataText(T)) !== null) fail("« Ne rien changer » : l'affichage de ce téléphone n'est pas rendu (" + (await dataText(T)) + ")");

    /* 5. une fois emportées : le bouton plein ouvre la nouvelle adresse ; « Emporter à nouveau » depuis une liste, puis
       confirmation : la liste demandée s'ouvre */
    await T.open(OLD + "/#/liste/l1"); await page.waitForURL(/#\/demenage$/, { timeout: 15000 }); await T.ready(); await page.waitForTimeout(300);
    tv = await T.viewText();
    if (!/Tu as lancé l'envoi de tes courses/.test(tv) || /Tu as emporté/.test(tv) || (await T.primaries().first().getAttribute("data-act")) !== "moveopen" || !(await page.locator("#view .btn.ghost[data-act=moveok]").count())) fail("déjà envoyées : « Tu as lancé l'envoi », bouton plein « Ouvrir cabas.mmt-advisory.com » et « Emporter à nouveau » attendus, « " + tv.slice(0, 200) + " »");
    await T.shot("3-deja-emportees");
    const oldData = await T.all();
    await page.click("#view [data-act=moveok]");
    await page.waitForURL(/^https:\/\/cabas\.mmt-advisory\.com\/#\/transfert\//, { timeout: 15000 }); await T.ready(); await page.waitForTimeout(800);
    await page.click("#view [data-act=xferok]"); await page.waitForTimeout(800);
    const got = await T.all();
    if (!same(got.basket, STATE.basket) || !same((got.lists || []).map((l) => l.name), ["Courses du samedi"]) || (got.prefs || {}).shopDay !== 6 || (got.prefs || {}).zoom !== "1.12") fail("après confirmation : données de la nouvelle adresse " + JSON.stringify(got).slice(0, 240));
    if (got.draft !== STATE.draft || !got.eans || !got.eans["2000000000015"]) fail("après confirmation : le brouillon de Ma liste et les codes-barres appris ne sont pas arrivés");
    if (got.moved) fail("après confirmation : cabas.moved ne doit pas être copié");
    if (page.url() !== NEW + "/#/liste/l1" || !/Courses du samedi/.test(await T.viewText())) fail("après confirmation : la liste demandée sur l'ancienne adresse n'est pas ouverte (" + page.url().slice(0, 80) + ")");
    if (!/Tes courses ont déménagé/.test(await T.toastText())) fail("après confirmation : toast « " + (await T.toastText()) + " »");
    if (!same(oldData.basket, STATE.basket)) fail("ancienne adresse : les données ne doivent pas être effacées");

    /* 6. un partage vers l'ancienne appli installée, après la bascule : il passe par le déménagement. Pas encore emportées :
       le texte rejoint Ma liste, qui part avec le reste, et la nouvelle adresse s'ouvre sur Ma liste */
    await T.open(OLD + "/"); await page.waitForURL(/#\/demenage$/, { timeout: 15000 }); await T.ready();
    await page.evaluate(() => localStorage.removeItem("cabas.moved"));
    await T.share("riz basmati\nyaourts");
    await page.waitForURL(OLD + "/#/demenage", { timeout: 15000 }).catch(() => fail("partage après la bascule : écran du déménagement attendu, " + page.url()));
    await T.ready(); await page.waitForTimeout(300);
    tv = await T.viewText();
    if (!/Ta liste partagée est dans Ma liste/.test(tv) || (await T.primaries().first().getAttribute("data-act")) !== "moveok") fail("partage après la bascule : « " + tv.slice(0, 200) + " »");
    await page.click("#view [data-act=moveok]");
    await page.waitForURL(/^https:\/\/cabas\.mmt-advisory\.com\/#\/transfert\//, { timeout: 15000 }); await T.ready(); await page.waitForTimeout(600);
    await page.click("#view [data-act=xferok]"); await page.waitForTimeout(800);
    if (page.url() !== NEW + "/#/ecrire" || !/riz basmati/.test((await T.all()).draft || "")) fail("partage emporté : Ma liste de la nouvelle adresse attendue avec le texte partagé (" + page.url() + ", « " + (await T.all()).draft + " »)");
    /* déjà emportées : le texte est copié, la nouvelle adresse s'ouvre sur Ma liste */
    await T.open(OLD + "/"); await page.waitForURL(/#\/demenage$/, { timeout: 15000 }); await T.ready();
    await T.share("lessive");
    await page.waitForURL(OLD + "/#/demenage", { timeout: 15000 }).catch(() => {}); await T.ready(); await page.waitForTimeout(300);
    if ((await T.primaries().first().getAttribute("data-act")) !== "moveshare") fail("partage, courses déjà emportées : bouton plein « Copier ma liste » attendu, « " + (await T.viewText()).slice(0, 200) + " »");
    else {
      await page.click("#view [data-act=moveshare]");
      await page.waitForURL(NEW + "/#/ecrire", { timeout: 15000 }).catch(() => fail("« Copier ma liste » : " + NEW + "/#/ecrire attendu, " + page.url()));
      if ((await page.evaluate(() => navigator.clipboard.readText()).catch(() => "")) !== "lessive") fail("« Copier ma liste » : le presse-papiers ne contient pas le texte partagé");
    }

    /* pendant les courses d'un proche, le panier est le sien : l'écran compte celui de la personne, mis de côté, et dit
       les courses du proche en cours */
    await T.open(OLD + "/"); await page.waitForURL(/#\/demenage$/, { timeout: 15000 }); await T.ready();
    await T.setAll(Object.assign({}, STATE, { basket: { "candia-lait-1-2-ecreme-6-x-1-l": 6, "barilla-pates-capellini-n-1-500-g": 2, "contrex-eau-minerale-naturelle-6-x-1-l": 1 }, duo: { pour: { on: true, n: "Camille", t: "mvpour1", at: new Date().toISOString(), alt: { basket: { "barilla-pates-capellini-n-1-500-g": 1 }, free: {} } } } }));
    await T.open(OLD + "/"); await page.waitForURL(/#\/demenage$/, { timeout: 15000 }); await T.ready();
    tv = await T.viewText();
    if (!/1\s+produit au panier/.test(tv) || !/les courses de Camille en cours/.test(tv)) fail("courses d'un proche en cours : « " + tv.slice(0, 260) + " »");

    /* 7. sans données sur l'ancienne adresse : la nouvelle s'ouvre directement */
    await T.open(OLD + "/"); await page.waitForURL(/#\/demenage$/, { timeout: 15000 }); await T.ready();
    await page.evaluate(() => localStorage.clear());
    await T.open(OLD + "/#/rayons");
    await page.waitForURL(NEW + "/#/rayons", { timeout: 15000 }).catch(() => fail("sans données : " + NEW + "/#/rayons attendu, " + page.url()));
    await T.ready();
    if (/Cabas a déménagé/.test(await T.viewText())) fail("sans données : l'écran du déménagement s'affiche");
    /* la nouvelle adresse n'a pas d'écran du déménagement, même avec le marqueur */
    await page.evaluate(() => { location.hash = "#/demenage"; }); await page.waitForTimeout(500);
    if (/Cabas a déménagé/.test(await T.viewText())) fail("nouvelle adresse : #/demenage montre le déménagement");
    await T.ctx.close();
  } catch (e) {
    fail("parcours interrompu : " + e.message.split("\n")[0]);
  }

  /* 8. certificat pas prêt : GitHub redirige vers http tant que le certificat n'est pas délivré, et la nouvelle adresse
     ne répond pas en https. L'appli continue de marcher sur l'ancienne adresse, sans écran ni toast ; dès que la nouvelle
     adresse répond en https (redirection encore en http, « Enforce HTTPS » pas coché), le déménagement se propose. */
  try {
    W.mode = "avant"; W.newTls = true;
    const T = await phone(), { page } = T;
    await T.install();
    await T.setAll(STATE);
    await T.open(OLD + "/#/"); await T.ready();
    W.mode = "http"; W.newTls = false;
    await T.clearHttp();
    await page.evaluate(() => fetch("data/status.json?fresh=1", { cache: "no-cache" }).catch(() => null));
    await page.waitForTimeout(2500);
    if (/déménagé/.test(await T.toastText())) fail("certificat pas prêt : l'appli ouverte annonce le déménagement");
    await T.open(OLD + "/#/liste/l1"); await page.waitForTimeout(1500); await T.ready().catch(() => {});
    const tv = await T.viewText();
    if (page.url() !== OLD + "/#/liste/l1" || !/Courses du samedi/.test(tv)) fail("certificat pas prêt : l'appli ne s'ouvre pas sur l'ancienne adresse (" + page.url() + " « " + tv.slice(0, 120) + " »)");
    await T.shot("4-certificat-pas-pret");
    /* le certificat arrive, la redirection reste en http : l'appli ouverte le dit, puis l'écran du déménagement */
    W.newTls = true;
    await page.waitForTimeout(5200);
    await page.evaluate(() => fetch("data/status.json?fresh=1", { cache: "no-cache" }).catch(() => null));
    await T.until(() => /déménagé/.test(document.getElementById("toast").textContent) && !document.getElementById("toast").hidden, 10000, "toast").catch(() => fail("certificat prêt, redirection en http : pas de toast « Cabas a déménagé » dans l'appli ouverte"));
    await T.open(OLD + "/#/liste/l1");
    await page.waitForURL(/#\/demenage$/, { timeout: 15000 }).catch(() => fail("certificat prêt, redirection en http : #/demenage attendu, " + page.url()));
    await T.ready();
    await page.click("#view [data-act=moveok]");
    await page.waitForURL(/^https:\/\/cabas\.mmt-advisory\.com\/#\/transfert\//, { timeout: 15000 }).catch(() => fail("certificat prêt, redirection en http : « Emporter » mène à " + page.url().slice(0, 80)));
    await T.ctx.close();
  } catch (e) {
    fail("certificat pas prêt, parcours interrompu : " + e.message.split("\n")[0]);
  }

  /* 9. iPhone, appli installée (plein écran) : la nouvelle appli installée depuis Safari ne voit pas les données de
     l'ancienne ; le code de déménagement est copié ici, puis collé dans la nouvelle appli vide */
  try {
    W.mode = "avant"; W.newTls = true;
    const T = await phone({ userAgent: IPHONE }, () => { try { Object.defineProperty(navigator, "standalone", { get: () => true }); } catch (e) { /* déjà défini */ } }), { page } = T;
    await T.install();
    await T.setAll(STATE);
    W.mode = "https";
    await T.open(OLD + "/#/");
    await page.waitForURL(/#\/demenage$/, { timeout: 15000 }).catch(() => fail("iPhone : #/demenage attendu, " + page.url()));
    await T.ready(); await page.waitForTimeout(500);
    let tv = await T.viewText();
    if (!/Copier mon code de déménagement/.test(tv) || !/Coller mon code/.test(tv) || (await page.locator("#view ol.steps li").count()) !== 3 || await page.locator("#view [data-act=moveok]").count()) fail("iPhone : trois étapes et « Copier mon code de déménagement » attendus, « " + tv.slice(0, 260) + " »");
    if (await T.primaries().count() !== 1 || (await T.primaries().first().getAttribute("data-act")) !== "movecode") fail("iPhone : un seul bouton plein, « Copier mon code de déménagement »");
    const small = await page.evaluate(() => [...document.querySelectorAll("#view button, #view a")].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 44).map((b) => b.textContent.trim()));
    if (small.length) fail("iPhone : cibles de moins de 44 px : " + small.join(", "));
    await T.over("iPhone, écran du déménagement"); await T.shot("5-iphone");
    await page.click("#view [data-act=movecode]"); await page.waitForTimeout(600);
    const code = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
    if (!code.startsWith(NEW + "/#/transfert/") || !/Code copié/.test(await T.toastText()) || !(await T.all()).moved) fail("iPhone : code copié attendu (" + code.slice(0, 60) + ", toast « " + (await T.toastText()) + " »)");
    /* la nouvelle appli, vide : « Coller mon code » sur l'accueil d'une première visite */
    await T.open(NEW + "/#/"); await T.ready();
    if (!(await page.locator("#view [data-act=pastecode]").count())) fail("nouvelle appli vide : pas de « Coller mon code » sur l'accueil");
    else {
      await page.click("#view [data-act=pastecode]"); await page.waitForTimeout(500);
      await page.fill("#codeIn", "n'importe quoi"); await page.click("#sheet [data-act=codego]"); await page.waitForTimeout(300);
      if (!(await page.locator("#sheet .field.err").count())) fail("« Coller mon code » : un texte qui n'est pas un code doit être refusé");
      await page.click("#sheet [data-act=codepaste]");
      await page.waitForURL(/\/#\/transfert\//, { timeout: 15000 }).catch(() => fail("« Coller mon code » : #/transfert attendu, " + page.url().slice(0, 80)));
      await T.ready(); await page.waitForTimeout(600);
      tv = await T.viewText();
      if (!/Tes courses arrivent/.test(tv) || !/2\s+produits au panier/.test(tv)) fail("« Coller mon code » : arrivée « " + tv.slice(0, 200) + " »");
      await page.click("#view [data-act=xferok]"); await page.waitForTimeout(800);
      if (!same((await T.all()).basket, STATE.basket)) fail("« Coller mon code » : le panier n'est pas arrivé");
    }
    await T.ctx.close();
  } catch (e) {
    fail("iPhone, parcours interrompu : " + e.message.split("\n")[0]);
  }
  await browser.close();
  server.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  if (problems.length) { console.log("Problèmes :\n- " + problems.join("\n- ")); process.exit(1); }
  console.log("Déménagement vérifié : rien ne change avant la bascule (ni ?demenage fabriqué, ni partage, ni fichier ouvert dans un onglet) ; après, l'ancienne adresse s'ouvre depuis le cache sur « Cabas a déménagé », les données partent dans le lien après le # et n'écrasent rien sans confirmation, la page demandée et l'affichage de la personne suivent, un partage passe par le déménagement, sans données la nouvelle adresse s'ouvre directement ; certificat pas prêt, l'appli continue sur l'ancienne adresse ; sur iPhone, le code se copie et se colle.");
})();
