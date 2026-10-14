import { useCallback, useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { axiosInstance } from '@/App';
import { apiErrorMessage, isEmailNotVerifiedError } from '@/components/account/errors';
import { ActionButton, ActionDialog, DataTable, Field, FilterSelect, Loading, NoteDialog, Pill, Section, daysSince, fmtDate, fmtEur, saleObjectLabel, today } from './shared';

// Onglet « Ventes » (SPEC §4.5) : GET /admin/closings, résolution d'une déclaration en attente ou contestée
// (PUT /admin/closings/{id}/resolve {action: 'confirm'|'cancel', note}) ; correction d'une vente confirmée dont la
// facture a été annulée par avoir (PUT /admin/closings/{id}/declaration {signed_on, final_price, sale_object, note} :
// une nouvelle facture est émise sous le numéro suivant).

// Correction de la déclaration (date, prix, objet) d'une vente confirmée sans facture active
export const CorrectDeclarationDialog = ({ open, onClose, closing, onConfirm }) => {
  const d = closing?.declaration || {};
  const [form, setForm] = useState({ signed_on: '', final_price: '', sale_object: '', note: '' });
  useEffect(() => {
    if (open) {
      setForm({ signed_on: d.signed_on || '', final_price: d.final_price != null ? String(d.final_price) : '', sale_object: d.sale_object || closing?.sale_object || '', note: '' });
    }
  }, [open]); // Réinitialisé à chaque ouverture (la vente ne change pas pendant la saisie)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const price = Number(String(form.final_price).replace(/\s/g, '').replace(',', '.'));
  const valid = !!form.signed_on && form.signed_on <= today() && price > 0 && ['titres', 'fonds'].includes(form.sale_object);
  return (
    <ActionDialog
      open={open}
      onClose={onClose}
      title="Corriger la déclaration de vente"
      description="La facture précédente a été annulée par avoir. La déclaration corrigée est conservée dans l'historique et une nouvelle facture est émise sous le numéro suivant, puis envoyée au cédant."
      confirmLabel="Corriger et émettre la facture"
      disabled={!valid}
      onConfirm={() => onConfirm({ signed_on: form.signed_on, final_price: price, sale_object: form.sale_object, note: form.note.trim() || null })}
      testId="correct-declaration-dialog"
    >
      <Field id="correct-signed-on" label="Date de signature de l'acte">
        <Input id="correct-signed-on" type="date" value={form.signed_on} max={today()} onChange={set('signed_on')} className="rounded-xl" data-testid="correct-signed-on" />
      </Field>
      <Field id="correct-price" label="Prix de cession définitif (euros)">
        <Input id="correct-price" type="number" min="1" step="1000" inputMode="decimal" value={form.final_price} onChange={set('final_price')} className="rounded-xl" data-testid="correct-price" />
      </Field>
      <Field id="correct-object" label="Objet de la cession">
        <select id="correct-object" value={form.sale_object} onChange={set('sale_object')} className="w-full rounded-xl border border-brand-line bg-white px-3 py-2 text-sm text-brand-navy" data-testid="correct-object">
          <option value="">Choisir…</option>
          <option value="titres">Cession de titres</option>
          <option value="fonds">Cession de fonds</option>
        </select>
      </Field>
      <Field id="correct-note" label="Note (facultative)">
        <Textarea id="correct-note" value={form.note} onChange={set('note')} rows={2} maxLength={2000} className="rounded-xl" data-testid="correct-note" />
      </Field>
    </ActionDialog>
  );
};

const STATUS_FILTERS = [
  { value: '', label: 'Toutes' },
  { value: 'declared', label: 'Déclarées, à confirmer' },
  { value: 'disputed', label: 'Contestées' },
  { value: 'in_progress', label: 'En cours' },
  { value: 'confirmed', label: 'Confirmées' },
  { value: 'abandoned', label: 'Abandonnées' },
];

const STATUS_INFO = {
  in_progress: { label: 'En cours', tone: 'info' },
  declared: { label: 'Déclarée, à confirmer', tone: 'warning' },
  confirmed: { label: 'Confirmée', tone: 'success' },
  disputed: { label: 'Contestée', tone: 'danger' },
  abandoned: { label: 'Abandonnée', tone: 'info' },
};

const PARTY = { seller: 'le cédant', buyer: 'le repreneur', admin: 'la plateforme' };

const REDACTEUR_TYPES = { notaire: 'Notaire', avocat: 'Avocat', 'expert-comptable': 'Expert-comptable', autre: 'Rédacteur' };

const redacteurText = (r) => {
  if (!r || !(r.name || r.email)) return 'Rédacteur d\'acte non renseigné';
  return [REDACTEUR_TYPES[r.type] || 'Rédacteur', r.name, r.email, r.phone].filter(Boolean).join(' · ');
};

const declarationText = (cl) => {
  const d = cl.declaration || cl.declared;
  if (!d) return '';
  const by = PARTY[d.by] || PARTY[d.declared_by] || 'une partie';
  return `Déclarée par ${by}${d.signed_on ? `, acte signé le ${fmtDate(d.signed_on)}` : ''}${d.final_price > 0 ? `, prix ${fmtEur(d.final_price)}` : ''}${d.sale_object ? ` (${saleObjectLabel(d.sale_object).toLowerCase()})` : ''}.`;
};

const AdminClosings = ({ focusId, onNavigate, onEmailBlocked }) => {
  const [status, setStatus] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(null); // {action: 'confirm'|'cancel', closing}
  const [correcting, setCorrecting] = useState(null); // closing à corriger (facture annulée par avoir)

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axiosInstance.get('/admin/closings', { params: status ? { status } : {} });
      setData(res.data?.closings || []);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Les étapes de vente n\'ont pas pu être chargées.'));
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { load(); }, [load]);

  const resolve = async (closing, action, note) => {
    try {
      await axiosInstance.put(`/admin/closings/${closing.id}/resolve`, { action, note: note || '' });
      toast.success(action === 'confirm' ? 'Vente confirmée : la facture d\'honoraires est émise.' : 'Déclaration annulée : l\'étape de vente revient « en cours ».');
      load();
    } catch (err) {
      if (isEmailNotVerifiedError(err)) onEmailBlocked?.();
      toast.error(apiErrorMessage(err));
      throw err;
    }
  };

  const correct = async (closing, body) => {
    try {
      const res = await axiosInstance.put(`/admin/closings/${closing.id}/declaration`, body);
      toast.success(`Déclaration corrigée : facture ${res?.data?.invoice?.number || res?.data?.invoice_number || ''} émise et envoyée au cédant.`.replace('  ', ' '));
      load();
    } catch (err) {
      if (isEmailNotVerifiedError(err)) onEmailBlocked?.();
      toast.error(apiErrorMessage(err));
      throw err;
    }
  };

  const columns = [
    { key: 'company', label: 'Annonce', primary: true, wide: true, render: (cl) => <span className="font-semibold text-brand-navy break-words">{cl.property_title || cl.property_label || 'Annonce'}</span> },
    {
      key: 'status',
      label: 'Statut',
      render: (cl) => {
        const s = STATUS_INFO[cl.status] || { label: cl.status_label || 'Statut inconnu', tone: 'info' };
        const days = cl.status === 'in_progress' ? daysSince(cl.accepted_at || cl.created_at) : null;
        return <span className="inline-flex flex-wrap items-center gap-1"><Pill tone={s.tone}>{s.label}</Pill>{days !== null && days > 60 && <span className="text-[13px] text-brand-amber">sans vente depuis {days} j</span>}</span>;
      },
    },
    { key: 'amount', label: 'Montant', align: 'right', render: (cl) => fmtEur(cl.declaration?.final_price || cl.declared?.final_price || cl.offer_amount) },
    { key: 'sale_object', label: 'Objet', render: (cl) => saleObjectLabel(cl.declaration?.sale_object || cl.sale_object) },
    { key: 'accepted_at', label: 'Offre acceptée le', nowrap: true, render: (cl) => fmtDate(cl.accepted_at || cl.created_at) },
    { key: 'expected_date', label: 'Acte prévu le', nowrap: true, render: (cl) => fmtDate(cl.expected_date) },
    {
      key: 'details',
      label: 'Détails',
      wide: true,
      render: (cl) => (
        <span className="block text-sm break-words">
          {declarationText(cl) && <span className="block">{declarationText(cl)}</span>}
          {cl.status === 'declared' && (cl.confirm_deadline || cl.declaration?.confirm_deadline) && (
            <span className="block text-[13px] text-gray-600">
              {(cl.declaration?.declared_by || cl.declaration?.by) === 'buyer'
                ? `Déclarée par le repreneur : pas de confirmation automatique (échéance ${fmtDate(cl.confirm_deadline || cl.declaration?.confirm_deadline)}, puis ligne « À faire »).`
                : `Confirmation automatique le ${fmtDate(cl.confirm_deadline || cl.declaration?.confirm_deadline)}.`}
            </span>
          )}
          {Array.isArray(cl.invoice_history) && cl.invoice_history.length > 0 && (
            <span className="block text-[13px] text-gray-600">Facture{cl.invoice_history.length > 1 ? 's' : ''} annulée{cl.invoice_history.length > 1 ? 's' : ''} par avoir : {cl.invoice_history.map((h) => h.number || h.invoice_number).filter(Boolean).join(', ') || cl.invoice_history.length}</span>
          )}
          {cl.dispute?.reason && <span className="block text-red-800">Contestation : {cl.dispute.reason}</span>}
          <span className="block text-[13px] text-gray-600">{redacteurText(cl.redacteur)}</span>
        </span>
      ),
    },
  ];

  const actions = (cl) => {
    const out = [];
    if (cl.status === 'declared' || cl.status === 'disputed') {
      out.push(<ActionButton key="confirm" tone="primary" onClick={() => setDialog({ action: 'confirm', closing: cl })} testId={`closing-confirm-${cl.id}`}>Confirmer la vente</ActionButton>);
      out.push(<ActionButton key="cancel" tone="danger" onClick={() => setDialog({ action: 'cancel', closing: cl })} testId={`closing-cancel-${cl.id}`}>Annuler la déclaration</ActionButton>);
    }
    if (cl.status === 'confirmed' && !cl.invoice_id) {
      out.push(<ActionButton key="correct" tone="primary" onClick={() => setCorrecting(cl)} testId={`closing-correct-${cl.id}`}>Corriger la déclaration</ActionButton>);
    }
    if (cl.invoice_id && onNavigate) out.push(<ActionButton key="invoice" onClick={() => onNavigate('invoices', { id: cl.invoice_id })} testId={`closing-invoice-${cl.id}`}>Facture</ActionButton>);
    return out;
  };

  return (
    <Section
      title="Étapes de vente"
      description="Créées à l'acceptation d'une offre ou par une vente directe ; déclaration par une partie, confirmation par l'autre sous 7 jours, sinon par la plateforme."
      actions={(
        <>
          <FilterSelect id="closings-filter" label="Afficher" value={status} onChange={setStatus} options={STATUS_FILTERS} testId="closings-filter" />
          <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={load} disabled={loading} aria-label="Actualiser les ventes">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          </Button>
        </>
      )}
      testId="admin-closings"
    >
      {loading && !data ? (
        <Loading label="Chargement des ventes…" />
      ) : (
        <DataTable
          columns={columns}
          rows={data || []}
          actions={actions}
          highlightId={focusId}
          emptyText={status ? 'Aucune vente dans ce statut.' : 'Aucune étape de vente pour le moment : la première est créée à l\'acceptation d\'une offre.'}
          testId="closings-table"
        />
      )}

      <NoteDialog
        open={!!dialog}
        onClose={() => setDialog(null)}
        title={dialog?.action === 'cancel' ? 'Annuler la déclaration de vente' : 'Confirmer la vente'}
        description={dialog?.action === 'cancel'
          ? `${dialog?.closing?.property_title || ''} : l'étape de vente revient « en cours », la déclaration est conservée dans l'historique.`
          : `${dialog?.closing?.property_title || ''} : la vente est confirmée au nom de la plateforme. La facture d'honoraires est émise et envoyée au cédant, l'ordre de paiement au rédacteur d'acte.`}
        confirmLabel={dialog?.action === 'cancel' ? 'Annuler la déclaration' : 'Confirmer la vente'}
        noteLabel="Note (facultative)"
        tone={dialog?.action === 'cancel' ? 'danger' : 'navy'}
        onConfirm={(note) => resolve(dialog.closing, dialog.action, note)}
        testId="closing-resolve-dialog"
      />
      <CorrectDeclarationDialog
        open={!!correcting}
        onClose={() => setCorrecting(null)}
        closing={correcting}
        onConfirm={(body) => correct(correcting, body)}
      />
    </Section>
  );
};

export default AdminClosings;
