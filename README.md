# Cabas

Tes courses au prix le plus bas, livraison comprise.

Cabas est une application web gratuite, sans compte et sans publicité, qui compare les prix des courses chez Monoprix, Carrefour, Houra et Auchan (Île-de-France) et répartit le panier entre les enseignes pour payer le moins cher, minimums de commande et frais de livraison compris.

Elle s'ouvre à l'adresse https://cabas.mmt-advisory.com et s'installe sur l'écran d'accueil du téléphone. L'ancienne adresse y mène, et l'appli propose d'y emporter le panier, les listes et les réglages gardés à l'ancienne adresse, par un lien qui ne passe par aucun serveur.

## Ce qu'elle fait

- **Ma liste** : une liste écrite, dictée ou collée (« 2 paquets de pâtes, 6 œufs, lait »), même avec des fautes ; chaque produit est trouvé au meilleur prix, tes choix habituels reviennent d'office, et la liste entière est répartie entre les enseignes, livraison comprise. Un produit absent du catalogue se garde en ligne libre.
- **Demande à Cabas** : une phrase dans la recherche (« lait à moins de 1 € chez Houra », « petit-déjeuner pour 4 à moins de 15 € »), comprise sur le téléphone, sans appel réseau.
- **Le panier** : une, deux ou trois commandes, calculées exactement avec les minimums d'achat et les paliers de frais de chaque enseigne ; les produits qu'aucune commande ne prend sont à acheter en magasin, et « Tout me faire livrer » évite tout déplacement. Pour chaque produit, « Où le prendre » : toujours ou jamais chez une enseigne, ou un équivalent accepté. « Et si… », « Compléter pour 2,83 € » sous le minimum, le tableau des prix, un budget par panier ou par mois.
- **Économiser encore** : pour chaque produit, un équivalent moins cher au kilo ou au litre, jamais imposé.
- **Remplir mes paniers** : chaque produit s'ouvre sur le site de son enseigne, avec sa quantité ; tu l'ajoutes toi-même, Cabas le coche à ton retour. Rien n'est automatisé chez les enseignes.
- **À plusieurs** : un proche fait tes courses à partir d'un lien (ta liste, ton régime, ton budget) et te renvoie ce qui est commandé ; ou deux listes passent dans une même commande, avec la part exacte de chacun, frais compris.
- **Après la commande** : le créneau dans ton calendrier, « Ta commande est arrivée ? », ce qui manquait remis au prochain panier, le total payé noté à part, et le panier de la semaine le jour des courses.
- **En magasin** : le mode magasin (ta liste par rayon, en gros caractères, à cocher), une impression propre, et le scanner qui dit où un produit est le moins cher.
- **Repas à petit prix** : 60 recettes au coût de la portion, et une semaine de repas qui tient dans ton budget et ton régime.
- **Mon régime et ta santé** : sans gluten, végétarien, halal, sans porc et d'autres, d'après ce que les enseignes indiquent ; Nutri-Score et allergènes d'Open Food Facts sur la fiche d'un produit qui a un code-barres.
- **Les prix dans le temps** : l'évolution du prix d'un produit, ce qui a bougé sur tes produits, « Préviens-moi » sous un seuil, comparer deux produits côte à côte.
- **Pour tout le monde** : cinq tailles de texte, clair ou sombre, contraste renforcé, mode confort (gros boutons, une colonne), lecture à voix haute, et chaque suppression qui se rattrape par « Annuler ».
- **Tes données** : tout reste sur ton téléphone ; une copie en fichier, ou l'envoi vers un autre téléphone par un simple lien.
- **Partage** : la répartition en texte, une liste par lien, une image d'économies à publier.
- **Signaler ou demander** : un prix faux, un produit qui manque, une enseigne ou ta ville ; gardé sur ton téléphone, envoyé seulement si tu le veux, après avoir vu le texte, sans rien de personnel.
- **À venir**, dans « Comment ça marche » : ce que Cabas prépare, si les enseignes l'acceptent (voir plus bas).

## À venir

Ce que Cabas prépare, si les enseignes l'acceptent. Aucun accord n'existe pour l'instant et aucune date n'est promise : Cabas n'est lié à aucune enseigne.

- **Remplir tes paniers en un clic** : tes produits iraient d'un geste dans ton panier chez l'enseigne, comme le font déjà certaines applis de recettes avec des enseignes. Il faut pour cela que chaque enseigne ouvre l'accès à son panier. En attendant, « Remplir mes paniers » ouvre chaque produit pour toi.
- **Partout en France** : aujourd'hui, l'Île-de-France seulement (Monoprix, Carrefour et Houra en livraison, Auchan dans les secteurs relus, en retrait et en livraison).
- **Tous les rayons, et plus de produits** : aujourd'hui, Monoprix et Carrefour ne sont relus que sur une partie de leurs rayons.
- **D'autres enseignes** : par exemple Lidl, Intermarché, Courses U et Franprix, et les vrais prix E.Leclerc à la place des prix simulés.

Dans l'appli, « Demander une enseigne ou ta ville » dit où Cabas est attendu. Ce que chaque étape demande est détaillé dans `CLAUDE.md`, section « Feuille de route ».

## D'où viennent les prix

Les prix sont relevés sur les pages de rayon publiques des sites des enseignes, et chaque prix garde la date de son relevé. Rien n'est estimé, sauf E.Leclerc, dont les prix sont simulés et signalés comme tels partout. Les relevés sont décrits dans `CLAUDE.md`, section « Mettre à jour les prix ».

## Le dépôt

Site statique servi par GitHub Pages, sur le domaine du fichier `CNAME` : `index.html`, `app.css`, `boot.js` et `app.js` (l'interface ; `boot.js` pose la taille du texte, le thème, le contraste et le mode confort avant le premier rendu), `optimizer.js` et `worker.js` (la répartition du panier), `packs.js` (les illustrations, dessinées sans photo ni logo), `scan.js` (la lecture des codes-barres), `sw.js` (hors ligne), `data/` (le catalogue compact, ses détails par univers, les enseignes, l'historique des prix, les recettes et les listes toutes faites) et `tools/` (la chaîne de relevé des prix : `tools/rayons.json` décrit les 155 rayons et leurs pages chez chaque enseigne, `tools/catcheck.py` valide le catalogue). Tout est décrit dans `CLAUDE.md`.

Tester en local : `python3 -m http.server 8000` à la racine pour ouvrir l'appli, puis `node tools/smoke.js`, `node tools/optcheck.js`, `node tools/a11y.cjs` (accessibilité de chaque écran), `node tools/textcheck.cjs` (les textes) et les autres scripts `tools/*check*` décrits dans `CLAUDE.md`.

Le dépôt ne contient aucune donnée personnelle. Les noms des enseignes et des marques appartiennent à leurs propriétaires ; Cabas n'est lié à aucune enseigne.
