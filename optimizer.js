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
function solveTargets(cost, L, m, budget) {
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
  return branchAndBound(cost, L, m, budget);
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
function branchAndBound(cost, L, m, budget) {
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
  let best = Infinity, bestPick = null, nodes = 0, truncated = false;
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
    if (++nodes > budget) { truncated = true; return; }
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
function solveSubset(sub, M, lambda, budget) {
  const n = M.lines.length, m = sub.length;
  const pos = new Map(sub.map((c, i) => [c, i]));
  const cost = [];
  for (let l = 0; l < n; l++) {
    const row = new Array(m).fill(-1); let any = false;
    for (const of of M.offers[l]) if (pos.has(of.c)) { row[pos.get(of.c)] = of.cost; any = true; }
    if (!any) return null;
    cost.push(row);
  }
  const P = sub.map((c) => M.chans[c].P);
  const spec = []; for (let k = 0; k < m; k++) if (isSpecial(P[k])) spec.push(k);
  const opt = spec.map((k) => tierOptions(P[k]));
  const idx = spec.map(() => 0);
  let best = null, truncated = false;
  for (;;) {
    const L = new Array(m).fill(0);
    spec.forEach((k, s) => { L[k] = opt[s][idx[s]]; });
    const r = solveTargets(cost, L, m, budget);
    if (r && r.truncated) truncated = true;
    if (r && r.assign) {
      const orders = sub.map((c) => ({ ch: M.chans[c], items: [], sub: 0, fee: 0 }));
      for (let i = 0; i < n; i++) { const k = r.assign[i]; const of = M.offers[i].find((x) => x.c === sub[k]); orders[k].items.push({ l: M.lines[i], ...of }); orders[k].sub += of.cost; }
      const used = orders.filter((o) => o.items.length && !o.ch.skip);
      const skipped = [];
      orders.forEach((o) => { if (o.ch.skip) skipped.push(...o.items); });
      let ok = used.length > 0, fees = 0, items = 0;
      for (const o of used) { if (o.sub < o.ch.P.min) { ok = false; break; } o.fee = feeAt(o.ch.P, o.sub); fees += o.fee; items += o.sub; }
      if (ok) {
        const extra = lambda * Math.max(0, used.length - 1);
        const total = items + fees + extra;
        const score = total + skipped.reduce((a, x) => a + x.cost, 0);
        if (!best || score < best.score) {
          used.forEach((o) => o.items.sort((a, b) => (a.l.n ?? 0) - (b.l.n ?? 0)));
          used.sort((a, b) => b.sub - a.sub);
          best = { orders: used, skipped, total, score, itemsTotal: items, feesTotal: fees, extra };
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
function optimise(M, K, lambda) {
  const t0 = performance.now();
  const byK = {}; let truncated = false, count = 0;
  if (!M.lines.length || !M.chans.length) return { best: null, byK, truncated, count, ms: 0 };
  for (const sub of subsets(M.chans, K)) {
    const r = solveSubset(sub, M, lambda, 300000);
    count++;
    if (r && r.truncated) truncated = true;
    if (r && !r.none) { const k = r.orders.length; if (!byK[k] || r.score < byK[k].score) byK[k] = r; }
    if (performance.now() - t0 > 5000) { truncated = true; break; }
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
