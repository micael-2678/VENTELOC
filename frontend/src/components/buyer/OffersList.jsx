import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Clock, FileText, Handshake, PenTool } from 'lucide-react';
import { axiosInstance } from '@/App';
import OtpSignatureDialog from '@/components/OtpSignatureDialog';
import { formatPrice, formatDateFr } from '@/components/shared/formatters';
import { downloadOfferPdf } from '@/lib/offerPdf';
import { daysUntil } from '@/lib/mandate';
import { offerStatus, badgeClass, SALE_OBJECT_LABELS, FINANCING_LABELS } from './api';
import { OfferSignatureDialog } from './OfferForm';

// Suivi des offres indicatives du repreneur (API.md §5) : statut, signature d'une offre encore « à signer »,
// acceptation d'une contre-proposition par code, PDF signé, lien vers l'étape de vente.

const financingText = (financing) => {
  const f = financing && typeof financing === 'object' ? financing : {};
  return Object.keys(FINANCING_LABELS).filter((k) => Number(f[k]) > 0).map((k) => `${FINANCING_LABELS[k]} ${formatPrice(f[k])}`).join(' · ');
};

const counterText = (offer, propertyTitle) => [
  'ACCEPTATION DE LA CONTRE-PROPOSITION DU CÉDANT',
  propertyTitle ? `Entreprise : ${propertyTitle}` : '',
  `Offre initiale : ${formatPrice(offer.initial_amount || offer.amount)}`,
  `Contre-proposition du cédant : ${formatPrice(offer.counter_amount)}`,
  offer.counter_message ? `Message du cédant :\n${offer.counter_message}` : '',
  '',
  `En signant, vous acceptez le prix de ${formatPrice(offer.counter_amount)} en lieu et place de ${formatPrice(offer.initial_amount || offer.amount)}, les autres conditions de votre offre demeurant inchangées. L'offre devient acceptée et l'étape de vente s'ouvre.`,
].filter((l) => l !== '').join('\n');

export const OfferRow = ({ offer, onChanged }) => {
  const [signing, setSigning] = useState(false);
  const [acceptingCounter, setAcceptingCounter] = useState(false);
  const st = offerStatus(offer);
  const title = offer.property?.title || offer.property_title || 'Annonce';
  const expiresIn = daysUntil(offer.expires_at);
  const conditions = Array.isArray(offer.conditions) ? offer.conditions.filter(Boolean) : [];
  const financing = financingText(offer.financing);
  const canSign = offer.status === 'pending_signature' && offer.contract_id;
  const canAcceptCounter = offer.status === 'countered' && offer.counter_amount && offer.contract_id;
  const hasPdf = offer.status !== 'pending_signature' && (offer.contract_id || offer.status === 'accepted');

  const acceptCounter = async (otpCode) => {
    const res = await axiosInstance.put(`/offers/${offer.id}/accept-counter`, { otp_code: otpCode });
    setAcceptingCounter(false);
    toast.success('Contre-proposition acceptée et signée. L\'étape de vente est ouverte.', { duration: 8000 });
    if (typeof onChanged === 'function') await onChanged(res.data || {});
  };

  return (
    <li className="card p-4 sm:p-5 min-w-0" data-testid={`offer-${offer.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2 min-w-0">
        <div className="min-w-0">
          <p className="font-display font-bold text-brand-navy leading-snug break-words">
            <Link to={`/property/${offer.property_id}`} className="hover:underline underline-offset-2">{title}</Link>
          </p>
          <p className="text-sm text-gray-600 mt-0.5">
            {SALE_OBJECT_LABELS[offer.sale_object] || ''}{offer.created_at ? ` · déposée le ${formatDateFr(offer.created_at)}` : ''}
          </p>
        </div>
        <span className={`${badgeClass(st.tone)} shrink-0`}>{st.label}</span>
      </div>

      <dl className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-2 text-sm">
        <div className="min-w-0">
          <dt className="text-xs text-gray-500">Prix proposé</dt>
          <dd className="font-semibold text-brand-navy tabular">{formatPrice(offer.amount)}</dd>
        </div>
        {offer.counter_amount != null && (
          <div className="min-w-0">
            <dt className="text-xs text-gray-500">Contre-proposition du cédant</dt>
            <dd className="font-semibold text-brand-navy tabular">{formatPrice(offer.counter_amount)}</dd>
          </div>
        )}
        {offer.target_date && (
          <div className="min-w-0">
            <dt className="text-xs text-gray-500">Signature visée</dt>
            <dd className="text-gray-800">{formatDateFr(offer.target_date)}</dd>
          </div>
        )}
        {financing && (
          <div className="min-w-0 sm:col-span-3">
            <dt className="text-xs text-gray-500">Financement</dt>
            <dd className="text-gray-800 break-words">{financing}</dd>
          </div>
        )}
        {conditions.length > 0 && (
          <div className="min-w-0 sm:col-span-3">
            <dt className="text-xs text-gray-500">Conditions</dt>
            <dd className="text-gray-800"><ul className="list-disc list-inside">{conditions.map((c) => <li key={c} className="break-words">{c}</li>)}</ul></dd>
          </div>
        )}
      </dl>

      {offer.status === 'rejected' && offer.rejection_reason && (
        <p className="mt-3 text-sm text-gray-700 rounded-xl bg-brand-surface border border-brand-line px-3 py-2 break-words">Motif du cédant : {offer.rejection_reason}</p>
      )}
      {offer.status === 'countered' && offer.counter_message && (
        <p className="mt-3 text-sm text-gray-700 rounded-xl bg-brand-surface border border-brand-line px-3 py-2 break-words whitespace-pre-line">Message du cédant : {offer.counter_message}</p>
      )}
      {(offer.status === 'pending' || offer.status === 'countered') && expiresIn !== null && (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-gray-600">
          <Clock className="w-4 h-4 shrink-0" aria-hidden="true" />
          {expiresIn > 0 ? `Expire dans ${expiresIn} jour${expiresIn > 1 ? 's' : ''}` : 'Validité dépassée'}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {canSign && (
          <button type="button" onClick={() => setSigning(true)} className="btn-primary px-4 py-2 text-sm" data-testid="offer-sign-btn">
            <PenTool className="w-4 h-4" aria-hidden="true" />
            Signer mon offre
          </button>
        )}
        {canAcceptCounter && (
          <button type="button" onClick={() => setAcceptingCounter(true)} className="btn-primary px-4 py-2 text-sm" data-testid="offer-accept-counter-btn">
            <Handshake className="w-4 h-4" aria-hidden="true" />
            Accepter la contre-proposition
          </button>
        )}
        {offer.status === 'countered' && (
          <Link to={`/messages?conversation=${encodeURIComponent(offer.conversation_id || offer.property_id)}`} className="btn-secondary px-4 py-2 text-sm">
            Répondre au cédant
          </Link>
        )}
        {hasPdf && (
          <button type="button" onClick={() => downloadOfferPdf(offer.id)} className="btn-secondary px-4 py-2 text-sm" data-testid="offer-pdf-btn">
            <FileText className="w-4 h-4" aria-hidden="true" />
            PDF signé
          </button>
        )}
        {offer.closing_id && (
          <Link to={`/vente/${offer.closing_id}`} className="btn-link text-sm px-2" data-testid="offer-closing-link">Suivre la vente</Link>
        )}
      </div>

      {canSign && (
        <OfferSignatureDialog
          open={signing}
          onClose={() => setSigning(false)}
          offer={offer}
          contractId={offer.contract_id}
          propertyTitle={title}
          onSigned={async (data) => { setSigning(false); if (typeof onChanged === 'function') await onChanged(data); }}
        />
      )}
      {canAcceptCounter && (
        <OtpSignatureDialog
          open={acceptingCounter}
          onClose={() => setAcceptingCounter(false)}
          title="Accepter la contre-proposition"
          subtitle={title}
          contractId={offer.contract_id}
          documentText={counterText(offer, title)}
          acceptLabel={`J'accepte le prix de ${formatPrice(offer.counter_amount)} proposé par le cédant. Je comprends que cette signature électronique a valeur juridique.`}
          signLabel="Accepter et signer"
          onSign={acceptCounter}
        />
      )}
    </li>
  );
};

const OffersList = ({ offers, onChanged, emptyText = 'Aucune offre pour le moment. Vous pourrez en déposer une depuis le dossier d\'une entreprise, une fois l\'accès accordé.' }) => {
  const list = Array.isArray(offers) ? offers : [];
  if (!list.length) return <p className="text-sm text-gray-600" data-testid="offers-empty">{emptyText}</p>;
  return (
    <ul className="space-y-3" data-testid="offers-list">
      {list.map((o) => <OfferRow key={o.id} offer={o} onChanged={onChanged} />)}
    </ul>
  );
};

export default OffersList;
