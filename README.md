# Cabas

Cabas compare les prix de tes courses chez Monoprix, Carrefour et Houra, puis calcule où commander pour payer le moins cher, livraison comprise.

## Installer sur iPhone

1. Ouvre https://59g59sy5w6-design.github.io dans Safari.
2. Touche Partager, puis « Sur l'écran d'accueil ».

L'appli s'ouvre alors en plein écran depuis son icône et fonctionne sans réseau avec les prix du dernier relevé.

## Ce que fait l'appli

- 1 680 produits dans 13 rayons, avec les prix relevés le 28 octobre 2026 sur courses.monoprix.fr, carrefour.fr et houra.fr.
- Un même produit est rapproché entre enseignes par marque, désignation et contenance : 207 produits sont comparables.
- Le panier est réparti en une, deux ou trois commandes pour obtenir le total le plus bas, en tenant compte des minimums d'achat et des frais de livraison de chaque enseigne.
- Des listes permettent de remettre un panier entier en un geste.
- Le panier, les listes et les réglages restent sur l'appareil.

Les prix changent souvent : le total exact s'affiche sur le site de chaque enseigne au moment de commander. Cabas n'est lié à aucune enseigne et les visuels des produits sont des illustrations.

## Fichiers

- `index.html`, `app.css`, `app.js` : l'interface.
- `packs.js` : les illustrations des produits.
- `optimizer.js`, `worker.js` : le calcul de la répartition du panier.
- `data/` : catalogue, enseignes et frais de livraison, informations sur le relevé.
- `sw.js`, `manifest.webmanifest`, `icons/` : installation et fonctionnement hors ligne.

À chaque mise à jour des fichiers, changer `VERSION` dans `sw.js` pour que les téléphones récupèrent la nouvelle version.
