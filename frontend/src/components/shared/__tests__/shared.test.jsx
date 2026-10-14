// Tests des composants partagés, du barème (lib/offer.js), des statistiques maison (lib/analytics.js) et de
// l'ErrorBoundary. Exécution : cd frontend && CI=true npx craco test --watchAll=false
import '../jestEnv';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import {
  COMMISSION, OFFER, computeCommission, commissionRows, commissionConfig, commissionLabel, commissionSentenceFor, listingCommission, formatEuros,
  formatPercent, rateLabel, minimumLabel, fillOffer,
} from '@/lib/offer';
import { sanitizeProps, trackEvent, trackPageView, EVENT_NAMES } from '@/lib/analytics';
import ErrorBoundary from '@/components/ErrorBoundary';
import {
  ListingCard, listingTitle, listingLocation, listingYields, ownershipVerified, tenantSinceYear, dpeAlert, longDateFr, BuyerCard, AlertForm,
  Checklist, DpePill, DpeScale, formatPrice, formatMagnitude, formatCompactEuros, formatYield, formatMonthly, formatSurface, relativeDateFr,
} from '@/components/shared';
import { PROJECT_TYPES, FINANCING } from '@/components/shared/BuyerCard';
import { BUYER_PROJECT_TYPES, FINANCING_TYPES } from '@/lib/referentiels';

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
describe('lib/offer.js — honoraires : 3 % HT (3,6 % TTC), minimum 3 000 € HT, à la charge du vendeur', () => {
  test('montants identiques à business_model.calculate_commission (un seul taux, minimum, TVA 20 %)', () => {
    expect(COMMISSION).toMatchObject({ ratePercentHT: 3, minimumHT: 3000, vatRate: 0.2, payer: 'vendeur' });
    expect(computeCommission(200000)).toMatchObject({ ht: 6000, vat: 1200, ttc: 7200, appliedMinimum: false, ratePercentHT: 3, ratePercentTTC: 3.6, netSeller: 192800, payer: 'vendeur' });
    expect(computeCommission(50000)).toMatchObject({ ht: 3000, ttc: 3600, appliedMinimum: true, minimumTTC: 3600, effectivePercentTTC: 7.2 });
    expect(computeCommission(123456.78).ht).toBe(3703.7);
    expect(computeCommission('abc').ht).toBe(COMMISSION.minimumHT);
  });

  test('barème de GET /config (commission {rate_percent_ht, minimum_ht, vat_rate}) avec repli 3 / 3 000', () => {
    const cfg = commissionConfig({ rate_percent_ht: 4, rate_percent_ttc: 4.8, minimum_ht: 5000, minimum_ttc: 6000, vat_rate: 0.2 });
    expect(computeCommission(200000, cfg)).toMatchObject({ ht: 8000, ttc: 9600 });
    expect(computeCommission(100000, cfg)).toMatchObject({ ht: 5000, ttc: 6000, appliedMinimum: true });
    expect(commissionConfig({ vat_rate: 20 }).vatRate).toBe(0.2);
    expect(commissionConfig(null)).toMatchObject({ ratePercentHT: 3, minimumHT: 3000, vatRate: 0.2 });
    expect(commissionConfig({ rate_percent_ht: -1, minimum_ht: 'x' })).toMatchObject({ ratePercentHT: 3, minimumHT: 3000 });
  });

  test('affichage TTC d\'abord, HT entre parenthèses ; phrase de référence (SPEC §7.1)', () => {
    expect(formatEuros(7200)).toBe('7\u202f200\u00a0€');
    expect(formatPercent(3.6)).toBe('3,6\u00a0%');
    expect(rateLabel()).toBe('3,6\u00a0% TTC (3\u00a0% HT)');
    expect(minimumLabel()).toBe('3\u202f600\u00a0€ TTC (3\u202f000\u00a0€ HT)');
    expect(commissionLabel(200000)).toBe('7\u202f200\u00a0€ TTC (6\u202f000\u00a0€ HT)');
    expect(commissionSentenceFor()).toBe('3,6\u00a0% TTC du prix de vente (3\u00a0% HT), minimum 3\u202f600\u00a0€ TTC (3\u202f000\u00a0€ HT), à la charge du vendeur, dus uniquement à la signature de l\'acte authentique et réglés par le notaire sur le prix. Rien avant. Rien pour l\'acquéreur.');
    expect(OFFER.commissionSentence).toBe(commissionSentenceFor());
    expect(commissionRows().map((r) => r.label)).toEqual(['Honoraires', 'Minimum', 'À la charge de', 'Pour l\'acquéreur']);
    const all = JSON.stringify(OFFER);
    ['cédant', 'repreneur', 'cession', 'CessionRGE', 'à compléter', '6 % HT'].forEach((bad) => {
      expect(all).not.toContain(bad);
    });
    expect(fillOffer('{{trustTitle}} / {{inconnu}}')).toBe(`${OFFER.trustTitle} / {{inconnu}}`);
  });

  test('honoraires d\'une annonce : commission_info de l\'API sinon calcul local', () => {
    expect(listingCommission({ asking_price: 145000 })).toMatchObject({ ht: 4350, ttc: 5220 });
    expect(listingCommission({ asking_price: 145000, commission_info: { payer: 'vendeur', estimate_ht: 4400, estimate_ttc: 5280, rate_percent_ttc: 3.6 } })).toMatchObject({ ht: 4400, ttc: 5280 });
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
    expect(trackPageView('/vendre')).toBe(true);
    expect(trackPageView('/vendre')).toBe(false);
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
  property_type: 'appartement',
  lease_type: 'habitation-meublee',
  city: 'Lyon',
  district: 'Jean Macé',
  department: '69',
  region: 'Auvergne-Rhône-Alpes',
  surface: 24.5,
  rooms: 1,
  rent_monthly: 620,
  asking_price: 145000,
  property_tax: 650,
  non_recoverable_charges: 400,
  dpe_class: 'E',
  tenant_since: '2021-09-01',
  lease_start: '2024-09-01',
  ownership: { status: 'verified' },
  created_at: '2026-10-03T10:00:00Z',
};

describe('données d\'affichage d\'un bien (propertyDisplay)', () => {
  test('titre généré (taxonomy.property_title), localisation, rendements calculés, locataire en place', () => {
    expect(listingTitle(property)).toBe('Appartement T1 loué · 24,5 m² · Lyon (69)');
    expect(listingTitle({ title: 'Titre serveur' })).toBe('Titre serveur');
    expect(listingTitle({ property_type: 'immeuble', units_count: 5, city: 'Saint-Étienne', department: '42', surface: 320 })).toBe('Immeuble de rapport loué · 5 lots · 320 m² · Saint-Étienne (42)');
    expect(listingLocation(property)).toBe('Lyon · Rhône (69)');
    expect(listingLocation(property, { district: true })).toBe('Lyon, Jean Macé · Rhône (69)');
    expect(listingYields(property)).toEqual({ gross: 5.13, net: 4.41 });
    // Valeurs du serveur prioritaires ; pas de net sans taxe foncière ni charges
    expect(listingYields({ gross_yield: 6.1, net_yield: 4.9 })).toEqual({ gross: 6.1, net: 4.9 });
    expect(listingYields({ rent_monthly: 500, asking_price: 100000 })).toEqual({ gross: 6, net: null });
    expect(tenantSinceYear(property)).toBe(2021);
    expect(tenantSinceYear({ lease_start: '2018-01-01' })).toBe(2018);
    expect(ownershipVerified(property)).toBe(true);
    expect(ownershipVerified({ ownership: { status: 'pending' } })).toBe(false);
  });

  test('décence énergétique : alerte G interdit (texte de la spécification), F échéance, rien hors logement', () => {
    expect(longDateFr('2025-01-01')).toBe('1ᵉʳ janvier 2025');
    const g = dpeAlert({ dpe_class: 'G', lease_type: 'habitation-vide' }, '2026-10-14');
    expect(g.status).toBe('interdit');
    expect(g.text).toBe('Logement classé G : depuis le 1ᵉʳ janvier 2025 il ne peut plus faire l\'objet d\'un nouveau bail ni d\'un renouvellement. Le bail en cours continue jusqu\'à son terme.');
    const f = dpeAlert({ dpe_class: 'F', lease_type: 'habitation-meublee' }, '2026-10-14');
    expect(f.status).toBe('echeance');
    expect(f.text).toContain('à partir du 1ᵉʳ janvier 2028');
    expect(dpeAlert({ dpe_class: 'G', lease_type: 'commercial' }, '2026-10-14')).toBeNull();
    expect(dpeAlert({ dpe_class: 'C', lease_type: 'habitation-vide' }, '2026-10-14')).toBeNull();
    // Statut calculé par le serveur prioritaire
    expect(dpeAlert({ dpe_class: 'E', lease_type: 'habitation-vide', dpe_rental: { status: 'echeance', date: '2034-01-01' } }).text).toContain('1ᵉʳ janvier 2034');
  });

  test('formats : rendement à une décimale (jamais « 0 % »), loyer mensuel, surface', () => {
    expect(formatYield(5.134)).toBe('5,1\u00a0%');
    expect(formatYield(0)).toBe('');
    expect(formatYield(null)).toBe('');
    expect(formatMonthly(620)).toBe('620\u00a0€/mois');
    expect(formatSurface(24.5)).toBe('24,5\u00a0m²');
    expect(formatSurface(0)).toBe('');
  });
});

describe('DpePill et DpeScale', () => {
  test('pastille aux couleurs réglementaires, libellé accessible, DPE vierge en toutes lettres', () => {
    const c = render(<><DpePill value="g" /><DpePill value="B" /><DpePill value="vierge" /><DpePill value="" /></>);
    const pills = c.querySelectorAll('[data-testid="dpe-pill"]');
    expect(pills).toHaveLength(3);
    expect(pills[0].getAttribute('data-dpe')).toBe('G');
    expect(pills[0].querySelector('[role="img"]').getAttribute('aria-label')).toBe('DPE classe G');
    expect(pills[0].querySelector('[role="img"]').className).toContain('bg-dpe-G');
    expect(pills[0].querySelector('[role="img"]').className).toContain('text-white');
    expect(pills[1].querySelector('[role="img"]').className).toContain('text-brand-navy');
    expect(pills[2].textContent).toBe('DPE vierge');
  });

  test('échelle A à G avec la classe du bien', () => {
    const c = render(<DpeScale value="D" caption="DPE du 3 mars 2024" />);
    expect(c.querySelectorAll('li')).toHaveLength(7);
    expect(c.querySelector('ol').getAttribute('aria-label')).toBe('Échelle énergie, classe D');
    expect(c.textContent).toContain('Classe D');
    expect(render(<DpeScale value="non-soumis" />).textContent).toBe('');
  });
});

describe('ListingCard', () => {
  test('photo ou pictogramme, titre, rendement brut et net, loyer, prix honoraires inclus, badges, lien /annonce/:id et événement', () => {
    const c = withRouter(<ListingCard property={property} source="test" now={new Date('2026-10-10T12:00:00')} />);
    const card = c.querySelector('[data-testid="listing-card"]');
    expect(card.tagName).toBe('ARTICLE');
    expect(card.className).toContain('min-w-0');
    expect(c.querySelector('[data-testid="property-picto"]')).not.toBeNull();
    const link = c.querySelector('a[data-testid="listing-card-link"]');
    expect(link.getAttribute('href')).toBe('/annonce/abc123');
    expect(link.textContent).toBe('Appartement T1 loué · 24,5 m² · Lyon (69)');
    expect(c.textContent).toContain('Lyon · Rhône (69)');
    expect(c.querySelector('[data-testid="listing-card-yield"]').textContent).toBe('5,1\u00a0%');
    expect(c.querySelector('[data-testid="listing-card-net-yield"]').textContent).toBe('net 4,4\u00a0%');
    expect(c.querySelector('[data-testid="listing-card-rent"]').textContent).toBe('620\u00a0€/mois');
    expect(c.querySelector('[data-testid="listing-card-price"]').textContent).toBe(formatPrice(145000));
    expect(c.textContent).toContain('Honoraires inclus, à la charge du vendeur');
    expect(c.textContent).toContain('Location meublée');
    expect(c.querySelector('[data-testid="dpe-pill"]').getAttribute('data-dpe')).toBe('E');
    expect(c.querySelector('[data-testid="listing-card-verified"]').className).toContain('badge-verified');
    expect(c.querySelector('[data-testid="listing-card-tenant"]').textContent).toBe('Locataire en place depuis 2021');
    expect(c.querySelector('time').getAttribute('dateTime')).toBe(property.created_at);
    expect(c.querySelector('time').textContent).toBe('il y a 1 semaine');
    // Jamais l'adresse ni la société, même si elles sont présentes (vendeur connecté)
    const withSecret = withRouter(<ListingCard property={{ ...property, address: '12 rue Secrète', company_name: 'SCI Secrète' }} />);
    expect(withSecret.textContent).not.toMatch(/Secrète/);
    // Sans gestionnaire de favori : pas de cœur (aperçu du vendeur)
    expect(c.querySelector('[data-testid="favorite-toggle"]')).toBeNull();
    act(() => link.click());
    expect(bodyOf(global.fetch.mock.calls[0])).toMatchObject({ name: 'listing_card_click', props: { listing: 'abc123', source: 'test' } });
  });

  test('badge vert seulement si le justificatif de propriété est validé ; séparateur de milliers lisible', () => {
    const pending = withRouter(<ListingCard property={{ ...property, ownership: { status: 'pending' } }} />);
    expect(pending.querySelector('[data-testid="listing-card-verified"]')).toBeNull();
    expect(formatPrice(520000)).toBe('520\u00a0000\u00a0€');
    expect(formatPrice(520000)).not.toContain('\u202f');
  });

  test('liens marqués (module WordPress) : linkQuery ajouté à l\'adresse de la fiche', () => {
    const c = withRouter(<ListingCard property={property} linkQuery="utm_source=wordpress&utm_medium=embed" />);
    expect(c.querySelector('a[data-testid="listing-card-link"]').getAttribute('href')).toBe('/annonce/abc123?utm_source=wordpress&utm_medium=embed');
  });

  test('mode test : badge « Annonce de test » seulement pour une annonce is_test', () => {
    const real = withRouter(<ListingCard property={property} />);
    expect(real.querySelector('[data-testid="listing-card-test"]')).toBeNull();
    const fake = withRouter(<ListingCard property={{ ...property, is_test: true }} />);
    expect(fake.querySelector('[data-testid="listing-card-test"]').textContent).toBe('Annonce de test');
  });

  test('favori : bouton distinct du lien, état pressé', () => {
    const onToggle = jest.fn();
    const c = withRouter(<ListingCard property={property} favorite onToggleFavorite={onToggle} />);
    const heart = c.querySelector('[data-testid="favorite-toggle"]');
    expect(heart.tagName).toBe('BUTTON');
    expect(heart.closest('a')).toBeNull();
    expect(heart.getAttribute('aria-pressed')).toBe('true');
    expect(heart.getAttribute('aria-label')).toContain('Retirer des favoris');
    act(() => heart.click());
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: 'abc123' }));
  });

  test('formats courts et dates relatives', () => {
    const now = new Date('2026-10-10T12:00:00');
    expect(formatCompactEuros(1148000)).toBe('1,15\u00a0M€');
    expect(formatCompactEuros(780000)).toBe('780\u00a0k€');
    expect(formatCompactEuros(null)).toBe('—');
    expect(formatMagnitude(87500)).toBe(`≈ ${formatPrice(88000)}`);
    expect(relativeDateFr('2026-10-10T08:00:00', now)).toBe('aujourd\'hui');
    expect(relativeDateFr('2026-10-09T08:00:00', now)).toBe('hier');
    expect(relativeDateFr('2026-10-07T08:00:00', now)).toBe('il y a 3 jours');
    expect(relativeDateFr('2026-09-24T08:00:00', now)).toBe('il y a 2 semaines');
    expect(relativeDateFr('2026-08-01T08:00:00', now)).toBe('1 août 2026');
    expect(relativeDateFr('pas une date', now)).toBe('');
    expect(formatPrice(null)).toBe('—');
  });
});

// ------------------------------------------------------------------------------------------------
describe('AlertForm — alerte sans compte', () => {
  test('e-mail invalide refusé, puis POST /alerts/public et état « vérifiez votre boîte mail »', async () => {
    const onCreated = jest.fn();
    const c = render(<AlertForm source="test" defaultTypes={['appartement']} defaultMinYield="5.5" onCreated={onCreated} />);
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
    expect(bodyOf(post)).toEqual({ email: 'jean@exemple.fr', property_types: ['appartement'], regions: ['Bretagne'], max_price: 300000, min_yield: 5 });
    expect(c.querySelector('[data-testid="alert-form-success"]').textContent).toContain('Vérifiez votre boîte mail');
    expect(onCreated).toHaveBeenCalledTimes(1);
    const created = global.fetch.mock.calls.map(bodyOf).find((b) => b.name === 'alert_created');
    expect(created.props).toMatchObject({ source: 'test', types: 1, regions: 1, max_price: 300000, min_yield: 5 });
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
      { id: 'nda', label: 'Engagement de confidentialité signé', state: 'current', action: <button type="button">Signer</button> },
      { id: 'fonds', label: 'Origine des fonds déclarée', state: 'todo' },
    ]} />);
    const current = c.querySelector('li[aria-current="step"]');
    expect(current.textContent).toContain('Engagement de confidentialité signé');
    expect(current.querySelector('button').textContent).toBe('Signer');
    expect(c.textContent).toContain('1 / 3');
  });

  test('BuyerCard : carte acquéreur (SPEC §4), libellés du référentiel, rendement visé, identité après engagement', () => {
    expect(Object.keys(PROJECT_TYPES)).toEqual(BUYER_PROJECT_TYPES.map((t) => t.id));
    expect(Object.keys(FINANCING)).toEqual(FINANCING_TYPES.map((t) => t.id));
    const c = render(<BuyerCard buyer={{
      label: 'Acquéreur n°123456', project_type: 'sci', budget_max: 300000, apport: 60000, financing: 'mixte', zones: ['Bretagne', 'Pays de la Loire'],
      property_types: ['appartement', 'parking'], min_yield: 6, horizon: '6-12', siren_verified: true, profile_score: 72,
    }} message="Bonjour, nous investissons dans des T2 loués." />);
    expect(c.querySelector('h3').textContent).toBe('Acquéreur n°123456');
    expect(c.textContent).toContain('Carte acquéreur');
    expect(c.textContent).toContain('Achat via une SCI');
    expect(c.textContent).toContain('Société vérifiée');
    expect(c.textContent).toContain('Apport et emprunt');
    expect(c.textContent).toContain('Dans 6 à 12 mois');
    expect(c.textContent).toContain('Appartement, Parking');
    expect(c.textContent).toContain('6,0\u00a0% minimum');
    expect(c.textContent).toContain(formatPrice(300000));
    expect(c.querySelector('[role="meter"]').getAttribute('aria-valuenow')).toBe('72');
    expect(c.querySelector('[data-testid="buyer-identity"]')).toBeNull();
    const revealed = render(<BuyerCard buyer={{ label: 'Acquéreur n°1', name: 'Paul Martin', company_name: 'SCI Martin' }} />);
    expect(revealed.querySelector('[data-testid="buyer-identity"]').textContent).toContain('Paul Martin · SCI Martin');
    expect(revealed.textContent).not.toMatch(/repreneur|métier/i);
  });
});
