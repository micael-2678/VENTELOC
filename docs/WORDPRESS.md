# Site WordPress et application : liens, module d'annonces, boutons

L'application VenteLoc contient ses parcours (vendeur, acquéreur, administration), la page publique des annonces (`/`),
la page « Vendre mon bien loué » (`/vendre`) et l'estimateur (`/estimer`). Un site vitrine WordPress est facultatif ;
s'il existe, ce document explique comment le relier à l'application : liens filtrés vers les annonces, module
d'annonces intégré dans une page WordPress, boutons d'appel à l'action.

Dans les exemples :

- l'application est servie sur `https://app.venteloc.fr` (remplacez par votre domaine : c'est `SITE_URL` côté
  backend et `REACT_APP_SITE_URL` au build du frontend) ;
- le site WordPress est servi sur `https://www.venteloc.fr`.

## 1. Pages de l'application à relier depuis WordPress

| Besoin | Adresse |
| --- | --- |
| Toutes les annonces | `https://app.venteloc.fr/` |
| Annonces filtrées | `https://app.venteloc.fr/?type=…&region=…` (voir § 2) |
| Vendre un bien loué (présentation) | `https://app.venteloc.fr/vendre` |
| Déposer une annonce (vendeur) | `https://app.venteloc.fr/register?role=seller` |
| Estimer son bien loué (entrée du parcours vendeur) | `https://app.venteloc.fr/estimer` |
| Créer un compte acquéreur | `https://app.venteloc.fr/register?role=buyer` |
| Se connecter | `https://app.venteloc.fr/login` |
| Mentions légales, confidentialité, CGU, signalement | `/mentions-legales`, `/confidentialite`, `/cgu`, `/signaler` |

Le pied de page de l'application affiche un lien « Site » vers WordPress quand la variable de build
`REACT_APP_MARKETING_URL` est renseignée (par exemple `https://www.venteloc.fr`). Les e-mails envoyés par
l'application continuent de pointer vers l'application (`SITE_URL`).

## 2. Liens filtrés vers la page des annonces

La page des annonces (`/`) lit ses filtres dans l'adresse. Tous les paramètres sont facultatifs et se combinent.

| Paramètre | Valeurs | Exemple |
| --- | --- | --- |
| `type` | un ou plusieurs types de biens séparés par des virgules (tableau ci-dessous) | `type=appartement,maison` |
| `bail` | un ou plusieurs types de baux séparés par des virgules (tableau ci-dessous) | `bail=habitation-vide` |
| `region` | identifiant de région (tableau ci-dessous) | `region=bretagne` |
| `departement` | code du département (`29`, `2A`, `974`…) ; doit appartenir à la région si elle est indiquée | `departement=35` |
| `prix_max` | prix de vente maximum, en euros | `prix_max=200000` |
| `rendement_min` | rendement brut minimum, en % | `rendement_min=6` |
| `surface_min` | surface minimum, en m² | `surface_min=30` |
| `tri` | `recent` (défaut), `prix_asc`, `prix_desc`, `rendement_desc` | `tri=rendement_desc` |
| `page` | numéro de page (24 annonces par page) | `page=2` |

Les autres paramètres (par exemple `utm_source`, `utm_campaign`) sont conservés tels quels et n'ont pas d'effet sur
la recherche.

Exemples prêts à coller :

- Appartements loués en Bretagne :
  `https://app.venteloc.fr/?type=appartement&region=bretagne`
- Biens à plus de 6 % de rendement brut, moins de 150 000 €, meilleurs rendements d'abord :
  `https://app.venteloc.fr/?rendement_min=6&prix_max=150000&tri=rendement_desc`
- Locaux commerciaux et bureaux en Île-de-France :
  `https://app.venteloc.fr/?type=local-commercial,bureaux&region=ile-de-france`
- Location meublée dans le Rhône, depuis une campagne :
  `https://app.venteloc.fr/?bail=habitation-meublee&departement=69&utm_source=wordpress`

Types de biens (`type`) :

| Identifiant | Type de bien |
| --- | --- |
| `appartement` | Appartement |
| `maison` | Maison |
| `immeuble` | Immeuble de rapport |
| `residence-geree` | Lot en résidence gérée (étudiants, seniors, tourisme, EHPAD) |
| `local-commercial` | Local commercial |
| `bureaux` | Bureaux |
| `parking` | Parking, box, garage |
| `autre` | Autre bien loué |

Types de baux (`bail`) :

| Identifiant | Bail |
| --- | --- |
| `habitation-vide` | Bail d'habitation vide (loi du 6 juillet 1989) |
| `habitation-meublee` | Bail d'habitation meublé (résidence principale) |
| `colocation` | Colocation |
| `bail-mobilite` | Bail mobilité |
| `mixte` | Bail mixte (habitation et professionnel) |
| `commercial` | Bail commercial (3-6-9) |
| `residence-geree` | Bail commercial avec un exploitant de résidence |
| `professionnel` | Bail professionnel |
| `parking` | Location de parking ou de box |
| `plusieurs-baux` | Plusieurs baux (immeuble ou plusieurs lots) |

Régions (`region`) :

| Identifiant | Région |
| --- | --- |
| `ile-de-france` | Île-de-France |
| `auvergne-rhone-alpes` | Auvergne-Rhône-Alpes |
| `provence-alpes-cote-d-azur` | Provence-Alpes-Côte d'Azur |
| `nouvelle-aquitaine` | Nouvelle-Aquitaine |
| `occitanie` | Occitanie |
| `hauts-de-france` | Hauts-de-France |
| `pays-de-la-loire` | Pays de la Loire |
| `bretagne` | Bretagne |
| `grand-est` | Grand Est |
| `normandie` | Normandie |
| `bourgogne-franche-comte` | Bourgogne-Franche-Comté |
| `centre-val-de-loire` | Centre-Val de Loire |
| `corse` | Corse |
| `dom-tom` | DOM-TOM |

Ces identifiants sont ceux de `frontend/src/lib/referentiels.js` (identiques à `backend/taxonomy.py`).

## 3. Module d'annonces dans une page WordPress

L'adresse `https://app.venteloc.fr/embed/annonces` affiche une grille compacte des dernières annonces, sans
en-tête ni pied de page, suivie d'un lien « Voir toutes les annonces ». Elle accepte les mêmes paramètres que la page
des annonces (§ 2) et, en plus, `limit` : nombre d'annonces affichées, de 1 à 24 (6 par défaut). Les clics sur une
annonce ou sur « Voir toutes les annonces » ouvrent l'application dans l'onglet (pas dans l'iframe). La page n'est
pas indexée par les moteurs (`noindex`).

### 3.1 Autoriser le site WordPress (une fois, côté serveur)

Par défaut, aucune page de l'application ne peut être affichée dans une iframe d'un autre site. Pour le module
seulement, renseignez la variable d'environnement du conteneur frontend (nginx) :

```
EMBED_ALLOWED_ORIGINS=https://www.venteloc.fr https://venteloc.fr
```

- Une ou plusieurs origines (schéma + domaine, sans chemin), séparées par des espaces ; vide = aucune autre origine.
- Dans Dokploy : service frontend → onglet Environment, puis redéployer (pas besoin de reconstruire l'image :
  la valeur est appliquée au démarrage du conteneur).
- Effet : `/embed/…` est servi avec `Content-Security-Policy: … frame-ancestors 'self' <origines>` et sans
  `X-Frame-Options` ; toutes les autres pages gardent `X-Frame-Options: DENY` et `frame-ancestors 'none'`.

### 3.2 Bloc à coller dans WordPress

Dans l'éditeur de page, ajoutez un bloc « HTML personnalisé » et collez :

```html
<div class="venteloc-annonces">
  <iframe
    src="https://app.venteloc.fr/embed/annonces?type=appartement&region=bretagne&limit=6"
    title="Biens loués à vendre"
    loading="lazy"
    style="width: 100%; height: 640px; border: 0; display: block;"
    data-venteloc-embed></iframe>
</div>
<script>
  // Hauteur automatique : le module envoie sa hauteur à chaque rendu
  // ({ type: 'venteloc-embed-height', height }). Seuls les messages de l'application sont pris en compte.
  (function () {
    var APP_ORIGIN = 'https://app.venteloc.fr';
    window.addEventListener('message', function (event) {
      if (event.origin !== APP_ORIGIN) return;
      var data = event.data || {};
      if (data.type !== 'venteloc-embed-height' || typeof data.height !== 'number') return;
      var frames = document.querySelectorAll('iframe[data-venteloc-embed]');
      for (var i = 0; i < frames.length; i++) {
        if (frames[i].contentWindow === event.source) {
          frames[i].style.height = Math.max(200, Math.ceil(data.height)) + 'px';
        }
      }
    });
  })();
</script>
```

- Plusieurs modules sur la même page : répétez seulement l'`<iframe … data-venteloc-embed>` ; un seul `<script>`
  suffit (il retrouve l'iframe qui a envoyé le message).
- La hauteur de 640 px n'est utilisée qu'avant le premier message (affichage immédiat sans saut).
- Si l'extension de sécurité du site (ou le thème) filtre les balises `<script>` dans les blocs, placez le script dans
  le pied de page du thème ou dans une extension d'ajout de code, sans le modifier.

Exemples de modules :

- 3 dernières annonces, toutes catégories : `/embed/annonces?limit=3`
- 6 biens à plus de 6 % de rendement brut : `/embed/annonces?rendement_min=6&tri=rendement_desc&limit=6`
- 9 appartements en Île-de-France : `/embed/annonces?type=appartement&region=ile-de-france&limit=9`

## 4. Boutons d'appel à l'action

Bloc « HTML personnalisé » (ou bloc « Boutons » de WordPress avec la même adresse) :

```html
<p>
  <a href="https://app.venteloc.fr/register?role=seller"
     style="display: inline-block; padding: 14px 22px; border-radius: 12px; background: #0f766e; color: #fff;
            font-weight: 600; text-decoration: none;">
    Déposer une annonce
  </a>
  <a href="https://app.venteloc.fr/estimer"
     style="display: inline-block; margin-left: 12px; padding: 13px 21px; border-radius: 12px; border: 1px solid #0b1220;
            color: #0b1220; font-weight: 600; text-decoration: none;">
    Estimer mon bien loué
  </a>
</p>
```

Libellés et adresses conseillés :

| Bouton | Adresse |
| --- | --- |
| Vendre mon bien loué | `/vendre` (présentation, honoraires, sécurité, questions fréquentes) |
| Déposer une annonce | `/register?role=seller` (le vendeur crée son compte puis son annonce) |
| Estimer mon bien loué | `/estimer` (sans compte ; propose ensuite de déposer l'annonce) |
| Voir les annonces | `/` ou un lien filtré (§ 2) |
| Recevoir les nouvelles annonces | `/#alerte` (alerte e-mail sans compte, en bas de la liste) |
