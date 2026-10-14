# Handoff — agent « mode-test-front » (MODE-TEST-ET-APP.md §B.1 côté front et §B.3)

Lint propre sur mes fichiers ; `CI=true npx craco test --watchAll=false` : 14 suites, 178 tests verts (dont 20 nouveaux
dans `src/components/test/__tests__/testMode.test.jsx`). Pas de `npm run build` (à faire par l'intégrateur).

## 1. Livré

| Fichier | Rôle |
|---|---|
| `src/lib/testMode.js` | `useTestMode()` → `{testMode, loading}` ; `isTestMode()` synchrone ; `loadTestMode()` ; `resetTestModeCache()` (tests). Lecture de `GET /api/config` par `fetch` (comme `useLegalInfo` : pas d'en-tête d'auth, pas de redirection 401, pas d'interférence avec les mocks axios des tests existants), une requête par chargement partagée par tous les composants, valeur gardée en `sessionStorage` (`cession:test_mode`) pour un affichage immédiat au rechargement puis confirmée par `/config`. Erreur réseau → pas de mode test. |
| `src/components/test/TestModeBanner.jsx` | Bandeau ambre, une ligne, non collant, lien « Panneau de test » (masqué sur `/test`) ; texte court sur mobile. Rien hors mode test ni pendant la lecture de `/config`. |
| `src/pages/TestModePage.jsx` | `/test` : connexion rapide (3 personas, `POST /test/login-as`, stockage `token` + `user` + `setUser` exactement comme `LoginPage`, redirection `homePathFor`), identifiants affichés (mot de passe renvoyé par le seed, sinon `Demo-2026!` signalé « par défaut »), seed ; « Mon compte » (confirmer l'e-mail, simuler l'identité avec prénom/nom/date préremplis) ; boîte mail ; outils admin. Hors mode test : « Le mode test n'est pas activé » + lien vers les annonces, et pour un admin la purge (disponible même hors mode test, §B.2.11). `usePrivateSeo` (noindex). |
| `src/components/test/TestInbox.jsx` | Liste (objet, expéditeur, destinataire, date), `X-Total-Count`, aperçu `iframe sandbox=""` via `srcDoc`, liens http(s) de l'e-mail repris sous l'aperçu (les liens ne sont pas cliquables dans un iframe sans permission), filtre destinataire et « Vider » (avec confirmation) pour l'admin. |
| `src/components/test/TestAdminTools.jsx` | « Lancer les tâches planifiées » (`POST /admin/jobs/run`) ; purge : `dry_run=true` → détail par collection (libellés français, collections vides masquées) → « Confirmer la suppression » (`dry_run=false`). Un compte de démonstration qui purge est déconnecté (son compte est supprimé). |
| `src/components/test/testActions.js`, `TestPanelSection.jsx` | Appels partagés (`simulateIdentity`, `confirmEmailNow`, `storeSession`, `refreshUser`) ; carte de rubrique. |
| `OtpSignatureDialog.jsx` | `test_code` de `POST /signatures/request-code` → encadré « Code (mode test) : 123456 » + « Remplir ». |
| `LoginPage.jsx` | `test_code` du second facteur admin : encadré + champ prérempli ; « Renvoyer un code » disponible tout de suite en mode test (le serveur émet un nouveau code à chaque appel). |
| `KYCVerification.jsx` | Dans la boîte de dialogue, sous « Commencer la vérification » (Stripe) : « Simuler la vérification (mode test) » → `POST /test/identity/simulate` (nom/prénom du profil), profil relu et rangé (`localStorage` + `setUser` du `SessionContext`), puis rechargement complet comme au retour de Stripe. Placé dans la boîte plutôt qu'à côté du bouton d'ouverture pour ne pas casser les mises en page qui l'utilisent (`w-full`, emplacements « action » de `TodoBlock`, `CreateListing`, `MandatePage`…). |
| `EmailVerificationBanner.jsx` | « Confirmer maintenant (mode test) » → `POST /test/confirm-email` puis `/auth/profile` relu. |

Codes de test : affichés seulement si le serveur renvoie `test_code` (jamais hors mode test, B.2.2). Boutons de
simulation, bandeau et panneau : seulement si `useTestMode()` est vrai.

## 2. Écarts de contrat (déjà absorbés côté front)

- `POST /test/seed` renvoie `{accounts, password, accounts_created, listings_created, listings_published, listings_total}`
  (et non `{created:{users, listings}}`) : les deux formes sont lues (`seedSummary`).
- `POST /test/confirm-email` renvoie `{verified, already_verified, email}` sans `user` : le compte est toujours relu sur
  `GET /auth/profile` (même chose après `POST /test/identity/simulate`, dont la réponse `user` sert de repli).
- `GET /test/emails` contient aussi `from` : affiché comme expéditeur.

## 3. Pour l'intégrateur

- `App.js` (agent « app-annonces ») monte déjà correctement le bandeau (`AppBanners`, hors `/embed/`) et la route
  `/test` avec `user` et `setUser` : rien à changer.
- `API.md` : reprendre le §1 de `HANDOFF-modetest-mode-test-backend.md` ; ajouter que le front lit `test_mode` sans
  variable de build.
- Suggestion (hors de mon périmètre, facultative) : badge « Annonce de test » sur `ListingCard` / `CompanyDetail` quand
  l'annonce porte `is_test: true` (champ renvoyé par le backend).
