// Vérification de l'orthographe tolérante et de la complétion dans la recherche : trente fautes courantes rapprochées du
// bon mot (fuzzyWord), un mot qui a des résultats jamais corrigé, « yaourth » qui donne des yaourts avec la ligne
// « Résultats pour « yaourt » », « lqit » corrigé en « lait », et la rangée de suggestions pendant la frappe.
// Code de sortie 1 en cas de problème. Usage : node tools/askcheck.js
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
  } catch (e) {
    fail("parcours interrompu : " + e.message.split("\n")[0]);
  }
  await browser.close();
  server.close();
  if (problems.length) { console.log("Problèmes :\n- " + problems.join("\n- ")); process.exit(1); }
  console.log(`Orthographe tolérante et complétion : ${TYPOS.length} fautes corrigées, aucun problème.`);
})();
