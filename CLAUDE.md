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

Deux sources publient sur `main`, chacune avec `tools/publish.sh`, qui repart du dernier état publié, reconstruit le catalogue avec ses propres lectures et réessaie si `main` a bougé entre-temps.

**Le robot GitHub, toutes les heures (Houra).** `.github/workflows/prix.yml` lance `tools/ci.sh` à la minute 17 de chaque heure (et à la demande depuis l'onglet Actions). `tools/scrape.js` ouvre chaque page Houra de `tools/sources.json` dans Chromium, fait défiler la page et lit chaque vignette : nom (attribut title du lien), prix (le montant le plus gros, ni barré, ni au kilo, ni montant d'offre), prix barré, prix au kilo, offre, lien. Monoprix et Carrefour refusent les robots depuis les serveurs de GitHub (vérification humaine, page anti-robot 403) : ils sont désactivés dans le réglage `robot` de `tools/sources.json`. Ne jamais contourner ces protections.

**Claude, cinq fois par jour (Monoprix et Carrefour).** Une tâche planifiée du compte Claude (« Relevé des prix Monoprix et Carrefour », à 7h56, 10h56, 13h56, 18h56 et 21h56, heure de Paris) lance une session Claude Code qui rattache ce dépôt, le clone et suit exactement ces étapes :

0. `bash tools/kick_robot.sh` : relance le robot Houra si son dernier relevé a plus de 90 minutes (les déclenchements programmés de GitHub Actions sont parfois en retard ou sautés).
1. `python3 tools/dump.py --reset` : vide les lectures et affiche les pages à lire (celles des enseignes dont le réglage `robot` vaut false), une par ligne, avec l'`url` et le `prompt` exacts.
2. Lire chaque page avec WebFetch, avec exactement cette `url` et ce `prompt`, par séries de 7 appels en parallèle. Après chaque série, lancer `python3 tools/dump.py` : il enregistre les lectures dans `tools/work/fetches.json` et affiche les pages encore sans lecture. Ne pas lire les pages Houra.
3. Relire une fois, en fin de relevé, les pages encore sans lecture (`deja_essayee` vaut true). Une page qui échoue encore garde ses prix précédents. Si une page renvoie une vérification humaine ou un blocage, passer sans chercher à le contourner.
4. `bash tools/publish.sh claude`, puis résumer : pages lues par enseigne, nombre de prix modifiés.

**Ce que font les scripts.** `tools/build.py`, `tools/match.py` et `tools/make_catalog.py` reconstruisent `data/catalog.json`, `data/meta.json` et `data/status.json` (heure de vérification par enseigne). Une page non lue, ou lue de façon nettement moins complète que la fois précédente, garde les produits du relevé précédent avec leur date, pendant 21 jours au plus. Pour Monoprix et Carrefour, chaque prix lu est comparé au prix au kilo ou au litre affiché à côté : un prix qui ne concorde pas garde sa valeur précédente, et une page où plus de 30 % des prix ne concordent pas est écartée en entier. Si des prix ont changé : test de l'appli (`tools/smoke.js`), comparaison (`tools/check.py`) et commit `Prix du <date> (<enseignes>, <source>)`. Sinon, seul `data/status.json` est publié.

`tools/state/items.json` garde les produits du dernier relevé publié, `tools/state/ids.json` l'identifiant de chaque produit : un produit garde le même identifiant d'un relevé à l'autre, car les paniers et les listes enregistrés sur les téléphones en dépendent. Quand deux produits fusionnent, l'identifiant abandonné renvoie vers celui qui reste (`aliases` dans `data/catalog.json`) et l'appli déplace les articles concernés. Ces deux fichiers doivent rester dans le dépôt.

Diagnostic du robot : lancer le workflow avec l'option « diag ». Il relit les trois enseignes et dépose le compte rendu par page (`tools/work/scrape.json`) et des extraits de pages sur la branche `diag`, sans toucher à `main`.

L'appli va chercher les prix à chaque ouverture (le service worker sert `data/` depuis le réseau d'abord) et revérifie toutes les 10 minutes quand elle reste ouverte. Elle affiche l'heure de vérification et nomme les enseignes dont les prix sont plus anciens.

## Faire évoluer le catalogue

- Ajouter une page : une entrée dans `tools/sources.json` (`retailer`, `rayon`, `host`, `match` reconnu dans l'URL, `url`, `prompt`), en reprenant le prompt d'une page de la même enseigne.
- Ajouter un rayon : `RAYONS` dans `tools/lib.py`, puis ses pages dans `tools/sources.json`.
- Nouvelle marque mal reconnue : `BRANDS` et `CANON` dans `tools/lib.py` (`tools/build.py` liste les produits sans marque reconnue).
- Rapprochement manqué entre deux enseignes : `python3 tools/match.py --review`, puis ajouter la paire d'identifiants dans `tools/merge.json`.
- Frais de livraison : `data/retailers.json`, à vérifier sur le site de chaque enseigne, avec la source.
- E.Leclerc, Auchan, Intermarché, Super U : leurs prix dépendent du magasin choisi et ne s'affichent pas sans session. Il faut les lire dans le navigateur de l'utilisateur (Claude in Chrome), avec ses magasins, puis ajouter l'enseigne dans `data/retailers.json`, `tools/sources.json` et `MDD` dans `tools/lib.py`.
