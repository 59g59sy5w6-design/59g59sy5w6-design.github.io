// Audit des textes de Cabas : tutoiement, aucun tiret cadratin, aucun émoji, espace insécable avant : ; ? ! et dans les
// guillemets, « 1er » pour le premier du mois, « simulé » à côté de chaque prix E.Leclerc (et dans chaque cellule de sa colonne d'un tableau), « saisi
// par toi » (ou « d'après ce que tu as collé ») à côté de chaque montant qui n'est pas un prix relevé. Deux passes : les
// fichiers (sources servies, données, documentation), puis le texte affiché (nœuds de texte, aria-label, placeholder) de chaque écran et de chaque feuille de tools/a11y.cjs,
// à 390 px, états plein (E.Leclerc activé, un total payé, une ligne libre à prix saisi) et vide ; en plus, « Et si »
// ouvert sur le gros panier et « Pas trouvé » dans une commande E.Leclerc.
// Usage : node tools/textcheck.cjs [--routes=accueil,panier] [--all]. Code de sortie 1 au premier écart.
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const A = require("./a11y.cjs");

const ROOT = path.resolve(__dirname, "..");
const ARGS = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] == null ? true : m[2]] : [a, true]; }));
const ROUTE_FILTER = ARGS.routes ? new Set(String(ARGS.routes).split(",")) : null;
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
const findings = [];
const add = (where, cat, msg) => findings.push({ where, cat, msg });

/* ---------- passe 1 : les fichiers ---------- */
const FILES = ["index.html", "app.js", "app.css", "boot.js", "sw.js", "packs.js", "scan.js", "optimizer.js", "worker.js", "manifest.webmanifest",
  "data/retailers.json", "data/listes.json", "data/recettes.json", "data/meta.json", "README.md", "CLAUDE.md"]
  .concat(fs.readdirSync(path.join(ROOT, "tools", "lots")).map((f) => "tools/lots/" + f));
for (const f of FILES) {
  const lines = fs.readFileSync(path.join(ROOT, f), "utf8").split("\n");
  lines.forEach((l, i) => {
    if (l.includes("—")) add(`${f}:${i + 1}`, "tiret cadratin", l.trim().slice(0, 100));
    if (EMOJI.test(l)) add(`${f}:${i + 1}`, "émoji", l.trim().slice(0, 100));
  });
}
/* le tutoiement dans les textes de l'appli et des données : hors citation d'un bouton d'enseigne (« Choisir vos courses »)
   et hors expressions régulières qui reconnaissent ce qu'écrit la personne */
for (const f of ["app.js", "index.html", "manifest.webmanifest", "data/retailers.json", "data/listes.json", "data/recettes.json", "data/meta.json"]) {
  fs.readFileSync(path.join(ROOT, f), "utf8").split("\n").forEach((l, i) => {
    if (/\/\^|\(\?:|\\b/.test(l)) return;
    const t = l.replace(/«[^»]*»/g, "");
    if (/\b(vous|votre|vos)\b/i.test(t)) add(`${f}:${i + 1}`, "tutoiement", l.trim().slice(0, 100));
  });
}

/* les textes du manifeste (invitation d'installation, raccourcis) et de l'aperçu de partage (balises meta, titre) */
const PUNCT = / [:;?!]|« | »/;
(function walk(x, where) {
  if (typeof x === "string") { if (PUNCT.test(x)) add(where, "insécable", x.slice(0, 100)); }
  else if (x && typeof x === "object") for (const k of Object.keys(x)) walk(x[k], where + "." + k);
})(JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.webmanifest"), "utf8")), "manifest.webmanifest");
for (const m of fs.readFileSync(path.join(ROOT, "index.html"), "utf8").matchAll(/<meta [^>]*content="([^"]*)"|<title>([^<]*)<\/title>/g)) {
  const t = m[1] || m[2] || "";
  if (PUNCT.test(t)) add("index.html", "insécable", t.slice(0, 100));
}
/* les chaînes et gabarits des scripts (toasts, textes partagés, écrans peu visités) : espace insécable avant la ponctuation
   double et dans les guillemets ; lus par l'analyseur de TypeScript, qui distingue un texte d'un « a ? b : c » */
let ts = null;
try { ts = require("typescript"); } catch (e) { console.log("typescript introuvable : les chaînes des scripts ne sont lues qu'à l'écran."); }
if (ts) for (const f of ["app.js", "boot.js", "sw.js", "scan.js", "optimizer.js", "worker.js"]) {
  const src = fs.readFileSync(path.join(ROOT, f), "utf8"), sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), K = ts.SyntaxKind;
  const LIT = new Set([K.StringLiteral, K.NoSubstitutionTemplateLiteral, K.TemplateHead, K.TemplateMiddle, K.TemplateTail]);
  (function walk(n) {
    if (LIT.has(n.kind) && / [:;?!](?![=\w.])|« | »/.test(n.text)) add(`${f}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`, "insécable", JSON.stringify(n.text).slice(0, 100));
    ts.forEachChild(n, walk);
  })(sf);
}

/* ---------- passe 2 : le texte affiché ---------- */
const PAID = "187,43", FREE = "12,37";
const AUDIT_JS = `((amounts) => {
  const out = [];
  const sheetOpen = !document.getElementById("sheet").hidden;
  const roots = (sheetOpen ? ["#sheet .sheet", "#toast"] : ["#view", "#nav", "#dock", "#toast", "#tabbar"]).map((s) => document.querySelector(s)).filter(Boolean);
  const EMO = /[\\u{1F000}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{2B00}-\\u{2BFF}\\u{FE0F}]/u;
  const shown = (el) => { for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === "none" || cs.visibility === "hidden") return false; } return true; };
  const short = (t) => t.replace(/\\s+/g, " ").trim().slice(0, 90);
  const check = (t, el, how) => {
    if (/\\u2014/.test(t)) out.push({ cat: "tiret cadratin", msg: how + " « " + short(t) + " »" });
    if (EMO.test(t)) out.push({ cat: "émoji", msg: how + " « " + short(t) + " »" });
    if (/ [:;?!]/.test(t)) out.push({ cat: "insécable", msg: how + " espace ordinaire avant la ponctuation : « " + short(t) + " »" });
    if (/« | »/.test(t)) out.push({ cat: "insécable", msg: how + " espace ordinaire dans les guillemets : « " + short(t) + " »" });
    if (/\\b(vous|votre|vos)\\b/i.test(t.replace(/«[^»]*»/g, ""))) out.push({ cat: "tutoiement", msg: how + " « " + short(t) + " »" });
    /* le premier du mois s'écrit « 1er novembre », jamais « 1 novembre » */
    if (/(^|[^\\d,.])1[\\s\\u00a0](janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre|janv|févr|avr|juil|sept|oct|nov|déc)\\b/i.test(t)) out.push({ cat: "date", msg: how + " « 1 » au lieu de « 1er » : « " + short(t) + " »" });
  };
  const BOX = ".row, .orow, .offer, li, tr, .order, .hcard, .deal, .sum, .card, .opt, .gi, .banner, .of, .item, p, .cmpc, .ans";
  const near = (el) => el.closest(BOX) || el.parentElement;
  for (const root of roots) {
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = tw.nextNode())) {
      const t = n.nodeValue, el = n.parentElement;
      if (!t.trim() || !el || el.closest("script, style, svg") || !shown(el)) continue;
      check(t, el, "texte");
      /* E.Leclerc : un prix à côté de son nom dit qu'il est simulé */
      /* sauf les mentions d'E.Leclerc sans montant à lui (« Sans E.Leclerc » de « Et si », commande vidée par « Pas trouvé ») */
      if (/Leclerc/.test(t.replace(/^\\s*Sans E\\.Leclerc\\s*$/, "").replace(/Ta commande E\\.Leclerc n'aurait plus aucun produit\\./g, ""))) { const box = near(el), bt = box.textContent + " " + (box.getAttribute("aria-label") || ""); if (/\\d+,\\d{2}\\s?€/.test(bt) && !/simul/i.test(bt)) out.push({ cat: "simulé", msg: "prix E.Leclerc sans « simulé » : « " + short(bt) + " »" }); }
      /* un montant saisi par la personne (total payé, prix d'une ligne libre) le dit */
      for (const a of amounts) if (t.includes(a)) { const box = near(el), bt = box.textContent; if (!/saisi par toi|d'après ce que tu as collé/i.test(bt)) out.push({ cat: "saisi par toi", msg: a + " € sans « saisi par toi » : « " + short(bt) + " »" }); }
    }
    /* un tableau : la cellule d'un prix de la colonne d'E.Leclerc dit elle-même qu'il est simulé (elle se lit seule) */
    for (const td of root.querySelectorAll("td")) {
      const tb = td.closest("table"), hr = tb && tb.querySelector("thead tr");
      if (!hr || !shown(td)) continue;
      const th = hr.children[[...td.parentElement.children].indexOf(td)];
      if (th && /Leclerc/.test(th.textContent) && /\\d+,\\d{2}\\s?€/.test(td.textContent) && !/simul/i.test(td.textContent)) out.push({ cat: "simulé", msg: "prix E.Leclerc sans « simulé » dans une cellule : « " + short(td.textContent) + " »" });
    }
    for (const el of root.querySelectorAll("[aria-label], [placeholder], [title]")) {
      if (!shown(el)) continue;
      for (const k of ["aria-label", "placeholder", "title"]) { const v = el.getAttribute(k); if (v) check(v, el, k); }
    }
  }
  return out;
})`;

const iso = (d) => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); };
function stateOf(st) {
  const s = JSON.parse(JSON.stringify(A.STATES[st]));
  if (st !== "plein") return s;
  /* E.Leclerc activé (prix simulés partout), un total payé et une ligne libre à prix saisi */
  s.prefs = Object.assign({}, s.prefs, { off: {} });
  s.hist = s.hist.map((h, i) => (i === s.hist.length - 1 ? Object.assign({}, h, { paid: { all: Math.round(parseFloat(PAID.replace(",", ".")) * 100) } }) : h));
  s.free = { f1: { t: "Galettes de sarrasin du marché", q: 1, price: parseFloat(FREE.replace(",", ".")), ret: "", at: iso(new Date()) } };
  /* une commande E.Leclerc dans le remplissage en cours, pour « Pas trouvé » (équivalents et frais à prix simulés) */
  s.guide.snap.orders.push({ rid: "leclerc-livraison", P: { min: 0, fixed: 0, tiers: [{ from: 0, fee: 690 }, { from: 10000, fee: 0 }] }, items: [{ id: "contrex-eau-minerale-naturelle-6-x-1-l", q: 2, cost: 506, nm: "Contrex Eau minérale naturelle", f: "6 x 1 L" }] });
  s.seen.first = Object.assign({}, s.seen.first, { leclerc: 1, "leclerc-livraison": 1 });
  return s;
}

async function main() {
  await new Promise((r) => A.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${A.server.address().port}/index.html`;
  const browser = await chromium.launch();
  let screens = 0;
  for (const st of ["plein", "vide"]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: "fr-FR", timezoneId: "Europe/Paris", serviceWorkers: "block" });
    await ctx.route(/^https:\/\/world\.openfoodfacts\.org\//, (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(A.OFF.connu) }));
    await ctx.addInitScript((s) => { try { localStorage.clear(); for (const k of Object.keys(s)) localStorage.setItem("cabas." + k, JSON.stringify(s[k])); const g = sessionStorage.getItem("a11yGros"); if (g) localStorage.setItem("cabas.basket", g); } catch (e) { /* stockage indisponible */ } }, stateOf(st));
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
    let first = true;
    const audit = async (where) => { screens++; for (const f of await page.evaluate(`${AUDIT_JS}(${JSON.stringify(st === "plein" ? [PAID, FREE] : [])})`)) add(where, f.cat, f.msg); };
    for (const [rname, hash] of A.ROUTES.concat(st === "plein" ? [["remplir-leclerc", "#/remplir/leclerc-livraison"]] : [])) {
      if (ROUTE_FILTER && !ROUTE_FILTER.has(rname)) continue;
      if (st === "vide" && !A.EMPTY_TOO.includes(rname)) continue;
      const where = `${st} ${rname}`;
      try {
        if (first) { await page.goto(base + hash, { waitUntil: "domcontentloaded" }); first = false; }
        else await page.evaluate((h) => { location.hash = h; window.scrollTo(0, 0); }, hash);
        await A.ready(page, rname);
        await A.prepare(page, rname, st);
        await audit(where);
        const gros = rname === "panier" && st === "plein";
        if (gros) {
          await page.evaluate(A.GROS_JS); await page.reload({ waitUntil: "domcontentloaded" }); await A.ready(page, rname); await audit(`${st} gros panier`);
          for (const [sname, go, back] of A.GROS_STEPS) { await go(page); await audit(`${st} ${sname}`); await back(page); }
        }
        if (st !== "plein") continue;
        for (const [sname, sel] of A.SHEETS[gros ? "panier-gros" : rname === "remplir-leclerc" ? "remplir-guide" : rname] || []) {
          const btn = await page.$(sel);
          if (!btn) continue;
          await page.evaluate((s) => { const b = document.querySelector(s); b.scrollIntoView({ block: "center" }); b.click(); }, sel);
          const opened = await page.waitForFunction(() => !document.getElementById("sheet").hidden, null, { timeout: 4000 }).then(() => true).catch(() => false);
          if (!opened) continue;
          await A.sleep(450);
          await audit(`${where} feuille ${sname}`);
          await page.keyboard.press("Escape"); await A.sleep(250);
          await page.evaluate(() => { const w = document.getElementById("sheet"); if (!w.hidden) w.hidden = true; document.body.classList.remove("has-sheet"); ["view", "nav", "dock", "tabbar"].forEach((id) => { const el = document.getElementById(id); if (el) el.removeAttribute("inert"); }); });
        }
      } catch (e) { add(where, "erreur", String(e).split("\n")[0].slice(0, 160)); }
    }
    errs.forEach((m) => add(st, "console", m));
    await ctx.close();
  }
  await browser.close();
  A.server.close();
  const byCat = {};
  for (const f of findings) (byCat[f.cat] = byCat[f.cat] || []).push(f);
  console.log(`${FILES.length} fichiers et ${screens} écrans lus, ${findings.length} écart${findings.length > 1 ? "s" : ""}.`);
  for (const c of Object.keys(byCat)) {
    console.log(`\n${c} : ${byCat[c].length}`);
    for (const f of ARGS.all ? byCat[c] : byCat[c].slice(0, 10)) console.log(`  ${f.where} : ${f.msg}`);
    if (!ARGS.all && byCat[c].length > 10) console.log(`  … et ${byCat[c].length - 10} de plus (--all pour tout voir)`);
  }
  if (findings.length) process.exit(1);
  console.log("Aucun écart.");
}
main().catch((e) => { console.error(e); process.exit(1); });
