// Tests de rendu du parcours repreneur : fiche d'annonce (tous les champs, badges, encart, CTA, favori visiteur,
// contact → messagerie, 403 profil incomplet), dossier en checklist (DataroomPage), étape de vente (ClosingPanel),
// espace repreneur (pipeline, aucun compteur à zéro), fonctions pures (buildPipeline, normalizeAccessStatus).
// Exécution : cd frontend && CI=true npx craco test --watchAll=false src/pages/__tests__/buyerPages.test.jsx
import '@/components/shared/jestEnv';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

jest.mock('@/App', () => ({ axiosInstance: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() }, API: '/api', EMAIL_NOT_VERIFIED_EVENT: 'cession:email-not-verified' }));
jest.mock('@radix-ui/primitive/is-development', () => jest.requireActual('@radix-ui/primitive/dist/internal/is-development.false.js'), { virtual: true });
jest.mock('@/lib/analytics', () => ({ trackEvent: jest.fn(), trackPageView: jest.fn(), initAnalytics: jest.fn() }));
jest.mock('@/components/SecurePdfViewer', () => () => null);

import { axiosInstance as api } from '@/App';
import { trackEvent } from '@/lib/analytics';
import CompanyDetail from '@/pages/CompanyDetail';
import DataroomPage from '@/pages/DataroomPage';
import BuyerDashboard from '@/pages/BuyerDashboard';
import ClosingPanel, { closingSentence } from '@/components/closing/ClosingPanel';
import { buildPipeline, normalizeAccessStatus, normalizeConversations, alertPayload } from '@/components/buyer/api';
import { offerSummaryText } from '@/components/buyer/OfferForm';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.scrollTo = jest.fn();
Element.prototype.scrollIntoView = jest.fn();
if (typeof window.ResizeObserver === 'undefined') {
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

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
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); await flush(); };
const setValue = (el, value) => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  act(() => { el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); });
};

const buyer = {
  id: 'b1', role: 'buyer', first_name: 'Claire', last_name: 'Martin', email: 'claire@exemple.fr', email_verified: true, identity_verified: false, profile_score: 70,
  buyer_profile: { project_type: 'reprise-individuelle', budget_max: 350000, apport: 120000, financing: 'mixte', zones: ['Bretagne'], trades: ['plomberie-chauffage'], horizon: '6-12' },
};
const seller = { id: 's1', role: 'seller', first_name: 'Michel', last_name: 'Dupont', email: 'michel@exemple.fr', email_verified: true };

const company = {
  id: 'c1', status: 'published', title: 'Entreprise de plomberie-chauffage · Bretagne · 6 salariés', trades: ['plomberie-chauffage', 'pac-clim-cvc'],
  rge_types: ['Pompes à chaleur air/eau', 'Chaudières gaz/fioul à condensation'], other_qualifications: ['qualibat'], is_rge: true, rge_validity: '2028-03-15',
  qualifications_verified_at: '2026-10-02T10:00:00Z', region: 'Bretagne', department: '29', staff_count: 6, creation_date: '2009-03-02', legal_structure: 'SARL',
  ca_n: 780000, ca_n1: 720000, ca_n2: 650000, ebitda: 95000, margin: 32, debt: 40000, pipeline: 210000, fixed_charges: { salaries: 260000, rent: 18000, insurance: 9000, equipment: 12000 },
  asking_price: 290000, sale_object: 'titres', sale_reason: 'retraite', handover_months: 6, has_maintenance_contracts: true, technical_referent_stays: true, key_staff_stays: false, decennale_ok: true,
  description: 'Entreprise familiale de plomberie et chauffage, clientèle de particuliers et de syndics.', equipment: '3 fourgons, outillage complet', premises: 'Atelier et bureau de 180 m² en location',
  published_at: '2026-10-01T10:00:00Z', company_checks: { in_ademe_list: true, dirigeant_match: 'match_exact' },
  commission_info: { payer: 'cedant', rate_percent_ht: '6 %', estimate_ht: 17400, estimate_ttc: 20880, minimum_ht: 4000, terms_version: 'v2' }, views: 12,
};

const mockGet = (routes) => {
  api.get.mockImplementation((url) => {
    // Clé la plus longue qui préfixe l'URL (« /companies/c1/transmissibility » avant « /companies/c1 »)
    const entry = Object.keys(routes).filter((k) => url === k || url.startsWith(k)).sort((a, b) => b.length - a.length)[0];
    if (entry) return Promise.resolve({ data: typeof routes[entry] === 'function' ? routes[entry](url) : routes[entry] });
    return Promise.reject(Object.assign(new Error('404'), { response: { status: 404, data: { detail: 'Introuvable' } } }));
  });
};

beforeEach(() => {
  // CRA (resetMocks) remet les simulations à zéro avant chaque test : fetch (legal-info du pied de page) redéfini ici
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({}) }));
  api.get.mockReset();
  api.post.mockReset();
  api.put.mockReset();
  api.delete.mockReset();
  try { sessionStorage.clear(); localStorage.clear(); } catch (e) { /* no-op */ }
});
afterEach(() => {
  mounted.splice(0).forEach(({ root, container }) => { act(() => root.unmount()); container.remove(); });
  jest.clearAllMocks();
});

const BAD = ['Date non renseignée', 'domaines complémentaires', 'Domaines RGE complémentaires', 'Nous pouvons accompagner', 'crédit', 'Crédit', 'à compléter', 'LOI', '{{', 'N/A', 'Nombre de vues'];
const expectClean = (c) => {
  const text = c.textContent;
  BAD.forEach((bad) => expect(text).not.toContain(bad));
  expect(text).not.toMatch(/(^|[^\d])0 (annonce|dossier|offre|alerte|favori)/);
};

// ------------------------------------------------------------------------------------------------
describe('fonctions pures', () => {
  test('normalizeAccessStatus : forme API.md et forme vague 1', () => {
    const v2 = normalizeAccessStatus({ access_granted: false, access_status: 'accepted', steps: { identity: true, nda: false, funds: false }, next_step: 'nda', request: { id: 'r1', created_at: '2026-10-01', expires_at: '2026-10-11' } }, buyer);
    expect(v2.accepted).toBe(true);
    expect(v2.nextStep).toBe('nda');
    expect(v2.request.expiresAt).toBe('2026-10-11');
    const v1 = normalizeAccessStatus({ access_granted: false, access_status: 'validated', nda_signed: true, request: { status: 'validated' } }, { ...buyer, identity_verified: true });
    expect(v1.accepted).toBe(true);
    expect(v1.steps).toEqual({ identity: true, nda: true, funds: false });
    expect(v1.nextStep).toBe('funds');
    const granted = normalizeAccessStatus({ access_granted: true, access_status: 'granted' }, buyer);
    expect(granted.accessGranted).toBe(true);
    expect(granted.nextStep).toBeNull();
    expect(normalizeAccessStatus({ access_granted: true, is_seller: true }, seller).isSeller).toBe(true);
  });

  test('normalizeConversations : tableau API.md et dictionnaire historique', () => {
    expect(normalizeConversations([{ id: 'k1', company_id: 'c1', unread_count: '2' }], 'b1')[0].unread_count).toBe(2);
    const legacy = normalizeConversations({ c1: [{ sender_id: 's1', receiver_id: 'b1', content: 'Bonjour', created_at: '2026-10-02T10:00:00Z', read: false }] }, 'b1');
    expect(legacy[0]).toMatchObject({ company_id: 'c1', unread_count: 1, last_message: 'Bonjour', legacy: true });
  });

  test('buildPipeline : étape la plus avancée par annonce, tri par date', () => {
    const rows = buildPipeline({
      conversations: [{ id: 'k1', company_id: 'c1', last_at: '2026-10-03T10:00:00Z', unread_count: 1 }, { id: 'k2', company_id: 'c2', last_at: '2026-10-01T10:00:00Z' }],
      accessByCompany: { c1: normalizeAccessStatus({ access_status: 'pending', request: { created_at: '2026-10-03' } }, buyer), c2: normalizeAccessStatus({ access_granted: true, access_status: 'granted' }, buyer) },
      offers: [{ id: 'o1', company_id: 'c2', status: 'countered', created_at: '2026-10-05T10:00:00Z' }],
      closings: [],
      companies: { c1: company },
    });
    expect(rows.map((r) => r.companyId)).toEqual(['c2', 'c1']);
    expect(rows[0].stage).toBe('offer');
    expect(rows[0].detail).toContain('Contre-proposition');
    expect(rows[1].stage).toBe('requested');
    expect(rows[1].unread).toBe(1);
    expect(rows[1].title).toBe(company.title);
  });

  test('alertPayload : critères API.md §8 et intitulé lisible', () => {
    const p = alertPayload({ trades: ['isolation'], regions: ['Bretagne'], maxPrice: '300000', rge: true });
    expect(p).toMatchObject({ trades: ['isolation'], regions: ['Bretagne'], max_price: 300000, rge: true });
    expect(p.name).toContain('Bretagne');
  });

  test('offerSummaryText : montants fr-FR, aucune variable brute', () => {
    const text = offerSummaryText({ amount: 250000, sale_object: 'titres', financing: { equity: 100000, loan: 150000 }, conditions: ['Audit satisfaisant'], target_date: '2027-02-01', validity_days: 30 }, company.title);
    expect(text).toContain('250');
    expect(text).toContain('Cession de titres');
    expect(text).toContain('Audit satisfaisant');
    expect(text).not.toContain('{{');
    expect(text).not.toContain('undefined');
  });

  test('closingSentence : phrases lisibles selon statut et rôle', () => {
    const declared = { status: 'declared', declaration: { declared_by: 'buyer', signed_on: '2026-10-05', final_price: 280000, confirm_deadline: '2026-10-12T10:00:00Z' } };
    expect(closingSentence(declared, 'seller')).toContain('Confirmez ou contestez');
    expect(closingSentence(declared, 'buyer')).toContain('Vous avez déclaré');
    expect(closingSentence({ status: 'confirmed', confirmed_at: '2026-10-12' }, 'buyer')).toContain('rien ne vous est demandé');
  });
});

// ------------------------------------------------------------------------------------------------
describe('CompanyDetail', () => {
  test('visiteur : tous les champs, libellés, badges, encart, aucun texte interdit, favori → inscription', async () => {
    mockGet({ '/companies/c1': company });
    const c = await render(<CompanyDetail user={null} />, '/company/c1', '/company/:id', <Route path="/register" element={<p data-testid="register-page">Inscription</p>} />);
    const text = c.textContent;
    expectClean(c);
    expect(text).toContain(company.title);
    expect(c.querySelector('[data-testid="qualification-badge"]').textContent).toContain('RGE vérifié ADEME');
    expect(text).toContain('Dirigeant vérifié');
    expect(text).toContain('Finistère (29)');
    expect(text).toContain('PAC, climatisation');
    expect(text).toContain('Qualibat');
    expect(text).toContain('Pompes à chaleur air/eau');
    expect(text).toMatch(/Valide jusqu'au 15 mars 2028/);
    expect(text).toContain('Carnet de commandes');
    expect(text).toContain('Charges fixes annuelles');
    expect(text).toContain('Salaires chargés');
    expect(text).toContain('Cession de titres');
    expect(text).toContain('Départ à la retraite');
    expect(text).toContain("6 mois d'accompagnement");
    expect(text).toContain("Contrats d'entretien récurrents");
    expect(text).toContain("L'équipe clé reste : non");
    expect(text).toContain('3 fourgons');
    expect(c.querySelector('[data-testid="how-it-works"]').textContent).toContain('Comment ça se passe');
    expect(c.querySelector('[data-testid="how-it-works"]').textContent).toContain('accord de confidentialité');
    expect(c.querySelector('[data-testid="commission-notice"]')).toBeNull();
    expect(c.querySelector('[data-testid="alert-form"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="share-btn"]')).not.toBeNull();
    expect(document.title).toContain(company.title);
    await click(c.querySelector('[data-testid="favorite-btn"]'));
    expect(c.querySelector('[data-testid="register-page"]')).not.toBeNull();
  });

  test('héritage : encadré commission acquéreur seulement pour un mandat v1', async () => {
    mockGet({ '/companies/c1': { ...company, commission_info: { ...company.commission_info, payer: 'repreneur', terms_version: 'v1' } } });
    const c = await render(<CompanyDetail user={null} />, '/company/c1', '/company/:id');
    expect(c.querySelector('[data-testid="commission-notice"]').textContent).toContain('acquéreur');
    expect(c.querySelector('[data-testid="commission-notice"]').textContent).toMatch(/HT \(.*TTC\)/);
  });

  test('repreneur : « Présenter mon projet » → POST /companies/c1/contact {message} → messagerie', async () => {
    mockGet({ '/companies/c1': company, '/favorites/check/c1': { favorited: false } });
    api.post.mockResolvedValue({ data: { conversation_id: 'conv1' } });
    const c = await render(<CompanyDetail user={buyer} />, '/company/c1', '/company/:id', <Route path="/messages" element={<p data-testid="messages-page">Messagerie</p>} />);
    expect(c.querySelector('[data-testid="dataroom-link"]').getAttribute('href')).toBe('/dataroom/c1');
    await click(c.querySelector('[data-testid="contact-seller-btn"]'));
    const textarea = c.querySelector('[data-testid="contact-message"]');
    expect(textarea.value).toContain('350');
    expect(textarea.value).toContain('Bretagne');
    await click(c.querySelector('[data-testid="contact-send-btn"]'));
    expect(api.post).toHaveBeenCalledWith('/companies/c1/contact', { message: expect.stringContaining('Bonjour') });
    expect(trackEvent).toHaveBeenCalledWith('contact_sent', expect.objectContaining({ source: 'fiche' }));
    expect(c.querySelector('[data-testid="messages-page"]')).not.toBeNull();
  });

  test('repreneur : 403 profile_incomplete → message et lien vers le profil', async () => {
    mockGet({ '/companies/c1': company, '/favorites/check/c1': { favorited: true } });
    api.post.mockRejectedValue({ response: { status: 403, data: { detail: { code: 'profile_incomplete', message: 'Complétez votre profil de projet (40 % requis)' } } } });
    const c = await render(<CompanyDetail user={buyer} />, '/company/c1', '/company/:id');
    expect(c.querySelector('[data-testid="favorite-btn"]').textContent).toContain('Dans mes favoris');
    await click(c.querySelector('[data-testid="contact-seller-side-btn"]'));
    await click(c.querySelector('[data-testid="contact-send-btn"]'));
    const err = c.querySelector('[data-testid="contact-error"]');
    expect(err.textContent).toContain('40 %');
    expect(err.querySelector('a').getAttribute('href')).toBe('/profile');
  });

  test('cédant propriétaire : pas de CTA de contact, lien vers son espace', async () => {
    mockGet({ '/companies/c1': { ...company, seller_id: 's1', company_name: 'DUPONT SARL' } });
    const c = await render(<CompanyDetail user={seller} />, '/company/c1', '/company/:id');
    expect(c.querySelector('[data-testid="contact-seller-btn"]')).toBeNull();
    expect(c.textContent).not.toContain('DUPONT SARL');
    expect(c.textContent).toContain('Mon espace');
  });
});

// ------------------------------------------------------------------------------------------------
describe('DataroomPage', () => {
  const base = { '/companies/c1': company, '/kyc/status': { verified: false, status: 'not_started' }, '/offers/my': { offers: [] } };

  test('sans demande : étape 1 en cours, bouton « Demander le dossier » → POST request-access', async () => {
    mockGet({ ...base, '/dataroom/c1/access-status': { access_granted: false, access_status: null, steps: { identity: false, nda: false, funds: false }, next_step: null, request: null } });
    api.post.mockResolvedValue({ data: { request_id: 'r1', status: 'pending' } });
    const c = await render(<DataroomPage user={buyer} />, '/dataroom/c1', '/dataroom/:companyId');
    expectClean(c);
    expect(c.querySelector('[aria-current="step"]').textContent).toContain('Dossier demandé');
    await click(c.querySelector('[data-testid="request-access-btn"]'));
    expect(api.post).toHaveBeenCalledWith('/dataroom/c1/request-access', {});
  });

  test('accepté, identité non vérifiée : étape identité en cours avec le bouton Stripe et retour mémorisé', async () => {
    mockGet({ ...base, '/dataroom/c1/access-status': { access_granted: false, access_status: 'accepted', steps: { identity: false, nda: false, funds: false }, next_step: 'identity', request: { id: 'r1', created_at: '2026-10-01', expires_at: '2026-10-11' } } });
    const c = await render(<DataroomPage user={buyer} />, '/dataroom/c1', '/dataroom/:companyId');
    expect(c.querySelector('[aria-current="step"]').textContent).toContain('Identité vérifiée');
    expect(c.textContent).toContain('Vérifier mon identité');
    expect(sessionStorage.getItem('kyc_return_to')).toBe('/dataroom/c1');
  });

  test('accepté, identité vérifiée : « Lire et signer l\'accord » → generate-for-signature puis dialogue de signature', async () => {
    mockGet({ ...base, '/kyc/status': { verified: true }, '/dataroom/c1/access-status': { access_granted: false, access_status: 'accepted', steps: { identity: true, nda: false, funds: false }, next_step: 'nda', request: { id: 'r1' } } });
    api.post.mockResolvedValue({ data: { contract_id: 'nda1', contract_number: 'NDA-1', content: 'ACCORD DE CONFIDENTIALITÉ — texte intégral', terms_date: '10/10/2026' } });
    const c = await render(<DataroomPage user={{ ...buyer, identity_verified: true }} />, '/dataroom/c1', '/dataroom/:companyId');
    expect(c.querySelector('[aria-current="step"]').textContent).toContain('Accord de confidentialité');
    await click(c.querySelector('[data-testid="nda-btn"]'));
    expect(api.post).toHaveBeenCalledWith('/contracts/generate-for-signature', { company_id: 'c1', doc_type: 'nda' });
    const dialog = document.querySelector('[data-testid="otp-signature-dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain('texte intégral');
    expect(dialog.textContent).toContain('Version du 10/10/2026');
  });

  test('accord signé : formulaire d\'origine des fonds → POST funds-declaration', async () => {
    mockGet({ ...base, '/kyc/status': { verified: true }, '/dataroom/c1/access-status': { access_granted: false, access_status: 'accepted', steps: { identity: true, nda: true, funds: false }, next_step: 'funds', request: { id: 'r1' } } });
    api.post.mockResolvedValue({ data: { access_granted: true } });
    const c = await render(<DataroomPage user={{ ...buyer, identity_verified: true }} />, '/dataroom/c1', '/dataroom/:companyId');
    expect(c.querySelector('[aria-current="step"]').textContent).toContain('Origine des fonds');
    setValue(c.querySelector('[data-testid="funds-source"]'), 'mixte');
    setValue(c.querySelector('[data-testid="funds-amount"]'), '300000');
    await click(c.querySelector('[data-testid="funds-attest"]'));
    await click(c.querySelector('[data-testid="funds-submit"]'));
    expect(api.post).toHaveBeenCalledWith('/dataroom/c1/funds-declaration', { source: 'mixte', amount: 300000, financing_partner: null });
  });

  test('accès accordé : documents, diagnostic, bouton « Faire une offre indicative » et formulaire', async () => {
    mockGet({
      ...base,
      '/kyc/status': { verified: true },
      '/dataroom/c1/access-status': { access_granted: true, access_status: 'granted', steps: { identity: true, nda: true, funds: true }, next_step: null, request: { id: 'r1' } },
      '/dataroom/c1/documents': { documents: [{ id: 'd1', filename: 'bilan-2025.pdf', category: 'financier', uploaded_at: '2026-10-02' }], access_granted: true },
      '/companies/c1/transmissibility': { ademe: { found: true }, diagnostic: { level: { value: 'elevee', label: 'Transmissibilité élevée', reasons: ['Le référent technique reste dans l\'entreprise.'] }, qualifications: [{ name: 'QualiPAC', organisme_label: 'Qualit\'EnR', date_fin: '2028-03-15', status: 'valide' }], transfer: { titres: { label: 'Cession de titres', summary: 'La société reste la même personne morale.', steps: [] }, fonds: { label: 'Cession du fonds', summary: 'Nouvelle demande.', steps: [] }, chosen: 'titres', recommendation: 'Privilégier la cession de titres.' }, referent: { label: 'Référent technique RGE', text: 'Texte référent.', steps: ['Identifier le référent.'], stays: true }, decennale: { label: 'Assurance décennale', titres: 'Continue.', fonds: 'Ne se transmet pas.', steps: [], ok: true }, checklist: [{ key: 'referent', label: 'Référent technique conservé', status: 'ok', detail: 'Le référent reste.' }], disclaimer: 'Diagnostic indicatif.' } },
    });
    const c = await render(<DataroomPage user={{ ...buyer, identity_verified: true }} />, '/dataroom/c1', '/dataroom/:companyId');
    expectClean(c);
    expect(c.querySelector('[data-testid="dataroom-documents"]').textContent).toContain('bilan-2025.pdf');
    expect(c.querySelector('[data-testid="transmissibility"]').textContent).toContain('Transmissibilité élevée');
    expect(c.querySelector('[data-testid="transmissibility"]').textContent).toContain('QualiPAC');
    await click(c.querySelector('[data-testid="open-offer-form"]'));
    const form = c.querySelector('[data-testid="offer-form"]');
    expect(form).not.toBeNull();
    expect(c.querySelector('[data-testid="offer-amount"]').value).toBe('290000');
    api.post.mockResolvedValue({ data: { offer: { id: 'o1', amount: 290000 }, contract_id: 'ctr1', content: 'OFFRE INDICATIVE — texte' } });
    await click(c.querySelector('[data-testid="offer-submit"]'));
    expect(api.post).toHaveBeenCalledWith('/offers', expect.objectContaining({ company_id: 'c1', amount: 290000, sale_object: 'titres', validity_days: 30, financing: { equity: 0, loan: 0, vendor_loan: 0, earn_out: 0 } }));
    const dialog = document.querySelector('[data-testid="otp-signature-dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain('Signer mon offre');
    expect(sessionStorage.getItem('offer_text:ctr1')).toContain('OFFRE INDICATIVE');
  });

  test('cédant : renvoi vers son espace', async () => {
    mockGet({ ...base, '/dataroom/c1/access-status': { access_granted: true, is_seller: true } });
    const c = await render(<DataroomPage user={seller} />, '/dataroom/c1', '/dataroom/:companyId');
    expect(c.textContent).toContain('Vous êtes le cédant');
  });
});

// ------------------------------------------------------------------------------------------------
describe('ClosingPanel', () => {
  const closing = {
    id: 'cl1', company_id: 'c1', company_title: company.title, seller_id: 's1', buyer_id: 'b1', offer_id: 'o1', offer_amount: 280000, sale_object: 'titres',
    expected_date: '2027-01-15', accepted_at: '2026-10-05T10:00:00Z', redacteur: null, status: 'in_progress', status_label: 'Vente en cours', declaration: null, invoice: null,
    seller_name: 'Michel Dupont', buyer_name: 'Claire Martin', commission_preview: { final_commission_ht: 16800, final_commission_ttc: 20160 },
  };

  test('cédant, vente en cours : rédacteur puis déclaration → PUT redacteur, POST declare', async () => {
    api.put.mockResolvedValue({ data: { ...closing, role: 'seller', redacteur: { type: 'notaire', name: 'Étude Le Gall' } } });
    api.post.mockResolvedValue({ data: { ...closing, role: 'seller', status: 'declared', declaration: { declared_by: 'seller', signed_on: '2026-10-09', final_price: 275000, sale_object: 'titres', confirm_deadline: '2026-10-16T10:00:00Z' } } });
    const onChange = jest.fn();
    const c = await render(<ClosingPanel closing={{ ...closing, role: 'seller' }} user={seller} onChange={onChange} />);
    expectClean(c);
    expect(c.querySelector('[data-testid="closing-status"]').textContent).toBe('Vente en cours');
    expect(c.querySelector('[data-testid="closing-sentence"]').textContent).toContain('Offre acceptée');
    expect(c.textContent).toContain('Repreneur : Claire Martin');
    setValue(c.querySelector('[data-testid="redacteur-type"]'), 'notaire');
    setValue(c.querySelector('[data-testid="redacteur-name"]'), 'Étude Le Gall');
    await click(c.querySelector('[data-testid="redacteur-submit"]'));
    expect(api.put).toHaveBeenCalledWith('/closing/cl1/redacteur', { type: 'notaire', name: 'Étude Le Gall', email: null, phone: null });
    expect(onChange).toHaveBeenCalled();
    setValue(c.querySelector('[data-testid="declare-date"]'), '2026-10-09');
    setValue(c.querySelector('[data-testid="declare-price"]'), '275000');
    expect(c.querySelector('[data-testid="declare-commission"]').textContent).toMatch(/HT \(.*TTC\)/);
    await click(c.querySelector('[data-testid="declare-submit"]'));
    expect(api.post).toHaveBeenCalledWith('/closing/cl1/declare', { signed_on: '2026-10-09', final_price: 275000, sale_object: 'titres' });
  });

  test('repreneur, vente déclarée par le cédant : bandeau de confirmation, contestation avec motif', async () => {
    const declared = { ...closing, role: 'buyer', status: 'declared', status_label: 'Vente déclarée, en attente de confirmation', declaration: { declared_by: 'seller', signed_on: '2026-10-09', final_price: 275000, sale_object: 'titres', confirm_deadline: '2026-10-16T10:00:00Z' } };
    api.post.mockResolvedValue({ data: { ...declared, status: 'disputed' } });
    const c = await render(<ClosingPanel closing={declared} user={buyer} onChange={jest.fn()} />);
    const banner = c.querySelector('[data-testid="confirm-banner"]');
    expect(banner.textContent).toContain('déclarée par le cédant');
    expect(banner.textContent).toContain('275');
    expect(c.querySelector('[data-testid="declare-form"]')).toBeNull();
    await click(c.querySelector('[data-testid="dispute-btn"]'));
    setValue(c.querySelector('[data-testid="dispute-reason"]'), 'Le prix indiqué est inexact.');
    await click(c.querySelector('[data-testid="dispute-submit"]'));
    expect(api.post).toHaveBeenCalledWith('/closing/cl1/dispute', { reason: 'Le prix indiqué est inexact.' });
  });

  test('vente confirmée : facture visible du cédant seulement, rien demandé au repreneur', async () => {
    const confirmed = { ...closing, status: 'confirmed', status_label: 'Vente confirmée', confirmed_at: '2026-10-16T10:00:00Z', confirmed_by: 'auto', declaration: { declared_by: 'seller', signed_on: '2026-10-09', final_price: 275000, sale_object: 'titres' }, invoice: { id: 'inv1', number: 'FAC-2026-00001', total_ht: 16500, vat: 3300, total_ttc: 19800, due_on: '2026-11-15', status: 'issued' } };
    const s = await render(<ClosingPanel closing={{ ...confirmed, role: 'seller' }} user={seller} onChange={jest.fn()} />);
    const card = s.querySelector('[data-testid="invoice-card"]');
    expect(card.textContent).toContain('FAC-2026-00001');
    expect(s.querySelector('[data-testid="invoice-pdf-btn"]')).not.toBeNull();
    expect(s.querySelector('[data-testid="payment-order-btn"]')).not.toBeNull();
    expect(s.querySelector('[data-testid="declare-form"]')).toBeNull();
    const b = await render(<ClosingPanel closing={{ ...confirmed, role: 'buyer' }} user={buyer} onChange={jest.fn()} />);
    expect(b.querySelector('[data-testid="invoice-pdf-btn"]')).toBeNull();
    expect(b.textContent).toContain('rien ne vous est demandé');
  });
});

// ------------------------------------------------------------------------------------------------
describe('BuyerDashboard', () => {
  test('pipeline par étape, offres, alertes, favoris ; profil incomplet → lien ; aucun compteur à zéro', async () => {
    mockGet({
      '/auth/profile': { ...buyer, profile_score: 30 },
      '/kyc/status': { verified: false },
      '/messages/conversations': [{ id: 'k1', company_id: 'c1', company_title: company.title, last_at: '2026-10-03T10:00:00Z', unread_count: 2 }],
      '/offers/my': { offers: [{ id: 'o1', company_id: 'c1', amount: 280000, status: 'countered', counter_amount: 300000, contract_id: 'ctr1', sale_object: 'titres', company: { title: company.title } }] },
      '/closing/my': { closings: [] },
      '/favorites': { favorites: [{ company_id: 'c1', company }] },
      '/alerts': { alerts: [{ id: 'a1', trades: ['isolation'], regions: ['Bretagne'], max_price: 300000, rge: true, active: true }] },
      '/dataroom/c1/access-status': { access_granted: false, access_status: 'accepted', steps: { identity: false, nda: false, funds: false }, next_step: 'identity', request: { id: 'r1' } },
    });
    const c = await render(<BuyerDashboard user={buyer} setUser={jest.fn()} />, '/buyer/dashboard');
    expectClean(c);
    expect(c.querySelector('[data-testid="profile-incomplete"]').querySelector('a').getAttribute('href')).toBe('/profile');
    const pipeline = c.querySelector('[data-testid="pipeline-list"]');
    expect(pipeline.textContent).toContain('Offre');
    expect(pipeline.textContent).toContain('2 non lus');
    expect(c.querySelector('[data-testid="pipeline-c1"]').getAttribute('href')).toBe('/dataroom/c1');
    expect(c.querySelector('[data-testid="offer-accept-counter-btn"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="offers-todo"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="alert-a1"]').textContent).toContain('Isolation');
    expect(c.querySelector('[data-testid="favorites-list"]').textContent).toContain(company.title);
    expect(c.querySelector('[data-testid="search-cta"]').getAttribute('href')).toBe('/');
  });

  test('espace vide : aucun chiffre à zéro, états vides utiles', async () => {
    mockGet({ '/auth/profile': buyer, '/kyc/status': { verified: true }, '/messages/conversations': [], '/offers/my': { offers: [] }, '/closing/my': { closings: [] }, '/favorites': { favorites: [] }, '/alerts': { alerts: [] } });
    const c = await render(<BuyerDashboard user={buyer} setUser={jest.fn()} />, '/buyer/dashboard');
    expectClean(c);
    expect(c.querySelector('[data-testid="pipeline-empty"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="profile-incomplete"]')).toBeNull();
    expect(c.textContent).toContain('Identité vérifiée');
    expect(c.querySelector('[data-testid="alert-new"]')).not.toBeNull();
  });
});
