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
const PLACES = (process.env.PLACES || "Fontenay-sous-Bois").split("|");
// livraison à domicile : « lieu@adresse publique » (une mairie), séparés par « ; »
const DELIV = (process.env.LIVRAISON || "").split(";").filter(Boolean).map((x) => x.split("@"));
const PLAN = DELIV.length ? DELIV.map(([place, addr], i) => ({ id: "livraison-" + (i + 1), url: "https://www.auchan.fr/", steps: [
  { click: /choisir vos courses|choisir (un|mon|votre) magasin/i },
  { type: place, into: /code postal/i },
  { click: new RegExp(place.split("-")[0], "i"), within: "li, [role=option], button, a" },
  { expand: /livraison à domicile/i },
  { choose: /livraison à domicile/i },
  { address: addr },
  { click: /^(valider|confirmer|continuer|enregistrer|c'est parti|voir les créneaux|commencer mes courses)/i },
  { goto: "https://www.auchan.fr/recherche?text=lait%20demi%20%C3%A9cr%C3%A9m%C3%A9" },
] })) : PLACES.map((place, i) => ({ id: "auchan-" + (i + 1), url: "https://www.auchan.fr/", steps: [
  { click: /choisir vos courses|choisir (un|mon|votre) magasin/i },
  { type: place, into: /code postal/i },
  { click: new RegExp(place.split("-")[0], "i"), within: "li, [role=option], button, a" },
  { cards: true },
] }));

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
        if (st.address) {
          // adresse publique de la zone (mairie) dans le champ d'adresse du choix de livraison
          let done = false;
          for (const i of await page.$$("input")) {
            const h = [await i.getAttribute("placeholder"), await i.getAttribute("aria-label"), await i.getAttribute("type")].join(" ");
            if (/rechercher un produit|code postal/i.test(h) || !(await i.isVisible().catch(() => false))) continue;
            await i.click().catch(() => {}); await i.type(st.address, { delay: 50 }).catch(() => {}); done = true; break;
          }
          await page.waitForTimeout(3500);
          await snap(done ? "adresse saisie" : "aucun champ d'adresse");
          if (done) {
            const word = st.address.split(/\s+/).find((w) => w.length > 4) || st.address;
            const t = await clickText(page, new RegExp(word, "i"), "li, [role=option], [class*=suggest] *, [class*=Suggest] *");
            await page.waitForTimeout(3500);
            await snap(t ? `suggestion « ${t.slice(0, 80)} »` : "aucune suggestion");
          }
        }
        if (st.cards) {
          // toutes les cartes de la liste (drives, retraits, consignes), avec leur bouton « Choisir »
          for (let k = 0; k < 6; k++) { await page.mouse.move(440, 600); await page.mouse.wheel(0, 1500); await page.waitForTimeout(700); }
          rec.cards = await page.evaluate(() => {
            const out = [];
            for (const b of document.querySelectorAll("button, a")) {
              if (!/^\s*choisir\s*$/i.test(b.innerText || "")) continue;
              let c = b;
              for (let k = 0; k < 6 && c.parentElement; k++) { c = c.parentElement; if ((c.innerText || "").length > 40) break; }
              out.push((c.innerText || "").replace(/\s+/g, " ").replace(/ Choisir.*$/, "").slice(0, 220));
            }
            return out;
          });
          await snap(`${rec.cards.length} cartes`);
        }
        if (st.expand) {
          // déplie « Infos et Tarifs » de la carte voulue et recopie le texte de la carte (frais, minimum, horaires)
          const card = await page.evaluate(({ want }) => {
            const W = new RegExp(want, "i");
            for (const b of document.querySelectorAll("button, a")) {
              if (!/infos et tarifs|voir les d[ée]tails/i.test(b.innerText || "")) continue;
              let c = b;
              for (let k = 0; k < 6 && c.parentElement; k++) { c = c.parentElement; if ((c.innerText || "").length > 60) break; }
              if (W.test(c.innerText || "")) { b.click(); return true; }
            }
            return false;
          }, { want: st.expand.source });
          await page.waitForTimeout(2500);
          await page.mouse.move(440, 500); await page.mouse.wheel(0, 300); await page.waitForTimeout(800);
          await snap("détails dépliés (copie d'écran)");
          const txt = await page.evaluate(({ want }) => {
            const W = new RegExp(want, "i");
            const cands = [...document.querySelectorAll("div, section, article, li")].filter((e) => W.test(e.innerText || "") && (e.innerText || "").length < 1500);
            cands.sort((a, b) => (b.innerText || "").length - (a.innerText || "").length);
            return cands.length ? cands[0].innerText.replace(/\s+/g, " ") : "";
          }, { want: st.expand.source });
          await snap((card ? "infos dépliées : " : "infos introuvables : ") + txt.slice(0, 900));
        }
        if (st.choose) {
          // le bouton « Choisir » de la première carte qui correspond (retrait en magasin, sans adresse à donner)
          const label = await page.evaluate(({ want, avoid }) => {
            const W = new RegExp(want, "i"), A = new RegExp(avoid, "i");
            for (const b of document.querySelectorAll("button, a")) {
              if (!/^\s*choisir\s*$/i.test(b.innerText || "")) continue;
              let card = b;
              for (let k = 0; k < 6 && card.parentElement; k++) { card = card.parentElement; if ((card.innerText || "").length > 40) break; }
              const t = (card.innerText || "").replace(/\s+/g, " ");
              if (W.test(t) && !A.test(t)) { b.click(); return t.slice(0, 120); }
            }
            return null;
          }, { want: st.choose.source, avoid: st.avoid ? st.avoid.source : "$^" });
          await page.waitForTimeout(4000);
          await snap(label ? `choix « ${label} »` : "aucune carte ne correspond");
        }
        if (st.wait) await page.waitForTimeout(st.wait);
        if (st.goto) {
          await page.goto(st.goto, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
          await page.waitForTimeout(5000);
          await page.mouse.wheel(0, 900);
          await page.waitForTimeout(1500);
          const euros = await page.evaluate(() => ((document.body ? document.body.innerText : "").match(/\d+[,.]\d{2}\s?€/g) || []).slice(0, 12));
          await snap(`page ${st.goto.split("/").slice(3).join("/").slice(0, 60)} : ${euros.length} prix ${euros.join(" ")}`);
        }
      }
    } catch (e) { rec.error = String(e.message || e).split("\n")[0]; }
    report.push(rec);
    console.log(site.id, rec.status, rec.error || "", rec.steps.map((s) => s.label).join(" > "));
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 1));
})();
