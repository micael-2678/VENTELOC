# VenteLoc — Déploiement avec Dokploy

Ce guide décrit un déploiement complet sur un VPS avec Dokploy (open source, auto-hébergé). Aucune valeur réelle
n'y figure : chaque secret est généré au moment du déploiement et saisi dans Dokploy, jamais dans le dépôt.

| Élément | Valeur |
|---|---|
| Marque | `SITE_NAME` (défaut `VenteLoc`) |
| Domaine public | `SITE_URL` (défaut `https://venteloc.fr`) |
| Stack | React 19 (nginx) + FastAPI (uvicorn) + MongoDB 7 + service de sauvegarde |

## 1. Architecture

Un seul mode de déploiement : **un service « Compose » de Dokploy** construit à partir de `docker-compose.yml`
(mêmes fichiers qu'en local, mêmes noms de services, donc mêmes commandes de sauvegarde et de restauration).

```
Internet ──TLS (Let's Encrypt, Traefik de Dokploy, ports 80/443 de l'hôte)──▶ frontend (nginx, port 80 non publié)
                                                        ├── fichiers statiques pré-rendus
                                                        └── /api/ ──proxy──▶ backend:8001 (réseau Docker interne, jamais publié)
                                                                                 │
                                                                                 ▼
                                                                         mongodb:27017 (volume mongo_data)
                                                                                 ▲
                                                             backup (mongo:7, mongodump quotidien → volume backups)
                                                             backend : job quotidien → copie de la dernière archive vers S3 si S3_BUCKET
```

Règles :

- **Aucun port publié sur l'hôte.** Les ports 80/443 appartiennent au Traefik de Dokploy, qui route le domaine vers le
  service `frontend` (port 80). Quand le domaine est déclaré (étape 3), Dokploy ajoute lui-même au service `frontend`
  le réseau `dokploy-network` et les labels Traefik. Le backend n'a qu'un `expose: 8001` ; nginx proxifie `/api/` vers
  l'alias réseau `venteloc-api` (unique, pour ne jamais atteindre le service « backend » d'un autre projet).
- **API sur la même origine** : le frontend est construit avec `REACT_APP_BACKEND_URL` vide (appels `/api` relatifs),
  ce qui fonctionne sur le domaine principal comme sur un alias. `www.<domaine>` est redirigé en 301 vers `<domaine>`
  par nginx.
- **Adresse IP des visiteurs** : nginx ne croit `X-Forwarded-For` que s'il vient d'un proxy des réseaux privés
  (Traefik) et ne transmet au backend qu'une seule adresse (limitation de débit, preuves de signature).
- `ENV=production` désactive `/docs`, `/redoc` et `/openapi.json`. `CORS_ORIGINS` est explicite (jamais `*`) ; vide =
  `SITE_URL`.
- `/api/health` renvoie `{status, db, jobs_age_seconds, disk_free_mb, version}` et **503 si MongoDB est injoignable** :
  c'est l'URL à surveiller (UptimeRobot gratuit, mot-clé `"db":"ok"`).
- Journaux Docker limités à 5 × 10 Mo par conteneur (`x-logging` dans `docker-compose.yml`) : le disque ne se remplit pas.
- Lancement local ou serveur sans Dokploy : `docker compose -f docker-compose.yml -f ops/docker-compose.local.yml up -d`
  (nginx publié sur `http://localhost:8080`, port réglable avec `HTTP_PORT`).

## 2. Préparer les secrets et le domaine d'envoi (sur votre poste)

```bash
openssl rand -hex 32   # JWT_SECRET
openssl rand -hex 24   # MONGO_PASSWORD
openssl rand -base64 18 # ADMIN_PASSWORD (changez-le ensuite depuis l'espace admin)
```

Clés tierces : Stripe (clé secrète **live** + secret du webhook Identity), Brevo (clé API), S3 compatible (Scaleway
`fr-par` recommandé : 75 Go offerts).

### Domaine d'envoi Brevo (obligatoire avant la mise en ligne)

Sans domaine authentifié, Brevo refuse ou classe en spam les e-mails, **y compris le code de connexion admin et les
codes de signature**. `SENDER_EMAIL` doit être une adresse de ce domaine (ex. `contact@<votre-domaine>`) : vide, les
envois partent de `contact@venteloc.fr`.

1. Brevo → *Senders, Domains & Dedicated IPs* → *Domains* → *Add a domain* : `<votre-domaine>`.
2. Chez le registraire (zone DNS), créez les enregistrements affichés par Brevo :
   - code de vérification : TXT sur `<votre-domaine>`, valeur `brevo-code:…` (fournie par Brevo) ;
   - DKIM : les deux CNAME `brevo1._domainkey` et `brevo2._domainkey` (cibles fournies par Brevo) ;
   - SPF : un seul TXT `v=spf1 …` sur `<votre-domaine>`, auquel on ajoute `include:spf.brevo.com`
     (ex. `v=spf1 include:spf.brevo.com ~all`, ou l'enregistrement existant complété) ;
   - DMARC : TXT sur `_dmarc.<votre-domaine>`, `v=DMARC1; p=none; rua=mailto:<votre adresse>` (passer à
     `p=quarantine` après quelques semaines de rapports propres).
3. Brevo → *Authenticate* : les quatre lignes doivent être vertes. Envoyez-vous un e-mail de test (mot de passe oublié).

Quota du plan gratuit Brevo : **300 e-mails par jour**, tous types confondus. Les tâches quotidiennes (relances) et le
digest hebdomadaire des alertes partent dans l'heure qui suit minuit UTC : surveillez *Brevo → Statistics* les
premières semaines ; un échec d'envoi n'apparaît aujourd'hui que dans les journaux du backend
(`Envoi email Brevo échoué`).

## 3. Déployer (service Compose de Dokploy)

### Étape 1 — Projet et service

Dokploy → **Projects → New Project** → `venteloc`, puis **Create Service → Compose** :

- Provider GitHub, dépôt `VENTELOC`, branche `main`, **Compose Path** `./docker-compose.yml`, type Docker Compose.
- Notez le nom technique du service (*App Name*, ex. `venteloc-xyz123`) : c'est le nom du projet Compose,
  utilisé par les commandes des §5, §6 et §8 (`COMPOSE="docker compose -p <App Name>"`). Le code est cloné sur l'hôte
  dans `/etc/dokploy/compose/<App Name>/code`.

### Étape 2 — Variables (onglet Environment)

Collez le contenu de `.env.example` et remplissez les valeurs (Dokploy l'écrit dans le fichier `.env` à côté du
`docker-compose.yml`). Une valeur avec des espaces s'écrit entre guillemets doubles. Au minimum :

```bash
ENV=production
MONGO_PASSWORD=<openssl rand -hex 24>
DB_NAME=venteloc_prod
JWT_SECRET=<openssl rand -hex 32>
STRIPE_SECRET_KEY=<clé live Stripe>
STRIPE_IDENTITY_WEBHOOK_SECRET=<secret du webhook Identity>
BREVO_API_KEY=<clé Brevo>
SENTRY_DSN=                       # optionnel
SITE_NAME=VenteLoc
SITE_URL=https://<votre-domaine>
CORS_ORIGINS=https://<votre-domaine>
SENDER_EMAIL=contact@<votre-domaine>   # obligatoire : domaine authentifié dans Brevo (§2)
SENDER_NAME=VenteLoc
ADMIN_EMAIL=<votre adresse>
ADMIN_PASSWORD=<mot de passe fort>
ADMIN_NOTIFICATION_EMAIL=<votre adresse>
COMMISSION_RATE_PERCENT=3         # honoraires HT du prix de vente, à la charge du vendeur (mandat ET calculateur du site)
COMMISSION_MIN_HT=3000            # minimum HT (repris par le mandat et par le calculateur, argument de build)
LEGAL_CARTE_T="CPI 7801 2025 000 000 049"
LEGAL_REPRESENTANT=              # vide = valeur par défaut du backend (directrice de la publication)
LEGAL_HEBERGEUR="<nom, adresse et téléphone de l'hébergeur>"
LEGAL_RC_PRO="<assureur et n° de police>"
LEGAL_MEDIATEUR="<médiateur de la consommation, si désigné>"
LEGAL_EMAIL=contact@<votre-domaine>   # adresse affichée dans les mentions légales
LEGAL_TVA=                        # optionnel, calculé depuis le SIREN sinon
LEGAL_PHONE=                      # optionnel : téléphone affiché dans les mentions légales
EMAIL_DAILY_SOFT_LIMIT=250        # au-delà (par jour UTC), seuls les e-mails transactionnels partent
EVENTS_SALT_SECRET=               # optionnel (statistiques maison), défaut JWT_SECRET
INVOICE_IBAN=<IBAN>
INVOICE_BIC=<BIC>
INVOICE_BANK=<banque>
S3_BUCKET=<bucket>
S3_ENDPOINT_URL=https://s3.fr-par.scw.cloud
S3_REGION=fr-par
S3_SSE=true                       # false si le fournisseur refuse le chiffrement SSE-S3
AWS_ACCESS_KEY_ID=                # clé d'accès S3 (si S3_BUCKET est défini)
AWS_SECRET_ACCESS_KEY=            # secret S3 associé (si S3_BUCKET est défini)
JOBS_ENABLED=true
TEST_MODE=false                   # true seulement pour un essai avant l'ouverture (§9)
BACKUP_RETENTION_DAYS=14          # nombre d'archives conservées (une par jour)
BACKUP_HOUR=23                    # heure UTC de la sauvegarde
```

Identité de la société (dénomination, forme, capital, siège, RCS, SIREN, validité et CCI de la carte T) : valeurs par
défaut dans le backend, à surcharger seulement en cas de changement avec `LEGAL_DENOMINATION`,
`LEGAL_FORME_JURIDIQUE`, `LEGAL_CAPITAL`, `LEGAL_ADRESSE`, `LEGAL_RCS_VILLE`, `LEGAL_SIREN`,
`LEGAL_CARTE_T_VALIDITE`, `LEGAL_CARTE_T_CCI` (voir `.env.example` ; une variable définie mais vide efface la mention).

Le build du frontend reçoit ses arguments du `docker-compose.yml` (rien à saisir) : `REACT_APP_SITE_URL` = `SITE_URL`,
`REACT_APP_BRAND_NAME` = `SITE_NAME`, `REACT_APP_CONTACT_EMAIL` = `SENDER_EMAIL`,
`REACT_APP_COMMISSION_RATE_PERCENT` = `COMMISSION_RATE_PERCENT`, `REACT_APP_COMMISSION_MIN_HT` = `COMMISSION_MIN_HT`, `REACT_APP_MARKETING_URL` = `MARKETING_URL` (facultatif : lien
« Site » du pied de page vers le site WordPress), et `REACT_APP_BACKEND_URL` **vide** (API sur la même origine). Après
un changement de l'une de ces variables, redéployez pour reconstruire le frontend.

**Site WordPress** (facultatif : site vitrine hors de l'application, voir `docs/WORDPRESS.md`) : `EMBED_ALLOWED_ORIGINS`
liste les origines autorisées à afficher le module `/embed/annonces` dans une iframe (ex.
`https://www.venteloc.fr https://venteloc.fr`). C'est une variable d'exécution du conteneur frontend
(substituée dans la configuration nginx au démarrage) : un simple redémarrage suffit, sans reconstruire l'image. Si le
site WordPress prend le domaine principal, l'application passe sur un sous-domaine (`SITE_URL`, domaine Dokploy) ; la
règle `www.<domaine> → <domaine>` de nginx ne concerne que les hôtes routés vers le conteneur frontend.

### Étape 3 — Domaine (onglet Domains)

**Add Domain** : host `<votre-domaine>`, path `/`, **service `frontend`**, container port `80`, HTTPS activé,
certificat Let's Encrypt. Ajoutez de même `www.<votre-domaine>` (même service, même port) : nginx le redirige en 301
vers `<votre-domaine>`. DNS : enregistrements A (et AAAA) de `<votre-domaine>` et `www` vers l'IP du VPS. Aucune règle
`/api` côté Traefik : nginx s'en charge. Ne publiez aucun port dans le fichier Compose.

### Étape 4 — Déployer

**Deploy**. Dokploy construit les images `backend` et `frontend` et démarre les quatre services : `mongodb`, `backend`,
`backup` (mongodump quotidien à `BACKUP_HOUR` UTC dans le volume `backups`, 14 archives conservées, nouvelle tentative
une heure plus tard en cas d'échec) et `frontend`. Si `S3_BUCKET` est défini, la dernière archive est copiée chaque jour
dans `s3://<bucket>/backups/` (chiffrement AES256 côté serveur) dans l'heure qui suit minuit UTC.

Premier déploiement : suivez ensuite le §8 (mise en service).

### Étape 5 — Webhook Stripe Identity

Dashboard Stripe → Developers → Webhooks → endpoint `https://<votre-domaine>/api/kyc/webhook`, événements
`identity.verification_session.verified` et `identity.verification_session.requires_input`. Copiez le secret de
signature dans `STRIPE_IDENTITY_WEBHOOK_SECRET` puis redéployez. Sans ce secret, le webhook répond 503 et aucune
identité n'est validée.

## 4. Vérifications après déploiement

```bash
curl -s https://<votre-domaine>/api/health      # {"status":"ok","db":"ok",...}
curl -s https://<votre-domaine>/api/config      # commission : 3 % HT (3,6 % TTC), minimum 3 000 € HT, à la charge du vendeur
curl -sI https://<votre-domaine>/ | grep -i -E "strict-transport|content-security|x-frame"
curl -s -o /dev/null -w "%{http_code}\n" https://<votre-domaine>/docs     # 404 en production
curl -s https://<votre-domaine>/robots.txt | grep -i sitemap   # doit pointer vers https://<votre-domaine>/api/sitemap.xml
```

Puis : inscription (e-mail de confirmation reçu), connexion admin (code reçu par e-mail), création d'annonce, dépôt du
justificatif de propriété, signature du mandat par code, contact acquéreur ; même parcours sur `https://www.<votre-domaine>` (redirigé). Ajoutez un moniteur
UptimeRobot sur `/api/health` (mot-clé `"db":"ok"`). La réponse contient aussi `backup_age_hours` (âge de la dernière
sauvegarde réussie) ; au-delà de 30 h, une ligne « Sauvegarde : aucune réussite depuis N h » apparaît dans l'écran
« À faire » de l'administration, comme les e-mails non envoyés.

Sauvegardes : le lendemain du déploiement, `ops/restore.sh --list` (§5) doit afficher une archive récente et
« dernière sauvegarde réussie : <date> ». Un fichier `last_failure` affiché signale un échec (mot de passe MongoDB changé
sans redéploiement, disque plein…) : les anciennes archives sont alors conservées, rien n'est effacé.

## 5. Restauration d'une sauvegarde (procédure testée)

Les archives sont dans le volume `backups` (et sur S3 si configuré). Sur l'hôte, dans le dossier du code déployé :

```bash
cd /etc/dokploy/compose/<App Name>/code
export COMPOSE="docker compose -p <App Name>"                 # inutile en local (docker compose à la racine du dépôt)
ops/restore.sh --list                                        # archives, dernière réussite, dernier échec
ops/restore.sh --test venteloc_prod-2026-10-10T23-00.archive.gz
#   → restaure dans la base venteloc_prod_restore_test, affiche le nombre de documents par collection,
#     imprime « RESTAURATION DE TEST OK » puis supprime la base de test. La production n'est pas touchée.
ops/restore.sh venteloc_prod-2026-10-10T23-00.archive.gz --drop   # restauration réelle (confirmation demandée)
$COMPOSE restart backend
ops/restore.sh --from-s3 backups/venteloc_prod-2026-10-10T23-00.archive.gz   # si l'archive n'est plus que sur S3
```

`restore.sh` lit `MONGO_PASSWORD` et `DB_NAME` dans l'environnement ou dans le `.env` du dossier (sans l'exécuter).
`--from-s3` télécharge l'archive dans le conteneur backend (qui a les clés S3) puis la copie dans le volume `backups`.
Faites le test de restauration (`--test`) **une fois après le premier déploiement**, puis à chaque changement de
version de MongoDB et au moins une fois par trimestre. `RESTORE_DRY_RUN=1` affiche les commandes sans les exécuter.

## 6. Rotation des secrets

À faire immédiatement si un secret a pu fuir (historique Git, poste compromis, collaborateur parti) et par précaution
une fois par an. Le CI exécute `gitleaks` sur tout l'historique ; d'éventuels faux positifs sont listés dans
`.gitleaksignore`. Toutes les variables sont dans l'onglet Environment du service Compose ; chaque modification se
termine par **Deploy**.

| Secret | Où le régénérer | Où le mettre à jour | Effet |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | Dashboard Stripe → Developers → API keys → *Roll key* | Environment, redéploiement | Les sessions Identity en cours restent valides |
| `STRIPE_IDENTITY_WEBHOOK_SECRET` | Dashboard Stripe → Webhooks → endpoint → *Roll secret* | Environment | Webhooks signés avec le nouveau secret après le délai choisi |
| `BREVO_API_KEY` | Brevo → SMTP & API → supprimer l'ancienne clé, en créer une | Environment | Envois immédiatement sur la nouvelle clé |
| `MONGO_PASSWORD` | `$COMPOSE exec mongodb mongosh -u admin -p --eval 'db.getSiblingDB("admin").changeUserPassword("admin", "<nouveau>")'` | `MONGO_PASSWORD` dans Environment, puis Deploy (backend **et** backup reprennent la valeur) | Tant que le service backup n'est pas redéployé, ses sauvegardes échouent (`last_failure`) sans effacer les anciennes |
| `JWT_SECRET` | `openssl rand -hex 32` | Environment | **Toutes les sessions sont déconnectées** (jetons de 24 h) |
| `ADMIN_PASSWORD` | Depuis l'espace admin (Mon compte → mot de passe) | `ADMIN_PASSWORD` sert seulement à la création initiale | Les anciens jetons admin sont révoqués |
| Clés S3 | Console du fournisseur (Scaleway IAM) | `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Redéployer |

Après chaque rotation : `curl /api/health`, un envoi d'e-mail de test (mot de passe oublié) et une sauvegarde manuelle
(`$COMPOSE exec backup env BACKUP_ONCE=1 bash /backup.sh`, qui doit se terminer par « terminé »).

Activez aussi sur GitHub : *Settings → Code security → Secret scanning + Push protection*.

## 7. Dépannage

- **Le backend ne démarre pas** : `MONGO_PASSWORD` incorrect ou `JWT_SECRET` absent (un secret aléatoire est alors
  généré et les sessions tombent à chaque redémarrage — toujours définir `JWT_SECRET`).
- **`/api` renvoie une erreur 502** : le backend n'est pas joignable sous l'alias `venteloc-api` depuis nginx.
  Testez depuis le conteneur frontend : `$COMPOSE exec frontend wget -qO- http://venteloc-api:8001/api/health`.
- **« port is already allocated » au déploiement** : un `ports:` a été ajouté au fichier Compose ; seul Traefik publie
  les ports 80/443 (utilisez `ops/docker-compose.local.yml` hors Dokploy uniquement).
- **Le site répond 404 Traefik** : domaine non déclaré sur le service `frontend` port 80 (onglet Domains), ou DNS pas
  encore propagé.
- **Erreur CORS** : `CORS_ORIGINS` doit contenir exactement l'origine du site (`https://<votre-domaine>`, sans slash final).
- **`/api/health` en 503** : MongoDB injoignable → vérifiez le service `mongodb` et `MONGO_PASSWORD`.
- **`jobs_age_seconds` > 7200** : la boucle des tâches est arrêtée → redémarrez le backend, puis consultez les journaux
  (`job_failures` en base liste les tâches en erreur).
- **Pas de code de connexion admin** : `BREVO_API_KEY`, `SENDER_EMAIL` ou domaine d'envoi non authentifié (§2), ou
  quota quotidien de 300 e-mails atteint ; vérifiez les journaux (`Envoi email Brevo échoué`).
- **Disque presque plein** (`disk_free_mb` dans `/api/health`) : `docker system prune` (images des anciens
  déploiements). Les journaux des conteneurs du Compose sont déjà limités ; pour les autres conteneurs de l'hôte,
  `/etc/docker/daemon.json` : `{"log-driver": "json-file", "log-opts": {"max-size": "10m", "max-file": "5"}}` puis
  `systemctl restart docker` (s'applique aux conteneurs recréés).

## 8. Mise en service (premier déploiement)

1. Vérifications du §4, puis connexion avec `ADMIN_EMAIL` / `ADMIN_PASSWORD` (code reçu par e-mail) et changement du
   mot de passe administrateur depuis l'espace admin.
2. Facultatif : essai complet en mode test (§9), puis purge des données de test et `TEST_MODE=false`.
3. Première sauvegarde manuelle et test de restauration : `$COMPOSE exec backup env BACKUP_ONCE=1 bash /backup.sh`
   (doit afficher « terminé »), puis `ops/restore.sh --test <archive>` (doit afficher « RESTAURATION DE TEST OK »).
4. Webhook Stripe Identity (§3, étape 5) et moniteur UptimeRobot sur `/api/health`.

Aucune migration de données n'est nécessaire : VenteLoc démarre sur une base vide (`DB_NAME=venteloc_prod`), distincte
de celle de CessionRGE.

## 9. Mode test (essai de l'application avant l'ouverture)

Le mode test permet d'essayer tous les parcours (vendeur, acquéreur, admin) **sans vérifier réellement son identité**,
**sans dépendre de l'envoi d'e-mails** et **sans engager de vrais contrats**. Il est permis en production pour un essai
avant l'ouverture, mais il **affaiblit l'authentification administrateur** : à désactiver avant d'accueillir de vrais
utilisateurs.

### Activer

Dans Environment : `TEST_MODE=true` et `TEST_PANEL_KEY=<clé longue et aléatoire>` (par exemple `openssl rand -hex 16`) ;
facultatif : `TEST_DEMO_PASSWORD=<mot de passe des comptes démo>`, défaut `Demo-2026!` ; `TEST_MODE_SEND_EMAILS=true`
pour recevoir aussi les e-mails par Brevo. Puis **Deploy**. Les journaux du backend affichent « MODE TEST ACTIF » (et un
avertissement renforcé si `ENV=production`) ; `GET /api/config` renvoie `"test_mode": true` et le site affiche un bandeau
ambre « Mode test : annonces fictives ».

**Ouvrez l'application avec `https://<domaine>/test?cle=<TEST_PANEL_KEY>`** : la clé est mémorisée par le navigateur, le
bandeau affiche alors le lien « Panneau de test ». Sans la clé, un visiteur (venu du site WordPress par exemple) ne voit
ni le panneau, ni la connexion rapide, ni l'admin démo : ils sont refusés par le backend (403). Sans `TEST_PANEL_KEY`, le
panneau est ouvert à tous les visiteurs ; en production, l'admin démo est alors fermé (son mot de passe est affiché dans
le panneau) et seul votre vrai compte administrateur donne accès à l'administration.

Ce qui change :
- chaque e-mail est **capturé** dans la boîte de test (panneau `/test`) et n'est envoyé par Brevo que si
  `TEST_MODE_SEND_EMAILS=true` (jamais vers les adresses de démonstration `@test.local`) ;
- les codes de signature et le code de connexion admin sont aussi renvoyés à l'écran ; « Simuler ma vérification
  d'identité » et « Confirmer mon e-mail » remplacent Stripe Identity et le lien reçu par e-mail ;
- contrôles de publication assouplis : un SIRET fictif de 14 chiffres est accepté pour une SCI, société cessée et doublon
  deviennent des drapeaux (e-mail confirmé, identité, mandat, justificatif de propriété, bail, loyer et prix restent
  obligatoires) ;
- **aucun vrai engagement** : tout ce qui est créé est marqué `is_test` ; les mandats prennent un numéro du registre de
  test (`TEST-0001`…, le registre réel n'avance pas), les factures `TEST-FAC-AAAA-NNNNN`, et chaque document (mandat,
  engagement de confidentialité, offre d'achat, facture, ordre de paiement, mise en demeure, PDF) porte « DOCUMENT DE TEST — SANS VALEUR JURIDIQUE » ;
  le registre admin et son export CSV excluent les mandats de test (`?include_test=true` pour les voir) ;
- l'écran admin « À faire » affiche une ligne « Mode test actif ».

Une identité ou une adresse e-mail simulée ne vaut **que** pendant le mode test : une fois `TEST_MODE=false`, la vraie
vérification est redemandée au compte concerné (le lien de confirmation reçu par e-mail reste valable). Les sessions des
comptes de démonstration et des comptes créés pendant l'essai se ferment aussi : il faut se reconnecter. Une annonce
réelle dont le mandat a été signé pendant l'essai (mandat de test) est masquée au public jusqu'à la signature d'un vrai
mandat ; une annonce réelle garde tous ses contrôles de publication pendant l'essai.

### Tester

1. Panneau `/test` → « Créer les comptes et annonces de démonstration » : trois comptes (`vendeur.demo@test.local`,
   `acquereur.demo@test.local`, `admin.demo@test.local`, mot de passe affiché) et 8 annonces de biens loués publiées
   avec mandats de test signés. L'opération est idempotente.
2. « Vendeur démo », « Acquéreur démo », « Admin démo » : connexion rapide (réservée à ces trois comptes ; l'admin démo a
   les droits d'un administrateur, c'est assumé en mode test).
3. Parcours complet avec un vrai compte de test : inscription, « Confirmer mon e-mail », annonce, « Simuler ma
   vérification d'identité », justificatif de propriété, mandat (code affiché), demande de dossier, engagement de
   confidentialité, offre d'achat, étape de vente, facture de test.
4. Relances : « Lancer les tâches planifiées » dans le panneau (le passage du temps n'est pas simulé).

### Purger

Avant l'ouverture réelle, supprimez toutes les données de test (comptes, annonces, photos et documents stockés,
conversations, messages, demandes de dossier, contrats, offres, étapes de vente, factures de test, alertes,
événements, e-mails de test, compteurs `*_test`). Les données réelles ne sont jamais touchées : un mandat du registre
réel ou une facture réelle (`FAC-…`) rattachés à une donnée de test sont conservés et listés dans `protected` (à examiner
à la main). Disponible même hors mode test :
- panneau `/test` (admin) → « Supprimer toutes les données de test » (simulation, puis confirmation) ;
- ou API : `POST /api/admin/test/purge?dry_run=true` (comptes par collection) puis `?dry_run=false` ;
- ou sur l'hôte : `$COMPOSE exec backend python -m migrations.purge_test_data` (simulation) puis `... --apply`.

Faites une sauvegarde juste avant (`$COMPOSE exec backup env BACKUP_ONCE=1 bash /backup.sh`).

### Désactiver

`TEST_MODE=false` (ou supprimez la variable) dans Environment, puis **Deploy**. Les routes `/api/test/*` répondent 404,
le bandeau disparaît, les annonces de test restantes sont masquées au public et une ligne « Données de test à supprimer »
apparaît dans « À faire » tant que la purge n'a pas été faite. Les comptes de démonstration ne peuvent plus se connecter.
