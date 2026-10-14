# CessionRGE — Plan « Liquidité et croissance d'abord »

**Pour** : Micael (AlterEgo SAS, carte T) · **Date** : 9 octobre 2026 · **Horizon** : 12 mois pour devenir la place de marché de référence des cessions RGE, 24 mois pour l'autonomie financière.
**Contraintes absolues** : fonctionnement autonome (fondateur seul, ~5 h/semaine en régime de croisière, zéro commercial) et coûts de fonctionnement faibles (< 500 €/mois hors investissement initial).
**Sources** : les huit rapports du dossier d'audit (`audit/ux-vendeur.md`, `ux-acheteur.md`, `accueil-design.md`, `business-model.md`, `tech-couts.md`, `autonomie-admin.md`, `marche-concurrence.md`, `marche-rge.md`, `cadre-legal.md`, `playbooks.md`) et le modèle chiffré `audit/unit_economics.py`. Ce plan tranche ; il ne propose pas d'options. Les points de droit restent à faire relire une fois par le conseil d'AlterEgo (budget prévu).

---

## 0. Les douze décisions, en une page

| # | Décision | Pourquoi (en une ligne) |
|---|---|---|
| 1 | **On reste intermédiaire mandaté (carte T), on ne devient pas un site d'annonces payant.** | La carte T est le seul actif différenciant et le seul levier de revenu unitaire significatif ; le modèle « média » à la Fusacq plafonne à 10-30 k€/an et perd la promesse « sécurisé ». |
| 2 | **Mandat simple (non exclusif), signé dans le flux de dépôt, dénonçable à tout moment avec 15 jours de préavis, clause de suite 12 mois sur les repreneurs nommément présentés.** | L'exclusivité est le premier motif de non-signature ; le mandat exclusif actuel est en plus annulable (pas de mention art. 78). |
| 3 | **Barème ramené à 5 % HT jusqu'à 500 k€, 4 % de 500 k€ à 1,5 M€, 3 % au-delà, tranches marginales, plancher 3 000 € HT. Cédant toujours débiteur. HT affiché d'abord.** | 10 % est le prix d'un cabinet humain ; une plateforme sans négociateur ne le vaut pas et le marché le contourne. 5 % reste 2,5× Alvo mais inclut KYC, NDA, data room, mandat, registre. |
| 4 | **Zéro paiement amont pour cédants et repreneurs, jamais (annonce, boost, crédits, abonnement, diligence).** | Art. 6 loi Hoguet : 2 ans / 30 000 € et perte de la commission. Ce n'est pas une option marketing. |
| 5 | **Teaser anonyme publié automatiquement** dès mandat signé + identité vérifiée + SIREN présent dans la liste ADEME + pas de doublon ; post-modération 48 h ; refus motivé en un clic. | Supprime l'attente « sous 48 h » et la validation humaine systématique. |
| 6 | **Repreneur : profil déclaratif + score à l'inscription, e-mail confirmé, contact gratuit ; vérification d'identité Stripe déplacée au NDA ; data room ouverte après NDA ; la LOI devient une offre indicative co-signée.** | Chaque filtre divise la demande ; le KYC avant premier message coûte 1,50 € par curieux et fait fuir l'analyste d'un groupe. |
| 7 | **Deuxième produit mandaté : le mandat de recherche pour les consolidateurs** (3 % HT du prix, plancher 5 000 € HT, payé par l'acquéreur au closing, uniquement sur des cibles hors catalogue sourcées pour lui). | C'est là que sont les acheteurs solvables ; c'est compatible Hoguet ; cela transforme la prospection en « un acquéreur vérifié vous cherche ». |
| 8 | **Revenus tiers d'apport d'affaires (expert-comptable, courtier crédit, courtier décennale) routés automatiquement aux étapes NDA / offre / closing.** | Seuls revenus à encaissement court compatibles avec le mandat ; payés par des partenaires, pas par les parties. |
| 9 | **La machine d'acquisition cédants = open data (ADEME × Sirene × RNE) + e-mailing B2B opt-out + SEO programmatique métier × département + estimateur gratuit + un créneau de 15 min réservable.** | Seule façon de sourcer sans commercial ; personne ne possède le mot-clé « RGE » en cession, cessionrge.fr n'est même pas indexé. |
| 10 | **Encaissement industrialisé** : rédacteur d'acte obligatoire à l'acceptation d'offre, note d'honoraires automatique, facture Stripe Invoicing avec lien de paiement et relances, veille BODACC/INPI mensuelle sur tous les SIREN sous mandat ou clause de suite. | Aujourd'hui, 100 % du revenu dépend d'une déclaration volontaire et d'un PDF texte envoyé à la main. |
| 11 | **On arrête** : exclusivité, choix du débiteur, KYC avant contact, LOI avant data room, validation humaine systématique, newsletter « communauté », vérificateur RGE sur l'accueil, mise en relation avocat, facture maison, crédits/abonnements, pistes v2 sous-traitants/fournisseurs/CEE, courrier postal (sauf un test), domaine alteregopatrimoine. | Chaque ligne est détaillée en §10. |
| 12 | **Décision pré-engagée à M+6** : si moins de 4 annonces publiées/mois, on élargit aux entreprises du bâtiment qualifiées (Qualibat, Qualifelec, Qualit'EnR) avec le RGE comme filtre premium. | La niche RGE fait 300-500 cessions ouvertes/an ; on ne bâtit pas 18 mois sur un flux qu'on n'a pas mesuré. |

---

## 1. Diagnostic sincère

1. **Le produit est techniquement sérieux et juridiquement mieux pensé que 90 % des projets solo** : anonymat appliqué côté serveur, signatures par code avec preuve, registre des mandats, data room filigranée, relances idempotentes, 47 tests, SEO pré-rendu. Ce n'est pas une démo. Il faut le dire parce que tout ce qui suit est dur.
2. **Mais il est construit comme un cabinet de cession sans le cabinet.** Mandat exclusif 12 mois + 10 % HT = le prix et l'engagement d'un Transaxio, pour une plateforme qui « n'intervient pas dans la négociation ». Le cédant rationnel ne signe pas ; celui qui signe contourne ; et personne ne détecte ni n'encaisse. En l'état, le revenu attendu par annonce publiée est d'environ 3 250 € HT, et le premier euro arrive 9 à 12 mois après la publication.
3. **Le côté rare (le cédant) supporte toute la friction** : SIRET bloquant si l'ADEME ne répond pas, KYC, 13 champs en jargon sans sauvegarde, mandat exclusif chiffré « 33 600 € TTC » avant d'avoir vu un seul repreneur, puis « validation sous 48 h ». Quatorze écrans, deux changements d'application, une attente humaine. Pendant ce temps, Fusacq, Transmibat, Alvo et Place des Commerces publient en cinq minutes, sans mandat, gratuitement.
4. **Le côté demande est tué trois fois** : KYC payant avant le premier message, validation par un cédant qui ne voit qu'un « Acquéreur n°891FC7 », et une LOI au prix demandé (exclusivité 45 j, non-contournement 24 mois) pour simplement ouvrir la data room. Un avocat refuse de signer la LOI actuelle (blancs, `{{DOC_ID}}`, « 1350000.0 € »).
5. **L'accueil ne convertit pas des cédants** : hero bi-cible dominé par le formulaire de recherche acheteur, aucune preuve (ni carte T, ni fondateur, ni chiffre, ni visage), « 7 entreprises » et douze compteurs à zéro, barème expliqué sur 400 mots en TTC d'abord, carte tarifs tronquée sur mobile, mentions légales « à compléter ».
6. **Le marché est réel mais petit et lent** : ~60 000 entreprises RGE en érosion, 1 200-1 800 transmissions/an toutes formes, 300-500 réellement adressables par une place de marché, prix médian des fonds artisanaux ~85 k€, cycle 9-18 mois. 2026 est un choc de demande (MaPrimeRénov' par geste recentrée sur la PAC, PV résidentiel effondré) : plus de vendeurs fatigués, moins d'acheteurs pour les mono-produits. À 5-10 % de part de marché en année 3, c'est une activité rentable pour une personne, pas une scale-up.
7. **Le vrai concurrent n'est pas Fusacq, c'est le gré à gré** : le confrère, le salarié, le groupe Facebook de plombiers-chauffagistes à 11 000 membres. La plateforme gagne si elle apporte ce que le gré à gré n'a pas : des repreneurs qu'on ne connaît pas, vérifiés, et un cadre qui protège le cédant.
8. **La place est libre** : personne ne possède le SERP « entreprise RGE à vendre », aucun concurrent ne vérifie les qualifications contre la base ADEME, aucun n'explique la transmissibilité du label (certificat provisoire 6 mois Qualibat, référent technique). C'est un avantage de 3-9 mois de travail SEO, pas d'argent.
9. **Ce qui empêche l'autonomie aujourd'hui n'est pas le coût (4-7 k€/an) mais l'absence de mécanique** : pas d'écran de closing, facture `a_valider` sans lien de paiement, aucune veille BODACC, aucune date de fin de mandat, un seul envoi par relance, un back-office qui est une vue base de données.
10. **Trois bombes techniques à désamorcer cette semaine** : clé Stripe LIVE, clé Brevo et mot de passe Mongo dans l'historique Git ; `stripe.error` inexistant dans stripe 13 (toute erreur KYC = 500) ; aucune sauvegarde Mongo alors que le registre des mandats y vit.
11. **Ce que ce plan ne promet pas** : un salaire en année 1. Avec le meilleur produit du monde, le premier closing arrive à M+9/M+12. L'année 1 est une année de construction de liquidité à perte contrôlée (≈ 6-10 k€ de coûts), l'année 2 est celle où la commission produit, l'année 3 celle de l'autonomie réelle.
12. **Ce qui marchera** : un mandat qu'un artisan signe sans y réfléchir (non exclusif, résiliable, 5 %), un repreneur qui peut se présenter avant de montrer son passeport, un accueil qui dit qui opère et ce que la commission comprend, une machine de sourcing qui tourne toute seule sur l'open data, et une mécanique d'encaissement qui ne dépend pas d'un e-mail du fondateur.
13. **Ce qui ne marchera pas, même bien exécuté** : vivre de la commission seule en année 1 ; faire payer les repreneurs (interdit) ; vendre « rachetez un label RGE » (le label ne suit pas le fonds et devient plus accessible) ; attendre que les consolidateurs viennent acheter des artisans à 300 k€ de CA (ils achètent 2-6 M€) ; « zéro humain » avec des cédants de 60 ans (il faut une voix, 15 minutes, une fois).

---

## 2. Angle, positionnement, promesse

**Angle imposé** : liquidité et croissance d'abord. Chaque arbitrage de ce plan est tranché en faveur du volume d'annonces qualifiées et de repreneurs qualifiés ; la monétisation est maintenue au niveau minimal qui ne détruit pas la liquidité (5 %) et qui reste légal (rien avant l'acte).

**Positionnement** : « CessionRGE est la place de marché des cessions d'entreprises RGE, opérée par un professionnel carte T. Annonces anonymes, qualifications contrôlées sur la base ADEME, repreneurs identifiés, accord de confidentialité avant toute révélation. Gratuit pour les repreneurs. Pour le cédant : rien avant la vente, 5 % HT à l'acte, sans exclusivité. »

**Trois preuves à rendre visibles partout** : (1) l'opérateur (AlterEgo SAS, carte T n° CPI 7801 2025 000 000 049, CCI Paris IdF, fondateur nommé avec photo), (2) la vérification (badge « RGE vérifié le JJ/MM sur la base ADEME » par annonce, « identité vérifiée » par repreneur), (3) le cadre (« 0 € avant l'acte : c'est la loi et notre modèle », mandat non exclusif résiliable, clause de suite expliquée).

**Deux cibles, dans cet ordre** :
- **Cédants** (côté rare) : dirigeants d'entreprises RGE de 3 à 30 salariés, 55 ans et plus, PAC/CVC avec entretien en priorité (la valeur monte), puis isolation/menuiserie/PV (parcours rapide, prix bas, plancher 3 000 €). Ils arrivent par l'e-mailing open data, le SEO, les experts-comptables.
- **Repreneurs** : l'artisan voisin en croissance, le salarié/cadre en reconversion avec apport, la structure commerciale qui doit internaliser le RGE avant le 1er janvier 2027 (loi 2025-594), et, via mandat de recherche, les consolidateurs (Butagaz Eco-énergie, Isovalie, Émeraude Power, Satep, Atout Groupe, Renovio).

**Discours à abandonner** : « rachetez une société pour son RGE ». **Discours à adopter** : « reprenez une activité RGE saine et vérifiée, avec un diagnostic de transmissibilité du label pour chaque annonce ».

---

## 3. Modèle économique : qui paie, combien, quand, sur quelle base légale

### 3.1 Tableau de synthèse

| Flux | Qui paie | Combien | Quand | Base légale | Part attendue année 1 | Part attendue année 2 |
|---|---|---|---|---|---|---|
| **A. Commission de cession** (mandat de vente simple) | Le cédant (mandant), toujours | 5 % HT ≤ 500 k€, 4 % de 500 k€ à 1,5 M€, 3 % au-delà, tranches marginales, plancher 3 000 € HT, TVA 20 % | À la signature de l'acte de cession, par le rédacteur d'acte sur le prix (ordre irrévocable de paiement dans le mandat) | Loi Hoguet art. 6 : commission due uniquement après conclusion constatée par acte, montant et débiteur fixés au mandat numéroté au registre ; clause de suite limitée (Cass. 11 sept. 2025) | ≈ 60-75 % | ≈ 75-85 % |
| **B. Commission de recherche** (mandat de recherche consolidateurs) | L'acquéreur mandant | 3 % HT du prix, plancher 5 000 € HT ; due uniquement sur une cible **hors catalogue** sourcée pour lui (pas de double commission sur une annonce publiée) | Au closing, idem | Mandat de recherche écrit, inscrit au même registre unique (Cass. 10 déc. 2014), commission acquéreur déterminable et acceptée par écrit ; rien avant conclusion | 0-10 % | 10-20 % |
| **C. Apport d'affaires partenaires** | Le partenaire (expert-comptable pour audit d'acquisition, courtier en crédit pro en qualité d'indicateur, courtier assurance décennale/RC) | 300-600 € par mission d'audit, 200-600 € par dossier financé, 300-800 € par contrat d'assurance | À la signature de la mission / du prêt / du contrat chez le partenaire | Hors art. 1er Hoguet (somme payée par un tiers, pas par les parties, pas représentative d'entremise sur la cession) ; transparence obligatoire (code de déontologie) ; statut d'indicateur pour le crédit (pas de conseil, pas de remise de documents de prêt) | ≈ 15-30 % | ≈ 5-10 % |
| **D. Diagnostic de transmissibilité RGE** | Personne en année 1 (inclus dans chaque annonce) | 0 € | — | Inclus dans le service du mandat ; vendu au repreneur sur une affaire sous mandat, ce serait un « frais de recherche » interdit | 0 | 0 (année 2 : version SaaS « Rapport RGE par SIRET » vendue à tout dirigeant sans lien avec une annonce, 49 € HT, à valider par le conseil) |
| **E. Publicité / annuaire de partenaires** | Cabinets d'avocats, experts-comptables, financeurs référencés | 0 en année 1 ; 30-60 € HT/mois en année 2 si > 100 annonces | Mensuel | Vente d'espace clairement identifié « partenaire », hors opération | 0 | < 5 % |

**Ce qui est explicitement exclu** (et pourquoi) : annonce payante, mise en avant, dossier de présentation payant, estimation payante au cédant, crédits ou abonnement repreneur, « accès anticipé » payant, abonnement « flux acquéreur » pour consolidateurs. Tous sont des sommes « représentatives de frais de recherche, de démarche, de publicité ou d'entremise » perçues avant conclusion par un mandataire : infraction à l'art. 6 (2 ans / 30 000 €), nullité et perte de la commission ; l'abonnement d'accès aux fiches relèverait en plus du statut de marchand de listes. Le modèle « deux entités » (éditeur + mandataire) est licite mais sa frontière est floue, il demande un juriste et il n'a aucun rendement sous 150-300 annonces actives : **non, pas avant 24 mois**.

### 3.2 Pourquoi 5/4/3 % avec plancher 3 000 € (et pas 10 %, pas 3 %)

| Prix de cession | CessionRGE nouveau (cédant) | CessionRGE actuel | Transaxio (acquéreur, humain) | Michel Simond (≈ 10 % TTC) | Alvo (repreneur, gratuit) | CCI Côte d'Azur |
|---|---|---|---|---|---|---|
| 50 000 € | **3 000 € (plancher)** | 5 000 € | 6 500 € | ~4 200 € HT | 1 000 € | 900 € |
| 85 000 € (médiane artisanat) | **4 250 €** | 8 500 € | 8 500 € | ~7 100 € HT | 1 700 € | 900 € |
| 180 000 € (médiane attendue des annonces) | **9 000 €** | 18 000 € | 18 000 € | ~15 000 € HT | 3 600 € | 900 € |
| 350 000 € | **17 500 €** | 35 000 € | 35 000 € | ~29 000 € HT | 7 000 € | 900 € |
| 700 000 € | **33 000 €** | 66 000 € | 62 500 € | ~58 000 € HT | 14 000 € | 900 € (plafond 10 800 €) |
| 1 500 000 € | **65 000 €** | 130 000 € | 72 500 € | — | 30 000 € | — |

- **Pas 10 %** : c'est le tarif d'un cabinet qui valorise, visite, négocie et se fait payer chez le notaire. Le marché l'accepte avec un humain. Sans humain, il produit du contournement (métier local où tout le monde se connaît) et des refus de mandat.
- **Pas 3 % sans minimum** : à 85 k€ cela fait 2 550 € pour un dossier qui coûte le même temps de conformité (KYC, mandat, NDA, data room, facture, registre, LCB-FT) ; le fondateur y perd. Alvo est à 2 % mais sans carte T, sans NDA géré, sans registre, et payé par le repreneur.
- **5 % avec plancher 3 000 €** : la moitié d'un cabinet pour un service qui comprend réellement anonymisation, contrôle ADEME, repreneurs identifiés, NDA et offre signés en ligne, data room filigranée avec journal, suivi des offres, mandat et registre tenus par un carte T, diagnostic RGE. Sur la médiane attendue (180 k€) : 9 000 € HT, soit moins que l'écart de prix qu'obtiennent deux repreneurs en concurrence. Commission moyenne attendue sur la distribution de prix retenue (25 % à 80 k€, 35 % à 180 k€, 25 % à 350 k€, 12 % à 700 k€, 3 % à 1,5 M€) : **≈ 14 400 € HT**, médiane 9 000 € HT.
- **Tranches marginales** conservées (déjà codées dans `offer.js` / `business_model.py`), plancher réactivé via `COMMISSION_MIN_HT=3000`.

### 3.3 Cédant toujours débiteur

Le choix « cédant ou acquéreur » est retiré. Trois raisons : (1) l'acquéreur est le côté le plus liquide et ne paie rien chez Fusacq, Transmibat, Alvo, CRA, Bpifrance : afficher « 141 600 € TTC » en tête d'annonce tue la demande ; (2) deux régimes de facture et de recouvrement pour un fondateur seul ; (3) une commission acquéreur n'est exigible que si l'acquéreur a signé un engagement chiffré repris dans l'acte (jurisprudence sur l'art. 6) : une étape de plus dans un tunnel déjà trop long. Le cas « acquéreur paie » est réservé au mandat de recherche (flux B), où c'est naturel.

### 3.4 Mandat de recherche : le produit des consolidateurs

- Cible : 10 à 20 groupes en build-up (Butagaz Eco-énergie, Isovalie/Creadev, Émeraude Power, Satep, Atout Groupe, Renovio, HomeServe Énergies Services, Proxiserve) et les réseaux régionaux qui absorbent des artisans.
- Produit : fiche de cadrage (métiers, zones, CA, effectif, structure), sourcing automatisé sur l'open data (segment « dirigeant ≥ 58 ans » filtré sur leurs critères), e-mail de prospection « un acquéreur vérifié vous cherche » (le meilleur message possible en cession), teasers qualifiés, NDA, data room ; commission 3 % plancher 5 000 € HT au closing, uniquement sur une cible hors catalogue.
- Pourquoi c'est compatible avec « zéro commercial » : un seul e-mail du fondateur par groupe, puis tout est self-service (mandat signé en ligne, critères dans le compte, flux automatique). C'est la seule action « sortante » de ce plan, et elle tient en deux heures par mois.
- Pourquoi c'est compatible avec Hoguet : mandat de recherche écrit, numéroté dans le registre unique, barème déterminable, rien avant conclusion.

### 3.5 Apport d'affaires : trois conventions, signées une fois

| Partenaire | Déclencheur automatique | Message | Rémunération attendue |
|---|---|---|---|
| Expert-comptable spécialisé bâtiment (audit d'acquisition, retraitement d'EBE) | NDA signé par le repreneur | « Faire auditer les comptes avant d'offrir — partenaire référencé, rémunère CessionRGE » | 300-600 € par mission |
| Courtier en crédit professionnel (statut d'indicateur pour AlterEgo) | Offre acceptée | « Financer la reprise : apport, prêt, crédit vendeur » | 200-600 € par dossier financé |
| Courtier assurance décennale / RC | Vente déclarée | « Réassurer l'activité dès le closing » | 300-800 € par contrat |

Transparence : chaque message dit que le partenaire rémunère la plateforme. Les avocats ne peuvent pas rémunérer l'apport (déontologie) : page statique « Vos conseils » sans rémunération. Rendement année 1 : 1-5 k€ ; année 2 : 10-25 k€. Ce n'est pas un modèle, c'est de la trésorerie.

---

## 4. Le mandat cible (contenu, à faire relire une fois)

- **Nature** : mandat simple de vente (non exclusif). Le cédant reste libre de vendre seul ou par un tiers. Argument de vente, écrit en gras sur la page mandat.
- **Durée** : 12 mois, sans tacite reconduction ; renouvellement en un clic depuis l'espace vendeur (e-mail J-30) ; dénonçable à tout moment par chaque partie avec 15 jours de préavis par e-mail avec accusé (bouton « Résilier mon mandat » dans l'espace vendeur).
- **Objet déterminé** : forme sociale et structure (titres / fonds) pré-cochées depuis le SIREN (INPI) et le choix du cédant ; dénomination, SIREN, adresse du siège obligatoires (collectés au dépôt ; blocage de la génération si vides).
- **Rémunération** : barème 5/4/3 % HT plancher 3 000 € HT, à la charge du mandant, exigible à la signature de l'acte ; **ordre irrévocable de paiement** donné au rédacteur d'acte sur le prix ; obligation de communiquer l'identité du rédacteur d'acte et la date de signature dans les 8 jours.
- **Clause de suite** : 12 mois après la fin du mandat, limitée aux repreneurs nommément présentés ; liste nominative horodatée envoyée automatiquement au cédant à la fin du mandat (preuve).
- **Obligations du mandataire alignées sur le produit** : diffusion anonyme, contrôle des qualifications sur la base ADEME, identification des repreneurs, mise à disposition des outils (NDA, data room, offres), tenue du registre. Pas de « qualification des acquéreurs avant tout échange » ni d'« accompagnement des négociations » que le produit ne fournit pas.
- **Mentions** : n° et lieu de délivrance de la carte, CCI, « ne doit recevoir ni détenir d'autres fonds… » (ou garantie si elle existe), RC pro, lieu de signature « signature électronique à distance », horodatage.
- **Signature** : signature avancée eIDAS avec horodatage qualifié (prestataire, ~1-2 € par signature) pour le mandat et l'offre acceptée ; OTP e-mail conservé pour le NDA. Contre-signature automatique d'AlterEgo. PDF signé numéroté envoyé au cédant (preuve de remise).
- **Un refus d'annonce après signature rend le mandat caduc automatiquement** (statut « annulé » au registre, numéro conservé, e-mail motivé).

---

## 5. Parcours cibles

### 5.1 Cédant (objectif : 3 écrans, 10 minutes, mandat compris, sans attente humaine)

1. **Estimer ou déposer** (sans compte) : SIRET → qualifications ADEME chargées (ou « vérification RGE en cours » si l'API ne répond pas : jamais bloquant). Trois chiffres (CA, EBE ou résultat, effectif) → fourchette de valeur indicative (multiples recalibrés 0,3-0,6 × CA, 2,5-4 × EBE) affichée immédiatement. C'est l'aimant.
2. **Compte et annonce en 3 écrans courts** : (a) activité, département, effectif, type de cession, raison de la vente, accompagnement proposé ; (b) chiffres clés avec info-bulles, exemples, bornes de validation, option « à compléter avec mon comptable » ; (c) « ce qui rassure un repreneur » (décennale, référent technique restant, organismes et échéances, carnet de commandes, part de CA aidée, parc, locaux) ; brouillon serveur sauvegardé à chaque écran ; alerte si prix hors fourchette.
3. **Identité et mandat** : Stripe Identity (2 min, même onglet, message d'erreur actionnable) puis page mandat : résumé en 5 lignes (non exclusif, 12 mois, résiliable, 5 % à l'acte, qui paie), estimation sur **son** prix en HT, « N repreneurs vérifiés cherchent une entreprise [activité] en [région] » calculé, signature. Publication immédiate du teaser anonyme. E-mail « en ligne — envoyée à N repreneurs ».
4. **Espace vendeur** : bloc « À traiter » en tête (demandes avec profil repreneur, offres, messages non lus par repreneur), messagerie groupée par (annonce, repreneur) avec nom d'expéditeur, actions « Pause / Retirer / Vendue via CessionRGE / Vendue autrement », résiliation du mandat, créneau de 15 min avec le fondateur (après mandat uniquement).

### 5.2 Repreneur (objectif : contact en 5 minutes, identité au moment où elle compte)

1. **Alerte sans compte** depuis n'importe quelle page vide ou fiche (e-mail + activité + département) ; compte complet en un clic plus tard.
2. **Inscription** : e-mail confirmé (lien), profil en 2 minutes (type, zones, métiers, budget, apport, financement, horizon, expérience, SIREN si entreprise) → score 0-100 ; badges visibles du cédant (« entreprise du bâtiment établie », « déjà RGE », « financement déclaré », « identité vérifiée »).
3. **Contact** gratuit si score ≥ 50, avec « Présentez votre projet » pré-rempli ; coordonnées masquées ; le cédant voit le profil pseudonymisé et accepte en un geste (option au mandat : « accepter automatiquement les repreneurs vérifiés »). Relances J+2/J+5, expiration J+10 avec e-mail au repreneur.
4. **NDA** : vérification d'identité Stripe (une seule fois) puis signature par code ; révélation de l'identité ; data room ouverte (bilans) ; exemplaire PDF envoyé.
5. **Offre** : formulaire structuré (montant, titres/fonds, crédit vendeur, conditions, calendrier, rédacteur d'acte pressenti) → document « offre indicative » généré, signé par le repreneur et contre-signé par le cédant s'il accepte (c'est la LOI, remise à sa place) ; non-contournement 24 mois dans le NDA.
6. **Après acceptation** : checklist des 5 étapes jusqu'à l'acte, rédacteur d'acte obligatoire, partenaires routés, relances J+30/60/90 en un clic, déclaration de vente croisée (silence 7 jours = confirmation).

---

## 6. Acquisition des cédants (la machine)

1. **Pipeline open data, hebdomadaire, un script** : liste ADEME RGE (quotidienne, Licence Ouverte) × Sirene (création, effectif, NAF, commune) × RNE/Pappers (âge du dirigeant) × BODACC (changements, procédures). Segments : A = dirigeant ≥ 58 ans et effectif ≥ 3 (11-16 k entreprises) ; B = qualification expirant < 12 mois ; C = BODACC (traiter avec prudence). Exclusion des oppositions Sirene et des désinscrits. Analyse d'intérêt légitime écrite (une page), mention de la source au premier e-mail, lien de désinscription, conservation 3 ans. **Jamais de scraping** (France Rénov', Qualibat, LinkedIn : sanction Kaspr 240 k€).
2. **E-mailing B2B opt-out** : 2 000-2 500 envois/mois, séquence de 3 messages en 12 jours (« 1 dirigeant RGE sur 4 a plus de 60 ans : combien vaut votre entreprise ? » → estimateur ; cas anonymisé ; clôture), 75-150 mots, 2 domaines satellites, 3 boîtes, warm-up 3 semaines. Attendu : 4 % de réponse, 25-35 % positives → 20-30 conversations/mois, 4-8 annonces qualifiées/mois dès M4-M6. Variante « un acquéreur vérifié vous cherche » dès le premier mandat de recherche signé.
3. **SEO programmatique avec données réelles** : pages `/reprendre/[métier-rge]/[département]` alimentées par les comptages ADEME (entreprises RGE du métier dans le département, part de dirigeants 60+, annonces actives, alerte inline), `noindex` tant qu'il n'y a ni annonce ni donnée spécifique ; fiches `/company/:id` pré-rendues côté serveur (title/description/H1 anonymisés) ou retirées du sitemap ; `/search` en `noindex` canonisé vers le hub ; domaine canonique `cessionrge.fr` fixé avant indexation (301 depuis le sous-domaine) ; Search Console dès la semaine 1 (le domaine n'apparaît même pas sur sa marque). Dix guides d'intention (« la qualification RGE est-elle transmissible ? », « combien vaut une entreprise de PAC ? », « cession de titres ou de fonds ? », « que devient le référent technique ? »), auteur et date visibles, encart « estimer mon entreprise » au milieu.
4. **Baromètre trimestriel de la cession RGE** (nombre d'entreprises RGE, part des 60+, annonces, délais, multiples observés) : contenu de référence, relais Batiactu / Le Moniteur / newsletters Qualit'EnR-Qualibat, backlinks, un post LinkedIn par semaine du fondateur.
5. **Canaux gratuits institutionnels** : dossier de partenariat Bourse Bpifrance Transmission (agrégateur n°1 sur le SERP, charte anonymat), rediffusion Transentreprise (CCI/CMA, plan Objectif Reprises : 25 000 cédants/repreneurs sensibilisés par an), CAPEB départementales (contenu co-brandé « Transmettre une entreprise RGE »). Lents, mais à zéro euro.
6. **Experts-comptables** : premier interlocuteur de confiance des dirigeants. Page « Partenaires », kit d'une page, lien tracké. Pas de rémunération d'apport de mandats en année 1 (toute personne qui négocie pour AlterEgo doit être habilitée par la CCI ; un apporteur rémunéré flirte avec cette limite) ; la rémunération va dans l'autre sens (flux C).
7. **Une seule porte humaine** : créneau de 15 minutes réservable (Cal.com gratuit) proposé après la signature du mandat et après la première offre. 20-30 appels/mois maximum. « Sans commerciaux » = sans prospection sortante, pas sans voix.
8. **Courrier postal** : un seul test de 300 lettres à M4 sur le segment A filtré (≥ 60 ans, ≥ 5 salariés, pas d'e-mail trouvé), ≈ 600 € ; poursuivi uniquement si ≥ 3 annonces en résultent. Sinon, arrêt définitif.

---

## 7. Acquisition des repreneurs

1. **SEO** (hub, pages métier × département, fiches pré-rendues) et **alertes sans compte** sur chaque page vide : c'est le canal principal et il est gratuit.
2. **Diffusion croisée** : Bourse Bpifrance et Transentreprise (si partenariat), ce qui ramène les repreneurs vers la fiche CessionRGE.
3. **Digest hebdomadaire** aux vérifiés sans alerte ; événement « baisse de prix » vers alertes et favoris ; relance identité non vérifiée J+1/J+3/J+10 avec les 3 annonces les plus proches ; sondage de sortie à 90 jours.
4. **Mandats de recherche** : un e-mail du fondateur à 10-20 consolidateurs (§3.4) ; LinkedIn organique (baromètre, cas anonymisés) pour les cadres en reconversion et les investisseurs ; pas d'automation LinkedIn payante en année 1.
5. **Page `/chiffres` publique** dès 20 annonces : annonces actives, repreneurs vérifiés, NDA signés sur 30 jours, délai médian de premier contact ; track record des closings (anonymisés) dès le premier. Sans chiffres publiés, aucun cédant n'enverra ses bilans et aucun repreneur ne reviendra.

---

## 8. Accueil cible et direction design

### 8.1 Promesse et structure (≈ 450 mots rendus, ≈ 2 800 px desktop / 5 500 px mobile, 1 CTA principal répété 3 fois)

0. **En-tête** : Logo · Entreprises à vendre · Vendre · Reprendre · Guides · Connexion · **[Déposer une annonce]** (navy plein). Mobile : logo, bouton, menu.
1. **Hero** (fond blanc, texte 55 % / visuel 45 %)
   - Eyebrow : « Cession d'entreprises RGE · opéré par AlterEgo, carte professionnelle T »
   - H1 : **« Vendez votre entreprise RGE sans que personne ne le sache. »**
   - Sous-titre : « Annonce anonyme, repreneurs identifiés, accord de confidentialité signé avant toute révélation. Rien à payer avant la vente : 5 % HT à la signature de l'acte, sans exclusivité. »
   - CTA principal : « Déposer mon annonce anonyme » → `/register?role=seller` (rôle présélectionné, en-tête commun, rappel de l'offre). CTA secondaire : « Estimer mon entreprise en 2 minutes ». Lien discret : « Vous cherchez une entreprise à reprendre ? Voir les annonces → ».
   - Visuel : capture produit d'une annonce anonyme avec le badge « RGE vérifié le 12/10 — base ADEME » et un cadenas « nom et SIRET révélés après NDA », sur photo de chantier en duotone.
2. **Bande d'autorité** (4 sceaux) : « AlterEgo SAS, carte T n° CPI 7801 2025 000 000 049, CCI Paris Île-de-France » · « Qualifications contrôlées sur la base officielle ADEME » · « Identité des repreneurs vérifiée avant toute révélation » · « 0 € avant la signature de l'acte — c'est la loi, et notre modèle ».
3. **Pour qui** (2 cartes) : Cédants — « Votre annonce reste anonyme. Seuls des repreneurs identifiés, qui ont signé un accord de confidentialité, découvrent le nom de votre société. Vous choisissez à qui vous parlez, et vous restez libre de vendre par ailleurs. » → Déposer. Repreneurs — « Pompes à chaleur, isolation, photovoltaïque, menuiseries… des entreprises déjà qualifiées, avec un diagnostic de transmissibilité du label pour chaque annonce. Gratuit, sans abonnement. » → Voir les annonces / Créer une alerte.
4. **Comment ça marche** (onglets accessibles Je cède / Je reprends, timeline 4 étapes). Cédant : « Déposez votre annonce en 10 minutes — votre SIRET charge vos qualifications » · « Vérifiez votre identité et signez un mandat simple, résiliable, en ligne » · « Recevez des repreneurs présentés avec leur projet, échangez sans dévoiler votre nom » · « Révélez votre identité après NDA, ouvrez vos documents, recevez des offres structurées ». Repreneur : « Parcourez, créez une alerte » · « Présentez votre projet en 2 minutes » · « Contactez le cédant gratuitement » · « NDA et identité vérifiée, documents, offre ». Sous la timeline : « Délai médian entre dépôt et premier contact qualifié : X jours » (mesuré, sinon « vous êtes prévenu à chaque contact, NDA et offre »).
5. **Annonces récentes** (ListingCard compacte ×3) ; si < 6 annonces, la 3e carte devient « Recevoir les prochaines annonces » (formulaire sans compte). Jamais de compteur à zéro.
6. **Tarif** (une carte + calculateur) : H2 « Vous ne payez qu'à la vente. » — « Publication gratuite. À la signature de l'acte, une commission de 5 % HT jusqu'à 500 000 €, 4 % de 500 000 à 1 500 000 €, 3 % au-delà, calculée par tranches, minimum 3 000 € HT. Pas d'abonnement, pas d'exclusivité, mandat résiliable à tout moment. » Calculateur : « Prix envisagé : [180 000 €] → **9 000 € HT** (10 800 € TTC) ». Liste « ce que comprend la commission » (diffusion anonyme, contrôle ADEME, repreneurs identifiés, NDA et offre signés en ligne, data room filigranée avec journal, suivi des offres, mandat et registre tenus par un professionnel carte T, diagnostic RGE). Note : « La négociation et les actes restent entre vous et le repreneur, avec vos conseils. »
7. **Qui est derrière** (FounderCard : photo, nom, « fondateur, AlterEgo SAS, Sartrouville, carte T CCI Paris IdF », 3 lignes, « 15 minutes pour en parler ») + 3 chiffres dès qu'ils dépassent 20, sinon « Lancé en 2026 · toute la France ».
8. **FAQ** (5) : « Mes salariés et mes clients peuvent-ils savoir que je vends ? » · « Combien ça coûte, qui paie, et si je vends par moi-même ? » (clause de suite expliquée) · « Qui sont les repreneurs et comment sont-ils filtrés ? » · « Combien de temps prend une cession ? » · « Que devient ma qualification RGE après la vente ? ».
9. **Guides** (3 cartes avec visuel) · 10. **CTA final** (seul bloc sombre) · 11. **Pied de page** avec bloc légal complet (raison sociale, adresse, RCS, carte T, CCI, mention « ne doit recevoir ni détenir… » ou garantie, RC pro, contact).

Sections supprimées de l'accueil : formulaire de recherche du hero (reste sur `/search` et le hub), vérificateur RGE (→ `/verifier-entreprise-rge` indexée), newsletter « communauté », tableau du barème (→ calculateur ; tableau conservé sur Vendre).

### 8.2 Direction artistique

- **Passer de « start-up éco générique » à « intermédiaire de transmission, spécialiste, fiable ».** Fond clair ; un seul bloc sombre (CTA final). Pas de dégradé ni de halo.
- **Palette** : encre navy `#0b1220` (texte, boutons), surface `#f5f7fa`, bordures `#e3e7ee`, action bleu `#1d4ed8` (une seule valeur), **vert `#15803d` réservé au badge RGE**, ambre `#b45309` à petite dose (prix, « nouveau »).
- **Typographie auto-hébergée** (Google Fonts retiré : RGPD + rendu) : Manrope 700/800 pour les titres (H1 44-52 px / 32 px mobile), Inter 400/500/600 pour le texte (17/16 px), légendes ≥ 13 px, chiffres tabulaires.
- **Composants** : `ListingCard` unique (accueil, hub, activité, région, recherche) avec titre lisible généré (« Installateur PAC & chauffe-eau · Bretagne · 9 salariés »), département, type de cession, prix / CA / EBE, multiple, badge RGE vérifié ; `TrustBar` ; `ProcessTimeline` avec le verrou « identité révélée après NDA » ; `CommissionCalculator` ; `FounderCard` ; `FaqList` existante.
- **Visuels à coût maîtrisé** : 3-4 photos de chantier libres de droits en duotone, 2 captures produit anonymisées, carte de France SVG (points par région pourvue, remplace la grille de régions à zéro), portrait du fondateur, pictogramme retouché vers un signe de transmission (graphiste 300-800 €).
- **Ton** : vouvoiement, phrases courtes, chiffres ; « accord de confidentialité (NDA) », « lettre d'intention (LOI) », « espace documents sécurisé » ; bannir « communauté », « rejoignez », « Lehman », « simple et transparent ».
- **Cohérence** : en-tête et pied de page communs sur fiche, login, register ; inscription avec deux cartes « Je cède / Je reprends » ; mobile testé à 390/360/320 px (la carte tarifs déborde aujourd'hui de 48 px).

---

## 9. Changements produit priorisés

Effort : S < 1 jour, M = 1-3 jours, L > 3 jours. P0 = avant toute acquisition (semaines 1-6), P1 = avant le premier closing (semaines 6-12), P2 = après.

### P0 — sécurité et exploitation (semaine 1)

| # | Changement | Pourquoi | Effort |
|---|---|---|---|
| 1 | Révoquer et régénérer la clé Stripe live, la clé Brevo, le mot de passe Mongo ; activer secret scanning + push protection ; gitleaks en pré-commit | Secrets présents dans l'historique Git du dépôt public | S |
| 2 | Remplacer `stripe.error.*` par `stripe.StripeError` / `stripe.SignatureVerificationError` (6 occurrences) + test | Toute erreur KYC ou webhook = 500 opaque sur la porte d'entrée du parcours | S |
| 3 | Sauvegarde Mongo quotidienne vers S3 (rétention 30 j) + test de restauration ; S3 obligatoire en prod | Registre des mandats et preuves de signature sans aucune sauvegarde ; fichiers en base64 dans Mongo | S |
| 4 | Rate limiting (slowapi) sur login/register/forgot/request-code ; bcrypt hors boucle d'événements ; CORS sans défaut `*` ; en-têtes nginx ; docs OpenAPI fermées ; JWT 24 h + `password_changed_at` | 25 tentatives acceptées en 8 s, API documentée publiquement | S |
| 5 | Sentry (backend + front) + UptimeRobot sur un `/api/health` réel (ping Mongo, âge du dernier job) | Base morte = site « up » ; bugs découverts par les utilisateurs | S |
| 6 | Code OTP hors de l'objet de l'e-mail ; une seule variable d'adresse admin ; authentifier `cessionrge.fr` dans Brevo (SPF/DKIM/DMARC) | Le code « vaut signature » et fuit par les aperçus ; e-mails de closing vers une boîte potentiellement inexistante | S |

### P0 — modèle et tunnel (semaines 2-6)

| # | Changement | Pourquoi | Effort |
|---|---|---|---|
| 7 | Barème 5/4/3 % plancher 3 000 € HT, HT d'abord, exemple à 180 k€, suppression du choix du débiteur (`offer.js`, `business_model.py`, `GET /config`, MandatePage, CompanyDetail, content.json) | Source unique : une heure de code, un changement de modèle | S |
| 8 | Mandat simple : nouveau texte (§4), objet pré-coché, adresse du mandant collectée, dates stockées (signature, fin, fin de clause de suite), contre-signature AlterEgo, PDF numéroté envoyé, résiliation et renouvellement en libre-service, caducité automatique au refus | Mandat actuel annulable et dissuasif ; aucune date de fin stockée | M |
| 9 | Publication automatique (mandat + identité + SIREN dans la liste ADEME + pas de doublon), post-modération 48 h, refus à 6 motifs avec e-mail et resoumission ; inscription possible sans réponse ADEME (« RGE en cours de vérification », cache 24 h) | Autonomie ; point de défaillance unique sur la seule porte d'entrée des cédants | M |
| 10 | Formulaire d'annonce en 3 écrans, brouillon serveur, validation (bornes, cohérence), champs « ce qui rassure un repreneur », titre généré, description, département ; affichage de tous les champs saisis sur la fiche ; suppression du bloc « domaines complémentaires » et de la promesse d'accompagnement | 13 champs de jargon sans sauvegarde ; fiche qui n'aide pas à décider et vend un service inexistant | M |
| 11 | Profil repreneur déclaratif + score + badges ; double opt-in e-mail ; KYC déplacé au NDA ; data room après NDA ; LOI remplacée par l'offre structurée co-signée ; gabarits NDA/offre nettoyés (variables, blancs, montants fr-FR) ; exemplaires PDF envoyés | Le tunnel actuel tue les trois personas et coûte un KYC par curieux | L |
| 12 | Messagerie groupée par (annonce, repreneur), nom d'expéditeur, bon destinataire, ouverture de la bonne conversation, layout mobile | Bug critique vérifié : réponse envoyée au mauvais repreneur | M |
| 13 | Estimateur gratuit sans compte (multiples recalibrés par activité) → fourchette + e-mail + annonce pré-remplie ; alerte prix hors fourchette sur l'annonce | Aimant à cédants ; prix invendables = aucun closing | M |
| 14 | Accueil refondu (§8), bande d'autorité, calculateur, FounderCard, pied de page légal, mentions et confidentialité complétées (`REACT_APP_LEGAL_DRAFT=false`), inscription par rôle, bug mobile tarifs, compteurs à zéro masqués, polices auto-hébergées, domaine canonique `cessionrge.fr` | L'accueil ne convertit pas le côté rare et montre sa vacuité | L |
| 15 | Alerte sans compte ; carte `ListingCard` unique ; une seule page de recherche ; `noindex` sur pages vides et `/search` ; fiches pré-rendues ou hors sitemap ; `lastmod` | Démarrage à froid et SEO | M |

### P1 — encaissement, veille, automatisations (semaines 6-12)

| # | Changement | Pourquoi | Effort |
|---|---|---|---|
| 16 | Écran « Déclarer la vente » (deux parties, confirmation croisée, silence 7 j) ; rédacteur d'acte et date prévisionnelle obligatoires à l'acceptation d'offre ; note d'honoraires + instruction de règlement envoyées automatiquement au rédacteur et aux parties | Le seul événement qui génère de l'argent n'a aucun écran | M |
| 17 | Facture via Stripe Invoicing (conforme L441-9, lien de paiement, relances J+15/30/45, statut par webhook) ; suppression du PDF maison ; route admin « payée » ; revenu admin calculé sur les factures | Facture maison non conforme et impasse e-invoicing 2027 | M |
| 18 | Veille BODACC (ventes de fonds) + RNE/INPI (changement de dirigeant/associés) mensuelle sur chaque SIREN sous mandat ou clause de suite ; e-mail automatique au cédant citant la clause ; alerte admin ; modèle de mise en demeure | Dans un métier local, une vente hors plateforme n'est jamais sue ; données gratuites | M |
| 19 | Signature avancée eIDAS + horodatage qualifié pour le mandat et l'offre acceptée (OTP conservé pour le NDA) | Cass. 3e civ. 5 mars 2026 : sans qualification, la preuve pèse sur AlterEgo ; un mandat par annonce, coût négligeable | M |
| 20 | Mandat de recherche (fiche de cadrage, mandat signé en ligne, registre unique, sourcing sur critères, e-mail « un acquéreur vérifié vous cherche ») | Produit des consolidateurs | M |
| 21 | Séquences d'e-mails complètes (autonomie-admin §7) : mandat J+1/4/10, identité repreneur J+1/3/10, NDA/data room/offre, hebdo vendeur avec chiffres, 14 j/30 j sans contact avec fourchette de prix, pause automatique 60 j, offre acceptée J+30/60/90, mandat J-30, digest repreneurs, baisse de prix, désinscription ; un bouton profond par e-mail ; prénom ou « Bonjour, » | Un seul envoi par relance aujourd'hui ; aucune des relances qui convertissent sans commercial | M |
| 22 | Routage des partenaires (expert-comptable au NDA, courtier crédit à l'offre acceptée, assurance à la vente déclarée) avec mention de la rémunération | Flux C | S |
| 23 | Onglet admin « À faire » par défaut (post-modération, bloquées, vendeurs muets > 7 j, offres acceptées > 60 j, factures en retard, mandats < 30 j, erreurs techniques) + e-mail quotidien 8 h ; actions Publier/Refuser par lien signé ; compteurs corrigés (vues, KYC, noms) | Rituel de 15 minutes par semaine | M |
| 24 | Pipeline open data (script hebdo RGE × Sirene × RNE × BODACC) + export vers l'outil d'e-mailing + LIA documentée + désinscription + webhook rebonds Brevo | La machine d'acquisition | M |
| 25 | Pages programmatiques métier × département alimentées par l'open data ; 10 guides ; baromètre n°1 ; page `/verifier-entreprise-rge` ; page `/chiffres` | SEO et confiance | L |
| 26 | Diagnostic de transmissibilité RGE par annonce (titres/fonds, référent technique, organismes et échéances ADEME, chantiers aidés en cours, clause suspensive type) | Différenciateur gratuit que personne n'a | M |
| 27 | LCB-FT : champ « origine des fonds / plan de financement » avant data room, procédure d'une page, attestation de formation, conservation 5 ans ; DSA hébergeur (point de contact, signalement, motivation des retraits) ; RGPD (index TTL, suppression/export de compte, purge des KYC manuels, durées réelles) | Conditions de validité des commissions futures ; quelques jours, zéro euro récurrent | M |

### P2 — nettoyage et année 2

| # | Changement | Pourquoi | Effort |
|---|---|---|---|
| 28 | Supprimer crédits/abonnements/remboursements/webhook paiements, générateur de contrats admin, KYC manuel, mise en relation avocat, Data Room admin, migration exposée ; purger `requirements.txt` ; remplacer le SDK Brevo par un appel HTTP | ~900 lignes mortes, surface de bug et de sécurité | M |
| 29 | Découper `server.py` (6 243 lignes) en routeurs ; `GENERATE_SOURCEMAP=false` ; ErrorBoundary ; tests Stripe/jobs/closing ; CI reliée au déploiement | Maintenabilité pour un développement assisté par IA | L |
| 30 | Vérification magique des uploads, réécriture PDF sans JS ; pagination `/companies` ; worker pdf.js embarqué ; data room accessible depuis la messagerie | Sécurité et robustesse à 500 annonces | S |
| 31 | « Rapport RGE par SIRET » SaaS à 49 € HT vendu à tous (hors annonce) ; annuaire partenaires payant ; élargissement bâtiment si déclencheur M+6 | Année 2 | L |

---

## 10. Ce qu'on arrête ou retire

1. **Exclusivité du mandat** → mandat simple avec clause de suite.
2. **Choix du débiteur** (cédant/acquéreur) → cédant, toujours.
3. **Barème 10/8/6 % et affichage TTC d'abord** → 5/4/3 % plancher 3 000 €, HT d'abord.
4. **KYC Stripe avant le premier message** → au NDA.
5. **LOI comme condition d'accès à la data room** → data room après NDA ; LOI = offre indicative co-signée.
6. **Validation humaine systématique des annonces** et promesse « sous 48 h » → publication automatique + post-modération.
7. **Validation « de profil » à l'aveugle** → profil repreneur présenté, option d'acceptation automatique.
8. **Blocage de l'inscription sans réponse ADEME** → vérification différée.
9. **Facturation maison** → Stripe Invoicing (puis plateforme agréée en 2027).
10. **Crédits, abonnements, remboursements repreneur** (code mort derrière flag) → supprimés.
11. **Newsletter « Rejoignez la communauté RGE »** → deux aimants (estimation, alerte sans compte).
12. **Vérificateur RGE sur l'accueil** → page dédiée indexée.
13. **Formulaire de recherche dans le hero** → `/search` et hub.
14. **Mise en relation avocat** (promesse humaine sans valeur) → page statique « Vos conseils ».
15. **Générateur manuel de NDA/LOI, 30 paramètres modifiables, Data Room admin, lecture intégrale des messages** → lecture/export seuls, paramètres en variables d'environnement, incidents de contournement uniquement.
16. **KYC manuel (upload de pièces)** → Stripe Identity seul ; purge des pièces stockées.
17. **Encart « Nous pouvons accompagner le futur propriétaire dans l'obtention de ces domaines RGE »** et bloc « domaines complémentaires » faux → retirés.
18. **Exemples 30 000 € / 800 000 €, « formule de Lehman », « tranches successives »** → calculateur et un exemple à 180 k€.
19. **Compteurs à zéro, « 7 entreprises », pages activité/région vides indexées** → masqués, `noindex`, carte de France.
20. **Domaine `cessionrge.alteregopatrimoine.com` et Google Fonts** → `cessionrge.fr`, polices auto-hébergées.
21. **Pistes v2 « mise en relation sous-traitants/fournisseurs », « besoin client entrant », « courtage CEE »** → hors plan 12 mois. Autre métier, très concurrentiel (Hellio, Effy Pro, IZI by EDF), encadré, incompatible avec 5 h/semaine. Le CEE reste une idée à tester à la main seulement si un cédant le demande spontanément.
22. **Abonnement repreneur, annonces premium, « flux acquéreur » payant, rapport de diligence payant sur affaire sous mandat, modèle à deux entités** → non, pas avant 24 mois et pas sans juriste.
23. **Courrier postal en continu** → un test de 300 lettres à M4, puis arrêt sauf ≥ 3 annonces.
24. **Scraping d'annuaires ou de LinkedIn** → jamais.
25. **Kubernetes, Atlas payant, ClamAV, Next.js, réécriture** → non.

---

## 11. Coût de fonctionnement

### 11.1 Mensuel en régime de croisière (année 1)

| Poste | €/mois | Note |
|---|---|---|
| VPS Hetzner (2 vCPU / 4 Go), domaine, S3 Scaleway (75 Go offerts) | 10-15 | Existant |
| Brevo (transactionnel + séquences) | 0-25 | Gratuit jusqu'à 300/jour ; Starter si dépassement |
| Sentry, UptimeRobot, Plausible, Cal.com | 0-10 | Plans gratuits |
| Stripe Identity (KYC au NDA : 15-30 vérifications/mois) | 25-45 | ~1,25-1,50 € par vérification ; ÷2 par rapport au KYC avant contact |
| Signature avancée eIDAS (mandats, offres acceptées : 5-10/mois) | 20-50 | Pay-per-use ou plan d'entrée |
| Stripe Invoicing | 0,4 % par facture | ≈ 40 € par closing médian |
| Pappers / Societeinfo (âge dirigeant, e-mails) | 50-100 | Open data RGE / Sirene / BODACC gratuits |
| Infra cold e-mail (2 domaines, 3 boîtes, outil de séquences) | 100-150 | Seule dépense d'acquisition récurrente |
| **Total récurrent** | **≈ 210-400 €/mois** | Médian ≈ 300 €/mois |

### 11.2 Annuel et ponctuel

| Poste | € | Note |
|---|---|---|
| RC professionnelle carte T, renouvellement CCI, formation 14 h | 800-1 800 /an | Obligatoire |
| Expert-comptable AlterEgo | 1 000-2 000 /an | |
| Avocat : relecture mandat simple, mandat de recherche, NDA, offre, CGU, LCB-FT, questions ouvertes (TVA titres, fonds artisanal) — **une fois** | 2 500-4 000 | Avant la première campagne |
| Graphiste (pictogramme, 2 captures, OG image) | 300-800 | Une fois |
| Test courrier postal M4 | ≈ 600 | Une fois |
| Photos libres de droits | 0-150 | Une fois |
| **Total année 1** | **≈ 9 000-14 000 €** (dont 3 500-5 500 € de ponctuel) | Un seul closing médian (9 000 € HT) couvre l'année |

Année 2 : ≈ 5 000-7 000 €/an récurrent, Stripe Identity et facturation proportionnels au volume.

### 11.3 Temps du fondateur

- **Phase de construction (90 jours)** : 25-35 jours de développement assisté par IA (le dépôt montre que c'est le mode de travail actuel) + 2 jours de juridique + 2 jours de contenu. Ce n'est pas 5 h/semaine ; il faut le dire.
- **Régime de croisière (à partir de M4)** : lundi 1 h « À faire » (post-modération, factures, incidents, mandats à échéance), 2 h d'appels de 15 min (8 créneaux max, réservables uniquement après mandat ou offre), 1 h de contenu (post LinkedIn, guide, baromètre trimestriel), 1 h partenaires / consolidateurs. **5 h.** Tout le reste est automatisé ou n'existe pas.

---

## 12. Unit economics (nouveau modèle)

Hypothèses explicites (reprises de `audit/unit_economics.py`, barème et entonnoir ajustés) :

- Distribution de prix des annonces : 25 % ≈ 80 k€, 35 % ≈ 180 k€, 25 % ≈ 350 k€, 12 % ≈ 700 k€, 3 % ≈ 1,5 M€ → prix médian 180 k€, moyen ≈ 300 k€.
- Commission 5/4/3 % plancher 3 000 € : **médiane 9 000 € HT, moyenne ≈ 14 400 € HT**.
- Taux annonce créée → mandat signé : 45 % (actuel exclusif) → **70 %** (simple, résiliable, 5 %, dans le flux).
- Contacts par annonce publiée : 4 → **10** (KYC au NDA, profil, alertes, SEO). Contact → NDA : 30 → **45 %** (profil présenté, acceptation automatique possible). NDA → offre : 20 → **30 %** (data room après NDA, offre structurée).
- Annonces vendues à un repreneur présenté dans les 12-18 mois : **15 %** (central ; 8 % pessimiste, 22 % optimiste). Fuite (hors plateforme non détecté, non recouvré) : 25 % → **12 %** (veille BODACC, ordre de paiement, facture automatique).
- Délai publication → acte : **8 mois** (central), encaissement +1 mois.
- **Espérance de commission encaissée par annonce publiée (central) : 0,15 × 0,88 × 14 400 ≈ 1 900 € HT** ; par annonce créée ≈ 1 330 €. C'est moins qu'avec 10 % (3 250 €), mais à volume plus élevé et avec une fuite moindre : le modèle parie que 2× plus d'annonces publiées et 2× moins de contournement valent mieux qu'un taux que personne ne signe.
- Coût marginal par annonce publiée : ≈ 40 € (KYC des repreneurs au NDA, signature, e-mails) ; coût d'acquisition par annonce publiée via e-mailing : ≈ 60-100 € (150 €/mois d'infra pour 2-4 annonces). **Marge contributive par annonce ≈ 1 750 € HT** ; point mort des coûts récurrents (≈ 3 600 €/an) : **2 annonces publiées par an**. Le problème n'est pas la marge, c'est le délai et le volume.
- Mandat de recherche : commission moyenne ≈ 30-60 k€ HT sur une cible à 1-2 M€ ; probabilité de closing par mandat signé ≈ 20 % à 18 mois.

---

## 13. Scénarios de revenus (HT encaissé)

| | Pessimiste | Médian | Optimiste |
|---|---|---|---|
| Annonces publiées / mois (M3-M12 ; année 2) | 2 ; 3 | 4 ; 6 | 7 ; 10 |
| Annonces publiées cumulées à 12 / 24 mois | 20 / 56 | 40 / 112 | 70 / 190 |
| Taux de vente via repreneur présenté ; fuite | 8 % ; 25 % | 15 % ; 12 % | 22 % ; 8 % |
| Commission moyenne | 12 000 € (mix plus petit) | 14 400 € | 14 400 € |
| Délai publication → encaissement | 11 mois | 9 mois | 8 mois |
| Mandats de recherche signés (12 / 24 mois) ; closings | 0 / 2 ; 0 | 3 / 6 ; 1 en année 2 (≈ 35 k€) | 5 / 10 ; 2 en année 2 (≈ 80 k€) |
| Apport d'affaires (12 m ; année 2) | 0 ; 3 k€ | 2 k€ ; 12 k€ | 5 k€ ; 25 k€ |
| **Revenu 12 mois** | **≈ 0-6 k€** (0-1 closing) | **≈ 15-20 k€** (1 closing + apport) | **≈ 35-45 k€** (2-3 closings + apport) |
| **Revenu année 2** | **≈ 20-30 k€** (1-2 closings + apport) | **≈ 120-140 k€** (6-7 closings + 1 recherche + apport) | **≈ 280-340 k€** (15-17 closings + 2 recherches + apport) |
| **Cumul 24 mois** | ≈ 25-35 k€ | ≈ 135-160 k€ | ≈ 315-385 k€ |
| Coûts cumulés 24 mois | ≈ 15-18 k€ | ≈ 16-20 k€ | ≈ 20-25 k€ |

Lecture honnête :
- **Dans tous les scénarios l'année 1 ne paie pas le fondateur.** Elle coûte 9-14 k€ et rapporte 0-45 k€, le plus probable étant ≈ 15-20 k€ arrivant dans les trois derniers mois. Le fondateur doit avoir un autre revenu ou 12 mois de trésorerie personnelle. Le plan ne le cache pas.
- **Le scénario médian donne un business d'une personne (120-140 k€ HT en année 2, 200-300 k€ en année 3)**, pas une scale-up. C'est cohérent avec un marché de 300-500 cessions ouvertes par an.
- **Le scénario optimiste suppose l'élargissement au bâtiment à M+6 ou une prise de SERP très rapide** ; il n'est pas le plan, il est ce que la machine permet si la niche répond.
- La variable qui décide tout est le **nombre d'annonces publiées par mois** ; la seconde est le **taux de vente via un repreneur présenté**. Tout le plan produit est fait pour ces deux chiffres.

---

## 14. KPI et pilotage (un écran, un rituel de 15 minutes le lundi)

Mesurés dès le premier jour (Plausible + métriques admin) :

1. **Annonces publiées / mois** (cible 4 à M6, 6 à M12) et **coût par annonce publiée** (cible < 150 €).
2. **Taux annonce créée → mandat signé** (cible ≥ 70 % ; c'est le goulot historique).
3. **Taux réponse e-mailing par segment** (cible ≥ 4 %) et **retour SEO** (pages indexées, clics Search Console, position sur « entreprise RGE à vendre »).
4. **Repreneurs qualifiés (score ≥ 50) inscrits / mois** (cible 30 à M6, 60 à M12) et **coût par repreneur qualifié** (< 20 €).
5. **NDA par annonce à 30 jours** (cible ≥ 3) ; **offres à 90 jours** (cible ≥ 1 sur 3 annonces).
6. **Délai médian dépôt → premier contact qualifié** (publié sur l'accueil dès 20 annonces).
7. **Part des annonces avec prix dans la fourchette d'estimation** (cible ≥ 70 %) et **part avec diagnostic RGE complet**.
8. **Closings déclarés, factures émises, factures encaissées, délai moyen** ; **taux de fuite détecté** (BODACC/INPI).
9. **Mandats de recherche actifs** et cibles présentées.
10. **Temps fondateur / semaine** (cible ≤ 5 h à partir de M4) et **appels de 15 min réservés / mandats signés**.
11. **Délivrabilité** (rebonds, plaintes, désinscriptions < 0,5 %).
12. **Incidents** : erreurs Sentry, échecs Stripe, annonces bloquées > 48 h.

---

## 15. Risques

1. **La niche ne répond pas** (< 4 annonces/mois à M6) → déclencheur pré-engagé : élargissement aux entreprises du bâtiment qualifiées (§17).
2. **Le SEO met 6-9 mois** et le domaine n'est aujourd'hui pas indexé → Search Console semaine 1 ; l'e-mailing porte les six premiers mois.
3. **Taux de signature du mandat insuffisant malgré la simplification** → mesurer à M3 ; si < 50 %, créneau de 15 min proposé avant la signature (coût : 2 h/semaine de plus).
4. **Contournement** → veille BODACC/INPI, liste nominative en fin de mandat, ordre de paiement au rédacteur ; prévoir 1-2 mises en demeure par an.
5. **Requalification Hoguet** si une monétisation amont est introduite par impatience → ligne rouge écrite dans ce plan ; relecture avocat.
6. **Dépendance à Stripe Identity / ADEME / INPI** → messages actionnables, vérification différée, cache ; jamais bloquant pour l'inscription.
7. **Temps du fondateur** : la phase de construction demande 25-35 jours ; si elle s'étale sur 6 mois, le SEO et le fichier vieillissent → séquencer strictement (§16).
8. **Chocs réglementaires** (PLF 2027 : PAC financée par les CEE seuls ; réforme RGE/VAE mars 2027) → discours produit mis à jour chaque trimestre, PAC/CVC en priorité.
9. **Fraudeurs cherchant une coquille RGE** (obligation RGE-facturant au 1er janvier 2027) → profil + KYC au NDA + origine des fonds + refus explicite affiché sur l'accueil : c'est un argument de vente.
10. **Documents juridiques non relus** → budget avocat avant la première campagne, pas après le premier litige.
11. **Consolidateurs peu réactifs** → le mandat de recherche est un bonus, pas la base du plan.
12. **Délivrabilité e-mail** → domaines satellites, warm-up, double opt-in, webhook rebonds, SPF/DKIM/DMARC.

---

## 16. Les 90 premiers jours

**Semaine 1 — Sécurité, légal, tarif (P0 #1-7)**
- Révocation des secrets, `stripe.error`, sauvegarde Mongo, rate limiting, Sentry/UptimeRobot, OTP hors objet, Brevo authentifié sur `cessionrge.fr`.
- Domaine canonique `cessionrge.fr`, Search Console, 301 depuis le sous-domaine.
- Barème 5/4/3 % plancher 3 000 €, HT d'abord, débiteur cédant ; mentions légales et confidentialité complétées ; bandeau brouillon retiré.
- Envoi au conseil : mandat simple, mandat de recherche, NDA, offre, CGU, questions ouvertes (TVA titres, fonds artisanal, carte réelle). Rendez-vous fixé en semaine 4.

**Semaines 2-4 — Mandat et tunnel cédant (P0 #8-10, 13)**
- Nouveau mandat simple (dates, objet, adresse, contre-signature, PDF envoyé, résiliation/renouvellement, caducité au refus).
- Publication automatique + post-modération + refus motivés ; inscription sans blocage ADEME.
- Formulaire d'annonce en 3 écrans avec brouillon serveur, validation, champs « ce qui rassure », fiche complète, titre généré.
- Estimateur gratuit sans compte branché sur le module de valorisation recalibré ; alerte prix hors fourchette.

**Semaines 5-6 — Tunnel repreneur et messagerie (P0 #11-12)**
- Double opt-in, profil + score + badges, contact gratuit, KYC au NDA, data room après NDA, offre structurée co-signée, gabarits nettoyés, exemplaires envoyés.
- Messagerie groupée par (annonce, repreneur), nom d'expéditeur, mobile.
- Relecture avocat intégrée.

**Semaines 7-8 — Accueil, SEO, aimants (P0 #14-15)**
- Accueil refondu (hero vendeur, bande d'autorité, calculateur, FounderCard, pied de page légal), inscription par rôle, `ListingCard` unique, alerte sans compte, compteurs masqués, `noindex` ciblés, fiches pré-rendues, polices auto-hébergées, bug mobile tarifs, photos duotone, portrait, pictogramme.
- Page `/verifier-entreprise-rge`, 5 premiers guides d'intention, carte de France.
- Pipeline open data v1 (RGE × Sirene × RNE × BODACC), LIA, domaines satellites commandés et mis en warm-up.

**Semaines 9-10 — Encaissement, veille, e-mails (P1 #16-19, 21-23)**
- Écran « Déclarer la vente », rédacteur d'acte obligatoire, note d'honoraires automatique, Stripe Invoicing avec relances, veille BODACC/INPI mensuelle, mise en demeure type.
- Signature avancée eIDAS sur mandat et offre acceptée.
- Séquences d'e-mails complètes, un bouton profond par e-mail, désinscription, digest, baisse de prix, pause automatique.
- Onglet « À faire » + e-mail quotidien ; conventions partenaires (expert-comptable, courtier crédit, courtier décennale) signées et routées.

**Semaines 11-12 — Lancement de la machine (P1 #20, 24-26)**
- Première campagne e-mail : 2 000 envois sur le segment A (dirigeant ≥ 58 ans, ≥ 3 salariés), 3 touches ; suivi quotidien des réponses ; créneaux de 15 min ouverts après mandat.
- Mandat de recherche en ligne ; e-mail du fondateur à 10 consolidateurs.
- Pages programmatiques métier × département (données ADEME) ; baromètre n°1 envoyé à Batiactu / Le Moniteur / newsletters des organismes ; dossiers Bpifrance Transmission et Transentreprise envoyés ; diagnostic RGE par annonce.
- Tableau de bord KPI (§14) en place ; revue à J+90 : annonces publiées, taux de mandat, taux de réponse e-mail, premières NDA.

**Jalons** : J+7 zéro secret exposé et zéro 500 Stripe ; J+30 mandat simple en production et premier dépôt en moins de 10 minutes ; J+45 premier repreneur avec profil validé et NDA au nouveau tunnel ; J+60 nouvel accueil en ligne et domaine indexé ; J+75 première facture de test générée par Stripe Invoicing ; J+90 première campagne partie, ≥ 5 annonces publiées, ≥ 1 mandat de recherche signé.

---

## 17. Décision pré-engagée à M+6

Le 6e mois (avril 2027), on lit un seul chiffre : **annonces publiées par mois sur les trois derniers mois**.

- **≥ 4/mois** : la niche répond ; on continue en RGE pur, on monte l'e-mailing à 3 000/mois, on ajoute 5 guides et le baromètre n°2.
- **< 4/mois** : on ouvre la plateforme aux entreprises du bâtiment qualifiées (Qualibat, Qualifelec, Qualit'EnR, Qualigaz : plusieurs centaines de milliers d'entreprises), le RGE devenant le filtre premium et le diagnostic de transmissibilité un service pour toute qualification. Le pipeline open data, les pages programmatiques et le mandat sont déjà construits pour cela ; le changement est de discours et de référentiels, pas de produit. Le nom reste : « CessionRGE, par AlterEgo » devient la marque d'un acteur du bâtiment qualifié.

Cette décision est prise maintenant pour ne pas être reprise sous pression dans six mois.

---

## Annexe A — Points à faire valider par le conseil (une seule consultation)

1. Mandat simple : texte (§4), ordre irrévocable de paiement au rédacteur d'acte, clause de suite 12 mois, résiliation par e-mail avec accusé.
2. Mandat de recherche : texte, registre unique, commission acquéreur déterminable, exclusion des cibles du catalogue.
3. NDA (non-contournement 24 mois, pénalité = commission) et offre indicative co-signée.
4. Apport d'affaires : conventions type avec expert-comptable, courtier crédit (statut d'indicateur), courtier assurance ; mention de transparence.
5. Diagnostic RGE inclus gratuitement : confirmation qu'il n'est pas une prestation facturable séparément sur affaire sous mandat ; cadre d'un « Rapport RGE » SaaS hors annonce en année 2.
6. TVA : 20 % par défaut ; opportunité de l'exonération « négociation de titres » pour les cédants personnes physiques.
7. Fonds artisanal d'entreprise individuelle : traité comme Hoguet (confirmer).
8. Carte réelle d'AlterEgo : mentions exactes, garantie ou déclaration de non-détention, RC pro, retrait de « Gestion immobilière » de la configuration si absente.
9. LCB-FT : moment d'identification de l'acquéreur, procédure d'une page, formation.
10. Prospection : LIA pour l'e-mailing open data, mention de la source, règles téléphoniques 2026 (B2B).

## Annexe B — Ce qu'il ne faut pas casser

Barème marginal en source unique (`offer.js` ↔ `business_model.py` ↔ `GET /config`), signature par code avec preuve et registre séquentiel, anonymat et masquage des coordonnées avant NDA, journal des révélations, data room filigranée avec journal d'accès, relances idempotentes `claim_once`, métriques d'entonnoir admin, pré-rendu SEO et contenus de métier, page mandat (pédagogie, estimation, récap, PDF), onglet Accès du dashboard, hygiène technique (0 erreur JS, code-splitting, data-testid, 47 tests).
