// Fiche d'un bien loué (/annonce/:id) et composants de l'espace vendeur : chiffres clés et rendements, mentions de
// copropriété, DPE (coût énergétique, alerte de décence énergétique), honoraires à la charge du vendeur, adresse jamais
// publiée ; justificatif de propriété (dépôt multipart, statuts), dossier du bien (catégories, avertissement locataire),
// offres d'achat (condition de prêt, « n'emporte pas vente »), statuts et motifs de blocage.
// Exécution : cd frontend && CI=true npx craco test --watchAll=false src/components/seller/__tests__/sellerComponents.test.jsx
import '@/components/shared/jestEnv';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

jest.mock('@/App', () => ({ axiosInstance: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() }, API: '/api', EMAIL_NOT_VERIFIED_EVENT: 'venteloc:email-not-verified' }));
jest.mock('@radix-ui/primitive/is-development', () => jest.requireActual('@radix-ui/primitive/dist/internal/is-development.false.js'), { virtual: true });
jest.mock('@/lib/analytics', () => ({ trackEvent: jest.fn(), trackPageView: jest.fn(), initAnalytics: jest.fn() }));

import { axiosInstance as api } from '@/App';
import PropertyDetail, { draftMessage } from '@/pages/PropertyDetail';
import OwnershipProofPanel, { proofFileError, OWNERSHIP_DOC_TYPES } from '@/components/seller/OwnershipProofPanel';
import DataroomPanel, { DATAROOM_CATEGORIES } from '@/components/seller/DataroomPanel';
import OffersPanel, { loanConditionText, financingText } from '@/components/seller/OffersPanel';
import { denounceText } from '@/components/seller/MandatePanel';
import { BlockingReasons } from '@/components/seller/ListingStatusBadge';
import { blockingReasons, listingStatusInfo, moderationFlags, ownershipStatusOf, LISTING_FLAG_LABELS } from '@/components/seller/listingStatus';
import { resetCommissionCache } from '@/lib/useCommission';
import { BRAND } from '@/lib/brand';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.scrollTo = jest.fn();
Element.prototype.scrollIntoView = jest.fn();

const mounted = [];
const flush = async () => { await act(async () => { await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); }); };
const render = async (ui, path = '/', routePath = '*') => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<MemoryRouter initialEntries={[path]}><Routes><Route path={routePath} element={ui} /><Route path="/login" element={<p data-testid="page-login">connexion</p>} /></Routes></MemoryRouter>);
  });
  await flush();
  await flush();
  mounted.push({ root, container });
  return container;
};
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); await flush(); };
const byId = (c, id) => c.querySelector(`[data-testid="${id}"]`);

const fiche = {
  id: 'p1', status: 'published', title: 'Appartement T2 loué · 42 m² · Lyon (69)', property_type: 'appartement', owner_type: 'personne-physique',
  city: 'Lyon', district: 'Jean Macé', postal_code: '69007', department: '69', region: 'Auvergne-Rhône-Alpes', surface: 42, rooms: 2, floor: 3, elevator: true,
  construction_year: 1972, is_copro: true, copro_lots: 24, copro_charges_annual: 960, copro_procedure: false, dpe_class: 'G', ges_class: 'F',
  energy_cost_min: 1800, energy_cost_max: 2500, dpe_date: '2024-03-03', dpe_rental: { status: 'interdit', date: '2025-01-01' },
  lease_type: 'habitation-vide', rent_monthly: 620, charges_monthly: 60, lease_start: '2019-03-01', tenant_since: '2019-03-01', deposit: 620,
  indexation: 'irl', tenant_payment_status: 'a-jour', has_gli: true, has_guarantor: false, property_tax: 650, non_recoverable_charges: 400,
  asking_price: 145000, sale_object: 'bien', sale_reason: 'arbitrage', gross_yield: 5.13, net_yield: 4.41,
  description: 'Appartement traversant au troisième étage avec ascenseur, à cinq minutes du métro.', published_at: '2026-10-01T10:00:00Z',
  ownership: { status: 'verified' }, property_checks: { ownership_verified: true, dpe_rental_status: 'interdit' },
  commission_info: { payer: 'vendeur', rate_percent_ttc: 3.6, rate_percent_ht: 3, estimate_ht: 4350, estimate_ttc: 5220, minimum_ht: 3000, minimum_ttc: 3600, terms_version: 'v1' },
};

beforeEach(() => {
  resetCommissionCache();
  document.head.innerHTML = '';
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({}) }));
  jest.clearAllMocks();
  api.get.mockImplementation((url) => {
    if (url === '/properties/p1') return Promise.resolve({ data: fiche });
    if (url === '/properties/p1/photos') return Promise.resolve({ data: [] });
    return Promise.resolve({ data: {} });
  });
});
afterEach(() => {
  mounted.splice(0).forEach(({ root, container }) => { act(() => root.unmount()); container.remove(); });
});

// ------------------------------------------------------------------------------------------------
describe('fiche /annonce/:id', () => {
  test('chiffres clés, rendements, copropriété, location, DPE avec alerte de décence énergétique, honoraires', async () => {
    const c = await render(<PropertyDetail user={null} />, '/annonce/p1', '/annonce/:id');
    expect(c.querySelector('h1').textContent).toBe('Appartement T2 loué · 42 m² · Lyon (69)');
    expect(document.title).toBe(`Appartement T2 loué · 42 m² · Lyon (69) | ${BRAND.name}`);
    expect(document.head.querySelector('link[rel="canonical"]').getAttribute('href')).toMatch(/\/annonce\/p1$/);
    expect(byId(c, 'ownership-badge').textContent).toBe('Propriétaire vérifié');
    expect(byId(c, 'asking-price').textContent).toBe('145\u00a0000\u00a0€');
    expect(byId(c, 'rent-monthly').textContent).toBe('620\u00a0€/mois');
    expect(byId(c, 'gross-yield').textContent).toBe('5,1\u00a0%');
    expect(byId(c, 'net-yield').textContent).toBe('4,4\u00a0%');
    expect(byId(c, 'fact-deposit').textContent).toBe('620\u00a0€');
    expect(byId(c, 'section-chiffres').textContent).toMatch(/Taxe foncière annuelle650\u00a0€/);
    // Copropriété : mentions obligatoires (lots, charges, procédure)
    const copro = byId(c, 'copro');
    expect(copro.textContent).toMatch(/24 lots dans la copropriété/);
    expect(copro.textContent).toMatch(/960\u00a0€ par an/);
    expect(byId(c, 'copro-procedure').textContent).toMatch(/Aucune procédure en cours/);
    // Location : bail, situation déclarée, visites encadrées
    expect(byId(c, 'section-location').textContent).toMatch(/Bail d'habitation vide \(loi du 6 juillet 1989\)/);
    expect(byId(c, 'tenant-payment').textContent).toMatch(/Loyers payés à l'échéance/);
    expect(byId(c, 'visits').textContent).toMatch(/2 heures maximum par jour ouvrable, art. 4 de la loi du 6 juillet 1989/);
    // DPE : échelle, GES, coût énergétique, alerte (texte de la spécification)
    expect(byId(c, 'dpe-scale').querySelector('ol').getAttribute('aria-label')).toBe('Échelle énergie, classe G');
    expect(byId(c, 'energy-cost').textContent).toBe('Entre 1\u00a0800\u00a0€ et 2\u00a0500\u00a0€ par an');
    expect(byId(c, 'dpe-alert').textContent).toBe('Logement classé G : depuis le 1ᵉʳ janvier 2025 il ne peut plus faire l\'objet d\'un nouveau bail ni d\'un renouvellement. Le bail en cours continue jusqu\'à son terme.');
    // Honoraires à la charge du vendeur, TTC d'abord
    const fees = byId(c, 'fees').textContent;
    expect(fees).toMatch(/Honoraires de négociation à la charge du vendeur : 5\u202f220\u00a0€ TTC \(4\u202f350\u00a0€ HT\)/);
    expect(fees).toMatch(/Prix hors honoraires : 139\u202f780\u00a0€/);
    expect(fees).toMatch(/Rien n'est demandé à l'acquéreur/);
    expect(byId(c, 'checks').textContent).toMatch(/contrôlé par nos équipes/);
    expect(c.textContent).not.toMatch(/repreneur|cédant|\bRGE\b|entreprise/i);
    // Visiteur : « Présenter mon projet au vendeur » → connexion
    expect(byId(c, 'contact-seller-btn').textContent).toBe('Présenter mon projet au vendeur');
    await click(byId(c, 'contact-seller-btn'));
    expect(byId(c, 'page-login')).not.toBeNull();
  });

  test('adresse et société jamais affichées au public ; révélées à l\'acquéreur engagé', async () => {
    const pub = await render(<PropertyDetail user={null} />, '/annonce/p1', '/annonce/:id');
    expect(pub.textContent).not.toMatch(/rue des Lilas/);
    expect(byId(pub, 'revealed-identity')).toBeNull();
    api.get.mockImplementation((url) => Promise.resolve({ data: url === '/properties/p1' ? { ...fiche, address: '12 rue des Lilas', company_name: 'SCI Lilas' } : url.endsWith('/photos') ? [] : {} }));
    const buyer = await render(<PropertyDetail user={{ id: 'b1', role: 'buyer' }} />, '/annonce/p1', '/annonce/:id');
    expect(byId(buyer, 'revealed-identity').textContent).toMatch(/12 rue des Lilas, 69007 Lyon.*SCI Lilas/);
    expect(byId(buyer, 'dataroom-link').getAttribute('href')).toBe('/dataroom/p1');
  });

  test('bien non soumis, sans charges : pas d\'alerte DPE, rendement net non calculé, pas de badge non vérifié', async () => {
    api.get.mockImplementation((url) => Promise.resolve({ data: url === '/properties/p1' ? {
      id: 'p1', property_type: 'parking', city: 'Paris', department: '75', lease_type: 'parking', rent_monthly: 140, asking_price: 32000, dpe_class: 'non-soumis', ownership: { status: 'pending' },
    } : url.endsWith('/photos') ? [] : {} }));
    const c = await render(<PropertyDetail user={null} />, '/annonce/p1', '/annonce/:id');
    expect(c.querySelector('h1').textContent).toBe('Parking loué · Paris (75)');
    expect(byId(c, 'dpe-alert')).toBeNull();
    expect(byId(c, 'dpe-other').textContent).toBe('Bien non soumis au diagnostic de performance énergétique.');
    expect(byId(c, 'net-yield').textContent).toBe('—');
    expect(byId(c, 'gross-yield').textContent).toBe('5,3\u00a0%');
    expect(byId(c, 'ownership-badge')).toBeNull();
    expect(byId(c, 'checks').textContent).toMatch(/déposé, en cours de contrôle/);
    // Honoraires : minimum appliqué (3 600 € TTC), calculé localement faute de commission_info
    expect(byId(c, 'fees').textContent).toMatch(/3\u202f600\u00a0€ TTC \(3\u202f000\u00a0€ HT\)/);
  });

  test('message de présentation prérempli depuis le profil d\'investissement', () => {
    const text = draftMessage({ buyer_profile: { project_type: 'sci', budget_max: 250000, financing: 'emprunt', min_yield: 6, horizon: '0-6' } });
    expect(text).toMatch(/achat via une sci ; budget jusqu'à 250\u202f000\u00a0€ ; financement : emprunt bancaire ; rendement brut visé : 6\u00a0% minimum ; horizon : sous 6 mois\./);
    expect(text).toMatch(/dossier du bien/);
  });
});

// ------------------------------------------------------------------------------------------------
describe('justificatif de propriété', () => {
  test('dépôt : type de document, contrôle du fichier, POST multipart, statut « en cours de contrôle »', async () => {
    api.get.mockResolvedValue({ data: null });
    api.post.mockResolvedValue({ data: { ownership: { status: 'pending', doc_type: 'taxe-fonciere', uploaded_at: '2026-10-14T10:00:00Z', filename: 'tf.pdf' } } });
    const onChanged = jest.fn();
    const c = await render(<OwnershipProofPanel property={{ id: 'c1', owner_type: 'personne-physique' }} onChanged={onChanged} />);
    expect(byId(c, 'ownership-status').getAttribute('data-status')).toBe('missing');
    expect(c.textContent).toMatch(/jamais montré aux acquéreurs/);
    expect(OWNERSHIP_DOC_TYPES.map((d) => d.id)).toEqual(['titre-propriete', 'attestation-notariee', 'taxe-fonciere', 'statuts-kbis']);
    expect(c.querySelector('[data-testid="ownership-doc-titre-propriete"]').checked).toBe(true);
    await click(byId(c, 'ownership-doc-taxe-fonciere'));
    expect(byId(c, 'ownership-submit').disabled).toBe(true);
    const input = byId(c, 'ownership-file');
    const file = new File(['%PDF-1.4'], 'tf.pdf', { type: 'application/pdf' });
    await act(async () => {
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => { byId(c, 'ownership-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await flush();
    const [url, body, cfg] = api.post.mock.calls[0];
    expect(url).toBe('/properties/c1/ownership-proof');
    expect(body.get('doc_type')).toBe('taxe-fonciere');
    expect(body.get('file').name).toBe('tf.pdf');
    expect(cfg.headers['Content-Type']).toBe('multipart/form-data');
    expect(byId(c, 'ownership-status').getAttribute('data-status')).toBe('pending');
    expect(byId(c, 'ownership-pending')).not.toBeNull();
    expect(byId(c, 'ownership-form')).toBeNull();
    expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }));
  });

  test('société : statuts et Kbis proposés d\'office ; validé : badge vert, plus de dépôt ; contrôle des fichiers', async () => {
    api.get.mockResolvedValue({ data: { status: 'verified', doc_type: 'statuts-kbis', uploaded_at: '2026-10-01T10:00:00Z', reviewed_at: '2026-10-02T10:00:00Z' } });
    const c = await render(<OwnershipProofPanel property={{ id: 'c1', owner_type: 'sci' }} />);
    expect(api.get).toHaveBeenCalledWith('/properties/c1/ownership-proof');
    expect(byId(c, 'ownership-status').className).toContain('badge-verified');
    expect(byId(c, 'ownership-status').textContent).toBe('Propriétaire vérifié');
    expect(byId(c, 'ownership-form')).toBeNull();
    expect(proofFileError(null)).toBe('Choisissez un fichier.');
    expect(proofFileError({ type: 'application/zip', size: 10 })).toMatch(/PDF, JPG, PNG ou WebP/);
    expect(proofFileError({ type: 'image/jpeg', size: 11 * 1024 * 1024 })).toMatch(/10 Mo/);
    expect(proofFileError({ type: 'image/webp', size: 1000 })).toBe('');
    expect(ownershipStatusOf({})).toBe('missing');
    expect(ownershipStatusOf({ ownership: { status: 'rejected' } })).toBe('rejected');
  });
});

// ------------------------------------------------------------------------------------------------
describe('dossier du bien', () => {
  test('catégories du bien loué, avertissement sur les données du locataire, envoi par catégorie', async () => {
    api.get.mockImplementation((url) => Promise.resolve({ data: url === '/dataroom/categories' ? [] : url.endsWith('/documents') ? { documents: [{ id: 'd1', filename: 'bail.pdf', category: 'bail' }] } : [] }));
    api.post.mockResolvedValue({ data: {} });
    const c = await render(<DataroomPanel propertyId="c1" />);
    expect(DATAROOM_CATEGORIES.map((x) => x.id)).toEqual(['bail', 'etats-des-lieux', 'loyers', 'diagnostics', 'taxe-fonciere', 'copropriete', 'titre-propriete', 'assurances', 'travaux', 'societe', 'autres']);
    expect(byId(c, 'tenant-data-warning').textContent).toMatch(/Masquez le nom, les coordonnées et les pièces d'identité du locataire : l'acquéreur n'en a pas besoin avant l'acte\./);
    expect(c.textContent).toMatch(/Bail et avenants/);
    expect(c.textContent).toMatch(/bail\.pdf/);
    expect(byId(c, 'photos-panel')).not.toBeNull();
    const input = byId(c, 'dataroom-category-loyers').querySelector('input[type="file"]');
    await act(async () => {
      Object.defineProperty(input, 'files', { value: [new File(['x'], 'quittances.pdf', { type: 'application/pdf' })], configurable: true });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    const [url, body] = api.post.mock.calls[0];
    expect(url).toBe('/dataroom/c1/documents');
    expect(body.get('category')).toBe('loyers');
  });

  test('catégories servies par GET /dataroom/categories', async () => {
    api.get.mockImplementation((url) => Promise.resolve({ data: url === '/dataroom/categories' ? [{ id: 'bail', label: 'Bail (serveur)', hint: '' }] : [] }));
    const c = await render(<DataroomPanel propertyId="c2" />);
    await flush();
    expect(c.textContent).toMatch(/Bail \(serveur\)/);
  });
});

// ------------------------------------------------------------------------------------------------
describe('offres d\'achat reçues', () => {
  test('montant, objet, financement, condition suspensive de prêt, validité ; jamais « indicative »', async () => {
    const offer = {
      id: 'o1', property_id: 'c1', amount: 140000, sale_object: 'bien', financing: { equity: 30000, loan: 110000 },
      loan_condition: { required: true, amount: 110000, max_rate: 3.9, duration_years: 20 }, conditions: ['Obtention du prêt'], target_date: '2026-11-15',
      validity_days: 10, expires_at: '2026-10-24T10:00:00Z', status: 'pending', buyer_label: 'Acquéreur n°123456', created_at: '2026-10-14T10:00:00Z',
    };
    const c = await render(<OffersPanel offers={[offer]} closings={[]} />);
    const card = byId(c, 'offer-o1');
    expect(card.textContent).toMatch(/Offre d'achat de Acquéreur n°123456 · Achat du bien/);
    expect(card.textContent).toMatch(/Apport 30\s000\s€ · Emprunt 110\s000\s€/);
    expect(byId(c, 'offer-loan-o1').textContent).toMatch(/^Sous condition suspensive d'obtention de prêt \(prêt de 110\s000\s€, taux maximum 3,9 %, sur 20 ans\)$/);
    expect(card.textContent).toMatch(/10 jours/);
    expect(c.textContent).not.toMatch(/indicative|repreneur/);
    expect(byId(c, 'accept-offer-o1')).not.toBeNull();
    expect(loanConditionText({ required: false })).toBe('Sans condition suspensive de prêt');
    expect(loanConditionText(null)).toBe('');
    expect(financingText({ equity: 0, loan: 0 })).toBe('');
  });
});

// ------------------------------------------------------------------------------------------------
describe('statuts, motifs de blocage, mandat', () => {
  test('motifs `blocking: [{code, label}]` (API.md §2) avec l\'action qui les lève ; drapeaux lisibles', async () => {
    const draft = { id: 'd1', status: 'draft', blocking: [{ code: 'identity', label: 'Identité non vérifiée' }, { code: 'ownership_proof' }, { code: 'rent' }] };
    expect(blockingReasons(draft)).toEqual([
      { code: 'identity', label: 'Identité non vérifiée', action: 'verify_identity' },
      { code: 'ownership_proof', label: 'le justificatif de propriété n\'est pas déposé', action: 'ownership' },
      { code: 'rent', label: 'le loyer mensuel n\'est pas renseigné', action: 'edit', step: 2 },
    ]);
    expect(listingStatusInfo(draft).label).toBe('Publication bloquée');
    // Étapes normales du parcours (identité, mandat) : pas « bloquée »
    expect(listingStatusInfo({ status: 'mandat_en_attente', blocking: ['mandate', 'identity'] }).label).toBe('Mandat à signer');
    expect(moderationFlags({ flags: [{ code: 'dpe_rental_ban' }, 'tenant_unpaid'] }).map((f) => f.label)).toEqual([LISTING_FLAG_LABELS.dpe_rental_ban, 'impayés déclarés']);
    const onAction = jest.fn();
    const c = await render(<BlockingReasons property={draft} onAction={onAction} />);
    const buttons = Array.from(c.querySelectorAll('button')).map((b) => b.textContent);
    expect(buttons).toEqual(['Vérifier mon identité', 'Déposer le justificatif', 'Compléter']);
    await click(c.querySelectorAll('button')[2]);
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ code: 'rent', step: 2 }));
  });

  test('résiliation : rétractation (effet immédiat) dans les 14 jours, sinon préavis de 15 jours et clause de suite de 12 mois', () => {
    const now = Date.parse('2026-10-05T10:00:00Z');
    const m = { id: 'm1', status: 'signed', withdrawal_ends_at: '2026-10-15T10:00:00Z' };
    expect(denounceText(m, now)).toMatch(/^Vous êtes dans le délai de rétractation de 14 jours \(jusqu'au 15\/10\/2026\).*effet immédiatement.*aucune somme n'est due/);
    expect(denounceText(m, Date.parse('2026-10-20T10:00:00Z'))).toMatch(/^Préavis de 15 jours : la résiliation prend effet le 04\/11\/2026.*clause de suite de 12 mois.*acquéreurs/);
  });
});
