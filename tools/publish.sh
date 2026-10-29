#!/usr/bin/env bash
# Publie un relevé : repart du dernier état publié sur main (relevés de l'autre source compris), reconstruit
# le catalogue avec les lectures de tools/work/fetches.json, vérifie l'appli, puis pousse sur main.
# Utilisé par le robot GitHub (tools/ci.sh) et par le relevé de Claude (voir CLAUDE.md).
# Usage : bash tools/publish.sh <source>   (source : robot ou claude, pour le message de commit)
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="${1:-relevé}"
[ -s tools/work/fetches.json ] || { echo "tools/work/fetches.json est vide : rien à publier."; exit 1; }
git fetch -q origin main
if [ -n "$(git status --porcelain --untracked-files=no -- . ':!data' ':!tools/state')" ] || [ -n "$(git log origin/main..HEAD --oneline)" ]; then
  echo "Des modifications locales ne sont pas sur main : publication annulée pour ne rien écraser."
  exit 1
fi
if [ -z "$(git config user.name || true)" ]; then
  git config user.name "github-actions[bot]"
  git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
fi
for attempt in 1 2 3; do
  git fetch -q origin main
  git reset -q --hard origin/main
  python3 tools/build.py > tools/work/build.log
  grep -v "^    (" tools/work/build.log || true
  python3 tools/match.py > tools/work/match.log
  tail -1 tools/work/match.log
  python3 tools/make_catalog.py
  READ=$(python3 -c "import json; r=json.load(open('tools/work/report.json')); n={x['id']: x['name'] for x in json.load(open('data/retailers.json'))}; print(', '.join(sorted({n.get(p['retailer'], p['retailer']) for p in r['pages'] if p['products']})) or 'aucune page lue')")
  WHEN=$(TZ=Europe/Paris date +'%d/%m/%Y à %Hh%M')
  if git diff --quiet -- data/catalog.json data/meta.json; then
    git add data/status.json tools/state/ids.json
    git commit -q -m "Prix vérifiés le $WHEN ($READ, $SRC), sans changement" || { echo "Rien à publier."; exit 0; }
  else
    node tools/smoke.js
    python3 tools/check.py | tee tools/work/check.txt
    git add data tools/state
    git commit -q -F - <<MSG
Prix du $WHEN ($READ, $SRC)

$(head -8 tools/work/check.txt)
MSG
  fi
  if git push -q origin HEAD:main; then
    echo "Publié : $READ."
    if [ -n "${GITHUB_TOKEN:-}" ] && [ -n "${GITHUB_REPOSITORY:-}" ]; then
      # les push faits avec le jeton d'Actions ne relancent pas GitHub Pages d'eux-mêmes
      curl -fsS -X POST -H "Authorization: Bearer ${GITHUB_TOKEN}" -H "Accept: application/vnd.github+json" \
        "https://api.github.com/repos/${GITHUB_REPOSITORY}/pages/builds" >/dev/null || echo "Publication Pages non demandée."
    fi
    exit 0
  fi
  echo "main a bougé pendant la publication : nouvelle tentative ($attempt)."
  sleep 15
done
echo "Publication impossible après 3 tentatives."
exit 1
