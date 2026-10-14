// Référentiels partagés (types de biens, baux, DPE, régions, départements…), identiques à backend/taxonomy.py : le test
// backend tests/test_taxonomy.py relit ce fichier pour garantir que les deux restent synchronisés (ne pas changer le
// format des tables ni les ids ; un libellé modifié doit l'être dans les deux fichiers).
//
// Toute page qui filtre, crée une alerte ou saisit une annonce doit utiliser ces constantes.
//
// Pas d'import : ce fichier est aussi chargé sans bundler par scripts/prerender.mjs.

// ------------------------------------------------------------------------------------------------
// Régions (inchangées) et départements (96 métropolitains dont 2A/2B + 5 DOM)
export const REGIONS = [
  'Île-de-France', 'Auvergne-Rhône-Alpes', 'Provence-Alpes-Côte d\'Azur',
  'Nouvelle-Aquitaine', 'Occitanie', 'Hauts-de-France', 'Pays de la Loire',
  'Bretagne', 'Grand Est', 'Normandie', 'Bourgogne-Franche-Comté',
  'Centre-Val de Loire', 'Corse', 'DOM-TOM'
];

export const DEPARTEMENTS = {
  '01': 'Ain', '02': 'Aisne', '03': 'Allier', '04': 'Alpes-de-Haute-Provence', '05': 'Hautes-Alpes',
  '06': 'Alpes-Maritimes', '07': 'Ardèche', '08': 'Ardennes', '09': 'Ariège', '10': 'Aube',
  '11': 'Aude', '12': 'Aveyron', '13': 'Bouches-du-Rhône', '14': 'Calvados', '15': 'Cantal',
  '16': 'Charente', '17': 'Charente-Maritime', '18': 'Cher', '19': 'Corrèze', '2A': 'Corse-du-Sud',
  '2B': 'Haute-Corse', '21': 'Côte-d\'Or', '22': 'Côtes-d\'Armor', '23': 'Creuse', '24': 'Dordogne',
  '25': 'Doubs', '26': 'Drôme', '27': 'Eure', '28': 'Eure-et-Loir', '29': 'Finistère',
  '30': 'Gard', '31': 'Haute-Garonne', '32': 'Gers', '33': 'Gironde', '34': 'Hérault',
  '35': 'Ille-et-Vilaine', '36': 'Indre', '37': 'Indre-et-Loire', '38': 'Isère', '39': 'Jura',
  '40': 'Landes', '41': 'Loir-et-Cher', '42': 'Loire', '43': 'Haute-Loire', '44': 'Loire-Atlantique',
  '45': 'Loiret', '46': 'Lot', '47': 'Lot-et-Garonne', '48': 'Lozère', '49': 'Maine-et-Loire',
  '50': 'Manche', '51': 'Marne', '52': 'Haute-Marne', '53': 'Mayenne', '54': 'Meurthe-et-Moselle',
  '55': 'Meuse', '56': 'Morbihan', '57': 'Moselle', '58': 'Nièvre', '59': 'Nord',
  '60': 'Oise', '61': 'Orne', '62': 'Pas-de-Calais', '63': 'Puy-de-Dôme', '64': 'Pyrénées-Atlantiques',
  '65': 'Hautes-Pyrénées', '66': 'Pyrénées-Orientales', '67': 'Bas-Rhin', '68': 'Haut-Rhin', '69': 'Rhône',
  '70': 'Haute-Saône', '71': 'Saône-et-Loire', '72': 'Sarthe', '73': 'Savoie', '74': 'Haute-Savoie',
  '75': 'Paris', '76': 'Seine-Maritime', '77': 'Seine-et-Marne', '78': 'Yvelines', '79': 'Deux-Sèvres',
  '80': 'Somme', '81': 'Tarn', '82': 'Tarn-et-Garonne', '83': 'Var', '84': 'Vaucluse',
  '85': 'Vendée', '86': 'Vienne', '87': 'Haute-Vienne', '88': 'Vosges', '89': 'Yonne',
  '90': 'Territoire de Belfort', '91': 'Essonne', '92': 'Hauts-de-Seine', '93': 'Seine-Saint-Denis',
  '94': 'Val-de-Marne', '95': 'Val-d\'Oise',
  '971': 'Guadeloupe', '972': 'Martinique', '973': 'Guyane', '974': 'La Réunion', '976': 'Mayotte',
};
export const DEPARTEMENT_CODES = Object.keys(DEPARTEMENTS);

// Région de chaque département (même découpage que REGIONS ; les DOM sont regroupés)
const REGION_DEPARTEMENTS = {
  'Auvergne-Rhône-Alpes': ['01', '03', '07', '15', '26', '38', '42', '43', '63', '69', '73', '74'],
  'Bourgogne-Franche-Comté': ['21', '25', '39', '58', '70', '71', '89', '90'],
  'Bretagne': ['22', '29', '35', '56'],
  'Centre-Val de Loire': ['18', '28', '36', '37', '41', '45'],
  'Corse': ['2A', '2B'],
  'Grand Est': ['08', '10', '51', '52', '54', '55', '57', '67', '68', '88'],
  'Hauts-de-France': ['02', '59', '60', '62', '80'],
  'Île-de-France': ['75', '77', '78', '91', '92', '93', '94', '95'],
  'Normandie': ['14', '27', '50', '61', '76'],
  'Nouvelle-Aquitaine': ['16', '17', '19', '23', '24', '33', '40', '47', '64', '79', '86', '87'],
  'Occitanie': ['09', '11', '12', '30', '31', '32', '34', '46', '48', '65', '66', '81', '82'],
  'Pays de la Loire': ['44', '49', '53', '72', '85'],
  'Provence-Alpes-Côte d\'Azur': ['04', '05', '06', '13', '83', '84'],
  'DOM-TOM': ['971', '972', '973', '974', '976'],
};
const DEPARTEMENT_REGION = Object.keys(REGION_DEPARTEMENTS).reduce((acc, region) => {
  REGION_DEPARTEMENTS[region].forEach((code) => { acc[code] = region; });
  return acc;
}, {});

// ------------------------------------------------------------------------------------------------
// Version URL-safe d'un libellé : sans accents, minuscules, tirets. Identique à taxonomy.slugify.
export const slugify = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/['’]/g, '-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

// ------------------------------------------------------------------------------------------------
// Départements, régions
// Code canonique ('29', '2A', '974') ou '' si inconnu ; accepte '2a', ' 29 ', '029'
export const normalizeDepartement = (code) => {
  let s = String(code || '').trim().toUpperCase();
  if (!s) return '';
  if (DEPARTEMENTS[s]) return s;
  if (/^\d+$/.test(s)) {
    if (s.length === 1) s = `0${s}`;
    else if (s.length === 3 && s.startsWith('0')) s = s.slice(1);
    if (DEPARTEMENTS[s]) return s;
  }
  return '';
};
// « Finistère (29) » ; '' si le code est inconnu
export const departementLabel = (code) => {
  const c = normalizeDepartement(code);
  return c ? `${DEPARTEMENTS[c]} (${c})` : '';
};
export const departementName = (code) => {
  const c = normalizeDepartement(code);
  return c ? DEPARTEMENTS[c] : '';
};
export const regionForDepartement = (code) => {
  const c = normalizeDepartement(code);
  return c ? DEPARTEMENT_REGION[c] || '' : '';
};
export const departementsForRegion = (region) => (REGION_DEPARTEMENTS[String(region || '').trim()] || []).slice();
// Options { code, label } d'une région (ou de toutes), pour les listes déroulantes
export const departementOptions = (region) => {
  const codes = region ? departementsForRegion(region) : DEPARTEMENT_CODES;
  return codes.map((code) => ({ code, label: departementLabel(code) }));
};
// Code département déduit d'un code postal ('29200' → '29', '20000' → '2A', '97400' → '974')
export const departementFromPostalCode = (postalCode) => {
  const cp = String(postalCode || '').replace(/\D/g, '');
  if (cp.length !== 5) return '';
  if (cp.startsWith('97') || cp.startsWith('98')) return normalizeDepartement(cp.slice(0, 3));
  if (cp.startsWith('20')) return Number(cp) < 20200 ? '2A' : '2B';
  return normalizeDepartement(cp.slice(0, 2));
};

export const regionBySlug = (slug) => REGIONS.find((r) => slugify(r) === slug) || null;
export const departementBySlug = (slug) => {
  const s = slugify(slug);
  if (!s) return null;
  return DEPARTEMENT_CODES.find((code) => slugify(code) === s || slugify(DEPARTEMENTS[code]) === s) || null;
};

// ------------------------------------------------------------------------------------------------
// Chemins publics
// Page des annonces : « / ». Pour un lien filtré, utiliser listingsPath() de components/shared/listingFilters.
export const SEARCH_PATH = '/';

// « en Bretagne », « dans les Pays de la Loire »…
const REGION_PREPOSITIONS = {
  'Pays de la Loire': 'dans les Pays de la Loire',
  'Grand Est': 'dans le Grand Est',
  'DOM-TOM': 'dans les DOM-TOM',
};
export const inRegion = (region) => REGION_PREPOSITIONS[region] || `en ${region}`;

// ================================================================================================
// VENTELOC — référentiels des biens loués (docs/venteloc/SPEC.md §2), identiques à backend/taxonomy.py
// (même ordre, mêmes libellés ; tests/test_taxonomy.py les compare).
// ------------------------------------------------------------------------------------------------
// Types de biens. `category` : habitation | professionnel | annexe.
export const PROPERTY_TYPES = [
  { id: 'appartement', label: 'Appartement', short: 'Appartement', category: 'habitation' },
  { id: 'maison', label: 'Maison', short: 'Maison', category: 'habitation' },
  { id: 'immeuble', label: 'Immeuble de rapport', short: 'Immeuble', category: 'habitation' },
  { id: 'residence-geree', label: 'Lot en résidence gérée (étudiants, seniors, tourisme, EHPAD)', short: 'Résidence gérée', category: 'professionnel' },
  { id: 'local-commercial', label: 'Local commercial', short: 'Local commercial', category: 'professionnel' },
  { id: 'bureaux', label: 'Bureaux', short: 'Bureaux', category: 'professionnel' },
  { id: 'parking', label: 'Parking, box, garage', short: 'Parking', category: 'annexe' },
  { id: 'autre', label: 'Autre bien loué', short: 'Bien', category: 'annexe' },
];

// Types de baux. `regime` : habitation (loi du 6 juillet 1989, calendrier DPE) | commercial | professionnel | autre.
export const LEASE_TYPES = [
  { id: 'habitation-vide', label: 'Bail d\'habitation vide (loi du 6 juillet 1989)', short: 'Location vide', regime: 'habitation' },
  { id: 'habitation-meublee', label: 'Bail d\'habitation meublé (résidence principale)', short: 'Location meublée', regime: 'habitation' },
  { id: 'colocation', label: 'Colocation (bail unique ou baux individuels)', short: 'Colocation', regime: 'habitation' },
  { id: 'bail-mobilite', label: 'Bail mobilité (1 à 10 mois)', short: 'Bail mobilité', regime: 'habitation' },
  { id: 'mixte', label: 'Bail mixte (habitation et professionnel)', short: 'Bail mixte', regime: 'habitation' },
  { id: 'commercial', label: 'Bail commercial (3-6-9)', short: 'Bail commercial', regime: 'commercial' },
  { id: 'residence-geree', label: 'Bail commercial avec un exploitant de résidence', short: 'Bail exploitant', regime: 'commercial' },
  { id: 'professionnel', label: 'Bail professionnel', short: 'Bail professionnel', regime: 'professionnel' },
  { id: 'parking', label: 'Location de parking ou de box', short: 'Location parking', regime: 'autre' },
  { id: 'plusieurs-baux', label: 'Plusieurs baux (immeuble ou plusieurs lots)', short: 'Plusieurs baux', regime: 'habitation' },
];

// DPE : classes A à G, plus « DPE vierge » et « non soumis »
export const DPE_CLASSES = [
  { id: 'A', label: 'A' },
  { id: 'B', label: 'B' },
  { id: 'C', label: 'C' },
  { id: 'D', label: 'D' },
  { id: 'E', label: 'E' },
  { id: 'F', label: 'F' },
  { id: 'G', label: 'G' },
  { id: 'vierge', label: 'DPE vierge' },
  { id: 'non-soumis', label: 'Non soumis au DPE' },
];
// Interdiction de louer un logement (nouveau bail, renouvellement, reconduction) : loi Climat et résilience, art. 160
export const DPE_RENTAL_BAN = {
  G: '2025-01-01',
  F: '2028-01-01',
  E: '2034-01-01',
};

export const TENANT_PAYMENT_STATUSES = [
  { id: 'a-jour', label: 'Loyers payés à l\'échéance' },
  { id: 'retards', label: 'Retards ponctuels, régularisés' },
  { id: 'impayes', label: 'Impayés en cours' },
];

export const OWNER_TYPES = [
  { id: 'personne-physique', label: 'Propriétaire en nom propre' },
  { id: 'indivision', label: 'Indivision (plusieurs propriétaires)' },
  { id: 'sci', label: 'Société civile immobilière (SCI)' },
  { id: 'societe', label: 'Autre société (SARL, SAS…)' },
];

export const SALE_OBJECTS = [
  { id: 'bien', label: 'Vente du bien (immeuble ou lot de copropriété)' },
  { id: 'parts', label: 'Cession des parts de la société propriétaire' },
  { id: 'indifferent', label: 'Bien ou parts, à décider avec l\'acquéreur' },
];

export const SALE_REASONS = [
  { id: 'arbitrage', label: 'Arbitrage de patrimoine' },
  { id: 'succession', label: 'Succession, donation, partage' },
  { id: 'liquidites', label: 'Besoin de liquidités' },
  { id: 'fiscalite', label: 'Fiscalité' },
  { id: 'gestion', label: 'Ne plus gérer de location' },
  { id: 'autre', label: 'Autre raison' },
];

export const BUYER_PROJECT_TYPES = [
  { id: 'particulier', label: 'Investisseur particulier (en nom propre)' },
  { id: 'sci', label: 'Achat via une SCI' },
  { id: 'societe', label: 'Société (IS, holding)' },
  { id: 'professionnel', label: 'Investisseur professionnel, marchand de biens' },
];

export const FINANCING_TYPES = [
  { id: 'comptant', label: 'Comptant' },
  { id: 'emprunt', label: 'Emprunt bancaire' },
  { id: 'mixte', label: 'Apport et emprunt' },
  { id: 'a-definir', label: 'À définir' },
];

export const propertyTypeById = (id) => PROPERTY_TYPES.find((t) => t.id === String(id || '').trim()) || null;
export const propertyTypeLabel = (id, short = false) => {
  const t = propertyTypeById(id);
  return t ? (short ? t.short : t.label) : '';
};
export const leaseTypeById = (id) => LEASE_TYPES.find((t) => t.id === String(id || '').trim()) || null;
export const leaseTypeLabel = (id, short = false) => {
  const t = leaseTypeById(id);
  return t ? (short ? t.short : t.label) : '';
};
export const isHousingLease = (id) => leaseTypeById(id)?.regime === 'habitation';
const labelIn = (table) => (id) => (table.find((x) => x.id === id) || {}).label || '';
export const dpeLabel = labelIn(DPE_CLASSES);
export const tenantPaymentLabel = labelIn(TENANT_PAYMENT_STATUSES);
export const ownerTypeLabel = labelIn(OWNER_TYPES);
export const saleObjectLabel = labelIn(SALE_OBJECTS);
export const saleReasonLabel = labelIn(SALE_REASONS);
export const buyerProjectTypeLabel = labelIn(BUYER_PROJECT_TYPES);
export const financingTypeLabel = labelIn(FINANCING_TYPES);

// Décence énergétique : { status: 'interdit' | 'echeance' | 'ok' | 'non-applicable', date } (même règle que taxonomy.dpe_rental_status)
export const dpeRentalStatus = (dpeClass, leaseId, today = new Date().toISOString().slice(0, 10)) => {
  if (!isHousingLease(leaseId)) return { status: 'non-applicable', date: null };
  const ban = DPE_RENTAL_BAN[String(dpeClass || '').trim().toUpperCase()];
  if (!ban) return { status: 'ok', date: null };
  return { status: today >= ban ? 'interdit' : 'echeance', date: ban };
};

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (x) => Math.round(x * 100) / 100;
// Rendement brut en % (loyer hors charges × 12 / prix) ; null si incalculable
export const grossYield = (rentMonthly, price) => {
  const rent = num(rentMonthly);
  const p = num(price);
  return rent > 0 && p > 0 ? round2((rent * 12) / p * 100) : null;
};
// Rendement net de charges en % : (loyers annuels − taxe foncière − charges non récupérables − autres frais) / prix
export const netYield = (rentMonthly, price, propertyTax = 0, nonRecoverable = 0, otherCosts = 0) => {
  const rent = num(rentMonthly);
  const p = num(price);
  if (rent <= 0 || p <= 0) return null;
  return round2((rent * 12 - num(propertyTax) - num(nonRecoverable) - num(otherCosts)) / p * 100);
};

// Titre généré (même règle que taxonomy.property_title) : « Appartement T2 loué · 42 m² · Lyon (69) »
const PROPERTY_TITLE_HEADS = {
  appartement: ['Appartement', 'loué'],
  maison: ['Maison', 'louée'],
  immeuble: ['Immeuble de rapport', 'loué'],
  'residence-geree': ['Lot en résidence gérée', 'loué'],
  'local-commercial': ['Local commercial', 'loué'],
  bureaux: ['Bureaux', 'loués'],
  parking: ['Parking', 'loué'],
  autre: ['Bien', 'loué'],
};
const fmtSurface = (surface) => {
  const s = num(surface);
  if (s <= 0) return '';
  return `${Number.isInteger(s) ? String(s) : s.toFixed(1).replace('.', ',')} m²`;
};
export const propertyTitle = ({ propertyType, city, department, surface, rooms, unitsCount } = {}) => {
  const t = propertyTypeById(propertyType);
  let [head, rented] = PROPERTY_TITLE_HEADS[t ? t.id : 'autre'];
  const nRooms = parseInt(rooms, 10);
  if (t && ['appartement', 'maison'].includes(t.id) && nRooms > 0) head = `${head} T${nRooms}`;
  const parts = [`${head} ${rented}`];
  const nUnits = parseInt(unitsCount, 10);
  if (t && t.id === 'immeuble' && nUnits > 0) parts.push(`${nUnits} lot${nUnits > 1 ? 's' : ''}`);
  const surf = fmtSurface(surface);
  if (surf && !(t && t.id === 'parking')) parts.push(surf);
  const dep = normalizeDepartement(department);
  const place = String(city || '').trim();
  if (place && dep) parts.push(`${place} (${dep})`);
  else if (place) parts.push(place);
  else if (dep) parts.push(departementLabel(dep));
  return parts.join(' · ');
};
