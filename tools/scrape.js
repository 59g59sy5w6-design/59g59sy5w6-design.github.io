// Relevé automatique des prix : ouvre chaque page rayon de tools/sources.json dans un navigateur (Playwright),
// comme le ferait une personne, et en extrait les produits (nom, contenance, prix, prix barré, prix au kilo, offre, lien).
// Aucune tentative de contourner un blocage : une page refusée est notée et garde ses prix précédents (tools/build.py).
// Sortie : tools/work/fetches.json, au même format que tools/dump.py, puis tools/build.py prend le relais.
// Usage : node tools/scrape.js [--only monoprix,houra] [--diag]
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const WORK = path.join(__dirname, "work");
const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith("--only=")) || "").slice(7).split(",").filter(Boolean);
const diag = args.includes("--diag");

// liens de fiche produit propres à chaque enseigne
const PRODUCT = {
  monoprix: "/products/[^/?#]+/MPX_\\d+",
  houra: "houra\\.fr/[^/?#]+/\\d{5,}/?$",
  carrefour: "/p/[^/?#]+-\\d{8,14}$",
};
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Exécuté dans la page : repère chaque lien de fiche produit, remonte jusqu'à la vignette qui ne contient que ce
   produit, puis lit le nom, le prix, le prix barré, le prix à l'unité, la contenance et l'offre affichés dans la vignette. */
function extractInPage(cfg) {
  const re = new RegExp(cfg.product);
  const clean = (h) => (h || "").split("#")[0].split("?")[0];
  const isProd = (a) => re.test(clean(a.href));
  const links = [...document.querySelectorAll("a[href]")].filter(isProd);
  const groups = new Map();
  for (const a of links) { const h = clean(a.href); if (!groups.has(h)) groups.set(h, []); groups.get(h).push(a); }
  const PRICE = /(\d{1,4})\s?[,.]\s?(\d{2})\s?€|(\d{1,4})\s?€\s?(\d{2})\b/g;
  const UNIT = /(\d{1,4}[,.]\d{2})\s?€\s?\/\s?(kg|kilo|l|litre|unité|unite|pièce|piece|article|lavage|rouleau|100\s?g|100\s?ml)\b/i;
  const text = (el) => (el ? (el.innerText || el.textContent || "").replace(/ /g, " ").trim() : "");
  const num = (m) => (m[1] != null ? parseFloat(m[1] + "." + m[2]) : parseFloat(m[3] + "." + m[4]));
  const out = [];
  for (const [href, as] of groups) {
    let tile = null;
    for (let el = as[0].parentElement; el && el !== document.body; el = el.parentElement) {
      const hs = new Set([...el.querySelectorAll("a[href]")].filter(isProd).map((a) => clean(a.href)));
      if (hs.size > 1) break;
      tile = el;
    }
    if (!tile) continue;
    const full = text(tile);
    if (!full) continue;
    // nom : le plus long texte de lien, titre ou texte alternatif d'image qui n'est pas un prix
    const cands = [];
    for (const a of as) { cands.push(text(a), a.getAttribute("title") || "", a.getAttribute("aria-label") || ""); }
    tile.querySelectorAll("h1,h2,h3,h4,[class*=title],[class*=Title],[class*=name],[class*=Name],[class*=label],[class*=Label]").forEach((e) => cands.push(text(e)));
    tile.querySelectorAll("img[alt]").forEach((i) => cands.push(i.getAttribute("alt") || ""));
    const name = cands.map((c) => c.replace(/\s+/g, " ").trim()).filter((c) => c.length >= 4 && c.length <= 220 && !/^\d+[,.]\d{2}\s?€/.test(c) && !/^(ajouter|voir|découvrir|choisir|acheter)/i.test(c))
      .sort((a, b) => b.length - a.length)[0] || "";
    // prix barrés : éléments del, s, ou classes « old », « strike », « crossed », « barre »
    const struck = new Set();
    tile.querySelectorAll("del,s,strike,[class*=old],[class*=Old],[class*=strike],[class*=Strike],[class*=crossed],[class*=Crossed],[class*=barre],[class*=before],[class*=Before]").forEach((e) => { const t = text(e); let m; PRICE.lastIndex = 0; while ((m = PRICE.exec(t))) struck.add(num(m)); });
    let price = null, was = null;
    const lines = full.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    for (const l of lines) {
      if (UNIT.test(l) || /\/\s?(kg|l|litre|kilo|unité|lavage|rouleau)\b/i.test(l)) continue;
      PRICE.lastIndex = 0;
      let m;
      while ((m = PRICE.exec(l))) {
        const v = num(m);
        if (struck.has(v)) { if (was == null) was = v; continue; }
        if (price == null) price = v;
      }
      if (price != null) break;
    }
    if (price == null || !(price > 0)) continue;
    const um = full.match(UNIT);
    const fm = full.match(/\b(?:le|la|les|l')\s?(?:lot|pack|bouteille|bouteilles|brique|briques|pot|pots|sachet|sachets|paquet|paquets|boîte|boîtes|boite|flacon|bidon|barquette|étui|tube|rouleaux|canette|canettes|bocal)\b[^\n€]{0,70}/i)
      || full.match(/\b\d+\s?x\s?\(?\d+(?:[,.]\d+)?\s?(?:cl|l|ml|g|kg)\b[^\n€]{0,20}/i)
      || full.match(/\b\d+\s(?:pots|rouleaux|briques|bouteilles|canettes|sachets|lavages)\b/i);
    const pm = lines.find((l) => /(-\s?\d+\s?%|\d+\s?(?:e|ème)\s(?:à|offert)|2ème|offert|cagnott|remise|payez|prenez|gratuit)/i.test(l) && l.length < 120);
    const o = { name, price, was: was != null && was > price ? was : null, unit: um ? um[0] : null, promo: pm || null };
    if (fm) o.format = fm[0].trim();
    if (cfg.retailer === "carrefour") { o.title = name; o.href = new URL(href).pathname; }
    else o.url = href;
    out.push(o);
  }
  const next = document.querySelector("a[rel=next], link[rel=next]");
  return { products: out, next_page: next ? next.href : null, title: document.title };
}

async function readPage(page, src) {
  const res = await page.goto(src.url, { waitUntil: "domcontentloaded", timeout: 45000 });
  const status = res ? res.status() : 0;
  await page.waitForTimeout(2500);
  // faire défiler pour charger les vignettes paresseuses, jusqu'à ce que le nombre de liens produit se stabilise
  let last = -1;
  for (let i = 0; i < 14; i++) {
    const n = await page.evaluate((p) => [...document.querySelectorAll("a[href]")].filter((a) => new RegExp(p).test(a.href.split("?")[0])).length, PRODUCT[src.retailer]);
    if (n === last && i > 2) break;
    last = n;
    await page.mouse.wheel(0, 2200);
    await page.waitForTimeout(900);
  }
  const data = await page.evaluate(extractInPage, { product: PRODUCT[src.retailer], retailer: src.retailer });
  return { status, ...data };
}

(async () => {
  const sources = JSON.parse(fs.readFileSync(path.join(__dirname, "sources.json"), "utf8")).pages.filter((p) => !only.length || only.includes(p.retailer));
  fs.mkdirSync(WORK, { recursive: true });
  if (diag) fs.mkdirSync(path.join(WORK, "diag"), { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ userAgent: UA, locale: "fr-FR", timezoneId: "Europe/Paris", viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  const rows = [], summary = [];
  const done = new Set();
  const queue = sources.map((s) => ({ ...s }));
  while (queue.length) {
    const src = queue.shift();
    const key = src.url.split("?")[0];
    if (done.has(key)) continue;
    done.add(key);
    let r = null, err = null;
    for (let attempt = 0; attempt < 2 && !r; attempt++) {
      try { r = await readPage(page, src); } catch (e) { err = String(e.message || e).split("\n")[0]; await sleep(4000); }
    }
    const ts = new Date().toISOString();
    const n = r ? r.products.length : 0;
    summary.push({ retailer: src.retailer, rayon: src.rayon, url: src.url, status: r ? r.status : 0, products: n, error: err && !r ? err : null, title: r ? r.title : null });
    console.log(`${src.retailer.padEnd(9)} ${src.rayon.padEnd(9)} ${String(r ? r.status : "ERR").padEnd(4)} ${String(n).padStart(3)} produits  ${src.url}${err && !r ? "  " + err : ""}`);
    if (r) {
      rows.push({ url: src.url, prompt: src.prompt, text: JSON.stringify(src.retailer === "carrefour" ? r.products : { products: r.products, next_page: r.next_page }), ts });
      if (r.next_page && src.retailer === "houra" && !done.has(r.next_page.split("?")[0]) && queue.length < 200 && /-\d+\.html/.test(r.next_page)) queue.unshift({ ...src, url: r.next_page });
      if (diag) {
        const slug = `${src.retailer}-${src.rayon}-${done.size}`;
        fs.writeFileSync(path.join(WORK, "diag", slug + ".json"), JSON.stringify({ src: src.url, status: r.status, title: r.title, products: r.products.slice(0, 8) }, null, 1));
        if (n < 3) fs.writeFileSync(path.join(WORK, "diag", slug + ".html"), await page.content());
      }
    }
    await sleep(1500 + Math.random() * 1500);
  }
  await browser.close();
  fs.writeFileSync(path.join(WORK, "fetches.json"), JSON.stringify(rows));
  fs.writeFileSync(path.join(WORK, "scrape.json"), JSON.stringify(summary, null, 1));
  const by = {};
  for (const s of summary) { by[s.retailer] = by[s.retailer] || { pages: 0, lues: 0, produits: 0 }; by[s.retailer].pages++; if (s.products) by[s.retailer].lues++; by[s.retailer].produits += s.products; }
  console.log("Bilan :", JSON.stringify(by));
})();
