// Vérification de la répartition du panier (optimizer.js) : sur des paniers tirés au hasard, compare le total
// trouvé par runAll, pour chaque nombre de commandes, au minimum obtenu en essayant toutes les répartitions.
// Avec et sans achat en magasin, avec et sans coût par commande en plus.
// Usage : node tools/optcheck.js [nombre de paniers]
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "optimizer.js"), "utf8");
const O = new Function(src + "; return { runAll, feeAt };")();

let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pickInt = (a, b) => a + Math.floor(rnd() * (b - a + 1));
// barèmes réels des enseignes (en centimes), lus comme dans app.js (tiersOf), dont les frais ne remontent jamais
// quand le montant grossit : la recherche n'est exacte qu'à cette condition
const P = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "retailers.json"), "utf8"))
  .filter((r) => r.channel)
  .map((r) => {
    const ch = r.channel, t = ch.tiers && ch.tiers.length ? ch.tiers : [{ from: 0, fee: 0 }], base = t[0].fee || 0;
    return { min: Math.round((ch.minOrder || 0) * 100), fixed: Math.round((ch.fixedFee || 0) * 100), tiers: t.map((x, i) => ({ from: Math.round((x.from || 0) * 100), fee: Math.round((i === 0 ? base : x.half ? base / 2 : x.fee || 0) * 100) })) };
  })
  .filter((p, i, a) => a.findIndex((q) => JSON.stringify(q) === JSON.stringify(p)) === i);

function brute(M, K, lambda) {
  const n = M.lines.length, m = M.chans.length;
  let best = Infinity;
  for (let mask = 1; mask < 1 << m; mask++) {
    const U = []; for (let c = 0; c < m; c++) if (mask & (1 << c)) U.push(c);
    if (U.length > K) continue;
    // produits qu'aucune enseigne de U ne vend : en magasin, si possible
    const choices = [], comp = [];
    let ok = true;
    for (let l = 0; l < n; l++) {
      const o = M.offers[l].filter((x) => U.includes(x.c));
      if (o.length) choices.push(o);
      else if (M.comp[l]) comp.push(M.comp[l]);
      else { ok = false; break; }
    }
    if (!ok || comp.length > M.compMax) continue;
    const compCost = comp.reduce((a, x) => a + x.cost, 0), stores = new Set(comp.map((x) => x.ret)).size;
    const idx = choices.map(() => 0);
    for (;;) {
      const sub = new Array(m).fill(0), has = new Array(m).fill(false);
      choices.forEach((o, i) => { sub[o[idx[i]].c] += o[idx[i]].cost; has[o[idx[i]].c] = true; });
      let fees = 0, items = 0, used = 0, good = true;
      for (let c = 0; c < m; c++) if (has[c]) { if (sub[c] < M.chans[c].P.min) { good = false; break; } used++; items += sub[c]; fees += O.feeAt(M.chans[c].P, sub[c]); }
      if (good && used > 0) best = Math.min(best, items + fees + compCost + lambda * (used - 1 + stores) + stores);
      let s = 0;
      while (s < idx.length) { idx[s]++; if (idx[s] < choices[s].length) break; idx[s] = 0; s++; }
      if (s >= idx.length) break;
    }
  }
  return best;
}

const N = +process.argv[2] || 300;
let bad = 0, tested = 0, slow = 0, multi = 0, store = 0;
for (let t = 0; t < N; t++) {
  const m = pickInt(2, 4), n = pickInt(4, t % 5 === 0 ? 11 : 8);
  const chans = Array.from({ length: m }, (_, c) => ({ id: "c" + c, store: { retailer: "r" + c }, P: P[pickInt(0, P.length - 1)] }));
  const lines = [], offers = [], comp = [];
  for (let l = 0; l < n; l++) {
    const base = pickInt(300, 4500);
    const o = [];
    for (let c = 0; c < m; c++) if (rnd() < 0.65) o.push({ c, cost: Math.round(base * (0.85 + rnd() * 0.4)) });
    if (!o.length) o.push({ c: pickInt(0, m - 1), cost: base });
    lines.push({ id: "p" + l, q: 1, n: l });
    offers.push(o);
    const st = o.filter((x) => x.c !== m - 1); // la dernière enseigne n'a pas de magasin
    comp.push(st.length ? st.reduce((a, x) => (x.cost < a.cost ? x : a), st[0]) : null);
  }
  for (const compMax of [0, Math.max(1, Math.floor(n / 4))]) for (const lambda of [0, 150]) {
    const M = { lines, offers, chans, comp: comp.map((x) => (x ? { cost: x.cost, ret: "r" + x.c } : null)), compMax, uncovered: [] };
    const got = {};
    const t0 = Date.now();
    O.runAll(M, m, lambda, (msg) => { if (msg.done) return; got[msg.k] = msg.full ? msg.full.score : Infinity; if (msg.full && msg.k === m) { if (msg.full.orders.length > 1) multi++; if (msg.full.completed.length) store++; } }, 5000);
    if (Date.now() - t0 > 1000) slow++;
    for (let K = 1; K <= m; K++) {
      tested++;
      const want = brute(M, K, lambda);
      if (Math.abs(got[K] - want) > 0.5 && !(got[K] === Infinity && want === Infinity)) {
        bad++;
        if (bad <= 5) console.log(`écart : panier ${t}, ${K} commandes au plus, magasin ${compMax}, coût ${lambda} : trouvé ${got[K]}, minimum ${want}`);
      }
    }
  }
}
console.log(`${tested} cas vérifiés (${multi} meilleures répartitions en plusieurs commandes, ${store} avec achat en magasin), ${bad} écart${bad > 1 ? "s" : ""}${slow ? `, ${slow} calculs de plus d'une seconde` : ""}.`);
process.exit(bad ? 1 : 0);
