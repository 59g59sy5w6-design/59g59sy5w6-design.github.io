"""Construit le catalogue de l'appli à partir des produits rapprochés.

Entrée : tools/work/clusters.json (tools/match.py) et tools/work/report.json (tools/build.py).
Sorties : data/catalog.json, data/meta.json, et tools/state/items.json pour le prochain relevé.
"""
import collections, datetime, json, os, re, sys, unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402
from lib import key, mdd_of, RAYONS  # noqa: E402

d = json.load(open(os.path.join(lib.WORK, 'clusters.json'), encoding='utf-8'))
items = {i['rid']: i for i in d['items']}
clusters = collections.defaultdict(list)
for rid, c in d['cluster_of'].items():
    clusters[c].append(items[rid])

PRIO = {'houra': 0, 'monoprix': 1, 'carrefour': 2, 'auchan': 3}
PROPER = set('''vosges alpes ile france bresil perou mexique ethiopie costa rica guatemala honduras rwanda laos bretagne alsace
marseille commercy italie espelette riga mediterranee japon provence savoie normandie madagascar valencia colombie
equateur popayan bahia naples gragnano montagne'''.split())
KEEP_UP = re.compile(r"^(AOP|IGP|DOP|UHT|XXL|MSC|FSC|MG|N°\d+|n°\d+|\d.*|[A-Z]{2,})$")


def nice_label(label):
    words = label.split()
    if not words:
        return label
    caps = sum(1 for w in words if w[:1].isupper())
    if caps / len(words) < 0.6 or len(words) < 3:
        return label[:1].upper() + label[1:]
    out = []
    for i, w in enumerate(words):
        k = key(w)
        if i == 0:
            out.append(w[:1].upper() + w[1:].lower() if not KEEP_UP.match(w) else w)
        elif KEEP_UP.match(w) and not w.istitle():
            out.append(w)
        elif k in PROPER or (out and key(out[-1]) in ('de', 'du', "d") and k in PROPER):
            out.append(w[:1].upper() + w[1:].lower())
        else:
            out.append(w.lower())
    s = ' '.join(out)
    s = re.sub(r"\b(d|l)'(\w)", lambda m: m.group(1) + "'" + m.group(2).lower(), s)
    s = s.replace('aop', 'AOP').replace(' igp', ' IGP').replace(' uht', ' UHT').replace(' mg', ' MG')
    return s


def fnum(x):
    if abs(x - round(x)) < 1e-9:
        return str(int(round(x)))
    return ('%.2f' % x).rstrip('0').rstrip('.').replace('.', ',')


def fsize(v, u):
    if u == 'g':
        return (fnum(v / 1000) + ' kg') if v >= 1000 else (fnum(v) + ' g')
    if u == 'ml':
        if v >= 1000:
            return fnum(v / 1000) + ' L'
        if v % 10 == 0:
            return fnum(v / 10) + ' cl'
        return fnum(v) + ' ml'
    return fnum(v)


def qty_display(it):
    if it['ray'] == 'papier':
        r = it['rolls']
        return (f"{r} rouleau" + ('x' if r > 1 else '')) if r else (it['fmt_raw'] or ''), ({'v': r, 'u': 'pc', 'lab': 'rouleau'} if r else None)
    q = it['qty']
    if not q:
        return it['fmt_raw'] or '', None
    tot = q['n'] * q['v']
    m = re.match(r'\s*lot de\s*(\d+)\s*(?:-|x)\s*(\d+)\s*x', (it['fmt_raw'] or '').lower())
    if m and q['n'] == int(m.group(1)) * int(m.group(2)):
        s = f"{m.group(1)} x ({m.group(2)} x {fsize(q['v'], q['u'])})"
    elif q['n'] > 1:
        s = f"{q['n']} x {fsize(q['v'], q['u'])}"
    else:
        s = fsize(q['v'], q['u'])
    if it['ray'] == 'lessive' and it.get('lav'):
        return s + f" · {it['lav']} lavages", {'v': it['lav'], 'u': 'pc', 'lab': 'lavage'}
    return s, {'v': round(tot, 1), 'u': q['u']}


def long_desc(it, disp):
    q = it['qty']
    ray = it['ray']
    cont = {'eaux': 'bouteilles', 'sodas': 'bouteilles', 'jus': 'bouteilles', 'lait': 'bouteilles ou briques',
            'yaourts': 'pots', 'fromages': 'sachets', 'conserves': 'boîtes', 'cafe': 'paquets', 'pates': 'paquets',
            'gateaux': 'sachets', 'vaisselle': 'flacons', 'lessive': 'flacons'}.get(ray, 'unités')
    if ray == 'papier':
        return f"Paquet de {it['rolls']} rouleaux." if it.get('rolls') else ''
    if not q:
        return ''
    tot = q['n'] * q['v']
    if q['n'] > 1:
        if ray in ('sodas',) and q['v'] <= 500:
            cont = 'canettes ou bouteilles'
        return f"Lot de {q['n']} {cont} de {fsize(q['v'], q['u'])}, soit {fsize(tot, q['u'])} au total."
    s = f"Contenance : {fsize(tot, q['u'])}."
    if ray == 'lessive' and it.get('lav'):
        s = f"Contenance : {fsize(tot, q['u'])}, environ {it['lav']} lavages."
    return s


TAGS = [
    ('Bio', r'\bbio\b'), ('Sans gluten', r'sans gluten'), ('Sans lactose', r'sans lactose'),
    ('Sans sucres', r'sans sucres?|z[ée]ro sucres?|\bz[ée]ro\b|cola zero'), ('Sans caféine', r'sans caf[ée]ine|z[ée]ro caf[ée]ine'),
    ('0 % MG', r'\b0 ?% ?(?:de )?mg\b|\b0 ?%'), ('Pur jus', r'pur jus|100 ?% pur'), ('AOP', r'\baop\b|\bdop\b'), ('IGP', r'\bigp\b'),
    ('Label Rouge', r'label rouge'), ('Commerce équitable', r'[ée]quitable'), ('Recharge', r'\brecharge'),
    ('Pur beurre', r'pur beurre'), ('Cuisson rapide', r'cuisson rapide|3 ?min'), ('100 % arabica', r'100 ?% ?arabica|pur arabica'),
    ('Peaux sensibles', r'peaux? sensibles?|hypoallerg'), ('Écolabel', r'[ée]colabel|ecocert'),
]


def tags_of(names):
    t = ' '.join(names).lower()
    out = []
    for lab, rx in TAGS:
        if re.search(rx, t):
            out.append(lab)
    return out


def icon_of(it):
    ray, q = it['ray'], it['qty']
    n = q['n'] if q else 1
    tot = (q['n'] * q['v']) if q else 0
    if ray in ('eaux', 'sodas'):
        if n > 1:
            return 'pack'
        return 'jug' if tot >= 5000 else 'bottle'
    if ray == 'jus':
        return 'pack' if n > 1 else 'bottle'
    if ray == 'lait':
        return 'pack' if n > 1 else 'carton'
    if ray == 'yaourts':
        return 'jar' if n == 1 and tot >= 300 else 'cup'
    if ray in ('fromages',):
        return 'bag'
    if ray == 'pates':
        return 'box' if 'barilla' in key(it['brand']) else 'bag'
    if ray == 'conserves':
        return 'tin'
    if ray == 'cafe':
        return 'box' if re.search(r'capsule|dose|filtre', key(it['label'])) else 'bag'
    if ray == 'gateaux':
        return 'cake'
    if ray == 'papier':
        return 'roll'
    if ray == 'vaisselle':
        return 'flacon'
    if ray == 'lessive':
        return 'jug'
    return 'box'


def slug(s):
    s = key(s)
    return re.sub(r'\s+', '-', s)[:72].strip('-')


# ---------------------------------------------------------------- produits
products, built = [], []
for c, lst in clusters.items():
    lst = sorted(lst, key=lambda x: (PRIO.get(x['ret'], 9), x['price']))
    main = lst[0]
    # one offer per retailer: the cheapest listing of that retailer in the cluster
    offers = {}
    for x in sorted(lst, key=lambda x: x['price']):
        if x['ret'] in offers:
            continue
        o = {'price': x['price'], 'at': x['ts'][:10], 'name': x['full']}
        if x.get('was'):
            o['was'] = x['was']
        if x.get('promo'):
            o['promo'] = re.sub(r'\s*-\s*Cliquez ici pour composer votre lot', '', x['promo'])
        if x.get('url'):
            o['url'] = x['url']
        else:
            o['url'] = x['src']
            o['cat'] = True
        offers[x['ret']] = o
    disp, qty = qty_display(main)
    label = nice_label(main['label']) if main['ret'] == 'monoprix' else (main['label'][:1].upper() + main['label'][1:])
    label = re.sub(r'\s+en conserve$', '', label)
    label = re.sub(r'\s*x\s*\d+\s*lavages?\b', '', label, flags=re.I).strip()
    label = re.sub(r'\s*-\s*Le pack$|\s+Le pack$', '', label)
    if not label.strip():
        label = main['brand']
    brand = main['brand']
    md = None
    for x in lst:
        md = md or mdd_of(x['brand'], x['ret'])
    ean = next((x['ean'] for x in lst if x.get('ean')), None)
    base = slug(f"{brand} {label} {disp}") or slug(main['rid'])
    rank = min({'monoprix': 0, 'carrefour': 4, 'auchan': 6, 'houra': 8}.get(x['ret'], 9) + x['pos'] for x in lst)
    p = {'id': None, 'brand': brand, 'name': label, 'format': disp, 'icon': icon_of(main),
         'type': 'mdd' if md else 'nb', 'offers': offers, 'rank': rank, 'ray': main['ray']}
    if md:
        p['mdd'] = md
    if qty:
        p['qty'] = qty
    if ean:
        p['ean'] = ean
    t = tags_of([x['full'] or '' for x in lst])
    if t:
        p['tags'] = t
    dsc = long_desc(main, disp)
    if dsc:
        p['desc'] = dsc
    products.append(p)
    built.append((lst, p, base))


# ---------------------------------------------------------------- identifiants stables
# Un produit garde son identifiant d'un relevé à l'autre : les paniers et les listes enregistrés sur les téléphones en dépendent.
# tools/state/ids.json associe chaque fiche d'enseigne (rid) à l'identifiant du produit qui la contient. À défaut (premier
# passage), l'identifiant est retrouvé dans le catalogue précédent par le lien de la fiche, ou par le nom affiché et la contenance.
# Quand deux produits fusionnent, l'identifiant abandonné renvoie vers celui qui reste (« aliases » dans data/catalog.json).
ids_path = os.path.join(lib.STATE, 'ids.json')
prev_ids = json.load(open(ids_path, encoding='utf-8')) if os.path.exists(ids_path) else {}
cat_path = os.path.join(lib.ROOT, 'data', 'catalog.json')
last_cat = json.load(open(cat_path, encoding='utf-8')) if os.path.exists(cat_path) else {'products': []}
prev_cat = json.load(open(os.environ['CABAS_PREV_CATALOG'], encoding='utf-8')) if os.environ.get('CABAS_PREV_CATALOG') else last_cat
prev_aliases = {**(last_cat.get('aliases') or {}), **(prev_cat.get('aliases') or {})}


def offer_index(cat):
    """Index des offres d'un catalogue : par lien de fiche, par nom affiché et contenance, par nom seul (noms ambigus écartés)."""
    by_url, by_nf, by_name = {}, collections.defaultdict(set), collections.defaultdict(set)
    for pp in cat['products']:
        for r, o in pp['offers'].items():
            if o.get('url') and not o.get('cat'):
                by_url[(r, o['url'])] = pp['id']
            if o.get('name'):
                by_nf[(r, o['name'], pp.get('format'))].add(pp['id'])
                by_name[(r, o['name'])].add(pp['id'])
    uniq = lambda m: {k: next(iter(v)) for k, v in m.items() if len(v) == 1}
    return by_url, uniq(by_nf), uniq(by_name)


def lookup(index, pp):
    """Identifiant, dans un index, du produit qui porte les mêmes offres que pp (le plus fréquent)."""
    by_url, by_nf, by_name = index
    cnt = collections.Counter()
    for r, o in pp['offers'].items():
        hit = (by_url.get((r, o.get('url'))) if not o.get('cat') else None) or by_nf.get((r, o.get('name'), pp.get('format'))) or by_name.get((r, o.get('name')))
        if hit:
            cnt[hit] += 1
    return cnt


prev_index = offer_index(prev_cat) if not prev_ids else None
wish = collections.defaultdict(list)
for n, (lst, pp, base) in enumerate(built):
    cnt = collections.Counter(prev_ids[x['rid']] for x in lst if x['rid'] in prev_ids)
    first = prev_ids.get(lst[0]['rid'])
    if not cnt and prev_index:
        cnt = lookup(prev_index, pp)
        first = None
    if cnt:
        top = first or cnt.most_common(1)[0][0]
        wish[top].append((cnt[top], first == top, n))
for pid0, cands in wish.items():
    cands.sort(key=lambda t: (-t[0], not t[1]))
    built[cands[0][2]][1]['id'] = pid0
used = {pp['id'] for pp in products if pp['id']}
fresh_ids = 0
for lst, pp, base in built:
    if not pp['id']:
        pid, k = base, 2
        while pid in used:
            pid = f"{base}-{k}"; k += 1
        pp['id'] = pid
        used.add(pid)
        fresh_ids += 1
aliases = {}
for lst, pp, base in built:
    for x in lst:
        old = prev_ids.get(x['rid'])
        if old and old != pp['id']:
            aliases[old] = pp['id']
        prev_ids[x['rid']] = pp['id']


# ---------------------------------------------------------------- catalogue de l'appli
ray_order = {rid: i for i, (rid, _, _) in enumerate(RAYONS)}
products.sort(key=lambda p: (ray_order[p['ray']], -len(p['offers']), p['rank']))
for p in products:
    p['r'] = p.pop('ray')
    p.pop('rank', None)
rayons = [{'id': rid, 'name': name, 'aisle': aisle, 'order': i} for i, (rid, name, aisle) in enumerate(RAYONS)]
os.makedirs(os.path.join(lib.ROOT, 'data'), exist_ok=True)
live = {pp['id'] for pp in products}
# un produit du catalogue publié qui n'existe plus sous son identifiant renvoie vers celui qui reprend ses offres
idx = offer_index({'products': products})
for pp in last_cat['products'] + prev_cat['products']:
    if pp['id'] in live or pp['id'] in aliases:
        continue
    hit = lookup(idx, pp).most_common(1)
    if hit:
        aliases[pp['id']] = hit[0][0]
for old, new in prev_aliases.items():
    aliases.setdefault(old, new)
for old in list(aliases):
    seen, t = {old}, aliases[old]
    while t in aliases and t not in seen and t not in live:
        seen.add(t); t = aliases[t]
    aliases[old] = t
aliases = {k: v for k, v in sorted(aliases.items()) if k not in live and v in live}
json.dump({'rayons': rayons, 'products': products, 'aliases': aliases}, open(os.path.join(lib.ROOT, 'data', 'catalog.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
os.makedirs(lib.STATE, exist_ok=True)
json.dump(dict(sorted(prev_ids.items())), open(ids_path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('identifiants repris', len(products) - fresh_ids, 'nouveaux', fresh_ids, 'renvois', len(aliases))

# ---------------------------------------------------------------- informations sur le relevé
MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
def fr(day):
    y, mth, dd = (int(x) for x in day.split('-'))
    return f"{dd} {MOIS[mth - 1]} {y}"

items_all = d['items']
fresh = [it for it in items_all if not it.get('carried')]
updated = max((it['ts'][:10] for it in fresh), default=max(it['ts'][:10] for it in items_all))
rets = {r['id']: r for r in json.load(open(os.path.join(lib.ROOT, 'data', 'retailers.json'), encoding='utf-8'))}
names = {rid: name for rid, name, _ in RAYONS}
coverage = dict(collections.Counter(r for p in products for r in p['offers']))
missing, old = collections.defaultdict(list), collections.defaultdict(set)
for ret in rets:
    for rid, name, _ in RAYONS:
        got = [it for it in items_all if it['ret'] == ret and it['ray'] == rid]
        if not got:
            missing[ret].append(name)
        elif all(it.get('carried') for it in got):
            old[ret].add((name, min(it['ts'][:10] for it in got)))
services = [rets[r]['service'] for r in sorted(rets, key=lambda r: rets[r].get('order', 9))]
notes = [
    f"Prix relevés le {fr(updated)} sur les pages rayon publiques de {', '.join(services[:-1])} et {services[-1]}, tels qu'affichés à l'unité. Les offres du type « 2e à -50 % » ou cagnotte sont signalées sur la fiche, mais les totaux utilisent le prix affiché à l'unité.",
    "Un même produit est rapproché entre enseignes par marque, désignation et contenance. Les marques distributeur ne sont vendues que par leur enseigne, sauf Auchan et Pouce, vendues aussi par Houra.",
]
def low(x):
    return x[:1].lower() + x[1:]


def enum(lst):
    lst = [low(x) for x in lst]
    return lst[0] if len(lst) == 1 else ', '.join(lst[:-1]) + ' et ' + lst[-1]


for ret in sorted(rets, key=lambda r: rets[r].get('order', 9)):
    name = rets[ret]['name']
    ch = rets[ret].get('channel') or {}
    if ch.get('mode') == 'retrait' and ch.get('where'):
        notes.append(f"{name} : prix du point de retrait {ch['where']}, choisi sur {rets[ret]['service']}.")
    if missing.get(ret):
        lst = missing[ret]
        notes.append(f"{name} : {'le rayon ' + enum(lst) + " n'a" if len(lst) == 1 else 'les rayons ' + enum(lst) + " n'ont"} pas pu être lu{'s' if len(lst) > 1 else ''} pendant le relevé.")
    by_day = collections.defaultdict(list)
    for rayon_name, day in sorted(old.get(ret, ())):
        by_day[day].append(rayon_name)
    present = len(RAYONS) - len(missing.get(ret, []))
    for day, lst in sorted(by_day.items()):
        if len(lst) == present:
            notes.append(f"{name} : prix relevés le {fr(day)}.")
        else:
            notes.append(f"{name} : prix du {fr(day)} pour {'le rayon ' if len(lst) == 1 else 'les rayons '}{enum(lst)}.")
notes.append("Les prix changent souvent (promotions de la semaine). Vérifie le total au moment de commander sur le site de l'enseigne.")
notes.append("Les visuels des produits sont des illustrations de l'appli, pas des photos des emballages.")
meta = {'updatedAt': updated, 'products': len(products), 'offers': sum(len(p['offers']) for p in products),
        'multi': sum(1 for p in products if len(p['offers']) > 1), 'coverage': coverage, 'notes': notes}
json.dump(meta, open(os.path.join(lib.ROOT, 'data', 'meta.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

# ---------------------------------------------------------------- état du relevé (heure de la dernière vérification par enseigne)
status_path = os.path.join(lib.ROOT, 'data', 'status.json')
old_status = json.load(open(status_path, encoding='utf-8')) if os.path.exists(status_path) else {}
report = json.load(open(os.path.join(lib.WORK, 'report.json'), encoding='utf-8')) if os.path.exists(os.path.join(lib.WORK, 'report.json')) else {'pages': []}
now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%MZ')
status = {'checkedAt': now, 'retailers': {}}
for ret in rets:
    pages = [p for p in report['pages'] if p['retailer'] == ret]
    ok = [p for p in pages if p['products']]
    fresh_ts = [it['ts'] for it in fresh if it['ret'] == ret]
    prev = (old_status.get('retailers') or {}).get(ret, {})
    if not ok and prev.get('checkedAt'):
        # enseigne pas relue cette fois (l'autre source publie) : on garde le compte rendu de sa dernière lecture
        status['retailers'][ret] = prev
        continue
    status['retailers'][ret] = {
        'pages': len(pages), 'read': len(ok),
        'checkedAt': (max(fresh_ts)[:16] + 'Z') if fresh_ts else prev.get('checkedAt'),
        'products': sum(1 for it in fresh if it['ret'] == ret),
    }
json.dump(status, open(status_path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

# ---------------------------------------------------------------- mémoire pour le prochain relevé
os.makedirs(lib.STATE, exist_ok=True)
keep = ['ret', 'ray', 'rid', 'brand', 'label', 'fmt_raw', 'qty', 'rolls', 'lav', 'price', 'was', 'promo', 'url', 'ean', 'ts', 'src', 'pos', 'full']
json.dump([{k: it.get(k) for k in keep} for it in items_all], open(os.path.join(lib.STATE, 'items.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('catalogue', len(products), 'produits,', meta['multi'], 'comparables,', meta['offers'], 'prix, relevé du', updated)
print('par enseigne', coverage)
for n in notes[2:-2]:
    print('  note :', n)
