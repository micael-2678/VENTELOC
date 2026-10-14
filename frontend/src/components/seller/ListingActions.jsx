import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Pause, Play, Archive, Handshake, ExternalLink, Pencil, Eye, MoreHorizontal } from 'lucide-react';
import { axiosInstance } from '@/App';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { apiErrorMessage } from '@/components/account/errors';
import { MANDATE_TAIL_MONTHS, MANDATE_NOTICE_DAYS, MANDATE_WITHDRAWAL_DAYS, formatDateTimeFr, withdrawalOpen } from '@/lib/mandate';
import ConfirmDialog from './ConfirmDialog';
import { canPause, canResume, canWithdraw, canMarkSold } from './listingStatus';

// Actions sur une annonce (docs/venteloc/SPEC.md §5.2 point 5) : Mettre en pause / Reprendre / Retirer / Vendue via la
// plateforme / Vendue autrement (rappel de la clause de suite). Chaque action explique ses conséquences avant confirmation.
const ListingActions = ({ property, presentedBuyers, closings, mandat, onChanged }) => {
  const navigate = useNavigate();
  const [dialog, setDialog] = useState(null); // 'pause' | 'resume' | 'withdraw' | 'sold_platform' | 'sold_elsewhere'
  const [buyerId, setBuyerId] = useState('');
  const openClosing = (closings || []).find((c) => c.property_id === property.id && ['in_progress', 'declared'].includes(c.status));
  const buyers = Array.isArray(presentedBuyers) ? presentedBuyers : [];
  const close = () => setDialog(null);

  const setStatus = async (status, successMessage) => {
    try {
      await axiosInstance.put(`/properties/${property.id}/status`, null, { params: { status } });
      toast.success(successMessage);
      onChanged?.();
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Le changement de statut a échoué.'));
      throw e;
    }
  };

  const soldViaPlatform = async () => {
    if (openClosing) {
      navigate(`/vente/${openClosing.id}`);
      return;
    }
    if (!buyerId) {
      toast.error('Choisissez l\'acquéreur.');
      throw new Error('buyer');
    }
    try {
      const res = await axiosInstance.post('/closing/direct', { property_id: property.id, buyer_id: buyerId });
      toast.success('Étape de vente ouverte : renseignez le notaire, puis déclarez la vente dès l\'acte authentique signé.');
      onChanged?.();
      if (res.data?.id) navigate(`/vente/${res.data.id}`);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'L\'étape de vente n\'a pas pu être ouverte.'));
      throw e;
    }
  };

  const items = [];
  items.push({ key: 'edit', label: 'Modifier l\'annonce', icon: Pencil, onSelect: () => navigate(`/seller/edit/${property.id}`) });
  if (property.status === 'published') items.push({ key: 'view', label: 'Voir l\'annonce publique', icon: Eye, onSelect: () => navigate(`/annonce/${property.id}`) });
  if (canPause(property)) items.push({ key: 'pause', label: 'Mettre en pause', icon: Pause, onSelect: () => setDialog('pause') });
  if (canResume(property)) items.push({ key: 'resume', label: 'Reprendre la diffusion', icon: Play, onSelect: () => setDialog('resume') });
  if (canWithdraw(property)) items.push({ key: 'withdraw', label: 'Retirer l\'annonce', icon: Archive, onSelect: () => setDialog('withdraw') });
  if (canMarkSold(property) || openClosing) {
    items.push({ key: 'sold_platform', label: openClosing ? 'Étape de vente en cours' : 'Vendue via la plateforme', icon: Handshake, onSelect: () => (openClosing ? navigate(`/vente/${openClosing.id}`) : setDialog('sold_platform')) });
  }
  if (canMarkSold(property)) items.push({ key: 'sold_elsewhere', label: 'Vendue autrement', icon: ExternalLink, onSelect: () => setDialog('sold_elsewhere') });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" className="rounded-xl" data-testid={`actions-${property.id}`}>
            <MoreHorizontal className="w-4 h-4 mr-2" aria-hidden="true" />
            Actions
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="rounded-xl min-w-56">
          {items.map((it, i) => (
            <div key={it.key}>
              {(it.key === 'pause' || it.key === 'resume') && i > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem onSelect={it.onSelect} className="rounded-lg cursor-pointer text-sm" data-testid={`action-${it.key}-${property.id}`}>
                <it.icon className="w-4 h-4 mr-2 text-gray-500" aria-hidden="true" />
                {it.label}
              </DropdownMenuItem>
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={dialog === 'pause'}
        onClose={close}
        title="Mettre l'annonce en pause"
        description="L'annonce n'est plus visible des acquéreurs ni envoyée aux alertes, mais rien n'est perdu : vos conversations, demandes et offres restent accessibles, et votre mandat continue de courir. Vous pouvez reprendre la diffusion à tout moment."
        confirmLabel="Mettre en pause"
        onConfirm={() => setStatus('paused', 'Annonce mise en pause.')}
        testId="pause-dialog"
      />
      <ConfirmDialog
        open={dialog === 'resume'}
        onClose={close}
        title="Reprendre la diffusion"
        description="L'annonce redevient visible immédiatement et est envoyée aux acquéreurs dont les critères correspondent."
        confirmLabel="Reprendre"
        tone="green"
        onConfirm={() => setStatus('published', 'Annonce de nouveau en ligne.')}
        testId="resume-dialog"
      />
      <ConfirmDialog
        open={dialog === 'withdraw'}
        onClose={close}
        title="Retirer l'annonce"
        description={withdrawalOpen(mandat)
          ? `L'annonce est retirée de la diffusion. Votre mandat n'est pas résilié pour autant : vous êtes encore dans le délai de rétractation de ${MANDATE_WITHDRAWAL_DAYS} jours (onglet Mandat, « Me rétracter ») ; la rétractation met fin au mandat immédiatement, sans aucune somme due.`
          : `L'annonce est retirée de la diffusion. Votre mandat n'est pas résilié pour autant : pour y mettre fin, utilisez « Résilier mon mandat » (préavis de ${MANDATE_NOTICE_DAYS} jours). Les acquéreurs déjà présentés restent couverts par la clause de suite de ${MANDATE_TAIL_MONTHS} mois.`}
        confirmLabel="Retirer l'annonce"
        tone="danger"
        onConfirm={() => setStatus('withdrawn', 'Annonce retirée.')}
        testId="withdraw-dialog"
      />
      <ConfirmDialog
        open={dialog === 'sold_platform'}
        onClose={close}
        title="Vendue à un acquéreur présenté"
        description="Choisissez l'acquéreur : une étape de vente s'ouvre (notaire en charge de la vente, date du compromis, déclaration de l'acte authentique, confirmation par l'acquéreur, honoraires réglés par le notaire)."
        confirmLabel="Ouvrir l'étape de vente"
        tone="green"
        disabled={!buyers.length || !buyerId}
        onConfirm={soldViaPlatform}
        testId="sold-platform-dialog"
      >
        {buyers.length ? (
          <fieldset>
            <legend className="text-sm font-semibold text-brand-navy mb-2">Acquéreur</legend>
            <div className="space-y-2">
              {buyers.map((b) => (
                <label key={b.buyer_id} className={`flex items-center gap-3 rounded-xl border-2 px-3 py-2.5 cursor-pointer ${buyerId === b.buyer_id ? 'border-brand-teal bg-brand-teal-soft' : 'border-brand-line'}`}>
                  <input type="radio" name="sold-buyer" value={b.buyer_id} checked={buyerId === b.buyer_id} onChange={() => setBuyerId(b.buyer_id)} className="h-4 w-4 accent-brand-navy" />
                  <span className="text-sm min-w-0 break-words">
                    <span className="font-semibold text-brand-navy">{b.name || b.label}</span>
                    {b.company_name && <span className="text-gray-600"> · {b.company_name}</span>}
                    <span className="text-gray-600"> · engagement signé le {formatDateTimeFr(b.at)}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : (
          <p className="text-sm text-gray-700">Aucun acquéreur ne vous a été nommément présenté (engagement de confidentialité signé). Si la vente se fait avec un acquéreur venu autrement, choisissez « Vendue autrement ».</p>
        )}
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === 'sold_elsewhere'}
        onClose={close}
        title="Vendue autrement"
        description={`Votre annonce est retirée et le mandat prend fin. Rappel de la clause de suite : si la vente est conclue avec un acquéreur que nous vous avons nommément présenté, maintenant ou dans les ${MANDATE_TAIL_MONTHS} mois${mandat?.tail_ends_at ? ` (jusqu'au ${formatDateTimeFr(mandat.tail_ends_at)})` : ''}, les honoraires restent dus : déclarez-la alors via « Vendue via la plateforme ». Aucun honoraire n'est dû pour une vente à un acquéreur que vous avez trouvé vous-même.`}
        confirmLabel="Confirmer : vendue autrement"
        onConfirm={() => setStatus('sold_elsewhere', 'Annonce marquée vendue hors plateforme. Merci pour votre confiance.')}
        testId="sold-elsewhere-dialog"
      >
        {buyers.length > 0 && (
          <p className="text-sm text-gray-700">Acquéreurs présentés : {buyers.map((b) => b.name || b.label).join(', ')}.</p>
        )}
      </ConfirmDialog>
    </>
  );
};

export default ListingActions;
