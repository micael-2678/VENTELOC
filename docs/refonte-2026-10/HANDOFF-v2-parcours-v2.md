# HANDOFF — agent « parcours-v2 » (SPEC §4.1, §4.3, §4.4, §5.2 back, §6.1, §6.3, §6.4 ; API.md §1-§4, §8, §9)

Livré : `backend/server.py` (sections auth/profil, companies, contact, conversations/messages, demande de dossier,
alertes, sitemap/listing-stats, admin kpis/costs/todo, jobs de relance), nouveau `backend/emails_parcours.py`
(gabarits enregistrés dans `business_model.EMAIL_TEMPLATES`, comme `emails_contrats.py`), `backend/tests/test_parcours_v2.py`
(20 tests), `backend/tests/conftest.py` (`Api.register` avec profil repreneur par défaut, `Api.buyer_profile`,
`Api.grant_dataroom` sur la vraie route), adaptations de `test_parcours.py`, `test_confidentialite_commission.py`,
`test_lancement.py`, `test_signature_mandat_obligatoire.py`. Suite : `cd backend && python -m pytest -q` → **241 tests verts**.
`backend/seo_routes.json` était déjà identique à `frontend/scripts/seo-routes.json` (83 routes, hub bâtiment inclus) : inchangé.

## 1. Comportements nouveaux (ce que le front lit)

| Route | Changement |
|---|---|
| `POST /auth/register` | `buyer_profile` (API.md §1) et `source` acceptés ; `phone` validé (≥ 9 chiffres, 400 `{code:'validation', field:'phone'}`) ; repreneur → `user.buyer_profile` normalisé (`zones` = régions par nom ou slug, `trades` de la taxonomie, `siren` 9 chiffres, `siren_verified` + `siren_check` posés par l'open data, `company_name` préremplie), `user.profile_score`, `user.profile_missing` ; vendeur avec `siret` → `siret`, `siret_verification` ∈ `verified｜inactive｜not_found｜deferred`, `siret_check`, `company_lookup` (nom, NAF, création, effectif, département, région, forme) et `company_name` préremplie ; open data injoignable → `deferred` (« vérification différée »), jamais bloquant. |
| `GET /auth/profile`, `POST /auth/login`, `/auth/login/verify` | `user` porte `profile_score` et `profile_missing` (repreneur), `buyer_profile` (`{}` si vide), `notifications_opt_out`, `siret`, `created_at`. |
| `PUT /auth/profile` | `{first_name?, last_name?, phone?, company_name?, siret?, buyer_profile?, notifications_opt_out?}` → `{user}` (score recalculé ; `siret: ''` efface ; SIREN du profil revérifié si changé). |
| `GET /companies` | Filtres `trades` (ids, virgules, OU), `region` (nom ou slug), `department`, `rge` (true/false), `min_price`, `max_price`, `sort` (`recent`｜`latest`｜`price_asc`｜`price_desc`), `limit` ≤ 100, `page` ; en-tête `X-Total-Count`. Un cédant connecté voit **ses** annonces (tous statuts, tous champs) ; l'admin filtre par `status`. |
| `POST /companies/search` | Mêmes filtres (`trades`, `region`, `department`, `rge`, `min_price`, `max_price`) + `rge_types`, `min_ca`, `max_ca`, `page` ; `X-Total-Count`. |
| Annonce publique | `public_listing()` : jamais `company_name`, `siret`, `seller_id`, `seller_email`, `mandant_address`, `mandant_capacity`, `presented_buyers`, `blocking`, `auto_accept_dataroom`, `veille_flag` ; `company_checks` réduit à `{in_ademe_list, dirigeant_match}` ; `is_rge` et `trades` toujours présents. Repreneur ayant signé le NDA : `company_name` et `siret` révélés, le reste retiré. |
| `PUT /companies/{id}` | `mandant_address` accepte l'objet `{line1, line2?, postal_code (5 chiffres), city}` (stocké tel quel, `fmt_address` lit les deux formes) ; `mandant_capacity` ∈ `dirigeant｜associe｜mandataire`. Baisse du prix d'une annonce en ligne → e-mail `price_drop` aux repreneurs qui l'ont mise en favori ou contactée (une fois par prix, désinscription). |
| `PUT /companies/{id}/status?status=` | Cédant : `paused` (annonce en ligne seulement), `published` (reprise d'une pause, mandat signé requis : 400 `mandate_required`), `withdrawn`, `sold_elsewhere` (e-mail `sold_elsewhere_tail_clause` avec la liste nominative des présentés et la date de fin de clause de suite, `veille_flag: true`, e-mail admin) ; 403 `not_allowed` pour un tiers ou un statut admin ; 400 `validation` sinon. Admin inchangé (`published`, `removed&reason=`, …). |
| `POST /companies/{id}/contact {message?}` | 403 `email_not_verified` (chaîne « Confirmez… », inchangée) / `{code:'profile_incomplete', profile_score, required:40, missing:[…]}` ; crée ou retrouve la conversation → `{conversation_id, company_id, already_contacted, message_id}` ; e-mail `first_contact` au cédant (extrait + carte pseudonymisée) et `contact_sent_buyer` au repreneur, une seule fois par couple. |
| `GET /messages/conversations` | **Tableau** API.md §3 trié par `last_at` desc : `{id, company_id, company_title, company_status, buyer_id, seller_id, other_party_label, buyer_card (côté cédant), last_message, last_at, last_sender_id, unread_count, nda_signed, identity_revealed, access_status, access_request_id, conversation created_at}`. Les messages historiques sans `conversation_id` sont regroupés à la volée par (annonce, repreneur) et rattachés. |
| `GET /messages?conversation_id=` | Messages chronologiques `{id, conversation_id, sender_id, sender_label, receiver_id, receiver_label, is_mine, content, created_at, read, kind: 'message'｜'system', message_type}` ; 403 `not_allowed` pour un tiers. `?company_id=` : forme historique conservée. |
| `POST /messages` | `{conversation_id, content}` (ou forme historique `{receiver_id, company_id, content}`) ; coordonnées masquées avant NDA ; le premier message d'un repreneur par la messagerie suit les règles du contact (profil ≥ 40). Réponse : le message avec `is_mine`, `sender_label`. |
| `PUT /messages/conversations/{id}/read` | `{ok:true, marked}` ; `id` = conversation (ou `company_id` historique). |
| `POST /dataroom/{id}/request-access {message?}` | 403 `profile_incomplete` sous 40 ; → `{request_id, status:'pending'｜'accepted', auto_accepted?}` ; acceptation immédiate si `auto_accept_dataroom` et score ≥ 50 (e-mails `dataroom_accepted` au repreneur, `dataroom_auto_accepted` au cédant) ; sinon e-mail `access_request` au cédant avec la carte, `expires_at` = J+10 ; demande expirée → nouvelle demande possible (même id). Message `access_request` dans la conversation. |
| `GET /dataroom/{id}/access-status` | API.md §4 : `{access_granted, access_status: null｜pending｜accepted｜granted｜rejected｜expired, steps:{identity, nda, funds}, next_step, request:{id, status, created_at, expires_at, accepted_at, granted_at, rejection_reason, auto_accepted}, conversation_id, nda_signed, identity_verified}` ; `validated`/`loi_pending` historiques lus comme `accepted` ; l'accès est accordé à la volée si les trois étapes sont faites. |
| `GET /dataroom/{id}/access-requests` | **Tableau** `[{id, buyer_id, buyer_card, buyer_label, buyer:{id,label,verified,identity_verified,created_at}, message, status, created_at, expires_at (pending), accepted_at, granted_at, rejected_at, rejection_reason, auto_accepted, steps, next_step, conversation_id, identity_revealed, funds_declaration (granted)}]`. |
| `PUT …/access/{request_id}/validate` | → `{status:'accepted'}` (idempotent ; une demande expirée peut être acceptée) ; e-mail `dataroom_accepted` avec la checklist des étapes restantes ; message système. |
| `PUT …/access/{request_id}/reject` | corps `{reason?}` **ou** `?reason=` → `{status:'rejected'}` ; e-mail `access_rejected` avec le motif. |
| `POST /dataroom/{id}/funds-declaration {source: fonds-propres｜emprunt｜mixte｜investisseurs, amount, financing_partner?}` | 403 `not_allowed` (demande non acceptée) / `identity_required` / `nda_required` dans cet ordre ; → `{access_granted:true, access_status:'granted', funds_declaration}` ; e-mails `dataroom_granted` (repreneur) et `dataroom_granted_seller` (cédant), message système, audit `DATAROOM_GRANTED`. La signature du NDA ouvre aussi l'accès si les fonds étaient déjà déclarés (`grant_dataroom_access` appelé dans `sign_contract`). |
| `POST /alerts` / `PUT /alerts/{id}` | `name` facultatif (généré), `trades`, `regions` (noms ou slugs), `max_price`, `rge` ; champs historiques (`rge_types`, `region`, `min_price`, `min_ca`, `max_ca`) toujours acceptés et filtrants. |
| `POST /alerts/public {email, trades, regions, max_price?, rge?}` | → `{status:'confirmation_sent'}` (ou `already_active` si l'adresse a déjà une alerte active : critères remplacés) ; e-mail `alert_confirm` (lien signé 7 jours). `GET /alerts/confirm/{token}` et `GET /alerts/unsubscribe/{token}` : pages HTML minimales en français (`lang="fr"`, `noindex`). Le lien de désinscription d'un **compte** (dans tous les e-mails non transactionnels) pose `notifications_opt_out:true` et désactive ses alertes. |
| Publication | `publish_company` envoie immédiatement `alert_new_listing` aux alertes (compte + sans compte) qui correspondent (`alert_matches` : métiers OU, régions OU, RGE oui/non, prix maxi), une fois par alerte et par annonce ; `listing_published` au cédant dit « envoyée à N repreneurs » (jamais « 0 »). `companies.alerts_sent_count`. |
| `GET /sitemap.xml` | Pages pré-rendues (`seo_routes.json`) + hubs garantis (`/entreprises-batiment-a-vendre`, `/metier/<slug>`, `/region/<slug>`, `/entreprises-rge-a-vendre`) ; plus aucune fiche `/company/:id` ni `/search`. |
| `GET /public/listing-stats` | `{total, rge_total, by_trade:[{value, count, slug, label}], by_department:[{value, count, label, region}], by_region:[{value, count, slug}], by_rge}` — uniquement des comptages > 0. |
| `GET /admin/kpis?weeks=8` | `{weeks:[{start, end, month, kpis}] (semaines terminées, croissantes), current:{start, end, month, kpis}, previous, targets, generated_at}` ; clés d'API.md §9 (+ `revenue_invoiced_ht`, `revenue_paid_ht`), `_pct` en 0-100, `null` quand incalculable. `targets` = cibles du rapport §7.6 ramenées à la semaine. |
| `PUT /admin/costs {month:'AAAA-MM', amount, note?}` → `{cost}` ; `GET /admin/costs` → `{costs:[…], total}` | Une ligne par mois (`db.costs`). |
| `GET /admin/todo` | Sections ajoutées : `dataroom_expired` (demandes expirées sans réponse, 30 j) et `reports` (événements `report` de `/signaler`, 30 j, action « Retirer avec motif »). Lien du digest quotidien → `/admin/dashboard`. |
| `/valorization/estimate` | Supprimée, ainsi que l'amorçage `db.valorization` au démarrage. |
| `GET /nps/{token}?score=0-10` | Réponse NPS en un clic (page HTML), `db.nps`. |

Données : `db.conversations {id, company_id, buyer_id, seller_id, created_at, last_at, last_message, last_sender_id, nda_signed,
identity_revealed}` (index unique (company_id, buyer_id)) ; `messages.conversation_id`, `messages.kind`, `messages.message_type` ;
`dataroom_access {status, message, conversation_id, requested_at, created_at, expires_at, accepted_at, auto_accepted, accepted_by,
reminders_sent, funds_declaration, funds_declared_at, granted_at, steps, expired_at, rejection_reason, profile_score}` ;
`users {buyer_profile{…, siren_verified, siren_check}, profile_score, siret_verification, siret_check, company_lookup,
notifications_opt_out}` ; `companies {auto_published, mandate_pending_since, alerts_sent_count, paused_at, paused_reason
('cedant'｜'inactivite'), resumed_at, withdrawn_at, sold_elsewhere_at, veille_flag, weekly_snapshot}` ; `db.public_alerts`,
`db.costs`, `db.nps`.

Jobs (`run_scheduled_jobs`, tous via `claim_once`) — quotidiens : `dataroom_requests` (relances cédant J+2/J+5 avec carte,
expiration J+10 → `expired` + e-mail au repreneur), `mandate_reminders` (J+1/J+4/J+10 depuis `mandate_pending_since`, une
objection par envoi), `seller_lifecycle` (14 j sans contact, 30 j prix vs fourchette `estimator.compute_estimate`, 60 j sans
connexion : avertissement à J-7 puis annonce `paused` + e-mail), `buyer_reminders` (identité J+1/J+3/J+10, NDA J+2/J+7,
data room sans consultation J+3), `nps` (7 j après vente confirmée) ; hebdomadaires : `alerts_digest`, `seller_weekly`
(vues/favoris/contacts de la semaine, jamais « 0 »). `send_reminder()` : **une seule relance par jour et par personne**
(marque `reminder_day`), lien de désinscription et `notifications_opt_out` respectés. Les relances J+30/60/90 d'offre
acceptée restent dans `closing.py` (vérifié, non dupliqué). L'ancienne relance « mandat à 3 jours » de `job_seller_relaunch`
est remplacée par `mandate_reminders`.

## 2. À appliquer ailleurs (fichier → fonction → code)

1. **`backend/events.py` → `EVENT_NAMES`** : ajouter `"report"` (page `/signaler`) pour que la section `reports` de
   `GET /admin/todo` se remplisse ; éventuellement `listing_created`, `mandate_signed`, `nda_signed`, `offer_signed`
   (HANDOFF contrats-v2 §2.9 et front-vendeur §2.6).
2. **`backend/server.py` → `store_verified_identity` (section KYC, hors de mon périmètre)** : conserver la date de naissance
   du rapport Stripe (HANDOFF contrats-v2 §2.5) :
   ```python
   dob = outputs.get("dob") or {}
   if dob.get("year"):
       update["verified_birth_date"] = f"{dob['year']:04d}-{dob.get('month', 1):02d}-{dob.get('day', 1):02d}"
   ```
   (`delete_account` anonymise déjà `verified_birth_date`.)
3. **`backend/business_model.py`** : les gabarits `listing_published`, `new_contact`, `access_request`, `access_validated`,
   `access_rejected`, `dataroom_granted`, `new_message`, `seller_reply` sont remplacés à l'import par ceux
   d'`emails_parcours.py` (mêmes clés) : à supprimer de `business_model` pour éviter le doublon, avec `OfferCreate`,
   `OfferResponse`, `generate_offer_pdf` et les `offer_*` déjà signalés par contrats-v2.
4. **`backend/server.py` → `startup()`** (facultatif) : index partiel sur `closings.offer_id` (HANDOFF contrats-v2 §2.6).
5. **Front** (le contrat est respecté, rien de bloquant) :
   - `CompanyDetail` / `BuyerDashboard` : 403 `profile_incomplete` porte maintenant `profile_score`, `required` et `missing`
     (clés du barème) : utilisable pour dire quoi compléter.
   - `AdminMetrics` : `GET /admin/kpis` renvoie `current` sous la forme `{start, end, kpis}` et `weeks` = semaines terminées
     (forme acceptée d'après HANDOFF-v2-admin §2).
   - `AlertForm` (sans compte) peut envoyer `rge: true|false` (accepté).
   - `MessagesPage` : `kind:'system'` sur les messages automatiques (demande acceptée/refusée/expirée, accès ouvert, NDA, offres).
6. **`docs/refonte-2026-10/API.md`** : §4 `GET …/access-requests` et §3 sont servis tels quels ; ajouter `reports` et
   `dataroom_expired` aux sections de `GET /admin/todo`, `GET /nps/{token}` et `GET /alerts/unsubscribe` (compte) si l'on veut
   les documenter.

## 3. Points d'attention

- Le SIREN du profil repreneur n'est **pas** soumis à la clé de Luhn (comme `opendata.lookup_siren`) : 9 chiffres suffisent ;
  « société vérifiée » n'est posé que si le registre national renvoie l'entreprise active.
- Un repreneur inscrit avant la refonte (sans profil) a un score de 0 et doit compléter son profil pour contacter (403 explicite).
- `GET /companies` sans jeton ou avec un jeton repreneur ne renvoie que les annonces `published` et scrubbées, même avec `status=`.
- Les e-mails transactionnels (contact transmis, dossier accepté, accès ouvert, expiration, vente) n'ont pas de lien de
  désinscription ; tous les rappels et digests en ont un.
- `test_parcours_v2.py` réinitialise volontairement la marque `reminder_day` (`reset_daily_gate`) entre deux relances du même jour
  pour tester chaque jalon ; la règle « un e-mail de relance par jour et par personne » est testée dans
  `test_mandate_reminders_j1_j4_j10_once_per_day` et `test_buyer_reminders_identity_nda_dataroom`.
