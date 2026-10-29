#!/usr/bin/env bash
# Robot de relevé des prix, lancé par GitHub Actions (.github/workflows/prix.yml) toutes les heures.
# Relit les pages rayon, reconstruit le catalogue et publie seulement si des prix ont changé.
set -euo pipefail
cd "$(dirname "$0")/.."

npm install --no-save --no-audit --no-fund playwright@1.48.2 >/dev/null
npx playwright install --with-deps chromium >/dev/null

if [ "${DIAG:-false}" = "true" ]; then node tools/scrape.js --diag; else node tools/scrape.js; fi
python3 tools/build.py
python3 tools/match.py
python3 tools/make_catalog.py

if [ "${DIAG:-false}" = "true" ]; then
  # diagnostic : déposer le compte rendu et des extraits de pages sur la branche diag, sans toucher à main
  git config user.name "github-actions[bot]"
  git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
  git checkout -q -B diag
  git add -f tools/work/scrape.json tools/work/diag
  git commit -q -m "Diagnostic du relevé $(date -u +%Y-%m-%dT%H:%MZ)" || true
  git push -q -f origin diag
  exit 0
fi

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
if git diff --quiet -- data/catalog.json data/meta.json; then
  # prix inchangés : seule l'heure de vérification est publiée
  git add data/status.json
  git commit -q -m "Prix vérifiés le $(TZ=Europe/Paris date +'%d/%m/%Y à %Hh%M'), sans changement" || { echo "Rien à publier."; exit 0; }
else
  node tools/smoke.js
  python3 tools/check.py | tee /tmp/check.txt
  git add data tools/state
  git commit -q -F - <<MSG
Prix du $(TZ=Europe/Paris date +'%d/%m/%Y à %Hh%M')

$(head -6 /tmp/check.txt)
MSG
fi
git pull -q --rebase origin main
git push -q origin HEAD:main
# GitHub Pages : demander la publication tout de suite
curl -fsS -X POST -H "Authorization: Bearer ${GITHUB_TOKEN}" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/${GITHUB_REPOSITORY}/pages/builds" >/dev/null || echo "Publication Pages : elle suivra le push."
