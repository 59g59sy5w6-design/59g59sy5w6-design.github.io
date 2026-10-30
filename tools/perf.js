/* Mesure du démarrage de l'appli, comme sur un téléphone moyen (réseau 3G rapide, processeur quatre fois plus lent) :
   premier passage sans rien en cache, réouverture avec le service worker installé, hors ligne, puis quelques vues.
   Sert le dépôt en gzip comme GitHub Pages. Usage : node tools/perf.js (Playwright et Chromium installés). */
const http = require("http"), fs = require("fs"), path = require("path"), zlib = require("zlib");
const { chromium } = require("playwright");
const ROOT = path.join(__dirname, "..");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webmanifest": "application/manifest+json" };

function serve() {
  return new Promise((ok) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split("?")[0]);
      if (p.endsWith("/")) p += "index.html";
      const f = path.join(ROOT, p);
      fs.readFile(f, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        const type = TYPES[path.extname(f)] || "application/octet-stream";
        const etag = '"' + fs.statSync(f).mtimeMs + "-" + data.length + '"';
        if (req.headers["if-none-match"] === etag) { res.writeHead(304, { ETag: etag }); res.end(); return; }
        const gz = /gzip/.test(req.headers["accept-encoding"] || "") && /json|javascript|css|html|manifest/.test(type);
        const body = gz ? zlib.gzipSync(data, { level: 6 }) : data;
        res.writeHead(200, { "Content-Type": type, ETag: etag, "Cache-Control": "max-age=600", ...(gz ? { "Content-Encoding": "gzip" } : {}), "Content-Length": body.length });
        res.end(body);
      });
    });
    srv.listen(0, "127.0.0.1", () => ok({ srv, url: `http://127.0.0.1:${srv.address().port}/` }));
  });
}

const RENDERED = () => { const v = document.querySelector("#view"); return !!v && /class="(wlcta|sh|savings|cats|cat)/.test(v.innerHTML); };

async function measure(page, url, label, throttle) {
  const client = await page.context().newCDPSession(page);
  await client.send("Network.enable");
  if (throttle) {
    await client.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  }
  const t0 = Date.now();
  await page.goto(url, { waitUntil: "commit" });
  await page.waitForFunction(RENDERED, null, { timeout: 60000 });
  const first = Date.now() - t0;
  const res = await page.evaluate(() => performance.getEntriesByType("resource").map((r) => ({ n: r.name.split("/").slice(-2).join("/").replace(/^[^/]*:\d+\//, ""), ms: Math.round(r.responseEnd - r.startTime), kb: Math.round((r.transferSize || 0) / 1024) })));
  console.log(`\n${label} : premier affichage en ${first} ms`);
  for (const r of res.filter((r) => r.kb > 20 || r.ms > 300)) console.log(`   ${r.n.padEnd(24)} ${String(r.ms).padStart(5)} ms  ${String(r.kb).padStart(4)} ko transférés`);
  if (throttle) { await client.send("Emulation.setCPUThrottlingRate", { rate: 1 }); await client.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); }
  await client.detach();
}

(async () => {
  const { srv, url } = await serve();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "fr-FR" });
  const page = await ctx.newPage();
  await measure(page, url, "Premier passage (rien en cache, 3G rapide, processeur x4)", true);
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 30000 }).catch(() => console.log("   (service worker non actif)"));
  await page.waitForTimeout(2500);
  await measure(page, url, "Réouverture (service worker installé, 3G rapide, processeur x4)", true);
  await measure(page, url, "Réouverture, réseau et processeur normaux", false);
  await ctx.setOffline(true);
  const t = Date.now();
  await page.goto(url, { waitUntil: "commit" }).catch(() => {});
  const ok = await page.waitForFunction(RENDERED, null, { timeout: 20000 }).then(() => true).catch(() => false);
  console.log(`\nHors ligne : ${ok ? "accueil affiché en " + (Date.now() - t) + " ms" : "pas d'accueil"}`);
  await ctx.setOffline(false);
  const client = await ctx.newCDPSession(page);
  await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  console.log("\nVues, processeur x4 :");
  for (const h of ["#/rayons", "#/rayon/eaux", "#/recherche", "#/repas", "#/panier", "#/listes", "#/reglages"]) {
    const ms = await page.evaluate(async (h) => { const t0 = performance.now(); location.hash = h; await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return Math.round(performance.now() - t0); }, h);
    console.log(`   ${h.padEnd(14)} ${String(ms).padStart(5)} ms`);
  }
  await page.evaluate(() => { location.hash = "#/recherche"; });
  const q = await page.waitForSelector("input[type=search]", { timeout: 5000 });
  const t1 = Date.now();
  await q.type("lait demi", { delay: 0 });
  await page.waitForTimeout(300);
  console.log(`   recherche « lait demi », 9 frappes : ${Date.now() - t1 - 300} ms`);
  await browser.close();
  srv.close();
})();
