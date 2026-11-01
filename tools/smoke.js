// Test rapide de l'appli après une mise à jour : sert le dépôt en local, ouvre les écrans principaux
// au format iPhone (accueil, Rayons par univers, un rayon par univers, fiche produit avec ses détails, panier, Remplir
// mes paniers, Recommander, recherche, guide des frais, À propos, mode magasin, Ce qui a bougé, listes par profil, lien
// de transfert abîmé) et vérifie qu'ils s'affichent sans erreur ; la fiche avec Nutri-Score, allergènes et labels
// d'après Open Food Facts (réponse simulée, tools/fixtures/openfoodfacts.json : seul le code part, gardé sur le
// téléphone, réglage décoché), #/comparer, le signalement (gardé, lien GitHub sans donnée personnelle), « À venir »
// (#/comment/avenir, demande d'une enseigne ou d'une ville) et un seuil de prix atteint ; puis
// l'affichage (thème, contraste renforcé, mode confort et taille du texte posés avant le premier rendu, cibles de 60 px
// en confort) et le bon Auchan d'après le code postal. Code de sortie 1 en cas de problème.
// Usage : node tools/smoke.js
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml" };

let chromium;
try { ({ chromium } = require("playwright")); } catch (e) {
  console.log("Playwright n'est pas installé ici : test de l'appli sauté (npm i playwright pour l'activer).");
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
  const base = `http://127.0.0.1:${server.address().port}/index.html`;
  const problems = [];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  /* Open Food Facts simulé (tools/fixtures/openfoodfacts.json) : le code choisi est connu, les autres répondent 404 ;
     chaque demande est notée, pour vérifier qu'elle ne porte que le code-barres */
  const OFF = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "openfoodfacts.json"), "utf8")), offReq = [];
  let offKnown = "";
  await ctx.route(/^https:\/\/world\.openfoodfacts\.org\//, (r) => {
    const u = new URL(r.request().url()), code = (/\/product\/(\d+)\.json$/.exec(u.pathname) || [])[1] || "";
    offReq.push({ url: u.href, code, keys: [...u.searchParams.keys()], cookie: r.request().headers().cookie || "" });
    const ok = code && code === offKnown;
    r.fulfill({ status: ok ? 200 : 404, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(ok ? OFF.connu : OFF.inconnu) });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push("erreur JS : " + e.message));
  /* un code inconnu d'Open Food Facts répond 404 : le navigateur le note, ce n'est pas une erreur de l'appli */
  page.on("console", (m) => { if (m.type() === "error" && !/openfoodfacts\.org/.test((m.location() || {}).url || "")) problems.push("console : " + m.text()); });
  const ready = () => page.waitForFunction(() => !document.querySelector("#view .sk") && document.querySelector("#view .wrap > *"), null, { timeout: 20000 });
  const check = async (name, sel, min) => {
    await page.waitForTimeout(350);
    const n = await page.locator(sel).count();
    if (n < min) problems.push(`${name} : ${n} élément(s) « ${sel} », ${min} attendu(s) au moins`);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 0) problems.push(`${name} : déborde de ${over} px en largeur`);
    return n;
  };
  try {
    await page.goto(base + "#/"); await ready();
    await check("accueil", ".deal", 1);
    await check("accueil", ".cat", 4);
    /* catalogue v2 : clés courtes (i identifiant, r rayon, o offres), rayons avec univers (u) et compteur (n) */
    const cat = await page.evaluate(() => fetch("data/catalog.json").then((r) => r.json()));
    const meta = await page.evaluate(() => fetch("data/meta.json").then((r) => r.json()));
    if (cat.v !== 2) problems.push("catalogue : format v2 attendu");
    /* page Rayons : un bloc repliable par univers, montée rapide, filtre local */
    await page.goto(base + "#/rayons"); await ready();
    const nUniv = await check("rayons", "details.univ", 1);
    const univ = cat.univers.filter((u) => cat.rayons.some((r) => r.u === u.id && (r.n || r.virtuel))).length;
    if (nUniv !== univ) problems.push(`rayons : ${nUniv} univers affichés, ${univ} attendus`);
    const ms = await page.evaluate(() => { const t0 = performance.now(); location.hash = "#/"; location.hash = "#/rayons"; return performance.now() - t0; });
    if (ms > 200) problems.push(`rayons : rendu en ${Math.round(ms)} ms, 200 attendus au plus`);
    await page.fill("#rq", "eau"); await page.waitForTimeout(400);
    const tiles = await page.$$eval("#rlist .cat b", (els) => els.map((e) => e.textContent));
    if (!tiles.length || tiles.some((t) => !/eau/i.test(t))) problems.push("rayons : le filtre « eau » laisse " + JSON.stringify(tiles));
    /* un rayon par univers, le premier qui a des produits, plus les rayons de parcours (virtuels) */
    const seen = new Set();
    const sample = cat.rayons.filter((r) => (r.n && !seen.has(r.u) && seen.add(r.u)) || (r.virtuel && r.virtuel.length));
    for (const r of sample) {
      await page.goto(base + "#/rayon/" + r.id); await ready();
      if (r.n || r.virtuel) await check("rayon " + r.id, ".card", r.n ? 1 : 0);
    }
    /* au moins deux enseignes visibles : les points Auchan d'un même groupe n'en font qu'une, E.Leclerc (simulé) est désactivé sur un téléphone neuf */
    const rets = await page.evaluate(() => fetch("data/retailers.json").then((r) => r.json()));
    const grp = {}; rets.forEach((r) => { grp[r.id] = r.group || r.id; });
    const groupsOf = (p) => new Set((p.o || []).map((o) => grp[cat.rets[o[0]]] || cat.rets[o[0]]).filter((g) => g !== "leclerc"));
    const multi = cat.products.filter((p) => groupsOf(p).size > 1);
    await page.goto(base + "#/produit/" + encodeURIComponent(multi[0].i)); await ready();
    await check("fiche produit", ".offer", 2);
    /* les détails de l'univers arrivent après la fiche : nom affiché par l'enseigne et lien de la fiche */
    await page.waitForFunction(() => !document.querySelector("#poffers .skl"), null, { timeout: 8000 }).catch(() => problems.push("fiche produit : les détails ne remplacent pas le squelette"));
    const links = await page.$$eval("#poffers a.offer", (els) => els.map((e) => e.getAttribute("href")));
    if (!links.some((h) => /https?:\/\/.+\/.+/.test(h))) problems.push("fiche produit : aucun lien de fiche chez une enseigne (" + links.join(", ") + ")");
    const basket = {};
    multi.slice(0, 14).forEach((p) => { basket[p.i] = 2; });
    await page.evaluate((b) => localStorage.setItem("cabas.basket", JSON.stringify(b)), basket);
    await page.goto(base + "#/panier"); await page.reload(); await ready();
    await page.waitForTimeout(800);
    await check("panier", ".sum .st", 1);
    await check("panier", ".order", 1);
    /* Remplir mes paniers : la répartition en cours, une carte par commande, puis le mode guidé d'une commande
       (« Avant de commencer » la première fois) ; Recommander */
    await page.goto(base + "#/remplir"); await ready();
    await page.waitForSelector(".fillc", { timeout: 20000 }).catch(() => {});
    if (await check("remplir", ".fillc", 1)) {
      await check("remplir, ligne vers « À venir »", '#view .gf a[href="#/comment/avenir"]', 1);
      await page.click(".dock [data-act=fill]"); await page.waitForTimeout(500); await ready();
      await check("remplir, mode guidé", "#view .steps li, #fpn", 1);
      const g = await page.evaluate(() => JSON.parse(localStorage.getItem("cabas.guide") || "{}"));
      if (!g.snap || !g.snap.orders || !g.snap.orders.length) problems.push("remplir : l'instantané de la répartition (cabas.guide.snap) n'est pas pris");
    }
    await page.goto(base + "#/recommander"); await ready();
    await check("recommander", "#view h1", 1);
    await page.goto(base + "#/recherche"); await ready();
    await page.fill("#q", "lait"); await page.waitForTimeout(500);
    await check("recherche", "#sres .card", 1);
    await check("recherche", "#sres .hcard", 1);
    await page.goto(base + "#/apropos"); await ready();
    await check("à propos", "details.adv", 1);
    /* guide des frais : le panier compté chez chaque enseigne, un montant à essayer, une fiche par enseigne */
    await page.goto(base + "#/frais"); await ready();
    await check("frais", "#ftab .row", 3);
    await check("frais", "#view .banner", 1);
    await check("frais", 'h2[id^="frais-"]', 3);
    /* mode magasin (le panier rangé par rayon), ce qui a bougé, listes toutes faites par profil, lien de transfert abîmé */
    await page.goto(base + "#/magasin"); await ready();
    await check("magasin", "#view .gi.big", 1);
    await page.goto(base + "#/mouvements"); await ready();
    await check("mouvements", "#view h1", 1);
    await page.goto(base + "#/listes"); await ready();
    await page.waitForSelector("#profs [data-act=prof]", { timeout: 8000 }).catch(() => {});
    await check("listes par profil", "#profs [data-act=prof]", 5);
    await page.goto(base + "#/transfert/jabc"); await ready(); await page.waitForTimeout(300);
    await check("transfert abîmé", "#view .empty", 1);
    if (!/"data\/listes\.json"/.test(fs.readFileSync(path.join(ROOT, "sw.js"), "utf8"))) problems.push("sw.js : data/listes.json absent de DATA");

    /* fiche produit : Nutri-Score, allergènes et labels d'après Open Food Facts (réponse simulée), à la demande, gardés
       sur le téléphone ; le régime (allergènes) s'en sert quand le fait est connu. La fiche est ouverte par un chargement
       neuf (about:blank d'abord) : ouverte puis rechargée, elle demanderait une première fois avant le rechargement,
       et Playwright 1.48 (celui du robot, tools/ci.sh) voit cette demande interrompue */
    const eans = cat.products.filter((p) => p.e && (p.o || []).some((o) => !(o[3] & 2)));
    const PE = eans[0], PU = eans[1];
    offKnown = String(PE.e).replace(/^0+/, "");
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem("cabas.prefs", JSON.stringify({ zip: "94120", off: { leclerc: true }, offv: 1, allergens: ["nuts"] })); localStorage.setItem("cabas.seen", JSON.stringify({ welcome: 1 })); });
    await page.goto("about:blank"); await page.goto(base + "#/produit/" + encodeURIComponent(PE.i)); await ready();
    await page.waitForSelector("#pfacts .nscore", { timeout: 9000 }).catch(() => problems.push("faits : le Nutri-Score n'apparaît pas sur la fiche"));
    const fx = await page.evaluate(() => { const el = document.getElementById("pfacts"); return { t: el.textContent.replace(/\s+/g, " "), ns: (el.querySelector(".nscore") || {}).getAttribute ? el.querySelector(".nscore").getAttribute("aria-label") : "", warn: !!el.querySelector(".banner.warn"), link: (el.querySelector('a[href^="https://world.openfoodfacts.org/product/"]') || {}).rel || "" }; });
    if (fx.ns !== "Nutri-Score B") problems.push("faits : Nutri-Score « " + fx.ns + " »");
    for (const w of ["Contient : lait", "Traces possibles : fruits à coque", "Agriculture biologique", "Fabriqué en France", "ODbL", "vérifier sur l'emballage"]) if (!fx.t.includes(w)) problems.push("faits : « " + w + " » absent de la fiche");
    if (/green|inconnu/i.test(fx.t)) problems.push("faits : un label ou un allergène inconnu est affiché");
    if (!fx.warn) problems.push("faits : l'allergène évité (fruits à coque) n'est pas signalé");
    if (fx.link !== "noopener") problems.push("faits : le lien vers Open Food Facts sans rel=noopener");
    const req1 = offReq.filter((x) => x.code === offKnown);
    if (req1.length !== 1 || req1.some((x) => x.keys.join() !== "fields" || x.cookie)) problems.push("faits : demandes à Open Food Facts " + JSON.stringify(offReq));
    const fst = await page.evaluate((k) => (JSON.parse(localStorage.getItem("cabas.facts") || "{}") || {})[k], offKnown);
    if (!fst || fst.ok !== 1 || fst.ns !== "b" || fst.al.join() !== "milk" || fst.tr.join() !== "nuts") problems.push("faits : cabas.facts " + JSON.stringify(fst));
    const dk = await page.evaluate(([a, b]) => { const D = cabasDebug(); return [D.dietOk(D.S.prods.get(a)), D.dietOk(D.S.prods.get(b)), D.allergHit(D.S.prods.get(a)).join()]; }, [PE.i, PU.i]);
    if (dk.join("|") !== "false|true|nuts") problems.push("régime et allergènes : " + dk.join("|") + " (le fait connu écarte, l'inconnu ne juge pas)");
    await page.reload(); await ready(); await page.waitForTimeout(600);
    if (offReq.filter((x) => x.code === offKnown).length !== 1) problems.push("faits : redemandés alors qu'ils sont gardés 30 jours");
    await page.goto(base + "#/produit/" + encodeURIComponent(PU.i)); await ready();
    await page.waitForFunction(() => /Pas encore dans Open Food Facts/.test(document.getElementById("pfacts").textContent), null, { timeout: 9000 }).catch(() => problems.push("faits : un code inconnu d'Open Food Facts n'est pas dit"));
    /* réglage décoché : rien n'est demandé sans un geste */
    await page.evaluate(() => { const p = JSON.parse(localStorage.getItem("cabas.prefs")); p.facts = false; localStorage.setItem("cabas.prefs", JSON.stringify(p)); localStorage.removeItem("cabas.facts"); });
    const n0 = offReq.length;
    await page.goto("about:blank"); await page.goto(base + "#/produit/" + encodeURIComponent(PE.i)); await ready(); await page.waitForTimeout(700);
    if (offReq.length !== n0) problems.push("faits : demandés alors que le réglage est décoché");
    await page.click('#pfacts [data-act="factsget"]');
    await page.waitForSelector("#pfacts .nscore", { timeout: 9000 }).catch(() => problems.push("faits : « Voir le Nutri-Score » ne les demande pas"));

    /* comparer deux produits : #/comparer/<a>/<b>, verdict aux prix relevés, « Prendre celui-ci » remplace l'autre */
    const PB = cat.products.find((p) => p.r === PE.r && p.i !== PE.i && (p.o || []).some((o) => !(o[3] & 2)));
    await page.evaluate((b) => localStorage.setItem("cabas.basket", JSON.stringify(b)), { [PB.i]: 2 });
    await page.goto(base + "#/comparer/" + encodeURIComponent(PE.i) + "/" + encodeURIComponent(PB.i)); await page.reload(); await ready();
    await check("comparer", ".cmpt thead th", 2);
    await check("comparer", ".cmpt tr.cl", 4);
    const vt = await page.$eval(".cmpv .vt", (e) => e.textContent);
    if (!/moins cher|le même prix|Pas de verdict/.test(vt)) problems.push("comparer : verdict « " + vt + " »");
    if (!/Nutri-Score/.test(await page.$eval(".cmpt", (e) => e.textContent))) problems.push("comparer : les faits connus ne sont pas comparés");
    await page.click(`.cmpt [data-act="cmptake"][data-id="${PE.i}"]`); await page.waitForTimeout(400);
    let bk = await page.evaluate(() => JSON.parse(localStorage.getItem("cabas.basket")));
    if (bk[PE.i] !== 2 || bk[PB.i]) problems.push("comparer : « Prendre celui-ci » " + JSON.stringify(bk));
    await page.click("#toast button"); await page.waitForTimeout(400);
    bk = await page.evaluate(() => JSON.parse(localStorage.getItem("cabas.basket")));
    if (bk[PB.i] !== 2 || bk[PE.i]) problems.push("comparer : « Annuler » " + JSON.stringify(bk));
    await page.goto(base + "#/comparer/" + encodeURIComponent(PE.i)); await ready();
    await check("comparer, choix", "#cmplist a.row", 1);
    await page.goto(base + "#/produit/" + encodeURIComponent(PE.i)); await ready();
    await page.click('#view [data-act="cmppick"]'); await page.waitForTimeout(500);
    await check("comparer, feuille", "#sheet #cmplist a.row", 1);
    await page.fill("#cmpq", "lait"); await page.waitForTimeout(500);
    if (!(await page.$$eval("#sheet #cmplist a.row", (a) => a.length))) problems.push("comparer : la recherche de la feuille ne trouve rien pour « lait »");
    await page.click("#sheet .sheet-h [data-act=close]"); await page.waitForTimeout(400);

    /* signaler : gardé sur le téléphone ; le lien GitHub, ouvert seulement après confirmation, sans donnée personnelle */
    await page.click('#view [data-act="report"]'); await page.waitForTimeout(500);
    await page.click('#sheet [data-act="repk"][data-k="prix"]'); await page.waitForTimeout(250);
    await page.click('#sheet [data-act="repret"]:not([data-v=""])'); await page.waitForTimeout(250);
    await page.fill("#repT", "Le prix a changé. Écris-moi à jean.dupont@example.com ou au 06 12 34 56 78, j'habite au 94120.");
    await page.click('#sheet [data-act="repok"]'); await page.waitForTimeout(400);
    const reps = await page.evaluate(() => JSON.parse(localStorage.getItem("cabas.reports") || "[]"));
    if (reps.length !== 1 || reps[0].k !== "prix" || reps[0].pid !== PE.i || !reps[0].ret) problems.push("signaler : cabas.reports " + JSON.stringify(reps));
    const gh = await page.evaluate(() => { const a = document.querySelector('#sheet a[data-act="repsent"]'), pre = document.querySelector("#sheet .repv"); return a ? { href: a.getAttribute("href"), rel: a.rel, target: a.target, pre: pre ? pre.textContent : "" } : null; });
    if (!gh) problems.push("signaler : pas de confirmation avant GitHub");
    else {
      const u = new URL(gh.href), body = u.searchParams.get("body") || "", title = u.searchParams.get("title") || "";
      if (u.origin + u.pathname !== "https://github.com/59g59sy5w6-design/59g59sy5w6-design.github.io/issues/new") problems.push("signaler : adresse " + u.origin + u.pathname);
      if (gh.rel !== "noopener" || gh.target !== "_blank") problems.push("signaler : lien sans rel=noopener ou target=_blank");
      if (/jean|example|06 12|94120/.test(body + title + gh.pre)) problems.push("signaler : une donnée personnelle part dans le ticket");
      if (!body.includes(PE.i) || !body.includes("[retiré]") || !/^Le prix n'est pas le bon/.test(title)) problems.push("signaler : ticket « " + title + " » " + body.slice(0, 160));
      if (gh.pre.trim() !== body.trim()) problems.push("signaler : le texte montré n'est pas celui qui part");
      await page.evaluate(() => { const a = document.querySelector('#sheet a[data-act="repsent"]'); a.addEventListener("click", (e) => e.preventDefault(), { once: true }); a.click(); });
      await page.waitForTimeout(500);
      const sent = await page.evaluate(() => JSON.parse(localStorage.getItem("cabas.reports") || "[]")[0].sent);
      if (!sent) problems.push("signaler : l'envoi sur GitHub n'est pas noté");
    }
    const gen = await page.evaluate(() => decodeURIComponent(cabasDebug().ghIssueUrl({ k: "demande", text: "rillettes de thon, 75011" })));
    if (!/title=Demander un produit ou un rayon\u00a0: rillettes de thon, \[retiré\]/.test(gen)) problems.push("ghIssueUrl : " + gen.slice(0, 200));

    /* préviens-moi : le seuil sur la fiche, atteint tout de suite quand il est au-dessus du prix relevé */
    const cur = await page.evaluate((id) => { const D = cabasDebug(); return Math.round(D.bestReal(D.S.prods.get(id)).price * 100); }, PE.i);
    await page.click('#view [data-act="watch"]'); await page.waitForTimeout(500);
    await page.fill("#watchIn", "0"); await page.click('#sheet [data-act="watchok"]'); await page.waitForTimeout(250);
    if (!(await page.$('[data-field="watchIn"].err'))) problems.push("préviens-moi : un seuil nul n'est pas refusé");
    await page.fill("#watchIn", String((cur + 100) / 100).replace(".", ",")); await page.click('#sheet [data-act="watchok"]'); await page.waitForTimeout(400);
    const wst = await page.evaluate(() => [JSON.parse(localStorage.getItem("cabas.watch") || "{}"), JSON.parse(localStorage.getItem("cabas.watchHits") || "{}")]);
    if (!wst[0][PE.i] || wst[0][PE.i].max !== cur + 100 || !wst[1][PE.i]) problems.push("préviens-moi : " + JSON.stringify(wst));
    await page.goto(base + "#/"); await ready(); await page.waitForTimeout(400);
    await check("accueil, seuil atteint", '#view [aria-label="Ton seuil est atteint"] a.row', 1);

    /* « À venir » : depuis les réglages, #/comment/avenir arrive sur la section (titre en haut, focus dessus), quatre
       projets, aucune autre appli nommée ; « Demander une enseigne ou ta ville » ouvre le signalement sur ce choix, et
       le code postal écrit ne part pas dans le ticket */
    await page.goto(base + "#/reglages"); await ready();
    /* « Commandes au plus » : compté par groupe d'enseigne utilisé (une seule commande Auchan, en livraison ou en
       retrait ; E.Leclerc désactivé ne compte pas), comme dans le panier */
    const mk = await page.evaluate(() => { const S = cabasDebug().S, g = new Set((S.allRets || []).filter((r) => !S.prefs.off[r.group || r.id]).map((r) => r.group || r.id)); return { want: g.size, got: document.querySelectorAll('#view [data-act="maxk"]').length }; });
    if (mk.got !== mk.want) problems.push(`réglages : ${mk.got} choix de « Commandes au plus », ${mk.want} groupes d'enseignes utilisés`);
    /* au clavier, une navigation donne le focus au titre de la nouvelle vue, avec son cadre, jamais à toute la vue */
    await page.focus('#tabbar a[data-tab="rayons"]'); await page.keyboard.press("Enter"); await ready(); await page.waitForTimeout(500);
    const kf = await page.evaluate(() => { const a = document.activeElement, v = document.getElementById("view"); return { tag: a.tagName, inView: v.contains(a), vis: a.matches(":focus-visible") && getComputedStyle(a).outlineStyle !== "none", view: getComputedStyle(v).outlineStyle }; });
    if (kf.tag !== "H1" || !kf.inView || !kf.vis || kf.view !== "none") problems.push("navigation au clavier : focus " + JSON.stringify(kf));
    await page.goto(base + "#/reglages"); await ready();
    await page.click('#view a[href="#/comment/avenir"]'); await ready(); await page.waitForTimeout(600);
    const av = await page.evaluate(() => { const h = document.getElementById("avenir"), l = document.querySelector("#view .soonl"); return h && l ? { top: Math.round(h.getBoundingClientRect().top), focus: document.activeElement === h, items: l.querySelectorAll(":scope > li").length, text: document.getElementById("view").textContent } : null; });
    if (!av) problems.push("à venir : section absente de #/comment/avenir");
    else {
      if (av.top < 40 || av.top > 160 || !av.focus) problems.push(`à venir : titre à ${av.top} px, focus ${av.focus ? "dessus" : "ailleurs"}`);
      if (av.items !== 4) problems.push(`à venir : ${av.items} projets, 4 attendus`);
      if (!/si les enseignes l'acceptent/.test(av.text) || !/Lidl/.test(av.text) || !/Île-de-France/.test(av.text) || !/Remplir mes paniers/.test(av.text)) problems.push("à venir : texte incomplet");
      if (/Jow|Miam|ChatGPT|partenaire officiel/i.test(av.text)) problems.push("à venir : une autre appli ou un partenariat est nommé");
    }
    await page.evaluate(() => window.scrollTo(0, 0)); await page.goto(base + "#/"); await ready();
    await page.goto(base + "#/comment"); await ready(); await page.waitForTimeout(300);
    if ((await page.evaluate(() => window.scrollY)) !== 0) problems.push("comment : la page sans « avenir » ne s'ouvre pas en haut");
    await page.click('#view [data-act="report"][data-k="enseigne"]'); await page.waitForTimeout(500);
    if (!(await page.$('#sheet [data-act="repk"][data-k="enseigne"][aria-checked="true"]'))) problems.push("à venir : la demande ne s'ouvre pas sur « Demander une enseigne ou une ville »");
    await page.fill("#repT", "Lyon 69003, et Lidl");
    await page.click('#sheet [data-act="repok"]'); await page.waitForTimeout(400);
    const gh2 = await page.evaluate(() => { const a = document.querySelector('#sheet a[data-act="repsent"]'); return a ? a.getAttribute("href") : ""; });
    if (!gh2) problems.push("à venir : pas de confirmation avant GitHub");
    else {
      const u = new URL(gh2), t = u.searchParams.get("title") || "", b = u.searchParams.get("body") || "";
      if (!/^Demander une enseigne ou une ville/.test(t) || /69003/.test(t + b) || !/Lyon/.test(b)) problems.push(`à venir : ticket « ${t} » ${b.slice(0, 120)}`);
    }
    await page.click("#sheet .sheet-h [data-act=close]"); await page.waitForTimeout(300);

    /* le bon Auchan d'après le code postal (données publiques de data/retailers.json, code postal sur le téléphone) */
    const ap = await page.evaluate(() => { const D = cabasDebug(); return ["94120", "75015", "75116", "92100", "93100", "78000", "91300", "13001", "123"].map((z) => { const a = D.autoPick(z, "auchan"); return a ? a.id + (a.exact ? "" : "~") : null; }); });
    const apWant = ["auchan", "auchan-alesia", "auchan-bellesfeuilles", "auchan-bellesfeuilles", "auchan", "auchan-bellesfeuilles~", "auchan-alesia~", null, null];
    if (JSON.stringify(ap) !== JSON.stringify(apWant)) problems.push(`autoPick : ${JSON.stringify(ap)} au lieu de ${JSON.stringify(apWant)}`);
    const zs = rets.flatMap((r) => r.zips || []);
    if (new Set(zs).size !== zs.length || zs.some((z) => !/^\d{5}$/.test(z))) problems.push("retailers.json : codes postaux en double ou mal formés");
    for (let a = 1; a <= 20; a++) if (!zs.includes("750" + String(a).padStart(2, "0"))) problems.push(`retailers.json : Paris ${a}e sans point Auchan`);
    const auto = await page.evaluate(() => {
      const D = cabasDebug(), S = D.S, keep = JSON.stringify(S.prefs), out = [];
      S.prefs.pick = { auchan: "auchan" }; S.prefs.pickManual = {}; S.prefs.zip = "75015";
      D.applyAutoPick(); out.push(S.prefs.pick.auchan);
      S.prefs.pick = { auchan: "auchan-livraison-perreux" }; D.applyAutoPick(); out.push(S.prefs.pick.auchan);
      S.prefs.pickManual = { auchan: 1 }; S.prefs.pick = { auchan: "auchan" }; D.applyAutoPick(); out.push(S.prefs.pick.auchan);
      S.prefs = JSON.parse(keep);
      return out;
    });
    if (auto.join() !== "auchan-alesia,auchan-livraison-paris14,auchan") problems.push(`choix automatique d'Auchan : ${auto.join()} (retrait Alésia, livraison Paris 14e, choix à la main gardé attendus)`);
    await page.evaluate(() => localStorage.setItem("cabas.prefs", JSON.stringify({ zip: "92100", off: { leclerc: true } })));
    await page.goto(base + "#/reglages"); await page.reload(); await ready();
    const pk = await page.evaluate(() => ({ pick: cabasDebug().S.prefs.pick.auchan, sw: !!document.querySelector('[data-act="pickauto"]:checked'), txt: (document.querySelector("#pickautoL-auchan small") || {}).textContent || "" }));
    if (!/bellesfeuilles|paris16/.test(pk.pick || "") || !pk.sw || !/92100/.test(pk.txt)) problems.push(`réglages, code postal 92100 : ${JSON.stringify(pk)}`);

    /* affichage : thème, contraste renforcé, mode confort et taille du texte, posés par boot.js avant le premier rendu
       (relevés au moment où la vue apparaît dans la page, avant app.js) */
    await page.addInitScript(() => {
      new MutationObserver(() => { if (!window.__look && document.getElementById("view")) { const d = document.documentElement; window.__look = [d.getAttribute("data-theme"), d.getAttribute("data-contrast") || "", d.hasAttribute("data-simple") ? "confort" : "", d.getAttribute("data-text") || ""].join("|"); } }).observe(document, { childList: true, subtree: true });
    });
    const look = async (prefs, scheme, hash) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.evaluate((p) => { localStorage.setItem("cabas.prefs", JSON.stringify(Object.assign({ off: { leclerc: true } }, p))); localStorage.setItem("cabas.seen", JSON.stringify({ welcome: 1 })); }, prefs);
      await page.goto(base + (hash || "#/reglages")); await page.reload(); await ready();
      return page.evaluate(() => ({ first: window.__look, bg: getComputedStyle(document.body).backgroundColor, ink2: getComputedStyle(document.documentElement).getPropertyValue("--ink-2").trim(), tap: getComputedStyle(document.documentElement).getPropertyValue("--tap").trim() }));
    };
    let L = await look({ theme: "dark" }, "light");
    if (L.first !== "dark|||" || L.bg !== "rgb(0, 0, 0)") problems.push(`thème sombre choisi : ${JSON.stringify(L)}`);
    L = await look({ theme: "light" }, "dark");
    if (L.first !== "light|||" || L.bg === "rgb(0, 0, 0)") problems.push(`thème clair choisi, téléphone en sombre : ${JSON.stringify(L)}`);
    L = await look({}, "dark");
    if (L.first !== "dark|||") problems.push(`thème auto, téléphone en sombre : ${JSON.stringify(L)}`);
    L = await look({ contrast: true }, "light");
    if (L.first !== "light|more||" || L.ink2 !== "#2c2c31") problems.push(`contraste renforcé : ${JSON.stringify(L)}`);
    L = await look({ contrast: true, theme: "dark" }, "light");
    if (L.first !== "dark|more||" || L.ink2 !== "#dcdce2") problems.push(`contraste renforcé sombre : ${JSON.stringify(L)}`);
    /* réglages : le thème et le contraste se changent d'un geste, sans recharger */
    L = await look({}, "light");
    await page.click('[data-act="theme"][data-v="dark"]'); await page.waitForTimeout(250);
    const th = await page.evaluate(() => [document.documentElement.getAttribute("data-theme"), JSON.parse(localStorage.getItem("cabas.prefs")).theme]);
    if (th.join() !== "dark,dark") problems.push(`réglages, thème Sombre : ${th.join()}`);
    await page.click('[data-act="theme"][data-v="auto"]'); await page.waitForTimeout(250);
    await page.evaluate(() => document.querySelector('input[data-act="contrast"]').click()); await page.waitForTimeout(250);
    if ((await page.evaluate(() => document.documentElement.getAttribute("data-contrast"))) !== "more") problems.push("réglages : « Contraste renforcé » ne s'applique pas");
    /* mode confort : cibles de 60 px au moins, une colonne, au plus gros cran de texte */
    await page.evaluate((b) => localStorage.setItem("cabas.basket", JSON.stringify(b)), basket);
    for (const [name, hash] of [["accueil", "#/"], ["recherche", "#/recherche"], ["rayon", "#/rayon/pates"], ["panier", "#/panier"], ["réglages", "#/reglages"], ["frais", "#/frais"]]) {
      L = await look({ simple: true, zoom: "1.25" }, "light", hash);
      if (L.first !== "light||confort|1.25" || L.tap !== "60px") { problems.push(`mode confort (${name}) : ${JSON.stringify(L)}`); break; }
      await page.waitForTimeout(500);
      const small = await page.evaluate(() => {
        const out = [];
        const els = document.querySelectorAll("#view a[href], #view button, #view input, #view [role=radio], #view summary, #tabbar a, #nav button, #nav a");
        for (const el of els) {
          if (el.closest("[hidden], [aria-hidden=true]") || el.type === "hidden") continue;
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight * 3) continue;
          let h = r.height, w = r.width;
          if (el.classList.contains("hit") || (el.parentElement && el.parentElement.classList.contains("hit"))) { h = Math.max(h, 60); w = Math.max(w, 60); }
          if (el.tagName === "INPUT" && el.type === "checkbox" && el.closest(".sw")) { const s = el.closest(".sw").getBoundingClientRect(); h = Math.max(h, s.height + 22); }
          if (h < 59.5 || w < 44) out.push(`${el.tagName.toLowerCase()}.${[...el.classList].join(".")} « ${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30)} » ${Math.round(w)}x${Math.round(h)}`);
        }
        return out;
      });
      if (small.length) problems.push(`mode confort (${name}) : ${small.length} cibles sous 60 px, dont ${small.slice(0, 4).join(" ; ")}`);
      const cols = await page.evaluate(() => { const g = document.querySelector("#view .grid"); return g ? getComputedStyle(g).gridTemplateColumns.split(" ").length : 1; });
      if (cols !== 1) problems.push(`mode confort (${name}) : ${cols} colonnes de produits`);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (over > 0) problems.push(`mode confort (${name}) : déborde de ${over} px en largeur`);
    }
    console.log(`Appli vérifiée : ${cat.products.length} produits, relevé du ${meta.updatedAt}, ${cat.rayons.length} rayons dans ${univ} univers, ${sample.length} rayons ouverts.`);
  } catch (e) {
    problems.push("parcours interrompu : " + e.message.split("\n")[0]);
  }
  await browser.close();
  server.close();
  if (problems.length) { console.log("Problèmes :\n- " + problems.join("\n- ")); process.exit(1); }
  console.log("Aucun problème.");
})();
