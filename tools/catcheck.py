"""Valide data/catalog.json et data/details/*.json contre le contrat du catalogue v2 (celui que lit app.js), puis affiche
des statistiques : produits par univers et par rayon, offres par enseigne, taille brute et gzip.
Sort avec le code 1 à la première règle violée. Usage : python3 tools/catcheck.py
"""
import collections, datetime, gzip, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

ICONS = {'tray', 'net', 'wedge', 'tub', 'brick', 'bottle', 'can', 'pack', 'tin', 'jar', 'bag', 'box', 'tube', 'flacon', 'spray', 'sack', 'rolls', 'eggs',
         'cup', 'carton', 'jug', 'cake', 'roll'}
UNITES = {'oeuf', 'rouleau', 'couche', 'capsule', 'lavage', 'piece', None}
PRODUCT_KEYS = {'i', 'b', 'n', 'f', 'r', 'k', 't', 'q', 'ql', 'g', 'd', 'e', 'm', 's', 'fr', 'ap', 'eq', 'o'}
RAYON_KEYS = {'id', 'name', 'u', 'order', 'regimes', 'frais', 'unite', 'virtuel', 'n'}
MAX_GZIP = 2 * 1024 * 1024
MAX_RAW = 16 * 1024 * 1024
errors = []


def check(cond, msg):
    if not cond and len(errors) < 40:
        errors.append(msg)


def main():
    path = os.path.join(lib.DATA, 'catalog.json')
    raw = open(path, 'rb').read()
    cat = json.loads(raw)
    check(cat.get('v') == 2, 'v doit valoir 2')
    check(set(cat) == {'v', 'updatedAt', 'epoch', 'rets', 'univers', 'rayons', 'aliases', 'products'}, f'clés de premier niveau : {sorted(cat)}')
    check(cat.get('epoch') == lib.EPOCH.isoformat(), 'epoch inattendue')
    datetime.date.fromisoformat(cat['updatedAt'])
    retailers = [r['id'] for r in json.load(open(os.path.join(lib.DATA, 'retailers.json'), encoding='utf-8'))]
    check(cat['rets'] == retailers, 'rets doit reprendre les id de data/retailers.json dans leur ordre')
    univ = [u['id'] for u in cat['univers']]
    check(univ == [u for u, _ in lib.UNIVERS] and all(u['name'] == lib.UNIVERS_NAME[u['id']] for u in cat['univers']), 'univers : les 18 du contrat, dans l\'ordre')
    rayons = {r['id']: r for r in cat['rayons']}
    check(len(rayons) == len(cat['rayons']), 'rayons en double')
    for r in cat['rayons']:
        check(set(r) == RAYON_KEYS, f"rayon {r.get('id')} : clés {sorted(r)}")
        check(r['u'] in univ, f"rayon {r['id']} : univers inconnu {r['u']}")
        check(r['id'] == 'bio' or r['id'] in lib.RAYON_BY_ID, f"rayon inconnu {r['id']}")
        check(r['unite'] in UNITES, f"rayon {r['id']} : unite {r['unite']}")
        check(isinstance(r['order'], int) and isinstance(r['n'], int) and isinstance(r['frais'], bool), f"rayon {r['id']} : types")
        check(r['virtuel'] is None or (isinstance(r['virtuel'], list) and all(x in lib.REGIMES for x in r['virtuel'])), f"rayon {r['id']} : virtuel")
        check(all(x in lib.REGIMES for x in r['regimes']), f"rayon {r['id']} : regimes")
        check(r['n'] > 0 or r['virtuel'], f"rayon {r['id']} vide")
        if r['id'] != 'bio':
            src = lib.RAYON_BY_ID[r['id']]
            check(r['name'] == src['nom'] and r['u'] == src['univers'] and r['order'] == lib.RAYON_ORDER[r['id']], f"rayon {r['id']} : nom, univers ou ordre différents de tools/rayons.json")
    today = (datetime.date.today() - lib.EPOCH).days
    ids = set()
    count = collections.Counter()
    offers_by_ret = collections.Counter()
    nret = len(cat['rets'])
    for p in cat['products']:
        pid = p.get('i')
        check(isinstance(pid, str) and pid and pid not in ids, f'identifiant manquant ou en double : {pid}')
        ids.add(pid)
        check(set(p) <= PRODUCT_KEYS and {'i', 'b', 'n', 'f', 'r', 'k', 't', 'o'} <= set(p), f'{pid} : clés {sorted(p)}')
        check(p['r'] in rayons and rayons[p['r']]['virtuel'] is None or p['r'] in rayons and p['r'] != 'bio', f"{pid} : rayon {p['r']}")
        check(p['k'] in ICONS, f"{pid} : icône {p['k']}")
        check(p['t'] in ('nb', 'mdd'), f"{pid} : type {p['t']}")
        check(all(isinstance(p[k], str) for k in ('b', 'n', 'f')), f'{pid} : b, n, f doivent être des chaînes')
        if 'q' in p:
            check(isinstance(p['q'], list) and len(p['q']) == 2 and isinstance(p['q'][0], (int, float)) and p['q'][0] > 0 and p['q'][1] in ('g', 'ml', 'pc'), f'{pid} : q {p.get("q")}')
            check(p['q'][1] != 'pc' or 'ql' in p, f'{pid} : ql manquant pour une contenance en pièces')
        check('ql' not in p or ('q' in p and p['q'][1] == 'pc'), f'{pid} : ql sans q en pièces')
        for k in ('g', 'd'):
            check(k not in p or (isinstance(p[k], list) and p[k]), f'{pid} : {k} doit être une liste non vide')
        check('d' not in p or all(x in lib.REGIMES for x in p['d']), f"{pid} : régimes {p.get('d')}")
        check('d' not in p or 'vegan' not in p['d'] or 'vegetarien' in p['d'], f'{pid} : vegan sans vegetarien')
        check('e' not in p or (isinstance(p['e'], str) and p['e'].isdigit()), f'{pid} : EAN')
        check('m' not in p or p['m'] in cat['rets'], f"{pid} : enseigne de marque distributeur {p.get('m')}")
        check('s' not in p or (isinstance(p['s'], str) and p['s'] and not p['s'].startswith('Contenance :')), f'{pid} : s')
        for k in ('fr', 'ap', 'eq'):
            check(k not in p or p[k] == 1, f'{pid} : {k} vaut 1 ou est absent')
        o = p['o']
        check(isinstance(o, list) and o, f'{pid} : aucune offre')
        seen = set()
        last = -1
        for off in o:
            check(isinstance(off, list) and len(off) == 4 and all(isinstance(x, int) for x in off), f'{pid} : offre {off}')
            idx, cents, day, flags = off
            check(0 <= idx < nret and idx not in seen, f'{pid} : enseigne {idx} hors liste ou en double')
            seen.add(idx)
            check(cents > 0, f'{pid} : prix en centimes {cents}')
            check(0 <= day <= today, f'{pid} : jour {day}')
            check(0 <= flags < 16, f'{pid} : drapeaux {flags}')
            check(cents >= last, f'{pid} : offres non triées par prix')
            last = cents
            offers_by_ret[cat['rets'][idx]] += 1
        count[p['r']] += 1
    for r in cat['rayons']:
        check(r['n'] == count[r['id']], f"rayon {r['id']} : n {r['n']} pour {count[r['id']]} produits")
    for a, b in cat['aliases'].items():
        check(a not in ids and b in ids and a != b, f'alias {a} -> {b}')
    # détails par univers
    det_dir = os.path.join(lib.DATA, 'details')
    univ_of = {r['id']: r['u'] for r in cat['rayons']}
    expected = collections.defaultdict(set)
    for p in cat['products']:
        expected[univ_of[p['r']]].add(p['i'])
    sizes = {}
    # « la pièce » (poids de référence d'une pièce) ne doit pas contredire le nom chez l'enseigne : « Colis de 2 kilos »,
    # « Barquette de 4 fruits » sont des lots, pas une pièce de 170 g
    piece = {p['i']: p for p in cat['products'] if p['f'] == 'la pièce'}
    for u in univ:
        path_u = os.path.join(det_dir, u + '.json')
        if not expected[u]:
            check(not os.path.exists(path_u), f'details/{u}.json sans produit')
            continue
        check(os.path.exists(path_u), f'details/{u}.json manquant')
        if not os.path.exists(path_u):
            continue
        rawu = open(path_u, 'rb').read()
        sizes[u] = len(rawu)
        det = json.loads(rawu)
        check(set(det) == {'v', 'u', 'p'} and det['v'] == 2 and det['u'] == u, f'details/{u}.json : en-tête')
        check(set(det['p']) == expected[u], f'details/{u}.json : produits différents du catalogue')
        for pid, per in det['p'].items():
            for ret, dd in per.items():
                check(ret in cat['rets'] and set(dd) <= {'n', 'u', 'p', 'w'} and {'n', 'u'} <= set(dd), f'details/{u}.json {pid} {ret} : {sorted(dd)}')
                check(isinstance(dd['n'], str) and isinstance(dd['u'], str), f'details/{u}.json {pid} {ret} : n et u sont des chaînes')
                check('w' not in dd or isinstance(dd['w'], (int, float)), f'details/{u}.json {pid} {ret} : w')
                if pid in piece and isinstance(dd.get('n'), str):
                    k = lib.key(dd['n'])
                    lot = re.search(r'\b(\d+) (?:fruits|legumes|pieces)\b', k)
                    kilo = re.search(r'\b(\d+(?: \d+)?) ?(?:kilos?|kg)\b', k)
                    q = piece[pid].get('q')
                    grams = q[0] if q and q[1] == 'g' else None
                    check(not (lot and int(lot.group(1)) > 1), f"{pid} : « la pièce » mais « {dd['n']} » chez {ret}")
                    check(not (kilo and grams and abs(grams / (float(kilo.group(1).replace(' ', '.')) * 1000) - 1) > 0.25),
                          f"{pid} : « la pièce » de {grams} g mais « {dd['n']} » chez {ret}")
        check(len(rawu) <= MAX_RAW, f'details/{u}.json trop gros')
    gz = len(gzip.compress(raw))
    check(len(raw) <= MAX_RAW, 'catalog.json dépasse 16 Mo')
    check(gz <= MAX_GZIP, f'catalog.json dépasse 2 Mo gzip ({gz} octets)')
    if errors:
        print('catalogue invalide :')
        for e in errors:
            print('  -', e)
        sys.exit(1)
    # statistiques
    print(f"catalogue v2 valide : {len(cat['products'])} produits, {sum(count.values())} rattachés à {sum(1 for r in cat['rayons'] if r['n'])} rayons, "
          f"{len(cat['aliases'])} renvois, relevé du {cat['updatedAt']}")
    print(f"taille : {len(raw) / 1024:.0f} Ko brut, {gz / 1024:.0f} Ko gzip ; détails : " + ', '.join(f"{u} {s / 1024:.0f} Ko" for u, s in sizes.items()))
    print('offres par enseigne : ' + ', '.join(f"{r} {n}" for r, n in offers_by_ret.most_common()))
    for u, name in lib.UNIVERS:
        rs = [r for r in cat['rayons'] if r['u'] == u and r['n']]
        if rs:
            print(f"{name} : {sum(r['n'] for r in rs)} produits ; " + ', '.join(f"{r['name']} {r['n']}" for r in rs))


if __name__ == '__main__':
    main()
