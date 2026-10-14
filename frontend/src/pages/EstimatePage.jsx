import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Clock, Loader2, Lock, Mail, MailX, Sparkles, TrendingUp, TrendingDown, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { axiosInstance } from '@/App';
import AppLayout from '@/components/layout/AppLayout';
import { Breadcrumbs, fillText } from '@/components/seo/Content';
import { useSeo, SITE_URL } from '@/lib/seo';
import { content } from '@/seo';
import { breadcrumbLd } from '@/seo/schema';
import { OFFER } from '@/lib/offer';
import { trackEvent } from '@/lib/analytics';
import { formatPrice } from '@/components/shared/formatters';
import SiretField from '@/components/account/SiretField';
import CompanyPrefillCard from '@/components/account/CompanyPrefillCard';
import ChoiceGroup from '@/components/account/ChoiceGroup';
import { apiErrorMessage } from '@/components/account/errors';
import { useCompanyLookup, cleanSiret } from '@/components/account/siret';
// Même définition de l'effectif que le formulaire d'annonce, que l'estimateur préremplit (SPEC §4.2)
import { HELP } from '@/components/seller/listingForm';

// /estimer (SPEC §4.2 point 1, API.md §8) : SIRET → GET /estimates/company/{siret} (préremplissage, jamais
// bloquant) → 3 chiffres + 3 cases → POST /estimates → fourchette, méthode, leviers, pédagogie ; e-mail
// facultatif (double opt-in) ; « Déposer mon annonce anonyme » (sessionStorage 'estimate' lu par CreateListing).

const PATH = '/estimer';
const inputClass = 'w-full rounded-xl border border-brand-line bg-white px-4 py-3 text-brand-navy focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30';

const DRIVER_OPTIONS = [
  { value: 'maintenance_contracts', label: 'Contrats d\'entretien récurrents', hint: 'Contrats signés qui reviennent chaque année (entretien, maintenance, dépannage).' },
  { value: 'team_stays', label: 'Le référent technique et l\'équipe restent', hint: 'Les salariés clés, dont le référent des qualifications RGE, continuent après la vente.' },
  { value: 'owner_dispensable', label: 'Le dirigeant n\'est pas indispensable au quotidien', hint: 'Devis, chantiers et clients ne passent pas tous par vous.' },
];

const CONFIRMATION_MESSAGES = {
  ok: { tone: 'ok', icon: CheckCircle2, text: 'Adresse confirmée : votre estimation vous a été envoyée par e-mail.' },
  invalide: { tone: 'ko', icon: MailX, text: 'Ce lien de confirmation n\'est pas valide. Refaites une estimation ci-dessous pour en recevoir un nouveau.' },
  expire: { tone: 'warn', icon: Clock, text: 'Ce lien de confirmation a expiré (48 heures). Refaites une estimation ci-dessous pour en recevoir un nouveau.' },
};

// Montant en euros, saisie fr-FR, signe négatif autorisé (résultat déficitaire)
const MoneyInput = ({ id, value, onChange, allowNegative = false, placeholder = '0', ...rest }) => {
  const digits = String(value || '').replace(/[^\d-]/g, '');
  const negative = allowNegative && digits.startsWith('-');
  const abs = digits.replace(/-/g, '');
  const display = abs ? `${negative ? '-' : ''}${Number(abs).toLocaleString('fr-FR')}` : (negative ? '-' : '');
  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        inputMode={allowNegative ? 'text' : 'numeric'}
        value={display}
        onChange={(e) => {
          const raw = e.target.value;
          const neg = allowNegative && raw.trim().startsWith('-');
          const d = raw.replace(/\D/g, '').slice(0, 9);
          onChange(`${neg ? '-' : ''}${d}`);
        }}
        placeholder={placeholder}
        className={`${inputClass} pr-10 tabular`}
        {...rest}
      />
      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden="true">€</span>
    </div>
  );
};

const toNumber = (v) => {
  const s = String(v == null ? '' : v).replace(/\s/g, '');
  if (!s || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const EstimatePage = ({ user }) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const page = content.estimate;
  const crumbs = [{ name: 'Accueil', path: '/' }, { name: 'Estimer mon entreprise', path: PATH }];
  useSeo(fillText(page.title), fillText(page.description), { path: PATH, jsonLd: breadcrumbLd(SITE_URL, crumbs) });

  const confirmation = CONFIRMATION_MESSAGES[searchParams.get('confirmation')] || null;
  const lookup = useCompanyLookup();
  const [step, setStep] = useState(1); // 1 SIRET · 2 chiffres · 3 résultat
  const [siret, setSiret] = useState(cleanSiret(searchParams.get('siret') || ''));
  const [figures, setFigures] = useState({ ca: '', ebe: '', staff: '' });
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [email, setEmail] = useState('');
  const [emailState, setEmailState] = useState('idle'); // idle | sending | sent
  const startedRef = useRef(false);
  const resultRef = useRef(null);

  const markStarted = (how) => {
    if (startedRef.current) return;
    startedRef.current = true;
    trackEvent('estimate_started', { how, with_siret: cleanSiret(siret).length === 14 });
  };

  // Effectif prérempli depuis l'open data (modifiable)
  useEffect(() => {
    const n = lookup.result?.company?.staffCount;
    if (lookup.status === 'found' && Number.isFinite(Number(n)) && n !== null) {
      setFigures((f) => (f.staff === '' ? { ...f, staff: String(n) } : f));
    }
  }, [lookup.status, lookup.result]);

  const siretReady = cleanSiret(siret).length === 14;
  const canContinue = !siretReady || ['found', 'not_found', 'unavailable'].includes(lookup.status);

  const goToFigures = (e) => {
    e.preventDefault();
    if (siretReady && lookup.status === 'invalid') return;
    markStarted(siretReady ? 'siret' : 'without_siret');
    setStep(2);
  };

  const canEstimate = useMemo(() => {
    const ca = toNumber(figures.ca);
    const ebe = toNumber(figures.ebe);
    return (ca !== null && ca > 0) || (ebe !== null && ebe > 0);
  }, [figures]);

  const payloadOf = (extra = {}) => ({
    siret: siretReady ? cleanSiret(siret) : null,
    ca: toNumber(figures.ca),
    ebe: toNumber(figures.ebe),
    staff: toNumber(figures.staff) === null ? null : Math.max(0, Math.round(toNumber(figures.staff))),
    maintenance_contracts: drivers.includes('maintenance_contracts'),
    team_stays: drivers.includes('team_stays'),
    owner_dispensable: drivers.includes('owner_dispensable'),
    ...extra,
  });

  const estimate = async (e) => {
    e.preventDefault();
    if (!canEstimate) {
      toast.error('Indiquez au moins un chiffre d\'affaires ou un EBE positif.');
      return;
    }
    setLoading(true);
    try {
      const res = await axiosInstance.post('/estimates', payloadOf());
      setResult(res.data);
      setEmailState('idle');
      setStep(3);
      trackEvent('estimate_completed', {
        low: res.data.low, high: res.data.high, method: res.data.method_code, rge: !!res.data.rge?.found, with_siret: siretReady,
      });
      window.setTimeout(() => resultRef.current?.focus(), 50);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'L\'estimation n\'a pas pu être calculée. Vérifiez les chiffres saisis.'));
    } finally {
      setLoading(false);
    }
  };

  const sendByEmail = async (e) => {
    e.preventDefault();
    const address = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(address)) {
      toast.error('Indiquez une adresse e-mail valide.');
      return;
    }
    setEmailState('sending');
    try {
      await axiosInstance.post('/estimates', payloadOf({ email: address }));
      setEmailState('sent');
    } catch (error) {
      setEmailState('idle');
      toast.error(apiErrorMessage(error, 'L\'e-mail n\'a pas pu être envoyé. Réessayez dans quelques instants.'));
    }
  };

  // « Déposer mon annonce anonyme » : CreateListing lit sessionStorage 'estimate'
  // {siret, company, rge, ca, ebe, staff, low, high}
  const depositListing = () => {
    const payload = {
      siret: siretReady ? cleanSiret(siret) : '',
      company: lookup.result?.company || null,
      rge: lookup.result?.rge || null,
      ca: toNumber(figures.ca),
      ebe: toNumber(figures.ebe),
      staff: toNumber(figures.staff),
      low: result?.low ?? null,
      high: result?.high ?? null,
      mid: result?.mid ?? null,
      saved_at: new Date().toISOString(),
    };
    try {
      sessionStorage.setItem('estimate', JSON.stringify(payload));
    } catch (err) {
      // stockage indisponible : l'annonce sera saisie sans préremplissage
    }
    navigate(user && user.role === 'seller' ? '/seller/create' : '/register?role=seller');
  };

  const rgeFound = !!lookup.result?.rge?.found;

  return (
    <AppLayout user={user} className="bg-brand-surface">
      <section className="px-4 sm:px-6 pt-8 pb-6 bg-white border-b border-brand-line">
        <div className="max-w-5xl mx-auto min-w-0">
          <Breadcrumbs items={crumbs} />
          <p className="eyebrow mb-2">Gratuit, sans compte, sans engagement</p>
          <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-brand-navy leading-tight">{page.h1}</h1>
          <p className="text-gray-700 mt-3 leading-relaxed max-w-3xl">{page.intro}</p>
        </div>
      </section>

      <section className="px-4 sm:px-6 py-8 sm:py-10">
        <div className="max-w-5xl mx-auto grid lg:grid-cols-[7fr_4fr] gap-8 min-w-0">
          <div className="min-w-0 space-y-5">
            {confirmation && (
              <div
                role="status"
                className={`rounded-2xl border p-4 flex items-start gap-3 ${confirmation.tone === 'ok' ? 'bg-brand-green-soft border-brand-green/30 text-brand-green-dark' : confirmation.tone === 'warn' ? 'bg-brand-amber-soft border-brand-amber/30 text-brand-navy' : 'bg-red-50 border-red-200 text-red-800'}`}
                data-testid="estimate-confirmation"
              >
                <confirmation.icon className="w-5 h-5 mt-0.5 shrink-0" aria-hidden="true" />
                <p className="text-sm leading-relaxed">{confirmation.text}</p>
              </div>
            )}

            {/* Étapes */}
            <ol className="flex flex-wrap gap-2 text-sm" aria-label="Étapes de l'estimation">
              {['Votre SIRET', 'Trois chiffres, trois cases', 'Votre fourchette'].map((label, i) => {
                const n = i + 1;
                const state = n < step ? 'done' : n === step ? 'current' : 'todo';
                return (
                  <li key={label} aria-current={state === 'current' ? 'step' : undefined}
                    className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 border ${state === 'current' ? 'bg-brand-navy text-white border-brand-navy' : state === 'done' ? 'bg-white text-brand-navy border-brand-navy' : 'bg-white text-gray-500 border-brand-line'}`}>
                    <span className="tabular font-semibold">{n}</span>
                    <span>{label}</span>
                  </li>
                );
              })}
            </ol>

            {step === 1 && (
              <form onSubmit={goToFigures} className="card p-5 sm:p-6 space-y-5" data-testid="estimate-step-siret">
                <div>
                  <h2 className="font-display text-xl font-bold text-brand-navy">Votre entreprise</h2>
                  <p className="text-sm text-gray-600 mt-1 leading-relaxed">
                    Le SIRET charge le nom, l'activité, l'effectif et, le cas échéant, les qualifications RGE lues sur la base ADEME. Rien n'est enregistré.
                  </p>
                </div>
                <SiretField value={siret} onChange={(v) => { setSiret(v); markStarted('siret'); }} lookup={lookup} testId="estimate-siret-input" />
                {lookup.result && lookup.status !== 'loading' && lookup.status !== 'invalid' && <CompanyPrefillCard result={lookup.result} />}
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <button type="submit" disabled={!canContinue || lookup.status === 'loading'} className="btn-primary w-full sm:w-auto" data-testid="estimate-siret-continue">
                    {lookup.status === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
                    {siretReady ? 'Continuer' : 'Continuer sans SIRET'}
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </button>
                  {siretReady && (
                    <button type="button" onClick={() => { setSiret(''); lookup.reset(); markStarted('without_siret'); setStep(2); }} className="btn-link text-sm justify-center">
                      Continuer sans SIRET
                    </button>
                  )}
                </div>
              </form>
            )}

            {step === 2 && (
              <form onSubmit={estimate} className="card p-5 sm:p-6 space-y-6" data-testid="estimate-step-figures">
                <div>
                  <h2 className="font-display text-xl font-bold text-brand-navy">Trois chiffres</h2>
                  <p className="text-sm text-gray-600 mt-1 leading-relaxed">Ordres de grandeur suffisants : prenez votre dernière liasse ou demandez-les à votre comptable.</p>
                </div>
                {lookup.result?.company?.found && (
                  <p className="text-sm text-gray-700 rounded-xl bg-brand-surface border border-brand-line px-4 py-3 break-words">
                    Estimation pour <span className="font-semibold text-brand-navy">{lookup.result.company.name}</span>
                    {rgeFound && <span className="badge badge-verified ml-2"><ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />RGE vérifié ADEME</span>}
                    {' '}<button type="button" onClick={() => setStep(1)} className="btn-link text-sm">Modifier</button>
                  </p>
                )}
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="min-w-0">
                    <label htmlFor="estimate-ca" className="block text-sm font-semibold text-brand-navy mb-1">Chiffre d'affaires annuel HT</label>
                    <MoneyInput id="estimate-ca" value={figures.ca} onChange={(v) => setFigures({ ...figures, ca: v })} data-testid="estimate-ca-input" aria-describedby="estimate-ca-hint" />
                    <p id="estimate-ca-hint" className="text-xs text-gray-500 mt-1">Dernier exercice clos.</p>
                  </div>
                  <div className="min-w-0">
                    <label htmlFor="estimate-ebe" className="block text-sm font-semibold text-brand-navy mb-1">EBE ou résultat net</label>
                    <MoneyInput id="estimate-ebe" value={figures.ebe} onChange={(v) => setFigures({ ...figures, ebe: v })} allowNegative data-testid="estimate-ebe-input" aria-describedby="estimate-ebe-hint" />
                    <p id="estimate-ebe-hint" className="text-xs text-gray-500 mt-1">Excédent brut d'exploitation (avant amortissements et impôts) ; à défaut, le résultat net. Peut être négatif.</p>
                  </div>
                  <div className="min-w-0">
                    <label htmlFor="estimate-staff" className="block text-sm font-semibold text-brand-navy mb-1">Effectif</label>
                    <input id="estimate-staff" type="number" min={0} max={10000} step={1} inputMode="numeric" value={figures.staff}
                      onChange={(e) => setFigures({ ...figures, staff: e.target.value })} className={`${inputClass} tabular`} data-testid="estimate-staff-input" aria-describedby="estimate-staff-hint" />
                    <p id="estimate-staff-hint" className="text-xs text-gray-500 mt-1">{HELP.staff_count}</p>
                  </div>
                </div>

                <ChoiceGroup
                  legend="Trois cases qui changent la valeur"
                  name="drivers"
                  options={DRIVER_OPTIONS}
                  value={drivers}
                  onChange={setDrivers}
                  multiple
                  columns={1}
                  hint="Cochez ce qui est vrai aujourd'hui : chaque case pèse ± 5 % sur la fourchette."
                  showSummary={false}
                  testId="estimate-driver"
                />

                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <button type="submit" disabled={loading || !canEstimate} className="btn-primary w-full sm:w-auto" data-testid="estimate-submit">
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Sparkles className="w-4 h-4" aria-hidden="true" />}
                    Obtenir ma fourchette
                  </button>
                  <button type="button" onClick={() => setStep(1)} className="btn-link text-sm justify-center">Retour</button>
                </div>
                {!canEstimate && <p className="text-xs text-gray-500">Indiquez au moins un chiffre d'affaires ou un EBE positif.</p>}
              </form>
            )}

            {step === 3 && result && (
              <div className="space-y-5" data-testid="estimate-result">
                <section ref={resultRef} tabIndex={-1} className="card p-5 sm:p-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue" aria-labelledby="estimate-result-title">
                  <p className="eyebrow">Fourchette indicative</p>
                  <h2 id="estimate-result-title" className="font-display text-2xl sm:text-3xl font-extrabold text-brand-navy mt-1 tabular break-words">
                    {formatPrice(result.low)} <span className="text-gray-400 font-semibold">à</span> {formatPrice(result.high)}
                  </h2>
                  <p className="text-gray-700 mt-2">
                    Valeur centrale : <span className="font-semibold text-brand-navy tabular">{formatPrice(result.mid)}</span>
                    {lookup.result?.company?.found && <> pour <span className="font-semibold text-brand-navy">{lookup.result.company.name}</span></>}.
                  </p>
                  <p className="text-sm text-gray-600 mt-3 leading-relaxed">{result.method}</p>
                  {result.disclaimer && <p className="text-xs text-gray-500 mt-2 leading-relaxed">{result.disclaimer}</p>}
                </section>

                <section className="card p-5 sm:p-6" aria-labelledby="estimate-drivers-title">
                  <h3 id="estimate-drivers-title" className="font-display text-lg font-bold text-brand-navy">Vos trois réponses</h3>
                  <ul className="mt-3 space-y-3">
                    {(result.drivers || []).map((d) => (
                      <li key={d.key} className="flex items-start gap-3 min-w-0">
                        <span className={`shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full ${d.active ? 'bg-brand-green-soft text-brand-green-dark' : 'bg-brand-amber-soft text-brand-amber'}`} aria-hidden="true">
                          {d.active ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                        </span>
                        <div className="min-w-0">
                          <p className="font-semibold text-brand-navy break-words">
                            {d.label} <span className={`tabular text-sm ${d.active ? 'text-brand-green-dark' : 'text-brand-amber'}`}>{d.effect_label}</span>
                          </p>
                          <p className="text-sm text-gray-600 leading-relaxed">{d.hint}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>

                {Array.isArray(result.pedagogy) && result.pedagogy.length > 0 && (
                  <section className="card p-5 sm:p-6" aria-labelledby="estimate-pedagogy-title">
                    <h3 id="estimate-pedagogy-title" className="font-display text-lg font-bold text-brand-navy">Ce qui fait monter la valeur</h3>
                    <ul className="mt-3 space-y-2">
                      {result.pedagogy.map((p) => (
                        <li key={p} className="flex items-start gap-2 text-sm text-gray-700 leading-relaxed">
                          <CheckCircle2 className="w-4 h-4 mt-0.5 text-brand-navy shrink-0" aria-hidden="true" />
                          <span className="min-w-0 break-words">{p}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                <section className="card p-5 sm:p-6 bg-brand-navy text-white border-brand-navy" aria-labelledby="estimate-next-title">
                  <h3 id="estimate-next-title" className="font-display text-xl font-bold">Et maintenant ?</h3>
                  <p className="text-gray-200 mt-2 leading-relaxed">
                    Déposez une annonce anonyme préremplie avec ces éléments. Les repreneurs se présentent avec leur projet ; votre nom n'est révélé qu'après un accord de confidentialité signé. {OFFER.commissionSentence}
                  </p>
                  <div className="mt-4 flex flex-col sm:flex-row gap-3">
                    <button type="button" onClick={depositListing} className="btn-secondary border-white w-full sm:w-auto" data-testid="estimate-deposit-btn">
                      Déposer mon annonce anonyme
                      <ArrowRight className="w-4 h-4" aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => setStep(2)} className="btn-link text-gray-200 hover:text-white justify-center">Refaire une estimation</button>
                  </div>
                </section>

                <section className="card p-5 sm:p-6" aria-labelledby="estimate-email-title">
                  {emailState === 'sent' ? (
                    <div className="flex items-start gap-3" role="status">
                      <Mail className="w-5 h-5 mt-0.5 text-brand-navy shrink-0" aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="font-display font-bold text-brand-navy">Vérifiez votre boîte mail</p>
                        <p className="text-sm text-gray-700 mt-1 leading-relaxed break-words">
                          Un e-mail vient d'être envoyé à <span className="font-semibold">{email.trim()}</span>. Cliquez sur le lien qu'il contient (valable 48 heures) pour recevoir l'estimation. Sans ce clic, votre adresse est effacée sous 7 jours.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <form onSubmit={sendByEmail} className="space-y-3" noValidate>
                      <h3 id="estimate-email-title" className="font-display text-lg font-bold text-brand-navy">Recevoir cette estimation par e-mail <span className="text-gray-500 font-normal text-base">(facultatif)</span></h3>
                      <div className="flex flex-col sm:flex-row gap-3">
                        <div className="flex-1 min-w-0">
                          <label htmlFor="estimate-email" className="sr-only">Adresse e-mail</label>
                          <input id="estimate-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="prenom@entreprise.fr" className={inputClass} data-testid="estimate-email-input" />
                        </div>
                        <button type="submit" disabled={emailState === 'sending'} className="btn-secondary w-full sm:w-auto" data-testid="estimate-email-submit">
                          {emailState === 'sending' ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Mail className="w-4 h-4" aria-hidden="true" />}
                          M'envoyer l'estimation
                        </button>
                      </div>
                      <p className="text-xs text-gray-500 leading-relaxed">
                        Double confirmation : vous recevez d'abord un lien à cliquer, puis l'estimation. Votre adresse ne sert qu'à cet envoi, n'est jamais conservée sans ce clic et peut être effacée à tout moment sur simple demande.
                      </p>
                    </form>
                  )}
                </section>
              </div>
            )}
          </div>

          <aside className="min-w-0 space-y-4 lg:sticky lg:top-24 self-start">
            <div className="card p-5">
              <p className="eyebrow mb-2">Comment est calculée la fourchette</p>
              <ul className="text-sm text-gray-700 space-y-2 leading-relaxed">
                <li>0,3 à 0,6 × chiffre d'affaires et 2,5 à 4 × EBE, pondérés, puis ± 5 % par case cochée.</li>
                <li>Le résultat est arrondi à 5 000 € : c'est un ordre de grandeur, pas une expertise.</li>
                <li>Un expert-comptable ou un conseil en transmission affine ce chiffre avec vos retraitements.</li>
              </ul>
            </div>
            <div className="card p-5">
              <p className="eyebrow mb-2">Vos données</p>
              <ul className="text-sm text-gray-700 space-y-2 leading-relaxed">
                <li className="flex items-start gap-2"><Lock className="w-4 h-4 mt-0.5 text-brand-navy shrink-0" aria-hidden="true" />Aucune donnée nominative n'est conservée sans votre accord explicite (lien de confirmation).</li>
                <li className="flex items-start gap-2"><ShieldCheck className="w-4 h-4 mt-0.5 text-brand-navy shrink-0" aria-hidden="true" />Les informations d'entreprise viennent de bases publiques (annuaire des entreprises, liste ADEME).</li>
              </ul>
            </div>
            <div className="card p-5">
              <p className="eyebrow mb-2">Rien à payer avant la vente</p>
              <p className="text-sm text-gray-700 leading-relaxed">{OFFER.commissionSentence}</p>
              <Link to={user && user.role === 'seller' ? '/seller/create' : '/register?role=seller'} className="btn-link text-sm mt-3">Déposer mon annonce<ArrowRight className="w-4 h-4" aria-hidden="true" /></Link>
            </div>
          </aside>
        </div>
      </section>
    </AppLayout>
  );
};

export default EstimatePage;
