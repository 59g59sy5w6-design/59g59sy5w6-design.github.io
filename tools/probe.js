// Essai d'accès : ouvre quelques pages d'enseignes depuis les serveurs de GitHub, comme le robot de relevé,
// et note ce qui s'affiche (page normale, vérification humaine, page anti-robot, prix visibles ou non).
// Aucune tentative de contourner un blocage : on regarde, on note, on passe.
// Usage : node tools/probe.js   (compte rendu dans tools/work/probe.json)
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const PAGES = [
  ["leclerc-drive", "https://www.leclercdrive.fr/"],
  ["leclerc-fiche", "https://www.e.leclerc/fp/lait-de-montagne-demi-ecreme-brique-1-l-delisse-3564700596241"],
  ["auchan", "https://www.auchan.fr/"],
  ["auchan-fiche", "https://www.auchan.fr/auchan-bio-lait-equitable-demi-ecreme-bouteille-6x1l/pr-289734"],
  ["intermarche", "https://www.intermarche.com/"],
  ["coursesu", "https://www.coursesu.com/"],
  ["carrefour", "https://www.carrefour.fr/"],
];
const MARKERS = {
  datadome: /captcha-delivery\.com|datadome/i,
  cloudflare: /cf-chl|challenge-platform|Just a moment/i,
  akamai: /Access Denied|Reference #\d/i,
  verification: /Human Verification|vérification|Un instant|robot/i,
};
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ userAgent: UA, locale: "fr-FR", timezoneId: "Europe/Paris", viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  const out = [];
  for (const [id, url] of PAGES) {
    const r = { id, url };
    try {
      const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(4000);
      r.status = res ? res.status() : 0;
      r.final = page.url();
      r.title = await page.title();
      const html = await page.content();
      const text = await page.evaluate(() => (document.body ? document.body.innerText : "").replace(/\s+/g, " ").trim());
      r.text = text.slice(0, 400);
      r.euros = (text.match(/\d+[,.]\d{2}\s?€/g) || []).length;
      r.markers = Object.keys(MARKERS).filter((k) => MARKERS[k].test(html.slice(0, 200000)));
      r.storePrompt = /choisi(r|ssez) (un|votre|mon) magasin|afficher le prix|sélectionne(z|r) (un|votre) (magasin|drive)/i.test(text);
    } catch (e) {
      r.error = String(e.message || e).split("\n")[0];
    }
    out.push(r);
    console.log(`${id.padEnd(14)} ${String(r.status || "ERR").padEnd(4)} ${String(r.euros ?? "-").padStart(3)} prix  ${(r.markers || []).join(",") || "-"}  ${r.storePrompt ? "demande un magasin" : ""}  ${r.title || r.error || ""}`);
  }
  await browser.close();
  fs.mkdirSync(path.join(__dirname, "work"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "work", "probe.json"), JSON.stringify(out, null, 1));
})();
