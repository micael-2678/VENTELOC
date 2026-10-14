import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertCircle, AlertTriangle, BadgeCheck, Building2, CalendarClock, Check, Euro, FileSignature, FolderLock, Heart, Home, Info,
  KeyRound, Leaf, Loader2, Lock, MapPin, MessageSquare, Send, Share2, ShieldCheck, X,
} from 'lucide-react';
import { axiosInstance } from '@/App';
import AppHeader from '@/components/layout/AppHeader';
import AppFooter from '@/components/layout/AppFooter';
import { listingsPath, LISTINGS_PATH } from '@/components/shared/listingFilters';
import NotFound from '@/pages/NotFound';
import {
  AlertForm, listingTitle, listingLocation, listingPath, listingYields, ownershipVerified, dpeAlert, annualRent, DpePill, DpeScale,
  PropertyPicto, PROPERTY_TYPE_PLURALS, formatPrice, formatDateFr, formatYield, formatMonthly, formatSurface, plural,
} from '@/components/shared';
import { PROJECT_TYPES, FINANCING, HORIZONS } from '@/components/shared/BuyerCard';
import { apiErrorCode, apiErrorMessage, isEmailNotVerifiedError } from '@/components/account/errors';
import { useSeo, SITE_URL, NOINDEX } from '@/lib/seo';
import { BRAND, LEGAL } from '@/lib/brand';
import { OFFER, formatEuros, formatPercent, listingCommission } from '@/lib/offer';
import { useCommission } from '@/lib/useCommission';
import { breadcrumbLd } from '@/seo/schema';
import { trackEvent } from '@/lib/analytics';
import {
  propertyTypeLabel, leaseTypeLabel, tenantPaymentLabel, saleObjectLabel, saleReasonLabel, ownerTypeLabel, isHousingLease,
  inRegion,
} from '@/lib/referentiels';

// Fiche d'un bien loué (docs/venteloc/SPEC.md §5.1, API.md §2) : galerie, chiffres clés (prix, loyer, rendements, charges,
// taxe foncière, dépôt de garantie), le bien (copropriété avec les mentions obligatoires), la location, le DPE (coût
// énergétique, alerte de décence énergétique), la vente, les honoraires (à la charge du vendeur, prix honoraires inclus),
// « Ce que vérifie VenteLoc », « Comment ça se passe », visites. Jamais l'adresse exacte, le nom du vendeur ni la
// dénomination de la société avant l'engagement de confidentialité. CTA « Présenter mon projet au vendeur »
// (POST /properties/{id}/contact {message} → messagerie) ; favori visiteur → inscription ; alerte sans compte.

const INDEXATION_LABELS = {
  irl: 'IRL (indice de référence des loyers)',
  ilc: 'ILC (indice des loyers commerciaux)',
  ilat: 'ILAT (indice des loyers des activités tertiaires)',
  aucune: 'Aucune clause d\'indexation',
};
const MANAGEMENT_LABELS = {
  direct: 'Gestion par le propriétaire',
  agence: 'Gestion confiée à une agence',
  exploitant: 'Exploitant de la résidence',
};

const hasValue = (v) => v !== null && v !== undefined && v !== '' && !(typeof v === 'number' && Number.isNaN(v));
const positive = (v) => hasValue(v) && Number(v) > 0;
const yesNo = (v) => (v === true ? 'Oui' : v === false ? 'Non' : '');
const floorLabel = (v) => {
  if (!hasValue(v)) return '';
  const n = Number(v);
  if (n === 0) return 'Rez-de-chaussée';
  if (n === 1) return '1er étage';
  return `${n}e étage`;
};

// Message de présentation prérempli depuis le profil d'investissement de l'acquéreur
export const draftMessage = (user) => {
  const p = user?.buyer_profile || {};
  const lines = ['Bonjour,', ''];
  lines.push('Votre bien correspond à mon projet d\'investissement locatif.');
  const details = [];
  if (p.project_type && PROJECT_TYPES[p.project_type]) details.push(PROJECT_TYPES[p.project_type].toLowerCase());
  if (positive(p.budget_max)) details.push(`budget jusqu'à ${formatEuros(p.budget_max)}`);
  if (p.financing && FINANCING[p.financing]) details.push(`financement : ${FINANCING[p.financing].toLowerCase()}`);
  if (positive(p.min_yield)) details.push(`rendement brut visé : ${formatPercent(p.min_yield)} minimum`);
  if (p.horizon && HORIZONS[p.horizon]) details.push(`horizon : ${HORIZONS[p.horizon].toLowerCase()}`);
  if (details.length) lines.push(`En quelques mots : ${details.join(' ; ')}.`);
  if (p.experience) lines.push(String(p.experience));
  lines.push('', 'Je souhaiterais recevoir le dossier du bien (bail, quittances, diagnostics, charges) pour étudier l\'acquisition.', '', 'Cordialement');
  return lines.join('\n');
};

// Ligne d'une liste de caractéristiques (affichée seulement si renseignée)
const Fact = ({ label, children, testId, wide = false }) => (
  <div className={`min-w-0 ${wide ? 'sm:col-span-2' : ''}`}>
    <dt className="text-xs text-gray-500">{label}</dt>
    <dd className="text-sm text-brand-navy font-medium break-words tabular" data-testid={testId}>{children}</dd>
  </div>
);

const Section = ({ id, title, icon: Icon, children }) => (
  <section className="card p-5 sm:p-6 min-w-0" aria-labelledby={`${id}-title`} data-testid={`section-${id}`}>
    <h2 id={`${id}-title`} className="font-display text-lg sm:text-xl font-bold text-brand-navy flex items-center gap-2 mb-4">
      {Icon && <Icon className="w-5 h-5 text-brand-teal shrink-0" aria-hidden="true" />}
      {title}
    </h2>
    {children}
  </section>
);

const KeyFigure = ({ label, value, note, tone = 'plain', testId }) => (
  <div className={`rounded-xl border p-3 sm:p-4 min-w-0 ${tone === 'teal' ? 'bg-brand-teal-soft border-brand-teal-line/70' : 'bg-brand-surface border-brand-line'}`}>
    <p className={`text-xs font-medium ${tone === 'teal' ? 'text-brand-teal-dark' : 'text-gray-600'}`}>{label}</p>
    <p className={`font-display text-xl sm:text-2xl font-extrabold tabular leading-tight break-words ${tone === 'teal' ? 'text-brand-teal-dark' : 'text-brand-navy'}`} data-testid={testId}>{value}</p>
    {note && <p className="text-xs text-gray-600 mt-0.5">{note}</p>}
  </div>
);

// Galerie : photos visibles par ce visiteur (publiques, ou réservées après l'engagement de confidentialité)
const Gallery = ({ property }) => {
  const [photos, setPhotos] = useState([]);
  const [srcs, setSrcs] = useState({});
  const [current, setCurrent] = useState(0);
  const id = property.id;

  useEffect(() => {
    let alive = true;
    Promise.resolve()
      .then(() => axiosInstance.get(`/properties/${id}/photos`, { skipAuthRedirect: true }))
      .then((res) => { if (alive) setPhotos(Array.isArray(res?.data) ? res.data.filter((p) => p && p.id) : []); })
      .catch(() => { if (alive) setPhotos([]); });
    return () => { alive = false; };
  }, [id]);

  useEffect(() => {
    let alive = true;
    photos.forEach((photo) => {
      if (srcs[photo.id]) return;
      if (photo.url) { setSrcs((s) => ({ ...s, [photo.id]: photo.url })); return; }
      axiosInstance.get(`/properties/${id}/photos/${photo.id}`, { skipAuthRedirect: true })
        .then((r) => {
          const { content, content_type: type } = r?.data || {};
          if (alive && content) setSrcs((s) => ({ ...s, [photo.id]: `data:${type || 'image/jpeg'};base64,${content}` }));
        })
        .catch(() => {});
    });
    return () => { alive = false; };
  }, [photos, id]);

  const shown = photos.filter((p) => srcs[p.id]);
  if (!shown.length) {
    return <PropertyPicto type={property.property_type} className="aspect-[16/7] rounded-2xl border border-brand-line" iconClassName="w-16 h-16" />;
  }
  const active = shown[Math.min(current, shown.length - 1)];
  return (
    <div className="min-w-0" data-testid="gallery">
      <div className="relative aspect-[16/9] rounded-2xl overflow-hidden bg-brand-surface border border-brand-line">
        <img src={srcs[active.id]} alt={`${propertyTypeLabel(property.property_type) || 'Bien loué'}, vue ${shown.indexOf(active) + 1} sur ${shown.length}`} className="w-full h-full object-cover" />
      </div>
      {shown.length > 1 && (
        <ul className="mt-2 flex gap-2 overflow-x-auto pb-1" aria-label="Photos">
          {shown.map((p, i) => (
            <li key={p.id} className="shrink-0">
              <button
                type="button"
                onClick={() => setCurrent(i)}
                aria-label={`Afficher la photo ${i + 1}`}
                aria-current={p.id === active.id ? 'true' : undefined}
                className={`block w-20 h-14 rounded-lg overflow-hidden border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal ${p.id === active.id ? 'border-brand-teal' : 'border-transparent'}`}
              >
                <img src={srcs[p.id]} alt="" className="w-full h-full object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const PropertyDetail = ({ user }) => {
  const { id } = useParams();
  const navigate = useNavigate();
  const commission = useCommission();
  const [property, setProperty] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [favoriteLoading, setFavoriteLoading] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [contactLoading, setContactLoading] = useState(false);
  const [contactError, setContactError] = useState(null); // { kind: 'profile'|'email'|'text', text }

  const isBuyer = user?.role === 'buyer';
  const isOwner = Boolean(user && property && (user.role === 'admin' || (property.seller_id && property.seller_id === user.id)));
  const canContact = !isOwner && user?.role !== 'seller' && user?.role !== 'admin';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axiosInstance.get(`/properties/${id}`);
      setProperty(res.data);
      setNotFound(false);
    } catch (error) {
      setProperty(null);
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!isBuyer) return;
    axiosInstance.get(`/favorites/check/${id}`).then((r) => setIsFavorite(Boolean(r.data?.favorited))).catch(() => {});
  }, [id, isBuyer]);

  const title = property ? listingTitle(property) : '';
  const path = listingPath(id);
  const yields = property ? listingYields(property) : { gross: null, net: null };
  const typePlural = property ? PROPERTY_TYPE_PLURALS[property.property_type] : '';
  const seoCrumbs = [
    { name: 'Biens à vendre', path: LISTINGS_PATH },
    { name: 'Annonce', path },
  ];
  const seoDescription = property
    ? [
      `${title}${property.region ? ` ${inRegion(property.region)}` : ''}`,
      positive(property.rent_monthly) ? `loyer ${formatMonthly(property.rent_monthly)} hors charges` : '',
      yields.gross ? `rendement brut ${formatYield(yields.gross)}` : '',
      positive(property.asking_price) ? `prix ${formatPrice(property.asking_price)} honoraires inclus` : '',
    ].filter(Boolean).join(', ') + `. ${OFFER.metaMatching}`
    : `Bien immobilier loué à vendre. ${OFFER.metaMatching}`;
  useSeo(
    property ? `${title} | ${BRAND.name}` : notFound ? `Annonce introuvable | ${BRAND.name}` : `Bien loué à vendre | ${BRAND.name}`,
    seoDescription,
    // Annonce fictive du mode test : jamais indexée
    notFound || property?.is_test === true ? { robots: NOINDEX }
      : property ? { path, jsonLd: breadcrumbLd(SITE_URL, seoCrumbs) } : {},
  );

  const toggleFavorite = async () => {
    if (!user) {
      navigate(`/register?role=buyer&redirect=${encodeURIComponent(path)}`);
      return;
    }
    if (!isBuyer || favoriteLoading) return;
    setFavoriteLoading(true);
    try {
      if (isFavorite) {
        await axiosInstance.delete(`/favorites/${id}`);
        setIsFavorite(false);
        toast.success('Retiré de vos favoris');
      } else {
        await axiosInstance.post('/favorites', { property_id: id });
        setIsFavorite(true);
        toast.success('Ajouté à vos favoris');
      }
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Le favori n\'a pas pu être enregistré.'));
    } finally {
      setFavoriteLoading(false);
    }
  };

  const share = async () => {
    const url = `${SITE_URL}${path}`;
    try {
      if (navigator.share) {
        await navigator.share({ title, text: `${title} — bien loué à vendre sur ${BRAND.name}`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast.success('Lien de l\'annonce copié. Il ne révèle ni l\'adresse du bien ni l\'identité du vendeur.');
    } catch (e) {
      // partage annulé ou presse-papiers indisponible
    }
  };

  const openContact = () => {
    if (!user) {
      navigate(`/login?redirect=${encodeURIComponent(path)}`);
      return;
    }
    if (!isBuyer) return;
    setContactError(null);
    setMessage((m) => m || draftMessage(user));
    setContactOpen(true);
  };

  const sendContact = async () => {
    const text = message.trim();
    if (text.length < 20) {
      setContactError({ kind: 'text', text: 'Présentez votre projet en quelques phrases (20 caractères au minimum).' });
      return;
    }
    setContactLoading(true);
    setContactError(null);
    try {
      const res = await axiosInstance.post(`/properties/${id}/contact`, { message: text });
      const data = res.data || {};
      if (data.already_contacted) toast.info('Vous avez déjà présenté votre projet au vendeur : retrouvez la conversation dans votre messagerie.');
      else {
        toast.success('Projet transmis au vendeur. Il reçoit votre carte acquéreur et votre message par e-mail.', { duration: 7000 });
        trackEvent('contact_sent', { source: 'fiche', listing: String(id) });
      }
      setContactOpen(false);
      navigate(`/messages?conversation=${encodeURIComponent(data.conversation_id || id)}`);
    } catch (error) {
      if (isEmailNotVerifiedError(error)) setContactError({ kind: 'email', text: 'Confirmez d\'abord votre adresse e-mail : un lien vous a été envoyé (bandeau en haut de page).' });
      else if (error?.response?.status === 403 && apiErrorCode(error) === 'profile_incomplete') setContactError({ kind: 'profile', text: apiErrorMessage(error, 'Votre profil d\'investissement est incomplet : 40 % sont nécessaires pour contacter un vendeur.') });
      else setContactError({ kind: 'text', text: apiErrorMessage(error, 'Le message n\'a pas pu être envoyé. Réessayez dans quelques instants.') });
    } finally {
      setContactLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen" role="status" aria-label="Chargement">
        <div className="spinner" />
      </div>
    );
  }
  if (!property) return notFound ? <NotFound user={user} /> : null;

  const c = property;
  const housing = isHousingLease(c.lease_type);
  const verified = ownershipVerified(c);
  const alert = dpeAlert(c);
  const fees = listingCommission(c, commission);
  const location = listingLocation(c, { district: true });
  const yearly = annualRent(c);
  const surface = formatSurface(c.surface);
  const revealed = !isOwner && (c.address || c.company_name);
  const ownershipStatus = c.ownership?.status || (c.property_checks?.ownership_verified ? 'verified' : '');
  const unpaid = c.tenant_payment_status === 'impayes';
  const dpeLetter = /^[A-G]$/i.test(String(c.dpe_class || ''));
  const gesLetter = /^[A-G]$/i.test(String(c.ges_class || ''));

  const howSteps = [
    { title: 'Vous présentez votre projet', text: 'Sans frais, par la messagerie. Le vendeur reçoit votre carte acquéreur (budget, apport, financement, rendement visé) et vous répond.' },
    { title: 'Le dossier s\'ouvre après l\'engagement de confidentialité', text: 'Identité vérifiée, engagement de confidentialité et de non-contournement signé par code, origine des fonds déclarée : l\'adresse, le vendeur et les documents vous sont révélés.' },
    { title: 'Vous faites une offre d\'achat', text: 'Prix, financement, condition de prêt : signée en ligne, contresignée par le vendeur s\'il l\'accepte. Elle n\'emporte pas vente.' },
    { title: 'Compromis et acte chez le notaire', text: 'Le notaire rédige l\'avant-contrat et l\'acte authentique. Le bail continue : vous devenez bailleur à la signature.' },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-brand-surface">
      <AppHeader user={user} />

      <main id="contenu" className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 min-w-0">
        <nav aria-label="Fil d'Ariane" className="text-sm text-gray-600 mb-4 min-w-0">
          <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <li><Link to={LISTINGS_PATH} className="hover:underline">Biens à vendre</Link></li>
            {typePlural && (<><li aria-hidden="true">›</li><li><Link to={listingsPath({ types: [c.property_type] })} className="hover:underline">{typePlural}</Link></li></>)}
            <li aria-hidden="true">›</li>
            <li aria-current="page" className="text-brand-navy">Annonce</li>
          </ol>
        </nav>

        <div className="grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-6 min-w-0">
          <div className="space-y-6 min-w-0">
            <Gallery property={c} />

            {/* En-tête : badges, titre, localisation, chiffres clés, actions */}
            <header className="card p-5 sm:p-6 min-w-0" data-testid="property-header">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                {verified && (
                  <span className="badge badge-verified" data-testid="ownership-badge">
                    <BadgeCheck className="w-3.5 h-3.5" aria-hidden="true" />Propriétaire vérifié
                  </span>
                )}
                {c.lease_type && <span className="badge badge-declared">{leaseTypeLabel(c.lease_type, true)}</span>}
                {c.dpe_class && <DpePill value={c.dpe_class} size="sm" withLabel />}
                {c.is_test === true && <span className="badge badge-warning" data-testid="test-listing-badge">Annonce de test (fictive)</span>}
                {c.published_at && <time dateTime={c.published_at} className="text-xs text-gray-500">Publiée le {formatDateFr(c.published_at)}</time>}
              </div>
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-brand-navy tracking-tight break-words">{title}</h1>
              {location && (
                <p className="mt-2 flex items-center gap-1 text-sm text-gray-600 min-w-0">
                  <MapPin className="w-4 h-4 shrink-0" aria-hidden="true" /><span className="sr-only">Localisation : </span>
                  <span className="break-words">{location}</span>
                </p>
              )}
              {revealed && (
                <div className="mt-3 rounded-xl border border-brand-green/30 bg-brand-green-soft px-3 py-2 text-sm text-brand-green-dark" data-testid="revealed-identity">
                  <p className="flex items-start gap-2"><Lock className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" /><span>Révélé après votre engagement de confidentialité :
                    {c.address && <> adresse <strong>{c.address}{c.postal_code ? `, ${c.postal_code}` : ''} {c.city || ''}</strong></>}
                    {c.company_name && <>{c.address ? ' ; ' : ' '}propriétaire <strong>{c.company_name}</strong></>}.</span></p>
                </div>
              )}

              <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
                <KeyFigure label="Prix" value={formatPrice(c.asking_price)} note="honoraires inclus" testId="asking-price" />
                <KeyFigure label="Loyer HC" value={positive(c.rent_monthly) ? formatMonthly(c.rent_monthly) : '—'} note={positive(c.charges_monthly) ? `+ ${formatPrice(c.charges_monthly)} de charges` : 'hors charges'} testId="rent-monthly" />
                <KeyFigure label="Rendement brut" value={formatYield(yields.gross) || '—'} tone="teal" note="loyers HC ÷ prix" testId="gross-yield" />
                <KeyFigure label="Rendement net" value={formatYield(yields.net) || '—'} note={yields.net ? 'après taxe foncière et charges' : 'charges non renseignées'} testId="net-yield" />
              </div>

              {alert && (
                <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-brand-amber-soft px-4 py-3 text-sm text-brand-amber" role="note" data-testid="dpe-alert">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                  <span>{alert.text}</span>
                </div>
              )}

              <div className="mt-5 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap pt-4 border-t border-brand-line" data-testid="property-actions">
                {canContact && (
                  <button type="button" onClick={openContact} className="btn-primary col-span-2 sm:col-auto px-5 py-3 text-sm" data-testid="contact-seller-btn">
                    <MessageSquare className="w-4 h-4" aria-hidden="true" />
                    Présenter mon projet au vendeur
                  </button>
                )}
                {canContact && (
                  <button
                    type="button"
                    onClick={toggleFavorite}
                    disabled={favoriteLoading}
                    aria-pressed={isFavorite}
                    className={`btn-secondary w-full sm:w-auto px-4 py-3 text-sm ${isFavorite ? 'border-red-600 text-red-700' : ''}`}
                    data-testid="favorite-btn"
                  >
                    <Heart className={`w-4 h-4 ${isFavorite ? 'fill-current' : ''}`} aria-hidden="true" />
                    {isFavorite ? 'Dans mes favoris' : 'Ajouter aux favoris'}
                  </button>
                )}
                {isBuyer && (
                  <Link to={`/dataroom/${id}`} className="btn-secondary w-full sm:w-auto px-4 py-3 text-sm" data-testid="dataroom-link">
                    <FolderLock className="w-4 h-4" aria-hidden="true" />
                    Dossier du bien
                  </Link>
                )}
                <button type="button" onClick={share} className="btn-secondary w-full sm:w-auto px-4 py-3 text-sm" data-testid="share-btn">
                  <Share2 className="w-4 h-4" aria-hidden="true" />
                  Partager
                </button>
              </div>
              {isOwner && <p className="mt-3 text-sm text-gray-600">Vous voyez votre annonce telle que les acquéreurs la voient, adresse et identité exclues. <Link to="/seller/dashboard" className="btn-link text-sm">Mon espace</Link></p>}
            </header>

            {/* Chiffres clés */}
            <Section id="chiffres" title="Chiffres clés" icon={Euro}>
              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4">
                <Fact label="Prix de vente (honoraires inclus)" testId="fact-price">{formatPrice(c.asking_price)}</Fact>
                {positive(c.rent_monthly) && <Fact label="Loyer mensuel hors charges">{formatMonthly(c.rent_monthly)}</Fact>}
                {yearly && <Fact label="Loyers annuels hors charges">{formatPrice(yearly)}</Fact>}
                {positive(c.charges_monthly) && <Fact label="Provisions sur charges récupérables">{formatMonthly(c.charges_monthly)}</Fact>}
                {yields.gross && <Fact label="Rendement brut">{formatYield(yields.gross)}</Fact>}
                {yields.net && <Fact label="Rendement net de charges">{formatYield(yields.net)}</Fact>}
                {hasValue(c.property_tax) && <Fact label="Taxe foncière annuelle">{formatPrice(c.property_tax)}</Fact>}
                {hasValue(c.non_recoverable_charges) && <Fact label="Charges annuelles non récupérables">{formatPrice(c.non_recoverable_charges)}</Fact>}
                {hasValue(c.deposit) && <Fact label="Dépôt de garantie" testId="fact-deposit">{formatPrice(c.deposit)}</Fact>}
              </dl>
              <p className="mt-4 text-xs text-gray-600 leading-relaxed">
                Rendement brut : loyers annuels hors charges rapportés au prix. Rendement net : après taxe foncière et charges non récupérables
                (copropriété, assurance, gestion), avant impôts et frais d'acquisition. Montants déclarés par le vendeur ; bail, quittances et avis de
                taxe foncière sont dans le dossier du bien.
              </p>
            </Section>

            {/* Le bien */}
            <Section id="bien" title="Le bien" icon={Home}>
              {c.description ? <p className="text-gray-800 leading-relaxed whitespace-pre-line break-words mb-5" data-testid="description">{c.description}</p> : null}
              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4">
                {c.property_type && <Fact label="Type de bien">{propertyTypeLabel(c.property_type)}</Fact>}
                {surface && <Fact label="Surface" testId="fact-surface">{surface}</Fact>}
                {positive(c.rooms) && <Fact label="Pièces">{plural(Number(c.rooms), 'pièce')}</Fact>}
                {hasValue(c.floor) && <Fact label="Étage">{floorLabel(c.floor)}</Fact>}
                {yesNo(c.elevator) && <Fact label="Ascenseur">{yesNo(c.elevator)}</Fact>}
                {positive(c.construction_year) && <Fact label="Année de construction">{c.construction_year}</Fact>}
                {positive(c.units_count) && <Fact label="Lots">{plural(Number(c.units_count), 'lot')}{positive(c.units_rented) ? `, dont ${c.units_rented} loué${Number(c.units_rented) > 1 ? 's' : ''}` : ''}</Fact>}
                {c.district && <Fact label="Quartier">{c.district}</Fact>}
                {c.owner_type && <Fact label="Propriétaire">{ownerTypeLabel(c.owner_type)}</Fact>}
                {c.equipment && <Fact label="Équipements et annexes" wide>{c.equipment}</Fact>}
                {c.recent_works && <Fact label="Travaux récents" wide>{c.recent_works}</Fact>}
              </dl>

              {(c.is_copro === true || c.is_copro === false) && (
                <div className="mt-5 rounded-xl border border-brand-line bg-brand-surface p-4 min-w-0" data-testid="copro">
                  <h3 className="font-semibold text-brand-navy mb-2 flex items-center gap-2"><Building2 className="w-4 h-4 text-gray-500" aria-hidden="true" />Copropriété</h3>
                  {c.is_copro ? (
                    <ul className="space-y-1 text-sm text-gray-800">
                      <li>Bien soumis au statut de la copropriété{positive(c.copro_lots) ? ` : ${plural(Number(c.copro_lots), 'lot')} dans la copropriété` : ''}.</li>
                      {hasValue(c.copro_charges_annual) && <li>Quote-part annuelle moyenne des charges courantes (budget prévisionnel) : <strong className="tabular">{formatPrice(c.copro_charges_annual)}</strong> par an.</li>}
                      <li data-testid="copro-procedure">
                        {c.copro_procedure === true
                          ? 'Procédure en cours à l\'encontre du syndicat des copropriétaires (art. 29-1 A ou 29-1 de la loi du 10 juillet 1965).'
                          : c.copro_procedure === false
                            ? 'Aucune procédure en cours à l\'encontre du syndicat des copropriétaires (art. 29-1 A et 29-1 de la loi du 10 juillet 1965).'
                            : 'Procédure à l\'encontre du syndicat des copropriétaires : non renseigné.'}
                      </li>
                    </ul>
                  ) : (
                    <p className="text-sm text-gray-800">Bien non soumis au statut de la copropriété.</p>
                  )}
                </div>
              )}
            </Section>

            {/* La location */}
            <Section id="location" title="La location" icon={KeyRound}>
              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4">
                {c.lease_type && <Fact label="Bail" wide>{leaseTypeLabel(c.lease_type)}</Fact>}
                {c.lease_start && <Fact label="Début du bail en cours">{formatDateFr(c.lease_start)}</Fact>}
                {c.lease_end && <Fact label="Prochaine échéance">{formatDateFr(c.lease_end)}</Fact>}
                {c.tenant_since && <Fact label="Locataire en place depuis">{formatDateFr(c.tenant_since, { month: 'long', year: 'numeric' })}</Fact>}
                {hasValue(c.deposit) && <Fact label="Dépôt de garantie">{formatPrice(c.deposit)}</Fact>}
                {c.indexation && <Fact label="Révision du loyer">{INDEXATION_LABELS[c.indexation] || c.indexation}</Fact>}
                {c.last_revision && <Fact label="Dernière révision">{formatDateFr(c.last_revision)}</Fact>}
                {c.management && <Fact label="Gestion">{MANAGEMENT_LABELS[c.management] || c.management}</Fact>}
                {c.operator_lease_end && <Fact label="Fin du bail de l'exploitant">{formatDateFr(c.operator_lease_end)}</Fact>}
                {yesNo(c.has_gli) && <Fact label="Garantie loyers impayés">{yesNo(c.has_gli)}</Fact>}
                {yesNo(c.has_guarantor) && <Fact label="Caution du locataire">{yesNo(c.has_guarantor)}</Fact>}
              </dl>
              {c.tenant_payment_status && (
                <p className={`mt-4 flex items-start gap-2 rounded-xl px-4 py-3 text-sm ${unpaid ? 'border border-amber-200 bg-brand-amber-soft text-brand-amber' : 'border border-brand-line bg-brand-surface text-gray-800'}`} data-testid="tenant-payment">
                  {unpaid ? <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" /> : <Info className="w-4 h-4 mt-0.5 shrink-0 text-gray-500" aria-hidden="true" />}
                  <span>Situation déclarée du locataire sur les 12 derniers mois : <strong>{tenantPaymentLabel(c.tenant_payment_status)}</strong>. Le relevé des loyers est dans le dossier du bien.</span>
                </p>
              )}
              <p className="mt-4 text-sm text-gray-700 leading-relaxed">
                Le bail continue avec le nouveau propriétaire : le locataire reste en place et vous percevez les loyers dès la signature de l'acte.
                {housing ? ' Le dépôt de garantie est réglé entre vendeur et acquéreur chez le notaire.' : ''}
              </p>
              <p className="mt-2 text-sm text-gray-700 leading-relaxed" data-testid="visits">
                Visites : après l'engagement de confidentialité, organisées par le vendeur avec l'accord du locataire (2 heures maximum par jour ouvrable, art. 4 de la loi du 6 juillet 1989).
              </p>
            </Section>

            {/* Performance énergétique */}
            <Section id="dpe" title="Performance énergétique" icon={Leaf}>
              {dpeLetter ? (
                <div className="grid sm:grid-cols-2 gap-5 min-w-0">
                  <DpeScale value={c.dpe_class} caption={c.dpe_date ? `Diagnostic de performance énergétique réalisé le ${formatDateFr(c.dpe_date)}.` : 'Diagnostic de performance énergétique (DPE).'} />
                  <dl className="space-y-4">
                    <Fact label="Classe énergie">Classe {String(c.dpe_class).toUpperCase()}</Fact>
                    {gesLetter && <Fact label="Émissions de gaz à effet de serre"><DpePill value={c.ges_class} size="sm" kind="GES" withLabel /></Fact>}
                    {(positive(c.energy_cost_min) || positive(c.energy_cost_max)) && (
                      <Fact label="Dépenses annuelles d'énergie estimées" testId="energy-cost">
                        {positive(c.energy_cost_min) && positive(c.energy_cost_max)
                          ? `Entre ${formatPrice(c.energy_cost_min)} et ${formatPrice(c.energy_cost_max)} par an`
                          : `${formatPrice(c.energy_cost_min || c.energy_cost_max)} par an`}
                      </Fact>
                    )}
                  </dl>
                </div>
              ) : (
                <p className="text-sm text-gray-800" data-testid="dpe-other">{c.dpe_class === 'vierge' ? 'DPE vierge (consommations non disponibles).' : c.dpe_class === 'non-soumis' ? 'Bien non soumis au diagnostic de performance énergétique.' : 'Diagnostic de performance énergétique non renseigné.'}</p>
              )}
              {(positive(c.energy_cost_min) || positive(c.energy_cost_max)) && dpeLetter && (
                <p className="mt-3 text-xs text-gray-600">Montant estimé des dépenses annuelles d'énergie pour un usage standard, prix de l'énergie de l'année de référence du diagnostic.</p>
              )}
              {alert && (
                <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-brand-amber-soft px-4 py-3 text-sm text-brand-amber">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                  <span>{alert.text}</span>
                </p>
              )}
            </Section>

            {/* La vente */}
            <Section id="vente" title="La vente" icon={FileSignature}>
              <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-4">
                <Fact label="Prix de vente">{formatPrice(c.asking_price)} honoraires inclus</Fact>
                {c.sale_object && <Fact label="Objet de la vente">{saleObjectLabel(c.sale_object)}</Fact>}
                {c.sale_reason && <Fact label="Motif de la vente">{saleReasonLabel(c.sale_reason)}</Fact>}
                {c.availability_note && <Fact label="Disponibilité" wide>{c.availability_note}</Fact>}
              </dl>
              <div className="mt-5 rounded-xl border border-brand-line bg-brand-surface p-4 text-sm text-gray-800 leading-relaxed" data-testid="fees">
                <p className="font-semibold text-brand-navy mb-1">Honoraires</p>
                <p>
                  Honoraires de négociation à la charge du vendeur : <strong className="tabular">{formatEuros(fees.ttc)} TTC</strong> ({formatEuros(fees.ht)} HT),
                  soit {formatPercent(Number(c.asking_price) > 0 ? Math.round((fees.ttc / Number(c.asking_price)) * 10000) / 100 : fees.ratePercentTTC)} TTC du prix affiché.
                  {Number(c.asking_price) > fees.ttc ? <> Prix hors honoraires : <span className="tabular">{formatEuros(Number(c.asking_price) - fees.ttc)}</span>.</> : null}
                </p>
                <p className="mt-1">{OFFER.payerSentence} Ils sont réglés par le notaire, uniquement à la signature de l'acte authentique.</p>
              </div>
            </Section>

            {/* Ce que vérifie la plateforme */}
            <Section id="verifications" title={`Ce que vérifie ${BRAND.name}`} icon={ShieldCheck}>
              <ul className="space-y-3 text-sm text-gray-800" data-testid="checks">
                <li className="flex items-start gap-2">
                  {ownershipStatus === 'verified'
                    ? <BadgeCheck className="w-5 h-5 shrink-0 text-brand-green" aria-hidden="true" />
                    : <Check className="w-5 h-5 shrink-0 text-gray-400" aria-hidden="true" />}
                  <span>
                    <strong>Justificatif de propriété</strong> (titre, attestation notariée, avis de taxe foncière ou statuts de la SCI) :{' '}
                    {ownershipStatus === 'verified' ? 'contrôlé par nos équipes.' : ownershipStatus === 'pending' ? 'déposé, en cours de contrôle.' : 'exigé avant toute publication.'}
                  </span>
                </li>
                <li className="flex items-start gap-2"><Check className="w-5 h-5 shrink-0 text-brand-teal" aria-hidden="true" /><span><strong>Identité du vendeur</strong> vérifiée sur pièce d'identité avant la signature du mandat de vente.</span></li>
                <li className="flex items-start gap-2"><Check className="w-5 h-5 shrink-0 text-brand-teal" aria-hidden="true" /><span><strong>Mandat de vente</strong> signé avec {LEGAL.denomination}, titulaire de la carte professionnelle T.</span></li>
                <li className="flex items-start gap-2"><Check className="w-5 h-5 shrink-0 text-brand-teal" aria-hidden="true" /><span><strong>Acquéreurs qualifiés</strong> : identité vérifiée, engagement de confidentialité et de non-contournement, origine des fonds déclarée avant l'accès au dossier.</span></li>
              </ul>
              <p className="mt-4 text-xs text-gray-600">Bail, loyers, charges, situation du locataire et diagnostics sont déclarés par le vendeur ; les pièces sont dans le dossier du bien et le notaire les vérifie avant l'acte.</p>
            </Section>
          </div>

          {/* Colonne latérale */}
          <aside className="space-y-6 min-w-0 lg:sticky lg:top-6 self-start">
            <section className="card p-5 sm:p-6 min-w-0" aria-labelledby="how-title" data-testid="how-it-works">
              <h2 id="how-title" className="font-display text-lg font-bold text-brand-navy mb-3">Comment ça se passe</h2>
              <ol className="space-y-3">
                {howSteps.map((s, i) => (
                  <li key={s.title} className="flex gap-3 min-w-0">
                    <span className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full bg-brand-teal text-white text-xs font-bold tabular" aria-hidden="true">{i + 1}</span>
                    <div className="min-w-0">
                      <p className="font-semibold text-brand-navy leading-snug">{s.title}</p>
                      <p className="text-sm text-gray-600 leading-relaxed">{s.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="mt-4 text-xs text-gray-600 leading-relaxed flex items-start gap-1.5"><Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />Adresse et identité du vendeur communiquées après l'engagement de confidentialité. {OFFER.buyerFreeShort}</p>
              {canContact && (
                <button type="button" onClick={openContact} className="btn-primary w-full mt-4 px-5 py-3 text-sm" data-testid="contact-seller-side-btn">
                  <MessageSquare className="w-4 h-4" aria-hidden="true" />
                  Présenter mon projet au vendeur
                </button>
              )}
              {!user && <p className="mt-2 text-xs text-gray-600 text-center">Inscription en 2 minutes, sans frais.</p>}
            </section>

            {c.lease_end && (
              <p className="flex items-start gap-2 text-sm text-gray-700 card p-4"><CalendarClock className="w-4 h-4 mt-0.5 shrink-0 text-gray-500" aria-hidden="true" />Prochaine échéance du bail : {formatDateFr(c.lease_end, { day: 'numeric', month: 'long', year: 'numeric' })}.</p>
            )}

            {!user && (
              <AlertForm
                source="fiche"
                compact
                defaultTypes={c.property_type ? [c.property_type] : []}
                defaultRegions={c.region ? [c.region] : []}
                title="Recevoir les biens similaires"
                intro="Une alerte e-mail, sans compte, sur le même type de bien et la même région."
              />
            )}
            {isBuyer && (
              <p className="text-sm text-gray-600">
                <Link to="/buyer/dashboard" className="btn-link text-sm">Gérer mes alertes</Link> pour recevoir les biens similaires.
              </p>
            )}
            <p className="text-sm">
              <Link to={LISTINGS_PATH} className="btn-link text-sm">Tous les biens loués à vendre</Link>
            </p>
          </aside>
        </div>
      </main>

      {contactOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="contact-title">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto p-5 sm:p-6 min-w-0" data-testid="contact-modal">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <h2 id="contact-title" className="font-display text-xl font-bold text-brand-navy">Présenter mon projet au vendeur</h2>
                <p className="text-sm text-gray-600 mt-1 break-words">{title}{positive(c.asking_price) ? ` · ${formatPrice(c.asking_price)}` : ''}</p>
              </div>
              <button type="button" onClick={() => setContactOpen(false)} className="shrink-0 rounded-lg p-2 text-gray-600 hover:bg-brand-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal" aria-label="Fermer">
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>
            <p className="text-sm text-gray-700 leading-relaxed mb-3">
              Le vendeur reçoit votre carte acquéreur (projet, budget, apport, financement, rendement visé, horizon) et ce message. Aucune coordonnée n'est transmise avant l'engagement de confidentialité. {OFFER.buyerFreeShort}
            </p>
            <label htmlFor="contact-message" className="block text-sm font-semibold text-brand-navy mb-1">Votre message</label>
            <textarea
              id="contact-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={9}
              maxLength={2000}
              className="w-full rounded-xl border border-brand-line px-4 py-3 text-sm text-brand-navy focus:border-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30"
              data-testid="contact-message"
            />
            <p className="text-xs text-gray-600 mt-1">Prérempli depuis votre profil d'investissement : adaptez-le à ce bien. Les coordonnées sont masquées avant l'engagement de confidentialité.</p>
            {contactError && (
              <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-red-800 bg-red-50 border border-red-200 rounded-xl px-4 py-3" data-testid="contact-error">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                <span>
                  {contactError.text}
                  {contactError.kind === 'profile' && <> <Link to="/profile" className="font-semibold underline underline-offset-2">Compléter mon profil</Link></>}
                </span>
              </p>
            )}
            <div className="flex flex-col sm:flex-row gap-2 mt-4 sm:justify-end">
              <button type="button" onClick={() => setContactOpen(false)} className="btn-secondary px-4 py-2.5 text-sm">Annuler</button>
              <button type="button" onClick={sendContact} disabled={contactLoading} className="btn-primary px-4 py-2.5 text-sm" data-testid="contact-send-btn">
                {contactLoading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Send className="w-4 h-4" aria-hidden="true" />}
                Envoyer au vendeur
              </button>
            </div>
          </div>
        </div>
      )}

      <AppFooter />
    </div>
  );
};

export default PropertyDetail;
