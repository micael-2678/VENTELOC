// Tests des composants partagés, du barème (lib/offer.js), des statistiques maison (lib/analytics.js) et de
// l'ErrorBoundary. Exécution : cd frontend && CI=true npx craco test --watchAll=false
import '../jestEnv';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { COMMISSION, OFFER, computeCommission, commissionRows, formatEuros, rateLabel, fillOffer } from '@/lib/offer';
import { sanitizeProps, trackEvent, trackPageView, EVENT_NAMES } from '@/lib/analytics';
import ErrorBoundary from '@/components/ErrorBoundary';
import {
  ListingCard, listingTitle, qualificationBadge, listingLocation, priceToEbitda, BuyerCard, AlertForm, Checklist, formatPrice, formatMagnitude, formatCompactEuros,
  relativeDateFr, deActivity,
} from '@/components/shared';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted = [];
const render = (ui) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  mounted.push({ root, container });
  return container;
};
const withRouter = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);
const setInput = (el, value) => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
};
const bodyOf = (call) => JSON.parse(call[1].body);
const okResponse = (data = {}) => Promise.resolve({ ok: true, status: 200, json: async () => data });

beforeEach(() => {
  global.fetch = jest.fn(() => okResponse());
});

afterEach(() => {
  mounted.splice(0).forEach(({ root, container }) => {
    act(() => root.unmount());
    container.remove();
  });
});

// ------------------------------------------------------------------------------------------------
describe('lib/offer.js — barème 6 % / 3 % > 1 M€ / minimum 4 000 € HT', () => {
  test('montants identiques à business_model.calculate_commission', () => {
    expect(computeCommission(180000)).toMatchObject({ ht: 10800, vat: 2160, ttc: 12960, appliedMinimum: false, ratePercent: 6, payer: 'cedant' });
    expect(computeCommission(2000000)).toMatchObject({ ht: 90000, ttc: 108000, ratePercent: 4.5, ratePercentLabel: '4,5 %' });
    expect(computeCommission(50000)).toMatchObject({ ht: 4000, ttc: 4800, appliedMinimum: true, ratePercent: 8 });
    expect(computeCommission(123456.78).ht).toBe(7407.41);
    expect(computeCommission('abc').ht).toBe(COMMISSION.minimumHT);
    expect(computeCommission(1500000).breakdown).toHaveLength(2);
  });

  test('affichage HT d\'abord, textes sans jargon ni ancien barème', () => {
    expect(formatEuros(10800)).toBe('10 800 €');
    expect(rateLabel(0.06)).toBe('6 % HT (7,2 % TTC)');
    expect(commissionRows().map((r) => r.rateHT)).toEqual(['6 % HT', '3 % HT']);
    const all = JSON.stringify(OFFER);
    ['Lehman', 'tranches successives', '12 % TTC', '10 % HT', 'acquéreur', 'CessionRGE', 'à compléter'].forEach((bad) => {
      expect(all).not.toContain(bad);
    });
    expect(OFFER.commissionSentence).toMatch(/^6 % HT du prix de cession \(3 % HT sur la part au-delà d'un million d'euros\), minimum 4 000 € HT/);
    expect(fillOffer('{{trustTitle}} / {{inconnu}}')).toBe(`${OFFER.trustTitle} / {{inconnu}}`);
  });
});

// ------------------------------------------------------------------------------------------------
describe('lib/analytics.js — événements maison sans cookie', () => {
  test('sanitizeProps : clés simples, valeurs scalaires, 10 au plus', () => {
    const props = { 'Source-Page': 'fiche', nested: { a: 1 }, n: 3, ok: true, nul: null, undef: undefined, long: 'x'.repeat(600) };
    for (let i = 0; i < 12; i += 1) props[`k${i}`] = i;
    const out = sanitizeProps(props);
    expect(out.source_page).toBe('fiche');
    expect(out.nested).toBe('{"a":1}');
    expect(out.n).toBe(3);
    expect(out.ok).toBe(true);
    expect(out.nul).toBeNull();
    expect(out).not.toHaveProperty('undef');
    expect(out.long).toHaveLength(500);
    expect(Object.keys(out).length).toBeLessThanOrEqual(10);
  });

  test('trackEvent : anciens libellés traduits, noms inconnus ignorés, fetch keepalive sans cookie', () => {
    expect(trackEvent('Premier contact', { source: 'fiche' })).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url.endsWith('/api/events')).toBe(true);
    expect(init).toMatchObject({ method: 'POST', keepalive: true, credentials: 'omit' });
    expect(bodyOf(global.fetch.mock.calls[0])).toEqual({ name: 'contact_sent', path: '/', props: { source: 'fiche' } });
    expect(trackEvent('Mandat signé')).toBe(false);
    expect(trackEvent('calc_used', { price: 1 })).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(EVENT_NAMES).toContain('front_error');
  });

  test('trackPageView : dédoublonnage du même chemin', () => {
    expect(trackPageView('/vendre-mon-entreprise-batiment')).toBe(true);
    expect(trackPageView('/vendre-mon-entreprise-batiment')).toBe(false);
    expect(trackPageView('/estimer')).toBe(true);
    expect(bodyOf(global.fetch.mock.calls[1])).toMatchObject({ name: 'page_view', path: '/estimer' });
  });
});

// ------------------------------------------------------------------------------------------------
describe('ErrorBoundary', () => {
  test('page d\'erreur en français + événement front_error', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const Boom = () => { throw new Error('Explosion de test'); };
    const c = render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(c.textContent).toContain('Cette page n\'a pas pu s\'afficher');
    expect(c.querySelector('button').textContent).toContain('Recharger la page');
    expect(c.querySelector('a[href="/"]')).not.toBeNull();
    const sent = global.fetch.mock.calls.map(bodyOf).find((b) => b.name === 'front_error');
    expect(sent.props.message).toBe('Explosion de test');
    spy.mockRestore();
  });
});

// ------------------------------------------------------------------------------------------------
const property = {
  id: 'abc123',
  trades: ['pac-clim-cvc', 'plomberie-chauffage', 'electricite'],
  rge_types: ['Pompes à chaleur air/eau'],
  region: 'Bretagne',
  department: '29',
  staff_count: 9,
  ca_n: 1148000,
  asking_price: 420000,
  created_at: '2026-10-03T10:00:00Z',
  is_rge: true,
  property_checks: { in_ademe_list: true },
};

describe('ListingCard', () => {
  test('titre généré, badge vert, prix fr-FR, lien et événement', () => {
    expect(listingTitle(property)).toBe('Entreprise de PAC, climatisation · Bretagne · 9 salariés');
    expect(listingTitle({ title: 'Titre serveur' })).toBe('Titre serveur');
    expect(qualificationBadge(property)).toEqual({ kind: 'verified', label: 'RGE vérifié ADEME' });
    // Trois libellés distincts : RGE vérifié (vert), RGE déclaré (gris), autres qualifications nommées (gris)
    expect(qualificationBadge({ rge_types: ['x'], property_checks: { in_ademe_list: false } })).toEqual({ kind: 'declared', label: 'RGE déclaré' });
    expect(qualificationBadge({ is_rge: true })).toEqual({ kind: 'declared', label: 'RGE déclaré' });
    expect(qualificationBadge({ other_qualifications: ['qualibat'] })).toEqual({ kind: 'declared', label: 'Qualibat déclaré' });
    expect(qualificationBadge({ other_qualifications: ['qualifelec', 'irve'] }).label).toBe('Qualifelec, IRVE déclarés');
    expect(qualificationBadge({ other_qualifications: ['qualibat', 'qualifelec', 'irve'] }).label).toBe('Qualibat, Qualifelec +1 déclarés');
    expect(qualificationBadge({})).toBeNull();

    const c = withRouter(<ListingCard property={property} source="test" now={new Date('2026-10-10T12:00:00')} />);
    const card = c.querySelector('[data-testid="listing-card"]');
    expect(card.tagName).toBe('ARTICLE');
    expect(card.className).toContain('min-w-0');
    const link = c.querySelector('a[data-testid="listing-card-link"]');
    expect(link.getAttribute('href')).toBe('/property/abc123');
    expect(link.textContent).toBe('Entreprise de PAC, climatisation · Bretagne · 9 salariés');
    expect(c.querySelector('[data-testid="listing-card-badge"]').className).toContain('badge-verified');
    expect(c.textContent).toContain('Finistère (29)');
    expect(c.textContent).toContain('9 salariés');
    expect(c.querySelector('[data-testid="listing-card-price"]').textContent).toBe(formatPrice(420000));
    expect(c.textContent).toContain(formatCompactEuros(1148000));
    expect(c.querySelector('time').getAttribute('dateTime')).toBe(property.created_at);
    expect(c.querySelector('time').textContent).toBe('il y a 1 semaine');
    expect(c.querySelectorAll('ul[aria-label="Métiers"] li')).toHaveLength(3);
    // Sans gestionnaire de favori : pas de cœur (aperçu du cédant, favoris du tableau de bord)
    expect(c.querySelector('[data-testid="favorite-toggle"]')).toBeNull();
    act(() => link.click());
    expect(bodyOf(global.fetch.mock.calls[0])).toMatchObject({ name: 'listing_card_click', props: { listing: 'abc123', source: 'test' } });
  });

  test('lisibilité : séparateur de milliers visible, département sans région répétée, multiple prix/EBE', () => {
    // Espace insécable normale (U+00A0), jamais l'espace fine (U+202F) presque invisible en gras
    expect(formatPrice(520000)).toBe('520\u00a0000\u00a0€');
    expect(formatPrice(1400000)).toBe('1\u00a0400\u00a0000\u00a0€');
    expect(formatPrice(520000)).not.toContain('\u202f');
    expect(listingLocation(property)).toBe('Finistère (29)');
    expect(listingLocation({ region: 'Bretagne', title: 'Entreprise de plomberie · Bretagne' })).toBe('');
    expect(listingLocation({ region: 'Bretagne', title: 'Entreprise de plomberie' })).toBe('Bretagne');
    expect(priceToEbitda({ asking_price: 520000, ebitda: 185000 })).toBe('2,8\u00a0×');
    expect(priceToEbitda({ asking_price: 520000, ebitda: 0 })).toBe('');
    const withEbitda = withRouter(<ListingCard property={{ ...property, ebitda: 150000 }} />);
    expect(withEbitda.textContent).toContain('Prix/EBE');
    expect(withEbitda.textContent).toContain('2,8\u00a0×');
    expect(withEbitda.textContent).not.toContain('Bretagne · Finistère');
    const noEbitda = withRouter(<ListingCard property={property} />);
    expect(noEbitda.textContent).toContain('Effectif');
    expect(noEbitda.textContent).not.toContain('Prix/EBE');
  });

  test('liens marqués (module WordPress) : linkQuery ajouté à l\'adresse de la fiche', () => {
    const c = withRouter(<ListingCard property={property} linkQuery="utm_source=wordpress&utm_medium=embed" />);
    expect(c.querySelector('a[data-testid="listing-card-link"]').getAttribute('href')).toBe('/property/abc123?utm_source=wordpress&utm_medium=embed');
  });

  test('mode test : badge « Annonce de test » seulement pour une annonce is_test', () => {
    const real = withRouter(<ListingCard property={property} />);
    expect(real.querySelector('[data-testid="listing-card-test"]')).toBeNull();
    const fake = withRouter(<ListingCard property={{ ...property, is_test: true }} />);
    expect(fake.querySelector('[data-testid="listing-card-test"]').textContent).toBe('Annonce de test');
  });

  test('favori : bouton distinct du lien, état pressé, EBE affiché s\'il est renseigné', () => {
    const onToggle = jest.fn();
    const c = withRouter(<ListingCard property={{ ...property, ebitda: 140000 }} favorite onToggleFavorite={onToggle} />);
    const heart = c.querySelector('[data-testid="favorite-toggle"]');
    expect(heart.tagName).toBe('BUTTON');
    expect(heart.closest('a')).toBeNull();
    expect(heart.getAttribute('aria-pressed')).toBe('true');
    expect(heart.getAttribute('aria-label')).toContain('Retirer des favoris');
    act(() => heart.click());
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: 'abc123' }));
    expect(c.textContent).toContain('EBE');
    expect(c.textContent).toContain(formatCompactEuros(140000));
  });

  test('formats courts et dates relatives', () => {
    const now = new Date('2026-10-10T12:00:00');
    expect(formatCompactEuros(1148000)).toBe('1,15\u00a0M€');
    expect(formatCompactEuros(780000)).toBe('780\u00a0k€');
    expect(formatCompactEuros(null)).toBe('—');
    expect(relativeDateFr('2026-10-10T08:00:00', now)).toBe('aujourd\'hui');
    expect(relativeDateFr('2026-10-09T08:00:00', now)).toBe('hier');
    expect(relativeDateFr('2026-10-07T08:00:00', now)).toBe('il y a 3 jours');
    expect(relativeDateFr('2026-09-24T08:00:00', now)).toBe('il y a 2 semaines');
    expect(relativeDateFr('2026-08-01T08:00:00', now)).toBe('1 août 2026');
    expect(relativeDateFr('pas une date', now)).toBe('');
  });

  test('ancienne annonce (commission acquéreur) et formats', () => {
    const c = withRouter(<ListingCard property={{ ...property, trades: [], commission_payer: 'repreneur' }} />);
    expect(c.textContent).toContain('Commission à la charge de l\'acquéreur');
    expect(deActivity('isolation')).toBe('d\'isolation');
    expect(deActivity('Plomberie-chauffage')).toBe('de plomberie-chauffage');
    expect(formatPrice(null)).toBe('—');
    expect(formatMagnitude(87500)).toBe(`≈ ${formatPrice(88000)}`);
  });
});

// ------------------------------------------------------------------------------------------------
describe('AlertForm — alerte sans compte', () => {
  test('e-mail invalide refusé, puis POST /alerts/public et état « vérifiez votre boîte mail »', async () => {
    const onCreated = jest.fn();
    const c = render(<AlertForm source="test" defaultTrades={['isolation']} onCreated={onCreated} />);
    const form = c.querySelector('form');
    const email = c.querySelector('input[type="email"]');
    act(() => setInput(email, 'pas-un-email'));
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(c.querySelector('[role="alert"]').textContent).toContain('adresse e-mail valide');
    expect(global.fetch).not.toHaveBeenCalled();

    act(() => setInput(email, 'Jean@Exemple.fr'));
    const bretagne = Array.from(c.querySelectorAll('input[name="regions"]')).find((i) => i.value === 'Bretagne');
    act(() => bretagne.click());
    act(() => setInput(c.querySelector('select[name="max_price"]'), '300000'));
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });

    const post = global.fetch.mock.calls.find(([url]) => url.endsWith('/api/alerts/public'));
    expect(post[1].method).toBe('POST');
    expect(bodyOf(post)).toEqual({ email: 'jean@exemple.fr', trades: ['isolation'], regions: ['Bretagne'], max_price: 300000 });
    expect(c.querySelector('[data-testid="alert-form-success"]').textContent).toContain('Vérifiez votre boîte mail');
    expect(onCreated).toHaveBeenCalledTimes(1);
    const created = global.fetch.mock.calls.map(bodyOf).find((b) => b.name === 'alert_created');
    expect(created.props).toMatchObject({ source: 'test', trades: 1, regions: 1, max_price: 300000 });
  });

  test('erreur serveur affichée (429)', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 429, json: async () => ({ detail: 'x' }) }));
    const c = render(<AlertForm />);
    act(() => setInput(c.querySelector('input[type="email"]'), 'a@b.fr'));
    await act(async () => { c.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(c.querySelector('[role="alert"]').textContent).toContain('Réessayez dans une minute');
    expect(c.querySelector('form')).not.toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------
describe('Checklist et BuyerCard', () => {
  test('Checklist : étape courante marquée aria-current', () => {
    const c = render(<Checklist title="Avant les documents" items={[
      { id: 'id', label: 'Identité vérifiée', state: 'done' },
      { id: 'nda', label: 'Accord de confidentialité signé', state: 'current', action: <button type="button">Signer</button> },
      { id: 'fonds', label: 'Origine des fonds déclarée', state: 'todo' },
    ]} />);
    const current = c.querySelector('li[aria-current="step"]');
    expect(current.textContent).toContain('Accord de confidentialité signé');
    expect(current.querySelector('button').textContent).toBe('Signer');
    expect(c.textContent).toContain('1 / 3');
  });

  test('BuyerCard : libellés français, société vérifiée, score', () => {
    const c = render(<BuyerCard buyer={{
      project_type: 'croissance-externe', budget_max: 500000, apport: 150000, financing: 'mixte', zones: ['Bretagne', 'Pays de la Loire'],
      trades: ['isolation', 'menuiserie'], horizon: '6-12', siren_verified: true, profile_score: 72,
    }} message="Bonjour, nous reprenons des entreprises d'isolation." />);
    expect(c.textContent).toContain('Croissance externe');
    expect(c.textContent).toContain('Société vérifiée');
    expect(c.textContent).toContain('Apport et emprunt');
    expect(c.textContent).toContain('Dans 6 à 12 mois');
    expect(c.textContent).toContain('Isolation, Menuiserie');
    expect(c.textContent).toContain(formatPrice(500000));
    expect(c.querySelector('[role="meter"]').getAttribute('aria-valuenow')).toBe('72');
    expect(c.textContent).toContain('Bonjour, nous reprenons');
  });
});
