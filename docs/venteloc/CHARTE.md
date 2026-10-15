# VenteLoc — charte graphique (AlterEgo) et ergonomie

VenteLoc est un service d'**AlterEgo**. L'interface suit la charte AlterEgo (design system « AlterEgo », tiré du thème
WordPress AlterEgo 2.2.6) et reprend l'ergonomie des grands portails immobiliers (SeLoger) : un en-tête simple avec
deux boutons, une page d'accueil centrée sur la recherche, des cartes d'annonce lisibles d'un coup d'œil, des
carrousels, des services en pastilles et une aide toujours accessible.

Ce document prévaut sur `SPEC.md` §11 pour tout ce qui est visuel.

## 1. Charte AlterEgo

Sobre, presque monochrome : du papier, de l'encre, **une seule couleur (la brique)** et des pictogrammes au trait. Le
luxe vient de la retenue, pas de l'ornement.

### Couleurs (variables CSS dans `src/index.css`, classes Tailwind `brand-*`)

| Jeton | Valeur | Usage |
|---|---|---|
| `ink` (`brand-ink`, alias `brand-navy`) | `#141413` | Texte courant, titres, bouton plein, bandes sombres, pied de page |
| `paper` (`brand-paper`, alias `brand-surface`) | `#fbf8f3` | **Fond de page par défaut** (jamais de blanc pur en fond de page) |
| `white` | `#ffffff` | Fond des cartes posées sur `paper` ou `sand` |
| `sand` (`brand-sand`) | `#efe9df` | Sections de respiration (chiffres clés, services, bandes alternées) |
| `sauge` (`brand-sauge`) | `#dce3d5` | Accent rare (une zone par page) ; fond des badges de vérification (texte encre) |
| `line` (`brand-line`) | `#ddd6ca` | Bordures et séparateurs, 1 px |
| `bronze` (`brand-bronze`) | `#b94e33` | **La brique, seule couleur** : survols, surtitres, filets des chiffres clés, soulignement des liens fléchés, anneau de focus, bouton accent. Jamais en aplat de section. Texte brique : sur `paper` (4,7:1) et `white` (5,0:1) ; sur `sand`, seulement 24 px et plus ou gras 19 px et plus |
| `bronze-dark` (alias `brand-teal-dark`) | `#9c3f27` | Petit texte brique sur fond teinté (`bronze-soft`, `sand`) : 5,5 à 5,7:1 |
| `bronze-light` | `#e0a08a` | Surtitres et accents sur les bandes `ink` |
| `bronze-soft` (alias `brand-teal-soft`) | `#f6ece6` | Tuile du rendement sur les cartes |
| `ink-2` / `ink-3` / `ink-4` (et `gray-700/600/500`) | `#4a4740` / `#5b5b5b` / `#6c675e` | Texte secondaire / légendes et sources / petites mentions |
| `on-ink-2` / `on-ink-3` | `#c9c5bd` / `#a8a49c` | Texte secondaire et petites mentions sur `ink` |
| `error` | `#a32d2d` | Erreurs de formulaire, toujours avec un texte explicite |
| `amber` / `amber-soft` | `#8a4510` / `#f5ead8` | Alertes métier (décence énergétique, impayés déclarés) |
| `dpe.A`…`dpe.G` | couleurs réglementaires | Pastilles et échelle DPE uniquement |

Les gris Tailwind sont remplacés par des gris chauds (`gray-50`…`gray-900`). Le vert « vérifié » devient sauge foncé
(`brand-green` `#3f5e3b`, `brand-green-soft` = sauge) : texte encre sur sauge.

### Typographie (fichiers dans `src/fonts`, `@font-face` dans `src/index.css`)

- Titres : **Bricolage Grotesque**, graisse 800, interlignage 1,06, approche -0,025em (`font-display`). H1 fluide de
  38 à 60 px, H2 de 28 à 36 px, H3 de 19 à 22 px. **Casse de phrase** (majuscule au premier mot seulement).
- Texte : **Instrument Sans** (`font-sans`), corps 16-17 px, interlignage 1,6. Chapô 17-20 px.
- Surtitre (`.eyebrow`) : 12 px, graisse 600, capitales via `text-transform`, espacement 0,16em, brique
  (brique clair sur encre). Les capitales sont réservées à ce style.
- Chiffres (prix, rendements, chiffres clés) : chiffres tabulaires (`.tabular`).

### Composants (classes dans `src/index.css`)

- **Boutons en pilule** (`rounded-full`) : `.btn-primary` plein encre qui passe en brique au survol ; `.btn-secondary`
  contour encre de 1,5 px qui se remplit d'encre au survol ; `.btn-accent` brique (rare) ; `.btn-small`. **Un seul
  bouton plein par bloc** ; une troisième action devient un lien fléché.
- **Lien fléché** (`.lien-fleche`) : Bricolage gras, encre, filet brique dessous, flèche qui glisse de 4 px au survol.
- **Cartes** (`.card`) : fond blanc, filet `line`, rayon 20 px (`rounded-card`), **sans ombre**. Une ombre
  (`shadow-float`, `shadow-panel`, `shadow-menu`) seulement pour un élément qui flotte (encart de recherche sur le
  bandeau, menu déroulé, bouton d'aide).
- **Chiffres clés** : bande `sand`, filet vertical brique de 2 px (`.stat-filet`), valeur tabulaire, légende `ink-3`.
- **Focus clavier** : contour brique de 2 px, décalé de 2 px, partout.
- **Pictogrammes** : au trait 1,5 px, extrémités arrondies, sans remplissage (`src/seo/pictos.js`, composant
  `Picto`) ; les icônes lucide sont ramenées à 1,5 px. Pas d'icône pleine, pas d'emoji.
- **Logo** : fichier AlterEgo (`public/brand/logo-alterego-noir.png` sur papier, blanc, sable ;
  `logo-alterego-blanc.png` sur encre uniquement), jamais recoloré, déformé ni posé sur une photo ; suivi d'un filet
  et du nom du service (`BRAND.name`, VenteLoc) dans la police des titres. Le pictogramme compact (carré encre,
  maison au trait, point brique) ne sert qu'aux favicons.
- **Mouvement** : discret (200 ms, `cubic-bezier(.4,0,.2,1)` ; blocs qui montent de 18 px en 700 ms à l'arrivée) ;
  tout s'arrête avec `prefers-reduced-motion`. N'animer que `transform` et `opacity`.

### Ton

Vouvoiement, phrases courtes, registre écrit. Pas de superlatifs ni de promesses invérifiables : des faits et des
chiffres. Montants TTC d'abord, HT entre parenthèses. Pas d'emoji. Accroche de la maison : « L'immo autrement ».

### Photos

Les photos éditoriales (bandeaux, illustrations) suivent la charte : noir et blanc intégral par CSS
(`grayscale(1) contrast(1.08) brightness(1.02)`), jamais de banque d'images. **Les photos des annonces restent en
couleur** (l'acquéreur doit voir le bien tel qu'il est). Sans photo, une annonce montre le pictogramme au trait de son
type de bien sur fond `sand`.

## 2. Ergonomie (inspirée de SeLoger)

### En-tête (toutes les pages)

Fond `paper`, filet `line` en bas, hauteur 72 px. À gauche : logo. Puis la navigation en liens texte (actif : filet
brique dessous) : **Acheter** (`/annonces`), **Vendre** (`/vendre`), **Estimer** (`/estimer`), **Comment ça marche**
(`/#comment-ca-marche`). À droite : bouton plein **« + Déposer une annonce »** (visiteur et vendeur) et bouton contour
**« Se connecter »** avec pictogramme personne (visiteur) ; connecté : Messages (pastille), « Mon espace » (contour),
menu du compte. Mobile : logo, bouton « Déposer » compact, menu.

### Accueil `/` (nouvelle page, `HomePage`)

1. **Bandeau** : fond `sand` avec, à droite sur grand écran, une composition au trait (blocs encre, sable, sauge,
   pilule brique, méandre de la Seine) ; à gauche le surtitre « Biens loués à vendre », le H1 « Investissez dans un
   bien déjà loué » et un chapô. Un **encart de recherche blanc flottant** (`shadow-float`, rayon 20 px) chevauche le
   bas du bandeau : type de bien, où (région ou département), budget maximum, rendement brut minimum, bouton plein
   « Rechercher » → `/annonces?…`.
2. **Reprendre la dernière recherche** (si une recherche est mémorisée dans le navigateur) : dans l'encart,
   « Voulez-vous reprendre votre dernière recherche ? » + résumé (« Appartements · Rhône · rendement ≥ 5 % ») +
   boutons « Reprendre » (plein) et « Nouvelle recherche » (contour).
3. **Derniers biens loués** : carrousel horizontal de cartes (défilement par flèches rondes ‹ › en contour, et au
   doigt sur mobile, `scroll-snap`), titre H2 + lien fléché « Voir tous les biens ».
4. **Les meilleurs rendements** : même carrousel trié par rendement décroissant (masqué s'il y a moins de 3 biens).
5. **Nos services** (pastilles contour avec pictogramme, comme « Estimer votre bien · Déposer une annonce · Carte des
   prix ») : « Estimer votre bien loué », « Déposer une annonce », « Vendre un bien loué », « Comment ça marche ».
6. **Situations** (bande `sand`, trois cartes blanches rayon 24 px, surtitre `ink-2`, titre, texte, bouton contour
   petit) : Vous investissez / Vous vendez un bien loué / Vous voulez connaître sa valeur.
7. **Comment ça marche** (`#comment-ca-marche`) : 4 étapes avec pictogrammes (loupe, signature, euro, clé).
8. **Bande encre « Notre engagement »** : surtitre brique clair, titre blanc (« Rien à payer avant l'acte
   authentique »), texte `on-ink-2`, lien fléché vers `/vendre`.
9. **Pied de page** encre : logo blanc, colonnes de liens (Acheter, Vendre, Estimer, Aide ; mentions légales…),
   mentions AlterEgo SAS et carte T en `on-ink-3`.

### Liste des biens `/annonces`

La page des annonces quitte `/` pour `/annonces` (mêmes filtres et paramètres d'URL). `/` reçu avec des paramètres de
filtre (`type`, `bail`, `region`, `departement`, `prix_max`, `rendement_min`, `surface_min`, `tri`, `page`)
redirige vers `/annonces` avec les mêmes paramètres (anciens liens WordPress). Chaque recherche est mémorisée
(navigateur) pour « Reprendre ».

### Carte d'annonce (`ListingCard`)

Photo en haut (rapport 3:2, coins hauts arrondis) avec compteur **« 1 / n »** en pastille encre en bas à droite et
cœur favori en haut à droite ; sans photo, pictogramme du type de bien sur `sand`. Dessous : **prix** en grand
(Bricolage 800), puis une ligne « T2 · 42 m² · 640 €/mois » (séparateurs `·`), la **pastille rendement brut**
(brique foncée sur `bronze-soft`) et la pastille DPE, puis la **localisation** avec pictogramme carte (« Lyon (69) »),
la mention « Honoraires inclus, à la charge du vendeur » en petit, et « Propriétaire vérifié » (badge sauge) le cas
échéant. Toute la carte est cliquable.

### Aide

Bouton flottant **« Aide & FAQ »** (pilule contour encre sur fond blanc, `shadow-float`, en bas à droite, toutes les
pages publiques) qui ouvre un panneau : questions fréquentes acquéreur et vendeur (liens vers `/vendre#faq` et
`/#comment-ca-marche`), contact par e-mail.
