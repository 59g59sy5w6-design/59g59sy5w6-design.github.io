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


def page_key(url):
    return (url or "").split("?")[0].split("#")[0].rstrip("/")


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
        url = r.get('url')
        ean = None
        if ret == 'houra':
            # "Brand Label, 6x1,5L"
            if ', ' in label:
                lab, _, tail = label.rpartition(', ')
                if parse_qty(tail) or parse_rolls(tail) or re.search(r'\d', tail):
                    label, fmt = lab.strip(), tail.strip()
            rid = (re.search(r'/(\d+)/?$', url or '') or [None, key(name)])[1]
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
    else:
        if ret == 'monoprix':
            qty = parse_qty(r.get('name')) or parse_qty(fmt)
        else:
            qty = parse_qty(fmt) or parse_qty(r.get('name') or r.get('title'))
        if ray == 'lessive':
            lav = parse_lavages(qtext)
    items.append({
        'ret': ret, 'ray': ray, 'rid': f"{ret}:{rid}", 'brand': brand, 'label': label, 'fmt_raw': fmt,
        'qty': qty, 'rolls': rolls, 'lav': lav, 'price': round(float(r['price']), 2), 'was': r.get('was'),
        'promo': r.get('promo'), 'url': url, 'ean': ean, 'ts': r['ts'], 'src': r['src'], 'pos': r['pos'],
        'full': r.get('name') or r.get('title'),
    })

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
items = list(best.values())

pages = lib.load_sources()["pages"]
report = {"date": today.strftime("%Y-%m-%d"), "pages": [], "rayons": {}}
for p in pages:
    k = page_key(p["url"])
    report["pages"].append({"retailer": p["retailer"], "rayon": p["rayon"], "url": p["url"], "read": k in read_pages, "products": ok_pages.get(k, 0),
                            "rejected": any(page_key(r[2]) == k for r in rejected)})
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
if fails:
    print("pages sans produit cette fois :")
    for p in fails:
        print("   ", p["retailer"], p["rayon"], p["url"], "(non lue)" if not p["read"] else "(écartée)" if p["rejected"] else "(réponse vide)")
