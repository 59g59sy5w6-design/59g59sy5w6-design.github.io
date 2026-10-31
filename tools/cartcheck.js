// Vérification de « Annuler partout, gestes et clavier » : un produit retiré du panier revient avec sa quantité par
// « Annuler » ; « Vider le panier » puis « Annuler » rend le panier et cabas.guide identiques (les créneaux restent) ;
// un glissement vers la gauche sur une ligne révèle « Retirer », un glissement vertical non ; au clavier, « / » donne
// le focus à la recherche et « + » sur une carte ajoute un exemplaire. Code de sortie 1 en cas de problème.
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
  await browser.close();
  server.close();
  if (problems.length) { console.log("Problèmes :\n- " + problems.join("\n- ")); process.exit(1); }
  console.log("Annuler, glissement et clavier : aucun problème.");
})();
