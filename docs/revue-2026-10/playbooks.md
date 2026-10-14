# Playbooks — faire tourner une marketplace de cession d'entreprises RGE en autonomie

**Pour** : Micael (AlterEgo SAS / CessionRGE) — **Rédigé le** : 9 octobre 2026
**Angle** : growth/product lead, marketplaces B2B à faible volume et forte valeur unitaire. Évaluation sincère : ce qui marchera, ce qui ne marchera pas, et un plan d'acquisition chiffré sans commerciaux.

> **Méthode et limites.** 16 recherches web ont abouti (sources citées en lien). Le quota de recherche partagé a ensuite été épuisé et la politique d'egress de la session a refusé (403) toute lecture directe des pages primaires (acquire.com, flippa, empireflippers, bizbuysell, fusacq, cessionpme, data.gouv.fr, cnil.fr, inpi.fr, stripe.com, brevo.com, laposte.fr…). Chaque affirmation est donc marquée :
> - **[S]** sourcée par une page citée ;
> - **[M]** connaissance de fond non revérifiée aujourd'hui (ordre de grandeur fiable, chiffre exact à confirmer) ;
> - **[H]** hypothèse de travail à valider par le marché ou par le conseil juridique.

---

## 0. Verdict sincère en 12 lignes

1. **Le modèle « commission au succès uniquement, zéro paiement avant, zéro humain » ne finance pas la première année.** Cycle de vente d'une TPE en France : 12 à 24 mois une fois le processus lancé [S]. Médiane BizBuySell (USA, annonces en ligne) : ~200 jours [S]. Avec un prix moyen de cession TPE autour de 200 k€ [S] et un barème 10 %, chaque closing vaut ~15-20 k€ HT, mais le premier arrive au mieux à M+9/M+12. Il faut une trésorerie de 12 à 18 mois ou un revenu annexe.
2. **La niche RGE seule est trop étroite pour une marketplace de cession pure.** 45 000 à 65 000 entreprises RGE [S], dont ~25 % de dirigeants de 60 ans et plus [S] → 11 000 à 16 000 cédants « théoriques ». Avec un taux de cession effectif de 2 à 3 % par an [M], le flux national est de l'ordre de 250 à 500 cessions RGE par an, dont la majorité se fait de gré à gré (salariés, famille, concurrent) sans plateforme. Capter 10 % de ce flux est déjà ambitieux ; à 25-30 % de taux de vente des annonces publiées [M], cela donne 8 à 15 closings par an à maturité. C'est un revenu de 100 à 200 k€/an : viable pour un fondateur seul, pas un business « à l'échelle » sans élargissement (tout le bâtiment / artisanat, ou revenus annexes CEE et apport d'affaires déjà identifiés dans `docs/business-model-v2-rapport-ecarts.md`).
3. **La valeur « RGE » est fragile et le marché est en stress.** Le label ne suit pas en cession de fonds de commerce, seulement en cession de titres et à condition de garder le référent technique (déjà noté dans le rapport d'écarts). Les turbulences MaPrimeRénov' (coupes budgétaires et suspensions 2025) ont provoqué défaillances et ventes en détresse chez les installateurs [M]. Les acheteurs sérieux (consolidateurs PAC/ITE/PV, entreprises non-RGE voulant le label sans attendre une qualification + audit) existent, mais ils paient pour la **vitesse et la certitude** (titres + référent + historique de chantiers propres), pas pour une annonce.
4. **Le mandat obligatoire avant publication divise le haut de funnel.** Acquire.com et Flippa laissent publier en minutes et facturent une « peau dans le jeu » minime [S]. Recommandation : annonce teaser gratuite sans mandat, **mandat « juste-à-temps »** signé à la première demande de contact qualifiée (à valider par le conseil : le mandat doit précéder l'acte d'entremise, pas la publicité) [H].
5. **Ne pas monétiser l'acquéreur, c'est renoncer au côté le plus liquide et le plus solvable.** Fusacq, Cessionpme, Transentreprise, BizBuySell, Acquire monétisent tous l'accès acheteur (packs de mise en relation, abonnements annuels, accès anticipé) [S]. Deux voies compatibles avec Hoguet [H] : (a) **mandat de recherche** côté repreneur avec commission au closing (= « buyer wanted » monétisé) ; (b) séparer le **diffuseur d'annonces** (entité éditrice, abonnement acheteur, pas de carte T) du **mandataire** (AlterEgo, carte T, success fee). À trancher avec le conseil.
6. **« Sans commerciaux » n'est pas « sans humain ».** Les artisans de 60 ans qui cèdent l'œuvre de leur vie veulent une voix au téléphone au moins une fois. Tout automatiser sauf un créneau de 15 minutes réservable (Calendly) tient dans l'agenda d'un fondateur seul (20-30 appels/mois) et double la conversion annonce → mandat [H].
7. **Le vrai actif à construire n'est pas l'annuaire d'annonces, c'est la donnée.** La liste RGE est publique et quotidienne [S], Sirene est gratuit (date de création, effectif, NAF, localisation) [S], le RNE/INPI donne les dirigeants [M], le BODACC est en open data [M]. Croisées, ces bases donnent *la* liste nationale des entreprises RGE à céder dans les 5 ans. C'est le moteur d'acquisition (e-mailing B2B opt-out légal [S]), le moteur SEO (pages métier × département alimentées par des chiffres réels) et le moteur de confiance (baromètre public des cessions RGE).

Le reste du document détaille les playbooks et se termine par un plan chiffré (§ 9).

---

## 1. Comment les marketplaces de référence acquièrent et monétisent sans force de vente

### 1.1 Tableau de synthèse

| Plateforme | Acquisition vendeurs | Acquisition acheteurs | Monétisation (chiffres) | Leçon pour CessionRGE |
|---|---|---|---|---|
| **Acquire.com** (ex-MicroAcquire) | Au départ : **cold e-mails massifs** aux startups pour amorcer l'offre ; lancement Product Hunt ; puis bouche-à-oreille et contenu fondateur (podcasts, X/LinkedIn) [S] | Les acheteurs « suivent » une fois l'offre constituée ; 500 k+ acheteurs inscrits revendiqués [S] | Acheteurs : **390 $/an (Premium, startups ≤ 250 k$ de CA)** ou **780 $/an (Platinum)** ; vendeurs : **25-100 $/mois** de listing + **closing fee 6-8 %** dégressif [S]. Navigation gratuite, chat payant [S] | Amorcer l'offre par e-mailing ciblé ; abonnement acheteur = filtre anti-curieux + revenu récurrent ; petit frais vendeur = engagement |
| **Flippa** | Listing self-service à partir de **29 $** ; upgrades (confidentiel +199 $, privé +599 $) [S] ; outil de valorisation gratuit comme aimant ; SEO catégorie + blog + outil [S] | Alertes, enchères, « Verified buyer » ; marché partenaires (agences) [S] | **Success fee 3 à 10 %** selon tranche (10 % < 50 k$, 7,5 % 50-100 k$, 5 % au-delà selon sources tierces) ; broker 999 $ + 3-8 % ; FlippaPay 0,5 % côté acheteur [S] | Formule SEO prouvée : **page catégorie + cluster d'articles + outil dédié** (calculateur YouTube +2 612 % YoY selon Earned Media) [S] |
| **Empire Flippers** | Vetting gratuit, sélectif (seuil **2 000 $/mois de profit net**, 3 mois d'analytics) ; **~91 % de refus** souvent cité mais contesté [S] ; rapports trimestriels publics | Déverrouillage des annonces sous condition de vérification (dépôt / preuve de liquidités) [M] | **15 % < 700 k$, 8 % de 700 k$ à 5 M$, 2,5 % au-delà** ; minimum 10 k$ rapporté ; exclusivité 2 à 6 mois [S] | La **sélectivité publiée** est un argument marketing ; la vérification acheteur avant accès au détail est la norme |
| **BizBuySell** | Listing payant **Basic 89,95 $/mois (3 mois) ; Showcase 109,95 ; Diamond 259,95** ; plans brokers (BrokerWorks) [S] ; Insight Report trimestriel = contenu de référence [S] | Recherche, sauvegardes et **alertes gratuites** ; abonnement acheteur **Edge ~240 $/an** [S] | Listing fees + abonnement acheteur ; MDOM (médiane jours sur le marché) **~200 jours** [S] | Alertes gratuites + rapport trimestriel = acquisition acheteurs quasi gratuite ; publier son MDOM crée la confiance |
| **Fusacq** (FR) | Annonces alimentées par cabinets et cédants ; SEO d'annonces (URL par annonce indexées) [S] | Packs de **mises en relation** et abonnement **Elite** (accès anticipé 7 jours) [S] | **5 MER 150 € HT, 10 MER 235 €, 20 MER 325 €, 16 € HT la MER supplémentaire ; abonnements 695/945/1 195 €/an ; Elite 35 €/mois, 99 €/3 mois, 189 €/6 mois, 336 €/an** ; MER non concluante recréditée si signalée sous 2 mois [S] | Prix accepté en France pour un contact qualifié : **16 à 30 € HT** ; l'**accès anticipé** se vend 35 €/mois ; la **garantie de recrédit** lève la peur d'acheter |
| **Cessionpme** (FR) | Alimenté par cabinets, intermédiaires, agences immobilières et dirigeants [S] | Accès coordonnées payant (grille non récupérée) | Grille non récupérée (site inaccessible depuis la session) | Même modèle « diffuseur » que Fusacq ; sans carte T |
| **Transentreprise** (CCI + CMA, 78 départements) | Conseillers CCI/CMA qualifient les annonces ; **~45 000 annonces** agrégées [S] ; parcours cédant payant (1 597 € HT, reste à charge 426 € après subventions, exemple Landes) [S] | **Gratuit** pour le repreneur : compte, critères, **alerte mail**, fiche de cadrage [S] | Subventions publiques + prestations cédants | Partenaire de diffusion naturel (CMA = artisans) ; vos annonces peuvent y être relayées |
| **Bpifrance Bourse de la Transmission** | Annonces diffusées/qualifiées par partenaires agréés ; **43-45 000 annonces** + locaux [S] | Alertes et recherche par critères [S] | Gratuit (outil public) | Devenir **partenaire agréé** = diffusion gratuite + caution institutionnelle |
| **CRA** (association) | 1 300 repreneurs membres ; **ni honoraires ni commission** [S] | Adhésion | Cotisations | Concurrent « gratuit » sur le segment senior ; positionner CessionRGE sur la vitesse et la vérification |
| **CCI Côte d'Azur (grille 2024)** | — | — | Success fee **450 € (< 50 k€), 900 € au-delà, plafond 10 800 €** [S] | Référence d'un prix « institutionnel » bas pour un success fee en France |

### 1.2 Les mécaniques réutilisables

1. **Seed supply first, by cold outreach.** Acquire a amorcé l'offre par e-mailing massif aux startups ; « start by getting quality sellers on the platform, and the buyers will follow » [S]. Transposition : e-mailing B2B aux dirigeants RGE seniors (§ 2).
2. **L'outil gratuit comme aimant à vendeurs.** Calculateur de valorisation (Flippa, Acquire, BizBuySell valuation report ~60 $ [M]). Le fondateur d'Acquire décrit trois « buckets » d'acheteurs par profit net [S] ; le calculateur sert à segmenter l'offre. Transposition : « Estimez votre entreprise RGE en 3 minutes » (CA, EBE, effectif, qualifications, ancienneté, carnet de commandes) → fourchette + rapport PDF e-mailé → annonce pré-remplie.
3. **SEO programmatique = page catégorie + cluster éditorial + outil** (Earned Media pour Flippa) [S]. Transposition : pages `/reprendre/[métier-rge]/[département]` alimentées par les comptages réels d'entreprises RGE issus de l'open data, un guide par question d'intention (« la qualification RGE est-elle transmissible ? », « combien vaut une entreprise de pompes à chaleur ? »), et l'estimateur. Risque : contenu mince si les pages ne contiennent pas de données réelles ; l'open data RGE est précisément ce qui rend chaque page unique.
4. **Alertes gratuites + accès anticipé payant** (BizBuySell alertes gratuites ; Fusacq Elite 7 jours d'avance à 35 €/mois) [S]. C'est la façon la plus propre de monétiser la rareté côté acheteur sans facturer la transaction.
5. **Rapport de marché périodique** (BizBuySell Insight Report, rapports Empire Flippers) [S]. Transposition : « Baromètre trimestriel de la cession RGE » (nb d'entreprises RGE, part des dirigeants 60+, délais, multiples observés) → relais presse pro (Batiactu, Le Moniteur), backlinks, newsletter.
6. **Sélectivité affichée.** Le « 91 % de refus » d'Empire Flippers est un argument marketing même contesté [S]. Transposition : « Seules les entreprises avec 3 bilans et une qualification RGE active sont publiées » + statistiques publiques.
7. **Garantie sur le service acheteur** (Fusacq recrédite une mise en relation non concluante) [S].

---

## 2. Sourcing automatisé des cédants en France

### 2.1 Données ouvertes à croiser

| Source | Contenu utile | Accès / coût | Statut |
|---|---|---|---|
| **Liste des entreprises RGE** (data.gouv.fr, France Rénov' / Anah / ADEME) | SIRET, raison sociale, adresse, **domaine de travaux**, organisme et qualification, dates de validité ; **mise à jour quotidienne** ; pas de nomenclature normalisée entre organismes [S] | Gratuit, Licence Ouverte (ressources de type URL/API) [S] | [S] |
| **Services Artisans RGE-SA** (data.gouv.fr, jeu tiers) | ~45 000 entreprises enrichies (géoloc, slugs métiers, organismes), CSV/NDJSON, mensuel [S] | Gratuit | [S], producteur non administratif |
| **Sirene / API Sirene (INSEE)** | Recherche multicritère : activité (NAF), localisation, **effectif, date de création** ; liens de succession d'établissements ; **pas de date de naissance du dirigeant** ; drapeau d'opposition à la prospection (masquage) [S] | Gratuit (compte api.insee.fr) ; sirene.fr fermé depuis déc. 2025 → api.gouv / data.gouv [S] | [S] |
| **RNE (INPI)** | Dirigeants des sociétés (nom, qualité) ; mois/année de naissance pour les personnes physiques dans l'API RNE [M] | Gratuit sur inscription (API + fichiers) [M] | [M] |
| **Pappers / Societeinfo (agrégateurs)** | Recherche avancée par **âge du dirigeant**, date de création, NAF, département, effectif, CA ; export ; e-mails/téléphones B2B (Societeinfo) [M] ; Societeinfo documente spécifiquement les listes RGE pour la prospection [S] | API Pappers à l'unité (quelques centimes par appel) ou abonnement mensuel ; Societeinfo crédits/abonnement [M] | [M] |
| **BODACC** (open data DILA) | Ventes et cessions de fonds, immatriculations, modifications (changement de dirigeant), procédures collectives ; API Opendatasoft, Licence Ouverte [M] | Gratuit | [M] |
| **Infogreffe / Annuaire des entreprises (api.gouv)** | Comptes annuels (quand déposés et non confidentiels), actes [M] | Gratuit (annuaire) / payant (Infogreffe documents) | [M] |

**Pipeline recommandé (hebdomadaire, un script) :**
1. Télécharger la liste RGE → dédupliquer par SIREN (≈ 45-65 k entreprises) [S].
2. Joindre Sirene : date de création, effectif, NAF, commune. Filtrer : créée depuis ≥ 8 ans, effectif ≥ 3, hors micro-entreprises.
3. Joindre RNE/Pappers : âge du dirigeant principal. Segments : **A = dirigeant ≥ 58 ans** (cession retraite, ~25 % des PME [S]) ; **B = qualification RGE expirant < 12 mois** (angle « renouveler ou céder ? ») ; **C = BODACC changement de dirigeant / procédure collective** (ventes en détresse, à traiter prudemment).
4. Enrichir l'e-mail professionnel (générique `contact@` prioritaire, nominatif ensuite) via Societeinfo/Pappers ou la fiche France Rénov' [M].
5. Exclure les SIREN ayant exercé l'opposition à la prospection dans Sirene [S] et les désabonnés.

Ordre de grandeur du **segment A** : 11 000 à 16 000 entreprises ; à 2 000 contacts/mois, le fichier se renouvelle tous les 6 à 8 mois, ce qui laisse la place à 3 à 4 séquences différentes par an.

### 2.2 E-mailing B2B RGPD-compatible

- **Cadre** : en B2B, l'e-mail de prospection relève de l'**opt-out** (pas de consentement préalable) si le message concerne la fonction du destinataire, indique la source de l'adresse au premier contact et offre une opposition simple et gratuite ; base légale = intérêt légitime (fiche CNIL/Bpifrance) [S]. Une adresse nominative reste une donnée personnelle (information + droit d'opposition + durée de conservation limitée) [S/M].
- **Benchmarks de réponse** : moyenne mondiale **3,43 %** (Woodpecker, 20 M+ e-mails) ; campagnes standard **1-5 %**, bonnes **5-10 %**, top > 10 % (lemlist) ; France : **médiane 4,9 %**, fourchette 3,8-7,2 % (Overloop/Sortlist, 50 k e-mails) ; longueur optimale **75-150 mots** (~9 % de réponse) [S]. Les taux d'ouverture ne sont plus fiables (Apple MPP) : piloter au taux de réponse [S].
- **Infra et coûts [M]** : 2 domaines satellites (ex. `cession-rge.fr`, `cessionrge.com`) + 2-4 boîtes Google Workspace/Zoho (~6-7 €/boîte/mois), warm-up 3 semaines, 30-50 envois/boîte/jour ; outil de séquence (Smartlead, Instantly, lemlist, Woodpecker) **40 à 100 €/mois** ; total **≈ 100-150 €/mois** pour 2 000-3 000 envois mensuels.
- **Séquence type (3 e-mails, 12 jours)** : (1) « 1 dirigeant RGE sur 4 a plus de 60 ans : combien vaut votre entreprise ? » → lien estimateur ; (2) cas concret anonymisé + question ouverte ; (3) break-up « je ferme votre dossier ». Objectif : **4 % de réponse, 25-35 % de réponses positives** → 20 à 30 conversations/mois pour 2 000 envois, **sans appel de prospection** (les positifs réservent un créneau ou lancent l'estimation).

### 2.3 Courrier postal

- Le courrier papier adressé au dirigeant est le canal le plus crédible pour un artisan de 60 ans et le moins saturé. Coût : affranchissement Lettre verte 20 g ~1,40 € [M] + impression/mise sous pli via service d'édition-routage (Maileva, Merci Facteur, Esker) **≈ 1,50-2,50 € la lettre tout compris** [M]. Taux de retour direct-mail B2B sur fichier prospect : **1 à 3 %** (ordre de grandeur DMA/ANA) [M].
- Usage recommandé : réserve pour le **segment A filtré** (dirigeant ≥ 60, effectif ≥ 5, pas d'e-mail trouvé) à 300-500 lettres/mois (**≈ 600-1 000 €/mois**), avec QR code vers l'estimateur et un numéro de rappel. Attendre 5 à 15 retours/mois.

### 2.4 LinkedIn

- Peu de dirigeants d'entreprises RGE seniors sont actifs sur LinkedIn ; en revanche **les acheteurs** (consolidateurs, cadres en reconversion, investisseurs) y sont. Automation (Waalaxy, lemlist, La Growth Machine) **≈ 50-100 €/mois** ; taux d'acceptation de connexion 20-40 % et de réponse 5-15 % selon les éditeurs (chiffres non indépendants) [M].
- Usage recommandé : côté **acheteurs** uniquement (voir § 4), et contenu organique du fondateur (1 post/semaine : chiffres du baromètre, cas anonymisés).

### 2.5 Partenariats et affiliation (sans commercial)

- **CMA / CCI via Transentreprise** : réseau de 78 départements, conseillers locaux, **45 000 annonces**, alertes gratuites pour les repreneurs [S]. Objectif : accord de **rediffusion** des annonces CessionRGE (flux XML/CSV) et inscription comme partenaire de la **Bourse de la Transmission Bpifrance** (annonces diffusées par partenaires agréés) [S]. Coût : temps, pas d'argent.
- **CAPEB / FFB / organismes de qualification (Qualibat, Qualit'EnR, Qualifelec)** : ils connaissent les entreprises dont la qualification arrive à échéance ; proposer un contenu co-brandé « Transmettre une entreprise RGE » et un lien partenaire. Ne pas attendre de volume la première année : ces organismes bougent lentement [H].
- **Experts-comptables et avocats** : 1er prescripteur de cession en France. Mécanique auto-portante : page « Partenaires » + lien tracké + **commission d'apport 10-20 % du success fee** versée au closing. Point de vigilance Hoguet : la rémunération d'un apporteur occasionnel qui ne négocie pas est d'usage courant mais à cadrer contractuellement avec le conseil [H].
- **Affiliation entrante** : les cabinets qui alimentent Fusacq/Cessionpme publient déjà sur plusieurs sites ; proposer la **publication gratuite** de leurs annonces RGE avec lien vers leur cabinet (ils apportent l'offre, vous apportez l'audience ciblée) [H].

---

## 3. Qualification automatique des acquéreurs et des annonces

### 3.1 Acquéreurs

Ce que font les références :
- **Acquire.com** : inscription et navigation gratuites, mais **abonnement payant obligatoire pour contacter** et voir les données privées [S] ; l'abonnement est le premier filtre.
- **Flippa** : badge « Verified buyer » (identité) ; options confidentielles sous NDA [S].
- **Empire Flippers** : accès au détail sous condition de vérification des liquidités / dépôt [M] ; critères publiés.
- **BizBuySell** : contact direct gratuit, profil acheteur, abonnement Edge optionnel [S] → beaucoup de bruit, ce que les brokers US reprochent à la plateforme [M].

Playbook CessionRGE (déjà partiellement codé : Stripe Identity, NDA, LOI) :
1. **Questionnaire de 2 minutes à l'inscription** : type (personne physique en reconversion, dirigeant d'une entreprise du bâtiment, groupe/consolidateur, investisseur), zone, métiers RGE visés, budget (tranche), **apport personnel (tranche)**, financement envisagé (banque, BPI, crédit vendeur), horizon (< 6 mois / 6-12 / > 12), expérience du secteur, et pour les entreprises : SIREN (auto-enrichi Sirene : ancienneté, effectif, déjà RGE ou non).
2. **Score 0-100** : apport ≥ 30 % du budget (+30), horizon < 12 mois (+15), SIREN d'une entreprise du bâtiment existante (+20), déjà RGE (+10), identité vérifiée (+15), preuve de fonds déclarative (+10). Seuil : **≥ 50 pour demander un contact** ; < 50 → accès aux alertes et contenus uniquement.
3. **Preuve de fonds** : déclarative au début (comme recommandé dans le rapport d'écarts), puis attestation bancaire ou lettre de capacité demandée **par le cédant** à l'étape LOI (bouton « demander une preuve de fonds »), jamais par un humain de la plateforme.
4. **Identité** : Stripe Identity ~1,50 $ par vérification documentaire [M] ; à ne déclencher qu'au seuil ≥ 50 pour contenir le coût.
5. **Badges affichés au cédant** : « Identité vérifiée », « Entreprise du bâtiment établie (SIREN) », « Déjà RGE », « Financement déclaré », « A déjà signé un NDA sur la plateforme ».

### 3.2 Annonces

- **Score de complétude** (type LinkedIn) : 3 bilans (+25), CA/EBE des 3 derniers exercices (+15), effectif et masse salariale (+10), liste des qualifications RGE avec dates (+10), référent technique (+10 ; capital pour la transmission du label), carnet de commandes (+5), type de cession titres/fonds (+10), prix et justification (+10), photos anonymisées (+5). **Publication possible dès 60/100, mise en avant dans les alertes dès 85/100.**
- **Estimation automatique** : multiples sectoriels indicatifs (artisanat du bâtiment : fourchette sur le chiffre d'affaires et sur l'EBE retraité) [M], ajustés par l'ancienneté, l'effectif, la dépendance au dirigeant, la nature RGE (titres vs fonds) et l'état du marché. Afficher une **fourchette** et l'écart au prix demandé (« votre prix est 35 % au-dessus de la fourchette haute » = nudge avant publication).
- **Refus automatique** : qualification RGE expirée ou absente de la liste officielle (vérification quotidienne contre data.gouv) [S], SIREN radié, procédure collective au BODACC sans mention explicite [M].
- **Dossier de présentation (teaser + mémo)** généré automatiquement à partir du formulaire (PDF anonymisé pour le public, complet après NDA) — ce que font Acquire (auto-génération) et Flippa (assistant IA de listing) [M].

---

## 4. Mécaniques de liquidité

1. **Alertes par critères, gratuites, dès l'inscription** (BizBuySell, Transentreprise, Bpifrance) [S] : métier, département, tranche de prix, titres/fonds. Envoyer en **temps réel** pour les profils ≥ 50 et en digest hebdo pour les autres.
2. **Accès anticipé payant (72 h à 7 jours)** à la Fusacq Elite [S] : à vendre par une entité éditrice ou à offrir en contrepartie d'un **mandat de recherche** signé (voir § 8). La rareté côté offre est précisément ce que les consolidateurs paient.
3. **« Repreneur recherche » (mandats de recherche)** : fiche de cadrage repreneur publique et anonyme (comme Transentreprise) [S]. Pour les groupes qui veulent 5 installateurs PAC en Occitanie, c'est le produit à forte valeur : **mandat de recherche** avec commission au closing payée par l'acquéreur, et sourcing proactif automatisé (§ 2) sur leurs critères. Cela transforme le e-mailing de prospection en « nous avons un acquéreur vérifié qui cherche une entreprise comme la vôtre » — le message qui obtient les meilleurs taux de réponse en cession.
4. **Offres chiffrées plutôt qu'enchères** : les enchères (Flippa) fonctionnent pour les actifs numériques standardisés, pas pour une TPE avec salariés [M]. Garder le module d'offres existant, ajouter la **date limite de dépôt des offres** (process compétitif léger) et l'affichage au cédant du nombre de NDA signés / dossiers téléchargés.
5. **Délai moyen et leviers** : MDOM ~200 jours (BizBuySell) [S] ; 12-24 mois en France [S]. Leviers prouvés : prix dans la fourchette dès le départ, dossier complet (score ≥ 85), acheteurs pré-qualifiés, relances automatiques (§ 5). **Publier son propre délai médian** dès 10 ventes.
6. **Objectif de KPI de liquidité** (à afficher dans le back-office) : NDA signés par annonce à 30 jours (cible ≥ 3), LOI à 90 jours (cible ≥ 1 sur 3 annonces), closing à 270 jours.

---

## 5. Rétention et réactivation automatisées

| Déclencheur | Action automatique | Objectif |
|---|---|---|
| J+0 publication | E-mail « votre annonce est en ligne » + checklist pour passer de 60 à 85/100 | Complétude |
| J+7 | Statistiques : vues, alertes déclenchées, NDA. Si 0 NDA : « 3 raisons fréquentes » (prix, titre, secteur) | Engagement cédant |
| J+30 | Comparaison avec la fourchette d'estimation : « les annonces dans votre fourchette reçoivent 2,5× plus de NDA » → bouton **« ajuster le prix »** (baisse suggérée de 5-10 %) | Baisse de prix guidée (badge « prix révisé » envoyé aux acheteurs en alerte) |
| J+60 | Relance + proposition d'un créneau de 15 min avec le fondateur | Rétention, feedback |
| J+90 | « Mettre en pause ou renouveler ? » + rappel que le mandat court ; si pas de réponse → annonce en veille (ne pas polluer l'inventaire) | Qualité d'inventaire |
| Acheteur inactif 30 j | Digest « 4 nouvelles annonces dans vos critères » ; 60 j : « votre score vous donne accès à … » ; 90 j : sondage de sortie (acheté ailleurs ?) | Réactivation acheteurs |
| NDA signé sans suite 14 j | Rappel au cédant et à l'acheteur avec question fermée (« intéressé / pas intéressé / besoin d'infos ») | Débloquer le pipeline |
| LOI signée | Checklist de closing (avocat, banque, délais), relance toutes les 2 semaines | Réduire la casse post-LOI |

Tout cela tient dans Brevo (automations) ou dans un cron applicatif ; coût marginal nul.

---

## 6. Confiance sans humain

- **Vérification d'identité** : Stripe Identity sur les acheteurs (déjà en place) et **sur le cédant au moment du mandat** (cohérent avec les obligations LCB-FT d'un titulaire de carte T — rapport d'écarts, point 8).
- **Badges de preuve** : « Qualification RGE vérifiée le JJ/MM » (contrôle automatique contre data.gouv) [S], « 3 bilans déposés », « Mandat signé », « Identité vérifiée », « Référent technique identifié ».
- **Statistiques publiques** : page `/chiffres` en direct (annonces actives, acheteurs vérifiés, NDA signés sur 30 jours, délai médian) — Acquire et Empire Flippers publient leurs volumes [S/M].
- **Avis** : à faible volume, les avis Trustpilot/Google sont rares et facilement suspects ; préférer des **témoignages post-closing signés** et un récapitulatif chiffré par transaction (anonymisé).
- **Garantie** : sur un service acheteur payant, copier la garantie Fusacq (contact non concluant recrédité) [S] ; sur le success fee, afficher noir sur blanc « 0 € avant le closing, pas de minimum » (déjà le cas) — c'est un vrai différenciateur face aux 9-10 k€ de minimum des intermédiaires [S].
- **Séquestre** : orienter vers notaire/avocat pour le prix (jamais la plateforme), expliquer la mécanique dans le guide.
- **Caution institutionnelle** : statut de partenaire Bpifrance / Transentreprise [S], mention de la carte T et de la garantie financière sur chaque page.

---

## 7. Tarifs acceptés en France pour des services annexes (repères)

| Service | Repères observés | Confiance |
|---|---|---|
| Contact / mise en relation acheteur | Fusacq : 16 à 30 € HT la mise en relation (packs 150-325 € HT) ; abonnements 695-1 195 €/an [S] | [S] |
| Accès anticipé / alertes premium | Fusacq Elite : 35 €/mois, 336 €/an [S] ; BizBuySell Edge ~240 $/an [S] ; Acquire 390-780 $/an [S] | [S] |
| Accompagnement cédant institutionnel | Parcours CCI : 1 597 € HT, reste à charge 426 € HT après subvention [S] ; CRA : adhésion, pas de commission [S] | [S] |
| Success fee « bas » | CCI Côte d'Azur : 450 € / 900 €, plafond 10 800 € [S] ; intermédiaires classiques : 5-10 % avec minimum 9-15 k€ [M] | [S/M] |
| Estimation en ligne | Outils gratuits (Bpifrance, Fusacq « simulateur de reprise » dans Elite [S]) ; rapports automatiques payants aux USA ~60 $ (BizBuySell) [M] ; en France, l'estimation payante se vend surtout via expert-comptable (300-1 500 €) [M] | [M] |
| Dossier de présentation | Cabinets : 1 500-5 000 € HT [M] ; version automatisée crédible à **149-390 € HT** si elle inclut l'estimation et le teaser PDF [H] | [H] |
| Mise en avant d'annonce | Flippa : confidentiel +199 $, privé +599 $ [S] ; BizBuySell : +20 à +170 $/mois selon niveau [S] ; en France, 49-99 € HT/mois pour « annonce à la une » est le prix d'ancrage des sites d'annonces [M] | [S/M] |

**Contrainte Hoguet** : le mandataire ne peut rien encaisser avant la conclusion [M — à faire confirmer par le conseil]. Les services annexes payants aux cédants (estimation, dossier, mise en avant) doivent donc être **vendus par une entité éditrice distincte**, ou non vendus. C'est la décision structurante du modèle (§ 8).

---

## 8. Modèle économique recommandé (à arbitrer)

**Option A — rester 100 % mandataire (statu quo + ajustements)**
- Gratuit cédant, success fee 10/8/6 sans minimum, aucun paiement acheteur. Simple et lisible, conforme.
- Ajouter : **mandat de recherche** côté acquéreur (commission au closing, payée par l'acheteur) pour monétiser les consolidateurs ; mandat **juste-à-temps** à la première demande de contact ; appel de 15 min optionnel.
- Faiblesse : zéro revenu récurrent, trésorerie négative 12 mois minimum.

**Option B — deux entités (recommandée si le conseil valide)**
- **Éditeur** (site, annonces, alertes, estimateur, baromètre) : abonnement acheteur « Pro » à **39 €/mois ou 349 €/an** (accès anticipé 72 h, alertes temps réel, dossier complet après NDA, score affiché) et **packs de contact** pour les acheteurs occasionnels (3 contacts 59 € HT), estimation détaillée **49 € HT**, dossier automatisé **149-249 € HT**, mise en avant **49 € HT/mois**. Revenus récurrents dès M+3.
- **Mandataire** (AlterEgo, carte T) : success fee allégé, **6 % jusqu'à 300 k€, 5 % jusqu'à 1 M€, 4 % au-delà**, sans minimum — un barème plus bas que 10 % réduit le contournement et rend la signature du mandat facile, puisque l'éditeur capte déjà une partie de la valeur.
- Faiblesse : complexité juridique (deux contrats, information claire sur qui fait quoi) ; à valider : un éditeur qui vend des contacts à des acheteurs pour des biens sous mandat de l'entité sœur ne doit pas être requalifié en entremise.

**Option C — élargir l'assiette** (indépendante de A/B) : ouvrir aux entreprises du bâtiment **non RGE** (400 k+ entreprises) avec le RGE comme filtre premium, et activer les revenus annexes déjà identifiés (courtage CEE, apport d'affaires sous-traitants) une fois le flux de cédants établi. C'est ce qui transforme un revenu de 100-200 k€/an en business.

Déclencheur de décision : si à M+6 le flux est < 5 annonces qualifiées/mois avec le plan § 9, la niche RGE pure ne suffit pas → Option C obligatoire.

---

## 9. Plan d'acquisition sans commercial, chiffré (marché RGE)

### 9.1 Coûts de fonctionnement mensuels (cible : < 1 500 €/mois)

| Poste | Coût/mois | Note |
|---|---|---|
| Hébergement, domaine, monitoring | 30-60 € | Existant |
| E-mails transactionnels + automations (Brevo) | 0-30 € | Plan gratuit puis Starter selon volume [M] |
| Données : Pappers/Societeinfo (enrichissement dirigeants, e-mails) | 50-150 € | Open data RGE/Sirene/BODACC gratuits [S/M] |
| Infra cold e-mail (2 domaines, 3 boîtes, outil de séquences) | 100-150 € | [M] |
| Courrier postal (300-500 lettres) | 600-1 000 € | Seulement pour le segment A sans e-mail [M] |
| Stripe Identity (30-60 vérifications) | 45-90 € | ~1,50 $/vérif [M] |
| LinkedIn automation (acheteurs) | 0-80 € | Optionnel |
| Contenu SEO (rédaction assistée, relecture) | 0-200 € | Le fondateur + IA |
| **Total** | **≈ 850-1 750 €** | Sans le courrier : ≈ 250-750 € |

### 9.2 Calendrier et résultats attendus

| Phase | Actions | Résultats attendus |
|---|---|---|
| **M1-M2 : fondations** | Pipeline open data (RGE × Sirene × RNE × BODACC) ; estimateur gratuit e-mail-gated ; 1 150 pages programmatiques métier × département + 10 guides ; baromètre n°1 ; infra e-mail warm-up ; questionnaire/score acheteurs ; mandat juste-à-temps ; automations J+7/30/60/90 ; dossiers de partenariat Transentreprise/Bpifrance envoyés | 0 revenu ; base cible de 11-16 k dirigeants ≥ 58 ans [S/M] ; 50-100 pages indexées |
| **M3-M6 : amorçage de l'offre** | 2 000-2 500 e-mails/mois (3 touches) ; 300-500 lettres/mois ; 1 post LinkedIn/semaine ; relais baromètre presse pro | Réponses 4 % ≈ 80-100/mois [S] ; 25-30 % positives ≈ 20-30 conversations ; **4-8 annonces qualifiées/mois** ; 30-80 inscriptions acheteurs/mois (SEO + alertes + LinkedIn) [H] |
| **M6-M9 : liquidité** | Mandats de recherche pour 3-5 consolidateurs ; accès anticipé ; relances automatiques ; 2e baromètre | 20-35 annonces actives ; ≥ 3 NDA/annonce à 30 j ; premières LOI |
| **M9-M14 : premiers closings** | Témoignages signés, page `/chiffres`, délai médian publié | **2-4 closings** (12-25 k€ HT chacun en option A, 6-12 k€ en option B + abonnements) |
| **Année 2** | Même machine, fichier renouvelé, partenariats experts-comptables actifs, Option C si nécessaire | 60-100 annonces/an, **10-20 closings**, 100-250 k€ HT de revenus (+ 1-3 k€/mois d'abonnements en option B) |

### 9.3 Ce qu'il faut mesurer dès le premier jour

- Coût par annonce qualifiée (cible < 150 €) ; coût par acheteur score ≥ 50 (cible < 20 €).
- Taux de réponse e-mail par segment (A/B/C) et par objet ; taux de retour courrier.
- NDA par annonce à 30 jours ; LOI à 90 jours ; délai médian ; taux de vente des annonces à 12 mois (référence US ~25-30 % [M]).
- Part des annonces en cession de titres avec référent technique identifié (c'est la fraction réellement « RGE-transmissible »).

### 9.4 Les trois paris à prendre en connaissance de cause

1. **Le pari de la donnée** : la combinaison open data RGE + âge des dirigeants est un avantage que ni Fusacq ni Cessionpme n'exploitent ; c'est aussi la seule façon de prospecter sans commercial.
2. **Le pari du mandat de recherche** : c'est le produit où l'argent est (les consolidateurs), et il est compatible avec Hoguet ; il réinvente le cold e-mail en « un acquéreur vérifié vous cherche ».
3. **Le pari de l'honnêteté sur la taille du marché** : annoncer dès le début l'élargissement au bâtiment (Option C) évite de bâtir 18 mois sur un flux de 250-500 cessions/an.

---

## Sources citées (recherches ayant abouti)

- Acquire.com (prix, modèle, amorçage par cold e-mail) : https://exitbid.io/blog/acquire-com-review-2026 · https://help.acquire.com/how-do-i-upgrade-from-the-free-plan · https://joinhampton.com/blog/selling-his-own-startup-was-painful-so-he-built-an-8-figure-ma-marketplace · https://www.indiehackers.com/post/tech/within-4-years-andrew-gazdeckis-product-changed-the-m-a-industry-here-s-how-he-built-acquire-com-xIt9KyqVQatckEibkF4R · https://morganandwestfield.com/podcast/how-acquire-com-is-transforming-tech-startup-acquisitions/
- Flippa (frais, upgrades, SEO) : https://flippa.com/sell/website · https://support.flippa.com/hc/en-us/articles/360000774276 · https://www.hackceleration.com/labs/flippa-pricing · https://investors.club/how-does-flippa-work/ · https://opportunities.earnedmedia.com.au/flippa-seo-strategy
- Empire Flippers : https://empireflippers.com/oba/vetting-process/ · https://www.exitbid.io/blog/empire-flippers-fees-2026 · https://exitbid.io/blog/empire-flippers-rejected-2026
- BizBuySell : https://investors.club/?p=63728 · https://www.bizbuysell.com/learning-center/article/how-long-sell-business/ · https://www.bizbuysell.com/news/media.html · https://www.joinsecret.com/bizbuysell
- Fusacq : https://fusacq.com/tarifs/tarifs.php · https://www.fusacq.com/vente-entreprise-securite-electronique-vente-installation-maintenance,91956_ca_
- Cessionpme / CRA / CCI : https://copeps.fr/actualites/cession-pme-nouvelles-annonces/ · https://www.cra.asso.fr/uploads/fiche-cra-cedant.pdf · https://www.echodumardi.com/?p=79743 · https://www.cote-azur.cci.fr/app/uploads/2024/03/3.1_Grille-tarifaire-2024-DAET.pdf
- Transentreprise / CCI : https://www.transentreprise.com/upload/File/TRANSENTREPRISE_facilite_la_cession_reprise_des_entreprises_2025.pdf · https://www.swim.legal/blog/reprise-entreprise-cci · https://www.landes.cci.fr/wp-content/uploads/2024/04/Plaquette-programme-objectif-transmission-2023.2024.pdf
- Bpifrance Bourse de la Transmission : https://bpifrance-creation.fr/entrepreneur/actualites/plan-transmission-dentreprise-cedants-repreneurs · https://bpifrance-creation.fr/encyclopedie/plan-transmission-tpe-cedants-repreneurs
- Données RGE : https://www.data.gouv.fr/datasets/liste-des-entreprises-rge-1/ · https://www.data.gouv.fr/datasets/services-artisans · https://societeinfo.com/blog/liste-artisans-et-entreprises-rge-trouver-les-bases-emails-pour-votre-prospection-b2b
- Sirene : https://www.economie.gouv.fr/entreprises/gerer-sa-comptabilite-et-ses-demarches/sirene-le-repertoire-gratuit-des-entreprises · https://societeinfo.com/tutorial/la-base-sirene
- RGPD / prospection B2B : https://WWW.CNIL.FR/sites/cnil/files/atoms/files/bpi-cnil-rgpd_fiche_2_ameliorez-maitrisez-votre-relation-client_0.pdf · https://www.donneespersonnelles.fr/prospection-commerciale-rgpd
- Benchmarks cold e-mail : https://lemlist.com/blog/cold-email-response-rate · https://overloop.com/fr/blog/statistiques-cold-email · https://www.shno.co/marketing-statistics/cold-email-statistics
- Marché de la transmission : https://www.gers.cci.fr/sites/default/files/inline-files/2023.11.13CP%20Rencontres%20de%20la%20Transmission%20Reprise.pdf · https://www.bred.fr/actualites/medias/pdf/divers/bpce-la-cession-transmission-des-entreprises-en-france.pdf · https://lexpress-franchise.com/actualites/pour-quelles-raisons-500-000-entreprises-seront-a-ceder-en-france-dici-2030/ · https://www.altares.com/wp-content/uploads/2021/09/CP-Altares-Etude-ventes-cessions-09-2021.pdf · https://copeps.fr/actualites/cession-pme-dans-les-pyrenees/ · https://dogfinance.com/entreprises/rnd/comment-vendre-mon-entreprise
