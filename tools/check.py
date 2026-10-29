"""Compare le catalogue reconstruit (data/catalog.json) avec la version déjà publiée (git HEAD).
Affiche le nombre de prix modifiés, les plus fortes variations et les produits apparus ou disparus."""
import json, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
new = json.load(open(os.path.join(ROOT, "data", "catalog.json"), encoding="utf-8"))
try:
    old = json.loads(subprocess.run(["git", "show", "HEAD:data/catalog.json"], cwd=ROOT, capture_output=True, check=True).stdout)
except Exception:
    print("Pas de version publiée à comparer.")
    sys.exit(0)
po = {p["id"]: p for p in old["products"]}
pn = {p["id"]: p for p in new["products"]}
changes = []
for pid, p in pn.items():
    q = po.get(pid)
    if not q:
        continue
    for ret, o in p["offers"].items():
        a = q["offers"].get(ret)
        if a and abs(a["price"] - o["price"]) >= 0.005:
            changes.append((o["price"] - a["price"], ret, p["brand"] + " " + p["name"] + " " + p["format"], a["price"], o["price"]))
up = sum(1 for c in changes if c[0] > 0)
print(f"{len(pn)} produits ({len(set(pn) - set(po))} nouveaux, {len(set(po) - set(pn))} disparus)")
print(f"{len(changes)} prix modifiés : {up} en hausse, {len(changes) - up} en baisse")
for d, ret, name, a, b in sorted(changes, key=lambda c: -abs(c[0]))[:12]:
    print(f"  {ret:9} {a:7.2f} -> {b:7.2f}  {name}")
