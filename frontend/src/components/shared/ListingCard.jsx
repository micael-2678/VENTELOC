import { Link } from 'react-router-dom';
import { Heart, MapPin, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { trackEvent } from '@/lib/analytics';
import * as ref from '@/lib/referentiels';
import { PILL } from './buttonStyles';
import { formatPrice, formatCompactEuros, formatDateFr, relativeDateFr, plural, deActivity } from './formatters';

// Carte d'annonce unique (page des annonces, module WordPress, favoris, aperçu du cédant) — MODE-TEST-ET-APP.md §A.3.
// `property` est l'objet renvoyé par l'API : title, trades, rge_types, other_qualifications, region, department,
// staff_count, ca_n, ebitda, asking_price, published_at / created_at, is_rge, property_checks, commission_payer (héritage).
// Jamais de nom ni de coordonnées : seulement ce que l'annonce anonyme montre.
// Toute la carte mène à /property/:id (lien étiré sur le titre) ; le cœur reste un bouton distinct, au-dessus du lien.

const safe = (fn, fallback = '') => {
  try {
    const v = fn();
    return v === undefined || v === null ? fallback : v;
  } catch (e) {
    return fallback;
  }
};

const tradeShort = (id) => safe(() => (typeof ref.tradeLabel === 'function' ? ref.tradeLabel(id, true) : ''), '') || String(id || '');
const rgeShort = (value) => safe(() => (typeof ref.shortRgeLabel === 'function' ? ref.shortRgeLabel(value) : ''), '') || String(value || '');
const departement = (code) => safe(() => (typeof ref.departementLabel === 'function' ? ref.departementLabel(code) : ''), '');
const qualificationName = (id) => {
  const label = safe(() => (typeof ref.otherQualificationLabel === 'function' ? ref.otherQualificationLabel(id) : ''), '') || String(id || '');
  return label.replace(/\s*\(.*\)\s*$/, '');
};

const hasNumber = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const hasStaff = (c) => c && hasNumber(c.staff_count);

// Titre affiché : celui généré par le serveur, sinon « Entreprise de {métier} · {région} · {n} salariés »
export const listingTitle = (property) => {
  if (property?.title) return String(property.title);
  const trades = Array.isArray(property?.trades) ? property.trades : [];
  const rge = Array.isArray(property?.rge_types) ? property.rge_types : [];
  const activity = (trades.length ? tradeShort(trades[0]) : '') || (rge.length ? rgeShort(rge[0]) : '') || 'bâtiment';
  const parts = [`Entreprise ${deActivity(activity)}`];
  if (property?.region) parts.push(String(property.region));
  if (hasStaff(property)) parts.push(plural(Number(property.staff_count), 'salarié'));
  return parts.join(' · ');
};

// Badge de qualification, trois cas distincts : « RGE vérifié ADEME » (vert, RGE retrouvé sur la base ADEME :
// property_checks.in_ademe_list), « RGE déclaré » (gris, domaines RGE déclarés par le cédant, non confirmés), ou les
// autres qualifications déclarées nommées (« Qualibat déclaré », « Qualifelec, IRVE déclarés »)
export const qualificationBadge = (property) => {
  const rge = Array.isArray(property?.rge_types) ? property.rge_types : [];
  const isRge = property?.is_rge === true || rge.length > 0;
  if (isRge && property?.property_checks?.in_ademe_list === true) return { kind: 'verified', label: 'RGE vérifié ADEME' };
  if (isRge) return { kind: 'declared', label: 'RGE déclaré' };
  const others = (Array.isArray(property?.other_qualifications) ? property.other_qualifications : [])
    .map(qualificationName).filter(Boolean).filter((v, i, all) => all.indexOf(v) === i);
  if (!others.length) return null;
  const names = others.slice(0, 2).join(', ') + (others.length > 2 ? ` +${others.length - 2}` : '');
  return { kind: 'declared', label: `${names} ${others.length > 1 ? 'déclarés' : 'déclaré'}` };
};

// Multiple prix demandé / EBE (« 2,8 × »), comme sur la fiche ; '' si l'un des deux manque
export const priceToEbitda = (property) => {
  const price = Number(property?.asking_price);
  const ebitda = Number(property?.ebitda);
  if (!(price > 0) || !(ebitda > 0)) return '';
  return `${(price / ebitda).toFixed(1).replace('.', ',')}\u00a0×`;
};

// Ligne de localisation : le département (« Rhône (69) »), la région figurant déjà dans le titre généré ; la région
// seule quand le département manque et que le titre ne la cite pas
export const listingLocation = (property, title = listingTitle(property)) => {
  const dep = property?.department ? departement(property.department) : '';
  if (dep) return dep;
  const region = property?.region ? String(property.region) : '';
  return region && !String(title).includes(region) ? region : '';
};

// Pastilles d'activité : métiers (+ « +n »), sinon domaines RGE pour les anciennes annonces
const activityChips = (property, max) => {
  const trades = Array.isArray(property?.trades) ? property.trades.map(tradeShort).filter(Boolean) : [];
  const source = trades.length ? trades : (Array.isArray(property?.rge_types) ? property.rge_types.map(rgeShort).filter(Boolean) : []);
  const unique = source.filter((v, i) => source.indexOf(v) === i);
  return { shown: unique.slice(0, max), more: Math.max(0, unique.length - max) };
};

const Metric = ({ label, title, children }) => (
  <div className="min-w-0">
    <dt className="text-xs text-gray-500">{title ? <abbr title={title} className="no-underline">{label}</abbr> : label}</dt>
    <dd className="text-sm font-semibold text-brand-navy tabular truncate">{children}</dd>
  </div>
);

const ListingCard = ({
  property,
  compact = false,
  source = 'list',
  headingLevel = 'h3',
  className = '',
  onClick,
  linkTarget,
  linkQuery = '',
  favorite = false,
  onToggleFavorite,
  now,
}) => {
  if (!property || !property.id) return null;
  const Heading = headingLevel;
  const title = listingTitle(property);
  const badge = qualificationBadge(property);
  const chips = activityChips(property, compact ? 2 : 3);
  const dateIso = property.published_at || property.created_at || '';
  const relative = relativeDateFr(dateIso, now || new Date());
  const location = listingLocation(property, title);
  const legacyBuyerPays = property.commission_payer === 'repreneur';
  const showEbitda = hasNumber(property.ebitda) && Number(property.ebitda) !== 0;
  // Troisième mesure : multiple prix/EBE (comparable d'une carte à l'autre) ; l'effectif, déjà dans le titre, sinon
  const multiple = priceToEbitda(property);
  const href = `/property/${property.id}${linkQuery ? `?${String(linkQuery).replace(/^\?/, '')}` : ''}`;
  const canFavorite = typeof onToggleFavorite === 'function';

  const handleClick = (e) => {
    trackEvent('listing_card_click', { listing: String(property.id), source });
    if (typeof onClick === 'function') onClick(e, property);
  };

  return (
    <article
      className={cn(
        'card card-hover relative flex flex-col min-w-0',
        'has-[.listing-card-link:focus-visible]:ring-2 has-[.listing-card-link:focus-visible]:ring-brand-blue has-[.listing-card-link:focus-visible]:ring-offset-2',
        compact ? 'p-4 gap-2.5' : 'p-5 gap-3',
        className,
      )}
      data-testid="listing-card"
    >
      <div className="flex items-start justify-between gap-2 min-w-0 min-h-6">
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          {badge && (
            <span className={cn(PILL, badge.kind === 'verified' ? 'badge-verified' : 'badge-declared')} data-testid="listing-card-badge">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{badge.label}</span>
            </span>
          )}
          {/* Mode test (MODE-TEST-ET-APP.md §B.2.7) : annonce fictive, signalée comme telle */}
          {property?.is_test === true && <span className={cn(PILL, 'badge-warning')} data-testid="listing-card-test">Annonce de test</span>}
        </div>
        {canFavorite && (
          <button
            type="button"
            onClick={() => onToggleFavorite(property)}
            aria-pressed={favorite}
            aria-label={favorite ? `Retirer des favoris : ${title}` : `Ajouter aux favoris : ${title}`}
            className={cn(
              'relative z-10 -m-2 shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-full transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue',
              favorite ? 'text-red-600 hover:bg-red-50' : 'text-gray-500 hover:text-brand-navy hover:bg-brand-surface',
            )}
            data-testid="favorite-toggle"
          >
            <Heart className={cn('w-5 h-5', favorite && 'fill-current')} aria-hidden="true" />
          </button>
        )}
      </div>

      <Heading className={cn('font-display font-bold text-brand-navy leading-snug break-words', compact ? 'text-base' : 'text-[1.0625rem]')}>
        <Link
          to={href}
          target={linkTarget}
          onClick={handleClick}
          className="listing-card-link after:absolute after:inset-0 after:rounded-2xl after:content-[''] focus-visible:outline-none hover:underline underline-offset-4 decoration-brand-navy/30"
          data-testid="listing-card-link"
        >
          {title}
        </Link>
      </Heading>

      {location && (
        <p className="flex items-center gap-1 text-sm text-gray-600 min-w-0">
          <MapPin className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="sr-only">Localisation : </span>
          <span className="min-w-0 break-words">{location}</span>
        </p>
      )}

      {chips.shown.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 min-w-0" aria-label="Métiers">
          {chips.shown.map((label) => (
            <li key={label} className={cn(PILL, 'bg-brand-blue-soft text-blue-800')}>
              <span className="truncate">{label}</span>
            </li>
          ))}
          {chips.more > 0 && <li className={cn(PILL, 'badge-declared')}>+{chips.more}</li>}
        </ul>
      )}

      <dl className={cn('mt-auto pt-3 border-t border-brand-line grid gap-3 min-w-0', showEbitda ? 'grid-cols-3' : 'grid-cols-2')}>
        <Metric label="CA" title="Chiffre d'affaires">{hasNumber(property.ca_n) && Number(property.ca_n) > 0 ? formatCompactEuros(property.ca_n) : '—'}</Metric>
        {showEbitda && <Metric label="EBE" title="Excédent brut d'exploitation">{formatCompactEuros(property.ebitda)}</Metric>}
        {multiple
          ? <Metric label="Prix/EBE" title="Prix demandé rapporté à l'excédent brut d'exploitation">{multiple}</Metric>
          : <Metric label="Effectif">{hasStaff(property) ? plural(Number(property.staff_count), 'salarié') : '—'}</Metric>}
      </dl>

      <div className="flex items-end justify-between gap-3 min-w-0">
        <div className="min-w-0">
          <p className="text-xs text-gray-500">Prix demandé</p>
          <p className={cn('font-display font-extrabold text-brand-navy tabular', compact ? 'text-lg' : 'text-xl')} data-testid="listing-card-price">
            {formatPrice(property.asking_price)}
          </p>
        </div>
        {relative && (
          <p className="text-xs text-gray-500 shrink-0 text-right">
            <span className="sr-only">Publiée </span>
            <time dateTime={String(dateIso)} title={formatDateFr(dateIso, { day: 'numeric', month: 'long', year: 'numeric' })}>{relative}</time>
          </p>
        )}
      </div>

      {legacyBuyerPays && (
        <p className="text-xs text-brand-amber">Commission à la charge de l&apos;acquéreur (annonce antérieure au barème actuel)</p>
      )}
    </article>
  );
};

export default ListingCard;
