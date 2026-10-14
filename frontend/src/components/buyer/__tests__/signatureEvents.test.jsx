// Non-régression (SPEC §6.2) : les signatures d'accord de confidentialité et d'offre indicative émettent
// les événements `nda_signed` et `offer_signed` de la liste fermée (lib/analytics.js ↔ backend/events.py).
// Exécution : cd frontend && CI=true npx craco test --watchAll=false src/components/buyer/__tests__/signatureEvents.test.jsx
import '@/components/shared/jestEnv';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

jest.mock('@/App', () => ({ axiosInstance: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() }, API: '/api', EMAIL_NOT_VERIFIED_EVENT: 'cession:email-not-verified' }));
jest.mock('@radix-ui/primitive/is-development', () => jest.requireActual('@radix-ui/primitive/dist/internal/is-development.false.js'), { virtual: true });
jest.mock('@/lib/analytics', () => ({ trackEvent: jest.fn(), trackPageView: jest.fn(), initAnalytics: jest.fn() }));
jest.mock('@/components/SecurePdfViewer', () => () => null);
// Boîte de signature réduite à un bouton qui appelle onSign avec un code
jest.mock('@/components/OtpSignatureDialog', () => function OtpSignatureDialogStub({ open, onSign }) {
  return open === false ? null : <button type="button" data-testid="stub-sign" onClick={() => onSign('123456')}>Signer</button>;
});

import { axiosInstance as api } from '@/App';
import { trackEvent } from '@/lib/analytics';
import DataroomPage from '@/pages/DataroomPage';
import { OfferSignatureDialog } from '@/components/buyer/OfferForm';

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
    root.render(<MemoryRouter initialEntries={[path]}><Routes><Route path={routePath} element={ui} /></Routes></MemoryRouter>);
  });
  await flush();
  await flush();
  mounted.push({ root, container });
  return container;
};
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); await flush(); };

afterEach(() => {
  mounted.splice(0).forEach(({ root, container }) => { act(() => root.unmount()); container.remove(); });
  jest.clearAllMocks();
});

const buyer = { id: 'b1', role: 'buyer', first_name: 'Claire', last_name: 'Martin', email: 'claire@exemple.fr', email_verified: true, identity_verified: true };
const company = { id: 'c1', status: 'published', title: 'Entreprise de plomberie-chauffage · Bretagne', trades: ['plomberie-chauffage'], region: 'Bretagne', asking_price: 290000 };

test('les deux événements font partie de la liste fermée', () => {
  const { EVENT_NAMES } = jest.requireActual('@/lib/analytics');
  expect(EVENT_NAMES).toEqual(expect.arrayContaining(['nda_signed', 'offer_signed']));
});

test('signature de l\'accord de confidentialité → trackEvent(nda_signed)', async () => {
  const routes = {
    '/companies/c1': company,
    '/kyc/status': { verified: true },
    '/offers/my': { offers: [] },
    '/dataroom/c1/access-status': { access_granted: false, access_status: 'accepted', steps: { identity: true, nda: false, funds: false }, next_step: 'nda', request: { id: 'r1' } },
  };
  api.get.mockImplementation((url) => {
    const key = Object.keys(routes).filter((k) => url === k || url.startsWith(k)).sort((a, b) => b.length - a.length)[0];
    return key ? Promise.resolve({ data: routes[key] }) : Promise.resolve({ data: {} });
  });
  api.post.mockImplementation((url) => Promise.resolve({ data: url === '/contracts/generate-for-signature'
    ? { contract_id: 'nda1', contract_number: 'NDA-1', content: 'ACCORD', terms_date: '10/10/2026' }
    : { signed: true } }));
  const c = await render(<DataroomPage user={buyer} />, '/dataroom/c1', '/dataroom/:companyId');
  await click(c.querySelector('[data-testid="nda-btn"]'));
  expect(trackEvent).not.toHaveBeenCalledWith('nda_signed', expect.anything());
  await click(document.querySelector('[data-testid="stub-sign"]'));
  expect(api.post).toHaveBeenCalledWith('/contracts/nda1/sign', { otp_code: '123456' });
  expect(trackEvent).toHaveBeenCalledWith('nda_signed', { listing: 'c1' });
});

test('signature de l\'offre indicative → trackEvent(offer_signed), pas d\'événement si la signature échoue', async () => {
  api.post.mockResolvedValueOnce({ data: { status: 'pending' } });
  const onSigned = jest.fn();
  await render(<OfferSignatureDialog open offer={{ id: 'o1', company_id: 'c1', amount: 290000 }} contractId="ctr1" documentText="OFFRE" onSigned={onSigned} onClose={() => {}} />);
  await click(document.querySelector('[data-testid="stub-sign"]'));
  expect(api.post).toHaveBeenCalledWith('/contracts/ctr1/sign', { otp_code: '123456' });
  expect(trackEvent).toHaveBeenCalledWith('offer_signed', { listing: 'c1' });
  expect(onSigned).toHaveBeenCalled();

  trackEvent.mockClear();
  api.post.mockRejectedValueOnce(new Error('code invalide'));
  const dialog = OfferSignatureDialog({ open: true, offer: { company_id: 'c1' }, contractId: 'ctr2', documentText: 'OFFRE' });
  await expect(dialog.props.onSign('000000')).rejects.toThrow('code invalide');
  expect(trackEvent).not.toHaveBeenCalled();
});
