import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Calculator, CheckCircle2, Clock, Info, Loader2, Lock, Mail, MailX, ShieldCheck, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { axiosInstance } from '@/App';
import AppLayout from '@/components/layout/AppLayout';
import { Breadcrumbs, fillText } from '@/components/seo/Content';
import { useSeo, SITE_URL } from '@/lib/seo';
import { content } from '@/seo';
import { breadcrumbLd } from '@/seo/schema';
import { commissionSentenceFor } from '@/lib/offer';
import { useCommission } from '@/lib/useCommission';
import { trackEvent } from '@/lib/analytics';
import { formatPrice, formatYield } from '@/components/shared/formatters';
import { apiErrorMessage } from '@/components/account/errors';
import { PROPERTY_TYPES, LEASE_TYPES, departementOptions, grossYield } from '@/lib/referentiels';
import { ESTIMATE_STORAGE_KEY, defaultLeaseFor } from '@/components/seller/listingForm';

// /estimer (docs/venteloc/SPEC.md §6.1, API.md §8) : estimateur par la méthode du rendement, sans compte ni appel
// externe. Type de bien, bail, département, loyer (et, si connus, surface, charges, taxe foncière, charges non
// récupérables, prix envisagé) → POST /estimates → fourchette, rendements, facteurs, pédagogie, avertissement ;
// e-mail facultatif avec consentement (double opt-in) ; « Déposer mon annonce » préremplit le formulaire
// (sessionStorage 'estimate', lu par CreateListing).

const PATH = '/estimer';
const inputClass = 'w-full rounded-xl border border-brand-line bg-white px-4 py-3 text-brand-navy focus:border-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30';

const CONFIRMATION_MESSAGES = {
  ok: { tone: 'ok', icon: CheckCircle2, text: 'Adresse confirmée : votre estimation vous a été envoyée par e-mail.' },
  invalide: { tone: 'ko', icon: MailX, text: 'Ce lien de confirmation n\'est pas valide. Refaites une estimation ci-dessous pour en recevoir un nouveau.' },
  expire: { tone: 'warn', icon: Clock, text: 'Ce lien de confirmation a expiré (48 heures). Refaites une estimation ci-dessous pour en recevoir un nouveau.' },
};

const EMPTY = {
  property_type: '', lease_type: '', department: '', surface: '', rent_monthly: '', charges_monthly: '', property_tax: '',
  non_recoverable_charges: '', asking_price: '',
};

// Montant en euros, saisie fr-FR (chiffres seulement, séparateur de milliers affiché)
export const MoneyInput = ({ id, value, onChange, placeholder = '', suffix = '€', ...rest }) => {
  const digits = String(value || '').replace(/\D/g, '');
  const display = digits ? Number(digits).toLocaleString('fr-FR') : '';
  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        inputMode="numeric"
        value={display}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 9))}
        placeholder={placeholder}
        className={`${inputClass} pr-16 tabular`}
        {...rest}
      />
      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-gray-500" aria-hidden="true">{suffix}</span>
    </div>
  );
};

const toNumber = (v) => {
  const s = String(v == null ? '' : v).replace(/\s/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

// Formulaire → corps de POST /estimates (champs vides omis)
export const estimatePayload = (form, extra = {}) => {
  const out = {
    property_type: form.property_type,
    lease_type: form.lease_type,
    department: form.department,
    rent_monthly: toNumber(form.rent_monthly),
  };
  ['surface', 'charges_monthly', 'property_tax', 'non_recoverable_charges', 'asking_price'].forEach((k) => {
    if (k === 'surface' && form.property_type === 'parking') return;
    const n = toNumber(form[k]);
    if (n !== null && n > 0) out[k] = n;
  });
  return { ...out, ...extra };
};

const Field = ({ id, label, hint, optional, children }) => (
  <div className="min-w-0">
    <label htmlFor={id} className="block text-sm font-semibold text-brand-navy mb-1">
      {label}{optional && <span className="font-normal text-gray-500"> (facultatif)</span>}
    </label>
    {children}
    {hint && <p id={`${id}-hint`} className="text-xs text-gray-600 mt-1 leading-snug">{hint}</p>}
  </div>
);

const EstimatePage = ({ user }) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const commission = useCommission();
  const page = content.estimate;
  const crumbs = [{ name: 'Accueil', path: '/' }, { name: 'Estimer mon bien', path: PATH }];
  useSeo(fillText(page.title), fillText(page.description), { path: PATH, jsonLd: breadcrumbLd(SITE_URL, crumbs) });

  const confirmation = CONFIRMATION_MESSAGES[searchParams.get('confirmation')] || null;
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [emailState, setEmailState] = useState('idle'); // idle | sending | sent
  const startedRef = useRef(false);
  const resultRef = useRef(null);
  const departements = useMemo(() => departementOptions(), []);

  const set = (key) => (value) => {
    if (!startedRef.current) {
      startedRef.current = true;
      trackEvent('estimate_started', { how: 'form' });
    }
    setForm((f) => {
      const next = { ...f, [key]: value };
      // Bail proposé selon le type de bien (modifiable)
      if (key === 'property_type' && (!f.lease_type || f.lease_type === defaultLeaseFor(f.property_type))) next.lease_type = defaultLeaseFor(value);
      return next;
    });
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  };

  const liveGross = grossYield(toNumber(form.rent_monthly), toNumber(form.asking_price));
  const yearlyRent = toNumber(form.rent_monthly) > 0 ? toNumber(form.rent_monthly) * 12 : null;

  const validate = () => {
    const e = {};
    if (!form.property_type) e.property_type = 'Choisissez le type de bien.';
    if (!form.lease_type) e.lease_type = 'Choisissez le type de bail.';
    if (!form.department) e.department = 'Choisissez le département.';
    if (!(toNumber(form.rent_monthly) > 0)) e.rent_monthly = 'Indiquez le loyer mensuel hors charges.';
    return e;
  };

  const estimate = async (ev) => {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) {
      toast.error('Complétez les champs signalés.');
      return;
    }
    setLoading(true);
    try {
      const res = await axiosInstance.post('/estimates', estimatePayload(form));
      setResult(res.data);
      setEmailState('idle');
      trackEvent('estimate_completed', { low: res.data?.low, high: res.data?.high, property_type: form.property_type, lease_type: form.lease_type });
      window.setTimeout(() => {
        if (resultRef.current) {
          if (typeof resultRef.current.scrollIntoView === 'function') resultRef.current.scrollIntoView({ block: 'start' });
          resultRef.current.focus();
        }
      }, 50);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'L\'estimation n\'a pas pu être calculée. Vérifiez les montants saisis.'));
    } finally {
      setLoading(false);
    }
  };

  const sendByEmail = async (ev) => {
    ev.preventDefault();
    const address = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(address)) {
      toast.error('Indiquez une adresse e-mail valide.');
      return;
    }
    if (!consent) {
      toast.error('Cochez la case pour accepter l\'envoi de l\'estimation.');
      return;
    }
    setEmailState('sending');
    try {
      await axiosInstance.post('/estimates', estimatePayload(form, { email: address, consent: true }));
      setEmailState('sent');
    } catch (error) {
      setEmailState('idle');
      toast.error(apiErrorMessage(error, 'L\'e-mail n\'a pas pu être envoyé. Réessayez dans quelques instants.'));
    }
  };

  // « Déposer mon annonce » : CreateListing lit sessionStorage 'estimate' {inputs, result}
  const depositListing = () => {
    const inputs = estimatePayload(form);
    try {
      sessionStorage.setItem(ESTIMATE_STORAGE_KEY, JSON.stringify({
        inputs,
        result: result ? { low: result.low ?? null, high: result.high ?? null, mid: result.mid ?? null } : null,
        saved_at: new Date().toISOString(),
      }));
    } catch (err) {
      // stockage indisponible : l'annonce sera saisie sans préremplissage
    }
    trackEvent('estimate_deposit', { property_type: form.property_type });
    navigate(user && user.role === 'seller' ? '/seller/create' : '/register?role=seller');
  };

  const yields = result?.yields || {};
  const drivers = Array.isArray(result?.drivers) ? result.drivers : [];
  const pedagogy = Array.isArray(result?.pedagogy) ? result.pedagogy : [];

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

            <form onSubmit={estimate} className="card p-5 sm:p-6 space-y-6" noValidate data-testid="estimate-form">
              <div>
                <h2 className="font-display text-xl font-bold text-brand-navy">Votre bien et sa location</h2>
                <p className="text-sm text-gray-600 mt-1 leading-relaxed">Quatre informations suffisent ; les montants facultatifs affinent le rendement net.</p>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <Field id="estimate-type" label="Type de bien">
                  <select id="estimate-type" value={form.property_type} onChange={(e) => set('property_type')(e.target.value)} className={inputClass} aria-invalid={errors.property_type ? 'true' : undefined} data-testid="estimate-type-select">
                    <option value="">Choisir</option>
                    {PROPERTY_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                  {errors.property_type && <p role="alert" className="text-sm text-red-700 mt-1">{errors.property_type}</p>}
                </Field>
                <Field id="estimate-lease" label="Type de bail">
                  <select id="estimate-lease" value={form.lease_type} onChange={(e) => set('lease_type')(e.target.value)} className={inputClass} aria-invalid={errors.lease_type ? 'true' : undefined} data-testid="estimate-lease-select">
                    <option value="">Choisir</option>
                    {LEASE_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                  {errors.lease_type && <p role="alert" className="text-sm text-red-700 mt-1">{errors.lease_type}</p>}
                </Field>
                <Field id="estimate-department" label="Département">
                  <select id="estimate-department" value={form.department} onChange={(e) => set('department')(e.target.value)} className={inputClass} aria-invalid={errors.department ? 'true' : undefined} data-testid="estimate-department-select">
                    <option value="">Choisir</option>
                    {departements.map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}
                  </select>
                  {errors.department && <p role="alert" className="text-sm text-red-700 mt-1">{errors.department}</p>}
                </Field>
                {form.property_type !== 'parking' && (
                  <Field id="estimate-surface" label="Surface" optional>
                    <MoneyInput id="estimate-surface" value={form.surface} onChange={set('surface')} suffix="m²" data-testid="estimate-surface-input" />
                  </Field>
                )}
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <Field id="estimate-rent" label="Loyer mensuel hors charges" hint={yearlyRent ? `Soit ${formatPrice(yearlyRent)} de loyers par an.` : 'Le loyer du bail en cours, sans les provisions sur charges.'}>
                  <MoneyInput id="estimate-rent" value={form.rent_monthly} onChange={set('rent_monthly')} suffix="€/mois" aria-invalid={errors.rent_monthly ? 'true' : undefined} aria-describedby="estimate-rent-hint" data-testid="estimate-rent-input" />
                  {errors.rent_monthly && <p role="alert" className="text-sm text-red-700 mt-1">{errors.rent_monthly}</p>}
                </Field>
                <Field id="estimate-charges" label="Provisions sur charges" optional hint="Charges récupérables payées par le locataire.">
                  <MoneyInput id="estimate-charges" value={form.charges_monthly} onChange={set('charges_monthly')} suffix="€/mois" aria-describedby="estimate-charges-hint" data-testid="estimate-charges-input" />
                </Field>
                <Field id="estimate-tax" label="Taxe foncière annuelle" optional hint="Si vous la laissez vide, elle est estimée à un mois de loyer.">
                  <MoneyInput id="estimate-tax" value={form.property_tax} onChange={set('property_tax')} suffix="€/an" aria-describedby="estimate-tax-hint" data-testid="estimate-tax-input" />
                </Field>
                <Field id="estimate-nonrec" label="Charges non récupérables par an" optional hint="Copropriété non récupérable, assurance propriétaire non occupant, gestion. Vide : 5 % des loyers.">
                  <MoneyInput id="estimate-nonrec" value={form.non_recoverable_charges} onChange={set('non_recoverable_charges')} suffix="€/an" aria-describedby="estimate-nonrec-hint" data-testid="estimate-nonrec-input" />
                </Field>
                <Field id="estimate-price" label="Prix que vous envisagez" optional hint={liveGross ? `Rendement brut à ce prix : ${formatYield(liveGross)}.` : 'Pour connaître le rendement que verra un acquéreur.'}>
                  <MoneyInput id="estimate-price" value={form.asking_price} onChange={set('asking_price')} aria-describedby="estimate-price-hint" data-testid="estimate-price-input" />
                </Field>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <button type="submit" disabled={loading} className="btn-primary w-full sm:w-auto" data-testid="estimate-submit">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Calculator className="w-4 h-4" aria-hidden="true" />}
                  Obtenir ma fourchette
                </button>
                <p className="text-xs text-gray-600">Rien n'est enregistré : aucune donnée nominative sans votre accord.</p>
              </div>
            </form>

            {result && (
              <div className="space-y-5" data-testid="estimate-result">
                <section ref={resultRef} tabIndex={-1} className="card p-5 sm:p-6 scroll-mt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal" aria-labelledby="estimate-result-title">
                  <p className="eyebrow">Fourchette indicative</p>
                  <h2 id="estimate-result-title" className="font-display text-2xl sm:text-3xl font-extrabold text-brand-navy mt-1 tabular break-words" data-testid="estimate-range">
                    {formatPrice(result.low)} <span className="text-gray-400 font-semibold">à</span> {formatPrice(result.high)}
                  </h2>
                  <p className="text-gray-700 mt-2">
                    Valeur centrale : <span className="font-semibold text-brand-navy tabular">{formatPrice(result.mid)}</span>
                  </p>
                  <dl className="mt-4 grid grid-cols-2 gap-3" data-testid="estimate-yields">
                    {formatYield(yields.gross_at_mid) && (
                      <div className="rounded-xl bg-brand-teal-soft border border-brand-teal-line/70 p-3 min-w-0">
                        <dt className="text-xs font-medium text-brand-teal-dark">Rendement brut à la valeur centrale</dt>
                        <dd className="font-display text-xl font-extrabold text-brand-teal-dark tabular">{formatYield(yields.gross_at_mid)}</dd>
                      </div>
                    )}
                    {formatYield(yields.net_at_mid) && (
                      <div className="rounded-xl bg-brand-surface border border-brand-line p-3 min-w-0">
                        <dt className="text-xs font-medium text-gray-600">Rendement net à la valeur centrale</dt>
                        <dd className="font-display text-xl font-extrabold text-brand-navy tabular">{formatYield(yields.net_at_mid)}</dd>
                      </div>
                    )}
                    {formatYield(yields.gross_at_price) && (
                      <div className="rounded-xl bg-brand-surface border border-brand-line p-3 min-w-0" data-testid="estimate-yield-at-price">
                        <dt className="text-xs font-medium text-gray-600">Brut à votre prix ({formatPrice(toNumber(form.asking_price))})</dt>
                        <dd className="font-display text-xl font-extrabold text-brand-navy tabular">{formatYield(yields.gross_at_price)}</dd>
                      </div>
                    )}
                    {formatYield(yields.net_at_price) && (
                      <div className="rounded-xl bg-brand-surface border border-brand-line p-3 min-w-0">
                        <dt className="text-xs font-medium text-gray-600">Net à votre prix</dt>
                        <dd className="font-display text-xl font-extrabold text-brand-navy tabular">{formatYield(yields.net_at_price)}</dd>
                      </div>
                    )}
                  </dl>
                  {result.method && <p className="text-sm text-gray-700 mt-4 leading-relaxed">{result.method}</p>}
                  {result.disclaimer && <p className="text-xs text-gray-600 mt-2 leading-relaxed" data-testid="estimate-disclaimer">{result.disclaimer}</p>}
                </section>

                {drivers.length > 0 && (
                  <section className="card p-5 sm:p-6" aria-labelledby="estimate-drivers-title">
                    <h3 id="estimate-drivers-title" className="font-display text-lg font-bold text-brand-navy">Ce qui a été pris en compte</h3>
                    <ul className="mt-3 divide-y divide-brand-line" data-testid="estimate-drivers">
                      {drivers.map((d) => (
                        <li key={`${d.label}-${d.effect}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 min-w-0">
                          <span className="text-sm text-gray-800 break-words min-w-0">{d.label}</span>
                          {d.effect && <span className="text-sm font-semibold text-brand-navy tabular">{d.effect}</span>}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {pedagogy.length > 0 && (
                  <section className="card p-5 sm:p-6" aria-labelledby="estimate-pedagogy-title">
                    <h3 id="estimate-pedagogy-title" className="font-display text-lg font-bold text-brand-navy">Ce qui fait monter le prix</h3>
                    <ul className="mt-3 space-y-2">
                      {pedagogy.map((p) => (
                        <li key={p} className="flex items-start gap-2 text-sm text-gray-700 leading-relaxed">
                          <TrendingUp className="w-4 h-4 mt-0.5 text-brand-teal shrink-0" aria-hidden="true" />
                          <span className="min-w-0 break-words">{p}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                <section className="card p-5 sm:p-6 border-brand-teal-line bg-brand-teal-soft" aria-labelledby="estimate-next-title">
                  <h3 id="estimate-next-title" className="font-display text-xl font-bold text-brand-navy">Et maintenant ?</h3>
                  <p className="text-gray-700 mt-2 leading-relaxed">
                    Déposez votre annonce, préremplie avec ces éléments : le bien, la location, la vente, en trois écrans. L'adresse et votre identité ne sont révélées qu'aux acquéreurs vérifiés qui ont signé l'engagement de confidentialité.
                  </p>
                  <div className="mt-4 flex flex-col sm:flex-row gap-3">
                    <button type="button" onClick={depositListing} className="btn-primary w-full sm:w-auto" data-testid="estimate-deposit-btn">
                      Déposer mon annonce
                      <ArrowRight className="w-4 h-4" aria-hidden="true" />
                    </button>
                    <Link to="/vendre" className="btn-link justify-center">Comment se passe la vente</Link>
                  </div>
                </section>

                <section className="card p-5 sm:p-6" aria-labelledby="estimate-email-title">
                  {emailState === 'sent' ? (
                    <div className="flex items-start gap-3" role="status" data-testid="estimate-email-sent">
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
                          <input id="estimate-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="prenom@exemple.fr" className={inputClass} data-testid="estimate-email-input" />
                        </div>
                        <button type="submit" disabled={emailState === 'sending'} className="btn-secondary w-full sm:w-auto" data-testid="estimate-email-submit">
                          {emailState === 'sending' ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Mail className="w-4 h-4" aria-hidden="true" />}
                          M'envoyer l'estimation
                        </button>
                      </div>
                      <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
                        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-[#0f766e]" data-testid="estimate-consent" />
                        <span>J'accepte de recevoir cette estimation par e-mail. Mon adresse ne sert qu'à cet envoi et n'est conservée qu'après confirmation.</span>
                      </label>
                      <p className="text-xs text-gray-600 leading-relaxed">
                        Double confirmation : vous recevez d'abord un lien à cliquer, puis l'estimation. Effacement à tout moment sur simple demande.
                      </p>
                    </form>
                  )}
                </section>
              </div>
            )}
          </div>

          <aside className="min-w-0 space-y-4 lg:sticky lg:top-6 self-start">
            <div className="card p-5">
              <p className="eyebrow mb-2">La méthode du rendement</p>
              <ul className="text-sm text-gray-700 space-y-2 leading-relaxed">
                <li>Loyer net annuel : loyers hors charges, moins la taxe foncière et les charges non récupérables.</li>
                <li>Rendement net attendu par un acquéreur selon la zone : Paris, grandes métropoles, autres départements ; majoré pour un local commercial, des bureaux, un parking, une résidence gérée.</li>
                <li>Prix = loyer net ÷ rendement attendu, arrondi au millier : un ordre de grandeur, pas un avis de valeur.</li>
              </ul>
            </div>
            <div className="card p-5">
              <p className="eyebrow mb-2">Vos données</p>
              <ul className="text-sm text-gray-700 space-y-2 leading-relaxed">
                <li className="flex items-start gap-2"><Lock className="w-4 h-4 mt-0.5 text-brand-teal shrink-0" aria-hidden="true" />Aucune donnée nominative n'est conservée sans votre accord explicite (lien de confirmation).</li>
                <li className="flex items-start gap-2"><ShieldCheck className="w-4 h-4 mt-0.5 text-brand-teal shrink-0" aria-hidden="true" />Calcul fait par nos soins, sans base payante ni appel extérieur.</li>
              </ul>
            </div>
            <div className="card p-5">
              <p className="eyebrow mb-2">Rien à payer avant l'acte</p>
              <p className="text-sm text-gray-700 leading-relaxed" data-testid="estimate-commission">{commissionSentenceFor(commission)}</p>
              <p className="mt-3 flex items-start gap-2 text-xs text-gray-600"><Info className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />Honoraires réglés par le notaire sur le prix, le jour de l'acte authentique.</p>
            </div>
          </aside>
        </div>
      </section>
    </AppLayout>
  );
};

export default EstimatePage;
