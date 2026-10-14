import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Eye, Home, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { axiosInstance } from '@/App';
import { departementLabel, propertyTypeLabel } from '@/lib/referentiels';
import { LISTING_FLAG_LABELS, LISTING_STATUS } from '@/components/seller/listingStatus';
import { apiErrorMessage, isEmailNotVerifiedError } from '@/components/account/errors';
import { titleOf } from '@/components/buyer/PipelineList';
import { propertyPath } from '@/components/buyer/api';
import {
  ActionButton, ActionDialog, EmptyState, ExtLink, FilterSelect, Loading, OwnershipRejectDialog, Pill, RemovalDialog, displayName,
  fmtDate, fmtEur, openOwnershipProof, ownershipDocLabel, ownershipInfo, removeListing, reviewOwnership,
} from './shared';

// Onglet « Annonces » (SPEC §9) : GET /admin/properties, colonne « Justificatif » (ownership.status, aperçu du fichier,
// Valider / Refuser avec motif), drapeaux property_checks / moderation libellés, retrait motivé, validation de la
// relecture, lien vers la fiche publique. Aucun compteur à zéro, aucune donnée brute.

const STATUS_FILTERS = [
  { value: 'all', label: 'Toutes' },
  { value: 'review', label: 'En ligne, à relire (48 h)' },
  { value: 'ownership', label: 'Justificatif à contrôler' },
  { value: 'published', label: 'En ligne' },
  { value: 'draft', label: 'Brouillons et bloquées' },
  { value: 'mandat_en_attente', label: 'Mandat à signer' },
  { value: 'paused', label: 'En pause' },
  { value: 'removed', label: 'Retirées par la modération' },
  { value: 'sold', label: 'Vendues' },
  { value: 'other', label: 'Autres (retirées, archivées, vendues ailleurs)' },
];

const TONE_BY_STATUS = { success: 'success', warning: 'warning', danger: 'danger', info: 'info' };

const statusInfo = (c) => {
  const base = LISTING_STATUS[c.status] || { label: 'Statut inconnu', tone: 'info' };
  if (c.status === 'draft' && Array.isArray(c.blocking) && c.blocking.length) return { label: 'Publication bloquée', tone: 'danger' };
  if (c.status === 'published' && c.moderation?.status === 'pending') return { label: 'En ligne · relecture en cours', tone: 'warning' };
  return base;
};

// Contrôles du bien (property_checks, SPEC §3.4) → pastilles libellées ; les valeurs absentes ne sont pas affichées.
// Le justificatif de propriété a sa propre colonne (ownership).
export const checkChips = (checks) => {
  const ch = checks || {};
  const chips = [];
  if (ch.siren_active === true) chips.push({ key: 'siren', label: 'Société active au registre', tone: 'success' });
  if (ch.siren_active === false) chips.push({ key: 'siren', label: 'Société cessée au registre', tone: 'danger' });
  const gm = ch.gerant_match;
  if (gm === 'match_exact' || gm === true) chips.push({ key: 'gerant', label: 'Gérant concordant', tone: 'success' });
  if (gm === 'match_partial') chips.push({ key: 'gerant', label: 'Gérant partiellement concordant', tone: 'warning' });
  if (gm === 'no_match' || gm === false) chips.push({ key: 'gerant', label: 'Gérant non concordant', tone: 'warning' });
  if (gm === 'unavailable') chips.push({ key: 'gerant', label: 'Registre indisponible (gérant)', tone: 'info' });
  const dpe = typeof ch.dpe_rental_status === 'object' && ch.dpe_rental_status ? ch.dpe_rental_status.status : ch.dpe_rental_status;
  if (dpe === 'interdit') chips.push({ key: 'dpe', label: 'Logement interdit à la location (DPE)', tone: 'warning' });
  if (dpe === 'echeance') chips.push({ key: 'dpe', label: 'Interdiction de louer à venir (DPE)', tone: 'warning' });
  if (ch.opendata_available === false) chips.push({ key: 'opendata', label: 'Open data indisponible', tone: 'info' });
  return chips;
};

// Drapeaux de modération déjà exprimés par une pastille ou par la colonne « Justificatif » : non répétés
const FLAG_CHIP_KEY = { gerant_mismatch: 'gerant', dpe_rental_ban: 'dpe', opendata_unavailable: 'opendata', ownership_pending: 'ownership' };
export const moderationFlagLabels = (flags, chips) => {
  const shown = new Set(['ownership', ...(chips || []).filter((ch) => ch.tone !== 'success').map((ch) => ch.key)]);
  return Array.from(new Set((flags || [])
    .filter((f) => !(FLAG_CHIP_KEY[f] && shown.has(FLAG_CHIP_KEY[f])))
    .map((f) => LISTING_FLAG_LABELS[f] || String(f))));
};

// Colonne « Justificatif » : statut, type de pièce, aperçu, et décision tant qu'il est à contrôler
export const OwnershipLine = ({ property, busy, onPreview, onVerify, onReject }) => {
  const o = property.ownership || {};
  const info = ownershipInfo(o);
  const uploaded = ['pending', 'verified', 'rejected'].includes(o.status);
  return (
    <div className="flex flex-wrap items-center gap-2 mt-2 min-w-0" data-testid={`property-ownership-${property.id}`}>
      <span className="text-sm text-gray-600">Justificatif :</span>
      <Pill wrap tone={info.tone} testId={`property-ownership-status-${property.id}`}>{info.label}</Pill>
      {o.doc_type && <span className="text-sm text-gray-700">{ownershipDocLabel(o.doc_type)}{o.uploaded_at ? ` · déposé le ${fmtDate(o.uploaded_at)}` : ''}</span>}
      {o.status === 'rejected' && o.note && <span className="text-sm text-red-800 break-words">Motif : {o.note}</span>}
      {uploaded && (
        <button type="button" onClick={onPreview} className="inline-flex items-center gap-1 text-sm font-medium text-brand-blue underline underline-offset-2 hover:text-brand-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue rounded" data-testid={`property-proof-${property.id}`}>
          <Eye className="w-4 h-4" aria-hidden="true" />
          Voir
        </button>
      )}
      {o.status === 'pending' && (
        <>
          <ActionButton tone="primary" busy={busy} onClick={onVerify} testId={`property-proof-verify-${property.id}`}>Valider</ActionButton>
          <ActionButton tone="danger" busy={busy} onClick={onReject} testId={`property-proof-reject-${property.id}`}>Refuser</ActionButton>
        </>
      )}
    </div>
  );
};

// « Retirée : motif. » sans double point quand le motif saisi se termine déjà par une ponctuation
export const removalSentence = (reason) => `Retirée : ${String(reason || '').trim().replace(/[\s.]+$/, '')}.`;

const matches = (c, q) => {
  if (!q) return true;
  const hay = [titleOf(c), c.company_name, c.siret, c.address, c.postal_code, c.city, c.region, c.seller?.email, displayName(c.seller), propertyTypeLabel(c.property_type)]
    .map((s) => String(s || '').toLowerCase()).join(' ');
  return hay.includes(q.toLowerCase());
};

const inFilter = (c, filter) => {
  switch (filter) {
    case 'all': return true;
    case 'review': return c.status === 'published' && c.moderation?.status === 'pending';
    case 'ownership': return c.ownership?.status === 'pending';
    case 'other': return ['withdrawn', 'archived', 'sold_elsewhere', 'rejected', 'pending'].includes(c.status);
    default: return c.status === filter;
  }
};

const AdminProperties = ({ properties, loading, onReload, focusId, onEmailBlocked }) => {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState(null); // {kind: 'remove'|'publish'|'reject-proof', property}
  const [busy, setBusy] = useState('');

  const rows = useMemo(() => (properties || []).filter((c) => inFilter(c, filter) && matches(c, query)), [properties, filter, query]);

  const setStatus = async (property, status) => {
    setBusy(property.id);
    try {
      await axiosInstance.put(`/properties/${property.id}/status`, null, { params: { status } });
      toast.success(status === 'published' ? 'Annonce en ligne, relecture close.' : 'Statut mis à jour.');
      onReload?.();
    } catch (err) {
      if (isEmailNotVerifiedError(err)) onEmailBlocked?.();
      toast.error(apiErrorMessage(err));
      throw err;
    } finally {
      setBusy('');
    }
  };

  const decideOwnership = async (property, status, note) => {
    setBusy(property.id);
    try {
      await reviewOwnership(property.id, status, note);
      toast.success(status === 'verified'
        ? 'Justificatif validé : le badge « Propriétaire vérifié » est affiché et le vendeur est prévenu.'
        : 'Justificatif refusé : le vendeur reçoit le motif par e-mail.');
      onReload?.();
    } catch (err) {
      if (isEmailNotVerifiedError(err)) onEmailBlocked?.();
      toast.error(apiErrorMessage(err));
      throw err;
    } finally {
      setBusy('');
    }
  };

  const preview = async (property) => {
    try {
      await openOwnershipProof(property.id);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Le justificatif n\'a pas pu être ouvert.'));
    }
  };

  const remove = async (property, reason, reasonText) => {
    setBusy(property.id);
    try {
      await removeListing(property.id, reason, reasonText);
      toast.success('Annonce retirée : le vendeur est informé du motif.');
      onReload?.();
    } catch (err) {
      if (isEmailNotVerifiedError(err)) onEmailBlocked?.();
      toast.error(apiErrorMessage(err));
      throw err;
    } finally {
      setBusy('');
    }
  };

  if (loading && !properties) return <Loading label="Chargement des annonces…" />;

  return (
    <div className="space-y-4" data-testid="admin-properties">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <h2 className="font-display text-xl sm:text-2xl font-bold text-brand-navy mr-auto">Annonces</h2>
        <FilterSelect id="properties-filter" label="Afficher" value={filter} onChange={setFilter} options={STATUS_FILTERS} testId="properties-filter" />
        <label htmlFor="properties-search" className="relative block sm:w-72">
          <span className="sr-only">Rechercher une annonce</span>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" aria-hidden="true" />
          <Input id="properties-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Titre, ville, adresse, SCI, vendeur…" className="pl-9 rounded-xl" data-testid="properties-search" />
        </label>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={Home}>{properties?.length ? 'Aucune annonce ne correspond à ce filtre.' : 'Aucune annonce pour le moment.'}</EmptyState>
      ) : (
        <ul className="space-y-3">
          {rows.map((c) => {
            const info = statusInfo(c);
            const chips = checkChips(c.property_checks);
            const flags = moderationFlagLabels(c.moderation?.flags, chips);
            const stats = [];
            if (c.views > 0) stats.push(`${c.views} vue${c.views > 1 ? 's' : ''}`);
            if (c.favorites_count > 0) stats.push(`${c.favorites_count} favori${c.favorites_count > 1 ? 's' : ''}`);
            if (c.messages_count > 0) stats.push(`${c.messages_count} message${c.messages_count > 1 ? 's' : ''}`);
            const canValidate = c.status === 'published' && c.moderation?.status === 'pending';
            const canRepublish = ['removed', 'rejected', 'pending'].includes(c.status);
            const canRemove = ['published', 'paused', 'pending'].includes(c.status);
            const seller = c.seller;
            return (
              <li key={c.id} className={`rounded-2xl bg-white border p-4 sm:p-5 min-w-0 ${focusId === c.id ? 'border-brand-blue ring-2 ring-brand-blue' : 'border-brand-line'}`} data-testid={`property-${c.id}`}>
                <div className="flex flex-col sm:flex-row sm:items-start gap-3 min-w-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-brand-navy break-words">{titleOf(c) || 'Bien sans titre'}</h3>
                      <Pill tone={TONE_BY_STATUS[info.tone] || 'info'} testId={`property-status-${c.id}`}>{info.label}</Pill>
                    </div>
                    <p className="text-sm text-gray-700 mt-1 break-words">
                      {[c.address, [c.postal_code, c.city].filter(Boolean).join(' '), c.department ? departementLabel(c.department) : ''].filter(Boolean).join(' · ') || 'Adresse non renseignée'}
                      {c.asking_price > 0 ? ` · Prix demandé ${fmtEur(c.asking_price)}` : ''}
                      {c.gross_yield > 0 ? ` · rendement brut ${String(c.gross_yield).replace('.', ',')} %` : ''}
                    </p>
                    {(c.company_name || c.siret) && (
                      <p className="text-sm text-gray-700 break-words">{[c.company_name, c.siret ? `SIRET ${c.siret}` : ''].filter(Boolean).join(' · ')}</p>
                    )}
                    <OwnershipLine
                      property={c}
                      busy={busy === c.id}
                      onPreview={() => preview(c)}
                      onVerify={() => decideOwnership(c, 'verified').catch(() => {})}
                      onReject={() => setDialog({ kind: 'reject-proof', property: c })}
                    />
                    {(chips.length > 0 || flags.length > 0) && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {chips.map((ch) => <Pill wrap key={ch.key} tone={ch.tone}>{ch.label}</Pill>)}
                        {flags.map((f) => <Pill wrap key={f} tone="warning">{f}</Pill>)}
                      </div>
                    )}
                    {c.moderation?.status === 'pending' && c.moderation?.review_until && (
                      <p className="text-[13px] text-gray-600 mt-2">Relecture ouverte jusqu'au {fmtDate(c.moderation.review_until)}.</p>
                    )}
                    {c.status === 'removed' && (c.moderation?.reason_text || c.moderation?.reason) && (
                      <p className="text-sm text-red-800 mt-2 break-words">{removalSentence(c.moderation.reason_text || c.moderation.reason)}</p>
                    )}
                    <p className="text-sm text-gray-700 mt-2 break-words">
                      <span className="text-gray-600">Vendeur : </span>
                      {seller ? [displayName(seller), seller.email, seller.phone].filter(Boolean).join(' · ') : 'compte introuvable'}
                    </p>
                    <p className="text-[13px] text-gray-600 mt-1">
                      {[c.published_at ? `Publiée le ${fmtDate(c.published_at)}` : `Créée le ${fmtDate(c.created_at)}`, ...stats].join(' · ')}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 sm:flex-col sm:items-end shrink-0">
                    <ExtLink href={propertyPath(c.id)} testId={`property-link-${c.id}`}>Fiche publique</ExtLink>
                    {canValidate && <ActionButton tone="primary" busy={busy === c.id} onClick={() => setStatus(c, 'published').catch(() => {})} testId={`property-validate-${c.id}`}>Valider</ActionButton>}
                    {canRepublish && <ActionButton busy={busy === c.id} onClick={() => setDialog({ kind: 'publish', property: c })} testId={`property-publish-${c.id}`}>Remettre en ligne</ActionButton>}
                    {canRemove && <ActionButton tone="danger" busy={busy === c.id} onClick={() => setDialog({ kind: 'remove', property: c })} testId={`property-remove-${c.id}`}>Retirer avec motif</ActionButton>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <RemovalDialog
        open={dialog?.kind === 'remove'}
        onClose={() => setDialog(null)}
        listingLabel={dialog ? titleOf(dialog.property) : ''}
        onConfirm={(reason, text) => remove(dialog.property, reason, text)}
      />
      <OwnershipRejectDialog
        open={dialog?.kind === 'reject-proof'}
        onClose={() => setDialog(null)}
        listingLabel={dialog ? titleOf(dialog.property) : ''}
        onConfirm={(note) => decideOwnership(dialog.property, 'rejected', note)}
      />
      <ActionDialog
        open={dialog?.kind === 'publish'}
        onClose={() => setDialog(null)}
        title="Remettre l'annonce en ligne"
        description="L'annonce repasse en ligne immédiatement. Un mandat signé et un justificatif de propriété déposé sont nécessaires ; sinon la plateforme refuse la mise en ligne et le vendeur doit compléter son dossier."
        confirmLabel="Mettre en ligne"
        onConfirm={() => setStatus(dialog.property, 'published')}
        testId="publish-dialog"
      />
    </div>
  );
};

export default AdminProperties;
