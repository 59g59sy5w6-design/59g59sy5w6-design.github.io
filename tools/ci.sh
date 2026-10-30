#!/usr/bin/env bash
# Robot de relevé des prix, lancé à la demande par GitHub Actions (.github/workflows/prix.yml).
# Relit les pages des enseignes qui acceptent les robots (réglage « robot » de tools/sources.json),
# puis publie avec tools/publish.sh : catalogue reconstruit si des prix ont changé, sinon heure de vérification.
set -euo pipefail
cd "$(dirname "$0")/.."

npm install --no-save --no-audit --no-fund playwright@1.48.2 >/dev/null
npx playwright install --with-deps chromium >/dev/null

if [ "${DIAG:-false}" = "true" ]; then
  # diagnostic : compte rendu et extraits de pages sur la branche diag, sans toucher à main
  node tools/scrape.js --diag --only="${ONLY:-monoprix,carrefour,houra,auchan}" || true
  git config user.name "github-actions[bot]"
  git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
  git checkout -q -B diag
  git add -f tools/work/scrape.json tools/work/diag tools/work/fetches.json
  git commit -q -m "Diagnostic du relevé $(date -u +%Y-%m-%dT%H:%MZ)" || true
  git push -q -f origin diag
  exit 0
fi

node tools/scrape.js
bash tools/publish.sh robot

# compte rendu du passage (une ligne par page, pages Houra trouvées par le robot) sur la branche journal,
# remplacée à chaque passage : les journaux d'Actions ne se lisent pas depuis une session Claude Code
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git checkout -q -B journal
for f in tools/work/scrape.json tools/work/discovered.json; do [ -f "$f" ] && git add -f "$f"; done
git commit -q -m "Journal du relevé $(date -u +%Y-%m-%dT%H:%MZ)" || true
git push -q -f origin journal || true
