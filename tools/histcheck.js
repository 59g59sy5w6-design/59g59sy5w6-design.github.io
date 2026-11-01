// Vérification de « Ce qui a bougé, le bon moment, tes dépenses » (F24), au format iPhone, avec un historique de prix
// construit d'après tools/fixtures/historique-prix.json et servi à la place de data/history.json : une baisse et une
// hausse sur tes produits, une baisse ailleurs dans le catalogue, une variation trop petite (écartée), une offre E.Leclerc
// (simulée, jamais comptée) ; momentOf (« Bon moment », « Il a déjà été moins cher ») sur la fiche produit ; l'écran
// #/mouvements ; les dépenses par mois d'après cabas.hist (aux prix relevés, le total payé à part, « saisi par toi ») ;
// les hausses vues depuis le dernier relevé (cabas.ups) dites sur l'accueil quand il n'y a pas de baisse.
// Code de sortie 1 en cas de problème. Usage : node tools/histcheck.js [--shots=dossier]
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

let HISTORY = null;
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/data/history.json" && HISTORY) { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(HISTORY)); return; }
  const f = path.join(ROOT, p === "/" ? "index.html" : p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});

const iso = (d) => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); };
const plus = (n) => iso(new Date(Date.now() + n * 864e5));
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8"));

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/index.html`;
  const problems = [];
  const fail = (m) => problems.push(m);
  const PREFS = { zip: "94120", off: { leclerc: true }, fee: {}, pick: {}, liv: {}, keep: {}, usual: {}, qty1: {}, maxOrders: 3, extraCost: 0, offv: 1 };
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block", locale: "fr-FR", timezoneId: "Europe/Paris" });
  /* la fiche demande Nutri-Score et allergènes à Open Food Facts : réponse simulée « inconnu », rien ne sort du test */
  await ctx.route(/^https:\/\/world\.openfoodfacts\.org\//, (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: '{"status":0}' }));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => fail("erreur JS : " + e.message));
  page.on("console", (m) => { if (m.type() === "error") fail("console : " + m.text()); });
  const ready = () => page.waitForFunction(() => !document.querySelector("#view .sk") && document.querySelector("#view .wrap > *"), null, { timeout: 25000 });
  const text = (sel) => page.evaluate((s) => { const el = document.querySelector(s); return el ? el.textContent.replace(/\s+/g, " ").trim() : ""; }, sel);
  const stored = (k) => page.evaluate((k) => JSON.parse(localStorage.getItem("cabas." + k) || "null"), k);
  const shot = async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: true }); } };
  const over = async (where) => { const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); if (o > 0) fail(`${where} : déborde de ${o} px en largeur`); };
  const load = async (state, h) => {
    await page.goto(base + "#/"); await ready();
    await page.evaluate((s) => { localStorage.clear(); for (const k of Object.keys(s)) localStorage.setItem("cabas." + k, JSON.stringify(s[k])); }, state);
    await page.goto(base + (h || "#/")); await page.reload(); await ready(); await page.waitForTimeout(600);
  };

  try {
    /* l'historique de test : construit d'après les prix relevés d'aujourd'hui, pour l'enseigne la moins chère */
    const H = fixture("historique-prix.json").offres;
    await load({ seen: { welcome: 1 }, prefs: PREFS });
    const cur = await page.evaluate((H) => { const D = cabasDebug(); return H.map((o) => { const p = D.S.prods.get(o.id), b = p && D.bestReal(p); return { id: o.id, rid: o.rid || (b && b.ret), price: o.rid ? (p.offers[o.rid] || {}).price || 3 : b && b.price }; }); }, H);
    if (cur.some((c) => !c.rid || !(c.price > 0))) throw new Error("produits de l'historique de test absents du catalogue : " + JSON.stringify(cur));
    const days = [...new Set(H.flatMap((o) => o.pts.map(([dd]) => plus(dd))))].sort();
    HISTORY = { d: days, p: {} };
    H.forEach((o, i) => { const c = cur[i]; (HISTORY.p[o.id] = HISTORY.p[o.id] || {})[c.rid] = o.pts.map(([dd, dv]) => [days.indexOf(plus(dd)), Math.round((c.price + dv) * 100) / 100]); });
    const mine = {}; H.filter((o) => o.mine).forEach((o) => { mine[o.id] = 1; });
    const hist = fixture("historique.json").hist.map((h) => { const x = Object.assign({}, h, { d: plus(h.dd), when: [] }); delete x.dd; return x; });
    hist[hist.length - 1].paid = { houra: 6412 };
    await load({ seen: { welcome: 1 }, prefs: PREFS, basket: mine, hist });
    await page.evaluate(() => cabasDebug().loadHist());
    const M = await page.evaluate(() => { const D = cabasDebug(), f = (L) => L.map((m) => ({ id: m.p.id, rid: m.rid, pct: m.pct, from: m.from, to: m.to })); const a = D.moves(false), b = D.moves(true, 14); return { down: f(a.down), up: f(a.up), all: f(b.down.concat(b.up)) }; });
    const A = H[0].id, B = H[1].id, C = H[2].id, Dd = H[3].id;
    if (!M.down.some((m) => m.id === A && m.pct < 0)) fail("baisse sur tes produits absente : " + JSON.stringify(M.down));
    if (!M.up.some((m) => m.id === B && m.pct > 0)) fail("hausse sur tes produits absente : " + JSON.stringify(M.up));
    if (M.down.concat(M.up).some((m) => m.id === Dd)) fail("une variation de 5 centimes ne doit pas compter");
    if (M.down.concat(M.up).some((m) => m.id === C)) fail("un produit hors de tes listes et de ton panier ne doit pas être dans « tes produits »");
    if (M.down.concat(M.up, M.all).some((m) => /leclerc/.test(m.rid))) fail("une offre E.Leclerc (simulée) ne doit jamais compter");
    if (!M.all.some((m) => m.id === C)) fail("catalogue : la baisse de la lessive absente " + JSON.stringify(M.all));
    const mo = await page.evaluate(([a, b]) => { const D = cabasDebug(); return [D.momentOf(D.S.prods.get(a)), D.momentOf(D.S.prods.get(b))]; }, [A, B]);
    if (!mo[0] || mo[0].k !== "low" || !/Bon moment/.test(mo[0].text)) fail("momentOf, au plus bas : " + JSON.stringify(mo[0]));
    if (!mo[1] || mo[1].k !== "high" || !/Il a déjà été moins cher/.test(mo[1].text)) fail("momentOf, plus cher qu'avant : " + JSON.stringify(mo[1]));
    /* l'écran Ce qui a bougé */
    await page.evaluate(() => { location.hash = "#/mouvements"; }); await page.waitForTimeout(800);
    const v = await text("#view");
    if (!/Moins cher sur tes produits/.test(v) || !/Plus cher sur tes produits/.test(v)) fail("#/mouvements : sections absentes");
    const signs = await page.$$eval("#view .mv", (els) => els.map((e) => e.textContent));
    if (!signs.some((t) => /^−\d+\s%$/.test(t)) || !signs.some((t) => /^\+\d+\s%$/.test(t))) fail("#/mouvements : les signes « − » et « + » doivent être écrits " + JSON.stringify(signs));
    if (!/Dans tout le catalogue/.test(v)) fail("#/mouvements : la section du catalogue manque");
    if (!/simulés/.test(v)) fail("#/mouvements : la règle des prix relevés seulement n'est pas dite");
    /* dépenses par mois : prix relevés, le total payé à part */
    const sp = await page.evaluate(() => cabasDebug().spendByMonth(6));
    const relev = hist.reduce((a, h) => a + h.t, 0), got = sp.reduce((a, x) => a + x.t, 0);
    if (sp.length !== 6 || got !== relev) fail(`dépenses : ${got} centimes aux prix relevés sur six mois, ${relev} attendus`);
    if (sp.reduce((a, x) => a + x.paid, 0) !== 6412) fail("dépenses : le total payé indiqué doit rester à part");
    if ((await page.locator("#view .spend .sb").count()) !== 6) fail("#/mouvements : six mois de dépenses attendus");
    if (!/saisi par toi, à part/.test(v)) fail("#/mouvements : le total payé n'est pas dit « saisi par toi »");
    await over("#/mouvements"); await shot("1-mouvements");
    /* la fiche produit dit le bon moment */
    await page.evaluate((a) => { location.hash = "#/produit/" + encodeURIComponent(a); }, A); await page.waitForTimeout(900);
    if (!/Bon moment/.test(await text("#phist"))) fail("fiche produit : « Bon moment » absent (" + (await text("#phist")).slice(0, 120) + ")");
    await over("fiche produit"); await shot("2-fiche");

    /* hausses vues depuis le dernier relevé : sans baisse, une carte sur l'accueil vers Ce qui a bougé */
    const seenp = {}; cur.slice(0, 2).forEach((c) => { seenp[c.id] = Math.max(0.01, Math.round((c.price - 0.5) * 100) / 100); });
    await load({ seen: { welcome: 1 }, prefs: PREFS, basket: mine, seenp, seenAt: "" });
    const ups = (await stored("ups")) || [];
    if (ups.length !== 2) fail("cabas.ups : deux hausses attendues " + JSON.stringify(ups));
    const hc = await page.evaluate(() => { const a = document.querySelector('#view a.hcard[href="#/mouvements"]'); return a ? a.textContent.replace(/\s+/g, " ") : ""; });
    if (!/2\s+de tes produits ont augmenté/.test(hc)) fail("accueil : carte des hausses « " + hc + " »");
    await over("accueil, hausses"); await shot("3-hausses");
  } catch (e) {
    fail("parcours interrompu : " + e.message.split("\n")[0]);
  }

  /* quitter #/mouvements pendant la lecture de l'historique, ou sans historique (hors ligne) : l'onglet ne se fige pas,
     l'écran dit que l'historique manque */
  for (const how of ["recharger aussitôt", "historique introuvable"]) {
    const c2 = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block", locale: "fr-FR" });
    if (how === "historique introuvable") await c2.route(/\/data\/history\.json/, (r) => r.abort());
    const p2 = await c2.newPage();
    p2.on("pageerror", (e) => fail(how + ", erreur JS : " + e.message));
    try {
      await p2.goto(base + "#/"); await p2.waitForFunction(() => !document.querySelector("#view .sk") && document.querySelector("#view .wrap > *"), null, { timeout: 25000 });
      await p2.evaluate(() => localStorage.setItem("cabas.seen", JSON.stringify({ welcome: 1 })));
      await p2.goto(base + "#/mouvements");
      if (how === "historique introuvable") {
        await p2.waitForTimeout(800);
        const t = await p2.evaluate(() => document.querySelector("#view").textContent);
        if (!/n'a pas pu être chargé/.test(t)) fail(how + " : l'écran ne dit pas que l'historique manque");
      }
      await p2.reload({ timeout: 10000 });
    } catch (e) {
      fail(`#/mouvements, ${how} : la page ne se recharge pas (${e.message.split("\n")[0]})`);
    }
    await c2.close();
  }
  await browser.close();
  server.close();
  if (problems.length) { console.log("Problèmes :\n- " + problems.join("\n- ")); process.exit(1); }
  console.log("Ce qui a bougé vérifié : baisses et hausses de tes produits, catalogue, prix simulés écartés, bon moment, dépenses par mois, hausses sur l'accueil.");
})();
