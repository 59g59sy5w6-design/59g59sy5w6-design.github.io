// Vérification des repas (F29, une semaine de repas à X €) : data/recettes.json (40 à 60 recettes simples, champs main,
// kind, diet, complete, with, ingrédients q, need, u, t, textes sans tiret cadratin et avec l'espace insécable), puis
// dans l'appli au format iPhone : chaque ingrédient trouvé aux prix relevés (sauf ceux qu'aucune enseigne ne vend dans
// la zone essayée, dits « prix partiel »), composeMenu (budget tenu, deux plats au plus par ingrédient principal, pas
// deux fois de suite, un accompagnement pour un plat qui ne se suffit pas et seulement pour lui, régime végétarien et
// végan respectés par la recette et par chaque produit, une autre semaine différente et dans le budget, moins de repas
// quand le budget ne suffit pas), un ingrédient sans produit relevé qui donne un coût partiel dit, et l'écran
// #/repas : composer, « Prendre cette semaine » dans Ma semaine avec « Annuler », « Une autre semaine », une recette
// d'accompagnement. Code de sortie 1 en cas de problème. Usage : node tools/reccheck.js [--shots=dossier] [--verbose]
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml" };
const SHOTS = (process.argv.find((a) => a.startsWith("--shots=")) || "").slice(8);
const VERBOSE = process.argv.includes("--verbose");
const problems = [];
const fail = (m) => problems.push(m);

/* ---------- 1. le fichier ---------- */
const R = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "recettes.json"), "utf8")).recettes;
const DIET = new Set(["veg", "vegan", "pork", "alcohol", "gluten", "lactose"]);
const KIND = new Set(["plat", "accompagnement", "dessert"]);
if (!(R.length >= 40 && R.length <= 60)) fail(`recettes.json : ${R.length} recettes, 40 à 60 attendues`);
const byId = new Map();
for (const r of R) {
  const w = (m) => fail(`recette ${r.id} : ${m}`);
  if (!/^[a-z0-9-]+$/.test(r.id || "")) w("identifiant ASCII attendu");
  if (byId.has(r.id)) w("identifiant en double");
  byId.set(r.id, r);
  if (!KIND.has(r.kind)) w("kind inconnu " + r.kind);
  if (!/^[a-z-]+$/.test(r.main || "")) w("main manquant");
  if (!Array.isArray(r.diet) || r.diet.some((d) => !DIET.has(d))) w("diet inconnu " + JSON.stringify(r.diet));
  if (r.diet.includes("vegan") && !r.diet.includes("veg")) w("végan sans végétarien");
  if (typeof r.complete !== "boolean") w("complete manquant");
  if (r.kind === "plat" && !r.complete && !(r.with || []).length) w("plat qui ne se suffit pas sans accompagnement proposé (with)");
  if (!(r.portions >= 1 && r.minutes >= 1)) w("portions ou minutes");
  if (!r.ing.length || r.ing.some((g) => !g.q || !(g.need > 0) || !["g", "ml", "pc"].includes(g.u) || !g.t || Object.keys(g).length !== 4)) w("ingrédient mal formé");
  if (!r.steps.length) w("préparation vide");
  const texts = [r.name, r.placard || ""].concat(r.steps, r.ing.map((g) => g.t));
  for (const t of texts) {
    if (/—/.test(t)) w("tiret cadratin : " + t);
    if (/ [:;!?]/.test(t)) w("espace ordinaire avant une ponctuation double : " + t);
  }
}
for (const r of R) for (const x of r.with || []) if (!byId.has(x) || byId.get(x).kind !== "accompagnement") fail(`recette ${r.id} : with « ${x} » n'est pas un accompagnement`);
const plats = R.filter((r) => r.kind === "plat");
if (plats.length < 25) fail(`seulement ${plats.length} plats`);
if (R.filter((r) => r.kind === "plat" && r.diet.includes("veg")).length < 8) fail("moins de 8 plats végétariens");
if (R.filter((r) => r.kind === "plat" && r.diet.includes("vegan")).length < 3) fail("moins de 3 plats végans");

let chromium;
try { ({ chromium } = require("playwright")); } catch (e) {
  console.log(problems.length ? "Problèmes :\n- " + problems.join("\n- ") : "data/recettes.json vérifié ; Playwright n'est pas installé ici : appli non vérifiée.");
  process.exit(problems.length ? 1 : 0);
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
  const PREFS = { zip: "94120", off: { leclerc: true }, fee: {}, pick: {}, liv: {}, keep: {}, usual: {}, qty1: {}, maxOrders: 3, extraCost: 0, offv: 1, foyer: 2 };
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block", locale: "fr-FR" });
  await ctx.route((url) => !String(url).startsWith(origin), (r) => r.abort());
  const page = await ctx.newPage();
  page.on("pageerror", (e) => fail("erreur JS : " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/net::ERR_FAILED/.test(m.text())) fail("console : " + m.text()); });
  const ready = () => page.waitForFunction(() => !document.querySelector("#view .sk") && document.querySelector("#view .wrap > *"), null, { timeout: 25000 });
  const shot = async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: true }); } };
  const over = async (where) => { const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); if (o > 0) fail(`${where} : déborde de ${o} px en largeur`); };
  const load = async (prefs, h) => {
    await page.goto(base + "#/"); await ready();
    await page.evaluate((p) => { localStorage.clear(); localStorage.setItem("cabas.prefs", JSON.stringify(p)); localStorage.setItem("cabas.seen", JSON.stringify({ welcome: 1 })); }, prefs);
    await page.goto(base + (h || "#/")); await page.reload(); await ready(); await page.waitForTimeout(400);
  };
  const go = async (h) => { await page.evaluate((h) => { location.hash = h; }, h); await page.waitForTimeout(500); };
  try {
    /* ---------- 2. chaque ingrédient, aux prix relevés, dans trois zones Auchan ---------- */
    for (const pick of ["auchan", "auchan-livraison-perreux", "auchan-livraison-paris14"]) {
      await load(Object.assign({}, PREFS, { pick: { auchan: pick }, pickManual: { auchan: 1 } }));
      const r = await page.evaluate(() => {
        const D = cabasDebug(), out = [];
        for (const rc of D.S.recs) { const c = D.recCost(rc); c.lines.forEach((x) => out.push({ id: rc.id, q: x.g.q, p: x.p ? x.p.brand + " " + x.p.name + " | " + x.p.r : "", sim: !!(x.b && x.b.sim) })); }
        return out;
      });
      const miss = [...new Set(r.filter((x) => !x.p).map((x) => x.q))];
      if (r.some((x) => x.sim)) fail(`${pick} : un ingrédient est compté à un prix simulé`);
      if (miss.length > 3) fail(`${pick} : ${miss.length} ingrédients sans produit relevé (${miss.join(", ")})`);
      if (VERBOSE) { console.log("#### " + pick); [...new Map(r.map((x) => [x.q, x.p])).entries()].forEach(([q, p]) => console.log("  " + q.padEnd(28) + (p || "AUCUN"))); }
    }

    /* ---------- 3. composeMenu ---------- */
    await load(PREFS);
    const C = await page.evaluate(() => {
      const D = cabasDebug(), rid = (x) => x.rc.id;
      const sum = (r) => ({ n: r.picks.length, total: r.total, fits: r.fits, out: r.out, ids: r.picks.map(rid), mains: r.picks.map((x) => x.rc.main), sides: r.picks.map((x) => (x.side ? [x.rc.complete, x.side.kind, (x.rc.with || []).includes(x.side.id) || !(x.rc.with || []).length] : null)), incomplete: r.picks.filter((x) => !x.rc.complete && !x.side).length, kinds: r.picks.map((x) => x.rc.kind), list: r.list.map((x) => [x.rc.id, x.portions]), miss: r.miss });
      const t0 = performance.now();
      const free = sum(D.composeMenu({ meals: 7, people: 2 })), ms = performance.now() - t0;
      const b40 = sum(D.composeMenu({ budget: 4000, meals: 7, people: 2 }));
      const b40s = sum(D.composeMenu({ budget: 4000, meals: 7, people: 2, seed: 3 }));
      const tiny = sum(D.composeMenu({ budget: Math.round(free.total / 3), meals: 7, people: 2 }));
      const big = sum(D.composeMenu({ meals: 14, people: 4 }));
      return { free, ms, b40, b40s, tiny, big };
    });
    const checkWeek = (name, w, people) => {
      if (w.kinds.some((k) => k !== "plat")) fail(`${name} : un repas n'est pas un plat`);
      const cnt = {}; w.mains.forEach((m) => { cnt[m] = (cnt[m] || 0) + 1; });
      if (Object.values(cnt).some((n) => n > 2)) fail(`${name} : plus de deux plats du même ingrédient principal (${JSON.stringify(cnt)})`);
      if (w.mains.some((m, i) => i && m === w.mains[i - 1])) fail(`${name} : deux fois de suite le même ingrédient principal`);
      if (w.incomplete) fail(`${name} : un plat qui ne se suffit pas est sans accompagnement`);
      if (w.sides.some((s) => s && (s[0] || s[1] !== "accompagnement" || !s[2]))) fail(`${name} : accompagnement mal choisi ${JSON.stringify(w.sides)}`);
      if (new Set(w.ids).size !== w.ids.length) fail(`${name} : un plat revient deux fois`);
      if (people && w.list.some(([, p]) => p % people)) fail(`${name} : portions qui ne suivent pas le nombre de personnes`);
    };
    if (C.free.n !== 7) fail(`semaine sans budget : ${C.free.n} repas, 7 attendus`);
    checkWeek("semaine sans budget", C.free, 2);
    if (C.ms > 1500) fail(`composeMenu : ${Math.round(C.ms)} ms`);
    if (C.b40.fits && C.b40.total > 4000) fail(`budget de 40 € : ${C.b40.total} centimes annoncés dans le budget`);
    if (C.b40.fits && C.b40.n !== 7) fail(`budget de 40 € tenu mais ${C.b40.n} repas`);
    checkWeek("budget de 40 €", C.b40, 2);
    if (C.b40.total < C.free.total) fail("la semaine la moins chère n'est pas celle sans budget");
    if (C.b40s.fits && C.b40s.total > 4000) fail("une autre semaine dépasse le budget");
    if (JSON.stringify(C.b40s.ids) === JSON.stringify(C.b40.ids) && C.b40.total < 3500) fail("« Une autre semaine » propose la même semaine");
    checkWeek("une autre semaine", C.b40s, 2);
    if (!(C.tiny.n < 7)) fail(`budget trop petit : ${C.tiny.n} repas gardés`);
    if (C.tiny.fits && C.tiny.total > Math.round(C.free.total / 3)) fail("budget trop petit : total au-dessus du budget annoncé tenu");
    checkWeek("budget trop petit", C.tiny, 2);
    checkWeek("quatorze repas pour quatre", C.big, 4);
    if (C.big.n < 12) fail(`quatorze repas : ${C.big.n} seulement`);

    /* régime : végétarien puis végan, recette et produits (aucun mot de viande ou de poisson ; du riz sans étiquette
       « végan » va dans un plat végan par nature) */
    for (const d of ["veg", "vegan"]) {
      await load(Object.assign({}, PREFS, { diet: { [d]: true } }));
      const v = await page.evaluate((d) => {
        const D = cabasDebug(), r = D.composeMenu({ meals: 7, people: 2 });
        const all = r.picks.flatMap((x) => [x.rc, x.side].filter(Boolean));
        return { n: r.picks.length, out: r.out, bad: all.filter((rc) => !rc.diet.includes(d) || D.recCost(rc).bad.length).map((rc) => rc.id), prods: all.flatMap((rc) => D.recCost(rc).ok.map((x) => x.p.id)).filter((id) => !D.dietOk(D.S.prods.get(id), { veg: true })) };
      }, d);
      if (v.bad.length) fail(`régime ${d} : recettes qui ne le suivent pas (${v.bad.join(", ")})`);
      if (v.prods.length) fail(`régime ${d} : produits qui ne le suivent pas (${v.prods.join(", ")})`);
      if (!v.n) fail(`régime ${d} : aucune semaine`);
      if (v.n < 7 && !v.out) fail(`régime ${d} : ${v.n} repas sans dire qu'il n'y a pas assez de plats`);
    }

    /* un ingrédient sans produit relevé : coût partiel, et le plat ne vient qu'en dernier */
    await load(PREFS);
    const P = await page.evaluate(() => {
      const D = cabasDebug(), S = D.S, src = S.recs.find((r) => r.id === "pates-thon-tomate");
      const fake = JSON.parse(JSON.stringify(src)); fake.id = "essai-partiel"; fake.name = "Essai partiel"; fake.main = "essai"; fake.ing.push({ q: "zzqx introuvable", need: 100, u: "g", t: "100 g d'introuvable" });
      S.recs.push(fake);
      const c = D.recCost(fake), r = D.composeMenu({ meals: 7, people: 2 }), all = D.composeMenu({ meals: 40, people: 2 });
      return { miss: c.miss.length, okPrice: c.ok.length, in7: r.picks.some((x) => x.rc.id === "essai-partiel"), last: all.picks.findIndex((x) => x.rc.id === "essai-partiel"), n: all.picks.length, partial: all.miss };
    });
    if (P.miss !== 1 || !P.okPrice) fail(`coût partiel : ${JSON.stringify(P)}`);
    if (P.in7) fail("un plat au coût partiel passe avant des plats complets");
    if (P.last >= 0 && P.last !== P.n - 1) fail(`le plat au coût partiel n'arrive pas en dernier (${P.last} sur ${P.n})`);
    if (P.last >= 0 && !P.partial.includes("zzqx introuvable")) fail("la semaine ne dit pas l'ingrédient manquant");
    await go("#/repas/essai-partiel");
    const ptxt = await page.$eval("#view", (e) => e.textContent.replace(/\s+/g, " "));
    if (!/sans zzqx introuvable, pas encore dans Cabas/.test(ptxt)) fail("recette au coût partiel : le manque n'est pas dit");

    /* ---------- 4. l'écran #/repas ---------- */
    await load(PREFS, "#/repas");
    await over("repas");
    if (!(await page.$("#cmBud"))) fail("repas : pas de champ de budget");
    if ((await page.$$('#view [data-act="cmmeals"]')).length !== 4) fail("repas : choix du nombre de repas");
    await page.click('[data-act="cmmeals"][data-v="5"]'); await page.waitForTimeout(250);
    await page.fill("#cmBud", "abc"); await page.click('[data-act="compose"]'); await page.waitForTimeout(250);
    if (!(await page.$('[data-field="cmBud"].err'))) fail("repas : un budget illisible n'est pas refusé");
    await page.fill("#cmBud", "30"); await page.click('[data-act="compose"]'); await page.waitForTimeout(700);
    const res = await page.$eval("#cmres", (e) => e.textContent.replace(/\s+/g, " "));
    if (!/5 repas pour 2 personnes/.test(res)) fail("repas : résultat « " + res.slice(0, 120) + " »");
    if (!/budget de 30\s€/.test(res)) fail("repas : le budget n'est pas dit");
    if ((await page.$$("#cmres a.row")).length !== 5) fail("repas : cinq plats attendus dans la liste");
    await over("repas composé");
    await shot("repas-semaine");
    const first = await page.$eval("#cmres a.row", (a) => a.getAttribute("href"));
    await page.click('[data-act="cmagain"]'); await page.waitForTimeout(600);
    const again = await page.$eval("#cmres", (e) => e.textContent.replace(/\s+/g, " "));
    if (!/repas pour/.test(again)) fail("une autre semaine : pas de résultat");
    const menu0 = await page.evaluate(() => JSON.parse(localStorage.getItem("cabas.menu") || "[]"));
    await page.click('[data-act="cmtake"]'); await page.waitForTimeout(500);
    const menu1 = await page.evaluate(() => JSON.parse(localStorage.getItem("cabas.menu") || "[]"));
    if (menu1.length < 5) fail("Prendre cette semaine : Ma semaine a " + menu1.length + " recettes");
    if (!/Ajouter les courses de la semaine au panier/.test(await page.$eval("#view", (e) => e.textContent))) fail("Prendre cette semaine : Ma semaine n'est pas affichée");
    await page.click("#toast button"); await page.waitForTimeout(400);
    const menu2 = await page.evaluate(() => JSON.parse(localStorage.getItem("cabas.menu") || "[]"));
    if (JSON.stringify(menu2) !== JSON.stringify(menu0)) fail("Annuler ne remet pas Ma semaine d'avant");
    if (!first) fail("repas : lien de recette");
    /* une recette d'accompagnement */
    await go("#/repas/puree-maison");
    if (!/Accompagnement, 30\smin/.test(await page.$eval("#view", (e) => e.textContent))) fail("recette d'accompagnement : type non dit");
    await over("recette");
  } catch (e) { fail("exception : " + (e && e.stack || e)); }
  await browser.close(); server.close();
  if (problems.length) { console.log("Problèmes :\n- " + problems.join("\n- ")); process.exit(1); }
  console.log(`Repas vérifiés : ${R.length} recettes (${plats.length} plats), ingrédients aux prix relevés dans trois zones, une semaine à X € (budget, variété, accompagnements, régimes, coût partiel), écran Repas.`);
})();
