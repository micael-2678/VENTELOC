// Statuts d'annonce lisibles côté cédant (SPEC §4.4 : publication automatique, plus de « validation sous 48 h »),
// motifs de blocage (`blocking`, libellés identiques à LISTING_BLOCKING_LABELS côté serveur) et drapeaux de
// post-modération (`moderation.flags`, LISTING_FLAG_LABELS).

export const LISTING_STATUS = {
  draft: { label: 'Brouillon', tone: 'warning' },
  mandat_en_attente: { label: 'Mandat à signer', tone: 'warning' },
  published: { label: 'En ligne', tone: 'success' },
  paused: { label: 'En pause', tone: 'info' },
  withdrawn: { label: 'Retirée', tone: 'info' },
  sold: { label: 'Vendue', tone: 'success' },
  sold_elsewhere: { label: 'Vendue hors plateforme', tone: 'info' },
  removed: { label: 'Retirée par la modération', tone: 'danger' },
  rejected: { label: 'Non publiée', tone: 'danger' },
  pending: { label: 'En relecture', tone: 'info' },
  archived: { label: 'Archivée', tone: 'info' },
};

export const LISTING_BLOCKING_LABELS = {
  email_non_confirme: 'votre adresse e-mail n\'est pas confirmée',
  email_not_verified: 'votre adresse e-mail n\'est pas confirmée',
  identite_non_verifiee: 'votre identité n\'est pas vérifiée',
  siret_manquant: 'le SIRET de l\'entreprise n\'est pas renseigné',
  siren_inactif: 'l\'entreprise est signalée comme cessée au registre national',
  doublon_siren: 'une annonce est déjà en ligne ou en pause pour cette entreprise',
  metier_manquant: 'aucun métier n\'est renseigné',
  prix_manquant: 'le prix demandé n\'est pas renseigné',
};

export const LISTING_FLAG_LABELS = {
  dirigeant_non_confirme: 'qualité de dirigeant non confirmée par le registre',
  naf_hors_batiment: 'code NAF hors bâtiment',
  naf_connexe: 'code NAF connexe au bâtiment',
  rge_absent_ademe: 'RGE déclaré mais absent de la liste ADEME',
  open_data_indisponible: 'open data indisponible au moment de la publication',
};

// Ce que le cédant peut faire pour lever chaque motif
export const BLOCKING_ACTIONS = {
  email_non_confirme: 'confirm_email',
  email_not_verified: 'confirm_email',
  identite_non_verifiee: 'verify_identity',
  siret_manquant: 'edit',
  siren_inactif: 'contact',
  doublon_siren: 'contact',
  metier_manquant: 'edit',
  prix_manquant: 'edit',
};

export const listingStatusInfo = (company) => {
  const status = company?.status || 'draft';
  const base = LISTING_STATUS[status] || { label: status, tone: 'info' };
  if (status === 'draft' && Array.isArray(company?.blocking) && company.blocking.length) {
    return { ...base, label: 'Publication bloquée', tone: 'danger' };
  }
  return base;
};

export const badgeClass = (tone) => {
  switch (tone) {
    case 'success': return 'badge badge-success';
    case 'warning': return 'badge badge-warning';
    case 'danger': return 'badge badge-danger';
    default: return 'badge badge-info';
  }
};

// Motifs de blocage d'une annonce → [{ code, label, action }]
export const blockingReasons = (company) => {
  const codes = Array.isArray(company?.blocking) && company.blocking.length
    ? company.blocking
    : (company?.status === 'draft' && company?.blocked_reason ? [company.blocked_reason] : []);
  return codes.map((code) => ({ code, label: LISTING_BLOCKING_LABELS[code] || String(code), action: BLOCKING_ACTIONS[code] || 'edit' }));
};

// Drapeaux de post-modération (non bloquants, visibles par le cédant pour information)
export const moderationFlags = (company) => {
  const flags = Array.isArray(company?.moderation?.flags) ? company.moderation.flags : [];
  return flags.map((code) => ({ code, label: LISTING_FLAG_LABELS[code] || String(code) }));
};

// Motif de retrait posé par la modération (annonce `removed`)
export const removalReason = (company) => (company?.status === 'removed' ? (company?.moderation?.reason_text || company?.moderation?.reason || '') : '');

export const isLive = (company) => company?.status === 'published';
export const canPause = (company) => company?.status === 'published';
export const canResume = (company) => company?.status === 'paused';
export const canWithdraw = (company) => ['published', 'paused'].includes(company?.status);
export const canMarkSold = (company) => ['published', 'paused', 'withdrawn'].includes(company?.status);
