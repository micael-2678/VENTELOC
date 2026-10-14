# HANDOFF — chantier « compte-estimateur » (vague 2, front)

Périmètre livré : SPEC §4.1, §4.2 point 1, §4.6 côté public ; API.md §1 et §8 ; HANDOFF-vague-2 §1.
Aucun fichier hors de ma liste n'a été modifié. Backend inchangé (`pytest -q` : 221 tests verts au moment de la livraison).

## 1. Fichiers livrés

| Fichier | Contenu |
|---|---|
| `frontend/src/pages/EstimatePage.jsx` | `/estimer` : SIRET (facultatif, `?siret=` accepté) → `GET /estimates/company/{siret}` → 3 chiffres + 3 cases → `POST /estimates` → fourchette, méthode, leviers (`drivers`), « ce qui fait monter la valeur » (`pedagogy`), e-mail facultatif (second `POST /estimates` avec `email`, texte double opt-in), `?confirmation=ok|invalide|expire`, bouton « Déposer mon annonce anonyme » (sessionStorage `estimate`, puis `/seller/create` si cédant connecté sinon `/register?role=seller`). Événements `estimate_started` / `estimate_completed`. |
| `frontend/src/pages/VerifyRgePage.jsx` | `/verifier-entreprise-rge` : `GET /rge/company/{siret}/qualifications` + `GET /rge/company/{siret}/transmissibility` (en parallèle, `allSettled`) → qualifications avec organisme, dates et statut, niveau de transmissibilité, titres vs fonds, organismes, référent technique, décennale, chantiers aidés, réforme, CTA « Estimer cette entreprise » → `/estimer?siret=…`. `useSeo` avec `content.verifyRge`. |
| `frontend/src/pages/ConfirmEmailPage.jsx` | `/confirmer-email/:token` → `POST /auth/verify-email {token}` ; états succès / déjà confirmée / expiré / invalide ; renvoi (`POST /auth/resend-verification`, compte à rebours 60 s) pour l'utilisateur connecté ; met à jour `localStorage.user` + `setUser`. |
| `frontend/src/components/EmailVerificationBanner.jsx` | Bandeau « Confirmez votre adresse e-mail » (props `user`, `setUser`, `compact`) : renvoi avec délai, bouton « J'ai cliqué sur le lien » (relit `GET /auth/profile`). Exports nommés : `isEmailNotVerifiedError(err)`, `refreshStoredUser(setUser)`. App.js l'utilise déjà tel quel. |
| `frontend/src/pages/LoginPage.jsx` | `{otp_required:true, email}` → champ code (`autocomplete=one-time-code`) → `POST /auth/login/verify {email, code}` ; « Renvoyer un code » rejoue `/auth/login` (le serveur ne renvoie pas de nouveau code avant 60 s, `resent:false` géré). Marque via `BRAND`. |
| `frontend/src/pages/RegisterPage.jsx` | `?role=seller|buyer` présélectionne ; cédant : prénom, nom, e-mail, mot de passe, téléphone (format FR validé), SIRET facultatif avec préremplissage open data (« vérification différée » si indisponible, jamais bloquant), nom d'entreprise ; repreneur : un seul écran avec le profil de projet (API.md §1) et le score live (« profil complet à X % ») ; après inscription : écran « Vérifiez votre boîte mail » avec le score serveur (`user.profile_score`) ; événements `register_started` / `register_completed` ; reprend `sessionStorage.estimate` (SIRET, nom) pour un cédant venu de l'estimateur. |
| `frontend/src/pages/ProfilePage.jsx` | Plus d'upload KYC ; identité via Stripe (`KYCStatus` + `KYCVerificationButton`, texte selon le rôle) ; coordonnées (`PUT /auth/profile`), profil repreneur modifiable avec score, préférence `notifications_opt_out`, mot de passe (jeton remplacé par `token` de la réponse), export (`GET /auth/export` → téléchargement JSON), suppression (`DELETE /auth/account` corps `{password}`, puis déconnexion). |
| `frontend/src/pages/ResetPasswordPage.jsx`, `FollowupPage.jsx` | Marque via `BRAND`, erreurs via `apiErrorMessage`. |
| `frontend/src/components/KYCVerification.jsx` | Textes alignés : identité demandée au NDA (repreneur) / au mandat (cédant), jamais pour contacter ; export `identityPurpose(role)` ; `KYCGate action='sign_nda'|'sign_mandate'` (anciennes valeurs tolérées) ; page de retour `/kyc/callback` lit `sessionStorage.kyc_return_to` (chemin interne) pour revenir à l'étape en cours. API inchangée (`KYCStatus`, `KYCVerificationButton`, `KYCGate`, `KYCCallbackPage`, export par défaut). |
| `frontend/src/components/DirigeantVerification.jsx` | Dirigeant = badge, jamais un blocage ; lit `status` / `message` / `reason` de l'API open data (`match_exact｜match_partial｜no_match｜unavailable`) tout en restant compatible `verified` / `matched_as` / `president` ; invitation du dirigeant « pour qu'il signe lui-même le mandat ». API inchangée. |
| `frontend/src/components/account/*` (nouveau) | `AuthShell` (gabarit des pages de compte), `ChoiceGroup` (choix simple/multiple à cases **très visibles** : carte navy pleine + coche + récapitulatif), `SiretField` + `siret.js` (`useCompanyLookup`, `normalizeCompanyLookup`, `cleanSiret`, `formatSiret`…), `CompanyPrefillCard` (+ `RgeQualificationList`), `BuyerProfileFields`, `ScoreMeter`, `profileScore.js` (`computeProfileScore`, `buyerProfilePayload`, `buyerProfileFromUser`), `errors.js` (`apiErrorMessage`, `apiErrorCode`, `isEmailNotVerifiedError`), `index.js`. Tests : `__tests__/account.test.jsx` (15 tests). |

Vérifications : `npx eslint` sur tous ces fichiers = 0 erreur ; `CI=true npx craco test --watchAll=false src/components/account` = 15/15 ; `src/components/shared` = 17/17 ; `cd backend && python -m pytest -q` = 221 verts.

## 2. À appliquer par l'intégrateur / autres chantiers (hors de mes fichiers)

### 2.1 Backend — routes de compte attendues par le front (API.md §1), **non encore en place dans `server.py`**

1. `POST /auth/register` (`UserRegister`) : accepter `buyer_profile` (objet API.md §1), `source` (le front envoie `source`, API.md ; le modèle actuel lit `acquisition_source` → ajouter `source: Optional[str]` et stocker `acquisition_source = user.source or user.acquisition_source`), calculer et renvoyer `user.profile_score` (`buyer_profile_score()`), vérifier `buyer_profile.siren` via `opendata.lookup_siren` → `buyer_profile.siren_verified` (jamais bloquant). Pour un cédant avec `siret`, préremplir `company_name` via `opendata.lookup_siren` si absent (« vérification différée » si indisponible).
2. `PUT /auth/profile {first_name?, last_name?, phone?, company_name?, siret?, buyer_profile?, notifications_opt_out?}` → `{user}` avec `profile_score` recalculé (le front accepte aussi un `user` nu). Le front envoie `siret: ''` pour effacer.
3. `GET /auth/profile` : exposer `buyer_profile`, `profile_score`, `notifications_opt_out`, `siret`, `created_at` (déjà le cas pour les champs stockés).
4. Barème du score (identique à `frontend/src/components/account/profileScore.js`) : project_type 15 · budget_max 15 · apport 10 · financing 10 · zones 10 · trades 10 · horizon 10 · phone 10 · siren vérifié 10.

### 2.2 Formes de réponse réellement servies (le front les lit telles quelles, API.md reste à aligner)

- `GET /estimates/company/{siret}` renvoie `company: {available, found, message, company_name, naf_code, naf_label, creation_date, staff_count, staff_label, department, department_label, region, legal_structure, forme_juridique, trades, etat, siren_active}` et `rge: {available, found, message, qualifications: [noms], details: [{nom_qualification, organisme, domaine, lien_date_debut, lien_date_fin, nom_certificat, url_qualification}], verified_at}` (estimator.py). `normalizeCompanyLookup()` accepte aussi les noms d'API.md (`nom_complet`, `naf`, `naf_libelle`, `date_creation`, `tranche_effectif`, `departement`).
- `GET /rge/company/{siret}/transmissibility` renvoie `{available, found, message, company, diagnostic: {qualifications[{name, organisme_label, domaine, date_debut, date_fin, status, days_left}], level{value,label,reasons}, transfer{titres,fonds,recommended,recommendation}, organismes[], referent{label,text,steps}, decennale{label,titres,fonds,steps}, aides, reforme[], disclaimer, verified_at}}` (transmissibility.py), pas la forme plate d'API.md §8.

### 2.3 CreateListing (chantier front-vendeur) — `sessionStorage.estimate`

Écrit par `EstimatePage` au clic « Déposer mon annonce anonyme » :
```json
{
  "siret": "12345678900012",
  "company": { "available": true, "found": true, "name": "DUPONT SAS", "naf": "43.22A", "nafLabel": "…", "nafInBuilding": true,
               "creationDate": "2009-03-02", "staffCount": 7, "staffLabel": "6 à 9 salariés", "department": "29",
               "departmentLabel": "Finistère", "region": "Bretagne", "legalStructure": "SAS", "formeJuridique": "…",
               "trades": ["pac-clim-cvc"], "etat": "actif", "sirenActive": true },
  "rge": { "available": true, "found": true, "qualifications": [{ "name": "QualiPAC", "organisme": "Qualit'EnR", "domaine": "…",
           "dateDebut": "2024-01-01", "dateFin": "2027-03-01", "certificat": "…" }], "organismes": [], "domaines": [], "verifiedAt": "…" },
  "ca": 450000, "ebe": 60000, "staff": 4, "low": 180000, "high": 260000, "mid": 220000, "saved_at": "2026-10-10T…"
}
```
`company` / `rge` sont `null` sans SIRET ; `siret` vaut `""`. À consommer puis `sessionStorage.removeItem('estimate')` une fois le brouillon créé. `rge.qualifications[].name` correspond aux libellés ADEME (`rge_types`), `company.trades` aux ids `TRADES`.

### 2.4 Pages qui lancent Stripe Identity (DataroomPage, MandatePage, CreateListing)

Avant d'ouvrir `KYCVerificationButton`, poser `sessionStorage.setItem('kyc_return_to', '/dataroom/<id>')` (chemin interne) : `KYCCallbackPage` y revient après vérification, sinon tableau de bord du rôle. `KYCGate` : `action='sign_nda'` (repreneur) ou `'sign_mandate'` (cédant).

### 2.5 Toutes les pages connectées — 403 e-mail non confirmé

```js
import { isEmailNotVerifiedError } from '@/components/EmailVerificationBanner';
// ou : import { isEmailNotVerifiedError, apiErrorMessage } from '@/components/account/errors';
catch (err) { if (isEmailNotVerifiedError(err)) return; /* App.js affiche déjà le bandeau via l'intercepteur */ toast.error(apiErrorMessage(err)); }
```
`apiErrorMessage(err, repli)` lit `detail` chaîne, `{code, message}` ou tableau de validation.

### 2.6 Tests front (fichier hors de ma liste)

Deuxième fichier de test livré : déplacer le polyfill `TextEncoder` de `src/components/shared/jestEnv.js` vers `src/setupTests.js` (HANDOFF-vague-2 §8) ; les deux fichiers de test importent `jestEnv` en attendant, sans effet de bord. Radix Dialog n'est pas résolu par Jest 27 (`@radix-ui/primitive/is-development`) : mon test le remplace par `jest.mock('@/components/ui/dialog', …)` ; un `moduleNameMapper` global dans `package.json > jest` éviterait de le répéter.

### 2.7 Composants réutilisables par les autres chantiers

- `ChoiceGroup` (`@/components/account/ChoiceGroup`) : cases cochées impossibles à manquer (demande du fondateur) ; à utiliser dans CreateListing (métiers, autres qualifications) et les filtres si besoin — `multiple`, `columns`, `compact`, `testId`.
- `SiretField` + `useCompanyLookup` + `CompanyPrefillCard` : préremplissage open data + ADEME commun à l'inscription, au profil et à l'annonce.
- `AuthShell` : gabarit des pages de compte (`PresidentAcceptPage` peut l'adopter).
