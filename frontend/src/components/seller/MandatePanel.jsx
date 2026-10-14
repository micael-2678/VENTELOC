import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Download, FileSignature, CalendarPlus, Ban, Users, ShieldCheck } from 'lucide-react';
import { axiosInstance } from '@/App';
import { Button } from '@/components/ui/button';
import {
  downloadMandatePdf, formatDateTimeFr, mandateStatusLabel, mandateStatusSentence, mandateDates, withdrawalOpen,
  MANDATE_DURATION_MONTHS, MANDATE_TAIL_MONTHS, MANDATE_NOTICE_DAYS, MANDATE_WITHDRAWAL_DAYS,
} from '@/lib/mandate';
import { apiErrorMessage } from '@/components/account/errors';
import OtpSignatureDialog from '@/components/OtpSignatureDialog';
import ConfirmDialog from './ConfirmDialog';
import { badgeClass } from './listingStatus';

const toneFor = (status) => ({ signed: 'success', denounced: 'warning', withdrawn_retractation: 'info', expired: 'danger', void: 'danger', pending_signature: 'warning' }[status] || 'info');

// Texte de la boîte « Résilier » : rétractation (effet immédiat) dans les 14 jours suivant la signature, sinon préavis
export const denounceText = (mandat, now = Date.now()) => {
  if (withdrawalOpen(mandat, now)) {
    return `Vous êtes dans le délai de rétractation de ${MANDATE_WITHDRAWAL_DAYS} jours (jusqu'au ${formatDateTimeFr(mandat.withdrawal_ends_at)}) : votre résiliation vaut rétractation. Elle prend effet immédiatement, votre annonce est retirée et aucune somme n'est due.`;
  }
  return `Préavis de ${MANDATE_NOTICE_DAYS} jours : la résiliation prend effet le ${formatDateTimeFr(new Date(now + MANDATE_NOTICE_DAYS * 86400000).toISOString())} et votre annonce est retirée à cette date. Aucune indemnité ni pénalité. La clause de suite de ${MANDATE_TAIL_MONTHS} mois continue de s'appliquer aux acquéreurs qui vous ont été nommément présentés. Vous pourrez signer un nouveau mandat plus tard.`;
};

// Acquéreurs nommément présentés (engagement de confidentialité signé) : liste nominative du mandat
export const PresentedBuyers = ({ buyers, compact = false }) => {
  const list = Array.isArray(buyers) ? buyers : [];
  if (!list.length) {
    return <p className="text-sm text-gray-600" data-testid="no-presented">Aucun acquéreur ne vous a encore été nommément présenté : la liste se remplit à chaque engagement de confidentialité signé.</p>;
  }
  return (
    <ul className={`divide-y divide-brand-line ${compact ? '' : 'card'}`} data-testid="presented-buyers">
      {list.map((b) => (
        <li key={b.buyer_id} className="flex flex-wrap items-center justify-between gap-2 px-1 py-2 text-sm min-w-0">
          <span className="min-w-0 break-words">
            <span className="font-semibold text-brand-navy">{b.name || b.label}</span>
            {b.company_name && <span className="text-gray-600"> · {b.company_name}</span>}
            {b.name && b.label && <span className="text-gray-500"> ({b.label})</span>}
          </span>
          <span className="text-gray-600 shrink-0">Engagement signé le {formatDateTimeFr(b.at)}</span>
        </li>
      ))}
    </ul>
  );
};

// Mandat de l'annonce : statut lisible, dates, registre, PDF, résiliation (préavis 15 j, ou rétractation dans les 14 jours
// suivant la signature), prolongation de 12 mois (code)
const MandatePanel = ({ property, mandat, presentedBuyers, onChanged }) => {
  const [denouncing, setDenouncing] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const d = mandateDates(mandat);
  const signed = mandat?.status === 'signed';
  const retractable = withdrawalOpen(mandat);
  const needsSignature = !mandat || ['expired', 'void', 'withdrawn_retractation'].includes(mandat.status) || property?.status === 'mandat_en_attente' || mandat.status === 'pending_signature';

  const denounce = async () => {
    try {
      const res = await axiosInstance.post(`/seller/mandat/${mandat.id}/denounce`, {});
      if (res.data?.status === 'withdrawn_retractation') {
        toast.success('Rétractation enregistrée : le mandat a pris fin immédiatement, votre annonce est retirée et aucune somme n\'est due.', { duration: 8000 });
      } else {
        toast.success(`Mandat résilié. Fin effective le ${formatDateTimeFr(res.data?.effective_at)} ; votre annonce sera retirée à cette date.`, { duration: 8000 });
      }
      onChanged?.();
    } catch (e) {
      toast.error(apiErrorMessage(e, 'La résiliation a échoué.'));
      throw e;
    }
  };

  const renew = async (otpCode) => {
    const res = await axiosInstance.post(`/seller/mandat/${mandat.id}/renew`, { otp_code: otpCode });
    setRenewing(false);
    toast.success(`Mandat prolongé jusqu'au ${formatDateTimeFr(res.data?.ends_at)}.`);
    onChanged?.();
  };

  const renewalText = mandat ? [
    `Prolongation du mandat n° ${mandat.registry_number || ''} (${mandat.contract_number || ''}) de ${MANDATE_DURATION_MONTHS} mois à compter de son échéance actuelle (${d.endsAt}).`,
    `Toutes les autres clauses restent inchangées : mandat simple sans exclusivité, résiliable à tout moment avec un préavis de ${MANDATE_NOTICE_DAYS} jours, honoraires à votre charge réglés par le notaire à l'acte authentique.`,
    `La clause de suite de ${MANDATE_TAIL_MONTHS} mois court à compter de la nouvelle échéance.`,
    'Cet accord exprès est signé électroniquement par code et joint au mandat avec son dossier de preuve.',
  ] : [];

  return (
    <div className="space-y-5" data-testid="mandate-panel">
      <div className="flex flex-wrap items-center gap-2">
        <span className={badgeClass(toneFor(mandat?.status))}>{mandateStatusLabel(mandat)}</span>
        {mandat?.registry_number && <span className="text-sm text-gray-600">Registre n° <strong className="tabular">{mandat.registry_number}</strong></span>}
        {retractable && <span className="badge badge-warning" data-testid="withdrawal-open">Rétractation possible jusqu'au {d.withdrawalEndsAt}</span>}
      </div>
      <p className="text-sm text-gray-800">{mandateStatusSentence(mandat)}</p>

      {mandat && (
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          {d.signedAt && <div className="rounded-xl bg-brand-surface p-3 min-w-0"><dt className="text-gray-500">Signé le</dt><dd className="font-semibold text-brand-navy">{d.signedAt}</dd></div>}
          {d.endsAt && <div className="rounded-xl bg-brand-surface p-3 min-w-0"><dt className="text-gray-500">Échéance</dt><dd className="font-semibold text-brand-navy">{d.endsAt}</dd></div>}
          {d.tailEndsAt && <div className="rounded-xl bg-brand-surface p-3 min-w-0"><dt className="text-gray-500">Clause de suite</dt><dd className="font-semibold text-brand-navy">{d.tailEndsAt}</dd></div>}
          {d.effectiveAt && ['denounced', 'withdrawn_retractation'].includes(mandat.status) && <div className="rounded-xl bg-brand-surface p-3 min-w-0"><dt className="text-gray-500">Fin effective</dt><dd className="font-semibold text-brand-navy">{d.effectiveAt}</dd></div>}
          {Array.isArray(mandat.renewals) && mandat.renewals.length > 0 && (
            <div className="rounded-xl bg-brand-surface p-3 min-w-0"><dt className="text-gray-500">Prolongations</dt><dd className="font-semibold text-brand-navy tabular">{mandat.renewals.length}</dd></div>
          )}
        </dl>
      )}

      <div className="flex flex-wrap gap-2">
        {needsSignature && (
          <Link to={`/seller/mandat/${property.id}`} className="btn-primary" data-testid={`sign-mandate-${property.id}`}>
            <FileSignature className="w-4 h-4" aria-hidden="true" />
            {mandat && ['expired', 'void', 'denounced', 'withdrawn_retractation'].includes(mandat.status) ? 'Signer un nouveau mandat' : 'Signer le mandat'}
          </Link>
        )}
        {mandat?.id && mandat.status !== 'pending_signature' && (
          <Button type="button" variant="outline" onClick={() => downloadMandatePdf(mandat.id)} className="rounded-xl" data-testid="mandate-pdf-btn">
            <Download className="w-4 h-4 mr-2" />
            PDF du mandat
          </Button>
        )}
        {signed && (
          <>
            <Button type="button" variant="outline" onClick={() => setRenewing(true)} className="rounded-xl" data-testid="renew-mandate">
              <CalendarPlus className="w-4 h-4 mr-2" />
              Prolonger de {MANDATE_DURATION_MONTHS} mois
            </Button>
            <Button type="button" variant="outline" onClick={() => setDenouncing(true)} className="rounded-xl text-red-700 border-red-200 hover:bg-red-50" data-testid="denounce-mandate">
              <Ban className="w-4 h-4 mr-2" />
              {retractable ? 'Me rétracter' : 'Résilier mon mandat'}
            </Button>
          </>
        )}
      </div>

      <div>
        <p className="flex items-center gap-2 text-sm font-semibold text-brand-navy mb-2"><Users className="w-4 h-4" aria-hidden="true" />Acquéreurs présentés</p>
        <PresentedBuyers buyers={presentedBuyers} compact />
        <p className="flex items-start gap-2 text-sm text-gray-600 mt-2">
          <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>Les honoraires ne sont dus que si la vente se conclut avec l'un d'eux, y compris dans les {MANDATE_TAIL_MONTHS} mois suivant la fin du mandat (clause de suite).</span>
        </p>
      </div>

      <ConfirmDialog
        open={denouncing}
        onClose={() => setDenouncing(false)}
        title={retractable ? 'Me rétracter' : 'Résilier mon mandat'}
        description={denounceText(mandat)}
        confirmLabel={retractable ? 'Confirmer la rétractation' : 'Confirmer la résiliation'}
        tone="danger"
        onConfirm={denounce}
        testId="denounce-dialog"
      />

      {mandat && (
        <OtpSignatureDialog
          open={renewing}
          onClose={() => setRenewing(false)}
          title="Prolonger mon mandat"
          subtitle={mandat.contract_number ? `Réf. ${mandat.contract_number}` : undefined}
          contractId={mandat.id}
          summary={renewalText}
          acceptLabel={`J'accepte expressément de prolonger mon mandat de ${MANDATE_DURATION_MONTHS} mois. Je comprends que cette signature électronique a valeur juridique.`}
          signLabel="Signer la prolongation"
          onSign={renew}
        />
      )}
    </div>
  );
};

export default MandatePanel;
