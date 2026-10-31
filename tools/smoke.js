// Test rapide de l'appli après une mise à jour : sert le dépôt en local, ouvre les écrans principaux
// au format iPhone (accueil, Rayons par univers, un rayon par univers, fiche produit avec ses détails, panier, recherche,
// À propos) et vérifie qu'ils s'affichent sans erreur. Code de sortie 1 en cas de problème.
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
  const page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push("erreur JS : " + e.message));
  page.on("console", (m) => { if (m.type() === "error") problems.push("console : " + m.text()); });
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
    const multi = cat.products.filter((p) => (p.o || []).length > 1);
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
    await page.goto(base + "#/recherche"); await ready();
    await page.fill("#q", "lait"); await page.waitForTimeout(500);
    await check("recherche", "#sres .card", 1);
    await check("recherche", "#sres .hcard", 1);
    await page.goto(base + "#/apropos"); await ready();
    await check("à propos", "details.adv", 1);
    console.log(`Appli vérifiée : ${cat.products.length} produits, relevé du ${meta.updatedAt}, ${cat.rayons.length} rayons dans ${univ} univers, ${sample.length} rayons ouverts.`);
  } catch (e) {
    problems.push("parcours interrompu : " + e.message.split("\n")[0]);
  }
  await browser.close();
  server.close();
  if (problems.length) { console.log("Problèmes :\n- " + problems.join("\n- ")); process.exit(1); }
  console.log("Aucun problème.");
})();
