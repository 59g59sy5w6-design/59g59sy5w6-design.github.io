// Vérification de la recherche : orthographe tolérante et complétion (trente fautes courantes rapprochées du bon mot,
// un mot qui a des résultats jamais corrigé, « yaourth », « lqit », la rangée de suggestions), puis « Demande à Cabas » :
// trente phrases et ce qu'askParse doit en comprendre (produit, quantité, prix plafond, tri, régime, personnes,
// enseigne, liste composée, question de frais), les résultats qui respectent la demande, la phrase « J'ai compris »,
// « Pas ça ? », la liste composée et le guide des frais (#/frais, feeGap). Tout se passe sur le téléphone : aucune
// requête hors du site pendant les demandes. Code de sortie 1 en cas de problème. Usage : node tools/askcheck.js
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

/* « Demande à Cabas » : la phrase et ce qui doit en être compris (champs d'askParse ; ret « auchan* » : l'option Auchan
   retenue, quelle qu'elle soit). say : morceau attendu dans la phrase « J'ai compris ». */
const ASKS = [
  ["pâtes complètes le moins cher au kilo", { kind: "product", q: "pates completes", sort: "unite", say: "pâtes complètes, le moins cher au kilo" }],
  ["lait à moins de 1 €", { kind: "product", q: "lait", max: 1, say: "lait, à moins de 1 €" }],
  ["café moins de 5 euros", { kind: "product", q: "cafe", max: 5 }],
  ["café moins de 20 euros le kilo", { kind: "product", q: "cafe", max: 20, maxUnit: "kg", say: "à moins de 20 € le kilo" }],
  ["2 kg de riz", { kind: "product", q: "riz", size: "2000g", smart: true }],
  ["6 oeufs", { kind: "product", q: "oeufs", n: 6, smart: true }],
  ["coca zéro x3", { kind: "product", q: "coca zero", n: 3 }],
  ["yaourt sans lactose", { kind: "product", q: "yaourt", diet: "lactose", say: "sans lactose" }],
  ["pâtes sans gluten pas cher", { kind: "product", q: "pates", diet: "gluten", sort: "unite", say: "le moins cher au kilo ou au litre" }],
  ["huile d'olive au litre", { kind: "product", q: "huile olive", sort: "unite", say: "le moins cher au litre" }],
  ["beurre bio", { kind: "product", q: "beurre", diet: "bio" }],
  ["jambon halal", { kind: "product", q: "jambon", diet: "halal" }],
  ["lessive à moins de 10 euros le moins cher", { kind: "product", q: "lessive", max: 10, sort: "unite" }],
  ["lqit moins de 2 euros", { kind: "product", q: "lait", max: 2, say: "tu as écrit « lqit »" }],
  ["chips au kilo pas cher", { kind: "product", q: "chips", sort: "unite" }],
  ["lait pour 4 personnes", { kind: "product", q: "lait", people: 4, say: "pour 4 personnes" }],
  ["lait chez Houra", { kind: "product", q: "lait", ret: "houra", say: "chez Houra" }],
  ["le plus cher des champagnes", { kind: "product", q: "champagnes", sort: "prixdesc" }],
  ["je cherche du papier toilette pas cher s'il te plaît", { kind: "product", q: "papier toilette", sort: "unite" }],
  ["lait", { kind: "product", q: "lait", smart: false }],
  ["c'est combien la livraison chez Houra ?", { kind: "fees", ret: "houra", say: "les frais de livraison chez Houra" }],
  ["frais de livraison Monoprix", { kind: "fees", ret: "monoprix" }],
  ["livraison offerte à partir de combien chez Carrefour", { kind: "fees", ret: "carrefour" }],
  ["combien coûte la livraison", { kind: "fees", ret: "", say: "les frais de livraison des enseignes" }],
  ["minimum de commande Auchan", { kind: "fees", ret: "auchan*" }],
  ["c'est combien la livraison pour 80 € chez Monoprix", { kind: "fees", ret: "monoprix", amount: 80, say: "pour un panier de 80 €" }],
  ["petit-déjeuner pour 4 à moins de 15 euros", { kind: "list", meal: "petitdej", people: 4, budget: 15, say: "« Petit-déjeuner », quantités pour 4 personnes, à moins de 15 € en tout" }],
  ["dîner de pâtes pour 2", { kind: "list", meal: "pates", people: 2 }],
  ["apéro pour 6", { kind: "list", meal: "apero", people: 6 }],
  ["courses pour la semaine", { kind: "list", meal: "semaine" }],
  ["le moins cher", { kind: "none", say: "il me manque le produit" }],
];

/* fautes courantes de frappe ou de dictée, et le mot attendu (noms de rayons, synonymes, marques comparées) */
const TYPOS = [
  ["lqit", "lait"], ["liat", "lait"], ["eaix", "eaux"], ["beure", "beurre"], ["buerre", "beurre"], ["sucr", "sucre"],
  ["farinne", "farine"], ["farien", "farine"], ["huille", "huile"], ["hiule", "huile"], ["papiet", "papier"], ["papeir", "papier"],
  ["toillette", "toilette"], ["fromagge", "fromage"], ["yaourtt", "yaourt"], ["yaout", "yaourt"], ["spagheti", "spaghetti"],
  ["coquilletes", "coquillettes"], ["lesive", "lessive"], ["vaiselle", "vaisselle"], ["tomattes", "tomates"], ["consreve", "conserve"],
  ["gaetaux", "gateaux"], ["caffe", "cafe"], ["emental", "emmental"], ["parmigianno", "parmigiano"], ["moutardde", "moutarde"],
  ["esuie", "essuie"], ["barila", "barilla"], ["candai", "candia"], ["oeufss", "oeufs"], ["paets", "pates"], ["tohn", "thon"],
];

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
  const count = () => page.evaluate(() => { const c = document.querySelector("#sres .count"); return c ? c.textContent : ""; });
  const typeQ = async (q) => { await page.fill("#q", ""); await page.type("#q", q, { delay: 5 }); await page.waitForTimeout(450); };
  try {
    await page.goto(base + "#/recherche"); await ready();
    await page.evaluate(() => localStorage.setItem("cabas.seen", JSON.stringify({ welcome: 1 })));
    /* 1. fuzzyWord sur la table */
    const got = await page.evaluate((T) => { const D = cabasDebug(); return T.map(([t]) => D.fuzzyWord(t)); }, TYPOS);
    TYPOS.forEach(([t, w], i) => { if (got[i] !== w) fail(`fuzzyWord(« ${t} ») : attendu « ${w} », obtenu « ${got[i]} »`); });
    const t0 = Date.now();
    await page.evaluate(() => { const D = cabasDebug(); for (let i = 0; i < 30; i++) D.fuzzyWord("spagheti"); });
    const ms = Date.now() - t0;
    if (ms > 1500) fail(`fuzzyWord : 30 appels en ${ms} ms, trop lent`);
    /* un mot qui a des résultats n'est jamais corrigé ; un mot sans rapprochement reste tel quel ; jamais un nombre */
    const nofix = await page.evaluate(() => { const D = cabasDebug(); return [D.fixQuery("lait"), D.fixQuery("lait barilla"), D.fixQuery("zzzz"), D.fixQuery("1234"), D.fuzzyWord("lait")]; });
    if (nofix[0] || nofix[1]) fail("fixQuery corrige une requête qui a des résultats");
    if (nofix[2]) fail("fixQuery invente une correction pour « zzzz »");
    if (nofix[3]) fail("fixQuery corrige un nombre");
    if (nofix[4]) fail("fuzzyWord propose un autre mot pour « lait »");
    const fx = await page.evaluate(() => cabasDebug().fixQuery("lqit demi"));
    if (!fx || fx.to !== "lait demi") fail(`fixQuery(« lqit demi ») : attendu « lait demi », obtenu ${JSON.stringify(fx)}`);

    /* 2. « yaourth » : des yaourts, et la ligne dit « Résultats pour « yaourt » » */
    await typeQ("yaourth");
    let n = await page.locator("#sres .card").count();
    if (!n) fail("« yaourth » : aucune carte");
    const inYaourts = await page.evaluate(() => { const S = cabasDebug().S; const a = document.querySelector("#sres .card .cover"); if (!a) return false; const id = decodeURIComponent(a.getAttribute("href").split("/").pop()); return (S.prods.get(id) || {}).r === "yaourts"; });
    if (!inYaourts) fail("« yaourth » : la première carte n'est pas du rayon yaourts");
    let c = await count();
    if (!/Résultats pour « yaourt »/.test(c)) fail(`« yaourth » : ligne « ${c} » au lieu de « Résultats pour « yaourt » »`);
    /* 3. une faute de frappe : « lqit » donne du lait, « lait » n'est pas corrigé */
    await typeQ("lqit");
    n = await page.locator("#sres .card").count();
    c = await count();
    if (!n || !/Résultats pour « lait »/.test(c)) fail(`« lqit » : ${n} cartes, ligne « ${c} »`);
    await typeQ("lait");
    c = await count();
    if (/Résultats pour/.test(c)) fail(`« lait » est présenté comme corrigé (« ${c} »)`);
    /* 4. suggestions pendant la frappe : dès deux lettres, quatre pastilles au plus, de 44 px, repliées au choix */
    await typeQ("la");
    const sugg = page.locator("#sugg");
    if (await sugg.evaluate((el) => el.hidden)) fail("« la » : pas de rangée de suggestions");
    else {
      const chips = sugg.locator(".chip");
      const k = await chips.count();
      if (!k || k > 4) fail(`« la » : ${k} suggestions`);
      const labels = await chips.allTextContents();
      if (!labels.some((l) => /^Lait/.test(l))) fail(`« la » : le rayon Lait n'est pas proposé (${labels.join(" | ")})`);
      const h = await chips.first().evaluate((el) => el.getBoundingClientRect().height);
      if (h < 44) fail(`suggestion de ${h} px de haut`);
      await chips.first().click();
      await page.waitForTimeout(300);
      if (!(await sugg.evaluate((el) => el.hidden))) fail("la rangée reste affichée après le choix d'une suggestion");
      const v = await page.evaluate(() => document.getElementById("q").value);
      if (!v || v === "la") fail(`la suggestion ne remplit pas la recherche (« ${v} »)`);
    }
    await typeQ("l");
    if (!(await sugg.evaluate((el) => el.hidden))) fail("une seule lettre affiche des suggestions");
    await page.fill("#q", "");
    await page.waitForTimeout(300);
    if (!(await sugg.evaluate((el) => el.hidden))) fail("champ vide : la rangée reste affichée");
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 0) fail(`recherche : déborde de ${over} px en largeur`);

    /* 5. Demande à Cabas : ce que chaque phrase veut dire, sans aucune requête hors du site */
    const outside = [];
    page.on("request", (r) => { const u = r.url(); if (!/^(blob|data):/.test(u) && !u.startsWith(base.replace(/index\.html$/, ""))) outside.push(u); });
    const got2 = await page.evaluate((P) => {
      const D = cabasDebug();
      return P.map(([q]) => {
        const A = D.askParse(q), L = A.L || {};
        return { kind: A.kind, q: A.q, sort: A.sort || "", max: A.max, maxUnit: A.maxUnit || "", diet: Object.keys(A.diet || {}).join("+"), people: A.people || 0, ret: A.ret || "", meal: A.meal || "", n: L.n || 0, size: L.size ? L.size.v + L.size.u : "", smart: !!A.smart, budget: A.budget || 0, amount: A.amount || 0 };
      });
    }, ASKS);
    const auchanNow = await page.evaluate(() => { const D = cabasDebug(); return D.retsFor(D.S.prefs.comp !== false).filter((r) => r.group === "auchan").map((r) => r.id)[0]; });
    ASKS.forEach(([q, want], i) => {
      const g = got2[i];
      for (const k of Object.keys(want)) {
        if (k === "say") continue;
        let w = want[k], v = g[k];
        if (k === "ret" && w === "auchan*") w = auchanNow;
        if (k === "diet") v = g.diet;
        if (String(v) !== String(w)) fail(`askParse(« ${q} ») : ${k} attendu ${JSON.stringify(w)}, obtenu ${JSON.stringify(v)}`);
      }
    });
    /* la phrase « J'ai compris », à l'écran, pour chaque demande qui en a une */
    for (const [q, want] of ASKS) {
      await page.evaluate((x) => { const D = cabasDebug(); D.S.q = x; D.S.askOff = null; D.S._ask = null; const i = document.getElementById("q"); i.value = x; i.dispatchEvent(new Event("input", { bubbles: true })); }, q);
      await page.waitForTimeout(260);
      const ban = await page.evaluate(() => { const b = document.querySelector("#sres .banner.ask"); return b ? b.textContent.replace(/\u00a0/g, " ") : ""; });
      if (want.smart === false) { if (ban) fail(`« ${q} » : une phrase « J'ai compris » pour une simple recherche (${ban})`); continue; }
      if (!/J'ai compris/.test(ban)) { fail(`« ${q} » : pas de phrase « J'ai compris »`); continue; }
      if (want.say && !ban.includes(want.say)) fail(`« ${q} » : la phrase « ${ban.replace(/Pas ça.*/, "").trim()} » ne dit pas « ${want.say} »`);
      if (!/Pas ça/.test(ban)) fail(`« ${q} » : pas de « Pas ça ? »`);
    }
    /* les résultats respectent la demande : prix plafond, régime, enseigne, tri au kilo */
    const res = await page.evaluate(() => {
      const D = cabasDebug(), S = D.S, out = {};
      const L = (q) => { const A = D.askParse(q); return { A, l: D.askList(A, D.searchScored(A.q).map((x) => x[1])) }; };
      let r = L("lait à moins de 1 €"); out.max = [r.l.length, r.l.filter((p) => !(D.best(p) && D.best(p).price <= 1)).length];
      r = L("pâtes sans gluten pas cher"); out.gluten = [r.l.length, r.l.filter((p) => !(p.regimes || []).includes("sans-gluten")).length];
      const u = r.l.map((p) => D.perUnit(p, D.best(p).price)).filter((x) => x != null); out.sorted = u.every((x, i) => !i || x >= u[i - 1] - 1e-9);
      r = L("lait chez Houra"); out.houra = [r.l.length, r.l.filter((p) => !(p.offers.houra && p.offers.houra.price > 0)).length];
      r = L("café moins de 20 euros le kilo"); out.kilo = [r.l.length, r.l.filter((p) => { const o = D.best(p), v = o && D.perUnit(p, o.price); return !(v != null && v <= 20); }).length];
      return out;
    });
    if (!res.max[0] || res.max[1]) fail(`« lait à moins de 1 € » : ${res.max[0]} résultats, ${res.max[1]} au-dessus de 1 €`);
    if (!res.gluten[0] || res.gluten[1]) fail(`« pâtes sans gluten » : ${res.gluten[0]} résultats, ${res.gluten[1]} sans l'étiquette sans gluten`);
    if (!res.sorted) fail("« pâtes sans gluten pas cher » : pas trié au kilo");
    if (!res.houra[0] || res.houra[1]) fail(`« lait chez Houra » : ${res.houra[0]} résultats, ${res.houra[1]} pas vendus chez Houra`);
    if (!res.kilo[0] || res.kilo[1]) fail(`« café moins de 20 € le kilo » : ${res.kilo[0]} résultats, ${res.kilo[1]} au-dessus de 20 €/kg`);
    /* « Pas ça ? » : décocher le tri le retire de la phrase ; « tel quel » cherche la phrase brute, et l'on revient */
    await typeQ("pâtes complètes le moins cher au kilo");
    if (!(await page.locator("#sres .hcard.ans").count())) fail("« pâtes complètes le moins cher au kilo » : pas de carte réponse");
    const addBtn = page.locator("#sres [data-act=askadd]");
    if (await addBtn.count()) {
      const before = await page.evaluate(() => Object.values(cabasDebug().S.basket).reduce((a, b) => a + b, 0));
      await addBtn.first().click(); await page.waitForTimeout(300);
      const after = await page.evaluate(() => Object.values(cabasDebug().S.basket).reduce((a, b) => a + b, 0));
      if (after !== before + 1) fail(`carte réponse : « Ajouter » fait passer le panier de ${before} à ${after}`);
      await page.evaluate(() => { localStorage.setItem("cabas.basket", "{}"); cabasDebug().S.basket = {}; });
    }
    await page.click("#sres [data-act=askfix]"); await page.waitForTimeout(500);
    if (await page.locator("#sheet").evaluate((el) => el.hidden)) fail("« Pas ça ? » n'ouvre pas de feuille");
    else {
      await page.click('#sheet [data-act=askpart][data-k="sort"]'); await page.waitForTimeout(300);
      await page.click("#sheet [data-act=close]"); await page.waitForTimeout(500);
      const ban = await page.locator("#sres .banner.ask").textContent();
      if (/moins cher/.test(ban)) fail("« Pas ça ? » : le tri décoché reste dans la phrase");
      await page.click("#sres [data-act=askfix]"); await page.waitForTimeout(500);
      await page.click("#sheet [data-act=askraw]"); await page.waitForTimeout(500);
      const raw = await page.locator("#sres .banner.ask").textContent();
      if (!/telle quelle/.test(raw)) fail("« tel quel » : pas de recherche brute");
      await page.click("#sres [data-act=askback]"); await page.waitForTimeout(400);
      if (!/J'ai compris/.test(await page.locator("#sres .banner.ask").textContent())) fail("« Revenir à ce que j'avais compris » ne revient pas");
    }
    /* une condition impossible : la demande dit ce qui manque et propose de la retirer */
    await typeQ("café moins de 0,10 €");
    if (!(await page.locator('#sres [data-act=askpart][data-k="max"]').count())) fail("« café moins de 0,10 € » : rien ne propose de retirer le prix plafond");
    /* liste composée : produits, total, budget dit, Ma liste */
    await typeQ("petit-déjeuner pour 4 à moins de 15 euros");
    const comp = await page.evaluate(() => { const c = document.querySelector("#sres .compose"); return c ? { rows: c.querySelectorAll(".crow").length, bud: !!c.querySelector(".bud"), txt: c.textContent } : null; });
    const C = await page.evaluate(() => { const D = cabasDebug(); const C = D.composeList(D.askParse("petit-déjeuner pour 4 à moins de 15 euros")); return { n: C.rows.length, total: C.total, lait: (C.rows.find((r) => /lait/i.test(r.t)) || {}).n || 0 }; });
    if (!comp || comp.rows < 3) fail(`liste composée : ${comp ? comp.rows : 0} produits affichés`);
    else if (!comp.bud) fail("liste composée : le budget n'est pas dit");
    if (C.lait < 2) fail(`liste composée pour 4 : ${C.lait} lait, 2 attendus`);
    if (comp && !/hors livraison/.test(comp.txt)) fail("liste composée : le total ne dit pas « hors livraison »");
    await page.click("#sres [data-act=askopen]"); await page.waitForTimeout(800);
    const wl = await page.evaluate(() => ({ h: location.hash, n: document.querySelectorAll("#view .wli").length }));
    if (wl.h !== "#/ecrire" || wl.n < 3) fail(`« Ouvrir dans Ma liste » : ${wl.h}, ${wl.n} lignes`);
    /* question de frais : la réponse, puis le guide des frais */
    await page.goto(base + "#/recherche"); await ready();
    await typeQ("c'est combien la livraison chez Houra ?");
    const fee = await page.evaluate(() => { const c = document.querySelector("#sres .hcard.fee"); return c ? c.textContent.replace(/\u00a0/g, " ") : ""; });
    if (!/Houra/.test(fee) || !/offerte dès 200 €/.test(fee)) fail(`frais Houra : réponse « ${fee} »`);
    await page.click('#sres a[href="#/frais/houra"]'); await page.waitForTimeout(600);
    if (await page.evaluate(() => location.hash) !== "#/frais/houra" || !(await page.locator("#frais-houra").count())) fail("le guide des frais ne s'ouvre pas sur Houra");
    await page.fill("#famt", "150"); await page.waitForTimeout(300);
    const row = await page.evaluate(() => { const a = [...document.querySelectorAll("#ftab .row")].find((r) => /Houra/.test(r.textContent)); return a ? a.textContent.replace(/\u00a0/g, " ") : ""; });
    if (!/5,00 €/.test(row)) fail(`guide des frais, 150 € chez Houra : « ${row} »`);
    const gaps = await page.evaluate(() => { const D = cabasDebug(); return [D.feeGap("houra", 5000), D.feeGap("houra", 15000), D.feeGap("monoprix", 12500), D.feeGap("auchan-alesia", 1000)]; });
    if (gaps[0].toMin !== 1000 || gaps[0].fee !== null) fail("feeGap(houra, 50 €) : 10 € sous le minimum attendus");
    if (gaps[1].fee !== 500 || gaps[1].free.gap !== 5000) fail("feeGap(houra, 150 €) : 5 € de livraison, encore 50 € pour l'offrir");
    if (gaps[2].fee !== 600 || gaps[2].fixed !== 320 || gaps[2].free.gap !== 2500) fail("feeGap(monoprix, 125 €) : 6 € (moitié prix), 3,20 € de service, encore 25 € pour l'offrir");
    if (!gaps[3].pickup || gaps[3].toMin !== 0) fail("feeGap(auchan-alesia) : retrait sans minimum attendu");
    if (outside.length) fail("requêtes hors du site pendant les demandes : " + outside.slice(0, 3).join(", "));
  } catch (e) {
    fail("parcours interrompu : " + e.message.split("\n")[0]);
  }
  await browser.close();
  server.close();
  if (problems.length) { console.log("Problèmes :\n- " + problems.join("\n- ")); process.exit(1); }
  console.log(`Orthographe tolérante et complétion : ${TYPOS.length} fautes corrigées ; Demande à Cabas : ${ASKS.length} phrases comprises, guide des frais ; aucun problème.`);
})();
