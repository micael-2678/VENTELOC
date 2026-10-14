# HANDOFF — vague 2 (pages, parcours, contrats, admin)

Regroupement, par l'intégrateur de la vague 1, de tout ce que les cinq chantiers ont laissé aux vagues suivantes.
La vague 1 est intégrée : backend vert (`cd backend && python -m pytest -q` → 206 tests), `npm run build` vert
(44 pages pré-rendues), modules `events / estimator / closing / veille / transmissibility` branchés, open data et
taxonomie câblés dans `server.py`, publication automatique §4.4, onglet « À faire » (`GET /admin/todo`) et digest
quotidien, migration `backend/migrations/refonte_2026_10.py`. Les HANDOFF d'origine restent la référence détaillée
(`HANDOFF-fondations-backend.md`, `HANDOFF-taxonomie-opendata.md`, `HANDOFF-modules-nouveaux.md`,
`HANDOFF-design-system-front.md`, `HANDOFF-closing-facturation.md`) ; ce fichier dit *quoi* reste, pas *comment*.

## 0. Ce que la vague 1 a changé dans l'API (à connaître avant de toucher aux pages)

| Changement (vague 1) | Conséquence front |
|---|---|
| `submit_listing` publie **sans humain** (SPEC §4.4). Plus de statut `pending` : `published` (+ `moderation {status:'pending', flags, review_until}`), ou `draft` + `blocking: [email_non_confirme, identite_non_verifiee, siret_manquant, siren_inactif, doublon_siren, metier_manquant, prix_manquant]` + `blocked_reason` (premier motif). E-mail `listing_blocked` au cédant. | SellerDashboard / CreateListing : afficher les motifs `blocking` (libellés `LISTING_BLOCKING_LABELS` côté serveur), plus de « en validation sous 48 h ». |
| `PUT /companies/{id}` accepte les champs §2.2 (`trades`, `other_qualifications`, `department`, `sale_object`, `sale_reason`, `handover_months`, `has_maintenance_contracts`, `technical_referent_stays`, `key_staff_stays`, `decennale_ok`, `auto_accept_dataroom`, `mandant_address`, `description` 200-1 500 car.) avec validation taxonomie (400 en français) ; un brouillon bloqué est **re-soumis automatiquement** après correction si le mandat est signé. | CreateListing en 3 écrans : sauvegarder chaque écran avec `PUT`. `siret`, `company_name`, `rge_types`, `legal_structure`, `creation_date` figés après signature du mandat (400). |
| `POST /companies` : `trades` déduits de `rge_types` si absents, `is_rge`, `commission_terms_version='v2'`. | — |
| `GET /company/{siren}/dirigeants` et `POST /company/{siren}/verify-dirigeant` passent par `opendata` : `status` ∈ `match_exact｜match_partial｜no_match｜unavailable` + `reason` (`api_unavailable`, `company_not_found`, `no_dirigeants_data`, `personne_morale`, `invalid_siren`, `missing_identity`, `name_mismatch`), `president`, `can_invite_president`. `DirigeantVerification.jsx` lit toujours `verified` / `matched_as` / `president` : compatible. | Afficher `message` ; le statut n'est plus bloquant (badge + drapeau admin). |
| `PUT /companies/{id}/status?status=removed&reason=<coordonnees｜hors_perimetre｜informations_inexactes｜dirigeant｜doublon｜autre>&reason_text=` : retrait motivé (annonce `removed`, mandat `void`, e-mail `listing_removed`). `status=published` clôt la relecture (`moderation.status='ok'`). | Admin : bouton « Retirer avec motif » (liste + texte), « Valider ». |
| `GET /admin/todo` → `{generated_at, total, sections:[{key, title, rows:[{type, id, title, detail, since, ref, actions:[{label, method, url, body?}]}]}]}` ; sections : `listings_review`, `dataroom_unanswered`, `closings_declared`, `closings_stale`, `todos`, `mandates_expiring`, `incidents`, `job_failures`, `kyc_manual`. Digest quotidien `admin_todo_digest` (tâche `admin_digest`, vide = pas d'e-mail). | Onglet admin par défaut « À faire ». |
| `GET /admin/metrics` → `events` (statistiques maison, `metrics_by_day`). | AdminMetrics : `events.days[].events.<nom>`, `events.totals`, `events.paths`. |
| `GET /public/legal-info` → `rc_pro`, `mediateur`, `fonds_mention` ajoutés. | Mentions légales / pied de page. |
| Acceptation d'offre (`PUT /offers/{id}/respond`) crée l'étape de vente (`closing.py`) et envoie la checklist aux deux parties. | Écran « Étape de vente ». |
| `GET /admin/mandates` liste aussi les mandats `denounced` / `expired` / `void` (registre complet). | AdminMandates : colonne statut. |
| `GET /rge/company/{siret}/qualifications` renvoie `details` (dates de validité par qualification). | `/verifier-entreprise-rge`, CreateListing (préchargement ADEME). |
| `frontend/scripts/seo-routes.json` et `backend/seo_routes.json` n'ont plus de clé `site` ; `REACT_APP_LEGAL_DRAFT` supprimé (plus de bandeau « à faire valider »). | — |

## 1. Front — compte, connexion, profil (chantier fondations)

- Page `/confirmer-email/:token` → `POST /auth/verify-email {token}` ; bandeau « adresse non confirmée » + bouton
  `POST /auth/resend-verification` dans l'espace connecté ; tout 403 dont `detail` commence par « Confirmez d'abord
  votre adresse e-mail » renvoie vers ce bandeau (contact, messages, alertes, demande de dossier, codes de signature,
  publication → `blocked_reason 'email_not_verified'`).
- LoginPage : si `POST /auth/login` renvoie `{otp_required:true, email}`, afficher le champ code puis
  `POST /auth/login/verify {email, code}` → `{token, user}` (**bloquant pour l'admin : sans cela, aucune connexion admin
  possible sur le front**). `POST /auth/change-password` renvoie `{message, token}` : remplacer le jeton stocké.
- ProfilePage : retirer l'upload KYC (`/auth/upload-kyc`, `user.kyc_documents` n'existent plus) ; ajouter « Exporter mes
  données » (`GET /auth/export`) et « Supprimer mon compte » (`DELETE /auth/account`, corps `{password}`).
- RegisterPage : vendeur avec SIRET facultatif (préremplissage `opendata.lookup_siren` côté back à brancher dans
  `POST /auth/register`, « Vérification différée » si indisponible) ; repreneur en un écran avec le profil de projet §4.1
  (`project_type`, `budget_max`, `apport`, `financing`, `zones`, `trades`, `horizon`, `siren`, `company_name`,
  `experience`) et `profile_score` serveur (`buyer_profile_score()`, ≥ 40 pour contacter, ≥ 50 acceptation auto) —
  **le backend n'a pas encore ces champs ni le score** : à faire avec la page.
- Événements : `register_started` / `register_completed` (`analytics.js`).

## 2. Front — offre, mandat, commission

- MandatePage : retirer le choix `commission_payer` (`POST /seller/mandat/{id}/sign` n'attend que `{otp_code}`) ;
  demander `mandant_address` et `sale_object` avant signature (SPEC §3.2) ; résumé 5 lignes, texte dépliable, case
  activée en fin de défilement. `estimateText` déjà passé en HT d'abord.
- AdminMandates.jsx / SellerDashboard.jsx:336 : débiteur toujours « cédant » sauf héritage (`commission_payer ==
  'repreneur'` + `terms_version 'v1'`).
- CompanyDetail.jsx : `commission_info = {payer, rate_percent_ht:'6 %', estimate_ht, estimate_ttc, minimum_ht, terms_version}` ;
  le `CommissionNotice` acquéreur ne s'affiche que pour l'héritage ; HT d'abord.
- lib/offer.js est aligné sur `GET /config → commission_scale` (fait) ; MandatePage / CompanyDetail doivent utiliser
  `computeCommission` / `commissionLabel`.

## 3. Front — nettoyage des routes supprimées

- Supprimer `pages/CreditsPage.jsx` et sa route ; `BuyerDashboard.jsx` : retirer `/credits/balance`.
- `AdminDashboard.jsx` : retirer `/admin/messages`, `/admin/transactions`, `/admin/dataroom/{id}`, `/admin/contracts/*`,
  `/admin/users/{id}/reset-password` (404). `GET /admin/stats` → `{total_companies, published_companies, total_users,
  invoices_count, total_revenue, paid_revenue}`.
- `MessagesPage.jsx` : plus de LOI (`'LOI signée'`), l'offre indicative signée par code la remplace (§3.4, voir §7).
- Événements des pages : `'Premier contact'→'contact_sent'`, `'Alerte créée'→'alert_created'`,
  `'Inscription'→'register_completed'` ; `'Annonce créée'`, `'Mandat signé'`, `'NDA signé'` ne sont pas dans la liste
  fermée (`backend/events.py EVENT_NAMES` + `analytics.js`) : soit ajouter `listing_created / mandate_signed /
  nda_signed` des deux côtés, soit retirer ces appels. Ajouter `hero_cta_seller`, `estimate_started`,
  `estimate_completed`, `register_started`.

## 4. Front — marque, taxonomie, recherche, fiches (chantier taxonomie)

- 11 fichiers de `src/` contiennent encore « CessionRGE » en dur (`grep -rl CessionRGE src`) : `ProfilePage`,
  `CompanyDetail` (mobile), `LoginPage`, `ResetPasswordPage`, `RegisterPage`, `FollowupPage` (aria-label
  `"CessionRGE – accueil"` → `` `${BRAND.name} – accueil` ``), `seo/models.js`, `seo/schema.js`, `seo/brand.js`,
  `components/shared/brandDefaults.js` (valeur par défaut), et **`seo/content.json`** (titres, FAQ, textes des pages
  RGE : garder `BRAND.verticalName` pour la verticale RGE, `{{brand}}` ailleurs — `brandLine` du pied de page utilise
  déjà `{{brand}}`). `lib/seo.js`, `prerender.mjs`, `PublicFooter`, `legal.js` sont faits.
- `PublicSearch.jsx` : exploiter `trades` et `department` de `parseSearchQuery`, liens via `searchPath({ trades, region,
  departement, rge, maxPrice })` ; `/search` → redirection vers `SEARCH_PATH` (`/entreprises-a-vendre`), filtres métier /
  région-département / RGE oui-non / prix (SPEC §4.3.1). Côté back : `GET /companies` doit filtrer sur `trades`,
  `department`, `is_rge` (non fait).
- `CreateListing.jsx` : 3 écrans (§4.2.2), `TRADES` (1 à `MAX_TRADES`), `OTHER_QUALIFICATIONS`, `departementOptions(region)`,
  `departementFromPostalCode()`, préremplissage open data (`GET /estimates/company/{siret}` donne `company.*` et
  `rge.*`), bornes et info-bulles, alerte si prix hors fourchette, aperçu anonyme (`ListingPreview`).
- `SeoPages.jsx` / routes : hub `BUILDING_HUB_PATH` (`/entreprises-batiment-a-vendre`) + `/metier/:slug` (`tradeBySlug`,
  `tradePath`) + `/region/:slug` (`regionBySlug`, `buildingRegionPath`) ; pages `/vendre-mon-entreprise-batiment`,
  `/reprendre-une-entreprise-batiment`, 2 guides nouveaux, CGU avec `/signaler`, 404. Back : sitemap avec
  `taxonomy.TRADES` / `trade_slug` / `slugify(region)` et sans fiches `/company/:id` (non fait) ; `public_listing_stats`
  par métier et département.
- `ListingCard` / `CompanyDetail` : `tradeLabel(id, true)`, `departementLabel(code)`, `otherQualificationLabel(id)` ;
  afficher tous les champs §2.2 (`rge_validity`, `pipeline`, `equipment`, `premises`, `specialties`, `handover_months`…),
  encart « Comment ça se passe », CTA « Présenter mon projet au cédant », favori visiteur → inscription.

## 5. Front — accueil et pages publiques (SPEC §5)

- `LandingPage.jsx` selon §5.1 avec les composants partagés (`ListingPreview`, `TrustBar`, `ProcessTabs`,
  `ListingCard`, `CommissionCalculator`, `OperatorCard`, `AlertForm`) ; suppression du formulaire de recherche du hero,
  du vérificateur RGE, de la newsletter, du tableau du barème, de « sous 48 h », aucun compteur à zéro.
- `App.css` passé aux jetons (fait) ; `seo/Content.jsx` HT d'abord (fait).
- Page `/estimer` (`GET /api/estimates/company/{siret}`, `POST /api/estimates`, `?confirmation=ok|invalide|expire`,
  « Déposer mon annonce anonyme » → `sessionStorage`) ; `/verifier-entreprise-rge` enrichie avec
  `GET /api/rge/company/{siret}/transmissibility` ; data room et espace vendeur : `GET /api/companies/{id}/transmissibility`.
- Alerte sans compte : `AlertForm` existe, **la route `POST /alerts/public {email, trades, regions, max_price}` n'existe pas
  encore côté backend** (e-mail de confirmation, lien signé de désinscription, digest hebdo) : à créer avec la page.

## 6. Front — espaces connectés et admin

- Espace vendeur : bloc « À traiter », statuts lisibles, actions Mettre en pause / Retirer / Vendue via la plateforme
  (ouvre la déclaration du closing) / Vendue autrement, Résilier (préavis 15 j) / Prolonger (routes `denounce` / `renew`
  à créer, voir §7), repreneurs présentés, écran « Étape de vente » (`GET /closing/my`, `PUT /closing/{id}/redacteur`,
  `POST /closing/{id}/declare {signed_on, final_price, sale_object}`, `…/confirm`, `…/dispute {reason}`, PDF facture et
  ordre de paiement en binaire via le jeton Bearer).
- Espace repreneur : « Mes dossiers » (pipeline), checklist après acceptation du dossier (identité → NDA → origine des
  fonds, `POST /dataroom/{id}/funds-declaration` à créer) ; carte repreneur (`BuyerCard`).
- Admin : onglet « À faire » (`GET /admin/todo`, actions des lignes), Factures (`GET /admin/invoices`, `paid`, `cancel`,
  PDF, mise en demeure), Ventes (`GET /admin/closings`, `resolve`), Incidents BODACC (`GET/PUT /admin/incidents`,
  `POST /admin/veille/run`), Métriques (`events`, 10 KPI du lundi, `PUT /admin/costs` à créer), Mandats (registre + CSV),
  retrait motivé des annonces.

## 7. Backend — chantiers non livrés en vague 1

- **Contrats (SPEC §3.2-3.5)** : `DEFAULT_MANDAT_TEMPLATE` (titre « MANDAT DE VENTE EXCLUSIF » et article 3
  d'exclusivité encore présents ; articles 5 / 5 bis déjà au barème v2), `DEFAULT_NDA_TEMPLATE` v2 (sans clause de
  commission acquéreur, montants `fr-FR`), suppression de la LOI (`DEFAULT_LOI_TEMPLATE`, `doc_type 'loi'`, deux
  « à préciser » restants dans ce texte, `/admin/metrics` compte encore `loi_signed`), offre indicative signée /
  contre-signée par code, `mandant_address` + `sale_object` exigés à `POST /seller/mandat/generate`, champs `ends_at` /
  `tail_ends_at` / `renewals` sur le mandat, routes `denounce` / `renew` / `status/{company_id}` avec `presented_buyers`,
  jobs `mandate_expiry` et `mandate_denounce_effective`, chaîne d'empreintes `previous_evidence_sha256`, PDF envoyé par
  e-mail à la signature. La veille BODACC lit déjà `ends_at` / `tail_ends_at` (repli 18 / 30 mois).
- **Parcours repreneur back** : profil de projet et `buyer_profile_score()`, contact avec score ≥ 40 et carte repreneur,
  conversation `{company_id, buyer_id}`, demande de dossier : relances J+2/J+5, expiration J+10, acceptation automatique
  (`auto_accept_dataroom` déjà accepté sur l'annonce), identité au NDA, origine des fonds, `presented_buyers` à la
  signature du NDA.
- **Alertes sans compte** (`POST /alerts/public`, confirmation, désinscription signée, digest hebdo) et e-mails §6.1 non
  encore couverts (J+1/J+4/J+10 mandat, hebdo cédant, 14 j / 30 j / 60 j, NPS…).
- `GET /companies` : filtres métier / département / RGE / prix ; `ListingCard` lit `title`, `trades`, `is_rge`,
  `department`, `published_at`, `company_checks.in_ademe_list` (déjà stockés par `submit_listing`).
- `GET /valorization/estimate` et l'amorçage `db.valorization` : à retirer une fois `/estimer` branché sur `/estimates`.
- `@app.on_event` → `lifespan` (sans effet fonctionnel).

## 8. Qualité front à reprendre

- `npm run lint` (`eslint.config.mjs` + `.npmrc` créés) : 71 erreurs préexistantes hors tests — `no-unused-vars` (52,
  surtout `BuyerDashboard`, `AdminDashboard`, `SellerDashboard`, `DirigeantVerification`) et `jsx-a11y` (labels, clics
  clavier sur `div`, 19). Les fichiers de la vague 1 sont propres.
- `public/index.html` : scripts en ligne Emergent / PostHog encore présents → `script-src 'self' 'unsafe-inline'` dans
  `nginx.conf` ; après leur retrait (et `INLINE_RUNTIME_CHUNK=false`), passer à `script-src 'self'`.
- Tests front : déplacer le polyfill `TextEncoder` de `src/components/shared/jestEnv.js` vers `src/setupTests.js`
  dès qu'un deuxième fichier de test arrive ; rejouer `scripts/journeys/*.js` (Playwright) en intégration.

## 9. Déploiement (rappels)

- Dokploy : service backend nommé `backend` (nginx proxifie `/api` vers `http://backend:8001`, port non publié) ;
  variables `ENV=production`, `SITE_NAME`, `SITE_URL`, `SENDER_NAME`, `CORS_ORIGINS`, `COMMISSION_MIN_HT`, `BACKUP_DIR`,
  `S3_BACKUP_PREFIX`, `INVOICE_IBAN/BIC/BANK`, `LEGAL_RC_PRO`, `LEGAL_MEDIATEUR`, `LEGAL_TVA` (facultatif),
  `EVENTS_SALT_SECRET` (facultatif), `SENTRY_DSN` / `APP_VERSION` (facultatifs) ; front : `REACT_APP_BRAND_NAME`,
  `REACT_APP_SITE_URL`, `REACT_APP_CONTACT_EMAIL`, `REACT_APP_COMMISSION_MIN_HT`, `REACT_APP_BACKEND_URL` vide.
- Migration : `python -m migrations.refonte_2026_10` (dry-run) puis `--apply --network` après `ops/backup.sh` ;
  si des factures `FAC-…` existent déjà, initialiser `db.counters {_id:'invoice', value:<dernier numéro>}`.
- Aucune dépendance payante ajoutée en vague 1 (open data gratuit, statistiques, factures, relances et sauvegardes
  maison, polices auto-hébergées, Sentry optionnel).
