/* Cabas, visuels produits.
   Chaque produit est dessiné selon son emballage (bouteille, pack, brique, pot, sachet, boîte, conserve, rouleaux, flacon, bidon),
   avec des couleurs tirées de ce qu'il contient (eau, cola, emmental, citron…) et une couleur d'étiquette choisie par marque.
   Aucun logo ni visuel de marque : ce sont des illustrations génériques. */
(function (G) {
  "use strict";

  /* ---------- outils ---------- */
  const f = (n) => String(Math.round(n * 10) / 10);
  const h2r = (h) => { h = h.replace("#", ""); if (h.length === 3) h = h.split("").map((c) => c + c).join(""); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const r2h = (r, g, b) => "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
  const mix = (a, b, t) => { const A = h2r(a), B = h2r(b); return r2h(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t); };
  const lt = (c, t) => mix(c, "#ffffff", t);
  const dk = (c, t) => mix(c, "#000000", t);
  function hash(s) { let h = 2166136261; s = String(s || ""); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/œ/g, "oe");

  const DEFS =
    '<linearGradient id="cy" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity=".24"/><stop offset=".09" stop-color="#000" stop-opacity=".08"/><stop offset=".25" stop-color="#fff" stop-opacity=".36"/><stop offset=".38" stop-color="#fff" stop-opacity=".07"/><stop offset=".72" stop-color="#000" stop-opacity=".03"/><stop offset="1" stop-color="#000" stop-opacity=".27"/></linearGradient>' +
    '<linearGradient id="cs" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity=".13"/><stop offset=".28" stop-color="#fff" stop-opacity=".2"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".17"/></linearGradient>' +
    '<linearGradient id="vt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".2"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".09"/></linearGradient>' +
    '<linearGradient id="mt" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6f7f9"/><stop offset=".42" stop-color="#c7ccd4"/><stop offset=".56" stop-color="#eceef2"/><stop offset="1" stop-color="#9aa1ab"/></linearGradient>' +
    '<linearGradient id="fm" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".34"/><stop offset=".3" stop-color="#fff" stop-opacity=".06"/><stop offset=".62" stop-color="#fff" stop-opacity=".16"/><stop offset="1" stop-color="#fff" stop-opacity=".02"/></linearGradient>' +
    '<radialGradient id="gs"><stop offset="0" stop-color="#000" stop-opacity=".24"/><stop offset=".55" stop-color="#000" stop-opacity=".09"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>';

  const ground = (cx, cy, rx, ry) => `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry || 8)}" fill="url(#gs)"/>`;

  /* ---------- formes ---------- */

  /* bouteille PET ou verre, base au point (x, by) */
  function bottle(x, by, w, h, o) {
    const hw = w / 2, glass = !!o.glass;
    const nw = w * (glass ? 0.15 : 0.18), capH = h * (glass ? 0.07 : 0.075), ne = h * (glass ? 0.27 : 0.15), sh = h * (glass ? 0.5 : 0.33), r = w * 0.17;
    const cm = ne + (sh - ne) * 0.5;
    const d = `M${f(-nw)},${f(capH)}L${f(-nw)},${f(ne)}C${f(-nw)},${f(cm)} ${f(-hw)},${f(cm)} ${f(-hw)},${f(sh)}L${f(-hw)},${f(h - r)}Q${f(-hw)},${f(h)} ${f(-hw + r)},${f(h)}L${f(hw - r)},${f(h)}Q${f(hw)},${f(h)} ${f(hw)},${f(h - r)}L${f(hw)},${f(sh)}C${f(hw)},${f(cm)} ${f(nw)},${f(cm)} ${f(nw)},${f(ne)}L${f(nw)},${f(capH)}Z`;
    const body = o.dim ? dk(o.body, 0.1) : o.body;
    let s = `<g transform="translate(${f(x)},${f(by - h)})"><path d="${d}" fill="${body}"/>`;
    if (o.dark) s += `<rect x="${f(-nw)}" y="${f(capH)}" width="${f(nw * 2)}" height="${f((ne - capH) * 0.85)}" fill="#fff" opacity=".42"/>`;
    if (o.label) {
      const ly = sh + (h - sh) * 0.17, lh = (h - sh) * 0.4;
      s += `<rect x="${f(-hw)}" y="${f(ly)}" width="${f(w)}" height="${f(lh)}" fill="${o.dim ? dk(o.label, 0.1) : o.label}"/>`;
      if (o.accent) s += `<rect x="${f(-hw)}" y="${f(ly + lh * 0.64)}" width="${f(w)}" height="${f(lh * 0.16)}" fill="${o.accent}"/><circle cx="0" cy="${f(ly + lh * 0.34)}" r="${f(Math.min(w * 0.15, lh * 0.2))}" fill="${o.accent}" opacity=".9"/>`;
    }
    if (o.ribs) for (let i = 0; i < 3; i++) { const y = h * (0.79 + i * 0.05); s += `<path d="M${f(-hw)},${f(y)}Q0,${f(y + 3)} ${f(hw)},${f(y)}" stroke="${dk(o.body, 0.22)}" stroke-opacity=".45" stroke-width="1" fill="none"/>`; }
    s += `<path d="${d}" fill="url(#cy)"/>`;
    s += `<path d="M${f(-hw * 0.56)},${f(sh + h * 0.05)}L${f(-hw * 0.56)},${f(h - r - 5)}" stroke="#fff" stroke-opacity="${o.dark ? 0.3 : 0.6}" stroke-width="${f(w * 0.075)}" stroke-linecap="round"/>`;
    s += `<path d="M${f(-nw * 0.45)},${f(ne + 3)}C${f(-nw * 0.6)},${f(cm)} ${f(-hw * 0.7)},${f(cm + 2)} ${f(-hw * 0.72)},${f(sh + 2)}" stroke="#fff" stroke-opacity=".45" stroke-width="${f(w * 0.05)}" fill="none" stroke-linecap="round"/>`;
    s += `<path d="${d}" fill="none" stroke="${dk(o.body, 0.4)}" stroke-opacity=".32" stroke-width="1"/>`;
    const cw = nw * 2 + w * 0.05;
    const cap = o.dim ? dk(o.cap, 0.1) : o.cap;
    if (o.metal) s += `<rect x="${f(-cw / 2)}" y="0" width="${f(cw)}" height="${f(capH)}" rx="1.5" fill="url(#mt)"/>`;
    else {
      s += `<rect x="${f(-cw / 2)}" y="0" width="${f(cw)}" height="${f(capH)}" rx="${f(cw * 0.12)}" fill="${cap}"/>`;
      for (let i = 1; i < 6; i++) s += `<path d="M${f(-cw / 2 + (cw * i) / 6)},1.5V${f(capH - 1.5)}" stroke="${dk(cap, 0.25)}" stroke-opacity=".5" stroke-width=".8"/>`;
      s += `<rect x="${f(-cw / 2)}" y="0" width="${f(cw)}" height="${f(capH)}" rx="${f(cw * 0.12)}" fill="url(#cs)"/>`;
      s += `<rect x="${f(-cw / 2 - 1.2)}" y="${f(capH - 0.5)}" width="${f(cw + 2.4)}" height="${f(h * 0.014 + 1)}" rx="1" fill="${dk(cap, 0.12)}"/>`;
    }
    return s + "</g>";
  }

  /* canette */
  function can(x, by, w, h, o) {
    const hw = w / 2, top = by - h, e = w * 0.17;
    const col = o.dim ? dk(o.body, 0.1) : o.body;
    const d = `M${f(x - hw)},${f(top + e * 1.6)}L${f(x - hw)},${f(by - e)}Q${f(x - hw)},${f(by)} ${f(x - hw + e)},${f(by)}L${f(x + hw - e)},${f(by)}Q${f(x + hw)},${f(by)} ${f(x + hw)},${f(by - e)}L${f(x + hw)},${f(top + e * 1.6)}Z`;
    let s = `<path d="${d}" fill="${col}"/>`;
    s += `<rect x="${f(x - hw)}" y="${f(top + h * 0.46)}" width="${f(w)}" height="${f(h * 0.14)}" fill="${o.accent}"/>`;
    s += `<rect x="${f(x - hw)}" y="${f(top + h * 0.62)}" width="${f(w)}" height="${f(h * 0.04)}" fill="${o.label || "#fff"}" opacity=".9"/>`;
    s += `<path d="${d}" fill="url(#cy)"/>`;
    s += `<path d="M${f(x - hw)},${f(top + e * 1.6)}Q${f(x - hw)},${f(top + e * 0.9)} ${f(x - hw * 0.86)},${f(top + e * 0.75)}L${f(x + hw * 0.86)},${f(top + e * 0.75)}Q${f(x + hw)},${f(top + e * 0.9)} ${f(x + hw)},${f(top + e * 1.6)}Z" fill="url(#mt)"/>`;
    s += `<ellipse cx="${f(x)}" cy="${f(top + e * 0.75)}" rx="${f(hw * 0.86)}" ry="${f(e * 0.72)}" fill="#dfe3e8" stroke="#aab1ba" stroke-width=".8"/>`;
    s += `<ellipse cx="${f(x)}" cy="${f(top + e * 0.75)}" rx="${f(hw * 0.68)}" ry="${f(e * 0.52)}" fill="none" stroke="#b9c0c8" stroke-width=".8"/>`;
    s += `<rect x="${f(x - hw * 0.2)}" y="${f(top + e * 0.45)}" width="${f(hw * 0.4)}" height="${f(e * 0.5)}" rx="${f(e * 0.25)}" fill="#c3c9d1"/>`;
    s += `<path d="M${f(x - hw * 0.6)},${f(top + e * 2.2)}L${f(x - hw * 0.6)},${f(by - e * 1.4)}" stroke="#fff" stroke-opacity=".42" stroke-width="${f(w * 0.07)}" stroke-linecap="round"/>`;
    return s;
  }

  /* brique de lait (vue de trois quarts), x = centre de la face avant */
  function brick(x, by, w, d, h, o) {
    const L = x - w / 2, R = x + w / 2, T = by - h, dy = d * 0.55;
    const body = o.dim ? dk(o.body, 0.08) : o.body;
    let s = `<path d="M${f(R)},${f(T)}L${f(R + d)},${f(T - dy)}L${f(R + d)},${f(by - dy)}L${f(R)},${f(by)}Z" fill="${dk(body, 0.13)}"/>`;
    s += `<path d="M${f(L)},${f(T)}L${f(R)},${f(T)}L${f(R + d)},${f(T - dy)}L${f(L + d)},${f(T - dy)}Z" fill="${dk(body, 0.04)}"/>`;
    s += `<rect x="${f(L)}" y="${f(T)}" width="${f(w)}" height="${f(h)}" fill="${body}"/>`;
    const wy = by - h * 0.4;
    s += `<path d="M${f(L)},${f(wy)}C${f(L + w * 0.3)},${f(wy - h * 0.08)} ${f(L + w * 0.62)},${f(wy + h * 0.07)} ${f(R)},${f(wy - h * 0.03)}L${f(R)},${f(by)}L${f(L)},${f(by)}Z" fill="${o.dim ? dk(o.accent, 0.1) : o.accent}"/>`;
    s += `<path d="M${f(R)},${f(wy - h * 0.03)}L${f(R + d)},${f(wy - h * 0.03 - dy)}L${f(R + d)},${f(by - dy)}L${f(R)},${f(by)}Z" fill="${dk(o.accent, 0.2)}"/>`;
    s += `<path d="M${f(L)},${f(wy + h * 0.06)}C${f(L + w * 0.3)},${f(wy - h * 0.02)} ${f(L + w * 0.62)},${f(wy + h * 0.13)} ${f(R)},${f(wy + h * 0.03)}" stroke="#fff" stroke-opacity=".75" stroke-width="${f(h * 0.025)}" fill="none"/>`;
    s += `<circle cx="${f(x)}" cy="${f(T + h * 0.3)}" r="${f(w * 0.15)}" fill="${o.accent}" opacity=".85"/>`;
    s += `<rect x="${f(L)}" y="${f(T)}" width="${f(w)}" height="${f(h)}" fill="url(#vt)"/>`;
    s += `<path d="M${f(L + 3)},${f(T + 4)}L${f(L + 3)},${f(by - 4)}" stroke="#fff" stroke-opacity=".55" stroke-width="2.4" stroke-linecap="round"/>`;
    if (o.cap) {
      const cx = x + d * 0.35, cy = T - dy * 0.5, rx = w * 0.16, ry = rx * 0.45, ch = w * 0.12;
      s += `<path d="M${f(cx - rx)},${f(cy)}L${f(cx - rx)},${f(cy - ch)}A${f(rx)},${f(ry)} 0 0 1 ${f(cx + rx)},${f(cy - ch)}L${f(cx + rx)},${f(cy)}A${f(rx)},${f(ry)} 0 0 1 ${f(cx - rx)},${f(cy)}Z" fill="${o.cap}"/>`;
      s += `<path d="M${f(cx - rx)},${f(cy)}L${f(cx - rx)},${f(cy - ch)}L${f(cx + rx)},${f(cy - ch)}L${f(cx + rx)},${f(cy)}Z" fill="url(#cs)"/>`;
      s += `<ellipse cx="${f(cx)}" cy="${f(cy - ch)}" rx="${f(rx)}" ry="${f(ry)}" fill="${lt(o.cap, 0.18)}"/>`;
    }
    return s;
  }

  /* pot de yaourt */
  function cup(x, by, wt, wb, h, o) {
    const T = by - h, et = wt * 0.17;
    const body = o.dim ? dk(o.body, 0.07) : o.body;
    const d = `M${f(x - wt / 2)},${f(T)}L${f(x - wb / 2)},${f(by - 4)}Q${f(x - wb / 2 + 0.5)},${f(by)} ${f(x - wb / 2 + 4)},${f(by)}L${f(x + wb / 2 - 4)},${f(by)}Q${f(x + wb / 2 - 0.5)},${f(by)} ${f(x + wb / 2)},${f(by - 4)}L${f(x + wt / 2)},${f(T)}Z`;
    let s = `<path d="${d}" fill="${body}"/>`;
    const y1 = T + h * 0.3, y2 = T + h * 0.62, k1 = (wt - wb) / 2 * 0.3, k2 = (wt - wb) / 2 * 0.62;
    s += `<path d="M${f(x - wt / 2 + k1)},${f(y1)}L${f(x + wt / 2 - k1)},${f(y1)}L${f(x + wt / 2 - k2)},${f(y2)}L${f(x - wt / 2 + k2)},${f(y2)}Z" fill="${o.dim ? dk(o.accent, 0.1) : o.accent}"/>`;
    s += `<path d="${d}" fill="url(#cy)"/>`;
    s += `<ellipse cx="${f(x)}" cy="${f(T)}" rx="${f(wt / 2 + 1.6)}" ry="${f(et + 1)}" fill="${dk(o.lid, 0.12)}"/>`;
    s += `<ellipse cx="${f(x)}" cy="${f(T - 0.6)}" rx="${f(wt / 2)}" ry="${f(et)}" fill="${o.dim ? dk(o.lid, 0.08) : o.lid}"/>`;
    s += `<ellipse cx="${f(x - wt * 0.12)}" cy="${f(T - et * 0.25)}" rx="${f(wt * 0.22)}" ry="${f(et * 0.4)}" fill="#fff" opacity=".35"/>`;
    return s;
  }

  /* grand pot (fromage blanc, yaourt 1 kg) */
  function jar(x, by, w, h, o) {
    const T = by - h, e = w * 0.13, wb = w * 0.9, lh = h * 0.2;
    const d = `M${f(x - w / 2)},${f(T + lh)}L${f(x - wb / 2)},${f(by - 6)}Q${f(x - wb / 2)},${f(by)} ${f(x - wb / 2 + 7)},${f(by)}L${f(x + wb / 2 - 7)},${f(by)}Q${f(x + wb / 2)},${f(by)} ${f(x + wb / 2)},${f(by - 6)}L${f(x + w / 2)},${f(T + lh)}Z`;
    let s = `<path d="${d}" fill="${o.glass ? lt(o.body, 0.2) : o.body}"/>`;
    s += `<rect x="${f(x - w / 2 + 1)}" y="${f(T + lh + h * 0.18)}" width="${f(w - 2)}" height="${f(h * 0.34)}" fill="${o.accent}"/>`;
    s += `<rect x="${f(x - w / 2 + 1)}" y="${f(T + lh + h * 0.43)}" width="${f(w - 2)}" height="${f(h * 0.05)}" fill="#fff" opacity=".85"/>`;
    s += `<path d="${d}" fill="url(#cy)"/>`;
    s += `<path d="M${f(x - w / 2 - 2)},${f(T + e)}L${f(x - w / 2 - 2)},${f(T + lh)}A${f(w / 2 + 2)},${f(e)} 0 0 0 ${f(x + w / 2 + 2)},${f(T + lh)}L${f(x + w / 2 + 2)},${f(T + e)}Z" fill="${o.lid}"/>`;
    s += `<path d="M${f(x - w / 2 - 2)},${f(T + e)}L${f(x - w / 2 - 2)},${f(T + lh)}A${f(w / 2 + 2)},${f(e)} 0 0 0 ${f(x + w / 2 + 2)},${f(T + lh)}L${f(x + w / 2 + 2)},${f(T + e)}Z" fill="url(#cs)"/>`;
    s += `<ellipse cx="${f(x)}" cy="${f(T + e)}" rx="${f(w / 2 + 2)}" ry="${f(e)}" fill="${lt(o.lid, 0.16)}"/>`;
    s += `<ellipse cx="${f(x - w * 0.12)}" cy="${f(T + e * 0.8)}" rx="${f(w * 0.2)}" ry="${f(e * 0.35)}" fill="#fff" opacity=".35"/>`;
    return s;
  }

  /* bord dentelé d'un sachet soudé */
  function crimp(L, R, y, hgt, col) {
    const n = Math.max(8, Math.round((R - L) / 6));
    let d = `M${f(L)},${f(y + hgt)}L${f(L)},${f(y + 1.5)}`;
    for (let i = 0; i < n; i++) { const a = L + ((R - L) * i) / n, b = L + ((R - L) * (i + 0.5)) / n; d += `L${f(b)},${f(y)}L${f(L + ((R - L) * (i + 1)) / n)},${f(y + 1.5)}`; }
    d += `L${f(R)},${f(y + hgt)}Z`;
    let s = `<path d="${d}" fill="${col}"/>`;
    for (let i = 1; i < 4; i++) s += `<path d="M${f(L + 2)},${f(y + (hgt * i) / 4 + 0.5)}H${f(R - 2)}" stroke="${dk(col, 0.18)}" stroke-opacity=".5" stroke-width=".7"/>`;
    return s;
  }

  /* contenu visible : pâtes */
  function pasta(kind, color, L, T, W, H, seed) {
    const R = rng(seed), dark = dk(color, 0.22), mid = dk(color, 0.08);
    let s = "";
    const n = kind === "long" || kind === "thin" ? 0 : Math.round((W * H) / 300);
    if (kind === "long" || kind === "thin") {
      const step = kind === "thin" ? 2.2 : 3.2;
      for (let x = L - 4; x < L + W + 4; x += step) { const jit = (R() - 0.5) * 2; s += `<path d="M${f(x + jit)},${f(T - 4)}L${f(x + jit + (R() - 0.5) * 3)},${f(T + H + 4)}" stroke="${R() < 0.5 ? color : mid}" stroke-width="${f(step * 0.82)}" stroke-linecap="round"/>`; }
      s += `<rect x="${f(L - 4)}" y="${f(T - 4)}" width="${f(W + 8)}" height="${f(H + 8)}" fill="url(#cs)"/>`;
      return s;
    }
    if (kind === "nest") {
      for (let i = 0; i < 6; i++) { const cx = L + W * (0.22 + (i % 3) * 0.28), cy = T + H * (0.3 + Math.floor(i / 3) * 0.42), r = Math.min(W, H) * 0.2; for (let k = 0; k < 5; k++) s += `<ellipse cx="${f(cx + (R() - 0.5) * 3)}" cy="${f(cy + (R() - 0.5) * 3)}" rx="${f(r - k * 1.6)}" ry="${f(r * 0.8 - k * 1.3)}" fill="none" stroke="${k % 2 ? mid : color}" stroke-width="2.4"/>`; }
      return s;
    }
    for (let i = 0; i < n; i++) {
      const cx = L + R() * W, cy = T + R() * H, a = Math.round(R() * 180), sc = 0.85 + R() * 0.3;
      let g = "";
      if (kind === "penne" || kind === "tube") {
        const l = kind === "tube" ? 20 : 22, w = kind === "tube" ? 11 : 8;
        g = `<path d="M${f(-l / 2 + 3)},${f(-w / 2)}L${f(l / 2)},${f(-w / 2)}L${f(l / 2 - 3)},${f(w / 2)}L${f(-l / 2)},${f(w / 2)}Z" fill="${color}" stroke="${dark}" stroke-width=".7"/><path d="M${f(-l / 2 + 4)},-1H${f(l / 2 - 3)}M${f(-l / 2 + 4)},2H${f(l / 2 - 4)}" stroke="${dark}" stroke-opacity=".45" stroke-width=".7"/>`;
      } else if (kind === "spiral") {
        g = `<path d="M-11,0q2,-6 4,0t4,0t4,0t4,0t4,0" fill="none" stroke="${color}" stroke-width="6.5" stroke-linecap="round"/><path d="M-11,0q2,-6 4,0t4,0t4,0t4,0t4,0" fill="none" stroke="${dark}" stroke-opacity=".35" stroke-width="1"/>`;
      } else if (kind === "elbow") {
        g = `<path d="M-7,4A8,8 0 0 1 7,4" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round"/><path d="M-7,4A8,8 0 0 1 7,4" fill="none" stroke="${dark}" stroke-opacity=".35" stroke-width=".8"/>`;
      } else if (kind === "bow") {
        g = `<path d="M0,0L-10,-6Q-12,0 -10,6ZM0,0L10,-6Q12,0 10,6Z" fill="${color}" stroke="${dark}" stroke-width=".7"/><circle r="2.2" fill="${mid}"/>`;
      } else if (kind === "disc") {
        g = `<ellipse rx="7" ry="6" fill="${color}" stroke="${dark}" stroke-width=".7"/><ellipse rx="3.5" ry="3" fill="${mid}"/>`;
      } else if (kind === "shell") {
        g = `<path d="M-8,3C-8,-6 8,-6 8,3Q0,6 -8,3Z" fill="${color}" stroke="${dark}" stroke-width=".7"/><path d="M-4,2L-3,-3M0,2V-4M4,2L3,-3" stroke="${dark}" stroke-opacity=".4" stroke-width=".7"/>`;
      } else if (kind === "sheet") {
        g = `<rect x="-14" y="-9" width="28" height="18" rx="1" fill="${color}" stroke="${dark}" stroke-width=".7"/><path d="M-14,-6q3.5,-3 7,0t7,0t7,0t7,0M-14,6q3.5,3 7,0t7,0t7,0t7,0" fill="none" stroke="${dark}" stroke-opacity=".4" stroke-width=".7"/>`;
      } else if (kind === "lentil") {
        g = `<ellipse rx="3.4" ry="2.8" fill="${color}" stroke="${dark}" stroke-width=".5"/>`;
      } else {
        g = `<rect x="-9" y="-4" width="18" height="8" rx="3" fill="${color}" stroke="${dark}" stroke-width=".7"/>`;
      }
      s += `<g transform="translate(${f(cx)},${f(cy)}) rotate(${a}) scale(${f(sc)})">${g}</g>`;
    }
    return s;
  }

  /* contenu visible : fromage râpé */
  function cheese(color, L, T, W, H, seed, flakes) {
    const R = rng(seed), d1 = dk(color, 0.12), d2 = lt(color, 0.25);
    let s = `<rect x="${f(L)}" y="${f(T)}" width="${f(W)}" height="${f(H)}" fill="${lt(color, 0.1)}"/>`;
    const n = Math.round((W * H) / 26);
    for (let i = 0; i < n; i++) {
      const x = L + R() * W, y = T + R() * H, a = R() * Math.PI, l = flakes ? 5 + R() * 5 : 7 + R() * 8;
      s += `<path d="M${f(x)},${f(y)}l${f(Math.cos(a) * l)},${f(Math.sin(a) * l)}" stroke="${R() < 0.33 ? d1 : R() < 0.5 ? d2 : color}" stroke-width="${flakes ? 3.4 : 2.3}" stroke-linecap="round"/>`;
    }
    return s;
  }

  /* sachet souple debout (fromage râpé, café en grains) */
  function pouch(x, by, w, h, o) {
    const L = x - w / 2, R = x + w / 2, T = by - h;
    const d = `M${f(L + 3)},${f(T + 10)}L${f(R - 3)},${f(T + 10)}Q${f(R + 3)},${f(T + h * 0.55)} ${f(R)},${f(by - 8)}Q${f(R)},${f(by)} ${f(R - 8)},${f(by)}L${f(L + 8)},${f(by)}Q${f(L)},${f(by)} ${f(L)},${f(by - 8)}Q${f(L - 3)},${f(T + h * 0.55)} ${f(L + 3)},${f(T + 10)}Z`;
    let s = `<path d="${d}" fill="${o.body}"/>`;
    if (o.window) {
      const wx = L + w * 0.14, wy = T + h * 0.44, ww = w * 0.72, wh = h * 0.42;
      s += `<clipPath id="pw"><rect x="${f(wx)}" y="${f(wy)}" width="${f(ww)}" height="${f(wh)}" rx="12"/></clipPath><g clip-path="url(#pw)">${o.window(wx, wy, ww, wh)}<rect x="${f(wx)}" y="${f(wy)}" width="${f(ww)}" height="${f(wh)}" fill="url(#fm)"/></g>`;
      s += `<rect x="${f(wx)}" y="${f(wy)}" width="${f(ww)}" height="${f(wh)}" rx="12" fill="none" stroke="#fff" stroke-opacity=".9" stroke-width="2"/>`;
    }
    s += `<rect x="${f(L + 3)}" y="${f(T + h * 0.2)}" width="${f(w - 6)}" height="${f(h * 0.12)}" fill="${o.accent}"/>`;
    s += `<rect x="${f(L + 3)}" y="${f(T + h * 0.34)}" width="${f(w - 6)}" height="${f(h * 0.025)}" fill="${o.accent}" opacity=".7"/>`;
    if (o.valve) s += `<circle cx="${f(x)}" cy="${f(T + h * 0.62)}" r="${f(w * 0.08)}" fill="${dk(o.body, 0.25)}"/><circle cx="${f(x)}" cy="${f(T + h * 0.62)}" r="${f(w * 0.045)}" fill="${lt(o.body, 0.2)}"/>`;
    if (o.bean) s += bean(x, T + h * 0.8, w * 0.13, o.accent);
    s += `<path d="${d}" fill="url(#cs)"/>`;
    s += crimp(L + 3, R - 3, T, 11, dk(o.body, 0.06));
    s += `<path d="M${f(L + w * 0.1)},${f(T + h * 0.2)}Q${f(L + w * 0.07)},${f(T + h * 0.6)} ${f(L + w * 0.1)},${f(by - 12)}" stroke="#fff" stroke-opacity=".5" stroke-width="3" fill="none" stroke-linecap="round"/>`;
    return s;
  }

  /* sachet coussin soudé en haut et en bas (pâtes, madeleines) */
  function pillow(x, by, w, h, o) {
    const L = x - w / 2, R = x + w / 2, T = by - h, cr = 12;
    const d = `M${f(L + 2)},${f(T + cr)}Q${f(x)},${f(T + cr - 3)} ${f(R - 2)},${f(T + cr)}C${f(R + 6)},${f(T + h * 0.35)} ${f(R + 6)},${f(by - h * 0.35)} ${f(R - 2)},${f(by - cr)}Q${f(x)},${f(by - cr + 3)} ${f(L + 2)},${f(by - cr)}C${f(L - 6)},${f(by - h * 0.35)} ${f(L - 6)},${f(T + h * 0.35)} ${f(L + 2)},${f(T + cr)}Z`;
    let s = `<clipPath id="pc"><path d="${d}"/></clipPath>`;
    s += `<path d="${d}" fill="${o.inner || "#f3efe6"}"/>`;
    if (o.fill) s += `<g clip-path="url(#pc)">${o.fill(L, T + cr, w, h - cr * 2)}</g>`;
    s += `<path d="${d}" fill="url(#fm)"/>`;
    const bh = h * (o.bandH || 0.26);
    s += `<g clip-path="url(#pc)"><rect x="${f(L - 8)}" y="${f(T + cr - 4)}" width="${f(w + 16)}" height="${f(bh)}" fill="${o.accent}"/>`;
    s += `<path d="M${f(L - 8)},${f(T + cr - 4 + bh)}C${f(L + w * 0.3)},${f(T + cr + bh + 7)} ${f(L + w * 0.6)},${f(T + cr + bh - 7)} ${f(R + 8)},${f(T + cr - 4 + bh)}" fill="${o.accent}"/>`;
    s += `<ellipse cx="${f(x)}" cy="${f(T + cr + bh * 0.42)}" rx="${f(w * 0.22)}" ry="${f(bh * 0.24)}" fill="#fff" opacity=".92"/>`;
    s += `<rect x="${f(L - 8)}" y="${f(by - cr - h * 0.08)}" width="${f(w + 16)}" height="${f(h * 0.08 + 6)}" fill="${o.accent}"/></g>`;
    s += `<path d="${d}" fill="url(#cs)"/>`;
    s += crimp(L - 1, R + 1, T, cr + 1, dk(o.accent, 0.05));
    s += `<g transform="translate(0,${f(by * 2 - 0)}) scale(1,-1)">${crimp(L - 1, R + 1, by, cr + 1, dk(o.accent, 0.12))}</g>`;
    s += `<path d="M${f(L + w * 0.12)},${f(T + cr + 8)}C${f(L + w * 0.02)},${f(T + h * 0.4)} ${f(L + w * 0.02)},${f(by - h * 0.4)} ${f(L + w * 0.12)},${f(by - cr - 8)}" stroke="#fff" stroke-opacity=".55" stroke-width="3.2" fill="none" stroke-linecap="round"/>`;
    return s;
  }

  /* boîte en carton (vue de trois quarts) */
  function box(x, by, w, d, h, o) {
    const L = x - w / 2, R = x + w / 2, T = by - h, dy = d * 0.55;
    let s = `<path d="M${f(R)},${f(T)}L${f(R + d)},${f(T - dy)}L${f(R + d)},${f(by - dy)}L${f(R)},${f(by)}Z" fill="${dk(o.body, 0.2)}"/>`;
    if (o.metalSide) s += `<path d="M${f(R + 3)},${f(T + 3)}L${f(R + d - 3)},${f(T - dy + 4.5)}L${f(R + d - 3)},${f(by - dy - 1.5)}L${f(R + 3)},${f(by - 3)}Z" fill="url(#mt)" stroke="#9aa1ab" stroke-width=".8"/><path d="M${f(R + 7)},${f(T + 7)}L${f(R + d - 7)},${f(T - dy + 8)}L${f(R + d - 7)},${f(by - dy - 5)}L${f(R + 7)},${f(by - 7)}Z" fill="none" stroke="#a9b0b9" stroke-width="1"/>`;
    s += `<path d="M${f(L)},${f(T)}L${f(R)},${f(T)}L${f(R + d)},${f(T - dy)}L${f(L + d)},${f(T - dy)}Z" fill="${lt(o.body, 0.12)}"/>`;
    s += `<rect x="${f(L)}" y="${f(T)}" width="${f(w)}" height="${f(h)}" fill="${o.body}"/>`;
    if (o.face) s += o.face(L, T, w, h, R, d, dy);
    s += `<rect x="${f(L)}" y="${f(T)}" width="${f(w)}" height="${f(h)}" fill="url(#vt)"/>`;
    if (o.crimpTop) s += `<path d="M${f(L)},${f(T)}L${f(R)},${f(T)}L${f(R + d)},${f(T - dy)}L${f(L + d)},${f(T - dy)}Z" fill="${dk(o.body, 0.05)}"/><path d="M${f(L + d * 0.5)},${f(T - dy * 0.5)}L${f(R + d * 0.5)},${f(T - dy * 0.5)}" stroke="${dk(o.body, 0.35)}" stroke-width="1.4"/>`;
    s += `<path d="M${f(L + 2.5)},${f(T + 4)}V${f(by - 4)}" stroke="#fff" stroke-opacity=".35" stroke-width="2.2" stroke-linecap="round"/>`;
    return s;
  }

  /* grain de café */
  function bean(cx, cy, r, col) {
    return `<g transform="translate(${f(cx)},${f(cy)}) rotate(-28)"><ellipse rx="${f(r)}" ry="${f(r * 0.72)}" fill="${col}"/><path d="M${f(-r * 0.85)},0C${f(-r * 0.3)},${f(-r * 0.35)} ${f(r * 0.3)},${f(r * 0.35)} ${f(r * 0.85)},0" stroke="${dk(col, 0.45)}" stroke-width="${f(r * 0.16)}" fill="none" stroke-linecap="round"/></g>`;
  }

  /* madeleine, financier, moelleux, part de gâteau */
  function cakePiece(kind, cx, cy, s, rot, col) {
    const d2 = dk(col, 0.22), l2 = lt(col, 0.22);
    let g = "";
    if (kind === "madeleine" || kind === "longue") {
      const k = kind === "longue" ? 1.35 : 1;
      g = `<path d="M${f(-s * 0.5 * k)},0C${f(-s * 0.56 * k)},${f(-s * 0.62)} ${f(s * 0.56 * k)},${f(-s * 0.62)} ${f(s * 0.5 * k)},0Q${f(s * 0.3 * k)},${f(s * 0.34)} 0,${f(s * 0.36)}Q${f(-s * 0.3 * k)},${f(s * 0.34)} ${f(-s * 0.5 * k)},0Z" fill="${col}"/>`;
      for (let i = -3; i <= 3; i++) { const a = (i / 3.6) * 1.2; g += `<path d="M0,${f(s * 0.3)}Q${f(Math.sin(a) * s * 0.26 * k)},${f(s * 0.05)} ${f(Math.sin(a) * s * 0.46 * k)},${f(-Math.cos(a) * s * 0.4)}" stroke="${d2}" stroke-opacity=".55" stroke-width="${f(s * 0.035)}" fill="none" stroke-linecap="round"/>`; }
      g += `<ellipse cx="${f(-s * 0.14 * k)}" cy="${f(-s * 0.2)}" rx="${f(s * 0.16 * k)}" ry="${f(s * 0.08)}" fill="${l2}" opacity=".7"/>`;
    } else if (kind === "financier" || kind === "moelleux") {
      const w = kind === "financier" ? s * 1.2 : s * 0.95, hh = kind === "financier" ? s * 0.5 : s * 0.72;
      g = `<rect x="${f(-w / 2)}" y="${f(-hh / 2)}" width="${f(w)}" height="${f(hh)}" rx="${f(s * 0.12)}" fill="${col}"/><rect x="${f(-w / 2 + 3)}" y="${f(-hh / 2 + 2)}" width="${f(w - 6)}" height="${f(hh * 0.34)}" rx="${f(s * 0.08)}" fill="${l2}" opacity=".55"/>`;
      if (kind === "moelleux") g += `<circle cx="${f(-w * 0.18)}" cy="${f(hh * 0.12)}" r="${f(s * 0.05)}" fill="${d2}"/><circle cx="${f(w * 0.2)}" cy="${f(-hh * 0.05)}" r="${f(s * 0.05)}" fill="${d2}"/>`;
    } else if (kind === "napolitain") {
      const w = s * 1.25, hh = s * 0.62;
      g = `<rect x="${f(-w / 2)}" y="${f(-hh / 2)}" width="${f(w)}" height="${f(hh)}" rx="3" fill="#f0d9a8"/><rect x="${f(-w / 2)}" y="${f(-hh * 0.12)}" width="${f(w)}" height="${f(hh * 0.24)}" fill="#6b3b22"/><rect x="${f(-w / 2)}" y="${f(-hh / 2)}" width="${f(w)}" height="${f(hh * 0.14)}" rx="3" fill="#5a2f1a"/>`;
    } else {
      const w = s * 1.2, hh = s * 0.7;
      g = `<rect x="${f(-w / 2)}" y="${f(-hh / 2)}" width="${f(w)}" height="${f(hh)}" rx="${f(s * 0.16)}" fill="${col}"/><path d="M${f(-w / 2 + 4)},${f(-hh * 0.15)}Q0,${f(-hh * 0.6)} ${f(w / 2 - 4)},${f(-hh * 0.15)}" stroke="${d2}" stroke-width="2" fill="none"/>`;
    }
    return `<g transform="translate(${f(cx)},${f(cy)}) rotate(${f(rot)})">${g}</g>`;
  }

  /* rouleaux de papier toilette sous film */
  function rolls(by, cols, rows, o) {
    const rw = Math.min(56, 178 / cols), rh = Math.min(rw * 1.05, 150 / rows), gap = 1.5;
    const W = cols * rw + (cols - 1) * gap, L = 120 - W / 2, Ttop = by - rows * rh - (rows - 1) * gap;
    const roll = o.body, ry = rw * 0.2;
    let s = "";
    for (let r = 0; r < rows; r++) {
      const y = Ttop + r * (rh + gap);
      for (let c = 0; c < cols; c++) {
        const x = L + c * (rw + gap);
        s += `<rect x="${f(x)}" y="${f(y)}" width="${f(rw)}" height="${f(rh)}" rx="${f(rw * 0.12)}" fill="${roll}"/>`;
        s += `<rect x="${f(x)}" y="${f(y)}" width="${f(rw)}" height="${f(rh)}" rx="${f(rw * 0.12)}" fill="url(#cy)" opacity=".75"/>`;
        for (let k = 1; k < 4; k++) s += `<path d="M${f(x + 2)},${f(y + (rh * k) / 4)}h${f(rw - 4)}" stroke="${dk(roll, 0.08)}" stroke-width=".6" stroke-dasharray="2 2"/>`;
      }
    }
    for (let c = 0; c < cols; c++) {
      const cx = L + c * (rw + gap) + rw / 2;
      s += `<ellipse cx="${f(cx)}" cy="${f(Ttop)}" rx="${f(rw / 2 - 0.5)}" ry="${f(ry)}" fill="${lt(roll, 0.4)}" stroke="${dk(roll, 0.1)}" stroke-width=".6"/>`;
      if (!o.coreless) s += `<ellipse cx="${f(cx)}" cy="${f(Ttop)}" rx="${f(rw * 0.17)}" ry="${f(ry * 0.36)}" fill="#c9b79c"/><ellipse cx="${f(cx)}" cy="${f(Ttop + 0.4)}" rx="${f(rw * 0.12)}" ry="${f(ry * 0.24)}" fill="#8f7d66"/>`;
      else s += `<ellipse cx="${f(cx)}" cy="${f(Ttop)}" rx="${f(rw * 0.08)}" ry="${f(ry * 0.18)}" fill="${dk(roll, 0.25)}"/>`;
    }
    const bandY = Ttop + rows * rh * 0.5 - rh * 0.28, bandH = rh * 0.56;
    s += `<rect x="${f(L - 2)}" y="${f(bandY)}" width="${f(W + 4)}" height="${f(bandH)}" rx="3" fill="${o.accent}"/>`;
    s += `<path d="M${f(L - 2)},${f(bandY + bandH * 0.72)}C${f(L + W * 0.3)},${f(bandY + bandH * 0.5)} ${f(L + W * 0.65)},${f(bandY + bandH * 0.95)} ${f(L + W + 2)},${f(bandY + bandH * 0.68)}" stroke="#fff" stroke-opacity=".8" stroke-width="2" fill="none"/>`;
    s += `<g transform="translate(${f(120)},${f(bandY + bandH * 0.38)})"><path d="M-9,4a6,6 0 0 1 2,-11a8,8 0 0 1 14,1a5,5 0 0 1 2,10z" fill="#fff" opacity=".92"/></g>`;
    s += `<rect x="${f(L - 3)}" y="${f(Ttop - ry - 2)}" width="${f(W + 6)}" height="${f(by - Ttop + ry + 2)}" rx="8" fill="url(#fm)" stroke="#fff" stroke-opacity=".55"/>`;
    return s;
  }

  /* flacon de liquide vaisselle */
  function flacon(x, by, w, h, o) {
    const hw = w / 2, T = by - h, capH = h * 0.12, cw = w * 0.46, sh = h * 0.26, waist = hw * 0.9;
    const d = `M${f(x - cw / 2)},${f(T + capH)}C${f(x - cw / 2)},${f(T + capH + 8)} ${f(x - hw)},${f(T + sh - 10)} ${f(x - hw)},${f(T + sh)}C${f(x - hw)},${f(T + h * 0.5)} ${f(x - waist)},${f(T + h * 0.58)} ${f(x - waist)},${f(T + h * 0.66)}C${f(x - waist)},${f(T + h * 0.78)} ${f(x - hw)},${f(T + h * 0.82)} ${f(x - hw)},${f(by - 10)}Q${f(x - hw)},${f(by)} ${f(x - hw + 10)},${f(by)}L${f(x + hw - 10)},${f(by)}Q${f(x + hw)},${f(by)} ${f(x + hw)},${f(by - 10)}C${f(x + hw)},${f(T + h * 0.82)} ${f(x + waist)},${f(T + h * 0.78)} ${f(x + waist)},${f(T + h * 0.66)}C${f(x + waist)},${f(T + h * 0.58)} ${f(x + hw)},${f(T + h * 0.5)} ${f(x + hw)},${f(T + sh)}C${f(x + hw)},${f(T + sh - 10)} ${f(x + cw / 2)},${f(T + capH + 8)} ${f(x + cw / 2)},${f(T + capH)}Z`;
    let s = `<path d="${d}" fill="${o.body}"/>`;
    if (!o.opaque) s += `<path d="${d}" fill="#fff" opacity=".12"/>`;
    const ly = T + h * 0.38, lh = h * 0.42;
    s += `<rect x="${f(x - hw * 0.78)}" y="${f(ly)}" width="${f(hw * 1.56)}" height="${f(lh)}" rx="${f(hw * 0.4)}" fill="${o.label || "#fff"}" opacity=".94"/>`;
    s += `<circle cx="${f(x)}" cy="${f(ly + lh * 0.36)}" r="${f(hw * 0.36)}" fill="${o.emblem || o.body}"/>`;
    s += `<path d="M${f(x + hw * 0.1)},${f(ly + lh * 0.36 - hw * 0.36)}q${f(hw * 0.3)},${f(-hw * 0.3)} ${f(hw * 0.5)},${f(-hw * 0.1)}q${f(-hw * 0.25)},${f(hw * 0.3)} ${f(-hw * 0.5)},${f(hw * 0.1)}z" fill="${o.leaf || "#4f9d4a"}"/>`;
    s += `<rect x="${f(x - hw * 0.5)}" y="${f(ly + lh * 0.7)}" width="${f(hw)}" height="${f(lh * 0.08)}" rx="2" fill="${dk(o.body, 0.15)}" opacity=".6"/>`;
    s += `<path d="${d}" fill="url(#cy)"/>`;
    s += `<path d="M${f(x - hw * 0.62)},${f(T + sh + 6)}C${f(x - hw * 0.7)},${f(T + h * 0.5)} ${f(x - waist * 0.68)},${f(T + h * 0.6)} ${f(x - waist * 0.66)},${f(T + h * 0.7)}" stroke="#fff" stroke-opacity=".55" stroke-width="${f(w * 0.07)}" fill="none" stroke-linecap="round"/>`;
    s += `<path d="${d}" fill="none" stroke="${dk(o.body, 0.35)}" stroke-opacity=".3"/>`;
    const cap = o.cap || "#f7f7f7";
    s += `<path d="M${f(x - cw / 2)},${f(T + capH)}L${f(x - cw * 0.42)},${f(T + 3)}Q${f(x - cw * 0.4)},${f(T)} ${f(x - cw * 0.3)},${f(T)}L${f(x + cw * 0.3)},${f(T)}Q${f(x + cw * 0.4)},${f(T)} ${f(x + cw * 0.42)},${f(T + 3)}L${f(x + cw / 2)},${f(T + capH)}Z" fill="${cap}"/>`;
    s += `<path d="M${f(x - cw / 2)},${f(T + capH)}L${f(x - cw * 0.42)},${f(T + 3)}Q${f(x - cw * 0.4)},${f(T)} ${f(x - cw * 0.3)},${f(T)}L${f(x + cw * 0.3)},${f(T)}Q${f(x + cw * 0.4)},${f(T)} ${f(x + cw * 0.42)},${f(T + 3)}L${f(x + cw / 2)},${f(T + capH)}Z" fill="url(#cs)"/>`;
    s += `<path d="M${f(x - cw * 0.46)},${f(T + capH * 0.45)}H${f(x + cw * 0.46)}" stroke="${dk(cap, 0.2)}" stroke-width="1"/>`;
    return s;
  }

  /* bidon de lessive ou d'eau, poignée intégrée */
  function jug(x, by, w, h, o) {
    const L = x - w / 2, R = x + w / 2, T = by - h, r = 14;
    const outer = `M${f(L)},${f(by - r)}L${f(L)},${f(T + h * 0.3)}Q${f(L)},${f(T + h * 0.19)} ${f(L + w * 0.12)},${f(T + h * 0.17)}L${f(x - w * 0.02)},${f(T + h * 0.13)}L${f(x + w * 0.1)},${f(T + h * 0.08)}Q${f(x + w * 0.16)},${f(T)} ${f(x + w * 0.27)},${f(T)}L${f(R - w * 0.1)},${f(T)}Q${f(R)},${f(T)} ${f(R)},${f(T + h * 0.12)}L${f(R)},${f(by - r)}Q${f(R)},${f(by)} ${f(R - r)},${f(by)}L${f(L + r)},${f(by)}Q${f(L)},${f(by)} ${f(L)},${f(by - r)}Z`;
    const hx1 = x + w * 0.2, hx2 = R - w * 0.11, hy1 = T + h * 0.075, hy2 = T + h * 0.21;
    const hole = `M${f(hx1 + 6)},${f(hy1)}L${f(hx1)},${f(hy2)}L${f(hx2 - 5)},${f(hy2)}Q${f(hx2)},${f(hy2)} ${f(hx2)},${f(hy2 - 5)}L${f(hx2)},${f(hy1 + 5)}Q${f(hx2)},${f(hy1)} ${f(hx2 - 5)},${f(hy1)}Z`;
    const body = o.body;
    let s = `<path d="${outer + hole}" fill-rule="evenodd" fill="${body}"/>`;
    if (o.water) s += `<path d="${outer + hole}" fill-rule="evenodd" fill="#fff" opacity=".15"/>`;
    if (o.label) {
      const ly = T + h * 0.36, lh = h * 0.5;
      s += `<rect x="${f(L + w * 0.08)}" y="${f(ly)}" width="${f(w * 0.84)}" height="${f(lh)}" rx="12" fill="${o.label}"/>`;
      s += `<path d="M${f(L + w * 0.08)},${f(ly + lh * 0.62)}C${f(L + w * 0.35)},${f(ly + lh * 0.4)} ${f(L + w * 0.62)},${f(ly + lh * 0.85)} ${f(R - w * 0.08)},${f(ly + lh * 0.55)}L${f(R - w * 0.08)},${f(ly + lh - 12)}Q${f(R - w * 0.08)},${f(ly + lh)} ${f(R - w * 0.08 - 12)},${f(ly + lh)}L${f(L + w * 0.08 + 12)},${f(ly + lh)}Q${f(L + w * 0.08)},${f(ly + lh)} ${f(L + w * 0.08)},${f(ly + lh - 12)}Z" fill="${o.accent}"/>`;
      s += `<path d="M${f(L + w * 0.08)},${f(ly + lh * 0.7)}C${f(L + w * 0.35)},${f(ly + lh * 0.48)} ${f(L + w * 0.62)},${f(ly + lh * 0.93)} ${f(R - w * 0.08)},${f(ly + lh * 0.63)}" stroke="#fff" stroke-opacity=".8" stroke-width="2.2" fill="none"/>`;
      s += `<path d="M${f(x)},${f(ly + lh * 0.1)}c${f(-w * 0.09)},${f(lh * 0.14)} ${f(-w * 0.1)},${f(lh * 0.2)} ${f(-w * 0.1)},${f(lh * 0.25)}a${f(w * 0.1)},${f(w * 0.1)} 0 0 0 ${f(w * 0.2)},0c0,${f(-lh * 0.05)} ${f(-w * 0.01)},${f(-lh * 0.11)} ${f(-w * 0.1)},${f(-lh * 0.25)}z" fill="${o.drop || o.accent}"/>`;
    }
    if (o.water) for (let i = 0; i < 3; i++) { const y = T + h * (0.42 + i * 0.16); s += `<path d="M${f(L)},${f(y)}Q${f(x)},${f(y + 5)} ${f(R)},${f(y)}" stroke="${dk(body, 0.2)}" stroke-opacity=".4" fill="none"/>`; }
    s += `<path d="${outer + hole}" fill-rule="evenodd" fill="url(#cy)"/>`;
    s += `<path d="M${f(L + w * 0.08)},${f(T + h * 0.3)}V${f(by - 14)}" stroke="#fff" stroke-opacity=".45" stroke-width="${f(w * 0.05)}" stroke-linecap="round"/>`;
    s += `<path d="${outer + hole}" fill-rule="evenodd" fill="none" stroke="${dk(body, 0.35)}" stroke-opacity=".25"/>`;
    const cx = x - w * 0.2, cw = w * 0.34, cy = T + h * 0.16, ch = h * 0.11;
    s += `<rect x="${f(cx - cw / 2)}" y="${f(cy - ch)}" width="${f(cw)}" height="${f(ch)}" rx="3" fill="${o.cap}"/>`;
    for (let i = 1; i < 7; i++) s += `<path d="M${f(cx - cw / 2 + (cw * i) / 7)},${f(cy - ch + 2)}V${f(cy - 2)}" stroke="${dk(o.cap, 0.2)}" stroke-opacity=".5" stroke-width=".8"/>`;
    s += `<rect x="${f(cx - cw / 2)}" y="${f(cy - ch)}" width="${f(cw)}" height="${f(ch)}" rx="3" fill="url(#cs)"/>`;
    s += `<rect x="${f(cx - cw / 2 - 2)}" y="${f(cy - 2)}" width="${f(cw + 4)}" height="4" rx="2" fill="${dk(o.cap, 0.15)}"/>`;
    return s;
  }

  /* sachet doypack avec bouchon (recharges) */
  function doypack(x, by, w, h, o) {
    const L = x - w / 2, R = x + w / 2, T = by - h;
    const d = `M${f(L)},${f(T + 14)}Q${f(L)},${f(T)} ${f(L + 14)},${f(T)}L${f(R - w * 0.34)},${f(T)}L${f(R)},${f(T + h * 0.26)}Q${f(R + 3)},${f(T + h * 0.6)} ${f(R)},${f(by - 10)}Q${f(R)},${f(by)} ${f(R - 10)},${f(by)}L${f(L + 10)},${f(by)}Q${f(L)},${f(by)} ${f(L)},${f(by - 10)}Q${f(L - 3)},${f(T + h * 0.6)} ${f(L)},${f(T + 14)}Z`;
    let s = `<path d="${d}" fill="${o.body}"/>`;
    const ly = T + h * 0.38, lh = h * 0.46;
    s += `<rect x="${f(L + w * 0.1)}" y="${f(ly)}" width="${f(w * 0.8)}" height="${f(lh)}" rx="12" fill="${o.label || "#fff"}" opacity=".95"/>`;
    s += `<circle cx="${f(x)}" cy="${f(ly + lh * 0.4)}" r="${f(w * 0.16)}" fill="${o.accent}"/>`;
    s += `<rect x="${f(x - w * 0.24)}" y="${f(ly + lh * 0.74)}" width="${f(w * 0.48)}" height="${f(lh * 0.08)}" rx="2" fill="${o.accent}" opacity=".6"/>`;
    s += `<path d="${d}" fill="url(#cs)"/>`;
    s += `<path d="M${f(L + 4)},${f(by - 18)}Q${f(x)},${f(by - 10)} ${f(R - 4)},${f(by - 18)}" stroke="${dk(o.body, 0.25)}" stroke-opacity=".5" fill="none"/>`;
    const sx = R - w * 0.17, sy = T + h * 0.13;
    s += `<g transform="translate(${f(sx)},${f(sy)}) rotate(36)"><rect x="-10" y="-16" width="20" height="16" rx="3" fill="${o.cap}"/><rect x="-10" y="-16" width="20" height="16" rx="3" fill="url(#cs)"/><rect x="-12" y="-2" width="24" height="5" rx="2" fill="${dk(o.cap, 0.15)}"/></g>`;
    return s;
  }

  /* boîte de sardines dans son étui carton, l'extrémité de la boîte visible sur le côté */
  function tin(x, by, w, h, o) {
    const d = 46;
    const fish = `<path d="M-30,0C-19,-12 8,-12 19,0C8,12 -19,12 -30,0Z" fill="#fff" opacity=".94"/><path d="M19,0L32,-9L29,0L32,9Z" fill="#fff" opacity=".94"/><circle cx="-20" cy="-2" r="2.2" fill="${o.sleeve}"/><path d="M-8,-6Q-4,0 -8,6" stroke="${o.sleeve}" stroke-width="1.4" fill="none" opacity=".6"/>`;
    const tomato = `<circle r="15" fill="#fff" opacity=".95"/><circle r="11.5" fill="#e74c3c"/><path d="M0,-11l3,-5M0,-11l-4,-3M0,-11l5,-1M0,-11l-5,1" stroke="#2e7d32" stroke-width="2.2" stroke-linecap="round"/>`;
    return box(x - d / 2, by, w, d, h, {
      body: o.sleeve, metalSide: true, face: (L, T, ww, hh) =>
        `<rect x="${f(L)}" y="${f(T + hh * 0.72)}" width="${f(ww)}" height="${f(hh * 0.12)}" fill="#fff" opacity=".85"/>` +
        `<g transform="translate(${f(L + ww * 0.5)},${f(T + hh * 0.42)})">${o.tomato ? tomato : fish}</g>` +
        `<rect x="${f(L)}" y="${f(T)}" width="${f(ww)}" height="${f(hh * 0.1)}" fill="${dk(o.sleeve, 0.18)}"/>`
    });
  }

  /* capsule de café */
  function capsule(cx, cy, s, col) {
    return `<g transform="translate(${f(cx)},${f(cy)})"><path d="M${f(-s * 0.5)},${f(-s * 0.3)}L${f(-s * 0.34)},${f(s * 0.32)}Q0,${f(s * 0.42)} ${f(s * 0.34)},${f(s * 0.32)}L${f(s * 0.5)},${f(-s * 0.3)}Z" fill="${col}"/><path d="M${f(-s * 0.5)},${f(-s * 0.3)}L${f(-s * 0.34)},${f(s * 0.32)}Q0,${f(s * 0.42)} ${f(s * 0.34)},${f(s * 0.32)}L${f(s * 0.5)},${f(-s * 0.3)}Z" fill="url(#cy)"/><ellipse cy="${f(-s * 0.3)}" rx="${f(s * 0.6)}" ry="${f(s * 0.14)}" fill="url(#mt)"/></g>`;
  }

  /* ---------- palettes ---------- */
  const PAL = {
    eaux: ["#2a7bc0", "#e0525f", "#1d9b86", "#4d69d6", "#ef9d10", "#5aa86f", "#8a5bcf", "#2fa5d6"],
    cola: ["#c8902e", "#3c8d7e", "#6e7b8b", "#5b6eae", "#8c6239", "#2f7f4f"],
    jus: ["#2e8b57", "#e2791c", "#1f6fb2", "#7a9e3b", "#c0392b", "#8e44ad"],
    lait: ["#2b6cb0", "#3a8dde", "#1f9d8b", "#4c6ef5", "#2f9e44", "#5f6fd6"],
    yaourt: ["#4a90d9", "#58b368", "#e76f51", "#9b5de5", "#f4a261", "#2a9d8f", "#d1495b"],
    fromage: ["#2e6db4", "#c0392b", "#2e8b57", "#8e44ad", "#d35400", "#16a085", "#34495e"],
    pates: ["#1f5aa6", "#c62828", "#2e7d32", "#ef8f00", "#6a1b9a", "#00838f", "#d84315"],
    cafe: [["#3b2420", "#c9a227"], ["#1f3a5f", "#e8d3b0"], ["#5a2a27", "#e8c27a"], ["#2f4f3e", "#e8d3b0"], ["#4a3b2a", "#d98e04"], ["#232323", "#c9a227"], ["#7a1f2b", "#f0d7a1"]],
    gateaux: ["#c0392b", "#2e86c1", "#af601a", "#1e8449", "#7d3c98", "#d4ac0d", "#16a085"],
    papier: ["#2e86c1", "#45b39d", "#af7ac5", "#f5b041", "#5dade2", "#ec7063"],
    vaisselle: ["#2e86c1", "#c0392b", "#27ae60", "#8e44ad", "#f39c12"],
    lessive: ["#1f5fbf", "#2f9e44", "#7b2cbf", "#e85d04", "#0096c7", "#d6336c"],
  };

  /* format "2 x (6 x 1,5 L)", "6 x 1 L", "500 g", "12 rouleaux" */
  function parseFmt(s) {
    s = String(s || "").toLowerCase().replace(/,/g, ".");
    const u = (n, unit) => { n = parseFloat(n); return unit === "l" ? n * 1000 : unit === "cl" ? n * 10 : unit === "kg" ? n * 1000 : n; };
    let m = s.match(/(\d+)\s*x\s*\((\d+)\s*x\s*([\d.]+)\s*(cl|ml|l|g|kg)\)/);
    if (m) return { packs: +m[1], n: +m[2], v: u(m[3], m[4]) };
    m = s.match(/(\d+)\s*x\s*([\d.]+)\s*(cl|ml|l|g|kg)/);
    if (m) return { packs: 1, n: +m[1], v: u(m[2], m[3]) };
    m = s.match(/(\d+)\s*rouleaux?/);
    if (m) return { packs: 1, n: +m[1], v: 0, rolls: true };
    m = s.match(/([\d.]+)\s*(cl|ml|l|g|kg)\b/);
    if (m) return { packs: 1, n: 1, v: u(m[1], m[2]) };
    return { packs: 1, n: 1, v: 0 };
  }

  /* ---------- produit → dessin ---------- */
  function look(p) {
    const r = p.r || p.rayon, t = norm(p.brand + " " + p.name), q = parseFmt(p.format);
    const H = hash(p.brand || p.id);
    const pick = (arr, salt) => arr[(H + (salt || 0)) % arr.length];
    const L = { r, k: "", t, q, a: "" };
    if (r === "eaux") {
      L.a = pick(PAL.eaux);
      L.glass = /verre/.test(t);
      L.k = q.v >= 4000 ? "bidon" : q.n > 1 ? "packb" : "bottle";
      L.size = q.v >= 1250 ? "big" : q.v >= 900 ? "l1" : q.v >= 450 ? "s50" : q.v >= 300 ? "s33" : "s25";
      L.liq = L.glass ? "#d4ead9" : "#d8edf8";
      L.gaz = /gazeuse|petillante|bulles|sparkling/.test(t);
    } else if (r === "sodas") {
      L.liq = /orange/.test(t) ? "#f28a1a" : /citron|lemon|lime/.test(t) ? "#e9e4a6" : /\bthe\b|ice tea/.test(t) ? "#b8651b" : "#3b1e12";
      L.dark = L.liq === "#3b1e12";
      L.a = /sans sucre|zero|light|\bmax\b/.test(t) ? "#a9b0b8" : pick(PAL.cola);
      L.k = /cube|pastille/.test(t) ? "tube" : q.v && q.v <= 350 ? (q.n > 1 ? "packc" : "can") : q.n > 1 ? "packb" : "bottle";
      L.size = q.v >= 1250 ? "big" : q.v >= 900 ? "l1" : q.v >= 450 ? "s50" : "s33";
      L.glass = /verre/.test(t);
    } else if (r === "jus") {
      L.liq = /pomme/.test(t) ? "#e7be55" : /carotte/.test(t) ? "#f28c28" : /pamplemousse/.test(t) ? "#f2a58e" : /sanguine/.test(t) ? "#e2562c" : "#f7a21b";
      L.dark = true;
      L.a = pick(PAL.jus);
      L.k = /fontaine/.test(t) || q.v >= 2900 ? "bib" : q.n > 1 ? "packb" : "bottle";
      L.size = q.v >= 1250 ? "big" : q.v >= 700 ? "l1" : q.v >= 450 ? "s50" : "s25";
      L.glass = q.v && q.v <= 330 && q.n === 1;
    } else if (r === "lait") {
      L.cap = /entier/.test(t) ? "#d64545" : /\becreme\b/.test(t) && !/demi|1\/2/.test(t) ? "#3a9d5d" : /lactose/.test(t) ? "#7e57c2" : "#2b6cb0";
      L.a = pick(PAL.lait);
      L.bottle = /pasteuris|microfiltr|bouteille/.test(t);
      L.k = L.bottle && q.n === 1 ? "milkbottle" : q.n > 1 ? "packk" : "brick";
      L.small = q.v && q.v <= 330;
    } else if (r === "yaourts") {
      L.a = /bio/.test(t) ? pick(["#58b368", "#2a9d8f", "#7cb342"]) : pick(PAL.yaourt);
      L.lid = /brebis/.test(t) ? "#e9c46a" : /chevre/.test(t) ? "#cfd8dc" : /vegetal|coco|soja|amande/.test(t) ? "#a1887f" : lt(L.a, 0.15);
      L.body = /carton|kraft/.test(t) ? "#e7d8bf" : /verre/.test(t) ? "#eef4f7" : "#fbfbfa";
      L.k = q.v >= 300 ? "jar" : "cups";
      L.n = q.n;
    } else if (r === "fromages") {
      L.cheese = /mozza/.test(t) ? "#f6f0e0" : /parmi|parmesan|grana|pecorino|copeaux/.test(t) ? "#eed9a6" : /cheddar|mimolette/.test(t) ? "#f0a030" : /comte|gruyere|beaufort/.test(t) ? "#f2c75c" : "#f6d26b";
      L.flakes = /copeaux|parmi|grana|pecorino/.test(t);
      L.a = pick(PAL.fromage);
      L.k = "cheese";
    } else if (r === "pates") {
      L.shape = /spaghet|linguin|fettuc|bucatini|capellini/.test(t) ? "long" : /cheveux|vermicel/.test(t) ? "thin" : /tagliatel|nid|pappardel/.test(t) ? "nest" : /lasagn/.test(t) ? "sheet" : /fusill|spiral|torsad|trofie|gemelli|caserecce/.test(t) ? "spiral" : /coquillet|coude|macaroni|maccheroni|cornet|elbow|pipe/.test(t) ? "elbow" : /farfal|papillon/.test(t) ? "bow" : /orecchiet/.test(t) ? "disc" : /conchigl|coquille|lumache/.test(t) ? "shell" : /rigaton|tortiglion|mezze|paccheri|tubetti/.test(t) ? "tube" : /lentille|pois chiche|quinoa|riz/.test(t) ? "lentil" : "penne";
      L.pc = /lentille corail|lentilles corail/.test(t) ? "#e07b39" : /pois chiche/.test(t) ? "#e3c35a" : /lentille/.test(t) ? "#8d9a3f" : /complet/.test(t) ? "#c9975a" : /oeuf/.test(t) ? "#f4c24a" : /epeautre|sarrasin/.test(t) ? "#b08a5a" : "#f0c66d";
      L.a = pick(PAL.pates);
      L.k = p.icon === "box" ? "pastabox" : "pastabag";
    } else if (r === "conserves") {
      L.sleeve = /tomate/.test(t) ? "#c0392b" : /citron/.test(t) ? "#d4a017" : /piment|espelette/.test(t) ? "#d35400" : /fume/.test(t) ? "#6d4c41" : /olive/.test(t) ? pick(["#3f6f3a", "#2f5f6f", "#1f4e79", "#556b2f"]) : pick(["#1f4e79", "#2e7d32", "#8e2c2c", "#264653", "#b5651d"]);
      L.k = "tin"; L.n = q.n;
    } else if (r === "cafe") {
      const pal = /intense|corse|robusta|espresso|italien|ristretto|forte/.test(t) ? ["#2a1b18", "#c9a227"] : /decafe|sans cafeine/.test(t) ? ["#b5651d", "#f3e2c4"] : /bio|equitable/.test(t) ? ["#2f5d46", "#e8d3b0"] : pick(PAL.cafe);
      L.body = pal[0]; L.a = pal[1];
      L.k = /capsule|dosette/.test(t) ? "capsules" : /grain/.test(t) ? "beans" : "coffee";
      L.n = q.n * q.packs;
    } else if (r === "gateaux") {
      L.piece = /napolitain/.test(t) ? "napolitain" : /financier/.test(t) ? "financier" : /moelleux|brownie/.test(t) && !/madeleine/.test(t) ? "moelleux" : /longue/.test(t) ? "longue" : /cake|quatre.quarts|marbre/.test(t) && !/madeleine/.test(t) ? "cake" : "madeleine";
      L.cc = /chocolat|cacao/.test(t) && !/pepite|fourre|marbre/.test(t) ? "#7a4a2c" : /marbre/.test(t) ? "#a8743f" : /citron/.test(t) ? "#ecc35f" : "#e3a24b";
      L.a = pick(PAL.gateaux);
      L.k = "cakebag";
    } else if (r === "papier") {
      L.body = /rose/.test(t) ? "#f6d7de" : /non blanchi|recycl|bambou|ecolabel|naturel/.test(t) ? "#efe5d4" : "#fbfbf8";
      L.a = pick(PAL.papier);
      L.n = q.rolls ? q.n : 6;
      L.coreless = /sans tube/.test(t);
      L.k = "rolls";
    } else if (r === "vaisselle") {
      L.liq = /citron vert|lime/.test(t) ? "#9bcb3b" : /citron|lemon/.test(t) ? "#f4d03f" : /menthe/.test(t) ? "#48c9b0" : /peche|abricot|mangue|melon|agrume|orange|pamplemousse/.test(t) ? "#f5a962" : /framboise|fruits rouges|grenade|cerise|fraise/.test(t) ? "#e8577e" : /pomme/.test(t) ? "#a2d149" : /lavande|violette/.test(t) ? "#a48cd6" : /aloe/.test(t) ? "#b7e4a7" : /amande|lait|coco/.test(t) ? "#efe3cc" : /savon noir/.test(t) ? "#4e3b2a" : /bicarbonate|marseille|vinaigre blanc|neutre|sans parfum/.test(t) ? "#e7dcc4" : /basilic|thym|romarin|verveine/.test(t) ? "#6fb26a" : "#4caf50";
      L.a = pick(PAL.vaisselle);
      L.k = /solide/.test(t) ? "soap" : /recharge/.test(t) ? "doy" : /lave.vaisselle|tablette/.test(t) ? "flaconopaque" : "flacon";
    } else if (r === "lessive") {
      L.body = /sensible|sensitive|hypoaller|bebe|tolerance/.test(t) ? "#e9f1fa" : /laine|delicat/.test(t) ? "#f4dbe7" : /noir|black|sombre/.test(t) ? "#2b2f3a" : /white|blanc/.test(t) ? "#f4f7fb" : /couleur|color/.test(t) ? "#7b4fc4" : /marseille|vegetal|savon/.test(t) ? "#e9d8b6" : /lavande/.test(t) ? "#b79ad9" : /azur|fraicheur|frais|ocean|brise/.test(t) ? "#52a8e0" : /ecolabel|eco|nature/.test(t) ? "#7fbf6a" : pick(["#2a6fd6", "#1d9bb8", "#3b5bdb", "#16a34a", "#e8590c"]);
      L.a = pick(PAL.lessive);
      L.k = /recharge|eco.?recharge/.test(t) ? "doyl" : "jugl";
    } else if (r === "oeufs") {
      L.a = pick(["#c8a76b", "#b98b54", "#d4b483", "#a9c3a0"]);
      L.n = q.n > 1 ? q.n : (+(/(\d+)\s*oeufs/.exec(t) || [])[1] || 6);
      L.k = "eggs";
    } else if (r === "beurre") {
      L.a = /demi.?sel|\bsel\b|salé/.test(t) ? "#1f6fb2" : /doux/.test(t) ? "#d4a017" : pick(["#d4a017", "#c0392b", "#2e7d32", "#1f6fb2"]);
      L.k = "butter";
    } else if (r === "riz") {
      L.shape = "lentil";
      L.pc = /complet|brun|rouge|noir|sauvage|camargue/.test(t) ? "#a0764a" : "#f4efe2";
      L.a = pick(["#c0392b", "#1f4e79", "#2e7d32", "#b5651d", "#7d3c98"]);
      L.k = "pastabag";
    } else if (r === "farine" || r === "sucre") {
      L.body = r === "sucre" && /roux|cassonade|complet|canne/.test(t) ? "#d8b48a" : r === "farine" ? "#f3ede1" : "#fdfdfb";
      L.a = pick(r === "farine" ? ["#1f4e79", "#c0392b", "#2e7d32", "#b5651d"] : ["#1f6fb2", "#c0392b", "#2e7d32", "#7d3c98"]);
      L.cube = r === "sucre" && /morceau|cube/.test(t);
      L.k = "sack";
    } else if (r === "huile") {
      L.liq = /olive/.test(t) ? "#9aa23a" : /colza/.test(t) ? "#e3c13a" : "#f0c53c";
      L.a = pick(["#2e7d32", "#c0392b", "#1f4e79", "#d4a017"]);
      L.size = q.v >= 900 ? "l1" : "s50";
      L.dark = true;
      L.k = "bottle";
    } else if (r === "tomates") {
      L.sleeve = pick(["#c0392b", "#a93226", "#d35400"]); L.tomato = true; L.k = "tin"; L.n = q.n;
    } else if (r === "thon") {
      L.sleeve = pick(["#1f4e79", "#2e86c1", "#2e7d32", "#b9770e", "#264653"]); L.k = "tin"; L.n = q.n;
    } else {
      L.k = "generic"; L.a = "#8a8f98";
    }
    return L;
  }

  /* ---------- rendu ---------- */
  function draw(L, seed) {
    const B = 214;
    let s = "", gr = ground(120, B + 1, 92, 8);
    const a = L.a;
    switch (L.k) {
      case "bottle": {
        const big = L.glass ? [62, 188] : { big: [66, 190], l1: [64, 186], s50: [64, 180], s33: [66, 172], s25: [66, 170] }[L.size || "big"];
        const o = L.r === "eaux" ? { body: L.liq, cap: a, label: "#fff", accent: a, ribs: !L.glass, glass: L.glass, metal: L.glass } :
          { body: L.liq, cap: L.r === "jus" ? lt(a, 0.1) : a, label: L.r === "sodas" ? (L.dark ? lt(a, 0.55) : "#fff") : "#fff", accent: a, dark: L.dark, glass: L.glass, metal: L.glass };
        if (L.r === "sodas" && L.dark) { o.label = a; o.accent = "#fff"; }
        s = bottle(120, B, big[0], big[1], o);
        gr = ground(120, B + 1, big[0] * 0.75, 7);
        break;
      }
      case "milkbottle": {
        s = bottle(120, B, 66, 184, { body: "#fbfbfa", cap: L.cap, label: L.a, accent: "#fff" });
        gr = ground(120, B + 1, 52, 7);
        break;
      }
      case "can": {
        s = can(120, B, 92, 170, { body: L.dark ? a : L.liq, accent: L.dark ? "#fff" : a, label: L.dark ? lt(a, 0.5) : "#fff" });
        gr = ground(120, B + 1, 66, 8);
        break;
      }
      case "packb": {
        const dims = { big: [52, 150], l1: [48, 134], s50: [41, 110], s33: [37, 96], s25: [34, 88] }[L.size || "big"];
        const [w, h] = dims, gap = 1.5, rowW = 3 * w + 2 * gap, x0 = 120 - rowW / 2 + w / 2 - w * 0.2;
        const ob = { body: L.liq, cap: L.r === "eaux" ? a : L.r === "sodas" ? (L.dark ? dk(a, 0.1) : a) : lt(a, 0.1), dark: L.dark, glass: L.glass, metal: L.glass, ribs: L.r === "eaux" && !L.glass };
        for (let i = 0; i < 3; i++) s += bottle(x0 + i * (w + gap) + w * 0.42, B - 8, w * 0.97, h * 0.97, { ...ob, dim: true });
        for (let i = 0; i < 3; i++) s += bottle(x0 + i * (w + gap), B, w, h, ob);
        const FL = x0 - w / 2 - 2, FR = x0 + 2 * (w + gap) + w / 2 + 2;
        s += `<rect x="${f(FL)}" y="${f(B - h * 0.67)}" width="${f(FR - FL)}" height="${f(h * 0.67)}" rx="7" fill="url(#fm)" stroke="#fff" stroke-opacity=".55"/>`;
        const by1 = B - h * 0.5, bh = h * 0.2;
        s += `<rect x="${f(FL)}" y="${f(by1)}" width="${f(FR - FL)}" height="${f(bh)}" fill="${L.r === "sodas" && L.dark ? a : a}"/>`;
        s += `<rect x="${f(FL)}" y="${f(by1 + bh * 0.66)}" width="${f(FR - FL)}" height="${f(bh * 0.14)}" fill="#fff" opacity=".9"/>`;
        s += `<circle cx="${f(120 - w * 0.2)}" cy="${f(by1 + bh * 0.34)}" r="${f(bh * 0.22)}" fill="#fff" opacity=".92"/>`;
        const hy = B - h + 2;
        s += `<path d="M${f(x0 + w * 0.15)},${f(hy + 6)}C${f(x0 + w * 0.3)},${f(hy - 24)} ${f(x0 + 2 * (w + gap) - w * 0.3)},${f(hy - 24)} ${f(x0 + 2 * (w + gap) - w * 0.15)},${f(hy + 6)}" stroke="${dk(a, 0.1)}" stroke-width="7" fill="none" stroke-linecap="round"/>`;
        s += `<path d="M${f(x0 + w * 0.15)},${f(hy + 6)}C${f(x0 + w * 0.3)},${f(hy - 24)} ${f(x0 + 2 * (w + gap) - w * 0.3)},${f(hy - 24)} ${f(x0 + 2 * (w + gap) - w * 0.15)},${f(hy + 6)}" stroke="#fff" stroke-opacity=".45" stroke-width="2" fill="none" stroke-linecap="round"/>`;
        gr = ground(124, B + 1, 100, 9);
        break;
      }
      case "packc": {
        const w = 44, h = 82, gap = 1, x0 = 120 - (3 * w + 2 * gap) / 2 + w / 2 - 10;
        const oc = { body: L.dark ? a : L.liq, accent: L.dark ? "#fff" : a, label: L.dark ? lt(a, 0.5) : "#fff" };
        for (let i = 0; i < 3; i++) s += can(x0 + i * (w + gap) + 22, B - 30, w, h, { ...oc, dim: true });
        for (let i = 0; i < 3; i++) s += can(x0 + i * (w + gap) + 11, B - 15, w, h, { ...oc, dim: true });
        for (let i = 0; i < 3; i++) s += can(x0 + i * (w + gap), B, w, h, oc);
        s += `<rect x="${f(x0 - w / 2 - 2)}" y="${f(B - h - 34)}" width="${f(3 * w + 2 * gap + 26)}" height="${f(h + 34)}" rx="9" fill="url(#fm)" opacity=".7"/>`;
        gr = ground(130, B + 1, 100, 9);
        break;
      }
      case "tube": {
        s = box(112, B, 64, 22, 150, { body: lt(a, 0.75), face: (Lx, T, w, h) => `<rect x="${f(Lx)}" y="${f(T + h * 0.18)}" width="${f(w)}" height="${f(h * 0.5)}" fill="${a}"/><circle cx="${f(Lx + w / 2)}" cy="${f(T + h * 0.43)}" r="${f(w * 0.22)}" fill="${L.liq}"/>` });
        gr = ground(120, B + 1, 56, 7);
        break;
      }
      case "bib": {
        s = box(112, B, 130, 34, 150, {
          body: "#fff4e0", face: (Lx, T, w, h) => `<path d="M${f(Lx)},${f(T + h * 0.52)}C${f(Lx + w * 0.3)},${f(T + h * 0.42)} ${f(Lx + w * 0.7)},${f(T + h * 0.62)} ${f(Lx + w)},${f(T + h * 0.5)}V${f(T + h)}H${f(Lx)}Z" fill="${L.liq}"/><circle cx="${f(Lx + w * 0.5)}" cy="${f(T + h * 0.28)}" r="${f(h * 0.14)}" fill="${L.liq}"/><rect x="${f(Lx)}" y="${f(T)}" width="${f(w)}" height="${f(h * 0.08)}" fill="${a}"/>` +
            `<g transform="translate(${f(Lx + w * 0.5)},${f(T + h * 0.82)})"><rect x="-10" y="-8" width="20" height="14" rx="3" fill="${a}"/><rect x="-4" y="6" width="8" height="10" rx="2" fill="${dk(a, 0.2)}"/></g>`
        });
        gr = ground(126, B + 1, 92, 8);
        break;
      }
      case "brick": {
        const w = L.small ? 62 : 74, h = L.small ? 120 : 160;
        s = brick(112, B, w, 26, h, { body: "#fafbfc", accent: L.a, cap: L.cap });
        gr = ground(124, B + 1, 64, 8);
        break;
      }
      case "packk": {
        const w = L.small ? 44 : 52, h = L.small ? 84 : 118, d = 18;
        const x0 = 120 - (3 * w) / 2 + w / 2 - 8;
        for (let i = 0; i < 3; i++) s += brick(x0 + i * w + d * 0.9, B - d * 0.5, w, d, h, { body: "#fafbfc", accent: L.a, cap: L.cap, dim: true });
        for (let i = 0; i < 3; i++) s += brick(x0 + i * w, B, w, d, h, { body: "#fafbfc", accent: L.a, cap: L.cap });
        const FL = x0 - w / 2 - 2, FR = x0 + 2 * w + w / 2 + d + 2;
        s += `<path d="M${f(FL)},${f(B - h - 2)}L${f(FR - d - 2)},${f(B - h - 2)}L${f(FR)},${f(B - h - 2 - d * 0.55)}L${f(FR)},${f(B - d * 0.55)}L${f(FR - d - 2)},${f(B)}L${f(FL)},${f(B)}Z" fill="url(#fm)" stroke="#fff" stroke-opacity=".55"/>`;
        const hy = B - h - 4;
        s += `<path d="M${f(x0 + w * 0.2)},${f(hy)}C${f(x0 + w * 0.4)},${f(hy - 30)} ${f(x0 + 2 * w - w * 0.2)},${f(hy - 30)} ${f(x0 + 2 * w + w * 0.1)},${f(hy)}" stroke="${dk(L.a, 0.1)}" stroke-width="7" fill="none" stroke-linecap="round"/>`;
        gr = ground(126, B + 1, 100, 9);
        break;
      }
      case "cups": {
        const n = L.n || 1;
        const o = { body: L.body, accent: L.a, lid: L.lid };
        if (n >= 8) {
          const wt = 52, wb = 40, h = 50;
          for (let i = 0; i < 3; i++) s += cup(74 + i * 50 + 18, B - 22, wt, wb, h, { ...o, dim: true });
          for (let i = 0; i < 3; i++) s += cup(74 + i * 50, B, wt, wb, h, o);
          s += `<rect x="40" y="${f(B - 92)}" width="178" height="40" rx="4" fill="${o.accent}" opacity=".0"/>`;
          gr = ground(126, B + 1, 96, 9);
        } else if (n >= 3) {
          const wt = 66, wb = 50, h = 64;
          s += cup(100 + 26, B - 26, wt, wb, h, { ...o, dim: true }) + cup(162 + 26, B - 26, wt, wb, h, { ...o, dim: true });
          s += cup(92, B, wt, wb, h, o) + cup(156, B, wt, wb, h, o);
          gr = ground(132, B + 1, 90, 9);
        } else if (n === 2) {
          const wt = 74, wb = 56, h = 72;
          s += cup(86, B, wt, wb, h, o) + cup(158, B, wt, wb, h, o);
          gr = ground(122, B + 1, 82, 8);
        } else {
          s = cup(120, B, 96, 72, 92, o);
          gr = ground(120, B + 1, 56, 7);
        }
        break;
      }
      case "jar": {
        s = (L.n > 1 ? jar(150, B - 16, 108, 96, { body: L.body, accent: L.a, lid: L.lid }) : "") + jar(L.n > 1 ? 104 : 120, B, 124, 112, { body: L.body, accent: L.a, lid: L.lid });
        gr = ground(L.n > 1 ? 126 : 120, B + 1, 84, 8);
        break;
      }
      case "cheese": {
        s = pouch(120, B, 132, 176, { body: "#fbfaf6", accent: L.a, window: (x, y, w, h) => cheese(L.cheese, x, y, w, h, seed, L.flakes) });
        gr = ground(120, B + 1, 72, 8);
        break;
      }
      case "pastabag": {
        const long = L.shape === "long" || L.shape === "thin";
        s = pillow(120, B, long ? 96 : 140, long ? 196 : 176, { accent: L.a, inner: lt(L.pc, 0.35), fill: (x, y, w, h) => pasta(L.shape, L.pc, x, y, w, h, seed), bandH: long ? 0.2 : 0.24 });
        gr = ground(120, B + 1, long ? 58 : 78, 8);
        break;
      }
      case "pastabox": {
        const long = L.shape === "long" || L.shape === "thin";
        const w = long ? 70 : 112, d = long ? 22 : 30, h = long ? 186 : 160;
        s = box(120 - d / 2, B, w, d, h, {
          body: L.a, face: (Lx, T, ww, hh) => {
            const wx = Lx + ww * 0.12, wy = T + hh * 0.34, w2 = ww * 0.76, h2 = hh * 0.44;
            return `<rect x="${f(Lx)}" y="${f(T + hh * 0.06)}" width="${f(ww)}" height="${f(hh * 0.2)}" fill="#fff" opacity=".9"/><ellipse cx="${f(Lx + ww / 2)}" cy="${f(T + hh * 0.16)}" rx="${f(ww * 0.28)}" ry="${f(hh * 0.06)}" fill="${L.a}"/>` +
              `<clipPath id="bw"><rect x="${f(wx)}" y="${f(wy)}" width="${f(w2)}" height="${f(h2)}" rx="10"/></clipPath><rect x="${f(wx)}" y="${f(wy)}" width="${f(w2)}" height="${f(h2)}" rx="10" fill="${lt(L.pc, 0.3)}"/><g clip-path="url(#bw)">${pasta(L.shape, L.pc, wx, wy, w2, h2, seed)}<rect x="${f(wx)}" y="${f(wy)}" width="${f(w2)}" height="${f(h2)}" fill="url(#fm)"/></g><rect x="${f(wx)}" y="${f(wy)}" width="${f(w2)}" height="${f(h2)}" rx="10" fill="none" stroke="#fff" stroke-width="2"/>` +
              `<rect x="${f(Lx)}" y="${f(T + hh * 0.86)}" width="${f(ww)}" height="${f(hh * 0.06)}" fill="#fff" opacity=".85"/>`;
          }
        });
        gr = ground(122, B + 1, long ? 56 : 78, 8);
        break;
      }
      case "eggs": {
        const n = L.n >= 10 ? 4 : 3;
        s = box(120 - 23, B, 150, 46, 60, {
          body: L.a, face: (Lx, T, w, h) => {
            let e = "";
            for (let i = 0; i < n; i++) { const cx = Lx + (w * (i + 0.5)) / n; e += `<ellipse cx="${f(cx + 6)}" cy="${f(T - 8)}" rx="${f((w / n) * 0.3)}" ry="${f(h * 0.36)}" fill="#f7ecd9" stroke="${dk(L.a, 0.28)}" stroke-width="1"/>`; }
            return e + `<rect x="${f(Lx)}" y="${f(T)}" width="${f(w)}" height="${f(h)}" fill="${L.a}"/><rect x="${f(Lx)}" y="${f(T + h * 0.34)}" width="${f(w)}" height="${f(h * 0.34)}" fill="#fff" opacity=".88"/><rect x="${f(Lx + w * 0.3)}" y="${f(T + h * 0.44)}" width="${f(w * 0.4)}" height="${f(h * 0.14)}" rx="3" fill="${dk(L.a, 0.2)}" opacity=".75"/>`;
          },
        });
        gr = ground(122, B + 1, 96, 8);
        break;
      }
      case "butter": {
        s = box(120 - 20, B, 136, 40, 56, {
          body: L.a, face: (Lx, T, w, h) => `<rect x="${f(Lx + w * 0.07)}" y="${f(T + h * 0.2)}" width="${f(w * 0.86)}" height="${f(h * 0.6)}" rx="7" fill="#fff" opacity=".92"/><rect x="${f(Lx + w * 0.2)}" y="${f(T + h * 0.38)}" width="${f(w * 0.6)}" height="${f(h * 0.12)}" rx="3" fill="${L.a}" opacity=".85"/><rect x="${f(Lx + w * 0.3)}" y="${f(T + h * 0.56)}" width="${f(w * 0.4)}" height="${f(h * 0.08)}" rx="2" fill="${L.a}" opacity=".5"/>`,
        });
        gr = ground(122, B + 1, 90, 8);
        break;
      }
      case "sack": {
        const h = L.cube ? 96 : 150, w = L.cube ? 120 : 96;
        s = box(120 - 17, B, w, 34, h, {
          body: L.body, crimpTop: !L.cube, face: (Lx, T, ww, hh) => `<rect x="${f(Lx)}" y="${f(T + hh * 0.16)}" width="${f(ww)}" height="${f(hh * 0.28)}" fill="${L.a}"/><circle cx="${f(Lx + ww / 2)}" cy="${f(T + hh * 0.62)}" r="${f(Math.min(ww, hh) * 0.16)}" fill="${lt(L.a, 0.72)}"/><rect x="${f(Lx + ww * 0.2)}" y="${f(T + hh * 0.84)}" width="${f(ww * 0.6)}" height="${f(hh * 0.04)}" rx="2" fill="${L.a}" opacity=".6"/>`,
        });
        gr = ground(120, B + 1, L.cube ? 86 : 74, 8);
        break;
      }
      case "tin": {
        const two = L.n > 1, h = two ? 58 : 76;
        s += tin(120, B, 168, h, { sleeve: L.sleeve, tomato: L.tomato });
        if (two) s += tin(120, B - h - 1, 168, h, { sleeve: dk(L.sleeve, 0.06), tomato: L.tomato });
        gr = ground(126, B + 1, 100, 9);
        break;
      }
      case "coffee": {
        const two = L.n > 1;
        const one = (x, by, dim) => box(x, by, 76, 26, 156, {
          body: dim ? dk(L.body, 0.15) : L.body, crimpTop: true, face: (Lx, T, w, h) =>
            `<rect x="${f(Lx)}" y="${f(T + h * 0.1)}" width="${f(w)}" height="${f(h * 0.05)}" fill="${L.a}"/><circle cx="${f(Lx + w / 2)}" cy="${f(T + h * 0.42)}" r="${f(w * 0.26)}" fill="${L.a}" opacity=".95"/>${bean(Lx + w / 2, T + h * 0.42, w * 0.13, L.body)}<rect x="${f(Lx + w * 0.18)}" y="${f(T + h * 0.66)}" width="${f(w * 0.64)}" height="${f(h * 0.04)}" rx="2" fill="${L.a}" opacity=".8"/><rect x="${f(Lx + w * 0.28)}" y="${f(T + h * 0.73)}" width="${f(w * 0.44)}" height="${f(h * 0.03)}" rx="2" fill="${L.a}" opacity=".5"/>`
        });
        if (two) s += one(146, B - 12, true) + one(96, B, false); else s += one(112, B, false);
        gr = ground(120, B + 1, two ? 92 : 62, 8);
        break;
      }
      case "beans": {
        s = pouch(120, B, 126, 178, {
          body: L.body, accent: L.a, valve: true, window: null, bean: true
        });
        gr = ground(120, B + 1, 70, 8);
        break;
      }
      case "capsules": {
        s = box(112, B, 130, 34, 110, {
          body: L.body, face: (Lx, T, w, h) => `<rect x="${f(Lx)}" y="${f(T + h * 0.12)}" width="${f(w)}" height="${f(h * 0.08)}" fill="${L.a}"/>` + capsule(Lx + w * 0.34, T + h * 0.58, 34, L.a) + capsule(Lx + w * 0.66, T + h * 0.62, 34, lt(L.a, 0.25))
        });
        gr = ground(126, B + 1, 90, 8);
        break;
      }
      case "cakebag": {
        const pc = L.piece, cc = L.cc;
        s = pillow(116, B - 6, 156, 150, {
          accent: L.a, inner: "#f7efe1", bandH: 0.22,
          fill: (x, y, w, h) => {
            let g = "";
            const sz = pc === "longue" ? 40 : 46;
            const pos = [[0.27, 0.52], [0.72, 0.5], [0.3, 0.86], [0.74, 0.84]];
            pos.forEach(([px, py], i) => { g += cakePiece(pc, x + w * px, y + h * py, sz, i % 2 ? 8 : -6, cc); });
            return g;
          }
        });
        s += cakePiece(pc, 170, B - 14, 52, -12, cc);
        gr = ground(126, B + 1, 92, 8);
        break;
      }
      case "rolls": {
        const n = L.n || 6;
        const cols = n <= 4 ? 2 : n <= 9 ? 3 : 4, rows = n <= 6 ? 2 : 3;
        s = rolls(B, cols, rows, { body: L.body, accent: L.a, coreless: L.coreless });
        gr = ground(120, B + 1, 96, 9);
        break;
      }
      case "flacon":
      case "flaconopaque": {
        s = flacon(120, B, 74, 188, { body: L.liq, cap: "#f4f4f2", label: "#fff", emblem: L.liq === "#4caf50" ? "#8bc34a" : dk(L.liq, 0.05), leaf: "#3f8f3a", opaque: L.k === "flaconopaque" });
        gr = ground(120, B + 1, 52, 7);
        break;
      }
      case "doy": {
        s = doypack(120, B, 124, 168, { body: lt(L.liq, 0.1), cap: "#f4f4f2", label: "#fff", accent: dk(L.liq, 0.08) });
        gr = ground(120, B + 1, 70, 8);
        break;
      }
      case "soap": {
        s = box(112, B, 132, 40, 64, { body: lt(L.a, 0.82), face: (Lx, T, w, h) => `<rect x="${f(Lx)}" y="${f(T + h * 0.3)}" width="${f(w)}" height="${f(h * 0.4)}" fill="${L.a}"/><ellipse cx="${f(Lx + w / 2)}" cy="${f(T + h / 2)}" rx="${f(w * 0.2)}" ry="${f(h * 0.16)}" fill="#fff" opacity=".9"/>` });
        gr = ground(124, B + 1, 90, 8);
        break;
      }
      case "jugl": {
        const light = h2r(L.body).reduce((x, y) => x + y, 0) > 600;
        s = jug(120, B, 136, 176, { body: L.body, cap: light ? L.a : lt(L.body, 0.82), label: "#fff", accent: L.a, drop: light ? L.a : L.body });
        gr = ground(120, B + 1, 82, 8);
        break;
      }
      case "doyl": {
        s = doypack(120, B, 132, 172, { body: L.body, cap: "#f2f2f2", label: "#fff", accent: L.a });
        gr = ground(120, B + 1, 74, 8);
        break;
      }
      case "bidon": {
        s = jug(120, B, 124, 182, { body: L.liq, cap: a, label: null, water: true });
        s += `<rect x="62" y="${f(B - 104)}" width="116" height="36" fill="${a}"/><rect x="62" y="${f(B - 80)}" width="116" height="5" fill="#fff" opacity=".9"/>`;
        gr = ground(120, B + 1, 76, 8);
        break;
      }
      default:
        s = box(112, B, 100, 30, 120, { body: "#e9ebee" });
    }
    return gr + s;
  }

  function svg(p) {
    const L = look(p);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><defs>${DEFS}</defs>${draw(L, hash(p.id) % 100000)}</svg>`;
  }

  const cache = new Map();
  function keyOf(p) { const L = look(p); return JSON.stringify([L.k, L.a, L.size, L.liq, L.cap, L.body, L.lid, L.n, L.shape, L.pc, L.cheese, L.flakes, L.sleeve, L.piece, L.cc, L.glass, L.small, L.coreless, L.k === "pastabag" || L.k === "pastabox" || L.k === "cheese" ? hash(p.brand) % 7 : 0]); }
  function url(p) {
    const k = keyOf(p);
    let u = cache.get(k);
    if (u) return u;
    const s = svg({ ...p, id: p.id && (look(p).k === "pastabag" || look(p).k === "pastabox" || look(p).k === "cheese") ? String(hash(p.brand) % 7) : p.id });
    try { u = URL.createObjectURL(new Blob([s], { type: "image/svg+xml" })); } catch (e) { u = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(s); }
    cache.set(k, u);
    return u;
  }

  G.Packs = { look, svg, url, parseFmt };
})(typeof window !== "undefined" ? window : globalThis);
