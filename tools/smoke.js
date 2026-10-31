// Test rapide de l'appli après une mise à jour : sert le dépôt en local, ouvre les écrans principaux
// au format iPhone (accueil, Rayons par univers, un rayon par univers, fiche produit avec ses détails, panier, Remplir
// mes paniers, Recommander, recherche, guide des frais, À propos) et vérifie qu'ils s'affichent sans erreur ; puis
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
    /* Remplir mes paniers : la répartition en cours, une carte par commande, puis le mode guidé d'une commande
       (« Avant de commencer » la première fois) ; Recommander */
    await page.goto(base + "#/remplir"); await ready();
    await page.waitForSelector(".fillc", { timeout: 20000 }).catch(() => {});
    if (await check("remplir", ".fillc", 1)) {
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

    /* le bon Auchan d'après le code postal (données publiques de data/retailers.json, code postal sur le téléphone) */
    const ap = await page.evaluate(() => { const D = cabasDebug(); return ["94120", "75015", "75116", "92100", "93100", "78000", "91300", "13001", "123"].map((z) => { const a = D.autoPick(z, "auchan"); return a ? a.id + (a.exact ? "" : "~") : null; }); });
    const apWant = ["auchan", "auchan-alesia", "auchan-bellesfeuilles", "auchan-bellesfeuilles", "auchan", "auchan-bellesfeuilles~", "auchan-alesia~", null, null];
    if (JSON.stringify(ap) !== JSON.stringify(apWant)) problems.push(`autoPick : ${JSON.stringify(ap)} au lieu de ${JSON.stringify(apWant)}`);
    const rets = await page.evaluate(() => fetch("data/retailers.json").then((r) => r.json()));
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
