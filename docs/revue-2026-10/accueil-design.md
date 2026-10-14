# Audit accueil, design et pages publiques — CessionRGE

Auditeur : directeur artistique + CRO (lecture seule, 9 octobre 2026).
Périmètre : `/`, `/vendre-mon-entreprise-rge`, `/reprendre-une-entreprise-rge`, `/entreprises-rge-a-vendre` (+ pages activité et région), `/guides` (+ 2 guides), `/search`, `/company/:id` (fiche publique), `/mentions-legales`, `/confidentialite`, `/login`, `/register`, 404.

Dossier de captures : `docs/revue-2026-10/accueil-design/` (noté `CAP/` ci-dessous). Chaque route a une capture `desktop-<nom>.png` (1400×900, pleine page) et `mobile-<nom>.png` (390×844, pleine page) ; `*-fold.png` = au-dessus de la ligne de flottaison ; `*-crop-*.png` = sections isolées ; `report.json` = métriques brutes (poids, erreurs console, réponses API ≥ 400, hauteur, mots, textes < 12 px).

Important sur la lecture des captures : Google Fonts est injoignable dans l'environnement de test (`ERR_CERT_AUTHORITY_INVALID`). Les captures ont été refaites en servant Inter (400–700) depuis `scratchpad/fonts/embedded.css` ; Manrope (titres) n'est pas disponible localement, les titres sont donc rendus en Inter. En production, les titres seront en Manrope : un peu plus « ronds », mais le jugement de hiérarchie et de densité reste valable.

---

## 1. Verdict en une page (sincère)

**Ce site est propre, honnête et techniquement bien fait. Il ne vendra pas.**

- Il est **conçu comme un site de contenu SEO**, pas comme une page de conversion. L'accueil fait 6 178 px de haut (desktop), 10 668 px (mobile), 1 527 mots rendus, 10 sections, 10 CTA. Il explique tout, n'emporte rien.
- Il **parle aux deux côtés en même temps**, et donne la place dominante (le formulaire de recherche, à droite du hero) au côté qui n'est pas rare. Sur une place de marché de cession, le vendeur est l'actif rare ; c'est lui qu'il faut convaincre d'abord, et c'est lui qui a le plus peur (fuite, perte de temps, commission).
- Il **n'apporte aucune preuve qu'un humain sérieux est derrière** : pas de carte T sur l'accueil, pas de nom, pas de photo, pas de chiffre, pas de témoignage, pas de logo partenaire. Pour confier une transaction à 100 k€ – 2 M€ à un site inconnu, c'est rédhibitoire. Le seul élément de confiance tangible (carte professionnelle, CCI Paris IdF) est enfoui dans les mentions légales, sous un bandeau « Document à faire valider par un conseil juridique ».
- Il **montre sa vacuité** : hub « 7 entreprises », grille d'activités avec 12 compteurs à « 0 » sur 18, régions à « 0 » sur 7 sur 14. Un repreneur comprend en trois secondes qu'il n'y a rien à voir ; un vendeur comprend qu'il n'y a pas de repreneurs.
- Il **a un bug visible sur la section tarifs mobile** : la carte « Cédants » (barème) déborde de 48 px et est tronquée à droite (« Au succè », « ...de l'acte de cession » coupé). C'est la section qui doit rassurer sur l'argent, sur l'appareil qu'utilisent les artisans.
- Le **design est un gabarit SaaS générique** (hero sombre avec halos flous, cartes blanches arrondies, icônes Lucide vertes) sans aucune image, illustration, capture produit ni visage. Il n'évoque ni le bâtiment, ni la transmission, ni AlterEgo. Il est « correct » et oubliable.
- Côté modèle : la page répète 12 fois « gratuit » et 17 fois « commission », donne deux exemples (30 000 € → 3 600 € TTC ; 800 000 € → 88 800 € TTC) qui, lus par un artisan, ancrent surtout l'idée « ça coûte cher pour ce que ça fait ». Rien ne dit ce que CessionRGE **fait** pour mériter 10 % HT (sinon « organise la mise en relation » et « n'intervient pas dans la négociation »), ce qui est le vrai problème de proposition de valeur, pas le taux.

Ce qui est bien et doit être conservé est listé en §3. Le reste du document détaille les constats (§4), la direction artistique (§5), la structure d'accueil cible avec textes (§6) et un plan priorisé (§7).

---

## 2. Méthode

- Captures Playwright de toutes les routes de `frontend/scripts/seo-routes.json` (échantillon de pages activité/région, avec et sans annonces), desktop 1400×900 et mobile 390×844, pleine page + ligne de flottaison ; scripts `CAP/shots.js`, `CAP/crops.js`, `CAP/clip.js`, `CAP/contrast.js`.
- Lecture du code : `frontend/src/pages/LandingPage.jsx`, `SeoPages.jsx`, `GuidesPages.jsx`, `AudiencePage.jsx`, `PublicSearch.jsx`, `LegalPages.jsx`, `NotFound.jsx`, `components/seo/Content.jsx`, `components/layout/PublicHeader.jsx` / `PublicFooter.jsx` / `PublicLayout.jsx`, `components/Logo.jsx`, `lib/offer.js`, `lib/seo.js`, `seo/content.json`, `seo/guides.json`, `index.css`, `App.css`, `tailwind.config.js`, `public/index.html`, `scripts/prerender.mjs`, `backend/server.py` (sitemap).
- HTML pré-rendu lu via `curl` (title, description, canonical, robots, H1/H2, JSON-LD).
- Mesures : poids des bundles (`frontend/build/static/js`), contrastes calculés depuis les styles calculés, débordements horizontaux mesurés élément par élément à 390, 360 et 320 px.
- Résultats techniques globaux : 0 erreur `pageerror`, 0 réponse API ≥ 400, 0 texte < 12 px, 0 débordement de la page (mais voir §4.6 : un débordement masqué par `overflow-x-hidden`), chargement local ≈ 0,7–1 s.

---

## 3. Ce qui est bien fait (à ne pas casser)

1. **Offre centralisée** dans `frontend/src/lib/offer.js` : tarif, gratuité, barème, exemples, FAQ, méta-descriptions sont calculés d'une seule source et injectés par `{{jetons}}` dans `seo/content.json`. Changer de modèle prendra une heure, pas une semaine.
2. **Pré-rendu statique complet** (`scripts/prerender.mjs`) : chaque route publique a un `<title>` propre (29–72 caractères), une description (120–255), un canonical, `robots`, des H1 uniques, du JSON-LD (Organization, WebSite+SearchAction, FAQPage, BreadcrumbList, Article). FAQ en `<details>` natif, présentes dans le DOM sans JavaScript. Sitemap et robots.txt corrects.
3. **Contenu éditorial solide et spécifique** : les guides (référent technique, cession de titres vs fonds, décennale, dépendance CEE/MaPrimeRénov', multiple d'EBE retraité) et les pages Vendre / Reprendre sont des textes de métier, pas du remplissage. Avec un sommaire, des FAQ, des notes de prudence. C'est un vrai actif SEO.
4. **Système de composants cohérent** : une palette (navy `#090e1c`, vert `#16a34a`, surface `#f7f8fa`), un rayon (`rounded-2xl`), des cartes, badges, boutons identiques sur toutes les pages publiques ; en-tête et pied de page communs ; fil d'Ariane partout ; 404 utile ; états vides avec CTA « créer une alerte ».
5. **Hygiène technique** : code-splitting des espaces privés (le visiteur ne charge pas pdf.js), aucune erreur console, aucun appel API en erreur, pas de scripts tiers sur le site public (les scripts Emergent/PostHog sont confinés à l'aperçu éditeur), analytics Plausible sans cookie, formulaire de recherche du hero fonctionnel sans JS (GET `/search`).
6. **Accessibilité de base** : contrastes mesurés ≥ 4,5:1 sur tous les textes testés (liens pied de page 8:1, corps 7:1, légendes 4,8:1), labels de formulaire explicites, `aria-label`/`aria-expanded` sur le menu mobile, `<select>` natifs, `aria-current` dans le fil d'Ariane, boutons ≥ 44 px sur mobile.
7. **Honnêteté du discours** : note « CessionRGE organise la mise en relation… avec leurs propres conseils », disclaimers des guides, « qui paie la commission » affiché sur la fiche avant tout contact. Ne pas perdre cette franchise dans la refonte.

---

## 4. Constats détaillés

Gravité : **critique** (empêche la conversion ou détruit la confiance) · **majeur** (coûte des conversions, à corriger avant lancement) · **mineur** (finition).

### 4.1 Promesse en 5 secondes et hiérarchie — critique

Captures : `CAP/desktop-home-fold.png`, `CAP/mobile-home-fold.png`.

- **Ce qu'on comprend** : « Cédez ou reprenez une entreprise RGE, en toute confidentialité » + un formulaire « Trouver une entreprise à reprendre ». On comprend le secteur. On ne comprend **ni qui est derrière, ni pourquoi ce site plutôt qu'un cabinet ou le bouche-à-oreille, ni ce que ça coûte vraiment**.
- **Deux cibles, trois entrées acheteur, une entrée vendeur** au-dessus de la ligne de flottaison : bouton « Je cherche une entreprise », formulaire de recherche (4 champs + bouton « Voir les entreprises »), et le lien de navigation « Entreprises à vendre ». Le formulaire occupe ~45 % de la largeur du hero (`LandingPage.jsx:436-481`). Le vendeur n'a qu'un bouton blanc « Je vends mon entreprise » (`:421-425`) qui envoie sur **/register brut**, sans rôle présélectionné (`RegisterPage.jsx:30-35` ne lit que `redirect` et `email`), sans en-tête, sans rappel de l'offre, avec un bouton « Créer mon compte » gris tant que le menu « Je suis * » n'est pas renseigné (`CAP/desktop-register.png`).
- **Le H1 contient du jargon pour la moitié de l'audience** : « RGE » parle aux artisans du secteur, pas à un cadre en reconversion ou à un groupe qui cherche « une boîte de pompes à chaleur ». Aucune mention de « artisans », « PME du bâtiment », « rénovation énergétique » dans le H1/sous-titre.
- **Sur mobile**, le H1 occupe 4 lignes (`text-4xl`), suivi de 4 lignes de paragraphe, de deux boutons pleine largeur puis d'un formulaire de 4 champs : l'utilisateur doit défiler ~1 400 px avant de voir la première preuve (« Annonces anonymes… »).
- **Le badge « Publication gratuite · Commission uniquement en cas de vente »** est le premier élément lu. Il ancre d'emblée la conversation sur le prix, avant la valeur. Et il est répété : « gratuit » 12 fois, « commission » 17 fois dans la page rendue.

Recommandation : un hero mono-cible vendeur (le côté rare), sur fond clair, avec une preuve d'autorité immédiate (opérateur, carte T, contrôle ADEME), un CTA principal unique, et une entrée secondaire discrète « Je cherche une entreprise → » ; déplacer le formulaire de recherche sur `/search` et le hub (ils existent déjà). Voir §6 pour les textes.

### 4.2 Preuves de confiance — critique

Captures : `CAP/desktop-crop-trust.png`, `CAP/desktop-crop-footer.png`, `CAP/desktop-mentions.png`.

Ce qu'une place de marché B2B sérieuse (cession ou immobilier d'entreprise) montre sur son accueil : qui opère, sous quel statut, depuis quand, combien de dossiers, quels partenaires, des visages, des avis. Ici :

- **Carte T absente de l'accueil et du pied de page.** La seule occurrence (« n° CPI 7801 2025 000 000 049 — délivrée par la CCI Paris Île-de-France ») est dans `/mentions-legales`, juste sous un bandeau ambre « Document à faire valider par un conseil juridique. » (`components/seo/Content.jsx:150-155`, affiché tant que `REACT_APP_LEGAL_DRAFT` ≠ `false`). Le JSON-LD Organization ne la mentionne pas non plus.
- **Aucun chiffre** (annonces publiées, repreneurs inscrits, régions couvertes, délai moyen), **aucun témoignage**, **aucun logo** (ADEME, Stripe, Qualibat, CCI, Brevo…), **aucun humain** (le fondateur n'apparaît nulle part : ni nom, ni photo, ni « un seul interlocuteur »).
- La barre « garanties » (`LandingPage.jsx:483-501`) est quatre affirmations auto-déclarées avec icônes vertes, sans preuve. « Certification vérifiée — Qualifications RGE contrôlées auprès de l'ADEME » est pourtant une vraie preuve technique : il faut la montrer (capture du contrôle, lien vers la base), pas l'affirmer.
- Pied de page : un e-mail (`contact@cessionrge.fr`) et « marque exploitée par AlterEgo ». Pas d'adresse, pas de SIREN, pas de téléphone, pas de carte T.
- Pages légales publiques avec des trous : « Garantie financière / non-détention de fonds : à compléter » (`CAP/desktop-mentions.png`), « durée à préciser » ×4 dans `/confidentialite` (`seo/content.json`, section `durees`). Un visiteur qui vérifie (et dans ce secteur, il vérifie) conclut que le site n'est pas fini.

Recommandation : bandeau d'autorité sous le hero (« Opéré par AlterEgo SAS, titulaire de la carte professionnelle T n° CPI 7801 2025 000 000 049 délivrée par la CCI Paris Île-de-France · Qualifications contrôlées sur la base ADEME · Identité des membres vérifiée par Stripe Identity · Aucun frais avant la signature de l'acte ») ; bloc « Qui est derrière CessionRGE » avec photo et nom du fondateur, 3 phrases, un lien « prendre 15 minutes » ; pied de page avec raison sociale, adresse, SIREN, carte T ; compléter les mentions et passer `REACT_APP_LEGAL_DRAFT=false` ; ajouter `carte T` dans `organizationLd` (`seo/schema.js`).

### 4.3 Vacuité visible (démarrage à froid) — critique

Captures : `CAP/desktop-hub.png`, `CAP/desktop-reg-corse-empty.png`, `CAP/desktop-act-vmc-empty.png`, `CAP/desktop-crop-latest.png`.

- Hub : « Actuellement, **7 entreprises** sont proposées à la reprise » (`SeoPages.jsx:131-135`), puis 18 activités dont 12 à « 0 », 14 régions dont 7 à « 0 » (`CountBadge`, `:42-46`). Chaque page activité/région répète les deux grilles avec les zéros (`:315-340`).
- Pages vides : « 0 annonce disponible » en H2 (`:255`), carte vide, et pourtant 2 600 px de page (grilles, guides, CTA) : un lecteur voit une page « doorway ».
- Accueil : « Dernières entreprises à reprendre » montre 3 cartes sans titre, identifiées par leurs seules qualifications ; pas d'effectif, pas d'année, pas de « qui paie la commission » (`LandingPage.jsx:503-541`) alors que `/search` affiche salariés, création, EBITDA, marge, structure. Deux cartes différentes pour le même objet sur deux pages (`CAP/desktop-search.png` vs `CAP/desktop-crop-latest.png`).

Recommandation : tant que l'inventaire < 30, **ne jamais afficher un compteur à 0** (`CountBadge` : masquer si 0, ou n'afficher que les activités/régions pourvues et replier le reste) ; sur le hub, remplacer « 7 entreprises » par un message de dynamique (« Nouvelles annonces chaque semaine · X repreneurs inscrits · créez une alerte ») ; sur les pages vides, faire de l'alerte **le** contenu (formulaire d'alerte inline, pas un lien vers /register) ; unifier la carte d'annonce (un composant `ListingCard` utilisé sur accueil, hub, activité, région, search) avec un titre lisible (« Installateur PAC et chauffe-eau, Bretagne, 9 salariés »), prix, CA, EBITDA, effectif, « commission à la charge du vendeur/acquéreur ».

### 4.4 Tarifs et objections — majeur

Captures : `CAP/desktop-home-pricing.png`, `CAP/desktop-home-faq-cost-open.png`, `CAP/mobile390-pricing-viewport.png`.

- **La section tarifs est déséquilibrée** : carte « Cédants » à 4 puces + tableau + légende, carte « Repreneurs » à 4 puces et 60 % de vide (`LandingPage.jsx:583-621`). Le tableau utilise des espaces insécables partout (`lib/offer.js:41-43`), donc « 12 % TTC (10 % HT) » ne peut pas se couper → voir bug mobile §4.6.
- **TTC d'abord** (`offer.js:20` « Règle d'affichage : TTC d'abord, HT à côté ») : les cédants sont des dirigeants de sociétés, le réflexe B2B est HT. Afficher « 12 % TTC » en gras rend le barème 20 % plus cher à la première lecture. Le rapport v2 (`docs/business-model-v2-rapport-ecarts.md`, point 7) le signalait déjà. Recommandation : HT en gras, TTC entre parenthèses ; TTC d'abord uniquement sur le mandat pour un cédant personne physique.
- **Jargon** : « tranches successives », « formule de Lehman utilisée par les cabinets de cession », « sans effet de seuil » (3 fois sur la page). Un artisan ne connaît pas Lehman ; un repreneur professionnel n'a pas besoin qu'on le lui explique. Remplacer par un **simulateur** (champ prix → commission HT/TTC → « qui paie : vous choisissez ») : le composant `computeCommission` existe déjà (`offer.js:51-62`), il suffit de l'exposer.
- **Les deux exemples** (30 000 € → 3 600 € TTC ; 800 000 € → 88 800 € TTC) sont mal choisis : 30 k€ n'est pas un cas RGE réaliste et ancre « même une micro-vente paie », 88 800 € est un chiffre effrayant pour une page d'accueil. Un seul exemple médian (250 k€ → 25 000 € HT, « soit moins que l'écart de prix obtenu avec plusieurs repreneurs en concurrence ») fait mieux.
- **Objections non traitées** sur l'accueil (FAQ `seo/content.json` → `home.faq`, 8 questions) :
  - « Combien de temps ça prend ? » : absent partout (accueil, Vendre, Reprendre). Un cédant veut savoir : « première prise de contact sous X jours, délai moyen de cession 6–12 mois ».
  - « Qui sont les repreneurs ? » : « Membres identifiés » dit qu'ils ont une pièce d'identité, pas qu'ils ont de l'argent ou un projet. Décrire les profils (artisans en croissance, groupes du bâtiment, cadres en reconversion — le texte existe dans `audiences.vendre.lead`) et le filtre (identité vérifiée, NDA signé avant toute révélation).
  - « Et si je vends par moi-même à quelqu'un rencontré ici ? » (clause de suite du mandat) : à annoncer franchement, c'est la base de la confiance sur un mandat.
  - « Que faites-vous pour 10 % ? » : la réponse actuelle (« CessionRGE organise la mise en relation… n'intervient pas dans la négociation ») est une anti-vente. Il faut lister ce que la plateforme fait réellement : anonymisation, qualification des repreneurs (KYC), NDA/LOI signés par code, data room filigranée avec journal, suivi des offres, e-mails de relance, mandat et registre. Tout cela existe dans le produit et n'est pas vendu.

### 4.5 Direction artistique actuelle — majeur

Captures : `CAP/desktop-home.png`, `CAP/desktop-vendre-fold.png`, `CAP/desktop-guides.png`, `CAP/og-image` = `frontend/build/og-image.png`.

- **Gabarit SaaS générique** : hero en dégradé navy → navy-light avec deux halos flous (`LandingPage.jsx:398-402`), cartes blanches `rounded-2xl`, icônes Lucide 28 px en vert, badges pastel. C'est exactement l'esthétique par défaut d'un starter Tailwind/shadcn. Rien n'évoque le bâtiment, le chantier, la transmission, le patrimoine.
- **Zéro image** : `document.images.length = 0` sur toutes les pages (`report.json`, champ `imgs`). Pas de photo, pas d'illustration, pas de capture du produit (une annonce anonyme, l'écran de révélation après NDA, la data room filigranée sont pourtant très montrables), pas de carte de France. L'OG image (`og-image.png`, 383 Ko pour un simple texte sur dégradé) reprend le même vide.
- **Le vert `#16a34a` sur navy** comme couleur d'accent du H1 (« en toute confidentialité ») fait « éco-start-up », pas « cession d'entreprise ». Le logo (maison + feuille) va dans le même sens « rénovation énergétique grand public » alors que la cible est B2B/transmission.
- **Typographie** : Manrope (titres) + Inter (texte), chargées depuis Google Fonts (`public/index.html:22-24`). Échelle : H1 60 px desktop / 36 px mobile, H2 36 px, corps 16 px, légendes 12 px (`text-xs`) utilisées pour des informations importantes (légende du barème, aide de recherche, note newsletter). Les titres de cartes (`font-display font-bold`, 16 px) sont trop proches du corps : la hiérarchie H2 → H3 → corps est plate à l'intérieur des sections (visible sur `CAP/desktop-crop-guides.png`).
- **Cohérence** : bonne entre pages publiques, mais **rompue sur la fiche entreprise** (`CAP/desktop-company.png`) : en-tête différent (« ← Retour | CessionRGE | Fiche entreprise | 7/7 Précédente / Suivante »), sans navigation principale, titre générique « Entreprise de rénovation énergétique », « Date non renseignée » ×2, et surtout un encart « Domaines RGE complémentaires — **Nous pouvons accompagner le futur propriétaire dans l'obtention de ces domaines RGE** » qui promet un service que CessionRGE ne fournit pas (`pages/CompanyDetail.jsx`). Les pages `/login` et `/register` n'ont ni en-tête ni pied de page ni rappel de la promesse (`CAP/desktop-login.png`, `CAP/desktop-register.png`).
- **Densité** : accueil à 10 sections ; les sections « Vérificateur RGE » (`:623`, outil utilitaire placé entre tarifs et guides) et « Rejoignez la communauté RGE » (newsletter, `:24-132`, « Recevez nos newsletters avec les actualités du marché RGE ») sont hors sujet pour un site de cession et coûtent de l'attention (et des contacts Brevo payants) sans servir la conversion.

### 4.6 Mobile — critique (bug) + majeur (longueur)

Captures : `CAP/mobile390-pricing-viewport.png`, `CAP/mobile360-pricing-viewport.png`, `CAP/mobile-crop-pricing.png`, `CAP/mobile-home.png`, `CAP/mobile-home-menu-open.png`.

- **Bug : la carte tarifs « Cédants » déborde et est tronquée** à 390, 360 et 320 px : largeur mesurée 422 px pour un viewport de 390 (`CAP/clip.js` : `pricingSeller.right = 438`, `main.scrollWidth = 438`). Visible : « Au succè », « Publication de l'annonce anonyme gratuite » coupé, « payable à la signature de l'acte de cession » coupé, « vendeur ou de l'acquéreur » coupé. Cause : la carte est enfant d'une grille (`grid md:grid-cols-2`, `LandingPage.jsx:590`) sans `min-w-0`, le tableau du barème (`Content.jsx:49-62`) a une largeur minimale de 372 px à cause des espaces insécables (`offer.js:41-43`) et des cellules non coupables ; le `overflow-x-auto` du wrapper ne joue pas car l'élément grille s'élargit. Le débordement est masqué par `overflow-x-hidden` sur `PublicLayout.jsx:6`, donc la page ne défile pas horizontalement : le texte est simplement perdu. Correctif : `min-w-0` sur les enfants de la grille (ou `grid-cols-1` + `minmax(0,1fr)`), `white-space: normal` sur les cellules, ou mieux : supprimer le tableau sur mobile au profit du simulateur / d'une liste à 3 lignes.
- À 320 px, les cartes « Dernières entreprises » débordent aussi (`right = 361`), à cause de `truncate`/`whitespace-nowrap` sur les badges longs.
- **Longueur** : accueil mobile 10 668 px (≈ 13 écrans), Vendre 9 339 px, guide 10 442 px. Le menu mobile est correct (5 entrées), mais le lien « Connexion » est masqué sur desktop < lg et n'apparaît que dans le menu (`PublicHeader.jsx:38`).
- Le formulaire de recherche du hero sur mobile vient **après** les deux boutons, à ~1 000 px : il n'est plus « rapide ».

### 4.7 Performance perçue — mineur

- Bundle principal `main.701e80fb.js` : 624 Ko bruts / **188 Ko gzip** ; CSS 89 Ko / 16 Ko gzip ; `index.html` pré-rendu 46 Ko / 9,5 Ko gzip. C'est acceptable (React 19 + Radix + lucide), pas léger : l'accueil embarque PublicSearch, SeoPages, GuidesPages, AudiencePage, LegalPages (`App.js:8-14`), ce qui est voulu pour le SEO mais pourrait être découpé (seule l'accueil + le layout sont nécessaires au premier rendu).
- pdf.js (`545.*.chunk.js`, 315 Ko / 89 Ko gzip) est bien hors du chemin public.
- **Google Fonts externe** : une requête vers `fonts.googleapis.com` + `fonts.gstatic.com` à chaque visite (`public/index.html:22-24`). Deux problèmes : un transfert d'IP vers Google sans consentement (jurisprudence CNIL/LG München sur Google Fonts) et un délai de rendu des polices. Auto-héberger Inter + Manrope (woff2 latin, ~100 Ko) avec `font-display: swap` ; le fichier `scratchpad/fonts/embedded.css` montre que c'est trivial.
- Aucune image → aucun LCP lourd aujourd'hui ; si des visuels sont ajoutés (§5), les servir en AVIF/WebP ≤ 120 Ko avec `width/height` explicites.
- Le serveur de test ne compresse pas ; vérifier que nginx (Dokploy) active gzip/brotli et un cache long sur `/static`.

### 4.8 Accessibilité — mineur

- Contrastes OK partout (mesures `CAP/contrast.js` ; la valeur 1,47 remontée pour « hero paragraphe » est un artefact : le fond est un `background-image` dégradé, le vrai rapport gris-300 sur navy est ≈ 13:1).
- Le sélecteur « Je vends / Je reprends » utilise `role="tab"` sans `tablist`/`tabpanel` reliés (`LandingPage.jsx:549-557`) ; les lecteurs d'écran annoncent des onglets sans panneau.
- `text-xs` (12 px) pour la légende du barème, l'aide du formulaire et la note newsletter : passer à 13–14 px ; ce sont des textes qui engagent.
- Focus visible : les boutons shadcn ont un `ring` ; les liens-cartes (`LinkGrid`, `GuideCard`) n'ont pas de style de focus distinct de `hover`.
- Les 18 cases à cocher de `/search` (`PublicSearch.jsx:125-134`) avec des libellés de 2–3 lignes forment une colonne de 1 000 px : prévoir des familles repliables (isolation / chauffage / solaire / autres) ; `lib/referentiels.js` a déjà `families`.

### 4.9 Textes — mineur à majeur

- Fautes/typographie : « Certifie RGE » (`LandingPage.jsx:278`, manque l'accent), « SIRET: » sans espace avant les deux-points (`:285`, `:324` ; en français « SIRET : »), « Vendeur (Entreprise RGE) » / « Acheteur (Investisseur/Repreneur) » dans le sélecteur d'inscription (`RegisterPage.jsx:148-149`) alors que le site dit partout « cédant / repreneur ». Les données de test montrent aussi que les valeurs d'activité ne sont pas validées côté serveur (« Pompes a chaleur », « Isolation par l'exterieur » affichés tels quels sur `/search` et la fiche).
- Jargon non expliqué au premier contact : NDA (8 occurrences sur l'accueil), LOI (4), data room, KYC, « formule de Lehman », « tranches successives ». Garder les sigles entre parenthèses après le terme français : « accord de confidentialité (NDA) », « lettre d'intention (LOI) », « espace documents sécurisé (data room) » — c'est fait dans les guides, pas dans les sections courtes de l'accueil.
- Ton : « Rejoignez la communauté RGE », « Bienvenue dans la communauté RGE ! » (`:58-66`) : il n'y a pas de communauté, et le ton « start-up » détonne avec « mandat », « carte T », « acte de cession ». Un cédant de 58 ans ne « rejoint » pas une communauté, il « confie » un dossier.
- Longueur : Vendre = 1 275 mots (bien pour le SEO, mais la page n'a aucun élément visuel ni aucune preuve entre le hero et le pied de page : `CAP/desktop-vendre.png` est un mur de texte avec un sommaire).
- Les H2 des pages SEO sont bons ; le H2 « Annonces » (état chargement) devient « 0 annonce disponible », à reformuler (« Bientôt des annonces en Corse — soyez prévenu »).

### 4.10 SEO on-page — majeur sur deux points, bon ailleurs

Titles/descriptions/H1 lus sur le HTML pré-rendu (voir §2) : tous présents, uniques, de bonne longueur ; JSON-LD valide ; fil d'Ariane ; canonical.

- **Domaine** : canonical, Open Graph, JSON-LD, sitemap et OG image pointent sur `https://cessionrge.alteregopatrimoine.com` (`lib/seo.js:4`, `.env.production`, `docker-compose.yml:43`, `og-image.png`), le contact est `contact@cessionrge.fr`, la marque est « CessionRGE ». Si le domaine cible est `cessionrge.fr` (brief), il faut le fixer **avant** l'indexation : `REACT_APP_SITE_URL`, `FRONTEND_URL`, régénérer `og-image`, et prévoir une 301 depuis le sous-domaine. Un sous-domaine d'un autre nom de marque est aussi un signal de « projet secondaire » pour un visiteur attentif.
- **Fiches `/company/:id` dans le sitemap mais non pré-rendues** (`server.py:4095-4110` ajoute les annonces publiées ; `curl /company/<id>` renvoie le `index.html` générique avec le title par défaut). Google reçoit des URL dont le contenu n'existe que côté client : titre identique à l'accueil, contenu vide au premier passage. Soit pré-rendre les fiches côté serveur (une route backend qui injecte title/description/H1 anonymisés), soit les retirer du sitemap tant que ce n'est pas fait.
- **Pages activité/région vides** (12 + 7) : pré-rendues et indexables avec « 0 annonce », deux grilles de liens et un paragraphe générique : risque de « thin content » / pages satellites. Garder `index` uniquement pour les pages avec ≥ 1 annonce ou un paragraphe « marché » vraiment spécifique (certaines régions en ont un), `noindex,follow` sur les autres jusqu'à ce qu'elles soient pourvues (le modèle `listingModel` le permet facilement).
- `/search` est indexée (`PublicSearch.jsx:37`) avec un H1 « Recherche d'entreprises RGE » et un contenu dynamique ; le hub `/entreprises-rge-a-vendre` cible la même intention. Mettre `/search` en `noindex` et canoniser vers le hub, ou l'inverse, pas les deux.
- Le H1 de l'accueil est bon ; la description (`home.description`) finit par « Publication gratuite, mise en relation gratuite pour les repreneurs. » — l'argument « gratuit » attire du trafic curieux, pas des cédants ; préférer « Opéré par un professionnel carte T. Annonces anonymes, repreneurs vérifiés ».
- `lastmod` manquant sur la plupart des routes du sitemap (seuls les guides et la confidentialité en ont un).

### 4.11 Pages secondaires

- **Vendre** (`CAP/desktop-vendre.png`, `mobile-vendre.png`) : bon texte, bon H1, mais aucune preuve ni visuel, 6 sections + FAQ + guides, CTA « Publier mon annonce gratuitement » → `/register` générique. Pas de bloc « Qui est derrière ». Le tableau du barème y a le même débordement potentiel sur mobile (il est dans `prose-cr`, colonne unique, donc il défile : acceptable mais peu lisible).
- **Reprendre** (`CAP/desktop-reprendre.png`) : CTA « Créer une alerte » → `/register` alors qu'une alerte se configure ailleurs (après inscription) ; promettre une alerte puis demander un compte complet avec téléphone/entreprise est une rupture.
- **Guides** (`CAP/desktop-guides.png`, `desktop-guide-valoriser.png`) : la meilleure partie du site. Manque : auteur (nom, qualité) et date visibles en haut (il y a « Mis à jour le… »), un encart de conversion contextuel au milieu des articles (« Faites estimer votre entreprise RGE » → formulaire), et un visuel par guide.
- **Mentions / confidentialité** : voir §4.2 (bandeau brouillon, « à compléter », « durée à préciser »).
- **404** (`CAP/desktop-404.png`) : bien.
- **Search** (`CAP/desktop-search.png`, `mobile-search.png`) : cartes titrées par la concaténation des qualifications (« Isolation des combles perdus - Isolation des murs par l'extérieur », `PublicSearch.jsx:258`), badge « RGE vérifié » gris, deux boutons par carte dont « Contacter le vendeur » qui renvoie vers l'inscription pour un visiteur (sans dire qu'il faudra vérifier son identité). CTA bas de page « Intéressé par une entreprise ? S'inscrire maintenant » générique.
- **Fiche** (`CAP/desktop-company.png`) : voir §4.5 (en-tête différent, promesse d'accompagnement RGE infondée, « Date non renseignée »). Le bandeau vert « Commission de cession à la charge du vendeur. Aucun frais pour vous, à aucune étape. » est, lui, excellent : clair, rassurant, au bon endroit.
- **Login / Register** : pas d'en-tête, pas de rappel de valeur, pas de choix de rôle visuel (deux grandes cartes « Je cède / Je reprends » valent mieux qu'un `<select>`), bouton désactivé gris qui ressemble à un bug.

### 4.12 Ce que la page vend vs ce qui marchera — remarques business (franches)

1. **Une place de marché vide ne convertit pas des vendeurs.** Tant qu'il n'y a pas 30–50 annonces et quelques centaines de repreneurs, l'accueil doit vendre **le service** (« on trouve et on filtre les repreneurs pour vous, sans que ça se sache ») et la **personne** derrière, pas « parcourez les annonces ». Les annonces viendront des vendeurs convaincus par ça.
2. **« Sans commerciaux » ne veut pas dire « sans humain ».** Une cession se signe rarement sans un échange de 15 minutes. Proposer une seule porte humaine, automatisée dans sa prise (Calendly/Cal.com « 15 min avec Micael » après dépôt d'annonce ou après NDA), est compatible avec un fonctionnement autonome et multiplie la signature des mandats. Tout le reste (KYC, NDA, LOI, data room, relances) est déjà automatisé.
3. **Le prix n'est pas le problème, la valeur perçue l'est.** 10 % HT sur une PME RGE est dans la norme des intermédiaires (les cabinets prennent 5–10 % avec des minimums de 10–20 k€). Mais la page explique le barème sur 400 mots et le service sur une phrase. Inverser.
4. **La newsletter « communauté RGE » est un coût net** (contacts Brevo, temps de rédaction) sans lien avec la conversion. La remplacer par deux aimants ciblés et automatisables : côté cédant, « Estimation indicative de votre entreprise RGE en 2 minutes » (formulaire → e-mail automatique avec fourchette de multiple d'EBE, puis relance vers le dépôt d'annonce) ; côté repreneur, « Alerte nouvelles annonces » sans créer de compte complet (e-mail + critères, compte créé en un clic plus tard).
5. **Le vérificateur RGE** est un bon outil d'acquisition (requêtes « vérifier RGE entreprise », « entreprise RGE SIRET ») mais n'a rien à faire sur l'accueil : lui donner sa page `/verifier-entreprise-rge` indexée, avec un encart « Vous êtes le dirigeant de cette entreprise ? Estimez-la / Déposez une annonce ».
6. **Répondre au vrai risque du mandat** (clause de suite, exclusivité ou non, durée, résiliation) sur la page Vendre, en clair. C'est la première chose qu'un cédant qui a déjà vu un cabinet demandera, et c'est la première raison de ne pas signer.

---

## 5. Direction artistique cible

Objectif : passer de « start-up éco générique » à « intermédiaire de transmission, spécialiste, fiable, moderne ». Référence d'ambiance : les sites de cession/immobilier d'entreprise sérieux (fond clair, chiffres, visages, documents) croisés avec la clarté d'une fintech B2B. Pas de dégradé sombre pleine largeur, pas de halos.

**Palette**
- Encre / texte / boutons : navy `#0b1220` (garder `brand.navy`, légèrement plus bleu que `#090e1c` pour éviter le noir).
- Fond : blanc `#ffffff`, surface `#f5f7fa`, bordures `#e3e7ee`.
- Accent primaire (action, liens, chiffres) : bleu profond `#1d4ed8` (déjà `brand.blue` en `#2563eb` ; ne garder qu'une valeur).
- Accent RGE (badges de qualification, pastille « vérifié ») : vert `#15803d` sur `#dcfce7`, **uniquement** pour marquer le RGE, jamais pour les titres ni les CTA.
- Chaleur (chantier, humain, mise en avant du prix) : ambre `#b45309` sur `#fef3c7`, à petite dose (encart « commission à la charge du vendeur », étiquette « nouveau »).
- Supprimer les dégradés navy→navy-light et les halos ; un seul bloc sombre autorisé (CTA final ou pied de page).

**Typographie** (auto-hébergée, `font-display: swap`)
- Titres : Manrope 700/800 — H1 44–52 px desktop / 32 px mobile, interlettrage −0,01 em ; H2 32 px / 26 px ; H3 20 px.
- Texte : Inter 400/500/600 — corps 17 px desktop / 16 px mobile, interligne 1,6 ; légendes ≥ 13 px ; chiffres tabulaires (`font-variant-numeric: tabular-nums`) pour prix et CA.
- Un seul style de « eyebrow » (13 px, 600, majuscules espacées, navy 60 %) au-dessus des H2 pour structurer les sections.

**Composants**
- `ListingCard` unique (accueil, hub, activité, région, recherche) : titre lisible généré (« Installateur PAC & chauffe-eau · Bretagne · 9 salariés »), 2 badges RGE max + « +n », ligne prix / CA / EBITDA, pastille « commission à la charge du vendeur / de l'acquéreur », année de création. Même composant en version « compacte » pour l'accueil.
- `TrustBar` (bande d'autorité) : 4 preuves avec logos/sceaux (CCI carte T, ADEME, Stripe Identity, « 0 € avant l'acte »).
- `ProcessTimeline` : 4 étapes horizontales desktop / verticales mobile avec un verrou « identité révélée après NDA » dessiné dans la timeline.
- `CommissionCalculator` : champ prix de cession (slider 50 k€ – 3 M€), sortie HT en gros + TTC en petit, phrase « Vous choisissez au mandat qui la paie ». Remplace le tableau sur l'accueil ; le tableau reste sur Vendre et dans la FAQ.
- `FounderCard` : photo, nom, « fondateur, AlterEgo — carte T CCI Paris IdF », 3 lignes, bouton « 15 min pour en parler ».
- `FaqList` existante (bon composant), limitée à 5 questions sur l'accueil.
- Boutons : primaire navy plein, secondaire blanc bordé navy, tertiaire lien bleu avec flèche. Supprimer les boutons blancs sur fond sombre comme CTA principal (ils lisent « secondaire »).

**Illustrations / visuels** (coût maîtrisé, pas de shooting)
- 3–4 photos de chantier libres de droits ou achetées (PAC extérieure, pose d'isolation, toiture PV, menuiserie) traitées en duotone navy/blanc ou en noir et blanc léger : un visuel plein dans le hero (droite), un par guide, un par page Vendre/Reprendre.
- 2 captures produit anonymisées, encadrées dans un navigateur stylisé : une annonce anonyme avec le bandeau « commission à la charge du vendeur », l'écran « Identité révélée après signature du NDA ». Elles montrent ce que le texte répète.
- Une carte de France en SVG (points par région pourvue) remplace la grille de 14 régions à zéro sur le hub quand l'inventaire est faible.
- Un vrai portrait du fondateur. Rien n'augmente plus la confiance à coût nul.
- Logo : garder le mot-symbole, revoir le pictogramme (maison + feuille = rénovation grand public) vers un signe de transmission (deux blocs qui se passent le relais, ou une clé), à faire par un graphiste (budget 300–800 €).

**Ton**
- Vouvoiement, phrases courtes, verbes d'action, chiffres. « Vous », « votre entreprise », « vos repreneurs ».
- Dire ce qu'on fait avant ce qu'on ne fait pas. Les disclaimers restent, en bas, en petit.
- Vocabulaire : « accord de confidentialité (NDA) », « lettre d'intention (LOI) », « espace documents sécurisé », « identité vérifiée », « mandat », « acte de cession ». Bannir « communauté », « rejoignez », « simple et transparent » (dites-le avec un chiffre), « Lehman ».

---

## 6. Structure d'accueil cible, section par section, avec textes

Longueur visée : ≈ 2 800 px desktop, ≈ 5 500 px mobile, ≈ 450 mots rendus, 1 CTA principal répété 3 fois, 1 CTA secondaire.

**0. En-tête**
Logo · Entreprises à vendre · Vendre · Reprendre · Guides · [Connexion] · **[Déposer une annonce]** (primaire, navy). Sur mobile : logo, bouton « Déposer », menu.

**1. Hero (fond blanc, 2 colonnes : texte 55 % / visuel 45 %)**
- Eyebrow : « Cession d'entreprises RGE · opéré par AlterEgo, carte professionnelle T »
- H1 : « Vendez votre entreprise RGE sans que personne ne le sache. »
- Sous-titre : « CessionRGE trouve et filtre les repreneurs pour vous : annonce anonyme, identité des repreneurs vérifiée, accord de confidentialité signé avant toute révélation. Publication gratuite, commission uniquement à la signature de l'acte. »
- CTA principal : « Déposer mon annonce anonyme » → `/register?role=seller` (rôle présélectionné, page avec en-tête et rappel de l'offre).
- CTA secondaire (lien avec flèche) : « Estimer mon entreprise en 2 minutes » (aimant) · plus bas, discret : « Vous cherchez une entreprise à reprendre ? Voir les annonces → ».
- Visuel : capture produit d'une annonce anonyme avec le bandeau « commission à la charge du vendeur » et un cadenas « nom et SIRET révélés après NDA », sur fond photo chantier duotone.

**2. Bande d'autorité (fond surface, 4 colonnes, logos/sceaux)**
« Opéré par AlterEgo SAS, carte professionnelle T n° CPI 7801 2025 000 000 049 délivrée par la CCI Paris Île-de-France » · « Qualifications contrôlées sur la base officielle ADEME » · « Identité des membres vérifiée par Stripe Identity » · « 0 € avant la signature de l'acte, aucun frais pour les repreneurs ».

**3. Pour qui (2 cartes côte à côte)**
- Cédants — « Vous dirigez une entreprise RGE et préparez votre transmission » : « Votre annonce reste anonyme. Seuls des repreneurs identifiés, qui ont signé un accord de confidentialité, découvrent le nom de votre société. Vous choisissez à qui vous parlez. » → « Déposer mon annonce ».
- Repreneurs — « Vous cherchez une entreprise de pompes à chaleur, d'isolation, de photovoltaïque… déjà qualifiée » : « Consultez les annonces sans compte, créez une alerte, contactez les cédants gratuitement après vérification de votre identité. » → « Voir les annonces » / « Créer une alerte ».

**4. Comment ça marche (timeline, bascule Je cède / Je reprends conservée mais en vrais onglets accessibles)**
Cédant : 1 « Déposez votre annonce en 10 minutes — votre SIRET charge vos qualifications RGE » · 2 « Vérifiez votre identité et signez le mandat en ligne par code e-mail » · 3 « Recevez des repreneurs vérifiés, échangez sans dévoiler votre nom » · 4 « Révélez votre identité après NDA, ouvrez votre espace documents après lettre d'intention, recevez les offres ».
Repreneur : 1 « Parcourez et créez une alerte » · 2 « Vérifiez votre identité (5 minutes) » · 3 « Contactez le cédant » · 4 « NDA, lettre d'intention, documents, offre ».
Sous la timeline : « Délai moyen entre le dépôt et le premier contact qualifié : X jours » (à mesurer, puis afficher ; en attendant : « Vous êtes prévenu par e-mail à chaque contact, NDA et offre »).

**5. Annonces récentes (ListingCard compacte ×3, fond surface)**
Titre : « Entreprises RGE à reprendre en ce moment » · lien « Toutes les annonces → » · si < 6 annonces, remplacer la 3ᵉ carte par une carte « Recevoir les prochaines annonces par e-mail » (formulaire e-mail + activité + région, sans compte).

**6. Tarif (une seule carte centrée + calculateur)**
- H2 : « Vous ne payez qu'à la vente. »
- Texte : « Publication gratuite. À la signature de l'acte de cession, une commission de 10 % HT jusqu'à 500 000 €, 8 % de 500 000 à 1 500 000 €, 6 % au-delà, calculée par tranches. Pas de minimum, pas d'abonnement. Vous choisissez, dans le mandat, si elle est à votre charge ou à celle de l'acquéreur ; ce choix est affiché sur l'annonce. »
- Calculateur : « Prix de cession envisagé : [ 250 000 € ] → Commission : **25 000 € HT** (30 000 € TTC) ».
- Ligne : « Ce que comprend la commission : diffusion anonyme, qualification des repreneurs (identité vérifiée), accord de confidentialité et lettre d'intention signés en ligne, espace documents filigrané avec journal des consultations, suivi des offres, mandat et registre tenus par un professionnel carte T. »
- Note : « La négociation et les actes restent entre vous et le repreneur, avec vos conseils. »

**7. Qui est derrière (FounderCard + 3 chiffres)**
« Micael [Nom], fondateur. AlterEgo SAS, Sartrouville, carte T délivrée par la CCI Paris Île-de-France. » + 3 lignes sur pourquoi ce site (expérience du secteur, constat des groupes Facebook non vérifiés) + « 15 minutes pour en parler » (lien de prise de rendez-vous). Chiffres : « X annonces publiées · X repreneurs vérifiés · X régions » dès qu'ils dépassent 20, sinon « Lancé en 2026 · Île-de-France et toute la France ».

**8. Questions fréquentes (5)**
« Mes salariés et mes clients peuvent-ils savoir que je vends ? » · « Combien ça coûte, et qui paie ? » · « Qui sont les repreneurs, et comment sont-ils filtrés ? » · « Combien de temps prend une cession ? » · « Que devient ma qualification RGE après la vente ? » (lien guide).

**9. Guides (3 cartes avec visuel)** + lien « Tous les guides ».

**10. CTA final (seul bloc sombre)**
« Prêt à transmettre votre entreprise RGE ? » · « Déposer mon annonce anonyme » · lien « Je cherche une entreprise à reprendre ».

**11. Pied de page** : colonnes actuelles + bloc légal : « AlterEgo SAS · 43 rue Massenet, 78500 Sartrouville · RCS Versailles 952 180 230 · Carte professionnelle T n° CPI 7801 2025 000 000 049, CCI Paris Île-de-France · contact@cessionrge.fr ».

Sections supprimées de l'accueil : formulaire de recherche du hero (reste sur `/search` et hub), « Vérificateur RGE » (→ page dédiée), « Rejoignez la communauté RGE » (→ aimants ciblés §4.12), tableau du barème (→ calculateur ; tableau conservé sur Vendre).

---

## 7. Plan priorisé

**Avant toute mise en ligne (S = < 1 jour, M = 1–3 jours, L = > 3 jours)**
1. (S) Corriger le débordement de la carte tarifs mobile (`min-w-0` sur les enfants de grille `LandingPage.jsx:590`, cellules coupables) et les cartes « Dernières entreprises » à 320 px.
2. (S) Compléter mentions légales et confidentialité (garantie financière / non-détention de fonds, durées de conservation), passer `REACT_APP_LEGAL_DRAFT=false`.
3. (S) Fixer le domaine canonique (`REACT_APP_SITE_URL`, `FRONTEND_URL`, OG image) sur le domaine définitif ; retirer `/company/:id` du sitemap tant que les fiches ne sont pas pré-rendues (ou pré-rendre).
4. (S) Supprimer l'encart « Nous pouvons accompagner le futur propriétaire… » de la fiche entreprise ; corriger « Certifie RGE », « SIRET: », libellés de rôle à l'inscription.
5. (S) Masquer les compteurs à 0 sur hub/activité/région ; `noindex,follow` sur les pages activité/région sans annonce ; `noindex` sur `/search`.
6. (S) Auto-héberger Inter + Manrope.

**Refonte de l'accueil (M–L, environ 5–8 jours de développement front)**
7. (M) Nouveau hero mono-cible + bande d'autorité + pied de page légal (§6.1, 6.2, 6.11).
8. (M) `ListingCard` unique et titres d'annonce lisibles (accueil, hub, activité, région, search).
9. (M) Calculateur de commission + section tarif réécrite HT d'abord + « ce que comprend la commission ».
10. (S) Bloc fondateur + prise de rendez-vous (lien externe, 0 € de développement).
11. (M) Inscription : rôle via `?role=`, deux cartes « Je cède / Je reprends », en-tête commun, rappel de l'offre ; parcours « alerte sans compte ».
12. (M) Page `/verifier-entreprise-rge` ; retrait de la newsletter de l'accueil ; aimant « estimation en 2 minutes » (formulaire + e-mail Brevo automatique).
13. (L) Visuels : photos duotone, 2 captures produit, carte de France, portrait ; retouche du pictogramme.

**Mesure** : événements Plausible déjà prévus (`lib/analytics.js`) ; ajouter `hero_cta_seller`, `calc_used`, `alert_created`, `rdv_clicked`, `listing_card_click` pour piloter les itérations sans équipe.

---

## 8. Annexes

- Métriques brutes par route (poids transféré, nombre de ressources, hauteur, mots, erreurs) : `CAP/report.json`.
- Contrastes mesurés : sortie de `CAP/contrast.js` (reproduite en §4.8).
- Débordements mesurés : `CAP/clip.js` → captures `CAP/mobile390-pricing-viewport.png`, `mobile360-…`, `mobile320-…`.
- Captures disponibles : `desktop-{home,hub,act-pv,act-vmc-empty,reg-bretagne,reg-corse-empty,vendre,reprendre,guides,guide-valoriser,guide-etapes,mentions,confidentialite,search,company,login,register,404}.png` et équivalents `mobile-*`, plus `*-fold.png`, `desktop-home-{steps-buyer,faq-cost-open,pricing,verifier}.png`, `mobile-home-menu-open.png`, `desktop-crop-*.png`, `mobile-crop-*.png`.
- Fichiers de code cités : `frontend/src/pages/LandingPage.jsx` (hero :397-481, garanties :483-501, dernières annonces :503-541, étapes :543-581, tarifs :583-621, vérificateur :623 et :134-392, guides :626-651, FAQ :653-659, newsletter :661 et :24-132, CTA final :663-686), `frontend/src/components/seo/Content.jsx` (barème :48-62, FAQ :65-80, bandeau brouillon :149-155), `frontend/src/lib/offer.js`, `frontend/src/lib/seo.js`, `frontend/src/pages/SeoPages.jsx`, `frontend/src/pages/PublicSearch.jsx`, `frontend/src/pages/RegisterPage.jsx`, `frontend/src/components/layout/PublicLayout.jsx:6`, `frontend/public/index.html:22-24`, `backend/server.py:4095-4110`.
