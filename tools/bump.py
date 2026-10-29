"""Change la version du service worker (sw.js) pour que les téléphones récupèrent les nouveaux fichiers.
La version prend la date du relevé (data/meta.json) et un numéro d'ordre dans la journée."""
import json, os, re

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
