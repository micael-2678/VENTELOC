// Mode test côté front (docs/refonte-2026-10/MODE-TEST-ET-APP.md §B.1 et §B.3) : lecture de GET /config, bandeau,
// panneau /test (connexion rapide), raccourcis des parcours (code de signature, second facteur, e-mail).
// Exécution : cd frontend && CI=true npx craco test --watchAll=false src/components/test
import '@/components/shared/jestEnv';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

jest.mock('@/App', () => ({
  axiosInstance: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  API: '/api',
  EMAIL_NOT_VERIFIED_EVENT: 'venteloc:email-not-verified',
}));
jest.mock('@radix-ui/primitive/is-development', () => jest.requireActual('@radix-ui/primitive/dist/internal/is-development.false.js'), { virtual: true });
jest.mock('@/lib/analytics', () => ({ trackEvent: jest.fn(), trackPageView: jest.fn(), initAnalytics: jest.fn() }));
// Gabarit réduit au contenu : l'en-tête commun a ses propres tests
jest.mock('@/components/layout/AppLayout', () => function AppLayoutStub({ children }) { return <main>{children}</main>; });

const { axiosInstance } = require('@/App');
const { resetTestModeCache, isTestMode, loadTestMode, captureTestPanelKey, testPanelHeaders, testModeFromConfig } = require('@/lib/testMode');
const { default: TestModeBanner } = require('@/components/test/TestModeBanner');
const { default: TestModePage, seedSummary, TEST_SCENARIOS } = require('@/pages/TestModePage');
const { DEMO_PERSONAS } = require('@/components/test/testActions');
const { purgeRows, protectedRows } = require('@/components/test/TestAdminTools');
const { default: TestInbox, extractEmailLinks, INBOX_REFRESH_MS } = require('@/components/test/TestInbox');
const { default: OtpSignatureDialog } = require('@/components/OtpSignatureDialog');
const { default: LoginPage } = require('@/pages/LoginPage');
const { default: EmailVerificationBanner } = require('@/components/EmailVerificationBanner');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.scrollTo = jest.fn();
Element.prototype.scrollIntoView = jest.fn();

const mounted = [];
const flush = async () => { await act(async () => { await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); }); };
const render = async (ui, path = '/', routePath = '*', extraRoutes = null) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={routePath} element={ui} />
          {extraRoutes}
        </Routes>
      </MemoryRouter>,
    );
  });
  await flush();
  await flush();
  mounted.push({ root, container });
  return container;
};
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); }); await flush(); };
const setValue = (el, value) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
  act(() => { el.dispatchEvent(new Event('input', { bubbles: true })); });
};
const submit = async (form) => { await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); await flush(); };

// GET /api/config : réponse du serveur selon le mode (et l'accès au panneau de test)
const serveConfig = (testMode, panel = {}) => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({ site_name: 'X', test_mode: testMode, ...panel }) }));
};

beforeEach(() => {
  resetTestModeCache();
  localStorage.clear();
  sessionStorage.clear();
  ['get', 'post', 'put', 'delete'].forEach((m) => axiosInstance[m].mockReset());
});

afterEach(() => {
  mounted.splice(0).forEach(({ root, container }) => { act(() => root.unmount()); container.remove(); });
});

// ------------------------------------------------------------------------------------------------
describe('lib/testMode', () => {
  test('lit /config une seule fois, garde la valeur en session, isTestMode synchrone', async () => {
    serveConfig(true);
    expect(isTestMode()).toBe(false);
    await expect(loadTestMode()).resolves.toBe(true);
    await loadTestMode();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toMatch(/\/api\/config$/);
    expect(isTestMode()).toBe(true);
    expect(JSON.parse(sessionStorage.getItem('venteloc:test_mode'))).toEqual({ testMode: true, panelAccess: true, panelAdmin: true });
  });

  test('accès au panneau lu dans /config (clé TEST_PANEL_KEY)', () => {
    expect(testModeFromConfig({ test_mode: false, test_panel_access: true })).toEqual({ testMode: false, panelAccess: false, panelAdmin: false });
    expect(testModeFromConfig({ test_mode: true })).toEqual({ testMode: true, panelAccess: true, panelAdmin: true });
    expect(testModeFromConfig({ test_mode: true, test_panel_access: false, test_panel_admin: false })).toEqual({ testMode: true, panelAccess: false, panelAdmin: false });
    expect(testModeFromConfig({ test_mode: true, test_panel_access: true, test_panel_admin: false })).toEqual({ testMode: true, panelAccess: true, panelAdmin: false });
  });

  test('clé du panneau : lue dans ?cle=, mémorisée, retirée de l\'adresse, envoyée en X-Test-Key (/config compris)', async () => {
    const replaceState = jest.fn();
    const fakeWindow = { location: { search: '?cle=secret-42&utm_source=wp', pathname: '/test', hash: '' }, history: { state: null, replaceState } };
    expect(captureTestPanelKey(fakeWindow)).toBe('secret-42');
    expect(localStorage.getItem('venteloc:test_panel_key')).toBe('secret-42');
    expect(replaceState).toHaveBeenCalledWith(null, '', '/test?utm_source=wp');
    expect(testPanelHeaders()).toEqual({ 'X-Test-Key': 'secret-42' });
    serveConfig(true, { test_panel_access: true });
    await loadTestMode();
    expect(global.fetch.mock.calls[0][1].headers).toEqual({ 'X-Test-Key': 'secret-42' });
    expect(captureTestPanelKey({ location: { search: '?metier=isolation', pathname: '/' } })).toBe('');
  });

  test('serveur injoignable : pas de mode test', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('réseau')));
    await expect(loadTestMode()).resolves.toBe(false);
    expect(isTestMode()).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------
describe('TestModeBanner', () => {
  test('invisible hors mode test', async () => {
    serveConfig(false);
    const c = await render(<TestModeBanner />);
    expect(c.querySelector('[data-testid="test-mode-banner"]')).toBeNull();
    expect(c.textContent).toBe('');
  });

  test('panneau réservé (clé absente) : « annonces fictives », sans lien vers le panneau', async () => {
    serveConfig(true, { test_panel_protected: true, test_panel_access: false, test_panel_admin: false });
    const c = await render(<TestModeBanner />);
    const banner = c.querySelector('[data-testid="test-mode-banner"]');
    expect(banner.textContent).toContain('Mode test : annonces fictives');
    expect(c.querySelector('[data-testid="test-mode-banner-link"]')).toBeNull();
  });

  test('visible en mode test, avec le lien vers le panneau', async () => {
    serveConfig(true);
    const c = await render(<TestModeBanner />);
    const banner = c.querySelector('[data-testid="test-mode-banner"]');
    expect(banner).not.toBeNull();
    expect(banner.textContent).toContain('Mode test');
    expect(banner.textContent).toContain('identité simulée, e-mails dans la boîte de test, documents sans valeur juridique.');
    expect(c.querySelector('[data-testid="test-mode-banner-link"]').getAttribute('href')).toBe('/test');
  });
});

// ------------------------------------------------------------------------------------------------
describe('TestModePage', () => {
  test('hors mode test : message explicite, pas de connexion rapide', async () => {
    serveConfig(false);
    const c = await render(<TestModePage user={null} setUser={jest.fn()} />, '/test', '/test');
    expect(c.querySelector('[data-testid="test-mode-disabled"]').textContent).toContain("Le mode test n'est pas activé");
    expect(c.querySelector('[data-testid="test-login-vendeur"]')).toBeNull();
    expect(document.head.querySelector('meta[name="robots"]').getAttribute('content')).toContain('noindex');
  });

  test('panneau réservé (clé absente) : aucune connexion rapide, explication', async () => {
    serveConfig(true, { test_panel_protected: true, test_panel_access: false, test_panel_admin: false });
    const c = await render(<TestModePage user={null} setUser={jest.fn()} />, '/test', '/test');
    expect(c.querySelector('[data-testid="test-mode-restricted"]').textContent).toContain('Panneau de test réservé');
    expect(c.querySelector('[data-testid="test-login-vendeur"]')).toBeNull();
    expect(c.querySelector('[data-testid="test-seed"]')).toBeNull();
  });

  test('étapes : préparer, choisir un rôle, scénarios ; admin démo masqué sans accès admin', async () => {
    serveConfig(true, { test_panel_access: true, test_panel_admin: false });
    const c = await render(<TestModePage user={null} setUser={jest.fn()} />, '/test', '/test');
    const steps = Array.from(c.querySelectorAll('h2')).map((h) => h.textContent);
    expect(steps[0]).toMatch(/Étape 1 : Préparer la démonstration$/);
    expect(steps[1]).toMatch(/Étape 2 : Choisir un rôle$/);
    expect(steps[2]).toMatch(/Étape 3 : Essayer les parcours$/);
    expect(c.querySelector('[data-testid="test-seed"]').className).toContain('bg-brand-teal');
    expect(c.querySelector('[data-testid="test-login-admin"]')).toBeNull();
    expect(c.querySelector('[data-testid="test-admin-demo-closed"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="test-scenario-review"]')).toBeNull();
    expect(c.querySelectorAll('[data-testid^="test-scenario-go-"]').length).toBe(5);
    expect(c.textContent).not.toContain('valeur par défaut');
  });

  test('personas VenteLoc : vendeur, acquéreur, admin ; scénarios sans vocabulaire hérité', async () => {
    expect(DEMO_PERSONAS.map((p) => [p.key, p.email, p.role])).toEqual([
      ['vendeur', 'vendeur.demo@test.local', 'Vendeur'],
      ['acquereur', 'acquereur.demo@test.local', 'Acquéreur'],
      ['admin', 'admin.demo@test.local', 'Administration'],
    ]);
    expect(TEST_SCENARIOS.every((sc) => sc.persona === null || DEMO_PERSONAS.some((p) => p.key === sc.persona))).toBe(true);
    serveConfig(true, { test_panel_access: true, test_panel_admin: true });
    const c = await render(<TestModePage user={null} setUser={jest.fn()} />, '/test', '/test');
    ['vendeur', 'acquereur', 'admin'].forEach((key) => expect(c.querySelector(`[data-testid="test-persona-${key}"]`)).not.toBeNull());
    expect(c.querySelector('[data-testid="test-persona-acquereur"]').textContent).toContain('acquereur.demo@test.local');
    expect(c.querySelector('[data-testid="test-scenario-review"]').textContent).toContain('Justificatifs de propriété à contrôler');
    expect(c.querySelector('[data-testid="test-step-seed"]').textContent).toContain('huit annonces de biens loués');
    expect(c.textContent).not.toMatch(/repreneur|cédant|SIRET|entreprise|accord de confidentialité/i);
  });

  test('connexion rapide sans démonstration (404) : comptes créés puis connexion réessayée', async () => {
    serveConfig(true);
    const account = { id: 'u-demo', email: 'acquereur.demo@test.local', role: 'buyer', email_verified: true, identity_verified: true, is_test: true };
    axiosInstance.post
      .mockRejectedValueOnce({ response: { status: 404, data: { detail: { code: 'not_found', message: 'Comptes absents' } } } })
      .mockResolvedValueOnce({ data: { accounts_created: 3, listings_created: 8, password: 'Demo-2026!' } })
      .mockResolvedValueOnce({ data: { token: 'jeton', user: account } });
    const c = await render(<TestModePage user={null} setUser={jest.fn()} />, '/test', '/test',
      <Route path="/buyer/dashboard" element={<p>ESPACE ACQUÉREUR</p>} />);
    await click(c.querySelector('[data-testid="test-login-acquereur"]'));
    expect(axiosInstance.post.mock.calls.map((call) => call[0])).toEqual(['/test/login-as', '/test/seed', '/test/login-as']);
    expect(axiosInstance.post).toHaveBeenLastCalledWith('/test/login-as', { persona: 'acquereur' });
    expect(localStorage.getItem('token')).toBe('jeton');
    expect(c.textContent).toContain('ESPACE ACQUÉREUR');
  });

  test('scénario : « Commencer » connecte au bon compte et ouvre la page du parcours', async () => {
    serveConfig(true);
    const account = { id: 'u-v', email: 'vendeur.demo@test.local', role: 'seller', is_test: true };
    axiosInstance.post.mockResolvedValueOnce({ data: { token: 'jeton-v', user: account } });
    const c = await render(<TestModePage user={null} setUser={jest.fn()} />, '/test', '/test',
      <Route path="/messages" element={<p>MESSAGERIE</p>} />);
    await click(c.querySelector('[data-testid="test-scenario-go-accept"]'));
    expect(axiosInstance.post).toHaveBeenCalledWith('/test/login-as', { persona: 'vendeur' });
    expect(c.textContent).toContain('MESSAGERIE');
  });

  test('compte démo connecté : badge « Connecté » et « Ouvrir mon espace » au lieu de reconnecter', async () => {
    serveConfig(true);
    axiosInstance.get.mockResolvedValue({ data: [], headers: {} });
    const me = { id: 'u-v', email: 'vendeur.demo@test.local', role: 'seller', email_verified: true, identity_verified: true, kyc_provider: 'test' };
    const c = await render(<TestModePage user={me} setUser={jest.fn()} />, '/test', '/test');
    const card = c.querySelector('[data-testid="test-persona-vendeur"]');
    expect(card.querySelector('[data-testid="test-persona-current"]').textContent).toContain('Connecté');
    expect(card.querySelector('[data-testid="test-login-vendeur"]')).toBeNull();
    expect(card.querySelector('[data-testid="test-open-vendeur"]').getAttribute('href')).toBe('/seller/dashboard');
    expect(c.textContent).toContain('Comme si vous aviez passé la vérification d\'identité');
    expect(c.textContent).not.toContain('Stripe');
  });

  test('connexion rapide : POST /test/login-as, jeton et compte stockés comme une connexion, espace du rôle', async () => {
    serveConfig(true);
    const account = { id: 'u-demo', email: 'vendeur.demo@test.local', role: 'seller', email_verified: true, identity_verified: true, is_test: true };
    axiosInstance.post.mockResolvedValueOnce({ data: { token: 'jeton-demo', user: account } });
    const setUser = jest.fn();
    const c = await render(<TestModePage user={null} setUser={setUser} />, '/test', '/test',
      <Route path="/seller/dashboard" element={<p>ESPACE VENDEUR</p>} />);
    expect(c.querySelector('[data-testid="test-signed-out"]')).not.toBeNull();
    await click(c.querySelector('[data-testid="test-login-vendeur"]'));
    expect(axiosInstance.post).toHaveBeenCalledWith('/test/login-as', { persona: 'vendeur' });
    expect(localStorage.getItem('token')).toBe('jeton-demo');
    expect(JSON.parse(localStorage.getItem('user'))).toEqual(account);
    expect(setUser).toHaveBeenCalledWith(account);
    expect(c.textContent).toContain('ESPACE VENDEUR');
  });

  test('création des données de démonstration : mot de passe affiché', async () => {
    serveConfig(true);
    axiosInstance.post.mockResolvedValueOnce({ data: { accounts_created: 3, listings_created: 8, listings_published: 8, listings_total: 8, password: 'Essai-42!' } });
    const c = await render(<TestModePage user={null} setUser={jest.fn()} />, '/test', '/test');
    await click(c.querySelector('[data-testid="test-seed"]'));
    expect(axiosInstance.post).toHaveBeenCalledWith('/test/seed');
    expect(c.querySelector('[data-testid="test-demo-password"]').textContent).toContain('Essai-42!');
  });

  test('connecté : confirmation d\'e-mail et boîte mail de test', async () => {
    serveConfig(true);
    const me = { id: 'u1', email: 'claire@exemple.fr', role: 'buyer', first_name: 'Claire', last_name: 'Martin', email_verified: false, identity_verified: false };
    axiosInstance.get.mockImplementation((url) => {
      if (url === '/test/emails') return Promise.resolve({ data: [{ id: 'e1', to: me.email, from: 'X <noreply@x.fr>', subject: 'Confirmez votre adresse', created_at: '2026-10-10T08:00:00Z' }], headers: { 'x-total-count': '1' } });
      if (url === '/test/emails/e1') return Promise.resolve({ data: { id: 'e1', to: me.email, subject: 'Confirmez votre adresse', html: '<p>Bonjour</p><a href="https://app.exemple.fr/confirmer-email/abc">Confirmer</a>', created_at: '2026-10-10T08:00:00Z' } });
      if (url === '/auth/profile') return Promise.resolve({ data: { ...me, email_verified: true } });
      return Promise.resolve({ data: {} });
    });
    axiosInstance.post.mockResolvedValueOnce({ data: { verified: true, already_verified: false, email: me.email } });
    const setUser = jest.fn();
    const c = await render(<TestModePage user={me} setUser={setUser} />, '/test', '/test');
    expect(c.querySelector('#test-first-name').value).toBe('Claire');
    await click(c.querySelector('[data-testid="test-confirm-email"]'));
    expect(axiosInstance.post).toHaveBeenCalledWith('/test/confirm-email');
    expect(setUser).toHaveBeenCalledWith(expect.objectContaining({ email_verified: true }));
    expect(JSON.parse(localStorage.getItem('user')).email_verified).toBe(true);

    const items = c.querySelectorAll('[data-testid="test-inbox-item"]');
    expect(items.length).toBe(1);
    await click(items[0]);
    const iframe = c.querySelector('[data-testid="test-inbox-iframe"]');
    expect(iframe.getAttribute('sandbox')).toBe('');
    expect(iframe.getAttribute('srcdoc')).toContain('Bonjour');
    expect(c.querySelector('[data-testid="test-inbox-preview"] a[href="https://app.exemple.fr/confirmer-email/abc"]')).not.toBeNull();
    // Pas d'outils d'administration pour un acquéreur
    expect(c.querySelector('[data-testid="test-admin"]')).toBeNull();
  });

  test('admin : purge en deux temps (simulation puis confirmation)', async () => {
    serveConfig(true);
    const admin = { id: 'a1', email: 'admin@exemple.fr', role: 'admin', email_verified: true, identity_verified: true };
    axiosInstance.get.mockResolvedValue({ data: [], headers: {} });
    axiosInstance.post.mockImplementation((url, body, config) => {
      if (url === '/admin/test/purge' && config?.params?.dry_run === true) {
        return Promise.resolve({ data: { dry_run: true, counts: { users: 3, properties: 8, offers: 0 }, total: 11, files: 0 } });
      }
      return Promise.resolve({ data: { dry_run: false, counts: { users: 3, properties: 8 }, total: 11, files: 0 } });
    });
    const c = await render(<TestModePage user={admin} setUser={jest.fn()} />, '/test', '/test');
    await click(c.querySelector('[data-testid="test-purge-dry-run"]'));
    const plan = c.querySelector('[data-testid="test-purge-plan"]');
    expect(plan.textContent).toContain('11 documents de test seront supprimés');
    expect(plan.textContent).toContain('Annonces');
    expect(plan.textContent).not.toContain('Offres');
    await click(c.querySelector('[data-testid="test-purge-confirm"]'));
    expect(axiosInstance.post).toHaveBeenLastCalledWith('/admin/test/purge', null, { params: { dry_run: false } });
    expect(c.querySelector('[data-testid="test-purge-plan"]')).toBeNull();
  });
});

describe('outils du panneau', () => {
  test('résumé du seed sans compteur à zéro', () => {
    expect(seedSummary({ accounts_created: 0, listings_created: 8 })).toBe('Démonstration prête : 8 annonces créées.');
    expect(seedSummary({ created: { users: 1, listings: 0 } })).toBe('Démonstration prête : 1 compte créé.');
    expect(seedSummary({ accounts_created: 0, listings_created: 0 })).toMatch(/déjà en place/);
  });

  test('purge : collections vides masquées, libellés français', () => {
    expect(purgeRows({ users: 2, offers: 0, test_emails: 5 })).toEqual([
      { key: 'users', label: 'Comptes', count: 2 },
      { key: 'test_emails', label: 'E-mails de test', count: 5 },
    ]);
    expect(purgeRows({ contact_reveal_logs: 2 })[0].label).toBe('Journaux d\'identité révélée');
  });

  test('purge : données réelles conservées listées (mandat du registre réel, facture réelle)', () => {
    expect(protectedRows({ generated_contracts: [{ id: 'm1', registry_number: 12 }], invoices: [{ id: 'f1', number: 'FAC-2026-00003' }] }))
      .toEqual([{ key: 'mandat-m1', label: 'Mandat n° 12 (registre réel)' }, { key: 'facture-f1', label: 'Facture FAC-2026-00003' }]);
    expect(protectedRows(undefined)).toEqual([]);
  });

  test('liens de l\'e-mail : http(s) seulement, sans doublon', () => {
    const links = extractEmailLinks('<a href="https://a.fr/x">A</a><a href="https://a.fr/x">A</a><a href="javascript:alert(1)">B</a><a href="mailto:x@y.fr">C</a>');
    expect(links).toEqual([{ href: 'https://a.fr/x', text: 'A' }]);
  });
});

// ------------------------------------------------------------------------------------------------
describe('TestInbox — petit écran et relecture automatique', () => {
  test('ouvrir un e-mail sur petit écran fait défiler jusqu\'à l\'aperçu ; « Retour à la boîte »', async () => {
    const matchMedia = window.matchMedia;
    window.matchMedia = jest.fn(() => ({ matches: false }));
    Element.prototype.scrollIntoView.mockClear();
    try {
      axiosInstance.get.mockImplementation((url) => {
        if (url === '/test/emails') return Promise.resolve({ data: [{ id: 'e1', to: 'a@b.fr', subject: 'Votre code', created_at: '2026-10-10T08:00:00Z' }], headers: { 'x-total-count': '1' } });
        return Promise.resolve({ data: { id: 'e1', to: 'a@b.fr', subject: 'Votre code', html: '<p>123456</p>' } });
      });
      const c = await render(<TestInbox user={{ id: 'u1', email: 'a@b.fr', role: 'buyer' }} />);
      await click(c.querySelector('[data-testid="test-inbox-item"]'));
      expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 1024px)');
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' });
      await click(c.querySelector('[data-testid="test-inbox-back"]'));
      expect(c.querySelector('[data-testid="test-inbox-preview"]')).toBeNull();
    } finally {
      window.matchMedia = matchMedia;
    }
  });

  test('la boîte est relue toutes les 15 s tant que le panneau est affiché', async () => {
    const spy = jest.spyOn(window, 'setInterval');
    try {
      axiosInstance.get.mockResolvedValue({ data: [], headers: {} });
      await render(<TestInbox user={{ id: 'u1', email: 'a@b.fr', role: 'buyer' }} />);
      const timer = spy.mock.calls.find((call) => call[1] === INBOX_REFRESH_MS);
      expect(timer).toBeTruthy();
      const before = axiosInstance.get.mock.calls.filter((call) => call[0] === '/test/emails').length;
      await act(async () => { timer[0](); });
      await flush();
      expect(axiosInstance.get.mock.calls.filter((call) => call[0] === '/test/emails').length).toBe(before + 1);
    } finally {
      spy.mockRestore();
    }
  });
});

// ------------------------------------------------------------------------------------------------
describe('OtpSignatureDialog — code de test', () => {
  const openAndRequest = async (response) => {
    axiosInstance.post.mockResolvedValueOnce({ data: response });
    await render(<OtpSignatureDialog open onClose={() => {}} title="Engagement de confidentialité" contractId="k1" onSign={async () => {}} />);
    const dialog = document.body.querySelector('[data-testid="otp-signature-dialog"]');
    await click(dialog.querySelector('[data-testid="otp-accept"]'));
    await click(dialog.querySelector('[data-testid="otp-request"]'));
    expect(axiosInstance.post).toHaveBeenCalledWith('/signatures/request-code', { contract_id: 'k1' });
    return dialog;
  };

  test('test_code renvoyé : encadré et bouton « Remplir » qui saisit le code', async () => {
    const dialog = await openAndRequest({ destination: 'c***@exemple.fr', expires_in: 600, resend_after: 60, test_code: '482913' });
    expect(dialog.querySelector('[data-testid="otp-test-code"]').textContent).toContain('Code (mode test) : 482913');
    await click(dialog.querySelector('[data-testid="otp-test-fill"]'));
    expect(dialog.querySelector('[data-testid="otp-code"]').value).toBe('482913');
    expect(dialog.querySelector('[data-testid="otp-sign"]').disabled).toBe(false);
  });

  test('sans test_code (hors mode test) : ni encadré ni bouton « Remplir »', async () => {
    const dialog = await openAndRequest({ destination: 'c***@exemple.fr', expires_in: 600, resend_after: 60 });
    expect(dialog.querySelector('[data-testid="otp-sent"]')).not.toBeNull();
    expect(dialog.querySelector('[data-testid="otp-test-code"]')).toBeNull();
    expect(dialog.querySelector('[data-testid="otp-test-fill"]')).toBeNull();
    expect(dialog.querySelector('[data-testid="otp-code"]').value).toBe('');
  });
});

// ------------------------------------------------------------------------------------------------
describe('LoginPage — second facteur en mode test', () => {
  const login = async (response) => {
    axiosInstance.post.mockResolvedValueOnce({ data: response });
    const c = await render(<LoginPage setUser={jest.fn()} />, '/login', '/login');
    setValue(c.querySelector('[data-testid="login-email-input"]'), 'admin@exemple.fr');
    setValue(c.querySelector('[data-testid="login-password-input"]'), 'secret123');
    await submit(c.querySelector('[data-testid="login-form"]'));
    return c;
  };

  test('test_code affiché et prérempli', async () => {
    const c = await login({ otp_required: true, email: 'admin@exemple.fr', expires_in: 600, test_code: '135790' });
    expect(c.querySelector('[data-testid="login-otp-test-code"]').textContent).toContain('135790');
    expect(c.querySelector('[data-testid="login-otp-input"]').value).toBe('135790');
  });

  test('sans test_code : champ vide, aucun encadré', async () => {
    const c = await login({ otp_required: true, email: 'admin@exemple.fr', expires_in: 600 });
    expect(c.querySelector('[data-testid="login-otp-test-code"]')).toBeNull();
    expect(c.querySelector('[data-testid="login-otp-input"]').value).toBe('');
  });
});

// ------------------------------------------------------------------------------------------------
describe('EmailVerificationBanner — confirmation en mode test', () => {
  const user = { id: 'u1', email: 'claire@exemple.fr', role: 'buyer', email_verified: false };

  test('hors mode test : pas de bouton de confirmation immédiate', async () => {
    serveConfig(false);
    const c = await render(<EmailVerificationBanner user={user} setUser={jest.fn()} />);
    expect(c.querySelector('[data-testid="email-verification-banner"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="test-confirm-email-btn"]')).toBeNull();
  });

  test('mode test : « Confirmer maintenant » → POST /test/confirm-email puis compte relu', async () => {
    serveConfig(true);
    axiosInstance.post.mockResolvedValueOnce({ data: { verified: true, already_verified: false, email: user.email } });
    axiosInstance.get.mockResolvedValueOnce({ data: { ...user, email_verified: true } });
    const setUser = jest.fn();
    const c = await render(<EmailVerificationBanner user={user} setUser={setUser} />);
    await click(c.querySelector('[data-testid="test-confirm-email-btn"]'));
    expect(axiosInstance.post).toHaveBeenCalledWith('/test/confirm-email');
    expect(axiosInstance.get).toHaveBeenCalledWith('/auth/profile');
    expect(setUser).toHaveBeenCalledWith(expect.objectContaining({ email_verified: true }));
  });
});

// ------------------------------------------------------------------------------------------------
describe('KYCVerificationButton — vérification simulée', () => {
  const { KYCVerificationButton } = require('@/components/KYCVerification');
  const user = { id: 'u1', email: 'michel@exemple.fr', role: 'seller', first_name: 'Michel', last_name: 'Dupont', identity_verified: false };

  test('hors mode test : seul le parcours Stripe est proposé', async () => {
    serveConfig(false);
    const c = await render(<KYCVerificationButton user={user} />);
    await click(c.querySelector('button'));
    expect(document.body.textContent).toContain('Commencer la vérification');
    expect(document.body.querySelector('[data-testid="kyc-simulate-btn"]')).toBeNull();
  });

  test('mode test : « Simuler la vérification » → POST /test/identity/simulate puis profil relu', async () => {
    serveConfig(true);
    axiosInstance.post.mockResolvedValueOnce({ data: { verified: true, kyc_provider: 'test', user: { ...user, identity_verified: true }, listings: [] } });
    axiosInstance.get.mockResolvedValueOnce({ data: { ...user, identity_verified: true, kyc_provider: 'test' } });
    const c = await render(<KYCVerificationButton user={user} />);
    await click(c.querySelector('button'));
    await click(document.body.querySelector('[data-testid="kyc-simulate-btn"]'));
    expect(axiosInstance.post).toHaveBeenCalledWith('/test/identity/simulate', {});
    expect(axiosInstance.get).toHaveBeenCalledWith('/auth/profile');
    expect(JSON.parse(localStorage.getItem('user')).identity_verified).toBe(true);
    expect(document.body.querySelector('[data-testid="kyc-simulated"]')).not.toBeNull();
  });
});
