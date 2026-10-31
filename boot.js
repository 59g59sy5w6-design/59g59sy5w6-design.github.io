/* Cabas, affichage posé avant le premier rendu : taille du texte, thème, contraste renforcé et mode confort, lus dans
   les réglages (cabas.prefs). Chargé en tête de index.html, sans script en ligne (règle de contenu) : rien ne saute ni
   ne clignote à l'ouverture. app.js rappelle window.cabasLook(prefs) à chaque changement de réglage. */
(function (w) {
  "use strict";
  var d = document.documentElement;
  var TEXT = ["0.82", "0.9", "1.12", "1.25"], OLD = { "0.8": "0.82", "0.88": "0.9" };
  var mq = function (q) { try { return !!(w.matchMedia && w.matchMedia(q).matches); } catch (e) { return false; } };
  var cur = {};
  function look(p) {
    cur = p || {};
    var z = String(cur.zoom || "1");
    z = OLD[z] || z;
    if (TEXT.indexOf(z) >= 0) d.setAttribute("data-text", z); else d.removeAttribute("data-text");
    /* thème : choisi (clair, sombre) ou celui du téléphone (auto) ; toujours posé, pour un seul jeu de règles */
    var dark = cur.theme === "dark" || (cur.theme !== "light" && mq("(prefers-color-scheme: dark)"));
    d.setAttribute("data-theme", dark ? "dark" : "light");
    /* contraste renforcé : le réglage, sinon « Augmenter le contraste » du téléphone */
    var more = cur.contrast === true || (cur.contrast !== false && mq("(prefers-contrast: more)"));
    if (more) d.setAttribute("data-contrast", "more"); else d.removeAttribute("data-contrast");
    if (cur.simple) d.setAttribute("data-simple", ""); else d.removeAttribute("data-simple");
    /* couleur de la barre du navigateur : celle du thème affiché */
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) {
      var m = metas[i], own = m.getAttribute("data-c") || m.getAttribute("content");
      m.setAttribute("data-c", own);
      m.setAttribute("content", cur.theme === "dark" || cur.theme === "light" ? (dark ? "#000000" : "#ffffff") : own);
    }
  }
  var p0 = {};
  try { p0 = JSON.parse(localStorage.getItem("cabas.prefs") || "{}") || {}; } catch (e) { p0 = {}; }
  look(p0);
  /* réglage du téléphone changé pendant que l'appli est ouverte (passage au mode sombre le soir) */
  try {
    ["(prefers-color-scheme: dark)", "(prefers-contrast: more)"].forEach(function (q) {
      var l = w.matchMedia(q), f = function () { look(cur); };
      if (l.addEventListener) l.addEventListener("change", f); else if (l.addListener) l.addListener(f);
    });
  } catch (e) { /* sans matchMedia : le thème reste celui de l'ouverture */ }
  w.cabasLook = look;
})(window);
