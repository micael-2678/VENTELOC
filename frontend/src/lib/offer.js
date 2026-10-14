// Offre commerciale (commission, textes de prix) — SOURCE UNIQUE côté front.
//
// Tout texte qui parle de prix ou de commission doit venir d'ici, pour qu'un changement de modèle ne
// touche que ce fichier. Utilisé par les composants React ET par scripts/prerender.mjs (fichier chargé
// sans bundler : pas d'import, uniquement des `export const` de données ou de fonctions pures).
//
// Dans les contenus éditoriaux (src/seo/*.json), une affirmation d'offre s'écrit « {{cle}} » et est
// remplacée par OFFER.cle (voir fillOffer).
//
// Modèle en vigueur (docs/refonte-2026-10/SPEC.md §3.1, identique à business_model.calculate_commission) :
// - annonce anonyme publiée sans frais ; mandat simple, non exclusif, résiliable à tout moment ;
// - commission de 6 % HT du prix de cession, 3 % HT sur la part au-delà d'un million d'euros,
//   minimum 4 000 € HT, TVA 20 % en sus ;
// - toujours à la charge du cédant, exigible uniquement à la signature de l'acte de cession ;
// - rien pour le repreneur, à aucune étape.
// Règle d'affichage : HT d'abord, TTC entre parenthèses.

const envNumber = (name, fallback) => {
  const raw = typeof process !== 'undefined' && process.env ? process.env[name] : undefined;
  const n = Number(String(raw == null ? '' : raw).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 && String(raw || '').trim() ? n : fallback;
};

// ---------------------------------------------------------------------------------------------
// Barème (données)
export const COMMISSION = {
  vatRate: 0.2,
  // Taux HT sur le prix de cession jusqu'au seuil, puis taux réduit sur la part au-delà
  rate: 0.06,
  rateAbove: 0.03,
  threshold: 1000000,
  // Minimum HT (REACT_APP_COMMISSION_MIN_HT, même valeur que COMMISSION_MIN_HT côté API)
  minimumHT: envNumber('REACT_APP_COMMISSION_MIN_HT', 4000),
  payer: 'cedant',
  termsVersion: 'v2',
  mandateHolder: 'AlterEgo SAS',
  // Exemple de référence affiché dans les pages et préchargé dans le calculateur
  examplePrice: 180000,
};

// ---------------------------------------------------------------------------------------------
// Formats (sans Intl : rendu identique Node / navigateur). Comme Intl fr-FR : espace fine insécable
// entre les milliers, espace insécable avant le symbole.
const THIN = ' ';
const NBSP = ' ';
export const formatEuros = (n) => `${String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, THIN)}${NBSP}€`;
export const formatRate = (rate) => `${String(Math.round(rate * 1000) / 10).replace('.', ',')}${NBSP}%`;
const ttcOf = (ht) => ht * (1 + COMMISSION.vatRate);
const round2 = (n) => Math.round(n * 100) / 100;

// « 6 % HT (7,2 % TTC) » — HT d'abord
export const rateLabel = (rateHT) => `${formatRate(rateHT)} HT (${formatRate(ttcOf(rateHT))} TTC)`;

const thresholdText = COMMISSION.threshold === 1000000 ? 'd\'un million d\'euros' : `de ${formatEuros(COMMISSION.threshold)}`;

// ---------------------------------------------------------------------------------------------
// Calcul
// computeCommission(prix) → { ht, vat, ttc, appliedMinimum, ratePercent, ratePercentLabel, rateHT, breakdown }
// - ht : commission HT (taux sur le prix jusqu'au seuil + taux réduit au-delà, puis minimum) ;
// - vat / ttc : TVA et montant TTC ;
// - appliedMinimum : vrai quand le minimum a remplacé le calcul ;
// - ratePercent : taux effectif en pourcentage (nombre, 2 décimales) ; ratePercentLabel : « 6 % » ;
// - rateHT : taux effectif (0,06) — conservé pour les appels existants.
export const computeCommission = (price) => {
  const p = Math.max(0, Number(price) || 0);
  const baseLow = Math.min(p, COMMISSION.threshold);
  const baseHigh = Math.max(0, p - COMMISSION.threshold);
  const computed = round2(baseLow * COMMISSION.rate + baseHigh * COMMISSION.rateAbove);
  const appliedMinimum = computed < COMMISSION.minimumHT;
  const ht = round2(appliedMinimum ? COMMISSION.minimumHT : computed);
  const vat = round2(ht * COMMISSION.vatRate);
  const ttc = round2(ht + vat);
  const rateHT = p > 0 ? ht / p : COMMISSION.rate;
  const ratePercent = Math.round(rateHT * 10000) / 100;
  const breakdown = [];
  if (baseLow > 0) breakdown.push({ from: 0, to: COMMISSION.threshold, base: round2(baseLow), rate: COMMISSION.rate, amountHT: round2(baseLow * COMMISSION.rate) });
  if (baseHigh > 0) breakdown.push({ from: COMMISSION.threshold, to: null, base: round2(baseHigh), rate: COMMISSION.rateAbove, amountHT: round2(baseHigh * COMMISSION.rateAbove) });
  return {
    ht,
    vat,
    ttc,
    appliedMinimum,
    ratePercent,
    ratePercentLabel: `${String(ratePercent).replace('.', ',')}${NBSP}%`,
    rateHT,
    computedHT: computed,
    minimumHT: COMMISSION.minimumHT,
    breakdown,
    payer: COMMISSION.payer,
  };
};

// Taux effectif (HT) pour un prix de cession donné
export const commissionRateFor = (price) => computeCommission(price).rateHT;

// « 10 800 € HT (12 960 € TTC) » — HT d'abord
export const commissionLabel = (price) => {
  const c = computeCommission(price);
  return `${formatEuros(c.ht)} HT (${formatEuros(c.ttc)} TTC)`;
};

// Lignes du tableau de barème (page Vendre, FAQ) : [{ tranche, rate, rateTTC, rateHT }]
export const commissionRows = () => [
  {
    tranche: `Jusqu'à ${formatEuros(COMMISSION.threshold)} de prix de cession`,
    rate: rateLabel(COMMISSION.rate),
    rateTTC: `${formatRate(ttcOf(COMMISSION.rate))} TTC`,
    rateHT: `${formatRate(COMMISSION.rate)} HT`,
  },
  {
    tranche: `Sur la part du prix au-delà de ${formatEuros(COMMISSION.threshold)}`,
    rate: rateLabel(COMMISSION.rateAbove),
    rateTTC: `${formatRate(ttcOf(COMMISSION.rateAbove))} TTC`,
    rateHT: `${formatRate(COMMISSION.rateAbove)} HT`,
  },
];

// Tableau du barème, rendu à l'identique par React (CommissionTable) et le pré-rendu
export const COMMISSION_TABLE = {
  headers: ['Prix de cession', 'Commission'],
  caption: `Minimum ${formatEuros(COMMISSION.minimumHT)} HT. TVA ${formatRate(COMMISSION.vatRate)} en sus. À la charge du cédant, exigible uniquement à la signature de l'acte de cession. Rien avant, rien pour le repreneur.`,
};

// ---------------------------------------------------------------------------------------------
// Phrases de base
const rateText = `${formatRate(COMMISSION.rate)} HT`;
const rateAboveText = `${formatRate(COMMISSION.rateAbove)} HT`;
const minimumText = `${formatEuros(COMMISSION.minimumHT)} HT`;

// Texte de référence du barème (SPEC §3.1), identique à business_model.commission_scale_text
const commissionSentence = `${rateText} du prix de cession (${rateAboveText} sur la part au-delà ${thresholdText}), minimum ${minimumText}, TVA en sus, à la charge du cédant, exigible uniquement à la signature de l'acte de cession. Rien avant. Rien pour le repreneur.`;

const example = computeCommission(COMMISSION.examplePrice);
const exampleText = `Exemple : pour une cession à ${formatEuros(COMMISSION.examplePrice)}, la commission s'élève à ${formatEuros(example.ht)} HT (${formatEuros(example.ttc)} TTC).`;
const payerText = 'La commission est toujours à la charge du cédant. Rien n\'est demandé au repreneur, à aucune étape.';
const buyerFreeText = 'Recherche, alertes et prise de contact sans frais pour les repreneurs.';
const mandateText = `La commission est prévue dans le mandat simple signé avec ${COMMISSION.mandateHolder} avant la publication de l'annonce : sans exclusivité, résiliable à tout moment avec un préavis de 15 jours. Elle n'est due que si la vente se conclut avec un repreneur que nous vous avons présenté.`;

// ---------------------------------------------------------------------------------------------
// Textes d'offre utilisés par les pages (toutes les clés existantes sont conservées)
export const OFFER = {
  // Phrase de référence et déclinaisons courtes
  commissionSentence,
  commissionShort: `${rateText} à la signature de l'acte, minimum ${minimumText}, à la charge du cédant.`,
  heroOfferLine: `Rien à payer avant la vente : ${rateText} à la signature de l'acte, sans exclusivité, mandat résiliable à tout moment.`,
  minimumNote: `Minimum ${minimumText} : pour les petites cessions, c'est ce montant qui s'applique.`,

  // Accueil : badge du hero et bandeau de garanties
  badge: `Rien à payer avant la vente · ${rateText} à la signature de l'acte`,
  trustTitle: '0 € avant la signature de l\'acte',
  trustText: 'C\'est la loi (art. 6, loi Hoguet) et notre modèle',

  // Accueil : section tarif
  pricingTitle: 'Vous ne payez qu\'à la vente.',
  pricingIntro: `À la signature de l'acte de cession, ${rateText} du prix (${rateAboveText} sur la part au-delà ${thresholdText}), minimum ${minimumText}, à la charge du cédant. Pas d'exclusivité, pas d'abonnement, rien pour les repreneurs.`,
  sellerPriceTag: 'À la vente uniquement',
  buyerPriceTag: 'Aucun frais',
  sellerPricingItems: [
    'Annonce anonyme publiée sans frais, sauvegardée à chaque étape',
    `${rateText} du prix de cession à la signature de l'acte (${rateAboveText} au-delà ${thresholdText}), minimum ${minimumText}, TVA en sus`,
    'Mandat simple : sans exclusivité, résiliable à tout moment avec un préavis de 15 jours',
    'Commission due uniquement si la vente se conclut avec un repreneur que nous vous avons présenté',
  ],
  buyerPricingItems: [
    'Recherche, alertes et prise de contact sans frais',
    'Identité vérifiée au moment de l\'accord de confidentialité, pas avant',
    'Aucun crédit, aucun abonnement',
    'La commission est toujours à la charge du cédant',
  ],
  // Ce que comprend la commission
  includesTitle: 'Ce que comprend la commission',
  includes: [
    'Diffusion anonyme de votre annonce et contrôle de vos qualifications sur les bases publiques',
    'Qualification des repreneurs : projet, budget et financement déclarés, identité vérifiée avant toute révélation de votre nom',
    'Accord de confidentialité, offre indicative et mandat signés en ligne, horodatés et envoyés aux deux parties',
    'Espace documents sécurisé avec filigrane et journal des consultations',
    'Suivi des offres, relances par e-mail, registre des mandats tenu par un professionnel carte T',
  ],
  negotiationNote: 'La négociation et les actes restent entre vous et le repreneur, avec vos conseils.',

  // Barème (texte)
  commissionMarginal: `Commission de ${rateText} du prix de cession, ${rateAboveText} sur la part au-delà ${thresholdText}, minimum ${minimumText}.`,
  commissionScale: `${rateText} jusqu'à ${formatEuros(COMMISSION.threshold)}, ${rateAboveText} sur la part au-delà, minimum ${minimumText}`,
  commissionExample: exampleText,
  commissionMandate: mandateText,
  payerSentence: payerText,

  // Phrases réutilisées dans les pages
  modelSentence: `La publication d'une annonce anonyme est sans frais. Une commission de ${rateText} du prix (minimum ${minimumText}) n'est due qu'en cas de vente, à la signature de l'acte de cession, à la charge du cédant. ${buyerFreeText}`,
  buyerFreeShort: buyerFreeText,
  buyerModel: `${buyerFreeText} ${payerText}`,
  sellerModelShort: `${rateText} à la vente, rien avant.`,
  roleSentence: `La plateforme est rémunérée uniquement par une commission en cas de vente, prévue dans le mandat simple signé avec ${COMMISSION.mandateHolder} avant la publication de l'annonce et payable à la signature de l'acte.`,

  // FAQ
  faqSellerCostQuestion: 'Combien ça coûte, et qui paie ?',
  faqSellerCostAnswer: `Rien avant la vente. À la signature de l'acte de cession, une commission de ${rateText} du prix (${rateAboveText} sur la part au-delà ${thresholdText}), minimum ${minimumText}, TVA en sus, à la charge du cédant. ${exampleText} Elle est due uniquement si la vente se conclut avec un repreneur que nous vous avons présenté.`,
  faqWhoPaysQuestion: 'Qui paie la commission ?',
  faqWhoPaysAnswer: `Le cédant, toujours : elle est prévue dans le mandat simple signé avec ${COMMISSION.mandateHolder} et réglée sur le prix à la signature de l'acte. Rien n'est demandé au repreneur, à aucune étape, et rien n'est payé avant la signature de l'acte.`,
  faqBuyerFreeQuestion: 'Est-ce gratuit pour les repreneurs ?',
  faqBuyerFreeAnswer: `Oui. La recherche, les alertes, la présentation de votre projet et les échanges avec le cédant sont sans frais : aucun crédit, aucun abonnement. ${payerText}`,

  // Boutons / accroches
  estimateCta: 'Estimer mon entreprise en 2 minutes',
  sellerCta: 'Déposer mon annonce anonyme',
  sellerPublish: `Déposez une annonce anonyme sans frais : ${rateText} uniquement à la vente.`,
  contactSellers: 'contactez les cédants sans frais',
  contactStep: 'Sans frais, via la messagerie de la plateforme. Le cédant est prévenu par e-mail.',
  signupToContact: 'Présentez votre projet au cédant en 2 minutes, sans frais',
  finalCtaSubtitle: `Annonce anonyme, repreneurs présentés avec leur projet, ${rateText} uniquement à la vente.`,
  freeMatchingStrong: 'Aucun frais',
  freeMatchingRest: 'pour les repreneurs : vous présentez votre projet, puis vous échangez avec le cédant.',
  sellerRegisterNote: `Annonce anonyme sans frais. Une commission de ${rateText} (minimum ${minimumText}) n'est due qu'en cas de vente, à la signature de l'acte, selon le mandat simple signé avec ${COMMISSION.mandateHolder} ; elle est à votre charge.`,

  // Méta-descriptions
  metaPlatform: 'Plateforme confidentielle de cession d\'entreprises du bâtiment',
  metaMatching: 'Annonces anonymes, repreneurs vérifiés, commission uniquement à la vente.',
  metaSignup: 'Créez votre compte pour vendre ou reprendre une entreprise du bâtiment. Inscription en 2 minutes.',
};

// Remplace les jetons {{cle}} par le texte d'offre correspondant.
export const fillOffer = (text) =>
  String(text == null ? '' : text).replace(/\{\{(\w+)\}\}/g, (m, key) => (typeof OFFER[key] === 'string' ? OFFER[key] : m));
