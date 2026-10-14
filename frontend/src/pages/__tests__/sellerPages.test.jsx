// Tests de rendu de l'espace vendeur (CreateListing en 3 écrans, MandatePage v2, SellerDashboard « À traiter »,
// MessagesPage par conversation, OtpSignatureDialog avec résumé et texte dépliable).
// Exécution : cd frontend && CI=true npx craco test --watchAll=false src/pages/__tests__/sellerPages.test.jsx
import '@/components/shared/jestEnv';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

jest.mock('@/App', () => ({ axiosInstance: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() }, API: '/api', EMAIL_NOT_VERIFIED_EVENT: 'cession:email-not-verified' }));
// Jest 27 (react-scripts) ne lit pas le champ « exports » des paquets Radix : sous-chemin résolu à la main
jest.mock('@radix-ui/primitive/is-development', () => jest.requireActual('@radix-ui/primitive/dist/internal/is-development.false.js'), { virtual: true });
jest.mock('@/lib/analytics', () => ({ trackEvent: jest.fn(), trackPageView: jest.fn(), initAnalytics: jest.fn() }));

import { axiosInstance as api } from '@/App';
import CreateListing from '@/pages/CreateListing';
import MandatePage from '@/pages/MandatePage';
import SellerDashboard from '@/pages/SellerDashboard';
import MessagesPage from '@/pages/MessagesPage';
import OtpSignatureDialog from '@/components/OtpSignatureDialog';
import { findContactDetails, validateStep, emptyForm, readEstimateSession, applyEstimateToForm } from '@/components/seller/listingForm';
import { mandateStatusSentence, legacyPayerText, apiRelativePath } from '@/lib/mandate';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.scrollTo = jest.fn();
Element.prototype.scrollIntoView = jest.fn();
// jsdom : ResizeObserver (cases Radix) absent
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
const setValue = (el, value) => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  act(() => { el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); });
};

const user = { id: 'u1', role: 'seller', first_name: 'Michel', last_name: 'Dupont', email: 'michel@exemple.fr', email_verified: true, identity_verified: false };
const company = {
  id: 'c1', seller_id: 'u1', status: 'published', title: 'Entreprise de plomberie-chauffage · Bretagne · 6 salariés', trades: ['plomberie-chauffage'],
  region: 'Bretagne', department: '29', staff_count: 6, ca_n: 780000, asking_price: 290000, views: 12, mandat_signed: true, mandate_id: 'm1',
  moderation: { status: 'pending', flags: ['naf_connexe'] },
};
const mandat = { id: 'm1', status: 'signed', registry_number: 12, contract_number: 'MANDAT-2026', signed_at: '2026-10-01T10:00:00Z', ends_at: '2027-10-01T10:00:00Z', tail_ends_at: '2029-04-01T10:00:00Z', terms_version: 'v2' };
const buyerCard = { label: 'Repreneur n°123456', project_type: 'reprise-individuelle', budget_max: 350000, apport: 120000, financing: 'mixte', zones: ['Bretagne'], trades: ['plomberie-chauffage'], horizon: '6-12', siren_verified: false, profile_score: 70 };

const route = (url, table) => {
  const key = Object.keys(table).find((k) => url.startsWith(k));
  return key ? table[key] : {};
};

beforeEach(() => {
  // GET /config (mode test) lu par la boîte de signature : réponse locale, jamais de requête réseau
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({ test_mode: false }) }));
  jest.clearAllMocks();
  sessionStorage.clear();
  api.get.mockImplementation((url) => Promise.resolve({ data: route(url, {
    '/kyc/status': { verified: false, status: 'not_started' },
    '/companies/c1/stats': { views: 12, favorites_count: 3, unique_contacts: 1, offers_count: 0 },
    '/companies/c1': company,
    '/companies': [company],
    '/seller/mandat/status/c1': { mandat_signed: true, mandat, presented_buyers: [{ buyer_id: 'b1', label: 'Repreneur n°123456', name: 'Claire Martin', at: '2026-10-05T10:00:00Z' }] },
    '/dataroom/c1/access-requests': [{ id: 'r1', buyer_id: 'b1', buyer_card: buyerCard, message: 'Je reprends dans le Finistère.', status: 'pending', created_at: '2026-10-08T10:00:00Z', expires_at: '2026-10-18T10:00:00Z' }],
    '/dataroom/c1/documents': { documents: [] },
    '/dataroom/c1/access-log': { logs: [] },
    '/companies/c1/photos': [],
    '/offers/company/c1': { offers: [] },
    '/closing/my': { closings: [] },
    '/messages/conversations': [
      { id: 'conv1', company_id: 'c1', company_title: company.title, buyer_id: 'b1', seller_id: 'u1', other_party_label: 'Repreneur n°123456', buyer_card: buyerCard, last_message: 'Bonjour', last_at: '2026-10-08T10:00:00Z', unread_count: 2, nda_signed: false, identity_revealed: false, access_status: 'pending' },
      { id: 'conv2', company_id: 'c1', company_title: company.title, buyer_id: 'b2', seller_id: 'u1', other_party_label: 'Claire Martin', last_message: 'Merci', last_at: '2026-10-07T10:00:00Z', unread_count: 0, nda_signed: true, identity_revealed: true, access_status: 'granted' },
    ],
    '/messages': [
      { id: 'm1', conversation_id: 'conv2', sender_id: 'b2', sender_label: 'Claire Martin', is_mine: false, content: 'Bonjour, votre entreprise m\'intéresse.', created_at: '2026-10-07T09:00:00Z', read: true, kind: 'message' },
      { id: 'm2', conversation_id: 'conv2', sender_id: 'system', sender_label: 'Plateforme', is_mine: false, content: 'Accord de confidentialité signé.', created_at: '2026-10-07T09:30:00Z', read: true, kind: 'system' },
    ],
  }) }));
  api.post.mockImplementation((url) => Promise.resolve({ data: route(url, {
    '/companies': { ...company, id: 'c-new', status: 'draft', mandat_signed: false, mandate_id: null, moderation: null },
    '/seller/mandat/generate': { already_signed: false, contract_id: 'k1', contract_number: 'MANDAT-20261010-ABCD', content: 'MANDAT DE VENTE SIMPLE (NON EXCLUSIF)\n\nArticle 1…', summary: ['Mandat simple, sans exclusivité.', 'Objet : la cession des titres.', 'Durée 12 mois, résiliable à tout moment.', 'Rémunération à votre charge, due uniquement à la vente.', 'Clause de suite de 18 mois.'], terms_version: 'v2', terms_date: '10/10/2026' },
    '/estimates': { low: 250000, high: 400000, mid: 325000 },
    '/messages': { id: 'sent-1', conversation_id: 'conv2', content: 'Bonjour Claire', created_at: '2026-10-09T10:00:00Z', kind: 'message' },
  }) }));
  api.put.mockImplementation((url) => Promise.resolve({ data: url.startsWith('/companies/') ? { ...company, id: url.split('/')[2] } : { ok: true } }));
});

afterEach(() => {
  mounted.splice(0).forEach(({ root, container }) => { act(() => root.unmount()); container.remove(); });
});

describe('listingForm (helpers)', () => {
  test('détecte les coordonnées et borne la description', () => {
    expect(findContactDetails('Appelez-moi au 06 12 34 56 78')).toEqual(['un numéro de téléphone']);
    expect(findContactDetails('contact@exemple.fr ou www.exemple.fr')).toEqual(['une adresse e-mail', 'une adresse de site web']);
    expect(findContactDetails('Entreprise familiale de plomberie, clientèle fidèle.')).toEqual([]);
    const form = { ...emptyForm(), asking_price: '290000', sale_object: 'titres', sale_reason: 'retraite', description: 'x'.repeat(199) };
    expect(validateStep(3, form).description).toMatch(/Encore 1 caractères/);
    const errs = validateStep(2, { ...emptyForm(), margin: '250', debt: '-5' });
    expect(errs.margin).toBeTruthy();
    expect(errs.debt).toBeTruthy();
  });

  test('préremplit depuis l\'estimateur en sessionStorage', () => {
    sessionStorage.setItem('estimate', JSON.stringify({ siret: '12345678900012', inputs: { ca: 780000, ebe: 90000, staff: 6, maintenance_contracts: true }, result: { low: 250000, high: 400000 } }));
    const est = readEstimateSession();
    expect(est.siret).toBe('12345678900012');
    const form = applyEstimateToForm(emptyForm(), est);
    expect(form.ca_n).toBe('780000');
    expect(form.has_maintenance_contracts).toBe(true);
  });
});

describe('lib/mandate', () => {
  test('statut lisible et héritage du débiteur', () => {
    expect(mandateStatusSentence(mandat)).toMatch(/en cours jusqu'au 01\/10\/2027/);
    expect(mandateStatusSentence({ status: 'denounced', effective_at: '2026-10-30T00:00:00Z' })).toMatch(/résilié/);
    expect(legacyPayerText({ commission_payer: 'repreneur', terms_version: 'v1' })).toMatch(/acquéreur/);
    expect(legacyPayerText({ commission_payer: 'cedant', terms_version: 'v2' })).toBe('');
    expect(apiRelativePath('/api/seller/mandat/m1/pdf')).toBe('/seller/mandat/m1/pdf');
  });
});

describe('CreateListing', () => {
  test('écran 1 : métiers obligatoires, brouillon créé par POST puis écran 2', async () => {
    const c = await render(<CreateListing user={user} />, '/seller/create');
    expect(c.querySelector('[data-testid="trade-picker"]')).toBeTruthy();
    await click(c.querySelector('[data-testid="next-step"]'));
    expect(c.textContent).toMatch(/Choisissez au moins un métier/);
    expect(api.post).not.toHaveBeenCalled();
    await click(c.querySelector('[data-testid="trade-isolation"] input'));
    setValue(c.querySelector('[data-testid="region-select"]'), 'Bretagne');
    await flush();
    await click(c.querySelector('[data-testid="next-step"]'));
    expect(api.post).toHaveBeenCalledWith('/companies', expect.objectContaining({ trades: ['isolation'], region: 'Bretagne' }));
    expect(c.textContent).toMatch(/Vos chiffres clés/);
    expect(c.querySelector('[data-testid="ca-n-input"]')).toBeTruthy();
  });

  test('limite à 4 métiers', async () => {
    const c = await render(<CreateListing user={user} />, '/seller/create');
    for (const id of ['isolation', 'menuiserie', 'electricite', 'etancheite']) await click(c.querySelector(`[data-testid="trade-${id}"] input`));
    expect(c.querySelector('[data-testid="trade-count"]').textContent).toBe('4 / 4');
    expect(c.querySelector('[data-testid="trade-agencement"] input').disabled).toBe(true);
  });

  test('écran 3 : contrôle anti-coordonnées et aperçu anonyme', async () => {
    const draft = { ...company, id: 'd1', status: 'draft', mandat_signed: false, mandate_id: null, moderation: null, description: '', sale_object: '', sale_reason: '' };
    api.get.mockImplementation((url) => Promise.resolve({ data: url.startsWith('/companies/d1') ? draft : url.startsWith('/kyc') ? { verified: false } : {} }));
    const c = await render(<CreateListing user={user} />, '/seller/edit/d1', '/seller/edit/:id');
    expect(c.textContent).toMatch(/Votre projet de cession/);
    expect(c.querySelector('[data-testid="listing-anonymous-preview"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="listing-card"]').textContent).not.toMatch(/SIRET/);
    setValue(c.querySelector('[data-testid="description-input"]'), 'Écrivez-moi sur contact@exemple.fr. ' + 'x'.repeat(200));
    await flush();
    expect(c.querySelector('[data-testid="description-contacts"]').textContent).toMatch(/adresse e-mail/);
    await click(c.querySelector('[data-testid="next-step"]'));
    expect(api.put).not.toHaveBeenCalled();
    expect(c.textContent).toMatch(/l'annonce doit rester anonyme/);
  });
});

describe('MandatePage', () => {
  test('adresse + objet puis résumé en 5 points ; signature avec le code seul', async () => {
    api.get.mockImplementation((url) => Promise.resolve({ data: url.startsWith('/seller/mandat/status') ? { mandat_signed: false, mandat: null, presented_buyers: [] } : { ...company, status: 'mandat_en_attente', mandat_signed: false, sale_object: 'titres', company_name: 'SARL Exemple' } }));
    const c = await render(<MandatePage user={user} />, '/seller/mandat/c1', '/seller/mandat/:companyId');
    expect(c.querySelector('[data-testid="mandant-form"]')).toBeTruthy();
    expect(c.textContent).not.toMatch(/qui paiera la commission/i);
    await click(c.querySelector('[data-testid="prepare-mandate"]'));
    expect(c.textContent).toMatch(/Indiquez la voie/);
    expect(api.post).not.toHaveBeenCalled();
    setValue(c.querySelector('[data-testid="address-line1"]'), '12 rue des Artisans');
    setValue(c.querySelector('[data-testid="address-postal-code"]'), '29200');
    setValue(c.querySelector('[data-testid="address-city"]'), 'Brest');
    setValue(c.querySelector('[data-testid="capacity-select"]'), 'dirigeant');
    await flush();
    await click(c.querySelector('[data-testid="prepare-mandate"]'));
    expect(api.put).toHaveBeenCalledWith('/companies/c1', expect.objectContaining({ mandant_address: expect.objectContaining({ line1: '12 rue des Artisans', postal_code: '29200', city: 'Brest' }), sale_object: 'titres', mandant_capacity: 'dirigeant' }));
    expect(api.post).toHaveBeenCalledWith('/seller/mandat/generate', null, { params: { company_id: 'c1' } });
    const summary = c.querySelector('[data-testid="mandate-summary"]');
    expect(summary.querySelectorAll('ol li').length).toBe(5);
    expect(summary.textContent).toMatch(/Version du 10\/10\/2026/);
    expect(summary.textContent).toMatch(/HT/);
    await click(c.querySelector('[data-testid="open-mandate-sign"]'));
    expect(document.body.querySelector('[data-testid="otp-signature-dialog"]')).toBeTruthy();
    expect(document.body.querySelector('[data-testid="otp-accept"]').getAttribute('data-disabled')).not.toBeNull();
  });

  test('400 validation renvoie au formulaire avec le champ manquant', async () => {
    api.get.mockImplementation((url) => Promise.resolve({ data: url.startsWith('/seller/mandat/status') ? { mandat: null } : { ...company, status: 'mandat_en_attente', mandat_signed: false, sale_object: 'fonds', mandant_address: '12 rue X, 29200 Brest' } }));
    api.post.mockRejectedValueOnce({ response: { status: 400, data: { detail: { code: 'validation', message: 'Complétez votre annonce : dénomination de la société', missing: ['company_name'] } } } });
    const c = await render(<MandatePage user={user} />, '/seller/mandat/c1', '/seller/mandat/:companyId');
    expect(c.querySelector('[data-testid="address-line1"]').value).toBe('12 rue X');
    setValue(c.querySelector('[data-testid="capacity-select"]'), 'associe');
    await flush();
    await click(c.querySelector('[data-testid="prepare-mandate"]'));
    expect(c.textContent).toMatch(/dénomination de la société/);
    expect(c.textContent).toMatch(/Compléter mon annonce/);
  });
});

describe('SellerDashboard', () => {
  test('bloc À traiter avec la demande de dossier, statut lisible, aucun compteur à zéro', async () => {
    const c = await render(<SellerDashboard user={user} setUser={() => {}} />, '/seller/dashboard');
    const todo = c.querySelector('[data-testid="todo-block"]');
    expect(todo).toBeTruthy();
    expect(todo.textContent).toMatch(/Une demande de dossier à traiter/);
    expect(todo.querySelector('[data-testid="buyer-card"]').textContent).toMatch(/350/);
    expect(todo.querySelector('[data-testid="accept-request-r1"]')).toBeTruthy();
    expect(todo.textContent).toMatch(/messages non lus/);
    expect(c.querySelector('[data-testid="status-c1"]').textContent).toBe('En ligne');
    expect(c.textContent).not.toMatch(/48 h/);
    expect(c.textContent).not.toMatch(/\b0 vues\b/);
    expect(c.textContent).toMatch(/Mandat simple en cours jusqu'au 01\/10\/2027/);
    await click(todo.querySelector('[data-testid="accept-request-r1"]'));
    expect(api.put).toHaveBeenCalledWith('/dataroom/c1/access/r1/validate');
    await click(c.querySelector('[data-testid="open-c1"]'));
    expect(c.querySelector('[data-testid="listing-detail"]').textContent).toMatch(/Demandes de dossier/);
  });

  test('onglet mandat : résilier et prolonger, repreneurs présentés', async () => {
    const c = await render(<SellerDashboard user={user} setUser={() => {}} />, '/seller/dashboard?annonce=c1&onglet=mandate');
    const panel = c.querySelector('[data-testid="mandate-panel"]');
    expect(panel).toBeTruthy();
    expect(panel.textContent).toMatch(/Claire Martin/);
    expect(panel.querySelector('[data-testid="denounce-mandate"]')).toBeTruthy();
    expect(panel.querySelector('[data-testid="renew-mandate"]')).toBeTruthy();
    expect(panel.textContent).not.toMatch(/acquéreur/);
    await click(panel.querySelector('[data-testid="denounce-mandate"]'));
    const dialog = document.body.querySelector('[data-testid="denounce-dialog"]');
    expect(dialog.textContent).toMatch(/Préavis de 15 jours/);
    await click(dialog.querySelector('[data-testid="denounce-dialog-confirm"]'));
    expect(api.post).toHaveBeenCalledWith('/seller/mandat/m1/denounce', {});
  });
});

describe('MessagesPage', () => {
  test('?conversation= ouvre la bonne conversation, bandeau NDA, messages système, envoi', async () => {
    const c = await render(<MessagesPage user={user} />, '/messages?conversation=conv2');
    expect(c.querySelector('[data-testid="conversation-conv2"]').getAttribute('aria-current')).toBe('true');
    expect(api.get).toHaveBeenCalledWith('/messages', { params: { conversation_id: 'conv2' } });
    expect(c.querySelector('[data-testid="identity-banner"]').textContent).toMatch(/révélés aux deux parties/);
    expect(c.querySelectorAll('[data-testid="system-message"]').length).toBe(1);
    expect(c.querySelector('[data-testid="conversation-conv1"]').textContent).toMatch(/2/);
    setValue(c.querySelector('[data-testid="message-input"]'), 'Bonjour Claire');
    await flush();
    await click(c.querySelector('[data-testid="send-message"]'));
    expect(api.post).toHaveBeenCalledWith('/messages', { conversation_id: 'conv2', content: 'Bonjour Claire' });
  });

  test('côté cédant : carte repreneur dépliable et conversation non lue marquée lue', async () => {
    const c = await render(<MessagesPage user={user} />, '/messages?conversation=conv1');
    expect(api.put).toHaveBeenCalledWith('/messages/conversations/conv1/read');
    expect(c.querySelector('[data-testid="identity-banner"]').textContent).toMatch(/après l'accord de confidentialité/);
    // Dépliée d'office à la première ouverture de la conversation, repliable ensuite
    expect(c.querySelector('[data-testid="buyer-card"]')).toBeTruthy();
    await click(c.querySelector('[data-testid="toggle-buyer-card"]'));
    expect(c.querySelector('[data-testid="buyer-card"]')).toBeNull();
  });
});

describe('OtpSignatureDialog', () => {
  test('résumé, texte replié, case activée après lecture', async () => {
    const c = await render(<OtpSignatureDialog open onClose={() => {}} title="Mandat" contractId="k1" documentText="Texte intégral" summary={['A', 'B', 'C', 'D', 'E']} onSign={async () => {}} />);
    expect(c).toBeTruthy();
    const dialog = document.body.querySelector('[data-testid="otp-signature-dialog"]');
    expect(dialog.querySelector('[data-testid="otp-summary"]').querySelectorAll('li').length).toBe(5);
    expect(dialog.querySelector('[data-testid="otp-document"]')).toBeNull();
    expect(dialog.querySelector('[data-testid="otp-accept"]').getAttribute('data-disabled')).not.toBeNull();
    await click(dialog.querySelector('[data-testid="otp-toggle-document"]'));
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
    expect(dialog.querySelector('[data-testid="otp-document"]')).toBeTruthy();
    expect(dialog.querySelector('[data-testid="otp-accept"]').getAttribute('data-disabled')).toBeNull();
  });
});
