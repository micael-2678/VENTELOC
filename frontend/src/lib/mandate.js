import { toast } from 'sonner';
import { axiosInstance } from '@/App';

// Mandat de vente simple (loi Hoguet, SPEC §3.2) : aucune annonce n'est publiée sans mandat signé.
// Barème v2 : la commission est toujours à la charge du cédant ; le choix du débiteur n'existe plus.
// Seules les anciennes annonces (mandat v1 avec `commission_payer == 'repreneur'`) gardent leur mention.

export const MANDATE_DURATION_MONTHS = 12;
export const MANDATE_TAIL_MONTHS = 18;
export const MANDATE_NOTICE_DAYS = 15;

// Statuts d'un mandat (contrat) → libellé lisible
export const MANDATE_STATUS_LABELS = {
  pending_signature: 'À signer',
  signed: 'En cours',
  denounced: 'Résilié (préavis en cours)',
  expired: 'Expiré',
  void: 'Caduc',
};

export const mandateStatusLabel = (mandat) => {
  if (!mandat || !mandat.status) return 'Aucun mandat';
  return MANDATE_STATUS_LABELS[mandat.status] || String(mandat.status);
};

// Héritage v1 : seul cas où l'acquéreur est désigné débiteur. `obj` : mandat (contrat) ou annonce.
export const legacyBuyerPays = (obj) => {
  if (!obj) return false;
  const payer = obj.commission_payer;
  const version = obj.terms_version || obj.commission_terms_version || obj.contract?.terms_version;
  return payer === 'repreneur' && (version === 'v1' || !version);
};

// Phrase à afficher pour l'héritage seulement ; '' pour tous les mandats v2 (cédant débiteur, rien à préciser)
export const legacyPayerText = (obj) => (legacyBuyerPays(obj) ? 'Mandat v1 : commission à la charge de l\'acquéreur' : '');

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
    daysToEnd: daysUntil(m.ends_at),
    daysToEffective: daysUntil(m.effective_at),
  };
};

// Phrase d'état du mandat pour l'espace vendeur (statut + date utile)
export const mandateStatusSentence = (mandat) => {
  if (!mandat || !mandat.status) return 'Aucun mandat signé pour cette annonce.';
  const d = mandateDates(mandat);
  switch (mandat.status) {
    case 'signed':
      return d.endsAt ? `Mandat simple en cours jusqu'au ${d.endsAt}${d.daysToEnd !== null && d.daysToEnd <= 30 ? ` (dans ${Math.max(0, d.daysToEnd)} j)` : ''}.` : 'Mandat simple en cours.';
    case 'denounced':
      return d.effectiveAt ? `Mandat résilié : fin effective le ${d.effectiveAt} (préavis de ${MANDATE_NOTICE_DAYS} jours).` : 'Mandat résilié, préavis en cours.';
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
