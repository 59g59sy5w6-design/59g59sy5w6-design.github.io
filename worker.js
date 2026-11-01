importScripts("optimizer.js");
/* modes : les façons de faire ses courses à calculer (mix, liv, drive, mag : optimizer.js, HOWS), dans l'ordre, celle
   choisie d'abord, chacune avec son modèle ({ mode, M }) ; chaque étape porte sa façon (mode).
   Les anciennes versions de l'appli envoyaient un seul modèle (M) et, pour chaque réglage, sa limite (compMax).
   kind « jobs » : calculs d'appoint (Et si, Compléter malin, budget), chacun { key, M, K } ; la réponse donne, sous
   la même clé, la meilleure répartition de tout le panier en K commandes au plus (bestAt). */
onmessage = (e) => {
  const { seq, lambda } = e.data;
  if (e.data.kind === "jobs") {
    for (const j of e.data.jobs) {
      try { postMessage({ seq, kind: "job", key: j.key, r: bestAt(j.M, j.K, lambda, 4000) }); }
      catch (err) { postMessage({ seq, kind: "job", key: j.key, r: null, error: String(err) }); }
    }
    postMessage({ seq, kind: "jobs", idle: true });
    return;
  }
  const modes = e.data.modes || [{ compMax: e.data.M.compMax }];
  for (const x of modes) {
    const M = x.M || Object.assign({}, e.data.M, { compMax: x.compMax });
    try { runAll(M, M.chans.length, lambda, (msg) => postMessage(Object.assign({ seq, mode: x.mode }, msg)), 12000); }
    catch (err) { postMessage({ seq, mode: x.mode, done: true, error: String(err) }); }
  }
  if (e.data.modes) postMessage({ seq, idle: true });
};
