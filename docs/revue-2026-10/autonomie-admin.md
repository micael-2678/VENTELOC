# Audit « zéro équipe » — espace admin, automatismes et e-mails de CessionRGE

Audit réalisé le 9 octobre 2026 en lecture seule sur la branche `main` (`/home/user/Cession-rge/`), l'API locale
(`http://127.0.0.1:8001/api`, base en mémoire) et le front de production (`http://127.0.0.1:3000`).

- Dossier des captures et scripts : `docs/revue-2026-10/autonomie-admin/`
  (ci-dessous `audit/autonomie-admin/`). Script Playwright : `audit/autonomie-admin/admin.js` ; journal console/API : `audit/autonomie-admin/console-log.txt`.
- E-mails réellement générés par la plateforme pendant les parcours de test : `/tmp/claude-0/-home-user-Cession-rge/ce38f6ec-42e9-581c-a8b8-72299bf0cff5/scratchpad/emails.jsonl` (93 e-mails, 20 modèles distincts observés).
- Code cité : `backend/server.py` (6 243 lignes), `backend/business_model.py` (698 lignes), `frontend/src/pages/AdminDashboard.jsx`, `frontend/src/components/AdminMetrics.jsx`, `frontend/src/components/AdminMandates.jsx`.
- Posture : expert en opérations de marketplace sans équipe. Je dis ce qui ne tournera pas seul, pas seulement ce qu'il faut polir.
  Les points juridiques (loi Hoguet, registre des mandats, LCB-FT) sont une lecture de praticien, à faire valider par le conseil d'AlterEgo.

Résultat technique du passage navigateur : **aucune erreur JavaScript, aucune réponse API ≥ 400 sur les écrans admin** (les seuls 404 proviennent du test volontaire d'un lien de suivi invalide). Le back-office est stable ; le problème n'est pas la qualité du code, c'est ce qu'il laisse à faire à un humain.

---

## 0. Verdict sincère en vingt lignes

1. **Aujourd'hui, CessionRGE ne tourne pas sans Micael.** Quatre moments du cycle de vie exigent un clic ou un e-mail de sa part, et deux d'entre eux sont sur le chemin du revenu : la **validation des annonces** quand la vérification « dirigeant » échoue (`server.py:1471-1516`) et **l'encaissement de la commission** (`server.py:3854-3923`, facture créée `a_valider` sans aucun endpoint ni écran pour la valider, l'envoyer ou la suivre, `server.py:3784-3830`).
2. **Le seul événement qui génère de l'argent n'a pas d'interface.** `POST /closing/declare` existe côté serveur, mais **aucun écran du front ne l'appelle** (`grep -rn closing frontend/src` : zéro résultat). Dans l'état, une vente conclue ne peut être déclarée que par un appel API à la main. La commission dépend donc de la bonne volonté des parties **et** d'une intervention technique du fondateur.
3. **L'espace admin est un espace de lecture, pas un poste de pilotage.** Huit onglets, mais une seule action utile (« Publier ») et deux actions secondaires (« Valider KYC », « Reset MDP »). Pas de bouton « Refuser » (ni pour une annonce ni pour un KYC), pas de motif de refus, pas de liste des factures, pas de file « à faire ». Le fondateur doit deviner ce qui l'attend en parcourant des listes de cartes.
4. **Les automatismes existants sont bien conçus mais trop peu nombreux.** Trois tâches horaires idempotentes (`server.py:6108-6204`) : relance vendeur muet à J+3, questionnaire acquéreur à J+30, relance vendeur sans annonce / brouillon / mandat à J+3. J'ai vérifié qu'elles fonctionnent (le compte `ux-vendeur-auditc` créé il y a 5 jours a bien reçu « Votre annonce de cession en 10 minutes »). Il manque tout ce qui fait vivre une place de marché sans commercial : relance KYC acquéreur, digest d'annonces, relance NDA/LOI, suivi post-offre acceptée, hebdo vendeur, fin de mandat, détection de contournement.
5. **Les e-mails sont propres, sobres et cohérents** (en-tête, bouton, pied de page, `business_model.py:203-214`) mais **ils ne vendent rien et ne mènent nulle part** : le bouton va toujours sur `/login`, jamais sur l'objet concerné ; aucun e-mail ne contient un chiffre (« 12 repreneurs vérifiés cherchent dans votre région »), un extrait de message ou un conseil actionnable. Le refus d'annonce arrive sans motif (« Répondez à cet email »), ce qui crée précisément l'échange humain que l'on veut éviter.
6. **Aucun garde-fou d'entrée** : pas de double opt-in e-mail à l'inscription (`server.py:481-517`), pas de limitation de débit sur login/inscription/mot de passe oublié, pas de blocage des domaines jetables. Avec un trafic SEO réel, Brevo enverra des e-mails à des adresses fausses et la réputation d'envoi se dégradera. Le masquage des coordonnées avant NDA (`server.py:1652-1657`) et la limite OTP (5 essais, 10 min, 1 code/min, `server.py:2728-2795`) sont, eux, bien faits.
7. **Bug bloquant pour l'autonomie** : `except stripe.error.StripeError` (`server.py:326` et `:414`) lève `AttributeError: module 'stripe' has no attribute 'error'` avec la version installée (stripe 13.0.1). Toute erreur Stripe Identity devient une 500 opaque (9 occurrences dans `scratchpad/backend.log`). Or Stripe Identity est la porte d'entrée de tout le parcours acquéreur.
8. **Pour le volume probable (2 à 5 annonces et 10 à 30 inscriptions par semaine en année 1), une partie du back-office est inutilement complexe** : éditeur de modèles de contrats et génération manuelle de NDA/LOI par l'admin (le parcours acquéreur les génère déjà tout seul), grille de 30 paramètres de plateforme, visionneuse de data room côté admin, code des crédits/abonnements derrière un feature flag, onglet « Messages » qui liste 1 000 messages en clair, tableau hebdomadaire de 12 semaines de zéros.
9. **La bonne nouvelle** : tout ce qui manque est de la règle métier simple (dates, compteurs, e-mails), sans nouveau prestataire payant. Avec les API publiques gratuites (ADEME RGE, recherche-entreprises, BODACC) et Brevo, le coût marginal des automatismes proposés est proche de zéro ; le seul coût variable reste Stripe Identity (~1,5 € par vérification).
10. **Priorité absolue, dans l'ordre** : (a) écran « Déclarer la vente » + facturation automatique + relances post-offre acceptée ; (b) publication automatique dès que l'identité est certifiée et le mandat signé, avec post-modération ; (c) motifs de refus en un clic ; (d) double opt-in + limitation de débit ; (e) séquence KYC acquéreur et digest hebdo ; (f) un onglet « À faire » qui remplace les sept autres pour le quotidien.

---

## 1. Ce qui est bien fait (à ne pas casser)

- **Idempotence des relances** : `claim_once(kind, key)` avec index unique (`server.py:6098-6106`, `:6221`) garantit un seul envoi par clé même si la boucle tourne sur plusieurs instances. C'est le bon socle pour toutes les séquences proposées ci-dessous.
- **Boucle de tâches in-process** (`jobs_loop`, `server.py:6190-6196`, `JOBS_INTERVAL_SECONDS`, `JOBS_ENABLED`) : zéro infrastructure supplémentaire, déclenchement manuel possible par `POST /admin/jobs/run`. À garder tel quel.
- **Registre des mandats** (`server.py:5740-5771`, capture `audit/autonomie-admin/desktop-08-mandats.png`) : numéro d'ordre continu, export CSV, débiteur de la commission visible, méthode de signature. C'est l'obligation carte T la mieux traitée du produit.
- **Métriques de test de marché** (`server.py:4129-4248`, capture `desktop-01-metrics.png`) : entonnoir acquéreur, taux et délai médian de réponse vendeur, sources, questionnaire 30 jours. Le calcul est juste ; c'est la présentation et l'usage qui manquent.
- **Publication automatique quand tout est vérifié** (`server.py:1486-1496`) : identité Stripe + dirigeant INPI + mandat signé ⇒ en ligne sans clic. Le principe est bon, il faut juste élargir ses conditions (§ 4).
- **Masquage des coordonnées avant NDA** (`mask_contacts`, `server.py:1652-1657`, journalisation dans `contact_attempts`, `:3117-3130`) : visible dans l'admin sous la forme « Mon [coordonnées masquées] si vous préférez » (`desktop-04-messages.png`). C'est la brique sur laquelle bâtir la détection de contournement.
- **OTP de signature** (`server.py:2728-2795`) : 10 minutes, 5 essais, 1 code par minute, preuve (IP, SHA-256) conservée.
- **E-mails échappés et modèles centralisés** (`email_user`, `server.py:1670-1679`, `EMAIL_TEMPLATES`) : ajouter une séquence revient à ajouter une entrée de dictionnaire et une règle dans un job.
- **Alertes acquéreurs** déclenchées à la publication (`trigger_alerts_for_company`, `server.py:4441-4490`), envoyées une seule fois par annonce (`alerts_sent`).
- **Ton des e-mails** : français correct, phrases courtes, pas de jargon, promesse claire (« une commission n'est due qu'en cas de vente »).

---

## 2. L'espace admin, onglet par onglet

Connexion par injection du jeton admin dans `localStorage`, puis `/admin/dashboard`. Captures desktop 1 400 × 900 et mobile 390 × 844, pleine page.

| Onglet | Captures | Ce qu'on y fait | Constat |
|---|---|---|---|
| Suivi du test (métriques) | `desktop-01-metrics.png`, `mobile-01-metrics.png` | Lire 12 tuiles, un entonnoir, les sources, le questionnaire, un tableau 12 semaines | Lecture seule. Tuile « Délai médian de réponse : **0 h** » (arrondi à l'heure, `server.py:4228`), tableau de 12 semaines **presque entièrement à zéro** (démarrage à froid), « Sources d'acquisition : non renseigné 100 % ». Rien n'est cliquable, rien ne dit **quoi faire**. |
| Annonces | `desktop-02-annonces.png`, `mobile-02-annonces.png` | Bouton « Publier » sur toute annonce non publiée, bouton « Data Room » | **Pas de bouton « Refuser »**, pas de motif, pas de lien vers la fiche publique pour relire l'annonce, pas de filtre par statut : la file d'attente est noyée dans les annonces publiées. « 0 vues » partout car le front lit `views_count` (`AdminDashboard.jsx:413`) alors que la base stocke `views` (`server.py:1755`). L'annonce « Refusée » affiche encore « Publier » (ce qui est bien) mais sans trace du motif. Sur mobile la page **déborde horizontalement** (capture large de 505 px pour un viewport de 390 px). |
| Utilisateurs | `desktop-03-utilisateurs.png` | « Valider KYC » (un clic, sans voir aucune pièce), « Reset MDP » | **Impossible de consulter le document envoyé** par `/auth/upload-kyc` (`server.py:596-611`) ni de refuser un KYC (le backend l'accepte : `server.py:4048`). Aucune notification admin quand un document est déposé. « Reset MDP » fait doublon avec le mot de passe oublié en libre-service (`server.py:554`). La tuile « KYC en attente : 2 » compte tous les comptes qui n'ont **jamais commencé** la vérification (`AdminDashboard.jsx:315`), pas ceux qui attendent une action. |
| Messages | `desktop-04-messages.png` | Lire les 1 000 derniers messages en clair | Utile pour la modération, inutile au quotidien et lourd en responsabilité (contenu confidentiel des parties). Aucun indicateur « tentative de contournement » alors que `contact_attempts` les journalise. |
| Transactions | `desktop-05-transactions.png` | Lire les offres | Affiche « (null null) » quand prénom/nom manquent. **Aucune facture, aucun closing, aucune commission** n'y figure : l'endpoint `GET /admin/invoices` (`server.py:3826`) n'est appelé par aucun écran (`grep invoices AdminDashboard.jsx` : vide). La tuile d'en-tête « Transactions : 3 » compte en réalité les offres (`AdminDashboard.jsx:25`). |
| Data Room | `desktop-06-dataroom-empty.png`, `desktop-09-dataroom-company.png` | Voir les documents et le journal d'accès d'une annonce | Fonctionne. Mais un opérateur sans équipe n'a aucune raison de consulter les bilans d'un cédant : c'est du risque (confidentialité) sans usage. |
| Contrats | `desktop-07-contrats.png` | Générer un NDA/LOI à la main, les « envoyer pour signature », éditer les modèles, modifier 30 paramètres | **Chemin mort pour l'exploitation** : le parcours acquéreur génère déjà NDA et LOI tout seul (`/contracts/generate-for-signature`, `server.py:2547`). On voit un « MANDAT… En attente » sans annonce (`→` vide) : projet de mandat jamais signé, sans action possible. La grille de paramètres mélange juridique (`DUREE_MANDAT_MOIS 12`, `DUREE_RENOUVELLEMENT_MOIS 6`), technique (`PRESTATAIRE_ESIGN`) et métier (`MULTIPLE_EBITDA 4.5`). |
| Registre des mandats | `desktop-08-mandats.png`, `mobile-08-mandats.png` | Lire, exporter CSV | Bien. Manque la **date de fin** et l'**état** (en cours / expiré / renouvelé) pour piloter les échéances ; un mandat sans raison sociale apparaît « PRJ-2E7F8D4C ». |
| Page de suivi (lien e-mail J+30) | `desktop-10-suivi-invalid-token.png` | Réponse en un clic | Gestion d'erreur propre. |

**Impression générale** : visuellement sérieux et cohérent avec le site (typo, cartes, badges), lisible sur desktop, trop long et cassé sur mobile (cinq tuiles empilées avant le premier onglet, débordement horizontal sur « Annonces »). Ce n'est pas un tableau de bord de fondateur : c'est une vue base de données habillée.

---

## 3. Carte des interventions humaines actuelles

Hypothèse de volume (année 1, après SEO) : 2 à 5 annonces créées par semaine, 10 à 30 inscriptions acquéreurs par semaine, 3 à 10 premiers contacts par semaine, 1 à 3 offres acceptées par mois à partir du 6ᵉ mois.

| # | Intervention | Déclencheur | Où / preuve | Fréquence estimée | Risque si personne ne le fait |
|---|---|---|---|---|---|
| H1 | **Publier une annonce en attente** | Identité certifiée mais nom ≠ dirigeant INPI/recherche-entreprises, ou vérification impossible (`reason` : « qualité de dirigeant non vérifiée ») | `submit_listing`, `server.py:1497-1514` → e-mail `[Admin] Nouvelle annonce à valider` (`audit/autonomie-admin/email-04-admin-pending.png`) ; bouton « Publier » `AdminDashboard.jsx:433-442` | **1 à 3 par semaine**. Dans les TPE du bâtiment, le faux négatif est la norme : gérant de SARL ≠ président, nom composé, accents, holding personne morale comme président, conjoint ou expert-comptable qui saisit, INPI non configuré (`INPI_USERNAME` absent → repli sur recherche-entreprises, `server.py:945`) | L'e-mail promet « généralement sous 48 h ouvrées » (`listing_received`). Au-delà, le cédant, qui a déjà fait KYC + mandat, considère le site mort. Perte de l'actif le plus rare de la place de marché. |
| H2 | **Refuser une annonce et expliquer pourquoi** | Annonce incomplète, hors cible, prix absurde, doublon | `PUT /companies/{id}/status?status=rejected` (`server.py:1841-1859`), **pas de bouton dans l'UI** ; e-mail `listing_rejected` sans motif (`email-09-rejected.png`, « Répondez à cet email… ») | 1 sur 5 annonces | Chaque refus déclenche un échange e-mail manuel. Sans UI, il faut un appel API à la main. |
| H3 | **Valider / refuser un KYC déposé à la main** | Un utilisateur envoie une pièce via le profil (`/auth/upload-kyc` → `under_review`) | `server.py:596-611` ; bouton « Valider KYC » sans visionneuse (`desktop-03-utilisateurs.png`) ; **aucun e-mail admin** | Rare si Stripe Identity marche, mais **chaque échec Stripe** (bug `stripe.error`, document refusé) y renvoie | Utilisateur bloqué sans savoir s'il est vu ; l'admin ne le saura qu'en ouvrant l'onglet. Validation « à l'aveugle » = aucune valeur probante. |
| H4 | **Déclarer la vente, calculer et facturer la commission, encaisser, relancer** | Offre acceptée puis acte signé chez le rédacteur | `declare_closing` (`server.py:3854-3923`) sans écran ; facture `a_valider` (`:3798`) ; e-mail admin `closing_declared` ; `db.invoices` jamais mis à jour ensuite | 1 à 3 par mois en régime de croisière | **C'est 100 % du chiffre d'affaires.** Aujourd'hui : appel API manuel, PDF texte brut (`invoice_pdf`, `:3832`), envoi par e-mail à la main, suivi de paiement sur un tableur. Oubli = commission perdue ; retard = contestation. |
| H5 | **Mise en relation avocat** | Un acquéreur ou cédant clique « demander un avocat » après offre | `request_lawyer_contact`, `server.py:3740-3782`, e-mail `[Admin] Demande de mise en relation avocat` | Rare (1 sur 3 offres acceptées) | Promesse non tenue (« Demande envoyée à l'équipe »), sans valeur ajoutée pour le fondateur. |
| H6 | **Retirer, mettre en pause, marquer vendue une annonce** | Le cédant a vendu ailleurs, change d'avis, veut une pause | `CompanyUpdate` n'autorise pas `status` (`server.py:1866-1897`) ; seul l'admin peut via API ; **aucun bouton** ni côté vendeur (`SellerDashboard.jsx` : seules photos/documents supprimables) ni côté admin (seul « Publier ») | **Toutes les annonces finissent par en avoir besoin** | Annonces fantômes qui restent publiées ; acquéreurs qui contactent dans le vide ; le site paraît inactif ; et surtout la vente « ailleurs » pendant l'exclusivité passe sous le radar. |
| H7 | **Suivre les échéances de mandat** (12 mois + tacite 6 mois, préavis 30 j selon `desktop-07-contrats.png`) | Temps | Registre (`desktop-08-mandats.png`) sans date de fin ; aucun job | Permanente | Annonces publiées sous mandat expiré (exposition carte T), renouvellements non notifiés, commission contestable. |
| H8 | **Reset de mot de passe** | Demande utilisateur | Bouton « Reset MDP » (`AdminDashboard.jsx:57-64`) | Marginale | Aucun : le libre-service existe (`/auth/forgot-password`). Doublon à supprimer. |
| H9 | **Lire les messages / repérer les abus** | Curiosité ou plainte | Onglet Messages | Hebdo | Sans indicateur de tentative de contournement, c'est de la lecture à l'aveugle. |
| H10 | **Lire les réponses au questionnaire J+30** | Job `followups` | Bloc « Questionnaire de suivi » | Hebdo | Aucun risque ; utile pour la détection de contournement si on y relie une règle (§ 6). |
| H11 | **Modifier modèles de contrats / paramètres** | Changement juridique | Onglet Contrats | Trimestrielle au plus | Aucun. Mais un paramétrage par l'UI qui **prime** sur les variables d'environnement (`docs/business-model-v2-rapport-ecarts.md`, § 2.8) est un piège. |
| H12 | **Relancer un vendeur injoignable au-delà de J+3** | Job `seller_reminders` n'envoie qu'un seul rappel | `server.py:6108-6130` | Hebdo | Acquéreur sans réponse ni information ; il part sans que personne ne le sache. |
| H13 | **Vérifier qu'une offre acceptée a abouti** | Rien ne suit une acceptation | Offres « accepted » n'ont aucune suite dans le code | Mensuelle | **Angle mort du revenu** : le closing peut se faire sans jamais être déclaré. |

---

## 4. Pour chaque intervention : supprimer, automatiser (règle précise) ou garder avec alerte

| # | Décision | Règle / mécanisme | Effort |
|---|---|---|---|
| H1 Validation d'annonce | **Automatiser (post-modération)** | Publier automatiquement dès que **(a)** identité certifiée Stripe (`verified_last_name` présent), **(b)** mandat signé par cette identité, **(c)** SIREN actif (recherche-entreprises, gratuit) **et** présent dans le jeu ADEME RGE (`verify_rge`, déjà codé `server.py:615`), **(d)** aucun autre SIREN identique publié ou en attente, **(e)** prix demandé dans une bande de plausibilité (0,1 × à 3 × CA N, sinon simple drapeau « prix atypique », pas de blocage). La correspondance du nom avec INPI devient un **score affiché** à l'admin, plus une condition : le mandat est signé par une personne dont l'identité est certifiée, qui engage sa responsabilité (le mandat devrait le dire explicitement : « le Mandant déclare avoir qualité pour signer »). Fenêtre de post-modération : l'annonce est publiée avec un drapeau `review_until = now + 48 h` ; elle apparaît en tête de la liste « À faire » ; sans action en 48 h, le drapeau tombe. Seuls cas bloquants restants : SIREN non RGE ou inactif, doublon → e-mail automatique au vendeur avec le motif précis et le bouton « inviter le président » (flux existant `server.py:1164`). | M |
| H2 Refus motivé | **Automatiser le contenu, garder le clic** | Bouton « Refuser » avec 6 motifs à cocher (données financières manquantes, prix incohérent, annonce non RGE, doublon, coordonnées dans le texte, autre + texte libre) → e-mail `listing_rejected` enrichi du motif et d'un lien **direct** vers l'édition ; la resoumission relance automatiquement les contrôles de H1. | S |
| H3 KYC manuel | **Supprimer le dépôt manuel** | Stripe Identity est la seule voie ; retirer `/auth/upload-kyc` du profil. Si l'on tient à un secours : e-mail admin à chaque dépôt, visionneuse dans l'onglet Utilisateurs, boutons Valider/Refuser avec motif, SLA affiché à l'utilisateur. Et **corriger `stripe.error`** (`server.py:326`, `:414`) pour qu'un échec Stripe affiche un message réessayable au lieu d'une 500. | S |
| H4 Closing et commission | **Automatiser bout en bout, garder une alerte** | (1) Écran « Déclarer la vente » côté vendeur **et** acquéreur (montant, date, rédacteur d'acte) ; la déclaration de l'une des parties notifie l'autre pour confirmation en un clic ; sans contestation sous 7 jours, elle vaut confirmation. (2) Facture générée automatiquement au débiteur du mandat (déjà codé) et **envoyée** via Stripe Invoicing (page de paiement hébergée, virement SEPA ou carte, relances automatiques J+7/J+15/J+30 incluses, ~0,4 % par facture payée) ou via Qonto/Pennylane API. (3) Statuts de facture `envoyée / payée / en retard` lus depuis le webhook, affichés dans « À faire » seulement si en retard > 30 j. (4) Relances automatiques **avant** le closing : offre acceptée J+30, J+60, J+90 → « Où en êtes-vous ? » aux deux parties, 3 réponses en un clic (compromis signé / acte signé → ouvre la déclaration / abandon → demande la raison). Réponses contradictoires ou silence à J+120 → alerte admin. | L |
| H5 Avocat | **Supprimer** | Remplacer par une page statique « Vos conseils » (comment choisir un avocat/expert-comptable, questions à poser) et, si des partenaires existent, un lien direct vers eux. Pas de file admin. | S |
| H6 Retrait / pause / vendue | **Automatiser (libre-service)** | Bouton vendeur « Modifier la disponibilité » : *En vente / En pause (masquée, mandat conservé) / Vendue via CessionRGE (ouvre H4) / Vendue autrement / Plus à vendre*. « Vendue autrement » ou « plus à vendre » pendant la période d'exclusivité ⇒ e-mail automatique rappelant la clause de suite et demandant l'identité de l'acquéreur (champ facultatif), **plus** inscription du SIREN dans la veille BODACC (§ 6). Pause automatique après 90 jours sans connexion du vendeur, précédée d'un e-mail J-7 avec bouton « garder en ligne ». | M |
| H7 Échéances de mandat | **Automatiser** | Job quotidien : `mandate_end = signed_at + DUREE_MANDAT_MOIS` ; e-mail J-30 (« votre mandat arrive à échéance : il se renouvelle tacitement pour 6 mois sauf dénonciation 30 j avant ») ; à la date, mise à jour du registre (`renewed_until`) ; si dénoncé, dépublication automatique + e-mail. Colonnes « Fin », « État » dans le registre. | S |
| H8 Reset MDP | **Supprimer** | Le libre-service existe. | S |
| H9 Lecture des messages | **Garder avec alerte** | Remplacer la liste brute par une liste d'**incidents** : messages où `mask_contacts` a agi (déjà journalisés dans `contact_attempts`), comptés par utilisateur. | S |
| H10 Questionnaire J+30 | **Garder** | Relier la réponse « Accord ou offre en cours » et « Pas de suite » aux règles de H13/§ 6. | S |
| H11 Modèles / paramètres | **Garder, mais bloquer les paramètres juridiques** | Les durées de mandat et le barème doivent vivre dans l'environnement (versionné), pas dans un formulaire modifiable sans trace. | S |
| H12 Vendeur muet | **Automatiser l'escalade** | J+3 rappel (existe) ; J+7 second rappel + **e-mail à l'acquéreur** (« le vendeur n'a pas encore répondu ; voici 3 annonces proches ») ; J+14 badge « vendeur peu réactif » visible sur la fiche + e-mail au vendeur ; J+30 mise en pause automatique avec bouton de réactivation. | S |
| H13 Suite d'une offre acceptée | **Automatiser** | Voir H4 (J+30/60/90/120). | inclus dans H4 |

---

## 5. Les automatismes existants, à la loupe

Fichier : `backend/server.py:6098-6221`.

| Job | Règle | Observation | Manque |
|---|---|---|---|
| `job_seller_reminders` | Dernier message d'une conversation = acquéreur, vieux de ≥ 3 j → `seller_reminder` au vendeur, une fois par message | Parcourt **tous** les messages à chaque passage (O(n)) ; acceptable jusqu'à ~100 k messages. | Pas d'escalade, pas d'information de l'acquéreur, pas de lien direct vers la conversation. |
| `job_followups` | Contact vieux de 30 j → questionnaire 4 réponses | Bon principe, lien sans connexion. | Les réponses ne déclenchent rien (ni alerte « accord », ni relance). Pas de second passage à J+90. |
| `job_seller_relaunch` | Vendeur inscrit ≥ 3 j : sans annonce → `seller_no_listing` ; brouillon sans KYC → `seller_draft_reminder` ; mandat en attente ≥ 3 j → `listing_mandate_required` | Vérifié en conditions réelles (e-mail reçu par `ux-vendeur-auditc`). | Un seul envoi par cas ; rien à J+7/J+14 ; aucune preuve sociale ni chiffre dans le contenu. |
| `trigger_alerts_for_company` (à la publication) | Alertes actives correspondant aux critères → e-mail | Envoyé une seule fois par annonce. | Pas de lien de désinscription ni de gestion d'alerte dans l'e-mail ; `user_email` figé à la création de l'alerte ; aucune alerte sur **baisse de prix** ou mise à jour ; rien pour les acquéreurs sans alerte (la majorité). |
| `check_and_process_refunds` | Remboursement de crédits | Code mort en mode gratuit (`FF_BUYER_CREDITS=false`). | À retirer avec le reste des crédits. |
| Webhook Stripe Identity | `verified` → `store_verified_identity` → `submit_drafts` | Bon : la vérification d'identité soumet les brouillons sans clic. | Dépend de `stripe.error` (`:414`), cf. bug. |

---

## 6. Les e-mails existants, modèle par modèle

Source : `backend/business_model.py:366-686` et e-mails réels dans `scratchpad/emails.jsonl`. Captures : `audit/autonomie-admin/email-01…10.png`.

| Modèle | Moment | Ton / clarté | Incitation | Manque |
|---|---|---|---|---|
| `welcome` | Inscription | Correct, court | Faible : « vérifiez votre identité puis publiez » sans lien direct | Un lien profond (`/kyc` ou `/seller/listing/new`), les 3 étapes et leur durée, « gratuit, commission seulement si vente », pour l'acquéreur : « X annonces en ligne dans votre région ». Salutation « Bonjour seller SAS » quand le prénom manque (`display_name`, `server.py:1664`) : préférer « Bonjour, ». |
| `listing_draft` / `seller_draft_reminder` | Création sans KYC / J+3 | Clair, rassurant (« partira automatiquement ») | Moyenne | Bouton direct vers la vérification. Une seule relance. |
| `listing_mandate_required` | Soumission sans mandat / J+3 | Bon (« deux minutes », « qui paie ») | Bonne (lien direct, `email-02-mandat.png`) | Répondre aux 3 objections (exclusivité, durée, résiliation) ; relances J+7, J+14. |
| `mandate_signed` | Signature | Factuel | — | Dire **ce qui se passe ensuite** (« votre annonce est en cours de publication / en ligne »). |
| `listing_received` | File admin | Honnête (« sous 48 h ouvrées ») | Faible | Promesse à tenir ; proposer en un clic l'invitation du président. Si H1 est appliqué, ce modèle disparaît. |
| `admin_listing_pending` | File admin | Utile (motif) | — | Le bouton « Accéder à mon espace » mène sur `/login` ; il faut un lien direct vers l'annonce + boutons Publier/Refuser signés (token à usage unique) pour agir depuis le téléphone. |
| `listing_published` | Publication | Correct | Faible | Chiffres (« votre annonce a été envoyée à N acquéreurs en alerte »), 3 conseils (répondre < 24 h, compléter la data room, photos), lien vers la fiche publique. |
| `listing_rejected` | Refus | Froid et sans motif (« Répondez à cet email ») | Nulle | Motif, lien direct vers l'édition, délai. |
| `new_contact` | Premier message | Bon (« réponse rapide ») | Moyenne | **Extrait du message**, profil pseudonymisé de l'acquéreur (métier, région, taille), lien direct vers la conversation. |
| `seller_reminder` | J+3 | Très bon (« même une réponse courte compte ») | Bonne | Lien direct ; escalade. |
| `seller_reply` / `new_message` | Réponse | Minimal | Faible | Extrait du message, lien direct. |
| `access_request` | Demande data room | Minimal | Faible | Résumé de l'acquéreur, boutons Valider/Refuser. Aucune relance si le vendeur ne traite pas. |
| `access_validated` | Validation vendeur | Clair sur les étapes | Moyenne | Lien direct vers le NDA ; relances J+2/J+7 absentes. |
| `document_signed` (NDA/LOI) | Signature acquéreur | Bon (« l'identité est maintenant communiquée ») | — | Rien à ajouter. |
| `dataroom_granted` | Accès ouvert | Correct | Moyenne | Relance si aucune consultation à J+3. |
| `offer_received` / `offer_accepted` / `offer_rejected` | Offres | Corrects | Moyenne | `offer_accepted` doit lancer la séquence closing (prochaines étapes, déclaration de vente, rappel de la commission et du débiteur). Pas d'e-mail « offre expirée » ni de rappel J-3 avant expiration. |
| `followup_30d` | J+30 | Très bon (un clic) | Bonne | Suite à donner aux réponses. |
| `seller_no_listing` | J+3 | Bon argumentaire (gratuit, anonyme) | Moyenne | Preuve sociale chiffrée, lien direct, second passage J+10. |
| Alerte acquéreur (inline, `server.py:4467`) | Publication | Bon, factuel (`email-07-alert.png`) | Bonne (« Voir l'annonce ») | Désinscription / gestion d'alerte obligatoires, sujet sans émoji pour la délivrabilité B2B. |
| `lawyer_request`, `closing_declared` | Admin | Factuels | — | Cf. H4/H5. Incohérence d'adresse : `email_admin` lit `ADMIN_NOTIFICATION_EMAIL` puis `ADMIN_EMAIL` (`server.py:1681`), ces deux-là lisent `ADMIN_EMAIL` avec repli `contact@cessionrge.fr` (`:3768`, `:3907`). |
| `credit_used`, `credit_refunded`, `listing_modified`, `listing_mandate_backfill` | — | Code mort ou ponctuel | — | À retirer des modèles vivants. |

Défauts transversaux : bouton unique « Accéder à mon espace » → `/login` (`business_model.py:208`) ; aucun e-mail ne contient de chiffre ni d'extrait ; pas d'adresse de réponse explicite ; pas de lien de désinscription sur les e-mails non strictement transactionnels (alertes, digests, relances commerciales) ; aucune mesure d'ouverture/clic remontée dans les métriques (Brevo les fournit).

---

## 7. Séquence cible d'e-mails et de notifications (sans commercial)

Principes : une règle = une clé `claim_once` ; au plus **un e-mail de relance par jour et par personne** ; chaque e-mail a **un seul bouton** vers l'objet concerné ; les e-mails non transactionnels portent un lien « gérer mes e-mails ». Les chiffres entre crochets sont calculés par la plateforme (ils existent déjà dans `admin/metrics` ou en une requête).

### 7.1 Vendeur (cédant)

| Moment | Sujet | Contenu (idée) |
|---|---|---|
| Inscription | « Bienvenue — votre annonce en 3 étapes » | Annonce (10 min) → identité (2 min) → mandat (2 min). Gratuit, commission seulement si vente. Bouton « Créer mon annonce ». |
| J+2 sans annonce (existe J+3) | « [N] repreneurs vérifiés cherchent une entreprise [RGE] en [région] » | Preuve sociale calculée (acquéreurs vérifiés + alertes actives sur sa région/activité). Anonymat garanti. Bouton. |
| J+7 sans annonce | « Ce qu'un repreneur voit de votre annonce » | Capture d'une fiche anonyme, 3 questions fréquentes (qui voit quoi, qui paie, puis-je arrêter). |
| Brouillon sans identité J+1, J+4, J+10 (existe J+3 une fois) | « Il manque 2 minutes pour mettre votre annonce en ligne » | Pourquoi (protection des acquéreurs), bouton direct Stripe Identity, réessayer si échec. |
| Mandat non signé J+1, J+4, J+10 (existe J+3 une fois) | « Dernière étape : signez votre mandat (2 min) » | Les 3 réponses : exclusivité et durée, résiliation, qui paie et combien (exemple chiffré sur **son** prix). |
| Publication | « Votre annonce est en ligne — envoyée à [N] repreneurs » | N = alertes déclenchées. 3 conseils, lien fiche publique, lien data room. |
| Premier contact | « [Métier, région] vous écrit à propos de votre annonce » | Extrait du message, profil pseudonymisé, bouton « Répondre ». |
| Sans réponse J+3 (existe), J+7 | « Un repreneur attend toujours votre réponse » | J+7 : « nous l'avons informé que vous n'aviez pas encore répondu ». |
| Demande d'accès data room non traitée J+2, J+5 | « Un repreneur attend votre validation » | Boutons Valider / Refuser directement dans l'e-mail (liens signés). |
| Hebdo (lundi 8 h), annonce publiée | « Votre semaine : [vues] vues, [favoris] favoris, [contacts] contacts » | Comparaison à la médiane des annonces actives ; un conseil ciblé (data room vide → « les annonces avec data room reçoivent X % de contacts en plus » dès qu'on a la donnée ; sinon conseil fixe). |
| Sans contact depuis 14 j | « Aucun contact en 14 jours : 3 leviers » | Compléter (champs vides listés), photos, prix : fourchette calculée par `/valorization/estimate` avec son CA/EBITDA. |
| Sans contact depuis 30 j | « Faut-il revoir le prix ? » | Prix demandé vs fourchette, nombre de vues sans contact ; bouton « ajuster le prix » (qui redéclenche les alertes acquéreurs en « baisse de prix »). |
| Sans connexion 60 j | « Votre annonce sera mise en pause dans 7 jours » | Un clic « garder en ligne », sinon pause automatique (mandat conservé). |
| Offre reçue sans réponse J+3 ; J-3 avant expiration | « Une offre de [montant] expire dans 3 jours » | Bouton répondre. |
| Offre acceptée | « Et maintenant ? Les 5 étapes jusqu'à l'acte » | Compromis, audit, financement, acte ; **déclaration de vente** ; rappel du débiteur et du montant estimé de commission. |
| Offre acceptée J+30 / J+60 / J+90 | « Où en êtes-vous avec [acquéreur] ? » | 3 réponses en un clic (en cours / acte signé → formulaire de déclaration / abandonné → raison). |
| Vente déclarée | « Félicitations — votre facture de commission » | Lien de paiement, échéance, contact. Puis relances automatiques du prestataire de facturation. |
| Mandat J-30 avant échéance | « Votre mandat arrive à échéance le [date] » | Renouvellement tacite expliqué, bouton « dénoncer » ou « prolonger ». |
| Annonce en pause 60 j | « Toujours vendeur ? » | Réactiver en un clic ou clôturer (et pourquoi). |

### 7.2 Acquéreur (repreneur)

| Moment | Sujet | Contenu (idée) |
|---|---|---|
| Inscription | « Bienvenue — vérifiez votre identité pour contacter les cédants » | Pourquoi (confidentialité des cédants), 2 minutes, bouton direct. « [N] annonces en ligne aujourd'hui ». |
| Identité non vérifiée J+1, J+3, J+10 | « [N] annonces vous attendent — 2 minutes pour y accéder » | Les 3 annonces les plus proches de ses vues/recherche. |
| Vérifié sans alerte J+2 | « Soyez prévenu avant les autres » | Créer une alerte (critères pré-remplis d'après ses vues). |
| Alerte (existe) | « Nouvelle entreprise [RGE] en [région] : [prix] » | Déjà bien ; retirer l'émoji, ajouter « gérer mes alertes ». Ajouter le déclencheur **baisse de prix** sur une annonce en favori ou correspondant à l'alerte. |
| Hebdo (mardi 8 h), vérifiés sans alerte ou avec alerte large | « Les nouvelles annonces de la semaine » | 3 à 6 annonces (région/activité des vues passées), sinon les dernières publiées. Désinscription. |
| Contact sans réponse J+3 | « Le cédant n'a pas encore répondu — voici 3 annonces proches » | Transparence + alternative. |
| Profil validé, NDA non signé J+2, J+7 | « Le cédant vous a validé : signez le NDA pour connaître l'entreprise » | Bouton direct vers la signature (OTP). |
| NDA signé, LOI non signée J+3 | « Accédez à la data room » | (Ou supprimer la LOI comme condition d'accès, cf. audits précédents.) |
| Data room ouverte sans consultation J+3 ; sans offre J+14 | « Des questions sur [entreprise] ? » | Rappel, possibilité de poser des questions dans la messagerie, bouton « faire une offre ». |
| Offre expirée | « Votre offre a expiré » | Renouveler ou passer. (Modèle absent.) |
| Offre acceptée | « Félicitations — prochaines étapes » (existe) | Ajouter : déclaration de vente, qui paie la commission (telle qu'affichée sur la fiche). |
| Offre acceptée J+30/60/90 | « Où en êtes-vous ? » | Même mécanique que côté vendeur ; réponses croisées. |
| J+30 après premier contact (existe) | « Où en êtes-vous avec ce vendeur ? » | Garder ; relier « Pas de suite » à une suggestion d'annonces. |
| Sans connexion 30 j / 90 j | « Ce que vous avez manqué » / « Garder vos alertes ? » | Digest, puis confirmation d'intérêt (sinon alertes désactivées, bon pour la délivrabilité). |
| Après closing | « Une question : recommanderiez-vous CessionRGE ? » | NPS 0-10 en un clic + champ libre ; témoignage anonyme réutilisable sur l'accueil. |

### 7.3 Admin (fondateur)

- **Un seul e-mail quotidien à 8 h** (« À faire aujourd'hui ») : annonces publiées sous post-modération < 48 h, annonces bloquées (SIREN non RGE / doublon), KYC manuels, incidents de coordonnées, vendeurs muets > 7 j, offres acceptées > 60 j sans nouvelle, factures en retard, mandats à échéance < 30 j, erreurs d'envoi Brevo/Stripe (compteur). Vide = pas d'e-mail.
- **Immédiat** uniquement pour : vente déclarée, contestation d'une déclaration, réponses contradictoires des parties, 3ᵉ tentative de contournement d'un même utilisateur, échec répété de webhook Stripe.
- Chaque ligne porte un lien direct ; les deux actions les plus fréquentes (Publier / Refuser avec motif) sont faisables depuis l'e-mail via lien signé à usage unique.

---

## 8. Garde-fous anti-fraude et anti-contournement automatisables

| Risque | Garde-fou | Coût |
|---|---|---|
| Faux comptes, adresses invalides, spam | **Double opt-in** à l'inscription (lien signé, 24 h) ; compte inactif tant que non confirmé ; blocage d'une liste de domaines jetables ; **limitation de débit** (par IP et par e-mail) sur `/auth/register`, `/auth/login`, `/auth/forgot-password`, `/signatures/request-code` (le dernier a déjà 1/min). | 0 € (slowapi ou compteur Mongo) |
| Annonce non RGE, société radiée, prête-nom | À la soumission : SIRET Luhn + recherche-entreprises (état actif, dirigeants) + jeu ADEME RGE (déjà codé `verify_rge`) ; stocker `rge_checked_at` ; **revérification trimestrielle** des annonces publiées (job), drapeau « qualification RGE à confirmer » si disparue. | 0 € (API publiques) |
| Doublon / annonce usurpée | Unicité du SIREN parmi les annonces non clôturées ; second dépôt ⇒ blocage + e-mail aux deux vendeurs ⇒ alerte admin. | 0 € |
| Contournement avant NDA (coordonnées dans les messages) | Existe (`mask_contacts`). Ajouter la **gradation** : 1ʳᵉ tentative → message système dans la conversation ; 2ᵉ → e-mail rappelant la clause de non-contournement du NDA/mandat ; 3ᵉ → messagerie suspendue pour cet utilisateur jusqu'à revue (alerte immédiate). Compter aussi les variantes (« zéro six… », « arobase ») par normalisation. | 0 € |
| Scraping / pêche concurrentielle | Plafond de vélocité acquéreur : > 5 premiers contacts/jour ou > 15/semaine ⇒ contact différé + alerte ; limitation de débit sur `GET /companies/{id}` par IP ; filigrane déjà présent sur la data room. | 0 € |
| Vente conclue sans déclaration (perte de commission) | (1) Séquence J+30/60/90 après offre acceptée, réponses croisées. (2) **Veille BODACC** (API gratuite `api.bodacc.fr`) mensuelle sur chaque SIREN ayant au moins un NDA signé, pendant 24 mois : annonce de vente de fonds, cession de parts, changement de dirigeant ⇒ si aucune vente déclarée, e-mail automatique aux deux parties citant la clause du mandat/NDA + alerte. (3) Croisement avec `recherche-entreprises` (dirigeants) à J+90 et J+180. (4) Réponse « Pas de suite » au questionnaire puis BODACC positif ⇒ alerte. | 0 € |
| Vendeur qui « vend ailleurs » pendant l'exclusivité | Déclaration en libre-service (H6) avec e-mail automatique de rappel de la clause ; inscription dans la veille BODACC. | 0 € |
| Prix fantaisiste / annonce appât | Bande de plausibilité prix/CA et prix/EBITDA ; drapeau « prix atypique » visible admin, jamais bloquant. | 0 € |
| Signature par une personne non habilitée | Mandat : clause « déclare avoir qualité pour engager la société » ; conservation du nom certifié Stripe dans la preuve (existe) ; score INPI affiché. | 0 € |
| Compte admin | Mot de passe fort imposé, limitation de débit, et idéalement un second facteur (code e-mail à chaque connexion admin, réutilisant l'OTP existant). | 0 € |
| Délivrabilité | SPF/DKIM/DMARC sur le domaine d'envoi ; désinscription sur tout e-mail non transactionnel ; suppression automatique des alertes des comptes inactifs 180 j ; suivi des rebonds Brevo (webhook) ⇒ adresse marquée invalide. | 0 € |

---

## 9. Métriques à suivre et tableau de bord du fondateur (15 minutes par semaine)

**Étoile polaire** : nombre de **NDA signés par semaine** (= mises en relation qualifiées, seul événement qui précède mécaniquement une commission). Objectif secondaire : **pipeline de commission** = Σ commission(prix demandé) des annonces ayant au moins une LOI ou une offre en cours, pondérée.

### 9.1 Un écran, quatre blocs

1. **À faire (liste, pas tuiles)** — chaque ligne cliquable avec son action : annonces en post-modération (N, plus ancienne il y a X h), bloquées (motif), KYC manuels, incidents de contournement, vendeurs muets > 7 j, offres acceptées > 60 j sans nouvelle, factures en retard, mandats à échéance < 30 j, erreurs techniques (Brevo/Stripe/jobs) des 7 derniers jours. **Vide = rien à faire.** C'est l'onglet par défaut.
2. **Cette semaine vs la précédente (5 chiffres, flèche de variation)** : annonces publiées, acquéreurs vérifiés, premiers contacts, NDA signés, offres (reçues / acceptées).
3. **Santé de la place de marché (6 jauges, cibles affichées)** : taux et délai de publication (cible 100 % sous 24 h), taux de vérification acquéreur à J+7 (cible > 50 %), taux de réponse vendeur sous 48 h (cible > 70 %, aujourd'hui calculé mais non seuillé), contacts par annonce active et par semaine (cible ≥ 0,5), annonces actives sans contact depuis 30 j (cible < 30 %), part des annonces avec data room non vide.
4. **Revenu** : pipeline (offres acceptées en attente de closing, en €, et commission estimée), factures émises / payées / en retard, encaissé cumulé ; **coûts du mois** : e-mails envoyés (Brevo), vérifications Stripe Identity (× 1,5 €), hébergement.

Garder l'entonnoir par cohorte mensuelle (déjà calculé) en second écran ; supprimer le tableau de 12 semaines de zéros au profit d'une courbe à partir de la première semaine non nulle ; afficher le délai médian en minutes/heures/jours selon la valeur.

### 9.2 Rituel de 15 minutes (lundi)

1. Ouvrir « À faire » (5 min) : publier/refuser, répondre aux incidents.
2. Lire les 5 chiffres et les 6 jauges (3 min) : une jauge rouge = une action produit la semaine suivante, pas un commercial.
3. Lire les 3 derniers questionnaires J+30 et NPS (3 min).
4. Vérifier revenu/coûts (2 min).
5. Noter une décision (2 min).

---

## 10. Ce qui est inutilement complexe pour le volume probable

- **Onglet Contrats** : éditeur de modèles, génération manuelle, « envoyer pour signature », 30 paramètres. Le parcours acquéreur fait tout cela seul. À réduire à : lecture des contrats signés + export, paramètres juridiques en variables d'environnement.
- **Crédits et abonnements** (`CREDIT_PACKS`, `SUBSCRIPTION_PLANS`, `check_and_process_refunds`, `credit_contacts`, onglet « Achats de crédits », `CreditsPage.jsx`) : incompatibles avec la carte T (aucune somme avant la conclusion) et désactivés par flag. Code mort qui complique chaque endpoint de messagerie (`server.py:3045-3110`). À supprimer.
- **Data Room admin** : pas d'usage opérationnel, risque de confidentialité. À retirer ou limiter au journal d'accès.
- **Onglet Messages** (1 000 messages en clair) : remplacer par les incidents.
- **Migration mandate-backfill** exposée en API admin (`server.py:5773`) : à retirer après usage.
- **Invitation du président** (`server.py:1164-1460`) : utile comme secours, mais si H1 est appliqué elle ne sert plus qu'aux cas bloqués ; la simplifier (un seul e-mail, pas de double parcours).
- **Trois objets pour un même « deal »** (`contacts`, `dataroom_access`, `offers`) : acceptable aujourd'hui ; à unifier seulement quand les séquences J+30/60/90 l'exigeront.
- **Douze tuiles de métriques** : six suffisent avec une cible.
- **Deux e-mails admin par événement** (annonce reçue → vendeur, annonce à valider → admin) : un digest quotidien remplace les e-mails admin unitaires.

---

## 11. Constats hiérarchisés

| # | Gravité | Constat | Preuve | Recommandation | Effort |
|---|---|---|---|---|---|
| C1 | **Critique** | Le closing (seul revenu) n'a ni écran ni suivi : déclaration, facture `a_valider`, envoi, encaissement, relance sont manuels ou inexistants | `server.py:3854-3923`, `:3784-3830` ; `grep -rn closing frontend/src` vide ; `GET /admin/invoices` non appelé ; onglet Transactions sans facture (`desktop-05-transactions.png`) | Écran « Déclarer la vente » (deux parties, confirmation croisée) ; facture envoyée et relancée par Stripe Invoicing ou Qonto/Pennylane ; séquence J+30/60/90 après offre acceptée ; ligne « factures en retard » dans À faire | L |
| C2 | **Critique** | Validation humaine des annonces dès que le nom ne matche pas le dirigeant ; promesse « 48 h ouvrées » ; file mélangée aux annonces publiées, sans refus ni motif | `server.py:1497-1514` ; `email-04-admin-pending.png` ; `AdminDashboard.jsx:433-446` (seul bouton « Publier ») ; `email-09-rejected.png` sans motif | Publication automatique si identité certifiée + mandat + SIREN actif et RGE + pas de doublon, avec post-modération 48 h ; bouton Refuser à motifs ; e-mail de refus avec motif et lien d'édition | M |
| C3 | **Critique** | Toute erreur Stripe Identity devient une 500 (`stripe.error` inexistant en stripe 13) ; l'admin ne voit ni ne peut refuser un KYC manuel ; aucun e-mail quand un document est déposé | `server.py:326`, `:414` ; `scratchpad/backend.log` (9 × `AttributeError: module 'stripe' has no attribute 'error'`) ; `server.py:596-611` ; `desktop-03-utilisateurs.png` | Remplacer par `stripe.StripeError` / `stripe.SignatureVerificationError` ; message réessayable côté front ; supprimer le dépôt manuel (ou e-mail admin + visionneuse + refus motivé) | S |
| C4 | **Majeur** | Aucun double opt-in ni limitation de débit à l'inscription, connexion, mot de passe oublié ; pas de désinscription sur les alertes | `server.py:481-517`, `:554` ; `trigger_alerts_for_company` `:4467-4484` ; grep `unsubscribe` vide | Confirmation d'e-mail par lien signé ; slowapi ou compteur ; lien « gérer mes e-mails » ; webhook rebonds Brevo | S |
| C5 | **Majeur** | Le cédant ne peut ni retirer, ni mettre en pause, ni marquer vendue son annonce ; l'admin non plus depuis l'UI ; aucune expiration | `server.py:1866-1897` (`CompanyUpdate` sans `status`) ; `SellerDashboard.jsx` ; `AdminDashboard.jsx:433-446` | Libre-service « disponibilité » avec motifs ; pause automatique après 90 j sans connexion (J-7 avertissement) ; « vendue autrement » ⇒ rappel de clause + veille BODACC | M |
| C6 | **Majeur** | Séquences d'e-mails incomplètes : pas de relance KYC acquéreur, de digest, de relance NDA/LOI/data room, d'offre expirée, d'hebdo vendeur, de suggestion de prix, de fin de mandat ; relances existantes en un seul envoi | `business_model.py:366-686` ; `server.py:6108-6179` | Implémenter la séquence § 7 avec `claim_once` ; un bouton profond par e-mail ; chiffres calculés dans le contenu | M |
| C7 | **Majeur** | Aucun suivi des échéances de mandat (12 mois + 6 tacites, préavis 30 j) ; registre sans date de fin | `desktop-07-contrats.png` (paramètres), `desktop-08-mandats.png` ; grep `expir` sans job mandat | Job quotidien J-30 / échéance / dépublication si dénoncé ; colonnes Fin/État | S |
| C8 | **Majeur** | Aucune détection de contournement après NDA (vente conclue sans déclaration) | Aucun code BODACC/INPI post-NDA ; `followups` sans suite | Veille BODACC mensuelle 24 mois sur les SIREN sous NDA ; croisement dirigeants ; e-mail automatique + alerte | M |
| C9 | **Majeur** | Le tableau de bord ne dit pas quoi faire : 12 tuiles, tableau de zéros, « KYC en attente » qui compte les non-démarrés, « Transactions » qui compte les offres, « 0 vues » partout, « (null null) » | `desktop-01-metrics.png`, `desktop-02-annonces.png`, `desktop-05-transactions.png` ; `AdminDashboard.jsx:25`, `:315`, `:413` ; `server.py:4228` | Onglet « À faire » par défaut + 5 chiffres + 6 jauges + revenu/coûts (§ 9) ; corriger `views_count`→`views`, le compteur KYC, l'affichage des noms, le délai médian en minutes | M |
| C10 | **Majeur** | Mise en relation avocat = promesse d'intervention humaine sans valeur | `server.py:3740-3782` | Page statique « vos conseils » ; supprimer l'endpoint et l'e-mail admin | S |
| C11 | **Mineur** | Onglets et code superflus pour le volume : Contrats (génération manuelle, 30 paramètres), crédits/abonnements, Data Room admin, Messages en clair, migration exposée | `desktop-07-contrats.png` ; `business_model.py:50-82` ; `server.py:3045-3110`, `:5773` | Retirer ou réduire (§ 10) ; paramètres juridiques en environnement | M |
| C12 | **Mineur** | Admin inutilisable sur mobile : cinq tuiles empilées avant les onglets, débordement horizontal de l'onglet Annonces | `mobile-01-metrics.png`, `mobile-02-annonces.png` (505 px rendus pour 390 px) | Tuiles en 2 colonnes, cartes d'annonce en colonne, boutons en pleine largeur ; ou accepter « desktop only » et le dire | S |
| C13 | **Mineur** | E-mails : bouton unique vers `/login`, salutation « Bonjour seller SAS », émoji en objet, adresses admin incohérentes, pas de reply-to explicite | `business_model.py:208`, `server.py:1664`, `:4467`, `:1681`, `:3768`, `:3907` | Lien profond par modèle (`link` déjà supporté par `email_user`), « Bonjour, » sans nom, un seul `ADMIN_NOTIFICATION_EMAIL`, reply-to vers la boîte lue | S |
| C14 | **Mineur** | Alertes acquéreurs : e-mail figé à la création, pas de déclencheur « baisse de prix », rien pour les acquéreurs sans alerte | `server.py:4441-4490` | Lire l'e-mail courant de l'utilisateur ; événement prix ; digest hebdo | S |

---

## 12. Coût de fonctionnement des automatismes proposés

| Poste | Aujourd'hui | Après | Remarque |
|---|---|---|---|
| Tâches planifiées | Boucle in-process, 0 € | Idem, 6 à 10 règles de plus, toujours horaires/quotidiennes | Aucun nouveau composant ; `claim_once` déjà là |
| E-mails Brevo | ~5 e-mails par parcours vendeur, ~6 par parcours acquéreur | ×2 à ×3 avec les séquences | Pour 100 inscriptions/mois : < 2 000 e-mails/mois, dans le palier gratuit (300/jour) ou 19 €/mois |
| Vérification d'identité | Stripe Identity ~1,5 € | Inchangé ; relancer les non-vérifiés ne coûte que si ils vérifient | Prévoir 100 à 300 €/mois à 100-200 vérifications |
| Données publiques | ADEME RGE, recherche-entreprises | + BODACC | Gratuites, sans clé pour BODACC et recherche-entreprises |
| Facturation / encaissement | Manuel | Stripe Invoicing (~0,4 % par facture payée, plafonné) ou outil comptable déjà utilisé par AlterEgo | Sur une commission de 30 000 € TTC, ~120 € ; négligeable face au risque d'oubli |
| Temps fondateur | Quotidien, non borné | 15 min/semaine + exceptions signalées | C'est l'objectif |

---

## Annexe A — Endpoints admin (`backend/server.py`)

`GET /admin/stats` (4013) · `GET /admin/users` (4035) · `PUT /admin/kyc/{id}/validate` (4043) · `GET /admin/metrics` (4129) · `GET /admin/companies` (4532) · `POST /admin/users/{id}/reset-password` (4552) · `GET /admin/documents` (4586) · `GET /admin/stripe/payments` (4602) · `GET /admin/stripe/subscriptions` (4629) · `GET /admin/messages` (4708) · `GET /admin/dataroom/{id}` (4733) · `GET /admin/transactions` (4765) · `GET/PUT /admin/contracts/templates` (5276/5293) · `GET/PUT /admin/contracts/settings` (5315/5325) · `POST /admin/contracts/generate` (5344) · `GET /admin/contracts/generated` (5479) · `GET /admin/contracts/{id}` (5498) · `PUT /admin/contracts/{id}/send` (5510) · `GET /admin/mandates` (5740) · `GET /admin/mandates/export.csv` (5760) · `POST /admin/migrations/mandate-backfill` (5773) · `GET /admin/invoices` (3826) · `POST /admin/jobs/run` (6199) · `GET /credits/check-refunds` (3935) · et, hors préfixe, `PUT /companies/{id}/status` (1841, admin seulement).

Statuts d'annonce : `draft → mandat_en_attente → pending → published | rejected → sold | archived` ; **`pending → published` et `→ rejected` exigent un clic admin** sauf auto-publication (`server.py:1486`). Statuts de demande d'accès (`pending / loi_pending / granted / rejected`) et d'offre (`pending / accepted / rejected / expired`) sont pilotés par le vendeur, pas par l'admin. Closing : `pending_confirmation` jamais confirmé par personne ; facture : `a_valider` jamais validée.

## Annexe B — Index des captures (`audit/autonomie-admin/`)

`desktop-01-metrics.png`, `desktop-02-annonces.png`, `desktop-03-utilisateurs.png`, `desktop-04-messages.png`, `desktop-05-transactions.png`, `desktop-06-dataroom-empty.png`, `desktop-07-contrats.png`, `desktop-08-mandats.png`, `desktop-09-dataroom-company.png`, `desktop-10-suivi-invalid-token.png` et leurs équivalents `mobile-*.png` ; e-mails rendus : `email-01-welcome.png`, `email-02-mandat.png`, `email-03-recue.png`, `email-04-admin-pending.png`, `email-05-published.png`, `email-06-new-contact.png`, `email-07-alert.png`, `email-08-offer.png`, `email-09-rejected.png`, `email-10-seller-no-listing.png` ; journal : `console-log.txt` ; script : `admin.js`.
