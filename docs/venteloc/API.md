# VenteLoc — contrat d'API (source de vérité entre backend et front)

Complète `SPEC.md`. Chemins relatifs à `/api`. Erreurs : `detail` = `{code, message}` (le front gère aussi une chaîne). Codes : `email_not_verified`, `profile_incomplete`, `identity_required`, `identity_not_needed_yet`, `already_verified`, `already_reminded`, `disputed`, `nda_required`, `funds_declaration_required`, `mandate_required`, `ownership_proof_required`, `invalid_otp`, `otp_expired`, `locked`, `not_allowed`, `validation`. Montants en euros (nombres), dates ISO 8601 (UTC), dates civiles `AAAA-MM-JJ`.

Hérité de CessionRGE sans changement de forme sauf mention : authentification, profil, e-mail confirmé, KYC, messagerie, signatures par code, documents signés, favoris, alertes (champs changés), étape de vente, factures, admin, mode test (personas changés).

## 1. Compte

| Route | Corps | Réponse |
|---|---|---|
| `POST /auth/register` | `{email, password, role: 'seller'|'buyer', first_name, last_name, phone, buyer_profile? (acquéreur), source?}` | `{token, user}` (`email_verified=false`) |
| `GET /auth/profile` · `PUT /auth/profile` | `{first_name?, last_name?, phone?, company_name?, buyer_profile?, notifications_opt_out?}` | `user` : `{id, email, role, first_name, last_name, phone, company_name, email_verified, identity_verified, kyc_status, buyer_profile, profile_score, profile_missing, notifications_opt_out, created_at}` |
| `POST /auth/verify-email {token}` · `POST /auth/resend-verification` · `POST /auth/login` · `POST /auth/login/verify` · `GET /auth/export` · `DELETE /auth/account` | inchangés | inchangés |

`buyer_profile` : `{project_type: 'particulier'|'sci'|'societe'|'professionnel', budget_max, apport, financing: 'comptant'|'emprunt'|'mixte'|'a-definir', zones: [région], property_types: [id], min_yield: number (0-20), horizon: '0-6'|'6-12'|'12+', siren?, company_name?, experience?}` ; `siren_verified` posé par le serveur. `profile_score` : project_type 15, budget_max 15, apport 10, financing 10, zones 10, property_types 10, min_yield 10, horizon 10, téléphone 10. `profile_missing` : clés sans points (`phone` inclus).

## 2. Annonces (biens)

`GET /properties` (publique) : `property_types` (ids séparés par des virgules, OU), `lease_types` (idem), `region`, `department`, `min_price`, `max_price`, `min_yield` (rendement brut minimum), `min_surface`, `sort` (`recent`|`price_asc`|`price_desc`|`yield_desc`), `limit` (≤ 100), `page` → **tableau** d'annonces publiques, en-tête `X-Total-Count`. `POST /properties/search` accepte les mêmes filtres (corps JSON, mêmes noms).

Annonce publique (`GET /properties/{id}`, cartes) :
```
{id, title, property_type, owner_type, city, postal_code, department, region, district,
 surface, rooms, floor, elevator, construction_year, units_count, units_rented,
 is_copro, copro_lots, copro_charges_annual, copro_procedure,
 dpe_class, ges_class, energy_cost_min, energy_cost_max, dpe_date, dpe_rental: {status, date},
 lease_type, rent_monthly, charges_monthly, lease_start, lease_end, tenant_since, deposit, indexation, last_revision,
 tenant_payment_status, has_gli, has_guarantor, property_tax, non_recoverable_charges, management, operator_lease_end,
 asking_price, sale_object, sale_reason, availability_note, gross_yield, net_yield,
 description, equipment, recent_works, published_at, status,
 photos: [{id, visibility: 'public'|'private', url}],   // url = /api/properties/{id}/photos/{photo_id} → {filename, content, content_type}
                                 // privées : vendeur, admin, acquéreur ayant signé l'engagement
 ownership: {status},            // 'missing'|'pending'|'verified'|'rejected' (seul le statut est public)
 property_checks: {ownership_verified, dpe_rental_status},
 commission_info: {payer:'vendeur', rate_percent_ttc, rate_percent_ht, estimate_ht, estimate_ttc, minimum_ht, minimum_ttc, terms_version},
 views, favorites_count, is_test?}
```
Jamais en public : `address`, `company_name`, `siret`, `seller_id`, `mandant_address`, `mandant_capacity`, `ownership.doc_*`. Vendeur et admin : tout. Acquéreur ayant signé l'engagement : + `address`, `company_name`, `siret` (et le nom du vendeur dans la conversation).

Vendeur :
- `POST /properties` (brouillon, champs SPEC §3 tous facultatifs) → annonce ; `PUT /properties/{id}` (mêmes champs + `mandant_address {line1, line2?, postal_code, city}`, `mandant_capacity`, `auto_accept_dataroom`) ; 400 `validation` en français (ids inconnus, description hors 200-1 500, montants négatifs, `sale_object: 'parts'` sans société).
- `GET /properties/seller/mine` (`sort`, `limit`, `page`) → tableau des annonces du vendeur, tous statuts et tous champs (`X-Total-Count`) ; `GET /properties` appelé avec un jeton de vendeur renvoie la même liste (forme historique conservée). Un acquéreur ne crée pas d'annonce (`POST /properties` → 403 `not_allowed`).
- Champs calculés par le serveur à chaque écriture (jamais pris du corps) : `title`, `department`, `region`, `gross_yield`, `net_yield` (loyers annuels − taxe foncière − charges non récupérables, rapportés au prix), `dpe_rental`, `address_key` (interne).
- `PUT /properties/{id}/status?status=` : vendeur → `paused` | `published` | `withdrawn` | `sold_elsewhere` ; admin → `removed&reason=&reason_text=` | `published`.
- Photos : `POST /properties/{id}/photos`, `GET /properties/{id}/photos`, `GET /properties/{id}/photos/{photo_id}`, `DELETE …` (inchangés).
- **Justificatif de propriété** : `POST /properties/{id}/ownership-proof` (multipart : `file` PDF/JPEG/PNG/WebP, `doc_type` ∈ `titre-propriete`|`attestation-notariee`|`taxe-fonciere`|`statuts-kbis`) → `{ownership: {status:'pending', status_label, doc_type, doc_type_label, filename, content_type, uploaded_at, reviewed_at, note}, listing_status}` (l'annonce est re-soumise si elle était bloquée) ; `GET /properties/{id}/ownership-proof` (vendeur, admin) → `{ownership: {…mêmes champs}}` (`status: 'missing'` sans dépôt) ; `GET /properties/{id}/ownership-proof/file` (vendeur, admin) → le fichier brut (`Content-Type` du fichier, 404 sans dépôt) ; admin `PUT /admin/properties/{id}/ownership {status: 'verified'|'rejected', note?}` (note obligatoire pour un refus, 400 `validation` `field: 'note'`) → `{ownership}` + e-mail au vendeur. Un refus d'une annonce en ligne ou en pause la repasse en brouillon (`blocking: ownership_proof`) ; un nouveau dépôt repasse en `pending`.
- Contrôles : la réponse de création, de mise à jour et de soumission contient `blocking: [{code, label}]` et `flags: [{code, label}]` comme aujourd'hui (codes : `email_not_verified`, `identity`, `mandate`, `property_type`, `location`, `lease`, `rent`, `price`, `dpe`, `surface`, `ownership_proof`, `siret`, `societe_cessee` ; drapeaux : `ownership_pending`, `gerant_mismatch`, `dpe_rental_ban`, `tenant_unpaid`, `duplicate_address`, `opendata_unavailable`). Les drapeaux de la relecture sont aussi dans `moderation.flags` (codes seuls). `property_checks` (vendeur, admin) : `{email_verified, siren_active, gerant_match: 'match_exact'|'match_partial'|'no_match'|'unavailable'|null, ownership_verified, dpe_rental_status, opendata_available, duplicate_address, checked_at}`. En mode test, pour les seules données de test, `societe_cessee` devient un drapeau.

## 3. Contact et messagerie
Inchangé (`POST /properties/{id}/contact {message}` → `{conversation_id}`, conversations, messages). `GET /messages/conversations` : `property_id`, `property_title` remplacent `company_*` (déjà renommés). `buyer_card` : SPEC §4.

## 4. Dossier du bien
Inchangé dans la forme (`/dataroom/{property_id}/…`, `access-status`, `access-requests`, `validate`, `reject`, `funds-declaration`). `GET /dataroom/categories` → catégories SPEC §6.3 `[{id, label, hint}]` (tableau). `POST /dataroom/{property_id}/documents` : `category` doit être l'un de ces ids (400 `validation`, `field: 'category'`) ; réponse et listes de documents avec `category` et `category_label` ; la réponse du dépôt porte aussi `warning` (rappel : masquer les données personnelles du locataire). Le contrat signé à cette étape a `doc_type: 'nda'` (identifiant technique conservé) et le titre « Engagement de confidentialité et de non-contournement ».

Fiche de reprise du bail : `GET /lease-transfer/rules?lease_type=&property_type=&sale_object=` (public) et `GET /properties/{id}/lease-transfer` (accès au dossier accordé, vendeur, admin) → `{lease_type, lease_label, regime, property_type, sale_object, points: [{key, title, text, level: 'info'|'attention'}], dpe?: {status, date, text}, summary: [string], disclaimer, source}` ; la version du bien ajoute `property_id`, `property_title`. Clés de `points` : `bail_continue`, `depot_garantie`, `prorata`, `vente_parts`, `revision`, `conge`, `bail_369`, `preference`, `bail_professionnel`, `location_parking`, `exploitant`, `decence_energetique`. Erreurs : 400 `validation` (`field` : `lease_type`, `property_type`, `sale_object`, ou bail non renseigné sur l'annonce), 403 `not_allowed`.

## 5. Offre d'achat
`POST /offers {property_id, amount, sale_object: 'bien'|'parts', financing: {equity, loan}, loan_condition: {required, amount?, max_rate?, duration_years?}, conditions: [string], target_date, validity_days (5-30), message?}` → `{offer, contract_id}`. Signature, réponse (`accept` avec code, `reject` avec motif, `counter`), `accept-counter`, `GET /offers/my` (→ `{offers: [{…offre, property: {title, property_type, city, department, region, asking_price}}]}`, clé `property` au lieu de `company`), `GET /offers/property/{property_id}`, `GET /offers/{id}/pdf` : inchangés. 400 `validation` `field: 'sale_object'` si `parts` alors que le bien n'est pas détenu par une société ou que l'annonce vend le bien. `GET /favorites` → `{favorites: [{…, property}]}`. Offre : `{id, property_id, buyer_id, amount, sale_object, financing, loan_condition, conditions, target_date, validity_days, expires_at, status, counter_amount?, contract_id, signed_at?, countersigned_at?, closing_id?}`.

## 6. Mandat
Préalable : `PUT /properties/{id}` avec `mandant_address`, `mandant_capacity` (`proprietaire`|`coindivisaire`|`gerant`|`mandataire`), `sale_object` ; sinon `POST /seller/mandat/generate` → 400 `validation` avec `missing: [champs]` (dont `siret` et `company_name` pour un bien détenu par une société). `POST /seller/mandat/generate?property_id=` → `{contract_id, contract_number, content, summary: [5 lignes], terms_version:'v1'}` ; `POST /seller/mandat/{id}/sign {otp_code}` → `{status:'signed', registry_number, signed_at, ends_at, tail_ends_at, withdrawal_ends_at, listing_status, pdf_url}` ; `POST /seller/mandat/{id}/denounce` → `{status: 'denounced'|'withdrawn_retractation', effective_at, denounced_at, tail_ends_at (null en rétractation), listing_status, label}` ; `POST /seller/mandat/{id}/renew {otp_code}` ; `GET /seller/mandat/status/{property_id}` → `{mandat: {id, status, registry_number, signed_at, ends_at, tail_ends_at, withdrawal_ends_at, effective_at?, terms_version, pdf_url} | null, presented_buyers: [...]}` ; `GET /seller/mandat/{id}/pdf`.

## 7. Étape de vente et factures
Inchangé (`/closing/*`, `/invoices/*`, `/admin/invoices*`, `/admin/closings*`) avec : `redacteur.type` ∈ `notaire`|`autre` ; `sale_object` ∈ `bien`|`parts` ; champ `avant_contrat_on` (date) modifiable par `PUT /closing/{id}/avant-contrat {avant_contrat_on}` (l'une ou l'autre partie, avant la déclaration) ; `POST /closing/{id}/declare {signed_on, final_price, sale_object}` = acte authentique signé ; `POST /closing/direct {property_id, buyer_id}`. `PUT /closing/{id}/avant-contrat` : date passée ou du jour (400 sinon), `null` efface, e-mail à l'autre partie, réponse = vue du closing. La vue porte aussi `redacteur_label`. Échéance de la facture : acte authentique + 30 jours, jamais moins de 15 jours après la date de facture.

## 8. Alertes, estimateur, configuration
- `POST /alerts/public {email, property_types: [id], regions: [région], max_price?, min_yield?}` ; alertes avec compte (`POST /alerts`, `PUT /alerts/{id}`) : mêmes champs + `name?` (et `active` en mise à jour). Désinscription, digest, NPS : inchangés.
- `POST /estimates {property_type, lease_type, department, surface?, rent_monthly, charges_monthly?, property_tax?, non_recoverable_charges?, dpe_class?, asking_price?, email?, consent?}` → `{id, low, high, mid, method, zone, expected_net_yield, net_rent, drivers: [{label, effect}], pedagogy: [string], yields: {gross_at_mid, net_at_mid, gross_at_price?, net_at_price?}, disclaimer, email?}` ; `id` toujours renvoyé (estimation anonyme conservée sans e-mail) ; e-mail facultatif (double opt-in) et, s'il est fourni, `consent: true` obligatoire (400 `validation`, `field: 'consent'`). L'ancienne route `/estimates/property/{siret}` est supprimée.
- `GET /config` → champs actuels + `commission: {rate_percent_ht, rate_percent_ttc, minimum_ht, minimum_ttc, vat_rate}`.
- `GET /public/listing-stats` → `{total, by_property_type: [{value, count, label}], by_lease_type: [{value, count, label}], by_department: [{value, count, label, region}], by_region: [{value, count, slug}]}` (comptages > 0 seulement).
- `GET /public/legal-info`, `GET /sitemap.xml` (`/annonce/{id}` ; routes statiques de `backend/seo_routes.json`, copie de `frontend/scripts/seo-routes.json`), `GET /health` : inchangés.

## 9. Admin
Inchangé, plus : section `ownership_proofs` de `GET /admin/todo` (lignes `ref: {property_id, doc_type, uploaded_at, owner_type, filename, file_url}`, actions « Voir le justificatif » `GET /properties/{id}/ownership-proof/file`, « Valider » et « Refuser avec motif » `PUT /admin/properties/{id}/ownership`), `GET /admin/properties` (objet `ownership` complet : `status, doc_type, filename, uploaded_at, reviewed_at, note`), `GET /admin/stats` → `ownership_pending`, `GET /admin/kpis` → KPI `ownership_pending` (remplace `bodacc_incidents`). `GET /admin/mandates` : lignes avec `withdrawal_ends_at`, `effective_at`, statut `withdrawn_retractation`. Motifs de retrait admin (`reason`) : `justificatif`, `informations-inexactes`, `doublon`, `bien-non-loue`, `contenu-interdit`, `autre`. Supprimés : veille BODACC (`/admin/veille/*`, section `incidents` de « À faire »), invitations de président, routes dirigeants (`/property/{siren}/dirigeants`, `verify-dirigeant`), proxys RGE (`/rge/*`).

## 10. Routes front
Publiques : `/` (`ListingsPage`, filtres URL `type`, `bail`, `region`, `departement`, `prix_max`, `rendement_min`, `surface_min`, `tri`, `page`) · `/annonce/:id` (`PropertyDetail`) · `/vendre` (`SellPage`) · `/estimer` · `/embed/annonces` · légales · `/login` · `/register` · `/mot-de-passe-oublie` · `/reset-password/:token` · `/confirmer-email/:token` · `/suivi/:token` · `/test` · 404.
Connectées : `/seller/dashboard` · `/seller/create` · `/seller/edit/:id` · `/seller/mandat/:propertyId` · `/buyer/dashboard` · `/messages` · `/dataroom/:propertyId` · `/vente/:closingId` · `/profile` · `/admin/dashboard`.

## 11. Mode test
Inchangé sauf personas : `POST /test/login-as {persona: 'vendeur'|'acquereur'|'admin'}` ; `POST /test/seed` → `listings_total: 8`.
