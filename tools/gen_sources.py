"""Régénère la clé pages de tools/sources.json à partir de tools/rayons.json, et les lots de lecture tools/lots/<lot>.md.

Les autres clés (about, robot, robot_note, magasins, magasins_note, ignore) sont gardées telles quelles.
Une entrée par page, dans l'ordre des rayons puis des enseignes :
- Monoprix : page de catégorie, match = les 8 premiers caractères de l'UUID (ou l'UUID d'un /products?sublocationId=),
  prompt Monoprix (tableau JSON name/format/price/was/unit/promo/url) ;
- Carrefour : page /r/... ou /boutique/..., match = le chemin après le domaine, prompt Carrefour (tableau JSON
  title/format/price/unit/promo/href) avec un exemple de format propre au rayon ;
- Houra : URL directe (match = B<code>) ou découverte (url et match vides, from et find), prompt Houra ;
- Auchan : une seule entrée par requête avec "retailer": "auchan*" ; lib.load_sources() la déplie pour chaque magasin et
  zone de la clé magasins (fragment #alesia, #livraison-perreux... ajouté à l'url et au match ; tools/scrape.js fait de même).
Chaque page porte aussi regimes (copie du rayon) et lot (lot de lecture de son univers, lib.LOTS).
Usage : python3 tools/gen_sources.py
"""
import json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

PROMPT_MONOPRIX = ('Return ONLY a JSON array, no other text. One object per product listed on the page, in page order: {"name": full product name '
                   'exactly as written (brand + name), "format": pack size text as written (e.g. "6 x 1,5 L"), "price": current price as a number in '
                   'euros, "was": previous crossed-out price as number or null, "unit": price per unit text as written (e.g. "0,25 €/l") or null, '
                   '"promo": promotion text or null, "url": absolute product page URL or null}. Include every product on the page, do not skip any.')
PROMPT_CARREFOUR = ('Return ONLY a JSON array, no other text, one object per product tile in page order: {"title": product title exactly as written '
                    '(or the image alt text if no title), "format": the packaging/format line exactly as written (e.g. {exemple}), "price": price as '
                    'number in euros, "unit": price per {unite} text, "promo": promotion text or null, "href": product link path starting with /p/ or null}.')
PROMPT_HOURA = ('Return ONLY a JSON object, no other text: {"products": [one object per product listed on the page, in page order: {"name": full '
                'product name exactly as written (brand + name + format), "price": current price as number in euros, "was": crossed-out price or '
                'null, "promo": promotion text or null, "url": absolute product page URL or null}], "next_page": URL of the next page or null}.')

# Exemple de ligne de conditionnement Carrefour et unité du prix au kilo ou au litre, d'après l'icône et l'unité du rayon.
EXEMPLE_ICONE = {
    'tray': ('"la barquette de 500g"', 'kg'), 'net': ('"le sachet de 1kg", "la pièce"', 'kg'), 'wedge': ('"la pièce de 250g"', 'kg'),
    'tub': ('"le pot de 150g"', 'kg'), 'brick': ('"la brique de 1L"', 'litre'), 'carton': ('"la brique de 1L"', 'litre'),
    'bottle': ('"la bouteille de 1L"', 'litre'), 'can': ('"la canette de 33cl", "le pack de 6 canettes de 33cl"', 'litre'),
    'pack': ('"le pack de 6 bouteilles de 1,5L"', 'litre'), 'tin': ('"la boîte de 400g"', 'kg'), 'jar': ('"le pot de 370g"', 'kg'),
    'bag': ('"le sachet de 500g"', 'kg'), 'box': ('"la boîte de 300g"', 'kg'), 'tube': ('"le tube de 75ml"', 'litre'),
    'flacon': ('"le flacon de 250ml"', 'litre'), 'spray': ('"le spray de 500ml"', 'litre'), 'sack': ('"le paquet de 1kg"', 'kg'),
    'rolls': ('"les 12 rouleaux"', 'unit'), 'eggs': ('"la boîte de 12 œufs", "12 œufs"', 'unit'), 'cup': ('"les 4 pots de 125g"', 'kg'),
    'cake': ('"le sachet de 250g"', 'kg'), 'jug': ('"le bidon de 2L", "40 lavages"', 'litre or per lavage'),
}
EXEMPLE_UNITE = {
    'couche': ('"le paquet de 44 couches"', 'unit'), 'capsule': ('"la boîte de 10 capsules"', 'unit'),
    'lavage': ('"le bidon de 2L", "40 lavages"', 'litre or per lavage'), 'piece': ('"le lot de 2", "la boîte de 100"', 'unit'),
    'oeuf': ('"la boîte de 12 œufs", "12 œufs"', 'unit'), 'rouleau': ('"les 12 rouleaux"', 'unit'),
}
EXEMPLE_RAYON = {
    'eaux': ('"le pack de 6 bouteilles de 1,5L", "La bouteille de 1,25L"', 'litre/kg'), 'beurre': ('"la plaquette de 250g"', 'kg'),
    'yaourts': ('"les 4 pots de 125g"', 'kg'), 'pates': ('"le paquet de 500g"', 'kg'), 'cafe': ('"le paquet de 250g", "les 2 paquets de 250g"', 'kg'),
    'riz': ('"le paquet de 1kg", "les 4 sachets de 125g"', 'kg'), 'thon': ('"la boîte de 140g"', 'kg'), 'conserves': ('"la boîte de 135g"', 'kg'),
    'tomates': ('"la boîte de 400g"', 'kg'), 'vaisselle': ('"le flacon de 750mL"', 'litre'), 'fromages': ('"le sachet de 200g"', 'kg'),
    'vin-rouge': ('"la bouteille de 75cl"', 'litre'), 'vin-blanc': ('"la bouteille de 75cl"', 'litre'), 'vin-rose': ('"la bouteille de 75cl"', 'litre'),
    'champagne': ('"la bouteille de 75cl"', 'litre'), 'spiritueux': ('"la bouteille de 70cl"', 'litre'), 'aperitifs': ('"la bouteille de 1L"', 'litre'),
    'bieres': ('"la bouteille de 75cl", "le pack de 6 bouteilles de 25cl"', 'litre'), 'fruits': ('"le sachet de 1kg", "la pièce"', 'kg'),
    'legumes': ('"la barquette de 500g", "le kg", "la pièce"', 'kg'), 'volaille': ('"la barquette de 2 pièces", "le filet de 1kg"', 'kg'),
    'boeuf': ('"la barquette de 2 pièces de 300g"', 'kg'), 'poissons': ('"la barquette de 2 pavés de 150g"', 'kg'),
}


def carrefour_prompt(r):
    ex, unite = EXEMPLE_RAYON.get(r['id']) or EXEMPLE_UNITE.get(r.get('unite') or '') or EXEMPLE_ICONE.get(r['icone'], ('"le paquet de 500g"', 'kg'))
    return PROMPT_CARREFOUR.replace('{exemple}', ex).replace('{unite}', unite)


def main():
    path = os.path.join(lib.TOOLS, 'sources.json')
    src = json.load(open(path, encoding='utf-8'))
    pages = []
    seen = set()
    for r in lib.RAYONS:
        base = {'rayon': r['id'], 'regimes': r.get('regimes') or [], 'lot': lib.LOT_OF[r['univers']]}
        pg = r['pages']
        for url in pg.get('monoprix') or []:
            m = re.search(r'([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', url)
            match = m.group(0) if '/products?' in url else (m.group(1) if m else url.split('monoprix.fr')[1])
            pages.append({'retailer': 'monoprix', **base, 'host': 'courses.monoprix.fr', 'match': match, 'url': url, 'prompt': PROMPT_MONOPRIX})
        for url in pg.get('carrefour') or []:
            pages.append({'retailer': 'carrefour', **base, 'host': 'carrefour.fr', 'match': url.split('carrefour.fr/')[1], 'url': url, 'prompt': carrefour_prompt(r)})
        for h in pg.get('houra') or []:
            if isinstance(h, str):
                m = re.search(r'-(B\d+)-\d+\.html$', h)
                pages.append({'retailer': 'houra', **base, 'host': 'houra.fr', 'match': m.group(1), 'url': h, 'prompt': PROMPT_HOURA})
            else:
                pages.append({'retailer': 'houra', **base, 'host': 'houra.fr', 'match': '', 'url': '', 'from': h['from'], 'find': h['find'], 'prompt': PROMPT_HOURA})
        a = pg.get('auchan')
        for q in ([a] if isinstance(a, str) else a or []):
            pages.append({'retailer': 'auchan*', **base, 'host': 'auchan.fr', 'match': q, 'url': 'https://www.auchan.fr/recherche?' + q, 'prompt': ''})
    for p in pages:
        k = (p['retailer'], p['rayon'], p['url'] or json.dumps(p.get('find')))
        assert k not in seen, k
        seen.add(k)
    # repères uniques par enseigne (une même page peut servir plusieurs rayons, pas deux pages un même repère)
    for ret in ('monoprix', 'carrefour', 'houra'):
        by_match = {}
        for p in pages:
            if p['retailer'] == ret and p['match']:
                assert by_match.setdefault(p['match'], p['url']) == p['url'], (ret, p['match'])
    src['pages'] = pages
    src['pages_note'] = ("Clé pages écrite par tools/gen_sources.py depuis tools/rayons.json : ne pas l'éditer à la main. Les requêtes Auchan "
                         "(retailer auchan*) sont dépliées par lib.load_sources() et tools/scrape.js pour chaque magasin et zone de la clé magasins. "
                         "lot : lot de lecture de l'univers (frais-1, frais-2, frais-3, epicerie-1, epicerie-2, boissons, bebe-hygiene, maison, regimes-monde).")
    json.dump(src, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    n = {}
    for p in pages:
        n[p['retailer']] = n.get(p['retailer'], 0) + 1
    print('tools/sources.json :', len(pages), 'pages', n)
    write_lots(src)


def write_lots(src):
    """tools/lots/<lot>.md : les pages Monoprix et Carrefour de chaque lot, avec l'url et le prompt exacts, texte prêt pour
    une tâche planifiée (WebFetch ne lit que les adresses citées dans la conversation)."""
    robot = src.get('robot') or {}
    lots = os.path.join(lib.TOOLS, 'lots')
    os.makedirs(lots, exist_ok=True)
    for lot, univ in lib.LOTS.items():
        mine = [p for p in src['pages'] if robot.get(p['retailer']) is False and p['lot'] == lot]
        names = ', '.join(lib.UNIVERS_NAME[u] for u in univ)
        lines = [f"# Lot {lot} : {names}", '',
                 f"Relevé Monoprix et Carrefour du lot {lot} ({len(mine)} pages). Suivre CLAUDE.md, « Mettre à jour les prix » : "
                 f"`python3 tools/dump.py --reset --lot {lot}` (ou `--list --lot {lot}` pour la liste seule) ; lire chaque page avec WebFetch, "
                 f"avec exactement l'url et le prompt ci-dessous, par séries de 7 ; `python3 tools/dump.py --lot {lot}` après chaque série ; "
                 f"relire une fois les pages encore sans lecture ; `bash tools/publish.sh claude` à la fin.", '']
        for p in mine:
            lines.append(f"- {lib.RAYON_BY_ID[p['rayon']]['nom']} ({p['retailer']}) : {p['url']}")
            lines.append(f"  prompt : {p['prompt']}")
        with open(os.path.join(lots, lot + '.md'), 'w', encoding='utf-8') as fh:
            fh.write('\n'.join(lines) + '\n')
    print('tools/lots :', len(lib.LOTS), 'lots')


if __name__ == '__main__':
    main()
