# Site WordPress et application : liens, module d'annonces, boutons

Depuis octobre 2026, la présentation commerciale (accueil, pages « vendre » / « reprendre », guides) est faite sous
WordPress. L'application ne garde que ses parcours (cédant, repreneur, administration) et une page publique des
annonces. Ce document explique comment relier les deux : liens filtrés vers les annonces, module d'annonces intégré
dans une page WordPress, boutons d'appel à l'action.

Dans les exemples :

- l'application est servie sur `https://app.cessionbatiment.fr` (remplacez par votre domaine : c'est `SITE_URL` côté
  backend et `REACT_APP_SITE_URL` au build du frontend) ;
- le site WordPress est servi sur `https://www.cessionbatiment.fr`.

## 1. Pages de l'application à relier depuis WordPress

| Besoin | Adresse |
| --- | --- |
| Toutes les annonces | `https://app.cessionbatiment.fr/` |
| Annonces filtrées | `https://app.cessionbatiment.fr/?metier=…&region=…` (voir § 2) |
| Déposer une annonce (cédant) | `https://app.cessionbatiment.fr/register?role=seller` |
| Estimer son entreprise (entrée du parcours cédant) | `https://app.cessionbatiment.fr/estimer` |
| Créer un compte repreneur | `https://app.cessionbatiment.fr/register?role=buyer` |
| Se connecter | `https://app.cessionbatiment.fr/login` |
| Mentions légales, confidentialité, CGU, signalement | `/mentions-legales`, `/confidentialite`, `/cgu`, `/signaler` |

Le pied de page de l'application affiche un lien « Site » vers WordPress quand la variable de build
`REACT_APP_MARKETING_URL` est renseignée (par exemple `https://www.cessionbatiment.fr`). Les e-mails envoyés par
l'application continuent de pointer vers l'application (`SITE_URL`).

## 2. Liens filtrés vers la page des annonces

La page des annonces (`/`) lit ses filtres dans l'adresse. Tous les paramètres sont facultatifs et se combinent.

| Paramètre | Valeurs | Exemple |
| --- | --- | --- |
| `metier` | un ou plusieurs identifiants de métier séparés par des virgules (tableau ci-dessous) | `metier=pac-clim-cvc,isolation` |
| `region` | identifiant de région (tableau ci-dessous) | `region=bretagne` |
| `departement` | code du département (`29`, `2A`, `974`…) ; doit appartenir à la région si elle est indiquée | `departement=29` |
| `rge` | `1` : entreprises RGE seulement ; `0` : sans RGE | `rge=1` |
| `prix_max` | prix demandé maximum, en euros | `prix_max=500000` |
| `ca_min` | chiffre d'affaires minimum, en euros | `ca_min=300000` |
| `effectif_min` | nombre minimum de salariés | `effectif_min=5` |
| `tri` | `recent` (défaut), `prix_asc`, `prix_desc` | `tri=prix_asc` |
| `page` | numéro de page (24 annonces par page) | `page=2` |

Les autres paramètres (par exemple `utm_source`, `utm_campaign`) sont conservés tels quels et n'ont pas d'effet sur
la recherche.

Exemples prêts à coller :

- Entreprises de PAC et climatisation en Bretagne :
  `https://app.cessionbatiment.fr/?metier=pac-clim-cvc&region=bretagne`
- Entreprises RGE d'isolation dans le Finistère, moins de 500 000 € :
  `https://app.cessionbatiment.fr/?metier=isolation&region=bretagne&departement=29&rge=1&prix_max=500000`
- Entreprises d'électricité d'au moins 5 salariés, les moins chères d'abord :
  `https://app.cessionbatiment.fr/?metier=electricite&effectif_min=5&tri=prix_asc`
- Entreprises de couverture en Auvergne-Rhône-Alpes, depuis une campagne :
  `https://app.cessionbatiment.fr/?metier=couverture-charpente&region=auvergne-rhone-alpes&utm_source=wordpress`

Métiers (`metier`) :

| Identifiant | Métier |
| --- | --- |
| `plomberie-chauffage` | Plomberie, chauffage, sanitaire |
| `pac-clim-cvc` | Pompes à chaleur, climatisation, CVC |
| `electricite` | Électricité générale |
| `isolation` | Isolation (ITE, ITI, combles) |
| `couverture-charpente` | Couverture, charpente, zinguerie |
| `menuiserie` | Menuiserie, fermetures, stores |
| `maconnerie-gros-oeuvre` | Maçonnerie, gros œuvre |
| `platrerie-peinture` | Plâtrerie, peinture, finitions |
| `carrelage-sols` | Carrelage, sols, parquets |
| `photovoltaique-enr` | Photovoltaïque, énergies renouvelables |
| `renovation-generale` | Rénovation générale, tous corps d'état |
| `terrassement-vrd` | Terrassement, VRD, réseaux |
| `etancheite` | Étanchéité, bardage |
| `serrurerie-metallerie` | Serrurerie, métallerie |
| `agencement` | Agencement, cuisines, salles de bains |
| `piscine-paysage` | Piscines, paysage, clôtures |

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

L'adresse `https://app.cessionbatiment.fr/embed/annonces` affiche une grille compacte des dernières annonces, sans
en-tête ni pied de page, suivie d'un lien « Voir toutes les annonces ». Elle accepte les mêmes paramètres que la page
des annonces (§ 2) et, en plus, `limit` : nombre d'annonces affichées, de 1 à 24 (6 par défaut). Les clics sur une
annonce ou sur « Voir toutes les annonces » ouvrent l'application dans l'onglet (pas dans l'iframe). La page n'est
pas indexée par les moteurs (`noindex`).

### 3.1 Autoriser le site WordPress (une fois, côté serveur)

Par défaut, aucune page de l'application ne peut être affichée dans une iframe d'un autre site. Pour le module
seulement, renseignez la variable d'environnement du conteneur frontend (nginx) :

```
EMBED_ALLOWED_ORIGINS=https://www.cessionbatiment.fr https://cessionbatiment.fr
```

- Une ou plusieurs origines (schéma + domaine, sans chemin), séparées par des espaces ; vide = aucune autre origine.
- Dans Dokploy : service frontend → onglet Environment, puis redéployer (pas besoin de reconstruire l'image :
  la valeur est appliquée au démarrage du conteneur).
- Effet : `/embed/…` est servi avec `Content-Security-Policy: … frame-ancestors 'self' <origines>` et sans
  `X-Frame-Options` ; toutes les autres pages gardent `X-Frame-Options: DENY` et `frame-ancestors 'none'`.

### 3.2 Bloc à coller dans WordPress

Dans l'éditeur de page, ajoutez un bloc « HTML personnalisé » et collez :

```html
<div class="cession-annonces">
  <iframe
    src="https://app.cessionbatiment.fr/embed/annonces?metier=pac-clim-cvc&region=bretagne&limit=6"
    title="Entreprises du bâtiment à vendre"
    loading="lazy"
    style="width: 100%; height: 640px; border: 0; display: block;"
    data-cession-embed></iframe>
</div>
<script>
  // Hauteur automatique : le module envoie sa hauteur à chaque rendu
  // ({ type: 'cession-embed-height', height }). Seuls les messages de l'application sont pris en compte.
  (function () {
    var APP_ORIGIN = 'https://app.cessionbatiment.fr';
    window.addEventListener('message', function (event) {
      if (event.origin !== APP_ORIGIN) return;
      var data = event.data || {};
      if (data.type !== 'cession-embed-height' || typeof data.height !== 'number') return;
      var frames = document.querySelectorAll('iframe[data-cession-embed]');
      for (var i = 0; i < frames.length; i++) {
        if (frames[i].contentWindow === event.source) {
          frames[i].style.height = Math.max(200, Math.ceil(data.height)) + 'px';
        }
      }
    });
  })();
</script>
```

- Plusieurs modules sur la même page : répétez seulement l'`<iframe … data-cession-embed>` ; un seul `<script>`
  suffit (il retrouve l'iframe qui a envoyé le message).
- La hauteur de 640 px n'est utilisée qu'avant le premier message (affichage immédiat sans saut).
- Si l'extension de sécurité du site (ou le thème) filtre les balises `<script>` dans les blocs, placez le script dans
  le pied de page du thème ou dans une extension d'ajout de code, sans le modifier.

Exemples de modules :

- 3 dernières annonces, toutes catégories : `/embed/annonces?limit=3`
- 6 annonces RGE, les plus récentes : `/embed/annonces?rge=1&limit=6`
- 9 annonces d'électricité en Île-de-France : `/embed/annonces?metier=electricite&region=ile-de-france&limit=9`

## 4. Boutons d'appel à l'action

Bloc « HTML personnalisé » (ou bloc « Boutons » de WordPress avec la même adresse) :

```html
<p>
  <a href="https://app.cessionbatiment.fr/register?role=seller"
     style="display: inline-block; padding: 14px 22px; border-radius: 12px; background: #0b1220; color: #fff;
            font-weight: 600; text-decoration: none;">
    Déposer une annonce
  </a>
  <a href="https://app.cessionbatiment.fr/estimer"
     style="display: inline-block; margin-left: 12px; padding: 13px 21px; border-radius: 12px; border: 1px solid #0b1220;
            color: #0b1220; font-weight: 600; text-decoration: none;">
    Estimer mon entreprise
  </a>
</p>
```

Libellés et adresses conseillés :

| Bouton | Adresse |
| --- | --- |
| Déposer une annonce | `/register?role=seller` (le cédant crée son compte puis son annonce anonyme) |
| Estimer mon entreprise | `/estimer` (sans compte ; propose ensuite de déposer l'annonce) |
| Voir les annonces | `/` ou un lien filtré (§ 2) |
| Recevoir les nouvelles annonces | `/#alerte` (alerte e-mail sans compte, en bas de la liste) |

## 5. Anciennes adresses

Les anciennes pages de l'application redirigent (301) vers la page des annonces, en conservant les filtres :

| Ancienne adresse | Nouvelle adresse |
| --- | --- |
| `/entreprises-a-vendre`, `/search`, `/buyer/search` | `/` (paramètres conservés et traduits : `metiers` → `metier`, `max_price` → `prix_max`…) |
| `/entreprises-batiment-a-vendre` | `/` |
| `/entreprises-batiment-a-vendre/metier/<métier>` | `/?metier=<métier>` |
| `/entreprises-batiment-a-vendre/region/<région>` | `/?region=<région>` |
| `/entreprises-rge-a-vendre` | `/?rge=1` |
| `/entreprises-rge-a-vendre/activite/<domaine RGE>` | `/?rge=1&metier=<métier correspondant>` |
| `/entreprises-rge-a-vendre/region/<région>` | `/?rge=1&region=<région>` |
| `/vendre-mon-entreprise-…` | page « vendre » du site WordPress si `SELLER_LANDING_URL` est renseignée (variable du conteneur frontend, ex. `https://www.cessionbatiment.fr/vendre-mon-entreprise/`), sinon `/estimer` (entrée du parcours cédant) |
| `/reprendre-une-entreprise-…`, `/guides`, `/guides/…`, `/verifier-entreprise-rge` | `/` |

Si ces contenus sont repris sous WordPress, mettez à jour les liens externes (fiches Google, réseaux, signatures)
vers les nouvelles adresses WordPress ; les redirections de l'application restent en place pour les anciens liens.

## 6. Vérifications après mise en place

1. `https://app.cessionbatiment.fr/?metier=isolation&region=bretagne` : le filtre « Isolation » est coché et la
   région « Bretagne » sélectionnée.
2. La page WordPress qui contient le module affiche les cartes sans barre de défilement interne ; un clic sur une
   annonce ouvre la fiche dans l'onglet, hors de l'iframe.
3. En-têtes : `curl -sI https://app.cessionbatiment.fr/embed/annonces` montre `frame-ancestors 'self' https://www…`
   et aucun `X-Frame-Options` ; `curl -sI https://app.cessionbatiment.fr/` montre `X-Frame-Options: DENY`.
4. Une page WordPress d'un autre domaine (non listé) ne peut pas afficher le module (le navigateur le bloque).
