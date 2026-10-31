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
  auchan: "auchan\\.fr/[^/?#]+/pr-C?\\d+",
};
const REFUSE = /^(tout refuser|refuser|continuer sans accepter|refuser tout|je refuse)$/i;
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
  const hidden = (el) => /(sr-only|visually-hidden|screen-reader)/i.test(typeof el.className === "string" ? el.className : "");
  const struckEl = (el, tile) => {
    for (let e = el; e && e !== tile.parentElement; e = e.parentElement) {
      if (/^(DEL|S|STRIKE)$/.test(e.tagName)) return true;
      const c = typeof e.className === "string" ? e.className : "";
      if (/(line-through|strike|crossed|old-?price|price-?old|prix-?barre|barre)/i.test(c)) return true;
      try { if ((getComputedStyle(e).textDecorationLine || "").includes("line-through")) return true; } catch (err) { /* élément détaché */ }
    }
    return false;
  };
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
    // nom : l'attribut title du lien quand l'enseigne le donne complet (Houra : « Marque Désignation, contenance »),
    // sinon le plus long texte de lien, titre ou texte alternatif d'image qui n'est pas un prix
    let name = as.map((a) => (a.getAttribute("title") || "").trim()).find((t) => t.length >= 4) || "";
    if (cfg.retailer === "auchan") {
      // Auchan : « MARQUE Désignation » dans le bloc de description de la vignette, contenance dans une pastille à part
      const d = tile.querySelector("[class*=description], [class*=Description], [class*=title], [class*=Title]");
      const t = d ? text(d).replace(/\s+/g, " ") : "";
      if (t && !/€/.test(t) && t.length >= 4) name = t;
    }
    if (!name || (cfg.retailer !== "houra" && cfg.retailer !== "auchan")) {
      const cands = [];
      for (const a of as) cands.push(text(a), a.getAttribute("title") || "", a.getAttribute("aria-label") || "");
      tile.querySelectorAll("h1,h2,h3,h4,[class*=title],[class*=Title],[class*=name],[class*=Name]").forEach((e) => cands.push(text(e)));
      tile.querySelectorAll("img[alt]").forEach((i) => cands.push(i.getAttribute("alt") || ""));
      name = cands.map((c) => c.replace(/\s+/g, " ").trim()).filter((c) => c.length >= 4 && c.length <= 220 && !/^\d+[,.]\d{2}\s?€/.test(c) && !/^(ajouter|voir|découvrir|choisir|acheter|ouvrir)/i.test(c))
        .sort((a, b) => b.length - a.length)[0] || "";
    }
    // prix : le montant affiché en plus gros caractères qui n'est ni barré, ni un prix au kilo ou au litre,
    // ni un montant d'offre (« Cagnottez 0,23 € », « -1 € »), ni un texte masqué
    let price = null, was = null, best = null;
    const walker = document.createTreeWalker(tile, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || hidden(el)) continue;
      const t = (n.nodeValue || "").replace(/ /g, " ");
      if (!/€/.test(t) || UNIT.test(t) || /€\s?\/\s?\w/.test(t)) continue;
      if (el.closest("button")) continue;
      if (/(cagnott|économ|econom|remise|offert|gagn|fidélit|fidelit|bon d|soit|avantage|crédit|credit|reduc|réduc|%|^\s*-)/i.test(t)) continue;
      let size = 0;
      try { size = parseFloat(getComputedStyle(el).fontSize) || 0; } catch (err) { size = 0; }
      PRICE.lastIndex = 0;
      let m;
      while ((m = PRICE.exec(t))) {
        const v = num(m);
        if (struckEl(el, tile)) { if (was == null) was = v; continue; }
        if (!best || size > best.size) best = { v, size };
      }
    }
    price = best ? best.v : null;
    if (price == null || !(price > 0)) continue;
    const um = full.match(UNIT);
    const fm = full.match(/\b(?:le|la|les|l')\s?(?:lot|pack|bouteille|bouteilles|brique|briques|pot|pots|sachet|sachets|paquet|paquets|boîte|boîtes|boite|flacon|bidon|barquette|étui|tube|rouleaux|canette|canettes|bocal)\b[^\n€]{0,70}/i)
      || full.match(/\b\d+\s?x\s?\(?\d+(?:[,.]\d+)?\s?(?:cl|l|ml|g|kg)\b[^\n€]{0,20}/i)
      || full.match(/\b\d+\s(?:pots|rouleaux|briques|bouteilles|canettes|sachets|lavages)\b/i);
    const lines = full.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const pm = lines.find((l) => /(-\s?\d+\s?%|\d+\s?(?:e|ème)\s(?:à|offert)|2ème|2e\b|offert|cagnott|remise|payez|prenez|gratuit)/i.test(l) && l.length < 120 && !/€\s?\//.test(l));
    const o = { name, price, was: was != null && was > price ? was : null, unit: um ? um[0] : null, promo: pm || null };
    if (fm && cfg.retailer !== "houra") o.format = fm[0].trim();
    if (cfg.retailer === "auchan") {
      const chip = lines.find((l) => /^\d+(?:[,.]\d+)?\s?(?:x\s?\d+(?:[,.]\d+)?\s?)?(?:cl|l|ml|g|kg)$/i.test(l))
        /* œufs, papier, lessive : la pastille compte des pièces (« x12 », « 12 pièces », « boîte de 6 ») */
        || lines.find((l) => /^(?:x\s?\d{1,3}|\d{1,3}\s?(?:x\s?\d{1,3}\s?)?(?:pièces?|pieces?|pcs|œufs|oeufs|unités?|unites?|rouleaux|lavages|dosettes|capsules)|(?:boîte|boite|lot|étui|etui|plateau) de \d{1,3}(?:\s?(?:œufs|oeufs|pièces|pieces))?)$/i.test(l));
      if (chip) o.format = chip;
    }
    if (cfg.retailer === "carrefour") { o.title = name; o.href = new URL(href).pathname; }
    else o.url = href;
    out.push(o);
  }
  const next = document.querySelector("a[rel=next], link[rel=next]");
  return { products: out, next_page: next ? next.href : null, title: document.title };
}

async function clickText(page, re, within) {
  for (const el of await page.$$(within || "button, a, [role=button]")) {
    const t = ((await el.innerText().catch(() => "")) || (await el.getAttribute("aria-label").catch(() => "")) || "").replace(/\s+/g, " ").trim();
    if (re.test(t) && (await el.isVisible().catch(() => false))) { await el.click({ timeout: 5000 }).catch(() => {}); return t; }
  }
  return null;
}

/* Choix du magasin, comme une personne : enseignes dont les prix dépendent du magasin (réglage « magasins » de
   tools/sources.json). On ne choisit jamais une livraison à domicile, qui demanderait une adresse. */
const STORE = {
  async auchan(page, st) {
    await page.goto("https://www.auchan.fr/", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3500);
    await clickText(page, REFUSE);
    await page.waitForTimeout(1000);
    await clickText(page, /choisir vos courses|choisir (un|mon|votre) (magasin|drive)/i);
    await page.waitForTimeout(2500);
    let typed = false;
    for (const i of await page.$$("input")) {
      const h = [await i.getAttribute("placeholder"), await i.getAttribute("aria-label")].join(" ");
      if (/code postal/i.test(h) && (await i.isVisible().catch(() => false))) { await i.click().catch(() => {}); await i.type(st.lieu, { delay: 60 }); typed = true; break; }
    }
    if (!typed) return null;
    await page.waitForTimeout(3500);
    await clickText(page, new RegExp(st.lieu.split("-")[0], "i"), "li, [role=option], button, a");
    await page.waitForTimeout(4000);
    // carte voulue : un point de retrait (st.retrait), ou la livraison à domicile de la zone (st.livraison)
    const label = await page.evaluate(({ want, home }) => {
      const W = new RegExp(want, "i");
      for (const b of document.querySelectorAll("button, a")) {
        if (!/^\s*choisir\s*$/i.test(b.innerText || "")) continue;
        let card = b;
        for (let k = 0; k < 6 && card.parentElement; k++) { card = card.parentElement; if ((card.innerText || "").length > 40) break; }
        const t = (card.innerText || "").replace(/\s+/g, " ");
        if (W.test(t) && home === /livraison à domicile/i.test(t)) { b.click(); return t.slice(0, 120); }
      }
      return null;
    }, { want: st.livraison ? "livraison à domicile" : st.retrait, home: !!st.livraison });
    await page.waitForTimeout(4000);
    if (label && st.livraison) {
      // certaines zones demandent une adresse : on donne l'adresse publique de la zone (sa mairie), jamais celle d'un utilisateur
      for (const i of await page.$$("input")) {
        const h = [await i.getAttribute("placeholder"), await i.getAttribute("aria-label")].join(" ");
        if (/rechercher un produit|code postal/i.test(h) || !(await i.isVisible().catch(() => false))) continue;
        await i.click().catch(() => {});
        await i.type(st.livraison.adresse, { delay: 50 }).catch(() => {});
        await page.waitForTimeout(3500);
        const want = new RegExp(st.livraison.choisir, "i");
        for (const el of await page.$$("li, [role=option]")) {
          const t = ((await el.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
          if (want.test(t) && t.length < 120 && (await el.isVisible().catch(() => false))) { await el.click().catch(() => {}); break; }
        }
        await page.waitForTimeout(4000);
        break;
      }
      const ok = await page.evaluate(() => /livraison à\s*:/i.test(document.body.innerText || "") || /livrées à/i.test(document.body.innerText || ""));
      if (!ok) return null;
    }
    return label;
  },
};

// enseigne d'une source : « auchan-alesia » est un point de retrait Auchan (réglage « magasins » de tools/sources.json)
let STORES = {};
const brandOf = (retailer) => (STORES[retailer] && STORES[retailer].enseigne) || retailer.split("-")[0];

// Page d'un rayon trouvée depuis la page d'un grand rayon (réglage « from » et « find » de tools/sources.json) : on suit,
// étape par étape, le premier lien du catalogue dont le texte correspond ; l'adresse trouvée est notée pour build.py.
const plain = (t) => String(t || "").toLowerCase().replace(/œ/g, "oe").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
async function discover(page, src) {
  let url = src.from, depth = 0;
  const steps = [].concat(src.find);
  for (const step of steps) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2500);
    const re = new RegExp(step, "i");
    const links = await page.evaluate(() => [...document.querySelectorAll("a[href*='/catalogue/']")].map((a) => ({ href: a.href, text: (a.textContent || "").replace(/\s+/g, " ").trim() })));
    const norm = (t) => t.toLowerCase().replace(/œ/g, "oe").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const hit = links.find((l) => l.text && re.test(norm(l.text)));
    if (!hit) {
      // première étape manquée : rien à lire ; étape suivante manquée : la page atteinte est lue, le filtre du rayon
      // (RAYON_FILTRE dans tools/lib.py) garde ce qui est le produit du rayon
      const seen = [...new Set(links.map((l) => l.text).filter(Boolean))].slice(0, 80).join(" | ");
      if (!depth) throw new Error(`aucun lien « ${step} » sur ${url} ; liens : ${seen}`);
      console.log(`${src.retailer} ${src.rayon} : pas de lien « ${step} » sur ${url}, page lue telle quelle`);
      break;
    }
    url = hit.href;
    depth++;
    console.log(`${src.retailer} ${src.rayon} : « ${hit.text} » ${url}`);
  }
  const m = /-(B\d+)-\d+\.html/.exec(url);
  return { url, match: m ? m[1] : url };
}

async function readPage(page, src) {
  const res = await page.goto(src.url, { waitUntil: "domcontentloaded", timeout: 45000 });
  const status = res ? res.status() : 0;
  await page.waitForTimeout(2500);
  // faire défiler pour charger les vignettes paresseuses, jusqu'à ce que le nombre de liens produit se stabilise
  let last = -1;
  for (let i = 0; i < 14; i++) {
    const n = await page.evaluate((p) => [...document.querySelectorAll("a[href]")].filter((a) => new RegExp(p).test(a.href.split("?")[0])).length, PRODUCT[brandOf(src.retailer)]);
    if (n === last && i > 2) break;
    last = n;
    await page.mouse.wheel(0, 2200);
    await page.waitForTimeout(900);
  }
  const data = await page.evaluate(extractInPage, { product: PRODUCT[brandOf(src.retailer)], retailer: brandOf(src.retailer) });
  return { status, ...data };
}

(async () => {
  const conf = JSON.parse(fs.readFileSync(path.join(__dirname, "sources.json"), "utf8"));
  const robot = conf.robot || {};
  // une enseigne dont le site refuse les robots n'est pas relue par ce script (voir « robot » dans tools/sources.json)
  const sources = conf.pages.filter((p) => (only.length ? only.includes(p.retailer) : robot[p.retailer] !== false));
  console.log("Enseignes relues par le robot :", [...new Set(sources.map((p) => p.retailer))].join(", ") || "aucune");
  fs.mkdirSync(WORK, { recursive: true });
  if (diag) fs.mkdirSync(path.join(WORK, "diag"), { recursive: true });
  const browser = await chromium.launch();
  const fresh = async () => browser.newContext({ userAgent: UA, locale: "fr-FR", timezoneId: "Europe/Paris", viewport: { width: 1366, height: 900 } });
  let ctx = await fresh();
  let page = await ctx.newPage();
  const rows = [], summary = [];
  const done = new Set();
  const chosen = {};
  let current = null;
  STORES = conf.magasins || {};
  const queue = sources.map((s) => ({ ...s }));
  const discovered = [];
  while (queue.length) {
    const src = queue.shift();
    if (src.from && !src.url) {
      try { Object.assign(src, await discover(page, src)); discovered.push({ retailer: src.retailer, rayon: src.rayon, host: src.host, match: src.match, url: src.url, prompt: src.prompt || "" }); }
      catch (e) { summary.push({ retailer: src.retailer, rayon: src.rayon, url: src.from, status: 0, products: 0, error: String(e.message || e).split("\n")[0] }); console.log(`${src.retailer} ${src.rayon} : ${String(e.message || e).split("\n")[0]}`); continue; }
    }
    const key = STORES[src.retailer] ? src.url : src.url.split("?")[0];
    if (done.has(key)) continue;
    done.add(key);
    // un point de retrait se choisit à chaque changement d'enseigne ou de point (le choix précédent est remplacé)
    const chooser = STORES[src.retailer] && STORE[brandOf(src.retailer)];
    if (chooser && current !== src.retailer) {
      // navigateur neuf pour chaque point de retrait : aucun choix précédent ne reste en mémoire
      await ctx.close();
      ctx = await fresh();
      page = await ctx.newPage();
      chosen[src.retailer] = await chooser(page, STORES[src.retailer]).catch((e) => null);
      current = src.retailer;
      console.log(`${src.retailer} : point de retrait ${chosen[src.retailer] ? "choisi, " + chosen[src.retailer] : "non choisi, pages ignorées"}`);
    }
    if (chooser && !chosen[src.retailer]) { summary.push({ retailer: src.retailer, rayon: src.rayon, url: src.url, status: 0, products: 0, error: "point de retrait non choisi" }); continue; }
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
  fs.writeFileSync(path.join(WORK, "discovered.json"), JSON.stringify(discovered, null, 1));
  fs.writeFileSync(path.join(WORK, "scrape.json"), JSON.stringify(summary, null, 1));
  const by = {};
  for (const s of summary) { by[s.retailer] = by[s.retailer] || { pages: 0, lues: 0, produits: 0 }; by[s.retailer].pages++; if (s.products) by[s.retailer].lues++; by[s.retailer].produits += s.products; }
  console.log("Bilan :", JSON.stringify(by));
})();
