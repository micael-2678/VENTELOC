# CessionRGE — Rapport final pour Micael

**Date** : 9 octobre 2026 (version 2, corrigée après relecture) · **Pour** : Micael, AlterEgo SAS (carte T, CCI Paris IdF) · **Objet** : revue complète (ergonomie, design, accueil, modèle économique, légal, technique) avant de coder.
**Base** : 6 audits (`audit/ux-vendeur.md`, `ux-acheteur.md`, `accueil-design.md`, `business-model.md`, `tech-couts.md`, `autonomie-admin.md`), 4 études (`marche-concurrence.md`, `marche-rge.md`, `cadre-legal.md`, `playbooks.md`) et 3 plans concurrents (`plan-cash.md`, `plan-liquidite.md`, `plan-produit.md`). Dossier : `docs/revue-2026-10/` (noté `audit/` ci-dessous). Les captures citées sont dans `audit/ux-vendeur/`, `audit/ux-acheteur/`, `audit/accueil-design/`, `audit/autonomie-admin/`.

Ce rapport tranche. Quand les trois plans divergent, je dis ce que je retiens et pourquoi ; chaque décision a une valeur par défaut, aucune n'est renvoyée « au fondateur » ou « au conseil » sans que ce rapport dise ce qu'il ferait. Les points de droit restent à faire relire une fois par le conseil d'AlterEgo ; aucune recommandation ne repose sur une lecture audacieuse de la loi Hoguet.

**Ce que cette version corrige par rapport à la première** (pour que vous ne retrouviez pas d'anciennes affirmations ailleurs) : la lecture de l'art. 78 du décret de 1972 (un mandat simple avec clause de suite n'y est pas soumis ; j'affirmais l'inverse, à tort), la mécanique d'encaissement (titres et fonds de commerce sont distingués ; sur un fonds, le prix est légalement indisponible plusieurs mois), Stripe Invoicing (rétabli : je l'avais écarté sur une affirmation non sourcée), l'arithmétique du plancher, la chronologie des revenus à 12 mois, la taille du segment e-mailing (non vérifiée : à compter, pas à estimer), la charge de développement et le temps fondateur (consolidés), le budget avocat, la trésorerie personnelle, et la référence à des « juges » dont aucun verdict n'existe dans le dossier (supprimée).

---

## 1. Verdict en dix lignes

1. **Le marché existe, mais il est petit et lent.** ≈ 60 400 entreprises RGE (ADEME, juillet 2026, https://www.data.gouv.fr/reuses/combien-dartisans-rge-en-france-chiffres-2026-par-domaine-de-travaux-et-organisme), en érosion depuis 2022 ; 1 200-1 800 changements de mains par an toutes formes, dont **300-500 réellement adressables par une place de marché** (`audit/marche-rge.md` §10). Prix médian des fonds artisanaux : 84 950 € (ISM-MAAF 2024) ; prix moyen des cessions de fonds « construction » : 178 k€ (Altares 2025, **lecture de tableau à confirmer dans le PDF**, `audit/marche-rge.md` §13). Cycle : 12-18 mois. C'est un marché pour une activité rentable d'une personne, pas une scale-up.
2. **Le modèle actuel ne peut pas vivre seul.** Il demande au cédant l'engagement d'un cabinet (mandat exclusif 12 mois, 10 % HT affiché « 33 600 € TTC » avant d'avoir vu un repreneur) sans le service d'un cabinet, et **le seul événement qui rapporte un euro (le closing) n'a ni écran, ni facture envoyée, ni relance, ni veille** (`backend/server.py:3854-3923`, facture `a_valider` jamais traitée ; `grep closing frontend/src` : vide).
3. **Le mandat signé aujourd'hui est annulable** (mandat exclusif sans la mention de l'art. 78 du décret de 1972, objet non coché, dénomination et adresse parfois vides, pas de contre-signature, obligations que la FAQ nie). Un cédant qui ne veut pas payer gagnera.
4. **Ce qui bloque vraiment** n'est ni le design (propre) ni les coûts (4-7 k€/an aujourd'hui), mais l'ordre des étapes : le côté rare (cédant) supporte toute la friction, le côté liquide (repreneur) est filtré trois fois (KYC avant le premier message, validation à l'aveugle, LOI au prix demandé pour voir des bilans), et rien ne transforme un contact en vente ni une vente en encaissement.
5. **La loi Hoguet ferme toute monétisation amont** sur une affaire sous mandat (art. 6 I : 2 ans / 30 000 € et nullité). Abonnement repreneur, annonce premium, crédits, dossier payant : non, et pas de structure à deux entités pour un fondateur sans juriste.
6. **Trois bombes techniques** à désamorcer cette semaine : clé Stripe live, clé Brevo et mot de passe Mongo dans l'historique Git ; `stripe.error` inexistant en stripe 13 (toute erreur KYC = 500) ; aucune sauvegarde Mongo alors que le registre des mandats y vit.
7. **Le site n'existe pas pour Google**, même sur sa marque (`audit/marche-concurrence.md` §3), et le domaine canonique pointe sur `cessionrge.alteregopatrimoine.com`.
8. **Ce qui peut marcher** : mandat simple à 6 % HT, sans exclusivité, dénonçable à tout moment ; repreneur qui se présente avant de montrer son passeport ; encaissement organisé chez le rédacteur d'acte + veille BODACC/RNE ; accueil qui dit qui opère ; sourcing sur l'open data ; SEO vertical que personne ne tient.
9. **Ce qu'il faut accepter** : l'année 1 est à perte (≈ 10-14 k€ de dépenses, 0-2 k€ de revenus en médian) ; l'année 2 rapporte vraisemblablement **25-40 k€** (2-3 closings encaissés), pas 100-150 k€ ; un demi-salaire n'arrive pas avant l'année 3. Les 90 premiers jours sont un temps plein de construction (≈ 50-60 jours de développement sur 14 semaines) ; les « 5 h/semaine » du brief ne sont atteignables qu'à partir de M+10.
10. **Décision la plus importante** : fixer dès maintenant le déclencheur d'élargissement au bâtiment qualifié (si < 3 annonces publiées/mois à M+6), un critère d'arrêt en euros (§10.1, décision 13) et préparer la marque et le modèle de données pour que l'élargissement coûte 3-5 jours, pas une refonte.

---

## 2. Ce que l'audit a trouvé

Gravité : **Critique** (empêche la conversion ou détruit le revenu/la confiance) · **Majeur** (coûte des conversions, à corriger avant lancement) · **Mineur** (finition).

### 2.1 Accueil et design (`audit/accueil-design.md`)

| Gravité | Constat | Preuve |
|---|---|---|
| Critique | Hero bi-cible dominé par le formulaire de recherche repreneur ; le cédant (côté rare) n'a qu'un bouton blanc vers `/register` brut, sans rôle présélectionné | `audit/accueil-design/desktop-home-fold.png`, `mobile-home-fold.png` ; `LandingPage.jsx:421-481` |
| Critique | Aucune preuve de confiance : carte T absente de l'accueil et du pied de page (seule occurrence dans `/mentions-legales` sous un bandeau « Document à faire valider par un conseil juridique »), pas de nom, pas de visage, pas de chiffre, « Garantie financière : à compléter », « durée à préciser » ×4 sur `/confidentialite` (×5 dans `seo/content.json` selon `audit/tech-couts.md`) | `audit/accueil-design/desktop-crop-trust.png`, `desktop-mentions.png` |
| Critique | Vacuité visible : « 7 entreprises », 12 activités sur 18 et 7 régions sur 14 à « 0 », pages vides indexées | `audit/accueil-design/desktop-hub.png` ; `SeoPages.jsx:131-135` |
| Critique (bug) | Carte tarifs « Cédants » qui déborde et est tronquée sur mobile à 390/360/320 px (« Au succè », barème coupé) : la section qui doit rassurer sur l'argent, sur l'appareil des artisans | `audit/accueil-design/mobile390-pricing-viewport.png` ; `audit/ux-vendeur/04b-pricing-viewport-mobile.png` ; cause `LandingPage.jsx:590` sans `min-w-0`, `offer.js:41-43` espaces insécables |
| Majeur | La page vend un prix, pas un service : « gratuit » ×12, « commission » ×17, TTC d'abord (« 12 % TTC »), « formule de Lehman », exemples 30 000 € → 3 600 € TTC et 800 000 € → 88 800 € TTC ; le service rendu tient en une phrase anti-vente (« n'intervient pas dans la négociation ») | `audit/accueil-design/desktop-home-pricing.png` ; `seo/content.json:188` |
| Majeur | Gabarit SaaS générique (dégradé navy + halos, zéro image, vert « éco-start-up »), fiche entreprise avec en-tête différent et promesse d'un service inexistant (« Nous pouvons accompagner le futur propriétaire dans l'obtention de ces domaines RGE ») | `audit/accueil-design/desktop-company.png` ; `CompanyDetail.jsx:555-578` |
| Majeur | Pages d'atterrissage secondaires : `/vendre-mon-entreprise-rge` = 1 275 mots sans aucun visuel ni preuve entre le hero et le pied de page, CTA vers `/register` générique ; `/reprendre-une-entreprise-rge` promet « Créer une alerte » et renvoie vers un compte complet avec téléphone et entreprise ; « combien de temps ça prend ? » absent partout | `audit/accueil-design/desktop-vendre.png`, `desktop-reprendre.png` ; `accueil-design.md` §5 |
| Majeur | SEO : domaine canonique sur `cessionrge.alteregopatrimoine.com` (7 fichiers), fiches `/company/:id` dans le sitemap mais non pré-rendues, `/search` indexée en doublon du hub, Google Fonts externe (RGPD) | `lib/seo.js:4`, `server.py:4095-4110`, `public/index.html:22-24` |
| Mineur | Accessibilité : sélecteur « Je vends / Je reprends » en `role="tab"` sans `tablist`/`tabpanel` ; liens-cartes (`LinkGrid`, `GuideCard`) sans style de focus distinct du survol ; `text-xs` (12 px) sur la légende du barème, l'aide du formulaire et la note newsletter, c'est-à-dire sur des textes qui engagent | `LandingPage.jsx:549-557` ; `accueil-design.md` §4.6 |

**À garder** : offre centralisée dans `frontend/src/lib/offer.js` (changer de barème prend une heure), pré-rendu statique de 44 pages avec JSON-LD propre, guides de métier sérieux, système de composants cohérent, contrastes ≥ 4,5:1, aucune erreur console, analytics Plausible sans cookie, honnêteté du discours.

### 2.2 Parcours vendeur (`audit/ux-vendeur.md`)

| Gravité | Constat | Preuve |
|---|---|---|
| Critique | Messagerie : un fil par annonce, tous les acquéreurs mélangés, pas de nom d'expéditeur, **la réponse part au premier acquéreur trouvé** (vérifié : une réponse à « Claire » irait à « buyer SAS ») | `audit/ux-vendeur/54-messages-desktop.png` ; `server.py:3188-3204`, `MessagesPage.jsx:101-108, 372-385` |
| Critique | Inscription impossible si l'ADEME ne répond pas ; l'erreur réseau est affichée comme « SIRET non trouvé », bouton grisé, aucune voie de secours | `audit/ux-vendeur/06-register-seller-siret-desktop.png` ; `RegisterPage.jsx:80-85, 378` |
| Critique | Mandat exclusif 12 mois + tacite reconduction, résiliation par LRAR, signé avant toute preuve de demande, estimation « ≈ 33 600 € TTC » en gros ; annonce refusable après signature sans libérer le mandat ni donner de motif | `audit/ux-vendeur/17-mandate-page-desktop.png`, `18-mandate-payer-chosen-desktop.png`, `24-dash-rejected-mobile.png` ; `server.py:5249` (`DUREE_MANDAT_MOIS`) |
| Critique | Contrat incomplet : cases d'objet « ☐ titres / ☐ fonds » jamais cochées, « Société : » vide quand l'ADEME est en panne, adresse du mandant absente du modèle, « Représentée par » en double, prestataire e-sign fictif | `audit/ux-vendeur/mandat-texte.txt`, `19-mandate-dialog-desktop.png` ; `server.py:4835-4846, 5593` |
| Majeur | Formulaire : 13 champs obligatoires en jargon (EBITDA, marge brute, CA N-2, pipeline), aucune info-bulle, aucune sauvegarde, aucune validation (marge 250 % et dette négative acceptées), champs saisis jamais affichés (`rge_validity`, `pipeline`), champs morts | `audit/ux-vendeur/12-create-listing-empty-mobile.png` (3 307 px) ; `s2-seller-flow.log` A7/A8 |
| Majeur | Publication conditionnée à une validation humaine dès que le nom ≠ dirigeant INPI (holdings, gérants de SARL, noms composés) ; promesse « sous 48 h » ; l'e-mail `listing_received` renvoie vers deux actions qui n'existent pas dans l'espace vendeur | `server.py:1471-1516` ; `audit/autonomie-admin/email-03-recue.png` ; `ux-vendeur.md` §2.7 |
| Majeur | E-mail jamais vérifié alors qu'il porte le code qui « vaut signature » ; bandeau KYC cassé sur mobile ; page Profil qui propose un KYC manuel contredisant Stripe | `audit/ux-vendeur/10-dash-new-unverified-mobile.png`, `40-profile-desktop.png` ; `server.py:480-517` |
| Majeur | Le cédant ne peut ni retirer, ni mettre en pause, ni marquer vendue son annonce ; il peut modifier le prix d'une annonce publiée sans notification | `server.py:1839-1898`, `SellerDashboard.jsx:287-288` |
| Mineur | Dashboard sans boîte « À traiter » ; demandes d'accès d'un « Acquéreur n°898387 » sans aucun profil ; photos rendues par une icône ; « Bonjour seller SAS » ; aucun lien profond dans les e-mails | `audit/ux-vendeur/51-dash-access-tab-mobile.png` |

**À garder** : brouillon avant KYC puis soumission automatique, page mandat (pédagogie, récap, mauvais code géré, numéro de registre, PDF), pseudonymisation et masquage des coordonnées, relances J+3, onglet Accès.

### 2.3 Parcours acheteur (`audit/ux-acheteur.md`)

| Gravité | Constat | Preuve |
|---|---|---|
| Critique | KYC Stripe (≈ 1,25-1,50 € payé par la plateforme) **avant le premier message**, pour chaque curieux ; premier point d'abandon, sans revenu en face | `audit/ux-acheteur/desktop-23-kyc-wall-company.png` ; `server.py:1801-1807, 3038-3042` |
| Critique | LOI à signer **au prix demandé**, exclusivité 45 j + non-contournement 24 mois, simplement pour ouvrir la data room, avant tout bilan ; contre-signature vendeur non câblée | `audit/ux-acheteur/desktop-40-loi-dialog.png` ; `server.py:2401-2410, 5981` |
| Critique | NDA/LOI avec blancs et variables brutes : « né(e) le , demeurant , », « Doc {{DOC_ID}} », « 1350000.0 € », « fournit oui une attestation », « fourchette € – € » ; aucun exemplaire envoyé ni téléchargeable pour l'acheteur | `audit/ux-acheteur/nda-text.txt` l.10-11, 49 ; `loi-text.txt` l.8-9, 32, 68 |
| Critique | Commission à la charge de l'acquéreur affichée TTC en tête de fiche : « 141 600 € TTC » sur 1,35 M€, « 11 400 € TTC » sur 95 k€ (= 12 % du prix) : dissuasif et incitation au contact direct | `audit/ux-acheteur/desktop-09-company-payer-repreneur.png` |
| Majeur | La fiche n'aide pas à décider : titre générique « Entreprise de rénovation énergétique », « Date non renseignée » pour chaque qualification (le front lit un champ inexistant), pas de département, pas de motif de vente, bloc « Domaines complémentaires » **faux** (comparaison sur 10 caractères), champs saisis jamais affichés | `CompanyDetail.jsx:326, 329-343, 429` |
| Majeur | Validation « profil » par un cédant qui ne voit qu'un pseudonyme ; aucun profil repreneur à l'inscription ; deux champs « Nom de l'entreprise » liés au même état | `audit/ux-acheteur/desktop-20-register-buyer-form.png` ; `RegisterPage.jsx:294-341` |
| Majeur | Après contact d'une 2ᵉ annonce, la messagerie ouvre la 1ʳᵉ ; conversations nommées « Entreprise #55d48596 » ; message système « signez la LOI » alors que le NDA est requis | `audit/ux-acheteur/desktop-51-messages-after-second-contact.png` |
| Majeur | Visionneuse PDF dépendante de cdnjs : data room inutilisable derrière un proxy d'entreprise | `audit/ux-acheteur/desktop-61-dataroom-viewer.png` ; `SecurePdfViewer.jsx:7` |
| Mineur | Deux pages de recherche différentes (`/search`, `/buyer/search`), montants « 1,200,000 € », favori visiteur sans redirect, aucune vue pipeline pour l'acheteur récurrent | `CompanyDetail.jsx:160-165`, `server.py:3581` |

**À garder** : anonymat réellement tenu (vérifié), masquage des coordonnées, signature par code claire, data room filigranée avec journal, recherche publique fonctionnelle, alertes, SEO.

### 2.4 Admin et autonomie (`audit/autonomie-admin.md`)

| Gravité | Constat | Preuve |
|---|---|---|
| Critique | Le closing (100 % du revenu) n'a ni écran ni suivi ; facture `a_valider` jamais envoyée ; `GET /admin/invoices` appelé par aucun écran ; onglet Transactions sans facture | `audit/autonomie-admin/desktop-05-transactions.png` ; `server.py:3784-3923` |
| Critique | Validation humaine des annonces 1 à 3 fois par semaine ; file mélangée aux publiées ; pas de bouton « Refuser » ni de motif ; e-mail de refus « Répondez à cet email » | `audit/autonomie-admin/desktop-02-annonces.png`, `email-09-rejected.png` |
| Critique | `stripe.error` → 500 (9 traces dans `scratchpad/backend.log`) ; KYC manuel validé « à l'aveugle » sans visionneuse | `server.py:326, 414` ; `desktop-03-utilisateurs.png` |
| Majeur | Aucun double opt-in, aucune limite de débit, pas de désinscription sur les alertes ; relances existantes en un seul envoi ; aucune relance KYC repreneur, NDA, offre expirée, fin de mandat ; aucune date de fin de mandat stockée ; aucune détection de vente hors plateforme | `server.py:481-517, 6097-6200` |
| Majeur | Tableau de bord = vue base de données : 12 tuiles, tableau de 12 semaines de zéros, « KYC en attente » qui compte les non-démarrés, « 0 vues » partout (`views_count` vs `views`), « (null null) » | `audit/autonomie-admin/desktop-01-metrics.png` ; `AdminDashboard.jsx:25, 315, 413` |
| Mineur | Code et onglets superflus pour le volume : crédits/abonnements (≈ 900 lignes mortes), générateur de contrats admin, data room admin, 1 000 messages en clair, migration exposée | `business_model.py:50-82` ; `server.py:5276-5552` |

**À garder** : `claim_once` idempotent, boucle de tâches in-process, registre des mandats avec numéro continu et export CSV, métriques d'entonnoir, publication automatique quand tout est vérifié, OTP haché avec preuve, e-mails échappés et centralisés.

### 2.5 Technique et coûts (`audit/tech-couts.md`)

| Gravité | Constat | Preuve |
|---|---|---|
| Critique | Secrets de production dans l'historique Git : clé Stripe **live**, clé Brevo (commit `608c5f4`), mot de passe Mongo (`4c3eedb`, encore dans `DOKPLOY_DEPLOYMENT.md:52` en « exemple ») | `git log --all -S "sk_live_51Sct29"` |
| Critique | `stripe==13.0.1` n'a plus `stripe.error` : 6 occurrences → 500 ; sondé : `POST /api/kyc/create-verification-session` → HTTP 500 | `server.py:326, 386, 414, 3337, 3425, 3531` |
| Critique | Aucune sauvegarde MongoDB ; sans `S3_BUCKET`, fichiers en base64 dans Mongo (≈ 20 Go à 500 annonces sur un VPS de 40 Go) | `docker-compose.yml:16-17`, `storage.py:20-37` |
| Majeur | Aucune limite de débit ; bcrypt dans la boucle d'événements (25 tentatives en 7,9 s, chacune bloquant tout le serveur) ; `forgot-password` sans limite (vide le quota Brevo) | `server.py:518-579` |
| Majeur | `/api/health` répond « ok » base morte ; pas de Sentry ; CORS `*` + credentials par défaut ; aucun en-tête de sécurité nginx ; JWT 7 j non révocable ; `/docs` public (112 routes) ; code OTP dans l'objet de l'e-mail | `server.py:3232, 6083-6088, 2757` ; `nginx.conf` |
| Majeur | RGPD : « durée à préciser » ×5, aucune suppression/export de compte, pièces d'identité du KYC manuel en base64 conservées sans limite | `server.py:595-611` ; `seo/content.json` |
| Mineur | `server.py` 6 243 lignes / 112 routes ; CRA non maintenu ; source maps publiées ; **aucun test front, aucun `ErrorBoundary`** (une exception de rendu = page blanche) ; 65 % des routes non testées (Stripe, jobs, closing) ; doc de déploiement incohérente (`/api` non proxifié, port 8001 publié) | `tech-couts.md` §7 ; `.github/workflows/tests.yml`, `DOKPLOY_DEPLOYMENT.md` |

**À garder** : anonymat côté serveur testé, chaîne de preuve de signature, filigrane incrusté, abstraction de stockage S3, 47 tests en 37 s, pré-rendu sans dépendance lourde, migration idempotente.

---

## 3. Le marché et la concurrence en chiffres

### 3.1 Taille réelle (`audit/marche-rge.md`, `audit/marche-concurrence.md`)

| Indicateur | Valeur | Source et réserve |
|---|---|---|
| Entreprises RGE | 60 428 (162 207 qualifications actives), ≈ 65 000 en 2022 | https://www.data.gouv.fr/reuses/combien-dartisans-rge-en-france-chiffres-2026-par-domaine-de-travaux-et-organisme ; https://pro.hellio.com/blog/marche/baisse-entreprises-rge |
| Sociétés artisanales du BTP **employeuses** à dirigeant > 60 ans | 25 500 (5 % des entreprises artisanales du bâtiment, dont ≈ 74 % sans salarié) | ISM-MAAF via https://www.lebatimentartisanal.com/creations-dentreprises-artisanales-la-btp-defie-la-conjoncture/ ; chiffre de presse, « à vérifier dans le baromètre de décembre 2025 » (`marche-rge.md` §13) |
| Dirigeants ≥ 60 ans dans le parc RGE | ≈ 25 % (hypothèse des playbooks, non vérifiée sur la liste ADEME) | `audit/playbooks.md` §0 ; 2 artisans sur 10 > 55 ans (CMA 38), 21-25 % (CMA 74) |
| Intention de transmettre à 5 ans, construction | 32 % (vs 40 % tous secteurs) ; 30 % des porteurs de projet reportent ou annulent | https://lelab.bpifrance.fr/transmission-en-france-un-marche-de-370-000-entreprises-d-ici-2030/ |
| Cessions de fonds artisanat 2024 / prix médian | 8 360 / **84 950 €** | https://infometiers.org/les-chiffres-cles-de-la-creation-dentreprise-artisanale-barometre-de-lartisanat-2025-ism-maaf/ |
| Cessions de fonds construction 2025 / prix moyen | ≈ 1 670 / **178 212 €** | https://www.altares.com/2026/06/15/ventes-cessions-fonds-de-commerce-2025/ ; **ligne du tableau à confirmer dans le PDF** (`marche-rge.md` §13) |
| Flux RGE adressable par une place de marché | **300-500 opérations/an** (2-3 % de transmission × 50-60 % de structures employeuses × 35-45 % vendues à un tiers × 60-70 % hors réseaux fermés) | `audit/marche-rge.md` §10 |
| Multiples plomberie-chauffage | 1,5-2,5× EBE (dépendante du dirigeant) ; 3,5-5× (RGE, entretien récurrent) ; sources commerciales intéressées | https://www.riviqo.com/blog/cession-plombier-chauffagiste ; https://dealmakr.fr/ressource-dirigeants/valoriser-plomberie-chauffage/ |
| Délai de transmission d'une TPE | 12-18 mois (CRA) ; médiane US 200 jours sur des dossiers plus liquides | https://www.cra.asso.fr/etude-bpifrance-lelab-partenariat-cra.aspx ; https://www.bizbuysell.com/learning-center/article/how-long-sell-business/ |

**Conjoncture 2026-2027** : MaPrimeRénov' par geste recentrée sur la PAC au 1er septembre 2026 (décret 2026-822), PV résidentiel effondré (tarif de rachat 1,1 c€/kWh), 13 trimestres de baisse CAPEB, 1 artisan sur 5 envisage d'arrêter ; mais PAC air/eau +20 % à fin août 2026 (Uniclima), CEE 6ᵉ période > 8 Md€, et **obligation « RGE-facturant » au 1er janvier 2027** (loi 2025-594, décret 2026-774) qui crée une demande de personnes morales RGE propres… et un risque de rachat de coquilles par des fraudeurs (Anah : 21 439 dossiers frauduleux bloqués en 2025 ; aucune source ne documente encore ce rachat : hypothèse de risque, pas constat). Lecture : plus de vendeurs fatigués avec des entreprises peu transmissibles (isolation/PV mono-produit), une valeur qui monte pour les PAC/CVC multi-qualifiées avec contrats d'entretien.

**Conséquence sur le prix moyen** : les trois plans calculent sur une moyenne de 300 k€. Les seules données sectorielles disponibles disent 85 k€ de médiane (fonds artisanaux, tous métiers) et 178 k€ de moyenne (fonds « construction », lecture à confirmer) ; `audit/marche-rge.md` §6.3 estime que 30-40 % des entreprises RGE vendables partent sous 100 k€ et 10-20 % au-dessus de 400 k€. **Je retiens une moyenne prudente de ≈ 195 k€** (distribution détaillée en §5.4). Si la ligne Altares se révèle fausse, la médiane ISM-MAAF reste, et elle est plus basse : la prudence est du bon côté.

### 3.2 Concurrence et prix acceptés

| Acteur | Cédant paie | Repreneur paie | Commission | Source |
|---|---|---|---|---|
| Fusacq | 0 € (mise en avant 2 € HT/j) | 45-60 € HT le contact, packs 150-325 € HT, abonnements 695-1 195 € HT/an | aucune | https://fusacq.com/tarifs/tarifs.php_fr_ |
| Place des Commerces (groupe Fusacq) | **20 € HT par coordonnées d'acheteur** (4 € HT pour les cabinets > 10 annonces) ; mise en avant 1 € HT/j | 0 € | aucune | https://www.placedescommerces.com/tarifs_fr_ |
| Alvo | 0 € | 2 % HT min 1 000 € HT au succès (1 % avec abonnement 200-299 €/an) | 1-2 % repreneur | https://www.alvo.market/tarifs-cedants-repreneurs |
| Transentreprise (CCI/CMA) | 150-500 € HT/an | 0 € | aucune | https://www.haute-savoie.cci.fr/piloter/transmission/annonce-cession-entreprise-transentreprise |
| Transmibat (FFB × Fusacq), CAPEB Transmission | 0 € adhérents | 0 € | aucune | https://www.ffbatiment.fr/actualites-batiment/actualite-ba/transmission-reprise-entreprise-transmibat-fait-peau-neuve |
| Transaxio, Michel Simond (carte T, humains) | 0 € | 6 500 € HT forfait < 65 k€, puis 10 % HT ≤ 500 k€, 5 % ≤ 1 M€ | 8-10 % acquéreur | https://www.transaxio.fr/les-honoraires/ |
| reprisetransmission.fr (cabinet digital) | success fee vendeur non chiffré | pack 75 € HT | oui | https://www.reprisetransmission.fr/tarif-reprise-cession-entreprise.aspx |
| Acquire.com (US) | 25-100 $/mois + 6-8 % à l'escrow | 390-780 $/an | 6-8 % | https://help.acquire.com/how-much-does-it-cost-to-sell |

**Ce que le marché accepte sans humain** : 20-60 € par contact ou 200-400 €/an, 1-4 % de commission avec minimum 500-1 000 €. **Ce qu'il accepte avec un humain** : 10 % HT avec minimum 5-10 k€. **CessionRGE est aujourd'hui au prix du cabinet pour un service de plateforme** : c'est le point faible central (`audit/marche-concurrence.md` §5-6).

**Place libre** : personne ne possède le SERP « entreprise RGE à vendre » (Bpifrance, reprisetransmission.fr, entreprisesenligne, msimond : pages-catégories faibles) ; aucun concurrent ne vérifie les qualifications contre l'ADEME, ne gère NDA/data room/identité, ni n'explique la transmissibilité du label (certificat à redéposer en cession de fonds chez Qualibat, référent technique à remplacer sous 6 mois chez Qualit'EnR, `marche-rge.md` §7). Le vrai concurrent n'est pas Fusacq : c'est le gré à gré (confrère, salarié, groupe Facebook « Les plombiers chauffagistes de France », 11 000 membres).

---

## 4. Le cadre légal : ce qu'on peut facturer, à qui, quand (`audit/cadre-legal.md`)

### 4.1 Les règles qui tranchent (certitude Élevé sauf mention)

- **Hoguet s'applique** aux cessions de fonds de commerce (toute forme) et de parts de SARL/EURL dont l'actif comprend un fonds ; pas aux actions de SAS/SA. Appliquer le même parcours à tous (mandat écrit numéroté, rien avant conclusion) : gratuit, et évite tout contentieux de qualification. Le mandant professionnel ne change rien (Cass. 1re civ. 23 janv. 2019).
- **Mandat avant publication : obligatoire pour un fonds de commerce.** Publier une annonce de vente pour autrui avec NDA/LOI/data room/offres gérés par le site est de l'entremise, pas de la diffusion. Le mandat « juste-à-temps » proposé par le playbook est à écarter.
- **Art. 6 I : aucune somme « représentative de commissions, de frais de recherche, de démarche, de publicité ou d'entremise » avant conclusion** (2 ans / 30 000 €, nullité). Donc, sur une affaire sous mandat : pas d'annonce payante, pas de boost, pas de dossier, pas d'estimation vendue au futur mandant, pas de crédits ni d'abonnement repreneur (en plus : statut de « marchand de listes »). Le modèle « gratuit + commission au succès » est le seul propre pour un mandataire.
- **Commission due à la signature de l'acte** (pas à la LOI), au débiteur désigné dans le mandat **et** repris dans l'acte ; l'acquéreur n'est tenu que s'il a signé un engagement chiffré (mandat de recherche ou convention d'honoraires au registre).
- **Art. 78 du décret 72-678 : il vise l'exclusivité, la clause pénale et la clause de garantie de rémunération** (commission due « même si l'opération est conclue sans les soins de l'intermédiaire ») : mention très apparente, faculté de dénoncer après 3 mois avec 15 jours de préavis par LRAR, à peine de nullité (Cass. 1re civ. 3 nov. 2016). **Le mandat simple recommandé ici ne contient aucune de ces trois clauses** : pas d'exclusivité, pas de pénalité, pas de clause « commission due quel que soit le canal de vente ». La clause de suite limitée aux acquéreurs nommément présentés rémunère précisément les soins de l'intermédiaire ; `audit/cadre-legal.md` §5.1 est explicite : un mandat simple avec clause de suite « évite tout le formalisme de l'art. 78 ». (La première version de ce rapport affirmait l'inverse ; c'était faux, et cela aurait verrouillé le mandat pendant 3 mois.) Conséquence : la **dénonciation est libre et contractuelle**, à tout moment, 15 jours de préavis. Forme retenue : bouton « Résilier mon mandat » dans l'espace vendeur, qui déclenche l'envoi automatique d'une **lettre recommandée électronique** (art. L100 CPCE, prestataire type AR24/Maileva, ≈ 2-4 € l'envoi, < 10 par an) aux deux parties pour donner date certaine ; un simple e-mail avec accusé n'a pas la valeur d'une LRAR, et le conseil confirmera si la clause peut se contenter de l'e-mail horodaté par la plateforme.
- **Clause de suite** : limitée dans le temps (12-24 mois) et aux acquéreurs nommément présentés (Cass. 11 sept. 2025) ; la liste nominative horodatée envoyée au cédant en fin de mandat est la preuve qui fait gagner sans avocat. Ne jamais la rédiger comme « commission due en cas de vente directe » : ce serait une garantie de rémunération, donc art. 78.
- **Signature par code e-mail** : écrit électronique valable mais **sans présomption de fiabilité** ; en cas de contestation, la preuve pèse sur AlterEgo (Cass. 3e civ. 5 mars 2026). Pour le mandat et l'offre acceptée : signature avancée eIDAS avec horodatage qualifié (1-2 € l'acte). OTP conservé pour le NDA.
- **Garantie financière** : AlterEgo ne doit **jamais** recevoir ni détenir de fonds (décret art. 38-2 et 95) ; bannir le mot « séquestre » appliqué à la plateforme ; le séquestre est celui du rédacteur d'acte. Mention « ne doit recevoir ni détenir… » + n° de carte + CCI sur toutes publicités, y compris les e-mails de prospection.
- **Qui peut négocier pour AlterEgo** : toute personne qui négocie pour le compte du titulaire de la carte doit détenir une **attestation d'habilitation** délivrée par la CCI (art. 4 de la loi ; `cadre-legal.md` §7.1). Conséquences : pas de freelance « apporteur » qui parle aux parties ; les experts-comptables sont des **prescripteurs** (ils envoient un client vers le site), jamais des négociateurs ; la clause de continuité du mandat ne peut prévoir une substitution qu'au profit d'un **autre titulaire de carte T** (un confrère nommé dans la procédure, §8).
- **LCB-FT** : titulaire de carte T assujetti (L561-2 8° CMF) : identification des deux parties, origine des fonds, conservation 5 ans après la fin de la relation (L561-12), formation prouvée (décret 2026-310). Ce n'est pas du P2 : c'est une condition de validité de la relation client et l'argument anti-coquilles 2027. Articulation avec « pièces d'identité jamais stockées » : AlterEgo conserve le **rapport** de vérification Stripe (nom, date de naissance, type et pays du document, résultat, horodatage, identifiant de session), jamais les images ; le rapport est exporté dans le dossier client au moment de la vérification, conservé 5 ans puis purgé par index TTL ; la session Stripe est supprimée via l'API de rédaction après export. Stripe Identity = données biométriques traitées par un sous-traitant : **AIPD** (analyse d'impact, outil PIA de la CNIL, gratuit, une demi-journée) recommandée par `cadre-legal.md` §6.4 et inscrite en P1.
- **Rétractation** (L221-3 C. conso, Cass. com. 4 sept. 2024) : un pro ≤ 5 salariés signant hors de son activité principale peut se rétracter 14 jours sur un contrat **hors établissement** ; le texte ne vise pas les contrats à distance (certitude **Élevé** sur le principe, **Moyen** sur l'application au mandat Hoguet). Décision : signer 100 % en ligne, jamais chez l'artisan ni après une visite ; aucune somme n'étant due avant l'acte, le seul enjeu est de pouvoir **commencer la diffusion tout de suite**. Si le conseil juge un risque résiduel, ajouter l'information sur la rétractation et la demande expresse de commencer l'exécution (L221-25) : elle n'éteint pas le droit de rétractation, elle autorise seulement l'exécution immédiate. Zéro coût.
- **Prospection** : e-mailing B2B en opt-out (intérêt légitime) depuis l'open data ADEME/Sirene/RNE avec source citée et désinscription ; **jamais de scraping** (Kaspr, 240 000 €). Exclure les SIREN ayant exercé leur opposition à la prospection (art. A123-96 C. com.). Le ciblage par âge du dirigeant (RNE) exige une analyse d'intérêt légitime écrite.
- **TVA** : 20 % par défaut ; exonération « négociation de titres » (art. 261 C 1° e) incertaine (CE 2024 l'a refusée à une commission de succès M&A). Un gérant de SARL personne physique supporte le TTC : 6 % HT = 7,2 % TTC pour lui, à afficher. Décision : facturer 20 %, pas d'avis fiscal avant le premier closing sur titres avec un cédant personne physique (1 000-2 000 €, inutile tant qu'il n'y a pas de cas).
- **Facturation** : mentions L441-9 (numérotation continue, pénalités, indemnité de 40 €) ; réception électronique obligatoire depuis le 1er septembre 2026, **émission PME au 1er septembre 2027, pour les factures B2B** : une facture à un cédant personne physique (titres) est hors champ. Aucun audit ne qualifie Stripe Invoicing de plateforme agréée ni ne dit qu'il ne l'est pas ; la question se pose en 2027, pas en 2026 (`cadre-legal.md` §7.4 recommande une PA sans qualifier Stripe). Décision : **Stripe Invoicing en année 1** (facture conforme par champs personnalisés, lien de paiement par virement SEPA ou carte, relances automatiques, statut lu par webhook, ≈ 0,4 % par facture payée hors frais du moyen de paiement), parce que c'est le seul outil qui relance tout seul ; en 2027, si Stripe n'est pas PA, les 5-15 factures/an sont ré-émises par la PA de l'expert-comptable d'AlterEgo. La première version de ce rapport écartait Stripe Invoicing ; c'était une affirmation non sourcée qui remettait un humain dans la boucle.
- **Encaissement : titres et fonds ne se ressemblent pas.** Cession de **titres** : pas d'indisponibilité légale du prix ; il est payé à l'acte (séquestre conventionnel fréquent pour la garantie de passif) → commission **payable sous 30 jours**, avec ordre irrévocable au rédacteur d'acte de la régler sur le prix s'il le détient. Cession de **fonds de commerce** : le prix est **légalement indisponible** pendant l'opposition des créanciers (10 jours après publication, art. L141-14 C. com.) puis la solidarité fiscale du cessionnaire (art. 1684 CGI, 90 jours après dépôt de la déclaration de résultat, 30 jours sous conditions) : le séquestre libère les fonds **3 à 5 mois après l'acte**. La commission est donc facturée à l'acte et **payée par le séquestre à la libération du prix, avant distribution au cédant** (ordre irrévocable dans le mandat, rappelé dans l'acte) ; le cédant peut payer plus tôt hors séquestre s'il le souhaite. La première version de ce rapport cumulait « payable sous 30 jours hors séquestre » et « ordre au rédacteur à la signature » : c'était incompatible, et inopérant pour un fonds.
- **Apport d'affaires par un expert-comptable** : l'ordonnance 45-2138 (art. 22) et le code de déontologie encadrent strictement commissions et courtage d'apport. Décision : **0 € dans tous les scénarios** ; question écrite gratuite à l'Ordre régional, et seulement si la réponse est positive, convention. Indicateur crédit (R519-2 CMF) et assurance (R511-3 C. ass.) : convention écrite avec un IOBSP/courtier, aucune remise de documents : ce sont les deux seuls flux d'apport comptés, et seulement après signature de la convention.

### 4.2 Ce que le modèle actuel fait de risqué ou d'inutile

| Risqué | Inutile |
|---|---|
| Mandat exclusif sans mention art. 78, objet indéterminé, mandant non identifié, obligations non tenues (« accompagner les négociations ») : nullité relative invocable par le seul mandant | Choix du débiteur par le cédant (deux régimes de facture et de preuve, bandeau « 141 600 € TTC ») |
| Signature simple sans horodatage qualifié sur le titre de créance de 100 % du revenu | LOI au prix demandé comme condition de data room |
| Code OTP « qui vaut signature » envoyé à un e-mail jamais confirmé, dans l'objet du message | KYC manuel avec pièces en base64 conservées sans limite |
| Mentions Hoguet absentes du site, des e-mails, du NDA et de la LOI ; « Gestion immobilière » dans la configuration (à vérifier sur la carte réelle) | Crédits/abonnements désactivés mais maintenus (≈ 900 lignes) ; demande d'avocat qui promet une intervention humaine |
| Facture PDF maison non conforme (L441-9) | Validation humaine par défaut des annonces |

---

## 5. Le business model recommandé (un seul)

### 5.1 Positionnement

> **CessionRGE, le tiers de confiance des cessions d'entreprises RGE**, opéré par AlterEgo SAS, titulaire de la carte T. Chaque annonce est contrôlée sur la base ADEME et accompagnée d'un diagnostic de transmissibilité du label ; chaque repreneur se présente avec son projet, puis **son identité est vérifiée avant qu'il connaisse le nom de la société** ; chaque document est signé en ligne avec dossier de preuve. **Gratuit pour les repreneurs. Pour le cédant : rien avant la vente, 6 % HT à l'acte, sans exclusivité, mandat dénonçable à tout moment.**

Je retiens l'architecture du plan « produit » (`audit/plan-produit.md`) avec des greffes des deux autres. Les trois plans partagent 80 % de leurs recommandations (mandat simple, cédant débiteur, KYC au NDA, publication automatique, encaissement organisé, open data, SEO vertical, refus des revenus amont) ; là où ils divergent, voici l'arbitrage :

| Divergence | Cash | Liquidité | Produit | Retenu et pourquoi |
|---|---|---|---|---|
| Taux | 7 % + 3 tranches, plancher 3 500 € | 5 %, sans plancher | 6 % (3 % > 1 M€), plancher 4 000 € | **6 %, plancher 4 000 €** : une phrase lisible ; le 5 % perd 17 % par closing sans preuve que le taux soit le frein (les audits désignent l'exclusivité, le TTC et l'absence de preuve) |
| Clause de suite | 24 mois | 12 mois | 12 mois | **18 mois** : le cycle est de 12-18 mois ; 24 mois est au plafond jurisprudentiel |
| CTA du hero | « Déposer mon annonce » | « Déposer mon annonce » | « Estimer » | **« Estimer »**, mesuré (§7.1) |
| Courrier postal | non en année 1 | test 300 lettres à M4 | test 200 lettres à M+5 | **Test unique de 300 lettres à M+4** (≈ 600 €), poursuivi seulement si ≥ 3 annonces |
| Facturation | Stripe Invoicing | Stripe Invoicing | Stripe Invoicing | **Stripe Invoicing** (§4.1) |
| Prix moyen | 300 k€ | 300 k€ | 300 k€ (commission 17 500 €) | **≈ 195 k€, commission ≈ 11 800 € HT** (§3.1, §5.4) |
| Diagnostic RGE payant | M+7 | M+7 | M+7 | **Pas avant M+12**, et seulement hors catalogue (§5.2) |

Décision structurante : **rester 100 % intermédiaire mandaté**. Le modèle média (Fusacq) rapporterait 10-30 k€/an au volume probable et ferait perdre la seule promesse différenciante ; deux entités exigent un juriste et ne rapportent rien sous 150-300 annonces actives.

### 5.2 Offres et prix

| Flux | Qui paie | Prix | Quand | Base légale |
|---|---|---|---|---|
| **1. Commission de cession** (mandat de vente **simple**) | Le cédant, toujours | **6 % HT du prix (3 % sur la part > 1 M€), minimum 4 000 € HT**, TVA 20 % ; HT affiché d'abord, TTC à côté pour les cédants personnes physiques | Facturée à la signature de l'acte ; **titres : payable sous 30 jours** ; **fonds : payée par le séquestre à la libération du prix (3-5 mois), avant distribution** ; ordre irrévocable au rédacteur d'acte dans le mandat, repris dans l'acte | Art. 6 Hoguet ; mandat numéroté au registre ; clause de suite **18 mois** sur les acquéreurs nommément présentés ; **aucune clause relevant de l'art. 78** |
| **2. Mandat de recherche** (consolidateurs, structures devant internaliser le RGE) | L'acquéreur mandant | **3 % HT, minimum 6 000 € HT**, uniquement sur une **cible hors catalogue sourcée pour lui** ; jamais de double commission ni d'accès anticipé | Au closing | Même registre unique (Cass. 10 déc. 2014) ; commission déterminable, reprise dans l'acte ; conflit d'intérêts déclaré dans le mandat de vente ; modèle relu par le conseil avant le premier (+ 500-1 000 €) |
| **3. Diagnostic de transmissibilité RGE** | Personne pendant 12 mois (inclus dans chaque data room ; version courte gratuite sur `/verifier-entreprise-rge`) | 0 € | — | Produit logiciel hors art. 1er. Version payante (149 € HT, tiers sur SIRET hors catalogue, jamais le dirigeant de ce SIRET) **non lancée avant M+12**, et seulement si ≥ 50 data rooms ouvertes et avis du conseil ; **0 € dans tous les scénarios** |
| **4. Apport d'affaires** (courtier crédit en qualité d'indicateur, courtier décennale/RC) | Le partenaire | 200-800 € par dossier signé | À la signature chez le partenaire | Hors art. 1er ; transparence (« ce partenaire rémunère CessionRGE ») ; compté seulement après convention signée ; expert-comptable : 0 € |
| **5. Annuaire partenaires / sponsoring** | Professionnels référencés | 0 € avant 60-100 annonces actives | — | Publicité identifiée |

**Explicitement exclu** : abonnement ou crédits repreneur, annonce premium, accès anticipé payant, dossier ou estimation payants au cédant, deux entités, courtage CEE (autre métier, face à des délégataires avec équipes commerciales : à abandonner, pas à « tester »), mise en relation sous-traitants/fournisseurs, scraping, SMS OTP (voir §5.3).

**Pourquoi 6 % min 4 000 €** : une phrase qu'un artisan lit (« 6 % à la signature, rien avant, rien pour le repreneur ») ; 40 % sous les cabinets pour un service situé entre Alvo (2 %, sans carte T) et Transaxio (10 % + négociation) ; à 85 k€ (médiane artisanat) : 5 100 € ; à 180 k€ : 10 800 €. **Le plancher ne joue que sous 66 700 €** (6 % × 66 700 = 4 000) : il concerne les fonds de 20-65 k€ des vendeurs contraints (`marche-rge.md` §10), soit ≈ 15 % des dossiers dans la distribution retenue, et y ajoute en moyenne 1 000-1 500 € par dossier. Il protège le bas de la distribution ; il ne change pas la moyenne. La première version de ce rapport en faisait « la variable la plus importante » : c'était arithmétiquement faux.

**Cédant toujours débiteur : ce que ça coûte et pourquoi quand même.** `audit/business-model.md` §4.2.4 a raison : pour un gérant personne physique qui vend ses parts, 7,2 % TTC n'est ni récupérable ni déductible (la commission réduit seulement la plus-value), alors qu'une holding acquéreuse récupérerait la TVA et exclurait la commission de l'assiette des droits d'enregistrement. Un régime unique coûte donc des points de signature sur cette sous-population. Je le garde quand même : deux régimes = deux factures, deux preuves, un débiteur qui n'a pas signé le mandat (recouvrement sur la base d'une clause de LOI), et un bandeau « 141 600 € TTC » en tête de fiche qui tue la demande (`ux-acheteur.md` §3). Mesure : motif de refus « commission à ma charge » dans le questionnaire de sortie du tunnel mandat ; si > 20 % des refus à M+6, rouvrir l'option acquéreur **dans l'acte uniquement** (convention d'honoraires acquéreur au registre), jamais dans l'annonce.

### 5.3 Comparaison avec le modèle actuel

| Question | Aujourd'hui | Recommandation | Pourquoi |
|---|---|---|---|
| **Mandat obligatoire avant publication ?** | Oui, exclusif 12 mois, LRAR | **Oui, mais simple**, signé dans le flux de dépôt, dénonçable à tout moment (15 j de préavis, bouton + LRE automatique), caduc automatiquement si l'annonce est refusée, signature avancée horodatée, objet pré-coché, adresse collectée, contre-signé, PDF numéroté envoyé, **tous les associés cédants signataires** en cession de parts | Hoguet l'impose pour un fonds ; ce qui dissuade est l'exclusivité et l'opacité, pas la signature (2 minutes, bien faite) |
| **Choix du débiteur ?** | Cédant choisit, affiché TTC à l'acquéreur | **Supprimé : cédant toujours** ; l'acquéreur ne paie que comme mandant d'un mandat de recherche | Un seul régime de facture ; le bandeau « 141 600 € TTC » tue la demande ; cohérence mandat = acte |
| **Barème ?** | 10/8/6 % par tranches, sans minimum, TTC d'abord | **6 % (3 % > 1 M€), min 4 000 € HT, HT d'abord** | Lisibilité ; taux de signature ; moins de contournement |
| **KYC repreneur** | Stripe avant le premier message | **Avant tout message : e-mail confirmé (double opt-in), profil déclaratif + score, téléphone collecté et validé par format (pas d'OTP SMS), SIREN facultatif vérifié Sirene. Stripe Identity au NDA** ; repli (visio de 5 min ou pièce envoyée au prestataire de signature) si Stripe échoue, et **mesure du taux d'échec** (aucun audit ne le documente) | Coût ÷ 3 ; preuve de présentation conservée (nom + e-mail confirmé + téléphone déclaré). Le SMS OTP, exclu par le plan cash, n'est pas réintroduit : ≈ 0,05-0,10 € par SMS et un prestataire de plus pour une preuve que le NDA apporte de toute façon ; à reconsidérer en P2 seulement si des profils fictifs apparaissent |
| **Validation « profil » par le cédant** | À l'aveugle | Carte repreneur pseudonymisée ; relances J+2/J+5 ; **expiration J+10** ; option au mandat « accepter automatiquement les repreneurs au profil complet, score ≥ 50 » | Supprime le cédant muet comme point de blocage. À ce stade « vérifié » signifie e-mail + profil, pas identité : le texte de l'option le dit |
| **LOI** | Au prix demandé, avant la data room | **Data room après NDA + KYC ; LOI = offre indicative structurée** rédigée par l'acheteur, contre-signée, exclusivité optionnelle | Un repreneur signe après avoir vu les bilans |
| **Publication** | Validation humaine si nom ≠ INPI | **Automatique** (identité + mandat + SIREN actif et dans la liste ADEME + pas de doublon), post-modération 48 h, refus à motifs | Autonomie ; plus de « sous 48 h » |
| **Encaissement** | Déclaration volontaire, facture `a_valider` | Rédacteur d'acte obligatoire à l'offre acceptée ; « Déclarer la vente » à confirmation croisée (silence 7 j) ; note d'honoraires + ordre de paiement envoyés au rédacteur ; **facture Stripe Invoicing** (lien de paiement, relances J+15/30/45 pour les titres, J+90/120/150 pour les fonds, statut par webhook) ; veille BODACC/RNE mensuelle ; modèle de mise en demeure | C'est le mécanisme qui remplace l'équipe de recouvrement |
| **Revenus annexes** | Crédits/abonnements désactivés, courtage CEE en v2 | Apport d'affaires crédit/assurance après convention ; mandat de recherche quand un consolidateur se présente ; diagnostic payant pas avant M+12 | Seuls flux compatibles Hoguet |

### 5.4 Scénarios de revenus (HT encaissé) et coûts

Hypothèses explicites :

- **Distribution des prix** (d'après `marche-rge.md` §6.2-6.3 et §10) : 15 % à 50 k€ (vendeurs contraints → plancher 4 000 €), 25 % à 85 k€ (5 100 €), 30 % à 150 k€ (9 000 €), 20 % à 300 k€ (18 000 €), 8 % à 500 k€ (30 000 €), 2 % à 1 M€ (60 000 €) → **prix moyen ≈ 195 k€, commission moyenne ≈ 11 800 € HT**.
- Création → mandat : 70 %. Annonces vendues via un repreneur nommément présenté dans les 18 mois : 8 / 12 / 18 %. Fuite non recouvrée : 35 / 25 / 15 %. → **Encaissé par annonce publiée : ≈ 610 / 1 060 / 1 800 € HT.**
- Délai publication → acte : 12 / 11 / 9 mois ; encaissement : + 1 mois (titres) à + 3-5 mois (fonds), soit **+ 2-3 mois en moyenne**. Un closing n'est donc encaissé, en médian, que **13-14 mois après la publication**.
- Annonces publiées : la première campagne part à M+4 (après P0 et relecture du mandat) ; SEO en relais à partir de M+6-9.
- E-mailing (§6.1) : 1-1,4 % de réponses positives, 10-15 % des positives deviennent une annonce dans les 3 mois.

| | Pessimiste | Médian | Optimiste |
|---|---|---|---|
| Annonces publiées année 1 / année 2 | 10 / 20 | 22 (1-2/mois de M+4 à M+8, 3/mois dès M+9) / 40 | 35 / 65 |
| Espérance par annonce publiée | ≈ 610 € | ≈ 1 060 € | ≈ 1 800 € |
| Closings encaissés à M+12 | 0 | **0** (le premier acte possible est vers M+12, l'encaissement après) | 0-1 |
| **Revenu 12 mois** | **0** | **0-2 k€** (apport crédit/assurance, uniquement si une convention est signée) | **0-12 k€** (0-1 closing, 1-2 k€ d'apport) |
| Closings encaissés M+13 → M+24 | 0-1 | **2-3** (≈ 22 annonces × 9 % × part déjà close et payée ≈ 1,6, plus les premières de l'année 2) | 5-6 |
| **Revenu année 2** | **0-12 k€** | **25-40 k€** (2-3 closings ≈ 24-35 k€, apport 1-3 k€ ; mandat de recherche non compté) | **75-100 k€** (5-6 closings ≈ 60-70 k€, 1 mandat de recherche ≈ 10-20 k€, apport 3-5 k€) |
| Closings encaissés année 3 (si 40-50 annonces/an) | 1-2 | **4-6** (≈ 50-70 k€) | 9-12 |
| Part du marché ouvert (300-500/an) en année 2 | 4-7 % | 8-13 % | 13-22 % |

Les trois plans affichaient 100-150 k€ en année 2 médiane (délai 9 mois + 1, commission 17 500 €) ; la première version de ce rapport disait 40-60 k€ ; avec le prix réaliste, un délai de 11 mois et l'indisponibilité du prix sur les fonds, **le médian de l'année 2 est 25-40 k€, et le demi-salaire est une affaire d'année 3**. C'est le chiffre à mettre dans votre plan de trésorerie.

**Coûts mensuels récurrents** (année 1) : VPS Hetzner CX23 6 € (CX33 ≈ 12 € si le build reste sur le VPS) · S3 Scaleway 1-5 € · domaines (dont ombrelle) 2-4 € · Brevo 0-25 € · Sentry/UptimeRobot/Plausible/Cal.com 0-9 € · Stripe Identity au NDA 10-30 € · signature avancée 15-40 € · LRE 0-3 € · Stripe Invoicing ≈ 0,4 % des factures payées (≈ 50 € par closing médian, variable) · enrichissement Pappers/Societeinfo 0-50 € · infra e-mailing (2 domaines satellites, 3 boîtes, outil de séquence) 100-150 € de M+2 à M+9 · **RC pro carte T ≈ 80-125 €** et **expert-comptable d'AlterEgo ≈ 100-150 €** (chiffrés par `plan-produit.md` §9 en dépenses annuelles, ≈ 1 000 + 1 200 €/an ; je les mensualise) → **≈ 320-600 €/mois, médian ≈ 430 €**. Une fois : avocat 3 000-5 000 € (détail en §10.1, décision 12), graphiste + photos 500-1 000 €, formation LCB-FT 200-400 €, test courrier 600 €, dépôt de marque ombrelle + domaine 250-500 €. **Année 1 tout compris ≈ 10-14 k€ ; année 2 ≈ 6-8 k€** (plus de campagne e-mail permanente, plus d'avocat). Pour mémoire, les 4-7 k€/an cités en §1 sont les coûts de **l'existant** (`business-model.md` §8), pas ceux du plan.

**Seuils** : les coûts récurrents (≈ 5-7 k€/an) sont couverts par **un demi-closing médian** ; un demi-salaire (40 k€ après coûts) demande ≈ 4 closings encaissés par an, soit ≈ 45 annonces publiées par an (9-15 % du marché ouvert) : **année 3 au plus tôt** ; un salaire (80 k€) demande ≈ 90 annonces/an, soit 18-30 % du marché RGE ouvert : **pas sans élargissement**. Le point mort cash cumulé (≈ 19-21 k€ dépensés sur 24 mois contre 25-40 k€ encaissés en année 2, qui arrivent en fin d'année) se situe **vers M+22-26 en médian**. **Prévoyez au moins 24 mois d'un autre revenu**, pas 12-18.

---

## 6. Moteur d'acquisition sans commercial

### 6.1 Cédants (le côté rare)

1. **Indexation d'abord (semaine 1, 0 €)** : domaine canonique `cessionrge.fr`, 301 depuis le sous-domaine, Search Console, sitemap sans fiches non pré-rendues, `noindex,follow` sur les 19 pages activité/région vides et sur `/search`. Tant que le site n'apparaît pas sur sa marque, rien d'autre ne compte.
2. **Vérifier les hypothèses de sourcing sur les données réelles (semaine 2, 0 €, une demi-journée)** avant d'engager 100-150 €/mois d'infrastructure : (a) télécharger la liste ADEME et compter les SIREN actifs ; (b) croiser avec Sirene (effectif) et RNE (date de naissance du dirigeant) et **compter réellement** les dirigeants ≥ 58 ans, puis ≥ 58 ans et ≥ 3 salariés ; (c) vérifier la **présence effective d'un e-mail** dans le jeu ADEME (des descriptions tierces l'indiquent, `cadre-legal.md` §6.3 ; question ouverte n° 7) et son taux de remplissage. Ordres de grandeur contradictoires dans le dossier : 11-16 k si l'on applique 25 % de dirigeants ≥ 60 ans à tout le parc (`playbooks.md`) ; 4-8 k si l'on applique une part employeuse de 50-60 % puis 15-25 % de dirigeants ≥ 58 ans. **Je ne retiens aucun des deux : on compte.** Si le segment A avec e-mail fait moins de 3 000 entreprises, le test courrier (point 5) monte à M+3 et l'e-mailing se fait sans domaines satellites (envois Brevo, 0 € de plus).
3. **SEO vertical (0 €, 3-9 mois)** : pages métier × département **alimentées par les comptages réels ADEME** (« 312 entreprises RGE isolation en Gironde, 24 % de dirigeants de plus de 60 ans ») indexées seulement quand elles portent une donnée ou une annonce ; 3 guides d'intention supplémentaires (« la qualification RGE est-elle transmissible ? », « combien vaut une entreprise de PAC ? », « RGE-facturant 2027 »), pas 10 ; page `/verifier-entreprise-rge` ; baromètre trimestriel n° 1 relayé à Batiactu / Le Moniteur / newsletters Qualit'EnR-Qualibat. C'est du temps d'écriture (1-2 h/semaine de M+4 à M+9), pas du code.
4. **Aimant** : estimation express gratuite sans compte (SIRET → qualifications ADEME ; CA, EBE, effectif, 3 cases → fourchette 0,3-0,6 × CA / 2,5-4 × EBE), avec **pédagogie de la valeur** (ce qui la fait monter : contrats d'entretien, référent technique, équipe) car beaucoup d'artisans verront un chiffre inférieur à leur attente (« offre trop faible » = 2ᵉ frein des cédants, 18 %, Bpifrance).
5. **E-mailing B2B opt-out sur l'open data** (≈ 100-150 €/mois de M+2 à M+9) : liste RGE × Sirene × RNE × BODACC ; segment A dirigeant ≥ 58 ans, ≥ 3 salariés. **Attentes** : les playbooks et les plans disent 4 % de réponses dont 25-35 % positives, soit **1-1,4 % de réponses positives** : 15-28 conversations par mois pour 1 500-2 000 envois. Je suis d'accord avec ce chiffre. Ce que je ne reprends pas, c'est leur conversion conversation → annonce de 20-30 % (4-8 annonces/mois) : une réponse positive est « dites-m'en plus », pas une décision de vendre cette année (Bpifrance : 30 % des porteurs de projet reportent ou annulent, écart intention/réalisation maximal après 60 ans) ; je prends **10-15 %**, soit **1,5-4 annonces/mois** tant que le segment n'est pas consommé (2-6 mois selon le comptage du point 2), et c'est un chiffre à mesurer, pas une certitude. **C'est une campagne, pas un moteur permanent** ; le SEO et les prescripteurs doivent prendre le relais avant M+9. Prérequis : LIA écrite, mention de la source, désinscription, exclusion des oppositions Sirene, webhook rebonds Brevo, mentions carte T sur chaque envoi, domaines satellites (jamais depuis `cessionrge.fr`).
6. **Test courrier postal unique** : 300 lettres à M+4 (≈ 600 €) sur le segment A sans e-mail, QR code vers l'estimateur ; poursuivi seulement si ≥ 3 annonces. C'est le canal le plus crédible pour un artisan de 60 ans et le test le moins cher du plan.
7. **Prescripteurs** : l'expert-comptable est le décideur réel (73-81 % des dirigeants le citent comme premier interlocuteur, `audit/marche-rge.md` §9). Programme **côté cédant** (page partenaires, kit d'une page, estimateur en marque blanche), sans rémunération d'apport (§4.1). CAPEB départementales, CMA, Bpifrance Transmission (partenaire agréé) et Transentreprise (rediffusion) : lents, gratuits.
8. **Une seule porte humaine** : créneau de 15 minutes (Cal.com) **à l'initiative du cédant**, proposé après l'estimation et après le mandat. Mesure à M+3 : si le taux création → mandat est < 50 %, proposer le créneau avant la signature (+ 2 h/semaine).

### 6.2 Repreneurs

1. **Alertes sans compte** depuis chaque page vide, chaque fiche et la page Reprendre ; digest hebdo ; événement « baisse de prix ».
2. **Seeding de l'offre au démarrage à froid**, dans un cadre lisible : proposer aux cabinets et à Bpifrance Transmission la rediffusion gratuite de leurs annonces RGE (relation entre intermédiaires, hors Hoguet) dans une **section séparée « Annonces de cabinets partenaires »**, avec un badge distinct (« diffusée pour [cabinet] — contact chez le cabinet »), sans NDA, data room ni mention « vérifié ADEME » (seules les annonces sous mandat AlterEgo portent le badge et la promesse de vérification) ; plafond 20 annonces ; retirée dès que le catalogue propre dépasse 20. Deux régimes sur un site sont acceptables si le badge dit lequel ; ils ne le sont pas s'ils partagent la même carte. Côté DSA, le site est déjà un hébergeur de contenus de tiers (ses propres annonces) : point de contact, CGU de modération, notification/action et motifs de retrait (P1) couvrent aussi ces annonces.
3. **Page `/chiffres` publique dès 20 annonces** (annonces actives, repreneurs au profil complet, NDA sur 30 jours, délai médian) et track record anonymisé dès le premier closing : la preuve qui remplace un commercial.
4. **Acheteur récurrent** (dirigeant qui rachète 5 installateurs/an) : NDA-cadre signé une fois, liste d'exclusion des cibles déjà connues, export des annonces ; c'est le seul client solvable, les plans l'oubliaient.
5. **Mandat de recherche** : 10-20 e-mails personnels du fondateur aux build-ups actifs (Butagaz Eco-énergie, Isovalie, Émeraude Power, Satep, Atout Groupe, Renovio) et aux structures devant internaliser le RGE avant 2027, à partir de M+4, 1 h/semaine ; la page et le modèle de mandat ne sont construits que lorsqu'un premier répond. Pas d'automation LinkedIn (bannissement du seul compte fondateur) ; contenu organique uniquement.
6. **Refus explicite des chasseurs de coquilles** affiché sur l'accueil (profil, identité vérifiée au NDA, origine des fonds déclarée, registre) : argument auprès des cédants honnêtes. Avant le NDA, le filtre est déclaratif ; c'est l'identité au NDA et l'origine des fonds avant la data room qui arrêtent une coquille, et le texte d'accueil le dit ainsi.

**Aucune publicité payante.**

---

## 7. Produit : refonte proposée et backlog

### 7.1 Accueil cible (≈ 450 mots, 2 800 px desktop / 5 500 px mobile, un CTA principal répété 3 fois)

0. **En-tête** : Logo · Entreprises à vendre · Vendre · Reprendre · Guides · Connexion · **[Estimer mon entreprise]** (navy plein).
1. **Hero (fond blanc, texte 55 % / visuel 45 %)** — Eyebrow : « Cession d'entreprises RGE · opéré par AlterEgo, carte professionnelle T ». H1 : **« Vendez votre entreprise RGE sans que personne ne le sache. »** Sous-titre : « Annonce anonyme ; repreneurs présentés avec leur projet, identité vérifiée avant toute révélation de votre nom ; accord de confidentialité signé. Rien à payer avant la vente : 6 % HT à la signature de l'acte, sans exclusivité, mandat dénonçable à tout moment. » CTA : « Estimer mon entreprise en 2 minutes » → `/estimer` ; lien « Déposer mon annonce anonyme » → `/register?role=seller` ; discret : « Vous cherchez une entreprise à reprendre ? Voir les annonces → ». Visuel : capture produit d'une annonce anonyme avec badge « RGE vérifié le JJ/MM sur la base ADEME » et cadenas « nom et SIRET révélés après accord de confidentialité », sur photo de chantier en duotone.
   **Pourquoi « Estimer » et non « Déposer »** : le goulot historique est création → mandat, pas le clic ; l'estimation capte un e-mail (double opt-in) sans compte, donne au cédant un chiffre avant de lui demander un engagement, et nourrit la séquence J+1/4/10 ; « Déposer » envoie un artisan de 60 ans vers 13 champs. **Mesure** : événements Plausible `hero_cta_seller`, `estimate_started`, `estimate_completed`, `calc_used`, `alert_created`, `rdv_clicked`, `listing_card_click` (listés par `accueil-design.md` §7 et `plan-cash.md` §6) ; lecture à M+3 : si estimation → annonce créée < 25 %, le CTA principal devient « Déposer mon annonce anonyme » et l'estimation passe en lien. Pas de test A/B (pas de volume) : une bascule décidée sur un chiffre.
2. **Bande d'autorité (4 sceaux)** : « AlterEgo SAS, carte professionnelle T n° CPI 7801 2025 000 000 049, CCI Paris Île-de-France » · « Qualifications contrôlées sur la base officielle ADEME » · « Identité des repreneurs vérifiée avant toute révélation » · « 0 € avant la signature de l'acte — c'est la loi (art. 6, loi Hoguet) et notre modèle ».
3. **Ce que nous vérifions (3 cartes)** : votre entreprise (qualifications, échéances, référent technique → diagnostic inclus) · vos repreneurs (projet, budget, financement déclarés ; identité vérifiée au NDA ; origine des fonds avant les documents ; refus des profils « coquille ») · vos documents (mandat, NDA, offre : signés en ligne, horodatés, envoyés aux deux parties).
4. **Comment ça marche (onglets accessibles : `tablist`/`tab`/`tabpanel` reliés, navigation clavier)** — Cédant : « Estimez : votre SIRET charge vos qualifications » · « Complétez votre annonce anonyme, sauvegardée à chaque étape » · « Vérifiez votre identité et signez le mandat simple, dénonçable à tout moment » · « Recevez des repreneurs présentés avec leur projet ; révélez votre nom après NDA ; recevez les offres ». Repreneur : « Parcourez, créez une alerte » · « Présentez votre projet en 2 minutes » · « Contactez gratuitement » · « Identité vérifiée au NDA, documents, offre ». Sous la timeline : « Délai moyen entre le dépôt et le premier contact : X jours » dès qu'il est mesuré ; en attendant « Vous êtes prévenu par e-mail à chaque contact, NDA et offre ».
5. **Annonces récentes** (`ListingCard` ×3, titres lisibles « Installateur PAC & chauffe-eau · Bretagne · 9 salariés ») ; si < 6 annonces, la 3ᵉ carte = « Recevoir les prochaines annonces » sans compte. **Jamais de compteur à zéro.**
6. **Tarif** — H2 « Vous ne payez qu'à la vente. » « Publication gratuite. À la signature de l'acte, 6 % HT du prix (3 % au-delà d'un million), minimum 4 000 € HT, à la charge du cédant. Pas d'exclusivité, pas d'abonnement, rien pour les repreneurs. » Calculateur : « [180 000 €] → **10 800 € HT** (12 960 € TTC) ». Liste « ce que comprend la commission ». Note : « La négociation et les actes restent entre vous et le repreneur, avec vos conseils. »
7. **Qui est derrière** : portrait, « Micael [Nom], fondateur. AlterEgo SAS, Sartrouville, carte T CCI Paris IdF » + 3 lignes honnêtes (expérience, pourquoi un tiers de confiance plutôt qu'un groupe Facebook) + « 15 minutes pour en parler ». Chiffres publics seulement quand ils dépassent 10 **et** qu'ils sont calculés sur les mandats actifs (signés, non annulés, non tests), jamais sur le compte brut du registre ; sinon « Lancé en 2026 · toute la France ».
8. **FAQ (5)** : salariés et clients peuvent-ils savoir ? · combien ça coûte, qui paie ? · qui sont les repreneurs, comment filtrés ? · et si je vends par moi-même ? (mandat simple, clause de suite 18 mois sur les repreneurs que nous vous avons présentés, expliquée) · que devient ma qualification RGE ?
9. **Guides (3 cartes)** · 10. **CTA final** (seul bloc sombre) · 11. **Pied de page légal complet** : raison sociale, adresse, RCS, carte T, CCI, « ne doit recevoir ni détenir d'autres fonds… » (ou garantie), RC pro, contact, « Signaler un contenu ».

Supprimés : formulaire de recherche du hero, vérificateur RGE sur l'accueil (→ page dédiée), newsletter « communauté », tableau du barème (→ calculateur ; tableau sur `/vendre`).

**Pages Vendre et Reprendre** (atterrissages SEO, à traiter avec l'accueil) : `/vendre-mon-entreprise-rge` garde ses 1 275 mots mais reçoit la bande d'autorité, le calculateur, un visuel, un bloc « combien de temps ça prend » (premier contact, délai moyen de cession 12-18 mois) et un CTA « Estimer » + « Déposer mon annonce anonyme » (`?role=seller`) ; `/reprendre-une-entreprise-rge` : « Créer une alerte » ouvre le formulaire d'alerte sans compte (e-mail + métier + zone), pas `/register`.

### 7.2 Direction design

Passer de « start-up éco générique » à « intermédiaire de transmission, spécialiste, fiable ». Fond clair, un seul bloc sombre, pas de halos. Palette : navy `#0b1220` (texte, boutons), surface `#f5f7fa`, bordures `#e3e7ee`, action bleu `#1d4ed8`, **vert `#15803d` réservé au badge RGE**, ambre `#b45309` à petite dose. Typographie auto-hébergée (Manrope 700/800 titres, Inter 400-600 texte, **aucun texte engageant sous 13 px**, chiffres tabulaires). Focus visible sur tous les liens-cartes. Composants : `ListingCard` unique, `TrustBar`, `ProcessTimeline` avec cadenas, `CommissionCalculator`, `FounderCard`, `BuyerCard`. Visuels à coût maîtrisé : 3-4 photos de chantier duotone, 2 captures produit, carte de France SVG, portrait du fondateur, pictogramme retouché (300-800 €). Ton : vouvoiement, phrases courtes, chiffres ; bannir « communauté », « rejoignez », « Lehman ».

### 7.3 Parcours vendeur cible (3 écrans, 10 minutes, zéro attente humaine)

Estimer sans compte (SIRET → ADEME, jamais bloquant ; 3 chiffres → fourchette ; e-mail = double opt-in) → annonce en 3 écrans avec brouillon serveur, infobulles, « à préciser avec mon comptable », bornes, bloc « ce qui rassure un repreneur », alerte prix hors fourchette, aperçu anonyme → identité Stripe (même onglet, repli si échec) → mandat : résumé 5 lignes, texte dépliable, case activée en fin de défilement, signature avancée, associés co-signataires → **publication immédiate** → « 15 minutes avec Micael » (facultatif) + PDF numéroté + checklist de complétude. Espace vendeur : bloc « À traiter », messagerie par (annonce, repreneur), actions Pause / Retirer / Vendue via CessionRGE / Vendue autrement, bouton « Résilier mon mandat ».

### 7.4 Parcours acheteur cible

Alerte sans compte → inscription en un écran (projet, zones, métiers, budget, apport, financement, horizon, SIREN facultatif, téléphone) → score et badges → contact gratuit avec « Présentez votre projet » → carte repreneur au cédant, acceptation en un geste ou automatique → **NDA : Stripe Identity ici**, signature par code, identité révélée, origine des fonds déclarée, data room + diagnostic RGE, exemplaire envoyé → offre indicative structurée (montant, titres/fonds, crédit vendeur, conditions, calendrier), signée et contre-signée → offre acceptée : rédacteur d'acte obligatoire, checklist, partenaire crédit → déclaration de vente croisée. Pour l'acheteur récurrent : NDA-cadre, vue « Mes dossiers ».

### 7.5 Automatisations et e-mails

Toutes en `claim_once`, un e-mail de relance par jour et par personne au plus, un seul bouton profond par e-mail, désinscription sur tout ce qui n'est pas transactionnel. Cédant : mandat J+1/4/10 (réponses aux 3 objections), publication « envoyée à N repreneurs », premier contact avec extrait et carte repreneur, demande d'accès non traitée J+2/J+5, hebdo (vues, favoris, contacts), 14 j sans contact (leviers), 30 j (fourchette de prix), 60 j sans connexion (pause J-7), offre acceptée J+30/60/90 (3 réponses en un clic), vente déclarée (facture), mandat J-30. Repreneur : identité non vérifiée J+1/3/10 avec 3 annonces proches, NDA non signé J+2/J+7, data room sans consultation J+3, offre expirée, digest hebdo, baisse de prix, NPS après closing. Admin : **un seul e-mail quotidien « À faire »** (vide = pas d'e-mail) ; immédiat seulement pour vente déclarée, contestation, 3ᵉ tentative de contournement, échec répété de webhook.

### 7.6 Admin réduit et écran de pilotage

Onglet « À faire » par défaut (post-modération < 48 h, bloquées, incidents BODACC/RNE sans vente déclarée, vendeurs muets > 7 j, offres acceptées > 60 j, factures en retard, mandats < 30 j, erreurs Sentry), puis l'**écran du lundi** (15 minutes) avec les 10 KPI ci-dessous en semaine vs semaine et vs cible, revenu calculé sur les factures Stripe et coûts du mois. Supprimés : générateur de contrats, data room admin, messages en clair (→ incidents), reset-password, crédits, migration exposée. Paramètres juridiques en variables d'environnement.

**Les 10 KPI et leurs cibles** (consolidés depuis `plan-cash.md` §10, `plan-liquidite.md` §14, `plan-produit.md` §12 ; cibles recalées sur les scénarios de ce rapport) :

| # | KPI | Cible | Pourquoi celui-là |
|---|---|---|---|
| 1 | Annonces publiées / mois ; coût par annonce publiée | 2/mois à M+6, 3 à M+9, 4 à M+12 ; < 150 € | Déclencheur M+6 et critère d'arrêt |
| 2 | Estimation → annonce créée ; annonce créée → mandat signé | ≥ 30 % ; ≥ 65 % | Le goulot historique ; décide du CTA (M+3) et du créneau avant signature |
| 3 | Délai dépôt → publication (médiane) ; part publiée sans humain | < 1 h ; > 90 % | Autonomie réelle |
| 4 | Contacts / annonce à 30 j ; NDA / annonce à 30 j ; offres à 90 j | ≥ 5 ; ≥ 2 ; ≥ 1 sur 4 annonces | Santé de la demande |
| 5 | Taux de réponse du cédant sous 48 h ; demandes expirées sans réponse | > 80 % ; < 10 % | Le cédant muet est le 2ᵉ goulot |
| 6 | E-mailing : réponses, positives, positives → annonce ; rebonds, plaintes | ≥ 3 % ; ≥ 1 % ; ≥ 10 % ; < 3 % ; < 0,1 % | Valide ou invalide la campagne avant M+6 |
| 7 | SEO : clics Search Console / semaine, position sur « entreprise RGE à vendre » + 5 requêtes, pages indexées | croissance mensuelle ; top 10 à M+9 | Le relais de l'e-mailing |
| 8 | Closings : offres acceptées ; ventes déclarées ; factures émises / encaissées ; délai facture → paiement ; incidents BODACC/RNE sans vente déclarée ; montant recouvré | titres < 30 j, fonds < 150 j ; incidents = 0 | 100 % du revenu |
| 9 | Trésorerie : coûts du mois ; dépenses cumulées vs plafond | ≤ 600 €/mois ; ≤ 15 k€ en année 1 | Critère d'arrêt |
| 10 | Fondateur : heures/semaine ; actions humaines bloquantes/semaine ; santé technique (erreurs Sentry, uptime, dernière sauvegarde restaurable) | 10-15 h jusqu'à M+9 puis ≤ 6 h ; < 3 ; 0 erreur non lue | La contrainte n° 1 du brief |

### 7.7 Backlog priorisé

Effort : S < 1 jour · M 1-3 jours · L > 3 jours. **« Avant déploiement » = ne pas remettre en ligne sans.** Estimation réaliste pour un développeur seul assisté par IA, tests et déploiement compris : **P0 ≈ 25-30 jours, P1 ≈ 24-28 jours, soit ≈ 50-60 jours sur 14 semaines**. La première version de ce rapport annonçait 27-33 jours pour le même contenu ; c'était sous-estimé d'un facteur 2, et la refonte d'accueil seule est chiffrée 5-8 jours par `accueil-design.md` §7.

**P0 — avant le prochain déploiement (semaines 1-6, ≈ 25-30 jours)**

| # | Changement | Effort (jours) |
|---|---|---|
| 1 | Révoquer/régénérer Stripe live, Brevo, Mongo ; secret scanning + push protection ; gitleaks | S (0,5) |
| 2 | `stripe.error.*` → `stripe.StripeError` / `SignatureVerificationError` (6 occurrences) + test ; message KYC réessayable | S (0,5) |
| 3 | Sauvegarde Mongo quotidienne → S3, restauration testée ; S3 obligatoire ; health réel (Mongo, âge des jobs, disque) ; Sentry back + front ; UptimeRobot | M (1,5) |
| 4 | Rate limiting (slowapi), bcrypt en `to_thread`, `/docs` fermés, CORS sans `*`, en-têtes nginx, JWT 24 h + `password_changed_at`, route reset-password admin supprimée, webhook paiements supprimé, code OTP hors objet, une seule adresse admin, double opt-in, SPF/DKIM/DMARC, **`ErrorBoundary` + `GENERATE_SOURCEMAP=false`** | M (2,5) |
| 5 | **Mandat simple** complet (§5.3, sans aucune clause art. 78) relu par le conseil ; dates `signed_at`/`ends_at`/`tail_ends_at` ; caducité au refus ; bouton « Résilier » + LRE automatique ; renouvellement en libre-service ; liste nominative des présentés en fin de mandat | M (3) |
| 6 | **Barème 6 % / min 4 000 € / cédant débiteur / HT d'abord** dans `offer.js`, `business_model.py`, `/config`, tests ; suppression des cartes de débiteur, du `CommissionNotice` acquéreur et de la clause acquéreur du NDA ; calculateur | S (1) |
| 7 | **Signature avancée eIDAS** (mandat, offre acceptée) avec horodatage ; OTP conservé pour le NDA ; page de preuve dans les PDF ; exemplaires envoyés aux deux parties | M (2,5) |
| 8 | **Gabarits NDA / offre nettoyés** (variables, blancs, montants `fr-FR`, résumé 5 lignes, case en fin de défilement) | S (1) |
| 9 | Inscription cédant sans dépendance ADEME (indisponible ≠ introuvable, cache 24 h, vérification différée, blocage seulement à la publication) | S (1) |
| 10 | **Messagerie** par couple (annonce, acquéreur), `sender_label`, bon destinataire, fil nommé, bonne conversation ouverte, layout mobile | M (3) |
| 11 | **Publication automatique** + post-modération 48 h + refus à motifs ; retrait/pause/vendue en libre-service ; « vendue autrement » ⇒ rappel de clause + veille | M (2,5) |
| 12 | **Accueil, Vendre, Reprendre, confiance, mobile, SEO, a11y** : hero mono-cible, bande d'autorité, calculateur, fondateur + Cal.com, FAQ 5, pied de page légal, mentions et confidentialité complétées (`REACT_APP_LEGAL_DRAFT=false`), carte T dans le JSON-LD, bug tarifs mobile, compteurs à 0 masqués, `noindex` ciblés, domaine canonique `cessionrge.fr` + 301, fiches hors sitemap, polices auto-hébergées, encart « nous pouvons accompagner » retiré, bloc « domaines complémentaires » supprimé, onglets accessibles, focus visible, aucun texte < 13 px, événements Plausible, Search Console ; visuels provisoires | L (7-8) |
| 13 | **Champ qualification générique** dans le modèle de données (RGE / Qualibat / Qualifelec, source : ADEME / certificat déposé) et pages métier × département non limitées au RGE | S (1) |
| 14 | **Transition de la production** (§7.8) : script d'inventaire du registre, statuts « annulé — test interne », purge des annonces de test du site et du sitemap, e-mail d'information, avenants proposés | S (1) |

**P1 — semaines 7-14 (≈ 24-28 jours), acquisition lancée en parallèle à partir de la semaine 7** (le mandat est propre : on peut pousser des artisans vers le site)

| # | Changement | Effort (jours) |
|---|---|---|
| 15 | **Encaissement** : rédacteur d'acte obligatoire à l'offre acceptée, type titres/fonds, « Déclarer la vente » croisé, note d'honoraires + ordre de paiement au rédacteur, **Stripe Invoicing** (facture conforme, lien de paiement, relances adaptées titres/fonds, webhook), routes admin, PDF maison supprimé, modèle de mise en demeure | L (5) |
| 16 | **Veille BODACC + RNE/INPI** mensuelle sur SIREN sous mandat/clause de suite/NDA ; relances cédant J+60/J+120 ; KPI « incidents sans vente déclarée » et « montant recouvré » | M (2) |
| 17 | Estimateur public `/estimer` (multiples recalibrés, pédagogie de la valeur, double opt-in) ; alerte prix hors fourchette | M (2,5) |
| 18 | Création d'annonce en 3 écrans, brouillon serveur, validation, bloc « ce qui rassure », titre, description, motif, département ; fiche et `ListingCard` enrichies ; une seule page de recherche | M (3) |
| 19 | Profil repreneur + score + carte repreneur ; relances J+2/J+5, expiration J+10, acceptation automatique ≥ 50 ; alertes sans compte | M (2,5) |
| 20 | **KYC au NDA** avec repli et mesure du taux d'échec ; origine des fonds déclarée ; data room après NDA ; LOI → offre indicative ; worker pdf.js embarqué ; NDA-cadre pour acheteurs récurrents | L (5) |
| 21 | Diagnostic de transmissibilité RGE gratuit (version courte publique depuis les données ADEME, complète en data room) | S (1) |
| 22 | Séquences e-mail complètes (§7.5), dashboard cédant « À traiter », admin « À faire » + écran du lundi + digest quotidien, compteurs corrigés | M (3) |
| 23 | **LCB-FT / RGPD / DSA, partie code** : export du rapport Stripe dans le dossier client + rédaction de la session, index TTL, suppression/export de compte, purge du KYC manuel, page « Signaler un contenu », motifs de retrait | M (2) ; procédure LCB-FT, AIPD (outil PIA CNIL) et formation : temps fondateur hors code (1-2 jours) |
| 24 | Pipeline open data hebdo (comptage, segments, exclusions, LIA) + webhook rebonds ; pages métier × département sur données réelles (`noindex` tant que vides) | M (2,5) |
| 25 | Section « Annonces de cabinets partenaires » (badge distinct, lien sortant, plafond 20) ; section « Vos conseils » statique ; conventions courtier crédit/assurance (routage) | S (1) code / M négociation |

**Après J+100, avant la revue M+6 — aucun chantier de plus d'un jour.** Contenu (3 guides, baromètre n° 1, textes des pages département) = 1-2 h/semaine d'écriture ; mandat de recherche (page + modèle relu) seulement quand un consolidateur répond ; visuels définitifs (graphiste) ; test courrier.

**P2 — après le premier closing**

Suppression du code mort (≈ 900 lignes), découpage de `server.py` en routeurs, SDK Brevo → `requests`, tests front minimaux (rendu des 5 pages publiques) et tests Stripe/jobs/closing, CI reliée au déploiement, uploads vérifiés par octets magiques, TOTP admin, page `/chiffres`, SMS OTP si et seulement si des profils fictifs apparaissent, diagnostic payant hors catalogue (après M+12 et avis), migration Vite (jamais Next.js/Kubernetes/Atlas/ClamAV).

### 7.8 Mise en production : transition des comptes et contrats existants

La base contient des mandats signés sous l'ancien tunnel (mandats n° 7 et 8 créés par les parcours d'audit, `ux-vendeur.md` §2.7 ; 5 annonces seedées avec des mandats signés dont 2 « commission à la charge de l'acquéreur », `ux-acheteur.md` §0 ; le hub affiche « 7 entreprises »), peut-être des NDA/LOI réels (exclusivité 45 j, non-contournement 24 mois, clause de commission acquéreur), et des comptes qui ont lu l'ancien barème. Règles :

1. **Inventaire (jour 1 de la semaine 2)** : export CSV du registre (`/admin/mandates`), classement de chaque mandat en réel / test ; même chose pour les annonces, NDA et LOI. Le registre est continu et numéroté : **rien n'est supprimé** ; un mandat de test passe en statut « annulé — test interne », numéro conservé, mention au registre. Les annonces de test sont dépubliées et retirées du sitemap avant la demande d'indexation ; le compteur « 7 entreprises » disparaît avec la règle « jamais de compteur sous 10 ».
2. **Mandats exclusifs réels** : e-mail individuel au cédant proposant un nouveau mandat simple au barème 6 % (nouveau numéro) et l'annulation du précédent d'un commun accord (avenant signé par les deux parties, trace au registre) ; tant qu'il n'a pas signé, l'ancien mandat reste en vigueur à ses conditions et on l'honore (y compris le barème 10/8/6 à son avantage si la vente aboutit : on ne change pas un contrat signé unilatéralement).
3. **Annonces « commission à la charge de l'acquéreur »** : repassées « cédant débiteur » uniquement par l'avenant du point 2 ; sans avenant, elles restent telles quelles et le bandeau TTC reste affiché sur elles seules.
4. **NDA/LOI déjà signés** : ce sont des contrats ; ils gardent leurs effets (exclusivité, non-contournement) jusqu'à leur terme ; aucun nouveau n'est généré sur les anciens gabarits.
5. **Information des utilisateurs** : un e-mail à tous les comptes (nouveau barème, nouveau mandat, nouvelles CGU avec 30 jours de préavis, lien vers la page tarif) ; publié aussi en bandeau une semaine dans les espaces connectés.
6. **Comptes de test** (`seller SAS`, `buyer SAS`, `ux-vendeur-1@test.fr`…) : supprimés, avec leurs messages, après l'export d'inventaire.

---

## 8. Technique et coûts

**Architecture cible (≈ 10-20 €/mois fixes)** : GitHub privé → GitHub Actions (pytest avec mongomock + job hebdo `mongo:7` réel, build front) → images sur ghcr.io → webhook Dokploy après succès. VPS Hetzner CX23 (2 vCPU/4 Go, ≈ 6 € ; CX33 ≈ 12 € seulement si le build reste sur le VPS) avec Traefik (TLS, règle `cessionrge.fr` + `/api` → backend, rate-limit `/api/auth`), nginx statique pré-rendu avec en-têtes de sécurité, backend uvicorn mono-processus (slowapi, bcrypt hors boucle, tâches internes avec heartbeat), `mongo:7` avec `mongodump` nocturne vers Scaleway Object Storage fr-par (75 Go offerts, rétention 30 j, restauration testée). Rien d'autre : pas de Redis, pas de worker, pas de Node serveur.

**Sécurité** : secrets révoqués et scanning actif ; `/docs` fermés ; CORS explicite ; HSTS/CSP/X-Frame-Options ; JWT 24 h révocable ; OTP hors objet ; uploads vérifiés par octets magiques et PDF réécrits sans JS ; admin avec second facteur (réutiliser l'OTP) ; `/admin/messages` réduit aux incidents journalisés ; **images d'identité jamais stockées** (rapport Stripe exporté puis session rédigée, §4.1) ; index TTL ; suppression/export de compte conservant mandats, factures et preuves (10 ans comptable / 5 ans LCB-FT).

**Observabilité à 0 €** : Sentry (back + front), UptimeRobot sur `/api/health` réel (mot-clé `"db":"ok"`, `jobs_age_seconds < 7200`), alertes disque Hetzner, notifications Dokploy sur échec de déploiement, digest quotidien admin.

**Continuité fondateur** : clause de substitution **au profit d'un autre titulaire de carte T** nommé dans une procédure écrite (accès, sauvegardes, registre, Stripe, prestataire de signature) pour qu'une indisponibilité de 3 mois ne fasse pas tomber les mandats et commissions en cours ; personne d'autre ne peut négocier pour AlterEgo sans attestation d'habilitation CCI (§4.1) ; RC pro vérifiée pour l'intermédiation sur **cessions de titres** (souvent exclue des polices d'agent immobilier).

**Coût mensuel** : voir §5.4 : ≈ 320-600 €/mois tout compris (dont ≈ 180-275 € de charges fixes d'AlterEgo : RC pro, expert-comptable), ≈ 35-120 € d'infrastructure et outils seuls. Stripe Identity reste le poste variable (≈ 1,25-1,50 € par vérification, `marche-concurrence.md` §4, à confirmer sur stripe.com) : au NDA, 10-30 €/mois.

---

## 9. Risques et angles morts

| Risque / angle mort | Probabilité | Traitement |
|---|---|---|
| **La niche ne produit pas 3 annonces/mois** (segment A plus petit que prévu, e-mailing à 1-1,4 % de positives et 10-15 % de conversion, SEO en 6-9 mois) | Élevée | Comptage réel en semaine 2 ; déclencheur M+6 pré-engagé ; relais SEO + prescripteurs + seeding d'annonces de cabinets ; test courrier à M+4 |
| **Marque et domaine** : l'élargissement à Qualibat/Qualifelec se déclenchera probablement ; `cessionrge.fr`, les pages RGE et le discours « tiers de confiance RGE » ne se transfèrent pas tels quels | Élevée | Déposer maintenant un domaine ombrelle (« cession bâtiment » par AlterEgo, 250-500 €) ; CessionRGE devient une verticale sous l'ombrelle, ses pages gardent leur SEO ; modèle de données générique dès P0 #13. **Ce que coûte l'élargissement** : 3-5 jours (nouvelle verticale, badge « qualification déclarée, certificat en data room » car Qualibat/Qualifelec n'ont pas d'open data : le badge « vérifié » reste réservé au RGE/ADEME) ; le sourcing se fait alors sur Sirene (codes NAF 43.2x/43.3x) × RNE, qui sont de l'open data |
| **Délai d'encaissement sur les fonds** : prix indisponible 3-5 mois après l'acte (L141-14, 1684 CGI) | Certaine | Modélisé (§5.4) ; commission payée par le séquestre à la libération ; relances calées J+90/120/150 ; pas de plan de trésorerie qui compte un closing avant M+14 |
| **Fuite non prouvable** : repreneur qui identifie l'entreprise au teaser (département + activité + CA suffisent localement) et traite en direct sans être nommément présenté ; cession de parts avec dirigeant maintenu 6-12 mois invisible au BODACC | Élevée (25-30 % de fuite réaliste) | E-mail confirmé + nom + téléphone avant tout message ; liste nominative des présentés en fin de mandat ; clause de suite 18 mois ; veille RNE à J+90/180/360 ; 1-2 mises en demeure/an budgétées (1-2 k€) |
| **Mandat contesté** (nullité relative invoquée par le mandant) | Moyenne | Relecture avocat, mandat simple sans clause art. 78, objet déterminé, remise prouvée, signature avancée, tous les associés signataires, signature à distance uniquement |
| **Financement de l'acquéreur** : 70 % de dette bancaire, banques méfiantes sur le bâtiment post-MaPrimeRénov' ; aucun plan ne modélise l'échec après offre acceptée | Élevée | Crédit vendeur et earn-out dans le formulaire d'offre ; partenaire courtier à l'offre acceptée ; garantie Bpifrance Transmission expliquée dans un guide ; taux de closing modélisé à 12 % et non 15 % |
| **Démarrage à froid côté repreneurs** : premières annonces avec peu de contacts, cédant qui résilie à 60 j et dit du mal du site | Élevée | Seeding d'offre en section séparée, promesse calibrée, hebdo cédant avec comparaison à la médiane, alerte sans compte sur chaque page |
| **Stripe Identity échoue chez une partie des cédants âgés** (taux inconnu : aucun audit ne le chiffre) | Inconnue | Repli (visio de 5 min ou pièce envoyée au prestataire de signature) ; jamais de blocage définitif ; KPI « échecs KYC » dès le premier mois |
| **Apport d'affaires expert-comptable interdit** par la déontologie | Moyenne | 0 € dans tous les scénarios ; question écrite gratuite à l'Ordre ; courtier crédit (indicateur) et assurance seulement |
| **Prix moyen** : 300 k€ dans les plans, ≈ 195 k€ retenu sur des sources partiellement non confirmées (Altares : lecture de tableau ; ISM-MAAF : chiffre de presse) | Certaine (écart) / Moyenne (valeur exacte) | Tous les chiffres recalculés sur 195 k€ ; vérifier les deux PDF en semaine 2 (une heure) ; le plancher protège le bas de la distribution sans sauver la moyenne |
| **Deux régimes d'annonces sur le site** (mandat AlterEgo vs rediffusion de cabinets) | Moyenne | Section et badge séparés, plafond 20, retrait à 20 annonces propres ; aucune promesse de vérification sur les rediffusions |
| **Fraudeurs cherchant une coquille RGE** (2027) | Moyenne | KYC au NDA, origine des fonds avant data room, score, refus affiché ; LCB-FT en P1 ; avant le NDA le filtre est déclaratif et le site le dit |
| **TVA** : 20 % non récupérable pour les cédants personnes physiques (7,2 % TTC) ; exonération « négociation de titres » incertaine | Moyenne | Afficher le TTC à ce public ; motif de refus mesuré ; avis fiscal seulement au premier cas concret |
| **Temps fondateur** : 50-60 jours de développement + acquisition + juridique pour une personne ; risque de 100 jours de code et zéro annonce | Élevée | Budget temps consolidé (§10.1, décision 14) ; acquisition en semaine 7 quoi qu'il reste en P1 ; aucun chantier > 1 jour après J+100 ; critère d'arrêt en euros |
| **Démarchage** : règles téléphoniques modifiées le 11 août 2026 (B2B ?) ; e-mails de prospection = publicités Hoguet | Moyenne | Créneau à l'initiative du cédant uniquement ; mentions carte T sur chaque envoi ; question posée au conseil dans le lot 1 |
| **Fondateur point de défaillance unique** (3 mois d'indisponibilité) | Faible mais grave | Substitution au profit d'un confrère carte T, procédure écrite, sauvegardes restaurables, tout en repli automatique |

---

## 10. Les décisions à prendre maintenant, puis les premiers 120 jours

### 10.1 Décisions (chacune avec sa valeur par défaut)

1. **Rester intermédiaire mandaté, pas de modèle média ni de deux entités.** Oui. C'est le seul levier de revenu > 10 k€ par événement et la seule promesse différenciante ; le média plafonne à 10-30 k€/an.
2. **Mandat simple obligatoire avant publication, sans exclusivité, sans pénalité, sans garantie de rémunération (donc hors art. 78), dénonçable à tout moment avec 15 jours de préavis par bouton + LRE automatique, clause de suite 18 mois sur les acquéreurs nommément présentés.** Oui. Hoguet impose le mandat pour un fonds ; ce qui dissuadait était l'exclusivité, pas la signature.
3. **Barème 6 % HT (3 % > 1 M€), minimum 4 000 € HT, cédant toujours débiteur, HT d'abord, TTC affiché aux personnes physiques.** Oui, avec mesure du motif de refus « commission à ma charge » et réexamen à M+6 si > 20 %.
4. **KYC Stripe déplacé au NDA ; avant tout message : e-mail confirmé, profil, téléphone déclaré, pas de SMS OTP.** Oui.
5. **Data room après NDA + origine des fonds ; LOI remplacée par l'offre indicative.** Oui.
6. **Publication automatique avec post-modération.** Oui. Sans cela, le site ne tourne pas sans vous.
7. **Encaissement : facture Stripe Invoicing à l'acte ; titres payables sous 30 j, fonds payés par le séquestre à la libération du prix ; ordre irrévocable au rédacteur ; veille BODACC/RNE.** Oui.
8. **Diagnostic RGE gratuit pendant 12 mois ; version payante hors catalogue pas avant M+12, et seulement avec ≥ 50 data rooms ouvertes et un avis positif ; 0 € dans les scénarios.** Oui.
9. **Mandat de recherche construit à la première réponse d'un consolidateur, pas avant ; e-mails personnels dès M+4, 1 h/semaine.** Oui.
10. **Abandonner le courtage CEE, les sous-traitants/fournisseurs, les abonnements, l'automation LinkedIn, le courrier en continu, la publicité, le SMS OTP.** Oui, définitivement (le courrier : un seul test).
11. **Marque : déposer dès maintenant un domaine ombrelle et rendre le modèle de données générique ; élargissement pré-engagé à M+6 si < 3 annonces publiées/mois sur les deux derniers mois.** Oui. C'est la décision la plus structurante et la moins chère (3-5 jours de dev le moment venu).
12. **Budget conseil : 3 000-5 000 € en année 1, en deux lots.** Lot 1 (semaines 1-4, 2 500-3 500 €) : mandat simple + clause de suite + dénonciation par LRE, NDA, offre indicative, CGU/DSA, mentions, rétractation, question démarchage. Lot 2, à la demande : mandat de recherche (500-1 000 €, avant le premier), avis TVA titres (1 000-2 000 €, avant le premier closing concerné). Gratuit : question écrite à l'Ordre des experts-comptables (apport), CCI (mentions de la carte, habilitation), assureur (RC titres), outil PIA de la CNIL (AIPD), modèles de procédure LCB-FT des syndicats professionnels + formation 200-400 €. Les 2 500-4 000 € des plans couvraient le lot 1 seul ; une « consultation unique » pour douze sujets n'était pas réaliste.
13. **Critère d'arrêt écrit, en euros et en jalons** (valeur par défaut, à signer avant la semaine 1) : plafond de **15 000 € de dépenses cumulées hors temps en année 1** et **22 000 € à M+18** ; à M+6, si < 3 annonces publiées/mois sur les deux derniers mois **et** < 12 publiées en cumul → élargissement bâtiment (pas arrêt) ; à M+12, si < 20 annonces publiées en cumul **ou** aucune offre acceptée → gel (site en veille ≈ 20 €/mois, aucune dépense nouvelle, mandats en cours honorés) ; à M+18, si aucun closing encaissé **et** < 15 k€ HT facturés → arrêt de l'activité commerciale, mandats et clauses de suite honorés jusqu'à leur terme. Trésorerie personnelle : **au moins 24 mois d'un autre revenu**.
14. **Temps fondateur, budget unique** : M+0 → M+3,5 (construction, 14 semaines) : **4 jours de développement + 1 jour de juridique/acquisition/contenu par semaine, soit un temps plein** ; M+4 → M+9 (campagne) : **10-15 h/semaine** (lecture et réponses à la prospection 3-4 h ; appels de 15 min 1-2 h ; « À faire » 1 h ; contenu 1-2 h ; partenaires/consolidateurs 1 h ; corrections et petits chantiers 3-5 h) ; **à partir de M+10 : 5-7 h/semaine** (« À faire » 1 h, appels 1-2 h, réponses 1 h, contenu 1 h, partenaires 0,5-1 h). Les « 5 h/semaine » du brief sont une réalité de M+10, pas avant ; si ce n'est pas acceptable, réduire le périmètre P1 (#21, #24, #25 d'abord), jamais P0.
15. **Portrait, nom et parcours sur l'accueil.** Oui. Rien n'augmente plus la confiance à coût nul, et c'est ce qu'un artisan de 60 ans cherche avant de confier ses bilans.

### 10.2 Les premiers 120 jours

**Semaine 1 — sécuriser, désamorcer, indexer (≈ 5 jours de dev : P0 #1-4 + la partie SEO/mentions/bug mobile de #12)**
Révocation des secrets, `stripe.error`, sauvegarde Mongo + S3, rate limiting, `/docs`, CORS, en-têtes, Sentry/UptimeRobot, health réel, OTP hors objet, double opt-in, SPF/DKIM/DMARC, `ErrorBoundary`, domaine canonique `cessionrge.fr` + 301, Search Console, fiches hors sitemap, mentions légales et confidentialité complétées, bandeau brouillon retiré, bug tarifs mobile, compteurs à 0 masqués. Brief complet envoyé à l'avocat (lot 1, rendez-vous semaine 4). Vérification des mentions exactes de la carte T et de la RC pro (titres) auprès de la CCI et de l'assureur. Dépôt du domaine ombrelle. Signature du critère d'arrêt (décision 13).

**Semaine 2 — mesurer avant de dépenser (1 jour hors code)**
Comptage réel du segment A et de la présence d'e-mails sur ADEME × Sirene × RNE ; vérification des deux PDF de prix (Altares, ISM-MAAF) ; inventaire du registre et des contrats existants (§7.8) ; LIA rédigée ; commande des domaines satellites seulement si le comptage le justifie.

**Semaines 2-6 — le contrat et l'argent (P0 #5-14)**
Mandat simple complet, barème 6 %, signature avancée, LRE, gabarits nettoyés, messagerie par couple, inscription sans blocage ADEME, publication automatique + refus motivés + libre-service, accueil / Vendre / Reprendre cibles (hero, bande d'autorité, calculateur, fondateur + Cal.com, FAQ 5, pied de page légal, a11y, événements Plausible) sans les visuels définitifs, champ qualification générique, transition des comptes et contrats. Retour de l'avocat intégré. **Jalon J+45 : plus aucun mandat annulable n'est signé ; plus aucune annonce n'attend un humain ; un cédant publie en 10 minutes ; les mandats de test sont annulés au registre et les anciens cédants informés.**

**Semaines 7-14 — encaissement, tunnel repreneur, acquisition lancée (P1 #15-25)**
Encaissement et veille BODACC/RNE ; estimateur public ; annonce en 3 écrans ; profil repreneur + KYC au NDA + offre indicative ; diagnostic RGE gratuit ; séquences, « À faire », écran du lundi ; LCB-FT/RGPD/DSA ; pipeline open data ; section partenaires. **En parallèle dès la semaine 7** : domaines satellites en warm-up, première séquence prête, dossiers Bpifrance Transmission / Transentreprise, proposition de rediffusion à 5 cabinets, premiers e-mails aux consolidateurs. **Jalon J+75 : première campagne de 1 500 envois partie.** **Jalon J+100 : un repreneur contacte sans passeport et signe un NDA après KYC ; une vente déclarée produit une facture Stripe envoyée au rédacteur d'acte ; plus aucun chantier de plus d'un jour avant la revue M+6.**

**Semaines 15-17 (M+4) — pilotage, contenu, mesure**
Lecture des réponses de prospection 30-45 min/jour ; créneaux de 15 min après mandat ; test courrier de 300 lettres ; 3 guides et baromètre n° 1 à 1-2 h/semaine ; visuels définitifs. **Jalon J+120 : 3-6 annonces publiées, zéro action humaine bloquante par semaine, indexation sur la marque et 5 requêtes RGE, taux création → mandat mesuré (si < 50 % : créneau avant signature), CTA du hero décidé sur les événements Plausible. Revue M+4 et préparation de la décision de M+6.**

**Rituel hebdomadaire en croisière (M+4 → M+9 : 10-15 h ; dès M+10 : 5-7 h)** : lundi 15 minutes sur l'écran des 10 KPI ; 1 h « À faire » ; 1-2 h d'appels de 15 min et réponses aux cédants ; 1-4 h de lecture des réponses de prospection selon la campagne ; 1 h de contenu ; 0,5-1 h partenaires/consolidateurs.

**Ce que ce rapport ne promet pas** : un salaire en année 1 ni en année 2 ; une plateforme « à l'échelle » sur la seule niche RGE ; « zéro humain » avec des cédants de 60 ans ; 5 h par semaine avant M+10. Il promet un produit qui transforme du temps en créances recouvrables plutôt qu'en annonces, à un coût de fonctionnement de 320-600 €/mois, un critère d'arrêt écrit et une décision claire à M+6.
