import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Building2, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { axiosInstance } from '@/App';
import { listingTitle } from '@/components/shared';
import { departementLabel, tradeLabel } from '@/lib/referentiels';
import { LISTING_FLAG_LABELS, LISTING_STATUS } from '@/components/seller/listingStatus';
import { apiErrorMessage, isEmailNotVerifiedError } from '@/components/account/errors';
import { ActionButton, ActionDialog, EmptyState, ExtLink, FilterSelect, Loading, Pill, RemovalDialog, displayName, fmtDate, fmtEur, removeListing } from './shared';

// Onglet « Annonces » : GET /admin/properties, drapeaux property_checks / moderation libellés, retrait motivé,
// validation de la relecture, lien vers la fiche publique. Aucun compteur à zéro, aucune donnée brute.

const STATUS_FILTERS = [
  { value: 'all', label: 'Toutes' },
  { value: 'review', label: 'En ligne, à relire (48 h)' },
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

// Drapeaux de contrôle (property_checks) → pastilles libellées ; les valeurs absentes ne sont pas affichées
export const checkChips = (checks) => {
  const ch = checks || {};
  const chips = [];
  if (ch.siren_active === true) chips.push({ key: 'siren', label: 'SIREN actif', tone: 'success' });
  if (ch.siren_active === false) chips.push({ key: 'siren', label: 'SIREN cessé au registre', tone: 'danger' });
  if (ch.naf_in_building === true) chips.push({ key: 'naf', label: 'NAF bâtiment', tone: 'success' });
  if (ch.naf_in_building === false) chips.push({ key: 'naf', label: 'NAF hors bâtiment', tone: 'warning' });
  if (ch.in_ademe_list === true) chips.push({ key: 'ademe', label: 'RGE vérifié ADEME', tone: 'success' });
  if (ch.in_ademe_list === false) chips.push({ key: 'ademe', label: 'RGE absent de la liste ADEME', tone: 'warning' });
  const dm = ch.dirigeant_match;
  if (dm === 'match_exact' || dm === true) chips.push({ key: 'dirigeant', label: 'Dirigeant confirmé', tone: 'success' });
  if (dm === 'match_partial') chips.push({ key: 'dirigeant', label: 'Dirigeant partiellement confirmé', tone: 'warning' });
  if (dm === 'no_match' || dm === false) chips.push({ key: 'dirigeant', label: 'Dirigeant non confirmé', tone: 'warning' });
  if (dm === 'unavailable') chips.push({ key: 'dirigeant', label: 'Registre indisponible (dirigeant)', tone: 'info' });
  if (ch.duplicate_siren === true) chips.push({ key: 'dup', label: 'Doublon SIREN', tone: 'danger' });
  return chips;
};

// Drapeaux de modération déjà exprimés par une pastille de contrôle (même information) : non répétés
const FLAG_CHIP_KEY = { dirigeant_non_confirme: 'dirigeant', naf_hors_batiment: 'naf', rge_absent_ademe: 'ademe' };
export const moderationFlagLabels = (flags, chips) => {
  const shown = new Set((chips || []).filter((ch) => ch.tone !== 'success').map((ch) => ch.key));
  return Array.from(new Set((flags || [])
    .filter((f) => !(FLAG_CHIP_KEY[f] && shown.has(FLAG_CHIP_KEY[f])))
    .map((f) => LISTING_FLAG_LABELS[f] || String(f))));
};

// « Retirée : motif. » sans double point quand le motif saisi se termine déjà par une ponctuation
export const removalSentence = (reason) => `Retirée : ${String(reason || '').trim().replace(/[\s.]+$/, '')}.`;

const matches = (c, q) => {
  if (!q) return true;
  const hay = [listingTitle(c), c.company_name, c.siret, c.region, c.seller?.email, displayName(c.seller), (c.trades || []).map((t) => tradeLabel(t, true)).join(' ')]
    .map((s) => String(s || '').toLowerCase()).join(' ');
  return hay.includes(q.toLowerCase());
};

const inFilter = (c, filter) => {
  switch (filter) {
    case 'all': return true;
    case 'review': return c.status === 'published' && c.moderation?.status === 'pending';
    case 'other': return ['withdrawn', 'archived', 'sold_elsewhere', 'rejected', 'pending'].includes(c.status);
    default: return c.status === filter;
  }
};

const AdminProperties = ({ properties, loading, onReload, focusId, onEmailBlocked }) => {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState(null); // {kind: 'remove'|'publish', property}
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

  const remove = async (property, reason, reasonText) => {
    setBusy(property.id);
    try {
      await removeListing(property.id, reason, reasonText);
      toast.success('Annonce retirée : le cédant est informé du motif.');
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
          <Input id="properties-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Titre, société, SIRET, cédant…" className="pl-9 rounded-xl" data-testid="properties-search" />
        </label>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={Building2}>{properties?.length ? 'Aucune annonce ne correspond à ce filtre.' : 'Aucune annonce pour le moment.'}</EmptyState>
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
                      <h3 className="font-semibold text-brand-navy break-words">{listingTitle(c)}</h3>
                      <Pill tone={TONE_BY_STATUS[info.tone] || 'info'} testId={`property-status-${c.id}`}>{info.label}</Pill>
                    </div>
                    <p className="text-sm text-gray-700 mt-1 break-words">
                      {[c.company_name, c.siret ? `SIRET ${c.siret}` : '', c.region, c.department ? departementLabel(c.department) : ''].filter(Boolean).join(' · ') || 'Société non renseignée'}
                      {c.asking_price > 0 ? ` · Prix demandé ${fmtEur(c.asking_price)}` : ''}
                    </p>
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
                      <span className="text-gray-600">Cédant : </span>
                      {seller ? [displayName(seller), seller.email, seller.phone].filter(Boolean).join(' · ') : 'compte introuvable'}
                    </p>
                    <p className="text-[13px] text-gray-600 mt-1">
                      {[c.published_at ? `Publiée le ${fmtDate(c.published_at)}` : `Créée le ${fmtDate(c.created_at)}`, ...stats].join(' · ')}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 sm:flex-col sm:items-end shrink-0">
                    <ExtLink href={`/property/${c.id}`} testId={`property-link-${c.id}`}>Fiche publique</ExtLink>
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
        listingLabel={dialog ? listingTitle(dialog.property) : ''}
        onConfirm={(reason, text) => remove(dialog.property, reason, text)}
      />
      <ActionDialog
        open={dialog?.kind === 'publish'}
        onClose={() => setDialog(null)}
        title="Remettre l'annonce en ligne"
        description="L'annonce repasse en ligne immédiatement. Un mandat signé est nécessaire ; sinon la plateforme refuse la mise en ligne et le cédant doit signer un nouveau mandat."
        confirmLabel="Mettre en ligne"
        onConfirm={() => setStatus(dialog.property, 'published')}
        testId="publish-dialog"
      />
    </div>
  );
};

export default AdminProperties;
