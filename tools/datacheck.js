// Vérification de « Tes données » (F23), au format iPhone : packState (toutes les clés cabas.*), enregistrement d'une
// copie en fichier (téléchargement), importCheck sur des copies abîmées ou hostiles (autre appli, autre version, types
// faux, quantités hors bornes, clés inconnues, __proto__, texte piégé affiché sans être interprété), restauration
// depuis un fichier avec confirmation puis « Annuler », transfert par lien #/transfert/<x> vers un second téléphone
// (deux contextes de navigateur, rien sur le réseau que le site), lien abîmé, « Ne rien changer », et l'effacement de
// toutes les données (nouvelles clés comprises).
// Code de sortie 1 en cas de problème. Usage : node tools/datacheck.js [--shots=dossier]
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml" };
const SHOTS = (process.argv.find((a) => a.startsWith("--shots=")) || "").slice(8);

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
  const origin = `http://127.0.0.1:${server.address().port}`, base = origin + "/index.html";
  const problems = [];
  const fail = (m) => problems.push(m);
  const browser = await chromium.launch();
  const opts = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block", locale: "fr-FR", timezoneId: "Europe/Paris", acceptDownloads: true };
  const ctxA = await browser.newContext(opts), ctxB = await browser.newContext(opts);
  const outside = [];
  for (const c of [ctxA, ctxB]) await c.route((url) => !String(url).startsWith(origin), (r) => { outside.push(String(r.request().url())); r.abort(); });
  const A = await ctxA.newPage(), B = await ctxB.newPage();
  for (const [n, p] of [["A", A], ["B", B]]) { p.on("pageerror", (e) => fail(`erreur JS (${n}) : ` + e.message)); p.on("console", (m) => { if (m.type() === "error" && !/net::ERR_FAILED/.test(m.text())) fail(`console (${n}) : ` + m.text()); }); }
  const ready = (p) => p.waitForFunction(() => !document.querySelector("#view .sk") && document.querySelector("#view .wrap > *"), null, { timeout: 25000 });
  const all = (p) => p.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith("cabas.")) o[k.slice(6)] = JSON.parse(localStorage.getItem(k)); } return o; });
  const toastText = (p) => p.evaluate(() => { const t = document.getElementById("toast"); return t.hidden ? "" : t.textContent; });
  const shot = async (p, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: true }); } };
  const over = async (p, where) => { const o = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); if (o > 0) fail(`${where} : déborde de ${o} px en largeur`); };
  const load = async (p, state, h) => {
    await p.goto(base + "#/"); await ready(p);
    await p.evaluate((s) => { localStorage.clear(); for (const k of Object.keys(s)) localStorage.setItem("cabas." + k, JSON.stringify(s[k])); }, state);
    await p.goto(base + (h || "#/")); await p.reload(); await ready(p); await p.waitForTimeout(500);
  };
  const STATE = {
    basket: { "candia-lait-1-2-ecreme-6-x-1-l": 2, "barilla-pates-capellini-n-1-500-g": 3 },
    lists: [{ id: "l1", name: "Courses du samedi", items: { "candia-lait-1-2-ecreme-6-x-1-l": 1 }, at: plus(-3), template: true, cad: { "candia-lait-1-2-ecreme-6-x-1-l": 14 } }],
    prefs: { zip: "94120", off: { leclerc: true }, offv: 1, foyer: 3, shopDay: 6, voice: "slow", wake: false },
    hist: [{ d: plus(-7), t: 6120, s: 300, n: 5, items: { "candia-lait-1-2-ecreme-6-x-1-l": 1 }, o: [{ rid: "houra", name: "Houra", pick: false, t: 6120, items: { "candia-lait-1-2-ecreme-6-x-1-l": 1 } }], when: [], paid: { houra: 6000 } }],
    free: { f1: { t: "bougies d'anniversaire", q: 1, at: plus(-1) } }, seen: { welcome: 1 }, recent: ["lait"], ups: [], prepSnooze: plus(-1),
    eans: { "2000000000015": { id: "candia-lait-1-2-ecreme-6-x-1-l", at: plus(-2) } },
  };

  try {
    /* 1. packState : toutes les clés de l'appareil */
    await load(A, STATE);
    const P = await A.evaluate(() => cabasDebug().packState());
    if (P.app !== "cabas" || P.v !== 1) fail("packState : en-tête " + JSON.stringify({ app: P.app, v: P.v }));
    for (const k of ["basket", "lists", "prefs", "hist", "free", "seen", "recent", "eans"]) if (!(k in P.data)) fail("packState : clé " + k + " absente");
    /* codes-barres appris : un code en chiffres et un produit du catalogue, rien d'autre */
    const EC = await A.evaluate(() => cabasDebug().importCheck({ app: "cabas", v: 1, data: { eans: { "2000000000015": { id: "candia-lait-1-2-ecreme-6-x-1-l", at: "2026-10-01" }, "abc": { id: "candia-lait-1-2-ecreme-6-x-1-l" }, "2000000000022": { id: "zz-inconnu" }, "2000000000039": "x" } } }).data.eans);
    if (JSON.stringify(EC) !== '{"2000000000015":{"id":"candia-lait-1-2-ecreme-6-x-1-l","at":"2026-10-01"}}') fail("importCheck : codes-barres appris mal filtrés " + JSON.stringify(EC));
    if (P.data.prefs.shopDay !== 6 || P.data.lists[0].template !== true) fail("packState : prefs.shopDay ou lists[].template perdus");
    /* 2. une copie en fichier, depuis les réglages */
    await A.evaluate(() => { location.hash = "#/reglages"; }); await A.waitForTimeout(500);
    const [dl] = await Promise.all([A.waitForEvent("download", { timeout: 8000 }), A.click("[data-act=export]")]);
    if (!/^cabas-\d{4}-\d{2}-\d{2}\.json$/.test(dl.suggestedFilename())) fail("copie : nom de fichier « " + dl.suggestedFilename() + " »");
    const file = path.join(os.tmpdir(), "cabas-datacheck-" + process.pid + ".json");
    await dl.saveAs(file);
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    if (saved.app !== "cabas" || JSON.stringify(saved.data.basket) !== JSON.stringify(STATE.basket)) fail("copie : le fichier ne contient pas le panier");
    if (!/Copie enregistrée/.test(await toastText(A))) fail("copie : toast « " + (await toastText(A)) + " »");
    await over(A, "réglages, tes données"); await shot(A, "1-reglages");
    /* 3. importCheck : copies abîmées ou hostiles */
    const IC = await A.evaluate(() => {
      const D = cabasDebug(), c = (o) => D.importCheck(o);
      const bad = [c(null), c({ app: "autre", v: 1, data: {} }), c({ app: "cabas", v: 2, data: { basket: {} } }), c({ app: "cabas", v: 1, data: { inconnu: 1 } })].map((r) => r.ok);
      /* « a » : un produit du catalogue ; « zz-inconnu » n'en est pas un, il ne revient ni au panier ni dans les listes */
      const r = c(JSON.parse(('{"app":"cabas","v":1,"data":{"basket":{"a":2,"b":500,"c":"3","zz-inconnu":1,"__proto__":4},"lists":[{"id":"x","name":"<img src=x id=piege>","items":{"a":1}},{"id":"y","name":"' + "n".repeat(200) + '","items":{}}],"prefs":{"zip":"abcde","foyer":4,"theme":"fluo","shopDay":9,"voice":"slow","off":{"leclerc":true}},"hist":[{"d":"2026-10-01","t":-5,"items":{}},{"d":"2026-10-02","t":5000,"s":10,"n":3,"items":{"a":1},"paid":{"houra":-1,"monoprix":4000}}],"menu":[{"id":"r","portions":500}],"truc":[1,2]}}').replace(/"a"/g, JSON.stringify("tropicana-jus-d-orange-pressee-sans-pulpe-pur-jus-1-l"))));
      /* un lien d'envoi n'apporte que les clés de l'envoi : pas l'instantané de « Remplir mes paniers » */
      const link = D.importCheck({ app: "cabas", v: 1, data: { basket: {}, guide: { ck: {}, done: {}, snap: { orders: [] } } } }, true);
      return { bad, ok: r.ok, basket: r.data.basket, linkGuide: "guide" in link.data, linkSkip: link.skip, lists: r.data.lists.map((l) => l.name), prefs: r.data.prefs, hist: r.data.hist, menu: r.data.menu, skip: r.skip, proto: Object.getPrototypeOf(r.data.basket) === Object.prototype };
    });
    if (IC.bad.some(Boolean)) fail("importCheck : une copie invalide est acceptée " + JSON.stringify(IC.bad));
    if (!IC.ok || JSON.stringify(IC.basket) !== '{"tropicana-jus-d-orange-pressee-sans-pulpe-pur-jus-1-l":2}') fail("importCheck : panier mal filtré " + JSON.stringify(IC.basket));
    if (IC.linkGuide || !IC.linkSkip.includes("guide")) fail("importCheck : un lien d'envoi ne doit pas apporter cabas.guide");
    if (IC.lists.length !== 1) fail("importCheck : une liste au nom de 200 caractères doit être écartée " + JSON.stringify(IC.lists));
    if ("zip" in IC.prefs || "theme" in IC.prefs || "shopDay" in IC.prefs || IC.prefs.foyer !== 4 || IC.prefs.voice !== "slow") fail("importCheck : réglages mal filtrés " + JSON.stringify(IC.prefs));
    if (IC.hist.length !== 1 || JSON.stringify(IC.hist[0].paid) !== '{"monoprix":4000}') fail("importCheck : historique mal filtré " + JSON.stringify(IC.hist));
    if (IC.menu.length) fail("importCheck : un repas de 500 portions doit être écarté");
    if (!IC.skip.includes("truc") || !IC.proto) fail("importCheck : clé inconnue ou __proto__ mal traitée");
    /* 4. restauration depuis un fichier : confirmation, remplacement, « Annuler » ; un texte piégé reste du texte */
    const hostile = { app: "cabas", v: 1, at: new Date().toISOString(), data: { basket: { "tropicana-jus-d-orange-pressee-sans-pulpe-pur-jus-1-l": 4 }, lists: [{ id: "h1", name: "<img src=x id=piege>", items: { "candia-lait-1-2-ecreme-6-x-1-l": 1 } }], seen: { welcome: 1 } } };
    const hf = path.join(os.tmpdir(), "cabas-datacheck-h-" + process.pid + ".json");
    fs.writeFileSync(hf, JSON.stringify(hostile));
    const before = await all(A);
    await A.setInputFiles("#impIn", hf); await A.waitForTimeout(600);
    const sh = await A.evaluate(() => document.querySelector("#sheet .sheet") ? document.querySelector("#sheet .sheet").textContent.replace(/\s+/g, " ") : "");
    if (!/Remplacer tes données/.test(sh) || !/1\s+produit au panier/.test(sh) || !/1\s+liste/.test(sh)) fail("restauration : confirmation « " + sh.slice(0, 200) + " »");
    await shot(A, "2-confirmation");
    await A.click("#sheet [data-act=impok]"); await A.waitForTimeout(700);
    const afterImp = await all(A);
    if (JSON.stringify(afterImp.basket) !== JSON.stringify(hostile.data.basket) || "hist" in afterImp || "free" in afterImp) fail("restauration : les données ne sont pas remplacées " + JSON.stringify(Object.keys(afterImp)));
    if (!/Copie restaurée/.test(await toastText(A))) fail("restauration : toast « " + (await toastText(A)) + " »");
    await A.evaluate(() => { location.hash = "#/listes"; }); await A.waitForTimeout(500);
    if (await A.locator("#piege").count()) fail("restauration : le nom de liste piégé a été interprété comme du HTML");
    if (!(await A.evaluate(() => document.getElementById("view").textContent.includes("<img src=x id=piege>")))) fail("restauration : le nom de liste doit s'afficher tel quel");
    await A.evaluate(() => { location.hash = "#/reglages"; }); await A.waitForTimeout(500);
    /* « Annuler » juste après une restauration : on refait la restauration et on annule */
    await A.setInputFiles("#impIn", hf); await A.waitForTimeout(500);
    await A.click("#sheet [data-act=impok]"); await A.waitForTimeout(500);
    await A.click("#toast button"); await A.waitForTimeout(500);
    const undone = await all(A);
    if (JSON.stringify(undone.basket) !== JSON.stringify(afterImp.basket)) fail("restauration : « Annuler » ne remet pas les données d'avant");
    /* un fichier qui n'est pas une copie */
    const nf = path.join(os.tmpdir(), "cabas-datacheck-n-" + process.pid + ".json");
    fs.writeFileSync(nf, "{ pas du json");
    await A.evaluate(() => { location.hash = "#/reglages"; }); await A.waitForTimeout(500);
    await A.setInputFiles("#impIn", nf); await A.waitForTimeout(500);
    if (!/Copie illisible/.test(await A.evaluate(() => (document.getElementById("sheetT") || {}).textContent || ""))) fail("fichier illisible : la feuille ne le dit pas");
    await A.click("#sheet [data-act=close]"); await A.waitForTimeout(300);
    if (JSON.stringify((await all(A)).basket) !== JSON.stringify(afterImp.basket)) fail("fichier illisible : les données ont changé");
    /* 5. transfert par lien vers un second téléphone */
    await load(A, STATE);
    const x = await A.evaluate(() => cabasDebug().packLink());
    const back = await A.evaluate((x) => cabasDebug().unpackState(x), x);
    if (!back || JSON.stringify(back.data.basket) !== JSON.stringify(STATE.basket) || "guide" in back.data || "draft" in back.data) fail("lien : unpackState ne rend pas l'essentiel " + JSON.stringify(back && Object.keys(back.data)));
    await load(B, { basket: { "barilla-pates-capellini-n-1-500-g": 1 }, seen: { welcome: 1 } });
    await B.goto(base + "#/transfert/" + x); await ready(B); await B.waitForTimeout(800);
    const tv = await B.evaluate(() => document.getElementById("view").textContent.replace(/\s+/g, " "));
    if (!/2\s+produits au panier/.test(tv) || !/1\s+liste/.test(tv) || !/1\s+panier commandé/.test(tv) || !/tes réglages/.test(tv)) fail("transfert : résumé « " + tv.slice(0, 220) + " »");
    await over(B, "transfert"); await shot(B, "3-transfert");
    await B.click("[data-act=xferok]"); await B.waitForTimeout(700);
    const gotB = await all(B);
    if (JSON.stringify(gotB.basket) !== JSON.stringify(STATE.basket) || (gotB.prefs || {}).shopDay !== 6 || ((gotB.lists || [])[0] || {}).template !== true) fail("transfert : données du second téléphone " + JSON.stringify(gotB).slice(0, 200));
    if (/transfert/.test(await B.evaluate(() => location.href))) fail("transfert : le lien reste dans la barre d'adresse");
    if (!/Données de l'autre téléphone reprises/.test(await toastText(B))) fail("transfert : toast « " + (await toastText(B)) + " »");
    /* lien abîmé, puis « Ne rien changer » */
    await B.goto(base + "#/transfert/z" + x.slice(9)); await ready(B); await B.waitForTimeout(800);
    if (!/Ce lien est illisible/.test(await B.evaluate(() => document.getElementById("view").textContent))) fail("lien abîmé : pas de message");
    await B.goto(base + "#/transfert/" + x); await ready(B); await B.waitForTimeout(800);
    const keep = await all(B);
    await B.click("[data-act=xferno]"); await B.waitForTimeout(500);
    if (JSON.stringify(await all(B)) !== JSON.stringify(keep)) fail("« Ne rien changer » : les données ont changé");
    /* 6. effacer mes données : les nouvelles clés aussi */
    await B.evaluate(() => { location.hash = "#/reglages"; }); await B.waitForTimeout(500);
    await B.evaluate(() => { localStorage.setItem("cabas.ups", JSON.stringify([{ id: "x", old: 1, now: 2, until: "2099-01-01" }])); localStorage.setItem("cabas.prepSnooze", JSON.stringify("2099-01-01")); localStorage.setItem("cabas.eans", JSON.stringify({ "2000000000015": { id: "candia-lait-1-2-ecreme-6-x-1-l", at: "2026-10-01" } })); });
    await B.click("[data-act=reset]"); await B.waitForTimeout(400);
    await B.click("#sheet [data-act=resetok]"); await B.waitForTimeout(500);
    const z = await all(B);
    if (z.eans) fail("effacer mes données : les codes-barres appris restent");
    if ((z.ups || []).length || z.prepSnooze || (z.prefs || {}).shopDay != null || (z.prefs || {}).voice !== "normal" || (z.prefs || {}).wake !== true || (z.lists || []).length) fail("effacer mes données : il reste " + JSON.stringify({ ups: z.ups, prepSnooze: z.prepSnooze, prefs: z.prefs && { shopDay: z.prefs.shopDay, voice: z.prefs.voice, wake: z.prefs.wake } }));
    if (outside.length) fail("des requêtes sont parties hors du site : " + outside.slice(0, 3).join(", "));
    [file, hf, nf].forEach((f) => { try { fs.unlinkSync(f); } catch (e) { /* déjà effacé */ } });
  } catch (e) {
    fail("parcours interrompu : " + e.message.split("\n")[0]);
  }
  await browser.close();
  server.close();
  if (problems.length) { console.log("Problèmes :\n- " + problems.join("\n- ")); process.exit(1); }
  console.log("Tes données vérifiées : copie en fichier, importCheck, restauration et « Annuler », transfert par lien entre deux téléphones, lien abîmé, effacement.");
})();
