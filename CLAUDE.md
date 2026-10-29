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

Les prix sont relus sur les pages rayon publiques listées dans `tools/sources.json`. Chaque page se lit avec WebFetch et le prompt de la page, qui demande la liste des produits en JSON. Les scripts retrouvent ensuite ces lectures dans l'historique de la session.

1. `python3 tools/dump.py --reset`
2. Lire les pages de `tools/sources.json` par séries de 8 appels WebFetch en parallèle, avec exactement l'URL et le prompt de chaque page. Après chaque série, lancer `python3 tools/dump.py` : il enregistre les lectures dans `tools/work/fetches.json` (rien ne se perd si l'historique est compacté) et affiche les pages restantes.
3. Pour Houra, si une réponse donne un `next_page` qui n'est pas déjà dans la liste, le lire aussi avec le même prompt.
4. Une page en erreur ou vide se relit une fois en fin de série. Si elle échoue encore, passer : `tools/build.py` reprend les produits du relevé précédent pour cette page, avec leur ancienne date, pendant 21 jours au plus.
5. `bash tools/refresh.sh` : normalisation, rapprochement entre enseignes, catalogue, comparaison avec la version publiée, nouvelle version du service worker, test de l'appli.
6. Relire la sortie. Si une enseigne perd plus d'un tiers de ses produits ou si beaucoup de prix doublent, chercher la cause avant de publier (page changée, réponse tronquée).
7. Commit `Prix du <date>` avec le résumé de `tools/check.py`, puis push sur `main`.

`tools/state/items.json` garde les produits du dernier relevé : il doit rester dans le dépôt pour la reprise des pages illisibles.

Carrefour bloque souvent la lecture de certaines pages : les rayons concernés sont signalés dans `data/meta.json` et dans l'appli.

## Faire évoluer le catalogue

- Ajouter une page : une entrée dans `tools/sources.json` (`retailer`, `rayon`, `host`, `match` reconnu dans l'URL, `url`, `prompt`), en reprenant le prompt d'une page de la même enseigne.
- Ajouter un rayon : `RAYONS` dans `tools/lib.py`, puis ses pages dans `tools/sources.json`.
- Nouvelle marque mal reconnue : `BRANDS` et `CANON` dans `tools/lib.py` (`tools/build.py` liste les produits sans marque reconnue).
- Rapprochement manqué entre deux enseignes : `python3 tools/match.py --review`, puis ajouter la paire d'identifiants dans `tools/merge.json`.
- Frais de livraison : `data/retailers.json`, à vérifier sur le site de chaque enseigne, avec la source.
- E.Leclerc, Auchan, Intermarché, Super U : leurs prix dépendent du magasin choisi et ne s'affichent pas sans session. Il faut les lire dans le navigateur de l'utilisateur (Claude in Chrome), avec ses magasins, puis ajouter l'enseigne dans `data/retailers.json`, `tools/sources.json` et `MDD` dans `tools/lib.py`.
