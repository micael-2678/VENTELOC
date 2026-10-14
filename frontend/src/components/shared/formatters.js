// Formats fr-FR partagés par les composants (prix, loyers, rendements, surfaces, dates, pluriels).

const EUR = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const NUMBER = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

const isAmount = (n) => n !== null && n !== undefined && n !== '' && Number.isFinite(Number(n));

// Intl fr-FR sépare les milliers par une espace fine insécable (U+202F), presque invisible dans les chiffres gras à
// chasse fixe des cartes (« 520000 € ») : remplacée par une espace insécable normale (U+00A0), lisible partout
export const readableSpaces = (text) => String(text).replace(/\u202f/g, '\u00a0');

// 450000 → « 450 000 € » ; valeur absente → « — »
export const formatPrice = (n) => (isAmount(n) ? readableSpaces(EUR.format(Number(n))) : '—');

// 450000 → « 450 000 »
export const formatNumber = (n) => (isAmount(n) ? readableSpaces(NUMBER.format(Number(n))) : '—');

// Ordre de grandeur : arrondi à 1 000 / 10 000 / 50 000 € selon le montant
export const formatMagnitude = (n) => {
  const v = Number(n);
  if (!isAmount(n) || v <= 0) return '—';
  const step = v >= 1000000 ? 50000 : v >= 100000 ? 10000 : 1000;
  return `≈ ${formatPrice(Math.round(v / step) * step)}`;
};

// « 3 oct. 2026 » ; '' si la date est absente ou invalide
export const formatDateFr = (value, options) => {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('fr-FR', options || { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
};

// plural(3, 'lot') → « 3 lots » ; plural(1, 'lot') → « 1 lot »
export const plural = (n, singular, pluralForm) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  return `${formatNumber(v)} ${v > 1 ? pluralForm || `${singular}s` : singular}`;
};

// Rendement en pourcentage, une décimale : 5.24 → « 5,2 % » ; absent ou nul → '' (jamais « 0 % »)
const PERCENT = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const formatYield = (n) => (isAmount(n) && Number(n) > 0 ? `${PERCENT.format(Number(n))}\u00a0%` : '');

// Loyer mensuel : 620 → « 620 €/mois » ; absent → '—'
export const formatMonthly = (n) => (isAmount(n) ? `${formatPrice(n)}/mois` : '—');

// Surface : 42 → « 42 m² », 42.5 → « 42,5 m² » ; absente ou nulle → ''
const SURFACE = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
export const formatSurface = (n) => (isAmount(n) && Number(n) > 0 ? `${readableSpaces(SURFACE.format(Number(n)))}\u00a0m²` : '');

// Montant court pour les cartes : 1150000 → « 1,15 M€ », 780000 → « 780 k€ », 950 → « 950 € » ; absent → « — »
export const formatCompactEuros = (n) => {
  if (!isAmount(n)) return '—';
  const v = Number(n);
  const abs = Math.abs(v);
  if (abs >= 1000000) {
    const m = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(v / 1000000);
    return `${m}\u00a0M€`;
  }
  if (abs >= 1000) return `${formatNumber(Math.round(v / 1000))}\u00a0k€`;
  return `${formatNumber(v)}\u00a0€`;
};

// Date de publication relative : « aujourd'hui », « hier », « il y a 3 jours », « il y a 2 semaines », puis la date
// (« 3 oct. 2026 ») au-delà de 4 semaines. `now` est injectable pour les tests. '' si la date est absente ou invalide.
export const relativeDateFr = (value, now = new Date()) => {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(now) - day(d)) / 86400000);
  if (days <= 0) return 'aujourd\'hui';
  if (days === 1) return 'hier';
  if (days < 7) return `il y a ${days} jours`;
  if (days < 28) {
    const weeks = Math.floor(days / 7);
    return weeks === 1 ? 'il y a 1 semaine' : `il y a ${weeks} semaines`;
  }
  return formatDateFr(d);
};
