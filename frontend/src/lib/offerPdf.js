import { toast } from 'sonner';
import { downloadPdf } from '@/lib/mandate';

// PDF d'une offre indicative (API.md §5) : GET /offers/{id}/pdf. Le serveur renvoie aujourd'hui
// { filename, content (base64) } ; une réponse binaire (application/pdf) est tolérée par downloadPdf.
// Disponible dès la signature du repreneur (texte signé, contre-proposition éventuelle, page de preuve).
export const downloadOfferPdf = async (offerId) => {
  if (!offerId) {
    toast.error('PDF indisponible');
    return;
  }
  await downloadPdf(`/offers/${offerId}/pdf`, `offre_${offerId}.pdf`);
};
