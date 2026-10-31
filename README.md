# Cabas

Tes courses au prix le plus bas, livraison comprise.

Cabas est une application web gratuite, sans compte et sans publicité, qui compare les prix des courses chez Monoprix, Carrefour, Houra et Auchan (Île-de-France) et répartit le panier entre les enseignes pour payer le moins cher, minimums de commande et frais de livraison compris.

Elle s'ouvre à l'adresse https://59g59sy5w6-design.github.io et s'installe sur l'écran d'accueil du téléphone.

## Ce qu'elle fait

- **Ma liste** : une liste écrite ou dictée (« 2 paquets de pâtes, 6 œufs, lait ») ; chaque produit est trouvé au meilleur prix, puis la liste entière est répartie entre les enseignes, livraison comprise.
- **Le panier** : une, deux ou trois commandes, calculées exactement avec les minimums d'achat et les paliers de frais de chaque enseigne ; les produits qu'aucune commande ne prend sont à acheter en magasin, et un réglage « Sans achat en magasin » fait tout livrer.
- **Économiser encore** : pour chaque produit, un équivalent moins cher au kilo ou au litre, jamais imposé.
- **Repas à petit prix** : des recettes simples au coût de la portion, et « Ma semaine » qui met les ingrédients en commun.
- **Scanner** : en magasin, le code-barres d'un produit dit où il est le moins cher.
- **Suivi des commandes** : quand une commande arrive, un rappel dans le calendrier, et les paniers à recommander.
- **Partage** : la répartition en texte, une liste par lien, une image d'économies à publier.

## D'où viennent les prix

Les prix sont relevés sur les pages de rayon publiques des sites des enseignes, et chaque prix garde la date de son relevé. Rien n'est estimé, sauf E.Leclerc, dont les prix sont simulés et signalés comme tels partout. Les relevés sont décrits dans `CLAUDE.md`, section « Mettre à jour les prix ».

## Le dépôt

Site statique servi par GitHub Pages : `index.html`, `app.css`, `app.js` (l'interface), `optimizer.js` et `worker.js` (la répartition du panier), `packs.js` (les illustrations, dessinées sans photo ni logo), `scan.js` (la lecture des codes-barres), `sw.js` (hors ligne), `data/` (le catalogue et les enseignes) et `tools/` (la chaîne de relevé des prix). Tout est décrit dans `CLAUDE.md`.

Tester en local : `python3 -m http.server 8000` à la racine, puis `node tools/smoke.js`, `node tools/optcheck.js` et `node tools/perf.js`.

Le dépôt ne contient aucune donnée personnelle. Les noms des enseignes et des marques appartiennent à leurs propriétaires ; Cabas n'est lié à aucune enseigne.
