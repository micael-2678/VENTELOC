# HANDOFF — agent front « vendeur » (SPEC §4.2 points 2-4, §3.2 côté front, API.md §2-§4 cédant, §6)

Livré (fichiers du chantier) : `pages/CreateListing.jsx` (3 écrans, brouillon serveur), `pages/MandatePage.jsx` (v2),
`pages/SellerDashboard.jsx` (bloc « À traiter », actions, mandat, offres, dossier, statistiques), `pages/MessagesPage.jsx`
(conversations API.md §3), `pages/PresidentAcceptPage.jsx` (mandat simple), `lib/mandate.js`, `components/OtpSignatureDialog.jsx`
(résumé, texte dépliable, case activée en fin de défilement), `components/seller/` (`api.js`, `listingForm.js`, `listingStatus.js`,
`FormFields.jsx`, `TradePicker.jsx`, `ListingStatusBadge.jsx`, `ConfirmDialog.jsx`, `AccessRequests.jsx`, `OffersPanel.jsx`,
`MandatePanel.jsx`, `DataroomPanel.jsx`, `ListingActions.jsx`, `TodoBlock.jsx`), test `pages/__tests__/sellerPages.test.jsx`
(13 tests). Vérifications : `npx eslint` propre sur tous ces fichiers ; `CI=true npx craco test --watchAll=false
src/pages/__tests__/sellerPages.test.jsx` → 13/13 ; tests front existants (34) et `pytest` backend (221) inchangés et verts.

## 1. Comportements à connaître

- **CreateListing** : `/seller/create` (nouveau) et `/seller/edit/:id` (reprise ; `App.js` redirige aujourd'hui vers
  `/seller/create?edit=<id>`, les deux formes sont lues). Écran 1 → `POST /companies` (brouillon), écrans suivants et toute
  reprise → `PUT /companies/{id}` avec les seuls champs de l'écran. Préremplissage : `sessionStorage.estimate` (voir §2.4) puis
  `GET /estimates/company/{siret}` (hook `useCompanyLookup` du chantier compte) : dénomination, région/département, effectif,
  date de création, forme, métiers suggérés, qualifications RGE (`rge.domaines` / `rge.details` → `RGE_CATEGORIES`), date de fin
  RGE. Alerte « prix hors fourchette » : fourchette de l'estimateur si présente, sinon `POST /estimates` (sans e-mail, rien n'est
  stocké) à l'entrée de l'écran 3. Après l'écran 3 : `sessionStorage.kyc_return_to = /seller/mandat/<id>` (lu par
  `KYCCallbackPage`), puis redirection vers le mandat si l'identité est vérifiée, sinon écran « Plus que deux étapes » (Checklist :
  identité → mandat → publication immédiate) avec `KYCVerificationButton` (même onglet) et l'invitation du dirigeant (`InvitePresidentModal`).
- **MandatePage** : adresse postale + qualité du signataire (`mandant_capacity`) + objet → `PUT /companies/{id}` avec
  `mandant_address` **objet** (`{line1, line2?, postal_code, city}`) ; en cas de 422 (modèle encore `str`), second essai avec la
  chaîne formatée. Puis `POST /seller/mandat/generate` ; 400 `{code:'validation', missing}` → retour au formulaire, champ signalé ;
  403 `identity_required` → bloc KYC ; 403 `email_not_verified` → message (le bandeau est posé par l'intercepteur). Signature :
  `POST /seller/mandat/{id}/sign {otp_code}` seulement. Page de confirmation : registre, dates (signature, échéance, clause de suite),
  PDF (`downloadMandatePdf`), puis `GET /companies/{id}` rafraîchi : `published` → « publiée immédiatement », `draft` + `blocking`
  → motifs libellés (`LISTING_BLOCKING_LABELS` recopiés dans `components/seller/listingStatus.js`).
- **SellerDashboard** : lectures tolérantes (tableau nu d'API.md ou enveloppe `{requests}` / `{offers}` / `{closings}`,
  `components/seller/api.js`). Actions cédant : `PUT /companies/{id}/status?status=paused|published|withdrawn|sold_elsewhere`
  (API.md §2 ; **la route n'accepte aujourd'hui que l'admin**, voir §2.1), `POST /closing/direct {company_id, buyer_id}` (choix parmi
  `presented_buyers`), `POST /seller/mandat/{id}/denounce` (corps `{}`), `POST /signatures/request-code {contract_id: mandat.id}` puis
  `POST /seller/mandat/{id}/renew {otp_code}`, offres `PUT /offers/{id}/respond` (`accept` + `otp_code` via `OtpSignatureDialog` sur
  `offer.contract_id`, sans code pour une offre héritée sans contrat ; `reject` + `reason` obligatoire ; `counter` + `counter_amount`).
  Photos : vraies images (`GET /companies/{id}/photos/{photo_id}` base64). `commission_payer` : seul l'héritage v1 est affiché
  (`legacyPayerText`), nulle part ailleurs.
- **MessagesPage** : `GET /messages/conversations` (tableau), `GET /messages?conversation_id=`, `POST /messages {conversation_id,
  content}`, `PUT /messages/conversations/{id}/read` ; `?conversation=<id|company_id>` ouvre la conversation ; sous 768 px, liste puis
  fil (bouton retour). Forme historique (`{company_id: [messages]}`) encore tolérée (`normalizeConversations`) : messages embarqués,
  envoi avec `receiver_id` + `company_id`. Plus aucune LOI ni formulaire d'offre dans cette page (l'offre indicative se fait depuis
  le parcours repreneur / data room).
- **OtpSignatureDialog** : props existantes conservées ; nouvelles props `summary` (lignes), `termsDate` ; avec `summary` le texte
  intégral est replié par défaut et la case « J'ai lu » n'est activée qu'après défilement jusqu'à la fin (ou si le texte tient sans
  défilement) ; `apiErrorMessage` lit aussi `detail.message`.

## 2. À appliquer ailleurs (fichier → fonction → code)

### 2.1 `backend/server.py` → `update_company_status` (chantier parcours-v2) — **bloquant pour les actions cédant**

API.md §2 : cédant → `paused` | `published` (reprise) | `withdrawn` | `sold_elsewhere`. Aujourd'hui `if current_user["role"] != "admin": 403`.
Sketch :

```python
SELLER_STATUSES = {"paused", "published", "withdrawn", "sold_elsewhere"}
if current_user["role"] != "admin":
    if status not in SELLER_STATUSES or not is_company_owner(company, current_user):
        raise HTTPException(status_code=403, detail={"code": "not_allowed", "message": "Action réservée au cédant de l'annonce"})
    if status == "published":
        if company.get("status") != "paused":
            raise api_error(400, "validation", "Seule une annonce en pause peut être remise en ligne")
        if mandate_required() and not await has_signed_mandate(company):
            raise api_error(400, "mandate_required", "Signez un mandat avant de remettre l'annonce en ligne")
    elif company.get("status") not in ("published", "paused", "withdrawn"):
        raise api_error(400, "validation", "Cette annonce ne peut pas changer de statut")
    await db.companies.update_one({"id": company_id}, {"$set": {"status": status, "updated_at": now}})
    if status == "sold_elsewhere":
        # e-mail de rappel de la clause de suite + drapeau veille BODACC (SPEC §4.2.4, §6.4)
        await email_user(company["seller_id"], "sold_elsewhere_tail_clause", tail_ends_at=fmt_date_fr(company.get("mandate_tail_ends_at")), ...)
        await db.companies.update_one({"id": company_id}, {"$set": {"veille_flag": True, "sold_elsewhere_at": now}})
    return {"message": "Status updated", "status": status}
```
Ajouter `paused`, `withdrawn`, `sold_elsewhere` à la liste des statuts acceptés en tête de la route.

### 2.2 `backend/server.py` → `class CompanyCreate` (parcours-v2)

Le brouillon est créé à l'écran 1 : `rge_validity`, `ca_n`, `ca_n1`, `ca_n2`, `margin`, `ebitda`, `creation_date`, `staff_count`,
`legal_structure`, `pipeline`, `fixed_charges`, `debt`, `asking_price`, `sale_type` devraient devenir `Optional` (défaut `None` / `0`).
En attendant, `createPayload()` (`components/seller/listingForm.js`) envoie ces champs à `0` / `''` et les complète par `PUT` ;
`create_company` n'appelle `submit_listing` qu'avec une identité vérifiée (alors `mandat_en_attente` + e-mail « mandat à signer »
dès l'écran 1 : acceptable, mais mieux vaut **ne soumettre qu'au `PUT` de l'écran 3**, par exemple quand `asking_price > 0` et
`sale_object` est renseigné).

### 2.3 `backend/server.py` → `CompanyUpdate` (déjà demandé par contrats-v2 §2.1)

`mandant_address: Optional[Union[MandantAddress, str]]`, `mandant_capacity: Optional[Literal["dirigeant","associe","mandataire"]]`.
Le front envoie l'objet et se replie sur la chaîne en cas de 422.

### 2.4 `pages/EstimatePage.jsx` (chantier public / estimateur) → bouton « Déposer mon annonce anonyme »

Forme lue par `readEstimateSession()` (toutes les clés facultatives) :
```js
sessionStorage.setItem('estimate', JSON.stringify({
  siret, company, rge,
  inputs: { ca, ebe, staff, maintenance_contracts, team_stays, owner_dispensable },
  result: { low, high, mid },
}));
```
puis navigation vers `/register?role=seller` (ou `/seller/create` si connecté). Les alias `ca_n` / `ebitda` / `staff_count` sont aussi lus.

### 2.5 `App.js` (intégrateur, facultatif)

`/seller/edit/:id` peut rendre directement `<CreateListing user={user} />` : la page lit `useParams().id` **et** `?edit=`.

### 2.6 `backend/events.py` + `lib/analytics.js`

Événements émis par ce chantier, à ajouter à la liste fermée (sinon ignorés silencieusement) : `listing_created` (écran 1
enregistré), `mandate_signed`.

### 2.7 `frontend/package.json` → `jest.moduleNameMapper` (intégrateur)

Jest 27 ne lit pas le champ `exports` des paquets Radix ; tout test qui monte un `Dialog` / `Checkbox` Radix échoue sur
`@radix-ui/primitive/is-development`. Le test du chantier contourne par `jest.mock(..., { virtual: true })` ; pour le dépôt entier :
```json
"^@radix-ui/primitive/is-development$": "<rootDir>/node_modules/@radix-ui/primitive/dist/internal/is-development.false.js"
```
et, dans `src/setupTests.js` (à créer avec le polyfill `TextEncoder` de `jestEnv.js`), un `ResizeObserver` factice.

### 2.8 `components/shared/ListingPreview.jsx` (design-system, facultatif)

Le badge « RGE vérifié ADEME » y est fixe : pour une annonce non RGE il serait faux. L'aperçu anonyme de CreateListing utilise
donc `ListingCard` (badge calculé par `qualificationBadge`) dans un conteneur non navigable. Si l'on veut `ListingPreview`, ajouter
une prop `badge: 'verified' | 'declared' | null`.

### 2.9 `backend/server.py` → demandes de dossier, conversations (parcours-v2)

Le front lit `buyer_card`, `message`, `created_at`, `expires_at`, `steps`, `conversation_id?` sur chaque demande
(`GET /dataroom/{id}/access-requests`, tableau nu) et `access_status`, `buyer_card`, `identity_revealed`, `unread_count` sur chaque
conversation ; refus : `PUT .../reject` reçoit `{reason}` en corps **et** `?reason=` (route actuelle en query).

## 3. Points d'attention

- Aucun « 48 h », « LOI », choix de débiteur ni compteur à zéro dans les pages du chantier ; les compteurs n'apparaissent que > 0.
- Mobile : cartes et listes `min-w-0`, aucun tableau ; messagerie en deux vues sous 768 px ; boutons en colonne sous 640 px.
- `OtpSignatureDialog` reste compatible avec les appels existants (`BuyerDashboard`, DataroomPage) : sans `summary`, comportement
  d'origine (texte affiché, lecture jusqu'en bas requise).
- Les routes `PUT /companies/{id}/status` côté cédant et la forme tableau de `GET /messages/conversations` dépendent du chantier
  parcours-v2 : tant qu'elles ne sont pas livrées, les actions Pause/Retirer/Vendue renvoient un message d'erreur propre (toast) et la
  messagerie fonctionne sur la forme historique.
