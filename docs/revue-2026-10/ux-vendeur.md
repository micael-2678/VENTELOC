# Audit UX / produit — parcours VENDEUR (cédant) de CessionRGE

Audit en lecture seule, réalisé dans le navigateur (Chromium / Playwright) sur le build de production
(`http://127.0.0.1:3000`) et l'API (`http://127.0.0.1:8001/api`), desktop 1400×900 et mobile 390×844.
Dossier des captures, scripts et journaux : `docs/revue-2026-10/ux-vendeur/`
(ci-dessous, « captures/ » désigne ce dossier). Code : `/home/user/Cession-rge/`.

Comptes créés pour l'audit : `ux-vendeur-auditA-4986@test.fr` (Jean Martin, non dirigeant), `ux-vendeur-auditB-4986@test.fr`
(Michel Dupont, dirigeant reconnu), `ux-vendeur-auditC-4986@test.fr` (inscrit sans annonce, pour les relances), plus le compte
seed `vendeur@test.fr` enrichi par le parcours acheteur (`journey.js`) pour voir un tableau de bord « vivant ».

Scripts : `captures/s1-public.js` (accueil, inscription), `s2-seller-flow.js` + `s2b-mandate.js` (annonce, KYC, mandat, refus,
dirigeant), `s3-dashboard-activity.js` (messages, accès, offres, relances), `s4-mobile-checks.js` (mesures mobile).
Journaux : `captures/*.log`. Texte du mandat généré : `captures/mandat-texte.txt`. PDF signé : `captures/mandat-signe.pdf`.

Limite d'environnement : `data.ademe.fr`, `recherche-entreprises.api.gouv.fr` et Stripe ne sont pas joignables ici (proxy 403).
C'est précisément ce que verra un cédant le jour où ces services sont lents ou en panne : j'ai donc traité ces écrans comme des
cas réels de « service indisponible », pas comme des artefacts.

---

## 1. Verdict sincère

Le produit est **techniquement sérieux** (aucune erreur JS, aucun 5xx sur tout le parcours, e-mails à chaque étape, signature par
code, registre des mandats, masquage des coordonnées) mais **le parcours cédant, tel qu'il est, ne convertira pas un artisan seul
sur son téléphone**. Il empile cinq filtres avant la moindre récompense : SIRET validé par l'ADEME (bloquant, sans secours),
vérification d'identité Stripe, 13 champs financiers en jargon de banquier sans sauvegarde, un **mandat exclusif de 12 mois à
10 % HT signé avant d'avoir vu un seul repreneur**, puis une validation manuelle par Micael « sous 48 h ». Chacun de ces filtres
divise l'entonnoir ; ensemble, ils le ferment. Et le point faible n'est pas le design (propre, lisible sur desktop) mais
l'**ordre des étapes et la quantité d'engagement demandée avant toute preuve de valeur**.

Trois constats bloquent à eux seuls un lancement autonome :
1. **La messagerie vendeur mélange tous les acquéreurs d'une même annonce dans un seul fil, sans nom d'expéditeur, et la réponse
   du vendeur part au premier acquéreur trouvé** — vérifié avec deux acquéreurs réels : la réponse à « Claire » serait envoyée à
   « buyer SAS ». C'est le moment où la plateforme crée de la valeur, et il est cassé dès le 2e contact.
2. **L'inscription vendeur est impossible si l'ADEME ne répond pas ou si le SIRET n'y figure pas** (bouton grisé, message
   « SIRET non trouvé » même en cas d'erreur réseau) : un point de défaillance unique sur la seule porte d'entrée du côté rare de
   la place de marché.
3. **Le mandat signé est juridiquement fragile et commercialement brutal** : objet non déterminé (cases ☐ non cochées,
   dénomination et adresse vides quand l'ADEME est en panne), exclusivité 12 mois sans résiliation en ligne, estimation
   « 33 600 € TTC » affichée en gros à un cédant qui n'a encore rien reçu, et l'annonce peut ensuite être refusée alors que le
   mandat reste signé.

Ce qui marche et doit être conservé : le brouillon avant KYC, la page mandat (pédagogie, choix du débiteur, estimation, récap,
mauvais code géré), le barème marginal centralisé (`frontend/src/lib/offer.js`), la pseudonymisation et le masquage des
coordonnées, les relances automatiques J+3, l'onglet Accès.

---

## 2. Le parcours, écran par écran

### 2.1 Arrivée sur l'accueil — pourquoi un cédant s'inscrirait-il ?

Captures : `01-home-fold-desktop.png`, `01-home-fold-mobile.png`, `01-home-desktop.png`, `01-home-mobile.png` (10 627 px de haut
sur mobile), `04c-steps-viewport-mobile.png`, `04-pricing-*.png`, `04b-pricing-viewport-mobile.png`.

- Le hero est **orienté repreneur** : la moitié droite (desktop) et le bloc juste sous les CTA (mobile) est un formulaire de
  recherche « Trouver une entreprise à reprendre ». Le cédant, lui, n'a qu'un bouton « Je vends mon entreprise » qui envoie
  **directement sur `/register`** (vérifié : clic → `http://127.0.0.1:3000/register`), c'est-à-dire sur un formulaire de compte
  sans page intermédiaire de réassurance. La page `/vendre-mon-entreprise-rge` existe (1 270 mots, bien écrite) mais n'est
  atteinte que par le menu « Vendre » ou le CTA du bas de page.
- Aucune **preuve sociale** nulle part : ni nombre de repreneurs inscrits, ni nombre d'annonces, ni témoignage, ni visage du
  fondateur, ni mention d'AlterEgo/carte T sur l'accueil (elle n'apparaît qu'au mandat). Pour un artisan qui va confier CA,
  EBITDA et dettes, la question « qui êtes-vous ? » reste sans réponse.
- La promesse « Créez votre annonce anonyme en 10 minutes » (étape 1 de « Comment ça marche ») est fausse au regard du formulaire
  réel (cf. 2.4) et l'étape 2 « Si vous êtes le dirigeant, votre annonce est publiée immédiatement » omet le mandat obligatoire.
- **Bug mobile** : la carte « Cédants » de la section tarifs déborde de l'écran (mesuré : bord droit à 457 px pour un viewport de
  390 px, `s4-mobile-checks.log`) ; les puces et le barème sont tronqués (« Commission uniquement en cas de vente, pa… », « 12 %
  TTC (10 % … »). Cause : `whitespace-nowrap` sur le tag « Au succès » (`frontend/src/pages/LandingPage.jsx:601`) et tableau
  dans une carte sans `min-w-0` (`frontend/src/components/seo/Content.jsx:49-59`). Capture `04b-pricing-viewport-mobile.png`.
- L'affichage « 12 % TTC (10 % HT) » en premier, sur une page B2B, fait paraître la commission 20 % plus chère qu'elle n'est pour
  une société soumise à TVA. Le rapport v2 (`docs/business-model-v2-rapport-ecarts.md`, point 7) l'avait déjà noté.

### 2.2 Inscription vendeur

Captures : `05-register-seller-form-{desktop,mobile}.png`, `06-register-seller-siret-{desktop,mobile}.png`, `07-login-*.png`.
Code : `frontend/src/pages/RegisterPage.jsx`, `backend/server.py:480-520`.

Champs : Je suis, Prénom, Nom, Email, Mot de passe, SIRET (obligatoire pour un vendeur), Nom de l'entreprise, Téléphone,
« Comment nous avez-vous connus ? ». Pas de case RGPD (un texte sous le bouton suffit pour un traitement nécessaire au contrat,
c'est acceptable), pas d'affichage/masquage du mot de passe, pas d'indicateur de robustesse (seulement « 8 caractères minimum »).

- **Blocage SIRET** : le bouton « Créer mon compte » est désactivé tant que `rgeVerified !== true`
  (`RegisterPage.jsx:378`). En cas d'erreur réseau, le `catch` fait `setRgeVerified(false)` (`:85`) et l'écran affiche
  « Ce SIRET n'a pas été trouvé dans la base RGE. Vérifiez le numéro ou contactez-nous si votre certification est récente. »
  (capture `06-register-seller-siret-desktop.png`). L'artisan croit s'être trompé, ressaisit, et abandonne. Aucune voie
  « continuer quand même, nous vérifierons plus tard ». Les entreprises dont la qualification vient d'être obtenue, les SIRET
  d'établissement secondaire, ou simplement une panne de `data.ademe.fr`, ne peuvent pas s'inscrire.
- L'**e-mail n'est jamais vérifié** (compte actif immédiatement, `server.py:480-517`) alors que c'est l'adresse qui recevra le
  **code qui « vaut signature »** du mandat. Une faute de frappe dans l'e-mail = mandat impossible à signer, et une preuve de
  signature adossée à une adresse non confirmée.
- Erreur « Un compte existe déjà avec cet email » correcte (toast). Page de connexion sobre, lien « Mot de passe oublié » présent.

### 2.3 Tableau de bord vide et bandeau KYC

Captures : `10-dash-new-unverified-{desktop,mobile}.png`, `11-dash-kyc-click-*.png`, `13-kyc-dialog-*.png`,
`13b-kyc-dialog-error-*.png`, `40-profile-desktop.png`. Code : `frontend/src/pages/SellerDashboard.jsx:417-455`,
`frontend/src/components/KYCVerification.jsx`, `frontend/src/pages/ProfilePage.jsx`.

- Un compte neuf voit : bandeau ambre « Vérification d'identité requise — Complétez votre vérification KYC pour pouvoir publier
  des annonces », un titre « Jean Martin / Bienvenue sur votre espace vendeur », 4 compteurs à zéro, « Aucune annonce »,
  « Sélectionnez une annonce pour voir les détails ». Il n'y a **aucun guide « par où commencer »** ; l'acronyme **KYC** n'est pas
  expliqué ; un artisan de 58 ans ne sait pas ce que c'est.
- **Bandeau KYC cassé sur mobile** : `flex items-center justify-between` sans passage en colonne (`SellerDashboard.jsx:419`) ;
  le texte est compressé dans une colonne de 120 px à côté du bouton (capture `10-dash-new-unverified-mobile.png`). Le bandeau
  mandat, lui, est responsive (`:398`) — le KYC ne l'est pas.
- Le bouton « Vérifier mon identité » du dashboard fait un `window.open` puis affiche « Redirection vers la vérification
  d'identité Stripe… » **avant** la réponse ; si l'appel échoue, aucun message n'est apparu pendant 1,5 s (`s2-seller-flow.log`,
  A2) et le message d'erreur est arrivé plus tard, par-dessus un autre écran (A5). Sur mobile, un `window.open` est souvent bloqué.
- Le dialogue KYC du formulaire d'annonce (capture `13-kyc-dialog-mobile.png`) est bon : 3 étapes, mention de Stripe, clair.
- La page **Profil** contredit tout cela : elle propose un KYC manuel « Documents requis : pièce d'identité, justificatif de domicile,
  Kbis » avec un bouton d'envoi, alors que le compte est déjà « Vérifié » par Stripe (capture `40-profile-desktop.png`). Rôle
  affiché « Seller » en anglais, avatar « U » (initiale de l'e-mail).

### 2.4 Création de l'annonce

Captures : `12-create-listing-empty-{desktop,mobile}.png` (3 307 px de haut sur mobile), `14-create-listing-filled-*.png`,
`15-after-submit-draft-*.png`. Code : `frontend/src/pages/CreateListing.jsx`, `backend/server.py:211-236` (modèle),
`:1530-1555` (création).

Inventaire : 13 champs `required`, 15 saisies/sélecteurs, 18 cases de domaines RGE, 4 blocs. Ordre : Charger le SIRET (ADEME) →
Domaines RGE + date de fin de validité → Données financières (CA N, N-1, N-2, EBITDA, Marge brute %, Endettement) → Informations
entreprise (date de création, effectif, structure juridique, région) → Conditions de vente (prix, type, pipeline).

Ce qui fait abandonner :
- **Jargon sans aide** : « EBITDA (€) », « Marge brute (%) », « CA N-2 », « Endettement », « Pipeline / CA signé ». Aucune
  info-bulle, aucun exemple, aucune option « je ne sais pas / à préciser avec mon comptable ». Un artisan a son bilan chez
  l'expert-comptable ; il quittera la page pour le chercher.
- **Pas de sauvegarde** : aucun `localStorage`, aucun brouillon côté serveur avant le bouton final (grep `localStorage` dans
  `CreateListing.jsx` : 0). Sur mobile, un appel ou un changement d'application efface 20 minutes de saisie.
- **Aucune validation métier** : l'API a accepté marge brute 250 %, endettement −5 000 €, CA N-2 = 0, SIRET non vérifié et
  dénomination vide (`s2-seller-flow.log`, A7/A8 ; modèle `CompanyCreate` sans contraintes, `server.py:211-236`).
- **Champs demandés puis jamais utilisés** : `rge_validity` (obligatoire) n'est affiché nulle part côté acquéreur (la fiche affiche
  « Date non renseignée » pour chaque qualification, `CompanyDetail.jsx:533`, capture `34-my-listing-public-view-desktop.png`) ;
  `pipeline` n'est pas affiché non plus. Champs morts dans l'état React, jamais rendus : `mandataire_contracts`, `specialties`,
  `equipment`, `premises`, `fixed_charges` (salaires, loyer, assurance, matériel) — envoyés à 0.
- **Pas de texte libre à la création** : la « Description » n'existe qu'en modification (capture `38-dash-edit-mode-desktop.png`).
  L'annonce publiée s'intitule « Entreprise de rénovation énergétique » (`CompanyDetail.jsx:429`) sans un mot sur l'histoire, les
  atouts, la raison de la vente.
- **Champs manquants pour une entreprise RGE**, ceux qu'un repreneur demandera dès le premier message : assurance décennale
  (assureur, activités couvertes, sinistralité), référent technique RGE (reste-t-il ?), organismes qualificateurs
  (Qualibat, QualiPAC, QualiPV…) et dates par qualification, carnet de commandes en mois, part de CA liée aux aides
  (MaPrimeRénov'/CEE) et aux mandataires, parc matériel et véhicules, locaux (propriétaire/locataire), masse salariale,
  raison de la cession, accompagnement proposé, horizon de vente.
- Les mappings ADEME → catégories oublient `pac_air_air`, `solaire_combine` (`CreateListing.jsx:119-135`) ; le bouton « Charger »
  en panne affiche « SIRET non trouvé dans la base RGE » (même confusion qu'à l'inscription).
- Bon point : le brouillon avant KYC (« Votre annonce sera enregistrée en brouillon et soumise dès que votre identité sera
  vérifiée ») et la soumission automatique après vérification (`server.py:1518-1528`, `:4043-4053`, vérifié : A9/A10) sont bien pensés.

Temps : le script, qui sait toutes les réponses, met 72 s. Un artisan qui doit retrouver trois CA, un EBITDA, une marge, une
dette et une date de validité RGE : 20 à 40 minutes, en plusieurs fois, sans sauvegarde.

### 2.5 Du brouillon au mandat

Après validation KYC (simulée côté admin), les deux brouillons passent `mandat_en_attente` et le vendeur reçoit « Dernière étape :
signez votre mandat » (lien profond, bon). Le dashboard affiche un bandeau ambre « Un mandat à signer avant la publication » + badge
« Mandat à signer » + bouton sur la carte (capture `16-dash-mandate-banner-desktop.png`, `22-dash-pending-desktop.png`).

Note : si le vendeur n'a pas été reconnu dirigeant, le bandeau bleu dit « Identité vérifiée — vous pouvez publier des annonces »
alors que l'annonce ira en file admin : promesse contredite deux écrans plus loin.

### 2.6 Page mandat et signature

Captures : `17-mandate-page-{desktop,mobile}.png`, `18-mandate-payer-chosen-desktop.png`, `19-mandate-dialog-{desktop,mobile}.png`,
`19b-mandate-dialog-bottom-mobile.png`, `20-mandate-otp-wrong-desktop.png`, `21-mandate-signed-desktop.png`,
`30-mandate-dupont-mobile.png`, `33-mandate-signed-dupont-mobile.png`. Texte : `captures/mandat-texte.txt`.
Code : `frontend/src/pages/MandatePage.jsx`, `frontend/src/components/OtpSignatureDialog.jsx`, `backend/server.py:4806-4960`
(modèle), `:5554-5650` (génération), `:5653-5745` (signature).

Ce qui est bien : titre et chapeau clairs (« La loi impose un mandat écrit… commission due uniquement en cas de vente… code reçu
par e-mail »), résumé de l'annonce, deux cartes radio « Je paie / L'acquéreur paie » avec estimation TTC puis HT, note
« rien n'est payé avant la signature de l'acte », bouton désactivé tant qu'aucun choix, récap du choix dans la modale avec
« Modifier mon choix », mauvais code → message propre « Code invalide ou expiré », numéro de registre, PDF, ligne « Mandat n° 7 —
commission à la charge du cédant » sur le dashboard. C'est l'écran le mieux conçu du parcours.

Ce qui ne va pas :
- **Le moment** : le cédant signe un **mandat exclusif de 12 mois** (`DUREE_MANDAT_MOIS = 12`, `server.py:5249`, art. 3 « ne pas
  négocier directement… ») avant d'avoir vu un seul repreneur, sans savoir combien de repreneurs cherchent dans sa région, et il
  voit en gros « ≈ 33 600 € TTC (28 000 € HT) » sur un prix de 280 000 € (EBITDA 85 k€ : c'est 4 mois de résultat). Rien ne
  dit qu'il peut résilier, ni comment (art. 2 : lettre recommandée, préavis 30 jours ; aucune fonction dans l'interface).
- **Objet du mandat non déterminé** : « ☐ 100% des titres de la société  (share deal) / ☐ Le fonds de commerce… » — deux cases
  **jamais cochées** alors que `sale_type` est connu (`mandat-texte.txt`, art. 1). Avec l'ADEME en panne : « Société : » vide,
  SIREN/SIRET présents mais « Siège social : Bretagne », « Personne morale / Jean Martin » **sans adresse** (le modèle
  `UserRegister` n'a pas d'adresse ; `VENDEUR_ADRESSE_COMPLETE` = `current_user.get("address", "")`, `server.py:5593`).
  « Représentée par Romane DA SILVA RIBEIRO, Présidente » apparaît **deux fois**. « Via CessionRGE Signature Électronique »
  (prestataire inexistant). Un mandat Hoguet sans identification complète du mandant ni objet déterminé est attaquable.
- **Lecture** : 869 mots / 137 lignes dans une boîte de 360 px (330 px sur mobile, capture `19-mandate-dialog-mobile.png`), et la
  case « J'ai lu et j'accepte » est cochable **sans avoir fait défiler le document** (`s2b-mandate.log`, A13 : scrollTop=0,
  état `checked`). Aucun résumé en 5 lignes (durée, exclusivité, commission, résiliation, clause de suite).
- Après signature, si l'annonce est ensuite **refusée** par l'admin (testé : A18/A19, capture `24-dash-rejected-mobile.png`), le
  vendeur garde un mandat exclusif signé et une annonce « Refusée » **sans motif** ; l'e-mail « Votre annonce n'a pas été publiée »
  dit « Répondez à cet email ou contactez-nous pour en connaître la raison ». Ni le dashboard ni l'e-mail ne donnent la raison,
  et rien ne libère le vendeur de son mandat.
- La signature exige `is_user_verified` (`server.py:5675`) : logique, mais l'e-mail qui porte le code n'a, lui, jamais été
  confirmé (cf. 2.2).
- Le PDF (3 pages, `text_to_pdf`, `business_model.py:348-362`) est un simple flux de paragraphes : pas de bloc de signature
  horodaté, pas d'empreinte visible, pas de mention du code/IP alors que ces preuves existent en base (`signature_evidence`).

### 2.7 Après la signature

- Vendeur « dirigeant reconnu » (nom = dirigeant INPI) : publication immédiate, écran « Votre annonce est en ligne — Voir mon
  annonce / Aller à mon espace vendeur » (capture `33-mandate-signed-dupont-mobile.png`). Parfait.
- Vendeur non reconnu : « Notre équipe vérifie votre annonce — en général sous 48 h » (capture `21-mandate-signed-desktop.png`),
  e-mail « Votre annonce a bien été reçue » qui dit « Pour une publication immédiate, vérifiez votre identité puis votre qualité de
  dirigeant depuis votre espace, ou invitez le président » — **aucun de ces deux liens n'existe dans l'espace vendeur** (la
  vérification dirigeant n'est déclenchée que dans le formulaire d'annonce, après chargement ADEME). Le dashboard montre « En
  validation » sans date ni explication. Avec l'ADEME ou l'API gouv indisponibles, **tout le monde** finit en file admin : ce n'est
  pas un business autonome, c'est Micael qui valide à la main.
- Ordre des e-mails pour le dirigeant : « Votre annonce est en ligne ! » arrive **avant** « Votre mandat n° 8 est signé »
  (`s2b-mandate.log`). Détail, mais déroutant.
- Le vendeur peut **modifier prix, CA, EBITDA… d'une annonce publiée sans revalidation ni notification** (`server.py:1879-1898`,
  aucun e-mail `listing_modified` n'est envoyé — grep : 0 appel). Il ne peut en revanche **ni retirer, ni archiver, ni marquer
  vendue** son annonce : seuls des badges existent (`SellerDashboard.jsx:287-288`), l'endpoint `/status` est admin.

### 2.8 Tableau de bord en activité

Captures : `50-dash-active-overview-{desktop,mobile}.png`, `51-dash-access-tab-mobile.png`, `52-dash-offers-tab-desktop.png`,
`53-dash-dataroom-log-*.png`, `39-dash-dataroom-desktop.png`, `37-tab-*-mobile.png`, `54-messages-{desktop,mobile}.png`,
`55-messages-thread-mobile.png`. Code : `SellerDashboard.jsx`, `MessagesPage.jsx`, `server.py:3188-3204`.

- Structure : 4 compteurs (Annonces, Publiées, Vues, Contacts) qui prennent tout le premier écran mobile, liste « Mes annonces »,
  puis un panneau à 5 onglets (Aperçu, Photos, Data Room, Offres, Accès) **uniquement après avoir cliqué sur une annonce**. Sur
  mobile, la pastille rouge « 1 » de l'onglet Accès est le seul signal qu'un repreneur attend : elle est à 1 600 px du haut.
  Aucune « boîte de réception » d'actions (X demandes d'accès, Y offres, Z messages non lus) en tête de page.
- **Onglet Accès** : bien fait (« Demandes en attente », « Accès accordés », « Processus d'accès sécurisé » en 5 étapes,
  Valider/Refuser/Révoquer). Mais le repreneur n'est qu'un pseudonyme « Acquéreur n°898387 » **sans aucun élément de profil**
  (métier, région, budget, financement, message) : le cédant doit valider à l'aveugle, ou aller chercher dans la messagerie.
- **Onglet Offres** : lisible, conditions affichées, Accepter/Refuser. L'acceptation passe par un `confirm()` natif et promet « Un
  document PDF récapitulatif sera généré » sans expliquer ce que cela engage.
- **Onglet Photos** : les photos envoyées sont rendues par une **icône grise** (`SellerDashboard.jsx:748-752`, pas de `<img>`),
  et la notion de photo pour une annonce anonyme n'est pas expliquée (une façade de camion = identité révélée).
- **Data Room** : 9 catégories claires, filigrane et journal d'accès : bon. Le texte « accessibles après validation de leur profil et
  signature de la LOI » est le bon niveau d'explication.
- **Messagerie — bug critique** : les conversations sont groupées **par annonce** et non par acquéreur
  (`server.py:3188-3204`, `MessagesPage.jsx:372-385` « Entreprise #6254b590 »). Avec deux acquéreurs (buyer SAS, Claire), le
  vendeur voit **un seul fil** où se mélangent les messages des deux, **sans nom d'expéditeur dans les bulles** (`sender_label`
  renvoyé par l'API mais jamais rendu — grep dans `MessagesPage.jsx` : 0), et sa réponse part au **premier « autre » trouvé**
  (`MessagesPage.jsx:101-108`). Vérifié par calcul sur les données réelles (`s3-dashboard-activity.js`) : une réponse à Claire
  irait à buyer SAS. Capture `54-messages-desktop.png` : le message « plombier-chauffagiste à Rennes » de Claire apparaît dans le
  fil de buyer SAS. Côté acquéreur, chacun ne voit que ses messages (filtre API) ; la fuite n'est donc pas entre acquéreurs,
  mais le vendeur est aveugle.
- Messagerie, détails : le fil s'appelle « Entreprise #6254b590 » (le vendeur ne voit même pas le nom de sa propre entreprise),
  « 395,000 € » formaté à l'anglaise dans le message système d'offre, masquage des coordonnées fonctionnel (« Mon [coordonnées
  masquées] si vous préférez »).
- Titre « Espace Vendeur » dès que le prénom manque (`SellerDashboard.jsx:461-464`), « Bienvenue sur votre espace vendeur » sans
  contenu.

### 2.9 E-mails reçus par le vendeur

Source : `emails.jsonl` (scratchpad), modèles `backend/business_model.py:366+`, listes dans `s2b-mandate.log` et
`s3-dashboard-activity.log`.

Séquence réelle d'un vendeur non dirigeant : Bienvenue → Annonce enregistrée en brouillon (×2) → Dernière étape : signez votre
mandat (×2) → Code de signature (×2) → Votre annonce a bien été reçue → Votre mandat n° 7 est signé → Votre annonce n'a pas été
publiée. Puis, en activité : Nouveau contact → Nouvelle demande d'accès → Nouvelle signature NDA → Nouvelle signature LOI →
Nouvelle offre reçue. Relance J+3 sans annonce : « Votre annonce de cession en 10 minutes » (vérifiée via `/admin/jobs/run`).

- Ton : correct, court, sans faute, signature « L'équipe CessionRGE ». Bien : le code « vaut signature », « Même une réponse
  courte compte » (seller_reminder), la relance « sans annonce ».
- Faiblesses : « Bonjour seller SAS » quand le prénom manque (`display_name` retombe sur la raison sociale) ; **aucun lien profond**
  sauf pour le mandat (« Connectez-vous à votre espace » partout) ; « Nouveau contact » ne contient ni le pseudonyme ni le premier
  message ; « Nouvelle offre reçue » donne le montant mais pas les conditions ; e-mail de refus **sans motif** ; aucune relance
  **mandat non signé** adaptée au mobile (c'est le même e-mail que le premier) ; aucun bilan hebdomadaire (vues, contacts) qui
  entretiendrait la confiance pendant les semaines sans contact ; aucune relance « annonce en validation depuis 48 h » vers l'admin.

---

## 3. Dans la peau d'un artisan de 58 ans, pressé, sur mobile

1. Il arrive de Google ou d'un confrère, lit « Cédez ou reprenez… en toute confidentialité ». Le premier bloc utile sous le hero est
   un moteur de recherche pour repreneurs. Il appuie sur « Je vends mon entreprise » → formulaire de compte, sans savoir qui est
   derrière ni ce qu'on va lui demander. **Premier décrochage** (il voulait « voir »).
2. Il tape son SIRET. Si l'ADEME répond : bravo, son entreprise s'affiche (très bon moment). Si l'ADEME traîne ou qu'il est inscrit
   sous un autre établissement : « SIRET non trouvé », bouton gris, fin. **Deuxième décrochage, définitif.**
3. Dashboard : « Vérification d'identité requise — KYC ». Il ne sait pas ce qu'est un KYC, le bandeau est cassé sur son écran, le
   bouton ouvre un onglet Stripe (ou pas). **Troisième décrochage.**
4. Formulaire : il coche ses domaines, puis « EBITDA », « Marge brute % », « CA N-2 », « Endettement », « Date de fin de validité RGE ».
   Il n'a pas ces chiffres sous la main ; il ferme pour appeler son comptable ; au retour, tout est vide. **Quatrième décrochage.**
5. S'il va au bout : « Signez votre mandat de vente », « 33 600 € TTC », exclusivité 12 mois, 137 lignes à lire dans une boîte de
   330 px, puis aller chercher un code dans ses mails. Il n'a encore vu **aucun repreneur**. **Cinquième décrochage**, le plus
   rationnel.
6. S'il signe : « Notre équipe vérifie votre annonce sous 48 h ». Deux jours de silence.

Nombre d'écrans pour publier (non dirigeant) : accueil → inscription → dashboard → formulaire → dialogue KYC → Stripe (3 écrans) →
retour → dashboard → page mandat → modale → messagerie e-mail → écran signé → dashboard « En validation » → attente admin → e-mail
« en ligne » : **14 écrans, 2 changements d'application (Stripe, e-mail), 1 attente humaine.**

---

## 4. Frictions légales : le mandat avant tout acquéreur — acceptable ? comment l'adoucir

Le mandat écrit préalable est imposé par la loi Hoguet à un titulaire de carte T dès qu'il diffuse et s'entremet : le principe
est juste, et le rapport v2 l'a bien vu. Ce qui n'est pas acceptable, c'est **la forme actuelle de l'engagement** : exclusif, 12 mois,
tacite reconduction, résiliation par recommandé, objet non coché, signé à l'aveugle sans aucune donnée sur la demande.

Pistes pour l'adoucir sans sortir du cadre (à faire valider par le conseil d'AlterEgo) :
- **Mandat non exclusif ou « semi-exclusif plateforme »** (le cédant garde le droit de vendre à un acquéreur trouvé par lui-même,
  la commission ne portant que sur les acquéreurs présentés par CessionRGE, avec clause de suite 24 mois) ; durée 6 mois ;
  **résiliation en un clic** depuis l'espace vendeur, avec préavis court. Un cédant qui sait qu'il peut partir signe plus vite.
- **Montrer la demande avant la signature** : « 14 repreneurs vérifiés cherchent une entreprise PAC/isolation en Bretagne, budget
  médian 350 k€ » (données déjà en base : alertes et profils acheteurs). C'est la seule vraie réassurance.
- **Signer dans le même geste que l'annonce** : un écran unique « Récapitulatif → Mandat (résumé 5 lignes + texte dépliable) →
  Code », pas un circuit séparé via le dashboard.
- **Résumé contractuel obligatoire** au-dessus du texte intégral : durée, exclusivité, commission (HT d'abord pour une société),
  qui paie, résiliation, clause de suite ; cases d'objet pré-cochées depuis `sale_type` ; adresse du mandant collectée dans le
  flux ; blocage de la case « j'ai lu » tant que le document n'a pas été parcouru.
- **Lier le mandat au sort de l'annonce** : refus de l'annonce = mandat caduc (ou résiliable) automatiquement, avec motif.

---

## 5. Modèle économique : ce qui ne marchera pas tel quel (sincèrement)

- **Le côté rare (cédants) supporte toute la friction.** Un marché biface se lance en subventionnant le côté rare ; ici on lui
  impose le KYC, 13 champs, un mandat exclusif et une validation humaine, alors que les repreneurs ont une recherche libre sans
  compte. L'inverse serait plus logique : annonce vendeur ultra-courte et immédiate, qualification forte des repreneurs (déjà en
  place).
- **12 % TTC affiché en premier** sur des cessions de 100-400 k€ est dissuasif ; HT d'abord pour les sociétés (la quasi-totalité des
  mandants sont des personnes morales : `VENDEUR_TYPE_PERSONNE` = « Personne morale » dès qu'un `company_name` existe).
- **Côté acquéreur, « Commission à la charge de l'acquéreur : 81 120 € TTC » en bandeau jaune en tête d'annonce** (capture
  `34-my-listing-public-view-desktop.png`) est la première information lue : c'est honnête, mais il faudrait au minimum HT d'abord
  et un lien « comment c'est calculé ». Le choix « l'acquéreur paie » devrait être déconseillé par défaut (ou réservé aux cessions
  > 500 k€) : il tue la demande sur l'annonce.
- **Le revenu dépend d'un closing déclaré volontairement** (`POST /closing/declare`) : rien ne détecte une vente conclue hors
  plateforme. Pour un business sans commerciaux, il faut une détection automatique peu coûteuse (surveillance des changements de
  dirigeant/bénéficiaires au SIREN via l'API gouv, gratuite ; relance automatique « avez-vous vendu ? » à J+90/J+180 ; clause de
  suite rappelée dans la LOI — déjà présente).
- **Validation admin manuelle** (non dirigeant, ou API externes en panne) = coût humain récurrent et délai de 48 h qui tue
  l'élan. Rendre la publication immédiate (teaser anonyme, aucune donnée identifiante) et ne mettre en file admin que la
  **révélation d'identité / l'ouverture de la data room**.
- Coûts : Stripe Identity (~1,50 $/vérif) n'est engagé qu'au moment utile côté vendeur (après la saisie), c'est bien ; le vrai
  coût caché est le temps de Micael (validation, refus, support « SIRET non trouvé », mandats à résilier par courrier).
- Pistes de revenus complémentaires compatibles avec la carte T (à valider par le conseil) : rapport de valorisation automatisé
  vendu comme prestation distincte (pas une somme perçue « au titre de l'entremise »), mise en avant d'annonce auprès des alertes
  repreneurs, et surtout le courtage CEE déjà identifié dans le rapport v2 comme revenu le plus rapide.

---

## 6. Constats hiérarchisés

| # | Gravité | Constat | Preuve | Recommandation | Effort |
|---|---|---|---|---|---|
| 1 | Critique | Messagerie vendeur : un fil par annonce, tous les acquéreurs mélangés, sans nom d'expéditeur, réponse envoyée au premier acquéreur trouvé | `server.py:3188-3204`, `MessagesPage.jsx:101-108, 372-385`, `54-messages-desktop.png`, `s3-dashboard-activity.log` | Grouper par (annonce, acquéreur) côté API, afficher `sender_label` sur chaque bulle, `receiver_id` = l'acquéreur du fil | M |
| 2 | Critique | Inscription vendeur impossible sans réponse ADEME ; erreur réseau affichée comme « SIRET non trouvé » ; aucune voie de secours | `RegisterPage.jsx:80-85, 378`, `06-register-seller-siret-desktop.png` | Distinguer « introuvable » / « service indisponible » ; autoriser l'inscription avec vérification RGE différée (badge « en cours ») ; retenter en arrière-plan | S |
| 3 | Critique | Mandat exclusif 12 mois signé avant toute preuve de demande, estimation TTC en gros, pas de résiliation en ligne, annonce refusable après signature sans libérer le mandat | `MandatePage.jsx`, `server.py:5249`, `mandat-texte.txt` art. 1-3, `24-dash-rejected-mobile.png`, `17-mandate-page-desktop.png` | Mandat non exclusif / 6 mois / résiliable en un clic ; montrer la demande (repreneurs actifs) avant signature ; refus = mandat caduc ; HT d'abord | M |
| 4 | Critique | Contrat de mandat incomplet : cases d'objet ☐ non cochées, dénomination et adresse du mandant vides, « Représentée par » en double, prestataire e-sign fictif | `server.py:4806-4960, 5593`, `mandat-texte.txt`, `19-mandate-dialog-desktop.png` | Pré-cocher l'objet depuis `sale_type`, collecter l'adresse du mandant dans le flux, bloquer la génération si dénomination/SIREN manquent, nettoyer le modèle ; faire relire par le conseil | S |
| 5 | Majeur | Formulaire d'annonce : 13 champs obligatoires en jargon sans aide, pas de sauvegarde, pas de description, aucune validation (marge 250 %, dette négative acceptées), champs demandés jamais affichés (`rge_validity`, `pipeline`), champs morts | `CreateListing.jsx`, `server.py:211-236`, `s2-seller-flow.log` A7/A8, `12-create-listing-empty-mobile.png` (3 307 px) | Parcours en 3 écrans courts (activité, chiffres clés avec aide et « je ne sais pas », prix et texte libre) ; autosave serveur du brouillon ; bornes de validation ; retirer les champs inutilisés ou les afficher | M |
| 6 | Majeur | Champs manquants pour une RGE (décennale, référent technique, organismes/dates par qualification, carnet de commandes, dépendance aux aides, matériel, raison de la vente) | comparaison formulaire / `content.json` section « valorisation » | Ajouter un bloc « Ce qui rassure un repreneur » optionnel, affiché sur la fiche | M |
| 7 | Majeur | Publication conditionnée à une validation humaine (non dirigeant ou API externes en panne) ; refus sans motif ; e-mail « reçue » renvoie vers des actions inexistantes | `server.py:1471-1516`, `business_model.py` listing_received/listing_rejected, `21-mandate-signed-desktop.png`, `24-dash-rejected-mobile.png` | Publier le teaser anonyme immédiatement ; validation admin seulement avant révélation d'identité ; champ « motif » obligatoire au refus, affiché au vendeur | M |
| 8 | Majeur | E-mail jamais vérifié alors qu'il porte le code qui « vaut signature » | `server.py:480-517`, `OtpSignatureDialog.jsx` | Double opt-in e-mail à l'inscription (ou avant la première signature) | S |
| 9 | Majeur | Bandeau KYC cassé sur mobile ; bouton « Vérifier mon identité » sans retour en cas d'échec ; page Profil propose un KYC manuel (CNI, justificatif, Kbis) qui contredit Stripe | `SellerDashboard.jsx:419, 76-93`, `ProfilePage.jsx`, `10-dash-new-unverified-mobile.png`, `40-profile-desktop.png` | `flex-col sm:flex-row` ; réutiliser `KYCVerificationButton` (dialogue + redirection) ; supprimer le bloc KYC manuel | S |
| 10 | Majeur | Section tarifs déborde sur mobile (457 px / 390 px), barème tronqué | `LandingPage.jsx:601`, `Content.jsx:49-59`, `04b-pricing-viewport-mobile.png`, `s4-mobile-checks.log` | Retirer `whitespace-nowrap`, `min-w-0` sur la carte, tableau en `overflow-x-auto` effectif ou en liste sur mobile | S |
| 11 | Majeur | Accueil orienté repreneur, CTA vendeur → `/register` direct, aucune preuve sociale ni présentation d'AlterEgo/carte T | `LandingPage.jsx:421-426, 574`, `01-home-fold-*.png`, `s1-public.log` | CTA vendeur → page « Vendre » enrichie (qui sommes-nous, carte T, nombre de repreneurs vérifiés, 3 étapes réelles, FAQ mandat), puis inscription | S |
| 12 | Majeur | Annonce publiée modifiable sans revalidation ni notification ; aucune action vendeur pour retirer/archiver/marquer vendue | `server.py:1879-1898`, `SellerDashboard.jsx:287-288` | Journaliser et notifier les modifications sensibles (prix) ; ajouter « Mettre en pause », « Retirer », « Vendue » côté vendeur | S |
| 13 | Majeur | Fiche publique : « Date non renseignée » pour chaque qualification malgré la date saisie ; promesse « Nous pouvons accompagner le futur propriétaire… » ; titre générique ; aucun texte | `CompanyDetail.jsx:429, 533, 556-566`, `34-my-listing-public-view-desktop.png` | Afficher `rge_validity` ; supprimer la promesse ; titre composé (activités + région + effectif) ; description à la création | S |
| 14 | Mineur | Dialogue de signature : 137 lignes dans 330-360 px, case « j'ai lu » cochable sans défilement, pas de résumé ; PDF sans bloc de preuve | `OtpSignatureDialog.jsx:131-145`, `business_model.py:348-362`, `s2b-mandate.log` A13 | Résumé 5 lignes + texte dépliable ; activer la case en fin de défilement ; page de preuve dans le PDF (code, horodatage, empreinte) | S |
| 15 | Mineur | Dashboard : pas de boîte d'actions en tête (demandes, offres, messages non lus) ; compteurs avant « Mes annonces » sur mobile ; demandes d'accès sans profil repreneur ; photos rendues par une icône | `SellerDashboard.jsx:458-520, 748-752, 956-1000`, `51-dash-access-tab-mobile.png`, `50-dash-active-overview-mobile.png` | Bloc « À traiter » en tête ; afficher métier/région/budget/financement du repreneur sur la demande ; afficher la vraie image | M |
| 16 | Mineur | E-mails : « Bonjour seller SAS », pas de liens profonds, refus sans motif, contact sans aperçu du message, pas de bilan hebdo, « en ligne » avant « mandat signé » | `business_model.py:366+`, `s2b-mandate.log`, `s3-dashboard-activity.log` | Prénom obligatoire ou « Bonjour, », lien direct vers l'objet, extrait du message, digest hebdomadaire vues/contacts | S |
| 17 | Mineur | Messagerie : fil nommé « Entreprise #6254b590 », montant « 395,000 € », « Seller » / avatar « U » sur le profil, « Espace Vendeur » sans prénom | `MessagesPage.jsx:385`, `ProfilePage.jsx`, `SellerDashboard.jsx:461-464` | Libellés métier (activités + région), `toLocaleString('fr-FR')`, traductions | S |

---

## 7. Ce qui est bien fait (à ne pas casser)

- Brouillon avant KYC puis soumission automatique à la vérification (`submit_drafts`) : l'artisan peut saisir d'abord.
- Page mandat : pédagogie, choix du débiteur avec estimation, bouton désactivé sans choix, récap dans la modale, gestion du
  mauvais code, numéro de registre séquentiel, PDF, ligne mandat sur le dashboard, e-mail « Mandat n° X est signé ».
- Barème marginal sans effet de seuil, **source unique** `frontend/src/lib/offer.js` reprise à l'identique sur l'accueil, la page
  Vendre, l'inscription, le mandat et la fiche : cohérence totale des chiffres.
- Confidentialité : pseudonymes « Acquéreur n°… » avant NDA, masquage automatique des téléphones/e-mails dans les messages,
  données identifiantes retirées des API publiques, filigrane et journal de la data room.
- E-mails transactionnels à chaque étape et relances automatiques J+3 (sans annonce, brouillon, mandat, vendeur silencieux).
- Onglet Accès : process expliqué en 5 étapes, états lisibles, valider/refuser/révoquer en un geste.
- Qualité technique : zéro erreur JS, zéro 5xx, code-splitting, pas de scroll horizontal global, design propre sur desktop,
  `data-testid` partout (testabilité).

---

## 8. Plan de correction recommandé

Quick wins (1-2 jours) : #2 (message et secours ADEME), #4 (objet et adresse du mandat), #9 (bandeau KYC mobile, profil),
#10 (tarifs mobile), #13 (fiche publique), #8 (double opt-in), #16-17 (libellés).

Chantier 1 — messagerie par acquéreur (#1) : indispensable avant d'avoir 2 repreneurs sur une annonce.

Chantier 2 — nouveau parcours de dépôt (#5, #6, #7, #11, #12) : page « Vendre » comme porte d'entrée, annonce en 3 écrans courts
avec autosave, publication immédiate du teaser, validation humaine déplacée à la révélation d'identité, actions vendeur
(pause/retrait/vendue).

Chantier 3 — mandat (#3, #14) : non exclusif ou semi-exclusif, 6 mois, résiliable en ligne, résumé contractuel, demande visible
avant signature, HT d'abord, caducité en cas de refus. À valider par le conseil d'AlterEgo.

---

## Annexe — index des captures (desktop / mobile)

01 accueil (fold et page entière) · 02 inscription vide · 03 page Vendre · 04/04b tarifs · 05-06 inscription vendeur et SIRET ·
07 connexion · 10-11 dashboard neuf et clic KYC · 12 formulaire vide · 13/13b dialogue KYC · 14 formulaire rempli · 15 retour
brouillon · 16 bandeau mandat · 17-18 page mandat · 19/19b/20 modale de signature · 21 mandat signé (non dirigeant) · 22-23
dashboard « En validation » · 24 annonce refusée · 30/33 mandat dirigeant · 34 fiche publique · 35-39 dashboard publié, onglets,
édition, data room · 40 profil · 50-55 dashboard en activité, accès, offres, data room, messagerie.
