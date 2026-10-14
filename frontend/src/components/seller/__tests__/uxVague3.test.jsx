// Non-régression « UX et mise en page » (vague 3) : fiche (titre de page, badges RGE non vérifiés, tuile EBE,
// actions), indicateur d'étapes mobile, qualifications repliées à l'écran 1, espace vendeur, en-tête admin,
// pastilles et motifs admin, eyebrow de l'accueil, aide « effectif » commune estimateur / annonce.
// Exécution : cd frontend && CI=true npx craco test --watchAll=false src/components/seller/__tests__/uxVague3.test.jsx
import '@/components/shared/jestEnv';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

jest.mock('@/App', () => ({ axiosInstance: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() }, API: '/api', EMAIL_NOT_VERIFIED_EVENT: 'cession:email-not-verified' }));
jest.mock('@radix-ui/primitive/is-development', () => jest.requireActual('@radix-ui/primitive/dist/internal/is-development.false.js'), { virtual: true });
jest.mock('@/lib/analytics', () => ({ trackEvent: jest.fn(), trackPageView: jest.fn(), initAnalytics: jest.fn() }));
jest.mock('@/components/SecurePdfViewer', () => () => null);

import { axiosInstance as api } from '@/App';
import { BRAND } from '@/lib/brand';
import PropertyDetail from '@/pages/PropertyDetail';
import CreateListing from '@/pages/CreateListing';
import SellerDashboard from '@/pages/SellerDashboard';
import { StepIndicator } from '@/components/seller/FormFields';
import { STEPS, HELP } from '@/components/seller/listingForm';
import { Pill } from '@/components/admin/shared';
import { checkChips, moderationFlagLabels, removalSentence } from '@/components/admin/AdminProperties';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.scrollTo = jest.fn();
Element.prototype.scrollIntoView = jest.fn();
if (typeof window.ResizeObserver === 'undefined') {
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

const mounted = [];
const flush = async () => { await act(async () => { await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); }); };
const render = async (ui, path = '/', routePath = '*') => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<MemoryRouter initialEntries={[path]}><Routes><Route path={routePath} element={ui} /></Routes></MemoryRouter>);
  });
  await flush();
  await flush();
  mounted.push({ root, container });
  return container;
};
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); await flush(); };

const property = {
  id: 'c1', status: 'published', title: 'Entreprise de plomberie-chauffage · Bretagne · 6 salariés', trades: ['plomberie-chauffage'],
  rge_types: ['Pompes à chaleur air/eau'], other_qualifications: [], is_rge: true, rge_validity: '2028-03-15',
  region: 'Bretagne', department: '29', staff_count: 6, ca_n: 780000, ebitda: 100000, asking_price: 380000,
  property_checks: { in_ademe_list: false, dirigeant_match: 'match_exact' },
  commission_info: { payer: 'cedant', terms_version: 'v2' },
};
const seller = { id: 'u1', role: 'seller', first_name: 'Michel', last_name: 'Dupont', email: 'michel@exemple.fr', email_verified: true, identity_verified: false };

const mockGet = (routes) => {
  api.get.mockImplementation((url) => {
    const entry = Object.keys(routes).filter((k) => url === k || url.startsWith(k)).sort((a, b) => b.length - a.length)[0];
    if (entry) return Promise.resolve({ data: routes[entry] });
    return Promise.reject(Object.assign(new Error('404'), { response: { status: 404, data: { detail: 'Introuvable' } } }));
  });
};

beforeEach(() => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({}) }));
  api.get.mockReset();
  api.post.mockReset();
  api.put.mockReset();
  try { sessionStorage.clear(); localStorage.clear(); } catch (e) { /* no-op */ }
});
afterEach(() => {
  mounted.splice(0).forEach(({ root, container }) => { act(() => root.unmount()); container.remove(); });
  jest.clearAllMocks();
});

describe('Fiche annonce', () => {
  test('annonce RGE : titre de page avec la marque principale, jamais la verticale', async () => {
    mockGet({ '/properties/c1': property });
    await render(<PropertyDetail user={null} />, '/property/c1', '/property/:id');
    expect(document.title).toBe(`${property.title} | ${BRAND.name}`);
    expect(document.title).not.toContain(BRAND.verticalName);
  });

  test('RGE non retrouvé sur la liste ADEME : validité en ton « déclaré », pas en vert', async () => {
    mockGet({ '/properties/c1': property });
    const c = await render(<PropertyDetail user={null} />, '/property/c1', '/property/:id');
    const badge = c.querySelector('[data-testid="rge-validity-badge"]');
    expect(badge.className).toContain('badge-declared');
    expect(badge.className).not.toContain('badge-verified');
    expect(badge.textContent).toBe("Déclarée valide jusqu'au 15 mars 2028");
  });

  test('RGE retrouvé sur la liste ADEME : badge vert « Valide jusqu\'au »', async () => {
    mockGet({ '/properties/c1': { ...property, property_checks: { in_ademe_list: true } } });
    const c = await render(<PropertyDetail user={null} />, '/property/c1', '/property/:id');
    const badge = c.querySelector('[data-testid="rge-validity-badge"]');
    expect(badge.className).toContain('badge-verified');
    expect(badge.textContent).toBe("Valide jusqu'au 15 mars 2028");
  });

  test('tuile EBE : multiple lu dans le bon sens (prix = n × EBE)', async () => {
    mockGet({ '/properties/c1': property });
    const c = await render(<PropertyDetail user={null} />, '/property/c1', '/property/:id');
    expect(c.textContent).not.toMatch(/× le prix/);
    expect(c.querySelector('[data-testid="ebitda-note"]').textContent).toBe("Prix demandé = 3,8 × l'EBE");
  });

  test('actions : grille deux colonnes sur mobile, action principale pleine largeur', async () => {
    mockGet({ '/properties/c1': property });
    const c = await render(<PropertyDetail user={null} />, '/property/c1', '/property/:id');
    expect(c.querySelector('[data-testid="property-actions"]').className).toMatch(/grid-cols-2/);
    expect(c.querySelector('[data-testid="contact-seller-btn"]').className).toMatch(/col-span-2/);
  });
});

describe('Dépôt d\'annonce', () => {
  test('indicateur d\'étapes : sous 640 px seul le libellé courant est visible, les autres restent lus', async () => {
    const c = await render(<StepIndicator steps={STEPS} current={2} onSelect={() => {}} maxReachable={2} />);
    const mobile = Array.from(c.querySelectorAll('span.sm\\:hidden'));
    expect(mobile.map((s) => s.textContent)).toEqual(['Entreprise', 'Chiffres', 'Cession']);
    expect(mobile.map((s) => s.className.includes('sr-only'))).toEqual([true, false, true]);
    mobile.forEach((s) => expect(s.className).not.toContain('truncate'));
  });

  test('écran 1 : qualifications RGE et labels repliées, dépliées au clic', async () => {
    api.get.mockResolvedValue({ data: {} });
    const c = await render(<CreateListing user={seller} />, '/seller/create');
    const toggle = c.querySelector('[data-testid="toggle-qualifications"]');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(c.querySelector('[data-testid="qualifications-fields"]')).toBeNull();
    expect(c.textContent).not.toContain('Aucun filtre = tous');
    await click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(c.querySelectorAll('[data-testid="rge-checkbox-option"]').length).toBeGreaterThan(0);
  });

  test('aide « effectif » : une seule définition pour l\'estimateur et l\'annonce', () => {
    expect(HELP.staff_count).toMatch(/vous compris/);
  });
});

describe('Espace vendeur', () => {
  test('une seule annonce : pleine largeur, bouton « Suivre cette annonce »', async () => {
    api.get.mockImplementation((url) => (url === '/properties'
      ? Promise.resolve({ data: [{ ...property, seller_id: 'u1', mandat_signed: true }] })
      : Promise.reject(Object.assign(new Error('404'), { response: { status: 404, data: {} } }))));
    const c = await render(<SellerDashboard user={seller} setUser={() => {}} />, '/seller/dashboard');
    const card = c.querySelector('[data-testid="listing-c1"]');
    expect(card).toBeTruthy();
    expect(card.parentElement.className).not.toContain('lg:grid-cols-2');
    expect(c.querySelector('[data-testid="open-c1"]').textContent).toBe('Suivre cette annonce');
  });
});

describe('Administration', () => {
  test('drapeau déjà porté par une pastille de contrôle : affiché une seule fois', () => {
    const chips = checkChips({ dirigeant_match: 'no_match', naf_in_building: true });
    expect(moderationFlagLabels(['dirigeant_non_confirme', 'naf_connexe'], chips)).toEqual(['code NAF connexe au bâtiment']);
    // Sans pastille équivalente (contrôle absent), le drapeau reste affiché
    expect(moderationFlagLabels(['dirigeant_non_confirme'], [])).toEqual(['qualité de dirigeant non confirmée par le registre']);
  });

  test('motif de retrait : un seul point final', () => {
    expect(removalSentence("Activité principale hors bâtiment d'après les pièces fournies.")).toBe("Retirée : Activité principale hors bâtiment d'après les pièces fournies.");
    expect(removalSentence('Doublon')).toBe('Retirée : Doublon.');
  });

  test('pastille longue : passe à la ligne au lieu de déborder', async () => {
    const c = await render(<Pill wrap tone="warning" testId="p">qualité de dirigeant non confirmée par le registre</Pill>);
    const pill = c.querySelector('[data-testid="p"]');
    expect(pill.className).toContain('whitespace-normal');
    expect(pill.className).toContain('max-w-full');
    expect(pill.className).not.toContain('whitespace-nowrap');
  });
});
