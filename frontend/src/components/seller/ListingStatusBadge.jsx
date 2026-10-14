import { AlertTriangle, Flag } from 'lucide-react';
import { listingStatusInfo, badgeClass, blockingReasons, moderationFlags, removalReason } from './listingStatus';

// Badge de statut lisible d'une annonce + motifs de blocage (publication impossible) + drapeaux de relecture
export const StatusBadge = ({ company, className = '' }) => {
  const info = listingStatusInfo(company);
  return <span className={`${badgeClass(info.tone)} shrink-0 whitespace-nowrap ${className}`} data-testid={`status-${company?.id || 'x'}`}>{info.label}</span>;
};

// Liste des motifs qui empêchent la publication, avec le libellé serveur (plus de « validation sous 48 h »)
export const BlockingReasons = ({ company, onAction, compact = false }) => {
  const reasons = blockingReasons(company);
  const removed = removalReason(company);
  if (!reasons.length && !removed) return null;
  return (
    <div className={`rounded-xl border border-red-200 bg-red-50 ${compact ? 'p-3' : 'p-4'} min-w-0`} data-testid="blocking-reasons">
      <p className="flex items-start gap-2 text-sm font-semibold text-red-800">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
        <span>{removed ? 'Annonce retirée par la modération' : 'Publication impossible pour le moment'}</span>
      </p>
      {removed && <p className="text-sm text-red-800 mt-1 break-words">Motif : {removed}. Corrigez votre annonce : elle sera soumise à nouveau automatiquement.</p>}
      {reasons.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm text-red-800 list-disc list-inside">
          {reasons.map((r) => (
            <li key={r.code} className="break-words">
              {r.label}
              {typeof onAction === 'function' && r.action !== 'contact' && (
                <>
                  {' · '}
                  <button type="button" onClick={() => onAction(r)} className="font-semibold underline underline-offset-2 hover:text-red-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 rounded">
                    {r.action === 'verify_identity' ? 'Vérifier mon identité' : r.action === 'confirm_email' ? 'Renvoyer le lien de confirmation' : 'Compléter'}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// Drapeaux de post-modération : l'annonce est en ligne, relue sous 48 h par la plateforme
export const ModerationFlags = ({ company }) => {
  const flags = moderationFlags(company);
  if (!flags.length || company?.moderation?.status === 'ok') return null;
  return (
    <p className="flex items-start gap-2 text-sm text-gray-600 min-w-0" data-testid="moderation-flags">
      <Flag className="w-4 h-4 mt-0.5 shrink-0 text-brand-amber" aria-hidden="true" />
      <span className="break-words">Points relus par la plateforme : {flags.map((f) => f.label).join(' ; ')}. Votre annonce reste en ligne.</span>
    </p>
  );
};
