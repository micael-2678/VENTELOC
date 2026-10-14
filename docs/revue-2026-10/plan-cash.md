# CessionRGE — Plan « trésorerie d'abord »

**Pour** Micael (AlterEgo SAS, carte T) · **Date** 9 octobre 2026 · **Angle imposé** : viabilité financière d'abord, revenus le plus tôt possible, coûts minimaux, chaque fonctionnalité doit payer, service autonome (fondateur seul ≈ 5 h/semaine, aucun commercial).

Ce plan tranche. Il s'appuie sur les sept audits et études du dossier (`audit/*.md`) ; quand un audit propose plusieurs options, je choisis et je dis pourquoi. Les points de droit restent à faire relire une fois par le conseil d'AlterEgo (budget prévu), mais le plan ne repose sur aucune interprétation audacieuse de la loi Hoguet : il reste dans ce que les audits jugent « Élevé » en certitude.

---

## 0. Diagnostic sincère

1. **Le produit est techniquement sérieux et ne gagne pas d'argent.** Zéro erreur JS, zéro 5xx, anonymat réellement tenu côté serveur, signature par code avec dossier de preuve, data room filigranée, registre de mandats sans trou, 47 tests en CI. Ce n'est pas une démo. Mais le seul événement qui génère un euro (le closing) n'a ni écran, ni facture envoyée, ni relance, ni veille : le revenu dépend de la bonne volonté des parties à déclarer une vente et à payer une facture qu'elles ne reçoivent pas.
2. **Le modèle codé est celui d'un cabinet sans le cabinet.** Mandat exclusif 12 mois, 10 % HT, signé avant d'avoir vu un seul repreneur, pour un service de plateforme. Les cabinets carte T (Transaxio, Michel Simond) prennent 10 % HT avec un minimum de 6 500–10 000 € parce qu'ils valorisent, visitent, négocient et encaissent chez le rédacteur d'acte. Ici, rien de cela. Résultat prévisible : 45–60 % des annonces créées ne signent pas le mandat, et une part des deals conclus se fait dans le dos de la plateforme.
3. **Le mandat exclusif actuel est annulable** (pas de mention « 3 mois / 15 jours » de l'art. 78 du décret de 1972, objet non coché, dénomination et adresse du mandant parfois vides, pas de contre-signature, obligations promises que la FAQ nie). Un cédant qui ne veut pas payer gagnera. Le registre contient déjà de tels mandats.
4. **La loi Hoguet ferme toutes les portes de revenu « amont » sur une affaire sous mandat** : annonce payante, boost, dossier, estimation vendue au futur mandant, abonnement ou crédits repreneur. Art. 6 I, 2 ans / 30 000 €, nullité du mandat. Les audits concurrence et playbooks proposent un abonnement repreneur ou une structure à deux entités : je les écarte (voir §2). Les seuls revenus avant closing qui tiennent sont payés par des tiers ou portent sur un produit vendu à tout le monde, sans lien avec un mandat.
5. **La niche est réelle mais petite** : ~60 000 entreprises RGE, 300–500 cessions par an réellement adressables par une place de marché, prix médian ≈ 180 k€. C'est un business rentable pour une personne, pas une plateforme à croissance exponentielle. Il faut le dimensionner ainsi et fixer dès maintenant le déclencheur d'élargissement.
6. **2026–2027 pousse des vendeurs et retire des acheteurs** : fin des monogestes MaPrimeRénov' (1er sept. 2026), tarif PV à 1,1 c€/kWh, 13 trimestres de baisse CAPEB, 1 artisan sur 5 qui envisage d'arrêter ; mais PAC en hausse, CEE P6 à plus de 8 Md€, et obligation RGE-facturant au 1er janvier 2027 qui crée une demande de personnes morales RGE propres… et un risque de rachat de coquilles par des fraudeurs. Le KYC des deux parties est un argument de vente, pas une friction à supprimer.
7. **cessionrge.fr n'est pas trouvable, même sur sa marque**, le domaine canonique pointe sur un sous-domaine d'une autre marque, les fiches d'annonces ne sont pas pré-rendues, 19 pages activité/région affichent « 0 ». Le seul canal d'acquisition gratuit est aujourd'hui inexistant.
8. **L'accueil vend un prix (« gratuit » ×12, « commission » ×17, TTC d'abord) et pas un service** ; il n'affiche ni la carte T, ni AlterEgo, ni un visage, ni un chiffre ; il donne la place dominante au côté qui n'est pas rare (le repreneur). Sur mobile, la carte tarifs déborde et est tronquée.
9. **Le tunnel repreneur divise la demande à chaque étape** : KYC payé par la plateforme avant le premier message, validation par un cédant qui ne sait rien de l'acquéreur, LOI au prix demandé avec exclusivité 45 jours pour simplement voir les bilans, gabarits NDA/LOI avec des blancs et des `{{DOC_ID}}`, messagerie qui mélange les acquéreurs et répond au mauvais.
10. **Le « sans humain » n'est pas atteint** : validation manuelle des annonces dès que le nom INPI ne correspond pas, KYC manuel, factures `a_valider`, retrait d'annonce impossible, demande d'avocat qui promet une intervention de Micael.
11. **Trois trous de sécurité à boucher aujourd'hui** : clé Stripe live, clé Brevo et mot de passe Mongo dans l'historique Git ; `stripe.error` inexistant dans stripe 13 (toute erreur KYC = 500) ; aucune sauvegarde Mongo. Les mandats et preuves de signature, pièces qu'un titulaire de carte T doit conserver, ne sont sauvegardés nulle part.
12. **Les coûts ne sont pas le problème** : 4–7 k€/an aujourd'hui. Le problème est le délai (9–12 mois entre publication et premier euro) et le taux de closing (que rien dans le produit ne fait monter).

**Ce qui marche et qu'il faut garder** : barème marginal en source unique (`offer.js` ↔ `business_model.py` ↔ `/config`), brouillon avant KYC, page mandat, signature par code avec preuves, registre séquentiel, anonymat et masquage, NDA name-blind avec journal des révélations, data room filigranée, relances `claim_once`, SEO pré-rendu, guides de métier, onglet Accès, honnêteté du discours.

**Ce qui ne marchera pas, même poli** : l'abonnement repreneur et l'annonce premium tant qu'AlterEgo est mandataire ; le mandat exclusif ; 10 % sans service humain ; le courtage CEE comme moteur de croissance ; la mise en relation sous-traitants/fournisseurs ; une structure à deux entités pilotée par un fondateur seul sans juriste ; l'élargissement aux consolidateurs comme payeurs de 10 %.

---

## 1. Positionnement retenu

> **CessionRGE est la place de marché de cession dédiée aux entreprises RGE, opérée par un professionnel titulaire de la carte T. Annonce anonyme gratuite, repreneurs à identité vérifiée, mandat simple résiliable à tout moment, commission de 7 % HT due uniquement à la signature de l'acte. Et le seul diagnostic automatisé de transmissibilité RGE du marché.**

Pour le cédant (le côté rare) : « Vendez votre entreprise RGE sans que personne ne le sache, sans exclusivité, sans rien payer avant l'acte. »
Pour le repreneur : « Reprenez une activité RGE vérifiée et saine » — pas « achetez un label » (le RGE devient plus accessible en 2027 par VAE et ne se transfère pas en cession de fonds).
Pour le consolidateur (Butagaz Eco-énergie, Isovalie, Émeraude, Satep, Renovio) : un mandat de recherche, pas une annonce.

**Décision structurante : rester 100 % intermédiaire mandaté (modèle A), pas de bascule « média », pas de deux entités.** Raisons :
- Le modèle média (Fusacq) rapporte 200–400 € par annonce ; avec 30–60 annonces/an, c'est 10–30 k€/an et la perte de la carte T, du NDA/LOI/data room gérés et de la commission : moins de cash, pas plus.
- Deux entités = deux contrats, deux CGV, un risque de requalification (l'éditeur qui vend des contacts sur des biens sous mandat de l'entité sœur) et une charge de gestion incompatible avec 5 h/semaine. Le gain (abonnement à 29 €/mois pour 7 annonces) est nul tant qu'il n'y a pas 150–300 annonces actives.
- La commission est la seule ligne capable de dépasser 10 k€ par événement. Tout le plan consiste à la rendre plus probable (mandat simple, repreneur qualifié, prix réaliste), plus sûre (encaissement au séquestre, veille BODACC) et à la compléter par des revenus tiers à encaissement court.

**Déclencheur d'élargissement (décidé maintenant, pas dans 18 mois)** : si à M+6 le flux est inférieur à 3 annonces publiées par mois malgré le plan d'acquisition §6, ouvrir aux entreprises du bâtiment qualifiées (Qualibat/Qualifelec, non RGE) avec le RGE comme filtre. Le code, le mandat et le barème ne changent pas ; seuls les contenus et le pipeline de sourcing s'élargissent.

---

## 2. Monétisation : qui paie, combien, quand, sur quelle base

### 2.1 La règle qui tranche

Sur toute affaire sous mandat, **aucune somme des parties avant la conclusion constatée par l'acte** (art. 6 I loi Hoguet). Tout ce qui est facturé au cédant ou au repreneur à l'occasion de cette affaire avant le closing est interdit, quel que soit le nom. Donc : pas d'annonce payante, pas de boost, pas de dossier, pas d'estimation vendue au futur mandant, pas d'abonnement ni de crédits repreneur. Les revenus complémentaires sont payés **par des tiers** ou portent sur **un produit vendu à tous, au même prix, sans lien avec un mandat**.

### 2.2 Les lignes retenues

| # | Ligne de revenu | Qui paie | Prix | Quand | Base légale | Part attendue année 1 (médian) |
|---|---|---|---|---|---|---|
| 1 | **Commission de cession** (mandat simple) | **Le cédant**, toujours (choix du débiteur supprimé) | **7 % HT jusqu'à 500 k€, 5 % de 500 k€ à 1,5 M€, 3 % au-delà**, tranches marginales, **plancher 3 500 € HT** ; TVA 20 % | À la signature de l'acte, par le rédacteur d'acte sur le prix (ordre irrévocable de paiement dans le mandat), facture Stripe Invoicing émise automatiquement à la déclaration de closing | Loi Hoguet art. 6 : mandat écrit numéroté, rémunération et débiteur déterminés, due à la conclusion ; clause de suite 24 mois sur les acquéreurs nommément présentés (Cass. 11 sept. 2025) | ≈ 40 % (0–1 closing, ≈ 5 k€) ; ≈ 70 % en année 2 |
| 2 | **Mandat de recherche « flux acquéreur »** pour consolidateurs et repreneurs structurés | **L'acquéreur** mandant | **4 % HT du prix, plancher 10 000 € HT**, au closing ; sourcing automatisé sur ses critères (pipeline open data §6) + accès 72 h en avance aux nouvelles annonces | Au closing uniquement | Mandat de recherche inscrit au **même registre unique** que les mandats de vente (Cass. 10 déc. 2014) ; commission acquéreur déterminée dans le mandat et reprise dans l'acte | 0 en année 1 (2–3 mandats signés, closings en année 2) ; 15–25 % en année 2 |
| 3 | **Diagnostic de transmissibilité RGE** (PDF automatisé : qualifications ADEME, organismes, échéances, référent technique, SIREN/forme sociale, BODACC, exposition MPR/CEE déclarée, clause suspensive type, fourchette de valeur) | Toute personne qui saisit un SIRET : dirigeant RGE (y compris ceux qui ne vendent pas), repreneur sur n'importe quelle cible, expert-comptable, banque | **149 € HT** par entreprise, même prix pour tous, aucune remise, aucune condition de mandat ; **gratuit et inclus dans la data room** pour les annonces sous mandat CessionRGE (donc jamais payé « à l'occasion » d'une affaire sous mandat) | Paiement Stripe à la commande, PDF immédiat | Produit logiciel hors art. 1er Hoguet (ni entremise ni opération) ; précautions de l'audit juridique : CGV séparées, prix identique, traces d'un produit qui vit seul ; à faire confirmer par le conseil | ≈ 25 % (3–6 k€) |
| 4 | **Apport d'affaires rémunéré par des partenaires** : expert-comptable (audit d'acquisition), courtier en crédit professionnel (statut d'indicateur), courtier assurance décennale/RC | **Le partenaire**, jamais les parties | Expert-comptable 300–600 € par mission signée ; courtier crédit 200–600 € par dossier financé ; assurance 300–800 € par contrat ; convention d'apporteur signée une fois par partenaire | Au moment où le partenaire signe avec le client (NDA → expert-comptable ; LOI → crédit ; closing → assurance) | Somme non « due » par les parties ni représentative d'entremise sur la cession ; information claire du client (code de déontologie) ; pour le crédit, rester indicateur (pas de conseil, pas de remise de documents de prêt) | ≈ 25 % (3–5 k€) ; 10–15 % en année 2 |
| 5 | **Sponsoring d'un cabinet d'avocats et annuaire partenaires** | Les professionnels référencés | 50 € HT/mois par fiche, étiquetée « partenaire », via Stripe Payment Link | Mensuel | Vente d'espace publicitaire identifié, hors opération (les avocats ne peuvent pas rémunérer l'apport d'affaires) | < 5 % |
| 6 | **Courtage CEE** (piste v2) | Obligés / délégataires | Non chiffré | — | Code de l'énergie, hors Hoguet, rôle actif et incitatif requis | **0 € dans le plan** : test manuel avec 10 installateurs entre M+2 et M+4 ; on ne code que si ≥ 3 signent |

**Ce que les repreneurs paient : rien** avant le closing (sauf s'ils sont mandants d'un mandat de recherche, et alors au closing). C'est la loi, et c'est un argument de vente face aux cabinets (minimum 6 500–10 000 € à la charge de l'acquéreur) et à Fusacq (45–60 € le contact).

### 2.3 Justification du barème

| Prix de cession | CessionRGE nouveau (7/5/3, min 3 500) | CessionRGE actuel (10/8/6) | Transaxio (acquéreur) | Alvo gratuit (repreneur, 2 % min 1 000) | Michel Simond (≈ 10 % TTC) |
|---|---|---|---|---|---|
| 50 000 € | 3 500 € (plancher, 7 %) | 5 000 € | 6 500 € | 1 000 € | ≈ 4 200 € HT |
| 85 000 € (médiane artisanat) | 5 950 € | 8 500 € | 8 500 € | 1 700 € | ≈ 7 100 € HT |
| 180 000 € (médiane RGE estimée) | 12 600 € | 18 000 € | 18 000 € | 3 600 € | ≈ 15 000 € HT |
| 350 000 € | 24 500 € | 35 000 € | 35 000 € | 7 000 € | ≈ 29 200 € HT |
| 800 000 € | 50 000 € | 74 000 € | 58 500 € | 16 000 € | ≈ 66 700 € HT |

- **Pourquoi pas 10 %** : c'est le prix d'un cabinet qui fait le travail humain ; sans ce travail, 10 % produit du contournement (fuite estimée 25–40 %) et un taux de signature du mandat de 45–60 %. Et un mandat à 10 % est celui qu'un cédant de mauvaise foi conteste.
- **Pourquoi pas 3 %** : la commission est le seul revenu autorisé de la part des parties ; à 3 %, une cession médiane rapporte 5 400 € pour le même travail de conformité (KYC, mandat, NDA, LOI, data room, registre, facture, veille) et le projet ne finance pas son fondateur avant l'année 3. Alvo est à 2 % mais n'a ni carte T, ni NDA, ni data room, ni registre.
- **7 % avec plancher 3 500 €** : un tiers en dessous des cabinets, 3,5× au-dessus d'Alvo, pour un service qui se situe exactement entre les deux (le stack juridique et de confiance d'un cabinet, sans la négociation). Le plancher est la moitié de celui de Transaxio et couvre le coût fixe d'un dossier.
- **Cédant payeur, toujours** : un seul régime de facture et de recouvrement ; plus de bandeau « 141 600 € TTC » qui tue la demande ; le mandant qui bénéficie du service le paie ; cohérence mandat = acte (jurisprudence sur l'identité du débiteur). L'option acquéreur ne revient que sous forme de mandat de recherche (ligne 2), où l'acquéreur est le mandant.
- **HT d'abord partout**, TTC entre parenthèses ; TTC d'abord uniquement sur la page mandat pour un cédant personne physique.

### 2.4 Ce que la commission achète (à écrire sur l'accueil)

Diffusion anonyme indexée ; qualification déclarative et identité vérifiée des repreneurs ; accord de confidentialité et lettre d'intention signés en ligne avec dossier de preuve ; espace documents filigrané avec journal des consultations ; suivi des offres ; diagnostic de transmissibilité RGE inclus ; mandat et registre tenus par un professionnel carte T ; veille BODACC/INPI ; facture et encaissement organisés au séquestre ; un appel de 15 minutes avec le fondateur à la signature du mandat.

---

## 3. Unit economics

Hypothèses (reprises de `audit/unit_economics.py`, recalculées avec le nouveau barème) :

- Distribution des prix : 25 % ≈ 80 k€, 35 % ≈ 180 k€, 25 % ≈ 350 k€, 12 % ≈ 700 k€, 3 % ≈ 1,5 M€ → prix médian 180 k€, moyen ≈ 300 k€.
- Commission nouveau barème : **médiane ≈ 12 600 € HT, moyenne ≈ 19 900 € HT** (ancien barème : 18 000 / 28 900).
- Entonnoir médian après les changements §4 : annonce créée → mandat signé 70 % (mandat simple, résiliable, appel de 15 min) ; 8 contacts par annonce ; NDA 40 % ; closing via un repreneur présenté 15 % des annonces publiées dans les 12 mois ; fuite (hors plateforme, non déclaré, non recouvré) 20 % grâce à la veille BODACC et à l'ordre de paiement au séquestre.
- **Espérance de commission encaissée par annonce publiée ≈ 0,15 × 0,80 × 19 900 ≈ 2 400 € HT** (≈ 1 700 € par annonce créée). Ancien modèle : 3 250 € par annonce publiée mais avec 60 % de signature et 25 % de fuite, soit 1 950 € par annonce créée : **le nouveau barème perd 26 % par closing et en gagne autant en volume et en sécurité ; il est neutre en cash et bien meilleur en risque juridique.**
- Délai publication → acte : 9 mois ; encaissement : +1 mois (séquestre).
- Coût variable par annonce publiée : KYC cédant 1,5 € + ≈ 3 KYC repreneurs au NDA (4,5 €) + 2 signatures avancées (4 €) + e-mails ≈ **10 €**. Coût d'acquisition cible par annonce publiée : < 100 € (e-mailing + SEO).
- Revenus tiers par annonce publiée (médian, année 2) : ≈ 300 € (apport d'affaires) + diagnostics vendus hors plateforme.
- Point mort opérationnel (coûts récurrents ≈ 7 k€/an) : **3 annonces publiées par an** ; point mort « un demi-salaire » (40 k€) : ≈ 16 annonces publiées par an ; **un salaire de fondateur (80 k€) : ≈ 30 annonces publiées par an, soit 8–10 % du marché ouvert national**, atteignable en année 2.
- Temps fondateur par dossier : 15 min à la signature du mandat, 15 min par LOI, litiges résiduels ; à 40 annonces/an, ≈ 2 h/semaine ; le reste des 5 h va au « À faire » admin, au contenu et aux partenaires.

---

## 4. Changements produit priorisés

Effort : S < 1 jour, M 1–3 jours, L > 3 jours. « Pourquoi » = effet sur le cash, la sécurité du revenu ou l'autonomie.

### P0 — semaines 1 à 4 (sans quoi le revenu n'existe pas ou n'est pas défendable)

| # | Changement | Pourquoi | Effort |
|---|---|---|---|
| 1 | Révoquer et régénérer clé Stripe live, clé Brevo, mot de passe Mongo ; activer secret scanning + push protection ; gitleaks en pré-commit | Contrôle du compte Stripe (données d'identité, virements) par quiconque a lu le dépôt | S |
| 2 | Remplacer `stripe.error.*` par `stripe.StripeError` / `stripe.SignatureVerificationError` (6 occurrences) + test monkeypatch | Toute erreur Stripe = 500 : porte d'entrée du tunnel cassée et webhook désactivé par Stripe à terme | S |
| 3 | Sauvegarde Mongo quotidienne vers S3 (Dokploy ou cron mongodump), rétention 30 j, une restauration testée ; S3 obligatoire en prod | Mandats, preuves de signature et factures sont des pièces que la carte T impose de conserver ; sans S3, 20 Go de base64 dans Mongo | S |
| 4 | Rate limiting (slowapi) sur login/register/forgot/request-code, bcrypt en `to_thread`, `/docs` fermés, CORS sans défaut `*`, en-têtes nginx, route admin reset-password supprimée, Sentry + UptimeRobot + health réel | Disponibilité du serveur mono-processus et quota Brevo gratuit (300/jour) protégés ; les pannes sont vues avant les plaintes | S |
| 5 | **Mandat simple** 12 mois, dénonçable à tout moment avec 15 jours de préavis (e-mail avec accusé), clause de suite 24 mois sur les acquéreurs nommément présentés, objet pré-coché depuis `sale_type`, dénomination/SIREN/adresse du mandant obligatoires (collecte de l'adresse au flux), contre-signature horodatée d'AlterEgo, dates `signed_at` / `ends_at` / `tail_ends_at` stockées, obligations alignées sur le produit réel, suppression des doublons et du faux prestataire, **ordre irrévocable de paiement de la commission au rédacteur d'acte**, obligation de notifier la date de closing sous 8 jours, PDF signé numéroté envoyé automatiquement au cédant, liste nominative des acquéreurs présentés envoyée en fin de mandat ; relecture par le conseil (2 500–4 000 €, une fois) | Le mandat actuel est annulable et dissuasif ; c'est le titre de créance de 100 % du revenu | M |
| 6 | **Nouveau barème** 7/5/3, plancher 3 500 € HT, **cédant débiteur fixe** (suppression du choix, des cartes de débiteur, du `CommissionNotice` acquéreur et de la clause acquéreur du NDA), **HT d'abord** ; exemple médian 180 k€ ; calculateur sur l'accueil ; mise à jour `offer.js`, `business_model.py`, tests | Taux de signature du mandat et contournement ; un seul régime de facture ; `offer.js` est en source unique : une heure de travail | S |
| 7 | **Encaissement** : à l'acceptation d'une offre, champs obligatoires « rédacteur d'acte (nom, e-mail) » et « date prévisionnelle » ; écran « Déclarer la vente » pour les deux parties avec confirmation croisée (silence 7 j = confirmé) ; note d'honoraires + instruction de règlement envoyées automatiquement au rédacteur et au cédant ; **Stripe Invoicing** (facture conforme L441-9, lien de paiement, relances J+15/30/45, statut lu par webhook) ; routes admin « closing confirmé » / « payé » ; suppression du PDF maison ; modèle de mise en demeure | Aujourd'hui zéro mécanique d'encaissement ; 25–40 % de fuite évitable ; facturation électronique 2027 réglée par l'outil | L |
| 8 | **Veille anti-contournement** : job mensuel BODACC (ventes/cessions de fonds) + RNE/INPI (changement de dirigeant/associés) sur chaque SIREN sous mandat ou clause de suite (NDA signés inclus) ; e-mail automatique au cédant citant la clause + alerte admin + création de la facture ; relances cédant J+60/J+120 « toujours à vendre ? avez-vous vendu ? » avec archivage sans réponse | Dans un métier local, la vente hors plateforme n'est jamais sue ; données gratuites ; c'est le mécanisme qui remplace l'équipe | M |
| 9 | **Publication automatique** si identité Stripe vérifiée + mandat signé + SIREN actif + présent dans la liste ADEME + pas de doublon ; nom INPI non concordant = drapeau de post-modération 48 h, pas de blocage ; bouton « Refuser » à motifs (6) alimentant l'e-mail et le dashboard ; retrait/pause/vendue en libre-service pour le cédant | Supprime 1–3 clics bloquants par semaine et la promesse « sous 48 h » qui fait paraître le site mort | M |
| 10 | **Inscription cédant sans dépendance ADEME** : distinguer « introuvable » et « service indisponible », inscription autorisée avec vérification RGE différée en tâche de fond, badge « RGE en cours de vérification », blocage seulement à la publication | Point de défaillance unique sur la seule porte d'entrée du côté rare | S |
| 11 | **Messagerie** : conversations par couple (annonce, acquéreur), `sender_label` affiché, `receiver_id` fixé, fil nommé (activité · région · prix · pseudonyme), ouverture de la bonne conversation après contact, message système corrigé, montants `fr-FR`, layout mobile liste → fil | Au deuxième repreneur intéressé, le cédant répond à la mauvaise personne : le moment où la plateforme crée de la valeur est cassé | M |
| 12 | **Tunnel repreneur** : profil déclaratif à l'inscription (type, budget, apport, financement, zones, expérience bâtiment/RGE, horizon, présentation 300 car.) + score 0–100 affiché au cédant sous pseudonyme ; **KYC déplacé au NDA** (après validation cédant, avant révélation) ; **data room ouverte après NDA + KYC** ; **LOI = offre indicative structurée** rédigée par l'acheteur (montant, titres/fonds, conditions, calendrier), contre-signée par le cédant, exclusivité optionnelle ; gabarits NDA/LOI nettoyés (variables, blancs, montants) ; PDF et e-mail de l'exemplaire signé aux deux parties ; expiration des demandes d'accès J+10 avec relances J+2/J+5 ; option au mandat « accepter automatiquement les repreneurs vérifiés score ≥ 50 » | Chaque filtre divise la demande ; le closing par annonce (5–15 %) est le paramètre qui décide de la viabilité ; le KYC au NDA divise son coût par trois | L |
| 13 | **Fiche annonce** : afficher `rge_validity`, pipeline, contrats mandataires, matériel, locaux, charges fixes, EBITDA N-1/N-2, multiple prix/EBE ; ajouter titre composé, description, motif de vente, accompagnement, département, type de cession ; supprimer le bloc « Domaines RGE complémentaires » ; carte unique `ListingCard` (accueil, hub, activité, région, recherche) ; une seule page de recherche | Les repreneurs ne peuvent ni qualifier ni comparer ; le bloc faux décrédibilise | M |
| 14 | **Formulaire d'annonce en 3 écrans** avec brouillon serveur, info-bulles, bornes de validation, bloc optionnel « Ce qui rassure un repreneur » (décennale, référent technique, organismes, carnet de commandes, part d'aides) ; **fourchette d'estimation affichée** à la saisie du prix (module `/valorization/estimate` branché, multiples recalibrés 0,3–0,6 × CA et 2,5–4 × EBE) avec alerte si prix hors fourchette | Un artisan n'a pas EBITDA et marge brute sous la main ; les prix irréalistes tuent les closings | M |
| 15 | **Accueil et pages publiques** (§5) : hero mono-cible cédant, bande d'autorité, calculateur HT, fondateur + rendez-vous 15 min, FAQ 5, pied de page légal complet, bug mobile tarifs, compteurs à 0 masqués, `noindex` pages vides et `/search`, domaine canonique `cessionrge.fr`, fiches pré-rendues ou retirées du sitemap, mentions légales et confidentialité complétées (`REACT_APP_LEGAL_DRAFT=false`), polices auto-hébergées, Search Console + sitemap soumis | Aucune preuve de confiance, site introuvable, section prix illisible sur le support des artisans | M |
| 16 | **Nettoyage** : supprimer crédits/abonnements/remboursements/webhook paiements et `CreditsPage`, KYC manuel et bloc documents du profil, demande d'avocat (remplacée par une page statique « Vos conseils » + partenaires), générateur de contrats admin, données room admin ; revenu admin calculé sur les factures | Dette, surface d'attaque, promesses d'intervention humaine, tableau de bord qui affichera 0 pour toujours | S |
| 17 | Double opt-in e-mail à l'inscription, lien de désinscription sur alertes/digests, SPF/DKIM/DMARC sur cessionrge.fr, code OTP uniquement dans le corps, une seule variable d'adresse admin | Le code « vaut signature » sur une adresse jamais vérifiée ; délivrabilité des codes ; réputation Brevo | S |

### P1 — semaines 5 à 10 (ce qui fait venir le cash plus tôt)

| # | Changement | Pourquoi | Effort |
|---|---|---|---|
| 18 | **Estimation express gratuite** (page `/estimer-mon-entreprise-rge`, 6 champs, e-mail requis) → fourchette + 3 alertes RGE par e-mail automatique → annonce pré-remplie ; remplace la newsletter « communauté » | Aimant à cédants mesurable, automatisable ; alimente le pipeline sans commercial | M |
| 19 | **Diagnostic de transmissibilité RGE payant** (149 € HT, Stripe Checkout, PDF automatique depuis ADEME + Sirene + RNE + BODACC + questionnaire de 10 questions) ; inclus gratuitement dans la data room des annonces sous mandat ; page SEO dédiée | Revenu immédiat, produit inexistant sur le marché, cœur du différenciateur RGE | L |
| 20 | **Séquences e-mail** avec `claim_once` : mandat J+3/J+10/J+30, relance KYC acquéreur J+2/J+7, NDA sans suite J+14, offre expirée, hebdo cédant (vues, alertes déclenchées, NDA), suggestion de prix J+30 (fourchette), fin de mandat J-30, suivi post-offre J+30/60/90 ; liens profonds, « Bonjour, » sans raison sociale, pas d'émoji | Le plus gros trou de l'entonnoir (acquéreur inscrit non vérifié, mandat non signé) n'est relancé qu'une fois ; coût marginal nul | M |
| 21 | **Conventions partenaires** (expert-comptable, courtier crédit, courtier assurance décennale, cabinet d'avocats en sponsoring) + routage automatique : proposition en un clic au NDA / à la LOI / à l'offre acceptée / au closing, avec mention « ce partenaire rémunère CessionRGE » | Revenus tiers à encaissement court, 100 % compatibles Hoguet | S code, M négociation |
| 22 | **Pipeline open data** hebdomadaire (liste RGE × Sirene × RNE × BODACC) → segments A (dirigeant ≥ 58 ans), B (qualification expirant < 12 mois), C (BODACC) ; LIA d'une page, registre des traitements, liste de suppression ; séquence e-mail B2B opt-out 3 touches (source citée, désinscription) via outil de séquences | Seul moyen de prospecter sans commercial ; 2 000–2 500 e-mails/mois → 20–30 conversations/mois | M |
| 23 | **Pages programmatiques métier × département** alimentées par les comptages réels ADEME (pas de page vide), 2 guides supplémentaires (« la qualification RGE est-elle transmissible ? », « obligation RGE-facturant 2027 »), baromètre trimestriel public | Prise du SERP RGE à coût nul en 3–9 mois ; contenu non mince grâce aux données | M |
| 24 | **Mandat de recherche** (produit consolidateurs) : page, formulaire de critères, mandat inscrit au registre, alertes 72 h en avance, matching automatique sur le pipeline ; 20–30 e-mails du fondateur aux build-ups actifs | Les acheteurs solvables ne paieront pas d'annonce mais signent des mandats de recherche ; transforme le cold e-mail en « un acquéreur vérifié vous cherche » | M |
| 25 | **Signature avancée eIDAS** (Yousign/Youtrust, horodatage qualifié) pour le mandat, le mandat de recherche et la LOI ; OTP e-mail conservé pour le NDA ; page de preuve ajoutée aux PDF | Sans présomption de fiabilité (Cass. 5 mars 2026), la preuve pèse sur AlterEgo ; 2–4 € par dossier | M |
| 26 | **Admin « À faire »** par défaut (post-modération, bloquées, incidents BODACC, vendeurs muets > 7 j, offres acceptées > 60 j, factures en retard, mandats < 30 j, erreurs Sentry), 5 chiffres semaine/semaine, compteurs corrigés (`views`, KYC `under_review`), digest quotidien | Rituel de 15 min/semaine au lieu de 8 onglets | M |
| 27 | **Alertes repreneurs sans compte complet** (e-mail + activité + région), événement « baisse de prix » vers alertes et favoris, digest hebdo des vérifiés sans alerte | Principal levier de rétention repreneur, visible depuis `/search` pour un visiteur | S |
| 28 | Procédure LCB-FT d'une page, champ « origine des fonds » déclaratif avant data room, attestation de formation, conservation 5 ans, index TTL (resets, OTP, sessions KYC), DELETE/export compte, durées réelles dans la politique | Obligation du titulaire de carte T ; argument anti-coquilles RGE en 2027 ; promesses RGPD tenues | M |
| 29 | DSA hébergeur : point de contact, CGU avec politique de modération, page « Signaler », e-mail motivé en cas de retrait | Obligation légale à coût nul | S |

### P2 — après M+3 (finition, résilience, coûts)

| # | Changement | Pourquoi | Effort |
|---|---|---|---|
| 30 | Visuels : 4 photos chantier duotone, 2 captures produit, carte de France SVG, portrait du fondateur, pictogramme retouché (300–800 €) | Confiance à coût quasi nul ; un site sans visage ne reçoit pas de bilans | M |
| 31 | Découpage de `server.py` en routeurs, purge des dépendances (pandas, numpy, pdfkit…), SDK Brevo remplacé par 15 lignes de `requests`, `GENERATE_SOURCEMAP=false`, ErrorBoundary, retrait des plugins Emergent | Maintenabilité pour un fondateur assisté par IA ; image Docker −300 Mo | M |
| 32 | Cache ADEME/recherche-entreprises (24 h), pagination `/companies`, tests Stripe/jobs/closing, CI reliée au déploiement (build → ghcr → webhook Dokploy) | Résilience et déploiements sûrs | M |
| 33 | Partenariats de diffusion : Bourse Bpifrance Transmission (partenaire agréé), Transentreprise, CAPEB/CMA, newsletters Qualit'EnR/Qualibat | Canaux gratuits et institutionnels | S code, M temps |
| 34 | Test manuel courtage CEE (10 installateurs, 60 jours) ; décision codée seulement si ≥ 3 signent | Seule piste v2 à trésorerie courte, mais face à des délégataires avec équipes commerciales | S |
| 35 | Migration Vite en conservant `prerender.mjs` ; pas de Next.js, pas de Kubernetes, pas d'Atlas payant, pas de ClamAV | Coûts et simplicité | L |

---

## 5. Accueil cible et direction design

### 5.1 Promesse et structure (≈ 450 mots rendus, ≈ 2 800 px desktop / 5 500 px mobile, 1 CTA principal répété 3 fois)

**0. En-tête** : Logo · Entreprises à vendre · Vendre · Reprendre · Guides · Estimer · [Connexion] · **[Déposer une annonce]** (navy plein). Mobile : logo, bouton « Déposer », menu.

**1. Hero (fond blanc, texte 55 % / visuel 45 %)**
- Eyebrow : « Cession d'entreprises RGE · opéré par AlterEgo, carte professionnelle T »
- H1 : **« Vendez votre entreprise RGE sans que personne ne le sache. »**
- Sous-titre : « CessionRGE trouve et filtre les repreneurs pour vous : annonce anonyme, identité des repreneurs vérifiée, accord de confidentialité signé avant toute révélation. Mandat simple, résiliable à tout moment. Rien à payer avant la signature de l'acte. »
- CTA principal : « Déposer mon annonce anonyme » → `/register?role=seller` (rôle présélectionné, en-tête commun, rappel de l'offre).
- CTA secondaire (lien) : « Estimer mon entreprise en 2 minutes ». Plus bas, discret : « Vous cherchez une entreprise à reprendre ? Voir les annonces → ».
- Visuel : capture produit d'une annonce anonyme avec le bandeau « commission à la charge du vendeur, aucun frais pour vous » et un cadenas « nom et SIRET révélés après NDA », sur photo chantier duotone.

**2. Bande d'autorité (4 sceaux)** : « Opéré par AlterEgo SAS, carte professionnelle T n° CPI 7801 2025 000 000 049, CCI Paris Île-de-France » · « Qualifications contrôlées sur la base officielle ADEME » · « Identité des membres vérifiée (Stripe Identity) » · « 0 € avant la signature de l'acte — c'est la loi, et c'est notre modèle ».

**3. Pour qui (2 cartes)**
- Cédants : « Vous dirigez une entreprise RGE et préparez votre transmission. Votre annonce reste anonyme. Seuls des repreneurs identifiés, qui ont signé un accord de confidentialité, découvrent le nom de votre société. Vous choisissez à qui vous parlez, et vous pouvez retirer votre mandat à tout moment. » → « Déposer mon annonce ».
- Repreneurs : « Vous cherchez une entreprise de pompes à chaleur, d'isolation, de photovoltaïque… déjà qualifiée et saine. Consultez les annonces sans compte, créez une alerte, contactez les cédants gratuitement. Un diagnostic de transmissibilité RGE est joint à chaque dossier. » → « Voir les annonces » / « Créer une alerte ».

**4. Comment ça marche (vrais onglets accessibles « Je cède / Je reprends »)**
Cédant : 1 « Déposez votre annonce en 3 écrans — votre SIRET charge vos qualifications, une fourchette de valeur s'affiche » · 2 « Vérifiez votre identité et signez le mandat simple en ligne ; 15 minutes au téléphone avec le fondateur si vous le souhaitez » · 3 « Recevez des repreneurs vérifiés, avec leur projet et leur budget, sans dévoiler votre nom » · 4 « Révélez votre identité après NDA, ouvrez vos documents, recevez les offres ; la commission est réglée par le rédacteur d'acte à la signature ».
Repreneur : 1 « Parcourez et créez une alerte » · 2 « Présentez votre projet (2 minutes) » · 3 « Le cédant accepte : vérifiez votre identité, signez le NDA, accédez aux bilans et au diagnostic RGE » · 4 « Déposez une offre indicative, puis une offre ferme ».
Sous la timeline : « Vous êtes prévenu par e-mail à chaque contact, NDA et offre » (puis le délai médian mesuré dès 10 ventes).

**5. Annonces récentes** (`ListingCard` compacte ×3, titres lisibles « Installateur PAC & chauffe-eau · Bretagne · 9 salariés », prix / CA / EBITDA / effectif) ; si < 6 annonces, la 3ᵉ carte devient « Recevoir les prochaines annonces par e-mail » (sans compte).

**6. Tarif (une carte centrée + calculateur)**
- H2 : « Vous ne payez qu'à la vente. »
- « Publication gratuite. À la signature de l'acte de cession, une commission de **7 % HT** jusqu'à 500 000 €, 5 % de 500 000 à 1 500 000 €, 3 % au-delà, calculée par tranches, minimum 3 500 € HT. Pas d'abonnement, pas de frais de dossier, pas d'exclusivité. Rien pour les repreneurs. »
- Calculateur : « Prix de cession envisagé : [180 000 €] → Commission : **12 600 € HT** (15 120 € TTC) — réglée par le rédacteur d'acte sur le prix, à la signature. »
- « Ce que comprend la commission » (liste §2.4).
- Note : « La négociation et les actes restent entre vous et le repreneur, avec vos conseils. »

**7. Qui est derrière** : photo, « Micael [Nom], fondateur. AlterEgo SAS, Sartrouville, carte T délivrée par la CCI Paris Île-de-France. » + 3 lignes (expérience, constat des groupes Facebook non vérifiés, pourquoi une plateforme et pas un cabinet) + bouton « 15 minutes pour en parler » (Cal.com). Chiffres dès qu'ils dépassent 20 (annonces publiées, repreneurs vérifiés, NDA signés) ; avant : « Lancé en 2026 · toute la France ».

**8. FAQ (5)** : « Mes salariés et mes clients peuvent-ils savoir que je vends ? » · « Combien ça coûte, et qui paie ? » · « Puis-je retirer mon mandat ? Et si je vends par moi-même ? » (réponse franche : oui, 15 jours de préavis ; la commission reste due seulement si l'acquéreur vous a été présenté par CessionRGE, pendant 24 mois) · « Qui sont les repreneurs et comment sont-ils filtrés ? » · « Que devient ma qualification RGE après la vente ? » (lien guide).

**9. Guides (3 cartes avec visuel)** + « Tous les guides ».

**10. CTA final (seul bloc sombre)** : « Prêt à transmettre votre entreprise RGE ? » · « Déposer mon annonce anonyme » · « Je cherche une entreprise à reprendre ».

**11. Pied de page** : AlterEgo SAS · 43 rue Massenet, 78500 Sartrouville · RCS Versailles 952 180 230 · Carte professionnelle T n° CPI 7801 2025 000 000 049, CCI Paris Île-de-France · mention de garantie financière ou « ne doit recevoir ni détenir d'autres fonds… » · RC pro (assureur, police) · contact@cessionrge.fr · Signaler un contenu.

Supprimé de l'accueil : formulaire de recherche du hero (reste sur `/search` et le hub), vérificateur RGE (→ `/verifier-entreprise-rge` indexée avec encart « Vous dirigez cette entreprise ? Estimez-la »), newsletter « communauté », tableau du barème (→ calculateur ; tableau conservé sur Vendre).

### 5.2 Direction design

- **Ambiance** : intermédiaire de transmission, spécialiste, fiable, moderne — fond clair, chiffres, visages, documents. Pas de dégradé sombre pleine largeur, pas de halos, pas de « start-up éco ».
- **Palette** : encre navy `#0b1220` (texte, boutons) ; fond blanc, surface `#f5f7fa`, bordures `#e3e7ee` ; action bleu `#1d4ed8` ; **vert `#15803d` sur `#dcfce7` réservé aux badges RGE** ; ambre `#b45309` sur `#fef3c7` à petite dose (prix, « nouveau »).
- **Typographie** auto-hébergée : Manrope 700/800 pour les titres (H1 44–52 px / 32 px mobile, H2 32/26, H3 20) ; Inter 400/500/600 pour le texte (17/16 px, interligne 1,6, légendes ≥ 13 px, chiffres tabulaires).
- **Composants** : `ListingCard` unique ; `TrustBar` ; `ProcessTimeline` avec verrou dessiné « identité révélée après NDA » ; `CommissionCalculator` ; `FounderCard` ; `FaqList` limitée à 5 ; boutons primaire navy plein, secondaire blanc bordé, tertiaire lien bleu avec flèche.
- **Visuels** : 3–4 photos chantier (PAC, isolation, toiture PV, menuiserie) en duotone navy/blanc, 2 captures produit anonymisées, carte de France SVG, portrait du fondateur ; pictogramme du logo retouché vers un signe de transmission.
- **Ton** : vouvoiement, phrases courtes, chiffres ; « accord de confidentialité (NDA) », « lettre d'intention (LOI) », « espace documents sécurisé » ; bannir « communauté », « rejoignez », « Lehman », « simple et transparent ».
- **Cohérence** : en-tête et pied de page communs sur fiche, login, register ; inscription avec deux cartes « Je cède / Je reprends ».
- **Mesure** : événements Plausible `hero_cta_seller`, `calc_used`, `estimate_started`, `alert_created`, `rdv_clicked`, `listing_card_click`, `diag_purchased`.

---

## 6. Acquisition sans commercial

### 6.1 Cédants (le côté rare)

1. **Indexation d'abord** (semaine 1) : domaine canonique `cessionrge.fr`, 301 depuis le sous-domaine, Search Console, sitemap propre, fiches pré-rendues ou retirées, `noindex` des pages vides. Tant que le site n'apparaît pas sur sa marque, rien d'autre ne compte.
2. **SEO programmatique et éditorial** : pages métier × département alimentées par les comptages ADEME réels, guides d'intention (« qualification RGE transmissible ? », « combien vaut une entreprise de PAC ? », « RGE-facturant 2027 »), baromètre trimestriel de la cession RGE relayé à Batiactu / Le Moniteur. Les concurrents qui tiennent le SERP (Bpifrance, reprisetransmission.fr, entreprisesenligne, msimond) n'ont que des pages-catégories faibles.
3. **E-mailing B2B opt-out** depuis l'open data (liste RGE × Sirene × RNE × BODACC), segment A dirigeant ≥ 58 ans (11 000–16 000 entreprises), B qualification expirant < 12 mois, C BODACC ; séquence 3 touches / 12 jours (« 1 dirigeant RGE sur 4 a plus de 60 ans : combien vaut votre entreprise ? » → estimation express ; cas anonymisé ; break-up) ; 2 000–2 500 envois/mois ; attendu 4 % de réponse, 25–35 % positives → 20–30 conversations/mois → 4–8 annonces qualifiées/mois dès M+4. Source citée au premier contact, désinscription, LIA documentée, aucun scraping d'annuaires ni de LinkedIn.
4. **Aimant** : estimation express gratuite (fourchette + 3 alertes RGE), relancée vers le dépôt d'annonce.
5. **Une seule porte humaine** : créneau de 15 minutes (Cal.com) proposé après le dépôt de l'annonce et après la signature du mandat. « Sans commerciaux » = sans prospection sortante téléphonique, pas sans voix : les cédants de 60 ans ne signent pas sans un échange.
6. **Prescripteurs** : experts-comptables (partenaires d'audit d'acquisition, pas apporteurs rémunérés — pas d'habilitation carte T à gérer), CAPEB départementales, CMA, newsletters Qualit'EnR/Qualibat, partenaire agréé Bourse Bpifrance Transmission et Transentreprise (diffusion gratuite).
7. **Pas de courrier postal en année 1** (600–1 000 €/mois) ; déclenché seulement si l'e-mail produit < 3 annonces/mois à M+6, sur le segment A sans e-mail.
8. **Aucune publicité payante.**

### 6.2 Repreneurs

1. Hub et pages SEO, alertes sans compte complet depuis `/search` (e-mail + activité + région), profil repreneur gratuit en 2 minutes.
2. Diffusion des teasers via Bpifrance / Transentreprise (gratuit, très bien référencés).
3. Un post LinkedIn par semaine du fondateur (chiffres du baromètre, cas anonymisés) ; les acheteurs (consolidateurs, cadres en reconversion, investisseurs) y sont, les artisans seniors non.
4. **Mandat de recherche** : 20–30 e-mails personnels du fondateur aux build-ups actifs (Butagaz Eco-énergie, Isovalie, Émeraude Power, Satep, Atout Groupe, Renovio…) et aux structures commerciales devant internaliser le RGE avant 2027 ; c'est le seul produit qui demande un premier e-mail humain, et il tient dans 1 h/semaine.
5. Digest hebdo et événement « baisse de prix » pour la rétention ; aucun paiement repreneur.

---

## 7. Coûts de fonctionnement

### 7.1 Récurrent (cible ≤ 600 €/mois, ≈ 7 k€/an)

| Poste | €/mois | Note |
|---|---|---|
| VPS Hetzner 2 vCPU/4 Go + Mongo auto-hébergé | 12 | existant |
| Domaine cessionrge.fr + 2 domaines satellites e-mailing | 3 | |
| S3 Scaleway fr-par (sauvegardes + documents) | 0–3 | 75 Go offerts |
| Brevo (transactionnel + automations) | 0–20 | gratuit jusqu'à 300/jour |
| Sentry, UptimeRobot, Plausible | 0–9 | plans gratuits / Plausible 9 € |
| Stripe Identity (KYC au NDA : ≈ 15–30/mois) | 25–45 | 1,25–1,50 € la vérification |
| Signature avancée (Yousign/Youtrust, ≈ 10–20 signatures/mois) | 20–40 | 2 € la signature |
| Stripe Invoicing / Checkout | ≈ 0,4 % par facture | négligeable |
| Enrichissement open data (Pappers / Societeinfo) | 50–100 | âge dirigeant, e-mails |
| Outil de séquences e-mail + 3 boîtes | 100–150 | à partir de M+2 |
| RC professionnelle carte T | 80–125 | 1 000–1 500 €/an |
| Expert-comptable AlterEgo | 100–150 | |
| Cal.com | 0 | |
| **Total** | **≈ 400–650 €** | ≈ 280–350 € sans la pile de prospection |

### 7.2 Une fois (année 1)

Avocat (mandat, mandat de recherche, NDA, LOI, CGV, CGV du diagnostic, convention d'apporteur) 2 500–4 000 € · pictogramme et retouche logo 300–800 € · photos 100–200 € · formation LCB-FT 200–400 €. **≈ 3 500–5 500 €.**

### 7.3 Ce qu'on ne paie pas

Courrier postal (sauf déclencheur M+6), publicité, Kubernetes, Atlas payant, ClamAV, Next.js, outil de signature qualifiée (QES 10–15 € : inutile), facturation maison, SMS OTP.

---

## 8. Scénarios de revenus (HT)

**Hypothèses communes** : prix médian 180 k€ (distribution §3) ; commission moyenne 19 900 € HT (barème 7/5/3, plancher 3 500) ; délai publication → acte 9 mois (12 en pessimiste, 8 en optimiste), encaissement +1 mois ; diagnostic RGE à 149 € HT lancé à M+4 ; conventions partenaires signées à M+3 ; mandats de recherche signés à partir de M+5, closings en année 2 ; coûts récurrents ≈ 7 k€/an + 4–5 k€ une fois.

| | Pessimiste | Médian | Optimiste |
|---|---|---|---|
| Annonces publiées année 1 / année 2 | 18 (1,5/mois) / 36 | 34 (montée 1 → 4/mois) / 60 (5/mois) | 50 (→ 6/mois) / 90 |
| Création → mandat | 55 % | 70 % | 78 % |
| Closing via repreneur présenté (annonces publiées, 12 mois) | 8 % | 15 % | 22 % |
| Fuite (non déclaré / non recouvré) | 35 % | 20 % | 15 % |
| Espérance par annonce publiée | ≈ 1 030 € | ≈ 2 400 € | ≈ 3 700 € |
| Diagnostics vendus/mois (M+4 → M+12 / année 2) | 1 / 2 | 4 / 8 | 7 / 14 |
| Mandats de recherche closés en année 2 | 0 | 0–1 | 2 |
| **Revenus 12 mois** | **≈ 1–2 k€** (0 closing ; diag 1 k€ ; apport 0,5 k€) | **≈ 14 k€** (0–1 closing ≈ 5 k€ ; diag 5 k€ ; apport 4 k€) | **≈ 33 k€** (1 closing ≈ 15 k€ ; diag 10 k€ ; apport 8 k€) |
| **Revenus mois 13–24** | **≈ 27 k€** (1 closing ≈ 19 k€ ; diag 3,5 k€ ; apport 5 k€) | **≈ 130–150 k€** (≈ 5 closings ≈ 100 k€ ; diag 14 k€ ; apport 15 k€ ; mandat de recherche 0–40 k€) | **≈ 390 k€** (≈ 13 closings ≈ 250 k€ ; diag 25 k€ ; apport 35 k€ ; 2 mandats de recherche ≈ 80 k€) |
| **Cumul 24 mois** | ≈ 29 k€ | ≈ 145–165 k€ | ≈ 420 k€ |
| Résultat 24 mois (coûts ≈ 19 k€) | −10 k€ : arrêt ou élargissement décidé à M+6 | ≈ +130 k€ ; point mort cash vers M+15–18 | ≈ +400 k€ ; les 5 h/semaine ne suffisent plus (13 closings) |

Lecture honnête : **l'année 1 est à perte dans tous les scénarios** (≈ −10 k€ en médian avec l'avocat et les visuels) ; c'est le prix du délai de 9–12 mois d'une cession, pas celui du produit. Le plan ne « crée » pas de revenu année 1 autrement que par le diagnostic et l'apport d'affaires (≈ 9 k€ en médian), qui couvrent juste les coûts récurrents. L'année 2 est celle où la commission produit. Si le flux d'annonces n'y est pas à M+6, la niche ne suffit pas et on élargit — ou on arrête.

---

## 9. Ce qu'il faut arrêter ou retirer

1. Le mandat exclusif, la tacite reconduction, la résiliation par LRAR.
2. Le barème 10/8/6 et le choix du débiteur par le cédant (et l'affichage « acquéreur paie » en tête d'annonce).
3. L'affichage TTC d'abord et les exemples « 30 000 € → 3 600 € TTC » / « 800 000 € → 88 800 € TTC ».
4. Le KYC Stripe avant le premier message (→ au NDA) et le KYC manuel avec upload de documents.
5. La LOI comme condition d'accès à la data room et l'exclusivité 45 jours imposée pour voir des bilans.
6. La validation « profil » par le cédant sans profil repreneur.
7. La validation humaine des annonces par défaut et la promesse « sous 48 h ».
8. Crédits, abonnements, remboursements, webhook paiements, `CreditsPage`, revenu admin sur `db.transactions`.
9. La demande de mise en relation avocat (promesse d'intervention humaine), le générateur manuel de contrats admin, la data room admin, l'onglet Messages en clair.
10. La facture PDF maison et toute idée de « facturation unifiée » développée en interne.
11. La newsletter « Rejoignez la communauté RGE », le vérificateur RGE sur l'accueil, le formulaire de recherche dans le hero, les compteurs à zéro, les pages activité/région vides indexées, `/search` indexée en doublon.
12. Le bloc « Domaines RGE complémentaires — nous pouvons accompagner… » et toute promesse d'accompagnement RGE.
13. Google Fonts externe, source maps publiées, `/docs` publics, CORS `*`, route admin reset-password, secrets dans Git.
14. Les pistes v2 « mise en relation sous-traitants/fournisseurs » et « besoin client entrant » : un autre métier, très concurrentiel et encadré.
15. Toute idée d'abonnement repreneur, d'annonce premium, de contact payant ou de structure à deux entités, tant qu'AlterEgo est mandataire.
16. Le courrier postal et la publicité en année 1.
17. Le discours « rachetez une société pour son RGE ».

---

## 10. KPI (tableau « À faire » admin, lus chaque semaine)

1. Annonces créées / publiées par mois (cible médiane : 4/mois à M+6).
2. Taux annonce créée → mandat signé (cible ≥ 65 % ; c'est le goulot).
3. Coût d'acquisition par annonce publiée (cible < 100 €).
4. Taux de réponse e-mailing par segment (cible ≥ 4 %) et part de réponses positives (≥ 25 %).
5. Contacts par annonce (cible 8) ; NDA signés par annonce à 30 jours (cible ≥ 3).
6. LOI (offres indicatives) à 90 jours (cible 1 sur 3 annonces) ; offres acceptées.
7. Closings déclarés, closings confirmés, factures émises / encaissées, délai médian publication → acte.
8. Incidents BODACC/INPI sans vente déclarée (fuite détectée) et montant recouvré.
9. Revenus hors commission par mois (diagnostics, apport d'affaires, sponsoring) et nombre de mandats de recherche signés.
10. Trésorerie mensuelle nette et coût récurrent (≤ 600 €/mois).
11. Temps fondateur par semaine (≤ 5 h) et nombre d'interventions manuelles (cible : tendre vers 0 hors appels de 15 min et litiges).
12. Santé technique : erreurs Sentry, uptime, dernière sauvegarde restaurable, âge du dernier job.

---

## 11. Risques et parades

| Risque | Probabilité | Parade |
|---|---|---|
| La niche RGE pure ne produit pas 3–4 annonces/mois | Élevée | Déclencheur M+6 → élargissement bâtiment qualifié ; le code ne change pas |
| Requalification du diagnostic RGE payant en « frais de démarche » Hoguet | Moyenne | Produit vendu à tous au même prix, CGV séparées, gratuit pour les annonces sous mandat ; validation par le conseil avant lancement |
| Contournement après NDA dans un métier local | Élevée | Mandat simple à 7 % (moins d'incitation), clause de suite 24 mois, ordre de paiement au séquestre, veille BODACC/INPI, liste nominative des acquéreurs présentés, modèle de mise en demeure |
| Mandat contesté (nullité relative invoquée par le mandant) | Moyenne | Mandat relu par le conseil, mentions carte/CCI, objet déterminé, remise prouvée du PDF numéroté, signature avancée horodatée |
| Délai : 9–12 mois sans commission | Certaine | Trésorerie fondateur 12–15 mois ; diagnostics et apport d'affaires couvrent les coûts récurrents ; aucune dépense d'acquisition payante |
| Choc réglementaire MaPrimeRénov' / PLF 2027 réduisant la vendabilité des RGE isolation/PV | Élevée | Positionnement PAC/CVC multi-qualifiées avec entretien ; parcours léger « cession rapide » pour les petites structures mono-produit ; discours « activité saine vérifiée » |
| Rachat de coquilles RGE par des fraudeurs à partir de 2027 | Moyenne | KYC des deux parties, origine des fonds déclarative, score repreneur, refus explicite affiché sur l'accueil ; obligation LCB-FT tenue |
| Fondateur seul : panne, maladie, 5 h dépassées | Moyenne | Tout automatisé sauf appels et litiges ; admin « À faire » ; sauvegardes et monitoring ; CI reliée au déploiement |
| Site non indexé / pénalité thin content | Moyenne | Domaine fixé avant indexation, `noindex` des pages vides, pages programmatiques alimentées par des données réelles |
| Dépendance aux API publiques (ADEME, INPI, BODACC) | Moyenne | Cache 24 h, vérification différée, blocage seulement à la publication |
| Facturation électronique 2027 | Certaine | Stripe Invoicing / plateforme agréée ; rien de développé en interne |
| Consolidateurs qui ne signent pas de mandat de recherche | Moyenne | Produit en P1, 1 h/semaine, pas de dépendance du plan médian à ce revenu |

---

## 12. Les 90 premiers jours

### Semaine 1 — sécurité, droit, indexation (≈ 2 jours de dev)
- Jour 1 : révoquer Stripe/Brevo/Mongo, secret scanning, gitleaks ; corriger `stripe.error` ; sauvegarde Mongo → S3 ; S3 obligatoire ; rate limiting, `/docs` fermés, CORS, en-têtes, Sentry, UptimeRobot, health réel.
- Envoyer au conseil d'AlterEgo le mandat simple, le mandat de recherche, la LOI-offre, le NDA, les CGV du diagnostic et la convention d'apporteur (devis 2 500–4 000 €) ; vérifier les mentions exactes de la carte T (garantie ou non-détention, RC pro).
- Domaine canonique `cessionrge.fr`, 301, Search Console, sitemap sans fiches non pré-rendues, `noindex` pages vides et `/search`, mentions légales et confidentialité complétées, `REACT_APP_LEGAL_DRAFT=false`, SPF/DKIM/DMARC.

### Semaines 2–4 — le revenu devient défendable (P0 #5 à #17)
- Barème 7/5/3 + plancher + cédant débiteur + HT d'abord (`offer.js`, `business_model.py`, tests).
- Mandat simple complet (objet, adresse, contre-signature, dates, ordre de paiement, PDF envoyé, clause de suite, liste des acquéreurs présentés).
- Encaissement : rédacteur d'acte à l'offre acceptée, écran « Déclarer la vente », Stripe Invoicing, routes admin, suppression du PDF maison.
- Veille BODACC/INPI mensuelle + relances cédant J+60/J+120.
- Publication automatique + refus motivé + pause/retrait/vendue en libre-service.
- Inscription sans dépendance ADEME, double opt-in, code OTP hors objet.
- Messagerie par couple (annonce, acquéreur).
- Tunnel repreneur : profil déclaratif + score, KYC au NDA, data room après NDA, LOI = offre indicative contre-signée, gabarits nettoyés, exemplaires envoyés.
- Fiche annonce enrichie, `ListingCard` unique, formulaire en 3 écrans avec fourchette d'estimation.
- Nettoyage (crédits, KYC manuel, avocat, contrats admin).
- Accueil cible (§5) sans les visuels définitifs : hero, bande d'autorité, calculateur, fondateur + Cal.com, FAQ 5, pied de page légal, bug mobile.
- Jalon fin S4 : **un cédant peut déposer, signer un mandat simple valide, être publié sans clic de Micael ; un repreneur peut se présenter, signer un NDA après KYC, voir les bilans, déposer une offre ; une vente déclarée produit une facture envoyée au rédacteur d'acte.**

### Semaines 5–8 — le cash court et le flux (P1 #18 à #24)
- Estimation express gratuite ; page `/verifier-entreprise-rge`.
- Diagnostic de transmissibilité RGE à 149 € HT (après feu vert du conseil) ; inclus dans la data room.
- Séquences e-mail complètes (`claim_once`).
- Conventions partenaires : 1 expert-comptable, 1 courtier crédit, 1 courtier assurance décennale, 1 cabinet d'avocats en sponsoring ; routage dans le tunnel.
- Pipeline open data (liste RGE × Sirene × RNE × BODACC), LIA, infra e-mailing (2 domaines satellites, 3 boîtes, warm-up 3 semaines).
- Pages programmatiques métier × département avec comptages réels ; 2 guides ; baromètre n° 1.
- Mandat de recherche : page + mandat + alertes 72 h ; 20 e-mails personnels aux consolidateurs.
- Signature avancée eIDAS pour mandat, mandat de recherche, LOI.
- Dossiers de partenariat Bourse Bpifrance Transmission et Transentreprise envoyés.
- Jalon fin S8 : **première campagne e-mail de 2 000 contacts partie ; diagnostic en vente ; 4 conventions signées ; 2 mandats de recherche en discussion.**

### Semaines 9–13 — pilotage et finition (P1 #25 à #29, P2 #30–#34)
- Admin « À faire », digest quotidien, compteurs corrigés.
- Alertes sans compte, événement baisse de prix, digest repreneurs.
- LCB-FT (procédure, origine des fonds, formation, TTL, export/suppression), DSA hébergeur.
- Visuels : photos duotone, captures produit, carte de France, portrait, pictogramme.
- Test manuel courtage CEE avec 10 installateurs (décision à M+4).
- Deuxième et troisième séquences e-mail (segments B et C), 1 post LinkedIn/semaine, 15 min par mandat signé.
- Revue M+3 : annonces publiées/mois, taux création → mandat, NDA/annonce, réponses e-mail, revenus hors commission, temps fondateur. Préparer la décision d'élargissement de M+6.

### Rituel hebdomadaire du fondateur (5 h)
- 1 h : onglet « À faire » (post-modération, incidents BODACC, factures, mandats à échéance).
- 2 h : appels de 15 min (mandats signés, LOI) et réponses aux cédants.
- 1 h : contenu (post LinkedIn, un guide par mois, baromètre trimestriel) et relecture des séquences.
- 1 h : partenaires et consolidateurs (e-mails, conventions, mandats de recherche).

---

## 13. Ce que ce plan ne promet pas

- Il ne promet pas de revenu significatif en année 1 : le cycle d'une cession de TPE est de 9–18 mois. Le médian à 12 mois est ≈ 14 k€ HT, pour ≈ 11 k€ de coûts.
- Il ne promet pas une plateforme « à l'échelle » : la niche plafonne à 300–500 cessions adressables par an ; 100–200 k€/an en année 2–3 est un bon résultat pour une personne, pas une entreprise à salariés. L'élargissement au bâtiment qualifié est la seule voie au-delà, et sa décision est fixée à M+6.
- Il ne promet pas « zéro humain » : 15 minutes par mandat, 15 minutes par LOI, et les litiges. C'est ce qui reste quand tout le reste est automatisé, et c'est compatible avec 5 h par semaine jusqu'à ≈ 40 annonces par an.
- Il ne contourne pas la loi Hoguet : aucun euro des parties avant l'acte. Les revenus courts viennent de tiers et d'un produit logiciel vendu à tous. Si le conseil d'AlterEgo écarte le diagnostic payant, le plan médian perd ≈ 5 k€ en année 1 et ≈ 14 k€ en année 2, et reste valable.
