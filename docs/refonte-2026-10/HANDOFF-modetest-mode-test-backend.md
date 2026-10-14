# Handoff — agent « mode-test-backend » (MODE-TEST-ET-APP.md, partie B + sitemap)

Backend livré et testé (`cd backend && python -m pytest -q` : 309 tests verts ; `ops/tests/check_env_doc.sh` OK).
Ce document donne le contrat d'API aux agents front et liste ce que l'intégrateur doit reporter dans la documentation
(`docs/refonte-2026-10/API.md`, hors de mon périmètre). Aucun changement de code n'est demandé ailleurs.

## 1. Contrat d'API (à reporter dans API.md, nouvelle section « Mode test »)

Toutes les routes `/api/test/*` répondent **404 `{"detail": "Introuvable"}`** quand `TEST_MODE` n'est pas vrai, avant
toute authentification (pas de 401/403 révélateur).

| Route | Auth | Corps / paramètres | Réponse |
|---|---|---|---|
| `GET /config` | — | — | champ ajouté `test_mode: bool` |
| `POST /test/identity/simulate` | connecté | `{first_name?, last_name?, birth_date?: "AAAA-MM-JJ"}` (défaut : profil) | `{verified: true, kyc_provider: "test", user, listings: [{id, status, title}]}` ; 400 `validation` (date invalide, personne mineure, nom manquant) |
| `POST /test/confirm-email` | connecté | — | `{verified: true, already_verified, email}` |
| `POST /test/seed` | — (5/min) | — | `{accounts: [{persona, email, role, created}], password, accounts_created, listings_created, listings_published, listings_total: 8}` ; 409 si une adresse démo appartient à un compte réel |
| `POST /test/login-as` | — | `{persona: "vendeur" \| "repreneur" \| "admin"}` | `{token, user}` ; 404 comptes absents (lancer le seed) ; 403 compte non `is_test` ; 422 persona inconnu |
| `GET /test/emails` | connecté | `?limit=1..200` (50), `?to=` (admin seulement) | **tableau** `[{id, to, from, subject, created_at}]` du plus récent au plus ancien, en-tête `X-Total-Count` ; un utilisateur ne voit que les e-mails adressés à son adresse, l'admin voit tout |
| `GET /test/emails/{id}` | connecté | — | `{id, to, from, subject, html, created_at}` (`html` = e-mail complet avec mise en page) ; 404 si ce n'est pas le sien (sauf admin) |
| `DELETE /test/emails` | admin | — | `{deleted: n}` |
| `POST /admin/test/purge` | admin, **même hors mode test** | `?dry_run=true` (défaut) \| `false` | `{dry_run, counts: {collection: n}, total, files}` |

Champs renvoyés en clair **uniquement en mode test** :
- `POST /signatures/request-code` → `test_code` (6 chiffres) ;
- `POST /auth/login` d'un admin → `test_code` dans la réponse `{otp_required: true, …}` (en mode test un nouveau code est
  émis à chaque appel, sans le délai d'une minute) ;
- `POST /auth/resend-verification` → `test_link` (lien `/confirmer-email/<jeton>` complet).

Autres changements visibles :
- `GET /admin/mandates` et `GET /admin/mandates/export.csv` : `?include_test=true` ; colonne `test` (bool) dans le JSON,
  colonne « Test » (oui/non) dans le CSV ; mandats de test exclus par défaut. Les numéros de registre de test sont des
  chaînes `"TEST-0001"` (les réels restent des entiers).
- `GET /admin/todo` : première section `{key: "test_mode", title: "Mode test"}` avec la ligne « Mode test actif » (mode
  test) ou « Données de test à supprimer » (mode test désactivé avec des données `is_test` restantes), actions
  `POST /api/admin/test/purge?dry_run=…`.
- Annonces, contrats, offres, étapes de vente, factures… créés en mode test portent `is_test: true` (visible dans les
  vues propriétaire et publiques des annonces : le front peut afficher un badge « Annonce de test »).
- Comptes : `kyc_provider` (`"stripe"`, `"admin"` ou `"test"`), `email_verified_via: "test"` après confirmation simulée.
  Hors mode test, une identité ou une adresse simulée apparaît non vérifiée (`identity_verified: false`,
  `kyc_status: "pending"`, `email_verified: false` dans `/auth/profile`) : la vraie vérification est redemandée.
- Connexion : les adresses `…@test.local` sont acceptées par `POST /auth/login` et `/auth/login/verify` (refusées à
  l'inscription) ; hors mode test, la connexion d'un compte de démonstration renvoie 403.
- `GET /companies` : nouveaux filtres `min_ca` (chiffre d'affaires N minimum) et `min_staff` (effectif minimum), aussi
  `min_staff` dans `POST /companies/search`. **Pour l'agent « app-annonces »** : le filtrage côté client de
  `listingFilters.js` n'est plus nécessaire (et `X-Total-Count` est exact avec ces filtres).
- Hors mode test, les annonces `is_test` sont masquées du public (`GET /companies`, `/companies/search`,
  `/companies/{id}` → 404, `/public/listing-stats`) ; elles restent visibles de leur propriétaire et de l'admin.
- `GET /sitemap.xml` : routes statiques de `backend/seo_routes.json` (hors anciennes pages redirigées, `/company/`,
  `/embed/`, `/test`) puis une entrée `/company/{id}` par annonce publiée (avec `lastmod`) ; **jamais d'annonce de test**,
  même en mode test.

## 2. Comportements (pour les textes du front et la doc)

- Capture des e-mails : point unique `business_model.send_brevo_email` → `db.test_emails` (purgés après 30 jours). Envoi
  Brevo en plus seulement si `TEST_MODE_SEND_EMAILS=true` **et** `BREVO_API_KEY` défini, jamais vers `@test.local`.
- Marquage `is_test` (`business_model.mark_test`) : tout ce qui est créé **pendant le mode test** (même par un compte
  antérieur) ou rattaché à une donnée de test. Une annonce dont le mandat est un mandat de test devient elle-même une
  donnée de test. Rien n'est réel en mode test : c'est voulu (« pas de vrais engagements »).
- Contrôles de publication en mode test : `siren_inactif` et `doublon_siren` deviennent des drapeaux de modération
  (libellés suffixés « mode test : non bloquant ») ; SIRET fictif accepté ; e-mail, identité, mandat, métier et prix
  restent bloquants. La remise en ligne d'une annonce en pause ignore aussi le doublon.
- Registre de test : compteur `mandate_registry_test`, numéro `TEST-0001` inséré dans le texte du mandat ; factures
  `TEST-FAC-AAAA-NNNNN` (compteur `invoice_test`), avoirs `TEST-AV-AAAA-NNNNN` (`credit_note_test`) ; les compteurs réels
  n'avancent jamais.
- Mention « DOCUMENT DE TEST — SANS VALEUR JURIDIQUE » : en tête du texte des mandats, NDA et offres de test ; bandeau
  rouge, filigrane diagonal et pied de page sur les PDF (contrats, facture, avoir, ordre de paiement, mise en demeure).
- Données de démonstration (`POST /test/seed`) : 8 annonces fictives (SIRET à clé de contrôle volontairement fausse),
  métiers et régions variés, prix 90 k€ → 1,4 M€, RGE ou qualifications déclarées, publiées par le parcours réel
  (création, adresse du mandant, mandat de test signé, contrôles, publication) ; dates de publication étalées sur deux
  mois ; la plus récente reste « à relire » dans l'écran admin.
- Purge : même fonction pour la route admin et `python -m migrations.purge_test_data [--apply]` ; supprime aussi les
  fichiers S3 des photos et de la data room ; ne touche jamais une donnée sans `is_test` ni lien vers une donnée de test
  (le journal d'audit chaîné d'une annonce réelle est conservé).

## 3. Documentation déjà à jour (mes fichiers)

`.env.example`, `backend/.env.example`, `docker-compose.yml` (transmission de `TEST_MODE`, `TEST_MODE_SEND_EMAILS`,
`TEST_DEMO_PASSWORD`), `DOKPLOY_DEPLOYMENT.md` §9 « Mode test » (activer, tester, purger, désactiver).

## 4. Pour l'intégrateur

- Reporter le §1 dans `API.md` (section « Mode test ») et, dans `SPEC.md` (ligne « SEO : … sitemap sans fiches
  `/company/:id` (non pré-rendues) »), remplacer par « sitemap : routes statiques et fiches `/company/:id` des annonces
  publiées, hors annonces de test » (le plan du site les liste désormais, MODE-TEST-ET-APP.md prévaut).
- Aucun autre fichier hors `backend/**` n'est à modifier pour ce chantier.
