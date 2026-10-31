#!/usr/bin/env bash
# Robot de relevé des prix, lancé à la demande par GitHub Actions (.github/workflows/prix.yml), un passage par cible
# de la matrice (ONLY : enseigne, magasin ou zone ; LOT : lot du robot, voir lots_robot dans tools/sources.json).
# Relit les pages des enseignes qui acceptent les robots (réglage « robot » de tools/sources.json), puis publie avec
# tools/publish.sh : catalogue reconstruit si des prix ont changé, sinon heure de vérification. Les pages des autres
# cibles gardent leurs produits du relevé précédent (tools/build.py).
set -euo pipefail
cd "$(dirname "$0")/.."

npm install --no-save --no-audit --no-fund playwright@1.48.2 >/dev/null
npx playwright install --with-deps chromium >/dev/null

ARGS=()
[ -n "${ONLY:-}" ] && ARGS+=("--only=${ONLY}")
[ -n "${LOT:-}" ] && ARGS+=("--lot=${LOT}")

if [ "${DIAG:-false}" = "true" ]; then
  # diagnostic : compte rendu et extraits de pages sur la branche diag, sans toucher à main
  [ -n "${ONLY:-}" ] || ARGS+=("--only=monoprix,carrefour,houra,auchan")
  node tools/scrape.js --diag "${ARGS[@]}" || true
  git config user.name "github-actions[bot]"
  git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
  git checkout -q -B diag
  git add -f tools/work/scrape.json tools/work/diag tools/work/fetches.json tools/work/journal
  git commit -q -m "Diagnostic du relevé $(date -u +%Y-%m-%dT%H:%MZ)" || true
  git push -q -f origin diag
  exit 0
fi

node tools/scrape.js "${ARGS[@]}"
bash tools/publish.sh robot

# compte rendu du passage (une ligne par page, adresse finale, pages Houra trouvées) sur la branche journal, un fichier
# par cible (tools/work/journal/<cible>.json) : chaque cible ajoute son commit, sans écraser ceux des autres
# (nouvel essai après git pull --rebase quand une autre cible vient de pousser). Les journaux d'Actions ne se lisent pas
# depuis une session Claude Code.
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
JOURNAL=$(mktemp -d)
if git fetch -q origin journal 2>/dev/null; then
  git worktree add -q "$JOURNAL" -B journal origin/journal
else
  git worktree add -q "$JOURNAL" -B journal
fi
mkdir -p "$JOURNAL/tools/work/journal"
cp tools/work/journal/*.json "$JOURNAL/tools/work/journal/"
git -C "$JOURNAL" add -f tools/work/journal
git -C "$JOURNAL" commit -q -m "Journal du relevé ${ONLY:-tout} ${LOT:-} $(date -u +%Y-%m-%dT%H:%MZ)" || true
for attempt in 1 2 3 4 5 6; do
  if git -C "$JOURNAL" push -q origin journal; then
    break
  fi
  echo "La branche journal a bougé : nouvel essai ($attempt)."
  sleep $((5 + RANDOM % 20))
  git -C "$JOURNAL" pull -q --rebase origin journal || git -C "$JOURNAL" rebase --abort || true
done
git worktree remove --force "$JOURNAL" || true
