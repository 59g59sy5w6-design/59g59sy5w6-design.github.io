# Cabas

Appli web installable (PWA) qui compare les prix des courses chez Monoprix, Carrefour, Houra (livraison) et Auchan (retrait en consigne à Fontenay-sous-Bois) et répartit le panier entre plusieurs commandes pour obtenir le total le plus bas, frais compris. Site statique servi par GitHub Pages depuis la branche `main` de ce dépôt : pas de build, un push sur `main` met l'appli en ligne en une à deux minutes sur https://59g59sy5w6-design.github.io.

## Fichiers

- `index.html`, `app.css`, `app.js` : l'interface (idiome iOS natif, polices système, onglets, feuilles du bas).
- `packs.js` : les illustrations des produits, dessinées selon l'emballage. Pas de photos ni de logos.
- `optimizer.js`, `worker.js` : la répartition du panier (recherche exacte, minimums d'achat, paliers de livraison). `runAll` calcule chaque nombre de commandes, de 1 au nombre d'enseignes, du plus petit au plus grand, toujours pour tout le panier : plus de commandes autorisées ne donne jamais un total plus élevé. Quand le nombre choisi ne suffit pas à prendre tout le panier (produits qu'aucune enseigne de la commande ne vend), le panier le dit (« Une seule commande ne suffit pas », total grisé « sans N produits ») et donne le total du panier entier avec le nombre de commandes nécessaire. Les totaux de chaque nombre de commandes s'affichent sous le sélecteur.
- `sw.js`, `manifest.webmanifest`, `icons/` : installation sur l'écran d'accueil et fonctionnement hors ligne.
- `data/catalog.json` : rayons et produits, avec pour chaque enseigne le prix, la date du relevé, le nom affiché par l'enseigne et le lien.
- `data/retailers.json` : enseignes, minimum de commande, paliers de frais de livraison, frais de service, sources.
- `data/meta.json` : date du relevé, nombre de prix par enseigne, notes affichées dans « À propos des prix ».
- `tools/` : la chaîne de relevé des prix (voir plus bas).

Lancer en local : `python3 -m http.server 8000` à la racine, puis ouvrir http://localhost:8000. Tester : `node tools/smoke.js`.

## Règles

- Interface en français, tutoiement, ton sobre. Pas de tiret cadratin, pas de couleurs décoratives, pas d'émojis.
- Uniquement des prix réellement relevés sur les sites des enseignes, jamais estimés. Chaque prix garde sa date. Seule exception, à la demande du propriétaire de l'appli : E.Leclerc, dont le catalogue ne se lit pas sans contourner sa protection anti-robot, a des prix simulés (réglage `simulation` de `data/retailers.json`, calcul dans `tools/make_catalog.py`). Chaque offre simulée porte `sim` et l'appli l'affiche partout comme telle (« Simulé », « Prix simulé, pas relevé », « Estimation avec des prix simulés ») ; elle n'entre pas dans les écarts de prix de l'accueil.
- Aucune donnée personnelle dans le dépôt (il est public) : pas d'adresse, pas de code postal, pas de nom.
- Pas de logos ni de visuels de marque. Les noms d'enseignes et de marques s'écrivent en texte.
- À chaque changement de fichiers servis, lancer `python3 tools/bump.py` pour changer `VERSION` dans `sw.js`, sinon les téléphones gardent l'ancienne version en cache.

## Mettre à jour les prix

L'appli est une preuve de concept : les relevés automatiques sont suspendus et se lancent à la demande. Deux sources publient sur `main`, chacune avec `tools/publish.sh`, qui repart du dernier état publié, reconstruit le catalogue avec ses propres lectures et réessaie si `main` a bougé entre-temps.

**Houra et Auchan, par le robot GitHub.** Onglet Actions du dépôt, workflow « Relevé des prix », « Run workflow ». Depuis une session Claude Code : `gh api -X POST repos/59g59sy5w6-design/59g59sy5w6-design.github.io/actions/workflows/prix.yml/dispatches -f ref=main`. Le robot (`tools/ci.sh`, puis `tools/scrape.js`) ouvre chaque page Houra de `tools/sources.json` dans Chromium, fait défiler la page et lit chaque vignette : nom (attribut title du lien), prix (le montant le plus gros, ni barré, ni au kilo, ni montant d'offre), prix barré, prix au kilo, offre, lien. Pour Auchan, dont les prix dépendent du magasin, le robot relit chaque point de retrait du réglage `magasins` de `tools/sources.json` (Auchan Lockers Fontenay à Fontenay-sous-Bois, Click & Collect Paris Alésia et Paris Belles Feuilles), chacun dans un navigateur neuf. Il le choisit comme une personne : refus des cookies, « Choisir vos courses », saisie de la ville, carte du point de retrait. Jamais de livraison à domicile, qui demanderait une adresse. Il lit ensuite les pages de recherche Auchan de chaque rayon (marque en capitales, contenance en pastille, prix au kilo) ; dans `tools/sources.json`, les pages d'un point de retrait se distinguent par leur fragment (`#alesia`). Il relit aussi la livraison à domicile Auchan de trois zones (Le Perreux-sur-Marne, Paris 16e, Paris 14e) : il choisit la carte « Livraison à domicile » de la zone et, si Auchan demande une adresse, donne l'adresse publique de la mairie de la zone (réglage `livraison` de `magasins`). Dans `data/retailers.json`, les zones de livraison et les points de retrait Auchan partagent le même `group` : l'appli n'en utilise qu'un à la fois, choisi dans les réglages (« Auchan : livraison ou retrait »). Frais de livraison Auchan : minimum 50 € affiché par Auchan, barème par défaut de Bonial (2023), modifiable dans l'appli. Ne jamais mettre dans le dépôt l'adresse d'un utilisateur : seulement des points de retrait, qui sont des adresses de magasins. Monoprix et Carrefour refusent les robots depuis les serveurs de GitHub (vérification humaine, page anti-robot 403) : ils sont désactivés dans le réglage `robot` de `tools/sources.json`. Ne jamais contourner ces protections.

**Monoprix et Carrefour, par Claude.** Quand on demande un relevé dans une session Claude Code sur ce dépôt, suivre exactement ces étapes :

0. `bash tools/kick_robot.sh` : relance aussi le robot Houra si son dernier relevé a plus de 70 minutes.
1. `python3 tools/dump.py --reset` : vide les lectures et affiche les pages à lire (celles des enseignes dont le réglage `robot` vaut false), une par ligne, avec l'`url` et le `prompt` exacts.
2. Lire chaque page avec WebFetch, avec exactement cette `url` et ce `prompt`, par séries de 7 appels en parallèle. Après chaque série, lancer `python3 tools/dump.py` : il enregistre les lectures dans `tools/work/fetches.json` et affiche les pages encore sans lecture. Ne pas lire les pages Houra.
3. Relire une fois, en fin de relevé, les pages encore sans lecture (`deja_essayee` vaut true). Une page qui échoue encore garde ses prix précédents. Si une page renvoie une vérification humaine ou un blocage, passer sans chercher à le contourner.
4. `bash tools/publish.sh claude`, puis résumer : pages lues par enseigne, nombre de prix modifiés.

WebFetch ne lit que les adresses données par l'utilisateur ou trouvées par une recherche : une tâche planifiée doit donc citer les adresses des pages dans son texte. Une session lancée par la tâche dure 5 à 10 minutes et consomme le quota Claude du compte.

**Remettre les relevés automatiques.** La tâche planifiée « Relevé des prix Monoprix et Carrefour » existe toujours, désactivée (application Claude, tâches planifiées) : la réactiver, ou la lancer une fois. Pour Houra, rajouter le bloc `schedule` indiqué en tête de `.github/workflows/prix.yml`. Le 29 octobre 2026, GitHub n'a déclenché aucun passage programmé : `tools/kick_robot.sh`, lancé à chaque relevé de Claude, rattrape ce cas.

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
- Open Prices (Open Food Facts) : prix relevés en magasin par des contributeurs (tickets, étiquettes), en données ouvertes ODbL, fichier quotidien. Le workflow « Essai Open Prices » (`tools/openprices.py --stats`, ou `--near lat,lon,km`) mesure la couverture et dépose le compte rendu sur la branche `diag-openprices`. Au 29 octobre 2026, sur 90 jours : E.Leclerc 3 842 prix dans 41 magasins, Auchan 3 130 dans 23, Intermarché 2 555 dans 38, U 5 027 dans 26, surtout à Nancy, Lyon et Grenoble. Autour de Fontenay-sous-Bois et Noisy-le-Grand, presque rien pour ces enseignes.
- Autres enseignes depuis GitHub (workflow « Essai d'accès aux enseignes », `tools/probe.js` et `tools/explore.js`, copies d'écran sur la branche `diag-probe`), au 29 octobre 2026 : E.Leclerc Drive (leclercdrive.fr) et Intermarché renvoient une page anti-robot DataDome (403), Courses U une page Cloudflare (403). Les fiches nationales de e.leclerc s'ouvrent, avec un prix indicatif et la mention « Produit non vendu sur ce site » : ce n'est pas le prix d'un drive. Ne pas contourner ces protections ; ces enseignes ne peuvent se lire que dans le navigateur de l'utilisateur (Claude in Chrome), avec ses magasins.
- Qui est le moins cher (quiestlemoinscher.leclerc, GALEC) : comparaison publicitaire d'E.Leclerc, résultats agrégés par code postal et détail des prix en PDF, sans licence de réutilisation. Ne pas s'en servir comme source de prix.
