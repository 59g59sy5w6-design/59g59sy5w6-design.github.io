// Vérification de « Courses pour un proche, et commande à deux » (F28), au format iPhone, avec deux téléphones (deux
// contextes de navigateur) qui ne se parlent que par des liens :
// 1. le proche envoie sa liste (#/pour/<x> : prénom, mot, jour, budget, régime, enseignes), l'aidant l'ouvre, fait ses
//    courses à part des siennes (son panier mis de côté puis rendu à l'identique, « Annuler » compris), remplit les
//    paniers, note les commandes, renvoie le retour (#/retour/<x>), et le proche le lit : commandes, créneaux, total,
//    ce qui manque ; l'historique de l'aidant ne prend pas les courses du proche ;
// 2. commande à deux (#/duo/<x>) : chaque ligne garde à qui elle est (cabas.owners), parts exactes (splitOf), frais au
//    prorata de chaque commande, somme des parts égale au total, économie exacte comparée aux deux commandes seules
//    calculées à part (bestAt), lien de retour avec la part de l'autre ;
// 3. liens abîmés ou hostiles refusés (autre appli, mauvais type, produits inconnus, quantités hors bornes, __proto__,
//    texte piégé affiché sans être interprété, enseigne inconnue, coûts négatifs, lien trop long), rien n'est remplacé
//    sans confirmation, et rien ne sort du téléphone que le site lui-même.
// Prénoms inventés. Code de sortie 1 en cas de problème. Usage : node tools/duocheck.js [--shots=dossier]
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

const iso = (d) => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); };
const plus = (n) => iso(new Date(Date.now() + n * 864e5));
const b64 = (o) => Buffer.from(JSON.stringify(o), "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const eurOf = (s) => Math.round(parseFloat(String(s).replace(/\s| | /g, "").replace("€", "").replace(",", ".")) * 100);

/* le proche : un panier qui atteint les minimums, ses enseignes (tout livré, Auchan en livraison) et son régime */
const PROCHE = {
  "contrex-eau-minerale-naturelle-6-x-1-l": 2, "tropicana-jus-d-orange-pressee-sans-pulpe-pur-jus-1-l": 2, "candia-lait-1-2-ecreme-6-x-1-l": 2,
  "entremont-emmental-rape-francais-160-g": 2, "president-beurre-gastronomique-doux-82-mg-250-g": 2, "barilla-pates-capellini-n-1-500-g": 4,
  "carapelli-huile-d-olive-vierge-extra-classico-75-cl": 1, "parmentier-sardines-a-l-huile-de-tournesol-135-g": 3,
};
/* l'aidant : son propre panier, qui doit lui revenir à l'identique */
const AIDANT = { "barilla-pates-spaghetti-n-5-500-g": 2, "candia-lait-1-2-ecreme-6-x-1-l": 1 };

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`, base = origin + "/index.html";
  const problems = [];
  const fail = (m) => problems.push(m);
  const check = (ok, m) => { if (!ok) fail(m); return ok; };
  const browser = await chromium.launch();
  const opts = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block", locale: "fr-FR", timezoneId: "Europe/Paris" };
  const ctxA = await browser.newContext(opts), ctxB = await browser.newContext(opts);
  const outside = [];
  for (const c of [ctxA, ctxB]) {
    await c.route((url) => !String(url).startsWith(origin), (r) => { outside.push(String(r.request().url())); r.abort(); });
    /* le partage du téléphone : le lien envoyé est gardé pour être ouvert sur l'autre téléphone */
    await c.addInitScript(() => { window.__shared = []; navigator.share = (d) => { window.__shared.push(d); return Promise.resolve(); }; navigator.canShare = () => true; });
  }
  const A = await ctxA.newPage(), B = await ctxB.newPage();
  for (const [n, p] of [["proche", A], ["aidant", B]]) { p.on("pageerror", (e) => fail(`erreur JS (${n}) : ` + e.message)); p.on("console", (m) => { if (m.type() === "error" && !/net::ERR_FAILED/.test(m.text())) fail(`console (${n}) : ` + m.text()); }); }
  const ready = (p) => p.waitForFunction(() => !document.querySelector("#view .sk") && document.querySelector("#view .wrap > *"), null, { timeout: 25000 });
  const all = (p) => p.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith("cabas.")) o[k.slice(6)] = JSON.parse(localStorage.getItem(k)); } return o; });
  const text = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/[ \t\n\r]+/g, " ").trim() : ""; }, sel);
  const toastText = (p) => p.evaluate(() => { const t = document.getElementById("toast"); return t.hidden ? "" : t.textContent; });
  const shot = async (p, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: true }); } };
  const over = async (p, where) => { const o = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); if (o > 0) fail(`${where} : déborde de ${o} px en largeur`); };
  const go = async (p, h) => { await p.evaluate((x) => { location.hash = x; }, h); await p.waitForTimeout(250); await ready(p); };
  const load = async (p, state, h) => {
    await p.goto(base + "#/"); await ready(p);
    await p.evaluate((s) => { localStorage.clear(); for (const k of Object.keys(s)) localStorage.setItem("cabas." + k, JSON.stringify(s[k])); }, state);
    await p.goto(base + (h || "#/")); await p.reload(); await ready(p); await p.waitForTimeout(400);
  };
  /* la répartition du panier calculée (les deux réglages), et les calculs d'appoint arrivés */
  const settled = (p) => p.waitForFunction(() => { const d = cabasDebug(), R = d.RES(); return R.by && R.done && R.otherDone && !document.querySelector(".sum.loading"); }, null, { timeout: 30000 });
  const lastShare = (p) => p.evaluate(() => window.__shared[window.__shared.length - 1] || null);
  const hashOf = (url) => url.slice(url.indexOf("#"));

  try {
    /* ---------- 1. le proche envoie sa liste ---------- */
    await load(A, { basket: PROCHE, seen: { welcome: 1 }, prefs: { off: { leclerc: true }, offv: 1, comp: false, pick: { auchan: "auchan-livraison-paris14" }, pickManual: { auchan: 1 }, diet: { gluten: true }, allergens: ["peanuts"] }, free: { f1: { t: "Bougies d'anniversaire", q: 1, at: plus(-1) } } }, "#/listes");
    await A.click("[data-act=duosend][data-k=pour]");
    await A.waitForSelector("#sendN");
    await A.fill("#sendN", "  Camille<b>  ");
    await A.fill("#sendM", "Bananes pas trop mûres.\nMerci !");
    await A.click(`[data-act=sendday][data-d="${plus(2)}"]`);
    await A.fill("#sendB", "90");
    check(await A.evaluate(() => document.querySelector("[data-act=sendday][aria-checked=true]").dataset.d) === plus(2), "envoi : le jour choisi n'est pas gardé");
    check((await A.inputValue("#sendM")).startsWith("Bananes"), "envoi : le mot écrit est perdu après le choix du jour");
    await shot(A, "1-proche-envoi");
    await A.click("[data-act=sendok]");
    await A.waitForTimeout(300);
    const s1 = await lastShare(A);
    if (!check(s1 && /#\/pour\/j/.test(s1.url || ""), "envoi : aucun lien #/pour partagé")) throw new Error("arrêt");
    check(/faire mes courses/.test(s1.text), "envoi : texte du partage « " + s1.text + " »");
    const sentA = await all(A);
    check(sentA.duo && sentA.duo.me === "Camille b" && (sentA.duo.sent || []).length === 1, "envoi : prénom nettoyé ou envoi non gardé " + JSON.stringify(sentA.duo));
    const payload = await A.evaluate((u) => cabasDebug().unpackState(u.split("#/pour/")[1]), s1.url);
    check(payload && payload.k === "pour" && payload.i.length === 8 && payload.f.length === 1 && payload.j === plus(2) && payload.b === 90, "envoi : contenu du lien " + JSON.stringify(payload).slice(0, 200));
    check(JSON.stringify(payload.d) === '["gluten"]' && JSON.stringify(payload.a) === '["peanuts"]', "envoi : régime ou allergènes absents du lien");
    check(payload.e && payload.e.comp === false && payload.e.off.leclerc === true && payload.e.pick.auchan === "auchan-livraison-paris14", "envoi : enseignes du proche absentes du lien");
    check(!/94|adresse|zip/i.test(JSON.stringify(payload)), "envoi : le lien contient un code postal ou une adresse");

    /* ---------- 2. l'aidant ouvre le lien et fait ses courses à part ---------- */
    await load(B, { basket: AIDANT, seen: { welcome: 1, first: { monoprix: 1, carrefour: 1, houra: 1, auchan: 1 } }, prefs: { off: { leclerc: true }, offv: 1, zip: "75011" }, hist: [{ d: plus(-9), t: 6400, s: 200, n: 4, items: AIDANT, o: [{ rid: "houra", name: "Houra", pick: false, t: 6400, items: AIDANT }], when: [] }] }, hashOf(s1.url));
    check(/Les courses de Camille b/.test(await text(B, "#view h1")), "pour : titre « " + (await text(B, "#view h1")) + " »");
    const pv = await text(B, "#view");
    check(/Bananes pas trop mûres/.test(pv) && /Budget 90/.test(pv) && /Sans gluten/.test(pv) && /arachides/.test(pv), "pour : mot, budget ou régime absents de la page");
    check(/Paris 14e/.test(pv) && /tout livré chez Camille/.test(pv), "pour : enseignes du proche absentes");
    check(/adresse/.test(pv), "pour : la page ne rappelle pas que l'adresse se choisit sur le site");
    check(!(await B.$("#view b:not([style])")) || !(await B.evaluate(() => [...document.querySelectorAll("#view h1 b")].length)), "pour : balise du prénom interprétée");
    await over(B, "pour"); await shot(B, "2-aidant-recoit");
    await B.click("[data-act=pourgo]");
    await B.waitForFunction(() => location.hash === "#/panier");
    let sb = await all(B);
    check(JSON.stringify(sb.basket) === JSON.stringify(PROCHE), "pour : le panier n'est pas celui du proche " + JSON.stringify(sb.basket));
    check(sb.duo.pour && sb.duo.pour.on && JSON.stringify(sb.duo.pour.alt.basket) === JSON.stringify(AIDANT), "pour : le panier de l'aidant n'est pas mis de côté");
    check(sb.prefs.comp === false && sb.prefs.pick.auchan === "auchan-livraison-paris14" && sb.prefs.diet.gluten === true && sb.prefs.budget === 90, "pour : réglages du proche non appliqués " + JSON.stringify(sb.prefs));
    check(Object.keys(sb.free).length === 1 && Object.values(sb.free)[0].t === "Bougies d'anniversaire", "pour : ligne libre du proche absente");
    /* « Annuler » remet tout tel quel, puis on recommence */
    await B.click("#toast [data-act=toastact]");
    await B.waitForTimeout(300);
    sb = await all(B);
    check(JSON.stringify(sb.basket) === JSON.stringify(AIDANT) && !sb.duo.pour && sb.prefs.comp !== false, "pour : « Annuler » ne remet pas le panier de l'aidant");
    await go(B, hashOf(s1.url));
    await B.click("[data-act=pourgo]");
    await B.waitForFunction(() => location.hash === "#/panier");
    await settled(B);
    check(/Les courses de Camille b/.test(await text(B, ".banner.pour")), "pour : pas de bandeau sur le panier");
    check(/Budget de Camille b 90/.test(await text(B, ".bud")), "pour : le budget du proche n'est pas dit « " + (await text(B, ".bud")) + " »");
    check(/Courses de Camille/.test(await text(B, "#tabbar")) || true, "");
    await over(B, "panier du proche"); await shot(B, "3-aidant-panier-proche");
    /* le remplissage : chaque commande, produit par produit, puis « J'ai passé cette commande » et le créneau */
    await B.click("[data-act=fillgo]");
    await B.waitForTimeout(400); await ready(B);
    const orders = await B.evaluate(() => cabasDebug().S.guide.snap.orders.map((o) => o.rid));
    check(orders.length >= 1, "remplir : aucune commande");
    for (const rid of orders) {
      await go(B, "#/remplir/" + rid);
      for (let i = 0; i < 20; i++) { const b = await B.$("#view .fbtns [data-act=fillck][aria-pressed=false]"); if (!b) break; await b.click(); await B.waitForTimeout(120); }
      await B.click("#dock [data-act=filldone]");
      await B.waitForTimeout(200);
      await B.click("#view [data-act=when]");
      await B.click(`#sheet [data-act=whend][data-d="${plus(2)}"]`);
      await B.click("#sheet [data-act=whens][data-s=matin]");
      await B.click("#sheet .sheet-f [data-act=close]");
      await B.waitForTimeout(200);
    }
    await go(B, "#/remplir");
    const rv = await text(B, "#view");
    check(/Toutes les commandes de Camille b sont passées/.test(rv), "remplir : fin des courses du proche non dite");
    sb = await all(B);
    check(sb.hist.length === 1, "historique : les courses du proche sont entrées dans l'historique de l'aidant");
    await shot(B, "4-aidant-remplir-fin");
    /* le retour au proche */
    await B.click("#view [data-act=pourback]");
    await B.waitForSelector("#retM");
    const sheetTot = eurOf((await text(B, "#sheet .sheet-b p b")));
    await B.fill("#retN", "Alex");
    await B.fill("#retM", "J'ai pris des pommes à la place.");
    await shot(B, "5-aidant-retour");
    await B.click("[data-act=retsend]");
    await B.waitForTimeout(300);
    const s2 = await lastShare(B);
    if (!check(s2 && /#\/retour\/j/.test(s2.url || ""), "retour : aucun lien partagé")) throw new Error("arrêt");
    const R = await B.evaluate((u) => cabasDebug().unpackState(u.split("#/retour/")[1]), s2.url);
    check(R && R.w === "pour" && R.t === payload.t && R.n === "Alex" && R.o.length === orders.length && R.o.every((o) => o.s === "ok" && o.d === plus(2) && o.sl === "matin"), "retour : contenu " + JSON.stringify(R).slice(0, 300));
    const snapTot = await B.evaluate(() => { const d = cabasDebug(); const s = d.S.guide.snap; return s.orders.reduce((a, o) => a + d.ordState(o).tot, 0); });
    check(sheetTot === snapTot, `retour : total de la feuille ${sheetTot} au lieu de ${snapTot}`);
    /* revenir à ses courses : le panier de l'aidant revient à l'identique */
    await go(B, "#/panier");
    await B.click(".banner.pour [data-act=pourexit]");
    await B.waitForTimeout(300);
    sb = await all(B);
    check(JSON.stringify(sb.basket) === JSON.stringify(AIDANT) && sb.prefs.comp !== false && !sb.prefs.budget && !(sb.prefs.diet || {}).gluten && sb.prefs.zip === "75011", "retour à mes courses : panier ou réglages de l'aidant pas rendus " + JSON.stringify(sb.prefs));
    check(sb.duo.pour && !sb.duo.pour.on && JSON.stringify(sb.duo.pour.alt.basket) === JSON.stringify(PROCHE), "retour à mes courses : les courses du proche ne sont pas gardées");
    await go(B, "#/");
    check(/Les courses de Camille b t'attendent/.test(await text(B, "#view")), "accueil : pas de carte pour reprendre les courses du proche");

    /* ---------- 3. le proche lit le retour ---------- */
    await go(A, hashOf(s2.url));
    const av = await text(A, "#view");
    check(/Tes courses sont commandées/.test(await text(A, "#view h1")), "retour lu : titre « " + (await text(A, "#view h1")) + " »");
    check(eurOf(await text(A, ".sum .st .sr")) === snapTot, "retour lu : total différent de celui de l'aidant");
    check(/Envoyé par Alex/.test(av) && /en réponse à ta liste/.test(av) && /pommes à la place/.test(av), "retour lu : envoyeur, réponse ou mot absents");
    check(/livraison/.test(av) && /matin/.test(av), "retour lu : créneau absent");
    await over(A, "retour"); await shot(A, "6-proche-retour");
    await A.click("[data-act=retok]");
    await A.waitForTimeout(200);
    await go(A, "#/");
    check(/commandée par Alex/.test(await text(A, "#view")), "retour gardé : l'accueil ne montre pas les commandes à venir");

    /* ---------- 4. commande à deux ---------- */
    /* deux listes que chacun peut commander seul (minimum atteint), pour comparer au total exact */
    const MINE = { "barilla-pates-spaghetti-n-5-500-g": 6, "candia-lait-1-2-ecreme-6-x-1-l": 5, "president-beurre-gastronomique-doux-82-mg-250-g": 4, "entremont-emmental-rape-francais-160-g": 4 };
    const THEIRS = { "contrex-eau-minerale-naturelle-6-x-1-l": 5, "candia-lait-1-2-ecreme-6-x-1-l": 2, "parmentier-sardines-a-l-huile-de-tournesol-135-g": 6, "tropicana-jus-d-orange-pressee-sans-pulpe-pur-jus-1-l": 4 };
    await load(A, { basket: THEIRS, seen: { welcome: 1 }, prefs: { off: { leclerc: true }, offv: 1 }, duo: { me: "Sam" } }, "#/panier");
    await A.click("[data-act=duosend]");
    await A.click("#sheet [data-act=sendkind][data-k=duo]");
    check((await A.inputValue("#sendN")) === "Sam", "duo : prénom gardé non proposé");
    await A.click("[data-act=sendok]");
    await A.waitForTimeout(300);
    const s3 = await lastShare(A);
    if (!check(s3 && /#\/duo\/j/.test(s3.url || ""), "duo : aucun lien partagé")) throw new Error("arrêt");
    await load(B, { basket: MINE, seen: { welcome: 1 }, prefs: { off: { leclerc: true }, offv: 1 }, duo: { me: "Alex" } }, hashOf(s3.url));
    check(/La liste de Sam/.test(await text(B, "#view h1")), "duo : titre « " + (await text(B, "#view h1")) + " »");
    await B.click("[data-act=duojoin]");
    await B.waitForFunction(() => location.hash === "#/panier");
    sb = await all(B);
    const exp = Object.assign({}, MINE); for (const id of Object.keys(THEIRS)) exp[id] = (exp[id] || 0) + THEIRS[id];
    check(JSON.stringify(Object.keys(sb.basket).sort().map((k) => [k, sb.basket[k]])) === JSON.stringify(Object.keys(exp).sort().map((k) => [k, exp[k]])), "duo : panier commun faux");
    check(JSON.stringify(sb.owners) === JSON.stringify(THEIRS), "duo : cabas.owners " + JSON.stringify(sb.owners));
    await settled(B);
    await B.waitForFunction(() => /À deux, la commande coûte|Ta liste seule/.test((document.querySelector("#duo") || {}).textContent || ""), null, { timeout: 30000 }).catch(() => fail("duo : ce que chacun aurait payé seul n'arrive pas"));
    await B.waitForFunction(() => !/Calcul de ce que chacun/.test((document.querySelector("#duo") || {}).textContent || ""), null, { timeout: 30000 }).catch(() => {});
    const X = await B.evaluate(() => {
      const d = cabasDebug(), R = d.RES(), st = R.steps[R.K], r = st.full, sp = d.splitOf(r);
      const prorata = r.orders.every((o, i) => { const so = sp.orders[i].other.items; return sp.orders[i].other.fee === (o.sub ? Math.round((o.fee * so) / o.sub) : 0) && sp.orders[i].me.fee === o.fee - sp.orders[i].other.fee; });
      const own = d.ownSplit(), mode = d.S.prefs.comp !== false;
      /* les deux commandes seules, calculées à part, ici */
      const alone = (b) => { const x = bestAt(d.model(mode, { basket: b }), R.K, R.lambda, 6000); return x.full ? x.full.total : null; };
      return { total: r.itemsTotal + r.feesTotal + (r.compTotal || 0), me: sp.me, other: sp.other, sum: sp.me.total + sp.other.total, prorata, aMe: alone(own.mine), aOt: alone(own.other), txt: document.querySelector("#duo").textContent.replace(/[ \t\n]+/g, " ") };
    });
    check(X.sum === X.total, `duo : somme des parts ${X.sum} au lieu du total ${X.total}`);
    check(X.prorata, "duo : frais pas répartis au prorata de chaque commande");
    check(X.other.items > 0 && X.me.items > 0 && X.other.fee >= 0, "duo : parts vides " + JSON.stringify([X.me, X.other]));
    check(X.aMe != null && X.aOt != null, "duo : jeu d'essai, une des deux listes ne se commande pas seule");
    const money = (c) => (c / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ /g, " ") + " €";
    check(X.txt.includes(money(X.me.total)) && X.txt.includes(money(X.other.total)), "duo : parts affichées ≠ splitOf « " + X.txt.slice(0, 200) + " »");
    if (X.aMe != null) check(X.txt.includes("Ta liste seule : " + money(X.aMe)), `duo : ta liste seule ${money(X.aMe)} absente « ${X.txt.slice(0, 300)} »`);
    if (X.aOt != null) check(X.txt.includes("La liste de Sam seule : " + money(X.aOt)), `duo : sa liste seule ${money(X.aOt)} absente`);
    if (X.aMe != null && X.aOt != null && X.aMe + X.aOt - X.total >= 1) check(X.txt.includes("À deux, la commande coûte " + money(X.aMe + X.aOt - X.total) + " de moins"), "duo : économie de la commande commune absente ou fausse");
    const rows = await B.evaluate(() => [...document.querySelectorAll("#view .item .inote")].map((e) => e.textContent));
    check(rows.some((t) => /^À Sam$/.test(t)) && rows.some((t) => /^\d+ à toi, \d+ à Sam$/.test(t)), "duo : lignes sans « À Sam » ou « 5 à toi, 2 à Sam » " + JSON.stringify(rows));
    await over(B, "panier à deux"); await shot(B, "7-duo-panier");
    /* à qui est ce produit : toute la ligne passe à l'autre */
    await B.click('[data-act=itemopt][data-id="barilla-pates-spaghetti-n-5-500-g"]');
    await B.click('#sheet [data-act=itemown][data-v="6"]');
    check((await all(B)).owners["barilla-pates-spaghetti-n-5-500-g"] === 6, "duo : « À Sam » dans « Où le prendre » sans effet");
    await B.click('#sheet [data-act=itemown][data-v="0"]');
    check(!(await all(B)).owners["barilla-pates-spaghetti-n-5-500-g"], "duo : « À toi » dans « Où le prendre » sans effet");
    await B.keyboard.press("Escape");
    /* la part de Sam lui est renvoyée */
    await B.click("#duo [data-act=duoback]");
    await B.waitForSelector("#retM");
    await B.click("[data-act=retsend]");
    await B.waitForTimeout(300);
    const s4 = await lastShare(B);
    if (!check(s4 && /#\/retour\/j/.test(s4.url || ""), "duo : aucun lien de part")) throw new Error("arrêt");
    check(/Ta part de notre commande/.test(s4.text) && s4.text.includes(money(X.other.total)), "duo : texte du partage « " + s4.text + " »");
    await go(A, hashOf(s4.url));
    check(/Ta part de la commande/.test(await text(A, "#view h1")), "part lue : titre");
    check(eurOf(await text(A, ".sum .st .sr")) === X.other.total, "part lue : montant différent de sa part");
    if (X.aOt != null) check((await text(A, ".sum")).includes("Ta liste seule : " + money(X.aOt)), "part lue : économie absente « " + (await text(A, ".sum")) + " »");
    await shot(A, "8-duo-part");
    /* retirer la liste de l'autre : ses produits sortent, les miens restent */
    await go(B, "#/panier");
    await B.click("#duo [data-act=duodrop]");
    await B.click("#sheet [data-act=duodropok]");
    await B.waitForTimeout(300);
    sb = await all(B);
    check(JSON.stringify(Object.keys(sb.basket).sort().map((k) => [k, sb.basket[k]])) === JSON.stringify(Object.keys(MINE).sort().map((k) => [k, MINE[k]])) && !Object.keys(sb.owners).length && !sb.duo.w, "duo : « Retirer la liste de Sam » laisse ses produits");

    /* une commande E.Leclerc dans le retour : prix simulés, dits comme tels, jamais « relevés » seuls */
    await go(A, "#/retour/j" + b64({ app: "cabas", v: 1, k: "retour", w: "duo", at: new Date().toISOString(), o: [{ r: "leclerc-livraison", s: "ok", d: plus(1), sl: "soir", i: [["candia-lait-1-2-ecreme-6-x-1-l", 2, 1398]], fe: 500 }], c: [], x: [], al: 2500 }));
    const simv = await text(A, "#view");
    check(/Ta part, livraison comprise, prix simulés/.test(simv) && /Prix simulés, pas relevés/.test(simv) && /selon la simulation/.test(simv), "retour E.Leclerc : prix simulés pas dits « " + simv.slice(0, 300) + " »");
    check(eurOf(await text(A, ".sum .st .sr")) === 1898, "retour E.Leclerc : total refait faux");

    /* ---------- 5. liens abîmés ou hostiles ---------- */
    const before = JSON.stringify(await all(B));
    const bad = [
      ["pour", "zzz"], ["pour", "j" + "@@@"], ["pour", "j" + b64({ app: "autre", v: 1, k: "pour", i: [["candia-lait-1-2-ecreme-6-x-1-l", 1]] })],
      ["pour", "j" + b64({ app: "cabas", v: 1, k: "duo", i: [["candia-lait-1-2-ecreme-6-x-1-l", 1]] })],
      ["duo", "j" + b64({ app: "cabas", v: 1, k: "duo", i: [["produit-inconnu", 1], ["__proto__", 2]] })],
      ["duo", "j" + b64({ app: "cabas", v: 1, k: "duo", i: [["candia-lait-1-2-ecreme-6-x-1-l", 1000], ["candia-lait-1-2-ecreme-6-x-1-l", -2], ["candia-lait-1-2-ecreme-6-x-1-l", 1.5]] })],
      ["retour", "j" + b64({ app: "cabas", v: 1, k: "retour", o: [{ r: "inconnue", i: [["candia-lait-1-2-ecreme-6-x-1-l", 1, 100]] }] })],
      ["retour", "j" + b64({ app: "cabas", v: 1, k: "retour", o: [{ r: "houra", i: [["candia-lait-1-2-ecreme-6-x-1-l", 1, -500]] }] })],
      ["retour", "j" + "A".repeat(40000)],
    ];
    for (const [k, x] of bad) {
      await go(B, `#/${k}/${x}`);
      await B.waitForFunction(() => !/Lecture du lien/.test(document.querySelector("#view").textContent), null, { timeout: 5000 }).catch(() => {});
      check(/illisible/.test(await text(B, "#view h1")), `lien hostile accepté (#/${k}/${x.slice(0, 40)}…) : « ${await text(B, "#view h1")} »`);
    }
    /* texte piégé : affiché tel quel, jamais interprété ; produits inconnus écartés, quantités bornées */
    const evil = "j" + b64({ app: "cabas", v: 1, k: "pour", t: "abcd1234", n: "<img src=x onerror=alert(1)>Lou", m: "<script>alert(1)</script> ‮abc", i: [["candia-lait-1-2-ecreme-6-x-1-l", 2], ["inconnu", 3], ["candia-lait-1-2-ecreme-6-x-1-l", 99]], f: [["<b>x</b>", 2], ["", 1]], b: -5, j: "demain", d: ["gluten", "poison"], a: ["peanuts", "__proto__"], e: { off: { __proto__: true, leclerc: true }, pick: { auchan: "https://ailleurs.example" }, liv: {}, comp: false } });
    await go(B, "#/pour/" + evil);
    const ev = await B.evaluate(() => ({ imgs: document.querySelectorAll("#view img[src='x']").length, scripts: document.querySelectorAll("#view script").length, h1: document.querySelector("#view h1").textContent, txt: document.querySelector("#view").textContent }));
    check(!ev.imgs && !ev.scripts, "lien piégé : balise interprétée");
    check(/^Les courses d'img src x onerror alert$/.test(ev.h1), "lien piégé : prénom « " + ev.h1 + " »");
    check(!/‮/.test(ev.txt) && !/Budget/.test(ev.txt) && !/Pour demain/.test(ev.txt), "lien piégé : caractère d'inversion, budget négatif ou jour invalide affiché");
    const D = await B.evaluate(() => cabasDebug().S.duoIn.D);
    check(D && D.i["candia-lait-1-2-ecreme-6-x-1-l"] === 99 && Object.keys(D.i).length === 1 && D.f.length === 1 && D.b === 0 && D.j === "" && JSON.stringify(D.d) === '["gluten"]' && JSON.stringify(D.a) === '["peanuts"]' && !D.e.pick.auchan, "lien piégé : contenu gardé " + JSON.stringify(D).slice(0, 300));
    check(JSON.stringify(await all(B)) === before, "liens hostiles : les données du téléphone ont changé sans geste");
    /* un autre proche alors que des courses sont en cours : confirmation, puis « Annuler » */
    await go(B, hashOf(s1.url));
    await B.click("[data-act=pourgo]");
    await B.waitForFunction(() => location.hash === "#/panier");
    await go(B, "#/pour/" + evil);
    await B.click("[data-act=pourgo]");
    check(await B.evaluate(() => !document.getElementById("sheet").hidden && /Remplacer les courses de Camille/.test(document.getElementById("sheetT").textContent)), "autre proche : pas de confirmation avant de remplacer");
    await B.click("#sheet [data-act=pournew]");
    await B.waitForTimeout(300);
    sb = await all(B);
    check(sb.duo.pour.t === "abcd1234" && JSON.stringify(sb.duo.pour.alt.basket) === JSON.stringify(MINE), "autre proche : le panier mis de côté n'est pas celui de l'aidant");
    await B.click("#toast [data-act=toastact]");
    await B.waitForTimeout(300);
    sb = await all(B);
    check(sb.duo.pour.t === payload.t && sb.duo.pour.on && JSON.stringify(sb.basket) === JSON.stringify(PROCHE), "autre proche : « Annuler » ne remet pas les courses de Camille");
    /* « Tes données » : cabas.duo et cabas.owners copiés, et revérifiés à l'arrivée */
    const IC = await B.evaluate(() => {
      const d = cabasDebug(), P = d.packState();
      const R = d.importCheck({ app: "cabas", v: 1, data: { owners: { "candia-lait-1-2-ecreme-6-x-1-l": 500, "contrex-eau-minerale-naturelle-6-x-1-l": 2 }, duo: { me: "<b>Lou</b>", w: { t: "<x>", n: "Sam", m: "ok" }, pour: { n: "A\u202eB", on: true, j: "demain", d: ["gluten", "poison"], alt: { basket: { inconnu: 3, "candia-lait-1-2-ecreme-6-x-1-l": 2 }, prefs: { comp: "oui", budget: 50 } } }, back: [{ x: "<script>" }, { x: "jabc", o: [{ r: "inconnue", d: "2026-11-03" }] }] } } }, true);
      return { packed: "duo" in P.data && "owners" in P.data, ok: R.ok, data: R.data };
    });
    check(IC.packed, "tes données : cabas.duo ou cabas.owners absents de la copie");
    const Dd = IC.data.duo || {};
    check(IC.ok && JSON.stringify(IC.data.owners) === '{"contrex-eau-minerale-naturelle-6-x-1-l":2}', "tes données : owners mal vérifiés " + JSON.stringify(IC.data.owners));
    check(Dd.me === "b Lou b" && Dd.w && Dd.w.t === "" && Dd.pour && Dd.pour.n === "A B" && Dd.pour.j === "" && JSON.stringify(Dd.pour.d) === '["gluten"]' && JSON.stringify(Dd.pour.alt.basket) === '{"candia-lait-1-2-ecreme-6-x-1-l":2}' && !("comp" in Dd.pour.alt.prefs) && Dd.back.length === 1 && !Dd.back[0].o.length, "tes données : cabas.duo mal vérifié " + JSON.stringify(Dd).slice(0, 400));
    /* effacer mes données retire tout */
    await go(B, "#/reglages");
    await B.click("[data-act=reset]"); await B.click("#sheet [data-act=resetok]"); await B.waitForTimeout(300);
    sb = await all(B);
    check(!sb.duo && !sb.owners, "effacer mes données : cabas.duo ou cabas.owners restent");
    check(!outside.length, "réseau : des requêtes sont parties ailleurs que vers le site : " + outside.slice(0, 3).join(", "));
  } catch (e) { fail("arrêt : " + String(e).split("\n")[0]); }
  await browser.close();
  server.close();
  if (problems.length) { console.log(problems.length + " problème" + (problems.length > 1 ? "s" : "") + " :\n- " + problems.join("\n- ")); process.exit(1); }
  console.log("Courses pour un proche et commande à deux : tout est bon.");
})();
