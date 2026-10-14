// Tests de l'espace vendeur (docs/venteloc/SPEC.md §5.2) : formulaire d'annonce en 3 écrans (le bien, la location, la
// vente : SIRET si société, adresse confidentielle, code postal → ville, copropriété, DPE, rendements en direct, alerte
// hors 2 %-15 %, aperçu), justificatif de propriété après l'enregistrement, mandat (qualité du signataire, rétractation
// 14 jours, honoraires TTC d'abord), tableau de bord vendeur (« À traiter », justificatif, rétractation).
// Exécution : cd frontend && CI=true npx craco test --watchAll=false src/pages/__tests__/sellerPages.test.jsx
import '@/components/shared/jestEnv';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

jest.mock('@/App', () => ({ axiosInstance: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() }, API: '/api', EMAIL_NOT_VERIFIED_EVENT: 'venteloc:email-not-verified' }));
// Jest 27 (react-scripts) ne lit pas le champ « exports » des paquets Radix : sous-chemin résolu à la main
jest.mock('@radix-ui/primitive/is-development', () => jest.requireActual('@radix-ui/primitive/dist/internal/is-development.false.js'), { virtual: true });
jest.mock('@/lib/analytics', () => ({ trackEvent: jest.fn(), trackPageView: jest.fn(), initAnalytics: jest.fn() }));

import { axiosInstance as api } from '@/App';
import CreateListing, { fetchCities } from '@/pages/CreateListing';
import MandatePage, { capacitiesFor } from '@/pages/MandatePage';
import SellerDashboard from '@/pages/SellerDashboard';
import OtpSignatureDialog from '@/components/OtpSignatureDialog';
import {
  findContactDetails, validateStep, emptyForm, readEstimateSession, applyEstimateToForm, step1Payload, step2Payload, step3Payload,
  formFromProperty, liveYields, yieldAlert, firstIncompleteStep, previewProperty,
} from '@/components/seller/listingForm';
import {
  mandateStatusSentence, withdrawalOpen, apiRelativePath, MANDATE_TAIL_MONTHS, MANDATE_DURATION_MONTHS, MANDATE_WITHDRAWAL_DAYS,
} from '@/lib/mandate';
import { resetCommissionCache } from '@/lib/useCommission';

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
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={routePath} element={ui} />
          <Route path="/seller/mandat/:propertyId" element={<p data-testid="page-mandate">mandat</p>} />
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
const setValue = async (el, value) => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
  await flush();
};
const byId = (c, id) => c.querySelector(`[data-testid="${id}"]`);
const pick = (c, id) => click(c.querySelector(`[data-testid="${id}"] input`));

const user = { id: 'u1', role: 'seller', first_name: 'Michel', last_name: 'Dupont', email: 'michel@exemple.fr', email_verified: true, identity_verified: false };
const property = {
  id: 'c1', seller_id: 'u1', status: 'published', title: 'Appartement T2 loué · 42 m² · Lyon (69)', property_type: 'appartement', owner_type: 'personne-physique',
  address: '12 rue des Lilas', postal_code: '69007', city: 'Lyon', department: '69', region: 'Auvergne-Rhône-Alpes', surface: 42, rooms: 2, floor: 3,
  elevator: true, is_copro: true, copro_lots: 24, copro_charges_annual: 960, copro_procedure: false, dpe_class: 'D', energy_cost_min: 900,
  energy_cost_max: 1300, lease_type: 'habitation-vide', rent_monthly: 620, charges_monthly: 60, lease_start: '2019-03-01', deposit: 620,
  property_tax: 650, non_recoverable_charges: 400, asking_price: 145000, sale_object: 'bien', gross_yield: 5.13, net_yield: 4.41,
  ownership: { status: 'verified' }, views: 12, mandat_signed: true, mandate_id: 'm1',
};
const IN_FUTURE = new Date(Date.now() + 5 * 86400000).toISOString();
const mandat = {
  id: 'm1', status: 'signed', registry_number: 12, contract_number: 'MANDAT-2026', signed_at: '2026-10-01T10:00:00Z', ends_at: '2027-10-01T10:00:00Z',
  tail_ends_at: '2028-10-01T10:00:00Z', withdrawal_ends_at: '2026-10-15T10:00:00Z', terms_version: 'v1',
};
const buyerCard = {
  label: 'Acquéreur n°123456', project_type: 'particulier', budget_max: 200000, apport: 40000, financing: 'mixte', zones: ['Auvergne-Rhône-Alpes'],
  property_types: ['appartement'], min_yield: 5, horizon: '0-6', siren_verified: false, profile_score: 70,
};
const SUMMARY = ['Mandat simple, sans exclusivité.', 'Objet : la vente du bien.', 'Durée 12 mois, résiliable à tout moment.', 'Honoraires à votre charge, dus uniquement à l\'acte.', 'Rétractation possible pendant 14 jours.'];

const route = (url, table) => {
  const key = Object.keys(table).find((k) => url.startsWith(k));
  return key ? table[key] : {};
};

let getTable;
beforeEach(() => {
  resetCommissionCache();
  // geo.api.gouv.fr (communes d'un code postal) et GET /config : réponses locales, jamais de requête réseau
  global.fetch = jest.fn((url) => Promise.resolve({
    ok: true,
    status: 200,
    json: async () => (String(url).includes('geo.api.gouv.fr') ? (String(url).includes('69007') ? [{ nom: 'Lyon' }] : [{ nom: 'Saint-Genis-Laval' }, { nom: 'Brignais' }]) : { test_mode: false }),
  }));
  jest.clearAllMocks();
  sessionStorage.clear();
  getTable = {
    '/kyc/status': { verified: false, status: 'not_started' },
    '/properties/seller/mine': [property],
    '/properties/c1/stats': { views: 12, favorites_count: 3, unique_contacts: 1, offers_count: 0 },
    '/properties/c1/ownership-proof': { status: 'verified', doc_type: 'titre-propriete', uploaded_at: '2026-10-01T10:00:00Z', filename: 'acte.pdf' },
    '/properties/c1/photos': [],
    '/properties/c1': property,
    '/seller/mandat/status/c1': { mandat, presented_buyers: [{ buyer_id: 'b1', label: 'Acquéreur n°123456', name: 'Claire Martin', at: '2026-10-05T10:00:00Z' }] },
    '/dataroom/categories': [],
    '/dataroom/c1/access-requests': [{ id: 'r1', buyer_id: 'b1', buyer_card: buyerCard, message: 'Je cherche un T2 loué à Lyon.', status: 'pending', created_at: '2026-10-08T10:00:00Z', expires_at: '2026-10-18T10:00:00Z' }],
    '/dataroom/c1/documents': { documents: [] },
    '/dataroom/c1/access-log': { logs: [] },
    '/offers/property/c1': { offers: [] },
    '/closing/my': { closings: [] },
    '/messages/conversations': [],
  };
  api.get.mockImplementation((url) => Promise.resolve({ data: route(url, getTable) }));
  api.post.mockImplementation((url) => Promise.resolve({ data: route(url, {
    '/properties': { id: 'c-new', status: 'draft', ownership: { status: 'missing' } },
    '/seller/mandat/generate': { already_signed: false, contract_id: 'k1', contract_number: 'MANDAT-20261014-ABCD', content: 'MANDAT DE VENTE SIMPLE (NON EXCLUSIF)\n\nArticle 1…', summary: SUMMARY, terms_version: 'v1', terms_date: '14/10/2026' },
    '/seller/mandat/m1/denounce': { status: 'withdrawn_retractation', effective_at: '2026-10-14T10:00:00Z' },
  }) }));
  api.put.mockImplementation((url) => Promise.resolve({ data: url.startsWith('/properties/') ? { id: url.split('/')[2] } : { ok: true } }));
});

afterEach(() => {
  mounted.splice(0).forEach(({ root, container }) => { act(() => root.unmount()); container.remove(); });
});

// ------------------------------------------------------------------------------------------------
const completeStep1 = {
  ...emptyForm(), property_type: 'appartement', owner_type: 'personne-physique', postal_code: '69007', city: 'Lyon', surface: '42', rooms: '2',
  is_copro: 'non', dpe_class: 'D', energy_cost_min: '900', energy_cost_max: '1300',
};

describe('listingForm (helpers)', () => {
  test('écran 1 : champs obligatoires de publication, société → dénomination et SIRET, DPE d\'un logement', () => {
    const errs = validateStep(1, emptyForm());
    expect(Object.keys(errs)).toEqual(expect.arrayContaining(['property_type', 'owner_type', 'postal_code', 'city', 'surface', 'is_copro', 'dpe_class']));
    expect(validateStep(1, completeStep1)).toEqual({});
    // Parking : surface facultative, DPE « non soumis » accepté
    expect(validateStep(1, { ...completeStep1, property_type: 'parking', surface: '', dpe_class: 'non-soumis', energy_cost_min: '', energy_cost_max: '' })).toEqual({});
    // Logement : « non soumis » refusé, dépenses d'énergie exigées
    expect(validateStep(1, { ...completeStep1, dpe_class: 'non-soumis' }).dpe_class).toMatch(/Un logement doit afficher sa classe énergie/);
    expect(validateStep(1, { ...completeStep1, energy_cost_max: '' }).energy_cost).toMatch(/dépenses annuelles d'énergie/);
    expect(validateStep(1, { ...completeStep1, energy_cost_min: '1500' }).energy_cost).toMatch(/montant bas/);
    const sci = validateStep(1, { ...completeStep1, owner_type: 'sci', siret: '1234' });
    expect(sci.company_name).toBeTruthy();
    expect(sci.siret).toBe('Un SIRET compte 14 chiffres.');
    // Copropriété : mentions obligatoires
    const copro = validateStep(1, { ...completeStep1, is_copro: 'oui' });
    expect(Object.keys(copro)).toEqual(['copro_lots', 'copro_charges_annual', 'copro_procedure']);
    expect(validateStep(1, { ...completeStep1, postal_code: '6900' }).postal_code).toBe('Code postal à 5 chiffres.');
  });

  test('écrans 2 et 3 : bail, loyer, prix, parts réservées aux sociétés, description sans coordonnées', () => {
    expect(Object.keys(validateStep(2, emptyForm()))).toEqual(['lease_type', 'rent_monthly', 'lease_start']);
    expect(validateStep(2, { ...emptyForm(), lease_type: 'habitation-vide', rent_monthly: '620', lease_start: '2024-09-01', lease_end: '2023-01-01' }).lease_end).toBeTruthy();
    expect(findContactDetails('Appelez-moi au 06 12 34 56 78')).toEqual(['un numéro de téléphone']);
    expect(findContactDetails('contact@exemple.fr ou www.exemple.fr')).toEqual(['une adresse e-mail', 'une adresse de site web']);
    const base = { ...emptyForm(), owner_type: 'personne-physique', asking_price: '145000', sale_object: 'parts', description: 'x'.repeat(199) };
    const errs = validateStep(3, base);
    expect(errs.sale_object).toMatch(/cession de parts n'est possible que pour un bien détenu par une société/);
    expect(errs.description).toMatch(/Encore 1 caractères/);
    expect(validateStep(3, { ...base, owner_type: 'sci', description: `Écrivez-moi : a@b.fr ${'x'.repeat(200)}` }).description).toMatch(/adresse e-mail/);
    expect(validateStep(3, { ...base, sale_object: 'bien', description: 'x'.repeat(300) })).toEqual({});
  });

  test('charges utiles : booléens, nombres, département déduit du code postal, société omise en nom propre', () => {
    const p1 = step1Payload({ ...completeStep1, company_name: 'SCI X', siret: '12345678900012', elevator: 'oui', address: ' 12 rue des Lilas ' });
    expect(p1).toEqual({
      property_type: 'appartement', owner_type: 'personne-physique', address: '12 rue des Lilas', postal_code: '69007', city: 'Lyon', department: '69',
      surface: 42, rooms: 2, elevator: true, is_copro: false, dpe_class: 'D', energy_cost_min: 900, energy_cost_max: 1300,
    });
    expect(step1Payload({ ...completeStep1, owner_type: 'sci', company_name: 'SCI X', siret: '123 456 789 00012', postal_code: '20000' })).toMatchObject({ company_name: 'SCI X', siret: '12345678900012', department: '2A' });
    expect(step2Payload({ ...emptyForm(), lease_type: 'habitation-vide', rent_monthly: '620', lease_start: '2019-03-01', has_gli: 'non', property_tax: '650' }))
      .toEqual({ lease_type: 'habitation-vide', rent_monthly: 620, lease_start: '2019-03-01', has_gli: false, property_tax: 650 });
    expect(step3Payload({ ...emptyForm(), asking_price: '145000', sale_object: 'bien', description: ' Texte ' })).toEqual({ asking_price: 145000, sale_object: 'bien', description: 'Texte', auto_accept_dataroom: false });
  });

  test('rendements en direct et alerte hors 2 %-15 %', () => {
    expect(liveYields({ ...emptyForm(), rent_monthly: '620', asking_price: '145000' })).toEqual({ gross: 5.13, net: null, annualRent: 7440 });
    expect(liveYields({ ...emptyForm(), rent_monthly: '620', asking_price: '145000', property_tax: '650', non_recoverable_charges: '400' }).net).toBe(4.41);
    expect(yieldAlert(1.5)).toBe('low');
    expect(yieldAlert(16)).toBe('high');
    expect(yieldAlert(6)).toBeNull();
    expect(yieldAlert(null)).toBeNull();
  });

  test('reprise d\'une annonce et préremplissage depuis l\'estimateur (sessionStorage)', () => {
    const f = formFromProperty(property);
    expect(f).toMatchObject({ property_type: 'appartement', postal_code: '69007', surface: '42', elevator: 'oui', is_copro: 'oui', copro_procedure: 'non', rent_monthly: '620', lease_start: '2019-03-01' });
    expect(firstIncompleteStep(f)).toBe(3);
    expect(previewProperty(f)).toMatchObject({ title: 'Appartement T2 loué · 42 m² · Lyon (69)', gross_yield: 5.13 });
    expect(previewProperty(f)).not.toHaveProperty('address');
    sessionStorage.setItem('estimate', JSON.stringify({ inputs: { property_type: 'maison', lease_type: 'habitation-vide', department: '44', rent_monthly: 1250, asking_price: 310000 }, result: { low: 280000, high: 330000, mid: 305000 } }));
    const est = readEstimateSession();
    expect(est.result).toEqual({ low: 280000, high: 330000, mid: 305000 });
    const form = applyEstimateToForm(emptyForm(), est);
    expect(form).toMatchObject({ property_type: 'maison', lease_type: 'habitation-vide', department: '44', rent_monthly: '1250', asking_price: '310000' });
    expect(applyEstimateToForm({ ...emptyForm(), rent_monthly: '1100' }, est).rent_monthly).toBe('1100');
  });
});

describe('lib/mandate', () => {
  test('12 mois, clause de suite 12 mois, rétractation 14 jours ; phrases d\'état', () => {
    expect([MANDATE_DURATION_MONTHS, MANDATE_TAIL_MONTHS, MANDATE_WITHDRAWAL_DAYS]).toEqual([12, 12, 14]);
    expect(mandateStatusSentence({ ...mandat, withdrawal_ends_at: null })).toBe('Mandat simple en cours jusqu\'au 01/10/2027.');
    expect(mandateStatusSentence({ ...mandat, withdrawal_ends_at: IN_FUTURE })).toMatch(/Délai de rétractation ouvert jusqu'au/);
    expect(mandateStatusSentence({ status: 'denounced', effective_at: '2026-10-30T00:00:00Z' })).toMatch(/résilié/);
    expect(mandateStatusSentence({ status: 'withdrawn_retractation', effective_at: '2026-10-14T00:00:00Z' })).toMatch(/rétracté le 14\/10\/2026.*aucune somme n'est due/);
    expect(withdrawalOpen({ ...mandat, withdrawal_ends_at: IN_FUTURE })).toBe(true);
    expect(withdrawalOpen(mandat, Date.parse('2026-11-01T00:00:00Z'))).toBe(false);
    expect(apiRelativePath('/api/seller/mandat/m1/pdf')).toBe('/seller/mandat/m1/pdf');
  });
});

// ------------------------------------------------------------------------------------------------
describe('CreateListing', () => {
  test('écran 1 : champs obligatoires, code postal → ville, adresse confidentielle, brouillon créé par POST puis écran 2', async () => {
    const c = await render(<CreateListing user={user} />, '/seller/create');
    expect(c.querySelector('h1').textContent).toBe('Votre bien');
    await click(byId(c, 'next-step'));
    expect(c.textContent).toMatch(/Choisissez le type de bien/);
    expect(c.textContent).toMatch(/Indiquez si le bien est en copropriété/);
    expect(api.post).not.toHaveBeenCalled();
    await pick(c, 'property-type-appartement');
    await pick(c, 'owner-type-personne-physique');
    expect(byId(c, 'company-fields')).toBeNull();
    await setValue(byId(c, 'address-input'), '12 rue des Lilas');
    expect(c.textContent).toMatch(/Confidentielle : révélée seulement après l'engagement de confidentialité/);
    await setValue(byId(c, 'postal-code-input'), '69007');
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('geo.api.gouv.fr/communes?codePostal=69007'), { credentials: 'omit' });
    expect(byId(c, 'city-input').value).toBe('Lyon');
    expect(c.textContent).toContain('Rhône (69)');
    await setValue(byId(c, 'surface-input'), '42');
    await setValue(byId(c, 'rooms-input'), '2');
    await pick(c, 'copro-oui');
    expect(byId(c, 'copro-fields')).not.toBeNull();
    await pick(c, 'copro-non');
    await pick(c, 'dpe-G');
    expect(byId(c, 'dpe-warning').textContent).toMatch(/depuis le 1er janvier 2025/);
    await pick(c, 'dpe-D');
    expect(byId(c, 'dpe-non-soumis')).toBeNull();
    await setValue(byId(c, 'energy-min-input'), '900');
    await setValue(byId(c, 'energy-max-input'), '1300');
    await click(byId(c, 'next-step'));
    expect(api.post).toHaveBeenCalledWith('/properties', {
      property_type: 'appartement', owner_type: 'personne-physique', address: '12 rue des Lilas', postal_code: '69007', city: 'Lyon', department: '69',
      surface: 42, rooms: 2, is_copro: false, dpe_class: 'D', energy_cost_min: 900, energy_cost_max: 1300,
    });
    expect(c.querySelector('h1').textContent).toBe('La location en cours');
    expect(byId(c, 'tenant-warning').textContent).toMatch(/Ne saisissez aucun nom ni coordonnée du locataire/);
    // Bail proposé selon le type de bien
    expect(byId(c, 'lease-type-select').value).toBe('habitation-vide');
  });

  test('société propriétaire : dénomination et SIRET (confidentiels) obligatoires ; plusieurs communes → liste', async () => {
    const c = await render(<CreateListing user={user} />, '/seller/create');
    await pick(c, 'owner-type-sci');
    expect(byId(c, 'company-fields').textContent).toMatch(/jamais affichée sur l'annonce/);
    await setValue(byId(c, 'siret-input'), '123 456 789 00012 99');
    expect(byId(c, 'siret-input').value).toBe('12345678900012');
    await setValue(byId(c, 'postal-code-input'), '69230');
    const select = byId(c, 'city-select');
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['', 'Brignais', 'Saint-Genis-Laval']);
    await click(byId(c, 'next-step'));
    expect(c.textContent).toMatch(/Indiquez la dénomination de la société/);
  });

  test('écrans 2 et 3 : rendements en direct, alerte de rendement, honoraires TTC, parts réservées aux sociétés, aperçu sans adresse', async () => {
    const draft = { ...property, id: 'd1', status: 'draft', mandat_signed: false, description: '', sale_object: '', asking_price: null, ownership: { status: 'missing' } };
    getTable['/properties/d1'] = draft;
    const c = await render(<CreateListing user={user} />, '/seller/edit/d1', '/seller/edit/:id');
    expect(c.querySelector('h1').textContent).toBe('Votre prix et votre annonce');
    await setValue(byId(c, 'asking-price-input'), '145000');
    const live = byId(c, 'live-yields-price');
    expect(byId(live, 'live-gross').textContent).toBe('5,1\u00a0%');
    expect(byId(live, 'live-net').textContent).toBe('4,4\u00a0%');
    expect(byId(c, 'yield-alert')).toBeNull();
    expect(byId(c, 'price-fees').textContent).toMatch(/5\u202f220\u00a0€ TTC.*4\u202f350\u00a0€ HT/);
    expect(byId(c, 'price-fees').textContent).toMatch(/139\u202f780\u00a0€/);
    await setValue(byId(c, 'asking-price-input'), '30000');
    expect(byId(c, 'yield-alert').textContent).toMatch(/supérieur à 15 %/);
    await setValue(byId(c, 'asking-price-input'), '145000');
    // Nom propre : seule la vente du bien est proposée (et choisie d'office)
    expect(c.querySelector('[data-testid="sale-object-parts"]')).toBeNull();
    expect(c.querySelector('[data-testid="sale-object-bien"] input').checked).toBe(true);
    // Photos (brouillon existant) et aperçu de la carte publique
    expect(byId(c, 'photos-panel')).not.toBeNull();
    const preview = byId(c, 'listing-preview');
    expect(preview.querySelector('[data-testid="listing-card"]').textContent).toContain('Appartement T2 loué · 42 m² · Lyon (69)');
    expect(preview.textContent).not.toMatch(/rue des Lilas/);
    await setValue(byId(c, 'description-input'), `Écrivez-moi sur contact@exemple.fr. ${'x'.repeat(200)}`);
    expect(byId(c, 'description-contacts').textContent).toMatch(/adresse e-mail/);
    await click(byId(c, 'next-step'));
    expect(api.put).not.toHaveBeenCalled();
    await setValue(byId(c, 'description-input'), `Appartement lumineux, loué depuis 2019 à un locataire stable. ${'Calme. '.repeat(30)}`);
    await click(byId(c, 'next-step'));
    expect(api.put).toHaveBeenCalledWith('/properties/d1', expect.objectContaining({ asking_price: 145000, sale_object: 'bien' }));
    // Justificatif non déposé, identité non vérifiée : liste des étapes avant publication
    const checklist = byId(c, 'publish-checklist');
    expect(checklist.textContent).toMatch(/Déposez votre justificatif de propriété/);
    expect(checklist.querySelector('[data-testid="ownership-panel"]')).not.toBeNull();
    expect(checklist.textContent).toMatch(/14 jours pour vous rétracter/);
  });

  test('fetchCities : liste vide si le code postal est invalide ou l\'API indisponible', async () => {
    expect(await fetchCities('123')).toEqual([]);
    global.fetch = jest.fn(() => Promise.reject(new Error('hors ligne')));
    expect(await fetchCities('69007')).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------
describe('MandatePage', () => {
  test('qualité selon le propriétaire, vente du bien, rétractation 14 jours, résumé en 5 points, honoraires TTC d\'abord', async () => {
    getTable['/seller/mandat/status/c1'] = { mandat: null, presented_buyers: [] };
    getTable['/properties/c1'] = { ...property, status: 'mandat_en_attente', mandat_signed: false, sale_object: '' };
    const c = await render(<MandatePage user={user} />, '/seller/mandat/c1', '/seller/mandat/:propertyId');
    expect(byId(c, 'mandant-form')).not.toBeNull();
    expect(byId(c, 'mandate-terms').textContent).toMatch(/14 jours pour vous rétracter.*12 mois, sans exclusivité.*clause de suite de 12 mois/);
    expect(Array.from(byId(c, 'capacity-select').options).map((o) => o.value)).toEqual(['', 'proprietaire', 'mandataire']);
    expect(c.querySelector('[data-testid="mandate-object-parts"]')).toBeNull();
    expect(c.querySelector('[data-testid="mandate-object-bien"] input').checked).toBe(true);
    expect(c.textContent).toContain('12 rue des Lilas, 69007 Lyon');
    await click(byId(c, 'prepare-mandate'));
    expect(c.textContent).toMatch(/Indiquez la voie/);
    expect(api.post).not.toHaveBeenCalled();
    await setValue(byId(c, 'address-line1'), '3 avenue Foch');
    await setValue(byId(c, 'address-postal-code'), '75016');
    await setValue(byId(c, 'address-city'), 'Paris');
    await setValue(byId(c, 'capacity-select'), 'proprietaire');
    await click(byId(c, 'prepare-mandate'));
    expect(api.put).toHaveBeenCalledWith('/properties/c1', { mandant_address: { line1: '3 avenue Foch', line2: undefined, postal_code: '75016', city: 'Paris' }, mandant_capacity: 'proprietaire', sale_object: 'bien' });
    expect(api.post).toHaveBeenCalledWith('/seller/mandat/generate', null, { params: { property_id: 'c1' } });
    const summary = byId(c, 'mandate-summary');
    expect(summary.querySelectorAll('ol li')).toHaveLength(5);
    expect(summary.textContent).toMatch(/Version du 14\/10\/2026/);
    expect(byId(c, 'mandate-fees').textContent).toMatch(/^Sur le prix de vente \(145\u202f000\u00a0€\), les honoraires seraient de 5\u202f220\u00a0€ TTC \(4\u202f350\u00a0€ HT\)/);
    await click(byId(c, 'open-mandate-sign'));
    expect(document.body.querySelector('[data-testid="otp-signature-dialog"]')).toBeTruthy();
  });

  test('qualités proposées selon le type de propriétaire', () => {
    expect(capacitiesFor('sci').map((x) => x.value)).toEqual(['gerant', 'mandataire']);
    expect(capacitiesFor('indivision').map((x) => x.value)).toEqual(['coindivisaire', 'mandataire']);
    expect(capacitiesFor('').map((x) => x.value)).toEqual(['proprietaire', 'coindivisaire', 'gerant', 'mandataire']);
  });

  test('mandat déjà signé : registre, dates et délai de rétractation', async () => {
    getTable['/seller/mandat/status/c1'] = { mandat, presented_buyers: [] };
    const c = await render(<MandatePage user={user} />, '/seller/mandat/c1', '/seller/mandat/:propertyId');
    expect(byId(c, 'mandate-registry').textContent).toBe('12');
    expect(byId(c, 'mandate-withdrawal-info').textContent).toMatch(/rétracter sans motif jusqu'au 15\/10\/2026 \(14 jours\)/);
    expect(byId(c, 'mandate-next').textContent).toMatch(/publiée immédiatement/);
    expect(byId(c, 'mandate-next').querySelector('a').getAttribute('href')).toBe('/annonce/c1');
  });

  test('400 validation renvoie au formulaire avec le champ manquant', async () => {
    getTable['/seller/mandat/status/c1'] = { mandat: null };
    getTable['/properties/c1'] = { ...property, owner_type: 'sci', company_name: '', status: 'mandat_en_attente', mandat_signed: false, sale_object: 'parts', mandant_address: '12 rue X, 29200 Brest', mandant_capacity: 'gerant' };
    api.post.mockRejectedValueOnce({ response: { status: 400, data: { detail: { code: 'validation', message: 'Complétez votre annonce : dénomination de la société', missing: ['company_name'] } } } });
    const c = await render(<MandatePage user={user} />, '/seller/mandat/c1', '/seller/mandat/:propertyId');
    expect(byId(c, 'address-line1').value).toBe('12 rue X');
    expect(c.querySelector('[data-testid="mandate-object-parts"] input').checked).toBe(true);
    await click(byId(c, 'prepare-mandate'));
    expect(c.textContent).toMatch(/dénomination de la société/);
    expect(c.textContent).toMatch(/Compléter mon annonce/);
  });
});

// ------------------------------------------------------------------------------------------------
describe('SellerDashboard', () => {
  test('« À traiter » avec la demande de dossier, carte d\'annonce (loyer, rendement, justificatif), aucun compteur à zéro', async () => {
    const c = await render(<SellerDashboard user={user} setUser={() => {}} />, '/seller/dashboard');
    expect(api.get).toHaveBeenCalledWith('/properties/seller/mine', { params: { limit: 100 } });
    const todo = byId(c, 'todo-block');
    expect(todo.textContent).toMatch(/Une demande de dossier à traiter/);
    const card = todo.querySelector('[data-testid="buyer-card"]');
    expect(card.textContent).toMatch(/Acquéreur n°123456/);
    expect(card.textContent).toMatch(/Investisseur particulier/);
    await click(todo.querySelector('[data-testid="accept-request-r1"]'));
    expect(api.put).toHaveBeenCalledWith('/dataroom/c1/access/r1/validate');
    expect(byId(c, 'status-c1').textContent).toBe('En ligne');
    expect(byId(c, 'seller-yield-c1').textContent).toBe('5,1\u00a0% brut');
    expect(byId(c, 'ownership-badge-c1').textContent).toBe('Propriétaire vérifié');
    expect(c.textContent).toMatch(/620\u00a0€\/mois HC/);
    expect(c.textContent).not.toMatch(/\b0 vues\b|repreneur|cédant/);
    await click(byId(c, 'open-c1'));
    expect(byId(c, 'listing-detail').textContent).toMatch(/Demandes de dossier/);
  });

  test('justificatif refusé : ligne « À traiter » et onglet « Justificatif » avec le motif et un nouveau dépôt', async () => {
    getTable['/properties/seller/mine'] = [{ ...property, ownership: { status: 'rejected', note: 'Document illisible' } }];
    getTable['/properties/c1/ownership-proof'] = { status: 'rejected', doc_type: 'taxe-fonciere', uploaded_at: '2026-10-02T10:00:00Z', note: 'Document illisible' };
    const c = await render(<SellerDashboard user={user} setUser={() => {}} />, '/seller/dashboard');
    expect(byId(c, 'todo-ownership-rejected-c1').textContent).toMatch(/Justificatif de propriété refusé.*Document illisible/);
    await click(byId(c, 'todo-ownership-c1'));
    const panel = byId(c, 'ownership-panel');
    expect(byId(panel, 'ownership-rejected').textContent).toMatch(/Motif : Document illisible/);
    expect(byId(panel, 'ownership-form')).not.toBeNull();
  });

  test('onglet mandat : rétractation dans les 14 jours (effet immédiat), prolongation, acquéreurs présentés', async () => {
    getTable['/seller/mandat/status/c1'] = { mandat: { ...mandat, withdrawal_ends_at: IN_FUTURE }, presented_buyers: [{ buyer_id: 'b1', label: 'Acquéreur n°123456', name: 'Claire Martin', at: '2026-10-05T10:00:00Z' }] };
    const c = await render(<SellerDashboard user={user} setUser={() => {}} />, '/seller/dashboard?annonce=c1&onglet=mandate');
    const panel = byId(c, 'mandate-panel');
    expect(panel.textContent).toMatch(/Claire Martin/);
    expect(panel.textContent).toMatch(/Acquéreurs présentés/);
    expect(byId(panel, 'withdrawal-open')).not.toBeNull();
    expect(byId(panel, 'renew-mandate')).not.toBeNull();
    expect(byId(panel, 'denounce-mandate').textContent).toBe('Me rétracter');
    await click(byId(panel, 'denounce-mandate'));
    const dialog = document.body.querySelector('[data-testid="denounce-dialog"]');
    expect(dialog.textContent).toMatch(/délai de rétractation de 14 jours.*prend effet immédiatement.*aucune somme n'est due/);
    await click(dialog.querySelector('[data-testid="denounce-dialog-confirm"]'));
    expect(api.post).toHaveBeenCalledWith('/seller/mandat/m1/denounce', {});
  });
});

describe('OtpSignatureDialog', () => {
  test('résumé, texte replié, case activée après lecture', async () => {
    await render(<OtpSignatureDialog open onClose={() => {}} title="Mandat" contractId="k1" documentText="Texte intégral" summary={['A', 'B', 'C', 'D', 'E']} onSign={async () => {}} />);
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
