# Cabas

Appli web installable (PWA) qui compare les prix des courses chez Monoprix, Carrefour et Houra et répartit le panier entre une, deux ou trois commandes pour obtenir le total le plus bas, livraison comprise. Site statique servi par GitHub Pages depuis la branche `main` de ce dépôt : pas de build, un push sur `main` met l'appli en ligne en une à deux minutes sur https://59g59sy5w6-design.github.io.

## Fichiers

- `index.html`, `app.css`, `app.js` : l'interface (idiome iOS natif, polices système, onglets, feuilles du bas).
- `packs.js` : les illustrations des produits, dessinées selon l'emballage. Pas de photos ni de logos.
- `optimizer.js`, `worker.js` : la répartition du panier (recherche exacte, minimums d'achat, paliers de livraison).
- `sw.js`, `manifest.webmanifest`, `icons/` : installation sur l'écran d'accueil et fonctionnement hors ligne.
- `data/catalog.json` : rayons et produits, avec pour chaque enseigne le prix, la date du relevé, le nom affiché par l'enseigne et le lien.
- `data/retailers.json` : enseignes, minimum de commande, paliers de frais de livraison, frais de service, sources.
- `data/meta.json` : date du relevé, nombre de prix par enseigne, notes affichées dans « À propos des prix ».
- `tools/` : la chaîne de relevé des prix (voir plus bas).

Lancer en local : `python3 -m http.server 8000` à la racine, puis ouvrir http://localhost:8000. Tester : `node tools/smoke.js`.

## Règles

- Interface en français, tutoiement, ton sobre. Pas de tiret cadratin, pas de couleurs décoratives, pas d'émojis.
- Uniquement des prix réellement relevés sur les sites des enseignes, jamais estimés. Chaque prix garde sa date.
- Aucune donnée personnelle dans le dépôt (il est public) : pas d'adresse, pas de code postal, pas de nom.
- Pas de logos ni de visuels de marque. Les noms d'enseignes et de marques s'écrivent en texte.
- À chaque changement de fichiers servis, lancer `python3 tools/bump.py` pour changer `VERSION` dans `sw.js`, sinon les téléphones gardent l'ancienne version en cache.

## Mettre à jour les prix

Un robot relit les prix toutes les heures : `.github/workflows/prix.yml` lance `tools/ci.sh` sur GitHub Actions (à la minute 17 de chaque heure, et à la demande depuis l'onglet Actions).

1. `tools/scrape.js` ouvre chaque page de `tools/sources.json` dans Chromium (Playwright), fait défiler la page, puis lit chaque vignette produit : nom, contenance, prix, prix barré, prix à l'unité, offre, lien. Pour Houra, il suit aussi la page suivante. Une page refusée par l'enseigne est notée, sans tentative de contournement.
2. `tools/build.py`, `tools/match.py`, `tools/make_catalog.py` reconstruisent `data/catalog.json`, `data/meta.json` et `data/status.json` (heure de vérification par enseigne). Une page illisible, ou lue de façon nettement moins complète que la fois précédente, garde les produits du relevé précédent avec leur date, pendant 21 jours au plus.
3. Si des prix ont changé : test de l'appli (`tools/smoke.js`), comparaison (`tools/check.py`), commit `Prix du <date>` et publication. Sinon, seul `data/status.json` est publié, pour afficher l'heure de vérification.

Diagnostic : lancer le workflow avec l'option « diag ». Le compte rendu par page (`tools/work/scrape.json`) et des extraits des pages mal lues arrivent sur la branche `diag`, sans toucher à `main`.

Relevé à la main, si le robot ne peut pas lire une enseigne : lire les pages de `tools/sources.json` avec WebFetch et le prompt de chaque page, par séries de 8, en lançant `python3 tools/dump.py` après chaque série (`--reset` au début). Puis `bash tools/refresh.sh`, relire la sortie, commit et push.

`tools/state/items.json` garde les produits du dernier relevé publié : il doit rester dans le dépôt pour la reprise des pages illisibles.

L'appli va chercher les prix à chaque ouverture (le service worker sert `data/` depuis le réseau d'abord) et revérifie toutes les 10 minutes quand elle reste ouverte.

## Faire évoluer le catalogue

- Ajouter une page : une entrée dans `tools/sources.json` (`retailer`, `rayon`, `host`, `match` reconnu dans l'URL, `url`, `prompt`), en reprenant le prompt d'une page de la même enseigne.
- Ajouter un rayon : `RAYONS` dans `tools/lib.py`, puis ses pages dans `tools/sources.json`.
- Nouvelle marque mal reconnue : `BRANDS` et `CANON` dans `tools/lib.py` (`tools/build.py` liste les produits sans marque reconnue).
- Rapprochement manqué entre deux enseignes : `python3 tools/match.py --review`, puis ajouter la paire d'identifiants dans `tools/merge.json`.
- Frais de livraison : `data/retailers.json`, à vérifier sur le site de chaque enseigne, avec la source.
- E.Leclerc, Auchan, Intermarché, Super U : leurs prix dépendent du magasin choisi et ne s'affichent pas sans session. Il faut les lire dans le navigateur de l'utilisateur (Claude in Chrome), avec ses magasins, puis ajouter l'enseigne dans `data/retailers.json`, `tools/sources.json` et `MDD` dans `tools/lib.py`.
