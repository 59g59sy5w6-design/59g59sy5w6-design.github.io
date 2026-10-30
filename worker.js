importScripts("optimizer.js");
/* modes : les réglages « Sans achat en magasin » à calculer, dans l'ordre ({ mode, compMax }) */
onmessage = (e) => {
  const { seq, M, Kmax, lambda } = e.data;
  const modes = e.data.modes || [{ compMax: M.compMax }];
  for (const { mode, compMax } of modes) {
    try { runAll(Object.assign({}, M, { compMax }), Kmax, lambda, (msg) => postMessage(Object.assign({ seq, mode }, msg)), 12000); }
    catch (err) { postMessage({ seq, mode, done: true, error: String(err) }); }
  }
  if (e.data.modes) postMessage({ seq, idle: true });
};
