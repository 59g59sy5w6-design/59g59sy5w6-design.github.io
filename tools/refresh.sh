#!/usr/bin/env bash
# Reconstruit le catalogue après la lecture des pages (voir CLAUDE.md, « Mettre à jour les prix »).
set -euo pipefail
cd "$(dirname "$0")/.."
python3 tools/build.py
python3 tools/match.py
python3 tools/make_catalog.py
python3 tools/check.py
python3 tools/bump.py
node tools/smoke.js
