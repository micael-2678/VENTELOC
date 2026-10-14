import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  CheckCircle, Download, FileSignature, Globe, Info, ShieldCheck, AlertCircle, ChevronDown, ChevronUp, Loader2, MapPin,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { axiosInstance } from '@/App';
import { usePrivateSeo } from '@/lib/seo';
import AppHeader from '@/components/layout/AppHeader';
import PageBar from '@/components/layout/PageBar';
import OtpSignatureDialog from '@/components/OtpSignatureDialog';
import { computeCommission, formatEuros, COMMISSION, commissionSentenceFor } from '@/lib/offer';
import { useCommission } from '@/lib/useCommission';
import { formatEur } from '@/lib/format';
import {
  downloadMandatePdf, formatDateTimeFr, MANDATE_NOTICE_DAYS, MANDATE_DURATION_MONTHS, MANDATE_TAIL_MONTHS, MANDATE_WITHDRAWAL_DAYS,
} from '@/lib/mandate';
import { SALE_OBJECTS } from '@/lib/referentiels';
import { trackEvent } from '@/lib/analytics';
import { listingTitle } from '@/components/shared';
import { KYCVerificationButton } from '@/components/KYCVerification';
import { apiErrorMessage, apiErrorCode, isEmailNotVerifiedError } from '@/components/account/errors';
import { Field, TextInput, SelectInput } from '@/components/seller/FormFields';
import { BlockingReasons } from '@/components/seller/ListingStatusBadge';
import { isCompanyOwner } from '@/components/seller/listingForm';

// Qualité du signataire (SPEC §3.3 `mandant_capacity`, mandat art. 1)
export const CAPACITIES = [
  { value: 'proprietaire', label: 'Propriétaire du bien' },
  { value: 'coindivisaire', label: 'Co-indivisaire, avec l\'accord de tous les indivisaires' },
  { value: 'gerant', label: 'Gérant de la société propriétaire' },
  { value: 'mandataire', label: 'Mandataire du propriétaire (avec pouvoir écrit)' },
];
// Qualités cohérentes avec le type de propriétaire déclaré dans l'annonce
export const capacitiesFor = (ownerType) => {
  if (isCompanyOwner(ownerType)) return CAPACITIES.filter((c) => ['gerant', 'mandataire'].includes(c.value));
  if (ownerType === 'indivision') return CAPACITIES.filter((c) => ['coindivisaire', 'mandataire'].includes(c.value));
  if (ownerType === 'personne-physique') return CAPACITIES.filter((c) => ['proprietaire', 'mandataire'].includes(c.value));
  return CAPACITIES;
};

const emptyAddress = { line1: '', line2: '', postal_code: '', city: '' };

// Adresse stockée (objet ou chaîne formatée « 12 rue X, 29200 Brest ») → champs du formulaire
const addressFromProperty = (value) => {
  if (!value) return emptyAddress;
  if (typeof value === 'object') return { ...emptyAddress, ...value, line2: value.line2 || '' };
  const m = /^(.*?)(?:,\s*)?(\d{5})\s+(.+)$/.exec(String(value).trim());
  if (!m) return { ...emptyAddress, line1: String(value) };
  const parts = m[1].split(',').map((s) => s.trim()).filter(Boolean);
  return { line1: parts[0] || '', line2: parts.slice(1).join(', '), postal_code: m[2], city: m[3].trim() };
};
const addressToString = (a) => [a.line1, a.line2, `${a.postal_code} ${a.city}`].map((s) => String(s || '').trim()).filter(Boolean).join(', ');

// Écran de fin : mandat signé (juste après la signature ou déjà signé auparavant)
const SignedSummary = ({ mandate, property, propertyId }) => {
  const withdrawalEnds = formatDateTimeFr(mandate.withdrawal_ends_at);
  return (
    <section className="card p-5 sm:p-8" data-testid="mandate-signed">
      <div className="flex items-start gap-3 mb-6">
        <CheckCircle className="w-8 h-8 text-brand-green shrink-0" aria-hidden="true" />
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-brand-navy">Mandat signé</h1>
          <p className="text-gray-600 mt-1">Votre mandat de vente simple est inscrit au registre des mandats d'{COMMISSION.mandateHolder}. Le PDF, avec son dossier de preuve, vous a été envoyé par e-mail.</p>
        </div>
      </div>

      <dl className="grid sm:grid-cols-2 gap-4 mb-6">
        <div className="rounded-xl bg-brand-surface p-4">
          <dt className="text-xs uppercase tracking-wide text-gray-500">N° de registre</dt>
          <dd className="text-lg font-bold text-brand-navy break-words tabular" data-testid="mandate-registry">{mandate.registry_number || '—'}</dd>
        </div>
        <div className="rounded-xl bg-brand-surface p-4">
          <dt className="text-xs uppercase tracking-wide text-gray-500">Signé le</dt>
          <dd className="font-semibold text-gray-800">{formatDateTimeFr(mandate.signed_at) || '—'}</dd>
        </div>
        <div className="rounded-xl bg-brand-surface p-4">
          <dt className="text-xs uppercase tracking-wide text-gray-500">Mandat en cours jusqu'au</dt>
          <dd className="font-semibold text-gray-800">{formatDateTimeFr(mandate.ends_at) || '—'}</dd>
        </div>
        <div className="rounded-xl bg-brand-surface p-4">
          <dt className="text-xs uppercase tracking-wide text-gray-500">Clause de suite jusqu'au</dt>
          <dd className="font-semibold text-gray-800">{formatDateTimeFr(mandate.tail_ends_at) || '—'}</dd>
        </div>
        {mandate.contract_number && (
          <div className="rounded-xl bg-brand-surface p-4 sm:col-span-2">
            <dt className="text-xs uppercase tracking-wide text-gray-500">Référence</dt>
            <dd className="font-semibold text-gray-800 break-words">{mandate.contract_number}</dd>
          </div>
        )}
      </dl>

      {mandate.id && (
        <Button onClick={() => downloadMandatePdf(mandate.id)} className="w-full sm:w-auto rounded-xl bg-brand-teal hover:bg-brand-teal-dark text-white mb-6" data-testid="mandate-pdf">
          <Download className="w-4 h-4 mr-2" />
          Télécharger le mandat signé (PDF)
        </Button>
      )}

      <NextStep property={property} propertyId={propertyId} />

      <p className="text-sm text-gray-600 mt-6" data-testid="mandate-withdrawal-info">
        {withdrawalEnds ? `Vous pouvez vous rétracter sans motif jusqu'au ${withdrawalEnds} (${MANDATE_WITHDRAWAL_DAYS} jours) depuis votre espace vendeur : la rétractation est immédiate et rien n'est dû. ` : ''}
        Résiliable ensuite à tout moment, avec un préavis de {MANDATE_NOTICE_DAYS} jours. Sans exclusivité : vous restez libre de vendre par vous-même.
      </p>
    </section>
  );
};

const NextStep = ({ property, propertyId }) => {
  const status = property?.status;
  if (status === 'published') {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-brand-green/40 bg-brand-green-soft p-4" data-testid="mandate-next">
        <Globe className="w-5 h-5 text-brand-green-dark mt-0.5 shrink-0" aria-hidden="true" />
        <div className="text-sm text-gray-800 min-w-0">
          <p className="font-semibold text-brand-navy">Votre annonce est publiée immédiatement</p>
          <p className="mt-1">Elle est visible dès maintenant, sans adresse ni nom, et envoyée aux acquéreurs dont les critères correspondent. Vous serez prévenu par e-mail à chaque contact, engagement de confidentialité et offre d'achat.</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
            <Link to={`/annonce/${propertyId}`} className="font-medium underline">Voir mon annonce</Link>
            <Link to="/seller/dashboard" className="font-medium underline">Aller à mon espace vendeur</Link>
          </div>
        </div>
      </div>
    );
  }
  if (['draft', 'mandat_en_attente'].includes(status) && property?.blocking?.length) {
    return (
      <div className="space-y-3" data-testid="mandate-next">
        <BlockingReasons property={property} />
        <p className="text-sm text-gray-700">Dès que ces points sont réglés (par exemple le dépôt du justificatif de propriété), votre annonce est publiée automatiquement : rien d'autre à faire de votre côté.</p>
        <Link to={`/seller/edit/${propertyId}`} className="btn-link">Compléter mon annonce</Link>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3 rounded-xl border border-brand-teal-line bg-brand-teal-soft p-4" data-testid="mandate-next">
      <Info className="w-5 h-5 text-brand-teal mt-0.5 shrink-0" aria-hidden="true" />
      <div className="text-sm text-gray-800">
        <p className="font-semibold">Prochaine étape</p>
        <p className="mt-1">Retrouvez l'état de votre annonce et les actions à mener dans votre espace vendeur.</p>
        <Link to="/seller/dashboard" className="inline-block font-medium text-brand-teal underline mt-2">Aller à mon espace vendeur</Link>
      </div>
    </div>
  );
};

const MandatePage = ({ user }) => {
  usePrivateSeo('Mandat de vente');
  const { propertyId } = useParams();
  const commission = useCommission();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [property, setProperty] = useState(null);
  const [contract, setContract] = useState(null); // { contract_id, contract_number, content, summary, terms_date }
  const [signed, setSigned] = useState(null);
  const [address, setAddress] = useState(emptyAddress);
  const [capacity, setCapacity] = useState('');
  const [saleObject, setSaleObject] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [preparing, setPreparing] = useState(false);
  const [identityRequired, setIdentityRequired] = useState(false);
  const [emailRequired, setEmailRequired] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [propertyRes, statusRes] = await Promise.allSettled([
        axiosInstance.get(`/properties/${propertyId}`),
        axiosInstance.get(`/seller/mandat/status/${propertyId}`),
      ]);
      if (propertyRes.status === 'rejected') throw propertyRes.reason;
      const c = propertyRes.value.data || {};
      setProperty(c);
      setAddress(addressFromProperty(c.mandant_address));
      setCapacity(c.mandant_capacity || '');
      setSaleObject(c.sale_object || (isCompanyOwner(c.owner_type) ? '' : 'bien'));
      const mandat = statusRes.status === 'fulfilled' ? statusRes.value.data?.mandat : null;
      if (mandat && mandat.status === 'signed') setSigned(mandat);
    } catch (e) {
      setLoadError(apiErrorMessage(e, 'Impossible de charger votre annonce pour le moment. Réessayez dans quelques instants.'));
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => { load(); }, [load]);

  const price = Number(property?.asking_price) || 0;
  const estimate = price > 0 ? computeCommission(price, commission) : null;
  const estimateText = estimate ? `${formatEuros(estimate.ttc)} TTC (${formatEuros(estimate.ht)} HT)` : '';
  const company = isCompanyOwner(property?.owner_type);
  const saleObjects = SALE_OBJECTS.filter((o) => company || o.id === 'bien');
  const capacities = capacitiesFor(property?.owner_type);

  const validateForm = () => {
    const errs = {};
    if (!address.line1.trim()) errs.line1 = 'Indiquez la voie (numéro et rue).';
    if (!/^\d{5}$/.test(address.postal_code.trim())) errs.postal_code = 'Code postal à 5 chiffres.';
    if (!address.city.trim()) errs.city = 'Indiquez la ville.';
    if (!saleObject) errs.sale_object = 'Indiquez l\'objet de la vente.';
    if (!capacity) errs.capacity = 'Indiquez en quelle qualité vous signez.';
    return errs;
  };

  // 1) adresse + objet + qualité sur l'annonce ; 2) génération du mandat (texte, résumé, version)
  const prepare = async (e) => {
    e?.preventDefault();
    const errs = validateForm();
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;
    setPreparing(true);
    setIdentityRequired(false);
    setEmailRequired(false);
    try {
      const addr = { line1: address.line1.trim(), line2: address.line2.trim() || undefined, postal_code: address.postal_code.trim(), city: address.city.trim() };
      const body = { mandant_address: addr, mandant_capacity: capacity, sale_object: saleObject };
      try {
        await axiosInstance.put(`/properties/${propertyId}`, body);
      } catch (err) {
        if (err?.response?.status !== 422) throw err;
        // API antérieure : adresse acceptée sous forme de chaîne formatée
        await axiosInstance.put(`/properties/${propertyId}`, { ...body, mandant_address: addressToString(addr) });
      }
      const res = await axiosInstance.post('/seller/mandat/generate', null, { params: { property_id: propertyId } });
      const data = res.data || {};
      if (data.already_signed) {
        const c = data.contract || {};
        setSigned({ ...c, id: c.id || data.contract_id, pdf_url: data.pdf_url });
      } else {
        setContract(data);
        setExpanded(false);
      }
      const refreshed = await axiosInstance.get(`/properties/${propertyId}`).catch(() => null);
      if (refreshed?.data) setProperty(refreshed.data);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      const code = apiErrorCode(err);
      const detail = err?.response?.data?.detail;
      if (err?.response?.status === 400 && code === 'validation' && Array.isArray(detail?.missing)) {
        const map = { mandant_address: 'line1', mandant_capacity: 'capacity', sale_object: 'sale_object', company_name: 'property', siret: 'property', address: 'property', asking_price: 'property' };
        const next = {};
        detail.missing.forEach((m) => { next[map[m] || m] = detail.message || 'Champ manquant'; });
        setFieldErrors(next);
        toast.error(detail.message || 'Complétez votre annonce avant de générer le mandat.');
      } else if (code === 'identity_required') {
        setIdentityRequired(true);
      } else if (isEmailNotVerifiedError(err)) {
        setEmailRequired(true);
      } else {
        toast.error(apiErrorMessage(err, 'Impossible de préparer votre mandat pour le moment.'));
      }
    } finally {
      setPreparing(false);
    }
  };

  const handleSign = async (otpCode) => {
    const res = await axiosInstance.post(`/seller/mandat/${contract.contract_id}/sign`, { otp_code: otpCode });
    const data = res.data || {};
    setSigned({
      id: contract.contract_id,
      contract_number: data.contract_number || contract.contract_number,
      registry_number: data.registry_number,
      signed_at: data.signed_at || new Date().toISOString(),
      ends_at: data.ends_at,
      tail_ends_at: data.tail_ends_at,
      withdrawal_ends_at: data.withdrawal_ends_at,
      terms_version: data.terms_version || contract.terms_version,
      pdf_url: data.pdf_url,
    });
    setDialogOpen(false);
    trackEvent('mandate_signed', { listing_status: data.listing_status || '' });
    toast.success(`Mandat signé. N° de registre : ${data.registry_number || '—'}`);
    try { sessionStorage.removeItem('kyc_return_to'); } catch (e) { /* stockage indisponible */ }
    const refreshed = await axiosInstance.get(`/properties/${propertyId}`).catch(() => null);
    if (refreshed?.data) setProperty(refreshed.data);
    else if (data.listing_status) setProperty((c) => ({ ...(c || {}), status: data.listing_status }));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const listingSummary = property && (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
      <div className="min-w-0 sm:col-span-2">
        <dt className="text-gray-500">Annonce</dt>
        <dd className="font-medium text-gray-900 break-words">{listingTitle(property)}</dd>
      </div>
      <div className="min-w-0">
        <dt className="text-gray-600">Adresse du bien</dt>
        <dd className={`font-medium break-words ${property.address ? 'text-gray-900' : 'text-brand-amber'}`}>{property.address ? `${property.address}, ${property.postal_code || ''} ${property.city || ''}` : 'Adresse à renseigner sur l\'annonce'}</dd>
      </div>
      {company && (
        <div className="min-w-0">
          <dt className="text-gray-600">Société propriétaire</dt>
          <dd className={`font-medium break-words ${property.company_name ? 'text-gray-900' : 'text-brand-amber'}`}>{property.company_name || 'Dénomination à renseigner sur l\'annonce'}</dd>
        </div>
      )}
      <div>
        <dt className="text-gray-600">Prix de vente (honoraires inclus)</dt>
        <dd className="font-medium text-gray-900 tabular">{price > 0 ? formatEur(price) : 'À renseigner sur l\'annonce'}</dd>
      </div>
    </dl>
  );

  return (
    <div className="min-h-screen bg-brand-surface">
      <AppHeader user={user} />
      <PageBar backTo="/seller/dashboard" backLabel="Mon espace" title="Mandat de vente" />

      <main id="contenu" className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        {loading ? (
          <div className="flex justify-center py-20" role="status" aria-label="Chargement"><div className="spinner" /></div>
        ) : loadError ? (
          <div className="card border-red-200 p-6 text-center" data-testid="mandate-error">
            <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-3" aria-hidden="true" />
            <p className="text-gray-800 mb-4">{loadError}</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button onClick={load} className="rounded-xl bg-brand-teal hover:bg-brand-teal-dark text-white">Réessayer</Button>
              <Link to="/seller/dashboard"><Button variant="outline" className="rounded-xl w-full">Retour à mon espace</Button></Link>
            </div>
          </div>
        ) : signed ? (
          <SignedSummary mandate={signed} property={property} propertyId={propertyId} />
        ) : (
          <>
            <header className="mb-6">
              <p className="eyebrow mb-1">Dernière étape avant la publication</p>
              <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-brand-navy mb-3">Signez votre mandat de vente simple</h1>
              <p className="text-gray-700">
                La loi impose un mandat écrit avant la diffusion d'une annonce immobilière. Celui-ci est conclu avec {COMMISSION.mandateHolder} (carte professionnelle T) :
                sans exclusivité, pour {MANDATE_DURATION_MONTHS} mois, résiliable à tout moment avec un préavis de {MANDATE_NOTICE_DAYS} jours ; honoraires dus uniquement si la vente se fait avec un acquéreur que nous vous présentons.
              </p>
              <ul className="mt-4 grid sm:grid-cols-3 gap-3 text-sm" data-testid="mandate-terms">
                <li className="rounded-xl border border-brand-line bg-white p-3"><strong className="block text-brand-navy">{MANDATE_WITHDRAWAL_DAYS} jours pour vous rétracter</strong>Sans motif ni frais si vous êtes un particulier : la diffusion commence dès la signature, à votre demande.</li>
                <li className="rounded-xl border border-brand-line bg-white p-3"><strong className="block text-brand-navy">{MANDATE_DURATION_MONTHS} mois, sans exclusivité</strong>Vous restez libre de vendre seul ; prolongation par une nouvelle signature.</li>
                <li className="rounded-xl border border-brand-line bg-white p-3"><strong className="block text-brand-navy">Rien avant l'acte</strong>Honoraires réglés par le notaire à la signature de l'acte authentique ; clause de suite de {MANDATE_TAIL_MONTHS} mois.</li>
              </ul>
            </header>

            {identityRequired && (
              <section className="card border-amber-200 p-5 sm:p-6 mb-6" data-testid="identity-required">
                <p className="flex items-start gap-2 font-semibold text-brand-navy"><ShieldCheck className="w-5 h-5 mt-0.5 shrink-0 text-brand-amber" aria-hidden="true" />Vérifiez votre identité avant de signer</p>
                <p className="text-sm text-gray-700 mt-2 mb-4">La signature du mandat exige une identité vérifiée (pièce d'identité et selfie, environ 2 minutes, dans cet onglet). Si la vérification n'aboutit pas, nous vous recontactons par e-mail.</p>
                <KYCVerificationButton user={user} className="rounded-xl bg-brand-teal hover:bg-brand-teal-dark text-white" />
              </section>
            )}
            {emailRequired && (
              <p className="notice-amber mb-6" data-testid="email-required">Confirmez d'abord votre adresse e-mail : le code de signature y sera envoyé. Le lien de confirmation peut être renvoyé depuis le bandeau en haut de page.</p>
            )}

            <section className="card p-5 sm:p-6 mb-6" aria-labelledby="mandate-listing">
              <h2 id="mandate-listing" className="font-display text-lg font-bold text-brand-navy mb-4">Le bien</h2>
              {listingSummary}
              {fieldErrors.property && (
                <p role="alert" className="text-sm text-red-700 mt-3">
                  {fieldErrors.property} <Link to={`/seller/edit/${propertyId}`} className="underline font-medium">Compléter mon annonce</Link>
                </p>
              )}
            </section>

            {!contract ? (
              <form onSubmit={prepare} className="card p-5 sm:p-6 mb-6 space-y-5" noValidate data-testid="mandant-form">
                <div>
                  <h2 className="font-display text-lg font-bold text-brand-navy">Mandant et objet du mandat</h2>
                  <p className="text-sm text-gray-600 mt-1">Ces informations figurent dans le mandat (identification complète du mandant exigée par la loi). Elles n'apparaissent jamais sur l'annonce.</p>
                </div>
                <p className="flex items-start gap-2 text-sm text-gray-700"><MapPin className="w-4 h-4 mt-0.5 shrink-0 text-brand-teal" aria-hidden="true" /><span>Votre adresse postale, {user?.first_name ? `${user.first_name} ${user.last_name || ''}`.trim() : 'signataire'} (mandant) : elle peut différer de celle du bien loué.</span></p>
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Adresse (numéro et voie)" error={fieldErrors.line1} required className="sm:col-span-2">
                    {(p) => <TextInput value={address.line1} onChange={(v) => setAddress((a) => ({ ...a, line1: v }))} placeholder="12 rue des Lilas" testId="address-line1" {...p} />}
                  </Field>
                  <Field label="Complément" optional className="sm:col-span-2">
                    {(p) => <TextInput value={address.line2} onChange={(v) => setAddress((a) => ({ ...a, line2: v }))} placeholder="Résidence, escalier, lieu-dit" testId="address-line2" {...p} />}
                  </Field>
                  <Field label="Code postal" error={fieldErrors.postal_code} required>
                    {(p) => <TextInput value={address.postal_code} onChange={(v) => setAddress((a) => ({ ...a, postal_code: v.replace(/\D/g, '').slice(0, 5) }))} placeholder="29200" testId="address-postal-code" {...p} />}
                  </Field>
                  <Field label="Ville" error={fieldErrors.city} required>
                    {(p) => <TextInput value={address.city} onChange={(v) => setAddress((a) => ({ ...a, city: v }))} placeholder="Brest" testId="address-city" {...p} />}
                  </Field>
                  <Field label="Vous signez en qualité de" error={fieldErrors.capacity} required className="sm:col-span-2">
                    {(p) => <SelectInput value={capacity} onChange={setCapacity} options={capacities} testId="capacity-select" {...p} />}
                  </Field>
                </div>
                <fieldset>
                  <legend className="text-sm font-semibold text-brand-navy mb-1">Objet de la vente *</legend>
                  <p className="text-sm text-gray-600 mb-3">Repris de votre annonce ; modifiable ici.</p>
                  <div className={`grid gap-2 ${saleObjects.length > 1 ? 'sm:grid-cols-3' : ''}`} role="radiogroup" aria-label="Objet de la vente">
                    {saleObjects.map((o) => (
                      <label key={o.id} className={`flex items-start gap-3 rounded-xl border-2 px-4 py-3 cursor-pointer min-w-0 focus-within:ring-2 focus-within:ring-brand-teal ${saleObject === o.id ? 'border-brand-teal bg-brand-teal-soft' : 'border-brand-line bg-white hover:border-gray-400'}`} data-testid={`mandate-object-${o.id}`}>
                        <input type="radio" name="sale_object" value={o.id} checked={saleObject === o.id} onChange={() => setSaleObject(o.id)} className="mt-1 h-4 w-4 shrink-0 accent-[#0f766e]" />
                        <span className="text-sm font-semibold text-brand-navy leading-snug min-w-0">{o.label}</span>
                      </label>
                    ))}
                  </div>
                  {fieldErrors.sale_object && <p role="alert" className="text-sm text-red-700 mt-2">{fieldErrors.sale_object}</p>}
                </fieldset>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-1">
                  <Button type="submit" disabled={preparing} className="rounded-xl bg-brand-teal hover:bg-brand-teal-dark text-white h-12 px-6 text-base" data-testid="prepare-mandate">
                    {preparing ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <FileSignature className="w-5 h-5 mr-2" />}
                    Préparer mon mandat
                  </Button>
                  <p className="text-sm text-gray-500">Le texte complet s'affiche à l'étape suivante, avant toute signature.</p>
                </div>
              </form>
            ) : (
              <>
                <section className="card p-5 sm:p-6 mb-6" aria-labelledby="mandate-summary-title" data-testid="mandate-summary">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
                    <h2 id="mandate-summary-title" className="font-display text-lg font-bold text-brand-navy">L'essentiel en 5 points</h2>
                    <span className="text-xs text-gray-500">
                      {contract.contract_number ? `Réf. ${contract.contract_number}` : ''}{contract.terms_date ? ` · Version du ${contract.terms_date}` : ''}
                    </span>
                  </div>
                  <ol className="space-y-3">
                    {(contract.summary || []).map((line, i) => (
                      <li key={line} className="flex gap-3 text-sm text-gray-800 leading-relaxed">
                        <span className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-brand-teal text-white text-xs font-bold tabular" aria-hidden="true">{i + 1}</span>
                        <span className="min-w-0 break-words">{line}</span>
                      </li>
                    ))}
                  </ol>
                  {estimate && (
                    <p className="flex items-start gap-2 text-sm text-gray-700 mt-4 rounded-xl bg-brand-surface p-3">
                      <Info className="w-4 h-4 mt-0.5 shrink-0 text-brand-teal" aria-hidden="true" />
                      <span data-testid="mandate-fees">
                        Sur le prix de vente ({formatEuros(price)}), les honoraires seraient de <strong>{estimateText}</strong>, à votre charge, réglés par le notaire uniquement à la signature de l'acte authentique.
                        {' '}{commissionSentenceFor(commission)}
                      </span>
                    </p>
                  )}
                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={() => setExpanded((v) => !v)}
                      aria-expanded={expanded}
                      aria-controls="mandate-full-text"
                      className="inline-flex items-center gap-1 text-sm font-semibold text-brand-teal hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal rounded"
                      data-testid="toggle-mandate-text"
                    >
                      {expanded ? <ChevronUp className="w-4 h-4" aria-hidden="true" /> : <ChevronDown className="w-4 h-4" aria-hidden="true" />}
                      {expanded ? 'Replier le texte intégral' : 'Lire le texte intégral du mandat'}
                    </button>
                    {expanded && (
                      <div id="mandate-full-text" className="mt-3 bg-white border rounded-xl p-4 sm:p-6 max-h-[60vh] overflow-y-auto">
                        <pre className="whitespace-pre-wrap break-words text-sm font-serif leading-relaxed text-gray-800">{contract.content}</pre>
                      </div>
                    )}
                  </div>
                </section>

                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <Button onClick={() => setDialogOpen(true)} className="rounded-xl bg-brand-teal hover:bg-brand-teal-dark text-white h-12 px-6 text-base" data-testid="open-mandate-sign">
                    <FileSignature className="w-5 h-5 mr-2" />
                    Lire et signer le mandat
                  </Button>
                  <button type="button" onClick={() => setContract(null)} className="text-sm text-gray-600 hover:underline">Modifier l'adresse, la qualité ou l'objet</button>
                </div>

                <OtpSignatureDialog
                  open={dialogOpen}
                  onClose={() => setDialogOpen(false)}
                  title="Mandat de vente simple"
                  subtitle={contract.contract_number ? `Réf. ${contract.contract_number}` : undefined}
                  termsDate={contract.terms_date}
                  contractId={contract.contract_id}
                  documentText={contract.content}
                  summary={contract.summary}
                  acceptLabel="J'ai lu l'intégralité du mandat et j'en accepte les termes. Je comprends que cette signature électronique a valeur juridique."
                  signLabel="Signer le mandat"
                  onSign={handleSign}
                />
              </>
            )}

            <p className="text-sm text-gray-600 mt-6">
              Vous pourrez télécharger le mandat signé à tout moment depuis votre espace vendeur, vous rétracter dans les {MANDATE_WITHDRAWAL_DAYS} jours, le résilier en ligne ou le prolonger par une nouvelle signature.
            </p>
          </>
        )}
      </main>
    </div>
  );
};

export default MandatePage;
