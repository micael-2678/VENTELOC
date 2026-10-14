# HANDOFF — agent « taxonomie-opendata »

Chantier : SPEC §2.1 (taxonomie identique back/front), §2.3 (open data gratuit, hors BODACC) et §1 côté front (`brand.js`, `Logo`).

## Livré (fichiers de l'agent)

| Fichier | Contenu |
|---|---|
| `backend/taxonomy.py` | `TRADES` (16 métiers `{id,label,short}`), `RGE_CATEGORIES` / `RGE_TYPES` (18, `value` = libellé long), `OTHER_QUALIFICATIONS` (10), `REGIONS` (14), `DEPARTEMENTS` (101 : 96 + 5 DOM), `DEPARTEMENT_REGION`, codes NAF du bâtiment (libellés + métier suggéré), `slugify()` identique au front, `trade_label()`, `trade_by_slug()`, `validate_trades()` (1 à 4, ValueError en français), `trades_for_rge()`, `departement_label()` → « Finistère (29) », `normalize_departement()`, `region_for_departement()`, `departements_for_region()`, `departement_from_postal_code()`, `naf_status()` / `naf_in_building()` / `naf_label()` / `format_naf()` / `trade_for_naf()`, `listing_title()` (titre généré §2.2, jamais le nom). |
| `backend/opendata.py` | `fetch_json(url)` module-level (requests, timeout 8 s, mockable), cache mémoire 24 h (pannes mémorisées 2 min seulement), `lookup_siren()`, `match_dirigeant()` (`match_exact｜match_partial｜no_match｜unavailable` + `reason`), `match_in_list()` (même règle pour une liste venue d'ailleurs : INPI), `department_from_siret()`, `naf_in_building()` / `naf_status()` (ré-exportés de taxonomy), `validate_siren()` / `validate_siret()` (Luhn, cas La Poste), `company_checks_from()` (drapeaux §2.2). Le BODACC est dans `veille.py` (autre agent). |
| `backend/tests/test_taxonomy.py` | 19 tests, dont la **relecture de `frontend/src/lib/referentiels.js`** : TRADES, RGE_CATEGORIES, OTHER_QUALIFICATIONS, REGIONS, DEPARTEMENTS doivent rester identiques (ne pas changer le format `{ id: '…', label: '…' }` une entrée par ligne). |
| `backend/tests/test_opendata.py` | 40 tests avec `fetch_json` remplacé (réponse réaliste de recherche-entreprises : `nom_complet`, `siege.departement`, `activite_principale`, `dirigeants[{nom, prenoms, qualite, type_dirigeant}]`, `etat_administratif`, `matching_etablissements`, `complements.est_rge`). |
| `frontend/src/lib/referentiels.js` | Exports existants conservés (`RGE_TYPES`, `REGIONS`, `slugify`, `rgeTypeBySlug`, `regionBySlug`, `SEO_HUB_PATH`, `rgeTypePath`, `regionPath`, `shortRgeLabel`, `inRegion`, `parseSearchQuery`). Ajoutés : `TRADES`, `MIN_TRADES`/`MAX_TRADES`, `RGE_CATEGORIES`, `tradeById`, `tradeLabel(id, short)`, `tradeSlug`, `tradeBySlug`, `rgeIdFor`, `tradeForRge`, `tradesForRge`, `OTHER_QUALIFICATIONS`, `otherQualificationLabel`, `DEPARTEMENTS`, `DEPARTEMENT_CODES`, `normalizeDepartement`, `departementLabel(code)` → « Finistère (29) », `departementName`, `regionForDepartement`, `departementsForRegion`, `departementOptions(region)`, `departementFromPostalCode`, `departementBySlug`, `BUILDING_HUB_PATH`, `tradePath(id)`, `buildingRegionPath(region)`, `SEARCH_PATH`, `searchPath(filters)`. `parseSearchQuery` renvoie désormais `{ rgeTypes, region, trades, department }`. Toujours **sans import** (chargé par `scripts/prerender.mjs`). |
| `frontend/src/lib/brand.js` | `BRAND = { name, legalName:'AlterEgo SAS', siteUrl, siteHost, tagline, verticalName:'CessionRGE', contactEmail }` lu depuis `REACT_APP_BRAND_NAME` (défaut « CessionBâtiment »), `REACT_APP_SITE_URL` (défaut `https://cessionbatiment.fr`), `REACT_APP_CONTACT_EMAIL` (défaut `contact@<domaine>`) ; `splitBrandName()` ; `LEGAL` (dénomination, RCS Versailles, SIREN 952 180 230, adresse, carte T + CCI + activité, mention « déclare ne recevoir ni détenir… », art. 6 Hoguet, tribunal) ; `rcProText()`, `mediateurText()`, `brandSignature()`. Sans import. |
| `frontend/src/components/Logo.jsx` | Pictogramme + `BRAND.name` en texte, partie après la majuscule interne en vert (`BrandName` exporté, réutilisable), `aria-label` dynamique. |

Vérifications : `pytest tests/test_taxonomy.py tests/test_opendata.py` → 59 passés ; ESLint (config flat temporaire, `@eslint/js` recommended + `eslint-plugin-react`) sans erreur sur les 3 fichiers front ; `referentiels.js` et `brand.js` chargés dans un bac à sable `node:vm` comme le fait `prerender.mjs`.

Aucune dépendance ajoutée (`requests` déjà épinglé). Aucun outil payant.

## Décisions à connaître

- **`cstb-etanchéité`** (id avec accent dans la SPEC) est implémenté en ASCII : `cstb-etancheite`. `other_qualification_label()` / `validate_other_qualifications()` et `otherQualificationLabel()` acceptent les deux graphies (slugifiées).
- **Slug des métiers = id** (`/entreprises-batiment-a-vendre/metier/plomberie-chauffage`). `trade_by_slug` / `tradeBySlug` tolèrent aussi le slug du libellé.
- **`naf_in_building()`** est vrai pour la section F **et** pour les codes connexes tolérés ; `naf_status()` distingue `batiment` / `connexe` / `hors-batiment` / `inconnu` : stocker les deux (`naf_in_building` pour le badge, `naf_status == 'connexe'` pour le drapeau admin).
- `slugify` traite `œ` → `oe` et `æ` → `ae` dans les deux langages (aucune URL existante ne change : aucun libellé RGE ni région n'en contient).
- `lookup_siren` interroge toujours `?q=<siren>` (même avec un SIRET) et choisit l'établissement dans `matching_etablissements` ; le département vient de `departement` ou, à défaut, du code postal.
- Statuts `match_dirigeant` : `unavailable` couvre aussi `company_not_found`, `no_dirigeants_data`, `personne_morale` (holding), `invalid_siren`, `missing_identity` — le champ `reason` précise. `verified` est vrai pour `match_exact` **et** `match_partial`.
- Le titre généré : `taxonomy.listing_title(trades, region, staff_count)` → « Entreprise de plomberie-chauffage · Bretagne · 10 salariés » (élision « d’électricité »).

## À appliquer dans `server.py` (intégrateur)

Les numéros de ligne bougent (d'autres agents éditent `server.py`) : repères par nom de fonction.

### 1. Remplacer `get_company_dirigeants` / `_match_dirigeant` par `opendata`

En tête de `server.py` (après les imports existants) : `import opendata` et `import taxonomy`.

**`GET /company/{siren}/dirigeants`** (`get_company_dirigeants`) — nouveau corps :

```python
company = await opendata.lookup_siren(siren_clean)
if company.get("found"):
    dirigeants = [_dirigeant_legacy(d) for d in company["dirigeants"]]
    president = next((d for d in dirigeants if any(q in d["qualite"].lower() for q in ("président", "gérant", "directeur général"))), dirigeants[0] if dirigeants else None)
    return {"found": True, "available": True, "source": "API_GOUV_ENTREPRISES",
            "company": {"siren": company["siren"], "denomination": company["nom_complet"], "forme_juridique": company["forme_juridique"],
                        "date_creation": company["date_creation"], "siege": company["adresse"], "code_postal": company["code_postal"],
                        "commune": company["commune"], "departement": company["departement"], "naf": company["naf"], "etat": company["etat"]},
            "dirigeants": dirigeants, "president": president}
if not company.get("available") and os.environ.get("INPI_USERNAME"):
    inpi = await _inpi_dirigeants(siren_clean)      # bloc INPI actuel extrait tel quel (token + GET /api/companies/{siren})
    if inpi: return inpi                             # même forme de réponse, "source": "INPI_RNE"
return {"found": False, "available": company.get("available", False), "source": None,
        "message": company.get("message") or "Impossible de récupérer les informations de l'entreprise"}
```

`_dirigeant_legacy(d)` (compatibilité avec `DirigeantVerification.jsx`, qui lit `nom_complet`, `prenom`, `nom`, `qualite`) :

```python
def _dirigeant_legacy(d):
    if d.get("type") == "personne morale":
        return {"nom": d["denomination"], "prenom": "", "nom_complet": d["denomination"], "qualite": d["qualite"] or "Dirigeant",
                "siren_pm": d.get("siren"), "type_personne": "morale"}
    prenom = (d["prenoms"].split() or [""])[0]
    return {"nom": d["nom"], "prenom": prenom, "prenoms_complets": d["prenoms"], "nom_complet": f"{prenom} {d['nom']}".strip(),
            "qualite": d["qualite"] or "Dirigeant", "annee_naissance": d.get("annee_de_naissance"), "type_personne": "physique"}
```

**`_match_dirigeant(siren_clean, user_firstname, user_lastname, user_fullname)`** — garder la signature (appelée par `verify_user_is_dirigeant` et `dirigeant_check_for`, et remplacée dans `tests/conftest.py`), nouveau corps :

```python
async def _match_dirigeant(siren_clean, user_firstname, user_lastname, user_fullname):
    r = await opendata.match_dirigeant(siren_clean, user_firstname, user_lastname)
    # Second choix : INPI, seulement si configuré et si l'open data n'a rien donné d'exploitable
    if r["status"] == "unavailable" and r.get("reason") in ("api_unavailable", "no_dirigeants_data") and os.environ.get("INPI_USERNAME"):
        inpi = await _inpi_dirigeants(siren_clean)
        if inpi and inpi.get("dirigeants"):
            status, d = opendata.match_in_list(inpi["dirigeants"], user_firstname, user_lastname)
            r = {**r, "status": status, "verified": status != "no_match", "dirigeant": d, "source": "INPI_RNE",
                 "reason": None if status != "no_match" else "name_mismatch", "dirigeants": inpi["dirigeants"]}
    president = next((d for d in r.get("dirigeants") or [] if d.get("type") == "personne physique"), None)
    return {"verified": bool(r["verified"]), "status": r["status"], "reason": r.get("reason"), "message": r["message"],
            "matched_as": r.get("matched_as"), "dirigeant": _dirigeant_legacy(r["dirigeant"]) if r.get("dirigeant") else None,
            "president": _dirigeant_legacy(president) if president else None, "company": r.get("company"),
            "has_personne_morale": r.get("has_personne_morale", False), "source": r.get("source"),
            "can_invite_president": r["status"] != "match_exact"}
```

Supprimer le bloc « Méthode 2 » (recherche-entreprises) de l'ancien `get_company_dirigeants` et la fonction interne `normalize_name` de l'ancien `_match_dirigeant` (remplacée par `opendata.normalize_name`). Garder `get_inpi_token()` et `INPI_TOKEN_CACHE`.

**`verify_user_is_dirigeant`** : inchangé sauf qu'il stocke aussi `reason` dans `dirigeant_verifications` (`"reason": result.get("reason")`). Le statut `company_not_found` / `no_dirigeants_data` devient `unavailable` + `reason` : `DirigeantVerification.jsx` ne teste que `verified`, `matched_as`, `president` → pas de changement front obligatoire.

**`tests/conftest.py`** : remplacer le remplacement de `server._match_dirigeant` par un `fetch_json` simulé :

```python
import opendata
_FAKE = {"results": [{"siren": "<calculé>", "nom_complet": "SECRET ENERGIE", "etat_administratif": "A", "nature_juridique": "5710",
                      "activite_principale": "43.22A", "siege": {"departement": "29", "siret": "<siret>", "activite_principale": "43.22A"},
                      "dirigeants": [{"nom": "DUPONT", "prenoms": "Paul", "qualite": "Président", "type_dirigeant": "personne physique"}]}]}
def _fake_fetch(url):
    siren = re.search(r"q=(\d{9})", url).group(1)
    data = copy.deepcopy(_FAKE); data["results"][0]["siren"] = siren; data["results"][0]["siege"]["siret"] = siren + "00011"
    return data
opendata.fetch_json = _fake_fetch
```

(ainsi « Paul Dupont » reste dirigeant de tous les SIREN, comme aujourd'hui ; `opendata.clear_cache()` dans la fixture `emails` ou en début de session).

### 2. `submit_listing` : publication automatique et `company_checks` (SPEC §4.4)

Après la vérification du mandat signé, remplacer le calcul `dirigeant_check_for` / `auto_publish` par :

```python
siret = (company_doc.get("siret") or "").replace(" ", "")
siren = siret[:9]
company = await opendata.lookup_siren(siret or siren) if siren else {"available": False, "found": False}
first = (user.get("verified_first_name") or user.get("first_name") or "")
last = (user.get("verified_last_name") or user.get("last_name") or "")
dirigeant = await opendata.match_dirigeant(siren, first, last) if siren else None
rge_declared = bool(company_doc.get("rge_types"))
in_ademe = None
if rge_declared and siret:
    ademe = await verify_rge(siret)                       # existant
    in_ademe = bool(ademe.get("found")) if not ademe.get("error") else None
duplicate = await db.companies.find_one({"id": {"$ne": company_doc["id"]}, "siret": {"$regex": f"^{siren}"},
                                         "status": "published"}) if siren else None
checks = opendata.company_checks_from(company, dirigeant, in_ademe, bool(duplicate))
checks["email_verified"] = bool(user.get("email_verified", True))
trades = taxonomy.validate_trades(company_doc.get("trades") or taxonomy.trades_for_rge(company_doc.get("rge_types")))  # ValueError → HTTP 400
blocking = []
if not checks["email_verified"]: blocking.append("email_non_confirme")
if not is_user_verified(user): blocking.append("identite_non_verifiee")
if not siret: blocking.append("siret_manquant")
if checks["siren_active"] is False: blocking.append("siren_inactif")
if checks["duplicate_siren"]: blocking.append("doublon_siren")
if not trades: blocking.append("metier_manquant")
if not (company_doc.get("asking_price") or 0) > 0: blocking.append("prix_manquant")
flags = []
if checks["dirigeant_match"] != "match_exact": flags.append("dirigeant_non_confirme")
if checks["naf_in_building"] is False: flags.append("naf_hors_batiment")
if checks["naf_status"] == "connexe": flags.append("naf_connexe")
if rge_declared and in_ademe is False: flags.append("rge_absent_ademe")
if not checks["opendata_available"]: flags.append("open_data_indisponible")
update = {
    "company_checks": checks, "trades": trades, "is_rge": rge_declared,
    "naf_code": company.get("naf") if company.get("found") else company_doc.get("naf_code"),
    "naf_in_building": checks["naf_in_building"],
    "department": company_doc.get("department") or (company.get("departement") if company.get("found") else None),
    "region": company_doc.get("region") or (company.get("region") if company.get("found") else None),
    "title": taxonomy.listing_title(trades, company_doc.get("region") or company.get("region"), company_doc.get("staff_count")),
    "dirigeant_status": checks["dirigeant_match"], "dirigeant_verified": checks["dirigeant_match"] in ("match_exact", "match_partial"),
    "moderation": {"status": "pending", "flags": flags, "review_until": (datetime.now(timezone.utc) + timedelta(hours=48)).isoformat(),
                   "reviewed_at": None, "reason": None},
    "submitted_at": now, "updated_at": now,
}
if blocking:
    update["status"] = "draft"; update["blocking"] = blocking   # renvoyer les motifs à l'utilisateur, e-mail « ce qu'il manque »
else:
    publish_company(...) ; update["status"] = "published"      # plus de file « pending » admin
```

Les `flags` (non bloquants) alimentent `GET /admin/todo` (« annonces publiées < 48 h à relire ») : requête `{"moderation.status": "pending", "moderation.review_until": {"$gte": now}}`. L'e-mail `admin_listing_pending` n'est plus envoyé : remplacé par le digest quotidien « À faire ».

### 3. Autres usages back

- `POST /estimates` (`estimator.py`) et `POST /auth/register` (SIRET facultatif) : `opendata.lookup_siren(siret)` → préremplir `company_name`, `naf_code`, `creation_date`, `staff_count` (`effectif_estime`), `department`, `region`, `legal_structure`, `trades` (`[trade_suggestion]` si non vide) ; si `available` est faux : message « Vérification différée », jamais bloquant.
- Repreneur : `siren` à l'inscription → `lookup_siren` → `company_verified = found and siren_active`.
- Migration `refonte_2026_10.py` : `trades = taxonomy.trades_for_rge(rge_types) or ["renovation-generale"]`, `is_rge = bool(rge_types)`, `department` depuis `opendata.department_from_siret(siret)` (facultatif, en dry-run ne pas appeler le réseau), `title = taxonomy.listing_title(...)`.
- Validation Pydantic de `CompanyCreate` / `PUT /companies/{id}` : `trades` via `taxonomy.validate_trades` (lever `HTTPException(400, str(e))`), `other_qualifications` via `taxonomy.validate_other_qualifications`, `department` via `taxonomy.normalize_departement` (vide → 400 « Département inconnu »).
- Pages SEO back (`/sitemap.xml`, comptages) : `taxonomy.TRADES` / `taxonomy.trade_slug()` pour `/entreprises-batiment-a-vendre/metier/<id>` et `taxonomy.slugify(region)` pour `/region/<slug>`.

## À appliquer côté front (autres fichiers)

- **`scripts/prerender.mjs`** : `loadShared` doit fournir `process` au bac à sable pour `brand.js` : `vm.runInNewContext(..., { process: { env: process.env } }, ...)` (sans cela `process.env` lève une ReferenceError). Puis `const { BRAND, splitBrandName, LEGAL } = loadShared('lib/brand.js')` ; `SITE_URL = BRAND.siteUrl` ; `logoHtml` rend `splitBrandName(BRAND.name)` (plus de « Cession<span>RGE</span> » en dur) et `aria-label="${BRAND.name} – accueil"` ; `seo-routes.json` sans `site`.
- **`src/lib/seo.js`** : `SITE_URL` depuis `BRAND.siteUrl` (`import { BRAND } from '@/lib/brand'`).
- **`src/seo/legal.js`** (sans import, chargé par le pré-rendu) : `LEGAL_FALLBACK.marque` et `email` ne peuvent pas importer `brand.js` → les consommateurs passent `BRAND.name` / `BRAND.contactEmail` en surcharge (`mergeLegal({ ...info, marque: BRAND.name })`).
- **`aria-label="CessionRGE – accueil"`** en dur autour de `<LogoMark>` dans `ProfilePage.jsx`, `CompanyDetail.jsx` (mobile), `LoginPage.jsx`, `ResetPasswordPage.jsx` → `` aria-label={`${BRAND.name} – accueil`} ``. 15 fichiers de `src/` contiennent encore « CessionRGE » en dur (`grep -rl CessionRGE src`) : remplacer par `BRAND.name` (ou `BRAND.verticalName` quand il s'agit vraiment de la verticale RGE).
- **`PublicSearch.jsx`** : utiliser `trades` et `department` renvoyés par `parseSearchQuery`, et `searchPath()` pour construire les liens de filtres ; `/search` → redirection vers `SEARCH_PATH`.
- **`CreateListing.jsx`** : `TRADES` (1 à 4, `MAX_TRADES`), `OTHER_QUALIFICATIONS`, `departementOptions(region)` pour le sélecteur de département, `departementFromPostalCode()` pour préremplir depuis l'open data.
- **`SeoPages.jsx` / routes** : hub `BUILDING_HUB_PATH` + `/metier/:slug` (`tradeBySlug`) + `/region/:slug` (`regionBySlug`, `buildingRegionPath`).
- **`ListingCard` / `CompanyDetail`** : `tradeLabel(id, true)` pour les métiers, `departementLabel(code)` à côté de la région, `otherQualificationLabel()` pour les qualifications déclarées.
- **`.env.example` front et `DOKPLOY_DEPLOYMENT.md`** : documenter `REACT_APP_BRAND_NAME`, `REACT_APP_SITE_URL`, `REACT_APP_CONTACT_EMAIL` (et côté back `SITE_NAME`, `SITE_URL`).
