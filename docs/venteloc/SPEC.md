# VenteLoc — spécification de référence

VenteLoc est une **place de marché d'intermédiation sécurisée pour les biens immobiliers déjà loués** : le propriétaire bailleur dépose lui-même son annonce, la plateforme vérifie le vendeur et le bien, qualifie les investisseurs, encadre la confidentialité, le dossier du bien, l'offre d'achat et le passage chez le notaire. Rien n'est payé avant la signature de l'acte authentique.

Le code est repris de CessionRGE (cession d'entreprises du bâtiment, même fondateur, même entité exploitante, même pile technique). Tout ce qui a fait ses preuves est conservé (comptes, e-mail confirmé, vérification d'identité Stripe à l'usage, signature par code e-mail avec dossier de preuve, mandat simple, accord de confidentialité, data room filigranée, offres signées, étape de vente, facture, relances, admin « À faire », mode test, statistiques maison, sauvegardes, déploiement Dokploy). Le métier « entreprise du bâtiment » est remplacé par le métier « bien loué ».

Ce document est la source de vérité. Tout agent qui code le lit **en entier** avant de toucher au dépôt. `docs/venteloc/API.md` décrit le contrat d'API (à tenir à jour en même temps que le code). `docs/venteloc/MODE-TEST.md` décrit le mode test. La mécanique héritée de CessionRGE est documentée dans l'historique Git de ce dépôt et dans le dépôt Cession-rge ; en cas de conflit, **ce document prévaut**.

## 0. Décisions (14 octobre 2026, à valider par le fondateur ; toutes paramétrables)

1. **Marque** : `VenteLoc` (`SITE_NAME`, `REACT_APP_BRAND_NAME`), URL par défaut `https://venteloc.fr` (`SITE_URL`, `REACT_APP_SITE_URL`). Jamais écrits en dur.
2. **Entité exploitante** : AlterEgo SAS, carte professionnelle T « Transactions sur immeubles et fonds de commerce » (mêmes variables `LEGAL_*` et mêmes valeurs par défaut que CessionRGE). Aucune personne physique sur le site.
3. **Mandat de vente simple (non exclusif)** signé en ligne par code e-mail, 12 mois renouvelables, résiliable à tout moment avec un préavis de 15 jours ; **droit de rétractation de 14 jours** pour un mandant consommateur (contrat conclu à distance) : une dénonciation dans les 14 jours suivant la signature est une rétractation, effective immédiatement. Clause de suite **12 mois** après la fin du mandat (acquéreur nommément présenté).
4. **Honoraires** : `COMMISSION_RATE_PERCENT` HT du prix de vente (défaut **3 % HT, soit 3,6 % TTC**), minimum `COMMISSION_MIN_HT` (défaut **3 000 € HT, soit 3 600 € TTC**), TVA 20 %, **à la charge du vendeur**, exigibles uniquement à la signature de l'acte authentique, réglés par le notaire sur le prix (ordre irrévocable). Rien pour l'acquéreur. Un seul taux (pas de tranche). Affichage **TTC d'abord** (vendeurs majoritairement particuliers, arrêté du 10 janvier 2017), HT entre parenthèses.
5. **Vérifications** : e-mail confirmé (tous) ; identité Stripe Identity (vendeur avant le mandat, acquéreur avant l'engagement de confidentialité) ; **justificatif de propriété** déposé par le vendeur avant publication (titre de propriété, attestation notariée, avis de taxe foncière ou statuts et Kbis de la SCI), contrôlé par l'admin → badge « Propriétaire vérifié » ; déclaration d'origine des fonds de l'acquéreur avant l'accès au dossier (LCB-FT : l'agent immobilier est assujetti).
6. **Confidentialité** : l'annonce publique montre la ville, le département, le quartier facultatif, les caractéristiques, le bail et les chiffres ; **l'adresse exacte, l'identité du vendeur et la dénomination de la SCI ne sont révélées qu'après l'engagement de confidentialité et de non-contournement**. Les données personnelles du locataire ne sont **jamais** saisies dans l'annonce ; le vendeur est invité à les masquer dans les documents du dossier.
7. **Aucune dépense hors publicité** (inchangé) : Brevo palier gratuit, statistiques maison, sauvegardes maison, polices auto-hébergées, Stripe Identity à l'usage seulement.
8. **Pas d'estimation par une base payante** : l'estimateur fonctionne par la méthode du rendement, sans appel externe.

## 1. Vocabulaire (textes affichés, e-mails, PDF)

| CessionRGE | VenteLoc |
|---|---|
| cédant | **vendeur** (propriétaire bailleur) |
| repreneur | **acquéreur** (ou investisseur dans les textes marketing) |
| entreprise, société cible | **bien** (le bien loué) |
| cession, acte de cession | **vente**, **acte authentique de vente** |
| accord de confidentialité (NDA) | **engagement de confidentialité et de non-contournement** (on peut écrire « engagement de confidentialité » en abrégé) |
| dossier, data room | **dossier du bien** |
| offre indicative | **offre d'achat** |
| rédacteur d'acte | **notaire** |
| titres / fonds | **parts de la société** / **bien** |
| présenté au cédant | présenté au vendeur |

Rôles techniques inchangés : `seller`, `buyer`, `admin`. Noms techniques : `property`, `properties`, `property_id` (déjà renommés). Le ton reste : vouvoiement, phrases courtes, pas de « communauté », pas de « rejoignez ».

Les mots « bâtiment », « RGE », « métier », « qualification », « repreneur », « cédant », « cession d'entreprise », « fonds de commerce » (sauf mention juridique pertinente), « NAF », « ADEME », « BODACC », « dirigeant » (sauf gérant de SCI) ne doivent plus apparaître dans l'interface, les e-mails, les PDF ni les données de démonstration. Vérification finale : `grep -rniE "rge|bâtiment|repreneur|cédant|ademe|bodacc|cessionb" backend frontend/src` ne doit renvoyer que des faux positifs justifiés (ex. « charge »).

## 2. Référentiels (`backend/taxonomy.py` ⇄ `frontend/src/lib/referentiels.js`, identiques)

Déjà écrits en fin de fichier dans les deux langages (section « VENTELOC ») : `PROPERTY_TYPES`, `LEASE_TYPES`, `DPE_CLASSES`, `DPE_RENTAL_BAN`, `TENANT_PAYMENT_STATUSES`, `OWNER_TYPES`, `SALE_OBJECTS`, `SALE_REASONS`, `BUYER_PROJECT_TYPES`, `FINANCING_TYPES`, et les fonctions `property_type_label/propertyTypeLabel`, `lease_type_label/leaseTypeLabel`, `is_housing_lease/isHousingLease`, `dpe_rental_status/dpeRentalStatus`, `gross_yield/grossYield`, `net_yield/netYield`, `property_title/propertyTitle`. **Ne pas changer les ids** ; un libellé modifié doit l'être dans les deux fichiers (test de synchronisation `tests/test_taxonomy.py`, à réécrire pour ces tables).

Conservés : `REGIONS`, `DEPARTEMENTS`, `slugify`, fonctions département/région/code postal, `inRegion`, `departementOptions`, `SEARCH_PATH`.

À supprimer (dans les deux fichiers, une fois plus aucun import) : `TRADES`, `MIN/MAX_TRADES`, `RGE_CATEGORIES`, `RGE_TYPES`, `OTHER_QUALIFICATIONS`, NAF, `listing_title`, correspondances RGE → métiers, `parseSearchQuery` et ses tables de mots-clés (la recherche libre `?q=` disparaît, ou est réécrite sur types de biens + villes/départements si c'est simple).

## 3. Modèle `property` (collection `properties`)

Tous les champs sont facultatifs au brouillon (création dès l'écran 1, compléments par `PUT /properties/{id}`). Les contrôles de publication (§5.4) disent ce qui est obligatoire.

### 3.1 Le bien
- `property_type` ∈ `PROPERTY_TYPE_IDS`
- `owner_type` ∈ `OWNER_TYPE_IDS` ; si `sci` ou `societe` : `company_name` (dénomination, **confidentielle**) et `siret` (**confidentiel**, vérifié par l'open data recherche-entreprises : société active, gérant concordant → drapeaux, jamais bloquant sauf société cessée)
- Localisation : `address` (numéro et voie, **confidentielle**), `postal_code`, `city`, `department` (déduit du code postal), `region` (déduite), `district` (quartier, facultatif, public)
- `surface` (m², habitable ou utile), `rooms` (pièces, habitation), `floor` (étage, entier, facultatif), `elevator` (bool), `construction_year`, `units_count` (nombre de lots, immeuble ou plusieurs baux), `units_rented` (lots loués)
- Copropriété (mentions obligatoires de l'annonce, art. L721-1 CCH) : `is_copro` (bool), `copro_lots` (nombre de lots de la copropriété), `copro_charges_annual` (quote-part annuelle moyenne de charges courantes, €), `copro_procedure` (bool : procédure en cours, art. 29-1 A / 29-1 de la loi de 1965)
- DPE (obligatoire dans une annonce de logement) : `dpe_class` ∈ `DPE_CLASS_IDS`, `ges_class` ∈ A-G (facultatif si non soumis), `energy_cost_min`, `energy_cost_max` (estimation des dépenses annuelles d'énergie, €), `dpe_date` (facultatif)
- `equipment` (texte court : parking, cave, balcon…), `recent_works` (travaux récents, texte), `description` (200 à 1 500 caractères, coordonnées masquées comme aujourd'hui)

### 3.2 La location
- `lease_type` ∈ `LEASE_TYPE_IDS`
- `rent_monthly` (loyer mensuel hors charges, €, **obligatoire et > 0** : c'est un bien loué) ; `charges_monthly` (provisions sur charges récupérables, €/mois)
- `lease_start` (date de prise d'effet du bail en cours, AAAA-MM-JJ), `lease_end` (prochaine échéance, facultatif), `tenant_since` (entrée du locataire, facultatif)
- `deposit` (dépôt de garantie, €) — transféré à l'acquéreur à l'acte
- `indexation` ∈ {`irl`, `ilc`, `ilat`, `aucune`} (facultatif), `last_revision` (date, facultatif)
- `tenant_payment_status` ∈ `TENANT_PAYMENT_STATUS_IDS` (déclaratif, 12 derniers mois), `has_gli` (garantie loyers impayés, bool), `has_guarantor` (caution, bool)
- `property_tax` (taxe foncière annuelle, €), `non_recoverable_charges` (charges annuelles non récupérables : copropriété, assurance PNO, gestion, €), `management` ∈ {`direct`, `agence`, `exploitant`} (facultatif)
- Résidence gérée : `operator_lease_end` (fin du bail commercial de l'exploitant, facultatif)

### 3.3 La vente
- `asking_price` (prix de vente, €, honoraires à la charge du vendeur ; **obligatoire et > 0**)
- `sale_object` ∈ `SALE_OBJECT_IDS` (`parts` seulement si `owner_type` ∈ {`sci`, `societe`})
- `sale_reason` ∈ `SALE_REASON_IDS`, `availability_note` (texte court facultatif : « signature possible à partir de… »)
- `auto_accept_dataroom` (bool, comme aujourd'hui)
- Mandat : `mandant_address` `{line1, line2?, postal_code, city}`, `mandant_capacity` ∈ {`proprietaire`, `coindivisaire`, `gerant`, `mandataire`}

### 3.4 Calculés par le serveur (jamais saisis)
- `title` = `taxonomy.property_title(property_type, city, department, surface, rooms, units_count)`
- `gross_yield`, `net_yield` (= `taxonomy.gross_yield`, `taxonomy.net_yield(rent, price, property_tax, non_recoverable_charges)`) recalculés à chaque écriture
- `dpe_rental` = `taxonomy.dpe_rental_status(dpe_class, lease_type)`
- `ownership` `{status: 'missing'|'pending'|'verified'|'rejected', doc_type, uploaded_at, reviewed_at, note}`
- `property_checks` `{siren_active, gerant_match, ownership_verified, dpe_rental_status, opendata_available}`
- `moderation`, `status` (`draft`, `mandat_en_attente`, `published`, `paused`, `withdrawn`, `sold`, `sold_elsewhere`, `removed`), `published_at`, `presented_buyers`, `views`, `favorites_count`, `is_test`… comme aujourd'hui.

### 3.5 Visibilité
- **Public** (cartes, fiche, `GET /properties`, `GET /properties/{id}`) : tout sauf les champs confidentiels.
- **Confidentiels** (vendeur et admin ; acquéreur seulement après l'engagement de confidentialité signé) : `address`, `company_name`, `siret`, `seller_id`, nom du vendeur, `mandant_address`, `mandant_capacity`, documents.
- `NDA_REVEALED_PROPERTY_FIELDS` = (`address`, `company_name`, `siret`).
- Les textes libres passent par le masquage de coordonnées existant (`mask_contacts`).

## 4. Profil acquéreur

`buyer_profile` : `{project_type ∈ BUYER_PROJECT_TYPE_IDS, budget_max, apport, financing ∈ FINANCING_TYPE_IDS, zones: [région], property_types: [ids], min_yield (rendement brut minimum visé, %, 0-20), horizon ∈ {'0-6','6-12','12+'}, siren?, company_name?, experience?}`.

`profile_score` (0-100) : `project_type` 15, `budget_max` 15, `apport` 10, `financing` 10, `zones` 10, `property_types` 10, `min_yield` 10, `horizon` 10, téléphone valide 10. `siren_verified` reste un badge (« société vérifiée »), sans points. Seuils inchangés : contact ≥ 40, acceptation automatique ≥ 50. Même barème dans `frontend/src/components/account/profileScore.js`.

Carte acquéreur (`buyer_card`, vue par le vendeur avant révélation) : `{label: 'Acquéreur n°123456', project_type, budget_max, apport, financing, zones, property_types, min_yield, horizon, siren_verified, profile_score, name? (après engagement), company_name? (après engagement)}`.

Inscription vendeur : prénom, nom, e-mail, mot de passe, téléphone (plus de SIRET à l'inscription : il est demandé dans l'annonce si le bien appartient à une société).

## 5. Parcours

### 5.1 Pages publiques
- `/` **Biens loués à vendre** : en-tête sobre (H1, une phrase « Investissements locatifs vendus par leurs propriétaires. Vendeurs vérifiés, dossier complet, honoraires payés par le vendeur à la signature chez le notaire. », compteur seulement s'il est ≥ 3) ; encart « Comment ça marche » en 3 étapes repliable ; filtres : type de bien (cases), type de bail, région puis département, prix maximum, rendement brut minimum, surface minimum ; tri : récentes, prix croissant, prix décroissant, rendement décroissant. URL : `?type=appartement,maison&bail=habitation-vide&region=…&departement=69&prix_max=…&rendement_min=5&surface_min=20&tri=rendement_desc&page=2`. Pagination 24, `X-Total-Count`. Alerte sans compte en bas de liste et dans l'état vide. Encart vendeur « Vous vendez un bien loué ? Déposez votre annonce » → `/vendre`.
- **Carte d'annonce** (`ListingCard`) : photo (sinon pictogramme du type), titre généré, ville · département, loyer mensuel HC, **rendement brut** mis en avant (et net s'il est calculable), prix (« honoraires inclus, à la charge du vendeur »), puces type de bail, DPE (pastille colorée A-G), badge vert « Propriétaire vérifié » (seulement si `ownership.status == 'verified'`), « Locataire en place depuis {année} », date relative, favori. Toute la carte mène à `/annonce/:id`.
- **Fiche** `/annonce/:id` : galerie ; chiffres clés (prix, loyer HC, charges, rendement brut et net, taxe foncière, charges non récupérables, dépôt de garantie) ; le bien (type, surface, pièces, étage, ascenseur, année, équipements, travaux, copropriété avec les mentions obligatoires) ; la location (bail, début, échéance, indexation, situation déclarée du locataire, GLI, caution) ; DPE (classes, coût énergétique, **alerte de décence énergétique** si `dpe_rental.status` est `interdit` ou `echeance`, texte : « Logement classé G : depuis le 1ᵉʳ janvier 2025 il ne peut plus faire l'objet d'un nouveau bail ni d'un renouvellement. Le bail en cours continue jusqu'à son terme. ») ; « Ce que vérifie VenteLoc » ; « Comment ça se passe » (contact gratuit → dossier après engagement et identité vérifiée → offre d'achat signée en ligne → compromis et acte chez le notaire) ; honoraires (`commission_info`) ; CTA « Présenter mon projet au vendeur ». Visites : « Après l'engagement de confidentialité, organisées par le vendeur avec l'accord du locataire (2 heures maximum par jour ouvrable, art. 4 de la loi du 6 juillet 1989). »
- `/vendre` (nouvelle, page « vendeur » dans l'application) : pourquoi vendre loué (pas de vacance, prix fondé sur le rendement, pas de congé à donner), ce que fait VenteLoc (vérifications, investisseurs qualifiés, dossier, offres signées, suivi jusqu'au notaire), ce que vous ne payez pas (rien avant l'acte ; `COMMISSION` TTC puis HT, calculateur), sécurité (carte T, identité vérifiée, engagement de non-contournement, dossier filigrané), FAQ (5 : le locataire doit-il être prévenu ? puis-je vendre avec un DPE F/G ? qui paie les honoraires ? et si je trouve un acquéreur moi-même ? le dépôt de garantie ?), CTA « Estimer mon bien » → `/estimer` et « Déposer mon annonce » → `/register?role=seller` (ou `/seller/create` si vendeur connecté).
- `/estimer` : estimateur par le rendement (§6.1), sans compte, CTA « Déposer mon annonce » qui préremplit le formulaire (sessionStorage).
- `/embed/annonces` (WordPress), légales `/mentions-legales`, `/confidentialite`, `/cgu`, `/signaler`, `/login`, `/register`, mot de passe oublié, `/confirmer-email/:token`, `/suivi/:token`, `/test`, 404 : conservés et adaptés.
- **Supprimés** : `/president/:token`, toutes les redirections héritées de CessionRGE (`/entreprises-…`, `/vendre-mon-entreprise-…`, `/company/:id`…), côté client **et** dans `frontend/nginx.conf` (nouveau domaine, aucun ancien lien à préserver).

### 5.2 Parcours vendeur
1. Inscription (ou `/estimer` puis inscription).
2. Création d'annonce en **3 écrans** (`CreateListing`), brouillon serveur à chaque écran : (1) **Le bien** : type, propriétaire (nom propre / indivision / SCI / société + dénomination et SIRET si société), adresse (confidentielle, expliqué), code postal → ville (liste) et département, quartier, surface, pièces, étage, ascenseur, année, lots (immeuble), copropriété (+ mentions), DPE (+ GES, coûts) ; (2) **La location** : type de bail, loyer HC, charges, dates, dépôt de garantie, indexation, situation du locataire, GLI, caution, taxe foncière, charges non récupérables, gestion ; rendement affiché en direct ; rappel : « Ne saisissez aucun nom ni coordonnée du locataire. » ; (3) **La vente** : prix (rendements recalculés en direct, alerte si le rendement brut sort de 2 %-15 %), objet (bien / parts), motif, description, équipements, travaux, photos, aperçu de la carte publique.
3. **Justificatif de propriété** (`POST /properties/{id}/ownership-proof`, PDF/JPG/PNG/WebP ≤ taille max actuelle) : type ∈ {`titre-propriete`, `attestation-notariee`, `taxe-fonciere`, `statuts-kbis`} ; stocké hors data room, visible du vendeur et de l'admin seulement ; statut `pending` ; l'admin valide ou refuse avec motif (`PUT /admin/properties/{id}/ownership {status: 'verified'|'rejected', note}`), e-mail au vendeur.
4. Identité (Stripe Identity ; mode test : simulation) → **mandat** (adresse postale, qualité du signataire, objet repris, résumé en 5 lignes, texte dépliable, case en fin de défilement, code e-mail) → **publication automatique** si les contrôles passent (§5.4) → confirmation.
5. Espace vendeur : « À traiter » (demandes de dossier, messages, offres, mandat à signer, justificatif refusé), cartes d'annonce, actions Pause / Retirer / Vendu via la plateforme / Vendu autrement (rappel de la clause de suite), Résilier (préavis 15 j ; rétractation si < 14 j), Prolonger, acquéreurs présentés, messagerie, dossier du bien (catégories §6.3, avertissement données du locataire), offres, étape de vente.

### 5.3 Parcours acquéreur
Inchangé dans sa mécanique (CessionRGE §4.3) : recherche, alerte sans compte (`{email, property_types, regions, max_price, min_yield}`), fiche, contact (e-mail confirmé, score ≥ 40, conversation par couple), demande de dossier (acceptation en un geste ou automatique, relances J+2/J+5, expiration J+10), puis **checklist** : identité vérifiée → **engagement de confidentialité et de non-contournement** signé par code → déclaration d'origine des fonds (`source` ∈ {`fonds-propres`, `emprunt`, `mixte`, `investisseurs`}) → accès au dossier, adresse et identité révélées, acquéreur ajouté à `presented_buyers` → **fiche de reprise du bail** (§6.2) → **offre d'achat** (§7.3) → acceptation → étape de vente (§7.4). Tableau de bord « Mes dossiers » (contacté, dossier demandé, engagement, dossier, offre, vente), alertes, favoris.

### 5.4 Publication automatique et modération
`submit_listing()` publie sans humain si : e-mail confirmé, identité vérifiée, mandat `signed`, `property_type`, `city` et `postal_code`, `lease_type`, `rent_monthly > 0`, `lease_start`, `asking_price > 0`, `dpe_class` renseigné (`non-soumis` accepté pour local commercial, bureaux, parking, autre ; pour un logement il faut une classe A-G ou `vierge`), surface > 0 (sauf parking), **justificatif de propriété déposé** (`ownership.status` ∈ {`pending`, `verified`}), et, pour une société, SIRET renseigné et société non cessée (open data indisponible → publié avec drapeau). Libellés des motifs bloquants en français (dictionnaire `LISTING_BLOCKING_LABELS`).
Drapeaux (`property_checks`, non bloquants, lignes « À faire » admin pendant 48 h) : justificatif à contrôler (`ownership.status == 'pending'`), gérant non concordant (société), décence énergétique `interdit`, impayés déclarés, doublon probable (même adresse normalisée + code postal publiée par un autre compte), open data indisponible. L'admin peut **retirer** avec motif (liste + texte) comme aujourd'hui ; motifs adaptés (`justificatif`, `informations-inexactes`, `doublon`, `bien-non-loue`, `contenu-interdit`, `autre`).

## 6. Modules métier

### 6.1 Estimateur (`backend/estimator.py`, réécrit) — `POST /estimates`
Entrée : `{property_type, lease_type, department, surface?, rent_monthly, charges_monthly?, property_tax?, non_recoverable_charges?, asking_price?, email?, consent?}`. Méthode du rendement, sans appel externe :
- loyer net annuel = `rent_monthly × 12 − property_tax − non_recoverable_charges` (si la taxe foncière n'est pas saisie : estimation d'un mois de loyer ; charges non récupérables non saisies : 5 % des loyers) ;
- fourchette de **rendement net** attendu par un acquéreur selon la zone et le type : zone 1 (Paris 75) 2,5 %-3,5 % ; zone 2 (92, 93, 94 et départements des grandes métropoles : 06, 13, 31, 33, 34, 35, 44, 59, 67, 69, 74) 3,5 %-5 % ; zone 3 (autres) 5 %-7,5 % ; majoration +1,5 point pour local commercial et bureaux, +1 point pour parking, +0,5 pour résidence gérée ; DPE F ou G d'un logement : +1 point (risque de travaux) ;
- valeur basse = loyer net / rendement haut ; valeur haute = loyer net / rendement bas ; `mid` = moyenne ; arrondis au millier ;
- sortie : `{low, high, mid, method, drivers: [{label, effect}], pedagogy: [string], yields: {gross_at_mid, net_at_mid, gross_at_price?, net_at_price?}, disclaimer}` ; pédagogie : ce qui fait monter le prix (bail récent et loyer au marché, locataire stable sans incident, GLI, DPE A-D, charges maîtrisées, dossier complet) ; avertissement : estimation indicative, pas un avis de valeur ;
- capture e-mail facultative avec double opt-in comme aujourd'hui ; aucune donnée nominative sans consentement.
Supprimés : toute la partie SIRET/ADEME de l'estimateur et la route `GET /estimates/company/{siret}`.

### 6.2 Fiche de reprise du bail (`backend/bail.py`, remplace `transmissibility.py`)
`GET /lease-transfer/rules?lease_type=&property_type=&sale_object=` (public, sans données du bien) et `GET /properties/{id}/lease-transfer` (après accès au dossier, avec les données du bien) → `{lease_type, regime, points: [{key, title, text, level: 'info'|'attention'}], dpe: {status, date, text}?, summary: [string], disclaimer}`. Contenu (constantes françaises dans `bail.py`, phrases courtes, références légales) :
- **le bail continue** : l'acquéreur devient bailleur, le locataire ne peut pas être expulsé du fait de la vente (art. 1743 C. civ.) ;
- **dépôt de garantie** : bail d'habitation : le nouveau bailleur doit le restituer au départ du locataire, la somme est réglée entre vendeur et acquéreur à l'acte (art. 22 loi 1989) ; bail commercial : selon le bail, à prévoir dans l'acte ;
- **prorata** des loyers, des charges et de la taxe foncière à la date de l'acte ; régularisation annuelle des charges à organiser ;
- **révision** : indice du bail (IRL, ILC, ILAT), date anniversaire ; gel des loyers des logements F et G (loi Climat et résilience, depuis le 24 août 2022) ;
- **congé** : un logement acquis occupé ne peut être repris par l'acquéreur pour y habiter qu'au terme du bail et au plus tôt deux ans après l'achat ; congé pour vendre seulement au terme du premier renouvellement du bail en cours (art. 15 loi 1989) ; locataire âgé et aux ressources modestes : protections particulières ;
- **bail commercial** : droit de préférence du locataire en cas de vente du local (art. L145-46-1 C. com.), à purger par le notaire sauf exceptions (vente globale d'un immeuble à plusieurs locaux, vente au conjoint ou à un parent…) ; durée 3-6-9, indemnité d'éviction en cas de refus de renouvellement ;
- **résidence gérée** : bail commercial avec l'exploitant, à reprendre en l'état ; vérifier la solidité de l'exploitant et l'échéance du bail ;
- **vente de parts** : la société reste propriétaire et bailleresse, aucun changement pour le locataire ; garantie de passif à négocier ;
- **décence énergétique** (logement) : calendrier G 2025, F 2028, E 2034, le bail en cours continue, travaux à prévoir avant tout nouveau bail ou renouvellement ;
- disclaimer : information générale, le notaire vérifie et rédige.

### 6.3 Dossier du bien (data room)
Catégories (`DATAROOM_CATEGORIES`, ids) : `bail` (bail et avenants), `etats-des-lieux`, `loyers` (relevé des loyers 12 derniers mois, quittances), `diagnostics` (DPE et dossier de diagnostic technique), `taxe-fonciere`, `copropriete` (règlement, PV des 3 dernières AG, fiche synthétique, appels de charges, carnet d'entretien), `titre-propriete`, `assurances` (PNO, GLI), `travaux` (factures, garanties), `societe` (statuts, bilans, en cas de vente de parts), `autres`. Avertissement à l'envoi : « Masquez le nom, les coordonnées et les pièces d'identité du locataire : l'acquéreur n'en a pas besoin avant l'acte. »
Visionneuse, filigrane, journal d'accès : inchangés.

### 6.4 Supprimés
`veille.py` (BODACC) et ses tâches/onglet admin/tests ; `transmissibility.py` ; routes `/rge/*`, ADEME, NAF ; vérification du dirigeant et invitation du président (`/company/{siren}/…`, `/listings/{id}/invite-president`, `/president/*`, page `PresidentAcceptPage`, collection `president_invitations`) ; demande d'informations commerciales (`/buyer/request-commercial-info`, `/seller/share-commercial-info/*`, `/buyer/commercial-info/*`) ; migrations CessionRGE (`migrations/refonte_2026_10.py`, `migrations/mandate_backfill.py` et leurs tests ; `purge_test_data.py` reste). `opendata.py` ne garde que `lookup_siren`, `match_dirigeant` (gérant de SCI) et l'utilitaire de requête ; le BODACC et l'ADEME disparaissent.

## 7. Contrats et argent

### 7.1 Barème (`business_model.py`, `frontend/src/lib/offer.js`, `GET /config`)
`calculate_commission(price)` : `price × COMMISSION_RATE_PERCENT/100`, `max(…, COMMISSION_MIN_HT)`, TVA 20 % → `{mode:'simple', rate_percent, rate_percent_ttc, final_commission_ht, vat, final_commission_ttc, applied_minimum, payer:'vendeur'}`. Texte (`commission_scale_text`) : « 3,6 % TTC du prix de vente (3 % HT), minimum 3 600 € TTC (3 000 € HT), à la charge du vendeur, dus uniquement à la signature de l'acte authentique et réglés par le notaire sur le prix. Rien avant. Rien pour l'acquéreur. » (chiffres issus des variables). `commission_info_for(property)` → `{payer:'vendeur', rate_percent_ttc, rate_percent_ht, estimate_ht, estimate_ttc, minimum_ht, minimum_ttc, terms_version:'v1'}`. `/config` expose `commission: {rate_percent_ht, rate_percent_ttc, minimum_ht, minimum_ttc, vat_rate}` ; le front calcule avec ces valeurs (repli : 3 / 3 000). `REACT_APP_COMMISSION_MIN_HT` et `REACT_APP_COMMISSION_RATE_PERCENT` pour le pré-rendu.

### 7.2 Mandat de vente simple — bien loué (`DEFAULT_MANDAT_TEMPLATE`, `terms_version` `v1`)
Texte complet, sans blanc ni case, toutes variables renseignées (sinon 400 `{code:'validation', missing}` comme aujourd'hui). Articles :
1. **Parties** : AlterEgo SAS (identité complète, carte T, CCI, RC pro, « ne doit recevoir ni détenir d'autres fonds… ») ; le Mandant : nom, prénom, e-mail, adresse postale, agissant en qualité de {propriétaire / co-indivisaire déclarant agir avec l'accord de tous les indivisaires / gérant de la société {dénomination} (SIREN, siège) / mandataire du propriétaire}. Déclaration : qualité et pouvoir pour vendre.
2. **Bien** : désignation ({titre généré}, adresse complète, code postal, ville), copropriété (lots), **bien vendu occupé** : bail {type}, loyer {loyer HC}, depuis le {date}, dépôt de garantie {montant}. Le Mandant déclare qu'aucun congé n'a été délivré ni reçu, qu'il n'a connaissance d'aucun litige avec le locataire autre que ceux déclarés, et que le locataire sera informé des visites, organisées par le Mandant avec l'accord du locataire.
3. **Objet** : rechercher un acquéreur pour {la vente du bien / la cession des parts de la société propriétaire / la vente du bien ou des parts}, au prix demandé de {prix} (honoraires inclus, à la charge du Mandant) ; le Mandant reste libre d'accepter ou de refuser toute offre.
4. **Mandat simple, non exclusif** (mêmes phrases que CessionRGE : liberté de vendre seul ou par d'autres intermédiaires, rien n'est dû pour un acquéreur non présenté).
5. **Durée** : 12 mois, prolongeable par périodes de 12 mois par nouvelle signature en ligne ; dénonciation à tout moment, préavis 15 jours, dans l'espace en ligne ou par e-mail ; caducité si l'annonce est retirée par la modération.
6. **Rétractation** : si le Mandant agit en tant que consommateur, il dispose de 14 jours à compter de la signature pour se rétracter sans motif (art. L221-18 C. conso.), par le bouton « Résilier » de son espace (effet immédiat dans ce délai) ou par e-mail ; formulaire type de rétractation reproduit en annexe ; le Mandant demande expressément que la diffusion commence dès la signature (art. L221-25) ; aucune somme n'est due en cas de rétractation.
7. **Mission** : annonce (sans adresse exacte), contrôle du justificatif de propriété, qualification des acquéreurs (profil, e-mail confirmé, identité vérifiée, origine des fonds déclarée) avant toute révélation de l'adresse et de l'identité du Mandant, engagement de confidentialité et de non-contournement, messagerie, dossier du bien, offres d'achat signées, information du Mandant, liste nominative des acquéreurs présentés, transmission au notaire. **Le Mandataire ne négocie pas, ne rédige pas l'avant-contrat ni l'acte et ne donne pas de conseil juridique, fiscal ou financier ; il ne fait pas visiter le bien.**
8. **Obligations du Mandant** : informations exactes (bail, loyers, charges, DPE, copropriété, situation du locataire), dossier de diagnostic technique à jour au plus tard à l'avant-contrat, informer de toute vente ou promesse, informer le Mandataire de toute négociation directe avec un acquéreur présenté.
9. **Rémunération** : barème §7.1, à la charge du Mandant, due uniquement si la vente (ou la cession de parts) est conclue avec un acquéreur **nommément présenté** (inscrit sur la liste : signataire de l'engagement de confidentialité relatif au bien), y compris par une personne ou société interposée ; exigible à la signature de l'**acte authentique** ; le Mandant donne **ordre irrévocable au notaire** de prélever la rémunération sur le prix et de la verser au Mandataire, et s'engage à faire mentionner la rémunération et le Mandataire dans l'avant-contrat et l'acte. Aucune somme n'est versée avant (art. 6 loi n° 70-9).
10. **Clause de suite** : rémunération due si la vente est conclue dans les **12 mois** suivant la fin du mandat avec un acquéreur présenté ; liste communiquée en fin de mandat.
11. **Registre** n° {REGISTRE}, **signature électronique** (code e-mail, dossier de preuve 10 ans, art. 1366-1367 C. civ.), **données personnelles**, **médiateur** (si défini), droit applicable, tribunal compétent (sous réserve des règles protectrices du consommateur).
Contre-signature automatique d'AlterEgo, PDF envoyé par e-mail, registre, dénonciation, renouvellement, rétractation : mécanique existante. Données du contrat : `ends_at` = +12 mois, `tail_ends_at` = `ends_at` + 12 mois, `withdrawal_ends_at` = signature + 14 jours ; dénonciation avant `withdrawal_ends_at` → `status: 'withdrawn_retractation'` (libellé « rétractation »), effet immédiat, annonce dépubliée.

### 7.3 Engagement de confidentialité et de non-contournement (v1) et offre d'achat
- **Engagement** (remplace le NDA, même mécanique, signé par l'acquéreur à identité vérifiée avec AlterEgo pour le compte du vendeur, désigné par le titre de l'annonce jusqu'à la signature) : informations couvertes (adresse, identité du vendeur, documents, données du locataire), durée 24 mois, usage limité à l'étude de l'acquisition, **interdiction de contacter le locataire, le syndic, l'exploitant ou de se rendre dans le bien sans l'accord du vendeur**, **non-contournement** : ne pas acquérir le bien (ou les parts), directement ou par personne interposée, en dehors de la plateforme sans en informer le vendeur et AlterEgo (pas de pénalité chiffrée ; responsabilité de droit commun), données personnelles du locataire traitées uniquement pour l'étude et supprimées en cas de non-acquisition, déclaration d'origine des fonds avant l'accès au dossier, signature par code, dossier de preuve. Variables révélées après signature : adresse, vendeur, société.
- **Offre d'achat** (remplace l'offre indicative ; `/offers` conservé) : `{property_id, amount, sale_object: 'bien'|'parts', financing: {equity, loan}, loan_condition: {required: bool, amount?, max_rate?, duration_years?}, conditions: [string], target_date (date souhaitée pour l'avant-contrat), validity_days (5-30), message?}`. Texte : l'offre, même acceptée, **n'emporte pas vente** : elle engage les parties à négocier de bonne foi un avant-contrat (promesse ou compromis) chez le notaire, qui fixera toutes les conditions ; condition suspensive d'obtention de prêt si demandée (art. L313-40 C. conso.) ; rappel du délai de rétractation de 10 jours de l'acquéreur non professionnel d'un logement à compter de l'avant-contrat (art. L271-1 CCH) ; aucune somme versée à AlterEgo ni au vendeur à ce stade. Signature acquéreur par code, contre-signature vendeur à l'acceptation, refus motivé, contre-proposition : mécanique existante.

### 7.4 Étape de vente, facture (`closing.py`)
Mécanique inchangée, vocabulaire adapté : rédacteur → **notaire** (`redacteur.type` ∈ {`notaire`, `autre`}, libellé « Notaire en charge de la vente ») ; jalons ajoutés : `avant_contrat_on` (date de signature du compromis ou de la promesse, déclarée par l'une des parties, facultatif) ; la **vente déclarée** = acte authentique signé (`signed_on`, `final_price`, `sale_object` ∈ {`bien`, `parts`}). Facture : « Honoraires de négociation — mandat n° … — vente de {titre} » ; échéance : acte + 30 jours (et au moins facture + 15 j) quel que soit l'objet ; ordre de paiement adressé au notaire. Relances et avoirs inchangés.

## 8. E-mails
Tous les gabarits (`business_model.EMAIL_TEMPLATES`, `emails_parcours.py`, `emails_contrats.py`, `closing.py`) sont relus et réécrits avec le vocabulaire §1 et `SITE_NAME`. Même liste d'événements que CessionRGE, plus : justificatif de propriété reçu / validé / refusé (vendeur), justificatif à contrôler (ligne « À faire », pas d'e-mail admin immédiat), rétractation du mandat (vendeur + admin). Pied de page légal inchangé (carte T, « ne doit recevoir ni détenir… »).

## 9. Admin
Onglets inchangés (« À faire », Annonces, Utilisateurs, Mandats, Factures, Ventes, Métriques, Incidents si encore utilisé). Ajouts : section « Justificatifs de propriété à contrôler » dans « À faire » (aperçu du fichier, Valider / Refuser avec motif) ; colonne « Justificatif » dans Annonces. Retraits : veille BODACC, invitations de président. KPI : les intitulés passent au vocabulaire §1 ; `bodacc_incidents` supprimé, `ownership_pending` ajouté.

## 10. Mode test
Voir `docs/venteloc/MODE-TEST.md`, avec : personas `vendeur`, `acquereur`, `admin` (comptes `vendeur.demo@test.local`, `acquereur.demo@test.local`, `admin.demo@test.local`) ; `POST /test/seed` crée **8 annonces publiées réalistes** appartenant au vendeur démo, justificatif `verified`, mandats de test signés, photos absentes (pictogrammes) : studio meublé Lyon 7ᵉ (≈ 145 k€, 620 €/mois), T2 vide Lille (≈ 128 k€, 640 €), T3 vide Bordeaux (≈ 265 k€, 1 050 €, DPE D), maison T4 Nantes (≈ 310 k€, 1 250 €), immeuble de 5 lots Saint-Étienne (≈ 390 k€, 2 950 €), local commercial Rennes (≈ 240 k€, 1 600 €, bail commercial), parking Paris 15ᵉ (≈ 32 k€, 140 €), lot en résidence étudiante Toulouse (≈ 98 k€, 430 €) ; un logement DPE F avec l'alerte d'échéance ; descriptions crédibles sans nom de locataire.

## 11. Marque et design
- `frontend/src/lib/brand.js` : `BRAND = {name: 'VenteLoc', legalName: 'AlterEgo SAS', siteUrl: 'https://venteloc.fr', tagline: 'Biens loués à vendre, de propriétaire à investisseur', contactEmail}` (plus de `verticalName`). Back : `site_name()` défaut `VenteLoc`, `sender_email()` défaut `contact@venteloc.fr`.
- Logo : pictogramme maison + clé (SVG inline), « Vente**Loc** » (partie finale colorée par `splitBrandName`). Favicons et `og-image` régénérés (SVG → PNG au build ou fichiers simples) : maison stylisée, couleurs de la marque.
- Palette : navy `#0b1220` (texte), surface `#f5f7fa`, bordures `#e3e7ee`, **action `#0f766e`** (teal 700 ; survol `#115e59`), **vert `#15803d` réservé aux badges de vérification**, ambre `#b45309` pour les alertes (DPE, impayés), pastilles DPE aux couleurs réglementaires (A `#009c6d`, B `#52b153`, C `#a5cc74`, D `#f4e70f`, E `#f0b40f`, F `#eb8235`, G `#d7221f`). Typographie, accessibilité, mobile : règles CessionRGE inchangées (Manrope/Inter auto-hébergées, rien d'engageant sous 13 px, chiffres tabulaires, focus visible, pas de débordement mobile).
- SEO : titres et descriptions « biens loués à vendre », « investissement locatif », « vente d'appartement loué » ; JSON-LD `Organization` (carte T) et `ItemList` ; sitemap : routes statiques + `/annonce/{id}`.

## 12. Technique
- Base Mongo : `DB_NAME` défaut `venteloc_prod` ; alias réseau du backend `venteloc-api` (nginx) ; réseau compose `venteloc-network`.
- Tests : chaque règle de ce document a un test (backend pytest + front jest). Les tests hérités sont adaptés ou supprimés avec leur fonctionnalité ; aucun test désactivé pour « faire passer ».
- Commandes : `cd backend && pytest -q` (venv Python 3.11) ; `cd frontend && CI=true npx craco test --watchAll=false && npm run lint`.
