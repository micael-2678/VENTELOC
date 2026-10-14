// Table des routes d'App.js (docs/venteloc/API.md §10) : annonces sur /, fiche /annonce/:id, page vendeur /vendre,
// estimateur /estimer, module /embed/annonces sans en-tête, pages connectées derrière la connexion. Nouveau domaine :
// aucune redirection héritée de CessionRGE (anciennes URL → 404), ni côté client ni dans frontend/nginx.conf.
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

import fs from 'fs';
import path from 'path';
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

describe('routes publiques et connectées', () => {
  test('/ est la page des annonces (pas de redirection), avec l\'en-tête et le pied de page de l\'application', async () => {
    const c = await open('/');
    expect(here()).toBe('/');
    expect(c.querySelector('h1').textContent).toBe('Biens loués à vendre');
    expect(c.querySelector('[data-testid="app-header"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="app-footer"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="listings-empty"]')).not.toBeNull();
  });

  test('/annonce/:id : fiche du bien (GET /properties/{id})', async () => {
    axios.get.mockImplementation((url) => Promise.resolve(String(url).endsWith('/properties/p1')
      ? { data: { id: 'p1', property_type: 'appartement', city: 'Lyon', department: '69', rent_monthly: 620, asking_price: 145000, status: 'published' } }
      : { data: [], headers: { 'x-total-count': '0' } }));
    const c = await open('/annonce/p1');
    expect(here()).toBe('/annonce/p1');
    expect(c.querySelector('[data-testid="property-header"]')).not.toBeNull();
    expect(c.querySelector('h1').textContent).toBe('Appartement loué · Lyon (69)');
  });

  test.each([
    ['/vendre', 'Vendez votre bien loué à un investisseur'],
    ['/estimer', 'Estimer mon bien loué'],
  ])('%s : page publique', async (url, h1) => {
    const c = await open(url);
    expect(here()).toBe(url);
    expect(c.querySelector('h1').textContent).toBe(h1);
  });

  test.each([
    ['/property/p1'],
    ['/entreprises-a-vendre?metiers=isolation'],
    ['/entreprises-rge-a-vendre'],
    ['/vendre-mon-entreprise-batiment'],
    ['/president/abc'],
    ['/company/123'],
    ['/buyer/credits'],
  ])('ancienne URL de CessionRGE %s : 404, aucune redirection', async (url) => {
    const c = await open(url);
    expect(here()).toBe(url);
    expect(c.querySelector('[data-testid="not-found"]')).not.toBeNull();
  });

  test('nginx : plus aucune redirection héritée, alias du backend venteloc-api', () => {
    const conf = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'nginx.conf'), 'utf8');
    expect(conf).not.toMatch(/return 301 \/(\?|estimer)|entreprises-|vendre-mon-entreprise|\brge\b|cession/i);
    expect(conf).toContain('http://venteloc-api:8001');
    expect(conf).toContain('X-Frame-Options "DENY"');
    expect(conf).toContain('frame-ancestors \'self\' ${EMBED_ALLOWED_ORIGINS}');
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

  test('liens à jeton des e-mails : /suivi/:token et /reset-password/:token → ?token=', async () => {
    await open('/suivi/abc');
    expect(here()).toBe('/suivi?token=abc');
    await open('/reset-password/xyz');
    expect(here()).toBe('/reset-password?token=xyz');
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
    expect(toast.info).toHaveBeenCalledWith('Cette page est réservée aux comptes vendeur.', { id: 'role-restriction' });
    expect(roleRestrictionMessage(['buyer', 'seller'])).toBe('Cette page est réservée aux comptes acquéreur ou vendeur.');
  });

  test('adresse inconnue : 404', async () => {
    const nf = await open('/nimporte-quoi');
    expect(nf.querySelector('[data-testid="not-found"]')).not.toBeNull();
  });
});
