# HANDOFF — chantier « admin » (vague 2, front)

Périmètre livré : SPEC §6.3 et §7.6 (écran du lundi), API.md §9, HANDOFF-vague-2 §0 (`GET /admin/todo`), §3 (routes
supprimées) et §6 (admin). Aucun fichier hors de ma liste n'a été modifié. Backend inchangé.

## 1. Fichiers livrés

| Fichier | Contenu |
|---|---|
| `frontend/src/pages/AdminDashboard.jsx` | Reconstruit : onglet par défaut « À faire » (`?tab=` lu et écrit dans l'URL, `todo` = sans paramètre), onglets Annonces, Utilisateurs, Mandats, Factures, Ventes, Incidents, Métriques ; bouton « Lancer les tâches » (`POST /admin/jobs/run`, résumé en toast) ; `GET /admin/stats` nouvelle forme (`total_companies, published_companies, total_users, invoices_count, total_revenue, paid_revenue`) en tuiles **sans compteur à zéro** ; navigation interne depuis « À faire » (ligne mise en évidence dans l'onglet cible) ; bandeau `EmailVerificationBanner` monté si une action renvoie un 403 `email_not_verified` (sans doublon avec celui d'App.js). Plus aucun appel à `/admin/messages`, `/admin/transactions`, `/admin/dataroom`, `/admin/contracts/*`, `reset-password`, crédits, Stripe, `SecurePdfViewer`, `FREE_MODE`. |
| `frontend/src/components/admin/shared.jsx` | Formats fr-FR (`fmtEur`, `fmtEurCents`, `fmtPct`, `fmtDate`, `fmtDateTime`, `fmtMonth`, `sinceText`), `displayName` (jamais « null null »), libellés (rôle, identité, objet de cession), `REMOVAL_REASONS` (6 motifs), `callAction({method,url,body}, {body?, params?})` qui appelle une action de `GET /admin/todo` telle quelle (les paramètres `<motif>`/`<texte>` sont retirés puis remplacés), `removeListing`, `tabForUrl`, `jobsRunSummary`, `Section`, `EmptyState`, `Loading`, `Pill`, `ActionButton`, `ExtLink`, `FilterSelect`, `DataTable` (tableau ≥ 640 px, liste de cartes en dessous), `ActionDialog`, `RemovalDialog`, `PaidDialog`, `NoteDialog`. |
| `frontend/src/components/admin/AdminTodo.jsx` | Sections de `GET /admin/todo` ; chaque ligne : titre, détail, « depuis le … (n j) », références libellées (société, SIRET, drapeaux `LISTING_FLAG_LABELS`, facture, débiteur, échéance, liens Fiche publique / Annonce / Étape de vente / Facture / Registre / Compte / Incidents / Annonce BODACC) et ses actions. `actionKind()` : `remove` → boîte de motifs (liste + texte, texte obligatoire pour « autre ») ; `paid` → date + montant ; `resolve` → note facultative fusionnée au `body` ; `incident` → note ; `confirm` (`/done`) → confirmation ; `GET …pdf` → téléchargement avec le jeton ; `GET` autre → onglet correspondant ; le reste (Valider, Relancer, Marquer vérifiée) → appel direct. État vide : « Rien à traiter. Aucun e-mail « À faire » ne sera envoyé aujourd'hui. » |
| `frontend/src/components/admin/AdminCompanies.jsx` | `GET /admin/companies` : filtre (à relire 48 h, en ligne, brouillons/bloquées, mandat à signer, pause, retirées, vendues, autres) + recherche ; carte par annonce : titre (`listingTitle`), statut lisible, société/SIRET/région/département/prix, `company_checks` libellés (`checkChips`), drapeaux `moderation.flags`, « Relecture ouverte jusqu'au … », motif de retrait, cédant (nom ou e-mail, jamais `null`), « Publiée le … · 12 vues · 3 favoris » (`views`, zéros omis). Actions : Fiche publique, Valider (`PUT /companies/{id}/status?status=published` si relecture en cours), Remettre en ligne, Retirer avec motif. |
| `frontend/src/components/admin/AdminUsers.jsx` | `GET /admin/users` : filtre (cédants, repreneurs, e-mail non confirmé, identité à vérifier, administrateurs) + recherche ; rôle, « E-mail confirmé / non confirmé », identité (vérifiée / en repli / en cours / refusée / non vérifiée), repreneur : « Profil repreneur complet à N % » + résumé du projet (libellés `PROJECT_TYPES`, `FINANCING`, `HORIZONS`, métiers) ; « Marquer l'identité vérifiée » → `PUT /admin/kyc/{id}/validate?status=verified` (confirmation). Comptes anonymisés (`deleted_at`) masqués. |
| `frontend/src/components/AdminMandates.jsx` | Registre : `GET /admin/mandates` (signés, dénoncés, expirés, caducs), filtre par statut, colonnes n° registre, signé le, annonce (+ statut d'annonce), cédant, statut avec date utile (échéance < 30 j, fin effective, expiration), échéance, clause de suite, version (v2 / v1 + débiteur héritage via `legacyPayerText`, prolongations), n° de contrat ; PDF (`downloadMandatePdf`) ; export CSV (`GET /admin/mandates/export.csv`). |
| `frontend/src/components/admin/AdminInvoices.jsx` | `GET /admin/invoices?status=` (toutes, émises, en retard, payées, annulées, brouillons), totaux (facturé HT, encaissé HT, en retard TTC, non nuls), lignes (n°, débiteur, annonce + objet, émise le, échéance, HT, TTC, statut + relances) ; actions PDF (`/api/invoices/{id}/pdf`), Marquer payée (`PUT …/paid {paid_on, amount}`), Mise en demeure (`GET …/mise-en-demeure.pdf`, facture émise et échue), Annuler (`PUT …/cancel {reason}` obligatoire). |
| `frontend/src/components/admin/AdminClosings.jsx` | `GET /admin/closings?status=` ; statut lisible, montant, objet, dates, déclaration (par qui, acte signé le, prix), confirmation automatique le …, contestation, rédacteur d'acte ; « sans vente depuis n j » au-delà de 60 j ; Confirmer / Annuler la déclaration → `PUT /admin/closings/{id}/resolve {action, note}` ; lien vers la facture. |
| `frontend/src/components/admin/AdminIncidents.jsx` | `GET /admin/incidents?status=open|closed|all`, Clore / Rouvrir (`PUT /admin/incidents/{id} {status, note}`), « Lancer la veille » (`POST /admin/veille/run`, résumé en toast), lien vers l'annonce BODACC. |
| `frontend/src/components/AdminMetrics.jsx` | Écran du lundi : `GET /admin/kpis?weeks=8` → tableau des 10 groupes du rapport §7.6 (`KPI_GROUPS`, 1-5, 8, 9, 10 ; 6 e-mailing et 7 SEO en encart « suivi hors plateforme », sans valeur inventée), colonnes Cette semaine / Semaine précédente / Cible, point ambre sous la cible (sens `better: up|down`), flèches ▲▼, zéro affiché « — » avec légende, repli des 8 semaines ; revenu = `GET /admin/stats` (`total_revenue`, `paid_revenue`, `invoices_count`) ; coûts du mois : `PUT /admin/costs {month, amount, note?}` + liste `GET /admin/costs` ; événements `GET /admin/metrics?days=` : tuiles, tableau par nom (`EVENT_LABELS`), par jour (jours actifs seulement, zéros vides), pages les plus vues, entonnoir repreneurs. `GET /admin/kpis` absent (404) → état vide explicite. |
| `frontend/src/components/admin/__tests__/admin.test.jsx` | 12 tests Jest (helpers, dashboard « À faire », actions telles quelles, retrait motivé, marquer payée, résolution avec note, liste vide + tâches, `?tab=users`, Annonces, Factures, Métriques, indicateurs indisponibles). `CI=true npx craco test --watchAll=false src/components/admin/__tests__/admin.test.jsx` → vert. ESLint vert sur tous mes fichiers. |

## 2. Contrat attendu des routes « à créer » (API.md §9) — pour l'agent backend (tâche « admin kpis/costs »)

Le front est câblé sur ces formes ; toute autre forme reste affichée proprement (état vide) mais vide.

- `GET /admin/kpis?weeks=8` → `{weeks: [{start: 'AAAA-MM-JJ', end: 'AAAA-MM-JJ', kpis: {…}}], targets: {…}, current: {…}}`.
  `weeks` triées croissantes (semaines **terminées**, lundi → dimanche) ; `current` = semaine en cours, soit `{start, end, kpis}`,
  soit directement l'objet `kpis` (les deux sont acceptés ; `{}` ou absent → la dernière semaine de `weeks` est « cette semaine »).
  Clés de `kpis` et de `targets` (toutes facultatives, nombres) : `listings_published, listings_blocked, estimates_completed,
  estimate_to_listing_pct, listing_to_mandate_pct, publish_delay_median_h, auto_publish_pct, contacts, contacts_per_listing_30d,
  nda_signed, nda_per_listing_30d, offers, seller_response_48h_pct, requests_expired, offers_accepted, sales_declared,
  invoices_issued, invoices_paid, invoices_overdue, bodacc_incidents, costs, blocking_actions`. Les `_pct` sont en **0-100**
  (pas 0-1). Cibles : le front affiche « ≥ » pour les KPI « plus c'est haut, mieux c'est » et « ≤ » pour `listings_blocked,
  publish_delay_median_h, requests_expired, invoices_overdue, bodacc_incidents, costs, blocking_actions`.
- `PUT /admin/costs {month: 'AAAA-MM', amount, note?}` → `{month, amount, note}` (ou `{ok:true}`) ;
  `GET /admin/costs` → `{costs: [{month, amount, note?, updated_at?}]}` (un tableau nu est aussi accepté). `costs` du KPI 9 =
  montant du mois en cours.

## 3. Écarts constatés (à trancher par l'intégrateur)

1. **`PUT /admin/closings/{id}/resolve`** : API.md §7 dit `{status, note}`, le backend (`closing.py` `ResolveInput`) et les
   actions de `GET /admin/todo` disent `{action: 'confirm'|'cancel', note}`. Le front envoie **`{action, note}`** (ce que le
   serveur accepte). À aligner dans API.md ou à accepter les deux côté serveur.
2. **Lien du digest quotidien** (`server.py` `job_admin_digest`) : `site_url("/admin?tab=todo")` alors que la route front est
   `/admin/dashboard`. Deux options : (a) `App.js` : `<Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />`
   (le paramètre `?tab=` est perdu par `Navigate` sans effort supplémentaire, mais « À faire » est l'onglet par défaut, donc
   `/admin/dashboard` suffit) ; (b) `server.py` ligne ~4363 : `link=site_url("/admin/dashboard")`. Je recommande (b), une ligne.
3. **`GET /admin/todo`, action « Marquer payée »** (`server.py` ~4301) : pas de `body` ; le front ouvre la boîte date + montant et
   envoie `{paid_on, amount}` (montant prérempli depuis `ref.total_ttc`). Rien à changer.
4. **`GET /admin/todo`, action « Retirer avec motif »** : l'URL contient `reason=<motif>&reason_text=<texte>` ; le front retire ces
   valeurs génériques et envoie les siennes en paramètres de requête. Rien à changer.
5. **`GET /admin/todo`, action « Relancer le cédant »** (demandes de dossier) pointe sur `POST /admin/jobs/run` : c'est bien ce qui
   est appelé ; le toast résume les tâches exécutées.
6. Les lignes `todos` de type `invoice_overdue` ont l'action « Ouvrir » = `GET …/mise-en-demeure.pdf` : téléchargé en binaire avec
   le jeton (`downloadPdf`), conforme à HANDOFF §6.
7. `GET /admin/users` renvoie aussi les administrateurs et les comptes anonymisés (`deleted_at`) : les seconds sont masqués côté front.

## 4. Dépendances lues (non modifiées)

`@/components/seller/listingStatus` (`LISTING_STATUS`, `LISTING_FLAG_LABELS`), `@/components/shared` (`listingTitle`, `PROJECT_TYPES`,
`FINANCING`, `HORIZONS`, `formatDateFr`), `@/lib/mandate` (`MANDATE_STATUS_LABELS`, `daysUntil`, `downloadMandatePdf`, `downloadPdf`,
`apiRelativePath`, `legacyPayerText`), `@/components/account/errors` (`apiErrorMessage`, `isEmailNotVerifiedError`),
`@/components/EmailVerificationBanner`, `@/lib/referentiels` (`tradeLabel`, `departementLabel`), `@/lib/seo` (`usePrivateSeo`).
`AdminDashboard` n'importe plus `SecurePdfViewer` ni `lib/config` (`FREE_MODE`) : si plus aucune page ne les utilise, ils peuvent
être supprimés par l'intégrateur (`grep -rn "SecurePdfViewer\|FREE_MODE" src`).
