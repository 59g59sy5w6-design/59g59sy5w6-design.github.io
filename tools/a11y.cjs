// Mesures d'accessibilité et de mise en page de l'appli, sans captures : débordements, cibles sous 44 px, contrastes,
// textes sous 14 px ou en --ink-3, feuilles (focus entrant, inert, piège de Tab, retour du focus), rôles, titres,
// console, un seul bouton plein et un seul chiffre héros par écran, scrollWidth. Chaque écran est mesuré avec les
// états localStorage de l'audit (vide, plein), à 390 et 1 280 px, en clair et en sombre, aux cinq crans de texte, en
// contraste renforcé (suffixe -c du mode) et en mode confort (suffixe -s : cibles de 60 px de haut). Code de sortie 1
// au premier écart.
// Usage : node tools/a11y.cjs [--full] [--routes=accueil,panier] [--modes=m-light-1,d-dark-1.25,m-dark-1-c] [--all] [--json=fichier]
// tools/textcheck.cjs reprend ses écrans, ses états et son serveur (require).
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml" };
const OFF = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "openfoodfacts.json"), "utf8"));
const ARGS = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] == null ? true : m[2]] : [a, true]; }));

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split("?")[0]);
  const f = path.join(ROOT, p === "/" ? "index.html" : p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});

/* ---------- états localStorage de l'audit (produits de rayons différents, vendus par plusieurs enseignes) ---------- */
const b64e = (s) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const iso = (d) => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); };
const plus = (n) => iso(new Date(Date.now() + n * 864e5));
const PRODS = { "contrex-eau-minerale-naturelle-6-x-1-l": 2, "tropicana-jus-d-orange-pressee-sans-pulpe-pur-jus-1-l": 1, "candia-lait-1-2-ecreme-6-x-1-l": 1, "entremont-emmental-rape-francais-160-g": 2, "president-beurre-gastronomique-doux-82-mg-250-g": 1, "barilla-pates-capellini-n-1-500-g": 3, "carapelli-huile-d-olive-vierge-extra-classico-75-cl": 1, "parmentier-sardines-a-l-huile-de-tournesol-135-g": 2 };
const LIST_ITEMS = { "candia-lait-1-2-ecreme-6-x-1-l": 1, "barilla-pates-capellini-n-1-500-g": 2, "auchan-oeufs-de-poules-elevees-en-plein-air-6-oeufs": 1, "gervita-fromage-blanc-mousse-nature-8-x-100-g": 1, "coca-cola-boisson-gazeuse-aux-extraits-vegetaux-sans-sucres-1-75-l": 2 };
/* un remplissage en cours (« Remplir mes paniers ») sur le panier plein : Monoprix en cours, Houra passée, Carrefour pas
   encore commencé (« Avant de commencer ») ; la clé est celle du panier, pour que l'instantané ne soit pas périmé */
const P_MONO = { min: 6000, fixed: 320, tiers: [{ from: 0, fee: 1200 }, { from: 12000, fee: 600 }, { from: 15000, fee: 0 }] };
const P_HOURA = { min: 6000, fixed: 0, tiers: [{ from: 0, fee: 990 }, { from: 12000, fee: 790 }, { from: 15000, fee: 500 }, { from: 20000, fee: 0 }] };
const P_CARREFOUR = { min: 6000, fixed: 0, tiers: [{ from: 0, fee: 800 }, { from: 10000, fee: 500 }, { from: 15000, fee: 0 }] };
const item = (id, cost, nm, f) => ({ id, q: PRODS[id], cost: cost * PRODS[id], nm, f });
const SNAP = {
  id: "audit", at: new Date().toISOString(), key: JSON.stringify(Object.keys(PRODS).sort().map((id) => [id, PRODS[id]])), full: true,
  orders: [
    { rid: "monoprix", P: P_MONO, items: [item("tropicana-jus-d-orange-pressee-sans-pulpe-pur-jus-1-l", 349, "Tropicana Jus d'orange pressée sans pulpe", "1 L"), item("entremont-emmental-rape-francais-160-g", 249, "Entremont Emmental râpé français", "160 g"), item("president-beurre-gastronomique-doux-82-mg-250-g", 289, "Président Beurre gastronomique doux", "250 g"), item("carapelli-huile-d-olive-vierge-extra-classico-75-cl", 999, "Carapelli Huile d'olive vierge extra Classico", "75 cl")] },
    { rid: "houra", P: P_HOURA, items: [item("contrex-eau-minerale-naturelle-6-x-1-l", 459, "Contrex Eau minérale naturelle", "6 x 1 L"), item("candia-lait-1-2-ecreme-6-x-1-l", 699, "Candia Lait demi-écrémé", "6 x 1 L"), item("parmentier-sardines-a-l-huile-de-tournesol-135-g", 199, "Parmentier Sardines à l'huile de tournesol", "135 g")] },
    { rid: "carrefour", P: P_CARREFOUR, items: [item("barilla-pates-capellini-n-1-500-g", 139, "Barilla Pâtes capellini n°1", "500 g")] },
  ],
  comp: [], skipped: [],
};
const STATES = {
  vide: {},
  plein: {
    basket: PRODS, seen: { welcome: 1, first: { monoprix: 1, houra: 1 } },
    prefs: { zip: "94120", off: { leclerc: true }, fee: {}, pick: {}, liv: {}, keep: {}, maxOrders: 3, extraCost: 0, foyer: 2, budget: 60 },
    lists: [{ id: "l1", name: "Courses de la semaine", items: LIST_ITEMS, at: plus(-3) }, { id: "l2", name: "Petit-déjeuner", items: { "candia-lait-1-2-ecreme-6-x-1-l": 1, "tropicana-jus-d-orange-pressee-sans-pulpe-pur-jus-1-l": 1 }, at: plus(-10) }],
    draft: "lait\n2 paquets de pâtes\ncoca zéro x3\npapier toilette\n6 oeufs\nbeurre\nriz\nhuile d'olive",
    hist: [
      { d: plus(-21), t: 6834, s: 912, n: 14, o: ["Houra", "Auchan"], items: LIST_ITEMS, when: [] },
      { d: plus(-7), t: 5210, s: 640, n: 11, o: ["Auchan"], items: PRODS, when: [{ rid: "auchan", name: "Auchan", pick: true, d: plus(2), s: "aprem", where: "Fontenay-sous-Bois" }] },
    ],
    guide: { ck: { "monoprix|entremont-emmental-rape-francais-160-g": 1 }, done: { houra: true }, when: { houra: { d: plus(1), s: "soir" } }, snap: SNAP },
    menu: [{ id: "pates-thon-tomate", portions: 4 }, { id: "omelette-fromage", portions: 2 }],
    reports: [{ id: "r1", at: new Date().toISOString(), k: "manque", pid: "", ret: "", text: "Le riz basmati de Monoprix n'est pas dans Cabas." }],
    recent: ["lait", "pâtes", "café"], seenAt: "", seenp: { "barilla-pates-capellini-n-1-500-g": 9.9, "candia-lait-1-2-ecreme-6-x-1-l": 9.9 }, drops: [],
    /* une commande à deux en cours (prénoms inventés) : l'eau et une partie du lait sont à l'autre personne */
    owners: { "contrex-eau-minerale-naturelle-6-x-1-l": 2, "entremont-emmental-rape-francais-160-g": 1 },
    duo: { me: "Alex", w: { t: "a11yduo1", n: "Sam", m: "Je prends l'eau.", at: new Date().toISOString(), k: "duo" } },
  },
};
const PARTAGE = "#/partage/" + b64e(JSON.stringify({ n: "Liste de Camille", i: Object.entries(LIST_ITEMS) }));
/* lien de transfert entre deux téléphones (non compressé) : un panier et une liste */
/* courses pour un proche et commande à deux : les liens reçus (#/pour, #/duo, #/retour), prénoms inventés */
const linkJ = (o) => "j" + b64e(JSON.stringify(o));
const POUR = "#/pour/" + linkJ({ app: "cabas", v: 1, k: "pour", t: "a11ypour1", at: new Date().toISOString(), n: "Dominique", m: "Le lait demi-écrémé, pas entier.\nMerci !", i: Object.entries(PRODS), f: [["Bougies d'anniversaire", 1]], j: plus(2), b: 60, d: ["gluten"], a: ["peanuts"], e: { off: { leclerc: true }, pick: {}, liv: {}, comp: false } });
const DUO = "#/duo/" + linkJ({ app: "cabas", v: 1, k: "duo", t: "a11yduo2", at: new Date().toISOString(), n: "Sam", m: "Je prends l'eau.", i: [["contrex-eau-minerale-naturelle-6-x-1-l", 2], ["candia-lait-1-2-ecreme-6-x-1-l", 1]], f: [["Piles AA", 1]] });
const RETOUR = "#/retour/" + linkJ({ app: "cabas", v: 1, k: "retour", w: "pour", t: "a11ypour1", at: new Date().toISOString(), n: "Alex", m: "J'ai pris des pommes à la place.", o: [{ r: "houra", s: "ok", d: plus(2), sl: "matin", i: [["contrex-eau-minerale-naturelle-6-x-1-l", 2, 918], ["candia-lait-1-2-ecreme-6-x-1-l", 1, 699], ["parmentier-sardines-a-l-huile-de-tournesol-135-g", 2, 398]], fe: 990 }, { r: "monoprix", s: "plan", i: [["tropicana-jus-d-orange-pressee-sans-pulpe-pur-jus-1-l", 1, 349], ["entremont-emmental-rape-francais-160-g", 2, 498]], fe: 1520 }], c: [["carapelli-huile-d-olive-vierge-extra-classico-75-cl", 1, 1165, "auchan"]], x: [["barilla-pates-capellini-n-1-500-g", 3]] });
const RETOUR_DUO = "#/retour/" + linkJ({ app: "cabas", v: 1, k: "retour", w: "duo", t: "a11yduo2", at: new Date().toISOString(), n: "Alex", o: [{ r: "monoprix", s: "ok", d: plus(1), sl: "soir", i: [["contrex-eau-minerale-naturelle-6-x-1-l", 2, 918], ["candia-lait-1-2-ecreme-6-x-1-l", 1, 799]], fe: 412 }], c: [], x: [], al: 2905 });
const TRANSFERT = "#/transfert/j" + b64e(JSON.stringify({ app: "cabas", v: 1, at: new Date().toISOString(), data: { basket: LIST_ITEMS, lists: [{ id: "t1", name: "Courses", items: LIST_ITEMS }], seen: { welcome: 1 } } }));
const ROUTES = [
  ["accueil", "#/"], ["rayons", "#/rayons"], ["rayon-pates", "#/rayon/pates"], ["produit", "#/produit/barilla-pates-capellini-n-1-500-g"],
  ["recherche", "#/recherche"], ["listes", "#/listes"], ["liste", "#/liste/l1"], ["suggestion", "#/suggestion"], ["panier", "#/panier"],
  ["reglages", "#/reglages"], ["enseigne-houra", "#/enseigne/houra"], ["enseigne-auchan", "#/enseigne/auchan"], ["enseigne-leclerc", "#/enseigne/leclerc"],
  ["apropos", "#/apropos"], ["comment", "#/comment"], ["comment-avenir", "#/comment/avenir"], ["ecrire", "#/ecrire"], ["economies", "#/economies"], ["repas", "#/repas"],
  ["recette", "#/repas/pates-thon-tomate"], ["scan", "#/scan"], ["partage", PARTAGE], ["inconnu", "#/nimportequoi"],
  ["remplir", "#/remplir"], ["remplir-guide", "#/remplir/monoprix"], ["remplir-fin", "#/remplir/houra"], ["remplir-avant", "#/remplir/carrefour"], ["recommander", "#/recommander"],
  ["magasin", "#/magasin"], ["mouvements", "#/mouvements"], ["transfert", TRANSFERT],
  ["comparer", "#/comparer/barilla-pates-capellini-n-1-500-g/barilla-pates-spaghetti-n-5-500-g"],
  ["frais", "#/frais"], ["frais-houra", "#/frais/houra"], ["rayon-bio", "#/rayon/bio"], ["rayon-halal", "#/rayon/halal"], ["recette-semaine", "#/repas/omelette-fromage"],
  ["demande", "#/recherche"], ["pour", POUR], ["duo", DUO], ["retour", RETOUR], ["retour-duo", RETOUR_DUO],
  /* en dernier : « Faire ses courses » met le téléphone dans les courses d'un proche (le panier de l'aidant mis de côté) */
  ["proche", POUR],
];
/* phrase de « Demande à Cabas » tapée sur l'écran « demande » */
const ASK = "pâtes complètes à moins de 2 € chez Houra";
/* écrans mesurés aussi à l'état vide (première visite) */
const EMPTY_TOO = ["accueil", "panier", "listes", "ecrire", "economies", "repas", "recherche", "remplir", "recommander", "magasin", "mouvements", "frais", "pour", "duo", "retour", "proche"];
/* feuilles ouvertes depuis chaque écran : nom, bouton qui l'ouvre ; celles du panier demandent un gros panier
   (14 produits vendus par plusieurs enseignes, en deux exemplaires), qui atteint les minimums de commande */
const SHEETS = {
  reglages: [["zip", "[data-act=zip]"], ["budget", "[data-act=budget]"], ["welcome", "[data-act=welcome]"], ["install", "[data-act=install], [data-act=installnow]"], ["reset", "[data-act=reset]"], ["delais", "[data-act=leads]"], ["jour-courses", "[data-act=shopdays]"], ["alertes", "[data-act=watchlist]"], ["signaler-demander", "#view [data-act=report]"], ["regime", "[data-act=diet]"], ["mes-choix", "[data-act=usual]"], ["mes-signalements", "[data-act=reports]"]],
  produit: [["comparer", "#view [data-act=cmppick]"], ["previens-moi", "#view [data-act=watch]"], ["signaler", "#view [data-act=report]"]],
  /* « Remplir mes paniers » est un écran (#/remplir), plus une feuille : ses feuilles sont mesurées depuis le mode guidé */
  "panier-gros": [["swaps", "[data-act=swaps]"], ["budget", "[data-act=budget]"], ["ou-le-prendre", "[data-act=itemopt]"], ["panier-souple", "[data-act=flex]"], ["envoyer", "#view [data-act=duosend]"], ["sa-part", "#duo [data-act=duoback]"]],
  listes: [["envoyer-proche", "[data-act=duosend][data-k=pour]"]],
  proche: [["retour-proche", "#view [data-act=pourback]"], ["oublier", "#view [data-act=pourforget]"]],
  "remplir-guide": [["pas-trouve", "#view [data-act=fillmiss]"]],
  "remplir-fin": [["when", "#view [data-act=when]"]],
  economies: [["total-paye", "[data-act=paid]"]],
  ecrire: [["autre-choix", "[data-act=wlalt]"], ["savelist", "[data-act=wlsave]"]],
  "rayon-pates": [["sort", "[data-act=sort]"], ["filters", "[data-act=filters]"]],
  scan: [["scantype", "[data-act=scantype]"]],
  /* « À venir » : la demande d'une enseigne ou d'une ville, le signalement ouvert sur ce choix */
  "comment-avenir": [["demander-enseigne", "#view [data-act=report][data-k=enseigne]"]],
};
const GROS_JS = `fetch("data/catalog.json").then((r) => r.json()).then((c) => { const b = {}; c.products.filter((p) => (p.o || []).length > 1).slice(0, 14).forEach((p) => { b[p.i] = 2; }); sessionStorage.setItem("a11yGros", JSON.stringify(b)); })`;
const CRANS = ["0.82", "0.9", "1", "1.12", "1.25"];
const WIDTHS = { m: { width: 390, height: 844 }, d: { width: 1280, height: 800 } };
function modeOf(id) {
  const [w, scheme, cran, ...x] = id.split("-");
  return { id, vp: WIDTHS[w], scheme, cran: cran || "1", mobile: w === "m", contrast: x.includes("c"), simple: x.includes("s") };
}
/* les réglages d'affichage d'un mode : cran de texte, contraste renforcé, mode confort */
const lookOf = (mode) => Object.assign(mode.cran !== "1" ? { zoom: mode.cran } : {}, mode.contrast ? { contrast: true } : {}, mode.simple ? { simple: true } : {});
/* par défaut : mobile clair et sombre, desktop clair, les cinq crans en mobile clair et le plus grand en desktop sombre ;
   --full : tout le produit largeurs x thèmes x crans */
const DEFAULT_MODES = ["m-light-1", "m-dark-1", "d-light-1", "m-light-0.82", "m-light-0.9", "m-light-1.12", "m-light-1.25", "d-dark-1.25",
  "m-light-1-c", "m-dark-1-c", "d-dark-1-c", "m-light-1-s", "m-dark-1.25-s", "d-light-1-s"];
const FULL_MODES = ["m", "d"].flatMap((w) => ["light", "dark"].flatMap((s) => CRANS.flatMap((c) => ["", "-c", "-s", "-c-s"].map((x) => `${w}-${s}-${c}${x}`))));
const MODES = (ARGS.modes ? String(ARGS.modes).split(",") : ARGS.full ? FULL_MODES : DEFAULT_MODES).map(modeOf);
const ROUTE_FILTER = ARGS.routes ? new Set(String(ARGS.routes).split(",")) : null;

/* ---------- mesures dans la page : renvoie une liste d'écarts { cat, msg } ---------- */
const MEASURE_JS = `(() => {
  const out = [];
  const vw = innerWidth, vh = innerHeight, root = getComputedStyle(document.documentElement);
  const scale = parseFloat(root.fontSize) / 16 || 1;
  const sheetOpen = !document.getElementById("sheet").hidden;
  const scope = sheetOpen ? "#sheet .sheet *, #toast *" : "#view *, #nav *, #tabbar *, #dock *, #side *, #toast *";
  const vis = (el) => { const cs = getComputedStyle(el); if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) === 0) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const sig = (el) => { let s = el.tagName.toLowerCase(); if (el.id) s += "#" + el.id; if (typeof el.className === "string" && el.className) s += "." + el.className.trim().split(/\\s+/).slice(0, 3).join("."); if (el.dataset && el.dataset.act) s += "[" + el.dataset.act + "]"; return s; };
  const txt = (el) => (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 48);
  const parseC = (s) => { const m = /rgba?\\(([^)]+)\\)/.exec(s || ""); if (!m) return null; const a = m[1].split(/[\\s,\\/]+/).filter(Boolean).map(parseFloat); return { r: a[0], g: a[1], b: a[2], a: a.length > 3 ? a[3] : 1 }; };
  const comp = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const same = (a, b) => a && b && Math.abs(a.r - b.r) < 2 && Math.abs(a.g - b.g) < 2 && Math.abs(a.b - b.b) < 2 && Math.abs(a.a - b.a) < 0.02;
  /* couleur calculée d'un jeton : un élément témoin */
  const tok = (name) => { const d = document.createElement("i"); d.style.color = "var(" + name + ")"; document.body.appendChild(d); const c = parseC(getComputedStyle(d).color); d.remove(); return c; };
  const INK3 = tok("--ink-3"), PROSE = ["--ink", "--ink-2", "--brand-ink"].map(tok);
  const docBg = (() => { const c = parseC(getComputedStyle(document.body).backgroundColor); return c && c.a > 0 ? comp(c, { r: 255, g: 255, b: 255, a: 1 }) : { r: 255, g: 255, b: 255, a: 1 }; })();
  function bgOf(el) {
    const layers = []; let n = el, img = false;
    while (n && n.nodeType === 1) { const cs = getComputedStyle(n); const c = parseC(cs.backgroundColor); if (cs.backgroundImage && cs.backgroundImage !== "none") img = true; if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; } n = n.parentElement; }
    let base = docBg; for (let i = layers.length - 1; i >= 0; i--) base = comp(layers[i], base);
    return { c: base, img };
  }
  const inScroller = (el) => { for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) { const ox = getComputedStyle(n).overflowX; if (ox === "auto" || ox === "scroll") return true; } return false; };
  /* 1 et 10 : débordements, scrollWidth, zoom */
  const se = document.scrollingElement;
  if (se.scrollWidth > se.clientWidth) out.push({ cat: "scrollWidth", msg: "document " + se.scrollWidth + " px pour " + se.clientWidth });
  if (document.documentElement.style.zoom) out.push({ cat: "zoom", msg: "html porte style zoom=" + document.documentElement.style.zoom });
  let nOver = 0;
  for (const el of document.querySelectorAll(scope)) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 && !el.closest(".skip") && !inScroller(el)) { if (nOver++ < 6) out.push({ cat: "débordement", msg: sig(el) + " dépasse à " + Math.round(r.right) + " px (« " + txt(el) + " »)" }); }
  }
  /* 2 : cibles sous 44 x 44, 44 x 60 en mode confort (la zone de touche étendue par .hit compte) */
  const simple = document.documentElement.hasAttribute("data-simple"), minH = simple ? 59.5 : 43.5;
  const TSEL = "button, a[href], [data-act], input:not([type=hidden]), textarea, select, label.sw, [role=checkbox], [role=radio], [role=switch]";
  const targetRoot = sheetOpen ? document.querySelector("#sheet .sheet") : document;
  for (const el of targetRoot.querySelectorAll(TSEL)) {
    if (!vis(el) || el.closest(".sr") || el.classList.contains("sr")) continue;
    if (el.tagName === "INPUT" && el.closest("label.sw")) continue;
    if (!sheetOpen && el.closest("#sheet")) continue;
    const r = el.getBoundingClientRect(), hit = el.classList.contains("hit") || (el.parentElement && el.parentElement.classList.contains("hit"));
    const tap = simple ? 60 : 44;
    let w = hit ? Math.max(r.width, tap) : r.width, h = hit ? Math.max(r.height, tap) : r.height;
    /* l'interrupteur : sa case invisible déborde du dessin de 11 px en haut et en bas */
    if (el.matches("label.sw")) h = Math.max(h, r.height + 22);
    if (w < 43.5 || h < minH) out.push({ cat: "cible", msg: sig(el) + " " + Math.round(r.width) + " x " + Math.round(r.height) + " (« " + txt(el) + " »)" });
  }
  /* 3 et 4 : contrastes, tailles, texte en --ink-3 */
  const seen = new Set(), nodes = [];
  const tw = document.createTreeWalker(targetRoot, NodeFilter.SHOW_TEXT);
  let tn; while ((tn = tw.nextNode())) { if (!tn.nodeValue.trim()) continue; const el = tn.parentElement; if (!el || seen.has(el)) continue; seen.add(el); nodes.push({ el, words: tn.nodeValue.trim().split(/\\s+/).length }); }
  const MICRO = ".badge, .bdg, .chip .n, .tag, .drop";
  for (const { el, words } of nodes) {
    if (!vis(el) || el.closest(".sr, [aria-hidden=true], noscript, script, style") || el.classList.contains("sr")) continue;
    if (!sheetOpen && el.closest("#sheet")) continue;
    const cs = getComputedStyle(el), fc = parseC(cs.color); if (!fc) continue;
    const fs = parseFloat(cs.fontSize);
    /* pastilles à 12, onglets à 13 (bornés par le chrome, ils ne suivent pas le cran), les « A » du contrôle de taille exemptés */
    const min = el.closest(MICRO) ? 12 * scale : el.closest(".tab span") ? 13 : el.closest(".tsize button") ? 0 : 14 * scale;
    if (fs < min - 0.3) out.push({ cat: "taille", msg: sig(el) + " " + (Math.round(fs * 10) / 10) + " px (« " + txt(el) + " »)" });
    if (same(fc, INK3)) out.push({ cat: "ink-3", msg: sig(el) + " (« " + txt(el) + " »)" });
    const bg = bgOf(el); if (bg.img) continue;
    const fg = comp(fc, bg.c), rt = ratio(fg, bg.c);
    const prose = words > 3 && PROSE.some((c) => same(fc, c));
    const need = rt < 4.5 ? 4.5 : prose && rt < 7 ? 7 : 0;
    if (need) out.push({ cat: "contraste", msg: sig(el) + " " + (Math.round(rt * 100) / 100) + ":1 pour " + need + " (« " + txt(el) + " »)" });
  }
  /* 3 : non-texte, bordure des cases, chevrons et icônes de ligne, repère de barre */
  for (const el of targetRoot.querySelectorAll(".box, .chev, .row .ic, .hcard .ic, .icbtn .ic, .prog i, .search .ic")) {
    if (!vis(el) || (!sheetOpen && el.closest("#sheet"))) continue;
    const cs = getComputedStyle(el), box = el.classList.contains("box"), mark = el.matches(".prog i");
    /* une case : sa bordure contre la surface qui l'entoure ; un repère de barre : son fond contre la barre */
    const col = box ? parseC(cs.borderTopColor) : mark ? parseC(cs.backgroundColor) : parseC(cs.color);
    const bg = bgOf(box || mark ? el.parentElement : el); if (!col || col.a === 0 || bg.img) continue;
    const rt = ratio(comp(col, bg.c), bg.c);
    if (rt < 3) out.push({ cat: "non-texte", msg: sig(el) + " " + (Math.round(rt * 100) / 100) + ":1 pour 3" });
  }
  /* 6 : rôles */
  for (const el of targetRoot.querySelectorAll("[role=menuitemcheckbox]")) out.push({ cat: "rôle", msg: "menuitemcheckbox sur " + sig(el) });
  for (const el of targetRoot.querySelectorAll(".seg [aria-pressed]")) out.push({ cat: "rôle", msg: "aria-pressed dans un .seg : " + sig(el) });
  for (const el of targetRoot.querySelectorAll(".seg:not([role=radiogroup])")) out.push({ cat: "rôle", msg: ".seg sans radiogroup : " + sig(el) });
  for (const el of targetRoot.querySelectorAll(".chips:not([role=group])")) out.push({ cat: "rôle", msg: ".chips sans role=group : " + sig(el) });
  for (const el of targetRoot.querySelectorAll("[role=radio]:not([role=radiogroup] [role=radio])")) out.push({ cat: "rôle", msg: "radio hors radiogroup : " + sig(el) });
  /* 7 : titres */
  if (!sheetOpen) {
    const hs = [...document.querySelectorAll("#view h1, #view h2, #view h3, #view h4")].filter((h) => vis(h) || h.classList.contains("sr")).map((h) => ({ l: +h.tagName[1], t: txt(h) }));
    const h1 = hs.filter((h) => h.l === 1);
    if (h1.length !== 1) out.push({ cat: "titre", msg: h1.length + " h1 (" + h1.map((h) => h.t).join(" | ") + ")" });
    let prev = 0; for (const h of hs) { if (prev && h.l > prev + 1) out.push({ cat: "titre", msg: "saut h" + prev + " vers h" + h.l + " (" + h.t + ")" }); prev = h.l; }
  }
  /* 7 bis : un seul chiffre héros (le total en grand) par écran */
  if (!sheetOpen) { const heroes = [...document.querySelectorAll("#view .sum .st .px")].filter(vis); if (heroes.length > 1) out.push({ cat: "chiffre héros", msg: heroes.length + " chiffres héros : " + heroes.map((h) => "« " + txt(h) + " »").join(", ") }); }
  /* 8 : gestionnaires en ligne */
  for (const el of document.querySelectorAll("[onclick], [onchange], [oninput]")) out.push({ cat: "inline", msg: "gestionnaire en ligne sur " + sig(el) });
  /* 9 : un seul bouton plein visible à l'ouverture, dock compris */
  if (!sheetOpen) {
    const full = [...document.querySelectorAll(".btn:not(.tint):not(.ghost):not(.plain):not(.danger), .dock .mini:not(.soft)")].filter((b) => { if (!vis(b)) return false; const r = b.getBoundingClientRect(); return r.top < vh && r.bottom > 0; });
    if (full.length > 1) out.push({ cat: "bouton plein", msg: full.length + " boutons pleins visibles : " + full.map((b) => "« " + txt(b) + " »").join(", ") });
  }
  /* 10 : l'action que la page met dans le dock se voit, à toutes les largeurs (sur grand écran, le dock est caché sauf
     pour les vues qui le demandent : une action qui n'existe que là serait introuvable) */
  if (!sheetOpen) {
    const dock = document.getElementById("dock");
    /* la même action ailleurs, visible (le mini panier de la barre latérale, la barre d'achat de la fiche) suffit */
    const twin = (b) => [...document.querySelectorAll("#view a, #view button, #side a, #side button")].some((o) => vis(o) && (b.dataset.act ? o.dataset.act === b.dataset.act && (o.dataset.id || "") === (b.dataset.id || "") : b.getAttribute("href") && o.getAttribute("href") === b.getAttribute("href")));
    if (dock && !dock.hidden) for (const b of dock.querySelectorAll("button, a")) if (!vis(b) && !twin(b)) out.push({ cat: "action cachée", msg: "action du dock invisible : « " + txt(b) + " » " + sig(b) });
  }
  return out;
})()`;

/* signature d'un bouton : son action et ses données, stable d'un redessin à l'autre */
const FOCUS_JS = `(() => { const el = document.activeElement; if (!el || el === document.body) return { tag: "body", inSheet: false }; let s = el.tagName.toLowerCase(); if (typeof el.className === "string" && el.className) s += "." + el.className.trim().split(/\\s+/).slice(0, 2).join("."); if (el.dataset && el.dataset.act) s += "[" + el.dataset.act + "]"; const sig = el.dataset && el.dataset.act ? JSON.stringify(Object.assign({}, el.dataset)) : ""; return { tag: s, inSheet: !!el.closest("#sheet"), sig }; })()`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function ready(page, route) {
  await page.waitForFunction(() => !document.querySelector("#view .sk") && document.querySelector("#view .wrap > *"), null, { timeout: 25000 }).catch(() => {});
  if (route === "panier") await page.waitForFunction(() => !document.querySelector(".sum.loading"), null, { timeout: 25000 }).catch(() => {});
  if (route === "accueil") await page.waitForFunction(() => !document.querySelector("#recrail"), null, { timeout: 15000 }).catch(() => {});
  await sleep(320);
}
/* écrans qui demandent un geste avant la mesure : Ma liste cherchée, une recherche, une demande en phrase */
async function prepare(page, rname, st) {
  if (rname === "ecrire" && st === "plein") { await page.click("[data-act=wlgo]").catch(() => {}); await page.waitForSelector("[data-act=wlalt], .banner", { timeout: 20000 }).catch(() => {}); await sleep(300); }
  if (rname === "proche") { await page.click("[data-act=pourgo]").catch(() => {}); await page.waitForFunction(() => location.hash === "#/panier", null, { timeout: 8000 }).catch(() => {}); await ready(page, "panier"); }
  if ((rname === "recherche" && st === "plein") || rname === "demande") { const i = await page.$("#q"); if (i) { await i.fill(rname === "demande" ? ASK : "lait"); await sleep(rname === "demande" ? 1200 : 600); } }
  /* #/comment/avenir est mesuré là où il arrive : la section « À venir » en haut de l'écran */
  if (rname !== "comment-avenir") await page.evaluate(() => window.scrollTo(0, 0));
}
/* états du gros panier (14 produits en deux exemplaires) : le tableau des prix et « Et si… » ouvert */
const GROS_STEPS = [
  ["panier-tableau", async (page) => { await page.click("[data-act=cview][data-v=tab]"); await sleep(400); }, async (page) => { await page.click("[data-act=cview][data-v=cmd]").catch(() => {}); await sleep(300); }],
  ["panier-et-si", async (page) => { await page.evaluate(() => { const d = document.querySelector("details.wif"); if (d) { d.scrollIntoView({ block: "start" }); d.querySelector("summary").click(); } }); await page.waitForFunction(() => !document.querySelector("details.wif .sk, details.wif .loading"), null, { timeout: 15000 }).catch(() => {}); await sleep(500); }, async (page) => { await page.evaluate(() => { const d = document.querySelector("details.wif[open]"); if (d) d.querySelector("summary").click(); window.scrollTo(0, 0); }); await sleep(200); }],
];

async function main() {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/index.html`;
  const findings = [];
  const add = (where, list) => list.forEach((f) => findings.push(Object.assign({ where }, f)));
  const browser = await chromium.launch();
  let loads = 0;
  for (const mode of MODES) {
    const states = mode.id === "m-light-1" || mode.id === "m-light-1-s" ? ["plein", "vide"] : ["plein"];
    for (const st of states) {
      const state = JSON.parse(JSON.stringify(STATES[st]));
      const look = lookOf(mode);
      if (Object.keys(look).length) state.prefs = Object.assign({ off: { leclerc: true }, fee: {}, pick: {}, liv: {}, keep: {} }, state.prefs || {}, look);
      const ctx = await browser.newContext({ viewport: mode.vp, deviceScaleFactor: 1, colorScheme: mode.scheme, isMobile: mode.mobile, hasTouch: mode.mobile, locale: "fr-FR", timezoneId: "Europe/Paris", serviceWorkers: "block" });
      /* Open Food Facts simulé (tools/fixtures/openfoodfacts.json) : la fiche montre Nutri-Score, allergènes et labels */
      await ctx.route(/^https:\/\/world\.openfoodfacts\.org\//, (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(OFF.connu) }));
      await ctx.addInitScript((s) => { try { localStorage.clear(); for (const k of Object.keys(s)) localStorage.setItem("cabas." + k, JSON.stringify(s[k])); const g = sessionStorage.getItem("a11yGros"); if (g) localStorage.setItem("cabas.basket", g); } catch (e) { /* stockage indisponible */ } }, state);
      const page = await ctx.newPage();
      const errs = [];
      page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 160)); });
      page.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
      let first = true;
      for (const [rname, hash] of ROUTES) {
        if (ROUTE_FILTER && !ROUTE_FILTER.has(rname)) continue;
        if (st === "vide" && !EMPTY_TOO.includes(rname)) continue;
        const where = `${mode.id} ${st} ${rname}`;
        try {
          if (first) { await page.goto(base + hash, { waitUntil: "domcontentloaded" }); first = false; }
          else await page.evaluate((h) => { location.hash = h; window.scrollTo(0, 0); }, hash);
          loads++;
          await ready(page, rname);
          await prepare(page, rname, st);
          add(where, await page.evaluate(MEASURE_JS));
          if (/enseigne/.test(rname)) { const h1 = await page.evaluate(() => (document.querySelector("#view h1") || {}).textContent || ""); if (/introuvable|n'existe pas/i.test(h1) || !h1) add(where, [{ cat: "titre", msg: "page d'enseigne non rendue (h1 « " + h1.trim() + " »)" }]); }
          /* feuilles : mobile clair et sombre, état plein ; sur le panier, avec un gros panier qui a des commandes */
          const gros = rname === "panier" && st === "plein" && mode.cran === "1" && mode.mobile;
          if (gros) {
            await page.evaluate(GROS_JS); await page.reload({ waitUntil: "domcontentloaded" }); await ready(page, rname); loads++; add(`${mode.id} gros ${rname}`, await page.evaluate(MEASURE_JS));
            for (const [sname, go, back] of GROS_STEPS) {
              try { await go(page); add(`${mode.id} gros ${sname}`, await page.evaluate(MEASURE_JS)); await back(page); } catch (e) { add(`${mode.id} gros ${sname}`, [{ cat: "erreur", msg: String(e).split("\n")[0].slice(0, 160) }]); }
            }
          }
          if (st === "plein" && mode.cran === "1" && mode.mobile) {
            for (const [sname, sel] of SHEETS[gros ? "panier-gros" : rname] || []) {
              const sw = `${where} feuille ${sname}`;
              const btn = await page.$(sel);
              if (!btn) { add(sw, [{ cat: "feuille", msg: "bouton d'ouverture absent (" + sel + ")" }]); continue; }
              try {
                const opener = await page.evaluate((s) => { const b = document.querySelector(s); b.scrollIntoView({ block: "center" }); return JSON.stringify(Object.assign({}, b.dataset)); }, sel);
                await btn.focus(); await page.keyboard.press("Enter");
                const opened = await page.waitForFunction(() => !document.getElementById("sheet").hidden, null, { timeout: 4000 }).then(() => true).catch(() => false);
                if (!opened) { add(sw, [{ cat: "feuille", msg: "ne s'ouvre pas" }]); continue; }
                await sleep(450);
                const info = await page.evaluate(() => { const ae = document.activeElement, sh = document.querySelector("#sheet .sheet"); return { focusIn: !!(ae && sh.contains(ae)), inert: ["view", "nav", "dock", "tabbar"].every((id) => { const el = document.getElementById(id); return !el || el.hidden || el.hasAttribute("inert"); }), hasSheet: document.body.classList.contains("has-sheet"), close: !!sh.querySelector(".sheet-h [data-act=close][aria-label], .sheet-h [data-act=close]:not(:empty)") }; });
                if (!info.focusIn) add(sw, [{ cat: "feuille", msg: "le focus n'entre pas dans la feuille" }]);
                if (!info.inert) add(sw, [{ cat: "feuille", msg: "#view, #nav, #dock ou #tabbar sans inert" }]);
                if (!info.hasSheet) add(sw, [{ cat: "feuille", msg: "body sans has-sheet" }]);
                if (!info.close) add(sw, [{ cat: "feuille", msg: "pas de bouton de fermeture nommé dans l'en-tête" }]);
                add(sw, await page.evaluate(MEASURE_JS));
                let leaves = false;
                for (let i = 0; i < 12; i++) { await page.keyboard.press("Tab"); const f = await page.evaluate(FOCUS_JS); if (f.tag !== "body" && !f.inSheet) { leaves = true; break; } }
                if (leaves) add(sw, [{ cat: "feuille", msg: "12 Tab sortent de la feuille" }]);
                await page.keyboard.press("Escape"); await sleep(250);
                const closed = await page.evaluate(() => document.getElementById("sheet").hidden);
                if (!closed) { add(sw, [{ cat: "feuille", msg: "Échap ne ferme pas" }]); await page.evaluate(() => { const w = document.getElementById("sheet"); w.hidden = true; }); }
                const after = await page.evaluate(FOCUS_JS);
                if (after.sig !== opener) add(sw, [{ cat: "feuille", msg: "après fermeture, le focus est sur " + after.tag + " et pas sur le bouton d'ouverture" }]);
              } catch (e) { add(sw, [{ cat: "feuille", msg: "erreur : " + String(e).split("\n")[0].slice(0, 120) }]); }
              await page.evaluate(() => { const w = document.getElementById("sheet"); if (!w.hidden) w.hidden = true; document.documentElement.style.overflow = ""; document.body.classList.remove("has-sheet"); ["view", "nav", "dock", "tabbar"].forEach((id) => { const el = document.getElementById(id); if (el) el.removeAttribute("inert"); }); window.scrollTo(0, 0); });
              await sleep(120);
            }
          }
        } catch (e) { add(where, [{ cat: "erreur", msg: String(e).split("\n")[0].slice(0, 160) }]); }
      }
      errs.forEach((m) => findings.push({ where: `${mode.id} ${st}`, cat: "console", msg: m }));
      await ctx.close();
      process.stdout.write(`${mode.id} ${st} : ${ROUTES.filter(([r]) => (!ROUTE_FILTER || ROUTE_FILTER.has(r)) && (st !== "vide" || EMPTY_TOO.includes(r))).length} écrans\n`);
    }
  }
  await browser.close();
  server.close();
  if (ARGS.json) fs.writeFileSync(String(ARGS.json), JSON.stringify(findings, null, 1));
  const byCat = {};
  for (const f of findings) (byCat[f.cat] = byCat[f.cat] || []).push(f);
  const cats = Object.keys(byCat).sort((a, b) => byCat[b].length - byCat[a].length);
  console.log(`\n${loads} écrans mesurés, ${findings.length} écart${findings.length > 1 ? "s" : ""}.`);
  for (const c of cats) {
    const L = byCat[c];
    console.log(`\n${c} : ${L.length}`);
    for (const f of ARGS.all ? L : L.slice(0, 8)) console.log(`  ${f.where} : ${f.msg}`);
    if (!ARGS.all && L.length > 8) console.log(`  … et ${L.length - 8} de plus (--all pour tout voir)`);
  }
  if (findings.length) process.exit(1);
  console.log("Aucun écart.");
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
else module.exports = { server, ROUTES, STATES, EMPTY_TOO, SHEETS, GROS_JS, GROS_STEPS, OFF, ready, prepare, sleep };
