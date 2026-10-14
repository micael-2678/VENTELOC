# HANDOFF — agent « modules-nouveaux »

Chantier : SPEC §6.2 (`events.py`), §4.2 point 1 (`estimator.py`), §4.6 (`transmissibility.py`), §6.4 veille BODACC (`veille.py`).

Vérification : `cd backend && python -m pytest -q` → **186 passés** (143 existants + 43 nouveaux) ; `flake8 --max-line-length=140 --extend-ignore=E501` propre sur les 8 fichiers ; `python -c "import server, events, estimator, transmissibility, veille"` sans erreur (les modules sont chargés par la boucle `importlib` de `server.py`, leurs routeurs inclus sous `/api`, `events.daily_job`, `estimator.daily_job` et `veille.monthly_job` enregistrés dans `DAILY_JOBS` / `MONTHLY_JOBS`). Aucune dépendance ajoutée, aucun outil payant.

## Livré (fichiers de l'agent)

| Fichier | Contenu |
|---|---|
| `backend/events.py` | `POST /events {name, path, props?}` (sans cookie ; `visitor_hash` = sha256(IP + user-agent + sel du jour), sel = HMAC(`EVENTS_SALT_SECRET` ou `JWT_SECRET`, date), **jamais l'IP** ; chemin normalisé : paramètres et fragment retirés, uuid/jetons/SIRET/numéros remplacés par `:id` ; `props` : 10 clés scalaires max, 500 caractères) ; **liste fermée** `EVENT_NAMES` (les 10 de la SPEC + `front_error`, sinon 400) ; limite **60/min/IP** par `SlidingWindowLimiter` maison (`check_rate_limit(request, bucket, scope)`, désactivée par `RATE_LIMIT_ENABLED=false` comme slowapi, réutilisée par les autres modules) ; `metrics_by_day(days, names=None, now=None)` → `{period_days, from, to, names, days:[{day, visitors, events:{nom:n}}], totals, visitor_days, paths:[{path,count}] (top 20 des page_view)}` ; `GET /admin/events?days&names=a,b` (admin) ; `daily_job()` purge > 400 jours. Collection `db.events` `{id, name, path, props, visitor_hash, day, created_at, expire_at}`. |
| `backend/estimator.py` | `GET /estimates/company/{siret}` (préremplissage open data + ADEME, jamais bloquant) ; `POST /estimates {siret?, ca, ebe, staff, maintenance_contracts, team_stays, owner_dispensable, email?}` → `{low, high, mid, method (phrase FR), method_code, components, adjustment_percent, drivers:[{key,label,active,effect,effect_label,hint}], pedagogy:[5 textes], siret, company (préremplissage), rge, disclaimer, email?}` ; `compute_estimate()` pure : 0,3-0,6 × CA et 2,5-4 × EBE **pondérés 40 % / 60 %** quand les deux existent (EBE ≤ 0 → 0,3-0,45 × CA seul ; CA absent → EBE seul), ±5 % par case (±15 %), minimum 10 000 €, arrondi à 5 000 € (demi vers le haut), `high ≥ low + 5 000` ; avec `email` : `db.estimates` `{id, email, status: pending_confirmation|confirmed, created_at, expires_at (48 h), confirm_token_hash, siret, inputs, result, company, rge, consent:{purpose, requested_at, confirmed_at, visitor_hash}}` + e-mail `estimate_confirm` (1 par adresse toutes les 2 min, sinon 429) ; `GET /estimates/confirm/{token}` : confirme, envoie `estimate_result` (fourchette + pédagogie + lien `/register?role=seller`), **redirige** (302) vers `/estimer?confirmation=ok|invalide|expire` pour un navigateur (`Accept: text/html`), JSON sinon (404 / 410 / `{confirmed, already_confirmed, estimate}`) ; `daily_job()` : purge des non confirmées > 7 j et des confirmées > 3 ans. Gabarits ajoutés via `EMAIL_TEMPLATES.setdefault`. Limite 20/min/IP. |
| `backend/transmissibility.py` | Constantes FR : `ORGANISMES` (qualibat, qualit-enr [QualiPAC/QualiPV/Qualibois/Qualisol], qualifelec, certibat, rge-etudes [OPQIBI/OPQTECC/I.Cert/LNE], autre) avec `titres`, `fonds`, `delai_fonds`, `referent`, `site` ; `REFERENT` (6 mois, étapes), `DECENNALE` (titres / fonds, L113-2, L241-1), `AIDES` (chantiers aidés en cours), `REFORME` (RGE-facturant 01/01/2027, contrôles, VAE 01/03/2027), `TRANSFER`, `LEVELS`, `DISCLAIMER`. `organisme_for()`, `qualification_status(date_fin)` → valide / expire_bientot (≤ 180 j) / expiree / inconnue, `normalize_ademe(raw)`, `fetch_ademe_qualifications(siret)` (**appelle `server.get_company_qualifications`**, lit `details` si la route les fournit — voir §1), `build_diagnostic(company_or_qualifications, with_financials=False)` → `{generated_at, scope, is_rge, source: ademe|declaration|aucune, verified_at, qualifications:[{name, organisme, organisme_label, domaine, date_debut, date_fin, status, days_left, source}], organismes:[{key,label,site,qualifications,titres,fonds,delai_fonds,referent}], transfer:{titres:{label,summary,steps}, fonds:{…}, recommended, recommendation, chosen}, referent:{…, stays}, decennale:{…, ok}, aides, reforme, level:{value: elevee|moyenne|fragile|non-applicable|a-completer, label, reasons}, disclaimer, + checklist:[{key,label,status: ok|attention|inconnu, detail}] et financials si with_financials}`. Routes : `GET /rge/company/{siret}/transmissibility` (publique, 30/min/IP, jamais bloquante : `available:false` + diagnostic générique si l'ADEME ne répond pas) ; `GET /companies/{company_id}/transmissibility` (cédant / admin / repreneur avec `db.dataroom_access.status == 'granted'`, sinon 403 ; ADEME interrogée si SIRET et RGE déclaré, sinon déclaratif). |
| `backend/veille.py` | `fetch_json(url)` module-level ; `bodacc_url(siren, since)` (`where=registre like "<siren>" and dateparution >= "<AAAA-MM-JJ>"`, `order_by=dateparution desc`, pagination 100) ; `bodacc_events(siren, since)` → `[{id, siren, famille, famille_label, type, type_label, date, numero, tribunal, commercant, ville, departement, description, url, relevant}]` ; pertinent = famille `vente` ou `modification` dont le texte évoque dirigeant/gérant/président/associé/cession/fonds/capital… (texte vide → signalé) ; `collect_targets(now)` : mandats `signed|denounced|expired` tant que `tail_ends_at` (sinon `ends_at` + 18 mois, sinon signature + 30 mois) > maintenant, NDA (`db.documents.doc_type == 'nda'`) de moins de 24 mois ; SIREN = `company.siren` ou `siret[:9]` ; exclus : `db.closings` avec statut dans `SALE_DECLARED_STATUSES`, `company.status` dans `sold|vendue|sold_via_platform`, `company.sale_declared_at` ; `since` = date la plus ancienne (mandat / NDA). `run_veille()` / `monthly_job()` : incidents `db.incidents {id, type:'bodacc', siren, company_id, seller_id, company_label, sources, event, created_at, status:'open', note}` sans doublon (`event.id`), e-mail `bodacc_incident_seller` au cédant + `bodacc_incident_admin` à `ADMIN_NOTIFICATION_EMAIL` (via `email_admin`), journal `db.veille_runs` ; panne sur **tous** les SIREN → `db.job_failures {job:'monthly:veille'}` sans exception (le planificateur attend un entier). Routes admin : `GET /admin/incidents?status=open|closed|all`, `PUT /admin/incidents/{id} {status, note?}` (clore / rouvrir), `POST /admin/veille/run` (503 si BODACC injoignable). |
| `backend/tests/test_events.py` | 11 tests : empreinte sans IP et sel quotidien, normalisation des chemins, props, limiteur, route (sans cookie), nom inconnu → 400, 60/min/IP → 429, `metrics_by_day` (jours à zéro, visiteurs, filtre, chemins), route admin, purge. |
| `backend/tests/test_estimator.py` | 13 tests : formule exacte (285 000-490 000 pour 900 k€ CA / 150 k€ EBE sans case ; 385 000-660 000 toutes cases), bornes, EBE ≤ 0, approches seules, pédagogie, route sans e-mail (rien stocké), validation, SIRET → open data + ADEME simulés, pannes non bloquantes, double opt-in complet (jeton haché, 429 sur renvoi, confirmation JSON puis redirection, e-mail de résultat, idempotence), lien invalide/expiré, purge. |
| `backend/tests/test_transmissibility.py` | 11 tests : constantes (aucun « à compléter »), détection d'organisme, statuts, `normalize_ademe` avec/sans `details`, diagnostic public (niveaux), annonce complète (checklist, niveaux, ADEME prioritaire), route publique (trouvée / absente / panne / exception), route annonce (403 sans accès, 200 cédant / repreneur `granted` / admin, 404), annonce sans SIRET. |
| `backend/tests/test_veille.py` | 8 tests : URL, normalisation et pertinence, pagination, clause de suite, job complet (incidents, e-mails cédant + admin, dates FR, pas de doublon, routes admin), cibles (9 cas), panne totale (0 + `job_failures`, 503 admin). |

## Décisions à connaître

- **Pondération 40 % CA / 60 % EBE** pour la fourchette combinée (la SPEC dit « combinés ») : l'EBE est l'indicateur du repreneur, le CA le garde-fou ; les composantes sont renvoyées (`components`) pour l'afficher. `method` est une phrase française prête à afficher ; `method_code` ∈ `ca_ebe | ca | ca_only | ebe`.
- Le SIRET de l'estimateur n'exige **pas** la clé de Luhn (14 chiffres suffisent ; l'annuaire répond « inconnu ») : cohérent avec le reste de la plateforme et « jamais bloquant ».
- Le lien de confirmation pointe sur l'API (`SITE_URL/api/estimates/confirm/<jeton>`, l'API étant servie sous le même domaine) et redirige vers `/estimer?confirmation=…` : **aucune page front supplémentaire n'est nécessaire**, la page `/estimer` lit seulement le paramètre.
- Les visiteurs des statistiques ne sont **pas** suivis d'un jour à l'autre (sel quotidien) : `visitor_days` = somme des visiteurs uniques par jour.
- `fetch_ademe_qualifications` passe par la route existante `server.get_company_qualifications` : sans le point 1 ci-dessous, les qualifications n'ont **pas de date de fin** (statut `inconnue`, l'organisme est deviné d'après le libellé). Avec `details`, dates et organismes sont exacts.
- Familles BODACC retenues pour un incident : `vente` et `modification` (filtre par mots-clés), conformément à la SPEC ; les procédures collectives sont renvoyées par `bodacc_events` (`relevant: false`) mais ne créent pas d'incident.
- `veille.SALE_DECLARED_STATUSES = ("declared", "pending_confirmation", "confirmed", "invoiced", "paid", "completed")` : à aligner avec les statuts réels de `closing.py` (voir §3).

## 1. À appliquer dans `server.py` (intégrateur)

### a) `GET /rge/company/{siret}/qualifications` (`get_company_qualifications`) : ajouter `details`

Dans la branche `found`, après le calcul de `organismes` :

```python
details, seen = [], set()
for r in results:
    key = (r.get("nom_qualification"), r.get("organisme"), r.get("domaine"), r.get("lien_date_fin"))
    if key in seen:
        continue
    seen.add(key)
    details.append({"nom_qualification": r.get("nom_qualification", ""), "organisme": r.get("organisme", ""),
                    "domaine": r.get("domaine", ""), "meta_domaine": r.get("meta_domaine", ""),
                    "lien_date_debut": r.get("lien_date_debut"), "lien_date_fin": r.get("lien_date_fin"),
                    "nom_certificat": r.get("nom_certificat", ""), "url_qualification": r.get("url_qualification", "")})
return {"found": True, "company": company_info, "domaines": domaines, "qualifications": qualifications,
        "organismes": organismes, "details": details, "total_certifications": data.get("total", 0)}
```

`transmissibility.normalize_ademe` lit `details` dès qu'il est présent (dates de fin, organisme exact) ; `estimator` renvoie alors `rge.details` avec les dates. La page `/verifier-entreprise-rge` et `CreateListing` (qualifications préchargées) en profitent aussi.

### b) `GET /admin/metrics` (`get_admin_metrics`) : ajouter les événements maison

```python
events_module = LOADED_MODULES.get("events")
events_metrics = await events_module.metrics_by_day(days) if events_module else None
...
return {..., "events": events_metrics}
```

(`LOADED_MODULES` est défini après `get_admin_metrics` mais rempli avant toute requête ; sinon `import events` dans la fonction.) Le front `AdminMetrics` lit `events.days[].events.<nom>`, `events.totals`, `events.paths`.

### c) `GET /admin/todo` : incidents BODACC

Ligne « Incidents BODACC » : `await db.incidents.find({"status": "open"}, {"_id": 0}).sort("created_at", -1).to_list(100)` ; action « Clore » → `PUT /admin/incidents/{id} {status: 'closed', note}` (route fournie par `veille.py`). Échecs de jobs : `db.job_failures` contient aussi `job: 'monthly:veille'` quand le BODACC est injoignable.

### d) Index au démarrage (`startup`)

```python
await db.events.create_index([("day", 1), ("name", 1)])
await db.events.create_index("expire_at", expireAfterSeconds=0)        # dans la boucle try des index TTL
await db.estimates.create_index("confirm_token_hash")
await db.estimates.create_index("email")
await db.incidents.create_index([("siren", 1), ("event.id", 1)])
await db.dataroom_access.create_index([("company_id", 1), ("buyer_id", 1)])
```

### e) Suppression de compte (`delete_account`) : `await db.estimates.delete_many({"email": original_email})` (les estimations sont des données de prospect liées à l'adresse).

### f) `tests/conftest.py` : neutraliser le réseau BODACC

`test_lancement.py::test_scheduled_jobs_reminder_followup_relaunch` lance `run_scheduled_jobs(force=True)`, donc `veille.monthly_job` : sans réseau, le job renvoie 0 et consigne un échec (test vert), mais il tente l'appel HTTP pour chaque SIREN sous mandat (≈ 1 s). Ajouter après `import server` :

```python
import veille
veille.fetch_json = lambda url: {"total_count": 0, "results": []}
```

(`tests/test_veille.py` remplace `veille.fetch_json` par `monkeypatch` et restaure cette valeur.)

### g) `.env.example` / `DOKPLOY_DEPLOYMENT.md`

`EVENTS_SALT_SECRET` (facultatif : sel des statistiques, par défaut `JWT_SECRET`). Politique de confidentialité : statistiques anonymes 400 jours ; estimation non confirmée 7 jours, confirmée 3 ans.

## 2. Mandat v2 (agent mandat / server.py)

La veille lit sur `db.generated_contracts` (type `mandat`) les champs `status` (`signed|denounced|expired`), `signed_at`, `ends_at`, `tail_ends_at` prévus par la SPEC §3.2. Sans `tail_ends_at` (mandats v1), repli : `ends_at` + 18 mois, sinon signature + 30 mois. Rien à changer si la SPEC est respectée.

## 3. `closing.py` (agent closing)

- Statuts qui valent « vente déclarée » : `veille.SALE_DECLARED_STATUSES`. Si les statuts réels diffèrent, modifier cette constante (une ligne) ou nommer les statuts `declared` / `confirmed` / `invoiced` / `paid`.
- À la déclaration d'une vente, clore les incidents ouverts de la société : `await db.incidents.update_many({"company_id": cid, "status": "open"}, {"$set": {"status": "closed", "closed_at": now, "note": "Vente déclarée"}})`.
- Le bouton « Vendue autrement » n'a rien à faire pour la veille : le SIREN est déjà surveillé tant que la clause de suite court.

## 4. Front (agent front)

- `src/lib/analytics.js` : remplacer Plausible par `fetch(`${BACKEND}/api/events`, {method:'POST', keepalive:true, body: JSON.stringify({name, path: location.pathname, props})})` (ou `navigator.sendBeacon` avec un `Blob` `application/json`) ; noms autorisés : `page_view, hero_cta_seller, estimate_started, estimate_completed, calc_used, alert_created, listing_card_click, contact_sent, register_started, register_completed, front_error` (tout autre nom → 400) ; `ErrorBoundary` → `front_error` avec `props.message`.
- Page `/estimer` : étape SIRET → `GET /api/estimates/company/{siret}` (`company.*` pour préremplir, `rge.qualifications`/`rge.details`) ; formulaire → `POST /api/estimates` ; afficher `low`/`high`/`mid`, `drivers` (`effect_label`, `hint`), `pedagogy`, `method` ; champ e-mail facultatif (réponse `email.confirmation_required`) ; lire `?confirmation=ok|invalide|expire` au retour du lien ; « Déposer mon annonce anonyme » → `sessionStorage` avec `company` + `inputs`.
- `/verifier-entreprise-rge` : `GET /api/rge/company/{siret}/transmissibility` → `diagnostic.qualifications` (statut, `date_fin`), `diagnostic.organismes[].titres/fonds`, `transfer`, `referent`, `decennale`, `aides`, `reforme`, `level`, `disclaimer` ; message `message` si `available` est faux.
- Data room (`CompanyDetail` après accès accordé) et espace vendeur : `GET /api/companies/{id}/transmissibility` → en plus `checklist` (statuts `ok|attention|inconnu`) et `financials`.
- Admin : `GET /api/admin/events?days=30`, `GET /api/admin/incidents`, `PUT /api/admin/incidents/{id}`, `POST /api/admin/veille/run`.
