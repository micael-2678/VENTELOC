// Honoraires (barème) et textes de prix — SOURCE UNIQUE côté front.
//
// Tout texte qui parle de prix ou d'honoraires vient d'ici, pour qu'un changement de barème ne touche que ce fichier.
// Utilisé par les composants React ET par scripts/prerender.mjs (fichier chargé sans bundler : pas d'import,
// uniquement des `export const` de données ou de fonctions pures).
//
// Dans les contenus éditoriaux (src/seo/content.json), une affirmation d'offre s'écrit « {{cle}} » et est remplacée
// par OFFER.cle (voir fillOffer).
//
// Barème en vigueur (docs/venteloc/SPEC.md §0.4 et §7.1, identique à business_model.calculate_commission) :
// - un seul taux : COMMISSION_RATE_PERCENT HT du prix de vente (défaut 3 % HT, soit 3,6 % TTC) ;
// - minimum COMMISSION_MIN_HT (défaut 3 000 € HT, soit 3 600 € TTC), TVA 20 % ;
// - à la charge du vendeur, dus uniquement à la signature de l'acte authentique, réglés par le notaire sur le prix ;
// - rien pour l'acquéreur, rien avant l'acte.
// Règle d'affichage : TTC d'abord (vendeurs majoritairement particuliers, arrêté du 10 janvier 2017), HT entre
// parenthèses.
//
// Les valeurs du serveur (GET /config → commission {rate_percent_ht, rate_percent_ttc, minimum_ht, minimum_ttc,
// vat_rate}) priment : voir commissionConfig() et le crochet useCommission (src/lib/useCommission.js). Au pré-rendu,
// REACT_APP_COMMISSION_RATE_PERCENT et REACT_APP_COMMISSION_MIN_HT, sinon 3 % et 3 000 €.

const envNumber = (name, fallback) => {
  const raw = typeof process !== 'undefined' && process.env ? process.env[name] : undefined;
  const n = Number(String(raw == null ? '' : raw).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 && String(raw || '').trim() ? n : fallback;
};

// ---------------------------------------------------------------------------------------------
// Barème (données)
export const COMMISSION = {
  vatRate: 0.2,
  // Taux HT en pourcentage du prix de vente (REACT_APP_COMMISSION_RATE_PERCENT, même valeur que COMMISSION_RATE_PERCENT)
  ratePercentHT: envNumber('REACT_APP_COMMISSION_RATE_PERCENT', 3),
  // Minimum HT en euros (REACT_APP_COMMISSION_MIN_HT, même valeur que COMMISSION_MIN_HT côté API)
  minimumHT: envNumber('REACT_APP_COMMISSION_MIN_HT', 3000),
  payer: 'vendeur',
  termsVersion: 'v1',
  mandateHolder: 'AlterEgo SAS',
  // Exemple de référence affiché dans les pages et préchargé dans le calculateur
  examplePrice: 200000,
};

const positive = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// Barème renvoyé par GET /config (`commission`) → { ratePercentHT, minimumHT, vatRate } ; valeurs absentes ou
// invalides : repli sur COMMISSION (3 % HT, 3 000 € HT, TVA 20 %)
export const commissionConfig = (api) => {
  const a = api && typeof api === 'object' ? api : {};
  const vat = Number(a.vat_rate);
  // vat_rate accepté en fraction (0,2) ou en pourcentage (20)
  const vatRate = Number.isFinite(vat) && vat >= 0 ? (vat > 1 ? vat / 100 : vat) : COMMISSION.vatRate;
  return {
    ...COMMISSION,
    ratePercentHT: positive(a.rate_percent_ht) || COMMISSION.ratePercentHT,
    minimumHT: positive(a.minimum_ht) || COMMISSION.minimumHT,
    vatRate,
  };
};

// ---------------------------------------------------------------------------------------------
// Formats (sans Intl : rendu identique Node / navigateur). Comme Intl fr-FR : espace fine insécable entre les
// milliers, espace insécable avant le symbole.
const THIN = '\u202f';
const NBSP = '\u00a0';
const round2 = (n) => Math.round(n * 100) / 100;
export const formatEuros = (n) => `${String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, THIN)}${NBSP}€`;
// 3.6 → « 3,6 % » ; 3 → « 3 % »
export const formatPercent = (percent) => `${String(round2(Number(percent) || 0)).replace('.', ',')}${NBSP}%`;

const cfgOf = (cfg) => (cfg && typeof cfg === 'object' ? { ...COMMISSION, ...cfg } : COMMISSION);
const ttcOf = (ht, cfg) => round2(ht * (1 + cfgOf(cfg).vatRate));

// Taux TTC en pourcentage (3 → 3,6)
export const rateTTC = (cfg) => round2(cfgOf(cfg).ratePercentHT * (1 + cfgOf(cfg).vatRate));
// Minimum TTC en euros (3 000 → 3 600)
export const minimumTTC = (cfg) => ttcOf(cfgOf(cfg).minimumHT, cfg);

// « 3,6 % TTC (3 % HT) » — TTC d'abord
export const rateLabel = (cfg) => `${formatPercent(rateTTC(cfg))} TTC (${formatPercent(cfgOf(cfg).ratePercentHT)} HT)`;
// « 3 600 € TTC (3 000 € HT) »
export const minimumLabel = (cfg) => `${formatEuros(minimumTTC(cfg))} TTC (${formatEuros(cfgOf(cfg).minimumHT)} HT)`;

// ---------------------------------------------------------------------------------------------
// Calcul
// computeCommission(prix, cfg?) → { ht, vat, ttc, appliedMinimum, ratePercentHT, ratePercentTTC, effectivePercentTTC,
//   minimumHT, minimumTTC, netSeller, payer }
// - ht : prix × taux HT, ou le minimum HT s'il est supérieur ; vat / ttc : TVA et montant TTC ;
// - effectivePercentTTC : honoraires TTC rapportés au prix (supérieur au taux quand le minimum s'applique) ;
// - netSeller : prix diminué des honoraires TTC (ce que le vendeur perçoit avant ses autres frais).
export const computeCommission = (price, cfg) => {
  const c = cfgOf(cfg);
  const p = Math.max(0, Number(price) || 0);
  const computed = round2((p * c.ratePercentHT) / 100);
  const appliedMinimum = computed < c.minimumHT;
  const ht = round2(appliedMinimum ? c.minimumHT : computed);
  const vat = round2(ht * c.vatRate);
  const ttc = round2(ht + vat);
  return {
    ht,
    vat,
    ttc,
    appliedMinimum,
    ratePercentHT: c.ratePercentHT,
    ratePercentTTC: rateTTC(c),
    effectivePercentTTC: p > 0 ? round2((ttc / p) * 100) : rateTTC(c),
    minimumHT: c.minimumHT,
    minimumTTC: minimumTTC(c),
    netSeller: round2(Math.max(0, p - ttc)),
    payer: c.payer,
  };
};

// « 7 200 € TTC (6 000 € HT) » — TTC d'abord
export const commissionLabel = (price, cfg) => {
  const c = computeCommission(price, cfg);
  return `${formatEuros(c.ttc)} TTC (${formatEuros(c.ht)} HT)`;
};

// Honoraires d'une annonce : `commission_info` de l'API ({estimate_ttc, estimate_ht, rate_percent_ttc…}) s'il est
// fourni, sinon calcul local sur le prix demandé. → { ttc, ht, ratePercentTTC, ratePercentHT, minimumTTC, minimumHT }
export const listingCommission = (property, cfg) => {
  const info = property && property.commission_info;
  const local = computeCommission(property && property.asking_price, cfg);
  if (!info || typeof info !== 'object') return local;
  return {
    ...local,
    ttc: positive(info.estimate_ttc) || local.ttc,
    ht: positive(info.estimate_ht) || local.ht,
    ratePercentTTC: positive(info.rate_percent_ttc) || local.ratePercentTTC,
    ratePercentHT: positive(info.rate_percent_ht) || local.ratePercentHT,
    minimumTTC: positive(info.minimum_ttc) || local.minimumTTC,
    minimumHT: positive(info.minimum_ht) || local.minimumHT,
  };
};

// Lignes du barème (page Vendre) : [{ label, value }]
export const commissionRows = (cfg) => [
  { label: 'Honoraires', value: `${rateLabel(cfg)} du prix de vente` },
  { label: 'Minimum', value: minimumLabel(cfg) },
  { label: 'À la charge de', value: 'Le vendeur, à la signature de l\'acte authentique' },
  { label: 'Pour l\'acquéreur', value: 'Rien, à aucune étape' },
];

// ---------------------------------------------------------------------------------------------
// Phrases (construites à partir du barème)
// Texte de référence (SPEC §7.1), identique à business_model.commission_scale_text
export const commissionSentenceFor = (cfg) => `${formatPercent(rateTTC(cfg))} TTC du prix de vente (${formatPercent(cfgOf(cfg).ratePercentHT)} HT), minimum ${formatEuros(minimumTTC(cfg))} TTC (${formatEuros(cfgOf(cfg).minimumHT)} HT), à la charge du vendeur, dus uniquement à la signature de l'acte authentique et réglés par le notaire sur le prix. Rien avant. Rien pour l'acquéreur.`;

// Exemple chiffré : « Pour une vente à 200 000 €, les honoraires sont de 7 200 € TTC (6 000 € HT). »
export const commissionExampleFor = (price = COMMISSION.examplePrice, cfg) => {
  const c = computeCommission(price, cfg);
  return `Exemple : pour une vente à ${formatEuros(price)}, les honoraires sont de ${formatEuros(c.ttc)} TTC (${formatEuros(c.ht)} HT), réglés par le notaire sur le prix le jour de l'acte.`;
};

const rateShort = `${formatPercent(rateTTC())} TTC`;
const minimumShort = `${formatEuros(minimumTTC())} TTC`;
const payerText = 'Les honoraires sont toujours à la charge du vendeur. Rien n\'est demandé à l\'acquéreur, à aucune étape.';
const buyerFreeText = 'Recherche, alertes et prise de contact sans frais pour les acquéreurs.';
const mandateText = `Les honoraires sont prévus dans le mandat de vente simple signé avec ${COMMISSION.mandateHolder} avant la publication de l'annonce : sans exclusivité, d'une durée de 12 mois, résiliable à tout moment avec un préavis de 15 jours. Ils ne sont dus que si la vente se conclut avec un acquéreur que nous vous avons présenté.`;

// ---------------------------------------------------------------------------------------------
// Textes d'offre utilisés par les pages (valeurs par défaut du barème ; les pages dynamiques utilisent useCommission)
export const OFFER = {
  // Phrase de référence et déclinaisons courtes
  commissionSentence: commissionSentenceFor(),
  commissionShort: `${rateLabel()} du prix de vente, minimum ${minimumLabel()}, à la charge du vendeur, à la signature de l'acte authentique.`,
  commissionExample: commissionExampleFor(),
  commissionMandate: mandateText,
  minimumNote: `Minimum ${minimumLabel()} : pour les petits biens (parking, studio), c'est ce montant qui s'applique.`,
  heroOfferLine: `Rien à payer avant l'acte : ${rateShort} du prix, réglés par le notaire à la signature, sans exclusivité.`,
  sellerModelShort: `${rateShort} à la signature chez le notaire, rien avant.`,
  // Mention des annonces (honoraires à la charge du vendeur : prix affiché honoraires inclus)
  priceMention: 'Honoraires inclus, à la charge du vendeur',
  listingFeesMention: 'Prix honoraires inclus. Honoraires de négociation à la charge du vendeur : rien n\'est dû par l\'acquéreur.',

  trustTitle: '0 € avant l\'acte authentique',
  trustText: 'C\'est la loi (art. 6, loi Hoguet) et notre modèle',

  payerSentence: payerText,
  buyerFreeShort: buyerFreeText,
  buyerModel: `${buyerFreeText} ${payerText}`,
  roleSentence: `La plateforme est rémunérée uniquement par des honoraires en cas de vente, prévus dans le mandat simple signé avec ${COMMISSION.mandateHolder} avant la publication de l'annonce et réglés par le notaire à la signature de l'acte authentique.`,
  modelSentence: `La publication d'une annonce est sans frais. Des honoraires de ${rateLabel()} du prix (minimum ${minimumShort}) ne sont dus qu'en cas de vente, à la signature de l'acte authentique, à la charge du vendeur. ${buyerFreeText}`,

  // FAQ
  faqWhoPaysQuestion: 'Qui paie les honoraires ?',
  faqWhoPaysAnswer: `Le vendeur, toujours : ils sont prévus dans le mandat simple signé avec ${COMMISSION.mandateHolder} et réglés par le notaire sur le prix, le jour de l'acte authentique. Rien n'est demandé à l'acquéreur, et rien n'est payé avant la signature chez le notaire.`,

  // Boutons / accroches
  estimateCta: 'Estimer mon bien',
  sellerCta: 'Déposer mon annonce',
  sellerRegisterNote: `Annonce sans frais. Des honoraires de ${rateLabel()} du prix (minimum ${minimumShort}) ne sont dus qu'en cas de vente, à la signature de l'acte authentique, selon le mandat simple signé avec ${COMMISSION.mandateHolder} ; ils sont à votre charge et réglés par le notaire.`,
  signupToContact: 'Présentez votre projet au vendeur en 2 minutes, sans frais',

  // Méta-descriptions
  metaPlatform: 'Biens immobiliers déjà loués à vendre, de propriétaire à investisseur',
  metaMatching: 'Vendeurs et biens vérifiés, dossier complet, honoraires payés par le vendeur chez le notaire.',
  metaSignup: 'Créez votre compte pour vendre un bien loué ou investir dans un bien déjà loué. Inscription en 2 minutes.',
};

// Remplace les jetons {{cle}} par le texte d'offre correspondant.
export const fillOffer = (text) =>
  String(text == null ? '' : text).replace(/\{\{(\w+)\}\}/g, (m, key) => (typeof OFFER[key] === 'string' ? OFFER[key] : m));
