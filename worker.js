/* Calcul de la répartition du panier hors du fil principal : chaque nombre de commandes est envoyé dès qu'il est prêt. */
importScripts("optimizer.js");
onmessage = (e) => {
  const { seq, M, Kmax, lambda } = e.data;
  try { runAll(M, Kmax, lambda, (msg) => postMessage(Object.assign({ seq }, msg)), 12000); }
  catch (err) { postMessage({ seq, done: true, error: String(err) }); }
};
