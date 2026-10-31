// Vérification de l'accueil après la commande (F18) et pendant un remplissage (F01), au format iPhone, avec les
// historiques inventés de tools/fixtures/ : « Ta commande … est arrivée ? » une fois la livraison passée (une commande
// à la fois), « Il manquait quelque chose » envoie les produits dans cabas.todo, puis la carte « à racheter » les remet
// au panier (avec « Annuler ») ; « Oui, tout est là » ; « Plus tard » repousse d'un jour ; « Tes prochaines courses »
// et « Commande avant … » d'après le rythme des paniers et le délai de chaque enseigne (leadText, réglage prefs.lead) ;
// le total payé, saisi par la personne, gardé à part (cabas.hist[].paid) et dit « saisi par toi » ; la carte et la
// pastille du mini panier tant qu'un remplissage est en cours, sans la pastille quand le réglage l'éteint.
// Code de sortie 1 en cas de problème. Usage : node tools/homecheck.js [--shots=dossier]
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

/* dates locales, comme l'appli (isoDay) */
const iso = (d) => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); };
const plus = (n) => iso(new Date(Date.now() + n * 864e5));
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8"));
function histOf() {
  return fixture("historique.json").hist.map((h) => {
    const x = Object.assign({}, h, { d: plus(h.dd), when: (h.when || []).map((w) => Object.assign({}, w, { d: plus(w.dd) })) });
    delete x.dd; x.when.forEach((w) => delete w.dd);
    return x;
  });
}

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`, base = origin + "/index.html";
  const problems = [];
  const fail = (m) => problems.push(m);
  const PREFS = { zip: "94120", off: { leclerc: true }, fee: {}, pick: {}, liv: {}, keep: {}, usual: {}, qty1: {}, maxOrders: 3, extraCost: 0, offv: 1 };
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block", locale: "fr-FR", timezoneId: "Europe/Paris" });
  await ctx.route((url) => !String(url).startsWith(origin), (r) => r.abort());
  const page = await ctx.newPage();
  page.on("pageerror", (e) => fail("erreur JS : " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/net::ERR_FAILED/.test(m.text())) fail("console : " + m.text()); });
  const ready = () => page.waitForFunction(() => !document.querySelector("#view .sk") && document.querySelector("#view .wrap > *"), null, { timeout: 25000 });
  const stored = (k) => page.evaluate((k) => JSON.parse(localStorage.getItem("cabas." + k) || "null"), k);
  const toastText = () => page.evaluate(() => { const t = document.getElementById("toast"); return t.hidden ? "" : t.textContent; });
  const text = (sel) => page.evaluate((s) => { const el = document.querySelector(s); return el ? el.textContent.replace(/\s+/g, " ").trim() : ""; }, sel);
  const shot = async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: true }); } };
  const over = async (where) => { const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); if (o > 0) fail(`${where} : déborde de ${o} px en largeur`); };
  const load = async (state, h) => {
    await page.goto(base + "#/"); await ready();
    await page.evaluate((s) => { localStorage.clear(); for (const k of Object.keys(s)) localStorage.setItem("cabas." + k, JSON.stringify(s[k])); }, state);
    await page.goto(base + (h || "#/")); await page.reload(); await ready(); await page.waitForTimeout(500);
  };
  const go = async (h) => { await page.evaluate((h) => { location.hash = h; }, h); await page.waitForTimeout(450); };

  try {
    /* 1. après la livraison : une commande à la fois, « Tes prochaines courses » d'après le rythme des paniers */
    const hist = histOf(), last = hist.length - 1;
    await load({ hist, seen: { welcome: 1 }, prefs: PREFS });
    let arr = await text(".hcard.arr");
    if (!/Ta commande Houra est arrivée/.test(arr)) fail(`arrivée : carte « ${arr} »`);
    if (/Ta commande Monoprix/.test(arr)) fail("arrivée : une seule commande à la fois");
    const nx = await text("#nextT");
    if (!/Tes prochaines courses, vers demain/.test(nx)) fail(`prochaines courses : « ${nx} »`);
    const nxs = await page.evaluate(() => { const b = document.getElementById("nextT"); return b ? b.closest(".hcard").textContent.replace(/\s+/g, " ") : ""; });
    if (!/Commande avant ce soir chez Houra pour être livré demain/.test(nxs)) fail(`commande avant : « ${nxs} »`);
    if (!(await page.locator(".hcard [data-act=refill]").count())) fail("prochaines courses : « Recommander et remplir » absent");
    await over("accueil après la commande"); await shot("1-arrivee");

    /* 2. leadText : délai de l'enseigne, trop tard, réglage du délai */
    const lt = await page.evaluate(({ in3, today }) => { const D = window.cabasDebug(); return { a: D.leadText("houra", in3), b: D.leadText("houra", today), c: D.leadText("monoprix") }; }, { in3: plus(3), today: plus(0) });
    if (!/^Commande avant .+ au soir chez Houra pour être livré /.test(lt.a)) fail("leadText à trois jours : « " + lt.a + " »");
    if (!/trop tard/.test(lt.b)) fail("leadText pour aujourd'hui : « " + lt.b + " »");
    if (!/24 h/.test(lt.c)) fail("leadText sans date (Monoprix) : « " + lt.c + " »");
    const lt2 = await page.evaluate((in3) => { const D = window.cabasDebug(); D.S.prefs.lead = { houra: 2 }; const t = D.leadText("houra", in3); D.S.prefs.lead = {}; return t; }, plus(3));
    if (!/Commande avant demain soir chez Houra/.test(lt2)) fail("leadText avec deux jours de délai réglés : « " + lt2 + " »");

    /* 3. « Il manquait quelque chose » : la feuille, un produit coché, cabas.todo */
    await page.click(".hcard.arr [data-act=arrmiss]"); await page.waitForTimeout(400);
    if (await page.evaluate(() => document.getElementById("sheet").hidden)) fail("il manquait : la feuille ne s'ouvre pas");
    if ((await page.locator("#sheet [data-act=arrsel]").count()) !== 3) fail("il manquait : les 3 produits de la commande Houra attendus");
    if (!(await page.locator("#sheet [data-act=arrmissok][disabled]").count())) fail("il manquait : le bouton devrait attendre un produit coché");
    await page.click("#sheet [data-act=arrsel] >> nth=0"); await page.waitForTimeout(200);
    await shot("2-il-manquait");
    await page.click("#sheet [data-act=arrmissok]"); await page.waitForTimeout(400);
    const todo = (await stored("todo")) || [], h1 = ((await stored("hist")) || [])[last];
    if (todo.length !== 1 || todo[0].from !== "houra") fail("il manquait : cabas.todo " + JSON.stringify(todo));
    if (!h1 || (h1.arr || {}).houra !== "manque" || !((h1.miss || {}).houra || []).length) fail("il manquait : la réponse n'est pas gardée dans l'historique");
    if (!/pour ton prochain panier/.test(await toastText())) fail("il manquait : toast « " + (await toastText()) + " »");
    arr = await text(".hcard.arr");
    if (!/Ta commande Monoprix est arrivée/.test(arr)) fail(`arrivée : la commande suivante attendue, « ${arr} »`);
    if (!/Un produit à racheter/.test(await text("#todoT"))) fail("à racheter : carte absente");

    /* 4. « Oui, tout est là », puis « Plus tard » */
    await page.click(".hcard.arr [data-act=arrok]"); await page.waitForTimeout(400);
    if (((((await stored("hist")) || [])[last] || {}).arr || {}).monoprix !== "ok") fail("tout est là : réponse absente");
    if (!/C'est noté/.test(await toastText()) || !/Total payé/.test(await toastText())) fail("tout est là : toast « " + (await toastText()) + " »");
    if (!/Ta commande Carrefour est arrivée/.test(await text(".hcard.arr"))) fail("arrivée : Carrefour (sans créneau, date et délai) attendu");
    await page.click(".hcard.arr [data-act=arrlater]"); await page.waitForTimeout(400);
    if (await page.locator(".hcard.arr").count()) fail("plus tard : la carte reste");
    if (!Object.keys(((await stored("guide")) || {}).snooze || {}).length) fail("plus tard : pas de rappel repoussé dans cabas.guide.snooze");

    /* 5. la carte « à racheter » : au panier, avec « Annuler » */
    await page.click(".hcard [data-act=todoadd]"); await page.waitForTimeout(400);
    const b1 = (await stored("basket")) || {};
    if (!b1[todo[0] && todo[0].id]) fail("à racheter : le produit n'est pas au panier");
    if (((await stored("todo")) || []).length) fail("à racheter : cabas.todo devrait être vide");
    await page.click("#toast button"); await page.waitForTimeout(400);
    if (((await stored("todo")) || []).length !== 1 || Object.keys((await stored("basket")) || {}).length) fail("à racheter : « Annuler » ne remet pas tout");

    /* 6. le total payé : saisi par toi, à part, en centimes ; un montant illisible est refusé */
    await go("#/economies");
    await page.click("[data-act=paid] >> nth=0"); await page.waitForTimeout(400);
    const nf = await page.locator("#sheet input[data-r]").count();
    if (nf !== 3) fail(`total payé : un champ par commande attendu (3), ${nf}`);
    await page.fill("#paid0", "abc"); await page.click("#sheet [data-act=paidok]"); await page.waitForTimeout(250);
    if (!(await page.locator('#sheet [data-field="paid0"].err').count())) fail("total payé : « abc » devrait être refusé");
    await page.fill("#paid0", "64,12"); await page.fill("#paid1", "63"); await page.click("#sheet [data-act=paidok]"); await page.waitForTimeout(400);
    const paid = ((((await stored("hist")) || [])[last]) || {}).paid || {};
    if (paid.houra !== 6412 || paid.monoprix !== 6300) fail("total payé : " + JSON.stringify(paid));
    const row = await text("#view .group .row");
    if (!/Payé 127,12\s€, saisi par toi/.test(row)) fail(`économies : « ${row} »`);
    const sav = await text("#view .lt-sub");
    if (/127,12/.test(sav)) fail("économies : le total payé ne doit pas entrer dans les économies");
    await over("économies"); await shot("3-economies");

    /* 7. pendant un remplissage : carte d'accueil, pastille du mini panier ; sans pastille si le réglage l'éteint */
    const F = fixture("remplir.json");
    await load({ basket: F.basket, seen: { welcome: 1 }, prefs: PREFS });
    const key = await page.evaluate(() => window.cabasDebug().basketKey());
    const snap = Object.assign({}, F.snap, { at: new Date().toISOString(), key });
    await load({ basket: F.basket, seen: { welcome: 1 }, prefs: PREFS, guide: { ck: F.ck, done: {}, when: {}, snap } });
    const hc = await text(".fillh");
    if (!/Il te reste 2\s+produits à mettre chez Monoprix/.test(hc)) fail(`remplissage : carte d'accueil « ${hc} »`);
    if (!/1 sur 5\s+produits/.test(hc)) fail(`remplissage : progression « ${hc} »`);
    const mini = await text(".dock .mini");
    if (!/Il te reste 2\s+produits à mettre chez Monoprix/.test(mini)) fail(`remplissage : pastille « ${mini} »`);
    if ((await page.getAttribute(".dock .mini", "href")) !== "#/remplir/monoprix") fail("remplissage : la pastille doit reprendre chez Monoprix");
    await shot("4-remplissage");
    await go("#/reglages");
    const sw = page.locator("[data-act=badge]");
    if (!(await sw.count())) fail("réglages : « Rappel dans le mini panier » absent");
    else { await sw.scrollIntoViewIfNeeded(); await sw.click({ force: true }); await page.waitForTimeout(300); }
    if (!(await page.locator("[data-act=manualck]").count())) fail("réglages : « Cocher à la main » absent");
    await go("#/");
    if (/Il te reste/.test(await text(".dock .mini"))) fail("réglage éteint : la pastille reste");
    if (!/Voir le panier/.test(await text(".dock .mini"))) fail("réglage éteint : le mini panier normal attendu");
    if ((await stored("prefs") || {}).badge !== false) fail("réglage : prefs.badge non enregistré");
  } catch (e) {
    fail("parcours interrompu : " + e.message.split("\n")[0]);
  }
  await browser.close();
  server.close();
  if (problems.length) { console.log("Problèmes :\n- " + problems.join("\n- ")); process.exit(1); }
  console.log("Accueil vérifié : arrivée, il manquait, à racheter, prochaines courses, commande avant, total payé, remplissage en cours.");
})();
