importScripts("optimizer.js");
/* modes : les réglages « Sans achat en magasin » à calculer, dans l'ordre, chacun avec son modèle ({ mode, M }).
   Les anciennes versions de l'appli envoyaient un seul modèle (M) et, pour chaque réglage, sa limite (compMax). */
onmessage = (e) => {
  const { seq, lambda } = e.data;
  const modes = e.data.modes || [{ compMax: e.data.M.compMax }];
  for (const x of modes) {
    const M = x.M || Object.assign({}, e.data.M, { compMax: x.compMax });
    try { runAll(M, M.chans.length, lambda, (msg) => postMessage(Object.assign({ seq, mode: x.mode }, msg)), 12000); }
    catch (err) { postMessage({ seq, mode: x.mode, done: true, error: String(err) }); }
  }
  if (e.data.modes) postMessage({ seq, idle: true });
};
