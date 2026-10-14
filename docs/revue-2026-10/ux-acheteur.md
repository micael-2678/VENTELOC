# Audit UX du parcours acheteur (repreneur) — CessionRGE

Audit réalisé en lecture seule dans le navigateur (Playwright/Chromium, desktop 1400×900 et mobile 390×844), du 9 octobre 2026, sur l'environnement de test local (front build de production `http://127.0.0.1:3000`, API `http://127.0.0.1:8001/api`, base en mémoire).

- Scripts et captures : `docs/revue-2026-10/ux-acheteur/` (86 captures `desktop-*.png` / `mobile-*.png`, scripts `01_public.js`, `02_buyer.js`, `03_followups.js`, `04_dataroom.js`, `05_viewer_net.js`, `seed_more.py`).
- Textes des contrats tels que présentés à l'acheteur : `nda-text.txt`, `loi-text.txt` ; e-mails reçus par l'acheteur de test : `buyer-emails.json`.
- Pour auditer la recherche avec un catalogue crédible, 5 annonces réalistes ont été ajoutées en base (en mémoire) via `seed_more.py` (vendeur `ux-vendeur-1@test.fr`, mandats signés, 2 annonces « commission à la charge de l'acquéreur », 3 « à la charge du cédant », prix de 95 k€ à 2,2 M€). Compte acheteur créé par l'interface : `ux-acheteur-1@test.fr`.
- Tout le parcours a été joué de bout en bout : accueil → recherche → fiche → inscription → mur KYC → contact → messagerie → demande data room → validation vendeur → NDA (code e-mail) → LOI (code e-mail) → data room → offre → tableau de bord, alertes, favoris, e-mails. Aucune erreur JavaScript (`pageerror`) et aucune réponse API ≥ 400 non provoquée (le seul 400 est le mauvais code OTP saisi volontairement).

---

## 0. Verdict sincère en dix lignes

Le socle est sérieux : identité visuelle propre et cohérente, anonymat réellement tenu (vérifié par test), masquage des coordonnées, signature par code claire, barème affiché honnêtement, SEO bien construit, guides sectoriels de qualité. Un acheteur ne verra pas d'amateurisme graphique.

En revanche, **le produit n'aide pas un repreneur à décider**. Une annonce CessionRGE est un tableau de six chiffres sans histoire : pas de motif de vente, pas d'accompagnement, pas de département, pas de dates de validité RGE (toujours « Date non renseignée »), et des champs pourtant saisis par le vendeur (carnet de commandes, contrats mandataires CEE, matériel, locaux, charges fixes) ne sont jamais affichés. Un bloc « Domaines RGE complémentaires » affiche même une information fausse et un service qui n'existe pas. Cessionpme et Fusacq, avec un simple texte libre de 10 lignes et le département, en disent plus.

Le tunnel comporte ensuite trois frictions qui, combinées, feront abandonner la majorité des repreneurs : (1) une vérification d'identité Stripe **avant le premier message**, payée par la plateforme pour chaque curieux ; (2) un vendeur qui doit « valider le profil » d'un acheteur dont il ne sait **rien** (« Acquéreur n°891FC7 ») ; (3) une LOI à signer **au prix demandé**, avec exclusivité de 45 jours et non-contournement de 24 mois, simplement pour ouvrir la data room, avant toute offre, le tout dans des documents contenant des blancs et des variables non remplies (`{{DOC_ID}}`, « 1350000.0 € », « fournit oui une attestation »).

Enfin, le modèle « commission à la charge de l'acquéreur » affiché TTC d'abord (141 600 € sur 1,35 M€ ; 11 400 € sur 95 k€, soit 12 %) est dissuasif pour les trois personas et incite au contournement direct, très facile dans un métier où tout le monde se connaît localement. Le modèle doit être réaligné (cédant par défaut, HT d'abord pour les pros, plancher raisonnable) et le tunnel simplifié : profil repreneur, NDA « clic » après validation, KYC au moment du NDA, LOI = offre indicative de l'acheteur.

---

## 1. Ce qui est bien fait (à ne pas casser)

1. **Design et cohérence** : palette navy/vert, typographies Manrope/Inter, composants shadcn homogènes, en-tête collant, pied de page riche (maillage activités/régions/guides). Aucune page ne déborde horizontalement sur mobile (`scrollWidth === clientWidth` mesuré à 390 px sur accueil, recherche, messagerie). Captures : `desktop-01-home.png`, `mobile-01-home.png`, `mobile-02-search.png`.
2. **Anonymat tenu** : la raison sociale n'apparaît ni dans l'API publique (`PUBLIC_COMPANY_PROJECTION`, `backend/server.py:1562-1566`) ni sur la fiche avant NDA (test : « fiche contient SOLEIL ? false »), puis est révélée proprement après signature (`desktop-39-company-after-nda.png`). Les coordonnées écrites dans un message avant NDA sont masquées (`[coordonnées masquées]`, `desktop-32-messages-contact-masking.png`, `backend/server.py:1640-1646`).
3. **Signature par code e-mail** : dialogue en deux étapes lisible, case d'acceptation, renvoi du code avec compte à rebours, message d'erreur clair sur mauvais code (« Code invalide ou expiré : vérifiez le code reçu par e-mail »), référence du document, mention de la preuve conservée (`frontend/src/components/OtpSignatureDialog.jsx`, `desktop-36-nda-otp-sent.png`, `desktop-37-nda-otp-wrong.png`).
4. **Transparence de la commission** : débiteur et estimation TTC/HT + taux effectif affichés sur la fiche avant tout contact, rappelés dans la modale de contact et dans le NDA ; FAQ complète ; rien n'est encaissé avant l'acte (`CommissionNotice`, `frontend/src/pages/CompanyDetail.jsx:46-67`).
5. **Gratuité repreneur réelle** : aucun crédit, aucun abonnement, boutons et textes cohérents (`frontend/src/lib/offer.js` source unique).
6. **Recherche publique fonctionnelle** : filtres multi-domaines, région, CA, prix, tri (vérifié : tri prix croissant 95 000 → 2 200 000 €), état vide avec « Réinitialiser les filtres », paramètres d'URL depuis le hero (`desktop-02-search.png`, `desktop-04-search-empty.png`).
7. **SEO** : pages hub/activité/région pré-rendues (`frontend/build/entreprises-rge-a-vendre/...`), fil d'Ariane, JSON-LD (FAQ, ItemList, Breadcrumb), contenus sectoriels pertinents par famille (isolation, PAC, solaire…) et par région (`frontend/src/seo/content.json`), 4 guides sérieux. C'est un vrai actif d'acquisition pour les personas (b) et (c).
8. **E-mails sobres et utiles** : bienvenue avec prochaine étape, « Profil validé par le vendeur » qui explique NDA puis LOI, code de signature avec durée, « Accès à la data room ouvert », relance à 30 jours (`followup_30d`) ; dosage anti-spam des notifications de messages (`backend/server.py:3155-3166`).
9. **Data room** : filigrane incrusté (e-mail + horodatage), journal d'accès, téléchargement désactivé (`backend/watermark.py`, `backend/server.py:2113-2190`).
10. **Hygiène technique** : code-splitting des espaces privés, page 404 dédiée, outils de l'éditeur (PostHog, rrweb) correctement cantonnés à l'iframe de l'éditeur (`frontend/public/index.html:27-39, 91`), aucune erreur JS sur tout le parcours.

---

## 2. Constats par étape

### 2.1 Accueil (`desktop-01-home.png`, `mobile-01-home.png`)

- Page longue (10 627 px en mobile) mais structurée : hero + carte de recherche, 4 garanties, dernières annonces, « Comment ça marche » (onglets Je vends / Je reprends), tarifs, vérificateur RGE, guides, FAQ, newsletter, CTA final.
- Le hero est **orienté vendeur** (badge « Publication gratuite · Commission uniquement en cas de vente », CTA primaire « Je vends mon entreprise »). Pour un repreneur, la carte « Trouver une entreprise à reprendre » à droite joue bien son rôle. Bon équilibre pour une place de marché où le vendeur est le côté rare.
- Les cartes « Dernières entreprises » n'affichent que domaines, région, CA, prix. Pas de titre/accroche, pas d'indication de qui paie la commission.
- Mineur : le libellé « Vous pourrez en cocher plusieurs sur la page de résultats » sous le select « Domaine RGE » est une excuse d'interface ; un multi-select ou une recherche libre serait plus naturel.

### 2.2 Recherche publique `/search` et pages SEO (`desktop-02-search.png`, `desktop-03-search-filtered.png`, `desktop-05-seo-hub.png`, `desktop-06-seo-activite-pv.png`, `desktop-07-seo-region-bretagne.png`)

- **Titre de carte = concaténation des domaines RGE** (`frontend/src/pages/PublicSearch.jsx:258` : `company.rge_types.join(' - ')`), qui répète les badges juste au-dessus. Résultat : « Pompes à chaleur air/eau - Chauffe-eau thermodynamique - Chaudières gaz/fioul à condensation » sur deux lignes, aucune accroche. Cessionpme/Fusacq ont un titre rédigé (« Chauffagiste historique, 400 contrats d'entretien, Finistère »).
- **Informations absentes des cartes** pour décider d'ouvrir : département (région seulement), type de cession (titres/fonds), multiple prix/EBITDA, **qui paie la commission** (information pourtant présentée comme « toujours indiquée sur l'annonce »), motif de vente. Un acheteur qui ouvre une fiche à 1,35 M€ et découvre 141 600 € TTC à sa charge a perdu du temps.
- Le badge « RGE vérifié » est affiché sur toutes les cartes alors que la fiche indique « Date non renseignée » pour chaque qualification (voir 2.3) : la promesse « Qualifications RGE contrôlées auprès de l'ADEME » n'est pas tenue visuellement.
- **Deux pages de recherche différentes** : `/search` (public, `PublicSearch.jsx`) et `/buyer/search` (connecté, `SearchCompanies.jsx`, `desktop-48-buyer-search.png`) avec des cartes, filtres et ordres différents (pas de tri sur `/buyer/search`, pas de bouton contact, ordre CA/prix inversé). Le bouton « Rechercher » du tableau de bord mène à `/buyer/search`, les liens « Voir tout » à `/search?sort=…`. Un utilisateur connecté navigue donc entre deux interfaces pour la même tâche.
- Pages SEO : bonne structure, mais les **compteurs « 0 »** sur 14 activités sur 18 et 8 régions sur 14 (`desktop-05-seo-hub.png`) crient « place de marché vide » à tout visiteur. Avec un catalogue de départ de quelques dizaines d'annonces, ce sera le cas pendant des mois.
- Mobile : filtres repliés par défaut (bon), bouton « Filtres » visible ; le volet déplié pousse les résultats hors écran mais reste utilisable.

### 2.3 Fiche annonce anonyme (`desktop-09-company-payer-repreneur.png`, `mobile-09-company-payer-repreneur.png`, `desktop-10/11-company-tab-*.png`, `desktop-12-company-payer-cedant.png`)

- **Titre générique « Entreprise de rénovation énergétique »** sur toutes les fiches (`CompanyDetail.jsx:429`), sous-titre « Occitanie • 18 employés ». Rien ne distingue une annonce d'une autre.
- **Bloc « Domaines RGE complémentaires » : faux et hors sujet.** Sur l'annonce SOLEIL SUD (Panneaux photovoltaïques + PAC air/eau), le bloc affirme que l'entreprise « ne possède pas encore » « Panneaux solaires photovoltaïques » et « Chaudières à haute performance énergétique ». Cause : comparaison sur les 10 premiers caractères des libellés (`CompanyDetail.jsx:329-343`, `substring(0, 10)` : « panneaux s » ≠ « panneaux p »). Le texte promet en plus « Nous pouvons accompagner le futur propriétaire dans l'obtention de ces domaines RGE », service que CessionRGE n'offre pas. Un consolidateur qui connaît le secteur lit ça comme une erreur grossière.
- **« Date non renseignée » sur chaque qualification**, alors que le vendeur saisit obligatoirement une « Date de fin de validité RGE » (`frontend/src/pages/CreateListing.jsx:363-369`, champ `rge_validity` stocké et renvoyé par l'API). La fiche lit un champ `rge_qualifications` qui n'existe jamais (`CompanyDetail.jsx:326`). Organisme qualificateur et numéro de qualification sont absents également.
- **Champs saisis mais jamais affichés** : `pipeline` (carnet de commandes), `fixed_charges`, `mandataire_contracts` (dépendance CEE/obligés), `specialties`, `equipment`, `premises` (modèle `CompanyCreate`, `backend/server.py:211-236` ; tous renvoyés par l'API publique). Ce sont précisément les éléments qu'un repreneur d'entreprise RGE regarde en premier (guides du site eux-mêmes : « dépendance aux primes », « carnet de commandes », « matériel »).
- **Aucun texte libre possible** : `description`, `sale_reason` sont rendus conditionnellement (`CompanyDetail.jsx:655, 680`) mais n'existent pas dans le modèle de création ; le vendeur ne peut écrire ni motif de vente, ni accompagnement proposé, ni atouts. Les trois personas en ont besoin : (a) le consolidateur veut le motif (retraite = accompagnement possible, litige = fuite), (b) l'artisan veut savoir si le dirigeant reste 6 mois, (c) le cadre en reconversion veut comprendre l'équipe et le référent technique.
- **EBITDA sur une seule année** alors que le CA est donné sur trois ; « Marge brute 28 % » sans définition ; pas de résultat net ; pas de multiple affiché (1 350 000 / 310 000 = 4,4× EBITDA : c'est l'information de cadrage que donnent Acquire.com et tout conseil).
- **Localisation à la région** : Occitanie = 13 départements ; l'artisan qui « rachète le voisin » ne peut pas savoir si c'est à 20 ou 300 km. Le département ne lève pas l'anonymat.
- **Commission à la charge de l'acquéreur** : encadré ambre bien visible et honnête (« 141 600 € TTC (118 000 € HT), soit un taux effectif de 8,74 % HT »). Compréhensible, mais : TTC en premier pour des acheteurs qui sont des sociétés (holding, groupe) et récupèrent la TVA ; sur MENUISERIE ALPES (95 000 €) c'est 11 400 € TTC, soit +12 % sur le prix : dissuasif, et l'acheteur n'a aucune contrepartie visible (pas de conseil, pas de dossier, pas de négociation). Comparaison : Cessionpme et Fusacq ne font rien payer aux repreneurs ; les cabinets facturent le cédant.
- Onglet « Conditions » : « Type de vente : Cession totale » (texte libre), « Nombre de vues » rendu public (utile au vendeur, pas à l'acheteur ; révèle l'absence d'audience quand le chiffre est 2).
- Navigation « Précédente / Suivante » : suit l'ordre par date de création de l'API `/companies` (`CompanyDetail.jsx:140-149`), pas l'ordre ni le filtre de la recherche d'où l'on vient (vérifié : compteur « 3 / 6 » sur une fiche ouverte directement). Trompeur après un tri par prix.
- Visiteur non connecté : « Contacter le vendeur » → `/login?redirect=/company/…` (bon) ; « Ajouter aux favoris » → `/login` **sans** redirect (`CompanyDetail.jsx:160-165`), l'utilisateur perd la fiche.

### 2.4 Inscription acheteur (`desktop-14-register.png`, `desktop-20-register-buyer-form.png`, `mobile-14-register.png`)

- Formulaire générique (« Rejoignez CessionRGE aujourd'hui »), sans rappel de la proposition de valeur ni de ce qui suit (vérification d'identité). Rien ne qualifie le repreneur : type (groupe, artisan, personne physique), budget, zones, financement, horizon. Fusacq et Acquire.com construisent un « profil repreneur » dès l'inscription, et c'est ce profil que le cédant regarde.
- **Bug : deux champs « Nom de l'entreprise »** pour un acheteur (l'un sans mention, l'autre « (optionnel) »), liés au même état `company_name` (`frontend/src/pages/RegisterPage.jsx:294-308` et `327-341`). Taper dans l'un remplit l'autre.
- Rôles libellés « Vendeur (Entreprise RGE) » / « Acheteur (Investisseur/Repreneur) » : clair.
- Après inscription : redirection correcte vers le tableau de bord (ou vers la fiche si `redirect`), toast « Inscription réussie ! », e-mail de bienvenue immédiat avec la prochaine étape. Bien.
- Page « Mon profil » (`desktop-49-profile.png`) : libellé « Buyer » en anglais, avatar « U », aucun champ modifiable (nom, téléphone, société, projet), et un encart « Documents requis : pièce d'identité, justificatif de domicile (moins de 3 mois), Kbis » avec envoi de fichier qui **contredit** le parcours Stripe Identity (pièce + selfie). Un acheteur vérifié y voit encore un formulaire d'envoi de documents.

### 2.5 Mur KYC (`desktop-21-buyer-dashboard-after-register.png`, `desktop-23-kyc-wall-company.png`, `desktop-24-kyc-dialog.png`, `mobile-21-buyer-dashboard-unverified.png`, `mobile-23-kyc-wall-company.png`)

- Le mur est net et expliqué (bandeau ambre, dialogue en 3 étapes, mention Stripe). Mais il intervient **avant toute interaction** : un repreneur qui veut juste poser une question (« quel département ? ») doit sortir sa pièce d'identité et faire un selfie. C'est le premier point d'abandon, et le plus coûteux : Stripe Identity est facturé à la plateforme (≈ 1,50 € HT par vérification) pour chaque curieux, sans aucun revenu en face (repreneur gratuit).
- Perception par persona : (a) un dirigeant de groupe délègue souvent le sourcing à un analyste qui n'a pas envie de passer son passeport pour un premier contact ; (b) un artisan le fera si l'annonce le motive, mais il sait que c'est le voisin et ira le voir directement ; (c) le cadre en reconversion l'accepte, à condition de comprendre que c'est fait une fois pour toutes (non dit).
- Incohérences d'exécution : le tableau de bord ouvre Stripe dans une **nouvelle fenêtre** (`window.open`, `BuyerDashboard.jsx:127`) et interroge le statut 5 s plus tard, la fiche redirige dans l'onglet courant (`KYCVerification.jsx:97`). En cas d'échec, message générique « Erreur lors du démarrage de la vérification » sans voie de secours (ici Stripe injoignable, `desktop-22-kyc-click-dashboard.png`, `desktop-25-kyc-dialog-error.png`). Le dialogue ne dit pas combien de temps ça prend, ni que c'est à faire une seule fois, ni ce que le vendeur verra (rien, en réalité).
- Côté vendeur, la seule chose transmise est un pseudonyme et un drapeau « vérifié » (`backend/server.py:2360-2371`, `SellerDashboard.jsx:970-971` affiche le même libellé deux fois). Le KYC ne sert donc pas à rassurer le vendeur sur *qui* est l'acheteur, mais seulement à savoir qu'il existe.

### 2.6 Prise de contact et messagerie (`desktop-28-contact-modal.png`, `desktop-29-contact-modal-selected.png`, `desktop-30-messages-after-contact.png`, `desktop-33-messages-profile-validated.png`, `desktop-51-messages-after-second-contact.png`, `mobile-28-contact-modal.png`, `mobile-52-messages-list.png`)

- Modale de contact avec 5 messages pré-rédigés + personnalisé : bonne idée pour lever la page blanche, et le rappel « Mise en relation gratuite » rassure. Les messages pré-rédigés sont génériques (« Je suis très intéressé par votre entreprise ») ; aucune place pour se présenter (qui je suis, mon projet), ce qui est pourtant ce que le vendeur attend.
- **Bug : après « Envoyer et contacter » sur une deuxième annonce, la messagerie s'ouvre sur la première conversation** (vérifié : contact d'ISOL NORD → conversation affichée « Entreprise #55d48596 » = SOLEIL SUD). Cause : `navigate('/messages')` sans identifiant (`CompanyDetail.jsx:251`) et sélection de la première clé (`MessagesPage.jsx:74`). L'acheteur doit retrouver la bonne conversation.
- **Conversations nommées par un fragment d'UUID** (« Entreprise #55d48596 », `MessagesPage.jsx:385, 403`). Avec trois contacts, impossible de savoir laquelle est la PAC en Bretagne. Ni domaine, ni région, ni prix, ni statut.
- **Aucun nom d'expéditeur** sur les bulles alors que l'API fournit `sender_label` (« Vendeur », « Vous », « CessionRGE ») : les messages système, ceux du vendeur et ceux de l'acheteur se distinguent seulement par la couleur.
- **Message système contradictoire** : « Votre profil a été validé. Veuillez signer la Lettre d'Intention (LOI) pour accéder à la data room » (`backend/server.py:2425`) alors que le bouton actif est « Signer le NDA » et que « Signer la LOI » est grisé.
- Le masquage des coordonnées fonctionne mais est **silencieux** : l'acheteur voit son propre message réécrit en « [coordonnées masquées] » sans explication. Un mot (« les coordonnées sont masquées jusqu'au NDA ») éviterait l'incompréhension.
- Le libellé du bouton « Demander accès Data Room » est le seul chemin vers le NDA : un acheteur qui veut simplement connaître l'identité (NDA) ne trouve pas de bouton « Signer le NDA » ; il doit demander « l'accès à la data room ». Le vocabulaire ne correspond pas au parcours promis sur l'accueil (« Signez un NDA pour découvrir l'identité »).
- **Mobile** : la grille a une hauteur fixe `calc(100vh - 200px)` (`MessagesPage.jsx:367`) ; la liste des conversations est écrasée à ~50 px (titre « Conversations » tronqué, `mobile-52-messages-list.png`), le titre « Entreprise #… » se replie sous les boutons d'action. Utilisable mais pénible.
- Mineur : flash d'état périmé (< 1 s) au changement de conversation (« Data Room accessible / NDA LOI » de la conversation précédente affiché le temps du rechargement, `mobile-33-messages-profile-validated.png`) car `accessStatus` et `signedDocs` ne sont pas réinitialisés avant le fetch (`MessagesPage.jsx:54-58`).
- Dosage des e-mails : la réponse du vendeur n'a pas généré d'e-mail à l'acheteur parce qu'un message système non lu existait déjà (`backend/server.py:3155-3166`). Correct pour éviter le spam, mais aucun rappel n'est prévu pour un acheteur qui ne se reconnecte pas (la relance à 3 jours ne vise que les vendeurs).

### 2.7 Demande d'accès, validation vendeur, NDA puis LOI (`desktop-31-messages-dataroom-pending.png`, `desktop-34-nda-dialog.png`, `desktop-35-nda-dialog-end.png`, `desktop-40-loi-dialog.png`, `desktop-41-messages-after-loi.png`, `mobile-54-nda-dialog.png`, `mobile-55-nda-accept.png`, `mobile-56-nda-otp.png`)

Ordre réel du tunnel : contact → « Demander accès Data Room » → le vendeur « valide le profil » → NDA → LOI → data room → offre.

- **Le vendeur valide à l'aveugle** : il ne voit que « Acquéreur n°891FC7 · vérifié ». Sans profil, il validera tout le monde (et le NDA n'a plus de sens) ou personne (et le tunnel s'arrête). Il n'y a ni délai, ni expiration, ni visibilité pour l'acheteur au-delà de « Demande en attente ».
- **NDA (8 286 caractères, 1 194 mots)** dans une boîte de 40 % de la hauteur d'écran (338 px sur mobile, `mobile-54-nda-dialog.png`), police serif, sans résumé. Lisibilité médiocre mais acceptable pour un juriste ; pour un artisan, c'est un mur.
- **Documents contenant des blancs et des variables non remplies** (`nda-text.txt`, `loi-text.txt`) :
  - « Personne physique : Claire Durand, né(e) le , demeurant , e-mail … » ; « Personne morale : , au capital de €, sise , RCS n° , représentée par Claire Durand, fonction , » (NDA l. 10-11, LOI l. 8-9) : ces données ne sont jamais collectées.
  - « Doc {{DOC_ID}} » : jeton de gabarit brut dans le NDA (l. 49).
  - LOI : « Prix indicatif (non contraignant) : 1350000.0 € ou fourchette € – € » (l. 32) ; « L'Acheteur fournit oui une attestation de fonds » (l. 68, variable `ATTESTATION_FONDS` = « oui ») ; « Méthode envisagée : 4.5 × EBITDA » qui est un réglage plateforme (`backend/server.py:5260`) présenté comme la méthode de l'acheteur ; cases « [ ] de 100 % des titres / [ ] du fonds de commerce » non cochables.
  - Un acheteur sérieux (ou son avocat) refusera de signer un document avec des blancs ; cela entame la crédibilité juridique de toute la chaîne (mandat compris).
- **La LOI est conceptuellement inversée** : l'acheteur signe une « lettre d'intention » **au prix demandé**, qui impose au vendeur une exclusivité de 45 jours (clause 5, contraignante) et à l'acheteur un non-contournement de 24 mois et la commission (clause 9), **uniquement pour ouvrir la data room**, avant d'avoir vu un bilan. L'offre (« Faire une offre ») vient après. Dans la pratique (et chez Acquire.com, Fusacq), la LOI est l'offre indicative de l'acheteur, rédigée après l'accès à l'information. Ici l'ordre data room / LOI est renversé, et le vendeur, pourtant engagé par l'exclusivité, ne signe pas la LOI : l'endpoint de contre-signature existe (`backend/server.py:5981`) mais la data room s'ouvre dès la signature de l'acheteur, et la mention « doit être acceptée par le Vendeur au plus tard le 16/10/2026 » ne déclenche rien.
- **Aucun exemplaire pour l'acheteur** : après signature, le NDA et la LOI ne sont ni téléchargeables (seul le mandat vendeur a un PDF, `backend/server.py:5784`) ni envoyés par e-mail (l'acheteur reçoit seulement les codes ; le vendeur reçoit « Nouvelle signature »). L'acheteur s'engage sur 24 mois sans garder le document.
- Variante « commission vendeur » (ISOL NORD, `mobile-54-nda-dialog.png`) : le NDA ne contient pas de clause commission, cohérent.
- Points positifs à conserver : masquage de l'identité dans le NDA tant qu'il n'est pas signé (« [communiqué après signature] »), révélation automatique sur la fiche et en Annexe A, références de documents, erreurs OTP claires.

### 2.8 Data room et offre (`desktop-60-dashboard-dataroom-docs.png`, `desktop-61-dataroom-viewer.png`, `mobile-61-dataroom-viewer.png`, `desktop-42-offer-modal.png`, `desktop-43-messages-after-offer.png`)

- La data room n'est consultable **que depuis le tableau de bord** (sélectionner l'entreprise dans « Favoris » ou une carte, puis section « Data Room ») ; la messagerie dit « Data Room accessible » mais n'y mène pas. Avec zéro document (cas fréquent au début, le vendeur n'ayant rien déposé), l'acheteur voit « Accès accordé » et une liste vide sans message.
- **Visionneuse PDF dépendante d'un CDN tiers** : `pdfjs` charge son worker depuis `cdnjs.cloudflare.com` (`frontend/src/components/SecurePdfViewer.jsx:7`). Ici le CDN est injoignable et le document affiche « Erreur lors du chargement du PDF » (`desktop-61-dataroom-viewer.png`, `05_viewer_net.js` : « Setting up fake worker failed »). En production, tout acheteur derrière un proxy d'entreprise ou un bloqueur qui filtre cdnjs (fréquent dans les groupes du bâtiment) aura la même data room vide. Le worker doit être embarqué dans le build.
- Filigrane = e-mail + horodatage : fonctionnel ; le référentiel v2 prévoyait le nom.
- Offre : modale simple (montant, conditions, validité, message). Rien ne rappelle le prix demandé dans la version messagerie ; pas de structure (part titres/fonds, crédit vendeur, earn-out, conditions suspensives) alors que la LOI en parle. Le montant est ensuite affiché « 1,200,000 € » en format anglais (`backend/server.py:3581`, `:,.0f` sans conversion) dans un tunnel entièrement en français.
- Après acceptation par le vendeur, l'acheteur reçoit un PDF récapitulatif (bon), mais aucune indication sur la suite (avocat, protocole, closing) autre qu'une phrase dans l'e-mail.

### 2.9 Tableau de bord acheteur, favoris, alertes (`desktop-27-buyer-dashboard-verified.png`, `desktop-44-dashboard-selected-company.png`, `desktop-46-alert-modal.png`, `desktop-47-dashboard-alerts-tab.png`, `mobile-27-buyer-dashboard-verified.png`)

- Structure : bandeau KYC, 4 compteurs (Favoris / Alertes / Offres / Acceptées), barre de filtres, « Nouveautés », « Les plus populaires », puis panneau Favoris/Alertes/Offres + détail de l'entreprise sélectionnée. Lisible, mais :
  - « Nouveautés » et « Les plus populaires » affichent **les mêmes six annonces** dans un ordre différent ; le compteur « Acceptées » est vide de sens pour 99 % des utilisateurs ; chaque carte pousse un bouton primaire « Contacter le vendeur » avant même d'avoir lu la fiche.
  - Le détail d'entreprise du tableau de bord est une troisième présentation de l'annonce (après la carte de recherche et la fiche), avec encore d'autres champs (CA, EBITDA, effectif).
  - **Aucun suivi de pipeline** : nulle part l'acheteur ne voit « 3 contacts : 1 en attente de validation, 1 NDA signé, 1 data room ouverte ». C'est la vue dont (a) le consolidateur a besoin (5 dossiers par an, plusieurs en parallèle) ; Acquire.com et même Cessionpme (espace « mes contacts ») la fournissent.
- Alertes : création depuis la barre de filtres (critères repris automatiquement, bon), limite de 5, activation/désactivation, e-mail immédiat à la publication (`trigger_alerts_for_company`). Manques : pas de création d'alerte depuis la recherche publique pour un visiteur (sauf l'état vide des pages SEO), pas de récapitulatif hebdomadaire, e-mail d'alerte avec emoji « 🔔 » et « N/A » possibles.
- Favoris : fonctionnels (cœur sur fiche, cartes et liste), mais un visiteur non connecté est renvoyé à `/login` sans retour.

### 2.10 E-mails reçus par l'acheteur (`buyer-emails.json`, `scratchpad/emails.jsonl`)

Séquence reçue : « Bienvenue sur CessionRGE ! » → « Profil validé par le vendeur » → « Votre code de signature : 260232 » (NDA) → « Votre code de signature : 089055 » (LOI) → « Accès à la data room ouvert ». Ton sobre, français correct, lien « Accéder à mon espace ».

Manques : aucun e-mail de confirmation avec le document signé (NDA, LOI) ; pas d'e-mail « le vendeur vous a répondu » si un message système non lu existe ; pas d'e-mail de refus explicite au-delà de « Réponse du vendeur à votre demande » ; les e-mails ne nomment jamais l'annonce (« une entreprise RGE ») : avec plusieurs dossiers, l'acheteur ne sait pas de laquelle il s'agit.

---

## 3. Par persona : que manque-t-il pour décider, qu'est-ce qui irrite ?

### (a) Groupe consolidateur (5 rachats / an)
- Manque : département, multiple prix/EBITDA, EBITDA sur 3 ans, part du CA liée aux CEE/MaPrimeRénov' et contrats mandataires (saisis, non affichés), carnet de commandes (saisi, non affiché), dates de validité et organisme RGE (saisis, non affichés), motif de vente et accompagnement, type de cession, un teaser PDF exportable, une vue pipeline de ses dossiers, un compte multi-utilisateurs (analyste + dirigeant).
- Irrite : KYC du passeport de l'analyste avant la première question ; LOI à signer au prix demandé avec exclusivité avant tout bilan ; documents avec blancs ; commission acquéreur de 118 k€ HT sur un dossier où il a ses propres conseils ; data room potentiellement vide ; conversations nommées par UUID.
- Verdict : il appellera directement le dirigeant une fois le département connu, ou passera par un cabinet. Le non-contournement de 24 mois sans journal de présentation opposable ne le retiendra pas.

### (b) Artisan qui veut racheter le voisin
- Manque : département / bassin, taille de l'équipe par métier, matériel et véhicules (saisis, non affichés), locaux et bail (saisis, non affichés), prix rapporté à l'EBITDA, ouverture au crédit vendeur, accompagnement du cédant, référent technique RGE qui reste ou non.
- Irrite : la commission à sa charge sur un petit dossier (11 400 € TTC sur 95 000 € = 12 %) ; le NDA de 1 200 mots ; la « validation de profil » par un vendeur qui ne sait pas qu'il s'agit du collègue d'à côté ; un tunnel de 7 étapes pour ce qui est, chez lui, un coup de téléphone.
- Verdict : il repère l'entreprise (secteur + région + effectif suffisent localement) et appelle. La plateforme a servi de petite annonce gratuite.

### (c) Cadre en reconversion
- Manque : récit de l'entreprise, motif de vente, accompagnement, dépendance au dirigeant, ce qu'implique le référent technique RGE (la FAQ le dit, pas la fiche), repères de financement (apport, prêt, crédit vendeur), un « que se passe-t-il ensuite » après l'offre acceptée.
- Irrite : la vérification d'identité sans savoir combien de temps ni si c'est unique ; le vocabulaire (« Demander accès Data Room » pour obtenir le nom) ; la LOI juridique dense à signer pour voir des documents ; l'absence d'exemplaire signé ; aucun humain ni chat pour une question.
- Verdict : c'est le persona le plus réceptif au contenu (guides excellents) et le plus perdu dans le tunnel. Il abandonne à la LOI.

---

## 4. Modèle économique et autonomie : lecture critique

1. **Commission à la charge de l'acquéreur, TTC en tête.** Le choix laissé au cédant est séduisant sur le papier (le cédant « ne paie rien »), mais il reporte le coût sur le côté de la place de marché qu'il faut attirer et qui a le plus d'alternatives (Cessionpme, Fusacq, Bpifrance Transmission, contact direct). Sur les petits dossiers (< 300 k€), 10 % HT soit 12 % TTC est hors marché ; sur les gros, un consolidateur négociera ou contournera. Recommandation : débiteur = cédant par défaut (c'est lui qui a mandaté AlterEgo et bénéficie du service), option « acquéreur » réservée aux prix ≥ 500 k€ et affichée dès la carte de recherche ; afficher HT d'abord pour les comptes « société » (TTC entre parenthèses) ; envisager un forfait plancher simple (ex. 5 000 € HT) plutôt qu'un pourcentage plein sur 95 k€.
2. **Le KYC comme premier filtre coûte et ne rapporte rien.** ≈ 1,50 € HT par vérification, payés pour chaque curieux, zéro revenu acheteur, et c'est le premier abandon. Déplacer la vérification au moment du NDA (quand le vendeur a validé et que l'identité va être révélée) divise le coût par le taux de qualification et supprime la friction au premier message. La promesse « identité vérifiée avant toute révélation » reste vraie ; la promesse « les vendeurs ne sont contactés que par des repreneurs identifiés » devient « par des repreneurs qualifiés (profil) et identifiés avant toute révélation ».
3. **Sans commerciaux, le tunnel doit se vendre seul.** Aujourd'hui trois gates humaines bloquent : validation admin de l'annonce (côté vendeur), validation du profil par le vendeur (sans information), contre-signature de la LOI (non câblée). Pour tourner en autonomie : profil repreneur structuré présenté au vendeur, option « accepter automatiquement les repreneurs vérifiés » côté mandat, relances automatiques à J+2/J+5 et expiration des demandes à J+10 avec e-mail à l'acheteur, et suppression de la LOI comme condition de data room (NDA + KYC suffisent, comme le prévoyait le référentiel v2).
4. **Revenus complémentaires sans effort commercial** (cohérents avec la carte T et un fondateur seul) : (i) dossier de présentation payant côté cédant (teaser + info-mémo généré automatiquement à partir des champs saisis, 149–299 € HT), (ii) « mise en avant » d'annonce (badge, remontée, alerte prioritaire), (iii) accès « pro » pour les consolidateurs (multi-utilisateurs, export CSV, alertes avancées, API) à 99–199 €/mois : ce sont les seuls acheteurs prêts à payer et ils ne paieront jamais 10 % de commission, (iv) apport d'affaires conseils (avocat, expert-comptable, financement) déclenché automatiquement après offre acceptée. Le courtage CEE (v2) est hors parcours acheteur mais reste la piste de revenu la plus rapide.
5. **Coûts de fonctionnement observés** : Stripe Identity (variable, voir 2), Brevo (transactionnel, volumes faibles), hébergement + Mongo, Plausible (optionnel), aucun prestataire de signature (OTP maison : gratuit, mais à faire valider juridiquement : « CessionRGE Signature Électronique » n'est pas un prestataire eIDAS). Le poste à surveiller est le KYC ; tout le reste est marginal.

---

## 5. Bugs réels constatés (reproductibles)

| # | Bug | Preuve | Code |
|---|---|---|---|
| B1 | « Domaines RGE complémentaires » liste des domaines que l'entreprise possède (PV) et promet un accompagnement inexistant | `desktop-09-company-payer-repreneur.png` | `frontend/src/pages/CompanyDetail.jsx:329-343, 555-578` |
| B2 | « Date non renseignée » pour toutes les qualifications alors que `rge_validity` est obligatoire et stocké | `desktop-09…png`, API `/companies` renvoie `rge_validity` | `CompanyDetail.jsx:326`, `CreateListing.jsx:363` |
| B3 | Champs saisis jamais affichés : pipeline, fixed_charges, mandataire_contracts, specialties, equipment, premises | API `/companies` (script `04`/python) | `backend/server.py:211-236`, `CompanyDetail.jsx:589-693` |
| B4 | Après contact d'une 2ᵉ annonce, la messagerie ouvre la 1ʳᵉ conversation | `desktop-51-messages-after-second-contact.png`, log `03_followups.js` | `CompanyDetail.jsx:251`, `MessagesPage.jsx:74` |
| B5 | Deux champs « Nom de l'entreprise » liés au même état pour un acheteur | `desktop-20-register-buyer-form.png` | `RegisterPage.jsx:294-308, 327-341` |
| B6 | NDA/LOI avec blancs et jetons non remplis (`{{DOC_ID}}`, « 1350000.0 € », « fournit oui une attestation », « fourchette € – € ») | `nda-text.txt` l.10-11, 49 ; `loi-text.txt` l.8-9, 32, 68 | `backend/server.py:2616-2669, 4945-5200, 5240-5260` |
| B7 | Message système « signez la LOI » alors que le NDA est requis d'abord | `desktop-33-messages-profile-validated.png` | `backend/server.py:2425` |
| B8 | Visionneuse PDF : worker chargé depuis cdnjs ; data room inutilisable si le CDN est bloqué | `desktop-61-dataroom-viewer.png`, `05_viewer_net.js` | `SecurePdfViewer.jsx:7` |
| B9 | Montant d'offre « 1,200,000 € » (format anglais) | `desktop-43-messages-after-offer.png` | `backend/server.py:3581, 3699` |
| B10 | Favori en visiteur → `/login` sans redirect | log `01_public.js` | `CompanyDetail.jsx:160-165` |
| B11 | Flash d'état périmé (NDA/LOI/data room de la conversation précédente) au changement de conversation | `mobile-33-messages-profile-validated.png` | `MessagesPage.jsx:54-58, 82-93` |
| B12 | Page profil : « Buyer », encart « Documents requis… Kbis » + envoi de fichier contredisant Stripe Identity, rien d'éditable | `desktop-49-profile.png` | `frontend/src/pages/ProfilePage.jsx` |
| B13 | Navigation Précédente/Suivante indépendante de la recherche d'origine (ordre par date) | log `03_followups.js` « 3 / 6 » | `CompanyDetail.jsx:140-149` |
| B14 | Aucun téléchargement ni e-mail du NDA/LOI signés pour l'acheteur | absence d'endpoint ; `buyer-emails.json` | `backend/server.py` (seul `/seller/mandat/{id}/pdf`) |

Non imputables au produit dans cet environnement (à vérifier en production) : Stripe Identity injoignable (erreur CORS/500 sur `/kyc/create-verification-session`), Google Fonts et cdnjs bloqués (`ERR_CERT_AUTHORITY_INVALID`, `ERR_NAME_NOT_RESOLVED`). Ils révèlent néanmoins deux dépendances externes à retirer du chemin critique (polices à auto-héberger, worker PDF à embarquer).

---

## 6. Recommandations hiérarchisées

### Priorité 1 — donner à l'acheteur de quoi décider (S à M)
1. Refondre la fiche et la carte : titre rédigé par le vendeur (60 caractères), accroche, motif de vente, accompagnement proposé, type de cession (titres/fonds), département, dates et organisme RGE (afficher `rge_validity`), carnet de commandes, dépendance CEE/mandataires, matériel, locaux, charges fixes, EBITDA N-1/N-2, multiple prix/EBITDA calculé, débiteur de la commission sur la carte. Supprimer le bloc « Domaines complémentaires » (B1). Ajouter `description`, `sale_reason`, `accompaniment`, `department` au modèle et au formulaire vendeur. Effort M.
2. Fusionner `/search` et `/buyer/search` en une seule page (la publique, enrichie des favoris et de l'alerte quand connecté). Effort S.
3. Masquer ou reformuler les compteurs « 0 » des pages SEO (afficher seulement les activités/régions pourvues, et « Créer une alerte » sur les autres). Effort S.

### Priorité 2 — simplifier et sécuriser le tunnel (M)
4. Profil repreneur à l'inscription (type, budget, zones, financement, horizon, présentation en 300 caractères), présenté pseudonymisé au vendeur avec sa demande ; messages pré-rédigés remplacés par « Présentez votre projet » pré-rempli depuis le profil. Effort M.
5. Déplacer le KYC au moment du NDA (après validation vendeur) ; conserver le KYC immédiat en option pour obtenir un badge « Repreneur vérifié » visible du vendeur. Effort M (déjà prévu au référentiel v2).
6. Ouvrir la data room sur NDA + KYC ; faire de la LOI une **offre indicative rédigée par l'acheteur** (montant, structure titres/fonds, conditions, calendrier) générée depuis un formulaire, signée par les deux parties (câbler la contre-signature) ; retirer l'exclusivité par défaut ou la rendre optionnelle. Effort L.
7. Corriger les gabarits : supprimer les champs non collectés ou les collecter (date de naissance, adresse, société), formater les montants, remplacer les variables de réglage par des valeurs saisies, retirer `{{DOC_ID}}`, `ATTESTATION_FONDS`, cases à cocher. Faire relire par le conseil d'AlterEgo. Ajouter téléchargement PDF + e-mail de l'exemplaire signé à l'acheteur. Effort M.
8. Automatiser la gate vendeur : relances J+2/J+5, expiration J+10 avec e-mail à l'acheteur, option « accepter automatiquement les repreneurs vérifiés » au mandat. Effort M.

### Priorité 3 — messagerie et suivi (S à M)
9. Nommer les conversations (domaine court · région · prix · statut), afficher `sender_label`, ouvrir la conversation du contact qui vient d'être créé (B4), corriger le message système (B7), expliquer le masquage, réinitialiser l'état au changement (B11), rendre la messagerie fluide sur mobile (liste puis fil, pas de hauteur fixe). Effort M.
10. Vue « Mes dossiers » (pipeline) sur le tableau de bord à la place du doublon Nouveautés/Populaires, avec lien direct vers la data room. Effort M.

### Priorité 4 — polish (S)
11. Embarquer le worker pdf.js (B8), auto-héberger les polices, corriger B5, B9, B10, B12, B13 ; harmoniser le lancement du KYC (même onglet, message d'erreur actionnable) ; nommer l'annonce dans chaque e-mail ; retirer « Nombre de vues » du public ; retirer le compteur « Acceptées ».

### Modèle (décision fondateur)
12. Cédant débiteur par défaut, acquéreur en option au-dessus de 500 k€ seulement, HT en tête pour les comptes société, plancher forfaitaire simple sur les petits dossiers ; monétiser les consolidateurs par un abonnement « pro » et les cédants par un dossier de présentation / mise en avant payants ; garder l'OTP maison pour le NDA mais faire valider sa valeur probante, ou passer la LOI/offre sur un prestataire eIDAS quand le volume le justifiera.

---

## 7. Annexe — journal de test (extraits)

- `01_public.js` : 6 annonces trouvées ; tri prix croissant correct ; filtre Bretagne → 1 ; « commission notice (repreneur) : 141 600 € TTC (118 000 € HT), 8,74 % HT » ; « fiche contient raison sociale ? false » ; visiteur contact → `/login?redirect=…` ; visiteur favori → `/login`.
- `02_buyer.js` : inscription → `/buyer/dashboard` ; KYC dashboard → « Erreur lors du démarrage de la vérification » (Stripe injoignable) ; non vérifié → bandeau KYC ; contact → `/messages` ; masquage coordonnées : MASQUÉ ; NDA 8 286 car./1 194 mots, blancs « né(e) le , » ; mauvais code → message clair ; identité révélée après NDA ; LOI 7 166 car./1 037 mots, débiteur « l'acquéreur (repreneur) » ; LOI signée → « Data Room accessible » ; offre envoyée ; alerte créée.
- `03_followups.js` : état correct après 2,5 s ; contact ISOL → conversation affichée SOLEIL (bug B4) ; NDA mobile 7 565 car., zone document 338 px ; upload data room 200.
- `04_dataroom.js` / `05_viewer_net.js` : « Consulter » présent, filigrane « ux-acheteur-1@test.fr | 09/10/2026 14:18 UTC », worker pdf.js cdnjs `ERR_NAME_NOT_RESOLVED` → « Erreur lors du chargement du PDF ».
- Poids : `main.701e80fb.js` 609 Ko non compressé + chunk 308 Ko (lecteur PDF), acceptable.
