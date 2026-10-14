import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertCircle, CheckCircle2, FileText, Loader2, Pencil, Receipt, Scale, ShieldAlert } from 'lucide-react';
import { axiosInstance } from '@/App';
import { Checklist } from '@/components/shared';
import { formatPrice, formatDateFr } from '@/components/shared/formatters';
import { Field, NumberInput, TextInput, SelectInput } from '@/components/seller/FormFields';
import ConfirmDialog from '@/components/seller/ConfirmDialog';
import { apiErrorMessage } from '@/components/account/errors';
import { downloadPdf } from '@/lib/mandate';
import { commissionLabel, OFFER } from '@/lib/offer';
import { cn } from '@/lib/utils';

// Étape de vente (SPEC §4.5, API.md §7), vue commune au cédant et au repreneur.
// Props : closing (vue GET /closing/{id} : role, status, status_label, redacteur, declaration, invoice, commission_preview…),
// user, onChange(closing) appelé après chaque action avec la vue renvoyée par le serveur.

export const REDACTEUR_TYPES = [
  { value: 'notaire', label: 'Notaire' },
  { value: 'avocat', label: 'Avocat' },
  { value: 'expert-comptable', label: 'Expert-comptable' },
  { value: 'autre', label: 'Autre rédacteur' },
];
const REDACTEUR_LABEL = REDACTEUR_TYPES.reduce((acc, t) => { acc[t.value] = t.label; return acc; }, {});

export const SALE_OBJECTS = [
  { value: 'titres', label: 'Cession de titres (parts ou actions)' },
  { value: 'fonds', label: 'Cession du fonds de commerce' },
];
const SALE_OBJECT_LABEL = { titres: 'Cession de titres', fonds: 'Cession du fonds de commerce', indifferent: 'Titres ou fonds' };

const STATUS_TONE = { in_progress: 'badge-info', declared: 'badge-warning', confirmed: 'badge-success', disputed: 'badge-danger', abandoned: 'badge-info' };
const STATUS_LABEL = {
  in_progress: 'Vente en cours',
  declared: 'Vente déclarée, en attente de confirmation',
  confirmed: 'Vente confirmée',
  disputed: 'Déclaration contestée',
  abandoned: 'Vente abandonnée',
};
export const closingStatusLabel = (closing) => closing?.status_label || STATUS_LABEL[closing?.status] || String(closing?.status || '');

const PARTY = { seller: 'le cédant', buyer: 'le repreneur', admin: 'la plateforme' };
const isoToday = () => new Date().toISOString().slice(0, 10);
const num = (v) => {
  const n = Number(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

// Une déclaration du repreneur n'est jamais confirmée automatiquement : il faut l'accord du cédant (pas de facture
// ni d'annonce « vendue » sans lui). Celle du cédant (ou de la plateforme) l'est après 7 jours sans réponse.
export const autoConfirms = (declaration) => (declaration?.declared_by || '') !== 'buyer';
const deadlineSentence = (d) => (autoConfirms(d)
  ? 'sans réponse, la vente est confirmée automatiquement.'
  : 'la vente n\'est confirmée qu\'avec l\'accord du cédant.');

// Phrase d'état lisible selon le statut et le rôle
export const closingSentence = (closing, role) => {
  const c = closing || {};
  const d = c.declaration || {};
  const other = role === 'seller' ? PARTY.buyer : PARTY.seller;
  switch (c.status) {
    case 'in_progress':
      return `Offre acceptée${c.accepted_at ? ` le ${formatDateFr(c.accepted_at)}` : ''}. Financement, audit et rédaction de l'acte se déroulent entre vous et ${other}, avec vos conseils. Déclarez la vente ici dès la signature de l'acte.`;
    case 'declared':
      return d.declared_by === role
        ? `Vous avez déclaré la vente (acte du ${formatDateFr(d.signed_on)}, ${formatPrice(d.final_price)}). ${other.charAt(0).toUpperCase() + other.slice(1)} a jusqu'au ${formatDateFr(d.confirm_deadline)} pour confirmer ; ${deadlineSentence(d)}`
        : `${d.declared_by === 'admin' ? 'La plateforme' : other.charAt(0).toUpperCase() + other.slice(1)} a déclaré la vente (acte du ${formatDateFr(d.signed_on)}, ${formatPrice(d.final_price)}). Confirmez ou contestez avant le ${formatDateFr(d.confirm_deadline)} ; ${deadlineSentence(d)}`;
    case 'confirmed':
      return `Vente confirmée${c.confirmed_at ? ` le ${formatDateFr(c.confirmed_at)}` : ''}${d.signed_on ? ` (acte du ${formatDateFr(d.signed_on)}, ${formatPrice(d.final_price)})` : ''}. ${role === 'seller' ? 'La facture d\'honoraires est disponible ci-dessous.' : 'La commission est à la charge du cédant : rien ne vous est demandé.'}`;
    case 'disputed':
      return `La déclaration a été contestée${c.dispute?.by ? ` par ${PARTY[c.dispute.by] || c.dispute.by}` : ''}. La plateforme examine le dossier et revient vers les deux parties.`;
    case 'abandoned':
      return 'Cette vente a été abandonnée. L\'annonce reste en ligne côté cédant.';
    default:
      return closingStatusLabel(c);
  }
};

const RedacteurForm = ({ closing, onSaved, onCancel }) => {
  const idp = useId();
  const r = closing.redacteur || {};
  const [form, setForm] = useState({ type: r.type || '', name: r.name || '', email: r.email || '', phone: r.phone || '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!form.type) errs.type = 'Choisissez le type de rédacteur.';
    if (form.name.trim().length < 2) errs.name = 'Indiquez le nom de l\'étude ou du cabinet.';
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) errs.email = 'Adresse e-mail invalide.';
    setErrors(errs);
    if (Object.keys(errs).length || saving) return;
    setSaving(true);
    setError('');
    try {
      const res = await axiosInstance.put(`/closing/${closing.id}/redacteur`, {
        type: form.type, name: form.name.trim(), email: form.email.trim() || null, phone: form.phone.trim() || null,
      });
      toast.success('Rédacteur de l\'acte enregistré. L\'autre partie est prévenue.');
      await onSaved(res.data);
    } catch (err) {
      setError(apiErrorMessage(err, 'Le rédacteur n\'a pas pu être enregistré.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4 min-w-0" data-testid="redacteur-form">
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Type" required error={errors.type} htmlFor={`${idp}-type`}>
          {(p) => <SelectInput value={form.type} onChange={set('type')} options={REDACTEUR_TYPES} testId="redacteur-type" {...p} />}
        </Field>
        <Field label="Nom (étude, cabinet)" required error={errors.name} htmlFor={`${idp}-name`}>
          {(p) => <TextInput value={form.name} onChange={set('name')} maxLength={200} testId="redacteur-name" {...p} />}
        </Field>
        <Field label="E-mail" optional error={errors.email} hint="Pour lui adresser l'ordre de paiement de la commission à la signature." htmlFor={`${idp}-email`}>
          {(p) => <TextInput type="email" value={form.email} onChange={set('email')} maxLength={200} testId="redacteur-email" {...p} />}
        </Field>
        <Field label="Téléphone" optional htmlFor={`${idp}-phone`}>
          {(p) => <TextInput type="tel" value={form.phone} onChange={set('phone')} maxLength={40} testId="redacteur-phone" {...p} />}
        </Field>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-primary px-4 py-2.5 text-sm" disabled={saving} data-testid="redacteur-submit">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Scale className="w-4 h-4" aria-hidden="true" />}
          Enregistrer
        </button>
        {typeof onCancel === 'function' && <button type="button" onClick={onCancel} className="btn-secondary px-4 py-2.5 text-sm">Annuler</button>}
      </div>
    </form>
  );
};

const DeclareForm = ({ closing, role, onSaved, onCancel }) => {
  const idp = useId();
  const d = closing.declaration || {};
  const [form, setForm] = useState({
    signed_on: d.signed_on || isoToday(),
    final_price: d.final_price != null ? String(d.final_price) : (closing.offer_amount != null ? String(closing.offer_amount) : ''),
    sale_object: d.sale_object || (closing.sale_object === 'fonds' ? 'fonds' : closing.sale_object === 'titres' ? 'titres' : ''),
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const price = num(form.final_price);

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!form.signed_on || form.signed_on > isoToday()) errs.signed_on = 'Indiquez la date de signature de l\'acte (pas dans le futur).';
    if (!(price > 0)) errs.final_price = 'Indiquez le prix de cession définitif.';
    if (!form.sale_object) errs.sale_object = 'Précisez l\'objet de la cession.';
    setErrors(errs);
    if (Object.keys(errs).length || saving) return;
    setSaving(true);
    setError('');
    try {
      const res = await axiosInstance.post(`/closing/${closing.id}/declare`, { signed_on: form.signed_on, final_price: price, sale_object: form.sale_object });
      toast.success('Vente déclarée. L\'autre partie est invitée à confirmer sous 7 jours.', { duration: 8000 });
      await onSaved(res.data);
    } catch (err) {
      setError(apiErrorMessage(err, 'La déclaration n\'a pas pu être enregistrée.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4 min-w-0" data-testid="declare-form">
      <div className="grid sm:grid-cols-3 gap-4">
        <Field label="Date de signature de l'acte" required error={errors.signed_on} htmlFor={`${idp}-date`}>
          {(p) => <TextInput type="date" value={form.signed_on} onChange={set('signed_on')} testId="declare-date" {...p} />}
        </Field>
        <Field label="Prix de cession définitif" required error={errors.final_price} htmlFor={`${idp}-price`}>
          {(p) => <NumberInput value={form.final_price} onChange={set('final_price')} min={1} step={1000} testId="declare-price" {...p} />}
        </Field>
        <Field label="Objet" required error={errors.sale_object} htmlFor={`${idp}-object`}>
          {(p) => <SelectInput value={form.sale_object} onChange={set('sale_object')} options={SALE_OBJECTS} testId="declare-object" {...p} />}
        </Field>
      </div>
      {role === 'seller' && price > 0 && (
        <p className="text-sm text-gray-700 rounded-xl bg-brand-surface border border-brand-line px-4 py-3 tabular" data-testid="declare-commission">
          Commission d&apos;intermédiation sur ce prix : <strong className="text-brand-navy">{commissionLabel(price)}</strong>, facturée à la confirmation de la vente, {form.sale_object === 'fonds' ? 'payable par le séquestre à la libération du prix (au plus tard 180 jours après l\'acte)' : 'payable sous 30 jours'}.
        </p>
      )}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-primary px-4 py-2.5 text-sm" disabled={saving} data-testid="declare-submit">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="w-4 h-4" aria-hidden="true" />}
          Déclarer la vente
        </button>
        {typeof onCancel === 'function' && <button type="button" onClick={onCancel} className="btn-secondary px-4 py-2.5 text-sm">Annuler</button>}
      </div>
    </form>
  );
};

const InvoiceCard = ({ closing, role }) => {
  const inv = closing.invoice;
  if (!inv) return null;
  const isDebtor = role === 'seller' || role === 'admin';
  const statusLabel = inv.status === 'paid' ? 'Réglée' : inv.status === 'cancelled' ? 'Annulée' : inv.status === 'overdue' ? 'En retard de paiement' : 'Émise';
  return (
    <section className="card p-5 sm:p-6 min-w-0" aria-labelledby="invoice-title" data-testid="invoice-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id="invoice-title" className="font-display text-lg font-bold text-brand-navy flex items-center gap-2"><Receipt className="w-5 h-5 text-gray-500" aria-hidden="true" />Facture d&apos;honoraires</h3>
        <span className={cn('badge', inv.status === 'paid' ? 'badge-success' : inv.status === 'overdue' ? 'badge-danger' : 'badge-info')}>{statusLabel}</span>
      </div>
      {isDebtor ? (
        <>
          <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-sm">
            <div className="min-w-0"><dt className="text-xs text-gray-500">Numéro</dt><dd className="font-semibold text-brand-navy break-words">{inv.number}</dd></div>
            <div className="min-w-0"><dt className="text-xs text-gray-500">Montant HT</dt><dd className="font-semibold text-brand-navy tabular">{formatPrice(inv.total_ht)}</dd></div>
            <div className="min-w-0"><dt className="text-xs text-gray-500">TVA</dt><dd className="text-gray-800 tabular">{formatPrice(inv.vat)}</dd></div>
            <div className="min-w-0"><dt className="text-xs text-gray-500">Montant TTC</dt><dd className="font-semibold text-brand-navy tabular">{formatPrice(inv.total_ttc)}</dd></div>
            <div className="min-w-0 col-span-2"><dt className="text-xs text-gray-500">Échéance</dt><dd className="text-gray-800">{formatDateFr(inv.due_on)}{inv.payment_terms ? ` · ${inv.payment_terms}` : ''}</dd></div>
            {inv.paid_on && <div className="min-w-0 col-span-2"><dt className="text-xs text-gray-500">Réglée le</dt><dd className="text-gray-800">{formatDateFr(inv.paid_on)}</dd></div>}
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => downloadPdf(`/invoices/${inv.id}/pdf`, `${inv.number || 'facture'}.pdf`)} className="btn-primary px-4 py-2 text-sm" data-testid="invoice-pdf-btn">
              <FileText className="w-4 h-4" aria-hidden="true" />
              Facture (PDF)
            </button>
            <button type="button" onClick={() => downloadPdf(`/closing/${closing.id}/payment-order.pdf`, 'ordre-de-paiement.pdf')} className="btn-secondary px-4 py-2 text-sm" data-testid="payment-order-btn">
              <FileText className="w-4 h-4" aria-hidden="true" />
              Ordre de paiement pour le rédacteur
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-3 leading-relaxed">Conformément au mandat, le rédacteur de l&apos;acte règle la commission sur le prix de cession. Aucune somme n&apos;est due avant la signature de l&apos;acte.</p>
        </>
      ) : (
        <p className="text-sm text-gray-700 mt-2">{OFFER.payerSentence}</p>
      )}
    </section>
  );
};

const ClosingPanel = ({ closing, user, onChange }) => {
  const [editingRedacteur, setEditingRedacteur] = useState(false);
  const [declaring, setDeclaring] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [disputing, setDisputing] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');
  const [busy, setBusy] = useState(false);
  const c = closing || {};
  const role = c.role || (user?.id === c.seller_id ? 'seller' : user?.id === c.buyer_id ? 'buyer' : user?.role === 'admin' ? 'admin' : 'buyer');
  const d = c.declaration || null;
  const closed = c.status === 'confirmed' || c.status === 'abandoned';
  // Vente contestée : seule la partie qui a contesté peut déclarer sa version (l'admin arbitre sinon)
  const canDeclare = !closed && (c.status === 'in_progress' || (c.status === 'disputed' && (c.dispute?.by === role || role === 'admin'))
    || (c.status === 'declared' && d?.declared_by === role));
  // Rédacteur : modifiable jusqu'à la confirmation ; ensuite, par le cédant (ou l'admin) tant que l'ordre de paiement n'est pas parti
  const sellerSide = role === 'seller' || role === 'admin';
  const redacteurEditable = !closed || (c.status === 'confirmed' && sellerSide && !c.payment_order_sent_at);
  const mustAnswer = c.status === 'declared' && d && d.declared_by !== role;
  const otherName = role === 'seller' ? c.buyer_name : c.seller_name;

  const apply = async (data) => {
    if (typeof onChange === 'function') await onChange(data && data.id ? data : null);
  };

  const confirm = async () => {
    try {
      const res = await axiosInstance.post(`/closing/${c.id}/confirm`);
      setConfirming(false);
      toast.success('Vente confirmée.');
      await apply(res.data);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'La confirmation n\'a pas pu être enregistrée.'));
      throw err;
    }
  };

  const dispute = async () => {
    if (disputeReason.trim().length < 5 || busy) return;
    setBusy(true);
    try {
      const res = await axiosInstance.post(`/closing/${c.id}/dispute`, { reason: disputeReason.trim() });
      setDisputing(false);
      toast.success('Contestation enregistrée : la plateforme examine le dossier.');
      await apply(res.data);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'La contestation n\'a pas pu être enregistrée.'));
    } finally {
      setBusy(false);
    }
  };

  const items = [
    { id: 'offer', label: c.offer_id ? 'Offre acceptée et contresignée' : 'Repreneur présenté, vente engagée', state: 'done', description: c.offer_amount != null ? `${formatPrice(c.offer_amount)}${c.accepted_at ? ` · ${formatDateFr(c.accepted_at)}` : ''}` : undefined },
    { id: 'redacteur', label: 'Rédacteur de l\'acte désigné', state: c.redacteur?.name ? 'done' : closed ? 'todo' : 'current', description: c.redacteur?.name ? `${REDACTEUR_LABEL[c.redacteur.type] || 'Rédacteur'} : ${c.redacteur.name}` : 'Notaire, avocat ou expert-comptable : l\'une ou l\'autre partie peut le renseigner.' },
    { id: 'steps', label: 'Financement, audit et acte', state: d ? 'done' : c.redacteur?.name && !closed ? 'current' : 'todo', description: 'Entre vous et l\'autre partie, avec vos conseils. Nous vous demandons des nouvelles à J+30, J+60 et J+90.' },
    { id: 'declared', label: 'Vente déclarée', state: d ? 'done' : 'todo', description: d ? `Acte du ${formatDateFr(d.signed_on)} · ${formatPrice(d.final_price)} · ${SALE_OBJECT_LABEL[d.sale_object] || ''}` : 'Par l\'une des parties, dès la signature de l\'acte.' },
    { id: 'confirmed', label: 'Confirmée par l\'autre partie', state: c.status === 'confirmed' ? 'done' : c.status === 'declared' ? 'current' : 'todo', description: c.status === 'confirmed' ? `${c.confirmed_by === 'auto' ? 'Confirmation automatique après 7 jours' : 'Confirmée'}${c.confirmed_at ? ` le ${formatDateFr(c.confirmed_at)}` : ''}.` : d && !autoConfirms(d) ? 'Par le cédant : pas de confirmation automatique d\'une déclaration du repreneur.' : 'Sous 7 jours ; sans réponse, confirmation automatique.' },
    ...(role === 'seller' || role === 'admin' ? [{ id: 'invoice', label: 'Facture d\'honoraires émise', state: c.invoice ? 'done' : 'todo', description: c.invoice ? `${c.invoice.number} · ${formatPrice(c.invoice.total_ht)} HT` : 'Émise automatiquement à la confirmation, payable par le rédacteur sur le prix.' }] : []),
  ];

  return (
    <div className="space-y-6 min-w-0" data-testid="closing-panel">
      <section className="card p-5 sm:p-6 min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-2 min-w-0">
          <div className="min-w-0">
            <p className="eyebrow">Étape de vente</p>
            <h2 className="font-display text-xl font-bold text-brand-navy break-words">{c.company_title || c.company_label || 'Entreprise'}</h2>
            {otherName && <p className="text-sm text-gray-600 mt-0.5 break-words">{role === 'seller' ? 'Repreneur' : 'Cédant'} : {otherName}</p>}
          </div>
          <span className={cn('badge shrink-0', STATUS_TONE[c.status] || 'badge-info')} data-testid="closing-status">{closingStatusLabel(c)}</span>
        </div>
        <p className="text-sm text-gray-700 mt-3 leading-relaxed" data-testid="closing-sentence">{closingSentence(c, role)}</p>
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600">
          {c.sale_object && <div><dt className="inline">Objet : </dt><dd className="inline text-brand-navy font-medium">{SALE_OBJECT_LABEL[c.sale_object] || c.sale_object}</dd></div>}
          {c.expected_date && !d && <div><dt className="inline">Signature visée : </dt><dd className="inline text-brand-navy font-medium">{formatDateFr(c.expected_date)}</dd></div>}
          {c.offer_amount != null && <div><dt className="inline">Offre acceptée : </dt><dd className="inline text-brand-navy font-medium tabular">{formatPrice(c.offer_amount)}</dd></div>}
        </dl>
        {role === 'seller' && c.commission_preview && !c.invoice && c.status !== 'abandoned' && (
          <p className="mt-3 text-sm text-gray-700 rounded-xl bg-brand-surface border border-brand-line px-4 py-3 tabular">
            Commission prévue sur {formatPrice(d?.final_price ?? c.offer_amount)} : <strong className="text-brand-navy">{commissionLabel(d?.final_price ?? c.offer_amount)}</strong>, exigible uniquement à la signature de l&apos;acte.
          </p>
        )}
      </section>

      {mustAnswer && (
        <section className="rounded-2xl border-2 border-amber-300 bg-brand-amber-soft p-5 sm:p-6 min-w-0" aria-labelledby="confirm-title" data-testid="confirm-banner">
          <h3 id="confirm-title" className="font-display text-lg font-bold text-brand-navy flex items-center gap-2"><ShieldAlert className="w-5 h-5 text-brand-amber" aria-hidden="true" />Vente déclarée par {PARTY[d.declared_by] || 'l\'autre partie'} : merci de confirmer</h3>
          <dl className="mt-2 grid sm:grid-cols-3 gap-2 text-sm">
            <div><dt className="text-xs text-gray-600">Acte signé le</dt><dd className="font-semibold text-brand-navy">{formatDateFr(d.signed_on)}</dd></div>
            <div><dt className="text-xs text-gray-600">Prix définitif</dt><dd className="font-semibold text-brand-navy tabular">{formatPrice(d.final_price)}</dd></div>
            <div><dt className="text-xs text-gray-600">Objet</dt><dd className="font-semibold text-brand-navy">{SALE_OBJECT_LABEL[d.sale_object] || d.sale_object}</dd></div>
          </dl>
          <p className="text-sm text-gray-700 mt-2" data-testid="confirm-deadline">
            {autoConfirms(d)
              ? <>Sans réponse avant le {formatDateFr(d.confirm_deadline)}, la vente est confirmée automatiquement{role === 'seller' ? ' et la facture d\'honoraires est émise' : ''}.</>
              : <>Rien n&apos;est facturé ni retiré tant que vous n&apos;avez pas confirmé : la vente n&apos;est confirmée qu&apos;avec votre accord.</>}
          </p>
          {!disputing ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => setConfirming(true)} className="btn-primary px-4 py-2.5 text-sm" data-testid="confirm-btn">
                <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                Confirmer la vente
              </button>
              <button type="button" onClick={() => setDisputing(true)} className="btn-secondary px-4 py-2.5 text-sm" data-testid="dispute-btn">Contester</button>
            </div>
          ) : (
            <div className="mt-4 space-y-2 max-w-xl">
              <label htmlFor="dispute-reason" className="block text-sm font-semibold text-brand-navy">Motif de la contestation</label>
              <textarea id="dispute-reason" value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)} rows={3} maxLength={2000} className="w-full rounded-xl border border-brand-line px-4 py-2.5 text-sm text-brand-navy bg-white focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30" placeholder="Date, prix ou objet inexacts, acte non signé…" data-testid="dispute-reason" />
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={dispute} disabled={busy || disputeReason.trim().length < 5} className="btn-primary px-4 py-2.5 text-sm" data-testid="dispute-submit">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <AlertCircle className="w-4 h-4" aria-hidden="true" />}
                  Envoyer la contestation
                </button>
                <button type="button" onClick={() => setDisputing(false)} className="btn-secondary px-4 py-2.5 text-sm">Annuler</button>
              </div>
            </div>
          )}
        </section>
      )}

      {c.status === 'disputed' && c.dispute?.reason && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 break-words" data-testid="dispute-reason-text">Motif de la contestation : {c.dispute.reason}</p>
      )}

      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-6 min-w-0">
        <section className="card p-5 sm:p-6 min-w-0 self-start">
          <Checklist title="Jusqu'à la signature" items={items} compact />
        </section>

        <div className="space-y-6 min-w-0">
          <section className="card p-5 sm:p-6 min-w-0" aria-labelledby="redacteur-title">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h3 id="redacteur-title" className="font-display text-lg font-bold text-brand-navy flex items-center gap-2"><Scale className="w-5 h-5 text-gray-500" aria-hidden="true" />Rédacteur de l&apos;acte</h3>
              {c.redacteur?.name && !editingRedacteur && redacteurEditable && (
                <button type="button" onClick={() => setEditingRedacteur(true)} className="btn-link text-sm" data-testid="redacteur-edit"><Pencil className="w-4 h-4" aria-hidden="true" />Modifier</button>
              )}
            </div>
            {c.redacteur?.name && !editingRedacteur ? (
              <dl className="text-sm space-y-1">
                <div><dt className="inline text-gray-500">Type : </dt><dd className="inline text-brand-navy font-medium">{REDACTEUR_LABEL[c.redacteur.type] || 'Rédacteur'}</dd></div>
                <div><dt className="inline text-gray-500">Nom : </dt><dd className="inline text-brand-navy font-medium break-words">{c.redacteur.name}</dd></div>
                {c.redacteur.email && <div><dt className="inline text-gray-500">E-mail : </dt><dd className="inline text-brand-navy break-words">{c.redacteur.email}</dd></div>}
                {c.redacteur.phone && <div><dt className="inline text-gray-500">Téléphone : </dt><dd className="inline text-brand-navy">{c.redacteur.phone}</dd></div>}
                {sellerSide && c.redacteur.set_by === 'buyer' && !c.payment_order_sent_at && (
                  <p className="text-sm text-amber-800 bg-brand-amber-soft rounded-lg px-3 py-2 mt-2" data-testid="redacteur-to-confirm">
                    Indiqué par le repreneur : vérifiez-le puis enregistrez-le (Modifier) pour que l&apos;ordre de paiement lui soit adressé.
                  </p>
                )}
              </dl>
            ) : !redacteurEditable && !c.redacteur?.name ? (
              <p className="text-sm text-gray-600">Aucun rédacteur renseigné.</p>
            ) : (
              <RedacteurForm closing={c} onSaved={async (data) => { setEditingRedacteur(false); await apply(data); }} onCancel={c.redacteur?.name ? () => setEditingRedacteur(false) : undefined} />
            )}
          </section>

          {canDeclare && (
            <section className="card p-5 sm:p-6 min-w-0" aria-labelledby="declare-title">
              <h3 id="declare-title" className="font-display text-lg font-bold text-brand-navy flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-gray-500" aria-hidden="true" />{c.status === 'declared' ? 'Ma déclaration' : 'Déclarer la vente'}</h3>
              {c.status === 'declared' && !declaring ? (
                <>
                  <p className="text-sm text-gray-700 mt-2">Acte du {formatDateFr(d.signed_on)} · {formatPrice(d.final_price)} · {SALE_OBJECT_LABEL[d.sale_object] || ''}. En attente de confirmation jusqu&apos;au {formatDateFr(d.confirm_deadline)}.</p>
                  <button type="button" onClick={() => setDeclaring(true)} className="btn-link text-sm mt-2"><Pencil className="w-4 h-4" aria-hidden="true" />Corriger ma déclaration</button>
                </>
              ) : (
                <>
                  <p className="text-sm text-gray-600 mt-1 mb-4" data-testid="declare-help">
                    {role === 'buyer'
                      ? <>À faire dès la signature de l&apos;acte définitif. Le cédant reçoit une demande de confirmation : la vente n&apos;est confirmée qu&apos;avec son accord.</>
                      : <>À faire dès la signature de l&apos;acte définitif. L&apos;autre partie reçoit une demande de confirmation ; sans réponse sous 7 jours, la vente est confirmée automatiquement.</>}
                  </p>
                  <DeclareForm closing={c} role={role} onSaved={async (data) => { setDeclaring(false); await apply(data); }} onCancel={c.status === 'declared' ? () => setDeclaring(false) : undefined} />
                </>
              )}
            </section>
          )}

          <InvoiceCard closing={c} role={role} />

          <p className="text-sm text-gray-600">
            Une question sur cette étape ? <Link to={`/messages?conversation=${encodeURIComponent(c.conversation_id || c.company_id || '')}`} className="btn-link text-sm">Écrire à l&apos;autre partie</Link>
          </p>
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Confirmer la vente"
        description={d ? `Vous confirmez que l'acte a été signé le ${formatDateFr(d.signed_on)} pour ${formatPrice(d.final_price)} (${SALE_OBJECT_LABEL[d.sale_object] || ''}). ${role === 'seller' ? 'La facture d\'honoraires sera émise immédiatement.' : 'L\'annonce passera au statut « vendue ».'}` : ''}
        confirmLabel="Je confirme"
        onConfirm={confirm}
        testId="confirm-dialog"
      />
    </div>
  );
};

export default ClosingPanel;
