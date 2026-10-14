import { useId, useState } from 'react';
import { AlertCircle, Loader2, ShieldCheck } from 'lucide-react';
import { axiosInstance } from '@/App';
import { Field, NumberInput, TextInput, SelectInput } from '@/components/seller/FormFields';
import { apiErrorMessage, isEmailNotVerifiedError } from '@/components/account/errors';
import { FUNDS_SOURCES } from './api';

// Déclaration d'origine des fonds (SPEC §5.3, API.md §4 ; LCB-FT : l'agent immobilier est assujetti) :
// POST /dataroom/{id}/funds-declaration {source, amount, financing_partner?} → {access_granted:true}.
// Dernière étape avant l'accès au dossier du bien.

const num = (v) => {
  const n = Number(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

const FundsDeclarationForm = ({ propertyId, defaultAmount = '', onDone }) => {
  const idp = useId();
  const [source, setSource] = useState('');
  const [amount, setAmount] = useState(defaultAmount ? String(defaultAmount) : '');
  const [partner, setPartner] = useState('');
  const [attest, setAttest] = useState(false);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!source) errs.source = 'Indiquez l\'origine principale des fonds.';
    if (!(num(amount) > 0)) errs.amount = 'Indiquez le montant que vous pouvez mobiliser.';
    if (!attest) errs.attest = 'Cette attestation est nécessaire pour ouvrir le dossier.';
    setErrors(errs);
    if (Object.keys(errs).length || submitting) return;
    setSubmitting(true);
    setServerError('');
    try {
      const res = await axiosInstance.post(`/dataroom/${propertyId}/funds-declaration`, {
        source,
        amount: num(amount),
        financing_partner: partner.trim() || null,
      });
      if (typeof onDone === 'function') await onDone(res.data || {});
    } catch (error) {
      if (isEmailNotVerifiedError(error)) setServerError('Confirmez d\'abord votre adresse e-mail (bandeau en haut de page).');
      else setServerError(apiErrorMessage(error, 'La déclaration n\'a pas pu être enregistrée. Réessayez dans quelques instants.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4 min-w-0" data-testid="funds-form">
      <p className="text-sm text-gray-700 leading-relaxed">
        Avant d&apos;ouvrir le dossier du bien, le vendeur doit savoir avec quels moyens vous envisagez l&apos;achat.
        Cette déclaration lui est transmise avec votre identité vérifiée ; elle n&apos;engage pas le montant de votre offre d&apos;achat.
      </p>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Origine principale des fonds" required error={errors.source} htmlFor={`${idp}-source`}>
          {(p) => <SelectInput value={source} onChange={setSource} options={FUNDS_SOURCES} placeholder="Choisir" testId="funds-source" {...p} />}
        </Field>
        <Field label="Montant mobilisable" required error={errors.amount} hint="Apport et financements réunis, en euros." htmlFor={`${idp}-amount`}>
          {(p) => <NumberInput value={amount} onChange={setAmount} min={1} step={1000} testId="funds-amount" {...p} />}
        </Field>
      </div>
      <Field label="Partenaire financier" optional hint="Banque, courtier, associés de la SCI ou société qui achète." htmlFor={`${idp}-partner`}>
        {(p) => <TextInput value={partner} onChange={setPartner} maxLength={200} placeholder="Nom de l'établissement ou de la société" testId="funds-partner" {...p} />}
      </Field>
      <div className="flex items-start gap-3">
        <input id={`${idp}-attest`} type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-navy focus:ring-brand-blue" data-testid="funds-attest" />
        <label htmlFor={`${idp}-attest`} className="text-sm text-gray-800 leading-snug">
          J&apos;atteste que ces fonds ont une origine licite et que je peux en justifier à la demande de la plateforme ou du notaire (obligations de lutte contre le blanchiment des capitaux).
        </label>
      </div>
      {errors.attest && <p role="alert" className="text-sm text-red-700">{errors.attest}</p>}
      {serverError && (
        <p role="alert" className="flex items-start gap-2 text-sm text-red-800 bg-red-50 border border-red-200 rounded-xl px-4 py-3" data-testid="funds-error">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{serverError}</span>
        </p>
      )}
      <button type="submit" className="btn-primary px-5 py-3 text-sm" disabled={submitting} data-testid="funds-submit">
        {submitting ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <ShieldCheck className="w-4 h-4" aria-hidden="true" />}
        Déclarer et ouvrir le dossier
      </button>
    </form>
  );
};

export default FundsDeclarationForm;
