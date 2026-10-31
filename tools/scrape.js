// Relevé automatique des prix : ouvre chaque page rayon de tools/sources.json dans un navigateur (Playwright),
// comme le ferait une personne, et en extrait les produits (nom, contenance, prix, prix barré, prix au kilo, offre, lien).
// Aucune tentative de contourner un blocage : une page refusée est notée et garde ses prix précédents (tools/build.py).
// Sorties, dans tools/work : fetches.json (au même format que tools/dump.py, avec l'adresse demandée et l'adresse
// finale de chaque page ; tools/build.py prend le relais), discovered.json (pages Houra trouvées ce passage, fusionnées
// avec tools/state/discovered.json, lu au départ), journal/<cible>.json (compte rendu du passage) et scrape.json (le
// même compte rendu, pour le diagnostic).
// Usage : node tools/scrape.js [--only=houra,auchan-alesia] [--lot=frais,epicerie-1,cremerie] [--max=3] [--diag]
//   --only : enseignes à relire, chaque magasin ou zone Auchan comptant à part (auchan, auchan-alesia...) ;
//   --lot : lots du robot (clé lots_robot de tools/sources.json), lots de lecture (champ lot des pages) ou univers ;
//   --max : nombre de pages lues au plus (essai) ; --diag : extraits de pages dans tools/work/diag.
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const WORK = path.join(__dirname, "work");
const DISCOVERED = path.join(__dirname, "state", "discovered.json");
const args = process.argv.slice(2);
const opt = (name) => (args.find((a) => a.startsWith(`--${name}=`)) || "").slice(name.length + 3);
const list = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);
const only = list(opt("only"));
const lot = list(opt("lot"));
const max = parseInt(opt("max"), 10) || 0;
const diag = args.includes("--diag");
// nom de la cible du passage (journal) : enseignes et lots demandés, « tout » sans filtre
const cible = [only.length ? only.join("+") : "tout", lot.join("+")].filter(Boolean).join("-").replace(/[^a-z0-9+_.-]/gi, "_");

const MAX_PAGES = 3;    // pages suivies par rayon chez Houra (50 produits par page) : au-delà, le rayon est assez fourni
const MAX_TILES = 200;  // vignettes lues au plus sur une page (les recherches Auchan n'ont pas de fin)
const WHEEL = { auchan: 30, houra: 14 };  // coups de molette au plus pour charger les vignettes paresseuses

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
   produit, puis lit le nom, le prix, le prix barré, le prix à l'unité, la contenance et l'offre affichés dans la vignette.
   Au plus cfg.max vignettes, dans l'ordre de la page. */
function extractInPage(cfg) {
  const re = new RegExp(cfg.product);
  const clean = (h) => (h || "").split("#")[0].split("?")[0];
  const isProd = (a) => re.test(clean(a.href));
  const links = [...document.querySelectorAll("a[href]")].filter(isProd);
  const groups = new Map();
  for (const a of links) { const h = clean(a.href); if (!groups.has(h)) groups.set(h, []); groups.get(h).push(a); }
  const PRICE = /(\d{1,4})\s?[,.]\s?(\d{2})\s?€|(\d{1,4})\s?€\s?(\d{2})\b/g;
  // prix à l'unité de mesure : « 2,49 €/kg », « 2,49 € / kilo », « 2,49 € le kilo », « 12,90 € le kg »
  const UNIT = /(\d{1,4}[,.]\d{2})\s?€\s?(?:\/|le|la|par|du)\s?(kg|kilo|kilogramme|l|litre|unité|unite|pièce|piece|article|lavage|rouleau|100\s?g|100\s?ml)\b/i;
  const text = (el) => (el ? (el.innerText || el.textContent || "").replace(/ /g, " ").trim() : "");
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
    if (cfg.max && out.length >= cfg.max) break;
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
      const t = (n.nodeValue || "").replace(/ /g, " ");
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
    // conditionnement : « le lot de 6 bouteilles de 1 L », « la pièce de 300 g env. », « 1,2 kg environ », « le kg »,
    // « la barquette de 2 pièces », « 6 x 1,5 L », « 12 rouleaux »
    const fm = full.match(/\b(?:le|la|les|l')\s?(?:lot|pack|bouteille|bouteilles|brique|briques|pot|pots|sachet|sachets|paquet|paquets|boîte|boîtes|boite|flacon|bidon|barquette|barquettes|étui|tube|rouleaux|canette|canettes|bocal|pièce|pièces|piece|pieces|botte|filet|plateau|portion|tranche|tranches|kg|kilo|demi)\b[^\n€]{0,70}/i)
      || full.match(/\b\d+(?:[,.]\d+)?\s?(?:g|kg)\s?(?:environ|env\.?|approx\.?)\b[^\n€]{0,20}/i)
      || full.match(/\b(?:environ|env\.?)\s?\d+(?:[,.]\d+)?\s?(?:g|kg)\b/i)
      || full.match(/\b\d+\s?x\s?\(?\d+(?:[,.]\d+)?\s?(?:cl|l|ml|g|kg)\b[^\n€]{0,20}/i)
      || full.match(/\b\d+\s(?:pots|rouleaux|briques|bouteilles|canettes|sachets|lavages)\b/i);
    const lines = full.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const pm = lines.find((l) => /(-\s?\d+\s?%|\d+\s?(?:e|ème)\s(?:à|offert)|2ème|2e\b|offert|cagnott|remise|payez|prenez|gratuit)/i.test(l) && l.length < 120 && !/€\s?\//.test(l));
    const o = { name, price, was: was != null && was > price ? was : null, unit: um ? um[0] : null, promo: pm || null };
    if (fm && cfg.retailer !== "houra") o.format = fm[0].trim();
    if (cfg.retailer === "auchan") {
      const chip = lines.find((l) => /^\d+(?:[,.]\d+)?\s?(?:x\s?\d+(?:[,.]\d+)?\s?)?(?:cl|l|ml|g|kg)(?:\s?(?:environ|env\.?))?$/i.test(l))
        /* œufs, papier, lessive : la pastille compte des pièces (« x12 », « 12 pièces », « boîte de 6 ») */
        || lines.find((l) => /^(?:x\s?\d{1,3}|\d{1,3}\s?(?:x\s?\d{1,3}\s?)?(?:pièces?|pieces?|pcs|œufs|oeufs|unités?|unites?|rouleaux|lavages|dosettes|capsules)|(?:boîte|boite|lot|étui|etui|plateau) de \d{1,3}(?:\s?(?:œufs|oeufs|pièces|pieces))?)$/i.test(l))
        /* frais au poids variable : « la pièce », « le kg », « la barquette de 500 g env. » */
        || lines.find((l) => /^(?:la pièce|la piece|le kg|le kilo|la botte|le filet|la barquette|le sachet)(?: de \d+(?:[,.]\d+)?\s?(?:g|kg)(?:\s?(?:environ|env\.?))?)?$/i.test(l));
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

/* Les pages de tools/sources.json, dépliées comme le fait lib.load_sources() : chaque requête Auchan n'y est écrite
   qu'une fois (« retailer »: « auchan* ») et vaut pour chaque magasin et zone de la clé magasins, avec le fragment du
   point (#alesia, #livraison-perreux) ajouté à l'adresse et au repère match. */
function unfold(conf) {
  const stores = Object.entries(conf.magasins || {}).filter(([, c]) => c.enseigne === "auchan").map(([m]) => m);
  const frag = (m) => (m === "auchan" ? "" : "#" + m.slice("auchan-".length));
  const out = [];
  for (const p of conf.pages) {
    if (p.retailer !== "auchan*") { out.push(p); continue; }
    for (const m of stores) out.push({ ...p, retailer: m, url: p.url + frag(m), match: p.match + frag(m) });
  }
  return out;
}

/* Pages demandées : --only garde des enseignes (un magasin ou une zone Auchan compte à part) ; --lot garde des lots du
   robot (clé lots_robot de tools/sources.json, chacun une liste d'univers), des lots de lecture (champ lot des pages)
   ou des univers. Sans --only, une enseigne dont le site refuse les robots n'est pas relue (réglage robot). */
function selectPages(conf) {
  const robot = conf.robot || {};
  const rayons = JSON.parse(fs.readFileSync(path.join(__dirname, "rayons.json"), "utf8"));
  const universOf = {};
  for (const r of rayons.rayons) universOf[r.id] = r.univers;
  const universIds = new Set(rayons.univers.map((u) => u.id));
  const robotLots = conf.lots_robot || {};
  const pageLots = new Set(conf.pages.map((p) => p.lot).filter(Boolean));
  const univers = new Set(), lots = new Set();
  for (const l of lot) {
    if (robotLots[l]) robotLots[l].forEach((u) => univers.add(u));
    else if (universIds.has(l)) univers.add(l);
    else if (pageLots.has(l)) lots.add(l);
    else {
      console.error(`Lot inconnu : ${l}. Lots du robot : ${Object.keys(robotLots).join(", ")} ; lots de lecture : ${[...pageLots].join(", ")} ; ou un univers.`);
      process.exit(2);
    }
  }
  return unfold(conf).filter((p) => (only.length ? only.includes(p.retailer) : robot[p.retailer] !== false))
    .filter((p) => !lot.length || univers.has(universOf[p.rayon]) || lots.has(p.lot));
}

// Page d'un rayon trouvée depuis la page d'un grand rayon (réglage « from » et « find » de tools/sources.json) : on suit,
// étape par étape, le premier lien du catalogue dont le texte correspond, d'abord parmi les liens du menu (nav, aside,
// menu, catégories) puis parmi tous ; un lien dont le texte entier correspond passe avant un lien qui ne fait que
// contenir l'expression (« Lait » avant « Lait infantile »). L'adresse trouvée et le texte des liens suivis sont notés.
const plain = (t) => String(t || "").toLowerCase().replace(/œ/g, "oe").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
async function discover(page, src) {
  let url = src.from, depth = 0;
  const steps = [].concat(src.find);
  const texts = [];
  for (const step of steps) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2500);
    const re = new RegExp(step, "i");
    const whole = new RegExp(`^(?:${step})$`, "i");
    const links = await page.evaluate(() => {
      const read = (root) => [...root.querySelectorAll("a[href*='/catalogue/']")].map((a) => ({ href: a.href, text: (a.textContent || "").replace(/\s+/g, " ").trim() }));
      const menu = [];
      for (const m of document.querySelectorAll("nav, aside, [class*=menu], [class*=Menu], [class*=categor], [class*=Categor]")) menu.push(...read(m));
      return { menu, all: read(document) };
    });
    const pick = (lst) => lst.find((l) => l.text && whole.test(plain(l.text))) || lst.find((l) => l.text && re.test(plain(l.text)));
    const hit = pick(links.menu) || pick(links.all);
    if (!hit) {
      // première étape manquée : rien à lire ; étape suivante manquée : la page atteinte est lue, le filtre du rayon
      // (RAYON_FILTRE dans tools/lib.py) garde ce qui est le produit du rayon
      const seen = [...new Set(links.all.map((l) => l.text).filter(Boolean))].slice(0, 80).join(" | ");
      if (!depth) throw new Error(`aucun lien « ${step} » sur ${url} ; liens : ${seen}`);
      console.log(`${src.retailer} ${src.rayon} : pas de lien « ${step} » sur ${url}, page lue telle quelle`);
      break;
    }
    url = hit.href;
    texts.push(hit.text);
    depth++;
    console.log(`${src.retailer} ${src.rayon} : « ${hit.text} » ${url}`);
  }
  const m = /-(B\d+)-\d+\.html/.exec(url);
  return { url, match: m ? m[1] : url, text: texts.join(" > ") };
}

// numéro d'une page Houra (« -2.html »), 1 par défaut
const pageNo = (u) => { const m = /-(\d+)\.html$/.exec((u || "").split("?")[0]); return m ? parseInt(m[1], 10) : 1; };

async function readPage(page, src) {
  const brand = brandOf(src.retailer);
  // adresse demandée (src.url, celle sur laquelle tools/build.py reconnaît la page) et adresse à ouvrir (src.goto :
  // page suivante telle que le site la lie, qui peut porter un autre code quand la page demandée a été redirigée)
  const res = await page.goto(src.goto || src.url, { waitUntil: "domcontentloaded", timeout: 45000 });
  const status = res ? res.status() : 0;
  await page.waitForTimeout(2500);
  // faire défiler pour charger les vignettes paresseuses, jusqu'à ce que le nombre de liens produit se stabilise,
  // que plus rien ne bouge, ou que la page ait assez de vignettes
  const count = () => page.evaluate((p) => [...document.querySelectorAll("a[href]")].filter((a) => new RegExp(p).test(a.href.split("?")[0])).length, PRODUCT[brand]);
  let last = -1, lastY = -1;
  for (let i = 0; i < (WHEEL[brand] || 14); i++) {
    const n = await count();
    const y = await page.evaluate(() => window.scrollY);
    if (n >= MAX_TILES) break;
    if (i > 2 && n === last && (y === lastY || i > 5)) break;
    last = n;
    lastY = y;
    await page.mouse.wheel(0, 2200);
    await page.waitForTimeout(900);
  }
  const data = await page.evaluate(extractInPage, { product: PRODUCT[brand], retailer: brand, max: MAX_TILES });
  return { status, final: page.url(), ...data };
}

// pages Houra trouvées par le robot : clé d'une découverte (enseigne, rayon, page de départ, étapes)
const discKey = (d) => [d.retailer, d.rayon, d.from || "", JSON.stringify(d.find || null)].join("|");

(async () => {
  const conf = JSON.parse(fs.readFileSync(path.join(__dirname, "sources.json"), "utf8"));
  const sources = selectPages(conf);
  console.log(`Cible ${cible} : ${sources.length} pages, enseignes ${[...new Set(sources.map((p) => p.retailer))].join(", ") || "aucune"}${max ? `, ${max} lues au plus` : ""}`);
  fs.mkdirSync(path.join(WORK, "journal"), { recursive: true });
  if (diag) fs.mkdirSync(path.join(WORK, "diag"), { recursive: true });
  // découvertes des passages précédents (tools/state/discovered.json) : reprises quand une découverte échoue, et
  // gardées dans le fichier fusionné quand ce passage ne relit pas leur rayon
  let known = [];
  try { known = JSON.parse(fs.readFileSync(DISCOVERED, "utf8")); } catch (e) { known = []; }
  const knownBy = new Map(known.map((d) => [discKey(d), d]));
  const foundNow = new Map();
  const debut = new Date().toISOString();
  const browser = await chromium.launch();
  const fresh = async () => browser.newContext({ userAgent: UA, locale: "fr-FR", timezoneId: "Europe/Paris", viewport: { width: 1366, height: 900 } });
  let ctx = await fresh();
  let page = await ctx.newPage();
  const rows = [], summary = [];
  const done = new Set();
  const chosen = {};
  let current = null;
  let read = 0;
  STORES = conf.magasins || {};
  const queue = sources.map((s) => ({ ...s }));
  while (queue.length) {
    if (max && read >= max) { console.log(`${read} pages lues : arrêt demandé par --max.`); break; }
    const src = queue.shift();
    if (src.from && !src.url) {
      const k = discKey(src);
      try {
        const found = await discover(page, src);
        Object.assign(src, { url: found.url, match: found.match });
        foundNow.set(k, { retailer: src.retailer, rayon: src.rayon, host: src.host, match: found.match, url: found.url, prompt: src.prompt || "", from: src.from, find: src.find, text: found.text, at: new Date().toISOString() });
      } catch (e) {
        const msg = String(e.message || e).split("\n")[0];
        const prev = knownBy.get(k);
        if (!prev) { summary.push({ retailer: src.retailer, rayon: src.rayon, url: src.from, final: null, status: 0, products: 0, error: msg }); console.log(`${src.retailer} ${src.rayon} : ${msg}`); continue; }
        // la page trouvée un passage précédent est relue telle quelle
        Object.assign(src, { url: prev.url, match: prev.match });
        console.log(`${src.retailer} ${src.rayon} : ${msg} ; page trouvée la fois d'avant reprise, ${prev.url}`);
      }
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
    if (chooser && !chosen[src.retailer]) { summary.push({ retailer: src.retailer, rayon: src.rayon, url: src.url, final: null, status: 0, products: 0, error: "point de retrait non choisi" }); continue; }
    let r = null, err = null;
    for (let attempt = 0; attempt < 2 && !r; attempt++) {
      try { r = await readPage(page, src); } catch (e) { err = String(e.message || e).split("\n")[0]; await sleep(4000); }
    }
    read++;
    const ts = new Date().toISOString();
    const n = r ? r.products.length : 0;
    summary.push({ retailer: src.retailer, rayon: src.rayon, url: src.url, final: r ? r.final : null, status: r ? r.status : 0, products: n, error: err && !r ? err : null, title: r ? r.title : null });
    console.log(`${src.retailer.padEnd(9)} ${src.rayon.padEnd(9)} ${String(r ? r.status : "ERR").padEnd(4)} ${String(n).padStart(3)} produits  ${src.url}${r && r.final !== (src.goto || src.url) ? "  -> " + r.final : ""}${err && !r ? "  " + err : ""}`);
    if (r) {
      rows.push({ url: src.url, prompt: src.prompt, text: JSON.stringify(src.retailer === "carrefour" ? r.products : { products: r.products, next_page: r.next_page }), ts, final: r.final });
      if (r.next_page && brandOf(src.retailer) === "houra" && /-\d+\.html/.test(r.next_page)) {
        // page suivante : au plus MAX_PAGES par rayon ; son adresse demandée suit la numérotation de la page demandée
        // (même code), celle à ouvrir est le lien de la page lue
        const no = pageNo(r.next_page);
        const logical = /-\d+\.html$/.test(src.url.split("?")[0]) ? src.url.replace(/-\d+\.html(\?.*)?$/, `-${no}.html`) : r.next_page;
        if (no <= MAX_PAGES && no > pageNo(src.url) && !done.has(logical.split("?")[0])) queue.unshift({ ...src, url: logical, goto: r.next_page });
        else if (no > MAX_PAGES) console.log(`${src.retailer} ${src.rayon} : ${MAX_PAGES} pages lues, la suite n'est pas suivie`);
      }
      if (diag) {
        const slug = `${src.retailer}-${src.rayon}-${done.size}`;
        fs.writeFileSync(path.join(WORK, "diag", slug + ".json"), JSON.stringify({ src: src.url, final: r.final, status: r.status, title: r.title, products: r.products.slice(0, 8) }, null, 1));
        if (n < 3) fs.writeFileSync(path.join(WORK, "diag", slug + ".html"), await page.content());
      }
    }
    await sleep(1500 + Math.random() * 1500);
  }
  await browser.close();
  // découvertes fusionnées : celles de ce passage remplacent les précédentes de même clé, les autres sont gardées
  const discovered = [...knownBy.entries()].map(([k, d]) => foundNow.get(k) || d);
  for (const [k, d] of foundNow) if (!knownBy.has(k)) discovered.push(d);
  const by = {};
  for (const s of summary) { by[s.retailer] = by[s.retailer] || { pages: 0, lues: 0, produits: 0 }; by[s.retailer].pages++; if (s.products) by[s.retailer].lues++; by[s.retailer].produits += s.products; }
  const journal = { cible, debut, fin: new Date().toISOString(), only, lot, max, pages: summary, decouvertes: [...foundNow.values()], bilan: by };
  fs.writeFileSync(path.join(WORK, "fetches.json"), JSON.stringify(rows));
  fs.writeFileSync(path.join(WORK, "discovered.json"), JSON.stringify(discovered, null, 1));
  fs.writeFileSync(path.join(WORK, "scrape.json"), JSON.stringify(summary, null, 1));
  fs.writeFileSync(path.join(WORK, "journal", cible + ".json"), JSON.stringify(journal, null, 1));
  console.log("Bilan :", JSON.stringify(by));
})();
