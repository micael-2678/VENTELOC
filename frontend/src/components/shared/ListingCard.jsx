import { Link } from 'react-router-dom';
import { BadgeCheck, Heart, MapPin, UserCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { trackEvent } from '@/lib/analytics';
import { OFFER } from '@/lib/offer';
import { PILL } from './buttonStyles';
import { formatPrice, formatMonthly, formatYield, formatDateFr, relativeDateFr, formatSurface } from './formatters';
import { listingTitle, listingLocation, listingYields, ownershipVerified, tenantSinceYear, listingChips } from './propertyDisplay';
import DpePill from './DpePill';
import PropertyPhoto from './PropertyPhoto';

// Carte d'annonce unique (page des annonces, module WordPress, favoris, aperçu du vendeur) — docs/venteloc/SPEC.md §5.1.
// Photo (sinon pictogramme du type), titre généré, ville · département, rendement brut mis en avant (et net s'il est
// calculable), loyer mensuel HC, prix honoraires inclus (à la charge du vendeur), puces bail et DPE, badge vert
// « Propriétaire vérifié » (justificatif validé seulement), « Locataire en place depuis … », date relative, favori.
// Jamais d'adresse exacte, de nom ni de coordonnées. Toute la carte mène à /annonce/:id (lien étiré sur le titre) ;
// le cœur reste un bouton distinct, au-dessus du lien.

export { listingTitle, listingLocation } from './propertyDisplay';

export const listingPath = (id) => `/annonce/${id}`;

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
  showPhoto = true,
  now,
}) => {
  if (!property || !property.id) return null;
  const Heading = headingLevel;
  const title = listingTitle(property);
  const location = listingLocation(property);
  const { gross, net } = listingYields(property);
  const verified = ownershipVerified(property);
  const since = tenantSinceYear(property);
  const chips = listingChips(property);
  const dateIso = property.published_at || property.created_at || '';
  const relative = relativeDateFr(dateIso, now || new Date());
  const surface = formatSurface(property.surface);
  const href = `${listingPath(property.id)}${linkQuery ? `?${String(linkQuery).replace(/^\?/, '')}` : ''}`;
  const canFavorite = typeof onToggleFavorite === 'function';
  const hasRent = Number(property.rent_monthly) > 0;

  const handleClick = (e) => {
    trackEvent('listing_card_click', { listing: String(property.id), source });
    if (typeof onClick === 'function') onClick(e, property);
  };

  return (
    <article
      className={cn(
        'card card-hover relative flex flex-col min-w-0 overflow-hidden',
        'has-[.listing-card-link:focus-visible]:ring-2 has-[.listing-card-link:focus-visible]:ring-brand-teal has-[.listing-card-link:focus-visible]:ring-offset-2',
        className,
      )}
      data-testid="listing-card"
    >
      {showPhoto && (
        <div className="relative">
          <PropertyPhoto property={property} className={compact ? 'aspect-[16/9]' : 'aspect-[16/10]'} iconClassName={compact ? 'w-9 h-9' : 'w-12 h-12'} />
          <div className="absolute top-2.5 left-2.5 right-14 flex flex-wrap gap-1.5 min-w-0">
            {verified && (
              <span className={cn(PILL, 'badge-verified shadow-sm')} data-testid="listing-card-verified">
                <BadgeCheck className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">Propriétaire vérifié</span>
              </span>
            )}
            {property?.is_test === true && <span className={cn(PILL, 'badge-warning shadow-sm')} data-testid="listing-card-test">Annonce de test</span>}
          </div>
        </div>
      )}

      {canFavorite && (
        <button
          type="button"
          onClick={() => onToggleFavorite(property)}
          aria-pressed={favorite}
          aria-label={favorite ? `Retirer des favoris : ${title}` : `Ajouter aux favoris : ${title}`}
          className={cn(
            'absolute z-10 top-2 right-2 inline-flex items-center justify-center w-10 h-10 rounded-full bg-white/95 shadow-sm transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal',
            favorite ? 'text-red-600 hover:bg-red-50' : 'text-gray-600 hover:text-brand-navy',
          )}
          data-testid="favorite-toggle"
        >
          <Heart className={cn('w-5 h-5', favorite && 'fill-current')} aria-hidden="true" />
        </button>
      )}

      <div className={cn('flex flex-col flex-1 min-w-0', compact ? 'p-4 gap-2' : 'p-5 gap-2.5')}>
        {!showPhoto && (verified || property?.is_test === true) && (
          <div className="flex flex-wrap gap-1.5">
            {verified && <span className={cn(PILL, 'badge-verified')} data-testid="listing-card-verified"><BadgeCheck className="w-3.5 h-3.5" aria-hidden="true" />Propriétaire vérifié</span>}
            {property?.is_test === true && <span className={cn(PILL, 'badge-warning')} data-testid="listing-card-test">Annonce de test</span>}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          {chips.map((label) => <span key={label} className={cn(PILL, 'bg-brand-surface text-gray-700 border border-brand-line')}>{label}</span>)}
          {property.dpe_class && <DpePill value={property.dpe_class} size="sm" withLabel />}
        </div>

        <Heading className={cn('font-display font-bold text-brand-navy leading-snug break-words', compact ? 'text-base' : 'text-[1.0625rem]')}>
          <Link
            to={href}
            target={linkTarget}
            onClick={handleClick}
            className="listing-card-link after:absolute after:inset-0 after:content-[''] focus-visible:outline-none hover:underline underline-offset-4 decoration-brand-navy/30"
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

        <dl className="mt-1 grid grid-cols-2 gap-2 min-w-0">
          <div className="rounded-xl bg-brand-teal-soft border border-brand-teal-line/60 px-3 py-2 min-w-0">
            <dt className="text-xs font-medium text-brand-teal-dark">Rendement brut</dt>
            <dd className="font-display text-xl font-extrabold text-brand-teal-dark tabular leading-tight" data-testid="listing-card-yield">{formatYield(gross) || '—'}</dd>
            {net && <dd className="text-xs text-gray-700 tabular" data-testid="listing-card-net-yield">net {formatYield(net)}</dd>}
          </div>
          <div className="rounded-xl bg-brand-surface border border-brand-line px-3 py-2 min-w-0">
            <dt className="text-xs font-medium text-gray-600">Loyer HC</dt>
            <dd className="font-display text-lg font-bold text-brand-navy tabular leading-tight" data-testid="listing-card-rent">{hasRent ? formatMonthly(property.rent_monthly) : '—'}</dd>
            {surface && <dd className="text-xs text-gray-600 tabular">{surface}</dd>}
          </div>
        </dl>

        <div className="mt-auto pt-2 flex items-end justify-between gap-3 min-w-0">
          <div className="min-w-0">
            <p className={cn('font-display font-extrabold text-brand-navy tabular leading-tight', compact ? 'text-lg' : 'text-xl')} data-testid="listing-card-price">
              {formatPrice(property.asking_price)}
            </p>
            <p className="text-xs text-gray-600">{OFFER.priceMention}</p>
          </div>
          {relative && (
            <p className="text-xs text-gray-500 shrink-0 text-right">
              <span className="sr-only">Publiée </span>
              <time dateTime={String(dateIso)} title={formatDateFr(dateIso, { day: 'numeric', month: 'long', year: 'numeric' })}>{relative}</time>
            </p>
          )}
        </div>

        {since && (
          <p className="flex items-center gap-1.5 text-sm text-gray-700 pt-2 border-t border-brand-line" data-testid="listing-card-tenant">
            <UserCheck className="w-4 h-4 shrink-0 text-gray-500" aria-hidden="true" />
            Locataire en place depuis {since}
          </p>
        )}
      </div>
    </article>
  );
};

export default ListingCard;
