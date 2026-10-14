// Référentiels partagés (métiers du bâtiment, domaines RGE, autres qualifications, régions,
// départements), identiques à backend/taxonomy.py : le test backend tests/test_taxonomy.py relit ce
// fichier pour garantir que les deux restent synchronisés (ne pas changer le format des tables).
//
// Les `value` sont exactement les valeurs stockées en base par CreateListing :
// libellé long pour les domaines RGE, nom accentué pour les régions, id pour les métiers.
// Toute page qui filtre ou crée une alerte doit utiliser ces constantes.
//
// Pas d'import : ce fichier est aussi chargé sans bundler par scripts/prerender.mjs.

// ------------------------------------------------------------------------------------------------
// Métiers du bâtiment (spécification §2.1). `id` stable et déjà au format URL ; `short` pour les
// cartes, titres et liens.
export const TRADES = [
  { id: 'plomberie-chauffage', label: 'Plomberie, chauffage, sanitaire', short: 'Plomberie-chauffage' },
  { id: 'pac-clim-cvc', label: 'Pompes à chaleur, climatisation, CVC', short: 'PAC, climatisation' },
  { id: 'electricite', label: 'Électricité générale', short: 'Électricité' },
  { id: 'isolation', label: 'Isolation (ITE, ITI, combles)', short: 'Isolation' },
  { id: 'couverture-charpente', label: 'Couverture, charpente, zinguerie', short: 'Couverture-charpente' },
  { id: 'menuiserie', label: 'Menuiserie, fermetures, stores', short: 'Menuiserie' },
  { id: 'maconnerie-gros-oeuvre', label: 'Maçonnerie, gros œuvre', short: 'Maçonnerie' },
  { id: 'platrerie-peinture', label: 'Plâtrerie, peinture, finitions', short: 'Plâtrerie-peinture' },
  { id: 'carrelage-sols', label: 'Carrelage, sols, parquets', short: 'Carrelage, sols' },
  { id: 'photovoltaique-enr', label: 'Photovoltaïque, énergies renouvelables', short: 'Photovoltaïque' },
  { id: 'renovation-generale', label: 'Rénovation générale, tous corps d\'état', short: 'Rénovation générale' },
  { id: 'terrassement-vrd', label: 'Terrassement, VRD, réseaux', short: 'Terrassement, VRD' },
  { id: 'etancheite', label: 'Étanchéité, bardage', short: 'Étanchéité' },
  { id: 'serrurerie-metallerie', label: 'Serrurerie, métallerie', short: 'Serrurerie-métallerie' },
  { id: 'agencement', label: 'Agencement, cuisines, salles de bains', short: 'Agencement' },
  { id: 'piscine-paysage', label: 'Piscines, paysage, clôtures', short: 'Piscines, paysage' },
];
export const MIN_TRADES = 1;
export const MAX_TRADES = 4;

// ------------------------------------------------------------------------------------------------
// Domaines RGE (inchangés)
export const RGE_CATEGORIES = [
  { id: 'isolation_interieur', label: 'Isolation par l\'intérieur (murs, rampants, plafonds)' },
  { id: 'isolation_exterieur', label: 'Isolation des murs par l\'extérieur' },
  { id: 'isolation_toiture', label: 'Isolation toiture terrasse / par l\'extérieur' },
  { id: 'isolation_combles', label: 'Isolation des combles perdus' },
  { id: 'isolation_plancher', label: 'Isolation plancher bas' },
  { id: 'menuiserie', label: 'Menuiseries extérieures (fenêtres, portes, volets)' },
  { id: 'chauffage_bois', label: 'Chauffage au bois (poêles, inserts, chaudières)' },
  { id: 'chauffage_gaz', label: 'Chaudières gaz/fioul à condensation' },
  { id: 'pac_air_eau', label: 'Pompes à chaleur air/eau' },
  { id: 'pac_eau_eau', label: 'Pompes à chaleur géothermiques (eau/eau)' },
  { id: 'pac_air_air', label: 'Pompes à chaleur air/air' },
  { id: 'chauffe_eau_thermo', label: 'Chauffe-eau thermodynamique' },
  { id: 'solaire_thermique', label: 'Capteurs solaires thermiques' },
  { id: 'solaire_combine', label: 'Systèmes solaires combinés' },
  { id: 'photovoltaique', label: 'Panneaux photovoltaïques' },
  { id: 'ventilation', label: 'Ventilation mécanique contrôlée (VMC)' },
  { id: 'audit_energetique', label: 'Audit énergétique' },
  { id: 'borne_recharge', label: 'Bornes de recharge véhicules électriques' },
];

// { id, value, label } — `value` = valeur stockée (libellé long)
export const RGE_TYPES = RGE_CATEGORIES.map((c) => ({ ...c, value: c.label }));

// ------------------------------------------------------------------------------------------------
// Autres qualifications, déclaratives (sans vérification)
export const OTHER_QUALIFICATIONS = [
  { id: 'qualibat', label: 'Qualibat' },
  { id: 'qualifelec', label: 'Qualifelec' },
  { id: 'qualit-enr', label: 'Qualit\'EnR (QualiPAC, QualiPV, Qualibois, Qualisol)' },
  { id: 'certibat', label: 'Certibat' },
  { id: 'nf-habitat', label: 'NF Habitat' },
  { id: 'handibat', label: 'Handibat' },
  { id: 'eco-artisan', label: 'ECO Artisan' },
  { id: 'irve', label: 'IRVE (bornes de recharge)' },
  { id: 'amiante-ss4', label: 'Amiante sous-section 4' },
  { id: 'cstb-etancheite', label: 'Certification CSTB étanchéité' },
];

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
// Métiers
export const tradeById = (id) => TRADES.find((t) => t.id === String(id || '').trim()) || null;
// Libellé d'un métier ('' si l'id est inconnu)
export const tradeLabel = (id, short = false) => {
  const t = tradeById(id);
  return t ? (short ? t.short : t.label) : '';
};
// Les ids sont déjà des slugs : la partie d'URL /metier/<slug> est l'id lui-même
export const tradeSlug = (id) => (tradeById(id) ? tradeById(id).id : '');
export const tradeBySlug = (slug) => {
  const s = slugify(slug);
  if (!s) return null;
  return TRADES.find((t) => t.id === s) || TRADES.find((t) => slugify(t.label) === s) || null;
};

// Correspondance domaine RGE → métier (préremplissage des anciennes annonces)
const RGE_TO_TRADE_EXACT = {
  menuiserie: 'menuiserie', chauffage_bois: 'plomberie-chauffage', chauffage_gaz: 'plomberie-chauffage',
  chauffe_eau_thermo: 'pac-clim-cvc', ventilation: 'pac-clim-cvc', photovoltaique: 'photovoltaique-enr',
  borne_recharge: 'electricite', audit_energetique: 'renovation-generale',
};
const RGE_TO_TRADE_PREFIXES = [['isolation', 'isolation'], ['pac_', 'pac-clim-cvc'], ['solaire_', 'photovoltaique-enr']];
export const rgeIdFor = (value) => {
  const v = String(value || '').trim();
  if (!v) return null;
  const byLabel = RGE_CATEGORIES.find((c) => c.label === v || c.id === v);
  if (byLabel) return byLabel.id;
  const s = slugify(v);
  const tolerant = RGE_CATEGORIES.find((c) => slugify(c.label) === s || slugify(c.id) === s);
  return tolerant ? tolerant.id : null;
};
export const tradeForRge = (value) => {
  const id = rgeIdFor(value);
  if (!id) return null;
  if (RGE_TO_TRADE_EXACT[id]) return RGE_TO_TRADE_EXACT[id];
  const rule = RGE_TO_TRADE_PREFIXES.find(([prefix]) => id.startsWith(prefix));
  return rule ? rule[1] : null;
};
// Métiers déduits d'une liste de domaines RGE (ids ou libellés), sans doublon, 4 au plus
export const tradesForRge = (rgeTypes, limit = MAX_TRADES) => {
  const out = [];
  (rgeTypes || []).forEach((value) => {
    const trade = tradeForRge(value);
    if (trade && !out.includes(trade) && (!limit || out.length < limit)) out.push(trade);
  });
  return out;
};

// ------------------------------------------------------------------------------------------------
// Autres qualifications
export const otherQualificationLabel = (id) => {
  const s = slugify(id);
  const q = OTHER_QUALIFICATIONS.find((o) => o.id === s);
  return q ? q.label : '';
};

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

export const rgeTypeBySlug = (slug) => RGE_TYPES.find((t) => slugify(t.value) === slug) || null;
export const regionBySlug = (slug) => REGIONS.find((r) => slugify(r) === slug) || null;
export const departementBySlug = (slug) => {
  const s = slugify(slug);
  if (!s) return null;
  return DEPARTEMENT_CODES.find((code) => slugify(code) === s || slugify(DEPARTEMENTS[code]) === s) || null;
};

// ------------------------------------------------------------------------------------------------
// Chemins publics
// Page des annonces (MODE-TEST-ET-APP.md §A.3) : « / » est la page des annonces ; les anciennes pages (recherche, hubs
// bâtiment et RGE) redirigent vers elle. Pour un lien filtré, utiliser listingsPath() de components/shared/listingFilters.
export const SEARCH_PATH = '/';

// Libellé court (sans précisions entre parenthèses), pour titres et liens
export const shortRgeLabel = (label) => String(label || '').replace(/\s*\([^)]*\)/g, '').trim();

// « en Bretagne », « dans les Pays de la Loire »…
const REGION_PREPOSITIONS = {
  'Pays de la Loire': 'dans les Pays de la Loire',
  'Grand Est': 'dans le Grand Est',
  'DOM-TOM': 'dans les DOM-TOM',
};
export const inRegion = (region) => REGION_PREPOSITIONS[region] || `en ${region}`;

// ------------------------------------------------------------------------------------------------
// Recherche libre (?q=… : SearchAction du JSON-LD WebSite) -> filtres structurés.
// Reconnaît une région, un département, des métiers et des domaines RGE par mots-clés ;
// le reste est ignoré. Un mot-clé est un préfixe de jeton ; terminé par '-' il doit être un jeton entier.
const QUERY_KEYWORDS = [
  ['pac_air_eau', ['pompe-a-chaleur', 'pompes-a-chaleur', 'pac', 'air-eau']],
  ['pac_eau_eau', ['geothermi', 'eau-eau']],
  ['pac_air_air', ['air-air', 'climatisation']],
  ['chauffe_eau_thermo', ['thermodynamique']],
  ['photovoltaique', ['photovoltai', 'panneaux-solaires', 'pv']],
  ['solaire_thermique', ['solaire-thermique', 'chauffe-eau-solaire']],
  ['isolation_exterieur', ['ite', 'isolation-exterieur', 'isolation-par-l-exterieur']],
  ['isolation_interieur', ['iti', 'isolation-interieur', 'isolation-par-l-interieur']],
  ['isolation_combles', ['combles']],
  ['menuiserie', ['menuiserie', 'fenetre']],
  ['ventilation', ['vmc', 'ventilation']],
  ['chauffage_bois', ['bois', 'poele', 'granule']],
  ['chauffage_gaz', ['chaudiere']],
  ['audit_energetique', ['audit']],
  ['borne_recharge', ['borne', 'irve', 'recharge']],
];

const TRADE_KEYWORDS = [
  ['plomberie-chauffage', ['plomb', 'chauffag', 'sanitaire', 'chaudiere']],
  ['pac-clim-cvc', ['pac-', 'pompe-a-chaleur', 'pompes-a-chaleur', 'clim', 'cvc', 'genie-climatique', 'frigori']],
  ['electricite', ['electri', 'domotique', 'irve', 'borne']],
  ['isolation', ['isolation', 'isolant', 'ite-', 'iti-', 'combles']],
  ['couverture-charpente', ['couvr', 'couvert', 'charpent', 'zingu', 'toiture', 'toit-']],
  ['menuiserie', ['menuis', 'fenetre', 'store', 'fermeture', 'volet', 'porte-']],
  ['maconnerie-gros-oeuvre', ['macon', 'gros-oeuvre', 'beton']],
  ['platrerie-peinture', ['platr', 'plaquiste', 'peintur', 'peintre', 'finition']],
  ['carrelage-sols', ['carrel', 'sol-', 'sols-', 'parquet', 'revetement']],
  ['photovoltaique-enr', ['photovolta', 'solaire', 'enr-', 'energies-renouvelables', 'pv-']],
  ['renovation-generale', ['renovation', 'tce-', 'tous-corps', 'multiservice']],
  ['terrassement-vrd', ['terrass', 'vrd', 'reseau', 'assainissement', 'demolition', 'travaux-publics', 'tp-']],
  ['etancheite', ['etanch', 'bardage']],
  ['serrurerie-metallerie', ['serrur', 'metall', 'ferronn']],
  ['agencement', ['agencement', 'cuisin', 'salle-de-bain', 'salles-de-bain']],
  ['piscine-paysage', ['piscin', 'paysag', 'cloture', 'jardin']],
];

// « -mot » : préfixe de jeton ; « -mot- » (mot-clé terminé par '-') : jeton entier
const keywordMatches = (s, w) => s.includes(`-${w}`);

export const parseSearchQuery = (q) => {
  const s = `-${slugify(q)}-`;
  if (s === '--') return { rgeTypes: [], region: '', trades: [], department: '' };
  const region = REGIONS.find((r) => s.includes(`-${slugify(r)}-`)) || '';
  const ids = QUERY_KEYWORDS
    .filter(([, words]) => words.some((w) => keywordMatches(s, w)))
    .map(([id]) => id);
  // « isolation » seul : tous les domaines d'isolation
  if (!ids.some((id) => id.startsWith('isolation')) && s.includes('-isolation')) {
    ids.push(...RGE_CATEGORIES.filter((c) => c.id.startsWith('isolation')).map((c) => c.id));
  }
  const rgeTypes = RGE_TYPES.filter((t) => ids.includes(t.id)).map((t) => t.value);
  const trades = TRADE_KEYWORDS
    .filter(([, words]) => words.some((w) => keywordMatches(s, w)))
    .map(([id]) => id);
  // Département : nom (« finistere ») ou code (« 29 », « 2a », « 974 ») comme jeton entier
  let department = DEPARTEMENT_CODES.find((code) => s.includes(`-${slugify(DEPARTEMENTS[code])}-`)) || '';
  if (!department) {
    const token = s.split('-').find((t) => /^(\d{2}|\d{3}|2a|2b)$/.test(t) && normalizeDepartement(t));
    department = token ? normalizeDepartement(token) : '';
  }
  return { rgeTypes, region, trades, department };
};

// ================================================================================================
// VENTELOC — référentiels des biens loués (docs/venteloc/SPEC.md §2), identiques à backend/taxonomy.py
// (même ordre, mêmes libellés ; tests/test_taxonomy.py les compare). Les tables « bâtiment » ci-dessus
// (TRADES, RGE, recherche libre) sont héritées de CessionRGE et seront supprimées.
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
