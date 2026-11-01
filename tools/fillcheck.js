// Vérification de « Remplir mes paniers » (F01), de « Coller ma liste » et du partage vers Cabas (F11), au format
// iPhone : le panier propose de remplir ses paniers ; l'instantané de la répartition est pris (cabas.guide.snap) ; la
// carte d'accueil et la pastille du mini panier disent ce qu'il reste ; « Avant de commencer » la première fois chez
// une enseigne ; le mode guidé affiche la quantité, le nom chez l'enseigne et un lien « Ouvrir sur … » ; le retour
// dans l'appli (visibilitychange simulé, 1,5 s dehors au moins) coche le produit, avec « Annuler » ; un retour trop
// rapide ou « Cocher à la main » ne coche rien ; « Pas trouvé » déplace un produit vers l'autre commande (effet sur
// les frais dit), le laisse de côté (cabas.todo), retient un lien cassé (recherche du site ensuite) ; « Copier la
// liste » ; fin de commande, créneau, commande suivante ; le panier rejoint l'historique ; « Recommander et remplir »
// remet le panier et les produits laissés de côté ; « Tout ouvrir » seulement sur ordinateur ; sans les détails des
// produits (hors ligne), le site de l'enseigne et le nom à chercher. Aucun site d'enseigne
// n'est chargé : toute adresse hors du serveur local est bloquée. Code de sortie 1 en cas de problème.
// Usage : node tools/fillcheck.js [--shots=dossier]
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml" };
const SHOTS = (process.argv.find((a) => a.startsWith("--shots=")) || "").slice(8);

let chromium;
try { ({ chromium } = require("playwright")); } catch (e) {
  console.log("Playwright n'est pas installé ici : test sauté (npm i playwright pour l'activer).");
  process.exit(0);
}

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split("?")[0]);
  const f = path.join(ROOT, p === "/" ? "index.html" : p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`, base = origin + "/index.html";
  const problems = [];
  const fail = (m) => problems.push(m);
  const cat = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "catalog.json"), "utf8"));
  const R = cat.rets, MONO = R.indexOf("monoprix"), HOURA = R.indexOf("houra");
  const sells = (p, ri) => (p.o || []).some((o) => o[0] === ri);
  /* un panier en deux commandes : des produits que seul Monoprix vend, d'autres que seul Houra vend, et quelques-uns
     vendus par les deux (pour « Le mettre chez … ») ; Carrefour, Auchan et E.Leclerc désactivés */
  const only = (ri) => cat.products.filter((p) => (p.o || []).length === 1 && p.o[0][0] === ri && p.o[0][1] > 300 && p.o[0][1] < 1500);
  const basket = {};
  only(MONO).slice(0, 9).forEach((p) => { basket[p.i] = 2; });
  only(HOURA).slice(0, 9).forEach((p) => { basket[p.i] = 2; });
  const both = cat.products.filter((p) => sells(p, MONO) && sells(p, HOURA)).slice(0, 6);
  both.forEach((p) => { basket[p.i] = 1; });
  const PREFS = { zip: "94120", off: { leclerc: true, auchan: true, carrefour: true }, fee: {}, pick: {}, liv: {}, keep: {}, usual: {}, qty1: {}, maxOrders: 3, extraCost: 0, offv: 1 };
  const byId = new Map(cat.products.map((p) => [p.i, p]));

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block", locale: "fr-FR", timezoneId: "Europe/Paris", permissions: ["clipboard-read", "clipboard-write"] });
  /* aucun site d'enseigne n'est chargé : seules les adresses du serveur local passent */
  await ctx.route((url) => !String(url).startsWith(origin), (r) => r.abort());
  const page = await ctx.newPage();
  page.on("pageerror", (e) => fail("erreur JS : " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/net::ERR_FAILED/.test(m.text())) fail("console : " + m.text()); });
  const ready = () => page.waitForFunction(() => !document.querySelector("#view .sk") && document.querySelector("#view .wrap > *"), null, { timeout: 25000 });
  const stored = (k) => page.evaluate((k) => JSON.parse(localStorage.getItem("cabas." + k) || "null"), k);
  const toastText = () => page.evaluate(() => { const t = document.getElementById("toast"); return t.hidden ? "" : t.textContent; });
  const hash = () => page.evaluate(() => location.hash);
  const text = (sel) => page.evaluate((s) => { const el = document.querySelector(s); return el ? el.textContent.replace(/\s+/g, " ").trim() : ""; }, sel);
  const over = async (where) => { const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); if (o > 0) fail(`${where} : déborde de ${o} px en largeur`); };
  const shot = async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + ".png") }); } };
  const go = async (h) => { await page.evaluate((h) => { location.hash = h; }, h); await page.waitForTimeout(450); };
  /* retour simulé : la page passe cachée puis visible, après ms millisecondes dehors */
  const away = async (ms) => { await page.evaluate(() => window.__vis("hidden")); await page.waitForTimeout(ms); await page.evaluate(() => window.__vis("visible")); await page.waitForTimeout(350); };
  const openCur = async () => { await page.click(".dock [data-act=fillopen]"); await page.waitForTimeout(100); };
  const snapNow = () => stored("guide").then((g) => (g && g.snap) || null);
  const curName = () => text("#fpn");

  try {
    await page.goto(base + "#/"); await ready();
    await page.evaluate(({ basket, PREFS }) => {
      localStorage.clear();
      localStorage.setItem("cabas.basket", JSON.stringify(basket));
      localStorage.setItem("cabas.seen", JSON.stringify({ welcome: 1 }));
      localStorage.setItem("cabas.prefs", JSON.stringify(PREFS));
    }, { basket, PREFS });
    await page.goto(base + "#/panier"); await page.reload(); await ready();
    /* visibilitychange simulé : la page reste visible pour Chromium, document.visibilityState est piloté par le test */
    const stub = () => page.evaluate(() => {
      let v = "visible";
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => v });
      window.__vis = (x) => { v = x; document.dispatchEvent(new Event("visibilitychange")); };
      /* le lien s'ouvre normalement dans un nouvel onglet : ici, le clic est retenu pour ne charger aucun site */
      document.addEventListener("click", (e) => { const a = e.target.closest("a[target=_blank]"); if (a) { e.preventDefault(); window.__opened = (window.__opened || []).concat(a.href); } }, true);
    });
    await stub();
    await page.waitForFunction(() => document.querySelector(".sum") && !document.querySelector(".sum.loading"), null, { timeout: 30000 });
    await page.waitForTimeout(500);

    /* 1. le panier propose « Remplir mes paniers », chaque commande « Remplir mon panier sur … » */
    const cta = await text("[data-act=fillgo]");
    if (!/Remplir mes paniers/.test(cta)) fail(`panier : bouton « Remplir mes paniers » absent (« ${cta} »)`);
    if ((await page.locator(".order [data-act=fill]").count()) < 2) fail("panier : chaque commande devrait avoir son bouton « Remplir mon panier sur … »");
    await shot("1-panier");
    await page.click("[data-act=fillgo]"); await page.waitForTimeout(600);
    if ((await hash()) !== "#/remplir") fail(`« Remplir mes paniers » mène à ${await hash()}`);
    let snap = await snapNow();
    if (!snap || snap.orders.length !== 2) fail("instantané : 2 commandes attendues dans cabas.guide.snap, " + (snap ? snap.orders.length : "aucun"));
    const key = await page.evaluate(() => window.cabasDebug().basketKey());
    if (snap && snap.key !== key) fail("instantané : sa clé n'est pas celle du panier");
    const rids = snap ? snap.orders.map((o) => o.rid) : [];
    if (rids.join() !== "monoprix,houra" && rids.join() !== "houra,monoprix") fail("instantané : commandes " + rids.join());
    if ((await page.locator(".fillc").count()) !== 2) fail("vue d'ensemble : une carte par commande attendue");
    await over("vue d'ensemble"); await shot("2-remplir");
    const first = rids[0] || "monoprix", second = rids[1] || "houra";
    const fname = first === "monoprix" ? "Monoprix" : "Houra", sname = second === "monoprix" ? "Monoprix" : "Houra";

    /* 2. accueil : carte « Il te reste … » et pastille du mini panier, tant que le remplissage est en cours */
    await go("#/");
    const hc = await text(".fillh");
    if (!new RegExp(`Il te reste \\d+\\s+produits à mettre chez ${fname}`).test(hc)) fail(`accueil : carte de remplissage « ${hc} »`);
    const mini = await text(".dock .mini");
    if (!new RegExp(`Il te reste \\d+\\s+produits à mettre chez ${fname}`).test(mini)) fail(`mini panier : pastille « ${mini} »`);
    await shot("3-accueil");
    await go("#/remplir");

    /* 3. « Avant de commencer » la première fois, puis le mode guidé */
    await page.click(".dock [data-act=fill]"); await page.waitForTimeout(500);
    if ((await hash()) !== "#/remplir/" + first) fail("« Commencer » mène à " + (await hash()));
    if (!/Avant de commencer/.test(await text("#view h1"))) fail("première fois : « Avant de commencer » attendu");
    if ((await page.locator("#view .steps li").count()) < 2) fail("« Avant de commencer » : étapes absentes");
    if (await page.evaluate(() => !document.body.classList.contains("solo"))) fail("mode guidé : plein écran attendu (body.solo, sans barre d'onglets)");
    await shot("4-avant");
    await page.click(".dock [data-act=fillready]");
    await page.waitForSelector("#fpn", { timeout: 15000 });
    if (!((await stored("seen")).first || {})[first]) fail("cabas.seen.first ne retient pas l'enseigne");
    const qty = await text(".fqty b"), link = await page.getAttribute(".dock [data-act=fillopen]", "href"), rel = await page.getAttribute(".dock [data-act=fillopen]", "rel");
    if (!(+qty >= 1)) fail("mode guidé : quantité absente");
    if (!/^https:\/\//.test(link || "")) fail("mode guidé : lien « Ouvrir sur » invalide : " + link);
    if (!/noopener/.test(rel || "")) fail("mode guidé : le lien n'a pas rel=noopener");
    if (!(await text(".dock [data-act=fillopen]")).includes(first === "monoprix" ? "courses.monoprix.fr" : "houra.fr")) fail("mode guidé : le bouton ne nomme pas le site");
    if (await page.locator("[data-act=fillall]").count()) fail("téléphone : « Tout ouvrir » ne doit pas apparaître");
    await over("mode guidé"); await shot("5-guide");

    /* 4. retour dans l'appli après 1,7 s : coché, « Annuler » ; puis un retour trop rapide ne coche rien */
    const n0 = await curName();
    await openCur(); await away(1700);
    let g = await stored("guide");
    const ck1 = Object.keys(g.ck || {}).filter((k) => k.startsWith(first + "|"));
    let tx = await toastText();
    if (ck1.length !== 1) fail("retour : un produit coché attendu, " + ck1.length);
    if (!/coché/.test(tx) || !/Annuler/.test(tx)) fail(`retour : toast « ${tx} »`);
    if ((await curName()) === n0) fail("retour : le produit suivant devrait s'afficher");
    await page.click("#toast button"); await page.waitForTimeout(350);
    g = await stored("guide");
    if (Object.keys(g.ck || {}).length) fail("Annuler : la coche reste");
    if ((await curName()) !== n0) fail("Annuler : le produit d'avant ne revient pas");
    await openCur(); await away(300);
    if (Object.keys((await stored("guide")).ck || {}).length) fail("retour rapide (0,3 s) : rien ne devrait être coché");
    await page.evaluate(() => { const S = window.cabasDebug().S; S.prefs.manualCk = true; });
    await openCur(); await away(1700);
    if (Object.keys((await stored("guide")).ck || {}).length) fail("« Cocher à la main » : le retour ne devrait rien cocher");
    await page.evaluate(() => { const S = window.cabasDebug().S; S.prefs.manualCk = false; });
    await openCur(); await away(1700);
    if (Object.keys((await stored("guide")).ck || {}).length !== 1) fail("retour : la coche ne revient pas");

    /* 5. « Pas trouvé » : le mettre chez l'autre enseigne (effet sur les frais), puis le laisser de côté */
    snap = await snapNow();
    const o1 = snap.orders.find((o) => o.rid === first);
    const otherRi = R.indexOf(second);
    const mov = o1.items.find((x) => !x.st && sells(byId.get(x.id) || {}, otherRi) && !(g.ck || {})[first + "|" + x.id]);
    if (!mov) fail(`« Pas trouvé » : aucun produit de la commande ${fname} vendu aussi chez ${sname} (panier d'essai à revoir)`);
    else {
      const idx = await page.evaluate(({ first, id }) => { const S = window.cabasDebug().S, o = S.guide.snap.orders.find((x) => x.rid === first); return o.items.filter((x) => !x.st).findIndex((x) => x.id === id); }, { first, id: mov.id });
      await page.click(`[data-act=fillat][data-v="${idx}"]`); await page.waitForTimeout(300);
      await page.click("#view [data-act=fillmiss]"); await page.waitForTimeout(400);
      if (await page.evaluate(() => document.getElementById("sheet").hidden)) fail("« Pas trouvé » : la feuille ne s'ouvre pas");
      const mv = page.locator(`#sheet [data-act=fillmove][data-to="${second}"]`);
      if (!(await mv.count())) fail(`« Pas trouvé » : « Le mettre chez ${sname} » absent`);
      else {
        const eff = (await mv.textContent()).replace(/\s+/g, " ");
        if (!/passe à/.test(eff) || !eff.includes(fname) || !eff.includes(sname)) fail(`« Pas trouvé » : l'effet sur les deux commandes n'est pas dit (« ${eff} »)`);
      }
      if (!(await page.locator("#sheet [data-act=fillskip]").count())) fail("« Pas trouvé » : « Le laisser de côté » absent");
      if (!(await page.locator("#sheet [data-act=fillbroken]").count())) fail("« Pas trouvé » : « Le lien n'ouvre pas le bon produit » absent");
      await shot("6-pas-trouve");
      if (await mv.count()) {
        await mv.click(); await page.waitForTimeout(400);
        tx = await toastText();
        if (!new RegExp(`Déplacé chez ${sname}`).test(tx) || !/Annuler/.test(tx)) fail(`déplacer : toast « ${tx} »`);
        snap = await snapNow();
        const inA = snap.orders.find((o) => o.rid === first).items.some((x) => x.id === mov.id), inB = snap.orders.find((o) => o.rid === second).items.find((x) => x.id === mov.id);
        if (inA || !inB || inB.from !== first) fail("déplacer : le produit n'est pas passé dans l'autre commande de l'instantané");
      }
    }
    const skipName = await curName(), skipId = await page.getAttribute("#view [data-act=fillmiss]", "data-p");
    await page.click("#view [data-act=fillmiss]"); await page.waitForTimeout(350);
    await page.click("#sheet [data-act=fillskip]"); await page.waitForTimeout(400);
    const todo = (await stored("todo")) || [];
    if (!todo.some((t) => t.id === skipId)) fail(`laisser de côté : ${skipName} n'est pas dans cabas.todo`);
    snap = await snapNow();
    if (!(snap.orders.find((o) => o.rid === first).items.find((x) => x.id === skipId) || {}).st) fail("laisser de côté : le produit reste à mettre sur le site");

    /* 6. lien cassé : retenu, la recherche du site le remplace */
    const bId = await page.getAttribute("#view [data-act=fillmiss]", "data-p");
    await page.click("#view [data-act=fillmiss]"); await page.waitForTimeout(350);
    const bl = page.locator("#sheet [data-act=fillbroken]");
    if (await bl.count()) {
      await bl.click(); await page.waitForTimeout(400);
      if (!((await stored("guide")).broken || {})[first + "|" + bId]) fail("lien cassé : pas retenu dans cabas.guide.broken");
      const h2 = await page.getAttribute(".dock [data-act=fillopen]", "href");
      if (first === "monoprix" && !/courses\.monoprix\.fr\/search\?q=/.test(h2 || "")) fail("lien cassé : la recherche du site ne remplace pas le lien (" + h2 + ")");
      await away(1700);
    } else { await page.keyboard.press("Escape"); fail("lien cassé : option absente"); }

    /* 7. « Copier la liste » : un texte lisible, nom de l'enseigne et quantités */
    await page.click("#view [data-act=fillcopy]"); await page.waitForTimeout(300);
    const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
    if (!new RegExp(`^${fname} \\(`).test(clip) || !/\n- /.test(clip)) fail("copier la liste : texte inattendu : " + clip.slice(0, 120));
    const all = await page.evaluate(() => window.cabasDebug().fillText());
    if (!/^Mes courses du/.test(all) || !all.includes(fname) || !all.includes(sname) || !/Total\s:\s/.test(all)) fail("fillText() : toutes les listes attendues");

    /* 8. tout cocher, fin de commande, créneau, commande suivante */
    for (let i = 0; i < 40 && (await page.locator("#view .fbtns [data-act=fillck]").count()); i++) { await page.click("#view .fbtns [data-act=fillck]"); await page.waitForTimeout(120); }
    if (!/est prêt/.test(await text("#view h1"))) fail("fin de commande : récapitulatif attendu, « " + (await text("#view h1")) + " »");
    await shot("7-fin");
    await page.click(".dock [data-act=filldone]"); await page.waitForTimeout(400);
    if (!new RegExp(`Commande ${fname} notée`).test(await toastText())) fail("« J'ai passé cette commande » : toast « " + (await toastText()) + " »");
    if (!/passée/.test(await text("#view h1"))) fail("commande passée : le récapitulatif ne le dit pas");
    await page.click("#view [data-act=when]"); await page.waitForTimeout(400);
    if (await page.evaluate(() => document.getElementById("sheet").hidden)) fail("créneau : la feuille ne s'ouvre pas");
    else {
      await page.click("#sheet [data-act=whend] >> nth=1"); await page.waitForTimeout(150);
      await page.click("#sheet [data-act=whens] >> nth=3"); await page.waitForTimeout(150);
      await page.click("#sheet .sheet-f [data-act=close]"); await page.waitForTimeout(400);
    }
    if (!(await page.locator("#view [data-act=ics]").count())) fail("créneau : « Ajouter au calendrier » absent du récapitulatif");
    const nextTxt = await text(".dock .btn");
    if (!new RegExp(`Continuer chez ${sname}`).test(nextTxt)) fail(`commande suivante : « ${nextTxt} »`);
    await page.click(".dock .btn"); await page.waitForTimeout(400);
    if (/Avant de commencer/.test(await text("#view h1"))) await page.click(".dock [data-act=fillready]");
    await page.waitForSelector("#fpn", { timeout: 15000 });
    for (let i = 0; i < 40 && (await page.locator("#view .fbtns [data-act=fillck]").count()); i++) { await page.click("#view .fbtns [data-act=fillck]"); await page.waitForTimeout(120); }
    await page.click(".dock [data-act=filldone]"); await page.waitForTimeout(400);
    if (!/Toutes tes commandes sont passées/.test(await toastText())) fail("dernière commande : toast « " + (await toastText()) + " »");
    const hist = (await stored("hist")) || [], h = hist[hist.length - 1];
    if (!h || !h.sid || !Array.isArray(h.o) || h.o.length !== 2 || !h.o.every((x) => x.rid && x.items)) fail("historique : le panier commandé n'est pas enregistré avec ses commandes");
    else {
      if (mov && !h.items[mov.id]) fail("historique : le produit déplacé manque");
      if (h.items[skipId] && !(snap.orders.find((o) => o.rid === second) || { items: [] }).items.some((x) => x.id === skipId)) fail("historique : le produit laissé de côté y est compté");
      if (!(h.when || []).some((w) => w.rid === first)) fail("historique : le créneau noté n'y est pas");
    }
    await go("#/remplir");
    if (!/Toutes tes commandes sont passées/.test(await text("#view .banner.good"))) fail("vue d'ensemble : « Toutes tes commandes sont passées » attendu");
    await go("#/panier"); await page.waitForTimeout(600);
    if (await page.locator("[data-act=fillgo]").count()) fail("panier : plus de « Remplir mes paniers » une fois tout commandé");
    if (!/Toutes tes commandes sont passées/.test(await text(".sum"))) fail("panier : « Toutes tes commandes sont passées » attendu");

    /* 9. « Recommander et remplir » : le panier commandé revient, avec le produit laissé de côté */
    await go("#/economies");
    await page.click("[data-act=refill] >> nth=0"); await page.waitForTimeout(700);
    if ((await hash()) !== "#/remplir") fail("recommander : « Remplir mes paniers » attendu, " + (await hash()));
    const b2 = await stored("basket");
    if (!b2 || !Object.keys(h.items || {}).every((id) => b2[id])) fail("recommander : le panier ne reprend pas les produits commandés");
    if (!b2 || !b2[skipId]) fail("recommander : le produit laissé de côté ne revient pas");
    if (((await stored("todo")) || []).length) fail("recommander : cabas.todo devrait être vidé");
    if (!/Panier remplacé/.test(await toastText())) fail("recommander : toast « " + (await toastText()) + " »");
    await page.waitForSelector(".dock [data-act=fill]", { timeout: 20000 }).catch(() => fail("recommander : la répartition n'arrive pas sur « Remplir mes paniers »"));
    if ((await snapNow())) fail("recommander : aucun instantané avant « Commencer »");
    await go("#/recommander");
    if ((await page.locator("#view [data-act=refill]").count()) < 1) fail("#/recommander : aucun panier à recommander");
    await over("recommander");

    /* 10. « Coller ma liste » et partage vers Cabas (share_target en POST, traité par sw.js : voir tools/sharecheck.js ;
       ici, l'ancienne cible en GET, que sw.js sert depuis le cache) */
    await page.evaluate(() => navigator.clipboard.writeText("lait demi-écrémé\n2 paquets de pâtes\ncafé moulu"));
    await page.evaluate(() => { window.cabasDebug().S.wl = null; location.hash = "#/ecrire"; });
    await page.waitForTimeout(400);
    await page.click("[data-act=wlpaste]"); await page.waitForTimeout(800);
    if ((await page.locator(".wli").count()) !== 3) fail("Coller ma liste : 3 lignes attendues, " + (await page.locator(".wli").count()));
    await page.goto(base + "?title=Courses&text=" + encodeURIComponent("beurre doux\nriz basmati\nhttps://exemple.fr/liste")); await ready(); await page.waitForTimeout(800);
    if ((await hash()) !== "#/ecrire") fail("partage vers Cabas : Ma liste attendue, " + (await hash()));
    if (await page.evaluate(() => location.search)) fail("partage vers Cabas : l'adresse garde ses paramètres");
    if ((await page.locator(".wli").count()) !== 2) fail("partage vers Cabas : 2 lignes attendues (le lien est écarté), " + (await page.locator(".wli").count()));
    const man = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.webmanifest"), "utf8"));
    if (!man.share_target || man.share_target.method !== "POST" || man.share_target.enctype !== "multipart/form-data" || !man.share_target.params.text) fail("manifeste : share_target en POST attendu (le texte partagé ne part pas dans l'adresse)");
    for (const u of ["./#/remplir", "./#/recommander"]) if (!(man.shortcuts || []).some((s) => s.url === u)) fail("manifeste : raccourci " + u + " absent");
    /* Android n'en montre que quatre : les quatre plus utiles d'abord (écrire, panier, remplir, recommander) */
    const first4 = (man.shortcuts || []).slice(0, 4).map((s) => s.url).join();
    if (first4 !== "./#/ecrire,./#/panier,./#/remplir,./#/recommander") fail("manifeste : quatre premiers raccourcis " + first4);
  } catch (e) {
    fail("parcours interrompu : " + e.message.split("\n")[0]);
  }

  /* 11. sur ordinateur : « Tout ouvrir » ; et sans les détails (hors ligne, jamais mis en cache) : le site et le nom à chercher */
  try {
    const dctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block", locale: "fr-FR" });
    await dctx.route((url) => !String(url).startsWith(origin) || /\/data\/details\//.test(String(url)), (r) => r.abort());
    const d = await dctx.newPage();
    d.on("pageerror", (e) => fail("ordinateur, erreur JS : " + e.message));
    await d.goto(base + "#/");
    await d.evaluate(({ basket, PREFS }) => { localStorage.clear(); localStorage.setItem("cabas.basket", JSON.stringify(basket)); localStorage.setItem("cabas.seen", JSON.stringify({ welcome: 1, first: { monoprix: 1, houra: 1 } })); localStorage.setItem("cabas.prefs", JSON.stringify(PREFS)); }, { basket, PREFS });
    await d.goto(base + "#/remplir/houra"); await d.reload();
    await d.waitForSelector("#fpn", { timeout: 30000 });
    if (!(await d.locator("[data-act=fillall]").count())) fail("ordinateur : « Tout ouvrir » absent");
    const dt = (await d.textContent(".dock [data-act=fillopen]")).trim(), fsite = (await d.textContent("#view .fsite")).replace(/\s+/g, " ");
    if (!/^Ouvrir houra\.fr/.test(dt)) fail(`sans détails : « Ouvrir houra.fr » attendu, « ${dt} »`);
    if (!/À chercher sur houra\.fr/.test(fsite)) fail(`sans détails : le nom à chercher n'est pas dit (« ${fsite} »)`);
    if (!(await d.locator("#view [data-act=fillname]").count())) fail("sans détails : « Copier le nom » absent");
    if (await d.evaluate(() => getComputedStyle(document.getElementById("dock")).display === "none")) fail("ordinateur : le bouton « Ouvrir sur … » n'est pas visible");
    if (SHOTS) await d.screenshot({ path: path.join(SHOTS, "8-ordinateur.png") });
    await dctx.close();
  } catch (e) { fail("ordinateur : " + e.message.split("\n")[0]); }

  /* 12. « Pas trouvé » sur une ligne qui est l'équivalent pris par le panier souple : l'équivalent choisi remplace le
     produit d'origine au panier (il sort du panier), sans rien ajouter de trop */
  try {
    const fctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block", locale: "fr-FR" });
    const f = await fctx.newPage();
    f.on("pageerror", (e) => fail("panier souple, erreur JS : " + e.message));
    const fready = () => f.waitForFunction(() => !document.querySelector("#view .sk") && document.querySelector("#view .wrap > *"), null, { timeout: 25000 });
    await f.goto(base + "#/"); await fready();
    await f.evaluate((PREFS) => { localStorage.clear(); localStorage.setItem("cabas.seen", JSON.stringify({ welcome: 1, first: { monoprix: 1, houra: 1, carrefour: 1, auchan: 1, "auchan-livraison-perreux": 1 } })); localStorage.setItem("cabas.prefs", JSON.stringify(Object.assign({}, PREFS, { maxOrders: 1 }))); }, PREFS);
    await f.reload(); await fready();
    /* un vrai panier qu'une commande prend en entier (« La semaine »), dont un produit a un équivalent moins cher chez
       la même enseigne, accepté (cabas.flex) */
    const pe = await f.evaluate(async () => {
      const D = cabasDebug(), src = await fetch("app.js").then((r) => r.text()), ex = /\["semaine", "La semaine", "([^"]+)"/.exec(src);
      const plan = D.listPlan(D.readList(ex[1])), b = {};
      plan.picks.forEach((pk) => { if (pk.id) b[pk.id] = pk.n; });
      for (const id of Object.keys(b)) {
        const p = D.S.prods.get(id);
        for (const rid of Object.keys(p.offers)) {
          const po = p.offers[rid];
          if (!po || !(po.price > 0) || po.sim) continue;
          const E = D.equivOf(p, rid, 8).find((x) => x.e.id !== id && !b[x.e.id] && x.price < po.price);
          if (E && D.equivOf(E.e, rid, 8).some((x) => x.e.id !== E.e.id)) return { b, P: id, E: E.e.id, rid };
        }
      }
      return null;
    });
    if (!pe) fail("panier souple : pas de produit avec un équivalent moins cher pour l'essai");
    else {
      await f.evaluate(({ b, P, E }) => { localStorage.setItem("cabas.basket", JSON.stringify(b)); localStorage.setItem("cabas.flex", JSON.stringify({ [P]: [E] })); localStorage.setItem("cabas.guide", "{}"); }, pe);
      await f.goto(base + "#/panier"); await f.reload(); await fready();
      await f.waitForFunction(() => cabasDebug().RES().done, null, { timeout: 30000 }); await f.waitForTimeout(400);
      await f.click("[data-act=fillgo]"); await f.waitForTimeout(700);
      const line = await f.evaluate(({ E }) => { const s = cabasDebug().S.guide.snap; if (!s) return null; for (const o of s.orders) { const i = o.items.filter((x) => !x.st).findIndex((x) => x.id === E); if (i >= 0) return { rid: o.rid, i, src: o.items.filter((x) => !x.st)[i].src || null }; } return null; }, pe);
      if (!line) fail("panier souple : l'équivalent accepté n'est pas pris dans l'instantané de « Remplir mes paniers »");
      else {
        if (!line.src || !line.src[pe.P]) fail("instantané : la ligne de l'équivalent ne dit pas quel produit du panier elle remplace " + JSON.stringify(line.src));
        await f.evaluate((h) => { location.hash = h; }, "#/remplir/" + line.rid); await f.waitForTimeout(600);
        await f.click(`[data-act=fillat][data-v="${line.i}"]`); await f.waitForTimeout(300);
        await f.click("#view [data-act=fillmiss]"); await f.waitForTimeout(400);
        const Q = await f.getAttribute("#sheet [data-act=fillequiv]", "data-e").catch(() => null);
        if (!Q) fail("« Pas trouvé » sur l'équivalent pris : aucun équivalent proposé");
        else {
          const q0 = pe.b[pe.P];
          await f.click("#sheet [data-act=fillequiv]"); await f.waitForTimeout(500);
          const bk = await f.evaluate(() => JSON.parse(localStorage.getItem("cabas.basket") || "{}"));
          const n = (id) => bk[id] || 0;
          if (Q !== pe.P && n(pe.P)) fail(`« Pas trouvé » > équivalent : le produit d'origine reste au panier (${n(pe.P)})`);
          if (n(Q) !== q0 + (Q !== pe.P ? pe.b[Q] || 0 : 0)) fail(`« Pas trouvé » > équivalent : ${n(Q)} exemplaires de l'équivalent choisi, ${q0} attendus`);
          if (Q !== pe.E && n(pe.E)) fail("« Pas trouvé » > équivalent : l'équivalent pris par le panier souple arrive au panier");
          await f.click("#toast button"); await f.waitForTimeout(400);
          const back = await f.evaluate(() => JSON.parse(localStorage.getItem("cabas.basket") || "{}"));
          if (JSON.stringify(back) !== JSON.stringify(pe.b)) fail("« Pas trouvé » > équivalent, « Annuler » : le panier n'est pas celui d'avant");
        }
      }
    }
    await fctx.close();
  } catch (e) { fail("panier souple, Pas trouvé : " + e.message.split("\n")[0]); }

  await browser.close();
  server.close();
  if (problems.length) { console.log("Problèmes :\n- " + problems.join("\n- ")); process.exit(1); }
  console.log("Remplir mes paniers vérifié : instantané, avant de commencer, retour simulé, Pas trouvé, fin de commande, recommander, coller, partage.");
})();
