# Audit du business model de CessionRGE — capacité à générer du revenu en autonomie

Audit réalisé le 9 octobre 2026 sur le code de la branche `main` (`/home/user/Cession-rge/`), l'API locale
(`http://127.0.0.1:8001/api`, base en mémoire alimentée par `scratchpad/seed.json` et les parcours des deux audits UX)
et les captures des audits « accueil-design », « ux-vendeur » et « ux-acheteur ».

Dossier de l'audit : `docs/revue-2026-10/`
(ci-dessous « audit/ »). Modèle chiffré : `audit/unit_economics.py` (hypothèses explicites) et sa sortie `audit/unit_economics.txt`.

Posture : expert marketplaces B2B et M&A de petites entreprises. Je dis ce qui, à mon avis, ne marchera pas, pas seulement
ce qu'il faut polir. Les points de droit (loi Hoguet, LCB-FT, facturation) sont ma lecture de praticien, **à faire valider
par le conseil d'AlterEgo** avant toute modification de contrat.

---

## 0. Verdict sincère en vingt lignes

1. **Le modèle implémenté est celui d'un cabinet de cession (mandat + commission au succès), mais sans le cabinet.** Un
   cabinet gagne 8-10 % parce qu'il qualifie, valorise, pousse les repreneurs, tient le calendrier et se fait payer chez le
   rédacteur d'acte. Ici, tout cela est laissé aux parties. Le code encadre juridiquement la commission ; il ne fait rien
   pour qu'elle se produise ni pour qu'elle soit encaissée.
2. **Les coûts sont négligeables (≈ 4-7 k€/an tout compris), le problème n'est pas là.** Le problème est le revenu :
   avec des hypothèses centrales, une annonce publiée vaut ≈ 3 200 € HT d'espérance de commission encaissée, et le premier
   euro arrive 9 à 12 mois après la publication. Il faut 25 à 40 annonces publiées par an (≈ 40-60 créées) pour 80-120 k€,
   soit 8 à 13 % du marché ouvert national des cessions d'entreprises RGE. Atteignable en année 2-3, pas en année 1.
3. **Le point faible numéro un est l'encaissement, pas le barème.** Le closing est auto-déclaré par les parties
   (`POST /closing/declare`, `backend/server.py:3854`), la facture naît avec le statut `a_valider` et il n'existe aucun
   endpoint pour la valider, l'envoyer, l'encaisser ou la relancer (`db.invoices` n'est écrit qu'une fois, lignes 3822/3830/3835).
   Aucune veille de contournement (BODACC/INPI) alors que les données sont publiques et gratuites. Dans un métier où tout
   le monde se connaît localement, cela signifie une fuite de 25 à 40 % des deals réellement conclus.
4. **Le mandat tel que rédigé est à la fois trop lourd commercialement et fragile juridiquement** : exclusif 12 mois, tacite
   reconduction 6 mois, résiliation limitée à trois cas (lignes 4844-4920) — contraire à la règle des mandats exclusifs
   (dénonçables après 3 mois avec 15 jours de préavis) — et il promet des prestations (« qualifier les acquéreurs »,
   « accompagner les négociations ») que la FAQ du site nie explicitement (« n'intervient pas dans la négociation »,
   `frontend/src/seo/content.json:188`). Un cédant de mauvaise foi s'en servira pour contester la commission.
5. **Le choix du débiteur par le cédant est juridiquement fondé (le mandat doit dire qui paie) mais commercialement
   contre-productif** tel qu'affiché : « 141 600 € TTC » en jaune sur une fiche à 1,35 M€ (`audit/ux-acheteur/desktop-09-company-payer-repreneur.png`).
   Défaut à mettre sur « cédant », HT d'abord pour des professionnels, option acquéreur conservée avec engagement écrit.
6. **Les revenus complémentaires compatibles avec un titulaire de carte T sans commerciaux existent, mais ce sont des revenus
   d'apporteur d'affaires (payés par des tiers, pas par les parties)**, pas des abonnements ni des annonces premium qui
   butent sur l'article 6 de la loi Hoguet tant qu'AlterEgo est mandataire.
7. **Ce qui est bien fait doit être conservé** : barème marginal centralisé, mandat signé par code avec preuve et registre
   séquentiel, KYC des deux parties (utile pour LCB-FT), anonymat et masquage des coordonnées, NDA « name-blind » avec
   journal des révélations, data room filigranée, relances automatiques, métriques d'entonnoir admin.

**Réponse à la question posée** : non, le modèle actuel ne peut pas atteindre l'autonomie financière tel quel, parce qu'il
ne sécurise pas l'encaissement et ne produit pas assez de closings par annonce. Il peut y parvenir en 24-36 mois avec quatre
changements : mandat simple au lieu d'exclusif, qualification déclarative des repreneurs, mécanique d'encaissement et de
veille automatisée, et une couche de revenus d'apport d'affaires qui apporte de la trésorerie pendant le délai des cessions.

---

## 1. Le modèle tel qu'il est codé (vérifié)

| Élément | Implémentation | Référence |
|---|---|---|
| Publication cédant | Gratuite ; brouillon → KYC Stripe → mandat obligatoire → publication auto si dirigeant confirmé avec le nom certifié, sinon validation admin | `backend/server.py:1463-1517` (`mandate_required`, `submit_listing`) |
| Mandat | Exclusif, 12 mois, tacite reconduction 6 mois, préavis 30 jours ; signature par code e-mail (`FF_OTP_SIGNATURE`) avec preuve (hash, IP, UA, identité KYC) ; registre séquentiel sans trou ; PDF ; relance J+3 (une seule) | `server.py:4806-4940` (texte), `5554-5636` (génération), `5653-5738` (signature), `5740-5771` (registre), `6173-6178` (relance) |
| Barème | 10 % HT ≤ 500 k€, 8 % de 500 k€ à 1,5 M€, 6 % au-delà, **par tranches successives**, pas de minimum (`COMMISSION_MIN_HT=0`) | `backend/business_model.py:84-92, 131-167` ; `frontend/src/lib/offer.js:24-62` ; `GET /config` |
| Débiteur | Choisi par le cédant à la signature, obligatoire, figé ; si acquéreur : estimation TTC/HT sur l'annonce et clause d'information dans le NDA | `server.py:5643-5644, 5667-5669` ; `2481-2512` ; `frontend/src/pages/MandatePage.jsx:19-32` |
| Repreneur | Gratuit ; KYC Stripe Identity **avant le premier message** ; aucun profil (budget, financement, zone) ; crédits et abonnements désactivés (`FF_BUYER_CREDITS=false`) mais code conservé | `server.py:1801-1807, 3038-3042` ; `196-205` (`UserRegister`) ; `business_model.py:50-82` |
| Tunnel | Contact → demande data room → validation « profil » par le cédant (sans information sur l'acquéreur) → NDA (code) → LOI (code, exclusivité 45 j, non-contournement 24 mois) → data room → offre → acceptation → closing déclaré | `server.py:2288-2420, 2805-2900, 3536-3720, 3854-3923` |
| Commission | Calculée à la déclaration de closing ; facture `FAC-AAAA-00001` créée au nom du débiteur, statut `a_valider`, PDF texte ; e-mail admin | `server.py:3784-3852, 3886-3894` |
| Relances | Vendeur muet J+3, questionnaire acquéreur J+30, vendeur sans annonce J+3, brouillon J+3, mandat J+3 ; toutes « une seule fois » (`claim_once`) | `server.py:6097-6200` |
| Valorisation | Endpoint `POST /valorization/estimate` (0,8 × CA et 4 × EBITDA par défaut, 3 lignes IdF) **non utilisé par le front** | `server.py:3983-4010, 6228-6236` |

Discours du site (`frontend/src/lib/offer.js:103-164`, capture `audit/accueil-design/desktop-home-pricing.png`) : « Publication
gratuite · Commission uniquement en cas de vente », barème affiché TTC d'abord (12 % TTC / 10 % HT), « Mandat signé avec AlterEgo
avant la publication : vous y choisissez si la commission est à la charge du vendeur ou de l'acquéreur ».

---

## 2. Unit economics réalistes

Toutes les hypothèses sont dans `audit/unit_economics.py`. Elles sont discutables ; ce qui compte est l'ordre de grandeur.

### 2.1 Prix d'une PME RGE et commission attendue

- Les entreprises RGE sont à 90 % des TPE (CA 300 k€ à 2 M€). Les multiples usuels pour un artisan du bâtiment sont de
  0,3 à 0,6 × CA ou 2,5 à 4 × EBE retraité (le baromètre codé à 0,8 × CA et 4 × EBITDA, `server.py:3990-3992`, est trop
  généreux et pousserait des prix demandés invendables). La dépendance au dirigeant, à un référent technique RGE et aux
  mandataires CEE tire les multiples vers le bas.
- Distribution de prix retenue pour les annonces : 25 % à ≈ 80 k€, 35 % à ≈ 180 k€, 25 % à ≈ 350 k€, 12 % à ≈ 700 k€,
  3 % à ≈ 1,5 M€ → **prix médian ≈ 180 k€, moyen ≈ 300 k€** (le seed de test, de 95 k€ à 2,2 M€, est plus haut que le marché).
- Avec le barème actuel : **commission médiane ≈ 18 000 € HT, moyenne ≈ 29 000 € HT** (la moyenne est tirée par les
  rares PME). À 95 k€ : 9 500 € HT = 11 400 € TTC, soit 12 % TTC du prix — ce qu'un cédant lit sur sa page mandat
  (`audit/ux-vendeur/18-mandate-payer-chosen-desktop.png` : « ≈ 33 600 € TTC (28 000 € HT) » pour 280 k€).

### 2.2 Entonnoir (par annonce publiée, 12-18 mois)

| Étape | Pessimiste | Central | Optimiste | Commentaire |
|---|---|---|---|---|
| Annonce créée → mandat signé | 45 % | 60 % | 75 % | Mandat exclusif 12 mois avant toute preuve de valeur (voir §3) |
| Contacts par annonce | 4 | 8 | 12 | Dépend du catalogue et du SEO ; le KYC avant contact divise la demande |
| Contact → NDA | 30 % | 40 % | 50 % | Le cédant valide un « Acquéreur n°891FC7 » sans rien savoir de lui |
| NDA → LOI | 20 % | 25 % | 30 % | LOI au prix demandé + exclusivité 45 j pour simplement voir la data room |
| Annonce vendue via un repreneur présenté | 5 % | 15 % | 30 % | Benchmark sites d'annonces 10-20 %, cabinets 30-50 % |
| Fuite (hors plateforme, non déclaré, non recouvré) | 40 % | 25 % | 15 % | Rien n'est automatisé pour la détecter ni l'encaisser |
| **Espérance de commission encaissée / annonce publiée** | **≈ 870 € HT** | **≈ 3 250 € HT** | **≈ 7 350 € HT** | |

### 2.3 Combien de deals pour vivre

| Revenu cible HT/an | Closings encaissés | Annonces publiées/an (central) | Annonces créées/an (central) |
|---|---|---|---|
| 40 k€ (couvrir les coûts + un demi-salaire) | 1,4 | 12 | 21 |
| 80 k€ (un salaire de fondateur + coûts) | 2,8 | 25 | 41 |
| 120 k€ | 4,2 | 37 | 62 |

En pessimiste, il faut 92 annonces publiées (205 créées) pour 80 k€. En optimiste, 11.

### 2.4 Marché adressable

≈ 60 000 entreprises RGE ; taux de cession ≈ 1,5 %/an → ≈ 900 cessions/an ; en retirant les transmissions familiales,
aux salariés et les liquidations, **≈ 300 à 350 cessions/an sur le marché ouvert**. 25 annonces publiées/an = 8 % de ce marché ;
50 = 16 % ; 100 = 32 %. Une part de 8-15 % est crédible pour un site de niche bien référencé, à condition que les cédants
arrivent (experts-comptables, groupements RGE, SEO) ; 30 % ne l'est pas pour un fondateur seul.

### 2.5 Délai et trésorerie

Publication → closing : 6 à 12 mois (je retiens 9), encaissement à l'acte (+1 mois). Scénario central, montée en charge
prudente (20 / 40 / 60 annonces publiées par an) :

| | Année 1 | Année 2 | Année 3 |
|---|---|---|---|
| Encaissements HT | ≈ 11 k€ | ≈ 76 k€ | ≈ 141 k€ |
| Closings encaissés | 0,4 | 2,6 | 4,9 |
| Coûts fixes | ≈ 6 k€ | ≈ 6 k€ | ≈ 6 k€ |

Montée en charge volontaire (30 / 60 / 90) : 16 k€, 114 k€, 211 k€. **Dans tous les cas, l'année 1 est à perte et la
trésorerie dépend du fondateur.** D'où l'intérêt d'une couche de revenus à encaissement court (§6).

---

## 3. Le mandat obligatoire avant publication : frein ou atout ?

### 3.1 Ce que la loi impose (lecture à valider)

- AlterEgo détient une carte T « Transactions sur immeubles et fonds de commerce » (`GET /public/legal-info`,
  `server.py:5212-5228`). Pour les cessions de **fonds de commerce**, la loi Hoguet s'applique : mandat écrit préalable,
  limité dans le temps, précisant la rémunération et **qui la paie** (art. 6 de la loi, art. 72-73 du décret de 1972), aucune
  somme perçue avant la conclusion, registre des mandats. Publier une annonce de vente pour autrui sans mandat est en
  pratique considéré comme de l'entremise : **le mandat avant publication n'est pas une option pour le fonds de commerce.**
- Pour les cessions de **titres** (SAS, SARL hors objet immobilier), la loi Hoguet ne s'applique pas ; l'intermédiation est
  libre. Le code applique le même mandat aux deux cas (`sale_type` « parts » / « fonds », cases ☐ non cochées dans le texte,
  `server.py:4845-4846`). C'est simple et prudent, mais cela importe les contraintes Hoguet là où elles n'existent pas.

### 3.2 Pourquoi le mandat actuel freine

Ce n'est pas la signature (deux minutes, bien faite — `audit/ux-vendeur/17-mandate-page-desktop.png`), c'est son contenu :

1. **Exclusivité** (`server.py:4844`, art. 3 lignes 4861-4868) : un artisan qui en a déjà parlé à un confrère, à son
   expert-comptable ou à un salarié ne signera pas un mandat qui lui interdit de « négocier directement » et qui lui doit la
   commission même s'il vend seul. L'exclusivité est l'outil d'un cabinet qui travaille le dossier ; une plateforme
   self-service ne peut pas la justifier.
2. **Durée et résiliation** : 12 mois + tacite reconduction 6 mois + préavis 30 jours LRAR (lignes 4857-4859), résiliation
   seulement par accord mutuel, faute grave ou force majeure (lignes 4913-4918). Pour un mandat exclusif, la règle est : après
   3 mois, dénonçable à tout moment par chaque partie avec 15 jours de préavis. **Le texte actuel est donc attaquable**, et un
   mandat irrégulier fait tomber la commission.
3. **Obligations non tenues** : art. 1 et 4 (lignes 4848-4853, 4870-4878) « qualifier les acquéreurs potentiels avant tout
   échange », « accompagner les négociations jusqu'au closing », alors que la FAQ dit l'inverse (`content.json:188`) et que
   rien dans le code ne qualifie un acquéreur. Exception d'inexécution offerte au cédant.
4. **Pas de contre-signature d'AlterEgo** : seul le hash du cédant est enregistré (`server.py:5690-5702`), le PDF porte
   « Le Mandataire … Signature : ______ ». Un mandat est bilatéral ; le registre exige un exemplaire signé remis au mandant.
   Correction triviale (cachet/horodatage automatique d'AlterEgo), mais à faire.
5. **Objet indéterminé** : cases ☐ non cochées, dénomination/adresse vides si l'ADEME ne répond pas (constaté dans
   `audit/ux-vendeur/mandat-texte.txt`). Le mandat doit désigner précisément le bien.
6. **Lignes dupliquées** 4835-4836 (« Représentée par … Présidente » puis « Représentée par : … »), détail mais visible
   dans un document juridique.
7. **Aucun suivi d'échéance** : `DUREE_MANDAT_MOIS` n'existe que dans le texte (`server.py:5249`) ; aucune date de fin
   stockée, aucun job d'expiration (grep `mandate_expires` : rien). Une annonce peut rester publiée sous un mandat expiré.

### 3.3 Alternatives

| Option | Compatibilité | Effet commercial | Mon avis |
|---|---|---|---|
| **Mandat simple (non exclusif), 12 mois, dénonçable à tout moment avec 15 jours de préavis, clause de suite 24 mois sur les acquéreurs présentés** | Conforme fonds de commerce et titres | Lève le principal frein ; la commission reste due dès qu'un acquéreur vient de la plateforme | **À faire en priorité.** C'est l'usage des sites d'annonces de cabinets (mandat simple ou « mandat de diffusion ») |
| Mandat à la première mise en relation (publier sans mandat, signer avant de transmettre un contact) | Risqué pour le fonds de commerce (l'annonce est déjà de l'entremise) ; possible pour les titres | Fait monter le taux de publication, mais déplace l'abandon au moment du premier contact et laisse des annonces sans mandat dans le catalogue | À réserver aux cessions de titres si le conseil le valide ; complexité de deux régimes |
| Lettre d'engagement de paiement côté acquéreur (sans mandat vendeur) | Ne dispense pas du mandat vendeur pour un fonds ; ne protège pas contre un cédant qui vend ailleurs | — | Utile **en complément** quand le débiteur est l'acquéreur (voir §4), pas en substitution |
| Abandonner la carte T : site d'annonces pur, frais de publication | Hors Hoguet (pas d'entremise, pas de commission) | Autonomie maximale, mais revenu ≈ 200-400 € par annonce → 10-30 k€/an | Non : on perdrait le seul levier de revenu significatif et l'actif « carte T » |

---

## 4. Le choix cédant-ou-acquéreur du débiteur

### 4.1 Usage de marché

- **Cabinets de cession PME (titres)** : le vendeur paie (mandat de vente), 5-10 % dégressif, minimum 10-30 k€, souvent avec
  retainer. L'acquéreur ne paie que s'il a lui-même un mandat de recherche.
- **Fonds de commerce via agences (Hoguet)** : « honoraires à la charge de l'acquéreur » est courant, affiché dans l'annonce,
  et l'acquéreur n'est tenu que s'il a signé un engagement écrit avec l'agent (un bon de visite ne suffit pas).
- CessionRGE est à cheval sur les deux mondes, d'où l'idée du choix. Le mandat **doit** dire qui paie (décret, art. 73) :
  la mécanique est juridiquement juste ; la question est de savoir qui décide et comment c'est présenté.

### 4.2 Ce qui ne va pas aujourd'hui

1. **Le cédant choisit sans comprendre les conséquences.** La page mandat présente deux cartes au même montant
   (`MandatePage.jsx:19-32`) ; rien ne lui dit qu'en faisant payer l'acquéreur il affiche un surcoût de 10-12 % sur sa fiche,
   réduit le nombre de contacts et incite au contournement (l'acquéreur n'a signé aucun mandat : son engagement ne naît qu'au
   NDA/LOI, `server.py:2497-2512, 5150-5155`).
2. **Affichage TTC d'abord à des professionnels** : « 141 600 € TTC (118 000 € HT) » (`desktop-09-company-payer-repreneur.png`),
   « 12 % TTC (10 % HT) » sur l'accueil. Un acquéreur en société récupère la TVA : il lit 12 % là où il paiera 10 %. Seul le
   cédant personne physique qui vend ses titres supporte réellement le TTC.
3. **Deux régimes de facture, de recouvrement et de preuve** à gérer pour un fondateur seul (facture au nom de l'acquéreur
   = débiteur sans mandat, à recouvrer sur la base d'une clause de LOI).
4. **Côté fiscal, l'option acquéreur n'est pas absurde** : pour une holding, la commission est un frais d'acquisition
   (déductible ou amortissable) avec TVA récupérable ; pour un cédant personne physique, elle ne fait que réduire la
   plus-value. C'est l'argument à donner, pas un choix nu.

### 4.3 Recommandation

- **Défaut = cédant**, présenté comme la norme ; l'option « acquéreur » reste disponible, avec un encart qui explique
  honnêtement l'effet (moins de contacts, affichage du montant, engagement écrit exigé de l'acquéreur au NDA).
- **HT d'abord partout pour les pros**, TTC entre parenthèses (changer `rateLabel`/`commissionRows` dans `offer.js:47-82`
  et `commission_scale_text` dans `business_model.py:169-183`).
- Quand le débiteur est l'acquéreur : transformer la clause d'**information** du NDA (`buyer_commission_clause`,
  `server.py:2497-2512`) en **engagement** explicite (case à cocher dédiée + phrase « je m'engage à régler… »), signé par code
  comme le reste. C'est la « lettre d'engagement de paiement » demandée, au bon endroit.
- Remplacer l'exemple « cession à 30 000 € → 3 600 € TTC » (`offer.js:36, 97`) par un exemple à 180 k€ : l'exemple actuel
  positionne la plateforme sur des micro-deals.

---

## 5. Contournement : ce que le modèle prévoit et ce qu'il ne sait pas faire

### 5.1 Ce qui existe

- Clause de suite 24 mois dans le mandat (`server.py:4895-4897`), non-contournement 24 mois et commission « intégrée au
  décompte de closing » dans la LOI (`5150-5155`), non-sollicitation 24 mois dans le NDA, preuves de signature (hash du texte,
  OTP, IP, identité KYC — `2767-2800`), journal des révélations d'identité au NDA (`2869-2880`), masquage des coordonnées dans
  les messages avant NDA (`1655-1664`, `3115-3125`), filigrane et journal de la data room. Juridiquement, c'est au-dessus de
  ce que font la plupart des sites d'annonces. **La preuve de présentation est solide.**

### 5.2 Ce qui manque pour que ce soit opérationnel sans équipe

1. **Détection.** Rien ne surveille ce qui arrive aux entreprises sous mandat. Or les cessions de fonds de commerce sont
   publiées au **BODACC** (open data, API gratuite) et les changements de dirigeant/associés sont dans le **RNE/INPI**
   (déjà intégré pour la vérification dirigeant, `INPI_USERNAME`). Un job mensuel « pour chaque SIREN sous mandat ou sous
   clause de suite, chercher une vente de fonds ou un changement de dirigeant » détecterait l'essentiel des contournements à
   coût nul. C'est **le** mécanisme qui remplace l'équipe.
2. **Encaissement.** Le closing est déclaré par le vendeur ou l'acheteur (`3854-3862`), statut `pending_confirmation` sans
   aucune route de confirmation (`3883` ; `db.closings` n'est jamais relu). La facture (`3784-3824`) est créée au statut
   `a_valider` et plus rien : pas de validation, pas d'envoi, pas de lien de paiement, pas d'échéance, pas de relance, pas de
   mise en demeure. L'e-mail admin (`3906-3919`) est la seule sortie. **La LOI promet une commission « intégrée au décompte de
   closing » mais personne ne transmet de note d'honoraires au rédacteur d'acte**, et la plateforme ne demande même pas qui
   rédige l'acte.
3. **Conformité de la facture.** PDF texte (`3832-3852`) sans date d'échéance, conditions de paiement, pénalités de retard,
   indemnité forfaitaire de 40 €, n° de TVA intracommunautaire. Et la facturation électronique obligatoire (réception depuis
   septembre 2026, émission pour les TPE/PME en septembre 2027) impose de passer par une plateforme agréée : **la
   facturation maison est une impasse à 12 mois.**
4. **Clause de suite sans date.** Sans date de fin de mandat stockée (§3.2.7), impossible de calculer la fenêtre de 24 mois.
5. **Rien côté cédant après la publication.** Aucune relance « votre entreprise est-elle toujours à vendre ? », aucune
   question « avez-vous vendu ? », aucune archivation automatique : les annonces mortes restent, et une vente hors plateforme
   n'est jamais sue.

### 5.3 Est-ce opérationnel sans équipe ?

Non en l'état. Avec (i) la veille BODACC/INPI, (ii) un champ « rédacteur d'acte » obligatoire à l'acceptation d'une offre et
une note d'honoraires + instruction de règlement envoyée automatiquement à ce rédacteur et aux deux parties, (iii) un cycle
de facture externalisé (Stripe Invoicing ou Pennylane/Qonto par API : envoi, lien de paiement, relances J+15/30/45, export
comptable, conformité e-invoicing), (iv) des relances cédant J+60/J+120 avec archivage, le modèle devient défendable sans
personne. Il restera un résidu de litiges (1 sur 5 contournements ?) que seul un courrier d'avocat réglera : prévoir un
modèle de mise en demeure et un budget.

---

## 6. Revenus complémentaires crédibles sans commerciaux

Grille : compatibilité Hoguet (art. 6 : aucune somme des parties avant conclusion, tant qu'AlterEgo est mandataire),
potentiel chiffré, autonomie réelle.

| Piste | Compatibilité | Potentiel (ordre de grandeur) | Autonomie | Avis |
|---|---|---|---|---|
| **Abonnement acquéreur** (accès aux annonces, alertes) | Douteuse : somme perçue d'une partie par le mandataire avant conclusion. Faisable uniquement via une entité « média » distincte, à valider | Avec < 100 annonces, quasi nul (un repreneur ne paie pas pour 7 fiches) ; à 300 annonces : 50-100 abonnés × 30-80 €/mois = 20-80 k€/an | Oui | **Pas avant 150-300 annonces actives, et pas sans montage juridique.** Fusacq le fait avec des milliers d'annonces |
| **Annonce premium / mise en avant** payée par le cédant | Même problème : somme du mandant avant conclusion (fonds de commerce). Possible pour les titres seuls | 100-300 € × 20-40 annonces = 2-12 k€/an | Oui | Faible et risqué ; non prioritaire |
| **Dossier de présentation / valorisation automatisée payante** | Prestation d'expertise distincte du mandat : défendable si clairement séparée et facturée même sans mandat ; à valider | 150-400 € × 30-60 = 5-25 k€/an | Oui (génération automatique) | Intéressant **surtout comme aimant à annonces** (gratuit en version courte, payant en version complète). L'endpoint existe déjà (`server.py:3983`), non branché, multiples à recalibrer |
| **Apport d'affaires — expert-comptable (audit d'acquisition)** | Payé par le tiers, pas par les parties : compatible (convention d'apporteur) | Mission 2-5 k€, apport 10-15 % → 300-600 € par repreneur au NDA/LOI ; 30-60 leads/an → 10-30 k€ | Oui après une convention signée une fois | **Oui.** Proposition en un clic au moment du NDA |
| **Apport d'affaires — avocat (actes)** | Les avocats ne peuvent pas rémunérer l'apport d'affaires (déontologie) ; partenariat de visibilité ou forfait de référencement payé par le cabinet (« sponsoring ») seulement | 0 en apport direct ; 1-3 k€/an de sponsoring | Oui | Partenariat de contenu, pas de revenu réel |
| **Apport d'affaires — crédit professionnel (banque/courtier)** | Statut d'**indicateur** (convention, pas de conseil, exemption ORIAS) ou courtier IOBSP partenaire qui rémunère l'indication | 200-600 € par dossier financé ; 5-15/an → 1-9 k€ | Oui | Oui, petit mais à encaissement rapide (à l'offre acceptée) |
| **Apport d'affaires — assurance décennale / RC du repreneur** | Statut d'indicateur d'assurance (convention avec un courtier) | Prime 3-10 k€, commission d'indication 5-10 % → 300-800 € ; 5-15/an → 2-12 k€ | Oui | Oui, naturel au closing (le repreneur doit réassurer) |
| **Courtage CEE** (piste v2) | Rémunéré par l'obligé/délégataire, hors Hoguet ; **rôle actif et incitatif requis** (pas de simple apport passif) | Dépend des volumes ; peut dépasser la commission de cession pour une TPE active ; encaissement en 2-4 mois | Partiellement (back-office + relations obligés) | **La seule piste à trésorerie courte**, à tester à la main avec 5-10 cédants/installateurs avant de coder (comme le recommande le rapport v2) |
| **Données / baromètre payant** | Compatible | < 5 k€/an | Oui | Contenu SEO gratuit plutôt que produit |
| **Formation** | Compatible | 0 sans animation | Non | Non |

Conclusion : **≈ 20-50 k€/an de revenus tiers en année 2** sont crédibles avec cinq conventions signées une fois
(expert-comptable, courtier crédit, courtier assurance, délégataire CEE, cabinet d'avocats en sponsoring) et un routage
automatique aux moments clés du tunnel (NDA, LOI, offre acceptée, closing). Cela ne remplace pas la commission, mais couvre
les coûts et une partie du salaire pendant le délai des cessions.

---

## 7. Trop lourd pour le volume probable / ce qui manque

### 7.1 Trop lourd ou mort

- **Crédits et abonnements repreneur** (`business_model.py:50-82`, `server.py:3230-3530`, 3930-3980, `/admin/stripe/*`,
  `CreditsPage.jsx`) : désactivés par flag mais maintenus, avec remboursements, webhooks, tables `credit_contacts`.
  Le tableau de bord admin calcule même le « revenu » sur `db.transactions` (achats de crédits, `server.py:4015-4025`) et
  non sur les factures : il affichera 0 pour toujours. **À supprimer** (dette et confusion).
- **LOI comme condition d'accès à la data room** (`server.py:2401-2410`, `2861-2865`) : trop lourd pour des TPE. Un repreneur
  signe une LOI après avoir vu les bilans, pas avant. Accès data room après NDA (+ KYC), LOI = offre indicative.
- **Validation « profil » par le cédant** sans aucune information : étape vide qui bloque. Soit on la supprime (NDA direct
  après contact), soit on lui donne un contenu (profil repreneur, §7.2).
- **Facturation maison** : voir §5.2.3 — à externaliser plutôt qu'à enrichir.
- **Registre des mandats** : léger (un compteur, un CSV), obligatoire ; **à garder**.

### 7.2 Ce qui manque (par ordre d'impact sur le revenu)

1. **Encaissement et veille** (§5.2) : rédacteur d'acte, note d'honoraires automatique, BODACC/INPI, cycle de facture.
2. **Qualification déclarative du repreneur** : budget, apport, financement prévu, expérience bâtiment/RGE, zones, horizon,
   personne physique/holding. Trois minutes, gratuit, affiché au cédant sous pseudonyme. Sans cela, le cédant valide à
   l'aveugle et les contacts ne se transforment pas.
3. **Valorisation automatisée côté cédant** (branchement du module existant, multiples recalibrés 0,3-0,6 × CA et
   2,5-4 × EBE, cohérence prix demandé / fourchette signalée sur l'annonce) : réduit les prix irréalistes, principal
   tueur de closings.
4. **Relances cédant** : J+60 « toujours à vendre ? », J+120, archivage ; relance mandat répétée (J+3, J+10, J+30) au lieu
   d'une seule (`claim_once("mandate_reminder")`, `server.py:6176`).
5. **Dates de mandat** stockées (signature, fin, fin de clause de suite) et job d'expiration/renouvellement.
6. **Contre-signature automatique d'AlterEgo** et objet du mandat déterminé (`sale_type` → case cochée).
7. **Routage des leads partenaires** (§6) aux étapes du tunnel.
8. **Métriques** : l'entonnoir admin (`server.py:4183-4191`) s'arrête à « Offre » ; ajouter closings, factures, encaissements,
   délai moyen, et le taux annonce → mandat (le vrai goulot).

---

## 8. Coûts de fonctionnement

| Poste | Estimation | Commentaire |
|---|---|---|
| Hébergement (VPS 2 vCPU/4 Go + MongoDB) | 15-60 €/mois | Mongo auto-hébergé ou Atlas M10 ; S3 Scaleway 1-5 €/mois |
| E-mails Brevo | 0-20 €/mois | Gratuit jusqu'à 300/jour ; le volume restera faible |
| Stripe Identity | ≈ 1,5 € par vérification | Payé pour **chaque curieux** puisque le KYC précède le premier message (`server.py:1801-1807`) : à 8 contacts/annonce × 40 annonces ≈ 500 €/an ; déplacer le KYC au NDA le divise par 3 |
| INPI, ADEME, BODACC | 0 € | APIs publiques |
| RC professionnelle carte T | 600-1 500 €/an | Obligatoire ; garantie financière non requise si aucun fonds n'est détenu (attestation) |
| Facturation (Stripe Invoicing ou Pennylane) | 0,4 % par facture ou 15-30 €/mois | Remplace la facturation maison, assure l'e-invoicing 2027 |
| Expert-comptable AlterEgo, CCI (carte T), domaine | 1 000-2 500 €/an | |
| Avocat (révision mandat/NDA/LOI/CGU, une fois) | 2 000-4 000 € | Indispensable avant toute campagne |
| **Total récurrent** | **≈ 4 000-7 000 €/an** | Un seul closing médian (18 k€ HT) couvre trois ans de coûts |

Le modèle est bon marché. Son risque n'est pas le coût, c'est le temps : 9-12 mois sans revenu, puis un revenu qui dépend
d'un taux de closing que rien dans le produit ne fait monter.

---

## 9. Recommandation finale

### 9.1 Le modèle actuel peut-il atteindre l'autonomie financière ?

**Pas tel quel.** Trois raisons structurelles :

1. Il demande au cédant le plus fort engagement du marché (mandat exclusif 12 mois) sans lui donner le service d'un cabinet.
2. Il ne fait rien pour transformer un contact en vente (repreneur non qualifié, prix non contrôlé, LOI avant data room).
3. Il ne sait ni détecter ni encaisser ce qu'il a gagné.

Un business qui « tourne seul » n'est pas un business sans humain : c'est un business où l'humain ne fait que ce que la
machine ne peut pas faire. Ici, cela se résume à : un appel de 15 minutes par mandat signé (vérifier le prix, le motif, le
calendrier), un appel par LOI, et le traitement des litiges. Deux heures par semaine à 40 annonces par an. Tout le reste
doit être automatisé, et aujourd'hui l'essentiel de « tout le reste » n'existe pas.

### 9.2 Ce qu'il faut changer, par priorité

**P0 — avant toute acquisition payante (3-4 semaines de travail + avocat)**
1. Mandat **simple** (non exclusif), 12 mois, dénonçable à tout moment avec 15 jours de préavis, clause de suite 24 mois sur
   les acquéreurs présentés, objet déterminé, obligations du mandataire alignées sur le produit réel, contre-signature
   automatique d'AlterEgo, dates stockées. Débiteur **par défaut cédant**, HT d'abord, option acquéreur avec engagement
   explicite au NDA.
2. **Encaissement** : champ « rédacteur d'acte » et date prévisionnelle à l'acceptation d'offre ; note d'honoraires et
   instruction de règlement envoyées automatiquement ; facture via Stripe Invoicing/Pennylane avec lien de paiement et
   relances ; endpoint admin « closing confirmé / payé » ; suppression de la facture maison.
3. **Veille contournement** : job mensuel BODACC + RNE/INPI sur chaque SIREN sous mandat ou clause de suite ; e-mail
   automatique au cédant et à l'admin en cas de vente ou de changement de dirigeant ; modèle de mise en demeure.
4. **Profil repreneur déclaratif** affiché au cédant ; KYC déplacé au NDA ; data room après NDA ; LOI = offre indicative.

**P1 — pendant la montée en charge (4-6 semaines)**
5. Valorisation automatique branchée (multiples recalibrés), gratuite en version courte, comme aimant à cédants ; alerte
   sur l'annonce quand le prix demandé dépasse la fourchette.
6. Cinq conventions de partenaires (expert-comptable, courtier crédit, courtier assurance décennale, délégataire CEE,
   avocat en sponsoring) et routage automatique des leads aux étapes NDA / LOI / offre / closing. Tester le courtage CEE à la
   main avec 10 cédants avant de coder quoi que ce soit.
7. Relances cédant (J+60/J+120, archivage), relances mandat répétées, métriques d'entonnoir jusqu'à l'encaissement.

**P2 — nettoyage**
8. Supprimer crédits/abonnements/remboursements, recalculer le revenu admin sur les factures, corriger le texte dupliqué
   du mandat, remplacer l'exemple « 30 000 € ».
9. Abonnement repreneur et annonces premium : **non**, pas avant 150-300 annonces actives et un montage juridique validé.

### 9.3 Ce qu'il ne faut pas casser

Le barème marginal et sa source unique (`offer.js` ↔ `business_model.py` ↔ `GET /config`), la signature par code avec
preuve et registre séquentiel, le KYC des deux parties (il sert aussi la LCB-FT à laquelle un titulaire de carte T est
assujetti), l'anonymat et le masquage des coordonnées avant NDA, le journal des révélations, la data room filigranée, les
relances automatiques existantes, les métriques admin et le SEO (l'actif d'acquisition de cédants le moins cher).

---

## Annexes

### A. Fichiers et lignes cités
- `backend/business_model.py` : flags 35-47 ; crédits/abonnements morts 50-82 ; barème 84-92 ; calcul 131-167 ; texte TTC d'abord 169-183.
- `backend/server.py` : `UserRegister` sans profil repreneur 196-205 ; `mandate_required`/`submit_listing` 1463-1517 ;
  KYC avant contact 1801-1807 et 3038-3042 ; `commission_info_for`/clause NDA 2481-2512 ; data room 2288-2420 ;
  signature/preuve 2767-2900 ; offres 3536-3720 ; facture 3784-3852 ; closing 3854-3923 ; valorisation 3983-4010 ;
  admin revenu 4015-4025 ; entonnoir 4183-4191 ; mandat 4806-4940 (exclusif 4844 ; durée 4857-4859 ; exclusivité 4861-4868 ;
  obligations 4870-4878 ; tail 4895-4897 ; résiliation 4913-4920 ; doublon 4835-4836) ; NDA 4942-5100 ; LOI 5100-5208
  (clause 9 : 5150-5155) ; `LEGAL_ENTITY`/réglages 5212-5265 ; génération/signature/registre du mandat 5554-5771 ;
  jobs 6097-6200.
- `frontend/src/lib/offer.js` : barème 24-38 ; libellés 47-82 ; textes 103-164.
- `frontend/src/pages/MandatePage.jsx` : `PAYER_OPTIONS` 19-32 ; « Choix obligatoire » 268.
- `frontend/src/pages/CompanyDetail.jsx` : `CommissionNotice` 45-67.
- `frontend/src/seo/content.json:188` : « n'intervient pas dans la négociation ».
- `docs/business-model-v2-rapport-ecarts.md` : pistes v2 et points à clarifier.

### B. Captures utilisées
- `audit/accueil-design/desktop-home-pricing.png` — section tarifs (TTC d'abord, mandat avant publication).
- `audit/ux-acheteur/desktop-09-company-payer-repreneur.png` — fiche avec « 141 600 € TTC » à la charge de l'acquéreur.
- `audit/ux-acheteur/desktop-12-company-payer-cedant.png` — fiche avec commission à la charge du cédant.
- `audit/ux-vendeur/17-mandate-page-desktop.png`, `18-mandate-payer-chosen-desktop.png` — page mandat, choix du débiteur.
- `audit/ux-vendeur/mandat-texte.txt`, `mandat-signe.pdf` — texte du mandat généré (cases non cochées, champs vides).
- `audit/ux-acheteur/nda-text.txt`, `loi-text.txt` — NDA et LOI tels que signés.

### C. Hypothèses du modèle chiffré
Voir `audit/unit_economics.py` / `audit/unit_economics.txt` : distribution de prix, taux d'entonnoir par scénario, taux de
fuite, délai de 9 mois + 1, marché de 60 000 entreprises RGE à 1,5 % de cessions/an dont 35 % sur le marché ouvert.
