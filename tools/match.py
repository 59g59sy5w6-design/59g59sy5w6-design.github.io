"""Rapproche un même produit entre enseignes : même rayon, même famille de marque, même contenance
et mêmes mots distinctifs dans la désignation, plus les rapprochements validés à la main (tools/merge.json).

Entrée : tools/work/items.json. Sortie : tools/work/clusters.json.
Options : --review liste les rapprochements possibles non faits, --multi liste les rapprochements faits.
"""
import collections, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402
from lib import key, tokens, strong, family, mdd_of, RAYONS  # noqa: E402,F401

items = json.load(open(os.path.join(lib.WORK, 'items.json'), encoding='utf-8'))

# manual decisions after review: pairs of listing ids that are the same product / must stay apart
MERGE = json.load(open(os.path.join(lib.TOOLS, 'merge.json'), encoding='utf-8')) if os.path.exists(os.path.join(lib.TOOLS, 'merge.json')) else []
SPLIT = set()


def qsig(it):
    if it['ray'] == 'papier':
        return ('roll', it['rolls'] or 0, 1)
    q = it['qty']
    if not q:
        return ('none', it['rid'], 0)
    tot = q['n'] * q['v']
    # tolerate rounding of declared sizes (0.771 L vs 750 ml): bucket by 2 %
    return (q['u'], round(tot / 10) * 10, q['n'])


def fam_key(it):
    return key(family(it['brand']))


for it in items:
    it['tok'] = tokens(it['label'])
    it['strong'] = sorted(strong(it['tok']))
    it['fam'] = fam_key(it)
    it['q'] = qsig(it)

# ---------------------------------------------------------------- clustering
parent = {it['rid']: it['rid'] for it in items}


def find(x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x


def union(a, b):
    ra, rb = find(a), find(b)
    if ra != rb:
        parent[rb] = ra


groups = collections.defaultdict(list)
for it in items:
    groups[(it['ray'], it['fam'], it['q'])].append(it)

for g, lst in groups.items():
    if g[2][0] == 'none':
        continue
    by_strong = collections.defaultdict(list)
    for it in lst:
        by_strong[tuple(it['strong'])].append(it)
    for s, same in by_strong.items():
        rets = {x['ret'] for x in same}
        if len(rets) < 2:
            continue
        # union across retailers only (keep two listings of one retailer apart unless they are the cheapest of each)
        first = {}
        for x in sorted(same, key=lambda x: x['price']):
            first.setdefault(x['ret'], x)
        base = None
        for x in first.values():
            if base is None:
                base = x['rid']
            else:
                union(base, x['rid'])

for a, b in MERGE:
    if a in parent and b in parent:
        union(a, b)
    else:
        pass  # produit absent de ce relevé

clusters = collections.defaultdict(list)
for it in items:
    clusters[find(it['rid'])].append(it)

multi = [c for c in clusters.values() if len({x['ret'] for x in c}) > 1]
print('clusters', len(clusters), 'multi-retailer', len(multi),
      collections.Counter(len({x['ret'] for x in c}) for c in clusters.values()))

if '--review' in sys.argv:
    # near misses: same rayon, family and quantity, different retailers, not clustered together
    seen = set()
    out = []
    for g, lst in groups.items():
        if g[2][0] == 'none':
            continue
        for i in range(len(lst)):
            for j in range(i + 1, len(lst)):
                a, b = lst[i], lst[j]
                if a['ret'] == b['ret'] or find(a['rid']) == find(b['rid']):
                    continue
                sa, sb = set(a['strong']), set(b['strong'])
                inter = len(sa & sb)
                uni = len(sa | sb) or 1
                if inter / uni >= 0.34 or (not sa or not sb):
                    out.append((g[0], a, b))
    print('near misses', len(out))
    for ray, a, b in out:
        print(f"{ray:9} {a['brand'][:16]:16} | {a['ret'][:4]} {a['label'][:48]:48} {a['price']:>6} | {b['ret'][:4]} {b['label'][:48]:48} {b['price']:>6} | {a['rid']} {b['rid']}")

if '--multi' in sys.argv:
    for c in sorted(multi, key=lambda c: (c[0]['ray'], c[0]['brand'])):
        print(c[0]['ray'], '|', ' || '.join(f"{x['ret'][:4]} {x['brand']} {x['label']} [{x['fmt_raw']}] {x['price']}" for x in c))

json.dump({'items': items, 'cluster_of': {it['rid']: find(it['rid']) for it in items}}, open(os.path.join(lib.WORK, 'clusters.json'), 'w', encoding='utf-8'), ensure_ascii=False)
