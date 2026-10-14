import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertCircle, FileSignature, Loader2, Plus, X } from 'lucide-react';
import { axiosInstance } from '@/App';
import OtpSignatureDialog from '@/components/OtpSignatureDialog';
import { Field, NumberInput, TextInput, SelectInput } from '@/components/seller/FormFields';
import { apiErrorMessage, apiErrorCode, isEmailNotVerifiedError } from '@/components/account/errors';
import { formatPrice, formatDateFr } from '@/components/shared/formatters';
import { OFFER } from '@/lib/offer';
import { trackEvent } from '@/lib/analytics';
import { FINANCING_LABELS, SALE_OBJECT_LABELS, rememberOfferText, recallOfferText, forgetOfferText } from './api';

// Offre indicative (SPEC §3.4, API.md §5) : formulaire structuré → POST /offers → signature par code
// (OtpSignatureDialog sur le contrat renvoyé) → l'offre passe de `pending_signature` à `pending`.

const SALE_OBJECT_OPTIONS = [
  { value: 'titres', label: SALE_OBJECT_LABELS.titres },
  { value: 'fonds', label: SALE_OBJECT_LABELS.fonds },
];

const SUGGESTED_CONDITIONS = [
  'Obtention du financement bancaire',
  'Audit comptable, social et juridique satisfaisant',
  'Maintien du référent technique et des qualifications',
  'Transfert des contrats d\'entretien et du carnet de commandes',
  'Accompagnement du cédant après la cession',
];

const isoToday = () => new Date().toISOString().slice(0, 10);
const addMonths = (months) => {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
};

const num = (v) => {
  const n = Number(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

// Texte lisible de l'offre, utilisé quand le texte du contrat n'est plus disponible côté navigateur
export const offerSummaryText = (offer, companyTitle) => {
  const o = offer || {};
  const f = o.financing && typeof o.financing === 'object' ? o.financing : {};
  const lines = [
    `OFFRE INDICATIVE${o.contract_number ? ` n° ${o.contract_number}` : ''}`,
    companyTitle ? `Entreprise : ${companyTitle}` : '',
    `Prix proposé : ${formatPrice(o.amount)}`,
    `Objet : ${SALE_OBJECT_LABELS[o.sale_object] || o.sale_object || ''}`,
    `Financement : ${Object.keys(FINANCING_LABELS).map((k) => `${FINANCING_LABELS[k]} ${formatPrice(f[k] || 0)}`).join(' · ')}`,
    o.target_date ? `Date cible de signature : ${formatDateFr(o.target_date)}` : '',
    o.validity_days ? `Validité : ${o.validity_days} jours` : '',
    Array.isArray(o.conditions) && o.conditions.length ? `Conditions :\n${o.conditions.map((c) => `- ${c}`).join('\n')}` : 'Conditions : aucune condition particulière',
    o.message ? `Message au cédant :\n${o.message}` : '',
    '',
    'Cette offre indicative n\'est pas une promesse de vente ni un engagement définitif : elle ouvre la négociation. Elle est signée par code à usage unique et contresignée par le cédant en cas d\'acceptation.',
  ];
  return lines.filter((l) => l !== '').join('\n');
};

// Boîte de signature d'une offre (création ou offre encore « à signer ») : POST /contracts/{id}/sign {otp_code}
export const OfferSignatureDialog = ({ open, onClose, offer, contractId, documentText, companyTitle, onSigned }) => {
  const text = documentText || recallOfferText(contractId) || offerSummaryText(offer, companyTitle);
  const sign = async (otpCode) => {
    const res = await axiosInstance.post(`/contracts/${contractId}/sign`, { otp_code: otpCode });
    trackEvent('offer_signed', { listing: String(offer?.company_id || '') });
    forgetOfferText(contractId);
    toast.success('Offre signée et transmise au cédant. Vous serez prévenu par e-mail de sa réponse.', { duration: 8000 });
    if (typeof onSigned === 'function') await onSigned(res.data || {});
  };
  return (
    <OtpSignatureDialog
      open={open}
      onClose={onClose}
      title="Signer mon offre indicative"
      subtitle={companyTitle || undefined}
      contractId={contractId}
      documentText={text}
      acceptLabel="J'ai lu mon offre indicative. Je comprends qu'elle ouvre une négociation sans valoir promesse de vente, et que cette signature électronique a valeur juridique."
      signLabel="Signer mon offre"
      onSign={sign}
    />
  );
};

const OfferForm = ({ company, onSigned, onCancel }) => {
  const idp = useId();
  const [form, setForm] = useState({
    amount: company?.asking_price ? String(company.asking_price) : '',
    sale_object: company?.sale_object === 'fonds' ? 'fonds' : 'titres',
    equity: '',
    loan: '',
    vendor_loan: '',
    earn_out: '',
    conditions: [],
    customCondition: '',
    target_date: addMonths(4),
    validity_days: '30',
    message: '',
  });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState(null); // { message, offerId? }
  const [created, setCreated] = useState(null); // { offer, contract_id, content }

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));
  const financingTotal = useMemo(() => num(form.equity) + num(form.loan) + num(form.vendor_loan) + num(form.earn_out), [form.equity, form.loan, form.vendor_loan, form.earn_out]);
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

  const validate = () => {
    const e = {};
    if (!(amount > 0)) e.amount = 'Indiquez le prix que vous proposez.';
    if (!form.target_date || form.target_date < isoToday()) e.target_date = 'Indiquez une date de signature à venir.';
    const v = Number(form.validity_days);
    if (!(v >= 15 && v <= 60)) e.validity_days = 'Entre 15 et 60 jours.';
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
    const payload = {
      company_id: company.id,
      amount,
      sale_object: form.sale_object,
      financing: { equity: num(form.equity), loan: num(form.loan), vendor_loan: num(form.vendor_loan), earn_out: num(form.earn_out) },
      conditions: form.conditions,
      target_date: form.target_date,
      validity_days: Number(form.validity_days),
      message: form.message.trim() || null,
    };
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

  const financingFields = [
    { key: 'equity', label: FINANCING_LABELS.equity, help: 'Fonds propres que vous apportez personnellement ou via votre société.' },
    { key: 'loan', label: FINANCING_LABELS.loan, help: 'Part financée par la banque (sous condition d\'obtention).' },
    { key: 'vendor_loan', label: FINANCING_LABELS.vendor_loan, help: 'Part du prix payée au cédant de façon différée.' },
    { key: 'earn_out', label: FINANCING_LABELS.earn_out, help: 'Complément conditionné aux résultats futurs.' },
  ];

  return (
    <>
      <form onSubmit={submit} noValidate className="space-y-6 min-w-0" data-testid="offer-form">
        <div className="rounded-xl bg-brand-surface border border-brand-line p-4 text-sm text-gray-700 leading-relaxed">
          <p className="font-semibold text-brand-navy">Comment ça se passe</p>
          <p className="mt-1">
            Vous signez votre offre par code reçu par e-mail. Le cédant l&apos;accepte (il la contresigne), la refuse avec un motif ou vous fait une contre-proposition.
            Une offre indicative ouvre la négociation : elle ne vaut pas promesse de vente. {OFFER.payerSentence}
          </p>
          {company?.asking_price != null && <p className="mt-2">Prix demandé par le cédant : <strong className="tabular">{formatPrice(company.asking_price)}</strong></p>}
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Prix proposé" required error={errors.amount} htmlFor={`${idp}-amount`}>
            {(p) => <NumberInput value={form.amount} onChange={set('amount')} min={1} step={1000} testId="offer-amount" {...p} />}
          </Field>
          <Field label="Objet de la cession" required htmlFor={`${idp}-object`}>
            {(p) => <SelectInput value={form.sale_object} onChange={set('sale_object')} options={SALE_OBJECT_OPTIONS} placeholder="Choisir" testId="offer-sale-object" {...p} />}
          </Field>
        </div>

        <fieldset className="min-w-0">
          <legend className="text-sm font-semibold text-brand-navy mb-1">Plan de financement</legend>
          <p className="text-sm text-gray-500 mb-3">Montants indicatifs. Le total peut différer du prix (frais, besoin en fonds de roulement).</p>
          <div className="grid sm:grid-cols-2 gap-4">
            {financingFields.map((f) => (
              <Field key={f.key} label={f.label} help={f.help} htmlFor={`${idp}-${f.key}`}>
                {(p) => <NumberInput value={form[f.key]} onChange={set(f.key)} min={0} step={1000} testId={`offer-${f.key}`} {...p} />}
              </Field>
            ))}
          </div>
          {financingTotal > 0 && (
            <p className="text-sm text-gray-600 mt-2 tabular" data-testid="offer-financing-total">
              Total du financement : <strong className="text-brand-navy">{formatPrice(financingTotal)}</strong>
              {amount > 0 && Math.abs(financingGap) >= 1 && (
                <span className="text-brand-amber"> ({financingGap > 0 ? '+' : '−'}{formatPrice(Math.abs(financingGap))} par rapport au prix proposé)</span>
              )}
            </p>
          )}
        </fieldset>

        <fieldset className="min-w-0">
          <legend className="text-sm font-semibold text-brand-navy mb-1">Conditions de l&apos;offre</legend>
          <p className="text-sm text-gray-500 mb-3">Cochez ou ajoutez les conditions auxquelles votre offre est soumise.</p>
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
          <Field label="Date cible de signature de l'acte" required error={errors.target_date} hint="Indicative : elle sert à organiser financement, audit et rédaction de l'acte." htmlFor={`${idp}-date`}>
            {(p) => <TextInput type="date" value={form.target_date} onChange={set('target_date')} testId="offer-target-date" {...p} />}
          </Field>
          <Field label="Validité de l'offre (jours)" required error={errors.validity_days} hint="Entre 15 et 60 jours. Passé ce délai sans réponse, l'offre expire." htmlFor={`${idp}-validity`}>
            {(p) => <NumberInput value={form.validity_days} onChange={set('validity_days')} min={15} max={60} step={1} suffix="j" testId="offer-validity" {...p} />}
          </Field>
        </div>

        <Field label="Message au cédant" optional error={errors.message} htmlFor={`${idp}-message`}>
          {(p) => (
            <textarea
              {...p}
              value={form.message}
              onChange={(e) => set('message')(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="Votre projet pour l'entreprise, votre calendrier, ce que vous attendez du cédant."
              className="w-full rounded-xl border border-brand-line px-4 py-3 text-sm text-brand-navy focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
              data-testid="offer-message"
            />
          )}
        </Field>

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
            Préparer et signer mon offre
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
          companyTitle={company?.title}
          onSigned={async (data) => {
            setCreated(null);
            if (typeof onSigned === 'function') await onSigned({ ...created.offer, status: 'pending', ...data });
          }}
        />
      )}
    </>
  );
};

export default OfferForm;
