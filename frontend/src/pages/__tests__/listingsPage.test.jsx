// Page des annonces (/) et module intégrable (/embed/annonces) — docs/venteloc/SPEC.md §5.1, API.md §2 et §10 :
// filtres (type, bail, région, département, prix max, rendement min, surface min, tri) ↔ URL ↔ paramètres d'API,
// état vide sans « 0 », compteur seulement à partir de 3, « Comment ça marche », pagination, panneau de filtres
// mobile, favoris, cartes (rendement brut mis en avant), JSON-LD ItemList, hauteur envoyée à la page parente.
// Exécution : cd frontend && CI=true npx craco test --watchAll=false src/pages/__tests__/listingsPage.test.jsx
import '@/components/shared/jestEnv';
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
  filtersFromParams, listingsQuery, listingsPath, canonicalSearch, apiParams, filterChips, EMPTY_FILTERS,
} from '@/components/shared/listingFilters';
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
const propertiesCalls = () => axios.get.mock.calls.filter(([url]) => String(url).endsWith('/api/properties'));
const lastParams = () => propertiesCalls().slice(-1)[0][1].params;

const listing = (id, extra = {}) => ({
  id, title: `Appartement T2 loué · 42 m² · Lyon (69)`, property_type: 'appartement', lease_type: 'habitation-vide', city: 'Lyon',
  department: '69', region: 'Auvergne-Rhône-Alpes', surface: 42, rooms: 2, rent_monthly: 620, asking_price: 145000, gross_yield: 5.13,
  net_yield: 4.2, dpe_class: 'D', published_at: '2026-10-01T10:00:00Z', ownership: { status: 'verified' }, tenant_since: '2019-03-01', ...extra,
});
const mockProperties = (list = [], total) => {
  axios.get.mockImplementation((url) => (String(url).endsWith('/api/properties')
    ? Promise.resolve({ data: list, headers: { 'x-total-count': String(total ?? list.length) } })
    : Promise.resolve({ data: {} })));
};

beforeEach(() => {
  document.head.innerHTML = '';
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({}) }));
  axiosInstance.get.mockResolvedValue({ data: { favorites: [] } });
  axiosInstance.post.mockResolvedValue({ data: { favorited: true } });
  axiosInstance.delete.mockResolvedValue({ data: {} });
  mockProperties([]);
});
afterEach(() => {
  mounted.splice(0).forEach(({ root, container }) => { act(() => root.unmount()); container.remove(); });
  jest.clearAllMocks();
  document.body.style.overflow = '';
});

const NO_ZERO = /(^|[^\d\u202f\u00a0 ])0 (bien|annonce|résultat)/;

// ------------------------------------------------------------------------------------------------
describe('filtres ↔ URL ↔ API', () => {
  // URL de la spécification (SPEC §5.1), page 2
  const SPEC_URL = 'type=appartement,maison&bail=habitation-vide&region=auvergne-rhone-alpes&departement=69&prix_max=300000&rendement_min=5&surface_min=20&tri=rendement_desc&page=2';

  test('URL de la spécification lue puis réécrite à l\'identique (liens WordPress)', () => {
    const f = filtersFromParams(new URLSearchParams(SPEC_URL));
    expect(f).toEqual({
      types: ['appartement', 'maison'], baux: ['habitation-vide'], region: 'Auvergne-Rhône-Alpes', departement: '69', prixMax: '300000',
      rendementMin: '5', surfaceMin: '20', tri: 'rendement_desc', page: 2,
    });
    expect(listingsQuery(f)).toBe(SPEC_URL);
    expect(listingsPath({ types: ['parking'], region: 'Pays de la Loire' })).toBe('/?type=parking&region=pays-de-la-loire');
    expect(listingsPath({})).toBe('/');
    expect(canonicalSearch(`?${SPEC_URL}`)).toBeNull();
  });

  test('paramètres d\'API (API.md §2) : property_types, lease_types, region, department, max_price, min_yield, min_surface, sort', () => {
    const f = filtersFromParams(new URLSearchParams(SPEC_URL));
    expect(apiParams(f, { page: 2 })).toEqual({
      property_types: 'appartement,maison', lease_types: 'habitation-vide', region: 'Auvergne-Rhône-Alpes', department: '69', max_price: 300000,
      min_yield: 5, min_surface: 20, sort: 'yield_desc', limit: 24, page: 2,
    });
    expect(apiParams({ ...EMPTY_FILTERS })).toEqual({ sort: 'recent', limit: 24, page: 1 });
    expect(apiParams({ ...EMPTY_FILTERS, tri: 'prix_asc' }).sort).toBe('price_asc');
    expect(apiParams({ ...EMPTY_FILTERS, tri: 'prix_desc' }).sort).toBe('price_desc');
  });

  test('valeurs invalides ignorées : type inconnu, département hors région, rendement hors 0-20, prix non numérique', () => {
    const f = filtersFromParams(new URLSearchParams('type=chateau,maison&bail=inconnu&region=corse&departement=29&prix_max=abc&rendement_min=42&surface_min=-3&tri=n-importe&page=-3'));
    expect(f).toMatchObject({ types: ['maison'], baux: [], region: 'Corse', departement: '', prixMax: '', rendementMin: '', surfaceMin: '', tri: 'recent', page: 1 });
    // Département seul : la région est déduite ; rendement décimal accepté
    expect(filtersFromParams(new URLSearchParams('departement=2a&rendement_min=5,5'))).toMatchObject({ departement: '2A', region: 'Corse', rendementMin: '5.5' });
  });

  test('région en toutes lettres et tri au format de l\'API réécrits, paramètres étrangers (utm) conservés', () => {
    expect(canonicalSearch('?region=Pays%20de%20la%20Loire&utm_source=wp')).toBe('region=pays-de-la-loire&utm_source=wp');
    expect(canonicalSearch('?tri=yield_desc')).toBe('tri=rendement_desc');
    expect(canonicalSearch('?tri=price_asc&type=parking')).toBe('type=parking&tri=prix_asc');
    expect(canonicalSearch('')).toBeNull();
  });

  test('puces des critères actifs', () => {
    const chips = filterChips(filtersFromParams(new URLSearchParams(SPEC_URL))).map((c) => c.label);
    expect(chips).toEqual(['Appartement', 'Maison', 'Location vide', 'Auvergne-Rhône-Alpes', 'Rhône (69)', 'Prix ≤ 300\u00a0000\u00a0€', 'Rendement brut ≥ 5\u00a0%', 'Surface ≥ 20\u00a0m²']);
  });

  test('pagination : 1 … p-1 p p+1 … n', () => {
    expect(pageItems(1, 1)).toEqual([1]);
    expect(pageItems(1, 3)).toEqual([1, 2, 3]);
    expect(pageItems(5, 10)).toEqual([1, 'gap-4', 4, 5, 6, 'gap-10', 10]);
  });
});

// ------------------------------------------------------------------------------------------------
describe('page des annonces', () => {
  test('filtres de l\'URL → GET /properties sans jeton, cartes, compteur, puces, pagination, JSON-LD ItemList', async () => {
    mockProperties([listing('c1'), listing('c2')], 30);
    const c = await render(<ListingsPage user={null} />, '/?type=appartement,maison&bail=habitation-vide&region=auvergne-rhone-alpes&departement=69&rendement_min=5&tri=rendement_desc');
    const [url, cfg] = propertiesCalls()[0];
    expect(url).toMatch(/\/api\/properties$/);
    expect(cfg.headers).toBeUndefined();
    expect(cfg.params).toEqual({ property_types: 'appartement,maison', lease_types: 'habitation-vide', region: 'Auvergne-Rhône-Alpes', department: '69', min_yield: 5, sort: 'yield_desc', limit: 24, page: 1 });
    expect(c.querySelector('h1').textContent).toBe('Biens loués à vendre');
    expect(c.querySelectorAll('[data-testid="listing-card"]')).toHaveLength(2);
    expect(c.querySelector('[data-testid="results-count"]').textContent).toBe('30 biens');
    expect(c.querySelector('#filtres-type-maison').checked).toBe(true);
    expect(c.querySelector('#filtres-bail-habitation-vide').checked).toBe(true);
    expect(c.querySelector('[data-testid="filter-region"]').value).toBe('Auvergne-Rhône-Alpes');
    expect(c.querySelector('[data-testid="filter-departement"]').value).toBe('69');
    expect(c.querySelector('[data-testid="filter-rendement-min"]').value).toBe('5');
    expect(c.querySelector('[data-testid="sort-select"]').value).toBe('rendement_desc');
    expect(c.querySelector('[data-testid="mobile-filters-btn"]').textContent).toContain('Filtres (6)');
    expect(Array.from(c.querySelectorAll('[data-testid="active-filters"] button')).map((b) => b.textContent)).toEqual(
      expect.arrayContaining(['Appartement', 'Maison', 'Location vide', 'Rendement brut ≥ 5\u00a0%', 'Effacer les filtres']),
    );
    const pages = Array.from(c.querySelectorAll('[data-testid="pagination"] a')).map((a) => a.getAttribute('href'));
    expect(pages).toContain('/?type=appartement,maison&bail=habitation-vide&region=auvergne-rhone-alpes&departement=69&rendement_min=5&tri=rendement_desc&page=2');
    const ld = Array.from(document.head.querySelectorAll('script[type="application/ld+json"]')).map((s) => JSON.parse(s.textContent));
    const list = ld.find((o) => o['@type'] === 'ItemList');
    expect(list.itemListElement.map((i) => i.url)).toEqual([expect.stringMatching(/\/annonce\/c1$/), expect.stringMatching(/\/annonce\/c2$/)]);
    expect(ld.find((o) => o['@type'] === 'Organization')).toBeTruthy();
    expect(document.head.querySelector('link[rel="canonical"]').getAttribute('href')).toMatch(/\/$/);
    expect(c.textContent).not.toMatch(NO_ZERO);
  });

  test('cartes : rendement brut et net, loyer HC, prix honoraires inclus, DPE, « Propriétaire vérifié », locataire en place', async () => {
    mockProperties([listing('c1'), listing('c2', { ownership: { status: 'pending' }, net_yield: null, property_tax: null, non_recoverable_charges: null })], 2);
    const c = await render(<ListingsPage user={null} />);
    const [a, b] = c.querySelectorAll('[data-testid="listing-card"]');
    expect(a.querySelector('[data-testid="listing-card-yield"]').textContent).toBe('5,1\u00a0%');
    expect(a.querySelector('[data-testid="listing-card-net-yield"]').textContent).toBe('net 4,2\u00a0%');
    expect(a.querySelector('[data-testid="listing-card-rent"]').textContent).toBe('620\u00a0€/mois');
    expect(a.querySelector('[data-testid="listing-card-price"]').textContent).toBe('145\u00a0000\u00a0€');
    expect(a.textContent).toContain('Honoraires inclus, à la charge du vendeur');
    expect(a.querySelector('[data-testid="dpe-pill"]').getAttribute('data-dpe')).toBe('D');
    expect(a.querySelector('[data-testid="listing-card-verified"]').textContent).toBe('Propriétaire vérifié');
    expect(a.querySelector('[data-testid="listing-card-tenant"]').textContent).toBe('Locataire en place depuis 2019');
    expect(a.querySelector('[data-testid="listing-card-link"]').getAttribute('href')).toBe('/annonce/c1');
    // Justificatif en cours de contrôle : pas de badge vert ; pas de rendement net sans charges
    expect(b.querySelector('[data-testid="listing-card-verified"]')).toBeNull();
    expect(b.querySelector('[data-testid="listing-card-net-yield"]')).toBeNull();
  });

  test('modifier un filtre met l\'URL à jour (page 1) et relance la recherche', async () => {
    mockProperties([listing('c1')], 1);
    const c = await render(<ListingsPage user={null} />, '/?region=bretagne&page=3');
    await click(c.querySelector('#filtres-type-parking'));
    expect(where(c)).toBe('/?type=parking&region=bretagne');
    expect(lastParams()).toMatchObject({ property_types: 'parking', region: 'Bretagne', page: 1 });
    await change(c.querySelector('[data-testid="sort-select"]'), 'prix_asc');
    expect(where(c)).toBe('/?type=parking&region=bretagne&tri=prix_asc');
    expect(lastParams().sort).toBe('price_asc');
    await change(c.querySelector('[data-testid="filter-rendement-min"]'), '6');
    expect(where(c)).toBe('/?type=parking&region=bretagne&rendement_min=6&tri=prix_asc');
    expect(lastParams().min_yield).toBe(6);
    await change(c.querySelector('[data-testid="filter-surface-min"]'), '30');
    expect(lastParams().min_surface).toBe(30);
    // Retrait d'une puce
    const chip = Array.from(c.querySelectorAll('[data-testid="active-filters"] button')).find((b) => b.textContent === 'Bretagne');
    await click(chip);
    expect(where(c)).toBe('/?type=parking&rendement_min=6&surface_min=30&tri=prix_asc');
  });

  test('aucun résultat : jamais « 0 », titre de l\'état vide, « Effacer les filtres », alerte préremplie', async () => {
    mockProperties([], 0);
    const c = await render(<ListingsPage user={null} />, '/?type=maison&region=corse&prix_max=300000&rendement_min=6');
    const empty = c.querySelector('[data-testid="listings-empty"]');
    expect(empty.querySelector('h2').textContent).toBe('Aucun bien ne correspond pour l\'instant');
    expect(c.querySelector('[data-testid="results-count"]').textContent).toBe('');
    expect(c.querySelector('[data-testid="listings-total"]')).toBeNull();
    expect(c.querySelector('[data-testid="alert-form"] input[name="property_types"][value="maison"]').checked).toBe(true);
    expect(c.querySelector('[data-testid="alert-form"] input[name="regions"][value="Corse"]').checked).toBe(true);
    expect(c.querySelector('[data-testid="alert-form"] select[name="max_price"]').value).toBe('300000');
    expect(c.querySelector('[data-testid="alert-form"] select[name="min_yield"]').value).toBe('6');
    expect(c.textContent).not.toMatch(NO_ZERO);
    expect(c.querySelector('[data-testid="pagination"]')).toBeNull();
    await click(c.querySelector('[data-testid="empty-reset"]'));
    expect(where(c)).toBe('/');
  });

  test('sans filtre : nombre de biens affiché seulement à partir de 3, « Comment ça marche » repliable', async () => {
    mockProperties([listing('c1'), listing('c2')], 2);
    const few = await render(<ListingsPage user={null} />);
    expect(few.querySelector('[data-testid="listings-total"]')).toBeNull();
    expect(few.querySelector('[data-testid="results-count"]').textContent).toBe('');
    expect(few.querySelector('[data-testid="listings-empty"]')).toBeNull();
    const toggle = few.querySelector('[data-testid="how-it-works-toggle"]');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(few.querySelector('[data-testid="how-it-works"]').textContent).toContain('Offre d\'achat, puis notaire');
    mockProperties([listing('c1'), listing('c2'), listing('c3')], 3);
    const many = await render(<ListingsPage user={null} />);
    expect(many.querySelector('[data-testid="listings-total"]').textContent).toBe('3 biens en ligne');
  });

  test('région en toutes lettres : URL canonique sans entrée d\'historique, une seule recherche', async () => {
    mockProperties([listing('c1')], 1);
    const c = await render(<ListingsPage user={null} />, '/?region=Bretagne&prix_max=300000&utm_source=wp');
    expect(where(c)).toBe('/?region=bretagne&prix_max=300000&utm_source=wp');
    expect(propertiesCalls()).toHaveLength(1);
    expect(lastParams()).toMatchObject({ region: 'Bretagne', max_price: 300000 });
  });

  test('erreur réseau : message et bouton « Réessayer »', async () => {
    axios.get.mockRejectedValue(new Error('réseau'));
    const c = await render(<ListingsPage user={null} />);
    expect(c.querySelector('[data-testid="listings-error"]').textContent).toContain('Réessayer');
    mockProperties([listing('c1')], 1);
    await click(c.querySelector('[data-testid="listings-error"] button'));
    expect(c.querySelectorAll('[data-testid="listing-card"]')).toHaveLength(1);
  });

  test('mobile : bouton « Filtres (n) », panneau plein écran, application au clic', async () => {
    mockProperties([listing('c1')], 1);
    const c = await render(<ListingsPage user={null} />, '/?region=bretagne');
    await click(c.querySelector('[data-testid="mobile-filters-btn"]'));
    const panel = c.querySelector('[data-testid="mobile-filters"]');
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.className).toContain('fixed inset-0');
    expect(document.body.style.overflow).toBe('hidden');
    await click(panel.querySelector('#mobile-type-appartement'));
    expect(where(c)).toBe('/?region=bretagne');
    await click(panel.querySelector('[data-testid="mobile-filters-apply"]'));
    expect(c.querySelector('[data-testid="mobile-filters"]')).toBeNull();
    expect(where(c)).toBe('/?type=appartement&region=bretagne');
    expect(document.body.style.overflow).toBe('');
  });

  test('favoris : visiteur → inscription acquéreur ; acquéreur → POST /favorites ; vendeur : pas de cœur', async () => {
    mockProperties([listing('c1')], 1);
    const visitor = await render(<ListingsPage user={null} />, '/?type=maison');
    await click(visitor.querySelector('[data-testid="favorite-toggle"]'));
    expect(where(visitor)).toBe(`/register?role=buyer&redirect=${encodeURIComponent('/?type=maison')}`);

    axiosInstance.get.mockResolvedValue({ data: { favorites: [{ property_id: 'c1' }] } });
    const buyer = await render(<ListingsPage user={{ id: 'b1', role: 'buyer' }} />);
    expect(axiosInstance.get).toHaveBeenCalledWith('/favorites', { skipAuthRedirect: true });
    const heart = buyer.querySelector('[data-testid="favorite-toggle"]');
    expect(heart.getAttribute('aria-pressed')).toBe('true');
    await click(heart);
    expect(axiosInstance.delete).toHaveBeenCalledWith('/favorites/c1');
    expect(heart.getAttribute('aria-pressed')).toBe('false');
    await click(heart);
    expect(axiosInstance.post).toHaveBeenCalledWith('/favorites', { property_id: 'c1' });

    const seller = await render(<ListingsPage user={{ id: 's1', role: 'seller' }} />);
    expect(seller.querySelector('[data-testid="favorite-toggle"]')).toBeNull();
    // Encart vendeur : vers la page /vendre
    expect(seller.querySelector('[data-testid="seller-callout"] a').getAttribute('href')).toBe('/vendre');
  });

  test('historique : un réglage de filtre ou de tri remplace l\'adresse, la validation du panneau mobile en ajoute une', async () => {
    mockProperties([listing('c1')], 1);
    const c = await render(<ListingsPage user={null} />, '/?region=bretagne');
    await click(c.querySelector('#filtres-type-maison'));
    expect(navType(c)).toBe('REPLACE');
    await change(c.querySelector('[data-testid="sort-select"]'), 'prix_asc');
    expect(navType(c)).toBe('REPLACE');
    await click(c.querySelector('[data-testid="mobile-filters-btn"]'));
    await click(c.querySelector('#mobile-type-parking'));
    await click(c.querySelector('[data-testid="mobile-filters-apply"]'));
    expect(navType(c)).toBe('PUSH');
  });

  test('panneau mobile : le bouton annonce le nombre de biens du brouillon (requête légère limit=1)', async () => {
    expect(showResultsLabel(null)).toBe('Afficher les biens');
    expect(showResultsLabel(0)).toBe('Aucun bien : créer une alerte');
    expect(showResultsLabel(1)).toBe('Afficher 1 bien');
    expect(showResultsLabel(3)).toBe('Afficher 3 biens');
    mockProperties([listing('c1')], 3);
    const c = await render(<ListingsPage user={null} />, '/?region=bretagne');
    await click(c.querySelector('[data-testid="mobile-filters-btn"]'));
    await wait(350);
    expect(lastParams()).toMatchObject({ region: 'Bretagne', limit: 1 });
    expect(c.querySelector('[data-testid="mobile-filters-apply"]').textContent).toBe('Afficher 3 biens');
    mockProperties([], 0);
    await click(c.querySelector('#mobile-type-bureaux'));
    await wait(350);
    expect(lastParams()).toMatchObject({ property_types: 'bureaux', region: 'Bretagne', limit: 1 });
    expect(c.querySelector('[data-testid="mobile-filters-apply"]').textContent).toBe('Aucun bien : créer une alerte');
    expect(c.querySelector('[data-testid="mobile-filters"]').textContent).not.toMatch(NO_ZERO);
  });

  test('lien filtré (un type de bien, une région) : H1, titre et adresse canonique de la recherche', async () => {
    expect(searchHeading({ types: ['appartement'], region: 'Bretagne' })).toBe('Appartements loués à vendre en Bretagne');
    expect(searchHeading({ types: ['local-commercial'], region: '' })).toBe('Locaux commerciaux loués à vendre');
    expect(searchHeading({ types: [], region: 'Pays de la Loire' })).toBe('Biens loués à vendre dans les Pays de la Loire');
    expect(searchHeading({ types: ['maison', 'parking'], region: 'Bretagne' })).toBeNull();
    expect(searchHeading({ types: [], region: '' })).toBeNull();
    mockProperties([listing('c1'), listing('c2'), listing('c3')], 3);
    const c = await render(<ListingsPage user={null} />, '/?type=appartement&region=bretagne&prix_max=500000');
    expect(c.querySelector('h1').textContent).toBe('Appartements loués à vendre en Bretagne');
    expect(document.title).toMatch(/^Appartements loués à vendre en Bretagne \| VenteLoc$/);
    expect(document.head.querySelector('link[rel="canonical"]').getAttribute('href')).toMatch(/\/\?type=appartement&region=bretagne$/);
    expect(c.querySelector('[data-testid="listings-search-total"]').textContent).toBe('3 biens');
  });

  test('JSON-LD ItemList : jamais d\'annonce de test', async () => {
    mockProperties([listing('reelle'), listing('fictive', { is_test: true })], 2);
    await render(<ListingsPage user={null} />);
    const ld = Array.from(document.head.querySelectorAll('script[type="application/ld+json"]')).map((x) => JSON.parse(x.textContent));
    const list = ld.find((o) => o['@type'] === 'ItemList');
    expect(list.itemListElement.map((i) => i.url)).toEqual([expect.stringMatching(/\/annonce\/reelle$/)]);
  });

  test('acquéreur connecté : pas d\'encart vendeur', async () => {
    mockProperties([listing('c1')], 1);
    const c = await render(<ListingsPage user={{ id: 'b1', role: 'buyer' }} />);
    expect(c.querySelector('[data-testid="seller-callout"]')).toBeNull();
  });

  test('encart vendeur pour un visiteur : « Déposez votre annonce » vers /vendre, événement hero_cta_seller', async () => {
    mockProperties([listing('c1')], 1);
    const c = await render(<ListingsPage user={null} />);
    const callout = c.querySelector('[data-testid="seller-callout"]');
    expect(callout.textContent).toContain('Vous vendez un bien loué ?');
    const link = callout.querySelector('a');
    expect(link.getAttribute('href')).toBe('/vendre');
    expect(link.textContent).toContain('Déposez votre annonce');
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
      mockProperties([listing('c1'), listing('c2'), listing('c3')], 9);
      const c = await render(<EmbedListingsPage />, '/embed/annonces?type=appartement&rendement_min=5&limit=3', '/embed/annonces');
      expect(lastParams()).toEqual({ property_types: 'appartement', min_yield: 5, sort: 'recent', limit: 3, page: 1 });
      expect(c.querySelectorAll('[data-testid="listing-card"]')).toHaveLength(3);
      expect(Array.from(c.querySelectorAll('[data-testid="listing-card-link"]')).every((a) => a.getAttribute('target') === '_top')).toBe(true);
      const all = c.querySelector('[data-testid="embed-all"]');
      expect(all.getAttribute('href')).toBe('/?type=appartement&rendement_min=5&utm_source=wordpress&utm_medium=embed');
      expect(c.querySelector('[data-testid="listing-card-link"]').getAttribute('href')).toBe('/annonce/c1?utm_source=wordpress&utm_medium=embed');
      expect(all.getAttribute('target')).toBe('_top');
      expect(c.querySelector('[data-testid="app-header"]')).toBeNull();
      expect(c.querySelector('[data-testid="app-footer"]')).toBeNull();
      expect(postMessage).toHaveBeenCalledWith({ type: 'venteloc-embed-height', height: expect.any(Number) }, '*');
      expect(document.head.querySelector('meta[name="robots"]').getAttribute('content')).toBe('noindex, nofollow');
    } finally {
      if (parentDescriptor) Object.defineProperty(window, 'parent', parentDescriptor);
    }
  });

  test('aucun bien : phrase sans « 0 » et lien vers tous les biens', async () => {
    mockProperties([], 0);
    const c = await render(<EmbedListingsPage />, '/embed/annonces?region=corse', '/embed/annonces');
    expect(c.querySelector('[data-testid="embed-empty"]').textContent).toBe('Aucun bien ne correspond pour l\'instant.');
    expect(c.textContent).not.toMatch(NO_ZERO);
    expect(c.querySelector('[data-testid="embed-all"]').getAttribute('href')).toBe('/?region=corse&utm_source=wordpress&utm_medium=embed');
  });

  test('marqueurs de campagne : utm_source, utm_medium, utm_campaign repris de ?campagne=', async () => {
    expect(embedTracking('')).toBe('utm_source=wordpress&utm_medium=embed');
    expect(embedTracking('campagne=page-pac')).toBe('utm_source=wordpress&utm_medium=embed&utm_campaign=page-pac');
    mockProperties([listing('c1')], 1);
    const c = await render(<EmbedListingsPage />, '/embed/annonces?campagne=accueil', '/embed/annonces');
    expect(c.querySelector('[data-testid="embed-all"]').getAttribute('href')).toBe('/?utm_source=wordpress&utm_medium=embed&utm_campaign=accueil');
  });
});
