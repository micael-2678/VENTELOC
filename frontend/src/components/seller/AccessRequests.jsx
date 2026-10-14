import { useState } from 'react';
import { CheckCircle, X, Clock, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { axiosInstance } from '@/App';
import { BuyerCard } from '@/components/shared';
import { Button } from '@/components/ui/button';
import { apiErrorMessage } from '@/components/account/errors';
import { formatDateTimeFr, daysUntil } from '@/lib/mandate';
import { badgeClass } from './listingStatus';
import { accessStatus } from './api';
import ConfirmDialog from './ConfirmDialog';

// Demande de dossier (API.md §4) : carte repreneur pseudonymisée + message, acceptation en un geste, refus motivé.
export const AccessRequestCard = ({ request, companyId, onChanged, compact = false }) => {
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const st = accessStatus(request);
  const pending = request.status === 'pending';
  const createdAt = request.created_at || request.requested_at;
  const expiresIn = pending ? daysUntil(request.expires_at) : null;
  const buyer = request.buyer_card || request.buyer || {};
  const label = buyer.label || request.buyer_label || 'Repreneur';

  const accept = async () => {
    setBusy(true);
    try {
      await axiosInstance.put(`/dataroom/${companyId}/access/${request.id}/validate`);
      toast.success('Demande acceptée. Le repreneur vérifie son identité, signe l\'accord de confidentialité et déclare l\'origine de ses fonds ; l\'accès s\'ouvre ensuite automatiquement.', { duration: 8000 });
      onChanged?.();
    } catch (e) {
      toast.error(apiErrorMessage(e, 'La demande n\'a pas pu être acceptée.'));
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    try {
      await axiosInstance.put(`/dataroom/${companyId}/access/${request.id}/reject`, { reason: reason.trim() || undefined }, { params: reason.trim() ? { reason: reason.trim() } : undefined });
      toast.success('Demande refusée.');
      setReason('');
      onChanged?.();
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Le refus n\'a pas pu être enregistré.'));
      throw e;
    }
  };

  return (
    <BuyerCard buyer={buyer} message={request.message} title={label} compact={compact} className={pending ? 'border-brand-amber/60' : ''}>
      <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600 mb-3">
        <span className={badgeClass(st.tone)}>{st.label}</span>
        {createdAt && <span className="flex items-center gap-1"><Clock className="w-4 h-4" aria-hidden="true" />Reçue le {formatDateTimeFr(createdAt)}</span>}
        {expiresIn !== null && expiresIn >= 0 && <span>· sans réponse, expire dans {expiresIn} j</span>}
      </div>
      {pending ? (
        <div className="flex flex-col sm:flex-row gap-2">
          <Button type="button" onClick={accept} disabled={busy} className="rounded-xl bg-brand-green hover:bg-brand-green-dark text-white flex-1" data-testid={`accept-request-${request.id}`}>
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-2" />}
            Accepter
          </Button>
          <Button type="button" variant="outline" onClick={() => setRejecting(true)} disabled={busy} className="rounded-xl text-red-700 border-red-200 hover:bg-red-50 flex-1" data-testid={`reject-request-${request.id}`}>
            <X className="w-4 h-4 mr-2" />
            Refuser
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {request.status === 'granted' && <Link to={`/dataroom/${companyId}`} className="btn-link">Voir le dossier partagé</Link>}
          {['accepted', 'granted', 'validated', 'loi_pending'].includes(request.status) && (
            <Link to={`/messages?conversation=${encodeURIComponent(request.conversation_id || companyId)}`} className="btn-link">Écrire au repreneur</Link>
          )}
        </div>
      )}
      <ConfirmDialog
        open={rejecting}
        onClose={() => setRejecting(false)}
        title="Refuser cette demande de dossier"
        description="Le repreneur est prévenu par e-mail. Vous pouvez indiquer un motif (facultatif) : il lui sera transmis tel quel."
        confirmLabel="Refuser la demande"
        tone="danger"
        onConfirm={reject}
        testId="reject-dialog"
      >
        <label htmlFor={`reject-reason-${request.id}`} className="block text-sm font-semibold text-brand-navy">Motif (facultatif)</label>
        <textarea
          id={`reject-reason-${request.id}`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={500}
          className="w-full rounded-xl border border-brand-line px-4 py-3 text-base focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
          placeholder="Ex. : projet trop éloigné de mon activité, budget insuffisant…"
        />
      </ConfirmDialog>
    </BuyerCard>
  );
};

// Liste des demandes d'une annonce, demandes à traiter en premier
const AccessRequests = ({ requests, companyId, onChanged }) => {
  const list = Array.isArray(requests) ? requests : [];
  if (!list.length) {
    return (
      <p className="text-sm text-gray-600" data-testid="no-access-requests">
        Aucune demande de dossier pour l'instant. Les repreneurs intéressés vous présentent leur projet depuis l'annonce, puis demandent l'accès au dossier.
      </p>
    );
  }
  const order = { pending: 0, accepted: 1, validated: 1, loi_pending: 1, granted: 2, expired: 3, closed: 3, rejected: 4 };
  const sorted = [...list].sort((a, b) => (order[a.status] ?? 5) - (order[b.status] ?? 5) || new Date(b.created_at || b.requested_at || 0) - new Date(a.created_at || a.requested_at || 0));
  return (
    <div className="space-y-4">
      {sorted.map((r) => <AccessRequestCard key={r.id} request={r} companyId={companyId} onChanged={onChanged} compact />)}
    </div>
  );
};

export default AccessRequests;
