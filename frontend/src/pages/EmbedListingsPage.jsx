import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { ListingCard } from '@/components/shared';
import { filtersFromParams, listingsQuery, listingsPath, fetchListings } from '@/components/shared/listingFilters';
import { useSeo, NOINDEX } from '@/lib/seo';
import { BRAND } from '@/lib/brand';
import { content } from '@/seo';

// Module intégrable dans le site WordPress (MODE-TEST-ET-APP.md §A.5, docs/WORDPRESS.md) : /embed/annonces.
// Page minimale sans en-tête ni pied de page : grille compacte de cartes, mêmes filtres d'URL que /, plus `limit`
// (1 à 24, 6 par défaut), et un lien « Voir toutes les annonces ». Les liens s'ouvrent dans l'onglet parent
// (target="_top"). À chaque rendu, la hauteur du contenu est envoyée à la page parente :
// window.parent.postMessage({ type: 'cession-embed-height', height }, '*'). Jamais indexée (noindex).

const L = content.listings;
export const EMBED_MESSAGE_TYPE = 'cession-embed-height';
export const DEFAULT_EMBED_LIMIT = 6;

// Marqueurs de campagne des liens du module (statistiques : visites venues du site WordPress, module cliqué) ;
// `campagne` dans l'adresse de l'iframe devient utm_campaign
export const embedTracking = (params) => {
  const p = params instanceof URLSearchParams ? params : new URLSearchParams(params || '');
  const campaign = (p.get('campagne') || '').trim().slice(0, 60);
  const q = new URLSearchParams({ utm_source: 'wordpress', utm_medium: 'embed' });
  if (campaign) q.set('utm_campaign', campaign);
  return q.toString();
};

export const embedLimit = (value) => {
  const n = parseInt(String(value || ''), 10);
  if (!Number.isFinite(n)) return DEFAULT_EMBED_LIMIT;
  return Math.min(24, Math.max(1, n));
};

const postHeight = (el) => {
  if (!el || typeof window === 'undefined' || window.parent === window) return;
  const height = Math.ceil(el.getBoundingClientRect().height);
  window.parent.postMessage({ type: EMBED_MESSAGE_TYPE, height }, '*');
};

const EmbedListingsPage = () => {
  const { search } = useLocation();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const limit = embedLimit(params.get('limit'));
  const filters = useMemo(() => ({ ...filtersFromParams(params), page: 1 }), [params]);
  const criteriaKey = listingsQuery(filters);
  const [result, setResult] = useState({ status: 'loading', items: [] });
  const rootRef = useRef(null);

  useSeo(`Annonces | ${BRAND.name}`, L.description, { robots: NOINDEX });

  useEffect(() => {
    let alive = true;
    setResult({ status: 'loading', items: [] });
    // Critères relus depuis leur forme canonique : une requête seulement quand ils changent
    fetchListings(filtersFromParams(new URLSearchParams(criteriaKey)), { page: 1, limit })
      .then(({ items }) => { if (alive) setResult({ status: 'ready', items }); })
      .catch(() => { if (alive) setResult({ status: 'error', items: [] }); });
    return () => { alive = false; };
  }, [criteriaKey, limit]);

  // Hauteur envoyée à chaque rendu, et à chaque changement de taille (polices chargées, largeur de l'iframe)
  useEffect(() => { postHeight(rootRef.current); });
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => postHeight(el));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const tracking = embedTracking(params);
  const base = listingsPath({ ...filters, page: 1 });
  const allPath = `${base}${base.includes('?') ? '&' : '?'}${tracking}`;

  return (
    <main ref={rootRef} className="bg-white p-3 sm:p-4 min-w-0" data-testid="embed-listings">
      {result.status === 'loading' && (
        <div role="status" aria-label="Chargement des annonces" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: Math.min(limit, 3) }, (_, i) => (
            <div key={i} className="card p-4 h-56 animate-pulse bg-brand-surface" aria-hidden="true" />
          ))}
        </div>
      )}
      {result.status === 'error' && (
        <p className="text-sm text-gray-600" role="alert">{L.errorTitle}. {L.errorText}</p>
      )}
      {result.status === 'ready' && result.items.length === 0 && (
        <p className="text-gray-700" data-testid="embed-empty">{L.embedEmpty}</p>
      )}
      {result.status === 'ready' && result.items.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="embed-grid">
          {result.items.map((c) => (
            <li key={c.id} className="min-w-0 flex">
              <ListingCard property={c} compact source="embed" linkTarget="_top" linkQuery={tracking} className="w-full" />
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4">
        <Link to={allPath} target="_top" className="btn-link text-sm" data-testid="embed-all">
          {L.embedAll}<ArrowRight className="w-4 h-4" aria-hidden="true" />
        </Link>
      </p>
    </main>
  );
};

export default EmbedListingsPage;
