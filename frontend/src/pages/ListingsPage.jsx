import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowRight, ChevronLeft, ChevronRight, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import { axiosInstance } from '@/App';
import AppLayout from '@/components/layout/AppLayout';
import { useSession } from '@/components/layout/session';
import { canSell, sellPathFor } from '@/components/layout/AppHeader';
import { ListingCard, AlertForm, listingTitle } from '@/components/shared';
import { deActivity, readableSpaces } from '@/components/shared/formatters';
import ListingFilters from '@/components/shared/ListingFilters';
import { BTN_PRIMARY, BTN_SECONDARY } from '@/components/shared/buttonStyles';
import {
  EMPTY_FILTERS, PAGE_SIZE, SORTS, LISTINGS_PATH, filtersFromParams, listingsQuery, listingsPath, canonicalSearch, fetchListings,
  activeFilterCount, filterChips,
} from '@/components/shared/listingFilters';
import { useSeo, SITE_URL } from '@/lib/seo';
import { TRADES, inRegion } from '@/lib/referentiels';
import { BRAND, LEGAL } from '@/lib/brand';
import { trackEvent } from '@/lib/analytics';
import { content, fillText } from '@/seo';
import { itemListLd, organizationLd, websiteLd } from '@/seo/schema';

// Page des annonces (/) — MODE-TEST-ET-APP.md §A.3. Vitrine de l'application : en-tête sobre, filtres (colonne
// latérale sur grand écran, panneau plein écran sur mobile), grille de cartes, pagination de 24, alerte sans compte,
// encart cédant. Les filtres vivent dans l'URL (listingFilters.js) : partageables et utilisables depuis WordPress.
// Jamais de compteur à zéro : le nombre d'annonces n'apparaît qu'à partir de 3 (en-tête) ou d'1 (recherche filtrée).

const L = content.listings;
const NUMBER = new Intl.NumberFormat('fr-FR');
const annonces = (n) => `${readableSpaces(NUMBER.format(n))} annonce${n > 1 ? 's' : ''}`;

// Titre d'une recherche ciblée (lien filtré depuis WordPress, au plus un métier et une région) : « Entreprises de PAC,
// climatisation à vendre en Bretagne » ; null pour la page générale ou une combinaison de plusieurs métiers
export const searchHeading = (filters) => {
  const trades = filters?.trades || [];
  if (trades.length > 1 || (!trades.length && !filters?.region)) return null;
  const trade = trades.length ? TRADES.find((t) => t.id === trades[0]) : null;
  if (trades.length && !trade) return null;
  const what = trade ? `Entreprises ${deActivity(trade.short)}` : 'Entreprises du bâtiment';
  return `${what} à vendre${filters.region ? ` ${inRegion(filters.region)}` : ''}`;
};

// Pages affichées : 1 … p-1 p p+1 … n
export const pageItems = (current, count) => {
  const pages = new Set([1, count, current - 1, current, current + 1]);
  const list = [...pages].filter((p) => p >= 1 && p <= count).sort((a, b) => a - b);
  const out = [];
  list.forEach((p, i) => {
    if (i > 0 && p - list[i - 1] > 1) out.push(`gap-${p}`);
    out.push(p);
  });
  return out;
};

const CardSkeleton = () => (
  <li className="card p-5 flex flex-col gap-3 animate-pulse" aria-hidden="true">
    <span className="h-5 w-32 rounded-full bg-brand-surface" />
    <span className="h-5 w-11/12 rounded bg-brand-surface" />
    <span className="h-5 w-2/3 rounded bg-brand-surface" />
    <span className="h-4 w-1/2 rounded bg-brand-surface" />
    <span className="mt-4 h-10 rounded bg-brand-surface" />
    <span className="h-7 w-28 rounded bg-brand-surface" />
  </li>
);

const SellerCallout = ({ to, onClick, className = '' }) => (
  <aside className={`rounded-2xl border border-brand-line bg-brand-surface p-5 min-w-0 ${className}`} aria-label={L.sellerTitle} data-testid="seller-callout">
    <p className="font-display font-bold text-brand-navy">{L.sellerTitle}</p>
    <p className="text-sm text-gray-600 mt-1 leading-relaxed">{L.sellerText}</p>
    <Link to={to} onClick={onClick} className="btn-link text-sm mt-3">
      {L.sellerCta}<ArrowRight className="w-4 h-4" aria-hidden="true" />
    </Link>
  </aside>
);

// Libellé du bouton du panneau mobile selon le nombre d'annonces du brouillon (null : pas encore connu)
export const showResultsLabel = (total) => {
  if (total === null || total === undefined) return L.showResults;
  if (total === 0) return 'Aucune annonce : créer une alerte';
  return `Afficher ${annonces(total)}`;
};

// Panneau de filtres plein écran (mobile) : brouillon appliqué au clic sur le bouton du bas, qui annonce le nombre
// d'annonces correspondantes (requête légère limit=1, 300 ms après le dernier réglage)
const MobileFilters = ({ open, initial, onClose, onApply }) => {
  const [draft, setDraft] = useState(initial);
  const [draftTotal, setDraftTotal] = useState(null);
  const closeRef = useRef(null);
  const titleId = useId();
  useEffect(() => { if (open) setDraft(initial); }, [open, initial]);
  const draftKey = listingsQuery({ ...draft, page: 1, tri: 'recent' });
  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => {
      fetchListings(filtersFromParams(new URLSearchParams(draftKey)), { limit: 1, signal: controller ? controller.signal : undefined })
        .then(({ total }) => { if (alive) setDraftTotal(total); })
        .catch(() => { if (alive) setDraftTotal(null); });
    }, 300);
    return () => { alive = false; clearTimeout(timer); if (controller) controller.abort(); };
  }, [open, draftKey]);
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (closeRef.current) closeRef.current.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = previous; document.removeEventListener('keydown', onKey); };
  }, [open, onClose]);
  if (!open) return null;
  const count = activeFilterCount(draft);
  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col lg:hidden" role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid="mobile-filters">
      <div className="flex items-center justify-between gap-3 px-4 h-14 border-b border-brand-line shrink-0">
        <h2 id={titleId} className="font-display text-lg font-bold text-brand-navy">{L.filtersTitle}{count > 0 ? ` (${count})` : ''}</h2>
        <button ref={closeRef} type="button" onClick={onClose} className="inline-flex items-center justify-center w-10 h-10 rounded-xl text-brand-navy hover:bg-brand-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue" aria-label="Fermer les filtres">
          <X className="w-6 h-6" aria-hidden="true" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-5">
        <ListingFilters value={draft} onChange={setDraft} labels={L} idPrefix="mobile" />
      </div>
      <div className="shrink-0 border-t border-brand-line px-4 py-3 flex items-center gap-3 bg-white">
        <button type="button" onClick={() => setDraft({ ...EMPTY_FILTERS, tri: draft.tri })} className="btn-link text-sm" disabled={count === 0}>
          {L.reset}
        </button>
        <button type="button" onClick={() => onApply(draft)} className={`${BTN_PRIMARY} flex-1 px-4 py-3 text-sm`} data-testid="mobile-filters-apply" aria-live="polite">
          {showResultsLabel(draftTotal)}
        </button>
      </div>
    </div>
  );
};

const Pagination = ({ page, pages, hrefFor }) => (
  <nav aria-label="Pagination" className="mt-10 flex flex-wrap items-center justify-center gap-1.5 text-sm" data-testid="pagination">
    {page > 1 ? (
      <Link to={hrefFor(page - 1)} className="inline-flex items-center gap-1 rounded-xl border border-brand-line bg-white px-3 py-2 font-medium text-brand-navy hover:border-brand-navy/40" rel="prev">
        <ChevronLeft className="w-4 h-4" aria-hidden="true" /><span className="hidden sm:inline">Précédente</span><span className="sr-only sm:hidden">Page précédente</span>
      </Link>
    ) : null}
    {pageItems(page, pages).map((p) => (typeof p === 'string' ? (
      <span key={p} className="px-1.5 text-gray-500" aria-hidden="true">…</span>
    ) : (
      <Link
        key={p}
        to={hrefFor(p)}
        aria-current={p === page ? 'page' : undefined}
        aria-label={`Page ${p}`}
        className={`inline-flex items-center justify-center min-w-10 h-10 px-2 rounded-xl font-semibold tabular ${p === page ? 'bg-brand-navy text-white' : 'border border-brand-line bg-white text-brand-navy hover:border-brand-navy/40'}`}
      >
        {p}
      </Link>
    )))}
    {page < pages ? (
      <Link to={hrefFor(page + 1)} className="inline-flex items-center gap-1 rounded-xl border border-brand-line bg-white px-3 py-2 font-medium text-brand-navy hover:border-brand-navy/40" rel="next">
        <span className="hidden sm:inline">Suivante</span><span className="sr-only sm:hidden">Page suivante</span><ChevronRight className="w-4 h-4" aria-hidden="true" />
      </Link>
    ) : null}
  </nav>
);

const ListingsPage = ({ user: userProp }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const session = useSession();
  const user = userProp !== undefined ? userProp : session.user;
  const sortId = useId();
  const resultsRef = useRef(null);

  // Anciens paramètres (?metiers=, ?rge_type=, region en toutes lettres…) → URL canonique, sans entrée d'historique
  const canonical = useMemo(() => canonicalSearch(location.search), [location.search]);
  useEffect(() => {
    if (canonical !== null) navigate({ pathname: LISTINGS_PATH, search: canonical ? `?${canonical}` : '', hash: location.hash }, { replace: true });
  }, [canonical, navigate, location.hash]);

  const filters = useMemo(() => filtersFromParams(new URLSearchParams(location.search)), [location.search]);
  const filtersKey = listingsQuery(filters);
  const [result, setResult] = useState({ status: 'loading', items: [], total: 0 });
  const [attempt, setAttempt] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [favorites, setFavorites] = useState(() => new Set());

  useEffect(() => {
    if (canonical !== null) return undefined;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let alive = true;
    setResult((r) => ({ ...r, status: 'loading' }));
    // Critères relus depuis leur forme canonique : une nouvelle requête seulement quand ils changent (pas pour ?utm_…)
    const criteria = filtersFromParams(new URLSearchParams(filtersKey));
    fetchListings(criteria, { page: criteria.page, signal: controller ? controller.signal : undefined })
      .then(({ items, total }) => { if (alive) setResult({ status: 'ready', items, total }); })
      .catch(() => { if (alive) setResult({ status: 'error', items: [], total: 0 }); });
    return () => { alive = false; if (controller) controller.abort(); };
  }, [filtersKey, attempt, canonical]);

  // Favoris du repreneur connecté (sans redirection vers /login si la session a expiré)
  const isBuyer = user?.role === 'buyer';
  useEffect(() => {
    if (!isBuyer) { setFavorites(new Set()); return undefined; }
    let alive = true;
    Promise.resolve()
      .then(() => axiosInstance.get('/favorites', { skipAuthRedirect: true }))
      .then((res) => {
        const data = res && res.data;
        const list = Array.isArray(data) ? data : (data && Array.isArray(data.favorites) ? data.favorites : []);
        if (alive) setFavorites(new Set(list.map((f) => f && (f.company_id || (f.company && f.company.id))).filter(Boolean)));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [isBuyer, user?.id]);

  // Réglage d'un filtre ou du tri : l'adresse est remplacée (le bouton Retour ramène à la page d'origine, le site
  // WordPress par exemple, pas au réglage précédent). Une nouvelle entrée d'historique seulement pour la pagination
  // (liens) et la validation du panneau mobile.
  const go = useCallback((next, { push = false } = {}) => {
    const q = listingsQuery(next);
    navigate({ pathname: LISTINGS_PATH, search: q ? `?${q}` : '' }, { replace: !push });
  }, [navigate]);
  const hrefFor = (page) => {
    const q = listingsQuery({ ...filters, page });
    return q ? `${LISTINGS_PATH}?${q}` : LISTINGS_PATH;
  };
  const reset = () => go({ ...EMPTY_FILTERS, tri: filters.tri });

  // Changement de page : retour en haut des résultats
  const previousPage = useRef(filters.page);
  useEffect(() => {
    if (previousPage.current !== filters.page && resultsRef.current && typeof resultsRef.current.scrollIntoView === 'function') {
      resultsRef.current.scrollIntoView({ block: 'start' });
    }
    previousPage.current = filters.page;
  }, [filters.page]);

  // Page au-delà de la dernière (annonce retirée entre-temps) : retour à la dernière page existante
  const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  useEffect(() => {
    if (result.status === 'ready' && result.items.length === 0 && result.total > 0 && filters.page > pages) {
      navigate({ pathname: LISTINGS_PATH, search: `?${listingsQuery({ ...filters, page: pages })}` }, { replace: true });
    }
  }, [result, filters, pages, navigate]);

  const toggleFavorite = async (company) => {
    if (!user) {
      navigate(`/register?role=buyer&redirect=${encodeURIComponent(`${location.pathname}${location.search}`)}`);
      return;
    }
    const id = company.id;
    const wasFavorite = favorites.has(id);
    const nextSet = (add) => setFavorites((prev) => {
      const s = new Set(prev);
      if (add) s.add(id); else s.delete(id);
      return s;
    });
    nextSet(!wasFavorite);
    try {
      if (wasFavorite) await axiosInstance.delete(`/favorites/${id}`);
      else await axiosInstance.post('/favorites', { company_id: id });
      toast.success(wasFavorite ? 'Annonce retirée de vos favoris' : 'Annonce ajoutée à vos favoris');
    } catch (e) {
      nextSet(wasFavorite);
      toast.error('Le favori n\'a pas pu être enregistré. Réessayez dans quelques instants.');
    }
  };

  // Lien direct vers l'alerte (/#alerte, depuis le site WordPress) : défilement une fois la liste affichée
  const hashHandled = useRef(false);
  useEffect(() => {
    if (hashHandled.current || result.status !== 'ready' || location.hash !== '#alerte') return;
    hashHandled.current = true;
    const target = document.getElementById('alerte');
    if (target && typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'start' });
  }, [result.status, location.hash]);

  const count = activeFilterCount(filters);
  const filtered = count > 0;
  const chips = filterChips(filters);
  const ready = result.status === 'ready';
  const items = ready ? result.items : [];
  const canFavorite = !user || isBuyer;
  const sellTo = sellPathFor(user);
  const onSellerCta = () => trackEvent('hero_cta_seller', { cta: 'listings_callout' });

  // Recherche ciblée (un métier et/ou une région) : titre, H1 et adresse canonique propres ; sinon la page générale
  const heading = searchHeading(filters);
  // Données structurées : jamais d'annonce de test (mode test, MODE-TEST-ET-APP.md §B)
  const indexable = items.filter((c) => c.is_test !== true);
  useSeo(heading ? `${heading} | ${BRAND.name}` : fillText(L.title), fillText(L.description), {
    path: heading ? listingsPath({ trades: filters.trades, region: filters.region }) : LISTINGS_PATH,
    jsonLd: [
      organizationLd(SITE_URL, BRAND, LEGAL),
      websiteLd(SITE_URL, BRAND),
      ...(indexable.length ? [itemListLd(SITE_URL, indexable.map((c) => ({ name: listingTitle(c), path: `/company/${c.id}` })))] : []),
    ],
  });

  // Alerte préremplie avec les critères de la recherche (réinitialisée quand ils changent)
  const alertKey = `${filters.trades.join(',')}|${filters.region}|${filters.prixMax}`;
  const alertProps = {
    defaultTrades: filters.trades,
    defaultRegions: filters.region ? [filters.region] : [],
    defaultMaxPrice: filters.prixMax,
    title: L.alertTitle,
    intro: L.alertIntro,
  };

  return (
    <AppLayout user={user} className="bg-brand-surface">
      <section className="bg-white border-b border-brand-line" aria-labelledby="titre-annonces">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-10 min-w-0">
          <h1 id="titre-annonces" className="font-display text-3xl sm:text-4xl font-extrabold text-brand-navy tracking-tight break-words">{heading || L.h1}</h1>
          <p className="mt-2 text-base sm:text-lg text-gray-600">{L.intro}</p>
          {!filtered && ready && result.total >= 3 && (
            <p className="mt-3 text-sm font-semibold text-brand-navy tabular" data-testid="listings-total">{annonces(result.total)} en ligne</p>
          )}
          {heading && ready && result.total > 0 && (
            <p className="mt-3 text-sm font-semibold text-brand-navy tabular" data-testid="listings-search-total">{annonces(result.total)}</p>
          )}
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 min-w-0">
        <div className="lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-8 min-w-0">
          <div className="hidden lg:block min-w-0">
            <div className="space-y-5">
              <div className="card p-5">
                <div className="flex items-center justify-between gap-2 mb-4">
                  <h2 className="font-display text-lg font-bold text-brand-navy">{L.filtersTitle}</h2>
                  {filtered && (
                    <button type="button" onClick={reset} className="btn-link text-sm" data-testid="filters-reset">{L.reset}</button>
                  )}
                </div>
                <ListingFilters value={filters} onChange={go} labels={L} idPrefix="filtres" />
              </div>
              {canSell(user) && <SellerCallout to={sellTo} onClick={onSellerCta} />}
            </div>
          </div>

          <div className="min-w-0 scroll-mt-4" ref={resultsRef} id="resultats">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => setPanelOpen(true)}
                  className={`${BTN_SECONDARY} lg:hidden py-2.5 px-4 text-sm`}
                  aria-haspopup="dialog"
                  data-testid="mobile-filters-btn"
                >
                  <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
                  {L.filtersTitle}{count > 0 ? ` (${count})` : ''}
                </button>
                <p className={`text-sm font-semibold text-brand-navy tabular ${heading ? 'sr-only' : ''}`} aria-live="polite" data-testid="results-count">
                  {ready && filtered && result.total > 0 ? annonces(result.total) : ''}
                </p>
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <label htmlFor={sortId} className="text-sm text-gray-600 whitespace-nowrap">{L.sortLabel}</label>
                <select
                  id={sortId}
                  value={filters.tri}
                  onChange={(e) => go({ ...filters, tri: e.target.value, page: 1 })}
                  className="rounded-xl border border-brand-line bg-white px-3 py-2 text-sm text-brand-navy focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
                  data-testid="sort-select"
                >
                  {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
            </div>

            {chips.length > 0 && (
              <ul className="flex flex-wrap items-center gap-2 mb-5" aria-label="Filtres actifs" data-testid="active-filters">
                {chips.map((c) => (
                  <li key={c.key} className="max-w-full">
                    <button
                      type="button"
                      onClick={() => go({ ...c.remove(filters), page: 1 })}
                      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-brand-line bg-white pl-3 pr-2 py-1 text-sm text-brand-navy hover:border-brand-navy/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
                      aria-label={`Retirer le filtre ${c.label}`}
                    >
                      <span className="truncate">{c.label}</span>
                      <X className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    </button>
                  </li>
                ))}
                {/* État vide : « Effacer les filtres » est déjà le bouton principal du message, pas de doublon ici */}
                {!(ready && items.length === 0) && (
                  <li>
                    <button type="button" onClick={reset} className="btn-link text-sm px-1">{L.reset}</button>
                  </li>
                )}
              </ul>
            )}

            {result.status === 'loading' && (
              <div role="status" aria-label="Chargement des annonces">
                <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: 6 }, (_, i) => <CardSkeleton key={i} />)}
                </ul>
              </div>
            )}

            {result.status === 'error' && (
              <div className="card p-6 sm:p-8" role="alert" data-testid="listings-error">
                <h2 className="font-display text-xl font-bold text-brand-navy">{L.errorTitle}</h2>
                <p className="text-gray-600 mt-2">{L.errorText}</p>
                <button type="button" onClick={() => setAttempt((n) => n + 1)} className={`${BTN_SECONDARY} mt-4 px-4 py-2.5 text-sm`}>
                  <RotateCcw className="w-4 h-4" aria-hidden="true" />{L.retry}
                </button>
              </div>
            )}

            {ready && items.length === 0 && (
              <div className="space-y-5" data-testid="listings-empty">
                <div className="card p-6 sm:p-8">
                  <h2 className="font-display text-xl sm:text-2xl font-bold text-brand-navy">{L.emptyTitle}</h2>
                  <p className="text-gray-600 mt-2 leading-relaxed max-w-2xl">{L.emptyText}</p>
                  {filtered && (
                    <button type="button" onClick={reset} className={`${BTN_SECONDARY} mt-5 px-4 py-2.5 text-sm`} data-testid="empty-reset">{L.reset}</button>
                  )}
                </div>
                <div id="alerte" className="scroll-mt-4">
                  <AlertForm key={alertKey} source="listings_empty" {...alertProps} />
                </div>
              </div>
            )}

            {ready && items.length > 0 && (
              <>
                <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3" data-testid="listings-grid">
                  {items.map((c) => (
                    <li key={c.id} className="min-w-0 flex">
                      <ListingCard
                        company={c}
                        source="listings"
                        className="w-full"
                        favorite={favorites.has(c.id)}
                        onToggleFavorite={canFavorite ? toggleFavorite : undefined}
                      />
                    </li>
                  ))}
                </ul>
                {pages > 1 && <Pagination page={Math.min(filters.page, pages)} pages={pages} hrefFor={hrefFor} />}
                <div id="alerte" className="mt-10 max-w-3xl scroll-mt-4">
                  <AlertForm key={alertKey} compact source="listings" {...alertProps} />
                </div>
              </>
            )}

            {canSell(user) && <SellerCallout to={sellTo} onClick={onSellerCta} className="mt-8 lg:hidden" />}
          </div>
        </div>
      </div>

      <MobileFilters open={panelOpen} initial={filters} onClose={() => setPanelOpen(false)} onApply={(next) => { setPanelOpen(false); go({ ...next, page: 1 }, { push: true }); }} />
    </AppLayout>
  );
};

export default ListingsPage;
