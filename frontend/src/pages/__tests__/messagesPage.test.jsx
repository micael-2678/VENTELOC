// Messagerie (API.md §3) : liste des conversations, carte acquéreur côté vendeur, bandeau de révélation après
// l'engagement de confidentialité, marquage « lu », envoi d'un message, état vide.
// Exécution : cd frontend && CI=true npx craco test --watchAll=false src/pages/__tests__/messagesPage.test.jsx
import '@/components/shared/jestEnv';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

jest.mock('@/App', () => ({ axiosInstance: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() }, API: '/api', EMAIL_NOT_VERIFIED_EVENT: 'venteloc:email-not-verified' }));
jest.mock('@radix-ui/primitive/is-development', () => jest.requireActual('@radix-ui/primitive/dist/internal/is-development.false.js'), { virtual: true });
jest.mock('@/lib/analytics', () => ({ trackEvent: jest.fn(), trackPageView: jest.fn(), initAnalytics: jest.fn() }));

import { axiosInstance as api } from '@/App';
import MessagesPage from '@/pages/MessagesPage';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.scrollTo = jest.fn();
Element.prototype.scrollIntoView = jest.fn();

const mounted = [];
const flush = async () => { await act(async () => { await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); }); };
const render = async (ui, path = '/messages') => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/messages" element={ui} /></Routes></MemoryRouter>);
  });
  await flush();
  await flush();
  mounted.push({ root, container });
  return container;
};
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); await flush(); };
const setValue = (el, value) => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, value);
  act(() => { el.dispatchEvent(new Event('input', { bubbles: true })); });
};

afterEach(() => {
  mounted.splice(0).forEach(({ root, container }) => { act(() => root.unmount()); container.remove(); });
  jest.clearAllMocks();
});

const seller = { id: 's1', role: 'seller', first_name: 'Michel', email_verified: true };
const buyer = { id: 'b1', role: 'buyer', first_name: 'Claire', email_verified: true };

const conversation = {
  id: 'conv1', property_id: 'p1', property_title: 'Appartement T2 loué · 42 m² · Lyon (69)', buyer_id: 'b1', seller_id: 's1',
  other_party_label: 'Acquéreur n°123456', last_message: 'Bonjour, le bail est-il récent ?', last_at: '2026-10-12T09:00:00Z',
  unread_count: 2, identity_revealed: false, access_status: 'pending',
  buyer_card: { label: 'Acquéreur n°123456', project_type: 'particulier', budget_max: 200000, financing: 'mixte', property_types: ['appartement'], min_yield: 5, profile_score: 80 },
};
const thread = [
  { id: 'm2', conversation_id: 'conv1', sender_id: 'b1', sender_label: 'Acquéreur n°123456', content: 'Bonjour, le bail est-il récent ?', created_at: '2026-10-12T09:00:00Z' },
  { id: 'm1', conversation_id: 'conv1', sender_id: 'system', content: 'Demande de dossier envoyée au vendeur.', created_at: '2026-10-12T08:59:00Z' },
];

const mockApi = (conversations = [conversation], messages = thread) => {
  api.get.mockImplementation((url) => {
    if (url === '/messages/conversations') return Promise.resolve({ data: conversations });
    if (url === '/messages') return Promise.resolve({ data: messages });
    return Promise.resolve({ data: {} });
  });
  api.put.mockResolvedValue({ data: { ok: true } });
};

describe('MessagesPage', () => {
  test('vendeur : conversation ouverte, carte acquéreur dépliée, messages triés, marquée lue', async () => {
    mockApi();
    const c = await render(<MessagesPage user={seller} />);
    expect(c.querySelector('[data-testid="conversation-conv1"]').textContent).toMatch(/Acquéreur n°123456/);
    expect(api.get).toHaveBeenCalledWith('/messages', { params: { conversation_id: 'conv1' } });
    expect(api.put).toHaveBeenCalledWith('/messages/conversations/conv1/read');
    // Fil trié par date : le message système (plus ancien) d'abord
    const thr = c.querySelector('[data-testid="thread"]');
    expect(thr.querySelector('[data-testid="system-message"]').textContent).toMatch(/Demande de dossier/);
    expect(thr.textContent.indexOf('Demande de dossier')).toBeLessThan(thr.textContent.indexOf('le bail est-il récent'));
    // Carte acquéreur dépliée à la première ouverture, repliable
    const toggle = c.querySelector('[data-testid="toggle-buyer-card"]');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // Avant l'engagement : identités et adresse masquées
    expect(c.querySelector('[data-testid="identity-banner"]').textContent).toMatch(/révélées après l'engagement de confidentialité/);
    // Pastille non lus remise à zéro
    expect(c.querySelector('[data-testid="conversation-conv1"] [aria-label$="non lus"]')).toBeNull();
  });

  test('acquéreur : titre du bien, lien vers le dossier, identités révélées après engagement', async () => {
    mockApi([{ ...conversation, unread_count: 0, identity_revealed: true, access_status: 'granted', other_party_label: 'Michel Dupont', buyer_card: undefined }]);
    const c = await render(<MessagesPage user={buyer} />);
    expect(c.textContent).toMatch(/Appartement T2 loué/);
    expect(c.querySelector('a[href="/dataroom/p1"]')).toBeTruthy();
    expect(c.querySelector('a[href="/annonce/p1"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="toggle-buyer-card"]')).toBeNull();
    expect(c.querySelector('[data-testid="identity-banner"]').textContent).toMatch(/identités révélées/);
    expect(api.put).not.toHaveBeenCalled();
  });

  test('envoi : POST /messages avec la conversation, champ vidé, liste rechargée', async () => {
    const messages = [...thread];
    mockApi([conversation], messages);
    const sent = { id: 'm3', conversation_id: 'conv1', sender_id: 's1', content: 'Oui, signé en septembre 2023.', created_at: '2026-10-12T10:00:00Z' };
    // Le serveur enregistre le message : les lectures suivantes du fil le contiennent
    api.post.mockImplementation(() => { messages.push(sent); return Promise.resolve({ data: sent }); });
    const c = await render(<MessagesPage user={seller} />);
    const listCalls = () => api.get.mock.calls.filter(([url]) => url === '/messages/conversations').length;
    const before = listCalls();
    const input = c.querySelector('[data-testid="message-input"]');
    setValue(input, '  Oui, signé en septembre 2023.  ');
    await flush();
    await act(async () => { c.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await flush();
    expect(api.post).toHaveBeenCalledWith('/messages', { conversation_id: 'conv1', content: 'Oui, signé en septembre 2023.' });
    expect(c.querySelector('[data-testid="message-input"]').value).toBe('');
    expect(c.querySelector('[data-testid="thread"]').textContent).toMatch(/signé en septembre 2023/);
    expect(listCalls()).toBeGreaterThan(before);
  });

  test('aucune conversation : état vide adapté au rôle', async () => {
    mockApi([]);
    const c = await render(<MessagesPage user={buyer} />);
    expect(c.querySelector('[data-testid="no-conversations"]').textContent).toMatch(/Présentez votre projet au vendeur/);
    expect(c.querySelector('a[href="/"]')).toBeTruthy();
  });
});
