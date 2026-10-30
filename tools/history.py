"""Historique des prix.

À chaque publication (tools/publish.sh, après make_catalog.py), compare le catalogue déjà publié (HEAD) au nouveau
catalogue et ajoute à data/history.json chaque prix qui a changé, avec sa date de relevé. Seuls les prix relevés
comptent, jamais les offres simulées. Un produit dont le prix n'a jamais changé n'y figure pas : son prix est celui
du catalogue.

Format compact : {"d": ["2026-10-29", ...], "p": {identifiant: {enseigne: [[indice de date, prix], ...]}}}
Usage : python3 tools/history.py
"""
import json
import os
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, 'data', 'history.json')

new = json.load(open(os.path.join(ROOT, 'data', 'catalog.json'), encoding='utf-8'))
meta = json.load(open(os.path.join(ROOT, 'data', 'meta.json'), encoding='utf-8'))
try:
    old = json.loads(subprocess.check_output(['git', 'show', 'HEAD:data/catalog.json'], cwd=ROOT, stderr=subprocess.DEVNULL))
except Exception:
    old = None

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
    aliases = new.get('aliases', {})
    prev = {}
    for p in old['products']:
        pid = aliases.get(p['id'], p['id'])
        for ret, o in p['offers'].items():
            if not o.get('sim'):
                prev[(pid, ret)] = (o['price'], o.get('at') or meta.get('updatedAt'))
    for p in new['products']:
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

days = sorted({d for offers in hist.values() for pts in offers.values() for d, _ in pts})
ix = {d: i for i, d in enumerate(days)}
out = {'d': days, 'p': {pid: {ret: [[ix[d], price] for d, price in pts] for ret, pts in offers.items()} for pid, offers in hist.items()}}
json.dump(out, open(PATH, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('historique :', changed, 'prix modifiés,', len(hist), 'produits suivis')
