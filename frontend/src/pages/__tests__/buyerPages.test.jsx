// Tests de rendu du parcours acquéreur VenteLoc : dossier du bien en checklist (DataroomPage : demande, identité,
// engagement de confidentialité et de non-contournement, origine des fonds, documents par catégorie, fiche de reprise
// du bail, offre d'achat), étape de vente (ClosingPanel : notaire, avant-contrat, acte authentique, facture), espace
// acquéreur (pipeline, alertes, favoris), suivi d'une mise en relation, fonctions pures.
// Exécution : cd frontend && CI=true npx craco test --watchAll=false src/pages/__tests__/buyerPages.test.jsx
import '@/components/shared/jestEnv';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

jest.mock('@/App', () => ({ axiosInstance: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() }, API: '/api', EMAIL_NOT_VERIFIED_EVENT: 'venteloc:email-not-verified' }));
jest.mock('@radix-ui/primitive/is-development', () => jest.requireActual('@radix-ui/primitive/dist/internal/is-development.false.js'), { virtual: true });
jest.mock('@/lib/analytics', () => ({ trackEvent: jest.fn(), trackPageView: jest.fn(), initAnalytics: jest.fn() }));
jest.mock('@/components/SecurePdfViewer', () => () => null);

import { axiosInstance as api } from '@/App';
import DataroomPage from '@/pages/DataroomPage';
import PropertyDetail from '@/pages/PropertyDetail';
import BuyerDashboard from '@/pages/BuyerDashboard';
import FollowupPage from '@/pages/FollowupPage';
import ClosingPanel, { closingSentence } from '@/components/closing/ClosingPanel';
import LeaseTransferPanel from '@/components/buyer/LeaseTransferPanel';
import OfferForm, { offerSummaryText, offerPayload, partsAllowed, OFFER_LEGAL_NOTES } from '@/components/buyer/OfferForm';
import { groupByCategory } from '@/components/buyer/DataroomDocuments';
import { trackEvent } from '@/lib/analytics';
import { buildPipeline, normalizeAccessStatus, normalizeConversations, alertPayload, normalizeAlert, PIPELINE_STAGES, propertyPath } from '@/components/buyer/api';

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
  id: 'b1', role: 'buyer', first_name: 'Claire', last_name: 'Martin', email: 'claire@exemple.fr', email_verified: true, identity_verified: false, profile_score: 90,
  buyer_profile: { project_type: 'particulier', budget_max: 250000, apport: 60000, financing: 'mixte', zones: ['Auvergne-Rhône-Alpes'], property_types: ['appartement'], min_yield: 5, horizon: '0-6' },
};
const seller = { id: 's1', role: 'seller', first_name: 'Michel', last_name: 'Dupont', email: 'michel@exemple.fr', email_verified: true };

const property = {
  id: 'c1', status: 'published', title: 'Appartement T2 loué · 42 m² · Lyon (69)', property_type: 'appartement', owner_type: 'personne-physique',
  city: 'Lyon', postal_code: '69007', department: '69', region: 'Auvergne-Rhône-Alpes', surface: 42, rooms: 2,
  lease_type: 'habitation-vide', rent_monthly: 640, charges_monthly: 60, lease_start: '2023-09-01', deposit: 640,
  dpe_class: 'D', asking_price: 145000, sale_object: 'bien', gross_yield: 5.3, net_yield: 4.2,
  ownership: { status: 'verified' }, published_at: '2026-10-01T10:00:00Z',
};

const mockGet = (routes) => {
  api.get.mockImplementation((url) => {
    // Clé la plus longue qui préfixe l'URL (« /properties/c1/lease-transfer » avant « /properties/c1 »)
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

// Vocabulaire CessionRGE et textes interdits : jamais à l'écran
const BAD = ['repreneur', 'Repreneur', 'cédant', 'Cédant', 'entreprise', 'Entreprise', 'accord de confidentialité', 'Accord de confidentialité', 'offre indicative', 'Offre indicative', 'rédacteur', 'titres', 'BODACC', 'ADEME', 'crédit', '{{', 'undefined', 'N/A'];
const expectClean = (c) => {
  const text = c.textContent;
  BAD.forEach((bad) => expect(text).not.toContain(bad));
  expect(text).not.toMatch(/\bRGE\b/);
  expect(text).not.toMatch(/(^|[^\d])0 (annonce|dossier|offre|alerte|favori)/);
};

const leaseTransfer = {
  lease_type: 'habitation-vide',
  regime: 'habitation',
  points: [
    { key: 'bail-continue', title: 'Le bail continue', text: 'Vous devenez bailleur ; le locataire reste en place (art. 1743 du Code civil).', level: 'info' },
    { key: 'conge', title: 'Pas de reprise immédiate', text: 'Congé pour habiter seulement au terme du bail et au plus tôt deux ans après l\'achat.', level: 'attention' },
  ],
  dpe: { status: 'echeance', date: '2034-01-01', text: 'Logement classé E : il ne pourra plus être reloué à partir de 2034.' },
  summary: ['Le locataire reste en place.', 'Dépôt de garantie réglé à l\'acte.'],
  disclaimer: 'Information générale : le notaire vérifie et rédige.',
};

// ------------------------------------------------------------------------------------------------
describe('fonctions pures', () => {
  test('normalizeAccessStatus : forme API.md et forme historique', () => {
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
    expect(normalizeConversations([{ id: 'k1', property_id: 'c1', unread_count: '2' }], 'b1')[0].unread_count).toBe(2);
    const legacy = normalizeConversations({ c1: [{ sender_id: 's1', receiver_id: 'b1', content: 'Bonjour', created_at: '2026-10-02T10:00:00Z', read: false }] }, 'b1');
    expect(legacy[0]).toMatchObject({ property_id: 'c1', unread_count: 1, last_message: 'Bonjour', legacy: true });
  });

  test('pipeline « Mes dossiers » : contacté, dossier demandé, engagement, dossier, offre, vente', () => {
    expect(PIPELINE_STAGES.map((s) => s.label)).toEqual(['Contacté', 'Dossier demandé', 'Engagement', 'Dossier', 'Offre', 'Vente']);
    const rows = buildPipeline({
      conversations: [{ id: 'k1', property_id: 'c1', last_at: '2026-10-03T10:00:00Z', unread_count: 1 }, { id: 'k2', property_id: 'c2', last_at: '2026-10-01T10:00:00Z' }, { id: 'k3', property_id: 'c3', last_at: '2026-09-01T10:00:00Z' }],
      accessByProperty: {
        c1: normalizeAccessStatus({ access_status: 'pending', request: { created_at: '2026-10-03' } }, buyer),
        c2: normalizeAccessStatus({ access_granted: true, access_status: 'granted' }, buyer),
        c3: normalizeAccessStatus({ access_status: 'accepted', steps: { identity: true, nda: false, funds: false } }, buyer),
      },
      offers: [{ id: 'o1', property_id: 'c2', status: 'countered', created_at: '2026-10-05T10:00:00Z' }],
      closings: [],
      properties: { c1: property },
    });
    expect(rows.map((r) => r.propertyId)).toEqual(['c2', 'c1', 'c3']);
    expect(rows[0].stage).toBe('offer');
    expect(rows[0].detail).toContain('Contre-proposition du vendeur');
    expect(rows[1].stage).toBe('requested');
    expect(rows[1].detail).toContain('vendeur');
    expect(rows[1].unread).toBe(1);
    expect(rows[1].title).toBe(property.title);
    expect(rows[2].stage).toBe('nda');
    expect(rows[2].detail).toContain('engagement de confidentialité');
  });

  test('alertes : property_types, regions, max_price, min_yield (API.md §8)', () => {
    const p = alertPayload({ propertyTypes: ['appartement', 'maison'], regions: ['Bretagne'], maxPrice: '250000', minYield: '5,5', typeLabel: (t) => t });
    expect(p).toMatchObject({ property_types: ['appartement', 'maison'], regions: ['Bretagne'], max_price: 250000, min_yield: 5.5 });
    expect(p).not.toHaveProperty('trades');
    expect(p).not.toHaveProperty('rge');
    expect(p.name).toContain('Bretagne');
    expect(alertPayload({ propertyTypes: [], regions: [], maxPrice: '', minYield: '' })).toMatchObject({ max_price: null, min_yield: null, name: 'Tous les biens · Toute la France' });
    expect(normalizeAlert({ id: 'a1', property_types: ['parking'], regions: [], max_price: 30000, min_yield: 6 })).toMatchObject({ propertyTypes: ['parking'], maxPrice: 30000, minYield: 6 });
  });

  test('offre d\'achat : corps POST /offers (API.md §5)', () => {
    const base = { amount: '140000', sale_object: 'bien', equity: '40000', loan: '110000', conditions: ['Visite'], target_date: '2026-11-20', validity_days: '10', message: '  ' };
    expect(offerPayload('c1', { ...base, loan_required: false })).toEqual({
      property_id: 'c1', amount: 140000, sale_object: 'bien', financing: { equity: 40000, loan: 110000 }, loan_condition: { required: false },
      conditions: ['Visite'], target_date: '2026-11-20', validity_days: 10, message: null,
    });
    expect(offerPayload('c1', { ...base, loan_required: true, loan_amount: '', loan_max_rate: '3,9', loan_duration_years: '20' }).loan_condition)
      .toEqual({ required: true, amount: 110000, max_rate: 3.9, duration_years: 20 });
    expect(partsAllowed({ owner_type: 'sci' })).toBe(true);
    expect(partsAllowed({ owner_type: 'personne-physique', sale_object: 'bien' })).toBe(false);
  });

  test('offerSummaryText : offre d\'achat lisible, notes juridiques, aucune variable brute', () => {
    const text = offerSummaryText({ amount: 140000, sale_object: 'bien', financing: { equity: 40000, loan: 100000 }, loan_condition: { required: true, amount: 100000, duration_years: 20, max_rate: 3.9 }, conditions: ['Visite du bien'], target_date: '2027-02-01', validity_days: 10 }, property.title);
    expect(text).toContain('OFFRE D\'ACHAT');
    expect(text).toContain('140');
    expect(text).toContain('Vente du bien');
    expect(text).toContain('condition suspensive');
    expect(text).toContain('3,9 %');
    expect(text).toContain('Visite du bien');
    expect(text).toContain('n\'emporte pas vente');
    expect(text).toContain('L271-1');
    expect(text).not.toContain('{{');
    expect(text).not.toContain('undefined');
    expect(OFFER_LEGAL_NOTES.join(' ')).toContain('L313-40');
  });

  test('closingSentence : phrases lisibles selon statut et rôle', () => {
    const declared = { status: 'declared', declaration: { declared_by: 'buyer', signed_on: '2026-10-05', final_price: 140000, confirm_deadline: '2026-10-12T10:00:00Z' } };
    expect(closingSentence(declared, 'seller')).toContain('Confirmez ou contestez');
    expect(closingSentence(declared, 'seller')).toContain('L\'acquéreur a déclaré');
    expect(closingSentence(declared, 'buyer')).toContain('Vous avez déclaré la signature de l\'acte authentique');
    expect(closingSentence({ status: 'confirmed', confirmed_at: '2026-10-12' }, 'buyer')).toContain('rien ne vous est demandé');
    expect(closingSentence({ status: 'in_progress', avant_contrat_on: '2026-10-20' }, 'buyer')).toContain('Avant-contrat signé le');
    expect(closingSentence({ status: 'in_progress' }, 'seller')).toContain('notaire');
  });

  test('dossier du bien : catégories SPEC §6.3 dans l\'ordre, inconnues rangées dans « Autres »', () => {
    const groups = groupByCategory([
      { id: 'd1', category: 'diagnostics' }, { id: 'd2', category: 'bail' }, { id: 'd3', category: 'financier' }, { id: 'd4', category: 'loyers' },
    ]);
    expect(groups.map((g) => g.id)).toEqual(['bail', 'loyers', 'diagnostics', 'autres']);
    expect(groups[0].label).toBe('Bail et avenants');
  });

  test('propertyPath : page publique /annonce/:id', () => {
    expect(propertyPath('c1')).toBe('/annonce/c1');
  });
});

// ------------------------------------------------------------------------------------------------
describe('LeaseTransferPanel', () => {
  test('fiche de reprise du bail : essentiel, décence énergétique, points d\'attention, avertissement', async () => {
    const c = await render(<LeaseTransferPanel data={leaseTransfer} />);
    expectClean(c);
    const panel = c.querySelector('[data-testid="lease-transfer"]');
    expect(panel.textContent).toContain('Fiche de reprise du bail');
    expect(panel.textContent).toContain('Bail d\'habitation vide');
    expect(panel.textContent).toContain('1 point d\'attention');
    expect(c.querySelector('[data-testid="lease-summary"]').textContent).toContain('Le locataire reste en place.');
    expect(c.querySelector('[data-testid="lease-dpe"]').textContent).toContain('2034');
    expect(c.querySelector('[data-testid="lease-dpe"]').className).toContain('bg-brand-amber-soft');
    expect(c.querySelector('[data-testid="lease-point-conge"]').textContent).toContain('point d\'attention');
    expect(c.querySelector('[data-testid="lease-point-bail-continue"]').textContent).toContain('art. 1743');
    expect(c.querySelector('[data-testid="lease-disclaimer"]').textContent).toContain('notaire');
  });

  test('sans données : rien n\'est affiché', async () => {
    const c = await render(<LeaseTransferPanel data={null} />);
    expect(c.querySelector('[data-testid="lease-transfer"]')).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------
describe('OfferForm', () => {
  test('bien en nom propre : objet fixé au bien, condition de prêt, validité 5-30 jours, notes juridiques', async () => {
    api.post.mockResolvedValue({ data: { offer: { id: 'o1', amount: 140000 }, contract_id: 'ctr1', content: 'OFFRE D\'ACHAT — texte' } });
    const c = await render(<OfferForm property={property} onSigned={jest.fn()} />);
    expectClean(c);
    expect(c.querySelector('[data-testid="offer-sale-object"]')).toBeNull();
    expect(c.querySelector('[data-testid="offer-sale-object-fixed"]').textContent).toBe('Vente du bien');
    const notes = c.querySelector('[data-testid="offer-legal-notes"]').textContent;
    expect(notes).toContain('n\'emporte pas vente');
    expect(notes).toContain('L313-40');
    expect(notes).toContain('10 jours');
    expect(notes).toContain('AlterEgo SAS');
    expect(c.querySelector('[data-testid="offer-amount"]').value).toBe('145000');
    // Validité hors bornes : refusée
    setValue(c.querySelector('[data-testid="offer-validity"]'), '45');
    await click(c.querySelector('[data-testid="offer-submit"]'));
    expect(api.post).not.toHaveBeenCalled();
    expect(c.textContent).toContain('Entre 5 et 30 jours.');
    setValue(c.querySelector('[data-testid="offer-validity"]'), '7');
    setValue(c.querySelector('[data-testid="offer-amount"]'), '140000');
    setValue(c.querySelector('[data-testid="offer-equity"]'), '40000');
    setValue(c.querySelector('[data-testid="offer-loan"]'), '110000');
    await click(c.querySelector('[data-testid="offer-loan-required"]'));
    expect(c.querySelector('[data-testid="offer-loan-amount"]').value).toBe('110000');
    setValue(c.querySelector('[data-testid="offer-loan-rate"]'), '3.8');
    setValue(c.querySelector('[data-testid="offer-loan-years"]'), '20');
    await click(c.querySelector('[data-testid="offer-submit"]'));
    expect(api.post).toHaveBeenCalledWith('/offers', expect.objectContaining({
      property_id: 'c1', amount: 140000, sale_object: 'bien', financing: { equity: 40000, loan: 110000 },
      loan_condition: { required: true, amount: 110000, max_rate: 3.8, duration_years: 20 }, validity_days: 7, conditions: [],
    }));
    const body = api.post.mock.calls[0][1];
    expect(Object.keys(body.financing)).toEqual(['equity', 'loan']);
    expect(document.querySelector('[data-testid="otp-signature-dialog"]').textContent).toContain('Signer mon offre d\'achat');
    expect(sessionStorage.getItem('offer_text:ctr1')).toContain('OFFRE D\'ACHAT');
  });

  test('bien détenu par une SCI : choix bien ou parts de la société', async () => {
    api.post.mockResolvedValue({ data: { offer: { id: 'o2' }, contract_id: 'ctr2', content: 'texte' } });
    const c = await render(<OfferForm property={{ ...property, owner_type: 'sci', sale_object: 'indifferent' }} onSigned={jest.fn()} />);
    const select = c.querySelector('[data-testid="offer-sale-object"]');
    expect(select.value).toBe('bien');
    expect(select.textContent).toContain('Cession des parts de la société');
    setValue(select, 'parts');
    await click(c.querySelector('[data-testid="offer-submit"]'));
    expect(api.post).toHaveBeenCalledWith('/offers', expect.objectContaining({ sale_object: 'parts', loan_condition: { required: false }, validity_days: 10 }));
  });
});

// ------------------------------------------------------------------------------------------------
// Fiche publique vue par l'acquéreur : contact, profil incomplet, favori, vendeur propriétaire (page du lot public,
// testée ici pour le parcours acquéreur)
describe('PropertyDetail (parcours acquéreur)', () => {
  test('visiteur : favori → inscription acquéreur ; aucune adresse ni identité affichée', async () => {
    mockGet({ '/properties/c1': property });
    const c = await render(<PropertyDetail user={null} />, '/annonce/c1', '/annonce/:id', <Route path="/register" element={<p data-testid="register-page">Inscription</p>} />);
    expectClean(c);
    expect(c.textContent).toContain(property.title);
    expect(c.querySelector('[data-testid="revealed-identity"]')).toBeNull();
    await click(c.querySelector('[data-testid="favorite-btn"]'));
    expect(c.querySelector('[data-testid="register-page"]')).not.toBeNull();
  });

  test('acquéreur : « Présenter mon projet au vendeur » → message prérempli → POST contact → messagerie', async () => {
    mockGet({ '/properties/c1': property, '/favorites/check/c1': { favorited: false } });
    api.post.mockResolvedValue({ data: { conversation_id: 'conv1' } });
    const c = await render(<PropertyDetail user={buyer} />, '/annonce/c1', '/annonce/:id', <Route path="/messages" element={<p data-testid="messages-page">Messagerie</p>} />);
    expect(c.querySelector('[data-testid="dataroom-link"]').getAttribute('href')).toBe('/dataroom/c1');
    await click(c.querySelector('[data-testid="contact-seller-btn"]'));
    const textarea = c.querySelector('[data-testid="contact-message"]');
    expect(textarea.value).toContain('250');
    expect(textarea.value).not.toMatch(/repreneur|cédant|entreprise/i);
    await click(c.querySelector('[data-testid="contact-send-btn"]'));
    expect(api.post).toHaveBeenCalledWith('/properties/c1/contact', { message: expect.stringContaining('Bonjour') });
    expect(trackEvent).toHaveBeenCalledWith('contact_sent', expect.objectContaining({ source: 'fiche' }));
    expect(c.querySelector('[data-testid="messages-page"]')).not.toBeNull();
  });

  test('acquéreur : 403 profile_incomplete → message et lien vers le profil', async () => {
    mockGet({ '/properties/c1': property, '/favorites/check/c1': { favorited: true } });
    api.post.mockRejectedValue({ response: { status: 403, data: { detail: { code: 'profile_incomplete', message: 'Complétez votre profil d\'investisseur (40 % requis)' } } } });
    const c = await render(<PropertyDetail user={buyer} />, '/annonce/c1', '/annonce/:id');
    expect(c.querySelector('[data-testid="favorite-btn"]').textContent).toContain('Dans mes favoris');
    await click(c.querySelector('[data-testid="contact-seller-side-btn"]'));
    await click(c.querySelector('[data-testid="contact-send-btn"]'));
    const err = c.querySelector('[data-testid="contact-error"]');
    expect(err.textContent).toContain('40 %');
    expect(err.querySelector('a').getAttribute('href')).toBe('/profile');
  });

  test('vendeur propriétaire : pas de contact, dénomination non affichée comme révélée', async () => {
    mockGet({ '/properties/c1': { ...property, seller_id: 's1', company_name: 'SCI Les Tilleuls' } });
    const c = await render(<PropertyDetail user={seller} />, '/annonce/c1', '/annonce/:id');
    expect(c.querySelector('[data-testid="contact-seller-btn"]')).toBeNull();
    expect(c.querySelector('[data-testid="revealed-identity"]')).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------
describe('DataroomPage', () => {
  const base = { '/properties/c1': property, '/kyc/status': { verified: false, status: 'not_started' }, '/offers/my': { offers: [] } };

  test('sans demande : étape 1 en cours, bouton « Demander le dossier » → POST request-access', async () => {
    mockGet({ ...base, '/dataroom/c1/access-status': { access_granted: false, access_status: null, steps: { identity: false, nda: false, funds: false }, next_step: null, request: null } });
    api.post.mockResolvedValue({ data: { request_id: 'r1', status: 'pending' } });
    const c = await render(<DataroomPage user={buyer} />, '/dataroom/c1', '/dataroom/:propertyId');
    expectClean(c);
    expect(c.textContent).toContain('Dossier du bien');
    expect(c.querySelector('[aria-current="step"]').textContent).toContain('Dossier demandé au vendeur');
    expect(c.querySelector('[data-testid="revealed-info"]')).toBeNull();
    await click(c.querySelector('[data-testid="request-access-btn"]'));
    expect(api.post).toHaveBeenCalledWith('/dataroom/c1/request-access', {});
  });

  test('accepté, identité non vérifiée : étape identité en cours avec le bouton Stripe et retour mémorisé', async () => {
    mockGet({ ...base, '/dataroom/c1/access-status': { access_granted: false, access_status: 'accepted', steps: { identity: false, nda: false, funds: false }, next_step: 'identity', request: { id: 'r1', created_at: '2026-10-01', expires_at: '2026-10-11' } } });
    const c = await render(<DataroomPage user={buyer} />, '/dataroom/c1', '/dataroom/:propertyId');
    expect(c.querySelector('[aria-current="step"]').textContent).toContain('Identité vérifiée');
    expect(c.textContent).toContain('Vérifier mon identité');
    expect(sessionStorage.getItem('kyc_return_to')).toBe('/dataroom/c1');
  });

  test('identité vérifiée : « Lire et signer l\'engagement » → generate-for-signature (doc_type nda) puis dialogue', async () => {
    mockGet({ ...base, '/kyc/status': { verified: true }, '/dataroom/c1/access-status': { access_granted: false, access_status: 'accepted', steps: { identity: true, nda: false, funds: false }, next_step: 'nda', request: { id: 'r1' } } });
    api.post.mockResolvedValue({ data: { contract_id: 'nda1', contract_number: 'ENG-1', content: 'ENGAGEMENT DE CONFIDENTIALITÉ ET DE NON-CONTOURNEMENT — texte intégral', terms_date: '14/10/2026' } });
    const c = await render(<DataroomPage user={{ ...buyer, identity_verified: true }} />, '/dataroom/c1', '/dataroom/:propertyId');
    const current = c.querySelector('[aria-current="step"]').textContent;
    expect(current).toContain('Engagement de confidentialité et de non-contournement');
    expect(current).toContain('locataire');
    await click(c.querySelector('[data-testid="nda-btn"]'));
    expect(api.post).toHaveBeenCalledWith('/contracts/generate-for-signature', { property_id: 'c1', doc_type: 'nda' });
    const dialog = document.querySelector('[data-testid="otp-signature-dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain('texte intégral');
    expect(dialog.textContent).toContain('Engagement de confidentialité et de non-contournement');
    expect(dialog.textContent).toContain('Version du 14/10/2026');
  });

  test('engagement signé : formulaire d\'origine des fonds → POST funds-declaration', async () => {
    mockGet({ ...base, '/kyc/status': { verified: true }, '/dataroom/c1/access-status': { access_granted: false, access_status: 'accepted', steps: { identity: true, nda: true, funds: false }, next_step: 'funds', request: { id: 'r1' } } });
    api.post.mockResolvedValue({ data: { access_granted: true } });
    const c = await render(<DataroomPage user={{ ...buyer, identity_verified: true }} />, '/dataroom/c1', '/dataroom/:propertyId');
    expectClean(c);
    expect(c.querySelector('[aria-current="step"]').textContent).toContain('Origine des fonds');
    expect(c.querySelector('[data-testid="funds-source"]').textContent).toContain('Fonds propres');
    setValue(c.querySelector('[data-testid="funds-source"]'), 'mixte');
    setValue(c.querySelector('[data-testid="funds-amount"]'), '200000');
    await click(c.querySelector('[data-testid="funds-attest"]'));
    await click(c.querySelector('[data-testid="funds-submit"]'));
    expect(api.post).toHaveBeenCalledWith('/dataroom/c1/funds-declaration', { source: 'mixte', amount: 200000, financing_partner: null });
  });

  test('accès accordé : adresse révélée, documents par catégorie, fiche de reprise du bail, offre d\'achat', async () => {
    mockGet({
      ...base,
      '/properties/c1': { ...property, address: '12 rue de Marseille', company_name: 'SCI Les Tilleuls', siret: '12345678900012', owner_type: 'sci' },
      '/kyc/status': { verified: true },
      '/dataroom/c1/access-status': { access_granted: true, access_status: 'granted', steps: { identity: true, nda: true, funds: true }, next_step: null, request: { id: 'r1' } },
      '/dataroom/c1/documents': { documents: [{ id: 'd1', filename: 'bail-2023.pdf', category: 'bail', uploaded_at: '2026-10-02' }, { id: 'd2', filename: 'dpe.pdf', category: 'diagnostics' }], access_granted: true },
      '/properties/c1/lease-transfer': leaseTransfer,
    });
    const c = await render(<DataroomPage user={{ ...buyer, identity_verified: true }} />, '/dataroom/c1', '/dataroom/:propertyId');
    expectClean(c);
    expect(api.get).toHaveBeenCalledWith('/properties/c1/lease-transfer');
    expect(c.querySelector('[data-testid="revealed-address"]').textContent).toContain('12 rue de Marseille, 69007 Lyon');
    expect(c.querySelector('[data-testid="revealed-name"]').textContent).toContain('SCI Les Tilleuls');
    const docs = c.querySelector('[data-testid="dataroom-documents"]');
    expect(docs.textContent).toContain('bail-2023.pdf');
    expect(c.querySelector('[data-testid="dataroom-category-bail"]').textContent).toContain('Bail et avenants');
    expect(c.querySelector('[data-testid="dataroom-category-diagnostics"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="lease-transfer"]').textContent).toContain('Le bail continue');
    expect(c.textContent).toContain('Offre d\'achat');
    await click(c.querySelector('[data-testid="open-offer-form"]'));
    expect(c.querySelector('[data-testid="offer-form"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="offer-sale-object"]')).not.toBeNull();
    api.post.mockResolvedValue({ data: { offer: { id: 'o1', amount: 145000 }, contract_id: 'ctr1', content: 'OFFRE D\'ACHAT — texte' } });
    await click(c.querySelector('[data-testid="offer-submit"]'));
    expect(api.post).toHaveBeenCalledWith('/offers', expect.objectContaining({ property_id: 'c1', amount: 145000, sale_object: 'bien', validity_days: 10, loan_condition: { required: false } }));
    expect(document.querySelector('[data-testid="otp-signature-dialog"]')).not.toBeNull();
  });

  test('vendeur : renvoi vers son espace', async () => {
    mockGet({ ...base, '/dataroom/c1/access-status': { access_granted: true, is_seller: true } });
    const c = await render(<DataroomPage user={seller} />, '/dataroom/c1', '/dataroom/:propertyId');
    expect(c.textContent).toContain('Vous êtes le vendeur de ce bien');
  });
});

// ------------------------------------------------------------------------------------------------
describe('ClosingPanel', () => {
  const closing = {
    id: 'cl1', property_id: 'c1', property_title: property.title, seller_id: 's1', buyer_id: 'b1', offer_id: 'o1', offer_amount: 140000, sale_object: 'bien',
    expected_date: '2026-11-15', accepted_at: '2026-10-05T10:00:00Z', redacteur: null, avant_contrat_on: null, status: 'in_progress', status_label: 'Vente en cours', declaration: null, invoice: null,
    seller_name: 'Michel Dupont', buyer_name: 'Claire Martin', commission_preview: { final_commission_ht: 4200, final_commission_ttc: 5040 },
  };

  test('vendeur, vente en cours : notaire, avant-contrat, puis acte authentique', async () => {
    api.put.mockImplementation((url) => Promise.resolve({ data: url.endsWith('/avant-contrat') ? { ...closing, role: 'seller', avant_contrat_on: '2026-10-10' } : { ...closing, role: 'seller', redacteur: { type: 'notaire', name: 'Étude Le Gall' } } }));
    api.post.mockResolvedValue({ data: { ...closing, role: 'seller', status: 'declared', declaration: { declared_by: 'seller', signed_on: '2026-10-09', final_price: 138000, sale_object: 'bien', confirm_deadline: '2026-10-16T10:00:00Z' } } });
    const onChange = jest.fn();
    const c = await render(<ClosingPanel closing={{ ...closing, role: 'seller' }} user={seller} onChange={onChange} />);
    expectClean(c);
    expect(c.querySelector('[data-testid="closing-status"]').textContent).toBe('Vente en cours');
    expect(c.querySelector('[data-testid="closing-sentence"]').textContent).toContain('notaire');
    expect(c.textContent).toContain('Acquéreur : Claire Martin');
    expect(c.textContent).toContain('Notaire en charge de la vente');
    const types = c.querySelector('[data-testid="redacteur-type"]');
    expect(Array.from(types.options).map((o) => o.value)).toEqual(['', 'notaire', 'autre']);
    setValue(types, 'notaire');
    setValue(c.querySelector('[data-testid="redacteur-name"]'), 'Étude Le Gall');
    await click(c.querySelector('[data-testid="redacteur-submit"]'));
    expect(api.put).toHaveBeenCalledWith('/closing/cl1/redacteur', { type: 'notaire', name: 'Étude Le Gall', email: null, phone: null });
    setValue(c.querySelector('[data-testid="avant-contrat-date"]'), '2026-10-10');
    await click(c.querySelector('[data-testid="avant-contrat-submit"]'));
    expect(api.put).toHaveBeenCalledWith('/closing/cl1/avant-contrat', { avant_contrat_on: '2026-10-10' });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ avant_contrat_on: '2026-10-10' }));
    const objects = c.querySelector('[data-testid="declare-object"]');
    expect(Array.from(objects.options).map((o) => o.value)).toEqual(['', 'bien', 'parts']);
    expect(objects.value).toBe('bien');
    setValue(c.querySelector('[data-testid="declare-date"]'), '2026-10-09');
    setValue(c.querySelector('[data-testid="declare-price"]'), '138000');
    expect(c.querySelector('[data-testid="declare-commission"]').textContent).toContain('notaire');
    await click(c.querySelector('[data-testid="declare-submit"]'));
    expect(api.post).toHaveBeenCalledWith('/closing/cl1/declare', { signed_on: '2026-10-09', final_price: 138000, sale_object: 'bien' });
  });

  test('avant-contrat déjà renseigné : date affichée et modifiable tant que l\'acte n\'est pas déclaré', async () => {
    const c = await render(<ClosingPanel closing={{ ...closing, role: 'buyer', avant_contrat_on: '2026-10-10', redacteur: { type: 'notaire', name: 'Étude Le Gall' } }} user={buyer} onChange={jest.fn()} />);
    expect(c.querySelector('[data-testid="avant-contrat-on"]').textContent).toContain('2026');
    expect(c.querySelector('[data-testid="avant-contrat-form"]')).toBeNull();
    expect(c.querySelector('[data-testid="avant-contrat-edit"]')).not.toBeNull();
    const declared = await render(<ClosingPanel closing={{ ...closing, role: 'buyer', status: 'declared', avant_contrat_on: '2026-10-10', declaration: { declared_by: 'buyer', signed_on: '2026-10-20', final_price: 140000, sale_object: 'bien', confirm_deadline: '2026-10-27T10:00:00Z' } }} user={buyer} onChange={jest.fn()} />);
    expect(declared.querySelector('[data-testid="avant-contrat-edit"]')).toBeNull();
    expect(declared.querySelector('[data-testid="avant-contrat-form"]')).toBeNull();
  });

  test('acquéreur, acte déclaré par le vendeur : bandeau de confirmation, contestation avec motif', async () => {
    const declared = { ...closing, role: 'buyer', status: 'declared', status_label: 'Acte authentique déclaré, en attente de confirmation', declaration: { declared_by: 'seller', signed_on: '2026-10-09', final_price: 138000, sale_object: 'bien', confirm_deadline: '2026-10-16T10:00:00Z' } };
    api.post.mockResolvedValue({ data: { ...declared, status: 'disputed' } });
    const c = await render(<ClosingPanel closing={declared} user={buyer} onChange={jest.fn()} />);
    const banner = c.querySelector('[data-testid="confirm-banner"]');
    expect(banner.textContent).toContain('déclaré par le vendeur');
    expect(banner.textContent).toContain('138');
    expect(c.querySelector('[data-testid="declare-form"]')).toBeNull();
    await click(c.querySelector('[data-testid="dispute-btn"]'));
    setValue(c.querySelector('[data-testid="dispute-reason"]'), 'Le prix indiqué est inexact.');
    await click(c.querySelector('[data-testid="dispute-submit"]'));
    expect(api.post).toHaveBeenCalledWith('/closing/cl1/dispute', { reason: 'Le prix indiqué est inexact.' });
  });

  test('vente confirmée : facture et ordre de paiement au notaire pour le vendeur, rien demandé à l\'acquéreur', async () => {
    const confirmed = { ...closing, status: 'confirmed', status_label: 'Vente confirmée', confirmed_at: '2026-10-16T10:00:00Z', confirmed_by: 'auto', declaration: { declared_by: 'seller', signed_on: '2026-10-09', final_price: 138000, sale_object: 'bien' }, invoice: { id: 'inv1', number: 'FAC-2026-00001', total_ht: 4140, vat: 828, total_ttc: 4968, due_on: '2026-11-08', status: 'issued' } };
    const s = await render(<ClosingPanel closing={{ ...confirmed, role: 'seller' }} user={seller} onChange={jest.fn()} />);
    const card = s.querySelector('[data-testid="invoice-card"]');
    expect(card.textContent).toContain('FAC-2026-00001');
    expect(card.textContent).toContain('notaire');
    expect(s.querySelector('[data-testid="invoice-pdf-btn"]')).not.toBeNull();
    expect(s.querySelector('[data-testid="payment-order-btn"]').textContent).toContain('Ordre de paiement pour le notaire');
    expect(s.querySelector('[data-testid="declare-form"]')).toBeNull();
    const b = await render(<ClosingPanel closing={{ ...confirmed, role: 'buyer' }} user={buyer} onChange={jest.fn()} />);
    expect(b.querySelector('[data-testid="invoice-pdf-btn"]')).toBeNull();
    expect(b.textContent).toContain('rien ne vous est demandé');
  });
});

// ------------------------------------------------------------------------------------------------
describe('BuyerDashboard', () => {
  test('pipeline par étape, offres d\'achat, alertes, favoris ; profil incomplet → lien ; aucun compteur à zéro', async () => {
    mockGet({
      '/auth/profile': { ...buyer, profile_score: 30 },
      '/kyc/status': { verified: false },
      '/messages/conversations': [{ id: 'k1', property_id: 'c1', property_title: property.title, last_at: '2026-10-03T10:00:00Z', unread_count: 2 }],
      '/offers/my': { offers: [{ id: 'o1', property_id: 'c1', amount: 140000, status: 'countered', counter_amount: 143000, contract_id: 'ctr1', sale_object: 'bien', loan_condition: { required: true, amount: 100000 }, property: { title: property.title } }] },
      '/closing/my': { closings: [] },
      '/favorites': { favorites: [{ property_id: 'c1', property }] },
      '/alerts': { alerts: [{ id: 'a1', property_types: ['appartement'], regions: ['Bretagne'], max_price: 250000, min_yield: 5, active: true }] },
      '/dataroom/c1/access-status': { access_granted: false, access_status: 'accepted', steps: { identity: false, nda: false, funds: false }, next_step: 'identity', request: { id: 'r1' } },
    });
    const c = await render(<BuyerDashboard user={buyer} setUser={jest.fn()} />, '/buyer/dashboard');
    expectClean(c);
    expect(c.textContent).toContain('Espace acquéreur');
    expect(c.querySelector('[data-testid="profile-incomplete"]').querySelector('a').getAttribute('href')).toBe('/profile');
    const pipeline = c.querySelector('[data-testid="pipeline-list"]');
    expect(pipeline.textContent).toContain('Offre');
    expect(pipeline.textContent).toContain('2 non lus');
    expect(c.querySelector('[data-testid="pipeline-c1"]').getAttribute('href')).toBe('/dataroom/c1');
    expect(c.querySelector('[data-testid="offer-accept-counter-btn"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="offer-loan-text"]').textContent).toContain('condition suspensive');
    expect(c.querySelector('[data-testid="offer-o1"] a').getAttribute('href')).toBe('/annonce/c1');
    expect(c.querySelector('[data-testid="offers-todo"]')).not.toBeNull();
    const alert = c.querySelector('[data-testid="alert-a1"]').textContent;
    expect(alert).toContain('Appartement');
    expect(alert).toContain('Bretagne');
    expect(alert).toContain('rendement brut ≥ 5 %');
    expect(c.querySelector('[data-testid="favorites-list"]').textContent).toContain(property.title);
    expect(c.querySelector('[data-testid="search-cta"]').getAttribute('href')).toBe('/');
  });

  test('alerte : création avec types de biens et rendement minimum → POST /alerts', async () => {
    mockGet({ '/auth/profile': buyer, '/kyc/status': { verified: true }, '/messages/conversations': [], '/offers/my': { offers: [] }, '/closing/my': { closings: [] }, '/favorites': { favorites: [] }, '/alerts': { alerts: [] } });
    api.post.mockResolvedValue({ data: { id: 'a2' } });
    const c = await render(<BuyerDashboard user={buyer} setUser={jest.fn()} />, '/buyer/dashboard');
    await click(c.querySelector('[data-testid="alert-new"]'));
    const editor = c.querySelector('[data-testid="alert-editor"]');
    expect(editor.textContent).toContain('Types de biens');
    expect(editor.textContent).not.toMatch(/Métiers|RGE/);
    await click(editor.querySelector('input[value="maison"]'));
    await click(editor.querySelector('input[value="Bretagne"]'));
    setValue(c.querySelector('[data-testid="alert-max-price"]'), '250000');
    setValue(c.querySelector('[data-testid="alert-min-yield"]'), '6');
    await click(c.querySelector('[data-testid="alert-save"]'));
    expect(api.post).toHaveBeenCalledWith('/alerts', expect.objectContaining({ property_types: ['maison'], regions: ['Bretagne'], max_price: 250000, min_yield: 6 }));
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

// ------------------------------------------------------------------------------------------------
describe('FollowupPage', () => {
  test('réponse du lien de l\'e-mail enregistrée, commentaire facultatif', async () => {
    api.post.mockResolvedValue({ data: { label: 'Visite faite ou prévue' } });
    const c = await render(<FollowupPage />, '/suivi?token=tok123&r=rencontre', '/suivi');
    expectClean(c);
    expect(api.post).toHaveBeenCalledWith('/followup/tok123', { answer: 'rencontre' });
    expect(c.querySelector('[data-testid="followup-done"]').textContent).toContain('Visite faite ou prévue');
    setValue(c.querySelector('#followup-comment'), 'Compromis prévu la semaine prochaine.');
    await click(c.querySelector('[data-testid="followup-comment-send"]'));
    expect(api.post).toHaveBeenLastCalledWith('/followup/tok123', { answer: 'rencontre', comment: 'Compromis prévu la semaine prochaine.' });
  });

  test('sans jeton : lien invalide', async () => {
    const c = await render(<FollowupPage />, '/suivi', '/suivi');
    expect(c.querySelector('[data-testid="followup-invalid"]')).not.toBeNull();
  });
});
