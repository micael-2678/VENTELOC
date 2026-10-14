// Intégration de la vague 3 : étape de vente (déclaration du repreneur jamais confirmée automatiquement, vente
// contestée, rédacteur après confirmation), encaissement partiel, correction de déclaration, diagnostic RGE
// « déclaré », liste à choix multiples sans « filtre », téléphone international, pied de page légal.
// Exécution : cd frontend && CI=true npx craco test --watchAll=false src/components/__tests__/vague3.test.jsx
import '@/components/shared/jestEnv';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

jest.mock('@/App', () => ({ axiosInstance: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() }, API: '/api', EMAIL_NOT_VERIFIED_EVENT: 'cession:email-not-verified' }));
jest.mock('@radix-ui/primitive/is-development', () => jest.requireActual('@radix-ui/primitive/dist/internal/is-development.false.js'), { virtual: true });
jest.mock('@/lib/analytics', () => ({ trackEvent: jest.fn(), trackPageView: jest.fn(), initAnalytics: jest.fn() }));

import { axiosInstance as api } from '@/App';
import ClosingPanel, { closingSentence, autoConfirms } from '@/components/closing/ClosingPanel';
import { PaidDialog, invoiceBalance } from '@/components/admin/shared';
import { CorrectDeclarationDialog } from '@/components/admin/AdminClosings';
import TransmissibilityPanel, { qualificationStatus, levelTone } from '@/components/buyer/TransmissibilityPanel';
import MultiSelectList from '@/components/MultiSelectList';
import { PHONE_RE } from '@/pages/RegisterPage';
import { footerLegalLines as legalFooterLines } from '@/seo/legal';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.scrollTo = jest.fn();
Element.prototype.scrollIntoView = jest.fn();
if (typeof window.ResizeObserver === 'undefined') {
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

const mounted = [];
const flush = async () => { await act(async () => { await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); }); };
const render = async (ui) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter>{ui}</MemoryRouter>); });
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

afterEach(() => {
  while (mounted.length) {
    const { root, container } = mounted.pop();
    act(() => root.unmount());
    container.remove();
  }
  document.body.innerHTML = '';
  jest.clearAllMocks();
});

const seller = { id: 's1', role: 'seller' };
const buyer = { id: 'b1', role: 'buyer' };
const base = {
  id: 'cl1', company_id: 'c1', company_title: 'Plomberie · Bretagne', seller_id: 's1', buyer_id: 'b1', offer_id: 'o1', offer_amount: 280000,
  sale_object: 'titres', redacteur: null, status: 'in_progress', declaration: null, invoice: null,
};
const buyerDeclaration = { declared_by: 'buyer', signed_on: '2026-10-09', final_price: 275000, sale_object: 'titres', confirm_deadline: '2026-10-16T10:00:00Z' };

describe('Étape de vente', () => {
  test('déclaration du repreneur : jamais « confirmée automatiquement »', async () => {
    const declared = { ...base, status: 'declared', declaration: buyerDeclaration };
    expect(autoConfirms(buyerDeclaration)).toBe(false);
    expect(closingSentence(declared, 'buyer')).not.toMatch(/automatiquement/);
    expect(closingSentence(declared, 'buyer')).toMatch(/accord du cédant/);
    expect(closingSentence(declared, 'seller')).not.toMatch(/automatiquement/);
    const c = await render(<ClosingPanel closing={{ ...declared, role: 'seller' }} user={seller} onChange={jest.fn()} />);
    expect(c.querySelector('[data-testid="confirm-deadline"]').textContent).toMatch(/qu'avec votre accord/);
    expect(c.textContent).not.toMatch(/confirmée automatiquement/);
    // Déclaration du cédant : la confirmation automatique reste annoncée
    expect(closingSentence({ ...declared, declaration: { ...buyerDeclaration, declared_by: 'seller' } }, 'buyer')).toMatch(/automatiquement/);
  });

  test('vente contestée : seule la partie qui a contesté peut déclarer sa version', async () => {
    const disputed = { ...base, status: 'disputed', declaration: buyerDeclaration, dispute: { by: 'seller', reason: 'Prix inexact' } };
    const s = await render(<ClosingPanel closing={{ ...disputed, role: 'seller' }} user={seller} onChange={jest.fn()} />);
    expect(s.querySelector('[data-testid="declare-form"]')).not.toBeNull();
    const b = await render(<ClosingPanel closing={{ ...disputed, role: 'buyer' }} user={buyer} onChange={jest.fn()} />);
    expect(b.querySelector('[data-testid="declare-form"]')).toBeNull();
  });

  test('vente confirmée : le cédant peut encore renseigner le rédacteur tant que l\'ordre de paiement n\'est pas parti', async () => {
    const confirmed = { ...base, status: 'confirmed', declaration: { ...buyerDeclaration, declared_by: 'seller' }, redacteur: { type: 'notaire', name: 'Étude Le Gall', email: 'etude@notaires.fr', set_by: 'buyer' } };
    const s = await render(<ClosingPanel closing={{ ...confirmed, role: 'seller' }} user={seller} onChange={jest.fn()} />);
    expect(s.querySelector('[data-testid="redacteur-edit"]')).not.toBeNull();
    expect(s.querySelector('[data-testid="redacteur-to-confirm"]')).not.toBeNull();
    const sent = await render(<ClosingPanel closing={{ ...confirmed, role: 'seller', payment_order_sent_at: '2026-10-17T10:00:00Z' }} user={seller} onChange={jest.fn()} />);
    expect(sent.querySelector('[data-testid="redacteur-edit"]')).toBeNull();
    const b = await render(<ClosingPanel closing={{ ...confirmed, role: 'buyer' }} user={buyer} onChange={jest.fn()} />);
    expect(b.querySelector('[data-testid="redacteur-edit"]')).toBeNull();
    expect(b.querySelector('[data-testid="redacteur-to-confirm"]')).toBeNull();
  });
});

describe('Administration : factures et ventes', () => {
  test('encaissement : prérempli avec le reste dû et historique des acomptes', async () => {
    const invoice = { id: 'i1', number: 'FAC-2026-00001', total_ttc: 4800, paid_amount: 1000, balance_due: 3800, payments: [{ paid_on: '2026-10-01', amount: 1000 }] };
    expect(invoiceBalance(invoice)).toBe(3800);
    expect(invoiceBalance({ total_ttc: 4800 })).toBe(4800);
    const onConfirm = jest.fn().mockResolvedValue();
    await render(<PaidDialog open invoice={invoice} onClose={() => {}} onConfirm={onConfirm} />);
    const dialog = document.body.querySelector('[data-testid="paid-dialog"]');
    expect(dialog.querySelector('[data-testid="paid-amount"]').value).toBe('3800');
    expect(dialog.querySelector('[data-testid="paid-history"]').textContent).toMatch(/1\s?000/);
    await click(dialog.querySelector('[data-testid="paid-dialog-confirm"]'));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ amount: 3800 }));
  });

  test('correction de la déclaration après avoir : date, prix, objet envoyés', async () => {
    const onConfirm = jest.fn().mockResolvedValue();
    const closing = { id: 'cl1', status: 'confirmed', declaration: { signed_on: '2026-10-01', final_price: 200000, sale_object: 'titres' } };
    await render(<CorrectDeclarationDialog open closing={closing} onClose={() => {}} onConfirm={onConfirm} />);
    const dialog = document.body.querySelector('[data-testid="correct-declaration-dialog"]');
    setValue(dialog.querySelector('[data-testid="correct-price"]'), '210000');
    await flush();
    await click(dialog.querySelector('[data-testid="correct-declaration-dialog-confirm"]'));
    expect(onConfirm).toHaveBeenCalledWith({ signed_on: '2026-10-01', final_price: 210000, sale_object: 'titres', note: null });
    expect(api.put).not.toHaveBeenCalled();
  });
});

describe('Diagnostic de transmissibilité', () => {
  test('qualification seulement déclarée : pas de vert, diagnostic en ambre', async () => {
    expect(qualificationStatus({ status: 'valide' }, false)).toEqual({ label: 'Déclarée, en cours de validité', tone: 'declared' });
    expect(qualificationStatus({ status: 'valide' }, true).tone).toBe('verified');
    expect(levelTone('elevee', false)).toMatch(/amber/);
    expect(levelTone('elevee', true)).toMatch(/green/);
    const diag = { source: 'declared', level: { value: 'elevee', label: 'Transmissibilité élevée' }, qualifications: [{ name: 'QualiPAC', status: 'valide', date_fin: '2028-01-01' }],
      transfer: { titres: { label: 'Cession de titres', summary: 'Les qualifications restent attachées à la société.' } }, referent: { label: 'Référent technique RGE', text: 'À confirmer.' } };
    const c = await render(<TransmissibilityPanel diagnostic={diag} ademe={{ found: false, message: 'SIRET non trouvé' }} />);
    expect(c.querySelector('[data-testid="qualification-badge"]').className).toContain('badge-declared');
    const details = c.querySelector('[data-testid="transfer-details"]');
    expect(details.tagName).toBe('DETAILS');
    expect(details.open).toBe(false);
    expect(details.textContent).toContain('Référent technique RGE');
  });
});

describe('Formulaires et mentions', () => {
  test('liste à choix multiples : aucune mention de filtre dans un formulaire', async () => {
    const c = await render(<MultiSelectList options={[{ value: 'a', label: 'A' }]} selected={[]} onChange={() => {}} />);
    expect(c.textContent).not.toMatch(/filtre/i);
  });

  test('téléphone : France, Belgique, Suisse, Luxembourg', () => {
    ['06 12 34 56 78', '+33 6 12 34 56 78', '+32 470 12 34 56', '+41 79 123 45 67', '+352 621 123 456'].forEach((n) => expect(PHONE_RE.test(n)).toBe(true));
    ['12345', '+44 20 7946 0958'].forEach((n) => expect(PHONE_RE.test(n)).toBe(false));
  });

  test('pied de page : mêmes lignes que le pré-rendu (capital, sans personne physique)', () => {
    const lines = legalFooterLines({ denomination: 'AlterEgo', forme_juridique: 'Société par actions simplifiée', capital: '2000', adresse: '43 rue Massenet, 78500 Sartrouville', rcs_ville: 'Versailles', siren: '952180230', carte_t: 'CPI 7801', representant: 'Romane DA SILVA RIBEIRO' });
    expect(lines[0]).toMatch(/capital 2\s?000/);
    expect(lines.join(' ')).not.toMatch(/Romane/);
  });
});
