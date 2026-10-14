# Recentrage sur l'application + mode test (octobre 2026)

Décisions du fondateur (10 octobre 2026) :
1. **La page d'accueil marketing sort de l'application** : elle sera faite sous WordPress. L'application se concentre sur ses parcours (cédant, repreneur, admin) et sur **une page publique qui liste les annonces**.
2. **Un mode test** pour essayer toute l'application sans vérifier réellement son identité, sans dépendre de l'envoi d'e-mails et sans engager de vrais contrats.

Ce document complète `SPEC.md` et `API.md` ; en cas de conflit, il prévaut.

## A. Recentrage de l'application

### A.1 Ce qui sort
- Pages marketing supprimées : `LandingPage`, `AudiencePage` (vendre / reprendre bâtiment et RGE), `GuidesPages` (+ `seo/guides.json`), `SeoPages` (hubs bâtiment et RGE par métier, région, activité), `VerifyRgePage` (la route backend `/rge/company/{siret}/transmissibility` reste, la data room l'utilise).
- Composants qui ne servent qu'à ces pages : supprimés s'ils ne sont plus importés nulle part (vérifier par grep ; `ListingCard`, `AlertForm`, `CommissionCalculator`, `Checklist`, `BuyerCard`, `ListingPreview` restent s'ils sont utilisés par l'app).
- Les anciennes URL ne doivent pas tomber en 404 : redirections côté client **et** 301 dans `frontend/nginx.conf` :
  `/entreprises-a-vendre`, `/search`, `/buyer/search` → `/` (requête conservée) ; `/entreprises-batiment-a-vendre[/metier/:slug|/region/:slug]` et `/entreprises-rge-a-vendre[/activite/:slug|/region/:slug]` → `/?metier=…`, `/?region=…`, `/?rge=1&…` ; `/reprendre-une-entreprise-*`, `/guides[/*]`, `/verifier-entreprise-rge` → `/` ; `/vendre-mon-entreprise-*` → page « vendre » WordPress (`SELLER_LANDING_URL`, variable du conteneur frontend) ou, à défaut, `/estimer` (revue finale : un cédant ne doit pas atterrir sur la liste des annonces).

### A.2 Ce qui reste
- Parcours connectés (inchangés) : inscription, connexion, confirmation d'e-mail, profil, espace cédant, création d'annonce, mandat, espace repreneur, messagerie, data room, offre, étape de vente, admin.
- `/estimer` (estimateur) : reste, c'est l'entrée du parcours cédant ; le site WordPress pourra y renvoyer.
- Pages légales `/mentions-legales`, `/confidentialite`, `/cgu`, `/signaler` : restent (l'application signe des contrats et collecte des données ; elles doivent être accessibles depuis l'application), au même gabarit que l'application.
- `/company/:id` (fiche annonce) : reste, c'est la cible des cartes.

### A.3 La page des annonces (`/`)
`/` **est** la page des annonces (pas de redirection) ; `/entreprises-a-vendre` redirige vers `/`.
- En-tête de page sobre : H1 « Entreprises du bâtiment à vendre », une phrase (« Annonces anonymes de cédants vérifiés. Contact gratuit pour les repreneurs. »), le nombre d'annonces seulement s'il est ≥ 3.
- Filtres : métier (cases), région puis département, RGE oui/non, prix maximum, chiffre d'affaires minimum, effectif minimum ; tri (récentes, prix croissant, prix décroissant). Desktop : colonne latérale ; mobile : bouton « Filtres (n) » qui ouvre un panneau plein écran. Filtres reflétés dans l'URL (`?metier=pac-clim-cvc,isolation&region=bretagne&departement=29&rge=1&prix_max=500000&ca_min=…&effectif_min=…&tri=prix_asc&page=2`) pour être partageables et utilisables depuis WordPress.
- Cartes (`ListingCard`) en grille (1 / 2 / 3 colonnes) : titre généré, métiers (puces), région · département, effectif, CA, EBE si renseigné, prix demandé, badge « RGE vérifié ADEME » (vert, seulement si `company_checks.in_ademe_list`) ou « Qualifications déclarées » (gris), date de publication relative, favori (cœur). Toute la carte est cliquable vers `/company/:id`.
- Pagination (24 par page) avec `X-Total-Count`.
- Bloc « Recevoir les nouvelles annonces » (alerte sans compte, `AlertForm`) en bas de liste et dans l'état vide (« Aucune annonce ne correspond pour l'instant » + bouton « Effacer les filtres »).
- Appel cédant discret (encart dans la colonne ou en bas) : « Vous vendez ? Déposez une annonce anonyme » → `/register?role=seller` (ou `/seller/create` si connecté vendeur).
- SEO : `useSeo` (titre, description, canonical `/`), JSON-LD `ItemList` des annonces de la page ; pré-rendu de `/` (HTML de base, la liste se charge côté client).

### A.4 Coque de l'application
- `AppHeader` unique pour toutes les pages (publiques et connectées) : logo (→ `/`), « Annonces », « Vendre mon entreprise » (→ `/seller/create` si vendeur connecté, sinon `/register?role=seller`), puis selon l'état : « Connexion » / « Créer un compte », ou « Messages » (avec pastille non lus si dispo), « Mon espace » (→ tableau de bord du rôle), menu compte (Profil, Déconnexion). Mobile : menu déroulant. Pas de `sticky` qui recouvre les titres (voir vague 3) : `sticky top-0` autorisé seulement avec `scroll-margin-top` sur les cibles, sinon en-tête statique.
- `AppFooter` minimal : liens légaux, « Site » (→ `REACT_APP_MARKETING_URL` s'il est défini), mentions AlterEgo + carte T sur une ligne.
- Variable front `REACT_APP_MARKETING_URL` (facultative) : URL du site WordPress ; utilisée dans le pied de page et dans les e-mails ? Non : les e-mails continuent d'utiliser `SITE_URL` (l'application).

### A.5 Intégration dans WordPress : `/embed/annonces`
- Page minimale sans en-tête ni pied de page : grille de cartes compacte (mêmes filtres en paramètres d'URL que `/`, plus `limit` 1-24, défaut 6) + lien « Voir toutes les annonces ». Les liens s'ouvrent dans l'onglet parent (`target="_top"`).
- Hauteur auto : la page envoie `window.parent.postMessage({type:'cession-embed-height', height}, '*')` à chaque rendu ; extrait de code WordPress (iframe + script d'ajustement) documenté dans `docs/WORDPRESS.md`.
- `frontend/nginx.conf` : pour `location /embed/` seulement, pas de `X-Frame-Options` et `Content-Security-Policy: frame-ancestors 'self' ${EMBED_ALLOWED_ORIGINS}` (variable d'environnement du conteneur front, ex. `https://www.cessionbatiment.fr`, défaut `'self'`) ; partout ailleurs, la politique actuelle reste (`DENY`).
- `noindex` sur `/embed/*`.

## B. Mode test

### B.1 Activation
- Backend : `TEST_MODE=true` (défaut `false`). `GET /config` renvoie `test_mode: true|false`. Au démarrage en mode test : avertissement dans les journaux ; si `ENV=production`, avertissement renforcé (le mode test est permis en production pour un essai, mais il affaiblit l'authentification admin).
- Front : lit `test_mode` dans `/config` (hook `useTestMode()` dans `src/lib/testMode.js`, mis en cache une fois par session) ; aucune variable de build.
- Quand `TEST_MODE` est faux : toutes les routes `/test/*` répondent **404**, aucun champ `test_code` n'est renvoyé, aucun élément de test n'est affiché.

### B.2 Ce que change le mode test (backend)
1. **E-mails** : chaque e-mail (y compris codes de signature, confirmation, relances) est **capturé** dans `db.test_emails {id, to, subject, html, created_at}`. Il est **aussi** envoyé par Brevo seulement si `TEST_MODE_SEND_EMAILS=true` et qu'une clé Brevo est configurée ; sinon il ne part pas. Point unique d'interception : `business_model.send_brevo_email`.
2. **Codes à usage unique** : `POST /signatures/request-code` et le second facteur admin (`POST /auth/login` → `{otp_required, …}`) renvoient en plus `test_code` (le code en clair) ; même chose pour `POST /auth/resend-verification` → `test_link` (lien de confirmation).
3. **Identité** : `POST /test/identity/simulate {first_name?, last_name?, birth_date?}` (utilisateur connecté) marque l'utilisateur vérifié (`identity_verified: true`, `kyc_status: 'verified'`, `kyc_provider: 'test'`, `verified_first_name/last_name/birth_date` repris du corps ou du profil) puis déclenche **les mêmes effets** que la vérification Stripe (soumission des brouillons, déblocage des étapes de dossier). Stripe reste utilisable si des clés sont configurées.
4. **E-mail** : `POST /test/confirm-email` (utilisateur connecté) confirme sa propre adresse.
5. **Contrôles de publication assouplis** : en mode test, `siren_inactif`, `doublon_siren` et l'indisponibilité de l'open data deviennent des **drapeaux** (non bloquants) ; un SIRET de 14 chiffres quelconque est accepté ; les autres motifs bloquants restent (e-mail confirmé, identité, mandat, métier, prix).
6. **Pas de vrais engagements** :
   - registre des mandats de test séparé : compteur `mandate_registry_test`, numéro affiché `TEST-0001` ; les mandats de test **ne consomment jamais** un numéro du registre réel ;
   - factures de test : compteur `invoice_test`, numéro `TEST-FAC-AAAA-NNNNN` ;
   - tout document généré (mandat, NDA, offre, facture, ordre de paiement, mise en demeure, PDF) porte en tête **« DOCUMENT DE TEST — SANS VALEUR JURIDIQUE »** (texte du contrat et filigrane/bandeau du PDF) ;
   - registre admin et export CSV : mandats de test exclus par défaut (`?include_test=true` pour les voir), colonne « test ».
7. **Marquage des données** : tout utilisateur créé pendant le mode test a `is_test: true` ; toute annonce, conversation, demande de dossier, contrat, offre, étape de vente, facture, alerte créée par (ou pour) un utilisateur `is_test` porte `is_test: true` (helper unique `mark_test(doc, user)` appelé aux points de création ; à défaut, la purge suit les liens par `user_id` / `seller_id` / `buyer_id` / `company_id`).
8. **Données de démonstration** : `POST /test/seed` crée (idempotent) trois comptes `is_test` — `vendeur.demo@test.local`, `repreneur.demo@test.local` (profil complet, score ≥ 50), `admin.demo@test.local` (rôle admin) — avec un mot de passe commun affiché dans le panneau (`TEST_DEMO_PASSWORD`, défaut `Demo-2026!`), e-mails confirmés et identités simulées, puis **8 annonces publiées** réalistes et variées (métiers, régions, prix 90 k€ → 1,4 M€, RGE ou non, descriptions crédibles) avec mandats de test signés, appartenant au vendeur démo.
9. **Connexion rapide** : `POST /test/login-as {persona: 'vendeur'|'repreneur'|'admin'}` → `{token, user}` **uniquement** pour les trois comptes démo `is_test` (jamais pour un vrai compte ; l'admin démo ne voit que ce que voit un admin, c'est assumé en mode test et documenté). **Clé du panneau** (`TEST_PANEL_KEY`, ajout de la revue finale) : quand elle est définie, `login-as`, `seed`, la connexion de l'admin démo et le `test_code` de connexion admin exigent l'en-tête `X-Test-Key` ; sans clé, le panneau est ouvert, mais l'admin démo est fermé en production. Le front mémorise la clé lue dans `?cle=` et n'affiche le panneau qu'avec elle. Les jetons émis en mode test pour une donnée de test (revendication `tm`) et ceux des comptes démo deviennent invalides dès que le mode test est désactivé.
10. **Boîte mail de test** : `GET /test/emails?limit=50` → les e-mails dont `to` est l'adresse de l'utilisateur connecté (un admin voit tout, avec filtre `?to=`) ; `GET /test/emails/{id}` → `{id, to, subject, html, created_at}` ; `DELETE /test/emails` (admin) vide la boîte.
11. **Purge** (disponible **même hors mode test**, pour nettoyer avant l'ouverture réelle) : `POST /admin/test/purge?dry_run=true|false` (admin) supprime tout ce qui est `is_test` ou rattaché à un utilisateur `is_test` (utilisateurs, annonces, photos/documents stockés, conversations, messages, demandes de dossier, contrats, offres, étapes de vente, factures de test, alertes, événements, e-mails de test, compteurs `*_test`) et renvoie les comptes par collection ; CLI `python -m migrations.purge_test_data [--apply]`. Ne touche jamais une donnée sans `is_test` et sans lien vers un utilisateur `is_test`.
12. `GET /admin/todo` affiche une ligne « Mode test actif » tant que `TEST_MODE` est vrai.

### B.3 Ce que change le mode test (front)
- **Bandeau** `TestModeBanner` en haut de toutes les pages (ambre, non collant, une ligne) : « Mode test : identité simulée, e-mails dans la boîte de test, documents sans valeur juridique. » + lien « Panneau de test » (seulement avec la clé du panneau quand elle est exigée ; sinon « Mode test : annonces fictives », sans lien).
- **Panneau** `/test` (`pages/TestModePage.jsx`) :
  - Connexion rapide : trois boutons « Vendeur démo », « Repreneur démo », « Admin démo » (→ `POST /test/login-as`, stocke le jeton comme une connexion normale, redirige vers l'espace du rôle) ; identifiants affichés ; bouton « Créer les comptes et annonces de démonstration » (`POST /test/seed`).
  - Mon compte : « Confirmer mon e-mail », « Simuler ma vérification d'identité » (formulaire prénom/nom/date de naissance prérempli).
  - Boîte mail de test : liste (expéditeur, objet, date) + aperçu dans un `iframe` `sandbox` (sans scripts) ; bouton actualiser ; pour un admin, filtre par destinataire et « Vider ».
  - Admin : « Lancer les tâches planifiées » (`POST /admin/jobs/run`), « Supprimer toutes les données de test » (dry-run puis confirmation).
- **Raccourcis dans les parcours** (affichés seulement en mode test) :
  - `OtpSignatureDialog` : après « Recevoir mon code », encadré « Code (mode test) : 123456 » + bouton « Remplir » ;
  - `LoginPage` (second facteur admin) : code affiché et prérempli ;
  - `KYCVerification` : bouton « Simuler la vérification (mode test) » à côté du bouton Stripe ;
  - `EmailVerificationBanner` : bouton « Confirmer maintenant (mode test) ».

## C. Hors périmètre
- Pas de nouvelle page marketing dans l'application.
- Pas de simulation du passage du temps (les relances se testent avec « Lancer les tâches planifiées »).
