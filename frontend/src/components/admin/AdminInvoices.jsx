import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { axiosInstance } from '@/App';
import { downloadPdf } from '@/lib/mandate';
import { apiErrorMessage, isEmailNotVerifiedError } from '@/components/account/errors';
import { ActionButton, DataTable, FilterSelect, Loading, NoteDialog, PaidDialog, Pill, Section, fmtDate, fmtEurCents, saleObjectLabel } from './shared';

// Onglet « Factures » (SPEC §4.5, API.md §7) : GET /admin/invoices, encaissement total ou acompte {paid_on, amount},
// annuler {reason} (un avoir AV-… est émis : GET /invoices/{id}/avoir.pdf), PDF de la facture, modèle de mise en demeure.

const STATUS_FILTERS = [
  { value: '', label: 'Toutes' },
  { value: 'issued', label: 'Émises (à encaisser)' },
  { value: 'overdue', label: 'En retard' },
  { value: 'paid', label: 'Payées' },
  { value: 'cancelled', label: 'Annulées' },
  { value: 'draft', label: 'Brouillons (anciennes)' },
];

export const invoiceStatus = (inv) => {
  if (inv.status === 'paid') return { label: 'Payée', tone: 'success' };
  if (inv.status === 'cancelled') return { label: 'Annulée', tone: 'info' };
  if (inv.status === 'draft') return { label: 'Brouillon', tone: 'info' };
  if (inv.overdue || inv.status === 'overdue') return { label: 'En retard', tone: 'danger' };
  return { label: 'Émise', tone: 'warning' };
};

const debtorText = (inv) => {
  const d = inv.debtor || {};
  return [d.name, d.company, d.siren ? `SIREN ${d.siren}` : ''].filter(Boolean).join(' · ') || 'Débiteur non renseigné';
};

const AdminInvoices = ({ focusId, onEmailBlocked }) => {
  const [status, setStatus] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(null); // {kind: 'paid'|'cancel', invoice}

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axiosInstance.get('/admin/invoices', { params: status ? { status } : {} });
      setData(res.data || { invoices: [], totals: {} });
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Les factures n\'ont pas pu être chargées.'));
      setData({ invoices: [], totals: {} });
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { load(); }, [load]);

  const markPaid = async (invoice, body) => {
    try {
      const res = await axiosInstance.put(`/admin/invoices/${invoice.id}/paid`, body);
      const saved = res?.data || {};
      toast.success(saved.status === 'paid' || saved.status == null
        ? `Facture ${invoice.number} marquée comme payée.`
        : `Acompte enregistré sur la facture ${invoice.number} : reste dû ${fmtEurCents(saved.balance_due)} TTC.`);
      load();
    } catch (err) {
      if (isEmailNotVerifiedError(err)) onEmailBlocked?.();
      toast.error(apiErrorMessage(err));
      throw err;
    }
  };

  const cancel = async (invoice, reason) => {
    try {
      await axiosInstance.put(`/admin/invoices/${invoice.id}/cancel`, { reason });
      toast.success(`Facture ${invoice.number} annulée : un avoir est émis et envoyé au cédant.`);
      load();
    } catch (err) {
      if (isEmailNotVerifiedError(err)) onEmailBlocked?.();
      toast.error(apiErrorMessage(err));
      throw err;
    }
  };

  const invoices = data?.invoices || [];
  const totals = data?.totals || {};
  const totalChips = [];
  if (totals.issued_ht > 0) totalChips.push(<Pill key="issued" tone="info">Facturé : {fmtEurCents(totals.issued_ht)} HT</Pill>);
  if (totals.paid_ht > 0) totalChips.push(<Pill key="paid" tone="success">Encaissé : {fmtEurCents(totals.paid_ht)} HT</Pill>);
  if (totals.overdue_ttc > 0) totalChips.push(<Pill key="overdue" tone="danger">En retard : {fmtEurCents(totals.overdue_ttc)} TTC</Pill>);

  const columns = [
    { key: 'number', label: 'N°', primary: true, nowrap: true, render: (inv) => <span className="font-semibold text-brand-navy">{inv.number || '—'}</span> },
    { key: 'debtor', label: 'Débiteur', wide: true, render: (inv) => <span className="break-words">{debtorText(inv)}</span> },
    { key: 'company', label: 'Annonce', wide: true, render: (inv) => <span className="break-words">{inv.company_label || inv.company_title || '—'}{inv.sale_object ? ` · ${saleObjectLabel(inv.sale_object)}` : ''}</span> },
    { key: 'issued_on', label: 'Émise le', nowrap: true, render: (inv) => fmtDate(inv.issued_on) },
    { key: 'due_on', label: 'Échéance', nowrap: true, render: (inv) => fmtDate(inv.due_on) },
    { key: 'total_ht', label: 'HT', align: 'right', render: (inv) => fmtEurCents(inv.total_ht) },
    { key: 'total_ttc', label: 'TTC', align: 'right', render: (inv) => fmtEurCents(inv.total_ttc) },
    {
      key: 'status',
      label: 'Statut',
      render: (inv) => {
        const s = invoiceStatus(inv);
        const extra = inv.status === 'paid' && inv.paid_on ? ` le ${fmtDate(inv.paid_on)}` : '';
        const reminders = Array.isArray(inv.reminders) && inv.reminders.length ? ` · ${inv.reminders.length} relance${inv.reminders.length > 1 ? 's' : ''}` : '';
        const partial = inv.status !== 'paid' && Number(inv.paid_amount) > 0
          ? `Acompte ${fmtEurCents(inv.paid_amount)} · reste ${fmtEurCents(inv.balance_due)}` : '';
        const credit = inv.status === 'cancelled' && inv.credit_note?.number ? `Avoir ${inv.credit_note.number}` : '';
        return (
          <span className="inline-flex flex-wrap items-center gap-1">
            <Pill tone={s.tone}>{s.label}{extra}</Pill>
            {partial && <span className="text-[13px] text-gray-700" data-testid={`invoice-partial-${inv.id}`}>{partial}</span>}
            {credit && <span className="text-[13px] text-gray-700">{credit}</span>}
            {reminders && <span className="text-[13px] text-gray-600">{reminders}</span>}
          </span>
        );
      },
    },
  ];

  const actions = (inv) => {
    const out = [];
    if (inv.status !== 'draft') out.push(<ActionButton key="pdf" onClick={() => downloadPdf(inv.pdf_url || `/api/invoices/${inv.id}/pdf`, `${inv.number || 'facture'}.pdf`)} testId={`invoice-pdf-${inv.id}`}>PDF</ActionButton>);
    if (inv.status === 'issued' || inv.status === 'overdue') {
      out.push(<ActionButton key="paid" tone="primary" onClick={() => setDialog({ kind: 'paid', invoice: inv })} testId={`invoice-paid-${inv.id}`}>Marquer payée</ActionButton>);
      if (inv.overdue || inv.status === 'overdue' || inv.formal_notice_url) {
        out.push(<ActionButton key="notice" onClick={() => downloadPdf(inv.formal_notice_url || `/api/admin/invoices/${inv.id}/mise-en-demeure.pdf`, `mise-en-demeure-${inv.number || inv.id}.pdf`)} testId={`invoice-notice-${inv.id}`}>Mise en demeure</ActionButton>);
      }
    }
    if (inv.status === 'cancelled' && inv.credit_note?.number) {
      out.push(<ActionButton key="avoir" onClick={() => downloadPdf(`/api/invoices/${inv.id}/avoir.pdf`, `${inv.credit_note.number}.pdf`)} testId={`invoice-credit-${inv.id}`}>Avoir (PDF)</ActionButton>);
    }
    // Une facture avec acompte ne s'annule plus (le serveur refuse) : solder ou corriger par avoir après remboursement
    if (inv.status !== 'paid' && inv.status !== 'cancelled' && !(Number(inv.paid_amount) > 0)) out.push(<ActionButton key="cancel" tone="danger" onClick={() => setDialog({ kind: 'cancel', invoice: inv })} testId={`invoice-cancel-${inv.id}`}>Annuler</ActionButton>);
    return out;
  };

  return (
    <Section
      title="Factures d'honoraires"
      description="Émises à la confirmation d'une vente ; relances automatiques, puis modèle de mise en demeure après la troisième."
      actions={(
        <>
          <FilterSelect id="invoices-filter" label="Afficher" value={status} onChange={setStatus} options={STATUS_FILTERS} testId="invoices-filter" />
          <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={load} disabled={loading} aria-label="Actualiser les factures">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          </Button>
        </>
      )}
      testId="admin-invoices"
    >
      {totalChips.length > 0 && <div className="flex flex-wrap gap-2 mb-4">{totalChips}</div>}
      {loading && !data ? (
        <Loading label="Chargement des factures…" />
      ) : (
        <DataTable
          columns={columns}
          rows={invoices}
          actions={actions}
          highlightId={focusId}
          emptyText={status ? 'Aucune facture dans ce statut.' : 'Aucune facture émise pour le moment : la première est créée à la confirmation d\'une vente.'}
          testId="invoices-table"
        />
      )}
      <PaidDialog
        open={dialog?.kind === 'paid'}
        onClose={() => setDialog(null)}
        invoice={dialog?.invoice}
        onConfirm={(body) => markPaid(dialog.invoice, body)}
      />
      <NoteDialog
        open={dialog?.kind === 'cancel'}
        onClose={() => setDialog(null)}
        title={`Annuler la facture ${dialog?.invoice?.number || ''}`}
        description="La facture reste au registre avec la mention « annulée » et le motif ; un avoir (AV-…) est émis et envoyé au cédant, les relances s'arrêtent. Pour corriger le prix ou la date, utilisez ensuite « Corriger la déclaration » dans l'onglet Ventes : une nouvelle facture est émise."
        confirmLabel="Annuler la facture"
        noteLabel="Motif d'annulation"
        required
        tone="danger"
        onConfirm={(reason) => cancel(dialog.invoice, reason)}
        testId="cancel-invoice-dialog"
      />
    </Section>
  );
};

export default AdminInvoices;
