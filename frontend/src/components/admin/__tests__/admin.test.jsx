// Tests de rendu de l'administration VenteLoc (AdminDashboard « À faire » par défaut, justificatifs de propriété à
// contrôler (aperçu, Valider, Refuser avec motif), actions des lignes appelées telles quelles, retrait motivé, Annonces
// avec colonne « Justificatif », registre des mandats (rétractation), Factures, écran du lundi, coûts).
// Exécution : cd frontend && CI=true npx craco test --watchAll=false src/components/admin/__tests__/admin.test.jsx
import '@/components/shared/jestEnv';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

jest.mock('@/App', () => ({
  axiosInstance: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn(), request: jest.fn() },
  API: '/api',
  EMAIL_NOT_VERIFIED_EVENT: 'venteloc:email-not-verified',
}));
// Jest 27 (react-scripts) ne lit pas le champ « exports » des paquets Radix : sous-chemin résolu à la main
jest.mock('@radix-ui/primitive/is-development', () => jest.requireActual('@radix-ui/primitive/dist/internal/is-development.false.js'), { virtual: true });

import { axiosInstance as api } from '@/App';
import AdminDashboard from '@/pages/AdminDashboard';
import AdminProperties from '@/components/admin/AdminProperties';
import AdminInvoices from '@/components/admin/AdminInvoices';
import AdminMetrics, { fmtKpi, kpiStatus, pickWeeks, KPI_GROUPS } from '@/components/AdminMetrics';
import AdminMandates, { statusText } from '@/components/AdminMandates';
import { actionKind, rowActions } from '@/components/admin/AdminTodo';
import { checkChips } from '@/components/admin/AdminProperties';
import { callAction, displayName, sinceText, REMOVAL_REASONS, ownershipInfo } from '@/components/admin/shared';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.scrollTo = jest.fn();
Element.prototype.scrollIntoView = jest.fn();
if (typeof window.ResizeObserver === 'undefined') {
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}
if (typeof window.HTMLElement.prototype.hasPointerCapture === 'undefined') {
  window.HTMLElement.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.releasePointerCapture = () => {};
}

const mounted = [];
const flush = async () => { await act(async () => { await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); }); };
const render = async (ui, path = '/admin/dashboard') => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<MemoryRouter initialEntries={[path]}><Routes><Route path="*" element={ui} /></Routes></MemoryRouter>);
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

const admin = { id: 'a1', role: 'admin', email: 'admin@exemple.fr', email_verified: true };

const todo = {
  generated_at: '2026-10-10T08:00:00Z',
  total: 5,
  sections: [
    { key: 'ownership_proofs', title: 'Justificatifs de propriété à contrôler', rows: [
      { type: 'ownership_pending', id: 'op1', title: 'Appartement T2 loué · 42 m² · Lyon (69)', detail: 'Déposé par Michel Dupont', since: '2026-10-09T10:00:00Z',
        ref: { property_id: 'c1', doc_type: 'titre-propriete', uploaded_at: '2026-10-09T10:00:00Z' },
        actions: [
          { label: 'Voir le justificatif', method: 'GET', url: '/api/properties/c1/ownership-proof/file' },
          { label: 'Valider', method: 'PUT', url: '/api/admin/properties/c1/ownership', body: { status: 'verified' } },
          { label: 'Refuser avec motif', method: 'PUT', url: '/api/admin/properties/c1/ownership', body: { status: 'rejected', note: '<motif>' } },
        ] },
      // Ligne sans action fournie : Valider et Refuser sont proposés par défaut
      { type: 'ownership_pending', id: 'op2', title: 'Maison T4 louée · 95 m² · Nantes (44)', ref: { property_id: 'c3', doc_type: 'statuts-kbis', owner_type: 'sci' } },
    ] },
    { key: 'listings_review', title: 'Annonces publiées à relire (48 h)', rows: [
      { type: 'listing_review', id: 'c1', title: 'Appartement T2 loué · 42 m² · Lyon (69)', detail: 'Drapeaux : impayés déclarés', since: '2026-10-09T10:00:00Z',
        ref: { property_id: 'c1', asking_price: 145000, flags: ['tenant_unpaid'] },
        actions: [
          { label: 'Valider', method: 'PUT', url: '/api/properties/c1/status?status=published' },
          { label: 'Retirer avec motif', method: 'PUT', url: '/api/properties/c1/status?status=removed&reason=<motif>&reason_text=<texte>', reasons: { justificatif: 'x' } },
        ] },
    ] },
    { key: 'dataroom_unanswered', title: 'Demandes de dossier sans réponse (> 7 j)', rows: [] },
    { key: 'todos', title: 'Factures en retard, contestations, données manquantes', rows: [
      { type: 'invoice_overdue', id: 't1', title: 'Facture n° FAC-2026-00001 impayée', since: '2026-10-01T10:00:00Z',
        ref: { invoice_id: 'i1', invoice_number: 'FAC-2026-00001', total_ttc: 4800, due_on: '2026-09-30', debtor_name: 'Michel Dupont' },
        actions: [
          { label: 'Marquer payée', method: 'PUT', url: '/api/admin/invoices/i1/paid' },
          { label: 'Ouvrir', method: 'GET', url: '/api/admin/invoices/i1/mise-en-demeure.pdf' },
          { label: 'Clore', method: 'PUT', url: '/api/admin/todos/t1/done' },
        ] },
    ] },
    { key: 'closings_declared', title: 'Ventes déclarées ou contestées', rows: [
      { type: 'closing_declared', id: 'cl1', title: 'Acte authentique déclaré, en attente de confirmation', since: '2026-10-08T10:00:00Z', ref: { closing_id: 'cl1', property_id: 'c1' },
        actions: [
          { label: 'Confirmer', method: 'PUT', url: '/api/admin/closings/cl1/resolve', body: { action: 'confirm' } },
          { label: 'Annuler la déclaration', method: 'PUT', url: '/api/admin/closings/cl1/resolve', body: { action: 'cancel' } },
        ] },
    ] },
  ],
};

const properties = [
  { id: 'c1', title: 'Appartement T2 loué · 42 m² · Lyon (69)', property_type: 'appartement', owner_type: 'personne-physique', address: '12 rue de Marseille', postal_code: '69007', city: 'Lyon', department: '69', region: 'Auvergne-Rhône-Alpes',
    asking_price: 145000, gross_yield: 5.3, status: 'published', published_at: '2026-10-09T10:00:00Z', views: 12, favorites_count: 0, messages_count: 2,
    ownership: { status: 'pending', doc_type: 'titre-propriete', uploaded_at: '2026-10-09T10:00:00Z' },
    moderation: { status: 'pending', flags: ['ownership_pending', 'tenant_unpaid', 'dpe_rental_ban'], review_until: '2026-10-11T10:00:00Z' },
    property_checks: { ownership_verified: false, dpe_rental_status: 'echeance', opendata_available: true },
    seller: { id: 'u1', first_name: null, last_name: null, email: 'michel@exemple.fr', phone: '0612345678' } },
  { id: 'c2', title: 'Local commercial loué · 80 m² · Rennes (35)', property_type: 'local-commercial', owner_type: 'sci', company_name: 'SCI Les Tilleuls', siret: '12345678900012', city: 'Rennes', postal_code: '35000', status: 'removed', created_at: '2026-09-01T10:00:00Z', views: 0,
    ownership: { status: 'rejected', doc_type: 'taxe-fonciere', note: 'Document illisible' },
    property_checks: { siren_active: true, gerant_match: 'no_match' },
    moderation: { status: 'removed', reason: 'doublon', reason_text: 'Une annonce existe déjà pour ce bien' }, seller: { first_name: 'Anne', last_name: 'Martin', email: 'anne@exemple.fr' } },
];

const users = [
  { id: 'u1', role: 'seller', first_name: null, last_name: null, email: 'michel@exemple.fr', email_verified: true, identity_verified: false, kyc_status: 'manual_review', created_at: '2026-09-20T10:00:00Z' },
  { id: 'b1', role: 'buyer', first_name: 'Claire', last_name: 'Martin', email: 'claire@exemple.fr', email_verified: false, identity_verified: true, profile_score: 70,
    buyer_profile: { project_type: 'sci', budget_max: 250000, financing: 'mixte', zones: ['Bretagne'], property_types: ['appartement', 'maison'], min_yield: 5.5, horizon: '6-12', siren_verified: true }, created_at: '2026-10-01T10:00:00Z' },
];

const kpis = {
  weeks: [
    { start: '2026-09-28', end: '2026-10-04', kpis: { listings_published: 1, contacts: 3, nda_signed: 1, offers: 0, invoices_paid: 0, seller_response_48h_pct: 100, costs: 0 } },
    { start: '2026-10-05', end: '2026-10-11', kpis: { listings_published: 2, listings_blocked: 1, contacts: 6, contacts_per_listing_30d: 3, nda_signed: 2, offers: 1, seller_response_48h_pct: 50, requests_expired: 0, invoices_issued: 1, invoices_paid: 0, invoices_overdue: 0, ownership_pending: 0, costs: 120, blocking_actions: 1, auto_publish_pct: 100, publish_delay_median_h: 0.5 } },
  ],
  targets: { listings_published: 1, contacts_per_listing_30d: 5, seller_response_48h_pct: 80, requests_expired: 1, ownership_pending: 0, costs: 600, blocking_actions: 3, auto_publish_pct: 90, publish_delay_median_h: 1 },
  current: {},
};

const mandates = [
  { id: 'm1', registry_number: '2026-0001', contract_number: 'MAN-1', status: 'signed', signed_at: '2026-10-01T10:00:00Z', ends_at: '2027-10-01T10:00:00Z', tail_ends_at: '2028-10-01T10:00:00Z', withdrawal_ends_at: '2026-10-15T10:00:00Z', property_label: 'Appartement T2 loué · Lyon (69)', listing_status: 'published', seller_name: 'Michel Dupont', terms_version: 'v1' },
  { id: 'm2', registry_number: '2026-0002', contract_number: 'MAN-2', status: 'withdrawn_retractation', signed_at: '2026-10-02T10:00:00Z', effective_at: '2026-10-05T10:00:00Z', ends_at: '2027-10-02T10:00:00Z', tail_ends_at: '2028-10-02T10:00:00Z', property_label: 'Parking loué · Paris (75)', seller_name: 'Anne Martin', terms_version: 'v1' },
];

const route = (url, table) => {
  const key = Object.keys(table).find((k) => url.startsWith(k));
  return key ? table[key] : {};
};

beforeEach(() => {
  jest.clearAllMocks();
  api.get.mockImplementation((url) => Promise.resolve({ data: route(url, {
    '/admin/todo': todo,
    '/admin/stats': { total_properties: 2, published_properties: 1, ownership_pending: 2, total_users: 2, invoices_count: 0, total_revenue: 0, paid_revenue: 0 },
    '/admin/properties': { properties },
    '/admin/users': users,
    '/admin/kpis': kpis,
    '/admin/mandates': { mandates },
    '/admin/costs': { costs: [{ month: '2026-10', amount: 120, note: 'Hébergement, identité' }] },
    '/admin/metrics': { period_days: 30, events: { days: [{ day: '2026-10-09', visitors: 4, events: { page_view: 10, contact_sent: 1 } }, { day: '2026-10-10', visitors: 0, events: { page_view: 0, contact_sent: 0 } }], totals: { page_view: 10, contact_sent: 1 }, paths: [{ path: '/', count: 6 }], names: ['contact_sent', 'page_view'], visitor_days: 4 }, funnel: [{ step: 'Acquéreurs inscrits', count: 1 }] },
    '/admin/invoices': { invoices: [{ id: 'i1', number: 'FAC-2026-00001', status: 'issued', overdue: true, debtor: { name: 'Michel Dupont', property: 'Appartement T2 loué · Lyon (69)' }, property_label: 'Appartement T2 loué · Lyon (69)', sale_object: 'bien', issued_on: '2026-09-01', due_on: '2026-10-01', total_ht: 4000, total_ttc: 4800, reminders: ['2026-09-16'], pdf_url: '/api/invoices/i1/pdf' }], totals: { issued_ht: 4000, paid_ht: 0, overdue_ttc: 4800 } },
  }) }));
  api.post.mockResolvedValue({ data: { 'daily:closing': '0' } });
  api.put.mockResolvedValue({ data: { ok: true } });
  api.request.mockResolvedValue({ data: { message: 'Status updated' } });
});

afterEach(() => {
  mounted.splice(0).forEach(({ root, container }) => { act(() => root.unmount()); container.remove(); });
});

// Vocabulaire CessionRGE : jamais à l'écran de l'administration
const expectVenteLoc = (c) => {
  expect(c.textContent).not.toMatch(/repreneur|cédant|BODACC|ADEME|bâtiment|dirigeant|rédacteur|Incidents/i);
  expect(c.textContent).not.toMatch(/\bRGE\b/);
};

describe('helpers', () => {
  test('displayName ne produit jamais « null null »', () => {
    expect(displayName({ first_name: null, last_name: null, email: 'a@b.fr' })).toBe('a@b.fr');
    expect(displayName({ first_name: 'Anne', last_name: 'Martin' })).toBe('Anne Martin');
    expect(displayName({ deleted_at: '2026-01-01' })).toBe('Compte supprimé');
    expect(sinceText('')).toBe('');
  });

  test('actionKind et callAction (paramètres génériques remplacés)', async () => {
    expect(actionKind({ method: 'PUT', url: '/api/properties/c1/status?status=removed&reason=<motif>&reason_text=<texte>' })).toBe('remove');
    expect(actionKind({ method: 'PUT', url: '/api/admin/invoices/i1/paid' })).toBe('paid');
    expect(actionKind({ method: 'PUT', url: '/api/admin/closings/x/resolve', body: { action: 'confirm' } })).toBe('resolve');
    expect(actionKind({ method: 'GET', url: '/api/admin/invoices/i1/mise-en-demeure.pdf' })).toBe('pdf');
    expect(actionKind({ method: 'GET', url: '/api/admin/closings?status=in_progress' })).toBe('open');
    expect(actionKind({ method: 'POST', url: '/api/admin/jobs/run' })).toBe('call');
    expect(actionKind({ label: 'Valider', method: 'PUT', url: '/api/admin/properties/c1/ownership', body: { status: 'verified' } })).toBe('ownership_verify');
    expect(actionKind({ label: 'Refuser', method: 'PUT', url: '/api/admin/properties/c1/ownership', body: { status: 'rejected' } })).toBe('ownership_reject');
    expect(actionKind({ label: 'Refuser avec motif', method: 'PUT', url: '/api/admin/properties/c1/ownership' })).toBe('ownership_reject');
    expect(actionKind({ label: 'Voir le justificatif', method: 'GET', url: '/api/properties/c1/ownership-proof/file' })).toBe('proof');
    await callAction({ method: 'PUT', url: '/api/properties/c1/status?status=removed&reason=<motif>&reason_text=<texte>' }, { params: { reason: 'doublon', reason_text: 'Déjà en ligne' } });
    expect(api.request).toHaveBeenCalledWith({ method: 'put', url: '/properties/c1/status', params: { status: 'removed', reason: 'doublon', reason_text: 'Déjà en ligne' }, data: undefined });
  });

  test('justificatifs : actions par défaut, statuts libellés, motifs de retrait SPEC §5.4', () => {
    const section = { key: 'ownership_proofs' };
    expect(rowActions(section, { ref: { property_id: 'c9' } })).toEqual([
      { label: 'Valider', method: 'PUT', url: '/admin/properties/c9/ownership', body: { status: 'verified' } },
      { label: 'Refuser avec motif', method: 'PUT', url: '/admin/properties/c9/ownership', body: { status: 'rejected' } },
    ]);
    expect(rowActions({ key: 'todos' }, { ref: { property_id: 'c9' } })).toEqual([]);
    expect(ownershipInfo({ status: 'verified' })).toEqual({ label: 'Propriétaire vérifié', tone: 'success' });
    expect(ownershipInfo(undefined).label).toBe('Justificatif non déposé');
    expect(REMOVAL_REASONS.map((r) => r.value)).toEqual(['justificatif', 'informations-inexactes', 'doublon', 'bien-non-loue', 'contenu-interdit', 'autre']);
    expect(checkChips({ siren_active: false, gerant_match: 'no_match', dpe_rental_status: 'interdit', opendata_available: false }).map((ch) => ch.label))
      .toEqual(['Société cessée au registre', 'Gérant non concordant', 'Logement interdit à la location (DPE)', 'Open data indisponible']);
  });

  test('KPI : format, cible, choix des semaines, vocabulaire VenteLoc', () => {
    expect(fmtKpi(0, 'count')).toBe('—');
    expect(fmtKpi(42.4, 'pct')).toBe('42 %');
    expect(fmtKpi(0.5, 'hours')).toBe('30 min');
    expect(kpiStatus(50, 80, 'up')).toBe('off');
    expect(kpiStatus(0, 0, 'down')).toBe('ok');
    expect(kpiStatus(1, undefined, 'up')).toBeNull();
    const { thisWeek, prevWeek } = pickWeeks(kpis);
    expect(thisWeek.start).toBe('2026-10-05');
    expect(prevWeek.start).toBe('2026-09-28');
    expect(pickWeeks({ weeks: kpis.weeks, current: { start: '2026-10-12', end: '2026-10-18', kpis: { contacts: 1 } } }).prevWeek.start).toBe('2026-10-05');
    const items = KPI_GROUPS.flatMap((g) => g.items);
    expect(items.map((i) => i.key)).toContain('ownership_pending');
    expect(items.map((i) => i.key)).not.toContain('bodacc_incidents');
    expect(KPI_GROUPS.map((g) => g.title).join(' ') + items.map((i) => i.label).join(' ')).not.toMatch(/cédant|repreneur|NDA|indicative|BODACC/);
  });

  test('registre des mandats : rétractation libellée', () => {
    expect(statusText(mandates[1])).toMatch(/^Rétractation/);
    expect(statusText(mandates[1])).toContain('annonce dépubliée');
  });
});

describe('AdminDashboard', () => {
  test('onglet « À faire » par défaut, sans onglet Incidents, aucune route retirée appelée, compteur', async () => {
    const c = await render(<AdminDashboard user={admin} setUser={jest.fn()} />);
    expectVenteLoc(c);
    expect(c.querySelector('[data-testid="admin-todo"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="todo-count"]').textContent).toBe('5');
    expect(c.querySelector('[data-testid="admin-tab-incidents"]')).toBeNull();
    expect(c.querySelector('[data-testid="stat-ownership"]').textContent).toContain('Justificatifs à contrôler');
    expect(c.querySelector('[data-testid="todo-section-ownership_proofs"]').textContent).toContain('Justificatifs de propriété à contrôler');
    expect(c.querySelector('[data-testid="todo-section-listings_review"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="todo-section-dataroom_unanswered"]')).toBeNull();
    expect(c.textContent).toMatch(/Prix demandé 145\s000\s€/);
    const calls = api.get.mock.calls.map((call) => call[0]);
    ['/admin/messages', '/admin/transactions', '/admin/dataroom', '/admin/contracts', '/admin/veille', '/admin/incidents', 'reset-password', 'credits', 'stripe'].forEach((forbidden) => {
      expect(calls.some((u) => u.includes(forbidden))).toBe(false);
    });
    expect(calls).toContain('/admin/stats');
    expect(c.textContent).not.toMatch(/null null/);
    expect(c.textContent).not.toMatch(/0 vues/);
  });

  test('justificatifs : aperçu du fichier, « Valider » puis « Refuser » avec motif obligatoire', async () => {
    const createObjectURL = jest.fn(() => 'blob:preuve');
    const revokeObjectURL = jest.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    api.get.mockImplementation((url) => {
      if (url === '/properties/c1/ownership-proof/file') return Promise.resolve({ data: new Blob(['%PDF'], { type: 'application/pdf' }), headers: { 'content-type': 'application/pdf' } });
      return Promise.resolve({ data: route(url, { '/admin/todo': todo, '/admin/properties': { properties }, '/admin/users': users, '/admin/stats': {} }) });
    });
    const c = await render(<AdminDashboard user={admin} setUser={jest.fn()} />);
    const row = c.querySelector('[data-testid="todo-row-op1"]');
    expect(row.textContent).toContain('Titre de propriété');
    // Aperçu fourni par le serveur (action GET) : pas de lien en double, pas de navigation vers l'onglet Annonces
    expect(c.querySelector('[data-testid="todo-proof-op1"]')).toBeNull();
    await click(c.querySelector('[data-testid="todo-action-op1-proof"]'));
    expect(api.get).toHaveBeenCalledWith('/properties/c1/ownership-proof/file', { responseType: 'blob' });
    expect(createObjectURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(c.querySelector('[data-testid="admin-todo"]')).toBeTruthy();
    // Ligne sans action d'aperçu : lien « Voir le justificatif »
    await click(c.querySelector('[data-testid="todo-proof-op2"]'));
    expect(api.get).toHaveBeenCalledWith('/properties/c3/ownership-proof/file', { responseType: 'blob' });
    await click(c.querySelector('[data-testid="todo-action-op1-ownership_verify"]'));
    expect(api.request).toHaveBeenCalledWith({ method: 'put', url: '/admin/properties/c1/ownership', params: {}, data: { status: 'verified' } });
    // Ligne sans action fournie par le serveur : boutons par défaut, refus motivé
    await click(c.querySelector('[data-testid="todo-action-op2-ownership_reject"]'));
    const dialog = document.body.querySelector('[data-testid="ownership-reject-dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog.querySelector('[data-testid="ownership-reject-dialog-confirm"]').disabled).toBe(true);
    setValue(dialog.querySelector('[data-testid="ownership-reject-dialog-note"]'), 'Statuts non signés');
    await flush();
    await click(dialog.querySelector('[data-testid="ownership-reject-dialog-confirm"]'));
    expect(api.request).toHaveBeenCalledWith({ method: 'put', url: '/admin/properties/c3/ownership', params: {}, data: { status: 'rejected', note: 'Statuts non signés' } });
    clickSpy.mockRestore();
  });

  test('« Valider » appelle l\'action telle quelle ; « Retirer avec motif » demande le motif', async () => {
    const c = await render(<AdminDashboard user={admin} setUser={jest.fn()} />);
    await click(c.querySelector('[data-testid="todo-action-c1-call"]'));
    expect(api.request).toHaveBeenCalledWith({ method: 'put', url: '/properties/c1/status', params: { status: 'published' }, data: undefined });
    await click(c.querySelector('[data-testid="todo-action-c1-remove"]'));
    const dialog = document.body.querySelector('[data-testid="removal-dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain('le vendeur reçoit le motif');
    setValue(dialog.querySelector('[data-testid="removal-reason"]'), 'autre');
    await flush();
    expect(dialog.querySelector('[data-testid="removal-dialog-confirm"]').disabled).toBe(true);
    setValue(dialog.querySelector('[data-testid="removal-text"]'), 'Nom du locataire dans la description');
    await flush();
    await click(dialog.querySelector('[data-testid="removal-dialog-confirm"]'));
    expect(api.request).toHaveBeenCalledWith({ method: 'put', url: '/properties/c1/status', params: { status: 'removed', reason: 'autre', reason_text: 'Nom du locataire dans la description' }, data: undefined });
  });

  test('« Marquer payée » envoie {paid_on, amount} ; « Confirmer » envoie le corps avec la note', async () => {
    const c = await render(<AdminDashboard user={admin} setUser={jest.fn()} />);
    await click(c.querySelector('[data-testid="todo-action-t1-paid"]'));
    const paid = document.body.querySelector('[data-testid="paid-dialog"]');
    expect(paid.querySelector('[data-testid="paid-amount"]').value).toBe('4800');
    setValue(paid.querySelector('[data-testid="paid-on"]'), '2026-10-09');
    await flush();
    await click(paid.querySelector('[data-testid="paid-dialog-confirm"]'));
    expect(api.request).toHaveBeenCalledWith({ method: 'put', url: '/admin/invoices/i1/paid', params: {}, data: { paid_on: '2026-10-09', amount: 4800 } });
    await click(c.querySelector('[data-testid="todo-action-cl1-resolve"]'));
    const resolve = document.body.querySelector('[data-testid="resolve-dialog"]');
    expect(resolve.textContent).toContain('notaire');
    setValue(resolve.querySelector('[data-testid="resolve-dialog-note"]'), 'Acte reçu');
    await flush();
    await click(resolve.querySelector('[data-testid="resolve-dialog-confirm"]'));
    expect(api.request).toHaveBeenCalledWith({ method: 'put', url: '/admin/closings/cl1/resolve', params: {}, data: { action: 'confirm', note: 'Acte reçu' } });
  });

  test('liste vide explicite et bouton « Lancer les tâches »', async () => {
    api.get.mockImplementation((url) => Promise.resolve({ data: url.startsWith('/admin/todo') ? { total: 0, sections: [] } : url.startsWith('/admin/properties') ? { properties: [] } : url.startsWith('/admin/users') ? [] : {} }));
    const c = await render(<AdminDashboard user={admin} setUser={jest.fn()} />);
    expect(c.querySelector('[data-testid="todo-empty"]').textContent).toMatch(/Rien à traiter/);
    expect(c.querySelector('[data-testid="todo-count"]')).toBeNull();
    expect(c.querySelector('[data-testid="admin-stats"]')).toBeNull();
    await click(c.querySelector('[data-testid="admin-run-jobs"]'));
    expect(api.post).toHaveBeenCalledWith('/admin/jobs/run');
  });

  test('?tab=users ouvre l\'onglet Utilisateurs avec les statuts libellés', async () => {
    const c = await render(<AdminDashboard user={admin} setUser={jest.fn()} />, '/admin/dashboard?tab=users');
    expectVenteLoc(c);
    expect(c.querySelector('[data-testid="admin-users"]')).toBeTruthy();
    expect(c.textContent).toMatch(/Identité en repli/);
    expect(c.textContent).toMatch(/E-mail non confirmé/);
    expect(c.textContent).toMatch(/Profil acquéreur complet à 70 %/);
    expect(c.textContent).toMatch(/Achat via une SCI/);
    expect(c.textContent).toMatch(/Appartement, Maison/);
    expect(c.textContent).toMatch(/rendement ≥ 5,5 %/);
    expect(c.textContent).toMatch(/société vérifiée/);
    expect(c.textContent).not.toMatch(/null null/);
    await click(c.querySelector('[data-testid="user-verify-u1"]'));
    await click(document.body.querySelector('[data-testid="verify-dialog-confirm"]'));
    expect(api.put).toHaveBeenCalledWith('/admin/kyc/u1/validate', null, { params: { status: 'verified' } });
  });
});

describe('AdminProperties', () => {
  test('colonne « Justificatif », drapeaux libellés, vues réelles, retrait motivé, lien fiche', async () => {
    const onReload = jest.fn();
    const c = await render(<AdminProperties properties={properties} loading={false} onReload={onReload} />);
    expectVenteLoc(c);
    expect(c.textContent).toMatch(/12 vues/);
    expect(c.textContent).toMatch(/2 messages/);
    expect(c.textContent).not.toMatch(/0 favori/);
    expect(c.textContent).toMatch(/12 rue de Marseille · 69007 Lyon/);
    expect(c.textContent).toMatch(/rendement brut 5,3 %/);
    expect(c.querySelector('[data-testid="property-ownership-status-c1"]').textContent).toBe('Justificatif à contrôler');
    expect(c.querySelector('[data-testid="property-ownership-c1"]').textContent).toContain('Titre de propriété');
    expect(c.querySelector('[data-testid="property-ownership-status-c2"]').textContent).toBe('Justificatif refusé');
    expect(c.querySelector('[data-testid="property-ownership-c2"]').textContent).toContain('Motif : Document illisible');
    expect(c.querySelector('[data-testid="property-proof-verify-c2"]')).toBeNull();
    expect(c.textContent).toMatch(/Interdiction de louer à venir \(DPE\)/);
    expect(c.textContent).toMatch(/Gérant non concordant/);
    expect(c.textContent).toMatch(/SCI Les Tilleuls · SIRET 12345678900012/);
    // Le drapeau « justificatif à contrôler » n'est pas répété : il est dans la colonne Justificatif
    expect(c.querySelector('[data-testid="property-c1"]').textContent.match(/Justificatif à contrôler/g)).toHaveLength(1);
    expect(c.textContent).toMatch(/En ligne · relecture en cours/);
    expect(c.textContent).toMatch(/Retirée : Une annonce existe déjà/);
    expect(c.textContent).toMatch(/Vendeur : michel@exemple.fr/);
    expect(c.textContent).not.toMatch(/null/);
    expect(c.querySelector('[data-testid="property-link-c1"]').getAttribute('href')).toBe('/annonce/c1');
    await click(c.querySelector('[data-testid="property-proof-verify-c1"]'));
    expect(api.put).toHaveBeenCalledWith('/admin/properties/c1/ownership', { status: 'verified' });
    await click(c.querySelector('[data-testid="property-proof-reject-c1"]'));
    const reject = document.body.querySelector('[data-testid="ownership-reject-dialog"]');
    setValue(reject.querySelector('[data-testid="ownership-reject-dialog-note"]'), 'Le nom ne correspond pas');
    await flush();
    await click(reject.querySelector('[data-testid="ownership-reject-dialog-confirm"]'));
    expect(api.put).toHaveBeenCalledWith('/admin/properties/c1/ownership', { status: 'rejected', note: 'Le nom ne correspond pas' });
    await click(c.querySelector('[data-testid="property-remove-c1"]'));
    const dialog = document.body.querySelector('[data-testid="removal-dialog"]');
    setValue(dialog.querySelector('[data-testid="removal-reason"]'), 'bien-non-loue');
    await flush();
    await click(dialog.querySelector('[data-testid="removal-dialog-confirm"]'));
    expect(api.put).toHaveBeenCalledWith('/properties/c1/status', null, { params: { status: 'removed', reason: 'bien-non-loue', reason_text: '' } });
    expect(onReload).toHaveBeenCalled();
  });

  test('filtre « Justificatif à contrôler »', async () => {
    const c = await render(<AdminProperties properties={properties} loading={false} onReload={jest.fn()} />);
    setValue(c.querySelector('[data-testid="properties-filter"]'), 'ownership');
    await flush();
    expect(c.querySelector('[data-testid="property-c1"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="property-c2"]')).toBeNull();
  });
});

describe('AdminMandates', () => {
  test('registre : statut « Rétractation », filtre, colonne Vendeur', async () => {
    const c = await render(<AdminMandates />);
    expectVenteLoc(c);
    expect(c.querySelector('[data-testid="mandate-status-m2"]').textContent).toMatch(/^Rétractation le .* · annonce dépubliée$/);
    expect(c.textContent).toContain('Vendeur');
    expect(c.textContent).toContain('Mandat simple v1');
    expect(c.querySelector('[data-testid="admin-mandates"]').textContent).toMatch(/1 en cours · 1 rétractation/);
    setValue(c.querySelector('[data-testid="mandates-filter"]'), 'withdrawn_retractation');
    await flush();
    expect(c.querySelector('[data-testid="mandate-status-m1"]')).toBeNull();
    expect(c.querySelector('[data-testid="mandate-status-m2"]')).toBeTruthy();
  });
});

describe('AdminInvoices', () => {
  test('liste, totaux, marquer payée, annuler avec motif', async () => {
    const c = await render(<AdminInvoices />);
    expect(c.textContent).toMatch(/FAC-2026-00001/);
    expect(c.textContent).toMatch(/En retard/);
    expect(c.textContent).toMatch(/1 relance/);
    expect(c.querySelector('[data-testid="invoice-notice-i1"]')).toBeTruthy();
    await click(c.querySelector('[data-testid="invoice-paid-i1"]'));
    const paid = document.body.querySelector('[data-testid="paid-dialog"]');
    expect(paid.textContent).toContain('le vendeur reçoit une confirmation');
    await click(paid.querySelector('[data-testid="paid-dialog-confirm"]'));
    expect(api.put).toHaveBeenCalledWith('/admin/invoices/i1/paid', expect.objectContaining({ amount: 4800 }));
    await click(c.querySelector('[data-testid="invoice-cancel-i1"]'));
    const cancel = document.body.querySelector('[data-testid="cancel-invoice-dialog"]');
    expect(cancel.querySelector('[data-testid="cancel-invoice-dialog-confirm"]').disabled).toBe(true);
    setValue(cancel.querySelector('[data-testid="cancel-invoice-dialog-note"]'), 'Erreur de montant');
    await flush();
    await click(cancel.querySelector('[data-testid="cancel-invoice-dialog-confirm"]'));
    expect(api.put).toHaveBeenCalledWith('/admin/invoices/i1/cancel', { reason: 'Erreur de montant' });
  });
});

describe('AdminMetrics', () => {
  test('écran du lundi : semaine vs précédente vs cible, coûts, événements', async () => {
    const c = await render(<AdminMetrics stats={{ total_revenue: 4000, paid_revenue: 0, invoices_count: 1 }} />);
    expectVenteLoc(c);
    expect(c.querySelector('[data-testid="kpi-table"]')).toBeTruthy();
    const row = c.querySelector('[data-testid="kpi-seller_response_48h_pct"]');
    expect(row.textContent).toMatch(/Réponse du vendeur sous 48 h/);
    expect(row.textContent).toMatch(/50 %/);
    expect(row.textContent).toMatch(/100 %/);
    expect(row.textContent).toMatch(/≥ 80 %/);
    expect(c.querySelector('[data-testid="kpi-nda_signed"]').textContent).toMatch(/Engagements de confidentialité signés/);
    expect(c.querySelector('[data-testid="kpi-offers"]').textContent).toMatch(/Offres d'achat/);
    expect(c.querySelector('[data-testid="kpi-ownership_pending"]').textContent).toMatch(/Justificatifs de propriété à contrôler/);
    expect(c.querySelector('[data-testid="kpi-bodacc_incidents"]')).toBeNull();
    expect(c.querySelector('[data-testid="kpi-off-target"]').textContent).toMatch(/2 indicateurs sous la cible/);
    expect(c.querySelector('[data-testid="kpi-contacts"]').textContent).toMatch(/▲/);
    expect(c.textContent).toMatch(/Facturé : 4\s000,00\s€ HT/);
    expect(c.textContent).toMatch(/suivi hors plateforme/);
    expect(c.textContent).toMatch(/investissement locatif/);
    expect(c.querySelector('[data-testid="costs-list"]').textContent).toMatch(/octobre 2026/);
    setValue(c.querySelector('[data-testid="cost-amount"]'), '150');
    setValue(c.querySelector('[data-testid="cost-month"]'), '2026-11');
    await flush();
    await click(c.querySelector('[data-testid="cost-save"]'));
    expect(api.put).toHaveBeenCalledWith('/admin/costs', { month: '2026-11', amount: 150, note: undefined });
    expect(c.querySelector('[data-testid="events-by-name"]').textContent).toMatch(/Pages vues/);
    expect(c.querySelector('[data-testid="events-by-day"]').textContent).toMatch(/9 oct/);
    expect(c.querySelector('[data-testid="events-by-day"]').textContent).not.toMatch(/10 oct/);
    expect(c.querySelector('[data-testid="buyer-funnel"]')).toBeTruthy();
    expect(c.textContent).toMatch(/Entonnoir acquéreurs/);
  });

  test('indicateurs indisponibles : état vide explicite', async () => {
    api.get.mockImplementation((url) => (url.startsWith('/admin/kpis') ? Promise.reject({ response: { status: 404, data: { detail: 'Not Found' } } }) : Promise.resolve({ data: url.startsWith('/admin/costs') ? [] : { events: null } })));
    const c = await render(<AdminMetrics stats={{}} />);
    expect(c.querySelector('[data-testid="kpi-empty"]').textContent).toMatch(/pas encore disponibles/);
    expect(c.querySelector('[data-testid="events-empty"]')).toBeTruthy();
    expect(c.textContent).toMatch(/Aucune facture émise/);
  });
});
