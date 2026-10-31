"""Change la version du service worker (sw.js) pour que les téléphones récupèrent les nouveaux fichiers.
La version prend la date du relevé (data/meta.json) et un numéro d'ordre dans la journée.
Met aussi à jour, dans index.html, l'empreinte du script en ligne autorisé par la règle de contenu (CSP)."""
import base64, hashlib, json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sw = os.path.join(ROOT, "sw.js")
day = json.load(open(os.path.join(ROOT, "data", "meta.json"), encoding="utf-8"))["updatedAt"]
s = open(sw, encoding="utf-8").read()
m = re.search(r'const VERSION = "cabas-(\d{4}-\d{2}-\d{2})-(\d+)";', s)
n = int(m.group(2)) + 1 if m and m.group(1) == day else 1
new = f'const VERSION = "cabas-{day}-{n}";'
s = re.sub(r'const VERSION = "[^"]*";', new, s, count=1)
open(sw, "w", encoding="utf-8").write(s)
print("sw.js :", new)

# règle de contenu : seul le script en ligne de index.html (préchargement du catalogue) est autorisé, par son empreinte
html_path = os.path.join(ROOT, "index.html")
h = open(html_path, encoding="utf-8").read()
scripts = re.findall(r"<script>(.*?)</script>", h, flags=re.S)
if len(scripts) == 1 and "sha256-" in h:
    digest = base64.b64encode(hashlib.sha256(scripts[0].encode("utf-8")).digest()).decode("ascii")
    h2 = re.sub(r"'sha256-[^']*'", f"'sha256-{digest}'", h, count=1)
    if h2 != h:
        open(html_path, "w", encoding="utf-8").write(h2)
        print("index.html : empreinte du script en ligne mise à jour")
elif len(scripts) > 1:
    print("index.html : plusieurs scripts en ligne, la règle de contenu n'en autorise qu'un")
