# CessionRGE v2 — Rapport d'écarts (référentiel business model ↔ code existant)

> Réponse à la section 9.1 du référentiel. **Aucune fonctionnalité v2 n'est implémentée tant que Micael n'a pas arbitré.**
> État du code : branche `main` au 25/09/2026, après la PR #1 (lancement gratuit, audit sécurité, emails, suivi du test, SEO).

---

## 1. Analyse critique du modèle

### Ce qui est solide
- **Le positionnement** : réseau fermé de pros RGE vérifiés, face aux groupes Facebook ouverts et non vérifiés. C'est un vrai problème, et le différenciateur est clair.
- **La cession comme produit d'appel**, avec une publication gratuite : c'est cohérent, puisque les vendeurs sont le côté rare de la place de marché.
- **Le KYC du repreneur déclenché par le cédant** : c'est la bonne idée du document. Le coût du KYC ne concerne que les candidats sérieux, et c'est le cédant qui contrôle à qui son identité est révélée.
- **Le courtage CEE** : les contrats avec les obligés sont déjà signés, le besoin est récurrent et le produit reste simple (formulaire + back-office). C'est **le revenu le plus rapide à obtenir**.
- **Les verrous légaux identifiés** : mandat préalable, interdiction de percevoir quoi que ce soit avant la conclusion, rôle actif et incitatif pour les CEE.

### Points de vigilance (à arbitrer)
1. **Le barème bute sur la taille réelle des entreprises RGE.** La plupart sont des TPE : chiffre d'affaires de 300 k€ à 2 M€, prix de cession souvent entre 50 et 400 k€.
   - Avec un minimum de 9 000 € HT, une cession à 80 k€ coûte 11 % HT (13,5 % TTC pour un cédant non assujetti).
   - Plus le taux effectif est élevé, plus le risque de contournement est fort (voir point 2), et plus la signature du mandat devient difficile.
   - Pistes : un plancher plus bas (5 000 à 6 000 €), ou un plancher seulement au-delà d'un certain prix.
2. **Le principe « jamais de contact direct » est irréaliste pour une cession.** Après le NDA, les parties doivent se rencontrer, visiter et faire intervenir leurs conseils.
   - La vraie protection est juridique : mandat signé avant la présentation, clause de suite (« tail ») et non-contournement dans le NDA ou la LOI. Elle n'est pas technique.
   - Recommandation : garder une messagerie pseudonymisée jusqu'au NDA, puis laisser les échanges se faire librement, protégés par le mandat.
3. **Le parcours repreneur est très filtré** : OTP e-mail + SMS, profil complet, justificatif de financement, validation admin, décision du cédant, KYC, NDA.
   - Pour un test de marché, chaque filtre divise la demande.
   - Recommandation : justificatif de financement **facultatif et déclaratif** au départ, et qualification par l'admin au téléphone. On durcit une fois le volume atteint.
4. **Les annonces derrière connexion (étape 5.1-5) suppriment le référencement.** Une annonce visible seulement après inscription n'est pas indexée par Google.
   - Recommandation : laisser **publics** les teasers anonymisés (activité, région, tranches), comme aujourd'hui, et réserver le détail aux membres.
5. **La transmission de la qualification RGE est l'argument central, et elle est fragile.**
   - En cession de fonds de commerce, la qualification ne suit pas.
   - En cession de titres, elle reste attachée à la société, mais dépend du référent technique, qui peut partir avec le cédant.
   - La plateforme doit l'expliquer (un guide SEO est en cours d'écriture) et le signaler dans chaque annonce.
6. **La mise en relation sous-traitants et fournisseurs (4.2) est un autre métier.**
   - « Besoin client entrant » signifie générer des demandes de particuliers : c'est un marché concurrentiel, et le démarchage en rénovation énergétique est très encadré. Cela implique aussi des données personnelles de particuliers (RGPD).
   - La commission négociée au cas par cas ne passe pas à l'échelle.
   - Recommandation : **reporter** ce chantier (PR 3) et le valider d'abord à la main (tableur + bon de mise en relation signé), sans développement.
7. **Afficher TTC avant HT** est l'obligation vis-à-vis des consommateurs. Entre professionnels, l'usage est HT d'abord.
   - Les cédants sont des dirigeants de société (des pros) ; seul le cédant personne physique qui vend ses titres paie réellement le TTC.
   - À confirmer ; le code peut gérer les deux.
8. **Carte T, Hoguet et LCB-FT.**
   - La loi Hoguet couvre les fonds de commerce et certaines parts sociales. Les cessions d'actions de SAS relèvent de l'intermédiation libre (le mandat de « courtage » du référentiel), ce qui est cohérent.
   - En revanche, un titulaire de carte T est assujetti à la lutte anti-blanchiment : identification **des deux parties**, conservation des pièces 5 ans, déclarations TRACFIN. Cela peut imposer le KYC du repreneur **avant la conclusion**, et pas seulement si le cédant le décide.
   - **À valider par le conseil d'AlterEgo.**
9. **Le parcours doit rester simple pour les vendeurs.** Le mandat e-signé avant publication est incontournable, mais il doit se signer en une étape dans le parcours de dépôt, pas par un circuit séparé.

### Conflits avec l'état actuel du site (à trancher avant la v2)
| Sujet | Aujourd'hui (en production après la PR #1) | Référentiel v2 |
|---|---|---|
| Discours commercial | « Gratuit, **aucune commission, même si la vente aboutit** » (accueil, FAQ, e-mails) | Commission 10 / 8 / 6 %, minimum 9 000 € HT |
| LOI signée | Clause 9 : « aucune commission n'est due à la Plateforme » | Commission due au closing |
| Contact | Messagerie directe acquéreur ↔ vendeur, dès le premier contact | Jamais de contact direct avant NDA / validation |
| KYC | Repreneur vérifié **avant** tout contact, à son initiative | KYC déclenché par le cédant, après validation admin |
| Annonces | Teasers anonymes **publics** (et indexés) | Accès après inscription |
| Publication | Automatique si identité et dirigeant vérifiés, sinon validation admin | Toujours mandat + validation admin |

⚠️ **Point juridique immédiat** : toute LOI signée pendant la phase gratuite exclut par écrit la commission. Il faut **décider maintenant** si la phase gratuite continue ou non, pour ne pas multiplier ces LOI. Les textes du site sont désormais centralisés dans `frontend/src/lib/offer.js` (refonte SEO en cours), donc changer de discours prendra quelques minutes.

---

## 2. Écarts par domaine

Légende : ✅ existe · 🔧 à étendre · 🆕 à créer

### 2.1 Comptes, rôles, entreprises
| Élément | État | Détail |
|---|---|---|
| Rôles | 🔧 | Un seul rôle texte (`buyer` / `seller` / `admin`). À passer en `roles[]` : cedant, repreneur, sous_traitant, fournisseur, installateur, admin. Migration : buyer→repreneur, seller→cedant. |
| `Company` | 🆕 | Aujourd'hui `company_name` / `siret` sont sur l'utilisateur et sur l'annonce. Créer la collection `companies_registry` (SIRET, forme sociale, qualifications RGE, `rge_checked_at`). **Attention au conflit de nom** : la collection `companies` contient aujourd'hui… les annonces. Proposer `listings` comme alias progressif. |
| Vérification SIRET / RGE | 🔧 | Appel à l'API RGE ADEME à l'inscription vendeur et dans l'annonce. Manquent : la revérification périodique et l'alerte d'expiration (la tâche horaire existe, il suffit d'y ajouter ce contrôle). |
| OTP e-mail / téléphone | 🆕 | Inexistant. SMS via Brevo (≈ 0,045 € par SMS). |

### 2.2 Cession
| Élément | État | Détail |
|---|---|---|
| Annonce anonymisée | ✅ | Raison sociale et SIRET masqués jusqu'au NDA, tests en place. |
| Statuts d'annonce | 🔧 | Actuels : `draft`, `pending`, `published`, `rejected`, `sold`, `archived`. À aligner : `brouillon → mandat_en_attente → en_validation → publiee → sous_offre → vendue / retiree / expiree` (correspondance des statuts + feature flag). |
| Mandat | 🔧 | Routes `/seller/mandat/generate|sign|status` et un modèle de **mandat exclusif** existent, mais : pas obligatoire pour publier, **pas de registre séquentiel**, signature « maison » (clic + empreinte SHA-256), **non conforme eIDAS**, pas de n° de carte T. |
| Registre des mandats | 🆕 | Compteur atomique sans trou, lecture seule, export. |
| Signature électronique eIDAS | 🆕 | Aucun prestataire intégré. Proposition : **Yousign** (API française, signature avancée, environ 1 à 2 € par signature ou abonnement). À arbitrer. |
| Barème | 🔧 | Existant : 9 / 7 / 5 %, minimum 7 500 €, tranches **≤ 500 k€ / 500 k€ – 1,5 M€ / > 1,5 M€** (`business_model.py`). Les réglages des contrats indiquent aussi 5 % / 5 000 € (**incohérence**). À passer en 10 / 8 / 6 %, minimum 9 000 € HT, paramétrable en admin, avec débiteur par mandat. |
| Crédits repreneur | ✅ | Désactivés par `FREE_MODE=true` (équivaut à `FF_BUYER_CREDITS=false`). Code et données conservés. Aucun crédit acheté en production à notre connaissance (à vérifier en base). |
| Profil repreneur | 🆕 | Inexistant (type, expérience, zones, fourchette, justificatif, validation admin). |
| Deal (intérêt) | 🔧 | Aujourd'hui trois objets épars : `contacts`, `dataroom_access` (`pending` / `loi_pending` / `granted` / `rejected`) et `offers`. À unifier dans `deals` avec les statuts du référentiel. |
| Validation admin de l'intérêt | 🆕 | Aujourd'hui le repreneur contacte directement le cédant. |
| Profil pseudonymisé présenté au cédant | 🆕 | — |
| KYC déclenché par le cédant | 🔧 | Stripe Identity est intégré (environ 1,50 $ la vérification), mais déclenché par l'utilisateur lui-même. À ajouter : déclenchement par le cédant, quota par annonce, réutilisation pendant 12 mois (`KycCheck.valid_until`), coût journalisé. |
| NDA | ✅ 🔧 | NDA généré et signé, identité révélée après signature. À basculer sur une e-signature eIDAS et à rattacher au Deal. |
| Data room | ✅ 🔧 | Documents par annonce, **filigrane incrusté**, journal des consultations, pas de téléchargement. Manquent : ouverture après **NDA + KYC** (aujourd'hui après LOI), **révocation**, **visibilité document par document**, filigrane avec le **nom** (aujourd'hui l'e-mail). |
| Détection de concurrent | 🆕 | Même métier et même zone → badge admin et cédant. |
| Relance du cédant (N jours) | 🔧 | La tâche « vendeur sans réponse depuis 3 jours » existe, il faut l'adapter au statut `presente_cedant`. |
| Transaction et commission | 🔧 | `POST /closing/declare` et le calcul de commission existent. À réserver à l'admin et à relier à la facturation. |

### 2.3 Mise en relation sous-traitants / fournisseurs — 🆕 en totalité
`ProProfile`, `Need` (contact client réservé à l'admin et chiffré), `ReferralVoucher` (pourcentage ou forfait, exigibilité, e-signature, révélation horodatée), `ContactRevealLog`, relances et annuaire des pros. **Rien n'existe.**

### 2.4 Courtage CEE — 🆕 en totalité
`CeeRequest` (refus automatique si le devis est signé, date prévue du devis, date du cadre de contribution + alerte), `Obligee` (modalités de commission), saisie et comparatif des offres, suivi jusqu'au paiement.

### 2.5 Campagnes — 🆕
Ciblage (métier, zone, catégorie), envoi Brevo avec lien de désinscription, suivi des retours. La base e-mail transactionnel et la newsletter existent.

### 2.6 Facturation — 🆕
Numérotation légale continue, PDF de facture AlterEgo, TVA, statuts, relances, export comptable. Rien n'existe. Pour les factures conformes, une alternative est de passer par un outil du marché (Pennylane, Qonto…) via API.

### 2.7 Back-office admin
Existant : suivi du test (entonnoir), annonces, utilisateurs, messages, transactions, data rooms, contrats et réglages. À créer : pipeline des Deals, registre des mandats, besoins et bons, annuaire des pros, CEE, obligés, facturation, tableau de bord des éléments en attente.

### 2.8 Juridique et configuration
| Élément | État |
|---|---|
| Coordonnées AlterEgo en configuration centrale | ✅ (`LEGAL_ENTITY` + `GET /api/public/legal-info`, surchargeables par `LEGAL_*`). Les contrats utilisent désormais AlterEgo au lieu de l'identité fictive. **Attention** : si des réglages de contrats ont été enregistrés en admin, ils priment sur ces valeurs. |
| N° de carte T | ❌ à fournir (`LEGAL_CARTE_T`) |
| Mentions légales / confidentialité | 🔧 pages en cours de création (refonte SEO), **à faire valider par un conseil** |
| CGU pros avec non-contournement 24 mois | 🆕 texte juridique à rédiger par un avocat |
| Aucune référence à Martto | ✅ vérifié : aucune occurrence dans le code |

---

## 3. Fuites de coordonnées actuelles (priorité absolue)

Déjà corrigées en PR #1 : raison sociale / SIRET / e-mail du vendeur dans les API publiques, pièces d'identité renvoyées aux vendeurs, signatures lisibles par des tiers, mandat lisible par tous.

**Encore présentes selon les règles strictes du référentiel (6.2) :**
1. **Messagerie** : chaque message renvoie `sender_email` (12 endroits dans le code). Le vendeur voit l'e-mail de l'acheteur et l'acheteur celui du vendeur, **dès le premier message**.
2. **Messagerie libre** : rien n'empêche d'écrire son téléphone dans un message (contournement direct). Il faudrait un filtrage des numéros et e-mails dans les messages avant NDA, avec alerte admin.
3. **Demandes d'accès à la data room** : le vendeur reçoit `buyer_email` et l'e-mail dans `buyer`.
4. **Offres** : `buyer_email` stocké et renvoyé au vendeur.
5. **Signatures** (`/documents/{id}/signed`) : le vendeur voit `signer_email` de l'acheteur.
6. **PDF « accord de principe »** : contient les e-mails et téléphones des deux parties.
7. **Après NDA** : raison sociale, SIRET et nom du vendeur sont révélés à l'acheteur. C'est voulu aujourd'hui ; à confirmer dans la v2 (révélation après KYC **et** NDA).
8. **Journal des révélations (`ContactRevealLog`)** : inexistant. Les journaux d'audit de la data room existent mais ne couvrent pas les révélations de coordonnées.

Estimation de la correction des points 1 à 6 : **8 à 12 h**, faisable immédiatement et sans dépendre des autres arbitrages.

---

## 4. Plan de PRs chiffré

Les estimations incluent les tests pytest de chaque verrou 🔒 (section 9.4), les feature flags et des migrations idempotentes (`--dry-run` / `--rollback`).

| PR | Contenu | Estimation |
|---|---|---|
| **v2-1** | Fuites de coordonnées (section 3) + `roles[]` + collection entreprises + migrations | 20 – 28 h |
| **v2-2** | Mandat obligatoire + registre séquentiel + intégration e-signature eIDAS + barème paramétrable + statuts d'annonce + rattrapage des annonces existantes (`mandat_en_attente` derrière un flag) | 35 – 45 h |
| **v2-2 bis** | Entonnoir repreneur : profil, OTP, Deal unifié, validation admin, présentation pseudonymisée, décision du cédant, KYC déclenché par le cédant (quota, réutilisation 12 mois, coût), NDA e-signé, data room par document + révocation, détection de concurrent, alertes | 55 – 75 h |
| **v2-3** | Pros, besoins, bons de mise en relation, révélation journalisée, back-office, annuaire | 50 – 70 h |
| **v2-4** | Courtage CEE + obligés + offres + alertes de dates | 30 – 40 h |
| **v2-5** | Campagnes | 20 – 30 h |
| **v2-6** | Facturation unifiée + relances + export (ou intégration d'un outil de facturation) | 30 – 45 h |
| **Total** | | **240 – 333 h** |

**Ordre recommandé** (écart avec la section 10 du référentiel) : v2-1 → v2-2 → **v2-4 (CEE)** → v2-2 bis → v2-6 → v2-3 → v2-5. Le CEE rapporte vite grâce aux contrats déjà signés ; la mise en relation des pros doit d'abord être validée à la main.

Coûts récurrents à prévoir : e-signature (≈ 1 à 2 € par document, ou abonnement), SMS OTP (≈ 0,05 €), Stripe Identity (≈ 1,50 $ par vérification), stockage S3.

---

## 4 bis. Mises à jour du 25/09/2026 (implémentées)

- **Phase gratuite annulée.** Commission vendeur au succès (`FF_SELLER_COMMISSION=true`) ; crédits repreneur désactivés (`FF_BUYER_CREDITS=false`).
- **Minimum de commission supprimé** (réactivable par `COMMISSION_MIN_HT`, 0 par défaut). Exemple : 30 000 € → 3 000 € HT, soit 3 600 € TTC.
- **Tranches** : celles du code sont conservées (≤ 500 000 € / ≤ 1 500 000 € / au-delà). Elles sont définies en configuration serveur (`COMMISSION_RATES`), **pas encore paramétrables depuis l'admin**.
- **Débiteur choisi par le cédant à la signature du mandat.**
  - `commission_payer: "cedant" | "repreneur"` est obligatoire, sans valeur par défaut.
  - Le choix figure en clair dans le texte et le PDF du mandat, et il est figé après signature (y compris côté admin).
  - Chaque mandat reçoit un numéro de registre séquentiel.
  - Si le repreneur paie : l'estimation TTC puis HT est exposée sur l'annonce (`commission_info`) et rappelée dans le NDA.
- **Facture de commission** créée à la déclaration du closing, au nom du débiteur, numérotée `FAC-AAAA-00001`. Sans mandat signé, aucune facture n'est créée (`non_exigible_sans_mandat`).
- **Fuites de coordonnées (section 3, points 1 à 6) corrigées**, avec le journal des révélations au NDA.

⚠️ **À CLARIFIER — effet de seuil du barème.** Le taux de la tranche s'applique à la totalité du prix, donc la commission **baisse** quand le prix franchit un seuil :
- 500 000 € → 50 000 € HT, mais 500 001 € → 40 000 € HT ;
- 1 500 000 € → 120 000 € HT, mais 1 500 001 € → 90 000 € HT.

Deux effets : un cédant a intérêt à annoncer un prix juste au-dessus du seuil, et l'acquéreur qui paie la commission a intérêt à négocier au-dessus. La correction usuelle est un **barème par tranches marginales** (10 % sur les premiers 500 k€, 8 % sur la part entre 500 k€ et 1,5 M€, 6 % au-delà). À arbitrer.

⚠️ **À valider par le conseil** : la commission à la charge de l'acquéreur, dans le cadre de la loi Hoguet (mention dans le mandat et dans l'engagement des parties).

## 5. Points à clarifier (section 11 du référentiel + ajouts)

**Repris du référentiel :**
1. Tranches du barème 10 / 8 / 6 % : conserver ≤ 500 k€ / 500 k€ – 1,5 M€ / > 1,5 M€ ?
2. Débiteur par défaut de la commission de cession.
3. Prestataire de signature électronique (proposition : Yousign).
4. Durée de non-contournement (24 mois proposés).
5. CEE : l'installateur voit-il toutes les offres ou seulement la meilleure ?
6. Délai de relance des pros sans issue déclarée.
7. Crédits repreneur déjà achetés : a priori aucun en production, à vérifier en base.
8. KYC : conserver Stripe Identity (résultats réutilisables 12 mois) ?
9. LCB-FT (carte T) : KYC obligatoire des deux parties ? Durée de conservation des pièces ?

**Ajouts :**

10. **La phase gratuite continue-t-elle ?** Si non : date de bascule, nouveau discours commercial, et nouvelle LOI (avec clause de commission) pour les nouveaux deals.
11. Contact direct après NDA : autorisé (protégé par le mandat) ou tout passe par l'admin jusqu'à l'acte ?
12. Teasers d'annonces publics (référencement) ou réservés aux membres ?
13. Plancher de commission pour les petites cessions (moins de 100 k€).
14. Affichage HT ou TTC en premier pour les pros.
15. Mandat exclusif ou non exclusif par défaut ? Durée ? Le modèle actuel est exclusif, 12 mois.
16. Annonces publiées pendant la phase gratuite : faut-il leur demander de signer le mandat rétroactivement ? Le référentiel prévoit `mandat_en_attente`, mais la commission ne peut porter que sur les présentations faites **après** la signature.
17. Données des particuliers (besoins 4.2) : hébergement, chiffrement, durée de conservation.
