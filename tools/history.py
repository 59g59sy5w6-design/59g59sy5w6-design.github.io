"""Historique des prix.

À chaque publication (tools/publish.sh, après make_catalog.py), compare le catalogue déjà publié (HEAD) au nouveau
catalogue et ajoute à data/history.json chaque prix qui a changé, avec sa date de relevé. Seuls les prix relevés
comptent, jamais les offres simulées. Un produit dont le prix n'a jamais changé n'y figure pas : son prix est celui
du catalogue. L'historique est plafonné aux MAX_WEEKS dernières semaines et aux MAX_POINTS derniers changements par offre.

Format compact : {"d": ["2026-10-29", ...], "p": {identifiant: {enseigne: [[indice de date, prix], ...]}}}
Usage : python3 tools/history.py
"""
import datetime, json, os, subprocess, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

PATH = os.path.join(lib.DATA, 'history.json')
MAX_WEEKS = 26
MAX_POINTS = 12

new = lib.read_catalog(json.load(open(os.path.join(lib.DATA, 'catalog.json'), encoding='utf-8')))
meta = json.load(open(os.path.join(lib.DATA, 'meta.json'), encoding='utf-8'))
try:
    old_cat = json.loads(subprocess.check_output(['git', 'show', 'HEAD:data/catalog.json'], cwd=lib.ROOT, stderr=subprocess.DEVNULL))
    old = lib.read_catalog(old_cat)
    aliases = json.load(open(os.path.join(lib.DATA, 'catalog.json'), encoding='utf-8')).get('aliases', {})
except Exception:
    old = None
    aliases = {}

# en mémoire : {identifiant: {enseigne: [[date, prix], ...]}}
hist = {}
if os.path.exists(PATH):
    raw = json.load(open(PATH, encoding='utf-8'))
    for pid, offers in raw.get('p', {}).items():
        hist[pid] = {ret: [[raw['d'][i], price] for i, price in pts] for ret, pts in offers.items()}


def add(pid, ret, day, price):
    pts = hist.setdefault(pid, {}).setdefault(ret, [])
    if pts and pts[-1][0] == day:
        pts[-1][1] = price
    elif not pts or abs(pts[-1][1] - price) >= 0.005:
        pts.append([day, price])
        pts.sort(key=lambda x: x[0])


changed = 0
if old:
    prev = {}
    for p in old:
        pid = aliases.get(p['id'], p['id'])
        for ret, o in p['offers'].items():
            if not o.get('sim'):
                prev[(pid, ret)] = (o['price'], o.get('at') or meta.get('updatedAt'))
    for p in new:
        for ret, o in p['offers'].items():
            if o.get('sim'):
                continue
            was = prev.get((p['id'], ret))
            if not was or abs(was[0] - o['price']) < 0.005:
                continue
            day = o.get('at') or meta.get('updatedAt')
            if not hist.get(p['id'], {}).get(ret):
                add(p['id'], ret, was[1], was[0])
            add(p['id'], ret, day, o['price'])
            changed += 1

# plafond : rien de plus vieux que MAX_WEEKS semaines (le dernier point reste, c'est le prix en vigueur), MAX_POINTS points par offre
limit = (datetime.date.today() - datetime.timedelta(weeks=MAX_WEEKS)).isoformat()
for pid in list(hist):
    for ret in list(hist[pid]):
        pts = hist[pid][ret]
        pts = [pt for pt in pts if pt[0] >= limit] or pts[-1:]
        hist[pid][ret] = pts[-MAX_POINTS:]
        if not hist[pid][ret]:
            del hist[pid][ret]
    if not hist[pid]:
        del hist[pid]

days = sorted({d for offers in hist.values() for pts in offers.values() for d, _ in pts})
ix = {d: i for i, d in enumerate(days)}
out = {'d': days, 'p': {pid: {ret: [[ix[d], price] for d, price in pts] for ret, pts in offers.items()} for pid, offers in hist.items()}}
json.dump(out, open(PATH, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('historique :', changed, 'prix modifiés,', len(hist), 'produits suivis')
