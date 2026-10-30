"""Normalise les produits relevés : marque, désignation, contenance, prix.

Entrée : tools/work/fetches.json (tools/dump.py) et tools/state/items.json (relevé précédent).
Sortie : tools/work/items.json et tools/work/report.json.

Une page qui n'a pas pu être lue cette fois garde les produits du relevé précédent, avec leur date,
pendant au plus CARRY_MAX_DAYS jours. Ainsi une enseigne indisponible un matin ne disparaît pas de l'appli.
"""
import collections, datetime, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *  # noqa: E402,F401,F403
import lib  # noqa: E402

CARRY_MAX_DAYS = 21
# Contrôle des lectures faites par Claude (WebFetch) : le prix doit concorder avec le prix au kilo ou au litre
# affiché à côté. Un écart signale presque toujours un prix pris sur la vignette voisine.
UNIT_TOL = 0.08          # écart admis entre le prix lu et prix au kilo x contenance
PAGE_DOUBT_MAX = 0.3     # au-delà de cette part de prix douteux, la lecture de la page entière est écartée
NO_UNIT_CHECK = {"conserves"}   # prix au kilo égoutté : ne se compare pas au poids net
UNIT_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*€\s*(?:/|le|la|par)\s*(100\s*g|100\s*ml|kg|kilo(?:gramme)?s?|l|litres?)\b", re.I)


def unit_expected(unit_text, qty):
    """Prix attendu d'après le prix à l'unité de mesure affiché (« 3,78 € / kilo ») et la contenance, ou None."""
    m = UNIT_RE.search(str(unit_text or ""))
    if not m or not qty or not qty.get("v"):
        return None
    per = 100 if m.group(2).lower().startswith("100") else 1000
    return float(m.group(1).replace(",", ".")) * qty.get("n", 1) * qty["v"] / per


def explained(ratio, qty, text):
    """Un écart qui vient de la contenance écrite et non du prix : « 16 doses 104g » (contenance totale),
    « 1.75cl » pour 1,75 L, « 450ml + 50% offert ». Le prix lu est alors gardé."""
    cands = [10, 100, 1000]
    n = (qty or {}).get("n", 1)
    if n > 1:
        cands.append(n)
    for m in re.finditer(r"\+\s?(\d{1,3})\s?%", str(text or "")):
        cands.append(1 + int(m.group(1)) / 100)
    return any(abs(ratio * c - 1) <= UNIT_TOL or abs(ratio / c - 1) <= UNIT_TOL for c in cands)


def page_key(url):
    # la requête et le fragment comptent : les pages de recherche Auchan ne diffèrent que par la requête
    # (recherche?text=...) et, d'un point de retrait à l'autre, par le fragment (#alesia...)
    return (url or "").rstrip("/")


F = json.load(open(os.path.join(lib.WORK, "fetches.json"), encoding="utf-8"))
# une page relue plusieurs fois : garder la lecture la plus récente qui a donné des produits
latest = {}
for f in sorted(F, key=lambda f: f["ts"]):
    data = parse_json(f["text"])
    n = len(data if isinstance(data, list) else (data or {}).get("products") or []) if data is not None else 0
    k = page_key(f["url"])
    if n or k not in latest:
        latest[k] = f
F = list(latest.values())

prev_path = os.path.join(lib.STATE, "items.json")
prev = json.load(open(prev_path, encoding="utf-8")) if os.path.exists(prev_path) else []
prev_by_page = collections.defaultdict(list)
for it in prev:
    prev_by_page[page_key(it["src"])].append(it)

raw, ok_pages, read_pages, rejected = [], collections.Counter(), set(), []
for f in F:
    r = route(f["url"])
    if not r:
        continue
    read_pages.add(page_key(f["url"]))
    ret, ray = r
    data = parse_json(f["text"])
    if data is None:
        continue
    items = data if isinstance(data, list) else data.get("products") or []
    good = []
    for pos, it in enumerate(items):
        if not isinstance(it, dict):
            continue
        price = it.get("price")
        if not isinstance(price, (int, float)) or price <= 0 or not (it.get("name") or it.get("title")):
            continue
        good.append({"ret": ret, "ray": ray, "src": f["url"], "ts": f["ts"], "pos": pos, **it})
    # contrôle de qualité : une lecture nettement moins complète que la précédente est écartée,
    # et la page garde les produits du relevé précédent
    old = prev_by_page.get(page_key(f["url"]), [])
    links = sum(1 for g in good if g.get("url") or g.get("href"))
    old_links = sum(1 for o in old if o.get("url"))
    if old and (len(good) < 0.6 * len(old) or (old_links >= 5 and links < 0.6 * old_links)):
        rejected.append((ret, ray, f["url"], len(good), len(old), links, old_links))
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
    if ret == 'carrefour':
        title = r.get('title') or r.get('name')
        if not title:
            continue
        fmt = r.get('format') or ''
        brand, rest = split_brand_suffix(title.split(' 6x')[0] if False else title)
        url = ('https://www.carrefour.fr' + r['href']) if r.get('href') else None
        ean = None
        if r.get('href'):
            m = re.search(r'(\d{8,14})$', r['href'])
            ean = m.group(1) if m else None
        qty_text = fmt or title
        name_for_qty = title
        label = rest
        if not fmt:
            # first eaux page: the format is inside the title (… EVIAN 6x1,5L)
            m = re.search(r'\s(\d+\s*x\s*\d+(?:[.,]\d+)?\s*(?:cl|l|ml))$', title, re.I)
            if m:
                fmt = m.group(1)
                t2 = title[:m.start()]
                brand, label = split_brand_suffix(t2)
        rid = ean or key(title + ' ' + fmt)
    else:
        name = (r.get('name') or '').strip()
        if not name:
            continue
        fmt = r.get('format') or ''
        brand, label = split_brand_prefix(name)
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
            unbranded.append((ret, r['ray'], name))
            brand = 'Sans marque'
    # strip a trailing format from the label (Monoprix keeps it in the name)
    label = re.sub(r'(?:^|[\s,]+)(?:le pack de |la bouteille de |les? |lot de )?(?<![\d.,])\d+(?:[.,]\d+)?\s*(?:x\s*\d+(?:[.,]\d+)?\s*)?(?:kg|g|cl|ml|l)\b\.?$', '', label, flags=re.I).strip(' ,-')
    label = re.sub(r'\s+x\s*\d+$', '', label).strip(' ,-')
    label = label[:1].upper() + label[1:] if label else label
    qtext = ' '.join(x for x in [fmt, r.get('name') or r.get('title') or ''] if x)
    ray = r['ray']
    qty = None
    rolls = lav = None
    if ray == 'papier':
        rolls = parse_rolls(fmt) or parse_rolls(r.get('name') or r.get('title'))
    elif ray == 'oeufs':
        # boîte de 6, 10, 12 œufs : compté à l'œuf, comme les rouleaux de papier
        rolls = parse_oeufs(fmt) or parse_oeufs(r.get('name') or r.get('title'))
    else:
        if ret == 'monoprix':
            qty = parse_qty(r.get('name')) or parse_qty(fmt)
        else:
            qty = parse_qty(fmt) or parse_qty(r.get('name') or r.get('title'))
        if ray == 'lessive':
            lav = parse_lavages(qtext)
    doubt = None
    if ret in CHECKED and ray not in NO_UNIT_CHECK:
        exp = unit_expected(r.get('unit'), qty)
        if exp:
            checked[r['src']] += 1
            if abs(float(r['price']) - exp) > UNIT_TOL * max(float(r['price']), exp) and not explained(float(r['price']) / exp, qty, qtext):
                doubt = round(exp, 2)
                doubtful.append((ret, ray, r['src'], r.get('name') or r.get('title'), r['price'], r.get('unit'), doubt))
    promo = r.get('promo')
    if promo and re.fullmatch(r'\s*cagnott[ée]s\s*', promo, re.I):
        promo = None
    items.append({
        'doubt': doubt,
        'ret': ret, 'ray': ray, 'rid': f"{ret}:{rid}", 'brand': brand, 'label': label, 'fmt_raw': fmt,
        'qty': qty, 'rolls': rolls, 'lav': lav, 'price': round(float(r['price']), 2), 'was': r.get('was'),
        'promo': promo, 'url': url, 'ean': ean, 'ts': r['ts'], 'src': r['src'], 'pos': r['pos'],
        'full': r.get('name') or r.get('title'),
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
    if age <= CARRY_MAX_DAYS:
        carried.append(dict(it, carried=True))
items += carried

# un même produit d'une enseigne : garder la lecture la plus récente
best = {}
for it in items:
    k = it["rid"]
    if k not in best or it["ts"] > best[k]["ts"]:
        best[k] = it
items = [it for it in best.values() if not lib.hors_courses(it.get("label") or "") and not lib.hors_rayon(it["ray"], (it.get("label") or "") + " " + (it.get("fmt_raw") or ""))]

pages = lib.load_sources()["pages"]
report = {"date": today.strftime("%Y-%m-%d"), "pages": [], "rayons": {}}
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
print("sans marque reconnue", len(unbranded))
for u in unbranded[:30]:
    print("   ", u)
for ret, ray, url, n, n0, l, l0 in rejected:
    print(f"lecture écartée (moins complète que la précédente : {n} produits dont {l} avec lien, contre {n0} dont {l0}) : {ret} {ray} {url}")
for ret, ray, src, name, price, unit, exp in doubtful:
    print(f"prix douteux, prix précédent gardé : {ret} {ray} {name} lu {price} € mais {unit} donne {exp} €" + (" (page entière écartée)" if page_key(src) in bad_pages else ""))
if fails:
    print("pages sans produit cette fois :")
    for p in fails:
        print("   ", p["retailer"], p["rayon"], p["url"], "(non lue)" if not p["read"] else "(écartée)" if p["rejected"] else "(réponse vide)")
