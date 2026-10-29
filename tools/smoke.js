// Test rapide de l'appli après une mise à jour : sert le dépôt en local, ouvre les écrans principaux
// au format iPhone et vérifie qu'ils s'affichent sans erreur. Code de sortie 1 en cas de problème.
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
    const cat = await page.evaluate(() => fetch("data/catalog.json").then((r) => r.json()));
    const meta = await page.evaluate(() => fetch("data/meta.json").then((r) => r.json()));
    for (const r of cat.rayons) {
      await page.goto(base + "#/rayon/" + r.id); await ready();
      await check("rayon " + r.id, ".card", 1);
    }
    const multi = cat.products.filter((p) => Object.keys(p.offers).length > 1);
    await page.goto(base + "#/produit/" + encodeURIComponent(multi[0].id)); await ready();
    await check("fiche produit", ".offer", 2);
    const basket = {};
    multi.slice(0, 14).forEach((p) => { basket[p.id] = 2; });
    await page.evaluate((b) => localStorage.setItem("cabas.basket", JSON.stringify(b)), basket);
    await page.goto(base + "#/panier"); await page.reload(); await ready();
    await page.waitForTimeout(800);
    await check("panier", ".sum .st", 1);
    await check("panier", ".order", 1);
    await page.goto(base + "#/recherche"); await ready();
    await page.fill("#q", "lait"); await page.waitForTimeout(500);
    await check("recherche", "#sres .card", 1);
    console.log(`Appli vérifiée : ${cat.products.length} produits, relevé du ${meta.updatedAt}, ${cat.rayons.length} rayons ouverts.`);
  } catch (e) {
    problems.push("parcours interrompu : " + e.message.split("\n")[0]);
  }
  await browser.close();
  server.close();
  if (problems.length) { console.log("Problèmes :\n- " + problems.join("\n- ")); process.exit(1); }
  console.log("Aucun problème.");
})();
