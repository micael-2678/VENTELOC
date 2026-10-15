# VenteLoc — mode test

Essayer toute l'application **sans vérifier réellement son identité**, **sans dépendre de l'envoi d'e-mails** et **sans
engager de vrais contrats** (`TEST_MODE=true`). Mise en œuvre : `backend/testmode.py`, `backend/business_model.py`
(interception des e-mails, marquage `is_test`), `frontend/src/lib/testMode.js`, `frontend/src/pages/TestModePage.jsx`,
`frontend/src/components/test/*`. Mode d'emploi pour l'exploitation : `DOKPLOY_DEPLOYMENT.md` §9.

## 1. Activation
- Backend : `TEST_MODE=true` (défaut `false`). `GET /config` renvoie `test_mode: true|false`. Au démarrage en mode test : avertissement dans les journaux ; si `ENV=production`, avertissement renforcé (le mode test est permis en production pour un essai, mais il affaiblit l'authentification admin).
- Front : lit `test_mode` dans `/config` (hook `useTestMode()` dans `src/lib/testMode.js`, mis en cache une fois par session) ; aucune variable de build.
- Quand `TEST_MODE` est faux : toutes les routes `/test/*` répondent **404**, aucun champ `test_code` n'est renvoyé, aucun élément de test n'est affiché.

## 2. Ce que change le mode test (backend)
1. **E-mails** : chaque e-mail (y compris codes de signature, confirmation, relances) est **capturé** dans `db.test_emails {id, to, subject, html, created_at}`. Il est **aussi** envoyé par Brevo seulement si `TEST_MODE_SEND_EMAILS=true` et qu'une clé Brevo est configurée ; sinon il ne part pas. Point unique d'interception : `business_model.send_brevo_email`.
2. **Codes à usage unique** : `POST /signatures/request-code` et le second facteur admin (`POST /auth/login` → `{otp_required, …}`) renvoient en plus `test_code` (le code en clair) ; même chose pour `POST /auth/resend-verification` → `test_link` (lien de confirmation).
3. **Identité** : `POST /test/identity/simulate {first_name?, last_name?, birth_date?}` (utilisateur connecté) marque l'utilisateur vérifié (`identity_verified: true`, `kyc_status: 'verified'`, `kyc_provider: 'test'`, `verified_first_name/last_name/birth_date` repris du corps ou du profil) puis déclenche **les mêmes effets** que la vérification Stripe (soumission des brouillons, déblocage des étapes de dossier). Stripe reste utilisable si des clés sont configurées.
4. **E-mail** : `POST /test/confirm-email` (utilisateur connecté) confirme sa propre adresse.
5. **Contrôles de publication assouplis** : en mode test, société cessée, doublon et indisponibilité de l'open data deviennent des **drapeaux** (non bloquants) ; un SIRET de 14 chiffres quelconque est accepté pour une SCI ; les autres motifs bloquants restent (e-mail confirmé, identité, mandat, justificatif de propriété, bail, loyer, prix, DPE).
6. **Pas de vrais engagements** :
   - registre des mandats de test séparé : compteur `mandate_registry_test`, numéro affiché `TEST-0001` ; les mandats de test **ne consomment jamais** un numéro du registre réel ;
   - factures de test : compteur `invoice_test`, numéro `TEST-FAC-AAAA-NNNNN` ;
   - tout document généré (mandat, engagement de confidentialité, offre d'achat, facture, ordre de paiement, mise en demeure, PDF) porte en tête **« DOCUMENT DE TEST — SANS VALEUR JURIDIQUE »** (texte du contrat et filigrane/bandeau du PDF) ;
   - registre admin et export CSV : mandats de test exclus par défaut (`?include_test=true` pour les voir), colonne « test ».
7. **Marquage des données** : tout utilisateur créé pendant le mode test a `is_test: true` ; toute annonce, conversation, demande de dossier, contrat, offre, étape de vente, facture, alerte créée par (ou pour) un utilisateur `is_test` porte `is_test: true` (helper unique `mark_test(doc, user)` appelé aux points de création ; à défaut, la purge suit les liens par `user_id` / `seller_id` / `buyer_id` / `property_id`).
8. **Données de démonstration** : `POST /test/seed` crée (idempotent) trois comptes `is_test` — `vendeur.demo@test.local`, `acquereur.demo@test.local` (profil complet, score ≥ 50), `admin.demo@test.local` (rôle admin) — avec un mot de passe commun affiché dans le panneau (`TEST_DEMO_PASSWORD`, défaut `Demo-2026!`), e-mails confirmés et identités simulées, puis **8 annonces de biens loués publiées** (SPEC §10 : studio meublé, T2, T3, maison, immeuble, local commercial, parking, résidence étudiante ; justificatif validé, mandats de test signés), appartenant au vendeur démo.
9. **Connexion rapide** : `POST /test/login-as {persona: 'vendeur'|'acquereur'|'admin'}` → `{token, user}` **uniquement** pour les trois comptes démo `is_test` (jamais pour un vrai compte ; l'admin démo ne voit que ce que voit un admin, c'est assumé en mode test et documenté). **Clé du panneau** (`TEST_PANEL_KEY`, ajout de la revue finale) : quand elle est définie, `login-as`, `seed`, la connexion de l'admin démo et le `test_code` de connexion admin exigent l'en-tête `X-Test-Key` ; sans clé, le panneau est ouvert, mais l'admin démo est fermé en production. Le front mémorise la clé lue dans `?cle=` et n'affiche le panneau qu'avec elle. Les jetons émis en mode test pour une donnée de test (revendication `tm`) et ceux des comptes démo deviennent invalides dès que le mode test est désactivé.
10. **Boîte mail de test** : `GET /test/emails?limit=50` → les e-mails dont `to` est l'adresse de l'utilisateur connecté (un admin voit tout, avec filtre `?to=`) ; `GET /test/emails/{id}` → `{id, to, subject, html, created_at}` ; `DELETE /test/emails` (admin) vide la boîte.
11. **Purge** (disponible **même hors mode test**, pour nettoyer avant l'ouverture réelle) : `POST /admin/test/purge?dry_run=true|false` (admin) supprime tout ce qui est `is_test` ou rattaché à un utilisateur `is_test` (utilisateurs, annonces, photos/documents stockés, conversations, messages, demandes de dossier, contrats, offres, étapes de vente, factures de test, alertes, événements, e-mails de test, compteurs `*_test`) et renvoie les comptes par collection ; CLI `python -m migrations.purge_test_data [--apply]`. Ne touche jamais une donnée sans `is_test` et sans lien vers un utilisateur `is_test`.
12. `GET /admin/todo` affiche une ligne « Mode test actif » tant que `TEST_MODE` est vrai.

## 3. Ce que change le mode test (front)
- **Bandeau** `TestModeBanner` en haut de toutes les pages (ambre, non collant, une ligne) : « Mode test : identité simulée, e-mails dans la boîte de test, documents sans valeur juridique. » + lien « Panneau de test » (seulement avec la clé du panneau quand elle est exigée ; sinon « Mode test : annonces fictives », sans lien).
- **Panneau** `/test` (`pages/TestModePage.jsx`) :
  - Connexion rapide : trois boutons « Vendeur démo », « Acquéreur démo », « Admin démo » (→ `POST /test/login-as`, stocke le jeton comme une connexion normale, redirige vers l'espace du rôle) ; identifiants affichés ; bouton « Créer les comptes et annonces de démonstration » (`POST /test/seed`).
  - Mon compte : « Confirmer mon e-mail », « Simuler ma vérification d'identité » (formulaire prénom/nom/date de naissance prérempli).
  - Boîte mail de test : liste (expéditeur, objet, date) + aperçu dans un `iframe` `sandbox` (sans scripts) ; bouton actualiser ; pour un admin, filtre par destinataire et « Vider ».
  - Admin : « Lancer les tâches planifiées » (`POST /admin/jobs/run`), « Supprimer toutes les données de test » (dry-run puis confirmation).
- **Raccourcis dans les parcours** (affichés seulement en mode test) :
  - `OtpSignatureDialog` : après « Recevoir mon code », encadré « Code (mode test) : 123456 » + bouton « Remplir » ;
  - `LoginPage` (second facteur admin) : code affiché et prérempli ;
  - `KYCVerification` : bouton « Simuler la vérification (mode test) » à côté du bouton Stripe ;
  - `EmailVerificationBanner` : bouton « Confirmer maintenant (mode test) ».
