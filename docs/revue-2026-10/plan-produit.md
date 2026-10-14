# CessionRGE — Plan « Produit et confiance d'abord »

**Pour** : Micael (AlterEgo SAS, carte T « Transactions sur immeubles et fonds de commerce », CCI Paris IdF) · **Date** : 9 octobre 2026
**Angle imposé** : réduire chaque friction, rendre la plateforme si simple et si crédible qu'elle convertit seule (onboarding, valorisation automatique, dossier, signature, transparence) ; monétisation simple et lisible.
**Contraintes absolues** : fonctionnement autonome (fondateur seul, ~5 h/semaine, zéro commercial) ; coûts de fonctionnement faibles.
**Sources** : les dix rapports du dossier (`audit/ux-vendeur.md`, `ux-acheteur.md`, `accueil-design.md`, `business-model.md`, `tech-couts.md`, `autonomie-admin.md`, `marche-concurrence.md`, `marche-rge.md`, `cadre-legal.md`, `playbooks.md`) et le modèle chiffré `audit/unit_economics.py`. Ce plan tranche ; il ne propose pas d'options. Les clauses contractuelles restent à faire relire une fois par le conseil d'AlterEgo (budget prévu) ; le plan ne repose sur aucune lecture audacieuse de la loi Hoguet.

---

## 0. La thèse en dix lignes

Une place de marché de cession ne se gagne pas sur le prix ni sur le volume d'annonces : elle se gagne sur la **confiance du côté rare**, le cédant, qui confie à un inconnu les chiffres et l'existence même de sa vente. Aujourd'hui CessionRGE lui demande le plus fort engagement du marché (mandat exclusif 12 mois, 10 % HT chiffré « 33 600 € TTC » avant d'avoir vu un seul repreneur, 14 écrans, une attente humaine « sous 48 h ») sans lui donner une seule preuve qu'un professionnel sérieux est derrière. Et il demande au repreneur son passeport avant la première question.

Le plan inverse la logique : **chaque étape du produit devient une preuve**. Le SIRET charge les qualifications RGE devant les yeux du cédant ; l'estimation tombe en 30 secondes ; le mandat est simple, résiliable en un clic, signé avec horodatage qualifié ; le repreneur se présente avant de montrer sa pièce d'identité ; les documents signés sont envoyés aux deux parties ; l'encaissement passe par le rédacteur d'acte ; la carte T, le fondateur et les chiffres sont sur l'accueil. La monétisation tient en une phrase : **6 % HT à la signature de l'acte, à la charge du cédant, rien avant, rien pour le repreneur.**

Ce que ce plan ne promet pas : un salaire en année 1. Le premier euro de commission arrive à M+9/M+12 quel que soit le produit. L'année 1 construit la confiance et l'inventaire à perte contrôlée (≈ 8-10 k€ de coûts totaux, dont 5-6 k€ de dépenses uniques) ; l'année 2 encaisse.

---

## 1. Diagnostic sincère

1. **Le socle technique est sérieux et doit être gardé.** Zéro erreur JS, zéro 5xx, anonymat appliqué côté serveur, masquage des coordonnées, NDA « name-blind » avec journal des révélations, data room filigranée, OTP haché avec preuve (hash, IP, identité Stripe), registre de mandats sans trou, relances idempotentes, 47 tests en CI, SEO pré-rendu, guides de métier crédibles. Ce n'est pas une démo.
2. **Mais le produit ne convertit pas le côté rare.** Le parcours cédant empile cinq filtres avant la moindre preuve de valeur : SIRET bloquant si l'ADEME ne répond pas (la panne est présentée comme « SIRET non trouvé »), KYC avec bandeau cassé sur mobile, 13 champs en jargon sans sauvegarde ni validation (marge 250 % acceptée), mandat exclusif 12 mois signé avant tout contact, puis « validation sous 48 h ». Pendant ce temps Fusacq, Transmibat, Alvo et Place des Commerces publient en cinq minutes, gratuitement, sans mandat.
3. **Le produit tue aussi la demande, trois fois.** KYC Stripe (payé par la plateforme, ~1,50 € par curieux) avant le premier message ; validation par un cédant qui ne voit qu'un « Acquéreur n°891FC7 » sans profil ; LOI au prix demandé, exclusivité 45 jours et non-contournement 24 mois pour simplement ouvrir la data room, sur un gabarit avec des blancs, « 1350000.0 € » et « {{DOC_ID}} ». L'acheteur ne reçoit aucun exemplaire de ce qu'il signe. Un avocat refuse de signer ça.
4. **La messagerie est cassée au moment précis où la plateforme crée de la valeur** : dès le deuxième repreneur intéressé, tous les acquéreurs d'une annonce sont dans un seul fil sans nom d'expéditeur et la réponse part au premier trouvé (vérifié avec deux acquéreurs réels).
5. **Rien ne prouve qu'un humain sérieux est derrière.** Carte T absente de l'accueil et du pied de page, enfouie dans des mentions légales affichées sous un bandeau « document à faire valider par un conseil juridique », avec « à compléter » et « durée à préciser ». Ni nom, ni visage, ni chiffre, ni logo. Pour une transaction à 100 k€-2 M€, c'est le premier frein, avant le prix.
6. **Le site montre sa vacuité** : « 7 entreprises », 12 activités sur 18 et 7 régions sur 14 à « 0 », pages vides indexées. Un repreneur voit qu'il n'y a rien ; un cédant voit qu'il n'y a pas de repreneurs.
7. **L'accueil vend un prix, pas un service** : « gratuit » 12 fois, « commission » 17 fois, barème TTC d'abord, « formule de Lehman », exemples à 30 000 € et 88 800 € TTC ; le service rendu tient en une phrase anti-vente (« n'intervient pas dans la négociation »). Sur mobile, la carte tarifs déborde et est tronquée.
8. **Le mandat est à la fois dissuasif et fragile.** Exclusif, 12 mois + tacite reconduction, résiliation limitée à trois cas, sans la mention « 3 mois / 15 jours » de l'art. 78 du décret de 1972 (nullité, Cass. 2016), objet non coché, dénomination et adresse du mandant parfois vides, pas de contre-signature, obligations promises (« qualifier les acquéreurs », « accompagner les négociations ») que la FAQ nie. Un cédant de mauvaise foi gagnera. Le registre contient déjà de tels mandats.
9. **Le seul événement qui génère de l'argent n'a pas d'écran.** `POST /closing/declare` n'est appelé par aucun composant ; la facture naît `a_valider` et n'est jamais envoyée, encaissée ni relancée ; personne ne demande qui rédige l'acte ; aucune veille BODACC/INPI alors que les données sont gratuites. Dans un métier local où tout le monde se connaît, 25-40 % des deals conclus échapperaient à la commission sans que personne ne le sache.
10. **La loi Hoguet ferme toutes les portes de revenu amont** sur une affaire sous mandat (art. 6 I : aucune somme « représentative de commissions, de frais de recherche, de démarche, de publicité ou d'entremise » avant conclusion ; 2 ans / 30 000 € ; nullité du mandat). Annonce payante, boost, dossier, estimation vendue au futur mandant, crédits ou abonnement repreneur : interdits. Ce n'est pas une option marketing, c'est une contrainte.
11. **Le marché est réel, petit et lent** : ~60 000 entreprises RGE (en érosion depuis 2022), 300-500 cessions par an réellement adressables par une place de marché, prix médian attendu ≈ 180 k€, cycle 9-18 mois. 2026 pousse des vendeurs fatigués (fin des monogestes MaPrimeRénov' au 1er septembre, PV résidentiel effondré, 13 trimestres de baisse CAPEB) et retire des acheteurs pour les mono-produits ; la PAC repart et l'obligation « RGE-facturant » du 1er janvier 2027 crée une demande de personnes morales RGE propres… et un risque de rachat de coquilles par des fraudeurs. Le KYC des deux parties est donc un argument de vente, pas une friction à supprimer : il faut le placer au bon endroit.
12. **L'argument « rachetez une société pour son RGE » est fragile** : la qualification ne suit pas le fonds (certificat provisoire 6 mois chez Qualibat), dépend du référent technique (6 mois pour en requalifier un), tombe avec le SIRET, et la VAE RGE arrive en mars 2027. Le discours doit devenir « reprenez une activité RGE vérifiée et saine » et le produit doit le prouver annonce par annonce.
13. **cessionrge.fr n'existe pas pour Google**, même sur sa marque ; le domaine canonique pointe sur un sous-domaine d'une autre marque ; les fiches ne sont pas pré-rendues. Le seul canal d'acquisition gratuit est aujourd'hui inexistant alors que personne ne possède le SERP « entreprise RGE à vendre ».
14. **Le « sans humain » n'est pas atteint** : validation manuelle dès que le nom INPI ne correspond pas, KYC manuel, factures `a_valider`, retrait d'annonce impossible, « demande de mise en relation avocat » qui promet une intervention de Micael.
15. **Trois bombes techniques à désamorcer cette semaine** : clé Stripe LIVE, clé Brevo et mot de passe Mongo dans l'historique Git ; `stripe.error` inexistant dans stripe 13 (toute erreur KYC = 500 brut) ; aucune sauvegarde Mongo alors que mandats et preuves de signature, pièces qu'un titulaire de carte T doit conserver, y vivent.
16. **Les coûts ne sont pas le problème** : 4-7 k€/an aujourd'hui, 8-15 €/mois d'infrastructure fixe. Le problème est le délai avant le premier euro et le taux de closing, que rien dans le produit ne fait monter.

**Ce qui marchera** : un cédant qui voit ses qualifications RGE et une fourchette de valeur avant même de créer un compte ; un mandat qu'il signe sans y réfléchir parce qu'il est simple, résiliable et chiffré en HT ; un repreneur qui se présente en deux minutes et ne sort sa pièce d'identité qu'au moment de voir le nom de la société ; des documents propres, envoyés aux deux parties ; un accueil qui dit qui opère et ce que la commission comprend ; un encaissement qui passe par le rédacteur d'acte.

**Ce qui ne marchera pas, même bien exécuté** : vivre de la commission en année 1 ; faire payer les repreneurs (interdit) ; un abonnement ou une structure à deux entités pilotée par un fondateur seul sans juriste ; le courtage CEE et la mise en relation sous-traitants/fournisseurs comme moteurs de croissance ; attendre les consolidateurs sur des artisans à 300 k€ de CA (ils achètent 2-6 M€) ; le « zéro humain » absolu avec des cédants de 60 ans (il faut une voix, 15 minutes, une fois, réservable en ligne).

---

## 2. Positionnement

> **CessionRGE est le tiers de confiance des cessions d'entreprises RGE.** Opéré par un professionnel titulaire de la carte T. Chaque annonce est contrôlée sur la base officielle ADEME et accompagnée d'un diagnostic de transmissibilité du label ; chaque repreneur est identifié avant de connaître le nom de la société ; chaque document (mandat, accord de confidentialité, offre) est signé en ligne avec dossier de preuve. **Gratuit pour les repreneurs. Pour le cédant : rien avant la vente, 6 % HT à l'acte, sans exclusivité, résiliable à tout moment.**

- **Pour le cédant (côté rare)** : « Vendez votre entreprise RGE sans que personne ne le sache, sans exclusivité, sans rien payer avant l'acte. » Cible prioritaire : dirigeants d'entreprises RGE de 3 à 30 salariés, 55 ans et plus, PAC/CVC avec contrats d'entretien et multi-qualifiés en tête (leur valeur monte), isolation/menuiserie/PV ensuite (parcours identique, prix plus bas).
- **Pour le repreneur** : « Reprenez une activité RGE vérifiée et saine. » L'artisan voisin en croissance, le salarié ou cadre avec apport, la structure commerciale qui doit internaliser le RGE avant 2027.
- **Pour le consolidateur** (Butagaz Eco-énergie, Isovalie, Émeraude Power, Satep, Atout Groupe, Renovio) : un mandat de recherche en année 2, pas une annonce.

**Décision structurante : rester 100 % intermédiaire mandaté (carte T).** Pas de bascule « média » à la Fusacq (200-400 € par annonce, 10-30 k€/an au volume probable, et la perte de la seule promesse différenciante : le cadre sécurisé), pas de deux entités (frontière floue, deux CGV, un juriste nécessaire, rendement nul sous 150-300 annonces actives).

**Déclencheur d'élargissement, décidé maintenant** : si à M+6 le flux est inférieur à 3 annonces publiées par mois malgré le plan §8, ouvrir aux entreprises du bâtiment qualifiées (Qualibat, Qualifelec, Qualit'EnR hors RGE) avec le RGE comme filtre premium. Le code, le mandat et le barème ne changent pas ; seuls les contenus et le sourcing s'élargissent.

---

## 3. Monétisation : qui paie, combien, quand, sur quelle base légale

### 3.1 La règle

Sur toute affaire sous mandat, **aucune somme des parties avant la conclusion constatée par l'acte** (loi Hoguet, art. 6 I ; décret 1972 art. 73 : aucune autre rémunération que celle du mandat). Les revenus complémentaires sont donc soit payés par des tiers, soit portent sur un produit vendu à tous, au même prix, sans lien avec un mandat.

### 3.2 Les lignes retenues

| # | Ligne | Qui paie | Prix | Quand | Base légale | Pourquoi | Part attendue année 1 (médian) |
|---|---|---|---|---|---|---|---|
| 1 | **Commission de cession** (mandat de vente simple) | **Le cédant**, toujours (le choix du débiteur est supprimé) | **6 % HT du prix de cession jusqu'à 1 M€, 3 % HT sur la part au-delà ; minimum 4 000 € HT** ; TVA 20 % (HT affiché d'abord partout, TTC entre parenthèses) | À la signature de l'acte, prélevée sur le prix par le rédacteur d'acte (ordre irrévocable de paiement dans le mandat) ; facture Stripe Invoicing émise automatiquement à la déclaration de vente | Art. 6 loi Hoguet : mandat écrit numéroté au registre, rémunération et débiteur déterminés, due à la conclusion ; clause de suite limitée dans le temps et aux acquéreurs nommément présentés (Cass. 11 sept. 2025) | Un seul chiffre lisible par un artisan ; un seul régime de facture ; au-dessus d'Alvo (2 %, sans carte T ni NDA géré), un tiers sous les cabinets (10 % HT, minimum 6 500-10 000 €) pour un service qui se situe exactement entre les deux | ≈ 55 % (≈ 7 k€) ; ≈ 80 % en année 2 |
| 2 | **Diagnostic de transmissibilité RGE** (PDF automatique : qualifications ADEME par organisme et échéance, référent technique, forme sociale et structure titres/fonds, SIREN/BODACC, exposition MPR/CEE déclarée, clause suspensive type, fourchette de valeur) | Année 1 : **personne** (inclus dans chaque annonce, et version courte gratuite pour tout SIRET saisi sur `/verifier-entreprise-rge`). À partir de M+7, après avis du conseil : **tout dirigeant, repreneur, expert-comptable ou banque** qui commande le rapport complet sur un SIRET **hors catalogue** | 0 € ; puis **79 € HT**, même prix pour tous, aucune remise, aucune condition de mandat ; jamais vendu sur une entreprise sous mandat (il y est inclus) | Paiement Stripe à la commande, PDF immédiat | Produit logiciel hors art. 1er Hoguet (ni entremise ni opération) ; précautions de l'audit juridique : CGV séparées, prix identique, traces d'un produit qui vit seul ; certitude « Moyen » → avis du conseil avant la version payante | C'est la preuve produit n° 1 : ce qu'aucun concurrent ne fait, ce qui rassure le repreneur et ce qui amène des cédants (aimant SEO « vérifier entreprise RGE ») | ≈ 5 % (≈ 1 k€, à partir de M+7) |
| 3 | **Apport d'affaires rémunéré par des partenaires** : expert-comptable spécialisé bâtiment (audit d'acquisition, retraitement d'EBE), courtier en crédit professionnel (AlterEgo en qualité d'indicateur), courtier assurance décennale/RC | **Le partenaire**, jamais les parties | 300-600 € par mission d'audit ; 200-600 € par dossier financé ; 300-800 € par contrat ; convention d'apporteur signée une fois par partenaire | À la signature de la mission / du prêt / du contrat chez le partenaire (déclencheurs : NDA → expert-comptable ; offre acceptée → crédit ; vente déclarée → assurance) | Hors art. 1er Hoguet (somme payée par un tiers, pas « due » par les parties ni représentative d'entremise sur la cession) ; transparence obligatoire (code de déontologie : chaque message dit que le partenaire rémunère la plateforme) ; pour le crédit, statut d'indicateur (pas de conseil, pas de remise de documents de prêt) | Seul revenu à encaissement court compatible avec le mandat ; en plus, proposer un expert-comptable au moment du NDA est un service de confiance | ≈ 30 % (≈ 4 k€) ; 10-15 % en année 2 |
| 4 | **Mandat de recherche** pour consolidateurs et repreneurs structurés (année 2) | **L'acquéreur** mandant | **3 % HT du prix, minimum 6 000 € HT**, uniquement sur une cible **hors catalogue** sourcée pour lui (jamais de double commission sur une annonce publiée) | Au closing | Mandat de recherche écrit, inscrit au **même registre unique** que les mandats de vente (Cass. 10 déc. 2014), commission déterminable et acceptée par écrit, reprise dans l'acte ; rien avant conclusion | C'est là que sont les acheteurs solvables ; cela transforme la prospection en « un acquéreur vérifié vous cherche » ; une seule action sortante (un e-mail par groupe), puis self-service | 0 en année 1 ; 10-15 % en année 2 |
| 5 | **Annuaire de partenaires** (avocats, experts-comptables, financeurs référencés) | Les professionnels référencés | 0 en année 1 ; 40 € HT/mois par fiche étiquetée « partenaire » en année 2 si > 60 annonces actives | Mensuel, Stripe Payment Link | Vente d'espace clairement identifié, hors opération (les avocats ne peuvent pas rémunérer l'apport d'affaires : sponsoring seulement) | Anecdotique ; ne pas y consacrer de développement avant d'avoir du trafic | 0 |

**Explicitement exclu, et pourquoi** : annonce payante, mise en avant, dossier de présentation payant, estimation payante au cédant, crédits ou abonnement repreneur, accès anticipé payant, abonnement « flux acquéreur » — tous sont des sommes représentatives de frais de recherche, de démarche, de publicité ou d'entremise perçues avant conclusion par un mandataire (infraction art. 6, nullité du mandat, perte de la commission ; l'abonnement d'accès aux fiches relèverait en plus du statut de marchand de listes). Le courtage CEE (piste v2) : 0 € dans le plan ; test manuel avec 10 installateurs entre M+3 et M+5, on ne code que si trois signent.

### 3.3 Justification du barème face aux concurrents cités

| Prix de cession | CessionRGE nouveau (6 % / 3 % > 1 M€, min 4 000 €, cédant) | CessionRGE actuel (10/8/6, débiteur au choix) | Transaxio (acquéreur, humain) | Michel Simond (≈ 10 % TTC, acquéreur) | Alvo (repreneur, 2 % min 1 000 €) | CCI Côte d'Azur |
|---|---|---|---|---|---|---|
| 50 000 € | **4 000 € (minimum)** | 5 000 € | 6 500 € (forfait) | ≈ 4 200 € HT | 1 000 € | 900 € |
| 85 000 € (médiane des fonds artisanaux) | **5 100 €** | 8 500 € | 8 500 € | ≈ 7 100 € HT | 1 700 € | 900 € |
| 180 000 € (médiane attendue des annonces) | **10 800 €** | 18 000 € | 18 000 € | ≈ 15 000 € HT | 3 600 € | 900 € |
| 350 000 € | **21 000 €** | 35 000 € | 35 000 € | ≈ 29 200 € HT | 7 000 € | 900 € |
| 700 000 € | **42 000 €** | 66 000 € | 62 500 € | ≈ 58 300 € HT | 14 000 € | 900 € (plafond 10 800 €) |
| 1 500 000 € | **75 000 €** | 130 000 € | 72 500 € | — | 30 000 € | — |

- **Pas 10 %** : c'est le tarif d'un cabinet qui valorise, visite, négocie et se fait payer chez le notaire. Le marché l'accepte avec un humain ; sans humain, il produit des refus de mandat (taux de signature estimé 45-60 %) et du contournement. C'est aussi le taux qu'un cédant de mauvaise foi conteste.
- **Pas 2-3 % sans minimum** : la commission est le seul revenu autorisé de la part des parties ; à 3 % une cession médiane rapporte 5 400 € pour un dossier qui coûte le même travail de conformité (KYC des deux parties, mandat, NDA, data room, registre, LCB-FT, facture, veille). Alvo est à 2 % mais sans carte T, sans NDA géré, sans registre, et payé par le repreneur.
- **Pas de barème à trois tranches** : un artisan ne lit pas « tranches successives » ni « Lehman ». Un taux, un minimum, une phrase. La dégressivité ne sert qu'au-delà de 1 M€, où l'on passe sous Transaxio (75 000 € contre 72 500 € à 1,5 M€ : équivalent).
- **6 % avec minimum 4 000 €** : 40 % sous les cabinets pour un service qui comprend réellement anonymisation, contrôle ADEME, diagnostic de transmissibilité, repreneurs identifiés, NDA et offre signés en ligne avec dossier de preuve, data room filigranée avec journal, suivi des offres, mandat et registre carte T, veille BODACC, encaissement organisé au séquestre, un appel de 15 minutes à la signature. Le minimum est la moitié de celui de Transaxio et couvre le coût fixe d'un dossier. Sur la médiane (180 k€) : 10 800 € HT, moins que l'écart de prix qu'obtiennent deux repreneurs en concurrence.
- **Cédant toujours débiteur** : un seul régime de facture et de recouvrement ; plus de bandeau « 141 600 € TTC » en tête d'annonce qui tue la demande ; le mandant qui bénéficie du service le paie ; cohérence mandat = acte (jurisprudence sur l'identité du débiteur). L'acquéreur ne paie que sous forme de mandat de recherche, où il est mandant.
- **Distribution de prix retenue** (25 % ≈ 80 k€, 35 % ≈ 180 k€, 25 % ≈ 350 k€, 12 % ≈ 700 k€, 3 % ≈ 1,5 M€) : **commission médiane ≈ 10 800 € HT, moyenne ≈ 17 500 € HT** (ancien barème : 18 000 / 28 900).

### 3.4 Ce que la commission achète (texte à mettre sur l'accueil)

« Diffusion anonyme indexée · qualifications contrôlées sur la base ADEME et diagnostic de transmissibilité du label · repreneurs présentés avec leur projet, identité vérifiée avant toute révélation · accord de confidentialité et offre signés en ligne avec dossier de preuve · espace documents filigrané avec journal des consultations · suivi des offres · mandat et registre tenus par un professionnel carte T · veille des publications légales · facture réglée par le rédacteur d'acte sur le prix · 15 minutes au téléphone avec le fondateur à la signature du mandat. La négociation et les actes restent entre vous et le repreneur, avec vos conseils. »

---

## 4. Le mandat cible (à faire relire une fois)

- **Nature** : mandat simple de vente, non exclusif. Le cédant reste libre de vendre seul ou par un tiers ; écrit en gras sur la page mandat (« Vous ne nous devez rien si vous vendez à quelqu'un que nous ne vous avons pas présenté »).
- **Durée** : 12 mois, sans tacite reconduction ; renouvellement en un clic depuis l'espace vendeur (e-mail J-30) ; dénonçable à tout moment par chaque partie avec 15 jours de préavis par e-mail avec accusé (bouton « Résilier mon mandat » dans l'espace vendeur).
- **Objet déterminé** : forme sociale (SIREN → INPI) et structure (titres / fonds) pré-cochées ; dénomination, SIREN, adresse du siège obligatoires, collectés au dépôt ; génération bloquée si vides.
- **Rémunération** : 6 % HT (3 % au-delà de 1 M€), minimum 4 000 € HT, à la charge du mandant, exigible à la signature de l'acte ; **ordre irrévocable de paiement** donné au rédacteur d'acte sur le prix ; obligation de communiquer l'identité du rédacteur d'acte et la date de signature sous 8 jours.
- **Clause de suite** : 12 mois après la fin du mandat, limitée aux repreneurs nommément présentés ; liste nominative horodatée envoyée automatiquement au cédant en fin de mandat (c'est la preuve qui fait gagner un contentieux sans avocat).
- **Obligations du mandataire alignées sur le produit** : diffusion anonyme, contrôle des qualifications, identification des repreneurs, outils de signature et de data room, tenue du registre. Rien de ce que le produit ne fait pas.
- **Mentions** : n° et lieu de délivrance de la carte, CCI, « ne doit recevoir ni détenir d'autres fonds… » (ou garantie si elle existe), RC pro ; lieu « signature électronique à distance » ; horodatage qualifié.
- **Signature** : signature avancée eIDAS avec horodatage qualifié (prestataire, ~1-2 € par signature) pour le mandat, le mandat de recherche et l'offre acceptée ; OTP e-mail conservé pour le NDA ; contre-signature automatique d'AlterEgo ; PDF signé numéroté envoyé au cédant (preuve de remise).
- **Un refus d'annonce après signature rend le mandat caduc** : statut « annulé » au registre (numéro conservé), e-mail motivé.
- Toujours signé à distance, jamais chez l'artisan (L221-3 C. conso : rétractation 14 jours pour les pros ≤ 5 salariés hors établissement).

---

## 5. Parcours cibles

### 5.1 Cédant : trois écrans, dix minutes, zéro attente humaine

1. **Estimer** (sans compte, depuis l'accueil ou `/estimer`) : SIRET → raison sociale, forme, qualifications RGE avec organisme et échéance chargées devant ses yeux (ou « vérification RGE en cours » si l'API ne répond pas : jamais bloquant). Trois chiffres (CA, EBE ou résultat, effectif) + trois cases (référent technique = dirigeant ? contrats d'entretien ? part de CA aidé) → **fourchette de valeur** (multiples recalibrés 0,3-0,6 × CA et 2,5-4 × EBE retraité, pondérés par les trois cases). E-mail pour recevoir le PDF → compte créé en un clic (e-mail confirmé par lien, c'est le double opt-in).
2. **Compléter l'annonce** (brouillon serveur sauvegardé à chaque champ) : écran A activité, région, département, titre généré ; écran B chiffres clés avec infobulles, exemples et case « à préciser avec mon comptable », bornes de validation (marge 0-100, montants ≥ 0, cohérence CA/EBE) ; écran C prix demandé (alerte si hors fourchette), type de cession, motif de vente, accompagnement proposé, bloc « ce qui rassure un repreneur » (décennale, référent technique, carnet de commandes en mois, part CA aides/mandataires, matériel, locaux). Aperçu de l'annonce anonyme telle que la verra un repreneur.
3. **Vérifier et signer** : identité Stripe (dans le même onglet, « 3 minutes, pièce d'identité + selfie, une seule fois ») → page mandat : résumé en 5 lignes (non exclusif, 12 mois, résiliable, 6 % HT à l'acte = X € HT sur votre prix, rien avant), texte intégral dépliable, case activée en fin de défilement, signature avancée → **publication immédiate** du teaser anonyme si identité vérifiée + mandat signé + SIREN actif + présent dans la liste ADEME + pas de doublon ; nom INPI non concordant = drapeau de post-modération 48 h, pas de blocage.
4. Juste après : « Prenez 15 minutes avec Micael » (lien Cal.com, facultatif) + e-mail avec le mandat signé numéroté + checklist pour passer le score de complétude de 60 à 85.

### 5.2 Repreneur : se présenter avant de se dévoiler

1. **Parcourir sans compte** ; alerte par e-mail sans compte (e-mail + activité + région).
2. **Inscription en un écran** : projet (type : artisan en croissance / salarié ou cadre avec apport / groupe / investisseur), zones, métiers visés, budget et apport (tranches), financement envisagé, horizon, présentation libre 300 caractères, SIREN facultatif (enrichi Sirene : ancienneté, effectif, déjà RGE). E-mail confirmé par lien. Score 0-100 calculé, badges.
3. **Contacter gratuitement** : « Présentez votre projet » pré-rempli depuis le profil ; le cédant reçoit une **carte repreneur** pseudonymisée (type, zone, budget, financement, badges, premier message) et valide en un geste ; relances automatiques J+2/J+5, expiration J+10 avec e-mail au repreneur.
4. **NDA** : identité Stripe demandée **ici** (avant révélation du nom), puis signature par code ; identité révélée, data room ouverte, diagnostic de transmissibilité RGE consultable ; exemplaire signé envoyé par e-mail et téléchargeable.
5. **Offre indicative** (remplace la LOI comme condition) : formulaire structuré (montant, titres/fonds, crédit vendeur, conditions suspensives, calendrier), signature avancée, contre-signée par le cédant s'il l'accepte ; exclusivité optionnelle. Montants en `fr-FR`.
6. **Offre acceptée** : champs obligatoires rédacteur d'acte (nom, e-mail) et date prévisionnelle ; checklist de closing ; proposition de partenaires (crédit) avec mention de la rémunération.

### 5.3 Closing et encaissement

- Écran « Déclarer la vente » pour les deux parties, confirmation croisée (silence 7 jours = confirmé) ; note d'honoraires et instruction de règlement envoyées automatiquement au rédacteur d'acte et au cédant ; facture Stripe Invoicing (conforme L441-9, lien de paiement, relances J+15/30/45, statut lu par webhook) ; routes admin « closing confirmé » / « payé ».
- Veille mensuelle BODACC (ventes et cessions de fonds) + RNE/INPI (changement de dirigeant/associés) sur chaque SIREN sous mandat, sous clause de suite ou ayant un NDA signé ; e-mail automatique au cédant citant la clause + alerte admin + création de la facture.
- Relances cédant J+30 (statistiques et complétude), J+60 (« toujours à vendre ? »), J+90 (« ajuster le prix ? » avec fourchette), J+120 (« avez-vous vendu ? », archivage sans réponse) ; relance mandat J+3/J+10/J+30.

---

## 6. Accueil cible et direction design

### 6.1 Promesse

Une seule cible au-dessus de la ligne de flottaison : le cédant. Une seule preuve en premier : qui opère. Un seul CTA. Longueur visée ≈ 2 800 px desktop / 5 500 px mobile, ≈ 450 mots, 1 CTA principal répété trois fois.

### 6.2 Sections et textes clés

**0. En-tête** — Logo · Entreprises à vendre · Vendre · Reprendre · Guides · Connexion · **[Estimer mon entreprise]** (primaire, navy). Mobile : logo, bouton, menu.

**1. Hero (fond blanc, texte 55 % / visuel 45 %)**
- Eyebrow : « Cession d'entreprises RGE · opéré par AlterEgo, carte professionnelle T »
- H1 : **« Vendez votre entreprise RGE sans que personne ne le sache. »**
- Sous-titre : « Annonce anonyme, repreneurs identifiés, accord de confidentialité signé avant toute révélation. Rien à payer avant la vente : 6 % HT à la signature de l'acte, sans exclusivité, résiliable à tout moment. »
- CTA principal : « Estimer mon entreprise en 2 minutes » → `/estimer` (SIRET, sans compte). CTA secondaire (lien) : « Déposer mon annonce anonyme » → `/register?role=seller`. Discret : « Vous cherchez une entreprise à reprendre ? Voir les annonces → ».
- Visuel : capture produit d'une annonce anonyme avec le badge « RGE vérifié le 03/10/2026 sur la base ADEME » et le cadenas « nom et SIRET révélés après accord de confidentialité », sur photo de chantier en duotone.

**2. Bande d'autorité (fond surface, 4 sceaux)** — « AlterEgo SAS, carte professionnelle T n° CPI 7801 2025 000 000 049, CCI Paris Île-de-France » · « Qualifications contrôlées sur la base officielle ADEME » · « Identité des repreneurs vérifiée par Stripe Identity avant toute révélation » · « 0 € avant la signature de l'acte — c'est la loi (art. 6, loi Hoguet) et notre modèle ».

**3. Ce que nous vérifions (3 cartes, c'est la section « produit = preuve »)** — « Votre entreprise » (qualifications, organismes, échéances, référent technique → diagnostic de transmissibilité inclus) · « Vos repreneurs » (projet, budget, financement déclarés ; identité vérifiée au NDA ; badge « entreprise du bâtiment établie ») · « Vos documents » (mandat, accord de confidentialité, offre : signés en ligne, horodatés, envoyés aux deux parties).

**4. Comment ça marche (timeline, vrais onglets accessibles Je cède / Je reprends)**
Cédant : 1 « Estimez : votre SIRET charge vos qualifications, trois chiffres donnent une fourchette » · 2 « Complétez votre annonce anonyme, sauvegardée à chaque étape » · 3 « Vérifiez votre identité et signez le mandat en ligne : simple, 12 mois, résiliable en un clic » · 4 « Recevez des repreneurs présentés avec leur projet ; révélez votre nom après accord de confidentialité ; recevez les offres ».
Repreneur : 1 « Parcourez, créez une alerte » · 2 « Présentez votre projet en 2 minutes » · 3 « Contactez le cédant gratuitement » · 4 « Vérifiez votre identité au moment de l'accord de confidentialité, accédez aux documents, faites une offre ».
Dessous : « Vous êtes prévenu par e-mail à chaque contact, accord et offre » (remplacé par le délai médian mesuré dès 10 ventes).

**5. Annonces récentes (ListingCard compacte ×3)** — « Entreprises RGE à reprendre en ce moment » ; si < 6 annonces, la 3e carte devient « Recevoir les prochaines annonces par e-mail » (sans compte).

**6. Tarif (une carte + calculateur)**
- H2 : **« Vous ne payez qu'à la vente. »**
- Texte : « Publication gratuite. À la signature de l'acte de cession, une commission de 6 % HT du prix (3 % sur la part au-delà d'un million d'euros), minimum 4 000 € HT, à la charge du cédant. Pas d'exclusivité, pas d'abonnement, rien pour les repreneurs. »
- Calculateur : « Prix de cession envisagé : [ 180 000 € ] → Commission : **10 800 € HT** (12 960 € TTC) ».
- Ligne « Ce que comprend la commission » (§3.4) ; note « La négociation et les actes restent entre vous et le repreneur, avec vos conseils. »

**7. Qui est derrière (FounderCard + chiffres)** — « Micael [Nom], fondateur. AlterEgo SAS, Sartrouville, carte T délivrée par la CCI Paris Île-de-France. » + 3 lignes (constat des groupes Facebook non vérifiés, pourquoi un tiers de confiance) + « 15 minutes pour en parler » (Cal.com). Chiffres dès qu'ils dépassent 20 (annonces publiées, repreneurs vérifiés, NDA signés sur 30 jours), sinon « Lancé en 2026 · toute la France ».

**8. Questions fréquentes (5)** — « Mes salariés et mes clients peuvent-ils savoir que je vends ? » · « Combien ça coûte, et qui paie ? » · « Qui sont les repreneurs, et comment sont-ils filtrés ? » · « Et si je vends par moi-même ? » (mandat non exclusif, clause de suite expliquée franchement) · « Que devient ma qualification RGE après la vente ? » (lien guide + diagnostic).

**9. Guides (3 cartes avec visuel)** · **10. CTA final (seul bloc sombre)** « Prêt à transmettre votre entreprise RGE ? — Estimer mon entreprise » · **11. Pied de page** avec bloc légal complet : « AlterEgo SAS · 43 rue Massenet, 78500 Sartrouville · RCS Versailles 952 180 230 · Carte professionnelle T n° CPI 7801 2025 000 000 049, CCI Paris Île-de-France · ne doit recevoir ni détenir d'autres fonds que ceux représentatifs de sa rémunération · RC pro [assureur] · contact@cessionrge.fr ».

Supprimé de l'accueil : formulaire de recherche du hero (reste sur `/search` et le hub), vérificateur RGE (→ page `/verifier-entreprise-rge` indexée, avec l'encart « Vous dirigez cette entreprise ? Estimez-la »), newsletter « communauté RGE », tableau du barème (→ calculateur ; tableau conservé sur `/vendre`).

### 6.3 Direction design

- **Ambiance** : intermédiaire de transmission, spécialiste, fiable, moderne. Fond clair ; plus de dégradé navy ni de halos ; un seul bloc sombre (CTA final).
- **Palette** : encre navy `#0b1220` (texte, boutons primaires) ; blanc, surface `#f5f7fa`, bordures `#e3e7ee` ; action bleu `#1d4ed8` (une seule valeur) ; **vert `#15803d`/`#dcfce7` réservé au badge RGE et à la pastille « vérifié »**, jamais pour les titres ni les CTA ; ambre `#b45309`/`#fef3c7` à petite dose (encart « commission à la charge du cédant », « prix révisé »).
- **Typographie auto-hébergée** (RGPD + rendu) : Manrope 700/800 pour les titres (H1 44-52 px desktop / 32 mobile, H2 32/26, H3 20), Inter 400/500/600 pour le texte (17/16 px, interligne 1,6, légendes ≥ 13 px, chiffres tabulaires pour prix et CA). Un seul style d'eyebrow.
- **Composants** : `ListingCard` unique (titre généré « Installateur PAC & chauffe-eau · Bretagne · 9 salariés », 2 badges RGE max + « +n », prix / CA / EBE, pastille « RGE vérifié le JJ/MM », département, type de cession) sur accueil, hub, activité, région, recherche ; `TrustBar` ; `ProcessTimeline` avec cadenas « identité révélée après NDA » ; `CommissionCalculator` ; `FounderCard` ; `BuyerCard` (côté cédant) ; `FaqList` limitée à 5 ; boutons primaire navy plein, secondaire blanc bordé, tertiaire lien bleu.
- **Visuels à coût maîtrisé** : 3-4 photos de chantier (PAC, isolation, toiture PV, menuiserie) en duotone navy ; 2 captures produit anonymisées (annonce avec badge et cadenas, écran « identité révélée après NDA ») ; carte de France SVG avec points par région pourvue (remplace la grille de 14 régions à zéro) ; portrait du fondateur ; retouche du pictogramme (maison + feuille → signe de transmission), graphiste 300-800 €.
- **Ton** : vouvoiement, phrases courtes, chiffres ; « accord de confidentialité (NDA) », « lettre d'intention », « espace documents sécurisé », « identité vérifiée », « mandat », « acte » ; bannir « communauté », « rejoignez », « Lehman », « simple et transparent » sans chiffre.
- **Cohérence** : en-tête et pied de page communs sur fiche, connexion, inscription ; inscription avec rôle via `?role=` et deux grandes cartes « Je cède / Je reprends » ; fiche publique avec titre composé, description, atouts, diagnostic RGE en résumé, « commission à la charge du cédant, aucun frais pour vous ».

---

## 7. Changements produit priorisés

Effort : S < 1 jour, M 1-3 jours, L > 3 jours.

### P0 — semaines 1 à 4 : sans quoi le produit n'est ni sûr, ni crédible, ni encaissable

| # | Changement | Pourquoi | Effort |
|---|---|---|---|
| 1 | Révoquer et régénérer clé Stripe live, clé Brevo, mot de passe Mongo ; secret scanning + push protection GitHub ; gitleaks en pré-commit | Contrôle total du compte Stripe (données d'identité, virements) par quiconque a lu le dépôt | S |
| 2 | `stripe.error.*` → `stripe.StripeError` / `stripe.SignatureVerificationError` (6 occurrences) + test monkeypatch ; message d'erreur KYC réessayable | Toute erreur Stripe = 500 brut à l'entrée du tunnel ; Stripe désactive un webhook qui répond 500 | S |
| 3 | Sauvegarde Mongo quotidienne vers S3 (rétention 30 j, restauration testée une fois) ; S3 obligatoire en prod ; health réel ; Sentry + UptimeRobot | Mandats et preuves de signature sont des pièces que la carte T impose de conserver | S |
| 4 | Rate limiting (slowapi) login/register/forgot/request-code ; bcrypt en `to_thread` ; `/docs` fermés ; CORS sans défaut `*` ; en-têtes nginx ; route admin reset-password supprimée ; code OTP hors de l'objet de l'e-mail ; webhook paiements exigeant un secret ou supprimé | Serveur mono-processus et quota Brevo gratuit protégés ; le code « vaut signature » ne doit pas fuir dans les aperçus | S |
| 5 | **Mandat simple** (§4) : texte, objet pré-coché, adresse collectée, contre-signature, dates `signed_at`/`ends_at`/`tail_ends_at`, ordre de paiement au rédacteur d'acte, PDF numéroté envoyé, liste des acquéreurs en fin de mandat, caducité au refus, résiliation en un clic ; relecture par le conseil (2 500-4 000 €) | Le mandat actuel est annulable et dissuasif ; c'est le titre de créance de 100 % du revenu | M |
| 6 | **Barème 6 % / 3 % > 1 M€, minimum 4 000 € HT, cédant débiteur fixe, HT d'abord** : `offer.js` (brackets, `COMMISSION_MIN_HT`, `rateLabel`, exemple 180 k€), `business_model.py`, `/config`, tests ; suppression des cartes de débiteur (`MandatePage`), du `CommissionNotice` acquéreur et de la clause acquéreur du NDA ; calculateur sur l'accueil | Source unique : une heure de travail ; lisibilité pour un artisan ; un seul régime de facture | S |
| 7 | **Signature avancée eIDAS** (prestataire, API) avec horodatage qualifié pour mandat, mandat de recherche, offre acceptée ; OTP conservé pour le NDA ; page de preuve dans chaque PDF ; exemplaires envoyés aux deux parties et téléchargeables (endpoint PDF buyer) | Signature simple sans présomption de fiabilité (Cass. 5 mars 2026) : la preuve pèse sur AlterEgo ; aujourd'hui l'acheteur ne garde aucune copie | M |
| 8 | **Gabarits NDA / offre nettoyés** : variables `{{DOC_ID}}`, `ATTESTATION_FONDS`, `MULTIPLE_EBITDA` retirées, montants formatés `fr-FR`, champs vides collectés ou supprimés, résumé en 5 lignes au-dessus du texte intégral, case activée en fin de défilement | Un avocat refuse de signer les documents actuels ; la crédibilité de toute la chaîne (mandat compris) en dépend | S |
| 9 | **Inscription cédant sans dépendance ADEME** : « introuvable » ≠ « service indisponible », vérification RGE différée en tâche de fond avec cache 24 h, badge « RGE en cours de vérification », blocage seulement à la publication | Point de défaillance unique sur la seule porte d'entrée du côté rare | S |
| 10 | **Double opt-in** e-mail à l'inscription (lien signé 24 h), correction de l'adresse possible, domaines jetables bloqués ; lien de désinscription sur alertes et relances ; SPF/DKIM/DMARC sur cessionrge.fr ; une seule variable d'adresse admin | L'e-mail porte le code qui vaut signature ; délivrabilité Brevo ; conformité des e-mails non transactionnels | S |
| 11 | **Messagerie** : conversations par couple (annonce, acquéreur), `sender_label` affiché, `receiver_id` fixé, fil nommé (activité · région · prix · pseudonyme), ouverture de la bonne conversation après contact, message système corrigé, layout mobile liste → fil, explication du masquage | Au deuxième repreneur, le cédant répond à la mauvaise personne : le cœur de la plateforme est cassé | M |
| 12 | **Encaissement** : rédacteur d'acte + date prévisionnelle obligatoires à l'acceptation d'offre ; écran « Déclarer la vente » à confirmation croisée ; note d'honoraires automatique ; Stripe Invoicing (facture conforme, lien de paiement, relances, webhook) ; routes admin « closing confirmé » / « payé » ; PDF maison supprimé ; modèle de mise en demeure | Aujourd'hui zéro mécanique d'encaissement ; facturation électronique 2027 réglée par l'outil | L |
| 13 | **Veille anti-contournement** : job mensuel BODACC + RNE/INPI sur chaque SIREN sous mandat, clause de suite ou NDA signé ; e-mail automatique + alerte admin + facture ; relances cédant J+60/J+120 avec archivage | Dans un métier local, la vente hors plateforme n'est jamais sue ; données gratuites ; c'est ce qui remplace l'équipe | M |
| 14 | **Publication automatique** (identité + mandat + SIREN actif + liste ADEME + pas de doublon), post-modération 48 h, bouton « Refuser » à 6 motifs alimentant l'e-mail et le dashboard ; retrait / pause / vendue (via CessionRGE → déclaration ; ailleurs → rappel de la clause de suite) en libre-service ; modifications sensibles journalisées | Supprime la promesse « sous 48 h » et les clics bloquants hebdomadaires ; plus d'annonces fantômes | M |
| 15 | **Accueil, confiance et mobile** : hero mono-cible, bande d'autorité, calculateur, bloc fondateur + Cal.com, pied de page légal, mentions légales et confidentialité complétées (`REACT_APP_LEGAL_DRAFT=false`), carte T dans le JSON-LD Organization ; débordement mobile de la carte tarifs corrigé (`min-w-0`, cellules coupables) ; compteurs à 0 masqués ; `noindex,follow` sur pages activité/région vides ; `noindex` sur `/search` ; domaine canonique fixé sur cessionrge.fr (`REACT_APP_SITE_URL`, `FRONTEND_URL`, OG image, 301 depuis le sous-domaine) ; `/company/:id` retirées du sitemap tant que non pré-rendues ; polices auto-hébergées ; encart « nous pouvons accompagner… » retiré de la fiche ; Search Console vérifiée | Le premier frein à la signature est l'absence de preuve ; le site n'est pas indexé ; la page de prix est illisible sur l'appareil des artisans | M |

### P1 — semaines 5 à 10 : le produit qui convertit seul

| # | Changement | Pourquoi | Effort |
|---|---|---|---|
| 16 | **Estimateur public** `/estimer` (SIRET → ADEME ; CA, EBE, effectif, 3 cases → fourchette ; PDF par e-mail ; compte en un clic) ; multiples recalibrés dans `/valorization/estimate` ; alerte « prix hors fourchette » sur l'annonce et dans l'admin ; CTA de l'accueil et des guides | L'aimant à cédants ; réduit les prix invendables, premier tueur de closings ; module existant non branché | M |
| 17 | **Création d'annonce en 3 écrans** avec brouillon serveur, infobulles, validation, « à préciser avec mon comptable », titre généré, description, motif de vente, accompagnement, département, bloc « ce qui rassure un repreneur » ; champs morts supprimés ; aperçu de l'annonce anonyme ; score de complétude | 13 champs en jargon sans sauvegarde ; l'artisan quitte pour appeler son comptable et perd tout ; annonces toutes identiques | M |
| 18 | **Fiche publique et cartes** : `rge_validity` affichée par qualification (ADEME) ou globale, champs saisis enfin affichés (carnet, mandataires, matériel, locaux, charges), multiple prix/EBE, département, type de cession, résumé du diagnostic RGE ; bloc « Domaines complémentaires » supprimé ; `ListingCard` unique ; une seule page de recherche ; familles de domaines repliables ; vues retirées du public | Le repreneur ne peut ni qualifier ni comparer ; un bloc affiche une information fausse | M |
| 19 | **Profil repreneur déclaratif + score + badges**, carte repreneur présentée au cédant avec la demande, « Présentez votre projet » pré-rempli, relances J+2/J+5, expiration J+10, option « accepter automatiquement les repreneurs vérifiés » ; double champ « nom de l'entreprise » supprimé ; profil éditable en français | Le cédant valide à l'aveugle ; l'acheteur ne peut pas se présenter | M |
| 20 | **KYC déplacé au NDA** (dans le même onglet, « 3 minutes, une fois »), KYC manuel supprimé (profil + admin), **data room ouverte après NDA + KYC**, **LOI remplacée par l'offre indicative structurée** co-signée, exclusivité optionnelle, lien « ouvrir la data room » dans la messagerie, état vide explicite, worker pdf.js embarqué dans le build | Chaque filtre divise la demande ; KYC payé pour chaque curieux ; data room en erreur derrière un proxy d'entreprise | L |
| 21 | **Diagnostic de transmissibilité RGE** (version courte sur `/verifier-entreprise-rge`, version complète dans chaque data room) : ADEME (qualifications, organismes, échéances), forme sociale et structure, référent technique déclaré, BODACC, exposition MPR/CEE déclarée, clause suspensive type, fourchette de valeur | La preuve produit n° 1 ; inexistant sur le marché ; données gratuites | M |
| 22 | **Dashboard cédant** : bloc « À traiter » en tête (demandes, offres, messages non lus), bandeau KYC en `flex-col sm:flex-row`, photos réelles, modale de conséquences à la place de `confirm()`, prénom dans la salutation ; **e-mails** avec lien profond, extrait du message ou de l'offre, annonce nommée (domaine · région · prix), digest hebdo cédant (vues, favoris, contacts) et repreneur (nouvelles annonces, baisses de prix), motif de refus, objets sans émoji ; séquence complète (KYC repreneur, NDA sans suite J+14, checklist post-offre, fin de mandat J-30) en `claim_once` avec au plus un e-mail de relance par jour et par personne | Réactivité du cédant, retour des repreneurs ; le plus gros trou (repreneur inscrit non vérifié) n'est jamais relancé | M |
| 23 | **Admin « À faire »** par défaut (post-modération, bloquées, incidents de contournement, vendeurs muets > 7 j, offres acceptées > 60 j, factures en retard, mandats < 30 j, erreurs techniques), 5 chiffres semaine vs semaine, revenu calculé sur les factures, compteurs corrigés (`views`, KYC `under_review`), noms, mobile ; onglets Contrats/Data Room/Messages réduits | Le rituel de 15 min/semaine ; aujourd'hui une vue base de données avec des compteurs faux | M |
| 24 | **Conventions de partenaires** (expert-comptable, courtier crédit, courtier décennale) signées une fois ; routage automatique NDA / offre acceptée / vente déclarée avec mention de la rémunération ; endpoint « demande avocat » supprimé → page statique « Vos conseils » | Seul revenu à encaissement court ; promesse d'intervention humaine supprimée | S |
| 25 | **Pré-rendu des fiches** `/company/:id` côté serveur (title, description, H1 anonymisés) et retour dans le sitemap ; `lastmod` ; pages programmatiques métier × département alimentées par les comptages réels de la liste ADEME (pas de contenu mince) | L'actif d'acquisition de cédants le moins cher ; personne ne possède ce SERP | M |

### P2 — mois 3 à 6 : consolidation

| # | Changement | Pourquoi | Effort |
|---|---|---|---|
| 26 | Suppression du code mort (crédits, abonnements, remboursements, `/admin/stripe/*`, `CreditsPage`, générateur de contrats admin, collection documents parallèle), purge de `requirements.txt`, SDK Brevo remplacé par un appel `requests`, découpage de `server.py` en routeurs ; `GENERATE_SOURCEMAP=false`, ErrorBoundary, plugins Emergent retirés | 900 lignes mortes et un tableau de bord qui calcule le revenu sur des crédits inexistants ; chaque modification touche un fichier de 6 243 lignes | M |
| 27 | RGPD : index TTL (resets 1 h, OTP 24 h, kyc_sessions 30 j), purge `kyc_documents`, `DELETE /auth/me` anonymisant, export, durées réelles dans la politique ; AIPD Stripe Identity ; procédure LCB-FT d'une page + champ « origine des fonds » avant data room + attestation de formation | La politique promet ce que le code ne permet pas ; obligations d'un titulaire de carte T | M |
| 28 | Uploads : octets magiques vérifiés, PDF réécrits sans JS/OpenAction/EmbeddedFiles ; JWT 24 h + `password_changed_at` ; TOTP admin | Un fichier arbitraire passe en data room ; un compte admin compromis lit toutes les conversations | S |
| 29 | Mandat de recherche (fiche de cadrage, sourcing open data sur critères, accès 72 h en avance aux nouvelles annonces, commission 3 % min 6 000 € au closing, même registre) ; version payante du diagnostic (79 € HT) après avis du conseil | Les acheteurs solvables ; deuxième produit mandaté, une seule action sortante | M |
| 30 | Tests : Stripe (succès, erreur, webhook signé), jobs à horloge injectée, closing/facture, reset ; CI reliée au déploiement (build → image → webhook Dokploy après succès) ; `/chiffres` publique (annonces actives, repreneurs vérifiés, NDA 30 j, délai médian) | Le bug `stripe.error` vit dans la zone non testée ; les chiffres publics sont la preuve finale | M |

---

## 8. Acquisition sans commerciaux

### 8.1 Cédants (le côté rare)

1. **SEO vertical, l'actif principal** : vérification de l'indexation (Search Console, sitemap, robots, domaine canonique) dès la semaine 1 ; pages métier × département alimentées par les comptages ADEME (« 312 entreprises RGE isolation en Gironde, 24 % de dirigeants de plus de 60 ans ») ; guides existants + 6 nouveaux sur les questions d'intention (« la qualification RGE est-elle transmissible ? », « combien vaut une entreprise de pompes à chaleur ? », « que devient mon référent technique ? ») ; page `/verifier-entreprise-rge` (requêtes « vérifier RGE SIRET ») avec l'encart « vous dirigez cette entreprise ? estimez-la » ; baromètre trimestriel public de la cession RGE (relais Batiactu, Le Moniteur, backlinks). Coût : temps, 0 €.
2. **E-mailing B2B opt-out sur l'open data** (ADEME × Sirene × RNE ; jamais de scraping d'annuaires ni de LinkedIn — sanction Kaspr 240 k€) : segment « dirigeant ≥ 58 ans, entreprise ≥ 8 ans, ≥ 3 salariés » (≈ 11-16 k entreprises), 1 500-2 000 e-mails/mois en 3 touches, objet « 1 dirigeant RGE sur 4 a plus de 60 ans : combien vaut votre entreprise ? » → estimateur ; mention de la source (liste publique ADEME) et désinscription ; LIA écrite d'une page. Taux de réponse attendu 3-5 %, 25-35 % positifs → 15-30 conversations/mois sans appel sortant. Coût ≈ 100-150 €/mois (2 domaines satellites, 3 boîtes, outil de séquence). Démarre à M+2, après que le produit est crédible (on ne pousse pas 2 000 artisans vers un mandat annulable).
3. **Prescripteurs** : experts-comptables (premier interlocuteur de confiance des dirigeants) via la convention d'apport et une page « Partenaires » ; CAPEB départementales et CMA via contenu co-brandé « Transmettre une entreprise RGE » ; candidature comme partenaire de la Bourse Bpifrance Transmission (diffusion gratuite, très bien référencée, charte anonymat) et de Transentreprise (rediffusion). Coût : temps.
4. **La seule porte humaine** : un créneau de 15 minutes réservable (Cal.com), proposé après l'estimation et après la signature du mandat. 20-30 appels/mois tiennent dans l'agenda. Ce n'est pas de la prospection : c'est de la réassurance, et c'est ce qui double la conversion annonce → mandat.
5. **Pas de courrier postal** (1,50-2,50 € la lettre pour 1-3 % de retour) avant d'avoir mesuré l'e-mail ; un test de 200 lettres à M+5 au plus tôt.

### 8.2 Repreneurs

1. **Alertes sans compte** depuis `/search`, le hub, chaque page vide (« Bientôt des annonces en Corse, soyez prévenu ») ; digest hebdo ; e-mail de baisse de prix aux alertes et favoris.
2. **Pages SEO d'annonces** pré-rendues et cartes lisibles ; `/reprendre` avec les profils de repreneurs décrits et le parcours en 4 étapes.
3. **Partenaires** : Bpifrance Transmission et Transentreprise (flux d'annonces anonymes), CRA (contenu), LinkedIn organique du fondateur (1 post/semaine : chiffres du baromètre, cas anonymisés) ; automation LinkedIn côté acheteurs seulement si le temps le permet (0-80 €/mois).
4. **Mandat de recherche** (année 2) : un e-mail du fondateur à 10-20 groupes en build-up, puis self-service.
5. **Gratuité réelle et dite** : « aucun frais pour les repreneurs, à aucune étape : c'est la loi et notre modèle ». Face aux 6 500-10 000 € de minimum des cabinets et aux 45-60 € le contact de Fusacq, c'est l'argument.

---

## 9. Coût mensuel de fonctionnement

| Poste | Récurrent | Note |
|---|---|---|
| VPS Hetzner (2 vCPU / 4 Go) + Mongo auto-hébergé | 12-15 € | existant |
| S3 Scaleway fr-par (documents + sauvegardes) | 1-5 € | 75 Go offerts |
| Domaine cessionrge.fr + DNS | 1-2 € | |
| Brevo (transactionnel + automations) | 0-25 € | gratuit jusqu'à 300/jour |
| Sentry, UptimeRobot, Cal.com, Plausible auto-hébergé | 0-9 € | |
| Stripe Identity (KYC au NDA : ≈ 3 par annonce publiée + 1 cédant) | 10-30 € | ≈ 1,25-1,50 € par vérification |
| Signature avancée eIDAS (2 par annonce publiée) | 15-40 € | ~1-2 € par signature ou forfait ~30-40 €/mois |
| Stripe Invoicing | 0,4 % par facture | variable, négligeable |
| E-mailing B2B (2 domaines, 3 boîtes, outil de séquence) à partir de M+2 | 100-150 € | |
| Enrichissement données (Pappers/Societeinfo) | 0-50 € | open data ADEME/Sirene/BODACC gratuits |
| **Total récurrent** | **≈ 140-330 €/mois** (≈ 40-130 € sans l'e-mailing) | |

Dépenses uniques année 1 : avocat (mandat, NDA, offre, CGU, avis diagnostic payant) 2 500-4 000 € ; graphiste + photos 500-1 000 € ; RC pro carte T ≈ 1 000 €/an ; expert-comptable AlterEgo ≈ 1 200 €/an ; renouvellement carte T / formation 14 h ≈ 300-500 €. **Année 1 tout compris ≈ 8-10 k€.** Un seul closing médian (10 800 € HT) couvre l'année.

---

## 10. Unit economics

- Prix : médiane 180 k€, moyenne ≈ 300 k€ (distribution §3.3). **Commission médiane ≈ 10 800 € HT, moyenne ≈ 17 500 € HT.**
- Entonnoir médian après le plan : estimation → annonce créée 35 % ; annonce créée → mandat signé **75 %** (mandat simple, résiliable, 6 % HT, appel de 15 min ; 60 % avant) ; 8 contacts par annonce ; contact → NDA 45 % (profil repreneur, KYC au NDA ; 40 % avant) ; annonce vendue via un repreneur présenté dans les 12 mois **15 %** ; fuite (hors plateforme, non déclaré, non recouvré) **15 %** grâce à la veille BODACC, à l'ordre de paiement au rédacteur d'acte et à la liste nominative de fin de mandat (25 % avant).
- **Espérance de commission encaissée par annonce publiée ≈ 0,15 × 0,85 × 17 500 ≈ 2 230 € HT** (≈ 1 670 € par annonce créée). Ancien modèle : 3 250 € par annonce publiée mais 1 950 € par annonce créée avec 25 % de fuite et un mandat annulable : **le nouveau barème perd 40 % par closing, en regagne 35 % par le volume et la sécurité, et transforme une créance contestable en créance solide.** C'est le prix de la confiance ; il est payé une fois.
- Délai publication → acte : 9 mois ; encaissement +1 mois (séquestre).
- Coût variable par annonce publiée : KYC cédant 1,5 € + 3,6 KYC repreneurs 5,4 € + 2 signatures avancées 3 € + e-mails ≈ **10 €**. Coût d'acquisition cible par annonce publiée (e-mailing + SEO) : **< 120 €**.
- Revenus tiers par annonce publiée (année 2, médian) : ≈ 250 € d'apport d'affaires.
- **Point mort opérationnel** (≈ 3 k€/an récurrent) : 2 annonces publiées par an. **Un demi-salaire (40 k€)** : ≈ 17 annonces publiées par an. **Un salaire de fondateur (80 k€)** : ≈ 34 annonces publiées par an, soit 7-11 % du marché ouvert national, atteignable en année 2.
- Temps fondateur : 15 min par mandat signé, 15 min par offre acceptée, litiges résiduels ; à 40 annonces/an ≈ 1,5 h/semaine ; le reste des 5 h va au « À faire » admin, au contenu et aux partenaires.

---

## 11. Scénarios de revenus (encaissements HT)

Hypothèses communes : délai publication → acte 9 mois (pessimiste 10, optimiste 8) + 1 mois d'encaissement ; commission moyenne 17 500 € HT ; apport d'affaires 250 € par annonce publiée à partir de M+6 ; diagnostic payant à partir de M+7 ; mandat de recherche en année 2 seulement ; coûts ≈ 8-10 k€ en année 1, ≈ 4-6 k€ en année 2.

| | Pessimiste | Médian | Optimiste |
|---|---|---|---|
| Annonces publiées / mois | 1,5 dès M+4 (≈ 12 en année 1), 2 en année 2 | 3 dès M+3 (≈ 30 en année 1), 5 en année 2 | 5 dès M+3 (≈ 50 en année 1), 7 en année 2 |
| Création → mandat | 60 % | 75 % | 80 % |
| Annonces vendues via la plateforme à 12 mois | 8 % | 15 % | 22 % |
| Fuite | 30 % | 15 % | 10 % |
| Closings encaissés par M+12 | 0 | ≈ 0,4 | ≈ 1,6 |
| **Revenu cumulé à 12 mois** | **≈ 1-2 k€** (apport d'affaires seul) | **≈ 8-12 k€** (≈ 7 k€ de commission, 4 k€ d'apport, 1 k€ de diagnostics) | **≈ 35-40 k€** (≈ 28 k€ de commission, 6 k€ d'apport, 2 k€ de diagnostics) |
| Closings encaissés M+13 → M+24 | ≈ 1 | ≈ 5 | ≈ 12-13 |
| **Revenu année 2 (M+13 → M+24)** | **≈ 18-22 k€** (1 closing ≈ 15 k€, apport 3 k€, diagnostics 1-2 k€) | **≈ 100-115 k€** (5 closings ≈ 88 k€, 1 mandat de recherche ≈ 8 k€, apport 10 k€, diagnostics 4 k€) | **≈ 240-270 k€** (12-13 closings ≈ 220 k€, 2 mandats de recherche ≈ 20 k€, apport 18 k€, diagnostics 6 k€) |
| Part du marché ouvert (300-500 cessions/an) en année 2 | 5-8 % | 12-20 % | 17-28 % |

Lecture : le pessimiste est le scénario où la niche ne répond pas à l'e-mailing et où le SEO met 12 mois (déclencheur d'élargissement à M+6). Le médian est une activité qui paie un fondateur en année 2 et devient autonome en année 3. L'optimiste suppose que le SEO est pris en 6 mois et que le mandat de recherche signe avec deux consolidateurs ; sa part de marché est au plafond de ce qu'un site de niche peut capter. **Dans les trois cas, l'année 1 est à perte** : c'est structurel (9-12 mois de cycle), pas un défaut du plan.

---

## 12. KPIs (tableau « À faire » admin et page `/chiffres`)

- **Estimation → annonce créée** (cible 35 %) et **annonce créée → mandat signé** (cible 75 %) : le vrai goulot.
- **Délai dépôt → publication** (cible < 24 h, médiane) et part des annonces publiées sans intervention humaine (cible > 90 %).
- **Contacts par annonce à 30 jours** (cible ≥ 6) ; **NDA signés par annonce à 30 jours** (cible ≥ 3) ; **offres à 90 jours** (cible ≥ 1 sur 3 annonces).
- **Taux de réponse du cédant sous 48 h** (cible > 80 %).
- **Annonces vendues via la plateforme à 12 mois** (cible 15 %) ; **closings déclarés / closings détectés** par la veille BODACC (cible 100 % déclarés) ; **délai facture → paiement** (cible < 30 jours).
- **Score de complétude moyen** des annonces (cible ≥ 80) et part des prix dans la fourchette (cible > 70 %).
- **Coût par annonce publiée** (cible < 120 €) ; **taux de réponse e-mailing** (cible 4 %) ; pages indexées et positions sur 20 requêtes RGE.
- **Heures fondateur / semaine** (cible ≤ 5) et nombre d'actions humaines bloquantes par semaine (cible < 3).

---

## 13. Risques

1. **Juridique (mandat, diagnostic payant, apport d'affaires)** : chaque clause doit être relue une fois ; le diagnostic payant hors catalogue est en certitude « Moyen » — il reste gratuit tant que le conseil n'a pas tranché. Mitigation : budget avocat prévu, rien de payant avant l'avis.
2. **La niche ne répond pas** (flux < 3 annonces/mois à M+6) : déclencheur d'élargissement au bâtiment qualifié, décidé dès maintenant.
3. **Contournement résiduel** malgré la veille : 1 litige sur 5 détectés exigera un courrier d'avocat ; prévoir un modèle de mise en demeure et un budget de 1-2 k€/an.
4. **Prestataire de signature avancée** : coût et intégration ; mitigation : commencer par un plan à l'acte (~1-2 €), garder l'OTP pour le NDA.
5. **Fraude (coquilles RGE avant 2027)** : KYC des deux parties, questionnaire « origine des fonds », refus explicite affiché sur l'accueil ; c'est aussi un argument auprès des cédants honnêtes.
6. **Dépendance aux API publiques** (ADEME, INPI, BODACC) : cache 24 h, acceptation différée, jamais bloquant à l'inscription.
7. **Marché 2026-2027** : contraction des mono-produits isolation/PV ; mitigation : priorité PAC/CVC multi-qualifiées, parcours identique à bas prix pour les autres, discours « activité saine » et non « label ».
8. **Fondateur seul** : une semaine d'indisponibilité ne doit rien bloquer ; tout ce qui est humain (post-modération, litiges) a un délai affiché et un repli automatique (publication par défaut, relances).
9. **Solvabilité de la demande** sur les artisans à 80-180 k€ : repreneurs individuels dépendants du crédit ; mitigation : partenaire courtier dès l'offre acceptée, crédit vendeur dans le formulaire d'offre.
10. **SEO plus lent que prévu** (3-9 mois) : l'e-mailing open data est le canal de secours ; les deux démarrent à M+2.

---

## 14. Les 90 premiers jours

**Semaine 1 — sécuriser et désamorcer**
Révocation des secrets, `stripe.error`, sauvegarde Mongo + S3 obligatoire, rate limiting, `/docs` fermés, CORS, en-têtes, Sentry/UptimeRobot, health réel, code OTP hors objet, double opt-in, SPF/DKIM/DMARC sur cessionrge.fr, domaine canonique fixé, Search Console vérifiée, `/company/:id` hors sitemap, mentions légales et confidentialité complétées, bandeau « brouillon » retiré, débordement mobile corrigé, compteurs à 0 masqués. Brief envoyé à l'avocat (mandat simple, NDA, offre, CGU, question du diagnostic payant).

**Semaines 2-4 — le contrat et l'argent**
Mandat simple complet (texte, objet, adresse, contre-signature, dates, ordre de paiement, caducité, résiliation en un clic, PDF envoyé, liste de fin de mandat), barème 6 % cédant HT d'abord dans `offer.js`/`business_model.py`, suppression du choix du débiteur, calculateur ; signature avancée eIDAS branchée pour mandat et offre ; gabarits NDA/offre nettoyés, exemplaires envoyés aux deux parties ; messagerie par couple (annonce, acquéreur) ; inscription cédant sans dépendance ADEME ; publication automatique + post-modération + refus motivé + libre-service retrait/pause/vendue. Retour de l'avocat intégré. **Jalon J+30 : plus aucun mandat annulable n'est signé, plus aucune annonce n'attend un humain.**

**Semaines 5-8 — le produit qui convertit**
Encaissement (rédacteur d'acte, « Déclarer la vente », Stripe Invoicing, routes admin) ; veille BODACC/INPI mensuelle + relances cédant J+60/J+120 ; estimateur public `/estimer` avec multiples recalibrés et alerte prix ; création d'annonce en 3 écrans avec brouillon et bloc « ce qui rassure » ; fiche publique et `ListingCard` unique ; profil repreneur + score + carte repreneur côté cédant ; KYC déplacé au NDA, data room après NDA, offre indicative à la place de la LOI ; worker pdf.js embarqué ; accueil cible complet (hero, bande d'autorité, « ce que nous vérifions », timeline, calculateur, fondateur + Cal.com, FAQ 5, pied de page légal), polices auto-hébergées, photos duotone, 2 captures produit, portrait. Trois conventions de partenaires signées, routage automatique. Infra e-mailing en warm-up. **Jalon J+60 : un cédant publie en 10 minutes sans attente ; un repreneur contacte sans passeport ; une vente déclarée produit une facture envoyée.**

**Semaines 9-13 — la confiance visible et l'acquisition**
Diagnostic de transmissibilité RGE (version courte publique sur `/verifier-entreprise-rge`, version complète en data room) ; dashboard cédant « À traiter », e-mails avec liens profonds, digests, séquence complète ; admin « À faire » ; pages métier × département sur l'open data et 6 guides ; pré-rendu des fiches ; première campagne e-mailing (1 500 envois, segment ≥ 58 ans, PAC/CVC en priorité) ; candidature Bpifrance Transmission et Transentreprise ; contenu co-brandé CAPEB/CMA ; baromètre n° 1 ; test manuel du courtage CEE avec 10 installateurs (sans code). **Jalon J+90 : 8-12 annonces publiées, ≥ 30 repreneurs à profil complet, 3 NDA par annonce à 30 jours sur les premières, zéro action humaine bloquante par semaine, indexation sur la marque et sur 5 requêtes RGE. Décision d'élargissement programmée à M+6.**

Ce qui est volontairement hors des 90 jours : la version payante du diagnostic (attend l'avis du conseil), le mandat de recherche (année 2), le découpage de `server.py` et la migration Vite (après la première commission), le courrier postal (après la mesure de l'e-mail), tout abonnement (jamais tant qu'AlterEgo est mandataire).
