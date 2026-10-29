/* Calcul de la répartition du panier hors du fil principal, pour les gros paniers. */
importScripts("optimizer.js");
onmessage = (e) => {
  const { seq, M, K, lambda } = e.data;
  let R;
  try { R = solve(M, K, lambda); } catch (err) { R = { best: null, byK: {}, truncated: true, partial: false, error: String(err) }; }
  postMessage({ seq, R });
};
