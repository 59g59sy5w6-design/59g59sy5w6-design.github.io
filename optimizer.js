function feeAt(P, x) {
  if (x <= 0) return 0;
  let f = P.tiers.length ? P.tiers[0].fee : 0;
  for (const t of P.tiers) if (x >= t.from) f = t.fee;
  return f + P.fixed;
}
function minFee(P, lo, hi) {
  const a = Math.max(lo, P.min, 1);
  if (a > hi) return Infinity;
  let m = feeAt(P, a);
  for (const t of P.tiers) if (t.from > a && t.from <= hi) m = Math.min(m, feeAt(P, t.from));
  return m;
}
function isSpecial(P) { return P.min > 0 || P.fixed > 0 || P.tiers.length > 1 || P.tiers.some((t) => t.fee > 0); }
function tierOptions(P) {
  const out = [];
  for (let j = 0; j < P.tiers.length; j++) {
    const L = Math.max(P.min, P.tiers[j].from, 1);
    const next = P.tiers[j + 1] ? P.tiers[j + 1].from : Infinity;
    if (L >= next && j < P.tiers.length - 1) continue;
    out.push(L);
  }
  return out.length ? out : [Math.max(P.min, 1)];
}
/* Exact cheapest assignment of every line to one channel of `sub`, for given lower bounds on subtotals. */
function solveTargets(cost, L, m, budget, ub, deadline) {
  const n = cost.length;
  const base = new Int32Array(n), baseCost = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let bk = -1, bc = Infinity;
    for (let k = 0; k < m; k++) { const c = cost[i][k]; if (c >= 0 && (c < bc || (c === bc && L[k] > 0 && (bk < 0 || L[bk] === 0)))) { bc = c; bk = k; } }
    base[i] = bk; baseCost[i] = bc;
  }
  const tot = new Float64Array(m);
  for (let i = 0; i < n; i++) tot[base[i]] += baseCost[i];
  const unmet = [], bounded = [];
  for (let k = 0; k < m; k++) if (L[k] > 0) { bounded.push(k); if (tot[k] < L[k]) unmet.push(k); }
  if (!unmet.length) return { assign: base, truncated: false };
  if (bounded.length === 1) {
    const t = unmet[0];
    const cand = [];
    for (let i = 0; i < n; i++) if (base[i] !== t && cost[i][t] >= 0) cand.push(i);
    return knapsackExact(cost, base, baseCost, cand, t, Math.round(L[t] - tot[t]));
  }
  return branchAndBound(cost, L, m, budget, ub, deadline);
}
/* 0/1 covering knapsack: cheapest set of lines to move into channel t so that its subtotal reaches the target. */
function knapsackExact(cost, base, baseCost, cand, t, cap) {
  const K = cand.length;
  const rows = [new Float32Array(cap + 1).fill(Infinity)]; rows[0][0] = 0;
  for (let ci = 0; ci < K; ci++) {
    const prev = rows[ci], cur = Float32Array.from(prev);
    const i = cand[ci], w = cost[i][t], d = cost[i][t] - baseCost[i];
    for (let s = 0; s <= cap; s++) { if (prev[s] === Infinity) continue; const ns = Math.min(cap, s + w); if (prev[s] + d < cur[ns]) cur[ns] = prev[s] + d; }
    rows.push(cur);
  }
  if (rows[K][cap] === Infinity) return null;
  const assign = Int32Array.from(base);
  let s = cap;
  for (let ci = K - 1; ci >= 0; ci--) {
    if (rows[ci + 1][s] === rows[ci][s]) continue;
    const i = cand[ci], w = cost[i][t], d = cost[i][t] - baseCost[i];
    let found = -1;
    if (s < cap) { const p = s - w; if (p >= 0 && Math.abs(rows[ci][p] + d - rows[ci + 1][s]) < 1e-6) found = p; }
    else { for (let p = Math.max(0, cap - w); p <= cap; p++) if (rows[ci][p] !== Infinity && Math.min(cap, p + w) === cap && Math.abs(rows[ci][p] + d - rows[ci + 1][s]) < 1e-6) { found = p; break; } }
    if (found < 0) continue;
    assign[i] = t; s = found;
  }
  return { assign, truncated: false };
}
function branchAndBound(cost, L, m, budget, ub, deadline) {
  const n = cost.length;
  const opts = cost.map((row) => { const o = []; row.forEach((c, k) => { if (c >= 0) o.push({ k, c }); }); o.sort((a, b) => a.c - b.c); return o; });
  const order = [...Array(n).keys()].sort((a, b) => {
    if (opts[a].length !== opts[b].length) return opts[a].length - opts[b].length;
    const ra = (opts[a][1] ? opts[a][1].c : 1e12) - opts[a][0].c, rb = (opts[b][1] ? opts[b][1].c : 1e12) - opts[b][0].c;
    return rb - ra;
  });
  const posOf = new Int32Array(n); order.forEach((li, p) => { posOf[li] = p; });
  const cheapest = opts.map((o) => o[0].c);
  /* per bounded channel: lines that can go there, by extra cost per euro brought */
  const ratio = [];
  for (let k = 0; k < m; k++) {
    if (!(L[k] > 0)) { ratio.push(null); continue; }
    const r = [];
    for (let j = 0; j < n; j++) { const c = cost[j][k]; if (c > 0) r.push({ j, w: c, d: c - cheapest[j] }); }
    r.sort((a, b) => a.d / a.w - b.d / b.w);
    ratio.push(r);
  }
  const sufMin = new Float64Array(n + 1);
  for (let i = n - 1; i >= 0; i--) sufMin[i] = sufMin[i + 1] + opts[order[i]][0].c;
  const tot = new Float64Array(m), pick = new Int32Array(n);
  /* ub : coût des articles au-delà duquel cette piste ne peut plus battre la meilleure répartition déjà trouvée */
  let best = ub == null ? Infinity : ub, bestPick = null, nodes = 0, truncated = false;
  function extraBound(i) {
    let add = 0;
    for (let k = 0; k < m; k++) {
      if (!ratio[k]) continue;
      let need = L[k] - tot[k];
      if (need <= 0) continue;
      for (const x of ratio[k]) {
        if (posOf[x.j] < i) continue;
        if (x.w >= need) { add += x.d * (need / x.w); need = 0; break; }
        add += x.d; need -= x.w;
      }
      if (need > 0) return Infinity;
    }
    return add;
  }
  function dfs(i, cur) {
    if (++nodes > budget || ((nodes & 4095) === 0 && deadline && performance.now() > deadline)) { truncated = true; return; }
    const lb = cur + sufMin[i] + extraBound(i);
    if (lb >= best) return;
    if (i === n) { best = cur; bestPick = Array.from(pick); return; }
    const o = opts[order[i]];
    for (let j = 0; j < o.length; j++) {
      tot[o[j].k] += o[j].c; pick[i] = o[j].k;
      dfs(i + 1, cur + o[j].c);
      tot[o[j].k] -= o[j].c;
      if (truncated) return;
    }
  }
  dfs(0, 0);
  if (!bestPick) return truncated ? { assign: null, truncated: true } : null;
  const assign = new Int32Array(n);
  for (let i = 0; i < n; i++) assign[order[i]] = bestPick[i];
  return { assign, truncated };
}
/* Répartition la moins chère du panier entre les enseignes de `sub`.
   Un produit qu'aucune enseigne de `sub` ne vend est « à compléter en magasin » (M.comp[l] : prix relevé le plus bas dans
   une enseigne qui a des magasins), dans la limite de M.compMax produits ; sinon la répartition est impossible, sauf si le
   canal « hors commande » fait partie de `sub` (deuxième passe, produits laissés de côté). */
function solveSubset(sub, M, lambda, budget, deadline, bestScore) {
  const n = M.lines.length, m = sub.length;
  const pos = new Map(sub.map((c, i) => [c, i]));
  const hasSkip = sub.some((c) => M.chans[c].skip);
  const compMax = M.compMax == null ? 0 : M.compMax;
  const cost = [], rowLine = [], compLines = [], noReal = [];
  for (let l = 0; l < n; l++) {
    const row = new Array(m).fill(-1); let real = false;
    for (const of of M.offers[l]) if (pos.has(of.c)) { row[pos.get(of.c)] = of.cost; if (!M.chans[of.c].skip) real = true; }
    if (!real) {
      if (M.comp && M.comp[l]) { compLines.push(l); noReal.push([l, row]); continue; }
      if (!hasSkip) return null;
    }
    cost.push(row); rowLine.push(l);
  }
  if (compLines.length > compMax) {
    if (!hasSkip) return null;
    /* trop de produits à compléter : dans la passe « hors commande », on revient à les laisser de côté */
    for (const [l, row] of noReal) { cost.push(row); rowLine.push(l); }
    compLines.length = 0;
  }
  if (!cost.length) return null;
  const nn = cost.length;
  let compCost = 0; const stores = new Set();
  for (const l of compLines) { compCost += M.comp[l].cost; stores.add(M.comp[l].ret); }
  const compExtra = compCost + lambda * stores.size;
  const P = sub.map((c) => M.chans[c].P);
  const spec = []; for (let k = 0; k < m; k++) if (isSpecial(P[k])) spec.push(k);
  /* bornes : coût minimal des articles (chaque ligne au moins cher) et frais minimaux une fois les minimums atteints */
  let itemsLB = 0;
  for (let i = 0; i < nn; i++) { let c = Infinity; for (const x of cost[i]) if (x >= 0 && x < c) c = x; itemsLB += c; }
  /* Frais minimaux pour un sous-total d'au moins Lk. Quand les frais baissent avec le montant (cas de toutes les
     enseignes), ce sont les frais du palier de Lk : un sous-total plus haut, qui tomberait dans un palier moins cher,
     est examiné avec la combinaison de paliers où il est à sa place. Sinon, le minimum des paliers atteignables. */
  const feeLB = (Pk, Lk) => {
    if (!(Lk > 0)) return 0;
    if (Pk.tiers.every((t, j) => j === 0 || (t.from >= Pk.tiers[j - 1].from && t.fee <= Pk.tiers[j - 1].fee))) return feeAt(Pk, Lk);
    let j0 = 0;
    for (let j = 0; j < Pk.tiers.length; j++) if (Pk.tiers[j].from <= Lk) j0 = j;
    let f = Infinity;
    for (let j = j0; j < Pk.tiers.length; j++) f = Math.min(f, Pk.tiers[j].fee);
    return (f === Infinity ? 0 : f) + Pk.fixed;
  };
  const opt = spec.map((k) => tierOptions(P[k]));
  const idx = spec.map(() => 0);
  let best = null, truncated = false;
  for (;;) {
    if (deadline && performance.now() > deadline) { truncated = true; break; }
    const L = new Array(m).fill(0);
    spec.forEach((k, s) => { L[k] = opt[s][idx[s]]; });
    const cap = Math.min(best ? best.score : Infinity, bestScore == null ? Infinity : bestScore);
    let fLB = 0; for (let k = 0; k < m; k++) fLB += feeLB(P[k], L[k]);
    const hopeless = itemsLB + fLB + compExtra >= cap;
    const r = hopeless ? null : solveTargets(cost, L, m, budget, cap === Infinity ? null : cap - fLB - compExtra, deadline);
    if (r && r.truncated) truncated = true;
    if (r && r.assign) {
      const orders = sub.map((c) => ({ ch: M.chans[c], items: [], sub: 0, fee: 0 }));
      for (let i = 0; i < nn; i++) { const k = r.assign[i], l = rowLine[i]; const of = M.offers[l].find((x) => x.c === sub[k]); orders[k].items.push({ l: M.lines[l], ...of }); orders[k].sub += of.cost; }
      const used = orders.filter((o) => o.items.length && !o.ch.skip);
      const skipped = [];
      orders.forEach((o) => { if (o.ch.skip) skipped.push(...o.items); });
      let ok = used.length > 0, fees = 0, items = 0;
      for (const o of used) { if (o.sub < o.ch.P.min) { ok = false; break; } o.fee = feeAt(o.ch.P, o.sub); fees += o.fee; items += o.sub; }
      if (ok) {
        const extra = lambda * (Math.max(0, used.length - 1) + stores.size);
        const total = items + fees + compCost + extra;
        /* à total égal, la répartition sans passage en magasin l'emporte (1 centime par magasin) */
        const score = total + skipped.reduce((a, x) => a + x.cost, 0) + stores.size;
        if (!best || score < best.score) {
          used.forEach((o) => o.items.sort((a, b) => (a.l.n ?? 0) - (b.l.n ?? 0)));
          used.sort((a, b) => b.sub - a.sub);
          const completed = compLines.map((l) => (M.comp[l].alt ? { l: M.lines[l], cost: M.comp[l].cost, ret: M.comp[l].ret, alt: M.comp[l].alt } : { l: M.lines[l], cost: M.comp[l].cost, ret: M.comp[l].ret }));
          best = { orders: used, skipped, completed, total, score, itemsTotal: items, feesTotal: fees, compTotal: compCost, compStores: [...stores], extra };
        }
      }
    }
    let s = 0;
    while (s < spec.length) { idx[s]++; if (idx[s] < opt[s].length) break; idx[s] = 0; s++; }
    if (s >= spec.length) break;
  }
  if (!best) return truncated ? { none: true, truncated } : null;
  best.truncated = truncated;
  return best;
}
function* subsets(chans, K) {
  const groups = [];
  const idx = new Map();
  const skip = [];
  chans.forEach((c, i) => { if (c.skip) { skip.push(i); return; } const g = c.store.retailer || c.storeId; if (!idx.has(g)) { idx.set(g, groups.length); groups.push([]); } groups[idx.get(g)].push(i); });
  const cur = [];
  function* rec(g) {
    if (g === groups.length) { if (cur.length) yield cur.concat(skip); return; }
    yield* rec(g + 1);
    if (cur.length < K) for (const ci of groups[g]) { cur.push(ci); yield* rec(g + 1); cur.pop(); }
  }
  yield* rec(0);
}
function optimise(M, K, lambda, budgetMs) {
  const t0 = performance.now();
  const byK = {}; let truncated = false, count = 0;
  if (!M.lines.length || !M.chans.length) return { best: null, byK, truncated, count, ms: 0 };
  for (const sub of subsets(M.chans, K)) {
    const r = solveSubset(sub, M, lambda, 300000);
    count++;
    if (r && r.truncated) truncated = true;
    if (r && !r.none) { const k = r.orders.length; if (!byK[k] || r.score < byK[k].score) byK[k] = r; }
    if (performance.now() - t0 > (budgetMs || 5000)) { truncated = true; break; }
  }
  let best = null;
  for (const k in byK) if (!best || byK[k].score < best.score) best = byK[k];
  return { best, byK, truncated, count, ms: performance.now() - t0 };
}
function singleBasket(M, ci) {
  let sub = 0, have = 0; const items = [];
  M.offers.forEach((offs, li) => { const o = offs.find((x) => x.c === ci); if (o) { sub += o.cost; have++; items.push({ l: M.lines[li], ...o }); } });
  const P = M.chans[ci].P;
  const ok = sub >= P.min;
  return { ch: M.chans[ci], sub, have, missing: M.lines.length - have, fee: ok ? feeAt(P, sub) : null, ok, items };
}

/* Deux passes : d'abord tous les produits ; si aucune répartition n'atteint les minimums d'achat,
   on autorise à laisser des produits de côté (chacun pèse 1 000 € pour que ce soit le dernier recours). */
const SKIP_COST = 100000;
function withSkip(M) {
  const SK = M.chans.length;
  return { ...M, chans: M.chans.concat([{ id: "__skip", skip: true, store: { retailer: "__skip" }, P: { min: 0, fixed: 0, tiers: [{ from: 0, fee: 0 }] } }]), offers: M.offers.map((o) => o.concat([{ c: SK, cost: SKIP_COST }])) };
}
function solve(M, K, lambda) {
  let R = optimise(M, K, lambda), partial = false;
  if (!R.best && M.lines.length) { R = optimise(withSkip(M), K, lambda); partial = true; }
  return { best: R.best, byK: R.byK, truncated: R.truncated, partial };
}

/* Sous-ensembles d'exactement k enseignes, au plus une par groupe. */
function* subsetsOfSize(chans, k) {
  const groups = [], idx = new Map();
  chans.forEach((c, i) => { if (c.skip) return; const g = c.store.retailer || c.storeId; if (!idx.has(g)) { idx.set(g, groups.length); groups.push([]); } groups[idx.get(g)].push(i); });
  const cur = [];
  function* rec(g) {
    if (cur.length === k) { yield cur.slice(); return; }
    if (groups.length - g < k - cur.length) return;
    for (const ci of groups[g]) { cur.push(ci); yield* rec(g + 1); cur.pop(); }
    yield* rec(g + 1);
  }
  if (k > 0) yield* rec(0);
}

/* ---------- les quatre façons de faire ses courses (prefs.comp de app.js) ----------
   « mix » : livré ou retiré, et en magasin si c'est moins cher (commandes en ligne selon le choix de chaque enseigne,
   complétées en magasin) ; « liv » : tout livré ; « drive » : tout en drive ou en point de retrait ; « mag » : tout en
   magasin (aucune commande en ligne, ni minimum ni frais ; chaque magasin en plus coûte lambda dans le score : app.js y
   met le seuil d'un magasin de plus, M.lambda, pour qu'un magasin de plus ne soit retenu que s'il fait gagner au moins
   ce seuil). */
const HOWS = ["mix", "liv", "drive", "mag"];
const isRetrait = (m) => ((m && m.channel) || {}).mode === "retrait";
/* L'option d'un groupe d'enseigne (Auchan : les retraits et les livraisons de plusieurs secteurs) pour une façon.
   ms : les options du groupe (data/retailers.json), id : celle choisie dans les réglages, liv et drv : les choix faits
   pour « tout livré » et « tout en drive ». Tout livré : un retrait laisse place à sa livraison à domicile (champ
   livraison, sinon le choix liv) ; tout en drive : une livraison laisse place au retrait de son secteur (celui dont le
   champ livraison la nomme, sinon le choix drv). Le choix des réglages n'est jamais changé : en revenant à une autre
   façon, on le retrouve. Un groupe sans l'option voulue garde son choix, que howChans écarte ensuite. */
function howPick(ms, id, how, liv, drv) {
  const r = ms.find((m) => m.id === id) || ms[0];
  if (!r) return null;
  if (how === "liv" && isRetrait(r)) {
    const alt = [(liv || {})[r.id], r.livraison].find((x) => ms.some((m) => m.id === x && !isRetrait(m)));
    return alt || (ms.find((m) => !isRetrait(m)) || r).id;
  }
  if (how === "drive" && !isRetrait(r)) {
    const sec = ms.find((m) => isRetrait(m) && m.livraison === r.id);
    const alt = [(drv || {})[r.id], sec && sec.id].find((x) => ms.some((m) => m.id === x && isRetrait(m)));
    return alt || (ms.find(isRetrait) || r).id;
  }
  return r.id;
}
/* Les canaux d'une façon, à partir des options retenues et activées (une par groupe) : rets [{ id, P, pickup, magasin,
   simulated }]. Tout en drive : les retraits seulement. Tout en magasin : les enseignes qui ont des magasins, jamais à
   des prix simulés, sans minimum ni frais (mag). L'achat en magasin pour compléter les commandes (store, compOn) n'existe
   que dans la première façon. */
function howChans(rets, how) {
  const keep = rets.filter((r) => (how === "drive" ? r.pickup : how === "mag" ? r.magasin && !r.simulated : true));
  const chans = keep.map((r) => (how === "mag" ? { id: r.id, store: { retailer: r.id }, mag: true, P: { min: 0, fixed: 0, tiers: [{ from: 0, fee: 0 }] } } : { id: r.id, store: { retailer: r.id }, P: r.P }));
  return { chans, store: keep.map((r) => how === "mix" && !!r.magasin && !r.simulated), compOn: how === "mix" };
}

/* Modèle du panier, en centimes, à partir de ses lignes { id, q, opts, no } :
   - opts[0] est le produit, les suivants les équivalents que la personne accepte (panier souple) ; opts[j].at[ci] vaut
     { cost, sim } quand l'enseigne ci le vend (cost : prix de la quantité de la ligne), sinon null ;
   - no : les enseignes (indices) écartées pour cette ligne, par une épingle ailleurs ou une exclusion.
   Pour chaque enseigne permise, la ligne prend le moins cher du produit et de ses équivalents (alt : l'équivalent pris) ;
   un équivalent ne compte qu'à un prix relevé, jamais simulé, et le produit lui-même passe d'abord à prix égal.
   L'achat en magasin (comp) : le prix relevé le plus bas d'une enseigne permise qui a des magasins (store[ci]), au plus
   un quart des lignes quand il est permis (compOn). Une ligne sans enseigne permise est « uncovered ». */
function buildModel(src, chans, store, compOn) {
  const lines = [], offers = [], comp = [], uncovered = [];
  for (const x of src) {
    const no = new Set(x.no || []), o = [];
    let c = null;
    for (let ci = 0; ci < chans.length; ci++) {
      if (no.has(ci)) continue;
      let b = null;
      x.opts.forEach((op, j) => {
        const a = op.at[ci];
        /* en magasin (tout en magasin, chans[ci].mag), jamais un prix simulé, pas même celui du produit lui-même */
        if (!a || !(a.cost > 0) || ((j > 0 || chans[ci].mag) && a.sim)) return;
        if (!b || a.cost < b.cost) b = { cost: a.cost, alt: j ? op.id : null };
        if (store[ci] && !a.sim && (!c || a.cost < c.cost)) c = { cost: a.cost, ret: chans[ci].id, alt: j ? op.id : null };
      });
      if (b) o.push(b.alt ? { c: ci, cost: b.cost, alt: b.alt } : { c: ci, cost: b.cost });
    }
    if (o.length) { lines.push({ id: x.id, q: x.q, n: lines.length }); offers.push(o); comp.push(c && !c.alt ? { cost: c.cost, ret: c.ret } : c); }
    else uncovered.push(x.id);
  }
  const M = { lines, offers, comp, compMax: compOn ? Math.max(1, Math.floor(lines.length / 4)) : 0, chans, uncovered };
  /* Avec des équivalents, le panier exact (les produits eux-mêmes) est gardé à côté : prendre à chaque enseigne le moins
     cher n'est pas toujours le mieux (un produit plus cher peut faire atteindre un minimum d'achat), et le panier souple
     ne doit jamais coûter plus que le panier exact. runAll garde, pour chaque nombre de commandes, le meilleur des deux. */
  if (src.some((x) => x.opts.length > 1)) M.exact = buildModel(src.map((x) => Object.assign({}, x, { opts: x.opts.slice(0, 1) })), chans, store, compOn);
  return M;
}
/* La meilleure répartition de tout le panier en K commandes au plus, résumée (Et si, Compléter malin) : son total
   (articles, frais, achats en magasin), ses commandes (avec le coût de chaque ligne, pour la part de chacun d'une
   commande à deux) ; sinon celle qui laisse le moins de produits de côté. */
function bestAt(M, K, lambda, ms) {
  let last = null;
  if (M.lines.length && M.chans.length) runAll(M, Math.max(1, Math.min(K, M.chans.length)), lambda, (m) => { if (!m.done) last = m; }, ms);
  const brief = (r) => r && { total: r.itemsTotal + r.feesTotal + (r.compTotal || 0), score: r.score, fees: r.feesTotal, orders: r.orders.map((o) => ({ id: o.ch.id, sub: o.sub, fee: o.fee, n: o.items.length, it: o.items.map((x) => [x.l.id, x.l.q, x.cost]) })), ci: (r.completed || []).map((x) => [x.l.id, x.l.q, x.cost]), comp: (r.completed || []).length, skipped: (r.skipped || []).length, alts: r.orders.reduce((a, o) => a + o.items.filter((x) => x.alt).length, 0) + (r.completed || []).filter((x) => x.alt).length };
  return { full: last ? brief(last.full) : null, partial: last ? brief(last.partial) : null, truncated: !!(last && last.truncated), lines: M.lines.length, uncovered: M.uncovered.length };
}

/* Toutes les tailles de commande, de 1 à Kmax, dans l'ordre. Pour chaque k, report() reçoit :
   - full : la répartition de TOUT le panier la moins chère en k commandes au plus (null s'il n'y en a pas) ;
   - partial : sinon, la répartition qui laisse le moins de produits de côté, puis la moins chère.
   « full » est cumulé d'une taille à l'autre : pour le même panier, plus de commandes autorisées ne donne jamais un
   total plus élevé. Les petites tailles passent d'abord : si le temps manque, seules les grandes sont écourtées. */
function runAll(M, Kmax, lambda, report, budgetMs) {
  /* un modèle qui porte son propre coût d'une commande ou d'un magasin en plus (M.lambda, posé par app.js pour chaque
     façon : tout en magasin, le seuil d'un magasin de plus) l'emporte sur celui de l'appel ; le panier exact (M.exact)
     reçoit le même. Ce coût entre dans le score, jamais dans le total (itemsTotal + feesTotal + compTotal). */
  if (M.lambda != null) lambda = M.lambda;
  if (M.exact && M.exact.lines.length === M.lines.length) return runBoth(M, Kmax, lambda, report, budgetMs);
  return runOne(M, Kmax, lambda, report, budgetMs);
}
/* panier souple : le modèle avec équivalents et le panier exact, chacun calculé en entier ; pour chaque nombre de
   commandes, la répartition de tout le panier la moins chère des deux (sinon celle qui laisse le moins de côté) */
function runBoth(M, Kmax, lambda, report, budgetMs) {
  const ms = budgetMs || 9000, a = {}, b = {};
  runOne(M.exact, Kmax, lambda, (m) => { if (!m.done) a[m.k] = m; }, ms * 0.4);
  runOne(M, Kmax, lambda, (m) => { if (!m.done) b[m.k] = m; }, ms * 0.6);
  for (let k = 1; k <= Kmax; k++) {
    const x = a[k] || {}, y = b[k] || {};
    const full = !x.full ? y.full || null : !y.full ? x.full : y.full.score <= x.full.score ? y.full : x.full;
    const partial = full ? null : !x.partial ? y.partial || null : !y.partial ? x.partial : y.partial.score <= x.partial.score ? y.partial : x.partial;
    report({ k, full, partial, truncated: !!(x.truncated || y.truncated) });
  }
  report({ done: true });
}
function runOne(M, Kmax, lambda, report, budgetMs) {
  const deadline = performance.now() + (budgetMs || 9000);
  const MS = withSkip(M), SK = M.chans.length;
  let full = null, partial = null, truncated = false;
  for (let k = 1; k <= Kmax; k++) {
    for (const sub of subsetsOfSize(M.chans, k)) {
      if (performance.now() > deadline) { truncated = true; break; }
      const r = solveSubset(sub, M, lambda, 1e7, deadline, full ? full.score : null);
      if (r && r.truncated) truncated = true;
      if (r && !r.none && (!full || r.score < full.score)) full = r;
    }
    if (!full) {
      /* aucune répartition de tout le panier en k commandes au plus : on laisse des produits de côté (1 000 € chacun) */
      for (const sub of subsetsOfSize(M.chans, k)) {
        if (performance.now() > deadline) { truncated = true; break; }
        const r = solveSubset(sub.concat([SK]), MS, lambda, 1e7, deadline, partial ? partial.score : null);
        if (r && r.truncated) truncated = true;
        if (r && !r.none && (!partial || r.score < partial.score)) partial = r;
      }
    }
    report({ k, full, partial: full ? null : partial, truncated });
  }
  report({ done: true });
}
