// Tests des pages de compte VenteLoc : composants de compte, connexion (second facteur), inscription (vendeur sans
// SIRET, acquéreur avec profil d'investisseur et score SPEC §4), confirmation d'e-mail, bandeau, profil. Exécution :
// cd frontend && CI=true npx craco test --watchAll=false src/components/account
import '../../shared/jestEnv';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

jest.mock('@/App', () => ({
  axiosInstance: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  API: '/api',
  EMAIL_NOT_VERIFIED_EVENT: 'cession:email-not-verified',
}));

// Radix Dialog (exports « exports » non résolus par Jest 27) : remplacé par des conteneurs simples
jest.mock('@/components/ui/dialog', () => {
  const Pass = ({ children }) => <div>{children}</div>;
  return {
    Dialog: ({ open, children }) => (open ? <div data-testid="dialog">{children}</div> : null),
    DialogContent: Pass, DialogHeader: Pass, DialogTitle: Pass, DialogDescription: Pass, DialogFooter: Pass, DialogTrigger: Pass,
  };
});

const { axiosInstance } = require('@/App');
const { default: ChoiceGroup } = require('../ChoiceGroup');
const { computeProfileScore, buyerProfilePayload, buyerProfileFromUser, SCORE_WEIGHTS } = require('../profileScore');
const { formatSiret, cleanSiret, formatSiren } = require('../siret');
const { default: BuyerProfileFields } = require('../BuyerProfileFields');
const { apiErrorMessage, isEmailNotVerifiedError } = require('../errors');
const { default: EmailVerificationBanner } = require('@/components/EmailVerificationBanner');
const { default: LoginPage } = require('@/pages/LoginPage');
const { default: RegisterPage } = require('@/pages/RegisterPage');
const { default: ConfirmEmailPage } = require('@/pages/ConfirmEmailPage');
const { default: ProfilePage } = require('@/pages/ProfilePage');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted = [];
const render = (ui) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  mounted.push({ root, container });
  return container;
};
const withRouter = (ui, initial = '/') => render(<MemoryRouter initialEntries={[initial]}>{ui}</MemoryRouter>);
const setInput = (el, value) => act(() => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
    : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
});
const click = (el) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
const submit = (form) => act(() => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const okResponse = (data = {}) => Promise.resolve({ ok: true, status: 200, json: async () => data });
// Noms des événements envoyés à POST /api/events (les autres appels fetch, comme legal-info, n'ont pas de corps)
const sentEvents = () => global.fetch.mock.calls.filter((call) => call[1]?.body).map((call) => JSON.parse(call[1].body).name);
const apiError = (status, detail) => Object.assign(new Error('api'), { response: { status, data: { detail } } });

beforeEach(() => {
  global.fetch = jest.fn(() => okResponse({}));
  window.scrollTo = jest.fn();
  sessionStorage.clear();
  localStorage.clear();
  ['get', 'post', 'put', 'delete'].forEach((m) => axiosInstance[m].mockReset());
});

afterEach(() => {
  mounted.splice(0).forEach(({ root, container }) => {
    act(() => root.unmount());
    container.remove();
  });
});

// ------------------------------------------------------------------------------------------------
describe('outils de compte', () => {
  test('score de profil : barème SPEC §4 (100 points, SIREN sans points)', () => {
    expect(SCORE_WEIGHTS.reduce((n, w) => n + w.points, 0)).toBe(100);
    expect(SCORE_WEIGHTS.map((w) => [w.key, w.points])).toEqual([
      ['project_type', 15], ['budget_max', 15], ['apport', 10], ['financing', 10], ['zones', 10],
      ['property_types', 10], ['min_yield', 10], ['horizon', 10], ['phone', 10],
    ]);
    const empty = computeProfileScore({}, '');
    expect(empty.score).toBe(0);
    expect(empty.missing).toHaveLength(9);
    const full = computeProfileScore({
      project_type: 'particulier', budget_max: '250000', apport: '50000', financing: 'mixte', zones: ['Bretagne'],
      property_types: ['appartement'], min_yield: '5,5', horizon: '0-6', siren: '123456789', siren_verified: true,
    }, '06 12 34 56 78');
    expect(full.score).toBe(100);
    expect(full.missing).toEqual([]);
    // Projet + budget = 30 ; rendement 0 ne compte pas ; une liste vide non plus
    expect(computeProfileScore({ project_type: 'sci', budget_max: '1', min_yield: '0', zones: [] }, '').score).toBe(30);
    expect(computeProfileScore({ min_yield: 6 }, '0612345678').score).toBe(20);
  });

  test('buyerProfilePayload / buyerProfileFromUser : nombres, listes, rendement borné à 0-20 %', () => {
    expect(buyerProfilePayload({ budget_max: '300 000', apport: '', zones: ['Bretagne'], min_yield: '5,5', siren: '123 456 789', experience: ' x ' }))
      .toMatchObject({ budget_max: 300000, apport: null, zones: ['Bretagne'], property_types: [], min_yield: 5.5, siren: '123456789', experience: 'x' });
    expect(buyerProfilePayload({ min_yield: '35' }).min_yield).toBe(20);
    expect(buyerProfilePayload({}).min_yield).toBeNull();
    expect(buyerProfilePayload({ trades: ['isolation'] })).not.toHaveProperty('trades');
    expect(buyerProfileFromUser({ min_yield: 6.5, property_types: ['maison'], budget_max: 200000, siren_verified: true }))
      .toMatchObject({ min_yield: '6,5', property_types: ['maison'], budget_max: '200000', siren_verified: true });
  });

  test('SIRET / SIREN : nettoyage et format', () => {
    expect(cleanSiret('123 456 789 00012x')).toBe('12345678900012');
    expect(formatSiret('12345678900012')).toBe('123 456 789 00012');
    expect(formatSiren('123456789')).toBe('123 456 789');
  });

  test('erreurs API : chaîne, {code, message}, validation, 403 e-mail non confirmé', () => {
    expect(apiErrorMessage(apiError(400, 'Mot de passe incorrect'))).toBe('Mot de passe incorrect');
    expect(apiErrorMessage(apiError(403, { code: 'profile_incomplete', message: 'Profil incomplet' }))).toBe('Profil incomplet');
    expect(apiErrorMessage(apiError(422, [{ msg: 'champ requis' }]))).toBe('champ requis');
    expect(apiErrorMessage(apiError(429, undefined))).toMatch(/Trop de demandes/);
    expect(isEmailNotVerifiedError(apiError(403, { code: 'email_not_verified' }))).toBe(true);
    expect(isEmailNotVerifiedError(apiError(403, "Confirmez d'abord votre adresse e-mail"))).toBe(true);
    expect(isEmailNotVerifiedError(apiError(403, 'Accès refusé'))).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------
describe('BuyerProfileFields', () => {
  test('types de biens, rendement minimum, SIREN seulement pour un achat en société', () => {
    let value = {};
    const Wrapper = () => {
      const [v, setV] = require('react').useState({ ...require('../profileScore').EMPTY_BUYER_PROFILE });
      value = v;
      return <BuyerProfileFields value={v} onChange={setV} />;
    };
    const c = render(<Wrapper />);
    const text = c.textContent;
    ['Investisseur particulier', 'Achat via une SCI', 'Comptant', 'Emprunt bancaire', 'Appartement', 'Immeuble', 'Local commercial', 'Rendement brut minimum visé', 'Sous 6 mois']
      .forEach((t) => expect(text).toContain(t));
    expect(text).not.toMatch(/métier|repreneur|cédant/i);
    expect(text).not.toMatch(/\bRGE\b/);
    expect(c.querySelector('[data-testid="buyer-company-fields"]')).toBeNull();
    click(c.querySelector('[data-testid="buyer-property-types-appartement"]'));
    click(c.querySelector('[data-testid="buyer-property-types-parking"]'));
    setInput(c.querySelector('[data-testid="buyer-min-yield"]'), '6.5');
    expect(value.property_types).toEqual(['appartement', 'parking']);
    expect(value.min_yield).toBe('6,5');
    setInput(c.querySelector('[data-testid="buyer-min-yield"]'), '45');
    expect(value.min_yield).toBe('20');
    click(c.querySelector('[data-testid="buyer-project-type-sci"]'));
    expect(c.querySelector('[data-testid="buyer-company-fields"]')).not.toBeNull();
    setInput(c.querySelector('[data-testid="buyer-siren"]'), '123 456 789');
    expect(value.siren).toBe('123456789');
  });
});

// ------------------------------------------------------------------------------------------------
describe('ChoiceGroup — choix multiples très visibles', () => {
  test('coche, récapitulatif et désélection', () => {
    let value = [];
    const Wrapper = () => {
      const [v, setV] = require('react').useState([]);
      value = v;
      return <ChoiceGroup legend="Zones" name="zones" multiple options={[{ value: 'a', label: 'Alsace' }, { value: 'b', label: 'Bretagne' }]} value={v} onChange={setV} testId="zones" />;
    };
    const c = render(<Wrapper />);
    expect(c.textContent).toContain('plusieurs choix possibles');
    click(c.querySelector('[data-testid="zones-a"]'));
    click(c.querySelector('[data-testid="zones-b"]'));
    expect(value).toEqual(['a', 'b']);
    expect(c.textContent).toContain('2 sélectionnés : Alsace, Bretagne');
    const label = c.querySelector('label[for$="zones-a"]');
    expect(label.className).toContain('bg-brand-navy');
    click(c.querySelector('[data-testid="zones-a"]'));
    expect(value).toEqual(['b']);
  });
});

// ------------------------------------------------------------------------------------------------
describe('EmailVerificationBanner', () => {
  test('absent quand l\'adresse est confirmée, renvoi avec compte à rebours', async () => {
    expect(withRouter(<EmailVerificationBanner user={{ email: 'a@b.fr', email_verified: true }} />).textContent).toBe('');
    axiosInstance.post.mockResolvedValue({ data: { sent: true } });
    const c = withRouter(<EmailVerificationBanner user={{ email: 'a@b.fr', email_verified: false }} />);
    expect(c.textContent).toContain('Confirmez votre adresse e-mail');
    expect(c.textContent).toContain('a@b.fr');
    click(c.querySelector('[data-testid="resend-verification-btn"]'));
    await flush();
    expect(axiosInstance.post).toHaveBeenCalledWith('/auth/resend-verification');
    const btn = c.querySelector('[data-testid="resend-verification-btn"]');
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toMatch(/Renvoyer dans \d+ s/);
  });
});

// ------------------------------------------------------------------------------------------------
describe('LoginPage — second facteur administrateur', () => {
  test('otp_required → champ code → /auth/login/verify', async () => {
    axiosInstance.post.mockResolvedValueOnce({ data: { otp_required: true, email: 'admin@b.fr', expires_in: 600, resent: true } });
    const setUser = jest.fn();
    const c = withRouter(<Routes><Route path="/login" element={<LoginPage setUser={setUser} />} /><Route path="/admin/dashboard" element={<p>ADMIN</p>} /></Routes>, '/login');
    setInput(c.querySelector('[data-testid="login-email-input"]'), 'admin@b.fr');
    setInput(c.querySelector('[data-testid="login-password-input"]'), 'secret123');
    submit(c.querySelector('[data-testid="login-form"]'));
    await flush();
    expect(c.querySelector('[data-testid="login-otp-input"]')).not.toBeNull();
    expect(c.textContent).toContain('admin@b.fr');
    axiosInstance.post.mockResolvedValueOnce({ data: { token: 'tok', user: { email: 'admin@b.fr', role: 'admin', email_verified: true } } });
    setInput(c.querySelector('[data-testid="login-otp-input"]'), '123456');
    submit(c.querySelector('[data-testid="login-otp-form"]'));
    await flush();
    expect(axiosInstance.post).toHaveBeenLastCalledWith('/auth/login/verify', { email: 'admin@b.fr', code: '123456' });
    expect(localStorage.getItem('token')).toBe('tok');
    expect(setUser).toHaveBeenCalledWith(expect.objectContaining({ role: 'admin' }));
    expect(c.textContent).toContain('ADMIN');
  });
});

// ------------------------------------------------------------------------------------------------
describe('RegisterPage', () => {
  test('?role=buyer : profil d\'investisseur et score sur un écran, puis « Vérifiez votre boîte mail »', async () => {
    axiosInstance.post.mockResolvedValue({ data: { token: 'tok', user: { email: 'r@b.fr', role: 'buyer', email_verified: false, profile_score: 85 } } });
    const setUser = jest.fn();
    const c = withRouter(<RegisterPage setUser={setUser} />, '/register?role=buyer');
    expect(c.querySelector('[data-testid="buyer-profile-fields"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="profile-score-value"]').textContent).toBe('Profil d\'investisseur à compléter');
    expect(c.textContent).not.toMatch(/repreneur|cédant|entreprise|SIRET/i);
    setInput(c.querySelector('[data-testid="register-first-name-input"]'), 'Claire');
    setInput(c.querySelector('[data-testid="register-last-name-input"]'), 'Martin');
    setInput(c.querySelector('[data-testid="register-email-input"]'), 'r@b.fr');
    setInput(c.querySelector('[data-testid="register-password-input"]'), 'motdepasse');
    setInput(c.querySelector('[data-testid="register-phone-input"]'), '06 12 34 56 78');
    click(c.querySelector('[data-testid="buyer-project-type-particulier"]'));
    click(c.querySelector('[data-testid="buyer-financing-mixte"]'));
    click(c.querySelector('[data-testid="buyer-zones-Bretagne"]'));
    click(c.querySelector('[data-testid="buyer-property-types-appartement"]'));
    click(c.querySelector('[data-testid="buyer-horizon-0-6"]'));
    setInput(c.querySelector('input[id$="-budget"]'), '250000');
    setInput(c.querySelector('[data-testid="buyer-min-yield"]'), '5,5');
    // 15 + 15 + 10 + 10 + 10 + 10 + 10 + téléphone 10 = 90 (apport manquant)
    expect(c.querySelector('[data-testid="profile-score-value"]').textContent).toBe('90 %');
    submit(c.querySelector('[data-testid="register-form"]'));
    await flush();
    expect(axiosInstance.post.mock.calls[0][0]).toBe('/auth/register');
    const body = axiosInstance.post.mock.calls[0][1];
    expect(body).toMatchObject({ role: 'buyer', email: 'r@b.fr', first_name: 'Claire', phone: '06 12 34 56 78' });
    expect(body.buyer_profile).toEqual({
      project_type: 'particulier', budget_max: 250000, apport: null, financing: 'mixte', zones: ['Bretagne'],
      property_types: ['appartement'], min_yield: 5.5, horizon: '0-6',
    });
    expect(body).not.toHaveProperty('siret');
    expect(setUser).toHaveBeenCalledWith(expect.objectContaining({ email_verified: false }));
    expect(c.querySelector('[data-testid="register-done"]').textContent).toContain('Vérifiez votre boîte mail');
    expect(c.querySelector('[data-testid="profile-score-value"]').textContent).toBe('85 %');
    expect(sentEvents()).toEqual(expect.arrayContaining(['register_started', 'register_completed']));
  });

  test('acquéreur : type de projet et budget obligatoires', async () => {
    const c = withRouter(<RegisterPage setUser={jest.fn()} />, '/register?role=buyer');
    setInput(c.querySelector('[data-testid="register-first-name-input"]'), 'Claire');
    setInput(c.querySelector('[data-testid="register-last-name-input"]'), 'Martin');
    setInput(c.querySelector('[data-testid="register-email-input"]'), 'r@b.fr');
    setInput(c.querySelector('[data-testid="register-password-input"]'), 'motdepasse');
    setInput(c.querySelector('[data-testid="register-phone-input"]'), '0612345678');
    submit(c.querySelector('[data-testid="register-form"]'));
    await flush();
    expect(axiosInstance.post).not.toHaveBeenCalled();
    expect(c.textContent).toContain('Indiquez le type de votre projet.');
    expect(c.textContent).toContain('Indiquez un budget maximum.');
  });

  test('?role=seller : prénom, nom, e-mail, mot de passe, téléphone, plus de SIRET', async () => {
    axiosInstance.post.mockResolvedValue({ data: { token: 'tok', user: { email: 'v@b.fr', role: 'seller', email_verified: false } } });
    const c = withRouter(<RegisterPage setUser={jest.fn()} />, '/register?role=seller');
    expect(c.querySelector('[data-testid="buyer-profile-fields"]')).toBeNull();
    expect(c.querySelector('[data-testid="register-siret-input"]')).toBeNull();
    expect(c.querySelector('[data-testid="register-seller-info"]').textContent).toContain('SCI');
    expect(c.textContent).toContain('Je vends un bien loué');
    expect(c.textContent).not.toMatch(/repreneur|cédant|entreprise/i);
    expect(c.textContent).not.toMatch(/\bRGE\b/);
    setInput(c.querySelector('[data-testid="register-first-name-input"]'), 'Michel');
    setInput(c.querySelector('[data-testid="register-last-name-input"]'), 'Dupont');
    setInput(c.querySelector('[data-testid="register-email-input"]'), 'V@B.fr');
    setInput(c.querySelector('[data-testid="register-password-input"]'), 'motdepasse');
    setInput(c.querySelector('[data-testid="register-phone-input"]'), '06 12 34 56 78');
    submit(c.querySelector('[data-testid="register-form"]'));
    await flush();
    expect(axiosInstance.post).toHaveBeenCalledWith('/auth/register', {
      email: 'v@b.fr', password: 'motdepasse', role: 'seller', first_name: 'Michel', last_name: 'Dupont', phone: '06 12 34 56 78',
    });
    expect(c.querySelector('[data-testid="register-done"]')).not.toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------
describe('ConfirmEmailPage', () => {
  test('succès : compte local marqué confirmé', async () => {
    localStorage.setItem('token', 'tok');
    localStorage.setItem('user', JSON.stringify({ email: 'a@b.fr', role: 'buyer', email_verified: false }));
    axiosInstance.post.mockResolvedValueOnce({ data: { verified: true, email: 'a@b.fr', role: 'buyer' } });
    axiosInstance.get.mockResolvedValueOnce({ data: { email: 'a@b.fr', role: 'buyer', email_verified: true } });
    const setUser = jest.fn();
    const c = withRouter(<Routes><Route path="/confirmer-email/:token" element={<ConfirmEmailPage user={null} setUser={setUser} />} /></Routes>, '/confirmer-email/abcdefghijklmnop');
    await flush();
    expect(axiosInstance.post).toHaveBeenCalledWith('/auth/verify-email', { token: 'abcdefghijklmnop' });
    expect(c.textContent).toContain('Adresse confirmée');
    expect(setUser).toHaveBeenCalledWith(expect.objectContaining({ email_verified: true }));
    expect(JSON.parse(localStorage.getItem('user')).email_verified).toBe(true);
  });

  test('lien expiré : renvoi possible pour un utilisateur connecté', async () => {
    axiosInstance.post.mockRejectedValueOnce(apiError(400, 'Lien de confirmation expiré : demandez un nouvel e-mail de confirmation'));
    const c = withRouter(<Routes><Route path="/confirmer-email/:token" element={<ConfirmEmailPage user={{ email: 'a@b.fr', role: 'buyer', email_verified: false }} setUser={jest.fn()} />} /></Routes>, '/confirmer-email/abcdefghijklmnop');
    await flush();
    expect(c.textContent).toContain('Lien expiré');
    axiosInstance.post.mockResolvedValueOnce({ data: { sent: true } });
    click(c.querySelector('[data-testid="confirm-email-resend"]'));
    await flush();
    expect(axiosInstance.post).toHaveBeenLastCalledWith('/auth/resend-verification');
  });
});

// ------------------------------------------------------------------------------------------------
describe('ProfilePage', () => {
  test('acquéreur : projet d\'investissement modifiable, export, aucune pièce envoyée', async () => {
    const user = {
      email: 'r@b.fr', role: 'buyer', email_verified: true, first_name: 'Claire', last_name: 'Martin', phone: '0612345678',
      buyer_profile: { project_type: 'particulier', budget_max: 200000, zones: ['Bretagne'] }, profile_score: 50, created_at: '2026-10-01T00:00:00Z',
    };
    axiosInstance.get.mockImplementation((url) => {
      if (url === '/auth/profile') return Promise.resolve({ data: user });
      if (url === '/kyc/status') return Promise.resolve({ data: { verified: false, status: 'not_started' } });
      if (url === '/auth/export') return Promise.resolve({ data: { account: user } });
      return Promise.reject(new Error(url));
    });
    axiosInstance.put.mockResolvedValue({ data: { user: { ...user, profile_score: 70, buyer_profile: { ...user.buyer_profile, horizon: '0-6', min_yield: 6 } } } });
    const c = withRouter(<ProfilePage user={user} setUser={jest.fn()} />, '/profile');
    await flush();
    expect(c.querySelector('[data-testid="kyc-upload-form"]')).toBeNull();
    expect(c.textContent).toContain('engagement de confidentialité');
    expect(c.textContent).toContain('Mon projet d\'investissement');
    expect(c.textContent).toContain('Acquéreur');
    expect(c.textContent).not.toMatch(/repreneur|cédant|accord de confidentialité/i);
    expect(c.querySelector('[data-testid="profile-score-value"]').textContent).toBe('50 %');
    expect(c.querySelector('[data-testid="profile-export-btn"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="profile-delete-btn"]')).not.toBeNull();
    click(c.querySelector('[data-testid="buyer-horizon-0-6"]'));
    setInput(c.querySelector('[data-testid="buyer-min-yield"]'), '6');
    click(c.querySelector('[data-testid="profile-save-buyer"]'));
    await flush();
    expect(axiosInstance.put).toHaveBeenCalledWith('/auth/profile', expect.objectContaining({
      phone: '0612345678',
      buyer_profile: expect.objectContaining({ horizon: '0-6', min_yield: 6, zones: ['Bretagne'], property_types: [] }),
    }));
    expect(c.querySelector('[data-testid="profile-score-value"]').textContent).toBe('70 %');
  });

  test('vendeur : coordonnées sans SIRET, identité demandée avant le mandat', async () => {
    const user = { email: 'v@b.fr', role: 'seller', email_verified: true, first_name: 'Michel', last_name: 'Dupont', phone: '0612345678', created_at: '2026-10-01T00:00:00Z' };
    axiosInstance.get.mockImplementation((url) => {
      if (url === '/auth/profile') return Promise.resolve({ data: user });
      if (url === '/kyc/status') return Promise.resolve({ data: { verified: false, status: 'not_started' } });
      return Promise.reject(new Error(url));
    });
    axiosInstance.put.mockResolvedValue({ data: user });
    const c = withRouter(<ProfilePage user={user} setUser={jest.fn()} />, '/profile');
    await flush();
    expect(c.querySelector('[data-testid="buyer-profile-section"]')).toBeNull();
    expect(c.querySelector('[data-testid="profile-siret-input"]')).toBeNull();
    expect(c.textContent).toContain('Vendeur');
    expect(c.textContent).toContain('mandat');
    click(c.querySelector('[data-testid="profile-save-identity"]'));
    await flush();
    expect(axiosInstance.put).toHaveBeenCalledWith('/auth/profile', { first_name: 'Michel', last_name: 'Dupont', phone: '0612345678' });
  });
});
