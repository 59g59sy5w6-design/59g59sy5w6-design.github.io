"""Rapproche un même produit entre enseignes : même rayon, même famille de marque, même contenance
et mêmes mots distinctifs dans la désignation, plus les rapprochements validés à la main (tools/merge.json).

Entrée : tools/work/items.json. Sortie : tools/work/clusters.json.
Options : --review écrit les rapprochements possibles non faits dans tools/work/review.txt (triés par rayon),
--multi liste les rapprochements faits.
"""
import collections, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402
from lib import key, tokens, strong, family  # noqa: E402

items = json.load(open(os.path.join(lib.WORK, 'items.json'), encoding='utf-8'))

# manual decisions after review: pairs of listing ids that are the same product
MERGE = json.load(open(os.path.join(lib.TOOLS, 'merge.json'), encoding='utf-8')) if os.path.exists(os.path.join(lib.TOOLS, 'merge.json')) else []
# produits frais sans marque : « Pommes Golden 1 kg » de deux enseignes sont des produits équivalents (eq), rapprochés
# pour les fruits, légumes, pains et œufs ; jamais pour la viande et le poisson (origine, label et race diffèrent)
NO_UNBRANDED = {'viandes-poissons'}


def qsig(it):
    unite = lib.RAYON_UNITE.get(it['ray'])
    if unite in ('rouleau', 'oeuf', 'couche', 'capsule', 'piece') and it.get('rolls'):
        return ('roll', it['rolls'], 1)
    q = it['qty']
    if not q:
        if unite in ('rouleau', 'oeuf'):
            # rouleaux et œufs sans compte lu : comparés entre eux par le nom seul, comme avant
            return ('roll', 0, 1)
        if unite == 'lavage' and it.get('lav'):
            return ('lav', it['lav'], 1)
        return ('none', it['rid'], 0)
    tot = q['n'] * q['v']
    # tolerate rounding of declared sizes (0.771 L vs 750 ml): bucket by 2 %
    return (q['u'], round(tot / 10) * 10, q['n'])


def fam_key(it):
    fam = key(family(it['brand']))
    if fam == 'sans marque' and lib.RAYON_BY_ID[it['ray']]['univers'] in NO_UNBRANDED:
        return 'sans marque:' + it['rid']
    return fam


# Sous-marque bio (« Auchan Bio », « Monoprix Bio », « Carrefour Bio ») : family() la ramène à l'enseigne, et le mot bio
# n'est alors que dans la marque. Il compte comme un mot fort du nom, sans quoi « AUCHAN BIO Olives vertes dénoyautées »
# (3,08 €) était réuni à l'« Auchan Olives vertes dénoyautées » de Houra (1,48 €), et le produit non bio portait l'étiquette bio.
BIO_BRAND = re.compile(r'\bbio\b')


def strong_of(it):
    s = set(strong(it['tok'], it['ray']))
    if BIO_BRAND.search(key(it['brand'] or '')):
        s.add('bio')
    return sorted(s)


for it in items:
    it['tok'] = tokens(it['label'])
    it['strong'] = strong_of(it)
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


# un même code produit Auchan (pr-C..., dans le rid) lu dans plusieurs magasins ou zones de livraison : même produit,
# sans heuristique ; sinon deux produits Auchan de même nom et de même contenance se retrouvaient dédoublés par magasin.
# Seule une référence Auchan (C suivi de chiffres) compte : la tête d'un identifiant de vendeur de la place de marché
# (« 174 » pour « /pr-174cb6db-... ») réunissait une tête de rasoir et un moule à gâteaux, un filtre d'aquarium et un
# grillage à poules.
bycode = {}
for it in items:
    if it['ret'].split('-')[0] == 'auchan' and re.fullmatch(r'C\d+', it['rid'].split(':', 1)[-1]):
        code = it['rid'].split(':', 1)[1]
        if code in bycode:
            union(bycode[code], it['rid'])
        else:
            bycode[code] = it['rid']

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

clusters = collections.defaultdict(list)
for it in items:
    clusters[find(it['rid'])].append(it)

multi = [c for c in clusters.values() if len({x['ret'] for x in c}) > 1]
print('clusters', len(clusters), 'multi-retailer', len(multi),
      collections.Counter(len({x['ret'] for x in c}) for c in clusters.values()))

if '--review' in sys.argv:
    # near misses: same rayon, family and quantity, different retailers, not clustered together
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
                    out.append((lib.RAYON_ORDER[g[0]], g[0], a, b))
    out.sort(key=lambda t: (t[0], t[2]['brand'], t[2]['label']))
    path = os.path.join(lib.WORK, 'review.txt')
    with open(path, 'w', encoding='utf-8') as fh:
        last = None
        for _, ray, a, b in out:
            if ray != last:
                fh.write(f"\n## {ray} : {lib.RAYON_BY_ID[ray]['nom']}\n")
                last = ray
            fh.write(f"{a['brand'][:16]:16} | {a['ret'][:4]} {a['label'][:48]:48} {a['price']:>6} | {b['ret'][:4]} {b['label'][:48]:48} {b['price']:>6} | {a['rid']} {b['rid']}\n")
    print('near misses', len(out), 'écrits dans', os.path.relpath(path, lib.ROOT))

if '--multi' in sys.argv:
    for c in sorted(multi, key=lambda c: (lib.RAYON_ORDER[c[0]['ray']], c[0]['brand'])):
        print(c[0]['ray'], '|', ' || '.join(f"{x['ret'][:4]} {x['brand']} {x['label']} [{x['fmt_raw']}] {x['price']}" for x in c))

json.dump({'items': items, 'cluster_of': {it['rid']: find(it['rid']) for it in items}}, open(os.path.join(lib.WORK, 'clusters.json'), 'w', encoding='utf-8'), ensure_ascii=False)
