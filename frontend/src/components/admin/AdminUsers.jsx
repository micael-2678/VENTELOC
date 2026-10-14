import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Search, Users } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { axiosInstance } from '@/App';
import { buyerProjectTypeLabel, financingTypeLabel, propertyTypeLabel } from '@/lib/referentiels';
import { horizonLabel } from '@/components/account/profileScore';
import { apiErrorMessage, isEmailNotVerifiedError } from '@/components/account/errors';
import { ActionButton, ActionDialog, EmptyState, FilterSelect, Loading, Pill, displayName, fmtDate, fmtEur, identityInfo, roleLabel } from './shared';

// Onglet « Utilisateurs » : GET /admin/users (rôle, e-mail confirmé, identité, score du profil acquéreur),
// PUT /admin/kyc/{id}/validate (identité marquée vérifiée par l'administrateur, repli du parcours Stripe).

const ROLE_FILTERS = [
  { value: 'all', label: 'Tous les comptes' },
  { value: 'seller', label: 'Vendeurs' },
  { value: 'buyer', label: 'Acquéreurs' },
  { value: 'unverified_email', label: 'E-mail non confirmé' },
  { value: 'identity_pending', label: 'Identité à vérifier' },
  { value: 'admin', label: 'Administrateurs' },
];

const inFilter = (u, filter) => {
  switch (filter) {
    case 'all': return true;
    case 'unverified_email': return u.email_verified === false;
    case 'identity_pending': return !(u.identity_verified || u.kyc_status === 'verified') && u.role !== 'admin';
    default: return u.role === filter;
  }
};

const matches = (u, q) => {
  if (!q) return true;
  const hay = [displayName(u), u.email, u.phone, u.company_name, u.siret, u.buyer_profile?.company_name].map((s) => String(s || '').toLowerCase()).join(' ');
  return hay.includes(q.toLowerCase());
};

// Profil d'investisseur de l'acquéreur en une phrase (jamais de valeur brute)
export const buyerSummary = (u) => {
  const p = u.buyer_profile || {};
  const parts = [];
  if (buyerProjectTypeLabel(p.project_type)) parts.push(buyerProjectTypeLabel(p.project_type));
  if (p.budget_max > 0) parts.push(`budget ${fmtEur(p.budget_max)}`);
  if (p.apport > 0) parts.push(`apport ${fmtEur(p.apport)}`);
  if (financingTypeLabel(p.financing)) parts.push(financingTypeLabel(p.financing).toLowerCase());
  if (Array.isArray(p.property_types) && p.property_types.length) parts.push(p.property_types.map((t) => propertyTypeLabel(t, true) || t).join(', '));
  if (Array.isArray(p.zones) && p.zones.length) parts.push(p.zones.join(', '));
  if (Number(p.min_yield) > 0) parts.push(`rendement ≥ ${String(p.min_yield).replace('.', ',')} %`);
  if (horizonLabel(p.horizon)) parts.push(horizonLabel(p.horizon).toLowerCase());
  if (p.siren_verified) parts.push('société vérifiée');
  return parts.join(' · ');
};

const AdminUsers = ({ users, loading, onReload, focusId, onEmailBlocked }) => {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState(null);
  const [busy, setBusy] = useState('');

  const rows = useMemo(() => (users || []).filter((u) => !u.deleted_at && inFilter(u, filter) && matches(u, query)), [users, filter, query]);

  const markVerified = async (u) => {
    setBusy(u.id);
    try {
      await axiosInstance.put(`/admin/kyc/${u.id}/validate`, null, { params: { status: 'verified' } });
      toast.success(`Identité de ${displayName(u)} marquée comme vérifiée.`);
      onReload?.();
    } catch (err) {
      if (isEmailNotVerifiedError(err)) onEmailBlocked?.();
      toast.error(apiErrorMessage(err));
      throw err;
    } finally {
      setBusy('');
    }
  };

  if (loading && !users) return <Loading label="Chargement des comptes…" />;

  return (
    <div className="space-y-4" data-testid="admin-users">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <h2 className="font-display text-xl sm:text-2xl font-bold text-brand-navy mr-auto">Utilisateurs</h2>
        <FilterSelect id="users-filter" label="Afficher" value={filter} onChange={setFilter} options={ROLE_FILTERS} testId="users-filter" />
        <label htmlFor="users-search" className="relative block sm:w-72">
          <span className="sr-only">Rechercher un compte</span>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" aria-hidden="true" />
          <Input id="users-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nom, e-mail, société…" className="pl-9 rounded-xl" data-testid="users-search" />
        </label>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={Users}>{users?.length ? 'Aucun compte ne correspond à ce filtre.' : 'Aucun compte pour le moment.'}</EmptyState>
      ) : (
        <ul className="space-y-3">
          {rows.map((u) => {
            const identity = identityInfo(u);
            const verified = identity.tone === 'success';
            const summary = u.role === 'buyer' ? buyerSummary(u) : '';
            return (
              <li key={u.id} className={`rounded-2xl bg-white border p-4 sm:p-5 min-w-0 ${focusId === u.id ? 'border-brand-blue ring-2 ring-brand-blue' : 'border-brand-line'}`} data-testid={`user-${u.id}`}>
                <div className="flex flex-col sm:flex-row sm:items-start gap-3 min-w-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-brand-navy break-words">{displayName(u)}</h3>
                      <Pill tone={u.role === 'admin' ? 'navy' : 'info'}>{roleLabel(u.role)}</Pill>
                      <Pill tone={u.email_verified === false ? 'warning' : 'success'}>{u.email_verified === false ? 'E-mail non confirmé' : 'E-mail confirmé'}</Pill>
                      <Pill tone={identity.tone} testId={`user-identity-${u.id}`}>{identity.label}</Pill>
                    </div>
                    <p className="text-sm text-gray-700 mt-1 break-words">
                      {[u.email, u.phone, u.company_name, u.siret ? `SIRET ${u.siret}` : ''].filter(Boolean).join(' · ')}
                    </p>
                    {u.role === 'buyer' && (
                      <p className="text-sm text-gray-700 mt-1 break-words">
                        {u.profile_score > 0 ? `Profil acquéreur complet à ${Math.round(u.profile_score)} %` : 'Profil acquéreur non renseigné'}
                        {summary ? ` · ${summary}` : ''}
                      </p>
                    )}
                    <p className="text-[13px] text-gray-600 mt-1">Inscrit le {fmtDate(u.created_at)}</p>
                  </div>
                  {!verified && u.role !== 'admin' && (
                    <div className="shrink-0">
                      <ActionButton tone="primary" busy={busy === u.id} onClick={() => setTarget(u)} testId={`user-verify-${u.id}`}>Marquer l'identité vérifiée</ActionButton>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ActionDialog
        open={!!target}
        onClose={() => setTarget(null)}
        title="Marquer l'identité comme vérifiée"
        description={target ? `${displayName(target)} (${target.email}) : vous attestez avoir vérifié son identité par un autre moyen. Ses brouillons d'annonce seront soumis à publication automatiquement.` : ''}
        confirmLabel="Marquer vérifiée"
        onConfirm={() => markVerified(target)}
        testId="verify-dialog"
      />
    </div>
  );
};

export default AdminUsers;
