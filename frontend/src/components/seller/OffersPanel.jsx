import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { CheckCircle, X, Reply, FileText, Clock } from 'lucide-react';
import { axiosInstance } from '@/App';
import { Button } from '@/components/ui/button';
import { formatEur } from '@/lib/format';
import { commissionLabel } from '@/lib/offer';
import { downloadOfferPdf } from '@/lib/offerPdf';
import { formatDateTimeFr, daysUntil } from '@/lib/mandate';
import { apiErrorMessage } from '@/components/account/errors';
import OtpSignatureDialog from '@/components/OtpSignatureDialog';
import { badgeClass } from './listingStatus';
import { offerStatus, SALE_OBJECT_LABELS } from './api';
import ConfirmDialog from './ConfirmDialog';
import { NumberInput } from './FormFields';

const FINANCING_LABELS = { equity: 'Apport', loan: 'Emprunt' };

export const financingText = (financing) => {
  const f = financing && typeof financing === 'object' ? financing : {};
  const parts = Object.keys(FINANCING_LABELS).filter((k) => Number(f[k]) > 0).map((k) => `${FINANCING_LABELS[k]} ${formatEur(f[k])}`);
  return parts.join(' · ');
};

// Condition suspensive d'obtention de prêt (art. L313-40 du Code de la consommation) : texte lisible ou ''
export const loanConditionText = (lc) => {
  if (!lc || typeof lc !== 'object' || !lc.required) return lc && lc.required === false ? 'Sans condition suspensive de prêt' : '';
  const parts = [];
  if (Number(lc.amount) > 0) parts.push(`prêt de ${formatEur(lc.amount)}`);
  if (Number(lc.max_rate) > 0) parts.push(`taux maximum ${String(lc.max_rate).replace('.', ',')} %`);
  if (Number(lc.duration_years) > 0) parts.push(`sur ${lc.duration_years} ans`);
  return `Sous condition suspensive d'obtention de prêt${parts.length ? ` (${parts.join(', ')})` : ''}`;
};

const conditionsList = (conditions) => {
  if (Array.isArray(conditions)) return conditions.filter(Boolean).map(String);
  if (typeof conditions === 'string' && conditions.trim()) return [conditions.trim()];
  return [];
};

// Offre d'achat reçue (API.md §5, SPEC §7.3) : acceptation contre-signée par code, refus motivé, contre-proposition.
// Une offre acceptée n'emporte pas vente : elle engage à négocier de bonne foi l'avant-contrat chez le notaire.
export const OfferCard = ({ offer, onChanged, closing }) => {
  const [accepting, setAccepting] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [countering, setCountering] = useState(false);
  const [reason, setReason] = useState('');
  const [counterAmount, setCounterAmount] = useState('');
  const [counterMessage, setCounterMessage] = useState('');
  const st = offerStatus(offer);
  const pending = offer.status === 'pending';
  const expiresIn = daysUntil(offer.expires_at);
  const conditions = conditionsList(offer.conditions);
  const financing = financingText(offer.financing);
  const loan = loanConditionText(offer.loan_condition);
  const objectLabel = offer.sale_object ? (SALE_OBJECT_LABELS[offer.sale_object] || offer.sale_object) : '';

  const respond = async (body) => {
    const res = await axiosInstance.put(`/offers/${offer.id}/respond`, body);
    onChanged?.();
    return res.data || {};
  };

  const acceptWithCode = async (otpCode) => {
    const data = await respond({ action: 'accept', otp_code: otpCode });
    setAccepting(false);
    toast.success('Offre acceptée et contresignée. L\'étape de vente est ouverte.', { duration: 8000 });
    return data;
  };

  const acceptLegacy = async () => {
    try {
      await respond({ action: 'accept' });
      toast.success('Offre acceptée. L\'étape de vente est ouverte.');
    } catch (e) {
      toast.error(apiErrorMessage(e, 'L\'acceptation a échoué.'));
      throw e;
    }
  };

  const reject = async () => {
    if (reason.trim().length < 3) {
      toast.error('Indiquez le motif du refus.');
      throw new Error('reason');
    }
    try {
      await respond({ action: 'reject', reason: reason.trim() });
      toast.success('Offre refusée. L\'acquéreur est prévenu avec votre motif.');
      setReason('');
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Le refus a échoué.'));
      throw e;
    }
  };

  const counter = async () => {
    const amount = Number(counterAmount);
    if (!(amount > 0)) {
      toast.error('Indiquez le montant de votre contre-proposition.');
      throw new Error('amount');
    }
    try {
      await respond({ action: 'counter', counter_amount: amount, message: counterMessage.trim() || undefined });
      toast.success('Contre-proposition envoyée. L\'acquéreur peut l\'accepter par code.');
      setCounterAmount('');
      setCounterMessage('');
    } catch (e) {
      toast.error(apiErrorMessage(e, 'La contre-proposition a échoué.'));
      throw e;
    }
  };

  const summary = [
    `Prix offert : ${formatEur(offer.amount)}${objectLabel ? ` — ${objectLabel.toLowerCase()}` : ''}.`,
    [financing ? `Financement : ${financing}.` : 'Financement : non détaillé.', loan ? `${loan}.` : ''].filter(Boolean).join(' '),
    conditions.length ? `Conditions : ${conditions.join(' ; ')}.` : 'Aucune autre condition particulière.',
    offer.target_date ? `Avant-contrat souhaité vers le ${formatDateTimeFr(offer.target_date)}, chez le notaire.` : 'Date de l\'avant-contrat à convenir chez le notaire.',
    `L'offre, même acceptée, n'emporte pas vente : elle vous engage à négocier de bonne foi l'avant-contrat chez le notaire. Honoraires de ${commissionLabel(offer.amount)} à votre charge, réglés par le notaire à l'acte authentique.`,
  ];

  return (
    <article className="card p-4 sm:p-5 min-w-0" data-testid={`offer-${offer.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <p className="text-2xl font-bold text-brand-navy tabular">{formatEur(offer.amount)}</p>
          <p className="text-sm text-gray-600 break-words">
            Offre d'achat de {offer.buyer_label || 'un acquéreur'}{objectLabel ? ` · ${objectLabel}` : ''}
          </p>
          {offer.status === 'countered' && offer.counter_amount && (
            <p className="text-sm text-gray-700 mt-1">Votre contre-proposition : <strong className="tabular">{formatEur(offer.counter_amount)}</strong>, en attente de l'acquéreur.</p>
          )}
          {offer.status === 'accepted' && offer.initial_amount && Number(offer.initial_amount) !== Number(offer.amount) && (
            <p className="text-sm text-gray-700 mt-1">Offre initiale : {formatEur(offer.initial_amount)}.</p>
          )}
        </div>
        <span className={badgeClass(st.tone)}>{st.label}</span>
      </div>

      <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm mb-3">
        {financing && <div className="min-w-0"><dt className="text-gray-600">Financement</dt><dd className="text-gray-800 break-words">{financing}</dd></div>}
        {loan && <div className="min-w-0"><dt className="text-gray-600">Prêt</dt><dd className="text-gray-800 break-words" data-testid={`offer-loan-${offer.id}`}>{loan}</dd></div>}
        {offer.target_date && <div><dt className="text-gray-600">Avant-contrat souhaité</dt><dd className="text-gray-800">{formatDateTimeFr(offer.target_date)}</dd></div>}
        {Number(offer.validity_days) > 0 && <div><dt className="text-gray-600">Validité</dt><dd className="text-gray-800">{offer.validity_days} jours</dd></div>}
        {conditions.length > 0 && (
          <div className="sm:col-span-2 min-w-0">
            <dt className="text-gray-600">Conditions</dt>
            <dd><ul className="list-disc list-inside text-gray-800 break-words">{conditions.map((c) => <li key={c}>{c}</li>)}</ul></dd>
          </div>
        )}
        {offer.message && <div className="sm:col-span-2 min-w-0"><dt className="text-gray-600">Message</dt><dd className="text-gray-800 whitespace-pre-line break-words">{offer.message}</dd></div>}
      </dl>

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500 mb-3">
        <span className="flex items-center gap-1"><Clock className="w-4 h-4" aria-hidden="true" />Reçue le {formatDateTimeFr(offer.signed_at || offer.created_at)}</span>
        {offer.expires_at && pending && <span>· valable jusqu'au {formatDateTimeFr(offer.expires_at)}{expiresIn !== null && expiresIn >= 0 ? ` (${expiresIn} j)` : ''}</span>}
      </p>

      <div className="flex flex-wrap gap-2">
        {pending && (
          <>
            <Button type="button" onClick={() => setAccepting(true)} className="rounded-xl bg-brand-teal hover:bg-brand-teal-dark text-white" data-testid={`accept-offer-${offer.id}`}>
              <CheckCircle className="w-4 h-4 mr-2" />
              Accepter
            </Button>
            <Button type="button" variant="outline" onClick={() => setCountering(true)} className="rounded-xl" data-testid={`counter-offer-${offer.id}`}>
              <Reply className="w-4 h-4 mr-2" />
              Contre-proposer
            </Button>
            <Button type="button" variant="outline" onClick={() => setRejecting(true)} className="rounded-xl text-red-700 border-red-200 hover:bg-red-50" data-testid={`reject-offer-${offer.id}`}>
              <X className="w-4 h-4 mr-2" />
              Refuser
            </Button>
          </>
        )}
        {(offer.contract_id || offer.status === 'accepted') && (
          <button type="button" onClick={() => downloadOfferPdf(offer.id)} className="btn-link text-sm" data-testid={`offer-pdf-${offer.id}`}>
            <FileText className="w-4 h-4" aria-hidden="true" />
            PDF de l'offre
          </button>
        )}
        {(offer.closing_id || closing) && (
          <Link to={`/vente/${offer.closing_id || closing.id}`} className="btn-link text-sm">Étape de vente</Link>
        )}
      </div>

      {offer.contract_id ? (
        <OtpSignatureDialog
          open={accepting}
          onClose={() => setAccepting(false)}
          title="Accepter l'offre d'achat"
          subtitle={`${formatEur(offer.amount)} · ${offer.buyer_label || 'acquéreur'}`}
          contractId={offer.contract_id}
          summary={summary}
          acceptLabel="J'accepte cette offre d'achat et je la contresigne. Je comprends que cette signature électronique a valeur juridique et que l'offre n'emporte pas vente."
          signLabel="Contresigner et accepter"
          onSign={acceptWithCode}
        />
      ) : (
        <ConfirmDialog
          open={accepting}
          onClose={() => setAccepting(false)}
          title="Accepter l'offre"
          description={summary.join(' ')}
          confirmLabel="Accepter l'offre"
          tone="green"
          onConfirm={acceptLegacy}
        />
      )}

      <ConfirmDialog
        open={rejecting}
        onClose={() => setRejecting(false)}
        title="Refuser l'offre"
        description="Le motif est obligatoire : il est transmis à l'acquéreur avec votre refus."
        confirmLabel="Refuser l'offre"
        tone="danger"
        onConfirm={reject}
        disabled={reason.trim().length < 3}
        testId="reject-offer-dialog"
      >
        <label htmlFor={`offer-reject-${offer.id}`} className="block text-sm font-semibold text-brand-navy">Motif du refus *</label>
        <textarea
          id={`offer-reject-${offer.id}`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={2000}
          className="w-full rounded-xl border border-brand-line px-4 py-3 text-base focus:border-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30"
          placeholder="Ex. : prix trop éloigné de mes attentes, condition de prêt trop incertaine…"
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={countering}
        onClose={() => setCountering(false)}
        title="Faire une contre-proposition"
        description="Vous proposez un autre prix, les autres conditions de l'offre restant inchangées. L'acquéreur l'accepte par code ou la décline ; votre contre-proposition est horodatée depuis votre espace."
        confirmLabel="Envoyer la contre-proposition"
        onConfirm={counter}
        disabled={!(Number(counterAmount) > 0)}
        testId="counter-offer-dialog"
      >
        <label htmlFor={`offer-counter-${offer.id}`} className="block text-sm font-semibold text-brand-navy">Prix proposé *</label>
        <NumberInput value={counterAmount} onChange={setCounterAmount} min={1} id={`offer-counter-${offer.id}`} />
        <label htmlFor={`offer-counter-msg-${offer.id}`} className="block text-sm font-semibold text-brand-navy">Message à l'acquéreur (facultatif)</label>
        <textarea
          id={`offer-counter-msg-${offer.id}`}
          value={counterMessage}
          onChange={(e) => setCounterMessage(e.target.value)}
          rows={3}
          maxLength={2000}
          className="w-full rounded-xl border border-brand-line px-4 py-3 text-base focus:border-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30"
        />
      </ConfirmDialog>
    </article>
  );
};

const OffersPanel = ({ offers, closings, onChanged }) => {
  const list = Array.isArray(offers) ? offers : [];
  if (!list.length) {
    return <p className="text-sm text-gray-600" data-testid="no-offers">Aucune offre reçue pour l'instant. Une offre d'achat ne peut être faite qu'après l'accès au dossier du bien (identité vérifiée, engagement de confidentialité, origine des fonds).</p>;
  }
  const order = { pending: 0, countered: 1, pending_signature: 2, accepted: 3, expired: 4, rejected: 5 };
  const sorted = [...list].sort((a, b) => (order[a.status] ?? 6) - (order[b.status] ?? 6) || new Date(b.created_at || 0) - new Date(a.created_at || 0));
  return (
    <div className="space-y-4">
      {sorted.map((o) => (
        <OfferCard key={o.id} offer={o} onChanged={onChanged} closing={(closings || []).find((c) => c.offer_id === o.id || c.id === o.closing_id)} />
      ))}
    </div>
  );
};

export default OffersPanel;
