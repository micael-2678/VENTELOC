# HANDOFF — agent « app-annonces » (front) : MODE-TEST-ET-APP.md partie A

Chantier : recentrage de l'application sur ses parcours et sur la page publique des annonces (A.1 à A.5).
Tout ce qui est décrit ci-dessous dans « À appliquer » touche des fichiers hors de mon périmètre.

## 1. Ce qui est livré

| Sujet | Fichiers |
| --- | --- |
| Pages marketing supprimées (accueil, vendre/reprendre, guides, hubs bâtiment/RGE, vérificateur RGE, ancienne recherche) | `pages/{LandingPage,AudiencePage,GuidesPages,SeoPages,VerifyRgePage,PublicSearch}.jsx`, `seo/guides.json`, `seo/models.js`, `components/shared/{TrustBar,ProcessTabs,CommissionCalculator,OperatorCard,ListingPreview,brandDefaults}`, `components/layout/{PublicHeader,PublicFooter}.jsx` (supprimés ; aucun import restant, vérifié par grep) |
| Contenus | `seo/content.json` réduit à `header`, `footer`, `listings`, `estimate`, `legal`, `notFound` ; `seo/index.js`, `seo/inline.js`, `seo/schema.js` (`faqLd`, `articleLd`, SearchAction retirés), `components/seo/Content.jsx` (briques des guides retirées) |
| Page des annonces `/` | `pages/ListingsPage.jsx`, `components/shared/ListingFilters.jsx`, `components/shared/listingFilters.js` (URL ↔ filtres ↔ API, anciens paramètres, correspondances des anciennes pages), `components/shared/ListingCard.jsx` (refaite), `components/shared/formatters.js` (`formatCompactEuros`, `relativeDateFr`) |
| Coque | `components/layout/AppHeader.jsx`, `AppFooter.jsx`, `AppLayout.jsx`, `session.js` (contexte `{user, setUser}` fourni par App.js), `PublicLayout.jsx` (alias d'AppLayout gardé pour EstimatePage), `components/shared/buttonStyles.js` |
| Module WordPress | `pages/EmbedListingsPage.jsx` (`/embed/annonces`), `docs/WORDPRESS.md` |
| Routage | `App.js` : `/` = annonces, `/embed/annonces`, `/test` (lazy `pages/TestModePage`), `<TestModeBanner />` au-dessus de tout (sauf `/embed/…`), redirections des anciennes URL, table des routes exportée (`AppRoutes`) pour les tests, intercepteur 401 qui respecte `config.skipAuthRedirect` |
| Serveur | `frontend/nginx.conf` (301 des anciennes URL, `location ^~ /embed/` sans X-Frame-Options avec `frame-ancestors 'self' ${EMBED_ALLOWED_ORIGINS}`), `frontend/Dockerfile` (gabarit `/etc/nginx/templates`, `NGINX_ENVSUBST_FILTER`, `ENV EMBED_ALLOWED_ORIGINS=""`, `ARG/ENV REACT_APP_MARKETING_URL`), `frontend/.env.example` |
| SEO / pré-rendu | `scripts/prerender.mjs` (/, /estimer, 4 pages légales ; robots.txt : `/embed/` et `/test` exclus), `scripts/seo-routes.json` = `backend/seo_routes.json` (6 routes), `lib/seo.js` (`/embed`, `/test` en noindex, `isPrivatePath` exportée) |
| Fiche annonce | `pages/CompanyDetail.jsx` : AppHeader/AppFooter, fil d'Ariane « Annonces › métier › Annonce » vers `/` et `/?metier=…`, puces métier et lien bas de page vers `/` |
| Tests | `pages/__tests__/listingsPage.test.jsx` (21), `redirects.test.jsx` (20), `publicPages.test.jsx` (réécrit, 9), `components/shared/__tests__/shared.test.jsx` (adapté) |

Vérifications : `npx eslint` propre sur tous mes fichiers ; `CI=true npx craco test --watchAll=false` : 13 suites, 158 tests verts ;
`pytest -q` : 309 verts ; `ops/tests/test_nginx.sh` patché (§ 2.1) : tous les contrôles passent. Contrôle visuel sur une
copie du build dans le scratchpad (Playwright, 1366 / 820 / 390 px) : aucun débordement horizontal (scrollWidth = largeur).

### Choix à connaître

- **GET /companies sans jeton** (axios nu) : un cédant connecté recevrait sinon ses propres annonces (comportement
  « owner_view » de l'API). Les favoris et les non-lus passent par `axiosInstance` avec `{ skipAuthRedirect: true }` :
  une session expirée ne renvoie plus vers /login depuis une page publique.
- **CA minimum / effectif minimum** : GET /companies ne les filtre pas encore. La page envoie déjà `min_ca` et
  `min_staff` (ignorés par l'API), lit les résultats par lots de 100 (10 lots au plus) et filtre dans le navigateur ;
  le total et la pagination portent alors sur les annonces retenues. Dès que l'API filtre (§ 2.3), rien à changer côté
  front (le filtre client devient sans effet) ; on pourra ensuite supprimer le chemin « lots de 100 » de
  `fetchListings`.
- **Sitemap / pré-rendu** : `/login` et `/register` ne sont **pas** dans `seo-routes.json` (pages `noindex` de
  `lib/seo.js` : les déclarer dans le sitemap produirait « URL envoyée marquée noindex » dans la Search Console).
  Routes : `/`, `/estimer`, `/mentions-legales`, `/confidentialite`, `/cgu`, `/signaler`.
- **En-têtes des espaces connectés conservés** (SellerDashboard, MessagesPage, ProfilePage, CreateListing, MandatePage,
  AdminDashboard, `components/buyer/ConnectedShell`) : chacun porte des actions propres (retour, titre de page,
  « Brouillon enregistré », « Lancer les tâches », déconnexion admin) et des `data-testid` utilisés par les tests ;
  les remplacer n'était ni simple ni sans risque en parallèle des autres chantiers. Plan en § 2.6.
- **En-tête non collant** (statique) : aucun titre recouvert ; le bandeau du mode test et le bandeau e-mail sont au-dessus.
- **Classes héritées de `src/App.css`** : `.badge` (display inline-block, padding 6 × 14), `.btn-primary` / `.btn-secondary`
  (padding 12 × 24, fond beige) et `.card:hover` (translateY) sont chargées après `index.css` et écrasent le système de
  design. Mes composants n'utilisent plus `.badge`/`.btn-*` (utilitaires de `components/shared/buttonStyles.js`). Voir § 2.5.
- Le libellé « indifférent » du filtre RGE est « Toutes » (« Indifférent » débordait dans la colonne de 18 rem).

## 2. À appliquer (hors de mon périmètre)

### 2.1 `ops/tests/test_nginx.sh` — obligatoire (le script actuel échoue)

Deux raisons : nginx ne démarre plus sans substitution de `${EMBED_ALLOWED_ORIGINS}` (variable du gabarit), et
`/search` redirige désormais vers `/` (spécification A.1) et non plus vers `/entreprises-a-vendre`. Patch vérifié
(`git apply --check` OK, 28 contrôles verts) :

```diff
--- a/ops/tests/test_nginx.sh
+++ b/ops/tests/test_nginx.sh
@@ -1,13 +1,16 @@
 #!/usr/bin/env bash
 # Tests de non-régression de frontend/nginx.conf avec un vrai nginx (sans Docker) :
-# adresse IP du client (X-Forwarded-For non falsifiable), redirection 301 de /search, cache des fichiers versionnés,
-# CSP sans 'unsafe-inline' pour les scripts. Usage : ops/tests/test_nginx.sh (nginx et python3 requis).
+# adresse IP du client (X-Forwarded-For non falsifiable), redirections 301 des anciennes URL vers la page des annonces,
+# module /embed/ affichable en iframe (frame-ancestors EMBED_ALLOWED_ORIGINS, sans X-Frame-Options), cache des
+# fichiers versionnés, CSP sans 'unsafe-inline' pour les scripts. Usage : ops/tests/test_nginx.sh (nginx et python3 requis).
 set -uo pipefail
 
 ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
 WORK="$(mktemp -d)"
 chmod 755 "$WORK"  # lisible par les workers nginx (utilisateur nobody quand nginx est lancé en root)
 NGINX_PORT="${NGINX_TEST_PORT:-18089}"
+# Valeur de EMBED_ALLOWED_ORIGINS simulée (substituée au démarrage du conteneur, voir frontend/Dockerfile)
+EMBED_ORIGIN="https://wp.exemple.fr"
 BACKEND_PORT="${BACKEND_TEST_PORT:-18098}"
 failures=0
 cleanup() {
@@ -51,6 +54,7 @@
       -e "s#root /usr/share/nginx/html;#root $WORK/html;#" \
       -e "s#resolver 127.0.0.11 valid=30s ipv6=off;#resolver 127.0.0.1;#" \
       -e "s#http://cessionbatiment-api:8001#http://127.0.0.1:$BACKEND_PORT#" \
+      -e "s#\${EMBED_ALLOWED_ORIGINS}#$EMBED_ORIGIN#" \
       "$ROOT/frontend/nginx.conf" > "$site"
   # Sans confiance dans 127.0.0.1, le client de test se comporte comme un visiteur public qui atteint nginx directement
   [ "$1" = "1" ] || sed -i '/set_real_ip_from 127.0.0.1;/d' "$site"
@@ -84,13 +88,30 @@
 c="$(curl -s -H 'X-Forwarded-For: 9.9.9.9, 203.0.113.7' "$url/api/x")"
 check "derrière un proxy de confiance → adresse réelle seule (« $c »)" test "$c" = "203.0.113.7"
 
-# 3. /search : 301 sans paramètres, gabarit SPA avec paramètres hérités
-code="$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$url/search")"
-check "/search → 301 /entreprises-a-vendre (« $code »)" bash -c "[[ '$code' == 301*'/entreprises-a-vendre' ]]"
-code="$(curl -s -o /dev/null -w '%{http_code}' "$url/buyer/search")"
-check "/buyer/search → 301" test "$code" = "301"
-body="$(curl -s "$url/search?rge_type=pac")"
-check "/search?rge_type=… → gabarit SPA (conversion côté client)" test "$body" = "<html>app</html>"
+# 3. Anciennes URL → page des annonces (301), requête conservée pour l'ancienne recherche
+redirect_of() { curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$url$1"; }
+check "/search → 301 /" test "$(redirect_of /search)" = "301 $url/"
+check "/buyer/search → 301 /" test "$(redirect_of /buyer/search)" = "301 $url/"
+check "/search?rge_type=… → 301 /?rge_type=… (conversion côté client)" test "$(redirect_of '/search?rge_type=pac')" = "301 $url/?rge_type=pac"
+check "/entreprises-a-vendre?metiers=… → 301 /?metiers=…" test "$(redirect_of '/entreprises-a-vendre?metiers=isolation')" = "301 $url/?metiers=isolation"
+check "hub métier → /?metier=" test "$(redirect_of /entreprises-batiment-a-vendre/metier/isolation)" = "301 $url/?metier=isolation"
+check "hub région → /?region=" test "$(redirect_of /entreprises-batiment-a-vendre/region/bretagne)" = "301 $url/?region=bretagne"
+check "hub RGE → /?rge=1" test "$(redirect_of /entreprises-rge-a-vendre)" = "301 $url/?rge=1"
+check "activité RGE → /?rge=1&metier=" test "$(redirect_of /entreprises-rge-a-vendre/activite/pompes-a-chaleur-air-eau)" = "301 $url/?rge=1&metier=pac-clim-cvc"
+check "activité RGE inconnue → /?rge=1" test "$(redirect_of /entreprises-rge-a-vendre/activite/inconnue)" = "301 $url/?rge=1"
+check "région RGE → /?rge=1&region=" test "$(redirect_of /entreprises-rge-a-vendre/region/corse)" = "301 $url/?rge=1&region=corse"
+for old in /vendre-mon-entreprise-batiment /reprendre-une-entreprise-rge /guides /guides/combien-vaut-entreprise-batiment /verifier-entreprise-rge; do
+  check "$old → 301 /" test "$(redirect_of "$old")" = "301 $url/"
+done
+
+# 3 ter. Module intégrable : affichable en iframe depuis EMBED_ALLOWED_ORIGINS seulement ; ailleurs DENY
+e="$(curl -sI "$url/embed/annonces?limit=6" | tr -d '\r')"
+check "/embed/annonces → 200 (gabarit SPA)" bash -c "grep -q '^HTTP/1.1 200' <<<\"\$1\"" _ "$e"
+check "/embed/ : pas de X-Frame-Options" bash -c "! grep -qi '^x-frame-options:' <<<\"\$1\"" _ "$e"
+check "/embed/ : frame-ancestors 'self' $EMBED_ORIGIN" bash -c "grep -q \"frame-ancestors 'self' $EMBED_ORIGIN;\" <<<\"\$1\"" _ "$e"
+check "/embed/ : en-têtes de sécurité conservés, noindex" bash -c "grep -qi '^x-content-type-options: nosniff' <<<\"\$1\" && grep -qi '^x-robots-tag: noindex' <<<\"\$1\"" _ "$e"
+a="$(curl -sI "$url/" | tr -d '\r')"
+check "/ : X-Frame-Options DENY et frame-ancestors 'none'" bash -c "grep -qi '^x-frame-options: DENY' <<<\"\$1\" && grep -q \"frame-ancestors 'none'\" <<<\"\$1\"" _ "$a"
 
 # 3 bis. www → domaine principal
 loc="$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' -H 'Host: www.exemple.fr' "$url/entreprises-a-vendre?x=1")"
```

### 2.2 `docker-compose.yml`, `.env.example` racine, `DOKPLOY_DEPLOYMENT.md`

Service `frontend` :

```yaml
    build:
      args:
        # … arguments existants …
        # Site vitrine WordPress (lien « Site » du pied de page), facultatif
        - REACT_APP_MARKETING_URL=${MARKETING_URL:-}
    environment:
      # Origines autorisées à afficher /embed/annonces dans une iframe (site WordPress), séparées par des espaces
      - EMBED_ALLOWED_ORIGINS=${EMBED_ALLOWED_ORIGINS:-}
```

`.env.example` racine : documenter `MARKETING_URL=` (ex. `https://www.cessionbatiment.fr`) et
`EMBED_ALLOWED_ORIGINS=` (ex. `https://www.cessionbatiment.fr https://cessionbatiment.fr`).
`DOKPLOY_DEPLOYMENT.md` : section « Site WordPress » renvoyant à `docs/WORDPRESS.md` (variable d'exécution du conteneur
frontend, pas besoin de reconstruire l'image ; `MARKETING_URL` est une variable de build). Si le site WordPress prend le
domaine principal, l'application doit passer sur un sous-domaine (`SITE_URL`, `REACT_APP_SITE_URL`, domaine Dokploy) ;
la règle `www.<domaine> → <domaine>` de nginx ne concerne que les hôtes routés vers le conteneur.

### 2.3 Backend : `GET /companies` — chiffre d'affaires et effectif minimum (API.md §2)

`server.py`, `get_companies` : ajouter `min_ca: Optional[float] = None, min_staff: Optional[int] = None` et les passer
à `listing_filters` ; dans `listing_filters`, ajouter `min_staff` :

```python
    if min_staff:
        query["staff_count"] = {"$gte": int(min_staff)}
```

(`min_ca` y est déjà géré pour `POST /companies/search`). Test : `GET /companies?min_ca=500000&min_staff=5` exclut une
annonce à 400 000 € de CA et une à 3 salariés. API.md §2 : ajouter `min_ca`, `min_staff` à la liste des paramètres.

### 2.4 Liens internes encore vers les anciennes URL (fonctionnent grâce aux redirections, à nettoyer)

- `lib/referentiels.js` : `SEARCH_PATH = '/'` et `searchPath()` → écrire `metier=` (et non `metiers=`) et la région en
  identifiant (`slugify`) — ou remplacer ses usages par `listingsPath()` de `components/shared/listingFilters.js` ;
  supprimer `SEO_HUB_PATH`, `BUILDING_HUB_PATH`, `tradePath`, `rgeTypePath`, `regionPath`, `buildingRegionPath`.
  Mettre à jour `backend/tests/test_taxonomy.py` lignes 67-69 (elles exigent ces trois constantes telles quelles).
- Usages de `SEARCH_PATH` : `components/buyer/ConnectedShell.jsx:38`, `pages/BuyerDashboard.jsx:132,196`,
  `pages/MessagesPage.jsx:201` ; test `pages/__tests__/buyerPages.test.jsx:406` attend `/entreprises-a-vendre` → `/`.
- `pages/EstimatePage.jsx` : ligne 6 `PublicLayout` → `AppLayout` (`@/components/layout/AppLayout`), puis supprimer
  `components/layout/PublicLayout.jsx` ; ligne 438, le lien « Comment se passe une vente » vise
  `/vendre-mon-entreprise-batiment` (redirigé vers `/`) : le retirer ou viser `/register?role=seller`. Le fil d'Ariane
  « Accueil » (`/`) reste juste (accueil = annonces).
- `docs/refonte-2026-10/API.md` §10 : routes publiques = `/` (annonces), `/embed/annonces`, `/company/:id`, `/estimer`,
  pages légales, `/login`, `/register`, … `/test` ; anciennes URL redirigées (MODE-TEST-ET-APP.md §A.1).

### 2.5 `src/App.css` : règles héritées en conflit avec le système de design

Supprimer (ou restreindre) `.card` / `.card:hover` (ombre + translateY), `.btn-primary` (+ `::before`, `:hover`),
`.btn-secondary`, `.badge` et `.badge-*` : `index.css` (@layer components) les définit déjà, mais App.css, chargé
après, gagne. Effet visible aujourd'hui : boutons `btn-primary px-4 py-2` rendus en 12 × 24 px, `btn-secondary` beige
sans bordure, pastilles `.badge` en bloc avec l'icône au-dessus du texte (fiche annonce, tableaux de bord). À vérifier
visuellement sur les espaces connectés après suppression.

### 2.6 Coque unique pour les espaces connectés (suite proposée)

Remplacer le bloc `<nav className="nav-bar">…</nav>` de SellerDashboard, MessagesPage, ProfilePage, CreateListing,
MandatePage et la barre de `components/buyer/ConnectedShell.jsx` par `<AppHeader user={user} setUser={setUser} />`,
puis déplacer dans un bandeau de page (sous l'en-tête) ce qui est propre à la page : bouton retour (`back-btn`), titre,
« Brouillon enregistré » (`saved-at`). AdminDashboard garde ses actions (`admin-refresh`, `admin-run-jobs`) dans ce
bandeau ; la déconnexion passe par le menu du compte (`logout-btn` au lieu de `admin-logout` / `nav-logout`).
AppHeader affiche déjà les non-lus (`header-unread`, GET /messages/conversations, cache d'une minute) : le badge
`unread-badge` de SellerDashboard devient redondant. Adapter les tests qui ciblent les anciens `data-testid`.

### 2.7 Divers

- `src/lib/testMode.js:93` (agent mode-test-front) : `// eslint-disable-next-line react-hooks/exhaustive-deps` fait
  échouer `npm run lint` (« Definition for rule 'react-hooks/exhaustive-deps' was not found » : le plugin react-hooks
  n'est pas chargé par `eslint.config.mjs`). Retirer le commentaire.
- `App.js` passe `user` et `setUser` à `TestModePage` (route `/test`, chargée à la demande) et monte `TestModeBanner`
  (import statique) au-dessus de l'en-tête, sauf sur `/embed/…`.
- Tests adaptés hors de mon dossier (suppressions de pages) : `components/account/__tests__/account.test.jsx`
  (bloc VerifyRgePage retiré), `components/seller/__tests__/uxVague3.test.jsx` (test `noOrphan` de l'accueil retiré),
  `components/__tests__/vague3.test.jsx` (import `footerLegalLines` depuis `@/seo/legal`).
- Une partie des suppressions a été faite avec `git rm` (déjà indexées) ; les autres modifications ne sont pas indexées.
- `frontend/build/` contient encore les pages marketing pré-rendues de l'ancien build : `npm run build` le vide.
- `scripts/journeys/01-public.js` (Playwright) réécrit pour la page des annonces, les redirections, `/embed/annonces` et
  le panneau de filtres mobile ; `03-buyer.js` part de `/`. Non rejoués ici (ils exigent le backend de test et
  `seed.json`) : à rejouer en intégration comme prévu (HANDOFF-vague-2.md).
