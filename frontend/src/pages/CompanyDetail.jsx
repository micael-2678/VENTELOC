import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertCircle, BadgeCheck, Building2, Calendar, Check, FileSignature, FolderLock, Heart, Loader2, Lock, MapPin,
  MessageSquare, Send, Share2, ShieldCheck, Users, Wrench, X,
} from 'lucide-react';
import { axiosInstance } from '@/App';
import AppHeader from '@/components/layout/AppHeader';
import AppFooter from '@/components/layout/AppFooter';
import { listingsPath, LISTINGS_PATH } from '@/components/shared/listingFilters';
import NotFound from '@/pages/NotFound';
import { AlertForm, listingTitle, qualificationBadge, formatPrice, formatDateFr, plural } from '@/components/shared';
import { PROJECT_TYPES, FINANCING, HORIZONS } from '@/components/shared/BuyerCard';
import { apiErrorMessage, isEmailNotVerifiedError } from '@/components/account/errors';
import { useSeo, SITE_URL, NOINDEX } from '@/lib/seo';
import { BRAND } from '@/lib/brand';
import { OFFER, formatEuros } from '@/lib/offer';
import { breadcrumbLd } from '@/seo/schema';
import { trackEvent } from '@/lib/analytics';
import { legacyBuyerPays } from '@/lib/mandate';
import { tradeLabel, departementLabel, otherQualificationLabel, shortRgeLabel, inRegion } from '@/lib/referentiels';
import { SALE_OBJECT_LABELS, SALE_REASON_LABELS, isProfileIncomplete } from '@/components/buyer/api';

// Fiche d'annonce anonyme (SPEC §4.3 point 3, API.md §2) : tout ce que le cédant a saisi, jamais son nom ni ses
// coordonnées ; badges vérifié / déclaré ; encart « Comment ça se passe » ; CTA « Présenter mon projet au cédant »
// (POST /companies/{id}/contact {message} → messagerie) ; favori visiteur → inscription ; alerte sans compte.

const FIXED_CHARGE_LABELS = { salaries: 'Salaires chargés', rent: 'Loyers', insurance: 'Assurances', equipment: 'Matériel et véhicules' };
const REASSURANCE = [
  { key: 'has_maintenance_contracts', label: 'Contrats d\'entretien récurrents' },
  { key: 'technical_referent_stays', label: 'Le référent technique reste' },
  { key: 'key_staff_stays', label: 'L\'équipe clé reste' },
  { key: 'decennale_ok', label: 'Assurance décennale à jour, sans sinistre en cours' },
];

const hasValue = (v) => v !== null && v !== undefined && v !== '' && !(typeof v === 'number' && Number.isNaN(v));
const isExpired = (iso) => iso && new Date(iso) < new Date();
const isExpiringSoon = (iso) => {
  if (!iso) return false;
  const d = new Date(iso);
  const limit = new Date();
  limit.setMonth(limit.getMonth() + 6);
  return d >= new Date() && d <= limit;
};
const handoverText = (months) => {
  const m = Number(months);
  if (!Number.isFinite(m)) return '';
  if (m === 0) return 'Aucun accompagnement prévu';
  return `${m} mois d'accompagnement par le cédant`;
};

// Message de présentation prérempli depuis le profil de projet du repreneur
const draftMessage = (user) => {
  const p = user?.buyer_profile || {};
  const lines = ['Bonjour,', ''];
  const project = PROJECT_TYPES[p.project_type];
  lines.push(`Votre annonce correspond à mon projet${project ? ` de ${project.toLowerCase()}` : ' de reprise'}.`);
  const details = [];
  if (hasValue(p.budget_max)) details.push(`budget jusqu'à ${formatEuros(p.budget_max)}`);
  if (p.financing && FINANCING[p.financing]) details.push(`financement : ${FINANCING[p.financing].toLowerCase()}`);
  if (Array.isArray(p.zones) && p.zones.length) details.push(`zones : ${p.zones.join(', ')}`);
  if (p.horizon && HORIZONS[p.horizon]) details.push(`horizon : ${HORIZONS[p.horizon].toLowerCase()}`);
  if (details.length) lines.push(`En quelques mots : ${details.join(' ; ')}.`);
  if (p.experience) lines.push(String(p.experience));
  lines.push('', 'Je serais heureux d\'échanger avec vous sur l\'entreprise, son équipe et vos attentes pour la cession.', '', 'Cordialement');
  return lines.join('\n');
};

const Stat = ({ label, children, testId, note }) => (
  <div className="rounded-xl bg-brand-surface border border-brand-line p-3 sm:p-4 min-w-0">
    <p className="text-xs text-gray-500">{label}</p>
    <p className="font-semibold text-brand-navy tabular break-words" data-testid={testId}>{children}</p>
    {note && <p className="text-xs text-gray-600 mt-0.5 break-words" data-testid={testId ? `${testId}-note` : undefined}>{note}</p>}
  </div>
);

const Section = ({ id, title, icon: Icon, children }) => (
  <section className="card p-5 sm:p-6 min-w-0" aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`} className="font-display text-lg sm:text-xl font-bold text-brand-navy flex items-center gap-2 mb-4">
      {Icon && <Icon className="w-5 h-5 text-gray-500 shrink-0" aria-hidden="true" />}
      {title}
    </h2>
    {children}
  </section>
);

const CompanyDetail = ({ user }) => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [favoriteLoading, setFavoriteLoading] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [contactLoading, setContactLoading] = useState(false);
  const [contactError, setContactError] = useState(null); // { kind: 'profile'|'email'|'text', text }

  const isBuyer = user?.role === 'buyer';
  const isOwner = Boolean(user && company && (user.role === 'admin' || (company.seller_id && company.seller_id === user.id)));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axiosInstance.get(`/companies/${id}`);
      setCompany(res.data);
      setNotFound(false);
    } catch (error) {
      setCompany(null);
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

  const title = company ? listingTitle(company) : '';
  const badge = company ? qualificationBadge(company) : null;
  const trades = useMemo(() => (Array.isArray(company?.trades) ? company.trades : []), [company]);
  const rgeTypes = Array.isArray(company?.rge_types) ? company.rge_types : [];
  const others = Array.isArray(company?.other_qualifications) ? company.other_qualifications : [];
  const firstTrade = trades[0] || null;
  const dep = company?.department ? departementLabel(company.department) : '';
  const location = [company?.region, dep].filter(Boolean).join(' · ');
  const seoCrumbs = [
    { name: 'Annonces', path: LISTINGS_PATH },
    { name: 'Annonce', path: `/company/${id}` },
  ];
  // /company/:id est une route commune (en-tête et og:site_name CessionBâtiment) : marque principale dans le
  // titre, y compris pour une annonce RGE (BRAND.verticalName est réservé aux pages /…-rge).
  useSeo(
    company ? `${title} | ${BRAND.name}` : notFound ? `Annonce introuvable | ${BRAND.name}` : `Entreprise à vendre | ${BRAND.name}`,
    company
      ? `Annonce anonyme : ${title}${company.region ? ` ${inRegion(company.region)}` : ''}${hasValue(company.asking_price) ? `, prix demandé ${formatPrice(company.asking_price)}` : ''}. ${OFFER.metaMatching}`
      : `Annonce anonyme de cession d'entreprise du bâtiment. ${OFFER.metaMatching}`,
    // Annonce fictive du mode test : jamais indexée
    notFound || company?.is_test === true ? { robots: NOINDEX }
      : company ? { path: `/company/${id}`, jsonLd: breadcrumbLd(SITE_URL, seoCrumbs) } : {},
  );

  const toggleFavorite = async () => {
    if (!user) {
      navigate(`/register?role=buyer&redirect=${encodeURIComponent(`/company/${id}`)}`);
      return;
    }
    if (!isBuyer || favoriteLoading) return;
    setFavoriteLoading(true);
    try {
      if (isFavorite) {
        await axiosInstance.delete(`/favorites/${id}`);
        setIsFavorite(false);
        toast.success('Retirée de vos favoris');
      } else {
        await axiosInstance.post('/favorites', { company_id: id });
        setIsFavorite(true);
        toast.success('Ajoutée à vos favoris');
      }
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Le favori n\'a pas pu être enregistré.'));
    } finally {
      setFavoriteLoading(false);
    }
  };

  const share = async () => {
    const url = `${SITE_URL}/company/${id}`;
    try {
      if (navigator.share) {
        await navigator.share({ title, text: `${title} — annonce anonyme sur ${BRAND.name}`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast.success('Lien de l\'annonce copié. Il ne révèle ni le nom ni les coordonnées de l\'entreprise.');
    } catch (e) {
      // partage annulé ou presse-papiers indisponible
    }
  };

  const openContact = () => {
    if (!user) {
      navigate(`/login?redirect=${encodeURIComponent(`/company/${id}`)}`);
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
      const res = await axiosInstance.post(`/companies/${id}/contact`, { message: text });
      const data = res.data || {};
      if (data.already_contacted) toast.info('Vous avez déjà présenté votre projet au cédant : retrouvez la conversation dans votre messagerie.');
      else {
        toast.success('Projet transmis au cédant. Il reçoit votre carte repreneur et votre message par e-mail.', { duration: 7000 });
        trackEvent('contact_sent', { source: 'fiche', listing: String(id) });
      }
      setContactOpen(false);
      navigate(`/messages?conversation=${encodeURIComponent(data.conversation_id || id)}`);
    } catch (error) {
      if (isEmailNotVerifiedError(error)) setContactError({ kind: 'email', text: 'Confirmez d\'abord votre adresse e-mail : un lien vous a été envoyé (bandeau en haut de page).' });
      else if (isProfileIncomplete(error)) setContactError({ kind: 'profile', text: apiErrorMessage(error, 'Votre profil de projet est incomplet : 40 % sont nécessaires pour contacter un cédant.') });
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
  if (!company) return notFound ? <NotFound user={user} /> : null;

  const c = company;
  const legacyPayer = legacyBuyerPays({ commission_payer: c.commission_info?.payer, terms_version: c.commission_info?.terms_version || c.commission_terms_version });
  const multiple = hasValue(c.asking_price) && Number(c.ebitda) > 0 ? Math.round((Number(c.asking_price) / Number(c.ebitda)) * 10) / 10 : null;
  const fixedCharges = c.fixed_charges && typeof c.fixed_charges === 'object' ? Object.keys(FIXED_CHARGE_LABELS).filter((k) => Number(c.fixed_charges[k]) > 0).map((k) => ({ key: k, label: FIXED_CHARGE_LABELS[k], value: Number(c.fixed_charges[k]) })) : [];
  const fixedTotal = fixedCharges.reduce((s, x) => s + x.value, 0) || (typeof c.fixed_charges === 'number' ? c.fixed_charges : 0);
  const reassurance = REASSURANCE.filter((r) => c[r.key] === true || c[r.key] === false);
  const saleObject = SALE_OBJECT_LABELS[c.sale_object] || (c.sale_type === 'parts' ? SALE_OBJECT_LABELS.titres : c.sale_type === 'fonds' ? SALE_OBJECT_LABELS.fonds : '');
  const dirigeantVerified = c.company_checks?.dirigeant_match === 'match_exact';
  const rgeDeadline = c.rge_validity || null;
  const verifiedAt = c.qualifications_verified_at || null;
  const inAdeme = c.company_checks?.in_ademe_list;
  const hasFinancials = ['ca_n', 'ca_n1', 'ca_n2', 'ebitda', 'margin', 'debt', 'pipeline'].some((k) => hasValue(c[k])) || fixedTotal > 0;
  const revealedName = c.company_name && !isOwner ? c.company_name : null;

  return (
    <div className="min-h-screen flex flex-col bg-brand-surface">
      <AppHeader user={user} />

      <main id="contenu" className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 min-w-0">
        <nav aria-label="Fil d'Ariane" className="text-sm text-gray-600 mb-4 min-w-0">
          <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <li><Link to={LISTINGS_PATH} className="hover:underline">Annonces</Link></li>
            {firstTrade && (<><li aria-hidden="true">›</li><li><Link to={listingsPath({ trades: [firstTrade] })} className="hover:underline">{tradeLabel(firstTrade, true)}</Link></li></>)}
            <li aria-hidden="true">›</li>
            <li aria-current="page" className="text-brand-navy">Annonce</li>
          </ol>
        </nav>

        <div className="grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-6 min-w-0">
          <div className="space-y-6 min-w-0">
            {/* En-tête */}
            <header className="card p-5 sm:p-6 min-w-0" data-testid="company-header">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                {badge && (
                  <span className={`badge ${badge.kind === 'verified' ? 'badge-verified' : 'badge-declared'}`} data-testid="qualification-badge">
                    <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />{badge.label}
                  </span>
                )}
                {dirigeantVerified && <span className="badge badge-verified"><BadgeCheck className="w-3.5 h-3.5" aria-hidden="true" />Dirigeant vérifié</span>}
                {c.is_test === true && <span className="badge badge-warning" data-testid="test-listing-badge">Annonce de test (fictive)</span>}
                {c.published_at && <time dateTime={c.published_at} className="text-xs text-gray-500">Publiée le {formatDateFr(c.published_at)}</time>}
              </div>
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-brand-navy tracking-tight break-words">{title}</h1>
              <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
                {location && <div className="flex items-center gap-1 min-w-0"><dt className="sr-only">Localisation</dt><MapPin className="w-4 h-4 shrink-0" aria-hidden="true" /><dd className="truncate">{location}</dd></div>}
                {hasValue(c.staff_count) && <div className="flex items-center gap-1"><dt className="sr-only">Effectif</dt><Users className="w-4 h-4 shrink-0" aria-hidden="true" /><dd>{plural(Number(c.staff_count), 'salarié')}</dd></div>}
                {c.creation_date && <div className="flex items-center gap-1"><dt className="sr-only">Création</dt><Calendar className="w-4 h-4 shrink-0" aria-hidden="true" /><dd>Créée en {new Date(c.creation_date).getFullYear()}</dd></div>}
                {c.legal_structure && <div className="flex items-center gap-1"><dt className="sr-only">Forme juridique</dt><Building2 className="w-4 h-4 shrink-0" aria-hidden="true" /><dd>{c.legal_structure}</dd></div>}
              </dl>
              {trades.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Métiers">
                  {trades.map((t) => <li key={t}><Link to={listingsPath({ trades: [t] })} className="badge bg-brand-blue-soft text-blue-800 hover:underline">{tradeLabel(t, true) || t}</Link></li>)}
                </ul>
              )}
              {revealedName && (
                <p className="mt-3 badge badge-verified" data-testid="revealed-identity">
                  <Lock className="w-3.5 h-3.5" aria-hidden="true" />Nom révélé après votre accord de confidentialité : {revealedName}
                </p>
              )}

              <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-3">
                <Stat label="Prix demandé" testId="asking-price">{formatPrice(c.asking_price)}</Stat>
                {hasValue(c.ca_n) && <Stat label="Chiffre d'affaires" testId="ca-n">{formatPrice(c.ca_n)}</Stat>}
                {hasValue(c.ebitda) && (
                  <Stat label="EBE" testId="ebitda" note={multiple ? `Prix demandé = ${String(multiple).replace('.', ',')} × l'EBE` : null}>{formatPrice(c.ebitda)}</Stat>
                )}
              </div>

              {legacyPayer && (
                <div className="mt-4 text-sm text-brand-amber bg-brand-amber-soft border border-amber-200 rounded-xl px-4 py-3" data-testid="commission-notice">
                  <p className="font-semibold">Annonce antérieure au barème actuel : commission à la charge de l&apos;acquéreur.</p>
                  {hasValue(c.commission_info?.estimate_ht) && <p className="mt-1 tabular">Estimation sur le prix demandé : {formatEuros(c.commission_info.estimate_ht)} HT ({formatEuros(c.commission_info.estimate_ttc)} TTC), due uniquement à la signature de l&apos;acte.</p>}
                </div>
              )}

              <div className="mt-5 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap pt-4 border-t border-brand-line" data-testid="company-actions">
                {!isOwner && user?.role !== 'seller' && (
                  <button type="button" onClick={openContact} className="btn-primary col-span-2 sm:col-auto px-5 py-3 text-sm" data-testid="contact-seller-btn">
                    <MessageSquare className="w-4 h-4" aria-hidden="true" />
                    Présenter mon projet au cédant
                  </button>
                )}
                {!isOwner && user?.role !== 'seller' && (
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
                    Mon dossier
                  </Link>
                )}
                <button type="button" onClick={share} className="btn-secondary w-full sm:w-auto px-4 py-3 text-sm" data-testid="share-btn">
                  <Share2 className="w-4 h-4" aria-hidden="true" />
                  Partager
                </button>
              </div>
              {isOwner && <p className="mt-3 text-sm text-gray-600">Vous voyez votre annonce telle que les repreneurs la voient, nom et coordonnées exclus. <Link to="/seller/dashboard" className="btn-link text-sm">Mon espace</Link></p>}
            </header>

            {/* Entreprise */}
            <Section id="entreprise" title="L'entreprise" icon={Building2}>
              {c.description ? <p className="text-gray-800 leading-relaxed whitespace-pre-line break-words" data-testid="description">{c.description}</p> : <p className="text-sm text-gray-600">Le cédant n&apos;a pas rédigé de présentation : demandez-lui ce qui vous manque par la messagerie après le premier contact.</p>}
              <dl className="mt-4 grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                {Array.isArray(c.specialties) && c.specialties.length > 0 && <div className="min-w-0 sm:col-span-2"><dt className="text-xs text-gray-500">Spécialités</dt><dd className="text-brand-navy font-medium break-words">{c.specialties.join(', ')}</dd></div>}
                {c.equipment && <div className="min-w-0"><dt className="text-xs text-gray-500">Matériel et véhicules</dt><dd className="text-gray-800 break-words whitespace-pre-line">{c.equipment}</dd></div>}
                {c.premises && <div className="min-w-0"><dt className="text-xs text-gray-500">Locaux</dt><dd className="text-gray-800 break-words whitespace-pre-line">{c.premises}</dd></div>}
                {c.mandataire_contracts && <div className="min-w-0 sm:col-span-2"><dt className="text-xs text-gray-500">Contrats avec des mandataires ou obligés (primes CEE)</dt><dd className="text-gray-800 break-words whitespace-pre-line">{c.mandataire_contracts}</dd></div>}
                {c.creation_date && <div className="min-w-0"><dt className="text-xs text-gray-500">Date de création</dt><dd className="text-gray-800">{formatDateFr(c.creation_date)}</dd></div>}
                {hasValue(c.staff_count) && <div className="min-w-0"><dt className="text-xs text-gray-500">Effectif</dt><dd className="text-gray-800" data-testid="staff-count">{plural(Number(c.staff_count), 'salarié')}</dd></div>}
                {c.legal_structure && <div className="min-w-0"><dt className="text-xs text-gray-500">Forme juridique</dt><dd className="text-gray-800">{c.legal_structure}</dd></div>}
                {location && <div className="min-w-0"><dt className="text-xs text-gray-500">Localisation</dt><dd className="text-gray-800">{location}</dd></div>}
              </dl>
            </Section>

            {/* Qualifications */}
            {(rgeTypes.length > 0 || others.length > 0) && (
              <Section id="qualifications" title="Qualifications" icon={ShieldCheck}>
                {rgeTypes.length > 0 && (
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <h3 className="font-semibold text-brand-navy">Domaines RGE</h3>
                      {inAdeme !== false ? (
                        <span className="badge badge-verified"><ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />Contrôlés sur la liste ADEME{verifiedAt ? ` le ${formatDateFr(verifiedAt)}` : ''}</span>
                      ) : (
                        <span className="badge badge-declared">Déclarés par le cédant, non retrouvés sur la liste ADEME</span>
                      )}
                    </div>
                    <ul className="divide-y divide-brand-line rounded-xl border border-brand-line bg-white" data-testid="rge-list">
                      {rgeTypes.map((label) => (
                        <li key={label} className="flex flex-wrap items-center justify-between gap-2 p-3 min-w-0">
                          <span className="text-sm font-medium text-brand-navy break-words">{shortRgeLabel(label)}</span>
                          {rgeDeadline && (
                            // Vert réservé à la vérification (SPEC §5.3) : non retrouvée sur la liste ADEME → ton « déclaré »
                            <span className={`badge ${isExpired(rgeDeadline) ? 'badge-danger' : inAdeme === false ? 'badge-declared' : isExpiringSoon(rgeDeadline) ? 'badge-warning' : 'badge-verified'}`} data-testid="rge-validity-badge">
                              {isExpired(rgeDeadline) ? `Expirée le ${formatDateFr(rgeDeadline)}` : inAdeme === false ? `Déclarée valide jusqu'au ${formatDateFr(rgeDeadline)}` : `Valide jusqu'au ${formatDateFr(rgeDeadline)}`}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-gray-500 mt-2">
                      {rgeDeadline ? 'Date de fin de validité déclarée par le cédant pour sa qualification principale. ' : ''}
                      Le détail par qualification (organisme, dates) est fourni dans le dossier avec le diagnostic de transmissibilité.
                    </p>
                  </div>
                )}
                {others.length > 0 && (
                  <div className="mt-4 min-w-0">
                    <h3 className="font-semibold text-brand-navy mb-2">Autres qualifications <span className="badge badge-declared ml-1">Déclarées</span></h3>
                    <ul className="flex flex-wrap gap-1.5">
                      {others.map((o) => <li key={o} className="badge badge-locked">{otherQualificationLabel(o) || o}</li>)}
                    </ul>
                  </div>
                )}
              </Section>
            )}

            {/* Chiffres */}
            {hasFinancials && (
              <Section id="chiffres" title="Chiffres clés" icon={Wrench}>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {hasValue(c.ca_n) && <Stat label="Chiffre d'affaires N">{formatPrice(c.ca_n)}</Stat>}
                  {hasValue(c.ca_n1) && <Stat label="Chiffre d'affaires N-1">{formatPrice(c.ca_n1)}</Stat>}
                  {hasValue(c.ca_n2) && <Stat label="Chiffre d'affaires N-2">{formatPrice(c.ca_n2)}</Stat>}
                  {hasValue(c.ebitda) && <Stat label="EBE (excédent brut d'exploitation)">{formatPrice(c.ebitda)}</Stat>}
                  {hasValue(c.margin) && <Stat label="Marge brute">{String(c.margin).replace('.', ',')} %</Stat>}
                  {/* Valeurs nulles masquées : 0 € est la valeur par défaut d'un champ non renseigné (pas de compteur à zéro) */}
                  {Number(c.debt) > 0 && <Stat label="Endettement">{formatPrice(c.debt)}</Stat>}
                  {Number(c.pipeline) > 0 && <Stat label="Carnet de commandes">{formatPrice(c.pipeline)}</Stat>}
                  {fixedTotal > 0 && <Stat label="Charges fixes annuelles">{formatPrice(fixedTotal)}</Stat>}
                </div>
                {fixedCharges.length > 0 && (
                  <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
                    {fixedCharges.map((x) => <div key={x.key}><dt className="inline">{x.label} : </dt><dd className="inline tabular text-brand-navy">{formatPrice(x.value)}</dd></div>)}
                  </dl>
                )}
                {multiple && <p className="mt-3 text-sm text-gray-600 tabular">Prix demandé rapporté à l&apos;EBE : {String(multiple).replace('.', ',')} ×. Un ordre de grandeur, à affiner avec les comptes complets dans le dossier.</p>}
                <p className="mt-2 text-xs text-gray-500">Chiffres déclarés par le cédant ; les comptes et pièces justificatives sont dans le dossier, après accord de confidentialité.</p>
              </Section>
            )}

            {/* Conditions de cession */}
            <Section id="cession" title="Conditions de cession" icon={FileSignature}>
              <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <div className="min-w-0"><dt className="text-xs text-gray-500">Prix demandé</dt><dd className="font-semibold text-brand-navy tabular">{formatPrice(c.asking_price)}</dd></div>
                {saleObject && <div className="min-w-0"><dt className="text-xs text-gray-500">Objet de la cession</dt><dd className="text-gray-800">{saleObject}</dd></div>}
                {c.sale_reason && <div className="min-w-0"><dt className="text-xs text-gray-500">Motif de la cession</dt><dd className="text-gray-800">{SALE_REASON_LABELS[c.sale_reason] || c.sale_reason}</dd></div>}
                {hasValue(c.handover_months) && <div className="min-w-0"><dt className="text-xs text-gray-500">Accompagnement</dt><dd className="text-gray-800">{handoverText(c.handover_months)}</dd></div>}
              </dl>
              {reassurance.length > 0 && (
                <ul className="mt-4 grid sm:grid-cols-2 gap-2" aria-label="Ce qui rassure un repreneur" data-testid="reassurance">
                  {reassurance.map((r) => (
                    <li key={r.key} className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-sm ${c[r.key] ? 'border-brand-green/30 bg-brand-green-soft text-brand-green-dark' : 'border-brand-line bg-white text-gray-600'}`}>
                      {c[r.key] ? <Check className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" /> : <X className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />}
                      <span>{r.label}{c[r.key] ? '' : ' : non'}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-4 text-sm text-gray-700">{OFFER.payerSentence}</p>
            </Section>
          </div>

          {/* Colonne latérale */}
          <aside className="space-y-6 min-w-0 lg:sticky lg:top-24 self-start">
            <section className="card p-5 sm:p-6 min-w-0" aria-labelledby="how-title" data-testid="how-it-works">
              <h2 id="how-title" className="font-display text-lg font-bold text-brand-navy mb-3">Comment ça se passe</h2>
              <ol className="space-y-3">
                {[
                  { title: 'Vous présentez votre projet', text: 'Sans frais, par la messagerie. Le cédant reçoit votre carte repreneur (projet, budget, financement, zones) et vous répond.' },
                  { title: 'Le dossier s\'ouvre après l\'accord de confidentialité', text: 'Identité vérifiée, accord signé par code, origine des fonds déclarée : le nom de l\'entreprise et les documents vous sont alors révélés.' },
                  { title: 'Vous faites une offre indicative', text: 'Prix, objet, financement, conditions. Signée en ligne, contresignée par le cédant s\'il l\'accepte.' },
                ].map((s, i) => (
                  <li key={s.title} className="flex gap-3 min-w-0">
                    <span className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full bg-brand-navy text-white text-xs font-bold tabular" aria-hidden="true">{i + 1}</span>
                    <div className="min-w-0">
                      <p className="font-semibold text-brand-navy leading-snug">{s.title}</p>
                      <p className="text-sm text-gray-600 leading-relaxed">{s.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="mt-4 text-xs text-gray-500 leading-relaxed flex items-start gap-1.5"><Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />Annonce anonyme : ni nom ni coordonnées avant l&apos;accord de confidentialité. {OFFER.buyerFreeShort}</p>
              {!isOwner && user?.role !== 'seller' && (
                <button type="button" onClick={openContact} className="btn-primary w-full mt-4 px-5 py-3 text-sm" data-testid="contact-seller-side-btn">
                  <MessageSquare className="w-4 h-4" aria-hidden="true" />
                  Présenter mon projet au cédant
                </button>
              )}
              {!user && <p className="mt-2 text-xs text-gray-500 text-center">Inscription en 2 minutes, sans frais.</p>}
            </section>

            {!user && (
              <AlertForm
                source="fiche"
                compact
                defaultTrades={trades}
                defaultRegions={c.region ? [c.region] : []}
                title="Recevoir les annonces similaires"
                intro="Une alerte e-mail, sans compte, sur les mêmes métiers et la même région."
              />
            )}
            {isBuyer && (
              <p className="text-sm text-gray-600">
                <Link to="/buyer/dashboard" className="btn-link text-sm">Gérer mes alertes</Link> pour recevoir les annonces similaires.
              </p>
            )}
            <p className="text-sm">
              <Link to={LISTINGS_PATH} className="btn-link text-sm">Toutes les entreprises du bâtiment à vendre</Link>
            </p>
          </aside>
        </div>
      </main>

      {contactOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="contact-title">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto p-5 sm:p-6 min-w-0" data-testid="contact-modal">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <h2 id="contact-title" className="font-display text-xl font-bold text-brand-navy">Présenter mon projet au cédant</h2>
                <p className="text-sm text-gray-600 mt-1 break-words">{title}{hasValue(c.asking_price) ? ` · ${formatPrice(c.asking_price)}` : ''}</p>
              </div>
              <button type="button" onClick={() => setContactOpen(false)} className="shrink-0 rounded-lg p-2 text-gray-600 hover:bg-brand-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue" aria-label="Fermer">
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>
            <p className="text-sm text-gray-700 leading-relaxed mb-3">
              Le cédant reçoit votre carte repreneur (projet, budget, financement, zones, horizon, société vérifiée) et ce message. Aucune coordonnée n&apos;est transmise avant l&apos;accord de confidentialité. {OFFER.buyerFreeShort}
            </p>
            <label htmlFor="contact-message" className="block text-sm font-semibold text-brand-navy mb-1">Votre message</label>
            <textarea
              id="contact-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={9}
              maxLength={2000}
              className="w-full rounded-xl border border-brand-line px-4 py-3 text-sm text-brand-navy focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
              data-testid="contact-message"
            />
            <p className="text-xs text-gray-500 mt-1">Prérempli depuis votre profil de projet : adaptez-le à cette entreprise. Les coordonnées sont masquées avant l&apos;accord de confidentialité.</p>
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
                Envoyer au cédant
              </button>
            </div>
          </div>
        </div>
      )}

      <AppFooter />
    </div>
  );
};

export default CompanyDetail;
