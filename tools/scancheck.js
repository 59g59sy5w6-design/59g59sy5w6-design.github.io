// Vérification du lecteur de codes-barres (scan.js) sur des images de synthèse : codes EAN-13 et EAN-8 à plusieurs
// tailles, avec bruit, flou, éclairage inégal et inclinaison ; une image de bruit seul ne doit rien donner. Puis, quand
// Playwright est là, le mode magasin (#/magasin) et le scanner : « Scanner un produit » depuis la liste, le code tapé
// d'un produit du panier le coche dans la liste du magasin, ce qu'il reste à lire à voix haute (speakText), et la
// feuille d'impression (sans barres ni boutons, la liste et la date).
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
  const page = await ctx.newPage();
  page.on("pageerror", (e) => fail("erreur JS : " + e.message));
  page.on("console", (m) => { if (m.type() === "error") fail("console : " + m.text()); });
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
  } catch (e) { fail("parcours interrompu : " + e.message.split("\n")[0]); }
  await browser.close(); server.close();
  return problems;
}
storeCheck().then((pb) => {
  if (pb.length) console.log("Mode magasin, problèmes :\n- " + pb.join("\n- "));
  else console.log("Mode magasin vérifié : liste par rayon en gros caractères, scanner qui coche, lecture, impression.");
  process.exit(decodeOk && !pb.length ? 0 : 1);
});
