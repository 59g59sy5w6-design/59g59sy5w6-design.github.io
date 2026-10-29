/* Cabas : catalogue, recherche, fiche produit, panier réparti entre enseignes, listes et réglages.
   Les prix viennent de data/*.json ; le panier, les listes et les réglages restent dans le navigateur. */
(() => {
  "use strict";

  /* ---------- outils ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/œ/g, "oe").replace(/æ/g, "ae").replace(/[^a-z0-9]+/g, " ").trim();
  const NB = " ";
  const eur = (v) => (Math.round(v * 100) / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + NB + "€";
  const eurC = (c) => eur(c / 100);
  const eurR = (v) => (Math.abs(v - Math.round(v)) < 0.005 ? Math.round(v).toLocaleString("fr-FR") + NB + "€" : eur(v));
  const ic = (n, cls) => `<svg class="ic ${cls || ""}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const plural = (n, one, many) => n.toLocaleString("fr-FR") + NB + (n > 1 ? many : one);
  const dateFr = (iso) => { try { return new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }); } catch (e) { return iso; } };
  const dayKey = (d) => d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate();
  /* « aujourd'hui à 14h17 », « hier à 9h05 », « le 28 octobre à 14h17 » */
  function whenFr(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    const hm = d.getHours() + "h" + String(d.getMinutes()).padStart(2, "0");
    const now = new Date(), y = new Date(now.getTime() - 86400000);
    if (dayKey(d) === dayKey(now)) return "aujourd'hui à " + hm;
    if (dayKey(d) === dayKey(y)) return "hier à " + hm;
    return "le " + d.toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) + " à " + hm;
  }
  const joinEt = (a) => (a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " et " + a[a.length - 1]);
  const store = {
    get(k, d) { try { const v = localStorage.getItem("cabas." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("cabas." + k, JSON.stringify(v)); } catch (e) { /* stockage indisponible : l'appli continue sans mémoire */ } },
  };
  function px(v, cls) {
    const c = Math.round(v * 100), e = Math.floor(c / 100), ct = String(c % 100).padStart(2, "0");
    return `<span class="px ${cls || ""}"><span class="sr">${eur(v)}</span><span aria-hidden="true">${e}<span class="pc">,${ct}${NB}€</span></span></span>`;
  }
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = () => (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;

  /* ---------- état ---------- */
  const PREFS0 = { zip: "", off: {}, fee: {}, maxOrders: 3, extraCost: 0 };
  const ROOTS = { accueil: "#/", rayons: "#/rayons", recherche: "#/recherche", listes: "#/listes", panier: "#/panier" };
  const S = {
    ready: false, failed: false,
    rayons: [], prods: new Map(), list: [], rets: [], retMap: new Map(), meta: {},
    basket: store.get("basket", {}),
    prefs: Object.assign({}, PREFS0, store.get("prefs", {})),
    lists: store.get("lists", []),
    recent: store.get("recent", []),
    seen: store.get("seen", {}),
    tab: "accueil",
    stacks: { accueil: ["#/"], rayons: ["#/rayons"], recherche: ["#/recherche"], listes: ["#/listes"], panier: ["#/panier"] },
    cur: "", dir: "none", scroll: {}, shown: {}, lazy: {}, filt: {}, q: "", route: { name: "home" }, focusSearch: false,
  };
  const saveBasket = () => store.set("basket", S.basket);
  const savePrefs = () => { store.set("prefs", S.prefs); };
  const saveLists = () => store.set("lists", S.lists);

  /* ---------- données ---------- */
  const retName = (id) => (S.retMap.get(id) || {}).name || id;
  const retOn = (id) => S.retMap.has(id) && !S.prefs.off[id];
  function offers(p, onlyOn) {
    const out = [];
    for (const id of Object.keys(p.offers || {})) {
      const o = p.offers[id];
      if (!o || !(o.price > 0) || !S.retMap.has(id)) continue;
      if (onlyOn && !retOn(id)) continue;
      out.push(Object.assign({ ret: id }, o));
    }
    return out.sort((a, b) => a.price - b.price || (S.retMap.get(a.ret).order - S.retMap.get(b.ret).order));
  }
  const best = (p) => offers(p, true)[0] || null;
  function perUnit(p, price) {
    const q = p.qty;
    if (!q || !q.v || !price) return null;
    return q.u === "pc" ? price / q.v : price / (q.v / 1000);
  }
  function unitPrice(p, price) {
    const per = perUnit(p, price);
    if (per == null) return "";
    const lab = p.qty.lab || (p.qty.u === "g" ? "kg" : p.qty.u === "ml" ? "L" : "unité");
    return per.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + NB + "€/" + lab;
  }
  const inZone = () => /^(75|77|78|91|92|93|94|95)\d{3}$/.test(S.prefs.zip || "");
  const rayon = (id) => S.rayons.find((r) => r.id === id);
  const hp = (id) => "#/produit/" + encodeURIComponent(id);
  const hr = (id) => "#/rayon/" + encodeURIComponent(id);
  const count = () => Object.keys(S.basket).reduce((a, id) => a + (S.basket[id] > 0 && (!S.ready || S.prods.has(id)) ? S.basket[id] : 0), 0);
  function subtotal() {
    let t = 0;
    for (const id of Object.keys(S.basket)) { const p = S.prods.get(id); const b = p && best(p); if (b) t += b.price * S.basket[id]; }
    return t;
  }
  const img = (p, w) => `<img src="${Packs.url(p)}" alt="" width="${w || 240}" height="${w || 240}" decoding="async"${w && w < 100 ? "" : ' loading="lazy"'}>`;

  /* heure de la dernière vérification des prix, par enseigne (data/status.json, écrit par le robot de relevé) */
  function lastCheck(ret) {
    const r = (S.status && S.status.retailers) || {};
    if (ret) return (r[ret] || {}).checkedAt || null;
    let best = null;
    for (const k of Object.keys(r)) { const t = r[k].checkedAt; if (t && (!best || t > best)) best = t; }
    return best;
  }
  function offerWhen(o) {
    const t = lastCheck(o.ret);
    if (t && t.slice(0, 10) === o.at) return "Vérifié " + whenFr(t);
    return "Relevé le " + dateFr(o.at);
  }
  const recent = (t) => t && Date.now() - new Date(t).getTime() < 26 * 3600 * 1000;
  /* « Prix vérifiés aujourd'hui à 15h08 (Houra : 28 octobre) » : les enseignes pas relues récemment sont nommées avec leur date */
  function freshText() {
    let best = null;
    const late = [];
    for (const r of S.rets) {
      const t = lastCheck(r.id);
      if (recent(t)) { if (!best || t > best) best = t; }
      else if (S.retDate && S.retDate[r.id]) late.push(r.name + "\u00a0: " + dateFr(S.retDate[r.id]).replace(/ \d{4}$/, ""));
    }
    if (!best) return "Prix relevés le " + dateFr(S.meta.updatedAt);
    return "Prix vérifiés " + whenFr(best) + (late.length ? " (" + late.join(", ") + ")" : "");
  }
  const isStale = () => !S.rets.some((r) => recent(lastCheck(r.id)));

  async function load() {
    const get = (u) => fetch(u, { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); });
    const [c, r, m, st] = await Promise.all([get("data/catalog.json"), get("data/retailers.json"), get("data/meta.json"), get("data/status.json").catch(() => null)]);
    S.status = st || {};
    S.loadedAt = Date.now();
    S.rayons = c.rayons.slice().sort((a, b) => a.order - b.order);
    S.list = c.products;
    S.prods = new Map();
    S.list.forEach((p, i) => { p.rank = i; S.prods.set(p.id, p); });
    S._sug = null;
    RES.key = "";
    S.rets = r.slice().sort((a, b) => a.order - b.order);
    S.retMap = new Map(S.rets.map((x) => [x.id, x]));
    S.meta = m || {};
    S.retDate = {};
    for (const p of S.list) for (const k of Object.keys(p.offers || {})) { const d = p.offers[k].at; if (d && (!S.retDate[k] || d > S.retDate[k])) S.retDate[k] = d; }
    /* un produit qui a changé d'identifiant d'un relevé à l'autre est suivi grâce à c.aliases ;
       un produit absent du relevé reste dans le panier et les listes, sans compter, jusqu'à son retour */
    S.alias = c.aliases || {};
    const follow = (o) => {
      let ch = false;
      for (const id of Object.keys(o)) {
        const q = o[id], to = S.alias[id];
        if (!(q > 0)) { delete o[id]; ch = true; }
        else if (!S.prods.has(id) && to && S.prods.has(to)) { o[to] = Math.min(99, (o[to] || 0) + q); delete o[id]; ch = true; }
      }
      return ch;
    };
    if (follow(S.basket)) saveBasket();
    if (S.lists.map((L) => follow(L.items || {})).some(Boolean)) saveLists();
    const rn = new Map(S.rayons.map((x) => [x.id, x.name]));
    for (const p of S.list) {
      p._b = norm(p.brand);
      p._w = (p._b + " " + norm(p.name) + " " + norm(p.format) + " " + norm(rn.get(p.r)) + " " + norm((p.tags || []).join(" "))).split(" ").filter(Boolean);
    }
  }

  /* ---------- recherche ---------- */
  const stem = (w) => (w.length > 3 ? w.replace(/(x|s)$/, "") : w);
  const SYN = { pq: ["papier", "toilette"], coca: ["coca"], sopalin: ["essuie"], yaourt: ["yaourt"], yoghourt: ["yaourt"], yogourt: ["yaourt"], cafe: ["cafe"], emmenthal: ["emmental"], parmesan: ["parmigiano"] };
  function search(q) {
    let toks = norm(q).split(" ").filter(Boolean);
    toks = toks.flatMap((t) => SYN[t] || [t]).map(stem);
    if (!toks.length) return [];
    const out = [];
    for (const p of S.list) {
      let score = 0, ok = true;
      for (const t of toks) {
        let b = 0;
        for (const w of p._w) {
          if (w === t || stem(w) === t) { b = 3; break; }
          if (w.startsWith(t)) b = Math.max(b, 2);
          else if (t.length >= 4 && w.includes(t)) b = Math.max(b, 1);
        }
        if (!b) { ok = false; break; }
        score += b;
      }
      if (!ok) continue;
      if (p._b.startsWith(toks[0])) score += 2;
      score += Math.min(2, Object.keys(p.offers).length - 1) * 0.6;
      out.push([score, p]);
    }
    out.sort((a, b) => b[0] - a[0] || a[1].rank - b[1].rank);
    return out.map((x) => x[1]);
  }
  function addRecent(q) {
    q = String(q || "").trim();
    if (q.length < 2) return;
    S.recent = [q].concat(S.recent.filter((x) => norm(x) !== norm(q))).slice(0, 8);
    store.set("recent", S.recent);
  }

  /* ---------- filtres ---------- */
  const SORTS = [["pertinence", "Pertinence"], ["prix", "Prix croissant"], ["prixdesc", "Prix décroissant"], ["unite", "Prix au kilo ou au litre"], ["ecart", "Plus gros écart entre enseignes"], ["nom", "Nom"]];
  function F(key) { return S.filt[key] || (S.filt[key] = { sort: "pertinence", ret: {}, brand: {}, tags: {}, type: "all", cmp: false, promo: false, max: "", bq: "" }); }
  function nActive(f) {
    return Object.values(f.ret).filter(Boolean).length + Object.values(f.brand).filter(Boolean).length + Object.values(f.tags).filter(Boolean).length + (f.type !== "all" ? 1 : 0) + (f.cmp ? 1 : 0) + (f.promo ? 1 : 0) + (parseFloat(String(f.max).replace(",", ".")) > 0 ? 1 : 0);
  }
  function applyFilters(list, f, keepOrder) {
    const rs = Object.keys(f.ret).filter((k) => f.ret[k]);
    const bs = Object.keys(f.brand).filter((k) => f.brand[k]);
    const ts = Object.keys(f.tags).filter((k) => f.tags[k]);
    const maxP = parseFloat(String(f.max).replace(",", "."));
    let out = list.filter((p) => {
      if (rs.length && !rs.some((r) => p.offers[r] && p.offers[r].price > 0)) return false;
      if (bs.length && !f.brand[p.brand]) return false;
      if (f.type === "nb" && p.type === "mdd") return false;
      if (f.type === "mdd" && p.type !== "mdd") return false;
      if (f.cmp && offers(p, false).length < 2) return false;
      if (ts.length && !ts.every((t) => (p.tags || []).includes(t))) return false;
      if (f.promo && !offers(p, true).some((o) => o.promo)) return false;
      if (maxP > 0) { const b = best(p); if (!b || b.price > maxP) return false; }
      return true;
    });
    const price = (p) => { const b = best(p); return b ? b.price : 1e9; };
    const unit = (p) => { const b = best(p); const v = b ? perUnit(p, b.price) : null; return v == null ? 1e9 : v; };
    const gap = (p) => { const o = offers(p, true); return o.length > 1 ? o[o.length - 1].price - o[0].price : -1; };
    const s = f.sort;
    if (s === "prix") out.sort((a, b) => price(a) - price(b));
    else if (s === "prixdesc") out.sort((a, b) => price(b) - price(a));
    else if (s === "unite") out.sort((a, b) => unit(a) - unit(b));
    else if (s === "ecart") out.sort((a, b) => gap(b) - gap(a));
    else if (s === "nom") out.sort((a, b) => (a.brand + " " + a.name).localeCompare(b.brand + " " + b.name, "fr"));
    else if (!keepOrder) out.sort((a, b) => a.rank - b.rank);
    return out;
  }

  /* ---------- panier : modèle et calcul ---------- */
  function tiersOf(r) {
    const ch = r.channel || {}, ov = S.prefs.fee[r.id] || {};
    const base = ov.base != null ? ov.base : (ch.tiers && ch.tiers[0] ? ch.tiers[0].fee : 0);
    return (ch.tiers && ch.tiers.length ? ch.tiers : [{ from: 0, fee: 0 }]).map((t, i) => ({ from: t.from || 0, fee: i === 0 ? base : t.half ? base / 2 : t.fee || 0 })).sort((a, b) => a.from - b.from);
  }
  function channels() {
    const out = [];
    for (const r of S.rets) {
      if (!retOn(r.id) || !r.channel) continue;
      const ch = r.channel;
      out.push({ id: r.id, store: { retailer: r.id }, P: { min: Math.round((ch.minOrder || 0) * 100), fixed: Math.round((ch.fixedFee || 0) * 100), tiers: tiersOf(r).map((t) => ({ from: Math.round(t.from * 100), fee: Math.round(t.fee * 100) })) } });
    }
    return out;
  }
  function model() {
    const chans = channels();
    const lines = [], offs = [], uncovered = [];
    let n = 0;
    for (const id of Object.keys(S.basket)) {
      const q = S.basket[id], p = S.prods.get(id);
      if (!p || !(q > 0)) continue;
      const o = [];
      chans.forEach((ch, ci) => { const x = p.offers[ch.id]; if (x && x.price > 0) o.push({ c: ci, cost: Math.round(x.price * 100) * q }); });
      if (o.length) { lines.push({ id, q, n: n++ }); offs.push(o); } else uncovered.push(id);
    }
    return { lines, offers: offs, chans, uncovered };
  }
  const RES = { key: "", M: null, R: null, K: 3, pending: false };
  let W = null, wSeq = 0, wBusy = false;
  function cartResult() {
    const key = JSON.stringify([S.basket, S.prefs.off, S.prefs.fee, S.prefs.maxOrders, S.prefs.extraCost]);
    if (RES.key === key) return RES;
    const M = model();
    const K = Math.max(1, Math.min(M.chans.length || 1, S.prefs.maxOrders || 3));
    const lambda = Math.round((S.prefs.extraCost || 0) * 100);
    Object.assign(RES, { key, M, K, lambda });
    if (!M.lines.length) { RES.R = { best: null, byK: {}, truncated: false, partial: false }; RES.pending = false; return RES; }
    if (M.lines.length <= 28 || typeof Worker === "undefined") { RES.R = solve(M, K, lambda); RES.pending = false; return RES; }
    RES.R = null; RES.pending = true;
    const seq = ++wSeq;
    try {
      if (W && wBusy) { W.terminate(); W = null; }
      if (!W) {
        W = new Worker("worker.js");
        W.onmessage = (ev) => { wBusy = false; if (ev.data.seq !== wSeq) return; RES.R = ev.data.R; RES.pending = false; if (S.route.name === "panier") rerender(); };
        W.onerror = () => { wBusy = false; W = null; if (RES.pending) { RES.R = solve(RES.M, RES.K, RES.lambda); RES.pending = false; if (S.route.name === "panier") rerender(); } };
      }
      wBusy = true;
      W.postMessage({ seq, M, K, lambda });
    } catch (err) { RES.R = solve(M, K, lambda); RES.pending = false; }
    return RES;
  }
  function nextTier(ch, sub) {
    const P = ch.P, cur = feeAt(P, sub);
    for (const t of P.tiers) if (t.from > sub) { const f2 = feeAt(P, t.from); if (f2 < cur) return { need: t.from - sub, fee: f2 - P.fixed }; }
    return null;
  }

  /* ---------- composants ---------- */
  function buyCtl(id, v) {
    const q = S.basket[id] || 0, p = S.prods.get(id);
    const nm = p ? esc(p.brand + " " + p.name) : "";
    if (v === "bar") {
      const b = p && best(p);
      if (q > 0) return `<div class="buybar" data-buy="${esc(id)}" data-v="bar"><div class="stepper" role="group" aria-label="Quantité"><button type="button" data-act="dec" data-id="${esc(id)}" aria-label="Retirer un">${ic(q > 1 ? "minus" : "trash")}</button><span aria-live="polite">${q}</span><button type="button" data-act="inc" data-id="${esc(id)}" aria-label="Ajouter un">${ic("plus")}</button></div><a class="btn" href="#/panier" data-tab="panier">Voir le panier</a></div>`;
      return `<div class="buybar" data-buy="${esc(id)}" data-v="bar"><button type="button" class="btn" data-act="inc" data-id="${esc(id)}"${b ? "" : " disabled"}>Ajouter au panier${b ? ` <span class="sub">${eur(b.price)}</span>` : ""}</button></div>`;
    }
    if (q > 0 || v === "item") return `<div class="stepper${v === "flat" ? " flat" : ""}${v === "item" ? " soft" : ""}" data-buy="${esc(id)}" data-v="${v}" role="group" aria-label="Quantité de ${nm}"><button type="button" data-act="dec" data-id="${esc(id)}" aria-label="Retirer un">${ic(q > 1 ? "minus" : "trash")}</button><span aria-live="polite">${q}</span><button type="button" data-act="inc" data-id="${esc(id)}" aria-label="Ajouter un">${ic("plus")}</button></div>`;
    return `<button type="button" class="add${v === "flat" ? " flat" : ""}" data-buy="${esc(id)}" data-v="${v}" data-act="inc" data-id="${esc(id)}" aria-label="Ajouter ${nm} au panier">${ic("plus")}</button>`;
  }
  function card(p) {
    const b = best(p), n = offers(p, false).length;
    const badge = b && b.promo ? '<span class="badge promo">Offre</span>' : n > 1 ? `<span class="badge">${n} enseignes</span>` : "";
    const u = b ? unitPrice(p, b.price) : "";
    return `<article class="card"><div class="tile"><a class="cover" href="${hp(p.id)}" aria-label="${esc(p.brand + " " + p.name + ", " + p.format)}">${img(p)}</a>${badge}${b ? buyCtl(p.id, "tile") : ""}</div>` +
      `<a class="meta" href="${hp(p.id)}" tabindex="-1" aria-hidden="true"><div class="prow">${b ? px(b.price) + (u ? `<span class="unit">${u}</span>` : "") : '<span class="na">Pas dans tes enseignes</span>'}</div>` +
      (b ? `<div class="where">chez ${esc(retName(b.ret))}</div>` : "") +
      `<div class="pname"><b>${esc(p.brand)}</b> ${esc(p.name)}</div><div class="pfmt">${esc(p.format)}</div></a></article>`;
  }
  function deals(n) {
    const out = [];
    for (const p of S.list) {
      const os = offers(p, true);
      if (os.length < 2) continue;
      const hi = os[os.length - 1].price, gap = hi - os[0].price, rel = gap / hi;
      if (rel < 0.15 || gap < 0.5) continue;
      out.push({ p, os, gap, rel });
    }
    out.sort((a, b) => b.gap * Math.sqrt(b.rel) - a.gap * Math.sqrt(a.rel));
    const per = {}, res = [];
    for (const d of out) { per[d.p.r] = (per[d.p.r] || 0) + 1; if (per[d.p.r] > 2) continue; res.push(d); if (res.length >= n) break; }
    return res;
  }
  function dealCard(d) {
    const p = d.p, missing = S.rets.filter((r) => retOn(r.id) && !d.os.some((o) => o.ret === r.id));
    const rows = d.os.map((o, i) => `<li class="${i === 0 ? "low" : ""}"><span>${esc(retName(o.ret))}</span>${i === 0 ? `<span class="sticker">${eur(o.price)}</span>` : `<span class="num">${eur(o.price)}</span>`}</li>`).join("") +
      missing.map((r) => `<li class="nr"><span>${esc(r.name)}</span><span>non relevé</span></li>`).join("");
    return `<article class="deal"><div class="dh"><a class="di" href="${hp(p.id)}" aria-label="${esc(p.brand + " " + p.name)}">${img(p)}</a><div class="dtx"><a class="dt" href="${hp(p.id)}"><b>${esc(p.brand)}</b> ${esc(p.name)}</a><div class="pfmt">${esc(p.format)}</div></div></div>` +
      `<ul class="ladder">${rows}</ul><div class="df"><span class="gap"><span>${eur(d.gap)}</span> d'écart</span>${buyCtl(p.id, "flat")}</div></article>`;
  }
  function catTile(r) {
    const rep = S.list.find((p) => p.r === r.id && offers(p, false).length > 1) || S.list.find((p) => p.r === r.id);
    return `<a class="cat" href="${hr(r.id)}"><span class="ct">${rep ? img(rep, 160) : ""}</span><span>${esc(r.name)}</span></a>`;
  }
  function suggestion() {
    if (S._sug) return S._sug;
    const want = ["eaux", "lait", "pates", "cafe", "yaourts", "fromages", "jus", "papier", "vaisselle", "lessive"];
    const items = {};
    for (const r of want) {
      const p = S.list.find((x) => x.r === r && offers(x, false).length >= 3) || S.list.find((x) => x.r === r && offers(x, false).length >= 2);
      if (p) items[p.id] = r === "eaux" ? 2 : 1;
    }
    S._sug = { id: "essentiel", name: "L'essentiel de la semaine", items };
    return S._sug;
  }
  function estimate(items) {
    let t = 0, n = 0;
    for (const id of Object.keys(items)) { const p = S.prods.get(id); if (!p) continue; n++; const b = best(p); if (b) t += b.price * items[id]; }
    return { t, n };
  }
  function suggestCard(sg) {
    const ids = Object.keys(sg.items).filter((id) => S.prods.has(id));
    const e = estimate(sg.items);
    return `<div class="suggest"><div class="stack">${ids.slice(0, 6).map((id) => `<span>${img(S.prods.get(id), 52)}</span>`).join("")}</div><div><h3>${esc(sg.name)}</h3><p>${plural(e.n, "produit", "produits")} du quotidien vendus dans plusieurs enseignes, environ ${eur(e.t)} au meilleur prix.</p></div><div class="btns"><button class="btn" type="button" data-act="addlist" data-id="${esc(sg.id)}">${ic("plus")}Tout ajouter au panier</button><a class="btn tint" href="#/suggestion">Voir les produits</a></div></div>`;
  }
  function installCard() {
    if (standalone() || S.seen.install || !isIOS) return "";
    return `<div class="install"><svg class="logo" aria-hidden="true"><use href="#i-logo"/></svg><div><b>Installe Cabas sur ton iPhone</b>Touche ${ic("share")} en bas de Safari, puis «\u00a0Sur l'écran d'accueil\u00a0».</div><button class="x" type="button" data-act="hideinstall" aria-label="Masquer">${ic("x")}</button></div>`;
  }
  function footNote() {
    return `<p class="foot">${plural(S.list.length, "produit", "produits")} de ${esc(joinEt(S.rets.map((r) => r.service)))}. ${esc(freshText())}.<br><a href="#/apropos">À propos des prix</a></p>`;
  }
  function chipsHtml(key, base) {
    const f = F(key), n = nActive(f);
    const has = (fn) => base.some(fn);
    const sortL = (SORTS.find((s) => s[0] === f.sort) || SORTS[0])[1];
    let s = `<div class="chips" role="toolbar" aria-label="Trier et filtrer"><button class="chip" type="button" data-act="sort" data-k="${esc(key)}" aria-pressed="${f.sort !== "pertinence"}">${ic("sort")}${f.sort === "pertinence" ? "Trier" : esc(sortL)}</button>`;
    s += `<button class="chip" type="button" data-act="filters" data-k="${esc(key)}" aria-pressed="false">${ic("filter")}Filtres${n ? `<span class="n">${n}</span>` : ""}</button>`;
    if (has((p) => Object.keys(p.offers).length > 1)) s += `<button class="chip" type="button" data-act="quick" data-q="cmp" data-k="${esc(key)}" aria-pressed="${f.cmp}">Comparés</button>`;
    if (has((p) => Object.values(p.offers).some((o) => o.promo))) s += `<button class="chip" type="button" data-act="quick" data-q="promo" data-k="${esc(key)}" aria-pressed="${f.promo}">Offres</button>`;
    if (has((p) => (p.tags || []).includes("Bio"))) s += `<button class="chip" type="button" data-act="quick" data-q="bio" data-k="${esc(key)}" aria-pressed="${!!f.tags.Bio}">Bio</button>`;
    if (has((p) => p.type === "mdd")) s += `<button class="chip" type="button" data-act="quick" data-q="mdd" data-k="${esc(key)}" aria-pressed="${f.type === "mdd"}">Marques distributeur</button>`;
    return s + "</div>";
  }
  function lazyGrid(key, items, step) {
    step = step || 24;
    S.lazy[key] = items;
    const n = Math.min(items.length, Math.max(step, S.shown[key] || step));
    S.shown[key] = n;
    return `<div class="grid" data-lazy="${esc(key)}">${items.slice(0, n).map(card).join("")}</div>${items.length > n ? `<div class="more" data-more="${esc(key)}"></div>` : ""}`;
  }
  let lazyObs = null;
  function mountLazy() {
    if (lazyObs) lazyObs.disconnect();
    const sentinels = $$("[data-more]");
    if (!sentinels.length || !("IntersectionObserver" in window)) return;
    lazyObs = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const key = en.target.dataset.more, items = S.lazy[key] || [], grid = $(`[data-lazy="${CSS.escape(key)}"]`);
        if (!grid) continue;
        const n0 = S.shown[key] || 0, n1 = Math.min(items.length, n0 + 24);
        grid.insertAdjacentHTML("beforeend", items.slice(n0, n1).map(card).join(""));
        S.shown[key] = n1;
        if (n1 >= items.length) { lazyObs.unobserve(en.target); en.target.remove(); }
      }
    }, { rootMargin: "900px 0px" });
    sentinels.forEach((s) => lazyObs.observe(s));
  }
  const emptyArt = (n) => `<div class="art">${ic(n)}</div>`;
  const notFound = () => ({ title: "Introuvable", html: `<div class="empty">${emptyArt("search")}<h2>Produit introuvable</h2><p>Ce produit n'est plus dans le catalogue. Les prix sont mis à jour à chaque relevé.</p><a class="btn" href="#/">Revenir à l'accueil</a></div>` });

  /* ---------- écrans ---------- */
  const VIEWS = {};

  VIEWS.home = () => {
    const ds = deals(8);
    const all3 = S.list.filter((p) => offers(p, true).length >= 3).slice(0, 14);
    const tiles = S.rayons.slice(0, 7).map(catTile).join("") + `<a class="cat" href="#/rayons"><span class="ct all">${ic("grid")}</span><span>Tous les rayons</span></a>`;
    const sg = suggestion();
    return {
      title: "",
      left: `<button class="loc" type="button" data-act="zip">${ic("pin")}<span>${S.prefs.zip ? "Livraison à " + esc(S.prefs.zip) : "Où te livrer\u00a0?"}</span>${ic("down", "chev")}</button>`,
      right: `<a class="icbtn" href="#/reglages" aria-label="Réglages">${ic("gear")}</a>`,
      html: `<h1 class="lt wordmark"><svg aria-hidden="true"><use href="#i-logo"/></svg>Cabas</h1>` +
        `<div class="srow"><button class="search" type="button" data-act="gosearch">${ic("search")}<span>Produits, marques</span></button></div>` +
        `<p class="fresh${isStale() ? " old" : ""}">${ic("clock")}<span>${esc(freshText())}${isStale() ? ", ils ont pu changer depuis" : ""}</span></p>` +
        installCard() +
        (ds.length ? `<div class="sh"><h2>Même produit, pas le même prix</h2></div><div class="rail deals">${ds.map(dealCard).join("")}</div>` : "") +
        `<div class="sh"><h2>Rayons</h2><a href="#/rayons">Tout voir</a></div><div class="cats">${tiles}</div>` +
        (all3.length ? `<div class="sh"><h2>Comparés dans ${S.rets.length > 3 ? "plusieurs" : "les " + S.rets.length} enseignes</h2></div><div class="rail">${all3.map(card).join("")}</div>` : "") +
        (Object.keys(sg.items).length ? `<div class="sh"><h2>Panier tout prêt</h2></div>${suggestCard(sg)}` : "") +
        footNote(),
    };
  };

  VIEWS.rayons = () => {
    const groups = [];
    for (const r of S.rayons) { let g = groups.find((x) => x.name === r.aisle); if (!g) groups.push((g = { name: r.aisle, items: [] })); g.items.push(r); }
    const row = (r) => {
      const all = S.list.filter((p) => p.r === r.id), cmp = all.filter((p) => offers(p, false).length > 1).length;
      const rep = all.find((p) => offers(p, false).length > 1) || all[0];
      return `<a class="row th" href="${hr(r.id)}"><span class="thumb">${rep ? img(rep, 48) : ""}</span><span class="rt">${esc(r.name)}<small>${plural(all.length, "produit", "produits")}${cmp ? ", dont " + cmp + " comparés" : ""}</small></span>${ic("chev", "chev")}</a>`;
    };
    return { title: "Rayons", grouped: true, html: `<h1 class="lt">Rayons</h1>` + groups.map((g) => `<h2 class="gh big">${esc(g.name)}</h2><div class="group">${g.items.map(row).join("")}</div>`).join("") + footNote() };
  };

  VIEWS.rayon = (r) => {
    const ray = rayon(r.id);
    if (!ray) return notFound();
    const key = "r:" + ray.id, f = F(key);
    const base = S.list.filter((p) => p.r === ray.id);
    const list = applyFilters(base, f);
    const cmp = base.filter((p) => offers(p, false).length > 1).length;
    return {
      title: ray.name,
      html: `<h1 class="lt">${esc(ray.name)}</h1><p class="lt-sub">${plural(base.length, "produit", "produits")}${cmp ? ", dont " + cmp + " vendus dans plusieurs enseignes" : ""}</p>` + chipsHtml(key, base) +
        (list.length !== base.length ? `<p class="count">${plural(list.length, "produit correspond", "produits correspondent")} à tes filtres</p>` : "") +
        (list.length ? lazyGrid(key, list) : `<div class="empty">${emptyArt("filter")}<h2>Aucun produit</h2><p>Aucun produit de ce rayon ne correspond à tes filtres.</p><button class="btn plain" type="button" data-act="freset" data-k="${esc(key)}">Effacer les filtres</button></div>`) + footNote(),
      mount: mountLazy,
    };
  };

  VIEWS.produit = (r) => {
    const p = S.prods.get(r.id) || S.prods.get((S.alias || {})[r.id]);
    if (!p) return notFound();
    const all = offers(p, false), on = offers(p, true), b = on[0] || null;
    const ray = rayon(p.r);
    const hi = on.length > 1 ? on[on.length - 1] : null;
    const u = b ? unitPrice(p, b.price) : "";
    const rows = all.map((o, i) => {
      const off = !retOn(o.ret), low = b && o.ret === b.ret && on.length > 1;
      return `<a class="row offer${off ? " off" : ""}" href="${esc(o.url)}" target="_blank" rel="noopener"><span class="av">${esc(retName(o.ret).slice(0, 1))}</span><span class="rt"><span class="on">${esc(retName(o.ret))}${low ? '<span class="tag-low">Le moins cher</span>' : ""}</span>` +
        `<span class="os">${esc(o.name || "")}</span><span class="os">${esc(offerWhen(o))}${o.cat ? ", page du rayon" : ""}${off ? ", enseigne désactivée" : ""}</span>${o.promo ? `<span class="os promo">Offre\u00a0: ${esc(o.promo)}</span>` : ""}</span>` +
        `<span class="op">${px(o.price)}${unitPrice(p, o.price) ? `<span class="unit">${unitPrice(p, o.price)}</span>` : ""}</span></a>`;
    }).join("");
    const toks = norm(p.name).split(" ").filter((t) => t.length > 3 && !/^\d/.test(t)).slice(0, 4);
    const sim = S.list.filter((x) => x.id !== p.id && x.r === p.r && toks.some((t) => norm(x.name).includes(t))).slice(0, 60)
      .map((x) => ({ x, b: best(x) })).filter((y) => y.b).sort((a, c) => a.b.price - c.b.price).slice(0, 10).map((y) => y.x);
    const spec = [["Marque", p.brand], ["Contenance", p.format], ["Description", p.desc && !/^Contenance/.test(p.desc) ? p.desc : ""], ["Mentions", (p.tags || []).join(", ")], ["Rayon", ray ? ray.name : ""], ["Type", p.type === "mdd" ? "Marque distributeur" + (p.mdd ? ", vendue chez " + retName(p.mdd) : "") : "Grande marque"], ["Code EAN", p.ean]].filter((x) => x[1]);
    const promo = !!(b && b.promo);
    return {
      title: p.brand + " " + p.name, anchor: ".ph h1", dock: "bar", dockId: p.id,
      right: `<button class="icbtn" type="button" data-act="share" data-id="${esc(p.id)}" aria-label="Partager">${ic("share")}</button>`,
      html: `<div class="pdp"><div class="pimg">${img(p, 480)}${promo ? '<span class="badge promo">Offre</span>' : ""}</div>` +
        `<div class="pmain"><div class="ph"><p class="pb">${esc(p.brand)}</p><h1>${esc(p.name)}</h1><p class="pf">${esc(p.format)}${u ? ", " + esc(u) : ""}</p>` +
        (b ? `<div class="pprice">${px(b.price)}${on.length > 1 ? '<span class="sticker lg">Meilleur prix</span>' : ""}<p class="pw">chez <b>${esc(retName(b.ret))}</b>${hi && hi.price - b.price >= 0.01 ? `, ${eur(hi.price - b.price)} de moins que chez ${esc(retName(hi.ret))}` : ""}</p></div>` : `<p class="pw" style="margin-top:14px">Ce produit n'est vendu par aucune de tes enseignes activées.</p>`) +
        `<div class="pinline">${buyCtl(p.id, "bar")}</div></div></div>` +
        `<div class="pmore"><h2 class="gh">Prix dans ${all.length > 1 ? "les enseignes" : "l'enseigne"}</h2><div class="group">${rows}</div><p class="gf">Touche une enseigne pour ouvrir le produit sur son site. Les offres (2e à moitié prix, cagnotte) ne sont pas déduites des totaux.</p>` +
        `<h2 class="gh">Caractéristiques</h2><div class="group"><dl class="spec">${spec.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl></div></div>` +
        (sim.length ? `<div class="pfull"><div class="sh"><h2>Dans le même rayon</h2>${ray ? `<a href="${hr(ray.id)}">Tout voir</a>` : ""}</div><div class="rail">${sim.map(card).join("")}</div></div>` : "") + `</div>`,
    };
  };

  function searchBody() {
    const q = S.q.trim();
    if (!q) {
      const brands = new Map();
      S.list.forEach((p) => { if (Object.keys(p.offers).length > 1) brands.set(p.brand, (brands.get(p.brand) || 0) + 1); });
      const top = [...brands.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map((x) => x[0]);
      return (S.recent.length ? `<div class="sh"><h2>Recherches récentes</h2><button type="button" data-act="clearrecent">Effacer</button></div><div class="group">${S.recent.map((x) => `<button class="row" type="button" data-act="setq" data-q="${esc(x)}">${ic("clock", "ext")}<span class="rt">${esc(x)}</span></button>`).join("")}</div>` : "") +
        `<div class="sh"><h2>Marques comparées</h2></div><div class="tagset">${top.map((x) => `<button class="chip" type="button" data-act="setq" data-q="${esc(x)}">${esc(x)}</button>`).join("")}</div>` +
        `<div class="sh"><h2>Rayons</h2></div><div class="cats">${S.rayons.map(catTile).join("")}</div>`;
    }
    const key = "s", f = F(key);
    const base = search(q), list = applyFilters(base, f, true);
    if (!base.length) return `<div class="empty">${emptyArt("search")}<h2>Aucun résultat</h2><p>Rien ne correspond à «\u00a0${esc(q)}\u00a0». Vérifie l'orthographe ou cherche une marque, par exemple Lactel ou Barilla.</p></div>`;
    return chipsHtml(key, base) + `<p class="count">${plural(list.length, "résultat", "résultats")}</p>` + (list.length ? lazyGrid(key, list) : `<div class="empty">${emptyArt("filter")}<h2>Aucun produit</h2><p>Aucun résultat ne correspond à tes filtres.</p><button class="btn plain" type="button" data-act="freset" data-k="s">Effacer les filtres</button></div>`);
  }
  VIEWS.recherche = () => ({
    title: "Recherche",
    html: `<h1 class="lt">Recherche</h1><div class="srow"><label class="search">${ic("search")}<input id="q" type="search" enterkeyhint="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Produits, marques" value="${esc(S.q)}" aria-label="Rechercher un produit ou une marque"><button type="button" class="clr" data-act="clearq"${S.q ? "" : " hidden"} aria-label="Effacer la recherche">${ic("xc")}</button></label></div><div id="sres">${searchBody()}</div>`,
    mount: () => { mountLazy(); if (S.focusSearch) { S.focusSearch = false; const i = $("#q"); if (i) { i.focus(); } } },
  });

  function listRow(L) {
    const ids = Object.keys(L.items).filter((id) => S.prods.has(id));
    const e = estimate(L.items);
    return `<a class="row th" href="#/liste/${esc(L.id)}"><span class="thumb">${ids[0] ? img(S.prods.get(ids[0]), 48) : ""}</span><span class="rt">${esc(L.name)}<small>${plural(e.n, "produit", "produits")}, environ ${eur(e.t)}</small></span>${ic("chev", "chev")}</a>`;
  }
  VIEWS.listes = () => {
    const n = count(), sg = suggestion();
    return {
      title: "Listes", grouped: true,
      html: `<h1 class="lt">Listes</h1>` +
        (n ? `<div class="pad" style="padding-top:4px"><button class="btn tint" type="button" data-act="savelist">${ic("plus")}Enregistrer le panier en liste</button></div>` : "") +
        (S.lists.length ? `<h2 class="gh">Mes listes</h2><div class="group">${S.lists.map(listRow).join("")}</div><p class="gf">Une liste se remet dans le panier en un geste.</p>` :
          `<div class="empty" style="padding-top:28px">${emptyArt("list")}<h2>Aucune liste</h2><p>Enregistre ton panier en liste pour le refaire la semaine prochaine en un geste.</p></div>`) +
        (Object.keys(sg.items).length ? `<h2 class="gh">Suggestion</h2>${suggestCard(sg)}` : ""),
    };
  };
  function itemsList(items) {
    return Object.keys(items).filter((id) => S.prods.has(id)).map((id) => {
      const p = S.prods.get(id), b = best(p), q = items[id];
      return `<a class="row th" href="${hp(id)}"><span class="thumb">${img(p, 48)}</span><span class="rt"><b style="font-weight:600">${esc(p.brand)}</b> ${esc(p.name)}<small>${esc(p.format)}${b ? ", " + eur(b.price) + " chez " + esc(retName(b.ret)) : ", pas dans tes enseignes"}</small></span><span class="val num">× ${q}</span></a>`;
    }).join("");
  }
  VIEWS.liste = (r) => {
    const L = S.lists.find((x) => x.id === r.id);
    if (!L) return notFound();
    const e = estimate(L.items);
    return {
      title: L.name, grouped: true,
      html: `<h1 class="lt">${esc(L.name)}</h1><p class="lt-sub">${plural(e.n, "produit", "produits")}, environ ${eur(e.t)} au meilleur prix</p>` +
        `<div class="pad btns" style="padding-top:6px"><button class="btn" type="button" data-act="addlist" data-id="${esc(L.id)}">${ic("plus")}Tout ajouter au panier</button><button class="btn tint" type="button" data-act="replacelist" data-id="${esc(L.id)}">Remplacer le panier par cette liste</button></div>` +
        `<h2 class="gh">Produits</h2><div class="group">${itemsList(L.items)}</div>` +
        `<div class="group" style="margin-top:28px"><button class="row link" type="button" data-act="renamelist" data-id="${esc(L.id)}">Renommer la liste</button><button class="row danger" type="button" data-act="dellist" data-id="${esc(L.id)}">Supprimer la liste</button></div>`,
    };
  };
  VIEWS.suggestion = () => {
    const sg = suggestion(), e = estimate(sg.items);
    return {
      title: sg.name, grouped: true,
      html: `<h1 class="lt">${esc(sg.name)}</h1><p class="lt-sub">${plural(e.n, "produit", "produits")}, environ ${eur(e.t)} au meilleur prix</p>` +
        `<div class="pad btns" style="padding-top:6px"><button class="btn" type="button" data-act="addlist" data-id="${esc(sg.id)}">${ic("plus")}Tout ajouter au panier</button><button class="btn tint" type="button" data-act="keepsug">Enregistrer dans mes listes</button></div>` +
        `<h2 class="gh">Produits</h2><div class="group">${itemsList(sg.items)}</div><p class="gf">Une sélection de produits courants vendus dans plusieurs enseignes, pour voir comment Cabas répartit un panier.</p>`,
    };
  };

  /* panier */
  function itemRow(id, cost, q) {
    const p = S.prods.get(id);
    const unit = cost / q / 100;
    return `<div class="item"><a class="thumb" href="${hp(id)}" aria-label="${esc(p.brand + " " + p.name)}">${img(p, 52)}</a><a class="it" href="${hp(id)}"><b><strong>${esc(p.brand)}</strong> ${esc(p.name)}</b><small>${esc(p.format)}${q > 1 ? ", " + eur(unit) + " l'unité" : ""}</small></a><div class="ir"><span class="lp">${cost ? eurC(cost) : "–"}</span>${buyCtl(id, "item")}</div></div>`;
  }
  function plainItems(ids) {
    return ids.map((id) => { const p = S.prods.get(id), b = best(p), q = S.basket[id]; return itemRow(id, b ? Math.round(b.price * 100) * q : 0, q); }).join("");
  }
  function orderHtml(o) {
    const r = S.retMap.get(o.ch.id), P = o.ch.P;
    const fee = o.fee - P.fixed;
    const nt = nextTier(o.ch, o.sub);
    const links = o.items.map((x) => { const p = S.prods.get(x.l.id), of = p.offers[o.ch.id]; return of && of.url ? `<li><a href="${esc(of.url)}" target="_blank" rel="noopener">${ic("ext", "ext")}<span>${esc(p.brand + " " + p.name)}${of.cat ? " (page du rayon)" : ""}</span></a></li>` : ""; }).join("");
    const nItems = o.items.reduce((a, x) => a + x.l.q, 0);
    return `<section class="order" aria-label="Commande ${esc(r.name)}"><div class="oh"><span class="av">${esc(r.name.slice(0, 1))}</span><div class="rt"><h3>${esc(r.name)}</h3><small>${plural(nItems, "article", "articles")}</small></div>${px((o.sub + o.fee) / 100)}</div>` +
      o.items.map((x) => itemRow(x.l.id, x.cost, x.l.q)).join("") +
      `<div class="of"><div class="ln"><span>Articles</span><span>${eurC(o.sub)}</span></div><div class="ln"><span>Livraison</span><span>${fee > 0 ? eurC(fee) : "Offerte"}</span></div>` +
      (P.fixed ? `<div class="ln"><span>Frais de service</span><span>${eurC(P.fixed)}</span></div>` : "") +
      `<div class="ln tot"><span>Total ${esc(r.name)}</span><span>${eurC(o.sub + o.fee)}</span></div>` +
      (nt ? `<p class="hint">Encore ${eurC(nt.need)} chez ${esc(r.name)} et la livraison ${nt.fee > 0 ? "passe à " + eurC(nt.fee) : "devient offerte"}.</p>` : "") +
      `<a class="btn" href="${esc(r.home)}" target="_blank" rel="noopener">Commander sur ${esc(r.service)}${ic("ext")}</a>` +
      (links ? `<details><summary>Retrouver chaque produit sur ${esc(r.service)}</summary><ul>${links}</ul></details>` : "") + `</div></section>`;
  }
  VIEWS.panier = () => {
    const ids = Object.keys(S.basket).filter((id) => S.basket[id] > 0 && S.prods.has(id));
    if (!ids.length) return { title: "Panier", grouped: true, html: `<h1 class="lt">Panier</h1><div class="empty">${emptyArt("bag")}<h2>Ton panier est vide</h2><p>Ajoute des produits\u00a0: Cabas cherche où les commander pour payer le moins cher, livraison comprise.</p><a class="btn" href="#/rayons">Parcourir les rayons</a></div>` };
    const res = cartResult(), M = res.M, R = res.R;
    const nRet = M.chans.length;
    const seg = nRet > 1 ? `<p class="segl">Nombre de commandes au plus</p><div class="seg" role="group" aria-label="Nombre de commandes au plus">${Array.from({ length: nRet }, (_, i) => i + 1).map((k) => `<button type="button" data-act="maxk" data-k="${k}" aria-pressed="${k === res.K}">${k}</button>`).join("")}</div>` : "";
    let side = "", main = "";
    const zipNote = !S.prefs.zip ? `<div class="note">Indique ton code postal pour vérifier que les enseignes te livrent.<button class="btn sm tint" type="button" data-act="zip" style="margin-top:10px">Indiquer mon code postal</button></div>` :
      !inZone() ? `<div class="note">Les enseignes de Cabas livrent en Île-de-France. La livraison à ${esc(S.prefs.zip)} n'est pas couverte pour l'instant\u00a0: les totaux sont indicatifs.</div>` : "";
    const uncovered = M.uncovered.length ? `<h2 class="gh">Pas dans tes enseignes</h2><div class="order" style="margin-top:0">${plainItems(M.uncovered)}<div class="of"><p class="hint" style="color:var(--ink-2)">Vendus seulement par une enseigne désactivée. Active-la dans les réglages pour les inclure.</p></div></div>` : "";
    if (res.pending || !R) {
      side = `<div class="sum loading"><p class="sl">Calcul de la meilleure répartition…</p><div class="st">${px(subtotal())}</div><p class="sh2">${plural(count(), "article", "articles")}</p>${seg}</div>`;
      main = `<div class="order">${plainItems(ids)}</div>`;
    } else if (R.best) {
      const bst = R.best, money = bst.itemsTotal + bst.feesTotal;
      const skipped = bst.skipped || [];
      const singles = M.chans.map((c, i) => Object.assign(singleBasket(M, i), { i })).map((s) => ({ s, name: S.retMap.get(s.ch.id).name, tot: s.ok && !s.missing ? s.sub + s.fee : null }));
      const full = singles.filter((x) => x.tot != null).sort((a, b) => a.tot - b.tot);
      const k = bst.orders.length, names = bst.orders.map((o) => S.retMap.get(o.ch.id).name);
      let save = "";
      if (k > 1 && full[0] && full[0].tot - money >= 1) save = `${eurC(full[0].tot - money)} de moins que tout chez ${esc(full[0].name)}`;
      else if (k === 1 && full.length > 1) { const other = full.find((x) => x.name !== names[0]); if (other && other.tot - money >= 1) save = `${eurC(other.tot - money)} de moins qu'ailleurs`; }
      const notCheapest = bst.orders.some((o) => o.items.some((x) => { const b = best(S.prods.get(x.l.id)); return b && b.ret !== o.ch.id && b.price * 100 * x.l.q < x.cost - 0.5; }));
      side = `<div class="sum"><p class="sl">${skipped.length ? `Meilleure option pour ${M.lines.length - skipped.length} produits sur ${M.lines.length}` : "Total le plus bas, livraison comprise"}</p><div class="st">${px(money / 100)}</div>` +
        `<p class="sh2">${k === 1 ? "En une commande chez " + esc(names[0]) : "En " + k + " commandes\u00a0: " + esc(joinEt(names))}</p>` +
        (save ? `<p class="sv">${save}</p>` : "") +
        (notCheapest ? `<p class="sn">Certains produits ne sont pas pris là où ils sont le moins chers\u00a0: avec les minimums d'achat et la livraison, ce regroupement revient moins cher.</p>` : "") +
        (R.truncated ? `<p class="sn">Gros panier\u00a0: le calcul a été écourté, le vrai minimum peut être un peu plus bas.</p>` : "") +
        (bst.extra ? `<p class="sn">Avec ${eurC(res.lambda)} comptés pour chaque commande en plus (réglages).</p>` : "") + seg + `</div>`;
      const opts = singles.map((x) => {
        const s = x.s;
        const sub = s.missing ? `${plural(s.missing, "produit manque", "produits manquent")}` : !s.ok ? `Minimum de ${eurC(s.ch.P.min).replace(",00", "")} non atteint, il manque ${eurC(s.ch.P.min - s.sub)}` : "";
        return `<div class="row"><span class="av sm">${esc(x.name.slice(0, 1))}</span><span class="rt">Tout chez ${esc(x.name)}${sub ? `<small>${sub}</small>` : ""}</span><span class="val num">${x.tot != null ? eurC(x.tot) : "–"}</span></div>`;
      }).join("");
      main = bst.orders.map(orderHtml).join("") +
        (skipped.length ? `<h2 class="gh">Hors commande</h2><div class="order" style="margin-top:0">${skipped.map((x) => { const p = S.prods.get(x.l.id), b = best(p); return itemRow(x.l.id, b ? Math.round(b.price * 100) * x.l.q : 0, x.l.q); }).join("")}<div class="of"><p class="hint" style="color:var(--ink-2)">Ces produits ne rentrent dans aucune commande qui atteint le minimum d'achat de leur enseigne. Ajoute d'autres produits de ces enseignes, ou choisis un équivalent vendu ailleurs.</p></div></div>` : "") +
        uncovered + (nRet > 1 ? `<h2 class="gh">Comparer</h2><div class="group">${opts}</div>` : "");
    } else {
      const singles = M.chans.map((c, i) => singleBasket(M, i)).filter((s) => s.have > 0);
      let hint = "";
      if (singles.length) {
        const g = singles.map((s) => ({ s, gap: s.ch.P.min - s.sub })).sort((x, y) => x.gap - y.gap)[0];
        if (g.gap > 0) hint = ` Chez ${esc(S.retMap.get(g.s.ch.id).name)}, ${g.s.missing ? "les produits disponibles font" : "ton panier fait"} ${eurC(g.s.sub)}\u00a0: il manque ${eurC(g.gap)} pour atteindre le minimum de ${eurC(g.s.ch.P.min).replace(",00", "")}.`;
      }
      side = `<div class="sum"><p class="sl">Pas encore de commande possible</p><div class="st">${px(subtotal())}</div><p class="sn">Chaque enseigne demande un minimum d'achat.${hint}</p>${seg}</div>`;
      main = `<div class="order">${plainItems(ids.filter((id) => !M.uncovered.includes(id)))}</div>` + uncovered;
    }
    return {
      title: "Panier", grouped: true,
      right: `<button class="txtbtn" type="button" data-act="clear">Vider</button>`,
      html: `<h1 class="lt">Panier</h1><div class="cartcols"><div class="cside">${side}${zipNote}</div><div class="cmain">${main}</div></div>` +
        `<p class="foot">${esc(freshText())}. Le total exact s'affiche sur le site de chaque enseigne au moment de commander.<br><a href="#/reglages">Livraison et frais</a></p>`,
    };
  };

  /* réglages */
  function feeShort(r) {
    const ch = r.channel || {}, T = tiersOf(r);
    const free = T.find((t) => t.fee === 0 && t.from > 0);
    return `Minimum ${eurR(ch.minOrder || 0)}, livraison ${eur(T[0].fee)}${free ? `, offerte dès ${eurR(free.from)}` : ""}${ch.fixedFee ? `, frais de service ${eur(ch.fixedFee)}` : ""}`;
  }
  VIEWS.reglages = () => {
    const K = Math.max(1, Math.min(S.rets.length, S.prefs.maxOrders || 3));
    return {
      title: "Réglages", grouped: true,
      html: `<h1 class="lt">Réglages</h1>` +
        `<h2 class="gh">Livraison</h2><div class="group"><button class="row" type="button" data-act="zip"><span class="rt">Code postal</span><span class="val">${S.prefs.zip ? esc(S.prefs.zip) : "À indiquer"}</span>${ic("chev", "chev")}</button></div>` +
        `<p class="gf">${S.prefs.zip && !inZone() ? "Les enseignes de Cabas livrent en Île-de-France : ton code postal n'est pas encore couvert." : "Les enseignes de Cabas livrent en Île-de-France. Chacune confirme ses créneaux au moment de commander."}</p>` +
        `<h2 class="gh">Enseignes</h2><div class="group">${S.rets.map((r) => `<div class="row"><a class="rt" href="#/enseigne/${esc(r.id)}" style="text-decoration:none">${esc(r.name)}<small>${esc(feeShort(r))}</small></a><label class="sw"><input type="checkbox" data-act="ret" data-id="${esc(r.id)}"${retOn(r.id) ? " checked" : ""} aria-label="Utiliser ${esc(r.name)}"><span></span></label></div>`).join("")}</div>` +
        `<p class="gf">Le panier n'utilise que les enseignes activées. Touche une enseigne pour voir ses frais et leurs sources.</p>` +
        `<h2 class="gh">Répartition du panier</h2><div class="group"><div class="row"><span class="rt">Commandes au plus</span><div class="seg" style="width:${S.rets.length * 46}px" role="group" aria-label="Nombre de commandes au plus">${S.rets.map((_, i) => `<button type="button" data-act="maxk" data-k="${i + 1}" aria-pressed="${i + 1 === K}">${i + 1}</button>`).join("")}</div></div>` +
        `<label class="row" for="extra"><span class="rt">Coût d'une commande en plus<small>Ton temps, les sacs, la réception. Sert à choisir entre une et plusieurs commandes.</small></span><input class="inl num" id="extra" type="number" inputmode="decimal" min="0" step="0.5" value="${esc(S.prefs.extraCost || 0)}"><span class="val">€</span></label></div>` +
        `<h2 class="gh">À propos</h2><div class="group"><a class="row" href="#/apropos"><span class="rt">À propos des prix</span>${ic("chev", "chev")}</a>${standalone() ? "" : `<button class="row" type="button" data-act="install"><span class="rt">Installer Cabas sur l'iPhone</span>${ic("chev", "chev")}</button>`}<div class="row"><span class="rt">Version</span><span class="val">1.1</span></div></div>` +
        `<div class="group" style="margin-top:32px"><button class="row danger" type="button" data-act="reset">Effacer mes données</button></div><p class="gf">Ton panier, tes listes et tes réglages restent sur cet appareil.</p>`,
    };
  };
  VIEWS.enseigne = (r) => {
    const R0 = S.retMap.get(r.id);
    if (!R0) return notFound();
    const ch = R0.channel || {}, T = tiersOf(R0);
    const rows = T.map((t, i) => {
      const lo = Math.max(t.from, ch.minOrder || 0), hi = T[i + 1] ? T[i + 1].from : null;
      if (hi != null && lo >= hi) return "";
      const lab = hi == null ? `Dès ${eurR(lo)}` : `De ${eurR(lo)} à ${eurR(hi)}`;
      return `<div class="row"><span class="rt">${lab}</span><span class="val num">${t.fee > 0 ? eur(t.fee) : "Offerte"}</span></div>`;
    }).join("");
    const ov = S.prefs.fee[R0.id] || {};
    const firstTo = T[1] ? T[1].from : null;
    return {
      title: R0.name, grouped: true,
      html: `<h1 class="lt">${esc(R0.name)}</h1><p class="lt-sub">${esc(R0.service)}</p>` +
        `<div class="group"><div class="row"><span class="rt">Utiliser ${esc(R0.name)}</span><label class="sw"><input type="checkbox" data-act="ret" data-id="${esc(R0.id)}"${retOn(R0.id) ? " checked" : ""} aria-label="Utiliser ${esc(R0.name)}"><span></span></label></div></div>` +
        `<h2 class="gh">Livraison à domicile</h2><div class="group"><div class="row"><span class="rt">Commande minimum</span><span class="val num">${eurR(ch.minOrder || 0)}</span></div>${rows}${ch.fixedFee ? `<div class="row"><span class="rt">Frais de service</span><span class="val num">${eur(ch.fixedFee)}</span></div>` : ""}</div>` +
        (ch.editable ? `<h2 class="gh">Ton créneau</h2><div class="group"><label class="row" for="fee-${esc(R0.id)}"><span class="rt">Frais de livraison${firstTo ? " sous " + eurR(firstTo) : ""}<small>Selon le créneau choisi. Par défaut, le prix le plus haut.</small></span><input class="inl num" id="fee-${esc(R0.id)}" type="number" inputmode="decimal" min="0" step="0.1" data-fee="${esc(R0.id)}" value="${esc(ov.base != null ? ov.base : ch.tiers[0].fee)}"><span class="val">€</span></label></div>` : "") +
        (ch.feeNote ? `<h2 class="gh">D'où viennent ces frais</h2><div class="group"><p class="prose" style="padding:12px 16px"><span>${esc(ch.feeNote)}</span></p>${(ch.sources || []).map((s) => `<a class="row link" href="${esc(s.url)}" target="_blank" rel="noopener"><span class="rt">${esc(s.label)}</span>${ic("ext", "ext")}</a>`).join("")}</div>` : "") +
        `<div class="group" style="margin-top:28px"><a class="row link" href="${esc(R0.home)}" target="_blank" rel="noopener"><span class="rt">Ouvrir ${esc(R0.service)}</span>${ic("ext", "ext")}</a></div>`,
    };
  };
  VIEWS.apropos = () => {
    const m = S.meta || {}, cov = m.coverage || {};
    return {
      title: "À propos des prix", grouped: true,
      html: `<h1 class="lt">À propos des prix</h1>` +
        `<h2 class="gh">Dernière vérification</h2><div class="group">${S.rets.map((r) => { const st = ((S.status || {}).retailers || {})[r.id] || {}; return `<div class="row"><span class="rt">${esc(r.name)}<small>${st.checkedAt ? "Vérifié " + esc(whenFr(st.checkedAt)) + (st.pages ? ", " + st.read + " page" + (st.read > 1 ? "s" : "") + " lue" + (st.read > 1 ? "s" : "") + " sur " + st.pages : "") : "Relevé du " + esc(dateFr(m.updatedAt))}</small></span><span class="val num">${plural(cov[r.id] || 0, "prix", "prix")}</span></div>`; }).join("")}<div class="row"><span class="rt">Produits vendus par plusieurs enseignes</span><span class="val num">${esc(m.multi || 0)}</span></div></div>` +
        `<h2 class="gh">Comment lire les prix</h2><div class="group"><div class="prose" style="padding:12px 16px">${(m.notes || []).map((n) => `<p>${esc(n)}</p>`).join("")}</div></div>` +
        `<p class="gf">Les pages rayon de Houra sont relues toutes les heures, celles de Monoprix et de Carrefour cinq fois par jour, entre 8h et 22h. Une page qui n'a pas pu être lue garde ses prix précédents, avec leur date. Cabas n'est lié à aucune enseigne. Les noms des enseignes et des marques appartiennent à leurs propriétaires.</p>`,
    };
  };

  /* ---------- rendu et navigation ---------- */
  function parse(h) {
    h = String(h || "").replace(/^#/, "") || "/";
    const seg = h.split("?")[0].split("/").filter(Boolean);
    const id = seg[1] ? decodeURIComponent(seg[1]) : "";
    switch (seg[0]) {
      case undefined: return { name: "home" };
      case "rayons": return { name: "rayons" };
      case "rayon": return { name: "rayon", id };
      case "produit": return { name: "produit", id };
      case "recherche": return { name: "recherche" };
      case "listes": return { name: "listes" };
      case "liste": return { name: "liste", id };
      case "suggestion": return { name: "suggestion" };
      case "panier": return { name: "panier" };
      case "reglages": return { name: "reglages" };
      case "enseigne": return { name: "enseigne", id };
      case "apropos": return { name: "apropos" };
      default: return { name: "home" };
    }
  }
  function tabOf(h) {
    if (!h || h === "#" || h === "#/") return "accueil";
    for (const t of Object.keys(ROOTS)) if (t !== "accueil" && h === ROOTS[t]) return t;
    return null;
  }
  function titleOf(h) {
    const r = parse(h);
    switch (r.name) {
      case "home": return "Accueil";
      case "rayons": return "Rayons";
      case "rayon": return (rayon(r.id) || {}).name || "Rayon";
      case "produit": return "Produit";
      case "recherche": return "Recherche";
      case "listes": return "Listes";
      case "liste": return (S.lists.find((l) => l.id === r.id) || {}).name || "Liste";
      case "suggestion": return "Suggestion";
      case "panier": return "Panier";
      case "reglages": return "Réglages";
      case "enseigne": return retName(r.id);
      case "apropos": return "À propos";
    }
    return "Retour";
  }
  function navigate(h, dir) {
    S.scroll[S.cur] = window.scrollY;
    S.dir = dir || "push";
    S.cur = h;
    if (location.hash !== h) location.hash = h;
    render();
  }
  function push(h) { const st = S.stacks[S.tab]; if (st[st.length - 1] !== h) st.push(h); navigate(h, "push"); }
  function back() {
    const st = S.stacks[S.tab];
    if (st.length > 1) { st.pop(); navigate(st[st.length - 1], "pop"); } else navigate(ROOTS[S.tab], "pop");
  }
  function switchTab(t) {
    if (S.tab === t) {
      const st = S.stacks[t];
      if (st.length > 1) { S.stacks[t] = [ROOTS[t]]; navigate(ROOTS[t], "pop"); }
      else window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    S.scroll[S.cur] = window.scrollY;
    S.tab = t;
    const st = S.stacks[t];
    navigate(st[st.length - 1], "tab");
  }
  window.addEventListener("hashchange", () => {
    const h = location.hash || "#/";
    if (h === S.cur) return;
    S.scroll[S.cur] = window.scrollY;
    const st = S.stacks[S.tab];
    if (st[st.length - 1] !== h) {
      if (st.length > 1 && st[st.length - 2] === h) { st.pop(); S.dir = "pop"; }
      else { const t = tabOf(h); if (t) { S.tab = t; S.stacks[t] = [h]; S.dir = "tab"; } else { st.push(h); S.dir = "push"; } }
    }
    S.cur = h;
    render();
  });

  let lastV = null;
  function render() {
    if (!$("#toast").hidden && S.dir !== "none") $("#toast").hidden = true;
    if (!S.ready) { if (S.failed) renderFail(); return; }
    const h = location.hash || "#/";
    S.cur = h;
    const r = parse(h);
    S.route = r;
    const V = (VIEWS[r.name] || VIEWS.home)(r) || notFound();
    lastV = V;
    document.body.classList.toggle("grouped", !!V.grouped);
    const st = S.stacks[S.tab], pushed = st.length > 1;
    let bl = pushed ? titleOf(st[st.length - 2]) : "";
    if (bl.length > 14) bl = "Retour";
    $("#navL").innerHTML = pushed ? `<button class="back" type="button" data-act="back" aria-label="Retour, ${esc(bl)}">${ic("back")}<span>${esc(bl)}</span></button>` : V.left || "";
    $("#navT").textContent = V.title || "";
    $("#navR").innerHTML = V.right || "";
    const view = $("#view");
    view.innerHTML = `<div class="wrap">${V.html}</div>`;
    view.classList.remove("enter-push", "enter-pop");
    if (S.dir === "push" || S.dir === "pop") { void view.offsetWidth; view.classList.add(S.dir === "push" ? "enter-push" : "enter-pop"); }
    renderChrome(V);
    document.title = V.title && V.title !== "Cabas" ? V.title + " – Cabas" : "Cabas";
    window.scrollTo(0, S.dir === "push" ? 0 : S.scroll[h] || 0);
    S.dir = "none";
    if (V.mount) V.mount();
    onScroll();
  }
  function rerender() { S.scroll[S.cur] = window.scrollY; S.dir = "none"; render(); }
  function miniHtml() {
    const n = count();
    if (!n) return "";
    return `<a class="mini" href="#/panier" data-tab="panier"><span class="mn">${n}</span><span class="ml">Voir le panier</span><span class="mp">${eur(subtotal())}</span></a>`;
  }
  function renderChrome(V) {
    V = V || lastV || {};
    const n = count();
    const tabs = [["accueil", "Accueil", "home"], ["rayons", "Rayons", "grid"], ["recherche", "Recherche", "search"], ["listes", "Listes", "list"], ["panier", "Panier", "bag"]];
    $("#tabbar").innerHTML = tabs.map(([t, l, i]) => `<a class="tab" href="${ROOTS[t]}" data-tab="${t}"${S.tab === t ? ' aria-current="page"' : ""}>${ic(i, "off")}${ic(i + "-f", "on")}<span>${l}</span>${t === "panier" && n ? `<span class="bdg">${n > 99 ? "99+" : n}</span>` : ""}</a>`).join("");
    $("#side").innerHTML = `<a class="wordmark" href="#/" data-tab="accueil" style="text-decoration:none"><svg aria-hidden="true"><use href="#i-logo"/></svg>Cabas</a>` +
      tabs.map(([t, l, i]) => `<a class="sitem" href="${ROOTS[t]}" data-tab="${t}"${S.tab === t ? ' aria-current="page"' : ""}>${ic(i, "off")}${ic(i + "-f", "on")}<span>${l}</span>${t === "panier" && n ? `<span class="bdg">${n > 99 ? "99+" : n}</span>` : ""}</a>`).join("") +
      `<a class="sitem" href="#/reglages"${S.route.name === "reglages" ? ' aria-current="page"' : ""}>${ic("gear")}<span>Réglages</span></a><div class="smini">${S.route.name === "panier" ? "" : miniHtml()}</div>`;
    const dock = $("#dock"), view = $("#view");
    let dh = "";
    if (V.dock === "bar" && V.dockId) dh = `<div class="wrap">${buyCtl(V.dockId, "bar")}</div>`;
    else if (n && S.route.name !== "panier") dh = `<div class="wrap">${miniHtml()}</div>`;
    dock.innerHTML = dh;
    dock.hidden = !dh;
    view.classList.toggle("docked", !!dh);
  }
  function bumpBadge() { $$(".tab .bdg, .sitem .bdg").forEach((b) => { b.classList.remove("bump"); void b.offsetWidth; b.classList.add("bump"); }); }

  let ticking = false;
  function onScroll() {
    ticking = false;
    const y = window.scrollY, nav = $("#nav");
    const navH = nav.offsetHeight;
    const anchor = $("#view " + ((lastV && lastV.anchor) || ".lt"));
    let showT = y > 2;
    if (anchor) { const r = anchor.getBoundingClientRect(); showT = r.bottom <= navH + 2; }
    nav.classList.toggle("solid", y > 2);
    nav.classList.toggle("show-t", showT);
    const chips = $("#view .chips");
    const stuck = !!chips && y > 10 && chips.getBoundingClientRect().top <= navH + 0.5;
    if (chips) chips.classList.toggle("stuck", stuck);
    nav.classList.toggle("flat", stuck);
  }
  window.addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });

  /* ---------- panier : actions ---------- */
  function setQty(id, q, how) {
    q = Math.max(0, Math.min(99, q | 0));
    const before = S.basket[id] || 0;
    if (q) S.basket[id] = q; else delete S.basket[id];
    saveBasket();
    if (S.route.name === "panier") { rerender(); return; }
    $$(`[data-buy="${CSS.escape(id)}"]`).forEach((el) => {
      const t = document.createElement("div");
      t.innerHTML = buyCtl(id, el.dataset.v);
      const nw = t.firstElementChild;
      const hadFocus = el.contains(document.activeElement);
      if (!before && q && nw.classList.contains("stepper")) nw.classList.add("pop");
      el.replaceWith(nw);
      if (hadFocus) { const f = nw.querySelector(`[data-act="${how === "dec" && q ? "dec" : "inc"}"]`) || nw; if (f.focus) f.focus({ preventScroll: true }); }
    });
    renderChrome();
    if (!before && q) bumpBadge();
  }
  function addItems(items, replace) {
    if (replace) S.basket = {};
    let n = 0;
    for (const id of Object.keys(items)) if (S.prods.has(id)) { S.basket[id] = Math.min(99, (S.basket[id] || 0) + items[id]); n++; }
    saveBasket();
    return n;
  }

  /* ---------- feuilles ---------- */
  let sheetCtx = null;
  function openSheet(o) {
    sheetCtx = o;
    const w = $("#sheet"), sh = w.querySelector(".sheet");
    sh.innerHTML = `<div class="grab" aria-hidden="true"></div><div class="sheet-h">${o.left || `<span></span>`}<h2 id="sheetT">${esc(o.title)}</h2>${o.right || `<button class="txtbtn" type="button" data-act="close">OK</button>`}</div><div class="sheet-b">${o.body}</div>${o.foot ? `<div class="sheet-f">${o.foot}</div>` : ""}`;
    sh.style.transform = "";
    sh.classList.remove("closing");
    w.hidden = false;
    document.documentElement.style.overflow = "hidden";
    if (o.focus) setTimeout(() => { const i = $(o.focus, sh); if (i) i.focus(); }, 60);
  }
  function refreshSheet() {
    if (!sheetCtx || !sheetCtx.build) return;
    const b = $("#sheet .sheet-b"), y = b ? b.scrollTop : 0;
    const o = sheetCtx.build();
    $("#sheet .sheet-b").innerHTML = o.body;
    if (o.foot != null) $("#sheet .sheet-f").innerHTML = o.foot;
    $("#sheet .sheet-b").scrollTop = y;
  }
  function closeSheet() {
    const w = $("#sheet");
    if (w.hidden) return;
    w.hidden = true;
    document.documentElement.style.overflow = "";
    const cb = sheetCtx && sheetCtx.onClose;
    sheetCtx = null;
    if (cb) cb();
  }
  if (window.visualViewport) {
    const vv = window.visualViewport;
    const fit = () => {
      const sh = $("#sheet .sheet");
      if (!sh || $("#sheet").hidden) return;
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      sh.style.bottom = kb > 60 ? kb + "px" : "";
      sh.style.paddingBottom = kb > 60 ? "0px" : "";
    };
    vv.addEventListener("resize", fit);
    vv.addEventListener("scroll", fit);
  }
  (function dragToClose() {
    let y0 = null, dy = 0, sh = null;
    document.addEventListener("pointerdown", (e) => {
      const t = e.target.closest(".grab, .sheet-h");
      if (!t || e.target.closest("button")) return;
      sh = t.closest(".sheet"); y0 = e.clientY; dy = 0; sh.classList.add("drag");
    });
    document.addEventListener("pointermove", (e) => { if (y0 == null || !sh) return; dy = Math.max(0, e.clientY - y0); sh.style.transform = `translateY(${dy}px)`; });
    const end = () => { if (y0 == null || !sh) return; sh.classList.remove("drag"); if (dy > 90) closeSheet(); else sh.style.transform = ""; y0 = null; sh = null; };
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", end);
  })();
  const opt = (act, label, checked, extra, count) => `<button class="opt" type="button" role="menuitemcheckbox" aria-checked="${!!checked}" data-act="${act}" ${extra || ""}><span>${label}</span>${count != null ? `<span class="c">${count}</span>` : ""}<span class="box">${ic("check")}</span></button>`;
  function sortSheet(key) {
    const f = F(key);
    openSheet({ title: "Trier par", body: `<div class="group">${SORTS.map(([v, l]) => `<button class="opt" type="button" data-act="setsort" data-k="${esc(key)}" data-v="${v}">${esc(l)}${f.sort === v ? ic("check", "ck") : ""}</button>`).join("")}</div>` });
  }
  function baseFor(key) { return key === "s" ? search(S.q) : S.list.filter((p) => "r:" + p.r === key); }
  function filterSheet(key) {
    const build = () => {
      const f = F(key), base = baseFor(key), res = applyFilters(base, f, key === "s");
      const rc = (id) => base.filter((p) => p.offers[id] && p.offers[id].price > 0).length;
      const tagc = new Map(); base.forEach((p) => (p.tags || []).forEach((t) => tagc.set(t, (tagc.get(t) || 0) + 1)));
      const brands = new Map(); base.forEach((p) => brands.set(p.brand, (brands.get(p.brand) || 0) + 1));
      const bq = norm(f.bq);
      const bl = [...brands.entries()].filter(([b]) => !bq || norm(b).includes(bq)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "fr")).slice(0, 60);
      const body = `<h3 class="gh">Enseignes</h3><div class="group">${S.rets.map((r) => opt("fret", esc(r.name), f.ret[r.id], `data-id="${esc(r.id)}" data-k="${esc(key)}"`, rc(r.id))).join("")}</div>` +
        `<h3 class="gh">Disponibilité</h3><div class="group">${opt("fcmp", "Vendus dans plusieurs enseignes", f.cmp, `data-k="${esc(key)}"`)}${opt("fpromo", "Avec une offre en cours", f.promo, `data-k="${esc(key)}"`)}</div>` +
        `<h3 class="gh">Type de marque</h3><div class="pad"><div class="seg" role="group" aria-label="Type de marque">${[["all", "Toutes"], ["nb", "Grandes marques"], ["mdd", "Distributeur"]].map(([v, l]) => `<button type="button" data-act="ftype" data-k="${esc(key)}" data-v="${v}" aria-pressed="${f.type === v}">${l}</button>`).join("")}</div></div>` +
        (tagc.size ? `<h3 class="gh">Labels et mentions</h3><div class="tagset">${[...tagc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([t]) => `<button class="chip" type="button" data-act="ftag" data-k="${esc(key)}" data-t="${esc(t)}" aria-pressed="${!!f.tags[t]}">${esc(t)}</button>`).join("")}</div>` : "") +
        `<h3 class="gh">Prix maximum</h3><label class="field"><input id="fmax" data-k="${esc(key)}" type="number" inputmode="decimal" min="0" step="0.5" placeholder="Sans limite, en euros" value="${esc(f.max)}"></label>` +
        `<h3 class="gh">Marques</h3><label class="field" style="margin-bottom:10px"><input id="fbq" data-k="${esc(key)}" type="search" placeholder="Chercher une marque" value="${esc(f.bq)}" autocomplete="off"></label><div class="group">${bl.map(([b, n]) => opt("fbrand", esc(b), f.brand[b], `data-b="${esc(b)}" data-k="${esc(key)}"`, n)).join("") || `<div class="opt" style="color:var(--ink-2)">Aucune marque</div>`}</div>`;
      const foot = `<button class="btn plain" type="button" data-act="freset" data-k="${esc(key)}" style="flex:0 0 auto;width:auto">Effacer</button><button class="btn" type="button" data-act="close">Voir ${plural(res.length, "produit", "produits")}</button>`;
      return { body, foot };
    };
    const o = build();
    openSheet({ title: "Filtres", body: o.body, foot: o.foot, build, onClose: rerenderList });
  }
  function rerenderList() {
    if (S.route.name === "recherche") { S.shown.s = 0; $("#sres").innerHTML = searchBody(); mountLazy(); onScroll(); }
    else { const k = "r:" + S.route.id; S.shown[k] = 0; rerender(); }
  }
  function zipSheet() {
    openSheet({
      title: "Livraison", focus: "#zipIn",
      left: `<button class="txtbtn" type="button" data-act="close">Annuler</button>`,
      right: `<button class="txtbtn" type="button" data-act="zipok">OK</button>`,
      body: `<p>Ton code postal sert à vérifier que les enseignes te livrent. Il reste sur cet appareil.</p><label class="field"><input id="zipIn" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="5" autocomplete="postal-code" placeholder="Code postal, par exemple 75011" value="${esc(S.prefs.zip)}" aria-label="Code postal"><small>Monoprix, Carrefour et Houra livrent en Île-de-France.</small></label>`,
    });
  }
  function nameSheet(title, value, act, id) {
    openSheet({
      title, focus: "#nameIn",
      left: `<button class="txtbtn" type="button" data-act="close">Annuler</button>`,
      right: `<button class="txtbtn" type="button" data-act="${act}" data-id="${esc(id || "")}">OK</button>`,
      body: `<label class="field" style="padding-top:8px"><input id="nameIn" type="text" maxlength="40" value="${esc(value)}" aria-label="Nom de la liste" enterkeyhint="done"></label>`,
    });
  }
  function confirmSheet(title, text, label, act, id) {
    openSheet({
      title, left: `<span></span>`, right: `<span></span>`,
      body: `<p>${esc(text)}</p>`,
      foot: `<button class="btn plain" type="button" data-act="close" style="flex:1">Annuler</button><button class="btn" type="button" data-act="${act}" data-id="${esc(id || "")}" style="flex:1;background:var(--promo)">${esc(label)}</button>`,
    });
  }
  function installSheet() {
    openSheet({
      title: "Installer Cabas",
      body: `<p>Cabas s'installe comme une appli, sans passer par l'App Store.</p><ol class="steps"><li><span>Ouvre cette page dans <b>Safari</b> sur ton iPhone.</span></li><li><span>Touche ${ic("share")} <b>Partager</b>, en bas de l'écran.</span></li><li><span>Choisis ${ic("sqplus")} <b>Sur l'écran d'accueil</b>, puis <b>Ajouter</b>.</span></li></ol><p style="padding-top:8px">L'icône Cabas apparaît sur ton écran d'accueil. L'appli s'ouvre en plein écran et marche même sans réseau, avec les prix du dernier relevé.</p>`,
    });
  }

  /* ---------- toast ---------- */
  let toastT = null;
  function toast(msg, action) {
    const el = $("#toast");
    el.innerHTML = esc(msg) + (action ? ` <button type="button" data-act="toastact">${esc(action.label)}</button>` : "");
    el._act = action ? action.run : null;
    el.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => { el.hidden = true; }, action ? 4000 : 1800);
  }

  /* ---------- événements ---------- */
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[href]");
    const t = e.target.closest("[data-act]") || (a && a.dataset.tab ? a : null);
    if (!t) {
      if (a) {
        const h = a.getAttribute("href");
        if (h && h.startsWith("#/")) {
          e.preventDefault();
          if (S.route.name === "recherche" && S.q) addRecent(S.q);
          if (!$("#sheet").hidden) closeSheet();
          const tb = tabOf(h);
          if (tb) { S.scroll[S.cur] = window.scrollY; S.tab = tb; S.stacks[tb] = [h]; navigate(h, "tab"); }
          else push(h);
        }
      }
      return;
    }
    if (t.dataset.tab && !t.dataset.act) { e.preventDefault(); if (!$("#sheet").hidden) closeSheet(); switchTab(t.dataset.tab); return; }
    const act = t.dataset.act, id = t.dataset.id, k = t.dataset.k;
    switch (act) {
      case "back": back(); break;
      case "close": closeSheet(); break;
      case "inc": setQty(id, (S.basket[id] || 0) + 1, "inc"); break;
      case "dec": setQty(id, (S.basket[id] || 0) - 1, "dec"); break;
      case "gosearch": S.focusSearch = true; switchTab("recherche"); break;
      case "setq": { S.q = t.dataset.q; addRecent(S.q); S.shown.s = 0; const i = $("#q"); if (i) i.value = S.q; $("#sres").innerHTML = searchBody(); const c = $(".search .clr"); if (c) c.hidden = !S.q; mountLazy(); window.scrollTo(0, 0); break; }
      case "clearq": { S.q = ""; const i = $("#q"); if (i) { i.value = ""; i.focus(); } t.hidden = true; $("#sres").innerHTML = searchBody(); mountLazy(); break; }
      case "clearrecent": S.recent = []; store.set("recent", []); $("#sres").innerHTML = searchBody(); break;
      case "sort": sortSheet(k); break;
      case "setsort": F(k).sort = t.dataset.v; closeSheet(); rerenderList(); break;
      case "filters": filterSheet(k); break;
      case "quick": {
        const f = F(k), q = t.dataset.q;
        if (q === "cmp") f.cmp = !f.cmp; else if (q === "promo") f.promo = !f.promo; else if (q === "bio") f.tags.Bio = !f.tags.Bio; else if (q === "mdd") f.type = f.type === "mdd" ? "all" : "mdd";
        rerenderList(); break;
      }
      case "fret": { const f = F(k); f.ret[id] = !f.ret[id]; refreshSheet(); break; }
      case "fcmp": F(k).cmp = !F(k).cmp; refreshSheet(); break;
      case "fpromo": F(k).promo = !F(k).promo; refreshSheet(); break;
      case "ftype": F(k).type = t.dataset.v; refreshSheet(); break;
      case "ftag": { const f = F(k); f.tags[t.dataset.t] = !f.tags[t.dataset.t]; refreshSheet(); break; }
      case "fbrand": { const f = F(k); f.brand[t.dataset.b] = !f.brand[t.dataset.b]; refreshSheet(); break; }
      case "freset": { const f = F(k); Object.assign(f, { ret: {}, brand: {}, tags: {}, type: "all", cmp: false, promo: false, max: "", bq: "" }); if (sheetCtx) refreshSheet(); else rerenderList(); break; }
      case "zip": zipSheet(); break;
      case "zipok": { const v = ($("#zipIn").value || "").replace(/\D/g, "").slice(0, 5); if (v && v.length !== 5) { toast("Un code postal a 5 chiffres"); break; } S.prefs.zip = v; savePrefs(); closeSheet(); rerender(); if (v && !inZone()) toast("Livraison hors Île-de-France pas encore couverte"); break; }
      case "maxk": S.prefs.maxOrders = +t.dataset.k; savePrefs(); rerender(); break;
      case "clear": confirmSheet("Vider le panier\u00a0?", "Tous les produits du panier seront retirés.", "Vider le panier", "clearok"); break;
      case "clearok": S.basket = {}; saveBasket(); closeSheet(); rerender(); break;
      case "share": shareProduct(id); break;
      case "hideinstall": S.seen.install = true; store.set("seen", S.seen); t.closest(".install").remove(); break;
      case "install": installSheet(); break;
      case "savelist": nameSheet("Nouvelle liste", "Courses du " + new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "short" }), "savelistok"); break;
      case "savelistok": {
        const nm = ($("#nameIn").value || "").trim() || "Ma liste";
        const L = { id: Date.now().toString(36), name: nm, items: Object.assign({}, S.basket), at: new Date().toISOString().slice(0, 10) };
        S.lists.unshift(L); saveLists(); closeSheet(); rerender(); toast("Liste enregistrée"); break;
      }
      case "keepsug": { const sg = suggestion(); S.lists.unshift({ id: Date.now().toString(36), name: sg.name, items: Object.assign({}, sg.items), at: new Date().toISOString().slice(0, 10) }); saveLists(); toast("Ajoutée à tes listes"); back(); break; }
      case "addlist": {
        const L = id === "essentiel" ? suggestion() : S.lists.find((x) => x.id === id);
        if (!L) break;
        const n = addItems(L.items, false);
        renderChrome(); bumpBadge();
        toast(plural(n, "produit ajouté", "produits ajoutés") + " au panier", { label: "Voir", run: () => switchTab("panier") });
        if (S.route.name === "home") rerender();
        break;
      }
      case "replacelist": { const L = S.lists.find((x) => x.id === id); if (!L) break; addItems(L.items, true); renderChrome(); switchTab("panier"); break; }
      case "renamelist": { const L = S.lists.find((x) => x.id === id); if (L) nameSheet("Renommer", L.name, "renameok", id); break; }
      case "renameok": { const L = S.lists.find((x) => x.id === id); const nm = ($("#nameIn").value || "").trim(); if (L && nm) { L.name = nm; saveLists(); } closeSheet(); rerender(); break; }
      case "dellist": confirmSheet("Supprimer la liste\u00a0?", "La liste sera supprimée de cet appareil. Ton panier ne change pas.", "Supprimer", "delok", id); break;
      case "delok": S.lists = S.lists.filter((x) => x.id !== id); saveLists(); closeSheet(); back(); break;
      case "reset": confirmSheet("Effacer mes données\u00a0?", "Le panier, les listes, les recherches récentes et les réglages seront effacés de cet appareil.", "Tout effacer", "resetok"); break;
      case "resetok": S.basket = {}; S.lists = []; S.recent = []; S.prefs = Object.assign({}, PREFS0, { off: {}, fee: {} }); S.seen = {}; ["basket", "lists", "recent", "prefs", "seen"].forEach((x) => store.set(x, x === "lists" || x === "recent" ? [] : {})); savePrefs(); closeSheet(); rerender(); toast("Données effacées"); break;
      case "toastact": { const el = $("#toast"); el.hidden = true; if (el._act) el._act(); break; }
      default: break;
    }
  });
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.act === "ret") { if (t.checked) delete S.prefs.off[t.dataset.id]; else S.prefs.off[t.dataset.id] = true; savePrefs(); renderChrome(); return; }
    if (t.id === "extra") { const v = parseFloat(String(t.value).replace(",", ".")); S.prefs.extraCost = v > 0 ? Math.min(v, 50) : 0; savePrefs(); return; }
    if (t.dataset && t.dataset.fee) { const v = parseFloat(String(t.value).replace(",", ".")); const o = S.prefs.fee[t.dataset.fee] || {}; o.base = v >= 0 ? Math.min(v, 30) : 0; S.prefs.fee[t.dataset.fee] = o; savePrefs(); return; }
    if (t.id === "fmax") { F(t.dataset.k).max = t.value; refreshSheet(); }
  });
  let qT = null;
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t.id === "q") {
      clearTimeout(qT);
      const c = $(".search .clr"); if (c) c.hidden = !t.value;
      qT = setTimeout(() => { S.q = t.value; S.shown.s = 0; $("#sres").innerHTML = searchBody(); mountLazy(); onScroll(); }, 120);
    } else if (t.id === "fbq") {
      F(t.dataset.k).bq = t.value;
      const pos = t.selectionStart;
      refreshSheet();
      const n = $("#fbq"); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (err) { /* champ de type search sans sélection */ } }
    } else if (t.id === "zipIn") {
      t.value = t.value.replace(/\D/g, "").slice(0, 5);
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#sheet").hidden) { closeSheet(); return; }
    if (e.key === "Enter") {
      if (e.target.id === "q") { e.preventDefault(); addRecent(e.target.value); e.target.blur(); }
      else if (e.target.id === "zipIn") { e.preventDefault(); const b = $('#sheet [data-act="zipok"]'); if (b) b.click(); }
      else if (e.target.id === "nameIn") { e.preventDefault(); const b = $('#sheet .sheet-h [data-act$="ok"]'); if (b) b.click(); }
      else if (e.target.id === "fmax") { e.preventDefault(); e.target.blur(); }
    }
  });
  async function shareProduct(id) {
    const p = S.prods.get(id);
    if (!p) return;
    const b = best(p), title = p.brand + " " + p.name;
    const url = location.origin + location.pathname + hp(id);
    const text = title + (b ? ", " + eur(b.price) + " chez " + retName(b.ret) : "") + " sur Cabas";
    if (navigator.share) { try { await navigator.share({ title, text, url }); } catch (err) { /* partage annulé */ } return; }
    try { await navigator.clipboard.writeText(url); toast("Lien copié"); } catch (err) { toast(url); }
  }

  /* ---------- prix à jour pendant que l'appli est ouverte ---------- */
  let refreshing = false;
  async function refreshData() {
    if (!S.ready || refreshing) return;
    refreshing = true;
    try {
      const st = await fetch("data/status.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null));
      S.lastCheckFetch = Date.now();
      if (st && JSON.stringify(st) !== JSON.stringify(S.status)) {
        const m = await fetch("data/meta.json", { cache: "no-cache" }).then((r) => r.json());
        if (JSON.stringify(m) !== JSON.stringify(S.meta)) await load(); else S.status = st;
        const typing = document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName);
        if ($("#sheet").hidden && !typing) rerender();
      }
    } catch (e) { /* hors ligne : on garde les prix chargés */ }
    refreshing = false;
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - (S.lastCheckFetch || S.loadedAt || 0) > 5 * 60 * 1000) refreshData();
  });
  setInterval(() => { if (document.visibilityState === "visible") refreshData(); }, 10 * 60 * 1000);

  /* ---------- démarrage ---------- */
  function renderFail() {
    $("#view").innerHTML = `<div class="wrap"><div class="empty">${emptyArt("info")}<h2>Catalogue indisponible</h2><p>Le catalogue n'a pas pu être chargé. Vérifie ta connexion, puis réessaie.</p><button class="btn" type="button" onclick="location.reload()">Réessayer</button></div></div>`;
  }
  (async () => {
    const h0 = location.hash || "#/";
    const t0 = tabOf(h0);
    if (t0) { S.tab = t0; S.stacks[t0] = [h0]; } else { S.tab = "accueil"; S.stacks.accueil = ["#/", h0]; }
    S.cur = h0;
    renderChrome({});
    try { await load(); S.ready = true; } catch (err) { S.failed = true; }
    render();
  })();
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    let had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (!had) { had = true; return; } toast("Une nouvelle version de Cabas est prête.", { label: "Recharger", run: () => location.reload() }); });
    window.addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => { /* hors ligne indisponible, l'appli marche quand même */ }); });
  }
})();
