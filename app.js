/* Cabas : catalogue, recherche, fiche produit, panier réparti entre enseignes, listes et réglages.
   Les prix viennent de data/*.json ; le panier, les listes et les réglages restent dans le navigateur. */
(() => {
  "use strict";

  /* ---------- outils ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  /* typographie française des textes venus des données (noms de produits, notes, sources, étapes des enseignes et des
     recettes) : espace insécable avant : ; ? ! et dans les guillemets, une virgule à la place d'un tiret cadratin */
  const TYPO_RE = / [:;?!»]|«|\u2014/;
  const typo = (s) => { s = String(s == null ? "" : s); return TYPO_RE.test(s) ? s.replace(/ ([:;?!»])/g, "\u00a0$1").replace(/« /g, "«\u00a0").replace(/\s*\u2014\s*/g, ", ") : s; };
  const tx = (s) => esc(typo(s));
  /* texte sans accents ni ponctuation ; le résultat est gardé, car marques, formats et noms de rayons reviennent des milliers de fois au chargement */
  const NORMC = new Map();
  const norm = (s) => {
    s = String(s || "");
    let v = NORMC.get(s);
    if (v === undefined) {
      v = s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/œ/g, "oe").replace(/æ/g, "ae").replace(/[^a-z0-9]+/g, " ").trim();
      if (NORMC.size < 20000) NORMC.set(s, v);
    }
    return v;
  };
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
    del(k) { try { localStorage.removeItem("cabas." + k); } catch (e) { /* rien à effacer */ } },
  };
  function px(v, cls) {
    const c = Math.round(v * 100), e = Math.floor(c / 100), ct = String(c % 100).padStart(2, "0");
    return `<span class="px ${cls || ""}" data-c="${c}"><span class="sr">${eur(v)}</span><span aria-hidden="true">${e}<span class="pc">,${ct}${NB}€</span></span></span>`;
  }
  /* le chiffre héros (total du panier, d'une recette, de la semaine) roule de l'ancien montant au nouveau quand il change
     sur place ; jamais avec « Réduire les animations », et le lecteur d'écran lit tout de suite le montant final */
  const ROLL = {};
  function rollHero(onPlace) {
    const el = $("#view .sum .st .px[data-c]");
    if (!el) return;
    const key = S.route.name + "|" + (S.route.id || ""), to = +el.dataset.c, from = ROLL[key];
    ROLL[key] = to;
    if (!onPlace || from == null || from === to || reducedMotion() || document.hidden) return;
    const vis = el.querySelector("[aria-hidden]"), t0 = performance.now(), D = 420;
    const paint = (c) => { vis.innerHTML = `${Math.floor(c / 100)}<span class="pc">,${String(c % 100).padStart(2, "0")}${NB}€</span>`; };
    const step = (t) => { if (!vis.isConnected) return; const k = Math.min(1, (t - t0) / D); paint(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)))); if (k < 1) requestAnimationFrame(step); };
    paint(from);
    requestAnimationFrame(step);
  }
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = () => (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  const reducedMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  /* durée d'un jeton de mouvement (« 320ms »), lue dans la feuille de style ; 0 quand le mouvement réduit est demandé */
  const tokenMs = (name, d) => { const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)); return isNaN(v) ? d : v; };
  /* retour haptique : Android seulement, jamais une condition, jamais sous mouvement réduit, seulement après un geste */
  function buzz(kind) {
    try {
      if (!("vibrate" in navigator) || reducedMotion()) return;
      navigator.vibrate({ add: 10, remove: [10, 40, 10], done: [15, 60, 30], error: [40, 60, 40] }[kind] || 10);
    } catch (e) { /* pas de vibreur */ }
  }
  /* nombre au format français pour un champ (« 9,90 »), lu avec une virgule ou un point */
  const frNum = (v) => (v == null || v === "" ? "" : Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 2 }));
  const numOf = (s) => parseFloat(String(s == null ? "" : s).replace(/\s/g, "").replace(",", "."));
  /* champ de feuille : étiquette visible, boîte de 48 px, suffixe collé, aide ou erreur dessous */
  function field(id, label, attrs, hint, suffix) {
    return `<div class="field" data-field="${esc(id)}"><label for="${esc(id)}">${label}</label><span class="in"><input id="${esc(id)}" ${attrs} aria-describedby="${esc(id)}H">${suffix ? `<span class="suf">${suffix}</span>` : ""}</span><small id="${esc(id)}H">${hint || ""}</small></div>`;
  }
  /* erreur de champ : bordure orange, message avec l'icône, focus ramené sur le champ (jamais la couleur seule) */
  function fieldError(id, msg) {
    const f = $(`[data-field="${CSS.escape(id)}"]`), i = $("#" + CSS.escape(id));
    if (!f) { toast(msg); return; }
    f.classList.add("err");
    const h = $("small", f); if (h) { h.dataset.hint = h.dataset.hint || h.innerHTML; h.innerHTML = ic("info") + `<span>${esc(msg)}</span>`; }
    if (i) i.focus();
    buzz("error");
  }

  /* ---------- état ---------- */
  /* theme : « auto » (le téléphone), « light », « dark » ; contrast : null suit le téléphone, sinon le réglage ; simple :
     mode confort ; pickManual : groupes d'enseigne (Auchan) dont le point a été choisi à la main, pas d'après le code postal ;
     pin : produit épinglé à une enseigne ({ id: groupe }) ; ban : produit exclu d'enseignes ({ id: { groupe: true } }) ;
     budgetMode : budget « panier » (chaque panier) ou « mois » (les paniers commandés du mois) ; shopDay : jour des
     courses (0 dimanche à 6 samedi, null d'après les commandes) ; voice : lecture à voix haute « slow » ou « normal » ;
     wake : écran gardé allumé en mode magasin ; allergens : allergènes à éviter (clés d'Open Food Facts) ; facts : Nutri-Score
     et allergènes demandés à Open Food Facts à l'ouverture d'une fiche (sinon d'un geste) */
  const PREFS0 = { zip: "", off: {}, fee: {}, pick: {}, pickManual: {}, liv: {}, keep: {}, usual: {}, qty1: {}, diet: {}, lead: {}, pin: {}, ban: {}, maxOrders: 3, extraCost: 0, manualCk: false, badge: true, theme: "auto", contrast: null, simple: false, budgetMode: "panier", shopDay: null, voice: "normal", wake: true, allergens: [], facts: true };
  const ROOTS = { accueil: "#/", rayons: "#/rayons", recherche: "#/recherche", listes: "#/listes", panier: "#/panier" };
  const S = {
    ready: false, failed: false,
    rayons: [], prods: new Map(), list: [], rets: [], retMap: new Map(), meta: {},
    basket: store.get("basket", {}),
    /* premier lancement : E.Leclerc, aux prix simulés, est proposé mais pas choisi d'office (questions de départ, réglages) */
    prefs: Object.assign({}, PREFS0, { off: store.get("prefs", null) ? {} : { leclerc: true }, fee: {}, pick: {}, pickManual: store.get("prefs", null) ? undefined : {}, liv: {}, keep: {}, usual: {}, qty1: {}, diet: {}, lead: {}, pin: {}, ban: {}, allergens: [], offv: store.get("prefs", null) ? undefined : 1 }, store.get("prefs", {})),
    lists: store.get("lists", []),
    recent: store.get("recent", []),
    seen: store.get("seen", {}),
    hist: store.get("hist", []),
    menu: store.get("menu", []),
    /* commandes : remplissage en cours (snap, coches, créneaux, liens à revoir), produits qui manquaient à la livraison */
    guide: Object.assign({ ck: {}, done: {} }, store.get("guide", {})),
    todo: store.get("todo", []),
    /* lignes libres : produits absents du catalogue, gardés en texte (cabas.free) */
    free: store.get("free", {}),
    /* panier souple : pour un produit, les équivalents que la personne accepte (cabas.flex, { id: [ids] }) */
    flex: store.get("flex", {}),
    tab: "accueil",
    stacks: { accueil: ["#/"], rayons: ["#/rayons"], recherche: ["#/recherche"], listes: ["#/listes"], panier: ["#/panier"] },
    cur: "", dir: "none", scroll: {}, shown: {}, lazy: {}, filt: {}, q: "", route: { name: "home" }, focusSearch: false,
    /* volatils : l'« Annuler » en cours, la correction d'orthographe de la recherche, la ligne libre en cours de saisie */
    undo: null, fixed: null, freeEdit: null,
    /* volatils : les pièces retirées d'une demande (« Pas ça ? »), le montant essayé dans le guide des frais */
    askOff: null, fraisAmt: null,
    /* volatils : la vue du panier (« cmd » par commande, « tab » tableau des prix) */
    cartView: "cmd",
  };
  const saveBasket = () => store.set("basket", S.basket);
  const savePrefs = () => { store.set("prefs", S.prefs); };
  const saveLists = () => store.set("lists", S.lists);
  const saveFree = () => store.set("free", S.free);

  /* ---------- données ---------- */
  const retName = (id) => (S.retMap.get(id) || {}).name || id;
  /* désactiver une enseigne vaut pour toutes ses options de livraison et de retrait (« group ») */
  const offKey = (r) => (r && (r.group || r.id)) || "";
  const retOn = (id) => S.retMap.has(id) && !S.prefs.off[offKey(S.retMap.get(id))];
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
  /* un prix d'E.Leclerc pris par best() le dit toujours, à côté du montant */
  const simTxt = (o) => (o && o.sim ? ", prix simulé" : "");
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
  const rayon = (id) => (S.rayMap ? S.rayMap.get(id) : null) || null;
  const inRayon = (id) => (S.byRayon && S.byRayon.get(id)) || [];
  const univName = (id) => ((S.univMap && S.univMap.get(id)) || {}).name || "";
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
    if (o.sim) return "Prix simulé, pas relevé";
    const t = lastCheck(o.ret);
    if (t && t.slice(0, 10) === o.at) return "Vérifié " + whenFr(t);
    return "Relevé le " + dateFr(o.at);
  }
  const recent = (t) => t && Date.now() - new Date(t).getTime() < 26 * 3600 * 1000;
  /* « Prix vérifiés aujourd'hui à 15h08 (Houra : 28 octobre) » : les enseignes pas relues récemment sont nommées avec leur date */
  const dayFr = (iso) => dateFr(iso).replace(/ \d{4}$/, "");
  /* état du relevé d'une enseigne, par rayon (data/status.json : date et nombre de produits de chaque rayon) */
  const statusRays = (rid) => (((S.status || {}).retailers || {})[rid] || {}).rayons || null;
  /* la part des prix d'une enseigne plus ancienne que sa dernière vérification, et l'univers le plus ancien */
  function oldPart(rid, day) {
    const rays = statusRays(rid);
    let tot = 0, old = 0, oldest = null;
    if (rays) {
      for (const id of Object.keys(rays)) {
        const r = rayon(id), at = rays[id].at, n = rays[id].products || 0;
        if (!r) continue;
        tot += n;
        if (at && at < day) { old += n; if (!oldest || at < oldest.at) oldest = { at, name: univName(r.u) || r.name }; }
      }
    } else {
      const ds = (S.retDates && S.retDates[rid]) || [];
      tot = ds.length; old = ds.filter((d) => d < day).length;
      if (old) oldest = { at: ds.filter((d) => d < day).sort()[0], name: "" };
    }
    return tot && old > 0.3 * tot ? oldest : null;
  }
  function freshText() {
    let best = null;
    const late = [];
    for (const r of S.rets) {
      if (r.simulated) continue;
      const t = lastCheck(r.id);
      if (recent(t)) {
        if (!best || t > best) best = t;
        /* enseigne vérifiée, mais dont une bonne part des prix vient d'un relevé plus ancien : l'univers le plus ancien est nommé */
        const o = oldPart(r.id, t.slice(0, 10));
        if (o) late.push(r.name + "\u00a0: " + (o.name ? o.name.toLowerCase() + " du " : "en partie du ") + dayFr(o.at));
      } else if (S.retDate && S.retDate[r.id]) late.push(r.name + "\u00a0: " + dayFr(S.retDate[r.id]));
    }
    if (!best) return "Prix relevés le " + dateFr(S.meta.updatedAt);
    return "Prix vérifiés " + whenFr(best) + (late.length ? " (" + late.join(", ") + ")" : "");
  }
  const isStale = () => !S.rets.some((r) => !r.simulated && recent(lastCheck(r.id)));

  /* plusieurs points de retrait d'une même enseigne (« group ») : un seul compte à la fois, choisi dans les réglages */
  function groupsOf() {
    const g = {};
    for (const x of S.allRets || []) if (x.group) (g[x.group] = g[x.group] || []).push(x);
    return g;
  }
  function pickOf(g, members) {
    const id = (S.prefs.pick || {})[g];
    return members.some((m) => m.id === id) ? id : members[0].id;
  }
  const isPickup = (r) => ((r && r.channel) || {}).mode === "retrait";
  /* Option retenue dans un groupe. Avec « Sans achat en magasin » (mode false), on ne se déplace pas : un point de
     retrait est remplacé par la livraison à domicile choisie pour lui (S.prefs.liv), sinon la plus proche (champ
     « livraison » de data/retailers.json). Le choix des réglages reste gardé : en décochant, on revient au retrait. */
  function pickFor(g, mode) {
    const ms = groupsOf()[g] || [];
    if (!ms.length) return null;
    const id = pickOf(g, ms), r = ms.find((m) => m.id === id);
    if (mode !== false || !isPickup(r)) return id;
    const alt = [(S.prefs.liv || {})[id], r.livraison].find((x) => ms.some((m) => m.id === x && !isPickup(m)));
    return alt || (ms.find((m) => !isPickup(m)) || r).id;
  }
  const retsFor = (mode) => (S.allRets || []).filter((x) => !x.group || x.id === pickFor(x.group, mode));
  /* Le bon Auchan d'après le code postal : le point dont la liste de codes (zips de data/retailers.json, codes publics)
     contient celui de la personne, sinon celui de son département (deps), sinon aucun. Le code postal reste sur le
     téléphone (prefs.zip) ; un point choisi à la main (prefs.pickManual) n'est plus changé d'office. */
  function autoPick(zip, g) {
    zip = String(zip || "").replace(/\D/g, "");
    if (zip.length !== 5) return null;
    const ms = (groupsOf()[g || "auchan"] || []).filter((m) => m.zips || m.deps);
    const hit = ms.find((m) => (m.zips || []).includes(zip));
    if (hit) return { id: hit.id, exact: true };
    const dep = ms.find((m) => (m.deps || []).includes(zip.slice(0, 2)));
    return dep ? { id: dep.id, exact: false } : null;
  }
  const zipGroups = () => Object.keys(groupsOf()).filter((g) => groupsOf()[g].some((m) => m.zips));
  /* secteur d'une option : le point de retrait lui-même, ou celui dont c'est la livraison à domicile (champ livraison) */
  const sectorOf = (id) => { const r = S.allMap.get(id); if (!r) return null; if (r.zips) return r.id; const x = (groupsOf()[r.group] || []).find((m) => m.zips && m.livraison === id); return x ? x.id : null; };
  /* applique le choix d'après le code postal aux groupes qui ne sont pas réglés à la main ; même façon de recevoir
     (livraison à domicile du même secteur si c'était le choix) ; renvoie les groupes changés */
  function applyAutoPick() {
    const changed = [];
    for (const g of zipGroups()) {
      if ((S.prefs.pickManual || {})[g]) continue;
      const a = autoPick(S.prefs.zip, g), ms = groupsOf()[g];
      if (!a) continue;
      const cur = S.allMap.get(pickOf(g, ms)), r = S.allMap.get(a.id);
      const to = cur && !isPickup(cur) && r.livraison && ms.some((m) => m.id === r.livraison) ? r.livraison : a.id;
      if (to !== pickOf(g, ms)) { S.prefs.pick = Object.assign({}, S.prefs.pick, { [g]: to }); changed.push(g); }
    }
    return changed;
  }
  /* la phrase qui dit d'où vient le point choisi (réglages, questions de départ) */
  function autoText(g) {
    const ms = groupsOf()[g] || [], name = (ms[0] || {}).name || "", zip = S.prefs.zip || "";
    if ((S.prefs.pickManual || {})[g]) return `Choisi à la main.${zip ? ` Coche «\u00a0D'après mon code postal\u00a0» pour reprendre le point le plus proche de ${zip}.` : ""}`;
    if (!zip) return `Indique ton code postal\u00a0: Cabas choisit le point ${name} le plus proche parmi ceux qu'il relève.`;
    const a = autoPick(zip, g);
    if (!a) return `Cabas ne relève pas de point ${name} près de ${zip}\u00a0: choisis celui qui te va.`;
    const sec = (SECTEURS.find(([id]) => id === a.id) || [])[1] || (((S.allMap.get(a.id) || {}).channel || {}).where || "");
    return (a.exact ? `D'après ton code postal (${zip})\u00a0: secteur ${sec}, le plus proche de chez toi` : `D'après ton département (${zip.slice(0, 2)})\u00a0: secteur ${sec}, le plus proche`) + " parmi ceux que Cabas relève. Retrait ou livraison, à toi de choisir.";
  }
  function applyGroups() {
    S.rets = retsFor(S.prefs.comp !== false);
    S.retMap = new Map(S.rets.map((x) => [x.id, x]));
    S._sug = null;
  }

  /* à l'ouverture, les prix viennent du cache (sw.js les sert tout de suite et les revérifie derrière) ; pour une
     vérification (fresh), le réseau d'abord */
  const getJson = (u, fresh) => fetch(fresh ? u + "?fresh=1" : u, { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); });
  /* enseignes, relevé, état et recettes : les petits fichiers, qui suffisent à dessiner l'accueil avant le catalogue */
  async function loadBase(fresh) {
    const [r, m, st, rc] = await Promise.all([getJson("data/retailers.json", fresh), getJson("data/meta.json", fresh), getJson("data/status.json", fresh).catch(() => null), getJson("data/recettes.json", fresh).catch(() => null)]);
    S.recs = (rc && rc.recettes) || [];
    S.status = st || {};
    S.allRets = r.slice().sort((a, b) => a.order - b.order);
    S.allMap = new Map(S.allRets.map((x) => [x.id, x]));
    /* réglages d'avant le choix d'après le code postal : un point déjà choisi l'a été à la main */
    if (!S.prefs.pickManual) { S.prefs.pickManual = {}; for (const g of Object.keys(S.prefs.pick || {})) S.prefs.pickManual[g] = 1; savePrefs(); }
    if (S.prefs.zip && applyAutoPick().length) savePrefs();
    /* réglages d'avant : une option désactivée l'était seule ; c'est désormais l'enseigne entière, telle qu'elle s'affichait */
    if (!S.prefs.offv) {
      const off = S.prefs.off || {}, G = groupsOf();
      for (const g of Object.keys(G)) { const was = !!off[pickOf(g, G[g])]; G[g].forEach((m) => delete off[m.id]); if (was) off[g] = true; }
      S.prefs.off = off; S.prefs.offv = 1; savePrefs();
    }
    applyGroups();
    S.meta = m || {};
  }
  const loadCatalog = (fresh) => getJson("data/catalog.json", fresh);
  /* Catalogue v2 (tools/make_catalog.py, contrat partagé) : clés courtes, offres en tableaux [enseigne, centimes, jour
     depuis epoch, drapeaux], dépliées ici dans la forme que tout le reste du code attend. Le nom affiché par l'enseigne,
     le lien, le texte de promotion et le prix barré sont dans data/details/<univers>.json : voir details(p). */
  const FL_PROMO = 1, FL_SIM = 2, FL_CAT = 4, FL_WAS = 8;
  function unpack(c) {
    if (c.v !== 2) return c;
    const rets = c.rets || [], t0 = Date.parse((c.epoch || "2026-01-01") + "T00:00:00Z"), days = new Map();
    const dayIso = (d) => { let v = days.get(d); if (!v) { v = new Date(t0 + d * 864e5).toISOString().slice(0, 10); days.set(d, v); } return v; };
    const products = c.products.map((x) => {
      const offers = {};
      for (const [ri, cents, day, fl] of x.o || []) {
        const o = { price: cents / 100, at: dayIso(day) };
        if (fl & FL_PROMO) o.promo = true;
        if (fl & FL_SIM) o.sim = true;
        if (fl & FL_CAT) o.cat = true;
        if (fl & FL_WAS) o.was = true;
        offers[rets[ri]] = o;
      }
      const qty = x.q ? { v: x.q[0], u: x.q[1] } : null;
      if (qty && x.ql) qty.lab = x.ql;
      return { id: x.i, brand: typo(x.b), name: typo(x.n), format: x.f, r: x.r, icon: x.k, type: x.t, qty, tags: x.g || [], regimes: x.d || [], ean: x.e, mdd: x.m, desc: x.s || "", frais: !!x.fr, approx: !!x.ap, eq: !!x.eq, offers };
    });
    return { updatedAt: c.updatedAt, univers: c.univers, rayons: c.rayons, aliases: c.aliases, products };
  }
  /* un catalogue d'avant (sans univers) : chaque « aisle » devient un univers, pour le temps où le cache le garde */
  function universOf(c) {
    if (c.univers && c.univers.length) return c.univers.map((u) => ({ id: u.id, name: u.name }));
    const out = [];
    for (const r of c.rayons) { const name = r.aisle || "Rayons", id = norm(name).replace(/ /g, "-") || "rayons"; r.u = id; if (!out.some((u) => u.id === id)) out.push({ id, name }); }
    return out;
  }
  function useCatalog(raw) {
    const c = unpack(raw);
    S.univers = universOf(c);
    S.univMap = new Map(S.univers.map((u) => [u.id, u]));
    S.rayons = c.rayons.slice().sort((a, b) => a.order - b.order);
    for (const r of S.rayons) r.name = typo(r.name);
    S.rayMap = new Map(S.rayons.map((r) => [r.id, r]));
    S.list = c.products;
    S.prods = new Map();
    S.byRayon = new Map(S.rayons.map((r) => [r.id, []]));
    S.list.forEach((p, i) => {
      p.rank = i; S.prods.set(p.id, p);
      p.u = (S.rayMap.get(p.r) || {}).u || "";
      const L = S.byRayon.get(p.r); if (L) L.push(p);
    });
    /* rayons de parcours (halal, casher, sans gluten, vegan, bio) : tous les produits étiquetés, de tous les rayons */
    for (const r of S.rayons) if (r.virtuel && r.virtuel.length) {
      const tags = new Set(r.virtuel), own = S.byRayon.get(r.id) || [];
      S.byRayon.set(r.id, own.concat(S.list.filter((p) => !own.includes(p) && (p.regimes || []).some((t) => tags.has(t)))));
    }
    for (const r of S.rayons) r.count = (S.byRayon.get(r.id) || []).length;
    S._sug = null; S._recs = null;
    RES.base = "";
    DETV.clear(); DET.clear(); IDX.i = 0;
    S.retDate = {};
    S.retDates = {};
    for (const p of S.list) for (const k of Object.keys(p.offers || {})) {
      const d = p.offers[k].at;
      if (!d) continue;
      if (!S.retDate[k] || d > S.retDate[k]) S.retDate[k] = d;
      (S.retDates[k] = S.retDates[k] || []).push(d);
    }
    /* un produit qui a changé d'identifiant d'un relevé à l'autre est suivi grâce à c.aliases ;
       un produit absent du relevé reste dans le panier et les listes, sans compter, jusqu'à son retour */
    S.alias = c.aliases || {};
    CATW = null; FUZZW = null; S.eanMap = null; DIETV.v++;
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
    freeCheck();
    idleIndex();
  }
  async function load(fresh) {
    const pc = loadCatalog(fresh);
    await loadBase(fresh);
    useCatalog(await pc);
    S.loadedAt = Date.now();
  }
  /* les mots de chaque produit (marque, nom, format, rayon, mentions) et leurs racines : calculés à la première
     recherche qui touche le produit, ou en tâche de fond par tranches de 2 000 produits, jamais tous au démarrage */
  const IDX = { i: 0, t: 0 };
  function idx(p) {
    if (!p._w) {
      p._b = norm(p.brand);
      p._w = (p._b + " " + norm(p.name) + " " + norm(p.format) + " " + norm((S.rayMap.get(p.r) || {}).name) + " " + norm((p.tags || []).join(" "))).split(" ").filter(Boolean);
      p._s = p._w.map(stem);
      p._sw = p._aw = p._ow = null;
    }
    return p;
  }
  function idleIndex() {
    const later = window.requestIdleCallback || ((fn) => setTimeout(() => fn({ timeRemaining: () => 8 }), 60));
    const step = () => {
      const L = S.list, end = Math.min(L.length, IDX.i + 2000);
      for (; IDX.i < end; IDX.i++) idx(L[IDX.i]);
      if (IDX.i < L.length) IDX.t = later(step); else IDX.t = 0;
    };
    if (IDX.t && window.cancelIdleCallback) window.cancelIdleCallback(IDX.t); else clearTimeout(IDX.t);
    IDX.t = later(step);
  }
  /* Détails d'un produit (nom affiché par chaque enseigne, lien, texte de promotion, prix barré) : un fichier par
     univers, chargé à la demande et gardé ; DETV porte les univers déjà reçus pour un affichage immédiat. Hors ligne
     sans détails en cache : le lien tombe sur le site de l'enseigne, le nom sur marque et désignation. */
  const DET = new Map(), DETV = new Map();
  const detShape = (x) => { const out = {}; for (const k of Object.keys(x || {})) out[k] = { name: x[k].n || "", url: x[k].u || "", promo: x[k].p || "", was: x[k].w || 0 }; return out; };
  const detailsNow = (p) => { const d = DETV.get(p.u); return d ? detShape(d[p.id]) : null; };
  function details(p) {
    const u = p.u;
    if (!u) return Promise.resolve({});
    if (DETV.has(u)) return Promise.resolve(detShape(DETV.get(u)[p.id]));
    let pr = DET.get(u);
    if (!pr) {
      /* un univers sans fichier (404) est retenu comme vide ; une panne de réseau laisse réessayer plus tard */
      pr = fetch("data/details/" + encodeURIComponent(u) + ".json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : r.status === 404 ? { p: {} } : null)).then((j) => { const m = (j && j.p) || null; if (m) DETV.set(u, m); else DET.delete(u); return m; }).catch(() => { DET.delete(u); return null; });
      DET.set(u, pr);
    }
    return pr.then((m) => detShape(m ? m[p.id] : null));
  }
  /* les détails de plusieurs produits (un chargement par univers), puis un rappel si l'écran est encore là */
  const detailsAll = (ps, then) => Promise.all([...new Set(ps.map((p) => p.u).filter(Boolean))].map((u) => details({ u, id: "" }))).then(then, then);
  /* lien d'une offre : la fiche chez l'enseigne, sinon la page d'accueil de l'enseigne */
  const offerUrl = (det, ret) => (det && det[ret] && det[ret].url) || (S.allMap.get(ret) || {}).home || "#";

  /* ---------- recherche ---------- */
  /* racine d'un mot (sans pluriel) ; calculée une fois par produit au chargement (p._s), pas à chaque recherche */
  const stem = (w) => (w.length > 3 ? w.replace(/(x|s)$/, "") : w);
  /* synonymes et homophones de dictée (« pattes », « yahourt », « spagetti ») : chaque clé vaut les mots de droite */
  const SYN = { pq: ["papier", "toilette"], coca: ["coca"], sopalin: ["essuie"], yaourt: ["yaourt"], yoghourt: ["yaourt"], yogourt: ["yaourt"], yaourth: ["yaourt"], yahourt: ["yaourt"], cafe: ["cafe"], emmenthal: ["emmental"], parmesan: ["parmigiano"], pate: ["pates"], patte: ["pates"], pattes: ["pates"], spagetti: ["spaghetti"], spaguetti: ["spaghetti"], coquilette: ["coquillettes"], toilete: ["toilette"], toilettes: ["toilette"], moutard: ["moutarde"],
    camenbert: ["camembert"], camembert: ["camembert"], saucison: ["saucisson"], saucisson: ["saucisson"], lardon: ["lardons"], jambon: ["jambon"], jambons: ["jambon"], steack: ["steak"], steacks: ["steak"], mayo: ["mayonnaise"], ketchup: ["ketchup"], chip: ["chips"], shampooing: ["shampoing"], shampoo: ["shampoing"], deo: ["deodorant"], dentifrice: ["dentifrice"], pdt: ["pommes", "de", "terre"], patate: ["pommes", "de", "terre"], patates: ["pommes", "de", "terre"],
    couche: ["couches"], croquette: ["croquettes"], capsule: ["capsules"], biere: ["biere"], bierre: ["biere"], vin: ["vin"], surgele: ["surgele"], nouille: ["nouilles"], pizza: ["pizza"], frite: ["frites"], glace: ["glace"], gateau: ["gateau"], gato: ["gateau"], biscuit: ["biscuit"], cereale: ["cereales"], confiture: ["confiture"], miel: ["miel"], the: ["the"], tisane: ["infusion"], chocolat: ["chocolat"], choco: ["chocolat"], bonbon: ["bonbons"], compote: ["compote"], lessive: ["lessive"], javel: ["javel"], eponge: ["eponge"], sac: ["sacs"], litiere: ["litiere"] };
  /* les clés de SYN qui sont des fautes et non des synonymes : comprises partout, et la correction est dite dans la recherche */
  const TYPO = new Set(["yaourth", "yahourt", "patte", "pattes", "spagetti", "spaguetti", "coquilette", "toilete", "moutard", "camenbert", "saucison", "steack", "steacks", "bierre", "gato", "shampooing"]);
  /* un mot (synonymes et racine appliqués) dans un produit : 3 le mot entier, 2 un début de mot, 1 un morceau, 0 rien */
  function tokHit(p, t) {
    let b = 0;
    const W = idx(p)._w, Sx = p._s;
    for (let i = 0; i < W.length; i++) {
      const w = W[i];
      if (w === t || Sx[i] === t) return 3;
      if (w.startsWith(t)) b = Math.max(b, 2);
      else if (t.length >= 4 && w.includes(t)) b = Math.max(b, 1);
    }
    return b;
  }
  /* produit habituel d'une requête (choix mémorisé dans Ma liste, F04) : la requête entière ou son premier mot */
  function usualFor(q, exact) {
    const U = S.prefs.usual || {}, nq = norm(q), u = U[nq] || (!exact && U[nq.split(" ")[0]]);
    if (!u) return null;
    return S.prods.has(u.id) ? u.id : (S.alias || {})[u.id] || null;
  }
  function searchScored(q) {
    let toks = norm(q).split(" ").filter(Boolean);
    toks = toks.flatMap((t) => SYN[t] || [t]).map(stem);
    if (!toks.length) return [];
    const out = [], uid = usualFor(q);
    for (const p of S.list) {
      let score = 0, ok = true;
      for (const t of toks) {
        const b = tokHit(p, t);
        if (!b) { ok = false; break; }
        score += b;
      }
      if (!ok) continue;
      const words = score;
      if (p._b.startsWith(toks[0])) score += 2;
      /* le rayon qui porte le mot (« jambon », « lait ») passe devant les produits qui ne font que le contenir */
      if (toks.some((t) => rayWords(p.r).has(t))) score += 1.5;
      if (uid && p.id === uid) score += 3;
      score += Math.min(2, Object.keys(p.offers).length - 1) * 0.6;
      out.push([score, p, words]);
    }
    out.sort((a, b) => b[0] - a[0] || a[1].rank - b[1].rank);
    return out;
  }
  /* orthographe tolérante : un mot qui n'a aucun résultat est rapproché des mots du catalogue (noms de rayons, marques,
     synonymes, mots des 500 premiers produits) à une faute près, deux dès huit lettres (distance de Damerau-Levenshtein) ;
     le plus proche gagne, puis le plus fréquent. Jamais appelée tant qu'un mot a des résultats, jamais sur un nombre. */
  let FUZZW = null;
  function fuzzyWords() {
    if (FUZZW) return FUZZW;
    FUZZW = new Map();
    const add = (w, n) => { if (w.length > 2 && !/\d/.test(w) && !STOP.has(w)) FUZZW.set(w, (FUZZW.get(w) || 0) + n); };
    /* les mots justes seulement : jamais une faute connue de SYN, qu'on ne veut pas proposer */
    Object.keys(SYN).forEach((k) => { if (!TYPO.has(k)) add(k, 1); SYN[k].forEach((w) => add(w, 1)); });
    /* les noms de rayons pèsent plus que les mots des produits : ce sont les mots des listes de courses (« eaix », eaux plutôt que paix) */
    S.rayons.forEach((r) => norm(r.name).split(" ").forEach((w) => { add(w, 20); add(stem(w), 20); }));
    S.list.forEach((p) => add(idx(p)._b.split(" ")[0] || "", 1));
    S.list.slice(0, 500).forEach((p) => idx(p)._w.forEach((w) => { add(w, 1); add(stem(w), 1); }));
    return FUZZW;
  }
  function editDist(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    const D = [];
    for (let i = 0; i <= a.length; i++) { D[i] = [i]; }
    for (let j = 1; j <= b.length; j++) D[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      let low = Infinity;
      for (let j = 1; j <= b.length; j++) {
        let v = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, D[i - 2][j - 2] + 1);
        D[i][j] = v;
        if (v < low) low = v;
      }
      if (low > max) return max + 1;
    }
    return D[a.length][b.length];
  }
  function fuzzyWord(tok) {
    tok = norm(tok).split(" ")[0] || "";
    /* un mot connu n'est jamais « corrigé » */
    if (tok.length < 4 || /\d/.test(tok) || !S.list.length || fuzzyWords().has(tok)) return null;
    const max = tok.length >= 8 ? 2 : 1;
    let best = null, bd = max + 1, bn = 0;
    for (const [w, n] of fuzzyWords()) {
      if (w === tok) continue;
      const d = editDist(tok, w, max);
      if (d < bd || (d === bd && n > bn)) { bd = d; best = w; bn = n; }
    }
    return bd <= max ? best : null;
  }
  /* la requête corrigée mot à mot, seulement les mots sans aucun résultat ; null quand rien ne change */
  function fixQuery(q) {
    const raw = norm(q).split(" ").filter(Boolean);
    const hit = (t) => (SYN[t] || [t]).map(stem).every((x) => S.list.some((p) => tokHit(p, x) > 0));
    let ch = false;
    const to = raw.map((t) => { if (hit(t)) return t; const f = fuzzyWord(t); if (f) { ch = true; return f; } return t; });
    return ch ? { from: raw.join(" "), to: to.join(" ") } : null;
  }
  /* la recherche de l'écran : sans résultat, la requête corrigée est essayée et la correction affichée (S.fixed) */
  function search(q) {
    S.fixed = null;
    let r = searchScored(q);
    if (!r.length) { const f = fixQuery(q); if (f) { r = searchScored(f.to); if (r.length) S.fixed = f; } }
    else { const raw = norm(q).split(" ").filter(Boolean); if (raw.some((t) => TYPO.has(t))) S.fixed = { from: raw.join(" "), to: raw.map((t) => (TYPO.has(t) ? SYN[t].join(" ") : t)).join(" ") }; }
    return r.map((x) => x[1]);
  }
  function addRecent(q) {
    q = String(q || "").trim();
    if (q.length < 2) return;
    S.recent = [q].concat(S.recent.filter((x) => norm(x) !== norm(q))).slice(0, 8);
    store.set("recent", S.recent);
  }

  /* ---------- Demande à Cabas : une phrase comprise sur le téléphone ----------
     « pâtes complètes le moins cher au kilo », « lait à moins de 1 € chez Houra », « petit-déjeuner pour 4 à moins de
     15 € », « c'est combien la livraison chez Houra ? ». Chaque intention (INTENT) est retirée de la phrase ; ce qui
     reste est le produit, lu comme une ligne de Ma liste (parseLine : quantité, contenance). Rien ne part du téléphone.
     Tout ce qui est compris est dit (« J'ai compris : … ») et se retire d'un geste (« Pas ça ? », S.askOff) : aucune
     ambiguïté silencieuse ; « le moins cher » est dit « au kilo ou au litre », « pour 4 » est dit « pour 4 personnes ». */
  const ASKN = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12, quinze: 15, vingt: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60, cent: 100 };
  const NUM = "(\\d+(?:\\.\\d+)?|" + Object.keys(ASKN).join("|") + ")";
  /* nombre de personnes sans le mot « personnes » : jamais « un » ni « une » (« pour une semaine ») */
  const NUM2 = "(\\d+|" + Object.keys(ASKN).filter((w) => w !== "un" && w !== "une").join("|") + ")";
  const numOfW = (w) => (/^\d/.test(w) ? parseFloat(w) : ASKN[w] || 0);
  const UNIT = "(?: (?:le|au|du|par) (kilo|kg|litre|l))?";
  /* listes composées : [ligne, suit le nombre de personnes, facultative quand le budget est serré] ; pour deux personnes */
  const MEALS = {
    petitdej: { label: "Petit-déjeuner", re: /\b(?:petits? dej(?:euners?)?|p tit dej|brunch)\b/, lines: [["café moulu"], ["lait demi-écrémé", 1], ["pain de mie nature", 1], ["beurre"], ["confiture", 0, 1], ["jus d'orange", 1, 1], ["corn flakes", 1, 1], ["sucre en poudre", 0, 1]] },
    gouter: { label: "Goûter", re: /\bgouters?\b/, lines: [["biscuits au chocolat", 1], ["brioche", 1], ["jus d'orange", 1, 1], ["pâte à tartiner", 0, 1]] },
    pates: { label: "Dîner de pâtes", re: /\b(?:diner|repas|soir|soiree|plat)s? (?:de |aux |avec des )?pates\b/, lines: [["spaghetti", 1], ["thon au naturel", 1], ["tomates pelées", 1], ["huile d'olive"], ["emmental râpé", 0, 1]] },
    apero: { label: "Apéro", re: /\b(?:apero|aperitif)s?(?: dinatoires?)?\b/, lines: [["chips", 1], ["saucisson"], ["biscuits apéritif", 1, 1], ["olives", 0, 1], ["bière blonde x6", 1, 1]] },
    menage: { label: "Ménage", re: /\b(?:menage|produits? d entretien)\b/, lines: [["lessive liquide"], ["liquide vaisselle"], ["papier toilette", 1], ["essuie-tout", 0, 1], ["sacs poubelle", 0, 1]] },
    semaine: { label: "Courses de la semaine", re: /\b(?:courses|liste|panier) (?:de|pour) (?:la|une) semaine\b/, lines: [["6 litres de lait", 1], ["3 paquets de pâtes", 1], ["12 œufs", 1], ["beurre"], ["yaourts nature x4", 1], ["12 bouteilles d'eau", 1], ["papier toilette"], ["café"], ["riz"], ["huile de tournesol"], ["thon x3", 1], ["tomates pelées x2", 1], ["jus d'orange x2", 1, 1], ["emmental râpé", 0, 1], ["madeleines", 0, 1], ["coca x2", 0, 1], ["liquide vaisselle", 0, 1], ["sucre", 0, 1], ["farine", 0, 1]] },
  };
  const ASK_DIETS = [["gluten", /\bsans gluten\b/, "sans gluten"], ["lactose", /\bsans lactose\b/, "sans lactose"], ["vegan", /\b(?:vegan|vegane|vegans|veganes|vegetalien(?:ne)?s?)\b/, "végan"], ["veg", /\b(?:vegetarien(?:ne)?s?|veggie)\b/, "végétarien"], ["halal", /\bhalal\b/, "halal"], ["kosher", /\b(?:casher|kasher|kosher|cacher)\b/, "casher"], ["pork", /\bsans porc\b/, "sans porc"], ["alcohol", /\bsans alcool\b/, "sans alcool"], ["sugar", /\bsans sucres? ajoutes?\b/, "sans sucres ajoutés"], ["bio", /\b(?:bio|bios|biologiques?)\b/, "bio"]];
  /* les intentions, dans l'ordre où elles sont retirées de la phrase ; k : nom de la pièce comprise (S.askOff) */
  const INTENT = [
    ["fill", /\b(?:s il te plait|s il vous plait|svp|stp|merci|je (?:veux|voudrais|cherche|recherche|prends|prendrais)|il me faut|j ai besoin (?:de|d|du|des)|(?:trouve|donne|montre|propose|fais|compose|prepare)(?:[- ]moi)?|acheter|une liste(?: de courses)?|liste de courses|ma liste)\b/],
    ["fees", /\b(?:frais(?: de (?:livraison|service|port|retrait|preparation))?|livraisons?(?: (?:offerte|gratuite|a domicile))?|livr(?:e|er|ez|ent|es|ee|ees)|minimum(?: (?:de commande|d achat|de panier))?|commande minimum|panier minimum|retrait|seuil)\b/],
    ["question", /\b(?:c est combien|combien(?: (?:ca|ça))?(?: (?:coute|coutent|faut il|de))?|ca coute|coute|coutent|quel(?:le)?s? (?:est|sont)(?: (?:le|la|les))?|quel(?:le)?s?|a partir de(?: (?:combien|quel montant))?|des combien|est ce que|c est quoi|comment)\b/],
    ["ret", /\b(?:(?:chez|sur|a|de|d) )?(monoprix|carrefour|houra|auchan|e leclerc|leclerc|leclercdrive)\b/],
    ["max", new RegExp("\\b(?:(?:a|pour|de) )?(?:moins de|au maximum|au max|maximum|max|maxi|pas plus de|jusqu a|sous|inferieur a|en dessous de)(?: les)? " + NUM + "(?: (?:euros?|eur|e|balles))?" + UNIT + "\\b")],
    ["max", new RegExp("\\bbudget(?: (?:de|max|maximum))? " + NUM + "(?: (?:euros?|eur|balles))?\\b")],
    ["max", new RegExp("\\b(?:(?:a|pour) )?" + NUM + " (?:euros?|eur|balles)" + UNIT + "\\b")],
    ["sort", /\b(?:(?:le|la|les) )?plus cher(?:e|s|es)?\b/, "desc"],
    ["sort", /\b(?:(?:le|la|les) )?(?:moins cher(?:e|s|es)?|pas cher(?:e|s|es)?|meilleur(?:e|s)? (?:prix|marche)|prix (?:le )?plus bas|plus bas prix|petits? prix|economiques?|bon marche|premier prix|moins couteux)\b/, "cheap"],
    ["unit", /\b(?:prix )?(?:au|du|par) (kilo|kg|litre)\b/],
    ["people", new RegExp("\\bpour " + NUM + " (?:personnes?|pers|adultes?|gens|convives?|invites?|enfants?|amis?)\\b")],
    ["people", new RegExp("\\bpour " + NUM2 + "\\b(?! (?:euros?|eur|balles|kg|g|l|cl|ml|kilos?|litres?)\\b)")],
    ["people", new RegExp("\\b" + NUM + " (?:personnes|pers|convives|invites|adultes)\\b")],
    ["people", /\bpour moi(?: (?:tout seul|toute seule|seul|seule))?\b/, 1],
  ];
  const RET_OF = { monoprix: "monoprix", carrefour: "carrefour", houra: "houra", auchan: "auchan", leclerc: "leclerc", "e leclerc": "leclerc", leclercdrive: "leclerc" };
  /* l'enseigne nommée : son option retenue quand c'est un groupe (Auchan, E.Leclerc) */
  const askRet = (k) => (groupsOf()[k] ? pickFor(k, S.prefs.comp !== false) : k);
  /* mots qui n'apportent rien à une question de frais (« pour un panier de 80 € ») */
  const FEE_FILL = new Set("panier commande courses achats achat mon ma mes une un de d la le les pour a au aux en est ce que qui il y on chez sur faut".split(" "));
  function askParse(raw, offIn) {
    const off = (offIn && offIn.off) || {}, price = !!(offIn && offIn.price);
    const A = { raw: String(raw || "").trim(), kind: "product", q: "", label: "", parts: [], diet: {}, smart: false };
    if (!A.raw) { A.kind = "none"; return A; }
    if (off.all) { A.kind = "plain"; A.q = A.raw; return A; }
    /* mots normalisés, chacun rattaché au mot écrit dont il vient (« petit-déjeuner » donne petit et dejeuner) */
    const toks = A.raw.replace(/€/g, " € ").replace(/(\d)([a-zA-Zà-ÿ])/g, "$1 $2").replace(/[?!;:«»"()]/g, " ").split(/\s+/).filter(Boolean);
    const W = [];
    toks.forEach((t, i) => {
      if (/^\d+(?:[.,]\d+)?$/.test(t)) W.push({ w: t.replace(",", "."), t: i });
      else if (t === "€") W.push({ w: "euros", t: i });
      else norm(t).split(" ").filter(Boolean).forEach((w) => W.push({ w, t: i }));
    });
    const used = new Set(), str = () => W.map((x, i) => (used.has(i) ? "·" : x.w)).join(" ");
    /* une expression trouvée : ses mots sont retirés de la phrase (sauf « Pas ça ? » sur un repas ou des frais) */
    const take = (re, keep) => {
      const s = str(), m = re.exec(s);
      if (!m || (m.index && s[m.index - 1] !== " ")) return null;
      const i0 = s.slice(0, m.index).split(" ").length - 1, n = m[0].trim().split(" ").length;
      if (!keep) for (let i = i0; i < i0 + n; i++) used.add(i);
      return m;
    };
    const part = (k, label) => { A.parts.push({ k, label, off: !!off[k] }); return !off[k]; };
    for (const [k, re, v] of INTENT) {
      let m;
      while ((m = take(re, (k === "fees" && off.fees) || false))) {
        if (k === "fill") continue;
        if (k === "fees") { A.fees = true; if (off.fees) break; continue; }
        if (k === "question") { A.question = true; continue; }
        if (k === "ret" && !A.ret) { const r = RET_OF[m[1]]; if (part("ret", "chez " + ((S.allMap.get(askRet(r)) || {}).name || r))) A.ret = askRet(r); A.retKey = r; }
        else if (k === "max" && A.max == null) { const v2 = numOfW(m[1]); if (v2 > 0 && v2 < 10000) { const u = m[2] ? (/^l/.test(m[2]) ? "le litre" : "le kilo") : ""; if (part("max", `à moins de ${eurR(v2)}${u ? " " + u : ""}`)) { A.max = v2; A.maxUnit = u ? (/^l/.test(m[2]) ? "l" : "kg") : ""; } } }
        else if (k === "sort" && !A.sortK) A.sortK = v;
        else if (k === "unit") A.unitK = /^l/.test(m[1]) ? "litre" : "kilo";
        else if (k === "people" && !A.people) { const p = v || numOfW(m[1]); if (p > 0 && p <= 20 && part("people", "pour " + plural(p, "personne", "personnes"))) A.people = p; }
      }
    }
    /* tri : « le moins cher » se lit au kilo ou au litre (ce que compare Cabas), sauf « Le prix du paquet » ; « au kilo »
       seul trie au kilo */
    if (A.sortK === "desc") { if (part("sort", "le plus cher d'abord")) A.sort = "prixdesc"; }
    else if (A.sortK === "cheap" || A.unitK) {
      const lab = A.sortK === "cheap" && price && !A.unitK ? "le prix le plus bas" : "le moins cher " + (A.unitK ? "au " + A.unitK : "au kilo ou au litre");
      if (part("sort", lab)) A.sort = A.sortK === "cheap" && price && !A.unitK ? "prix" : "unite";
    }
    for (const [k, re, lab] of ASK_DIETS) if (take(re) && part("diet:" + k, lab)) A.diet[k] = true;
    for (const k of Object.keys(MEALS)) { if (A.meal) break; if (take(MEALS[k].re, !!off.meal)) { A.mealK = k; if (part("meal", `une liste «\u00a0${MEALS[k].label}\u00a0»`)) A.meal = k; } }
    /* ce qui reste : le produit (mots écrits, accents compris), lu comme une ligne de Ma liste */
    const keepT = new Set(W.filter((x, i) => !used.has(i)).map((x) => x.t));
    const rest = toks.filter((t, i) => keepT.has(i)).join(" ").replace(/^(?:(?:de|des|du|d'|d’|le|la|les|l'|l’|un|une|pour|à|a|au|aux|avec|et|chez|en)\s+)+/i, "").replace(/\s+(?:de|des|du|le|la|les|un|une|pour|à|a|au|aux|avec|et|chez|en)$/i, "").trim();
    const L = parseLine(rest);
    A.L = L; A.q = L.q; A.label = rest;
    const words = norm(rest).split(" ").filter((w) => w && !FEE_FILL.has(w) && !STOP.has(w) && !/^\d/.test(w));
    if (A.fees && !off.fees && !A.meal && !words.length) {
      A.kind = "fees"; A.parts.unshift({ k: "fees", label: "les frais de livraison" + (A.ret ? " chez " + ((S.allMap.get(A.ret) || {}).name || A.ret) : " des enseignes"), off: false });
      A.parts = A.parts.filter((x) => x.k !== "ret").map((x) => (x.k === "max" ? Object.assign(x, { label: "pour un panier de " + eurR(A.max != null ? A.max : 0) }) : x));
      A.amount = A.max; A.smart = true;
      return A;
    }
    if (A.fees && off.fees) A.parts.unshift({ k: "fees", label: "les frais de livraison", off: true });
    if (A.meal) { A.kind = "list"; A.smart = true; A.budget = A.max; return A; }
    if (!A.q) { A.kind = "none"; A.smart = A.parts.length > 0 || !!A.question || !!A.fees; return A; }
    /* un simple mot (« lait ») reste une recherche, sans rien de plus à calculer */
    if (!A.parts.length && !A.question && !A.fees && !L.nGiven) return A;
    /* un mot mal écrit : la correction est dite ; plusieurs produits sans virgule (« lait pâtes coca ») : une liste */
    if (!searchScored(A.q).length) {
      const f = fixQuery(A.q);
      if (f && searchScored(f.to).length) { if (part("fix", `«\u00a0${f.from}\u00a0» lu «\u00a0${f.to}\u00a0»`)) { A.q = f.to; A.label = f.to; A.fix = f; } }
      else { const ls = readList(rest).filter((x) => x.pick); if (ls.length >= 2) { A.kind = "list"; A.lines = ls; A.smart = true; A.budget = A.max; return A; } }
    }
    A.qty = L.size ? fmtSize(L.size) : L.nGiven && L.n > 1 ? "×\u00a0" + L.n : "";
    A.smart = !!(A.parts.some((x) => x.k !== "fix") || A.question || L.nGiven || A.fees);
    return A;
  }
  const fmtSize = (z) => (z.u === "g" ? (z.v >= 1000 ? String(z.v / 1000).replace(".", ",") + "\u00a0kg" : z.v + "\u00a0g") : z.v >= 1000 ? String(z.v / 1000).replace(".", ",") + "\u00a0L" : z.v >= 100 ? String(z.v / 10).replace(".", ",") + "\u00a0cl" : z.v + "\u00a0ml");
  /* la demande en cours, gardée tant que la phrase et les pièces retirées ne changent pas */
  function askNow(q) {
    const nq = norm(q);
    if (!S.askOff || S.askOff.q !== nq) S.askOff = { q: nq, off: {}, price: false };
    const k = JSON.stringify([q, S.askOff, DIETV.v, S.prefs.off, S.prefs.pick, S.prefs.comp, S.list.length, S.loadedAt]);
    if (!S._ask || S._ask.k !== k) S._ask = { k, A: askParse(q, S.askOff) };
    return S._ask.A;
  }
  /* « J'ai compris : pâtes complètes, le moins cher au kilo » */
  function askSentence(A) {
    const on = A.parts.filter((x) => !x.off && x.k !== "fix" && x.k !== "fees" && x.k !== "meal").map((x) => x.label);
    const fix = A.parts.find((x) => x.k === "fix" && !x.off);
    if (A.kind === "fees") return A.parts[0].label + (A.amount ? `, pour un panier de ${eurR(A.amount)}` : "");
    if (A.kind === "none") return (on.length ? on.join(", ") + "\u00a0; " : "") + "il me manque le produit";
    if (A.kind === "list") {
      const meal = A.meal ? MEALS[A.meal] : null, ppl = A.people || +S.prefs.foyer || 2;
      return (meal ? `une liste «\u00a0${meal.label}\u00a0», quantités pour ${plural(ppl, "personne", "personnes")}${!A.people ? (S.prefs.foyer ? " (ton foyer)" : " (dis «\u00a0pour 4\u00a0» pour changer)") : ""}` : `${plural(A.lines.length, "produit", "produits")}, en liste`) +
        on.filter((l) => !/^pour \d/.test(l)).map((l) => ", " + (/^à moins de/.test(l) ? l + " en tout" : l)).join("");
    }
    return (A.label ? A.label.replace(/\s+/g, " ") : "") + (A.qty && !/\d/.test(A.label) ? ", " + A.qty : "") + (fix ? ` (tu as écrit «\u00a0${A.fix.from}\u00a0»)` : "") + on.map((l) => ", " + l).join("");
  }
  function askHead(A) {
    if (A.kind === "plain") return `<div class="banner ask" role="status">${ic("search")}<span>Recherche de «\u00a0${esc(A.raw)}\u00a0» telle quelle.</span><button class="act" type="button" data-act="askback">Revenir à ce que j'avais compris${ic("chev")}</button></div>`;
    if (!A.smart) return "";
    return `<div class="banner ask" role="status">${ic("info")}<span><b>J'ai compris\u00a0:</b> ${esc(askSentence(A))}</span><button class="act" type="button" data-act="askfix" aria-label="Pas ça\u00a0? Corriger ce que Cabas a compris">Pas ça\u00a0?${ic("chev")}</button></div>`;
  }
  /* produit et prix d'une demande : l'enseigne nommée, sinon le meilleur prix (relevé ou simulé, signalé) */
  const askOffer = (A, p) => { if (A.ret) { const o = p.offers[A.ret]; return o && o.price > 0 ? Object.assign({ ret: A.ret }, o) : null; } return best(p); };
  const askUnit = (A, p) => { const o = askOffer(A, p); const v = o ? perUnit(p, o.price) : null; return v == null ? 1e9 : v; };
  /* la liste des résultats d'une demande : enseigne, régime dit, prix plafond, puis le tri demandé */
  function askList(A, base) {
    const d = Object.keys(A.diet).filter((k) => k !== "bio");
    let out = base.filter((p) => {
      /* une demande porte sur ce qu'on peut acheter : vendu par tes enseignes (ou celle nommée) */
      const o = askOffer(A, p);
      if (!o) return false;
      if (d.length && !dietOk(p, Object.fromEntries(d.map((k) => [k, true])))) return false;
      if (A.diet.bio && !(p.regimes || []).includes("bio")) return false;
      if (A.max != null) { if (A.maxUnit) { const u = perUnit(p, o.price); if (u == null || u > A.max) return false; } else if (o.price > A.max) return false; }
      return true;
    });
    const pr = (p) => { const o = askOffer(A, p); return o ? o.price : 1e9; };
    if (A.sort === "unite") out = out.slice().sort((a, b) => askUnit(A, a) - askUnit(A, b) || pr(a) - pr(b));
    else if (A.sort === "prix") out = out.slice().sort((a, b) => pr(a) - pr(b));
    else if (A.sort === "prixdesc") out = out.slice().sort((a, b) => pr(b) - pr(a));
    return out;
  }
  /* quantité de la réponse : la contenance écrite (2 kg de riz), le nombre écrit, le nombre de personnes, sinon 1 */
  function askQty(A, p) {
    const L = A.L || {};
    if (L.size && p.qty && p.qty.u === L.size.u && p.qty.v) return Math.max(1, Math.min(99, Math.round(L.size.v / p.qty.v)));
    if (L.nGiven) return L.n;
    if (A.people) return (QTY_FOYER[p.r] || QTY_DEF)[A.people <= 1 ? 0 : A.people <= 2 ? 1 : A.people <= 4 ? 2 : 3];
    return 1;
  }
  /* la base de la recherche (cartes, filtres) : la demande comprise, ou la recherche telle quelle */
  function askBase(q) {
    const A = askNow(q);
    if (A.kind !== "product" || !A.smart) return search(q);
    S.fixed = null;
    return askList(A, searchScored(A.q).map((x) => x[1]));
  }
  /* la carte réponse : le premier produit qui répond à toute la demande, avec la quantité comprise */
  function askAnswer(A, list) {
    if (!list.length) {
      /* rien ne répond à tout : ce que chaque pièce retirée rendrait */
      const tries = A.parts.filter((x) => !x.off && x.k !== "fix").map((x) => { const o = { off: Object.assign({}, S.askOff.off, { [x.k]: 1 }), price: S.askOff.price }; const B = askParse(A.raw, o); return { x, n: B.kind === "product" ? askList(B, searchScored(B.q).map((y) => y[1])).length : 0 }; }).filter((t) => t.n);
      return `<div class="empty">${emptyArt("filter")}<h2>Rien ne répond à toute ta demande</h2><p>${tries.length ? "Sans une de ces conditions, il y a des produits\u00a0:" : `Rien ne correspond à «\u00a0${esc(A.label)}\u00a0» avec ces conditions.`}</p>${tries.length ? `<div class="btns">${tries.slice(0, 3).map((t) => `<button class="btn plain" type="button" data-act="askpart" data-k="${esc(t.x.k)}">Sans «\u00a0${esc(t.x.label)}\u00a0», ${plural(t.n, "produit", "produits")}</button>`).join("")}</div>` : ""}</div>`;
    }
    const p = list[0], o = askOffer(A, p), n = askQty(A, p), u = o ? unitPrice(p, o.price) : "";
    const title = A.sort === "unite" ? "Le moins cher " + (A.unitK ? "au " + A.unitK : "au kilo ou au litre") : A.sort === "prix" ? "Le prix le plus bas" : A.sort === "prixdesc" ? "Le plus cher" : "Ce que Cabas te propose";
    return `<div class="hcard ans"><a class="thumb" href="${hp(p.id)}" aria-label="${esc(p.brand + " " + p.name)}">${img(p, 56)}</a><span><small class="lab">${esc(title)}</small><b>${esc(p.brand)} ${esc(p.name)}</b><small>${esc(p.format)}${o ? ", " + eur(o.price) + " chez " + esc(retName(o.ret)) + (o.sim ? " (prix simulé)" : "") : ""}${u ? ", " + esc(u) : ""}</small>` +
      (o ? `<button class="btn sm tint" type="button" data-act="askadd" data-id="${esc(p.id)}" data-n="${n}">${ic("plus")}Ajouter${n > 1 ? " " + n : ""} au panier<span class="sub">${eur(o.price * n)}</span></button>` : "") + `</span></div>`;
  }

  /* ---------- une liste composée (« petit-déjeuner pour 4 à moins de 15 € ») ----------
     Les lignes du modèle (MEALS, pour deux personnes) suivent le nombre de personnes ; chaque ligne prend, comme Ma liste,
     le produit le moins cher au kilo ou au litre, prix relevés seulement ; le régime dit dans la phrase choisit parmi les
     produits de la ligne. Budget serré : le plus petit format de chaque ligne, puis sans les lignes facultatives, et
     tout est dit. Le total est celui des produits, hors livraison ; la livraison est dite à part (listPlan). */
  function composeList(A) {
    const ppl = A.people || +S.prefs.foyer || 2, f = ppl / 2, d = Object.keys(A.diet).filter((k) => k !== "bio");
    const dOk = (p) => (!d.length || dietOk(p, Object.fromEntries(d.map((k) => [k, true])))) && (!A.diet.bio || (p.regimes || []).includes("bio"));
    const rows = [], miss = [];
    const src = A.meal ? MEALS[A.meal].lines.map(([t, sc, opt]) => ({ t, sc, opt })) : A.lines.map((x) => ({ t: x.raw }));
    const extra = A.meal && A.L && A.L.q ? readList(A.label).filter((x) => x.pick).map((x) => ({ t: x.raw, M: x })) : [];
    for (const x of src.concat(extra)) {
      let M = x.M;
      if (!M) {
        const L = parseLine(x.t);
        if (x.sc && f !== 1) { if (L.size) L.size = { v: L.size.v * f, u: L.size.u }; else L.n = Math.max(1, Math.ceil(L.n * f)); L.nGiven = true; }
        M = matchLine(Object.assign(L, { real: true }));
      }
      const nm = x.t.replace(/^\d+\s+(?:\S+\s+de\s+|\S+\s+d['’]\s*)?/i, "").replace(/\s*x\d+$/i, "");
      if (!M.pick) { miss.push({ t: nm, diet: false }); continue; }
      let pick = S.prods.get(M.pick), n = M.n;
      if (!dOk(pick)) {
        const fit = M.cands.map((id) => S.prods.get(id)).filter((p) => p && bestReal(p) && dOk(p)).sort((a, b) => valOf(a) - valOf(b))[0];
        if (!fit) { miss.push({ t: nm, diet: true }); continue; }
        pick = fit; n = M.n;
      }
      const b = bestReal(pick);
      if (!b) continue;
      rows.push({ M, t: x.t, opt: !!x.opt, id: pick.id, n, c: Math.round(b.price * 100) * n });
    }
    const tot = () => rows.reduce((a, r) => a + r.c, 0);
    const budget = A.budget ? Math.round(A.budget * 100) : 0, dropped = [];
    let small = false;
    if (budget && tot() > budget) {
      /* le format le plus petit du vivier de chaque ligne (moins cher en tout, pas au kilo) */
      for (const r of rows) {
        const alt = (r.M.pool || []).map(([id, n1]) => { const p = S.prods.get(id), b = p && bestReal(p); return b && dOk(p) ? { id, n: n1, c: Math.round(b.price * 100) * n1 } : null; }).filter(Boolean).sort((a, b) => a.c - b.c)[0];
        if (alt && alt.c < r.c) { r.id = alt.id; r.n = alt.n; r.c = alt.c; small = true; }
      }
      for (let i = rows.length - 1; i >= 0 && tot() > budget; i--) if (rows[i].opt) dropped.unshift(rows.splice(i, 1)[0]);
    }
    return { rows, total: tot(), budget, dropped, small, ppl, miss };
  }
  /* texte de Ma liste pour les lignes composées (« 4 lait demi-écrémé ») */
  const composeText = (C) => C.rows.map((r) => (r.n > 1 && !/^\d/.test(r.t) && !/x\d+$/i.test(r.t) ? r.n + " " : "") + r.t).join("\n");
  function composeHtml(A) {
    const C = composeList(A);
    S._compose = C;
    if (!C.rows.length) return `<div class="empty">${emptyArt("list")}<h2>Pas encore de quoi composer cette liste</h2><p>Ses produits ne sont pas encore relevés dans tes enseignes.</p></div>`;
    const meal = A.meal ? MEALS[A.meal].label : "Ta liste";
    let plan = null;
    try { plan = listPlan(C.rows.map((r) => ({ pick: r.id, n: r.n, pool: [[r.id, r.n]] }))); } catch (e) { plan = null; }
    const bud = C.budget ? (C.total <= C.budget ? `<p class="bud ok">Dans ton budget de ${eurR(C.budget / 100)}\u00a0: il reste ${eurC(C.budget - C.total)}.</p>` : `<p class="bud over">Au plus juste, ${eurC(C.total)}\u00a0: ${eurC(C.total - C.budget)} de plus que ton budget de ${eurR(C.budget / 100)}.</p>`) : "";
    const cut = C.dropped.length ? `<p class="hint">Pour tenir ton budget, sans\u00a0: ${esc(joinEt(C.dropped.map((r) => r.t.replace(/\s*x\d+$/i, ""))))}.${C.small ? " Et le plus petit format de chaque produit." : ""}</p>` : C.small ? `<p class="hint">Pour tenir ton budget, le plus petit format de chaque produit.</p>` : "";
    const dm = C.miss.filter((x) => x.diet).map((x) => x.t), am = C.miss.filter((x) => !x.diet).map((x) => x.t);
    const miss = (dm.length ? `<p class="hint">Aucun produit indiqué ${esc(joinEt(ASK_DIETS.filter(([k]) => A.diet[k]).map(([, , l]) => "«\u00a0" + l + "\u00a0»")))} par les enseignes pour\u00a0: ${esc(joinEt(dm))}.</p>` : "") + (am.length ? `<p class="hint">Pas encore relevé dans tes enseignes\u00a0: ${esc(joinEt(am))}.</p>` : "");
    const liv = plan && !plan.short ? `<p class="hint">Livrée seule\u00a0: ${eurC(plan.total)} frais compris, ${plan.orders.length === 1 ? "chez " + esc(retName(plan.orders[0].ch)) : esc(plural(plan.orders.length, "commande", "commandes"))}.</p>` : `<p class="hint">Seule, cette liste n'atteint pas le minimum de commande des enseignes\u00a0: ajoute-la à ton panier de la semaine, ou achète-la en magasin.</p>`;
    return `<section class="hcard col compose" aria-label="${esc(meal)}"><b>${esc(meal)}${A.meal ? ", pour " + plural(C.ppl, "personne", "personnes") : ""}</b><small>${plural(C.rows.length, "produit", "produits")}, ${eurC(C.total)} au meilleur prix relevé de chaque produit, hors livraison</small>` +
      `<div class="crows">${C.rows.map((r) => { const p = S.prods.get(r.id); return `<a class="crow" href="${hp(p.id)}"><span class="thumb">${img(p, 40)}</span><span class="ct"><b>${r.n > 1 ? r.n + "\u00a0× " : ""}${esc(p.brand)} ${esc(p.name)}</b><small>${esc(p.format)}, chez ${esc(retName(bestReal(p).ret))}</small></span><span class="cp">${eurC(r.c)}</span></a>`; }).join("")}</div>` +
      bud + cut + miss + liv +
      `<div class="btns"><button class="btn tint" type="button" data-act="askopen">${ic("pen")}Ouvrir dans Ma liste</button><button class="btn tint" type="button" data-act="askaddall">${ic("plus")}Tout ajouter au panier</button></div></section>`;
  }

  /* ---------- frais de livraison : écart au minimum, au palier suivant, à la livraison offerte ---------- */
  /* feeGap(rid, centimes) : pour un panier de ce montant chez cette enseigne (barème de data/retailers.json, frais de
     créneau choisis par la personne compris) ; null quand l'enseigne est inconnue */
  function feeGap(rid, amt) {
    const r = S.allMap.get(rid);
    if (!r || !r.channel) return null;
    const ch = r.channel, T = tiersOf(r).map((t) => ({ from: Math.round(t.from * 100), fee: Math.round(t.fee * 100) }));
    const min = Math.round((ch.minOrder || 0) * 100), fixed = Math.round((ch.fixedFee || 0) * 100);
    const feeAtC = (x) => { let f = T.length ? T[0].fee : 0; for (const t of T) if (x >= t.from) f = t.fee; return f; };
    const fee = amt >= min ? feeAtC(amt) : null;
    const nxt = T.find((t) => t.from > amt && t.fee < feeAtC(amt));
    const fr = T.find((t) => t.fee === 0 && (t.from > 0 || T.length > 1));
    return { rid, name: r.name, sim: !!r.simulated, pickup: pickup(r), amt, min, toMin: Math.max(0, min - amt), fee, fixed, total: fee == null ? null : fee + fixed, next: nxt ? { at: nxt.from, fee: nxt.fee, gap: nxt.from - amt } : null, free: fr ? { at: fr.from, gap: Math.max(0, fr.from - amt) } : T.length && T[0].fee === 0 ? { at: 0, gap: 0 } : null };
  }
  /* le panier compté aux prix d'une enseigne : montant des produits qu'elle vend, et combien elle n'en vend pas */
  function basketAt(rid) {
    let c = 0, miss = 0;
    for (const id of Object.keys(S.basket)) { const p = S.prods.get(id), o = p && p.offers[rid]; if (!p) continue; if (o && o.price > 0) c += Math.round(o.price * 100) * S.basket[id]; else miss++; }
    return { c, miss };
  }
  /* « Ton panier est à 74,20 € chez Houra : il manque 125,80 € pour la livraison offerte. » */
  function gapText(g, miss) {
    const at = `Ton panier est à ${eurC(g.amt)} chez ${g.name}${g.sim ? " (prix simulés)" : ""}${miss ? ` (sans ${plural(miss, "produit qu'elle ne vend pas", "produits qu'elle ne vend pas")})` : ""}`;
    if (g.toMin) return `${at}\u00a0: il manque ${eurC(g.toMin)} pour atteindre le minimum de commande de ${eurR(g.min / 100)}.`;
    if (g.pickup) return `${at}\u00a0: ${g.fee ? "retrait à " + eurC(g.fee) : "retrait gratuit"}.`;
    if (g.free && g.free.gap > 0) return `${at}\u00a0: il manque ${eurC(g.free.gap)} pour la livraison offerte.`;
    if (g.free) return `${at}\u00a0: la livraison est offerte.`;
    if (g.next) return `${at}\u00a0: il manque ${eurC(g.next.gap)} pour une livraison à ${eurC(g.next.fee)}.`;
    return `${at}\u00a0: livraison ${eurC(g.fee)}.`;
  }
  /* le panier, enseigne par enseigne : la plus proche de la livraison offerte d'abord */
  function basketGaps(only) {
    if (!count()) return [];
    return S.rets.filter((r) => retOn(r.id) && (!only || r.id === only)).map((r) => { const b = basketAt(r.id); return b.c ? { g: feeGap(r.id, b.c), miss: b.miss } : null; }).filter(Boolean)
      .sort((a, b) => (a.g.toMin - b.g.toMin) || ((a.g.free ? a.g.free.gap : 1e9) - (b.g.free ? b.g.free.gap : 1e9)));
  }
  /* barème d'une enseigne en une phrase : « 9,90 € dès 60 €, 7,90 € dès 120 €, offerte dès 200 € » */
  function tiersText(r) {
    const ch = r.channel || {}, T = tiersOf(r), min = ch.minOrder || 0;
    return T.map((t, i) => { const lo = Math.max(t.from, min), hi = T[i + 1] ? T[i + 1].from : null; if (hi != null && lo >= hi) return ""; return `${t.fee > 0 ? eur(t.fee) : pickup(r) ? "gratuit" : "offerte"} dès ${eurR(lo)}`; }).filter(Boolean).join(", ");
  }
  function feesAnswer(A) {
    if (A.ret) {
      const r = S.allMap.get(A.ret), ch = r.channel || {}, amt = A.amount ? Math.round(A.amount * 100) : 0, g = amt ? feeGap(r.id, amt) : null, bg = basketGaps(r.id)[0];
      return `<div class="hcard col fee"><b>${esc(r.name)}${r.group && ch.where ? ", " + esc(optionLabel(r).replace(/^./, (c) => c.toLowerCase())) : ""}</b>` +
        `<small>${pickup(r) ? "Retrait" : "Livraison"}\u00a0: ${esc(tiersText(r))}.${ch.minOrder ? " Commande minimum " + eurR(ch.minOrder) + "." : " Pas de minimum."}${ch.fixedFee ? " Frais de service " + eur(ch.fixedFee) + "." : ""}${r.simulated ? " Prix simulés, pas relevés." : ""}</small>` +
        (g ? `<p class="hint">Pour un panier de ${eurR(A.amount)}\u00a0: ${g.toMin ? `il manque ${eurC(g.toMin)} pour le minimum` : `${g.pickup ? "retrait" : "livraison"} ${g.fee ? eurC(g.fee) : g.pickup ? "gratuit" : "offerte"}${g.fixed ? " et " + eurC(g.fixed) + " de frais de service" : ""}${g.free && g.free.gap > 0 ? `, offerte dès ${eurR(g.free.at / 100)}` : ""}`}.</p>` : "") +
        (bg ? `<p class="hint">${esc(gapText(bg.g, bg.miss))}</p>` : "") +
        (!retOn(r.id) ? `<p class="hint">${esc(r.name)} n'est pas utilisée dans tes réglages.</p>` : "") +
        `<a class="btn tint sm" href="#/frais/${esc(r.group || r.id)}">Voir le guide des frais</a></div>`;
    }
    const rs = S.rets.filter((r) => retOn(r.id));
    return `<div class="hcard col fee"><b>Frais de livraison des enseignes</b>${rs.map((r) => `<small><b class="fn">${esc(r.name)}</b> ${esc(feeShort(r))}.</small>`).join("")}<a class="btn tint sm" href="#/frais">Voir le guide des frais</a></div>`;
  }
  /* exemples de demandes, sous le champ vide */
  const ASK_EX = ["pâtes complètes le moins cher au kilo", "lait à moins de 1 €", "petit-déjeuner pour 4 à moins de 15 €", "c'est combien la livraison chez Houra\u00a0?"];
  function askSheet() {
    const build = () => {
      const A = askNow(S.q.trim()), price = S.askOff.price;
      const cheap = A.parts.some((x) => x.k === "sort") && (A.sortK === "cheap") && !A.unitK;
      const rows = A.parts.map((x) => opt("askpart", esc(x.label.replace(/^./, (c) => c.toUpperCase())), !x.off, `data-k="${esc(x.k)}"`)).join("");
      return {
        body: `<p>Décoche ce qui ne va pas\u00a0: les résultats suivent tout de suite.</p>` +
          (A.label && A.kind !== "fees" ? `<div class="group"><div class="row"><span class="rt">Produit cherché<small>${esc(A.label)}</small></span></div></div>` : "") +
          (rows ? `<h3 class="gh" id="askpL">Ce que j'ai compris</h3><div class="group" role="group" aria-labelledby="askpL">${rows}</div>` : "") +
          (cheap ? `<h3 class="gh" id="askcL">«\u00a0Le moins cher\u00a0», c'est…</h3><div class="group" role="radiogroup" aria-labelledby="askcL">${opt("askprice", "Au kilo ou au litre, pour comparer les formats", !price, 'data-v="0"', null, true)}${opt("askprice", "Le prix du paquet, le plus petit montant", price, 'data-v="1"', null, true)}</div>` : ""),
        foot: `<button class="btn plain" type="button" data-act="askraw">Chercher «\u00a0${esc(S.q.trim().slice(0, 40))}\u00a0» tel quel</button>`,
      };
    };
    const o = build();
    openSheet({ title: "Pas ça\u00a0?", body: o.body, foot: o.foot, build, onClose: () => { if (S.route.name === "recherche") rerenderList(); } });
  }

  /* ---------- mon régime ---------- */
  /* Dit une fois dans les réglages (plusieurs cochables), le régime filtre la recherche, les rayons, Ma liste, les
     remplacements, les repas et les suggestions. Cabas se fie à ce que l'enseigne écrit sur le produit (étiquettes du
     catalogue, mots du nom) : les régimes « positifs » (halal, casher, végan, sans gluten, sans lactose, sans sucres)
     exigent l'étiquette ; « sans porc », « sans alcool » et « végétarien » écartent les produits dont le nom ou le rayon
     porte un mot d'exclusion. Jamais « garanti ». Le résultat est gardé par produit (p._diet) tant que le réglage ne
     change pas (DIETV). « Bio de préférence » n'est pas un filtre, c'est un bonus de tri. */
  const DIETS = [["bio", "Bio de préférence"], ["gluten", "Sans gluten"], ["lactose", "Sans lactose"], ["veg", "Végétarien"], ["vegan", "Végan"], ["halal", "Halal"], ["kosher", "Casher"], ["pork", "Sans porc"], ["alcohol", "Sans alcool"], ["sugar", "Sans sucres ajoutés"]];
  const EXCL = {
    meat: new Set("viande viandes boeuf veau agneau mouton porc porcs jambon jambons lardon lardons bacon saucisson saucissons saucisse saucisses merguez chorizo rillette rillettes pate terrine terrines foie boudin boudins knack knacks poulet dinde volaille volailles canard lapin steak steaks hache bolognaise carbonara chipolata chipolatas cordon nuggets poisson poissons thon saumon sardine sardines maquereau maquereaux cabillaud colin crevette crevettes surimi anchois hareng truite moule moules coquillage calamar gambas".split(" ")),
    porkish: new Set("porc porcs jambon jambons lardon lardons bacon saucisson saucissons chorizo rillette rillettes pate boudin boudins knack knacks chipolata chipolatas poitrine jambonneau andouille andouillette cochon cochonnaille saucisse saucisses carbonara".split(" ")),
    alcohol: new Set("alcool vin vins biere bieres cidre cidres champagne cremant mousseux whisky rhum vodka gin pastis liqueur aperitif digestif cognac armagnac calvados tequila porto martini punch sangria kir".split(" ")),
    /* un jambon de dinde, des saucisses de volaille, un vinaigre de vin : le mot du rayon ne vaut plus, le produit dit ce qu'il est */
    nopork: new Set("dinde volaille poulet boeuf veau agneau mouton canard lapin poisson saumon thon vegetal vegetarien vegan halal casher soja tofu".split(" ")),
    pork: new Set("porc porcs cochon lard lardon lardons bacon jambonneau andouille andouillette".split(" ")),
    noalc: new Set("vinaigre vinaigres vinaigrette vinaigrettes".split(" ")),
  };
  const DIETV = { v: 0 };
  const dietSet = () => S.prefs.diet || {};
  /* un régime strict est réglé (le bio n'en est pas un) */
  const dietOn = () => DIETS.some(([k]) => k !== "bio" && dietSet()[k]) || allergSet().length > 0;
  /* mots du nom (own) et du rayon, chacun avec « sans » devant quand c'est le cas (« sans porc », « sans alcool ») */
  function dietWords(p) {
    const mk = (txt) => { const w = norm(txt).split(" ").filter(Boolean), out = new Set(); w.forEach((t, i) => out.add(w[i - 1] === "sans" ? "sans " + t : t)); return out; };
    const own = mk(p.name), all = mk(p.name + " " + (rayon(p.r) || {}).name);
    return { own, all };
  }
  const hasAny = (set, words) => { for (const t of words) if (set.has(t)) return true; return false; };
  function dietOk(p, d) {
    d = d || dietSet();
    if (p._diet != null && p._dv === DIETV.v && !arguments[1]) return p._diet;
    const R = p.regimes || [], tags = (p.tags || []).map(norm);
    let ok = true, W = null;
    const words = () => W || (W = dietWords(p));
    if (d.gluten && !R.includes("sans-gluten")) ok = false;
    if (ok && d.lactose && !R.includes("sans-lactose")) ok = false;
    if (ok && d.halal && !R.includes("halal")) ok = false;
    if (ok && d.kosher && !R.includes("casher")) ok = false;
    if (ok && d.vegan && !R.includes("vegan")) ok = false;
    if (ok && d.veg && !R.includes("vegetarien") && !R.includes("vegan") && hasAny(EXCL.meat, words().all)) ok = false;
    /* sans porc : un mot de porc explicite dans le nom écarte ; une autre viande nommée (dinde, volaille, bœuf) lève le
       doute d'un « jambon » ou d'une « saucisse » ; sinon tout mot de charcuterie du nom ou du rayon écarte */
    if (ok && d.pork && (hasAny(EXCL.pork, words().own) || (!hasAny(EXCL.nopork, words().own) && hasAny(EXCL.porkish, words().all)))) ok = false;
    if (ok && d.alcohol && (p.u === "cave" || (!hasAny(EXCL.noalc, words().own) && hasAny(EXCL.alcohol, words().all)))) ok = false;
    if (ok && d.sugar && !tags.some((t) => /^sans sucre/.test(t))) ok = false;
    /* allergènes à éviter : seulement quand Open Food Facts connaît le produit (fiche ouverte une fois sur ce téléphone) */
    if (ok && !arguments[1] && allergHit(p).length) ok = false;
    if (!arguments[1]) { p._diet = ok; p._dv = DIETV.v; }
    return ok;
  }
  /* bio d'abord à prix au kilo égal à 10 % près, quand « Bio de préférence » est coché */
  const bioFirst = (a, b, va, vb) => (dietSet().bio && Math.abs(va - vb) <= 0.1 * Math.max(va, vb) ? +(b.regimes || []).includes("bio") - +(a.regimes || []).includes("bio") : 0);
  const dietLabel = () => { const on = DIETS.filter(([k]) => dietSet()[k]).map(([, l]) => l.toLowerCase().replace(/ de préférence$/, "")).concat(allergSet().map((a) => "sans " + ALLERG.get(a).toLowerCase())); return on.length ? joinEt(on) : "aucun"; };
  /* ce que le régime écarte, en un mot, pour une ligne de Ma liste ou un ingrédient (« halal », « sans porc ») */
  const dietWhy = () => DIETS.filter(([k]) => k !== "bio" && dietSet()[k]).map(([, l]) => l.toLowerCase()).concat(allergSet().map((a) => "sans " + ALLERG.get(a).toLowerCase())).join(", ");
  function dietSheet(fromWelcome) {
    const build = () => {
      const d = dietSet();
      const chips = DIETS.map(([k, l]) => { const on = !!d[k]; const n = on && k !== "bio" ? S.list.reduce((a, p) => a + (dietOk(p, { [k]: true }) ? 1 : 0), 0) : null; return `<button class="chip dietchip" type="button" data-act="dietchip" data-k="${k}" aria-pressed="${on}">${l}${n != null ? `<small>${plural(n, "produit", "produits")}</small>` : ""}</button>`; }).join("");
      const A = allergSet(), achips = ALLERGENS.map(([k, l]) => `<button class="chip" type="button" data-act="allergchip" data-k="${k}" aria-pressed="${A.includes(k)}">${l}</button>`).join("");
      return { body: `<p>Cabas ne te propose plus que ce qui correspond, partout : recherche, rayons, Ma liste, repas et remplacements.</p><div class="tagset diet" role="group" aria-label="Mon régime">${chips}</div><p class="gf">Cabas se fie à ce qui est écrit sur le produit par l'enseigne : son nom et ses mentions. Rien n'est garanti, vérifie toujours l'emballage.</p><h3 class="gh" id="allergL">Allergènes à éviter</h3><div class="tagset" role="group" aria-labelledby="allergL">${achips}</div><p class="gf">Cabas écarte un produit qui en contient ou peut en contenir (traces) quand Open Food Facts le dit, pour les produits dont la fiche a été ouverte sur ce téléphone. Pour les autres, rien n'est vérifié\u00a0: lis toujours l'emballage.</p>` };
    };
    const o = build();
    openSheet({ title: "Mon régime", body: o.body, build, onClose: () => { if (!fromWelcome && S.route.name === "reglages") rerender(); } });
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
    const diet = dietOn() && f.diet !== false;
    let out = list.filter((p) => {
      if (diet && !dietOk(p)) return false;
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
    if (s === "prix") out.sort((a, b) => bioFirst(a, b, price(a), price(b)) || price(a) - price(b));
    else if (s === "prixdesc") out.sort((a, b) => price(b) - price(a));
    else if (s === "unite") out.sort((a, b) => bioFirst(a, b, unit(a), unit(b)) || unit(a) - unit(b));
    else if (s === "ecart") out.sort((a, b) => gap(b) - gap(a));
    else if (s === "nom") out.sort((a, b) => (a.brand + " " + a.name).localeCompare(b.brand + " " + b.name, "fr"));
    else if (!keepOrder) out.sort((a, b) => a.rank - b.rank);
    return out;
  }

  /* ---------- panier : modèle et calcul ---------- */
  function tiersOf(r) {
    const ch = r.channel || {}, ov = S.prefs.fee[r.id] || {};
    const base = ov.base != null ? ov.base : (ch.tiers && ch.tiers[0] ? ch.tiers[0].fee : 0);
    const T = (ch.tiers && ch.tiers.length ? ch.tiers : [{ from: 0, fee: 0 }]).map((t, i) => ({ from: t.from || 0, fee: i === 0 ? base : t.half ? base / 2 : t.fee || 0 })).sort((a, b) => a.from - b.from);
    /* les frais ne remontent jamais quand le panier grossit : un créneau moins cher que le palier suivant vaut aussi
       au-dessus (la répartition du panier compte là-dessus pour rester exacte) */
    for (let i = 1; i < T.length; i++) T[i].fee = Math.min(T[i].fee, T[i - 1].fee);
    return T;
  }
  function chansOf(rets) {
    const out = [];
    for (const r of rets) {
      if (S.prefs.off[offKey(r)] || !r.channel) continue;
      const ch = r.channel;
      out.push({ id: r.id, store: { retailer: r.id }, P: { min: Math.round((ch.minOrder || 0) * 100), fixed: Math.round((ch.fixedFee || 0) * 100), tiers: tiersOf(r).map((t) => ({ from: Math.round(t.from * 100), fee: Math.round(t.fee * 100) })) } });
    }
    return out;
  }
  /* Achat en magasin : un produit que les commandes ne prennent pas peut s'acheter dans une enseigne qui a des
     magasins (réglage « magasin » de data/retailers.json), au prix relevé le plus bas, jamais à un prix simulé.
     Au plus un quart des produits du panier, pour que la commande reste la base des courses.
     Réglage « Sans achat en magasin » coché (S.prefs.comp === false) : aucun, tout passe par les commandes. */
  /* Règles de la personne pour un produit, par groupe d'enseigne (comme prefs.off) : épinglé à une enseigne (prefs.pin,
     ignoré quand l'enseigne n'est pas utilisée) ou exclu de certaines (prefs.ban) ; équivalents acceptés (cabas.flex,
     panier souple), pris seulement à un prix relevé. */
  const pinOf = (id) => (S.prefs.pin || {})[id] || "";
  const banOf = (id) => (S.prefs.ban || {})[id] || {};
  const flexOf = (id) => ((S.flex || {})[id] || []).map((e) => S.prods.get(e) || S.prods.get((S.alias || {})[e])).filter((e) => e && e.id !== id);
  const saveFlex = () => store.set("flex", S.flex);
  /* empreinte des règles des produits du panier, pour savoir quand refaire la répartition */
  function rulesKey(items) {
    const pin = {}, ban = {}, fx = {};
    for (const id of Object.keys(items || S.basket)) { if (pinOf(id)) pin[id] = pinOf(id); if (Object.keys(banOf(id)).length) ban[id] = banOf(id); if ((S.flex || {})[id]) fx[id] = S.flex[id]; }
    return [pin, ban, fx];
  }
  /* Modèle du panier pour un réglage (optimizer.js, buildModel). o, pour les calculs d'appoint : drop (un groupe
     d'enseigne retiré, « Et si : sans Carrefour »), add (produits ajoutés, « Compléter malin »), basket (un autre panier),
     exact (sans les équivalents), free (sans épingles ni exclusions). */
  function model(mode, o) {
    o = o || {};
    const chans = chansOf(retsFor(mode)).filter((ch) => !o.drop || offKey(S.allMap.get(ch.id)) !== o.drop);
    const store = chans.map((ch) => { const r = S.allMap.get(ch.id); return !!(r && r.magasin && !r.simulated); });
    const groups = chans.map((ch) => offKey(S.allMap.get(ch.id)));
    const items = Object.assign({}, o.basket || S.basket, o.add || {}), src = [];
    for (const id of Object.keys(items)) {
      const q = items[id], p = S.prods.get(id);
      if (!p || !(q > 0)) continue;
      const pin = o.free ? "" : pinOf(id), ban = o.free ? {} : banOf(id), usePin = !!pin && groups.includes(pin), no = [];
      groups.forEach((g, ci) => { if ((usePin && g !== pin) || ban[g]) no.push(ci); });
      const opts = [p].concat(o.exact ? [] : flexOf(id)).map((e) => ({ id: e.id, at: chans.map((ch) => { const x = e.offers[ch.id]; return x && x.price > 0 ? { cost: Math.round(x.price * 100) * q, sim: !!x.sim } : null; }) }));
      src.push({ id, q, opts, no });
    }
    return buildModel(src, chans, store, mode !== false);
  }
  /* Répartition du panier : chaque nombre de commandes, de 1 au nombre d'enseignes, est calculé une fois, du plus petit au
     plus grand (optimizer.js, runAll). RES.steps[k] = { full, partial, truncated } : « full » prend tout le panier en
     k commandes au plus, « partial » laisse de côté les produits qu'aucune commande possible ne peut prendre. */
  /* Les deux réglages « Sans achat en magasin » sont calculés pour le même panier, celui qui est choisi d'abord : le panier
     dit ce que coûte l'autre, et basculer de l'un à l'autre ne relance pas le calcul. RES.by[mode] = { M, steps, done },
     mode true = achat en magasin et retrait permis, false = tout livré. RES.queue : les réglages en cours de calcul. */
  const RES = {
    base: "", by: null, mode: true, queue: [], K: 3, lambda: 0,
    get M() { return this.by ? this.by[this.mode].M : null; },
    get steps() { return this.by ? this.by[this.mode].steps : {}; },
    get done() { return !this.by || this.by[this.mode].done; },
    get other() { return this.by ? this.by[!this.mode].steps : {}; },
    get otherDone() { return !this.by || this.by[!this.mode].done; },
  };
  let W = null, wSeq = 0, wBusy = false, cartTimer = 0;
  function cartResult() {
    const mode = S.prefs.comp !== false;
    const base = JSON.stringify([S.basket, S.prefs.off, S.prefs.fee, S.prefs.extraCost, retsFor(true).map((r) => r.id), retsFor(false).map((r) => r.id), rulesKey()]);
    if (!RES.by || RES.base !== base) {
      const by = { true: { M: model(true), steps: {}, done: false }, false: { M: model(false), steps: {}, done: false } };
      for (const m of [true, false]) if (!by[m].M.lines.length || !by[m].M.chans.length) by[m].done = true;
      Object.assign(RES, { base, mode, by, queue: [], lambda: Math.round((S.prefs.extraCost || 0) * 100) });
      const todo = [mode, !mode].filter((m) => !by[m].done);
      if (todo.length) startCalc(todo);
    } else if (RES.mode !== mode) {
      RES.mode = mode;
      /* le réglage choisi n'est ni calculé ni en cours de calcul : il passe en premier */
      if (!RES.by[mode].done && RES.queue[0] !== mode) startCalc(RES.by[!mode].done ? [mode] : [mode, !mode]);
    }
    RES.K = Math.max(1, Math.min(RES.M.chans.length || 1, S.prefs.maxOrders || 3));
    return RES;
  }
  function collect(seq, msg) {
    if (seq !== wSeq || !RES.by) return false;
    const mode = msg.mode == null ? RES.mode : msg.mode, r = RES.by[mode];
    if (msg.done) { r.done = true; RES.queue = RES.queue.filter((x) => x !== mode); }
    else r.steps[msg.k] = msg;
    return true;
  }
  function runSync(seq, modes, ms) {
    for (const mode of modes) { const M = RES.by[mode].M; runAll(M, M.chans.length, RES.lambda, (msg) => collect(seq, Object.assign({ mode }, msg)), ms); }
  }
  function startCalc(modes) {
    const seq = ++wSeq;
    RES.queue = modes.slice();
    if (Math.max(...modes.map((m) => RES.by[m].M.lines.length)) <= 10 || typeof Worker === "undefined") {
      if (W && wBusy) { W.terminate(); W = null; wBusy = false; }
      runSync(seq, modes, 1500);
      return;
    }
    try {
      if (W && wBusy) { W.terminate(); W = null; }
      if (!W) {
        W = new Worker("worker.js");
        W.onmessage = (ev) => { const d = ev.data; if (d.idle) { wBusy = false; return; } if (collect(d.seq, d)) cartUpdate(d); };
        W.onerror = () => {
          wBusy = false; W = null;
          const q = RES.queue.slice();
          if (q.length) { runSync(++wSeq, q, 3000); cartUpdate({ done: true }); }
        };
      }
      wBusy = true;
      W.postMessage({ seq, lambda: RES.lambda, modes: modes.map((mode) => ({ mode, M: RES.by[mode].M })) });
    } catch (err) { runSync(seq, modes, 3000); }
  }
  /* une étape du calcul est arrivée : le panier n'est redessiné que si le nombre de commandes choisi est concerné */
  function cartUpdate(d) {
    /* une feuille qui compare au total du panier (Compléter malin, tenir le budget) et la section « Et si » suivent le calcul */
    if (d.done) auxPaint();
    /* « Remplir mes paniers » avant le premier geste montre la répartition en cours : redessinée quand elle arrive */
    if (S.route.name === "remplir") { if ((d.done || d.k === RES.K) && $("#sheet").hidden && (!fillUsable() || (S.route.id && !fillOrd(S.route.id)))) { clearTimeout(cartTimer); cartTimer = setTimeout(rerender, 40); } return; }
    if (S.route.name !== "panier") return;
    const K = RES.K, st = RES.steps[K];
    let redraw = false;
    if (d.mode != null && d.mode !== RES.mode) redraw = d.k === K || (d.done && !(RES.other[K] || {}).full);
    else if (d.done) redraw = !st || !st.full;
    else if (d.k === K) redraw = true;
    else if (d.k > K && st && !st.full && d.full) {
      redraw = true;
      for (let k = K + 1; k < d.k; k++) if ((RES.steps[k] || {}).full) redraw = false;
    }
    if (redraw) { clearTimeout(cartTimer); cartTimer = setTimeout(rerender, 40); }
    else updateSegLabels();
  }
  const fullTotal = (r) => r.itemsTotal + r.feesTotal + (r.compTotal || 0);
  function segLabel(k) {
    const s = RES.steps[k];
    /* un trait d'union conditionnel : dans la colonne étroite du grand écran, « incom-plet » plutôt qu'une coupure au hasard */
    return !s ? "…" : s.full ? eurC(fullTotal(s.full)) : "incom\u00adplet";
  }
  function updateSegLabels() { document.querySelectorAll("[data-segk]").forEach((el) => { el.textContent = segLabel(+el.dataset.segk); }); }
  function nextTier(ch, sub) {
    const P = ch.P, cur = feeAt(P, sub);
    for (const t of P.tiers) if (t.from > sub) { const f2 = feeAt(P, t.from); if (f2 < cur) return { need: t.from - sub, fee: f2 - P.fixed }; }
    return null;
  }

  /* Calculs d'appoint (Et si, Compléter malin, tenir le budget) : un second worker, pour ne jamais retarder la
     répartition du panier. Chaque résultat (bestAt : la meilleure répartition de tout le panier en K commandes au plus)
     est gardé sous sa clé tant que le panier et ses réglages ne changent pas (RES.base) ; une clé déjà demandée n'est
     pas recalculée. Sans worker, le calcul se fait ici, une clé à la fois. */
  const AUX = { base: "", res: new Map(), asked: new Set(), W: null, n: 0, seq: 0, t: 0 };
  function auxReset() {
    if (AUX.base === RES.base) return;
    AUX.base = RES.base; AUX.res.clear(); AUX.asked.clear(); AUX.seq++;
    if (AUX.W && AUX.n) { AUX.W.terminate(); AUX.W = null; AUX.n = 0; }
  }
  const auxGet = (key) => { auxReset(); return AUX.res.get(key); };
  function auxAsk(jobs) {
    auxReset();
    const todo = jobs.filter((j) => !AUX.res.has(j.key) && !AUX.asked.has(j.key));
    if (!todo.length) return;
    todo.forEach((j) => AUX.asked.add(j.key));
    const seq = AUX.seq, list = todo.map((j) => ({ key: j.key, M: typeof j.M === "function" ? j.M() : j.M, K: j.K }));
    const got = (key, r) => { if (seq !== AUX.seq) return; AUX.res.set(key, r); auxPaint(); };
    const here = () => list.forEach((j, i) => setTimeout(() => got(j.key, bestAt(j.M, j.K, RES.lambda, 1500)), i * 4));
    if (typeof Worker === "undefined") { here(); return; }
    try {
      if (!AUX.W) {
        AUX.W = new Worker("worker.js");
        /* le gestionnaire sert à tous les envois : il range chaque résultat du panier en cours, pas celui de son premier envoi */
        AUX.W.onmessage = (ev) => { const d = ev.data; if (d.kind === "jobs" && d.idle) AUX.n = Math.max(0, AUX.n - 1); else if (d.kind === "job" && d.seq === AUX.seq) { AUX.res.set(d.key, d.r); auxPaint(); } };
        AUX.W.onerror = () => { AUX.W = null; AUX.n = 0; AUX.asked.clear(); };
      }
      AUX.n++;
      AUX.W.postMessage({ kind: "jobs", seq, lambda: RES.lambda, jobs: list });
    } catch (e) { here(); }
  }
  /* un résultat arrivé : la feuille qui en dépend et la section « Et si » se redessinent, le focus reste en place */
  function auxPaint() {
    clearTimeout(AUX.t);
    AUX.t = setTimeout(() => {
      if (sheetCtx && sheetCtx.aux) refreshSheet();
      const el = S.route.name === "panier" && $("#wif");
      if (el) patchHtml(el, wifBody());
    }, 30);
  }
  function patchHtml(el, html) {
    const ae = document.activeElement, key = ae && el.contains(ae) ? sameAs(ae) : "";
    el.innerHTML = html;
    if (key) { const n = $(key, el); if (n) n.focus({ preventScroll: true }); }
  }
  /* résumé d'une répartition calculée ici (comme bestAt dans le worker) */
  const briefOf = (st) => {
    const r = st && st.full;
    return st ? { full: r ? { total: fullTotal(r), orders: r.orders.map((o) => ({ id: o.ch.id, sub: o.sub, fee: o.fee, n: o.items.length })), comp: (r.completed || []).length, skipped: 0, alts: altCount(r) } : null, partial: st.partial ? { skipped: (st.partial.skipped || []).length } : null } : undefined;
  };
  /* équivalents pris par Cabas dans une répartition (panier souple) */
  const altCount = (r) => (r ? r.orders.reduce((a, o) => a + o.items.filter((x) => x.alt).length, 0) + (r.completed || []).filter((x) => x.alt).length : 0);

  /* ---------- composants ---------- */
  function buyCtl(id, v) {
    const q = S.basket[id] || 0, p = S.prods.get(id);
    const nm = p ? esc(p.brand + " " + p.name) : "";
    /* à 1, le moins devient une corbeille « Retirer » */
    const dec = `<button type="button" data-act="dec" data-id="${esc(id)}" aria-label="${q > 1 ? "Retirer un" : "Retirer"}">${ic(q > 1 ? "minus" : "trash", q > 1 ? "" : "trash")}</button>`;
    const inc = `<button type="button" data-act="inc" data-id="${esc(id)}" aria-label="Ajouter un">${ic("plus")}</button>`;
    if (v === "bar") {
      const b = p && best(p);
      if (q > 0) return `<div class="buybar" data-buy="${esc(id)}" data-v="bar"><div class="stepper" role="group" aria-label="Quantité">${dec}<span aria-live="polite">${q}</span>${inc}</div><a class="btn" href="#/panier" data-tab="panier">Voir le panier</a></div>`;
      return `<div class="buybar" data-buy="${esc(id)}" data-v="bar"><button type="button" class="btn" data-act="inc" data-id="${esc(id)}"${b ? "" : " disabled"}>Ajouter au panier${b ? ` <span class="sub">${eur(b.price)}</span>` : ""}</button></div>`;
    }
    if (q > 0 || v === "item") return `<div class="stepper${v === "flat" ? " flat" : ""}${v === "item" ? " soft" : ""}" data-buy="${esc(id)}" data-v="${v}" role="group" aria-label="Quantité de ${nm}">${dec}<span aria-live="polite">${q}</span>${inc}</div>`;
    return `<button type="button" class="add${v === "flat" ? " flat" : ""}" data-buy="${esc(id)}" data-v="${v}" data-act="inc" data-id="${esc(id)}" aria-label="Ajouter ${nm} au panier">${ic("plus")}</button>`;
  }
  /* carte produit : une pastille au plus (« Offre »), prix et prix au kilo, l'enseigne, marque et nom ; le format suit
     le nom quand il est court. La carte entière est un lien nommé en entier (nom, format, prix, enseigne) ; le texte
     dessous est un second lien hors tabulation. extra : { was } pour un ancien prix barré et la baisse en pastille */
  function card(p, extra) {
    const b = best(p);
    const badge = b && b.promo ? '<span class="badge promo">Offre</span>' : "";
    const u = b ? unitPrice(p, b.price) : "";
    const shortFmt = (p.format || "").length <= 8;
    const label = p.brand + " " + p.name + (p.format ? ", " + p.format : "") + (b ? ", " + eur(b.price) + " chez " + retName(b.ret) + (b.sim ? ", prix simulé" : "") : ", pas dans tes enseignes");
    const was = extra && extra.was > 0 && b && b.price < extra.was ? `<s class="was"><span class="sr">au lieu de </span>${eur(extra.was)}</s><span class="drop">-${Math.round((100 * (extra.was - b.price)) / extra.was)}${NB}%</span>` : "";
    return `<article class="card"><div class="tile"><a class="cover" href="${hp(p.id)}" aria-label="${esc(label)}">${img(p)}</a>${badge}${b ? buyCtl(p.id, "tile") : ""}</div>` +
      `<a class="meta" href="${hp(p.id)}" tabindex="-1"><div class="prow">${b ? px(b.price) + was + (u ? `<span class="unit">${u}</span>` : "") : '<span class="na">Pas dans tes enseignes</span>'}</div>` +
      (b ? `<div class="where">chez ${esc(retName(b.ret))}${b.sim ? ", prix simulé" : ""}</div>` : "") +
      `<div class="pname"><b>${esc(p.brand)}</b> ${esc(p.name)}${shortFmt && p.format ? ", " + esc(p.format) : ""}</div>${shortFmt ? "" : `<div class="pfmt">${esc(p.format)}</div>`}</a></article>`;
  }
  function deals(n) {
    const out = [];
    const diet = dietOn();
    for (const p of S.list) {
      if (diet && !dietOk(p)) continue;
      const os = offers(p, true).filter((o) => !o.sim);
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
      `<ul class="ladder">${rows}</ul><div class="df"><span class="gap"><span>${eur(d.gap)}</span> d'écart</span><button class="icbtn dsh" type="button" data-act="sharegap" data-id="${esc(p.id)}" aria-label="Partager cet écart de prix">${ic("share")}</button>${buyCtl(p.id, "flat")}</div></article>`;
  }
  /* libellés courts des tuiles de rayon (deux lignes au plus, sans césure) ; le nom complet reste le titre du rayon */
  const SHORT = {
    "pommes-de-terre": "Pommes de terre", "salades-herbes": "Salades et herbes", "fruits-secs": "Fruits secs", "veau-agneau": "Veau, agneau", volaille: "Volailles", "viande-hachee": "Viande hachée", "saucisses-merguez": "Saucisses", poissons: "Poissons", crustaces: "Fruits de mer", "traiteur-mer": "Saumon fumé",
    lait: "Lait", "laits-autres": "Autres laits", yaourts: "Yaourts", "yaourts-fruits": "Yaourts aux fruits", "fromage-blanc": "Fromage blanc", "desserts-frais": "Desserts frais", beurre: "Beurre", creme: "Crème", fromages: "Fromage râpé", "fromages-pate-molle": "Camembert, brie", "fromages-pate-pressee": "Emmental, comté", "chevre-brebis": "Chèvre, brebis", "fromages-tartiner": "Fromage à tartiner", "fromages-cuisiner": "Mozzarella, feta", "fromages-coupe": "Fromages à la coupe",
    "jambon-blanc": "Jambon blanc", "jambon-cru": "Jambon cru", saucisson: "Saucisson", lardons: "Lardons", "saucisses-boudins": "Knacks, boudins", "pates-rillettes": "Pâtés, rillettes", "aperitif-frais": "Apéritif frais", "plats-cuisines-frais": "Plats cuisinés", "pizzas-quiches-fraiches": "Pizzas, quiches", "pates-fraiches": "Pâtes fraîches", "salades-sandwichs": "Salades, sandwichs", "traiteur-vegetal": "Traiteur végétal",
    pain: "Pain", "pain-de-mie": "Pain de mie", viennoiseries: "Viennoiseries", patisseries: "Pâtisseries", glaces: "Glaces", "legumes-surgeles": "Légumes surgelés", frites: "Frites", "pizzas-surgelees": "Pizzas surgelées", "plats-surgeles": "Plats surgelés", "poissons-surgeles": "Poissons surgelés", "viandes-surgelees": "Viandes surgelées", "aperitifs-surgeles": "Apéritifs surgelés", "desserts-surgeles": "Desserts surgelés",
    "semoule-cereales": "Semoule, quinoa", "legumes-secs": "Légumes secs", tomates: "Tomates", "conserves-legumes": "Légumes en conserve", thon: "Thon", conserves: "Sardines", "plats-conserve": "Plats en conserve", soupes: "Soupes", huile: "Huiles", "vinaigre-vinaigrette": "Vinaigres", epices: "Sel, épices", bouillons: "Bouillons", "mayonnaise-ketchup": "Mayo, ketchup", "sauces-chaudes": "Sauces tomate", "sauces-monde": "Sauces du monde", "cornichons-olives": "Cornichons, olives", "biscuits-aperitif": "Biscuits apéritif",
    cafe: "Café", capsules: "Capsules de café", infusions: "Infusions", "chocolat-poudre": "Chocolat en poudre", cereales: "Céréales", "barres-cereales": "Barres de céréales", confitures: "Confitures, miel", "pate-a-tartiner": "Pâte à tartiner", biscottes: "Biscottes",
    gateaux: "Gâteaux", "biscuits-secs": "Biscuits secs", "biscuits-chocolat": "Biscuits au chocolat", "crepes-gaufres": "Crêpes, gaufres", "chocolat-tablettes": "Chocolat", "chocolat-bouchees": "Bouchées, barres", bonbons: "Bonbons", compotes: "Compotes", sucre: "Sucre", "aide-patisserie": "Aide à la pâtisserie",
    eaux: "Eaux", "eaux-gazeuses": "Eaux gazeuses", jus: "Jus d'orange", "jus-autres": "Autres jus", sirops: "Sirops", sodas: "Colas", limonades: "Limonades, tonics", "boissons-plates": "Thés glacés", "boissons-vegetales": "Boissons végétales", "cidres-sans-alcool": "Cidres, sans alcool", "vin-rouge": "Vins rouges", "vin-blanc": "Vins blancs", "vin-rose": "Vins rosés", champagne: "Champagnes", aperitifs: "Apéritifs", spiritueux: "Spiritueux",
    "lait-infantile": "Laits infantiles", "repas-bebe": "Petits pots", "desserts-bebe": "Desserts bébé", couches: "Couches", "toilette-bebe": "Toilette bébé", "gel-douche": "Gels douche", shampoing: "Shampoings", "soins-cheveux": "Soins des cheveux", dentifrice: "Dentifrice", rasage: "Rasage", "hygiene-feminine": "Hygiène féminine", "soins-corps": "Soins du corps", "soins-visage": "Soins du visage", papier: "Papier toilette", "mouchoirs-cotons": "Mouchoirs, cotons", "premiers-soins": "Premiers soins", complements: "Compléments",
    lessive: "Lessive", "lessive-capsules-poudre": "Lessive en capsules", adoucissant: "Adoucissants", vaisselle: "Vaisselle", "lave-vaisselle": "Lave-vaisselle", "nettoyants-menagers": "Nettoyants", "wc-deboucheurs": "WC, déboucheurs", "essuie-tout": "Essuie-tout", "sacs-poubelle": "Sacs poubelle", conservation: "Sacs, film, alu", "desodorisants-insecticides": "Désodorisants",
    "croquettes-chat": "Croquettes chat", "patee-chat": "Pâtée chat", litiere: "Litière", "croquettes-chien": "Croquettes chien", "patee-chien": "Pâtée chien", "autres-animaux": "Autres animaux", halal: "Halal", vegan: "Vegan", asie: "Cuisine asiatique", "mexique-usa": "Tex-mex", oriental: "Cuisine orientale",
  };
  const shortName = (r) => SHORT[r.id] || r.name;
  /* le produit qui illustre un rayon : vendu par plusieurs enseignes de préférence */
  const repOf = (r) => { const L = inRayon(r.id); return L.find((p) => offers(p, false).length > 1) || L[0] || null; };
  function catTile(r, big) {
    const rep = repOf(r);
    if (big) return `<a class="cat" href="${hr(r.id)}" aria-label="${esc(r.name)}, ${plural(r.count || 0, "produit", "produits")}"><span class="ct">${rep ? img(rep, 160) : ""}</span><b>${esc(r.name)}</b><small>${plural(r.count || 0, "produit", "produits")}</small></a>`;
    return `<a class="cat" href="${hr(r.id)}" aria-label="${esc(r.name)}"><span class="ct">${rep ? img(rep, 160) : ""}</span><span>${esc(shortName(r))}</span></a>`;
  }
  /* « Tes rayons » : ceux des produits du panier, des listes et des trois derniers paniers commandés, par fréquence, 8 au plus */
  function myRayons() {
    const cnt = new Map();
    const add = (items) => Object.keys(items || {}).forEach((id) => { const p = S.prods.get(id); if (p) cnt.set(p.r, (cnt.get(p.r) || 0) + 1); });
    add(S.basket);
    S.lists.forEach((L) => add(L.items));
    (S.hist || []).filter((h) => h.items).slice(-3).forEach((h) => add(h.items));
    return [...cnt.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => rayon(id)).filter(Boolean).slice(0, 8);
  }
  function suggestion() {
    if (S._sug) return S._sug;
    const want = ["eaux", "lait", "pates", "cafe", "yaourts", "fromages", "jus", "papier", "vaisselle", "lessive", "oeufs", "beurre", "riz", "huile", "jambon-blanc", "pain", "fruits", "legumes", "fromages-pate-pressee", "cereales"].filter((r) => S.rayMap.has(r)).slice(0, 12);
    const items = {}, fit = (x) => !dietOn() || dietOk(x);
    for (const r of want) {
      const L = inRayon(r);
      const p = L.find((x) => fit(x) && offers(x, false).length >= 3) || L.find((x) => fit(x) && offers(x, false).length >= 2);
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
    return `<section class="hcard col" aria-label="${esc(sg.name)}"><div class="stack">${ids.slice(0, 6).map((id) => `<span>${img(S.prods.get(id), 48)}</span>`).join("")}</div><span><b>${esc(sg.name)}</b><small>${plural(e.n, "produit", "produits")} du quotidien vendus dans plusieurs enseignes, environ ${eur(e.t)} au meilleur prix.</small></span><div class="btns two"><button class="btn sm tint" type="button" data-act="addlist" data-id="${esc(sg.id)}">${ic("plus")}Tout ajouter</button><a class="btn sm ghost" href="#/suggestion">Voir les produits</a></div></section>`;
  }
  /* Android (Chrome, Samsung Internet) : le navigateur propose l'installation en un geste ; on garde l'invitation pour la
     montrer au bon moment (carte de l'accueil, réglages) */
  let installEvt = null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; if (S.ready && S.route.name === "home" && $("#sheet").hidden) rerender(); });
  window.addEventListener("appinstalled", () => { installEvt = null; S.seen.install = true; store.set("seen", S.seen); toast("Cabas est sur ton écran d'accueil"); });
  async function installNow() {
    if (!installEvt) { installSheet(); return; }
    const ev = installEvt; installEvt = null;
    try { await ev.prompt(); const r = await ev.userChoice; if (!r || r.outcome !== "accepted") installEvt = ev; } catch (e) { installEvt = ev; }
    rerender();
  }
  function installCard() {
    if (standalone() || S.seen.install || (!isIOS && !installEvt)) return "";
    if (installEvt) return `<div class="hcard tint" role="status"><svg class="si" aria-hidden="true"><use href="#i-logo"/></svg><span><b>Installe Cabas sur ton téléphone</b><small>Une icône sur l'écran d'accueil, l'appli en plein écran, et les prix même sans réseau.</small><button class="btn sm" type="button" data-act="installnow">Installer</button></span><button class="x" type="button" data-act="hideinstall" aria-label="Masquer">${ic("x")}</button></div>`;
    return `<div class="hcard tint" role="status"><svg class="si" aria-hidden="true"><use href="#i-logo"/></svg><span><b>Installe Cabas sur ton iPhone</b><small>Touche ${ic("share")} en bas de Safari, puis «\u00a0Sur l'écran d'accueil\u00a0».</small></span><button class="x" type="button" data-act="hideinstall" aria-label="Masquer">${ic("x")}</button></div>`;
  }
  function footNote() {
    return `<p class="foot">${plural(S.list.length, "produit", "produits")} de ${esc(joinEt(S.rets.map((r) => r.service)))}. ${esc(freshText())}.<br><a class="act" href="#/apropos">À propos des prix${ic("chev")}</a></p>`;
  }
  /* hors ligne : les prix affichés sont ceux du dernier relevé */
  const netBanner = () => (S.offline ? `<div class="banner" role="status">${ic("wifi-off")}<span><b>Hors ligne</b>Les prix affichés sont ceux du dernier relevé.</span></div>` : "");
  function chipsHtml(key, base) {
    const f = F(key), n = nActive(f);
    const has = (fn) => base.some(fn);
    const sortL = (SORTS.find((s) => s[0] === f.sort) || SORTS[0])[1];
    let s = `<div class="chips" role="group" aria-label="Trier et filtrer"><button class="chip" type="button" data-act="sort" data-k="${esc(key)}" aria-pressed="${f.sort !== "pertinence"}">${ic("sort")}${f.sort === "pertinence" ? "Trier" : esc(sortL)}</button>`;
    s += `<button class="chip" type="button" data-act="filters" data-k="${esc(key)}" aria-pressed="false">${ic("filter")}Filtres${n ? `<span class="n">${n}</span>` : ""}</button>`;
    if (dietOn()) s += `<button class="chip" type="button" data-act="quick" data-q="diet" data-k="${esc(key)}" aria-pressed="${f.diet !== false}">Mon régime</button>`;
    /* mode confort : les filtres rapides restent dans « Filtres », pour moins d'éléments à l'écran */
    if (simpleOn()) return s + "</div>";
    if (has((p) => Object.keys(p.offers).length > 1)) s += `<button class="chip" type="button" data-act="quick" data-q="cmp" data-k="${esc(key)}" aria-pressed="${f.cmp}">Comparables</button>`;
    if (has((p) => Object.values(p.offers).some((o) => o.promo))) s += `<button class="chip" type="button" data-act="quick" data-q="promo" data-k="${esc(key)}" aria-pressed="${f.promo}">Offres</button>`;
    if (has((p) => (p.tags || []).includes("Bio"))) s += `<button class="chip" type="button" data-act="quick" data-q="bio" data-k="${esc(key)}" aria-pressed="${!!f.tags.Bio}">Bio</button>`;
    if (has((p) => p.type === "mdd")) s += `<button class="chip" type="button" data-act="quick" data-q="mdd" data-k="${esc(key)}" aria-pressed="${f.type === "mdd"}">Marques distributeur</button>`;
    return s + "</div>";
  }
  /* grille chargée par étapes de 16 produits (deux colonnes, huit rangées) quand on descend : le premier affichage
     d'un rayon ne dessine pas ses 150 produits */
  function lazyGrid(key, items, step) {
    /* mode confort : une colonne, huit produits d'abord */
    step = step || (simpleOn() ? 8 : 16);
    S.lazy[key] = items;
    const n = Math.min(items.length, Math.max(step, S.shown[key] || step));
    S.shown[key] = n;
    return `<div class="grid" data-lazy="${esc(key)}">${items.slice(0, n).map(card).join("")}</div>${items.length > n ? `<div class="more" data-more="${esc(key)}"></div>` : ""}`;
  }
  let lazyObs = null;
  function mountLazy() {
    markEnds();
    if (lazyObs) lazyObs.disconnect();
    const sentinels = $$("[data-more]");
    if (!sentinels.length || !("IntersectionObserver" in window)) return;
    lazyObs = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const key = en.target.dataset.more, items = S.lazy[key] || [], grid = $(`[data-lazy="${CSS.escape(key)}"]`);
        if (!grid) continue;
        const n0 = S.shown[key] || 0, n1 = Math.min(items.length, n0 + (simpleOn() ? 12 : 24));
        grid.insertAdjacentHTML("beforeend", items.slice(n0, n1).map(card).join(""));
        S.shown[key] = n1;
        if (n1 >= items.length) { lazyObs.unobserve(en.target); en.target.remove(); }
      }
    }, { rootMargin: "600px 0px" });
    sentinels.forEach((s) => lazyObs.observe(s));
  }
  /* illustration d'un état vide : des emballages dessinés (packs.js) quand un produit existe, une icône sinon */
  function emptyArt(n) {
    if (n === "bag" && S.list.length) {
      const fan = ["eaux", "pates", "lait"].map((r) => S.list.find((p) => p.r === r)).filter(Boolean);
      if (fan.length === 3) return `<div class="art"><div class="fan">${fan.map((p) => img(p, 80)).join("")}</div></div>`;
    }
    if (n === "list" && S.list.length) { const p = S.list.find((x) => x.r === "cafe") || S.list[0]; return `<div class="art">${img(p, 96)}</div>`; }
    return `<div class="art">${ic(n)}</div>`;
  }
  /* page absente : le titre nomme l'objet (produit, enseigne, liste, recette), le bouton ramène à l'accueil */
  function notFound(what) {
    const T = { enseigne: ["Cette enseigne n'existe pas", "Les enseignes de Cabas sont dans les réglages."], liste: ["Cette liste n'existe plus", "Elle a été supprimée de cet appareil."], recette: ["Cette recette n'existe pas", "Les repas à petit prix sont dans «\u00a0Repas\u00a0»."], rayon: ["Ce rayon n'existe pas", "Les rayons couverts sont dans «\u00a0Rayons\u00a0»."] };
    const [h, p] = T[what] || ["Ce produit n'est plus dans le catalogue", "Les prix sont mis à jour à chaque relevé."];
    return { title: "Introuvable", html: `<div class="empty" role="alert">${emptyArt("search")}<h1 class="t1">${h}</h1><p>${p}</p><a class="btn" href="#/">Revenir à l'accueil</a></div>` };
  }

  /* ---------- écrans ---------- */
  const VIEWS = {};

  /* listes toutes faites, pour voir en un geste ce que fait Cabas (produits des rayons couverts) */
  /* chaque liste nomme les rayons dont elle a besoin (needs) : elle n'est proposée que quand ils sont dans le catalogue */
  const EXAMPLES = [
    ["semaine", "La semaine", "6 litres de lait, 3 paquets de pâtes, 12 œufs, beurre, yaourts nature x4, 12 bouteilles d'eau, papier toilette, café x2, jus d'orange x3, riz, huile de tournesol, thon x3, tomates pelées x2, sardines x2, emmental râpé, madeleines x2, coca 1,5 l x4, lessive, liquide vaisselle, sucre, farine", ["lait", "pates", "oeufs"]],
    ["petitdej", "Petit-déjeuner", "café moulu, lait demi-écrémé, jus d'orange, madeleines, sucre en poudre, beurre", ["cafe", "lait", "jus"]],
    ["pates", "Dîner de pâtes", "spaghetti, thon au naturel, tomates pelées, huile d'olive, emmental râpé", ["pates", "thon", "tomates"]],
    ["apero", "Apéro et dîner", "jambon blanc x2, camembert, saucisson, chips, bière blonde x6, vin rouge, pain", ["jambon-blanc", "fromages-pate-molle", "saucisson", "chips", "bieres", "vin-rouge"]],
    ["famille", "La famille", "couches taille 4, lait infantile, compotes, croquettes chat, lessive capsules, dentifrice, gel douche", ["couches", "lait-infantile", "croquettes-chat", "lessive-capsules-poudre", "dentifrice"]],
    ["menage", "Ménage", "lessive liquide, liquide vaisselle, papier toilette x2", ["lessive", "vaisselle", "papier"]],
  ];
  const examples = () => (S.rayMap ? EXAMPLES.filter(([, , , needs]) => needs.every((r) => S.rayMap.has(r))) : EXAMPLES.filter(([k]) => k !== "apero" && k !== "famille")).slice(0, 4);
  /* « 34 rayons dans 7 univers : crèmerie, épicerie salée… » */
  function coverText() {
    const G = univGroups();
    return `Rayons couverts pour l'instant\u00a0: ${plural(S.rayons.filter((r) => r.count).length, "rayon", "rayons")} dans ${joinEt(G.map((g) => g.u.name.toLowerCase()))}`;
  }
  /* quelqu'un qui découvre Cabas : rien dans le panier, pas de liste, pas de commande, questions de départ pas encore vues */
  const newcomer = () => !S.seen.welcome && !count() && !S.hist.length && !S.lists.length;
  function heroHtml() {
    const ex = examples().map(([k, l]) => `<button class="chip" type="button" data-act="wlex" data-k="${k}">${esc(l)}</button>`).join("");
    return `<div class="hero"><h1>Tes courses au prix le plus bas, livraison comprise.</h1>` +
      `<p class="lede">Les mêmes produits chez Monoprix, Carrefour, Houra et Auchan, aux prix relevés sur leurs sites. Écris ta liste\u00a0: Cabas trouve chaque produit au meilleur prix et répartit tes commandes, frais compris.</p>` +
      `<a class="btn" href="#/ecrire">${ic("pen")}Écrire ma liste</a><p class="try">Ou essaie avec une liste toute faite</p><div class="exrow">${ex}<a class="chip" href="#/listes">Par profil${ic("chev")}</a></div>` +
      `<p class="trust">Gratuit, sans compte, sans publicité. En Île-de-France pour l'instant. <a href="#/comment">Comment ça marche</a></p></div>`;
  }
  VIEWS.home = () => {
    const ds = deals(8);
    /* « Tes rayons » d'abord, puis les rayons fournis (10 produits au moins) dans l'ordre du magasin, puis les autres */
    const mine = myRayons(), rest = S.rayons.filter((r) => !mine.includes(r) && r.count), top = mine.concat(rest.filter((r) => r.count >= 10), rest.filter((r) => r.count < 10)).slice(0, simpleOn() ? 5 : 7);
    const tiles = top.map((r) => catTile(r)).join("") + `<a class="cat" href="#/rayons"><span class="ct all">${ic("grid")}</span><span>Tous les rayons</span></a>`;
    const sg = suggestion();
    const first = newcomer();
    /* le jour des courses, la carte du panier de la semaine remplace « Tes prochaines courses », « À racheter bientôt »
       et « Tes habitudes » ;
       trois rangées au plus : les plus personnelles d'abord (seuils atteints, baisses de tes produits, à racheter, habitudes), puis les
       écarts de prix, les repas et les offres */
    const prep = first ? null : prepNow();
    const upper = [], lower = [];
    for (const f of [watchRail, dropsRail, prep ? () => "" : dueRail, prep ? () => "" : habitsRail, () => (ds.length ? `<div class="sh"><h2>Même produit, pas le même prix</h2></div><div class="rail deals" role="region" aria-label="Même produit, pas le même prix">${ds.map(dealCard).join("")}</div>` : "")]) { if (upper.length < 3) { const h = f(); if (h) upper.push(h); } }
    for (const f of simpleOn() ? [] : [recRail, promosRail]) if (upper.length + lower.length < 3) { const h = f(); if (h) lower.push(h); }
    /* le panier type de la personne remplace le panier tout prêt des débuts */
    const tpl = !simpleOn() && Object.keys(sg.items).length && !weekTpl();
    return {
      title: "",
      /* le wordmark compact tient lieu de titre dans la barre ; le titre de contenu est la promesse, ou « Accueil » pour les lecteurs d'écran */
      left: `<a class="wordmark" href="#/" data-tab="accueil" aria-label="Cabas, accueil"><svg aria-hidden="true"><use href="#i-logo"/></svg>Cabas</a>`,
      right: `<a class="icbtn" href="#/reglages" aria-label="Réglages">${ic("gear")}</a>`,
      html: (first ? heroHtml() : `<h1 class="sr">Accueil</h1>`) + netBanner() +
        `<div class="srow"><button class="search" type="button" data-act="gosearch">${ic("search")}<span>Un produit, une marque, un rayon</span></button><a class="icbtn" href="#/scan" aria-label="Scanner un code-barres">${ic("scan")}</a></div>` +
        `<p class="fresh${isStale() ? " old" : ""}">${ic("clock")}<span>${esc(freshText())}${isStale() ? ", ils ont pu changer depuis" : ""}</span></p>` +
        (first ? "" : `<a class="hcard" href="#/ecrire">${ic("pen", "si")}<span><b>Écris ou dicte ta liste</b><small>Cabas trouve chaque produit au meilleur prix</small></span>${ic("chev", "chev")}</a>`) +
        (!first && !S.seen.welcome ? `<button class="hcard" type="button" data-act="welcome">${ic("gear", "si")}<span><b>Dis-nous où tu fais tes courses</b><small>Enseignes, déplacement ou tout livré, nombre de personnes</small></span>${ic("chev", "chev")}</button>` : "") +
        fillHomeCard() +
        prepCard(prep) +
        arrivalCard() +
        todoCard() +
        (prep ? "" : nextCard()) +
        ordersCard() +
        savingsCard() +
        installCard() +
        upper.join("") +
        `<div class="sh"><h2>${mine.length ? "Tes rayons" : "Rayons"}</h2><a class="act" href="#/rayons">Tout voir${ic("chev")}</a></div><div class="cats">${tiles}</div>` +
        /* mode confort : moins d'éléments, les repas restent dans Listes et les offres sur les fiches */
        lower.join("") + (tpl ? `<div class="sh"><h2>Panier tout prêt</h2></div>${suggestCard(sg)}` : "") +
        footNote(),
    };
  };

  /* Rayons par univers : grandes tuiles, un bloc repliable par univers (état gardé par appareil, cabas.univ), « Tes
     rayons » en tête, et un champ qui filtre les rayons sur place (nom du rayon ou de l'univers, sans réseau) */
  const univGroups = () => S.univers.map((u) => ({ u, items: S.rayons.filter((r) => r.u === u.id && r.count) })).filter((g) => g.items.length);
  const univOpen = (u, i) => { const st = store.get("univ", null); if (st && u in st) return !!st[u]; return i < 2 || window.innerWidth >= 960; };
  function rayonsBody(q) {
    const nq = norm(q || "");
    if (nq) {
      const toks = nq.split(" ").filter(Boolean);
      const hit = S.rayons.filter((r) => r.count && toks.every((t) => (norm(r.name) + " " + norm(univName(r.u)) + " " + norm(shortName(r))).split(" ").some((w) => w.startsWith(t))));
      return hit.length ? `<p class="count">${plural(hit.length, "rayon", "rayons")} pour « ${esc(q.trim())} »</p><div class="cats big">${hit.map((r) => catTile(r, true)).join("")}</div>`
        : `<div class="empty">${emptyArt("search")}<h2>Aucun rayon</h2><p>Aucun rayon ne s'appelle « ${esc(q.trim())} ». Cherche plutôt un produit : Cabas trouve son rayon.</p><button class="btn plain" type="button" data-act="setq" data-q="${esc(q.trim())}">Chercher « ${esc(q.trim())} » dans les produits</button></div>`;
    }
    const mine = myRayons(), G = univGroups();
    const chips = G.length > 3 ? `<div class="chips univ" role="group" aria-label="Aller à un univers">${G.map((g) => `<button class="chip" type="button" data-act="univgo" data-u="${esc(g.u.id)}">${esc(g.u.name)}</button>`).join("")}</div>` : "";
    return (mine.length ? `<h2 class="gh big">Tes rayons</h2><div class="cats">${mine.map((r) => catTile(r)).join("")}</div>` : "") + chips +
      G.map((g, i) => `<details class="univ" id="univ-${esc(g.u.id)}" data-u="${esc(g.u.id)}"${univOpen(g.u.id, i) ? " open" : ""}><summary><span class="rt"><h2 class="gh big">${esc(g.u.name)}</h2><small>${plural(g.items.length, "rayon", "rayons")}, ${plural(g.items.reduce((a, r) => a + r.count, 0), "produit", "produits")}</small></span>${ic("chev", "chev")}</summary><div class="cats big">${g.items.map((r) => catTile(r, true)).join("")}</div></details>`).join("");
  }
  VIEWS.rayons = () => ({
    title: "Rayons", grouped: true,
    html: `<h1 class="lt">Rayons</h1><div class="srow"><label class="search">${ic("search")}<input id="rq" type="search" enterkeyhint="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Chercher un rayon" value="${esc(S.rq || "")}" aria-label="Chercher un rayon"><button type="button" class="clr" data-act="clearrq"${S.rq ? "" : " hidden"} aria-label="Effacer">${ic("xc")}</button></label></div><div id="rlist">${rayonsBody(S.rq)}</div>` + footNote(),
    mount: markEnds,
  });

  VIEWS.rayon = (r) => {
    const ray = rayon(r.id);
    if (!ray) return notFound("rayon");
    const key = "r:" + ray.id, f = F(key);
    const base = inRayon(ray.id);
    const list = applyFilters(base, f);
    const cmp = base.filter((p) => offers(p, false).length > 1).length;
    const virt = ray.virtuel && ray.virtuel.length;
    const sub = virt ? `${plural(base.length, "produit", "produits")} de tous les rayons, d'après ce que les enseignes indiquent` : plural(base.length, "produit", "produits") + (cmp ? ", dont " + cmp + " vendus dans plusieurs enseignes" : "");
    const count = list.length !== base.length ? (dietOn() && f.diet !== false && nActive(f) === 0 ? `${plural(list.length, "produit correspond", "produits correspondent")} à ton régime, d'après ce que les enseignes indiquent` : `${plural(list.length, "produit correspond", "produits correspondent")} à tes filtres`) : "";
    return {
      title: ray.name,
      html: `<h1 class="lt">${esc(ray.name)}</h1><p class="lt-sub">${sub}</p>` + chipsHtml(key, base) +
        (count ? `<p class="count">${count}</p>` : "") +
        (list.length ? lazyGrid(key, list) : `<div class="empty">${emptyArt("filter")}<h2>Aucun produit</h2><p>Aucun produit de ce rayon ne correspond à tes filtres${dietOn() && f.diet !== false ? " ni à ton régime" : ""}.</p><button class="btn plain" type="button" data-act="freset" data-k="${esc(key)}">Effacer les filtres</button></div>`) +
        (ray.frais ? `<p class="gf">Produits au poids : le prix exact dépend de la pesée, la contenance est celle que l'enseigne indique.</p>` : "") + footNote(),
      mount: mountLazy,
    };
  };

  /* comparer, préviens-moi, signaler : les gestes de la fiche, en lignes */
  function pActs(p) {
    const w = watchOf(p.id), hit = w && watchHits().some((x) => x.id === p.id);
    return `<div class="group pacts" style="margin-top:24px">` +
      `<button class="row" type="button" data-act="cmppick" data-id="${esc(p.id)}">${ic("cmp", "ext")}<span class="rt">Comparer avec un autre produit<small>Prix au kilo, contenance, régimes</small></span>${ic("chev", "chev")}</button>` +
      `<button class="row" type="button" data-act="watch" data-id="${esc(p.id)}">${ic("bell", "ext")}<span class="rt">${w ? `Prévenu sous ${eurC(w.max)}` : "Préviens-moi quand le prix baisse"}<small>${w ? (hit ? "C'est le cas aujourd'hui" : "L'accueil te le dira") : "Choisis ton prix, l'accueil te le dira"}</small></span>${ic("chev", "chev")}</button>` +
      `<button class="row" type="button" data-act="report" data-id="${esc(p.id)}">${ic("flag", "ext")}<span class="rt">Signaler une erreur<small>Prix, nom, contenance, lien ou rayon</small></span>${ic("chev", "chev")}</button></div>`;
  }
  VIEWS.produit = (r) => {
    const p = S.prods.get(r.id) || S.prods.get((S.alias || {})[r.id]);
    if (!p) return notFound();
    const all = offers(p, false), on = offers(p, true), b = on[0] || null;
    const ray = rayon(p.r);
    const hi = on.length > 1 ? on[on.length - 1] : null;
    const u = b ? unitPrice(p, b.price) : "";
    /* lignes par enseigne : prix et date tout de suite ; le nom affiché par l'enseigne, le lien de la fiche, le texte
       de l'offre et le prix barré viennent des détails de l'univers, remplacés en place quand ils arrivent */
    const rows = (det) => all.map((o) => {
      const off = !retOn(o.ret), low = b && o.ret === b.ret && on.length > 1 && !o.sim, d = det && det[o.ret];
      const name = det ? (d && d.name) || "" : null;
      return `<a class="row offer${off ? " off" : ""}" href="${esc(offerUrl(det, o.ret))}" target="_blank" rel="noopener"><span class="mono" aria-hidden="true">${esc(retName(o.ret).slice(0, 1))}</span><span class="rt"><span class="on">${esc(retName(o.ret))}${low ? '<span class="tag low">Le moins cher</span>' : ""}${o.sim ? '<span class="tag sim" aria-label="prix simulé">Simulé</span>' : ""}</span>` +
        (name == null ? `<span class="os skl s" aria-hidden="true"></span>` : name ? `<span class="os">${esc(name)}</span>` : "") + `<span class="os">${esc(offerWhen(o))}${o.cat ? ", page du rayon" : ""}${off ? ", enseigne désactivée" : ""}</span>${o.promo ? `<span class="os promo">Offre${d && d.promo ? " : " + esc(d.promo) : " en cours"}</span>` : ""}</span>` +
        `<span class="op">${px(o.price)}${o.was && d && d.was > o.price ? `<s class="was"><span class="sr">au lieu de </span>${eur(d.was)}</s>` : ""}${unitPrice(p, o.price) ? `<span class="unit">${p.approx ? "env. " : ""}${unitPrice(p, o.price)}</span>` : ""}</span></a>`;
    }).join("");
    const toks = norm(p.name).split(" ").filter((t) => t.length > 3 && !/^\d/.test(t)).slice(0, 4);
    const sim = inRayon(p.r).filter((x) => x.id !== p.id && toks.some((t) => norm(x.name).includes(t)) && (!dietOn() || dietOk(x))).slice(0, 60)
      .map((x) => ({ x, b: best(x) })).filter((y) => y.b).sort((a, c) => a.b.price - c.b.price).slice(0, 10).map((y) => y.x);
    const dietLine = dietOn() ? (dietOk(p) ? "Correspond à ton régime, d'après ce que l'enseigne indique" + (allergSet().length ? (factsOf(p) && factsOf(p).ok ? " et Open Food Facts" : ". Allergènes pas connus pour ce produit\u00a0: vérifie l'emballage") : "") : "Ne correspond pas à ton régime (" + dietWhy() + "), d'après ce que l'enseigne" + (allergHit(p).length ? " et Open Food Facts indiquent" : " indique")) : "";
    const spec = [["Marque", p.brand], ["Contenance", p.format + (p.approx ? ", estimée" : "")], ["Description", p.desc && !/^Contenance/.test(p.desc) ? p.desc : ""], ["Mentions", (p.tags || []).join(", ")], ["Mon régime", dietLine], ["Rayon", ray ? ray.name + (ray.u ? ", " + univName(ray.u).toLowerCase() : "") : ""], ["Type", p.type === "mdd" ? "Marque distributeur, vendue chez " + joinEt(Object.keys(p.offers || {}).filter((k) => S.retMap.has(k)).map(retName)) : "Grande marque"], ["Code EAN", p.ean]].filter((x) => x[1]);
    const promo = !!(b && b.promo);
    const det0 = detailsNow(p);
    return {
      title: p.brand + " " + p.name, anchor: ".ph h1", dock: "bar", dockId: p.id,
      mount: () => {
        const here = () => S.route.name === "produit" && S.prods.get(S.route.id) === p;
        if (!HIST) loadHist().then(() => { const el = $("#phist"); if (el && here()) el.innerHTML = histHtml(p); });
        if (!det0) details(p).then((det) => { const el = $("#poffers"); if (el && here()) el.innerHTML = rows(det); });
        /* Nutri-Score et allergènes : demandés à Open Food Facts une fois, la section suit */
        if (factsAuto()) factsLoad(p, () => { const el = $("#pfacts"); if (el && here()) el.innerHTML = factsHtml(p); });
      },
      right: `<button class="icbtn" type="button" data-act="share" data-id="${esc(p.id)}" aria-label="Partager">${ic("share")}</button>`,
      html: `<div class="pdp"><div class="pimg">${img(p, 480)}${promo ? '<span class="badge promo">Offre</span>' : ""}</div>` +
        `<div class="pmain"><div class="ph"><p class="pb">${esc(p.brand)}</p><h1>${esc(p.name)}</h1><p class="pf">${esc(p.format)}${p.approx ? " (contenance estimée)" : ""}${u ? ", " + (p.approx ? "environ " : "") + esc(u) : ""}${p.frais ? ", prix ajusté à la pesée" : ""}</p>` +
        (b ? `<div class="pprice">${px(b.price)}${b.sim ? '<span class="tag sim lg">Prix simulé</span>' : on.length > 1 ? '<span class="sticker lg">Prix le plus bas</span>' : ""}<p class="pw">chez <b>${esc(retName(b.ret))}</b>${b.sim ? " (prix simulé)" : ""}${hi && hi.price - b.price >= 0.01 ? `, ${eur(hi.price - b.price)} de moins que chez ${esc(retName(hi.ret))}` : ""}</p></div>` : `<p class="pw" style="margin-top:14px">Ce produit n'est vendu par aucune de tes enseignes activées.</p>`) +
        `<div class="pinline">${buyCtl(p.id, "bar")}</div></div></div>` +
        `<div class="pmore"><h2 class="gh">Prix dans ${all.length > 1 ? "les enseignes" : "l'enseigne"}</h2><div class="group" id="poffers">${rows(det0)}</div><p class="gf">Touche une enseigne pour ouvrir le produit sur son site. Les offres (2e à moitié prix, cagnotte) ne sont pas déduites des totaux.${p.eq ? " Produits sans marque rapprochés entre enseignes : équivalents, pas la même référence." : ""}</p><div id="phist">${histHtml(p)}</div><div id="pfacts">${factsHtml(p)}</div>` + pActs(p) +
        `<h2 class="gh">Caractéristiques</h2><div class="group"><dl class="spec">${spec.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl></div></div>` +
        (sim.length ? `<div class="pfull"><div class="sh"><h2>Dans le même rayon</h2>${ray ? `<a class="act" href="${hr(ray.id)}">Tout voir${ic("chev")}</a>` : ""}</div><div class="rail" role="region" aria-label="Dans le même rayon">${sim.map((x) => card(x)).join("")}</div></div>` : "") + `</div>`,
    };
  };

  /* marques vendues par plusieurs enseignes, les plus fournies d'abord */
  function topBrands() {
    const brands = new Map();
    S.list.forEach((p) => { if (Object.keys(p.offers).length > 1) brands.set(p.brand, (brands.get(p.brand) || 0) + 1); });
    return [...brands.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map((x) => x[0]);
  }
  /* complétion pendant la frappe, dès deux lettres : produits habituels (par nom), rayons, marques comparées, par début
     du dernier mot ; quatre au plus. Un produit remplace la requête, un rayon ou une marque complète son dernier mot. */
  function suggestions(q) {
    const words = norm(q).split(" ").filter(Boolean), last = words[words.length - 1] || "";
    if (last.length < 2) return [];
    const head = words.slice(0, -1).join(" "), withLast = (s) => (head ? head + " " + s : s);
    const out = [], seen = new Set([norm(q)]);
    const put = (label, qv) => { const k = norm(qv); if (seen.has(k)) return; seen.add(k); out.push([label, qv]); };
    for (const p of habits(20)) { if (out.length >= 4) break; if (idx(p)._b.startsWith(last) || norm(p.name).split(" ").some((w) => w.startsWith(last))) put(p.brand + " " + p.name, p.brand + " " + p.name); }
    for (const r of S.rayons) { if (out.length >= 4) break; if (norm(r.name).split(" ").some((w) => w.startsWith(last))) put(r.name, withLast(r.name)); }
    for (const b of topBrands()) { if (out.length >= 4) break; if (norm(b).startsWith(last)) put(b, withLast(b)); }
    return out;
  }
  const suggHtml = (L) => L.map(([l, qv]) => `<button class="chip" type="button" data-act="setq" data-q="${esc(qv)}"><span>${esc(l)}</span></button>`).join("");
  function searchBody() {
    const q = S.q.trim();
    if (!q) {
      const top = topBrands();
      return `<div class="group" style="margin-top:4px"><a class="row" href="#/ecrire">${ic("pen", "ext")}<span class="rt">Chercher toute une liste<small>Colle ou dicte ta liste, Cabas trouve chaque produit</small></span>${ic("chev", "chev")}</a><a class="row" href="#/frais">${ic("truck", "ext")}<span class="rt">Frais de livraison<small>Minimum, livraison offerte, retrait\u00a0: enseigne par enseigne</small></span>${ic("chev", "chev")}</a></div>` +
        `<div class="sh"><h2>Demande à Cabas</h2></div><p class="gf ask">Écris comme tu parles\u00a0: un produit, un prix, un régime, pour combien de personnes. Tout est compris sur ton téléphone.</p><div class="tagset askex">${ASK_EX.map((x) => `<button class="chip" type="button" data-act="setq" data-q="${esc(x)}">${esc(x)}</button>`).join("")}</div>` +
        (S.recent.length ? `<div class="sh"><h2>Recherches récentes</h2><button class="act" type="button" data-act="clearrecent">Effacer</button></div><div class="group">${S.recent.map((x) => `<button class="row" type="button" data-act="setq" data-q="${esc(x)}">${ic("clock", "ext")}<span class="rt">${esc(x)}</span></button>`).join("")}</div>` : "") +
        `<div class="sh"><h2>Marques comparées</h2></div><div class="tagset">${top.map((x) => `<button class="chip" type="button" data-act="setq" data-q="${esc(x)}">${esc(x)}</button>`).join("")}</div>` +
        `<div class="sh"><h2>Rayons</h2></div><div class="cats">${S.rayons.filter((r) => r.count).map((r) => catTile(r)).join("")}</div>`;
    }
    /* Demande à Cabas : frais, liste composée, ou produit avec ses conditions ; un simple mot reste une recherche */
    const A = askNow(q), head = askHead(A);
    if (A.kind === "fees") return head + feesAnswer(A);
    if (A.kind === "list") return head + composeHtml(A);
    if (A.kind === "none") return head + `<div class="empty">${emptyArt("search")}<h2>Quel produit\u00a0?</h2><p>Par exemple «\u00a0pâtes le moins cher au kilo\u00a0» ou «\u00a0lait à moins de 1\u00a0€\u00a0».</p></div>`;
    const key = "s", f = F(key);
    const smart = A.kind === "product" && A.smart;
    const base = askBase(q), list = applyFilters(base, f, true);
    if (smart) return head + (list.length ? askAnswer(A, list) + chipsHtml(key, base) + `<p class="count">${plural(list.length, "produit répond", "produits répondent")} à ta demande</p>` + lazyGrid(key, list) : askAnswer(A, []));
    /* le rayon qui porte le mot cherché (« lait », « huile d'olive ») passe en tête, avec son nombre de produits */
    const rq = norm(S.fixed ? S.fixed.to : q).split(" ").filter((t) => t && !STOP.has(t)).map(stem);
    const rhit = rq.length ? S.rayons.filter((r) => r.count && rq.every((t) => norm(r.name).split(" ").some((w) => w === t || stem(w) === t || (t.length >= 4 && w.startsWith(t))))).slice(0, 2) : [];
    const rcard = rhit.map((r) => `<a class="hcard" href="${hr(r.id)}"><span class="thumb">${repOf(r) ? img(repOf(r), 48) : ""}</span><span><b>Rayon ${esc(r.name)}</b><small>${plural(r.count, "produit", "produits")}${r.u ? ", " + esc(univName(r.u).toLowerCase()) : ""}</small></span>${ic("chev", "chev")}</a>`).join("");
    if (!base.length) return head + rcard + `<div class="empty">${emptyArt("search")}<h2>Aucun résultat</h2><p>Rien ne correspond à «\u00a0${esc(q)}\u00a0». Vérifie l'orthographe ou cherche une marque, par exemple Lactel ou Barilla.</p><button class="btn plain" type="button" data-act="report" data-k="demande" data-q="${esc(q)}">Demander ce produit</button></div>`;
    /* un mot corrigé : la correction est toujours dite */
    const dietCut = dietOn() && f.diet !== false && list.length !== base.length;
    const count = S.fixed ? `Résultats pour «\u00a0${esc(S.fixed.to)}\u00a0»\u00a0: ${plural(dietCut ? base.length : list.length, "produit", "produits")}` : plural(dietCut ? base.length : list.length, "résultat", "résultats");
    const dietNote = dietCut ? `, dont ${plural(list.length, "correspond", "correspondent")} à ton régime` : "";
    return head + rcard + chipsHtml(key, base) + `<p class="count">${count}${dietNote}</p>` + (list.length ? lazyGrid(key, list) : `<div class="empty">${emptyArt("filter")}<h2>Aucun produit</h2><p>Aucun résultat ne correspond à tes filtres${dietOn() && f.diet !== false ? " ni à ton régime" : ""}.</p><button class="btn plain" type="button" data-act="freset" data-k="s">Effacer les filtres</button></div>`);
  }
  VIEWS.recherche = () => ({
    title: "Recherche",
    right: `<a class="icbtn" href="#/scan" aria-label="Scanner un code-barres">${ic("scan")}</a>`,
    html: `<h1 class="lt">Recherche</h1><div class="srow"><label class="search">${ic("search")}<input id="q" type="search" enterkeyhint="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Un produit, une marque, une question" value="${esc(S.q)}" aria-label="Rechercher un produit, une marque, ou poser une question"><button type="button" class="clr" data-act="clearq"${S.q ? "" : " hidden"} aria-label="Effacer la recherche">${ic("xc")}</button></label></div><div class="sugg" id="sugg" role="group" aria-label="Suggestions" hidden></div><div id="sres" aria-label="Résultats">${searchBody()}</div>`,
    mount: () => { mountLazy(); if (S.focusSearch) { S.focusSearch = false; const i = $("#q"); if (i) { i.focus(); } } },
  });

  function listRow(L) {
    const ids = Object.keys(L.items).filter((id) => S.prods.has(id));
    const e = estimate(L.items);
    return `<a class="row th" href="#/liste/${esc(L.id)}"><span class="thumb">${ids[0] ? img(S.prods.get(ids[0]), 48) : ""}</span><span class="rt">${esc(L.name)}<small>${plural(e.n, "produit", "produits")}, environ ${eur(e.t)}</small></span>${ic("chev", "chev")}</a>`;
  }
  /* ---------- listes toutes faites par profil (data/listes.json) ---------- */
  /* Étudiant, famille, senior, petit budget, végétarien, bébé : chaque liste s'ouvre dans Ma liste, où chaque ligne est
     cherchée aux prix relevés ; les listes « semaine » sont faites pour atteindre le minimum de commande d'une enseigne. */
  let PROF = null, profP = null;
  function loadProfiles() {
    if (!profP) profP = fetch("data/listes.json").then((r) => (r.ok ? r.json() : null)).then((j) => { PROF = j && Array.isArray(j.listes) ? j : { profils: [], listes: [] }; return PROF; }).catch(() => { profP = null; return null; });
    return profP;
  }
  /* le profil proposé d'abord : végétarien d'après le régime, famille d'après le foyer, sinon le premier */
  const profDefault = () => (dietSet().veg ? "vegetarien" : (+S.prefs.foyer || 0) >= 3 ? "famille" : ((PROF && PROF.profils[0]) || {}).k);
  const linesOf = (text) => String(text || "").split(/,(?!\d)/).filter((x) => x.trim()).length;
  function profHtml() {
    if (!PROF) return `<h2 class="gh" id="profT">Listes toutes faites</h2><div class="group" aria-busy="true"><div class="row"><span class="rt"><span class="skl"></span><small class="skl s"></small></span></div></div>`;
    if (!PROF.profils.length) return "";
    const cur = PROF.profils.some((p) => p.k === S.prof) ? S.prof : profDefault(), P = PROF.profils.find((p) => p.k === cur) || PROF.profils[0];
    const L = PROF.listes.filter((x) => x.base === P.k);
    return `<h2 class="gh" id="profT">Listes toutes faites</h2><div class="tagset" role="radiogroup" aria-labelledby="profT">${PROF.profils.map((p) => `<button class="chip" type="button" role="radio" data-act="prof" data-k="${esc(p.k)}" aria-checked="${p.k === P.k}">${esc(p.label)}</button>`).join("")}</div>` +
      `<p class="gf">${esc(P.hint || "")}.</p><div class="group" style="margin-top:10px">${L.map((x) => `<button class="row" type="button" data-act="wlprof" data-k="${esc(x.k)}"><span class="rt">${esc(x.label)}<small>${plural(linesOf(x.text), "ligne", "lignes")}${x.kind === "semaine" ? `, de quoi atteindre le minimum de commande${x.budget ? ", environ " + eurR(x.budget) + " livraison comprise" : ""}` : ", un petit appoint"}</small></span>${ic("chev", "chev")}</button>`).join("")}</div>` +
      `<p class="gf">Chaque liste s'ouvre dans Ma liste : Cabas cherche chaque produit au meilleur prix, et tu peux tout changer avant d'ajouter au panier.</p>`;
  }
  VIEWS.listes = () => {
    const n = count(), sg = suggestion();
    return {
      title: "Listes", grouped: true,
      mount: () => { if (!PROF) loadProfiles().then(() => { const el = $("#profs"); if (el && S.route.name === "listes") el.innerHTML = profHtml(); }); },
      html: `<h1 class="lt">Listes</h1>` +
        `<div class="pad btns" style="padding-top:4px"><a class="btn" href="#/ecrire">${ic("pen")}Écrire ou dicter une liste</a><a class="btn tint" href="#/repas">Repas à petit prix</a>${n ? `<button class="btn tint" type="button" data-act="savelist">${ic("plus")}Enregistrer le panier en liste</button>` : ""}</div>` +
        (S.lists.length ? `<h2 class="gh">Mes listes</h2><div class="group">${S.lists.map(listRow).join("")}</div><p class="gf">Une liste se remet dans le panier en un geste.</p>` :
          `<div class="empty" style="padding-top:28px">${emptyArt("list")}<h2>Aucune liste</h2><p>Enregistre ton panier en liste pour le refaire la semaine prochaine en un geste.</p></div>`) +
        `<div id="profs">${profHtml()}</div>` +
        (Object.keys(sg.items).length ? `<h2 class="gh">Suggestion</h2>${suggestCard(sg)}` : ""),
    };
  };
  function itemsList(items) {
    return Object.keys(items).filter((id) => S.prods.has(id)).map((id) => {
      const p = S.prods.get(id), b = best(p), q = items[id];
      return `<a class="row th" href="${hp(id)}"><span class="thumb">${img(p, 48)}</span><span class="rt"><b style="font-weight:600">${esc(p.brand)}</b> ${esc(p.name)}<small>${esc(p.format)}${b ? ", " + eur(b.price) + " chez " + esc(retName(b.ret)) + (b.sim ? " (simulé)" : "") : ", pas dans tes enseignes"}</small></span><span class="val num">× ${q}</span></a>`;
    }).join("");
  }
  /* les produits du panier type, chacun avec son rythme (à chaque fois, toutes les 2 semaines…) */
  function tplItems(L) {
    return Object.keys(L.items).filter((id) => S.prods.has(id)).map((id) => {
      const p = S.prods.get(id), b = best(p), c = (L.cad || {})[id] || 0;
      return `<div class="row th tpl"><span class="thumb">${img(p, 48)}</span><span class="rt"><a href="${hp(id)}"><b style="font-weight:600">${esc(p.brand)}</b> ${esc(p.name)}<small>${L.items[id] > 1 ? L.items[id] + "\u00a0× " : ""}${esc(p.format)}${b ? ", " + eur(b.price) + " chez " + esc(retName(b.ret)) + (b.sim ? " (simulé)" : "") : ", pas dans tes enseignes"}</small></a><button class="act" type="button" data-act="cad" data-l="${esc(L.id)}" data-id="${esc(id)}" aria-label="Rythme de ${esc(pname(p))}\u00a0: ${esc(cadLabel(c))}">${esc(cadLabel(c))}${ic("chev")}</button></span></div>`;
    }).join("");
  }
  VIEWS.liste = (r) => {
    const L = S.lists.find((x) => x.id === r.id);
    if (!L) return notFound("liste");
    const e = estimate(L.items), sd = shopDay();
    const tplBox = `<h2 class="gh">Panier de la semaine</h2><div class="group"><div class="row"><span class="rt" id="tplL">C'est mon panier de la semaine<small>Le jour des courses, l'accueil te le propose, prêt à remplir, avec seulement ce qui est à reprendre ce jour-là.</small></span><label class="sw hit"><input type="checkbox" role="switch" data-act="tpl" data-id="${esc(L.id)}" aria-labelledby="tplL"${L.template ? " checked" : ""}><span></span></label></div>` +
      (L.template ? `<button class="row" type="button" data-act="shopdays"><span class="rt">Jour des courses<small>${daySet() ? "Choisi par toi" : sd != null ? "D'après tes commandes" : "Pas encore de jour habituel : choisis-en un"}</small></span><span class="val">${sd != null ? DAYS[sd].replace(/^./, (c) => c.toUpperCase()) : "Aucun"}</span>${ic("chev", "chev")}</button>` : "") + `</div>`;
    return {
      title: L.name, grouped: true,
      html: `<h1 class="lt">${esc(L.name)}</h1><p class="lt-sub">${plural(e.n, "produit", "produits")}, environ ${eur(e.t)} au meilleur prix</p>` +
        `<div class="pad btns" style="padding-top:6px"><button class="btn" type="button" data-act="addlist" data-id="${esc(L.id)}">${ic("plus")}Tout ajouter au panier</button><button class="btn tint" type="button" data-act="replacelist" data-id="${esc(L.id)}">Remplacer le panier par cette liste</button></div>` +
        `<h2 class="gh">Produits</h2><div class="group">${L.template ? tplItems(L) : itemsList(L.items)}</div>` + (L.template ? `<p class="gf">Touche le rythme d'un produit pour le changer : la lessive tous les mois, le lait à chaque fois.</p>` : "") + listFreeHtml(L) + tplBox +
        `<div class="group" style="margin-top:28px">${speakBtn("list", "Écouter la liste", "row link", L.id)}<button class="row link" type="button" data-act="sharelist" data-id="${esc(L.id)}">Partager la liste</button><button class="row link" type="button" data-act="renamelist" data-id="${esc(L.id)}">Renommer la liste</button><button class="row danger" type="button" data-act="dellist" data-id="${esc(L.id)}">Supprimer la liste</button></div>` +
        `<p class="gf">Le lien de partage contient la liste elle-même\u00a0: la personne qui l'ouvre peut l'ajouter à son panier ou à ses listes.</p>`,
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
  /* une ligne du panier ; x : l'article de la répartition (alt : l'équivalent que Cabas a pris, panier souple). Le prix
     ouvre « Où le prendre » : les prix des autres enseignes, épingler, exclure, accepter un équivalent. */
  function itemRow(id, cost, q, note, x) {
    const p0 = S.prods.get(id), a = x && x.alt && S.prods.get(x.alt), p = a || p0;
    const unit = cost / q / 100, pin = pinOf(id), notes = [];
    if (a) notes.push(["swap", `Équivalent pris par Cabas, au lieu de ${pname(p0)}`]);
    if (pin) notes.push(["pin", S.rets.some((r) => offKey(r) === pin && p0.offers[r.id] && p0.offers[r.id].price > 0) ? `Toujours chez ${groupName(pin)}` : `Épinglé chez ${groupName(pin)}, qui ne le vend pas ici`]);
    if (Object.keys(banOf(id)).length) notes.push(["x", "Jamais chez " + joinEt(Object.keys(banOf(id)).map(groupName))]);
    return `<div class="item" data-rm="p:${esc(id)}"><a class="thumb" href="${hp(p.id)}" aria-label="${esc(p.brand + " " + p.name)}">${img(p, 56)}</a><a class="it" href="${hp(p.id)}"><b><strong>${esc(p.brand)}</strong> ${esc(p.name)}</b><small>${esc(p.format)}${q > 1 ? ", " + eur(unit) + " l'unité" : ""}${note ? ", " + esc(note) : ""}</small>${notes.map(([i, t]) => `<small class="inote">${ic(i)}<span>${esc(t)}</span></small>`).join("")}</a><div class="ir"><button class="lp lpb hit" type="button" data-act="itemopt" data-id="${esc(id)}" aria-label="${cost ? eurC(cost) + ", " : ""}où le prendre">${cost ? eurC(cost) : "–"}${ic("down")}</button>${buyCtl(id, "item")}</div></div>`;
  }
  function plainItems(ids) {
    return ids.map((id) => { const p = S.prods.get(id), b = best(p), q = S.basket[id]; return itemRow(id, b ? Math.round(b.price * 100) * q : 0, q); }).join("");
  }
  /* le bouton de chaque commande du panier : remplir son panier chez l'enseigne, ou reprendre là où on en est */
  function fillLabel(r) {
    const o = fillActive() && !stale(snapOf()) ? fillOrd(r.id) : null, st = o && ordState(o);
    return st && st.k ? `Reprendre, ${st.k} sur ${plural(st.n, "produit", "produits")}` : "Remplir mon panier sur " + esc(r.service);
  }
  function orderHtml(o) {
    const r = S.retMap.get(o.ch.id), P = o.ch.P;
    const fee = o.fee - P.fixed;
    const nt = nextTier(o.ch, o.sub);
    const nItems = o.items.reduce((a, x) => a + x.l.q, 0);
    /* barre vers le palier suivant : le seuil est un repère sur la barre, qui va un peu au-delà ; à la livraison offerte, vert plein et coche */
    const freeT = !pickup(r) && P.tiers.find((t) => t.fee === 0 && t.from > 0);
    const goal = nt ? o.sub + nt.need : 0, span = Math.round(goal * 1.15);
    const bar = nt ? `<p class="hint">Encore ${eurC(nt.need)} chez ${esc(r.name)} et la livraison ${nt.fee > 0 ? "passe à " + eurC(nt.fee) : "devient offerte"}.</p><div class="prog thin" role="progressbar" aria-valuemin="0" aria-valuemax="${goal}" aria-valuenow="${o.sub}" aria-valuetext="${esc(eurC(o.sub) + " sur " + eurC(goal))}"><span style="width:${Math.round((100 * o.sub) / span)}%"></span><i style="left:${Math.round((100 * goal) / span)}%"></i></div>${nt.need <= Math.max(1500, o.sub / 4) ? `<div class="acts"><button class="act" type="button" data-act="topup" data-id="${esc(r.id)}">Compléter pour ${eurC(nt.need)}${ic("chev")}</button></div>` : ""}`
      : freeT && o.sub >= freeT.from ? `<div class="prog thin" role="progressbar" aria-valuemin="0" aria-valuemax="${freeT.from}" aria-valuenow="${freeT.from}" aria-valuetext="Livraison offerte"><span style="width:100%"></span></div><p class="progl done">${ic("check")}Livraison offerte</p>` : "";
    const W = (S.guide.when || {})[r.id];
    const when = W && W.d ? `<p class="hint">${pickup(r) ? "Retrait" : "Livraison"} ${esc(whenText(W))}.</p><div class="acts"><button class="act" type="button" data-act="when" data-id="${esc(r.id)}">Modifier${ic("chev")}</button><button class="act" type="button" data-act="ics" data-id="${esc(r.id)}" data-d="${esc(W.d)}" data-s="${esc(W.s || "")}">${ic("cal")}Calendrier</button></div>`
      : `<div class="acts"><button class="act" type="button" data-act="when" data-id="${esc(r.id)}">${pickup(r) ? "Quand vas-tu le retirer\u00a0?" : "Quand est-ce livré\u00a0?"}${ic("chev")}</button></div>`;
    return `<section class="order" aria-label="Commande ${esc(r.name)}"><div class="oh"><span class="mono" aria-hidden="true">${esc(r.name.slice(0, 1))}</span><div class="rt"><h3>${esc(r.name)}</h3><small>${plural(nItems, "article", "articles")}${r.group && (r.channel || {}).where ? ", " + esc((pickup(r) ? "retrait à " : "livraison ") + r.channel.where) : ""}</small></div>${px((o.sub + o.fee) / 100)}</div>` +
      o.items.map((x) => itemRow(x.l.id, x.cost, x.l.q, "", x)).join("") +
      `<div class="of"><div class="ln"><span>Articles</span><span>${eurC(o.sub)}</span></div><div class="ln"><span>${pickup(r) ? "Retrait" : "Livraison"}</span><span>${fee > 0 ? eurC(fee) : pickup(r) ? "Gratuit" : "Offerte"}</span></div>` +
      (P.fixed ? `<div class="ln"><span>Frais de service</span><span>${eurC(P.fixed)}</span></div>` : "") +
      `<div class="ln tot"><span>Total ${esc(r.name)}</span><span>${eurC(o.sub + o.fee)}</span></div>` + bar +
      (r.simulated ? `<p class="hint">Prix simulés, pas relevés\u00a0: le vrai total s'affiche sur ${esc(r.service)}.</p>` : "") +
      (S.guide.done[r.id] ? `<button class="btn tint" type="button" data-act="fill" data-id="${esc(r.id)}">${ic("check")}Commande passée</button>` + when : `<button class="btn tint" type="button" data-act="fill" data-id="${esc(r.id)}">${fillLabel(r)}</button>`) +
      `</div></section>`;
  }
  function compHtml(r) {
    const c = r.completed || [];
    if (!c.length) return "";
    const shops = joinEt([...new Set(c.map((x) => x.ret))].map(retName));
    const n = c.reduce((a, x) => a + x.l.q, 0);
    return `<section class="order" aria-label="À acheter en magasin"><div class="oh"><span class="mono" aria-hidden="true">${ic("store")}</span><div class="rt"><h3>À acheter en magasin</h3><small>${plural(n, "article", "articles")}, chez ${esc(shops)}</small></div>${px(r.compTotal / 100)}</div>` +
      c.map((x) => itemRow(x.l.id, x.cost, x.l.q, "chez " + retName(x.ret), x)).join("") +
      `<div class="of"><p class="hint muted">Tes commandes ne prennent pas ces produits\u00a0: achète-les en magasin, au plus près de chez toi. Ce sont les prix relevés en ligne\u00a0; en magasin, ils peuvent être un peu différents.</p><button class="btn tint" type="button" data-act="shop">${ic("list")}Liste pour le magasin</button></div></section>`;
  }
  /* interrupteur « Sans achat en magasin » du panier (le même que dans les réglages) */
  const isDrive = (r) => /drive/i.test(((r && r.channel) || {}).label || "");
  /* retraits remplacés par la livraison à domicile quand « Sans achat en magasin » est coché */
  function swappedPickups() {
    if (S.prefs.comp !== false) return [];
    const G = groupsOf(), out = [];
    for (const g of Object.keys(G)) {
      const from = S.allMap.get(pickOf(g, G[g])), to = S.allMap.get(pickFor(g, false));
      if (from && to && from.id !== to.id && !S.prefs.off[g]) out.push({ from, to });
    }
    return out;
  }
  const noCompRow = () => {
    const noComp = S.prefs.comp === false;
    const sw = swappedPickups().map(({ from, to }) => `${esc(to.name)} est livré chez toi${to.channel.where ? ", zone " + esc(to.channel.where) : ""}, au lieu du ${isDrive(from) ? "drive" : "retrait" + (from.channel.where ? " à " + esc(from.channel.where) : "")}.`);
    return `<div class="optrow"><span class="ot" id="nocompL">Tout me faire livrer<small>${noComp ? "Tout est livré chez toi, sans achat en magasin ni retrait." : "À cocher pour tout recevoir chez toi, sans te déplacer."}</small></span><label class="sw hit"><input type="checkbox" role="switch" data-act="nocomp" aria-labelledby="nocompL"${noComp ? " checked" : ""}><span></span></label></div>` +
      (sw.length ? `<p class="sn">${sw.join(" ")} <a href="#/reglages">Changer de zone</a></p>` : "");
  };
  /* panier souple, dans les options du panier : combien de produits acceptent un équivalent, combien Cabas en a pris */
  function flexRow(bst) {
    const n = Object.keys(S.basket).filter((id) => S.basket[id] > 0 && (S.flex || {})[id]).length, a = altCount(bst);
    return `<div class="optrow"><span class="ot" id="flexL">Panier souple<small>${n ? `${plural(n, "produit accepte", "produits acceptent")} un équivalent${a ? `\u00a0; Cabas en a pris ${a}` : ""}.` : "Laisse Cabas prendre une autre marque quand le total baisse."}</small></span><button class="btn sm tint" type="button" data-act="flex" aria-describedby="flexL">${n ? "Modifier" : "Choisir"}</button></div>`;
  }
  /* tout le panier dans une seule enseigne ; les produits qu'elle ne vend pas, complétés en magasin quand c'est permis */
  function singlesOf(M) {
    return M.chans.map((c, i) => Object.assign(singleBasket(M, i), { i })).map((x) => {
      let comp = 0, compN = 0, compOK = true;
      M.offers.forEach((offs, l) => { if (!offs.some((o) => o.c === x.i)) { compN++; if (M.comp[l]) comp += M.comp[l].cost; else compOK = false; } });
      compOK = compOK && compN <= M.compMax;
      const tot = x.ok && (!x.missing || compOK) ? x.sub + x.fee + (x.missing ? comp : 0) : null;
      return { s: x, name: (S.retMap.get(x.ch.id) || S.allMap.get(x.ch.id) || {}).name || x.ch.id, tot, compN: x.missing && compOK ? compN : 0 };
    });
  }
  const compPhrase = (r) => (r.completed && r.completed.length ? `, et ${plural(r.completed.length, "produit", "produits")} en magasin` : "");
  VIEWS.panier = () => {
    const ids = Object.keys(S.basket).filter((id) => S.basket[id] > 0 && S.prods.has(id));
    const freeBox = freeRows();
    if (!ids.length) return { title: "Panier", grouped: true, html: `<h1 class="lt">Panier</h1><div class="empty">${emptyArt("bag")}<h2>${freeBox ? "Rien à commander en ligne" : "Ton panier est vide"}</h2><p>${freeBox ? "Tes lignes libres sont là, en bas. " : ""}Écris ta liste ou parcours les rayons\u00a0: Cabas cherche où commander pour payer le moins cher, livraison comprise.</p><a class="btn" href="#/ecrire">${ic("pen")}Écrire ma liste</a><a class="btn tint" href="#/rayons">Parcourir les rayons</a></div>` + freeBox };
    const res = cartResult(), M = res.M, K = res.K;
    const nRet = M.chans.length;
    const nameOf = (o) => S.retMap.get(o.ch.id).name;
    const isSim = (r) => r.orders.some((o) => (S.retMap.get(o.ch.id) || {}).simulated);
    const seg = nRet > 1 ? `<p class="segl" id="maxkL">Commandes au plus</p><div class="seg tall" role="radiogroup" aria-labelledby="maxkL">${Array.from({ length: nRet }, (_, i) => i + 1).map((k) => `<button type="button" role="radio" data-act="maxk" data-k="${k}" aria-checked="${k === K}">${k}<small data-segk="${k}">${segLabel(k)}</small></button>`).join("")}</div>` : "";
    let side = "", main = "";
    const zipNote = !S.prefs.zip ? `<div class="banner" role="status">${ic("truck")}<span>Indique ton code postal\u00a0: Cabas vérifie que les enseignes te livrent et choisit le point Auchan le plus proche.</span><button class="btn sm tint" type="button" data-act="zip">Indiquer mon code postal</button></div>` :
      !inZone() ? `<div class="banner" role="status">${ic("info")}<span>Les enseignes de Cabas livrent en Île-de-France. La livraison à ${esc(S.prefs.zip)} n'est pas couverte pour l'instant\u00a0: les totaux sont indicatifs.</span></div>` : "";
    /* produits qu'aucune commande ne peut prendre : vendus seulement par une enseigne désactivée, ou exclus par toi */
    const sold = (id) => M.chans.some((c) => { const o = S.prods.get(id).offers[c.id]; return o && o.price > 0; });
    const blocked = M.uncovered.filter(sold), offOnly = M.uncovered.filter((id) => !sold(id));
    const uncovered = (offOnly.length ? `<h2 class="gh">Pas dans tes enseignes</h2><div class="order" style="margin-top:0">${plainItems(offOnly)}<div class="of"><p class="hint muted">Vendus seulement par une enseigne désactivée. Active-la dans les réglages pour les inclure.</p></div></div>` : "") +
      (blocked.length ? `<h2 class="gh">Exclus par toi</h2><div class="order" style="margin-top:0">${plainItems(blocked)}<div class="of"><p class="hint muted">Tu as exclu ${blocked.length > 1 ? "ces produits" : "ce produit"} des enseignes qui ${blocked.length > 1 ? "les" : "le"} vendent. Touche le prix pour changer.</p></div></div>` : "");
    const st = res.steps[K];
    const bst = st ? st.full || st.partial : null;
    if (!st && !res.done) {
      side = `<div class="sum loading"><p class="sl">Calcul de la meilleure répartition…</p><div class="st">${px(subtotal())}</div><p class="sh2">${plural(count(), "article", "articles")}</p>${seg}</div>`;
      main = `<div class="order">${plainItems(ids)}</div>`;
    } else if (bst) {
      const money = fullTotal(bst), complete = !!st.full;
      const skipped = bst.skipped || [];
      /* le nombre de commandes choisi ne suffit pas pour tout le panier : le plus petit nombre qui suffit */
      let altK = 0;
      if (!complete) for (let k = K + 1; k <= nRet; k++) { const s2 = res.steps[k]; if (s2 && s2.full) { altK = k; break; } }
      const alt = altK ? res.steps[altK].full : null;
      /* plus de commandes peut encore faire baisser le total du panier entier */
      const top = altK && res.steps[nRet] && res.steps[nRet].full;
      const cheaper = top && fullTotal(top) < fullTotal(alt) - 50 ? top : null;
      const searching = !complete && !altK && !res.done;
      const singles = singlesOf(M);
      const full = singles.filter((x) => x.tot != null).sort((a, b) => a.tot - b.tot);
      const k = bst.orders.length, names = bst.orders.map(nameOf);
      const simUsed = isSim(bst);
      /* comparaison avec moins de commandes, toujours pour tout le panier */
      let save = "", why = "";
      if (complete && k > 1) {
        const fewer = res.steps[k - 1];
        if (fewer && fewer.full) { const d = fullTotal(fewer.full) - money; if (d >= 50) save = `${eurC(d)} de moins qu'avec ${k - 1 === 1 ? "une seule commande" : (k - 1) + " commandes"}${fewer.full.completed && fewer.full.completed.length ? " complétée en magasin" : ""}`; }
        else if (fewer) why = k - 1 > 1 ? `En ${k - 1} commandes, il manquerait des produits.` : singles.some((x) => !x.s.missing) ? "Une seule commande ne peut pas contenir tout le panier\u00a0: son minimum d'achat ne serait pas atteint." : "Une seule commande ne peut pas contenir tout le panier\u00a0: aucune enseigne ne vend tous ces produits.";
      } else if (complete && k === 1 && full.length > 1 && !(bst.completed && bst.completed.length)) {
        const other = full.find((x) => x.name !== names[0]);
        if (other && other.tot - money >= 50) save = `${eurC(other.tot - money)} de moins qu'ailleurs`;
      }
      if (save && simUsed) save += ", selon la simulation";
      const sp = S.swapPrev;
      if (complete && sp && sp.key === JSON.stringify(S.basket) && sp.total - money >= 1) save = (save ? save + ". " : "") + `${eurC(sp.total - money)} de moins grâce aux remplacements`;
      const more = complete && k < K ? `Au-delà ${k === 1 ? "d'une commande" : "de " + k + " commandes"}, le total ne baisse plus.` : "";
      const notCheapest = bst.orders.some((o) => o.items.some((x) => { const b = best(S.prods.get(x.l.id)); return b && b.ret !== o.ch.id && b.price * 100 * x.l.q < x.cost - 0.5; }));
      const sl = !complete ? (altK ? (K === 1 ? "Une seule commande ne suffit pas" : `En ${K} commandes, il manque des produits`) : `Meilleure option pour ${M.lines.length - skipped.length} produits sur ${M.lines.length}`)
        : simUsed ? "Estimation avec des prix simulés"
        : bst.orders.some((o) => pickup(S.retMap.get(o.ch.id))) ? (bst.orders.every((o) => pickup(S.retMap.get(o.ch.id))) ? "Total le plus bas, retrait compris" : "Total le plus bas, livraison et retrait compris") : "Total le plus bas, livraison comprise";
      const where = k === 1 ? "chez " + esc(names[0]) : "en " + k + " commandes\u00a0: " + esc(joinEt(names));
      const sh2 = complete ? where.replace(/^./, (c) => c.toUpperCase()).replace(/^Chez/, "En une commande chez") + compPhrase(bst) : `Sans ${plural(skipped.length, "produit", "produits")}, ${where}${compPhrase(bst)}`;
      const altBox = alt ? `<div class="alt"><p>Tout le panier\u00a0: <b>${eurC(fullTotal(alt))}</b> en ${altK} commandes${cheaper ? `, ou <b>${eurC(fullTotal(cheaper))}</b> en ${cheaper.orders.length} commandes` : ""}${isSim(alt) || (cheaper && isSim(cheaper)) ? ", avec des prix simulés" : ""}.</p><button class="btn sm" type="button" data-act="maxk" data-k="${altK}">Passer à ${altK} commandes</button></div>`
        : searching ? `<p class="sn">Recherche d'une répartition qui prend tout le panier…</p>` : "";
      /* ce que donne l'autre réglage pour tout le panier, au même nombre de commandes si possible : sans déplacement
         (tout livré) si on peut se déplacer, et inversement avec ses déplacements (produits en magasin, retrait, drive) */
      const noComp = S.prefs.comp === false, os = res.other[K];
      const trips = (r) => {
        const out = [], n = (r.completed || []).length;
        if (n) out.push(`${plural(n, "produit", "produits")} en magasin`);
        r.orders.map((o) => S.allMap.get(o.ch.id)).filter(isPickup).forEach((x) => out.push((isDrive(x) ? "le drive " : "le retrait ") + x.name));
        return out;
      };
      let modeCmp = "";
      if (os) {
        let ob = os.full, ok2 = K;
        if (!ob) for (let k2 = K + 1; k2 <= nRet; k2++) { const s3 = res.other[k2]; if (s3 && s3.full) { ob = s3.full; ok2 = k2; break; } }
        const at = ok2 === K ? "" : ` en ${ok2} commandes`;
        const diff = ob && complete ? fullTotal(ob) - money : 0;
        const soit = !complete || Math.abs(diff) < 1 ? "" : diff > 0 ? `, soit ${eurC(diff)} de plus` : `, soit ${eurC(-diff)} de moins`;
        if (!noComp && trips(bst).length) {
          if (ob) modeCmp = `Tout livré chez toi\u00a0: ${eurC(fullTotal(ob))}${at}${soit}.`;
          else if (res.otherDone) modeCmp = "Sans te déplacer, tes commandes ne peuvent pas prendre tout le panier.";
        } else if (noComp && ob && trips(ob).length && (complete ? diff <= -50 : !alt || fullTotal(ob) < fullTotal(alt) - 50)) {
          modeCmp = `Avec ${esc(joinEt(trips(ob)))}${complete ? "" : ", tout le panier"}\u00a0: ${eurC(fullTotal(ob))}${at}${soit}.`;
        }
      }
      /* sans achat en magasin, un point de retrait reste un déplacement : la livraison à domicile se choisit dans les réglages */
      const pick = noComp ? bst.orders.map((o) => S.retMap.get(o.ch.id)).filter((r) => r && r.group && pickup(r)) : [];
      const pickNote = !pick.length ? "" : (pick.length === 1 ? `La commande ${esc(pick[0].name)} est à retirer${pick[0].channel.where ? " à " + esc(pick[0].channel.where) : ""}.` : `Les commandes ${esc(joinEt(pick.map((r) => r.name)))} sont à retirer.`) +
        ` Pour tout recevoir chez toi, choisis la livraison à domicile dans les <a href="#/reglages">réglages</a>.`;
      const compRow = noCompRow() +
        (modeCmp ? `<p class="sn">${modeCmp}</p>` : "") + (pickNote ? `<p class="sn">${pickNote}</p>` : "") + flexRow(bst);
      /* toutes les commandes du remplissage notées comme passées : le panier est déjà dans l'historique (recordFill) */
      const fs = snapOf(), allDone = complete && !!fs && finished(fs) && !stale(fs) && fs.orders.some((o) => S.guide.done[o.rid]);
      const going = fillActive() && !stale(fs);
      const fillCta = !allDone && !alt ? `<div class="btns" style="margin-top:14px"><button class="btn" type="button" data-act="fillgo">${going ? "Reprendre le remplissage" : k === 1 ? "Remplir mon panier " + esc(names[0]) : "Remplir mes paniers"}</button></div>` : "";
      const doneBox = allDone ? `<div class="alt"><p><b>Toutes tes commandes sont passées.</b>${S.guide.saved ? ` Tu as économisé ${eurC(S.guide.saved)}, meilleurs prix et remplacements compris.` : ""}</p><div class="btns two"><button class="btn sm tint" type="button" data-act="savelist">Garder en liste</button><button class="btn sm" type="button" data-act="clearok">Vider le panier</button></div></div>` : "";
      const sw = swaps(), swTot = sw.reduce((a, x) => a + x.save, 0);
      const swapCard = sw.length && !allDone ? `<button class="hcard" type="button" data-act="swaps">${ic("swap", "si")}<span><b>Économiser encore, environ ${eur(swTot)}</b><small>${plural(sw.length, "produit a", "produits ont")} un équivalent moins cher, d'une autre marque</small></span>${ic("chev", "chev")}</button>` : "";
      side = `<div class="sum${complete ? "" : " part"}"><p class="sl">${sl}</p><div class="st">${px(money / 100)}</div><p class="sh2">${sh2}</p>${budgetLine(money, complete)}${fillCta}${doneBox}${altBox}` +
        (save ? `<p class="sv">${save}</p>` : "") + (why ? `<p class="sn">${why}</p>` : "") + (more ? `<p class="sn">${more}</p>` : "") +
        (notCheapest ? `<p class="sn">Certains produits ne sont pas pris là où ils sont le moins chers\u00a0: avec les minimums d'achat et la livraison, ce regroupement revient moins cher.</p>` : "") +
        (st.truncated ? `<p class="sn">Gros panier\u00a0: le calcul a été écourté, le vrai minimum peut être un peu plus bas.</p>` : "") +
        (bst.extra ? `<p class="sn">Avec ${eurC(res.lambda)} comptés pour chaque commande en plus (réglages).</p>` : "") + seg + compRow + `</div>` + swapCard;
      const opts = singles.map((x) => {
        const s2 = x.s;
        const sub = !s2.ok ? `Minimum de ${eurC(s2.ch.P.min).replace(",00", "")} non atteint, il manque ${eurC(s2.ch.P.min - s2.sub)}` : x.compN ? `Et ${plural(x.compN, "produit", "produits")} en magasin` : s2.missing ? `${plural(s2.missing, "produit manque", "produits manquent")}` : "";
        const sim = (S.retMap.get(s2.ch.id) || {}).simulated ? "Prix simulés, pas relevés" : "";
        return `<div class="row"><span class="mono sm" aria-hidden="true">${esc(x.name.slice(0, 1))}</span><span class="rt">Tout chez ${esc(x.name)}${sub || sim ? `<small>${[sub, sim].filter(Boolean).join(". ")}</small>` : ""}</span><span class="val num">${x.tot != null ? eurC(x.tot) : "–"}</span></div>`;
      }).join("");
      const skipWhy = altK ? `${k === 1 ? esc(names[0]) + " ne vend pas ces produits" : "Les enseignes de ces commandes ne vendent pas ces produits"}\u00a0: en ${K === 1 ? "une seule commande" : K + " commandes au plus"}, ils ne peuvent pas être pris. Passe à ${altK} commandes pour avoir tout le panier, ou retire-les.`
        : "Ces produits ne rentrent dans aucune commande qui atteint le minimum d'achat de leur enseigne. Ajoute d'autres produits de ces enseignes, ou choisis un équivalent vendu ailleurs.";
      const tab = S.cartView === "tab";
      const viewSeg = `<div class="pad cview"><div class="seg" role="radiogroup" aria-label="Affichage du panier"><button type="button" role="radio" data-act="cview" data-v="cmd" aria-checked="${!tab}">Par commande</button><button type="button" role="radio" data-act="cview" data-v="tab" aria-checked="${tab}">Tableau des prix</button></div></div>`;
      main = viewSeg + `<h2 class="sr">${tab ? "Tableau des prix" : k === 1 ? "Ta commande" : "Tes commandes"}</h2>` + (tab ? cartTable(res, bst) : bst.orders.map(orderHtml).join("") + compHtml(bst)) +
        (skipped.length ? `<h2 class="gh">Hors commande</h2><div class="order" style="margin-top:0">${skipped.map((x) => { const p = S.prods.get(x.l.id), b = best(p); return itemRow(x.l.id, b ? Math.round(b.price * 100) * x.l.q : 0, x.l.q); }).join("")}<div class="of"><p class="hint muted">${skipWhy}</p></div></div>` : "") +
        uncovered + (`<details class="adv wif"${S.wifOpen ? " open" : ""}><summary><span class="rt">Et si…<small>Sans une enseigne, tout livré, une seule commande\u00a0: le total exact de chaque scénario</small></span>${ic("chev", "chev")}</summary><div id="wif">${S.wifOpen ? wifBody() : ""}</div></details>`) +
        (nRet > 1 ? `<h2 class="gh">Comparer</h2><div class="group">${opts}</div>` : "");
    } else {
      const singles = M.chans.map((c, i) => singleBasket(M, i)).filter((x) => x.have > 0);
      let hint = "";
      if (singles.length) {
        const g = singles.map((x) => ({ s: x, gap: x.ch.P.min - x.sub })).sort((x, y) => x.gap - y.gap)[0];
        if (g.gap > 0) hint = ` Chez ${esc(S.retMap.get(g.s.ch.id).name)}, ${g.s.missing ? "les produits disponibles font" : "ton panier fait"} ${eurC(g.s.sub)}\u00a0: il manque ${eurC(g.gap)} pour atteindre le minimum de ${eurC(g.s.ch.P.min).replace(",00", "")}.`;
      }
      /* petit panier : en magasin, pas de minimum ; l'enseigne qui a des magasins et vend le plus de produits, au total le plus bas */
      let store = "";
      if (S.prefs.comp !== false) {
        let b = null;
        for (const r of S.rets.filter((r) => r.magasin && !r.simulated && retOn(r.id))) {
          let tot = 0, have = 0;
          for (const id of ids) { const o = (S.prods.get(id) || {}).offers[r.id]; if (o && o.price > 0) { tot += Math.round(o.price * 100) * S.basket[id]; have++; } }
          if (have && (!b || have > b.have || (have === b.have && tot < b.tot))) b = { r, tot, have };
        }
        if (b) store = `<p class="sv">En magasin, sans minimum\u00a0: ${eurC(b.tot)} chez ${esc(b.r.name.split(" ")[0])}${b.have < ids.length ? ` pour ${b.have} produits sur ${ids.length}` : ""}.</p><p class="sn">Aux prix relevés en ligne\u00a0; en magasin, ils peuvent être un peu différents.</p>`;
      }
      const gm = singles.length ? singles.map((x) => ({ s: x, gap: x.ch.P.min - x.sub })).filter((x) => x.gap > 0).sort((x, y) => x.gap - y.gap)[0] : null;
      const topBtn = gm ? `<button class="btn tint" type="button" data-act="topup" data-id="${esc(gm.s.ch.id)}">${ic("plus")}Compléter pour ${eurC(gm.gap)}</button>` : "";
      side = `<div class="sum"><p class="sl">Panier trop petit pour une livraison</p><div class="st">${px(subtotal())}</div><p class="sn">Chaque enseigne demande un minimum d'achat.${hint}</p>${store}<div class="btns" style="margin-top:12px">${topBtn}<a class="btn ${topBtn ? "ghost" : "tint"}" href="#/ecrire">${ic("pen")}Compléter ma liste</a></div>${seg}${noCompRow()}</div>`;
      main = `<div class="order">${plainItems(ids.filter((id) => !M.uncovered.includes(id)))}</div>` + uncovered;
    }
    return {
      title: "Panier", grouped: true,
      right: `<button class="icbtn" type="button" data-act="sharecart" aria-label="Partager la répartition">${ic("share")}</button><button class="txtbtn" type="button" data-act="clear">Vider</button>`,
      html: `<h1 class="lt">Panier</h1>` + netBanner() + `<div class="cartcols"><div class="cside">${side}${zipNote}<div class="pad btns noprint" style="padding-top:12px">${speakBtn("panier", "Écouter la répartition", "btn ghost")}<button class="btn ghost" type="button" data-act="shopall">${ic("store")}Mode magasin et impression</button></div></div><div class="cmain">${main}${freeBox}</div></div>` +
        `<p class="foot">${esc(freshText())}. Le total exact s'affiche sur le site de chaque enseigne au moment de commander.<br><a class="act" href="#/frais">Frais des enseignes${ic("chev")}</a> <a class="act" href="#/reglages">Réglages de livraison${ic("chev")}</a></p>`,
    };
  };

  /* réglages */
  const pickup = (r) => ((r && r.channel) || {}).mode === "retrait";
  const optionLabel = (r) => {
    const ch = r.channel || {};
    if (ch.label) return ch.label + (r.simulated ? ", prix simulés" : "");
    return ch.where ? (pickup(r) ? "Retrait à " + ch.where : "Livraison à domicile, " + ch.where) : r.name;
  };
  function feeShort(r) {
    if (r.simulated) return "Prix simulés, " + feeShortReal(r).replace(/^./, (c) => c.toLowerCase());
    return feeShortReal(r);
  }
  function feeShortReal(r) {
    const ch = r.channel || {}, T = tiersOf(r);
    const free = T.find((t) => t.fee === 0 && t.from > 0);
    if (pickup(r)) return `Retrait ${ch.where ? "à " + ch.where : "en magasin"}, ${T[0].fee > 0 ? eur(T[0].fee) : "gratuit"}${ch.minOrder ? `, minimum ${eurR(ch.minOrder)}` : ""}`;
    return `Minimum ${eurR(ch.minOrder || 0)}, livraison ${eur(T[0].fee)}${free ? `, offerte dès ${eurR(free.from)}` : ""}${ch.fixedFee ? `, frais de service ${eur(ch.fixedFee)}` : ""}`;
  }
  /* Réglages > Commandes : cocher à la main, rappel dans le mini panier, délais de livraison, liens à revoir */
  function commandesHtml() {
    const nb = Object.keys(S.guide.broken || {}).length, nf = Object.keys(S.seen.first || {}).length;
    const sw = (act, id, label, hint, on) => `<div class="row"><span class="rt" id="${id}">${label}<small>${hint}</small></span><label class="sw hit"><input type="checkbox" role="switch" data-act="${act}" aria-labelledby="${id}"${on ? " checked" : ""}><span></span></label></div>`;
    return `<h2 class="gh">Commandes</h2><div class="group">` +
      sw("manualck", "manckL", "Cocher à la main", "Sinon, Cabas coche un produit quand tu reviens dans l'appli après l'avoir ouvert sur le site.", !!S.prefs.manualCk) +
      sw("badge", "badgeL", "Rappel dans le mini panier", "Tant que tu remplis tes paniers\u00a0: «\u00a0Il te reste 3 produits à mettre chez Carrefour\u00a0».", S.prefs.badge !== false) +
      `<button class="row" type="button" data-act="leads"><span class="rt">Délais de livraison<small>Pour te dire quand commander.</small></span>${ic("chev", "chev")}</button>` +
      `<button class="row" type="button" data-act="shopdays"><span class="rt">Jour des courses<small>Ce jour-là, l'accueil te propose ton panier de la semaine.</small></span><span class="val">${daySet() ? DAYS[S.prefs.shopDay].replace(/^./, (c) => c.toUpperCase()) : "Auto"}</span>${ic("chev", "chev")}</button>` +
      `<a class="row" href="#/recommander"><span class="rt">Recommander un panier</span>${ic("chev", "chev")}</a>` +
      (nb ? `<button class="row" type="button" data-act="brokenclear"><span class="rt">Liens à revoir<small>${plural(nb, "lien ne menait", "liens ne menaient")} pas au bon produit\u00a0: Cabas ouvre la recherche du site à la place.</small></span><span class="val">Tout reproposer</span></button>` : "") +
      (nf ? `<button class="row link" type="button" data-act="firstreset">Revoir les étapes «\u00a0Avant de commencer\u00a0»</button>` : "") + `</div>`;
  }
  VIEWS.reglages = () => {
    const K = Math.max(1, Math.min(S.rets.length, S.prefs.maxOrders || 3));
    const seg = (id, label, opts, act, key, cur, hint) => `<div class="row stack"><span class="rt" id="${id}">${label}${hint ? `<small>${hint}</small>` : ""}</span><div class="seg" role="radiogroup" aria-labelledby="${id}">${opts.map((v) => `<button type="button" role="radio" data-act="${act}" data-${key}="${v}" aria-checked="${v === cur}">${v}</button>`).join("")}</div></div>`;
    return {
      title: "Réglages", grouped: true,
      html: `<h1 class="lt">Réglages</h1>` +
        `<h2 class="gh">Affichage</h2><div class="group">${lookHtml()}${TTS() ? `<div class="row stack"><span class="rt" id="voiceL">Lecture à voix haute<small>Pour écouter ta liste, ta répartition et ta liste du magasin.</small></span><div class="seg" role="radiogroup" aria-labelledby="voiceL">${[["slow", "Lente"], ["normal", "Normale"]].map(([v, l]) => `<button type="button" role="radio" data-act="voice" data-v="${v}" aria-checked="${(S.prefs.voice === "slow" ? "slow" : "normal") === v}">${l}</button>`).join("")}</div></div>` : ""}<button class="row link" type="button" data-act="welcome">Reprendre les questions de départ</button></div>` +
        `<h2 class="gh">Livraison</h2><div class="group"><button class="row" type="button" data-act="zip"><span class="rt">Code postal</span><span class="val">${S.prefs.zip ? esc(S.prefs.zip) : "À indiquer"}</span>${ic("chev", "chev")}</button></div>` +
        `<p class="gf">${S.prefs.zip && !inZone() ? "Les enseignes de Cabas livrent en Île-de-France\u00a0: ton code postal n'est pas encore couvert." : "Les enseignes de Cabas livrent en Île-de-France. Chacune confirme ses créneaux au moment de commander."}</p>` +
        `<h2 class="gh">Enseignes</h2><div class="group">${S.rets.map((r) => `<div class="row"><a class="rt" href="#/enseigne/${esc(r.id)}">${esc(r.name)}<small>${esc(feeShort(r))}</small></a><label class="sw hit"><input type="checkbox" role="switch" data-act="ret" data-id="${esc(r.id)}"${retOn(r.id) ? " checked" : ""} aria-label="Utiliser ${esc(r.name)}"><span></span></label></div>`).join("")}</div>` +
        `<p class="gf">Le panier n'utilise que les enseignes activées. Touche une enseigne pour voir ses frais et leurs sources, ou compare-les toutes dans le <a href="#/frais">guide des frais</a>.</p>` +
        Object.entries(groupsOf()).map(([g, ms]) => {
          const noComp = S.prefs.comp === false, cur = pickFor(g, !noComp), back = noComp && cur !== pickOf(g, ms);
          const auto = ms.some((m) => m.zips) ? `<div class="group gap"><div class="row"><span class="rt" id="pickautoL-${esc(g)}">D'après mon code postal<small>${esc(autoText(g))}</small></span><label class="sw hit"><input type="checkbox" role="switch" data-act="pickauto" data-g="${esc(g)}"${(S.prefs.pickManual || {})[g] ? "" : " checked"} aria-labelledby="pickautoL-${esc(g)}"><span></span></label></div></div>` : "";
          return `<h2 class="gh" id="pick-${esc(g)}">${esc(ms[0].name)}\u00a0: livraison ou retrait</h2>${auto}<div class="group" role="radiogroup" aria-labelledby="pick-${esc(g)}">${ms.map((m) => { const dis = noComp && pickup(m); return `<button class="row" type="button" role="radio" data-act="pick" data-g="${esc(g)}" data-id="${esc(m.id)}" aria-checked="${m.id === cur}"${dis ? " disabled" : ""}><span class="rt">${esc(optionLabel(m))}<small>${esc(pickup(m) ? (tiersOf(m)[0].fee > 0 ? eur(tiersOf(m)[0].fee) + " par retrait" : "Retrait gratuit") : feeShort(m))}</small></span>${m.id === cur ? ic("check", "chk") : ""}</button>`; }).join("")}</div>` +
            `<p class="gf">${noComp ? `«\u00a0Tout me faire livrer\u00a0» est coché\u00a0: tout est livré chez toi, pas de retrait. ${[ms.filter((m) => !pickup(m)).length > 1 ? "choisis ta zone de livraison" : "", back ? "en décochant, tu retrouves ton " + (isDrive(S.allMap.get(pickOf(g, ms))) ? "drive" : "point de retrait") : ""].filter(Boolean).join("\u00a0; ").replace(/^./, (c) => c.toUpperCase()).replace(/.$/, (c) => c + ".")}` : `Les prix ${esc(ms[0].name)} dépendent du magasin et de la zone de livraison\u00a0: choisis ta zone ou ton point de retrait.`}</p>`;
        }).join("") +
        `<h2 class="gh">Répartition du panier</h2><div class="group"><div class="row"><span class="rt" id="nocompRL">Tout me faire livrer<small>Tout passe par les commandes en ligne. Décoché, un produit que tes commandes ne prennent pas peut s'acheter en magasin, au prix relevé le plus bas (au plus un quart du panier).</small></span><label class="sw hit"><input type="checkbox" role="switch" data-act="nocomp"${S.prefs.comp === false ? " checked" : ""} aria-labelledby="nocompRL"><span></span></label></div>` +
        seg("foyerL", "Personnes à la maison", [1, 2, 3, 4, 5, 6], "wfoyer", "v", S.prefs.foyer || 0, "Pour les portions des repas.") +
        `<button class="row" type="button" data-act="budget"><span class="rt">Budget<small>${byMonth() ? "Par mois\u00a0: le panier dit ce qu'il te reste ce mois-ci, paniers commandés compris." : "Par panier\u00a0: le panier dit ce qu'il reste ou de combien tu dépasses."}</small></span><span class="val">${parseFloat(S.prefs.budget) > 0 ? eurR(parseFloat(S.prefs.budget)) + (byMonth() ? " par mois" : "") : "Aucun"}</span>${ic("chev", "chev")}</button>` +
        /* options d'expert, repliées : le nombre de commandes au plus et ce que coûte une commande de plus */
        `<details class="adv"><summary><span class="rt">Pour aller plus loin<small>Nombre de commandes au plus, coût d'une commande en plus</small></span>${ic("chev", "chev")}</summary>` +
        seg("maxkL", "Commandes au plus", S.rets.map((_, i) => i + 1), "maxk", "k", K) +
        `<div class="row stack"><span class="rt" id="extraL">Coût d'une commande ou d'un passage en magasin en plus<small>Ton temps, les sacs, la réception, le trajet. Sert à choisir entre une et plusieurs commandes.</small></span><div class="field" data-field="extra"><span class="in"><input id="extra" type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" value="${esc(frNum(S.prefs.extraCost || 0))}" aria-labelledby="extraL"><span class="suf">€</span></span><small></small></div></div></details></div>` +
        commandesHtml() +
        `<h2 class="gh">Alimentation</h2><div class="group"><button class="row" type="button" data-act="diet"><span class="rt">Mon régime<small>Filtre la recherche, les rayons, Ma liste, les repas et les remplacements, d'après ce que les enseignes indiquent.</small></span><span class="val">${esc(dietLabel())}</span>${ic("chev", "chev")}</button>` +
        `<div class="row"><span class="rt" id="factsL">Nutri-Score et allergènes<small>Demandés à Open Food Facts à l'ouverture d'une fiche, avec le seul code-barres, et gardés 30 jours sur ce téléphone. Décoché, d'un geste sur la fiche.</small></span><label class="sw hit"><input type="checkbox" role="switch" data-act="factsauto" aria-labelledby="factsL"${S.prefs.facts !== false ? " checked" : ""}><span></span></label></div>` +
        `<button class="row" type="button" data-act="watchlist"><span class="rt">Mes alertes de prix<small>${Object.keys(watchAll()).length ? "L'accueil te dit quand un prix passe sous ton seuil." : "Sur la fiche d'un produit\u00a0: «\u00a0Préviens-moi quand le prix baisse\u00a0»."}</small></span>${Object.keys(watchAll()).length ? `<span class="val num">${Object.keys(watchAll()).length}</span>` : ""}${ic("chev", "chev")}</button></div>` +
        `<h2 class="gh">Mes choix et mes marques</h2><div class="group"><button class="row" type="button" data-act="usual"><span class="rt">Mes choix habituels<small>${usualCount() ? "Ce que tu as choisi dans Ma liste revient d'office, tant que le prix suit." : "Choisis un produit dans Ma liste : Cabas s'en souvient."}</small></span>${usualCount() ? `<span class="val num">${usualCount()}</span>` : ""}${ic("chev", "chev")}</button></div>` +
        `<h2 class="gh">À propos</h2><div class="group"><a class="row" href="#/economies"><span class="rt">Tes économies</span>${(S.hist || []).length ? `<span class="val num">${eurC(S.hist.reduce((a, x) => a + (x.s || 0), 0))}</span>` : ""}${ic("chev", "chev")}</a><a class="row" href="#/comment"><span class="rt">Comment ça marche</span>${ic("chev", "chev")}</a><a class="row" href="#/apropos"><span class="rt">À propos des prix</span>${ic("chev", "chev")}</a>${standalone() ? "" : `<button class="row" type="button" data-act="${installEvt ? "installnow" : "install"}"><span class="rt">${isIOS ? "Installer Cabas sur l'iPhone" : "Installer Cabas sur le téléphone"}</span>${ic("chev", "chev")}</button>`}<button class="row" type="button" data-act="shareapp"><span class="rt">Faire connaître Cabas<small>Une image et un lien à envoyer à qui fait ses courses</small></span>${ic("share", "chev")}</button><button class="row" type="button" data-act="report"><span class="rt">Signaler ou demander<small>Un produit qui manque, une enseigne, quelque chose qui ne va pas</small></span>${ic("chev", "chev")}</button>${reportsAll().length ? `<button class="row" type="button" data-act="reports"><span class="rt">Mes signalements</span><span class="val num">${reportsAll().length}</span>${ic("chev", "chev")}</button>` : ""}<div class="row"><span class="rt">Version</span><span class="val">1.2</span></div></div>` +
        dataHtml() +
        `<div class="group" style="margin-top:32px"><button class="row danger" type="button" data-act="reset">Effacer mes données</button></div><p class="gf">Ton panier, tes listes et tes réglages restent sur cet appareil.</p>`,
    };
  };
  VIEWS.enseigne = (r) => {
    /* #/enseigne/<groupe> (auchan, leclerc) ouvre l'option retenue du groupe ; une option précise s'ouvre telle quelle */
    const G = groupsOf()[r.id];
    const R0 = S.retMap.get(r.id) || S.allMap.get(r.id) || (G && S.allMap.get(pickFor(r.id, S.prefs.comp !== false)));
    if (!R0) return notFound("enseigne");
    const ch = R0.channel || {}, T = tiersOf(R0);
    const rows = T.map((t, i) => {
      const lo = Math.max(t.from, ch.minOrder || 0), hi = T[i + 1] ? T[i + 1].from : null;
      if (hi != null && lo >= hi) return "";
      const lab = hi == null ? `Dès ${eurR(lo)}` : `De ${eurR(lo)} à ${eurR(hi)}`;
      return `<div class="row"><span class="rt">${lab}</span><span class="val num">${t.fee > 0 ? eur(t.fee) : pickup(R0) ? "Gratuit" : "Offerte"}</span></div>`;
    }).join("");
    const ov = S.prefs.fee[R0.id] || {};
    const firstTo = T[1] ? T[1].from : null;
    return {
      title: R0.name, grouped: true,
      html: `<h1 class="lt">${esc(R0.name)}</h1><p class="lt-sub">${esc(R0.service)}</p>` +
        `<div class="group"><div class="row"><span class="rt" id="useL">Utiliser ${esc(R0.name)}</span><label class="sw hit"><input type="checkbox" role="switch" data-act="ret" data-id="${esc(R0.id)}"${retOn(R0.id) ? " checked" : ""} aria-labelledby="useL"><span></span></label></div></div>` +
        `<h2 class="gh">${pickup(R0) ? "Retrait" + (ch.where ? " à " + esc(ch.where) : "") : "Livraison à domicile"}</h2><div class="group"><div class="row"><span class="rt">Commande minimum</span><span class="val num">${eurR(ch.minOrder || 0)}</span></div>${rows}${ch.fixedFee ? `<div class="row"><span class="rt">Frais de service</span><span class="val num">${eur(ch.fixedFee)}</span></div>` : ""}</div>` +
        (ch.editable ? `<h2 class="gh">Ton créneau</h2><div class="group"><div class="row stack">${field("fee-" + esc(R0.id), (pickup(R0) ? "Frais de retrait" : "Frais de livraison") + (firstTo ? " sous " + eurR(firstTo) : ""), `type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" data-fee="${esc(R0.id)}" value="${esc(frNum(ov.base != null ? ov.base : ch.tiers[0].fee))}"`, pickup(R0) ? "À vérifier sur le site au moment de commander." : "Selon le créneau choisi. Par défaut, le prix le plus haut.", "€")}</div></div>` : "") +
        (ch.feeNote ? `<h2 class="gh">D'où viennent ces frais</h2><div class="group"><p class="prose"><span>${tx(ch.feeNote)}</span></p>${(ch.sources || []).map((s) => `<a class="row link" href="${esc(s.url)}" target="_blank" rel="noopener"><span class="rt">${esc(s.label)}</span>${ic("ext", "ext")}</a>`).join("")}</div>` : "") +
        `<div class="group" style="margin-top:28px"><a class="row link" href="#/frais/${esc(R0.group || R0.id)}"><span class="rt">Comparer avec les autres enseignes</span>${ic("chev", "chev")}</a><a class="row link" href="${esc(R0.home)}" target="_blank" rel="noopener"><span class="rt">Ouvrir ${esc(R0.service)}</span>${ic("ext", "ext")}</a></div>`,
    };
  };
  /* Guide des frais (#/frais, #/frais/<enseigne>) : ce que coûte une commande dans chaque enseigne, d'après
     data/retailers.json (minimum, paliers, frais de service, retrait, délai, sources), le panier compté aux prix de
     chacune (« il manque 12,30 € pour la livraison offerte »), et un montant à essayer (S.fraisAmt, sans mémoire). */
  function fraisTable(amt) {
    const rs = S.rets.filter((r) => retOn(r.id));
    if (!rs.length) return `<p class="gf">Aucune enseigne activée.</p>`;
    return `<div class="group">${rs.map((r) => {
      const g = feeGap(r.id, amt);
      const sub = g.toMin ? `Sous le minimum de ${eurR(g.min / 100)}\u00a0: il manque ${eurC(g.toMin)}` :
        (g.pickup ? (g.fee ? "Retrait " + eurC(g.fee) : "Retrait gratuit") : g.fee ? "Livraison " + eurC(g.fee) : "Livraison offerte") + (g.fixed ? `, frais de service ${eurC(g.fixed)}` : "") +
        (!g.pickup && g.free && g.free.gap > 0 ? `\u00a0; offerte dès ${eurR(g.free.at / 100)}, encore ${eurC(g.free.gap)}` : !g.pickup && g.next ? `\u00a0; ${eurC(g.next.fee)} dès ${eurR(g.next.at / 100)}` : "");
      return `<a class="row" href="#/enseigne/${esc(r.id)}"><span class="rt">${esc(r.name)}${r.group && (r.channel || {}).where ? `, ${esc(optionLabel(r).replace(/^./, (c) => c.toLowerCase()))}` : ""}<small>${esc(sub)}${r.simulated ? ", prix simulés" : ""}</small></span><span class="val num">${g.total == null ? "–" : eurC(g.total)}</span>${ic("chev", "chev")}</a>`;
    }).join("")}</div>`;
  }
  VIEWS.frais = (r) => {
    const want = r && r.id, amt0 = S.fraisAmt != null ? S.fraisAmt : count() ? Math.round(subtotal() * 100) : 8000;
    const gaps = basketGaps();
    const head = gaps.length ? (() => {
      const g = gaps.find((x) => !x.g.pickup && x.g.free && x.g.free.gap > 0) || gaps[0];
      return `<div class="banner good" role="status">${ic("truck")}<span>${esc(gapText(g.g, g.miss))}</span></div>`;
    })() : "";
    const card = (x) => {
      const ch = x.channel || {}, T = tiersOf(x), id = "frais-" + (x.group || x.id);
      const rows = T.map((t, i) => {
        const lo = Math.max(t.from, ch.minOrder || 0), hi = T[i + 1] ? T[i + 1].from : null;
        if (hi != null && lo >= hi) return "";
        return `<div class="row"><span class="rt">${hi == null ? `Dès ${eurR(lo)}` : `De ${eurR(lo)} à ${eurR(hi)}`}</span><span class="val num">${t.fee > 0 ? eur(t.fee) : pickup(x) ? "Gratuit" : "Offerte"}</span></div>`;
      }).join("");
      const g = gaps.find((y) => y.g.rid === x.id);
      return `<h2 class="gh${want && (want === x.id || want === x.group) ? " here" : ""}" id="${esc(id)}">${esc(x.name)}${x.simulated ? " (prix simulés)" : ""}${retOn(x.id) ? "" : ", pas utilisée"}</h2><div class="group">` +
        `<div class="row"><span class="rt">${esc(pickup(x) ? "Retrait" + (ch.where ? " à " + ch.where : "") : "Livraison à domicile" + (x.group && ch.where ? ", " + ch.where : ""))}<small>${esc(ch.minOrder ? "Commande minimum " + eurR(ch.minOrder) : "Pas de minimum de commande")}${x.lead && x.lead.text ? ". " + tx(x.lead.text) : ""}</small></span></div>` + rows +
        (ch.fixedFee ? `<div class="row"><span class="rt">Frais de service</span><span class="val num">${eur(ch.fixedFee)}</span></div>` : "") +
        (g ? `<div class="row"><span class="rt"><small>${esc(gapText(g.g, g.miss))}</small></span></div>` : "") +
        `<a class="row link" href="#/enseigne/${esc(x.id)}"><span class="rt">Sources et frais de ton créneau</span>${ic("chev", "chev")}</a></div>`;
    };
    /* chaque enseigne une fois : l'option retenue de son groupe (Auchan, E.Leclerc), puis les autres options du groupe */
    const others = S.allRets.filter((x) => x.group && !S.rets.includes(x));
    return {
      title: "Frais de livraison", grouped: true,
      mount: () => { if (want) { const el = $("#frais-" + CSS.escape(want)) || $("#frais-" + CSS.escape((S.allMap.get(want) || {}).group || "")); if (el) el.scrollIntoView({ block: "start" }); } },
      html: `<h1 class="lt">Frais de livraison</h1><p class="lt-sub">Minimum, livraison, frais de service et retrait de chaque enseigne, d'après leurs sites.</p>` + head +
        `<h2 class="gh" id="famtL">Pour un panier de…</h2><div class="group"><div class="row stack">${field("famt", "Montant de tes courses", `type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" value="${esc(frNum(amt0 / 100))}"`, count() && S.fraisAmt == null ? "Le montant de ton panier, au meilleur prix de chaque produit." : "Change le montant\u00a0: les frais suivent.", "€")}</div></div>` +
        `<div id="ftab">${fraisTable(amt0)}</div>` +
        `<p class="gf">Frais comptés par Cabas pour répartir ton panier. Chaque enseigne confirme les siens au moment de commander, selon le créneau.</p>` +
        S.rets.map(card).join("") +
        (others.length ? `<h2 class="gh">Autres options</h2><div class="group">${others.map((x) => `<a class="row" href="#/enseigne/${esc(x.id)}"><span class="rt">${esc(x.name)}, ${esc(optionLabel(x).replace(/^./, (c) => c.toLowerCase()))}<small>${esc(feeShort(x))}</small></span>${ic("chev", "chev")}</a>`).join("")}</div><p class="gf">Une seule option par enseigne compte à la fois\u00a0: elle se choisit dans les <a href="#/reglages">réglages</a>.</p>` : ""),
    };
  };
  /* ce que se demande quelqu'un qui découvre Cabas : ce que ça fait, d'où viennent les prix, ce que ça coûte, où ça marche */
  VIEWS.comment = () => {
    const m = S.meta || {};
    const rets = S.allRets.filter((r) => !r.simulated).map((r) => r.group ? null : r.name).filter(Boolean);
    const names = joinEt([...new Set(S.allRets.filter((r) => !r.simulated).map((r) => r.name.split(" ")[0]))]);
    const step = (n, t, d) => `<div class="step"><span class="sn">${n}</span><div><b>${t}</b><p>${d}</p></div></div>`;
    return {
      title: "Comment ça marche", grouped: true,
      html: `<h1 class="lt">Comment ça marche</h1><p class="lt-sub">Cabas compare les prix des courses en ligne et répartit ton panier pour payer le moins cher, livraison comprise.</p>` +
        `<div class="how">` +
        step(1, "Écris ta liste, ou ajoute des produits", "Une ligne par produit, avec les quantités («\u00a02 paquets de pâtes\u00a0», «\u00a06 œufs\u00a0»). Tu peux aussi dicter, parcourir les rayons ou scanner un code-barres en magasin.") +
        step(2, "Cabas trouve chaque produit au meilleur prix", `Les mêmes produits sont comparés chez ${esc(names)}, avec leurs prix au kilo ou au litre. Un produit équivalent moins cher t'est proposé, jamais imposé.`) +
        step(3, "Ton panier est réparti entre les enseignes", "Une ou plusieurs commandes, en tenant compte des minimums d'achat et des frais de livraison de chacune\u00a0: le total affiché est celui que tu paieras, frais compris. Si une seule commande revient moins cher, Cabas le dit.") +
        step(4, "Tu remplis tes paniers sur les sites des enseignes", "«\u00a0Remplir mes paniers\u00a0» ouvre chaque produit sur le site de l'enseigne\u00a0: tu l'ajoutes à ton panier là-bas, tu reviens, Cabas le coche. Il ne vend rien, ne commande rien à ta place, ne prend aucune commission et n'est lié à aucune enseigne.") +
        `</div>` +
        `<h2 class="gh">D'où viennent les prix</h2><div class="group"><div class="prose"><p>Les prix sont relevés sur les sites des enseignes, page de rayon par page de rayon, et chaque prix garde la date de son relevé${m.updatedAt ? " (dernier relevé le " + esc(dateFr(m.updatedAt)) + ")" : ""}. Rien n'est estimé${S.allRets.some((r) => r.simulated) ? ", sauf E.Leclerc, dont les prix sont simulés et signalés comme tels partout" : ""}. Les offres en cours sont signalées mais pas déduites.</p><p>Les prix Auchan dépendent du magasin\u00a0: Cabas relève plusieurs points de retrait et zones de livraison, et tu choisis le tien.</p></div></div>` +
        `<h2 class="gh">Où ça marche</h2><div class="group"><div class="prose"><p>Pour l'instant en Île-de-France, là où ${esc(names)} livrent ou proposent un retrait. ${esc(coverText())}. D'autres rayons suivent.</p></div></div>` +
        `<h2 class="gh">Ce que ça coûte</h2><div class="group"><div class="prose"><p>Rien. Pas de compte, pas de publicité, pas de suivi. Tes listes, ton panier et tes commandes restent dans ton téléphone. Cabas s'installe sur l'écran d'accueil et marche sans réseau avec le dernier relevé.</p></div></div>` +
        `<div class="pad btns" style="padding-top:18px"><a class="btn" href="#/ecrire">${ic("pen")}Écrire ma liste</a><button class="btn tint" type="button" data-act="shareapp">${ic("share")}Faire connaître Cabas</button></div>` +
        `<p class="gf"><a href="#/apropos">À propos des prix</a>, enseigne par enseigne.</p>`,
    };
  };

  /* état du relevé, enseigne par enseigne, replié : chaque rayon avec sa date et son nombre de produits, par univers */
  function statusHtml() {
    const blocks = S.rets.filter((r) => !r.simulated && statusRays(r.id)).map((r) => {
      const rays = statusRays(r.id), ids = Object.keys(rays).filter((id) => rayon(id));
      if (!ids.length) return "";
      const dates = ids.map((id) => rays[id].at).filter(Boolean).sort();
      const span = dates.length ? (dates[0] === dates[dates.length - 1] ? "du " + dayFr(dates[0]) : "du " + dayFr(dates[0]) + " au " + dayFr(dates[dates.length - 1])) : "";
      const rows = univGroups().map((g) => {
        const here = g.items.filter((x) => rays[x.id]);
        if (!here.length) return "";
        return `<div class="row"><span class="rt"><b>${esc(g.u.name)}</b></span></div>` + here.map((x) => `<div class="row"><span class="rt">${esc(x.name)}</span><span class="val">${rays[x.id].at ? esc(dayFr(rays[x.id].at)) : "non relevé"}, ${plural(rays[x.id].products || 0, "produit", "produits")}</span></div>`).join("");
      }).join("");
      return `<details class="adv"><summary><span class="rt">${esc(r.name)}<small>${plural(ids.length, "rayon relevé", "rayons relevés")}${span ? ", " + span : ""}</small></span>${ic("chev", "chev")}</summary>${rows}</details>`;
    }).join("");
    return blocks ? `<h2 class="gh">État du relevé, rayon par rayon</h2><div class="group">${blocks}</div><p class="gf">Une page qui n'a pas pu être lue garde ses prix précédents, avec leur date, 21 jours au plus (7 pour les rayons frais).</p>` : "";
  }
  VIEWS.apropos = () => {
    const m = S.meta || {}, cov = m.coverage || {};
    return {
      title: "À propos des prix", grouped: true,
      html: `<h1 class="lt">À propos des prix</h1>` +
        `<h2 class="gh">Dernière vérification</h2><div class="group">${S.rets.map((r) => { const st = ((S.status || {}).retailers || {})[r.id] || {}; return `<div class="row"><span class="rt">${esc(r.name)}<small>${r.simulated ? "Prix simulés, pas relevés" : st.checkedAt ? "Vérifié " + esc(whenFr(st.checkedAt)) + (st.pages ? ", " + st.read + " page" + (st.read > 1 ? "s" : "") + " lue" + (st.read > 1 ? "s" : "") + " sur " + st.pages : "") : "Relevé du " + esc(dateFr(m.updatedAt))}</small></span><span class="val num">${plural(cov[r.id] || 0, "prix", "prix")}</span></div>`; }).join("")}<div class="row"><span class="rt">Produits vendus par plusieurs enseignes</span><span class="val num">${esc(m.multi || 0)}</span></div></div>` +
        statusHtml() +
        `<h2 class="gh">Comment lire les prix</h2><div class="group"><div class="prose">${(m.notes || []).map((n) => `<p>${tx(n)}</p>`).join("")}</div></div>` +
        `<p class="gf">Les prix viennent des pages rayon des enseignes, relues à chaque relevé. Une page qui n'a pas pu être lue garde ses prix précédents, avec leur date. Cabas n'est lié à aucune enseigne. Les noms des enseignes et des marques appartiennent à leurs propriétaires.</p>`,
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
      case "comment": return { name: "comment" };
      case "ecrire": return { name: "ecrire" };
      case "partage": return { name: "partage", id };
      case "economies": return { name: "economies" };
      case "repas": return id ? { name: "recette", id } : { name: "repas" };
      case "scan": return { name: "scan" };
      case "remplir": return { name: "remplir", id };
      case "recommander": return { name: "recommander" };
      case "frais": return { name: "frais", id };
      case "mouvements": return { name: "mouvements" };
      case "magasin": return { name: "magasin" };
      case "transfert": return { name: "transfert", id: seg[1] || "" };
      case "comparer": return { name: "comparer", id, id2: seg[2] ? decodeURIComponent(seg[2]) : "" };
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
      case "comment": return "Comment ça marche";
      case "ecrire": return "Ma liste";
      case "partage": return "Liste partagée";
      case "economies": return "Économies";
      case "repas": return "Repas";
      case "scan": return "Scanner";
      case "recette": return ((S.recs || []).find((x) => x.id === r.id) || {}).name || "Recette";
      case "remplir": return r.id ? retName(r.id) : "Remplir";
      case "recommander": return "Recommander";
      case "frais": return "Frais";
      case "mouvements": return "Prix";
      case "magasin": return "Magasin";
      case "transfert": return "Transfert";
      case "comparer": return "Comparer";
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
    /* retour du navigateur ou adresse tapée : la feuille de la page quittée se ferme */
    if (!$("#sheet").hidden) closeSheet();
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
    if (!S.ready) { if (S.failed) renderFail(); else if (S.pre) renderPre(); return; }
    const h = location.hash || "#/";
    S.cur = h;
    const r = parse(h);
    if (S.route.name === "scan" && r.name !== "scan") stopScan();
    if (S.route.name === "magasin" && r.name !== "magasin") wakeOff();
    if (speaking && r.name !== S.route.name) speakStop();
    if (rec) micStop();
    S.route = r;
    const V = (VIEWS[r.name] || VIEWS.home)(r) || notFound();
    lastV = V;
    document.body.classList.toggle("grouped", !!V.grouped);
    /* mode guidé de « Remplir mes paniers » : plein écran, sans barre d'onglets */
    document.body.classList.toggle("solo", !!V.solo);
    /* sur grand écran, le dock n'existe que pour les vues qui y mettent leur action principale */
    document.body.classList.toggle("dockd", !!V.dockAll);
    const st = S.stacks[S.tab], pushed = st.length > 1;
    let bl = pushed ? titleOf(st[st.length - 2]) : "";
    if (bl.length > 14) bl = "Retour";
    $("#navL").innerHTML = pushed ? `<button class="back" type="button" data-act="back" aria-label="Retour, ${esc(bl)}">${ic("back")}<span>${esc(bl)}</span></button>` : V.left || "";
    $("#navT").textContent = V.title || "";
    $("#navR").innerHTML = V.right || "";
    const view = $("#view");
    view.innerHTML = `<div class="wrap">${V.html}</div>`;
    view.classList.remove("enter-push", "enter-pop", "enter-tab");
    if (S.dir === "push" || S.dir === "pop" || S.dir === "tab") { void view.offsetWidth; view.classList.add({ push: "enter-push", pop: "enter-pop", tab: "enter-tab" }[S.dir]); }
    renderChrome(V);
    document.title = V.title && V.title !== "Cabas" ? V.title + ", Cabas" : "Cabas";
    window.scrollTo(0, S.dir === "push" ? 0 : S.scroll[h] || 0);
    /* après une navigation, le focus part de la vue : le lecteur d'écran lit le nouveau titre, Tab va au contenu */
    if (S.dir === "push" || S.dir === "tab") { try { view.focus({ preventScroll: true }); } catch (e) { /* focus refusé */ } }
    const onPlace = S.dir === "none";
    S.dir = "none";
    if (V.mount) V.mount();
    rollHero(onPlace);
    markEnds();
    /* questions de départ (enseignes, déplacement, foyer, secteur) : à la première visite du panier avec des produits,
       quand elles changent le total, et jamais avant d'avoir vu ce que fait Cabas */
    if (S.ready && !S.seen.welcome && r.name === "panier" && count() > 0 && !location.hash.startsWith("#/partage")) setTimeout(() => { if ($("#sheet").hidden && S.route.name === "panier") welcomeSheet(); }, 450);
    onScroll();
  }
  function rerender() { S.scroll[S.cur] = window.scrollY; S.dir = "none"; render(); }
  /* redessin après un geste : le focus revient au même bouton, sinon à l'élément de repli (le titre du produit suivant) */
  function rerenderKeep(t, alt) {
    const key = t && t.dataset && t.dataset.act ? sameAs(t) : "", had = !!t && document.activeElement === t;
    rerender();
    const n = (key && $(key, $("#view"))) || (alt && $(alt, $("#view")));
    if (n && (had || !t)) { if (!n.hasAttribute("tabindex") && !/^(BUTTON|A|INPUT)$/.test(n.tagName)) n.setAttribute("tabindex", "-1"); try { n.focus({ preventScroll: true }); } catch (e) { /* focus refusé */ } }
  }
  const focusView = () => { try { $("#view").focus({ preventScroll: true }); } catch (e) { /* focus refusé */ } };
  function miniHtml() {
    const n = count(), nf = Object.keys(S.free || {}).length;
    if (!n) return "";
    const fm = fillMini();
    if (fm) return fm;
    /* les lignes libres ne comptent pas dans la pastille : elles n'ont pas de prix relevé */
    return `<a class="mini" href="#/panier" data-tab="panier"><span class="mn">${n}</span><span class="ml">Voir le panier${nf ? `<small>+ ${plural(nf, "ligne libre", "lignes libres")}</small>` : ""}</span><span class="mp">${eur(subtotal())}</span></a>`;
  }
  function renderChrome(V) {
    V = V || lastV || {};
    const n = count();
    const tabs = [["accueil", "Accueil", "home"], ["rayons", "Rayons", "grid"], ["recherche", "Recherche", "search"], ["listes", "Listes", "list"], ["panier", "Panier", "bag"]];
    const bdg = (t) => (t === "panier" && n ? `<span class="bdg" aria-hidden="true">${n > 99 ? "99+" : n}</span>` : "");
    const lab = (t) => (t === "panier" && n ? ` aria-label="Panier, ${plural(n, "article", "articles")}"` : "");
    $("#tabbar").innerHTML = tabs.map(([t, l, i]) => `<a class="tab" href="${ROOTS[t]}" data-tab="${t}"${S.tab === t ? ' aria-current="page"' : ""}${lab(t)}>${ic(i, "off")}${ic(i + "-f", "on")}<span>${l}</span>${bdg(t)}</a>`).join("");
    $("#side").innerHTML = `<a class="wordmark" href="#/" data-tab="accueil" aria-label="Cabas, accueil"><svg aria-hidden="true"><use href="#i-logo"/></svg>Cabas</a>` +
      tabs.map(([t, l, i]) => `<a class="sitem" href="${ROOTS[t]}" data-tab="${t}"${S.tab === t ? ' aria-current="page"' : ""}${lab(t)}>${ic(i, "off")}${ic(i + "-f", "on")}<span>${l}</span>${bdg(t)}</a>`).join("") +
      `<a class="sitem" href="#/reglages"${S.route.name === "reglages" ? ' aria-current="page"' : ""}>${ic("gear")}<span>Réglages</span></a><div class="smini">${S.route.name === "panier" || S.route.name === "remplir" ? "" : miniHtml()}</div>`;
    const dock = $("#dock"), view = $("#view");
    let dh = "";
    if (V.dock === "bar" && V.dockId) dh = `<div class="wrap">${buyCtl(V.dockId, "bar")}</div>`;
    else if (V.dockHtml) dh = `<div class="wrap">${V.dockHtml}</div>`;
    else if (n && !["panier", "remplir", "magasin", "transfert"].includes(S.route.name)) dh = `<div class="wrap">${miniHtml()}</div>`;
    const was = !dock.hidden;
    dock.innerHTML = dh;
    dock.hidden = !dh;
    /* un seul bouton plein par écran : quand la page a le sien (« Tout ajouter au panier »), le mini panier passe en teinte */
    const mini = !V.dockHtml && $(".mini", dock);
    if (mini) mini.classList.toggle("soft", !!$("#view .btn:not(.tint):not(.ghost):not(.plain):not(.danger)"));
    /* le dock entre par une montée quand il apparaît (premier produit au panier) */
    dock.classList.toggle("in", !!dh && !was);
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
  /* rangées qui défilent (chips, rails) : un fondu à droite tant qu'il reste du contenu, retiré au bout (classe .end) */
  const markEnd = (el) => el.classList.toggle("end", el.scrollLeft + el.clientWidth >= el.scrollWidth - 2);
  function markEnds() { $$(".chips, .rail").forEach(markEnd); }
  document.addEventListener("scroll", (e) => { const el = e.target; if (el && el.nodeType === 1 && (el.classList.contains("chips") || el.classList.contains("rail"))) markEnd(el); else if (el && el.classList && el.classList.contains("sheet-b")) sheetEdges(el); }, { capture: true, passive: true });
  window.addEventListener("resize", () => { markEnds(); const b = $("#sheet .sheet-b"); if (b && !$("#sheet").hidden) sheetEdges(b); });

  /* ---------- panier : actions ---------- */
  function setQty(id, q, how) {
    q = Math.max(0, Math.min(99, q | 0));
    const before = S.basket[id] || 0;
    if (q) S.basket[id] = q; else delete S.basket[id];
    saveBasket();
    if (how) buzz(q > before ? "add" : q ? "" : "remove");
    /* un produit retiré se remet en un geste, avec sa quantité, le temps du toast */
    if (before && !q && how === "dec") { const p = S.prods.get(id); undoable((p ? p.brand + " " + p.name : "Produit") + " retiré", () => { S.basket[id] = before; saveBasket(); }, 5000); }
    if (sheetCtx && sheetCtx.aux) auxPaint();
    if (S.route.name === "panier") { rerender(); return; }
    $$(`[data-buy="${CSS.escape(id)}"]`).forEach((el) => {
      const t = document.createElement("div");
      t.innerHTML = buyCtl(id, el.dataset.v);
      const nw = t.firstElementChild;
      const hadFocus = el.contains(document.activeElement);
      if (!before && q && nw.classList.contains("stepper")) nw.classList.add("pop");
      else if (before && q) { const sp = nw.querySelector("span[aria-live]"); if (sp) sp.classList.add("tick"); }
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

  /* ---------- liste écrite ou dictée ---------- */
  /* « 2 paquets de pâtes », « coca zéro x3 », « 1 kg de café », « 6 bouteilles d'eau » : une ligne par produit, ou des
     virgules. Chaque ligne devient une recherche ; Cabas prend le produit le moins cher au kilo ou au litre parmi les
     plus pertinents, dans un format courant, et l'on peut en choisir un autre avant d'ajouter au panier. */
  const STOP = new Set("de du des la le les l d un une au aux en pour avec et ou a mon ma mes produit produits paquet paquets bouteille bouteilles brique briques boite boites pot pots sachet sachets pack packs lot lots canette canettes litre litres kilo kilos gramme grammes barquette barquettes tranche tranches plaquette plaquettes tube tubes flacon flacons bidon bidons rouleau rouleaux piece pieces portion portions".split(" "));
  const NUMW = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, douze: 12, douzaine: 12, "demi-douzaine": 6 };
  const sizeOfU = (v, u) => (/^k/i.test(u) ? { v: v * 1000, u: "g" } : /^g/i.test(u) ? { v, u: "g" } : /^cl/i.test(u) ? { v: v * 10, u: "ml" } : /^ml/i.test(u) ? { v, u: "ml" } : { v: v * 1000, u: "ml" });
  function parseLine(raw) {
    let s = String(raw).trim().replace(/^[-*•·]+\s*/, "").replace(/^\d+[.)]\s+/, "");
    let n = 1, size = null, m, given = false;
    /* « un litre de lait », « demi-kilo de riz », « une douzaine d'œufs » : en chiffres */
    s = s.replace(/^(un|une|deux|trois|quatre|cinq|six|dix|douze)\s+(kg|kilos?|g|grammes?|l|litres?|cl|ml)\b/i, (x, w, u) => NUMW[norm(w)] + " " + u)
      .replace(/^(?:un |une )?demi[- ]?(kg|kilo|l|litre)\b/i, (x, u) => "0,5 " + u)
      .replace(/^(?:une )?(demi-douzaine|douzaine)\s+(?:de\s+|d['’]\s*)?(.+)$/i, (x, w, rest) => NUMW[norm(w)] + " " + rest);
    if ((m = s.match(/^(.*?)\s*(?:[x×*]\s*(\d{1,2})|\((\d{1,2})\))$/i)) && m[1]) { n = +(m[2] || m[3]); s = m[1]; given = true; }
    if ((m = s.match(/^(\d+(?:[.,]\d+)?)\s*(kg|kilos?|g|gr|grammes?|l|litres?|cl|ml)\.?\s+(?:de\s+|d['’]\s*)?(.+)$/i))) { size = sizeOfU(parseFloat(m[1].replace(",", ".")), m[2]); s = m[3]; given = true; }
    else if ((m = s.match(/^(\d{1,2}|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|douze)\s*(?:x|×|fois)?\s+(.+)$/i))) { n = /\d/.test(m[1]) ? +m[1] : NUMW[norm(m[1])]; s = m[2]; given = true; }
    if (!size && (m = s.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)\s*(kg|g|l|cl|ml)$/i))) { size = sizeOfU(parseFloat(m[2].replace(",", ".")), m[3]); s = m[1]; given = true; }
    const toks = norm(s).split(" ").filter((t) => t && !STOP.has(t));
    /* nGiven : une quantité ou une contenance a été écrite ; sinon la quantité habituelle s'applique (usualQty) */
    return { raw: String(raw).trim(), q: toks.join(" "), n: Math.max(1, Math.min(99, n || 1)), size, nGiven: given };
  }
  const valOf = (p) => { const b = best(p); if (!b) return 1e12; const u = perUnit(p, b.price); return u == null ? b.price * 1000 : u; };
  const byVal = (a, b) => valOf(a) - valOf(b);
  const packsOf = (p) => { const m = /^(\d+)\s*x/i.exec(p.format || ""); return m ? +m[1] : p.qty && p.qty.u === "pc" ? p.qty.v : 1; };
  /* mot d'ingrédient ou de parfum : dans « Tagliatelles aux œufs », le produit n'est pas des œufs */
  const ING = new Set("au aux avec sans saveur saveurs parfum parfums gout extrait extraits sauce".split(" "));
  function strongW(p) {
    if (p._sw) return p._sw;
    const nt = norm(p.name).split(" ").filter(Boolean), st = new Set();
    const mark = (i) => ING.has(nt[i]) || ((nt[i] === "la" || nt[i] === "l") && nt[i - 1] === "a");
    nt.forEach((w, i) => { if (mark(i - 1) || (mark(i - 2) && !mark(i - 1))) return; st.add(stem(w)); });
    (idx(p)._b + " " + norm(p.format) + " " + norm((rayon(p.r) || {}).name) + " " + norm((p.tags || []).join(" "))).split(" ").filter(Boolean).forEach((w) => st.add(stem(w)));
    return (p._sw = st);
  }
  /* tous les mots, ingrédients compris (« thon au naturel », « sardines à l'huile ») */
  const allW = (p) => p._aw || (p._aw = new Set(idx(p)._s));
  const RW = {};
  const rayWords = (r) => RW[r] || (RW[r] = new Set(norm((rayon(r) || {}).name).split(" ").filter(Boolean).map(stem)));
  const qToks = (q) => norm(q).split(" ").filter(Boolean).flatMap((t) => SYN[t] || [t]).map(stem);
  const strongHit = (p, toks) => { const st = strongW(p); return toks.some((t) => { for (const w of st) if (w === t || w.startsWith(t)) return true; return false; }); };
  /* mots qui désignent un produit à eux seuls : noms de rayons, marques, abréviations connues */
  let CATW = null;
  function catWords() {
    if (CATW) return CATW;
    CATW = new Set(Object.keys(SYN));
    S.rayons.forEach((r) => norm(r.name).split(" ").forEach((w) => { if (w.length > 2) CATW.add(stem(w)); }));
    S.list.forEach((p) => { const w = idx(p)._b.split(" ")[0]; if (w && w.length > 2 && w !== "sans") CATW.add(stem(w)); });
    return CATW;
  }
  /* un mot qui change la nature du produit (lingettes pour « papier toilette », culotte pour « couches », pâtée pour
     « croquettes », nectar pour « jus », rissolées pour « pommes de terre ») l'écarte, sauf s'il est écrit */
  const NOTSAME = ["lingette", "boisson", "nectar", "humide", "allege", "allegee", "leger", "legere", "culotte", "patee", "sauce", "aromatise", "sirop", "concentre", "mousse", "margarine", "boire", "rissolee"], JUICE_ONLY = new Set(["boisson", "nectar"]);
  /* variétés d'un même rayon : huile d'olive ou de tournesol, sucre blanc ou roux, riz complet, pâtes complètes, yaourt au lait de chèvre,
     bière blonde ou ambrée, vin de telle région, croquettes au poulet ou au saumon */
  const VARIETY = new Set("olive tournesol colza arachide noix sesame pepins avocat lin isio friture melange graine chevre brebi soja coco grec grecque complete integrale sarrasin mais pois roux cassonade canne morceau fluide blonde blond ambree brune bordeaux bourgogne rhone languedoc loire provence beaujolais merlot cabernet syrah grenache chardonnay sauvignon pinot basmati thai long rond nature campagne cereales tradition".split(" ").map(stem));
  /* « beurre doux 60 % MG » : un beurre allégé qui ne dit pas son nom (le beurre est à 80 % ou plus) */
  // beurre à moins de 75 % de matière grasse : « 60%MG », « 60% M.G », ou « 60% » seul (le signe tombe à la normalisation)
  const lowFat = (p) => {
    if (p.r !== "beurre") return false;
    const n = norm(p.name);
    if (/\b(1[0-9]|[2-6][0-9]|7[0-4]) ?(mg|m g)\b/.test(n)) return true;
    return /%/.test(p.name) && /\b(1[0-9]|[2-6][0-9]|7[0-4])\b(?! ?(g|kg|cl|ml|l|x|portions?|pieces?|unites?|oeufs?|par|min|cm)\b)/.test(n);
  };
  /* le mot est dans le produit lui-même (marque, nom, format, étiquettes), pas seulement dans le nom de son rayon */
  /* rayon qui nomme plusieurs produits (« Sardines, maquereaux et poissons en conserve ») : le premier mot de chacun ;
     le produit qui répond à l'un d'eux doit le dire lui-même (une baguette est un pain, une mouline une soupe) */
  const HEADS = {};
  const headsOf = (r) => { if (!HEADS[r]) { const segs = String((rayon(r) || {}).name || "").split(/,| et /); HEADS[r] = new Set(segs.length > 1 ? segs.map((x) => stem(norm(x).split(" ")[0] || "")).filter(Boolean) : []); } return HEADS[r]; };
  const KIND = { pain: ["baguette", "ficelle", "flute", "batard", "boule", "fougasse"], soupe: ["mouline", "veloute", "potage", "gaspacho"] };
  const ownPre = (p, t) => { if (ownHas(p, t)) return true; for (const w of p._ow) if (w.startsWith(t)) return true; return (KIND[t] || []).some((k) => ownHas(p, k)); };
  /* mots d'ingrédient de la ligne elle-même (« sardines à l'huile », « thon au naturel ») */
  const weakQ = (raw) => { const nt = norm(raw || "").split(" ").filter(Boolean), out = new Set(); const mark = (i) => ING.has(nt[i]) || nt[i] === "a" || ((nt[i] === "la" || nt[i] === "l") && nt[i - 1] === "a"); nt.forEach((w, i) => { if (i && mark(i - 1)) out.add(stem(w)); }); return out; };
  const ownHas = (p, t) => { if (!p._ow) p._ow = new Set((idx(p)._b + " " + norm(p.name).replace(/\b1 2 /g, "demi ") + " " + norm(p.format) + " " + norm((p.tags || []).join(" "))).split(" ").filter(Boolean).map(stem)); return p._ow.has(t); };
  function matchLine(L) {
    const out = { raw: L.raw, q: L.q, n: L.n, nGiven: !!L.nGiven, cands: [], avail: 0, pick: null };
    if (!L.q) return out;
    const toks = qToks(L.q);
    const sc = searchScored(L.q).filter((x) => strongHit(x[1], toks));
    if (!sc.length) return out;
    /* prix relevés seulement (repas) : le choix ne s'appuie jamais sur un prix simulé */
    const pb = L.real ? bestReal : best, valOf = (p) => { const b = pb(p); if (!b) return 1e12; const u = perUnit(p, b.price); return u == null ? b.price * 1000 : u; }, byVal = (a, b) => valOf(a) - valOf(b);
    let rel = sc.map((x) => x[1]);
    /* le mot exact plutôt qu'un début de mot (« thon », pas « Thonon ») ; le rayon qui porte ce nom d'abord (« huile » :
       le rayon Huile, pas des sardines à l'huile) ; puis les résultats les plus pertinents */
    const exact = rel.filter((p) => { const st = allW(p); return toks.every((t) => st.has(t)); });
    if (exact.length) rel = exact;
    /* chaque mot désigne le produit lui-même, pas un ingrédient (« lentilles corail », pas des tranches végétales aux
       lentilles corail), quand certains produits le font */
    const wq = weakQ(L.raw), sToks = toks.filter((t) => !wq.has(t));
    const strongAll = rel.filter((p) => { const st = strongW(p); return sToks.every((t) => st.has(t)); });
    if (strongAll.length) rel = strongAll;
    /* « sardines à l'huile » n'est pas « sauce tomate sans huile » */
    if (!toks.includes("san")) { const noSans = rel.filter((p) => !toks.some((t) => sig(p).includes("sans " + t))); if (noSans.length) rel = noSans; }
    /* « jus d'orange » n'est pas une boisson au jus, « papier toilette » n'est pas des lingettes : un mot qui change la
       nature du produit l'écarte, sauf si on l'a écrit */
    const dn = NOTSAME.filter((w) => !toks.includes(w)), light = ["leger", "legere", "allege", "allegee", "light"].some((w) => toks.includes(w));
    /* « boisson au jus » et « nectar » ne valent que pour les jus : un cola est, de son nom légal, une « boisson gazeuse » */
    /* le mot doit être dans le produit lui-même : le rayon « Beurre et margarine » n'écarte pas le beurre */
    const noDown = rel.filter((p) => !dn.some((w) => ownHas(p, w) && (/^jus/.test(p.r) || !JUICE_ONLY.has(w))) && (light || !lowFat(p)));
    if (noDown.length) rel = noDown;
    const inRay = rel.filter((p) => { const rw = rayWords(p.r); return toks.some((t) => rw.has(t)); });
    if (inRay.length) rel = inRay;
    /* rayon qui en nomme plusieurs (« Pommes de terre, carottes, oignons et ail ») : « oignons » veut un produit qui le
       dit lui-même, pas le moins cher du rayon */
    rel = rel.filter((p) => { const H = headsOf(p.r); return toks.every((t) => !H.has(t) || ownPre(p, t)); });
    /* mon régime : seuls les produits conformes, d'après ce que l'enseigne indique ; sans aucun, la ligne le dit et
       garde le meilleur produit (dietMiss) */
    if (dietOn()) { const fit = rel.filter((p) => dietOk(p)); if (fit.length) rel = fit; else out.dietMiss = true; }
    /* d'abord ce qui est vendu par tes enseignes, puis les résultats les plus pertinents parmi ceux-là */
    /* pertinence des mots seulement : la marque qui porte le nom du produit (« Riz du Monde ») ne passe pas devant */
    const sco = new Map(sc.map((x) => [x[1], x[2]])), sold = rel.filter((p) => pb(p));
    out.cands = (sold.length ? sold : rel).slice(0, 60).map((p) => p.id);
    out.avail = sold.length;
    if (!sold.length) return out;
    const top = Math.max(...sold.map((p) => sco.get(p)));
    const avail = sold.filter((p) => sco.get(p) >= top - 1.5);
    const sz = (p) => (p.qty && p.qty.v) || 0;
    /* la variante la plus simple : « coca » est un Coca-Cola, pas un Coca-Cola Cherry, sauf si on l'a écrit */
    const qs = new Set(toks);
    /* « sardines à l'huile » : l'huile d'olive ou de tournesol de la boîte n'est pas une variante de trop */
    const OILS = new Set(["olive", "tournesol", "colza", "arachide"]);
    /* le nom du rayon tout seul (« huile », « sucre ») : les variétés (olive ou tournesol, blanc ou roux) se valent et le
       moins cher l'emporte ; mais un parfum, un « zéro », un bio ou un décaféiné restent en trop si on ne les a pas écrits */
    const bare = avail.length && toks.every((t) => rayWords(avail[0].r).has(t));
    const extra = (p) => sig(p).split(" ").filter((t) => { const w = t.replace(/^sans /, ""); return (VARIANT.has(w) || (RAY_VARIANT[p.r] || []).includes(w)) && !qs.has(w) && !(qs.has("huile") && p.r !== "huile" && OILS.has(w)) && !(bare && VARIETY.has(w)); }).length;
    const minX = Math.min(...avail.map(extra));
    let plain = avail.filter((p) => extra(p) === minX);
    /* rayon « Jus d'orange » demandé par son nom : un pur jus de pamplemousse rangé là n'est pas un jus d'orange ;
       un mot de parfum ou de variété du nom du rayon doit être dans le produit lui-même, quand c'est le cas de certains */
    if (bare) {
      const spec = toks.filter((t) => VARIANT.has(t) || ATTR.has(t));
      if (spec.length) { const own = plain.filter((p) => spec.every((t) => ownHas(p, t))); if (own.length) plain = own; }
    }
    let pick = null, n = L.n;
    /* vivier : les produits acceptables pour cette ligne, avec la quantité à prendre de chacun (pour choisir, parmi eux,
       celui qui rend la commande la moins chère, livraison comprise : listPlan) */
    const pool = new Map();
    if (L.size) {
      const same = plain.filter((p) => p.qty && p.qty.u === L.size.u);
      const near = same.filter((p) => Math.abs(sz(p) - L.size.v) / L.size.v <= 0.15);
      const le = same.filter((p) => sz(p) <= L.size.v * 1.15);
      const set = near.length ? near : le.length ? le : same.length ? [same.slice().sort((a, b) => sz(a) - sz(b))[0]] : plain;
      set.forEach((p) => pool.set(p.id, p.qty && p.qty.u === L.size.u && sz(p) ? Math.max(1, Math.round(L.size.v / sz(p))) : 1));
      pick = set.slice().sort(byVal)[0];
      if (pick.qty && pick.qty.u === L.size.u && sz(pick)) n = Math.max(1, Math.round(L.size.v / sz(pick)));
    } else {
      /* formats courants : ceux que partagent plusieurs produits pertinents (1 L et 6 x 1 L pour le lait, 500 g et 1 kg pour les pâtes) */
      const keyS = (p) => (sz(p) ? p.qty.u + Math.round(sz(p) / Math.pow(10, Math.floor(Math.log10(sz(p))) - 1)) : "");
      const cnt = {}, szs = plain.map(sz).filter(Boolean).sort((a, b) => a - b), med = szs.length ? szs[Math.floor((szs.length - 1) / 2)] : 0;
      plain.forEach((p) => { const k = keyS(p); cnt[k] = (cnt[k] || 0) + 1; });
      let common = plain.filter((p) => cnt[keyS(p)] >= 2 && (!med || sz(p) <= med * 3));
      if (!common.length) common = plain;
      if (L.n > 1) {
        /* « 2 paquets de pâtes » : 2 paquets du format le plus courant ; « 6 bouteilles d'eau » : un pack de 6 s'il revient moins cher au litre */
        const singles = common.filter((p) => packsOf(p) === 1), sc2 = {};
        singles.forEach((p) => { const k = keyS(p); sc2[k] = (sc2[k] || 0) + 1; });
        const mode = Object.keys(sc2).sort((a, b) => sc2[b] - sc2[a])[0];
        const one = singles.filter((p) => keyS(p) === mode).sort(byVal)[0], pack = plain.filter((p) => packsOf(p) === L.n).sort(byVal)[0];
        if (pack && (!one || valOf(pack) <= valOf(one))) { pick = pack; n = 1; } else pick = one || common.slice().sort(byVal)[0];
      } else pick = common.slice().sort(byVal)[0];
      /* vivier : les formats courants, chacun en quantité équivalente au produit choisi (deux paquets de 250 g pour 500 g),
         et les packs de la quantité demandée */
      /* même type d'emballage que le produit choisi (bouteille seule ou pack de N) : trois bouteilles ne deviennent pas
         un pack de douze canettes ; les rouleaux, œufs ou lavages se comptent en quantité équivalente */
      const multi = (p) => { const m = /^(\d+)\s*x/i.exec(p.format || ""); return m ? +m[1] : 1; };
      const tot = sz(pick) * n, pk = multi(pick);
      common.filter((p) => multi(p) === pk).forEach((p) => { const s = sz(p); pool.set(p.id, s && tot && p.qty.u === pick.qty.u ? Math.max(1, Math.round(tot / s)) : n); });
      if (L.n > 1) plain.filter((p) => packsOf(p) === L.n).forEach((p) => pool.set(p.id, 1));
    }
    /* choix mémorisé pour cette ligne (« Autre choix » retenu une fois) : repris tant qu'il est vendu par tes enseignes,
       prix relevé, et pas plus de 15 % plus cher à l'unité que le meilleur du vivier ; sinon la ligne le dit et propose le
       moins cher. Le vivier se réduit alors au produit choisi : le plan peut encore changer d'enseigne, pas de marque.
       Les repas (prix relevés seulement) gardent le moins cher. */
    const uid = L.real ? null : usualFor(L.q, true), up = uid && S.prods.get(uid), ub = up && bestReal(up);
    /* un choix habituel qui ne correspond pas au régime est signalé (« Garder le mien »), jamais imposé */
    if (ub && dietOn() && !dietOk(up)) {
      out.usualAlt = { id: up.id, n: L.size && up.qty && up.qty.u === L.size.u && sz(up) ? Math.max(1, Math.round(L.size.v / sz(up))) : L.n }; out.usualDiet = true;
      if (!out.cands.includes(up.id)) out.cands.unshift(up.id);
    } else if (ub) {
      const unit = (x, b) => { const v = perUnit(x, b.price); return v == null ? b.price : v; };
      const nu = L.size && up.qty && up.qty.u === L.size.u && sz(up) ? Math.max(1, Math.round(L.size.v / sz(up))) : L.n;
      const pb0 = pb(pick);
      if (!pb0 || unit(up, ub) <= unit(pick, pb0) * 1.15) { out.usual = true; pick = up; n = nu; pool.clear(); }
      else out.usualAlt = { id: up.id, n: nu };
      if (!out.cands.includes(up.id)) out.cands.unshift(up.id);
    }
    out.pick = pick.id;
    out.n = n;
    pool.set(pick.id, n);
    out.pool = [...pool.entries()];
    return out;
  }
  /* La liste entière, livraison comprise : pour chaque ensemble d'une à trois enseignes, chaque ligne prend le produit
     du vivier le moins cher dans ces enseignes ; une enseigne dont la commande n'atteint pas son minimum disqualifie
     l'ensemble ; frais de livraison et de service comptés. Renvoie le meilleur plan : lignes couvertes, puis total. */
  if (/^(127\.0\.0\.1|localhost)$/.test(location.hostname)) window.cabasDebug = () => ({ S, listPlan, matchLine, chansOf, retsFor, parseLine, readList, fuzzyWord, fixQuery, suggestions, usualQty, cartText, freeList, best, bestReal, perUnit, dietOk, dietOn, details, detailsNow, unpack, merge: mergeCatalog, univGroups, myRayons, swapFor, recCost, freshText, searchScored, fillSnap, fillText, basketKey, leadText, fillLink, ordState, arrival, nextRun, askParse, askList, composeList, feeGap, basketAt, autoPick, applyAutoPick, model, equivOf, topupGain, topupCands, budgetFit, monthSpend, basketLimit, placeOf, cartTotal, wifList, auxGet, RES: () => RES, AUX: () => AUX, cleanPaste, rhythm, autoTemplate, weekTpl, tplDue, prepNow, cadOf, moves, momentOf, spendByMonth, loadHist, trackDrops, speakText, packState, packLink, unpackState, importCheck, storeItems, composeMenu, ghIssueUrl, ghBody, scrub, watchCheck, watchHits, factsOf, factsFetch, allergHit, cmpVerdict, recFits });
  /* jeu d'essai (tests) : un petit catalogue v2 ajouté au catalogue chargé, rayons et produits compris */
  function mergeCatalog(extra) {
    const c = unpack(extra), seen = new Set(S.list.map((p) => p.id));
    const rayons = S.rayons.concat((c.rayons || []).filter((r) => !S.rayMap.has(r.id)));
    useCatalog({ updatedAt: S.meta.updatedAt, univers: S.univers, rayons, aliases: S.alias, products: S.list.concat(c.products.filter((p) => !seen.has(p.id))) });
  }
  function listPlan(lines) {
    const chans = chansOf(retsFor(S.prefs.comp !== false)).filter((c) => !(S.allMap.get(c.id) || {}).simulated);
    const L = lines.filter((x) => x.pick && x.pool && x.pool.length);
    if (!L.length || !chans.length) return null;
    const K = Math.min(3, Math.max(1, S.prefs.maxOrders || 3), chans.length);
    const extra = Math.round((S.prefs.extraCost || 0) * 100);
    const subsets = [];
    const rec = (start, cur) => { if (cur.length) subsets.push(cur.slice()); if (cur.length === K) return; for (let i = start; i < chans.length; i++) { cur.push(i); rec(i + 1, cur); cur.pop(); } };
    rec(0, []);
    let best = null, short = null;
    for (const sub of subsets) {
      const subs = sub.map(() => 0), picks = [];
      let covered = 0;
      for (const x of L) {
        /* pour chaque enseigne de l'ensemble, le produit du vivier le moins cher ; la ligne va à la moins chère */
        const by = sub.map(() => null);
        /* quantités du vivier, multipliées si la quantité de la ligne a été changée à la main (plus ou moins) */
        const base = (x.pool.find(([id]) => id === x.pick) || [null, x.n])[1], mult = base ? x.n / base : 1;
        for (const [id, n1] of x.pool) {
          const p = S.prods.get(id);
          if (!p) continue;
          const n = Math.max(1, Math.round(n1 * mult));
          sub.forEach((ci, j) => { const o = p.offers[chans[ci].id]; if (o && o.price > 0 && !o.sim) { const c = Math.round(o.price * 100) * n; if (!by[j] || c < by[j].c) by[j] = { id, n, c }; } });
        }
        let j0 = -1;
        by.forEach((b, j) => { if (b && (j0 < 0 || b.c < by[j0].c)) j0 = j; });
        if (j0 >= 0) { subs[j0] += by[j0].c; covered++; picks.push({ line: x, by, j: j0 }); } else picks.push({ line: x, by, j: -1 });
      }
      /* une enseigne sous son minimum : on lui rapporte les lignes qui coûtent le moins cher à déplacer */
      for (let pass = 0; pass < sub.length; pass++) {
        const j = sub.findIndex((ci, jj) => subs[jj] > 0 && subs[jj] < chans[ci].P.min);
        if (j < 0) break;
        const movable = picks.filter((pk) => pk.j >= 0 && pk.j !== j && pk.by[j]).map((pk) => ({ pk, d: pk.by[j].c - pk.by[pk.j].c })).sort((a, b) => a.d - b.d);
        for (const m of movable) { if (subs[j] >= chans[sub[j]].P.min) break; subs[m.pk.j] -= m.pk.by[m.pk.j].c; m.pk.j = j; subs[j] += m.pk.by[j].c; }
      }
      if (sub.some((ci, j) => subs[j] > 0 && subs[j] < chans[ci].P.min) || subs.every((s) => s === 0)) {
        /* une seule enseigne sous son minimum : de combien ? (pour le dire quand aucune livraison n'est possible) */
        if (sub.length === 1 && subs[0] > 0) { const gap = chans[sub[0]].P.min - subs[0]; if (!short || covered > short.covered || (covered === short.covered && gap < short.gap)) short = { ch: chans[sub[0]].id, gap, covered, sub: subs[0] }; }
        continue;
      }
      picks.forEach((pk) => { if (pk.j >= 0) { pk.id = pk.by[pk.j].id; pk.n = pk.by[pk.j].n; pk.ch = chans[sub[pk.j]].id; } else pk.id = null; delete pk.by; });
      const total = subs.reduce((a, s, j) => a + s + (s > 0 ? feeAt(chans[sub[j]].P, s) + extra : 0), 0);
      const orders = sub.map((ci, j) => ({ ch: chans[ci].id, sub: subs[j], fee: subs[j] > 0 ? feeAt(chans[ci].P, subs[j]) : 0 })).filter((o) => o.sub > 0);
      if (!best || covered > best.covered || (covered === best.covered && total < best.total)) best = { covered, total, orders, picks, n: L.length };
    }
    return best || (short ? { short, n: L.length } : null);
  }
  /* Une ligne sans résultat qui contient plusieurs produits (« lait pâtes coca zéro », dictée sans virgule) est découpée
     en morceaux disponibles qui désignent chacun un produit, s'il y en a au moins deux ; « eau gazeuse » ou « lait
     d'amande » restent une seule ligne. */
  /* ligne sans résultat : « Tu voulais dire « yaourt » ? » quand la ligne corrigée trouve un produit ; jamais appliquée
     sans un geste (« Oui »). fixRaw est la ligne écrite avec le mot corrigé, quantités comprises. */
  function suggestFix(M, L) {
    if (M.pick || !L.q) return M;
    const f = fixQuery(L.q);
    if (!f) return M;
    const bad = f.from.split(" "), good = f.to.split(" ");
    const fixRaw = L.raw.replace(/[\p{L}\p{M}]+/gu, (w) => { const i = bad.indexOf(norm(w)); return i >= 0 && good[i] !== bad[i] ? good[i] : w; });
    if (fixRaw !== L.raw && matchLine(parseLine(fixRaw)).pick) { M.sugg = f.to; M.fixRaw = fixRaw; }
    return M;
  }
  function splitLine(raw) {
    const L = parseLine(raw), M0 = matchLine(L);
    if (M0.pick) return [M0];
    const toks = L.q.split(" ").filter(Boolean);
    if (toks.length < 2) return [suggestFix(M0, L)];
    const cw = catWords(), parts = [];
    let i = 0;
    while (i < toks.length) {
      let hit = null, j = toks.length;
      for (; j > i; j--) {
        const q = toks.slice(i, j).join(" ");
        if (!qToks(q).some((t) => cw.has(t))) continue;
        const m = matchLine({ raw: q, q, n: 1 });
        if (m.pick) { hit = m; break; }
      }
      if (hit) { parts.push(hit); i = j; }
      else { const last = parts[parts.length - 1]; if (last && !last.pick) { last.raw += " " + toks[i]; last.q += " " + toks[i]; } else parts.push({ raw: toks[i], q: toks[i], n: 1, cands: [], avail: 0, pick: null }); i++; }
    }
    return parts.filter((x) => x.pick).length >= 2 ? parts.map((x) => suggestFix(x, x)) : [suggestFix(M0, L)];
  }
  function readList(text) {
    const lines = String(text || "").split(/\n|;|•|,(?!\d)|\s+(?:et|puis|plus)\s+|\s\+\s/i).map((x) => x.trim()).filter((x) => norm(x));
    const out = lines.flatMap(splitLine).slice(0, 80);
    for (const x of out) {
      /* sans quantité écrite : celle que tu prends d'habitude ; une ligne déjà gardée en ligne libre le reste */
      if (x.pick) { if (!x.nGiven) { const u = usualQty(S.prods.get(x.pick)); if (u.n > 1) { x.n = u.n; x.why = u.why; } } }
      else { const f = freeOf(x.raw); if (f) { x.free = f; x.n = S.free[f].q; } }
    }
    return out;
  }
  const wlStep = (x, i) => `<div class="stepper soft"><button type="button" data-act="wldec" data-i="${i}" aria-label="${x.n > 1 ? "Un de moins" : "Retirer"}">${ic(x.n > 1 ? "minus" : "trash")}</button><span>${x.n}</span><button type="button" data-act="wlinc" data-i="${i}" aria-label="Un de plus">${ic("plus")}</button></div>`;
  /* une ligne de Ma liste : produit trouvé (avec son choix habituel ou sa quantité habituelle), ligne libre gardée, ou
     ligne sans produit (correction proposée, « Garder quand même », « Chercher ») ; data-rm permet le glisser pour retirer */
  function wlRow(x, i) {
    if (x.free && S.free[x.free]) {
      const f = S.free[x.free];
      return `<div class="item wli free" data-rm="l:${i}"><span class="thumb q">${ic("pen")}</span><div class="it">${norm(x.raw) !== norm(f.t) ? `<span class="wq">${esc(x.raw)}</span>` : ""}<b>${esc(f.t)}</b><small>Ligne libre${f.price > 0 ? ", " + esc(eur(f.price)) + " l'unité, prix saisi par toi" : ""}, ${esc(freeWhere(f))}</small></div><div class="ir"><span class="lp">${f.price > 0 ? eur(f.price * x.n) : "–"}</span>${wlStep(x, i)}</div></div>`;
    }
    if (!x.pick) {
      const off = x.cands.length > 0 && qToks(x.q || "").some((t) => catWords().has(t));
      const fix = x.sugg ? `<small>Tu voulais dire «\u00a0${esc(x.sugg)}\u00a0»\u00a0?</small>` : "";
      const yes = x.sugg ? `<button class="act" type="button" data-act="wlfix" data-i="${i}">Oui${ic("chev")}</button>` : "";
      return `<div class="item wli miss" data-rm="l:${i}"><span class="thumb q">${ic("search")}</span><div class="it"><span class="wq">${esc(x.raw)}</span><b>${off ? "Pas vendu par tes enseignes" : "Pas encore dans Cabas"}</b><small>${off ? "Vendu par une enseigne ou dans une zone que tu n'utilises pas." : "Cabas ne couvre que quelques rayons pour l'instant."}</small>${fix}<div class="acts">${yes}<button class="act" type="button" data-act="wlfree" data-i="${i}">Garder quand même${ic("chev")}</button></div></div><div class="ir"><button class="btn sm plain" type="button" data-act="wlsearch" data-i="${i}">Chercher</button></div></div>`;
    }
    const p = S.prods.get(x.pick), b = best(p), u = b ? unitPrice(p, b.price) : "";
    let note = "", acts = `<button class="act" type="button" data-act="wlalt" data-i="${i}" aria-label="Autre choix pour ${esc(x.raw)}">Autre choix${ic("chev")}</button>`;
    if (x.usualAlt && x.usualDiet) {
      const a = S.prods.get(x.usualAlt.id);
      if (a) { note += `<small>Ton habituel (${esc(a.brand)} ${esc(a.name)}) ne correspond pas à ton régime, d'après ce que l'enseigne indique.</small>`; acts += `<button class="act" type="button" data-act="wlusual" data-i="${i}">Garder le mien${ic("chev")}</button>`; }
    } else if (x.usualAlt) {
      /* le choix habituel écarté (plus de 15 % plus cher à l'unité que le meilleur du vivier) : son prix, et « moins
         cher » seulement si le produit affiché l'est vraiment (le plan a pu en prendre un autre pour toute la liste) */
      const a = S.prods.get(x.usualAlt.id), ab = a && bestReal(a);
      if (ab) {
        const ua = perUnit(a, ab.price), up = b ? perUnit(p, b.price) : null;
        const cheaper = ua != null && up != null ? up < ua : !!b && b.price < ab.price;
        note += `<small>Ton habituel est à ${esc(unitPrice(a, ab.price) || eur(ab.price))} chez ${esc(retName(ab.ret))}${simTxt(ab)}${cheaper ? `, moins cher\u00a0: ${esc(p.brand)} à ${esc(u || eur(b.price))}${simTxt(b)}` : ""}.</small>`;
        acts += `<button class="act" type="button" data-act="wlusual" data-i="${i}">Garder le mien${ic("chev")}</button>`;
      }
    }
    if (x.why && x.n > 1) { note += `<small>×\u00a0${x.n}${x.why === "habit" ? ", comme d'habitude" : " pour " + plural(+S.prefs.foyer || 1, "personne", "personnes")}.</small>`; acts += `<button class="act" type="button" data-act="wlqty1" data-i="${i}">Toujours 1${ic("chev")}</button>`; }
    if (x.dietMiss) note += `<small>Rien pour ton régime (${esc(dietWhy())}) sous «\u00a0${esc(x.q)}\u00a0»\u00a0: voici sans ce filtre.</small>`;
    return `<div class="item wli" data-rm="l:${i}"><a class="thumb" href="${hp(p.id)}" aria-label="${esc(p.brand + " " + p.name)}">${img(p, 56)}</a><div class="it"><span class="wq">${esc(x.raw)}</span><b><strong>${esc(p.brand)}</strong> ${esc(p.name)}</b><small>${esc(p.format)}${u ? ", " + esc(u) : ""}${b ? ", chez " + esc(retName(b.ret)) + (b.sim ? " (simulé)" : "") : ""}${x.usual ? ", ton choix habituel" : ""}</small>${note}<div class="acts">${acts}</div></div><div class="ir"><span class="lp">${b ? eurC(Math.round(b.price * 100) * x.n) : "–"}</span>${wlStep(x, i)}</div></div>`;
  }
  VIEWS.ecrire = () => {
    const W = S.wl || (S.wl = { text: store.get("draft", ""), lines: null });
    if (!W.lines) {
      return {
        title: "Ma liste", grouped: true,
        html: `<h1 class="lt">Ma liste</h1><p class="lt-sub">Écris ou dicte tes courses, Cabas trouve chaque produit au meilleur prix.</p>` +
          `<div class="pad"><textarea id="wlIn" class="wl" rows="7" placeholder="lait&#10;2 paquets de pâtes&#10;coca zéro x3&#10;papier toilette" aria-label="Ta liste de courses" autocapitalize="off" spellcheck="true">${esc(W.text)}</textarea></div>` +
          `<p class="gf">Une ligne par produit, ou sépare-les par des virgules. Une quantité au début (2 paquets de pâtes) ou à la fin (coca zéro x3), un poids ou un volume (1 kg de café) sont compris. Tu peux aussi coller un panier ou une commande copiés sur le site d'une enseigne, un courriel ou un ticket : Cabas garde les produits et les quantités.</p>` +
          `<div class="pad btns" style="padding-top:16px"><button class="btn" type="button" data-act="wlgo">Trouver les produits</button>${speechOK() ? `<button class="btn tint" type="button" data-act="wlmic" id="wlMic" aria-pressed="false">${ic("mic")}Dicter ma liste</button>` : ""}${pasteOK() ? `<button class="btn tint" type="button" data-act="wlpaste">${ic("paste")}Coller ma liste</button>` : ""}</div>` +
          (speechOK() ? `<p class="gf" id="wlMicNote">Dis tes produits en marquant une pause entre chacun\u00a0: la dictée passe par le service de reconnaissance vocale de ton téléphone.</p>` : "") +
          `<p class="gf" style="padding-top:14px">${esc(coverText())}. <a href="#/rayons">Voir les rayons</a></p>`,
      };
    }
    /* la liste entière, livraison comprise : l'ensemble d'enseignes le moins cher, minimums et frais compris ; quand il
       prend toute la liste, ses produits sont choisis d'office (« Autre choix » reste là pour en changer) */
    let plan = null;
    try {
      plan = W.lines.some((x) => x.pick) ? listPlan(W.lines) : null;
      if (plan && !plan.short && plan.covered === plan.n && !W.planApplied) {
        for (const pk of plan.picks) if (pk.id) { pk.line.pick = pk.id; pk.line.n = pk.n; }
        W.planApplied = true;
        plan = listPlan(W.lines);
      }
    } catch (e) { plan = null; /* la liste s'affiche quand même, produit par produit */ }
    const found = W.lines.filter((x) => x.pick), nFree = W.lines.filter((x) => x.free && S.free[x.free]).length;
    let t = 0;
    found.forEach((x) => { const b = best(S.prods.get(x.pick)); if (b) t += Math.round(b.price * 100) * x.n; });
    const nArt = found.reduce((a, x) => a + x.n, 0);
    let planHtml = "";
    if (plan && plan.short) {
      const s = plan.short;
      planHtml = `<div class="banner" role="status">${ic("coin")}<span><b>Encore ${eurC(s.gap)} pour une livraison</b>Chez ${esc(retName(s.ch).split(" ")[0])}, ${s.covered < plan.n ? s.covered + " produits sur " + plan.n + " font" : "ces produits font"} ${eurC(s.sub)} au mieux\u00a0: le minimum de commande est de ${eurC(s.sub + s.gap).replace(",00", "")}. Ajoute des produits, ou achète ce petit panier en magasin.</span></div>`;
    } else if (plan) {
      const same = plan.picks.every((pk) => !pk.id || (pk.id === pk.line.pick && pk.n === pk.line.n));
      const where = joinEt(plan.orders.map((o) => retName(o.ch).split(" ")[0]));
      const fees = plan.orders.reduce((a, o) => a + o.fee, 0);
      const head = plan.covered < plan.n ? `${plan.covered} produits sur ${plan.n}, ${eurC(plan.total)} livraison comprise` : `${eurC(plan.total)} livraison comprise`;
      const sub = `${plan.orders.length === 1 ? "Une commande" : plan.orders.length + " commandes"} chez ${esc(where)}${fees ? ", " + eurC(fees) + " de frais" : ", livraison offerte"}${plan.covered < plan.n ? ". Les autres produits ne sont vendus que par une enseigne dont la commande n'atteindrait pas le minimum d'achat." : "."}`;
      planHtml = `<div class="banner good" role="status">${ic("coin")}<span><b>${same ? "Le moins cher, livraison comprise\u00a0: " + head.replace(" livraison comprise", "") : "Encore moins cher\u00a0: " + head}</b>${sub}${same ? " Chaque produit est pris là où l'ensemble revient le moins cher\u00a0; «\u00a0Autre choix\u00a0» pour en changer un." : " Les produits ci-dessous changent pour y arriver."}</span>${same ? "" : `<button class="btn sm ghost" type="button" data-act="wlplan">Prendre ces produits</button>`}</div>`;
      W.plan = plan;
    }
    /* panier collé : ce qui a été lu ; le montant collé est dit tel quel, jamais compté comme un prix relevé */
    const P = W.paste, pfrom = P && P.from && S.allMap.has(P.from) ? S.allMap.get(P.from).name.split(" ")[0] : "";
    const pasteHtml = P ? `<div class="banner" role="status">${ic("paste")}<span><b>Panier collé${pfrom ? " de " + esc(pfrom) : ""} : ${plural(P.n, "produit lu", "produits lus")}</b>Prix, boutons et mentions du site retirés. ${P.total ? `Il faisait ${eurC(P.total)} d'après ce que tu as collé : ce montant reste à part, Cabas compte seulement les prix relevés.` : "Les prix collés restent à part : Cabas compte seulement les prix relevés."} Vérifie chaque ligne avant d'ajouter au panier.</span></div>` : "";
    return {
      title: "Ma liste", grouped: true,
      right: `<button class="txtbtn" type="button" data-act="wledit">Modifier</button>`,
      /* le bouton principal reste visible en bas, comme le mini panier : on n'a pas à descendre toute la liste */
      /* le montant du bouton est celui que le panier affichera : le plan livraison comprise quand il prend toute la liste */
      dockHtml: found.length ? `<button class="mini" type="button" data-act="wladd"><span class="mn">${nArt}</span><span class="ml">Ajouter au panier</span><span class="mp">${eurC(plan && !plan.short && plan.covered === plan.n && plan.picks.every((pk) => pk.id === pk.line.pick && pk.n === pk.line.n) ? plan.total : t)}</span></button>` : "",
      /* un seul appel à l'action plein : le dock ; en bas de page, seulement « Enregistrer en liste » */
      html: `<h1 class="lt">Ma liste</h1><p class="lt-sub">${plural(found.length, "produit trouvé", "produits trouvés")} sur ${W.lines.length}${nFree ? ", " + plural(nFree, "ligne libre", "lignes libres") : ""}${found.length && !(plan && !plan.short) ? ", environ " + eurC(t) + " au meilleur prix de chaque produit" : ""}</p>` + pasteHtml + planHtml +
        `<div class="order wlist" style="margin-top:12px">${W.lines.map(wlRow).join("")}</div>` +
        `<p class="gf">Pour chaque ligne, le produit le moins cher au kilo ou au litre parmi les plus proches de ce que tu as écrit, dans un format courant. «\u00a0Autre choix\u00a0» pour en prendre un autre.</p>` +
        (found.length ? `<div class="pad btns" style="padding-top:16px"><button class="btn tint" type="button" data-act="wlsave">Enregistrer en liste</button>${speakBtn("liste", "Écouter ma liste", "btn ghost")}</div>` : ""),
    };
  };
  /* ---------- dictée (Web Speech API, quand le navigateur la propose) ---------- */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const speechOK = () => !!SR;
  /* « Coller ma liste » : le presse-papiers lu sur demande (une liste copiée d'une note, d'un message) */
  const pasteOK = () => !!(navigator.clipboard && navigator.clipboard.readText);
  let rec = null;
  function micStop() {
    if (rec) { try { rec.stop(); } catch (e) { /* déjà arrêtée */ } rec = null; }
    const b = $("#wlMic"); if (b) { b.setAttribute("aria-pressed", "false"); b.innerHTML = `${ic("mic")}Dicter ma liste`; }
  }
  function micStart() {
    if (!SR) return;
    if (rec) { micStop(); return; }
    const ta = $("#wlIn"); if (!ta) return;
    let base = ta.value.replace(/\s+$/, "");
    const r = new SR();
    r.lang = "fr-FR"; r.continuous = true; r.interimResults = true;
    let finals = [];
    r.onresult = (e) => {
      let interim = "";
      finals = [];
      for (let i = 0; i < e.results.length; i++) { const t = (e.results[i][0].transcript || "").trim(); if (!t) continue; if (e.results[i].isFinal) finals.push(t); else interim += (interim ? " " : "") + t; }
      const said = finals.concat(interim ? [interim] : []).join("\n");
      ta.value = (base ? base + "\n" : "") + said;
      if (S.wl) S.wl.text = ta.value;
      ta.scrollTop = ta.scrollHeight;
    };
    r.onerror = (e) => { micStop(); toast(e && e.error === "not-allowed" ? "Cabas n'a pas accès au micro. Autorise-le dans les réglages du téléphone, ou écris ta liste." : "La dictée s'est interrompue, tu peux continuer au clavier."); };
    r.onend = () => { if (rec === r) { rec = null; micStop(); store.set("draft", ta.value); } };
    try { r.start(); } catch (e) { toast("La dictée n'est pas disponible ici."); return; }
    rec = r;
    const b = $("#wlMic"); if (b) { b.setAttribute("aria-pressed", "true"); b.innerHTML = `${ic("mic")}J'ai fini`; }
  }
  /* ---------- colle ton panier ---------- */
  /* Le texte d'un panier ou d'une commande copié sur le site d'une enseigne, dans un courriel, un ticket ou un message :
     chaque produit est gardé avec sa quantité ; prix, prix au kilo, boutons, totaux, livraison et mentions du site sont
     retirés. Les montants lus ne servent qu'à dire « d'après ce que tu as collé » : jamais un prix relevé, jamais dans
     le catalogue ni dans un total de Cabas. Une liste écrite à la main ressort telle quelle (paste: false). */
  /* lignes de bruit, lues sur le texte sans accents ni ponctuation (norm) : boutons, mentions, totaux, en-têtes */
  const PASTE_NOISE = [
    /^(ajouter|retirer|supprimer|modifier|diminuer|augmenter|vider|valider|commander|payer|paiement|merci|bonjour|favoris|imprimer|partager)\b/,
    /^voir (le|la|les|plus|tout|details?|produit|panier)\b/, /^(quantite|qte|qty)\b/, /^prix (au|a l|unitaire|total|barre|par|de)\b|^prix$/,
    /^(sous )?total\b|^montant\b/, /^(frais|livraison|retrait|creneau|date|heure)\b/,
    /^(remise|reduction|promo|promotion|offre|economi|cagnotte|avantage|fidelite|bon de|code promo)/,
    /^(mon |votre |ton )?panier( \d+)?( articles?| produits?)?$/, /^(ma |votre |ta )?commande\b|^recapitulatif\b|^n \d/,
    /^(carte bancaire|carte de fidelite|carte fidelite|cb|especes|rendu|ticket|caisse|client|siret|tel|telephone|tva|ttc|ht|www|http|https)\b/,
    /^(articles?|produits?|designation|libelle)( \d+| qte| quantite| prix| total)*$/, /^\d+ (articles?|produits?)$/, /^(nb|nombre d) ?articles?\b/,
    /^(disponible|en stock|rupture|indisponible|epuise)\b/, /^(vendu|expedie|livre) par\b/,
    /^(note|avis|nutri ?score|marque|origine|ingredients?|conservation|a partir de|soit)\b/,
    /^\d{1,4} (rue|avenue|av|bd|boulevard|place|chemin|allee|route|quai)\b/, /^\d{5} \D/,
    /^(e )?(monoprix|carrefour|houra|auchan|leclerc|franprix|intermarche|lidl|casino|super u|hyper u)( (market|city|express|drive|contact|bio|direct|fr|com))*( \d+)?$/,
  ];
  const PASTE_HEAD = new Set(["fruits et legumes", "fruits legumes", "cremerie", "epicerie", "epicerie salee", "epicerie sucree", "boissons", "surgeles", "hygiene", "beaute", "hygiene beaute", "entretien", "maison", "boucherie", "charcuterie", "traiteur", "frais", "bebe", "animaux", "boulangerie", "petit dejeuner", "cave", "produits laitiers", "liste de courses", "mes courses"]);
  const isNoise = (t) => { const nt = norm(t); return PASTE_HEAD.has(nt) || PASTE_NOISE.some((r) => r.test(nt)); };
  const UNIT_PRICE = /\(?\s*(?:soit\s+)?\d{1,4}(?:[.,]\d{1,3})?\s*€\s*(?:\/|par|le|la|l')\s*(?:kg|kilo|l\b|litre|unit[eé]|pi[eè]ce|100\s*g|100\s*ml|lavage|dose|m\b|rouleau)[^)\s]*\s*\)?/gi;
  const PRICE_ONE = /(\d{1,4})\s*€\s*(\d{2})(?!\d)|(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:€|eur\b|euros?\b)|€\s*(\d{1,4}(?:[.,]\d{1,2})?)/i;
  const centsOf = (m) => (m[1] ? +m[1] * 100 + +m[2] : Math.round(parseFloat(String(m[3] || m[4]).replace(",", ".")) * 100));
  const FORMAT_ONLY = /^(?:\d+\s*[x×]\s*)?\d+(?:[.,]\d+)?\s*(?:kg|g|gr|l|cl|ml|litres?)\.?$|^(?:lot de|pack de|x)\s*\d+$|^\d+\s*(?:rouleaux|couches|capsules|lavages|doses|pi[eè]ces|sachets|tranches|œufs|oeufs)$/i;
  function cleanPaste(text) {
    const src = String(text || "").replace(/\r/g, "").replace(/[\u00a0\u202f]/g, " ").replace(/\p{Extended_Pictographic}|[\u2610-\u2612\u2713-\u2718\uFE0F]/gu, " ");
    const out = [], R = { lines: out, total: null, from: null, dropped: 0, prices: 0, marks: 0 };
    const low = norm(src);
    R.from = ["monoprix", "carrefour", "houra", "auchan", "leclerc"].find((k) => low.includes(k)) || null;
    let last = null;
    const qtyTo = (n) => { if (last && n >= 1 && n <= 99) { last.n = n; last.q = true; } };
    for (let raw of src.split("\n")) {
      raw = raw.trim();
      if (!raw) continue;
      let m = /^[-–]\s*(\d{1,2})\s*\+$/.exec(raw);
      if (m) { qtyTo(+m[1]); R.dropped++; continue; }
      const mark = /^(?:\[[ x]?\]|[-*•·▪►]\s)/i.test(raw);
      if (mark) R.marks++;
      raw = raw.replace(/^(?:\[[ x]?\]\s*|[-*•·▪►]+\s*)/i, "").trim();
      /* une ligne de total : le montant est gardé à part, pour le dire tel quel */
      if (/^(?:total|montant)/i.test(norm(raw)) && !/sous/i.test(raw)) { const m = PRICE_ONE.exec(raw) || /(\d{1,4},\d{2})\s*$/.exec(raw); if (m) R.total = m.length > 2 ? centsOf(m) : Math.round(parseFloat(m[1].replace(",", ".")) * 100); R.dropped++; continue; }
      /* « - 2 + », « Quantité : 2 », « Qté 3 », « 2 X 1,29 » : la quantité du produit d'avant */
      if ((m = /^(?:quantit[eé]|qt[eé])\s*:?\s*(\d{1,2})$/i.exec(raw)) || (m = /^(\d{1,2})\s*[x×]\s*\d{1,4}[.,]\d{2}(?:\s*€)?(?:\s+\d{1,4}[.,]\d{2}\s*€?)?$/i.exec(raw))) { qtyTo(+m[1]); R.dropped++; continue; }
      if (/^\d{1,2}$/.test(raw)) { if (last && !last.q) qtyTo(+raw); R.dropped++; continue; }
      /* colonnes (tabulations, espaces, barres) : le nom, la quantité seule, les prix */
      const cells = raw.split(/\t|\s{2,}|\s\|\s|\|/).map((c) => c.trim()).filter(Boolean);
      let name = [], n = 0, price = null;
      for (let c of cells) {
        c = c.replace(UNIT_PRICE, " ").trim();
        if (!c) continue;
        if (/^\d{1,2}$/.test(c) && name.length) { n = +c; continue; }
        if ((m = /^(?:quantit[eé]|qt[eé])\s*:?\s*(\d{1,2})$/i.exec(c))) { n = +m[1]; continue; }
        let pm = PRICE_ONE.exec(c);
        while (pm) { if (price == null) price = centsOf(pm); R.prices++; c = (c.slice(0, pm.index) + " " + c.slice(pm.index + pm[0].length)).trim(); pm = PRICE_ONE.exec(c); }
        /* ticket de caisse : le montant en fin de ligne, sans le signe € */
        if ((pm = /(?:^|\s)(\d{1,4},\d{2})$/.exec(c)) && /\p{L}{2}/u.test(c.slice(0, pm.index))) { if (price == null) price = Math.round(parseFloat(pm[1].replace(",", ".")) * 100); R.prices++; c = c.slice(0, pm.index).trim(); }
        if (/^\d{1,4}[.,]\d{2}$/.test(c)) { if (price == null) price = Math.round(parseFloat(c.replace(",", ".")) * 100); R.prices++; continue; }
        if (c) name.push(c);
      }
      let t = name.join(" ").replace(/\s*€\s*/g, " ").replace(/\s+/g, " ").replace(/^[-–:,;.]+|[-–:,;]+$/g, "").trim();
      if (((m = /^(.*?)\s*\(\s*[x×]\s*(\d{1,2})\s*\)$/i.exec(t)) || (m = /^(.*?)\s+[x×]\s*([1-9])$/i.exec(t))) && /\p{L}/u.test(m[1])) { n = +m[2]; t = m[1].trim(); }
      else if ((m = /^(\d{1,2})\s*[x×]\s+(\D.*)$/i.exec(t))) { n = +m[1]; t = m[2].trim(); }
      if (!t || !/\p{L}{2}/u.test(t)) { if (price != null && last && last.price == null) last.price = price; if (n) qtyTo(n); if (price != null || n) R.dropped++; continue; }
      /* la contenance ou la marque seule sur sa ligne (paniers des sites, un produit sur plusieurs lignes) : avec le
         produit d'avant, s'il est écrit en minuscules (sur un ticket de caisse, tout est en capitales) */
      if (last && last.price == null && !n && !mark && !R.marks && (FORMAT_ONLY.test(t) || (/^[\p{Lu}][\p{Lu}'&. -]{1,24}$/u.test(t) && t.split(" ").length <= 2 && /\p{Ll}/u.test(last.t)))) { last.t += " " + t; if (price != null) last.price = price; continue; }
      if (isNoise(t)) { R.dropped++; continue; }
      last = { t, n: n || 1, price, q: !!n };
      out.push(last);
    }
    R.paste = R.prices > 0 || R.dropped >= 2 || R.marks >= 2 || out.some((x) => x.q && x.n > 1 && /\d/.test(x.t));
    if (R.total == null && R.prices && out.length && out.every((x) => x.price != null)) R.total = out.reduce((a, x) => a + x.price, 0);
    R.text = out.map((x) => (x.n > 1 || /[x×]\s*\d{1,2}$/i.test(x.t) ? x.t + " x" + x.n : x.t)).join("\n");
    return R;
  }
  /* une liste reçue (collée, partagée depuis une autre appli) : lue tout de suite, comme « Trouver les produits » ; un
     panier copié sur un site est nettoyé d'abord (cleanPaste) */
  function listFrom(text) {
    const C = cleanPaste(text), clean = C.paste && C.lines.length ? C.text : text;
    /* le brouillon en attente (frappe dans le champ) ne doit pas remettre le texte collé brut */
    clearTimeout(draftT);
    S.wl = { text: clean, lines: readList(clean), paste: C.paste && C.lines.length ? { n: C.lines.length, total: C.total, from: C.from, dropped: C.dropped } : null }; store.set("draft", clean);
    if (!S.wl.lines.length) { S.wl.lines = null; if (S.route.name === "ecrire") rerender(); toast("Rien à lire dans cette liste"); return; }
    if (S.route.name === "ecrire") { window.scrollTo(0, 0); rerender(); } else push("#/ecrire");
    toast(S.wl.paste ? `Panier collé : ${plural(S.wl.lines.length, "produit lu", "produits lus")}` : plural(S.wl.lines.length, "ligne lue", "lignes lues"), null, "check");
  }
  function wlAltSheet(i) {
    const x = S.wl.lines[i];
    if (!x) return;
    const list = x.cands.map((id) => S.prods.get(id)).filter((p) => p && best(p)).sort((a, b) => valOf(a) - valOf(b)).slice(0, 40);
    openSheet({
      title: x.raw,
      body: `<p>Du moins cher au plus cher, au kilo ou au litre.</p><div class="group" role="radiogroup" aria-label="Produits proposés">${list.map((p) => { const b = best(p); return `<button class="opt alt" type="button" role="radio" aria-checked="${p.id === x.pick}" data-act="wlpick" data-i="${i}" data-id="${esc(p.id)}"><span class="thumb">${img(p, 40)}</span><span class="at"><b>${esc(p.brand)}</b> ${esc(p.name)}<small>${esc(p.format)}${unitPrice(p, b.price) ? ", " + esc(unitPrice(p, b.price)) : ""}, chez ${esc(retName(b.ret))}${simTxt(b)}</small></span><span class="ap">${eur(b.price)}</span><span class="box">${ic("check")}</span></button>`; }).join("")}</div>`,
    });
  }
  function wlItems() {
    const items = {};
    for (const x of (S.wl && S.wl.lines) || []) if (x.pick) items[x.pick] = Math.min(99, (items[x.pick] || 0) + x.n);
    return items;
  }
  /* lignes libres d'une liste de Ma liste, telles qu'une liste enregistrée les garde : [texte, quantité] */
  const wlFree = () => ((S.wl && S.wl.lines) || []).filter((x) => x.free && S.free[x.free]).map((x) => [S.free[x.free].t, x.n]).slice(0, 20);

  /* ---------- lignes libres ---------- */
  /* Un produit absent du catalogue garde sa place : son texte, sa quantité, son prix si on le connaît (« prix saisi par
     toi », jamais mêlé aux prix relevés) et où le chercher (une enseigne, le magasin, peu importe). Elle suit le panier,
     la liste copiée et la liste partagée ; l'optimiseur, les économies et les remplacements ne la voient jamais. */
  const freeList = () => Object.keys(S.free || {}).map((k) => Object.assign({ fid: k }, S.free[k])).sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
  const freeOf = (text) => { const t = norm(text); return t ? Object.keys(S.free || {}).find((k) => norm(S.free[k].t) === t) || null : null; };
  const freeRet = (g) => S.rets.find((r) => offKey(r) === g && retOn(r.id)) || null;
  function freeWhere(f) {
    if (f.ret === "mag") return "en magasin";
    const r = f.ret && freeRet(f.ret);
    return r ? "chez " + r.name.split(" ")[0] : "peu importe l'enseigne";
  }
  function freeFoot() {
    const L = freeList(), priced = L.filter((f) => f.price > 0), un = L.length - priced.length;
    if (!priced.length) return plural(L.length, "ligne libre sans prix", "lignes libres sans prix");
    const t = priced.reduce((a, f) => a + f.price * f.q, 0);
    return `${eur(t)} de ${priced.length > 1 ? "lignes libres, prix saisis" : "ligne libre, prix saisi"} par toi, non compris dans le total du panier${un ? ", et " + plural(un, "ligne libre sans prix", "lignes libres sans prix") : ""}`;
  }
  function freeRow(f) {
    return `<div class="item free" data-rm="f:${esc(f.fid)}"><span class="thumb q">${ic("pen")}</span><div class="it"><b>${esc(f.t)}</b><small>${esc(freeWhere(f))}${f.price > 0 ? ", " + esc(eur(f.price)) + " l'unité, prix saisi par toi" : ", prix inconnu"}</small></div><div class="ir"><span class="lp">${f.price > 0 ? eur(f.price * f.q) : "–"}</span><div class="stepper soft" role="group" aria-label="Quantité de ${esc(f.t)}"><button type="button" data-act="freedec" data-id="${esc(f.fid)}" aria-label="${f.q > 1 ? "Retirer un" : "Retirer"}">${ic(f.q > 1 ? "minus" : "trash", f.q > 1 ? "" : "trash")}</button><span>${f.q}</span><button type="button" data-act="freeinc" data-id="${esc(f.fid)}" aria-label="Ajouter un">${ic("plus")}</button></div></div></div>`;
  }
  /* section du panier, sous les commandes */
  function freeRows() {
    const L = freeList();
    if (!L.length) return "";
    return `<h2 class="gh">Tes lignes libres</h2><div class="order freebox" style="margin-top:0">${L.map(freeRow).join("")}<div class="of"><p class="ln"><span>${freeFoot()}</span></p></div></div>`;
  }
  /* lignes libres d'une liste enregistrée ou partagée */
  function listFreeHtml(L) {
    const F = (L && L.free) || [];
    if (!F.length) return "";
    return `<h2 class="gh">Lignes libres</h2><div class="group">${F.map(([t, q]) => `<div class="row"><span class="mono sm" aria-hidden="true">${ic("pen")}</span><span class="rt">${esc(t)}<small>Ligne libre, à chercher sur le site</small></span><span class="val num">× ${q | 0}</span></div>`).join("")}</div>`;
  }
  /* lignes libres d'une liste ([texte, quantité]) remises dans le panier : une ligne déjà là prend la quantité en plus */
  function addFree(pairs) {
    let n = 0;
    for (const [t0, q0] of Array.isArray(pairs) ? pairs : []) {
      const t = String(t0 || "").trim().slice(0, 60), q = Math.max(1, Math.min(99, q0 | 0));
      if (!t) continue;
      const k = freeOf(t);
      if (k) S.free[k].q = Math.min(99, S.free[k].q + q); else S.free[(Date.now() + n).toString(36)] = { t, q, at: new Date().toISOString() };
      n++;
    }
    if (n) saveFree();
    return n;
  }
  /* une enseigne désactivée après coup, ou plus de passage en magasin : la ligne revient à « peu importe » */
  function freeCheck(say) {
    let n = 0;
    for (const k of Object.keys(S.free || {})) {
      const f = S.free[k];
      if ((f.ret === "mag" && S.prefs.comp === false) || (f.ret && f.ret !== "mag" && !freeRet(f.ret))) { delete f.ret; n++; }
    }
    if (n) { saveFree(); if (say) toast(n > 1 ? `${n} lignes libres passent à «\u00a0peu importe\u00a0»` : "Une ligne libre passe à «\u00a0peu importe\u00a0»"); }
    return n;
  }
  function freeRemove(fid) {
    const f = S.free[fid];
    if (!f) return;
    delete S.free[fid]; saveFree();
    undoable(f.t + " retiré", () => { S.free[fid] = f; saveFree(); }, 5000);
  }
  /* retirer une ligne de Ma liste (stepper à zéro ou glissement) : la ligne revient avec « Annuler », sa ligne libre aussi */
  function wlRemove(i) {
    const L = S.wl && S.wl.lines, x = L && L[i];
    if (!x) return;
    L.splice(i, 1);
    const fid = x.free, f = fid && S.free[fid];
    if (f) { delete S.free[fid]; saveFree(); }
    const p = x.pick && S.prods.get(x.pick);
    undoable((p ? p.brand + " " + p.name : f ? f.t : x.raw) + " retiré", () => { L.splice(i, 0, x); if (f) { S.free[fid] = f; saveFree(); } }, 5000);
  }
  /* la feuille « Ligne libre » : texte, quantité, prix facultatif, où la chercher ; S.freeEdit porte la saisie en cours */
  function freeSheet(i) {
    const x = S.wl && S.wl.lines[i];
    if (!x) return;
    S.freeEdit = { i, t: x.raw.slice(0, 60), q: Math.max(1, Math.min(99, x.n || 1)), price: "", ret: null };
    const build = () => {
      const E = S.freeEdit, rets = S.rets.filter((r) => !r.simulated && retOn(r.id));
      const chip = (v, l) => `<button class="chip" type="button" role="radio" aria-checked="${(E.ret || "") === v}" data-act="freeret" data-v="${esc(v)}">${l}</button>`;
      return {
        body: `<p>Cette ligne reste dans ta liste et ton panier, sans entrer dans les totaux aux prix relevés.</p>` +
          field("freeT", "Produit", `type="text" maxlength="60" autocomplete="off" enterkeyhint="done" value="${esc(E.t)}"`, "") +
          `<div class="row frow"><span class="rt" id="freeQL">Quantité</span><div class="stepper soft flat" role="group" aria-labelledby="freeQL"><button type="button" data-act="freedec" aria-label="Un de moins"${E.q > 1 ? "" : ' aria-disabled="true"'}>${ic("minus")}</button><span aria-live="polite">${E.q}</span><button type="button" data-act="freeinc" aria-label="Un de plus">${ic("plus")}</button></div></div>` +
          field("freeP", "Prix si tu le connais", `type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" placeholder="Facultatif" value="${esc(E.price)}"`, "Ton prix reste à part des prix relevés, il n'entre dans aucun total.", "€") +
          `<h3 class="gh" id="freeWL">Où</h3><div class="tagset" role="radiogroup" aria-labelledby="freeWL">${chip("", "Peu importe")}${rets.map((r) => chip(offKey(r), "Chez " + esc(r.name.split(" ")[0]))).join("")}${S.prefs.comp !== false ? chip("mag", "En magasin") : ""}</div>`,
        foot: `<button class="btn" type="button" data-act="freeok">Garder</button>`,
      };
    };
    const o = build();
    openSheet({ title: "Ligne libre", body: o.body, foot: o.foot, build, focus: "#freeT", right: `<span></span>` });
  }

  /* ---------- choix habituels et quantités habituelles ---------- */
  /* quantité d'un produit quand la ligne n'en écrit pas : la médiane de ses quantités dans les paniers commandés (deux au
     moins), sinon la table par rayon et par foyer (1, 2, 4, 6 personnes), sinon 1 ; « Toujours 1 » par rayon l'emporte */
  const QTY_FOYER = { eaux: [1, 1, 2, 3], lait: [1, 1, 2, 3], yaourts: [1, 1, 2, 2], oeufs: [1, 1, 1, 2], papier: [1, 1, 1, 1], pates: [1, 1, 2, 2] }, QTY_DEF = [1, 1, 1, 2];
  function usualQty(p) {
    if (!p || (S.prefs.qty1 || {})[p.r]) return { n: 1, why: null };
    const qs = (S.hist || []).filter((h) => h.items && h.items[p.id] > 0).map((h) => h.items[p.id]).sort((a, b) => a - b);
    if (qs.length >= 2) return { n: Math.max(1, Math.min(99, qs[Math.floor((qs.length - 1) / 2)] | 0)), why: "habit" };
    const f = +S.prefs.foyer || 0;
    if (!f) return { n: 1, why: null };
    return { n: (QTY_FOYER[p.r] || QTY_DEF)[f <= 1 ? 0 : f <= 2 ? 1 : f <= 4 ? 2 : 3], why: "foyer" };
  }
  const usualCount = () => Object.keys(S.prefs.usual || {}).length + Object.keys(S.prefs.keep || {}).length + Object.keys(S.prefs.qty1 || {}).length + Object.keys(S.prefs.pin || {}).length + Object.keys(S.prefs.ban || {}).length + Object.keys(S.flex || {}).length;
  /* réglages : les choix mémorisés dans Ma liste, les marques gardées (remplacements refusés) et les rayons « toujours 1 » */
  function usualSheet() {
    const build = () => {
      const U = S.prefs.usual || {}, K = S.prefs.keep || {}, Q = S.prefs.qty1 || {};
      const prod = (id) => S.prods.get(S.prods.has(id) ? id : (S.alias || {})[id]);
      const row = (title, sub, act, k) => `<div class="row"><span class="rt">${title}<small>${sub}</small></span><button class="icbtn" type="button" data-act="${act}" data-k="${esc(k)}" aria-label="Oublier, ${esc(title)}">${ic("x")}</button></div>`;
      const us = Object.keys(U).map((k) => { const p = prod(U[k].id); return p ? row(esc(k), esc(p.brand + " " + p.name + (p.format ? ", " + p.format : "")), "usualdel", k) : ""; }).join("");
      const ks = Object.keys(K).map((id) => { const p = prod(id); return p ? row(esc(p.brand + " " + p.name), esc((p.format ? p.format + ", " : "") + "jamais remplacé par un équivalent moins cher"), "keepdel", id) : ""; }).join("");
      const qs = Object.keys(Q).map((r) => row(esc((rayon(r) || {}).name || r), "Toujours 1 dans Ma liste, sans quantité écrite", "qty1del", r)).join("");
      /* choix faits dans le panier : où prendre un produit (épingle, exclusions), équivalents acceptés (panier souple) */
      const rs = [...new Set(Object.keys(S.prefs.pin || {}).concat(Object.keys(S.prefs.ban || {})))].map((id) => { const p = prod(id); if (!p) return ""; const sub = [pinOf(id) ? "Toujours chez " + groupName(pinOf(id)) : "", Object.keys(banOf(id)).length ? "jamais chez " + joinEt(Object.keys(banOf(id)).map(groupName)) : ""].filter(Boolean).join(", "); return row(esc(pname(p)), esc(sub.replace(/^./, (c) => c.toUpperCase())), "ruledel", id); }).join("");
      const fs = Object.keys(S.flex || {}).map((id) => { const p = prod(id); return p ? row(esc(pname(p)), plural((S.flex[id] || []).length, "équivalent accepté", "équivalents acceptés"), "flexdel", id) : ""; }).join("");
      const any = us || ks || qs || rs || fs;
      const body = `<p>Ce que tu choisis une fois dans Ma liste revient d'office, tant que son prix suit. Les marques gardées ne sont plus proposées au remplacement.</p>` +
        (us ? `<h3 class="gh">Mes choix habituels</h3><div class="group">${us}</div>` : "") + (ks ? `<h3 class="gh">Marques gardées</h3><div class="group">${ks}</div>` : "") + (qs ? `<h3 class="gh">Toujours 1</h3><div class="group">${qs}</div>` : "") +
        (rs ? `<h3 class="gh">Où prendre mes produits</h3><div class="group">${rs}</div>` : "") + (fs ? `<h3 class="gh">Panier souple</h3><div class="group">${fs}</div>` : "") +
        (any ? "" : `<p class="gf">Rien pour l'instant. Dans Ma liste, «\u00a0Autre choix\u00a0» puis un produit\u00a0: Cabas s'en souvient. Dans le panier, touche le prix d'un produit pour choisir où le prendre.</p>`);
      return { body, foot: any ? `<button class="btn plain" type="button" data-act="usualreset">Tout oublier</button>` : "" };
    };
    const o = build();
    openSheet({ title: "Mes choix et mes marques", body: o.body, foot: o.foot, build, onClose: () => { if (S.route.name === "reglages") rerender(); } });
  }

  /* ---------- remplacements moins chers ---------- */
  /* Même rayon, même nombre d'unités, contenance à 20 % près et mêmes caractéristiques (variété, forme, parfum, sans
     sucres, eau minérale ou de source, lait frais ou UHT, bio...) : seule la marque change. Comparé sur les prix
     relevés, jamais sur un prix simulé. */
  /* variantes qui ne valent que dans un rayon : une bière forte n'est pas la bière de tous les jours, alors qu'une
     moutarde forte est la moutarde ordinaire */
  const RAY_VARIANT = { bieres: ["forte", "fort"] };
  const VARIANT = new Set("zero light sucre stevia max cherry vanille citron fraise peche menthe framboise mangue pamplemousse grenade cerise aromatisee decafeine decaf bio lactose croissance vitamine omega chocolat pepite nappee noisette amande caramel gluten complet complete integrale magnesium humide sensitive hypoallergenique couleur noir marseille brebi chevre soja coco vegetal grec grecque bifidu calcium graine melange isio friture roux cassonade canne morceau fluide sarrasin mais pois tournesol colza olive arachide noix sesame pepins avocat lin fondue cru fume sec dinde poulet volaille halal casher chaton chiot junior senior sterilise capsule poudre feuille recharge culotte pants blonde ambree brune blanche ipa alcool rose fruits epice epices piment sale paprika barbecue fluor blancheur sensible antipelliculaire gras secs normaux homme femme bebe enfant".split(" ").map(stem));
  const ATTR = new Set(("gazeuse petillante bulle plate aromatisee citron fraise peche menthe framboise mangue pamplemousse grenade cerise vanille " +
    "zero light sucre stevia max cherry pulpe concentre presse orange sanguine multifruit agrume " +
    "bio lactose entier ecreme demi croissance vitamine omega montagne microfiltre " +
    "brasse ferme grec grecque brebi chevre soja coco vegetal bifidu calcium " +
    "emmental mozzarella parmesan parmigiano grana comte gruyere cheddar raclette pecorino mimolette melange gratin pizza copeaux " +
    "spaghetti spaghettini penne fusilli coquillette farfalle tagliatelle macaroni torsade lasagne linguine rigatoni tortiglioni conchiglie " +
    "ravioli gnocchi vermicelle cheveux papillon nouille orzo fettuccine mezze tortellini cannelloni pipe perle " +
    "complete integrale gluten fraiche oeuf epeautre lentille chiche " +
    "huile olive tomate piment arete tournesol colza beurre minerale source magnesium sport frai uht sterilise pur nectar graine melange isio friture roux cassonade canne morceau fluide sarrasin mais pois pelee concassee coulis pulpe naturel albacore listao miette demi sel plein air sol basmati thai long parfume complet rond " +
    "decafeine decaf arabica robusta intense corse doux " +
    "madeleine quatre quart brownie cookie financier marbre cake moelleux crepe gaufre sable galette palmier biscuit " +
    "chocolat pepite nappee noisette amande caramel " +
    "double triple epaisseur compact humide " +
    "capsule poudre gel sensitive hypoallergenique ecolabel couleur noir marseille " +
    "cru fume sec dinde poulet volaille porc boeuf veau agneau saumon cabillaud crevette halal casher degraisse superieur " +
    "camembert brie roquefort bleu brebis comte emmental gouda edam feta mozzarella raclette fondue tartiner " +
    "liquide feuille recharge taille culotte pants chat chien chaton chiot sterilise adulte senior junior " +
    "rouge blanc rose bordeaux bourgogne cotes rhone languedoc loire provence beaujolais merlot cabernet chardonnay sauvignon syrah grenache pinot igp aop aoc " +
    "blonde ambree brune blanche ipa alcool tonic limonade glace mie cereales tradition campagne nature pane surgele " +
    "menthe fluor blancheur antibacterien sensible peau cheveux gras secs normaux antipelliculaire homme femme bebe enfant").split(" ").map(stem));
  VARIANT.forEach((t) => ATTR.add(t));
  function sig(p) {
    if (p._sig != null) return p._sig;
    /* « sans pulpe » et « avec pulpe » ne sont pas la même chose */
    const nt = norm(p.name).split(" ").filter(Boolean).map(stem), w = new Set();
    nt.forEach((t, i) => { if (ATTR.has(t) || (RAY_VARIANT[p.r] || []).includes(t)) w.add(nt[i - 1] === "san" ? "sans " + t : t); });
    if ((p.tags || []).includes("Bio")) w.add("bio");
    /* un beurre à moins de 75 % de matière grasse n'est pas l'équivalent d'un beurre ordinaire */
    if (lowFat(p)) w.add("allege");
    return (p._sig = [...w].sort().join(" "));
  }
  const bestReal = (p) => offers(p, true).find((o) => !o.sim) || null;
  /* Les remplacements restent dans les enseignes de la répartition en cours : un produit remplacé peut rejoindre une
     commande déjà prévue, et l'économie compare le prix payé aujourd'hui au prix dans ces enseignes. */
  function swapCtx() {
    const st = RES.steps[RES.K], bst = st && (st.full || st.partial);
    if (!bst) return null;
    const paid = {}, rets = new Set(bst.orders.map((o) => o.ch.id));
    /* un produit dont Cabas prend déjà un équivalent (panier souple) n'est pas proposé en plus */
    bst.orders.forEach((o) => o.items.forEach((x) => { if (!x.alt) paid[x.l.id] = { price: x.cost / x.l.q / 100, ret: o.ch.id }; }));
    (bst.completed || []).forEach((x) => { if (!x.alt) paid[x.l.id] = { price: x.cost / x.l.q / 100, ret: x.ret }; rets.add(x.ret); });
    return { paid, rets };
  }
  function swapFor(id, ctx) {
    const p = S.prods.get(id), q = S.basket[id];
    if (!p || !(q > 0) || (S.prefs.keep || {})[id] || !p.qty || !p.qty.v) return null;
    const now = ctx ? ctx.paid[id] : bestReal(p);
    const u = now && perUnit(p, now.price);
    if (!now || u == null) return null;
    const s = sig(p), diet = dietOn();
    let w = null;
    for (const e of inRayon(p.r)) {
      if (e === p || e.r !== p.r || !e.qty || e.qty.u !== p.qty.u || Math.abs(e.qty.v - p.qty.v) / p.qty.v > 0.2 || packsOf(e) !== packsOf(p) || S.basket[e.id] || sig(e) !== s || (diet && !dietOk(e))) continue;
      const be = offers(e, true).find((o) => !o.sim && (!ctx || ctx.rets.has(o.ret))), ue = be && perUnit(e, be.price);
      if (!be || ue == null || ue > u * 0.97 || (now.price - be.price) * q < 0.2) continue;
      if (!w || be.price < w.toP.price) w = { from: p, to: e, q, fromP: now, toP: be };
    }
    if (w) w.save = (w.fromP.price - w.toP.price) * w.q;
    return w;
  }
  const swaps = () => { const ctx = swapCtx(); return Object.keys(S.basket).map((id) => swapFor(id, ctx)).filter(Boolean).sort((a, b) => b.save - a.save); };
  function swapSheet() {
    const sw = swaps();
    if (!sw.length) { toast("Aucun équivalent moins cher pour l'instant"); return; }
    S.swSel = Object.fromEntries(sw.map((x) => [x.from.id, true]));
    const build = () => {
      const sel = sw.filter((x) => S.swSel[x.from.id]), tot = sel.reduce((a, x) => a + x.save, 0);
      const row = (x) => {
        const on = !!S.swSel[x.from.id];
        return `<button class="swr" type="button" data-act="swaptg" data-id="${esc(x.from.id)}" role="checkbox" aria-checked="${on}"><span class="box">${ic("check")}</span><span class="swb">` +
          `<span class="swp"><span class="thumb">${img(x.from, 40)}</span><span class="swt"><b>${esc(x.from.brand)}</b> ${esc(x.from.name)}<small>${x.q > 1 ? x.q + " × " : ""}${esc(x.from.format)}, ${eur(x.fromP.price)}</small></span></span>` +
          `<span class="swp to"><span class="thumb">${img(x.to, 40)}</span><span class="swt"><b>${esc(x.to.brand)}</b> ${esc(x.to.name)}<small>${esc(x.to.format)}, ${eur(x.toP.price)} chez ${esc(retName(x.toP.ret))}</small></span></span>` +
          `<span class="sws">${eur(x.save)} de moins</span></span></button>`;
      };
      return {
        body: `<p>Même rayon, même type de produit, format proche\u00a0: seule la marque change. Décoche un produit pour garder sa marque, il ne te sera plus proposé.</p><div class="group">${sw.map(row).join("")}</div><p class="gf">Économie calculée sur le meilleur prix de chaque produit\u00a0; le total du panier, frais compris, est recalculé après le remplacement.</p>`,
        foot: `<div class="swfoot">${sel.length ? `<span>Environ <b>${eur(tot)}</b> de moins</span>` : ""}<button class="btn" type="button" data-act="swapok">${sel.length ? `Remplacer ${plural(sel.length, "produit", "produits")}` : "Garder toutes les marques"}</button></div>`,
      };
    };
    const o = build();
    openSheet({ title: "Économiser encore", body: o.body, foot: o.foot, build });
  }

  /* ---------- panier intelligent : où prendre un produit, panier souple, tableau, Et si, compléter ---------- */
  /* nom d'un groupe d'enseigne (« auchan » vaut pour toutes ses options de livraison et de retrait) */
  const groupName = (g) => { const r = S.allMap.get(g) || (groupsOf()[g] || [])[0]; return r ? r.name : g; };
  /* où va un produit dans la répartition affichée : l'enseigne, le coût, l'équivalent pris, en magasin */
  function placeOf(id) {
    const st = RES.steps[RES.K], bst = st && (st.full || st.partial);
    if (!bst) return null;
    for (const o of bst.orders) { const x = o.items.find((y) => y.l.id === id); if (x) return { ret: o.ch.id, cost: x.cost, alt: x.alt || null }; }
    const c = (bst.completed || []).find((y) => y.l.id === id);
    return c ? { ret: c.ret, cost: c.cost, alt: c.alt || null, mag: true } : null;
  }
  const cartTotal = () => { const st = RES.steps[RES.K]; return st && st.full ? fullTotal(st.full) : null; };
  /* Où le prendre : épingler le produit à une enseigne, l'exclure d'une enseigne, accepter un équivalent. Chaque
     choix change le modèle de la répartition (model) : le total en bas de la feuille est le nouveau total exact. */
  function itemSheet(id) {
    const p = S.prods.get(id);
    if (!p) return;
    const build = () => {
      cartResult();
      const pin = pinOf(id), ban = banOf(id), gs = new Map(), q = S.basket[id] || 1;
      for (const r of S.rets) { const o = p.offers[r.id]; if (o && o.price > 0 && retOn(r.id) && !gs.has(offKey(r))) gs.set(offKey(r), { r, o }); }
      const G = [...gs.entries()], lab = (v) => eur(v.o.price) + (v.o.sim ? ", simulé" : "");
      const pl = placeOf(id), a = pl && pl.alt && S.prods.get(pl.alt);
      const now = pl ? `Dans ta répartition\u00a0: ${pl.mag ? "en magasin chez " : "chez "}${esc(retName(pl.ret))}, ${eurC(pl.cost)}${!pl.mag && (S.allMap.get(pl.ret) || {}).simulated ? " (prix simulé)" : ""}${a ? `, avec l'équivalent ${esc(pname(a))}` : ""}.` : RES.done ? "Ce produit n'entre dans aucune commande pour l'instant." : "Calcul de la répartition…";
      const lost = pin && !gs.has(pin) ? `<p class="gf">Épinglé chez ${esc(groupName(pin))}, qui ne le vend pas parmi tes enseignes actuelles\u00a0: Cabas le prend ailleurs.</p>` : "";
      const eq = equivOf(p, null, 6), on = !!(S.flex || {})[id], acc = new Set((S.flex || {})[id] || []);
      const total = cartTotal();
      return {
        body: `<div class="row th ihead"><span class="thumb">${img(p, 48)}</span><span class="rt"><b>${esc(p.brand)}</b> ${esc(p.name)}<small>${q > 1 ? q + "\u00a0× " : ""}${esc(p.format)}</small></span></div>` +
          `<p aria-live="polite">${now}</p><p class="gf">Cabas prend chaque produit là où le total du panier, livraison comprise, est le plus bas. Pour celui-ci, tu peux décider.</p>` +
          `<h3 class="gh" id="ipinL">Où le prendre</h3><div class="group" role="radiogroup" aria-labelledby="ipinL">${opt("itempin", "Là où le total est le plus bas", !pin || !gs.has(pin), `data-id="${esc(id)}" data-g=""`, null, true)}${G.map(([g, v]) => opt("itempin", "Toujours chez " + esc(v.r.name), pin === g, `data-id="${esc(id)}" data-g="${esc(g)}"`, esc(lab(v)), true)).join("")}</div>${lost}` +
          (G.length > 1 || Object.keys(ban).length ? `<h3 class="gh" id="ibanL">Jamais chez</h3><div class="group" role="group" aria-labelledby="ibanL">${G.map(([g, v]) => opt("itemban", esc(v.r.name), !!ban[g], `data-id="${esc(id)}" data-g="${esc(g)}"`, esc(lab(v)))).join("")}</div><p class="gf">Exclu d'une enseigne, ce produit n'y est jamais pris, même moins cher.</p>` : "") +
          `<h3 class="gh">Panier souple</h3><div class="group"><div class="row"><span class="rt" id="iflexL">Accepter un équivalent<small>${eq.length ? "Une autre marque, même rayon, même type de produit, format proche\u00a0: Cabas la prend quand le total baisse, et te le dit sur la ligne." : "Aucun équivalent proche parmi tes enseignes pour ce produit."}</small></span><label class="sw hit"><input type="checkbox" role="switch" data-act="itemflex" data-id="${esc(id)}" aria-labelledby="iflexL"${on ? " checked" : ""}${eq.length || on ? "" : " disabled"}><span></span></label></div></div>` +
          (on && eq.length ? `<div class="group eqs" role="group" aria-label="Équivalents acceptés">${eq.map((x) => `<button class="opt alt" type="button" role="checkbox" aria-checked="${acc.has(x.e.id)}" data-act="itemflexe" data-id="${esc(id)}" data-e="${esc(x.e.id)}"><span class="thumb">${img(x.e, 40)}</span><span class="at"><b>${esc(x.e.brand)}</b> ${esc(x.e.name)}<small>${esc(x.e.format)}${x.u != null ? ", " + esc(unitPrice(x.e, x.price)) : ""}, chez ${esc(retName(x.ret))}</small></span><span class="ap">${eur(x.price)}</span><span class="box">${ic("check")}</span></button>`).join("")}</div><p class="gf">Prix relevés seulement, jamais un prix simulé.</p>` : ""),
        foot: `<div class="swfoot"><span aria-live="polite">${total != null ? `Total du panier, livraison comprise\u00a0: <b>${eurC(total)}</b>` : RES.done ? "Pas de total pour tout le panier" : "Calcul du total…"}</span></div>`,
      };
    };
    const o = build();
    openSheet({ title: "Où le prendre", body: o.body, foot: o.foot, build, aux: true, onClose: () => { if (S.route.name === "panier") rerender(); } });
  }
  /* Panier souple, pour tout le panier : les produits qui ont un équivalent proche, à cocher un par un */
  function flexSheet() {
    const build = () => {
      const ids = Object.keys(S.basket).filter((id) => S.basket[id] > 0 && S.prods.has(id));
      const rows = ids.map((id) => ({ id, p: S.prods.get(id), n: equivOf(S.prods.get(id), null, 6).length })).filter((x) => x.n || (S.flex || {})[x.id]);
      const on = rows.filter((x) => (S.flex || {})[x.id]).length, all = on === rows.length;
      return {
        body: `<p>Coche les produits pour lesquels une autre marque te va. Cabas prend alors l'équivalent quand le total du panier baisse, livraison comprise, et le dit sur la ligne. Jamais un prix simulé.</p>` +
          (rows.length ? `<div class="group" role="group" aria-label="Produits du panier">${rows.map((x) => opt("flextg", `<b>${esc(x.p.brand)}</b> ${esc(x.p.name)}`, !!(S.flex || {})[x.id], `data-id="${esc(x.id)}"`, x.n ? plural(x.n, "équivalent", "équivalents") : "aucun")).join("")}</div><p class="gf">Un équivalent\u00a0: même rayon, même type de produit, même nombre d'unités, contenance à 20\u00a0% près. Pour choisir lesquels, touche le prix du produit dans le panier.</p>`
            : `<p>Aucun produit de ton panier n'a d'équivalent proche parmi tes enseignes.</p>`),
        foot: rows.length ? `<button class="btn sm ghost" type="button" data-act="flexall" data-v="${all ? 0 : 1}">${all ? "Tout décocher" : "Tout cocher"}</button>` : "",
      };
    };
    const o = build();
    openSheet({ title: "Panier souple", body: o.body, foot: o.foot, build, onClose: () => { if (S.route.name === "panier") rerender(); } });
  }
  function flexSet(id, on) {
    const F = Object.assign({}, S.flex);
    if (on) { const eq = equivOf(S.prods.get(id), null, 6).map((x) => x.e.id); if (eq.length) F[id] = eq; else delete F[id]; }
    else delete F[id];
    S.flex = F; saveFlex();
  }
  /* Tableau du panier : une ligne par produit, une colonne par enseigne, le prix pour la quantité du panier (règles et
     équivalents compris), celui que la répartition prend coché ; le tableau défile de côté, au doigt et au clavier */
  function cartTable(res, bst) {
    const M = res.M, chans = M.chans, place = new Map(), offBy = new Map(M.lines.map((l, i) => [l.id, M.offers[i]]));
    bst.orders.forEach((o) => o.items.forEach((x) => place.set(x.l.id, { ret: o.ch.id, cost: x.cost, alt: x.alt })));
    (bst.completed || []).forEach((x) => place.set(x.l.id, { ret: x.ret, cost: x.cost, alt: x.alt, mag: true }));
    const ids = M.lines.map((l) => l.id).concat(M.uncovered.filter((id) => S.prods.has(id)));
    const head = chans.map((ch) => { const r = S.allMap.get(ch.id) || {}, w = (r.channel || {}).where; return `<th scope="col">${esc(r.name || ch.id)}${r.group && w ? `<small>${esc((isPickup(r) ? "retrait, " : "livraison, ") + w)}</small>` : ""}${r.simulated ? "<small>prix simulés</small>" : ""}</th>`; }).join("");
    const rows = ids.map((id) => {
      const p = S.prods.get(id), q = S.basket[id] || 1, pl = place.get(id), offs = offBy.get(id) || [], ban = banOf(id), pin = pinOf(id);
      const cells = chans.map((ch, ci) => {
        const of = offs.find((o) => o.c === ci), raw = p.offers[ch.id], g = offKey(S.allMap.get(ch.id));
        if (!of) return raw && raw.price > 0 ? `<td class="na">${ban[g] ? "exclu" : pin && pin !== g ? "épinglé ailleurs" : "–"}</td>` : `<td class="na"><span aria-hidden="true">–</span><span class="sr">pas vendu</span></td>`;
        const on = pl && pl.ret === ch.id, cost = on ? pl.cost : of.cost, eq = (on ? pl.alt : of.alt) ? "<small>équivalent</small>" : "";
        return `<td${on ? ' class="on"' : ""}>${on ? `${ic("check-sm")}<span class="sr">pris ici${pl.mag ? ", en magasin" : ""}\u00a0: </span>` : ""}${eurC(cost)}${eq}${on && pl.mag ? "<small>en magasin</small>" : ""}</td>`;
      }).join("");
      return `<tr><th scope="row">${esc(p.brand)} ${esc(p.name)}<small>${q > 1 ? q + "\u00a0× " : ""}${esc(p.format)}</small></th>${cells}</tr>`;
    }).join("");
    const ord = new Map(bst.orders.map((o) => [o.ch.id, o]));
    const foot = `<tr><th scope="row">Ta commande<small>frais compris</small></th>${chans.map((ch) => { const o = ord.get(ch.id); return `<td>${o ? eurC(o.sub + o.fee) + `<small>${o.fee ? "dont " + eurC(o.fee) + " de frais" : "sans frais"}</small>` : "–"}</td>`; }).join("")}</tr>`;
    return `<p class="gf tblh" id="ctblT">Le prix de chaque produit dans tes enseignes, pour la quantité du panier. Coché\u00a0: là où ta répartition le prend.</p><div class="ctbl" role="region" aria-labelledby="ctblT" tabindex="0"><table><caption class="sr">Prix du panier par enseigne</caption><thead><tr><th scope="col" class="pc">Produit</th>${head}</tr></thead><tbody>${rows}</tbody><tfoot>${foot}</tfoot></table></div>`;
  }
  /* Et si : la même répartition, calculée exactement (worker, bestAt), avec un réglage changé ; « Appliquer » le change
     pour de bon, et le panier affiche alors ce total-là. */
  function wifList() {
    const res = cartResult(), K = res.K, st = res.steps[K], bst = st && (st.full || st.partial);
    if (!bst || !res.done) return null;
    const mode = res.mode, tag = (k) => `w|${mode}|${K}|${k}`, out = [], used = new Map();
    bst.orders.forEach((o) => { const r = S.allMap.get(o.ch.id); if (r) used.set(offKey(r), r); });
    (bst.completed || []).forEach((x) => { const r = S.allMap.get(x.ret); if (r && !used.has(offKey(r))) used.set(offKey(r), r); });
    for (const g of used.keys()) out.push({ key: tag("sans:" + g), w: "sans", g, label: "Sans " + groupName(g), M: () => model(mode, { drop: g }) });
    const withLines = (r, n) => (r ? Object.assign(r, { lines: n }) : r);
    if (K > 1 && bst.orders.length > 1) out.push({ key: "k1", w: "k1", label: "Une seule commande", r: withLines(briefOf(res.steps[1]), res.M.lines.length) });
    const trips = bst.orders.some((o) => isPickup(S.allMap.get(o.ch.id))) || (bst.completed || []).length > 0;
    if (!mode || trips) out.push({ key: "mode", w: "mode", label: mode ? "Tout livré chez toi" : "En te déplaçant", sub: mode ? "Sans achat en magasin ni retrait" : "Achats en magasin et retrait permis", r: res.other[K] ? withLines(briefOf(res.other[K]), res.by[!mode].M.lines.length) : res.otherDone ? { full: null, partial: null, lines: res.by[!mode].M.lines.length } : undefined });
    if (altCount(bst)) out.push({ key: tag("exact"), w: "exact", label: "Sans les équivalents", sub: "Tes produits exacts, sans panier souple", M: () => model(mode, { exact: true }) });
    const rk = rulesKey();
    if (Object.keys(rk[0]).length || Object.keys(rk[1]).length) out.push({ key: tag("free"), w: "free", label: "Sans tes choix d'enseigne", sub: "Sans épingles ni exclusions", M: () => model(mode, { free: true }) });
    auxAsk(out.filter((x) => x.M).map((x) => ({ key: x.key, M: x.M, K })));
    out.forEach((x) => { if (x.M) x.r = auxGet(x.key); });
    return { cur: st.full ? fullTotal(st.full) : null, lines: res.M.lines.length, rows: out };
  }
  const ordersText = (f) => { const ns = f.orders.map((o) => (S.allMap.get(o.id) || {}).name || o.id); return (ns.length === 1 ? "une commande chez " : ns.length + " commandes\u00a0: ") + joinEt(ns) + (f.comp ? ", " + plural(f.comp, "produit", "produits") + " en magasin" : "") + (f.alts ? ", " + plural(f.alts, "équivalent", "équivalents") : ""); };
  function wifBody() {
    const W = wifList();
    if (!W) return `<p class="sn">Les scénarios arrivent avec la répartition.</p>`;
    const row = (x) => {
      const r = x.r, f = r && r.full;
      let val = "…", sub = x.sub ? x.sub + ". " : "", ok = false;
      /* un scénario qui ne compte pas les mêmes produits ne se compare pas : un produit que seule l'enseigne retirée vend */
      const less = r && r.lines != null ? W.lines - r.lines : 0;
      if (r === undefined) sub += "Calcul…";
      else if (r === null) sub += "Calcul impossible pour l'instant.";
      else if (less > 0) { val = "–"; sub += `Il manquerait ${plural(less, "produit", "produits")}, que ${x.w === "sans" ? "seul " + esc(groupName(x.g)) + " vend" : "tes autres enseignes ne vendent pas"}.`; }
      else if (f && less < 0) { val = eurC(f.total); ok = true; sub += `Avec ${plural(-less, "produit", "produits")} de plus, que tes choix écartaient\u00a0: ` + ordersText(f) + "."; }
      else if (f) {
        const d = W.cur == null ? null : f.total - W.cur;
        val = eurC(f.total); ok = true;
        sub += (d == null ? "" : Math.abs(d) < 1 ? "Même total, " : d > 0 ? `${eurC(d)} de plus, ` : `${eurC(-d)} de moins, `) + ordersText(f) + ".";
      } else { val = "–"; sub += r.partial && r.partial.skipped ? `Il manquerait ${plural(r.partial.skipped, "produit", "produits")}.` : "Aucune commande possible pour tout le panier."; }
      return `<div class="row wifr"><span class="rt">${esc(x.label)}<small>${sub}</small></span><span class="val num">${val}</span><button class="btn sm tint" type="button" data-act="wifgo" data-w="${x.w}"${x.g ? ` data-g="${esc(x.g)}"` : ""}${ok ? "" : " disabled"} aria-label="Appliquer, ${esc(x.label.toLowerCase())}">Appliquer</button></div>`;
    };
    return (W.cur != null ? `<div class="row wifr cur"><span class="rt">Ta répartition<small>Chaque total compte tout le panier, livraison comprise, en ${RES.K === 1 ? "une commande" : RES.K + " commandes au plus"}.</small></span><span class="val num">${eurC(W.cur)}</span></div>` : "") + W.rows.map(row).join("");
  }
  /* Compléter malin : sous le minimum d'une enseigne ou près d'un palier de livraison, les produits de tes habitudes,
     de tes listes et de tes produits à racheter qu'elle vend (sinon des produits courants), du moins cher au plus cher ;
     pour chacun, le total exact du panier s'il y était, comme le panier le calculera après l'ajout. */
  function topupCands(rid) {
    const out = new Map(), diet = dietOn();
    const add = (id0) => {
      const p = S.prods.get(id0) || S.prods.get((S.alias || {})[id0]), o = p && p.offers[rid];
      if (!p || out.has(p.id) || S.basket[p.id] || !o || !(o.price > 0) || (diet && !dietOk(p))) return;
      out.set(p.id, { p, price: o.price, sim: !!o.sim, mine: true });
    };
    (S.todo || []).forEach((t) => add(t.id));
    dueSoon(20).forEach((d) => add(d.p.id));
    habits(40).forEach((p) => add(p.id));
    S.lists.forEach((L) => Object.keys(L.items || {}).forEach(add));
    const mine = out.size;
    if (mine < 6) { Object.keys(suggestion().items).forEach(add); [...out.values()].slice(mine).forEach((c) => { c.mine = false; }); }
    return [...out.values()].sort((a, b) => a.price - b.price).slice(0, 12);
  }
  const topKey = (mode, K, id) => `t|${mode}|${K}|${id}`;
  function topupSheet(rid) {
    const build = () => {
      const res = cartResult(), K = res.K, st = res.steps[K], full = st && st.full, cur = res.done && full ? fullTotal(full) : null;
      const r = S.allMap.get(rid) || { name: rid }, ci = res.M.chans.findIndex((c) => c.id === rid), ch = res.M.chans[ci];
      const o = full && full.orders.find((x) => x.ch.id === rid);
      let head = "", gap = 0;
      if (o) { const nt = nextTier(o.ch, o.sub); head = nt ? `Ta commande ${r.name} fait ${eurC(o.sub)}\u00a0: encore ${eurC(nt.need)} et la ${pickup(r) ? "commande" : "livraison"} ${nt.fee > 0 ? "passe à " + eurC(nt.fee) : "devient offerte"}.` : `Ta commande ${r.name} a ses frais les plus bas.`; }
      else if (ch) { const sb = singleBasket(res.M, ci); gap = Math.max(0, ch.P.min - sb.sub); head = sb.sub < ch.P.min ? `Chez ${r.name}, ${sb.missing ? "les produits qu'elle vend font" : "ton panier fait"} ${eurC(sb.sub)}\u00a0: il manque ${eurC(ch.P.min - sb.sub)} pour son minimum de commande.` : `Ton panier atteint le minimum de commande de ${r.name}.`; }
      const cands = topupCands(rid);
      auxAsk(cands.map((c) => ({ key: topKey(res.mode, K, c.p.id), M: () => model(res.mode, { add: { [c.p.id]: 1 } }), K })));
      const rows = cands.map((c) => {
        const x = auxGet(topKey(res.mode, K, c.p.id)), f = x && x.full, pc = Math.round(c.price * 100);
        let eff = "Calcul du nouveau total…", good = false;
        if (x === null) eff = "";
        else if (x && res.done) {
          if (f && cur != null) { const d = f.total - cur; good = d < pc - 4; eff = d < 0 ? `Ton total baisse de ${eurC(-d)}, avec ce produit en plus` : good ? `Il te revient à ${eurC(d)} au lieu de ${eurC(pc)}, frais compris` : `Ton total passe à ${eurC(f.total)}`; }
          else if (f) { good = true; eff = `Tout le panier se commande\u00a0: ${eurC(f.total)}, livraison comprise`; }
          else eff = gap > pc ? `Il manquera encore ${eurC(gap - pc)} chez ${r.name}` : "Pas encore assez pour une livraison";
        }
        return `<div class="tup${good ? " good" : ""}"><span class="thumb">${img(c.p, 48)}</span><span class="tt"><b><strong>${esc(c.p.brand)}</strong> ${esc(c.p.name)}</b><small>${esc(c.p.format)}, ${eur(c.price)} chez ${esc(r.name)}${c.sim ? ", prix simulé" : ""}${c.mine ? "" : ", produit courant"}</small>${eff ? `<small class="eff">${esc(eff)}</small>` : ""}</span><button class="btn sm tint" type="button" data-act="topadd" data-id="${esc(c.p.id)}" aria-label="Ajouter ${esc(pname(c.p))}">${ic("plus")}Ajouter</button></div>`;
      }).join("");
      return {
        body: `<p aria-live="polite">${esc(head)}</p>` + (cands.length ? `<p class="gf">${cands.some((c) => c.mine) ? "Tes habitudes, tes listes et tes produits à racheter" : "Des produits courants"} vendus chez ${esc(r.name)}, du moins cher au plus cher. Chaque total est recalculé comme si tu ajoutais le produit\u00a0: répartition, minimums et frais compris.</p><div class="group tups">${rows}</div>` : `<p>Rien de tes habitudes ni de tes listes chez ${esc(r.name)} pour l'instant.</p>`),
        foot: `<div class="swfoot"><span aria-live="polite">${cur != null ? `Total du panier, livraison comprise\u00a0: <b>${eurC(cur)}</b>` : res.done ? "Pas encore de livraison possible pour tout le panier" : "Calcul du total…"}</span></div>`,
      };
    };
    const o = build();
    openSheet({ title: "Compléter malin", body: o.body, foot: o.foot, build, aux: true, onClose: () => { if (S.route.name === "panier") rerender(); } });
  }
  /* le gain exact d'un ajout, calculé ici (tests) : total avant, total après, et ce que le produit coûte vraiment */
  function topupGain(id, q, rid) {
    const res = cartResult(), K = res.K, st = res.steps[K], before = st && st.full ? fullTotal(st.full) : null;
    const n = Math.max(1, q | 0 || 1), r = bestAt(model(res.mode, { add: { [id]: (S.basket[id] || 0) + n } }), K, res.lambda, 5000), after = r.full ? r.full.total : null;
    const p = S.prods.get(id), o = p && (rid ? p.offers[rid] : best(p)), price = o ? Math.round(o.price * 100) * n : null;
    const delta = before != null && after != null ? after - before : null;
    return { before, after, delta, price, gain: delta != null && price != null ? price - delta : null, orders: r.full ? r.full.orders : [] };
  }

  /* ---------- remplir mes paniers ---------- */
  /* Le panier réparti, Cabas aide à remplir le panier de chaque enseigne, produit par produit : un gros bouton ouvre la
     fiche du produit sur le site de l'enseigne (sinon sa recherche, sinon le site), la personne l'ajoute elle-même et
     revient ; au retour dans l'appli, 1,5 s passées dehors au moins, le produit est coché, avec « Annuler ». Rien n'est
     automatisé chez les enseignes : Cabas ouvre seulement des liens. La répartition est figée au moment où l'on commence
     (S.guide.snap) : les prix peuvent changer ensuite, la liste à remplir reste celle-là. */
  function saveGuide() { store.set("guide", S.guide); }
  const saveTodo = () => store.set("todo", S.todo);
  const basketKey = () => JSON.stringify(Object.keys(S.basket).filter((id) => S.basket[id] > 0).sort().map((id) => [id, S.basket[id]]));
  const pname = (p) => (p ? p.brand + " " + p.name : "");
  /* instantané de la répartition affichée : commandes (avec leurs règles de frais), achats en magasin, produits hors commande */
  function fillSnap() {
    const res = cartResult(), st = res.steps[res.K], bst = st && (st.full || st.partial);
    if (!bst || !bst.orders.length) return null;
    const it = (l, cost) => { const p = S.prods.get(l.id); return { id: l.id, q: l.q, cost, nm: pname(p), f: (p && p.format) || "" }; };
    return {
      id: Date.now().toString(36), at: new Date().toISOString(), key: basketKey(), full: !!st.full,
      /* l'équivalent pris par Cabas (panier souple) est le produit à mettre dans le panier de l'enseigne */
      orders: bst.orders.map((o) => ({ rid: o.ch.id, P: o.ch.P, items: o.items.map((x) => it(x.alt ? { id: x.alt, q: x.l.q } : x.l, x.cost)) })),
      comp: (bst.completed || []).map((x) => Object.assign(it(x.alt ? { id: x.alt, q: x.l.q } : x.l, x.cost), { ret: x.ret })),
      skipped: (bst.skipped || []).map((x) => it(x.l, 0)),
    };
  }
  const snapOf = () => (S.guide && S.guide.snap) || null;
  const ckOf = (rid, id) => !!S.guide.ck[rid + "|" + id];
  /* une commande de l'instantané : produits à mettre sur le site (ni laissés de côté, ni pour le magasin), cochés,
     sous-total et frais ; pv (aperçu avant de commencer) ne lit aucune coche */
  function ordState(o, pv) {
    const L = o.items.filter((x) => !x.st), k = pv ? 0 : L.filter((x) => ckOf(o.rid, x.id)).length;
    const sub = L.reduce((a, x) => a + x.cost, 0), fee = sub > 0 ? feeAt(o.P, sub) : 0;
    return { L, n: L.length, k, sub, fee, tot: sub + fee, done: !pv && !!S.guide.done[o.rid], drop: !pv && !!(S.guide.drop || {})[o.rid] };
  }
  const closed = (o) => !!(S.guide.done[o.rid] || (S.guide.drop || {})[o.rid]);
  const finished = (s) => !!s && s.orders.every(closed);
  const stale = (s) => !!s && s.key !== basketKey();
  /* remplissage en cours : un instantané pas fini, de moins de 14 jours */
  const fillActive = () => { const s = snapOf(); return !!s && !finished(s) && Date.now() - Date.parse(s.at) < 14 * 864e5; };
  /* l'instantané sert encore : remplissage en cours, ou fini pour le panier tel qu'il est */
  const fillUsable = () => { const s = snapOf(); return !!s && (finished(s) ? !stale(s) : fillActive()); };
  const fillNext = () => { const s = snapOf(); return s ? s.orders.find((o) => !closed(o)) || null : null; };
  const fillOrd = (rid) => { const s = snapOf(); return s ? s.orders.find((o) => o.rid === rid) || null : null; };
  /* achats en magasin de l'instantané : ceux de la répartition et ceux que « Pas trouvé » y a envoyés */
  const magOf = (s) => s.comp.concat(...s.orders.map((o) => o.items.filter((x) => x.st === "mag" && x.mag).map((x) => Object.assign({}, x, { ret: x.mag.ret, cost: x.mag.cost }))));
  const snapTotal = (s, pv) => s.orders.reduce((a, o) => a + ordState(o, pv).tot, 0) + magOf(s).reduce((a, x) => a + x.cost, 0);
  /* un nouveau remplissage repart de zéro ; les liens à revoir, les rappels repoussés et les créneaux des autres enseignes restent */
  const freshGuide = (snap) => { const g = S.guide || {}, when = Object.assign({}, g.when); snap.orders.forEach((o) => { delete when[o.rid]; }); return { ck: {}, done: {}, drop: {}, cur: {}, opened: {}, when, broken: g.broken || {}, snooze: g.snooze || {}, snap }; };
  function ensureSnap() {
    const s = snapOf();
    if (s && !finished(s) && fillActive()) return s;
    const ns = fillSnap();
    if (!ns) return null;
    S.guide = freshGuide(ns); saveGuide();
    return ns;
  }
  /* le lien d'un produit chez l'enseigne : sa fiche (data/details), sinon la recherche du site (l'EAN chez Carrefour), sinon le site */
  function fillLink(rid, x) {
    const r = S.allMap.get(rid) || {}, p = S.prods.get(x.id), det = p && detailsNow(p), d = det && det[rid], home = r.home || "#";
    if (d && d.url && d.url !== home && !(S.guide.broken || {})[rid + "|" + x.id]) return { url: d.url, kind: "fiche" };
    return fillSearch(r, p, x);
  }
  function fillSearch(r, p, x) {
    if (r.search) {
      const q = r.searchEan && p && p.ean ? p.ean : (p ? pname(p) : x.nm).replace(/\s+/g, " ").trim().slice(0, 90);
      return { url: r.search.replace("{q}", encodeURIComponent(q)), kind: "recherche" };
    }
    return { url: r.home || "#", kind: "site" };
  }
  const openLabel = (r, L) => (L.kind === "fiche" ? "Ouvrir sur " : L.kind === "recherche" ? "Chercher sur " : "Ouvrir ") + r.service;
  /* nom du produit tel que l'enseigne l'affiche, sinon le nom Cabas gardé dans l'instantané */
  const siteName = (rid, x) => { const p = S.prods.get(x.id), det = p && detailsNow(p), d = det && det[rid]; return (d && d.name) || ""; };
  const curIdx = (o, st) => { let i = (S.guide.cur || {})[o.rid]; if (!(i >= 0 && i < st.n)) { i = st.L.findIndex((x) => !ckOf(o.rid, x.id)); if (i < 0) i = 0; } return i; };
  function fillAdvance(o) {
    const st = ordState(o), i0 = curIdx(o, st);
    for (let k = 1; k <= st.n; k++) { const j = (i0 + k) % st.n; if (!ckOf(o.rid, st.L[j].id)) { S.guide.cur = Object.assign({}, S.guide.cur, { [o.rid]: j }); return; } }
  }
  /* ce que devient une commande quand son sous-total change : son total, ses frais, son minimum d'achat */
  const feeWord = (r, fee) => (fee > 0 ? eurC(fee) : pickup(r) ? "gratuit" : "offerte");
  function feeEffect(o, sub2) {
    const r = S.allMap.get(o.rid) || { name: o.rid }, st = ordState(o), fee2 = sub2 > 0 ? feeAt(o.P, sub2) : 0;
    if (sub2 <= 0) return `Ta commande ${r.name} n'aurait plus aucun produit.`;
    let t = `Ta commande ${r.name} passe à ${eurC(sub2 + fee2)}`;
    if (fee2 !== st.fee) t += `, ${pickup(r) ? "retrait" : "livraison"} ${feeWord(r, fee2 - o.P.fixed)} au lieu de ${feeWord(r, st.fee - o.P.fixed)}`;
    if (o.P.min && sub2 < o.P.min) t += `\u00a0; sous le minimum de ${eurC(o.P.min).replace(",00", "")}, il manquera ${eurC(o.P.min - sub2)}`;
    return t + ".";
  }
  /* Équivalents d'un produit : même rayon, mêmes caractéristiques, même nombre d'unités. Vendus par l'enseigne rid
     (« Pas trouvé », contenance à 25 % près, prix simulé admis chez une enseigne simulée) ; sans rid, dans tes enseignes,
     au meilleur prix relevé (panier souple, contenance à 20 % près, jamais un prix simulé). n : combien, 4 par défaut. */
  function equivOf(p, rid, n) {
    if (!p) return [];
    const any = !rid;
    if (any && !(p.qty && p.qty.v)) return [];
    const s = sig(p), k = packsOf(p), diet = dietOn(), simOk = !any && !!(S.allMap.get(rid) || {}).simulated, tol = any ? 0.2 : 0.25, out = [];
    for (const e of inRayon(p.r)) {
      if (e === p || e.r !== p.r || sig(e) !== s || packsOf(e) !== k || (diet && !dietOk(e))) continue;
      if (p.qty && p.qty.v && (!e.qty || e.qty.u !== p.qty.u || Math.abs(e.qty.v - p.qty.v) / p.qty.v > tol)) continue;
      const o = any ? bestReal(e) : e.offers[rid];
      if (!o || !(o.price > 0) || (o.sim && !simOk)) continue;
      out.push({ e, price: o.price, u: perUnit(e, o.price), ret: o.ret || rid });
    }
    return out.sort((a, b) => (a.u != null && b.u != null ? a.u - b.u : a.price - b.price)).slice(0, n || 4);
  }
  /* en magasin : l'enseigne qui a des magasins et le prix relevé le plus bas, jamais un prix simulé */
  function magFor(p, q) {
    let b = null;
    for (const r of S.rets) { const o = p && p.offers[r.id]; if (!r.magasin || r.simulated || !retOn(r.id) || !o || !(o.price > 0) || o.sim) continue; const cost = Math.round(o.price * 100) * q; if (!b || cost < b.cost) b = { ret: r.id, cost }; }
    return b;
  }
  /* délai usuel d'une enseigne (data/retailers.json, ou celui que la personne a choisi dans les réglages) */
  const leadDays = (rid) => { const v = (S.prefs.lead || {})[rid]; if (v >= 0 && v <= 7) return v; const r = S.allMap.get(rid) || {}; return r.lead && r.lead.days >= 0 ? r.lead.days : 1; };
  /* « Commande avant mercredi soir chez Houra pour être livré jeudi », ou le délai usuel quand aucune date n'est visée */
  function leadText(rid, by) {
    const r = S.allMap.get(rid) || { name: rid }, days = leadDays(rid);
    if (!by) return (r.lead && r.lead.text) || (days ? `Livré en ${plural(days, "jour", "jours")} en général` : "Livré le jour même en général");
    const cut = isoDay(new Date(Date.parse(by + "T12:00:00") - days * 864e5)), today = isoDay(new Date()), what = pickup(r) ? "prêt" : "livré";
    if (cut < today) return `Pour être ${what} ${dayLabel(by)}, il est sans doute trop tard chez ${r.name}\u00a0: compte ${plural(days, "jour", "jours")} de délai.`;
    if (!days) return `Commande ${dayLabel(by)}, assez tôt, chez ${r.name} pour être ${what} le jour même.`;
    const lab = dayLabel(cut);
    return `Commande avant ${cut === today ? "ce soir" : lab === "demain" ? "demain soir" : lab + " au soir"} chez ${r.name} pour être ${what} ${dayLabel(by)}.`;
  }
  /* la liste d'une commande, ou de toutes, au format lisible (nom affiché par l'enseigne quand il est connu) */
  function fillText(rid) {
    const s = (fillActive() && snapOf()) || fillSnap();
    if (!s) return "";
    const L = [], pv = !fillActive();
    if (!rid) L.push(`Mes courses du ${new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}, avec Cabas`, "");
    const line = (x, nm) => `- ${x.q > 1 ? x.q + " x " : ""}${nm}${x.f && !norm(nm).includes(norm(x.f)) ? ", " + x.f : ""}`;
    for (const o of s.orders.filter((y) => !rid || y.rid === rid)) {
      const r = S.allMap.get(o.rid) || { name: o.rid, service: o.rid }, st = ordState(o, pv), ch = r.channel || {};
      L.push(`${r.name} (${r.service}${ch.where ? ", " + (pickup(r) ? "retrait à " : "livraison ") + ch.where : ""})\u00a0: ${plural(st.n, "produit", "produits")}, ${eurC(st.tot)}${r.simulated ? ", prix simulés" : ""}`);
      st.L.forEach((x) => L.push(line(x, siteName(o.rid, x) || x.nm)));
      L.push("");
    }
    if (!rid) {
      const m = magOf(s);
      if (m.length) { L.push("En magasin, aux prix relevés en ligne\u00a0:"); m.forEach((x) => L.push(line(x, x.nm) + ", chez " + retName(x.ret))); L.push(""); }
      const fr = freeList();
      if (fr.length) { L.push("À chercher\u00a0:"); fr.forEach((f) => L.push(`- ${f.q > 1 ? f.q + " x " : ""}${f.t}${f.price > 0 ? ", " + eur(f.price) + " prix saisi par toi" : ""}`)); L.push(""); }
      L.push(`Total\u00a0: ${eurC(snapTotal(s, pv))}, frais compris, aux prix relevés`);
    }
    return L.join("\n").trim();
  }
  function copyText(tx, ok) {
    (navigator.clipboard && tx ? navigator.clipboard.writeText(tx) : Promise.reject()).then(() => toast(ok || "Liste copiée", null, "check"), () => toast("Copie impossible sur cet appareil"));
  }
  /* commandes notées comme passées : le panier rejoint l'historique quand chaque commande est passée ou abandonnée */
  const whenOf = (rids) => rids.map((rid) => { const r = S.allMap.get(rid), w = (S.guide.when || {})[rid]; return r && w && w.d ? { rid, name: r.name, pick: pickup(r), d: w.d, s: w.s || "", where: (r.channel || {}).where || "" } : null; }).filter(Boolean);
  function recordFill() {
    const s = snapOf();
    if (!s || !finished(s) || S.guide.rec === s.id) return;
    S.guide.rec = s.id;
    const os = s.orders.filter((o) => S.guide.done[o.rid]);
    if (!os.length) { saveGuide(); return; }
    const items = {}, lines = [], add = (y, sim) => { items[y.id] = Math.min(99, (items[y.id] || 0) + y.q); if (!sim) lines.push(y); };
    const o = os.map((x) => { const st = ordState(x), r = S.allMap.get(x.rid) || {}, its = {}; st.L.forEach((y) => { its[y.id] = y.q; add(y, r.simulated); }); return { rid: x.rid, name: r.name || x.rid, pick: pickup(r), t: st.tot, items: its }; });
    const mag = magOf(s);
    mag.forEach((y) => add(y, false));
    const t = o.reduce((a, x) => a + x.t, 0) + mag.reduce((a, y) => a + y.cost, 0);
    /* économie : chaque produit payé au prix de la répartition plutôt qu'à son prix moyen relevé, plus les remplacements */
    let saved = 0;
    for (const y of lines) { const p = S.prods.get(y.id), vs = p ? offers(p, true).filter((v) => !v.sim) : []; if (vs.length >= 2) saved += Math.round((vs.reduce((a, v) => a + v.price, 0) / vs.length) * 100) * y.q - y.cost; }
    const sp = S.swapPrev;
    if (sp && sp.key === JSON.stringify(S.basket)) saved += Math.max(0, sp.total - snapTotal(s));
    saved = Math.max(0, Math.round(saved));
    S.hist.push({ d: isoDay(new Date()), t, s: saved, n: Object.values(items).reduce((a, q) => a + q, 0), o, items, when: whenOf(o.map((x) => x.rid)), sid: s.id });
    store.set("hist", S.hist); S.guide.saved = saved; saveGuide();
  }
  /* « Commande pas encore passée » après coup : le panier sort de l'historique */
  function unrecord() {
    const s = snapOf();
    if (!s || S.guide.rec !== s.id) return;
    S.hist = S.hist.filter((h) => h.sid !== s.id); store.set("hist", S.hist);
    S.guide.rec = ""; S.guide.saved = 0;
  }
  /* au retour dans l'appli, au moins 1,5 s après avoir ouvert un produit : il est coché (sauf « Cocher à la main ») */
  let awayAt = 0;
  function fillBack(away) {
    const op = S.guide.open;
    if (!op) return;
    S.guide.open = null; saveGuide();
    const o = fillOrd(op.rid), here = S.route.name === "remplir" && $("#sheet").hidden;
    if (away < 1500 || S.prefs.manualCk || !o || ckOf(op.rid, op.id) || !o.items.some((x) => x.id === op.id && !x.st)) { if (here && S.route.id === op.rid) rerender(); return; }
    const cur0 = (S.guide.cur || {})[op.rid], x = o.items.find((y) => y.id === op.id);
    S.guide.ck[op.rid + "|" + op.id] = 1;
    fillAdvance(o);
    saveGuide(); renderChrome();
    if (here) { if (ordState(o).k === ordState(o).n) window.scrollTo(0, 0); rerender(); }
    undoable(`${x.nm || "Produit"} coché`, () => { delete S.guide.ck[op.rid + "|" + op.id]; S.guide.cur = Object.assign({}, S.guide.cur, { [op.rid]: cur0 }); saveGuide(); }, 6000);
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { awayAt = Date.now(); return; }
    const a = awayAt ? Date.now() - awayAt : 0;
    awayAt = 0;
    if (S.ready) fillBack(a);
  });
  /* « Tout ouvrir » : sur ordinateur seulement, un onglet par produit (un téléphone n'ouvre qu'une page par geste) */
  const desktop = () => !isIOS && !!window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  /* univers dont les détails n'ont pas pu être chargés (hors ligne) : le guide passe à la recherche du site */
  const DETF = new Set();
  window.addEventListener("online", () => DETF.clear());

  const fillBase = { title: "Remplir mes paniers", grouped: true };
  const fillWait = (title) => ({ title, grouped: true, html: `<h1 class="lt">${esc(title)}</h1><div class="sum loading" aria-busy="true"><p class="sl" role="status">Calcul de la meilleure répartition…</p><div class="skl"></div><div class="skl s"></div></div>` });
  function fillOrdCard(o, s) {
    const r = S.allMap.get(o.rid) || { name: o.rid, service: o.rid }, st = ordState(o, s.preview), ch = r.channel || {};
    const W = (S.guide.when || {})[o.rid];
    if (st.done) st.k = st.n;
    const full = st.n && st.k === st.n;
    const status = st.done ? `${ic("check")}Commande passée${W && W.d ? ", " + (pickup(r) ? "retrait " : "livraison ") + esc(whenText(W)) : ""}` : st.drop ? "Pas passée" : full ? `${ic("check")}Panier rempli, reste à payer sur ${esc(r.service)}` : `${st.k} sur ${plural(st.n, "produit ajouté", "produits ajoutés")}`;
    const label = st.done || st.drop ? "Voir le récapitulatif" : s.preview || !st.k ? "Commencer" : full ? "Terminer" : "Reprendre";
    const moved = o.items.filter((x) => x.st === "skip").length;
    return `<section class="order fillc" aria-labelledby="fc-${esc(o.rid)}"><div class="oh"><span class="mono" aria-hidden="true">${esc(r.name.slice(0, 1))}</span><div class="rt"><h2 class="t3" id="fc-${esc(o.rid)}">${esc(r.name)}</h2><small>${esc(r.service)}${ch.where ? ", " + esc((pickup(r) ? "retrait à " : "livraison ") + ch.where) : ""}</small></div>${px(st.tot / 100)}</div>` +
      `<div class="of"><div class="ln"><span>${plural(st.n, "produit", "produits")}</span><span>${pickup(r) ? "Retrait" : "Livraison"} ${feeWord(r, st.fee - o.P.fixed)}${o.P.fixed ? ", service " + eurC(o.P.fixed) : ""}</span></div>` +
      `<div class="prog thin" role="progressbar" aria-label="Produits ajoutés chez ${esc(r.name)}" aria-valuemin="0" aria-valuemax="${st.n}" aria-valuenow="${st.k}"><span style="width:${st.n ? Math.round((100 * st.k) / st.n) : 0}%"></span></div>` +
      `<p class="progl${st.done || full ? " done" : ""}">${status}</p>` +
      (st.done || st.drop ? "" : `<p class="hint muted">${esc(leadText(o.rid))}.</p>`) +
      (moved ? `<p class="hint muted">${plural(moved, "produit laissé", "produits laissés")} de côté, pour ton prochain panier.</p>` : "") +
      (r.simulated ? `<p class="hint muted">Prix simulés, pas relevés\u00a0: le vrai total s'affiche sur ${esc(r.service)}.</p>` : "") +
      `<button class="btn tint" type="button" data-act="fill" data-id="${esc(o.rid)}">${label}</button></div></section>`;
  }
  /* #/remplir : une carte par commande, la progression, « Commencer » ; avant le premier geste, un aperçu de la répartition en cours */
  function fillHome() {
    const s0 = snapOf(), keep = fillUsable();
    const ids = Object.keys(S.basket).filter((id) => S.basket[id] > 0 && S.prods.has(id));
    if (!keep && !ids.length) return Object.assign({}, fillBase, { html: `<h1 class="lt">Remplir mes paniers</h1><div class="empty">${emptyArt("bag")}<h2>Ton panier est vide</h2><p>Écris ta liste ou recommande un panier déjà commandé\u00a0: Cabas le répartit, puis t'aide à remplir le panier de chaque enseigne.</p><a class="btn" href="#/ecrire">${ic("pen")}Écrire ma liste</a>${S.hist.some((h) => h.items) ? `<a class="btn tint" href="#/recommander">Recommander un panier</a>` : ""}</div>` });
    let s = keep ? s0 : null;
    if (!s) {
      const res = cartResult();
      if (!res.steps[res.K] && !res.done) return fillWait("Remplir mes paniers");
      s = fillSnap();
      if (!s) return Object.assign({}, fillBase, { html: `<h1 class="lt">Remplir mes paniers</h1><div class="empty">${emptyArt("bag")}<h2>Pas encore de commande</h2><p>Ton panier ne suffit pas pour une commande en ligne\u00a0: chaque enseigne demande un minimum d'achat.</p><a class="btn" href="#/panier" data-tab="panier">Voir le panier</a></div>` });
      s.preview = true;
    }
    const fin = !s.preview && finished(s), nxt = s.preview ? s.orders[0] : fillNext(), pv = !!s.preview;
    const nr = nxt && (S.allMap.get(nxt.rid) || { name: nxt.rid });
    const nst = nxt && ordState(nxt, pv);
    const sub = pv ? `${s.orders.length === 1 ? "Une commande" : plural(s.orders.length, "commande", "commandes")}, ${eurC(snapTotal(s, true))} frais compris. Pour chaque produit, Cabas ouvre le site de l'enseigne\u00a0: tu l'ajoutes à ton panier là-bas, puis tu reviens ici.`
      : `Répartition faite ${whenFr(s.at)}, gardée telle quelle même si les prix changent. ${eurC(snapTotal(s))} frais compris.`;
    const stl = !pv && !fin && stale(s) ? `<div class="banner warn" role="status">${ic("info")}<span><b>Ton panier a changé depuis</b>Cette liste reste celle du début du remplissage. Reprends avec le panier actuel pour la mettre à jour\u00a0: les produits cochés le restent.</span><button class="btn sm tint" type="button" data-act="fillresnap">Reprendre avec le panier actuel</button></div>` : "";
    const done = fin ? `<div class="banner good" role="status">${ic("check")}<span><b>Toutes tes commandes sont passées</b>${S.guide.saved ? `Tu as économisé ${eurC(S.guide.saved)} sur ce panier, meilleurs prix et remplacements compris.` : "Ton panier rejoint tes économies."}</span></div>` : "";
    const mag = magOf(s), skip = s.skipped.concat(...s.orders.map((o) => o.items.filter((x) => x.st === "skip")));
    const magBox = mag.length ? `<section class="order" aria-labelledby="fc-mag"><div class="oh"><span class="mono" aria-hidden="true">${ic("store")}</span><div class="rt"><h2 class="t3" id="fc-mag">À acheter en magasin</h2><small>${plural(mag.reduce((a, x) => a + x.q, 0), "article", "articles")}, chez ${esc(joinEt([...new Set(mag.map((x) => retName(x.ret).split(" ")[0]))]))}</small></div>${px(mag.reduce((a, x) => a + x.cost, 0) / 100)}</div><div class="of"><p class="hint muted">Aux prix relevés en ligne\u00a0; en magasin, ils peuvent être un peu différents.</p><button class="btn tint" type="button" data-act="shop">${ic("list")}Liste pour le magasin</button></div></section>` : "";
    const skipBox = skip.length ? `<h2 class="gh">Pas dans ces commandes</h2><div class="group">${skip.map((x) => `<div class="row"><span class="rt">${esc(x.nm)}<small>${x.q > 1 ? x.q + " × " : ""}${esc(x.f)}${x.st === "skip" ? ", laissé de côté pour ton prochain panier" : ", aucune commande ne le prend"}</small></span></div>`).join("")}</div>` : "";
    const fr = freeList();
    const freeBox = fr.length ? `<h2 class="gh">Tes lignes libres, à chercher toi-même</h2><div class="group">${fr.map((f) => `<div class="row"><span class="mono sm" aria-hidden="true">${ic("pen")}</span><span class="rt">${esc(f.t)}<small>${esc(freeWhere(f))}${f.price > 0 ? ", " + esc(eur(f.price)) + " l'unité, prix saisi par toi" : ""}</small></span><span class="val num">× ${f.q}</span></div>`).join("")}</div>` : "";
    const dock = nxt && !fin ? `<button class="btn" type="button" data-act="fill" data-id="${esc(nxt.rid)}">${pv || !nst.k ? "Commencer chez " : nst.k === nst.n ? "Terminer chez " : "Reprendre chez "}${esc(nr.name)}</button>` : "";
    return Object.assign({}, fillBase, {
      dockHtml: dock, dockAll: true,
      mount: () => { if (!pv) detailsAll(s.orders.flatMap((o) => o.items.map((x) => S.prods.get(x.id)).filter(Boolean)), () => {}); },
      html: `<h1 class="lt">Remplir mes paniers</h1><p class="lt-sub">${sub}</p>` + stl + done +
        s.orders.map((o) => fillOrdCard(o, s)).join("") + magBox + skipBox + freeBox +
        `<div class="group" style="margin-top:28px"><button class="row link" type="button" data-act="fillcopy">Copier toutes les listes</button><button class="row link" type="button" data-act="fillshare">Partager les listes</button>${fin ? `<button class="row link" type="button" data-act="savelist">Garder en liste</button><button class="row danger" type="button" data-act="clear">Vider le panier</button>` : !pv ? `<button class="row danger" type="button" data-act="fillstop">Arrêter le remplissage</button>` : ""}</div>` +
        `<p class="gf">Cabas ouvre seulement des liens\u00a0: c'est toi qui ajoutes chaque produit et qui paies sur le site de l'enseigne. Tes listes restent sur ton téléphone.</p>`,
    });
  }
  /* « Avant de commencer » : la première fois chez une enseigne, ce qu'il faut faire sur son site (data/retailers.json) */
  function fillBefore(r) {
    const fs = r.firstSteps || { steps: [] }, where = (r.channel || {}).where || "";
    const steps = fs.steps.map((t) => `<li><span>${tx(t.replace("{where}", where))}</span></li>`).join("") +
      `<li><span>Reviens dans Cabas\u00a0: pour chaque produit, touche «\u00a0${esc(openLabel(r, { kind: "fiche" }))}\u00a0», ajoute-le au panier du site, puis reviens ici. ${S.prefs.manualCk ? "Coche-le." : "Cabas le coche."}</span></li>`;
    return {
      title: r.name, grouped: true, solo: true,
      dockHtml: `<button class="btn" type="button" data-act="fillready" data-id="${esc(r.id)}">C'est prêt, on commence</button>`,
      html: `<h1 class="lt">Avant de commencer</h1><p class="lt-sub">Sur ${esc(r.service)}, la première fois</p><ol class="steps">${steps}</ol>` +
        (fs.source ? `<p class="gf">${fs.verifiedAt ? "Source\u00a0: " : "À confirmer sur le site. "}${tx(fs.source)}.</p>` : "") +
        `<div class="pad btns" style="padding-top:18px"><a class="btn tint" href="${esc(r.home)}" target="_blank" rel="noopener">Ouvrir ${esc(r.service)}${ic("ext")}</a></div>` +
        `<p class="gf">Rien n'est commandé à ta place\u00a0: c'est toi qui ajoutes chaque produit et qui paies sur ${esc(r.service)}.</p>`,
    };
  }
  /* le produit en cours, plein écran : quantité et nom chez l'enseigne bien visibles, « Ouvrir sur … » en bas, sous le pouce */
  function fillProduct(r, o, st) {
    const rid = o.rid, i = curIdx(o, st), x = st.L[i], p = S.prods.get(x.id), on = ckOf(rid, x.id), L = fillLink(rid, x), dn = siteName(rid, x);
    const qtxt = x.q > 1 ? x.q + " exemplaires" : "le produit";
    const hint = L.kind === "site" ? `Cherche-le sur ${esc(r.service)}, ajoute ${qtxt} au panier, puis reviens ici.` : S.prefs.manualCk ? `Ajoute ${qtxt} au panier du site, puis touche «\u00a0C'est dans mon panier\u00a0».` : `Ajoute ${qtxt} au panier du site, puis reviens ici\u00a0: Cabas le coche.`;
    const list = st.L.map((y, j) => { const c = ckOf(rid, y.id); return `<div class="gi${c ? " on" : ""}${j === i ? " cur" : ""}"><button class="box hit" type="button" data-act="fillck" data-id="${esc(rid)}" data-p="${esc(y.id)}" role="checkbox" aria-checked="${c}" aria-label="Dans mon panier ${esc(r.name)}, ${esc(y.nm)}">${ic("check")}</button><button class="gt" type="button" data-act="fillat" data-id="${esc(rid)}" data-v="${j}"${j === i ? ' aria-current="true"' : ""}><b>${y.q > 1 ? `<span class="gq">${y.q} ×</span> ` : ""}${esc(siteName(rid, y) || y.nm)}</b><small>${esc(y.f)}, ${eurC(y.cost)}</small></button><span></span></div>`; }).join("");
    return {
      title: r.name, grouped: true, solo: true, anchor: ".fhead",
      dockHtml: `<a class="btn" href="${esc(L.url)}" target="_blank" rel="noopener" data-act="fillopen" data-id="${esc(rid)}" data-p="${esc(x.id)}">${esc(openLabel(r, L))}${ic("ext")}</a>`,
      html: `<div class="fhead"><span class="mono" aria-hidden="true">${esc(r.name.slice(0, 1))}</span><div class="rt"><h1 class="t3">Ton panier ${esc(r.name)}</h1><small>${esc(r.service)}</small></div><span class="fk num">${st.k} sur ${st.n}</span></div>` +
        `<div class="prog" role="progressbar" aria-label="Produits ajoutés" aria-valuemin="0" aria-valuemax="${st.n}" aria-valuenow="${st.k}" aria-valuetext="${st.k} sur ${plural(st.n, "produit ajouté", "produits ajoutés")}"><span style="width:${Math.round((100 * st.k) / st.n)}%"></span></div>` +
        `<article class="fillp${on ? " on" : ""}" aria-labelledby="fpn"><div class="fimg">${p ? img(p, 240) : ic("bag")}</div><div class="fbody">` +
        `<p class="fpos">Produit ${i + 1} sur ${st.n}</p><p class="fqty"><b>${x.q}</b> ${x.q > 1 ? "exemplaires" : "exemplaire"}</p>` +
        `<h2 class="t1" id="fpn">${esc(x.nm)}</h2><p class="ff">${esc(x.f)}${x.q > 1 ? ", " + eurC(x.cost / x.q) + " l'unité" : ""}, ${eurC(x.cost)}${x.from ? ", déplacé depuis " + esc(retName(x.from)) : ""}${r.simulated ? ", prix simulé" : ""}</p>` +
        (dn ? `<p class="fsite">Sur ${esc(r.service)}\u00a0: <b>${esc(dn)}</b></p>` : L.kind !== "fiche" ? `<p class="fsite">À chercher sur ${esc(r.service)}\u00a0: <b>${esc(x.nm)}</b></p>` : "") +
        (on ? `<p class="fok">${ic("check")}Dans ton panier ${esc(r.name)}</p>` : `<p class="fhint">${hint}</p>`) +
        (L.kind === "site" ? `<button class="act" type="button" data-act="fillname" data-id="${esc(rid)}" data-p="${esc(x.id)}">${ic("copy")}Copier le nom</button>` : "") +
        `</div></article>` +
        `<div class="pad btns two fbtns"><button class="btn tint" type="button" data-act="fillck" data-id="${esc(rid)}" data-p="${esc(x.id)}" aria-pressed="${on}">${on ? "Pas encore ajouté" : "C'est dans mon panier"}</button><button class="btn plain" type="button" data-act="fillmiss" data-id="${esc(rid)}" data-p="${esc(x.id)}">Pas trouvé</button></div>` +
        `<div class="fnav"><button class="act" type="button" data-act="fillstep" data-id="${esc(rid)}" data-v="-1"${i === 0 ? " disabled" : ""}>${ic("back")}Précédent</button><button class="act" type="button" data-act="fillstep" data-id="${esc(rid)}" data-v="1"${i === st.n - 1 ? " disabled" : ""}>Suivant${ic("chev")}</button></div>` +
        `<h2 class="gh">Toute la liste</h2><div class="group">${list}</div>` +
        `<div class="group" style="margin-top:24px"><button class="row link" type="button" data-act="fillcopy" data-id="${esc(rid)}">Copier la liste</button>${desktop() ? `<button class="row link" type="button" data-act="fillall" data-id="${esc(rid)}"><span class="rt">Tout ouvrir<small>Un onglet par produit qui reste à ajouter</small></span></button>` : ""}<button class="row link" type="button" data-act="fillfirst" data-id="${esc(rid)}">Revoir les étapes avant de commencer</button></div>` +
        `<p class="gf">${r.simulated ? "Prix simulés, pas relevés\u00a0: le vrai total s'affiche sur le site. " : "Prix relevés en ligne\u00a0; le total exact s'affiche sur le site. "}Rien n'est commandé à ta place.</p>`,
    };
  }
  /* fin de commande : récapitulatif, « J'ai passé cette commande », créneau et rappel ; puis la commande suivante */
  function fillEnd(r, o, st) {
    const rid = o.rid, W = (S.guide.when || {})[rid], nxt = fillNext(), nn = nxt && (S.allMap.get(nxt.rid) || {}).name;
    const head = st.done ? `Commande ${r.name} passée` : st.drop ? `Commande ${r.name} pas passée` : st.n ? `Ton panier ${r.name} est prêt` : `Plus rien à mettre chez ${r.name}`;
    const moved = o.items.filter((x) => x.st === "skip").length, mag = o.items.filter((x) => x.st === "mag").length;
    const text = st.done ? (W && W.d ? `${pickup(r) ? "Retrait" : "Livraison"} ${esc(whenText(W))}.` : "Dis à Cabas quand elle arrive\u00a0: il te le rappelle sur l'accueil.")
      : st.drop ? "Elle ne compte pas dans tes économies."
      : `${plural(st.n, "produit", "produits")} dans ton panier sur ${esc(r.service)}. Là-bas, vérifie le panier, choisis ton créneau et paie\u00a0: le total exact s'affiche sur le site.`;
    const short = !st.done && !st.drop && o.P.min && st.sub > 0 && st.sub < o.P.min ? `<div class="banner warn" role="status">${ic("info")}<span><b>Sous le minimum de ${eurC(o.P.min).replace(",00", "")}</b>Il manque ${eurC(o.P.min - st.sub)} pour commander chez ${esc(r.name)}\u00a0: ajoute un produit sur le site.</span></div>` : "";
    const lines = `<div class="of"><div class="ln"><span>Articles</span><span>${eurC(st.sub)}</span></div><div class="ln"><span>${pickup(r) ? "Retrait" : "Livraison"}</span><span>${feeWord(r, st.fee - o.P.fixed).replace(/^./, (c) => c.toUpperCase())}</span></div>${o.P.fixed ? `<div class="ln"><span>Frais de service</span><span>${eurC(o.P.fixed)}</span></div>` : ""}<div class="ln tot"><span>Total prévu</span><span>${eurC(st.tot)}</span></div>` +
      (moved ? `<p class="hint muted">${plural(moved, "produit laissé", "produits laissés")} de côté, pour ton prochain panier.</p>` : "") + (mag ? `<p class="hint muted">${plural(mag, "produit", "produits")} à acheter en magasin.</p>` : "") +
      (r.simulated ? `<p class="hint muted">Prix simulés, pas relevés\u00a0: le vrai total s'affiche sur ${esc(r.service)}.</p>` : "") + `</div>`;
    const whenBox = st.done ? (W && W.d ? `<div class="acts fend-acts"><button class="act" type="button" data-act="when" data-id="${esc(rid)}">Modifier le créneau${ic("chev")}</button><button class="act" type="button" data-act="ics" data-id="${esc(rid)}" data-d="${esc(W.d)}" data-s="${esc(W.s || "")}">${ic("cal")}Ajouter au calendrier</button></div>` : `<div class="pad btns"><button class="btn tint" type="button" data-act="when" data-id="${esc(rid)}">${pickup(r) ? "Quand vas-tu la retirer\u00a0?" : "Quand est-ce livré\u00a0?"}</button></div>`) : "";
    const actions = st.done ? `<button class="act" type="button" data-act="fillundone" data-id="${esc(rid)}">Commande pas encore passée</button>`
      : st.drop ? `<button class="act" type="button" data-act="fillundrop" data-id="${esc(rid)}">Finalement, je la passe</button>`
      : `<button class="act" type="button" data-act="filldrop" data-id="${esc(rid)}">Je ne passe pas cette commande</button>`;
    const list = st.L.map((y) => { const c = st.done || ckOf(rid, y.id); return `<div class="gi${c ? " on" : ""}"><button class="box hit" type="button" data-act="fillck" data-id="${esc(rid)}" data-p="${esc(y.id)}" role="checkbox" aria-checked="${c}" aria-label="Dans mon panier ${esc(r.name)}, ${esc(y.nm)}"${st.done ? " disabled" : ""}>${ic("check")}</button><span class="gt"><b>${y.q > 1 ? `<span class="gq">${y.q} ×</span> ` : ""}${esc(siteName(rid, y) || y.nm)}</b><small>${esc(y.f)}, ${eurC(y.cost)}</small></span><span></span></div>`; }).join("");
    const dock = st.done || st.drop ? (nxt ? `<button class="btn" type="button" data-act="fill" data-id="${esc(nxt.rid)}">Continuer chez ${esc(nn)}</button>` : `<a class="btn" href="#/remplir">Retour à mes paniers</a>`)
      : st.n ? `<button class="btn" type="button" data-act="filldone" data-id="${esc(rid)}">J'ai passé cette commande</button>` : "";
    return {
      title: r.name, grouped: true, solo: true,
      dockHtml: dock,
      html: `<div class="fend"><span class="art" aria-hidden="true">${ic(st.drop ? "info" : "check")}</span><h1 class="t1">${esc(head)}</h1><p>${text}</p></div>` + short +
        `<section class="order" aria-label="Récapitulatif ${esc(r.name)}">${lines}</section>` + whenBox +
        (!st.done && !st.drop && st.n ? `<div class="pad btns" style="padding-top:14px"><a class="btn tint" href="${esc(r.cart || r.home)}" target="_blank" rel="noopener">Ouvrir ${esc(r.service)} pour payer${ic("ext")}</a></div>` : "") +
        `<div class="fend-acts acts">${actions}</div>` +
        (st.n ? `<h2 class="gh">Les produits</h2><div class="group">${list}</div>` : "") +
        `<div class="group" style="margin-top:24px"><a class="row link" href="#/remplir">Tous mes paniers</a><button class="row link" type="button" data-act="fillcopy" data-id="${esc(rid)}">Copier la liste</button></div>`,
    };
  }
  /* #/remplir/<rid> : « Avant de commencer » la première fois, puis produit par produit, puis le récapitulatif */
  function fillGuide(rid) {
    const r = S.allMap.get(rid);
    if (!r) return notFound("enseigne");
    const s0 = snapOf(), usable = fillUsable();
    if (!usable || !fillOrd(rid)) {
      /* lien direct (raccourci, panier) sans remplissage en cours : l'instantané se prend ici, une fois la répartition calculée */
      if (usable && !finished(s0)) return { title: r.name, grouped: true, html: `<h1 class="lt">${esc(r.name)}</h1><div class="empty">${emptyArt("bag")}<h2>Pas de commande ${esc(r.name)}</h2><p>Le remplissage en cours ne passe pas par ${esc(r.name)}.</p><a class="btn" href="#/remplir">Remplir mes paniers</a></div>` };
      const res = count() ? cartResult() : null;
      if (res && !res.steps[res.K] && !res.done) return fillWait(r.name);
      const ns = res && fillSnap();
      if (!ns || !ns.orders.some((o) => o.rid === rid)) return { title: r.name, grouped: true, html: `<h1 class="lt">${esc(r.name)}</h1><div class="empty">${emptyArt("bag")}<h2>Pas de commande ${esc(r.name)}</h2><p>Ta répartition ne passe pas par ${esc(r.name)} pour l'instant.</p><a class="btn" href="#/remplir">Remplir mes paniers</a></div>` };
      S.guide = freshGuide(ns); saveGuide();
    }
    const o = fillOrd(rid), st = ordState(o);
    if (!(S.seen.first || {})[offKey(r)] && !st.done && !st.drop) return fillBefore(r);
    const ps = st.L.map((x) => S.prods.get(x.id)).filter(Boolean);
    if (ps.some((p) => p.u && !DETV.has(p.u) && !DETF.has(p.u))) {
      /* les liens et les noms chez l'enseigne d'abord (data/details), un squelette en attendant ; hors ligne, la recherche du site */
      return {
        title: r.name, grouped: true, solo: true,
        html: `<div class="fhead" aria-busy="true"><span class="mono" aria-hidden="true">${esc(r.name.slice(0, 1))}</span><div class="rt"><h1 class="t3">Ton panier ${esc(r.name)}</h1><small>${esc(r.service)}</small></div></div><p class="sr" role="status">Chargement des liens vers ${esc(r.service)}</p><div class="fillp" aria-hidden="true"><div class="fimg sk"></div><div class="skl"></div><div class="skl s"></div><div class="skl"></div></div>`,
        mount: () => detailsAll(ps, () => { ps.forEach((p) => { if (p.u && !DETV.has(p.u)) DETF.add(p.u); }); if (S.route.name === "remplir" && S.route.id === rid && $("#sheet").hidden) rerender(); }),
      };
    }
    if (st.done || st.drop || !st.n || st.k === st.n) return fillEnd(r, o, st);
    return fillProduct(r, o, st);
  }
  VIEWS.remplir = (r) => (r.id ? fillGuide(r.id) : fillHome());
  /* « Pas trouvé » : un équivalent chez la même enseigne, une autre commande (avec l'effet sur les frais), le magasin, ou plus tard */
  function fillMissSheet(rid, id) {
    const build = () => {
      const s = snapOf(), o = fillOrd(rid), x = o && o.items.find((y) => y.id === id && !y.st);
      if (!x) return { body: `<p>Ce produit n'est plus dans cette commande.</p>`, foot: "" };
      const r = S.allMap.get(rid), p = S.prods.get(id), st = ordState(o), L = fillLink(rid, x), without = feeEffect(o, st.sub - x.cost);
      const alt = L.kind === "fiche" ? fillSearch(r, p, x) : null;
      const eqs = equivOf(p, rid);
      const others = s.orders.filter((o2) => o2.rid !== rid && !closed(o2)).map((o2) => { const v = p && p.offers[o2.rid]; return v && v.price > 0 ? { o2, cost: Math.round(v.price * 100) * x.q, sim: v.sim } : null; }).filter(Boolean);
      const mag = S.prefs.comp !== false ? magFor(p, x.q) : null;
      return {
        body: `<p>${x.q > 1 ? x.q + " × " : ""}<b>${esc(x.nm)}</b>${x.f ? ", " + esc(x.f) : ""}, introuvable sur ${esc(r.service)}\u00a0? Choisis ce que Cabas en fait.</p>` +
          (alt ? `<div class="group"><a class="row link" href="${esc(alt.url)}" target="_blank" rel="noopener" data-act="fillbroken" data-id="${esc(rid)}" data-p="${esc(id)}"><span class="rt">Le lien n'ouvre pas le bon produit<small>${alt.kind === "recherche" ? "Chercher sur " + esc(r.service) + " à la place" : "Ouvrir " + esc(r.service) + " pour le chercher"}. Cabas s'en souviendra.</small></span>${ic("ext", "ext")}</a></div>` : "") +
          (eqs.length ? `<h3 class="gh">Un équivalent chez ${esc(r.name)}</h3><div class="group">${eqs.map((q) => `<button class="opt alt" type="button" data-act="fillequiv" data-id="${esc(rid)}" data-p="${esc(id)}" data-e="${esc(q.e.id)}"><span class="thumb">${img(q.e, 40)}</span><span class="at"><b>${esc(q.e.brand)}</b> ${esc(q.e.name)}<small>${esc(q.e.format)}${q.u != null ? ", " + esc(unitPrice(q.e, q.price)) : ""}</small></span><span class="ap">${eur(q.price)}</span>${ic("chev", "chev")}</button>`).join("")}</div>` : "") +
          `<h3 class="gh">Ou bien</h3><div class="group">` +
          others.map(({ o2, cost, sim }) => { const r2 = S.allMap.get(o2.rid) || { name: o2.rid }; return `<button class="row" type="button" data-act="fillmove" data-id="${esc(rid)}" data-p="${esc(id)}" data-to="${esc(o2.rid)}"><span class="rt">Le mettre chez ${esc(r2.name)}<small>${eurC(cost)} chez ${esc(r2.name)}${sim ? ", prix simulé" : ""}. ${esc(feeEffect(o2, ordState(o2).sub + cost))} ${esc(without)}</small></span>${ic("chev", "chev")}</button>`; }).join("") +
          (mag ? `<button class="row" type="button" data-act="fillmag" data-id="${esc(rid)}" data-p="${esc(id)}"><span class="rt">L'acheter en magasin<small>Environ ${eurC(mag.cost)} chez ${esc(retName(mag.ret).split(" ")[0])}, au prix relevé en ligne. ${esc(without)}</small></span>${ic("chev", "chev")}</button>` : "") +
          `<button class="row" type="button" data-act="fillskip" data-id="${esc(rid)}" data-p="${esc(id)}"><span class="rt">Le laisser de côté<small>Il reviendra dans ton prochain panier. ${esc(without)}</small></span>${ic("chev", "chev")}</button></div>`,
        foot: "",
      };
    };
    const o = build();
    openSheet({ title: "Pas trouvé", body: o.body, build });
  }
  /* changement de l'instantané par « Pas trouvé » : le panier suit pour un équivalent, l'instantané reste à jour s'il l'était */
  function fillEdit(rid, id, fn, label, keys) {
    const s = snapOf(), o = fillOrd(rid), i = o ? o.items.findIndex((y) => y.id === id && !y.st) : -1;
    if (i < 0) { closeSheet(); return; }
    const fresh = !stale(s), undo = snap(...(keys || ["guide"]));
    if (fn(o, o.items[i], i) === false) return;
    if (fresh) s.key = basketKey();
    delete S.guide.ck[rid + "|" + id];
    saveGuide(); closeSheet(); renderChrome(); rerender();
    undoable(label, undo, 6000);
  }
  /* un panier commandé remis en un geste (avec les produits qui manquaient à la dernière livraison), puis « Remplir mes paniers » */
  function refill(h) {
    if (!h || !h.items) return;
    const items = {};
    for (const id0 of Object.keys(h.items)) { const id = S.prods.has(id0) ? id0 : (S.alias || {})[id0]; if (id && S.prods.has(id) && h.items[id0] > 0) items[id] = Math.min(99, (items[id] || 0) + h.items[id0]); }
    for (const t of S.todo) if (S.prods.has(t.id)) items[t.id] = Math.min(99, (items[t.id] || 0) + t.q);
    if (!Object.keys(items).length) { toast("Ces produits ne sont plus au catalogue"); return; }
    const had = count(), undo = snap("basket", "guide", "todo");
    S.basket = items; S.todo = []; saveBasket(); saveTodo();
    const g = S.guide; S.guide = { ck: {}, done: {}, when: g.when || {}, broken: g.broken || {}, snooze: g.snooze || {} }; saveGuide();
    renderChrome(); bumpBadge(); push("#/remplir");
    undoable((had ? "Panier remplacé par celui du " : "Panier du ") + dayFr(h.d) + (had ? "" : " remis"), undo, 8000);
  }
  /* ---------- après la commande : arrivée, total payé, à racheter ---------- */
  /* la commande d'un panier passé dont la livraison est passée, sans réponse ni rappel repoussé : « Tout est arrivé ? » */
  function arrival() {
    const today = isoDay(new Date()), now = new Date(), floor = isoDay(new Date(Date.now() - 10 * 864e5));
    for (let hi = S.hist.length - 1; hi >= 0; hi--) {
      const h = S.hist[hi];
      for (const o of (h.o || []).filter((x) => x && x.rid)) {
        if ((h.arr || {})[o.rid] || ((S.guide.snooze || {})[(h.sid || h.d) + "|" + o.rid] || 0) > Date.now()) continue;
        const w = (h.when || []).find((x) => x.rid === o.rid), due = w ? w.d : isoDay(new Date(Date.parse(h.d + "T12:00:00") + leadDays(o.rid) * 864e5));
        const sl = w && SLOTS.find((x) => x[0] === w.s);
        if (due > today || due < floor || (due === today && (!sl || now.getHours() < sl[3]))) continue;
        return { h, hi, o, w };
      }
    }
    return null;
  }
  function arrivalCard() {
    const a = arrival();
    if (!a) return "";
    const n = Object.values(a.o.items || {}).reduce((x, q) => x + q, 0);
    return `<section class="hcard col arr" aria-labelledby="arrT"><div class="arrh">${ic(a.o.pick ? "store" : "truck", "si")}<span><b id="arrT">Ta commande ${esc(a.o.name)} est ${a.o.pick ? "retirée" : "arrivée"}\u00a0?</b><small>${a.w ? (a.o.pick ? "Retrait prévu " : "Livraison prévue ") + esc(whenText({ d: a.w.d, s: a.w.s })) : "Commandée le " + esc(dayFr(a.h.d))}, ${plural(n, "article", "articles")}, ${eurC(a.o.t)} prévus.</small></span><button class="x" type="button" data-act="arrlater" data-id="${a.hi}" data-r="${esc(a.o.rid)}" aria-label="Plus tard">${ic("x")}</button></div>` +
      `<div class="btns two"><button class="btn sm tint" type="button" data-act="arrok" data-id="${a.hi}" data-r="${esc(a.o.rid)}">Oui, tout est là</button><button class="btn sm ghost" type="button" data-act="arrmiss" data-id="${a.hi}" data-r="${esc(a.o.rid)}">Il manquait quelque chose</button></div></section>`;
  }
  function arrMissSheet(hi, rid) {
    const h = S.hist[hi], o = h && (h.o || []).find((x) => x && x.rid === rid);
    if (!o) return;
    S.arrSel = {};
    const build = () => {
      const ids = Object.keys(o.items || {}), n = Object.keys(S.arrSel).filter((k) => S.arrSel[k]).length;
      return {
        body: `<p>Coche ce qui manquait\u00a0: ces produits reviendront dans ton prochain panier.</p><div class="group" role="group" aria-label="Produits de la commande ${esc(o.name)}">${ids.map((id) => { const p = S.prods.get(id); return opt("arrsel", `${o.items[id] > 1 ? o.items[id] + " × " : ""}${esc(p ? pname(p) : id)}`, !!S.arrSel[id], `data-id="${esc(id)}"`); }).join("")}</div>`,
        foot: `<button class="btn" type="button" data-act="arrmissok" data-id="${hi}" data-r="${esc(rid)}"${n ? "" : " disabled"}>${n ? "Pour le prochain panier, " + plural(n, "produit", "produits") : "Coche au moins un produit"}</button>`,
      };
    };
    const b = build();
    openSheet({ title: "Il manquait", body: b.body, foot: b.foot, build });
  }
  /* « Vrai total facturé » : saisi par la personne, d'après sa facture ; gardé à part des prix relevés (cabas.hist[].paid) */
  function paidSheet(hi) {
    const h = S.hist[hi];
    if (!h) return;
    const os = (h.o || []).filter((x) => x && x.rid), paid = h.paid || {};
    const rows = os.length ? os : [{ rid: "all", name: "ce panier", t: h.t }];
    openSheet({
      title: "Total payé", focus: "#paid0", right: `<button class="txtbtn primary" type="button" data-act="paidok" data-id="${hi}">OK</button>`,
      body: `<p>Le montant de ta facture, si tu veux le garder. Il est saisi par toi et reste à part\u00a0: Cabas ne s'en sert jamais comme prix relevé.</p>` +
        rows.map((o, i) => field("paid" + i, os.length ? "Payé chez " + esc(o.name) : "Payé pour ce panier", `type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" data-r="${esc(o.rid)}" placeholder="Par exemple ${esc(frNum(Math.round(o.t) / 100))}" value="${paid[o.rid] ? esc(frNum(paid[o.rid] / 100)) : ""}"`, `Prévu ${eurC(o.t)} aux prix relevés.`, "€")).join(""),
    });
  }
  const paidSum = (h) => Object.values(h.paid || {}).reduce((a, c) => a + (c > 0 ? c : 0), 0);
  function todoCard() {
    const L = S.todo.filter((t) => S.prods.has(t.id) && !S.basket[t.id]);
    if (!L.length) return "";
    return `<section class="hcard col" aria-labelledby="todoT"><span><b id="todoT">${L.length > 1 ? plural(L.length, "produit", "produits") + " à racheter" : "Un produit à racheter"}</b><small>Il manquait à ta dernière livraison\u00a0: ${esc(joinEt(L.slice(0, 3).map((t) => pname(S.prods.get(t.id)))))}${L.length > 3 ? ", et d'autres" : ""}.</small></span><div class="btns two"><button class="btn sm tint" type="button" data-act="todoadd">${ic("plus")}Ajouter au panier</button><button class="btn sm ghost" type="button" data-act="tododel">Oublier</button></div></section>`;
  }
  /* « Tes prochaines courses » : d'après l'écart médian entre les paniers commandés, et le délai de chaque enseigne */
  function nextRun() {
    const H = S.hist.filter((h) => h.items && h.d);
    if (H.length < 2 || count() || fillActive()) return null;
    const t = [...new Set(H.map((h) => h.d))].sort().map((d) => Date.parse(d + "T12:00:00"));
    if (t.length < 2) return null;
    const gaps = t.slice(1).map((x, i) => x - t[i]).sort((a, b) => a - b), med = gaps[Math.floor(gaps.length / 2)];
    if (med < 3 * 864e5) return null;
    const next = isoDay(new Date(t[t.length - 1] + med)), days = Math.round((Date.parse(next + "T12:00:00") - Date.parse(isoDay(new Date()) + "T12:00:00")) / 864e5);
    if (days > 4 || days < -7) return null;
    const last = H[H.length - 1], rids = (last.o || []).filter((x) => x && x.rid && S.allMap.has(x.rid)).map((x) => x.rid);
    const rid = rids.sort((a, b) => leadDays(b) - leadDays(a))[0] || null;
    return { next: days < 1 ? isoDay(new Date(Date.now() + Math.max(1, leadDays(rid || "")) * 864e5)) : next, med: Math.round(med / 864e5), rid };
  }
  function nextCard() {
    const n = nextRun();
    if (!n) return "";
    return `<section class="hcard col" aria-labelledby="nextT"><span><b id="nextT">Tes prochaines courses, vers ${esc(dayLabel(n.next))}</b><small>Tu fais tes courses tous les ${n.med} jours environ.${n.rid ? " " + esc(leadText(n.rid, n.next)) : ""}</small></span><div class="btns"><button class="btn sm tint" type="button" data-act="refill" data-id="last">Recommander et remplir</button></div></section>`;
  }
  /* sur l'accueil, tant qu'un remplissage est en cours */
  function fillHomeCard() {
    if (!fillActive()) return "";
    const s = snapOf(), o = fillNext();
    if (!o) return "";
    const r = S.allMap.get(o.rid) || { name: o.rid }, st = ordState(o), rest = st.n - st.k;
    let K = 0, N = 0;
    s.orders.forEach((x) => { const y = ordState(x); N += y.n; K += closed(x) ? y.n : y.k; });
    return `<a class="hcard tint fillh" href="#/remplir">${ic("bag", "si")}<span><b>${rest ? `Il te reste ${plural(rest, "produit", "produits")} à mettre chez ${esc(r.name)}` : `Ton panier ${esc(r.name)} est prêt, reste à payer`}</b><small>Remplir mes paniers\u00a0: ${K} sur ${plural(N, "produit", "produits")}${s.orders.length > 1 ? ", " + plural(s.orders.length, "commande", "commandes") : ""}</small><span class="prog thin" aria-hidden="true"><span style="width:${N ? Math.round((100 * K) / N) : 0}%"></span></span></span>${ic("chev", "chev")}</a>`;
  }
  /* la pastille du mini panier : reprendre le remplissage là où il en est (réglage « Rappel dans le mini panier ») */
  function fillMini() {
    if (!S.ready || S.prefs.badge === false || !fillActive()) return "";
    const o = fillNext();
    if (!o) return "";
    const r = S.allMap.get(o.rid) || { name: o.rid }, st = ordState(o), rest = st.n - st.k;
    return `<a class="mini" href="#/remplir/${esc(o.rid)}"><span class="mn">${rest || ic("check")}</span><span class="ml">${rest ? "Reprendre chez " : "Terminer chez "}${esc(r.name)}<small>${rest ? `Il te reste ${plural(rest, "produit", "produits")} à mettre chez ${esc(r.name)}` : `Tout est dans ton panier ${esc(r.name)}`}</small></span>${ic("chev")}</a>`;
  }
  /* #/recommander : les paniers commandés, du plus récent, chacun remis et réparti en un geste */
  VIEWS.recommander = () => {
    const H = S.hist.map((h, i) => ({ h, i })).filter((x) => x.h.items).reverse();
    const names = (h) => (h.o || []).map((v) => (typeof v === "string" ? v : v && v.name)).filter(Boolean);
    return {
      title: "Recommander", grouped: true,
      html: `<h1 class="lt">Recommander</h1><p class="lt-sub">${H.length ? "Un panier déjà commandé, remis et réparti aux prix d'aujourd'hui." : "Aucun panier commandé pour l'instant"}</p>` +
        (H.length ? `<div class="group">${H.map(({ h, i }) => `<div class="row stack"><span class="rt">${esc(dateFr(h.d))}<small>${plural(Object.keys(h.items).length, "produit", "produits")}${names(h).length ? ", " + esc(joinEt(names(h))) : ""}, ${eurC(h.t)} à l'époque</small></span><div class="acts"><button class="btn sm tint" type="button" data-act="refill" data-id="${i}">Recommander et remplir</button></div></div>`).join("")}</div>` +
          (S.todo.length ? `<p class="gf">Les produits qui manquaient à ta dernière livraison sont ajoutés aussi.</p>` : "")
          : `<div class="empty">${emptyArt("bag")}<h2>Rien à recommander</h2><p>Quand tu as rempli tes paniers et passé tes commandes, ils reviennent ici en un geste.</p><a class="btn" href="#/ecrire">${ic("pen")}Écrire ma liste</a></div>`),
    };
  };
  /* délai de livraison de chaque enseigne, pour « Commande avant… » : celui du site, ou le tien */
  function leadSheet() {
    const build = () => ({
      body: `<p>Pour te dire quand commander. Par défaut, le délai indiqué par chaque enseigne.</p>` + S.rets.filter((r) => retOn(r.id)).map((r) => {
        const d = leadDays(r.id), L = r.lead || {};
        return `<h3 class="gh" id="lead-${esc(r.id)}">${esc(r.name)}${r.group && (r.channel || {}).where ? ", " + esc(r.channel.where) : ""}</h3><div class="pad"><div class="seg" role="radiogroup" aria-labelledby="lead-${esc(r.id)}">${[0, 1, 2, 3].map((v) => `<button type="button" role="radio" data-act="leadset" data-id="${esc(r.id)}" data-v="${v}" aria-checked="${v === d}">${v ? plural(v, "jour", "jours") : "Le jour même"}</button>`).join("")}</div></div><p class="gf">${tx(L.text || "")}${L.text ? ". " : ""}${L.verifiedAt ? "Vérifié sur le site le " + esc(dateFr(L.verifiedAt)) : "À confirmer sur le site"}${L.source ? "\u00a0: " + tx(L.source) : ""}.</p>`;
      }).join(""),
    });
    const b = build();
    openSheet({ title: "Délais de livraison", body: b.body, build });
  }
  function savingsCard() {
    const H = S.hist || [];
    if (!H.length) return "";
    const s = H.reduce((a, x) => a + (x.s || 0), 0);
    return `<div class="hcard tint">${ic("coin", "si")}<a class="hl" href="#/economies"><b>${eurC(s)} économisés avec Cabas</b><small>Sur ${plural(H.length, "panier", "paniers")} depuis le ${esc(dateFr(H[0].d).replace(/ \d{4}$/, ""))}, grâce aux meilleurs prix et aux remplacements.</small></a><button class="icbtn" type="button" data-act="sharesave" aria-label="Partager mes économies">${ic("share")}</button></div>`;
  }
  VIEWS.economies = () => {
    const H = (S.hist || []).slice().reverse(), s = H.reduce((a, x) => a + (x.s || 0), 0);
    return {
      title: "Tes économies", grouped: true,
      html: `<h1 class="lt">Tes économies</h1><p class="lt-sub">${H.length ? `${eurC(s)} sur ${plural(H.length, "panier", "paniers")}` : "Aucun panier commandé pour l'instant"}</p>` +
        (H.length ? `<div class="group">${H.map((x, i) => { const hi = S.hist.length - 1 - i, names = (x.o || []).map((v) => (typeof v === "string" ? v : v && v.name)).filter(Boolean), pd = paidSum(x); return `<div class="row stack"><span class="rt">${esc(dateFr(x.d))}<small>${plural(x.n || 0, "article", "articles")}${names.length ? ", " + esc(joinEt(names)) : ""}, ${eurC(x.t)} aux prix relevés${x.s ? ", " + eurC(x.s) + " économisés" : ""}</small>${pd ? `<small>Payé ${eurC(pd)}, saisi par toi</small>` : ""}</span><div class="acts">${x.items ? `<button class="btn sm plain" type="button" data-act="refill" data-id="${hi}">Recommander et remplir</button>` : ""}<button class="act" type="button" data-act="paid" data-id="${hi}">${pd ? "Modifier le total payé" : "Indiquer le total payé"}</button></div></div>`; }).join("")}</div>` +
          `<p class="gf">Un panier compte quand toutes ses commandes sont notées comme passées. L'économie d'un panier additionne, pour chaque produit, l'écart entre le prix payé et son prix moyen dans les enseignes qui le vendent, et ce que les remplacements par un équivalent moins cher ont fait gagner. Selon les prix relevés. Le total payé, quand tu l'indiques, est saisi par toi\u00a0: il reste à part et n'entre dans aucun calcul.</p>` +
          `<div class="pad btns" style="padding-top:18px"><button class="btn tint" type="button" data-act="sharesave">${ic("share")}Partager mes économies</button></div>` +
          `<div class="group" style="margin-top:28px"><a class="row" href="#/mouvements"><span class="rt">Tes dépenses et ce qui a bougé<small>Tes dépenses de chaque mois, les hausses et les baisses de tes produits</small></span>${ic("chev", "chev")}</a></div>` +
          `<div class="group" style="margin-top:28px"><button class="row danger" type="button" data-act="histclear">Effacer l'historique</button></div>` :
          `<div class="empty">${emptyArt("coin")}<h2>Rien pour l'instant</h2><p>Dans le panier, touche «\u00a0Remplir mes paniers\u00a0»\u00a0: quand chaque commande est passée, l'économie s'ajoute ici.</p></div>`),
    };
  };

  /* ---------- suivi des commandes ---------- */
  /* Quand une commande est notée comme passée, on peut dire quand elle arrive (jour et créneau), comme le suivi d'une
     commande de repas : le panier et l'accueil affichent la prochaine livraison ou le prochain retrait, et un fichier
     calendrier (.ics) ajoute le rappel sur le téléphone. Les paniers commandés gardent leurs produits : on peut les
     recommander en un geste, et l'accueil propose les produits qui reviennent souvent. */
  const SLOTS = [["matin", "Matin", 8, 12], ["midi", "Midi", 12, 14], ["aprem", "Après-midi", 14, 18], ["soir", "Soir", 18, 22]];
  const isoDay = (d) => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); };
  function dayLabel(iso, short) {
    const t = new Date(iso + "T12:00:00"), today = isoDay(new Date()), tom = isoDay(new Date(Date.now() + 864e5));
    if (iso === today) return "aujourd'hui";
    if (iso === tom) return "demain";
    const s = t.toLocaleDateString("fr-FR", short ? { weekday: "short", day: "numeric" } : { weekday: "long", day: "numeric", month: "long" });
    return s.replace(/\.$/, "");
  }
  function whenText(w) {
    if (!w || !w.d) return "";
    const sl = SLOTS.find((s) => s[0] === w.s);
    return `${dayLabel(w.d)}${sl ? ", " + sl[1].toLowerCase() + ` (${sl[2]}h à ${sl[3]}h)` : ""}`;
  }
  function whenSheet(rid) {
    const r = S.retMap.get(rid) || S.allMap.get(rid);
    if (!r) return;
    const w = (S.guide.when || {})[rid] || {};
    const build = () => {
      const cur = (S.guide.when || {})[rid] || {};
      const days = Array.from({ length: 8 }, (_, i) => isoDay(new Date(Date.now() + i * 864e5)));
      return {
        body: `<p>${pickup(r) ? "Quand vas-tu le retirer\u00a0?" : "Quand est-ce livré\u00a0?"} Cabas te le rappelle sur l'accueil.</p>` +
          `<h3 class="gh" id="whenD">Jour</h3><div class="tagset" role="radiogroup" aria-labelledby="whenD">${days.map((d) => `<button class="chip" type="button" role="radio" data-act="whend" data-id="${esc(rid)}" data-d="${d}" aria-checked="${cur.d === d}">${esc(dayLabel(d, true).replace(/^./, (c) => c.toUpperCase()))}</button>`).join("")}</div>` +
          `<h3 class="gh" id="whenS">Créneau</h3><div class="tagset" role="radiogroup" aria-labelledby="whenS">${SLOTS.map(([k, l, a, b]) => `<button class="chip" type="button" role="radio" data-act="whens" data-id="${esc(rid)}" data-s="${k}" aria-checked="${cur.s === k}">${l}, ${a}h à ${b}h</button>`).join("")}</div>`,
        foot: `<button class="btn plain" type="button" data-act="whenno" data-id="${esc(rid)}">Plus tard</button><button class="btn" type="button" data-act="close"${cur.d ? "" : " disabled"}>OK</button>`,
      };
    };
    const o = build();
    openSheet({ title: `Rappel de ${pickup(r) ? "retrait" : "livraison"}, ${r.name}`, right: `<span></span>`, body: o.body, foot: o.foot, build, onClose: () => { if (["panier", "home", "remplir"].includes(S.route.name)) rerender(); } });
    return w;
  }
  /* créneaux des commandes du panier, tels que notés */
  function saveWhen() {
    saveGuide();
    /* le panier est déjà dans l'historique : ses créneaux suivent */
    const s = snapOf(), h = s && S.hist.find((x) => x.sid === s.id);
    if (h) { h.when = whenOf((h.o || []).map((x) => x && x.rid).filter(Boolean)); store.set("hist", S.hist); }
  }

  /* commandes passées, à venir : celles du panier en cours, puis celles des paniers d'avant pas encore livrées */
  function upcoming() {
    const today = isoDay(new Date()), out = [];
    const W = S.guide.when || {};
    /* un créneau n'existe que pour une commande passée ; il survit au panier vidé (clearok garde when) */
    for (const rid of Object.keys(W)) { const w = W[rid]; const r = S.retMap.get(rid) || S.allMap.get(rid); if (r && w && w.d && w.d >= today) out.push({ rid, name: r.name, pick: pickup(r), w, where: (r.channel || {}).where || "" }); }
    for (const h of S.hist || []) for (const x of h.when || []) if (x.d >= today && !out.some((y) => y.rid === x.rid && y.w.d === x.d)) out.push({ rid: x.rid, name: x.name, pick: x.pick, w: { d: x.d, s: x.s }, where: x.where || "" });
    return out.sort((a, b) => (a.w.d + a.w.s).localeCompare(b.w.d + b.w.s));
  }
  function ordersCard() {
    const up = upcoming();
    if (!up.length) return "";
    return `<section class="hcard list" aria-label="Tes commandes"><h2>Tes commandes</h2>${up.map((x) => `<div class="orow"><span class="mono sm" aria-hidden="true">${esc(x.name.slice(0, 1))}</span><span class="rt">${esc(x.name)}<small>${x.pick ? "Retrait" : "Livraison"} ${esc(whenText(x.w))}${x.where ? ", " + esc(x.where) : ""}</small></span><button class="btn sm plain" type="button" data-act="ics" data-id="${esc(x.rid)}" data-d="${esc(x.w.d)}" data-s="${esc(x.w.s || "")}" aria-label="Ajouter au calendrier, ${esc(x.name)}">${ic("cal")}</button></div>`).join("")}</section>`;
  }
  function icsFor(name, pick, d, s, where) {
    const sl = SLOTS.find((x) => x[0] === s) || [null, null, 9, 18];
    const pad = (n) => String(n).padStart(2, "0"), dt = (h) => d.replace(/-/g, "") + "T" + pad(h) + "0000";
    const uid = `${d}-${name.replace(/\W/g, "")}@cabas`;
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Cabas//FR", "BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`, `DTSTART;TZID=Europe/Paris:${dt(sl[2])}`, `DTEND;TZID=Europe/Paris:${dt(sl[3])}`, `SUMMARY:${pick ? "Retrait" : "Livraison"} ${name} (Cabas)`, where ? `LOCATION:${where}` : "", "BEGIN:VALARM", "TRIGGER:-PT60M", "ACTION:DISPLAY", `DESCRIPTION:${pick ? "Retrait" : "Livraison"} ${name} dans une heure`, "END:VALARM", "END:VEVENT", "END:VCALENDAR"].filter(Boolean);
    return lines.join("\r\n");
  }
  function downloadIcs(rid, d, s) {
    const r = S.retMap.get(rid) || S.allMap.get(rid);
    if (!r) return;
    const blob = new Blob([icsFor(r.name, pickup(r), d, s, (r.channel || {}).where || "")], { type: "text/calendar" });
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = `${pickup(r) ? "retrait" : "livraison"}-${r.id}-${d}.ics`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast("Rappel prêt pour ton calendrier");
  }
  /* produits qui reviennent dans tes paniers commandés */
  function habits(n) {
    const cnt = new Map(), H = (S.hist || []).filter((h) => h.items);
    if (!H.length) return [];
    H.forEach((h) => Object.keys(h.items).forEach((id) => cnt.set(id, (cnt.get(id) || 0) + 1)));
    return [...cnt.entries()].filter(([id]) => S.prods.has(id) && best(S.prods.get(id)) && !S.basket[id]).sort((a, b) => b[1] - a[1]).slice(0, n).map(([id]) => S.prods.get(id));
  }
  function promosRail() {
    const diet = dietOn();
    const ps = S.list.filter((p) => { const b = best(p); return b && b.promo && !b.sim && (!diet || dietOk(p)); }).map((p) => { const os = offers(p, true); return { p, gap: os.length > 1 ? os[os.length - 1].price - os[0].price : 0 }; }).sort((a, b) => b.gap - a.gap).slice(0, 12).map((x) => x.p);
    return ps.length ? `<div class="sh"><h2>Offres en cours</h2></div><div class="rail" role="region" aria-label="Offres en cours">${ps.map((p) => card(p)).join("")}</div>` : "";
  }
  /* produits achetés à intervalle régulier dont le prochain achat approche (au moins deux paniers, écart médian) */
  function dueSoon(n) {
    const seen = new Map();
    for (const h of (S.hist || []).filter((x) => x.items)) for (const id of Object.keys(h.items)) { if (!seen.has(id)) seen.set(id, []); seen.get(id).push(h.d); }
    const today = Date.parse(isoDay(new Date())), out = [];
    for (const [id, ds] of seen) {
      if (ds.length < 2 || !S.prods.has(id) || S.basket[id] || !best(S.prods.get(id))) continue;
      const t = [...new Set(ds)].sort().map(Date.parse);
      if (t.length < 2) continue;
      const gaps = t.slice(1).map((x, i) => x - t[i]).sort((a, b) => a - b), med = gaps[Math.floor(gaps.length / 2)];
      if (med < 2 * 864e5) continue;
      const due = t[t.length - 1] + med;
      if (today >= due - med * 0.15) out.push({ p: S.prods.get(id), days: Math.round((due - today) / 864e5) });
    }
    return out.sort((a, b) => a.days - b.days).slice(0, n);
  }
  function dueRail() {
    const ds = dueSoon(10);
    return ds.length ? `<div class="sh"><h2>À racheter bientôt</h2></div><div class="rail" role="region" aria-label="À racheter bientôt">${ds.map((d) => card(d.p)).join("")}</div>` : "";
  }
  function habitsRail() {
    const ps = habits(10);
    if (!ps.length) return "";
    return `<div class="sh"><h2>Tes habitudes</h2>${S.hist.some((h) => h.items) ? `<button class="act" type="button" data-act="refill" data-id="last" aria-label="Recommander le dernier panier et remplir mes paniers">Recommander et remplir${ic("chev")}</button>` : ""}</div><div class="rail" role="region" aria-label="Tes habitudes">${ps.map((p) => card(p)).join("")}</div>`;
  }

  /* ---------- le panier de la semaine ---------- */
  /* D'après les paniers commandés (cabas.hist) : le rythme des courses (écart médian, jour le plus fréquent) et, pour
     chaque produit qui revient, sa cadence (à chaque fois, toutes les 2 ou 3 semaines, tous les mois) et sa quantité
     habituelle. Le panier type est une liste (cabas.lists[].template, .cad) que l'on garde et modifie ; le jour des
     courses (prefs.shopDay, sinon le jour le plus fréquent), l'accueil dit « C'est l'heure des courses » et remet au
     panier, en un geste, ce qui est à reprendre ce jour-là. */
  const DAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  const CADS = [[0, "À chaque fois"], [14, "Toutes les 2 semaines"], [21, "Toutes les 3 semaines"], [28, "Tous les mois"]];
  const dayMs = (iso) => Date.parse(iso + "T12:00:00");
  const daysSince = (iso) => Math.round((dayMs(isoDay(new Date())) - dayMs(iso)) / 864e5);
  const histItems = () => (S.hist || []).filter((h) => h && h.items && h.d);
  const liveId = (id) => (S.prods.has(id) ? id : (S.alias || {})[id] && S.prods.has(S.alias[id]) ? S.alias[id] : null);
  /* écart médian, en jours, entre des dates (deux dates différentes au moins) */
  function medGap(ds) {
    const t = [...new Set(ds)].sort().map(dayMs);
    if (t.length < 2) return null;
    const g = t.slice(1).map((x, i) => x - t[i]).sort((a, b) => a - b);
    return Math.round(g[Math.floor(g.length / 2)] / 864e5);
  }
  /* le rythme : tous les combien de jours ; le jour de la semaine quand deux paniers au moins des six derniers tombent le même jour et que le rythme est d'environ une semaine */
  function rhythm() {
    const H = histItems();
    const every = H.length >= 2 ? medGap(H.map((h) => h.d)) : null;
    if (!every) return null;
    const cnt = [0, 0, 0, 0, 0, 0, 0];
    H.slice(-6).forEach((h) => cnt[new Date(h.d + "T12:00:00").getDay()]++);
    const top = cnt.indexOf(Math.max(...cnt));
    return { every, day: cnt[top] >= 2 && every >= 5 && every <= 10 ? top : null, last: H.map((h) => h.d).sort().pop(), n: H.length };
  }
  const daySet = () => typeof S.prefs.shopDay === "number" && S.prefs.shopDay >= 0 && S.prefs.shopDay <= 6;
  const shopDay = () => { if (daySet()) return S.prefs.shopDay; const r = rhythm(); return r ? r.day : null; };
  /* dates des paniers commandés qui contiennent un produit */
  const boughtOn = (id) => histItems().filter((h) => Object.keys(h.items).some((k) => k === id || (S.alias || {})[k] === id)).map((h) => h.d).sort();
  /* cadence d'un produit : 0 s'il revient à presque chaque panier, sinon 14, 21 ou 28 jours */
  function cadOf(id) {
    const d = medGap(boughtOn(id)), ev = (rhythm() || {}).every || 7;
    return d == null || d <= ev * 1.4 ? 0 : d < 18 ? 14 : d < 25 ? 21 : 28;
  }
  const cadLabel = (c) => (CADS.find((x) => x[0] === c) || CADS[0])[1];
  /* le panier type proposé : les produits d'au moins deux des six derniers paniers commandés (et d'au moins un tiers d'entre eux), à leur quantité habituelle */
  function autoTemplate() {
    const H = histItems().slice(-6);
    if (H.length < 2) return null;
    const cnt = new Map();
    H.forEach((h) => new Set(Object.keys(h.items).map(liveId).filter(Boolean)).forEach((id) => cnt.set(id, (cnt.get(id) || 0) + 1)));
    const items = {}, cad = {};
    for (const [id, n] of cnt) if (n >= 2 && n >= H.length / 3) { items[id] = usualQty(S.prods.get(id)).n; const c = cadOf(id); if (c) cad[id] = c; }
    return Object.keys(items).length >= 3 ? { id: "auto", name: "Mon panier de la semaine", items, cad, template: true, auto: true } : null;
  }
  const savedTpl = () => S.lists.find((L) => L.template) || null;
  const weekTpl = () => savedTpl() || autoTemplate();
  /* ce qui est à reprendre aujourd'hui : chaque produit « à chaque fois », les autres quand leur cadence est passée (à un demi-rythme près) */
  function tplDue(T) {
    const items = {}, later = [], slack = Math.floor(((rhythm() || {}).every || 7) / 2);
    for (const id of Object.keys((T && T.items) || {})) {
      if (!S.prods.has(id)) continue;
      const c = (T.cad || {})[id] || 0, last = boughtOn(id).pop(), left = last ? c - daysSince(last) : 0;
      if (!c || !last || left <= slack) items[id] = T.items[id]; else later.push({ id, left });
    }
    return { items, later: later.sort((a, b) => a.left - b.left) };
  }
  /* l'enseigne de la dernière commande au délai le plus long : « Commande avant… » */
  const leadRid = () => { const H = histItems(), last = H[H.length - 1]; return ((last && last.o) || []).filter((x) => x && x.rid && S.allMap.has(x.rid)).map((x) => x.rid).sort((a, b) => leadDays(b) - leadDays(a))[0] || null; };
  /* « C'est l'heure des courses » : le jour des courses (réglé, ou le plus fréquent), ou, sans jour, quand le rythme est
     passé (sept jours au plus) ; jamais pendant un remplissage, avec un panier déjà commencé, juste après une commande,
     ni après « Pas cette fois » le même jour */
  function prepNow() {
    if (!S.ready || fillActive() || count() > 2) return null;
    const T = weekTpl(), r = rhythm(), today = isoDay(new Date());
    if (!T || store.get("prepSnooze", "") >= today) return null;
    if (r && daysSince(r.last) < Math.max(2, Math.floor(r.every / 2))) return null;
    const sd = shopDay();
    const when = sd != null ? new Date().getDay() === sd : !!r && daysSince(r.last) >= r.every && daysSince(r.last) <= r.every + 7;
    if (!when) return null;
    const D = tplDue(T);
    return Object.keys(D.items).length ? { T, D, sd } : null;
  }
  function prepCard(P) {
    if (!P) return "";
    const e = estimate(P.D.items), n = Object.keys(P.D.items).length, rid = leadRid();
    /* ce qui attendra : le nom court du rayon (« fromage râpé et lessive »), pas le nom complet du produit */
    const later = [...new Set(P.D.later.map((x) => { const r = rayon(S.prods.get(x.id).r); return r ? shortName(r).toLowerCase() : ""; }).filter(Boolean))].slice(0, 2);
    const why = P.sd != null ? `${DAYS[P.sd].replace(/^./, (c) => c.toUpperCase())}, ${daySet() ? "ton jour de courses" : "ton jour de courses habituel"}.` : `Tu fais tes courses tous les ${(rhythm() || {}).every} jours environ.`;
    return `<section class="hcard col arr prep" aria-labelledby="prepT"><div class="arrh">${ic("cal", "si")}<span><b id="prepT">C'est l'heure des courses</b><small>${esc(why)} Ton panier de la semaine${P.T.auto ? ", d'après tes commandes" : ""} : ${plural(n, "produit", "produits")}, environ ${eur(e.t)}.${later.length ? ` Pas cette fois : ${esc(joinEt(later))}${P.D.later.length > later.length ? ", et d'autres" : ""}.` : ""}</small>${rid ? `<small>${esc(leadText(rid, isoDay(new Date(Date.now() + leadDays(rid) * 864e5))))}</small>` : ""}</span><button class="x" type="button" data-act="prepskip" aria-label="Pas cette fois">${ic("x")}</button></div>` +
      `<div class="btns two"><button class="btn sm tint" type="button" data-act="prepgo">Remplir mon panier</button><button class="btn sm ghost" type="button" data-act="prepsee">Voir le panier type</button></div></section>`;
  }
  /* le panier type proposé devient une liste gardée (modifiable, cadences comprises) */
  function keepTpl() {
    let L = savedTpl();
    if (L) return L;
    const A = autoTemplate();
    if (!A) return null;
    L = { id: Date.now().toString(36), name: A.name, items: A.items, cad: A.cad, template: true, at: isoDay(new Date()) };
    S.lists.unshift(L); saveLists();
    return L;
  }
  function shopDaySheet() {
    const build = () => {
      const r = rhythm(), cur = daySet() ? S.prefs.shopDay : -1;
      return {
        body: `<p>Ce jour-là, l'accueil te propose ton panier de la semaine, prêt à remplir.</p><div class="group" role="radiogroup" aria-label="Jour des courses">` +
          opt("shopday", `D'après mes commandes${r && r.day != null ? ` (le ${DAYS[r.day]})` : ""}`, cur < 0, `data-v="-1"`, null, true) +
          [1, 2, 3, 4, 5, 6, 0].map((d) => opt("shopday", DAYS[d].replace(/^./, (c) => c.toUpperCase()), cur === d, `data-v="${d}"`, null, true)).join("") + `</div>`,
      };
    };
    const b = build();
    openSheet({ title: "Jour des courses", body: b.body, build, onClose: () => { if (["reglages", "liste", "home"].includes(S.route.name)) rerender(); } });
  }
  function cadSheet(lid, id) {
    const L = S.lists.find((x) => x.id === lid), p = S.prods.get(id);
    if (!L || !p) return;
    const build = () => ({
      body: `<p>${esc(pname(p))} : à quel rythme le reprendre dans ton panier de la semaine ?</p><div class="group" role="radiogroup" aria-label="Rythme">${CADS.map(([c, l]) => opt("cadset", l, ((L.cad || {})[id] || 0) === c, `data-id="${esc(id)}" data-l="${esc(lid)}" data-v="${c}"`, null, true)).join("")}</div>`,
    });
    const b = build();
    openSheet({ title: "Rythme", body: b.body, build, onClose: () => { if (S.route.name === "liste") rerender(); } });
  }

  /* ---------- partager ---------- */
  const b64e = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const b64d = (s) => decodeURIComponent(escape(atob(String(s).replace(/-/g, "+").replace(/_/g, "/"))));
  async function shareText(title, text, url) {
    if (navigator.share) { try { await navigator.share(url ? { title, text, url } : { title, text }); } catch (err) { /* partage annulé */ } return; }
    try { await navigator.clipboard.writeText(url ? text + "\n" + url : text); toast(url ? "Lien copié" : "Liste copiée"); } catch (err) { toast("Copie impossible sur cet appareil"); }
  }
  function cartText() {
    const res = cartResult(), st = res.steps[res.K], bst = st && (st.full || st.partial);
    const line = (id, q) => { const p = S.prods.get(id); return `- ${q > 1 ? q + " x " : ""}${p.brand} ${p.name}${p.format ? ", " + p.format : ""}`; };
    const L = [`Mes courses du ${new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}, avec Cabas`];
    if (bst) {
      for (const o of bst.orders) {
        const r = S.retMap.get(o.ch.id), ch = r.channel || {};
        L.push("", `${r.name}${ch.where ? " (" + (pickup(r) ? "retrait à " : "livraison, ") + ch.where + ")" : ""}\u00a0: ${eurC(o.sub + o.fee)}${r.simulated ? ", prix simulés" : ""}`);
        o.items.forEach((x) => L.push(line(x.alt || x.l.id, x.l.q)));
      }
      if ((bst.completed || []).length) { L.push("", `En magasin\u00a0: ${eurC(bst.compTotal)}`); bst.completed.forEach((x) => L.push(line(x.alt || x.l.id, x.l.q) + ", chez " + retName(x.ret))); }
      if ((bst.skipped || []).length) { L.push("", "Hors commande"); bst.skipped.forEach((x) => L.push(line(x.l.id, x.l.q))); }
      L.push("", `Total\u00a0: ${eurC(fullTotal(bst))}, frais compris${st.full ? "" : ", sans les produits hors commande"}`);
    } else {
      L.push("");
      Object.keys(S.basket).filter((id) => S.prods.has(id)).forEach((id) => L.push(line(id, S.basket[id])));
    }
    const fr = freeList();
    if (fr.length) { L.push("", "À chercher\u00a0:"); fr.forEach((f) => L.push(`- ${f.q > 1 ? f.q + " x " : ""}${f.t}${f.ret ? " (" + freeWhere(f) + ")" : ""}${f.price > 0 ? ", " + eur(f.price) + " prix saisi par toi" : ""}`)); }
    return L.join("\n");
  }
  function shareList(L) {
    const items = Object.keys(L.items).filter((id) => S.prods.has(id)).map((id) => [id, L.items[id]]);
    const f = (L.free || []).slice(0, 20).map(([t, q]) => [String(t).slice(0, 60), Math.max(1, Math.min(99, q | 0))]);
    const url = location.origin + location.pathname + "#/partage/" + b64e(JSON.stringify(f.length ? { n: L.name, i: items, f } : { n: L.name, i: items }));
    shareText(L.name, `Ma liste «\u00a0${L.name}\u00a0» sur Cabas, ${plural(items.length + f.length, "produit", "produits")}`, url);
  }
  VIEWS.partage = (r) => {
    let L = null;
    try {
      const o = JSON.parse(b64d(r.id));
      L = { name: String(o.n || "Liste partagée").slice(0, 40), items: {}, free: [] };
      for (const [id0, q] of o.i || []) { const id = S.prods.has(id0) ? id0 : (S.alias || {})[id0]; if (id && S.prods.has(id) && q > 0) L.items[id] = Math.min(99, (L.items[id] || 0) + (q | 0)); }
      /* lignes libres : du texte, borné, jamais plus de vingt */
      for (const [t, q] of Array.isArray(o.f) ? o.f.slice(0, 20) : []) { const tx = String(t || "").trim().slice(0, 60); if (tx && q > 0) L.free.push([tx, Math.min(99, q | 0)]); }
    } catch (err) { L = null; }
    if (!L || (!Object.keys(L.items).length && !L.free.length)) return { title: "Liste partagée", html: `<div class="empty" role="alert">${emptyArt("list")}<h1 class="t1">Ce lien de liste est illisible</h1><p>Il est incomplet, ou ses produits ne sont plus au catalogue.</p><a class="btn" href="#/listes">Voir mes listes</a></div>` };
    S.shared = L;
    const e = estimate(L.items);
    return {
      title: L.name, grouped: true,
      html: `<h1 class="lt">${esc(L.name)}</h1><p class="lt-sub">Liste partagée, ${plural(e.n, "produit", "produits")}${L.free.length ? " et " + plural(L.free.length, "ligne libre", "lignes libres") : ""}${e.n ? ", environ " + eur(e.t) + " au meilleur prix" : ""}</p>` +
        `<div class="pad btns" style="padding-top:6px"><button class="btn" type="button" data-act="addshared">${ic("plus")}Tout ajouter au panier</button><button class="btn tint" type="button" data-act="keepshared">Enregistrer dans mes listes</button></div>` +
        (e.n ? `<h2 class="gh">Produits</h2><div class="group">${itemsList(L.items)}</div>` : "") + listFreeHtml(L),
    };
  };

  /* ---------- taille du texte ---------- */
  /* Cinq crans par la taille de police racine (html[data-text]) : les textes en rem suivent, le chrome, les gouttières
     et les cibles en px ne suivent pas. Les valeurs déjà enregistrées (« 1.12 », « 1.25 ») restent valables. */
  const ZOOMS = [["0.82", "Très petite"], ["0.9", "Petite"], ["1", "Normale"], ["1.12", "Grande"], ["1.25", "Très grande"]];
  const ZOOM_OLD = { "0.8": "0.82", "0.88": "0.9" };
  const zoomIndex = () => { let v = String(S.prefs.zoom || "1"); v = ZOOM_OLD[v] || v; const i = ZOOMS.findIndex(([k]) => k === v); return i < 0 ? 2 : i; };
  /* taille du texte, thème, contraste renforcé et mode confort : boot.js les pose avant le premier rendu (html[data-text],
     [data-theme], [data-contrast], [data-simple]) et les repose ici à chaque changement de réglage */
  function applyLook() {
    try { document.documentElement.style.zoom = ""; if (window.cabasLook) window.cabasLook(S.prefs); } catch (e) { /* sans effet */ }
  }
  /* « A moins / A plus » : une phrase d'exemple qui change de taille en direct, le nom du cran, cinq points */
  function tsizeHtml(labelId) {
    const i = zoomIndex();
    return `<div class="tsize" role="group" aria-labelledby="${labelId}"><p class="sample">Les prix de tes courses, livraison comprise.</p>` +
      `<button type="button" data-act="zoomdec" aria-label="Texte plus petit"${i === 0 ? ' aria-disabled="true"' : ""}>A</button>` +
      `<div><div class="cur" aria-live="polite">${ZOOMS[i][1]}</div><div class="dots" aria-hidden="true">${ZOOMS.map((_, k) => `<i${k === i ? ' class="on"' : ""}></i>`).join("")}</div></div>` +
      `<button type="button" data-act="zoominc" aria-label="Texte plus grand"${i === ZOOMS.length - 1 ? ' aria-disabled="true"' : ""}>A</button></div>`;
  }
  function tsizeSync() {
    const i = zoomIndex();
    $$(".tsize").forEach((el) => {
      $(".cur", el).textContent = ZOOMS[i][1];
      $$(".dots i", el).forEach((d, k) => d.classList.toggle("on", k === i));
      const [dec, inc] = $$("button", el);
      if (i === 0) dec.setAttribute("aria-disabled", "true"); else dec.removeAttribute("aria-disabled");
      if (i === ZOOMS.length - 1) inc.setAttribute("aria-disabled", "true"); else inc.removeAttribute("aria-disabled");
    });
  }
  function setZoom(step) {
    const i = Math.max(0, Math.min(ZOOMS.length - 1, zoomIndex() + step));
    S.prefs.zoom = ZOOMS[i][0]; savePrefs(); applyLook(); tsizeSync();
  }
  /* thème (auto suit le téléphone), contraste renforcé (le réglage, sinon celui du téléphone) et mode confort */
  const THEMES = [["auto", "Auto"], ["light", "Clair"], ["dark", "Sombre"]];
  const themeOf = () => (THEMES.some(([k]) => k === S.prefs.theme) ? S.prefs.theme : "auto");
  const contrastOn = () => document.documentElement.getAttribute("data-contrast") === "more";
  const simpleOn = () => !!S.prefs.simple;
  function themeSeg(labelId, chips) {
    const cur = themeOf();
    if (chips) return `<div class="tagset" role="radiogroup" aria-labelledby="${labelId}">${THEMES.map(([k, l]) => `<button class="chip" type="button" role="radio" data-act="theme" data-v="${k}" aria-checked="${k === cur}">${l}</button>`).join("")}</div>`;
    return `<div class="seg" role="radiogroup" aria-labelledby="${labelId}">${THEMES.map(([k, l]) => `<button type="button" role="radio" data-act="theme" data-v="${k}" aria-checked="${k === cur}">${l}</button>`).join("")}</div>`;
  }
  /* Réglages > Affichage : taille du texte, thème, contraste renforcé, mode confort */
  function lookHtml() {
    const sw = (act, id, label, hint, on) => `<div class="row"><span class="rt" id="${id}">${label}<small>${hint}</small></span><label class="sw hit"><input type="checkbox" role="switch" data-act="${act}"${on ? " checked" : ""} aria-labelledby="${id}"><span></span></label></div>`;
    return `<div class="row stack"><span class="rt" id="tsizeL">Taille du texte</span>${tsizeHtml("tsizeL")}</div>` +
      `<div class="row stack"><span class="rt" id="themeL">Thème<small>Auto suit le réglage du téléphone, clair le jour et sombre le soir s'il le fait.</small></span>${themeSeg("themeL")}</div>` +
      sw("contrast", "contrastL", "Contraste renforcé", "Textes plus foncés, contours visibles sur les boutons et les champs, liens soulignés.", contrastOn()) +
      sw("simple", "simpleL", "Mode confort", "Boutons plus grands, une seule colonne, moins d'éléments par écran.", simpleOn());
  }

  /* ---------- premier lancement ---------- */
  /* Trois questions pour que les totaux ressemblent aux courses de chacun ; tout se change ensuite dans les réglages. */
  const SECTEURS = [["auchan", "Fontenay-sous-Bois, Le Perreux"], ["auchan-alesia", "Paris 14e"], ["auchan-bellesfeuilles", "Paris 16e"]];
  /* secteur Auchan des questions de départ : la phrase d'où vient le choix, puis les trois secteurs (un geste = à la main) */
  function sectHtml() {
    const G = groupsOf().auchan || [], pk = G.length ? pickOf("auchan", G) : "";
    return `<p class="gf" aria-live="polite">${esc(autoText("auchan"))}</p><div class="group" role="radiogroup" aria-labelledby="wsectL">${SECTEURS.map(([id, l]) => opt("wsect", esc(l), pk === id || (S.allMap.get(id) || {}).livraison === pk, `data-id="${id}"`, null, true)).join("")}</div>`;
  }
  function welcomeSheet() {
    const build = () => {
      const groups = new Map();
      for (const r of S.allRets || []) { const k = offKey(r); if (!groups.has(k)) groups.set(k, r); }
      const chips = [...groups.entries()].map(([k, r]) => `<button class="chip" type="button" data-act="wret" data-k="${esc(k)}" aria-pressed="${!S.prefs.off[k]}">${esc(r.name)}${r.simulated ? " (prix simulés)" : ""}</button>`).join("");
      const noComp = S.prefs.comp === false;
      return {
        body: `<p>Quelques questions pour que les totaux et les repas ressemblent à ta maison. Tout se change ensuite dans les réglages.</p>` +
          `<h3 class="gh" id="tsizeW">Tu vois bien ce texte\u00a0?</h3><div class="pad">${tsizeHtml("tsizeW")}</div>` +
          `<h3 class="gh" id="wzipL">Ton code postal\u00a0? (facultatif)</h3><div class="pad">${field("wzip", "Code postal", `type="text" inputmode="numeric" pattern="[0-9]*" maxlength="5" autocomplete="postal-code" enterkeyhint="done" placeholder="Par exemple 94120" value="${esc(S.prefs.zip)}"`, "Pour choisir le bon Auchan et vérifier qu'on te livre. Il reste sur ce téléphone.")}</div>` +
          `<h3 class="gh" id="wsectL">Ton secteur, pour les prix Auchan</h3><div id="wsect">${sectHtml()}</div>` +
          `<p class="gf">Les prix Auchan dépendent du magasin. Sans déplacement, Cabas prend la livraison à domicile du même secteur.</p>` +
          `<h3 class="gh" id="wretL">Où fais-tu tes courses\u00a0?</h3><div class="tagset" role="group" aria-labelledby="wretL">${chips}</div>` +
          `<h3 class="gh" id="wmoveL">Peux-tu te déplacer\u00a0?</h3><div class="group" role="radiogroup" aria-labelledby="wmoveL">${opt("wmove", "Oui, en magasin ou en point de retrait", !noComp, 'data-v="1"', null, true)}${opt("wmove", "Non, je veux tout recevoir chez moi", noComp, 'data-v="0"', null, true)}</div>` +
          `<h3 class="gh" id="wfoyerL">Combien de personnes à la maison\u00a0?</h3><div class="tagset" role="radiogroup" aria-labelledby="wfoyerL">${[1, 2, 3, 4, 5, 6].map((n) => `<button class="chip" type="button" role="radio" data-act="wfoyer" data-v="${n}" aria-checked="${(S.prefs.foyer || 0) === n}">${n}${n === 6 ? " et plus" : ""}</button>`).join("")}</div>` +
          `<h3 class="gh" id="wdietL">Tu suis un régime\u00a0? (facultatif)</h3><div class="tagset diet" role="group" aria-labelledby="wdietL">${DIETS.map(([k, l]) => `<button class="chip" type="button" data-act="wdiet" data-k="${k}" aria-pressed="${!!dietSet()[k]}">${l}</button>`).join("")}</div>` +
          `<h3 class="gh" id="wlookL">Pour lire et toucher plus facilement\u00a0? (facultatif)</h3><div class="tagset" role="group" aria-labelledby="wlookL"><button class="chip" type="button" data-act="wsimple" aria-pressed="${simpleOn()}">Mode confort</button><button class="chip" type="button" data-act="wcontrast" aria-pressed="${contrastOn()}">Contraste renforcé</button></div>` +
          `<p class="gf">Le mode confort agrandit les boutons et montre moins d'éléments à la fois\u00a0; le contraste renforcé fonce les textes et souligne les liens.</p>` +
          `<h3 class="gh" id="wthemeL">Clair ou sombre\u00a0?</h3>${themeSeg("wthemeL", true)}`,
        foot: `<button class="btn" type="button" data-act="wok">C'est parti</button>`,
      };
    };
    const o = build();
    /* à la fermeture, l'écran du dessous suit les réponses (enseignes, affichage) */
    openSheet({ title: "Bienvenue sur Cabas", right: `<button class="txtbtn" type="button" data-act="wskip">Passer</button>`, body: o.body, foot: o.foot, build, onClose: () => { S.seen.welcome = 1; store.set("seen", S.seen); applyGroups(); renderChrome(); rerender(); } });
  }

  /* ---------- budget ---------- */
  /* Budget par panier (le total affiché, frais compris) ou par mois (prefs.budgetMode « mois ») : les paniers commandés
     du mois (cabas.hist), au total payé quand tu l'as indiqué, sinon au total aux prix relevés, plus ce panier tant qu'il
     n'y est pas. Le total payé reste saisi par toi : il ne sert qu'à ce compte, jamais de prix relevé. */
  const budgetC = () => Math.round((parseFloat(S.prefs.budget) || 0) * 100);
  const byMonth = () => S.prefs.budgetMode === "mois";
  const monthName = (key) => { try { return new Date(key + "-15T12:00:00").toLocaleDateString("fr-FR", { month: "long" }); } catch (e) { return key; } };
  function monthSpend(at) {
    const key = isoDay(at ? new Date(at) : new Date()).slice(0, 7), rows = [];
    let spent = 0, typed = 0;
    (S.hist || []).forEach((h, hi) => {
      if (!h || !h.d || h.d.slice(0, 7) !== key) return;
      const os = (h.o || []).filter((x) => x && x.rid), paid = h.paid || {};
      let t = 0, own = 0;
      if (!os.length) { if (paid.all > 0) { t = paid.all; own = 1; } else t = h.t || 0; }
      else {
        let rel = 0;
        for (const o of os) { rel += o.t || 0; if (paid[o.rid] > 0) { t += paid[o.rid]; own++; } else t += o.t || 0; }
        /* achats en magasin du panier, aux prix relevés */
        t += Math.max(0, (h.t || 0) - rel);
      }
      spent += t; typed += own;
      rows.push({ hi, d: h.d, t, own, names: os.map((o) => o.name).filter(Boolean) });
    });
    return { month: key, spent, n: rows.length, typed, rows };
  }
  /* ce panier est-il déjà compté dans l'historique (toutes ses commandes passées) ? */
  const basketInHist = () => { const fs = snapOf(); return !!fs && S.guide.rec === fs.id && !stale(fs); };
  /* ce que ce panier peut coûter : le budget du panier, ou ce qu'il reste dans le mois avant lui */
  function basketLimit() {
    const bud = budgetC();
    if (!bud) return null;
    return byMonth() ? bud - monthSpend().spent + (basketInHist() ? cartTotal() || 0 : 0) : bud;
  }
  function budgetLine(money, complete) {
    const bud = budgetC();
    if (!bud) return "";
    const edit = `<button class="act" type="button" data-act="budget">Modifier${ic("chev")}</button>`, b = eurR(bud / 100);
    if (!complete) return `<div class="bud"><span class="bt">${byMonth() ? "Budget du mois " : "Budget "}${b}<small>Le compte se fait quand tout le panier se commande.</small></span><div class="bacts">${edit}</div></div>`;
    let left, txt, sub = "", used;
    if (byMonth()) {
      const m = monthSpend(), inH = basketInHist();
      used = m.spent + (inH ? 0 : money); left = bud - used;
      txt = left >= 0 ? `Budget du mois ${b}\u00a0: il te reste ${eurC(left)} ce mois-ci` : `Budget du mois ${b}\u00a0: dépassé de ${eurC(-left)}${inH ? "" : " avec ce panier"}`;
      sub = inH ? `${eurC(m.spent)} dépensés en ${monthName(m.month)}, ce panier compris` : m.n ? `${eurC(m.spent)} déjà dépensés en ${monthName(m.month)}, plus ce panier` : `Ce panier est le premier du mois`;
    } else { used = money; left = bud - money; txt = left >= 0 ? `Budget ${b}\u00a0: il reste ${eurC(left)}` : `Budget ${b}\u00a0: dépassé de ${eurC(-left)}`; }
    const fit = left < 0 && !basketInHist() ? `<button class="act" type="button" data-act="budfit">Tenir le budget${ic("chev")}</button>` : "";
    return `<div class="bud ${left >= 0 ? "ok" : "over"}"${left < 0 ? ' role="status"' : ""}><span class="bt">${txt}${sub ? `<small>${esc(sub)}</small>` : ""}</span><span class="prog thin" aria-hidden="true"><span style="width:${Math.max(2, Math.min(100, Math.round((100 * used) / bud)))}%"></span></span><div class="bacts">${fit}${edit}</div></div>`;
  }
  function budgetSheet() {
    S.budMode = byMonth() ? "mois" : "panier"; S.budDraft = null;
    const build = () => {
      const mo = S.budMode === "mois", m = monthSpend(), v = S.budDraft != null ? S.budDraft : frNum(S.prefs.budget);
      const rows = m.rows.slice().reverse().map((x) => `<div class="row"><span class="rt">${esc(dayFr(x.d))}<small>${x.names.length ? esc(joinEt(x.names)) + ", " : ""}${x.own ? "payé, saisi par toi" : "aux prix relevés"}</small></span><span class="val num">${eurC(x.t)}</span><button class="act" type="button" data-act="paid" data-id="${x.hi}" aria-label="${x.own ? "Modifier le total payé" : "Indiquer le total payé"} du ${esc(dayFr(x.d))}">${x.own ? "Modifier" : "Total payé"}</button></div>`).join("");
      return {
        body: `<p>${mo ? "Les paniers que tu commandes dans le mois s'additionnent\u00a0: le panier te dit ce qu'il te reste ce mois-ci." : "Le panier te dit ce qu'il reste, ou de combien tu dépasses, frais compris."} Laisse vide pour ne pas en avoir.</p>` +
          `<div class="pad"><div class="seg" role="radiogroup" aria-label="Budget"><button type="button" role="radio" data-act="budmode" data-v="panier" aria-checked="${!mo}">Par panier</button><button type="button" role="radio" data-act="budmode" data-v="mois" aria-checked="${mo}">Par mois</button></div></div>` +
          `<div style="padding-top:12px">${field("budIn", mo ? "Budget du mois, en euros" : "Budget par panier, en euros", `type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" placeholder="Par exemple ${mo ? "400" : "120"}" value="${esc(v)}"`, mo ? "Tes courses du mois, livraison comprise." : "Pour un panier, livraison comprise.", "€")}</div>` +
          (mo ? `<h3 class="gh">En ${esc(monthName(m.month))}</h3>${m.n ? `<div class="group">${rows}</div>` : ""}<p class="gf">${m.n ? `${eurC(m.spent)} sur ${plural(m.n, "panier commandé", "paniers commandés")}. Le total payé, quand tu l'indiques, remplace celui aux prix relevés\u00a0; il reste saisi par toi, à part des prix relevés.` : "Aucun panier commandé ce mois-ci. Un panier compte quand toutes ses commandes sont notées comme passées."}</p>` : ""),
      };
    };
    const o = build();
    openSheet({ title: "Budget", focus: "#budIn", right: `<button class="txtbtn primary" type="button" data-act="budok">OK</button>`, body: o.body, build });
  }
  /* Tenir le budget : les remplacements moins chers d'abord, chacun compté au total exact du panier avec lui (ex :
     identifiant remplacé vers ce total, livraison comprise ; sans ex, l'économie estimée au meilleur prix), les plus
     rentables jusqu'à combler le dépassement ; puis les produits qui pèsent le plus dans la répartition. limit et total
     en centimes. Le total exact avec tous les remplacements retenus se calcule à part (budgetFitSheet). */
  function budgetFit(limit, total, sw, ex) {
    const over = total - limit;
    if (!(over > 0)) return { over: 0, swaps: [], save: 0, cuts: [], enough: true };
    const gain = (x) => { if (!ex) return Math.round(x.save * 100); const t = ex.get(x.from.id); return t != null ? total - t : -1; };
    const cand = (sw || swaps()).map((x) => ({ x, g: gain(x) })).filter((c) => c.g > 0).sort((a, b) => b.g - a.g);
    const pick = [];
    let save = 0;
    for (const c of cand) { if (save >= over) break; pick.push(Object.assign({}, c.x, { gain: c.g })); save += c.g; }
    const st = RES.steps[RES.K], bst = st && (st.full || st.partial), cost = new Map();
    if (bst) { bst.orders.forEach((o) => o.items.forEach((x) => cost.set(x.l.id, x.cost))); (bst.completed || []).forEach((x) => cost.set(x.l.id, x.cost)); }
    const cuts = [...cost.entries()].filter(([id]) => S.basket[id] > 0 && !pick.some((x) => x.from.id === id)).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, c]) => ({ id, q: S.basket[id], cost: c }));
    return { over, swaps: pick, save, cuts, enough: save >= over, cands: cand.map((c) => Object.assign({}, c.x, { gain: c.g })) };
  }
  /* les remplacements retenus, un par un, chacun gardé seulement si le total exact du panier avec lui et les précédents
     baisse encore (la répartition, les achats en magasin et les minimums changent ensemble) ; wait : un calcul manque */
  function fitChain(res, total, lim, cand) {
    let chosen = [], cur = total;
    for (const c of cand) {
      if (cur <= lim) break;
      const set = chosen.concat([c]), key = `b|${res.mode}|${res.K}|${set.map((x) => x.from.id + ">" + x.to.id).join(",")}`;
      auxAsk([{ key, M: () => model(res.mode, { basket: swapBasket(set) }), K: res.K }]);
      const r = auxGet(key);
      if (r === undefined) return { chosen, cur, wait: true };
      if (r && r.full && r.full.total < cur) { chosen = chosen.concat([Object.assign({}, c, { gain: cur - r.full.total })]); cur = r.full.total; }
    }
    return { chosen, cur, wait: false };
  }
  const swapBasket = (sw) => { const B = Object.assign({}, S.basket); sw.forEach((x) => { const q = B[x.from.id] || 0; delete B[x.from.id]; if (q) B[x.to.id] = Math.min(99, (B[x.to.id] || 0) + q); }); return B; };
  /* chaque remplacement possible, au total exact du panier avec lui (worker) ; ex vaut null tant qu'un calcul manque */
  function swapTotals(res) {
    const sw = swaps().slice(0, 8), ex = new Map(), key = (x) => `b1|${res.mode}|${res.K}|${x.from.id}|${x.to.id}`;
    auxAsk(sw.map((x) => ({ key: key(x), M: () => model(res.mode, { basket: swapBasket([x]) }), K: res.K })));
    for (const x of sw) { const r = auxGet(key(x)); if (r === undefined) return { sw, ex: null }; ex.set(x.from.id, r && r.full ? r.full.total : null); }
    return { sw, ex };
  }
  function budgetFitSheet() {
    const build = () => {
      const res = cartResult(), total = res.done ? cartTotal() : null, lim = basketLimit();
      if (total == null || lim == null) return { body: `<p>${res.done ? "Le compte se fait quand tout le panier se commande." : "Calcul du total…"}</p>`, foot: "" };
      const what = byMonth() ? "ce qu'il te reste pour le mois" : "ton budget";
      if (total <= lim) return { body: `<p>Ton panier tient dans ${what}\u00a0: il reste ${eurC(lim - total)}.</p>`, foot: "" };
      const T = swapTotals(res), F = budgetFit(lim, total, T.sw, T.ex || new Map()), C = T.ex ? fitChain(res, total, lim, F.cands) : null;
      let swHtml = `<h3 class="gh">Remplacer par moins cher</h3>`;
      if (!C || (C.wait && !C.chosen.length)) swHtml += `<p class="gf">Calcul de chaque remplacement, livraison comprise…</p>`;
      else if (C.chosen.length) {
        swHtml += `<div class="group">${C.chosen.map((w) => `<div class="row th"><span class="thumb">${img(w.to, 48)}</span><span class="rt"><b>${esc(w.to.brand)}</b> ${esc(w.to.name)}<small>au lieu de ${esc(pname(w.from))}\u00a0: ${eurC(w.gain)} de moins, livraison comprise</small></span></div>`).join("")}</div>` +
          `<p class="gf" aria-live="polite">${C.wait ? "Calcul d'autres remplacements…" : `Avec ${C.chosen.length > 1 ? "ces remplacements" : "ce remplacement"}\u00a0: ${eurC(C.cur)}, livraison comprise${C.cur <= lim ? ", dans " + what : `, encore ${eurC(C.cur - lim)} de trop`}.`}</p>` +
          (C.wait ? "" : `<div class="pad" style="padding-top:10px"><button class="btn tint" type="button" data-act="budswap">Remplacer ${plural(C.chosen.length, "produit", "produits")}</button></div>`);
      } else swHtml += `<p class="gf">Aucun remplacement ne fait baisser le total du panier, livraison comprise.</p>`;
      return {
        body: `<p>Ce panier dépasse ${what} de <b>${eurC(total - lim)}</b>.</p>` + swHtml +
          (F.cuts.length ? `<h3 class="gh">Ce qui pèse le plus</h3><div class="order inset">${F.cuts.map((c) => itemRow(c.id, c.cost, c.q)).join("")}</div><p class="gf">Un exemplaire de moins, ou un produit retiré\u00a0: le total se recalcule, livraison comprise.</p>` : ""),
        foot: `<div class="swfoot"><span aria-live="polite">Total du panier\u00a0: <b>${eurC(total)}</b>, pour ${eurC(lim)}</span></div>`,
      };
    };
    const o = build();
    openSheet({ title: "Tenir le budget", body: o.body, foot: o.foot, build, aux: true, onClose: () => { if (S.route.name === "panier") rerender(); } });
  }

  /* ---------- courses en magasin ---------- */
  /* ---------- mode magasin et impression ---------- */
  /* #/magasin : la liste à cocher en marchant, rangée par univers puis dans l'ordre des rayons, en gros caractères ;
     « À acheter en magasin » (les produits que tes commandes ne prennent pas) ou « Tout le panier » (lignes libres
     comprises). L'écran reste allumé quand le navigateur le permet (prefs.wake, Screen Wake Lock), le scanner coche ce
     qu'il reconnaît, et la page s'imprime proprement (feuille d'impression de app.css). Coches : cabas.guide.ck « mag|… ». */
  function storeMag() {
    const fs = snapOf(), st = RES.steps[RES.K], bst = st && (st.full || st.partial);
    const c = fs && fillUsable() ? magOf(fs).map((x) => ({ id: x.id, q: x.q, cost: x.cost, ret: x.ret })) : ((bst && bst.completed) || []).map((x) => ({ id: x.alt || x.l.id, q: x.l.q, cost: x.cost, ret: x.ret }));
    return c.filter((x) => S.prods.has(x.id));
  }
  function storeItems(mode) {
    if (mode === "mag") return storeMag();
    const out = Object.keys(S.basket).filter((id) => S.basket[id] > 0 && S.prods.has(id)).map((id) => { const b = best(S.prods.get(id)); return { id, q: S.basket[id], cost: b ? Math.round(b.price * 100) * S.basket[id] : 0, ret: b ? b.ret : "", sim: !!(b && b.sim) }; });
    return out.concat(freeList().map((f) => ({ fid: f.fid, t: f.t, q: f.q, free: true })));
  }
  /* « À acheter en magasin » d'office quand la répartition en a, sinon tout le panier */
  const storeMode = () => (S.storeMode !== "all" && storeMag().length ? "mag" : "all");
  const storeKey = (x) => "mag|" + (x.free ? "f:" + x.fid : x.id);
  const storeOrder = (x) => { if (x.free) return 1e9; const p = S.prods.get(x.id), ri = S.rayons.findIndex((r) => r.id === p.r), u = S.univers.findIndex((v) => v.id === (rayon(p.r) || {}).u); return (u < 0 ? 99 : u) * 1e6 + (ri < 0 ? 9999 : ri) * 10; };
  /* l'écran allumé : demandé à l'ouverture du mode magasin, rendu en le quittant, redemandé au retour dans l'appli */
  let wakeL = null;
  const wakeOK = () => "wakeLock" in navigator;
  async function wakeOn() {
    if (!wakeOK() || S.prefs.wake === false || S.route.name !== "magasin" || document.visibilityState !== "visible" || wakeL) return;
    try { const l = await navigator.wakeLock.request("screen"); if (S.route.name !== "magasin") { l.release(); return; } wakeL = l; l.addEventListener("release", () => { if (wakeL === l) wakeL = null; }); } catch (e) { wakeL = null; }
  }
  function wakeOff() { const l = wakeL; wakeL = null; if (l) l.release().catch(() => { /* déjà rendu */ }); }
  function storeRow(x) {
    const on = !!S.guide.ck[storeKey(x)];
    if (x.free) return `<button class="gi big${on ? " on" : ""}" type="button" role="checkbox" aria-checked="${on}" data-act="shopck" data-f="${esc(x.fid)}"><span class="box">${ic("check")}</span><span class="gt"><b>${x.q > 1 ? `<span class="gq">${x.q} ×</span> ` : ""}${esc(x.t)}</b><small>Ligne libre${S.free[x.fid] && S.free[x.fid].price > 0 ? ", " + esc(eur(S.free[x.fid].price)) + " l'unité, prix saisi par toi" : ""}</small></span></button>`;
    const p = S.prods.get(x.id), ray = rayon(p.r);
    return `<button class="gi big${on ? " on" : ""}" type="button" role="checkbox" aria-checked="${on}" data-act="shopck" data-p="${esc(p.id)}"><span class="box">${ic("check")}</span><span class="gt"><b>${x.q > 1 ? `<span class="gq">${x.q} ×</span> ` : ""}${esc(p.brand)} ${esc(p.name)}</b><small>${esc(p.format)}${x.cost ? ", environ " + eurC(x.cost) + (x.ret ? " chez " + esc(retName(x.ret)) : "") + (x.sim ? " (prix simulé)" : "") : ""}${ray ? ", rayon " + esc(ray.name.toLowerCase()) : ""}</small></span></button>`;
  }
  VIEWS.magasin = () => {
    const mag = storeMag(), mode = storeMode(), L = storeItems(mode).sort((a, b) => storeOrder(a) - storeOrder(b));
    const k = L.filter((x) => S.guide.ck[storeKey(x)]).length, today = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    const groups = [];
    for (const x of L) { const u = x.free ? "Lignes libres" : univName((rayon(S.prods.get(x.id).r) || {}).u) || "Autres"; const g = groups[groups.length - 1]; if (g && g.u === u) g.xs.push(x); else groups.push({ u, xs: [x] }); }
    const seg = mag.length && count() ? `<div class="pad noprint"><div class="seg" role="radiogroup" aria-label="Liste affichée"><button type="button" role="radio" data-act="storemode" data-v="mag" aria-checked="${mode === "mag"}">À acheter en magasin</button><button type="button" role="radio" data-act="storemode" data-v="all" aria-checked="${mode === "all"}">Tout le panier</button></div></div>` : "";
    const done = L.length && k === L.length;
    return {
      title: "En magasin", grouped: true,
      mount: () => { wakeOn(); },
      html: `<div class="store"><h1 class="lt">En magasin</h1><p class="lt-sub noprint">Coche en marchant : les produits sont rangés par rayon.</p><p class="print-only">Mes courses du ${esc(today)}, avec Cabas</p>` + seg +
        (L.length ? `<div class="prog noprint" role="progressbar" aria-valuemin="0" aria-valuemax="${L.length}" aria-valuenow="${k}" aria-valuetext="${k} sur ${plural(L.length, "produit", "produits")}"><span style="width:${Math.round((100 * k) / L.length)}%"></span></div><p class="progl noprint${done ? " done" : ""}" aria-live="polite">${done ? ic("check") : ""}${done ? "Tout est dans ton panier" : `${k} sur ${plural(L.length, "produit", "produits")}`}</p>` +
          groups.map((g) => `<h2 class="gh">${esc(g.u)}</h2><div class="group">${g.xs.map(storeRow).join("")}</div>`).join("") +
          `<p class="gf">${mode === "mag" ? "Ce sont les produits que tes commandes ne prennent pas. " : ""}Prix relevés en ligne : en magasin, ils peuvent être un peu différents.</p>` +
          `<div class="pad btns noprint" style="padding-top:18px"><button class="btn tint" type="button" data-act="storescan">${ic("scan")}Scanner un produit</button><button class="btn ghost" type="button" data-act="print">Imprimer la liste</button>${speakBtn("magasin", "Écouter ce qu'il reste", "btn ghost")}</div>` +
          `<h2 class="gh noprint">Réglages du mode magasin</h2><div class="group noprint">${wakeOK() ? `<div class="row"><span class="rt" id="wakeL">Garder l'écran allumé<small>Tant que cette page est ouverte, l'écran ne se met pas en veille.</small></span><label class="sw hit"><input type="checkbox" role="switch" data-act="wake" aria-labelledby="wakeL"${S.prefs.wake !== false ? " checked" : ""}><span></span></label></div>` : `<div class="row"><span class="rt">Écran allumé<small>Ton navigateur ne peut pas garder l'écran allumé : touche-le de temps en temps.</small></span></div>`}${k ? `<button class="row link" type="button" data-act="storereset">Tout décocher</button>` : ""}</div>` +
          `<p class="print-only">${esc(freshText())}.</p>`
          : `<div class="empty">${emptyArt("bag")}<h2>Rien à acheter en magasin</h2><p>Ajoute des produits à ton panier, ou écris ta liste : ils s'afficheront ici, rangés par rayon.</p><a class="btn tint" href="#/ecrire">${ic("pen")}Écrire ma liste</a></div>`) + `</div>`,
    };
  };

  /* ---------- tes données : sauvegarde, restauration, transfert ---------- */
  /* Tout ce que Cabas garde est dans ce navigateur (clés cabas.*). Une copie s'enregistre en fichier JSON (packState),
     se restaure depuis ce fichier, ou passe d'un téléphone à l'autre par un lien #/transfert/<x> : les données sont
     dans le lien lui-même, après le #, que le navigateur n'envoie à aucun serveur. Tout ce qui arrive est vérifié
     (importCheck : clés connues, types, tailles) et ne remplace rien sans confirmation, avec « Annuler ». */
  const DKEYS = ["basket", "lists", "prefs", "free", "flex", "hist", "menu", "todo", "seen", "recent", "guide", "draft", "seenp", "drops", "ups", "seenAt", "univ", "prepSnooze", "watch", "watchHits", "reports"];
  /* le lien ne porte que l'essentiel : pas de remplissage en cours, de brouillon ni de mémoire des prix vus */
  const XKEYS = ["basket", "lists", "prefs", "free", "flex", "hist", "menu", "todo", "seen", "recent", "watch"];
  function packState(keys) {
    const data = {};
    for (const k of keys || DKEYS) { const v = store.get(k, undefined); if (v !== undefined && v !== null) data[k] = v; }
    if (!keys && data.hist) data.hist = data.hist.slice(-200);
    if (keys && data.hist) data.hist = data.hist.slice(-60);
    return { app: "cabas", v: 1, at: new Date().toISOString(), data };
  }
  const b64u = (u8) => { let b = ""; for (let i = 0; i < u8.length; i += 0x8000) b += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
  const u8b = (s) => { const b = atob(String(s).replace(/-/g, "+").replace(/_/g, "/")), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
  const zipOK = () => typeof CompressionStream === "function" && typeof DecompressionStream === "function";
  async function pipeBytes(u8, stream) { return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(stream)).arrayBuffer()); }
  /* « z » + JSON compressé (deflate-raw) quand le navigateur sait le faire, sinon « j » + JSON */
  async function packLink(state) {
    const raw = new TextEncoder().encode(JSON.stringify(state || packState(XKEYS)));
    if (zipOK()) { try { return "z" + b64u(await pipeBytes(raw, new CompressionStream("deflate-raw"))); } catch (e) { /* compression refusée : lien non compressé */ } }
    return "j" + b64u(raw);
  }
  async function unpackState(x) {
    try {
      x = String(x || "");
      if (x.length > 600000) return null;
      let bytes = u8b(x.slice(1));
      if (x[0] === "z") { if (!zipOK()) return null; bytes = await pipeBytes(bytes, new DecompressionStream("deflate-raw")); }
      else if (x[0] !== "j") return null;
      if (bytes.length > 4000000) return null;
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) { return null; }
  }
  /* vérification de ce qui arrive : forme de chaque clé, bornes, aucune clé inconnue gardée ; renvoie les données
     nettoyées, ce qui a été écarté, et un résumé pour la confirmation */
  function importCheck(obj) {
    const errs = [], data = {}, skip = [];
    const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
    const safeK = (k) => typeof k === "string" && k.length > 0 && k.length <= 200 && !/^(__proto__|constructor|prototype)$/.test(k);
    const str = (v, n) => typeof v === "string" && v.length <= n;
    const qty = (v) => Number.isInteger(v) && v >= 1 && v <= 99;
    const cents = (v) => Number.isInteger(v) && v >= 0 && v <= 10000000;
    const iso = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) && v.length <= 40;
    const items = (v) => { if (!isObj(v)) return null; const o = {}; for (const k of Object.keys(v).slice(0, 600)) if (safeK(k) && qty(v[k])) o[k] = v[k]; return o; };
    const map = (v, ok, n) => { if (!isObj(v)) return null; const o = {}; for (const k of Object.keys(v).slice(0, n || 2000)) if (safeK(k) && ok(v[k])) o[k] = v[k]; return o; };
    const json = (v, n) => { try { return JSON.stringify(v).length <= n; } catch (e) { return false; } };
    if (!isObj(obj) || obj.app !== "cabas" || !isObj(obj.data)) return { ok: false, errs: ["Ce n'est pas une copie de Cabas."], data, skip, sum: {} };
    if (obj.v !== 1) return { ok: false, errs: ["Cette copie vient d'une autre version de Cabas."], data, skip, sum: {} };
    const D = obj.data;
    const V = {
      basket: (v) => items(v),
      lists: (v) => (Array.isArray(v) ? v.slice(0, 100).filter((L) => isObj(L) && str(L.id, 40) && str(L.name, 80) && isObj(L.items)).map((L) => { const o = { id: L.id, name: L.name, items: items(L.items) || {}, at: iso(L.at) ? L.at.slice(0, 10) : isoDay(new Date()) }; if (Array.isArray(L.free)) o.free = L.free.slice(0, 20).filter((f) => Array.isArray(f) && str(f[0], 60) && qty(f[1])).map((f) => [f[0], f[1]]); if (L.template === true) o.template = true; if (isObj(L.cad)) o.cad = map(L.cad, (c) => [0, 14, 21, 28].includes(c), 600); return o; }) : null),
      prefs: (v) => {
        if (!isObj(v)) return null;
        const o = {};
        for (const k of Object.keys(v)) {
          const x = v[k], d = PREFS0[k];
          if (!safeK(k)) continue;
          if (k === "zip") { if (typeof x === "string" && /^\d{0,5}$/.test(x)) o.zip = x; }
          else if (k === "foyer" || k === "maxOrders") { if (Number.isInteger(x) && x >= 0 && x <= 10) o[k] = x; }
          else if (k === "budget" || k === "extraCost") { if (typeof x === "number" && x >= 0 && x <= 100000) o[k] = x; }
          else if (k === "shopDay") { if (x === null || (Number.isInteger(x) && x >= 0 && x <= 6)) o.shopDay = x; }
          else if (k === "voice") { if (x === "slow" || x === "normal") o.voice = x; }
          else if (k === "theme") { if (["auto", "light", "dark"].includes(x)) o.theme = x; }
          else if (k === "budgetMode") { if (x === "panier" || x === "mois") o.budgetMode = x; }
          else if (k === "zoom") { if (typeof x === "string" && /^[01](\.\d{1,2})?$/.test(x)) o.zoom = x; }
          else if (k === "contrast") { if (x === null || typeof x === "boolean") o.contrast = x; }
          else if (["comp", "wake", "simple", "manualCk", "badge", "facts"].includes(k)) { if (typeof x === "boolean") o[k] = x; }
          else if (k === "allergens") { if (Array.isArray(x)) o.allergens = [...new Set(x.filter((a) => typeof a === "string" && ALLERG.has(a)))]; }
          else if (k === "offv") { if (Number.isInteger(x) && x >= 0 && x <= 9) o.offv = x; }
          else if (isObj(d) || ["off", "fee", "pick", "pickManual", "liv", "keep", "usual", "qty1", "diet", "lead", "pin", "ban"].includes(k)) { if (isObj(x) && json(x, 200000)) { const m = map(x, (y) => ["string", "number", "boolean"].includes(typeof y) || (isObj(y) && json(y, 2000)), 3000); if (m) o[k] = m; } }
          else skip.push("prefs." + k);
        }
        return o;
      },
      free: (v) => map(v, (f) => isObj(f) && str(f.t, 60) && qty(f.q) && (f.price == null || (typeof f.price === "number" && f.price >= 0 && f.price <= 1000)) && (f.ret == null || str(f.ret, 40)), 200),
      flex: (v) => map(v, (a) => Array.isArray(a) && a.length <= 20 && a.every((x) => str(x, 200)), 600),
      hist: (v) => (Array.isArray(v) ? v.slice(-200).filter((h) => isObj(h) && iso(h.d) && cents(h.t) && (h.items == null || isObj(h.items)) && json(h, 60000)).map((h) => { const o = { d: h.d.slice(0, 10), t: h.t, s: cents(h.s) ? h.s : 0, n: Number.isInteger(h.n) && h.n >= 0 && h.n <= 10000 ? h.n : 0 }; if (h.items) o.items = items(h.items) || {}; if (Array.isArray(h.o)) o.o = h.o.slice(0, 12).filter((x) => typeof x === "string" ? x.length <= 60 : isObj(x) && str(x.rid, 60) && json(x, 30000)); if (Array.isArray(h.when)) o.when = h.when.slice(0, 12).filter((w) => isObj(w) && json(w, 1000)); if (isObj(h.paid)) o.paid = map(h.paid, cents, 20); if (isObj(h.arr)) o.arr = map(h.arr, (x) => str(x, 20), 20); if (isObj(h.miss)) o.miss = map(h.miss, (x) => Array.isArray(x) && x.length <= 200 && x.every((y) => str(y, 200)), 20); if (str(h.sid, 40)) o.sid = h.sid; return o; }) : null),
      menu: (v) => (Array.isArray(v) ? v.slice(0, 40).filter((m) => isObj(m) && str(m.id, 80) && Number.isInteger(m.portions) && m.portions >= 1 && m.portions <= 40).map((m) => ({ id: m.id, portions: m.portions })) : null),
      todo: (v) => (Array.isArray(v) ? v.slice(0, 200).filter((x) => isObj(x) && str(x.id, 200) && qty(x.q)).map((x) => ({ id: x.id, q: x.q, from: str(x.from, 60) ? x.from : "", at: iso(x.at) ? x.at.slice(0, 10) : isoDay(new Date()) })) : null),
      seen: (v) => (isObj(v) && json(v, 20000) ? map(v, (x) => ["number", "boolean"].includes(typeof x) || (isObj(x) && json(x, 5000)), 100) : null),
      recent: (v) => (Array.isArray(v) ? v.filter((x) => str(x, 80)).slice(0, 20) : null),
      guide: (v) => (isObj(v) && json(v, 400000) ? Object.assign({ ck: {}, done: {} }, map(v, (x) => isObj(x) || typeof x === "string" || typeof x === "number" || x === null, 40)) : null),
      draft: (v) => (str(v, 4000) ? v : null),
      seenp: (v) => map(v, (x) => typeof x === "number" && x >= 0 && x < 100000, 5000),
      drops: (v) => (Array.isArray(v) ? v.slice(0, 20).filter((d) => isObj(d) && str(d.id, 200) && typeof d.old === "number" && typeof d.now === "number" && iso(d.until)) : null),
      ups: (v) => (Array.isArray(v) ? v.slice(0, 20).filter((d) => isObj(d) && str(d.id, 200) && typeof d.old === "number" && typeof d.now === "number" && iso(d.until)) : null),
      seenAt: (v) => (str(v, 40) ? v : null),
      univ: (v) => map(v, (x) => typeof x === "boolean", 40),
      prepSnooze: (v) => (str(v, 12) ? v : null),
      watch: (v) => map(v, (w) => isObj(w) && cents(w.max) && w.max > 0 && (w.from == null || cents(w.from)) && (w.at == null || iso(w.at)), 300),
      watchHits: (v) => map(v, (h) => isObj(h) && cents(h.c) && (h.ret == null || str(h.ret, 40)) && (h.seen == null || typeof h.seen === "boolean"), 300),
      reports: (v) => (Array.isArray(v) ? v.slice(-50).filter((r) => isObj(r) && str(r.id, 40) && iso(r.at) && str(r.k, 20) && (r.pid == null || str(r.pid, 200)) && (r.ret == null || str(r.ret, 40)) && (r.text == null || str(r.text, 500))).map((r) => ({ id: r.id, at: r.at, k: r.k, pid: r.pid || "", ret: r.ret || "", text: r.text || "", sent: iso(r.sent) ? r.sent : undefined })) : null),
    };
    for (const k of Object.keys(D)) {
      if (!V[k]) { skip.push(k); continue; }
      const c = V[k](D[k]);
      if (c == null) errs.push(k); else data[k] = c;
    }
    const sum = { basket: Object.keys(data.basket || {}).length, lists: (data.lists || []).length, hist: (data.hist || []).length, free: Object.keys(data.free || {}).length, prefs: !!data.prefs, menu: (data.menu || []).length };
    const ok = Object.keys(data).length > 0;
    return { ok, errs: ok ? errs : errs.concat(["Cette copie ne contient rien à restaurer."]), data, skip, sum, at: iso(obj.at) ? obj.at : "" };
  }
  /* ce que la copie contient, en clair */
  function importSum(R) {
    const s = R.sum, parts = [];
    if (s.basket) parts.push(plural(s.basket, "produit au panier", "produits au panier"));
    if (s.lists) parts.push(plural(s.lists, "liste", "listes"));
    if (s.hist) parts.push(plural(s.hist, "panier commandé", "paniers commandés"));
    if (s.free) parts.push(plural(s.free, "ligne libre", "lignes libres"));
    if (s.menu) parts.push(plural(s.menu, "repas", "repas"));
    if (s.prefs) parts.push("tes réglages");
    return parts.length ? joinEt(parts) : "rien à restaurer";
  }
  /* l'état de l'appli relu depuis le stockage (après une restauration ou son « Annuler ») */
  function reloadState() {
    const pr = store.get("prefs", {});
    S.basket = store.get("basket", {}); S.lists = store.get("lists", []); S.recent = store.get("recent", []); S.seen = store.get("seen", {});
    S.hist = store.get("hist", []); S.menu = store.get("menu", []); S.todo = store.get("todo", []); S.free = store.get("free", {}); S.flex = store.get("flex", {});
    S.guide = Object.assign({ ck: {}, done: {} }, store.get("guide", {}));
    S.prefs = Object.assign({}, PREFS0, { off: {}, fee: {}, pick: {}, pickManual: {}, liv: {}, keep: {}, usual: {}, qty1: {}, diet: {}, lead: {}, pin: {}, ban: {}, allergens: [] }, pr);
    S.wl = null; S.undo = null; S._sug = null; S._ask = null; S._compose = null; S.filt = {}; DIETV.v++; RECM = null; S.facts = null; S.compose = null;
    applyLook(); applyGroups(); renderChrome();
  }
  /* remplace les données de l'appareil ; « Annuler » remet exactement ce qu'il y avait */
  function applyImport(data, how) {
    const before = {};
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith("cabas.")) before[k] = localStorage.getItem(k); } } catch (e) { /* stockage indisponible */ }
    try {
      Object.keys(before).forEach((k) => localStorage.removeItem(k));
      for (const k of Object.keys(data)) localStorage.setItem("cabas." + k, JSON.stringify(data[k]));
    } catch (e) { toast("Le stockage de ce navigateur est plein ou bloqué\u00a0: rien n'a changé"); Object.keys(before).forEach((k) => { try { localStorage.setItem(k, before[k]); } catch (er) { /* rien */ } }); return false; }
    reloadState();
    const restore = () => { try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith("cabas.")) localStorage.removeItem(k); } Object.keys(before).forEach((k) => localStorage.setItem(k, before[k])); } catch (e) { /* stockage indisponible */ } reloadState(); };
    S.tab = "accueil"; S.stacks = { accueil: ["#/"], rayons: ["#/rayons"], recherche: ["#/recherche"], listes: ["#/listes"], panier: ["#/panier"] };
    history.replaceState(null, "", location.pathname + "#/");
    navigate("#/", "tab");
    undoable(how, restore, 10000);
    return true;
  }
  function exportFile() {
    const st = packState(), name = `cabas-${isoDay(new Date())}.json`;
    const blob = new Blob([JSON.stringify(st, null, 1)], { type: "application/json" }), url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast("Copie enregistrée\u00a0: " + name, null, "check");
  }
  function importSheet(R, how) {
    S.imp = R;
    openSheet({
      title: R.ok ? "Remplacer tes données\u00a0?" : "Copie illisible",
      body: R.ok ? `<p>${R.at ? `Copie faite ${esc(whenFr(R.at))}` : "Cette copie"}\u00a0: ${esc(importSum(R))}.</p><p>Elle remplacera le panier, les listes, l'historique et les réglages de cet appareil. Tu pourras annuler juste après.</p>${R.errs.length || R.skip.length ? `<p class="hint">Certaines parties, abîmées ou inconnues, sont laissées de côté.</p>` : ""}`
        : `<p>${esc(R.errs[0] || "Ce fichier n'est pas une copie de Cabas.")}</p><p>Choisis le fichier enregistré par «\u00a0Enregistrer une copie\u00a0» (cabas-date.json).</p>`,
      foot: R.ok ? `<button class="btn plain" type="button" data-act="close">Garder mes données</button><button class="btn" type="button" data-act="impok" data-k="${esc(how)}">Remplacer</button>` : `<button class="btn" type="button" data-act="close">OK</button>`,
    });
  }
  function dataHtml() {
    return `<h2 class="gh">Tes données</h2><div class="group">` +
      `<button class="row" type="button" data-act="export"><span class="rt">Enregistrer une copie<small>Un fichier avec ton panier, tes listes, tes paniers commandés et tes réglages</small></span>${ic("chev", "chev")}</button>` +
      `<button class="row" type="button" data-act="import"><span class="rt">Restaurer une copie<small>Depuis un fichier enregistré par Cabas</small></span>${ic("chev", "chev")}</button>` +
      `<button class="row" type="button" data-act="xfer"><span class="rt">Envoyer vers un autre téléphone<small>Un lien à ouvrir sur l'autre téléphone, sans compte ni serveur</small></span>${ic("share", "chev")}</button>` +
      `</div><input type="file" id="impIn" accept=".json,application/json" hidden><p class="gf">Tout reste sur cet appareil. Le lien contient tes données elles-mêmes\u00a0: envoie-le seulement à toi.</p>`;
  }
  /* #/transfert/<x> : ce qui arrive d'un autre téléphone, vérifié, puis remplacé seulement si tu le confirmes */
  VIEWS.transfert = (r) => {
    const X = S.xfer && S.xfer.id === r.id ? S.xfer : (S.xfer = { id: r.id, st: "wait", R: null });
    if (X.st === "wait" && !X.p) X.p = unpackState(r.id).then((o) => { X.R = o ? importCheck(o) : null; X.st = X.R && X.R.ok ? "ok" : "bad"; if (S.route.name === "transfert") rerender(); });
    const R = X.R;
    return {
      title: "Transfert", grouped: true,
      html: `<h1 class="lt">Données d'un autre téléphone</h1>` + (X.st === "wait" ? `<p class="lt-sub" role="status">Lecture du lien…</p>` :
        X.st === "bad" ? `<div class="empty" role="alert">${emptyArt("info")}<h2>Ce lien est illisible</h2><p>Il est incomplet ou abîmé (un message trop long peut couper un lien). Enregistre plutôt une copie en fichier sur l'autre téléphone, puis restaure-la ici.</p><a class="btn tint" href="#/">Retour à l'accueil</a></div>` :
        `<p class="lt-sub">${R.at ? "Envoyées " + esc(whenFr(R.at)) : "Envoyées depuis Cabas"}\u00a0: ${esc(importSum(R))}.</p><div class="banner warn" role="status">${ic("info")}<span><b>Elles remplaceront celles de ce téléphone</b>Le panier, les listes, l'historique et les réglages de ce téléphone seront remplacés. Tu pourras annuler juste après.</span></div>` +
          `<div class="pad btns" style="padding-top:16px"><button class="btn" type="button" data-act="xferok">Remplacer les données de ce téléphone</button><button class="btn ghost" type="button" data-act="xferno">Ne rien changer</button></div><p class="gf">Rien n'est passé par un serveur\u00a0: les données étaient dans le lien lui-même.</p>`),
    };
  };

  /* ---------- écouter ---------- */
  /* La liste, la répartition du panier ou ce qu'il reste à prendre en magasin, lus à voix haute par la synthèse vocale
     du téléphone (speechSynthesis, voix française, débit lent ou normal : prefs.voice). Rien ne quitte le téléphone. */
  const TTS = () => (window.speechSynthesis && typeof window.SpeechSynthesisUtterance === "function" ? window.speechSynthesis : null);
  const sayEur = (c) => { c = Math.round(c); const e = Math.floor(c / 100), ct = c % 100; return `${e} euro${e > 1 ? "s" : ""}${ct ? " " + ct : ""}`; };
  /* « 6 x 1 L » se dit « 6 fois 1 litre », « 500 g » « 500 grammes » */
  const sayFmt = (f) => String(f || "").replace(/(\d),(\d)/g, "$1 virgule $2").replace(/(\d)\s*[x×]\s*(\d)/gi, "$1 fois $2")
    .replace(/(\d)\s*(kg|g|cl|ml|l)\b\.?/gi, (m, d, u) => d + " " + ({ kg: "kilo", g: "grammes", cl: "centilitres", ml: "millilitres", l: "litre" })[u.toLowerCase()]);
  const sayItem = (p, q) => `${q > 1 ? q + " fois " : ""}${p.brand && p.brand !== "Sans marque" ? p.brand + ", " : ""}${p.name}${p.format ? ", " + sayFmt(p.format) : ""}`;
  /* le texte lu : « panier » (la répartition), « liste » (Ma liste), « list » (une liste enregistrée, id), « magasin » */
  function speakText(kind, id) {
    const out = [];
    if (kind === "panier") {
      const res = cartResult(), st = res.steps[res.K], bst = st && (st.full || st.partial), n = count();
      if (!n) return "Ton panier est vide.";
      if (!bst) return `Ton panier\u00a0: ${plural(n, "article", "articles")}, environ ${sayEur(Math.round(subtotal() * 100))} au meilleur prix de chaque produit. ${res.done ? "Il est trop petit pour une livraison." : ""}`.trim();
      out.push(`Ton panier\u00a0: ${plural(n, "article", "articles")}, ${bst.orders.length > 1 ? plural(bst.orders.length, "commande", "commandes") : "une commande"}, ${sayEur(fullTotal(bst))} livraison comprise.`);
      for (const o of bst.orders) {
        const r = S.retMap.get(o.ch.id) || { name: o.ch.id };
        out.push(`Chez ${r.name}, ${sayEur(o.sub + o.fee)}${o.fee ? ", dont " + sayEur(o.fee) + " de frais" : ", livraison offerte"}${r.simulated ? ", prix simulés" : ""}\u00a0: ${o.items.map((x) => sayItem(S.prods.get(x.alt || x.l.id), x.l.q)).join("\u00a0; ")}.`);
      }
      if ((bst.completed || []).length) out.push(`En magasin, ${sayEur(bst.compTotal)}\u00a0: ${bst.completed.map((x) => sayItem(S.prods.get(x.alt || x.l.id), x.l.q) + ", chez " + retName(x.ret)).join("\u00a0; ")}.`);
      if ((bst.skipped || []).length) out.push(`Hors commande\u00a0: ${bst.skipped.map((x) => sayItem(S.prods.get(x.l.id), x.l.q)).join("\u00a0; ")}.`);
    } else if (kind === "liste") {
      const L = (S.wl && S.wl.lines) || [], f = L.filter((x) => x.pick);
      out.push(`Ta liste\u00a0: ${plural(f.length, "produit trouvé", "produits trouvés")} sur ${L.length}.`);
      f.forEach((x) => { const p = S.prods.get(x.pick), b = best(p); out.push(`${x.raw}\u00a0: ${sayItem(p, x.n)}${b ? ", " + sayEur(Math.round(b.price * 100) * x.n) + " chez " + retName(b.ret) + (b.sim ? ", prix simulé" : "") : ""}.`); });
      const miss = L.filter((x) => !x.pick);
      if (miss.length) out.push(`Pas trouvé\u00a0: ${miss.map((x) => x.raw).join(", ")}.`);
    } else if (kind === "list") {
      const L = S.lists.find((x) => x.id === id);
      if (!L) return "";
      const ids = Object.keys(L.items).filter((x) => S.prods.has(x));
      out.push(`Liste ${L.name}\u00a0: ${plural(ids.length, "produit", "produits")}.`);
      ids.forEach((x) => out.push(sayItem(S.prods.get(x), L.items[x]) + "."));
      (L.free || []).forEach(([t, q]) => out.push(`${q > 1 ? q + " fois " : ""}${t}.`));
    } else if (kind === "magasin") {
      const L = storeItems(storeMode()).sort((a, b) => storeOrder(a) - storeOrder(b)), left = L.filter((x) => !S.guide.ck[storeKey(x)]);
      if (!left.length) return L.length ? "Tout est dans ton panier." : "Rien à acheter en magasin.";
      out.push(`Il te reste ${plural(left.length, "produit", "produits")}.`);
      let u = "";
      for (const x of left) {
        const g = x.free ? "Lignes libres" : univName((rayon(S.prods.get(x.id).r) || {}).u);
        out.push((g !== u ? g + "\u00a0: " : "") + (x.free ? `${x.q > 1 ? x.q + " fois " : ""}${x.t}` : sayItem(S.prods.get(x.id), x.q)) + ".");
        u = g;
      }
    }
    return out.join(" ").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }
  let speaking = null;
  function markSpeak(on) { $$('[data-act="speak"]').forEach((b) => { b.setAttribute("aria-pressed", String(on)); const l = b.querySelector(".sl2"); if (l) l.textContent = on ? "Arrêter la lecture" : l.dataset.l; }); }
  function speakStop() { const t = TTS(); speaking = null; if (t) t.cancel(); markSpeak(false); }
  function speak(text) {
    const tts = TTS();
    if (!tts || !text) return;
    if (speaking) { speakStop(); return; }
    tts.cancel();
    const u = new window.SpeechSynthesisUtterance(text), vs = tts.getVoices();
    u.lang = "fr-FR"; u.rate = S.prefs.voice === "slow" ? 0.8 : 1;
    const v = vs.find((x) => /^fr[-_]FR/i.test(x.lang) && x.localService) || vs.find((x) => /^fr[-_]FR/i.test(x.lang)) || vs.find((x) => /^fr/i.test(x.lang));
    if (v) u.voice = v;
    u.onend = u.onerror = () => { if (speaking === u) { speaking = null; markSpeak(false); } };
    speaking = u; markSpeak(true);
    tts.speak(u);
  }
  const speakBtn = (k, label, cls, id) => (TTS() ? `<button class="${cls || "btn tint"}" type="button" data-act="speak" data-k="${k}"${id ? ` data-id="${esc(id)}"` : ""} aria-pressed="false">${ic("speaker")}<span class="sl2" data-l="${esc(label)}">${esc(label)}</span></button>` : "");

  /* ---------- baisses de prix ---------- */
  /* À chaque nouveau relevé, les produits du panier et des listes sont comparés au prix vu la fois d'avant
     (prix relevés, pas simulés) ; une baisse d'au moins 3 % et 10 centimes reste affichée sept jours sur l'accueil. */
  function trackDrops() {
    const at = S.meta.updatedAt || "";
    if (!at || store.get("seenAt", "") === at) return;
    const seen = store.get("seenp", {}), drops = store.get("drops", []).filter((d) => d.until >= new Date().toISOString().slice(0, 10)), ups = store.get("ups", []).filter((d) => d.until >= new Date().toISOString().slice(0, 10));
    const ids = new Set(Object.keys(S.basket).concat(...S.lists.map((L) => Object.keys(L.items || {}))));
    const until = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    for (const id of ids) {
      const p = S.prods.get(id), b = p && bestReal(p);
      if (!b) continue;
      const old = seen[id];
      const drop = old && b.price <= old * 0.97 && old - b.price >= 0.1, up = old && b.price >= old * 1.03 && b.price - old >= 0.1;
      if (drop || up) { [drops, ups].forEach((L) => { const i = L.findIndex((d) => d.id === id); if (i >= 0) L.splice(i, 1); }); (drop ? drops : ups).unshift({ id, old, now: b.price, until }); }
      seen[id] = b.price;
    }
    /* hausses vues (cabas.ups) : dites sept jours, comme les baisses */
    store.set("seenp", seen); store.set("drops", drops.slice(0, 20)); store.set("ups", ups.slice(0, 20)); store.set("seenAt", at);
  }
  function dropsRail() {
    const today = new Date().toISOString().slice(0, 10);
    const ds = store.get("drops", []).filter((d) => d.until >= today && S.prods.has(d.id)).map((d) => { const p = S.prods.get(d.id), b = bestReal(p); return b && b.price < d.old ? { p, old: d.old, b } : null; }).filter(Boolean);
    const us = store.get("ups", []).filter((d) => d.until >= today && S.prods.has(d.id)).map((d) => { const p = S.prods.get(d.id), b = bestReal(p); return b && b.price > d.old ? { p, old: d.old, b } : null; }).filter(Boolean);
    /* seulement des hausses : une carte à la place de la rangée, vers « Ce qui a bougé » */
    if (!ds.length) return us.length ? `<a class="hcard" href="#/mouvements">${ic("info", "si")}<span><b>${us.length > 1 ? plural(us.length, "de tes produits a augmenté", "de tes produits ont augmenté") : "Un de tes produits a augmenté"}</b><small>${esc(joinEt(us.slice(0, 2).map((x) => pname(x.p))))}${us.length > 2 ? ", et d'autres" : ""}, d'après le dernier relevé.</small></span>${ic("chev", "chev")}</a>` : "";
    return `<div class="sh"><h2>Moins cher sur tes produits</h2><a class="act" href="#/mouvements">Ce qui a bougé${ic("chev")}</a></div><div class="rail" role="region" aria-label="Moins cher sur tes produits">${ds.map((d) => card(d.p, { was: d.old })).join("")}</div>`;
  }

  /* ---------- repas à petit prix ---------- */
  /* data/recettes.json : recettes simples. Chaque ingrédient est choisi comme une ligne de « Ma liste » (variante
     simple, format courant, le moins cher au kilo, au litre ou à la pièce), sur les prix relevés seulement, puis
     compté pour la quantité utilisée. Les ingrédients du placard (sel, épices) ne sont pas comptés. */
  /* le même ingrédient (« oeufs », « farine ») revient dans plusieurs recettes : cherché une fois par relevé et par réglage d'enseignes */
  const recKey = () => JSON.stringify([S.rets.map((r) => r.id), S.prefs.off, S.meta.updatedAt, S.list.length, S.prefs.diet || {}, DIETV.v]);
  let RECM = null;
  function recMatch(q) {
    const key = recKey();
    if (!RECM || RECM.key !== key) RECM = { key, map: new Map() };
    let m = RECM.map.get(q);
    if (!m) { m = matchLine({ raw: q, q: norm(q).split(" ").filter((t) => t && !STOP.has(t)).join(" "), n: 1, real: true }); RECM.map.set(q, m); }
    return m;
  }
  function recIng(g, k) {
    const m = recMatch(g.q);
    const need = g.need * k;
    if (!m.pick) return { g, need, p: null, off: m.cands.length > 0 };
    const p = S.prods.get(m.pick), b = bestReal(p), v = (p.qty && p.qty.v) || 0;
    const same = v && p.qty.u === g.u;
    const n = same ? Math.max(1, Math.ceil(need / v - 1e-9)) : 1;
    const used = same ? (b.price * need) / v : b.price;
    /* ingrédient qui ne correspond pas au régime (aucun produit conforme) : la recette le dit, elle reste ouvrable */
    return { g, need, p, b, n, used, buy: b.price * n, bad: !!m.dietMiss };
  }
  /* un ingrédient vraiment hors régime : un mot d'exclusion (viande, porc, alcool), un allergène connu, ou une étiquette
     qui manque (végan, sans gluten, halal...) quand la recette ne suit pas ce régime par nature ; du riz sans étiquette
     « végan » va dans un plat végan */
  const LABEL_DIETS = { vegan: ["veg", "vegan"], gluten: ["gluten"], lactose: ["lactose"], halal: ["veg", "alcohol"], kosher: ["veg", "alcohol"], sugar: ["-"] };
  function recBad(rc, x) {
    if (!x.p || !x.bad) return false;
    const d = dietSet();
    if (allergHit(x.p).length || !dietOk(x.p, { veg: d.veg || d.vegan, pork: d.pork || d.halal || d.kosher, alcohol: d.alcohol || d.halal || d.kosher })) return true;
    return Object.keys(LABEL_DIETS).some((k) => d[k] && !dietOk(x.p, { [k]: true }) && !LABEL_DIETS[k].every((t) => (rc.diet || []).includes(t)));
  }
  function recCost(rc, portions) {
    const k = (portions || rc.portions) / rc.portions;
    const lines = rc.ing.map((g) => recIng(g, k));
    const ok = lines.filter((x) => x.p), miss = lines.filter((x) => !x.p), bad = lines.filter((x) => recBad(rc, x));
    const used = ok.reduce((a, x) => a + x.used, 0), buy = ok.reduce((a, x) => a + x.buy, 0);
    return { lines, ok, miss, bad, used, buy, per: used / (portions || rc.portions), portions: portions || rc.portions };
  }
  /* coût de chaque recette pour les portions prévues, recalculé quand les enseignes ou le catalogue changent */
  function recs() {
    const key = recKey();
    if (S._recs && S._recs.key === key) return S._recs.list;
    const list = (S.recs || []).map((rc) => Object.assign({ c: recCost(rc) }, rc)).sort((a, b) => a.c.miss.length - b.c.miss.length || a.c.per - b.c.per);
    S._recs = { key, list };
    return list;
  }
  const fmtNeed = (v, u) => (u === "pc" ? String(Math.round(v * 10) / 10).replace(".", ",") : u === "ml" ? (v >= 100 ? String(Math.round(v / 10)).replace(".", ",") + NB + "cl" : Math.round(v) + NB + "ml") : v >= 1000 ? String(Math.round(v / 100) / 10).replace(".", ",") + NB + "kg" : Math.round(v) + NB + "g");
  function recCard(rc) {
    const c = rc.c, pics = c.ok.slice(0, 4).map((x) => `<span>${img(x.p, 44)}</span>`).join("");
    return `<a class="rcard${c.bad.length ? " off" : ""}" href="#/repas/${esc(rc.id)}"><div class="stack">${pics}</div><b>${esc(rc.name)}</b><span class="rp">${c.miss.length ? "Prix partiel" : eur(c.per) + " par portion"}</span><small>${c.bad.length ? "Pas pour ton régime" : `${plural(rc.portions, "portion", "portions")}, ${rc.minutes}${NB}min`}</small></a>`;
  }
  const recsReady = () => !!(S._recs && S._recs.key === recKey());
  function recRailHtml() {
    const rs = recs().filter((rc) => !rc.c.miss.length).slice(0, 8);
    return rs.length ? `<div class="sh"><h2>Repas à petit prix</h2><a class="act" href="#/repas">Tout voir${ic("chev")}</a></div><div class="rail rails" role="region" aria-label="Repas à petit prix">${rs.map(recCard).join("")}</div>` : "";
  }
  /* sur l'accueil, le coût des repas (chaque ingrédient cherché dans le catalogue) se calcule juste après le premier
     affichage, pour ne pas le retarder ; la rangée prend sa place dès que c'est prêt */
  let recTimer = 0;
  function recRail() {
    if (recsReady() || !(S.recs || []).length) return recRailHtml();
    if (!recTimer) recTimer = setTimeout(() => { recTimer = 0; recs(); const el = $("#recrail"); if (el) { el.outerHTML = recRailHtml(); markEnds(); } }, 0);
    /* en attendant, une rangée de la même hauteur : rien ne saute quand les prix arrivent */
    const sk = `<a class="rcard" aria-hidden="true"><div class="stack"><span></span><span></span><span></span></div><b class="skl"></b><span class="rp skl s"></span><small class="skl s"></small></a>`;
    return `<div id="recrail"><div class="sh"><h2>Repas à petit prix</h2><a class="act" href="#/repas">Tout voir${ic("chev")}</a></div><div class="rail rails" aria-busy="true">${sk.repeat(4)}</div></div>`;
  }
  VIEWS.repas = () => {
    const all = recs(), row = (rc) => {
      const c = rc.c, p0 = c.ok[0];
      return `<a class="row th${c.bad.length ? " off" : ""}" href="#/repas/${esc(rc.id)}"><span class="thumb">${p0 ? img(p0.p, 48) : ""}</span><span class="rt">${esc(rc.name)}<small>${c.miss.length ? `Prix partiel, ${plural(c.miss.length, "ingrédient pas encore", "ingrédients pas encore")} dans Cabas` : `${eur(c.per)} par portion`}, ${plural(rc.portions, "portion", "portions")}, ${rc.minutes}${NB}min${c.bad.length ? ". Pas pour ton régime" : ""}</small></span>${ic("chev", "chev")}</a>`;
    };
    const grp = (k, t) => { const xs = all.filter((rc) => rc.kind === k); return xs.length ? `<h2 class="gh">${t}</h2><div class="group">${xs.map(row).join("")}</div>` : ""; };
    return {
      title: "Repas à petit prix", grouped: true,
      html: `<h1 class="lt">Repas à petit prix</h1><p class="lt-sub">Le coût de chaque portion, au meilleur prix relevé de chaque ingrédient.</p>` +
        weekForm() + menuHtml() + grp("plat", "Plats") + grp("accompagnement", "Accompagnements") + grp("dessert", "Desserts et goûters") +
        `<p class="gf">Le coût compte la quantité utilisée de chaque produit. Les courses à faire, en paquets entiers, coûtent un peu plus, et il en restera pour une autre fois. Le sel, les épices et la levure ne sont pas comptés.</p>`,
    };
  };
  VIEWS.recette = (r) => {
    const rc = (S.recs || []).find((x) => x.id === r.id);
    if (!rc) return notFound("recette");
    /* portions : le dernier choix, sinon la taille du foyer (arrondie aux choix proposés), sinon celles de la recette */
    const foyer = S.prefs.foyer ? [2, 4, 6, 8].reduce((a, v) => (Math.abs(v - S.prefs.foyer) < Math.abs(a - S.prefs.foyer) ? v : a), 2) : 0;
    const P = (S.recP && S.recP[rc.id]) || foyer || rc.portions, c = recCost(rc, P), k = P / rc.portions;
    const line = (x) => {
      const q = k === 1 ? x.g.t : fmtNeed(x.need, x.g.u) + (x.g.u === "pc" ? " " + x.g.q.replace(/^oeufs$/, "œufs") : " de " + x.g.q);
      if (!x.p) return `<div class="row th"><span class="thumb q">${ic("search")}</span><span class="rt">${esc(q)}<small>${x.off ? "Pas vendu par tes enseignes" : "Pas encore dans Cabas"}</small></span></div>`;
      return `<a class="row th" href="${hp(x.p.id)}"><span class="thumb">${img(x.p, 48)}</span><span class="rt">${esc(q)}<small>${esc(x.p.brand + " " + x.p.name)}, ${esc(x.p.format)}, ${eur(x.b.price)} chez ${esc(retName(x.b.ret))}${x.n > 1 ? `, ${x.n} à acheter` : ""}${recBad(rc, x) ? ". Pas pour ton régime, d'après ce que l'enseigne indique" : ""}</small></span><span class="val num">${eur(x.used)}</span></a>`;
    };
    return {
      title: rc.name, grouped: true,
      html: `<h1 class="lt">${esc(rc.name)}</h1><p class="lt-sub">${REC_KIND[rc.kind] || "Plat"}, ${rc.minutes}${NB}min${(rc.diet || []).includes("vegan") ? ", végan" : (rc.diet || []).includes("veg") ? ", végétarien" : ""}</p>` +
        `<div class="sum rsum"><p class="sl">${c.miss.length ? "Coût des ingrédients comparés" : "Par portion"}</p><div class="st">${px(c.miss.length ? c.used : c.per)}</div>` +
        `<p class="sn">${c.miss.length ? `Pour ${plural(P, "portion", "portions")}, sans ${esc(joinEt(c.miss.map((x) => x.g.q)))}, pas encore dans Cabas.` : `${eur(c.used)} pour ${plural(P, "portion", "portions")}. Les courses, en paquets entiers, font ${eur(c.buy)}\u00a0: il en restera pour une autre fois.`}</p>` +
        `<p class="segl" id="portL">Portions</p><div class="seg" role="radiogroup" aria-labelledby="portL">${[2, 4, 6, 8].map((v) => `<button type="button" role="radio" data-act="recp" data-id="${esc(rc.id)}" data-v="${v}" aria-checked="${v === P}">${v}</button>`).join("")}</div>` +
        `<div class="btns two" style="margin-top:14px"><button class="btn" type="button" data-act="recadd" data-id="${esc(rc.id)}">${ic("plus")}Au panier</button><button class="btn tint" type="button" data-act="menuput" data-id="${esc(rc.id)}">${S.menu.some((m) => m.id === rc.id) ? "Dans ma semaine" : "Ajouter à ma semaine"}</button></div></div>` +
        `<h2 class="gh">Ingrédients</h2><div class="group">${c.lines.map(line).join("")}${rc.placard ? `<div class="row"><span class="rt">Du placard<small>${esc(rc.placard)}, pas comptés</small></span></div>` : ""}</div>` +
        `<p class="gf">Chaque produit est le moins cher au kilo, au litre ou à la pièce dans tes enseignes, selon les prix relevés. Touche-le pour en voir d'autres.</p>` +
        `<h2 class="gh">Préparation</h2><div class="group" style="padding:14px 0 6px"><ol class="steps">${rc.steps.map((s) => `<li><span>${tx(s)}</span></li>`).join("")}</ol></div>`,
    };
  };
  /* Ma semaine : plusieurs recettes, les ingrédients mis en commun (les œufs de trois recettes font une boîte) */
  const saveMenu = () => store.set("menu", S.menu);
  const menuRecs = () => S.menu.map((m) => { const rc = (S.recs || []).find((x) => x.id === m.id); return rc ? { rc, portions: m.portions || rc.portions } : null; }).filter(Boolean);
  function menuCost(list) {
    list = list || menuRecs();
    const need = new Map();
    for (const { rc, portions } of list) {
      const k = portions / rc.portions;
      for (const g of rc.ing) { const x = need.get(g.q) || { q: g.q, u: g.u, need: 0 }; x.need += g.need * k; need.set(g.q, x); }
    }
    const lines = [...need.values()].map((g) => recIng({ q: g.q, u: g.u, need: g.need, t: g.q }, 1));
    const ok = lines.filter((x) => x.p), miss = lines.filter((x) => !x.p);
    const portions = list.reduce((a, x) => a + x.portions, 0);
    return { lines, ok, miss, used: ok.reduce((a, x) => a + x.used, 0), buy: ok.reduce((a, x) => a + x.buy, 0), portions };
  }

  /* ---------- une semaine de repas à X € ---------- */
  /* Des plats variés (deux au plus par ingrédient principal, pas deux fois de suite), un accompagnement pour un plat qui
     ne se suffit pas (complete, de préférence ceux de with), le régime respecté par la recette (diet) et par chaque produit, les ingrédients mis en
     commun et comptés en paquets entiers, aux prix relevés. Chaque plat est pris pour ce qu'il ajoute au total : le
     paquet de pâtes entamé sert deux fois. Un plat dont un ingrédient manque au catalogue ne vient qu'en dernier, et le
     coût le dit. Au-delà du budget, la semaine la moins chère, puis moins de repas. o : { budget en centimes (0 sans),
     meals, people, seed (0 la moins chère, sinon une autre semaine) } */
  const REC_KIND = { plat: "Plat", accompagnement: "Accompagnement", dessert: "Dessert" };
  const DIET_TAGS = { veg: ["veg"], vegan: ["veg", "vegan"], pork: ["pork"], alcohol: ["alcohol"], gluten: ["gluten"], lactose: ["lactose"], halal: ["pork", "alcohol"], kosher: ["pork", "alcohol"] };
  const recFits = (rc) => { const d = dietSet(); return Object.keys(DIET_TAGS).every((k) => !d[k] || DIET_TAGS[k].every((t) => (rc.diet || []).includes(t))) && !recCost(rc).bad.length; };
  const jitter = (seed, id) => { if (!seed) return 0; let h = (seed * 2654435761) >>> 0; for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0; return (h % 1000) / 1000; };
  function composeOnce(o, meals, P) {
    /* ce qu'une ou deux recettes ajoutent aux courses déjà prévues (centimes), produit par produit, paquets entiers */
    const need = new Map();
    const pk = (q) => { if (!P.M.has(q)) { const m = recMatch(q), p = m.pick && S.prods.get(m.pick), b = p && bestReal(p); P.M.set(q, b ? { c: Math.round(b.price * 100), v: (p.qty && p.qty.v) || 0, u: p.qty && p.qty.u } : null); } return P.M.get(q); };
    const buyQ = (q, u, n) => { const x = pk(q); if (!x || !(n > 0)) return 0; return x.c * (x.v && x.u === u ? Math.max(1, Math.ceil(n / x.v - 1e-9)) : 1); };
    const adds = (rcs) => { const d = new Map(); for (const rc of rcs) for (const g of rc.ing) { const y = d.get(g.q) || { u: g.u, n: 0 }; y.n += (g.need * o.people) / rc.portions; d.set(g.q, y); } let c = 0; d.forEach((y, q) => { const n0 = (need.get(q) || { n: 0 }).n; c += buyQ(q, y.u, n0 + y.n) - buyQ(q, y.u, n0); }); return { c, d }; };
    const picks = [], mains = {}, sideUse = {};
    let out = false;
    for (let i = 0; i < meals; i++) {
      const last = picks.length ? picks[picks.length - 1].rc.main : "";
      let pick = null;
      for (const rc of P.plats) {
        if (picks.some((x) => x.rc.id === rc.id) || (mains[rc.main] || 0) >= 2) continue;
        /* l'accompagnement : parmi ceux que la recette propose (with), sinon tous, deux fois au plus dans la semaine */
        const okS = P.sides.filter((x) => (sideUse[x.id] || 0) < 2), pref = okS.filter((x) => (rc.with || []).includes(x.id));
        const side = rc.complete ? null : (pref.length ? pref : okS).map((x) => ({ x, c: adds([rc, x]).c })).sort((a, b) => a.c - b.c)[0] || null;
        const add = side ? side.c : adds([rc]).c;
        const score = add * (1 + 0.6 * jitter(o.seed, rc.id)) + P.miss.get(rc.id) * 1e7 + (rc.main === last ? 1e6 : 0);
        if (!pick || score < pick.score) pick = { rc, side: side && side.x, score };
      }
      if (!pick) { out = true; break; }
      picks.push({ rc: pick.rc, side: pick.side });
      adds(pick.side ? [pick.rc, pick.side] : [pick.rc]).d.forEach((y, q) => { const x = need.get(q) || { u: y.u, n: 0 }; x.n += y.n; need.set(q, x); });
      mains[pick.rc.main] = (mains[pick.rc.main] || 0) + 1;
      if (pick.side) sideUse[pick.side.id] = (sideUse[pick.side.id] || 0) + 1;
    }
    /* la semaine telle qu'elle ira dans « Ma semaine » : une ligne par recette, portions additionnées */
    const list = [];
    picks.forEach(({ rc, side }) => [rc, side].filter(Boolean).forEach((x) => { const e = list.find((y) => y.rc.id === x.id); if (e) e.portions += o.people; else list.push({ rc: x, portions: o.people }); }));
    const c = menuCost(list);
    return { picks, list, out, total: Math.round(c.buy * 100), used: Math.round(c.used * 100), miss: [...new Set(c.miss.map((x) => x.g.q))] };
  }
  function composeMenu(o) {
    o = Object.assign({ budget: 0, meals: 7, people: Math.max(1, Math.min(8, +S.prefs.foyer || 2)), seed: 0 }, o || {});
    const all = S.recs || [], P = { M: new Map(), miss: new Map() };
    P.plats = all.filter((rc) => rc.kind === "plat" && recFits(rc));
    P.sides = all.filter((rc) => rc.kind === "accompagnement" && recFits(rc));
    P.plats.forEach((rc) => P.miss.set(rc.id, recCost(rc).miss.length));
    const cheap = Object.assign({}, o, { seed: 0 });
    let r = composeOnce(o, o.meals, P);
    if (o.budget && r.total > o.budget && o.seed) r = composeOnce(cheap, o.meals, P);
    while (o.budget && r.total > o.budget && r.picks.length > 1) r = composeOnce(cheap, r.picks.length - 1, P);
    return Object.assign(r, { asked: o.meals, people: o.people, budget: o.budget, seed: o.seed, fits: !o.budget || r.total <= o.budget });
  }
  /* le bloc de « Repas à petit prix » : budget, nombre de repas et de personnes, puis la semaine proposée */
  function weekForm() {
    const C = S.compose || (S.compose = { bud: "", meals: 7, people: Math.max(1, Math.min(6, +S.prefs.foyer || 2)), seed: 0, res: null });
    const R = C.res;
    const form = `<h2 class="gh">Une semaine de repas</h2><div class="group"><div class="row stack"><span class="rt">Cabas choisit des plats variés qui tiennent dans ton budget, ingrédients mis en commun, aux prix relevés${dietOn() ? ", pour ton régime" : ""}.</span>` +
      `${field("cmBud", "Budget des courses", `type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" placeholder="Par exemple 40" value="${esc(C.bud)}"`, "Sans les frais de livraison\u00a0: le panier les compte ensuite. Vide, la semaine la moins chère.", "€")}` +
      `<p class="segl" id="cmML">Repas</p><div class="seg" role="radiogroup" aria-labelledby="cmML">${[5, 7, 10, 14].map((v) => `<button type="button" role="radio" data-act="cmmeals" data-v="${v}" aria-checked="${v === C.meals}">${v}</button>`).join("")}</div>` +
      `<p class="segl" id="cmPL">Personnes</p><div class="seg" role="radiogroup" aria-labelledby="cmPL">${[1, 2, 3, 4, 5, 6].map((v) => `<button type="button" role="radio" data-act="cmpeople" data-v="${v}" aria-checked="${v === C.people}">${v}</button>`).join("")}</div>` +
      `<button class="btn tint" type="button" data-act="compose">Composer ma semaine</button></div></div>`;
    if (!R) return form + `<div id="cmres" aria-live="polite"></div>`;
    return form + `<div id="cmres" aria-live="polite">${weekRes(R)}</div>`;
  }
  function weekRes(R) {
    const n = R.picks.length, pp = plural(R.people, "personne", "personnes");
    if (!n) return `<div class="empty"><h2>Aucun plat pour ton régime</h2><p>Aucune recette de Cabas ne correspond à ton régime avec les produits de tes enseignes. Change ton régime ou tes enseignes dans les réglages.</p></div>`;
    const bud = !R.budget ? "Sans budget\u00a0: la semaine la moins chère." : R.fits ? `Dans ton budget de ${eurR(R.budget / 100)}\u00a0: il te reste ${eurC(R.budget - R.total)}.` : `Même un seul repas dépasse ton budget de ${eurR(R.budget / 100)}.`;
    const fewer = n < R.asked && R.fits ? (R.out ? `Cabas n'a que ${plural(n, "plat différent", "plats différents")} pour ton régime et tes enseignes. ` : `Ton budget tient pour ${plural(n, "repas", "repas")}, pas ${R.asked}. `) : "";
    const rows = R.picks.map((x) => { const c = recCost(x.rc, R.people), cs = x.side ? recCost(x.side, R.people) : null, p0 = c.ok[0], per = (c.used + (cs ? cs.used : 0)) / R.people; return `<a class="row th" href="#/repas/${esc(x.rc.id)}"><span class="thumb">${p0 ? img(p0.p, 48) : ""}</span><span class="rt">${esc(x.rc.name)}<small>${x.side ? "Avec " + esc(x.side.name.toLowerCase()) + ". " : ""}${c.miss.length || (cs && cs.miss.length) ? "Prix partiel" : eur(per) + " par personne"}</small></span>${ic("chev", "chev")}</a>`; }).join("");
    return `<div class="sum rsum" style="margin-top:12px"><p class="sl">${plural(n, "repas", "repas")} pour ${pp}, courses en paquets entiers</p><div class="st">${px(R.total / 100)}</div>` +
      `<p class="sn">${fewer}${bud}${R.miss.length ? ` Prix partiel\u00a0: sans ${esc(joinEt(R.miss))}, pas encore dans Cabas.` : ""} Les ingrédients communs ne sont achetés qu'une fois\u00a0; le sel et les épices ne sont pas comptés.</p>` +
      `<div class="btns two" style="margin-top:14px"><button class="btn tint" type="button" data-act="cmtake">Prendre cette semaine</button><button class="btn plain" type="button" data-act="cmagain">Une autre semaine</button></div></div>` +
      `<div class="group" style="margin-top:12px">${rows}</div>`;
  }
  function menuItems() {
    const items = {};
    menuCost().ok.forEach((x) => { items[x.p.id] = Math.min(99, (items[x.p.id] || 0) + x.n); });
    return items;
  }
  function menuHtml() {
    const rs = menuRecs();
    if (!rs.length) return `<h2 class="gh">Ma semaine</h2><div class="group"><div class="row"><span class="rt">Aucun repas choisi<small>Ouvre une recette et touche «\u00a0Ajouter à ma semaine\u00a0»\u00a0: les ingrédients sont mis en commun.</small></span></div></div>`;
    const c = menuCost();
    return `<h2 class="gh">Ma semaine</h2><div class="sum rsum"><p class="sl">${plural(rs.length, "repas", "repas")}, ${plural(c.portions, "portion", "portions")}</p><div class="st">${px(c.used)}</div>` +
      `<p class="sn">${c.miss.length ? `Sans ${esc(joinEt(c.miss.map((x) => x.g.q)))}, pas encore dans Cabas. ` : ""}Les courses, en paquets entiers, font ${eur(c.buy)}\u00a0: les ingrédients communs ne sont achetés qu'une fois.</p>` +
      `<div class="btns" style="margin-top:14px"><button class="btn" type="button" data-act="menuadd">${ic("plus")}Ajouter les courses de la semaine au panier</button></div></div>` +
      `<div class="group" style="margin-top:12px">${rs.map(({ rc, portions }) => `<div class="row"><a class="rt" href="#/repas/${esc(rc.id)}">${esc(rc.name)}<small>${plural(portions, "portion", "portions")}</small></a><button class="icbtn" type="button" data-act="menudel" data-id="${esc(rc.id)}" aria-label="Retirer ${esc(rc.name)}">${ic("x")}</button></div>`).join("")}</div>`;
  }
  function recItems(id) {
    const rc = (S.recs || []).find((x) => x.id === id);
    if (!rc) return {};
    const foyer = S.prefs.foyer ? [2, 4, 6, 8].reduce((a, v) => (Math.abs(v - S.prefs.foyer) < Math.abs(a - S.prefs.foyer) ? v : a), 2) : 0;
    const P = (S.recP && S.recP[rc.id]) || foyer || rc.portions, items = {};
    recCost(rc, P).ok.forEach((x) => { items[x.p.id] = Math.min(99, (items[x.p.id] || 0) + x.n); });
    return items;
  }

  /* ---------- fiche produit : Nutri-Score, allergènes et labels, d'après Open Food Facts ---------- */
  /* Demandés à l'API publique d'Open Food Facts (données ouvertes, licence ODbL) à l'ouverture de la fiche d'un produit
     qui a un code-barres : seul le code part, 7 s au plus. Gardés 30 jours sur le téléphone (cabas.facts), « inconnu »
     compris ; réglage « Nutri-Score et allergènes » décoché (prefs.facts), ils ne sont demandés que d'un geste. Le régime
     s'en sert (allergènes à éviter, prefs.allergens) seulement quand le fait est connu, et le dit. */
  const ALLERGENS = [["gluten", "Gluten"], ["milk", "Lait"], ["eggs", "Œufs"], ["peanuts", "Arachides"], ["nuts", "Fruits à coque"], ["soybeans", "Soja"], ["fish", "Poisson"], ["crustaceans", "Crustacés"], ["molluscs", "Mollusques"], ["sesame-seeds", "Sésame"], ["celery", "Céleri"], ["mustard", "Moutarde"], ["sulphur-dioxide-and-sulphites", "Sulfites"], ["lupin", "Lupin"]];
  const ALLERG = new Map(ALLERGENS);
  /* labels connus, dits en texte (jamais de logo) ; les autres ne sont pas affichés */
  const LABELS = [["Agriculture biologique", /^(en:organic|en:eu-organic|fr:ab-agriculture-biologique)$/], ["Végan", /^en:vegan$/], ["Végétarien", /^en:vegetarian$/], ["Sans gluten", /^en:no-gluten$/], ["Sans lactose", /^en:no-lactose$/], ["Label Rouge", /^(en|fr):label-rouge$/], ["Commerce équitable", /^(en:fair-trade|en:fairtrade-international|en:max-havelaar|fr:max-havelaar)$/], ["AOP", /^en:pdo$/], ["IGP", /^en:pgi$/], ["Pêche durable MSC", /^en:(msc|sustainable-seafood-msc)$/], ["Aquaculture responsable ASC", /^en:asc$/], ["Halal", /^en:halal$/], ["Casher", /^en:kosher$/], ["Sans huile de palme", /^en:(no-palm-oil|palm-oil-free)$/], ["Sans sucres ajoutés", /^en:no-added-sugar$/], ["Plein air", /^en:free-range(-chicken-eggs)?$/], ["Fabriqué en France", /^en:made-in-france$/]];
  const FACT_MS = 30 * 864e5;
  const eanKey = (e) => String(e || "").replace(/\D/g, "").replace(/^0+/, "");
  /* demandes en cours et codes restés sans réponse pendant cette visite */
  const FX = { pend: new Map(), fail: new Set() };
  const factsAll = () => S.facts || (S.facts = store.get("facts", {}));
  function factsOf(p) { const k = p && eanKey(p.ean), f = k && factsAll()[k]; return f && Date.now() - f.t < FACT_MS ? f : null; }
  const factsAuto = () => S.prefs.facts !== false && navigator.onLine !== false;
  function factsSave(k, f) {
    const all = factsAll();
    all[k] = f;
    const ks = Object.keys(all);
    if (ks.length > 600) ks.sort((a, b) => all[a].t - all[b].t).slice(0, ks.length - 600).forEach((x) => delete all[x]);
    store.set("facts", all);
  }
  /* Open Food Facts, 7 s au plus : le produit, false s'il est inconnu, null sans réponse */
  async function offGet(code, fields) {
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const t = setTimeout(() => ctl && ctl.abort(), 7000);
    try {
      const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${fields}`, { signal: ctl ? ctl.signal : undefined, credentials: "omit" });
      if (r.status === 404) return false;
      if (!r.ok) return null;
      const j = await r.json();
      return j && j.status === 1 && j.product ? j.product : false;
    } catch (e) { return null; } finally { clearTimeout(t); }
  }
  function factsFetch(p) {
    const k = eanKey(p && p.ean);
    if (!k) return Promise.resolve(null);
    if (FX.pend.has(k)) return FX.pend.get(k);
    const tags = (a) => [...new Set((Array.isArray(a) ? a : []).map((x) => String(x).replace(/^en:/, "")).filter((x) => ALLERG.has(x)))];
    const pr = offGet(k, "product_name,product_name_fr,nutriscore_grade,allergens_tags,traces_tags,labels_tags").then((x) => {
      FX.pend.delete(k);
      if (x === null) { FX.fail.add(k); return null; }
      FX.fail.delete(k);
      const lb = (Array.isArray(x && x.labels_tags) ? x.labels_tags : []).map(String);
      const f = x ? { t: Date.now(), ok: 1, ns: /^[a-e]$/.test(x.nutriscore_grade || "") ? x.nutriscore_grade : "", al: tags(x.allergens_tags), tr: tags(x.traces_tags), lb: LABELS.filter(([, re]) => lb.some((y) => re.test(y))).map(([l]) => l), nm: String(x.product_name_fr || x.product_name || "").trim().slice(0, 120) } : { t: Date.now(), ok: 0 };
      factsSave(k, f);
      /* le régime de ce produit est revu avec ce qu'on sait maintenant */
      p._dv = -1;
      return f;
    });
    FX.pend.set(k, pr);
    return pr;
  }
  /* allergènes à éviter que le produit contient ou peut contenir, d'après Open Food Facts ; rien quand ce n'est pas connu */
  const allergSet = () => (Array.isArray(S.prefs.allergens) ? S.prefs.allergens : []).filter((a) => ALLERG.has(a));
  function allergHit(p) {
    const A = allergSet();
    if (!A.length) return [];
    const f = factsOf(p);
    return f && f.ok ? A.filter((a) => f.al.includes(a) || f.tr.includes(a)) : [];
  }
  const allergWords = (xs) => joinEt(xs.map((a) => ALLERG.get(a).toLowerCase()));
  /* Nutri-Score : les cinq lettres, celle du produit marquée (texte, sans les couleurs du logo officiel) */
  const nsHtml = (l) => `<span class="nscore" role="img" aria-label="Nutri-Score ${esc(l.toUpperCase())}">${"abcde".split("").map((x) => `<i${x === l ? ' class="on"' : ""} aria-hidden="true">${x.toUpperCase()}</i>`).join("")}</span>`;
  function factsHtml(p) {
    const k = eanKey(p.ean);
    if (!k) return "";
    const f = factsOf(p), src = "https://world.openfoodfacts.org/product/" + encodeURIComponent(k);
    const head = `<h2 class="gh">Nutrition et allergènes</h2>`;
    if (!f) {
      if (FX.pend.has(k) || (factsAuto() && !FX.fail.has(k))) return head + `<div class="group" aria-busy="true"><div class="row"><span class="rt">Demande à Open Food Facts…<small>Seul le code-barres est envoyé.</small></span></div></div>`;
      const failed = FX.fail.has(k);
      return head + `<div class="group"><div class="row stack"><span class="rt">${failed ? "Open Food Facts n'a pas répondu" : "Nutri-Score, allergènes et labels"}<small>${failed ? "Vérifie ta connexion, puis réessaie." : "D'après Open Food Facts, base ouverte et collaborative. Seul le code-barres est envoyé."}</small></span><button class="btn tint" type="button" data-act="factsget" data-id="${esc(p.id)}">${failed ? "Réessayer" : "Voir le Nutri-Score et les allergènes"}</button></div></div>`;
    }
    if (!f.ok) return head + `<div class="group"><div class="row"><span class="rt">Pas encore dans Open Food Facts<small>Ce code-barres n'y est pas encore décrit. Vérifie l'emballage.</small></span></div></div><p class="gf"><a href="${src}" target="_blank" rel="noopener">Décrire ce produit sur Open Food Facts</a></p>`;
    const mine = allergHit(p);
    const warn = mine.length ? `<div class="banner warn" role="note">${ic("info")}<span><b>${esc(allergWords(mine).replace(/^./, (c) => c.toUpperCase()))}</b>Tu l'évites, et ce produit en contient ou peut en contenir, d'après Open Food Facts.</span></div>` : "";
    const ns = `<div class="row"><span class="rt">Nutri-Score<small>${f.ns ? "De A, le meilleur, à E" : "Pas calculé pour ce produit"}</small></span>${f.ns ? nsHtml(f.ns) : ""}</div>`;
    const al = `<div class="row"><span class="rt">Allergènes<small>${f.al.length ? "Contient : " + esc(allergWords(f.al)) : "Aucun indiqué"}${f.tr.length ? ". Traces possibles : " + esc(allergWords(f.tr)) : ""}</small></span></div>`;
    const lb = f.lb.length ? `<div class="row"><span class="rt">Labels<small>${esc(f.lb.join(", "))}</small></span></div>` : "";
    return head + warn + `<div class="group${warn ? " gap" : ""}">${ns}${al}${lb}</div><p class="gf">D'après Open Food Facts${f.nm ? `, fiche « ${esc(f.nm)} »` : ""}, base collaborative sous licence ODbL. À vérifier sur l'emballage. <a href="${src}" target="_blank" rel="noopener">Voir la fiche</a></p>`;
  }
  /* la fiche ouverte demande ses faits une fois ; la section se met à jour quand ils arrivent */
  function factsLoad(p, then) {
    const k = eanKey(p && p.ean);
    if (!k || factsOf(p) || FX.fail.has(k)) return;
    factsFetch(p).then(then, then);
    then();
  }

  /* ---------- comparer deux produits ---------- */
  /* #/comparer/<a>/<b> : côte à côte, le prix le plus bas et son enseigne (simulé dit), le prix au kilo ou au litre, la
     contenance, le prix chez chaque enseigne activée, les régimes et, quand Open Food Facts les connaît, Nutri-Score et
     allergènes. Le verdict compare les prix relevés au kilo ou au litre, jamais un prix simulé. « Prendre celui-ci »
     remplace l'autre au panier, à la même quantité, avec « Annuler ». */
  const hc = (a, b) => "#/comparer/" + encodeURIComponent(a) + (b ? "/" + encodeURIComponent(b) : "");
  const REG_FR = { bio: "Bio", halal: "Halal", casher: "Casher", vegan: "Végan", vegetarien: "Végétarien", "sans-gluten": "Sans gluten", "sans-lactose": "Sans lactose" };
  function cmpCands(p, q) {
    const nq = norm(q || "");
    if (nq) return searchScored(q).map((x) => x[1]).filter((x) => x.id !== p.id && best(x)).slice(0, 12);
    const toks = norm(p.name).split(" ").filter((t) => t.length > 3 && !/^\d/.test(t)).slice(0, 4);
    const sc = (x) => ((S.basket[x.id] || 0) > 0 ? 0 : 2) + (toks.some((t) => norm(x.name).includes(t)) ? 0 : 1);
    return inRayon(p.r).filter((x) => x.id !== p.id && best(x)).map((x) => ({ x, s: sc(x), v: valOf(x) })).sort((a, b) => a.s - b.s || a.v - b.v).slice(0, 12).map((y) => y.x);
  }
  function cmpList(p, q) {
    const L = cmpCands(p, q);
    if (!L.length) return `<div class="row"><span class="rt">Aucun produit<small>Essaie un autre mot, une marque ou un rayon.</small></span></div>`;
    return L.map((x) => { const b = best(x), u = b ? unitPrice(x, b.price) : ""; return `<a class="row th" href="${hc(p.id, x.id)}"><span class="thumb">${img(x, 48)}</span><span class="rt">${esc(pname(x))}<small>${esc(x.format)}${b ? ", " + eur(b.price) + (u ? ", " + esc(u) : "") + (b.sim ? ", prix simulé" : "") : ""}</small></span>${ic("chev", "chev")}</a>`; }).join("");
  }
  function cmpSheet(id) {
    const p = S.prods.get(id);
    if (!p) return;
    S.cmp = { from: p.id, q: "" };
    const build = () => ({ body: `<p>Avec quel produit comparer ${esc(pname(p))} ? Les plus proches d'abord, ceux de ton panier en tête.</p>` + field("cmpq", "Chercher un autre produit", `type="search" enterkeyhint="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Un produit, une marque" value="${esc(S.cmp.q)}"`, "") + `<div class="group" id="cmplist">${cmpList(p, S.cmp.q)}</div>` });
    openSheet({ title: "Comparer", body: build().body, build, right: `<span></span>` });
  }
  /* le verdict : au kilo, au litre ou à l'unité, aux prix relevés de tes enseignes */
  function cmpVerdict(a, b) {
    const ra = bestReal(a), rb = bestReal(b);
    if (!ra || !rb) return { t: "Pas de verdict", n: "Un des deux produits n'a pas de prix relevé dans tes enseignes." };
    const ua = perUnit(a, ra.price), ub = perUnit(b, rb.price), same = ua != null && ub != null && a.qty.u === b.qty.u;
    const per = same ? (a.qty.u === "g" ? "Au kilo" : a.qty.u === "ml" ? "Au litre" : "À l'unité") : "Au paquet";
    const va = same ? ua : ra.price, vb = same ? ub : rb.price, lo = va <= vb ? a : b, hi = lo === a ? b : a, d = Math.abs(va - vb) / Math.max(va, vb);
    const fmt = (p, r) => (same ? unitPrice(p, r.price) : eur(r.price));
    const note = `${esc(pname(a))} : ${esc(fmt(a, ra))}, ${esc(pname(b))} : ${esc(fmt(b, rb))}, aux prix relevés.${same ? "" : " Les contenances ne se comparent pas au kilo : regarde la quantité."}`;
    if (d < 0.01) return { t: `${per}, le même prix`, n: note };
    return { t: `${per}, ${Math.round(d * 100)}${NB}% moins cher`, n: note, lo: lo.id, hi: hi.id };
  }
  VIEWS.comparer = (r) => {
    const get = (id) => S.prods.get(id) || S.prods.get((S.alias || {})[id]);
    const a = get(r.id), b = r.id2 ? get(r.id2) : null;
    if (!a) return notFound();
    if (!b || b === a) {
      return { title: "Comparer", grouped: true, html: `<h1 class="lt">Comparer</h1><p class="lt-sub">${esc(pname(a))}, ${esc(a.format)}, avec :</p><div class="group" id="cmplist">${cmpList(a, "")}</div><p class="gf">Ou cherche un autre produit depuis sa fiche.</p>` };
    }
    const P = [a, b], ids = ["cmpA", "cmpB"];
    const V = cmpVerdict(a, b);
    const cell = (i, h) => `<td headers="${ids[i]} %R">${h}</td>`;
    let n = 0;
    const row = (label, f) => { const rid = "cmpR" + ++n; return `<tr class="cl"><th colspan="2" scope="colgroup" id="${rid}">${label}</th></tr><tr>${P.map((p, i) => cell(i, f(p, i)).replace("%R", rid)).join("")}</tr>`; };
    const bb = P.map((p) => best(p));
    const rets = S.rets.filter((x) => retOn(x.id) && (a.offers[x.id] || b.offers[x.id]));
    const F = P.map(factsOf), anyF = F.some((f) => f && f.ok);
    const thead = `<thead><tr>${P.map((p, i) => `<th scope="col" id="${ids[i]}"><a href="${hp(p.id)}"><span class="thumb">${img(p, 72)}</span><span class="cb">${esc(p.brand)}</span><span class="cn">${esc(p.name)}</span></a>${V.lo === p.id ? '<span class="tag low">Le moins cher</span>' : ""}</th>`).join("")}</tr></thead>`;
    const body = row("Prix le plus bas", (p, i) => (bb[i] ? `<b class="num">${eur(bb[i].price)}</b><small>chez ${esc(retName(bb[i].ret))}${bb[i].sim ? ", prix simulé" : ""}</small>` : "<small>Pas dans tes enseignes</small>")) +
      row("Au kilo, au litre ou à l'unité", (p, i) => (bb[i] && unitPrice(p, bb[i].price) ? esc((p.approx ? "environ " : "") + unitPrice(p, bb[i].price)) + (bb[i].sim ? "<small>Prix simulé</small>" : "") : "<small>Pas indiqué</small>")) +
      row("Contenance", (p) => esc(p.format) + (p.approx ? "<small>estimée</small>" : "")) +
      rets.map((x) => row(`Chez ${esc(x.name)}`, (p) => { const o = p.offers[x.id], other = (p === a ? b : a).offers[x.id]; if (!o) return "<small>Pas vendu</small>"; const lower = other && o.price < other.price; return `${lower ? "<b class=\"num\">" : "<span class=\"num\">"}${eur(o.price)}${lower ? "</b>" : "</span>"}${o.sim ? "<small>Prix simulé</small>" : ""}`; })).join("") +
      row("Régimes et mentions", (p) => { const t = (p.regimes || []).map((x) => REG_FR[x]).filter(Boolean); return t.length ? esc(t.join(", ")) : "<small>Aucun indiqué</small>"; }) +
      (dietOn() ? row("Mon régime", (p) => (dietOk(p) ? "Correspond" : "Ne correspond pas")) : "") +
      (anyF ? row("Nutri-Score", (p, i) => (F[i] && F[i].ok && F[i].ns ? nsHtml(F[i].ns) : "<small>Pas connu</small>")) + row("Allergènes", (p, i) => (F[i] && F[i].ok ? (F[i].al.length ? esc(allergWords(F[i].al)) : "<small>Aucun indiqué</small>") : "<small>Pas connus</small>")) : "") +
      row("Marque", (p) => (p.type === "mdd" ? "Marque distributeur" : "Grande marque")) +
      `<tr class="take">${P.map((p, i) => cell(i, `<button class="btn tint" type="button" data-act="cmptake" data-id="${esc(p.id)}" data-o="${esc(P[1 - i].id)}" aria-label="Prendre ${esc(pname(p))}">Prendre celui-ci</button>`).replace(" %R", "")).join("")}</tr>`;
    return {
      title: "Comparer", grouped: true,
      mount: () => {
        if (!factsAuto()) return;
        const here = () => S.route.name === "comparer" && S.route.id === r.id && S.route.id2 === r.id2;
        P.forEach((p) => factsLoad(p, () => { if (here() && !FX.pend.size) rerender(); }));
      },
      html: `<h1 class="lt">Comparer</h1>` +
        `<div class="sum cmpv"><p class="sl">Aux prix relevés de tes enseignes</p><p class="vt">${esc(V.t)}${V.lo ? `<small>${esc(pname(S.prods.get(V.lo)))}</small>` : ""}</p><p class="sn">${V.n}</p></div>` +
        `<div class="group cmpw"><table class="cmpt"><caption class="sr">Comparaison de ${esc(pname(a))} et de ${esc(pname(b))}</caption>${thead}<tbody>${body}</tbody></table></div>` +
        `<p class="gf"><button class="act" type="button" data-act="cmppick" data-id="${esc(a.id)}">Comparer avec un autre produit${ic("chev")}</button></p>` +
        (anyF ? `<p class="gf">Nutri-Score et allergènes d'après Open Food Facts, base collaborative sous licence ODbL. À vérifier sur l'emballage.</p>` : ""),
    };
  };

  /* ---------- préviens-moi ---------- */
  /* Un seuil de prix par produit (cabas.watch : { id: { max, at, from } }, en centimes). À l'ouverture et à chaque nouveau
     relevé, le prix relevé le plus bas de tes enseignes (jamais un prix simulé) lui est comparé : dessous, le produit
     entre dans cabas.watchHits ({ id: { c, ret, at, seen } }) et l'accueil le dit, « Ton seuil est atteint », jusqu'à
     « C'est vu » (il revient si le prix baisse encore). Pas de notification : rien ne part du téléphone. */
  const watchAll = () => store.get("watch", {});
  const watchOf = (id) => watchAll()[id] || null;
  function watchCheck() {
    const W = watchAll(), H = store.get("watchHits", {}), out = {};
    for (const id of Object.keys(W)) {
      const lid = liveId(id), p = lid && S.prods.get(lid), b = p && bestReal(p);
      if (!b) continue;
      const c = Math.round(b.price * 100);
      if (c > W[id].max) continue;
      const old = H[id];
      out[id] = { c, ret: b.ret, at: b.at || "", seen: !!(old && old.seen && c >= old.c) };
    }
    store.set("watchHits", out);
    return out;
  }
  function watchHits() {
    const H = store.get("watchHits", {}), W = watchAll();
    return Object.keys(H).filter((id) => W[id]).map((id) => {
      const lid = liveId(id), p = lid && S.prods.get(lid), b = p && bestReal(p);
      return b && Math.round(b.price * 100) <= W[id].max ? { id, p, b, w: W[id], seen: !!H[id].seen } : null;
    }).filter(Boolean);
  }
  function watchRail() {
    const xs = watchHits().filter((x) => !x.seen);
    if (!xs.length) return "";
    return `<div class="sh"><h2>Ton seuil est atteint</h2><button class="act" type="button" data-act="watchseen">C'est vu</button></div><div class="group" role="region" aria-label="Ton seuil est atteint">${xs.map((x) => `<a class="row th" href="${hp(x.p.id)}"><span class="thumb">${img(x.p, 48)}</span><span class="rt">${esc(pname(x.p))}<small>${eur(x.b.price)} chez ${esc(retName(x.b.ret))}, sous ton seuil de ${eurC(x.w.max)}${x.w.from > x.b.price * 100 + 0.5 ? `, il était à ${eurC(x.w.from)}` : ""}</small></span>${ic("chev", "chev")}</a>`).join("")}</div>`;
  }
  /* le plus bas relevé pour ce produit dans data/history.json (centimes), quand l'historique est chargé */
  function histLow(p) {
    const H = HIST && HIST.p && HIST.p[p.id];
    if (!H) return 0;
    let lo = 0;
    Object.keys(H).filter((r) => S.retMap.has(r)).forEach((r) => H[r].forEach(([, v]) => { const c = Math.round(v * 100); if (c > 0 && (!lo || c < lo)) lo = c; }));
    return lo;
  }
  function watchSheet(id) {
    const p = S.prods.get(id);
    if (!p) return;
    const b = bestReal(p), w = watchOf(p.id), cur = b ? Math.round(b.price * 100) : 0, low = histLow(p);
    const def = w ? w.max : cur ? Math.max(5, Math.round((cur * 0.9) / 5) * 5) : 0;
    const chip = (v, l) => `<button class="chip" type="button" data-act="watchset" data-v="${v}">${l}</button>`;
    const body = `<p>${esc(pname(p))}, ${esc(p.format)}. ${b ? `Aujourd'hui : ${eur(b.price)} chez ${esc(retName(b.ret))}, le prix relevé le plus bas de tes enseignes.` : "Pas de prix relevé dans tes enseignes en ce moment."}${low && low < cur ? ` Le plus bas relevé : ${eurC(low)}.` : ""}</p>` +
      field("watchIn", "Préviens-moi sous", `type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" value="${esc(def ? frNum(def / 100) : "")}"`, "À chaque ouverture et à chaque nouveau relevé, aux prix relevés de tes enseignes. Pas de notification : l'accueil te le dit.", "€") +
      (cur ? `<div class="tagset" role="group" aria-label="Seuils proposés">${chip(Math.round(cur * 0.95), "5 % de moins")}${chip(Math.round(cur * 0.9), "10 % de moins")}${chip(Math.round(cur * 0.8), "20 % de moins")}${low && low < cur ? chip(low, "Le plus bas relevé") : ""}</div>` : "");
    const foot = w ? `<button class="btn plain" type="button" data-act="watchdel" data-id="${esc(p.id)}">Ne plus suivre</button><button class="btn" type="button" data-act="watchok" data-id="${esc(p.id)}">Enregistrer</button>` : `<button class="btn" type="button" data-act="watchok" data-id="${esc(p.id)}">Me prévenir</button>`;
    openSheet({ title: "Préviens-moi", body, foot, focus: "#watchIn", right: `<span></span>` });
  }
  function watchListSheet() {
    const build = () => {
      const W = watchAll(), ids = Object.keys(W).filter((id) => liveId(id));
      if (!ids.length) return { body: `<p>Aucun seuil de prix. Sur la fiche d'un produit, touche « Préviens-moi quand le prix baisse ».</p>` };
      return { body: `<p>Cabas regarde ces prix à chaque ouverture et à chaque nouveau relevé.</p><div class="group">${ids.map((id) => { const p = S.prods.get(liveId(id)), b = bestReal(p); return `<div class="row th"><span class="thumb">${img(p, 48)}</span><a class="rt" href="${hp(p.id)}">${esc(pname(p))}<small>Sous ${eurC(W[id].max)}${b ? `, aujourd'hui ${eur(b.price)}` : ""}</small></a><button class="icbtn" type="button" data-act="watchrm" data-id="${esc(id)}" aria-label="Ne plus suivre ${esc(pname(p))}">${ic("x")}</button></div>`; }).join("")}</div>` };
    };
    openSheet({ title: "Mes alertes de prix", body: build().body, build, right: `<span></span>`, onClose: () => { if (S.route.name === "reglages") rerender(); } });
  }

  /* ---------- signaler ou demander ---------- */
  /* Le signalement reste dans le téléphone (cabas.reports). S'il le veut, après confirmation, la personne l'ouvre en
     ticket sur la page publique du projet (GitHub) : titre et texte pré-remplis, sans rien de personnel (adresse
     électronique, téléphone et code postal retirés du message), et c'est elle qui l'envoie. */
  const GH_NEW = "https://github.com/59g59sy5w6-design/59g59sy5w6-design.github.io/issues/new";
  const REP_P = [["prix", "Le prix n'est pas le bon"], ["produit", "Le nom ou la contenance n'est pas le bon"], ["lien", "Le lien ne mène pas au bon produit"], ["rayon", "Il n'est pas dans le bon rayon"], ["autre", "Autre chose"]];
  const REP_G = [["demande", "Demander un produit ou un rayon"], ["enseigne", "Demander une enseigne ou une ville"], ["bug", "Quelque chose ne marche pas"], ["idee", "Une idée pour Cabas"]];
  const repLabel = (k) => (REP_P.concat(REP_G).find((x) => x[0] === k) || [k, "Signalement"])[1];
  const reportsAll = () => { const r = store.get("reports", []); return Array.isArray(r) ? r : []; };
  const scrub = (t) => String(t || "").replace(/[^\s@]+@[^\s@]+/g, "[retiré]").replace(/(?:\+33|0033|\b0)[\s.-]*[1-9](?:[\s.-]*\d{2}){4}\b/g, "[retiré]").replace(/\b\d{5}\b/g, "[retiré]").trim().slice(0, 600);
  function ghBody(rep) {
    const lid = rep.pid && liveId(rep.pid), p = lid ? S.prods.get(lid) : null, o = p && rep.ret ? p.offers[rep.ret] : null, ray = p && rayon(p.r);
    const L = ["Envoyé depuis Cabas.", "", `Type : ${repLabel(rep.k)}`];
    if (p) L.push(`Produit : ${p.brand} ${p.name}, ${p.format}`, `Identifiant : ${p.id}`);
    if (p && p.ean) L.push(`Code EAN : ${p.ean}`);
    if (ray) L.push(`Rayon : ${ray.name}`);
    if (rep.ret && S.allMap.has(rep.ret)) L.push(`Enseigne : ${S.allMap.get(rep.ret).name}`);
    if (o) L.push(`Prix affiché par Cabas : ${eur(o.price)}, relevé du ${dateFr(o.at)}${o.sim ? ", prix simulé" : ""}`);
    if (rep.text) L.push("", "Message :", scrub(rep.text));
    if (S.meta && S.meta.updatedAt) L.push("", `Relevé du catalogue : ${dateFr(String(S.meta.updatedAt).slice(0, 10))}`);
    return L.join("\n");
  }
  function ghIssueUrl(rep) {
    const lid = rep.pid && liveId(rep.pid), p = lid ? S.prods.get(lid) : null;
    const title = (repLabel(rep.k) + (p ? ` : ${p.brand} ${p.name}` : rep.text ? ` : ${scrub(rep.text).split("\n")[0]}` : "")).slice(0, 110);
    return GH_NEW + "?title=" + encodeURIComponent(title) + "&body=" + encodeURIComponent(ghBody(rep));
  }
  /* rid : un signalement déjà gardé, ouvert directement à l'étape de l'envoi */
  function reportSheet(pid, k0, text0, rid) {
    const p = pid ? S.prods.get(pid) : null, kinds = p ? REP_P : REP_G;
    S.rep = { pid: p ? p.id : "", k: k0 || kinds[0][0], ret: "", text: text0 || "", id: rid || "" };
    const build = () => {
      const R = S.rep;
      if (R.id) {
        const rep = reportsAll().find((x) => x.id === R.id);
        if (!rep) return { body: `<p>Ce signalement a été retiré.</p>`, foot: `<button class="btn" type="button" data-act="close">Fermer</button>` };
        return {
          body: `<div class="banner good" role="status">${ic("check")}<span><b>Gardé sur ce téléphone</b>Tu le retrouves dans les réglages, « Mes signalements ».</span></div>` +
            `<p style="padding-top:12px">Tu peux aussi l'envoyer à l'équipe de Cabas. Il sera publié sur GitHub, la page publique du projet, où il faut un compte. C'est toi qui l'envoies, et seul ce texte part :</p><pre class="repv">${esc(ghBody(rep))}</pre>`,
          foot: `<button class="btn plain" type="button" data-act="close">Pas maintenant</button><a class="btn" href="${esc(ghIssueUrl(rep))}" target="_blank" rel="noopener" data-act="repsent" data-id="${esc(rep.id)}">Ouvrir GitHub</a>`,
        };
      }
      const rets = p ? S.rets.filter((r) => p.offers[r.id]) : [];
      const chip = (v, l) => `<button class="chip" type="button" role="radio" aria-checked="${R.ret === v}" data-act="repret" data-v="${esc(v)}">${esc(l)}</button>`;
      return {
        body: (p ? `<p>${esc(pname(p))}, ${esc(p.format)}.</p>` : `<p>Un produit qui manque, une enseigne à ajouter, quelque chose qui ne va pas : dis-le, Cabas s'améliore avec.</p>`) +
          `<div class="group gap" role="radiogroup" aria-label="Ce que tu signales">${kinds.map(([k, l]) => `<button class="opt" type="button" role="radio" aria-checked="${R.k === k}" data-act="repk" data-k="${k}"><span>${l}</span>${R.k === k ? ic("check", "chk") : ""}</button>`).join("")}</div>` +
          ((R.k === "prix" || R.k === "lien") && rets.length ? `<h3 class="gh" id="repRL">Chez quelle enseigne</h3><div class="tagset" role="radiogroup" aria-labelledby="repRL">${chip("", "Je ne sais pas")}${rets.map((r) => chip(r.id, r.name)).join("")}</div>` : "") +
          `<div class="field" data-field="repT" style="padding-top:14px"><label for="repT">Ton message, si tu veux</label><span class="in ta"><textarea id="repT" rows="4" maxlength="500" aria-describedby="repTH">${esc(R.text)}</textarea></span><small id="repTH">N'écris ni ton nom, ni ton adresse, ni ton téléphone : si tu l'envoies, ce texte sera public.</small></div>`,
        foot: `<button class="btn" type="button" data-act="repok">Garder ce signalement</button>`,
      };
    };
    const o = build();
    openSheet({ title: rid ? "Envoyer le signalement" : p ? "Signaler une erreur" : "Signaler ou demander", body: o.body, foot: o.foot, build, right: `<span></span>`, onClose: () => { S.rep = null; if (S.route.name === "reglages") rerender(); } });
  }
  function reportsSheet() {
    const build = () => {
      const L = reportsAll().slice().reverse();
      if (!L.length) return { body: `<p>Aucun signalement gardé sur ce téléphone.</p>`, foot: `<button class="btn" type="button" data-act="report">Signaler ou demander</button>` };
      return {
        body: `<p>Ils restent sur ce téléphone. «\u00a0Envoyer\u00a0» te montre le texte avant de l'ouvrir sur GitHub, la page publique du projet.</p><div class="group">${L.map((r) => { const lid = r.pid && liveId(r.pid), p = lid ? S.prods.get(lid) : null; return `<div class="row stack"><span class="rt">${esc(repLabel(r.k))}<small>${p ? esc(pname(p)) + ", " : ""}${esc(dayFr(String(r.at).slice(0, 10)))}${r.sent ? ", ouvert sur GitHub" : ", gardé ici"}${r.text ? "<br>" + esc(r.text.slice(0, 140)) : ""}</small></span><span class="rbtns"><button class="btn sm tint" type="button" data-act="repsend" data-id="${esc(r.id)}">Envoyer</button><button class="btn sm plain" type="button" data-act="reprm" data-id="${esc(r.id)}">Retirer</button></span></div>`; }).join("")}</div>`,
      };
    };
    const o = build();
    openSheet({ title: "Mes signalements", body: o.body, foot: o.foot, build, right: `<span></span>`, onClose: () => { if (S.route.name === "reglages") rerender(); } });
  }

  /* ---------- historique des prix ---------- */
  /* data/history.json (tools/history.py, à chaque relevé) : les prix relevés qui ont changé, par produit et enseigne.
     Chargé à la première fiche produit ouverte ; la courbe n'apparaît qu'à partir de deux relevés différents. */
  let HIST = null, histP = null;
  function loadHist() {
    if (!histP) histP = fetch("data/history.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).then((h) => (HIST = h)).catch(() => null);
    return histP;
  }
  function histHtml(p) {
    const H = HIST && HIST.p && HIST.p[p.id];
    if (!H) return "";
    const D = HIST.d, series = Object.keys(H).filter((r) => S.retMap.has(r) && H[r].length >= 2).slice(0, 4).map((r) => ({ r, pts: H[r].map(([i, v]) => [D[i], v]) }));
    if (!series.length) return "";
    const all = series.flatMap((x) => x.pts), last = [S.meta.updatedAt || "", ...all.map((x) => x[0])].sort().pop();
    const t0 = Date.parse(all.map((x) => x[0]).sort()[0]), t1 = Math.max(Date.parse(last), t0 + 864e5);
    const vs = all.map((x) => x[1]), lo = Math.min(...vs), hi = Math.max(...vs), pad = (hi - lo) * 0.2 || 0.1;
    const W = 320, Hh = 110, X = (d) => 6 + ((Date.parse(d) - t0) / (t1 - t0)) * (W - 12), Y = (v) => 8 + (1 - (v - lo + pad) / (hi - lo + 2 * pad)) * (Hh - 16);
    const cols = ["var(--brand)", "var(--ink)", "var(--ink-2)", "var(--ink-3)"];
    const paths = series.map((x, k) => {
      let d = "";
      x.pts.forEach(([day, v], i) => { d += i ? `H${X(day).toFixed(1)}V${Y(v).toFixed(1)}` : `M${X(day).toFixed(1)},${Y(v).toFixed(1)}`; });
      return `<path d="${d}H${X(last).toFixed(1)}" fill="none" stroke="${cols[k]}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`;
    }).join("");
    const low = series.flatMap((x) => x.pts.map(([d, v]) => ({ r: x.r, d, v }))).sort((a, b) => a.v - b.v || (a.d < b.d ? 1 : -1))[0];
    const day = (d) => esc(dateFr(d).replace(/ \d{4}$/, ""));
    return `<h2 class="gh">Évolution du prix</h2><div class="group hist"><svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Évolution du prix depuis le ${day(all.map((x) => x[0]).sort()[0])}">${paths}</svg>` +
      `<div class="hax"><span>${day(all.map((x) => x[0]).sort()[0])}</span><span>${day(last)}</span></div>` +
      `<div class="hleg">${series.map((x, k) => `<span><i style="background:${cols[k]}"></i>${esc(retName(x.r))}, ${eur(x.pts[x.pts.length - 1][1])}</span>`).join("")}</div>` +
      `<p class="hnote">Le plus bas relevé\u00a0: ${eur(low.v)} chez ${esc(retName(low.r))}, le ${day(low.d)}.</p>${(() => { const m = momentOf(p); return m && m.k !== "flat" ? `<p class="hnote moment ${m.k}">${esc(m.text)}</p>` : ""; })()}</div>`;
  }

  /* ---------- ce qui a bougé, le bon moment, tes dépenses ---------- */
  /* data/history.json garde les prix relevés qui ont changé, par produit et par enseigne (jamais les prix simulés). Pour
     tes produits (panier, listes, paniers commandés) : la dernière hausse ou baisse de chaque enseigne que tu utilises,
     d'au moins 3 % et 10 centimes ; le bon moment, c'est le prix d'aujourd'hui comparé à tout ce qui a été relevé, sans
     rien prédire ; tes dépenses, ce sont tes paniers commandés, aux prix relevés, et à part ce que tu as indiqué payé. */
  function seriesOf(p, rid) {
    const H = HIST && HIST.p && HIST.p[p.id] && HIST.p[p.id][rid], o = p.offers[rid];
    if (!o || o.sim || !(o.price > 0)) return null;
    const pts = (H || []).map(([i, v]) => [HIST.d[i], v]).filter((x) => x[0] && x[1] > 0);
    if (!pts.length || Math.abs(pts[pts.length - 1][1] - o.price) >= 0.005) pts.push([o.at || (pts.length ? pts[pts.length - 1][0] : S.meta.updatedAt || ""), o.price]);
    return pts;
  }
  function lastMove(p, rid) {
    const pts = seriesOf(p, rid);
    if (!pts || pts.length < 2) return null;
    const [d, to] = pts[pts.length - 1], from = pts[pts.length - 2][1], dv = to - from;
    if (Math.abs(dv) < 0.095 || Math.abs(dv) < from * 0.03) return null;
    return { p, rid, from, to, d, pct: Math.round((dv / from) * 100) };
  }
  /* tes produits : le panier, les listes et les six derniers paniers commandés */
  function myIds() {
    const ids = new Set(Object.keys(S.basket).filter((id) => S.basket[id] > 0));
    S.lists.forEach((L) => Object.keys(L.items || {}).forEach((id) => ids.add(id)));
    histItems().slice(-6).forEach((h) => Object.keys(h.items).forEach((id) => ids.add(id)));
    return [...ids].map(liveId).filter(Boolean);
  }
  /* ce qui a bougé ces derniers jours (28 par défaut) : une ligne par produit, l'enseigne où il est le moins cher d'abord */
  function moves(all, days) {
    const floor = isoDay(new Date(Date.now() - (days || 28) * 864e5)), out = [];
    const ids = all ? (HIST && HIST.p ? Object.keys(HIST.p).map(liveId).filter(Boolean) : []) : myIds();
    for (const id of new Set(ids)) {
      const p = S.prods.get(id);
      if (!p) continue;
      const ms = Object.keys(p.offers).filter((r) => retOn(r)).map((r) => lastMove(p, r)).filter((m) => m && m.d >= floor);
      if (!ms.length) continue;
      const b = bestReal(p);
      out.push(ms.find((m) => b && m.rid === b.ret) || ms.sort((x, y) => Math.abs(y.pct) - Math.abs(x.pct))[0]);
    }
    return { down: out.filter((m) => m.to < m.from).sort((a, b) => a.pct - b.pct), up: out.filter((m) => m.to > m.from).sort((a, b) => b.pct - a.pct) };
  }
  /* le bon moment : le moins cher d'aujourd'hui dans tes enseignes, comparé à tous les prix relevés depuis le début de l'historique */
  function momentOf(p) {
    const b = p && bestReal(p);
    if (!b || !HIST || !HIST.p || !HIST.p[p.id]) return null;
    const pts = Object.keys(p.offers).filter((r) => retOn(r)).flatMap((r) => (seriesOf(p, r) || []).map(([d, v]) => ({ d, v, r })));
    if (pts.length < 2 || new Set(pts.map((x) => Math.round(x.v * 100))).size < 2) return null;
    const lo = pts.reduce((a, x) => (x.v < a.v - 0.004 || (Math.abs(x.v - a.v) < 0.005 && x.d > a.d) ? x : a)), since = pts.map((x) => x.d).sort()[0];
    if (b.price <= lo.v + 0.005) return { k: "low", text: `Bon moment\u00a0: ${eur(b.price)} chez ${retName(b.ret)}, le prix le plus bas relevé depuis le ${dayFr(since)}.` };
    const gap = b.price - lo.v;
    if (gap >= 0.095 && gap >= lo.v * 0.05) return { k: "high", text: `Il a déjà été moins cher\u00a0: ${eur(lo.v)} chez ${retName(lo.r)} le ${dayFr(lo.d)}, contre ${eur(b.price)} aujourd'hui au mieux.` };
    return { k: "flat", text: `Proche du plus bas relevé depuis le ${dayFr(since)}.` };
  }
  /* dépenses par mois, d'après les paniers commandés : aux prix relevés (total de chaque panier), et à part ce que tu as indiqué payé */
  function spendByMonth(n) {
    const by = new Map();
    for (const h of S.hist || []) {
      if (!h || !h.d) continue;
      const k = h.d.slice(0, 7), x = by.get(k) || { month: k, t: 0, n: 0, paid: 0, np: 0 };
      x.t += h.t || 0; x.n++;
      const pd = paidSum(h);
      if (pd > 0) { x.paid += pd; x.np++; }
      by.set(k, x);
    }
    const now = new Date(), out = [];
    for (let i = (n || 6) - 1; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 15), k = isoDay(d).slice(0, 7); out.push(by.get(k) || { month: k, t: 0, n: 0, paid: 0, np: 0 }); }
    return out;
  }
  const monthShort = (key) => { try { return new Date(key + "-15T12:00:00").toLocaleDateString("fr-FR", { month: "short" }).replace(/\.$/, ""); } catch (e) { return key.slice(5); } };
  const moveRow = (m) => `<a class="row th" href="${hp(m.p.id)}"><span class="thumb">${img(m.p, 48)}</span><span class="rt">${esc(pname(m.p))}<small>${esc(retName(m.rid))}, ${eur(m.from)} puis ${eur(m.to)} le ${esc(dayFr(m.d))}</small></span><span class="val num mv ${m.to < m.from ? "dn" : "up"}">${m.pct > 0 ? "+" : "−"}${Math.abs(m.pct)}${NB}%</span></a>`;
  VIEWS.mouvements = () => {
    if (!HIST) loadHist().then(() => { if (S.route.name === "mouvements" && $("#sheet").hidden) rerender(); });
    const M = HIST ? moves(false) : { down: [], up: [] }, A = HIST ? moves(true, 14) : { down: [], up: [] };
    const mine = new Set(M.down.concat(M.up).map((m) => m.p.id)), aD = A.down.filter((m) => !mine.has(m.p.id)).slice(0, 6), aU = A.up.filter((m) => !mine.has(m.p.id)).slice(0, 6);
    const months = spendByMonth(6), max = Math.max(1, ...months.map((x) => x.t)), anySpend = months.some((x) => x.n);
    const bars = `<div class="spend" role="img" aria-label="${esc(months.map((x) => `${monthName(x.month)} ${x.n ? eurC(x.t) : "rien"}`).join(", "))}">${months.map((x) => `<div class="sb"><span class="sv">${x.n ? esc(eurR(Math.round(x.t / 100))) : ""}</span><span class="bar"><i style="height:${x.n ? Math.max(4, Math.round((100 * x.t) / max)) : 0}%"></i></span><span class="sm">${esc(monthShort(x.month))}</span></div>`).join("")}</div>`;
    const cur = months[months.length - 1], prev = months[months.length - 2];
    const loading = !HIST ? `<div class="group" aria-busy="true"><div class="row"><span class="rt"><span class="skl"></span><small class="skl s"></small></span></div></div>` : "";
    return {
      title: "Ce qui a bougé", grouped: true,
      html: `<h1 class="lt">Ce qui a bougé</h1><p class="lt-sub">Les prix relevés de tes produits qui ont changé ces quatre dernières semaines, et tes dépenses.</p>` +
        `<h2 class="gh">Moins cher sur tes produits</h2>` + (loading || (M.down.length ? `<div class="group">${M.down.map(moveRow).join("")}</div>` : `<p class="gf">Aucune baisse sur tes produits pour l'instant.</p>`)) +
        `<h2 class="gh">Plus cher sur tes produits</h2>` + (loading || (M.up.length ? `<div class="group">${M.up.map(moveRow).join("")}</div>` : `<p class="gf">Aucune hausse sur tes produits pour l'instant.</p>`)) +
        (!myIds().length && HIST ? `<p class="gf">Tes produits sont ceux de ton panier, de tes listes et de tes paniers commandés.</p>` : "") +
        (aD.length || aU.length ? `<h2 class="gh">Dans tout le catalogue, ces deux dernières semaines</h2><div class="group">${aD.concat(aU).map(moveRow).join("")}</div>` : "") +
        `<p class="gf">Seuls les prix relevés sur les sites comptent, à 3${NB}% et 10 centimes près, jamais les prix simulés ni ceux que tu as saisis. Chaque baisse ou hausse est celle de l'enseigne où le produit est le moins cher aujourd'hui, dans tes enseignes.</p>` +
        `<h2 class="gh">Tes dépenses</h2>` + (anySpend ? `<div class="group">${bars}</div><p class="gf">${cur.n ? `En ${monthName(cur.month)}, ${eurC(cur.t)} sur ${plural(cur.n, "panier commandé", "paniers commandés")}` : `Rien de commandé en ${monthName(cur.month)}`}${prev && prev.n ? `, contre ${eurC(prev.t)} en ${monthName(prev.month)}` : ""}, aux prix relevés.${months.some((x) => x.np) ? ` Payé, d'après ce que tu as indiqué\u00a0: ${eurC(months.reduce((a, x) => a + x.paid, 0))} sur ${plural(months.reduce((a, x) => a + x.np, 0), "panier", "paniers")}, saisi par toi, à part.` : ""}</p>` :
          `<p class="gf">Quand tu remplis tes paniers avec Cabas et que tu passes tes commandes, tes dépenses de chaque mois s'affichent ici.</p>`) +
        `<div class="group" style="margin-top:24px"><a class="row" href="#/economies"><span class="rt">Tes économies</span>${ic("chev", "chev")}</a></div>`,
    };
  };

  /* ---------- scanner un code-barres ---------- */
  /* En magasin : la caméra lit le code-barres (BarcodeDetector du navigateur s'il existe, sinon scan.js), Cabas retrouve
     le produit par son code (relevé chez Carrefour), ou demande son nom à Open Food Facts (données ouvertes) et cherche
     l'équivalent le moins cher. On peut aussi taper le code. Les derniers scans restent affichés pour comparer. */
  const SC = { stream: null, timer: 0, det: null, pending: null, last: "", lastAt: 0, items: [], busy: false, note: "" };
  function eanIndex() {
    if (!S.eanMap) { S.eanMap = new Map(); S.list.forEach((p) => { if (p.ean) S.eanMap.set(String(p.ean).replace(/^0+/, ""), p.id); }); }
    return S.eanMap;
  }
  async function offLookup(code) {
    const p = await offGet(code, "product_name,product_name_fr,brands,quantity");
    return p ? { name: String(p.product_name_fr || p.product_name || "").trim(), brand: String(p.brands || "").split(",")[0].trim(), qty: String(p.quantity || "").trim() } : null;
  }
  async function onCode(code) {
    code = String(code).replace(/\D/g, "");
    if (!Scan.valid(code)) return;
    const now = Date.now();
    if (code === SC.last && now - SC.lastAt < 4000) return;
    SC.last = code; SC.lastAt = now;
    buzz("add");
    const id = eanIndex().get(code.replace(/^0+/, ""));
    const it = { code, at: now, pid: id || null, off: null, near: null, loading: !id, store: storeTick(id) };
    SC.items = [it].concat(SC.items.filter((x) => x.code !== code)).slice(0, 12);
    scanRender();
    if (id) return;
    const off = await offLookup(code);
    it.off = off; it.loading = false;
    if (off && (off.name || off.brand)) {
      const q = [off.brand, off.name, off.qty].filter(Boolean).join(" ");
      const m = matchLine(parseLine(q));
      if (m.pick) it.near = { pid: m.pick, cands: m.cands };
    }
    scanRender();
  }
  /* venu du mode magasin (il y a moins de trois heures) : un produit scanné qui est dans la liste y est coché */
  function storeTick(id) {
    if (!id || !S.storeScan || Date.now() - S.storeScan > 3 * 3600e3) return false;
    const x = storeItems(storeMode()).find((y) => !y.free && y.id === id);
    if (!x || S.guide.ck[storeKey(x)]) return false;
    S.guide.ck[storeKey(x)] = 1; saveGuide();
    toast("Coché dans ta liste\u00a0: " + pname(S.prods.get(id)), null, "check");
    return true;
  }
  const scanOne = (x) => {
    const shelf = (v, b, code) => `<p class="sn" data-shelfnote="${esc(code)}">${shelfNote(v, b)}</p>`;
    if (x.pid) {
      const p = S.prods.get(x.pid), os = offers(p, true), b = os[0] || null;
      const rows = os.slice(0, 4).map((o, i) => `<li class="${i === 0 ? "low" : ""}"><span>${esc(retName(o.ret))}${o.sim ? " (simulé)" : ""}</span>${i === 0 ? `<span class="sticker">${eur(o.price)}</span>` : `<span class="num">${eur(o.price)}</span>`}</li>`).join("");
      return `<article class="deal scanr"><div class="dh"><a class="di" href="${hp(p.id)}">${img(p)}</a><div class="dtx"><a class="dt" href="${hp(p.id)}"><b>${esc(p.brand)}</b> ${esc(p.name)}</a><div class="pfmt">${esc(p.format)}, code ${esc(x.code)}</div></div></div>` + (x.store ? `<p class="sn ok">${ic("check")}Coché dans ta liste du magasin</p>` : "") +
        (rows ? `<ul class="ladder">${rows}</ul>` : `<p class="sn">Pas vendu par tes enseignes.</p>`) +
        `<label class="shelf"><span>Prix vu en rayon</span><input type="number" inputmode="decimal" step="0.01" min="0" data-shelf="${esc(x.code)}" value="${esc(x.shelf || "")}" placeholder="0,00"><span>€</span></label>${shelf(x.shelf, b, x.code)}` +
        `<div class="df"><span></span>${buyCtl(p.id, "flat")}</div></article>`;
    }
    if (x.loading) return `<article class="deal scanr"><p class="sn">Code ${esc(x.code)}\u00a0: recherche du produit…</p></article>`;
    const off = x.off, title = off && (off.name || off.brand) ? `<b>${esc(off.brand)}</b> ${esc(off.name)}${off.qty ? `, ${esc(off.qty)}` : ""}` : `Code ${esc(x.code)}`;
    if (x.near) {
      const p = S.prods.get(x.near.pid), b = best(p);
      return `<article class="deal scanr"><p class="scn">${title}<small>Pas dans Cabas tel quel. L'équivalent le moins cher dans tes enseignes\u00a0:</small></p>` +
        `<div class="dh"><a class="di" href="${hp(p.id)}">${img(p)}</a><div class="dtx"><a class="dt" href="${hp(p.id)}"><b>${esc(p.brand)}</b> ${esc(p.name)}</a><div class="pfmt">${esc(p.format)}${b ? `, ${eur(b.price)} chez ${esc(retName(b.ret))}${simTxt(b)}${unitPrice(p, b.price) ? ", " + esc(unitPrice(p, b.price)) : ""}` : ""}</div></div></div>` +
        `<label class="shelf"><span>Prix vu en rayon</span><input type="number" inputmode="decimal" step="0.01" min="0" data-shelf="${esc(x.code)}" value="${esc(x.shelf || "")}" placeholder="0,00"><span>€</span></label>${shelf(x.shelf, b, x.code)}` +
        `<div class="df"><button class="act" type="button" data-act="scansearch" data-q="${esc([off.brand, off.name].filter(Boolean).join(" "))}">Chercher d'autres équivalents${ic("chev")}</button>${buyCtl(p.id, "flat")}</div></article>`;
    }
    return `<article class="deal scanr"><p class="scn">${title}<small>${off ? "Pas dans Cabas, et aucun équivalent trouvé dans ses rayons." : "Produit inconnu\u00a0: Cabas ne couvre que quelques rayons, et le nom n'a pas pu être demandé à Open Food Facts (réseau)."}</small></p>` +
      (off && (off.name || off.brand) ? `<div class="df"><button class="act" type="button" data-act="scansearch" data-q="${esc([off.brand, off.name].filter(Boolean).join(" "))}">Chercher dans Cabas${ic("chev")}</button><span></span></div>` : "") + `</article>`;
  };
  function shelfNote(v, b) {
    const p = parseFloat(String(v || "").replace(",", "."));
    if (!(p > 0) || !b) return "";
    const d = p - b.price;
    return d > 0.005 ? `${eur(d)} de moins en ligne chez ${esc(retName(b.ret))}, hors livraison.` : d < -0.005 ? `Moins cher ici, de ${eur(-d)}, qu'en ligne.` : "Le même prix qu'en ligne.";
  }
  function scanRender() {
    const el = $("#scres");
    if (!el) return;
    el.innerHTML = SC.items.length ? `<div class="sh"><h2>Derniers scans</h2><button class="act" type="button" data-act="scanclear">Effacer</button></div>` + SC.items.map(scanOne).join("") : "";
    const st = $("#scst");
    if (st) st.textContent = SC.note;
  }
  function scanNote(t) { SC.note = t; const st = $("#scst"); if (st) st.textContent = t; }
  /* le décodeur (scan.js) ne se charge qu'à l'ouverture du scanner ; il est dans le cache hors ligne */
  let scanP = null;
  function ensureScan() {
    if (window.Scan) return Promise.resolve();
    if (!scanP) scanP = new Promise((ok, ko) => { const s = document.createElement("script"); s.src = "scan.js"; s.onload = ok; s.onerror = () => { scanP = null; ko(new Error("scan.js")); }; document.head.appendChild(s); });
    return scanP;
  }
  async function startScan() {
    const v = $("#scv");
    if (!v || SC.stream) return;
    try { await ensureScan(); } catch (e) { scanNote("Le lecteur de codes-barres n'a pas pu se charger\u00a0: tape le code sous le code-barres."); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { scanNote("Pas de caméra sur cet appareil\u00a0: tape le code sous le code-barres."); return; }
    try {
      SC.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    } catch (e) {
      scanNote(e && e.name === "NotAllowedError" ? "Cabas n'a pas accès à la caméra. Autorise-la dans les réglages du téléphone, ou tape le code." : "La caméra n'a pas pu s'ouvrir\u00a0: tape le code sous le code-barres.");
      return;
    }
    if (S.route.name !== "scan") { stopScan(); return; }
    v.srcObject = SC.stream;
    try { await v.play(); } catch (e) { /* lecture refusée : la vidéo démarre au premier geste */ }
    scanNote("Vise le code-barres, bien à plat et à 10 ou 15 cm.");
    if ("BarcodeDetector" in window) { try { SC.det = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] }); } catch (e) { SC.det = null; } }
    const cv = document.createElement("canvas"), cx = cv.getContext("2d", { willReadFrequently: true });
    const tick = async () => {
      if (!SC.stream) return;
      if (v.readyState >= 2 && !SC.busy) {
        SC.busy = true;
        try {
          let code = null;
          if (SC.det) { try { const r = await SC.det.detect(v); if (r && r.length) code = r[0].rawValue; } catch (e) { SC.det = null; } }
          if (!code && !SC.det) {
            const W = Math.min(960, v.videoWidth || 960), H = Math.round(W * (v.videoHeight || 540) / (v.videoWidth || 960));
            if (W && H) {
              cv.width = W; cv.height = H; cx.drawImage(v, 0, 0, W, H);
              const r = Scan.decode(cx.getImageData(0, 0, W, H));
              /* une lecture sûre sur deux lignes, ou la même lecture à deux images de suite */
              if (r && ((r.hits >= 2 && r.err < 0.95 && r.margin >= 0.2) || (SC.pending === r.code && r.err < 0.95))) { code = r.code; SC.pending = null; }
              else SC.pending = r && r.err < 0.95 ? r.code : null;
            }
          }
          if (code) await onCode(code);
        } finally { SC.busy = false; }
      }
      SC.timer = setTimeout(tick, SC.det ? 250 : 160);
    };
    tick();
  }
  function stopScan() {
    clearTimeout(SC.timer); SC.timer = 0;
    if (SC.stream) { SC.stream.getTracks().forEach((t) => t.stop()); SC.stream = null; }
    const v = $("#scv"); if (v) v.srcObject = null;
    SC.pending = null; SC.busy = false;
  }
  VIEWS.scan = () => ({
    title: "Scanner", grouped: true,
    html: `<h1 class="lt">Scanner</h1><p class="lt-sub">En magasin, vise le code-barres d'un produit\u00a0: Cabas te dit où il est le moins cher.</p>` +
      `<div class="scanbox"><video id="scv" playsinline muted autoplay></video><div class="scanguide" aria-hidden="true"></div></div><p class="scst" id="scst" aria-live="polite">${esc(SC.note || "Ouverture de la caméra…")}</p>` +
      `<div class="pad btns" style="padding-top:12px"><button class="btn tint" type="button" data-act="scantype">Taper le code</button></div>` +
      `<div id="scres" aria-live="polite"></div>` +
      `<p class="gf">Cabas lit les codes EAN-13 et EAN-8 des produits. Le nom d'un produit qu'il ne connaît pas vient d'Open Food Facts, données ouvertes (licence ODbL). Rien n'est envoyé ailleurs\u00a0: l'image reste sur ton téléphone.</p>`,
    mount: () => { scanRender(); startScan(); },
  });
  function scanTypeSheet() {
    openSheet({
      title: "Code-barres", focus: "#eanIn",
      right: `<button class="txtbtn primary" type="button" data-act="scantypeok">OK</button>`,
      body: `<p>Les chiffres écrits sous le code-barres.</p>${field("eanIn", "Code à 13 chiffres, ou 8", `type="text" inputmode="numeric" pattern="[0-9]*" maxlength="14" autocomplete="off" placeholder="3017620422003" enterkeyhint="done"`, "")}`,
    });
  }

  /* ---------- feuilles ---------- */
  /* La feuille est le seul dialogue : le reste de la page devient inerte, le focus entre sur le titre (ou le champ
     demandé) et revient à l'élément qui l'a ouverte à la fermeture ; une croix « Fermer » de 44 px à gauche, l'action
     principale en texte à droite ; le corps défilant a un fondu de bord tant qu'il reste du contenu. */
  let sheetCtx = null;
  const INERT = ["view", "nav", "dock", "tabbar", "side"];
  function sheetEdges(b) {
    b.classList.toggle("more-top", b.scrollTop > 8);
    b.classList.toggle("more-bot", b.scrollTop + b.clientHeight < b.scrollHeight - 8);
  }
  function openSheet(o) {
    const w = $("#sheet"), sh = w.querySelector(".sheet");
    o.opener = w.hidden ? document.activeElement : (sheetCtx && sheetCtx.opener) || document.activeElement;
    sheetCtx = o;
    sh.innerHTML = `<div class="grabz" aria-hidden="true"><div class="grab"></div></div><div class="sheet-h"><button class="icbtn" type="button" data-act="close" aria-label="Fermer">${ic("x")}</button><h2 id="sheetT" tabindex="-1">${esc(o.title)}</h2>${o.right || `<button class="txtbtn primary" type="button" data-act="close">OK</button>`}</div><div class="sheet-b">${o.body}</div>${o.foot ? `<div class="sheet-f">${o.foot}</div>` : ""}`;
    sh.style.transform = "";
    sh.classList.remove("closing");
    w.hidden = false;
    document.documentElement.style.overflow = "hidden";
    document.body.classList.add("has-sheet");
    INERT.forEach((id) => { const el = $("#" + id); if (el) el.setAttribute("inert", ""); });
    sheetEdges($(".sheet-b", sh));
    const delay = o.focus ? 60 : tokenMs("--t-3", 320);
    setTimeout(() => { if (sheetCtx !== o) return; const i = (o.focus && $(o.focus, sh)) || $("#sheetT"); if (i) i.focus({ preventScroll: !o.focus }); }, delay);
  }
  function refreshSheet() {
    if (!sheetCtx || !sheetCtx.build) return;
    const b = $("#sheet .sheet-b"), y = b ? b.scrollTop : 0;
    /* l'élément qui avait le focus (une option, une pastille) est retrouvé par son action et ses données */
    const ae = document.activeElement, keep = ae && ae.closest("#sheet") ? sameAs(ae) : "";
    const o = sheetCtx.build();
    b.innerHTML = o.body;
    const f = $("#sheet .sheet-f");
    if (o.foot != null && f) f.innerHTML = o.foot;
    b.scrollTop = y;
    sheetEdges(b);
    if (keep) { const n = $(keep, $("#sheet")); if (n) n.focus({ preventScroll: true }); }
  }
  function closeSheet() {
    const w = $("#sheet");
    if (w.hidden) return;
    w.hidden = true;
    document.documentElement.style.overflow = "";
    document.body.classList.remove("has-sheet");
    INERT.forEach((id) => { const el = $("#" + id); if (el) el.removeAttribute("inert"); });
    const cb = sheetCtx && sheetCtx.onClose, op = sheetCtx && sheetCtx.opener, key = op && !op.closest("#sheet") ? sameAs(op) : "";
    sheetCtx = null;
    if (cb) cb();
    /* l'ouvreur s'il est encore visible (pas un bouton de toast disparu), sinon son équivalent redessiné, sinon la vue */
    const back = (op && document.contains(op) && op.getClientRects().length && !op.closest("#sheet") ? op : key && $(key, $("#view"))) || $("#view");
    try { back.focus({ preventScroll: true }); } catch (e) { /* focus refusé */ }
  }
  /* sélecteur qui retrouve un bouton après un redessin : son action et ses données */
  const sameAs = (el) => (el && el.dataset && el.dataset.act ? `[data-act="${CSS.escape(el.dataset.act)}"]` + Object.keys(el.dataset).filter((k) => k !== "act").map((k) => `[data-${k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}="${CSS.escape(el.dataset[k])}"]`).join("") : "");
  /* piège de Tab de secours, pour les navigateurs sans inert */
  function trapTab(e) {
    const sh = $("#sheet .sheet");
    const f = $$("button:not([disabled]), a[href], input:not([disabled]), textarea, select, [tabindex]:not([tabindex='-1'])", sh).filter((el) => el.offsetParent !== null);
    if (!f.length) { e.preventDefault(); $("#sheetT").focus(); return; }
    /* rien de focalisable après (ou avant) l'élément qui a le focus, le titre compris : on boucle dans la feuille */
    const first = f[0], last = f[f.length - 1], ae = document.activeElement, inside = sh.contains(ae);
    const more = (dir) => f.some((el) => el !== ae && ae.compareDocumentPosition(el) & dir);
    if (e.shiftKey && (!inside || !more(Node.DOCUMENT_POSITION_PRECEDING))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (!inside || !more(Node.DOCUMENT_POSITION_FOLLOWING))) { e.preventDefault(); first.focus(); }
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
  /* option cochable : case ronde, coche pour un choix multiple (checkbox), disque pour un choix unique (radio, dans un radiogroup) */
  const opt = (act, label, checked, extra, count, single) => `<button class="opt" type="button" role="${single ? "radio" : "checkbox"}" aria-checked="${!!checked}" data-act="${act}" ${extra || ""}><span>${label}</span>${count != null ? `<span class="c">${count}</span>` : ""}<span class="box">${ic("check")}</span></button>`;
  function sortSheet(key) {
    const f = F(key);
    openSheet({ title: "Trier par", body: `<div class="group" role="radiogroup" aria-label="Trier par">${SORTS.map(([v, l]) => opt("setsort", esc(l), f.sort === v, `data-k="${esc(key)}" data-v="${v}"`, null, true)).join("")}</div>` });
  }
  function baseFor(key) { return key === "s" ? askBase(S.q.trim()) : inRayon(key.replace(/^r:/, "")); }
  function filterSheet(key) {
    const build = () => {
      const f = F(key), base = baseFor(key), res = applyFilters(base, f, key === "s");
      const rc = (id) => base.filter((p) => p.offers[id] && p.offers[id].price > 0).length;
      const tagc = new Map(); base.forEach((p) => (p.tags || []).forEach((t) => tagc.set(t, (tagc.get(t) || 0) + 1)));
      const brands = new Map(); base.forEach((p) => brands.set(p.brand, (brands.get(p.brand) || 0) + 1));
      const bq = norm(f.bq);
      const bl = [...brands.entries()].filter(([b]) => !bq || norm(b).includes(bq)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "fr")).slice(0, 60);
      const body = `<h3 class="gh" id="fretL">Enseignes</h3><div class="group" role="group" aria-labelledby="fretL">${S.rets.map((r) => opt("fret", esc(r.name), f.ret[r.id], `data-id="${esc(r.id)}" data-k="${esc(key)}"`, rc(r.id))).join("")}</div>` +
        `<h3 class="gh" id="fdispL">Disponibilité</h3><div class="group" role="group" aria-labelledby="fdispL">${opt("fcmp", "Vendus dans plusieurs enseignes", f.cmp, `data-k="${esc(key)}"`)}${opt("fpromo", "Avec une offre en cours", f.promo, `data-k="${esc(key)}"`)}</div>` +
        `<h3 class="gh" id="ftypeL">Type de marque</h3><div class="pad"><div class="seg" role="radiogroup" aria-labelledby="ftypeL">${[["all", "Toutes"], ["nb", "Grandes marques"], ["mdd", "Distributeur"]].map(([v, l]) => `<button type="button" role="radio" data-act="ftype" data-k="${esc(key)}" data-v="${v}" aria-checked="${f.type === v}">${l}</button>`).join("")}</div></div>` +
        (tagc.size ? `<h3 class="gh" id="ftagL">Labels et mentions</h3><div class="tagset" role="group" aria-labelledby="ftagL">${[...tagc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([t]) => `<button class="chip" type="button" data-act="ftag" data-k="${esc(key)}" data-t="${esc(t)}" aria-pressed="${!!f.tags[t]}">${esc(t)}</button>`).join("")}</div>` : "") +
        `<div style="padding-top:22px">${field("fmax", "Prix maximum, en euros", `data-k="${esc(key)}" type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" placeholder="Sans limite" value="${esc(f.max)}"`, "", "€")}</div>` +
        `<div style="padding-top:10px">${field("fbq", "Marques", `data-k="${esc(key)}" type="search" autocomplete="off" placeholder="Chercher une marque" value="${esc(f.bq)}"`, "")}</div><div class="group" role="group" aria-label="Marques">${bl.map(([b, n]) => opt("fbrand", esc(b), f.brand[b], `data-b="${esc(b)}" data-k="${esc(key)}"`, n)).join("") || `<div class="opt"><span>Aucune marque</span></div>`}</div>`;
      const foot = `<button class="btn sm ghost" type="button" data-act="freset" data-k="${esc(key)}">Effacer</button><button class="btn" type="button" data-act="close">Voir ${plural(res.length, "produit", "produits")}</button>`;
      return { body, foot };
    };
    const o = build();
    openSheet({ title: "Filtres", body: o.body, foot: o.foot, build, onClose: rerenderList });
  }
  function rerenderList() {
    if (S.route.name === "recherche") { S.shown.s = 0; $("#sres").innerHTML = searchBody(); mountLazy(); onScroll(); }
    else { const k = "r:" + S.route.id; S.shown[k] = 0; rerender(); }
  }
  function zipHint() {
    const liv = S.rets.filter((r) => !pickup(r)).map((r) => r.name), ret = S.rets.filter(pickup);
    return (liv.length ? joinEt(liv) + (liv.length > 1 ? " livrent" : " livre") + " en Île-de-France." : "") +
      ret.map((r) => ` ${r.name}\u00a0: retrait${r.channel.where ? " à " + r.channel.where : ""}.`).join("");
  }
  function zipSheet() {
    openSheet({
      title: "Livraison", focus: "#zipIn",
      right: `<button class="txtbtn primary" type="button" data-act="zipok">OK</button>`,
      body: `<p>Ton code postal sert à vérifier que les enseignes te livrent et à choisir le point Auchan le plus proche. Il reste sur cet appareil.</p>${field("zipIn", "Code postal", `type="text" inputmode="numeric" pattern="[0-9]*" maxlength="5" autocomplete="postal-code" enterkeyhint="done" placeholder="Par exemple 75011" value="${esc(S.prefs.zip)}"`, esc(zipHint()))}`,
    });
  }
  function nameSheet(title, value, act, id) {
    openSheet({
      title, focus: "#nameIn",
      right: `<button class="txtbtn primary" type="button" data-act="${act}" data-id="${esc(id || "")}">OK</button>`,
      body: `<div style="padding-top:8px">${field("nameIn", "Nom de la liste", `type="text" maxlength="40" autocomplete="off" enterkeyhint="done" value="${esc(value)}"`, "")}</div>`,
    });
  }
  function confirmSheet(title, text, label, act, id) {
    openSheet({
      title, right: `<span></span>`,
      body: `<p>${esc(text)}</p>`,
      foot: `<button class="btn plain" type="button" data-act="close">Annuler</button><button class="btn danger" type="button" data-act="${act}" data-id="${esc(id || "")}">${esc(label)}</button>`,
    });
  }
  function installSheet() {
    openSheet({
      title: "Installer Cabas",
      body: isIOS ? `<p>Cabas s'installe comme une appli, sans passer par l'App Store.</p><ol class="steps"><li><span>Ouvre cette page dans <b>Safari</b> sur ton iPhone.</span></li><li><span>Touche ${ic("share")} <b>Partager</b>, en bas de l'écran.</span></li><li><span>Choisis ${ic("sqplus")} <b>Sur l'écran d'accueil</b>, puis <b>Ajouter</b>.</span></li></ol><p style="padding-top:8px">L'icône Cabas apparaît sur ton écran d'accueil. L'appli s'ouvre en plein écran et marche même sans réseau, avec les prix du dernier relevé.</p>` :
        `<p>Cabas s'installe comme une appli, sans passer par une boutique.</p><ol class="steps"><li><span>Ouvre cette page dans <b>Chrome</b> (ou le navigateur de ton téléphone).</span></li><li><span>Ouvre le menu du navigateur, en haut à droite.</span></li><li><span>Choisis <b>Installer l'application</b> ou <b>Ajouter à l'écran d'accueil</b>.</span></li></ol><p style="padding-top:8px">L'icône Cabas apparaît sur ton écran d'accueil. L'appli s'ouvre en plein écran et marche même sans réseau, avec les prix du dernier relevé.</p>`,
    });
  }

  /* ---------- toast ---------- */
  /* un seul toast à la fois, 2,5 s, 5 s avec une action (« Voir », « Annuler »), plus long sur demande (ms) ; icône de
     réussite en option. Un nouveau toast remplace l'ancien, et son « Annuler » avec. */
  let toastT = null;
  function toast(msg, action, icon, ms) {
    const el = $("#toast");
    S.undo = null;
    el.innerHTML = (icon ? ic(icon) : "") + `<span>${esc(msg)}</span>` + (action ? `<button type="button" data-act="toastact">${esc(action.label)}</button>` : "");
    el._act = action ? action.run : null;
    el.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => { el.hidden = true; S.undo = null; }, ms || (action ? 5000 : 2500));
  }
  /* « Annuler » partout : chaque retrait ou suppression se rattrape d'un geste, le temps du toast. restore remet l'état
     exact (copie prise avant l'action, voir snap) et le sauvegarde ; le chrome et la vue suivent. Un seul à la fois. */
  function undoable(label, restore, ms) {
    ms = ms || 5000;
    const run = () => { S.undo = null; restore(); renderChrome(); rerender(); };
    toast(label, { label: "Annuler", run }, null, ms);
    S.undo = { label, restore: run, until: Date.now() + ms };
  }
  /* copie profonde de champs de S prise avant une action ; renvoie la fonction qui les remet et les sauvegarde */
  function snap(...keys) {
    const savers = { basket: saveBasket, guide: saveGuide, free: saveFree, lists: saveLists, prefs: savePrefs, hist: () => store.set("hist", S.hist), menu: saveMenu, todo: saveTodo, flex: saveFlex };
    const c = keys.map((k) => [k, JSON.parse(JSON.stringify(S[k]))]);
    return () => c.forEach(([k, v]) => { S[k] = v; savers[k](); });
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
    /* avant le catalogue, seuls les gestes qui n'en ont pas besoin passent */
    if (!S.ready && !["reload", "close", "back", "gosearch", "toastact"].includes(act)) return;
    switch (act) {
      case "back": back(); break;
      case "close": closeSheet(); break;
      case "inc": setQty(id, (S.basket[id] || 0) + 1, "inc"); break;
      case "dec": setQty(id, (S.basket[id] || 0) - 1, "dec"); break;
      case "gosearch": S.focusSearch = true; switchTab("recherche"); break;
      case "setq": { S.q = t.dataset.q; addRecent(S.q); S.shown.s = 0; const i = $("#q"); if (i) i.value = S.q; const sg = $("#sugg"); if (sg) sg.hidden = true; $("#sres").innerHTML = searchBody(); const c = $(".search .clr"); if (c) c.hidden = !S.q; mountLazy(); window.scrollTo(0, 0); break; }
      case "clearq": { S.q = ""; const i = $("#q"); if (i) { i.value = ""; i.focus(); } t.hidden = true; const sg = $("#sugg"); if (sg) sg.hidden = true; $("#sres").innerHTML = searchBody(); mountLazy(); break; }
      case "clearrecent": S.recent = []; store.set("recent", []); $("#sres").innerHTML = searchBody(); break;
      /* Demande à Cabas : corriger ce qui a été compris, revenir à la phrase, ajouter la réponse, ouvrir la liste */
      case "askfix": askSheet(); break;
      case "askpart": { const o = S.askOff.off; if (o[k]) delete o[k]; else o[k] = 1; S._ask = null; if (t.closest("#sheet")) refreshSheet(); else rerenderList(); break; }
      case "askprice": S.askOff.price = t.dataset.v === "1"; S._ask = null; refreshSheet(); break;
      case "askraw": S.askOff.off = { all: 1 }; S._ask = null; closeSheet(); rerenderList(); break;
      case "askback": S.askOff.off = {}; S._ask = null; rerenderList(); break;
      case "askadd": { const n = Math.max(1, Math.min(99, +t.dataset.n || 1)), p = S.prods.get(id); if (!p) break; addRecent(S.q); setQty(id, (S.basket[id] || 0) + n, "inc"); toast((n > 1 ? n + "\u00a0× " : "") + p.brand + " " + p.name + " au panier", { label: "Voir", run: () => switchTab("panier") }); break; }
      case "askopen": { const C = S._compose; if (!C || !C.rows.length) break; addRecent(S.q); const tx = composeText(C); S.wl = { text: tx, lines: readList(tx) }; store.set("draft", tx); push("#/ecrire"); break; }
      case "askaddall": { const C = S._compose; if (!C || !C.rows.length) break; addRecent(S.q); const items = {}; C.rows.forEach((r) => { items[r.id] = (items[r.id] || 0) + r.n; }); const n = addItems(items, false); renderChrome(); bumpBadge(); toast(plural(n, "produit ajouté", "produits ajoutés") + " au panier", { label: "Voir", run: () => switchTab("panier") }); break; }
      case "sort": sortSheet(k); break;
      case "setsort": F(k).sort = t.dataset.v; closeSheet(); rerenderList(); break;
      case "filters": filterSheet(k); break;
      case "quick": {
        const f = F(k), q = t.dataset.q;
        if (q === "cmp") f.cmp = !f.cmp; else if (q === "promo") f.promo = !f.promo; else if (q === "bio") f.tags.Bio = !f.tags.Bio; else if (q === "mdd") f.type = f.type === "mdd" ? "all" : "mdd"; else if (q === "diet") f.diet = f.diet === false;
        rerenderList(); break;
      }
      case "fret": { const f = F(k); f.ret[id] = !f.ret[id]; refreshSheet(); break; }
      case "fcmp": F(k).cmp = !F(k).cmp; refreshSheet(); break;
      case "fpromo": F(k).promo = !F(k).promo; refreshSheet(); break;
      case "ftype": F(k).type = t.dataset.v; refreshSheet(); break;
      case "ftag": { const f = F(k); f.tags[t.dataset.t] = !f.tags[t.dataset.t]; refreshSheet(); break; }
      case "fbrand": { const f = F(k); f.brand[t.dataset.b] = !f.brand[t.dataset.b]; refreshSheet(); break; }
      case "freset": { const f = F(k); Object.assign(f, { ret: {}, brand: {}, tags: {}, type: "all", cmp: false, promo: false, max: "", bq: "", diet: undefined }); if (sheetCtx) refreshSheet(); else rerenderList(); break; }
      case "zip": zipSheet(); break;
      case "zipok": {
        const v = ($("#zipIn").value || "").replace(/\D/g, "").slice(0, 5);
        if (v && v.length !== 5) { fieldError("zipIn", "Un code postal a 5 chiffres"); break; }
        S.prefs.zip = v;
        const ch = v ? applyAutoPick() : [];
        savePrefs(); if (ch.length) { applyGroups(); renderChrome(); }
        closeSheet(); rerender();
        if (v && !inZone()) toast("Livraison hors Île-de-France pas encore couverte");
        else if (ch.length) { const r = S.allMap.get(pickOf(ch[0], groupsOf()[ch[0]])); toast(`${r.name}\u00a0: ${optionLabel(r).replace(/^./, (c) => c.toLowerCase())}, d'après ton code postal`); }
        break;
      }
      case "maxk": S.prefs.maxOrders = +t.dataset.k; savePrefs(); rerender(); break;
      case "clear": confirmSheet("Vider le panier\u00a0?", "Tous les produits du panier seront retirés.", "Vider le panier", "clearok"); break;
      case "clearok": {
        const undo = snap("basket", "guide", "free");
        S.basket = {}; saveBasket(); S.free = {}; saveFree();
        /* les créneaux des commandes déjà passées restent (« Tes commandes » sur l'accueil) */
        S.guide = { ck: {}, done: {}, when: S.guide.when || {}, broken: S.guide.broken || {}, snooze: S.guide.snooze || {} }; saveGuide();
        closeSheet(); renderChrome(); rerender();
        undoable("Panier vidé", undo, 8000); break;
      }
      case "pick": {
        const g = t.dataset.g, m = S.allMap.get(id), chosen = S.allMap.get(pickOf(g, groupsOf()[g] || [m]));
        if (!m || (S.prefs.comp === false && isPickup(m))) break;
        if (S.prefs.comp === false && isPickup(chosen)) S.prefs.liv = Object.assign({}, S.prefs.liv, { [chosen.id]: id });
        else S.prefs.pick = Object.assign({}, S.prefs.pick, { [g]: id });
        /* choisi à la main : le code postal ne le change plus d'office */
        /* un autre secteur que celui du code postal : choisi à la main, le code postal ne le change plus d'office ; dans
           le même secteur, c'est seulement retrait ou livraison */
        const au = autoPick(S.prefs.zip, g);
        if ((groupsOf()[g] || []).some((x) => x.zips) && !(au && sectorOf(id) === au.id)) S.prefs.pickManual = Object.assign({}, S.prefs.pickManual, { [g]: 1 });
        savePrefs(); applyGroups(); renderChrome(); rerender(); toast(isPickup(m) ? "Point de retrait choisi" : "Zone de livraison choisie"); break;
      }
      case "share": shareGap(id); break;
      case "shareapp": shareApp(); break;
      case "sharesave": shareSavings(); break;
      case "sharegap": shareGap(id); break;
      case "hideinstall": S.seen.install = true; store.set("seen", S.seen); t.closest(".hcard").remove(); break;
      case "reload": location.reload(); break;
      case "install": installSheet(); break;
      case "installnow": installNow(); break;
      case "savelist": nameSheet("Nouvelle liste", "Courses du " + new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "short" }), "savelistok"); break;
      case "savelistok": {
        const nm = ($("#nameIn").value || "").trim() || "Ma liste";
        const L = { id: Date.now().toString(36), name: nm, items: Object.assign({}, S.basket), at: new Date().toISOString().slice(0, 10) };
        const fr = freeList().map((f) => [f.t, f.q]).slice(0, 20);
        if (fr.length) L.free = fr;
        S.lists.unshift(L); saveLists(); closeSheet(); rerender(); toast("Liste enregistrée"); break;
      }
      case "keepsug": { const sg = suggestion(); S.lists.unshift({ id: Date.now().toString(36), name: sg.name, items: Object.assign({}, sg.items), at: new Date().toISOString().slice(0, 10) }); saveLists(); toast("Ajoutée à tes listes"); back(); break; }
      case "addlist": {
        const L = id === "essentiel" ? suggestion() : S.lists.find((x) => x.id === id);
        if (!L) break;
        const n = addItems(L.items, false) + addFree(L.free);
        renderChrome(); bumpBadge();
        toast(plural(n, "produit ajouté", "produits ajoutés") + " au panier", { label: "Voir", run: () => switchTab("panier") });
        if (S.route.name === "home") rerender();
        break;
      }
      case "replacelist": {
        const L = S.lists.find((x) => x.id === id); if (!L) break;
        const undo = snap("basket", "guide", "free");
        addItems(L.items, true); S.free = {}; addFree(L.free);
        S.guide = { ck: {}, done: {}, when: S.guide.when || {}, broken: S.guide.broken || {}, snooze: S.guide.snooze || {} }; saveGuide();
        renderChrome(); switchTab("panier");
        undoable("Panier remplacé par la liste", undo, 8000); break;
      }
      case "renamelist": { const L = S.lists.find((x) => x.id === id); if (L) nameSheet("Renommer", L.name, "renameok", id); break; }
      case "renameok": { const L = S.lists.find((x) => x.id === id); const nm = ($("#nameIn").value || "").trim(); if (L && nm) { L.name = nm; saveLists(); } closeSheet(); rerender(); break; }
      case "dellist": confirmSheet("Supprimer la liste\u00a0?", "La liste sera supprimée de cet appareil. Ton panier ne change pas.", "Supprimer", "delok", id); break;
      case "delok": { const undo = snap("lists"); S.lists = S.lists.filter((x) => x.id !== id); saveLists(); closeSheet(); back(); undoable("Liste supprimée", undo, 5000); break; }
      case "reset": confirmSheet("Effacer mes données\u00a0?", "Le panier, les listes, les recherches récentes et les réglages seront effacés de cet appareil.", "Tout effacer", "resetok"); break;
      case "resetok": S.basket = {}; S.lists = []; S.recent = []; S.prefs = Object.assign({}, PREFS0, { off: { leclerc: true }, fee: {}, pick: {}, pickManual: {}, liv: {}, keep: {}, usual: {}, qty1: {}, diet: {}, lead: {}, pin: {}, ban: {}, allergens: [], offv: 1 }); S.hist = []; S.menu = []; S.guide = { ck: {}, done: {}, when: {} }; S.todo = []; S.free = {}; S.flex = {}; S.cartView = "cmd"; S.wifOpen = false; S.wl = null; S.seen = {}; S.undo = null; S.fixed = null; S.freeEdit = null; S.askOff = null; S._ask = null; S._compose = null; S.fraisAmt = null; S.rq = ""; S.filt = {}; DIETV.v++; S._sug = null; RECM = null; ["basket", "lists", "recent", "prefs", "seen", "hist", "menu", "guide", "free", "todo", "flex"].forEach((x) => store.set(x, x === "lists" || x === "recent" || x === "hist" || x === "menu" || x === "todo" ? [] : {})); store.set("draft", ""); ["seenp", "drops", "ups"].forEach((x) => store.set(x, x === "seenp" ? {} : [])); store.set("seenAt", ""); store.del("univ"); store.del("prepSnooze"); ["facts", "watch", "watchHits", "reports"].forEach((x) => store.del(x)); S.facts = null; FX.pend.clear(); FX.fail.clear(); S.compose = null; S.rep = null; S.cmp = null; S.storeMode = null; S.storeScan = 0; S.xfer = null; S.imp = null; S.prof = null; speakStop(); wakeOff(); applyLook(); savePrefs(); applyGroups(); closeSheet(); renderChrome(); rerender(); toast("Données effacées"); break;
      case "toastact": { const el = $("#toast"), f = el._act; el.hidden = true; el._act = null; S.undo = null; if (f) f(); break; }
      /* scanner */
      case "scantype": scanTypeSheet(); break;
      case "scantypeok": { const v = (($("#eanIn") || {}).value || "").replace(/\D/g, ""); ensureScan().then(() => { if (!Scan.valid(v)) { fieldError("eanIn", "Un code-barres a 13 chiffres, ou 8"); return; } closeSheet(); if (S.route.name !== "scan") push("#/scan"); onCode(v); }, () => toast("Le lecteur de codes-barres n'a pas pu se charger")); break; }
      case "scanclear": SC.items = []; SC.last = ""; scanRender(); break;
      case "scansearch": { S.q = t.dataset.q || ""; addRecent(S.q); S.shown.s = 0; switchTab("recherche"); break; }
      /* repas */
      case "recp": S.recP = Object.assign({}, S.recP, { [id]: +t.dataset.v }); rerender(); break;
      case "menuput": {
        const rc = (S.recs || []).find((x) => x.id === id); if (!rc) break;
        const foyer = S.prefs.foyer ? [2, 4, 6, 8].reduce((a, v) => (Math.abs(v - S.prefs.foyer) < Math.abs(a - S.prefs.foyer) ? v : a), 2) : 0;
        const P = (S.recP && S.recP[id]) || foyer || rc.portions, i = S.menu.findIndex((m) => m.id === id);
        if (i >= 0) S.menu[i].portions = P; else S.menu.push({ id, portions: P });
        saveMenu(); rerender(); toast(i >= 0 ? "Portions mises à jour" : "Ajouté à ma semaine", { label: "Voir", run: () => push("#/repas") }); break;
      }
      case "menudel": { const undo = snap("menu"); S.menu = S.menu.filter((m) => m.id !== id); saveMenu(); rerender(); undoable("Repas retiré", undo, 5000); break; }
      case "menuadd": { const n = addItems(menuItems(), false); renderChrome(); bumpBadge(); toast(plural(n, "produit ajouté", "produits ajoutés") + " au panier", { label: "Voir", run: () => switchTab("panier") }); break; }
      case "recadd": {
        const n = addItems(recItems(id), false);
        renderChrome(); bumpBadge();
        toast(plural(n, "produit ajouté", "produits ajoutés") + " au panier", { label: "Voir", run: () => switchTab("panier") }); break;
      }
      /* une semaine de repas à X € : composer, une autre semaine, la prendre dans « Ma semaine » (avec « Annuler ») */
      case "compose": case "cmagain": {
        const C = S.compose, inp = $("#cmBud"), raw = String(inp ? inp.value : C.bud).trim(), v = numOf(raw);
        if (raw && !(v > 0)) { fieldError("cmBud", "Un montant en euros, par exemple 40"); break; }
        C.bud = raw; C.seed = act === "cmagain" ? C.seed + 1 : 0;
        C.res = composeMenu({ budget: v > 0 ? Math.round(Math.min(v, 2000) * 100) : 0, meals: C.meals, people: C.people, seed: C.seed });
        const el = $("#cmres"); if (el) { el.innerHTML = weekRes(C.res); markEnds(); }
        if (act === "compose" && el && el.firstElementChild) el.firstElementChild.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
        break;
      }
      case "cmmeals": case "cmpeople": { const C = S.compose; C[act === "cmmeals" ? "meals" : "people"] = +t.dataset.v; C.res = null; rerenderKeep(t); break; }
      case "cmtake": {
        const R = S.compose && S.compose.res; if (!R || !R.list.length) break;
        const undo = snap("menu");
        S.menu = R.list.map((x) => ({ id: x.rc.id, portions: Math.min(40, x.portions) }));
        saveMenu(); S.compose.res = null; rerender();
        undoable(`Ta semaine\u00a0: ${plural(R.picks.length, "repas", "repas")}`, undo, 6000); break;
      }
      /* Nutri-Score et allergènes demandés d'un geste (réglage décoché, ou après un échec) */
      case "factsget": {
        const p = S.prods.get(id); if (!p) break;
        FX.fail.delete(eanKey(p.ean));
        const upd = () => { const el = $("#pfacts"); if (el && S.route.name === "produit") el.innerHTML = factsHtml(p); };
        factsFetch(p).then(upd, upd); upd(); break;
      }
      case "allergchip": {
        const A = allergSet(), k2 = t.dataset.k; if (!ALLERG.has(k2)) break;
        S.prefs.allergens = A.includes(k2) ? A.filter((x) => x !== k2) : A.concat([k2]);
        savePrefs(); DIETV.v++; S._sug = null; RECM = null;
        for (const k of Object.keys(S.filt)) S.filt[k].diet = undefined;
        if (S.wl && S.wl.lines) { S.wl.lines = readList(S.wl.text); S.wl.planApplied = false; }
        refreshSheet(); break;
      }
      /* comparer deux produits */
      case "cmppick": cmpSheet(id); break;
      case "cmptake": {
        const o = t.dataset.o, p = S.prods.get(id); if (!p) break;
        const undo = snap("basket"), q = (S.basket[o] || 0) > 0 ? S.basket[o] : 0;
        if (q) { S.basket[id] = Math.min(99, (S.basket[id] || 0) + q); delete S.basket[o]; } else S.basket[id] = Math.max(1, S.basket[id] || 0);
        saveBasket(); renderChrome(); bumpBadge(); rerender();
        undoable(q ? `${pname(p)} remplace l'autre au panier` : `${pname(p)} au panier`, undo, 6000); break;
      }
      /* préviens-moi : seuil de prix par produit */
      case "watch": watchSheet(id); break;
      case "watchlist": watchListSheet(); break;
      case "watchset": { const i = $("#watchIn"); if (i) { i.value = frNum(+t.dataset.v / 100); i.focus(); } break; }
      case "watchok": {
        const p = S.prods.get(id); if (!p) break;
        const raw = String(($("#watchIn") || {}).value || "").trim(), v = numOf(raw);
        if (!(v > 0 && v < 1000)) { fieldError("watchIn", "Un prix en euros, par exemple 1,50"); break; }
        const W = watchAll(), b = bestReal(p), max = Math.round(v * 100);
        W[p.id] = { max, at: isoDay(new Date()), from: b ? Math.round(b.price * 100) : max };
        store.set("watch", W);
        const hit = watchCheck()[p.id];
        closeSheet(); rerender();
        toast(hit ? `C'est déjà le cas\u00a0: ${eurC(hit.c)} chez ${retName(hit.ret)}` : `Cabas te préviendra sous ${eurC(max)}`, null, "check"); break;
      }
      case "watchdel": case "watchrm": {
        const W = watchAll(), before = JSON.parse(JSON.stringify(W)), key = Object.keys(W).find((k) => k === id || liveId(k) === id); if (!key) break;
        delete W[key]; store.set("watch", W); watchCheck();
        if (act === "watchdel") closeSheet(); else refreshSheet();
        rerender();
        undoable("Tu ne suis plus ce prix", () => { store.set("watch", before); watchCheck(); }, 5000); break;
      }
      case "watchseen": { const H = store.get("watchHits", {}); Object.keys(H).forEach((k) => { H[k].seen = true; }); store.set("watchHits", H); rerender(); break; }
      /* signaler ou demander : gardé sur le téléphone, puis, si la personne le veut, ouvert sur GitHub */
      case "report": reportSheet(id || null, t.dataset.k, t.dataset.q); break;
      case "reports": reportsSheet(); break;
      case "repk": S.rep.k = t.dataset.k; refreshSheet(); break;
      case "repret": S.rep.ret = t.dataset.v; refreshSheet(); break;
      case "repok": {
        const R = S.rep; if (!R) break;
        R.text = String(($("#repT") || {}).value || "").trim().slice(0, 500);
        if (!R.pid && !R.text) { fieldError("repT", "Dis en quelques mots ce que tu demandes"); break; }
        const rep = { id: "r" + Date.now().toString(36), at: new Date().toISOString(), k: R.k, pid: R.pid || "", ret: R.ret || "", text: R.text };
        store.set("reports", reportsAll().concat([rep]).slice(-50));
        R.id = rep.id; refreshSheet(); buzz("add"); break;
      }
      case "repsend": closeSheet(); { const r = reportsAll().find((x) => x.id === id); if (r) reportSheet(r.pid && liveId(r.pid), r.k, r.text, r.id); } break;
      case "repsent": { const L = reportsAll(), r = L.find((x) => x.id === id); if (r) { r.sent = new Date().toISOString(); store.set("reports", L); } setTimeout(closeSheet, 300); break; }
      case "reprm": {
        const before = reportsAll(); store.set("reports", before.filter((x) => x.id !== id)); refreshSheet();
        undoable("Signalement retiré", () => store.set("reports", before), 5000); break;
      }
      /* premier lancement */
      case "welcome": welcomeSheet(); break;
      case "wskip": closeSheet(); break;
      case "wret": { const k = t.dataset.k; if (S.prefs.off[k]) delete S.prefs.off[k]; else S.prefs.off[k] = true; savePrefs(); freeCheck(); refreshSheet(); break; }
      case "wmove": S.prefs.comp = t.dataset.v === "1"; savePrefs(); freeCheck(); refreshSheet(); break;
      case "wfoyer": S.prefs.foyer = +t.dataset.v; savePrefs(); if ($("#sheet").hidden) rerender(); else refreshSheet(); break;
      /* mon régime : dans les réglages (feuille) ou dans les questions de départ (chips) ; tout ce qui en dépend oublie ses résultats */
      case "diet": dietSheet(); break;
      case "dietchip": case "wdiet": {
        const d = Object.assign({}, S.prefs.diet); if (d[t.dataset.k]) delete d[t.dataset.k]; else d[t.dataset.k] = true;
        S.prefs.diet = d; savePrefs(); DIETV.v++; S._sug = null; RECM = null;
        for (const k of Object.keys(S.filt)) S.filt[k].diet = undefined;
        if (S.wl && S.wl.lines) { S.wl.lines = readList(S.wl.text); S.wl.planApplied = false; }
        refreshSheet(); break;
      }
      /* rayons par univers : aller à un univers (et l'ouvrir), effacer le filtre de rayons */
      case "univgo": { const d = $("#univ-" + CSS.escape(t.dataset.u)); if (d) { d.open = true; d.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" }); } break; }
      case "clearrq": { S.rq = ""; const i = $("#rq"); if (i) { i.value = ""; i.focus(); } t.hidden = true; $("#rlist").innerHTML = rayonsBody(""); markEnds(); break; }
      case "wsect": {
        /* même secteur, même façon de recevoir : livraison à domicile si c'était le choix, sinon le point de retrait */
        const G = groupsOf().auchan || [], cur = S.allMap.get(pickOf("auchan", G)), r = S.allMap.get(id);
        S.prefs.pick = Object.assign({}, S.prefs.pick, { auchan: cur && !isPickup(cur) && r && r.livraison ? r.livraison : id });
        const au = autoPick(S.prefs.zip, "auchan");
        if (!(au && au.id === id)) S.prefs.pickManual = Object.assign({}, S.prefs.pickManual, { auchan: 1 });
        savePrefs(); refreshSheet(); break;
      }
      case "wok": applyGroups(); closeSheet(); renderChrome(); rerender(); toast("C'est noté"); break;
      /* affichage, budget, magasin */
      case "zoomdec": if (t.getAttribute("aria-disabled") !== "true") setZoom(-1); break;
      case "theme": S.prefs.theme = t.dataset.v; savePrefs(); applyLook(); if (t.closest("#sheet")) refreshSheet(); else rerenderKeep(t); break;
      case "wsimple": S.prefs.simple = !S.prefs.simple; savePrefs(); applyLook(); refreshSheet(); break;
      case "wcontrast": S.prefs.contrast = !contrastOn(); savePrefs(); applyLook(); refreshSheet(); break;
      case "zoominc": if (t.getAttribute("aria-disabled") !== "true") setZoom(1); break;
      case "budget": budgetSheet(); break;
      case "budok": { const raw = String(($("#budIn") || {}).value || "").trim(), v = numOf(raw); if (raw && !(v > 0)) { fieldError("budIn", "Un montant en euros, par exemple 120"); break; } S.prefs.budget = v > 0 ? Math.min(v, 20000) : ""; if (S.budMode) S.prefs.budgetMode = S.budMode; savePrefs(); closeSheet(); rerender(); break; }
      case "budmode": { const i = $("#budIn"); if (i) S.budDraft = i.value; S.budMode = t.dataset.v === "mois" ? "mois" : "panier"; refreshSheet(); break; }
      case "budfit": budgetFitSheet(); break;
      case "budswap": {
        const res = cartResult(), total = cartTotal(), lim = basketLimit(), T = swapTotals(res);
        const C = total != null && lim != null && T.ex ? fitChain(res, total, lim, budgetFit(lim, total, T.sw, T.ex).cands) : null;
        if (!C || C.wait || !C.chosen.length) break;
        const undo = snap("basket"), sp0 = S.swapPrev;
        S.basket = swapBasket(C.chosen); saveBasket();
        S.swapPrev = { total, key: JSON.stringify(S.basket) };
        renderChrome(); rerender(); refreshSheet();
        undoable(plural(C.chosen.length, "produit remplacé", "produits remplacés"), () => { undo(); S.swapPrev = sp0; if (sheetCtx && sheetCtx.aux) auxPaint(); }, 6000); break;
      }
      /* panier intelligent : où prendre un produit, panier souple, tableau, Et si, compléter */
      case "itemopt": itemSheet(id); break;
      case "itempin": {
        const g = t.dataset.g, P = Object.assign({}, S.prefs.pin);
        if (g) { P[id] = g; const B = Object.assign({}, S.prefs.ban); if (B[id] && B[id][g]) { const b = Object.assign({}, B[id]); delete b[g]; if (Object.keys(b).length) B[id] = b; else delete B[id]; S.prefs.ban = B; } }
        else delete P[id];
        S.prefs.pin = P; savePrefs(); refreshSheet(); break;
      }
      case "itemban": {
        const g = t.dataset.g, B = Object.assign({}, S.prefs.ban), b = Object.assign({}, B[id]);
        if (b[g]) delete b[g]; else { b[g] = true; if (pinOf(id) === g) { const P = Object.assign({}, S.prefs.pin); delete P[id]; S.prefs.pin = P; } }
        if (Object.keys(b).length) B[id] = b; else delete B[id];
        S.prefs.ban = B; savePrefs(); refreshSheet(); break;
      }
      case "itemflexe": {
        const e = t.dataset.e, F = Object.assign({}, S.flex), L = (F[id] || []).slice(), i = L.indexOf(e);
        if (i >= 0) L.splice(i, 1); else L.push(e);
        if (L.length) F[id] = L; else delete F[id];
        S.flex = F; saveFlex(); refreshSheet(); break;
      }
      case "flex": flexSheet(); break;
      case "flextg": flexSet(id, !(S.flex || {})[id]); refreshSheet(); break;
      case "flexall": { const on = t.dataset.v === "1"; Object.keys(S.basket).filter((x) => S.basket[x] > 0 && S.prods.has(x)).forEach((x) => flexSet(x, on)); refreshSheet(); break; }
      case "cview": S.cartView = t.dataset.v === "tab" ? "tab" : "cmd"; rerenderKeep(t); break;
      case "wifgo": {
        const w = t.dataset.w, g = t.dataset.g, mode = RES.mode, undo = snap("prefs", "flex");
        let label = "";
        if (w === "sans" && g) { S.prefs.off = Object.assign({}, S.prefs.off, { [g]: true }); label = groupName(g) + " n'est plus utilisé"; }
        else if (w === "k1") { S.prefs.maxOrders = 1; label = "Une seule commande"; }
        else if (w === "mode") { S.prefs.comp = !mode; label = mode ? "Tout est livré chez toi" : "Achats en magasin et retrait permis"; }
        else if (w === "exact") { const F = Object.assign({}, S.flex); Object.keys(S.basket).forEach((x) => delete F[x]); S.flex = F; saveFlex(); label = "Panier exact, sans équivalents"; }
        else if (w === "free") { const P = Object.assign({}, S.prefs.pin), B = Object.assign({}, S.prefs.ban); Object.keys(S.basket).forEach((x) => { delete P[x]; delete B[x]; }); S.prefs.pin = P; S.prefs.ban = B; label = "Choix d'enseigne retirés"; }
        else break;
        savePrefs(); applyGroups(); freeCheck(true); renderChrome(); window.scrollTo(0, 0); rerender(); focusView();
        undoable(label, () => { undo(); applyGroups(); }, 6000); break;
      }
      case "topup": topupSheet(id); break;
      case "topadd": {
        const p = S.prods.get(id), before = S.basket[id] || 0;
        if (!p) break;
        setQty(id, before + 1, "inc"); renderChrome(); bumpBadge(); refreshSheet();
        undoable(pname(p) + " ajouté", () => { if (before) S.basket[id] = before; else delete S.basket[id]; saveBasket(); if (sheetCtx && sheetCtx.aux) auxPaint(); }, 6000); break;
      }
      case "shop": S.storeMode = "mag"; push("#/magasin"); break;
      case "shopck": {
        const key = "mag|" + (t.dataset.f ? "f:" + t.dataset.f : t.dataset.p), on = !S.guide.ck[key];
        if (on) S.guide.ck[key] = 1; else delete S.guide.ck[key];
        saveGuide(); buzz(on ? "add" : "remove");
        if (S.route.name === "magasin") { rerenderKeep(t); const L = storeItems(storeMode()); if (on && L.length && L.every((x) => S.guide.ck[storeKey(x)])) { buzz("done"); toast("Tout est dans ton panier", null, "check"); } }
        break;
      }
      case "shopall": S.storeMode = null; push("#/magasin"); break;
      case "storemode": S.storeMode = t.dataset.v === "all" ? "all" : "mag"; rerenderKeep(t); break;
      case "storereset": { const undo = snap("guide"); Object.keys(S.guide.ck).filter((x) => x.startsWith("mag|")).forEach((x) => delete S.guide.ck[x]); saveGuide(); rerender(); undoable("Tout est décoché", undo, 5000); break; }
      case "storescan": S.storeScan = Date.now(); push("#/scan"); break;
      case "print": window.print(); break;
      case "export": exportFile(); break;
      case "import": { const i = $("#impIn"); if (i) { i.value = ""; i.click(); } break; }
      case "impok": { const R = S.imp; closeSheet(); S.imp = null; if (R && R.ok) applyImport(R.data, "Copie restaurée"); break; }
      case "xfer": {
        packLink().then((x) => {
          const url = location.origin + location.pathname + "#/transfert/" + x;
          if (url.length > 60000) { toast("Trop de données pour un lien\u00a0: enregistre plutôt une copie en fichier"); return; }
          shareText("Mes données Cabas", "Ouvre ce lien sur ton autre téléphone pour y retrouver ton panier, tes listes et tes réglages. Il contient tes données\u00a0: ne l'envoie qu'à toi.", url);
        });
        break;
      }
      case "xferok": { const X = S.xfer; if (X && X.R && X.R.ok) { S.xfer = null; applyImport(X.R.data, "Données de l'autre téléphone reprises"); } break; }
      case "xferno": S.xfer = null; history.replaceState(null, "", location.pathname + "#/"); S.stacks.accueil = ["#/"]; S.tab = "accueil"; navigate("#/", "tab"); toast("Rien n'a changé"); break;
      case "speak": speak(speakText(k, id)); break;
      case "voice": S.prefs.voice = t.dataset.v === "slow" ? "slow" : "normal"; savePrefs(); rerenderKeep(t); if (TTS()) { speakStop(); speak("Voici la lecture " + (S.prefs.voice === "slow" ? "lente." : "normale.")); } break;
      /* liste écrite ou dictée */
      case "wlplan": {
        const W = S.wl, plan = W && W.plan;
        if (!plan) break;
        for (const pk of plan.picks) if (pk.id) { pk.line.pick = pk.id; pk.line.n = pk.n; }
        rerender(); toast("Produits choisis pour la commande la moins chère"); break;
      }
      case "wlex": {
        const ex = EXAMPLES.find((x) => x[0] === t.dataset.k);
        if (!ex) break;
        S.wl = { text: ex[2], lines: readList(ex[2]) };
        store.set("draft", ex[2]);
        push("#/ecrire");
        break;
      }
      case "prof": { S.prof = k; const el = $("#profs"); if (el) { el.innerHTML = profHtml(); const b = $(`[data-act="prof"][data-k="${CSS.escape(k)}"]`, el); if (b) b.focus(); } break; }
      case "wlprof": {
        const x = PROF && PROF.listes.find((y) => y.k === k);
        if (!x) break;
        S.wl = { text: x.text.split(/,(?!\d)/).map((l) => l.trim()).filter(Boolean).join("\n"), lines: null };
        S.wl.lines = readList(S.wl.text);
        store.set("draft", S.wl.text);
        push("#/ecrire");
        break;
      }
      case "wlmic": micStart(); break;
      case "wlpaste": {
        navigator.clipboard.readText().then((tx) => {
          tx = String(tx || "").replace(/\r/g, "").trim().slice(0, 4000);
          if (!norm(tx)) { toast("Rien à coller\u00a0: copie d'abord ta liste"); return; }
          const cur = (($("#wlIn") || {}).value || "").trim(), text = cur ? cur + "\n" + tx : tx;
          micStop(); listFrom(text);
        }, () => toast("Cabas n'a pas pu lire le presse-papiers\u00a0: appuie longuement dans le champ, puis «\u00a0Coller\u00a0»"));
        break;
      }
      case "wlgo": {
        micStop();
        const tx = ($("#wlIn") || {}).value || "";
        /* un panier collé à la main dans le champ (appui long, « Coller ») est nettoyé comme par « Coller ma liste » */
        const C = cleanPaste(tx), prev = S.wl && S.wl.paste && S.wl.text === tx ? S.wl.paste : null;
        if (C.paste && C.lines.length) { listFrom(tx); break; }
        S.wl = { text: tx, lines: readList(tx), paste: prev };
        store.set("draft", tx);
        if (!S.wl.lines.length) { S.wl.lines = null; toast("Écris au moins un produit"); break; }
        window.scrollTo(0, 0); rerender(); break;
      }
      case "wledit": if (S.wl) S.wl.lines = null; rerender(); break;
      case "wlinc": { const x = S.wl && S.wl.lines[+t.dataset.i]; if (x) { x.n = Math.min(99, x.n + 1); if (x.free && S.free[x.free]) { S.free[x.free].q = x.n; saveFree(); } rerender(); } break; }
      case "wldec": { const L = S.wl && S.wl.lines, i = +t.dataset.i, x = L && L[i]; if (x) { if (x.n > 1) { x.n--; if (x.free && S.free[x.free]) { S.free[x.free].q = x.n; saveFree(); } } else wlRemove(i); rerender(); } break; }
      case "wlalt": wlAltSheet(+t.dataset.i); break;
      case "wlpick": {
        /* le choix est mémorisé pour cette ligne (« lait » = ce produit), sauf « Juste cette fois » */
        const x = S.wl && S.wl.lines[+t.dataset.i];
        if (!x) { closeSheet(); break; }
        x.pick = id; x.usualAlt = null;
        const key = norm(x.q);
        closeSheet(); rerender();
        if (key && S.prods.has(id)) {
          S.prefs.usual = Object.assign({}, S.prefs.usual, { [key]: { id, at: new Date().toISOString().slice(0, 10) } }); savePrefs();
          toast(`Choix mémorisé pour «\u00a0${x.q}\u00a0»`, { label: "Juste cette fois", run: () => { const U = Object.assign({}, S.prefs.usual); delete U[key]; S.prefs.usual = U; savePrefs(); toast("Choix pas mémorisé"); } });
        }
        break;
      }
      case "wlusual": { const x = S.wl && S.wl.lines[+t.dataset.i]; if (x && x.usualAlt) { x.pick = x.usualAlt.id; x.n = x.usualAlt.n; x.pool = [[x.pick, x.n]]; x.usual = true; x.usualAlt = null; x.usualDiet = false; rerender(); } break; }
      case "wlqty1": {
        const x = S.wl && S.wl.lines[+t.dataset.i], p = x && S.prods.get(x.pick);
        if (!p) break;
        S.prefs.qty1 = Object.assign({}, S.prefs.qty1, { [p.r]: 1 }); savePrefs();
        for (const y of S.wl.lines) { const py = y.pick && S.prods.get(y.pick); if (py && py.r === p.r && y.why) { y.n = 1; y.why = null; } }
        rerender(); toast(`Toujours 1 pour le rayon ${((rayon(p.r) || {}).name || "").toLowerCase()}`); break;
      }
      case "wlfix": {
        /* « Tu voulais dire… ? Oui » : la ligne corrigée remplace la ligne écrite, dans la liste et dans le brouillon */
        const W = S.wl, L = W && W.lines, i = +t.dataset.i, x = L && L[i];
        if (!x || !x.fixRaw) break;
        L.splice(i, 1, ...splitLine(x.fixRaw));
        W.text = (W.text || "").replace(x.raw, x.fixRaw); store.set("draft", W.text);
        rerender(); break;
      }
      case "wlfree": freeSheet(+t.dataset.i); break;
      case "wlsearch": { const x = S.wl && S.wl.lines[+t.dataset.i]; S.q = x ? x.q || x.raw : ""; addRecent(S.q); S.shown.s = 0; switchTab("recherche"); break; }
      case "wladd": {
        const n = addItems(wlItems(), false);
        S.wl = null; store.set("draft", "");
        renderChrome(); bumpBadge(); switchTab("panier");
        toast(plural(n, "produit ajouté", "produits ajoutés") + " au panier"); break;
      }
      case "wlsave": nameSheet("Nouvelle liste", "Ma liste du " + new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "short" }), "wlsaveok"); break;
      case "wlsaveok": {
        const nm = ($("#nameIn").value || "").trim() || "Ma liste";
        const L = { id: Date.now().toString(36), name: nm, items: wlItems(), at: new Date().toISOString().slice(0, 10) }, fr = wlFree();
        if (fr.length) L.free = fr;
        S.lists.unshift(L);
        saveLists(); closeSheet(); toast("Liste enregistrée", { label: "Voir", run: () => switchTab("listes") }); break;
      }
      /* remplacements moins chers */
      case "swaps": swapSheet(); break;
      case "swaptg": S.swSel[id] = !S.swSel[id]; refreshSheet(); break;
      case "swapok": {
        buzz("done");
        const undo = snap("basket", "prefs"), sp0 = S.swapPrev;
        const sw = swaps(), st = RES.steps[RES.K], prev = st && st.full ? fullTotal(st.full) : null;
        let n = 0;
        for (const x of sw) {
          if (S.swSel[x.from.id]) { const q = S.basket[x.from.id]; delete S.basket[x.from.id]; S.basket[x.to.id] = Math.min(99, (S.basket[x.to.id] || 0) + q); n++; }
          else S.prefs.keep = Object.assign({}, S.prefs.keep, { [x.from.id]: 1 });
        }
        saveBasket(); savePrefs();
        S.swapPrev = prev != null && n ? { total: prev, key: JSON.stringify(S.basket) } : null;
        closeSheet(); renderChrome(); rerender();
        undoable(n ? plural(n, "produit remplacé", "produits remplacés") : "Marques gardées", () => { undo(); S.swapPrev = sp0; }, 5000); break;
      }
      case "usual": usualSheet(); break;
      case "usualdel": { const U = Object.assign({}, S.prefs.usual); delete U[t.dataset.k]; S.prefs.usual = U; savePrefs(); if (usualCount()) refreshSheet(); else closeSheet(); break; }
      case "keepdel": { const K = Object.assign({}, S.prefs.keep); delete K[t.dataset.k]; S.prefs.keep = K; savePrefs(); if (usualCount()) refreshSheet(); else closeSheet(); break; }
      case "qty1del": { const Q = Object.assign({}, S.prefs.qty1); delete Q[t.dataset.k]; S.prefs.qty1 = Q; savePrefs(); if (usualCount()) refreshSheet(); else closeSheet(); break; }
      case "usualreset": { const undo = snap("prefs", "flex"); S.prefs.usual = {}; S.prefs.keep = {}; S.prefs.qty1 = {}; S.prefs.pin = {}; S.prefs.ban = {}; S.flex = {}; savePrefs(); saveFlex(); closeSheet(); rerender(); undoable("Choix et marques oubliés", undo, 5000); break; }
      case "ruledel": { const P = Object.assign({}, S.prefs.pin), B = Object.assign({}, S.prefs.ban); delete P[t.dataset.k]; delete B[t.dataset.k]; S.prefs.pin = P; S.prefs.ban = B; savePrefs(); if (usualCount()) refreshSheet(); else closeSheet(); break; }
      case "flexdel": { const F = Object.assign({}, S.flex); delete F[t.dataset.k]; S.flex = F; saveFlex(); if (usualCount()) refreshSheet(); else closeSheet(); break; }
      /* remplir mes paniers (les gestes de l'ancienne commande guidée y mènent aussi) */
      case "fillgo": case "guide": case "fill": {
        const s = ensureSnap();
        if (act === "fillgo" && s && s.orders.length > 1) { push("#/remplir"); break; }
        const rid = id || (s && (fillNext() || s.orders[0]).rid);
        push(rid ? "#/remplir/" + encodeURIComponent(rid) : "#/remplir");
        break;
      }
      case "fillready": case "fillfirst": {
        const F = Object.assign({}, S.seen.first), k = offKey(S.allMap.get(id));
        if (act === "fillready") F[k] = 1; else delete F[k];
        S.seen.first = F; store.set("seen", S.seen); window.scrollTo(0, 0); rerender(); focusView(); break;
      }
      case "firstreset": S.seen.first = {}; store.set("seen", S.seen); rerender(); toast("Les étapes reviendront chez chaque enseigne"); break;
      /* le lien s'ouvre (nouvel onglet) ; au retour dans l'appli, le produit sera coché */
      case "fillopen": S.guide.open = { rid: id, id: t.dataset.p, at: Date.now() }; S.guide.opened = Object.assign({}, S.guide.opened, { [id + "|" + t.dataset.p]: 1 }); saveGuide(); break;
      case "guideck": case "fillck": {
        const o = fillOrd(id);
        if (!o) break;
        const k = id + "|" + t.dataset.p, on = !S.guide.ck[k], main = !t.closest(".gi");
        if (on) { S.guide.ck[k] = 1; buzz("add"); if (main) fillAdvance(o); } else delete S.guide.ck[k];
        if (S.guide.open && S.guide.open.rid === id && S.guide.open.id === t.dataset.p) S.guide.open = null;
        saveGuide(); renderChrome();
        const st = ordState(o);
        /* le dernier produit coché : le récapitulatif, en haut de page */
        if (on && st.k === st.n) { buzz("done"); window.scrollTo(0, 0); rerender(); focusView(); break; }
        if (main) rerenderKeep(null, "#fpn"); else rerenderKeep(t);
        break;
      }
      case "fillstep": case "fillat": {
        const o = fillOrd(id);
        if (!o) break;
        const st = ordState(o), i = act === "fillat" ? +t.dataset.v : curIdx(o, st) + +t.dataset.v;
        S.guide.cur = Object.assign({}, S.guide.cur, { [id]: Math.max(0, Math.min(st.n - 1, i)) }); saveGuide();
        if (act === "fillat") { window.scrollTo(0, 0); rerenderKeep(null, "#fpn"); } else rerenderKeep(t, "#fpn");
        break;
      }
      case "fillmiss": fillMissSheet(id, t.dataset.p); break;
      /* « Le lien n'ouvre pas le bon produit » : la recherche s'ouvre (lien de la feuille), Cabas s'en souvient */
      case "fillbroken": {
        S.guide.broken = Object.assign({}, S.guide.broken, { [id + "|" + t.dataset.p]: isoDay(new Date()) });
        S.guide.open = { rid: id, id: t.dataset.p, at: Date.now() }; saveGuide();
        setTimeout(() => { closeSheet(); rerender(); }, 0); break;
      }
      case "fillequiv": {
        const e = S.prods.get(t.dataset.e), rid = id, pid = t.dataset.p;
        if (!e || !e.offers[rid]) { closeSheet(); break; }
        fillEdit(rid, pid, (o, x, i) => {
          const q = x.q, cost = Math.round(e.offers[rid].price * 100) * q, dup = o.items.find((y) => y !== x && y.id === e.id && !y.st);
          if (dup) { dup.q += q; dup.cost += cost; o.items.splice(i, 1); } else Object.assign(x, { id: e.id, cost, nm: pname(e), f: e.format || "", was: pid });
          const bq = S.basket[pid] || 0;
          if (bq > q) S.basket[pid] = bq - q; else delete S.basket[pid];
          S.basket[e.id] = Math.min(99, (S.basket[e.id] || 0) + q); saveBasket();
        }, "Remplacé par " + pname(e), ["guide", "basket"]);
        break;
      }
      case "fillmove": {
        const to = t.dataset.to, o2 = fillOrd(to), p = S.prods.get(t.dataset.p);
        if (!o2 || !p || !p.offers[to]) { closeSheet(); break; }
        fillEdit(id, t.dataset.p, (o, x, i) => {
          o.items.splice(i, 1);
          const cost = Math.round(p.offers[to].price * 100) * x.q, ex = o2.items.find((y) => y.id === x.id && !y.st);
          if (ex) { ex.q += x.q; ex.cost += cost; } else o2.items.push(Object.assign({}, x, { cost, from: id }));
        }, "Déplacé chez " + retName(to));
        break;
      }
      case "fillmag": { const p = S.prods.get(t.dataset.p); fillEdit(id, t.dataset.p, (o, x) => { const m = magFor(p, x.q); if (!m) return false; x.st = "mag"; x.mag = m; return true; }, "À acheter en magasin"); break; }
      case "fillskip": fillEdit(id, t.dataset.p, (o, x) => { x.st = "skip"; S.todo.push({ id: x.id, q: x.q, from: id, at: isoDay(new Date()) }); saveTodo(); }, "Laissé de côté pour ton prochain panier", ["guide", "todo"]); break;
      case "guidedone": case "filldone": {
        const undo = snap("guide", "hist");
        S.guide.done = Object.assign({}, S.guide.done, { [id]: 1 });
        if (S.guide.drop) delete S.guide.drop[id];
        recordFill(); saveGuide(); buzz("done"); closeSheet(); renderChrome(); window.scrollTo(0, 0); rerender(); focusView();
        const s = snapOf();
        undoable(s && finished(s) ? "Toutes tes commandes sont passées" : "Commande " + retName(id) + " notée", undo, 6000);
        break;
      }
      case "guideundo": case "fillundone": case "fillundrop": {
        const k = act === "fillundrop" ? "drop" : "done", D = Object.assign({}, S.guide[k]);
        delete D[id]; S.guide[k] = D; unrecord(); saveGuide(); renderChrome(); rerender(); break;
      }
      case "filldrop": { const undo = snap("guide", "hist"); S.guide.drop = Object.assign({}, S.guide.drop, { [id]: 1 }); recordFill(); saveGuide(); renderChrome(); rerender(); undoable("Commande " + retName(id) + " pas passée", undo, 6000); break; }
      case "guidecopy": case "fillcopy": copyText(fillText(id || ""), id ? "Liste " + retName(id) + " copiée" : "Listes copiées"); break;
      case "fillshare": shareText("Mes courses", fillText()); break;
      case "fillname": { const o = fillOrd(id), x = o && o.items.find((y) => y.id === t.dataset.p); if (x) copyText(x.nm, "Nom copié"); break; }
      /* sur ordinateur : un onglet par produit qui reste ; le navigateur peut en bloquer, Cabas le dit */
      case "fillall": {
        const o = fillOrd(id);
        if (!o) break;
        const todo = ordState(o).L.filter((x) => !ckOf(id, x.id));
        let n = 0;
        for (const x of todo) {
          const w = window.open("about:blank", "_blank");
          if (!w) break;
          try { w.opener = null; w.location.href = fillLink(id, x).url; } catch (err) { w.close(); break; }
          n++; S.guide.opened = Object.assign({}, S.guide.opened, { [id + "|" + x.id]: 1 });
        }
        S.guide.open = null; saveGuide();
        toast(n < todo.length ? `${n} sur ${plural(todo.length, "onglet ouvert", "onglets ouverts")}\u00a0: autorise les fenêtres pour Cabas dans ton navigateur, puis réessaie.` : `${plural(n, "onglet ouvert", "onglets ouverts")}\u00a0: ajoute chaque produit, puis coche-le ici.`, null, null, 6000);
        break;
      }
      case "fillresnap": {
        const s = snapOf(), ns = fillSnap();
        if (!s || !ns) break;
        const undo = snap("guide");
        /* une commande passée le reste si ses produits n'ont pas changé */
        const items = (o) => JSON.stringify(o.items.filter((x) => !x.st).map((x) => [x.id, x.q]).sort());
        const D = {};
        ns.orders.forEach((o) => { const old = s.orders.find((x) => x.rid === o.rid); if (old && S.guide.done[o.rid] && items(old) === items(o)) D[o.rid] = 1; });
        S.guide = Object.assign({}, S.guide, { snap: ns, done: D, drop: {}, cur: {}, rec: "" }); saveGuide(); renderChrome(); rerender();
        undoable("Liste mise à jour avec le panier actuel", undo, 6000); break;
      }
      case "fillstop": { const undo = snap("guide"), g = S.guide; S.guide = { ck: {}, done: {}, when: g.when || {}, broken: g.broken || {}, snooze: g.snooze || {} }; saveGuide(); renderChrome(); rerender(); undoable("Remplissage arrêté", undo, 6000); break; }
      case "leads": leadSheet(); break;
      case "leadset": S.prefs.lead = Object.assign({}, S.prefs.lead, { [id]: +t.dataset.v }); savePrefs(); refreshSheet(); break;
      case "brokenclear": { const undo = snap("guide"); S.guide.broken = {}; saveGuide(); rerender(); undoable("Liens tous reproposés", undo, 5000); break; }
      case "when": whenSheet(id); break;
      case "whend": S.guide.when = Object.assign({}, S.guide.when, { [id]: Object.assign({}, (S.guide.when || {})[id], { d: t.dataset.d }) }); saveWhen(); refreshSheet(); break;
      case "whens": S.guide.when = Object.assign({}, S.guide.when, { [id]: Object.assign({}, (S.guide.when || {})[id], { s: t.dataset.s }) }); saveWhen(); refreshSheet(); break;
      case "whenno": { const W = Object.assign({}, S.guide.when); delete W[id]; S.guide.when = W; saveWhen(); closeSheet(); break; }
      case "ics": downloadIcs(id, t.dataset.d, t.dataset.s); break;
      /* le panier de la semaine */
      case "prepgo": {
        const P = prepNow(); if (!P) break;
        const undo = snap("basket", "todo"), items = Object.assign({}, P.D.items);
        for (const x of S.todo) if (S.prods.has(x.id)) items[x.id] = Math.min(99, (items[x.id] || 0) + x.q);
        const n = addItems(items, false); S.todo = []; saveTodo();
        renderChrome(); bumpBadge(); switchTab("panier");
        undoable("Panier de la semaine ajouté, " + plural(n, "produit", "produits"), undo, 8000); break;
      }
      case "prepskip": { const was = store.get("prepSnooze", ""); store.set("prepSnooze", isoDay(new Date())); rerender(); undoable("Pas cette fois : Cabas te le reproposera", () => store.set("prepSnooze", was), 5000); break; }
      case "prepsee": { const L = keepTpl(); if (L) push("#/liste/" + L.id); break; }
      case "shopdays": shopDaySheet(); break;
      case "shopday": { const v = +t.dataset.v; S.prefs.shopDay = v >= 0 && v <= 6 ? v : null; savePrefs(); refreshSheet(); break; }
      case "cad": cadSheet(t.dataset.l, id); break;
      case "cadset": { const L = S.lists.find((x) => x.id === t.dataset.l), v = +t.dataset.v; if (!L) break; const C = Object.assign({}, L.cad); if (v > 0) C[id] = v; else delete C[id]; L.cad = C; saveLists(); refreshSheet(); break; }
      case "refill": case "reorder": { const H = S.hist || []; refill(id === "last" ? H.filter((x) => x.items).slice(-1)[0] : H[+id]); break; }
      /* après la commande : tout est arrivé, il manquait quelque chose, total payé, à racheter */
      case "arrok": { const h = S.hist[+id]; if (!h) break; h.arr = Object.assign({}, h.arr, { [t.dataset.r]: "ok" }); store.set("hist", S.hist); rerender(); toast("C'est noté", { label: "Total payé", run: () => paidSheet(+id) }, "check"); break; }
      case "arrmiss": arrMissSheet(+id, t.dataset.r); break;
      case "arrsel": S.arrSel = Object.assign({}, S.arrSel, { [id]: !(S.arrSel || {})[id] }); refreshSheet(); break;
      case "arrmissok": {
        const h = S.hist[+id], rid = t.dataset.r, o = h && (h.o || []).find((x) => x && x.rid === rid), ids = Object.keys(S.arrSel || {}).filter((k) => S.arrSel[k]);
        if (!o || !ids.length) break;
        const undo = snap("hist", "todo");
        h.arr = Object.assign({}, h.arr, { [rid]: "manque" }); h.miss = Object.assign({}, h.miss, { [rid]: ids });
        for (const pid of ids) { const q = (o.items || {})[pid] || 1, e = S.todo.find((x) => x.id === pid); if (e) e.q = Math.min(99, e.q + q); else S.todo.push({ id: pid, q, from: rid, at: isoDay(new Date()) }); }
        store.set("hist", S.hist); saveTodo(); closeSheet(); rerender();
        undoable(plural(ids.length, "produit", "produits") + " pour ton prochain panier", undo, 6000); break;
      }
      case "arrlater": { const h = S.hist[+id] || {}; S.guide.snooze = Object.assign({}, S.guide.snooze, { [(h.sid || h.d) + "|" + t.dataset.r]: Date.now() + 864e5 }); saveGuide(); rerender(); toast("Cabas te le redemande demain"); break; }
      case "paid": paidSheet(+id); break;
      case "paidok": {
        const h = S.hist[+id];
        if (!h) break;
        const P = {};
        let bad = null;
        $$("#sheet input[data-r]").forEach((i) => { const raw = String(i.value || "").trim(); if (!raw) return; const v = numOf(raw); if (!(v > 0 && v <= 2000)) { bad = bad || i.id; return; } P[i.dataset.r] = Math.round(v * 100); });
        if (bad) { fieldError(bad, "Un montant en euros, par exemple 64,90"); break; }
        h.paid = P; store.set("hist", S.hist); closeSheet(); rerender();
        toast(Object.keys(P).length ? "Total payé noté, saisi par toi" : "Total payé effacé", null, "check"); break;
      }
      case "todoadd": {
        const undo = snap("basket", "todo");
        let n = 0;
        for (const x of S.todo) if (S.prods.has(x.id)) { S.basket[x.id] = Math.min(99, (S.basket[x.id] || 0) + x.q); n++; }
        S.todo = []; saveBasket(); saveTodo(); renderChrome(); bumpBadge(); rerender();
        undoable(plural(n, "produit ajouté", "produits ajoutés") + " au panier", undo, 6000); break;
      }
      case "tododel": { const undo = snap("todo"); S.todo = []; saveTodo(); rerender(); undoable("Produits à racheter oubliés", undo, 5000); break; }
      case "histclear": confirmSheet("Effacer l'historique\u00a0?", "Le total de tes économies repart de zéro sur cet appareil.", "Effacer", "histok"); break;
      case "histok": { const undo = snap("hist"); S.hist = []; store.set("hist", []); closeSheet(); rerender(); undoable("Historique effacé", undo, 5000); break; }
      /* partager */
      case "sharecart": shareText("Mes courses", cartText()); break;
      case "sharelist": { const L = S.lists.find((x) => x.id === id); if (L) shareList(L); break; }
      case "addshared": { if (!S.shared) break; const n = addItems(S.shared.items, false) + addFree(S.shared.free); renderChrome(); bumpBadge(); toast(plural(n, "produit ajouté", "produits ajoutés") + " au panier", { label: "Voir", run: () => switchTab("panier") }); break; }
      case "keepshared": { if (!S.shared) break; const L = { id: Date.now().toString(36), name: S.shared.name, items: Object.assign({}, S.shared.items), at: new Date().toISOString().slice(0, 10) }; if ((S.shared.free || []).length) L.free = S.shared.free.slice(); S.lists.unshift(L); saveLists(); toast("Ajoutée à tes listes", { label: "Voir", run: () => switchTab("listes") }); break; }
      /* lignes libres */
      case "freeret": if (S.freeEdit) { S.freeEdit.ret = t.dataset.v || null; refreshSheet(); } break;
      case "freeinc": case "freedec": {
        const d = act === "freeinc" ? 1 : -1;
        if (!id) { const E = S.freeEdit; if (E) { E.q = Math.max(1, Math.min(99, E.q + d)); refreshSheet(); } break; }
        const f = S.free[id]; if (!f) break;
        if (f.q + d < 1) { freeRemove(id); rerender(); break; }
        f.q = Math.min(99, f.q + d); saveFree(); rerender(); break;
      }
      case "freedel": freeRemove(id); rerender(); break;
      case "freeok": {
        const E = S.freeEdit; if (!E) { closeSheet(); break; }
        const tx = String((($("#freeT") || {}).value || E.t || "")).trim().slice(0, 60);
        if (!tx) { fieldError("freeT", "Écris le nom du produit"); break; }
        const raw = String((($("#freeP") || {}).value || "")).trim(), v = raw ? numOf(raw) : 0;
        if (raw && !(v >= 0 && v <= 500)) { fieldError("freeP", "Un prix en euros, entre 0 et 500"); break; }
        const fid = Date.now().toString(36), f = { t: tx, q: E.q, at: new Date().toISOString() };
        if (v > 0) f.price = Math.round(v * 100) / 100;
        if (E.ret) f.ret = E.ret;
        S.free[fid] = f; saveFree();
        const x = S.wl && S.wl.lines[E.i];
        if (x) { x.free = fid; x.n = E.q; }
        S.freeEdit = null; closeSheet(); renderChrome(); rerender();
        toast("Ligne libre gardée", { label: "Voir le panier", run: () => switchTab("panier") }); break;
      }
      /* « Retirer » révélé par un glissement : produit du panier, ligne de Ma liste ou ligne libre */
      case "rm": {
        const m = /^([plf]):(.*)$/.exec(t.dataset.rm || "");
        if (!m) break;
        if (m[1] === "p") setQty(m[2], 0, "dec");
        else if (m[1] === "l") { wlRemove(+m[2]); rerender(); }
        else { freeRemove(m[2]); rerender(); }
        break;
      }
      default: break;
    }
  });
  /* univers replié ou ouvert sur la page Rayons : gardé par appareil (cabas.univ) */
  document.addEventListener("toggle", (e) => {
    const d = e.target;
    /* « Et si » du panier : les scénarios se calculent à l'ouverture, et la section reste ouverte d'un redessin à l'autre */
    if (d && d.classList && d.classList.contains("wif")) { S.wifOpen = d.open; const el = $("#wif"); if (d.open && el) patchHtml(el, wifBody()); return; }
    if (!d || !d.classList || !d.classList.contains("univ") || !d.dataset.u) return;
    const st = store.get("univ", {}) || {}; st[d.dataset.u] = d.open; store.set("univ", st);
  }, true);
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.act === "nocomp") { S.prefs.comp = !t.checked; savePrefs(); applyGroups(); freeCheck(true); setTimeout(() => { renderChrome(); rerender(); }, 200); return; }
    if (t.dataset && t.dataset.act === "ret") { const k = offKey(S.allMap.get(t.dataset.id)) || t.dataset.id; if (t.checked) delete S.prefs.off[k]; else S.prefs.off[k] = true; savePrefs(); freeCheck(true); renderChrome(); return; }
    if (t.dataset && t.dataset.act === "itemflex") { flexSet(t.dataset.id, t.checked); refreshSheet(); return; }
    if (t.dataset && t.dataset.act === "manualck") { S.prefs.manualCk = t.checked; savePrefs(); return; }
    /* une seule liste est le panier de la semaine ; ses rythmes viennent des commandes quand elle le devient */
    if (t.dataset && t.dataset.act === "tpl") {
      const L = S.lists.find((x) => x.id === t.dataset.id); if (!L) return;
      S.lists.forEach((x) => { if (x !== L) delete x.template; });
      if (t.checked) { L.template = true; if (!L.cad) { const C = {}; Object.keys(L.items).forEach((id) => { const c = cadOf(id); if (c) C[id] = c; }); L.cad = C; } } else delete L.template;
      saveLists(); rerenderKeep(t); toast(t.checked ? "C'est ton panier de la semaine" : "Ce n'est plus ton panier de la semaine"); return;
    }
    if (t.dataset && t.dataset.act === "pickauto") {
      const g = t.dataset.g, M = Object.assign({}, S.prefs.pickManual);
      if (t.checked) delete M[g]; else M[g] = 1;
      S.prefs.pickManual = M;
      const ch = t.checked ? applyAutoPick() : [];
      savePrefs(); applyGroups(); renderChrome(); rerenderKeep(t);
      if (ch.length) { const r = S.allMap.get(pickOf(g, groupsOf()[g])); toast(`${r.name}\u00a0: ${optionLabel(r).replace(/^./, (c) => c.toLowerCase())}`); }
      return;
    }
    if (t.dataset && t.dataset.act === "contrast") { S.prefs.contrast = t.checked; savePrefs(); applyLook(); return; }
    if (t.dataset && t.dataset.act === "simple") { S.prefs.simple = t.checked; savePrefs(); applyLook(); S.shown = {}; rerenderKeep(t); return; }
    if (t.dataset && t.dataset.act === "badge") { S.prefs.badge = t.checked; savePrefs(); renderChrome(); return; }
    if (t.dataset && t.dataset.act === "factsauto") { S.prefs.facts = t.checked; savePrefs(); return; }
    if (t.id === "impIn") {
      const f = t.files && t.files[0];
      if (!f) return;
      if (f.size > 5000000) { importSheet({ ok: false, errs: ["Ce fichier est trop gros pour une copie de Cabas."] }, ""); return; }
      f.text().then((tx) => { let o = null; try { o = JSON.parse(tx); } catch (e) { o = null; } importSheet(importCheck(o), "file"); }, () => toast("Ce fichier n'a pas pu être lu"));
      return;
    }
    if (t.dataset && t.dataset.act === "wake") { S.prefs.wake = t.checked; savePrefs(); if (t.checked) wakeOn(); else wakeOff(); return; }
    if (t.id === "extra") { const v = numOf(t.value); S.prefs.extraCost = v > 0 ? Math.min(v, 50) : 0; t.value = frNum(S.prefs.extraCost); savePrefs(); return; }
    if (t.dataset && t.dataset.fee) { const v = numOf(t.value); const o = S.prefs.fee[t.dataset.fee] || {}; o.base = v >= 0 ? Math.min(v, 30) : 0; S.prefs.fee[t.dataset.fee] = o; t.value = frNum(o.base); savePrefs(); return; }
    if (t.id === "fmax") { const v = numOf(t.value); F(t.dataset.k).max = v > 0 ? String(v) : ""; refreshSheet(); }

  });
  let qT = null;
  let draftT = null;
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t.id === "wlIn") { if (S.wl) S.wl.text = t.value; clearTimeout(draftT); draftT = setTimeout(() => store.set("draft", t.value), 400); return; }
    if (t.dataset && t.dataset.shelf) {
      const x = SC.items.find((y) => y.code === t.dataset.shelf);
      if (!x) return;
      x.shelf = t.value;
      const p = S.prods.get(x.pid || (x.near && x.near.pid)), b = p && (x.pid ? offers(p, true)[0] : best(p));
      const n = $(`[data-shelfnote="${CSS.escape(x.code)}"]`); if (n) n.innerHTML = shelfNote(x.shelf, b);
      return;
    }
    if (t.id === "rq") {
      clearTimeout(qT);
      const c = $(".search .clr"); if (c) c.hidden = !t.value;
      qT = setTimeout(() => { S.rq = t.value; const el = $("#rlist"); if (el) { el.innerHTML = rayonsBody(S.rq); markEnds(); } }, 120);
      return;
    }
    if (t.id === "q") {
      clearTimeout(qT);
      const c = $(".search .clr"); if (c) c.hidden = !t.value;
      qT = setTimeout(() => {
        S.q = t.value; S.shown.s = 0; $("#sres").innerHTML = searchBody(); mountLazy(); onScroll();
        /* complétion : quatre pastilles au plus, repliées dès que le champ se vide ou qu'une est choisie */
        const sg = $("#sugg"); if (sg) { const L = t.value.trim() ? suggestions(t.value) : []; sg.innerHTML = suggHtml(L); sg.hidden = !L.length; }
      }, 120);
    } else if (t.id === "cmpq") {
      /* comparer : la liste suit ce qui est tapé */
      clearTimeout(qT);
      qT = setTimeout(() => { if (!S.cmp) return; S.cmp.q = t.value; const p = S.prods.get(S.cmp.from), el = $("#cmplist"); if (p && el) el.innerHTML = cmpList(p, t.value); }, 150);
    } else if (t.id === "cmBud") {
      if (S.compose) S.compose.bud = t.value;
    } else if (t.id === "repT") {
      if (S.rep) S.rep.text = t.value;
    } else if (t.id === "freeT" || t.id === "freeP") {
      if (S.freeEdit) S.freeEdit[t.id === "freeT" ? "t" : "price"] = t.value;
    } else if (t.id === "fbq") {
      F(t.dataset.k).bq = t.value;
      const pos = t.selectionStart;
      refreshSheet();
      const n = $("#fbq"); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (err) { /* champ de type search sans sélection */ } }
    } else if (t.id === "zipIn") {
      t.value = t.value.replace(/\D/g, "").slice(0, 5);
    } else if (t.id === "famt") {
      /* guide des frais : le tableau suit le montant tapé */
      const v = numOf(t.value);
      S.fraisAmt = v >= 0 ? Math.round(Math.min(v, 2000) * 100) : null;
      const el = $("#ftab"); if (el && S.fraisAmt != null) el.innerHTML = fraisTable(S.fraisAmt);
    } else if (t.id === "wzip") {
      /* questions de départ : dès cinq chiffres, le secteur Auchan suit (sauf choisi à la main), sans redessiner le champ */
      t.value = t.value.replace(/\D/g, "").slice(0, 5);
      if (t.value.length !== 5 && t.value) return;
      S.prefs.zip = t.value;
      applyAutoPick(); savePrefs();
      const el = $("#wsect"); if (el) el.innerHTML = sectHtml();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!$("#sheet").hidden) { closeSheet(); return; }
      if (!$("#toast").hidden && $("#toast button")) { $("#toast").hidden = true; S.undo = null; return; }
    }
    if (e.key === "Tab" && !$("#sheet").hidden) { trapTab(e); return; }
    /* flèches dans un groupe de choix unique : le choix suit */
    if ((e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") && e.target.getAttribute && e.target.getAttribute("role") === "radio") {
      const g = e.target.closest("[role=radiogroup]"); if (!g) return;
      const rs = $$("[role=radio]:not([disabled])", g), i = rs.indexOf(e.target); if (i < 0) return;
      const n = rs[(i + (e.key === "ArrowLeft" || e.key === "ArrowUp" ? rs.length - 1 : 1)) % rs.length];
      e.preventDefault(); n.focus(); n.click(); return;
    }
    if (e.key === "Enter") {
      if (e.target.id === "q") { e.preventDefault(); addRecent(e.target.value); e.target.blur(); }
      else if (e.target.id === "zipIn" || e.target.id === "nameIn" || e.target.id === "budIn" || e.target.id === "eanIn" || /^paid\d+$/.test(e.target.id)) { e.preventDefault(); const b = $('#sheet .sheet-h [data-act$="ok"]'); if (b) b.click(); }
      else if (e.target.id === "watchIn") { e.preventDefault(); const b = $('#sheet [data-act="watchok"]'); if (b) b.click(); }
      else if (e.target.id === "cmBud") { e.preventDefault(); const b = $('#view [data-act="compose"]'); if (b) b.click(); }
      else if (e.target.id === "cmpq") { e.preventDefault(); e.target.blur(); }
      else if (e.target.id === "freeT" || e.target.id === "freeP") { e.preventDefault(); const b = $('#sheet [data-act="freeok"]'); if (b) b.click(); }
      else if (e.target.id === "fmax" || e.target.id === "extra" || e.target.id === "wzip" || e.target.id === "famt" || (e.target.dataset && e.target.dataset.fee)) { e.preventDefault(); e.target.blur(); }
      return;
    }
    /* clavier, hors champ de saisie : « / » va à la recherche ; « + » et « - » changent la quantité de la carte ou de la
       ligne qui a le focus */
    if (e.ctrlKey || e.metaKey || e.altKey || !e.target.closest || e.target.closest("input, textarea, select, [contenteditable]")) return;
    if (e.key === "/") {
      if (!$("#sheet").hidden) return;
      e.preventDefault();
      const i = $("#q");
      if (i) i.focus(); else { S.focusSearch = true; switchTab("recherche"); }
      return;
    }
    if (e.key === "+" || e.key === "=" || e.key === "-") {
      const el = e.target.closest(".card, .item");
      if (!el) return;
      const b = $(e.key === "-" ? '[data-act="dec"], [data-act="wldec"], [data-act="freedec"]' : '[data-act="inc"], [data-act="wlinc"], [data-act="freeinc"]', el);
      if (b) { e.preventDefault(); b.click(); }
    }
  });
  /* ---------- glisser pour retirer ---------- */
  /* Dans le panier, Ma liste et les lignes libres, glisser une ligne vers la gauche révèle « Retirer » ; il faut 48 px
     horizontaux sous 30 degrés avant que le geste soit pris, sinon le défilement vertical garde la main (touch-action:
     pan-y) ; un tap ailleurs referme. Les boutons restent : le geste est un raccourci. */
  (function swipeRows() {
    let row = null, x0 = 0, y0 = 0, on = false, dead = false, swiped = false;
    const close = (r) => { r.classList.remove("swipe"); const b = $(".rm", r); if (b) setTimeout(() => b.remove(), tokenMs("--t-2", 200)); };
    const reveal = (r) => {
      $$(".item.swipe").forEach((o) => { if (o !== r) close(o); });
      if (!$(".rm", r)) r.insertAdjacentHTML("beforeend", `<button class="rm" type="button" data-act="rm" data-rm="${esc(r.dataset.rm)}">Retirer</button>`);
      r.classList.add("swipe");
    };
    document.addEventListener("pointerdown", (e) => {
      const r = e.target.closest(".item[data-rm]");
      row = null;
      if (!r || !$("#view").contains(r) || e.target.closest("button, input, a.btn")) return;
      row = r; x0 = e.clientX; y0 = e.clientY; on = false; dead = false;
    });
    document.addEventListener("pointermove", (e) => {
      if (!row || on || dead) return;
      const dx = e.clientX - x0, dy = e.clientY - y0;
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { dead = true; return; }
      if (Math.abs(dx) < 48 || Math.abs(dy) > Math.abs(dx) * 0.577) return;
      on = true; swiped = true;
      if (dx < 0) reveal(row); else close(row);
    });
    const end = () => { if (on) setTimeout(() => { swiped = false; }, 80); row = null; on = false; dead = false; };
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", end);
    /* le relâchement après un glissement n'est pas un tap sur la ligne ; un tap ailleurs referme la ligne ouverte */
    document.addEventListener("click", (e) => {
      if (swiped) { swiped = false; e.preventDefault(); e.stopPropagation(); return; }
      if (e.target.closest(".rm")) return;
      const o = $(".item.swipe"); if (o && !o.contains(e.target)) close(o);
    }, true);
    document.addEventListener("dragstart", (e) => { if (e.target.closest && e.target.closest(".item[data-rm]")) e.preventDefault(); });
  })();
  document.addEventListener("input", (e) => { const f = e.target.closest && e.target.closest(".field.err"); if (f) { f.classList.remove("err"); const h = $("small", f); if (h && h.dataset.hint != null) h.innerHTML = h.dataset.hint; } });
  const APP_URL = "https://59g59sy5w6-design.github.io/";
  const APP_HOST = "59g59sy5w6-design.github.io";
  /* ---------- images à partager (réseaux sociaux, messageries) ----------
     Une carte sobre dessinée sur un canvas : le wordmark, un gros chiffre, deux lignes, le nom de l'appli. Partagée en
     fichier quand le téléphone le permet (navigator.canShare), sinon le texte et le lien, sinon l'image se télécharge. */
  const CARD_FONT = '-apple-system, "SF Pro Display", "SF Pro Text", "Helvetica Neue", Inter, Roboto, Arial, sans-serif';
  function drawLogo(cx, x, y, s) {
    cx.save(); cx.translate(x, y); cx.scale(s / 64, s / 64);
    cx.fillStyle = "#0a7a4a"; cx.beginPath(); cx.roundRect(0, 0, 64, 64, 14); cx.fill();
    cx.fillStyle = "#fff"; cx.fill(new Path2D("M18.2 26h27.6l1.5 23.4a3.4 3.4 0 0 1-3.4 3.6H20.1a3.4 3.4 0 0 1-3.4-3.6z"));
    cx.strokeStyle = "#fff"; cx.lineWidth = 2.8; cx.lineCap = "round"; cx.stroke(new Path2D("M24.2 27v-4.6a7.8 7.8 0 0 1 15.6 0V27"));
    cx.beginPath(); cx.arc(45.6, 47.4, 7.6, 0, Math.PI * 2); cx.fillStyle = "#ffd60a"; cx.fill(); cx.strokeStyle = "#0a7a4a"; cx.lineWidth = 2.4; cx.stroke();
    cx.restore();
  }
  function wrapText(cx, text, maxW) {
    const words = String(text).split(" "), lines = [];
    let cur = "";
    for (const w of words) { const t = cur ? cur + " " + w : w; if (cx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur);
    return lines;
  }
  /* spec : { big, label, lines, note } ; renvoie un Blob PNG 1080 x 1080 */
  function cardPng(spec) {
    return new Promise((ok) => {
      const W = 1080, c = document.createElement("canvas"); c.width = W; c.height = W;
      const cx = c.getContext("2d");
      cx.fillStyle = "#ffffff"; cx.fillRect(0, 0, W, W);
      drawLogo(cx, 80, 80, 96);
      cx.fillStyle = "#111"; cx.font = "800 72px " + CARD_FONT; cx.textBaseline = "middle"; cx.fillText("Cabas", 196, 128);
      let y = spec.big ? 330 : 400;
      if (spec.big) { cx.font = "800 " + (spec.big.length > 9 ? 150 : 190) + "px " + CARD_FONT; cx.textBaseline = "alphabetic"; cx.fillText(spec.big, 80, y + 120); y += 190; }
      cx.font = "700 60px " + CARD_FONT; cx.textBaseline = "alphabetic";
      for (const l of wrapText(cx, spec.label || "", 920)) { cx.fillText(l, 80, y + 20); y += 72; }
      y += 22;
      cx.font = "400 42px " + CARD_FONT; cx.fillStyle = "#4b4f55";
      for (const t of spec.lines || []) for (const l of wrapText(cx, t, 920)) { cx.fillText(l, 80, y + 20); y += 56; }
      cx.strokeStyle = "#e3e5e8"; cx.lineWidth = 2; cx.beginPath(); cx.moveTo(80, 910); cx.lineTo(1000, 910); cx.stroke();
      cx.font = "600 36px " + CARD_FONT; cx.fillStyle = "#111"; cx.fillText(spec.note || "Gratuit, sans compte, sans publicité", 80, 968);
      cx.font = "600 36px " + CARD_FONT; cx.fillStyle = "#0a7a4a"; cx.fillText(APP_HOST, 80, 1022);
      c.toBlob((b) => ok(b), "image/png");
    });
  }
  async function shareCard(spec, name, title, text) {
    let blob = null;
    try { blob = await cardPng(spec); } catch (e) { blob = null; }
    if (blob && navigator.share && navigator.canShare) {
      const file = new File([blob], name, { type: "image/png" });
      if (navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title, text: text + " " + APP_URL }); } catch (err) { /* partage annulé */ } return; }
    }
    if (navigator.share) { try { await navigator.share({ title, text, url: APP_URL }); } catch (err) { /* partage annulé */ } return; }
    if (blob) {
      const u = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000);
      toast("Image enregistrée, à partager où tu veux");
      return;
    }
    try { await navigator.clipboard.writeText(text + "\n" + APP_URL); toast("Texte copié"); } catch (err) { toast("Partage impossible sur cet appareil"); }
  }
  const RET_LIST = () => joinEt([...new Set(S.allRets.filter((r) => !r.simulated).map((r) => r.name.split(" ")[0]))]);
  async function shareApp() {
    const text = "Cabas compare les prix des courses chez " + RET_LIST() + " et répartit le panier pour payer le moins cher, livraison comprise. Gratuit, sans compte.";
    await shareCard({ big: "", label: "Tes courses au prix le plus bas, livraison comprise.", lines: ["Les mêmes produits chez " + RET_LIST() + ", aux prix relevés sur leurs sites. Écris ta liste, Cabas répartit tes commandes."] }, "cabas.png", "Cabas", text);
  }
  async function shareSavings() {
    const H = S.hist || [], s = H.reduce((a, x) => a + (x.s || 0), 0);
    if (!H.length) { shareApp(); return; }
    const text = "J'ai économisé " + eurC(s) + " sur mes courses avec Cabas, qui compare " + RET_LIST() + ". Gratuit, sans compte.";
    await shareCard({ big: eurC(s), label: "économisés sur mes courses", lines: ["Sur " + plural(H.length, "panier", "paniers") + " depuis le " + dateFr(H[0].d).replace(/ \d{4}$/, "") + ", aux meilleurs prix de " + RET_LIST() + ", livraison comprise."] }, "cabas-economies.png", "Mes économies avec Cabas", text);
  }
  async function shareGap(id) {
    const p = S.prods.get(id);
    if (!p) return;
    const os = offers(p, false).filter((o) => !o.sim);
    if (os.length < 2) { shareProduct(id); return; }
    const lo = os[0], hi = os[os.length - 1], name = (p.brand + " " + p.name + (p.format ? ", " + p.format : "")).trim();
    const text = name + "\u00a0: " + eur(lo.price) + " chez " + retName(lo.ret) + ", " + eur(hi.price) + " chez " + retName(hi.ret) + ". Même produit, pas le même prix. Vu sur Cabas.";
    await shareCard({ big: eur(hi.price - lo.price), label: "d'écart sur le même produit", lines: [name, eur(lo.price) + " chez " + retName(lo.ret) + ", " + eur(hi.price) + " chez " + retName(hi.ret) + ". Prix relevés le " + dateFr(lo.at || S.meta.updatedAt) + "."] }, "cabas-ecart.png", name, text);
  }
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
      const st = await fetch("data/status.json?fresh=1", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null));
      S.lastCheckFetch = Date.now();
      if (st && JSON.stringify(st) !== JSON.stringify(S.status)) {
        const m = await fetch("data/meta.json?fresh=1", { cache: "no-cache" }).then((r) => r.json());
        /* un nouveau relevé : baisses de tes produits et seuils atteints, comme à l'ouverture */
        if (JSON.stringify(m) !== JSON.stringify(S.meta)) { await load(true); try { trackDrops(); watchCheck(); } catch (e) { /* stockage indisponible */ } } else S.status = st;
        const typing = document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName);
        if ($("#sheet").hidden && !typing) rerender();
      }
    } catch (e) { /* hors ligne : on garde les prix chargés */ }
    refreshing = false;
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - (S.lastCheckFetch || S.loadedAt || 0) > 5 * 60 * 1000) refreshData();
    if (S.route.name === "scan") { if (document.visibilityState === "hidden") stopScan(); else startScan(); }
    /* le navigateur rend le verrou d'écran quand la page est cachée : il est redemandé au retour */
    if (S.route.name === "magasin" && document.visibilityState === "visible") wakeOn();
  });
  setInterval(() => { if (document.visibilityState === "visible") refreshData(); }, 10 * 60 * 1000);

  /* ---------- démarrage ---------- */
  /* avant le catalogue : l'accueil avec ses squelettes (rayons, écarts de prix) ; les autres écrans gardent le squelette de index.html */
  function renderPre() {
    if (parse(location.hash || "#/").name !== "home") return;
    const first = newcomer();
    const tiles = '<div><div class="sk"></div><div class="skl s"></div></div>'.repeat(8);
    const cards = '<div class="card" aria-hidden="true"><div class="tile sk"></div><div class="skl"></div><div class="skl s"></div></div>'.repeat(4);
    $("#navL").innerHTML = `<a class="wordmark" href="#/" data-tab="accueil" aria-label="Cabas, accueil"><svg aria-hidden="true"><use href="#i-logo"/></svg>Cabas</a>`;
    $("#navT").textContent = "";
    $("#navR").innerHTML = `<a class="icbtn" href="#/reglages" aria-label="Réglages">${ic("gear")}</a>`;
    $("#view").innerHTML = `<div class="wrap" aria-busy="true">${first ? heroHtml() : '<h1 class="sr">Accueil</h1>'}<p class="sr" role="status">Chargement du catalogue</p>` +
      `<div class="srow"><button class="search" type="button" data-act="gosearch">${ic("search")}<span>Un produit, une marque, un rayon</span></button><a class="icbtn" href="#/scan" aria-label="Scanner un code-barres">${ic("scan")}</a></div>` +
      `<p class="fresh">${ic("clock")}<span>${esc(freshText())}</span></p>` +
      (first ? "" : `<a class="hcard" href="#/ecrire">${ic("pen", "si")}<span><b>Écris ou dicte ta liste</b><small>Cabas trouve chaque produit au meilleur prix</small></span>${ic("chev", "chev")}</a>`) +
      `<div class="sh"><h2>Même produit, pas le même prix</h2></div><div class="rail" aria-hidden="true">${cards}</div><div class="sh"><h2>Rayons</h2></div><div class="cats" aria-hidden="true">${tiles}</div></div>`;
    document.title = "Cabas";
  }
  function renderFail() {
    $("#view").innerHTML = `<div class="wrap"><div class="empty" role="alert">${emptyArt("info")}<h1 class="t1">Catalogue indisponible</h1><p>Le catalogue n'a pas pu être chargé. Vérifie ta connexion, puis réessaie.</p><button class="btn" type="button" data-act="reload">Réessayer</button></div></div>`;
  }
  /* hors ligne : une bannière sur l'accueil et le panier, posée sur offline et retirée sur online */
  S.offline = navigator.onLine === false;
  for (const ev of ["online", "offline"]) window.addEventListener(ev, () => { S.offline = ev === "offline"; if (S.ready && $("#sheet").hidden && (S.route.name === "home" || S.route.name === "panier")) rerender(); });
  /* partage vers Cabas (share_target du manifeste, en GET) : le texte reçu devient une liste à lire, un lien de liste
     Cabas ouvre sa page ; l'adresse est nettoyée tout de suite, rien n'est envoyé nulle part */
  function sharedIn() {
    try {
      const q = new URLSearchParams(location.search);
      if (!["title", "text", "url"].some((k) => q.has(k))) return null;
      const url = (q.get("url") || "").trim(), text = (q.get("text") || "").trim(), title = (q.get("title") || "").trim();
      const m = /#\/partage\/[A-Za-z0-9_-]+/.exec(url + " " + text);
      const hash = m && (url + " " + text).includes(APP_HOST) ? m[0] : "#/ecrire";
      history.replaceState(null, "", location.pathname + hash);
      return hash === "#/ecrire" ? (text || title).split("\n").filter((l) => !/^\s*https?:\/\//i.test(l)).join("\n").trim().slice(0, 4000) : "";
    } catch (e) { return null; }
  }
  (async () => {
    const shared = sharedIn();
    const h0 = location.hash || "#/";
    const t0 = tabOf(h0);
    if (t0) { S.tab = t0; S.stacks[t0] = [h0]; } else { S.tab = "accueil"; S.stacks.accueil = ["#/", h0]; }
    S.cur = h0;
    renderChrome({});
    applyLook();
    /* les enseignes et le relevé d'abord : l'accueil se dessine (promesse, boutons, squelettes), puis le catalogue le remplit */
    try {
      const pc = loadCatalog();
      await loadBase();
      S.pre = true; render();
      useCatalog(await pc);
      S.loadedAt = Date.now(); S.ready = true;
    } catch (err) { S.failed = true; }
    if (S.ready) { try { trackDrops(); watchCheck(); } catch (e) { /* stockage indisponible */ } }
    render();
    if (S.ready && shared) listFrom(shared);
    /* l'appli a été fermée pendant qu'un produit était ouvert sur le site d'une enseigne : il est coché au retour */
    if (S.ready && S.guide.open) { const age = Date.now() - (S.guide.open.at || 0); if (age > 1500 && age < 6 * 3600e3) fillBack(age); else { S.guide.open = null; saveGuide(); } }
    /* les questions de départ ne bloquent pas le premier écran : elles viennent à la première visite du panier (voir render) */
  })();
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    let had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (!had) { had = true; return; } toast("Une nouvelle version de Cabas est prête.", { label: "Recharger", run: () => location.reload() }); });
    window.addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => { /* hors ligne indisponible, l'appli marche quand même */ }); });
    /* sw.js a servi les prix du cache et en a trouvé de plus récents : on les prend */
    let dataT = 0;
    const kick = () => { if (!S.ready) { dataT = setTimeout(kick, 1000); return; } dataT = 0; refreshData(); };
    navigator.serviceWorker.addEventListener("message", (e) => {
      if (!e.data || e.data.type !== "data") return;
      if (/history/.test(e.data.path)) { histP = null; HIST = null; }
      clearTimeout(dataT); dataT = setTimeout(kick, 400);
    });
  }
})();
