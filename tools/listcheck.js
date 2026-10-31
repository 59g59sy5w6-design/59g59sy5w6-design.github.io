// Vérification de Ma liste : choix habituel mémorisé (repris d'office, ou signalé quand il est plus de 15 % plus cher,
// « Garder le mien »), quantité habituelle d'après les paniers commandés (« × 2, comme d'habitude », « Toujours 1 »),
// usualQty sur un historique fixe, orthographe (« spagetti x2 » trouve un spaghetti, « zzzz » reste sans suggestion,
// « Tu voulais dire… ? Oui »), lignes libres (« Garder quand même », panier, texte partagé, liste partagée), puis, avec le
// jeu d'essai tools/fixtures/catalog-extra.json ajouté au catalogue, les mots des nouvelles catégories (jambon, camembert,
// lessive capsules, couches, croquettes chat, vin rouge…) et « Mon régime » (rayon filtré, chip, Ma liste, réglages,
// dietOk sur 30 libellés, repas) ; « Colle ton panier » (cleanPaste sur les paniers collés de tools/fixtures/paniers-
// colles.json : site sur plusieurs lignes, courriel en colonnes, ticket de caisse, message à cases, quantités seules ;
// une liste écrite ressort telle quelle ; dans Ma liste, le montant collé est dit « d'après ce que tu as collé » et
// n'entre ni dans le catalogue ni dans un total) ; les listes toutes faites par profil (data/listes.json : forme, chaque
// ligne trouvée, chaque liste « semaine » prise en entier par une commande qui atteint son minimum ; écran Listes).
// Code de sortie 1 en cas de problème. Usage : node tools/listcheck.js
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

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split("?")[0]);
  const f = path.join(ROOT, p === "/" ? "index.html" : p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});

const b64e = (s) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const PREFS = { zip: "94120", off: { leclerc: true }, fee: {}, pick: {}, liv: {}, keep: {}, usual: {}, qty1: {}, maxOrders: 3, extraCost: 0, offv: 1 };

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/index.html`;
  const problems = [];
  const fail = (m) => problems.push(m);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block", locale: "fr-FR" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => fail("erreur JS : " + e.message));
  page.on("console", (m) => { if (m.type() === "error") fail("console : " + m.text()); });
  const ready = () => page.waitForFunction(() => !document.querySelector("#view .sk") && document.querySelector("#view .wrap > *"), null, { timeout: 20000 });
  const stored = (k) => page.evaluate((k) => JSON.parse(localStorage.getItem("cabas." + k) || "null"), k);
  const toastText = () => page.evaluate(() => { const t = document.getElementById("toast"); return t.hidden ? "" : t.textContent; });
  /* pose l'état, recharge Ma liste et lance la recherche des produits pour un texte donné */
  const runList = async (text, state) => {
    await page.evaluate((st) => { localStorage.setItem("cabas.prefs", JSON.stringify(st.prefs)); localStorage.setItem("cabas.hist", JSON.stringify(st.hist || [])); localStorage.setItem("cabas.free", JSON.stringify(st.free || {})); localStorage.setItem("cabas.basket", "{}"); localStorage.setItem("cabas.seen", JSON.stringify({ welcome: 1 })); localStorage.setItem("cabas.draft", ""); }, state);
    await page.goto(base + "#/ecrire"); await page.reload(); await ready();
    await page.fill("#wlIn", text);
    await page.click('[data-act="wlgo"]');
    await page.waitForTimeout(500);
    return page.evaluate(() => cabasDebug().S.wl.lines.map((x) => ({ raw: x.raw, q: x.q, n: x.n, pick: x.pick, usual: !!x.usual, usualAlt: x.usualAlt || null, why: x.why || null, sugg: x.sugg || null, free: x.free || null })));
  };
  const overflow = async (name) => { const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); if (over > 0) fail(`${name} : déborde de ${over} px en largeur`); };
  try {
    await page.goto(base + "#/ecrire"); await ready();
    /* le produit retenu pour « lait » et, parmi les candidats, un produit nettement plus cher à l'unité (prix relevés) */
    const L0 = await page.evaluate(() => {
      const D = cabasDebug(), M = D.matchLine(D.parseLine("lait")), P = D.S.prods, u = (id) => { const p = P.get(id), b = D.bestReal(p); return b ? D.perUnit(p, b.price) : null; };
      const ref = u(M.pick);
      const dear = M.cands.map((id) => [id, u(id)]).filter(([id, v]) => id !== M.pick && v != null && ref != null && v > ref * 1.25).sort((a, b) => a[1] - b[1])[0];
      return { pick: M.pick, dear: dear ? dear[0] : null, rayon: P.get(M.pick).r };
    });
    if (!L0.pick) fail("« lait » ne trouve aucun produit");
    if (!L0.dear) fail("« lait » : aucun candidat 25 % plus cher à l'unité pour le test du choix habituel");

    /* 1. choix habituel au bon prix : repris d'office, dit dans la ligne */
    let lines = await runList("lait", { prefs: Object.assign({}, PREFS, { usual: { lait: { id: L0.pick, at: "2026-10-01" } } }) });
    if (!lines[0] || lines[0].pick !== L0.pick || !lines[0].usual) fail("choix habituel : la ligne « lait » ne reprend pas le produit mémorisé");
    let small = await page.locator(".item.wli small").first().textContent();
    if (!/ton choix habituel/.test(small)) fail(`choix habituel : la ligne ne dit pas « ton choix habituel » (« ${small.trim()} »)`);
    await overflow("Ma liste, choix habituel");

    /* 2. choix habituel trop cher : le moins cher d'office, « Garder le mien » pour le reprendre */
    if (L0.dear) {
      lines = await runList("lait", { prefs: Object.assign({}, PREFS, { usual: { lait: { id: L0.dear, at: "2026-10-01" } } }) });
      if (!lines[0] || lines[0].pick === L0.dear) fail("choix habituel trop cher : il est repris malgré l'écart de prix");
      if (!lines[0] || !lines[0].usualAlt || lines[0].usualAlt.id !== L0.dear) fail("choix habituel trop cher : usualAlt absent");
      const note = (await page.locator(".item.wli .it").first().textContent()) || "";
      if (!/Ton habituel est à/.test(note) || !/moins cher/.test(note)) fail(`choix habituel trop cher : la ligne ne le dit pas (« ${note.trim().slice(0, 120)} »)`);
      if (!(await page.locator('[data-act="wlusual"]').count())) fail("choix habituel trop cher : pas de « Garder le mien »");
      else {
        await page.click('[data-act="wlusual"]');
        await page.waitForTimeout(300);
        const after = await page.evaluate(() => { const x = cabasDebug().S.wl.lines[0]; return { pick: x.pick, usual: !!x.usual }; });
        if (after.pick !== L0.dear || !after.usual) fail("« Garder le mien » ne reprend pas le produit habituel");
      }
    }

    /* 3. quantité habituelle : « lait » à 2 dans trois paniers commandés ; « Toujours 1 » ramène à 1 */
    const hist = [1, 2, 3].map((i) => ({ d: `2026-09-0${i}`, t: 5000, s: 300, n: 5, o: ["Houra"], items: { [L0.pick]: 2 }, when: [] }));
    lines = await runList("lait", { prefs: PREFS, hist });
    if (!lines[0] || lines[0].n !== 2 || lines[0].why !== "habit") fail(`quantité habituelle : n=${lines[0] && lines[0].n}, why=${lines[0] && lines[0].why}`);
    const it = (await page.locator(".item.wli .it").first().textContent()) || "";
    if (!/2, comme d'habitude/.test(it)) fail(`quantité habituelle : la ligne ne dit pas « × 2, comme d'habitude » (« ${it.trim().slice(0, 120)} »)`);
    if (!(await page.locator('[data-act="wlqty1"]').count())) fail("quantité habituelle : pas de « Toujours 1 »");
    else {
      await page.click('[data-act="wlqty1"]');
      await page.waitForTimeout(300);
      const n1 = await page.evaluate(() => cabasDebug().S.wl.lines[0].n), q1 = (await stored("prefs")).qty1 || {};
      if (n1 !== 1) fail("« Toujours 1 » ne ramène pas la quantité à 1");
      if (q1[L0.rayon] !== 1) fail("« Toujours 1 » n'est pas mémorisé dans prefs.qty1");
    }
    /* une quantité écrite n'est jamais remplacée */
    lines = await runList("3 lait", { prefs: PREFS, hist });
    if (!lines[0] || lines[0].n !== 3 || lines[0].why) fail("une quantité écrite (« 3 lait ») est remplacée par l'habitude");
    /* usualQty sur un historique fixe : médiane, foyer, « toujours 1 » */
    const uq = await page.evaluate((pick) => {
      const D = cabasDebug(), S = D.S, p = S.prods.get(pick), r = p.r;
      const was = { hist: S.hist, foyer: S.prefs.foyer, qty1: S.prefs.qty1 };
      const out = {};
      S.hist = [1, 2, 3, 4].map((i) => ({ items: { [pick]: [1, 3, 3, 9][i - 1] } })); S.prefs.qty1 = {};
      out.median = D.usualQty(p);
      S.hist = [{ items: { [pick]: 5 } }];
      S.prefs.foyer = 4; out.foyer4 = D.usualQty(p);
      S.prefs.foyer = 1; out.foyer1 = D.usualQty(p);
      S.prefs.foyer = 0; out.none = D.usualQty(p);
      S.prefs.foyer = 6; S.prefs.qty1 = { [r]: 1 }; out.qty1 = D.usualQty(p);
      S.hist = was.hist; S.prefs.foyer = was.foyer; S.prefs.qty1 = was.qty1;
      return out;
    }, L0.pick);
    if (uq.median.n !== 3 || uq.median.why !== "habit") fail(`usualQty : médiane attendue 3 (habit), obtenu ${JSON.stringify(uq.median)}`);
    if (uq.foyer4.n !== 2 || uq.foyer4.why !== "foyer") fail(`usualQty : 4 personnes, lait, attendu 2 (foyer), obtenu ${JSON.stringify(uq.foyer4)}`);
    if (uq.foyer1.n !== 1) fail(`usualQty : 1 personne, attendu 1, obtenu ${JSON.stringify(uq.foyer1)}`);
    if (uq.none.n !== 1 || uq.none.why) fail(`usualQty : sans foyer ni historique, attendu 1, obtenu ${JSON.stringify(uq.none)}`);
    if (uq.qty1.n !== 1 || uq.qty1.why) fail(`usualQty : « toujours 1 », obtenu ${JSON.stringify(uq.qty1)}`);

    /* 4. orthographe : « spagetti x2 » trouve un spaghetti ; « zzzz » reste sans produit ni suggestion ; « spagheti » propose */
    lines = await runList("spagetti x2\nzzzz\nspagheti", { prefs: PREFS });
    const sp = lines[0];
    const nm = sp && sp.pick ? await page.evaluate((id) => { const p = cabasDebug().S.prods.get(id); return (p.brand + " " + p.name).toLowerCase(); }, sp.pick) : "";
    if (!sp || !sp.pick || !/spaghetti/.test(nm) || sp.n !== 2) fail(`« spagetti x2 » : produit « ${nm} », quantité ${sp && sp.n}`);
    const zz = lines[1];
    if (!zz || zz.pick || zz.sugg) fail("« zzzz » devrait rester sans produit ni suggestion");
    const miss = page.locator(".item.wli.miss").first();
    if (!(await miss.count()) || !/Pas encore dans Cabas/.test(await miss.textContent())) fail("« zzzz » : pas de ligne « Pas encore dans Cabas »");
    if (await miss.locator('[data-act="wlfix"]').count()) fail("« zzzz » : une suggestion est proposée");
    const sg = lines[2];
    if (!sg || sg.pick || sg.sugg !== "spaghetti") fail(`« spagheti » : suggestion attendue « spaghetti », obtenu ${sg && JSON.stringify(sg.sugg)}`);
    else {
      const fixRow = page.locator(".item.wli.miss").nth(1);
      if (!/Tu voulais dire/.test(await fixRow.textContent())) fail("« spagheti » : la ligne ne demande pas « Tu voulais dire… ? »");
      await fixRow.locator('[data-act="wlfix"]').click();
      await page.waitForTimeout(400);
      const fixed = await page.evaluate(() => { const x = cabasDebug().S.wl.lines[2]; return { pick: x.pick, raw: x.raw, text: cabasDebug().S.wl.text }; });
      if (!fixed.pick || fixed.raw !== "spaghetti") fail(`« Oui » : la ligne corrigée ne trouve pas de produit (${JSON.stringify(fixed)})`);
      if (!/spaghetti/.test(fixed.text) || /spagheti\b/.test(fixed.text)) fail("« Oui » : le brouillon n'est pas corrigé");
    }

    /* 5. ligne libre : « piles alcalines », « Garder quand même », prix et enseigne, panier, texte partagé */
    lines = await runList("piles alcalines\nlait", { prefs: PREFS });
    if (!lines[0] || lines[0].pick) fail("« piles alcalines » trouve un produit : choisir une autre ligne absente du catalogue pour ce test");
    const keep = page.locator('[data-act="wlfree"]');
    if (!(await keep.count())) fail("ligne absente : pas de « Garder quand même »");
    await keep.first().click();
    await page.waitForTimeout(450);
    const title = await page.evaluate(() => (document.getElementById("sheetT") || {}).textContent || "");
    if (title !== "Ligne libre") fail(`feuille « Ligne libre » attendue, obtenu « ${title} »`);
    if (!(await page.locator("#sheet #freeT").count()) || !(await page.locator("#sheet #freeP").count())) fail("feuille « Ligne libre » : champs texte et prix absents");
    await page.click('#sheet [data-act="freeinc"]');
    await page.fill("#freeP", "1,20");
    const chip = page.locator('#sheet [data-act="freeret"][data-v="carrefour"]');
    if (!(await chip.count())) fail("feuille « Ligne libre » : pas de pastille « Chez Carrefour »");
    else await chip.click();
    await page.waitForTimeout(200);
    const qv = await page.evaluate(() => document.querySelector("#freeP").value);
    if (qv !== "1,20") fail(`le prix tapé ne survit pas au choix de l'enseigne (« ${qv} »)`);
    await page.click('#sheet [data-act="freeok"]');
    await page.waitForTimeout(400);
    const free = (await stored("free")) || {}, fids = Object.keys(free);
    if (fids.length !== 1) fail(`cabas.free devrait avoir une entrée, en a ${fids.length}`);
    else {
      const f = free[fids[0]];
      if (f.t !== "piles alcalines" || f.q !== 2 || f.price !== 1.2 || f.ret !== "carrefour") fail("cabas.free : entrée inattendue " + JSON.stringify(f));
    }
    const frow = page.locator(".item.wli.free");
    if (!(await frow.count())) fail("Ma liste : la ligne n'est pas devenue une ligne libre");
    else {
      const ft = await frow.textContent();
      if (!/prix saisi par toi/.test(ft) || !/chez Carrefour/.test(ft) || !/Ligne libre/.test(ft)) fail(`ligne libre : texte « ${ft.trim().slice(0, 120)} »`);
    }
    const sub = await page.locator(".lt-sub").first().textContent();
    if (!/1\u00a0ligne libre/.test(sub)) fail(`Ma liste : le sous-titre ne compte pas la ligne libre (« ${sub} »)`);
    await overflow("Ma liste, ligne libre");
    /* le panier (vide de produits) montre la section, son total à part, et le texte partagé la liste « À chercher » */
    await page.goto(base + "#/panier"); await ready();
    await page.waitForTimeout(300);
    const box = page.locator(".order.freebox");
    if (!(await box.count())) fail("panier : section « Tes lignes libres » absente");
    else {
      const bt = await box.textContent();
      if (!/piles alcalines/.test(bt) || !/2,40/.test(bt) || !/prix saisi par toi/.test(bt) || !/non compris dans le total/.test(bt)) fail(`panier : section lignes libres « ${bt.trim().replace(/\s+/g, " ").slice(0, 160)} »`);
    }
    if (!/Rien à commander en ligne/.test(await page.locator("#view").textContent())) fail("panier vide avec lignes libres : titre inattendu");
    const ct = await page.evaluate(() => cabasDebug().cartText());
    if (!/À chercher :/.test(ct) || !/2 x piles alcalines/.test(ct) || !/prix saisi par toi/.test(ct)) fail("cartText : pas de section « À chercher »\n" + ct);
    await overflow("panier, lignes libres");
    /* retirer puis « Annuler » */
    await page.click('.freebox [data-act="freedec"]');
    await page.waitForTimeout(300);
    await page.click('.freebox [data-act="freedec"]');
    await page.waitForTimeout(300);
    if (Object.keys((await stored("free")) || {}).length) fail("ligne libre : le stepper à zéro ne la retire pas");
    if (!/Annuler/.test(await toastText())) fail("ligne libre retirée : pas d'« Annuler »");
    await page.click("#toast button");
    await page.waitForTimeout(400);
    if (Object.keys((await stored("free")) || {}).length !== 1) fail("ligne libre : « Annuler » ne la remet pas");
    /* liste partagée avec une ligne libre : affichée, puis ajoutée au panier (la quantité s'ajoute à la ligne déjà là) */
    const link = "#/partage/" + b64e(JSON.stringify({ n: "Liste test", i: [], f: [["piles alcalines", 3], ["<b>x</b>", 1]] }));
    await page.goto(base + link); await ready();
    await page.waitForTimeout(300);
    const pt = await page.locator("#view").textContent();
    if (!/Lignes libres/.test(pt) || !/piles alcalines/.test(pt) || !/2\u00a0lignes libres/.test(pt)) fail("liste partagée : lignes libres absentes");
    if (await page.locator("#view b").filter({ hasText: /^x$/ }).count()) fail("liste partagée : le texte d'une ligne libre n'est pas échappé");
    await page.click('[data-act="addshared"]');
    await page.waitForTimeout(300);
    const free2 = (await stored("free")) || {};
    const lev = Object.values(free2).find((f) => f.t === "piles alcalines");
    if (!lev || lev.q !== 4 || Object.keys(free2).length !== 2) fail("liste partagée : les lignes libres ne rejoignent pas le panier comme attendu : " + JSON.stringify(free2));
    /* une enseigne désactivée après coup : la ligne revient à « peu importe » */
    await page.goto(base + "#/reglages"); await ready();
    await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('input[data-act="ret"][data-id="carrefour"]').click());
    await page.waitForTimeout(300);
    const free3 = (await stored("free")) || {};
    if (Object.values(free3).some((f) => f.ret === "carrefour")) fail("enseigne désactivée : la ligne libre garde cette enseigne");
    if (!/peu importe/.test(await toastText())) fail("enseigne désactivée : pas de toast « peu importe »");
    await overflow("réglages");
    /* « Mes choix habituels » dans les réglages ouvre la feuille et « Tout oublier » vide usual et keep */
    await page.evaluate((pick) => { const p = JSON.parse(localStorage.getItem("cabas.prefs")); p.usual = { lait: { id: pick, at: "2026-10-01" } }; p.keep = { [pick]: 1 }; localStorage.setItem("cabas.prefs", JSON.stringify(p)); }, L0.pick);
    await page.reload(); await ready();
    await page.click('[data-act="usual"]');
    await page.waitForTimeout(450);
    const ut = await page.evaluate(() => document.querySelector("#sheet .sheet").textContent);
    if (!/Mes choix habituels/.test(ut) || !/Marques gardées/.test(ut) || !/lait/.test(ut)) fail("feuille « Mes choix et mes marques » incomplète");
    await page.click('[data-act="usualreset"]');
    await page.waitForTimeout(400);
    const pr = await stored("prefs");
    if (Object.keys(pr.usual || {}).length || Object.keys(pr.keep || {}).length) fail("« Tout oublier » ne vide pas usual et keep");
    if (!/Annuler/.test(await toastText())) fail("« Tout oublier » : pas d'« Annuler »");

    /* ---- catalogue étendu : jeu d'essai (tools/fixtures/catalog-extra.json, rayons et produits inventés) ajouté au
       catalogue chargé, pour les mots des nouvelles catégories et le régime ---- */
    const extra = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "fixtures", "catalog-extra.json"), "utf8"));
    const withExtra = async (prefs) => {
      await page.evaluate((st) => { localStorage.setItem("cabas.prefs", JSON.stringify(st)); localStorage.setItem("cabas.hist", "[]"); localStorage.setItem("cabas.basket", "{}"); localStorage.setItem("cabas.seen", JSON.stringify({ welcome: 1 })); }, prefs);
      await page.goto(base + "#/"); await page.reload(); await ready();
      await page.evaluate((x) => cabasDebug().merge(x), extra);
    };
    await withExtra(PREFS);
    const WORDS = [["jambon", "jambon-blanc", /jambon blanc/i], ["camembert", "fromages-pate-molle", /^Camembert$/], ["lessive capsules", "lessive-capsules-poudre", /capsules/i], ["couches", "couches", /^Couches taille 4$/], ["croquettes chat", "croquettes-chat", /adulte/i], ["vin rouge", "vin-rouge", /rouge/i], ["bière blonde x6", "bieres", /^Bière blonde$/], ["chips", "chips", /nature/i], ["saucisson", "saucisson", /saucisson/i], ["dentifrice", "dentifrice", /dentifrice/i], ["pain", "pain", /baguette/i], ["camenbert", "fromages-pate-molle", /^Camembert$/]];
    const got = await page.evaluate((qs) => { const D = cabasDebug(); return D.readList(qs.join("\n")).map((x) => { const p = x.pick && D.S.prods.get(x.pick); return { raw: x.raw, r: p ? p.r : null, name: p ? p.name : null, n: x.n }; }); }, WORDS.map((w) => w[0]));
    WORDS.forEach(([q, r, re], i) => { const g = got[i]; if (!g || g.r !== r || !re.test(g.name || "")) fail(`Ma liste « ${q} » : attendu rayon ${r} et ${re}, obtenu ${g ? g.r + " / " + g.name : "rien"}`); });
    if (got[6] && got[6].n !== 1) fail("« bière blonde x6 » : un pack de 6 attendu en quantité 1, obtenu " + got[6].n);
    const top = await page.evaluate(() => { const D = cabasDebug(); return ["vin rouge", "croquettes chat", "jambon"].map((q) => { const r = D.searchScored(q)[0]; return r ? r[1].r : null; }); });
    if (top[0] !== "vin-rouge" || top[1] !== "croquettes-chat" || !/jambon/.test(top[2] || "")) fail("recherche : premiers résultats " + JSON.stringify(top));
    /* « Mon régime » halal : le rayon jambon ne montre que les produits étiquetés, la chip se décoche, Ma liste suit */
    await withExtra(Object.assign({}, PREFS, { diet: { halal: true } }));
    await page.evaluate(() => { location.hash = "#/rayon/jambon-blanc"; });
    await page.waitForTimeout(400);
    let cards = await page.locator("#view .card").count();
    if (cards !== 1) fail(`régime halal : ${cards} cartes dans le rayon jambon, 1 attendue`);
    if (!/correspond.*ton régime/.test(await page.locator("#view .count").textContent().catch(() => ""))) fail("régime halal : le nombre de produits conformes n'est pas dit");
    const dchip = page.locator('[data-act="quick"][data-q="diet"]');
    if ((await dchip.getAttribute("aria-pressed")) !== "true") fail("régime : la chip « Mon régime » n'est pas pressée par défaut");
    await dchip.click(); await page.waitForTimeout(300);
    cards = await page.locator("#view .card").count();
    if (cards !== 4) fail(`régime halal décoché : ${cards} cartes, 4 attendues`);
    const dl = await page.evaluate(() => { const D = cabasDebug(); return D.readList("jambon\ncamembert").map((x) => ({ pick: x.pick, miss: !!x.dietMiss })); });
    if (!dl[0] || !/halal/.test(dl[0].pick) || dl[0].miss) fail("régime halal, Ma liste « jambon » : " + JSON.stringify(dl[0]));
    if (!dl[1] || !dl[1].pick || !dl[1].miss) fail("régime halal, Ma liste « camembert » : le repli sans filtre n'est pas signalé : " + JSON.stringify(dl[1]));
    await page.evaluate(() => { location.hash = "#/reglages"; }); await page.waitForTimeout(400);
    const rv = await page.locator('[data-act="diet"] .val').textContent();
    if (!/halal/.test(rv)) fail("réglages : « Mon régime » n'affiche pas « halal » (" + rv + ")");
    await page.click('[data-act="diet"]'); await page.waitForTimeout(450);
    const dchips = await page.locator("#sheet .dietchip").count(), pressed = await page.locator('#sheet .dietchip[aria-pressed="true"]').textContent();
    if (dchips !== 10) fail(`feuille « Mon régime » : ${dchips} choix, 10 attendus`);
    if (!/Halal/.test(pressed) || !/produit/.test(pressed)) fail("feuille « Mon régime » : la chip cochée ne compte pas ses produits (" + pressed + ")");
    await page.click('#sheet .dietchip[data-k="gluten"]'); await page.waitForTimeout(300);
    const pd = (await stored("prefs")).diet || {};
    if (!pd.gluten || !pd.halal) fail("feuille « Mon régime » : le choix n'est pas mémorisé : " + JSON.stringify(pd));
    await page.click('#sheet .sheet-h [data-act="close"]'); await page.waitForTimeout(300);
    /* dietOk sur des libellés fixes : exclusions sur les mots, étiquettes exigées pour les régimes positifs */
    const DK = await page.evaluate(() => {
      const D = cabasDebug(), P = (name, r, regimes, tags, u) => ({ name, r, regimes: regimes || [], tags: tags || [], u: u || "" });
      const T = [
        [P("Jambon blanc", "jambon-blanc"), { pork: true }, false], [P("Jambon de dinde", "jambon-blanc"), { pork: true }, true], [P("Rillettes de porc", "pates-rillettes"), { pork: true }, false], [P("Saucisses de volaille", "saucisses-boudins"), { pork: true }, true], [P("Lardons fumés", "lardons"), { pork: true }, false], [P("Pizza sans porc", "pizzas-surgelees"), { pork: true }, true],
        [P("Steak haché", "viande-hachee"), { veg: true }, false], [P("Thon au naturel", "thon"), { veg: true }, false], [P("Riz basmati", "riz"), { veg: true }, true], [P("Galettes de soja", "traiteur-vegetal", ["vegetarien"]), { veg: true }, true], [P("Nuggets de poulet", "volaille"), { veg: true }, false], [P("Yaourt nature", "yaourts"), { veg: true }, true],
        [P("Bordeaux rouge", "vin-rouge", [], [], "cave"), { alcohol: true }, false], [P("Bière blonde", "bieres", [], [], "cave"), { alcohol: true }, false], [P("Bière sans alcool", "cidres-sans-alcool", [], [], "cave"), { alcohol: true }, false], [P("Vinaigre de vin", "vinaigre-vinaigrette"), { alcohol: true }, true], [P("Jus de pomme", "jus-autres"), { alcohol: true }, true], [P("Sauce au vin blanc", "sauces-chaudes"), { alcohol: true }, false],
        [P("Pâtes", "pates"), { gluten: true }, false], [P("Pâtes de riz", "pates", ["sans-gluten"]), { gluten: true }, true], [P("Lait demi-écrémé", "lait"), { lactose: true }, false], [P("Lait sans lactose", "lait", ["sans-lactose"]), { lactose: true }, true],
        [P("Jambon de volaille halal", "jambon-blanc", ["halal"]), { halal: true }, true], [P("Jambon blanc", "jambon-blanc"), { halal: true }, false], [P("Poulet casher", "volaille", ["casher"]), { kosher: true }, true], [P("Poulet", "volaille"), { kosher: true }, false],
        [P("Boisson à l'amande", "boissons-vegetales", ["vegan", "vegetarien"]), { vegan: true }, true], [P("Yaourt nature", "yaourts"), { vegan: true }, false], [P("Jus d'orange sans sucres ajoutés", "jus", [], ["Sans sucres ajoutés"]), { sugar: true }, true], [P("Jus d'orange", "jus"), { sugar: true }, false],
      ];
      return T.map(([p, d, want]) => [p.name, JSON.stringify(d), D.dietOk(p, d), want]).filter((x) => x[2] !== x[3]);
    });
    if (DK.length) fail("dietOk : " + DK.map((x) => `${x[0]} ${x[1]} donne ${x[2]}`).join(" ; "));
    /* repas : avec un régime végétarien, une recette au thon est « pas pour ton régime », toujours ouvrable */
    await withExtra(Object.assign({}, PREFS, { diet: { veg: true } }));
    await page.evaluate(() => { location.hash = "#/repas"; }); await page.waitForTimeout(600);
    const bad = await page.evaluate(() => { const D = cabasDebug(), rc = D.S.recs.find((x) => x.id === "pates-thon-tomate"); return rc ? D.recCost(rc).bad.map((x) => x.g.q) : null; });
    if (!bad || !bad.includes("thon")) fail("régime végétarien : le thon de la recette n'est pas signalé : " + JSON.stringify(bad));
    const rt = await page.locator("#view").textContent();
    if (!/Pas pour ton régime/.test(rt)) fail("régime végétarien : la liste des repas ne dit pas « Pas pour ton régime »");
    await page.evaluate(() => { location.hash = "#/repas/pates-thon-tomate"; }); await page.waitForTimeout(500);
    if (!/Pas pour ton régime/.test(await page.locator("#view").textContent())) fail("régime végétarien : la recette n'avertit pas sur le thon");
    await overflow("recette, régime");

    /* Colle ton panier : chaque format de tools/fixtures/paniers-colles.json */
    const PC = JSON.parse(require("fs").readFileSync(path.join(__dirname, "fixtures", "paniers-colles.json"), "utf8"));
    await page.evaluate((st) => { localStorage.clear(); localStorage.setItem("cabas.prefs", JSON.stringify(st)); localStorage.setItem("cabas.seen", JSON.stringify({ welcome: 1 })); }, PREFS);
    await page.goto(base + "#/ecrire"); await page.reload(); await ready();
    const norm = (t) => String(t).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/œ/g, "oe").replace(/[^a-z0-9]+/g, " ").trim();
    for (const c of PC.cas) {
      const C = await page.evaluate((t) => { const D = cabasDebug(), C = D.cleanPaste(t); return { paste: C.paste, total: C.total, from: C.from, lines: C.lines.map((x) => ({ t: x.t, n: x.n })), found: D.readList(C.text).filter((x) => x.pick).length }; }, c.text);
      if (!C.paste) fail(`panier collé ${c.k} : pas reconnu comme un panier collé`);
      if (C.lines.length !== c.want.length) fail(`panier collé ${c.k} : ${C.lines.length} lignes gardées, ${c.want.length} attendues (${C.lines.map((x) => x.t).join(" | ")})`);
      c.want.forEach(([w, n], i) => { const L = C.lines[i]; if (!L || !norm(L.t).includes(w) || L.n !== n) fail(`panier collé ${c.k}, ligne ${i + 1} : ${JSON.stringify(L)}, « ${w} » × ${n} attendu`); });
      if (C.total !== c.total) fail(`panier collé ${c.k} : total ${C.total}, ${c.total} attendu`);
      if (C.from !== c.from) fail(`panier collé ${c.k} : enseigne ${C.from}, ${c.from} attendue`);
      if (C.found < Math.ceil(c.want.length * 0.75)) fail(`panier collé ${c.k} : ${C.found} lignes trouvées dans le catalogue sur ${c.want.length}`);
    }
    const typed = await page.evaluate((t) => { const C = cabasDebug().cleanPaste(t); return { paste: C.paste }; }, PC.ecrite);
    if (typed.paste) fail("liste écrite à la main : prise pour un panier collé, elle doit ressortir telle quelle");
    /* dans Ma liste : le panier collé est nettoyé, son montant dit à part, jamais compté ni mis au catalogue */
    const site = PC.cas[0], before = await page.evaluate(() => { const D = cabasDebug(); return D.S.list.slice(0, 400).map((p) => (D.best(p) || {}).price || 0).join(); });
    await page.fill("#wlIn", site.text);
    await page.click('[data-act="wlgo"]'); await page.waitForTimeout(700);
    const pb = await page.locator("#view .banner").first().textContent();
    if (!/Panier collé de Carrefour/.test(pb) || !/4\s+produits lus/.test(pb) || !/25,52\s€ d'après ce que tu as collé/.test(pb)) fail("Ma liste, panier collé : « " + pb + " »");
    const draft = await stored("draft");
    if (/€|Valider|Supprimer|Quantité/.test(draft || "")) fail("Ma liste, panier collé : le brouillon garde le bruit du site « " + draft + " »");
    const dockT = await page.locator(".dock .mini").textContent().catch(() => "");
    if (/25,52/.test(dockT)) fail("Ma liste, panier collé : le montant collé ne doit pas devenir le total « " + dockT + " »");
    const after = await page.evaluate(() => { const D = cabasDebug(); return D.S.list.slice(0, 400).map((p) => (D.best(p) || {}).price || 0).join(); });
    if (before !== after) fail("Ma liste, panier collé : des prix du catalogue ont changé");
    await overflow("Ma liste, panier collé");

    /* listes toutes faites par profil */
    const LJ = await page.evaluate(() => fetch("data/listes.json").then((r) => r.json()));
    const pk = new Set((LJ.profils || []).map((p) => p.k));
    if (pk.size < 5 || pk.size !== (LJ.profils || []).length) fail("listes.json : profils manquants ou en double");
    for (const want of ["etudiant", "famille", "senior", "petitbudget", "vegetarien"]) if (!pk.has(want)) fail("listes.json : profil " + want + " absent");
    const lk = new Set();
    for (const L of LJ.listes || []) {
      if (!L.k || lk.has(L.k) || !pk.has(L.base) || !["semaine", "appoint"].includes(L.kind) || !L.label || !L.text) fail("listes.json : liste mal formée " + JSON.stringify(L).slice(0, 120));
      lk.add(L.k);
      if (/\u2014/.test(L.label + L.text)) fail("listes.json : tiret cadratin dans " + L.k);
      const r = await page.evaluate((text) => { const D = cabasDebug(), lines = D.readList(text), plan = D.listPlan(lines); return { n: lines.length, miss: lines.filter((x) => !x.pick).map((x) => x.raw), plan: plan && { short: !!plan.short, covered: plan.covered, n: plan.n, total: plan.total, orders: (plan.orders || []).length } }; }, L.text);
      if (r.miss.length) fail(`liste ${L.k} : lignes sans produit ${JSON.stringify(r.miss)}`);
      if (L.kind === "semaine" && (!r.plan || r.plan.short || r.plan.covered !== r.plan.n)) fail(`liste ${L.k} : la liste devrait se commander en entier, minimum atteint (${JSON.stringify(r.plan)})`);
    }
    await page.evaluate(() => { location.hash = "#/listes"; }); await page.waitForTimeout(800);
    if ((await page.locator("#profs [data-act=prof]").count()) !== pk.size) fail("écran Listes : une pastille par profil attendue");
    await page.click('#profs [data-act=prof][data-k="famille"]'); await page.waitForTimeout(300);
    if ((await page.getAttribute('#profs [data-act=prof][data-k="famille"]', "aria-checked")) !== "true") fail("écran Listes : le profil Famille n'est pas choisi");
    const famRows = await page.locator("#profs [data-act=wlprof]").count();
    if (famRows !== LJ.listes.filter((x) => x.base === "famille").length) fail(`écran Listes, Famille : ${famRows} listes`);
    await page.click('#profs [data-act=wlprof] >> nth=0'); await page.waitForTimeout(800);
    const nl = await page.evaluate(() => (cabasDebug().S.wl.lines || []).length);
    if (!/#\/ecrire$/.test(page.url()) || nl < 10) fail(`liste toute faite : Ma liste attendue avec ses lignes (${page.url()}, ${nl})`);
    await overflow("liste toute faite");
  } catch (e) {
    fail("parcours interrompu : " + e.message.split("\n")[0]);
  }
  await browser.close();
  server.close();
  if (problems.length) { console.log("Problèmes :\n- " + problems.join("\n- ")); process.exit(1); }
  console.log("Ma liste (choix habituels, quantités, orthographe, lignes libres, nouvelles catégories, régime, panier collé, listes par profil) : aucun problème.");
})();
