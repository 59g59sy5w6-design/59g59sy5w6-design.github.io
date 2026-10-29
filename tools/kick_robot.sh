#!/usr/bin/env bash
# Relance le robot GitHub (relevé Houra, .github/workflows/prix.yml) si son dernier relevé date de plus de
# 70 minutes : les déclenchements programmés de GitHub Actions arrivent parfois en retard, voire pas du tout.
# Lancé au début de chaque relevé de Claude (voir CLAUDE.md). Ne fait rien si le robot tourne normalement.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="${GITHUB_REPOSITORY:-59g59sy5w6-design/59g59sy5w6-design.github.io}"
AGE=$(python3 -c "
import json, datetime
t = (json.load(open('data/status.json')).get('retailers', {}).get('houra') or {}).get('checkedAt')
now = datetime.datetime.now(datetime.timezone.utc)
print(int((now - datetime.datetime.fromisoformat(t.replace('Z', '+00:00'))).total_seconds() // 60) if t else 99999)
")
if [ "$AGE" -lt 70 ]; then
  echo "Houra vérifié il y a $AGE min : le robot tourne, rien à faire."
  exit 0
fi
if gh api -X POST "repos/$REPO/actions/workflows/prix.yml/dispatches" -f ref=main >/dev/null; then
  echo "Houra vérifié il y a $AGE min : robot relancé."
else
  echo "Houra vérifié il y a $AGE min : le robot n'a pas pu être relancé (on continue)."
fi
