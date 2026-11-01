// Prix simulés d'E.Leclerc dits partout où ils comptent, jamais présentés comme relevés. E.Leclerc activé, un panier dont
// la répartition passe par lui : la liste copiée de « Remplir mes paniers » et le texte partagé du panier disent
// « estimation avec des prix simulés » ; les lignes de « Et si » qui passent par E.Leclerc, et « Ta répartition », disent
// « prix simulés » ; « Pas trouvé » chez E.Leclerc signale chaque équivalent simulé et l'effet sur la commande ; le panier
// commandé garde le drapeau sim dans cabas.hist, et le budget du mois, « Tes économies » et « Tes dépenses » ne disent
// pas « aux prix relevés » pour lui ; tout en drive, le drive E.Leclerc est dit simulé, et tout en magasin ne le prend
// jamais. Aucun site d'enseigne n'est chargé. Code de sortie 1 en cas de problème.
// Usage : node tools/simcheck.js
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

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`, base = origin + "/index.html";
  const problems = [];
  const fail = (m) => problems.push(m);
  const LEC = "leclerc-livraison";
  const cat = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "catalog.json"), "utf8"));
  const R = cat.rets, li = R.indexOf(LEC), mo = R.indexOf("monoprix");
  /* des produits que vendent E.Leclerc et Monoprix : la répartition prend une commande E.Leclerc */
  const basket = {};
  cat.products.filter((p) => (p.o || []).some((o) => o[0] === li) && (p.o || []).some((o) => o[0] === mo)).slice(0, 30).forEach((p) => { basket[p.i] = 2; });
  const PREFS = { zip: "94120", off: {}, fee: {}, pick: {}, liv: {}, keep: {}, usual: {}, qty1: {}, maxOrders: 3, extraCost: 0, offv: 1, budget: 50, budgetMode: "mois" };

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block", locale: "fr-FR", timezoneId: "Europe/Paris" });
  await ctx.route((url) => !String(url).startsWith(origin), (r) => r.abort());
  const page = await ctx.newPage();
  page.on("pageerror", (e) => fail("erreur JS : " + e.message));
  const ready = () => page.waitForFunction(() => !document.querySelector("#view .sk") && document.querySelector("#view .wrap > *"), null, { timeout: 30000 });
  const done = () => page.waitForFunction(() => { const D = window.cabasDebug && cabasDebug(); if (!D) return false; const R = D.RES(); return R.by && R.done && R.otherDone && !document.querySelector(".sum.loading"); }, null, { timeout: 60000 });
  const go = async (h) => { await page.evaluate((h) => { location.hash = h; }, h); await page.waitForTimeout(500); };
  try {
    await page.goto(base + "#/"); await ready();
    await page.evaluate(({ basket, PREFS }) => {
      localStorage.clear();
      localStorage.setItem("cabas.basket", JSON.stringify(basket));
      localStorage.setItem("cabas.seen", JSON.stringify({ welcome: 1, first: { leclerc: 1, monoprix: 1, houra: 1, carrefour: 1, auchan: 1 } }));
      localStorage.setItem("cabas.prefs", JSON.stringify(PREFS));
    }, { basket, PREFS });
    await page.goto(base + "#/panier"); await page.reload(); await ready(); await done();
    const orders = await page.evaluate(() => { const R = cabasDebug().RES(), st = R.steps[R.K]; return (st.full || st.partial).orders.map((o) => o.ch.id); });
    if (!orders.includes(LEC)) throw new Error("la répartition ne passe pas par E.Leclerc (" + orders.join(", ") + ")");

    /* le texte partagé du panier et la liste copiée de « Remplir mes paniers » */
    const share = await page.evaluate(() => cabasDebug().cartText());
    if (!/Total : .*estimation avec des prix simulés/.test(share)) fail("texte partagé : le total ne dit pas « estimation avec des prix simulés » : " + share.split("\n").pop());
    const ft = await page.evaluate(() => cabasDebug().fillText());
    const tot = ft.split("\n").filter((l) => /^Total/.test(l))[0] || "";
    if (/aux prix relevés/.test(tot) || !/prix simulés/.test(tot)) fail("liste copiée : « " + tot + " »");

    /* « Et si » : chaque ligne qui passe par E.Leclerc, et « Ta répartition », disent « prix simulés » */
    await page.evaluate(() => { const s = document.querySelector("details.wif > summary"); s.scrollIntoView(); s.click(); });
    await page.waitForFunction(() => document.querySelector("#wif") && !/Calcul/.test(document.querySelector("#wif").textContent), null, { timeout: 40000 });
    const wif = await page.evaluate(() => [...document.querySelectorAll("#wif .row")].map((r) => r.textContent.replace(/\s+/g, " ").trim()));
    const cur = wif.find((t) => /^Ta répartition/.test(t)) || "";
    if (!/prix simulés/.test(cur)) fail("Et si : « Ta répartition » sans « prix simulés » : " + cur);
    /* « Sans E.Leclerc » est un total sans lui, aux prix relevés */
    for (const t of wif) if (/Leclerc/.test(t.replace(/^Sans E\.Leclerc/, "")) && /\d,\d\d\s?€/.test(t) && !/simul/i.test(t)) fail("Et si : ligne E.Leclerc sans « simulé » : " + t);
    if (!wif.some((t) => /Leclerc/.test(t.replace(/^Sans E\.Leclerc/, "")) && /prix simulés/.test(t)) && !wif.some((t) => /^Sans E\.Leclerc/.test(t))) fail("Et si : aucune ligne E.Leclerc à vérifier");
    await page.evaluate(() => { const s = document.querySelector("details.wif[open] > summary"); if (s) s.click(); });

    /* « Pas trouvé » chez E.Leclerc : équivalents et effet sur la commande */
    await page.evaluate(() => { const b = document.querySelector('[data-act="fillgo"]'); b.scrollIntoView({ block: "center" }); b.click(); });
    await page.waitForTimeout(1500);
    const miss = await page.evaluate((LEC) => { const D = cabasDebug(), o = D.S.guide.snap.orders.find((x) => x.rid === LEC); for (const x of o.items) if (D.equivOf(D.S.prods.get(x.id), LEC).length) return x.id; return o.items[0].id; }, LEC);
    await page.evaluate(({ LEC, miss }) => { const b = document.createElement("button"); b.dataset.act = "fillmiss"; b.dataset.id = LEC; b.dataset.p = miss; document.body.appendChild(b); b.click(); b.remove(); }, { LEC, miss });
    await page.waitForSelector("#sheet:not([hidden])", { timeout: 5000 });
    const eqs = await page.evaluate(() => [...document.querySelectorAll("#sheet [data-act=fillequiv]")].map((b) => b.textContent.replace(/\s+/g, " ").trim()));
    if (!eqs.length) fail("Pas trouvé : aucun équivalent chez E.Leclerc à vérifier");
    for (const t of eqs) if (!/prix simulé/.test(t)) fail("Pas trouvé : équivalent sans « prix simulé » : " + t);
    const rows = await page.evaluate(() => [...document.querySelectorAll("#sheet .row")].map((b) => b.textContent.replace(/\s+/g, " ").trim()));
    for (const t of rows) if (/Ta commande E\.Leclerc passe à \d+,\d\d\s?€(?! \(prix simulés\))/.test(t)) fail("Pas trouvé : effet sur la commande E.Leclerc sans « prix simulés » : " + t);
    await page.keyboard.press("Escape"); await page.waitForTimeout(300);

    /* le panier commandé : drapeau sim dans cabas.hist, budget du mois, tes économies, tes dépenses */
    const h = await page.evaluate(() => { const D = cabasDebug(), s = D.S.guide.snap; s.orders.forEach((o) => { D.S.guide.done[o.rid] = true; }); D.recordFill(); return D.S.hist[D.S.hist.length - 1]; });
    const ho = (h && h.o || []).find((o) => o.rid === LEC);
    if (!ho || ho.sim !== true) fail("historique : la commande E.Leclerc n'a pas le drapeau sim");
    if ((h.o || []).some((o) => o.rid !== LEC && o.sim)) fail("historique : drapeau sim sur une commande à prix relevés");
    const ms = await page.evaluate(() => cabasDebug().monthSpend());
    if (!ms.rows.length || !ms.rows[ms.rows.length - 1].sim) fail("budget du mois : le panier E.Leclerc n'est pas compté comme simulé");
    await page.evaluate(() => { const b = document.createElement("button"); b.dataset.act = "budget"; document.body.appendChild(b); b.click(); b.remove(); });
    await page.waitForSelector("#sheet:not([hidden])", { timeout: 5000 });
    const bud = await page.evaluate(() => [...document.querySelectorAll("#sheet .row")].map((r) => r.textContent.replace(/\s+/g, " ").trim()));
    if (!bud.some((t) => /E\.Leclerc/.test(t) && /prix simulés/.test(t)) || bud.some((t) => /E\.Leclerc/.test(t) && /aux prix relevés/.test(t))) fail("budget du mois : « " + bud.join(" | ") + " »");
    await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    await go("#/economies"); await ready();
    const eco = await page.evaluate(() => [...document.querySelectorAll("#view .row")].map((r) => r.textContent.replace(/\s+/g, " ").trim()).filter((t) => /E\.Leclerc/.test(t)));
    if (!eco.length || eco.some((t) => /aux prix relevés/.test(t) || !/simulés/.test(t))) fail("tes économies : « " + eco.join(" | ") + " »");
    await go("#/mouvements"); await ready(); await page.waitForTimeout(1500);
    const dep = await page.evaluate(() => { const h = [...document.querySelectorAll("#view h2")].find((x) => /Tes dépenses/.test(x.textContent)); let n = h && h.nextElementSibling; while (n && n.tagName !== "P") n = n.nextElementSibling; return n ? n.textContent : ""; });
    if (!/prix simulés/.test(dep)) fail("tes dépenses : « " + dep + " »");

    /* tout en drive : le drive E.Leclerc, aux prix simulés, le dit (titre du total, choix de la façon, commande) ; tout en
       magasin ne le prend jamais, et son total ne parle pas de prix simulés */
    await page.evaluate(() => { const D = cabasDebug(); D.S.guide = { ck: {}, done: {}, when: {} }; D.S.prefs.comp = "drive"; });
    await go("#/"); await go("#/panier"); await ready(); await done(); await page.waitForTimeout(400);
    const dv = await page.evaluate(() => {
      const D = cabasDebug(), R = D.RES(), st = R.steps[R.K], f = st && (st.full || st.partial);
      const how = (h) => { const e = document.querySelector(`[data-howt="${h}"]`); return e ? e.textContent : ""; };
      return { mode: R.mode, ids: f ? f.orders.map((o) => o.ch.id) : [], sl: (document.querySelector(".sum .sl") || {}).textContent || "", drive: how("drive"), mag: how("mag"), magChans: R.by.mag.M.chans.map((c) => c.id), sec: [...document.querySelectorAll("#view .order")].filter((o) => /E\.Leclerc/.test(o.textContent)).map((o) => o.textContent.replace(/\s+/g, " ")) };
    });
    if (dv.mode !== "drive" || !dv.ids.includes("leclerc-drive")) fail("tout en drive : la répartition ne passe pas par le drive E.Leclerc " + JSON.stringify(dv.ids));
    else {
      if (!/prix simulés/.test(dv.sl)) fail("tout en drive : le total ne dit pas « prix simulés » : " + dv.sl);
      if (!/prix simulés/.test(dv.drive)) fail("tout en drive : le choix de la façon ne dit pas « prix simulés » : " + dv.drive);
      if (!dv.sec.length || dv.sec.some((t) => !/simulés/.test(t))) fail("tout en drive : la commande E.Leclerc ne dit pas « simulés »");
    }
    if (dv.magChans.some((id) => /leclerc/.test(id))) fail("tout en magasin : E.Leclerc, aux prix simulés, est compté en magasin");
    if (/simulés/.test(dv.mag)) fail("tout en magasin : le total parle de prix simulés : " + dv.mag);
  } catch (e) {
    fail("parcours interrompu : " + e.message.split("\n")[0]);
  }
  await browser.close();
  server.close();
  if (problems.length) { console.log("Problèmes :\n- " + problems.join("\n- ")); process.exit(1); }
  console.log("Prix simulés : dits dans la liste copiée, le texte partagé, Et si, Pas trouvé, l'historique, le budget du mois, tes économies, tes dépenses et tout en drive ; jamais en magasin.");
})();
