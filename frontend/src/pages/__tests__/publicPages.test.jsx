// Tests de rendu des pages publiques (pages légales, 404, page vendeur /vendre, estimateur /estimer) et de la coque
// commune (AppHeader, AppFooter) : marque jamais en dur, vocabulaire VenteLoc, en-tête selon la session, pied de page
// minimal avec la carte T, honoraires TTC d'abord (barème de GET /config), estimateur par le rendement.
// La page des annonces est testée dans listingsPage.test.jsx, la fiche dans sellerPages.test.jsx et buyerPages.test.jsx.
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
import SellPage, { faqLd } from '@/pages/SellPage';
import EstimatePage, { estimatePayload } from '@/pages/EstimatePage';
import { resetCommissionCache } from '@/lib/useCommission';

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
          <Route path="/register" element={<p data-testid="page-register">inscription</p>} />
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

const CONFIG = { test_mode: false, commission: { rate_percent_ht: 4, rate_percent_ttc: 4.8, minimum_ht: 5000, minimum_ttc: 6000, vat_rate: 0.2 } };
let configResponse = {};

beforeEach(() => {
  document.head.innerHTML = '';
  resetCommissionCache();
  configResponse = {};
  global.fetch = jest.fn((url) => Promise.resolve({
    ok: true,
    status: 200,
    json: async () => (String(url).includes('legal-info') ? { rc_pro: 'Assureur X, police 42', mediateur: '', capital: '2000' } : String(url).endsWith('/api/config') ? configResponse : {}),
  }));
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
    expect(raw).not.toMatch(/Cession(RGE|Bâtiment)/);
    expect(raw).not.toContain('à compléter');
    expect(fillText(raw)).not.toMatch(/\{\{\w+\}\}/);
    expect(Object.keys(content).sort()).toEqual(['estimate', 'footer', 'header', 'legal', 'listings', 'notFound', 'sell']);
    expect(raw).not.toMatch(/\/(guides|vendre-mon-entreprise|entreprises-|property\/|president)/);
    expect(content.listings.h1).toBe('Biens loués à vendre');
    expect(content.listings.intro).toBe('Investissements locatifs vendus par leurs propriétaires. Vendeurs vérifiés, dossier complet, honoraires payés par le vendeur à la signature chez le notaire.');
    expect(content.sell.faq).toHaveLength(5);
    expect(BRAND.name).toBe('VenteLoc');
    expect(BRAND.siteUrl).toBe('https://venteloc.fr');
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
  test('visiteur : Biens à vendre, Vendre mon bien (/vendre), Connexion, Créer un compte ; en-tête non collant', async () => {
    const c = await render(<AppHeader user={null} />);
    const header = c.querySelector('[data-testid="app-header"]');
    expect(header.className).not.toContain('sticky');
    expect(c.querySelector('[data-testid="nav-listings"]').getAttribute('href')).toBe('/');
    expect(c.querySelector('[data-testid="nav-sell"]').getAttribute('href')).toBe('/vendre');
    expect(c.querySelector('[data-testid="nav-sell"]').textContent).toBe('Vendre mon bien');
    // Logo : pictogramme maison + clé, « Vente » + « Loc »
    expect(c.querySelector('a[aria-label="VenteLoc – accueil"]').textContent).toBe('VenteLoc');
    expect(c.querySelector('[data-testid="nav-login"]').getAttribute('href')).toBe('/login');
    expect(c.querySelector('[data-testid="nav-register"]').getAttribute('href')).toBe('/register');
    expect(c.querySelector('[data-testid="nav-messages"]')).toBeNull();
    expect(axiosInstance.get).not.toHaveBeenCalled();
    // Mobile : menu déroulant
    await act(async () => { c.querySelector('[data-testid="mobile-menu-btn"]').click(); });
    expect(c.querySelector('[data-testid="mobile-menu"]').textContent).toContain('Connexion');
  });

  test('vendeur connecté : Vendre → /vendre, Messages avec non-lus, Mon espace, menu du compte et déconnexion', async () => {
    axiosInstance.get.mockResolvedValue({ data: [{ id: 'k1', unread_count: 2 }, { id: 'k2', unread_count: 1 }] });
    const setUser = jest.fn();
    localStorage.setItem('token', 't');
    const seller = { id: 's1', role: 'seller', first_name: 'Michel', last_name: 'Dupont', email: 'm@d.fr' };
    const c = await render(<SessionContext.Provider value={{ user: seller, setUser }}><AppHeader /></SessionContext.Provider>, '/annonce');
    expect(c.querySelector('[data-testid="nav-sell"]').getAttribute('href')).toBe('/vendre');
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
    expect(cgu.querySelector('[data-testid="legal-version"]').textContent).toContain('Version du 14/10/2026');
    expect(cgu.textContent).toContain('Modération');
    const r = await render(<ReportPage />, '/signaler');
    const textarea = r.querySelector('textarea');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, 'Une annonce affiche un numéro de téléphone.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => setInput(r.querySelector('input[name="reference"]'), '/annonce/abc'));
    await act(async () => { r.querySelector('[data-testid="report-form"]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await flush();
    const post = global.fetch.mock.calls.find(([url, init]) => String(url).endsWith('/api/events') && init && init.body && JSON.parse(init.body).name === 'report');
    expect(JSON.parse(post[1].body)).toMatchObject({ name: 'report', path: '/signaler', props: { reason: 'coordonnees', reference: '/annonce/abc' } });
    expect(r.querySelector('[data-testid="report-success"]')).not.toBeNull();
  });

  test('404 : liens utiles vers l\'application, jamais vers les pages marketing retirées', async () => {
    const c = await render(<NotFound />, '/nimporte');
    const links = Array.from(c.querySelectorAll('[data-testid="not-found"] a')).map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/', '/vendre', '/estimer', '/login']);
    expect(document.head.querySelector('meta[name="robots"]').getAttribute('content')).toBe('noindex, nofollow');
  });
});

// ------------------------------------------------------------------------------------------------
describe('page vendeur /vendre', () => {
  test('raisons, honoraires TTC puis HT (repli 3 % HT / 3 000 € HT), FAQ en 5 questions, CTA estimer et déposer', async () => {
    const c = await render(<SellPage user={null} />, '/vendre');
    expect(c.querySelector('[data-testid="sell-h1"]').textContent).toBe('Vendez votre bien loué à un investisseur');
    const sentence = c.querySelector('[data-testid="commission-sentence"]').textContent;
    expect(sentence).toMatch(/^3,6\u00a0% TTC du prix de vente \(3\u00a0% HT\), minimum 3\u202f600\u00a0€ TTC \(3\u202f000\u00a0€ HT\), à la charge du vendeur/);
    expect(c.querySelector('[data-testid="sell-faq"]').querySelectorAll('li')).toHaveLength(5);
    expect(c.querySelector('[data-testid="sell-estimate-hero"]').getAttribute('href')).toBe('/estimer');
    expect(c.querySelector('[data-testid="sell-deposit-hero"]').getAttribute('href')).toBe('/register?role=seller');
    // Calculateur : 200 000 € → 7 200 € TTC (6 000 € HT), le vendeur perçoit 192 800 €
    expect(c.querySelector('[data-testid="fees-ttc"]').textContent).toBe('7\u202f200\u00a0€');
    expect(c.querySelector('[data-testid="fees-ht"]').textContent).toBe('soit 6\u202f000\u00a0€ HT');
    expect(c.querySelector('[data-testid="fees-net"]').textContent).toBe('192\u202f800\u00a0€');
    // Petit prix : le minimum s'applique
    act(() => setInput(c.querySelector('[data-testid="fees-price-input"]'), '40000'));
    expect(c.querySelector('[data-testid="fees-ttc"]').textContent).toBe('3\u202f600\u00a0€');
    expect(c.querySelector('[data-testid="fees-minimum"]')).not.toBeNull();
    const ld = JSON.parse(Array.from(document.head.querySelectorAll('script[type="application/ld+json"]')).map((s) => s.textContent).find((t) => t.includes('FAQPage')));
    expect(ld.mainEntity).toHaveLength(5);
    expect(ld.mainEntity[2].acceptedAnswer.text).toContain('Le vendeur, toujours');
    expect(faqLd([{ q: 'Q', a: '**gras** et [lien](/x)' }]).mainEntity[0].acceptedAnswer.text).toBe('gras et lien');
  });

  test('barème servi par GET /config : TTC d\'abord avec les valeurs du serveur ; vendeur connecté → /seller/create', async () => {
    configResponse = CONFIG;
    const c = await render(<SellPage user={{ id: 's1', role: 'seller' }} />, '/vendre');
    await flush();
    expect(c.querySelector('[data-testid="commission-sentence"]').textContent).toMatch(/^4,8\u00a0% TTC du prix de vente \(4\u00a0% HT\), minimum 6\u202f000\u00a0€ TTC \(5\u202f000\u00a0€ HT\)/);
    expect(c.querySelector('[data-testid="fees-ttc"]').textContent).toBe('9\u202f600\u00a0€');
    expect(c.querySelector('[data-testid="sell-deposit-hero"]').getAttribute('href')).toBe('/seller/create');
  });

  test('acquéreur connecté : pas de bouton « Déposer mon annonce »', async () => {
    const c = await render(<SellPage user={{ id: 'b1', role: 'buyer' }} />, '/vendre');
    expect(c.querySelector('[data-testid="sell-deposit-hero"]')).toBeNull();
    expect(c.textContent).toContain('compte acquéreur');
  });
});

// ------------------------------------------------------------------------------------------------
describe('estimateur /estimer (méthode du rendement)', () => {
  const RESULT = {
    id: 'e1', low: 150000, high: 190000, mid: 170000, method: 'Méthode du rendement : loyer net rapporté au rendement attendu.',
    drivers: [{ label: 'Zone 2 (grande métropole)', effect: '3,5 % à 5 % net' }, { label: 'Location meublée', effect: '+0,5 point' }],
    pedagogy: ['Un bail récent et un loyer au marché', 'Un locataire stable, sans incident'],
    yields: { gross_at_mid: 5.4, net_at_mid: 4.2, gross_at_price: 5.1, net_at_price: 4 },
    disclaimer: 'Estimation indicative, pas un avis de valeur.',
  };
  const fill = async (c, testId, value) => {
    const el = c.querySelector(`[data-testid="${testId}"]`);
    await act(async () => {
      const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
      el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    });
  };

  test('estimatePayload : champs vides omis, surface ignorée pour un parking', () => {
    expect(estimatePayload({ property_type: 'appartement', lease_type: 'habitation-vide', department: '69', rent_monthly: '800', surface: '42', charges_monthly: '', property_tax: '900', non_recoverable_charges: '', asking_price: '' }))
      .toEqual({ property_type: 'appartement', lease_type: 'habitation-vide', department: '69', rent_monthly: 800, surface: 42, property_tax: 900 });
    expect(estimatePayload({ property_type: 'parking', lease_type: 'parking', department: '75', rent_monthly: '140', surface: '12' }, { email: 'a@b.fr', consent: true }))
      .toEqual({ property_type: 'parking', lease_type: 'parking', department: '75', rent_monthly: 140, email: 'a@b.fr', consent: true });
  });

  test('champs obligatoires, bail proposé selon le type, POST /estimates, fourchette et rendements, dépôt prérempli', async () => {
    axiosInstance.post.mockResolvedValue({ data: RESULT });
    const c = await render(<EstimatePage user={null} />, '/estimer');
    expect(c.querySelector('h1').textContent).toBe('Estimer mon bien loué');
    await act(async () => { c.querySelector('[data-testid="estimate-form"]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(axiosInstance.post).not.toHaveBeenCalled();
    expect(c.textContent).toContain('Indiquez le loyer mensuel hors charges.');
    await fill(c, 'estimate-type-select', 'appartement');
    expect(c.querySelector('[data-testid="estimate-lease-select"]').value).toBe('habitation-vide');
    await fill(c, 'estimate-lease-select', 'habitation-meublee');
    await fill(c, 'estimate-department-select', '69');
    await fill(c, 'estimate-rent-input', '780');
    expect(c.textContent).toContain('Soit 9\u00a0360\u00a0€ de loyers par an.');
    await fill(c, 'estimate-price-input', '180000');
    expect(c.textContent).toContain('Rendement brut à ce prix : 5,2\u00a0%.');
    await act(async () => { c.querySelector('[data-testid="estimate-form"]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await flush();
    expect(axiosInstance.post).toHaveBeenCalledWith('/estimates', { property_type: 'appartement', lease_type: 'habitation-meublee', department: '69', rent_monthly: 780, asking_price: 180000 });
    expect(c.querySelector('[data-testid="estimate-range"]').textContent).toContain('150\u00a0000\u00a0€');
    expect(c.querySelector('[data-testid="estimate-yields"]').textContent).toContain('5,4\u00a0%');
    expect(c.querySelector('[data-testid="estimate-yield-at-price"]').textContent).toContain('5,1\u00a0%');
    expect(c.querySelector('[data-testid="estimate-drivers"]').textContent).toContain('+0,5 point');
    expect(c.textContent).toContain('Un locataire stable, sans incident');
    expect(c.querySelector('[data-testid="estimate-disclaimer"]').textContent).toBe(RESULT.disclaimer);
    await act(async () => { c.querySelector('[data-testid="estimate-deposit-btn"]').click(); });
    const saved = JSON.parse(sessionStorage.getItem('estimate'));
    expect(saved.inputs).toMatchObject({ property_type: 'appartement', rent_monthly: 780, asking_price: 180000 });
    expect(saved.result).toEqual({ low: 150000, high: 190000, mid: 170000 });
    expect(c.querySelector('[data-testid="page-register"]')).not.toBeNull();
    sessionStorage.clear();
  });

  test('e-mail facultatif : consentement exigé, puis POST /estimates avec email et consent', async () => {
    axiosInstance.post.mockResolvedValue({ data: RESULT });
    const c = await render(<EstimatePage user={null} />, '/estimer');
    await fill(c, 'estimate-type-select', 'parking');
    await fill(c, 'estimate-department-select', '75');
    await fill(c, 'estimate-rent-input', '140');
    await act(async () => { c.querySelector('[data-testid="estimate-form"]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await flush();
    await fill(c, 'estimate-email-input', 'Paul@Exemple.fr');
    await act(async () => { c.querySelector('[data-testid="estimate-email-submit"]').closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(axiosInstance.post).toHaveBeenCalledTimes(1);
    await act(async () => { c.querySelector('[data-testid="estimate-consent"]').click(); });
    await act(async () => { c.querySelector('[data-testid="estimate-email-submit"]').closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await flush();
    expect(axiosInstance.post).toHaveBeenLastCalledWith('/estimates', expect.objectContaining({ property_type: 'parking', lease_type: 'parking', email: 'paul@exemple.fr', consent: true }));
    expect(c.querySelector('[data-testid="estimate-email-sent"]')).not.toBeNull();
  });
});
