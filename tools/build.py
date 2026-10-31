"""Normalise les produits relevés : marque, désignation, contenance, prix, rayon, régimes.

Entrée : tools/work/fetches.json (tools/dump.py ou tools/scrape.js) et tools/state/items.json (relevé précédent).
Sortie : tools/work/items.json et tools/work/report.json.

Une page qui n'a pas pu être lue cette fois garde les produits du relevé précédent, avec leur date, pendant au plus
CARRY_MAX_DAYS jours (CARRY_FRESH_DAYS pour les rayons frais). Ainsi une enseigne indisponible un matin ne disparaît
pas de l'appli.

Rayon d'un produit : celui de sa page ; sur une page partagée par plusieurs rayons, le premier rayon filtré
(RAYON_FILTRE) qui l'accepte, sinon le rayon sans filtre, sinon le produit est écarté. Un même produit d'une enseigne
lu dans plusieurs rayons reste dans le plus ordinaire (lib.best_rayon) et reçoit les étiquettes de régime des autres.
"""
import collections, datetime, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *  # noqa: E402,F401,F403
import lib  # noqa: E402

CARRY_MAX_DAYS = 21
CARRY_FRESH_DAYS = 7     # fruits et légumes, viandes, poissons : les prix changent chaque semaine
# Contrôle des lectures faites par Claude (WebFetch) : le prix doit concorder avec le prix au kilo ou au litre
# affiché à côté. Un écart signale presque toujours un prix pris sur la vignette voisine.
UNIT_TOL = 0.08          # écart admis entre le prix lu et prix au kilo x contenance
UNIT_TOL_FRESH = 0.25    # produits au poids variable : le prix affiché est celui d'une pièce de poids approximatif
PAGE_DOUBT_MAX = 0.3     # au-delà de cette part de prix douteux, la lecture de la page entière est écartée
# prix au kilo égoutté ou à la pièce : ne se compare pas au poids net
NO_UNIT_CHECK = {"conserves", "conserves-legumes", "legumes-secs", "plats-conserve", "cornichons-olives", "compotes", "fromages-coupe"}
UNIT_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*€\s*(?:/|le|la|par)\s*(100\s*g|100\s*ml|kg|kilo(?:gramme)?s?|l|litres?)\b", re.I)


def unit_expected(unit_text, qty):
    """Prix attendu d'après le prix à l'unité de mesure affiché (« 3,78 € / kilo ») et la contenance, ou None."""
    m = UNIT_RE.search(str(unit_text or ""))
    if not m or not qty or not qty.get("v"):
        return None
    per = 100 if m.group(2).lower().startswith("100") else 1000
    return float(m.group(1).replace(",", ".")) * qty.get("n", 1) * qty["v"] / per


def explained(ratio, qty, text, tol):
    """Un écart qui vient de la contenance écrite et non du prix : « 16 doses 104g » (contenance totale),
    « 1.75cl » pour 1,75 L, « 450ml + 50% offert ». Le prix lu est alors gardé."""
    cands = [10, 100, 1000]
    n = (qty or {}).get("n", 1)
    if n > 1:
        cands.append(n)
    for m in re.finditer(r"\+\s?(\d{1,3})\s?%", str(text or "")):
        cands.append(1 + int(m.group(1)) / 100)
    return any(abs(ratio * c - 1) <= tol or abs(ratio / c - 1) <= tol for c in cands)


def page_key(url):
    # la requête et le fragment comptent : les pages de recherche Auchan ne diffèrent que par la requête
    # (recherche?text=...) et, d'un point de retrait à l'autre, par le fragment (#alesia...)
    return (url or "").rstrip("/")


def place(label, rays, old=None):
    """Rayon d'un produit lu sur une page servant les rayons rays : les rayons filtrés qui l'acceptent, sinon le rayon
    sans filtre ; à défaut, et seulement avec old (produit repris d'un relevé précédent, lu dans le rayon old, qu'un
    filtre resserré écarte), un rayon filtré du même univers qui l'accepte, de préférence celui dont le filtre « oui »
    porte le mot qui l'a écarté (« capsule » exclu du café désigne le rayon capsules). None quand aucun rayon ne le prend."""
    ok = [r for r in rays if r in lib.RAYON_FILTRE and not lib.hors_rayon(r, label)]
    if not ok:
        ok = [r for r in rays if r not in lib.RAYON_FILTRE]
    if not ok and old:
        univers = lib.RAYON_BY_ID[old]['univers']
        ok = [r['id'] for r in lib.RAYONS if r['univers'] == univers and r['id'] in lib.RAYON_FILTRE and not lib.hors_rayon(r['id'], label)]
        exclu = lib.filtre_exclu(old, label)
        named = [r for r in ok if exclu and lib.filtre_match(r, exclu)]
        ok = named or ok
    return lib.best_rayon(ok, label) if ok else None


def full_label(it):
    """Désignation et contenance, pour le filtre final (hors_rayon) : sans la marque, comme avant."""
    return (it.get("label") or "") + " " + (it.get("fmt_raw") or "")


def route_label(it):
    """Nom lu chez l'enseigne et contenance, pour choisir le rayon d'un produit repris : le même texte que pour une
    lecture du jour (place sur le nom brut de la page)."""
    return (it.get("full") or it.get("label") or "") + " " + (it.get("fmt_raw") or "")


F_PATH = os.path.join(lib.WORK, "fetches.json")
F = json.load(open(F_PATH, encoding="utf-8")) if os.path.exists(F_PATH) else []
# une page relue plusieurs fois : garder la lecture la plus complète (produits nommés avec un prix, puis liens),
# à égalité la plus récente ; une relecture qui a moins bien lu la page ne remplace pas la bonne lecture
def score(f):
    data = parse_json(f["text"])
    items = data if isinstance(data, list) else (data or {}).get("products") or []
    items = [x for x in items if isinstance(x, dict) and (x.get("name") or x.get("title")) and isinstance(x.get("price"), (int, float))]
    return (len(items), sum(1 for x in items if x.get("url") or x.get("href")))
latest = {}
for f in sorted(F, key=lambda f: f["ts"]):
    k = page_key(f["url"])
    if k not in latest or score(f) >= score(latest[k]):
        latest[k] = f
F = list(latest.values())

prev_path = os.path.join(lib.STATE, "items.json")
prev = json.load(open(prev_path, encoding="utf-8")) if os.path.exists(prev_path) else []
prev_by_page = collections.defaultdict(list)
for it in prev:
    prev_by_page[page_key(it["src"])].append(it)

raw, ok_pages, read_pages, rejected = [], collections.Counter(), set(), []
for f in F:
    rs = lib.routes(f["url"])
    if not rs:
        continue
    read_pages.add(page_key(f["url"]))
    ret, rays = rs[0][0], [x[1] for x in rs]
    data = parse_json(f["text"])
    if data is None:
        continue
    items = data if isinstance(data, list) else data.get("products") or []
    good = []
    for pos, it in enumerate(items):
        if not isinstance(it, dict):
            continue
        price = it.get("price")
        label = it.get("name") or it.get("title")
        if not isinstance(price, (int, float)) or price <= 0 or not label:
            continue
        # page partagée par plusieurs rayons : le rayon filtré qui accepte le produit, sinon le rayon sans filtre
        ray = rays[0] if len(rays) == 1 else place(label, rays)
        if ray is None:
            continue
        good.append({"ret": ret, "ray": ray, "src": f["url"], "ts": f["ts"], "pos": pos, **it})
    # contrôle de qualité : une lecture nettement moins complète que la précédente est écartée,
    # et la page garde les produits du relevé précédent
    old = prev_by_page.get(page_key(f["url"]), [])
    links = sum(1 for g in good if g.get("url") or g.get("href"))
    old_links = sum(1 for o in old if o.get("url"))
    if old and (len(good) < 0.6 * len(old) or (old_links >= 5 and links < 0.6 * old_links)):
        rejected.append((ret, rays[0], f["url"], len(good), len(old), links, old_links))
        continue
    raw += good
    if good:
        ok_pages[page_key(f["url"])] += len(good)

print("produits lus", len(raw), dict(collections.Counter(r["ret"] for r in raw)))

# ---------------------------------------------------------------- normalise
items = []
unbranded = []
CHECKED = {ret for ret, on in (lib.load_sources().get("robot") or {}).items() if on is False}
checked, doubtful = collections.Counter(), []
for r in raw:
    ret = r['ret']
    ray = r['ray']
    univers = lib.RAYON_BY_ID[ray]['univers']
    if ret == 'carrefour':
        title = r.get('title') or r.get('name')
        if not title:
            continue
        fmt = r.get('format') or ''
        brand, rest = split_brand_suffix(title)
        # lien : chemin « /p/... » (href) ou adresse complète (url) ; le code EAN termine le chemin
        href = r.get('href') or ''
        if not href and str(r.get('url') or '').startswith('https://www.carrefour.fr/'):
            href = str(r['url'])[len('https://www.carrefour.fr'):]
        path = href.split('?')[0].split('#')[0]
        # « ?s=1234 » : article d'un vendeur partenaire de la place de marché, pas une commande Carrefour
        if re.search(r'[?&]s=\d', href):
            continue
        url = ('https://www.carrefour.fr' + path) if path else None
        m = re.search(r'(\d{8,14})$', path)
        ean = m.group(1) if m else None
        label = rest
        if not fmt:
            # first eaux page: the format is inside the title (… EVIAN 6x1,5L)
            m = re.search(r'\s(\d+\s*x\s*\d+(?:[.,]\d+)?\s*(?:cl|l|ml))$', title, re.I)
            if m:
                fmt = m.group(1)
                t2 = title[:m.start()]
                brand, label = split_brand_suffix(t2)
        if not fmt:
            # lecture sans champ « format » : la ligne de conditionnement termine le nom
            # (« … CARREFOUR CLASSIC' la plaquette de 250g », « … CARREFOUR EXTRA - 1 kg e », « … GOLDEN la pièce »)
            m = re.search(r"\s+(?:-\s+)?((?:le|la|les)\s\S.*\d.*|l[’']\S.*\d.*|(?:la|le)\s(?:pi[eè]ce|botte|barquette|filet|sachet|kg)\b.*|\d+(?:[.,]\d+)?\s?(?:x\s?\d+(?:[.,]\d+)?\s?)?(?:kg|g|l|cl|ml|œufs?|oeufs?|rouleaux)\b.*)$", title, re.I)
            if m:
                fmt = m.group(1).strip()
                brand, label = split_brand_suffix(title[:m.start()].strip())
        rid = ean or key(title + ' ' + fmt)
        if not brand:
            unbranded.append((ret, ray, title))
            brand = 'Sans marque'
    else:
        name = (r.get('name') or '').strip()
        if not name:
            continue
        fmt = r.get('format') or ''
        brand, label = split_brand_prefix(name, univers)
        if not brand and ret.startswith('auchan'):
            # Auchan écrit la marque en capitales devant la désignation : « ST MICHEL Petites madeleines »
            toks = name.split()
            i = 0
            while i < len(toks) - 1 and UPPER_TOKEN.match(toks[i]) and re.search(r'[A-ZÀ-Þ]', toks[i]):
                i += 1
            if i:
                brand, label = canon_brand(' '.join(toks[:i])), ' '.join(toks[i:]).lstrip(' -–')
        url = r.get('url')
        ean = None
        if ret == 'houra':
            # "Brand Label, 6x1,5L"
            if ', ' in label:
                lab, _, tail = label.rpartition(', ')
                if parse_qty(tail) or parse_rolls(tail) or re.search(r'\d', tail):
                    label, fmt = lab.strip(), tail.strip()
            rid = (re.search(r'/(\d+)/?$', url or '') or [None, key(name)])[1]
        elif ret.startswith('auchan'):
            rid = (re.search(r'/pr-(C?\d+)', url or '') or [None, key(name)])[1]
        else:
            rid = (re.search(r'(MPX_\d+)', url or '') or [None, key(name)])[1]
        if not brand:
            unbranded.append((ret, ray, name))
            brand = 'Sans marque'
    # strip a trailing format from the label (Monoprix keeps it in the name)
    label = re.sub(r'(?:^|[\s,]+)(?:le pack de |la bouteille de |les? |lot de )?(?<![\d.,])\d+(?:[.,]\d+)?\s*(?:x\s*\d+(?:[.,]\d+)?\s*)?(?:kg|g|cl|ml|l)\b\.?$', '', label, flags=re.I).strip(' ,-')
    label = re.sub(r'\s+x\s*\d+$', '', label).strip(' ,-')
    label = label[:1].upper() + label[1:] if label else label
    qtext = ' '.join(x for x in [fmt, r.get('name') or r.get('title') or ''] if x)
    full = r.get('name') or r.get('title')
    qty = None
    rolls = lav = pcs = None
    qty_alt = None   # l'autre contenance écrite (poids égoutté d'une conserve, « 0,456 L » d'une bouteille de 50 cl)
    approx = False
    unite = lib.RAYON_UNITE.get(ray)
    if unite == 'rouleau':
        rolls = parse_rolls(fmt) or parse_rolls(full)
    elif unite == 'oeuf':
        # boîte de 6, 10, 12 œufs : compté à l'œuf, comme les rouleaux de papier
        rolls = parse_oeufs(fmt) or parse_oeufs(full)
    else:
        if ret == 'monoprix':
            qty, qty_alt = parse_qty(r.get('name')) or parse_qty(fmt), parse_qty(fmt)
        else:
            qty, qty_alt = parse_qty(fmt) or parse_qty(full), parse_qty(full)
        if unite == 'lavage':
            lav = parse_lavages(qtext)
        elif unite:
            # couches, capsules, pièces : le nombre compte, la contenance en grammes reste informative
            p = parse_pieces(fmt, unite) or parse_pieces(full, unite)
            if p:
                rolls, pcs = p
        if not qty and ray in lib.RAYON_FRAIS:
            # frais vendu à la pièce sans poids écrit : poids de référence (PIECE_WEIGHT), contenance approximative
            g = lib.piece_weight(label)
            if g:
                m = re.search(r'(?:lot de|x)\s*(\d+)\b|(\d+)\s*pi[eè]ces', qtext.lower())
                n = int(m.group(1) or m.group(2)) if m else 1
                qty, approx = {'n': n if 1 <= n <= 24 else 1, 'v': float(g), 'u': 'g'}, True
    doubt = None
    if ret in CHECKED and ray not in NO_UNIT_CHECK and not approx:
        # le prix doit concorder avec le prix au kilo ou au litre pour l'une des contenances écrites
        tol = UNIT_TOL_FRESH if ray in lib.RAYON_FRAIS else UNIT_TOL
        exps = [e for e in (unit_expected(r.get('unit'), q) for q in (qty, qty_alt) if q) if e]
        if exps:
            checked[r['src']] += 1
            price = float(r['price'])
            if not any(abs(price - e) <= tol * max(price, e) or explained(price / e, qty, qtext, tol) for e in exps):
                doubt = round(exps[0], 2)
                doubtful.append((ret, ray, r['src'], full, r['price'], r.get('unit'), doubt))
    promo = r.get('promo')
    if promo and re.fullmatch(r'\s*cagnott[ée]s\s*', promo, re.I):
        promo = None
    items.append({
        'doubt': doubt,
        'ret': ret, 'ray': ray, 'rid': f"{ret}:{rid}", 'brand': brand, 'label': label, 'fmt_raw': fmt,
        'qty': qty, 'rolls': rolls, 'lav': lav, 'pcs': pcs, 'approx': approx or None, 'price': round(float(r['price']), 2), 'was': r.get('was'),
        'promo': promo, 'url': url, 'ean': ean, 'ts': r['ts'], 'src': r['src'], 'pos': r['pos'],
        'full': full, 'regimes': list(lib.RAYON_BY_ID[ray].get('regimes') or []),
    })

# prix douteux : la vignette garde son prix précédent ; une page qui en compte trop est relue la fois suivante
doubt_by_page = collections.Counter(d[2] for d in doubtful)
bad_pages = {page_key(src) for src, n in doubt_by_page.items() if n > PAGE_DOUBT_MAX * checked[src]}
for k in bad_pages:
    ok_pages.pop(k, None)
keep_prev = {it['rid'] for it in items if it['doubt'] and page_key(it['src']) not in bad_pages}
items = [it for it in items if not it['doubt'] and page_key(it['src']) not in bad_pages]
for it in items:
    it.pop('doubt', None)
prev_by_rid = {it['rid']: it for it in prev}
items += [dict(prev_by_rid[rid], carried=True) for rid in keep_prev if rid in prev_by_rid]

# reprise du relevé précédent pour les pages non lues cette fois
today = datetime.datetime.now(datetime.timezone.utc)
carried = []
for it in prev:
    if page_key(it["src"]) in ok_pages:
        continue
    try:
        age = (today - datetime.datetime.fromisoformat(it["ts"].replace("Z", "+00:00"))).days
    except ValueError:
        age = 0
    if age <= (CARRY_FRESH_DAYS if it["ray"] in lib.RAYON_FRAIS else CARRY_MAX_DAYS):
        carried.append(dict(it, carried=True))
items += carried

# produit repris : son rayon suit les règles du jour (page partagée, filtres), comme s'il venait d'être lu ; un filtre
# resserré l'envoie dans le rayon du même univers qui l'accepte (fromage blanc lu sous « yaourts »), sinon l'écarte
moved = collections.Counter()
kept = []
for it in items:
    if not it.get('carried') or it['ray'] not in lib.RAYON_BY_ID:
        if it['ray'] in lib.RAYON_BY_ID:
            kept.append(it)
        continue
    rays = [ry for rt, ry in lib.routes(it['src']) if rt == it['ret']] or [it['ray']]
    ray = place(route_label(it), rays, it['ray'])
    if ray is None:
        continue
    if ray != it['ray']:
        moved[(it['ray'], ray)] += 1
        it['ray'] = ray
    it['regimes'] = sorted(set(it.get('regimes') or []) | set(lib.RAYON_BY_ID[ray].get('regimes') or []))
    kept.append(it)
items = kept

# un même produit d'une enseigne lu dans plusieurs rayons : il reste dans le rayon le plus ordinaire (lib.best_rayon),
# avec la lecture la plus récente et les étiquettes de régime de tous les rayons où il a été lu
by_rid = collections.defaultdict(list)
for it in items:
    by_rid[it["rid"]].append(it)
items, multi_rayon = [], {}
for rid, lst in by_rid.items():
    best = max(lst, key=lambda it: it["ts"])
    rays = {it["ray"] for it in lst}
    if len(rays) > 1:
        multi_rayon[rid] = sorted(rays)
        best = dict(best, ray=lib.best_rayon(rays, route_label(best)))
    best["regimes"] = sorted({x for it in lst for x in it.get("regimes") or []})
    items.append(best)
items = [it for it in items if not lib.hors_courses(it.get("label") or "") and not lib.hors_rayon(it["ray"], full_label(it))]

pages = lib.load_sources()["pages"]
report = {"date": today.strftime("%Y-%m-%d"), "pages": [], "rayons": {}, "multi_rayon": multi_rayon,
          "deplaces": {f"{a} -> {b}": n for (a, b), n in sorted(moved.items())}}
for p in pages:
    k = page_key(p["url"])
    report["pages"].append({"retailer": p["retailer"], "rayon": p["rayon"], "url": p["url"], "read": k in read_pages, "products": ok_pages.get(k, 0),
                            "rejected": any(page_key(r[2]) == k for r in rejected) or k in bad_pages,
                            "doubtful": sum(n for src, n in doubt_by_page.items() if page_key(src) == k)})
for it in items:
    r = report["rayons"].setdefault(f"{it['ret']}:{it['ray']}", {"nouveaux": 0, "repris": 0})
    r["repris" if it.get("carried") else "nouveaux"] += 1
os.makedirs(lib.WORK, exist_ok=True)
json.dump(items, open(os.path.join(lib.WORK, "items.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
json.dump(report, open(os.path.join(lib.WORK, "report.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
fails = [p for p in report["pages"] if not p["products"]]
print("produits normalisés", len(items), dict(collections.Counter(i["ret"] for i in items)), "dont repris du relevé précédent", len(carried))
print("lus dans plusieurs rayons", len(multi_rayon), "(détail dans tools/work/report.json, multi_rayon)")
for (a, b), n in sorted(moved.items()):
    print(f"   {n} produits repris déplacés de {a} vers {b}")
print("sans marque reconnue", len(unbranded), "(liste complète dans tools/work/unbranded.json)")
json.dump(unbranded, open(os.path.join(lib.WORK, "unbranded.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=0)
for u in unbranded[:30]:
    print("   ", u)
for ret, ray, url, n, n0, l, l0 in rejected:
    print(f"lecture écartée (moins complète que la précédente : {n} produits dont {l} avec lien, contre {n0} dont {l0}) : {ret} {ray} {url}")
for ret, ray, src, name, price, unit, exp in doubtful:
    print(f"prix douteux, prix précédent gardé : {ret} {ray} {name} lu {price} € mais {unit} donne {exp} €" + (" (page entière écartée)" if page_key(src) in bad_pages else ""))
if F and fails:
    print("pages sans produit cette fois :", len(fails))
    for p in fails[:40]:
        print("   ", p["retailer"], p["rayon"], p["url"], "(non lue)" if not p["read"] else "(écartée)" if p["rejected"] else "(réponse vide)")
