// Page des annonces (/) et module intégrable (/embed/annonces) — MODE-TEST-ET-APP.md §A.3 et §A.5 :
// filtres ↔ URL ↔ paramètres d'API, anciens paramètres traduits, état vide sans « 0 », compteur seulement à partir de 3,
// pagination, panneau de filtres mobile, favoris, JSON-LD ItemList, hauteur envoyée à la page parente,
// correspondances des anciennes pages (identiques aux 301 de frontend/nginx.conf).
// Exécution : cd frontend && CI=true npx craco test --watchAll=false src/pages/__tests__/listingsPage.test.jsx
import '@/components/shared/jestEnv';
import fs from 'fs';
import path from 'path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation, useNavigationType } from 'react-router-dom';
import axios from 'axios';

jest.mock('axios');
jest.mock('@/App', () => ({ axiosInstance: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() }, API: '/api' }));
jest.mock('@/lib/analytics', () => ({ trackEvent: jest.fn(), trackPageView: jest.fn(), initAnalytics: jest.fn() }));

import { axiosInstance } from '@/App';
import { trackEvent } from '@/lib/analytics';
import {
  filtersFromParams, listingsQuery, listingsPath, canonicalSearch, apiParams, legacyListingsPath,
  EMPTY_FILTERS,
} from '@/components/shared/listingFilters';
import { RGE_TYPES, slugify } from '@/lib/referentiels';
import ListingsPage, { pageItems, searchHeading, showResultsLabel } from '@/pages/ListingsPage';
import EmbedListingsPage, { embedLimit, embedTracking } from '@/pages/EmbedListingsPage';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView = jest.fn();

const mounted = [];
const flush = async () => { await act(async () => { await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); }); };

// Affiche l'adresse courante (chemin + requête) pour vérifier les filtres écrits dans l'URL
const LocationProbe = () => {
  const { pathname, search } = useLocation();
  // Type de la dernière navigation (PUSH : nouvelle entrée d'historique ; REPLACE : adresse remplacée)
  const type = useNavigationType();
  return <output data-testid="location" data-nav={type}>{`${pathname}${search}`}</output>;
};

const render = async (ui, entry = '/', routePath = '/') => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path={routePath} element={ui} />
          <Route path="/register" element={<p data-testid="page-register">inscription</p>} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>,
    );
  });
  await flush();
  await flush();
  mounted.push({ root, container });
  return container;
};
const where = (c) => c.querySelector('[data-testid="location"]').textContent;
const navType = (c) => c.querySelector('[data-testid="location"]').getAttribute('data-nav');
const wait = async (ms) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); await flush(); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); }); await flush(); await flush(); };
const change = async (el, value) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await flush();
  await flush();
};
const companiesCalls = () => axios.get.mock.calls.filter(([url]) => String(url).endsWith('/api/companies'));
const lastParams = () => companiesCalls().slice(-1)[0][1].params;

const listing = (id, extra = {}) => ({
  id, title: `Entreprise ${id}`, trades: ['pac-clim-cvc'], region: 'Bretagne', department: '29', staff_count: 6, ca_n: 780000,
  asking_price: 290000, published_at: '2026-10-01T10:00:00Z', is_rge: true, company_checks: { in_ademe_list: true }, ...extra,
});

const mockCompanies = (list = [], total) => {
  axios.get.mockImplementation((url) => (String(url).endsWith('/api/companies')
    ? Promise.resolve({ data: list, headers: { 'x-total-count': String(total ?? list.length) } })
    : Promise.resolve({ data: {} })));
};

beforeEach(() => {
  document.head.innerHTML = '';
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({}) }));
  axiosInstance.get.mockResolvedValue({ data: { favorites: [] } });
  axiosInstance.post.mockResolvedValue({ data: { favorited: true } });
  axiosInstance.delete.mockResolvedValue({ data: {} });
  mockCompanies([]);
});
afterEach(() => {
  mounted.splice(0).forEach(({ root, container }) => { act(() => root.unmount()); container.remove(); });
  jest.clearAllMocks();
  document.body.style.overflow = '';
});

const NO_ZERO = /(^|[^\d\u202f\u00a0 ])0 (annonce|entreprise|résultat)/;

// ------------------------------------------------------------------------------------------------
describe('filtres ↔ URL ↔ API', () => {
  const SPEC_URL = 'metier=pac-clim-cvc,isolation&region=bretagne&departement=29&rge=1&prix_max=500000&ca_min=300000&effectif_min=5&tri=prix_asc&page=2';

  test('URL de la spécification lue puis réécrite à l\'identique (liens WordPress)', () => {
    const f = filtersFromParams(new URLSearchParams(SPEC_URL));
    expect(f).toEqual({
      trades: ['pac-clim-cvc', 'isolation'], region: 'Bretagne', departement: '29', rge: '1', prixMax: '500000',
      caMin: '300000', effectifMin: '5', tri: 'prix_asc', page: 2,
    });
    expect(listingsQuery(f)).toBe(SPEC_URL);
    expect(listingsPath({ trades: ['isolation'], region: 'Pays de la Loire' })).toBe('/?metier=isolation&region=pays-de-la-loire');
    expect(listingsPath({})).toBe('/');
    expect(canonicalSearch(`?${SPEC_URL}`)).toBeNull();
  });

  test('paramètres d\'API (API.md §2) : trades, region, department, rge, max_price, sort, limit, page', () => {
    const f = filtersFromParams(new URLSearchParams(SPEC_URL));
    expect(apiParams(f, { page: 2 })).toEqual({
      trades: 'pac-clim-cvc,isolation', region: 'Bretagne', department: '29', rge: 'true', max_price: 500000,
      min_ca: 300000, min_staff: 5, sort: 'price_asc', limit: 24, page: 2,
    });
    expect(apiParams({ ...EMPTY_FILTERS, rge: '0' })).toEqual({ rge: 'false', sort: 'recent', limit: 24, page: 1 });
  });

  test('valeurs invalides ignorées : métier inconnu, département hors région, prix non numérique', () => {
    const f = filtersFromParams(new URLSearchParams('metier=inconnu,isolation&region=corse&departement=29&prix_max=abc&tri=n-importe&page=-3'));
    expect(f).toMatchObject({ trades: ['isolation'], region: 'Corse', departement: '', prixMax: '', tri: 'recent', page: 1 });
    // Département seul : la région est déduite
    expect(filtersFromParams(new URLSearchParams('departement=2a'))).toMatchObject({ departement: '2A', region: 'Corse' });
  });

  test('anciens paramètres traduits, paramètres étrangers (utm) conservés', () => {
    expect(canonicalSearch('?metiers=isolation,menuiserie&region=Bretagne&max_price=300000&sort=price_desc&utm_source=wp'))
      .toBe('metier=isolation,menuiserie&region=bretagne&prix_max=300000&tri=prix_desc&utm_source=wp');
    expect(canonicalSearch('?rge_type=Pompes%20%C3%A0%20chaleur%20air%2Feau&department=29'))
      .toBe('metier=pac-clim-cvc&region=bretagne&departement=29&rge=1');
    expect(canonicalSearch('?q=plombier%20finistere')).toBe('metier=plomberie-chauffage&region=bretagne&departement=29');
    expect(canonicalSearch('?region=Pays%20de%20la%20Loire')).toBe('region=pays-de-la-loire');
    expect(canonicalSearch('?tri=price_asc')).toBe('tri=prix_asc');
    expect(canonicalSearch('')).toBeNull();
  });

  test('pagination : 1 … p-1 p p+1 … n', () => {
    expect(pageItems(1, 1)).toEqual([1]);
    expect(pageItems(1, 3)).toEqual([1, 2, 3]);
    expect(pageItems(5, 10)).toEqual([1, 'gap-4', 4, 5, 6, 'gap-10', 10]);
  });
});

// ------------------------------------------------------------------------------------------------
describe('anciennes pages → page des annonces (mêmes correspondances que nginx)', () => {
  test('hubs bâtiment et RGE', () => {
    expect(legacyListingsPath('metier', 'isolation')).toBe('/?metier=isolation');
    expect(legacyListingsPath('metier', 'inconnu')).toBe('/');
    expect(legacyListingsPath('region', 'provence-alpes-cote-d-azur')).toBe('/?region=provence-alpes-cote-d-azur');
    expect(legacyListingsPath('rge')).toBe('/?rge=1');
    expect(legacyListingsPath('rge-region', 'corse')).toBe('/?region=corse&rge=1');
    expect(legacyListingsPath('rge-activite', 'pompes-a-chaleur-air-eau')).toBe('/?metier=pac-clim-cvc&rge=1');
    expect(legacyListingsPath('rge-activite', 'inconnue')).toBe('/?rge=1');
  });

  test('carte nginx des activités RGE identique à legacyListingsPath', () => {
    const conf = fs.readFileSync(path.resolve(__dirname, '../../../nginx.conf'), 'utf8');
    const block = /map \$rge_activity \$legacy_rge_target \{([\s\S]*?)\n\}/.exec(conf)[1];
    const entries = Object.fromEntries([...block.matchAll(/^\s+([a-z0-9-]+) "([^"]+)";$/gm)].map((m) => [m[1], m[2]]).filter(([k]) => k !== 'default'));
    expect(Object.keys(entries).sort()).toEqual(RGE_TYPES.map((t) => slugify(t.value)).sort());
    Object.entries(entries).forEach(([slug, target]) => {
      const expected = new URLSearchParams(legacyListingsPath('rge-activite', slug).split('?')[1]);
      const actual = new URLSearchParams(target.split('?')[1]);
      expect(Object.fromEntries(actual)).toEqual(Object.fromEntries(expected));
    });
    expect(conf).toMatch(/location \^~ \/embed\/ \{[\s\S]*frame-ancestors 'self' \$\{EMBED_ALLOWED_ORIGINS\}/);
  });
});

// ------------------------------------------------------------------------------------------------
describe('page des annonces', () => {
  test('filtres de l\'URL → GET /companies sans jeton, cartes, compteur, puces, pagination, JSON-LD ItemList', async () => {
    mockCompanies([listing('c1'), listing('c2')], 30);
    const c = await render(<ListingsPage user={null} />, '/?metier=pac-clim-cvc,isolation&region=bretagne&departement=29&rge=1&prix_max=500000&tri=prix_desc');
    const [url, cfg] = companiesCalls()[0];
    expect(url).toMatch(/\/api\/companies$/);
    expect(cfg.headers).toBeUndefined();
    expect(cfg.params).toEqual({ trades: 'pac-clim-cvc,isolation', region: 'Bretagne', department: '29', rge: 'true', max_price: 500000, sort: 'price_desc', limit: 24, page: 1 });
    expect(c.querySelector('h1').textContent).toBe('Entreprises du bâtiment à vendre');
    expect(c.querySelectorAll('[data-testid="listing-card"]')).toHaveLength(2);
    expect(c.querySelector('[data-testid="results-count"]').textContent).toBe('30 annonces');
    expect(c.querySelector('#filtres-metier-isolation').checked).toBe(true);
    expect(c.querySelector('[data-testid="filter-region"]').value).toBe('Bretagne');
    expect(c.querySelector('[data-testid="filter-departement"]').value).toBe('29');
    expect(c.querySelector('[data-testid="mobile-filters-btn"]').textContent).toContain('Filtres (6)');
    expect(Array.from(c.querySelectorAll('[data-testid="active-filters"] button')).map((b) => b.textContent)).toEqual(
      expect.arrayContaining(['PAC, climatisation', 'Isolation', 'Bretagne', 'RGE', 'Effacer les filtres']),
    );
    const pages = Array.from(c.querySelectorAll('[data-testid="pagination"] a')).map((a) => a.getAttribute('href'));
    expect(pages).toContain('/?metier=pac-clim-cvc,isolation&region=bretagne&departement=29&rge=1&prix_max=500000&tri=prix_desc&page=2');
    const ld = Array.from(document.head.querySelectorAll('script[type="application/ld+json"]')).map((s) => JSON.parse(s.textContent));
    const list = ld.find((o) => o['@type'] === 'ItemList');
    expect(list.itemListElement.map((i) => i.url)).toEqual([expect.stringMatching(/\/company\/c1$/), expect.stringMatching(/\/company\/c2$/)]);
    expect(ld.find((o) => o['@type'] === 'Organization')).toBeTruthy();
    expect(document.head.querySelector('link[rel="canonical"]').getAttribute('href')).toMatch(/\/$/);
    expect(c.textContent).not.toMatch(NO_ZERO);
  });

  test('modifier un filtre met l\'URL à jour (page 1) et relance la recherche', async () => {
    mockCompanies([listing('c1')], 1);
    const c = await render(<ListingsPage user={null} />, '/?region=bretagne&page=3');
    await click(c.querySelector('#filtres-metier-electricite'));
    expect(where(c)).toBe('/?metier=electricite&region=bretagne');
    expect(lastParams()).toMatchObject({ trades: 'electricite', region: 'Bretagne', page: 1 });
    await change(c.querySelector('[data-testid="sort-select"]'), 'prix_asc');
    expect(where(c)).toBe('/?metier=electricite&region=bretagne&tri=prix_asc');
    expect(lastParams().sort).toBe('price_asc');
    await click(c.querySelector('#filtres-rge-1'));
    expect(where(c)).toContain('rge=1');
    // Retrait d'une puce
    const chip = Array.from(c.querySelectorAll('[data-testid="active-filters"] button')).find((b) => b.textContent === 'Bretagne');
    await click(chip);
    expect(where(c)).toBe('/?metier=electricite&rge=1&tri=prix_asc');
  });

  test('aucun résultat : jamais « 0 », titre de l\'état vide, « Effacer les filtres », alerte préremplie', async () => {
    mockCompanies([], 0);
    const c = await render(<ListingsPage user={null} />, '/?metier=isolation&region=corse&prix_max=300000');
    const empty = c.querySelector('[data-testid="listings-empty"]');
    expect(empty.querySelector('h2').textContent).toBe('Aucune annonce ne correspond pour l\'instant');
    expect(c.querySelector('[data-testid="results-count"]').textContent).toBe('');
    expect(c.querySelector('[data-testid="listings-total"]')).toBeNull();
    expect(c.querySelector('[data-testid="alert-form"] input[name="trades"][value="isolation"]').checked).toBe(true);
    expect(c.querySelector('[data-testid="alert-form"] input[name="regions"][value="Corse"]').checked).toBe(true);
    expect(c.querySelector('[data-testid="alert-form"] select[name="max_price"]').value).toBe('300000');
    expect(c.textContent).not.toMatch(NO_ZERO);
    expect(c.querySelector('[data-testid="pagination"]')).toBeNull();
    await click(c.querySelector('[data-testid="empty-reset"]'));
    expect(where(c)).toBe('/');
  });

  test('sans filtre : nombre d\'annonces affiché seulement à partir de 3', async () => {
    mockCompanies([listing('c1'), listing('c2')], 2);
    const few = await render(<ListingsPage user={null} />);
    expect(few.querySelector('[data-testid="listings-total"]')).toBeNull();
    expect(few.querySelector('[data-testid="results-count"]').textContent).toBe('');
    expect(few.querySelector('[data-testid="listings-empty"]')).toBeNull();
    expect(few.querySelector('[data-testid="empty-reset"]')).toBeNull();
    mockCompanies([listing('c1'), listing('c2'), listing('c3')], 3);
    const many = await render(<ListingsPage user={null} />);
    expect(many.querySelector('[data-testid="listings-total"]').textContent).toBe('3 annonces en ligne');
  });

  test('anciens paramètres : URL canonique sans entrée d\'historique, une seule recherche', async () => {
    mockCompanies([listing('c1')], 1);
    const c = await render(<ListingsPage user={null} />, '/?metiers=isolation&region=Bretagne&max_price=300000&utm_source=wp');
    expect(where(c)).toBe('/?metier=isolation&region=bretagne&prix_max=300000&utm_source=wp');
    expect(companiesCalls()).toHaveLength(1);
    expect(lastParams()).toMatchObject({ trades: 'isolation', region: 'Bretagne', max_price: 300000 });
  });

  test('chiffre d\'affaires et effectif minimum : filtrés par le serveur (min_ca, min_staff), une seule requête', async () => {
    mockCompanies([listing('a', { ca_n: 1200000, staff_count: 12 })], 1);
    const c = await render(<ListingsPage user={null} />, '/?ca_min=1000000&effectif_min=10');
    expect(companiesCalls()).toHaveLength(1);
    expect(lastParams()).toMatchObject({ min_ca: 1000000, min_staff: 10, limit: 24, page: 1 });
    expect(Array.from(c.querySelectorAll('[data-testid="listing-card-link"]')).map((a) => a.getAttribute('href'))).toEqual(['/company/a']);
    expect(c.querySelector('[data-testid="results-count"]').textContent).toBe('1 annonce');
  });

  test('erreur réseau : message et bouton « Réessayer »', async () => {
    axios.get.mockRejectedValue(new Error('réseau'));
    const c = await render(<ListingsPage user={null} />);
    expect(c.querySelector('[data-testid="listings-error"]').textContent).toContain('Réessayer');
    mockCompanies([listing('c1')], 1);
    await click(c.querySelector('[data-testid="listings-error"] button'));
    expect(c.querySelectorAll('[data-testid="listing-card"]')).toHaveLength(1);
  });

  test('mobile : bouton « Filtres (n) », panneau plein écran, application au clic', async () => {
    mockCompanies([listing('c1')], 1);
    const c = await render(<ListingsPage user={null} />, '/?region=bretagne');
    await click(c.querySelector('[data-testid="mobile-filters-btn"]'));
    const panel = c.querySelector('[data-testid="mobile-filters"]');
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.className).toContain('fixed inset-0');
    expect(document.body.style.overflow).toBe('hidden');
    await click(panel.querySelector('#mobile-metier-isolation'));
    expect(where(c)).toBe('/?region=bretagne');
    await click(panel.querySelector('[data-testid="mobile-filters-apply"]'));
    expect(c.querySelector('[data-testid="mobile-filters"]')).toBeNull();
    expect(where(c)).toBe('/?metier=isolation&region=bretagne');
    expect(document.body.style.overflow).toBe('');
  });

  test('favoris : visiteur → inscription repreneur ; repreneur → POST /favorites ; cédant : pas de cœur', async () => {
    mockCompanies([listing('c1')], 1);
    const visitor = await render(<ListingsPage user={null} />, '/?metier=isolation');
    await click(visitor.querySelector('[data-testid="favorite-toggle"]'));
    expect(where(visitor)).toBe(`/register?role=buyer&redirect=${encodeURIComponent('/?metier=isolation')}`);

    axiosInstance.get.mockResolvedValue({ data: { favorites: [{ company_id: 'c1' }] } });
    const buyer = await render(<ListingsPage user={{ id: 'b1', role: 'buyer' }} />);
    expect(axiosInstance.get).toHaveBeenCalledWith('/favorites', { skipAuthRedirect: true });
    const heart = buyer.querySelector('[data-testid="favorite-toggle"]');
    expect(heart.getAttribute('aria-pressed')).toBe('true');
    await click(heart);
    expect(axiosInstance.delete).toHaveBeenCalledWith('/favorites/c1');
    expect(heart.getAttribute('aria-pressed')).toBe('false');
    await click(heart);
    expect(axiosInstance.post).toHaveBeenCalledWith('/favorites', { company_id: 'c1' });

    const seller = await render(<ListingsPage user={{ id: 's1', role: 'seller' }} />);
    expect(seller.querySelector('[data-testid="favorite-toggle"]')).toBeNull();
    // Encart cédant : vers la création d'annonce pour un cédant connecté
    expect(seller.querySelector('[data-testid="seller-callout"] a').getAttribute('href')).toBe('/seller/create');
  });

  test('historique : un réglage de filtre ou de tri remplace l\'adresse, la validation du panneau mobile en ajoute une', async () => {
    mockCompanies([listing('c1')], 1);
    const c = await render(<ListingsPage user={null} />, '/?region=bretagne');
    await click(c.querySelector('#filtres-metier-electricite'));
    expect(navType(c)).toBe('REPLACE');
    await change(c.querySelector('[data-testid="sort-select"]'), 'prix_asc');
    expect(navType(c)).toBe('REPLACE');
    const chip = Array.from(c.querySelectorAll('[data-testid="active-filters"] button')).find((b) => b.textContent === 'Bretagne');
    await click(chip);
    expect(navType(c)).toBe('REPLACE');
    await click(c.querySelector('[data-testid="mobile-filters-btn"]'));
    await click(c.querySelector('#mobile-metier-isolation'));
    await click(c.querySelector('[data-testid="mobile-filters-apply"]'));
    expect(navType(c)).toBe('PUSH');
  });

  test('panneau mobile : le bouton annonce le nombre d\'annonces du brouillon (requête légère limit=1)', async () => {
    expect(showResultsLabel(null)).toBe('Afficher les annonces');
    expect(showResultsLabel(0)).toBe('Aucune annonce : créer une alerte');
    expect(showResultsLabel(1)).toBe('Afficher 1 annonce');
    expect(showResultsLabel(3)).toBe('Afficher 3 annonces');
    mockCompanies([listing('c1')], 3);
    const c = await render(<ListingsPage user={null} />, '/?region=bretagne');
    await click(c.querySelector('[data-testid="mobile-filters-btn"]'));
    await wait(350);
    expect(lastParams()).toMatchObject({ region: 'Bretagne', limit: 1 });
    expect(c.querySelector('[data-testid="mobile-filters-apply"]').textContent).toBe('Afficher 3 annonces');
    mockCompanies([], 0);
    await click(c.querySelector('#mobile-metier-isolation'));
    await wait(350);
    expect(lastParams()).toMatchObject({ trades: 'isolation', region: 'Bretagne', limit: 1 });
    expect(c.querySelector('[data-testid="mobile-filters-apply"]').textContent).toBe('Aucune annonce : créer une alerte');
    expect(c.querySelector('[data-testid="mobile-filters"]').textContent).not.toMatch(NO_ZERO);
  });

  test('lien filtré (un métier, une région) : H1, titre et adresse canonique de la recherche, nombre d\'annonces', async () => {
    expect(searchHeading({ trades: ['pac-clim-cvc'], region: 'Bretagne' })).toBe('Entreprises de PAC, climatisation à vendre en Bretagne');
    expect(searchHeading({ trades: ['isolation'], region: '' })).toBe('Entreprises d\'isolation à vendre');
    expect(searchHeading({ trades: [], region: 'Pays de la Loire' })).toBe('Entreprises du bâtiment à vendre dans les Pays de la Loire');
    expect(searchHeading({ trades: ['isolation', 'electricite'], region: 'Bretagne' })).toBeNull();
    expect(searchHeading({ trades: [], region: '' })).toBeNull();
    mockCompanies([listing('c1'), listing('c2'), listing('c3')], 3);
    const c = await render(<ListingsPage user={null} />, '/?metier=pac-clim-cvc&region=bretagne&prix_max=500000');
    expect(c.querySelector('h1').textContent).toBe('Entreprises de PAC, climatisation à vendre en Bretagne');
    expect(document.title).toMatch(/^Entreprises de PAC, climatisation à vendre en Bretagne \| /);
    expect(document.head.querySelector('link[rel="canonical"]').getAttribute('href')).toMatch(/\/\?metier=pac-clim-cvc&region=bretagne$/);
    expect(c.querySelector('[data-testid="listings-search-total"]').textContent).toBe('3 annonces');
  });

  test('JSON-LD ItemList : jamais d\'annonce de test', async () => {
    mockCompanies([listing('reelle'), listing('fictive', { is_test: true })], 2);
    await render(<ListingsPage user={null} />);
    const ld = Array.from(document.head.querySelectorAll('script[type="application/ld+json"]')).map((x) => JSON.parse(x.textContent));
    const list = ld.find((o) => o['@type'] === 'ItemList');
    expect(list.itemListElement.map((i) => i.url)).toEqual([expect.stringMatching(/\/company\/reelle$/)]);
  });

  test('repreneur connecté : pas d\'encart « Vous vendez ? »', async () => {
    mockCompanies([listing('c1')], 1);
    const c = await render(<ListingsPage user={{ id: 'b1', role: 'buyer' }} />);
    expect(c.querySelector('[data-testid="seller-callout"]')).toBeNull();
  });

  test('encart cédant pour un visiteur : inscription cédant, événement hero_cta_seller', async () => {
    mockCompanies([listing('c1')], 1);
    const c = await render(<ListingsPage user={null} />);
    const link = c.querySelector('[data-testid="seller-callout"] a');
    expect(link.getAttribute('href')).toBe('/register?role=seller');
    expect(link.textContent).toContain('Déposez une annonce anonyme');
    await click(link);
    expect(trackEvent).toHaveBeenCalledWith('hero_cta_seller', { cta: 'listings_callout' });
  });
});

// ------------------------------------------------------------------------------------------------
describe('module intégrable /embed/annonces', () => {
  test('limite 1 à 24 (6 par défaut)', () => {
    expect(embedLimit(null)).toBe(6);
    expect(embedLimit('3')).toBe(3);
    expect(embedLimit('0')).toBe(1);
    expect(embedLimit('100')).toBe(24);
    expect(embedLimit('abc')).toBe(6);
  });

  test('mêmes filtres, liens dans l\'onglet parent, hauteur envoyée à la page parente, noindex, sans en-tête', async () => {
    const postMessage = jest.fn();
    const parentDescriptor = Object.getOwnPropertyDescriptor(window, 'parent');
    Object.defineProperty(window, 'parent', { configurable: true, get: () => ({ postMessage }) });
    try {
      mockCompanies([listing('c1'), listing('c2'), listing('c3')], 9);
      const c = await render(<EmbedListingsPage />, '/embed/annonces?metier=isolation&rge=1&limit=3', '/embed/annonces');
      expect(lastParams()).toEqual({ trades: 'isolation', rge: 'true', sort: 'recent', limit: 3, page: 1 });
      expect(c.querySelectorAll('[data-testid="listing-card"]')).toHaveLength(3);
      expect(Array.from(c.querySelectorAll('[data-testid="listing-card-link"]')).every((a) => a.getAttribute('target') === '_top')).toBe(true);
      const all = c.querySelector('[data-testid="embed-all"]');
      // Liens marqués : visites venues du site WordPress attribuables (utm), campagne reprise de ?campagne=
      expect(all.getAttribute('href')).toBe('/?metier=isolation&rge=1&utm_source=wordpress&utm_medium=embed');
      expect(c.querySelector('[data-testid="listing-card-link"]').getAttribute('href')).toBe('/company/c1?utm_source=wordpress&utm_medium=embed');
      expect(all.getAttribute('target')).toBe('_top');
      expect(c.querySelector('[data-testid="app-header"]')).toBeNull();
      expect(c.querySelector('[data-testid="app-footer"]')).toBeNull();
      expect(postMessage).toHaveBeenCalledWith({ type: 'cession-embed-height', height: expect.any(Number) }, '*');
      expect(document.head.querySelector('meta[name="robots"]').getAttribute('content')).toBe('noindex, nofollow');
    } finally {
      if (parentDescriptor) Object.defineProperty(window, 'parent', parentDescriptor);
    }
  });

  test('aucune annonce : phrase sans « 0 » et lien vers toutes les annonces', async () => {
    mockCompanies([], 0);
    const c = await render(<EmbedListingsPage />, '/embed/annonces?region=corse', '/embed/annonces');
    expect(c.querySelector('[data-testid="embed-empty"]').textContent).toBe('Aucune annonce ne correspond pour l\'instant.');
    expect(c.textContent).not.toMatch(NO_ZERO);
    expect(c.querySelector('[data-testid="embed-all"]').getAttribute('href')).toBe('/?region=corse&utm_source=wordpress&utm_medium=embed');
  });

  test('marqueurs de campagne : utm_source, utm_medium, utm_campaign repris de ?campagne=', async () => {
    expect(embedTracking('')).toBe('utm_source=wordpress&utm_medium=embed');
    expect(embedTracking('campagne=page-pac')).toBe('utm_source=wordpress&utm_medium=embed&utm_campaign=page-pac');
    mockCompanies([listing('c1')], 1);
    const c = await render(<EmbedListingsPage />, '/embed/annonces?campagne=accueil', '/embed/annonces');
    expect(c.querySelector('[data-testid="embed-all"]').getAttribute('href')).toBe('/?utm_source=wordpress&utm_medium=embed&utm_campaign=accueil');
  });
});
