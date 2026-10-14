import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertCircle, FileSignature, Info, Loader2, Plus, X } from 'lucide-react';
import { axiosInstance } from '@/App';
import OtpSignatureDialog from '@/components/OtpSignatureDialog';
import { Field, NumberInput, TextInput, SelectInput } from '@/components/seller/FormFields';
import { apiErrorMessage, apiErrorCode, isEmailNotVerifiedError } from '@/components/account/errors';
import { formatPrice, formatDateFr } from '@/components/shared/formatters';
import { BRAND } from '@/lib/brand';
import { trackEvent } from '@/lib/analytics';
import { FINANCING_LABELS, SALE_OBJECT_LABELS, rememberOfferText, recallOfferText, forgetOfferText } from './api';

// Offre d'achat (SPEC §7.3, API.md §5) : formulaire structuré → POST /offers → signature par code
// (OtpSignatureDialog sur le contrat renvoyé) → l'offre passe de `pending_signature` à `pending`.
// L'offre, même acceptée, n'emporte pas vente : elle ouvre la négociation de l'avant-contrat chez le notaire.

export const VALIDITY_MIN_DAYS = 5;
export const VALIDITY_MAX_DAYS = 30;

export const SUGGESTED_CONDITIONS = [
  'Visite du bien, organisée par le vendeur avec l\'accord du locataire',
  'Remise du bail, de ses avenants et des quittances des 12 derniers mois',
  'Dossier de diagnostic technique complet et à jour',
  'Situation locative conforme à l\'annonce (loyer, dépôt de garantie, aucun impayé)',
  'Aucune procédure en cours dans la copropriété',
];

// Notes juridiques affichées avant la signature (SPEC §7.3)
export const OFFER_LEGAL_NOTES = [
  'Cette offre, même acceptée, n\'emporte pas vente : elle engage les parties à négocier de bonne foi un avant-contrat (promesse ou compromis de vente) chez le notaire, qui en fixera toutes les conditions.',
  'Si vous financez l\'achat par un prêt, vous pouvez soumettre votre offre à la condition suspensive de son obtention (art. L313-40 du Code de la consommation) ; elle sera reprise dans l\'avant-contrat.',
  'Si vous achetez un logement en tant que non-professionnel, vous disposerez d\'un délai de rétractation de 10 jours à compter de la notification de l\'avant-contrat (art. L271-1 du Code de la construction et de l\'habitation).',
  `Aucune somme n'est versée à ${BRAND.legalName} ni au vendeur à ce stade.`,
];

const isoToday = () => new Date().toISOString().slice(0, 10);
const addDays = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const num = (v) => {
  const n = Number(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

// La cession de parts n'est possible que si le bien appartient à une société (SPEC §3.3)
export const partsAllowed = (property) => ['sci', 'societe'].includes(property?.owner_type) || ['parts', 'indifferent'].includes(property?.sale_object);
export const defaultSaleObject = (property) => (property?.sale_object === 'parts' && partsAllowed(property) ? 'parts' : 'bien');

const loanConditionText = (lc) => {
  if (!lc || !lc.required) return 'Sans condition suspensive de prêt';
  const parts = [];
  if (Number(lc.amount) > 0) parts.push(`prêt de ${formatPrice(lc.amount)}`);
  if (Number(lc.duration_years) > 0) parts.push(`sur ${lc.duration_years} ans`);
  if (Number(lc.max_rate) > 0) parts.push(`au taux maximum de ${String(lc.max_rate).replace('.', ',')} % hors assurance`);
  return `Sous condition suspensive d'obtention d'un ${parts.length ? parts.join(' ') : 'prêt'}`;
};

// Corps POST /offers à partir des valeurs du formulaire (API.md §5)
export const offerPayload = (propertyId, form) => {
  const loanRequired = form.loan_required === true;
  const payload = {
    property_id: propertyId,
    amount: num(form.amount),
    sale_object: form.sale_object === 'parts' ? 'parts' : 'bien',
    financing: { equity: num(form.equity), loan: num(form.loan) },
    loan_condition: loanRequired
      ? {
        required: true,
        amount: num(form.loan_amount) || num(form.loan) || null,
        max_rate: num(form.loan_max_rate) || null,
        duration_years: num(form.loan_duration_years) || null,
      }
      : { required: false },
    conditions: Array.isArray(form.conditions) ? form.conditions : [],
    target_date: form.target_date,
    validity_days: Number(form.validity_days),
    message: String(form.message || '').trim() || null,
  };
  return payload;
};

// Texte lisible de l'offre, utilisé quand le texte du contrat n'est plus disponible côté navigateur
export const offerSummaryText = (offer, propertyTitle) => {
  const o = offer || {};
  const f = o.financing && typeof o.financing === 'object' ? o.financing : {};
  const lines = [
    `OFFRE D'ACHAT${o.contract_number ? ` n° ${o.contract_number}` : ''}`,
    propertyTitle ? `Bien : ${propertyTitle}` : '',
    `Prix proposé : ${formatPrice(o.amount)}`,
    `Objet : ${SALE_OBJECT_LABELS[o.sale_object] || SALE_OBJECT_LABELS.bien}`,
    `Financement : ${Object.keys(FINANCING_LABELS).map((k) => `${FINANCING_LABELS[k]} ${formatPrice(f[k] || 0)}`).join(' · ')}`,
    loanConditionText(o.loan_condition),
    o.target_date ? `Signature de l'avant-contrat souhaitée vers le : ${formatDateFr(o.target_date)}` : '',
    o.validity_days ? `Validité : ${o.validity_days} jours` : '',
    Array.isArray(o.conditions) && o.conditions.length ? `Conditions :\n${o.conditions.map((c) => `- ${c}`).join('\n')}` : 'Conditions : aucune condition particulière',
    o.message ? `Message au vendeur :\n${o.message}` : '',
    '',
    ...OFFER_LEGAL_NOTES,
  ];
  return lines.filter((l) => l !== '').join('\n');
};

// Boîte de signature d'une offre (création ou offre encore « à signer ») : POST /contracts/{id}/sign {otp_code}
export const OfferSignatureDialog = ({ open, onClose, offer, contractId, documentText, propertyTitle, onSigned }) => {
  const text = documentText || recallOfferText(contractId) || offerSummaryText(offer, propertyTitle);
  const sign = async (otpCode) => {
    const res = await axiosInstance.post(`/contracts/${contractId}/sign`, { otp_code: otpCode });
    trackEvent('offer_signed', { listing: String(offer?.property_id || '') });
    forgetOfferText(contractId);
    toast.success('Offre d\'achat signée et transmise au vendeur. Vous serez prévenu par e-mail de sa réponse.', { duration: 8000 });
    if (typeof onSigned === 'function') await onSigned(res.data || {});
  };
  return (
    <OtpSignatureDialog
      open={open}
      onClose={onClose}
      title="Signer mon offre d'achat"
      subtitle={propertyTitle || undefined}
      contractId={contractId}
      documentText={text}
      acceptLabel="J'ai lu mon offre d'achat. Je comprends qu'elle n'emporte pas vente et ouvre la négociation d'un avant-contrat chez le notaire, et que cette signature électronique a valeur juridique."
      signLabel="Signer mon offre"
      onSign={sign}
    />
  );
};

const OfferForm = ({ property, onSigned, onCancel }) => {
  const idp = useId();
  const canChooseParts = partsAllowed(property);
  const [form, setForm] = useState({
    amount: property?.asking_price ? String(property.asking_price) : '',
    sale_object: defaultSaleObject(property),
    equity: '',
    loan: '',
    loan_required: false,
    loan_amount: '',
    loan_max_rate: '',
    loan_duration_years: '',
    conditions: [],
    customCondition: '',
    target_date: addDays(30),
    validity_days: '10',
    message: '',
  });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState(null); // { message, offerId? }
  const [created, setCreated] = useState(null); // { offer, contract_id, content }

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));
  const financingTotal = useMemo(() => num(form.equity) + num(form.loan), [form.equity, form.loan]);
  const amount = num(form.amount);
  const financingGap = financingTotal > 0 ? financingTotal - amount : 0;

  const toggleCondition = (text) => setForm((f) => ({
    ...f,
    conditions: f.conditions.includes(text) ? f.conditions.filter((c) => c !== text) : [...f.conditions, text],
  }));
  const addCustomCondition = () => {
    const text = form.customCondition.trim();
    if (!text) return;
    setForm((f) => ({ ...f, conditions: f.conditions.includes(text) ? f.conditions : [...f.conditions, text], customCondition: '' }));
  };
  const toggleLoanCondition = (checked) => setForm((f) => ({
    ...f,
    loan_required: checked,
    loan_amount: checked && !f.loan_amount && num(f.loan) > 0 ? f.loan : f.loan_amount,
  }));

  const validate = () => {
    const e = {};
    if (!(amount > 0)) e.amount = 'Indiquez le prix que vous proposez.';
    if (!form.target_date || form.target_date < isoToday()) e.target_date = 'Indiquez une date à venir.';
    const v = Number(form.validity_days);
    if (!(Number.isInteger(v) && v >= VALIDITY_MIN_DAYS && v <= VALIDITY_MAX_DAYS)) e.validity_days = `Entre ${VALIDITY_MIN_DAYS} et ${VALIDITY_MAX_DAYS} jours.`;
    if (form.loan_required) {
      const rate = num(form.loan_max_rate);
      const years = num(form.loan_duration_years);
      if (!(num(form.loan_amount) > 0) && !(num(form.loan) > 0)) e.loan_amount = 'Indiquez le montant du prêt.';
      if (form.loan_max_rate !== '' && !(rate > 0 && rate <= 15)) e.loan_max_rate = 'Un taux entre 0 et 15 %.';
      if (form.loan_duration_years !== '' && !(years >= 1 && years <= 30)) e.loan_duration_years = 'Entre 1 et 30 ans.';
    }
    if (form.conditions.length > 20) e.conditions = '20 conditions au maximum.';
    if (form.message.length > 2000) e.message = '2 000 caractères au maximum.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (ev) => {
    ev.preventDefault();
    if (!validate() || submitting) return;
    setSubmitting(true);
    setServerError(null);
    const payload = offerPayload(property.id, form);
    try {
      const res = await axiosInstance.post('/offers', payload);
      const data = res.data || {};
      rememberOfferText(data.contract_id, data.content);
      setCreated({ offer: data.offer || payload, contract_id: data.contract_id, content: data.content });
    } catch (error) {
      if (isEmailNotVerifiedError(error)) {
        setServerError({ message: 'Confirmez d\'abord votre adresse e-mail (bandeau en haut de page) pour signer une offre.' });
      } else {
        const code = apiErrorCode(error);
        const offerId = error?.response?.data?.detail?.offer_id;
        setServerError({
          message: apiErrorMessage(error, 'L\'offre n\'a pas pu être enregistrée. Réessayez dans quelques instants.'),
          offerId: code === 'validation' && offerId ? offerId : null,
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const saleObjectOptions = [
    { value: 'bien', label: SALE_OBJECT_LABELS.bien },
    { value: 'parts', label: SALE_OBJECT_LABELS.parts },
  ];

  return (
    <>
      <form onSubmit={submit} noValidate className="space-y-6 min-w-0" data-testid="offer-form">
        <div className="rounded-xl bg-brand-surface border border-brand-line p-4 text-sm text-gray-700 leading-relaxed">
          <p className="font-semibold text-brand-navy">Comment ça se passe</p>
          <p className="mt-1">
            Vous signez votre offre d&apos;achat par un code reçu par e-mail. Le vendeur l&apos;accepte (il la contresigne), la refuse avec un motif ou vous fait une contre-proposition.
            Une offre acceptée ouvre la préparation de l&apos;avant-contrat chez le notaire.
          </p>
          {property?.asking_price != null && <p className="mt-2">Prix demandé par le vendeur : <strong className="tabular">{formatPrice(property.asking_price)}</strong> (honoraires inclus, à la charge du vendeur)</p>}
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Prix proposé" required error={errors.amount} hint="Prix net vendeur, frais de notaire en sus à votre charge." htmlFor={`${idp}-amount`}>
            {(p) => <NumberInput value={form.amount} onChange={set('amount')} min={1} step={1000} testId="offer-amount" {...p} />}
          </Field>
          {canChooseParts ? (
            <Field label="Objet de l'offre" required htmlFor={`${idp}-object`} hint="Le bien appartient à une société : vous pouvez acheter le bien ou les parts de la société.">
              {(p) => <SelectInput value={form.sale_object} onChange={set('sale_object')} options={saleObjectOptions} placeholder="Choisir" testId="offer-sale-object" {...p} />}
            </Field>
          ) : (
            <div className="min-w-0">
              <p className="text-sm font-semibold text-brand-navy mb-1.5">Objet de l&apos;offre</p>
              <p className="rounded-xl border border-brand-line bg-brand-surface px-4 py-3 text-brand-navy" data-testid="offer-sale-object-fixed">{SALE_OBJECT_LABELS.bien}</p>
            </div>
          )}
        </div>

        <fieldset className="min-w-0">
          <legend className="text-sm font-semibold text-brand-navy mb-1">Plan de financement</legend>
          <p className="text-sm text-gray-500 mb-3">Montants indicatifs. Le total peut dépasser le prix (frais de notaire, travaux).</p>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label={FINANCING_LABELS.equity} help="Fonds propres que vous apportez, personnellement ou par votre société." htmlFor={`${idp}-equity`}>
              {(p) => <NumberInput value={form.equity} onChange={set('equity')} min={0} step={1000} testId="offer-equity" {...p} />}
            </Field>
            <Field label={FINANCING_LABELS.loan} help="Part financée par la banque." htmlFor={`${idp}-loan`}>
              {(p) => <NumberInput value={form.loan} onChange={set('loan')} min={0} step={1000} testId="offer-loan" {...p} />}
            </Field>
          </div>
          {financingTotal > 0 && (
            <p className="text-sm text-gray-600 mt-2 tabular" data-testid="offer-financing-total">
              Total du financement : <strong className="text-brand-navy">{formatPrice(financingTotal)}</strong>
              {amount > 0 && financingGap < -0.5 && (
                <span className="text-brand-amber"> ({formatPrice(Math.abs(financingGap))} de moins que le prix proposé)</span>
              )}
            </p>
          )}
        </fieldset>

        <fieldset className="min-w-0 rounded-xl border border-brand-line p-4" data-testid="offer-loan-condition">
          <legend className="px-1 text-sm font-semibold text-brand-navy">Condition suspensive de prêt</legend>
          <div className="flex items-start gap-3">
            <input
              id={`${idp}-loan-required`}
              type="checkbox"
              checked={form.loan_required}
              onChange={(e) => toggleLoanCondition(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-navy focus:ring-brand-blue"
              data-testid="offer-loan-required"
            />
            <label htmlFor={`${idp}-loan-required`} className="text-sm text-gray-800 leading-snug">
              Mon offre est soumise à l&apos;obtention d&apos;un prêt immobilier. Si le prêt est refusé, je ne serai pas tenu d&apos;acheter (art. L313-40 du Code de la consommation).
            </label>
          </div>
          {form.loan_required && (
            <div className="grid sm:grid-cols-3 gap-4 mt-4">
              <Field label="Montant du prêt" required error={errors.loan_amount} htmlFor={`${idp}-loan-amount`}>
                {(p) => <NumberInput value={form.loan_amount} onChange={set('loan_amount')} min={1} step={1000} testId="offer-loan-amount" {...p} />}
              </Field>
              <Field label="Taux maximum" optional error={errors.loan_max_rate} hint="Hors assurance." htmlFor={`${idp}-loan-rate`}>
                {(p) => <NumberInput value={form.loan_max_rate} onChange={set('loan_max_rate')} min={0} max={15} step={0.05} suffix="%" testId="offer-loan-rate" {...p} />}
              </Field>
              <Field label="Durée" optional error={errors.loan_duration_years} htmlFor={`${idp}-loan-years`}>
                {(p) => <NumberInput value={form.loan_duration_years} onChange={set('loan_duration_years')} min={1} max={30} step={1} suffix="ans" testId="offer-loan-years" {...p} />}
              </Field>
            </div>
          )}
        </fieldset>

        <fieldset className="min-w-0">
          <legend className="text-sm font-semibold text-brand-navy mb-1">Autres conditions de l&apos;offre</legend>
          <p className="text-sm text-gray-500 mb-3">Cochez ou ajoutez les conditions auxquelles votre offre est soumise. Le notaire les reprendra dans l&apos;avant-contrat.</p>
          <ul className="space-y-2">
            {[...SUGGESTED_CONDITIONS, ...form.conditions.filter((c) => !SUGGESTED_CONDITIONS.includes(c))].map((text) => {
              const checked = form.conditions.includes(text);
              const cid = `${idp}-cond-${text.replace(/\W+/g, '-')}`;
              return (
                <li key={text} className="flex items-start gap-3 min-w-0">
                  <input id={cid} type="checkbox" checked={checked} onChange={() => toggleCondition(text)} className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-navy focus:ring-brand-blue" />
                  <label htmlFor={cid} className="text-sm text-gray-800 leading-snug break-words">{text}</label>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-col sm:flex-row gap-2 mt-3">
            <label htmlFor={`${idp}-custom`} className="sr-only">Autre condition</label>
            <input
              id={`${idp}-custom`}
              type="text"
              value={form.customCondition}
              maxLength={200}
              onChange={(e) => set('customCondition')(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomCondition(); } }}
              placeholder="Autre condition (200 caractères maximum)"
              className="flex-1 min-w-0 rounded-xl border border-brand-line px-4 py-2.5 text-sm text-brand-navy focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
              data-testid="offer-custom-condition"
            />
            <button type="button" onClick={addCustomCondition} className="btn-secondary px-4 py-2.5 text-sm" disabled={!form.customCondition.trim()}>
              <Plus className="w-4 h-4" aria-hidden="true" />
              Ajouter
            </button>
          </div>
          {errors.conditions && <p role="alert" className="text-sm text-red-700 mt-1">{errors.conditions}</p>}
        </fieldset>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Signature de l'avant-contrat souhaitée vers le" required error={errors.target_date} hint="Indicative : promesse ou compromis de vente, chez le notaire." htmlFor={`${idp}-date`}>
            {(p) => <TextInput type="date" value={form.target_date} onChange={set('target_date')} testId="offer-target-date" {...p} />}
          </Field>
          <Field label="Validité de l'offre" required error={errors.validity_days} hint={`Entre ${VALIDITY_MIN_DAYS} et ${VALIDITY_MAX_DAYS} jours. Passé ce délai sans réponse, l'offre expire.`} htmlFor={`${idp}-validity`}>
            {(p) => <NumberInput value={form.validity_days} onChange={set('validity_days')} min={VALIDITY_MIN_DAYS} max={VALIDITY_MAX_DAYS} step={1} suffix="j" testId="offer-validity" {...p} />}
          </Field>
        </div>

        <Field label="Message au vendeur" optional error={errors.message} htmlFor={`${idp}-message`}>
          {(p) => (
            <textarea
              {...p}
              value={form.message}
              onChange={(e) => set('message')(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="Votre projet, votre calendrier, votre notaire si vous en avez déjà un."
              className="w-full rounded-xl border border-brand-line px-4 py-3 text-sm text-brand-navy focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
              data-testid="offer-message"
            />
          )}
        </Field>

        <section className="rounded-xl border border-brand-line bg-white p-4 min-w-0" aria-labelledby={`${idp}-legal`} data-testid="offer-legal-notes">
          <h3 id={`${idp}-legal`} className="flex items-center gap-2 text-sm font-semibold text-brand-navy">
            <Info className="w-4 h-4 shrink-0 text-gray-500" aria-hidden="true" />
            Ce qu&apos;il faut savoir avant de signer
          </h3>
          <ul className="mt-2 space-y-1.5 text-sm text-gray-700 leading-relaxed list-disc pl-5">
            {OFFER_LEGAL_NOTES.map((note) => <li key={note}>{note}</li>)}
          </ul>
        </section>

        {serverError && (
          <p role="alert" className="flex items-start gap-2 text-sm text-red-800 bg-red-50 border border-red-200 rounded-xl px-4 py-3" data-testid="offer-error">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              {serverError.message}
              {serverError.offerId && <> <Link to="/buyer/dashboard#offres" className="underline underline-offset-2 font-semibold">Voir mon offre en cours</Link></>}
            </span>
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-3 sm:justify-end">
          {typeof onCancel === 'function' && (
            <button type="button" onClick={onCancel} className="btn-secondary px-5 py-3 text-sm" data-testid="offer-cancel">
              <X className="w-4 h-4" aria-hidden="true" />
              Annuler
            </button>
          )}
          <button type="submit" className="btn-primary px-5 py-3 text-sm" disabled={submitting} data-testid="offer-submit">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <FileSignature className="w-4 h-4" aria-hidden="true" />}
            Préparer et signer mon offre d&apos;achat
          </button>
        </div>
      </form>

      {created && (
        <OfferSignatureDialog
          open
          onClose={() => setCreated(null)}
          offer={created.offer}
          contractId={created.contract_id}
          documentText={created.content}
          propertyTitle={property?.title}
          onSigned={async (data) => {
            setCreated(null);
            if (typeof onSigned === 'function') await onSigned({ ...created.offer, status: 'pending', ...data });
          }}
        />
      )}
    </>
  );
};

export { loanConditionText };
export default OfferForm;
