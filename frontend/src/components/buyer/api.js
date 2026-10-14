// Accès API de l'espace repreneur (API.md §2 à §8). Les réponses sont lues de façon tolérante : la forme du
// contrat (tableau nu, `steps`/`next_step`) ou l'enveloppe historique ({offers}, {closings}, {favorites},
// {alerts}, conversations groupées par annonce). Aucun texte d'offre n'est écrit ici : voir lib/offer.js.
import { axiosInstance } from '@/App';
import { apiErrorCode } from '@/components/account/errors';

export const asList = (data, key) => {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data[key])) return data[key];
  return [];
};

const settled = (p) => p.then((r) => r.data).catch(() => null);

export const fetchProperty = (propertyId) => settled(axiosInstance.get(`/properties/${propertyId}`));
export const fetchFavorites = () => settled(axiosInstance.get('/favorites')).then((d) => asList(d, 'favorites'));
export const fetchAlerts = () => settled(axiosInstance.get('/alerts')).then((d) => asList(d, 'alerts'));
export const fetchMyOffers = () => settled(axiosInstance.get('/offers/my')).then((d) => asList(d, 'offers'));
export const fetchClosings = () => settled(axiosInstance.get('/closing/my')).then((d) => asList(d, 'closings'));
export const fetchKyc = () => settled(axiosInstance.get('/kyc/status'));
export const fetchProfile = () => settled(axiosInstance.get('/auth/profile')).then((d) => (d && d.user ? d.user : d));
export const fetchTransmissibility = (propertyId) => settled(axiosInstance.get(`/properties/${propertyId}/transmissibility`));
export const fetchDataroomDocuments = (propertyId) => settled(axiosInstance.get(`/dataroom/${propertyId}/documents`));

// ------------------------------------------------------------------------------------------------
// Statut d'accès au dossier (API.md §4) : {access_granted, access_status, steps:{identity, nda, funds}, next_step, request}.
// Forme vague 1 tolérée : {nda_signed, request:{status}} sans `steps` (l'identité est lue sur le compte).
export const normalizeAccessStatus = (data, user) => {
  const d = data && typeof data === 'object' ? data : {};
  const request = d.request && typeof d.request === 'object' ? d.request : null;
  const status = d.access_status || request?.status || null;
  const granted = d.access_granted === true || status === 'granted';
  const steps = d.steps && typeof d.steps === 'object' ? d.steps : {};
  const identity = steps.identity === true || Boolean(user?.identity_verified) || user?.kyc_status === 'verified';
  const nda = steps.nda === true || d.nda_signed === true || Boolean(request?.nda_signed_at);
  const funds = steps.funds === true || granted || Boolean(request?.funds_declaration);
  const accepted = ['accepted', 'validated', 'loi_pending', 'granted'].includes(status);
  let nextStep = d.next_step || null;
  if (!nextStep && accepted && !granted) nextStep = !identity ? 'identity' : !nda ? 'nda' : !funds ? 'funds' : null;
  return {
    isSeller: d.is_seller === true,
    accessGranted: granted,
    status: granted ? 'granted' : status,
    accepted,
    steps: { identity, nda, funds },
    nextStep,
    request: request ? { id: request.id, createdAt: request.created_at || request.requested_at || null, expiresAt: request.expires_at || null } : null,
  };
};

export const fetchAccessStatus = (propertyId, user) =>
  settled(axiosInstance.get(`/dataroom/${propertyId}/access-status`)).then((d) => (d ? normalizeAccessStatus(d, user) : null));

// ------------------------------------------------------------------------------------------------
// Conversations (API.md §3) : tableau [{id, property_id, property_title, last_message, last_at, unread_count, access_status…}] ;
// forme historique tolérée ({property_id: [messages]}).
export const normalizeConversations = (data, userId) => {
  if (Array.isArray(data)) {
    return data.map((c) => ({ ...c, unread_count: Number(c.unread_count) || 0, legacy: false }));
  }
  if (data && typeof data === 'object') {
    return Object.keys(data).map((propertyId) => {
      const msgs = Array.isArray(data[propertyId]) ? data[propertyId] : [];
      const sorted = [...msgs].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      const last = sorted[sorted.length - 1] || {};
      const first = sorted[0] || {};
      return {
        id: propertyId,
        property_id: propertyId,
        property_title: '',
        last_message: last.content || '',
        last_at: last.created_at || null,
        first_at: first.created_at || null,
        unread_count: sorted.filter((m) => m.receiver_id === userId && !m.read).length,
        legacy: true,
      };
    }).sort((a, b) => new Date(b.last_at || 0) - new Date(a.last_at || 0));
  }
  return [];
};
export const fetchConversations = (userId) => settled(axiosInstance.get('/messages/conversations')).then((d) => normalizeConversations(d, userId));

// ------------------------------------------------------------------------------------------------
// Libellés
export const OFFER_STATUS = {
  pending_signature: { label: 'À signer', tone: 'warning' },
  pending: { label: 'Transmise au cédant', tone: 'info' },
  accepted: { label: 'Acceptée', tone: 'success' },
  rejected: { label: 'Refusée', tone: 'danger' },
  countered: { label: 'Contre-proposition reçue', tone: 'warning' },
  expired: { label: 'Expirée', tone: 'info' },
};
export const offerStatus = (offer) => OFFER_STATUS[offer?.status] || { label: String(offer?.status || ''), tone: 'info' };
const OFFER_PIPELINE_DETAIL = {
  pending_signature: 'Offre à signer',
  pending: 'Offre transmise au cédant',
  accepted: 'Offre acceptée',
  rejected: 'Offre refusée',
  countered: 'Contre-proposition du cédant à étudier',
  expired: 'Offre expirée',
};

export const CLOSING_STATUS = {
  in_progress: { label: 'Vente en cours', tone: 'info' },
  declared: { label: 'Vente déclarée, à confirmer', tone: 'warning' },
  confirmed: { label: 'Vente confirmée', tone: 'success' },
  disputed: { label: 'Déclaration contestée', tone: 'danger' },
  abandoned: { label: 'Vente abandonnée', tone: 'info' },
};
export const closingStatus = (closing) => CLOSING_STATUS[closing?.status] || { label: String(closing?.status || ''), tone: 'info' };

export const SALE_OBJECT_LABELS = { titres: 'Cession de titres', fonds: 'Cession du fonds de commerce', indifferent: 'Titres ou fonds, au choix' };
export const SALE_REASON_LABELS = { retraite: 'Départ à la retraite', reconversion: 'Reconversion ou nouveau projet', sante: 'Raison de santé', autre: 'Autre raison' };
export const FINANCING_LABELS = { equity: 'Apport', loan: 'Emprunt bancaire', vendor_loan: 'Crédit vendeur', earn_out: 'Complément de prix' };
export const FUNDS_SOURCES = [
  { value: 'fonds-propres', label: 'Fonds propres' },
  { value: 'emprunt', label: 'Emprunt bancaire' },
  { value: 'mixte', label: 'Apport et emprunt' },
  { value: 'investisseurs', label: 'Investisseurs ou société du groupe' },
];

export const badgeClass = (tone) => {
  switch (tone) {
    case 'success': return 'badge badge-success';
    case 'warning': return 'badge badge-warning';
    case 'danger': return 'badge badge-danger';
    case 'verified': return 'badge badge-verified';
    default: return 'badge badge-info';
  }
};

// ------------------------------------------------------------------------------------------------
// Pipeline « Mes dossiers » (SPEC §4.3 point 7) : une ligne par annonce, étape la plus avancée.
export const PIPELINE_STAGES = [
  { key: 'contacted', label: 'Contacté' },
  { key: 'requested', label: 'Dossier demandé' },
  { key: 'nda', label: 'Accord de confidentialité' },
  { key: 'dataroom', label: 'Dossier ouvert' },
  { key: 'offer', label: 'Offre' },
  { key: 'closing', label: 'Vente' },
];
const STAGE_INDEX = PIPELINE_STAGES.reduce((acc, s, i) => { acc[s.key] = i; return acc; }, {});

// stage : clé d'étape ; detail : phrase courte ; actionTo : lien vers la page utile
export const buildPipeline = ({ conversations = [], accessByProperty = {}, offers = [], closings = [], properties = {} }) => {
  const rows = {};
  const ensure = (propertyId) => {
    if (!rows[propertyId]) {
      rows[propertyId] = { propertyId, stage: 'contacted', detail: 'Projet présenté au cédant', lastAt: null, unread: 0, conversationId: null, offer: null, closing: null, access: null };
    }
    return rows[propertyId];
  };
  const bump = (row, stage, detail) => {
    if (STAGE_INDEX[stage] >= STAGE_INDEX[row.stage]) {
      row.stage = stage;
      row.detail = detail;
    }
  };
  const later = (row, at) => {
    if (at && (!row.lastAt || new Date(at) > new Date(row.lastAt))) row.lastAt = at;
  };

  conversations.forEach((c) => {
    if (!c.property_id) return;
    const row = ensure(c.property_id);
    row.conversationId = c.id || c.property_id;
    row.unread = Number(c.unread_count) || 0;
    row.title = c.property_title || row.title;
    later(row, c.last_at);
  });

  Object.keys(accessByProperty).forEach((propertyId) => {
    const a = accessByProperty[propertyId];
    if (!a || a.isSeller) return;
    const row = ensure(propertyId);
    row.access = a;
    later(row, a.request?.createdAt);
    if (a.accessGranted) bump(row, 'dataroom', 'Accès au dossier accordé');
    else if (a.steps.nda && a.accepted) bump(row, 'nda', 'Accord signé : déclaration d\'origine des fonds à faire');
    else if (a.accepted) bump(row, 'nda', a.nextStep === 'identity' ? 'Dossier accepté : identité à vérifier' : 'Dossier accepté : accord de confidentialité à signer');
    else if (a.status === 'pending') bump(row, 'requested', 'En attente de la réponse du cédant');
    else if (a.status === 'expired') bump(row, 'requested', 'Sans réponse du cédant sous 10 jours : nous l\'avons relancé');
    else if (a.status === 'rejected') bump(row, 'requested', 'Demande refusée par le cédant');
    else if (a.status === 'closed') bump(row, 'requested', 'Annonce plus en ligne : demande de dossier close');
  });

  offers.forEach((o) => {
    if (!o.property_id) return;
    const row = ensure(o.property_id);
    row.offer = o;
    later(row, o.updated_at || o.created_at);
    bump(row, 'offer', OFFER_PIPELINE_DETAIL[o.status] || 'Offre déposée');
  });

  closings.forEach((cl) => {
    if (!cl.property_id) return;
    const row = ensure(cl.property_id);
    row.closing = cl;
    later(row, cl.updated_at || cl.created_at);
    bump(row, 'closing', closingStatus(cl).label);
  });

  return Object.values(rows)
    .map((row) => ({ ...row, property: properties[row.propertyId] || null, title: row.title || properties[row.propertyId]?.title || '' }))
    .sort((a, b) => new Date(b.lastAt || 0) - new Date(a.lastAt || 0));
};

// ------------------------------------------------------------------------------------------------
// Alertes avec compte (API.md §8 : trades, regions, max_price, rge). Forme historique tolérée (rge_types, region).
export const normalizeAlert = (a) => {
  const alert = a || {};
  return {
    id: alert.id,
    name: alert.name || '',
    trades: Array.isArray(alert.trades) ? alert.trades : [],
    regions: Array.isArray(alert.regions) ? alert.regions : (alert.region ? [alert.region] : []),
    maxPrice: alert.max_price != null ? Number(alert.max_price) : null,
    rge: alert.rge === true ? true : alert.rge === false ? false : null,
    active: alert.active !== false,
    createdAt: alert.created_at || null,
  };
};

// Le nom sert d'intitulé lisible ; le serveur l'accepte en plus des critères
export const alertPayload = ({ trades, regions, maxPrice, rge, name }) => ({
  name: name || alertName({ trades, regions, maxPrice, rge }),
  trades,
  regions,
  max_price: maxPrice ? Number(maxPrice) : null,
  rge: rge === true || rge === false ? rge : null,
});

export const alertName = ({ trades = [], regions = [], maxPrice, rge, tradeLabel = (t) => t }) => {
  const parts = [];
  parts.push(trades.length ? trades.map(tradeLabel).join(', ') : 'Tous les métiers');
  parts.push(regions.length ? regions.join(', ') : 'Toute la France');
  if (rge === true) parts.push('RGE');
  if (maxPrice) parts.push(`≤ ${Number(maxPrice).toLocaleString('fr-FR')} €`);
  return parts.join(' · ');
};

// ------------------------------------------------------------------------------------------------
// Erreurs 403 du parcours (API.md) : codes lisibles par les pages
export const isProfileIncomplete = (error) => error?.response?.status === 403 && apiErrorCode(error) === 'profile_incomplete';
export const isIdentityRequired = (error) => error?.response?.status === 403 && apiErrorCode(error) === 'identity_required';
export const isNotAllowed = (error) => error?.response?.status === 403 && apiErrorCode(error) === 'not_allowed';

// Texte du contrat d'une offre en attente de signature, conservé le temps de la signature (sessionStorage)
const OFFER_TEXT_KEY = 'offer_text:';
export const rememberOfferText = (contractId, text) => {
  try { if (contractId && text) sessionStorage.setItem(OFFER_TEXT_KEY + contractId, text); } catch (e) { /* stockage indisponible */ }
};
export const recallOfferText = (contractId) => {
  try { return contractId ? sessionStorage.getItem(OFFER_TEXT_KEY + contractId) || '' : ''; } catch (e) { return ''; }
};
export const forgetOfferText = (contractId) => {
  try { if (contractId) sessionStorage.removeItem(OFFER_TEXT_KEY + contractId); } catch (e) { /* no-op */ }
};
