// Vérification du lecteur de codes-barres (scan.js) sur des images de synthèse : codes EAN-13 et EAN-8 à plusieurs
// tailles, avec bruit, flou, éclairage inégal et inclinaison ; une image de bruit seul ne doit rien donner.
// Usage : node tools/scancheck.js
const fs = require("fs");
const path = require("path");
new Function(fs.readFileSync(path.join(__dirname, "..", "scan.js"), "utf8"))();
const Scan = globalThis.Scan;
const Lb = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const Rb = Lb.map((s) => s.replace(/./g, (c) => (c === "0" ? "1" : "0")));
const Gb = Rb.map((s) => s.split("").reverse().join(""));
const PAR = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];
function bits(code) {
  const d = code.split("").map(Number);
  if (d.length === 13) {
    const par = PAR[d[0]];
    let s = "101";
    for (let i = 0; i < 6; i++) s += (par[i] === "L" ? Lb : Gb)[d[i + 1]];
    s += "01010";
    for (let i = 7; i < 13; i++) s += Rb[d[i]];
    return s + "101";
  }
  let s = "101";
  for (let i = 0; i < 4; i++) s += Lb[d[i]];
  s += "01010";
  for (let i = 4; i < 8; i++) s += Rb[d[i]];
  return s + "101";
}
function image(code, opt) {
  const b = bits(code), quiet = 12, scale = opt.scale, W = Math.round((b.length + 2 * quiet) * scale) + 40, H = 90;
  const px = new Float32Array(W * H).fill(opt.white);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const xx = x - 20 + (opt.tilt ? (y - H / 2) * opt.tilt : 0);
    const m = Math.floor(xx / scale) - quiet;
    const dark = m >= 0 && m < b.length && b[m] === "1";
    let v = dark ? opt.black : opt.white;
    if (opt.grad) v = v * (0.6 + 0.4 * (x / W));
    px[y * W + x] = v;
  }
  if (opt.blur) {
    const out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0, n = 0; for (let k = -opt.blur; k <= opt.blur; k++) { const xk = x + k; if (xk >= 0 && xk < W) { s += px[y * W + xk]; n++; } } out[y * W + x] = s / n; }
    px.set(out);
  }
  const data = new Uint8ClampedArray(W * H * 4);
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < W * H; i++) { const v = Math.max(0, Math.min(255, px[i] + (rnd() - 0.5) * opt.noise)); data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v; data[i * 4 + 3] = 255; }
  return { data, width: W, height: H };
}
const codes = ["3017620422003", "3270190021056", "5000159484695", "8000500310427", "3228857000906", "96385074", "20123451", "3560071268152", "4006381333931", "7622210449283"];
let ok = 0, n = 0, falsePos = 0; const stats = [];
for (const code of codes) for (const opt of [
  { scale: 3, black: 20, white: 235, noise: 0, blur: 0 },
  { scale: 2.3, black: 40, white: 220, noise: 30, blur: 1 },
  { scale: 1.7, black: 50, white: 200, noise: 24, blur: 1, grad: true },
  { scale: 4.1, black: 60, white: 210, noise: 40, blur: 2, tilt: 0.04 },
  { scale: 2.6, black: 30, white: 230, noise: 20, blur: 1, tilt: -0.06, grad: true },
]) {
  n++;
  const rr = Scan.decode(image(code, opt)), r = rr && rr.code; if (rr) stats.push([code === rr.code ? "ok" : "KO", rr.hits, rr.err.toFixed(2), rr.margin.toFixed(2)].join(":"));
  if (r === code) ok++; else { if (r) falsePos++; console.log("raté", code, JSON.stringify(opt), "->", r); }
}
// image sans code : rien ne doit être lu
let seed = 3; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const W = 400, H = 90, data = new Uint8ClampedArray(W * H * 4); for (let i = 0; i < W * H; i++) { const v = 80 + rnd() * 150; data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v; data[i * 4 + 3] = 255; }
console.log("bruit seul ->", Scan.decode({ data, width: W, height: H }) && "FAUX");
console.log(`${ok}/${n} lus, ${falsePos} faux`);
process.exit(ok >= 36 && !falsePos ? 0 : 1);
