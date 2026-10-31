"""Compare le catalogue reconstruit (data/catalog.json) avec la version déjà publiée (git HEAD), v1 ou v2.
Affiche le nombre de prix modifiés, par univers, les plus fortes variations et les produits apparus ou disparus."""
import collections, json, os, subprocess, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

new = lib.read_catalog(json.load(open(os.path.join(lib.DATA, "catalog.json"), encoding="utf-8")))
try:
    old = lib.read_catalog(json.loads(subprocess.run(["git", "show", "HEAD:data/catalog.json"], cwd=lib.ROOT, capture_output=True, check=True).stdout))
except Exception:
    print("Pas de version publiée à comparer.")
    sys.exit(0)
po = {p["id"]: p for p in old}
pn = {p["id"]: p for p in new}
changes = []
for pid, p in pn.items():
    q = po.get(pid)
    if not q:
        continue
    for ret, o in p["offers"].items():
        a = q["offers"].get(ret)
        if a and abs(a["price"] - o["price"]) >= 0.005:
            u = lib.RAYON_BY_ID.get(p["r"], {}).get("univers", "?")
            changes.append((o["price"] - a["price"], ret, p["brand"] + " " + p["name"] + " " + p["format"], a["price"], o["price"], u))
up = sum(1 for c in changes if c[0] > 0)
print(f"{len(pn)} produits ({len(set(pn) - set(po))} nouveaux, {len(set(po) - set(pn))} disparus)")
print(f"{len(changes)} prix modifiés : {up} en hausse, {len(changes) - up} en baisse")
for d, ret, name, a, b, u in sorted(changes, key=lambda c: -abs(c[0]))[:12]:
    print(f"  {ret:9} {a:7.2f} -> {b:7.2f}  {name}")
by_univ = collections.Counter(c[5] for c in changes)
if len(by_univ) > 1:
    print("par univers : " + ", ".join(f"{lib.UNIVERS_NAME.get(u, u)} {n}" for u, n in sorted(by_univ.items(), key=lambda kv: -kv[1])))
