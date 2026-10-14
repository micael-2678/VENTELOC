// Statuts d'annonce lisibles côté vendeur (docs/venteloc/SPEC.md §5.4 : publication automatique), motifs de blocage
// (`blocking: [{code, label}]`, libellés identiques à LISTING_BLOCKING_LABELS côté serveur) et drapeaux de relecture
// (`flags: [{code, label}]` ou `moderation.flags`, LISTING_FLAG_LABELS). Les anciennes formes (codes seuls) sont
// acceptées.

export const LISTING_STATUS = {
  draft: { label: 'Brouillon', tone: 'warning' },
  mandat_en_attente: { label: 'Mandat à signer', tone: 'warning' },
  published: { label: 'En ligne', tone: 'success' },
  paused: { label: 'En pause', tone: 'info' },
  withdrawn: { label: 'Retirée', tone: 'info' },
  sold: { label: 'Vendue', tone: 'success' },
  sold_elsewhere: { label: 'Vendue hors plateforme', tone: 'info' },
  removed: { label: 'Retirée par la modération', tone: 'danger' },
};

// API.md §2 : codes de `blocking`
export const LISTING_BLOCKING_LABELS = {
  email_not_verified: 'votre adresse e-mail n\'est pas confirmée',
  identity: 'votre identité n\'est pas vérifiée',
  mandate: 'le mandat de vente n\'est pas signé',
  property_type: 'le type de bien n\'est pas renseigné',
  location: 'la ville et le code postal ne sont pas renseignés',
  lease: 'le bail (type et date de début) n\'est pas renseigné',
  rent: 'le loyer mensuel n\'est pas renseigné',
  price: 'le prix de vente n\'est pas renseigné',
  dpe: 'la classe énergie du DPE n\'est pas renseignée',
  surface: 'la surface n\'est pas renseignée',
  ownership_proof: 'le justificatif de propriété n\'est pas déposé',
  siret: 'le SIRET de la société propriétaire n\'est pas renseigné',
  societe_cessee: 'la société propriétaire est signalée comme cessée au registre national',
};

// API.md §2 : codes de `flags` (non bloquants, relus par la plateforme)
export const LISTING_FLAG_LABELS = {
  ownership_pending: 'justificatif de propriété en cours de contrôle',
  gerant_mismatch: 'gérant déclaré non retrouvé au registre de la société',
  dpe_rental_ban: 'logement concerné par l\'interdiction de louer (décence énergétique)',
  tenant_unpaid: 'impayés déclarés',
  duplicate_address: 'une annonce semblable est déjà publiée',
  opendata_unavailable: 'registre des entreprises indisponible au moment de la publication',
};

// Ce que le vendeur peut faire pour lever chaque motif ; `step` : écran du formulaire à rouvrir
export const BLOCKING_ACTIONS = {
  email_not_verified: { action: 'confirm_email' },
  identity: { action: 'verify_identity' },
  mandate: { action: 'sign_mandate' },
  ownership_proof: { action: 'ownership' },
  property_type: { action: 'edit', step: 1 },
  location: { action: 'edit', step: 1 },
  dpe: { action: 'edit', step: 1 },
  surface: { action: 'edit', step: 1 },
  siret: { action: 'edit', step: 1 },
  lease: { action: 'edit', step: 2 },
  rent: { action: 'edit', step: 2 },
  price: { action: 'edit', step: 3 },
  societe_cessee: { action: 'contact' },
};

const asEntries = (list, labels) => (Array.isArray(list) ? list : [])
  .map((x) => (x && typeof x === 'object' ? { code: String(x.code || ''), label: x.label || labels[x.code] || String(x.code || '') } : { code: String(x), label: labels[x] || String(x) }))
  .filter((x) => x.code);

// « Publication bloquée » seulement pour un motif à corriger dans l'annonce (ou une société cessée) : l'identité, le
// mandat et le justificatif sont des étapes normales du parcours, affichées comme telles
const needsFix = (property) => asEntries(property?.blocking, {}).some((b) => ['edit', 'contact'].includes((BLOCKING_ACTIONS[b.code] || { action: 'edit' }).action));

export const listingStatusInfo = (property) => {
  const status = property?.status || 'draft';
  const base = LISTING_STATUS[status] || { label: status, tone: 'info' };
  if (['draft', 'mandat_en_attente'].includes(status) && needsFix(property)) {
    return { ...base, label: 'Publication bloquée', tone: 'danger' };
  }
  return base;
};

export const badgeClass = (tone) => {
  switch (tone) {
    case 'success': return 'badge badge-success';
    case 'warning': return 'badge badge-warning';
    case 'danger': return 'badge badge-danger';
    case 'verified': return 'badge badge-verified';
    default: return 'badge badge-info';
  }
};

// Motifs de blocage d'une annonce → [{ code, label, action, step }]
export const blockingReasons = (property) => asEntries(property?.blocking, LISTING_BLOCKING_LABELS)
  .map((b) => ({ ...b, ...(BLOCKING_ACTIONS[b.code] || { action: 'edit' }) }));

// Drapeaux de relecture (non bloquants, visibles par le vendeur pour information)
export const moderationFlags = (property) => {
  const list = Array.isArray(property?.flags) && property.flags.length ? property.flags : property?.moderation?.flags;
  return asEntries(list, LISTING_FLAG_LABELS);
};

// Motif de retrait posé par la modération (annonce `removed`)
export const removalReason = (property) => (property?.status === 'removed' ? (property?.moderation?.reason_text || property?.moderation?.reason || '') : '');

// Justificatif de propriété (API.md §2) : statut lisible
export const OWNERSHIP_STATUS = {
  missing: { label: 'Justificatif à déposer', tone: 'warning' },
  pending: { label: 'Justificatif en cours de contrôle', tone: 'info' },
  verified: { label: 'Propriétaire vérifié', tone: 'verified' },
  rejected: { label: 'Justificatif refusé', tone: 'danger' },
};
export const ownershipStatusOf = (property) => {
  const s = property?.ownership?.status;
  return OWNERSHIP_STATUS[s] ? s : 'missing';
};

export const isLive = (property) => property?.status === 'published';
export const canPause = (property) => property?.status === 'published';
export const canResume = (property) => property?.status === 'paused';
export const canWithdraw = (property) => ['published', 'paused'].includes(property?.status);
export const canMarkSold = (property) => ['published', 'paused', 'withdrawn'].includes(property?.status);
