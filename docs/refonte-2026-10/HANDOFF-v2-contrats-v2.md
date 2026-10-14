# HANDOFF — agent « contrats-v2 » (SPEC §3.2 à §3.5, API.md §4-§6)

Livré : `backend/server.py` (sections gabarits, `company_contract_variables`, `/contracts/generate-for-signature`,
`/signatures/request-code`, `/contracts/{id}/sign`, `/documents/*`, `/seller/mandat/*`, `/offers/*`, jobs de mandat et
d'offre, `/admin/metrics` sans LOI), `backend/closing.py` (`POST /closing/direct`, `company_title`), nouveau
`backend/emails_contrats.py`, `backend/tests/conftest.py` (`Api.prepare_mandate / mandate / publish / accept_dataroom /
sign_nda / grant_dataroom`), `backend/tests/test_contrats_v2.py`, `tests/test_parcours.py` réécrit (offre indicative à la
place de la LOI), adaptations de `test_fondations.py`, `test_mandat_debiteur.py`, `test_signature_mandat_obligatoire.py`,
`test_integration_vague1.py`, `test_lancement.py`. Suite : `cd backend && python -m pytest -q` → **221 tests verts**.

## 1. Ce que les autres chantiers doivent savoir (comportements nouveaux)

| Route | Changement |
|---|---|
| `POST /seller/mandat/generate?company_id=` | 403 `{code:'email_not_verified'}` / `{code:'identity_required'}` ; 400 `{code:'validation', message, missing:[mandant_address, sale_object, company_name, siret]}` ; réponse `{contract_id, contract_number, content, summary:[5], terms_version:'v2', terms_date}` ; `already_signed:true` renvoie `contract` + `summary` + `pdf_url`. Un projet non signé est régénéré à chaque appel avec les données à jour de l'annonce. |
| `POST /seller/mandat/{id}/sign {otp_code}` | → `{status:'signed', registry_number, signed_at, ends_at, tail_ends_at, listing_status, pdf_url, terms_version, commission_payer, signature_hash}` ; contre-signature AlterEgo automatique, e-mail `mandate_signed_pdf` avec lien PDF par jeton (`/api/seller/mandat/{id}/pdf?token=`, binaire). |
| `POST /seller/mandat/{id}/denounce` (corps facultatif `{reason}`) | → `{status:'denounced', effective_at (+15 j), denounced_at}` ; cédant ou admin ; e-mails `mandate_denounced` (mandant) et `mandate_denounced_admin`. |
| `POST /seller/mandat/{id}/renew {otp_code}` | → `{ends_at, tail_ends_at, renewals}` ; le code se demande avec `POST /signatures/request-code {contract_id}` (autorisé sur un mandat `signed`). |
| `GET /seller/mandat/status/{company_id}` | → `{mandat_signed, mandat: {...contrat sans pdf_token, status, registry_number, signed_at, ends_at, tail_ends_at, effective_at, terms_version, pdf_url, renewals, countersignature} | null, presented_buyers:[{buyer_id, label, name, company_name, at, nda_contract_id}]}`. Le dernier mandat est renvoyé quel que soit son statut (`signed`, `denounced`, `expired`, `void`, `pending_signature`). |
| `GET /seller/mandat/{id}/pdf` | connecté : JSON `{filename, content}` (base64, inchangé pour `lib/mandate.js`) ; `?token=` : `application/pdf`. PDF = texte signé + prolongations + page « Dossier de preuve » (empreintes, dates UTC et Paris, IP, navigateur, identité, registre, `previous_evidence_sha256`). |
| `POST /contracts/generate-for-signature {company_id, doc_type:'nda'}` | `doc_type` n'accepte plus `loi` (422). 403 `{code:'identity_required'}` si identité non vérifiée ; 403 `{code:'not_allowed'}` tant que la demande de dossier n'est pas acceptée (statuts acceptés : `accepted`, `granted`, et provisoirement `validated` / `loi_pending` posés par la route `validate` de la vague 1). |
| `POST /contracts/{id}/sign {otp_code}` | NDA : `presented_buyers` += repreneur, `dataroom_access.{identity_revealed, identity_revealed_at, nda_signed_at}`, `db.conversations.{nda_signed, identity_revealed}` (update_many, sans effet tant que la collection n'existe pas), e-mails `nda_signed_seller` / `nda_signed_buyer` avec lien PDF ; réponse `{..., identity_revealed:true, document_id, pdf_url}`. Offre : voir §5. **Plus aucun octroi d'accès data room ici** (c'est l'origine des fonds qui ouvre l'accès, chantier parcours-v2). |
| `POST /signatures/request-code` | le signataire attendu est lu dans `contract.signers_pending` (liste d'ids) : repreneur pour NDA/offre, cédant pour la contre-signature d'une offre, cédant pour la prolongation d'un mandat signé. |
| `GET /documents/{company_id}/signed` | **renvoie un tableau** (plus `{documents:[...]}`) : `[{id, doc_type:'mandat'|'mandat_renewal'|'nda'|'offer'|'offer_counter'|'loi', contract_id, contract_number, signer_id, signer_role, signer_label, signed_at, signature_hash, evidence_sha256, evidence:{document_sha256, previous_evidence_sha256, ip, user_agent, identity, method, signed_at, signed_at_paris, otp}, pdf_url}]`. |
| `GET /documents/{company_id}/{doc_id}/pdf` (+ `?token=`) | PDF binaire de n'importe quel document signé (NDA, offre, mandat, anciennes LOI). Accès : signataire, parties, cédant, admin, jeton. |
| `POST /offers` | corps API.md §5 (`amount, sale_object, financing{equity,loan,vendor_loan,earn_out}, conditions[], target_date, validity_days 15-60, message`) ; exige `dataroom_access.status == 'granted'` (403 `not_allowed`) ; une seule offre ouverte par couple (400 `validation`) ; → `{offer, contract_id, content, contract_number}` ; statut `pending_signature`. |
| `PUT /offers/{id}/respond` | `{action:'accept', otp_code}` (code demandé sur `contract_id`), `{action:'reject', reason}` (motif obligatoire), `{action:'counter', counter_amount, message}`. `message` seul ne suffit plus pour refuser. Offres antérieures sans `contract_id` : acceptation sans code (héritage). |
| `PUT /offers/{id}/accept-counter {otp_code}` | → `{status:'accepted', offer, closing_id, pdf_url}` ; `offer.amount` = contre-proposition, `offer.initial_amount` conservé. |
| `GET /offers/{id}/pdf` | JSON base64 (inchangé pour `lib/offerPdf.js`), disponible dès la signature du repreneur, avec la page de preuve des deux signatures. |
| `GET /offers/my` | `offer.company` contient maintenant `title` et `trades`. |
| `GET /closing/my`, `POST /closing/direct {company_id, buyer_id}` | `company_title` sur chaque closing ; direct : cédant seulement, `buyer_id` dans `presented_buyers` (400 `validation` sinon), `offer_id: null`, une seule étape en cours par couple. |
| `GET /admin/metrics` | `totals.offers_signed` remplace `loi_signed` ; entonnoir « Offre signée » remplace « LOI signée ». |
| `GET /admin/mandates` (+ CSV) | colonnes `ends_at`, `tail_ends_at`, `effective_at`, `terms_version`, `renewals`. |
| Jobs quotidiens | `mandate_expiry` (e-mail J-30 une fois par échéance, expiration → mandat `expired`, annonce `mandat_en_attente`, e-mail `mandate_ended` avec la liste nominative), `mandate_denounce_effective` (annonce `withdrawn` à la date d'effet, même e-mail), `offers_expiry`. |

Données : contrat mandat `{terms_version:'v2', terms_date, signed_at, ends_at, tail_ends_at, status, denounced_at,
denounced_by, denounced_by_role, effective_at, effective_applied, expired_at, renewals:[{at, new_ends_at, new_tail_ends_at,
text, evidence, evidence_sha256, record_id}], mandant_address (chaîne formatée), sale_object, registry_number,
countersignature, signature_record_id, signers_pending, pdf_token}` ; annonce `{mandate_ends_at, mandate_tail_ends_at,
presented_buyers:[{buyer_id, at, nda_contract_id}], mandate_denounced_at, mandate_effective_at, mandate_ended_at}` ;
`db.documents` reçoit désormais **toutes** les signatures (mandat, prolongation, NDA, offre, contre-signature du cédant,
acceptation de contre-proposition) avec `evidence`, `evidence_sha256`, `access_token` (lien PDF des e-mails).

`CONFIDENTIAL_COMPANY_FIELDS` (constante, section companies) a reçu `mandant_address`, `mandant_capacity`,
`presented_buyers` : retirés des fiches pour les non-propriétaires.

## 2. À appliquer ailleurs (fichier → fonction → code)

1. **`backend/server.py` → `class CompanyUpdate` (chantier parcours-v2 / companies)** : `mandant_address` doit accepter
   l'objet d'API.md §2 en plus de la chaîne (les tests envoient l'objet et se replient sur la chaîne en cas de 422) ;
   ajouter la qualité du signataire (SPEC §3.2, « le signataire déclare sa qualité ») :
   ```python
   class MandantAddress(BaseModel):
       line1: str = Field(..., min_length=3, max_length=200)
       line2: Optional[str] = Field(None, max_length=200)
       postal_code: str = Field(..., pattern=r"^\d{5}$")
       city: str = Field(..., min_length=1, max_length=120)

   class CompanyUpdate(BaseModel):
       ...
       mandant_address: Optional[Union[MandantAddress, str]] = None
       mandant_capacity: Optional[Literal["dirigeant", "associe", "mandataire"]] = None
   ```
   `fmt_address()` (server.py, section contrats) accepte déjà les deux formes ; `mandant_capacity(company, user)` lit
   `company.mandant_capacity` (sinon : dirigeant si contrôle open data / président invité, sinon « mandataire des associés »).
2. **`backend/server.py` → `sanitize_company`** : pour un repreneur ayant signé le NDA, retirer aussi
   `mandant_address`, `mandant_capacity`, `presented_buyers` (aujourd'hui seul `seller_email` est retiré pour lui) :
   ```python
   for field in ("seller_email", "mandant_address", "mandant_capacity", "presented_buyers"):
       company.pop(field, None)
   ```
3. **`backend/server.py` → `validate_access_request` / `get_access_status` / `request_dataroom_access` (parcours-v2)** :
   poser `status: 'accepted'` (plus de `loi_pending` ni de recherche d'une LOI signée), messages sans « Lettre d'Intention »,
   `access-status` selon API.md §4 (`steps:{identity, nda, funds}`, `next_step`, plus de `loi_signed`). La route
   `POST /dataroom/{id}/funds-declaration` doit poser `status:'granted'`, `granted_at`, `funds_declaration` ; elle peut
   lire `dataroom_access.nda_signed_at` posé par la signature du NDA. Une fois fait, retirer `validated` et `loi_pending` de
   `DATAROOM_ACCEPTED_STATUSES` (section contrats).
4. **`backend/server.py` → `list_dataroom_documents` / `view_dataroom_document`** : textes « Vous devez signer la LOI » →
   « L'accès au dossier s'ouvre après l'accord de confidentialité et la déclaration d'origine des fonds ».
5. **`backend/server.py` → `store_verified_identity` (section kyc)** : conserver la date de naissance du rapport Stripe,
   lue par le NDA (`buyer_identity_text`) :
   ```python
   dob = outputs.get("dob") or {}
   if dob.get("year"):
       update["verified_birth_date"] = f"{dob['year']:04d}-{dob.get('month', 1):02d}-{dob.get('day', 1):02d}"
   ```
   et ajouter `verified_birth_date` à la liste des champs personnels anonymisés dans `delete_account`.
6. **`backend/server.py` → `startup()`** (facultatif, propreté) : les étapes de vente directes portent une clé synthétique
   `offer_id: 'direct:<uuid>'` (exposée `null`) parce que l'index `db.closings.create_index("offer_id", unique=True)`
   n'accepte qu'un seul `null`. Pour revenir à un vrai `null`, remplacer cette ligne par un index partiel (après
   `drop_index("offer_id_1")` en migration) :
   `await db.closings.create_index("offer_id", unique=True, partialFilterExpression={"offer_id": {"$type": "string"}})`
   puis dans `closing.create_closing_direct` passer `None` à la place de `DIRECT_OFFER_PREFIX + uuid`.
7. **`backend/business_model.py`** : `OfferCreate`, `OfferResponse` et `generate_offer_pdf` ne sont plus importés par
   server.py (modèles redéfinis dans la section offres ; PDF via `contract_pdf_bytes`). À supprimer avec leur `__all__`.
   Les gabarits `offer_received` / `offer_accepted` / `offer_rejected` de business_model sont remplacés à l'import par
   ceux d'`emails_contrats.py` (même clé) : à supprimer de business_model pour éviter le doublon.
8. **Front (chantier pages)** :
   - `MessagesPage.jsx` : `GET /documents/{id}/signed` renvoie un tableau (`setSignedDocs(docsRes.data)`), chaque ligne a
     `pdf_url` (ouvrir avec le jeton Bearer en binaire) ; plus de `loi_signed` dans `access-status`.
   - `MandatePage.jsx` : afficher `summary` (5 lignes) puis `content` dépliable, `terms_date` dans le bandeau « version
     du » ; gérer 400 `{code:'validation', missing}` (renvoi au formulaire adresse/objet) et 403 `identity_required` /
     `email_not_verified` ; après signature, `pdf_url` et `ends_at`.
   - `SellerDashboard.jsx` : `status.mandat` peut être `denounced`/`expired`/`void` ; boutons « Résilier » (`POST
     .../denounce`) et « Prolonger » (`POST /signatures/request-code` puis `.../renew {otp_code}`) ; liste
     `presented_buyers` ; réponse à une offre : `accept` demande un code (`request-code` sur `offer.contract_id`),
     `reject` exige `reason`, `counter` exige `counter_amount` ; « Vendue via la plateforme » → `POST /closing/direct`.
   - `BuyerDashboard.jsx` / `MessagesPage.jsx` : formulaire d'offre structuré (API.md §5), puis `request-code` +
     `POST /contracts/{contract_id}/sign` ; statut `countered` → bouton « Accepter la contre-proposition » (code) ;
     `pending_signature` → « Signer mon offre ».
   - `AdminMetrics.jsx` : `offers_signed` à la place de `loi_signed`.
9. **`backend/events.py` / `analytics.js`** : rien d'émis par ce chantier (`mandate_signed`, `nda_signed`, `offer_signed`
   peuvent être ajoutés à la liste fermée si l'on veut les compter).

## 3. Points d'attention

- Le texte du mandat ne contient « exclusif » et « pénalité » que dans les phrases qui les excluent (titre « (NON
  EXCLUSIF) », art. 2) ; aucune clause d'exclusivité, de pénalité ni de garantie de rémunération.
- Le numéro de registre et l'horodatage ne sont connus qu'à la signature : le projet affiche « attribué automatiquement
  lors de la signature électronique… » et « à la date et à l'heure de l'horodatage du code… », remplacés dans le texte
  signé (constantes `MANDATE_REGISTRY_PENDING`, `SIGNATURE_DATE_PENDING`). Le texte signé est ensuite figé : les
  prolongations et contre-propositions sont des addenda (`renewals[]`, `addenda[]`) avec leur propre preuve.
- Expiration d'un mandat : l'annonce repasse `mandat_en_attente` (un nouveau mandat la remet en ligne) ; dénonciation
  effective : annonce `withdrawn`. Caducité par la modération : déjà en place (vague 1), testée.
- Les e-mails de ce chantier sont transactionnels (pas de lien de désinscription) ; aucune accolade littérale, valeurs
  échappées par `render_email` (la liste des présentés est passée en texte, `buyers_list`).
