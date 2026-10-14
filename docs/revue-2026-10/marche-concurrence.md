# CessionRGE — Étude de la concurrence et du marché (France + références étrangères)

**Date :** 9 octobre 2026 · **Auteur :** analyse marché (sous-agent) · **Périmètre :** plateformes et cabinets de cession/reprise d'entreprises en France, acteurs spécialisés bâtiment / rénovation énergétique, consolidateurs, références US.

**Méthode et limites.** Les fetchs directs de pages sont bloqués par le proxy de la session (403 CONNECT) ; toutes les données viennent de résultats de recherche web (extraits de pages officielles, comparatifs tiers, presse). Les prix sont ceux affichés dans les extraits au moment de la recherche ; quand les sources divergent, les deux valeurs sont données. Chaque fait est sourcé par une URL. Les chiffres « auto-déclarés » (nombre d'annonces, de repreneurs) sont signalés comme tels. cessionpme.com bloque le crawler : ses prix exacts n'ont pas pu être obtenus.

---

## 0. Résumé exécutif (version sincère)

1. **Le marché généraliste est saturé et presque gratuit pour le cédant.** Fusacq, Place des Commerces, Transmibat (FFB), Entreprises en ligne, reprise-entreprise.fr, Alvo (plan gratuit) : dépôt d'annonce **0 €**. Les payants (Transentreprise 150–500 € HT/an, CessionPME « prix non divulgué », Leboncoin au-delà de 3 annonces/an) sont bon marché. Un cédant RGE a donc dix endroits où publier gratuitement en cinq minutes, **sans signer de mandat**. Exiger un mandat exclusif signé avant publication, c'est demander au cédant ce que seul un cabinet humain (Michel Simond, Transaxio) obtient, en échange d'un service de plateforme.
2. **Le prix d'un intermédiaire carte T est 10 % HT du prix, à la charge de l'acquéreur, avec un minimum** (Transaxio : 6 500 € HT jusqu'à 65 k€, puis 10 % HT jusqu'à 500 k€ ; marché fonds de commerce : 10 % HT, minimum 5 000 € HT). Le barème CessionRGE (10/8/6 %, sans minimum, débiteur au choix) est **dans la norme tarifaire des cabinets**, mais sans le service humain qui la justifie (valorisation, visites, négociation, rédaction). C'est le point faible central : prix de cabinet, service de marketplace.
3. **Ce que les acquéreurs français acceptent déjà de payer sans commercial** : la mise en relation unitaire (Fusacq 45–60 € HT, Place des Commerces 20 € HT), l'abonnement (CRA 320–640 €/an, Fusacq 695–1 195 € HT/an, Alvo 200–299 €/an, WE Transmission 300 €/an), et une petite commission au succès côté repreneur (Alvo 2 % HT, min 1 000 € HT ; DotMarket 4 %). Ce sont des **modèles self-service éprouvés**, cohérents avec l'objectif « zéro commercial ».
4. **La niche RGE est réelle mais petite** : ~60 400 entreprises RGE (ADEME, juillet 2026), en baisse depuis 2022 (~65 000). Avec un taux de cession TPE de l'ordre de 2–4 %/an, le flux théorique est de **1 500 à 2 500 cessions RGE par an**, dont une large part en gré à gré (famille, salarié, confrère). Les annonces visibles « RGE » sur les plateformes se comptent en **dizaines**, pas en centaines.
5. **2026 est un choc de demande pour les monogestes** : décret 2026-822 du 25 août 2026, MaPrimeRénov' par geste exclut isolation, chauffage, PAC ECS au 1er septembre 2026 ; tarif de rachat PV surplus abaissé à 1,1 c€/kWh en juin 2026 avec suppression de la prime autoconsommation. Conséquence : **plus de vendeurs en difficulté, moins d'acheteurs** pour les petites structures mono-produit. Les consolidateurs (Butagaz Eco-énergie, Isovalie/Creadev, Émeraude Power, Satep, Atout Groupe) achètent des cibles à **2–6 M€ de CA**, sourcées en direct ou par cabinets M&A, pas des artisans à 300 k€.
6. **Personne ne « possède » le mot-clé RGE en cession.** Sur les requêtes « entreprise RGE à vendre », « reprise installateur photovoltaïque », « entreprise pompe à chaleur à vendre », ressortent Bpifrance Transmission (agrégateur), reprisetransmission.fr (cabinet), entreprisesenligne.com, msimond.fr, fusacq.com, placedescommerces.com, capeb-transmission.fr. **cessionrge.fr n'apparaît dans aucun résultat** : le site n'est pas indexé ou pas positionné. C'est la place libre la plus facile à prendre, et la moins chère.
7. **Le vrai différenciateur monétisable n'est pas l'annonce, c'est la diligence RGE** : la qualification ne suit pas le fonds de commerce (Qualibat : certificat provisoire 6 mois), dépend du référent technique (6 mois pour en requalifier un), tombe si le SIRET change, peut être retirée après audit ; s'y ajoutent l'exposition aux litiges MPR/CEE. Aucun concurrent n'industrialise cette vérification. Un « rapport de diligence RGE » automatisé (ADEME + Qualibat/Qualit'EnR + référent + historique) est un produit software vendable au repreneur sans commercial.

**Verdict :** en l'état (mandat exclusif obligatoire + 10 % + publication gratuite + aucun revenu avant closing), le modèle est **juridiquement propre mais économiquement lent** : trésorerie nulle pendant 9–18 mois, fort risque de contournement, et friction d'entrée supérieure à celle de tous les concurrents gratuits. La place libre existe : **vertical RGE, SEO, diligence automatisée, monétisation côté repreneur (self-service), commission au succès plus basse et optionnelle**, avec l'intermédiation carte T en option « accompagnée » plutôt qu'en obligation.

---

## 1. Le marché

### 1.1 Taille et dynamique
| Indicateur | Valeur | Source |
|---|---|---|
| Entreprises RGE (ADEME, extraction juillet 2026) | **60 428** entreprises, 162 207 qualifications actives | https://www.data.gouv.fr/reuses/combien-dartisans-rge-en-france-chiffres-2026-par-domaine-de-travaux-et-organisme |
| Tendance RGE | ~65 000 en 2022 → ~62 000 en 2026 (Hellio) ; ADEME : stable autour de 64 000 sur 5 ans, baisse « non significative » ; BâtiZoom : ~55 000 entreprises de travaux RGE en 2025 | https://pro.hellio.com/blog/marche/baisse-entreprises-rge · https://batizoom.ademe.fr/indicateurs/nombre-dentreprises-de-travaux-rge |
| Entreprises artisanales du bâtiment | 560 000 (CAPEB, ratio cité par son président) à 621 803 | https://pro.hellio.com/blog/marche/baisse-entreprises-rge · https://artisan-assure.fr/statistiques/artisanat-batiment-france/ |
| Cessions-transmissions annuelles tous secteurs | ≥ 75 000/an (BPCE L'Observatoire ; le « 60 000 » courant est jugé sous-estimé de 25 %) | https://newsroom.groupebpce.fr/actualites/bpce-lobservatoire-veut-mettre-fin-aux-estimations-erronees-et-aux-idees-recues-sur-la-cession-transmission-des-tpe-et-pme-en-france-pour-une-action-publique-mieux-ciblee-1f180-7b707.html |
| Cessions de fonds dans l'artisanat | 8 360 en 2024 (stable depuis 2018), montant médian **84 950 €** | https://artisan-assure.fr/statistiques/artisanat-batiment-france/ |
| Reprise vs création | La reprise = 8 % des installations (2022) | https://artisan-assure.fr/statistiques/artisanat-batiment-france/ |
| Dirigeants ≥ 60 ans | 500 000 en 2022 ; 370 000 entreprises potentiellement transmissibles à 5 ans, ~130 000 le seraient effectivement (étude CMA/CCI/CRA, janv. 2026) | https://www.artisanat.fr/system/files/medias/file/2026/01/20260109_LB_Transmission_reprise_VF.pdf |
| Taille des entreprises reprises | 54 % TPE, 28 % PME ; 6 salariés en moyenne (Bpifrance Le Lab, 2025/2026) | https://lelab.bpifrance.fr/storage/sites/31/2026/01/Transmission-et-reprise-dentreprise-Perspectives-2025.pdf |
| Plan public | « Objectif Reprises » présenté le 23 avril 2026 : 11 mesures, courrier aux dirigeants de 55 ans dès mai 2026, 25 000 cédants/repreneurs sensibilisés par an par CCI/CMA, « modernisation des outils de mise en relation », pas de mesure fiscale | https://www.economie.gouv.fr/actualites/objectif-reprises-un-plan-daction-pour-faciliter-la-transmission-reprise-des-entreprises |

**Lecture pour CessionRGE.** Si l'on applique aux ~60 000 RGE un taux de cession de 2–4 %/an (ordre de grandeur TPE/PME, Insee/BPCE : 4,4 % pour 10–19 salariés, bien moins pour l'unipersonnel), le flux est de **1 200 à 2 400 cessions RGE par an**, toutes formes confondues (gré à gré inclus). La part qui passe par une annonce publique est minoritaire. Sur les plateformes, les annonces explicitement RGE/PAC/PV repérées se comptent en dizaines (Michel Simond : 38 annonces plomberie-chauffage/génie climatique toutes confondues ; Bpifrance : quelques annonces PV/PAC à 350 k€–1,2 M€).

### 1.2 Chocs 2026 sur la demande
- **MaPrimeRénov'** : décret n° 2026-822 du 25 août 2026, applicable au 1er septembre 2026 ; le parcours par geste exclut isolation, équipements de chauffage, ventilation, PAC dédiées à l'ECS, chauffe-eau solaires/thermodynamiques ; exclusion du gaz en rénovation d'ampleur ; passage obligatoire par France Rénov' ; hausse du contentieux devis/conditions suspensives. Source : https://www.economie.gouv.fr/particuliers/faire-des-economies-denergie/maprimerenov-parcours-par-geste-la-prime-pour-la-renovation-energetique · https://kohenavocats.fr/2026/09/16/maprimerenov-exclusion-monogestes-chauffage-gaz-decret-recours-proprietaire/
- **Photovoltaïque** : tarif de rachat du surplus à 1,1 c€/kWh HT depuis le 5 juin 2026, prime à l'autoconsommation supprimée pour les nouvelles installations. Source : https://www.potentielsolaire.com/prix-rachat-electricite-photovoltaique
- **Bâtiment** : activité artisanale −3,8 % en 2025 après −4 % en 2024 ; CAPEB table sur −0,5 % à +0,5 % en 2026. Source : https://www.batiweb.com/actualites/conjoncture/la-capeb-table-sur-une-stabilisation-de-l-activite-des-artisans-en-2026-48101
- **Accès simplifié au RGE** : procédure simplifiée pour les non-RGE ayant trois chantiers aidés audités conformes (textes à confirmer). Cela **réduit la valeur de rareté du label** pour un repreneur. Source : https://www.hellowatt.fr/blog/reforme-maprimerenov-septembre-2026/

**Implication sincère :** l'argument « rachetez une société pour son RGE » s'affaiblit (label plus accessible, marché monogeste frappé), tandis que l'argument « ne rachetez pas une bombe à retardement RGE/CEE » (diligence) se renforce.

### 1.3 Transférabilité de la qualification RGE (l'argument central est fragile)
- Qualibat, cession de fonds : l'entreprise rachetée rend son certificat ; un certificat provisoire reprenant ses qualifications est délivré au cessionnaire pour **6 mois**, le temps de déposer sa propre demande. Source : https://www.qualibat.com/documentation/reglement-general-de-QUALIBAT-1.pdf
- Référent technique qui part : **6 mois** pour qualifier un nouveau collaborateur, sinon nouveau dossier. Source : https://www.formation-elysia.consulting/vos-questions-nos-r%C3%A9ponses/si-le-r%C3%A9f%C3%A9rent-rge-quitte-la-soci%C3%A9t%C3%A9-l-entreprise-garde-sa-certification/
- Changement de SIRET (déménagement, fusion, nouvelle entité) : la qualification doit être mise à jour sinon elle n'est plus valide. Source : https://www.effy.fr/pro/actualite/rge-demenagement-demarches-ne-pas-oublier
- Qualit'EnR contrôle annuellement que le référent technique est toujours en poste, le Kbis < 12 mois, assurances et sinistralité ; pas de période de grâce. Source : https://www.qualit-enr.org/comprendre-le-cycle-de-qualification/
- L'organisme peut auditer et retirer la qualification ; se présenter RGE sans l'être = dol, nullité (art. 1178 C. civ.). Sources : https://www.assemblee-nationale.fr/dyn/14/questions/QANR5L14QOSD1314.pdf · https://www.litige.fr/articles/credit-impot-qualification-rge-travaux-artisan-arnaque
- Délai pour obtenir un RGE ex nihilo : 1 à 6 mois selon sources. Source : https://sonergia.fr/professionnels/devenir-rge/rge-combien-de-temps-pour-devenir-une-entreprise-certifiee/

---

## 2. Cartographie des concurrents français

### 2.1 Tableau de synthèse

| Acteur | Type | Cédant paie | Repreneur paie | Commission | Volume (déclaré) | Source |
|---|---|---|---|---|---|---|
| **CessionPME** (Ouest-France) | Média d'annonces | Annonce payante 3/6/12 mois, prix non divulgué ; abonnements cabinets/agences ; option anonymat | Gratuit | Aucune | ~118–120 000 annonces (< 90 j, incl. locaux) ; 500 000 visites/mois ; 17–20 000 MER/mois | https://reprise-entreprise.bpifrance.fr/les-operateurs-partenaires/cession-pme · https://info.ouestfrance-immo.pro/cessionpme |
| **Fusacq** | Média d'annonces | Gratuit ; mise en avant 2 € HT/jour | MER unitaire 45–60 € HT ; packs 5/10/20 = 150/235/325 € HT ; abonnements 10/20/30 MER/mois = 695/945/1 195 € HT/an (16 € HT au-delà) ; Elite 35–336 € HT | Aucune | 2 500 annonces, 300–800 CV repreneurs, 550–600 experts ; « 1 société vendue/jour » | https://fusacq.com/tarifs/tarifs.php_fr_ · https://www.salonsme.com/companies/0e63ef8e-955d-f111-8fca-000d3a3a75fd/fusacq |
| **Place des Commerces** (groupe Fusacq) | Média d'annonces | Gratuit ; mise en avant 1 € HT/jour ; annuaire experts 30 € HT/mois | Rien ; c'est le **cédant** qui paie 20 € HT par coordonnées d'acheteur (4 € HT pour cabinets > 10 annonces) | Aucune | 54 946 annonces (commerces, CHR, locaux) | https://www.placedescommerces.com/tarifs_fr_ · https://www.placedescommerces.com/commerces_a_vendre_avec_fr_ |
| **Transentreprise** (CCI + CMA) | Média + conseillers | 150 € HT/an (Haute-Savoie, Troyes) à 250–500 € HT/an (Pays de la Loire selon CA) ; 180 € HT « annonce en direct » (Charente-Maritime) | Compte gratuit ; options 50–150 € | Aucune | 6 856 annonces ; 90–93 000 connexions/mois ; 510 conseillers | https://www.haute-savoie.cci.fr/piloter/transmission/annonce-cession-entreprise-transentreprise · https://www.lesrepreneurs.fr/comparatif/sites-entreprises-a-vendre |
| **Bpifrance Transmission** (Bourse) | Agrégateur public | Via partenaires | Gratuit, contact chez le partenaire | Aucune | 84 935 annonces dont 42 054 entreprises/commerces | https://reprise-entreprise.bpifrance.fr/ |
| **Leboncoin** (Bureaux & Commerces) | Média généraliste | 3 premières annonces/12 mois gratuites (CGV : 2), puis frais d'insertion variables ; Pro ~39 € HT/mois et plus | Gratuit | Aucune | Dizaines de milliers de « fonds de commerce » | https://assistance.leboncoin.info/hc/fr/articles/25251056454418-Pourquoi-mon-d%C3%A9p%C3%B4t-d-annonce-est-il-payant · https://www.leboncoin.fr/dc/cgv_pro |
| **Alvo** | Marketplace + outils | Gratuit (durée illimitée) ; Pack Boost 300 €/annonce | Gratuit = 3 contacts/an + **2 % HT min 1 000 € HT au succès** ; abonnement 200–299 €/an → 1 % HT min 500 € HT ; annonces de conseils exemptées | 1–2 % payée par le repreneur | 8 000–8 500 repreneurs ; levée 1 M€ (2022) | https://www.alvo.market/tarifs-cedants-repreneurs · https://www.lesrepreneurs.fr/comparatif/sites-entreprises-a-vendre |
| **CRA** (association) | Réseau bénévole | 700 €/an | 320 €/an (particulier), 640 €/an (société) ; ~480 € selon une source | Aucune (revendiqué) | n.d. | https://www.cra.asso.fr/adherer-au-cra.aspx · https://plan-reprise-activite.com/cra-reprise-entreprise/ |
| **Transmibat** (FFB × Fusacq) | Média sectoriel BTP | Gratuit (adhérents FFB) ; contacts gratuits illimités entre adhérents ; non-adhérents : 5 contacts gratuits/an puis tarifs Fusacq (150 € HT/5) | idem | Aucune | Annonces croisées avec Fusacq | https://www.ffbatiment.fr/actualites-batiment/actualite-ba/transmission-reprise-entreprise-transmibat-fait-peau-neuve |
| **CAPEB Transmission** (CAPEB Pays de la Loire) | Annonces + accompagnement | Non publié (service adhérents) | n.d. | n.d. | Annonces 44/49/85 | https://www.capeb-transmission.fr/ |
| **CessionBTP** | Plateforme BTP | Non publié ; « estimation gratuite sous 48 h » | n.d. | n.d. | « 500+ annonces, 2 000+ repreneurs » (auto-déclaré, non vérifié) | https://www.cessionbtp.fr/ |
| **Reprise Transmission** (reprisetransmission.fr) | Cabinet d'intermédiation « digital » | Honoraires au succès à charge du **vendeur**, déduits du prix | Pack Repreneur 75 € HT | Oui, non chiffrée | « 3 000 acquéreurs actifs, 40 transactions en cours, 10 vendues » (2025, déclaratif) ; **ressort sur les requêtes RGE/PAC/PV** | https://www.reprisetransmission.fr/tarif-reprise-cession-entreprise.aspx |
| **Michel Simond** (franchise, carte T) | Cabinets d'affaires | Rien (usage) | **Acquéreur** : murs 8,33 % HT min 10 000 € HT ; bureaux 7 % HT ; fonds ≈ 10 % TTC (témoignage ex-consultant, non officiel) | Oui | 38 annonces plomberie-chauffage/génie climatique | https://www.msimond.fr/aide-contact/55/le-reseau-michel-simond-preconise-un-bareme-national-pour-les-cessions-de-murs-et-locations-les-cabinets-d-affaires-michel-simond-sont-des-structures-juridiques-independantes · https://fr.indeed.com/cmp/Michel-Simond/reviews |
| **Transaxio** (carte T) | Cabinet | Rien (usage) | **Acquéreur** : 0–65 k€ = **6 500 € HT forfait** ; 65–500 k€ = **10 % HT** ; 500 k–1 M€ = 5 % ; 1–1,5 M€ = 4 % ; 1,5–2 M€ = 2 % ; au-delà 1 % (tranches cumulatives ; ex. 550 k€ → 52 500 € HT) ; titres : assiette = valeur des actifs | Oui | n.d. | https://www.transaxio.fr/les-honoraires/ · https://www.transaxio.fr/actualites/vendeurs/qui-supporte-les-honoraires-lors-dune-cession-dentreprise/ |
| **Hexagone Conseil** (Deux-Sèvres/Vendée/Charente-Mar.) | Cabinet régional | — | Ex. d'annonce : 8 % HT à charge acquéreur | Oui | n.d. | https://hexagoneconseil.fr/ |
| **Actoria** | Cabinet M&A PME | Forfait de préparation + success fee au closing (montants non publiés) | — | Oui | n.d. | https://actoria.fr/contact/ |
| **In Extenso Finance** | M&A mid-cap (1–50 M€) | Sur devis (lettre de mission) | — | Oui | n.d. | https://finance.inextenso.fr/metiers/accompagnement-transmission-cession/ |
| **Naviia Transmission** | Cabinet | 0 € d'entrée, 0 € mensuel, % dégressif du prix encaissé, barème dans le mandat | — | Oui (non chiffrée) | n.d. | https://naviia-transmission.com/honoraires |
| **Gestion Conseil** (ex. de petit cabinet) | Cabinet | 1 % du prix de mise en vente, min 3 500 € (entrée) + honoraires de résultat 7 % → 2,5 % au-delà de 1 M€ | — | Oui | n.d. | https://www.gestion-conseil.fr/devisxz.html |
| **Entreprises en ligne** | Média | Gratuit | Gratuit | Aucune | Depuis 1999 ; ressort sur « entreprise RGE à reprendre » | https://www.entreprisesenligne.com/ |
| **reprise-entreprise.fr** | Média | Gratuit, « aucune commission » | Gratuit | Aucune | Beaucoup d'annonces expirées | https://www.reprise-entreprise.fr/cession-batiment-et-travaux-publics-c46.html |
| **DotMarket** (actifs web) | Marketplace | Gratuit | — | 4 % au-delà de 20 000 € | n.d. | https://www.shine.fr/blog/meilleurs-sites-vente-entreprise/ |
| **MeetPRO** | Matching | Gratuit | Gratuit | n.d. | n.d. | https://www.meetpro.fr/ |
| **Riviqo** | Plateforme + accompagnement M&A | Valorisation gratuite, SmartMatching, data room ; pas de tarif public | — | n.d. | n.d. | https://www.riviqo.com/ |

Repères cabinets (toutes sources) : success fee PME 3–8 % selon taille (7,5 % à 2 M€, 5 % à 5 M€), retainer 10 % / success fee 90 % en structure type (Infocession 2026), fonds de commerce 10 % HT min 5 000 € HT à charge du cessionnaire, ou 2–5 % HT pour 100 k€–1 M€ / forfait 2 000–10 000 € HT (guides 2026). Sources : https://www.infocession.fr/cabinets-cession-entreprise · https://matchingvalue.com/cabinet-daffaires/ · https://www.swim.legal/blog/cession-fonds-de-commerce-honoraires-avocat · https://laparisienneducommerce.com/honoraires

### 2.2 Fiches : points faibles exploitables

**CessionPME** — Leader en volume (mais mêle locaux, franchises, fonds). Annonce payante pour le cédant direct, prix opaque, UX datée, orientée cabinets/agences (abonnements). Aucun filtre « qualification RGE ». Pas de KYC, pas de NDA, pas de data room.

**Fusacq / Place des Commerces** — Le standard français du « cédant gratuit, repreneur paie le contact ». Fusacq est orienté PME/experts, Place des Commerces orienté CHR/commerces. Place des Commerces inverse la logique : c'est le **cédant** qui paie 20 € HT pour obtenir les coordonnées d'un acheteur intéressé (« paiement au résultat »). Faiblesses : aucune vérification d'identité des repreneurs, pas de NDA ni data room, pas de verticalité bâtiment/énergie (Transmibat est un simple miroir). Fusacq revendique 100 000 visiteurs/mois (chiffre ancien).

**Transentreprise (CCI/CMA)** — Prix cédant modestes (150–500 € HT/an) et conseillers humains, mais 70 % des annonces en CHR/commerce alimentaire/services aux particuliers, UX et délais de validation lents, pas de vertical bâtiment. Avec « Objectif Reprises », les CCI/CMA vont pousser 25 000 cédants/repreneurs par an vers ce canal : **concurrent public subventionné**, impossible à battre sur le prix, battable sur la verticalité et l'expérience.

**Bpifrance Transmission** — Agrégateur gratuit ; très bien référencé (ressort n°1 sur « entreprise plomberie à vendre », « entreprise BTP à vendre »). Ne prend pas d'annonces en direct hors partenaires ; devenir partenaire = canal d'acquisition SEO gratuit à étudier (charte : anonymat du cédant garanti).

**Alvo** — Le seul qui a importé le modèle « commission au succès payée par le repreneur, petite et plafonnée en bas » (2 % min 1 000 € HT) + abonnement qui la réduit. Outils (valorisation, data room, Suite Pro à 90 € HT/dossier/mois pour intermédiaires). Faiblesses : généraliste, 1 M€ levé en 2022 seulement, chiffres d'annonces non publiés, 3 contacts/an en gratuit frustrant. C'est le **modèle le plus proche de ce que CessionRGE devrait copier** sur la monétisation self-service.

**CRA** — Réseau d'anciens dirigeants bénévoles, cotisation seule, pas de commission. Crédibilité forte chez les repreneurs cadres, mais process d'admission lent, zéro outillage, peu de TPE bâtiment.

**Transmibat / CAPEB Transmission** — Les fédérations occupent le terrain « artisanat du bâtiment », gratuitement pour leurs adhérents. Faiblesses : pas de process (NDA, KYC), pas de diligence RGE, régional (CAPEB Pays de la Loire), annonces sans prix (« prix à définir »).

**Cabinets carte T (Michel Simond, Transaxio, Hexagone Conseil)** — Service humain complet, 8–10 % HT à charge de l'acquéreur, minimum 6 500–10 000 € HT. Faiblesses : minimum dissuasif sous 100 k€, zéro spécialisation RGE, dépendance à des consultants commissionnés (exactement ce que le fondateur ne veut pas reproduire). Transaxio et Michel Simond publient leur barème : **l'acquéreur-payeur est la norme en fonds de commerce** ; la jurisprudence impose que le mandat et l'acte désignent le même débiteur (Cass.) — à respecter dans le mandat et dans la LOI/acte de CessionRGE.

**Cabinets M&A (Actoria, In Extenso Finance, Naviia)** — Dossiers > 1 M€, retainer + success fee, non concurrents directs sur l'artisan RGE à 100–400 k€ ; concurrents sur les cibles 2–6 M€ que visent les consolidateurs.

**Reprise Transmission (reprisetransmission.fr)** — Cabinet « digital » qui a compris le SEO sectoriel : pages dédiées « rénovation énergétique », « SAV installations & rénovation énergétique », « climatisation-chauffage ». C'est le concurrent qui prend aujourd'hui les requêtes RGE/PAC/PV. Faiblesses : annonces souvent anciennes/vendues, chiffres déclaratifs, honoraires non publiés.

**CessionBTP** — Vitrine BTP avec chiffres auto-déclarés non vérifiables, pas de tarifs. À surveiller, pas une menace.

### 2.3 Consolidateurs et acquéreurs stratégiques (les vrais acheteurs solvables)
| Acquéreur | Opérations récentes | Taille des cibles | Source |
|---|---|---|---|
| **Butagaz Eco-énergie** (groupe Butagaz / DCC) | Lumélio (PV, PAC, stockage ; ~20 salariés, 4,3 M€ CA) en mai 2026 ; MG Habitat (nov. 2024) ; SLER | 2–5 M€ CA | https://www.pv-magazine.fr/2026/05/21/linstallateur-de-solutions-photovoltaiques-et-de-stockage-lumelio-rachete-par-butagaz/ |
| **Isovalie** (Gironde, Creadev) | Imex16 (Charente, ~50 salariés, 5,9 M€ CA ; départ en retraite du fondateur), juillet 2026 | 5–6 M€ CA | https://www.cfnews.net/L-actualite/Build-up/Isovalie-isole-son-premier-build-up-723328 |
| **Émeraude Power Group** | 3e acquisition d'installateur solaire (Auvergne/Centre), oct. 2025 ; Inelia (Bordeaux) | PME régionales | https://www.pv-magazine.fr/2025/10/08/emeraude-power-group-acquiert-systemes-solaires-et-etend-son-maillage-territorial/ |
| **Atout Groupe** | Solar Expansion (15 salariés, 2,5 M€ CA), fév. 2025 | 2–3 M€ CA | https://www.bretagne-economique.com/actualites/photovoltaique-atout-groupe-rachete-solar-expansion/ |
| **Satep** (IDF) | 6 sociétés intégrées dont TechniChauff | n.d. | https://www.cfnews.net/L-actualite/Build-up/Satep-multiplie-ses-chantiers-d-acquisitions-723170 |
| **Renovio Investment** | 12 acquisitions, ~30 M€ CA cumulé | PME rénovation | https://www.cfnews.net/L-actualite/M-A-Corporate/Operations/100/Trois-pierres-en-plus-dans-l-edifice-Renovio-524799 |
| **Hellio** | En négociation exclusive pour être racheté par Crédit Mutuel Alliance Fédérale (24 fév. 2026 ; > 200 M€ CA, 400 salariés) — Hellio est une cible, pas un acheteur d'installateurs | — | https://www.hellio.com/actualites/communiques/negociation-exclusive-credit-mutuel-alliance-federale-hellio |
| **Effy** | Aucune acquisition d'installateur trouvée 2025–2026 ; restructuration juridique 2026 | — | https://www.pappers.fr/entreprise/effy-509302469 |
| **Paloma Rheem / Groupe Atlantic** | Fabricant PAC, > 3 Md€, finalisé mai 2026 (amont, pas installateurs) | — | https://www.usinenouvelle.com/made-in-france/le-conglomerat-nippo-americain-paloma-rheem-rachete-officiellement-groupe-atlantic-le-specialiste-francais-des-pompes-a-chaleur.SGVVEYPO7FDUDGF7L6LSILNPWU.html |

**Lecture sincère :** les consolidateurs sont réels et actifs, mais ils achètent des entreprises de 2–6 M€ de CA avec des équipes, pas des artisans mono-salarié. Pour eux, CessionRGE peut être une **source de deal-flow** (abonnement « flux acquéreur »), pas un lieu de transaction de bout en bout. L'artisan RGE à 100–400 k€ est repris par un confrère, un salarié ou un créateur : la demande existe (annonces « artisan cherche entreprise RGE/Qualibat à reprendre » sur Entreprises en ligne et UIMM) mais elle est peu solvable et peu outillée.

---

## 3. SEO : qui ressort sur les requêtes RGE / bâtiment / énergie

Observé sur les résultats de recherche de cette étude (octobre 2026) :

| Requête | Sites qui ressortent | cessionrge.fr |
|---|---|---|
| « entreprise RGE à vendre / installateur PAC PV » | reprise-entreprise.bpifrance.fr, reprisetransmission.fr, entreprisesenligne.com, msimond.fr | **absent** |
| « entreprise photovoltaïque à vendre reprise installateur solaire » | bpifrance, reprise-entreprise.fr, reprisetransmission.fr, cession-reprise.fr, fusacq.com | absent |
| « entreprise pompe à chaleur à vendre QualiPAC » | reprisetransmission.fr, capeb-transmission.fr, pme-avendre.fr, entreprisesenligne.com, msimond.fr | absent |
| « cession entreprise bâtiment / BTP » | bpifrance, cra.asso.fr, capeb-transmission.fr, cap-cession.fr, cessionbtp.fr, transentreprise.com | absent |
| « cessionrge.fr » (requête de marque) | aucun résultat pour le domaine | **non indexé / non positionné** |

Constat : le SERP RGE est tenu par des généralistes avec une page-catégorie et un cabinet régional « digital ». Aucun n'a de contenu expert (transfert de qualification, référent technique, CEE, MPR, audit). **Un contenu vertical sérieux + des pages programmatiques par métier × région (« entreprise RGE isolation à vendre Gironde ») peut prendre ces positions en 3–9 mois à coût quasi nul.** Prérequis : vérifier l'indexation de cessionrge.fr (Search Console, sitemap, robots), car le domaine n'apparaît même pas sur sa propre marque.

---

## 4. Références étrangères

| Plateforme | Cédant/vendeur paie | Acheteur paie | Commission (success/closing fee) | Source |
|---|---|---|---|---|
| **Acquire.com** (US, startups) | Listing mensuel : 25 $/mois (≤ 250 k$), 50 $/mois (250 k–1 M$), 100 $/mois (> 1 M$) depuis le 17 avr. 2024 | Gratuit = infos publiques ; Premium 390 $/an (≤ 250 k$ de CA) ; Platinum 780 $/an (tout) | 8 % (≤ 250 k$), 7 % (≤ 1 M$), 6 % (> 1 M$), prélevée à l'escrow ; « Guided by Acquire » 6 % | https://help.acquire.com/how-much-does-it-cost-to-sell · https://help.acquire.com/how-do-i-upgrade-from-the-free-plan |
| **BizBuySell** (US, commerces) | Basic 74,95 $/mois, Showcase 99,95 $, Diamond 199,95 $ (engagement 6 mois ; hausse juillet 2026) | Gratuit | **Aucune** | https://www.bizbuysell.com/create-a-listing-FAQ/ · https://searchspheresource.com/resources/bizbuysell |
| **Empire Flippers** (US, business en ligne, courtier) | Gratuit | Dépôt remboursable ~297 $ pour accéder aux détails (source unique) | **15 %** jusqu'à 700 k$, 8 % de 700 k$ à 5 M$, 2,5 % au-delà ; **minimum 10 000 $** (fév. 2026, ex-7 000 $) ; 91 % des candidats refusés | https://empireflippers.com/changelog/ · https://empireflippers.com/empire-flippers-terms-use-agreement/ |
| **Flippa** (AU/US, actifs web) | Listing 29 $ à 699 $ selon taille + upgrades 99–499 $ | Gratuit ; Premium 49 $/mois ou 490 $/an (accès anticipé) | 10 % → 5 % dégressif (3 % annoncé en haut de gamme) ; non négociable, non remboursable | https://flippa.com/pricing · https://flippa.com/terms-of-service/ |
| **DotMarket** (FR, actifs web) | Gratuit | — | 4 % au-delà de 20 000 € | https://www.shine.fr/blog/meilleurs-sites-vente-entreprise/ |

**Enseignements transposables.**
- **Trois revenus coexistent sans commercial** : listing fee mensuel (Acquire, BizBuySell), abonnement acheteur (Acquire 390–780 $/an, Flippa 490 $/an), closing fee collecté **automatiquement à l'escrow** (Acquire). Le closing fee seul n'est pratiqué que par des courtiers à forte sélection (Empire Flippers, 15 %, refuse 91 % des dossiers), avec un minimum élevé et une équipe humaine.
- **Le fee-at-escrow** résout le problème de recouvrement de la commission : en France, l'équivalent est le séquestre (avocat/notaire) ; prévoir dans le mandat et la LOI que la commission est prélevée sur le séquestre à la signature de l'acte.
- Les listing fees US (25–200 $/mois) sont acceptés parce que l'audience acheteurs est massive. En France, le cédant TPE est habitué au gratuit.

---

## 5. Qui paie quoi en France : ce que les acquéreurs et cédants acceptent déjà

| Modèle | Acteurs | Acceptation marché | Compatibilité carte T / Hoguet |
|---|---|---|---|
| Annonce gratuite, contact payant par le **repreneur** (20–60 € HT, packs, abonnements 200–1 200 €/an) | Fusacq, Place des Commerces, Alvo, CRA, Transmibat non-adhérents, WE Transmission (300 €/an) | **Élevée** — standard depuis 15 ans | Modèle « média » : pas d'entremise, pas de mandat. À séparer juridiquement de l'activité carte T (une offre média sans mandat + une offre intermédiation mandatée). **À valider par le conseil d'AlterEgo.** |
| Annonce payante **cédant** (100–500 € HT/an) | Transentreprise, CessionPME, Leboncoin > 3/an | Moyenne (accepté quand il y a un conseiller ou une audience massive) | Média, idem |
| Commission au succès **repreneur**, basse, avec minimum | Alvo 2 % min 1 000 € HT (1 % min 500 € avec abonnement) ; DotMarket 4 % | Croissante ; perçue comme juste car faible | Alvo n'est pas carte T ; pour un carte T, la commission est due au closing, selon mandat (art. 6 loi Hoguet : débiteur désigné dans le mandat **et** dans l'acte) |
| Commission au succès **acquéreur**, 8–10 % HT + minimum 5–10 k€ | Michel Simond, Transaxio, cabinets fonds de commerce | Acceptée **avec service humain complet** | Modèle carte T classique |
| Success fee **vendeur** 3–8 % + retainer | Cabinets M&A (Actoria, Gestion Conseil, Naviia sans retainer) | Acceptée > 1 M€ | Hors Hoguet pour titres de SAS ; retainer interdit sous Hoguet (fonds) |
| Adhésion annuelle sans commission | CRA 320–700 €/an | Acceptée par repreneurs cadres | — |

**Conclusion tarifaire :** le marché français accepte, sans vendeur humain, (a) un repreneur qui paie 20–60 € par contact ou 200–400 €/an, et (b) une commission au succès de 1–4 % payée par le repreneur avec un minimum de 500–1 000 €. Il accepte 10 % HT seulement quand un cabinet fait le travail. **Le barème CessionRGE à 10 % sans service humain se situe au-dessus de ce que le marché accepte d'une plateforme**, et le mandat exclusif obligatoire est une friction que personne d'autre n'impose au dépôt.

---

## 6. Benchmark chiffré du barème CessionRGE

Exemples (HT) sur des prix typiques d'artisans RGE :

| Prix de cession | CessionRGE (10/8/6 %, sans min.) | Transaxio (acquéreur) | Alvo gratuit (repreneur) | Alvo abonné | Fusacq (repreneur, 10 contacts) | Michel Simond (≈10 % TTC) |
|---|---|---|---|---|---|---|
| 50 000 € | 5 000 € | 6 500 € (forfait) | 1 000 € (min) | 500 € + 299 € | ~235 € | ~4 167 € HT |
| 85 000 € (médian artisanat) | 8 500 € | 8 500 € | 1 700 € | 850 € + 299 € | ~235 € | ~7 083 € HT |
| 200 000 € | 20 000 € | 20 000 € | 4 000 € | 2 000 € + 299 € | ~235 € | ~16 667 € HT |
| 400 000 € | 40 000 € | 40 000 € | 8 000 € | 4 000 € + 299 € | ~235 € | ~33 333 € HT |
| 800 000 € | 64 000 € (barème par paliers non marginaux) | 58 500 € | 16 000 € | 8 000 € + 299 € | ~235 € | ~66 667 € HT |

Observations :
- À 85 k€ (médiane artisanat), CessionRGE = Transaxio (8 500 €) pour un service purement plateforme. Le cédant/repreneur rationnel contourne (contact direct après avoir vu le teaser, ou passe par Fusacq gratuit).
- L'effet de seuil (10 % sur tout jusqu'à 500 k€ puis 8 % sur tout) crée une **baisse de commission quand le prix franchit 500 k€** (50 000 € → 40 000 €) ; Transaxio et Empire Flippers utilisent des tranches **marginales cumulatives**. À corriger.
- Sans minimum, les petites cessions (< 40 k€) rapportent < 4 000 € pour le même travail de conformité (KYC, mandat, NDA, LOI, facture) : coût marginal faible (software), donc acceptable, mais le temps admin du fondateur n'est pas nul.

---

## 7. Place libre pour CessionRGE

1. **La verticale RGE n'a pas de propriétaire.** Aucun concurrent n'a de filtre « qualifications RGE (domaines, organisme, date d'échéance, référent technique) », ni de contenu expert, ni de diligence. Le SERP est pris par des pages-catégories faibles.
2. **La confiance côté repreneur** (identité vérifiée, NDA, data room, journal des révélations) n'existe chez aucun média gratuit ; elle n'existe que chez les cabinets, au prix fort. C'est un vrai avantage, à condition de ne pas le facturer 10 %.
3. **La diligence RGE automatisée** (vérification ADEME/Qualibat/Qualit'EnR, référent technique, échéances, SIRET, sinistralité déclarative, exposition CEE/MPR, clause suspensive type « maintien de la qualification ») est un produit inexistant sur le marché et **vendable au repreneur sans intervention humaine**.
4. **Le deal-flow pour consolidateurs** (Butagaz, Isovalie, Émeraude, Satep, Renovio, fonds) : un abonnement « flux acquéreur RGE » (alertes par métier/région/CA, teasers avant publication) est un produit B2B à forte valeur, facturable 1 000–5 000 €/an, mais **nécessite une prise de contact initiale** (incompatible à 100 % avec « zéro commercial », compatible avec un e-mail du fondateur + self-service).
5. **Le canal public** (Bpifrance Transmission partenaire, CCI/CMA via Objectif Reprises, CAPEB/FFB) peut relayer gratuitement une plateforme verticale crédible.

---

## 8. Ce qui ne marchera pas (dit franchement)

- **Mandat exclusif signé avant toute publication.** Tous les concurrents publient gratuitement et sans mandat. L'exclusivité 12 mois bloque le cédant qui veut aussi être sur Fusacq/Transmibat (ce qu'il fera de toute façon). Résultat prévisible : peu d'annonces, donc peu de repreneurs, donc peu d'annonces. Alternative : mandat **non exclusif** ou mandat signé **au moment de la première mise en relation qualifiée**, pas au dépôt (à valider par le conseil : le mandat doit précéder l'entremise, pas l'affichage d'un teaser anonyme).
- **10 % HT pour une plateforme.** Le marché paie 10 % à un humain qui vend. Sans accompagnement, le taux de contournement sera élevé et la clause de suite difficile à faire exécuter pour un fondateur seul. Un barème plateforme crédible est 2–4 % avec minimum 1 000–2 000 € HT, ou 5–6 % avec une option « accompagnement » humain ponctuel (sous-traité à des conseils partenaires au succès).
- **Zéro revenu avant closing.** Avec un cycle de 9–18 mois et des volumes de niche (quelques dizaines d'annonces), le chiffre d'affaires de l'année 1 sera proche de zéro, quelle que soit la qualité du produit. Il faut un revenu self-service immédiat côté repreneur (contact/abonnement/diligence).
- **« Rachetez une société pour son RGE ».** La qualification ne se transfère pas en cession de fonds, dépend du référent technique, et le RGE devient plus accessible (procédure simplifiée 2026). Les acheteurs sérieux le savent. Le discours doit être « reprenez une activité RGE saine, vérifiée », pas « achetez un label ».
- **Le KYC obligatoire pour tout contact** divise la demande : aucun concurrent ne l'impose. Garder le KYC, mais le déclencher à l'étape NDA/accès data room (comme Empire Flippers avec le dépôt), pas au premier message.
- **La mise en relation sous-traitants/fournisseurs et le « besoin client entrant »** (v2) sont un autre métier, très concurrentiel (Hellio, Effy Pro, IZI by EDF) et très encadré (démarchage, RGPD). Le courtage CEE est plus réaliste mais vous met face à des délégataires qui ont des équipes commerciales ; en autonomie, c'est un formulaire + des partenariats, pas un moteur de croissance.

---

## 9. Recommandations de monétisation (autonomes, coûts maîtrisés)

| Brique | Prix suggéré | Qui paie | Justification marché | Coût de fonctionnement |
|---|---|---|---|---|
| Annonce teaser anonyme, publique, indexée | 0 € | — | Standard du marché ; alimente le SEO | Hébergement |
| Option « Annonce vérifiée RGE » (badge après vérification ADEME + Kbis + dirigeant) | 0 € (différenciant) ou 49 € HT | Cédant | Transentreprise fait payer 150–500 € ; le badge est la valeur | API ADEME gratuite, Stripe Identity ~1,25–1,50 €/vérif |
| Mise en relation : abonnement repreneur | 29 € HT/mois ou 249 € HT/an ; ou 39 € HT le contact | Repreneur | Fusacq 45–60 €/contact, Alvo 299 €/an, CRA 320 €/an, Acquire 390 $/an | Stripe |
| **Rapport de diligence RGE** (automatisé) | 149–290 € HT par entreprise | Repreneur (ou cédant pour « dossier vendeur ») | Inexistant sur le marché ; une diligence manuelle coûte des heures d'avocat | Scripts + données ouvertes |
| Commission au succès | 3 % HT (min 1 500 € HT) sur tranches **marginales** ; 5–6 % avec « accompagnement » | Au choix du mandat (acquéreur par défaut, usage fonds de commerce) | Alvo 2 %/1 000 € accepté ; 10 % réservé aux cabinets | Signature (Youtrust API ~104 €/mois pour 500 signatures, 2 €/supplémentaire ; QES 10–15 €), facturation |
| Flux acquéreur pour consolidateurs/fonds | 1 500–4 900 € HT/an | Groupes acquéreurs | Build-ups actifs (Butagaz, Isovalie, Émeraude, Satep, Renovio) | Alertes e-mail (Brevo) |
| Annuaire partenaires (avocats, experts-comptables, financeurs) | 30–90 € HT/mois | Experts | Place des Commerces 30 € HT/mois ; Fusacq 550–600 experts | Page + Stripe |

Coûts de fonctionnement unitaires relevés : Stripe Identity 1,25 €/vérification (page FR) à 1,50 $ ; Youtrust (ex-Yousign) API Plus 104–106 € HT/mois avec 500 signatures/an, 2 € par signature au-delà, QES 10–15 € HT. Sources : https://trustswiftly.com/blog/identity-verification-pricing-comparison-and-alternatives/ · https://youtrust.com/pricing-api · https://lelabotpe.fr/bureau-mobile/yousign-tarifs/

**Ordre de grandeur réaliste (année 1, sans commercial)** : 60–150 annonces RGE actives si le SEO est pris, 300–800 repreneurs inscrits, 5–15 closings déclarés. À 3 % min 1 500 € sur un prix médian de 150 k€ : 7–65 k€ de commissions ; abonnements/contacts : 5–20 k€ ; diligence : 3–15 k€ ; flux consolidateurs : 0–20 k€. **Total plausible : 15–120 k€ HT.** C'est un revenu de complément autonome, pas une entreprise à salariés, tant que la niche reste à 60 000 entreprises et que le marché monogeste est en contraction.

---

## 10. Questions ouvertes (à trancher avec le conseil d'AlterEgo)

1. Un teaser anonyme publié **sans mandat**, avec mandat signé à la première mise en relation, est-il compatible avec la carte T et l'art. 6 de la loi Hoguet ? (Fusacq/Alvo opèrent sans mandat car sans entremise.)
2. Une offre « média » payante côté repreneur (contact/abonnement) peut-elle coexister avec l'activité carte T sans être requalifiée en perception de fonds avant conclusion ? Faut-il deux entités/CGV distinctes ?
3. Le rapport de diligence RGE vendu au repreneur est-il une prestation indépendante de l'entremise (donc facturable avant closing) ?
4. Commission prélevée sur le séquestre (avocat/notaire) : clause type à insérer dans mandat + LOI + acte pour respecter l'identité du débiteur (jurisprudence Cass. citée par ONB).
5. LCB-FT : KYC des deux parties obligatoire pour un carte T — à quel moment du parcours ?
6. Indexation de cessionrge.fr : pourquoi le domaine n'apparaît sur aucune requête, y compris sa marque ?
7. Devenir partenaire de la Bourse Bpifrance Transmission (charte qualité, flux quotidien) : conditions d'admission ?

---

## Sources principales (URL)
- Fusacq tarifs : https://fusacq.com/tarifs/tarifs.php_fr_ ; CGU : https://www.fusacq.com/conditions-generales-utilisation_fr_
- Place des Commerces tarifs : https://www.placedescommerces.com/tarifs_fr_
- Alvo tarifs : https://www.alvo.market/tarifs-cedants-repreneurs ; intermédiaires : https://www.alvo.market/tarifs-transmission
- CessionPME (Bpifrance partenaire) : https://reprise-entreprise.bpifrance.fr/les-operateurs-partenaires/cession-pme ; chiffres : https://info.ouestfrance-immo.pro/cessionpme
- Transentreprise tarifs : https://www.haute-savoie.cci.fr/piloter/transmission/annonce-cession-entreprise-transentreprise ; https://www.bretagne.cci.fr/cession-transmission/reprendre-en-bretagne ; https://www.paysdelaloire.cci.fr/entreprise/transmission/transentreprise ; https://www.charente-maritime.cci.fr/produit/transentreprise-reseau-de-mise-en-relation-cedantsrepreneurs-dentreprises ; repreneur gratuit : https://www.legalstart.fr/fiches-pratiques/demarches-creation/transentreprise/
- Bpifrance Transmission : https://reprise-entreprise.bpifrance.fr/
- CRA : https://www.cra.asso.fr/adherer-au-cra.aspx ; https://plan-reprise-activite.com/cra-reprise-entreprise/
- Transmibat : https://www.ffbatiment.fr/actualites-batiment/actualite-ba/transmission-reprise-entreprise-transmibat-fait-peau-neuve
- CAPEB Transmission : https://www.capeb-transmission.fr/ ; CessionBTP : https://www.cessionbtp.fr/ ; Cap Cession : https://www.cap-cession.fr/secteurs/batiments-btp
- Michel Simond barème : https://www.msimond.fr/aide-contact/55/le-reseau-michel-simond-preconise-un-bareme-national-pour-les-cessions-de-murs-et-locations-les-cabinets-d-affaires-michel-simond-sont-des-structures-juridiques-independantes
- Transaxio honoraires : https://www.transaxio.fr/les-honoraires/ ; qui paie : https://www.transaxio.fr/actualites/vendeurs/qui-supporte-les-honoraires-lors-dune-cession-dentreprise/
- Hexagone Conseil : https://hexagoneconseil.fr/ ; Actoria : https://actoria.fr/contact/ ; In Extenso Finance : https://finance.inextenso.fr/metiers/accompagnement-transmission-cession/ ; Naviia : https://naviia-transmission.com/honoraires ; Reprise Transmission : https://www.reprisetransmission.fr/tarif-reprise-cession-entreprise.aspx ; Gestion Conseil : https://www.gestion-conseil.fr/devisxz.html
- Leboncoin : https://assistance.leboncoin.info/hc/fr/articles/25251056454418-Pourquoi-mon-d%C3%A9p%C3%B4t-d-annonce-est-il-payant ; https://www.leboncoin.fr/dc/cgv_pro
- Comparatifs : https://www.lesrepreneurs.fr/comparatif/sites-entreprises-a-vendre ; https://tool-advisor.fr/blog/site-vente-entreprise/ ; https://www.shine.fr/blog/meilleurs-sites-vente-entreprise/
- Honoraires cabinets : https://www.infocession.fr/cabinets-cession-entreprise ; https://matchingvalue.com/cabinet-daffaires/ ; https://www.swim.legal/blog/cession-fonds-de-commerce-honoraires-avocat
- Loi Hoguet : https://www.onb-france.com/actualites/loi-hoguet-applicable-entre-deux-professionnels-cession-de-fonds-de-commerce
- RGE données : https://www.data.gouv.fr/reuses/combien-dartisans-rge-en-france-chiffres-2026-par-domaine-de-travaux-et-organisme ; https://pro.hellio.com/blog/marche/baisse-entreprises-rge ; https://batizoom.ademe.fr/indicateurs/nombre-dentreprises-de-travaux-rge
- RGE transfert : https://www.qualibat.com/documentation/reglement-general-de-QUALIBAT-1.pdf ; https://www.formation-elysia.consulting/vos-questions-nos-r%C3%A9ponses/si-le-r%C3%A9f%C3%A9rent-rge-quitte-la-soci%C3%A9t%C3%A9-l-entreprise-garde-sa-certification/ ; https://www.effy.fr/pro/actualite/rge-demenagement-demarches-ne-pas-oublier ; https://www.qualit-enr.org/comprendre-le-cycle-de-qualification/
- MPR 2026 : https://www.economie.gouv.fr/particuliers/faire-des-economies-denergie/maprimerenov-parcours-par-geste-la-prime-pour-la-renovation-energetique ; https://kohenavocats.fr/2026/09/16/maprimerenov-exclusion-monogestes-chauffage-gaz-decret-recours-proprietaire/ ; PV : https://www.potentielsolaire.com/prix-rachat-electricite-photovoltaique
- Marché transmission : https://newsroom.groupebpce.fr/actualites/bpce-lobservatoire-veut-mettre-fin-aux-estimations-erronees-et-aux-idees-recues-sur-la-cession-transmission-des-tpe-et-pme-en-france-pour-une-action-publique-mieux-ciblee-1f180-7b707.html ; https://lelab.bpifrance.fr/storage/sites/31/2026/01/Transmission-et-reprise-dentreprise-Perspectives-2025.pdf ; https://www.artisanat.fr/system/files/medias/file/2026/01/20260109_LB_Transmission_reprise_VF.pdf ; https://artisan-assure.fr/statistiques/artisanat-batiment-france/ ; Objectif Reprises : https://www.economie.gouv.fr/actualites/objectif-reprises-un-plan-daction-pour-faciliter-la-transmission-reprise-des-entreprises
- Consolidateurs : https://www.pv-magazine.fr/2026/05/21/linstallateur-de-solutions-photovoltaiques-et-de-stockage-lumelio-rachete-par-butagaz/ ; https://www.cfnews.net/L-actualite/Build-up/Isovalie-isole-son-premier-build-up-723328 ; https://www.pv-magazine.fr/2025/10/08/emeraude-power-group-acquiert-systemes-solaires-et-etend-son-maillage-territorial/ ; https://www.bretagne-economique.com/actualites/photovoltaique-atout-groupe-rachete-solar-expansion/ ; https://www.cfnews.net/L-actualite/Build-up/Satep-multiplie-ses-chantiers-d-acquisitions-723170 ; https://www.hellio.com/actualites/communiques/negociation-exclusive-credit-mutuel-alliance-federale-hellio
- Étranger : https://help.acquire.com/how-much-does-it-cost-to-sell ; https://help.acquire.com/how-do-i-upgrade-from-the-free-plan ; https://www.bizbuysell.com/create-a-listing-FAQ/ ; https://searchspheresource.com/resources/bizbuysell ; https://empireflippers.com/changelog/ ; https://empireflippers.com/empire-flippers-terms-use-agreement/ ; https://flippa.com/pricing ; https://flippa.com/terms-of-service/
- Coûts : https://trustswiftly.com/blog/identity-verification-pricing-comparison-and-alternatives/ ; https://youtrust.com/pricing-api ; https://lelabotpe.fr/bureau-mobile/yousign-tarifs/
