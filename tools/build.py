"""Normalise les produits relevés : marque, désignation, contenance, prix, rayon, régimes.

Entrée : tools/work/fetches.json (tools/dump.py ou tools/scrape.js) et tools/state/items.json (relevé précédent) ;
les pages Houra trouvées par le robot ce passage (tools/work/discovered.json) sont d'abord fusionnées dans
tools/state/discovered.json, que lib.route lit. Chaque page est reconnue par l'adresse demandée ; l'adresse finale
(après redirection, notée par le robot) sert de secours et les pages redirigées sont listées pour tools/rayons.json.
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


def place(label, rays, old=None, check=None):
    """Rayon d'un produit lu sur une page servant les rayons rays : les rayons filtrés qui l'acceptent, sinon le rayon
    aux pages dédiées (lib.RAYON_DEDIE : sans filtre, ou filtre au « oui » vide) que son « non » n'écarte pas ; à défaut,
    et seulement avec old (produit déjà rangé dans le rayon old au relevé précédent, qu'un filtre resserré écarte), le
    rayon qui accepte le produit et nomme en entier un des mots qui l'ont écarté (lib.covers : « capsule » exclu du café
    désigne le rayon capsules, « soupe » exclu des animaux le rayon soupes, « liquide vaisselle » exclu des vinaigres le
    rayon vaisselle, mais « pied de poule » ne désigne pas le rayon volaille), du plus long au plus court, d'abord dans
    l'univers de old puis dans les autres ; sinon un rayon filtré du même univers qui l'accepte. Un rayon aux pages
    dédiées, qui accepte tout ce que son « non » n'écarte pas, ne reprend un produit que si sa recherche est dans le nom.
    Avant les mots d'exclusion, le rayon que nomme une expression « vers » du filtre de old, puis de ceux de rays
    (lib.vers_rayon : un plat cuisiné écarté du rayon bœuf va aux plats cuisinés frais, sinon surgelés, sinon en conserve).
    Avec check (le nom sans la marque d'un produit repris, celui du filtre final), le rayon doit accepter les deux noms :
    sans quoi un rayon qui ne reconnaît le produit que par sa marque (« Oriental Viandes ») le prenait, puis le filtre final
    l'écartait. None quand aucun rayon ne le prend."""
    def refuse(r):
        return lib.hors_rayon(r, label) or (check is not None and lib.hors_rayon(r, check))
    ok = [r for r in rays if r in lib.RAYON_FILTRE and r not in lib.RAYON_DEDIE and not refuse(r)]
    if not ok:
        ok = [r for r in rays if r in lib.RAYON_DEDIE and not refuse(r)]
    if not ok and old:
        for r in dict.fromkeys([old] + list(rays)):
            dest = lib.vers_rayon(r, label, check)
            if dest:
                return dest
        univers = lib.RAYON_BY_ID[old]['univers']
        def taker(r):
            if r == old or refuse(r):
                return False
            return bool(lib.precision(r, label)) if r in lib.RAYON_DEDIE else r in lib.RAYON_FILTRE
        takers = [r['id'] for r in lib.RAYONS if taker(r['id'])]
        ok = [r for r in takers if lib.RAYON_BY_ID[r]['univers'] == univers and r not in lib.RAYON_DEDIE]
        for word in lib.filtre_exclus(old, label):
            named = [r for r in takers if lib.covers(r, word.strip(), label)]
            if named:
                ok = [r for r in named if lib.RAYON_BY_ID[r]['univers'] == univers] or named
                break
    return lib.best_rayon(ok, label) if ok else None


def measure(ret, ray, fmt, full, label):
    """Contenance d'une fiche d'après son conditionnement (fmt) et son nom lu (full) : qty {n, v, u}, qty_alt (l'autre
    contenance écrite : poids égoutté d'une conserve, « 0,456 L » d'une bouteille de 50 cl), rolls (rouleaux, œufs, couches,
    capsules, pièces), lav (lavages), pcs (mot qui compte les pièces), approx (poids indicatif, prix ajusté à la pesée).
    Appliquée aussi aux produits repris du relevé précédent, pour qu'une règle corrigée vaille sans attendre une relecture."""
    qtext = ' '.join(x for x in [fmt, full or ''] if x)
    qty = qty_alt = rolls = lav = pcs = None
    approx = False
    unite = lib.RAYON_UNITE.get(ray)
    if unite == 'rouleau':
        # des lingettes (papier toilette humide) ne se comptent pas en rouleaux : « x50 » est leur nombre
        rolls = None if re.search(r'\blingettes?\b', key(qtext)) else (parse_rolls(fmt) or parse_rolls(full))
    elif unite == 'oeuf':
        # boîte de 6, 10, 12 œufs : compté à l'œuf, comme les rouleaux de papier
        rolls = parse_oeufs(fmt) or parse_oeufs(full)
    else:
        if ret == 'monoprix':
            qty, qty_alt = parse_qty(full) or parse_qty(fmt), parse_qty(fmt)
        else:
            qty, qty_alt = parse_qty(fmt) or parse_qty(full), parse_qty(full)
        if unite == 'lavage':
            lav = parse_lavages(qtext)
        elif unite:
            # couches, capsules, pièces : le nombre compte, la contenance en grammes reste informative
            p = parse_pieces(fmt, unite) or parse_pieces(full, unite)
            if p:
                rolls, pcs = p
        if not qty and re.search(r'\b(?:le|au) (?:kg|kilo)\b', key(qtext)):
            # vendu au poids (« Tomate grappe, le kg ») : le prix affiché est celui du kilo
            qty = {'n': 1, 'v': 1000.0, 'u': 'g'}
        if not qty and ray in lib.RAYON_FRAIS:
            # frais vendu à la pièce sans poids écrit : poids de référence (PIECE_WEIGHT), contenance approximative ;
            # un lot (« Lot de 4 », « 6 pièces », « Barquette de 4 fruits ») compte ses pièces
            g = lib.piece_weight(label)
            if g:
                m = re.search(r'(?:lot de|x)\s*(\d+)\b|(\d+)\s*(?:pi[eè]ces|fruits|l[ée]gumes)\b', qtext.lower())
                n = int(m.group(1) or m.group(2)) if m else 1
                qty, approx = {'n': n if 1 <= n <= 24 else 1, 'v': float(g), 'u': 'g'}, True
        if qty and re.search(r'\b(?:environ|env|approx)\b', key(qtext)):
            # poids écrit à titre indicatif (« 1,2 kg environ », « la pièce de 300 g env. ») : prix ajusté à la pesée
            approx = True
            m = re.search(r'\b(\d+)\s*pi[eè]ces\b', qtext.lower())
            if qty['n'] == 1 and m and 2 <= int(m.group(1)) <= 24:
                # « 2 pièces - environ 300g » : le poids est celui des deux pièces
                n = int(m.group(1))
                qty = {'n': n, 'v': float(round(qty['v'] / n)), 'u': qty['u']}
    return {'qty': qty, 'qty_alt': qty_alt, 'rolls': rolls, 'lav': lav, 'pcs': pcs, 'approx': approx}


def full_label(it):
    """Désignation et contenance, pour le filtre final (hors_rayon) : sans la marque, comme avant."""
    return (it.get("label") or "") + " " + (it.get("fmt_raw") or "")


def route_label(it):
    """Nom lu chez l'enseigne et contenance, pour choisir le rayon d'un produit repris : le même texte que pour une
    lecture du jour (place sur le nom brut de la page)."""
    return (it.get("full") or it.get("label") or "") + " " + (it.get("fmt_raw") or "")


F_PATH = os.path.join(lib.WORK, "fetches.json")
F = json.load(open(F_PATH, encoding="utf-8")) if os.path.exists(F_PATH) else []
# pages Houra trouvées par le robot ce passage : fusionnées dans tools/state/discovered.json avant de reconnaître les pages
D_PATH = os.path.join(lib.WORK, "discovered.json")
if os.path.exists(D_PATH):
    lib.merge_discovered(json.load(open(D_PATH, encoding="utf-8")))


def page_id(url):
    """Ce qui identifie une page : chez Houra, le code et le numéro (« B1557897-2 », le chemin est décoratif) ;
    ailleurs, l'adresse sans requête ni fragment."""
    m = re.search(r"-(B\d+-\d+)\.html", (url or "").split("?")[0])
    return m.group(1) if m else (url or "").split("?")[0].split("#")[0].rstrip("/")


# pages de la liste redirigées par le site vers un autre code (adresse finale notée par le robot) : à remplacer dans
# tools/rayons.json par la page actuelle ; les pages suivantes d'un rayon suivent la page redirigée et ne sont pas listées
listed = {page_key(p["url"]) for p in lib.load_sources()["pages"] if p.get("url")} | {page_key(d["url"]) for d in lib.load_discovered() if d.get("url")}
redirected = {f["url"]: f["final"] for f in F if f.get("final") and page_key(f["url"]) in listed and page_id(f["final"]) != page_id(f["url"])}
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
# articles des vendeurs de la place de marché gardés par un relevé d'avant la règle (lib.place_de_marche) : pas repris
prev = [it for it in prev if not lib.place_de_marche(it["ret"], it.get("url"))]
prev_by_page = collections.defaultdict(list)
for it in prev:
    prev_by_page[page_key(it["src"])].append(it)

raw, ok_pages, read_pages, rejected = [], collections.Counter(), set(), []
for f in F:
    # la page est reconnue par l'adresse demandée, à défaut par l'adresse finale notée par le robot
    rs = lib.routes(f["url"]) or (lib.routes(f["final"]) if f.get("final") else [])
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
        # page partagée par plusieurs rayons : le rayon filtré qui accepte le produit, sinon le rayon sans filtre ; à défaut,
        # le premier rayon de la page, comme sur une page d'un seul rayon : un produit connu de l'état que les filtres ont
        # envoyé dans un autre rayon (câpres au vinaigre lues avec les vinaigres et les moutardes) y reste (son rayon
        # d'avant, plus bas), un produit inconnu est écarté par le filtre final ; sans quoi sa relecture le faisait disparaître
        ray = rays[0] if len(rays) == 1 else (place(label, rays) or rays[0])
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
        if lib.place_de_marche(ret, href):
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
            # « Marque Désignation, 6x1,5L » ; au poids variable, « Désignation, la pièce », « ..., le kg », « ..., la botte »
            if ', ' in label:
                lab, _, tail = label.rpartition(', ')
                if parse_qty(tail) or parse_rolls(tail) or re.search(r'\d', tail) or re.match(r'(?:la|le|les)\s+(?:pi[eè]ces?|kg|kilo|botte|filet|barquette|sachet|lot|demi)\b', tail.lower()):
                    label, fmt = lab.strip(), tail.strip()
            rid = (re.search(r'/(\d+)/?$', url or '') or [None, key(name)])[1]
        elif ret.startswith('auchan'):
            # offre d'un vendeur de la place de marché (« /pr-174cb6db-... ») : livrée à part, pas une course Auchan ; son
            # code n'est pas une référence Auchan, et sa tête (« 174 ») donnait le même identifiant à des articles différents
            if lib.place_de_marche(ret, url):
                continue
            rid = (re.search(r'/pr-(C\d+)', url or '') or [None, key(name)])[1]
        else:
            rid = (re.search(r'(MPX_\d+)', url or '') or [None, key(name)])[1]
        if not brand:
            unbranded.append((ret, ray, name))
            brand = 'Sans marque'
    # strip a trailing format from the label (Monoprix keeps it in the name)
    label = re.sub(r'(?:^|[\s,]+)(?:le pack de |la bouteille de |les? |lot de )?(?<![\d.,])\d+(?:[.,]\d+)?\s*(?:x\s*\d+(?:[.,]\d+)?\s*)?(?:kg|g|cl|ml|l)\b\.?$', '', label, flags=re.I).strip(' ,-')
    label = re.sub(r'\s+x\s*\d+$', '', label).strip(' ,-')
    label = label[:1].upper() + label[1:] if label else label
    full = r.get('name') or r.get('title')
    qtext = ' '.join(x for x in [fmt, full or ''] if x)
    mz = measure(ret, ray, fmt, full, label)
    qty, qty_alt, rolls, lav, pcs, approx = mz['qty'], mz['qty_alt'], mz['rolls'], mz['lav'], mz['pcs'], mz['approx']
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

# produit repris : son rayon suit les règles du jour (page partagée, filtres), comme s'il venait d'être relu. L'état ne
# garde que la dernière page où il a été lu (src) ; lu ce jour-là sur plusieurs pages (« semoule » et « couscous »), il est
# resté dans le rayon le plus ordinaire (lib.best_rayon), gardé dans ray. Les deux comptent donc : le rayon de sa page,
# rangé comme à la lecture (place sur une page partagée), et le rayon gardé ; best_rayon départage ceux dont le filtre
# l'accepte encore. Avec la page seule, chaque relevé d'un autre magasin le faisait passer au rayon de sa dernière page
# (une semoule au rayon oriental, des céréales au rayon bébé), ou l'écartait. Un filtre resserré qui l'écarte des deux
# l'envoie dans le rayon qui l'accepte (place avec old : fromage blanc lu sous « yaourts »), sinon l'écarte.
# Une lecture du jour que le filtre de sa page écarte suit la même règle quand le produit est connu de l'état (old : son
# rayon au relevé précédent) : sans quoi chaque produit déplacé par un filtre resserré disparaissait à la relecture de sa
# page (des chiffonnades lues sous « apéritif frais », une pince à épiler lue sous « maquillage »). Un produit inconnu de
# l'état reste écarté par le filtre final. Un produit qui change de rayon perd les étiquettes de régime que l'ancien rayon
# lui donnait : un plat aux lardons sorti du traiteur végétal n'est plus vegan.
moved = collections.Counter()
kept = []
for it in items:
    if it['ray'] not in lib.RAYON_BY_ID:
        continue
    label = route_label(it)
    rays = [ry for rt, ry in lib.routes(it['src']) if rt == it['ret']]
    if it.get('carried'):
        old = it['ray']
        page = (rays[0] if len(rays) == 1 else place(label, rays, check=full_label(it))) if rays else None
    else:
        prev_it = prev_by_rid.get(it['rid'])
        if not lib.hors_rayon(it['ray'], full_label(it)) or not prev_it or prev_it['ray'] not in lib.RAYON_BY_ID:
            kept.append(it)
            continue
        old, page = prev_it['ray'], it['ray']
    # le rayon que nomme le filtre de old pour ce qu'il écarte (« vers ») compte comme old : un délice de dinde lu aussi sur
    # la recherche « halal » va au rayon jambon blanc et blanc de volaille, plus ordinaire, avec ses lectures des autres magasins
    cands = [page, old] + ([lib.vers_rayon(old, label, full_label(it))] if lib.hors_rayon(old, full_label(it)) else [])
    ok = [r for r in dict.fromkeys(cands) if r and not lib.hors_rayon(r, full_label(it))]
    ray = lib.best_rayon(ok, label) if ok else place(label, rays or [old], old, full_label(it))
    if ray is None:
        continue
    regimes = set(it.get('regimes') or [])
    if ray != it['ray']:
        moved[(it['ray'], ray)] += 1
        regimes -= set(lib.RAYON_BY_ID[it['ray']].get('regimes') or [])
        it['ray'] = ray
    it['regimes'] = sorted(regimes | set(lib.RAYON_BY_ID[ray].get('regimes') or []))
    kept.append(it)
items = kept

# Produit repris du relevé précédent : sa contenance est celle de sa lecture. Deux règles corrigées depuis valent sans
# attendre une relecture : des lingettes (papier toilette humide) comptées en rouleaux (« x50 » : 0,05 € le « rouleau »), et
# un lot de produits frais lu comme une seule pièce (« Colis de 2 kilos », « Barquette de 4 fruits » : 170 g au lieu de 2 kg,
# 42,94 € le kilo au lieu de 3,65 € ; « 2 pièces - environ 300g » affiché « la pièce »). Les autres contenances restent
# celles lues : les règles de lecture ont changé depuis pour d'autres produits, qu'une relecture remettra à jour.
requalified = []
for it in items:
    if not it.get('carried'):
        continue
    mz = measure(it['ret'], it['ray'], it.get('fmt_raw') or '', it.get('full'), it.get('label') or '')
    if lib.RAYON_UNITE.get(it['ray']) == 'rouleau' and it.get('rolls') and mz['rolls'] is None:
        requalified.append((it['rid'], it.get('full'), f"{it['rolls']} rouleaux", 'sans compte'))
        it['rolls'] = None
    q, nq, g = it.get('qty'), mz['qty'], lib.piece_weight(it.get('label') or '')
    # lot lu comme une pièce : poids de référence d'une pièce (q vaut PIECE_WEIGHT), ou poids du lot écrit pour une pièce
    lot = bool(q and nq and nq != q and q.get('n') == 1 and (q.get('v') == g or (nq['n'] > 1 and abs(nq['n'] * nq['v'] - q['v']) <= nq['n'])))
    if it.get('approx') and lot:
        requalified.append((it['rid'], it.get('full'), q, mz['qty']))
        it['qty'], it['approx'] = mz['qty'], mz['approx'] or None

# un même produit d'une enseigne lu dans plusieurs rayons : il reste dans le rayon le plus ordinaire (lib.best_rayon),
# avec la lecture la plus récente et les étiquettes de régime de tous les rayons où il a été lu
by_rid = collections.defaultdict(list)
for it in items:
    by_rid[it["rid"]].append(it)
items, multi_rayon = [], {}
for rid, lst in by_rid.items():
    best = max(lst, key=lambda it: it["ts"])
    rays = {it["ray"] for it in lst}
    # seules comptent les lectures que le filtre de leur rayon accepte : une lecture écartée (produit inconnu de l'état lu
    # sur une page qui ne le prend pas) ne fait ni perdre le produit ni ne lui donne les étiquettes de régime de sa page
    good = [it for it in lst if not lib.hors_rayon(it["ray"], full_label(it))] or lst
    if len(rays) > 1:
        multi_rayon[rid] = sorted(rays)
        best = dict(best, ray=lib.best_rayon({it["ray"] for it in good}, route_label(best)))
    best["regimes"] = sorted({x for it in good for x in it.get("regimes") or []})
    items.append(best)
items = [it for it in items if not lib.hors_courses(it.get("label") or "") and not lib.hors_rayon(it["ray"], full_label(it))]

pages = lib.load_sources()["pages"]
# une page à découvrir (réglages from et find, sans url) est comptée à l'adresse que le robot lui a trouvée
disc_url = {lib.discovered_key(d): d["url"] for d in lib.load_discovered() if d.get("url")}
report = {"date": today.strftime("%Y-%m-%d"), "pages": [], "rayons": {}, "multi_rayon": multi_rayon,
          "deplaces": {f"{a} -> {b}": n for (a, b), n in sorted(moved.items())}, "redirections": redirected}
for p in pages:
    url = p["url"] or disc_url.get(lib.discovered_key(p), "")
    k = page_key(url)
    report["pages"].append({"retailer": p["retailer"], "rayon": p["rayon"], "url": url, "read": bool(k) and k in read_pages, "products": ok_pages.get(k, 0),
                            "rejected": any(page_key(r[2]) == k for r in rejected) or k in bad_pages,
                            "doubtful": sum(n for src, n in doubt_by_page.items() if page_key(src) == k),
                            **({"final": redirected[url]} if url in redirected else {})})
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
for rid, name, a, b in requalified:
    print(f"   contenance corrigée sans relecture : {rid} {name} : {a} -> {b}")
print("sans marque reconnue", len(unbranded), "(liste complète dans tools/work/unbranded.json)")
json.dump(unbranded, open(os.path.join(lib.WORK, "unbranded.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=0)
for u in unbranded[:30]:
    print("   ", u)
for ret, ray, url, n, n0, l, l0 in rejected:
    print(f"lecture écartée (moins complète que la précédente : {n} produits dont {l} avec lien, contre {n0} dont {l0}) : {ret} {ray} {url}")
if redirected:
    print("pages redirigées par le site (remplacer l'adresse dans tools/rayons.json par la page actuelle) :", len(redirected))
    for url, final in sorted(redirected.items())[:40]:
        print("   ", url, "->", final)
for ret, ray, src, name, price, unit, exp in doubtful:
    print(f"prix douteux, prix précédent gardé : {ret} {ray} {name} lu {price} € mais {unit} donne {exp} €" + (" (page entière écartée)" if page_key(src) in bad_pages else ""))
if F and fails:
    print("pages sans produit cette fois :", len(fails))
    for p in fails[:40]:
        print("   ", p["retailer"], p["rayon"], p["url"], "(non lue)" if not p["read"] else "(écartée)" if p["rejected"] else "(réponse vide)")
