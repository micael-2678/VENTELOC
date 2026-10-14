// Filtres de la page des annonces (/) et du module intégrable (/embed/annonces) — docs/venteloc/SPEC.md §5.1, API.md §10.
//
// Paramètres d'URL (partageables, utilisables depuis le site WordPress) :
//   type=appartement,maison · bail=habitation-vide,habitation-meublee · region=bretagne · departement=69
//   prix_max=300000 · rendement_min=5 · surface_min=20 · tri=recent|prix_asc|prix_desc|rendement_desc · page=2
// Une région en toutes lettres (« Bretagne ») est acceptée et réécrite en slug (canonicalSearch).
//
// Paramètres d'API (GET /properties, API.md §2) : property_types, lease_types, region (nom), department, max_price,
// min_yield, min_surface, sort (recent|price_asc|price_desc|yield_desc), limit, page. Tous les critères sont filtrés par
// le serveur : X-Total-Count est exact.
import axios from 'axios';
import {
  PROPERTY_TYPES, LEASE_TYPES, REGIONS, slugify, regionBySlug, normalizeDepartement, regionForDepartement, departementLabel,
  propertyTypeLabel, leaseTypeLabel,
} from '@/lib/referentiels';
import { readableSpaces } from '@/components/shared/formatters';

const BACKEND_URL = String(process.env.REACT_APP_BACKEND_URL || '').replace(/\/+$/, '');
export const PROPERTIES_URL = `${BACKEND_URL}/api/properties`;

export const LISTINGS_PATH = '/';
export const PAGE_SIZE = 24;

export const SORTS = [
  { value: 'recent', api: 'recent', label: 'Plus récentes' },
  { value: 'prix_asc', api: 'price_asc', label: 'Prix croissant' },
  { value: 'prix_desc', api: 'price_desc', label: 'Prix décroissant' },
  { value: 'rendement_desc', api: 'yield_desc', label: 'Meilleur rendement' },
];

export const PRICE_MAX_OPTIONS = [50000, 100000, 150000, 200000, 300000, 400000, 500000, 750000, 1000000, 2000000];
export const YIELD_MIN_OPTIONS = [3, 4, 5, 6, 7, 8, 10];
export const SURFACE_MIN_OPTIONS = [15, 20, 30, 40, 50, 70, 100, 150];

export const EMPTY_FILTERS = Object.freeze({
  types: [], baux: [], region: '', departement: '', prixMax: '', rendementMin: '', surfaceMin: '', tri: 'recent', page: 1,
});

// Clés d'URL lues par la page : tout autre paramètre (utm_source…) est conservé tel quel
const FILTER_KEYS = ['type', 'bail', 'region', 'departement', 'prix_max', 'rendement_min', 'surface_min', 'tri', 'page'];

const positiveInt = (value) => {
  const n = parseInt(String(value || '').replace(/\s/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? String(n) : '';
};
// Rendement : nombre décimal positif, 20 % au plus (« 5,5 » accepté)
const positiveYield = (value) => {
  const n = Number(String(value || '').replace(',', '.').trim());
  return Number.isFinite(n) && n > 0 && n <= 20 ? String(n) : '';
};

// « bretagne », « Bretagne », « Pays de la Loire » → nom canonique (valeur stockée) ; '' si inconnu
export const regionFromParam = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (REGIONS.includes(raw)) return raw;
  return regionBySlug(slugify(raw)) || '';
};

export const regionSlug = (region) => (region ? slugify(region) : '');

// Liste d'ids séparés par des virgules → ids connus, sans doublon, dans l'ordre du référentiel
const idsFromList = (value, table) => {
  const wanted = String(value || '').split(',').map((s) => slugify(s.trim())).filter(Boolean);
  return table.filter((t) => wanted.includes(t.id)).map((t) => t.id);
};

const sortFromParam = (value) => {
  const v = String(value || '').trim();
  const byApi = SORTS.find((s) => s.api === v);
  if (byApi) return byApi.value;
  return SORTS.some((s) => s.value === v) ? v : 'recent';
};

// URLSearchParams → filtres
export const filtersFromParams = (params) => {
  const p = params instanceof URLSearchParams ? params : new URLSearchParams(params || '');
  const departement = normalizeDepartement(p.get('departement'));
  const region = regionFromParam(p.get('region')) || (departement ? regionForDepartement(departement) : '');
  return {
    types: idsFromList(p.get('type'), PROPERTY_TYPES),
    baux: idsFromList(p.get('bail'), LEASE_TYPES),
    region,
    // Un département hors de la région choisie est ignoré
    departement: departement && (!region || regionForDepartement(departement) === region) ? departement : '',
    prixMax: positiveInt(p.get('prix_max')),
    rendementMin: positiveYield(p.get('rendement_min')),
    surfaceMin: positiveInt(p.get('surface_min')),
    tri: sortFromParam(p.get('tri')),
    page: Math.max(1, parseInt(p.get('page') || '1', 10) || 1),
  };
};

// Filtres → chaîne de requête canonique, sans « ? » (virgules lisibles dans type=… et bail=…)
export const listingsQuery = (filters) => {
  const f = { ...EMPTY_FILTERS, ...(filters || {}) };
  const parts = [];
  const add = (key, value) => { if (value) parts.push(`${key}=${encodeURIComponent(String(value))}`); };
  if (f.types.length) parts.push(`type=${f.types.map(encodeURIComponent).join(',')}`);
  if (f.baux.length) parts.push(`bail=${f.baux.map(encodeURIComponent).join(',')}`);
  add('region', regionSlug(f.region));
  add('departement', f.departement);
  add('prix_max', f.prixMax);
  add('rendement_min', f.rendementMin);
  add('surface_min', f.surfaceMin);
  if (f.tri && f.tri !== 'recent') add('tri', f.tri);
  if (f.page > 1) add('page', f.page);
  return parts.join('&');
};

// Lien vers la page des annonces : listingsPath({ types: ['appartement'], region: 'Bretagne' }) → « /?type=appartement&region=bretagne »
export const listingsPath = (filters, base = LISTINGS_PATH) => {
  const q = listingsQuery(filters);
  return q ? `${base}?${q}` : base;
};

// Paramètres à réécrire (région en toutes lettres, tri au format de l'API, liste d'ids non canonique) → chaîne
// canonique (paramètres étrangers conservés), sinon null
export const canonicalSearch = (search) => {
  const params = new URLSearchParams(search || '');
  const region = params.get('region');
  const regionIsName = Boolean(region) && regionSlug(regionFromParam(region)) !== region;
  const apiSort = SORTS.some((s) => s.api === params.get('tri') && s.api !== s.value);
  if (!regionIsName && !apiSort) return null;
  const others = [];
  params.forEach((value, key) => {
    if (!FILTER_KEYS.includes(key)) others.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  });
  return [listingsQuery(filtersFromParams(params)), ...others].filter(Boolean).join('&');
};

// Nombre de critères actifs (bouton « Filtres (n) »)
export const activeFilterCount = (f) => (f.types || []).length + (f.baux || []).length
  + [f.region, f.departement, f.prixMax, f.rendementMin, f.surfaceMin].filter(Boolean).length;

export const hasActiveFilters = (f) => activeFilterCount(f) > 0;

// Filtres → paramètres de GET /properties
export const apiParams = (f, { page = 1, limit = PAGE_SIZE } = {}) => {
  const sort = SORTS.find((s) => s.value === f.tri) || SORTS[0];
  return {
    ...(f.types.length ? { property_types: f.types.join(',') } : {}),
    ...(f.baux.length ? { lease_types: f.baux.join(',') } : {}),
    ...(f.region ? { region: f.region } : {}),
    ...(f.departement ? { department: f.departement } : {}),
    ...(f.prixMax ? { max_price: Number(f.prixMax) } : {}),
    ...(f.rendementMin ? { min_yield: Number(f.rendementMin) } : {}),
    ...(f.surfaceMin ? { min_surface: Number(f.surfaceMin) } : {}),
    sort: sort.api,
    limit,
    page,
  };
};

const totalFrom = (res, fallback) => {
  const header = Number(res && res.headers && res.headers['x-total-count']);
  return Number.isFinite(header) && header >= 0 ? header : fallback;
};
const listFrom = (res) => (res && Array.isArray(res.data) ? res.data : []);

// Annonces publiques d'une page de résultats → { items, total }.
// Requête sans jeton (axios nu) : un vendeur connecté voit les annonces publiques, pas les siennes (API.md §2).
export const fetchListings = async (f, { page = 1, limit = PAGE_SIZE, signal } = {}) => {
  const res = await axios.get(PROPERTIES_URL, { params: apiParams(f, { page, limit }), signal });
  const items = listFrom(res);
  return { items, total: totalFrom(res, items.length + (page - 1) * limit) };
};

// Libellés des critères actifs (puces supprimables au-dessus des résultats)
const NUMBER = new Intl.NumberFormat('fr-FR');
export const formatEurosShort = (n) => `${readableSpaces(NUMBER.format(Number(n)))}\u00a0€`;
export const formatYieldShort = (n) => `${String(n).replace('.', ',')}\u00a0%`;

export const filterChips = (f) => {
  const chips = (f.types || []).map((id) => ({
    key: `type-${id}`, label: propertyTypeLabel(id, true) || id, remove: (x) => ({ ...x, types: x.types.filter((v) => v !== id) }),
  }));
  (f.baux || []).forEach((id) => chips.push({
    key: `bail-${id}`, label: leaseTypeLabel(id, true) || id, remove: (x) => ({ ...x, baux: x.baux.filter((v) => v !== id) }),
  }));
  if (f.region) chips.push({ key: 'region', label: f.region, remove: (x) => ({ ...x, region: '', departement: '' }) });
  if (f.departement) chips.push({ key: 'departement', label: departementLabel(f.departement) || `Département ${f.departement}`, remove: (x) => ({ ...x, departement: '' }) });
  if (f.prixMax) chips.push({ key: 'prix_max', label: `Prix ≤ ${formatEurosShort(f.prixMax)}`, remove: (x) => ({ ...x, prixMax: '' }) });
  if (f.rendementMin) chips.push({ key: 'rendement_min', label: `Rendement brut ≥ ${formatYieldShort(f.rendementMin)}`, remove: (x) => ({ ...x, rendementMin: '' }) });
  if (f.surfaceMin) chips.push({ key: 'surface_min', label: `Surface ≥ ${f.surfaceMin}\u00a0m²`, remove: (x) => ({ ...x, surfaceMin: '' }) });
  return chips;
};
