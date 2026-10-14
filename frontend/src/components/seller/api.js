// Accès API de l'espace vendeur (API.md §2, §3, §4, §5, §6, §7). Les réponses sont lues de façon tolérante :
// un tableau nu (contrat API.md) ou l'enveloppe historique ({requests}, {offers}, {closings}).
import { axiosInstance } from '@/App';

export const asList = (data, key) => {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data[key])) return data[key];
  return [];
};

const settled = (p) => p.then((r) => r.data).catch(() => null);

export const fetchSellerCompanies = () => settled(axiosInstance.get('/companies')).then((d) => asList(d, 'companies'));
export const fetchMandateStatus = (companyId) => settled(axiosInstance.get(`/seller/mandat/status/${companyId}`));
export const fetchAccessRequests = (companyId) => settled(axiosInstance.get(`/dataroom/${companyId}/access-requests`)).then((d) => asList(d, 'requests'));
export const fetchOffers = (companyId) => settled(axiosInstance.get(`/offers/company/${companyId}`)).then((d) => asList(d, 'offers'));
export const fetchStats = (companyId) => settled(axiosInstance.get(`/companies/${companyId}/stats`));
export const fetchClosings = () => settled(axiosInstance.get('/closing/my')).then((d) => asList(d, 'closings'));
export const fetchKyc = () => settled(axiosInstance.get('/kyc/status'));
export const fetchDocuments = (companyId) => settled(axiosInstance.get(`/dataroom/${companyId}/documents`)).then((d) => asList(d, 'documents'));
export const fetchAccessLog = (companyId) => settled(axiosInstance.get(`/dataroom/${companyId}/access-log`)).then((d) => asList(d, 'logs'));
export const fetchPhotos = (companyId) => settled(axiosInstance.get(`/companies/${companyId}/photos`)).then((d) => asList(d, 'photos'));

// Conversations (API.md §3) : tableau [{id, company_id, unread_count, …}] ; forme historique tolérée ({company_id: [messages]})
export const normalizeConversations = (data, userId) => {
  if (Array.isArray(data)) {
    return data.map((c) => ({ ...c, unread_count: Number(c.unread_count) || 0, legacy: false }));
  }
  if (data && typeof data === 'object') {
    return Object.keys(data).map((companyId) => {
      const msgs = Array.isArray(data[companyId]) ? data[companyId] : [];
      const sorted = [...msgs].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      const last = sorted[sorted.length - 1] || {};
      const other = sorted.find((m) => m.sender_id && m.sender_id !== userId && m.sender_id !== 'system');
      return {
        id: companyId,
        company_id: companyId,
        company_title: '',
        buyer_id: other?.sender_id || null,
        other_party_label: other?.sender_label || 'Repreneur',
        last_message: last.content || '',
        last_at: last.created_at || null,
        unread_count: sorted.filter((m) => m.receiver_id === userId && !m.read).length,
        messages: sorted,
        legacy: true,
        receiver_id: other?.sender_id || null,
      };
    }).sort((a, b) => new Date(b.last_at || 0) - new Date(a.last_at || 0));
  }
  return [];
};
export const fetchConversations = (userId) => settled(axiosInstance.get('/messages/conversations')).then((d) => normalizeConversations(d, userId));

// Statuts d'une demande de dossier (API.md §4) ; `validated` / `loi_pending` = acceptée (vague 1)
export const ACCESS_STATUS = {
  pending: { label: 'À traiter', tone: 'warning' },
  accepted: { label: 'Acceptée : identité, accord de confidentialité et origine des fonds en cours', tone: 'info' },
  validated: { label: 'Acceptée : identité, accord de confidentialité et origine des fonds en cours', tone: 'info' },
  loi_pending: { label: 'Acceptée : identité, accord de confidentialité et origine des fonds en cours', tone: 'info' },
  granted: { label: 'Accès au dossier accordé', tone: 'success' },
  rejected: { label: 'Refusée', tone: 'danger' },
  expired: { label: 'Expirée (sans réponse sous 10 jours)', tone: 'info' },
  // Annonce retirée, vendue ou mise hors ligne : demande close sans e-mail (le repreneur en est informé par message)
  closed: { label: 'Close (annonce plus en ligne)', tone: 'info' },
};
export const accessStatus = (req) => ACCESS_STATUS[req?.status] || { label: String(req?.status || ''), tone: 'info' };

export const OFFER_STATUS = {
  pending_signature: { label: 'En attente de la signature du repreneur', tone: 'info' },
  pending: { label: 'À traiter', tone: 'warning' },
  accepted: { label: 'Acceptée', tone: 'success' },
  rejected: { label: 'Refusée', tone: 'danger' },
  countered: { label: 'Contre-proposition envoyée', tone: 'info' },
  expired: { label: 'Expirée', tone: 'info' },
};
export const offerStatus = (offer) => OFFER_STATUS[offer?.status] || { label: String(offer?.status || ''), tone: 'info' };

export const CLOSING_STATUS = {
  in_progress: { label: 'Vente en cours', tone: 'info' },
  declared: { label: 'Vente déclarée, à confirmer', tone: 'warning' },
  confirmed: { label: 'Vente confirmée', tone: 'success' },
  disputed: { label: 'Déclaration contestée', tone: 'danger' },
  abandoned: { label: 'Abandonnée', tone: 'info' },
};
export const closingStatus = (closing) => CLOSING_STATUS[closing?.status] || { label: String(closing?.status || ''), tone: 'info' };

export const SALE_OBJECT_LABELS = { titres: 'Cession de titres', fonds: 'Cession du fonds de commerce', indifferent: 'Titres ou fonds' };
