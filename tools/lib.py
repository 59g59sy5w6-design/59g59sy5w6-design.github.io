"""Cabas, outils de relevé des prix : fonctions communes.

Normalisation des noms (marque, désignation, contenance), lecture des réponses JSON du relevé,
rayons et univers (tools/rayons.json, source unique), routage d'une page vers son enseigne et son rayon
d'après tools/sources.json.
"""
import datetime, json, re, unicodedata, urllib.parse, collections, sys, os

TOOLS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS)
WORK = os.path.join(TOOLS, "work")
STATE = os.path.join(TOOLS, "state")
DATA = os.path.join(ROOT, "data")

# ---------------------------------------------------------------- catalogue publié (data/catalog.json, v1 ou v2)
# Format v2 (tools/make_catalog.py, contrat lu par app.js) : clés courtes, offres en tableaux [enseigne, centimes, jour, drapeaux],
# dates en jours depuis EPOCH, détails d'affichage (nom chez l'enseigne, lien, promotion, prix barré) dans data/details/<univers>.json.
EPOCH = datetime.date(2026, 1, 1)
FLAG_PROMO, FLAG_SIM, FLAG_CAT, FLAG_WAS = 1, 2, 4, 8


def day_of(iso):
    return (datetime.date.fromisoformat(iso[:10]) - EPOCH).days


def iso_of(day):
    return (EPOCH + datetime.timedelta(days=int(day))).isoformat()


def read_catalog(cat):
    """Les produits d'un catalogue publié, v1 ou v2, dans une même forme : {id, brand, name, format, r, offers: {enseigne:
    {price (euros), at (AAAA-MM-JJ), sim?, promo?, cat?, was?}}}. Sans les noms et liens chez l'enseigne (détails)."""
    if cat.get('v') != 2:
        return cat['products']
    rets = cat['rets']
    out = []
    for p in cat['products']:
        offers = {}
        for idx, cents, day, flags in p['o']:
            o = {'price': cents / 100, 'at': iso_of(day)}
            if flags & FLAG_SIM:
                o['sim'] = True
            if flags & FLAG_PROMO:
                o['promo'] = True
            if flags & FLAG_CAT:
                o['cat'] = True
            if flags & FLAG_WAS:
                o['was'] = True
            offers[rets[idx]] = o
        out.append({'id': p['i'], 'brand': p['b'], 'name': p['n'], 'format': p['f'], 'r': p['r'], 'offers': offers})
    return out


def read_details(root, univers):
    """data/details/<univers>.json : {id: {enseigne: {n, u, p?, w?}}}, ou {} s'il manque."""
    path = os.path.join(root, 'data', 'details', univers + '.json')
    if not os.path.exists(path):
        return {}
    return json.load(open(path, encoding='utf-8')).get('p') or {}


def strip_acc(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')


def key(s):
    s = str(s or '').lower().replace('œ', 'oe').replace('æ', 'ae')
    s = strip_acc(s).replace('’', "'")
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


# Articles hors courses que la recherche d'une enseigne peut mêler à un rayon (vendeurs tiers d'auchan.fr : radiateurs
# pour « eau », distributeurs muraux pour « savon », gants de jardin pour « gants ménage », meubles pour « aquarium »).
# Une eau « avec robinet intégré » reste une eau.
HORS_COURSES = re.compile(r'(^|\s)(radiateur|robinet d arrosage|robinet arrosage|pompe d arrosage|raccord|chauffe eau|recuperateur d eau|seche serviettes'
                          r'|distributeur mural|porte savon|lave main|meuble|etagere|tapis de bain|rideau|aspirateur|tondeuse a gazon|perceuse|visseuse'
                          r'|echelle|carrelage|peinture|lampe|ampoule led e27 lot de 10 pro|jardiniere en bois'
                          # moules à gâteau et papier cuisson lus avec les moules (« moules ») ; pots, couvercles et confituriers
                          # vides avec les confitures ; appareils pour biberons ; ciseaux à herbes ; solutions pour lentilles de contact
                          # (« moule gâteau », « moule 18 cm », « moule 12 muffins », « moule à soufflé ») ; un beurre ou un camembert
                          # « moulé » n'est jamais suivi d'une dimension ni d'un de ces mots
                          r'|moules? (?:a (?:gateaux?|manque|tartes?|tartelettes|mini|cakes?|baguettes?|pain|charniere|savarin|madeleines?|quiches?'
                          r'|patisseries?|financiers?|muffins?|cannele|souffle|quatre quarts|charlotte|kouglof|bundt|brioches?|cupcakes?|donuts?|chocolats?)'
                          r'|en (?:papier|silicone|verre|ceramique|porcelaine)|papier|silicone|cake|gateaux?|pour air ?fryer|\d+ ?cm'
                          r'|\d+ (?:financiers?|tartelettes?|madeleines?|muffins?|canneles?|cupcakes?|empreintes?|cavites?))|lot de \d+ moules|set de \d+ moules'
                          # jouets, coffrets d'activités et ustensiles lus avec des rayons alimentaires (« pâté », « chocolat », « brochettes »,
                          # « couscous », « nectar », « bébé »)
                          r'|pates? a modeler|play ?doh|smartbox|piques? a brochettes?|saladiers?|rapes? (?:a )?legumes|rape electrique|sets? de table'
                          r'|brochettes? (?:en )?(?:bois|bambou|inox|metal)|mini ?cuve|boites? de rangement'
                          # jouets, figurines, vêtements et objets de décoration lus avec « poules » ou « aquarium » (une figurine
                          # en chocolat reste une confiserie)
                          r'|figurines?(?! (?:en )?chocolat)|peluches?(?!.*\bpour (?:chiens?|chats?|chiots?|chatons?)\b)|statuettes?|lego|minecraft|puzzles?(?! a croquer)|schleich|papo|zhu zhu|bitzee|animagic'
                          r'|play figure|set de construction|animal miniature|chaussettes|socquettes|jupes?|blazers?|pied (?:de )?poule'
                          r'|poule a bascule|cul de poule|poulies?'
                          r'|couvercles? pour confitures?|confituriers?|pots? a confiture|pots? confiture en verre'
                          r'|chauffe biberons?|sterilisateur|egouttoir|egoutte biberons?|porte biberons?|housses? de protection|cuiseur vapeur'
                          # appareils, colle et motifs à repasser lus avec « biberon » et « bébé » (la colle à bois en « biberon »)
                          r'|preparateur de biberons|mixeur cuiseur|colle (?:a )?bois|thermocollants?|decor thermo'
                          r'|ciseaux (?:pour|a) herbes|solutions? (?:multifonctions?|pour lentilles)|lentilles de contact|lentilles souples)(\s|$)')


def hors_courses(label):
    k = key(label)
    return bool(HORS_COURSES.search(k)) and not k.startswith('eau ')


# ---------------------------------------------------------------- rayons et univers (tools/rayons.json)
def load_rayons():
    with open(os.path.join(TOOLS, "rayons.json"), encoding="utf-8") as fh:
        return json.load(fh)


_RJ = load_rayons()
# univers dans l'ordre d'affichage : [(id, nom)]
UNIVERS = [(u['id'], u['nom']) for u in _RJ['univers']]
UNIVERS_NAME = dict(UNIVERS)
# rayons dans l'ordre d'affichage : dicts {id, nom, univers, icone, regimes, frais, unite, pages, filtre?, note?}
RAYONS = _RJ['rayons']
RAYON_BY_ID = {r['id']: r for r in RAYONS}
RAYON_ORDER = {r['id']: i for i, r in enumerate(RAYONS)}
# régimes connus : étiquettes normalisées des produits (regimes_of_name) et des rayons de parcours
REGIMES = _RJ['regimes_connus']
assert len(RAYON_BY_ID) == len(RAYONS) and all(r['univers'] in UNIVERS_NAME for r in RAYONS)

# Rayons lus par une recherche ou sur une page partagée : le produit doit en être un (« œufs », pas des pâtes aux œufs ;
# « sucre » en poudre ou en morceaux, pas un bonbon). Le texte comparé est le nom sans accents (key). Un rayon sans
# filtre n'est jamais filtré. Un filtre au « oui » vide (rayon aux pages dédiées : eau plate, jus d'orange, papier toilette,
# lessive liquide...) accepte tout ce que son « non » n'écarte pas (RAYON_DEDIE) ; sa recherche Auchan tient lieu de terme
# « oui » pour départager (precision) et pour reprendre un produit écarté d'un autre rayon (build.place).
# Un filtre peut aussi dire où va ce qu'il écarte (« vers » : [[expression, rayon, rayon...], ...]) : un plat cuisiné lu sur la
# recherche « bœuf » va aux plats cuisinés frais, sinon surgelés, sinon en conserve, le premier de ces rayons qui l'accepte
# (vers_rayon, pour un produit déjà rangé que le filtre écarte : build.place). Chaque expression « vers » écarte aussi le
# produit du rayon, comme le « non », auquel elle est ajoutée.
RAYON_VERS = {r['id']: [(re.compile(v[0]), v[1:]) for v in r['filtre'].get('vers') or []] for r in RAYONS if r.get('filtre')}
RAYON_FILTRE = {r['id']: (r['filtre']['oui'], '|'.join(x for x in [r['filtre']['non']] + [v[0] for v in r['filtre'].get('vers') or []] if x))
                for r in RAYONS if r.get('filtre')}
_RF = {k: (re.compile(a), re.compile(b)) for k, (a, b) in RAYON_FILTRE.items()}
RAYON_DEDIE = {r['id'] for r in RAYONS if not (r.get('filtre') or {}).get('oui')}
assert all(d in RAYON_BY_ID and d != k for k, vs in RAYON_VERS.items() for _, ds in vs for d in ds), "vers : rayon inconnu"


def split_alts(pattern):
    """Les alternatives de premier niveau d'une expression (« a|b(c|d)|e » donne a, b(c|d), e)."""
    out, depth, cur, i = [], 0, '', 0
    while i < len(pattern):
        c = pattern[i]
        if c == '\\' and i + 1 < len(pattern):
            cur += pattern[i:i + 2]
            i += 2
            continue
        if c == '(':
            depth += 1
        elif c == ')':
            depth -= 1
        if c == '|' and depth == 0:
            out.append(cur)
            cur = ''
        else:
            cur += c
        i += 1
    out.append(cur)
    return [re.compile(a) for a in out if a]


_RF_ALTS = {k: (split_alts(a), split_alts(b)) for k, (a, b) in RAYON_FILTRE.items()}


def _longest(alts, k):
    best = ''
    for a in alts:
        for m in a.finditer(k):
            if len(m.group(0)) > len(best):
                best = m.group(0)
    return best


def filtre_match(ray, label):
    """Le terme le plus long du filtre « oui » du rayon présent dans le nom (vide sans filtre) : « fromage blanc » est plus
    précis que « fromage », le rayon qui le porte garde le produit."""
    f = _RF_ALTS.get(ray)
    return _longest(f[0], key(label)) if f else ''


def filtre_exclu(ray, label):
    """Le terme le plus long du filtre « non » du rayon qui écarte le produit (vide si rien ne l'écarte)."""
    f = _RF_ALTS.get(ray)
    return _longest(f[1], key(label)) if f else ''


def filtre_exclus(ray, label):
    """Tous les termes du filtre « non » du rayon présents dans le nom, du plus long au plus court."""
    f = _RF_ALTS.get(ray)
    if not f:
        return []
    k = key(label)
    found = {m.group(0) for a in f[1] for m in a.finditer(k) if m.group(0).strip()}
    return sorted(found, key=lambda t: (-len(t), t))
# contenance comptée en pièces : oeuf, rouleau, couche, capsule, lavage, piece
RAYON_UNITE = {r['id']: r['unite'] for r in RAYONS if r.get('unite')}
# rayons aux produits frais de poids variable (fruits et légumes, viandes, poissons, fromages à la coupe)
RAYON_FRAIS = {r['id'] for r in RAYONS if r.get('frais')}

# Lots de relevé pour Monoprix et Carrefour (lus par Claude, un lot par session) : chaque page de tools/sources.json porte
# le lot de son univers.
LOTS = {
    'frais-1': ['fruits-legumes', 'viandes-poissons'], 'frais-2': ['cremerie'], 'frais-3': ['charcuterie-traiteur', 'pain-patisserie', 'surgeles'],
    'epicerie-1': ['epicerie-salee'], 'epicerie-2': ['petit-dejeuner', 'epicerie-sucree'], 'boissons': ['boissons', 'cave'],
    'bebe-hygiene': ['bebe', 'hygiene-beaute', 'parapharmacie'], 'maison': ['entretien', 'animaux'], 'regimes-monde': ['regimes-bio', 'monde'],
}
LOT_OF = {u: lot for lot, us in LOTS.items() for u in us}


def hors_rayon(ray, label):
    f = _RF.get(ray)
    if not f:
        return False
    k = key(label)
    return not f[0].search(k) or bool(f[1].search(k))


def vers_rayon(ray, label, check=None):
    """Le rayon où envoyer un produit que le filtre de ray écarte par une de ses expressions « vers » : pour la première
    expression présente dans le nom (label, ou check, le nom sans la marque), le premier rayon nommé qui accepte le
    produit sous ses deux noms ; None sinon."""
    names = [key(x) for x in (label, check) if x is not None]
    for rx, dests in RAYON_VERS.get(ray, ()):
        if any(rx.search(k) for k in names):
            for d in dests:
                if not any(hors_rayon(d, x) for x in (label, check) if x is not None):
                    return d
    return None


def place_de_marche(ret, url):
    """Article d'un vendeur partenaire de la place de marché, dont la livraison n'est pas celle de l'enseigne (ni le
    retrait, ni la livraison des courses) : chez Carrefour, « ?s=1234 » dans le lien ; chez Auchan, un code produit qui
    n'est pas une référence Auchan (« /pr-C1881280 ») mais l'identifiant d'une offre de vendeur (« /pr-174cb6db-c802-... »,
    cages, aquariums, rasoirs et brosses à dents électriques, biberons, moustiquaires...)."""
    u = str(url or '')
    if ret == 'carrefour':
        return bool(re.search(r'[?&]s=\d', u))
    if ret.startswith('auchan'):
        return '/pr-' in u and not re.search(r'/pr-C\d+(?:[/?#]|$)', u)
    return False


def rayon_rank(rid):
    """0 : rayon ordinaire ; 1 : rayon qui garantit un régime (traiteur végétal, boissons végétales) ; 2 : rayon de parcours
    (Régimes et bio, Produits du monde). Un produit lu dans plusieurs rayons reste dans le plus ordinaire."""
    r = RAYON_BY_ID[rid]
    if r['univers'] in ('regimes-bio', 'monde'):
        return 2
    return 1 if r.get('regimes') else 0


def _search_terms(r):
    """Les recherches Auchan d'un rayon, sans accents (« liquide vaisselle », « jus d orange »)."""
    q = r['pages'].get('auchan') or []
    return [key(urllib.parse.unquote(x.split('text=', 1)[1])) for x in ([q] if isinstance(q, str) else q) if 'text=' in x]


# Rayon aux pages dédiées : ses recherches tiennent lieu de terme « oui » pour départager (best_rayon)
_DEDIE_TERMS = {rid: [re.compile(r'\b' + re.escape(t) + r'\b') for t in _search_terms(RAYON_BY_ID[rid]) if t] for rid in RAYON_DEDIE}


def precision(ray, label):
    """Le terme du nom qui rattache le produit au rayon : celui du filtre « oui » (filtre_match) ; pour un rayon aux pages
    dédiées (RAYON_DEDIE), sans terme « oui », sa recherche quand le nom la contient (« liquide vaisselle »)."""
    if ray in _DEDIE_TERMS:
        return _longest(_DEDIE_TERMS[ray], key(label))
    return filtre_match(ray, label)


def covers(ray, word, label):
    """Le rayon nomme-t-il ce mot d'exclusion ? Le terme par lequel il rattache le produit (precision : le plus long de
    son filtre « oui », ou la recherche d'un rayon aux pages dédiées) contient le mot : « soupe » est nommé par le rayon
    soupes, « liquide vaisselle » par le rayon vaisselle ; « pied de poule » n'est pas nommé par le rayon volaille, qui
    ne reconnaît que « poule », ni « soupe » par un rayon qui reconnaît d'abord autre chose dans le nom."""
    return bool(word) and word in precision(ray, label)


def best_rayon(cands, label=''):
    """Le rayon qui garde un produit accepté par plusieurs rayons : le plus ordinaire, puis celui qui reconnaît le terme le
    plus précis du nom (precision : « fromage blanc » bat « fromage » ; un rayon aux pages dédiées compte sa recherche,
    sans quoi il perdait toujours et un liquide vaisselle lu aussi sur la recherche « vinaigre » passait aux vinaigres),
    puis l'ordre de tools/rayons.json. Les filtres « non » doivent rendre ce départage rare."""
    return min(cands, key=lambda rid: (rayon_rank(rid), -len(precision(rid, label)), RAYON_ORDER[rid]))


def parse_oeufs(text):
    t = ' ' + key(text) + ' '
    m = re.search(r'(\d+)\s*(?:gros |moyens |extra |frais )?oeufs', t) or re.search(r'(?:boite|plateau|lot|etui) de\s*(\d+)', t) or re.search(r'(\d+)\s*(?:pieces?|pcs|unites?)\b', t) or re.search(r'(\d+)(?: x 1)? par pack', t) or re.search(r'\bx\s*(\d+)\b', t)
    n = int(m.group(1)) if m else None
    return n if n and 2 <= n <= 60 else None


# Mots qui comptent les pièces, par unité de rayon (tools/rayons.json, champ unite) ; le nom lu est au singulier.
PIECE_WORDS = {
    'couche': ('couche', 'culotte', 'lingette', 'pants', 'change'),
    'capsule': ('capsule', 'dosette', 'pod', 'tasse', 'pads'),
    'piece': ('piece', 'unite', 'brosse', 'serviette', 'tampon', 'protege', 'mouchoir', 'coton', 'batonnet', 'disque', 'carre', 'compresse', 'pansement', 'rasoir', 'lame', 'comprime', 'gelule', 'sachet', 'ampoule'),
}
PIECE_LABEL = {'oeuf': 'œuf', 'rouleau': 'rouleau', 'couche': 'couche', 'capsule': 'capsule', 'lavage': 'lavage', 'piece': 'pièce'}


def parse_pieces(text, unite):
    """Nombre de pièces et mot compté (« 44 couches », « 10 capsules », « lot de 2 brosses », « x12 ») : (n, mot) ou None."""
    words = PIECE_WORDS.get(unite)
    if not words:
        return None
    t = ' ' + key(text) + ' '
    alt = '|'.join(words)
    m = re.search(r'(\d+)\s*x\s*(\d+)\s*(' + alt + r')s?\b', t)
    if m:
        return int(m.group(1)) * int(m.group(2)), m.group(3)
    m = re.search(r'(?:lot|boite|paquet|etui|sachet) de\s*(\d+)\s*(' + alt + r')s?\b', t) or re.search(r'(\d+)\s*(' + alt + r')s?\b', t)
    if m:
        n = int(m.group(1))
        return (n, m.group(2)) if 1 <= n <= 500 else None
    m = re.search(r'\bx\s*(\d+)\b', t)
    if m and 1 <= int(m.group(1)) <= 500:
        return int(m.group(1)), words[0]
    return None


def parse_json(text):
    t = text.strip()
    t = re.sub(r'^```(?:json)?\s*', '', t)
    t = re.sub(r'\s*```\s*$', '', t)
    idx = [x for x in (t.find('['), t.find('{')) if x >= 0]
    if not idx:
        return None
    t = t[min(idx):]
    try:
        return json.loads(t)
    except Exception:
        try:
            return json.JSONDecoder().raw_decode(t)[0]
        except Exception:
            return None


# ---------------------------------------------------------------- sources
def auchan_fragment(ret):
    """Fragment qui distingue les pages d'un magasin ou d'une zone Auchan (#alesia, #livraison-perreux) ; vide pour auchan."""
    return '' if ret == 'auchan' else '#' + ret[len('auchan-'):]


def load_sources():
    """tools/sources.json, les pages Auchan dépliées : tools/gen_sources.py n'écrit chaque requête Auchan qu'une fois,
    avec "retailer": "auchan*" ; elle est rendue ici pour chaque magasin et zone de la clé magasins (enseigne auchan),
    avec le fragment du point (auchan_fragment) ajouté à l'url et au repère match. tools/scrape.js fait le même
    dépliage quand il lit sources.json (unfold)."""
    with open(os.path.join(TOOLS, "sources.json"), encoding="utf-8") as fh:
        src = json.load(fh)
    stores = [m for m, cfg in (src.get("magasins") or {}).items() if cfg.get("enseigne") == "auchan"]
    pages = []
    for p in src["pages"]:
        if p.get("retailer") != "auchan*":
            pages.append(p)
            continue
        for m in stores:
            frag = auchan_fragment(m)
            pages.append({**p, "retailer": m, "url": p["url"] + frag, "match": p["match"] + frag})
    src["pages"] = pages
    return src


DISCOVERED = os.path.join(STATE, "discovered.json")


def discovered_key(d):
    """Clé d'une page Houra trouvée par le robot (réglages « from » et « find ») : enseigne, rayon, page de départ et
    étapes, la même règle que dans tools/scrape.js."""
    return (d.get("retailer"), d.get("rayon"), d.get("from") or "", json.dumps(d.get("find"), ensure_ascii=False, separators=(",", ":")))


def load_discovered():
    """tools/state/discovered.json : les pages Houra trouvées par le robot aux passages précédents (liste, ou vide)."""
    return json.load(open(DISCOVERED, encoding="utf-8")) if os.path.exists(DISCOVERED) else []


def merge_discovered(new):
    """Fusionne les pages trouvées à un passage (tools/work/discovered.json, écrit par tools/scrape.js) dans
    tools/state/discovered.json : une page trouvée remplace celle de même clé, les autres restent (chaque cible du robot
    n'en découvre qu'une partie). Écrit le fichier, renvoie la liste fusionnée et fait relire les routes."""
    global _SOURCES
    merged = {discovered_key(d): d for d in load_discovered()}
    for d in new:
        if d.get("url"):
            merged[discovered_key(d)] = d
    out = list(merged.values())
    os.makedirs(STATE, exist_ok=True)
    with open(DISCOVERED, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
    _SOURCES = None
    return out


_SOURCES = None
_BY_URL = None
_BY_HOST = None
_IGNORE = None


def _load_routes():
    global _SOURCES, _BY_URL, _BY_HOST, _IGNORE
    if _SOURCES is not None:
        return
    src = load_sources()
    _SOURCES = [p for p in src["pages"] if p.get("url")]
    # pages trouvées par le robot depuis la page d'un grand rayon (réglage « from » de tools/sources.json)
    _SOURCES += [p for p in load_discovered() if p.get("url")]
    _BY_URL = collections.defaultdict(list)
    _BY_HOST = collections.defaultdict(list)
    for p in _SOURCES:
        rr = (p["retailer"], p["rayon"])
        if rr not in _BY_URL[p["url"]]:
            _BY_URL[p["url"]].append(rr)
        _BY_HOST[p["host"]].append(p)
    # pages écartées (réglage « ignore » : une page lue sans les noms des produits)
    _IGNORE = {x.split("?")[0].split("#")[0].rstrip("/") for x in src.get("ignore") or []}


def _page_url(url):
    """L'url de tools/sources.json qui correspond à une page relue, ou None : l'url exacte, sinon (pages suivantes
    Houra, fragments Auchan, anciennes adresses) la page de la liste dont le repère (« match ») est le plus long."""
    _load_routes()
    if url in _BY_URL:
        return url
    base = url.split("?")[0].split("#")[0].rstrip("/")
    if base in _IGNORE:
        return None
    best = None
    for host, pages in _BY_HOST.items():
        if host not in url:
            continue
        for p in pages:
            if p["match"] and p["match"] in url and (best is None or len(p["match"]) > len(best["match"])):
                best = p
    return best["url"] if best else None


def route(url):
    """Enseigne et rayon d'une page relue (y compris ses pages suivantes), ou None."""
    u = _page_url(url)
    return _BY_URL[u][0] if u else None


def routes(url):
    """Tous les (enseigne, rayon) d'une page : une même page peut servir plusieurs rayons (sucres et farines chez Houra,
    yaourts et fromages blancs), chaque produit allant au rayon dont le filtre (RAYON_FILTRE) l'accepte."""
    u = _page_url(url)
    return list(_BY_URL[u]) if u else []


# ---------------------------------------------------------------- quantities
NUM = r'(\d+(?:[.,]\d+)?)'
UNIT = r'(kg|g|cl|ml|litres?|l)\b'


def tofloat(s):
    return float(str(s).replace(',', '.'))


def unit_norm(v, u):
    u = u.lower()
    if u == 'kg':
        return v * 1000, 'g'
    if u == 'g':
        return v, 'g'
    if u == 'cl':
        return v * 10, 'ml'
    if u == 'ml':
        return v, 'ml'
    return v * 1000, 'ml'  # l, litre, litres


CONT = r'(?:bouteilles?|briques?|pots?|sachets?|paquets?|bo[iî]tes?|canettes?|flacons?|bidons?|doses?|barquettes?|tranches?|pi[eè]ces?|plaquettes?|tubes?|sprays?)'


def parse_qty(text):
    """Return dict(n=count, v=size per unit, u='g'|'ml') or None."""
    if not text:
        return None
    t = ' ' + str(text).lower().replace('×', 'x').replace(' ', ' ') + ' '
    t = re.sub(r"\bd'\s*", 'de ', t)
    m = re.search(r'(\d+)\s*x\s*(\d+)\s*x\s*' + NUM + r'\s*' + UNIT, t)
    if m:
        v, u = unit_norm(tofloat(m.group(3)), m.group(4))
        return {'n': int(m.group(1)) * int(m.group(2)), 'v': v, 'u': u}
    m = re.search(r'lot de\s*(\d+)\s*-\s*(\d+)\s*x\s*' + NUM + r'\s*' + UNIT, t)
    if m:
        v, u = unit_norm(tofloat(m.group(3)), m.group(4))
        return {'n': int(m.group(1)) * int(m.group(2)), 'v': v, 'u': u}
    m = re.search(r'(\d+)\s*x\s*' + NUM + r'\s*' + UNIT, t)
    if m:
        v, u = unit_norm(tofloat(m.group(2)), m.group(3))
        return {'n': int(m.group(1)), 'v': v, 'u': u}
    m = re.search(r'(\d+)\s+' + CONT + r'\s+(?:de\s+)?' + NUM + r'\s*' + UNIT, t)
    if m:
        v, u = unit_norm(tofloat(m.group(2)), m.group(3))
        return {'n': int(m.group(1)), 'v': v, 'u': u}
    m = re.search(r'(?<![\d.,])' + NUM + r'\s*' + UNIT, t)
    if m:
        v, u = unit_norm(tofloat(m.group(1)), m.group(2))
        return {'n': 1, 'v': v, 'u': u}
    return None


def parse_rolls(text):
    t = ' ' + str(text or '').lower() + ' '
    m = re.search(r'lot de\s*(\d+)\s*x\s*(\d+)\s*(?:rouleaux|pi[eè]ces)', t)
    if m:
        return int(m.group(1)) * int(m.group(2))
    m = re.search(r'(\d+)\s*x\s*(\d+)\s*par pack', t)
    if m:
        return int(m.group(1)) * int(m.group(2))
    m = re.search(r'(\d+)\s*(?:rouleaux|pi[eè]ces|par pack)', t)
    if m:
        return int(m.group(1))
    m = re.search(r'\bx\s*(\d+)\b', t)
    if m:
        return int(m.group(1))
    return None


def parse_lavages(text):
    m = re.search(r'(\d+)\s*lavages', str(text or '').lower())
    return int(m.group(1)) if m else None


# Produits frais vendus à la pièce sans poids écrit (« Avocat, la pièce », « Salade batavia ») : poids de référence en
# grammes, pour comparer au kilo et compter les recettes. La contenance obtenue est marquée approx (« la pièce, 200 g
# environ » dans l'appli).
PIECE_WEIGHT = {
    'avocat': 200, 'citron': 120, 'citron vert': 80, 'concombre': 400, 'salade': 300, 'laitue': 300, 'batavia': 300, 'melon': 900,
    'ananas': 1200, 'chou fleur': 1000, 'chou': 1000, 'brocoli': 400, 'poivron': 180, 'banane': 150, 'pomme': 170, 'poire': 180,
    'orange': 200, 'pamplemousse': 350, 'mangue': 400, 'kiwi': 90, 'botte de radis': 250, 'radis': 250, 'courgette': 250, 'aubergine': 300,
    'tomate': 120, 'oignon': 120, 'echalote': 40, 'ail': 60, 'poireau': 250, 'fenouil': 300, 'celeri': 600, 'artichaut': 300,
    'butternut': 1200, 'potimarron': 1200, 'baguette': 250, 'pain': 400, 'oeuf': 60, 'noix de coco': 800, 'pasteque': 3000,
}
_PW = sorted(PIECE_WEIGHT.items(), key=lambda kv: -len(kv[0]))


def piece_weight(label):
    """Poids approximatif en grammes d'une pièce d'après le nom (le mot le plus long d'abord), ou None."""
    k = ' ' + key(label) + ' '
    for w, g in _PW:
        if re.search(r'\b' + w + r's?\b', k):
            return g
    return None


# ---------------------------------------------------------------- brands
BRANDS = """
Monoprix Je Suis Vert|Monoprix Gourmet|Monoprix Bio|Monoprix|Naturalia|Tous les Jours
Auchan Tavola In Italia|Auchan Terroir|Auchan Better Life|Auchan Solidaires Bio|Auchan Solidaires|Auchan BIO|Auchan Gourmet|Auchan Collection|Auchan Baby|Auchan|Pouce
Carrefour Bio|Carrefour Classic'|Carrefour Extra|Carrefour Sensation|Carrefour Original|Carrefour Selection|Carrefour Sélection|Carrefour Baby|Carrefour Soft|Carrefour Kids|Carrefour Veggie|Carrefour Essential|Carrefour Discount|Carrefour|Simpl|Reflets de France
Mont Roucous|Roche Claire|Saint Antonin|St Antonin|Sant'Anna|Sant’Anna|Saint Amand|Source Mont Blanc|Mont Blanc|Lutécia|Lutecia|Cristaline|Evian|Vittel|Volvic|Contrex|Hépar|Hepar|Abatilles|Thonon|Courmayeur|Wattwiller|Carola|Bonneval|Osmo|Source Des Pins|Source des Pins
Badoit|Perrier|San Pellegrino|Vichy Célestins|Vichy Celestins|Vichy Saint-Yorre|St-Yorre|Saint-Yorre|Quézac|Quezac|Salvetat|Rozana|Arvie|Chateldon
Tropicana|Andros|Joker|Montebelo|True Fruits|Phyte|Sunny Delight|Alnatura|Cidou|Hugo Le Maraicher|Marcel Bio|Pauline|Pressade|Vitamont|Zuegg|Innocent|Pago|Alpro|Bjorg|Oatly|Sojasun
Coca-Cola|Coca-cola|Pepsi|Breizh Cola|Dr Pepper|Dr. Pepper|Solo Kola Champion|Les Brasseurs Savoyards|Mona|Waterdrop
Schweppes|Orangina|Oasis|Fanta|Sprite|7up|7 Up|Lipton Ice Tea|Lipton|Fuze Tea|Red Bull|Monster Energy|Monster|Teisseire|Monin|Pulco|Lorina|Elixia|Arizona|May Tea|Nestea
Lactel|Matin Léger de Lactel|Candia|C'Est Qui Le Patron ?!|C'est qui le Patron|La marque du conso|Lait Île de France|3 fermes d'Ile De France|Bonneterre|Faire France|Le Gall|Lait Plaisirs|Grandlait
Actimel|Activia|Activa|Yaos|Gervais|Gervita|Danone Du Monde|Les Danone Du Monde|Danone|Vrai|Fjord|Mavrommatis Paris|Mavrommatis|Yoplait|Perle de lait|Siggi's|Malo|Les 2 Vaches|Hotos|Velouté|Calin|Delta|Jockey|HiPRO|K-Philus Bio|Lynos|Nestlé|Osé Bio|Rians|Soignon|Alsace Lait|Abbot Kinney's|Grandeur nature|LA Bergerie|Ferme Des Peupliers|La Ferme Des Peupliers|La Ferme de la Tremblaye|La Ferme du manège|Ferme de Viltain|J'achète Fermier|La laitière|Le Petit Basque|Petit Basque|Les 300 laitiers bio|Paysan Breton|Tante Hélène|Danette|Mamie Nova|Petit Billy|La Fermière|Michel et Augustin
Président|Violife|Casa Azzurra|Galbani|Giovanni Ferrari|Parmareggio|EntreMont|Entremont|Kraft|Rbio|R Bio|Ambrosi|British Heritage|Leerdammer|Les Délices D'Amélie|Liel|ParmaBio|ViaBio|Le Chariot à fromages, Artisan Fromager
Caprice des Dieux|Kiri|Babybel|Mini Babybel|Boursin|Saint Môret|St Môret|Saint Moret|Philadelphia|Chavroux|Chaumes|Saint Agur|St Agur|Société|Roquefort Société|Apérivrais|Le Rustique|Coeur de Lion|Cœur de Lion|Lepetit|Vache qui rit|La Vache qui rit|Apéricube|Elle & Vire|Bridélice|Bridelice
Barilla|Panzani|Rummo|De Cecco|De cecco|Delverde|Garofalo|Lustucru|Granoro|Alpina Savoie|Rana|1881|Biori|Jardin Bio Etic|L'Oro Di Gragnano|Les Moulins De Provence|Ma Vie Sans Gluten|Mississippi belle|Priméal|Sacla|Pastificio Liguori|Ventoux Epeautre|Gusti Amo
Connétable|Connetable|Saupiquet|El Manar|Parallèles|Jc David|Albert Ménès|Maison Arostéguy|Fish4ever|Baton rouge|Les Dieux|Les Mouettes d'Arvor|Parmentier|Phare d'Eckmuhl
Meo|Méo|Illy|Malongo|Carte Noire|Black Idol|Grand'Mère|Grand Mère|L'Or|L'or|Lavazza|Jacques Vabre|Café Joyeux|Ethiquable - Commerce Equitable|Ethiquable|24 Terre|Melitta|Alter Eco - Commerce Equitable|Biodyssée|Café Michel|Fiers|Lupi Coffee|Naturela|San Marco|Terramoka|Velours
Nescafé Dolce Gusto|Nescafé|Senseo|Tassimo|Dolce Gusto|Nespresso|Starbucks|Ricoré|Ricore|Twinings|Kusmi Tea|Kusmi|Elephant|Éléphant|Pagès|Pages|Yogi Tea|Pukka|Dammann|Lov Organic|Clipper|Tetley
Bonne Maman|St Michel|Maison Colibri|Colibri|La Madeleine|Lu|Milka|Kinder|Saint Amour|Gerblé|Le Ster Pâtissier|Le Ster|Brossard|Marie-Anne Cantin|Astruc|Ker Cadelac|Ker Cadélac|Les Pâtisseries d'Hubert|Harrys|Armor Délices|Bio Soleil|La Maison Du Biscuit|Schär
Belin|Vico|Lay's|Lays|Brets|Tuc|Monster Munch|Curly|Pringles|Doritos|Kettle|Sibell|Kellogg's|Kelloggs|Jordans|Quaker|Nesquik|Lion|Chocapic|Weetabix|Grany|Belvita|Prince|BN|Pepito|Oreo|Granola|Mikado|Delacre|Bahlsen
Lindt|Côte d'Or|Cote d'Or|Ferrero|Nutella|Kinder Bueno|Haribo|Lutti|Carambar|Hollywood|Freedent|Mentos|Ricola|Vichy|Materne|Pom'Potes|Pom'potes|Vahiné|Vahine|Alsa|Ancel|Dr. Oetker|Dr Oetker|Poulain|Banania|Benco|Van Houten|Nesquik|Cémoi|Cemoi|Toblerone|Mars|Snickers|Twix|Bounty|KitKat|Kit Kat|Smarties|M&M's|Maltesers|Raffaello|Mon Chéri
Amora|Maille|Heinz|Bénédicta|Benedicta|Lesieur|Puget|Knorr|Maggi|Liebig|Royco|William Saurin|Zapetti|Raynal et Roquelaure|Raynal & Roquelaure|Suzi Wan|Ayam|Old El Paso|Zakia|Dari|Tipiak|Ben's Original|Ben'S Original|Uncle Ben's|Taureau Ailé|Taureau Aile|Florelli|Tilda|Riz du monde|Riz du Monde|Alter Eco|Jardin Bio|Markal|Mas du Bio|Grand Badon|Ofal|Vracbio|Ducros|Sainte Lucie|Kikkoman|Tabasco|Tanoshi|Blue Dragon|Patak's|Le Phare du Cap Bon|Al Wadi|Cortas|Lima
Terra Delyssa|Bio Organic Terra Delyssa|Terra d'Elyssa|Carapelli|Isio 4|La Tourangelle|Monini|Château Montfrin|Petit Château Montfrin|Château Virant|Alexis Munoz pour Monoprix|Alexis Munoz|Fruit d'Or|Costa d'Oro|Tramier|Bertolli|Oliviers & Co|Borges|Emile Noël|Émile Noël|Bio Planète|Vigean|Huilerie Vigean|Soléou|Soleou
Mutti|Rochefontaine|Cirio|D'Aucy|d'aucy|Cassegrain|Bonduelle|Carmelina|Pomì|Pomi|De Rica|Elvea|Ciro|Gino|Garden Gourmet|Hénaff|Henaff
Petit Navire|Un Pêcheur Sachant Pêcher|Un pécheur sachant pécher|Un Pécheur sachant Pécher|Rio Mare|Ortiz|Le Savoureux|Nautilus|Samia|Phare d'Eckmühl|Phare D'Eckmühl|La Belle-Iloise|La Belle Iloise|Capitaine Nat|Pêche Océan|Peche Ocean|Conserverie Gonidec
Francine|Maizena|Moulins De Versailles|Moulins de Versailles|Treblec|La Compagnie des Farines|Floraline|Mon Fournil|J.B Japon|Cœur de Blé|Coeur de Blé|Terre du pays d'Othe|Terre du pays d’Othe|Gruau d'Or|Les Grands Moulins de Paris|Celnat
Saint Louis|St Louis|Canderel|Pure Via|Daddy|Beghin Say|Béghin Say|La Perruche|Sunny Via|Ginko|Blonvilliers|Route du Sucre|Hermesetas|Stevia Sweet|Sucaryl|Erstein|Tereos
Lotus - Moltonel|Lotus Baby|Lotus|Kleenex®|Kleenex|Moltonel|Le Trèfle|Fess'nett|Ecodoo|Foxy|Lucart|RENOVA|Renova|Okay|Sopalin|Demak'Up|Demak'up
Sun|L'Arbre Vert|L'arbre Vert|Paic|PAIC|LIQUIDE VAISSELLE PAIC|Jacques Briochin|Briochin|Rainett|Mir|Palmolive|Finish|Maison Verte|Ecover Essential|Ecover|Les Secrets de Léontine|L'artisan savonnier|Bulle Verte|Comme Avant|Kerzon|Maison Net|Pimpant|Spring|Super Flacon|Somat|Fairy
Ariel|Le Chat|Persil|Dash|Sanytol|Skip|X-TRA|X-Tra|X Tra|Maia|Chanteclair|Bonux|Omo|Soupline|Lenor|Cajoline|Vanish|Calgon|Woolite|Super Croix
Cif|Mr Propre|Mr. Propre|Monsieur Propre|Ajax|St Marc|Saint Marc|Carolin|Cillit Bang|Harpic|Canard|Bref|Destop|La Croix|Lacroix|Spontex|Vileda|Scotch-Brite|Handy Bag|Albal|Air Wick|Airwick|Febreze|Glade|Baygon|Raid|Starwax|Antikal|Frio|Alfapac|Jex|O'Cedar
Loué|Les Fermiers de Loué|Matines|Le Gaulois|Coquen'Or|Cocorette|Poulehouse|Baby Coque|Miels Villeneuve|Nous Anti Gaspi|Nous anti-gaspi|D'Erwan|Oeuf frais D'Erwan|La Nouvelle Agriculture|Douce France
St Hubert|Saint Hubert|Planta Fin|Grand Fermage|Beurrerie Echiré|Echiré|Isigny Sainte Mère|Isigny Ste Mère|Primevère|Bridel|Lescure|Montaigu|Bordier|Fruitières Chabert|Etrez|Alain Ledanec|Allgau|Le Vieux Moulin
Charal|Bigard|Tendre et Plus|Tendre & Plus|Maître Coq|Maitre Coq|Fleury Michon|Herta|Madrange|Aoste|Justin Bridou|Cochonou|Bordeau Chesnel|Père Dodu|Pere Dodu|Isla Délice|Isla Delice|Isla Mondial|Wassila|Réghalal|Reghalal|Oriental Viandes|Dounia|Médina|Medina|Le Bon Végétal|HappyVore|La Vie|Heura|Beyond Meat|Nurishh|Labeyrie|Delpeyrat|Marie|Sodebo|Daunat|Pierre Martinet|Bonduelle Traiteur|Mix|Mix Buffet|Yarden|Osem|Tnuva|Elite
Findus|Iglo|McCain|Mc Cain|Buitoni|Carte d'Or|Carte D'Or|Häagen-Dazs|Haagen-Dazs|Ben & Jerry's|Ben&Jerry's|Magnum|Miko|Extrême|Extreme|Picard|Thiriet|Marie Surgelés|Charal Surgelés|Lustucru Selection|Bonduelle Surgelés
Pampers|Huggies|Love & Green|Love and Green|Joone|Blédina|Bledina|Blédilait|Gallia|Guigoz|Nidal|Novalac|Picot|Modilac|Babybio|HiPP|Hipp|Good Goût|Good Gout|Mustela|Biolane|Dodie|Avent|Philips Avent|MAM|Nuk|Tommee Tippee|Bébé Cadum|Mixa Bébé|Blédichef
Nivea|Dove|Sanex|Le Petit Marseillais|Cadum|Ushuaïa|Ushuaia|Tahiti|Monsavon|Rexona|Narta|Axe|Mennen|Head & Shoulders|Head&Shoulders|Dop|Elsève|Elseve|Ultra Doux|Garnier|Pantene|Franck Provost|Schwarzkopf|Syoss|Klorane|Ducray|Kérastase|Colgate|Signal|Oral-B|Oral B|Elmex|Sensodyne|Listerine|Meridol|Parodontax|Fluocaril|Gillette|Wilkinson|Bic|Venus|Veet|Nair|Always|Nana|Tampax|Tena|Vania|Saforelle|Mixa|La Roche-Posay|La Roche Posay|Bioderma|Avène|Avene|Uriage|Nuxe|Caudalie|Weleda|L'Oréal|L'Oreal|L'Oréal Paris|Maybelline|Bourjois|Diadermine|Neutrogena|Vaseline|Labello|Cattier|So'Bio|So Bio|Energie Fruit|Timotei|Corine de Farme|Roger & Gallet|Yves Rocher|Eucerin|CeraVe|Cerave|Rimmel|Gemey Maybelline|Essie|Scholl|Akileïne|Juvamine|Arkopharma|Forté Pharma|Forte Pharma|Oenobiol|Vitascorbol|Bion 3|Berocca|Supradyn|Alvityl|Pediakid|Solgar|Nutergia|Pileje|Puressentiel|Naturactive|Urgo|Hansaplast|Elastoplast|Nexcare|Mercurochrome|Durex|Manix|Skyn|Biseptine|Bétadine|Betadine|Compeed|Baume du Tigre|Tiger Balm|Homéoplasmine|Cooper
Whiskas|Sheba|Gourmet|Felix|Friskies|Purina|Purina One|Pro Plan|Royal Canin|Ultima|Perfect Fit|Pedigree|Frolic|César|Cesar|Catsan|Dreamies|Catisfactions|Brekkies|Hill's|Iams|Eukanuba|Edgard & Cooper|Almo Nature|Applaws|Vitakraft|Versele-Laga|Zolux|Tetra|Sanicat|Cat's Best|Tidy Cats|Fresh Step|Beaphar|Frontline|Advantix|Seresto
Leffe|Heineken|Kronenbourg|1664|Desperados|Corona|Grimbergen|Affligem|Pelforth|Chouffe|La Chouffe|Duvel|Chimay|Guinness|Carlsberg|Stella Artois|Jupiler|Budweiser|Peroni|Moretti|Birra Moretti|Estrella|San Miguel|Brooklyn|Lagunitas|Goudale|La Goudale|Ch'ti|Pietra|BrewDog|Brewdog|Tourtel|Loïc Raison|Loic Raison|Kerisac|Ecusson|Val de Rance|Maison Sassy|Dan Armor
Ricard|Pastis 51|51|Pernod|Martini|Cinzano|Lillet|Suze|Picon|Byrrh|Campari|Aperol|Limoncello|Get 27|Get 31|Cointreau|Grand Marnier|Baileys|Amaretto|Disaronno|Malibu|Soho|Passoa|Manzana|Pisang|Jägermeister|Jagermeister|Chartreuse|Bénédictine|Marie Brizard|Giffard|Monin|Bardinet|Negrita|Saint James|St James|Trois Rivières|La Mauny|Clément|Damoiseau|Bologne|Havana Club|Bacardi|Captain Morgan|Kraken|Diplomatico|Plantation|Bumbu|Jack Daniel's|Jack Daniels|Johnnie Walker|Jameson|Chivas|Chivas Regal|Ballantine's|Ballantines|Glenfiddich|Glenlivet|Label 5|William Peel|Grant's|Clan Campbell|J&B|Bushmills|Nikka|Suntory|Absolut|Smirnoff|Grey Goose|Eristoff|Poliakov|Belvedere|Zubrowka|Bombay Sapphire|Bombay|Gordon's|Gordons|Tanqueray|Hendrick's|Beefeater|Citadelle|Monkey 47|Malfy|José Cuervo|Jose Cuervo|Sierra|Moët & Chandon|Moet & Chandon|Veuve Clicquot|Ruinart|Nicolas Feuillatte|Mumm|Lanson|Taittinger|Piper-Heidsieck|Canard-Duchêne|Pommery|Mercier|Vranken|Charles de Cazanove|Jacquart|Deutz|Bollinger|Roederer|Laurent-Perrier
"""
BRAND_LIST = sorted({b.strip() for line in BRANDS.strip().split('\n') for b in line.split('|') if b.strip()}, key=lambda b: -len(b))

# Marques dont le nom est aussi un mot courant : reconnues seulement dans leurs univers (« Persil » lessive, pas la botte
# de persil ; « Marie » plats cuisinés ; « Magnum » glaces, pas la bouteille de champagne ; « Lion » céréales et barres).
BRAND_SCOPE = {
    'persil': {'entretien'}, 'canard': {'entretien'}, 'raid': {'entretien'}, 'bref': {'entretien'}, 'sun': {'entretien'}, 'mir': {'entretien'},
    'marie': {'charcuterie-traiteur', 'surgeles'}, 'magnum': {'surgeles'}, 'extreme': {'surgeles'}, 'lion': {'petit-dejeuner', 'epicerie-sucree'},
    'mars': {'epicerie-sucree'}, 'bounty': {'epicerie-sucree'}, 'prince': {'epicerie-sucree', 'petit-dejeuner'}, 'granola': {'epicerie-sucree', 'petit-dejeuner'},
    'elite': {'regimes-bio', 'petit-dejeuner'}, 'la vie': {'charcuterie-traiteur', 'regimes-bio', 'surgeles'}, 'tahiti': {'hygiene-beaute'},
    'venus': {'hygiene-beaute'}, 'signal': {'hygiene-beaute'}, 'dove': {'hygiene-beaute'}, 'axe': {'hygiene-beaute'}, 'bic': {'hygiene-beaute'},
    'nana': {'hygiene-beaute'}, 'always': {'hygiene-beaute'}, 'monster': {'boissons'}, 'oreo': {'epicerie-sucree', 'surgeles', 'monde'},
    'gourmet': {'animaux'}, 'felix': {'animaux'}, 'cesar': {'animaux'}, 'ultima': {'animaux'}, 'tartare': {'cremerie'}, 'mix': {'charcuterie-traiteur'},
    'vichy': {'boissons', 'hygiene-beaute', 'parapharmacie', 'epicerie-sucree'}, 'pages': {'petit-dejeuner'}, 'elephant': {'petit-dejeuner'},
    'spring': {'entretien', 'hygiene-beaute'}, 'okay': {'entretien'}, '51': {'cave'}, 'sierra': {'cave'}, 'bologne': {'cave'}, 'plantation': {'cave'},
    'clement': {'cave'}, 'mercier': {'cave'}, 'kraken': {'cave'}, 'joker': {'boissons'}, 'delta': {'cremerie'}, 'malo': {'cremerie'},
    'calin': {'cremerie'}, 'jockey': {'cremerie'}, 'vrai': {'cremerie', 'boissons', 'epicerie-sucree'}, 'liel': {'cremerie'}, 'fiers': {'petit-dejeuner'},
    'velours': {'petit-dejeuner'}, 'pauline': {'boissons'}, 'mona': {'boissons'}, 'osmo': {'boissons'}, 'foxy': {'hygiene-beaute', 'entretien'},
    'maia': {'entretien'}, 'ciro': {'epicerie-salee'}, 'gino': {'epicerie-salee'}, 'samia': {'epicerie-salee', 'monde', 'regimes-bio'}, 'lima': {'epicerie-salee', 'boissons', 'petit-dejeuner'},
    'delacre': {'epicerie-sucree'}, 'astruc': {'epicerie-sucree'}, 'cooper': {'parapharmacie'}, 'scholl': {'hygiene-beaute', 'parapharmacie'}, 'tetra': {'animaux'},
}

CANON = {
    'connetable': 'Connétable', 'entremont': 'Entremont', 'lutecia': 'Lutécia', 'hepar': 'Hépar',
    'st antonin': 'Saint-Antonin', 'saint antonin': 'Saint-Antonin', 'sant anna': "Sant'Anna",
    'source mont blanc': 'Mont Blanc', 'mont blanc': 'Mont Blanc', 'grand mere': "Grand'Mère", 'meo': 'Méo',
    'l or': "L'Or", 'l arbre vert': "L'Arbre Vert", 'paic': 'Paic', 'liquide vaisselle paic': 'Paic',
    'x tra': 'X-Tra', 'dr pepper': 'Dr Pepper', 'ker cadelac': 'Ker Cadélac', 'le ster patissier': 'Le Ster',
    'colibri': 'Maison Colibri', 'rbio': 'R Bio', 'r bio': 'R Bio', 'c est qui le patron': "C'est qui le Patron ?!",
    'la marque du conso': "C'est qui le Patron ?!", 'renova': 'Renova', 'lotus moltonel': 'Moltonel',
    'jacques briochin': 'Briochin', 'matin leger de lactel': 'Lactel', 'les danone du monde': 'Danone',
    'danone du monde': 'Danone', 'veloute': 'Danone', 'perle de lait': 'Yoplait', 'coca cola': 'Coca-Cola',
    'pepsi zero': 'Pepsi', 'kleenex': 'Kleenex', 'de cecco': 'De Cecco', 'mavrommatis paris': 'Mavrommatis',
    'ethiquable commerce equitable': 'Ethiquable', 'alter eco commerce equitable': 'Alter Eco',
    'la ferme des peupliers': 'Ferme des Peupliers', 'ferme des peupliers': 'Ferme des Peupliers',
    'petit basque': 'Petit Basque', 'le petit basque': 'Petit Basque', 'ecover essential': 'Ecover',
    'source des pins': 'Source des Pins', 'lait ile de france': "Lait d'Île-de-France",
    '3 fermes d ile de france': "Lait d'Île-de-France", 'k philus bio': 'K-Philus', 'la bergerie': 'La Bergerie',
    'mona': 'Mona', 'activa': 'Activia', 'st michel': 'St Michel', 'osmo': 'Osmo', 'auchan bio': 'Auchan Bio',
    'le chariot a fromages artisan fromager': 'Le Chariot à fromages', 'lu': 'LU', 'hipro': 'HiPRO',
    'dr pepper ': 'Dr Pepper', 'les 300 laitiers bio': 'Les 300 Laitiers Bio', 'les 300 bio': 'Les 300 Laitiers Bio',
    'la laitiere': 'La Laitière', 'nestle': 'Nestlé', 'gerble': 'Gerblé', 'president': 'Président',
    'beghin say': 'Béghin Say', 'st louis': 'Saint Louis', 'taureau aile': 'Taureau Ailé', 'ben s original': "Ben's Original",
    'uncle ben s': "Ben's Original", 'riz du monde': 'Riz du Monde', 'terra d elyssa': 'Terra Delyssa', 'bio organic terra delyssa': 'Terra Delyssa',
    'isigny sainte mere': 'Isigny Sainte-Mère', 'isigny ste mere': 'Isigny Sainte-Mère', 'beurrerie echire': 'Echiré', 'echire': 'Echiré',
    'd aucy': "d'aucy", 'vahine': 'Vahiné', 'moulins de versailles': 'Moulins de Versailles', 'alexis munoz pour monoprix': 'Alexis Munoz',
    'petit chateau montfrin': 'Château Montfrin', 'chateau montfrin': 'Château Montfrin', 'chateau virant': 'Château Virant', 'primevere': 'Primevère',
    'phare d eckmuhl': "Phare d'Eckmühl", 'un pecheur sachant pecher': 'Un Pêcheur Sachant Pêcher', 'saint hubert': 'St Hubert',
    'les fermiers de loue': 'Loué', 'loue': 'Loué', 'coquen or': "Coquen'Or", 'nous anti gaspi': 'Nous anti-gaspi', 'oeuf frais d erwan': "D'Erwan",
    'emile noel': 'Émile Noël', 'bio planete': 'Bio Planète', 'huilerie vigean': 'Vigean', 'soleou': 'Soléou', 'pomi': 'Pomì',
    'la belle iloise': 'La Belle-Iloise', 'peche ocean': 'Pêche Océan', 'henaff': 'Hénaff', 'coeur de ble': 'Cœur de Blé',
    'terre du pays d othe': "Terre du pays d'Othe", 'dr oetker': 'Dr. Oetker', 'bridelice': 'Bridélice', 'fruitieres chabert': 'Fruitières Chabert',
    'oliviers co': 'Oliviers & Co', 'elle vire': 'Elle & Vire',
    'albert menes': 'Albert Ménès', 'primeal': 'Priméal', 'schar': 'Schär', 'violife': 'Violife',
    'la madeleine': 'Maison Colibri', 'montagnes d arree': "Montagnes d'Arrée", 'laiterie bio d ariege': "Laiterie Bio d'Ariège",
    'biopyrenees': 'Biopyrénées', 'ste alix': 'Sainte-Alix', 'plancoet': 'Plancoët', 'les 2 vaches': 'Les 2 Vaches',
    'sun': 'Sun',
    # nouveaux rayons
    'vichy celestins': 'Vichy Célestins', 'vichy saint yorre': 'Saint-Yorre', 'st yorre': 'Saint-Yorre', 'saint yorre': 'Saint-Yorre', 'quezac': 'Quézac',
    'san pellegrino': 'San Pellegrino', '7up': '7 Up', '7 up': '7 Up', 'lipton ice tea': 'Lipton', 'monster energy': 'Monster', 'nescafe dolce gusto': 'Dolce Gusto',
    'nescafe': 'Nescafé', 'ricore': 'Ricoré', 'kusmi tea': 'Kusmi Tea', 'kusmi': 'Kusmi Tea', 'elephant': 'Éléphant', 'pages': 'Pagès', 'lov organic': 'Lov Organic',
    'kelloggs': "Kellogg's", 'kellogg s': "Kellogg's", 'lay s': "Lay's", 'lays': "Lay's", 'cote d or': "Côte d'Or", 'kinder bueno': 'Kinder', 'pom potes': "Pom'Potes",
    'cemoi': 'Cémoi', 'kit kat': 'KitKat', 'kitkat': 'KitKat', 'm m s': "M&M's", 'mon cheri': 'Mon Chéri', 'benedicta': 'Bénédicta', 'raynal roquelaure': 'Raynal et Roquelaure',
    'raynal et roquelaure': 'Raynal et Roquelaure', 'patak s': "Patak's", 'mc cain': 'McCain', 'mccain': 'McCain', 'carte d or': "Carte d'Or",
    'haagen dazs': 'Häagen-Dazs', 'ben jerry s': "Ben & Jerry's", 'ben jerrys': "Ben & Jerry's", 'extreme': 'Extrême', 'marie surgeles': 'Marie', 'charal surgeles': 'Charal',
    'lustucru selection': 'Lustucru', 'bonduelle surgeles': 'Bonduelle', 'bonduelle traiteur': 'Bonduelle', 'bledina': 'Blédina', 'bledilait': 'Blédilait', 'bledichef': 'Blédichef',
    'hipp': 'HiPP', 'good gout': 'Good Goût', 'love and green': 'Love & Green', 'philips avent': 'Avent', 'bebe cadum': 'Cadum', 'mixa bebe': 'Mixa',
    'ushuaia': 'Ushuaïa', 'head shoulders': 'Head & Shoulders', 'elseve': 'Elsève', 'kerastase': 'Kérastase', 'oral b': 'Oral-B', 'la roche posay': 'La Roche-Posay',
    'avene': 'Avène', 'l oreal': "L'Oréal", 'l oreal paris': "L'Oréal", 'so bio': "So'Bio", 'roger gallet': 'Roger & Gallet', 'cerave': 'CeraVe',
    'gemey maybelline': 'Maybelline', 'akileine': 'Akileïne', 'forte pharma': 'Forté Pharma', 'betadine': 'Bétadine', 'tiger balm': 'Baume du Tigre',
    'homeoplasmine': 'Homéoplasmine', 'mr propre': 'Mr Propre', 'monsieur propre': 'Mr Propre', 'st marc': 'St Marc', 'saint marc': 'St Marc',
    'lacroix': 'La Croix', 'scotch brite': 'Scotch-Brite', 'airwick': 'Air Wick', 'o cedar': "O'Cedar", 'super croix': 'Super Croix',
    'tendre plus': 'Tendre et Plus', 'tendre et plus': 'Tendre et Plus', 'maitre coq': 'Maître Coq', 'pere dodu': 'Père Dodu', 'isla delice': 'Isla Délice',
    'reghalal': 'Réghalal', 'medina': 'Médina', 'le bon vegetal': 'Le Bon Végétal', 'happyvore': 'HappyVore', 'beyond meat': 'Beyond Meat', 'mix buffet': 'Mix Buffet',
    'mini babybel': 'Babybel', 'st moret': 'Saint Môret', 'saint moret': 'Saint Môret', 'st agur': 'Saint Agur', 'roquefort societe': 'Société', 'societe': 'Société',
    'aperivrais': 'Apérivrais', 'coeur de lion': 'Cœur de Lion', 'la vache qui rit': 'La Vache qui rit', 'vache qui rit': 'La Vache qui rit', 'apericube': 'Apéricube',
    'la fermiere': 'La Fermière', 'purina one': 'Purina', 'pro plan': 'Purina', 'cesar': 'César', 'catisfactions': 'Catisfactions', 'hill s': "Hill's",
    'edgard cooper': 'Edgard & Cooper', 'almo nature': 'Almo Nature', 'versele laga': 'Versele-Laga', 'cat s best': "Cat's Best", 'la chouffe': 'Chouffe',
    'stella artois': 'Stella Artois', 'birra moretti': 'Moretti', 'la goudale': 'Goudale', 'ch ti': "Ch'ti", 'brewdog': 'BrewDog', 'loic raison': 'Loïc Raison',
    'pastis 51': 'Pastis 51', '51': 'Pastis 51', 'jagermeister': 'Jägermeister', 'benedictine': 'Bénédictine', 'st james': 'Saint James', 'trois rivieres': 'Trois Rivières',
    'clement': 'Clément', 'jack daniels': "Jack Daniel's", 'jack daniel s': "Jack Daniel's", 'chivas regal': 'Chivas', 'ballantines': "Ballantine's", 'ballantine s': "Ballantine's",
    'grant s': "Grant's", 'j b': 'J&B', 'bombay sapphire': 'Bombay Sapphire', 'gordons': "Gordon's", 'gordon s': "Gordon's", 'hendrick s': "Hendrick's", 'monkey 47': 'Monkey 47',
    'jose cuervo': 'José Cuervo', 'moet chandon': 'Moët & Chandon', 'piper heidsieck': 'Piper-Heidsieck', 'canard duchene': 'Canard-Duchêne', 'laurent perrier': 'Laurent-Perrier',
    'carrefour classic': "Carrefour Classic'", 'carrefour selection': 'Carrefour Sélection', 'reflets de france': 'Reflets de France',
}
# sub-brand -> family used for matching (display keeps the canonical brand)
FAMILY = {'Monoprix Je Suis Vert': 'Monoprix', 'Monoprix Gourmet': 'Monoprix', 'Monoprix Bio': 'Monoprix', 'Lotus Baby': 'Lotus', 'Mini Babybel': 'Babybel',
          'Kinder Bueno': 'Kinder', 'Nescafé Dolce Gusto': 'Dolce Gusto', 'Vichy Célestins': 'Vichy', 'Saint-Yorre': 'Vichy', 'Purina One': 'Purina', 'Pro Plan': 'Purina'}

# marques distributeur, par enseigne propriétaire (les sous-marques Carrefour* et Auchan* sont ramenées à leur famille)
MDD = {
    'monoprix': ['Monoprix', 'Naturalia', 'Tous les Jours'],
    'houra': ['Auchan', 'Pouce'],
    'auchan': ['Auchan', 'Pouce'],
    'auchan-alesia': ['Auchan', 'Pouce'],
    'auchan-bellesfeuilles': ['Auchan', 'Pouce'],
    'auchan-livraison-perreux': ['Auchan', 'Pouce'],
    'auchan-livraison-paris16': ['Auchan', 'Pouce'],
    'auchan-livraison-paris14': ['Auchan', 'Pouce'],
    'carrefour': ['Carrefour', 'Simpl', 'Reflets de France'],
}


def canon_brand(b):
    k = key(b)
    if k in CANON:
        return CANON[k]
    if b.isupper() and len(b) >= 2:
        return smart_title(b)
    return b.strip()


def smart_title(s):
    out = []
    for w in s.split(' '):
        if not w:
            continue
        lw = w.lower()
        if "'" in lw and len(lw) > 2:
            a, _, c = lw.partition("'")
            out.append(a.capitalize() + "'" + c.capitalize())
        elif lw in ('de', 'du', 'des', 'la', 'le', 'les', 'et', 'd', 'l', 'en', 'au', 'aux'):
            out.append(lw)
        elif '-' in lw:
            out.append('-'.join(x.capitalize() for x in lw.split('-')))
        else:
            out.append(lw.capitalize())
    r = ' '.join(out)
    return r[:1].upper() + r[1:]


SUBBRAND_KEEP = {'veloute', 'perle de lait', 'matin leger de lactel', 'les danone du monde', 'danone du monde'}


def brand_allowed(b, univers):
    """Une marque homonyme d'un mot courant (BRAND_SCOPE) n'est reconnue que dans ses univers."""
    scope = BRAND_SCOPE.get(key(b))
    return not scope or univers is None or univers in scope


def split_brand_prefix(name, univers=None):
    n = name.strip()
    nk = key(n)
    for b in BRAND_LIST:
        bk = key(b)
        if (nk == bk or nk.startswith(bk + ' ')) and brand_allowed(b, univers):
            # consume original words until they cover the brand's normalised tokens
            need = len(bk.split())
            parts = n.split()
            cut, got = 0, 0
            for i, p in enumerate(parts):
                got += len(key(p).split())
                cut = i + 1
                if got >= need:
                    break
            rest = ' '.join(parts[cut:]).lstrip(' -–,?!')
            if key(b) in SUBBRAND_KEEP:
                rest = b + ' ' + rest
            return canon_brand(b), rest
    return None, n


UPPER_TOKEN = re.compile(r"^[A-Z0-9ÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸ'’&!.\-]+$")
# Capitales en fin de titre Carrefour qui ne sont pas une marque : variétés, labels, origines, calibres des fruits et légumes
# (« Pommes Golden CARREFOUR », « Pommes GOLDEN le sachet de 1 kg ») ; elles restent dans la désignation.
NOT_BRAND = {'bio', 'aop', 'igp', 'label rouge', 'golden', 'gala', 'fuji', 'pink lady', 'granny', 'granny smith', 'conference', 'charlotte', 'bintje',
             'agata', 'coeur de boeuf', 'france', 'espagne', 'italie', 'maroc', 'cat 1', 'cat 2', 'calibre', 'origine france', 'hve', 'ab',
             'xl', 'xxl', 'uht', 'mg', 'msc', 'fsc', 'dop', 'vrac', 'ue', 'non ue'}


def split_brand_suffix(title):
    toks = title.strip().split()
    i = len(toks)
    while i > 0:
        t = toks[i - 1]
        if re.match(r'^N[.°]?\d+$', t):
            break
        if UPPER_TOKEN.match(t) and (sum(ch.isalpha() for ch in t) >= 2 or t in ("L'OR", "L’OR")) or t in ('&', '!'):
            i -= 1
            continue
        if re.fullmatch(r'\d+', t) and i - 2 >= 0 and UPPER_TOKEN.match(toks[i - 2]) and i < len(toks):
            i -= 1
            continue
        break
    brand = ' '.join(toks[i:])
    rest = ' '.join(toks[:i])
    if not brand or len(brand) < 2:
        return None, title
    # some all-caps tokens belong to the label (e.g. "UHT", "MG")
    lead = []
    btoks = brand.split()
    while btoks and btoks[0] in ('UHT', 'MG', 'M.G', 'M.G.', 'MG.', '%MG', 'IGP', 'AOP', 'DOP', 'MSC', 'FSC', 'XXL') and len(btoks) > 1:
        lead.append(btoks.pop(0))
    # variétés, labels et origines en capitales (NOT_BRAND) : retirées du début de la marque, puis la marque entière si rien ne reste
    while btoks:
        for n in (3, 2, 1):
            if len(btoks) >= n and key(' '.join(btoks[:n])) in NOT_BRAND:
                lead += btoks[:n]
                del btoks[:n]
                break
        else:
            break
    if lead:
        rest = (rest + ' ' + ' '.join(lead)).strip()
        brand = ' '.join(btoks)
    if not brand:
        return None, rest
    k = key(brand)
    if k.startswith('carrefour') or k.startswith('crf'):
        sub = brand.replace("CRF", "CARREFOUR")
        return smart_title(sub).replace("Classic'", "Classic'"), rest
    if k == 'pepsi zero':
        return 'Pepsi', rest + ' zéro'
    return canon_brand(brand), rest


def family(brand):
    if brand.startswith('Carrefour'):
        return 'Carrefour'
    if brand.startswith('Auchan'):
        return 'Auchan'
    return FAMILY.get(brand, brand)


def mdd_of(brand, retailer):
    fam = family(brand)
    for r, lst in MDD.items():
        if fam in lst:
            return r
    return None


# ---------------------------------------------------------------- régimes
# Étiquettes posées d'après le nom et la marque (en plus de celles garanties par les pages du rayon, champ regimes de
# tools/rayons.json). halal et casher ne sont jamais déduits du rayon seul ; vegan l'est pour les boissons végétales et
# pour les yaourts et desserts « végétal » ; tout vegan est aussi végétarien.
REGIME_BRANDS = {
    'bio': {'bjorg', 'jardin bio', 'jardin bio etic', 'primeal', 'naturalia', 'monoprix bio', 'auchan bio', 'carrefour bio', 'auchan solidaires bio',
            'bio planete', 'les 300 laitiers bio', 'bonneterre', 'babybio', 'marcel bio', 'alnatura', 'celnat', 'vracbio', 'mas du bio', 'k philus', 'ose bio',
            'bio soleil', 'ecodoo', 'cattier', 'weleda', 'so bio', 'lima', 'ethiquable', 'alter eco', 'biodyssee', 'rbio', 'r bio', 'parmabio', 'viabio', 'biori'},
    'halal': {'isla delice', 'isla mondial', 'zakia', 'wassila', 'medina', 'reghalal', 'oriental viandes', 'dounia', 'samia'},
    'casher': {'yarden', 'osem', 'elite', 'tnuva'},
    'vegan': {'violife', 'nurishh', 'happyvore', 'la vie', 'heura', 'beyond meat', 'oatly', 'alpro', 'sojasun', 'le bon vegetal'},
    'sans-gluten': {'schar', 'ma vie sans gluten', 'valpiform', 'nature et cie', 'biori'},
    'sans-lactose': {'matin leger'},
}
_VEG_UNIVERS = {'cremerie', 'charcuterie-traiteur', 'surgeles', 'boissons', 'regimes-bio'}


def regimes_of_name(label, brand, ray=None):
    """Régimes déduits du nom et de la marque d'une fiche (liste triée parmi REGIMES)."""
    k = ' ' + key(label) + ' '
    b = key(brand or '')
    r = RAYON_BY_ID.get(ray) if ray else None
    univ = r['univers'] if r else None
    out = set(r.get('regimes') or []) if r else set()
    if re.search(r'\bbio\b|biologique|\bab\b', k) or b in REGIME_BRANDS['bio']:
        out.add('bio')
    if re.search(r'\bhal+al\b', k) or (b in REGIME_BRANDS['halal'] and not (b == 'samia' and ray in ('thon', 'conserves'))):
        out.add('halal')
    if re.search(r'\b(casher|cacher|kasher|kosher)\b|beth din', k) or b in REGIME_BRANDS['casher']:
        out.add('casher')
    if re.search(r'\bvegan|vegetalien|100 vegetal', k) or (b in REGIME_BRANDS['vegan'] and not (b == 'alpro' and re.search(r'\blait\b', k))):
        out.add('vegan')
    if ray == 'boissons-vegetales' or (univ == 'cremerie' and re.search(r'\bvegetal', k)):
        out.add('vegan')
    if re.search(r'vegetarien|\btofu\b|\bseitan\b|\btempeh\b', k) or (univ in _VEG_UNIVERS and re.search(r'\bvegetal|\bsoja\b', k)):
        out.add('vegetarien')
    if re.search(r'sans gluten|gluten free', k) or b in REGIME_BRANDS['sans-gluten']:
        out.add('sans-gluten')
    if re.search(r'sans lactose|delactose', k) or b in REGIME_BRANDS['sans-lactose'] or b.startswith('matin leger'):
        out.add('sans-lactose')
    if 'vegan' in out:
        out.add('vegetarien')
    return sorted(x for x in out if x in REGIMES)


# ---------------------------------------------------------------- descriptors
STOP = set('de du des la le les a au aux et en avec pour l d un une par sur the of'.split())
FORMAT_WORDS = set('lot pack bouteille bouteilles brique briques pot pots sachet sachets paquet paquets boite boites flacon flacons bidon bidons canette canettes x g kg cl ml l litre litres piece pieces rouleaux rouleau unite les le la'.split())
WEAK = set('''eau eaux minerale naturelle source plate jus orange orang soda boisson cola pur pure
lait laits uht sterilise francais francaise yaourt yaourts nature fromage fromages blanc blancs rape rapee pate pates
cafe moulu arabica sardine sardines conserve madeleine madeleines gateau gateaux papier toilette hygienique liquide vaisselle
main mains lessive lavage lavages linge qualite superieure frais produit recette tradition traditionnelle bouchee
pret 100 intensite format familial classico cuisson'''.split())
SYN = [
    (r'\b1 2 ecreme\b', 'demi ecreme'), (r'\bdemi ecreme\b', 'demiecreme'),
    (r'\bgout original\b', 'original'), (r'\bclassique\b', 'original'), (r'\bclassic\b', 'original'),
    (r'\bzero cafeine\b', 'sanscafeine'), (r'\bsans cafeine\b', 'sanscafeine'),
    (r'\bzero sucres?\b', 'sanssucre'), (r'\bsans sucres?\b', 'sanssucre'), (r'\bzero\b', 'sanssucre'), (r'\bs sucre\b', 'sanssucre'),
    (r'\b0 mg\b', 'zeromg'), (r'\b0\b', 'zeromg'),
    (r'\bsans pulpe\b', 'sanspulpe'), (r'\bavec pulpe\b', 'pulpe'), (r'\btres pulpe\b', 'pulpe'),
    (r'\ba la grecque\b', 'grecque'), (r'\bgrec\b', 'grecque'),
    (r'\bsans gluten\b', 'sansgluten'), (r'\bsans lactose\b', 'sanslactose'), (r'\bble complet\b', 'complet'),
    (r'\bintegrale\b', 'complet'), (r'\bpeaux sensibles?\b', 'peausensible'), (r'\bpeau sensible\b', 'peausensible'),
    (r'\bdouble epaisseur\b', '2plis'), (r'\b2 epaisseurs\b', '2plis'), (r'\btriple epaisseur\b', '3plis'), (r'\b3 epaisseurs\b', '3plis'),
    (r'\bsavon de marseille\b', 'marseille'), (r'\bcoquillette\b', 'coquillettes'), (r'\btorsade\b', 'torsades'),
    (r'\bfusili\b', 'fusilli'), (r'\bspaghettis\b', 'spaghetti'), (r'\bmacaroni\b', 'maccheroni'),
    (r'\bpetites\b', 'petite'), (r'\bmoelleuses\b', 'moelleuse'), (r'\bindividuelles\b', 'individuelle'),
    (r'\bpur beurre\b', 'purbeurre'), (r'\bpepites\b', 'pepite'),
    # nouveaux rayons : graphies et accords usuels (les mots composés restent des mots séparés : « fromage blanc »,
    # « jambon cru », « huile d'olive » se retrouvent tels quels chez toutes les enseignes)
    (r'\bapres shampo+ing\b', 'apresshampoing'), (r'\bblonde\b', 'blond'), (r'\bsteaks? haches?\b', 'steakhache'),
    (r'\bpommes? de terre\b', 'pommedeterre'), (r'\bpois chiches?\b', 'poischiche'), (r'\bsans alcool\b', 'sansalcool'),
    (r'\bgazeuses?\b', 'gazeuse'), (r'\bpetillantes?\b', 'gazeuse'), (r'\bsurgelees?\b', 'surgele'), (r'\bfraiches?\b', 'fraiche'),
    (r'\bentieres?\b', 'entier'), (r'\bnoires?\b', 'noir'),
    # « lait » et « blanc » sont faibles (lait, yaourts, fromages) : un chocolat au lait et un chocolat blanc restent deux
    # parfums (« Céréales cœur chocolat blanc » n'est pas « Céréales cœur au chocolat au lait »)
    (r'\bchocolat (?:au )?lait\b', 'chocolatlait'), (r'\bchocolat blanc\b', 'chocolatblanc'),
]


def tokens(label):
    t = key(label)
    t = re.sub(r'\bn\s+(\d+)\b', r'no\1', t)  # n°5 -> no5
    t = re.sub(r'\b(\d+)\s(\d+)\s*mg\b', r'mg\1\2', t)  # 3,9% mg -> mg39
    t = re.sub(r'\b(\d+)\s*mg\b', r'mg\1', t)  # 20% mg -> mg20 (0% -> mg0)
    t = re.sub(r'\b(19[5-9]\d|20[0-3]\d)\b', r'an\1', t)  # millésime d'un vin : 2021 -> an2021, gardé comme un mot
    t = re.sub(r'\d+(?:\s\d+)?\s*(?:kg|g|cl|ml|l|litres?)\b', ' ', t)
    t = re.sub(r'\bx\s*\d+\b', ' ', t)
    t = re.sub(r'\b\d+\s*x\b', ' ', t)
    for a, b in SYN:
        t = re.sub(a, b, t)
    out = []
    for w in t.split():
        if w in STOP or w in FORMAT_WORDS:
            continue
        if re.fullmatch(r'\d+', w):
            continue
        if len(w) > 3 and w.endswith('s') and not w.endswith('ss'):
            w = w[:-1]
        out.append(w)
    return out


# Mots faibles propres à chaque rayon : les mots du nom du rayon quand il désigne un seul type de produit (« riz »,
# « thon en conserve » : « Taureau Ailé Riz basmati » et « Taureau Ailé Basmati » sont un même produit) ; pour un nom
# qui en énumère plusieurs (« Camembert, brie et bleus »), seuls les qualificatifs communs (conserve, surgelé, frais, bébé...)
# sont faibles, pas les types, qui distinguent les produits.
_GENERIC_WEAK = set(tokens('conserve surgelés frais fraîches bébé chat chien monde cuisine ménager petit déjeuner autres repas express '
                           'partager traiteur saveurs mer produits soin hygiène entretien infantile boisson dessert pour'))


def _weak_of(nom):
    toks = set(tokens(nom))
    if re.search(r',| et | ou ', nom):
        return toks & _GENERIC_WEAK
    return toks


WEAK_BY_RAYON = {r['id']: _weak_of(r['nom']) for r in RAYONS}


def strong(toks, ray=None):
    weak = WEAK | WEAK_BY_RAYON.get(ray, set())
    return frozenset(w for w in toks if w not in weak and w.rstrip('s') not in weak)
