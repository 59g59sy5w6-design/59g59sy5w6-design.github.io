"""Contrastes des jetons de couleur d'app.css, dans les quatre affichages de l'appli : clair, sombre, et chacun en
contraste renforcé (réglage « Contraste renforcé », html[data-contrast="more"]).

Mesure chaque couple texte et fond qui existe dans l'interface (WCAG 2.2) : 4,5:1 pour le texte, 7:1 en contraste
renforcé ; 3:1 pour ce qui n'est pas du texte et porte une information (contour d'un champ, interrupteur éteint, anneau
de focus, chevrons, case à cocher) ; en contraste renforcé, les séparateurs et les contours des commandes aussi.
Vérifie aussi la forme du fichier : le bloc sombre de secours (réglage du téléphone, avant le script) est le même que
le bloc html[data-theme="dark"], et le contraste renforcé sombre redéfinit tout ce que redéfinit le contraste clair.
Code de sortie 1 au premier écart. Usage : python3 tools/contrastcheck.py [--detail]"""
import os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSS = open(os.path.join(ROOT, "app.css"), encoding="utf-8").read()
CSS = re.sub(r"/\*.*?\*/", "", CSS, flags=re.S)


def block(sel):
    """déclarations du premier bloc dont le sélecteur est exactement sel (hors @media), et sa position"""
    for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", CSS):
        if m.group(1).strip() == sel:
            return dict(re.findall(r"(--[\w-]+)\s*:\s*([^;]+);", m.group(2))), m.start()
    return None, -1


def media_block(media, sel):
    m = re.search(re.escape(media) + r"\s*\{\s*" + re.escape(sel) + r"\s*\{([^{}]*)\}\s*\}", CSS)
    return dict(re.findall(r"(--[\w-]+)\s*:\s*([^;]+);", m.group(1))) if m else None


problems = []
BASE, _ = block(":root")
DARK, p_dark = block(':root[data-theme="dark"]')
CON, p_con = block(':root[data-contrast="more"]')
CON_DARK, p_cd = block(':root[data-theme="dark"][data-contrast="more"]')
DARK_FB = media_block("@media (prefers-color-scheme: dark)", ':root:not([data-theme="light"])')
for name, b in [(":root", BASE), ('html[data-theme="dark"]', DARK), ('html[data-contrast="more"]', CON), ('html[data-theme="dark"][data-contrast="more"]', CON_DARK), ("bloc sombre de secours", DARK_FB)]:
    if not b:
        problems.append(f"bloc introuvable dans app.css : {name}")
if problems:
    print("Problèmes :\n- " + "\n- ".join(problems))
    sys.exit(1)
if DARK_FB != DARK:
    diff = sorted(k for k in set(DARK) | set(DARK_FB) if DARK.get(k) != DARK_FB.get(k))
    problems.append("le bloc sombre de secours diffère de html[data-theme=\"dark\"] : " + ", ".join(diff))
if not (p_dark < p_con < p_cd):
    problems.append("ordre des blocs : sombre, puis contraste renforcé, puis contraste renforcé sombre")
leak = sorted(set(CON) - set(CON_DARK))
if leak:
    problems.append("contraste renforcé : ces jetons clairs restent en sombre : " + ", ".join(leak))

THEMES = {
    "clair": [BASE],
    "sombre": [BASE, DARK],
    "clair, contraste renforcé": [BASE, CON],
    "sombre, contraste renforcé": [BASE, DARK, CON, CON_DARK],
}


def parse(v):
    v = v.strip().lower()
    m = re.fullmatch(r"#([0-9a-f]{3}|[0-9a-f]{6})", v)
    if m:
        h = m.group(1)
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 1.0)
    m = re.fullmatch(r"rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)", v)
    if m:
        return (float(m.group(1)), float(m.group(2)), float(m.group(3)), float(m.group(4) or 1))
    return None


def resolve(T, v, depth=0):
    v = v.strip()
    m = re.fullmatch(r"var\((--[\w-]+)\)", v)
    if m and depth < 8:
        return resolve(T, T.get(m.group(1), ""), depth + 1)
    return parse(v)


def over(c, base):
    a = c[3]
    return tuple(c[i] * a + base[i] * (1 - a) for i in range(3)) + (1.0,)


def lum(c):
    def ch(x):
        x /= 255
        return x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4
    return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2])


def ratio(a, b):
    la, lb = lum(a), lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


# couples mesurés : couleur, fonds, nature (« texte » ou « autre »), où ils servent
TEXT = [
    ("--ink", ["--paper", "--card", "--group", "--shelf", "--fill", "--sheet-bg", "--brand-tint", "--warn-bg", "--nav-bg", "--bar-bg"], "texte principal"),
    ("--ink-2", ["--paper", "--card", "--group", "--shelf", "--fill", "--sheet-bg"], "texte secondaire"),
    ("--brand-ink", ["--paper", "--card", "--group", "--shelf", "--fill", "--sheet-bg", "--brand-tint", "--nav-bg", "--bar-bg"], "liens, actions, onglet choisi"),
    ("--on-brand", ["--brand", "--mini-count"], "bouton plein, pastille du mini panier"),
    ("--on-promo", ["--promo-fill"], "bouton de suppression"),
    ("--promo", ["--paper", "--card", "--sheet-bg"], "« Effacer », offre"),
    ("--warn", ["--warn-bg", "--card", "--sheet-bg"], "attention, erreur de champ"),
    ("--sticker-ink", ["--sticker"], "prix le plus bas"),
    ("--mono-ink", ["--mono-bg"], "monogramme d'enseigne"),
    ("--tab-off", ["--bar-bg"], "onglets"),
    ("#ffffff", ["--toast-bg"], "message en bas de l'écran"),
    ("--toast-link", ["--toast-bg"], "« Annuler » du message"),
]
OTHER = [
    ("--focus", ["--paper", "--card", "--group", "--sheet-bg"], "anneau de focus"),
    ("--ink-3", ["--paper", "--card", "--group", "--sheet-bg"], "chevrons, contour des champs et des cases"),
    ("--brand", ["--paper", "--card", "--group", "--sheet-bg"], "interrupteur allumé, case cochée, barre de progression"),
    ("--sw-off", ["--paper", "--card", "--group", "--sheet-bg"], "interrupteur éteint"),
    ("--promo-fill", ["--paper", "--card"], "bouton de suppression"),
]
# contraste renforcé : séparateurs et contours des commandes (pastilles, boutons teintés, champ de recherche) visibles
OTHER_MORE = [
    ("--sep", ["--paper", "--card", "--group", "--sheet-bg"], "séparateurs"),
    ("--ctl-line", ["--paper", "--card", "--group", "--sheet-bg", "--fill"], "contour des commandes"),
]

detail = "--detail" in sys.argv
n = 0
for tname, layers in THEMES.items():
    T = {}
    for L in layers:
        T.update(L)
    more = "contraste" in tname
    paper = resolve(T, T["--paper"])
    pairs = [(fg, bgs, "texte", w, 7.0 if more else 4.5) for fg, bgs, w in TEXT] + [(fg, bgs, "autre", w, 3.0) for fg, bgs, w in OTHER + (OTHER_MORE if more else [])]
    for fg, bgs, kind, where, need in pairs:
        for bg in bgs:
            b = resolve(T, T.get(bg, ""))
            f = resolve(T, T.get(fg, fg) if fg.startswith("--") else fg)
            if not b or not f:
                problems.append(f"{tname} : couleur illisible pour {fg} ou {bg}")
                continue
            b = over(b, paper)
            f = over(f, b)
            r = ratio(f, b)
            n += 1
            if detail:
                print(f"{tname:28} {fg:14} sur {bg:12} {r:5.2f}:1 ({kind}, {need}:1)")
            if r + 1e-9 < need:
                problems.append(f"{tname} : {fg} sur {bg} à {r:.2f}:1, {need}:1 demandé ({where})")

if problems:
    print("Problèmes :\n- " + "\n- ".join(problems))
    sys.exit(1)
print(f"Contrastes des jetons : {n} couples mesurés dans {len(THEMES)} affichages, aucun écart.")
