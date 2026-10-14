import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeft, ArrowRight, ChevronDown, Loader2, Save, CheckCircle, ShieldCheck, FileSignature, Globe, Info, Lock, Eye, AlertTriangle, UserPlus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { axiosInstance } from '@/App';
import { usePrivateSeo } from '@/lib/seo';
import AppHeader from '@/components/layout/AppHeader';
import PageBar from '@/components/layout/PageBar';
import { trackEvent } from '@/lib/analytics';
import { REGIONS, RGE_TYPES, OTHER_QUALIFICATIONS, departementOptions, regionForDepartement, tradeLabel } from '@/lib/referentiels';
import { ListingCard, Checklist, listingTitle } from '@/components/shared';
import { KYCVerificationButton } from '@/components/KYCVerification';
import { InvitePresidentModal, useDirigeantVerification } from '@/components/DirigeantVerification';
import SiretField from '@/components/account/SiretField';
import { useCompanyLookup } from '@/components/account/siret';
import { apiErrorMessage, isEmailNotVerifiedError } from '@/components/account/errors';
import MultiSelectList from '@/components/MultiSelectList';
import TradePicker from '@/components/seller/TradePicker';
import { Field, NumberInput, TextInput, SelectInput, CheckCard, StepIndicator } from '@/components/seller/FormFields';
import { BlockingReasons } from '@/components/seller/ListingStatusBadge';
import {
  STEPS, LEGAL_STRUCTURES, SALE_OBJECTS, SALE_REASONS, HANDOVER_OPTIONS, REASSURANCE, BOUNDS, HELP,
  emptyForm, formFromProperty, applyEstimateToForm, applyLookupToForm, readEstimateSession, clearEstimateSession,
  validateStep, stepPayload, createPayload, firstIncompleteStep, descriptionIssues, rgeLabelsFromIds, fmtEur,
} from '@/components/seller/listingForm';

const isVerifiedUser = (user, kyc) => !!(kyc?.verified || user?.identity_verified || user?.kyc_status === 'verified');

const SectionCard = ({ title, intro, children }) => (
  <section className="card p-4 sm:p-6 space-y-5" aria-label={title}>
    <div>
      <h2 className="font-display text-xl font-bold text-brand-navy">{title}</h2>
      {intro && <p className="text-sm text-gray-600 mt-1">{intro}</p>}
    </div>
    {children}
  </section>
);

// Aperçu anonyme : la carte publique elle-même (ListingCard), sans navigation
const AnonymousPreview = ({ form, lookup }) => {
  const staff = form.staff_count === '' ? null : Number(form.staff_count);
  const property = {
    id: 'apercu',
    title: listingTitle({ trades: form.trades, region: form.region, staff_count: staff }),
    trades: form.trades,
    rge_types: rgeLabelsFromIds(form.rge_ids),
    other_qualifications: form.other_qualifications,
    is_rge: form.rge_ids.length > 0,
    property_checks: { in_ademe_list: lookup?.rge?.found ? true : undefined },
    region: form.region,
    department: form.department,
    staff_count: staff,
    ca_n: form.ca_n === '' ? null : Number(form.ca_n),
    asking_price: form.asking_price === '' ? null : Number(form.asking_price),
    published_at: new Date().toISOString(),
  };
  return (
    <div className="min-w-0" data-testid="listing-anonymous-preview">
      <p className="flex items-start gap-2 text-sm text-gray-600 mb-3">
        <Eye className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
        <span>Ce que les repreneurs verront : ni nom, ni SIRET, ni coordonnées. Votre identité n'est révélée qu'après accord de confidentialité signé.</span>
      </p>
      <div onClickCapture={(e) => { e.preventDefault(); e.stopPropagation(); }} className="max-w-md">
        <ListingCard property={property} source="preview" />
      </div>
    </div>
  );
};

const CreateListing = ({ user }) => {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const editId = params.id || searchParams.get('edit') || '';
  usePrivateSeo(editId ? 'Modifier mon annonce' : 'Créer une annonce');
  const navigate = useNavigate();
  const lookup = useCompanyLookup();
  const dirigeant = useDirigeantVerification();

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
  const [estimateRange, setEstimateRange] = useState(null); // { low, high, source }
  const [showInvite, setShowInvite] = useState(false);
  // Qualifications RGE et labels (30 cases) repliées par défaut sur l'écran 1 ; dépliées d'office dès qu'il y a
  // quelque chose à montrer (préchargement ADEME par le SIRET, brouillon ou annonce déjà qualifiés).
  const [qualifsOpen, setQualifsOpen] = useState(false);
  const qualifCount = form.rge_ids.length + form.other_qualifications.length;
  const hasQualifs = qualifCount > 0 || Boolean(lookup.result?.rge?.found);
  useEffect(() => { if (hasQualifs) setQualifsOpen(true); }, [hasQualifs]);
  const appliedLookup = useRef(null);

  const locked = !!(property && (property.mandat_signed || property.status === 'published'));
  const verified = isVerifiedUser(user, kyc);

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
          const first = firstIncompleteStep(f);
          setStep(first);
          setMaxStep(3);
          if (f.siret && f.siret.length === 14 && !f.company_name) lookup.lookup(f.siret);
        })
        .catch(() => { if (!cancelled) toast.error('Annonce introuvable.'); navigate('/seller/dashboard'); })
        .finally(() => { if (!cancelled) setLoading(false); });
    } else {
      const est = readEstimateSession();
      if (est) {
        setForm((f) => applyEstimateToForm(f, est));
        if (est.result && est.result.low && est.result.high) setEstimateRange({ low: est.result.low, high: est.result.high, source: 'estimateur' });
        if (est.siret && est.siret.length === 14) lookup.lookup(est.siret);
      }
    }
    return () => { cancelled = true; };
  }, [editId]);

  // Fiche open data + qualifications ADEME → préremplissage (une fois par résultat)
  useEffect(() => {
    if (!lookup.result || appliedLookup.current === lookup.result) return;
    appliedLookup.current = lookup.result;
    setForm((f) => applyLookupToForm({ ...f, siret: lookup.result.siret || f.siret }, lookup.result));
    const siren = lookup.result.siren;
    if (siren && siren.length === 9) dirigeant.loadDirigeants(siren).catch(() => {});
  }, [lookup.result]);

  // Alerte prix hors fourchette : fourchette de l'estimateur ou calcul à l'entrée de l'écran 3
  useEffect(() => {
    if (step !== 3 || estimateRange || form.ca_n === '') return;
    const ca = Number(form.ca_n);
    if (!(ca > 0)) return;
    axiosInstance.post('/estimates', {
      siret: form.siret || undefined,
      ca,
      ebe: form.ebitda === '' ? undefined : Number(form.ebitda),
      staff: form.staff_count === '' ? undefined : Math.round(Number(form.staff_count)),
      maintenance_contracts: !!form.has_maintenance_contracts,
      team_stays: !!form.technical_referent_stays,
      owner_dispensable: false,
    }).then((r) => {
      const d = r.data || {};
      if (d.low && d.high) setEstimateRange({ low: d.low, high: d.high, source: 'calcul' });
    }).catch(() => {});
  }, [step]);

  const priceOutOfRange = useMemo(() => {
    if (!estimateRange || form.asking_price === '') return null;
    const p = Number(form.asking_price);
    if (!(p > 0)) return null;
    if (p < estimateRange.low * 0.9) return 'low';
    if (p > estimateRange.high * 1.1) return 'high';
    return null;
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
        trackEvent('listing_created', { step: current });
      } else {
        const payload = stepPayload(current, form);
        if (locked) ['siret', 'company_name', 'rge_types', 'legal_structure', 'creation_date'].forEach((k) => { delete payload[k]; });
        const res = await axiosInstance.put(`/properties/${propertyId}`, payload);
        saved = res.data || {};
      }
      setProperty(saved);
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
    try { sessionStorage.setItem('kyc_return_to', `/seller/mandat/${saved.id || propertyId}`); } catch (e) { /* stockage indisponible */ }
    if (verified) {
      navigate(`/seller/mandat/${saved.id || propertyId}`);
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
      setStep(reason.code === 'prix_manquant' ? 3 : 1);
    }
  };

  const departements = useMemo(() => departementOptions(form.region).map((d) => ({ value: d.code, label: d.label })), [form.region]);
  const descr = descriptionIssues(form.description);

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen" role="status" aria-label="Chargement"><div className="spinner" /></div>;
  }

  const Nav = (
    <>
      <AppHeader user={user} />
      <PageBar backTo="/seller/dashboard" backLabel="Mon espace" title={editId ? 'Mon annonce' : 'Nouvelle annonce'} width="max-w-5xl">
        {savedAt && (
          <span className="text-sm text-gray-500 hidden sm:inline" data-testid="saved-at">
            Brouillon enregistré à {savedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </PageBar>
    </>
  );

  if (done) {
    const id = propertyId;
    const items = [
      { id: 'listing', label: 'Annonce enregistrée', description: 'Vous pouvez la modifier à tout moment depuis votre espace.', state: 'done' },
      {
        id: 'identity',
        label: 'Vérifiez votre identité',
        description: 'Pièce d\'identité et selfie, dans ce même onglet (environ 2 minutes). Si la vérification n\'aboutit pas, nous vous recontactons par e-mail.',
        state: verified ? 'done' : 'current',
        action: <KYCVerificationButton user={user} className="rounded-xl bg-brand-navy hover:bg-brand-navy-light text-white" />,
      },
      {
        id: 'mandate',
        label: 'Signez votre mandat de vente simple',
        description: 'Sans exclusivité, résiliable à tout moment avec un préavis de 15 jours. Résumé en 5 points, signature par code reçu par e-mail.',
        state: verified ? 'current' : 'todo',
        action: (
          <Link to={`/seller/mandat/${id}`} className="btn-primary" data-testid="go-mandate">
            <FileSignature className="w-4 h-4" aria-hidden="true" />
            Signer le mandat
          </Link>
        ),
      },
      { id: 'publish', label: 'Publication immédiate', description: 'Dès la signature, si les contrôles automatiques passent (e-mail confirmé, identité vérifiée, SIRET, métier, prix).', state: 'todo' },
    ];
    return (
      <div className="min-h-screen bg-brand-surface">
        {Nav}
        <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-6">
          <header>
            <p className="eyebrow mb-1">Annonce enregistrée</p>
            <h1 className="font-display text-3xl font-extrabold text-brand-navy">Plus que deux étapes avant la mise en ligne</h1>
          </header>
          <section className="card p-5 sm:p-6">
            <Checklist items={items} title="Avant la publication" />
          </section>
          <section className="card p-5 sm:p-6 space-y-3">
            <p className="flex items-start gap-2 text-sm text-gray-700">
              <UserPlus className="w-4 h-4 mt-0.5 shrink-0 text-brand-blue" aria-hidden="true" />
              <span>Vous n'êtes pas le dirigeant de la société ? Vous pouvez signer le mandat en déclarant votre qualité (associé ou mandataire des associés), ou inviter le dirigeant à le signer lui-même.</span>
            </p>
            <Button type="button" variant="outline" className="rounded-xl" onClick={() => setShowInvite(true)} data-testid="invite-president">
              Inviter le dirigeant à signer
            </Button>
          </section>
          <Link to="/seller/dashboard" className="btn-link">Aller à mon espace vendeur</Link>
        </main>
        <InvitePresidentModal
          propertyId={id}
          dirigeants={dirigeant.dirigeantsData?.dirigeants || []}
          president={dirigeant.dirigeantsData?.president}
          isOpen={showInvite}
          onClose={() => setShowInvite(false)}
          onSuccess={() => { setShowInvite(false); toast.success('Invitation envoyée au dirigeant.'); }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-surface">
      {Nav}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <header className="mb-6">
          <p className="eyebrow mb-1">{editId ? 'Modification' : 'Dépôt d\'annonce anonyme'}</p>
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-brand-navy mb-3">
            {step === 1 ? 'Votre entreprise' : step === 2 ? 'Vos chiffres clés' : 'Votre projet de cession'}
          </h1>
          <StepIndicator steps={STEPS} current={step} onSelect={goToStep} maxReachable={maxStep} />
          <p className="text-sm text-gray-600 mt-3">Votre saisie est enregistrée en brouillon à chaque écran : vous pouvez reprendre plus tard depuis votre espace.</p>
        </header>

        {property && <div className="mb-6"><BlockingReasons property={property} onAction={onBlockingAction} /></div>}

        {locked && (
          <p className="notice-amber flex items-start gap-2 mb-6" data-testid="locked-notice">
            <Lock className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>Mandat signé : le SIRET, la dénomination, les qualifications RGE, la forme juridique et la date de création ne sont plus modifiables (ils figurent dans le mandat).</span>
          </p>
        )}

        <form onSubmit={(e) => { e.preventDefault(); next(); }} className="space-y-6" data-testid="create-listing-form" noValidate>
          {step === 1 && (
            <>
              <SectionCard title="Identification" intro="Le SIRET sert à contrôler l'entreprise sur les bases publiques (annuaire des entreprises, liste RGE de l'ADEME). Il n'apparaît jamais dans l'annonce.">
                <SiretField
                  value={form.siret}
                  onChange={(v) => { setField('siret')(v); if (v.length < 14) appliedLookup.current = null; }}
                  lookup={lookup}
                  required={false}
                  inputProps={{ disabled: locked }}
                  hint="14 chiffres, sur vos devis, factures ou votre extrait Kbis. Obligatoire pour la publication, pas pour enregistrer le brouillon."
                />
                {lookup.result?.property?.found && (
                  <p className="flex items-start gap-2 text-sm text-gray-700" data-testid="lookup-found">
                    <CheckCircle className="w-4 h-4 mt-0.5 shrink-0 text-brand-green" aria-hidden="true" />
                    <span><strong>{lookup.result.property.name}</strong>{lookup.result.property.nafLabel ? ` · ${lookup.result.property.nafLabel}` : ''}. Les champs ci-dessous ont été préremplis : vérifiez-les.</span>
                  </p>
                )}
                <Field label="Dénomination de la société" help="Elle figure sur le mandat, jamais sur l'annonce." optional>
                  {(p) => <TextInput value={form.company_name} onChange={setField('company_name')} disabled={locked} placeholder="Nom figurant sur le Kbis" testId="property-name-input" {...p} />}
                </Field>
              </SectionCard>

              <SectionCard title="Métiers et qualifications">
                <TradePicker selected={form.trades} onChange={(v) => setField('trades')(v)} error={errors.trades} />

                <button
                  type="button"
                  onClick={() => setQualifsOpen((o) => !o)}
                  aria-expanded={qualifsOpen}
                  aria-controls="qualifications-fields"
                  className="w-full flex items-center justify-between gap-3 rounded-xl border-2 border-brand-line bg-white px-4 py-3 text-left hover:border-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
                  data-testid="toggle-qualifications"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-brand-navy">Qualifications RGE et labels <span className="font-normal text-gray-600">(facultatif)</span></span>
                    <span className="block text-sm text-gray-600">
                      {qualifCount > 0 ? `${qualifCount} cochée${qualifCount > 1 ? 's' : ''}` : 'RGE, Qualibat, Qualifelec… si vous en avez'}
                    </span>
                  </span>
                  <ChevronDown className={`w-5 h-5 shrink-0 text-brand-navy transition-transform ${qualifsOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                </button>

                {qualifsOpen && (
                <div id="qualifications-fields" className="space-y-5" data-testid="qualifications-fields">
                <div>
                  <p className="text-sm font-semibold text-brand-navy mb-1">Qualifications RGE</p>
                  <p className="text-sm text-gray-600 mb-3">
                    {lookup.result?.rge?.found
                      ? 'Préchargées depuis la liste ADEME : ajustez si nécessaire. Elles seront contrôlées à la publication (badge « RGE vérifié ADEME »).'
                      : 'Cochez vos domaines RGE si vous en avez. Ils seront contrôlés sur la liste ADEME à la publication.'}
                  </p>
                  <MultiSelectList
                    options={RGE_TYPES.map((t) => ({ value: t.id, label: t.label }))}
                    selected={form.rge_ids}
                    onChange={(v) => setField('rge_ids')(v)}
                    columns={2}
                    disabled={locked}
                    testIdPrefix="rge-checkbox"
                  />
                  {form.rge_ids.length > 0 && (
                    <div className="mt-4 max-w-xs">
                      <Field label="Fin de validité RGE" help={HELP.rge_validity} optional>
                        {(p) => <TextInput type="date" value={form.rge_validity} onChange={setField('rge_validity')} testId="rge-validity-input" {...p} />}
                      </Field>
                    </div>
                  )}
                </div>

                <div>
                  <p className="text-sm font-semibold text-brand-navy mb-1">Autres qualifications <span className="font-normal text-gray-500">(déclaratives)</span></p>
                  <p className="text-sm text-gray-600 mb-3">Affichées sur l'annonce avec la mention « déclarées par le cédant ».</p>
                  <MultiSelectList
                    options={OTHER_QUALIFICATIONS.map((q) => ({ value: q.id, label: q.label }))}
                    selected={form.other_qualifications}
                    onChange={(v) => setField('other_qualifications')(v)}
                    columns={2}
                    showChips={false}
                    compact
                    testIdPrefix="qualif-checkbox"
                  />
                </div>
                </div>
                )}
              </SectionCard>

              <SectionCard title="Implantation et structure">
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Région" error={errors.region} required>
                    {(p) => (
                      <SelectInput
                        value={form.region}
                        onChange={(v) => { update({ region: v, department: v && regionForDepartement(form.department) === v ? form.department : '' }); setErrors((e) => ({ ...e, region: undefined })); }}
                        options={REGIONS.map((r) => ({ value: r, label: r }))}
                        testId="region-select"
                        {...p}
                      />
                    )}
                  </Field>
                  <Field label="Département" hint="Affiché sur l'annonce avec la région." optional>
                    {(p) => (
                      <SelectInput
                        value={form.department}
                        onChange={(v) => update({ department: v, region: form.region || regionForDepartement(v) })}
                        options={departements}
                        placeholder={form.region ? 'Choisir' : 'Choisissez d\'abord la région'}
                        testId="department-select"
                        {...p}
                      />
                    )}
                  </Field>
                  <Field label="Effectif" help={HELP.staff_count} error={errors.staff_count} optional>
                    {(p) => <NumberInput value={form.staff_count} onChange={setField('staff_count')} min={BOUNDS.staff.min} max={BOUNDS.staff.max} suffix="salariés" testId="staff-count-input" {...p} />}
                  </Field>
                  <Field label="Date de création" optional>
                    {(p) => <TextInput type="date" value={form.creation_date} onChange={setField('creation_date')} disabled={locked} testId="creation-date-input" {...p} />}
                  </Field>
                  <Field label="Forme juridique" optional>
                    {(p) => <SelectInput value={form.legal_structure} onChange={setField('legal_structure')} options={LEGAL_STRUCTURES} disabled={locked} testId="legal-structure-select" {...p} />}
                  </Field>
                </div>
              </SectionCard>
            </>
          )}

          {step === 2 && (
            <>
              <SectionCard title="Chiffre d'affaires" intro="Montants hors taxes, arrondis. Aucun chiffre n'est obligatoire pour enregistrer : laissez vide ce que vous préciserez avec votre comptable.">
                <div className="grid sm:grid-cols-3 gap-4">
                  <Field label="CA du dernier exercice" help={HELP.ca_n} error={errors.ca_n}>
                    {(p) => <NumberInput value={form.ca_n} onChange={setField('ca_n')} min={BOUNDS.ca.min} max={BOUNDS.ca.max} testId="ca-n-input" {...p} />}
                  </Field>
                  <Field label="CA de l'exercice précédent" help={HELP.ca_n1} error={errors.ca_n1}>
                    {(p) => <NumberInput value={form.ca_n1} onChange={setField('ca_n1')} min={BOUNDS.ca.min} max={BOUNDS.ca.max} testId="ca-n1-input" {...p} />}
                  </Field>
                  <Field label="CA il y a deux exercices" help={HELP.ca_n2} error={errors.ca_n2}>
                    {(p) => <NumberInput value={form.ca_n2} onChange={setField('ca_n2')} min={BOUNDS.ca.min} max={BOUNDS.ca.max} testId="ca-n2-input" {...p} />}
                  </Field>
                </div>
              </SectionCard>

              <SectionCard title="Rentabilité et dettes">
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="EBE (ou résultat net)" help={HELP.ebitda} error={errors.ebitda}>
                    {(p) => <NumberInput value={form.ebitda} onChange={setField('ebitda')} min={BOUNDS.ebitda.min} max={BOUNDS.ebitda.max} testId="ebitda-input" {...p} />}
                  </Field>
                  <Field label="Marge brute" help={HELP.margin} error={errors.margin}>
                    {(p) => <NumberInput value={form.margin} onChange={setField('margin')} min={BOUNDS.margin.min} max={BOUNDS.margin.max} suffix="%" testId="margin-input" {...p} />}
                  </Field>
                  <Field label="Dettes financières" help={HELP.debt} error={errors.debt}>
                    {(p) => <NumberInput value={form.debt} onChange={setField('debt')} min={BOUNDS.debt.min} max={BOUNDS.debt.max} testId="debt-input" {...p} />}
                  </Field>
                  <Field label="Carnet de commandes signé" help={HELP.pipeline} error={errors.pipeline}>
                    {(p) => <NumberInput value={form.pipeline} onChange={setField('pipeline')} min={BOUNDS.pipeline.min} max={BOUNDS.pipeline.max} testId="pipeline-input" {...p} />}
                  </Field>
                </div>
              </SectionCard>

              <SectionCard title="Charges fixes annuelles" intro={HELP.fixed_charges}>
                <div className="grid sm:grid-cols-2 gap-4">
                  {[['salaries', 'Salaires chargés'], ['rent', 'Loyers'], ['insurance', 'Assurances (décennale, RC, flotte)'], ['equipment', 'Matériel et véhicules (location, crédit-bail)']].map(([key, label]) => (
                    <Field key={key} label={label} error={errors[`fixed_charges.${key}`]}>
                      {(p) => (
                        <NumberInput
                          value={form.fixed_charges[key]}
                          onChange={(v) => update((f) => ({ fixed_charges: { ...f.fixed_charges, [key]: v } }))}
                          min={BOUNDS.charges.min}
                          max={BOUNDS.charges.max}
                          testId={`charges-${key}-input`}
                          {...p}
                        />
                      )}
                    </Field>
                  ))}
                </div>
              </SectionCard>
            </>
          )}

          {step === 3 && (
            <>
              <SectionCard title="Prix et objet de la cession">
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Prix demandé" help={HELP.asking_price} error={errors.asking_price} required>
                    {(p) => <NumberInput value={form.asking_price} onChange={setField('asking_price')} min={BOUNDS.price.min} max={BOUNDS.price.max} testId="asking-price-input" {...p} />}
                  </Field>
                  <Field label="Motif de la cession" error={errors.sale_reason} required>
                    {(p) => <SelectInput value={form.sale_reason} onChange={setField('sale_reason')} options={SALE_REASONS} testId="sale-reason-select" {...p} />}
                  </Field>
                </div>
                {estimateRange && priceOutOfRange && (
                  <p className="notice-amber flex items-start gap-2" role="status" data-testid="price-alert">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                    <span>
                      Votre prix est {priceOutOfRange === 'high' ? 'au-dessus' : 'en dessous'} de la fourchette indicative calculée à partir de vos chiffres
                      ({fmtEur(estimateRange.low)} à {fmtEur(estimateRange.high)}). Ce n'est pas bloquant : un prix cohérent attire simplement plus de repreneurs.
                    </span>
                  </p>
                )}
                {estimateRange && !priceOutOfRange && form.asking_price !== '' && (
                  <p className="flex items-start gap-2 text-sm text-gray-700" data-testid="price-ok">
                    <Info className="w-4 h-4 mt-0.5 shrink-0 text-brand-blue" aria-hidden="true" />
                    <span>Prix dans la fourchette indicative ({fmtEur(estimateRange.low)} à {fmtEur(estimateRange.high)}).</span>
                  </p>
                )}
                <fieldset>
                  <legend className="text-sm font-semibold text-brand-navy mb-1">Ce que vous cédez *</legend>
                  <p className="text-sm text-gray-600 mb-3">Repris tel quel dans le mandat ; vous pourrez en discuter avec le repreneur.</p>
                  <div className="grid sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Objet de la cession">
                    {SALE_OBJECTS.map((o) => (
                      <label key={o.value} className={`grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-xl border-2 px-4 py-3 cursor-pointer min-w-0 focus-within:ring-2 focus-within:ring-brand-blue ${form.sale_object === o.value ? 'border-brand-navy bg-brand-blue-soft' : 'border-brand-line bg-white hover:border-gray-400'}`} data-testid={`sale-object-${o.value}`}>
                        <input type="radio" name="sale_object" value={o.value} checked={form.sale_object === o.value} onChange={() => setField('sale_object')(o.value)} className="row-span-2 mt-1 h-4 w-4 accent-brand-navy" />
                        <span className="text-sm font-semibold text-brand-navy min-w-0">{o.short}</span>
                        <span className="text-sm text-gray-600 leading-snug min-w-0">{o.label}</span>
                      </label>
                    ))}
                  </div>
                  {errors.sale_object && <p role="alert" className="text-sm text-red-700 mt-2">{errors.sale_object}</p>}
                </fieldset>
                <div className="max-w-xs">
                  <Field label="Accompagnement du repreneur" help={HELP.handover_months} error={errors.handover_months} optional>
                    {(p) => <SelectInput value={form.handover_months} onChange={setField('handover_months')} options={HANDOVER_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))} placeholder="À définir" testId="handover-select" {...p} />}
                  </Field>
                </div>
              </SectionCard>

              <SectionCard title="Ce qui rassure un repreneur" intro="Cochez ce qui est vrai aujourd'hui : chaque point est affiché sur l'annonce et pèse dans la valeur.">
                <div className="grid sm:grid-cols-2 gap-2">
                  {REASSURANCE.map((r) => (
                    <CheckCard key={r.key} checked={!!form[r.key]} onChange={(v) => update({ [r.key]: v })} label={r.label} hint={r.hint} testId={`reassure-${r.key}`} />
                  ))}
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Matériel et véhicules" optional hint="Ex. : 3 fourgons, nacelle, outillage complet.">
                    {(p) => <TextInput value={form.equipment} onChange={setField('equipment')} maxLength={300} testId="equipment-input" {...p} />}
                  </Field>
                  <Field label="Locaux" optional hint="Ex. : dépôt de 200 m² en location, bail transférable.">
                    {(p) => <TextInput value={form.premises} onChange={setField('premises')} maxLength={300} testId="premises-input" {...p} />}
                  </Field>
                </div>
              </SectionCard>

              <SectionCard title="Présentation libre">
                <Field label="Description de l'entreprise" help={HELP.description} error={errors.description} required>
                  {(p) => (
                    <div>
                      <textarea
                        value={form.description}
                        onChange={(e) => setField('description')(e.target.value)}
                        rows={8}
                        maxLength={BOUNDS.description.max + 200}
                        placeholder="Entreprise familiale créée il y a vingt ans, spécialisée dans la rénovation énergétique de maisons individuelles. Clientèle de particuliers fidèles et de syndics, équipe stable de six personnes…"
                        className={`w-full rounded-xl border bg-white px-4 py-3 text-base text-brand-navy placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-blue/30 ${errors.description ? 'border-red-400' : 'border-brand-line focus:border-brand-blue'}`}
                        data-testid="description-input"
                        {...p}
                      />
                      <div className="flex flex-wrap items-center justify-between gap-2 mt-1 text-sm">
                        <span className={descr.contacts.length ? 'text-red-700 font-medium' : 'text-gray-500'} data-testid="description-contacts">
                          {descr.contacts.length ? `Coordonnées détectées : ${descr.contacts.join(', ')}. Retirez-les, l'annonce doit rester anonyme.` : 'Sans nom, téléphone, e-mail ni site web.'}
                        </span>
                        <span className={`tabular ${descr.tooLong || descr.tooShort ? 'text-brand-amber' : 'text-gray-500'}`} data-testid="description-count">
                          {descr.length} / {BOUNDS.description.max} caractères{descr.length < BOUNDS.description.min ? ` (minimum ${BOUNDS.description.min})` : ''}
                        </span>
                      </div>
                    </div>
                  )}
                </Field>
                <CheckCard
                  checked={!!form.auto_accept_dataroom}
                  onChange={(v) => update({ auto_accept_dataroom: v })}
                  label="Accepter automatiquement les demandes de dossier des repreneurs au projet renseigné"
                  hint={HELP.auto_accept_dataroom}
                  testId="auto-accept-dataroom"
                />
              </SectionCard>

              <SectionCard title="Aperçu anonyme">
                <AnonymousPreview form={form} lookup={lookup.result} />
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
              {savedAt && <span className="text-sm text-gray-500 sm:hidden">Enregistré à {savedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>}
            </div>
            <Button type="submit" disabled={saving} className="rounded-xl bg-brand-navy hover:bg-brand-navy-light text-white h-12 px-6 text-base" data-testid="next-step">
              {saving ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : step < 3 ? <Save className="w-5 h-5 mr-2" /> : locked ? <Globe className="w-5 h-5 mr-2" /> : <ShieldCheck className="w-5 h-5 mr-2" />}
              {step < 3 ? 'Enregistrer et continuer' : locked ? 'Enregistrer les modifications' : verified ? 'Enregistrer et signer le mandat' : 'Enregistrer et vérifier mon identité'}
              {step < 3 && <ArrowRight className="w-5 h-5 ml-2" />}
            </Button>
          </div>
        </form>

        {step === 3 && !locked && (
          <p className="text-sm text-gray-600 mt-6">
            Ensuite : vérification d'identité (si ce n'est pas déjà fait) puis mandat de vente simple à signer par code. Publication immédiate si les contrôles passent, sans validation humaine.
            {form.trades[0] ? ` Titre généré : « ${listingTitle({ trades: form.trades, region: form.region, staff_count: form.staff_count === '' ? null : Number(form.staff_count) })} » (métier principal : ${tradeLabel(form.trades[0], true)}).` : ''}
          </p>
        )}
      </main>
    </div>
  );
};

export default CreateListing;
