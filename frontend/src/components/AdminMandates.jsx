import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { axiosInstance } from '@/App';
import { MANDATE_STATUS_LABELS, daysUntil, downloadMandatePdf } from '@/lib/mandate';
import { LISTING_STATUS } from '@/components/seller/listingStatus';
import { apiErrorMessage } from '@/components/account/errors';
import { ActionButton, DataTable, FilterSelect, Loading, Pill, Section, fmtDate } from '@/components/admin/shared';

// Registre des mandats (loi Hoguet, SPEC §7.2) : GET /admin/mandates (signés, dénoncés, rétractés, expirés, caducs),
// dates clés (signature, fin du délai de rétractation, échéance, clause de suite, fin effective), export CSV, PDF avec
// page de preuve. Une dénonciation dans les 14 jours suivant la signature est une rétractation (`withdrawn_retractation`).

// Libellés propres au mandat VenteLoc, en complément de lib/mandate (repli si une clé n'y figure pas)
export const MANDATE_LABELS = {
  pending_signature: 'À signer',
  signed: 'En cours',
  denounced: 'Résilié (préavis en cours)',
  withdrawn_retractation: 'Rétractation',
  expired: 'Expiré',
  void: 'Caduc',
  ...MANDATE_STATUS_LABELS,
};
export const mandateLabel = (status) => (status === 'withdrawn_retractation' ? 'Rétractation' : MANDATE_LABELS[status] || 'Statut inconnu');

const STATUS_FILTERS = [
  { value: 'all', label: 'Tous' },
  { value: 'signed', label: 'En cours' },
  { value: 'denounced', label: 'Résiliés (préavis)' },
  { value: 'withdrawn_retractation', label: 'Rétractations' },
  { value: 'expired', label: 'Expirés' },
  { value: 'void', label: 'Caducs' },
];

const STATUS_TONE = { signed: 'success', denounced: 'warning', withdrawn_retractation: 'warning', expired: 'info', void: 'danger', pending_signature: 'info' };

// Tri par numéro de registre (numérique si possible)
const byRegistry = (a, b) => String(a.registry_number || '').localeCompare(String(b.registry_number || ''), 'fr', { numeric: true });

// Phrase d'état : statut + date utile (échéance proche, fin effective, expiration)
export const statusText = (m) => {
  const label = mandateLabel(m.status);
  if (m.status === 'signed' && m.withdrawal_ends_at) {
    const left = daysUntil(m.withdrawal_ends_at);
    if (left !== null && left >= 0 && left <= 14) return `${label} · rétractation possible jusqu'au ${fmtDate(m.withdrawal_ends_at)}`;
  }
  if (m.status === 'signed' && m.ends_at) {
    const days = daysUntil(m.ends_at);
    return days !== null && days <= 30 ? `${label} · échéance dans ${Math.max(0, days)} j` : label;
  }
  if (m.status === 'withdrawn_retractation') return `${label}${m.effective_at ? ` le ${fmtDate(m.effective_at)}` : ''} · annonce dépubliée`;
  if (m.status === 'denounced' && m.effective_at) return `${label} · fin le ${fmtDate(m.effective_at)}`;
  if (m.status === 'expired' && m.ends_at) return `${label} le ${fmtDate(m.ends_at)}`;
  return label;
};

const AdminMandates = ({ focusId }) => {
  const [mandates, setMandates] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [filter, setFilter] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axiosInstance.get('/admin/mandates');
      setMandates([...(res.data?.mandates || [])].sort(byRegistry));
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Le registre des mandats n\'a pas pu être chargé.'));
      setMandates([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => (mandates || []).filter((m) => filter === 'all' || m.status === filter), [mandates, filter]);
  const counts = useMemo(() => (mandates || []).reduce((acc, m) => ({ ...acc, [m.status]: (acc[m.status] || 0) + 1 }), {}), [mandates]);

  // Téléchargement via axios (blob) pour conserver l'en-tête d'authentification
  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await axiosInstance.get('/admin/mandates/export.csv', { responseType: 'blob' });
      const disposition = res.headers?.['content-disposition'] || '';
      const match = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
      const filename = match ? decodeURIComponent(match[1]) : `registre-des-mandats-${new Date().toISOString().slice(0, 10)}.csv`;
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast.error('L\'export CSV n\'a pas pu être téléchargé. Réessayez dans quelques instants.');
    } finally {
      setExporting(false);
    }
  };

  const columns = [
    { key: 'registry_number', label: 'N° de registre', primary: true, nowrap: true, render: (m) => <span className="font-semibold text-brand-navy">{m.registry_number ? `N° ${m.registry_number}` : '—'}</span> },
    { key: 'signed_at', label: 'Signé le', nowrap: true, render: (m) => fmtDate(m.signed_at) },
    {
      key: 'property',
      label: 'Bien',
      wide: true,
      render: (m) => (
        <span className="block break-words">
          {m.property_label || '—'}
          {m.listing_status && LISTING_STATUS[m.listing_status] && <span className="block text-[13px] text-gray-600">Annonce : {LISTING_STATUS[m.listing_status].label.toLowerCase()}</span>}
        </span>
      ),
    },
    { key: 'seller_name', label: 'Vendeur', wide: true, render: (m) => <span className="break-words">{m.seller_name || '—'}</span> },
    { key: 'status', label: 'Statut', render: (m) => <Pill tone={STATUS_TONE[m.status] || 'info'} testId={`mandate-status-${m.id}`}>{statusText(m)}</Pill> },
    { key: 'ends_at', label: 'Échéance', nowrap: true, render: (m) => fmtDate(m.ends_at) },
    { key: 'tail_ends_at', label: 'Clause de suite', nowrap: true, render: (m) => fmtDate(m.tail_ends_at) },
    {
      key: 'terms_version',
      label: 'Version',
      render: (m) => (
        <span className="block">
          {m.terms_version ? `Mandat simple ${m.terms_version}` : 'Version non renseignée'}
          {m.renewals > 0 && <span className="block text-[13px] text-gray-600">{m.renewals} prolongation{m.renewals > 1 ? 's' : ''}</span>}
        </span>
      ),
    },
    { key: 'contract_number', label: 'N° de contrat', nowrap: true, render: (m) => <span className="text-gray-600">{m.contract_number || '—'}</span> },
  ];

  const actions = (m) => [
    <ActionButton key="pdf" onClick={() => downloadMandatePdf(m.id)} testId={`mandate-pdf-${m.id}`}>PDF</ActionButton>,
  ];

  const summary = ['signed', 'denounced', 'withdrawn_retractation', 'expired', 'void'].filter((s) => counts[s] > 0).map((s) => `${counts[s]} ${mandateLabel(s).toLowerCase()}${s === 'withdrawn_retractation' && counts[s] > 1 ? 's' : ''}`).join(' · ');

  return (
    <Section
      title="Registre des mandats"
      description={summary ? `Registre continu par numéro d'ordre : ${summary}.` : 'Registre continu par numéro d\'ordre (obligation carte T).'}
      actions={(
        <>
          <FilterSelect id="mandates-filter" label="Afficher" value={filter} onChange={setFilter} options={STATUS_FILTERS} testId="mandates-filter" />
          <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={load} disabled={loading} aria-label="Actualiser le registre">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          </Button>
          <Button type="button" size="sm" className="rounded-xl bg-brand-teal hover:bg-brand-teal-dark text-white" onClick={exportCsv} disabled={exporting || !mandates?.length} data-testid="export-mandates">
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Download className="w-4 h-4" aria-hidden="true" />}
            Exporter en CSV
          </Button>
        </>
      )}
      testId="admin-mandates"
    >
      {loading && !mandates ? (
        <Loading label="Chargement du registre…" />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          actions={actions}
          highlightId={focusId}
          emptyText={mandates?.length ? 'Aucun mandat dans ce statut.' : 'Aucun mandat signé pour le moment.'}
          testId="mandates-table"
        />
      )}
    </Section>
  );
};

export default AdminMandates;
