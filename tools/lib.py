"""Cabas, outils de relevé des prix : fonctions communes.

Normalisation des noms (marque, désignation, contenance), lecture des réponses JSON du relevé,
routage d'une page vers son enseigne et son rayon d'après tools/sources.json.
"""
import json, re, unicodedata, collections, sys, os

TOOLS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS)
WORK = os.path.join(TOOLS, "work")
STATE = os.path.join(TOOLS, "state")



def strip_acc(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')


# Articles hors courses que la recherche d'une enseigne peut mêler à un rayon (vendeurs tiers d'auchan.fr pour
# « eau » : radiateurs, robinets, pompes, chauffe-eau). Une eau « avec robinet intégré » reste une eau.
HORS_COURSES = re.compile(r'(^|\s)(radiateur|robinet d arrosage|robinet arrosage|pompe d arrosage|raccord|chauffe eau|recuperateur d eau|seche serviettes)(\s|$)')


# Rayons lus par une recherche (Auchan) : le produit doit en être un (« œufs », pas des pâtes aux œufs ; « sucre » en
# poudre ou en morceaux, pas un bonbon). Le texte comparé est le nom sans accents (key).
RAYON_FILTRE = {
    'oeufs': (r'\boeufs?\b', r'pate|chocolat|lasagne|nouille|tagliatel|coquillet|spaetzle|brioche|mayonnaise|caille|surprise|kinder|paques|blanc d|jaune d|liquide'),
    'beurre': (r'\bbeurre\b', r'cacahu|biscuit|sable|cookie|galette|croissant|brioche|madeleine|pain|gateau|sauce|escargot|crepe|palet|caramel|karite|cacao|amande|noisette|pomme de terre|ail|fines herbes|persil'),
    'riz': (r'\briz\b', r'galette|souffle|dessert|au lait|gateau|boisson|vinaigre|feuille|nouille|cake|creme|pudding|semoule|salade|vermicelle|papier|farine|cuisine|plat|poelee|cantonais|paella|risotto prepare|biscuit|chips|crackers|tortilla'),
    'huile': (r'\bhuile\b', r'essentielle|massage|solaire|corps|cheveux|bebe|moteur|thon|sardine|maquereau|anchois|olives |aux olives|piment|spray|vaporisateur|lampe|parfum|seche|tomates sechees|artichaut|poivron|champignon'),
    'tomates': (r'\btomates?\b', r'ketchup|sauce|soupe|sechee|cerise|chips|thon|sardine|maquereau|jus|ravioli|pizza|farcie|gaspacho|mozzarella|tartin|plat|riz|pates|lasagne|graine|plant|semence'),
    'thon': (r'\bthon\b', r'rillette|salade|pate |pates|tartin|sauce|pizza|sandwich|croquette|chat|chien|terrine|mousse|tomate|crudites|paella|wrap|bouchee|quiche|pain'),
    'farine': (r'\bfarine\b', r'bebe|lait|pain d epice|prete|gateau|biscuit|preparation|cereale|bouillie|croquette|chien|chat'),
    'sucre': (r'\bsucres?\b', r'sans sucre|bonbon|confiserie|sucre d orge|sucette|chewing|biscuit|gateau|madeleine|crepe|gaufre|chocolat|confiture|sirop|dragee|barbe|caramel|soda|boisson|the |cafe|compote|cereale|yaourt|chantilly|perles de sucre|decor|vermicelle'),
}
_RF = {k: (re.compile(a), re.compile(b)) for k, (a, b) in RAYON_FILTRE.items()}


def hors_rayon(ray, label):
    f = _RF.get(ray)
    if not f:
        return False
    k = key(label)
    return not f[0].search(k) or bool(f[1].search(k))


def parse_oeufs(text):
    t = ' ' + key(text) + ' '
    m = re.search(r'(\d+)\s*(?:gros |moyens |extra |frais )?oeufs', t) or re.search(r'(?:boite|plateau|lot|etui) de\s*(\d+)', t) or re.search(r'(\d+)\s*(?:pieces?|pcs|unites?)\b', t) or re.search(r'\bx\s*(\d+)\b', t)
    n = int(m.group(1)) if m else None
    return n if n and 2 <= n <= 60 else None


def hors_courses(label):
    k = key(label)
    return bool(HORS_COURSES.search(k)) and not k.startswith('eau ')


def key(s):
    s = str(s or '').lower().replace('œ', 'oe').replace('æ', 'ae')
    s = strip_acc(s).replace('’', "'")
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


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
RAYONS = [
    ('eaux', 'Eaux', 'Boissons'),
    ('jus', "Jus d'orange", 'Boissons'),
    ('sodas', 'Colas', 'Boissons'),
    ('lait', 'Lait demi-écrémé', 'Crèmerie'),
    ('yaourts', 'Yaourts nature', 'Crèmerie'),
    ('fromages', 'Fromages râpés', 'Crèmerie'),
    ('oeufs', 'Œufs', 'Crèmerie'),
    ('beurre', 'Beurre', 'Crèmerie'),
    ('pates', 'Pâtes', 'Épicerie salée'),
    ('riz', 'Riz', 'Épicerie salée'),
    ('huile', 'Huile', 'Épicerie salée'),
    ('tomates', 'Tomates en conserve', 'Épicerie salée'),
    ('conserves', 'Sardines', 'Épicerie salée'),
    ('thon', 'Thon en conserve', 'Épicerie salée'),
    ('cafe', 'Café moulu', 'Épicerie sucrée'),
    ('farine', 'Farine', 'Épicerie sucrée'),
    ('sucre', 'Sucre', 'Épicerie sucrée'),
    ('gateaux', 'Madeleines et gâteaux', 'Épicerie sucrée'),
    ('papier', 'Papier toilette', 'Maison'),
    ('vaisselle', 'Liquide vaisselle', 'Maison'),
    ('lessive', 'Lessive liquide', 'Maison'),
]
def load_sources():
    with open(os.path.join(TOOLS, "sources.json"), encoding="utf-8") as fh:
        return json.load(fh)


_SOURCES = None


def route(url):
    """Enseigne et rayon d'une page relue (y compris ses pages suivantes), ou None."""
    global _SOURCES
    if _SOURCES is None:
        _SOURCES = [p for p in load_sources()["pages"] if p.get("url")]
        # pages trouvées par le robot depuis la page d'un grand rayon (réglage « from » de tools/sources.json)
        found = os.path.join(WORK, "discovered.json")
        if os.path.exists(found):
            _SOURCES += [p for p in json.load(open(found, encoding="utf-8")) if p.get("url")]
    for p in _SOURCES:
        if p["url"] == url:
            return p["retailer"], p["rayon"]
    # sinon la page de la liste dont le repère (« match ») est le plus long : les pages des différents points de
    # retrait Auchan ne diffèrent que par leur fragment (#alesia...)
    best = None
    for p in _SOURCES:
        if p["host"] in url and p["match"] in url and (best is None or len(p["match"]) > len(best["match"])):
            best = p
    return (best["retailer"], best["rayon"]) if best else None


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


CONT = r'(?:bouteilles?|briques?|pots?|sachets?|paquets?|bo[iî]tes?|canettes?|flacons?|bidons?|doses?)'


def parse_qty(text):
    """Return dict(n=count, v=size per unit, u='g'|'ml') or None."""
    if not text:
        return None
    t = ' ' + str(text).lower().replace('×', 'x').replace(' ', ' ') + ' '
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


# ---------------------------------------------------------------- brands
BRANDS = """
Monoprix Je Suis Vert|Monoprix Gourmet|Monoprix Bio|Monoprix|Naturalia|Tous les Jours
Auchan Tavola In Italia|Auchan Terroir|Auchan Better Life|Auchan Solidaires Bio|Auchan Solidaires|Auchan BIO|Auchan|Pouce
Mont Roucous|Roche Claire|Saint Antonin|St Antonin|Sant'Anna|Sant’Anna|Saint Amand|Source Mont Blanc|Mont Blanc|Lutécia|Lutecia|Cristaline|Evian|Vittel|Volvic|Contrex|Hépar|Hepar|Abatilles|Thonon|Courmayeur|Wattwiller|Carola|Bonneval|Osmo|Source Des Pins|Source des Pins
Tropicana|Andros|Joker|Montebelo|True Fruits|Phyte|Sunny Delight|Alnatura|Cidou|Hugo Le Maraicher|Marcel Bio|Pauline|Pressade|Vitamont|Zuegg
Coca-Cola|Coca-cola|Pepsi|Breizh Cola|Dr Pepper|Dr. Pepper|Solo Kola Champion|Les Brasseurs Savoyards|Mona|Waterdrop
Lactel|Matin Léger de Lactel|Candia|C'Est Qui Le Patron ?!|C'est qui le Patron|La marque du conso|Lait Île de France|3 fermes d'Ile De France|Bonneterre|Faire France|Le Gall|Lait Plaisirs
Actimel|Activia|Activa|Yaos|Gervais|Gervita|Danone Du Monde|Les Danone Du Monde|Danone|Vrai|Fjord|Mavrommatis Paris|Mavrommatis|Yoplait|Perle de lait|Siggi's|Malo|Les 2 Vaches|Hotos|Velouté|Calin|Delta|Jockey|HiPRO|K-Philus Bio|Lynos|Nestlé|Osé Bio|Rians|Soignon|Alsace Lait|Abbot Kinney's|Grandeur nature|LA Bergerie|Ferme Des Peupliers|La Ferme Des Peupliers|La Ferme de la Tremblaye|La Ferme du manège|Ferme de Viltain|J'achète Fermier|La laitière|Le Petit Basque|Petit Basque|Les 300 laitiers bio|Paysan Breton|Tante Hélène
Président|Violife|Casa Azzurra|Galbani|Giovanni Ferrari|Parmareggio|EntreMont|Entremont|Kraft|Rbio|R Bio|Ambrosi|British Heritage|Leerdammer|Les Délices D'Amélie|Liel|ParmaBio|ViaBio|Le Chariot à fromages, Artisan Fromager
Barilla|Panzani|Rummo|De Cecco|De cecco|Delverde|Garofalo|Lustucru|Granoro|Alpina Savoie|Rana|1881|Biori|Jardin Bio Etic|L'Oro Di Gragnano|Les Moulins De Provence|Ma Vie Sans Gluten|Mississippi belle|Priméal|Sacla|Pastificio Liguori|Ventoux Epeautre|Gusti Amo
Connétable|Connetable|Saupiquet|El Manar|Parallèles|Jc David|Albert Ménès|Maison Arostéguy|Fish4ever|Baton rouge|Les Dieux|Les Mouettes d'Arvor|Parmentier|Phare d'Eckmuhl
Meo|Méo|Illy|Malongo|Carte Noire|Black Idol|Grand'Mère|Grand Mère|L'Or|L'or|Lavazza|Jacques Vabre|Café Joyeux|Ethiquable - Commerce Equitable|Ethiquable|24 Terre|Melitta|Alter Eco - Commerce Equitable|Biodyssée|Café Michel|Fiers|Lupi Coffee|Naturela|San Marco|Terramoka|Velours
Bonne Maman|St Michel|Maison Colibri|Colibri|La Madeleine|Lu|Milka|Kinder|Saint Amour|Gerblé|Le Ster Pâtissier|Le Ster|Brossard|Marie-Anne Cantin|Astruc|Ker Cadelac|Ker Cadélac|Les Pâtisseries d'Hubert|Harrys|Armor Délices|Bio Soleil|La Maison Du Biscuit|Schär
Lotus - Moltonel|Lotus|Kleenex®|Kleenex|Moltonel|Le Trèfle|Fess'nett|Ecodoo|Foxy|Lucart|RENOVA|Renova
Sun|L'Arbre Vert|L'arbre Vert|Paic|PAIC|LIQUIDE VAISSELLE PAIC|Jacques Briochin|Briochin|Rainett|Mir|Palmolive|Finish|Maison Verte|Ecover Essential|Ecover|Les Secrets de Léontine|L'artisan savonnier|Bulle Verte|Comme Avant|Kerzon|Maison Net|Pimpant|Spring|Super Flacon
Ariel|Le Chat|Persil|Dash|Sanytol|Skip|X-TRA|X-Tra|X Tra|Maia|Chanteclair|Bonux|Omo
"""
BRAND_LIST = sorted({b.strip() for line in BRANDS.strip().split('\n') for b in line.split('|') if b.strip()}, key=lambda b: -len(b))

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
    'albert menes': 'Albert Ménès', 'primeal': 'Priméal', 'schar': 'Schär', 'violife': 'Violife',
    'la madeleine': 'Maison Colibri', 'montagnes d arree': "Montagnes d'Arrée", 'laiterie bio d ariege': "Laiterie Bio d'Ariège",
    'biopyrenees': 'Biopyrénées', 'ste alix': 'Sainte-Alix', 'plancoet': 'Plancoët', 'les 2 vaches': 'Les 2 Vaches',
    'les 300 bio': 'Les 300 Laitiers Bio', 'sun': 'Sun',
}
# sub-brand -> family used for matching (display keeps the canonical brand)
FAMILY = {'Monoprix Je Suis Vert': 'Monoprix', 'Monoprix Gourmet': 'Monoprix', 'Monoprix Bio': 'Monoprix'}

MDD = {
    'monoprix': ['Monoprix', 'Naturalia', 'Tous les Jours'],
    'houra': ['Auchan', 'Pouce'],
    'auchan': ['Auchan', 'Pouce'],
    'auchan-alesia': ['Auchan', 'Pouce'],
    'auchan-bellesfeuilles': ['Auchan', 'Pouce'],
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


def split_brand_prefix(name):
    n = name.strip()
    nk = key(n)
    for b in BRAND_LIST:
        bk = key(b)
        if nk == bk or nk.startswith(bk + ' '):
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
    while btoks and btoks[0] in ('UHT', 'MG', 'IGP', 'AOP', 'DOP', 'MSC', 'FSC', 'XXL'):
        lead.append(btoks.pop(0))
    if lead:
        rest = (rest + ' ' + ' '.join(lead)).strip()
        brand = ' '.join(btoks)
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
]


def tokens(label):
    t = key(label)
    t = re.sub(r'\bn\s+(\d+)\b', r'no\1', t)  # n°5 -> no5
    t = re.sub(r'\b(\d+)\s(\d+)\s*mg\b', r'mg\1\2', t)  # 3,9% mg -> mg39
    t = re.sub(r'\b(\d+)\s*mg\b', r'mg\1', t)  # 20% mg -> mg20 (0% -> mg0)
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


def strong(toks):
    return frozenset(w for w in toks if w not in WEAK and w.rstrip('s') not in WEAK)
