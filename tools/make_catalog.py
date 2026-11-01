"""Construit le catalogue de l'appli à partir des produits rapprochés.

Entrée : tools/work/clusters.json (tools/match.py) et tools/work/report.json (tools/build.py).
Sorties, au format v2 (contrat lu par app.js, décrit dans CLAUDE.md) :
- data/catalog.json : univers, rayons, produits en clés courtes, offres en tableaux [enseigne, centimes, jour, drapeaux] ;
- data/details/<univers>.json : par produit et enseigne, le nom affiché par l'enseigne, le lien, la promotion, le prix barré ;
- data/meta.json (relevé, couverture, univers, notes), data/status.json (état du relevé par enseigne et par rayon) ;
- tools/state/items.json et tools/state/ids.json pour le prochain relevé.
"""
import collections, datetime, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402
from lib import key, mdd_of, RAYONS, RAYON_BY_ID, RAYON_ORDER, UNIVERS, UNIVERS_NAME  # noqa: E402

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


# mot compté (sans accent, au singulier, lu par lib.parse_pieces) -> libellé affiché au singulier
PIECE_NAMES = {'piece': 'pièce', 'unite': 'unité', 'protege': 'protège-slip', 'comprime': 'comprimé', 'gelule': 'gélule', 'carre': 'carré',
               'batonnet': 'bâtonnet', 'pads': 'dosette', 'pants': 'culotte'}


def piece_name(it):
    unite = lib.RAYON_UNITE.get(it['ray'])
    if unite in ('couche', 'capsule', 'piece'):
        w = it.get('pcs') or unite
        return PIECE_NAMES.get(w, w)
    return lib.PIECE_LABEL.get(unite, 'pièce')


def plural(n, word):
    return word if n == 1 or word.endswith('s') else word + 's'


def qty_display(it):
    """Contenance affichée et quantité {v, u (g, ml, pc), lab?} du produit."""
    ray = it['ray']
    unite = lib.RAYON_UNITE.get(ray)
    n = it.get('rolls')
    if unite == 'oeuf':
        if n:
            return f"{n} œufs", {'v': n, 'u': 'pc', 'lab': 'œuf'}
        return it['fmt_raw'] or '', None
    if unite == 'rouleau':
        return (f"{n} rouleau" + ('x' if n > 1 else '')) if n else (it['fmt_raw'] or ''), ({'v': n, 'u': 'pc', 'lab': 'rouleau'} if n else None)
    if unite in ('couche', 'capsule', 'piece') and n:
        lab = piece_name(it)
        return f"{n} {plural(n, lab)}", {'v': n, 'u': 'pc', 'lab': lab}
    q = it['qty']
    if not q:
        if unite == 'lavage' and it.get('lav'):
            return f"{it['lav']} lavages", {'v': it['lav'], 'u': 'pc', 'lab': 'lavage'}
        return it['fmt_raw'] or '', None
    tot = q['n'] * q['v']
    if it.get('approx'):
        s = (it['fmt_raw'] or '').strip() if q['n'] == 1 and it['fmt_raw'] and not re.search(r'\d', it['fmt_raw']) else (f"{q['n']} pièces" if q['n'] > 1 else 'la pièce')
        return s, {'v': round(tot, 1), 'u': q['u']}
    m = re.match(r'\s*lot de\s*(\d+)\s*(?:-|x)\s*(\d+)\s*x', (it['fmt_raw'] or '').lower())
    if m and q['n'] == int(m.group(1)) * int(m.group(2)):
        s = f"{m.group(1)} x ({m.group(2)} x {fsize(q['v'], q['u'])})"
    elif q['n'] > 1:
        s = f"{q['n']} x {fsize(q['v'], q['u'])}"
    else:
        s = fsize(q['v'], q['u'])
    if unite == 'lavage' and it.get('lav'):
        return s + f" · {it['lav']} lavages", {'v': it['lav'], 'u': 'pc', 'lab': 'lavage'}
    return s, {'v': round(tot, 1), 'u': q['u']}


# contenant par rayon (les rayons d'origine gardent leur mot ; les autres suivent l'icône de tools/rayons.json)
CONT_BY_ICON = {'tray': 'barquettes', 'net': 'filets', 'wedge': 'pièces', 'tub': 'pots', 'brick': 'briques', 'carton': 'briques', 'bottle': 'bouteilles',
                'can': 'canettes', 'pack': 'bouteilles', 'tin': 'boîtes', 'jar': 'pots', 'bag': 'sachets', 'box': 'boîtes', 'tube': 'tubes',
                'flacon': 'flacons', 'spray': 'sprays', 'sack': 'paquets', 'rolls': 'rouleaux', 'eggs': 'boîtes', 'cup': 'pots', 'cake': 'sachets', 'jug': 'bidons'}
CONT_BY_RAYON = {'eaux': 'bouteilles', 'sodas': 'bouteilles', 'jus': 'bouteilles', 'lait': 'bouteilles ou briques', 'yaourts': 'pots', 'fromages': 'sachets',
                 'conserves': 'boîtes', 'cafe': 'paquets', 'pates': 'paquets', 'gateaux': 'sachets', 'vaisselle': 'flacons', 'lessive': 'flacons',
                 'beurre': 'plaquettes', 'riz': 'paquets', 'huile': 'bouteilles', 'tomates': 'boîtes', 'thon': 'boîtes', 'farine': 'paquets', 'sucre': 'paquets'}


def long_desc(it):
    q = it['qty']
    ray = it['ray']
    unite = lib.RAYON_UNITE.get(ray)
    n = it.get('rolls')
    cont = CONT_BY_RAYON.get(ray) or CONT_BY_ICON.get(RAYON_BY_ID[ray]['icone'], 'unités')
    if unite == 'rouleau':
        return f"Paquet de {n} rouleaux." if n else ''
    if unite == 'oeuf':
        return f"Boîte de {n} œufs." if n else ''
    if unite in ('couche', 'capsule', 'piece') and n:
        lab = plural(n, piece_name(it))
        return {'couche': f"Paquet de {n} {lab}.", 'capsule': f"Boîte de {n} {lab}."}.get(unite, f"Lot de {n} {lab}." if n > 1 else '')
    if not q:
        if unite == 'lavage' and it.get('lav'):
            return f"Environ {it['lav']} lavages."
        return ''
    tot = q['n'] * q['v']
    if it.get('approx'):
        return f"Lot de {q['n']} pièces de {fsize(q['v'], q['u'])} environ." if q['n'] > 1 else f"Pièce de {fsize(tot, q['u'])} environ, prix ajusté à la pesée."
    if q['n'] > 1:
        if ray == 'sodas' and q['v'] <= 500:
            cont = 'canettes ou bouteilles'
        return f"Lot de {q['n']} {cont} de {fsize(q['v'], q['u'])}, soit {fsize(tot, q['u'])} au total."
    s = f"Contenance : {fsize(tot, q['u'])}."
    if unite == 'lavage' and it.get('lav'):
        s = f"Contenance : {fsize(tot, q['u'])}, environ {it['lav']} lavages."
    return s


TAGS = [
    ('Bio', r'\bbio\b'), ('Sans gluten', r'sans gluten'), ('Sans lactose', r'sans lactose'),
    ('Sans sucres', r'sans sucres?|z[ée]ro sucres?|\bz[ée]ro\b|cola zero'), ('Sans caféine', r'sans caf[ée]ine|z[ée]ro caf[ée]ine'),
    ('0 % MG', r'\b0 ?% ?(?:de )?mg\b|\b0 ?%'), ('Pur jus', r'pur jus|100 ?% pur'), ('AOP', r'\baop\b|\bdop\b'), ('IGP', r'\bigp\b'),
    ('Label Rouge', r'label rouge'), ('Commerce équitable', r'[ée]quitable'), ('Recharge', r'\brecharge'),
    ('Pur beurre', r'pur beurre'), ('Cuisson rapide', r'cuisson rapide|3 ?min'), ('100 % arabica', r'100 ?% ?arabica|pur arabica'),
    ('Peaux sensibles', r'peaux? sensibles?|hypoallerg'), ('Écolabel', r'[ée]colabel|ecocert'),
    ('Halal', r'\bhal+al\b'), ('Casher', r'\bcasher\b|\bcacher\b|\bkosher\b'), ('Vegan', r'\bvegan\b|v[ée]g[ée]talien'), ('Végétarien', r'v[ée]g[ée]tarien'),
    ('Sans alcool', r'sans alcool|\b0[,.]0 ?%'), ('Sans sel', r'sans sel\b'), ('Origine France', r'origine france|viande fran[çc]aise|n[ée] en france'),
]


def tags_of(names):
    t = ' '.join(names).lower()
    out = []
    for lab, rx in TAGS:
        if re.search(rx, t):
            out.append(lab)
    return out


def regimes_of(lst):
    """Étiquettes de régime d'un produit : union, sur toutes ses fiches, des étiquettes des pages lues (regimes de la
    fiche) et de celles déduites du nom et de la marque (lib.regimes_of_name)."""
    out = set()
    for x in lst:
        out |= set(x.get('regimes') or [])
        out |= set(lib.regimes_of_name(x['full'] or x['label'], x['brand'], x['ray']))
    if 'vegan' in out:
        out.add('vegetarien')
    return sorted(out)


# icône (forme de l'illustration, packs.js) : les rayons d'origine gardent leur règle par produit, les autres prennent
# l'icône de leur rayon (ICON_BY_RAYON, champ icone de tools/rayons.json)
ICON_BY_RAYON = {r['id']: r['icone'] for r in RAYONS}


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
    if ray == 'fromages':
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
    if ray in ('tomates', 'thon'):
        return 'tin'
    if ray == 'huile':
        return 'bottle'
    if ray == 'riz':
        return 'bag'
    if ray in ('oeufs', 'beurre', 'farine', 'sucre'):
        return 'box'
    return ICON_BY_RAYON[ray]


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
    dsc = long_desc(main)
    if dsc:
        p['desc'] = dsc
    reg = regimes_of(lst)
    if reg:
        p['regimes'] = reg
    if RAYON_BY_ID[main['ray']].get('frais'):
        p['frais'] = True
    if any(x.get('approx') for x in lst):
        p['approx'] = True
    # fiches sans marque rapprochées entre enseignes (fruits, légumes, pains) : produits équivalents, pas la même référence
    if len(offers) > 1 and all(key(x['brand']) == 'sans marque' for x in lst):
        p['eq'] = True
    products.append(p)
    built.append((lst, p, base))


# ---------------------------------------------------------------- identifiants stables
# Un produit garde son identifiant d'un relevé à l'autre : les paniers et les listes enregistrés sur les téléphones en dépendent.
# tools/state/ids.json associe chaque fiche d'enseigne (rid) à l'identifiant du produit qui la contient. À défaut (premier
# passage), l'identifiant est retrouvé dans le catalogue précédent par le lien de la fiche, ou par le nom affiché et la contenance.
# Quand deux produits fusionnent, l'identifiant abandonné renvoie vers celui qui reste (« aliases » dans data/catalog.json).
ids_path = os.path.join(lib.STATE, 'ids.json')
prev_ids = json.load(open(ids_path, encoding='utf-8')) if os.path.exists(ids_path) else {}
cat_path = os.path.join(lib.DATA, 'catalog.json')


def load_published(path):
    """Un catalogue publié (v1 ou v2) avec, par offre, le nom et le lien chez l'enseigne (détails v2 lus à côté)."""
    if not path or not os.path.exists(path):
        return {'products': [], 'aliases': {}}
    cat = json.load(open(path, encoding='utf-8'))
    prods = lib.read_catalog(cat)
    if cat.get('v') == 2:
        root = os.path.dirname(os.path.dirname(os.path.abspath(path)))
        univ_of = {r['id']: r['u'] for r in cat['rayons']}
        cache = {}
        for pp in prods:
            u = univ_of.get(pp['r'])
            if u not in cache:
                cache[u] = lib.read_details(root, u) if u else {}
            det = cache[u].get(pp['id'], {})
            for ret, o in pp['offers'].items():
                dd = det.get(ret) or {}
                o['name'], o['url'] = dd.get('n'), dd.get('u')
    return {'products': prods, 'aliases': cat.get('aliases') or {}}


last_cat = load_published(cat_path)
prev_cat = load_published(os.environ['CABAS_PREV_CATALOG']) if os.environ.get('CABAS_PREV_CATALOG') else last_cat
prev_aliases = {**last_cat['aliases'], **prev_cat['aliases']}


def offer_index(cat):
    """Index des offres d'un catalogue : par lien de fiche, par nom affiché et contenance, par nom seul (noms ambigus écartés)."""
    by_url, by_nf, by_name = {}, collections.defaultdict(set), collections.defaultdict(set)
    for pp in cat['products']:
        for r, o in pp['offers'].items():
            if o.get('sim'):
                continue
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
        if o.get('sim'):
            continue
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
# un produit publié qui se sépare en deux (fiches bio et non bio d'abord réunies, fiche surgelée et fiche fraîche) : son
# identifiant reste à celui qui garde la marque, le nom et la contenance affichés jusque-là, ceux que les paniers et les
# listes des téléphones montrent ; à défaut, à celui qui reprend le plus de ses fiches
prev_look = {pp['id']: (pp['brand'], pp['name'], pp['format']) for pp in last_cat['products']}
for pid0, cands in wish.items():
    look = lambda t: (built[t[2]][1]['brand'], built[t[2]][1]['name'], built[t[2]][1]['format']) == prev_look.get(pid0)
    cands.sort(key=lambda t: (not look(t), -t[0], not t[1]))
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
products.sort(key=lambda p: (RAYON_ORDER[p['ray']], -len(p['offers']), p['rank']))
for p in products:
    p['r'] = p.pop('ray')
    p.pop('rank', None)
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

# ---------------------------------------------------------------- prix simulés
# Enseigne qu'aucun relevé ne peut lire sans contourner sa protection anti-robot (E.Leclerc) : à la demande du
# propriétaire de l'appli, ses prix sont simulés à partir de prix réellement relevés chez une autre enseigne et d'un
# écart moyen publié (réglage « simulation » de data/retailers.json). Chaque offre simulée porte « sim » et l'appli
# l'affiche comme telle : jamais présentée comme un prix relevé.
RETAILERS = json.load(open(os.path.join(lib.DATA, 'retailers.json'), encoding='utf-8'))
for R in RETAILERS:
    sim = R.get('simulation')
    if not sim:
        continue
    for pp in products:
        b = pp['offers'].get(sim['base'])
        if pp.get('type') not in sim.get('types', ['nb']) or not b or b.get('sim'):
            continue
        pp['offers'][R['id']] = {'price': round(b['price'] * sim['ratio'], 2), 'at': b['at'], 'name': f"{pp['brand']} {pp['name']}, {pp['format']}".strip(', '),
                                 'url': R['home'], 'sim': True}

# ---------------------------------------------------------------- écriture v2 : catalog.json compact et détails par univers
RETS = [R['id'] for R in RETAILERS]
ret_idx = {r: i for i, r in enumerate(RETS)}
VIRTUEL = {'halal': ['halal'], 'casher': ['casher'], 'sans-gluten': ['sans-gluten'], 'vegan': ['vegan']}


def num(x):
    return int(x) if float(x).is_integer() else x


def compact(p):
    c = {'i': p['id'], 'b': p['brand'], 'n': p['name'], 'f': p['format'], 'r': p['r'], 'k': p['icon'], 't': p['type']}
    if p.get('qty'):
        c['q'] = [num(p['qty']['v']), p['qty']['u']]
        if p['qty'].get('lab'):
            c['ql'] = p['qty']['lab']
    if p.get('tags'):
        c['g'] = p['tags']
    if p.get('regimes'):
        c['d'] = p['regimes']
    if p.get('ean'):
        c['e'] = p['ean']
    if p.get('mdd'):
        c['m'] = p['mdd']
    if p.get('desc') and not p['desc'].startswith('Contenance :'):
        c['s'] = p['desc']
    if p.get('frais'):
        c['fr'] = 1
    if p.get('approx'):
        c['ap'] = 1
    if p.get('eq'):
        c['eq'] = 1
    offers = []
    for ret, o in p['offers'].items():
        flags = (lib.FLAG_PROMO if o.get('promo') else 0) | (lib.FLAG_SIM if o.get('sim') else 0) | (lib.FLAG_CAT if o.get('cat') else 0) | (lib.FLAG_WAS if o.get('was') else 0)
        offers.append([ret_idx[ret], int(round(o['price'] * 100)), lib.day_of(o['at']), flags])
    c['o'] = sorted(offers, key=lambda x: (x[1], x[0]))
    return c


def detail(p):
    out = {}
    for ret, o in p['offers'].items():
        dd = {'n': o.get('name') or f"{p['brand']} {p['name']}", 'u': o.get('url') or ''}
        if o.get('promo') and not o.get('sim'):
            dd['p'] = o['promo']
        if o.get('was'):
            dd['w'] = num(round(float(o['was']), 2))
        out[ret] = dd
    return out


count = collections.Counter(p['r'] for p in products)
rayons = []
for i, r in enumerate(RAYONS):
    if not count[r['id']] and r['id'] not in VIRTUEL:
        continue   # un rayon sans aucun produit (pas encore relu) n'est pas affiché
    rayons.append({'id': r['id'], 'name': r['nom'], 'u': r['univers'], 'order': i, 'regimes': r.get('regimes') or [], 'frais': bool(r.get('frais')),
                   'unite': r.get('unite'), 'virtuel': VIRTUEL.get(r['id']), 'n': count[r['id']]})
rayons.append({'id': 'bio', 'name': 'Bio', 'u': 'regimes-bio', 'order': len(RAYONS), 'regimes': ['bio'], 'frais': False, 'unite': None, 'virtuel': ['bio'], 'n': 0})
items_all = d['items']
fresh = [it for it in items_all if not it.get('carried')]
updated = max((it['ts'][:10] for it in fresh), default=max(it['ts'][:10] for it in items_all))
catalog = {'v': 2, 'updatedAt': updated, 'epoch': lib.EPOCH.isoformat(), 'rets': RETS, 'univers': [{'id': u, 'name': n} for u, n in UNIVERS],
           'rayons': rayons, 'aliases': aliases, 'products': [compact(p) for p in products]}
os.makedirs(os.path.join(lib.DATA, 'details'), exist_ok=True)
json.dump(catalog, open(cat_path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
by_univers = collections.defaultdict(dict)
for p in products:
    by_univers[RAYON_BY_ID[p['r']]['univers']][p['id']] = detail(p)
for u, _ in UNIVERS:
    path = os.path.join(lib.DATA, 'details', u + '.json')
    if by_univers.get(u):
        json.dump({'v': 2, 'u': u, 'p': by_univers[u]}, open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    elif os.path.exists(path):
        os.remove(path)
os.makedirs(lib.STATE, exist_ok=True)
json.dump(dict(sorted(prev_ids.items())), open(ids_path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('identifiants repris', len(products) - fresh_ids, 'nouveaux', fresh_ids, 'renvois', len(aliases))

# ---------------------------------------------------------------- informations sur le relevé
MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']


def fr(day):
    y, mth, dd = (int(x) for x in day.split('-'))
    return f"{dd} {MOIS[mth - 1]} {y}"


rets = {r['id']: r for r in RETAILERS}
coverage = dict(collections.Counter(r for p in products for r in p['offers']))
missing, never, old = collections.defaultdict(list), collections.Counter(), collections.defaultdict(set)
status_path = os.path.join(lib.DATA, 'status.json')
old_status = json.load(open(status_path, encoding='utf-8')) if os.path.exists(status_path) else {}
report = json.load(open(os.path.join(lib.WORK, 'report.json'), encoding='utf-8')) if os.path.exists(os.path.join(lib.WORK, 'report.json')) else {'pages': []}
# seuls comptent les rayons qu'une enseigne a dans tools/sources.json : les autres ne sont pas relevés chez elle ;
# un rayon jamais lu (pages jamais tentées, aucun produit au relevé précédent) est « pas encore relevé », pas manquant
lus = {(pg['retailer'], pg['rayon']) for pg in lib.load_sources()['pages']}
tried = {(pg['retailer'], pg['rayon']) for pg in report['pages'] if pg['read']}
tried |= {(ret, ray) for ret, st in (old_status.get('retailers') or {}).items() for ray in (st.get('rayons') or {})}
by_ret_ray = collections.defaultdict(list)
for it in items_all:
    by_ret_ray[(it['ret'], it['ray'])].append(it)
for ret in rets:
    for r in RAYONS:
        if (ret, r['id']) not in lus:
            continue
        got = by_ret_ray.get((ret, r['id']))
        if not got:
            if (ret, r['id']) in tried:
                missing[ret].append(r['nom'])
            else:
                never[ret] += 1
        elif all(it.get('carried') for it in got):
            old[ret].add((r['nom'], min(it['ts'][:10] for it in got)))
services = []
for r in sorted(rets, key=lambda r: rets[r].get('order', 9)):
    if rets[r]['service'] not in services:
        services.append(rets[r]['service'])
notes = [
    f"Prix relevés le {fr(updated)} sur les pages rayon publiques de {', '.join(services[:-1])} et {services[-1]}, tels qu'affichés à l'unité. Les offres du type « 2e à -50 % » ou cagnotte sont signalées sur la fiche, mais les totaux utilisent le prix affiché à l'unité.",
    "Un même produit est rapproché entre enseignes par marque, désignation et contenance. Les marques distributeur ne sont vendues que par leur enseigne, sauf Auchan et Pouce, vendues aussi par Houra.",
]


def low(x):
    return x[:1].lower() + x[1:]


def enum(lst):
    """Au plus six rayons nommés ; au-delà, leur nombre et les premiers (le détail est dans l'état du relevé)."""
    lst = [low(x) for x in lst]
    if len(lst) > 6:
        return f"{len(lst)} rayons dont {', '.join(lst[:5])}"
    return lst[0] if len(lst) == 1 else ', '.join(lst[:-1]) + ' et ' + lst[-1]


def rayon_phrase(lst):
    if len(lst) > 6:
        return enum(lst)
    return ('le rayon ' if len(lst) == 1 else 'les rayons ') + enum(lst)


def note(text):
    """Une phrase une seule fois : les six options Auchan partagent leurs phrases quand elles sont identiques."""
    if text not in notes:
        notes.append(text)


said_never = set()
for ret in sorted(rets, key=lambda r: rets[r].get('order', 9)):
    name = rets[ret]['name']
    ch = rets[ret].get('channel') or {}
    if rets[ret].get('simulation'):
        note(f"{name} : prix simulés, pas relevés. {rets[ret]['simulation']['note']}")
        continue
    if ch.get('mode') == 'retrait' and ch.get('where'):
        note(f"{name} : prix du point de retrait {ch['where']}, choisi sur {rets[ret]['service']}.")
    if missing.get(ret):
        lst = missing[ret]
        note(f"{name} : {rayon_phrase(lst)} {'n' + chr(39) + 'a' if len(lst) == 1 else 'n' + chr(39) + 'ont'} pas pu être lu{'s' if len(lst) > 1 else ''} pendant le relevé.")
    if never.get(ret) and name not in said_never:
        said_never.add(name)
        note(f"{name} : {never[ret]} rayons pas encore relevés.")
    by_day = collections.defaultdict(list)
    for rayon_name, day in sorted(old.get(ret, ())):
        by_day[day].append(rayon_name)
    present = sum(1 for r in RAYONS if (ret, r['id']) in lus) - len(missing.get(ret, [])) - never.get(ret, 0)
    for day, lst in sorted(by_day.items()):
        if len(lst) == present:
            note(f"{name} : prix relevés le {fr(day)}.")
        else:
            note(f"{name} : prix du {fr(day)} pour {rayon_phrase(lst)} (voir l'état du relevé).")
notes.append("Les prix changent souvent (promotions de la semaine). Vérifie le total au moment de commander sur le site de l'enseigne.")
notes.append("Les visuels des produits sont des illustrations de l'appli, pas des photos des emballages.")
univ_stats = []
for u, n in UNIVERS:
    rs = [r for r in rayons if r['u'] == u and r['n']]
    univ_stats.append({'id': u, 'name': n, 'rayons': len(rs), 'products': sum(r['n'] for r in rs)})
meta = {'updatedAt': updated, 'products': len(products), 'offers': sum(len(p['offers']) for p in products),
        'multi': sum(1 for p in products if len({rets.get(k, {}).get('group') or k for k, o in p['offers'].items() if not o.get('sim')}) > 1),
        'rayons': sum(1 for r in rayons if r['n']), 'univers': univ_stats, 'coverage': coverage, 'notes': notes}
json.dump(meta, open(os.path.join(lib.DATA, 'meta.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

# ---------------------------------------------------------------- état du relevé (par enseigne, puis par rayon)
now =datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%MZ')
status = {'checkedAt': now, 'retailers': {}}
for ret in rets:
    if rets[ret].get('simulation'):
        continue
    pages = [p for p in report['pages'] if p['retailer'] == ret]
    ok = [p for p in pages if p['products']]
    fresh_ts = [it['ts'] for it in fresh if it['ret'] == ret]
    prev = (old_status.get('retailers') or {}).get(ret, {})
    per_rayon = {r['id']: {'at': max(it['ts'][:10] for it in by_ret_ray[(ret, r['id'])]), 'products': len(by_ret_ray[(ret, r['id'])])}
                 for r in RAYONS if by_ret_ray.get((ret, r['id']))}
    if not ok and prev.get('checkedAt'):
        # enseigne pas relue cette fois (l'autre source publie) : on garde le compte rendu de sa dernière lecture
        status['retailers'][ret] = {**prev, 'rayons': per_rayon}
        continue
    status['retailers'][ret] = {
        'pages': len(pages), 'read': len(ok),
        'checkedAt': (max(fresh_ts)[:16] + 'Z') if fresh_ts else prev.get('checkedAt'),
        'products': sum(1 for it in fresh if it['ret'] == ret),
        'rayons': per_rayon,
    }
json.dump(status, open(status_path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

# ---------------------------------------------------------------- mémoire pour le prochain relevé
keep = ['ret', 'ray', 'rid', 'brand', 'label', 'fmt_raw', 'qty', 'rolls', 'lav', 'pcs', 'approx', 'price', 'was', 'promo', 'url', 'ean', 'ts', 'src', 'pos', 'full', 'regimes']
json.dump([{k: it.get(k) for k in keep} for it in items_all], open(os.path.join(lib.STATE, 'items.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('catalogue', len(products), 'produits,', meta['multi'], 'comparables,', meta['offers'], 'prix,', meta['rayons'], 'rayons, relevé du', updated)
print('par enseigne', coverage)
for n in notes[2:-2]:
    print('  note :', n)
