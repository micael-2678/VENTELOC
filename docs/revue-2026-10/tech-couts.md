# Audit technique, sécurité et coûts de fonctionnement — CessionRGE

*Audit réalisé le 9 octobre 2026 sur le dépôt `/home/user/Cession-rge` (HEAD `5ee13a1`), avec un backend local de test (`http://127.0.0.1:8001/api`, MongoDB simulé, e-mails interceptés). Angle : un service qui doit tourner seul, sans astreinte, sans commerciaux, et pas cher.*

---

## 0. Résumé sincère

**La base technique est honnête et plutôt bien pensée pour un projet solo** : anonymat des annonces appliqué côté serveur, mandat + NDA + LOI signés par code e-mail avec preuves, filigrane réellement incrusté dans les PDF, journal d'audit chaîné, tâches de relance idempotentes, 47 tests de bout en bout qui passent en 37 s dans la CI. Ce n'est pas une démo : les parcours critiques fonctionnent.

**Mais en l'état, ce service ne peut pas tourner « seul » en production**, pour cinq raisons concrètes :

1. **Des secrets de production sont dans l'historique Git** (clé Stripe *live* `sk_live_51Sct29…`, clé API Brevo, mot de passe MongoDB de prod). Ils ont été retirés du fichier mais restent dans l'historique du dépôt GitHub. À révoquer **aujourd'hui**.
2. **Toute erreur Stripe devient une erreur 500** : le code attrape `stripe.error.StripeError`, module qui n'existe plus dans la version épinglée (`stripe==13.0.1`). Vérifié en direct : `POST /api/kyc/create-verification-session` → `HTTP 500 Internal Server Error`. Le KYC, cœur du modèle de confiance, casse dès que Stripe tousse.
3. **Aucune limite de débit nulle part**, et le hachage bcrypt tourne dans la boucle d'événements : 25 tentatives de connexion acceptées en 7,9 s (≈ 316 ms chacune, chacune bloquant tout le serveur). Une seule machine peut à la fois forcer un mot de passe et rendre le site indisponible.
4. **Pas de sauvegarde, pas d'alerte, pas de suivi d'erreurs** : `/api/health` répond « ok » même si MongoDB est mort ; les erreurs ne sont que dans les logs du conteneur ; personne n'est prévenu. Et sans S3 configuré, les documents de data room sont stockés en base64 dans Mongo (10 Mo/document) : à 500 annonces, c'est ~20 Go dans la base, sur un VPS de 40 Go.
5. **Le « sans intervention humaine » n'est pas atteint** : chaque annonce dont le nom du dirigeant ne correspond pas exactement au registre, chaque pièce d'identité déposée à la main, chaque facture de commission, chaque retrait d'annonce par un cédant, chaque demande d'avocat finit dans la boîte mail de l'admin et attend un clic. Le levier n'est pas technique, il est dans les règles (publication par défaut, suppression des chemins manuels).

**Côté coûts, la bonne nouvelle** : l'infrastructure fixe tient dans **10–15 €/mois** (un VPS, un nom de domaine, stockage objet, outils gratuits). **La mauvaise** : le poste variable dominant est Stripe Identity (≈ 1,50 € par vérification aboutie, à confirmer sur stripe.com — page inaccessible depuis cet environnement). Avec l'obligation actuelle de vérifier l'identité de *tout* repreneur avant le *premier* message, on paie ~5 à 10 vérifications par annonce publiée, soit ~450 €/mois à 500 annonces/an, pour des gens qui pour la plupart ne transigeront jamais. Déplacer la vérification au moment du NDA divise ce coût par deux sans affaiblir la chaîne de preuve.

**Recommandation en une phrase** : trois jours de corrections ciblées (secrets, Stripe, rate limiting, sauvegardes, Sentry/UptimeRobot, health réel) rendent le service déployable sans astreinte ; ensuite, supprimer le code mort (crédits, abonnements, contrats admin, reset mot de passe admin) et les chemins manuels avant d'ajouter la moindre fonctionnalité v2.

---

## 1. Périmètre, méthode et limites

**Lu** : `docker-compose.yml`, `DOKPLOY_DEPLOYMENT.md`, `frontend/nginx.conf`, `frontend/Dockerfile`, `backend/Dockerfile`, `.env.example`, `backend/.env.example`, `backend/requirements.txt`, `backend/requirements-dev.txt`, `backend/server.py` (6 243 lignes, 112 routes), `backend/business_model.py` (698 lignes), `backend/storage.py`, `backend/watermark.py`, `backend/migrations/mandate_backfill.py`, `backend/tests/*` (8 fichiers, 47 tests), `.github/workflows/tests.yml`, `frontend/package.json`, `frontend/craco.config.js`, `frontend/scripts/prerender.mjs`, `frontend/src/App.js`, `frontend/src/seo/content.json`, `frontend/build/` (tailles), `docs/business-model-v2-rapport-ecarts.md`.

**Exécuté** (sans rien modifier au dépôt, sans redémarrer le backend) :
- `pytest` complet : `47 passed, 6 warnings in 37.26s`.
- Sondes HTTP sur le backend local : CORS, 25 connexions erronées chronométrées, 3 demandes de réinitialisation enchaînées, création de session KYC (500), `/openapi.json` (112 chemins), `/docs` (200).
- `git log -p --all` à la recherche de secrets.
- Mesures gzip des bundles.

**Limites** :
- Pas d'accès à la production (Dokploy, Stripe, Brevo, DNS) : les points SPF/DKIM, sauvegardes Dokploy et routage Traefik sont évalués d'après la doc et le code.
- `stripe.com/fr/identity/pricing` est **inaccessible depuis cet environnement** (proxy : `CONNECT tunnel failed, 403`). Le prix retenu (≈ 1,50 $/€ par vérification aboutie) vient de sources tierces concordantes ; **à confirmer sur la page officielle avant tout budget**.
- Les prix VPS/Brevo cités sont ceux de sources publiques (instantané août 2026 pour Hetzner, après la hausse de juin 2026).

**Captures disponibles** (produites par les audits UX de la même session, réutilisées ici comme preuves de l'interface admin) :
- `/tmp/claude-0/-home-user-Cession-rge/ce38f6ec-42e9-581c-a8b8-72299bf0cff5/scratchpad/shots/admin-dash-390.png` — tableau de bord admin (mobile).
- `/tmp/claude-0/-home-user-Cession-rge/ce38f6ec-42e9-581c-a8b8-72299bf0cff5/scratchpad/mshots/admin-mandates.png` — registre des mandats admin.
- `/tmp/claude-0/-home-user-Cession-rge/ce38f6ec-42e9-581c-a8b8-72299bf0cff5/scratchpad/mshots/mandat-dialog.png` et `mandate-signed.png` (dans `shots/`) — signature par code e-mail.
- `docs/revue-2026-10/accueil-design/desktop-home.png` — accueil pré-rendu.
- Journal du backend de test : `/tmp/claude-0/-home-user-Cession-rge/ce38f6ec-42e9-581c-a8b8-72299bf0cff5/scratchpad/backend.log` (8 traces `AttributeError: module 'stripe' has no attribute 'error'`).

---

## 2. Architecture actuelle (telle que déployée)

```
Internet ──TLS (Let's Encrypt via Traefik/Dokploy)──┐
                                                    ▼
   frontend : nginx:alpine, build React pré-rendu (44 pages statiques + app-shell SPA)
             ne proxifie PLUS /api (bloc retiré dans 457b76b) → le routage /api doit être
             fait par Traefik (non documenté dans DOKPLOY_DEPLOYMENT.md)
                                                    │ /api
                                                    ▼
   backend : python:3.11-slim, uvicorn mono-processus, FastAPI, server.py 6 243 lignes
             - boucle de tâches interne (relances, suivis) toutes les heures (JOBS_ENABLED)
             - e-mails Brevo en tâche de fond (sib-api-v3-sdk, SDK déprécié)
             - Stripe Identity (KYC), Stripe Checkout (crédits — désactivé), reportlab/pypdf/Pillow
             - APIs externes : ADEME Data Fair (RGE), recherche-entreprises.api.gouv.fr, INPI (optionnel)
                                                    │
                                                    ▼
   mongodb : mongo:7, volume local `mongo_data`, AUCUNE sauvegarde configurée
             fichiers (data room, photos, pièces KYC) en base64 dans Mongo si S3_BUCKET vide
   (optionnel) S3 compatible (Scaleway/OVH/MinIO) : SSE AES256, 25 Mo/fichier
```

Points structurants :
- **Un seul processus** fait tout : API, tâches planifiées, filigrane PDF (CPU), envoi d'e-mails. C'est acceptable à cette échelle, mais tout blocage de la boucle (bcrypt, pypdf sur gros PDF) gèle l'ensemble.
- **Le compte admin est créé/forcé au démarrage** depuis `ADMIN_EMAIL`/`ADMIN_PASSWORD` (`server.py:6052-6080`).
- **Les flags métier** (`FF_BUYER_CREDITS=false`, `FF_SELLER_COMMISSION=true`, `FF_MANDATE_REQUIRED=true`, `FF_OTP_SIGNATURE=true`) laissent en place ~800 lignes de code mort (crédits, abonnements, remboursements, paiements Stripe).

---

## 3. Coûts de fonctionnement réalistes

### 3.1 Hypothèses d'usage

| Scénario | Annonces publiées / an | Cédants vérifiés | Repreneurs vérifiés (1) | E-mails / jour (2) | Fichiers data room |
|---|---|---|---|---|---|
| **0** (site en ligne, vide) | 0 | 0 | 0 | < 5 | 0 |
| **50** | 50 | ~75 (brouillons inclus) | ~250 | 15–40 | ~2–5 Go |
| **500** | 500 | ~750 | ~2 500 | 300–500 | ~20–50 Go |

(1) Avec la règle actuelle « identité vérifiée obligatoire avant le premier message » (`server.py:1803-1807` et `3038-3043`), scénario central de l'audit business (8 contacts/annonce, un repreneur contacte ~2 annonces, 30 % des inscrits vérifient sans jamais contacter).
(2) Le trafic e-mail est dominé par les **alertes** (`trigger_alerts_for_company`, `server.py:4441` : un e-mail par alerte active correspondante, à chaque publication) ; le parcours lui-même pèse ~10 e-mails par annonce (93 e-mails pour 9 annonces dans le journal de test `emails.jsonl`).

### 3.2 Coût mensuel (HT, hors temps du fondateur)

| Poste | 0 annonce | 50 annonces/an | 500 annonces/an | Source / note |
|---|---|---|---|---|
| **VPS** (Hetzner CX23 2 vCPU/4 Go ≈ 6 € ; CX33 4 vCPU/8 Go ≈ 11–13 €) | 6 € | 6–12 € | 12–25 € | Prix Hetzner août 2026 après hausse de juin ; 8 Go nécessaires si le build React se fait sur le VPS (Dokploy + Traefik + Postgres + Redis ≈ 1,5 Go, build CRA ≈ 2 Go) |
| **Dokploy** | 0 € | 0 € | 0 € | Open source auto-hébergé |
| **MongoDB** (dans le VPS) | 0 € | 0 € | 0 € | Atlas M0 gratuit (512 Mo) impossible dès que les fichiers sont en base ; Atlas M10 ≈ 55 €/mois : inutile |
| **Stockage objet S3** (Scaleway : 75 Go offerts puis ~0,012 €/Go ; Hetzner Object Storage 5,99 €/To) | 0 € | 0–1 € | 1–6 € | **Obligatoire** en prod (voir §4.3) |
| **Sauvegardes** (snapshot Hetzner +20 % ou `mongodump` → S3) | 1 € | 1–2 € | 2–5 € | Aujourd'hui : 0 € et 0 sauvegarde |
| **Brevo** (gratuit 300/jour ; Starter ≈ 9 €/5 000 e-mails, ≈ 17 €/20 000) | 0 € | 0–9 € | 9–20 € | Dépasse le gratuit uniquement par les alertes ; un digest quotidien règle le problème |
| **Stripe Identity** (≈ 1,50 €/vérification aboutie, à confirmer) | 0 € | 30–70 € | 300–700 € | **Poste dominant.** 0 € si la session échoue (`requires_input` non facturé) |
| **Nom de domaine** cessionrge.fr | 1 € | 1 € | 1 € | ≈ 8–12 €/an ; boîte contact@ incluse chez la plupart des registrars |
| **Monitoring** : UptimeRobot (gratuit), Sentry (gratuit 5 000 erreurs/mois) | 0 € | 0 € | 0 € | Non installés aujourd'hui |
| **Audience** : Plausible cloud 9 € (optionnel) ou rien | 0 € | 0–9 € | 0–9 € | Les métriques admin internes suffisent au début |
| **Total** | **≈ 8–10 €** | **≈ 45–110 €** | **≈ 330–770 €** | |

Lecture : à 500 annonces, **90 % du coût est le KYC**. L'infrastructure reste sous 50 €.

### 3.3 Leviers pour réduire (par ordre d'impact)

1. **Vérifier l'identité du repreneur au NDA, pas au premier message** (`server.py:1803` et `3038`). Le premier message est pseudonymisé et les coordonnées sont masquées (`mask_contacts`, `server.py:1654`) ; le risque avant NDA est faible. Le NDA est le moment où l'identité devient juridiquement nécessaire (preuve de signature). Effet : ÷2 sur les vérifications repreneur, soit ~150–300 €/mois économisés à 500 annonces. Alternative : OTP e-mail + SIREN vérifié (gratuit) avant NDA, Stripe Identity au NDA.
2. **Ne pas lancer la session Stripe sans intention** : aujourd'hui un repreneur peut vérifier son identité depuis son profil sans avoir choisi d'annonce ; déclencher la vérification depuis le bouton « Contacter / Signer le NDA » uniquement.
3. **Alertes en digest quotidien** (une tâche de plus dans `jobs_loop`) au lieu d'un e-mail par annonce → reste dans le gratuit Brevo plus longtemps et évite le spam.
4. **S3 Scaleway fr-par** (75 Go offerts) plutôt qu'AWS : 0 € jusqu'à ~500 annonces.
5. **Construire les images dans GitHub Actions** (gratuit pour un dépôt privé jusqu'à 2 000 min/mois) et laisser Dokploy *tirer* l'image : permet de rester sur un VPS 4 Go (6 €) au lieu de 8 Go.
6. **Supprimer les dépendances inutiles** (`pandas`, `numpy`, `pdfkit`, `jq`, `typer`, `rich`, `black`, `flake8`, `mypy`, `s5cmd`, `oauthlib` — aucune n'est importée) : image plus petite (~300 Mo de moins), builds plus rapides, moins de CVE.

---

## 4. Points de fragilité pour un service sans astreinte

### 4.1 Tâches internes dans le processus (`JOBS_ENABLED`) — **acceptable, à instrumenter**

- `jobs_loop` (`server.py:6191-6197`) : `sleep(60)` puis `run_scheduled_jobs()` toutes les 3 600 s, lancée dans `startup` (`6218-6219`).
- **Bien** : chaque relance passe par `claim_once` (`6098-6106`) avec index unique `job_marks(kind,key)` → idempotent, aucun doublon même si deux instances tournaient.
- **Fragile** : (a) les exceptions sont seulement loguées (`6186`), personne n'est averti ; (b) si la boucle d'événements se bloque, les tâches s'arrêtent **silencieusement** ; (c) `job_seller_reminders` charge *toutes* les sociétés et *tous* les messages en mémoire chaque heure (`6112-6115`) — fine à 500 annonces (~50 000 messages), pas au-delà ; (d) `/credits/check-refunds` (remboursements) n'est *pas* dans la boucle : il exige un appel admin manuel — code mort tant que les crédits sont désactivés.
- **Verdict cron vs boucle** : garder la boucle (déjà idempotente, zéro composant en plus) **mais** écrire un horodatage `job_runs.last_ok` et l'exposer dans `/api/health` ; UptimeRobot alerte si l'âge dépasse 2 h. Un cron système `docker exec backend python -m jobs` est l'alternative si vous voulez découpler ; pas prioritaire.

### 4.2 Sauvegardes MongoDB — **absentes (critique)**

- `docker-compose.yml:16-17` : volume local `mongo_data`, rien d'autre. Aucun `mongodump`, aucun snapshot, aucune mention dans `DOKPLOY_DEPLOYMENT.md`.
- Conséquence : une erreur de manipulation Dokploy (suppression du service), un disque plein ou un VPS corrompu = perte des mandats signés, des preuves de signature (OTP, IP, hash de document), des factures. Pour un titulaire de carte T, ce sont des pièces à conserver.
- **Correction (S, 1 h)** : Dokploy sait sauvegarder un service « Database » vers S3 (quotidien, rétention 30 jours) ; sinon un cron `mongodump --archive | gzip | aws s3 cp` (10 lignes). **Tester une restauration une fois.**

### 4.3 Fichiers en base vs S3 — **S3 doit devenir obligatoire**

- `storage.py:20-22` : sans `S3_BUCKET`, 10 Mo max par fichier, contenu base64 (+33 %) dans le document Mongo (`save_file`, `34-37`). Photos (5 par annonce, 5 Mo), pièces KYC (5 Mo), data room (10 Mo, illimité en nombre).
- À 500 annonces × 10 documents × 3 Mo × 1,33 ≈ **20 Go dans Mongo** sur un VPS de 40 Go : disque plein → Mongo s'arrête → site hors ligne, et les sauvegardes deviennent impraticables.
- `view_dataroom_document` (`server.py:2113-2188`) charge le fichier entier en RAM, applique le filigrane (pypdf, hors boucle via `to_thread`, bien) puis renvoie du **base64 dans du JSON** : un PDF de 25 Mo = ~35 Mo de JSON. Tolérable à faible concurrence.
- **Correction (S)** : refuser le démarrage en prod sans `S3_BUCKET` (ou au moins un `logging.error` + `/health` dégradé), Scaleway fr-par, SSE déjà géré (`storage.py:43-44`).

### 4.4 Reprise après crash

- `restart: always` ✔, `depends_on: service_healthy` ✔, index créés au démarrage ✔, état entièrement en base ✔ (les `BackgroundTasks` d'e-mail en vol sont perdues — acceptable, l'utilisateur redemande un code après 60 s).
- **Faux** : le healthcheck `docker-compose.yml:73-77` appelle `curl`, absent de `python:3.11-slim` → le conteneur est toujours « unhealthy » sous Compose. Remplacer par `python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8001/api/health',timeout=3).status==200 else 1)"`.
- **Trompeur** : `/api/health` (`server.py:3232-3235`) renvoie `{"status":"ok"}` sans toucher Mongo ni vérifier les tâches. Un moniteur externe verra « up » base morte.
- `stripe.error` (voir §5.2) : les erreurs Stripe ne sont pas « récupérées », elles deviennent des 500.

### 4.5 Limites de débit — **inexistantes** (détail §5.3)

### 4.6 Taille et maintenabilité de `server.py` (6 243 lignes, 112 routes)

- Un seul fichier mélange modèles, 36 gabarits d'e-mail (dans `business_model.py`), textes juridiques complets (NDA, LOI, mandat : `server.py:4780-5210`), routes, tâches, migrations. `print()` côtoie `logging`. `@app.on_event` est déprécié (avertissement pytest).
- Code mort identifiable : packs/abonnements (`CREDIT_PACKS`, `SUBSCRIPTION_PLANS`, `/payments/*`, `/credits/*`, `/admin/stripe/*`, `check-refunds`), générateur de contrats admin (`/admin/contracts/*`, `5276-5552`), collection `documents` (`/admin/documents`, `4586`) parallèle à `generated_contracts`, table `credit_contacts` « ancienne » (`3049`), `/lawyer/request`.
- **Risque réel pour un fondateur seul** : chaque modification assistée par IA touche un fichier de 6 000 lignes ; les régressions se cachent dans les 65 % de routes non couvertes par les tests. **Ne pas réécrire** : découper mécaniquement en routeurs (`auth`, `listings`, `dataroom`, `contracts`, `messages`, `admin`, `jobs`, `legal_texts`) et supprimer le code mort derrière les flags (M, 2–3 jours, −1 500 lignes).

### 4.7 Dépendances externes au moment de l'annonce

- ADEME Data Fair (`server.py:614-690`), recherche-entreprises.api.gouv.fr (`945-1020`), INPI (`850-885`, optionnel). Timeouts 10–15 s ✔, hors boucle via `to_thread` ✔, **aucun cache, aucun retry**. Si l'ADEME est en panne, la vérification RGE échoue et le cédant ne peut pas avancer.
- **Correction (S)** : cache Mongo `rge_cache{siret → résultat, 24 h}` ; en cas d'échec réseau, accepter l'annonce en `pending` avec revérification par la tâche horaire.

### 4.8 Déploiement : écarts entre la doc et le code

- `frontend/nginx.conf` ne proxifie plus `/api` (retiré dans `457b76b`), mais `DOKPLOY_DEPLOYMENT.md` étape 5 ne crée qu'un domaine → frontend, et la section « Dépannage » (`l.236-240`) parle encore du `proxy_pass`. Un déploiement « à la doc » renvoie `app-shell.html` sur `/api/*`. Il faut documenter la règle Traefik `domaine + chemin /api → backend:8001` (Dokploy : *Domains → Path*).
- `docker-compose.yml:69` publie `8001:8001` sur l'hôte : l'API est joignable en HTTP clair sur l'IP du VPS, hors TLS et hors Traefik, avec `/docs` ouvert. Et `frontend` publie 443 alors que nginx n'écoute que 80.
- Le domaine `cessionrge.alteregopatrimoine.com` est codé en dur dans **7 fichiers** (`frontend/Dockerfile:17`, `frontend/.env.production`, `public/index.html` (og:image), `public/robots.txt`, `backend/seo_routes.json`, `docker-compose.yml` défauts, `prerender.mjs` défaut) tandis que `cessionrge.fr` est le défaut côté backend (`server.py:5244-5245`, `business_model.py:223`). Basculer sur cessionrge.fr = 7 modifications + rebuild. Un seul `SITE_URL` en build-arg/env.
- `ADMIN_NOTIFICATION_EMAIL` est utilisé par `email_admin` (`1680`) mais `closing/declare` (`3907`) et `lawyer/request` (`3767`) lisent `ADMIN_EMAIL` avec défaut `contact@cessionrge.fr` : les notifications de closing (donc de facturation) peuvent partir vers une boîte qui n'existe pas.

---

## 5. Sécurité

### 5.1 Secrets de production dans l'historique Git — **CRITIQUE, à traiter aujourd'hui**

Preuves (`git log -p --all`) :
- Commit `608c5f4` (2026-03-02, « auto-commit ») ajoute dans `DOKPLOY_DEPLOYMENT.md` : `STRIPE_SECRET_KEY=sk_live_51Sct29GXCms87XZ6…` (clé **live**, tronquée ici volontairement) et `BREVO_API_KEY=xkeysib-d491e1c6e1466a40…`. Retirés dans `edaaf38` (2026-09-24) mais **toujours présents dans l'historique**.
- Commits `4c3eedb` (2025-12-29) et `608c5f4` : `MONGO_URL=mongodb://mongo:isoikzfx70yv9if@cessionrge-cessionrge-fs5dmv:27017` (mot de passe et nom d'hôte interne de prod), toujours présents dans `DOKPLOY_DEPLOYMENT.md:52` sous forme d'« exemple ».
- `HEAD` est propre (`git grep` vide), mais le dépôt est sur GitHub (`micael-2678`), avec des PR : toute personne ayant eu accès (collaborateur, outil connecté, fuite de token) détient ces clés.

Impact : une clé Stripe live donne le contrôle total du compte (remboursements, virements, export des données d'identité vérifiées) ; la clé Brevo permet d'envoyer des e-mails au nom de CessionRGE (hameçonnage de vos propres utilisateurs).

Actions (S, 1 h) : révoquer et régénérer la clé Stripe, la clé Brevo, le mot de passe Mongo ; activer *GitHub secret scanning + push protection* ; optionnel : purger l'historique (`git filter-repo`) — moins important que la révocation. Ajouter un hook pré-commit `gitleaks`.

### 5.2 `stripe.error` n'existe plus → 500 sur tout le parcours Stripe — **CRITIQUE, correction 10 min**

- `requirements.txt` épingle `stripe==13.0.1` ; `python -c "import stripe; hasattr(stripe,'error')"` → `False`.
- 6 occurrences : `server.py:326, 386, 414, 3337, 3425, 3531`. Dès qu'une exception Stripe survient, l'évaluation de la clause `except stripe.error.StripeError` lève `AttributeError` → `500 Internal Server Error` (preuve : `backend.log`, 8 traces ; sonde live `POST /api/kyc/create-verification-session` → `HTTP 500`).
- Cas concrets en prod : Stripe indisponible 30 s, clé révoquée, utilisateur déjà en session → page blanche d'erreur au lieu d'un message ; webhook Identity avec signature invalide → 500 au lieu de 400 (Stripe réessaie pendant 3 jours puis désactive l'endpoint après trop d'échecs).
- Correction : `except stripe.StripeError` / `except stripe.SignatureVerificationError`. Ajouter un test qui simule `stripe.identity.VerificationSession.create` levant `stripe.StripeError`.

### 5.3 Force brute, déni de service et spam — **MAJEUR**

- Aucun middleware de limitation (grep `slowapi|limiter|429` : seuls les OTP ont une protection, `2704-2706`, `2743`, `2789`).
- `login` (`server.py:518-532`) appelle `verify_password` (bcrypt, synchrone, `67-68`) **dans la boucle asyncio** : mesuré 25 tentatives en 7,9 s = 316 ms chacune, pendant lesquelles **aucune autre requête n'est servie**. Pas de verrouillage, pas de délai progressif, pas de notification.
- `forgot-password` (`553-579`) : 3 appels successifs → 3 × `200` → 3 e-mails Brevo. Un script peut vider le quota gratuit (300/jour) en une minute et bombarder la boîte d'un utilisateur.
- `signatures/request-code` : 1/min **par contrat** (`2741-2743`), mais rien par utilisateur ou par IP.
- `register` : création de comptes illimitée (spam, pollution des métriques, e-mails de bienvenue).
- Corrections (S–M, ½ jour) : `await asyncio.to_thread(verify_password, …)` ; `slowapi` (en mémoire, suffisant pour un seul processus) : `5/min` sur `/auth/login`, `3/h` sur `/auth/forgot-password` et `/auth/register` par IP, `10/h` sur `/signatures/request-code` par utilisateur ; complément Traefik `RateLimit` middleware sur `/api/auth`. Journaliser les échecs par e-mail et alerter (Sentry) au-delà de 50/h.

### 5.4 JWT, sessions, en-têtes — **MAJEUR**

- Jetons HS256 valables **7 jours** (`server.py:73`), stockés en `localStorage` (`App.js:51`), aucune révocation : changer ou réinitialiser le mot de passe (`545-589`) ne déconnecte pas un attaquant ; le `role` est embarqué mais, bien, relu en base à chaque requête (`141-147`).
- `nginx.conf` : **aucun** en-tête `Strict-Transport-Security`, `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`. Une XSS (le seul `dangerouslySetInnerHTML` est le logo SVG interne, `Logo.jsx:10`, sans risque) donnerait un jeton 7 jours.
- Correction (S) : en-têtes nginx ; `iat` dans le jeton + champ `password_changed_at` comparé dans `get_current_user` ; durée 24 h (le front redirige déjà sur 401, `App.js:57-67`).

### 5.5 CORS `*` + `allow_credentials=True` — **MAJEUR par défaut, mineur si configuré**

- `server.py:6083-6088` : `allow_origins` lu depuis `CORS_ORIGINS` avec défaut `'*'` ; `docker-compose.yml:42` reprend ce défaut. Sondé : `access-control-allow-origin: *` + `access-control-allow-credentials: true` pour une origine arbitraire.
- Comme l'auth est en `Bearer` (pas de cookie), l'exploitation directe est limitée ; mais la combinaison `*`+credentials est non conforme et un simple oubli de variable ouvre l'API à tout site. Correction (S) : pas de défaut `*` ; refuser le démarrage si `CORS_ORIGINS` est vide en prod.

### 5.6 Uploads : type déclaré par le client, pas d'analyse — **MAJEUR (modéré)**

- `read_upload` (`server.py:118-125`) vérifie `file.content_type` **envoyé par le navigateur**, pas les octets. Un exécutable renommé passe si le client déclare `application/pdf`.
- Pas d'antivirus ; les PDF peuvent contenir du JavaScript/pièces jointes ; ils sont rendus par pdf.js côté client (`SecurePdfViewer.jsx`) ce qui limite l'exécution, et les images des repreneurs sont ré-encodées par Pillow (`watermark.py:52-64`, neutralise les charges utiles). Les documents vus par le **cédant** lui-même ne sont pas filigranés, donc renvoyés bruts (`2174`).
- Correction (S) : vérifier les octets magiques (`%PDF-`, `\xff\xd8`, `\x89PNG`, `RIFF…WEBP`) ; pour les PDF, repasser par `pypdf` (réécriture sans `/JS`, `/OpenAction`, `/EmbeddedFiles`) ; ClamAV est trop lourd (1 Go RAM) pour ce VPS — ne pas l'installer.

### 5.7 Data room — **bon, avec une promesse marketing fausse**

- Accès : cédant, admin, ou repreneur avec `dataroom_access.status=granted` (`2124-2139`) obtenu par LOI signée + validation du cédant ✔. Journal d'accès + audit chaîné ✔. Filigrane réellement incrusté (`watermark.py`), testé (`test_parcours.py`) ✔.
- `GET …/download` renvoie 403 « Téléchargement non autorisé » (`2255-2264`) **mais** `POST …/view` renvoie le fichier complet en base64 : n'importe qui l'enregistre en deux clics. La vraie protection est le filigrane nominatif ; ne pas promettre « non téléchargeable ».
- Le hash chaîné (`151-193`) n'est pas ancré ailleurs (pas d'horodatage externe) : il prouve l'ordre, pas l'absence de réécriture par l'opérateur. C'est honnête de le dire ainsi dans les CGU.

### 5.8 Admin — **MAJEUR**

- Un seul compte, sans 2FA, mot de passe en variable d'environnement ; le rôle admin est ré-appliqué à chaque démarrage sur `ADMIN_EMAIL` (`6075-6079`).
- `POST /admin/users/{id}/reset-password` (`4552-4584`) génère un mot de passe, l'envoie **en clair par e-mail** et **le renvoie dans la réponse JSON** (`temp_password`). Inutile (il existe `forgot-password`) et dangereux : à supprimer.
- `GET /admin/messages` (`4708`) expose `content_original` (coordonnées non masquées) de toutes les conversations : lecture intégrale des échanges privés. À restreindre à un mode « litige » tracé.
- `/docs` et `/openapi.json` publics (`app = FastAPI()` sans `docs_url=None`, `server.py:59`) : 112 routes dont toutes les routes admin exposées → `FastAPI(docs_url=None, redoc_url=None, openapi_url=None)` en prod.
- Pas de journal des actions admin (qui a publié/rejeté/validé un KYC).

### 5.9 Webhook paiements accepté sans signature — **MAJEUR (dormant)**

- `server.py:3433-3439` : si `STRIPE_WEBHOOK_SECRET` est vide, l'événement est construit depuis le corps brut (`stripe.Event.construct_from(json.loads(payload)…)`) et **crédite `db.credits`** (`3447-3470`) sans contrôle de `FF_BUYER_CREDITS`. Aujourd'hui sans effet commercial (crédits désactivés), mais c'est un faux à portée de `curl`. Le webhook Identity fait bien (503 sans secret, `403-406`) : aligner ou supprimer la route.

### 5.10 RGPD — **MAJEUR**

- La politique de confidentialité (`frontend/src/seo/content.json`, section « Durées de conservation ») contient **cinq fois « durée à préciser »** et promet effacement et portabilité, mais :
  - aucune route de suppression de compte ni d'export (`grep delete` : seuls photos, documents, favoris, alertes) ;
  - aucune purge : `password_resets`, `signature_otps`, `kyc_sessions`, `dataroom_access_logs`, `audit_logs`, `contact_attempts`, `messages.content_original` sont conservés sans limite ; aucun index TTL ;
  - **pièces d'identité en base64** dans `users.kyc_documents` (`595-611`) pour le dépôt manuel depuis `ProfilePage.jsx:56`, conservées indéfiniment, lisibles par l'admin ; nom/prénom certifiés par Stripe copiés dans `users` (`97-105`).
- Sous-traitants déclarés ✔ (Stripe, Brevo, hébergeur, S3) ; transferts hors UE mentionnés ✔.
- Corrections : (S) index TTL Mongo sur `password_resets` (1 h), `signature_otps` (24 h), `kyc_sessions` (30 j) ; (S) supprimer le dépôt manuel de KYC (Stripe uniquement) et vider `kyc_documents` existants après validation ; (M) `DELETE /auth/me` qui anonymise (e-mail → `deleted-<uuid>`, nom, téléphone) en conservant mandats/factures/preuves de signature (obligation légale, 10 ans comptable / 5 ans civil) ; (S) `GET /auth/me/export` JSON ; (S) remplacer « à préciser » par des durées réelles (compte : 3 ans après dernière activité ; messages et journaux : 5 ans après clôture du dossier ; OTP : 24 h).

### 5.11 E-mails (SPF/DKIM/DMARC, contenu) — **MAJEUR pour la délivrabilité**

- Rien dans le dépôt ne l'empêche, mais tout dépend de la configuration Brevo : le domaine de `SENDER_EMAIL` (défaut `contact@cessionrge.fr`, `business_model.py:223`) doit être **authentifié** (DKIM + SPF `include:spf.brevo.com` + DMARC). Si le site tourne sur `alteregopatrimoine.com` et envoie depuis `cessionrge.fr`, le désalignement nuit à la délivrabilité des codes de signature — l'e-mail le plus critique de la plateforme.
- **Le code de signature est dans l'objet** de l'e-mail (`server.py:2757` : `f"Votre code de signature : {code}"`). Il apparaît dans les notifications d'écran verrouillé, les aperçus, les journaux de passerelles. Le texte dit lui-même « il vaut signature ». Mettre le code uniquement dans le corps (S, 1 ligne). Les tests (`conftest.py:otp`) lisent le code dans l'objet : adapter la regex sur le corps.
- `admin_reset_password` envoie un mot de passe en clair (§5.8).

### 5.12 Ce qui est correct en sécurité (à ne pas casser)

bcrypt via passlib ; `JWT_SECRET` aléatoire si absent (`47-53`) ; rôle `admin` non choisissable à l'inscription (`Literal["seller","buyer"]`, `197`, testé) ; réinitialisation : jeton aléatoire, **haché** en base, 1 h, réponse non énumérante (`553-589`) ; OTP : 6 chiffres, haché avec `JWT_SECRET`, `compare_digest`, 5 essais, 10 min, usage unique atomique (`2778-2802`) ; webhook Identity exige une signature (`403-406`) ; projections qui retirent `password_hash` et le contenu KYC (`86-88`) ; anonymat appliqué côté serveur (`CONFIDENTIAL_COMPANY_FIELDS`, `scrub_contacts`, `mask_contacts`) et testé ; `html_escape` sur toutes les valeurs injectées dans les e-mails (`1669`, `1684`) ; `.dockerignore` présents ; secrets uniquement via variables d'environnement.

---

## 6. Observabilité

État : `logging.basicConfig(level=INFO)` vers stdout (`server.py:6091-6095`) ; Dokploy affiche les logs du conteneur (pas de rétention configurée) ; aucun Sentry, aucun e-mail d'erreur, aucun identifiant de requête, aucune métrique système, aucune alerte de disque. Les erreurs de tâches planifiées sont loguées et oubliées. `print()` dans `create_admin_account`.

Cible, **à 0 €** (S, ½ jour) :
1. **Sentry** (plan gratuit, 5 000 événements/mois) : `sentry-sdk[fastapi]` + `@sentry/react` ; capture des 500, des exceptions de tâches, des erreurs JS ; alerte e-mail au fondateur au premier événement d'un nouveau type. C'est la seule façon de découvrir le bug `stripe.error` sans qu'un utilisateur se plaigne.
2. **UptimeRobot** (gratuit, 50 moniteurs, 5 min) : (a) `GET /api/health` avec mot-clé `"db":"ok"` ; (b) page d'accueil ; (c) `jobs_age_seconds < 7200` exposé dans health. Alerte e-mail + application mobile.
3. **`/api/health` réel** : ping Mongo avec timeout 2 s, âge de la dernière tâche, `s3_enabled`, espace disque (`shutil.disk_usage("/")`) ; renvoyer 503 si dégradé.
4. **Digest quotidien au fondateur** (une tâche dans `jobs_loop`) : annonces `pending` depuis > 24 h, factures `a_valider`, KYC `under_review`, échecs d'envoi Brevo (compteur), erreurs des tâches. Cela remplace « surveiller le dashboard admin ».
5. **Notifications Dokploy** (Telegram/e-mail) sur échec de déploiement.
6. Alerte disque > 80 % (Hetzner Cloud a des alertes CPU/disque gratuites dans la console).

---

## 7. Ce qui exige une intervention humaine aujourd'hui (inventaire exhaustif)

Méthode : toutes les routes `/admin/*` (`grep "@api_router"`), tous les statuts (`grep '"status": "…"'`), tous les `email_admin`/`ADMIN_EMAIL`.

| # | Déclencheur | Preuve (code) | Ce que l'humain fait | Fréquence attendue | Comment l'automatiser ou le supprimer | Effort |
|---|---|---|---|---|---|---|
| 1 | **Annonce en `pending`** : mandat signé mais nom du dirigeant non confirmé avec la pièce d'identité Stripe (`identity_source != "verified_identity"`) ou absent du registre | `submit_listing` `1483-1514` → `email_admin("admin_listing_pending")` ; `PUT /companies/{id}/status` admin-only `1839` | Lit l'e-mail, ouvre l'admin, clique « Publier » ou « Rejeter » | **Élevée** : holdings, gérants de SARL avec nom composé/accents, conjoint, dirigeant personne morale, registre en retard ; sans `INPI_USERNAME`, dépend du fallback recherche-entreprises | (a) comparer aussi sur `match_partial` et nom normalisé ; (b) **publication par défaut** : le cédant a signé un mandat avec identité vérifiée et attestation de qualité ; publier immédiatement, prévenir l'admin, et dépublier *après coup* si problème ; (c) proposer systématiquement l'invitation du président (flux déjà codé, `1164-1440`) | S |
| 2 | **KYC manuel** : pièce déposée depuis le profil → `kyc_status=under_review` | `POST /auth/upload-kyc` `595-611` ; `PUT /admin/kyc/{id}/validate` `4043` ; `ProfilePage.jsx:56` | Regarde une pièce d'identité en base64 et valide | Moyenne (chemin proposé à tous) | **Supprimer** le chemin manuel : Stripe Identity seul. Moins de RGPD, zéro clic | S |
| 3 | **Closing déclaré** → facture `a_valider` + e-mail admin ; `closings.status` reste `pending_confirmation` (aucune route ne le fait évoluer) | `declare_closing` `3854-3922` ; `create_commission_invoice` `3784-3824` ; `/admin/invoices` `3826` | Valide la facture, l'envoie, **encaisse** (aucun lien de paiement), relance | Rare mais vitale (c'est le revenu) | Générer le PDF et l'envoyer automatiquement au débiteur avec un **Stripe Payment Link / virement SEPA** ; relances J+15/J+30 dans `jobs_loop` ; confirmation par l'autre partie (OTP). L'humain ne reste que pour le litige | M |
| 4 | **Retrait / vente hors plateforme** : le cédant ne peut pas retirer sa propre annonce | `update_company_status` admin-only `1839-1858` ; `CompanyUpdate` sans `status` `1861-1877` | Reçoit un e-mail « retirez mon annonce », le fait à la main | Moyenne | Route `PUT /companies/{id}/withdraw` pour le cédant (statut `archived`, motif optionnel : vendu ailleurs / plus à vendre) ; alimente les métriques de fuite | S |
| 5 | **Demande d'avocat** | `/lawyer/request` `3740-3782` → e-mail admin | Met en relation avec un avocat | Faible | Remplacer par une page « conseils partenaires » (liens) ou supprimer | S |
| 6 | **Contrats générés par l'admin** (templates, settings, generate, send) | `5276-5552` ; onglet « Contrats » de `AdminDashboard.jsx` | Rédige/envoie des contrats à la main | Nulle en théorie (NDA/LOI sont en libre-service `2547`) | **Supprimer** (code mort hérité) | S |
| 7 | **Réinitialisation de mot de passe par l'admin** | `4552-4584` | Génère et envoie un mot de passe | Nulle (libre-service existe) | **Supprimer** | S |
| 8 | **Remboursements de crédits** | `/credits/check-refunds` `3932` (admin, manuel) | Lance la vérification | Nulle (crédits désactivés) | Supprimer avec tout le module crédits | S |
| 9 | **Lancement manuel des tâches** | `/admin/jobs/run` `6199` | Clique si la boucle semble bloquée | Rare | Conserver (utile), mais rendu inutile par le heartbeat + alerte | — |
| 10 | **Migration mandats** | `/admin/migrations/mandate-backfill` `5773` | Une fois | Une fois | Exécuter puis retirer la route | S |
| 11 | **Modération des messages / data rooms** | `/admin/messages` `4708`, `/admin/dataroom/{id}` `4733` | Lit si plainte | Rare | Garder derrière un mode « litige » journalisé ; sinon ne rien faire | — |
| 12 | **Paiements/abonnements Stripe** | `/admin/stripe/*` `4602-4660` | Rien (désactivé) | Nulle | Supprimer | S |
| 13 | **Newsletter** | `/newsletter/subscribe` `4660` stocke en base | Exporter vers Brevo, rédiger | Mensuelle si utilisée | Synchroniser la liste Brevo via API ; ou supprimer le formulaire | S |
| 14 | **Support** (`contact@`) | — | Répond | Continue | Page FAQ + réponses automatiques ; inévitable | — |
| 15 | **Comptabilité** : factures `FAC-AAAA-n` dans Mongo seulement | `3794` | Ressaisit dans l'outil comptable | Par closing | Export CSV mensuel (`/admin/mandates/export.csv` existe déjà pour les mandats, `5760`) ; ajouter le même pour `invoices` | S |

Conclusion : **les lignes 1, 2, 3 et 4 sont les seules qui comptent**. Les lignes 6, 7, 8, 12 sont du code mort à retirer (≈ 900 lignes). En appliquant « publication par défaut » + suppression du KYC manuel + retrait en libre-service + facture automatique, l'intervention humaine se réduit à : litiges, support, et encaissement contesté.

---

## 8. Dette et risques du front

- **Stack** : React 19 sur `react-scripts 5.0.1` (Create React App, **non maintenu depuis 2023**) + craco 7, avec le contournement classique `@babel/plugin-proposal-private-property-in-object` en devDependency. Ça construit aujourd'hui (CI verte, Node 20) ; le risque est un jour de casse non choisie (Node 22, une dépendance Radix qui exige un bundler moderne). `craco.config.js` embarque des plugins « visual-edits » / « health-check » d'Emergent (désactivés) — à retirer.
- **Bundles** (mesurés) : `main.js` 624 Ko brut / **188 Ko gzip** ; chunk `545` (pdf.js) 315 Ko / 89 Ko gzip ; CSS 89 Ko / 16 Ko gzip ; 1,37 Mo de JS total hors source maps ; routes en `lazy()` ✔. C'est correct pour un SaaS B2B ; pas un chantier prioritaire. Les **source maps sont publiées** dans `build/static/js/*.map` (2,5 Mo pour `main`) : code source lisible par tous — `GENERATE_SOURCEMAP=false` ou les envoyer à Sentry seulement.
- **Pré-rendu maison** (`scripts/prerender.mjs`, 41 Ko) : exécute des modules de `src/` dans un bac à sable `node:vm`, génère 44 pages HTML statiques (titre, meta, JSON-LD, contenu), appelle `GET /api/public/legal-info` sur **la prod au moment du build** (`l.369-373`, timeout, fallback null). Astucieux et sans dépendance, mais : (a) tout changement de contenu de l'accueil doit être répercuté dans deux rendus (React et pré-rendu) — le partage via `src/seo/*.json` limite la dérive mais ne l'empêche pas ; (b) pas d'hydratation : React remplace le DOM au chargement (flash possible, CLS) ; (c) c'est un composant que personne d'autre que son auteur ne connaît. Alternative sobre quand la migration Vite se fera : `vite-plugin-ssg` ou `react-snap` ; **ne pas passer à Next.js** (ajoute un serveur Node à exploiter, contraire à l'objectif de coût).
- **Aucun test front**, aucun `ErrorBoundary` (une exception de rendu = page blanche sans message) ; la CI ne fait que construire avec `CI=true` (warnings = erreurs ✔).
- **Jeton en `localStorage`** (voir §5.4) ; redirection sur 401 ✔.
- **Domaine codé en dur** (§4.8).

Verdict : dette **tolérable à 6 mois**. Plan : (1) tout de suite `GENERATE_SOURCEMAP=false`, `ErrorBoundary`, retrait des plugins Emergent (S) ; (2) migration **Vite** quand un vrai chantier front s'ouvre (M, 1–2 jours : `index.html`, `import.meta.env`, alias `@`, Tailwind inchangé), en conservant `prerender.mjs` tel quel (il ne dépend pas de CRA).

---

## 9. Tests et CI : couverture réelle des parcours critiques

**Exécuté** : `47 passed in 37.26s` (mongomock en mémoire, e-mails interceptés, `_match_dirigeant` simulé, `JOBS_ENABLED=false`).

| Parcours | Couvert ? | Fichier |
|---|---|---|
| Inscription, connexion insensible à la casse, mot de passe court, rôle admin interdit | ✔ | `test_security.py` |
| Anonymat avant NDA, annonce non publiée invisible, routes de contrefaçon retirées | ✔ | `test_security.py` |
| Mandat obligatoire, OTP e-mail, débiteur, barème par tranches, registre | ✔ | `test_signature_mandat_obligatoire.py`, `test_mandat_debiteur.py` |
| Contact → messages → demande d'accès → NDA → data room (403 avant LOI) → LOI → vue filigranée (texte vérifié dans le PDF) → offre → PDF | ✔ | `test_parcours.py` (un seul test, dense) |
| Confidentialité des coordonnées, masquage dans les messages | ✔ | `test_confidentialite_commission.py` |
| S3 (moto) aller-retour, repli Mongo, filigrane image | ✔ | `test_stockage.py` |
| Limites d'upload (type) | ✔ partiel (type déclaré seulement) | `test_security.py` |
| **Stripe Identity** : création de session, webhook *signé* valide, chemin d'erreur (là où vit le bug `stripe.error`) | ✘ | — |
| **Webhook paiements**, crédits | ✘ | — |
| **Tâches planifiées** (relances J+3, suivi J+30, idempotence `claim_once`) | ✘ | — |
| **Réinitialisation de mot de passe** (jeton, expiration, usage unique) | ✘ | — |
| **Invitation du président** | ✘ | — |
| **Closing, facture de commission, PDF de facture** | ✘ | — |
| Transitions admin autres que « publier » (rejeter, vendu, archivé) | ✘ | — |
| Sitemap, pages SEO, `/config` | ✘ | — |
| Front (unitaire ou e2e) | ✘ (0 fichier `*.test.*`) | — |

Observations :
- `mongomock` n'est pas MongoDB : `$regex` avec options, `find_one_and_update`, index uniques, TTL se comportent différemment. Un job CI hebdomadaire avec un service `mongo:7` réel (3 lignes de YAML) rattraperait ça.
- CI (`.github/workflows/tests.yml`) : tests + build à chaque push ✔, mais **aucun lien avec le déploiement** : Dokploy déploie sur push `main` indépendamment du résultat. Préférer : GitHub Action construit les images → `ghcr.io` → webhook Dokploy *après* succès des tests.
- `.gitignore` ignore `test_*.py` globalement puis ré-inclut `backend/tests/test_*.py` : fragile, un nouveau fichier de test ailleurs serait silencieusement ignoré.
- Le hack `pip install "setuptools<70" --no-build-isolation sib-api-v3-sdk` dans la CI signale un SDK en fin de vie (Brevo l'a remplacé par `brevo-python`). Remplacer par un appel `requests.post("https://api.brevo.com/v3/smtp/email", …)` de 15 lignes : une dépendance de moins, un hack de moins.

Priorité tests (M, 1 jour) : (1) Stripe Identity avec `monkeypatch` de `stripe.identity.VerificationSession.create` (succès + `stripe.StripeError`) et webhook signé via `stripe.WebhookSignature`; (2) `run_scheduled_jobs` avec horloge injectée ; (3) reset de mot de passe ; (4) closing + facture.

---

## 10. Classement par gravité et coût de correction

Effort : **S** < ½ jour · **M** 1–3 jours · **L** > 3 jours.

| Gravité | Constat | Effort |
|---|---|---|
| **Critique** | Secrets de prod (Stripe live, Brevo, Mongo) dans l'historique Git | S (révoquer) |
| **Critique** | `stripe.error` inexistant → 500 sur KYC/paiements/webhook | S |
| **Critique** | Aucune sauvegarde MongoDB | S |
| **Majeur** | Aucune limite de débit ; bcrypt bloquant la boucle | S–M |
| **Majeur** | Pas d'alerte, pas de Sentry, health factice | S |
| **Majeur** | Fichiers en base64 dans Mongo si S3 absent (disque plein à ~300 annonces) | S (config) |
| **Majeur** | Interventions humaines structurelles (pending, KYC manuel, facture, retrait) | S–M |
| **Majeur** | RGPD : durées « à préciser », pas de suppression/export, pièces d'identité conservées | S–M |
| **Majeur** | Admin : reset-password en clair, `/docs` public, lecture des messages, pas de 2FA | S |
| **Majeur** | CORS `*` + credentials par défaut ; aucun en-tête de sécurité ; JWT 7 j non révocable | S |
| **Majeur** | Code OTP dans l'objet de l'e-mail ; SPF/DKIM à vérifier ; e-mails admin vers une adresse par défaut | S |
| **Majeur** | Webhook paiements accepté sans signature (dormant) | S |
| **Majeur** | Upload : type déclaré par le client, pas de vérification d'octets | S |
| **Mineur** | Doc de déploiement incohérente (`/api` non proxifié, port 8001 publié, healthcheck `curl` absent) | S |
| **Mineur** | Domaine codé en dur dans 7 fichiers | S |
| **Mineur** | `server.py` 6 243 lignes + ~900 lignes mortes ; dépendances inutiles ; SDK Brevo déprécié | M |
| **Mineur** | CRA non maintenu ; source maps publiées ; pas d'ErrorBoundary ; 0 test front | S puis M |
| **Mineur** | Couverture tests : Stripe, jobs, reset, closing absents ; CI non reliée au déploiement | M |
| **Mineur** | APIs externes sans cache ; `/companies` sans pagination (`to_list(1000)`) | S |

---

## 11. Architecture cible minimale et plan

### 11.1 Cible (≈ 10–15 €/mois fixes)

```
GitHub (privé)  ──push main──▶ GitHub Actions : pytest (mongomock + hebdo mongo:7) + build front
                               ──succès──▶ images backend/frontend sur ghcr.io
                               ──webhook──▶ Dokploy (ou `docker compose pull && up -d` via SSH)

VPS Hetzner CX23 (2 vCPU / 4 Go, ~6 € HT) — CX33 (8 Go, ~12 €) seulement si le build reste sur le VPS
 ├─ Traefik (Dokploy) : TLS Let's Encrypt, règle `cessionrge.fr` + `/api` → backend, rate-limit sur /api/auth
 ├─ frontend nginx (statique pré-rendu) + en-têtes de sécurité
 ├─ backend uvicorn 1 processus, slowapi, bcrypt hors boucle, tâches internes + heartbeat
 ├─ mongo:7 (volume) — `mongodump` nocturne → S3, rétention 30 j, restauration testée
 └─ (rien d'autre : pas de Redis, pas de worker, pas de Node serveur)

Scaleway Object Storage fr-par (75 Go offerts) : data room, photos, sauvegardes
Brevo gratuit (→ Starter 9 € quand les alertes dépassent 300/jour) — domaine cessionrge.fr authentifié
Stripe Identity : cédant au mandat, repreneur au NDA
Sentry gratuit (back + front) · UptimeRobot gratuit (health réel + accueil) · alertes Hetzner disque/CPU
```

### 11.2 Plan en trois lots

**Lot 0 — aujourd'hui (2 h)** : révoquer/régénérer Stripe, Brevo, Mongo ; activer secret scanning GitHub ; corriger les 6 `stripe.error` ; retirer le code OTP de l'objet ; `docs_url=None` ; activer la sauvegarde Dokploy → S3.

**Lot 1 — cette semaine (2–3 jours)** : S3 obligatoire ; slowapi + bcrypt en thread ; CORS sans défaut `*` ; en-têtes nginx ; health réel (Mongo + heartbeat des tâches + disque) ; Sentry + UptimeRobot ; `ADMIN_NOTIFICATION_EMAIL` partout ; digest quotidien admin ; index TTL ; suppression du KYC manuel, du reset-password admin, des routes crédits/abonnements/contrats admin, de `/admin/stripe/*` ; retrait d'annonce par le cédant ; publication par défaut avec contrôle a posteriori ; doc de déploiement corrigée (règle Traefik `/api`, pas de port 8001 publié) ; `GENERATE_SOURCEMAP=false` + `ErrorBoundary`.

**Lot 2 — ce mois (3–5 jours)** : vérification d'identité repreneur déplacée au NDA ; facture de commission automatique + lien de paiement + relances ; `DELETE /auth/me` et export ; durées de conservation réelles dans la politique ; découpage de `server.py` en routeurs et suppression du code mort ; remplacement de `sib-api-v3-sdk` par `requests` ; tests Stripe/jobs/reset/closing ; CI → ghcr.io → déploiement conditionné ; cache RGE 24 h ; un seul `SITE_URL`.

Ce qu'il **ne faut pas** faire : Kubernetes, un second VPS, Mongo Atlas payant, ClamAV, Next.js, un bus de messages, une réécriture. Rien de tout cela n'est justifié avant plusieurs milliers d'annonces.

---

## 12. Ce qui est bien fait (à préserver)

- Anonymat et confidentialité appliqués **côté serveur** et testés : `CONFIDENTIAL_COMPANY_FIELDS`, `sanitize_company`, `scrub_contacts`, masquage des coordonnées avant NDA avec journal des tentatives.
- Chaîne de preuve de signature sérieuse pour du « fait maison » : OTP haché, usage unique atomique, hash SHA-256 du document signé, IP/UA, identité Stripe rattachée (`verify_signature_code`, `2771-2802`).
- Filigrane **incrusté** (PDF et images) plutôt qu'un calque CSS, avec test qui vérifie le texte dans le PDF.
- Tâches de relance idempotentes (`claim_once` + index unique) : on peut les relancer sans doublons.
- Abstraction de stockage propre (`storage.py`) avec chiffrement côté serveur et test `moto`.
- E-mails : envoi en tâche de fond qui n'échoue jamais la requête, échappement HTML systématique, anti-spam de notification (un e-mail par conversation non lue).
- Réinitialisation de mot de passe et webhook Identity conformes aux bonnes pratiques.
- 47 tests de bout en bout rapides (37 s), sans services externes, exécutés en CI avec le build front (warnings bloquants).
- Pré-rendu SEO sans dépendance lourde, en-têtes de cache corrects (`immutable` sur `/static/`, `no-cache` sur l'HTML), routes chargées paresseusement.
- Migration `mandate_backfill` idempotente, `--dry-run` par défaut, réversible : le bon réflexe.
- Feature flags pour les modes métier ; aucun secret en dur dans `HEAD` ; `.env.example` complets ; `.dockerignore` présents.

---

## Annexe A — Commandes et mesures

```
pytest -q                                   → 47 passed, 6 warnings in 37.26s
curl -H "Origin: https://evil.example" /api/health
   → access-control-allow-origin: * ; access-control-allow-credentials: true
25 × POST /api/auth/login (mauvais mot de passe) → 25 × 401 en 7,91 s (~316 ms/essai), aucun verrouillage
3 × POST /api/auth/forgot-password → 200 200 200 (3 e-mails)
POST /api/kyc/create-verification-session (jeton vendeur) → HTTP 500 "Internal Server Error"
GET /openapi.json → 112 chemins ; GET /docs → 200
python -c "import stripe; print(stripe.VERSION, hasattr(stripe,'error'))" → 13.0.1 False
git log --all -S "sk_live_51Sct29" → 608c5f4 (2026-03-02), edaaf38 (2026-09-24, retrait)
gzip : main.js 188 295 o ; chunk 545 88 766 o ; css 16 336 o ; JS total 1 365 208 o (hors .map)
find build -name index.html | wc -l → 44 pages pré-rendues
wc -l backend/server.py → 6243 ; routes : 112 ; gabarits e-mail : 36
```

## Annexe B — Routes admin et statuts (référence)

Routes `/admin/*` : `invoices`, `stats`, `users`, `kyc/{id}/validate`, `metrics`, `companies`, `users/{id}/reset-password`, `documents`, `stripe/payments`, `stripe/subscriptions`, `messages`, `dataroom/{id}`, `transactions`, `contracts/templates` (GET/PUT), `contracts/settings` (GET/PUT), `contracts/generate`, `contracts/generated`, `contracts/{id}`, `contracts/{id}/send`, `mandates`, `mandates/export.csv`, `migrations/mandate-backfill`, `jobs/run` ; plus `PUT /companies/{id}/status` et `GET /credits/check-refunds` (admin-only).

Statuts d'annonce : `draft` → `mandat_en_attente` → `pending` → `published` → `sold` | `rejected` | `archived`. KYC : `pending` | `under_review` | `verified` | `rejected`. Facture : `a_valider`. Closing : `pending_confirmation` (jamais `confirmed`/`invoiced` : aucune route ne le fait).

## Annexe C — Sources de prix (à confirmer)

- Stripe Identity : page officielle inaccessible depuis cet environnement ; sources tierces concordantes à **1,50 $ par vérification aboutie**, 1,50–2,00 € en Europe, `requires_input` non facturé (capterra.com, apidog.com, apiscout.dev, didit.me).
- Brevo : gratuit **300 e-mails/jour** avec logo Brevo ; Starter **≈ 9 $/mois pour 5 000** e-mails, ≈ 17–20 $ pour 20 000 (omnisend.com, moosend.com, sendx.io).
- Hetzner (instantané août 2026, HT, après hausse de juin 2026) : **CX23** 2 vCPU/4 Go/40 Go NVMe 5,49 € + 0,50 € IPv4 ≈ 6 € ; **CAX11** (ARM) ≈ 6,49 € ; CX33 (8 Go) ≈ 11–13 € (kimmo.suominen.com, bitdoze.com, docs.hetzner.cloud).
- Scaleway Object Storage : 75 Go offerts puis ≈ 0,012 €/Go/mois (tarif public 2026, à vérifier).
