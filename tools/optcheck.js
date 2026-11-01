// Vérification de la répartition du panier (optimizer.js) : sur des paniers tirés au hasard, compare le total
// trouvé par runAll, pour chaque nombre de commandes, au minimum obtenu en essayant toutes les répartitions.
// Avec et sans achat en magasin, avec et sans coût par commande en plus.
// Puis le panier intelligent, sur des modèles construits comme l'appli (buildModel) : épingles et exclusions
// respectées, panier souple (équivalents acceptés, prix relevés seulement) exact et jamais plus cher que le panier
// exact, gain exact de « Compléter malin » (bestAt avec un produit en plus), scénarios « Et si : sans X ».
// Enfin les quatre façons de faire ses courses (howPick, howChans), sur les enseignes réelles de data/retailers.json :
// options retenues de chaque groupe (tout livré : la livraison du secteur ; tout en drive : le retrait du secteur),
// canaux de chaque façon (en drive, les retraits seuls ; en magasin, les enseignes qui ont des magasins, jamais à prix
// simulés, sans minimum ni frais), produits qu'une façon ne peut pas prendre, répartition exacte pour chaque nombre de
// commandes ou de magasins au plus, avec et sans coût d'une commande ou d'un magasin en plus.
// Usage : node tools/optcheck.js [nombre de paniers]
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "optimizer.js"), "utf8");
const O = new Function(src + "; return { runAll, feeAt, buildModel, bestAt, HOWS, howPick, howChans };")();

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

/* ---------- panier intelligent ---------- */
/* Énumération indépendante, sur les données brutes de l'appli : chaque ligne a son produit et ses équivalents (prix par
   enseigne, simulé ou non) et ses enseignes interdites (no). Une enseigne permise prend le moins cher du produit et des
   équivalents relevés (un équivalent simulé ne compte jamais) ; en magasin, le prix relevé le plus bas d'une enseigne
   permise qui a des magasins. Avec des équivalents, le panier exact (sans eux) compte aussi : le meilleur des deux.
   Renvoie le meilleur score (comme runAll) et le total de cette répartition. */
function bruteRaw(src, chans, store, compOn, K, lambda) {
  const a = bruteOne(src, chans, store, compOn, K, lambda);
  if (!src.some((x) => x.opts.length > 1)) return a;
  const ex = src.map((x) => Object.assign({}, x, { opts: x.opts.slice(0, 1) }));
  if (covered(ex, chans.length) !== covered(src, chans.length)) return a;
  const b = bruteOne(ex, chans, store, compOn, K, lambda);
  return b.score < a.score ? b : a;
}
const covered = (src, m) => src.filter((x) => { for (let c = 0; c < m; c++) if (!x.no.includes(c) && x.opts.some((op, j) => { const v = op.at[c]; return v && v.cost > 0 && (j === 0 || !v.sim); })) return true; return false; }).length;
function bruteOne(src, chans, store, compOn, K, lambda) {
  const m = chans.length, at = (x, j, c) => { const a = x.opts[j].at[c]; return a && a.cost > 0 && (j === 0 || !a.sim) ? a.cost : null; };
  const lines = src.filter((x) => { for (let c = 0; c < m; c++) if (!x.no.includes(c) && x.opts.some((_, j) => at(x, j, c) != null)) return true; return false; });
  const compMax = compOn ? Math.max(1, Math.floor(lines.length / 4)) : 0;
  let best = { score: Infinity, total: Infinity };
  for (let mask = 1; mask < 1 << m; mask++) {
    const U = []; for (let c = 0; c < m; c++) if (mask & (1 << c)) U.push(c);
    if (U.length > K) continue;
    const choices = [], comp = [];
    let ok = true;
    for (const x of lines) {
      const o = [];
      for (const c of U) { if (x.no.includes(c)) continue; let b = null; x.opts.forEach((_, j) => { const v = at(x, j, c); if (v != null && (b == null || v < b)) b = v; }); if (b != null) o.push({ c, cost: b }); }
      if (o.length) { choices.push(o); continue; }
      let cb = null;
      for (let c = 0; c < m; c++) { if (!store[c] || x.no.includes(c)) continue; x.opts.forEach((op) => { const a = op.at[c]; if (a && a.cost > 0 && !a.sim && (!cb || a.cost < cb.cost)) cb = { cost: a.cost, ret: chans[c].id }; }); }
      if (cb) comp.push(cb); else { ok = false; break; }
    }
    if (!ok || comp.length > compMax) continue;
    const compCost = comp.reduce((a, x) => a + x.cost, 0), stores = new Set(comp.map((x) => x.ret)).size;
    const idx = choices.map(() => 0);
    for (;;) {
      const sub = new Array(m).fill(0), has = new Array(m).fill(false);
      choices.forEach((o, i) => { sub[o[idx[i]].c] += o[idx[i]].cost; has[o[idx[i]].c] = true; });
      let fees = 0, items = 0, used = 0, good = true;
      for (let c = 0; c < m; c++) if (has[c]) { if (sub[c] < chans[c].P.min) { good = false; break; } used++; items += sub[c]; fees += O.feeAt(chans[c].P, sub[c]); }
      if (good && used > 0) { const score = items + fees + compCost + lambda * (used - 1 + stores) + stores; if (score < best.score) best = { score, total: items + fees + compCost }; }
      let s2 = 0;
      while (s2 < idx.length) { idx[s2]++; if (idx[s2] < choices[s2].length) break; idx[s2] = 0; s2++; }
      if (s2 >= idx.length) break;
    }
  }
  return best;
}
/* toutes les étapes de runAll : score de la répartition de tout le panier en k commandes au plus, et ses commandes */
function steps(M, lambda) {
  const got = {};
  O.runAll(M, M.chans.length, lambda, (msg) => { if (!msg.done) got[msg.k] = msg.full; }, 5000);
  return got;
}
const near = (a, b) => (a === Infinity && b === Infinity) || Math.abs(a - b) <= 0.5;
let sBad = 0, sTested = 0, flexWins = 0, pinned = 0, topups = 0, sans = 0, alts = 0;
const sFail = (msg) => { sBad++; if (sBad <= 8) console.log("écart : " + msg); };
const N2 = Math.max(40, Math.round(N / 2));
for (let t = 0; t < N2; t++) {
  const m = pickInt(2, 4), n = pickInt(3, 7);
  const chans = Array.from({ length: m }, (_, c) => ({ id: "c" + c, store: { retailer: "r" + c }, P: P[pickInt(0, P.length - 1)] }));
  const store = chans.map((_, c) => c < m - 1 && rnd() < 0.7);
  const prod = (id) => { const base = pickInt(300, 4000), at = []; for (let c = 0; c < m; c++) at.push(rnd() < 0.6 ? { cost: Math.round(base * (0.8 + rnd() * 0.5)), sim: rnd() < 0.12 } : null); if (!at.some(Boolean)) at[pickInt(0, m - 1)] = { cost: base, sim: false }; return { id, at }; };
  const src = [];
  for (let l = 0; l < n; l++) {
    const opts = [prod("p" + l)];
    const ne = rnd() < 0.5 ? pickInt(1, 2) : 0;
    for (let e = 0; e < ne; e++) opts.push(prod("p" + l + "e" + e));
    const no = [];
    const r = rnd();
    if (r < 0.2) { const keep = pickInt(0, m - 1); for (let c = 0; c < m; c++) if (c !== keep) no.push(c); pinned++; }
    else if (r < 0.4) no.push(pickInt(0, m - 1));
    src.push({ id: "p" + l, q: 1, opts, no });
  }
  const exactSrc = src.map((x) => Object.assign({}, x, { opts: x.opts.slice(0, 1) }));
  for (const compOn of [false, true]) for (const lambda of [0, 150]) {
    const MF = O.buildModel(src, chans, store, compOn), ME = O.buildModel(exactSrc, chans, store, compOn);
    const gf = steps(MF, lambda), ge = steps(ME, lambda);
    for (let K = 1; K <= m; K++) {
      sTested++;
      const wf = bruteRaw(src, chans, store, compOn, K, lambda), we = bruteRaw(exactSrc, chans, store, compOn, K, lambda);
      const sf = gf[K] ? gf[K].score : Infinity, se = ge[K] ? ge[K].score : Infinity;
      if (!near(sf, wf.score)) sFail(`souple, panier ${t}, ${K} commandes : trouvé ${sf}, minimum ${wf.score}`);
      if (!near(se, we.score)) sFail(`exact, panier ${t}, ${K} commandes : trouvé ${se}, minimum ${we.score}`);
      /* le panier souple ne coûte jamais plus que le panier exact, pour les mêmes produits */
      if (MF.lines.length === ME.lines.length && sf > se + 0.5) sFail(`souple plus cher que l'exact, panier ${t}, ${K} commandes : ${sf} contre ${se}`);
      if (MF.lines.length === ME.lines.length && sf < se - 0.5) flexWins++;
      /* épingles et exclusions : aucune ligne dans une enseigne interdite, ni en magasin chez elle ; un équivalent
         seulement à son prix relevé */
      const r = gf[K];
      if (r) {
        for (const o of r.orders) for (const x of o.items) {
          const L = src.find((y) => y.id === x.l.id), c = chans.indexOf(o.ch);
          if (L.no.includes(c)) sFail(`ligne ${x.l.id} dans une enseigne interdite (${o.ch.id}), panier ${t}`);
          if (x.alt) { alts++; const op = L.opts.find((y) => y.id === x.alt), a = op && op.at[c]; if (!a || a.sim || a.cost !== x.cost) sFail(`équivalent ${x.alt} mal compté chez ${o.ch.id}, panier ${t}`); }
        }
        for (const x of r.completed) { const L = src.find((y) => y.id === x.l.id), c = chans.findIndex((ch) => ch.id === x.ret); if (L.no.includes(c) || !store[c]) sFail(`ligne ${x.l.id} en magasin chez une enseigne interdite (${x.ret}), panier ${t}`); }
        /* bestAt (Et si, Compléter malin) donne le même total que runAll */
        const b = O.bestAt(MF, K, lambda, 5000);
        if (!b.full || !near(b.full.score, r.score) || b.full.total !== r.itemsTotal + r.feesTotal + (r.compTotal || 0)) sFail(`bestAt diffère de runAll, panier ${t}, ${K} commandes`);
      }
    }
    /* Compléter malin : le total avec un produit en plus, tel que bestAt le donne, est le vrai minimum, et le gain
       affiché (nouveau total moins ancien) est l'écart exact entre les deux minimums */
    const K = pickInt(1, m), cand = { id: "neuf", q: 1, opts: [prod("neuf")], no: [] };
    const b0 = O.bestAt(MF, K, lambda, 5000), b1 = O.bestAt(O.buildModel(src.concat([cand]), chans, store, compOn), K, lambda, 5000);
    const w0 = bruteRaw(src, chans, store, compOn, K, lambda), w1 = bruteRaw(src.concat([cand]), chans, store, compOn, K, lambda);
    topups++;
    const s0 = b0.full ? b0.full.score : Infinity, s1 = b1.full ? b1.full.score : Infinity;
    if (!near(s0, w0.score) || !near(s1, w1.score)) sFail(`Compléter malin, panier ${t} : ${s0} puis ${s1}, minimums ${w0.score} puis ${w1.score}`);
    else if (b0.full && b1.full && lambda === 0 && Math.abs((b1.full.total - b0.full.total) - (w1.total - w0.total)) > 1) sFail(`Compléter malin, panier ${t} : gain ${b1.full.total - b0.full.total}, attendu ${w1.total - w0.total}`);
    /* Et si : sans telle enseigne, le modèle reconstruit sans elle (indices des interdictions décalés) */
    for (let x = 0; x < m; x++) {
      const keep = chans.map((_, c) => c).filter((c) => c !== x), ch2 = keep.map((c) => chans[c]), st2 = keep.map((c) => store[c]);
      const src2 = src.map((y) => ({ id: y.id, q: y.q, opts: y.opts.map((op) => ({ id: op.id, at: keep.map((c) => op.at[c]) })), no: y.no.filter((c) => c !== x).map((c) => keep.indexOf(c)) }));
      const M2 = O.buildModel(src2, ch2, st2, compOn), K2 = Math.min(K, ch2.length), b2 = O.bestAt(M2, K2, lambda, 5000), w2 = bruteRaw(src2, ch2, st2, compOn, K2, lambda);
      sans++;
      const s2 = b2.full ? b2.full.score : Infinity;
      if (!near(s2, w2.score)) sFail(`sans c${x}, panier ${t} : trouvé ${s2}, minimum ${w2.score}`);
      if (M2.lines.length === MF.lines.length && s2 < s0 - 0.5) sFail(`sans c${x} moins cher qu'avec, panier ${t}`);
    }
  }
}
/* ---------- les quatre façons ---------- */
const RETS = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "retailers.json"), "utf8")).filter((r) => r.channel);
const pk = (r) => (r.channel || {}).mode === "retrait";
const Pof = (r) => { const ch = r.channel, t = ch.tiers && ch.tiers.length ? ch.tiers : [{ from: 0, fee: 0 }], b = t[0].fee || 0; const T = t.map((x, i) => ({ from: Math.round((x.from || 0) * 100), fee: Math.round((i === 0 ? b : x.half ? b / 2 : x.fee || 0) * 100) })); for (let i = 1; i < T.length; i++) T[i].fee = Math.min(T[i].fee, T[i - 1].fee); return { min: Math.round((ch.minOrder || 0) * 100), fixed: Math.round((ch.fixedFee || 0) * 100), tiers: T }; };
const GROUPS = {};
for (const r of RETS) if (r.group) (GROUPS[r.group] = GROUPS[r.group] || []).push(r);
const gOf = (r) => r.group || r.id;
/* toutes les répartitions, pour chaque nombre de canaux au plus : le meilleur score (comme runAll) par K */
function bruteAllOne(src, chans, store, compOn, lambda) {
  const m = chans.length, at = (x, j, c) => { const a = x.opts[j].at[c]; return a && a.cost > 0 && ((j === 0 && !chans[c].mag) || !a.sim) ? a.cost : null; };
  const lines = src.filter((x) => { for (let c = 0; c < m; c++) if (!x.no.includes(c) && x.opts.some((_, j) => at(x, j, c) != null)) return true; return false; });
  const compMax = compOn ? Math.max(1, Math.floor(lines.length / 4)) : 0;
  const best = new Array(m + 1).fill(Infinity);
  for (let mask = 1; mask < 1 << m; mask++) {
    const U = []; for (let c = 0; c < m; c++) if (mask & (1 << c)) U.push(c);
    const choices = [], comp = [];
    let ok = true;
    for (const x of lines) {
      const o = [];
      for (const c of U) { if (x.no.includes(c)) continue; let b = null; x.opts.forEach((_, j) => { const v = at(x, j, c); if (v != null && (b == null || v < b)) b = v; }); if (b != null) o.push({ c, cost: b }); }
      if (o.length) { choices.push(o); continue; }
      let cb = null;
      for (let c = 0; c < m; c++) { if (!store[c] || x.no.includes(c)) continue; x.opts.forEach((op) => { const a = op.at[c]; if (a && a.cost > 0 && !a.sim && (!cb || a.cost < cb.cost)) cb = { cost: a.cost, ret: chans[c].id }; }); }
      if (cb) comp.push(cb); else { ok = false; break; }
    }
    if (!ok || comp.length > compMax) continue;
    const compCost = comp.reduce((a, x) => a + x.cost, 0), stores = new Set(comp.map((x) => x.ret)).size;
    const idx = choices.map(() => 0);
    for (;;) {
      const sub = new Array(m).fill(0), has = new Array(m).fill(false);
      choices.forEach((o, i) => { sub[o[idx[i]].c] += o[idx[i]].cost; has[o[idx[i]].c] = true; });
      let fees = 0, items = 0, used = 0, good = true;
      for (let c = 0; c < m; c++) if (has[c]) { if (sub[c] < chans[c].P.min) { good = false; break; } used++; items += sub[c]; fees += O.feeAt(chans[c].P, sub[c]); }
      if (good && used > 0) { const score = items + fees + compCost + lambda * (used - 1 + stores) + stores; if (score < best[U.length]) best[U.length] = score; }
      let s2 = 0;
      while (s2 < idx.length) { idx[s2]++; if (idx[s2] < choices[s2].length) break; idx[s2] = 0; s2++; }
      if (s2 >= idx.length) break;
    }
  }
  for (let k = 2; k <= m; k++) best[k] = Math.min(best[k], best[k - 1]);
  return { best, n: lines.length };
}
function bruteAll(src, chans, store, compOn, lambda) {
  const a = bruteAllOne(src, chans, store, compOn, lambda);
  if (!src.some((x) => x.opts.length > 1)) return a.best;
  const b = bruteAllOne(src.map((x) => Object.assign({}, x, { opts: x.opts.slice(0, 1) })), chans, store, compOn, lambda);
  return b.n === a.n ? a.best.map((v, k) => Math.min(v, b.best[k])) : a.best;
}
let hBad = 0, hTested = 0, hMag = 0, hDrive = 0, hMiss = 0, hMagMulti = 0, hNoChan = 0;
const hFail = (msg) => { hBad++; if (hBad <= 10) console.log("écart : " + msg); };
const N3 = Math.max(60, Math.round(N / 2));
for (let t = 0; t < N3; t++) {
  /* réglages tirés au hasard : options choisies, enseignes désactivées, choix faits pour tout livré et tout en drive */
  const pick = {}, liv = {}, drv = {}, off = {};
  for (const g of Object.keys(GROUPS)) { const ms = GROUPS[g]; pick[g] = ms[pickInt(0, ms.length - 1)].id; if (rnd() < 0.3) { const p = ms.filter(pk), l = ms.filter((m) => !pk(m)); if (p.length && l.length) { liv[p[pickInt(0, p.length - 1)].id] = l[pickInt(0, l.length - 1)].id; drv[l[pickInt(0, l.length - 1)].id] = p[pickInt(0, p.length - 1)].id; } } }
  for (const r of RETS) if (rnd() < (r.simulated ? 0.5 : 0.15)) off[gOf(r)] = true;
  /* prix par option : chaque enseigne vend le produit ou non ; E.Leclerc à prix simulés */
  const n = pickInt(2, 6), prices = [];
  for (let l = 0; l < n + 2; l++) { const base = pickInt(200, 3500), at = {}; for (const r of RETS) if (rnd() < 0.5) at[r.id] = { cost: Math.round(base * (0.8 + rnd() * 0.5)), sim: !!r.simulated }; prices.push(at); }
  for (const how of O.HOWS) {
    const rets = RETS.filter((r) => !off[gOf(r)] && (!r.group || r.id === O.howPick(GROUPS[r.group], pick[r.group], how, liv, drv)));
    /* l'option retenue : tout livré jamais un retrait (ici chaque groupe a une livraison), tout en drive un retrait si le groupe en a un */
    for (const r of rets) {
      if (!r.group) continue;
      if (how === "liv" && pk(r)) hFail(`tout livré : ${r.id} est un retrait, panier ${t}`);
      if (how === "drive" && !pk(r) && GROUPS[r.group].some(pk)) hFail(`tout en drive : ${r.id} n'est pas un retrait, panier ${t}`);
      if ((how === "mix" || how === "mag") && r.id !== pick[r.group]) hFail(`${how} : ${r.id} au lieu du choix ${pick[r.group]}, panier ${t}`);
      if (how === "liv" && pk(GROUPS[r.group].find((m) => m.id === pick[r.group])) && liv[pick[r.group]] && r.id !== liv[pick[r.group]]) hFail(`tout livré : ${r.id} au lieu de la livraison choisie ${liv[pick[r.group]]}, panier ${t}`);
      if (how === "drive" && !pk(GROUPS[r.group].find((m) => m.id === pick[r.group])) && drv[pick[r.group]] && r.id !== drv[pick[r.group]]) hFail(`tout en drive : ${r.id} au lieu du retrait choisi ${drv[pick[r.group]]}, panier ${t}`);
      if (how === "drive" && !drv[pick[r.group]]) { const p0 = GROUPS[r.group].find((m) => m.id === pick[r.group]); if (!pk(p0)) { const sec = GROUPS[r.group].find((m) => pk(m) && m.livraison === p0.id); if (sec && r.id !== sec.id) hFail(`tout en drive : ${r.id} au lieu du retrait du secteur ${sec.id}, panier ${t}`); } }
    }
    const H = O.howChans(rets.map((r) => ({ id: r.id, P: Pof(r), pickup: pk(r), magasin: !!r.magasin, simulated: !!r.simulated })), how);
    const chans = H.chans;
    for (const ch of chans) {
      const r = RETS.find((x) => x.id === ch.id);
      if (how === "drive" && !pk(r)) hFail(`tout en drive : ${ch.id} sans retrait dans les canaux, panier ${t}`);
      if (how === "mag" && (!r.magasin || r.simulated)) hFail(`tout en magasin : ${ch.id} (sans magasin ou à prix simulés) dans les canaux, panier ${t}`);
      if (how === "mag" && (ch.P.min || ch.P.fixed || ch.P.tiers.some((x) => x.fee))) hFail(`tout en magasin : ${ch.id} avec un minimum ou des frais, panier ${t}`);
    }
    if (H.compOn !== (how === "mix") || H.store.some((v, i) => v && (how !== "mix" || !RETS.find((x) => x.id === chans[i].id).magasin))) hFail(`${how} : achat en magasin pour compléter mal réglé, panier ${t}`);
    if (!chans.length) { hNoChan++; continue; }
    const groups = chans.map((ch) => gOf(RETS.find((x) => x.id === ch.id)));
    const src = prices.slice(0, n).map((at0, l) => {
      const opts = [{ id: "p" + l, at: chans.map((ch) => at0[ch.id] || null) }];
      if (rnd() < 0.3) { const at1 = prices[n + (l % 2)]; opts.push({ id: "p" + l + "e", at: chans.map((ch) => at1[ch.id] || null) }); }
      const no = [];
      if (rnd() < 0.2) { const g = groups[pickInt(0, groups.length - 1)]; groups.forEach((x, ci) => { if (x === g) no.push(ci); }); }
      return { id: "p" + l, q: 1, opts, no };
    });
    const M = O.buildModel(src, chans, H.store, H.compOn);
    /* produits que la façon ne peut pas prendre : aucune offre permise (ni prix simulé en magasin), jamais comptés */
    const want = src.filter((x) => !chans.some((ch, ci) => !x.no.includes(ci) && x.opts.some((op, j) => { const a = op.at[ci]; return a && a.cost > 0 && (j === 0 ? !(ch.mag && a.sim) : !a.sim); }))).map((x) => x.id);
    if (JSON.stringify(M.uncovered) !== JSON.stringify(want)) hFail(`${how} : produits hors de la façon ${JSON.stringify(M.uncovered)} au lieu de ${JSON.stringify(want)}, panier ${t}`);
    hMiss += want.length;
    if (!M.lines.length) continue;
    for (const lambda of [0, 150]) {
      const got = steps(M, lambda), w = bruteAll(src, chans, H.store, H.compOn, lambda);
      for (let K = 1; K <= chans.length; K++) {
        hTested++;
        const sc = got[K] ? got[K].score : Infinity;
        if (!near(sc, w[K])) hFail(`${how}, panier ${t}, ${K} au plus, coût ${lambda} : trouvé ${sc}, minimum ${w[K]}`);
        const r = got[K];
        if (!r) continue;
        if (r.orders.length > K) hFail(`${how} : ${r.orders.length} commandes pour ${K} au plus, panier ${t}`);
        if (how === "mag") {
          hMag++;
          if (r.orders.length > 1) hMagMulti++;
          if (r.feesTotal || (r.completed || []).length) hFail(`tout en magasin : frais ou achats pour compléter, panier ${t}`);
          if (Math.abs(r.extra - lambda * (r.orders.length - 1)) > 0.5) hFail(`tout en magasin : magasins en plus comptés ${r.extra} au lieu de ${lambda * (r.orders.length - 1)}, panier ${t}`);
          for (const o of r.orders) for (const x of o.items) { const L = src.find((y) => y.id === x.l.id), ci = chans.indexOf(o.ch), op = x.alt ? L.opts.find((y) => y.id === x.alt) : L.opts[0], a = op && op.at[ci]; if (!a || a.sim || a.cost !== x.cost) hFail(`tout en magasin : ${x.l.id} chez ${o.ch.id} à un prix qui n'est pas relevé, panier ${t}`); }
        }
        if (how === "drive") { hDrive++; if ((r.completed || []).length) hFail(`tout en drive : achat en magasin, panier ${t}`); }
        if (how === "liv" && (r.completed || []).length) hFail(`tout livré : achat en magasin, panier ${t}`);
      }
    }
  }
}
/* un prix simulé chez une enseigne qui a des magasins ne compte jamais en magasin, même pour le produit lui-même */
{
  const ch = [{ id: "a", store: { retailer: "a" }, mag: true, P: { min: 0, fixed: 0, tiers: [{ from: 0, fee: 0 }] } }];
  const M = O.buildModel([{ id: "x", q: 1, opts: [{ id: "x", at: [{ cost: 100, sim: true }] }], no: [] }, { id: "y", q: 1, opts: [{ id: "y", at: [{ cost: 200, sim: false }] }], no: [] }], ch, [false], false);
  if (M.uncovered.join() !== "x" || M.lines.length !== 1) hFail("tout en magasin : un prix simulé a été compté");
}
console.log(`Quatre façons : ${hTested} cas (${hMag} en magasin dont ${hMagMulti} dans plusieurs magasins, ${hDrive} en drive, ${hMiss} produits hors de leur façon, ${hNoChan} façons sans enseigne), ${hBad} écart${hBad > 1 ? "s" : ""}.`);
console.log(`Panier intelligent : ${sTested} cas (${pinned} épingles tirées, ${alts} équivalents pris, ${flexWins} fois le panier souple moins cher), ${topups} « Compléter malin », ${sans} « Et si : sans », ${sBad} écart${sBad > 1 ? "s" : ""}.`);
process.exit(bad || sBad || hBad ? 1 : 0);
