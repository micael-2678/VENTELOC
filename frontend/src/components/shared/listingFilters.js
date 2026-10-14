// Filtres de la page des annonces (/) et du module intégrable (/embed/annonces), docs/refonte-2026-10/MODE-TEST-ET-APP.md §A.3.
//
// Paramètres d'URL (partageables, utilisables depuis le site WordPress) :
//   metier=pac-clim-cvc,isolation · region=bretagne · departement=29 · rge=1|0 · prix_max=500000
//   ca_min=300000 · effectif_min=5 · tri=recent|prix_asc|prix_desc · page=2
// Anciens paramètres encore acceptés (liens de l'ancienne recherche, des hubs et des e-mails) :
//   metiers, rge_type, max_price, department, sort, q, region en toutes lettres (« Bretagne »).
//
// Paramètres d'API (GET /companies, API.md §2) : trades, region, department, rge, max_price, min_ca, min_staff, sort,
// limit, page. Tous les critères sont filtrés par le serveur : X-Total-Count est exact.
import axios from 'axios';
import {
  TRADES, REGIONS, RGE_TYPES, slugify, tradeBySlug, tradeForRge, regionBySlug, normalizeDepartement, regionForDepartement,
  parseSearchQuery,
} from '@/lib/referentiels';
import { readableSpaces } from '@/components/shared/formatters';

const BACKEND_URL = String(process.env.REACT_APP_BACKEND_URL || '').replace(/\/+$/, '');
export const COMPANIES_URL = `${BACKEND_URL}/api/companies`;

export const LISTINGS_PATH = '/';
export const PAGE_SIZE = 24;

export const SORTS = [
  { value: 'recent', api: 'recent', label: 'Plus récentes' },
  { value: 'prix_asc', api: 'price_asc', label: 'Prix croissant' },
  { value: 'prix_desc', api: 'price_desc', label: 'Prix décroissant' },
];

export const PRICE_MAX_OPTIONS = [100000, 200000, 300000, 500000, 750000, 1000000, 1500000, 2000000, 3000000];
export const CA_MIN_OPTIONS = [100000, 250000, 500000, 750000, 1000000, 2000000, 5000000];
export const EFFECTIF_MIN_OPTIONS = [1, 3, 5, 10, 20, 50];

export const EMPTY_FILTERS = Object.freeze({
  trades: [], region: '', departement: '', rge: '', prixMax: '', caMin: '', effectifMin: '', tri: 'recent', page: 1,
});

// Clés d'URL lues par la page : tout autre paramètre (utm_source…) est conservé tel quel
const FILTER_KEYS = ['metier', 'region', 'departement', 'rge', 'prix_max', 'ca_min', 'effectif_min', 'tri', 'page'];
const LEGACY_KEYS = ['metiers', 'rge_type', 'max_price', 'department', 'sort', 'q', 'prix_min', 'min_price'];

const positiveInt = (value) => {
  const n = parseInt(String(value || '').replace(/\s/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? String(n) : '';
};

// « bretagne », « Bretagne », « Pays de la Loire » → nom canonique (valeur stockée) ; '' si inconnu
export const regionFromParam = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (REGIONS.includes(raw)) return raw;
  return regionBySlug(slugify(raw)) || '';
};

export const regionSlug = (region) => (region ? slugify(region) : '');

const tradesFromList = (value) => String(value || '')
  .split(',')
  .map((s) => tradeBySlug(s.trim()))
  .filter(Boolean)
  .map((t) => t.id)
  .filter((id, i, all) => all.indexOf(id) === i);

const rgeFromParam = (value) => {
  const v = String(value || '').trim().toLowerCase();
  if (['1', 'true', 'oui'].includes(v)) return '1';
  if (['0', 'false', 'non'].includes(v)) return '0';
  return '';
};

const sortFromParam = (value) => {
  const v = String(value || '').trim();
  if (v === 'price_asc') return 'prix_asc';
  if (v === 'price_desc') return 'prix_desc';
  return SORTS.some((s) => s.value === v) ? v : 'recent';
};

// URLSearchParams → filtres (paramètres actuels et anciens)
export const filtersFromParams = (params) => {
  const p = params instanceof URLSearchParams ? params : new URLSearchParams(params || '');
  const fromQuery = p.get('q') ? parseSearchQuery(p.get('q')) : null;
  let trades = tradesFromList(p.get('metier') || p.get('metiers'));
  const legacyRge = p.get('rge_type');
  if (!trades.length && legacyRge && tradeForRge(legacyRge)) trades = [tradeForRge(legacyRge)];
  if (!trades.length && fromQuery) trades = fromQuery.trades.slice(0, 4);
  const departement = normalizeDepartement(p.get('departement') || p.get('department') || (fromQuery ? fromQuery.department : ''));
  const region = regionFromParam(p.get('region')) || (fromQuery ? fromQuery.region : '') || (departement ? regionForDepartement(departement) : '');
  let rge = rgeFromParam(p.get('rge'));
  if (!rge && (legacyRge || (fromQuery && fromQuery.rgeTypes.length))) rge = '1';
  return {
    trades,
    region,
    // Un département hors de la région choisie est ignoré
    departement: departement && (!region || regionForDepartement(departement) === region) ? departement : '',
    rge,
    prixMax: positiveInt(p.get('prix_max') || p.get('max_price')),
    caMin: positiveInt(p.get('ca_min')),
    effectifMin: positiveInt(p.get('effectif_min')),
    tri: sortFromParam(p.get('tri') || p.get('sort')),
    page: Math.max(1, parseInt(p.get('page') || '1', 10) || 1),
  };
};

// Filtres → chaîne de requête canonique, sans « ? » (virgules lisibles dans metier=…)
export const listingsQuery = (filters) => {
  const f = { ...EMPTY_FILTERS, ...(filters || {}) };
  const parts = [];
  const add = (key, value) => { if (value) parts.push(`${key}=${encodeURIComponent(String(value))}`); };
  if (f.trades.length) parts.push(`metier=${f.trades.map(encodeURIComponent).join(',')}`);
  add('region', regionSlug(f.region));
  add('departement', f.departement);
  add('rge', f.rge);
  add('prix_max', f.prixMax);
  add('ca_min', f.caMin);
  add('effectif_min', f.effectifMin);
  if (f.tri && f.tri !== 'recent') add('tri', f.tri);
  if (f.page > 1) add('page', f.page);
  return parts.join('&');
};

// Lien vers la page des annonces : listingsPath({ trades: ['isolation'], region: 'Bretagne' }) → « /?metier=isolation&region=bretagne »
export const listingsPath = (filters, base = LISTINGS_PATH) => {
  const q = listingsQuery(filters);
  return q ? `${base}?${q}` : base;
};

// Anciens paramètres présents → chaîne canonique (paramètres étrangers conservés), sinon null
export const canonicalSearch = (search) => {
  const params = new URLSearchParams(search || '');
  const region = params.get('region');
  const regionIsName = Boolean(region) && regionSlug(regionFromParam(region)) !== region;
  const legacySort = ['price_asc', 'price_desc'].includes(params.get('tri') || '');
  if (!LEGACY_KEYS.some((k) => params.has(k)) && !regionIsName && !legacySort) return null;
  const others = [];
  params.forEach((value, key) => {
    if (!FILTER_KEYS.includes(key) && !LEGACY_KEYS.includes(key)) others.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  });
  return [listingsQuery(filtersFromParams(params)), ...others].filter(Boolean).join('&');
};

// Nombre de critères actifs (bouton « Filtres (n) »)
export const activeFilterCount = (f) => (f.trades || []).length
  + [f.region, f.departement, f.rge, f.prixMax, f.caMin, f.effectifMin].filter(Boolean).length;

export const hasActiveFilters = (f) => activeFilterCount(f) > 0;

// Filtres → paramètres de GET /companies
export const apiParams = (f, { page = 1, limit = PAGE_SIZE } = {}) => {
  const sort = SORTS.find((s) => s.value === f.tri) || SORTS[0];
  return {
    ...(f.trades.length ? { trades: f.trades.join(',') } : {}),
    ...(f.region ? { region: f.region } : {}),
    ...(f.departement ? { department: f.departement } : {}),
    ...(f.rge === '1' ? { rge: 'true' } : f.rge === '0' ? { rge: 'false' } : {}),
    ...(f.prixMax ? { max_price: Number(f.prixMax) } : {}),
    ...(f.caMin ? { min_ca: Number(f.caMin) } : {}),
    ...(f.effectifMin ? { min_staff: Number(f.effectifMin) } : {}),
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
// Requête sans jeton (axios nu) : un cédant connecté voit les annonces publiques, pas les siennes (API.md §2).
export const fetchListings = async (f, { page = 1, limit = PAGE_SIZE, signal } = {}) => {
  const res = await axios.get(COMPANIES_URL, { params: apiParams(f, { page, limit }), signal });
  const items = listFrom(res);
  return { items, total: totalFrom(res, items.length + (page - 1) * limit) };
};

// Libellés des critères actifs (puces supprimables au-dessus des résultats)
const NUMBER = new Intl.NumberFormat('fr-FR');
export const formatEurosShort = (n) => `${readableSpaces(NUMBER.format(Number(n)))}\u00a0€`;

export const filterChips = (f) => {
  const chips = (f.trades || []).map((id) => {
    const t = TRADES.find((x) => x.id === id);
    return { key: `metier-${id}`, label: t ? t.short : id, remove: (x) => ({ ...x, trades: x.trades.filter((v) => v !== id) }) };
  });
  if (f.region) chips.push({ key: 'region', label: f.region, remove: (x) => ({ ...x, region: '', departement: '' }) });
  if (f.departement) chips.push({ key: 'departement', label: `Département ${f.departement}`, remove: (x) => ({ ...x, departement: '' }) });
  if (f.rge === '1') chips.push({ key: 'rge', label: 'RGE', remove: (x) => ({ ...x, rge: '' }) });
  if (f.rge === '0') chips.push({ key: 'rge', label: 'Sans RGE', remove: (x) => ({ ...x, rge: '' }) });
  if (f.prixMax) chips.push({ key: 'prix_max', label: `Prix ≤ ${formatEurosShort(f.prixMax)}`, remove: (x) => ({ ...x, prixMax: '' }) });
  if (f.caMin) chips.push({ key: 'ca_min', label: `CA ≥ ${formatEurosShort(f.caMin)}`, remove: (x) => ({ ...x, caMin: '' }) });
  if (f.effectifMin) chips.push({ key: 'effectif_min', label: `${f.effectifMin} salarié${Number(f.effectifMin) > 1 ? 's' : ''} ou plus`, remove: (x) => ({ ...x, effectifMin: '' }) });
  return chips;
};

// Anciennes pages d'atterrissage (hubs bâtiment et RGE) → page des annonces filtrée. Mêmes correspondances que les
// redirections 301 de frontend/nginx.conf (le test src/pages/__tests__/listingsPage.test.jsx vérifie la carte nginx).
//   metier/:slug → ?metier= · region/:slug → ?region= · rge → ?rge=1 · rge-region/:slug → ?rge=1&region=
//   rge-activite/:slug (domaine RGE) → ?rge=1&metier=<métier correspondant>
export const legacyListingsPath = (kind, slug = '') => {
  const region = regionFromParam(slug);
  if (kind === 'metier') {
    const trade = tradeBySlug(slug);
    return listingsPath(trade ? { trades: [trade.id] } : {});
  }
  if (kind === 'region') return listingsPath(region ? { region } : {});
  if (kind === 'rge') return listingsPath({ rge: '1' });
  if (kind === 'rge-region') return listingsPath({ rge: '1', ...(region ? { region } : {}) });
  if (kind === 'rge-activite') {
    const type = RGE_TYPES.find((t) => slugify(t.value) === slugify(slug));
    const trade = type ? tradeForRge(type.value) : null;
    return listingsPath({ rge: '1', ...(trade ? { trades: [trade] } : {}) });
  }
  return LISTINGS_PATH;
};
