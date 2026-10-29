# Cabas

Cabas compare les prix de tes courses chez Monoprix, Carrefour et Houra, puis calcule où commander pour payer le moins cher, livraison comprise.

## Installer sur iPhone

1. Ouvre https://59g59sy5w6-design.github.io dans Safari.
2. Touche Partager, puis « Sur l'écran d'accueil ».

L'appli s'ouvre alors en plein écran depuis son icône et fonctionne sans réseau avec les prix du dernier relevé.

## Ce que fait l'appli

- 1 680 produits dans 13 rayons, avec les prix des pages rayon de courses.monoprix.fr, carrefour.fr et houra.fr, relus toutes les heures par un robot (GitHub Actions).
- Un même produit est rapproché entre enseignes par marque, désignation et contenance : 207 produits sont comparables.
- Le panier est réparti en une, deux ou trois commandes pour obtenir le total le plus bas, en tenant compte des minimums d'achat et des frais de livraison de chaque enseigne.
- Des listes permettent de remettre un panier entier en un geste.
- Le panier, les listes et les réglages restent sur l'appareil.

L'appli affiche l'heure de la dernière vérification de chaque enseigne. Le total exact s'affiche sur le site de l'enseigne au moment de commander. Cabas n'est lié à aucune enseigne et les visuels des produits sont des illustrations.

## Fichiers

- `index.html`, `app.css`, `app.js` : l'interface.
- `packs.js` : les illustrations des produits.
- `optimizer.js`, `worker.js` : le calcul de la répartition du panier.
- `data/` : catalogue, enseignes et frais de livraison, informations sur le relevé, heure de vérification.
- `tools/` : le robot de relevé (`scrape.js`, lancé par `.github/workflows/prix.yml`) et la reconstruction du catalogue.
- `sw.js`, `manifest.webmanifest`, `icons/` : installation et fonctionnement hors ligne.

À chaque mise à jour du code, changer `VERSION` dans `sw.js` (`python3 tools/bump.py`) pour que les téléphones récupèrent la nouvelle version. Les prix, eux, arrivent sans cela.
