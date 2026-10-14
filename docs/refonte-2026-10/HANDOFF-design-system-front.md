# HANDOFF — agent « design-system-front »

Chantier : SPEC §5.3 (direction design, composants partagés), §7.6 (ErrorBoundary, sourcemap, polices
auto-hébergées, pdf.js embarqué, statistiques maison côté front), §3.1 côté front (`lib/offer.js`).

## 1. Ce qui est livré (fichiers du chantier)

| Fichier | Contenu |
|---|---|
| `frontend/src/index.css` | Jetons de design en variables CSS (`--navy #0b1220`, `--surface #f5f7fa`, `--line #e3e7ee`, `--action #1d4ed8`, `--verified #15803d`, `--amber #b45309`…), variables HSL des composants ui alignées, focus visible sur tous les liens / liens-cartes / onglets, `.tabular`, classes `.btn-primary` `.btn-secondary` `.btn-outline` `.btn-link` `.card` (avec `min-w-0`) `.card-hover` `.card-link` `.eyebrow` `.section-title` `.badge` `.badge-verified` (vert, vérification uniquement) `.badge-declared` `.badge-locked` `.badge-success/warning/info/danger` `.stat-card` `.nav-bar` `.input-field` `.spinner` `.filter-sidebar` `.notice-amber` `.section-dark`, et `table.table-stack` (tableau → liste sous 640 px, `data-label` sur chaque `<td>`). Toutes les classes déjà utilisées par les pages sont conservées. |
| `frontend/tailwind.config.js` | Palette `brand.*` (navy, navy-light, ink, green, green-dark, green-soft, blue, blue-soft, amber, amber-soft, surface, line) ; **`text-xs` relevé à 13 px / 1,4** (aucun texte engageant sous 13 px, sans toucher aux pages). |
| `frontend/package.json`, `frontend/package-lock.json` | `@fontsource/inter`, `@fontsource/manrope` ; `build` = `GENERATE_SOURCEMAP=false craco build && node scripts/prerender.mjs`. Lockfile npm créé (il n'y en avait aucun). |
| `frontend/.env.production` | `GENERATE_SOURCEMAP=false` ajouté. |
| `frontend/public/index.html` | Liens Google Fonts supprimés ; `theme-color` `#0b1220` ; méta neutres (pas de nom de marque ni de domaine en dur ; le pré-rendu écrit les méta par route). |
| `frontend/src/index.js` | Polices auto-hébergées (`@fontsource/inter/latin-400/500/600/700`, `@fontsource/manrope/latin-700/800`, `font-display: swap`), `<ErrorBoundary>` autour de `<App/>`. |
| `frontend/src/components/ErrorBoundary.jsx` | Page d'erreur en français (bouton « Recharger la page », lien accueil, e-mail de contact depuis `BRAND.contactEmail`), envoi `POST /api/events {name:'front_error', props:{message, component}}`. Export `reportFrontError(error, info)`. |
| `frontend/src/lib/analytics.js` | Plausible supprimé. `trackEvent(name, props)`, `trackPageView(path)`, `initAnalytics()` (page vue initiale + `pushState`/`replaceState`/`popstate`, dédoublonnage 1 s), `sendEvent`, `sanitizeProps`, `EVENT_NAMES`. Envoi `fetch` keepalive, `credentials: 'omit'`, aucun cookie. Les anciens libellés `Premier contact` / `Alerte créée` / `Inscription` sont traduits en `contact_sent` / `alert_created` / `register_completed` ; tout nom hors de la liste fermée du serveur est ignoré silencieusement (pas de 400). |
| `frontend/src/lib/offer.js` | Barème 6 % HT / 3 % HT > 1 M€ / minimum 4 000 € HT (`REACT_APP_COMMISSION_MIN_HT`), cédant débiteur, HT d'abord. `computeCommission(price)` → `{ht, vat, ttc, appliedMinimum, ratePercent, ratePercentLabel, rateHT, computedHT, minimumHT, breakdown, payer}`. Exports conservés : `COMMISSION`, `formatEuros`, `formatRate`, `rateLabel`, `commissionRateFor`, `commissionRows`, `COMMISSION_TABLE`, `OFFER` (toutes les clés existantes + `commissionSentence`, `commissionShort`, `heroOfferLine`, `minimumNote`, `includesTitle`, `includes[]`, `negotiationNote`, `estimateCta`), `fillOffer` ; ajout `commissionLabel(price)`. Plus aucun « Lehman », « tranches successives », « 12 % TTC », aucun choix de débiteur, aucun nom de marque en dur. |
| `frontend/src/components/SecurePdfViewer.jsx` | Worker pdf.js embarqué : `new URL('pdfjs-dist/build/pdf.worker.min.js', import.meta.url)` (copié dans `build/static/media`), plus aucun CDN. |
| `frontend/src/components/shared/` | `ListingCard`, `TrustBar`, `ProcessTabs`, `CommissionCalculator`, `OperatorCard`, `BuyerCard`, `AlertForm`, `Checklist`, `ListingPreview` + `formatters.js`, `brandDefaults.js`, `index.js` (barrel). |

Vérifications :
- `npx eslint` (config plate fournie en §3.1, chargée depuis le scratchpad) : aucune erreur sur
  `src/components/shared`, `ErrorBoundary.jsx`, `lib/offer.js`, `lib/analytics.js`, `SecurePdfViewer.jsx`, `index.js`.
- `CI=true npx craco test --watchAll=false` : **17 tests, 17 réussis** (`src/components/shared/__tests__/shared.test.jsx`) :
  barème (montants identiques à `business_model.calculate_commission` sur 0 / 50 000 / 123 456,78 / 180 000 / 2 M €),
  `sanitizeProps`, traduction des anciens noms d'événements, dédoublonnage des pages vues, page d'erreur +
  `front_error`, `ListingCard` (titre généré, badges, prix fr-FR, lien, événement), `TrustBar`, `OperatorCard`
  (aucune personne), `ListingPreview`, `ProcessTabs` (aria + flèches/Fin), `CommissionCalculator` (HT puis TTC,
  minimum, `calc_used` une fois), `AlertForm` (e-mail invalide, POST, succès, 429), `Checklist`, `BuyerCard`.
  Pour que Jest (v27 de react-scripts) fonctionne : `package.json` → `jest.moduleNameMapper` (`@/` → `src/`,
  `react-router/dom` → fichier CJS de react-router, le Jest 27 ne lisant pas les `exports`) et
  `src/components/shared/jestEnv.js` (polyfill `TextEncoder` pour react-router 7, importé en tête du test ;
  à déplacer dans `src/setupTests.js` si d'autres tests front arrivent).
- Le même barème est aussi vérifié dans le bac à sable `node:vm` du pré-rendu (`scratchpad/tests/offer.test.mjs`).
- `npm run build` : **réussi** (« Compiled successfully », aucun avertissement), 44 pages pré-rendues, aucun `.map`
  dans `build/static/js`, `pdf.worker.min.<hash>.js` émis dans `build/static/media`, 12 fichiers de police
  auto-hébergés, zéro référence à `fonts.googleapis.com` dans le HTML produit. Les composants partagés ne sont pas
  encore importés par une page, donc le build ne les compile pas : ils sont compilés et rendus par la suite Jest.

## 2. Mode d'emploi des composants (pour les agents pages)

```jsx
import { ListingCard, TrustBar, ProcessTabs, CommissionCalculator, OperatorCard, BuyerCard, AlertForm, Checklist, ListingPreview } from '@/components/shared';
```

- `<ListingCard company={c} source="home" compact headingLevel="h3" />` — `company` au format API (`id`, `title`,
  `trades`, `rge_types`, `other_qualifications`, `is_rge`, `company_checks.in_ademe_list`, `region`, `department`,
  `staff_count`, `ca_n`, `asking_price`, `published_at`/`created_at`, `commission_payer` hérité). Lien vers
  `/company/:id`, événement `listing_card_click {listing, source}`. Badge vert « RGE vérifié ADEME » seulement si
  RGE et `in_ademe_list !== false`, sinon « Qualifications déclarées » (gris). Titre généré si `title` absent.
  Exports utilitaires : `listingTitle(company)`, `qualificationBadge(company)`.
- `<TrustBar />` — 4 sceaux (carte T depuis `LEGAL`, ADEME, identité, art. 6 loi Hoguet) ; `items` pour surcharger.
- `<ProcessTabs defaultTab="cedant" />` — onglets `tablist/tab/tabpanel`, flèches / Début / Fin ; `tabs` et `note`
  surchargeables (`DEFAULT_PROCESS_TABS`, `DEFAULT_PROCESS_NOTE`).
- `<CommissionCalculator defaultPrice={180000} source="home" showExplainer />` — HT en gros, TTC en dessous, texte
  `OFFER.commissionSentence`, événement `calc_used {source, price}` (une fois par affichage).
- `<OperatorCard legalInfo={reponseDeLegalInfo} />` — AlterEgo SAS, carte T, règles, e-mail ; aucune personne.
- `<BuyerCard buyer={carte} message={texte} title="Projet de reprise" />` — `project_type`, `budget_max`, `apport`,
  `financing`, `zones`, `trades`, `horizon`, `siren_verified`, `profile_score`, `email_verified`, `experience`.
  Tables de libellés exportées : `PROJECT_TYPES`, `FINANCING`, `HORIZONS`.
- `<AlertForm source="seo-page" defaultTrades={['isolation']} defaultRegions={['Bretagne']} compact onCreated={fn} />`
  — `POST /api/alerts/public {email, trades, regions, max_price|null}` ; succès « Vérifiez votre boîte mail » ;
  événement `alert_created`.
- `<Checklist title="Avant l'accès aux documents" items={[{ id, label, description, state: 'done'|'current'|'todo', action }]} />`.
- `<ListingPreview />` — visuel du hero (fausse annonce, badges, cadenas), `data` pour changer les valeurs.
- Formats : `formatPrice`, `formatMagnitude` (« ≈ 1 150 000 € »), `formatDateFr`, `plural`, `deActivity`.
- Marque : les composants lisent `BRAND`/`LEGAL` via `import * as brand from '@/lib/brand'` avec des valeurs par
  défaut pour chaque clé (`brandDefaults.js`), donc rien ne casse si une clé manque.

## 3. À appliquer ailleurs (hors de mes fichiers)

1. **`frontend/eslint.config.mjs` (nouveau)** — il n'existe aucune configuration ESLint ; `npx eslint` échoue
   sans elle. Contenu testé (chargé depuis le scratchpad pendant ce chantier) :
   ```js
   import js from '@eslint/js';
   import react from 'eslint-plugin-react';
   import jsxA11y from 'eslint-plugin-jsx-a11y';
   import globals from 'globals';
   export default [
     js.configs.recommended,
     { ignores: ['build/**', 'node_modules/**', 'plugins/**'] },
     {
       files: ['**/*.{js,jsx,mjs}'],
       plugins: { react, 'jsx-a11y': jsxA11y },
       languageOptions: { ecmaVersion: 2023, sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } },
         globals: { ...globals.browser, ...globals.node, ...globals.es2021 } },
       settings: { react: { version: '19.0' } },
       rules: { ...react.configs.recommended.rules, ...react.configs['jsx-runtime'].rules,
         ...jsxA11y.configs.recommended.rules, 'react/prop-types': 'off',
         'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }] },
     },
   ];
   ```
   et dans `package.json` : `"lint": "eslint src"`.
2. **`frontend/.npmrc` (nouveau)** : `legacy-peer-deps=true`. `npm install` refuse le conflit préexistant
   `date-fns@4` / `react-day-picker@8` (peer `^2 || ^3`) ; le lockfile a été généré avec `--legacy-peer-deps`.
   Le `Dockerfile` utilise `yarn install` (pas de `yarn.lock`) : soit passer à `COPY package-lock.json` +
   `npm ci --legacy-peer-deps`, soit garder yarn. Dans le `Dockerfile`, supprimer `REACT_APP_PLAUSIBLE_DOMAIN` et
   `REACT_APP_LEGAL_DRAFT`, ajouter `ARG REACT_APP_BRAND_NAME`, `REACT_APP_SITE_URL`, `REACT_APP_CONTACT_EMAIL`,
   `REACT_APP_COMMISSION_MIN_HT`.
3. **`frontend/src/components/seo/Content.jsx` ligne 56** (`CommissionTable`) : HT d'abord →
   `<td><strong>{r.rateHT}</strong> ({r.rateTTC})</td>`.
4. **`frontend/scripts/prerender.mjs`** : ligne 130 même correction (`<strong>${esc(r.rateHT)}</strong> (${esc(r.rateTTC)})`) ;
   ligne 423 `og:site_name` et ligne 432 `og:image:alt` écrits en dur « CessionRGE » → `BRAND.name` ; le bac à sable
   `loadShared` doit fournir `process.env` (`vm.runInNewContext(code, { process: { env: process.env } })`) car
   `lib/brand.js` le lit (`lib/offer.js` tolère son absence).
5. **`frontend/src/pages/MandatePage.jsx` ligne 174** : `estimateText` affiche TTC d'abord →
   `` `≈ ${formatEuros(estimate.ht)} HT (${formatEuros(estimate.ttc)} TTC)` `` (ou `commissionLabel(price)`).
   Le choix `commission_payer` de cette page disparaît (SPEC §3.1).
6. **Événements dans les pages** (`grep -rn "trackEvent(" src/pages`) : remplacer `'Premier contact'` →
   `'contact_sent'`, `'Alerte créée'` → `'alert_created'`, `'Inscription'` → `'register_completed'` (déjà traduits
   par `analytics.js`, mais autant appeler les bons noms) ; `'Annonce créée'`, `'Mandat signé'`, `'NDA signé'`,
   `'LOI signée'` ne sont **pas** dans la liste fermée de `backend/events.py` → ignorés aujourd'hui ; soit ajouter
   `listing_created`, `mandate_signed`, `nda_signed` à `EVENT_NAMES` (backend **et** `analytics.js`), soit retirer
   ces appels. À ajouter dans les nouvelles pages : `hero_cta_seller`, `estimate_started`, `estimate_completed`,
   `register_started`. Les pages vues sont déjà comptées par `initAnalytics()` (déjà appelé dans `App.js`) ; un
   hook de route qui appellerait `trackPageView()` est inutile (et dédoublonné si présent).
7. **`frontend/src/App.css`** : `body { background: #F8F9FA; color: #2B3E50 }` chargé après `index.css` écrase
   les jetons → `background: var(--surface)` (ou blanc) et `color: var(--navy)` ; la règle `h1…h6` est redondante
   avec `index.css` (sans effet gênant).
8. **`frontend/nginx.conf` (CSP)** : les polices sont désormais servies par l'application (`font-src 'self'`,
   plus de `fonts.gstatic.com`) ; le worker pdf.js est un fichier de `/static/media` → `worker-src 'self' blob:` ;
   `connect-src 'self'` suffit pour `/api/events` et `/api/alerts/public`.
9. **API** : `ListingCard` attend dans les listes publiques (`GET /companies`, pages SEO) les champs `title`,
   `trades`, `is_rge`, `department`, `published_at`, `company_checks.in_ademe_list` (tous facultatifs : repli sur les
   anciens champs). `AlertForm` attend `POST /alerts/public` avec `{email, trades: [ids], regions: [noms],
   max_price: nombre|null}` → 200 (succès), 400/422 avec `detail` texte, 429 (message « réessayez dans une minute »).
10. **`frontend/src/seo/legal.js`** (`LEGAL_FALLBACK`) contient `representant: 'Romane DA SILVA RIBEIRO'`,
    `marque: 'CessionRGE'`, `email: 'contact@cessionrge.fr'` : à aligner sur `lib/brand.js` ; le nom du représentant
    légal reste une mention obligatoire des mentions légales (LCEN) mais ne doit apparaître **nulle part ailleurs**
    (décision §0.4).
11. **Tests front** : un test Jest de `lib/offer.js` peut reprendre tel quel
    `scratchpad/tests/offer.test.mjs` (chargement `node:vm` identique au pré-rendu) ; aucun fichier de test n'a été
    ajouté au dépôt (hors périmètre).
