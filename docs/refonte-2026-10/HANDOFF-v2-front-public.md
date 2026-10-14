# HANDOFF — chantier front « public » (accueil, pages publiques, SEO, routes)

Livré : `App.js` (routes API.md §10), `LandingPage`, `PublicSearch` (`/entreprises-a-vendre`), `SeoPages` (hub RGE conservé + hub bâtiment + `/metier/:slug` + `/region/:slug`), `AudiencePage` (4 pages), `GuidesPages` + 2 guides nouveaux, `LegalPages` (mentions, confidentialité, CGU, `/signaler`), `NotFound`, `PublicHeader` / `PublicFooter`, `seo/*` (jetons de marque, Organization avec carte T, modèles), `scripts/prerender.mjs` (83 routes, `--routes-only`), `scripts/seo-routes.json` = `backend/seo_routes.json`, suppression de `pages/CreditsPage.jsx`. Tests : `src/pages/__tests__/publicPages.test.jsx` (17 tests) + `src/components/shared/__tests__` (17) verts ; `npx eslint` propre sur tous les fichiers du chantier ; `pytest` backend vert (221).

Ce fichier liste ce que **d'autres fichiers** doivent faire pour que tout tienne ensemble. Rien ci-dessous n'a été modifié par ce chantier.

## 1. Backend (à appliquer par le chantier backend / l'intégrateur)

### 1.1 `GET /companies` : filtres d'API.md §2 + `X-Total-Count` (bloquant pour la recherche)

`server.py` ≈ ligne 1999 (`get_companies`) n'accepte que `status`, `sort`, `limit`. Le front appelle désormais :

```
GET /api/companies?trades=isolation,menuiserie&region=Bretagne&department=29&rge=true&min_price=100000&max_price=500000&sort=recent&limit=24&page=1
```

et lit l'en-tête `X-Total-Count` (sans lui, il compte les éléments reçus). Sketch à intégrer dans `get_companies` (après la construction de `query`) :

```python
# paramètres : trades: Optional[str] = None, region: Optional[str] = None, department: Optional[str] = None,
#              rge: Optional[str] = None, min_price: Optional[float] = None, max_price: Optional[float] = None,
#              page: Optional[int] = None  (+ response: Response pour l'en-tête)
if trades:
    ids = [t.strip() for t in trades.split(",") if t.strip() in taxonomy.TRADE_IDS]
    if ids:
        query["trades"] = {"$in": ids}
if region:
    query["region"] = region
if department:
    query["department"] = taxonomy.normalize_departement(department)
if rge in ("true", "1"):
    query["is_rge"] = True
elif rge in ("false", "0"):
    query["is_rge"] = {"$ne": True}
price = {}
if min_price is not None: price["$gte"] = min_price
if max_price is not None: price["$lte"] = max_price
if price: query["asking_price"] = price
limit = max(1, min(limit or 100, 100))
skip = (max(1, page or 1) - 1) * limit
total = await db.companies.count_documents(query)
cursor = db.companies.find(query, projection).sort(company_sort_criteria(sort)).skip(skip).limit(limit)
response.headers["X-Total-Count"] = str(total)
```

`company_sort_criteria` doit accepter `recent` (synonyme de `latest`), `price_asc`, `price_desc`. Les pages SEO appellent aussi `GET /companies?trades=<id>&sort=recent&limit=30`, `GET /companies?region=<région>&sort=recent&limit=30` et `GET /companies?region=<région>&rge=true` ; la page activité RGE garde `POST /companies/search {rge_types, sort, limit}`.

### 1.2 `GET /public/listing-stats` : comptages par métier (hub bâtiment, pré-rendu)

Ajouter `by_trade` (ids de `taxonomy.TRADES`) et, si possible, `by_department` à côté de `by_rge` / `by_region` :

```python
for t in c.get("trades") or []:
    by_trade[t] = by_trade.get(t, 0) + 1
...
"by_trade": [{"value": k, "count": v} for k, v in sorted(by_trade.items(), key=lambda x: -x[1])],
```

Le front n'affiche un compteur que s'il est > 0 ; le pré-rendu met `noindex, follow` sur les pages métier / région / activité dont le comptage au build est 0 (`PRERENDER_API_URL` ou `REACT_APP_BACKEND_URL` au build ; sans API joignable, pages indexables et React pose le `noindex` au chargement).

### 1.3 `events.py` : événement `report` (page `/signaler`)

`EVENT_NAMES` += `"report"`. La page envoie `POST /events {name:'report', path:'/signaler', props:{reason, reference, description, email}}` (props ≤ 500 caractères chacune, déjà tronquées côté front). Suggestion : faire remonter ces événements dans `GET /admin/todo` (section `reports`, action « Retirer avec motif »). Si l'événement est refusé (400), le front affiche un message et propose le `mailto:` prérempli, donc rien n'est perdu.

### 1.4 Sitemap sans fiches `/company/:id` (SPEC §5.2)

`server.py` `sitemap()` ajoute encore les annonces publiées, et `tests/test_lancement.py::test_public_stats_and_sitemap` l'exige. À retirer ensemble (fiches non pré-rendues). Le repli de `load_seo_routes()` cite encore `/search` : remplacer par `/entreprises-a-vendre`.

`backend/seo_routes.json` est à jour (copie identique de `frontend/scripts/seo-routes.json`, 83 routes ; `test_sitemap_matches_prerendered_routes` passe). Pour le régénérer sans build : `cd frontend && node scripts/prerender.mjs --routes-only && cp scripts/seo-routes.json ../backend/seo_routes.json`.

## 2. Pages créées par d'autres chantiers, importées par `App.js`

| Import | Route | Props passées | Attendu |
|---|---|---|---|
| `@/components/EmailVerificationBanner` | monté dans `App.js` sous `<BrowserRouter>` quand `user.email_verified === false` | `user`, `setUser` | bouton `POST /auth/resend-verification` ; `setUser` pour rafraîchir après confirmation. Tout 403 `{code:'email_not_verified'}` ou « Confirmez d'abord… » reçu par `axiosInstance` passe `email_verified=false` dans `localStorage.user` et émet l'événement `cession:email-not-verified` : le bandeau apparaît sans rechargement. |
| `@/pages/ConfirmEmailPage` | `/confirmer-email/:token` | `user`, `setUser` | `POST /auth/verify-email {token}` puis `setUser({...user, email_verified:true})` |
| `@/pages/EstimatePage` | `/estimer` | `user` | titre / description / H1 / intro disponibles dans `content.estimate` (`import { content, fillText } from '@/seo'`) : les reprendre dans `useSeo(fillText(content.estimate.title), fillText(content.estimate.description), { path: '/estimer' })` pour rester cohérent avec la coquille pré-rendue |
| `@/pages/VerifyRgePage` | `/verifier-entreprise-rge` | `user` | idem avec `content.verifyRge` |
| `@/pages/DataroomPage` | `/dataroom/:companyId` (protégée) | `user`, `setUser` | — |
| `@/pages/ClosingPage` | `/vente/:closingId` (protégée) | `user`, `setUser` | — |

Tant que ces fichiers n'existent pas, `npm run build` échoue sur les `lazy(() => import(...))` : ils doivent exister à l'intégration.

## 3. Pages existantes (autres chantiers) : ajustements demandés

- `RegisterPage.jsx` : lire `?role=seller` / `?role=buyer` (tous les CTA « Déposer mon annonce anonyme » pointent vers `/register?role=seller`).
- `CreateListing.jsx` : la route est `/seller/create` ; `/seller/edit/:id` redirige vers `/seller/create?edit=<id>` (`EditListingRedirect` dans `App.js`). Si le chantier préfère une vraie route d'édition, remplacer dans `App.js` l'élément de `/seller/edit/:id` par `<CreateListing user={user} />` et lire `useParams().id`. `/seller/create-listing` redirige vers `/seller/create` : mettre à jour le lien dans `SellerDashboard.jsx:468`.
- `SearchCompanies.jsx` n'est plus routé (`/buyer/search` → `/entreprises-a-vendre`) : à supprimer. Dans `BuyerDashboard.jsx`, remplacer `/buyer/search`, `/search?sort=latest`, `/search?sort=popular` par `SEARCH_PATH` (`@/lib/referentiels`) ; le tri « popular » n'existe plus dans API.md §2. Retirer `/credits/balance` et `/buyer/credits` (route désormais redirigée vers le tableau de bord).
- `CompanyDetail.jsx` : `navigate('/search')` / `goBack(navigate, '/search')` → `SEARCH_PATH` ; `navigate('/buyer/credits')` à retirer ; titres `| CessionRGE` → `` `| ${BRAND.name}` `` (ou `BRAND.verticalName` pour une annonce RGE) ; utiliser `listingTitle(company)` de `@/components/shared`.
- `LoginPage.jsx`, `ResetPasswordPage.jsx`, `ProfilePage.jsx`, `FollowupPage.jsx` : `aria-label="CessionRGE – accueil"` → `` `${BRAND.name} – accueil` `` ; « Accédez à votre compte CessionRGE » → `BRAND.name`. Le lien « mot de passe oublié » peut pointer vers `/mot-de-passe-oublie` (même page que `/reset-password`).
- `lib/seo.js` : ajouter `'/dataroom'`, `'/vente'`, `'/confirmer-email'`, `'/mot-de-passe-oublie'`, `'/signaler'` (optionnel) à `PRIVATE_PREFIXES` ; `DEFAULT_DESCRIPTION` parle encore de « LOI » et d'entreprises « certifiées RGE » : proposer `` `${OFFER.metaPlatform} : ${OFFER.metaMatching}` ``.
- `lib/analytics.js` : ajouter `'report'` à `EVENT_NAMES` si l'on veut passer par `trackEvent` (la page `/signaler` envoie aujourd'hui directement via `fetch`, donc sans dépendance).
- `lib/config.js` (`FREE_MODE`) n'est plus utilisé par `App.js` ; `CompanyDetail` / `BuyerDashboard` l'utilisent encore pour des textes « crédit » à retirer.

## 4. Contrat des contenus (pour qui touche `src/seo/*.json`)

- Jetons : `{{brand}}` (BRAND.name), `{{vertical}}` (CessionRGE, verticale RGE uniquement), `{{legalName}}`, `{{contactEmail}}`, `{{siteHost}}`, `{{hoguetArt6}}`, `{{fondsMention}}`, `{{carteT}}` + tous les jetons d'offre de `lib/offer.js`. Remplacement par `fillText` (`@/seo`) côté React et `fill()` dans `prerender.mjs`. Aucun « CessionRGE » ni « à compléter » en dur (test).
- `content.trades[id]` : `name` (« de plomberie-chauffage », pour les H1), `intro`, `points` (3) par métier ; `content.audiences` : 4 pages (`vendre-batiment`, `vendre`, `reprendre-batiment`, `reprendre`) avec `kind`, `preview` (ListingPreview), `timing` (« combien de temps ça prend »), `sections`, `faq`, `ctaPrimary` / `ctaSecondary` (`#alerte` = ancre du formulaire d'alerte).
- `guides.json` : 6 guides ; les deux nouveaux (`combien-vaut-entreprise-batiment` 1 398 mots, `qualification-rge-transmissible` 1 360 mots) sont sourcés depuis `docs/revue-2026-10/marche-rge.md` §3, §6, §7. Les guides existants ont été relus : marque, plus de « LOI » comme étape de la plateforme (l'offre indicative la remplace), vérificateur RGE → `/verifier-entreprise-rge`.
- Pages légales : `legal.mentions` (sections fixes ; éditeur, directeur de la publication, hébergeur, médiation calculés par `seo/legal.js` à partir de `GET /public/legal-info`), `legal.privacy` (durées SPEC §1, version du 10/10/2026), `legal.cgu` (13 articles, version du 10/10/2026), `legal.report` (`/signaler`). Le nom du représentant légal vient uniquement de l'API (`LEGAL_REPRESENTANT`) : aucune personne physique n'est nommée par défaut côté front.

## 5. Pré-rendu et déploiement

- `npm run build` = `craco build && node scripts/prerender.mjs` : 83 pages (accueil, recherche, hub bâtiment, 16 métiers, 14 régions, hub RGE, 18 activités, 14 régions RGE, 4 pages d'atterrissage, `/estimer`, `/verifier-entreprise-rge`, guides ×7, mentions, confidentialité, CGU, `/signaler`). `/search` n'est plus pré-rendu (redirection React) : en nginx, une `return 301 /entreprises-a-vendre$is_args$args;` sur `location = /search` évite le passage par le bundle.
- Le dossier `frontend/build` (artefact ignoré par git) a été supprimé après un test local du pré-rendu sur un `index.html` factice ; `npm run build` le régénère.
- Variables : `REACT_APP_BRAND_NAME`, `REACT_APP_SITE_URL`, `REACT_APP_CONTACT_EMAIL` (lues par `lib/brand.js` et le pré-rendu) ; `PRERENDER_API_URL` (facultatif) pour que le build lise `legal-info` et `listing-stats`.
- Polices auto-hébergées, `GENERATE_SOURCEMAP=false`, aucun script tiers : inchangé.
