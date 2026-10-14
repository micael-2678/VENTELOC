# Contrat d'API — vague 2 (source de vérité entre backend et front)

Complète `SPEC.md` et `HANDOFF-vague-2.md`. Tous les chemins sont relatifs à `/api`. Les erreurs **nouvelles** renvoient `detail` sous la forme `{code, message}` (le front gère aussi l'ancien `detail` chaîne). Codes utilisés : `email_not_verified`, `profile_incomplete`, `identity_required`, `identity_not_needed_yet`, `already_verified`, `already_reminded`, `disputed`, `nda_required`, `funds_declaration_required`, `mandate_required`, `invalid_otp`, `otp_expired`, `locked`, `not_allowed`, `validation`. Montants en euros (nombres), dates ISO 8601 UTC.

## 1. Compte

| Route | Corps / paramètres | Réponse |
|---|---|---|
| `POST /auth/register` | `{email, password, role: 'seller'|'buyer', first_name, last_name, phone, company_name?, siret? (vendeur), buyer_profile? (repreneur, voir ci-dessous), source?}` | `{token, user}` ; `user.email_verified=false`, e-mail de confirmation envoyé |
| `GET /auth/profile` | — | `user` : `{id, email, role, first_name, last_name, phone, company_name, email_verified, identity_verified, kyc_status, buyer_profile, profile_score, notifications_opt_out, siret, created_at}` |
| `PUT /auth/profile` | `{first_name?, last_name?, phone?, company_name?, siret?, buyer_profile?, notifications_opt_out?}` | `{user}` (score recalculé) |
| `POST /auth/verify-email` | `{token}` | `{ok:true}` |
| `POST /auth/resend-verification` | — | `{ok:true}` (1/min) |
| `POST /auth/login` | `{email, password}` | `{token, user}` ou `{otp_required:true, email}` (admin) |
| `POST /auth/login/verify` | `{email, code}` | `{token, user}` |
| `GET /auth/export` · `DELETE /auth/account {password}` | — | export JSON · `{ok:true}` |

`buyer_profile` : `{project_type: 'reprise-individuelle'|'croissance-externe'|'groupe-investisseur'|'autre', budget_max: number, apport: number, financing: 'fonds-propres'|'emprunt'|'mixte'|'a-definir', zones: [région], trades: [id], horizon: '0-6'|'6-12'|'12+', siren?: string, company_name?: string, experience?: string}`. `profile_score` (0-100) : project_type 15, budget_max 15, apport 10, financing 10, zones 10, trades 10, horizon 10, phone 10, siren vérifié 10 (`siren_verified` posé par le serveur via open data). Contact possible ≥ 40 ; acceptation automatique ≥ 50.

## 2. Annonces

`GET /companies` (publique) accepte `trades` (ids séparés par des virgules, OU logique), `region`, `department` (code), `rge` (`true`/`false`), `min_price`, `max_price`, `min_ca` (chiffre d'affaires N minimum), `min_staff` (effectif minimum ; aussi dans `POST /companies/search`), `sort` (`recent`|`price_asc`|`price_desc`), `limit` (≤ 100), `page` (1…) → **tableau** d'annonces publiques (même forme qu'aujourd'hui, champs §2.2 ajoutés), en-tête `X-Total-Count`. `POST /companies/search` reste pour les alertes mais accepte les mêmes filtres.

Annonce publique (`GET /companies/{id}`, cartes) : `{id, title, trades, rge_types, other_qualifications, is_rge, region, department, staff_count, ca_n, ca_n1, ca_n2, ebitda, margin, debt, pipeline, fixed_charges, asking_price, sale_object, sale_reason, handover_months, has_maintenance_contracts, technical_referent_stays, key_staff_stays, decennale_ok, description, equipment, premises, specialties, rge_validity, creation_date, legal_structure, published_at, status, company_checks: {in_ademe_list, dirigeant_match}, commission_info: {payer:'cedant', rate_percent_ht:'6 %', estimate_ht, estimate_ttc, minimum_ht, terms_version}, views, favorites_count, photos:[...]}`. Jamais : `company_name`, `siret`, `seller_id` (sauf au cédant/admin), `mandant_address`.

Cédant : `PUT /companies/{id}` (champs §2.2 + `mandant_address: {line1, line2?, postal_code, city}`, `auto_accept_dataroom: bool`) ; `PUT /companies/{id}/status?status=` : cédant → `paused` | `published` (reprise) | `withdrawn` | `sold_elsewhere` ; admin → `removed&reason=…&reason_text=` | `published`. `sold_elsewhere` → e-mail de rappel de la clause de suite + drapeau veille. Vente via la plateforme : voir §6.

## 3. Contact et messagerie

- `POST /companies/{id}/contact {message}` → `{conversation_id}` ; exige `email_verified` et `profile_score ≥ 40` (403 `email_not_verified` / `profile_incomplete`). Le cédant reçoit l'e-mail « premier contact » avec la carte repreneur.
- `GET /messages/conversations` → `[{id, company_id, company_title, buyer_id, seller_id, other_party_label, buyer_card? (côté cédant), last_message, last_at, unread_count, nda_signed, identity_revealed, access_status}]` trié par `last_at` desc.
- `GET /messages?conversation_id=` → `[{id, conversation_id, sender_id, sender_label, is_mine, content, created_at, read, kind: 'message'|'system'}]`.
- `POST /messages {conversation_id, content}` → message créé (coordonnées masquées avant NDA, comme aujourd'hui).
- `PUT /messages/conversations/{conversation_id}/read` → `{ok:true}`.
- Carte repreneur (`buyer_card`) : `{label: 'Repreneur n°123456', project_type, budget_max, apport, financing, zones, trades, horizon, siren_verified, profile_score, name? (après NDA), company_name? (après NDA)}`.

## 4. Dossier (data room) : demande → acceptation → identité → NDA → origine des fonds → accès

- `POST /dataroom/{company_id}/request-access {message?}` → `{request_id, status: 'pending'|'accepted'}` (`accepted` immédiatement si `auto_accept_dataroom` et score ≥ 50). Exige `email_verified`, score ≥ 40.
- `GET /dataroom/{company_id}/access-status` → `{access_granted, access_status: null|'pending'|'accepted'|'granted'|'rejected'|'expired'|'closed', steps: {identity, nda, funds} (booléens), next_step: 'identity'|'nda'|'funds'|null, request: {id, created_at, expires_at}}`.
- Cédant : `GET /dataroom/{company_id}/access-requests` → `[{id, buyer_id, buyer_card, message, status, created_at, expires_at, steps}]` ; `PUT /dataroom/{company_id}/access/{request_id}/validate` → `{status:'accepted'}` ; `.../reject {reason?}`.
- Repreneur après acceptation : identité (`POST /kyc/create-verification-session` : 409 `already_verified` si déjà vérifiée ; 403 `identity_not_needed_yet` tant qu'aucune demande de dossier n'est acceptée — cédant : tant qu'il n'a ni annonce ni invitation de président en attente ; 3 sessions par heure et par IP, 429 au-delà ; Stripe Identity est facturé à l'usage) → NDA : `POST /contracts/generate-for-signature {company_id, doc_type:'nda'}` (403 `identity_required` si identité non vérifiée) → `POST /signatures/request-code {contract_id}` → `POST /contracts/{contract_id}/sign {otp_code}` → `POST /dataroom/{company_id}/funds-declaration {source: 'fonds-propres'|'emprunt'|'mixte'|'investisseurs', amount, financing_partner?}` → `{access_granted:true}` ; l'accès est accordé automatiquement dès que les trois étapes sont faites (le serveur vérifie à chaque étape). À la signature du NDA : `presented_buyers` += repreneur, identité et nom de la société révélés dans la conversation.
- Relances J+2/J+5 au cédant (e-mails transactionnels : partent malgré `notifications_opt_out`), expiration J+10 (`expired`, e-mail au repreneur), via `daily_job` ; une demande renouvelée après expiration est relancée et expire de nouveau (clé de cycle `id:requested_at`).
- Annonce qui quitte le site (retrait, vente, retrait admin, statut hors `published`/`paused`) : les demandes `pending` passent en `closed` (`closed_reason: 'listing_<statut>'`), message système au repreneur, aucun e-mail ; une nouvelle demande est possible après `closed` comme après `expired`.
- Admin : `POST /admin/dataroom/{request_id}/remind` → relance transactionnelle au cédant (action « Relancer le cédant » de « À faire ») ; 409 `already_reminded` (une par jour), 400 si la demande n'est plus en attente ou l'annonce plus en ligne ; audit `ACCESS_REQUEST_REMINDED`.
- `GET /documents/{company_id}/signed` → `[{id, doc_type, signed_at, evidence: {document_sha256, previous_evidence_sha256, ip, user_agent, identity}, pdf_url}]` ; `GET /documents/{company_id}/{doc_id}/pdf`.

## 5. Offre indicative (remplace la LOI)

- `POST /offers {company_id, amount, sale_object: 'titres'|'fonds', financing: {equity, loan, vendor_loan, earn_out}, conditions: [string], target_date, validity_days (15-60), message?}` → `{offer: {...}, contract_id}` (statut `pending_signature`). Exige accès data room accordé.
- Signature repreneur : `POST /signatures/request-code {contract_id}` puis `POST /contracts/{contract_id}/sign {otp_code}` → offre `pending`, e-mail au cédant.
- Cédant : `PUT /offers/{id}/respond {action: 'accept', otp_code}` (code demandé via `/signatures/request-code {contract_id}`) → `accepted` + étape de vente créée ; `{action:'reject', reason}` ; `{action:'counter', counter_amount, message}` → `countered`. Repreneur : `PUT /offers/{id}/accept-counter {otp_code}` → `accepted`.
- `GET /offers/my` (repreneur) · `GET /offers/company/{company_id}` (cédant) · `GET /offers/{id}/pdf`. Offre : `{id, company_id, buyer_id, amount, sale_object, financing, conditions, target_date, validity_days, expires_at, status: 'pending_signature'|'pending'|'accepted'|'rejected'|'countered'|'expired', counter_amount?, contract_id, signed_at?, countersigned_at?, closing_id?}`.

## 6. Mandat (v2)

- Préalable : `PUT /companies/{id}` avec `mandant_address` et `sale_object`.
- `POST /seller/mandat/generate?company_id=` → `{contract_id, contract_number, content, summary: [5 lignes], terms_version:'v2'}` ; 400 `{code:'validation', message, missing:[champs]}` si un champ manque ; 403 `identity_required` / `email_not_verified`.
- `POST /seller/mandat/{id}/sign {otp_code}` → `{status:'signed', registry_number, signed_at, ends_at, tail_ends_at, listing_status, pdf_url}` ; e-mail avec lien PDF.
- `POST /seller/mandat/{id}/denounce` → `{status:'denounced', effective_at}` ; `POST /seller/mandat/{id}/renew {otp_code}` → `{ends_at, tail_ends_at}`.
- `GET /seller/mandat/status/{company_id}` → `{mandat: {id, status, registry_number, signed_at, ends_at, tail_ends_at, effective_at?, terms_version, pdf_url} | null, presented_buyers: [{buyer_id, label, name?, company_name?, at}]}`.
- `GET /seller/mandat/{id}/pdf` (existant).
- Vente via la plateforme sans offre acceptée : `POST /closing/direct {company_id, buyer_id}` (le `buyer_id` doit figurer dans `presented_buyers`) → étape de vente créée, puis déclaration (§7).

## 7. Étape de vente et factures (module `closing.py`, routes déjà en place sauf mention)

- `GET /closing/my` → `[{id, company_id, company_title, buyer_id, seller_id, offer_id?, sale_object, expected_date, redacteur: {type, name, email, phone}, status: 'in_progress'|'declared'|'confirmed'|'disputed'|'abandoned', declared: {by, signed_on, final_price, sale_object, at}?, confirm_deadline?, invoice_id?, created_at}]`.
- `PUT /closing/{id}/redacteur {type, name, email, phone}` · `POST /closing/{id}/declare {signed_on, final_price, sale_object}` · `POST /closing/{id}/confirm` · `POST /closing/{id}/dispute {reason}` · `POST /closing/direct {company_id, buyer_id}`.
- Vue `GET /closing/{id}` : `invoice`, `commission_preview`, `invoice_id`, `invoice_number` et `payment_order_sent_to` ne sont renvoyés qu'au cédant et à l'admin (`null` ou absents pour le repreneur) ; `GET /closing/{id}/payment-order.pdf` : 403 pour le repreneur.
- Rédacteur : modifiable par les deux parties jusqu'à la confirmation ; ensuite par le cédant ou l'admin seulement, tant que `payment_order_sent_at` est vide (l'ordre de paiement part alors). L'ordre de paiement n'est adressé qu'à un rédacteur renseigné par le cédant ou l'admin (`redacteur.set_by` ∈ `seller`, `admin`) ; indiqué par le repreneur, il attend la confirmation du cédant (ligne « À faire » `payment_order_to_confirm`).
- Déclaration : celle du cédant (ou de l'admin) est confirmée automatiquement 7 jours après (`confirm_deadline`) ; celle du **repreneur ne l'est jamais** : elle reste `declared` jusqu'à l'accord du cédant (ligne « À faire » `closing_declaration_unconfirmed` à l'échéance) — aucune facture, annonce non « vendue ». Le repreneur ne peut pas déclarer une vente abandonnée (400). Vente `disputed` : seule la partie qui a contesté (ou l'admin) peut déclarer sa version, sinon 400 `{code:'disputed'}` ; la contestation est archivée dans `disputes[]`.
- Relances J+30/60/90 : `GET /closing/{id}/status/{token}?answer=en_cours|signe|abandonne` n'a **aucun effet** (page de confirmation HTML, ou `{confirm_required: true}` en JSON) ; la réponse est enregistrée par `POST` sur la même URL. Un abandon est réversible par la partie qui l'a déclaré (« Toujours en cours » ou « Acte signé »).
- Factures : `GET /invoices/{id}/pdf` (cédant, admin) ; admin `GET /admin/invoices` → `[{id, number, closing_id, company_id, debtor: {name, company, siren, address}, total_ht, vat, total_ttc, issued_on, due_on, status: 'issued'|'paid'|'cancelled'|'overdue', paid_on?, paid_amount?, balance_due?, payments: [{paid_on, amount}]?, credit_note: {number, issued_on, …}?, reminders: [dates]}]`, `GET /admin/invoices/{id}/mise-en-demeure.pdf`, `GET /closing/{id}/payment-order.pdf`.
- Échéance (`due_on`) : max(acte + 30 jours pour des titres, acte + 180 jours pour un fonds ; facture + 15 jours) — mandat, art. 6.3.
- `PUT /admin/invoices/{id}/paid {paid_on, amount}` : encaissements cumulés dans `payments[]` ; la facture ne passe `paid` qu'au total TTC (à 0,01 près), sinon elle reste `issued` avec `paid_amount` et `balance_due` (relances et mise en demeure sur le solde). 400 si le montant dépasse le reste dû ou si la facture est déjà payée.
- `PUT /admin/invoices/{id}/cancel {reason}` : émet un **avoir** `AV-AAAA-NNNNN` (montants négatifs) dans `invoice.credit_note`, retire la facture du closing (`invoice_history[]`) et l'envoie au cédant ; refusé pour une facture avec acompte ou déjà annulée. `GET /invoices/{id}/avoir.pdf` (cédant, admin ou jeton du lien).
- Admin : `GET /admin/closings`, `PUT /admin/closings/{id}/resolve {action: 'confirm'|'cancel', note}` (`{status, note}` accepté comme synonyme) ; `PUT /admin/closings/{id}/declaration {signed_on, final_price, sale_object, note?}` : vente confirmée sans facture active (après avoir), la déclaration corrigée est historisée dans `declarations[]` et une nouvelle facture est émise sous le numéro suivant.

## 8. Alertes sans compte, estimateur, diagnostic

- `POST /alerts/public {email, trades: [id], regions: [région], max_price?, rge?}` → `{status:'confirmation_sent'}` (ou `already_active` : critères remplacés) ; `GET /alerts/confirm/{token}` renvoie une **page HTML minimale en français** (pas de route front) ; `GET /alerts/unsubscribe/{token}` n'affiche qu'un bouton « Confirmer la désinscription », le `POST` sur la même URL désinscrit (aussi utilisé par la désinscription en un clic des messageries : en-têtes `List-Unsubscribe` et `List-Unsubscribe-Post`, RFC 8058, sur tous les e-mails non transactionnels). Digest hebdomadaire (`weekly_job`) + envoi immédiat à la publication d'une annonce qui correspond.
- Alertes avec compte : routes `/alerts` existantes, mêmes filtres (`trades`, `regions`, `max_price`, `rge`). `POST /alerts/unsubscribe/{token}` pour un compte pose `notifications_opt_out` (lien présent dans tous les e-mails non transactionnels ; le `GET` affiche la confirmation). `GET /nps/{token}?score=0-10` affiche une confirmation sans effet ; `POST /nps/{token}` (champ de formulaire `score`) enregistre la note.
- `GET /estimates/company/{siret}` → `{company: {siren, nom_complet, naf, naf_libelle, date_creation, tranche_effectif, departement, region, etat, available}, rge: {qualifications: [...], details: [...]}}` ; `POST /estimates {...}` → `{low, high, mid, method, drivers, pedagogy}` (existant).
- `GET /rge/company/{siret}/transmissibility` (public) et `GET /companies/{id}/transmissibility` (data room) → `{qualifications: [{label, organisme, valid_until?, transfer_rules: {titres, fonds}}], technical_referent, decennale, summary: [string]}` (existant).

## 9. Admin

- `GET /admin/todo` (existant, voir HANDOFF §0) ; les `actions[]` sont appelées telles quelles (`method`, `url`, `body?`). Sections ajoutées en vague 2 : `dataroom_expired` (demandes expirées sans réponse, 30 j) et `reports` (événements `report` de `/signaler`, 30 j). La section `job_failures` contient aussi les e-mails non envoyés (titre « E-mail non envoyé » : erreur Brevo ou plafond `EMAIL_DAILY_SOFT_LIMIT` atteint pour un e-mail non transactionnel) et une ligne `backup_stale` quand la dernière sauvegarde réussie a plus de 30 h.
- `GET /health` → `{status, db, jobs_age_seconds, backup_age_hours (null sans volume de sauvegarde), disk_free_mb, s3, version}` ; 503 si la base est injoignable.
- `GET /public/legal-info` → entité exploitante : `{denomination, forme_juridique, capital, adresse, rcs_ville, siren, tva, telephone, carte_t, carte_t_valid_until, carte_t_issuer, carte_t_activities: [string], representant, email, hebergeur, rc_pro, mediateur, fonds_mention, marque}` (variables `LEGAL_*` : une valeur vide garde la valeur par défaut).
- `GET /admin/kpis?weeks=8` (**à créer**) → `{weeks: [{start, end, kpis: {listings_published, listings_blocked, estimates_completed, estimate_to_listing_pct, listing_to_mandate_pct, publish_delay_median_h, auto_publish_pct, contacts, contacts_per_listing_30d, nda_signed, nda_per_listing_30d, offers, seller_response_48h_pct, requests_expired, offers_accepted, sales_declared, invoices_issued, invoices_paid, invoices_overdue, bodacc_incidents, costs, blocking_actions}}], targets: {…mêmes clés…}, current: {...}}`.
- `PUT /admin/costs {month: 'AAAA-MM', amount, note?}` · `GET /admin/costs` (**à créer**).
- `GET /admin/incidents` · `PUT /admin/incidents/{id} {status, note}` · `POST /admin/veille/run` (existants).
- `GET /admin/mandates` (+ statuts), `GET /admin/mandates/export.csv`, `GET /admin/companies`, `GET /admin/users`, `PUT /admin/kyc/{user_id}/validate`, `GET /admin/stats`, `GET /admin/metrics` (événements), `POST /admin/jobs/run`.

## 10. Routes front (App.js)

Publiques (MODE-TEST-ET-APP.md §A) : `/` (**page des annonces**, `pages/ListingsPage.jsx` ; filtres dans l'URL : `metier`, `region`, `departement`, `rge`, `prix_max`, `ca_min`, `effectif_min`, `tri`, `page`) · `/embed/annonces` (module pour le site WordPress, `pages/EmbedListingsPage.jsx`, `noindex`, `limit` 1-24) · `/company/:id` · `/estimer` (`pages/EstimatePage.jsx`) · `/mentions-legales` · `/confidentialite` · `/cgu` · `/signaler` · `/login` · `/register` · `/mot-de-passe-oublie`, `/reset-password/:token` · `/confirmer-email/:token` (`pages/ConfirmEmailPage.jsx`) · `/president/:token` · `/suivi/:token` · `/test` (panneau du mode test, `pages/TestModePage.jsx`, `noindex`) · 404.
Anciennes URL redirigées vers `/` (côté client et 301 nginx) : `/entreprises-a-vendre`, `/search`, `/buyer/search` (requête conservée) ; hubs `/entreprises-batiment-a-vendre[/metier|/region/:slug]` et `/entreprises-rge-a-vendre[/activite|/region/:slug]` → `/?metier=…`, `/?region=…`, `/?rge=1&…` ; `/vendre-mon-entreprise-*`, `/reprendre-une-entreprise-*`, `/guides[/*]`, `/verifier-entreprise-rge` → `/`. La page d'accueil marketing est hors de l'application (site WordPress, `docs/WORDPRESS.md`).
Connectées : `/seller/dashboard` · `/seller/create` (+ `/seller/edit/:id`) · `/seller/mandat/:companyId` · `/buyer/dashboard` · `/messages` (+ `?conversation=`) · `/dataroom/:companyId` (`pages/DataroomPage.jsx`, parcours en checklist puis documents) · `/vente/:closingId` (`pages/ClosingPage.jsx`, les deux rôles) · `/profile` · `/admin/dashboard`.

## 11. Mode test (MODE-TEST-ET-APP.md §B)

Activé par `TEST_MODE=true` côté backend. Le front lit `test_mode` dans `GET /config` (hook `useTestMode()` de
`src/lib/testMode.js`, une lecture par chargement, cache `sessionStorage`) : **aucune variable de build**.

Toutes les routes `/api/test/*` répondent **404 `{"detail": "Introuvable"}`** quand `TEST_MODE` n'est pas vrai, avant
toute authentification (pas de 401/403 révélateur).

| Route | Auth | Corps / paramètres | Réponse |
|---|---|---|---|
| `GET /config` | — | en-tête `X-Test-Key` facultatif | champ ajouté `test_mode: bool` ; en mode test seulement : `test_panel_protected` (clé `TEST_PANEL_KEY` définie), `test_panel_access` (clé exacte reçue, ou pas de clé) et `test_panel_admin` (connexion à l'admin démo permise : clé exacte, ou pas de clé hors production) |
| `POST /test/identity/simulate` | connecté | `{first_name?, last_name?, birth_date?: "AAAA-MM-JJ"}` (défaut : profil) | `{verified: true, kyc_provider: "test", user, listings: [{id, status, title}]}` ; 400 `validation` (date invalide, personne mineure, nom manquant) |
| `POST /test/confirm-email` | connecté | — | `{verified: true, already_verified, email}` |
| `POST /test/seed` | clé du panneau si `TEST_PANEL_KEY` (5/min) | en-tête `X-Test-Key` | `{accounts: [{persona, email, role, created}], password, accounts_created, listings_created, listings_published, listings_total: 8}` ; 409 si une adresse démo appartient à un compte réel |
| `POST /test/login-as` | clé du panneau si `TEST_PANEL_KEY` ; admin démo fermé en production sans clé | `{persona: "vendeur" \| "repreneur" \| "admin"}`, en-tête `X-Test-Key` | `{token, user}` (jeton `tm`, invalide dès `TEST_MODE=false`) ; 404 comptes absents (lancer le seed) ; 403 `test_key_required` (clé absente ou fausse) ou compte non `is_test` ; 422 persona inconnu |
| `GET /test/emails` | connecté | `?limit=1..200` (50), `?to=` (admin seulement) | **tableau** `[{id, to, from, subject, created_at}]` du plus récent au plus ancien, en-tête `X-Total-Count` ; un utilisateur ne voit que les e-mails adressés à son adresse **depuis la création de son compte** (jamais ceux d'un ancien titulaire), l'admin voit tout |
| `GET /test/emails/{id}` | connecté | — | `{id, to, from, subject, html, created_at}` ; 404 si ce n'est pas le sien (sauf admin) |
| `DELETE /test/emails` | admin | — | `{deleted: n}` |
| `POST /admin/test/purge` | admin, **même hors mode test** | `?dry_run=true` (défaut) \| `false` | `{dry_run, counts: {collection: n}, total, files, protected: {generated_contracts: [{id, registry_number}], invoices: [{id, number}]}}` ; `protected` : mandats du registre réel et factures réelles rattachés à une donnée de test, jamais supprimés |

Champs renvoyés en clair **uniquement en mode test** : `test_code` (6 chiffres) dans `POST /signatures/request-code` et
dans la réponse `{otp_required: true, …}` de `POST /auth/login` (admin ; un nouveau code à chaque appel ; seulement avec la
clé du panneau quand `TEST_PANEL_KEY` est définie) ; `test_link`
(lien `/confirmer-email/<jeton>`) dans `POST /auth/resend-verification`.

Autres effets :
- `GET /admin/mandates` et `/admin/mandates/export.csv` : `?include_test=true`, colonne `test` ; mandats de test exclus
  par défaut ; numéros de registre de test `"TEST-0001"` (chaînes ; les réels restent des entiers). Factures
  `TEST-FAC-AAAA-NNNNN`, avoirs `TEST-AV-AAAA-NNNNN` ; les compteurs réels n'avancent jamais.
- `GET /admin/todo` : première section `{key: "test_mode"}` avec « Mode test actif » (ou « Données de test à supprimer »
  une fois le mode test désactivé s'il en reste).
- Données créées en mode test : `is_test: true` (annonces, contrats, offres, étapes de vente, factures…). Le front
  affiche « Annonce de test » sur les cartes et la fiche. Hors mode test, les annonces `is_test` sont masquées du public
  (`GET /companies`, `/companies/search`, `/companies/{id}` → 404, `/public/listing-stats`) et les comptes de
  démonstration (`…@test.local`, refusés à l'inscription) ne peuvent plus se connecter (403). Une annonce réelle dont
  le mandat en cours est un mandat de test (`mandate_is_test`) est masquée de la même façon ; elle n'est jamais marquée
  `is_test`. Jetons de session : ceux d'un compte de démonstration ou émis en mode test pour un compte `is_test`
  (revendication `tm`) répondent 401 « Session expirée » hors mode test.
- `POST /auth/login` d'un admin démo : 403 sans la clé du panneau quand elle est exigée (mot de passe démo public).
- Comptes : `kyc_provider` (`stripe`, `admin` ou `test`), `email_verified_via: "test"`. Hors mode test, une identité ou
  une adresse simulée redevient non vérifiée ; `POST /auth/verify-email` et `/auth/resend-verification` la traitent
  comme non confirmée (une vraie confirmation retire `email_verified_via`).
- Contrôles de publication : pour une annonce ou un cédant `is_test` seulement, `siren_inactif` et `doublon_siren`
  deviennent des drapeaux, SIRET fictif accepté ; e-mail, identité, mandat, métier et prix restent bloquants. Une
  annonce réelle garde tous ses contrôles pendant l'essai.
- Documents de test : « DOCUMENT DE TEST — SANS VALEUR JURIDIQUE » en tête du texte (mandat, NDA, offre) et sur les PDF.
- `GET /sitemap.xml` : routes statiques de `backend/seo_routes.json` puis `/company/{id}` des annonces publiées, jamais
  d'annonce de test.
