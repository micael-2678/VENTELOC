import { toast } from 'sonner';
import { axiosInstance } from '@/App';

// Mandat de vente simple (loi Hoguet, docs/venteloc/SPEC.md §0.3 et §7.2) : aucune annonce n'est publiée sans mandat
// signé. 12 mois renouvelables, résiliable à tout moment avec un préavis de 15 jours ; droit de rétractation de 14 jours
// pour un mandant consommateur (une dénonciation dans ce délai est une rétractation, effective immédiatement) ; clause
// de suite de 12 mois après la fin du mandat. Honoraires toujours à la charge du vendeur.

export const MANDATE_DURATION_MONTHS = 12;
export const MANDATE_TAIL_MONTHS = 12;
export const MANDATE_NOTICE_DAYS = 15;
export const MANDATE_WITHDRAWAL_DAYS = 14;

// Statuts d'un mandat (contrat) → libellé lisible
export const MANDATE_STATUS_LABELS = {
  pending_signature: 'À signer',
  signed: 'En cours',
  denounced: 'Résilié (préavis en cours)',
  withdrawn_retractation: 'Rétractation',
  expired: 'Expiré',
  void: 'Caduc',
};

export const mandateStatusLabel = (mandat) => {
  if (!mandat || !mandat.status) return 'Aucun mandat';
  return MANDATE_STATUS_LABELS[mandat.status] || String(mandat.status);
};

// Barème unique, toujours à la charge du vendeur : plus de mandat « acquéreur débiteur ». Conservés pour les écrans
// qui les appellent encore (aucune mention à afficher).
export const legacyBuyerPays = () => false;
export const legacyPayerText = () => '';

// « 12/10/2026 »
export const formatDateTimeFr = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

// « 12 octobre 2026 »
export const formatLongDateFr = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
};

// « 12/10/2026 à 14:05 »
export const formatDateTimeMinutesFr = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
};

// Nombre de jours (entier, peut être négatif) entre aujourd'hui et une date ISO ; null si la date est absente
export const daysUntil = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
};

// Dates clés d'un mandat, prêtes à l'affichage
export const mandateDates = (mandat) => {
  const m = mandat || {};
  return {
    signedAt: formatDateTimeFr(m.signed_at),
    endsAt: formatDateTimeFr(m.ends_at),
    tailEndsAt: formatDateTimeFr(m.tail_ends_at),
    effectiveAt: formatDateTimeFr(m.effective_at),
    withdrawalEndsAt: formatDateTimeFr(m.withdrawal_ends_at),
    daysToEnd: daysUntil(m.ends_at),
    daysToEffective: daysUntil(m.effective_at),
  };
};

// Délai de rétractation encore ouvert (14 jours après la signature) : une résiliation vaut alors rétractation
export const withdrawalOpen = (mandat, now = Date.now()) => {
  if (!mandat || mandat.status !== 'signed' || !mandat.withdrawal_ends_at) return false;
  const d = new Date(mandat.withdrawal_ends_at);
  return !Number.isNaN(d.getTime()) && d.getTime() > now;
};

// Phrase d'état du mandat pour l'espace vendeur (statut + date utile)
export const mandateStatusSentence = (mandat) => {
  if (!mandat || !mandat.status) return 'Aucun mandat signé pour cette annonce.';
  const d = mandateDates(mandat);
  switch (mandat.status) {
    case 'signed':
      return d.endsAt ? `Mandat simple en cours jusqu'au ${d.endsAt}${d.daysToEnd !== null && d.daysToEnd <= 30 ? ` (dans ${Math.max(0, d.daysToEnd)} j)` : ''}.${withdrawalOpen(mandat) && d.withdrawalEndsAt ? ` Délai de rétractation ouvert jusqu'au ${d.withdrawalEndsAt}.` : ''}` : 'Mandat simple en cours.';
    case 'denounced':
      return d.effectiveAt ? `Mandat résilié : fin effective le ${d.effectiveAt} (préavis de ${MANDATE_NOTICE_DAYS} jours).` : 'Mandat résilié, préavis en cours.';
    case 'withdrawn_retractation':
      return `Vous vous êtes rétracté${d.effectiveAt ? ` le ${d.effectiveAt}` : ''} : le mandat a pris fin immédiatement, l'annonce n'est plus en ligne et aucune somme n'est due.`;
    case 'expired':
      return d.endsAt ? `Mandat expiré le ${d.endsAt}. Signez un nouveau mandat pour remettre l'annonce en ligne.` : 'Mandat expiré.';
    case 'void':
      return 'Mandat caduc (annonce retirée). Vous pouvez corriger votre annonce et signer un nouveau mandat.';
    case 'pending_signature':
      return 'Mandat préparé, en attente de votre signature.';
    default:
      return mandateStatusLabel(mandat);
  }
};

// Les chemins `pdf_url` de l'API commencent par /api ; l'instance axios a déjà /api en base
export const apiRelativePath = (url) => String(url || '').replace(/^https?:\/\/[^/]+/, '').replace(/^\/api(?=\/)/, '');

const triggerDownload = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const base64ToBlob = (content, type = 'application/pdf') => {
  const binary = atob(content);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
};

// Télécharge le mandat signé : GET /seller/mandat/{id}/pdf → { filename, content (base64) }
export const downloadMandatePdf = async (contractId) => {
  try {
    const res = await axiosInstance.get(`/seller/mandat/${contractId}/pdf`);
    const { filename, content } = res.data || {};
    if (!content) {
      toast.error('PDF du mandat indisponible pour le moment');
      return;
    }
    triggerDownload(base64ToBlob(content), filename || `mandat_${contractId}.pdf`);
  } catch (error) {
    toast.error(error.response?.data?.detail || 'Erreur lors du téléchargement du mandat');
  }
};

// Télécharge un PDF servi en binaire avec le jeton Bearer (documents signés, factures, ordre de paiement) ;
// tolère aussi une réponse JSON { filename, content } (anciens formats).
export const downloadPdf = async (pdfUrl, filename = 'document.pdf') => {
  try {
    const res = await axiosInstance.get(apiRelativePath(pdfUrl), { responseType: 'blob' });
    const blob = res.data;
    if (blob && blob.type && blob.type.includes('json')) {
      const text = JSON.parse(await blob.text());
      if (!text.content) throw new Error('PDF indisponible');
      triggerDownload(base64ToBlob(text.content), text.filename || filename);
      return;
    }
    triggerDownload(blob, filename);
  } catch (error) {
    toast.error('Le document n\'a pas pu être téléchargé. Réessayez dans quelques instants.');
  }
};
