// Redirections côté client des anciennes URL (MODE-TEST-ET-APP.md §A.1) à travers la table des routes d'App.js :
// jamais de 404, filtres conservés et convertis, page des annonces sur /, module /embed/annonces sans en-tête.
// Les mêmes correspondances sont servies en 301 par frontend/nginx.conf (ops/tests/test_nginx.sh).
// Exécution : cd frontend && CI=true npx craco test --watchAll=false src/pages/__tests__/redirects.test.jsx
import '@/components/shared/jestEnv';
import { Suspense, act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';

jest.mock('axios', () => {
  const instance = {
    get: jest.fn(() => Promise.resolve({ data: [] })),
    post: jest.fn(() => Promise.resolve({ data: {} })),
    put: jest.fn(() => Promise.resolve({ data: {} })),
    delete: jest.fn(() => Promise.resolve({ data: {} })),
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, default: { ...instance, create: () => instance } };
});
jest.mock('@/lib/analytics', () => ({ trackEvent: jest.fn(), trackPageView: jest.fn(), initAnalytics: jest.fn() }));
jest.mock('sonner', () => ({ toast: { info: jest.fn(), success: jest.fn(), error: jest.fn(), warning: jest.fn() }, Toaster: () => null }));

import axios from 'axios';
import { toast } from 'sonner';
import { AppRoutes, roleRestrictionMessage } from '@/App';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView = jest.fn();

const mounted = [];
const flush = async () => { await act(async () => { await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); }); };
let current = '';
const LocationProbe = () => {
  const { pathname, search } = useLocation();
  current = `${pathname}${search}`;
  return null;
};
const open = async (url) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[url]}>
        <Suspense fallback={null}><AppRoutes user={null} setUser={jest.fn()} loading={false} /></Suspense>
        <LocationProbe />
      </MemoryRouter>,
    );
  });
  await flush();
  await flush();
  mounted.push({ root, container });
  return container;
};
const here = () => current;

beforeEach(() => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({}) }));
  axios.get.mockImplementation(() => Promise.resolve({ data: [], headers: { 'x-total-count': '0' } }));
});
afterEach(() => {
  mounted.splice(0).forEach(({ root, container }) => { act(() => root.unmount()); container.remove(); });
  jest.clearAllMocks();
});

describe('anciennes URL → page des annonces', () => {
  test.each([
    ['/entreprises-a-vendre?metiers=isolation&region=Bretagne&max_price=300000', '/?metier=isolation&region=bretagne&prix_max=300000'],
    ['/search?rge_type=Pompes%20%C3%A0%20chaleur%20air%2Feau', '/?metier=pac-clim-cvc&rge=1'],
    ['/buyer/search', '/'],
    ['/entreprises-a-vendre?metier=electricite&utm_source=wp', '/?metier=electricite&utm_source=wp'],
    ['/entreprises-batiment-a-vendre', '/'],
    ['/entreprises-batiment-a-vendre/metier/couverture-charpente', '/?metier=couverture-charpente'],
    ['/entreprises-batiment-a-vendre/region/pays-de-la-loire', '/?region=pays-de-la-loire'],
    ['/entreprises-rge-a-vendre', '/?rge=1'],
    ['/entreprises-rge-a-vendre/activite/pompes-a-chaleur-air-eau', '/?metier=pac-clim-cvc&rge=1'],
    ['/entreprises-rge-a-vendre/region/corse', '/?region=corse&rge=1'],
    ['/reprendre-une-entreprise-batiment', '/'],
    ['/reprendre-une-entreprise-rge', '/'],
    ['/guides', '/'],
    ['/guides/combien-vaut-entreprise-batiment', '/'],
    ['/verifier-entreprise-rge', '/'],
  ])('%s → %s', async (from, to) => {
    const c = await open(from);
    expect(here()).toBe(to);
    // Titre général, ou titre de la recherche ciblée (un métier et/ou une région)
    expect(c.querySelector('h1').textContent).toMatch(/^Entreprises (du bâtiment|de |d').*à vendre/);
    expect(c.querySelector('[data-testid="not-found"]')).toBeNull();
  });

  test.each([
    ['/vendre-mon-entreprise-batiment'],
    ['/vendre-mon-entreprise-rge'],
  ])('%s → /estimer (entrée du parcours cédant, pas la liste des annonces)', async (from) => {
    const c = await open(from);
    expect(here()).toBe('/estimer');
    expect(c.querySelector('[data-testid="not-found"]')).toBeNull();
  });

  test('/ est la page des annonces (pas de redirection), avec l\'en-tête et le pied de page de l\'application', async () => {
    const c = await open('/');
    expect(here()).toBe('/');
    expect(c.querySelector('[data-testid="app-header"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="app-footer"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="listings-empty"]')).not.toBeNull();
  });

  test('/embed/annonces : module sans en-tête ni pied de page', async () => {
    const c = await open('/embed/annonces?limit=3');
    expect(c.querySelector('[data-testid="embed-listings"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="app-header"]')).toBeNull();
    expect(c.querySelector('[data-testid="app-footer"]')).toBeNull();
  });

  test('page connectée sans session : connexion puis retour à la page demandée (lien reçu par e-mail)', async () => {
    await open('/dataroom/c1?onglet=documents');
    expect(here()).toBe(`/login?redirect=${encodeURIComponent('/dataroom/c1?onglet=documents')}`);
    await open('/seller/mandat/c9');
    expect(here()).toBe(`/login?redirect=${encodeURIComponent('/seller/mandat/c9')}`);
  });

  test('page d\'un autre rôle : retour à l\'espace du compte, avec l\'explication', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/seller/dashboard']}>
          <Suspense fallback={null}><AppRoutes user={{ id: 'b1', role: 'buyer', email: 'b@x.fr' }} setUser={jest.fn()} loading={false} /></Suspense>
          <LocationProbe />
        </MemoryRouter>,
      );
    });
    await flush();
    mounted.push({ root, container });
    expect(here()).toBe('/buyer/dashboard');
    expect(toast.info).toHaveBeenCalledWith('Cette page est réservée aux comptes cédant.', { id: 'role-restriction' });
    expect(roleRestrictionMessage(['buyer', 'seller'])).toBe('Cette page est réservée aux comptes repreneur ou cédant.');
  });

  test('adresse inconnue : 404', async () => {
    const nf = await open('/nimporte-quoi');
    expect(nf.querySelector('[data-testid="not-found"]')).not.toBeNull();
  });
});
