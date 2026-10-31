// Vérification de « Annuler partout, gestes et clavier » : un produit retiré du panier revient avec sa quantité par
// « Annuler » ; « Vider le panier » puis « Annuler » rend le panier et cabas.guide identiques (les créneaux restent) ;
// un glissement vers la gauche sur une ligne révèle « Retirer », un glissement vertical non ; au clavier, « / » donne
// le focus à la recherche et « + » sur une carte ajoute un exemplaire.
// Puis le panier intelligent, avec la promesse « le total affiché est celui qu'on obtient, livraison comprise » :
// tableau du panier (une colonne par enseigne, le prix pris coché, défilement au clavier), épingler et exclure depuis
// la ligne, Et si (le total d'un scénario est celui du panier une fois appliqué, « Annuler » le défait), panier souple
// (jamais plus cher, l'équivalent est celui de « Remplir mes paniers »), Compléter malin (le total annoncé est celui
// du panier après l'ajout), budget du mois (total payé saisi compté à part) et « Tenir le budget ». Enfin « Écouter »
// (synthèse vocale remplacée par un témoin) : la répartition lue en français (montants en euros, frais, chaque
// commande), le bouton qui devient « Arrêter la lecture », la lecture lente des réglages (prefs.voice), Ma liste.
// Code de sortie 1 en cas de problème.
// Usage : node tools/cartcheck.js
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

const iso = (d) => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); };
const plus = (n) => iso(new Date(Date.now() + n * 864e5));

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/index.html`;
  const problems = [];
  const fail = (m) => problems.push(m);
  const browser = await chromium.launch();
  const cat = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "catalog.json"), "utf8"));
  /* catalogue v2 : i = identifiant, o = offres [enseigne, centimes, jour, drapeaux] */
  const multi = cat.products.filter((p) => (p.o || []).length > 1);
  const basket = {};
  multi.slice(0, 8).forEach((p, i) => { basket[p.i] = i ? 2 : 1; });
  const one = multi[0].i;
  const guide = { ck: {}, done: { houra: true }, when: { houra: { d: plus(1), s: "soir" } } };
  const toastText = (page) => page.evaluate(() => { const t = document.getElementById("toast"); return t.hidden ? "" : t.textContent; });
  const stored = (page, k) => page.evaluate((k) => JSON.parse(localStorage.getItem("cabas." + k) || "null"), k);
  const ready = (page) => page.waitForFunction(() => !document.querySelector("#view .sk") && document.querySelector("#view .wrap > *"), null, { timeout: 20000 });

  /* ---------- téléphone ---------- */
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block", locale: "fr-FR" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => fail("erreur JS : " + e.message));
  page.on("console", (m) => { if (m.type() === "error") fail("console : " + m.text()); });
  try {
    await page.goto(base + "#/"); await ready(page);
    await page.evaluate(({ basket, guide }) => {
      localStorage.setItem("cabas.basket", JSON.stringify(basket));
      localStorage.setItem("cabas.guide", JSON.stringify(guide));
      localStorage.setItem("cabas.seen", JSON.stringify({ welcome: 1 }));
      localStorage.setItem("cabas.prefs", JSON.stringify({ zip: "94120", off: { leclerc: true }, fee: {}, pick: {}, liv: {}, keep: {}, usual: {}, qty1: {}, maxOrders: 3, extraCost: 0, offv: 1 }));
    }, { basket, guide });
    await page.goto(base + "#/panier"); await page.reload(); await ready(page);
    await page.waitForTimeout(900);

    /* 1. retirer un produit (stepper à zéro), puis « Annuler » : il revient avec sa quantité */
    const row = page.locator(`.item[data-rm="p:${one}"]`).first();
    if (!(await row.count())) fail("panier : la ligne du premier produit (data-rm) est absente");
    await row.locator('[data-act="dec"]').first().click();
    await page.waitForTimeout(250);
    let tx = await toastText(page);
    if (!/retiré/.test(tx) || !/Annuler/.test(tx)) fail(`retrait : toast « ${tx} » sans « retiré » ni « Annuler »`);
    if ((await stored(page, "basket"))[one]) fail("retrait : le produit est encore dans cabas.basket");
    await page.click("#toast button");
    await page.waitForTimeout(400);
    if ((await stored(page, "basket"))[one] !== 1) fail("Annuler : le produit ne revient pas avec sa quantité (1)");
    if (!(await page.locator(`.item[data-rm="p:${one}"]`).count())) fail("Annuler : la ligne n'est pas redessinée");
    if (await page.evaluate(() => !document.getElementById("toast").hidden)) fail("Annuler : le toast reste affiché");

    /* 2. vider le panier puis « Annuler » : panier et cabas.guide identiques, les créneaux jamais perdus */
    await page.click('[data-act="clear"]');
    await page.waitForTimeout(400);
    await page.click('[data-act="clearok"]');
    await page.waitForTimeout(400);
    tx = await toastText(page);
    if (!/Panier vidé/.test(tx) || !/Annuler/.test(tx)) fail(`vider : toast « ${tx} »`);
    if (Object.keys((await stored(page, "basket")) || {}).length) fail("vider : cabas.basket n'est pas vide");
    const g1 = await stored(page, "guide");
    if (!g1 || !g1.when || !g1.when.houra || g1.when.houra.d !== guide.when.houra.d) fail("vider : le créneau de livraison (guide.when) est perdu");
    if (g1 && g1.done && Object.keys(g1.done).length) fail("vider : guide.done devrait être vide");
    await page.click("#toast button");
    await page.waitForTimeout(500);
    const b2 = await stored(page, "basket"), g2 = await stored(page, "guide");
    const sorted = (o) => JSON.stringify(Object.keys(o || {}).sort().map((k) => [k, o[k]]));
    if (sorted(b2) !== sorted(basket)) fail("Annuler après vider : le panier n'est pas identique");
    if (JSON.stringify(g2) !== JSON.stringify(guide)) fail("Annuler après vider : cabas.guide n'est pas identique : " + JSON.stringify(g2));
    if ((await page.locator(".item[data-rm]").count()) < 8) fail("Annuler après vider : les lignes ne sont pas toutes redessinées");

    /* 3. glisser une ligne vers la gauche : « Retirer » ; un tap ailleurs referme ; un glissement vertical ne révèle rien */
    /* la ligne est amenée dans la fenêtre d'abord : avec le catalogue v2, la première ligne du panier peut être sous la barre d'onglets */
    const first = page.locator(".item[data-rm]").first();
    await first.scrollIntoViewIfNeeded(); await page.waitForTimeout(200);
    const bb = await first.boundingBox();
    const cy = bb.y + bb.height / 2;
    await page.mouse.move(bb.x + 220, cy);
    await page.mouse.down();
    await page.mouse.move(bb.x + 100, cy, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(350);
    const rm = page.locator(".item.swipe .rm");
    if (!(await rm.count())) fail("glissement : « Retirer » n'est pas révélé");
    else {
      const rb = await rm.boundingBox(), txt = (await rm.textContent()).trim();
      if (txt !== "Retirer") fail(`glissement : bouton « ${txt} » au lieu de « Retirer »`);
      if (!rb || rb.x + rb.width > 391 || rb.width < 80 || rb.height < 44) fail(`glissement : « Retirer » mal placé (${rb && JSON.stringify(rb)})`);
      if (await page.evaluate(() => location.hash !== "#/panier")) fail("glissement : la page a changé (le relâchement a compté comme un tap)");
    }
    await page.mouse.click(200, 90);
    await page.waitForTimeout(350);
    if (await page.locator(".item.swipe").count()) fail("un tap ailleurs ne referme pas la ligne glissée");
    await page.locator(".item[data-rm]").nth(1).scrollIntoViewIfNeeded(); await page.waitForTimeout(200);
    const bb2 = await page.locator(".item[data-rm]").nth(1).boundingBox();
    await page.mouse.move(bb2.x + 220, bb2.y + 10);
    await page.mouse.down();
    await page.mouse.move(bb2.x + 230, bb2.y + 160, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    if (await page.locator(".item.swipe").count()) fail("un glissement vertical révèle « Retirer »");
    /* « Retirer » révélé puis touché : le produit part, « Annuler » le remet (la souris a pu sélectionner du texte
       et faire défiler la page pendant le glissement vertical : on remet la ligne en vue) */
    await page.evaluate(() => getSelection().removeAllRanges());
    await first.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const bb3 = await first.boundingBox();
    await page.mouse.move(bb3.x + 220, bb3.y + bb3.height / 2);
    await page.mouse.down();
    await page.mouse.move(bb3.x + 100, bb3.y + bb3.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(350);
    const rid = await page.evaluate(() => { const r = document.querySelector(".item.swipe"); return r ? r.dataset.rm.slice(2) : ""; });
    await page.click(".item.swipe .rm");
    await page.waitForTimeout(350);
    if (!rid || (await stored(page, "basket"))[rid]) fail("« Retirer » après glissement ne retire pas le produit");
    if (!/Annuler/.test(await toastText(page))) fail("« Retirer » après glissement : pas d'« Annuler »");
    await page.click("#toast button");
    await page.waitForTimeout(400);
    if (rid && (await stored(page, "basket"))[rid] !== basket[rid]) fail("« Annuler » après « Retirer » ne remet pas le produit");
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 0) fail(`panier : déborde de ${over} px en largeur`);
  } catch (e) {
    fail("parcours téléphone interrompu : " + e.message.split("\n")[0]);
  }
  await ctx.close();

  /* ---------- ordinateur : « / », « + », « - » ---------- */
  const dctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block", locale: "fr-FR" });
  const dp = await dctx.newPage();
  dp.on("pageerror", (e) => fail("erreur JS (ordinateur) : " + e.message));
  dp.on("console", (m) => { if (m.type() === "error") fail("console (ordinateur) : " + m.text()); });
  try {
    await dp.goto(base + "#/rayon/eaux"); await ready(dp);
    await dp.evaluate(() => localStorage.setItem("cabas.seen", JSON.stringify({ welcome: 1 })));
    await dp.waitForTimeout(300);
    const pid = await dp.evaluate(() => { const a = document.querySelector(".card .cover"); a.focus(); return decodeURIComponent(a.getAttribute("href").split("/").pop()); });
    await dp.keyboard.press("+");
    await dp.waitForTimeout(300);
    if ((await stored(dp, "basket"))[pid] !== 1) fail("« + » sur une carte n'ajoute pas le produit");
    await dp.evaluate(() => { const a = document.querySelector(".card .cover"); a.focus(); });
    await dp.keyboard.press("+");
    await dp.waitForTimeout(300);
    if ((await stored(dp, "basket"))[pid] !== 2) fail("« + » une deuxième fois ne passe pas à 2");
    await dp.evaluate(() => { const a = document.querySelector(".card .cover"); a.focus(); });
    await dp.keyboard.press("-");
    await dp.waitForTimeout(300);
    if ((await stored(dp, "basket"))[pid] !== 1) fail("« - » sur une carte ne retire pas un exemplaire");
    await dp.evaluate(() => document.body.focus());
    await dp.keyboard.press("/");
    await dp.waitForTimeout(600);
    const foc = await dp.evaluate(() => (document.activeElement && document.activeElement.id) || "");
    if (foc !== "q") fail(`« / » ne donne pas le focus à la recherche (focus sur « ${foc} »)`);
    /* dans un champ, « / » s'écrit normalement */
    await dp.keyboard.type("a/b");
    const v = await dp.evaluate(() => document.getElementById("q").value);
    if (v !== "a/b") fail(`« / » dans un champ est intercepté (valeur « ${v} »)`);
  } catch (e) {
    fail("parcours ordinateur interrompu : " + e.message.split("\n")[0]);
  }
  await dctx.close();

  /* ---------- panier intelligent ---------- */
  const PRODS = { "contrex-eau-minerale-naturelle-6-x-1-l": 4, "tropicana-jus-d-orange-pressee-sans-pulpe-pur-jus-1-l": 2, "candia-lait-1-2-ecreme-6-x-1-l": 2, "entremont-emmental-rape-francais-160-g": 4, "president-beurre-gastronomique-doux-82-mg-250-g": 2, "barilla-pates-capellini-n-1-500-g": 6, "carapelli-huile-d-olive-vierge-extra-classico-75-cl": 2, "parmentier-sardines-a-l-huile-de-tournesol-135-g": 4 };
  const today = iso(new Date());
  const hist = [{ d: today, t: 5000, s: 300, n: 6, o: [{ rid: "houra", name: "Houra", pick: false, t: 5000, items: { "candia-lait-1-2-ecreme-6-x-1-l": 2 } }], items: { "candia-lait-1-2-ecreme-6-x-1-l": 2 }, when: [], paid: { houra: 5250 } }, { d: "2026-01-12", t: 9000, s: 0, n: 9, o: [{ rid: "houra", name: "Houra", pick: false, t: 9000, items: {} }], items: {}, when: [] }];
  const sctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block", locale: "fr-FR" });
  const sp = await sctx.newPage();
  sp.on("pageerror", (e) => fail("erreur JS (panier intelligent) : " + e.message));
  sp.on("console", (m) => { if (m.type() === "error") fail("console (panier intelligent) : " + m.text()); });
  const done = (page) => page.waitForFunction(() => { const D = cabasDebug(), R = D.RES(); return R.done && R.otherDone && !document.querySelector(".sum.loading"); }, null, { timeout: 30000 });
  const total = (page) => page.evaluate(() => cabasDebug().cartTotal());
  const shown = (page) => page.evaluate(() => { const el = document.querySelector(".sum .st .sr"); return el ? el.textContent : ""; });
  const eurC = (c) => (Math.round(c) / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "\u00a0€";
  const settle = async (page) => { await page.waitForTimeout(250); await done(page); await page.waitForTimeout(250); };
  let step = "ouverture";
  const info = [];
  /* un bouton de la page est amené au milieu de l'écran avant d'être touché : la barre d'onglets ne le cache pas */
  const tap = async (page, sel) => { await page.evaluate((sel) => { const el = document.querySelector(sel); if (el) el.scrollIntoView({ block: "center" }); }, sel); await page.waitForTimeout(120); await page.click(sel, { timeout: 8000 }).catch(async (e) => { throw new Error(sel + " : " + (await page.evaluate((sel) => { const el = document.querySelector(sel); if (!el) return "absent"; const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return JSON.stringify(r) + " sous " + (top ? top.className + "/" + top.tagName : "rien"); }, sel))); }); };
  try {
    await sp.goto(base + "#/"); await ready(sp);
    await sp.evaluate(({ PRODS, hist }) => {
      localStorage.setItem("cabas.basket", JSON.stringify(PRODS));
      localStorage.setItem("cabas.seen", JSON.stringify({ welcome: 1 }));
      localStorage.setItem("cabas.hist", JSON.stringify(hist));
      localStorage.setItem("cabas.prefs", JSON.stringify({ zip: "94120", off: { leclerc: true }, fee: {}, pick: {}, liv: {}, keep: {}, usual: {}, qty1: {}, maxOrders: 3, extraCost: 0, offv: 1, budget: 300, budgetMode: "mois" }));
    }, { PRODS, hist });
    await sp.goto(base + "#/panier"); await sp.reload(); await ready(sp); await settle(sp);
    let t0 = await total(sp);
    if (t0 == null) fail("panier intelligent : pas de total pour le panier d'essai");
    if ((await shown(sp)) !== eurC(t0)) fail(`le total affiché (${await shown(sp)}) n'est pas celui de la répartition (${eurC(t0)})`);

    step = "budget du mois";
    /* budget du mois : le total payé saisi (52,50 €) remplace le total relevé (50,00 €) du panier commandé ce mois-ci,
       le panier de janvier ne compte pas */
    const ms = await sp.evaluate(() => cabasDebug().monthSpend());
    if (ms.spent !== 5250 || ms.n !== 1 || ms.typed !== 1) fail("budget du mois : dépenses " + JSON.stringify(ms));
    const bud = await sp.evaluate(() => (document.querySelector(".sum .bud") || {}).textContent || "");
    const left = 30000 - 5250 - t0;
    if (!bud.includes(left >= 0 ? `il te reste ${eurC(left)} ce mois-ci` : `dépassé de ${eurC(-left)}`)) fail(`budget du mois : « ${bud} », attendu ${eurC(left)}`);
    /* budgetFit : les remplacements les plus rentables au total exact, jusqu'à combler le dépassement */
    const bf = await sp.evaluate(() => { const D = cabasDebug(), sw = [{ from: { id: "a" }, to: { id: "a2" }, save: 1 }, { from: { id: "b" }, to: { id: "b2" }, save: 1 }, { from: { id: "c" }, to: { id: "c2" }, save: 1 }]; return D.budgetFit(10000, 10500, sw, new Map([["a", 10400], ["b", 10100], ["c", 10600]])); });
    if (bf.over !== 500 || bf.swaps.map((x) => x.from.id).join() !== "b,a" || bf.save !== 500 || !bf.enough) fail("budgetFit : " + JSON.stringify({ over: bf.over, ids: bf.swaps.map((x) => x.from.id), save: bf.save }));

    step = "tableau";
    /* tableau du panier : une ligne par produit, une colonne par enseigne, chaque produit pris coché une fois ; le
       tableau défile de côté au clavier */
    await tap(sp, '[data-act="cview"][data-v="tab"]'); await sp.waitForTimeout(300);
    const tb = await sp.evaluate(() => { const D = cabasDebug(), M = D.RES().M, t = document.querySelector(".ctbl table"); if (!t) return null; return { rows: t.tBodies[0].rows.length, cols: t.tHead.rows[0].cells.length, on: t.querySelectorAll("td.on").length, lines: M.lines.length + M.uncovered.length, chans: M.chans.length, region: document.querySelector(".ctbl").getAttribute("role"), tab: document.querySelector(".ctbl").tabIndex }; });
    if (!tb) fail("tableau : absent");
    else {
      if (tb.rows !== tb.lines || tb.cols !== tb.chans + 1) fail("tableau : " + JSON.stringify(tb));
      if (tb.on < 1 || tb.on > tb.lines) fail(`tableau : ${tb.on} prix cochés pour ${tb.lines} produits`);
      if (tb.region !== "region" || tb.tab !== 0) fail("tableau : la zone qui défile n'est pas une région atteignable au clavier");
      await sp.focus(".ctbl"); await sp.keyboard.press("ArrowRight"); await sp.keyboard.press("ArrowRight"); await sp.waitForTimeout(250);
      const sc = await sp.evaluate(() => { const c = document.querySelector(".ctbl"); return { x: c.scrollLeft, w: c.scrollWidth - c.clientWidth }; });
      if (sc.w > 0 && sc.x <= 0) fail("tableau : les flèches du clavier ne le font pas défiler");
    }
    const over = await sp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 0) fail(`tableau : la page déborde de ${over} px`);
    await tap(sp, '[data-act="cview"][data-v="cmd"]'); await sp.waitForTimeout(300);

    step = "épingler";
    /* épingler : le produit va dans l'enseigne choisie, le total affiché est le nouveau total ; exclure : il n'y va plus */
    const pick = await sp.evaluate((ids) => {
      const D = cabasDebug(), S = D.S;
      for (const id of ids) {
        const pl = D.placeOf(id);
        if (!pl || pl.mag) continue;
        const gs = S.rets.filter((r) => { const o = S.prods.get(id).offers[r.id]; return o && o.price > 0 && r.id !== pl.ret; }).map((r) => r.group || r.id);
        if (gs.length) return { id, from: pl.ret, g: gs[0] };
      }
      return null;
    }, Object.keys(PRODS));
    if (!pick) fail("épingler : aucun produit vendu par une autre enseigne");
    else {
      await tap(sp, `.lpb[data-id="${pick.id}"]`); await sp.waitForTimeout(400);
      if (await sp.evaluate(() => document.getElementById("sheet").hidden)) fail("le prix d'une ligne n'ouvre pas « Où le prendre »");
      await tap(sp, `#sheet [data-act="itempin"][data-g="${pick.g}"]`); await settle(sp);
      const foot = await sp.evaluate(() => document.querySelector("#sheet .sheet-f").textContent);
      await tap(sp, "#sheet .sheet-h [data-act=close]"); await settle(sp);
      const pl = await sp.evaluate((id) => { const D = cabasDebug(), p = D.placeOf(id), r = p && D.S.allMap.get(p.ret); return r ? r.group || r.id : null; }, pick.id);
      if (pl !== pick.g) fail(`épingler : ${pick.id} est chez ${pl}, pas chez ${pick.g}`);
      const t1 = await total(sp);
      if ((await shown(sp)) !== eurC(t1)) fail("épingler : le total affiché n'est pas celui de la nouvelle répartition");
      if (!foot.includes(eurC(t1))) fail(`épingler : la feuille annonçait « ${foot.trim()} », le panier fait ${eurC(t1)}`);
      if (!(await sp.evaluate((id) => !!document.querySelector(`.item[data-rm="p:${id}"] .inote`), pick.id))) fail("épingler : la ligne ne dit pas « Toujours chez … »");
      step = "exclure";
      /* exclure l'enseigne épinglée : l'épingle tombe, le produit n'y est plus pris */
      await tap(sp, `.lpb[data-id="${pick.id}"]`); await sp.waitForTimeout(400);
      await tap(sp, `#sheet [data-act="itemban"][data-g="${pick.g}"]`); await settle(sp);
      await tap(sp, "#sheet .sheet-h [data-act=close]"); await settle(sp);
      const st = await sp.evaluate((id) => { const D = cabasDebug(), p = D.placeOf(id), r = p && D.S.allMap.get(p.ret); return { at: r ? r.group || r.id : null, pin: D.S.prefs.pin[id] || null, ban: D.S.prefs.ban[id] || null }; }, pick.id);
      if (st.at === pick.g || st.pin || !st.ban || !st.ban[pick.g]) fail("exclure : " + JSON.stringify(st));

      step = "Et si";
      /* Et si : « Sans tes choix d'enseigne » et « Sans X » donnent le total qu'on obtient en appliquant */
      await tap(sp, "details.wif > summary"); await sp.waitForTimeout(300);
      await sp.waitForFunction(() => document.querySelector("#wif") && !/Calcul/.test(document.querySelector("#wif").textContent), null, { timeout: 20000 });
      const rows = await sp.evaluate(() => [...document.querySelectorAll("#wif .wifr:not(.cur)")].map((r) => { const b = r.querySelector("[data-act=wifgo]"); return { w: b.dataset.w, g: b.dataset.g || "", ok: !b.disabled, val: r.querySelector(".val").textContent }; }));
      const free = rows.find((r) => r.w === "free");
      if (!free) fail("Et si : pas de scénario « Sans tes choix d'enseigne » alors qu'un produit est exclu");
      const sans = rows.find((r) => r.w === "sans" && r.ok);
      if (!sans) fail("Et si : aucun scénario « Sans … » applicable : " + JSON.stringify(rows));
      else {
        const before = await sp.evaluate(() => JSON.stringify(cabasDebug().S.prefs.off));
        await tap(sp, `#wif [data-act=wifgo][data-w=sans][data-g="${sans.g}"]`); await settle(sp);
        const t2 = await total(sp);
        info.push(`Et si sans ${sans.g} ${sans.val}`);
        if (eurC(t2) !== sans.val) fail(`Et si : « Sans ${sans.g} » annonçait ${sans.val}, le panier fait ${eurC(t2)}`);
        if (!(await sp.evaluate((g) => !!cabasDebug().S.prefs.off[g], sans.g))) fail("Et si : l'enseigne n'est pas désactivée");
        if (!/Annuler/.test(await toastText(sp))) fail("Et si : pas d'« Annuler »");
        await tap(sp, "#toast button"); await settle(sp);
        if ((await sp.evaluate(() => JSON.stringify(cabasDebug().S.prefs.off))) !== before) fail("Et si : « Annuler » ne remet pas l'enseigne");
      }
      if (free && free.ok) {
        /* après « Annuler », les scénarios se recalculent : le même total revient */
        await sp.waitForFunction((v) => { const b = document.querySelector("#wif [data-act=wifgo][data-w=free]"); return b && !b.disabled && b.closest(".wifr").querySelector(".val").textContent === v; }, free.val, { timeout: 20000 }).catch(async () => fail("Et si : après « Annuler », « Sans tes choix d'enseigne » ne revient pas au même total : " + (await sp.evaluate(() => (document.querySelector("#wif") || {}).textContent)) + " / " + free.val));
        await tap(sp, "#wif [data-act=wifgo][data-w=free]"); await settle(sp);
        const t3 = await total(sp);
        if (eurC(t3) !== free.val) fail(`Et si : « Sans tes choix d'enseigne » annonçait ${free.val}, le panier fait ${eurC(t3)}`);
        if (await sp.evaluate((id) => !!(cabasDebug().S.prefs.ban[id] || cabasDebug().S.prefs.pin[id]), pick.id)) fail("Et si : les choix d'enseigne restent");
        if (Math.abs(t3 - t0) > 0) fail(`sans épingle ni exclusion, le total (${eurC(t3)}) devrait redevenir ${eurC(t0)}`);
      }
    }

    step = "panier souple";
    /* panier souple : tout cocher ne fait jamais monter le total ; un équivalent pris est le produit que « Remplir mes
       paniers » ouvre, et l'instantané compte le même total, frais compris */
    t0 = await total(sp);
    await tap(sp, "[data-act=flex]"); await sp.waitForTimeout(400);
    await tap(sp, "#sheet [data-act=flexall]"); await sp.waitForTimeout(200);
    await tap(sp, "#sheet .sheet-h [data-act=close]"); await settle(sp);
    const fx = await sp.evaluate(() => {
      const D = cabasDebug(), snap = D.fillSnap(), alts = [];
      const R = D.RES(), st = R.steps[R.K], bst = st && st.full;
      if (bst) bst.orders.forEach((o) => o.items.forEach((x) => { if (x.alt) alts.push({ id: x.l.id, alt: x.alt, ret: o.ch.id }); }));
      let snapTot = 0;
      if (snap) { snap.orders.forEach((o) => { const sub = o.items.reduce((a, x) => a + x.cost, 0); snapTot += sub + (sub > 0 ? feeAt(o.P, sub) : 0); }); snapTot += snap.comp.reduce((a, x) => a + x.cost, 0); }
      const inSnap = alts.every((a) => snap.orders.some((o) => o.rid === a.ret && o.items.some((x) => x.id === a.alt)));
      return { n: Object.keys(D.S.flex).length, alts, inSnap, snapTot, lines: document.querySelectorAll(".item .inote").length };
    });
    const t4 = await total(sp);
    info.push(`panier souple ${eurC(t0)} puis ${eurC(t4)}, ${fx.alts.length} équivalents pris`);
    if (!fx.n) fail("panier souple : « Tout cocher » n'a rien coché");
    if (t4 > t0) fail(`panier souple : le total monte (${eurC(t0)} puis ${eurC(t4)})`);
    if (fx.snapTot !== t4) fail(`panier souple : « Remplir mes paniers » compterait ${eurC(fx.snapTot)}, le panier affiche ${eurC(t4)}`);
    if (!fx.inSnap) fail("panier souple : l'équivalent pris n'est pas le produit de « Remplir mes paniers »");
    if (fx.alts.length && (await sp.evaluate(() => !document.querySelector(".item .inote")))) fail("panier souple : la ligne ne dit pas qu'un équivalent est pris");

    step = "Compléter malin";
    /* Compléter malin : le total annoncé pour un produit est celui du panier une fois le produit ajouté */
    const rid = await sp.evaluate(() => { const R = cabasDebug().RES(), st = R.steps[R.K]; return st.full.orders[0].ch.id; });
    await sp.evaluate((rid) => { const b = document.createElement("button"); b.dataset.act = "topup"; b.dataset.id = rid; b.id = "topt"; b.type = "button"; b.textContent = "Compléter"; document.querySelector("#view .wrap").appendChild(b); }, rid);
    await sp.evaluate(() => document.getElementById("topt").click()); await sp.waitForTimeout(400);
    await sp.waitForFunction(() => document.querySelector("#sheet .tup") && ![...document.querySelectorAll("#sheet .tup .eff")].some((e) => /Calcul/.test(e.textContent)), null, { timeout: 30000 }).catch(() => fail("Compléter malin : les totaux ne arrivent pas"));
    const cand = await sp.evaluate(() => { const b = document.querySelector("#sheet [data-act=topadd]"); return b ? { id: b.dataset.id, eff: b.closest(".tup").querySelector(".eff").textContent } : null; });
    if (!cand) fail("Compléter malin : aucun produit proposé");
    else {
      const g = await sp.evaluate((id) => cabasDebug().topupGain(id), cand.id);
      const okText = g.after == null || cand.eff.includes(eurC(g.after)) || (g.delta < 0 && cand.eff.includes(eurC(-g.delta))) || (g.delta >= 0 && cand.eff.includes(eurC(g.delta)));
      if (!okText) fail(`Compléter malin : « ${cand.eff} » ne correspond pas au calcul (${JSON.stringify(g)})`);
      await tap(sp, `#sheet [data-act=topadd][data-id="${cand.id}"]`); await settle(sp);
      await tap(sp, "#sheet .sheet-h [data-act=close]"); await settle(sp);
      const t5 = await total(sp);
      info.push(`Compléter malin « ${cand.eff} »`);
      if (t5 !== g.after) fail(`Compléter malin : annoncé ${g.after == null ? "aucun total" : eurC(g.after)}, le panier fait ${t5 == null ? "aucun total" : eurC(t5)}`);
    }

    step = "tenir le budget";
    /* tenir le budget : un budget par panier trop bas, les remplacements retenus au total exact, puis appliqués */
    await sp.evaluate(() => { const D = cabasDebug(); D.S.prefs.budget = 40; D.S.prefs.budgetMode = "panier"; D.S.flex = {}; localStorage.setItem("cabas.prefs", JSON.stringify(D.S.prefs)); localStorage.setItem("cabas.flex", "{}"); });
    await sp.reload(); await ready(sp); await settle(sp);
    await tap(sp, "[data-act=budfit]"); await sp.waitForTimeout(400);
    await sp.waitForFunction(() => { const b = document.querySelector("#sheet .sheet-b"); return b && !/Calcul/.test(b.textContent); }, null, { timeout: 40000 }).catch(() => fail("Tenir le budget : le calcul ne finit pas"));
    const fit = await sp.evaluate(() => { const p = [...document.querySelectorAll("#sheet .gf")].map((e) => e.textContent).find((x) => /^Avec ce/.test(x)); const m = p && /: ([\d\s\u00a0\u202f.,]+€)/.exec(p); return { txt: p || "", val: m ? m[1] : null, btn: !!document.querySelector("#sheet [data-act=budswap]") }; });
    if (fit.btn) {
      await tap(sp, "#sheet [data-act=budswap]"); await settle(sp);
      await tap(sp, "#sheet .sheet-h [data-act=close]"); await settle(sp);
      const t6 = await total(sp);
      info.push(`tenir le budget « ${fit.txt} »`);
      if (eurC(t6) !== fit.val) fail(`Tenir le budget : annoncé « ${fit.txt} », le panier fait ${eurC(t6)}`);
    } else if (!/Aucun remplacement/.test(await sp.evaluate(() => document.querySelector("#sheet .sheet-b").textContent))) fail("Tenir le budget : ni remplacement ni explication");
    const over2 = await sp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over2 > 0) fail(`panier intelligent : la page déborde de ${over2} px`);
  } catch (e) {
    fail(`panier intelligent interrompu (${step}) : ` + e.message.split("\n")[0]);
  }
  await sctx.close();

  /* ---------- écouter : speechSynthesis remplacé par un témoin qui garde ce qui est dit ---------- */
  const vctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block", locale: "fr-FR" });
  await vctx.addInitScript(() => {
    window.__said = [];
    const synth = { _u: null, getVoices: () => [{ lang: "en-US", name: "en", localService: true }, { lang: "fr-FR", name: "fr", localService: true }], speak(u) { window.__said.push({ text: u.text, rate: u.rate, lang: u.lang, voice: u.voice && u.voice.lang }); this._u = u; }, cancel() { const u = this._u; this._u = null; if (u && u.onend) u.onend(); } };
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
    window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  });
  const vp = await vctx.newPage();
  vp.on("pageerror", (e) => fail("erreur JS (écouter) : " + e.message));
  vp.on("console", (m) => { if (m.type() === "error") fail("console (écouter) : " + m.text()); });
  try {
    await vp.goto(base + "#/"); await ready(vp);
    await vp.evaluate((b) => { localStorage.clear(); localStorage.setItem("cabas.basket", JSON.stringify(b)); localStorage.setItem("cabas.seen", JSON.stringify({ welcome: 1 })); localStorage.setItem("cabas.prefs", JSON.stringify({ zip: "94120", off: { leclerc: true }, offv: 1 })); }, PRODS);
    await vp.goto(base + "#/panier"); await vp.reload(); await ready(vp);
    await vp.waitForSelector(".order", { timeout: 20000 });
    await vp.click("[data-act=speak][data-k=panier]"); await vp.waitForTimeout(300);
    const said = await vp.evaluate(() => window.__said);
    const t = (said[0] || {}).text || "";
    if (!/^Ton panier : \d+ articles, /.test(t) || !/livraison comprise/.test(t) || !/Chez [A-Z]/.test(t) || !/\d+ euros/.test(t)) fail("écouter le panier : « " + t.slice(0, 160) + " »");
    if (/€/.test(t)) fail("écouter le panier : les montants doivent se dire en euros, pas avec le signe €");
    if ((said[0] || {}).lang !== "fr-FR" || (said[0] || {}).voice !== "fr-FR" || (said[0] || {}).rate !== 1) fail("écouter : voix française au débit normal attendue " + JSON.stringify(said[0] && { lang: said[0].lang, voice: said[0].voice, rate: said[0].rate }));
    if ((await vp.getAttribute("[data-act=speak][data-k=panier]", "aria-pressed")) !== "true" || !/Arrêter la lecture/.test(await vp.textContent("[data-act=speak][data-k=panier]"))) fail("écouter : le bouton devrait dire « Arrêter la lecture »");
    await vp.click("[data-act=speak][data-k=panier]"); await vp.waitForTimeout(200);
    if ((await vp.getAttribute("[data-act=speak][data-k=panier]", "aria-pressed")) !== "false") fail("écouter : un second appui doit arrêter la lecture");
    await vp.evaluate(() => { location.hash = "#/reglages"; }); await vp.waitForTimeout(500);
    await vp.click('[data-act=voice][data-v="slow"]'); await vp.waitForTimeout(300);
    const s2 = await vp.evaluate(() => window.__said);
    if (((await stored(vp, "prefs")) || {}).voice !== "slow" || (s2[s2.length - 1] || {}).rate !== 0.8) fail("lecture lente : prefs.voice ou débit " + JSON.stringify(s2[s2.length - 1]));
    await vp.evaluate(() => { location.hash = "#/ecrire"; }); await vp.waitForTimeout(400);
    await vp.fill("#wlIn", "lait\n2 paquets de pâtes\nzzzzzz"); await vp.click("[data-act=wlgo]"); await vp.waitForTimeout(700);
    await vp.click("[data-act=speak][data-k=liste]"); await vp.waitForTimeout(300);
    const s3 = await vp.evaluate(() => window.__said), t3 = (s3[s3.length - 1] || {}).text || "";
    if (!/^Ta liste : 2 produits trouvés sur 3\./.test(t3) || !/Pas trouvé : zzzzzz/.test(t3)) fail("écouter Ma liste : « " + t3.slice(0, 160) + " »");
  } catch (e) {
    fail("écouter interrompu : " + e.message.split("\n")[0]);
  }
  await vctx.close();
  await browser.close();
  server.close();
  if (info.length) console.log(info.join("\n"));
  if (problems.length) { console.log("Problèmes :\n- " + problems.join("\n- ")); process.exit(1); }
  console.log("Annuler, glissement et clavier, panier intelligent (tableau, épingler, exclure, Et si, panier souple, Compléter malin, budget du mois, tenir le budget), écouter : aucun problème.");
})();
