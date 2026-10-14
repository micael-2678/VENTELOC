// Tests du chantier « compte-estimateur » : composants de compte, estimateur, connexion (second facteur),
// inscription (profil repreneur + score), confirmation d'e-mail, bandeau. Exécution :
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
const { computeProfileScore, buyerProfilePayload } = require('../profileScore');
const { normalizeCompanyLookup, formatSiret, cleanSiret } = require('../siret');
const { apiErrorMessage, isEmailNotVerifiedError } = require('../errors');
const { default: EmailVerificationBanner } = require('@/components/EmailVerificationBanner');
const { default: LoginPage } = require('@/pages/LoginPage');
const { default: RegisterPage } = require('@/pages/RegisterPage');
const { default: EstimatePage } = require('@/pages/EstimatePage');
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
  test('score de profil : barème API.md §1, SIREN vérifié uniquement côté serveur', () => {
    const empty = computeProfileScore({}, '');
    expect(empty.score).toBe(0);
    expect(empty.missing).toHaveLength(9);
    const full = computeProfileScore({ project_type: 'reprise-individuelle', budget_max: '300000', apport: '80000', financing: 'mixte', zones: ['Bretagne'], trades: ['isolation'], horizon: '0-6', siren: '123456789' }, '06 12 34 56 78');
    expect(full.score).toBe(90);
    expect(full.missing.map((m) => m.key)).toEqual(['siren_verified']);
    expect(computeProfileScore({ project_type: 'autre', budget_max: '1' }, '').score).toBe(30);
    expect(buyerProfilePayload({ budget_max: '300 000', apport: '', zones: ['Bretagne'], siren: '123 456 789', experience: ' x ' }))
      .toMatchObject({ budget_max: 300000, apport: null, zones: ['Bretagne'], trades: [], siren: '123456789', experience: 'x' });
  });

  test('SIRET : nettoyage, format, normalisation des deux formes de réponse', () => {
    expect(cleanSiret('123 456 789 00012x')).toBe('12345678900012');
    expect(formatSiret('12345678900012')).toBe('123 456 789 00012');
    const a = normalizeCompanyLookup({ siret: '12345678900012', company: { available: true, found: true, company_name: 'DUPONT SAS', naf_code: '43.22A', staff_count: 7, department: '29', region: 'Bretagne' }, rge: { found: true, details: [{ nom_qualification: 'QualiPAC', organisme: "Qualit'EnR", lien_date_fin: '2027-03-01' }] } });
    expect(a.company).toMatchObject({ found: true, name: 'DUPONT SAS', naf: '43.22A', staffCount: 7, department: '29' });
    expect(a.rge.qualifications[0]).toMatchObject({ name: 'QualiPAC', organisme: "Qualit'EnR", dateFin: '2027-03-01' });
    const b = normalizeCompanyLookup({ company: { available: true, nom_complet: 'MARTIN', naf: '43.21A', tranche_effectif: '6 à 9 salariés', departement: '35' }, rge: { qualifications: ['Qualibat'] } }, '12345678900012');
    expect(b.company).toMatchObject({ found: true, name: 'MARTIN', naf: '43.21A', staffLabel: '6 à 9 salariés' });
    expect(b.rge.found).toBe(true);
    const c = normalizeCompanyLookup({ company: { available: false }, rge: { available: false } }, '12345678900012');
    expect(c.company.available).toBe(false);
    expect(c.rge.available).toBe(false);
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
  test('?role=buyer : un seul écran avec le profil de projet, score, puis « Vérifiez votre boîte mail »', async () => {
    axiosInstance.post.mockResolvedValue({ data: { token: 'tok', user: { email: 'r@b.fr', role: 'buyer', email_verified: false, profile_score: 55 } } });
    const setUser = jest.fn();
    const c = withRouter(<RegisterPage setUser={setUser} />, '/register?role=buyer');
    expect(c.querySelector('[data-testid="buyer-profile-fields"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="profile-score-value"]').textContent).toBe('Profil de projet à compléter');
    setInput(c.querySelector('[data-testid="register-first-name-input"]'), 'Claire');
    setInput(c.querySelector('[data-testid="register-last-name-input"]'), 'Martin');
    setInput(c.querySelector('[data-testid="register-email-input"]'), 'r@b.fr');
    setInput(c.querySelector('[data-testid="register-password-input"]'), 'motdepasse');
    setInput(c.querySelector('[data-testid="register-phone-input"]'), '06 12 34 56 78');
    click(c.querySelector('[data-testid="buyer-project-type-reprise-individuelle"]'));
    click(c.querySelector('[data-testid="buyer-zones-Bretagne"]'));
    click(c.querySelector('[data-testid="buyer-horizon-0-6"]'));
    const budget = c.querySelector('input[id$="-budget"]');
    setInput(budget, '300000');
    expect(c.querySelector('[data-testid="profile-score-value"]').textContent).toBe('60 %');
    submit(c.querySelector('[data-testid="register-form"]'));
    await flush();
    const body = axiosInstance.post.mock.calls[0][1];
    expect(axiosInstance.post.mock.calls[0][0]).toBe('/auth/register');
    expect(body).toMatchObject({ role: 'buyer', email: 'r@b.fr', first_name: 'Claire', phone: '06 12 34 56 78' });
    expect(body.buyer_profile).toMatchObject({ project_type: 'reprise-individuelle', budget_max: 300000, zones: ['Bretagne'], horizon: '0-6', trades: [] });
    expect(setUser).toHaveBeenCalledWith(expect.objectContaining({ email_verified: false }));
    expect(c.querySelector('[data-testid="register-done"]').textContent).toContain('Vérifiez votre boîte mail');
    expect(c.querySelector('[data-testid="profile-score-value"]').textContent).toBe('55 %');
    expect(sentEvents()).toEqual(expect.arrayContaining(['register_started', 'register_completed']));
  });

  test('?role=seller : SIRET facultatif, préremplissage open data, « vérification différée » si indisponible', async () => {
    axiosInstance.get.mockResolvedValueOnce({ data: { siret: '12345678900012', company: { available: true, found: true, company_name: 'DUPONT SAS', staff_count: 7 }, rge: { found: true, details: [{ nom_qualification: 'QualiPAC', organisme: "Qualit'EnR" }] } } });
    const c = withRouter(<RegisterPage setUser={jest.fn()} />, '/register?role=seller');
    expect(c.querySelector('[data-testid="buyer-profile-fields"]')).toBeNull();
    setInput(c.querySelector('[data-testid="register-siret-input"]'), '12345678900012');
    await flush();
    expect(axiosInstance.get).toHaveBeenCalledWith('/estimates/company/12345678900012');
    expect(c.querySelector('[data-testid="register-company-input"]').value).toBe('DUPONT SAS');
    expect(c.textContent).toContain('RGE vérifié ADEME');
    expect(c.textContent).toContain('QualiPAC');
    // Annuaire indisponible : jamais bloquant
    axiosInstance.get.mockRejectedValueOnce(new Error('réseau'));
    setInput(c.querySelector('[data-testid="register-siret-input"]'), '98765432100012');
    await flush();
    expect(c.textContent).toContain('Vérification différée');
    expect(c.querySelector('[data-testid="register-submit-btn"]').disabled).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------
describe('EstimatePage', () => {
  const result = {
    low: 180000, high: 260000, mid: 220000, method: 'Fourchette combinée', method_code: 'ca_ebe',
    drivers: [{ key: 'maintenance_contracts', label: "Contrats d'entretien récurrents", active: true, effect: 5, effect_label: '+5 %', hint: 'ok' }],
    pedagogy: ['Un carnet de commandes signé se valorise.'], disclaimer: 'Estimation indicative.', rge: { found: false },
  };

  test('sans SIRET : chiffres → fourchette → sessionStorage et redirection vers l\'inscription', async () => {
    axiosInstance.post.mockResolvedValueOnce({ data: result });
    const c = withRouter(<Routes><Route path="/estimer" element={<EstimatePage user={null} />} /><Route path="/register" element={<p>REGISTER</p>} /></Routes>, '/estimer');
    expect(c.querySelector('h1').textContent).toContain('Estimer mon entreprise');
    submit(c.querySelector('[data-testid="estimate-step-siret"]'));
    expect(c.querySelector('[data-testid="estimate-step-figures"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="estimate-submit"]').disabled).toBe(true);
    setInput(c.querySelector('[data-testid="estimate-ca-input"]'), '450000');
    setInput(c.querySelector('[data-testid="estimate-ebe-input"]'), '60000');
    setInput(c.querySelector('[data-testid="estimate-staff-input"]'), '4');
    click(c.querySelector('[data-testid="estimate-driver-maintenance_contracts"]'));
    submit(c.querySelector('[data-testid="estimate-step-figures"]'));
    await flush();
    expect(axiosInstance.post).toHaveBeenCalledWith('/estimates', expect.objectContaining({ siret: null, ca: 450000, ebe: 60000, staff: 4, maintenance_contracts: true, team_stays: false }));
    expect(c.querySelector('[data-testid="estimate-result"]').textContent).toMatch(/180\s?000\s?€ à 260\s?000\s?€/);
    expect(c.textContent).toContain('Ce qui fait monter la valeur');
    expect(sentEvents()).toEqual(expect.arrayContaining(['estimate_started', 'estimate_completed']));
    click(c.querySelector('[data-testid="estimate-deposit-btn"]'));
    const saved = JSON.parse(sessionStorage.getItem('estimate'));
    expect(saved).toMatchObject({ siret: '', ca: 450000, ebe: 60000, staff: 4, low: 180000, high: 260000 });
    expect(c.textContent).toContain('REGISTER');
  });

  test('e-mail facultatif (double opt-in) et paramètre ?confirmation=', async () => {
    const c = withRouter(<EstimatePage user={{ role: 'seller', email: 's@b.fr' }} />, '/estimer?confirmation=expire');
    expect(c.querySelector('[data-testid="estimate-confirmation"]').textContent).toContain('expiré');
    submit(c.querySelector('[data-testid="estimate-step-siret"]'));
    setInput(c.querySelector('[data-testid="estimate-ca-input"]'), '300000');
    axiosInstance.post.mockResolvedValueOnce({ data: result });
    submit(c.querySelector('[data-testid="estimate-step-figures"]'));
    await flush();
    axiosInstance.post.mockResolvedValueOnce({ data: { ...result, email: { confirmation_required: true, email_sent: true } } });
    setInput(c.querySelector('[data-testid="estimate-email-input"]'), 'Moi@Entreprise.fr');
    click(c.querySelector('[data-testid="estimate-email-submit"]'));
    await flush();
    expect(axiosInstance.post).toHaveBeenLastCalledWith('/estimates', expect.objectContaining({ email: 'moi@entreprise.fr', ca: 300000 }));
    expect(c.textContent).toContain('Vérifiez votre boîte mail');
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
  test('repreneur : profil modifiable, export, plus d\'envoi de pièces', async () => {
    const user = { email: 'r@b.fr', role: 'buyer', email_verified: true, first_name: 'Claire', last_name: 'Martin', phone: '0612345678', buyer_profile: { project_type: 'autre', budget_max: 200000, zones: ['Bretagne'] }, profile_score: 40, created_at: '2026-10-01T00:00:00Z' };
    axiosInstance.get.mockImplementation((url) => {
      if (url === '/auth/profile') return Promise.resolve({ data: user });
      if (url === '/kyc/status') return Promise.resolve({ data: { verified: false, status: 'not_started' } });
      if (url === '/auth/export') return Promise.resolve({ data: { account: user } });
      return Promise.reject(new Error(url));
    });
    axiosInstance.put.mockResolvedValue({ data: { user: { ...user, profile_score: 50, buyer_profile: { ...user.buyer_profile, horizon: '0-6' } } } });
    const c = withRouter(<ProfilePage user={user} setUser={jest.fn()} />, '/profile');
    await flush();
    expect(c.querySelector('[data-testid="kyc-upload-form"]')).toBeNull();
    expect(c.textContent).toContain('accord de confidentialité');
    expect(c.querySelector('[data-testid="profile-score-value"]').textContent).toBe('40 %');
    expect(c.querySelector('[data-testid="profile-export-btn"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="profile-delete-btn"]')).not.toBeNull();
    click(c.querySelector('[data-testid="buyer-horizon-0-6"]'));
    click(c.querySelector('[data-testid="profile-save-buyer"]'));
    await flush();
    expect(axiosInstance.put).toHaveBeenCalledWith('/auth/profile', expect.objectContaining({ buyer_profile: expect.objectContaining({ horizon: '0-6', zones: ['Bretagne'] }) }));
    expect(c.querySelector('[data-testid="profile-score-value"]').textContent).toBe('50 %');
  });
});
