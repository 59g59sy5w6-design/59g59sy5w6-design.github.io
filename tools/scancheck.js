// Vérification du lecteur de codes-barres (scan.js) sur des images de synthèse : codes EAN-13 et EAN-8 à plusieurs
// tailles, avec bruit, flou, éclairage inégal et inclinaison ; une image de bruit seul ne doit rien donner. Puis, quand
// Playwright est là, le mode magasin (#/magasin) et le scanner : « Scanner un produit » depuis la liste, le code tapé
// d'un produit du panier le coche dans la liste du magasin, ce qu'il reste à lire à voix haute (speakText), la
// feuille d'impression (sans barres ni boutons, la liste et la date), un code inconnu dont l'équivalent choisi est
// retenu (cabas.eans : relu sans Open Food Facts, « Oublier ce choix » et « Annuler », coché en magasin), et la liste
// du magasin qui suit la répartition (ouverte directement, puis après un changement du panier).
// Usage : node tools/scancheck.js
const fs = require("fs");
const path = require("path");
new Function(fs.readFileSync(path.join(__dirname, "..", "scan.js"), "utf8"))();
const Scan = globalThis.Scan;
const Lb = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const Rb = Lb.map((s) => s.replace(/./g, (c) => (c === "0" ? "1" : "0")));
const Gb = Rb.map((s) => s.split("").reverse().join(""));
const PAR = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];
function bits(code) {
  const d = code.split("").map(Number);
  if (d.length === 13) {
    const par = PAR[d[0]];
    let s = "101";
    for (let i = 0; i < 6; i++) s += (par[i] === "L" ? Lb : Gb)[d[i + 1]];
    s += "01010";
    for (let i = 7; i < 13; i++) s += Rb[d[i]];
    return s + "101";
  }
  let s = "101";
  for (let i = 0; i < 4; i++) s += Lb[d[i]];
  s += "01010";
  for (let i = 4; i < 8; i++) s += Rb[d[i]];
  return s + "101";
}
function image(code, opt) {
  const b = bits(code), quiet = 12, scale = opt.scale, W = Math.round((b.length + 2 * quiet) * scale) + 40, H = 90;
  const px = new Float32Array(W * H).fill(opt.white);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const xx = x - 20 + (opt.tilt ? (y - H / 2) * opt.tilt : 0);
    const m = Math.floor(xx / scale) - quiet;
    const dark = m >= 0 && m < b.length && b[m] === "1";
    let v = dark ? opt.black : opt.white;
    if (opt.grad) v = v * (0.6 + 0.4 * (x / W));
    px[y * W + x] = v;
  }
  if (opt.blur) {
    const out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0, n = 0; for (let k = -opt.blur; k <= opt.blur; k++) { const xk = x + k; if (xk >= 0 && xk < W) { s += px[y * W + xk]; n++; } } out[y * W + x] = s / n; }
    px.set(out);
  }
  const data = new Uint8ClampedArray(W * H * 4);
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < W * H; i++) { const v = Math.max(0, Math.min(255, px[i] + (rnd() - 0.5) * opt.noise)); data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v; data[i * 4 + 3] = 255; }
  return { data, width: W, height: H };
}
const codes = ["3017620422003", "3270190021056", "5000159484695", "8000500310427", "3228857000906", "96385074", "20123451", "3560071268152", "4006381333931", "7622210449283"];
let ok = 0, n = 0, falsePos = 0; const stats = [];
for (const code of codes) for (const opt of [
  { scale: 3, black: 20, white: 235, noise: 0, blur: 0 },
  { scale: 2.3, black: 40, white: 220, noise: 30, blur: 1 },
  { scale: 1.7, black: 50, white: 200, noise: 24, blur: 1, grad: true },
  { scale: 4.1, black: 60, white: 210, noise: 40, blur: 2, tilt: 0.04 },
  { scale: 2.6, black: 30, white: 230, noise: 20, blur: 1, tilt: -0.06, grad: true },
]) {
  n++;
  const rr = Scan.decode(image(code, opt)), r = rr && rr.code; if (rr) stats.push([code === rr.code ? "ok" : "KO", rr.hits, rr.err.toFixed(2), rr.margin.toFixed(2)].join(":"));
  if (r === code) ok++; else { if (r) falsePos++; console.log("raté", code, JSON.stringify(opt), "->", r); }
}
// image sans code : rien ne doit être lu
let seed = 3; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const W = 400, H = 90, data = new Uint8ClampedArray(W * H * 4); for (let i = 0; i < W * H; i++) { const v = 80 + rnd() * 150; data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v; data[i * 4 + 3] = 255; }
console.log("bruit seul ->", Scan.decode({ data, width: W, height: H }) && "FAUX");
console.log(`${ok}/${n} lus, ${falsePos} faux`);
const decodeOk = ok >= 36 && !falsePos;

/* le mode magasin et le scanner, dans l'appli (format iPhone, sans caméra : le code est tapé) */
async function storeCheck() {
  let chromium;
  try { ({ chromium } = require("playwright")); } catch (e) { console.log("Playwright n'est pas installé ici : mode magasin non vérifié."); return []; }
  const http = require("http"), ROOT = path.resolve(__dirname, "..");
  const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml" };
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split("?")[0]), f = path.join(ROOT, p === "/" ? "index.html" : p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/index.html`, problems = [], fail = (m) => problems.push(m);
  const cat = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "catalog.json"), "utf8"));
  const withEan = cat.products.filter((p) => p.e && Scan.valid(String(p.e)) && (p.o || []).some((o) => !(o[3] & 2)));
  const other = cat.products.find((p) => (p.o || []).length > 2 && !p.e);
  if (!withEan.length || !other) { server.close(); return ["mode magasin : pas de produit avec code-barres au catalogue"]; }
  const P = withEan[0];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block", locale: "fr-FR" });
  /* Open Food Facts simulé : un code inconnu du catalogue a un nom (marque que Cabas ne relève pas), les autres répondent 404 */
  const known = new Set(cat.products.map((p) => String(p.e || "").replace(/^0+/, "")));
  let NEW = "";
  for (let i = 1; i < 99 && !NEW; i++) for (let d = 0; d < 10; d++) { const c = "2000000000" + String(i).padStart(2, "0") + d; if (Scan.valid(c) && !known.has(c)) { NEW = c; break; } }
  const offReq = [];
  await ctx.route(/^https:\/\/world\.openfoodfacts\.org\//, (r) => {
    const code = (/\/product\/(\d+)\.json/.exec(r.request().url()) || [])[1] || "";
    offReq.push(code);
    const ok = code === NEW;
    r.fulfill({ status: ok ? 200 : 404, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(ok ? { status: 1, product: { product_name_fr: "Lait demi-écrémé", brands: "Laiterie d'Essai", quantity: "1 L" } } : { status: 0 }) });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => fail("erreur JS : " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/openfoodfacts\.org|404/.test(m.text() + ((m.location() || {}).url || ""))) fail("console : " + m.text()); });
  const ready = () => page.waitForFunction(() => !document.querySelector("#view .sk") && document.querySelector("#view .wrap > *"), null, { timeout: 25000 });
  try {
    await page.goto(base + "#/"); await ready();
    await page.evaluate((b) => { localStorage.clear(); localStorage.setItem("cabas.basket", JSON.stringify(b)); localStorage.setItem("cabas.seen", JSON.stringify({ welcome: 1 })); localStorage.setItem("cabas.prefs", JSON.stringify({ zip: "94120", off: { leclerc: true }, offv: 1 })); }, { [P.i]: 1, [other.i]: 2 });
    await page.goto(base + "#/panier"); await page.reload(); await ready(); await page.waitForTimeout(800);
    await page.click("[data-act=shopall]"); await page.waitForTimeout(500);
    if ((await page.evaluate(() => location.hash)) !== "#/magasin") fail("panier : « Mode magasin et impression » n'ouvre pas #/magasin");
    if ((await page.evaluate(() => cabasDebug().S.storeMode !== "all")) && (await page.locator("[data-act=storemode][data-v=all]").count())) { await page.click("[data-act=storemode][data-v=all]"); await page.waitForTimeout(300); }
    const rows = await page.locator("#view .gi.big").count();
    if (rows !== 2) fail(`mode magasin : ${rows} lignes, 2 attendues`);
    const big = await page.evaluate(() => { const b = document.querySelector("#view .gi.big .gt b"), r = document.querySelector("#view .gi.big").getBoundingClientRect(); return { fs: parseFloat(getComputedStyle(b).fontSize), h: r.height }; });
    if (big.fs < 18 || big.h < 60) fail("mode magasin : gros caractères et lignes de 60 px attendus " + JSON.stringify(big));
    if (await page.locator(".dock .mini").count()) fail("mode magasin : le mini panier ne doit pas couvrir la liste");
    await page.click("[data-act=storescan]"); await page.waitForTimeout(500);
    if ((await page.evaluate(() => location.hash)) !== "#/scan") fail("mode magasin : « Scanner un produit » n'ouvre pas le scanner");
    await page.click("[data-act=scantype]"); await page.waitForTimeout(400);
    await page.fill("#eanIn", String(P.e)); await page.click("#sheet [data-act=scantypeok]"); await page.waitForTimeout(900);
    const ck = await page.evaluate((id) => !!(JSON.parse(localStorage.getItem("cabas.guide") || "{}").ck || {})["mag|" + id], P.i);
    if (!ck) fail("scanner : le produit du panier n'est pas coché dans la liste du magasin");
    if (!/Coché dans ta liste/.test(await page.evaluate(() => document.getElementById("scres").textContent))) fail("scanner : le résultat ne dit pas « Coché dans ta liste du magasin »");
    await page.click("[data-act=back]"); await page.waitForTimeout(500);
    const on = await page.getAttribute(`#view .gi.big[data-p="${P.i}"]`, "aria-checked");
    if (on !== "true") fail("mode magasin : la ligne scannée n'est pas cochée au retour");
    const say = await page.evaluate(() => cabasDebug().speakText("magasin"));
    if (!/Il te reste 1 produit/.test(say)) fail("speakText(magasin) : « " + say.slice(0, 120) + " »");
    /* cocher à la main, en marchant : toute la ligne, puis tout est dans le panier */
    await page.click(`#view .gi.big[data-p="${other.i}"]`); await page.waitForTimeout(400);
    if (!/Tout est dans ton panier/.test(await page.evaluate(() => document.getElementById("view").textContent))) fail("mode magasin : « Tout est dans ton panier » attendu");
    /* impression : ni barres ni boutons, la liste et la date */
    await page.emulateMedia({ media: "print" });
    const pr = await page.evaluate(() => { const vis = (s) => [...document.querySelectorAll(s)].some((e) => getComputedStyle(e).display !== "none" && e.getClientRects().length); return { nav: vis("#nav"), tab: vis("#tabbar"), btn: vis("#view .btn"), only: vis("#view .print-only"), rows: document.querySelectorAll("#view .gi.big").length }; });
    if (pr.nav || pr.tab || pr.btn || !pr.only || pr.rows !== 2) fail("impression : " + JSON.stringify(pr));
    await page.emulateMedia({ media: "screen" });
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 0) fail(`mode magasin : déborde de ${over} px en largeur`);
    /* un code inconnu du catalogue : l'équivalent trouvé d'après Open Food Facts, choisi (« Ajouter »), est retenu sur le
       téléphone (cabas.eans) ; le scan suivant le retrouve tout de suite, sans redemander, et le mode magasin le coche */
    await page.evaluate(() => { localStorage.setItem("cabas.basket", "{}"); localStorage.setItem("cabas.guide", "{}"); localStorage.removeItem("cabas.eans"); });
    await page.goto(base + "#/scan"); await page.reload(); await page.waitForTimeout(800);
    const typeCode = async (c) => { await page.click("[data-act=scantype]"); await page.waitForTimeout(300); await page.fill("#eanIn", c); await page.click("#sheet [data-act=scantypeok]"); await page.waitForTimeout(1200); };
    await typeCode(NEW);
    const nearId = await page.evaluate(() => { const b = document.querySelector("#scres [data-learn] [data-act=inc]"); return b ? b.dataset.id : null; });
    if (!nearId) fail("scanner : pas d'équivalent proposé pour un code inconnu (marque que Cabas ne relève pas)");
    else {
      await page.$eval("#scres [data-learn] [data-act=inc]", (el) => el.click()); await page.waitForTimeout(400);
      const E = await page.evaluate(() => JSON.parse(localStorage.getItem("cabas.eans") || "{}"));
      if (!E[NEW] || E[NEW].id !== nearId) fail("scanner : le produit choisi pour le code n'est pas retenu (cabas.eans) " + JSON.stringify(E));
      const asked = offReq.filter((c) => c === NEW).length;
      await page.click("[data-act=scanclear]"); await typeCode(NEW);
      if (offReq.filter((c) => c === NEW).length !== asked) fail("scanner : un code appris est redemandé à Open Food Facts");
      const card = await page.evaluate(() => document.getElementById("scres").textContent);
      if (!/Ton choix pour ce code/.test(card) || !(await page.locator(`#scres [data-act=inc][data-id="${nearId}"], #scres [data-act=dec][data-id="${nearId}"]`).count())) fail("scanner : le code appris ne montre pas tout de suite le produit choisi « " + card.slice(0, 120) + " »");
      /* « Oublier ce choix », puis « Annuler » */
      await page.click("#scres [data-act=eanforget]"); await page.waitForTimeout(1200);
      if ((await page.evaluate((c) => !!JSON.parse(localStorage.getItem("cabas.eans") || "{}")[c], NEW))) fail("scanner : « Oublier ce choix » garde le code");
      await page.click("#toast button"); await page.waitForTimeout(600);
      if (!(await page.evaluate((c) => !!JSON.parse(localStorage.getItem("cabas.eans") || "{}")[c], NEW))) fail("scanner : « Annuler » ne remet pas le code appris");
      /* le mode magasin coche le produit appris quand son code est lu */
      await page.goto(base + "#/magasin"); await ready(); await page.waitForTimeout(500);
      await page.click("[data-act=storescan]"); await page.waitForTimeout(500);
      await page.click("[data-act=scanclear]").catch(() => {}); await typeCode(NEW);
      const ck2 = await page.evaluate((id) => !!(JSON.parse(localStorage.getItem("cabas.guide") || "{}").ck || {})["mag|" + id], nearId);
      if (!ck2) fail("mode magasin : le produit d'un code appris n'est pas coché");
    }
    /* le mode magasin suit la répartition : ouvert directement, il la calcule ; le panier change (un retrait annulé),
       la liste « À acheter en magasin » se recalcule sans quitter l'écran */
    const mb = await page.evaluate(async () => {
      const D = cabasDebug(), src = await fetch("app.js").then((r) => r.text()), ex = /\["semaine", "La semaine", "([^"]+)"/.exec(src);
      const plan = D.listPlan(D.readList(ex[1])), b = {};
      plan.picks.forEach((pk) => { if (pk.id) b[pk.id] = pk.n; });
      const c = D.S.list.find((p) => { const k = Object.keys(p.offers); return k.length === 1 && k[0] === "carrefour"; });
      if (c) b[c.id] = 1;
      return { b, c: c && c.id };
    });
    if (!mb.c) fail("mode magasin : pas de produit vendu seulement par Carrefour pour l'essai");
    else {
      await page.evaluate((b) => { localStorage.setItem("cabas.basket", JSON.stringify(b)); localStorage.setItem("cabas.guide", "{}"); localStorage.setItem("cabas.prefs", JSON.stringify({ zip: "94120", off: { leclerc: true }, offv: 1, maxOrders: 1 })); }, mb.b);
      await page.goto(base + "#/magasin"); await page.reload(); await ready();
      await page.waitForFunction(() => cabasDebug().RES().done, null, { timeout: 25000 }); await page.waitForTimeout(400);
      const magRow = () => page.locator(`#view .gi.big[data-p="${mb.c}"]`).count();
      const magOn = () => page.locator("#view [data-act=storemode][data-v=mag][aria-checked=true]").count();
      if (!(await magOn()) || !(await magRow())) fail("mode magasin ouvert directement : « À acheter en magasin » attendu avec le produit vendu seulement par Carrefour");
      await page.goto(base + "#/panier"); await ready(); await page.waitForTimeout(600);
      await page.$eval(`[data-act=dec][data-id="${mb.c}"]`, (el) => el.click()); await page.waitForTimeout(600);
      await page.evaluate(() => { location.hash = "#/magasin"; }); await page.waitForTimeout(900);
      if (await magRow()) fail("mode magasin : un produit retiré du panier reste dans la liste");
      /* remis depuis sa fiche, sans repasser par le panier : la liste du magasin le reprend */
      await page.evaluate((id) => { location.hash = "#/produit/" + id; }, mb.c); await ready(); await page.waitForTimeout(500);
      await page.$eval(`[data-act=inc][data-id="${mb.c}"]`, (el) => el.click()); await page.waitForTimeout(300);
      await page.evaluate(() => { location.hash = "#/magasin"; }); await page.waitForTimeout(300);
      await page.waitForFunction(() => cabasDebug().RES().done, null, { timeout: 25000 }); await page.waitForTimeout(400);
      if (!(await magOn()) || !(await magRow())) fail("mode magasin : le produit remis au panier n'est pas dans « À acheter en magasin »");
    }
  } catch (e) { fail("parcours interrompu : " + e.message.split("\n")[0]); }
  await browser.close(); server.close();
  return problems;
}
storeCheck().then((pb) => {
  if (pb.length) console.log("Mode magasin, problèmes :\n- " + pb.join("\n- "));
  else console.log("Mode magasin vérifié : liste par rayon en gros caractères, scanner qui coche, codes appris, lecture, impression, liste qui suit la répartition.");
  process.exit(decodeOk && !pb.length ? 0 : 1);
});
