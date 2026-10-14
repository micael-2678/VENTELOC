// Tests de rendu des pages publiques restantes (pages légales, 404) et de la coque commune (AppHeader, AppFooter) :
// marque jamais en dur, aucune page marketing, en-tête selon la session, pied de page minimal avec la carte T.
// La page des annonces et les redirections sont testées dans listingsPage.test.jsx.
// Exécution : cd frontend && CI=true npx craco test --watchAll=false src/pages/__tests__/publicPages.test.jsx
import '@/components/shared/jestEnv';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

jest.mock('@/App', () => ({ axiosInstance: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() }, API: '/api' }));
jest.mock('@/lib/analytics', () => ({ trackEvent: jest.fn(), trackPageView: jest.fn(), initAnalytics: jest.fn() }));

import { axiosInstance } from '@/App';
import { BRAND, LEGAL } from '@/lib/brand';
import { fillText, content } from '@/seo';
import { organizationLd, websiteLd } from '@/seo/schema';
import { editorLines, mentionsSections, footerShortLine } from '@/seo/legal';
import { isPrivatePath } from '@/lib/seo';
import AppHeader from '@/components/layout/AppHeader';
import AppFooter, { marketingUrl } from '@/components/layout/AppFooter';
import { SessionContext } from '@/components/layout/session';
import { MentionsLegalesPage, CguPage, ReportPage } from '@/pages/LegalPages';
import NotFound from '@/pages/NotFound';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted = [];
const flush = async () => { await act(async () => { await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); }); };
const render = async (ui, path = '/', routePath = '*') => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={routePath} element={ui} />
          <Route path="/login" element={<p data-testid="page-login">connexion</p>} />
        </Routes>
      </MemoryRouter>,
    );
  });
  await flush();
  mounted.push({ root, container });
  return container;
};
const setInput = (el, value) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

beforeEach(() => {
  document.head.innerHTML = '';
  global.fetch = jest.fn((url) => Promise.resolve({ ok: true, status: 200, json: async () => (String(url).includes('legal-info') ? { rc_pro: 'Assureur X, police 42', mediateur: '', capital: '2000' } : {}) }));
  axiosInstance.get.mockResolvedValue({ data: [] });
});
afterEach(() => {
  mounted.splice(0).forEach(({ root, container }) => { act(() => root.unmount()); container.remove(); });
  jest.clearAllMocks();
  localStorage.clear();
});

// ------------------------------------------------------------------------------------------------
describe('contenus', () => {
  test('aucune marque en dur, aucun jeton résiduel, plus aucune section marketing', () => {
    const raw = JSON.stringify(content);
    expect(raw).not.toContain('CessionRGE');
    expect(raw).not.toContain('à compléter');
    expect(fillText(raw)).not.toMatch(/\{\{(brand|vertical|legalName|contactEmail|hoguetArt6)\}\}/);
    expect(Object.keys(content).sort()).toEqual(['estimate', 'footer', 'header', 'legal', 'listings', 'notFound']);
    expect(raw).not.toMatch(/\/(guides|vendre-mon-entreprise|reprendre-une-entreprise|entreprises-batiment-a-vendre|entreprises-rge-a-vendre|verifier-entreprise-rge)/);
    expect(content.listings.h1).toBe('Entreprises du bâtiment à vendre');
    expect(content.listings.intro).toBe('Annonces anonymes de cédants vérifiés. Contact gratuit pour les repreneurs.');
  });

  test('Organization et WebSite JSON-LD : marque, AlterEgo SAS, carte T, SIREN', () => {
    const org = organizationLd('https://exemple.fr', BRAND, LEGAL);
    expect(org.name).toBe(BRAND.name);
    expect(org.legalName).toBe(LEGAL.denomination);
    expect(JSON.stringify(org)).toContain(LEGAL.carteT);
    expect(org.identifier.find((i) => i.propertyID === 'SIREN').value).toBe(LEGAL.sirenDigits);
    const site = websiteLd('https://exemple.fr', BRAND);
    expect(site.url).toBe('https://exemple.fr/');
    expect(site.potentialAction).toBeUndefined();
  });

  test('mentions légales : lignes complètes, RC pro de repli, médiateur absent si vide', () => {
    const lines = editorLines({ marque: BRAND.name, email: BRAND.contactEmail });
    const labels = lines.map((l) => l.label);
    expect(labels).toEqual(expect.arrayContaining(['Dénomination sociale', 'Carte professionnelle', 'Fonds détenus', 'Responsabilité civile professionnelle', 'Marque exploitée']));
    expect(labels).not.toContain('Médiateur de la consommation');
    expect(lines.find((l) => l.label === 'Responsabilité civile professionnelle').value).toContain('loi Hoguet');
    expect(mentionsSections({ mediateur: 'CM2C' }, []).some((s) => s.id === 'mediation')).toBe(true);
  });

  test('module intégré et panneau de test jamais indexés', () => {
    expect(isPrivatePath('/embed/annonces')).toBe(true);
    expect(isPrivatePath('/test')).toBe(true);
    expect(isPrivatePath('/')).toBe(false);
    expect(isPrivatePath('/estimer')).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------
describe('coque de l\'application', () => {
  test('visiteur : Annonces, Vendre mon entreprise (inscription cédant), Connexion, Créer un compte ; en-tête non collant', async () => {
    const c = await render(<AppHeader user={null} />);
    const header = c.querySelector('[data-testid="app-header"]');
    expect(header.className).not.toContain('sticky');
    expect(c.querySelector('[data-testid="nav-listings"]').getAttribute('href')).toBe('/');
    expect(c.querySelector('[data-testid="nav-sell"]').getAttribute('href')).toBe('/register?role=seller');
    expect(c.querySelector('[data-testid="nav-login"]').getAttribute('href')).toBe('/login');
    expect(c.querySelector('[data-testid="nav-register"]').getAttribute('href')).toBe('/register');
    expect(c.querySelector('[data-testid="nav-messages"]')).toBeNull();
    expect(axiosInstance.get).not.toHaveBeenCalled();
    // Mobile : menu déroulant
    await act(async () => { c.querySelector('[data-testid="mobile-menu-btn"]').click(); });
    expect(c.querySelector('[data-testid="mobile-menu"]').textContent).toContain('Connexion');
  });

  test('cédant connecté : Vendre → /seller/create, Messages avec non-lus, Mon espace, menu du compte et déconnexion', async () => {
    axiosInstance.get.mockResolvedValue({ data: [{ id: 'k1', unread_count: 2 }, { id: 'k2', unread_count: 1 }] });
    const setUser = jest.fn();
    localStorage.setItem('token', 't');
    const seller = { id: 's1', role: 'seller', first_name: 'Michel', last_name: 'Dupont', email: 'm@d.fr' };
    const c = await render(<SessionContext.Provider value={{ user: seller, setUser }}><AppHeader /></SessionContext.Provider>, '/annonce');
    expect(c.querySelector('[data-testid="nav-sell"]').getAttribute('href')).toBe('/seller/create');
    expect(c.querySelector('[data-testid="nav-space"]').getAttribute('href')).toBe('/seller/dashboard');
    expect(axiosInstance.get).toHaveBeenCalledWith('/messages/conversations', { skipAuthRedirect: true });
    expect(c.querySelector('[data-testid="header-unread"]').textContent).toContain('3');
    await act(async () => { c.querySelector('[data-testid="account-menu-btn"]').click(); });
    expect(c.querySelector('[data-testid="account-menu"]').textContent).toContain('Michel Dupont');
    await act(async () => { c.querySelector('[data-testid="logout-btn"]').click(); });
    expect(setUser).toHaveBeenCalledWith(null);
    expect(localStorage.getItem('token')).toBeNull();
  });

  test('pied de page : liens légaux, AlterEgo SAS et carte T sur une ligne, lien « Site » seulement si configuré', async () => {
    const c = await render(<AppFooter />);
    const hrefs = Array.from(c.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(expect.arrayContaining(['/mentions-legales', '/confidentialite', '/cgu', '/signaler']));
    expect(c.querySelector('[data-testid="footer-site"]')).toBeNull();
    const legal = c.querySelector('[data-testid="footer-legal"]').textContent;
    expect(legal).toContain('AlterEgo SAS');
    expect(legal).toContain(LEGAL.carteT);
    expect(legal).not.toMatch(/Romane/);
    expect(footerShortLine({})).toContain('RCS Versailles 952 180 230');
    expect(marketingUrl('https://www.exemple.fr/')).toBe('https://www.exemple.fr');
    expect(marketingUrl('javascript:alert(1)')).toBe('');
    expect(marketingUrl('')).toBe('');
  });
});

// ------------------------------------------------------------------------------------------------
describe('pages légales et 404', () => {
  test('mentions, CGU avec version datée, signalement → POST /events {name:report} + mailto', async () => {
    const m = await render(<MentionsLegalesPage />, '/mentions-legales');
    const text = m.querySelector('[data-testid="mentions-legales"]').textContent;
    expect(text).toContain('Carte professionnelle');
    expect(text).toContain('Assureur X, police 42');
    expect(text).toContain('ne recevoir ni détenir');
    expect(m.querySelector('[data-testid="app-header"]')).not.toBeNull();
    expect(m.querySelector('[data-testid="app-footer"]')).not.toBeNull();
    const cgu = await render(<CguPage />, '/cgu');
    expect(cgu.querySelector('[data-testid="legal-version"]').textContent).toContain('Version du 10/10/2026');
    expect(cgu.textContent).toContain('Modération');
    const r = await render(<ReportPage />, '/signaler');
    const textarea = r.querySelector('textarea');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, 'Une annonce affiche un numéro de téléphone.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => setInput(r.querySelector('input[name="reference"]'), '/property/abc'));
    await act(async () => { r.querySelector('[data-testid="report-form"]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await flush();
    const post = global.fetch.mock.calls.find(([url, init]) => String(url).endsWith('/api/events') && init && init.body && JSON.parse(init.body).name === 'report');
    expect(JSON.parse(post[1].body)).toMatchObject({ name: 'report', path: '/signaler', props: { reason: 'coordonnees', reference: '/property/abc' } });
    expect(r.querySelector('[data-testid="report-success"]')).not.toBeNull();
  });

  test('404 : liens utiles vers l\'application, jamais vers les pages marketing retirées', async () => {
    const c = await render(<NotFound />, '/nimporte');
    const links = Array.from(c.querySelectorAll('[data-testid="not-found"] a')).map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/', '/estimer', '/register?role=seller', '/login']);
    expect(document.head.querySelector('meta[name="robots"]').getAttribute('content')).toBe('noindex, nofollow');
  });
});
