// Tests de rendu de l'administration (AdminDashboard « À faire » par défaut, actions des lignes appelées telles
// quelles, retrait motivé, Annonces sans « (null null) » ni « 0 vues », Factures, écran du lundi, coûts).
// Exécution : cd frontend && CI=true npx craco test --watchAll=false src/components/admin/__tests__/admin.test.jsx
import '@/components/shared/jestEnv';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

jest.mock('@/App', () => ({
  axiosInstance: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn(), request: jest.fn() },
  API: '/api',
  EMAIL_NOT_VERIFIED_EVENT: 'cession:email-not-verified',
}));
// Jest 27 (react-scripts) ne lit pas le champ « exports » des paquets Radix : sous-chemin résolu à la main
jest.mock('@radix-ui/primitive/is-development', () => jest.requireActual('@radix-ui/primitive/dist/internal/is-development.false.js'), { virtual: true });

import { axiosInstance as api } from '@/App';
import AdminDashboard from '@/pages/AdminDashboard';
import AdminCompanies from '@/components/admin/AdminCompanies';
import AdminInvoices from '@/components/admin/AdminInvoices';
import AdminMetrics, { fmtKpi, kpiStatus, pickWeeks } from '@/components/AdminMetrics';
import { actionKind } from '@/components/admin/AdminTodo';
import { callAction, displayName, sinceText } from '@/components/admin/shared';

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
  total: 3,
  sections: [
    { key: 'listings_review', title: 'Annonces publiées à relire (48 h)', rows: [
      { type: 'listing_review', id: 'c1', title: 'Entreprise de plomberie-chauffage · Bretagne · 6 salariés', detail: 'Drapeaux : code NAF connexe au bâtiment', since: '2026-10-09T10:00:00Z',
        ref: { company_id: 'c1', company_name: 'SARL Exemple', siret: '12345678900012', flags: ['naf_connexe'], asking_price: 290000 },
        actions: [
          { label: 'Valider', method: 'PUT', url: '/api/companies/c1/status?status=published' },
          { label: 'Retirer avec motif', method: 'PUT', url: '/api/companies/c1/status?status=removed&reason=<motif>&reason_text=<texte>', reasons: { coordonnees: 'x' } },
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
      { type: 'closing_declared', id: 'cl1', title: 'Vente déclarée, en attente de confirmation — SARL Exemple', since: '2026-10-08T10:00:00Z', ref: { closing_id: 'cl1', company_id: 'c1' },
        actions: [
          { label: 'Confirmer', method: 'PUT', url: '/api/admin/closings/cl1/resolve', body: { action: 'confirm' } },
          { label: 'Annuler la déclaration', method: 'PUT', url: '/api/admin/closings/cl1/resolve', body: { action: 'cancel' } },
        ] },
    ] },
  ],
};

const companies = [
  { id: 'c1', title: 'Entreprise de plomberie-chauffage · Bretagne · 6 salariés', company_name: 'SARL Exemple', siret: '12345678900012', trades: ['plomberie-chauffage'], region: 'Bretagne', department: '29', staff_count: 6, asking_price: 290000,
    status: 'published', published_at: '2026-10-09T10:00:00Z', views: 12, favorites_count: 0, messages_count: 2,
    moderation: { status: 'pending', flags: ['naf_connexe'], review_until: '2026-10-11T10:00:00Z' },
    company_checks: { siren_active: true, naf_in_building: false, in_ademe_list: true, dirigeant_match: 'match_exact', duplicate_siren: false },
    seller: { id: 'u1', first_name: null, last_name: null, email: 'michel@exemple.fr', phone: '0612345678' } },
  { id: 'c2', title: 'Entreprise d\'isolation · Occitanie · 3 salariés', company_name: 'SAS Isol', status: 'removed', created_at: '2026-09-01T10:00:00Z', views: 0,
    moderation: { status: 'removed', reason: 'doublon', reason_text: 'Une annonce existe déjà pour cette entreprise' }, seller: { first_name: 'Anne', last_name: 'Martin', email: 'anne@exemple.fr' } },
];

const users = [
  { id: 'u1', role: 'seller', first_name: null, last_name: null, email: 'michel@exemple.fr', email_verified: true, identity_verified: false, kyc_status: 'manual_review', created_at: '2026-09-20T10:00:00Z' },
  { id: 'b1', role: 'buyer', first_name: 'Claire', last_name: 'Martin', email: 'claire@exemple.fr', email_verified: false, identity_verified: true, profile_score: 70,
    buyer_profile: { project_type: 'reprise-individuelle', budget_max: 350000, financing: 'mixte', zones: ['Bretagne'], trades: ['plomberie-chauffage'], horizon: '6-12' }, created_at: '2026-10-01T10:00:00Z' },
];

const kpis = {
  weeks: [
    { start: '2026-09-28', end: '2026-10-04', kpis: { listings_published: 1, contacts: 3, nda_signed: 1, offers: 0, invoices_paid: 0, seller_response_48h_pct: 100, costs: 0 } },
    { start: '2026-10-05', end: '2026-10-11', kpis: { listings_published: 2, listings_blocked: 1, contacts: 6, contacts_per_listing_30d: 3, nda_signed: 2, offers: 1, seller_response_48h_pct: 50, requests_expired: 0, invoices_issued: 1, invoices_paid: 0, invoices_overdue: 0, bodacc_incidents: 0, costs: 120, blocking_actions: 1, auto_publish_pct: 100, publish_delay_median_h: 0.5 } },
  ],
  targets: { listings_published: 1, contacts_per_listing_30d: 5, seller_response_48h_pct: 80, requests_expired: 1, bodacc_incidents: 0, costs: 600, blocking_actions: 3, auto_publish_pct: 90, publish_delay_median_h: 1 },
  current: {},
};

const route = (url, table) => {
  const key = Object.keys(table).find((k) => url.startsWith(k));
  return key ? table[key] : {};
};

beforeEach(() => {
  jest.clearAllMocks();
  api.get.mockImplementation((url) => Promise.resolve({ data: route(url, {
    '/admin/todo': todo,
    '/admin/stats': { total_companies: 2, published_companies: 1, total_users: 2, invoices_count: 0, total_revenue: 0, paid_revenue: 0 },
    '/admin/companies': { companies },
    '/admin/users': users,
    '/admin/kpis': kpis,
    '/admin/costs': { costs: [{ month: '2026-10', amount: 120, note: 'Hébergement, identité' }] },
    '/admin/metrics': { period_days: 30, events: { days: [{ day: '2026-10-09', visitors: 4, events: { page_view: 10, contact_sent: 1 } }, { day: '2026-10-10', visitors: 0, events: { page_view: 0, contact_sent: 0 } }], totals: { page_view: 10, contact_sent: 1 }, paths: [{ path: '/', count: 6 }], names: ['contact_sent', 'page_view'], visitor_days: 4 }, funnel: [{ step: 'Acquéreurs inscrits', count: 1 }] },
    '/admin/invoices': { invoices: [{ id: 'i1', number: 'FAC-2026-00001', status: 'issued', overdue: true, debtor: { name: 'Michel Dupont', company: 'SARL Exemple', siren: '123456789' }, company_label: 'SARL Exemple', sale_object: 'titres', issued_on: '2026-09-01', due_on: '2026-10-01', total_ht: 4000, total_ttc: 4800, reminders: ['2026-09-16'], pdf_url: '/api/invoices/i1/pdf' }], totals: { issued_ht: 4000, paid_ht: 0, overdue_ttc: 4800 } },
  }) }));
  api.post.mockResolvedValue({ data: { 'daily:closing': '0' } });
  api.put.mockResolvedValue({ data: { ok: true } });
  api.request.mockResolvedValue({ data: { message: 'Status updated' } });
});

afterEach(() => {
  mounted.splice(0).forEach(({ root, container }) => { act(() => root.unmount()); container.remove(); });
});

describe('helpers', () => {
  test('displayName ne produit jamais « null null »', () => {
    expect(displayName({ first_name: null, last_name: null, email: 'a@b.fr' })).toBe('a@b.fr');
    expect(displayName({ first_name: 'Anne', last_name: 'Martin' })).toBe('Anne Martin');
    expect(displayName({ deleted_at: '2026-01-01' })).toBe('Compte supprimé');
    expect(sinceText('')).toBe('');
  });

  test('actionKind et callAction (paramètres génériques remplacés)', async () => {
    expect(actionKind({ method: 'PUT', url: '/api/companies/c1/status?status=removed&reason=<motif>&reason_text=<texte>' })).toBe('remove');
    expect(actionKind({ method: 'PUT', url: '/api/admin/invoices/i1/paid' })).toBe('paid');
    expect(actionKind({ method: 'PUT', url: '/api/admin/closings/x/resolve', body: { action: 'confirm' } })).toBe('resolve');
    expect(actionKind({ method: 'GET', url: '/api/admin/invoices/i1/mise-en-demeure.pdf' })).toBe('pdf');
    expect(actionKind({ method: 'GET', url: '/api/admin/closings?status=in_progress' })).toBe('open');
    expect(actionKind({ method: 'POST', url: '/api/admin/jobs/run' })).toBe('call');
    await callAction({ method: 'PUT', url: '/api/companies/c1/status?status=removed&reason=<motif>&reason_text=<texte>' }, { params: { reason: 'doublon', reason_text: 'Déjà en ligne' } });
    expect(api.request).toHaveBeenCalledWith({ method: 'put', url: '/companies/c1/status', params: { status: 'removed', reason: 'doublon', reason_text: 'Déjà en ligne' }, data: undefined });
  });

  test('KPI : format, cible, choix des semaines', () => {
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
  });
});

describe('AdminDashboard', () => {
  test('onglet « À faire » par défaut, aucune route retirée appelée, compteur', async () => {
    const c = await render(<AdminDashboard user={admin} setUser={jest.fn()} />);
    expect(c.querySelector('[data-testid="admin-todo"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="todo-count"]').textContent).toBe('3');
    expect(c.querySelector('[data-testid="todo-section-listings_review"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="todo-section-dataroom_unanswered"]')).toBeNull();
    expect(c.textContent).toMatch(/SARL Exemple · SIRET 12345678900012/);
    expect(c.textContent).toMatch(/code NAF connexe au bâtiment/);
    const calls = api.get.mock.calls.map((call) => call[0]);
    ['/admin/messages', '/admin/transactions', '/admin/dataroom', '/admin/contracts', 'reset-password', 'credits', 'stripe'].forEach((forbidden) => {
      expect(calls.some((u) => u.includes(forbidden))).toBe(false);
    });
    expect(calls).toContain('/admin/stats');
    expect(c.textContent).not.toMatch(/null null/);
    expect(c.textContent).not.toMatch(/0 vues/);
  });

  test('« Valider » appelle l\'action telle quelle ; « Retirer avec motif » demande le motif', async () => {
    const c = await render(<AdminDashboard user={admin} setUser={jest.fn()} />);
    await click(c.querySelector('[data-testid="todo-action-c1-call"]'));
    expect(api.request).toHaveBeenCalledWith({ method: 'put', url: '/companies/c1/status', params: { status: 'published' }, data: undefined });
    await click(c.querySelector('[data-testid="todo-action-c1-remove"]'));
    const dialog = document.body.querySelector('[data-testid="removal-dialog"]');
    expect(dialog).toBeTruthy();
    setValue(dialog.querySelector('[data-testid="removal-reason"]'), 'autre');
    await flush();
    expect(dialog.querySelector('[data-testid="removal-dialog-confirm"]').disabled).toBe(true);
    setValue(dialog.querySelector('[data-testid="removal-text"]'), 'Coordonnées dans la description');
    await flush();
    await click(dialog.querySelector('[data-testid="removal-dialog-confirm"]'));
    expect(api.request).toHaveBeenCalledWith({ method: 'put', url: '/companies/c1/status', params: { status: 'removed', reason: 'autre', reason_text: 'Coordonnées dans la description' }, data: undefined });
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
    setValue(resolve.querySelector('[data-testid="resolve-dialog-note"]'), 'Acte reçu');
    await flush();
    await click(resolve.querySelector('[data-testid="resolve-dialog-confirm"]'));
    expect(api.request).toHaveBeenCalledWith({ method: 'put', url: '/admin/closings/cl1/resolve', params: {}, data: { action: 'confirm', note: 'Acte reçu' } });
  });

  test('liste vide explicite et bouton « Lancer les tâches »', async () => {
    api.get.mockImplementation((url) => Promise.resolve({ data: url.startsWith('/admin/todo') ? { total: 0, sections: [] } : url.startsWith('/admin/companies') ? { companies: [] } : url.startsWith('/admin/users') ? [] : {} }));
    const c = await render(<AdminDashboard user={admin} setUser={jest.fn()} />);
    expect(c.querySelector('[data-testid="todo-empty"]').textContent).toMatch(/Rien à traiter/);
    expect(c.querySelector('[data-testid="todo-count"]')).toBeNull();
    expect(c.querySelector('[data-testid="admin-stats"]')).toBeNull();
    await click(c.querySelector('[data-testid="admin-run-jobs"]'));
    expect(api.post).toHaveBeenCalledWith('/admin/jobs/run');
  });

  test('?tab=users ouvre l\'onglet Utilisateurs avec les statuts libellés', async () => {
    const c = await render(<AdminDashboard user={admin} setUser={jest.fn()} />, '/admin/dashboard?tab=users');
    expect(c.querySelector('[data-testid="admin-users"]')).toBeTruthy();
    expect(c.textContent).toMatch(/Identité en repli/);
    expect(c.textContent).toMatch(/E-mail non confirmé/);
    expect(c.textContent).toMatch(/Profil repreneur complet à 70 %/);
    expect(c.textContent).toMatch(/Reprise individuelle/);
    expect(c.textContent).not.toMatch(/null null/);
    await click(c.querySelector('[data-testid="user-verify-u1"]'));
    await click(document.body.querySelector('[data-testid="verify-dialog-confirm"]'));
    expect(api.put).toHaveBeenCalledWith('/admin/kyc/u1/validate', null, { params: { status: 'verified' } });
  });
});

describe('AdminCompanies', () => {
  test('drapeaux libellés, vues réelles, retrait motivé, lien fiche', async () => {
    const onReload = jest.fn();
    const c = await render(<AdminCompanies companies={companies} loading={false} onReload={onReload} />);
    expect(c.textContent).toMatch(/12 vues/);
    expect(c.textContent).toMatch(/2 messages/);
    expect(c.textContent).not.toMatch(/0 favori/);
    expect(c.textContent).toMatch(/NAF hors bâtiment/);
    expect(c.textContent).toMatch(/RGE vérifié ADEME/);
    expect(c.textContent).toMatch(/Dirigeant confirmé/);
    expect(c.textContent).toMatch(/En ligne · relecture en cours/);
    expect(c.textContent).toMatch(/Retirée : Une annonce existe déjà/);
    expect(c.textContent).toMatch(/michel@exemple.fr/);
    expect(c.textContent).not.toMatch(/null/);
    expect(c.querySelector('[data-testid="company-link-c1"]').getAttribute('href')).toBe('/company/c1');
    await click(c.querySelector('[data-testid="company-remove-c1"]'));
    const dialog = document.body.querySelector('[data-testid="removal-dialog"]');
    setValue(dialog.querySelector('[data-testid="removal-reason"]'), 'doublon');
    await flush();
    await click(dialog.querySelector('[data-testid="removal-dialog-confirm"]'));
    expect(api.put).toHaveBeenCalledWith('/companies/c1/status', null, { params: { status: 'removed', reason: 'doublon', reason_text: '' } });
    expect(onReload).toHaveBeenCalled();
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
    expect(c.querySelector('[data-testid="kpi-table"]')).toBeTruthy();
    const row = c.querySelector('[data-testid="kpi-seller_response_48h_pct"]');
    expect(row.textContent).toMatch(/50 %/);
    expect(row.textContent).toMatch(/100 %/);
    expect(row.textContent).toMatch(/≥ 80 %/);
    expect(c.querySelector('[data-testid="kpi-off-target"]').textContent).toMatch(/2 indicateurs sous la cible/);
    expect(c.querySelector('[data-testid="kpi-contacts"]').textContent).toMatch(/▲/);
    expect(c.textContent).toMatch(/Facturé : 4\s000,00\s€ HT/);
    expect(c.textContent).toMatch(/suivi hors plateforme/);
    expect(c.querySelector('[data-testid="costs-list"]').textContent).toMatch(/octobre 2026/);
    setValue(c.querySelector('[data-testid="cost-amount"]'), '150');
    setValue(c.querySelector('[data-testid="cost-month"]'), '2026-11');
    await flush();
    await click(c.querySelector('[data-testid="cost-save"]'));
    expect(api.put).toHaveBeenCalledWith('/admin/costs', { month: '2026-11', amount: 150, note: undefined });
    expect(c.querySelector('[data-testid="events-by-name"]').textContent).toMatch(/Pages vues/);
    expect(c.querySelector('[data-testid="events-by-day"]').textContent).toMatch(/9 oct/);
    expect(c.querySelector('[data-testid="events-by-day"]').textContent).not.toMatch(/10 oct/);
  });

  test('indicateurs indisponibles : état vide explicite', async () => {
    api.get.mockImplementation((url) => (url.startsWith('/admin/kpis') ? Promise.reject({ response: { status: 404, data: { detail: 'Not Found' } } }) : Promise.resolve({ data: url.startsWith('/admin/costs') ? [] : { events: null } })));
    const c = await render(<AdminMetrics stats={{}} />);
    expect(c.querySelector('[data-testid="kpi-empty"]').textContent).toMatch(/pas encore disponibles/);
    expect(c.querySelector('[data-testid="events-empty"]')).toBeTruthy();
    expect(c.textContent).toMatch(/Aucune facture émise/);
  });
});
