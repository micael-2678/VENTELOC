import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertTriangle, ArrowLeft, ArrowRight, Eye, FileSignature, Globe, Info, Loader2, Lock, MapPin, Save, ShieldCheck, UserX,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { axiosInstance } from '@/App';
import { usePrivateSeo } from '@/lib/seo';
import AppHeader from '@/components/layout/AppHeader';
import PageBar from '@/components/layout/PageBar';
import { trackEvent } from '@/lib/analytics';
import {
  LEASE_TYPES, TENANT_PAYMENT_STATUSES, SALE_OBJECTS, SALE_REASONS, OWNER_TYPES, DPE_CLASSES, departementFromPostalCode, departementLabel,
  propertyTypeLabel,
} from '@/lib/referentiels';
import { computeCommission, formatEuros } from '@/lib/offer';
import { useCommission } from '@/lib/useCommission';
import { ListingCard, Checklist, formatYield } from '@/components/shared';
import { KYCVerificationButton } from '@/components/KYCVerification';
import { apiErrorMessage, isEmailNotVerifiedError } from '@/components/account/errors';
import PropertyTypePicker, { RadioCards } from '@/components/seller/PropertyTypePicker';
import OwnershipProofPanel from '@/components/seller/OwnershipProofPanel';
import PhotosPanel from '@/components/seller/PhotosPanel';
import { Field, NumberInput, TextInput, SelectInput, CheckCard, StepIndicator } from '@/components/seller/FormFields';
import { BlockingReasons } from '@/components/seller/ListingStatusBadge';
import { ownershipStatusOf } from '@/components/seller/listingStatus';
import {
  STEPS, BOUNDS, HELP, INDEXATIONS, MANAGEMENTS, GES_CLASSES, TENANT_DATA_WARNING, YIELD_RANGE,
  emptyForm, formFromProperty, applyEstimateToForm, readEstimateSession, clearEstimateSession, validateStep, stepPayload, createPayload,
  firstIncompleteStep, descriptionIssues, isCompanyOwner, isHousingType, hasRooms, hasFloor, hasUnits, defaultLeaseFor, liveYields,
  yieldAlert, previewProperty, fmtEur,
} from '@/components/seller/listingForm';

// Dépôt d'une annonce en 3 écrans (docs/venteloc/SPEC.md §5.2) : (1) le bien — type, propriétaire (SIRET si société),
// adresse confidentielle, code postal → ville, caractéristiques, copropriété (mentions obligatoires), DPE ; (2) la
// location — bail, loyer, charges, dates, dépôt de garantie, situation déclarée du locataire, taxe foncière, rendement en
// direct ; (3) la vente — prix (rendements recalculés, alerte hors 2 %-15 %), objet, motif, description, photos, aperçu
// de la carte publique. Brouillon serveur à chaque écran (POST /properties puis PUT /properties/{id}).
// Ensuite : justificatif de propriété → identité → mandat → publication automatique.

const GEO_URL = 'https://geo.api.gouv.fr/communes';

const isVerifiedUser = (user, kyc) => !!(kyc?.verified || user?.identity_verified || user?.kyc_status === 'verified');

const YES_NO = [{ value: 'oui', label: 'Oui' }, { value: 'non', label: 'Non' }];

// Communes d'un code postal (API publique et gratuite geo.api.gouv.fr) ; [] si indisponible : la ville se saisit à la main
export const fetchCities = async (postalCode) => {
  if (!/^\d{5}$/.test(String(postalCode || '')) || typeof fetch !== 'function') return [];
  try {
    const res = await fetch(`${GEO_URL}?codePostal=${postalCode}&fields=nom&format=json`, { credentials: 'omit' });
    if (!res || !res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data.map((c) => String(c?.nom || '')).filter(Boolean).sort((a, b) => a.localeCompare(b, 'fr')) : [];
  } catch (e) {
    return [];
  }
};

const SectionCard = ({ title, intro, icon: Icon, children, testId }) => (
  <section className="card p-4 sm:p-6 space-y-5" aria-label={title} data-testid={testId}>
    <div>
      <h2 className="font-display text-xl font-bold text-brand-navy flex items-center gap-2">
        {Icon && <Icon className="w-5 h-5 text-brand-teal shrink-0" aria-hidden="true" />}{title}
      </h2>
      {intro && <p className="text-sm text-gray-600 mt-1 leading-relaxed">{intro}</p>}
    </div>
    {children}
  </section>
);

// Classe énergie : pastilles A à G aux couleurs réglementaires, puis « DPE vierge » et « Non soumis »
const DPE_BG = { A: 'bg-dpe-A text-white', B: 'bg-dpe-B text-brand-navy', C: 'bg-dpe-C text-brand-navy', D: 'bg-dpe-D text-brand-navy', E: 'bg-dpe-E text-brand-navy', F: 'bg-dpe-F text-brand-navy', G: 'bg-dpe-G text-white' };
const DpeClassPicker = ({ value, onChange, error, housing }) => (
  <fieldset className="min-w-0" data-testid="dpe-picker">
    <legend className="text-sm font-semibold text-brand-navy mb-2">Classe énergie (DPE) <span aria-hidden="true">*</span></legend>
    <div className="flex flex-wrap gap-2">
      {DPE_CLASSES.filter((d) => !(housing && d.id === 'non-soumis')).map((d) => {
        const checked = value === d.id;
        const letter = DPE_BG[d.id];
        return (
          <label
            key={d.id}
            className={`inline-flex items-center justify-center rounded-lg border-2 cursor-pointer font-bold focus-within:ring-2 focus-within:ring-brand-teal focus-within:ring-offset-1 ${letter ? `w-11 h-11 text-lg ${letter}` : 'px-3 h-11 text-sm bg-white text-brand-navy'} ${checked ? 'border-brand-navy ring-2 ring-brand-navy' : letter ? 'border-transparent opacity-70 hover:opacity-100' : 'border-brand-line hover:border-gray-400'}`}
            data-testid={`dpe-${d.id}`}
          >
            <input type="radio" name="dpe_class" value={d.id} checked={checked} onChange={() => onChange(d.id)} className="sr-only" />
            <span aria-hidden={letter ? 'true' : undefined}>{d.label}</span>
            {letter && <span className="sr-only">Classe {d.id}</span>}
          </label>
        );
      })}
    </div>
    {!housing && <p className="text-sm text-gray-600 mt-2">Local commercial, bureaux, parking : « Non soumis » si le bien n'a pas de DPE.</p>}
    {error && <p role="alert" className="text-sm text-red-700 mt-2">{error}</p>}
  </fieldset>
);

// Rendements calculés en direct à partir du loyer, du prix et des charges saisis
const LiveYields = ({ form, testId = 'live-yields' }) => {
  const y = liveYields(form);
  const alert = yieldAlert(y.gross);
  return (
    <div className="rounded-xl border border-brand-teal-line/70 bg-brand-teal-soft p-4 min-w-0" data-testid={testId} aria-live="polite">
      <dl className="grid grid-cols-3 gap-3">
        <div className="min-w-0"><dt className="text-xs text-brand-teal-dark">Loyers annuels HC</dt><dd className="font-display text-lg font-bold text-brand-navy tabular">{y.annualRent ? fmtEur(y.annualRent) : '—'}</dd></div>
        <div className="min-w-0"><dt className="text-xs text-brand-teal-dark">Rendement brut</dt><dd className="font-display text-lg font-bold text-brand-teal-dark tabular" data-testid="live-gross">{formatYield(y.gross) || '—'}</dd></div>
        <div className="min-w-0"><dt className="text-xs text-brand-teal-dark">Rendement net</dt><dd className="font-display text-lg font-bold text-brand-navy tabular" data-testid="live-net">{formatYield(y.net) || '—'}</dd></div>
      </dl>
      {!y.gross && <p className="text-xs text-gray-700 mt-2">Le rendement s'affiche dès que le loyer et le prix sont saisis.</p>}
      {alert && (
        <p className="notice-amber flex items-start gap-2 mt-3" role="status" data-testid="yield-alert">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            Rendement brut {alert === 'low' ? `inférieur à ${YIELD_RANGE.min} %` : `supérieur à ${YIELD_RANGE.max} %`} : vérifiez le loyer (mensuel, hors charges) et le prix.
            {alert === 'low' ? ' Un prix trop élevé pour le loyer décourage les investisseurs.' : ' Un rendement aussi élevé suscite la méfiance des acquéreurs.'}
          </span>
        </p>
      )}
    </div>
  );
};

const CreateListing = ({ user }) => {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const editId = params.id || searchParams.get('edit') || '';
  usePrivateSeo(editId ? 'Modifier mon annonce' : 'Déposer une annonce');
  const navigate = useNavigate();
  const commission = useCommission();

  const [propertyId, setPropertyId] = useState(editId);
  const [property, setProperty] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [step, setStep] = useState(1);
  const [maxStep, setMaxStep] = useState(1);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(!!editId);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [kyc, setKyc] = useState(null);
  const [done, setDone] = useState(false);
  const [estimateRange, setEstimateRange] = useState(null); // { low, high }
  const [cities, setCities] = useState([]);

  const locked = !!(property && (property.mandat_signed || ['published', 'paused'].includes(property.status)));
  const verified = isVerifiedUser(user, kyc);
  const company = isCompanyOwner(form.owner_type);
  const housing = isHousingType(form.property_type);

  const update = useCallback((patch) => setForm((f) => ({ ...f, ...(typeof patch === 'function' ? patch(f) : patch) })), []);
  const setField = (key) => (value) => {
    update({ [key]: value });
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  };

  // Chargement : brouillon existant (reprise) ou préremplissage depuis l'estimateur
  useEffect(() => {
    let cancelled = false;
    axiosInstance.get('/kyc/status').then((r) => { if (!cancelled) setKyc(r.data); }).catch(() => {});
    if (editId) {
      axiosInstance.get(`/properties/${editId}`)
        .then((r) => {
          if (cancelled) return;
          const c = r.data || {};
          setProperty(c);
          const f = formFromProperty(c);
          setForm(f);
          setStep(firstIncompleteStep(f));
          setMaxStep(3);
        })
        .catch(() => { if (!cancelled) { toast.error('Annonce introuvable.'); navigate('/seller/dashboard'); } })
        .finally(() => { if (!cancelled) setLoading(false); });
    } else {
      const est = readEstimateSession();
      if (est) {
        setForm((f) => applyEstimateToForm(f, est));
        if (est.result && est.result.low && est.result.high) setEstimateRange({ low: est.result.low, high: est.result.high });
      }
    }
    return () => { cancelled = true; };
  }, [editId, navigate]);

  // Code postal → communes (liste) ; une seule commune : ville remplie d'office
  useEffect(() => {
    let alive = true;
    if (!/^\d{5}$/.test(form.postal_code)) { setCities([]); return undefined; }
    fetchCities(form.postal_code).then((list) => {
      if (!alive) return;
      setCities(list);
      if (list.length === 1) setForm((f) => (f.city ? f : { ...f, city: list[0] }));
    });
    return () => { alive = false; };
  }, [form.postal_code]);

  // Changement de type de bien : bail proposé (modifiable) ; un bien hors société ne peut vendre que le bien
  useEffect(() => {
    if (!form.property_type) return;
    setForm((f) => (f.lease_type ? f : { ...f, lease_type: defaultLeaseFor(f.property_type) }));
  }, [form.property_type]);
  useEffect(() => {
    if (!company && form.sale_object && form.sale_object !== 'bien') setForm((f) => ({ ...f, sale_object: 'bien' }));
    if (!company && !form.sale_object && form.owner_type) setForm((f) => ({ ...f, sale_object: 'bien' }));
  }, [company, form.sale_object, form.owner_type]);

  const priceVsEstimate = useMemo(() => {
    if (!estimateRange || form.asking_price === '') return null;
    const p = Number(form.asking_price);
    if (!(p > 0)) return null;
    if (p < estimateRange.low * 0.9) return 'low';
    if (p > estimateRange.high * 1.1) return 'high';
    return 'ok';
  }, [estimateRange, form.asking_price]);

  // Sauvegarde serveur de l'écran courant : POST au premier écran, PUT ensuite
  const save = async (current) => {
    const errs = validateStep(current, form);
    setErrors(errs);
    if (Object.keys(errs).length) {
      toast.error('Vérifiez les champs signalés.');
      return null;
    }
    setSaving(true);
    try {
      let saved;
      if (!propertyId) {
        const res = await axiosInstance.post('/properties', createPayload(form));
        saved = res.data || {};
        setPropertyId(saved.id);
        trackEvent('listing_created', { step: current, property_type: form.property_type });
      } else {
        const payload = stepPayload(current, form);
        if (locked) ['owner_type', 'company_name', 'siret', 'address', 'postal_code'].forEach((k) => { delete payload[k]; });
        const res = await axiosInstance.put(`/properties/${propertyId}`, payload);
        saved = res.data || {};
      }
      setProperty((p) => ({ ...(p || {}), ...saved }));
      setSavedAt(new Date());
      return saved;
    } catch (error) {
      if (!isEmailNotVerifiedError(error)) toast.error(apiErrorMessage(error, 'L\'enregistrement a échoué. Réessayez.'));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const next = async () => {
    const saved = await save(step);
    if (!saved) return;
    if (step < 3) {
      const s = step + 1;
      setStep(s);
      setMaxStep((m) => Math.max(m, s));
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    clearEstimateSession();
    if (locked) {
      toast.success('Annonce mise à jour.');
      navigate('/seller/dashboard');
      return;
    }
    const id = saved.id || propertyId;
    try { sessionStorage.setItem('kyc_return_to', `/seller/mandat/${id}`); } catch (e) { /* stockage indisponible */ }
    const proofDone = ['pending', 'verified'].includes(ownershipStatusOf({ ...(property || {}), ...saved }));
    if (verified && proofDone) {
      navigate(`/seller/mandat/${id}`);
      return;
    }
    setDone(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const back = () => {
    if (step > 1) {
      setStep(step - 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const goToStep = async (s) => {
    if (s === step) return;
    if (s > step) {
      const saved = await save(step);
      if (!saved) return;
    } else {
      await save(step);
    }
    setStep(s);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const onBlockingAction = (reason) => {
    if (reason.action === 'confirm_email') {
      axiosInstance.post('/auth/resend-verification').then(() => toast.success('Lien de confirmation renvoyé.')).catch((e) => toast.error(apiErrorMessage(e)));
    } else if (reason.action === 'edit') {
      setStep(reason.step || 1);
    } else if (reason.action === 'sign_mandate' && propertyId) {
      navigate(`/seller/mandat/${propertyId}`);
    } else if (reason.action === 'ownership' || reason.action === 'verify_identity') {
      setDone(true);
    }
  };

  const descr = descriptionIssues(form.description);
  const department = departementFromPostalCode(form.postal_code) || form.department;
  const fees = Number(form.asking_price) > 0 ? computeCommission(Number(form.asking_price), commission) : null;

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen" role="status" aria-label="Chargement"><div className="spinner" /></div>;
  }

  const Nav = (
    <>
      <AppHeader user={user} />
      <PageBar backTo="/seller/dashboard" backLabel="Mon espace" title={editId ? 'Mon annonce' : 'Nouvelle annonce'} width="max-w-5xl">
        {savedAt && (
          <span className="text-sm text-gray-600 hidden sm:inline" data-testid="saved-at">
            Brouillon enregistré à {savedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </PageBar>
    </>
  );

  if (done) {
    const id = propertyId;
    const proof = ownershipStatusOf(property);
    const proofDone = ['pending', 'verified'].includes(proof);
    const items = [
      { id: 'listing', label: 'Annonce enregistrée', description: 'Vous pouvez la modifier à tout moment depuis votre espace.', state: 'done' },
      {
        id: 'ownership',
        label: 'Déposez votre justificatif de propriété',
        description: 'Titre de propriété, attestation notariée, avis de taxe foncière ou statuts de la SCI. Contrôlé par nos équipes, jamais montré aux acquéreurs.',
        state: proofDone ? 'done' : 'current',
        action: <div className="card p-4"><OwnershipProofPanel property={property} compact onChanged={(ownership) => setProperty((p) => ({ ...(p || {}), ownership }))} /></div>,
      },
      {
        id: 'identity',
        label: 'Vérifiez votre identité',
        description: 'Pièce d\'identité et selfie, dans ce même onglet (environ 2 minutes). Si la vérification n\'aboutit pas, nous vous recontactons par e-mail.',
        state: verified ? 'done' : proofDone ? 'current' : 'todo',
        action: <KYCVerificationButton user={user} className="rounded-xl bg-brand-teal hover:bg-brand-teal-dark text-white" />,
      },
      {
        id: 'mandate',
        label: 'Signez votre mandat de vente simple',
        description: 'Sans exclusivité, 12 mois, résiliable à tout moment avec un préavis de 15 jours ; 14 jours pour vous rétracter. Résumé en 5 points, signature par code reçu par e-mail.',
        state: verified && proofDone ? 'current' : 'todo',
        action: (
          <Link to={`/seller/mandat/${id}`} className="btn-primary" data-testid="go-mandate">
            <FileSignature className="w-4 h-4" aria-hidden="true" />
            Signer le mandat
          </Link>
        ),
      },
      { id: 'publish', label: 'Publication immédiate', description: 'Dès la signature, si les contrôles automatiques passent (e-mail confirmé, identité vérifiée, justificatif déposé, informations obligatoires).', state: 'todo' },
    ];
    return (
      <div className="min-h-screen bg-brand-surface">
        {Nav}
        <main id="contenu" className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-6">
          <header>
            <p className="eyebrow mb-1">Annonce enregistrée</p>
            <h1 className="font-display text-3xl font-extrabold text-brand-navy">Encore quelques étapes avant la mise en ligne</h1>
          </header>
          <section className="card p-5 sm:p-6" data-testid="publish-checklist">
            <Checklist items={items} title="Avant la publication" />
          </section>
          <Link to="/seller/dashboard" className="btn-link">Aller à mon espace vendeur</Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-surface">
      {Nav}
      <main id="contenu" className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <header className="mb-6">
          <p className="eyebrow mb-1">{editId ? 'Modification' : 'Dépôt d\'annonce'}</p>
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-brand-navy mb-3">
            {step === 1 ? 'Votre bien' : step === 2 ? 'La location en cours' : 'Votre prix et votre annonce'}
          </h1>
          <StepIndicator steps={STEPS} current={step} onSelect={goToStep} maxReachable={maxStep} />
          <p className="text-sm text-gray-600 mt-3">Votre saisie est enregistrée en brouillon à chaque écran : vous pouvez reprendre plus tard depuis votre espace.</p>
        </header>

        {property && <div className="mb-6"><BlockingReasons property={property} onAction={onBlockingAction} /></div>}

        {locked && (
          <p className="notice-amber flex items-start gap-2 mb-6" data-testid="locked-notice">
            <Lock className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>Mandat signé : le propriétaire, la société, le SIRET et l'adresse du bien ne sont plus modifiables (ils figurent dans le mandat).</span>
          </p>
        )}

        <form onSubmit={(e) => { e.preventDefault(); next(); }} className="space-y-6" data-testid="create-listing-form" noValidate>
          {step === 1 && (
            <>
              <SectionCard title="Le bien" testId="section-type">
                <PropertyTypePicker value={form.property_type} onChange={setField('property_type')} error={errors.property_type} />
              </SectionCard>

              <SectionCard title="Propriétaire" intro="Qui est propriétaire du bien aujourd'hui ? Il signera le mandat et l'acte de vente.">
                <RadioCards
                  name="owner_type"
                  options={OWNER_TYPES.map((o) => ({ value: o.id, label: o.label }))}
                  value={form.owner_type}
                  onChange={setField('owner_type')}
                  error={errors.owner_type}
                  disabled={locked}
                  testIdPrefix="owner-type"
                />
                {company && (
                  <div className="grid sm:grid-cols-2 gap-4" data-testid="company-fields">
                    <Field label="Dénomination de la société" error={errors.company_name} required hint="Confidentielle : jamais affichée sur l'annonce.">
                      {(p) => <TextInput value={form.company_name} onChange={setField('company_name')} disabled={locked} placeholder="SCI Les Tilleuls" testId="company-name-input" {...p} />}
                    </Field>
                    <Field label="SIRET" error={errors.siret} required help={HELP.company}>
                      {(p) => <TextInput value={form.siret} onChange={(v) => setField('siret')(v.replace(/\D/g, '').slice(0, 14))} disabled={locked} placeholder="14 chiffres" testId="siret-input" {...p} />}
                    </Field>
                  </div>
                )}
              </SectionCard>

              <SectionCard title="Localisation" icon={MapPin} intro="Seuls la ville, le département et le quartier apparaissent sur l'annonce.">
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Adresse du bien" help={HELP.address} hint="Confidentielle : révélée seulement après l'engagement de confidentialité." className="sm:col-span-2" optional>
                    {(p) => <TextInput value={form.address} onChange={setField('address')} disabled={locked} placeholder="12 rue des Tilleuls" testId="address-input" {...p} />}
                  </Field>
                  <Field label="Code postal" error={errors.postal_code} required hint={department ? departementLabel(department) : undefined}>
                    {(p) => <TextInput value={form.postal_code} onChange={(v) => { setField('postal_code')(v.replace(/\D/g, '').slice(0, 5)); if (cities.length) update({ city: '' }); }} disabled={locked} placeholder="69007" testId="postal-code-input" {...p} />}
                  </Field>
                  <Field label="Ville" error={errors.city} required>
                    {(p) => (cities.length > 1
                      ? <SelectInput value={form.city} onChange={setField('city')} options={cities.map((c) => ({ value: c, label: c }))} placeholder="Choisir la commune" testId="city-select" {...p} />
                      : <TextInput value={form.city} onChange={setField('city')} placeholder="Lyon" testId="city-input" {...p} />)}
                  </Field>
                  <Field label="Quartier" optional hint="Public : aide les acquéreurs à situer le bien sans l'identifier.">
                    {(p) => <TextInput value={form.district} onChange={setField('district')} maxLength={80} placeholder="Jean Macé" testId="district-input" {...p} />}
                  </Field>
                </div>
              </SectionCard>

              <SectionCard title="Caractéristiques">
                <div className="grid sm:grid-cols-3 gap-4">
                  <Field label="Surface" help={HELP.surface} error={errors.surface} required={form.property_type !== 'parking'} optional={form.property_type === 'parking'}>
                    {(p) => <NumberInput value={form.surface} onChange={setField('surface')} min={BOUNDS.surface.min} max={BOUNDS.surface.max} step="0.1" suffix="m²" testId="surface-input" {...p} />}
                  </Field>
                  {hasRooms(form.property_type) && (
                    <Field label="Pièces" error={errors.rooms} optional>
                      {(p) => <NumberInput value={form.rooms} onChange={setField('rooms')} min={BOUNDS.rooms.min} max={BOUNDS.rooms.max} suffix="" testId="rooms-input" {...p} />}
                    </Field>
                  )}
                  {hasFloor(form.property_type) && (
                    <Field label="Étage" error={errors.floor} optional hint="0 pour le rez-de-chaussée.">
                      {(p) => <NumberInput value={form.floor} onChange={setField('floor')} min={BOUNDS.floor.min} max={BOUNDS.floor.max} suffix="" testId="floor-input" {...p} />}
                    </Field>
                  )}
                  <Field label="Année de construction" error={errors.construction_year} optional>
                    {(p) => <NumberInput value={form.construction_year} onChange={setField('construction_year')} min={BOUNDS.year.min} max={BOUNDS.year.max} suffix="" testId="year-input" {...p} />}
                  </Field>
                  {hasUnits(form.property_type, form.lease_type) && (
                    <>
                      <Field label="Nombre de lots" error={errors.units_count} optional>
                        {(p) => <NumberInput value={form.units_count} onChange={setField('units_count')} min={BOUNDS.units.min} max={BOUNDS.units.max} suffix="" testId="units-input" {...p} />}
                      </Field>
                      <Field label="Dont lots loués" error={errors.units_rented} optional>
                        {(p) => <NumberInput value={form.units_rented} onChange={setField('units_rented')} min={0} max={BOUNDS.units.max} suffix="" testId="units-rented-input" {...p} />}
                      </Field>
                    </>
                  )}
                </div>
                {hasFloor(form.property_type) && (
                  <RadioCards legend="Ascenseur" name="elevator" options={YES_NO} value={form.elevator} onChange={setField('elevator')} columns="grid-cols-2 max-w-xs" testIdPrefix="elevator" />
                )}
              </SectionCard>

              <SectionCard title="Copropriété" intro={HELP.copro} testId="section-copro">
                <RadioCards legend="Le bien est-il en copropriété ?" name="is_copro" required options={YES_NO} value={form.is_copro} onChange={setField('is_copro')} error={errors.is_copro} columns="grid-cols-2 max-w-xs" testIdPrefix="copro" />
                {form.is_copro === 'oui' && (
                  <div className="space-y-4" data-testid="copro-fields">
                    <div className="grid sm:grid-cols-2 gap-4">
                      <Field label="Nombre de lots de la copropriété" error={errors.copro_lots} required>
                        {(p) => <NumberInput value={form.copro_lots} onChange={setField('copro_lots')} min={1} suffix="lots" testId="copro-lots-input" {...p} />}
                      </Field>
                      <Field label="Quote-part annuelle de charges courantes" help={HELP.copro_charges_annual} error={errors.copro_charges_annual} required>
                        {(p) => <NumberInput value={form.copro_charges_annual} onChange={setField('copro_charges_annual')} min={0} suffix="€/an" testId="copro-charges-input" {...p} />}
                      </Field>
                    </div>
                    <RadioCards legend="Procédure en cours contre le syndicat des copropriétaires ?" hint={HELP.copro_procedure} name="copro_procedure" required options={YES_NO} value={form.copro_procedure} onChange={setField('copro_procedure')} error={errors.copro_procedure} columns="grid-cols-2 max-w-xs" testIdPrefix="copro-procedure" />
                  </div>
                )}
              </SectionCard>

              <SectionCard title="Performance énergétique" intro={HELP.dpe} testId="section-dpe">
                <DpeClassPicker value={form.dpe_class} onChange={setField('dpe_class')} error={errors.dpe_class} housing={housing} />
                {/^[A-G]$/.test(form.dpe_class) && (
                  <div className="grid sm:grid-cols-2 gap-4">
                    <Field label="Classe climat (GES)" optional>
                      {(p) => <SelectInput value={form.ges_class} onChange={setField('ges_class')} options={GES_CLASSES.map((g) => ({ value: g, label: g }))} placeholder="Non renseignée" testId="ges-select" {...p} />}
                    </Field>
                    <Field label="Date du DPE" optional>
                      {(p) => <TextInput type="date" value={form.dpe_date} onChange={setField('dpe_date')} testId="dpe-date-input" {...p} />}
                    </Field>
                    <Field label="Dépenses d'énergie : montant bas" help={HELP.energy_cost} error={errors.energy_cost} required={housing} optional={!housing}>
                      {(p) => <NumberInput value={form.energy_cost_min} onChange={setField('energy_cost_min')} min={0} suffix="€/an" testId="energy-min-input" {...p} />}
                    </Field>
                    <Field label="Dépenses d'énergie : montant haut" required={housing} optional={!housing}>
                      {(p) => <NumberInput value={form.energy_cost_max} onChange={setField('energy_cost_max')} min={0} suffix="€/an" testId="energy-max-input" {...p} />}
                    </Field>
                  </div>
                )}
                {['F', 'G'].includes(form.dpe_class) && housing && (
                  <p className="notice-amber flex items-start gap-2" data-testid="dpe-warning">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                    <span>Logement classé {form.dpe_class} : {form.dpe_class === 'G' ? 'depuis le 1er janvier 2025' : 'à partir du 1er janvier 2028'}, il ne peut plus faire l'objet d'un nouveau bail ni d'un renouvellement. Le bail en cours continue : la vente reste possible et l'annonce l'indique clairement.</span>
                  </p>
                )}
              </SectionCard>
            </>
          )}

          {step === 2 && (
            <>
              <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-brand-amber-soft px-4 py-3 text-sm font-medium text-brand-amber" role="note" data-testid="tenant-warning">
                <UserX className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                <span>{TENANT_DATA_WARNING} L'annonce décrit le bail, jamais la personne.</span>
              </p>

              <SectionCard title="Le bail" testId="section-lease">
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Type de bail" error={errors.lease_type} required className="sm:col-span-2">
                    {(p) => <SelectInput value={form.lease_type} onChange={setField('lease_type')} options={LEASE_TYPES.map((l) => ({ value: l.id, label: l.label }))} testId="lease-type-select" {...p} />}
                  </Field>
                  <Field label="Loyer mensuel hors charges" help={HELP.rent_monthly} error={errors.rent_monthly} required>
                    {(p) => <NumberInput value={form.rent_monthly} onChange={setField('rent_monthly')} min={BOUNDS.rent.min} max={BOUNDS.rent.max} suffix="€/mois" testId="rent-input" {...p} />}
                  </Field>
                  <Field label="Provisions sur charges" help={HELP.charges_monthly} error={errors.charges_monthly} optional>
                    {(p) => <NumberInput value={form.charges_monthly} onChange={setField('charges_monthly')} min={0} suffix="€/mois" testId="charges-input" {...p} />}
                  </Field>
                  <Field label="Début du bail en cours" error={errors.lease_start} required>
                    {(p) => <TextInput type="date" value={form.lease_start} onChange={setField('lease_start')} testId="lease-start-input" {...p} />}
                  </Field>
                  <Field label="Prochaine échéance du bail" error={errors.lease_end} optional>
                    {(p) => <TextInput type="date" value={form.lease_end} onChange={setField('lease_end')} testId="lease-end-input" {...p} />}
                  </Field>
                  <Field label="Entrée du locataire dans les lieux" optional hint="Si elle précède le bail en cours (renouvellement).">
                    {(p) => <TextInput type="date" value={form.tenant_since} onChange={setField('tenant_since')} testId="tenant-since-input" {...p} />}
                  </Field>
                  <Field label="Dépôt de garantie" help={HELP.deposit} error={errors.deposit} optional>
                    {(p) => <NumberInput value={form.deposit} onChange={setField('deposit')} min={0} testId="deposit-input" {...p} />}
                  </Field>
                  <Field label="Indexation du loyer" optional>
                    {(p) => <SelectInput value={form.indexation} onChange={setField('indexation')} options={INDEXATIONS} placeholder="Non renseignée" testId="indexation-select" {...p} />}
                  </Field>
                  <Field label="Dernière révision du loyer" optional>
                    {(p) => <TextInput type="date" value={form.last_revision} onChange={setField('last_revision')} testId="last-revision-input" {...p} />}
                  </Field>
                  {(form.property_type === 'residence-geree' || form.lease_type === 'residence-geree') && (
                    <Field label="Fin du bail commercial de l'exploitant" optional>
                      {(p) => <TextInput type="date" value={form.operator_lease_end} onChange={setField('operator_lease_end')} testId="operator-lease-end-input" {...p} />}
                    </Field>
                  )}
                </div>
              </SectionCard>

              <SectionCard title="Le locataire et les garanties" intro={HELP.tenant_payment_status}>
                <RadioCards
                  legend="Paiement des loyers sur les 12 derniers mois"
                  name="tenant_payment_status"
                  options={TENANT_PAYMENT_STATUSES.map((t) => ({ value: t.id, label: t.label }))}
                  value={form.tenant_payment_status}
                  onChange={setField('tenant_payment_status')}
                  columns="sm:grid-cols-3"
                  testIdPrefix="tenant-payment"
                />
                <div className="grid sm:grid-cols-2 gap-4">
                  <RadioCards legend="Garantie loyers impayés (GLI)" name="has_gli" options={YES_NO} value={form.has_gli} onChange={setField('has_gli')} columns="grid-cols-2" testIdPrefix="gli" />
                  <RadioCards legend="Caution (garant) du locataire" name="has_guarantor" options={YES_NO} value={form.has_guarantor} onChange={setField('has_guarantor')} columns="grid-cols-2" testIdPrefix="guarantor" />
                </div>
              </SectionCard>

              <SectionCard title="Charges du propriétaire" intro="Elles donnent le rendement net, celui que regardent les investisseurs.">
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Taxe foncière annuelle" help={HELP.property_tax} error={errors.property_tax} optional>
                    {(p) => <NumberInput value={form.property_tax} onChange={setField('property_tax')} min={0} suffix="€/an" testId="property-tax-input" {...p} />}
                  </Field>
                  <Field label="Charges non récupérables par an" help={HELP.non_recoverable_charges} error={errors.non_recoverable_charges} optional>
                    {(p) => <NumberInput value={form.non_recoverable_charges} onChange={setField('non_recoverable_charges')} min={0} suffix="€/an" testId="non-recoverable-input" {...p} />}
                  </Field>
                  <Field label="Gestion locative" optional>
                    {(p) => <SelectInput value={form.management} onChange={setField('management')} options={MANAGEMENTS} placeholder="Non renseignée" testId="management-select" {...p} />}
                  </Field>
                </div>
                <LiveYields form={form} />
              </SectionCard>
            </>
          )}

          {step === 3 && (
            <>
              <SectionCard title="Prix de vente" testId="section-price">
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Prix de vente, honoraires inclus" help={HELP.asking_price} error={errors.asking_price} required>
                    {(p) => <NumberInput value={form.asking_price} onChange={setField('asking_price')} min={BOUNDS.price.min} max={BOUNDS.price.max} testId="asking-price-input" {...p} />}
                  </Field>
                  {fees && (
                    <div className="rounded-xl border border-brand-line bg-brand-surface p-3 text-sm text-gray-800 min-w-0" data-testid="price-fees">
                      <p>Honoraires à votre charge : <strong className="tabular">{formatEuros(fees.ttc)} TTC</strong> <span className="text-gray-600">({formatEuros(fees.ht)} HT)</span>, réglés par le notaire à l'acte.</p>
                      <p className="mt-1">Vous percevez environ <strong className="tabular">{formatEuros(fees.netSeller)}</strong> avant vos autres frais.</p>
                    </div>
                  )}
                </div>
                <LiveYields form={form} testId="live-yields-price" />
                {priceVsEstimate && priceVsEstimate !== 'ok' && (
                  <p className="notice-amber flex items-start gap-2" role="status" data-testid="price-alert">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                    <span>
                      Votre prix est {priceVsEstimate === 'high' ? 'au-dessus' : 'en dessous'} de la fourchette indicative de l'estimateur
                      ({fmtEur(estimateRange.low)} à {fmtEur(estimateRange.high)}). Ce n'est pas bloquant.
                    </span>
                  </p>
                )}
                {priceVsEstimate === 'ok' && (
                  <p className="flex items-start gap-2 text-sm text-gray-700" data-testid="price-ok">
                    <Info className="w-4 h-4 mt-0.5 shrink-0 text-brand-teal" aria-hidden="true" />
                    <span>Prix dans la fourchette indicative de l'estimateur ({fmtEur(estimateRange.low)} à {fmtEur(estimateRange.high)}).</span>
                  </p>
                )}
              </SectionCard>

              <SectionCard title="La vente">
                <RadioCards
                  legend="Ce que vous vendez"
                  name="sale_object"
                  required
                  hint={company ? 'Le bien lui-même, les parts de la société propriétaire, ou à décider avec l\'acquéreur.' : 'Un bien détenu en nom propre ou en indivision se vend directement.'}
                  options={SALE_OBJECTS.filter((o) => company || o.id === 'bien').map((o) => ({ value: o.id, label: o.label }))}
                  value={form.sale_object}
                  onChange={setField('sale_object')}
                  error={errors.sale_object}
                  columns="sm:grid-cols-3"
                  testIdPrefix="sale-object"
                />
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Motif de la vente" optional>
                    {(p) => <SelectInput value={form.sale_reason} onChange={setField('sale_reason')} options={SALE_REASONS.map((r) => ({ value: r.id, label: r.label }))} testId="sale-reason-select" {...p} />}
                  </Field>
                  <Field label="Disponibilité" error={errors.availability_note} optional hint="Ex. : signature possible à partir de mars.">
                    {(p) => <TextInput value={form.availability_note} onChange={setField('availability_note')} maxLength={120} testId="availability-input" {...p} />}
                  </Field>
                </div>
              </SectionCard>

              <SectionCard title="Présentation">
                <Field label="Description du bien" help={HELP.description} error={errors.description} required>
                  {(p) => (
                    <div>
                      <textarea
                        value={form.description}
                        onChange={(e) => setField('description')(e.target.value)}
                        rows={8}
                        maxLength={BOUNDS.description.max + 200}
                        placeholder="Appartement de deux pièces au troisième étage avec ascenseur, lumineux et traversant, à cinq minutes du métro. Loué depuis 2019 à un locataire stable, loyer révisé chaque année…"
                        className={`w-full rounded-xl border bg-white px-4 py-3 text-base text-brand-navy placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-teal/30 ${errors.description ? 'border-red-400' : 'border-brand-line focus:border-brand-teal'}`}
                        data-testid="description-input"
                        {...p}
                      />
                      <div className="flex flex-wrap items-center justify-between gap-2 mt-1 text-sm">
                        <span className={descr.contacts.length ? 'text-red-700 font-medium' : 'text-gray-600'} data-testid="description-contacts">
                          {descr.contacts.length ? `Coordonnées détectées : ${descr.contacts.join(', ')}. Retirez-les.` : 'Sans nom, téléphone, e-mail, site web ni adresse exacte.'}
                        </span>
                        <span className={`tabular ${descr.tooLong || descr.tooShort ? 'text-brand-amber' : 'text-gray-600'}`} data-testid="description-count">
                          {descr.length} / {BOUNDS.description.max} caractères{descr.length < BOUNDS.description.min ? ` (minimum ${BOUNDS.description.min})` : ''}
                        </span>
                      </div>
                    </div>
                  )}
                </Field>
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Équipements et annexes" error={errors.equipment} optional hint="Ex. : cave, balcon, place de parking, cuisine équipée.">
                    {(p) => <TextInput value={form.equipment} onChange={setField('equipment')} maxLength={300} testId="equipment-input" {...p} />}
                  </Field>
                  <Field label="Travaux récents" error={errors.recent_works} optional hint="Ex. : fenêtres changées en 2022, chaudière neuve.">
                    {(p) => <TextInput value={form.recent_works} onChange={setField('recent_works')} maxLength={300} testId="works-input" {...p} />}
                  </Field>
                </div>
                <CheckCard
                  checked={!!form.auto_accept_dataroom}
                  onChange={(v) => update({ auto_accept_dataroom: v })}
                  label="Accepter automatiquement les demandes de dossier des acquéreurs au projet renseigné"
                  hint={HELP.auto_accept_dataroom}
                  testId="auto-accept-dataroom"
                />
              </SectionCard>

              {propertyId && (
                <SectionCard title="Photos" intro="Facultatives, mais une annonce avec photos est bien plus consultée.">
                  <PhotosPanel propertyId={propertyId} />
                </SectionCard>
              )}

              <SectionCard title="Aperçu de votre annonce" icon={Eye}>
                <div className="min-w-0" data-testid="listing-preview">
                  <p className="flex items-start gap-2 text-sm text-gray-600 mb-3">
                    <Lock className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                    <span>Ce que voient les acquéreurs : ni adresse, ni nom, ni société. Ils sont révélés après l'engagement de confidentialité.</span>
                  </p>
                  <div onClickCapture={(e) => { e.preventDefault(); e.stopPropagation(); }} className="max-w-sm">
                    <ListingCard property={previewProperty(form)} source="preview" />
                  </div>
                </div>
              </SectionCard>
            </>
          )}

          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
            <div className="flex items-center gap-3">
              {step > 1 ? (
                <Button type="button" variant="outline" onClick={back} className="rounded-xl" data-testid="prev-step">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Précédent
                </Button>
              ) : (
                <Link to="/seller/dashboard" className="text-sm text-gray-600 hover:underline">Annuler</Link>
              )}
              {savedAt && <span className="text-sm text-gray-600 sm:hidden">Enregistré à {savedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>}
            </div>
            <Button type="submit" disabled={saving} className="rounded-xl bg-brand-teal hover:bg-brand-teal-dark text-white h-12 px-6 text-base" data-testid="next-step">
              {saving ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : step < 3 ? <Save className="w-5 h-5 mr-2" /> : locked ? <Globe className="w-5 h-5 mr-2" /> : <ShieldCheck className="w-5 h-5 mr-2" />}
              {step < 3 ? 'Enregistrer et continuer' : locked ? 'Enregistrer les modifications' : 'Enregistrer et passer à la publication'}
              {step < 3 && <ArrowRight className="w-5 h-5 ml-2" />}
            </Button>
          </div>
        </form>

        {step === 3 && !locked && (
          <p className="text-sm text-gray-600 mt-6">
            Ensuite : justificatif de propriété, vérification d'identité (si ce n'est pas déjà fait) puis mandat de vente simple signé par code.
            Publication immédiate si les contrôles passent, sans validation humaine.
            {form.property_type ? ` Titre généré : « ${previewProperty(form).title} » (${propertyTypeLabel(form.property_type, true)}).` : ''}
          </p>
        )}
      </main>
    </div>
  );
};

export default CreateListing;
