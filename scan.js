/* Lecture des codes-barres EAN-13 et EAN-8 (les codes des produits de grande surface) dans une image, sans
   bibliothèque. Plusieurs lignes de l'image sont lues, dans les deux sens ; chaque ligne est binarisée par un seuil
   local, découpée en barres et espaces, puis les gardes et les chiffres sont reconnus par la largeur des traits.
   Un code n'est accepté que si sa clé de contrôle est juste. window.Scan.decode(imageData) renvoie le code ou null. */
(() => {
  "use strict";
  /* largeurs des 4 traits de chaque chiffre, en modules (codage L ; R a les mêmes largeurs, G les a à l'envers) */
  const L = [[3, 2, 1, 1], [2, 2, 2, 1], [2, 1, 2, 2], [1, 4, 1, 1], [1, 1, 3, 2], [1, 2, 3, 1], [1, 1, 1, 4], [1, 3, 1, 2], [1, 2, 1, 3], [3, 1, 1, 2]];
  const G = L.map((r) => r.slice().reverse());
  const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

  /* largeur de chaque trait en modules, corrigée du gain d'impression (barres toutes un peu plus larges ou plus
     étroites que les espaces, mesuré sur les gardes) */
  function digitAt(runs, i, tables, bias) {
    const w = runs[i].w + runs[i + 1].w + runs[i + 2].w + runs[i + 3].w, m = w / 7;
    const v = [0, 1, 2, 3].map((k) => runs[i + k].w / m + (runs[i + k].b ? -bias : bias));
    let best = null, second = Infinity;
    for (const [tab, par] of tables) {
      for (let d = 0; d < 10; d++) {
        let e = 0;
        for (let k = 0; k < 4; k++) e += Math.abs(v[k] - tab[d][k]);
        if (!best || e < best.e) { if (best) second = best.e; best = { d, par, e }; } else if (e < second) second = e;
      }
    }
    best.margin = second - best.e;
    return best;
  }
  /* n traits à peu près égaux à partir de i, chacun proche du module m */
  const guard = (runs, i, n, m) => { for (let k = 0; k < n; k++) { if (!runs[i + k]) return false; const r = runs[i + k].w / m; if (r < 0.4 || r > 1.8) return false; } return true; };

  function checksum(digits) {
    let s = 0;
    for (let i = 0; i < digits.length - 1; i++) s += digits[i] * ((digits.length - i) % 2 === 0 ? 3 : 1);
    return (10 - (s % 10)) % 10 === digits[digits.length - 1];
  }

  /* runs : [{ w, b }] largeur en pixels, b = true pour une barre */
  function decodeRuns(runs) {
    let best = null;
    for (let i = 0; i + 3 < runs.length; i++) {
      if (!runs[i].b) continue;
      const m0 = (runs[i].w + runs[i + 1].w + runs[i + 2].w) / 3;
      if (m0 < 1.2 || !guard(runs, i, 3, m0)) continue;
      /* zone blanche avant le code */
      if (i > 0 && runs[i - 1].w < 2.5 * m0) continue;
      for (const [nd, len] of [[6, 59], [4, 43]]) {
        if (i + len > runs.length) continue;
        /* garde centrale et garde de fin, avec le module mesuré de part et d'autre */
        const c = i + 3 + nd * 4, e = c + 5 + nd * 4;
        const mC = (runs[c].w + runs[c + 1].w + runs[c + 2].w + runs[c + 3].w + runs[c + 4].w) / 5;
        const mE = (runs[e].w + runs[e + 1].w + runs[e + 2].w) / 3;
        if (!guard(runs, c, 5, m0 * 0.6 + mC * 0.4) || !guard(runs, e, 3, mE * 0.5 + mC * 0.5)) continue;
        if (mE / m0 > 2.2 || m0 / mE > 2.2) continue;
        if (i + len < runs.length && runs[i + len].w < 2.5 * mE) continue;
        /* gain : (barre - espace) / 2 sur les gardes, en modules */
        const bias = (((runs[i].w + runs[i + 2].w) / 2 - runs[i + 1].w) / m0 + ((runs[c + 1].w + runs[c + 3].w) / 2 - (runs[c].w + runs[c + 2].w + runs[c + 4].w) / 3) / mC + ((runs[e].w + runs[e + 2].w) / 2 - runs[e + 1].w) / mE) / 6;
        const digits = [], par = [];
        let err = 0, ok = true, margin = Infinity;
        for (let k = 0; k < nd && ok; k++) {
          const b = digitAt(runs, i + 3 + k * 4, nd === 6 ? [[L, "L"], [G, "G"]] : [[L, "L"]], bias);
          if (b.e > 1.7) ok = false; else { digits.push(b.d); par.push(b.par); err += b.e; margin = Math.min(margin, b.margin); }
        }
        for (let k = 0; k < nd && ok; k++) {
          const b = digitAt(runs, c + 5 + k * 4, [[L, "R"]], bias);
          if (b.e > 1.7) ok = false; else { digits.push(b.d); err += b.e; margin = Math.min(margin, b.margin); }
        }
        if (!ok) continue;
        if (nd === 6) {
          const first = PARITY.indexOf(par.join(""));
          if (first < 0) continue;
          digits.unshift(first);
        }
        if (!checksum(digits)) continue;
        const r = { code: digits.join(""), err: err / (nd * 2), margin };
        if (!best || r.err < best.err) best = r;
      }
    }
    return best;
  }

  /* une ligne de gris → traits : seuil à mi-chemin entre le plus clair et le plus sombre des alentours (ce qui vaut
     pour un éclairage inégal et des bords flous), puis les traits d'un pixel isolés sont fondus dans leurs voisins */
  function runsOf(g, W) {
    const n = g.length, lo = new Float32Array(n), hi = new Float32Array(n);
    for (let x = 0; x < n; x++) {
      let a = 255, b = 0;
      for (let k = Math.max(0, x - W); k < Math.min(n, x + W + 1); k++) { if (g[k] < a) a = g[k]; if (g[k] > b) b = g[k]; }
      lo[x] = a; hi[x] = b;
    }
    const runs = [];
    let cur = null;
    for (let x = 0; x < n; x++) {
      const bar = hi[x] - lo[x] > 30 ? g[x] < (lo[x] + hi[x]) / 2 : cur ? cur.b : false;
      if (cur && cur.b === bar) cur.w++; else { cur = { w: 1, b: bar }; runs.push(cur); }
    }
    return despeckle(runs);
  }
  function despeckle(runs) {
    const ws = runs.map((r) => r.w).sort((a, b) => a - b), med = ws[Math.floor(ws.length / 2)] || 1;
    const lim = Math.max(1, med * 0.3);
    const out = [];
    for (const r of runs) {
      const last = out[out.length - 1];
      if (last && r.w <= lim && out.length >= 1 && last.w > lim) {
        /* trait isolé : fondu dans le précédent, qui absorbera aussi le suivant de même couleur que lui */
        last.w += r.w; last.pend = true;
      } else if (last && last.pend && last.b === r.b) { last.w += r.w; last.pend = false; }
      else { if (last) last.pend = false; out.push({ w: r.w, b: r.b }); }
    }
    return out;
  }
  const smooth = (g, r) => { const n = g.length, o = new Float32Array(n); for (let x = 0; x < n; x++) { let s = 0, c = 0; for (let k = -r; k <= r; k++) { const xk = x + k; if (xk >= 0 && xk < n) { s += g[xk]; c++; } } o[x] = s / c; } return o; };
  function lineGray(data, width, x0, y0, dx, dy, n) {
    const g = new Float32Array(n);
    for (let k = 0; k < n; k++) { const i = ((y0 + k * dy) * width + (x0 + k * dx)) * 4; g[k] = 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2]; }
    return g;
  }
  function tryLine(g) {
    let lo = 255, hi = 0;
    for (let k = 0; k < g.length; k++) { if (g[k] < lo) lo = g[k]; if (g[k] > hi) hi = g[k]; }
    if (hi - lo < 40) return null;
    let best = null;
    for (const r of [0, 1, 2]) {
      const gs = r ? smooth(g, r) : g;
      for (const W of [12, 28]) {
        const runs = runsOf(gs, W);
        if (runs.length < 43) continue;
        for (const x of [decodeRuns(runs), decodeRuns(runs.slice().reverse())]) if (x && (!best || x.err < best.err)) best = x;
      }
      if (best && best.err < 0.5) break;
    }
    return best;
  }
  /* imageData : ImageData d'un canvas. Lignes horizontales, puis verticales. Renvoie { code, hits, err, margin } :
     hits = nombre de lignes où le même code a été lu ; l'appli n'accepte un code lu sur une seule ligne que s'il se
     confirme à l'image suivante. */
  function decode(imageData) {
    const { data, width, height } = imageData, found = new Map();
    const note = (r) => {
      const f = found.get(r.code) || { code: r.code, hits: 0, err: 0, margin: Infinity };
      f.hits++; f.err = Math.max(f.err, r.err); f.margin = Math.min(f.margin, r.margin);
      found.set(r.code, f);
      return f.hits >= 2 ? f : null;
    };
    for (const f of [0.5, 0.44, 0.56, 0.38, 0.62, 0.3, 0.7, 0.22, 0.78]) {
      const r = tryLine(lineGray(data, width, 0, Math.round(height * f), 1, 0, width));
      if (r) { const x = note(r); if (x) return x; }
    }
    for (const f of [0.5, 0.4, 0.6, 0.3, 0.7]) {
      const r = tryLine(lineGray(data, width, Math.round(width * f), 0, 0, 1, height));
      if (r) { const x = note(r); if (x) return x; }
    }
    let one = null;
    for (const f of found.values()) if (!one || f.err < one.err) one = f;
    return one;
  }
  const valid = (s) => /^\d{8}$|^\d{13}$/.test(s) && checksum(s.split("").map(Number));
  (typeof window !== "undefined" ? window : globalThis).Scan = { decode, decodeRuns, valid, checksum };
})();
