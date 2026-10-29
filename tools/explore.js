// Exploration d'un parcours de choix de magasin, comme le ferait une personne : clics sur les boutons visibles,
// copies d'écran et liste des éléments cliquables à chaque étape (tools/work/explore/). Aucun contournement :
// si une vérification ou un blocage s'affiche, on le note et on s'arrête.
// Usage : node tools/explore.js
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const OUT = path.join(__dirname, "work", "explore");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const REFUSE = /^(tout refuser|refuser|continuer sans accepter|refuser tout|je refuse)$/i;
const PLACE = process.env.PLACE || "Fontenay-sous-Bois";
const PLAN = [
  { id: "auchan", url: "https://www.auchan.fr/", steps: [
    { click: /choisir vos courses|choisir (un|mon|votre) magasin/i },
    { type: PLACE, into: /code postal/i },
    { click: new RegExp(PLACE.split("-")[0], "i"), within: "li, [role=option], button, a" },
  ] },
  { id: "leclerc", url: "https://www.e.leclerc/fp/lait-de-montagne-demi-ecreme-brique-1-l-delisse-3564700596241", steps: [
    { click: /choisir (mon|un|votre) magasin/i },
    { type: PLACE, into: /code postal/i },
    { click: new RegExp(PLACE.split("-")[0], "i"), within: "li, [role=option], button, a" },
  ] },
];

async function clickables(page) {
  return page.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
    return [...document.querySelectorAll("button, a, input, [role=button], select")].filter(vis).slice(0, 120).map((e) => ({
      tag: e.tagName.toLowerCase(), text: (e.innerText || e.value || "").replace(/\s+/g, " ").trim().slice(0, 70),
      aria: e.getAttribute("aria-label") || "", ph: e.getAttribute("placeholder") || "", id: e.id || "", href: (e.getAttribute("href") || "").slice(0, 90),
    })).filter((x) => x.text || x.aria || x.ph);
  });
}

async function clickText(page, re, within) {
  const els = await page.$$(within || "button, a, [role=button]");
  for (const el of els) {
    const t = ((await el.innerText().catch(() => "")) || (await el.getAttribute("aria-label").catch(() => "")) || "").replace(/\s+/g, " ").trim();
    if (re.test(t) && (await el.isVisible().catch(() => false))) { await el.click({ timeout: 5000 }).catch(() => {}); return t; }
  }
  return null;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const report = [];
  for (const site of PLAN) {
    const ctx = await browser.newContext({ userAgent: UA, locale: "fr-FR", timezoneId: "Europe/Paris", viewport: { width: 1366, height: 900 } });
    const page = await ctx.newPage();
    const rec = { id: site.id, steps: [] };
    try {
      const res = await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(4000);
      rec.status = res ? res.status() : 0;
      const refused = await clickText(page, REFUSE);
      await page.waitForTimeout(1500);
      let n = 0;
      const snap = async (label) => {
        n++;
        await page.screenshot({ path: path.join(OUT, `${site.id}-${n}.png`) });
        rec.steps.push({ n, label, url: page.url(), title: await page.title(), clickables: await clickables(page) });
      };
      await snap("arrivée" + (refused ? ` (cookies : ${refused})` : ""));
      for (const st of site.steps) {
        if (st.click) { const t = await clickText(page, st.click, st.within); await page.waitForTimeout(3500); await snap(t ? `clic « ${t} »` : `rien à cliquer pour ${st.click}`); }
        if (st.type) {
          const inputs = await page.$$("input");
          let done = false;
          for (const i of inputs) {
            const h = [await i.getAttribute("placeholder"), await i.getAttribute("aria-label")].join(" ");
            if (st.into.test(h) && (await i.isVisible().catch(() => false))) { await i.click().catch(() => {}); await i.type(st.type, { delay: 60 }).catch(() => {}); done = true; break; }
          }
          await page.waitForTimeout(3500);
          await snap(done ? `saisie ${st.type}` : "aucun champ de saisie trouvé");
        }
        if (st.wait) await page.waitForTimeout(st.wait);
      }
    } catch (e) { rec.error = String(e.message || e).split("\n")[0]; }
    report.push(rec);
    console.log(site.id, rec.status, rec.error || "", rec.steps.map((s) => s.label).join(" > "));
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 1));
})();
