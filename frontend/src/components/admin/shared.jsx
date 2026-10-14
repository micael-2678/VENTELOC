import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { axiosInstance } from '@/App';
import { apiRelativePath } from '@/lib/mandate';
import { formatDateFr } from '@/components/shared/formatters';
import { cn } from '@/lib/utils';

// Briques communes de l'administration (SPEC §6.3) : formats, badges, tableau responsive (liste sous 640 px),
// appel générique des actions `{method, url, body}` renvoyées par GET /admin/todo, boîtes de dialogue
// (retrait motivé, encaissement, note). Aucune donnée brute n'est affichée sans libellé.

// ---- Formats ---------------------------------------------------------------------------------

const EUR = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const EUR_CENTS = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NUMBER = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

const isAmount = (n) => n !== null && n !== undefined && n !== '' && Number.isFinite(Number(n));

// 4 800 → « 4 800 € » ; absent → « — »
export const fmtEur = (n) => (isAmount(n) ? EUR.format(Number(n)) : '—');
// 4 800.5 → « 4 800,50 € » (factures)
export const fmtEurCents = (n) => (isAmount(n) ? EUR_CENTS.format(Number(n)) : '—');
// 12 → « 12 » ; absent → « — »
export const fmtNumber = (n) => (isAmount(n) ? NUMBER.format(Number(n)) : '—');
// 0.42 ou 42 → « 42 % » ; absent → « — » (les pourcentages de l'API sont déjà en 0-100)
export const fmtPct = (n) => (isAmount(n) ? `${Math.round(Number(n))} %` : '—');
// « 3 oct. 2026 » ; absent → « — »
export const fmtDate = (iso) => formatDateFr(iso) || '—';
// « 3 oct. 2026, 14:05 »
export const fmtDateTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${formatDateFr(d)}, ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
};
// « 2026-10 » → « octobre 2026 »
export const fmtMonth = (month) => {
  const d = new Date(`${month}-01T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(month || '—');
  return d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
};
// Mois courant au format AAAA-MM
export const currentMonth = () => new Date().toISOString().slice(0, 7);
// Aujourd'hui au format AAAA-MM-JJ
export const today = () => new Date().toISOString().slice(0, 10);

// Nombre de jours écoulés (entier ≥ 0) depuis une date ; null si absente
export const daysSince = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
};

// « depuis le 3 oct. 2026 (7 j) » ; '' si la date est absente
export const sinceText = (iso) => {
  const date = formatDateFr(iso);
  if (!date) return '';
  const days = daysSince(iso);
  if (days === null) return `depuis le ${date}`;
  if (days === 0) return `aujourd'hui`;
  return `depuis le ${date} (${days} j)`;
};

// Nom affichable d'un compte sans jamais produire « null null »
export const displayName = (u) => {
  if (!u) return '—';
  if (u.deleted_at) return 'Compte supprimé';
  const name = [u.first_name, u.last_name].map((s) => String(s || '').trim()).filter(Boolean).join(' ');
  return name || String(u.company_name || u.email || '').trim() || '—';
};

export const ROLE_LABELS = { seller: 'Cédant', buyer: 'Repreneur', admin: 'Administrateur' };
export const roleLabel = (role) => ROLE_LABELS[role] || 'Compte';

// Identité (Stripe Identity ou validation admin) → libellé et ton
export const identityInfo = (u) => {
  if (!u) return { label: 'Identité non vérifiée', tone: 'info' };
  if (u.identity_verified || u.kyc_status === 'verified') return { label: 'Identité vérifiée', tone: 'success' };
  if (u.kyc_status === 'manual_review') return { label: 'Identité en repli (vérification manuelle)', tone: 'warning' };
  if (u.kyc_status === 'pending' || u.kyc_status === 'under_review') return { label: 'Vérification en cours', tone: 'warning' };
  if (u.kyc_status === 'rejected') return { label: 'Vérification refusée', tone: 'danger' };
  return { label: 'Identité non vérifiée', tone: 'info' };
};

export const SALE_OBJECT_LABELS = { titres: 'Cession de titres', fonds: 'Cession de fonds', indifferent: 'Titres ou fonds' };
export const saleObjectLabel = (v) => SALE_OBJECT_LABELS[v] || 'À définir dans l\'acte';

// Motifs de retrait d'une annonce (identiques à REMOVAL_REASONS côté serveur)
export const REMOVAL_REASONS = [
  { value: 'coordonnees', label: 'Coordonnées ou éléments identifiants dans l\'annonce' },
  { value: 'hors_perimetre', label: 'Activité hors périmètre (entreprises du bâtiment)' },
  { value: 'informations_inexactes', label: 'Informations inexactes ou invérifiables' },
  { value: 'dirigeant', label: 'Qualité de dirigeant ou de mandataire non établie' },
  { value: 'doublon', label: 'Annonce en doublon' },
  { value: 'autre', label: 'Autre motif (à préciser ci-dessous)' },
];
export const removalReasonLabel = (value) => (REMOVAL_REASONS.find((r) => r.value === value) || {}).label || String(value || '');

// ---- Appels d'API --------------------------------------------------------------------------

// Appelle une action `{method, url, body?}` telle que renvoyée par GET /admin/todo. Les paramètres de requête
// génériques (`<motif>`, `<texte>`) sont retirés et remplacés par `params` ; `body` remplace `action.body` s'il est donné.
export const callAction = async (action, { body, params } = {}) => {
  const method = String(action.method || 'GET').toLowerCase();
  const [pathOnly, query] = apiRelativePath(action.url).split('?');
  const qp = {};
  new URLSearchParams(query || '').forEach((v, k) => { if (!/^<.*>$/.test(v)) qp[k] = v; });
  const res = await axiosInstance.request({ method, url: pathOnly, params: { ...qp, ...(params || {}) }, data: body !== undefined ? body : action.body });
  return res.data;
};

// Retrait motivé d'une annonce : PUT /companies/{id}/status?status=removed&reason=…&reason_text=…
export const removeListing = (companyId, reason, reasonText) => axiosInstance.put(`/companies/${companyId}/status`, null, {
  params: { status: 'removed', reason, reason_text: reasonText || '' },
});

// Onglet admin correspondant à une URL d'action « Voir / Ouvrir » (méthode GET) ; null si aucun
export const tabForUrl = (url) => {
  const u = String(url || '');
  if (u.includes('/admin/closings')) return 'closings';
  if (u.includes('/admin/mandates')) return 'mandates';
  if (u.includes('/admin/invoices')) return 'invoices';
  if (u.includes('/admin/incidents')) return 'incidents';
  if (u.includes('/admin/users') || u.includes('/admin/kyc')) return 'users';
  if (u.includes('/admin/companies') || u.includes('/companies/')) return 'companies';
  return null;
};

// Résumé lisible du résultat de POST /admin/jobs/run ({nom: résultat})
export const jobsRunSummary = (result) => {
  const entries = Object.entries(result || {});
  if (!entries.length) return 'Tâches lancées : rien à traiter.';
  const failed = entries.filter(([, v]) => typeof v === 'string' && /erreur|error/i.test(v));
  const done = entries.length - failed.length;
  return `Tâches lancées : ${done} terminée${done > 1 ? 's' : ''}${failed.length ? `, ${failed.length} en erreur (voir « À faire »)` : ''}.`;
};

// ---- Éléments d'interface -------------------------------------------------------------------

export const Section = ({ title, description, actions, children, className = '', testId }) => (
  <section className={cn('rounded-2xl bg-white border border-brand-line p-4 sm:p-6 min-w-0', className)} data-testid={testId}>
    {(title || actions) && (
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4 min-w-0">
        <div className="min-w-0">
          {title && <h2 className="font-display text-lg sm:text-xl font-bold text-brand-navy break-words">{title}</h2>}
          {description && <p className="text-sm text-gray-600 mt-0.5">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2 shrink-0">{actions}</div>}
      </div>
    )}
    {children}
  </section>
);

export const EmptyState = ({ children = 'Rien à traiter.', icon: Icon, testId }) => (
  <div className="rounded-xl border border-dashed border-brand-line bg-brand-surface px-4 py-8 text-center text-sm text-gray-600" data-testid={testId}>
    {Icon && <Icon className="w-6 h-6 mx-auto mb-2 text-gray-400" aria-hidden="true" />}
    {children}
  </div>
);

export const Loading = ({ label = 'Chargement…' }) => (
  <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-500" role="status">
    <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
    {label}
  </div>
);

const TONE_CLASS = {
  success: 'bg-brand-green-soft text-brand-green-dark',
  warning: 'bg-brand-amber-soft text-brand-amber',
  danger: 'bg-red-50 text-red-800',
  info: 'bg-brand-surface text-gray-700',
  navy: 'bg-brand-navy text-white',
};

// Pastille de statut : ton success (vérifié / payé / en ligne), warning, danger, info (neutre).
// wrap : libellé long (drapeau, dénomination) qui passe à la ligne au lieu de déborder de la carte sur mobile.
export const Pill = ({ tone = 'info', children, className = '', testId, wrap = false }) => (
  <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-[13px] font-medium max-w-full', wrap ? 'whitespace-normal break-words text-left' : 'whitespace-nowrap', TONE_CLASS[tone] || TONE_CLASS.info, className)} data-testid={testId}>
    {children}
  </span>
);

// Petit bouton d'action secondaire (focus visible)
export const ActionButton = ({ onClick, children, tone = 'outline', disabled, busy, testId, title, type = 'button' }) => (
  <Button
    type={type}
    size="sm"
    variant={tone === 'primary' ? 'default' : tone === 'danger' ? 'destructive' : 'outline'}
    onClick={onClick}
    disabled={disabled || busy}
    title={title}
    className={cn('rounded-xl', tone === 'primary' && 'bg-brand-navy hover:bg-brand-navy-light text-white', tone === 'danger' && 'bg-red-700 hover:bg-red-800 text-white')}
    data-testid={testId}
  >
    {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
    {children}
  </Button>
);

// Lien externe (fiche publique, annonce BODACC) avec focus visible
export const ExtLink = ({ href, children, testId }) => (
  <a href={href} target="_blank" rel="noreferrer" className="text-sm font-medium text-brand-blue underline underline-offset-2 hover:text-brand-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue rounded" data-testid={testId}>
    {children}
  </a>
);

// Champ de filtre (select natif) avec libellé
export const FilterSelect = ({ id, label, value, onChange, options, testId }) => (
  <label htmlFor={id} className="flex items-center gap-2 text-sm text-gray-700">
    <span className="whitespace-nowrap">{label}</span>
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="h-9 rounded-xl border border-brand-line bg-white px-2 text-sm text-brand-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue" data-testid={testId}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </label>
);

// Tableau sur écran large, liste de cartes sous 640 px (SPEC §5.3). `columns` : [{key, label, render?, align?, primary?}].
// `primary` : la colonne qui sert de titre de carte sur mobile. `actions(row)` : boutons de la ligne.
export const DataTable = ({ columns, rows, rowKey = (r) => r.id, actions, emptyText = 'Rien à traiter.', highlightId, testId }) => {
  if (!rows || rows.length === 0) return <EmptyState testId={testId ? `${testId}-empty` : undefined}>{emptyText}</EmptyState>;
  const cell = (col, row) => (col.render ? col.render(row) : (row[col.key] ?? '—'));
  const primary = columns.find((c) => c.primary) || columns[0];
  const isHl = (row) => highlightId && String(rowKey(row)) === String(highlightId);
  return (
    <div data-testid={testId}>
      <div className="hidden sm:block overflow-x-auto -mx-4 sm:mx-0">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-gray-600 border-b border-brand-line">
              {columns.map((col) => (
                <th key={col.key} scope="col" className={cn('py-2 px-3 font-medium whitespace-nowrap', col.align === 'right' && 'text-right')}>{col.label}</th>
              ))}
              {actions && <th scope="col" className="py-2 px-3 font-medium text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)} className={cn('border-b border-brand-line last:border-0 align-top', isHl(row) && 'bg-brand-blue-soft')} data-testid={`row-${rowKey(row)}`}>
                {columns.map((col) => (
                  <td key={col.key} className={cn('py-2.5 px-3', col.align === 'right' && 'text-right tabular-nums', col.nowrap && 'whitespace-nowrap', col.wide && 'min-w-[12rem]')}>{cell(col, row)}</td>
                ))}
                {actions && <td className="py-2.5 px-3"><div className="flex flex-wrap justify-end gap-2">{actions(row)}</div></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="sm:hidden space-y-3">
        {rows.map((row) => (
          <li key={rowKey(row)} className={cn('rounded-xl border border-brand-line bg-white p-4 min-w-0', isHl(row) && 'ring-2 ring-brand-blue')}>
            <p className="font-semibold text-brand-navy break-words mb-2">{cell(primary, row)}</p>
            <dl className="space-y-1">
              {columns.filter((c) => c !== primary).map((col) => (
                <div key={col.key} className="flex justify-between gap-3 text-sm min-w-0">
                  <dt className="text-gray-600 shrink-0">{col.label}</dt>
                  <dd className="text-right text-brand-navy break-words min-w-0">{cell(col, row)}</dd>
                </div>
              ))}
            </dl>
            {actions && <div className="flex flex-wrap gap-2 mt-3">{actions(row)}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
};

// ---- Boîtes de dialogue -----------------------------------------------------------------------

// Boîte générique : confirmation + champs optionnels. `onConfirm` renvoie une promesse ; une erreur laisse la boîte ouverte.
export const ActionDialog = ({ open, onClose, title, description, confirmLabel = 'Confirmer', tone = 'navy', disabled = false, onConfirm, children, testId }) => {
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    if (busy || disabled) return;
    setBusy(true);
    try {
      await onConfirm();
      onClose?.();
    } catch (e) {
      // le message est affiché par l'appelant (toast) ; la boîte reste ouverte
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose?.(); }}>
      <DialogContent className="max-w-lg rounded-2xl w-[calc(100%-1.5rem)]" data-testid={testId}>
        <DialogHeader>
          <DialogTitle className="font-display text-xl text-brand-navy">{title}</DialogTitle>
          {description && <DialogDescription className="text-sm text-gray-700 leading-relaxed">{description}</DialogDescription>}
        </DialogHeader>
        {children && <div className="space-y-3">{children}</div>}
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy} className="rounded-xl">Annuler</Button>
          <Button
            type="button"
            onClick={confirm}
            disabled={busy || disabled}
            className={cn('rounded-xl text-white', tone === 'danger' ? 'bg-red-700 hover:bg-red-800' : 'bg-brand-navy hover:bg-brand-navy-light')}
            data-testid={testId ? `${testId}-confirm` : undefined}
          >
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const Field = ({ id, label, hint, children }) => (
  <div className="space-y-1">
    <label htmlFor={id} className="block text-sm font-medium text-brand-navy">{label}</label>
    {children}
    {hint && <p className="text-[13px] text-gray-600">{hint}</p>}
  </div>
);

// Retrait motivé (SPEC §4.4) : liste fermée + texte libre (obligatoire pour « autre »)
export const RemovalDialog = ({ open, onClose, listingLabel, onConfirm }) => {
  const [reason, setReason] = useState('coordonnees');
  const [text, setText] = useState('');
  useEffect(() => { if (open) { setReason('coordonnees'); setText(''); } }, [open]);
  const needText = reason === 'autre' && !text.trim();
  return (
    <ActionDialog
      open={open}
      onClose={onClose}
      title="Retirer l'annonce avec motif"
      description={`${listingLabel ? `${listingLabel} : ` : ''}l'annonce passe hors ligne, le cédant reçoit le motif par e-mail et son mandat devient caduc. Il pourra corriger puis signer un nouveau mandat.`}
      confirmLabel="Retirer l'annonce"
      tone="danger"
      disabled={needText}
      onConfirm={() => onConfirm(reason, text.trim())}
      testId="removal-dialog"
    >
      <Field id="removal-reason" label="Motif">
        <select id="removal-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="h-10 w-full rounded-xl border border-brand-line bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue" data-testid="removal-reason">
          {REMOVAL_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </Field>
      <Field id="removal-text" label="Précision pour le cédant" hint="Transmise telle quelle dans l'e-mail de retrait.">
        <Textarea id="removal-text" value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={1000} className="rounded-xl" data-testid="removal-text" />
      </Field>
    </ActionDialog>
  );
};

// Encaissement d'une facture : PUT /admin/invoices/{id}/paid {paid_on, amount}
// Reste dû TTC d'une facture : après un acompte, balance_due ; sinon le total
export const invoiceBalance = (invoice) => {
  if (!invoice) return null;
  if (invoice.balance_due != null) return Number(invoice.balance_due);
  if (invoice.total_ttc == null) return null;
  return Math.round((Number(invoice.total_ttc) - Number(invoice.paid_amount || 0)) * 100) / 100;
};

export const PaidDialog = ({ open, onClose, invoice, onConfirm }) => {
  const [paidOn, setPaidOn] = useState(today());
  const [amount, setAmount] = useState('');
  const balance = invoiceBalance(invoice);
  const payments = Array.isArray(invoice?.payments) ? invoice.payments : [];
  useEffect(() => {
    if (open) {
      setPaidOn(today());
      setAmount(balance != null ? String(balance) : '');
    }
  }, [open, balance]);
  const valid = !!paidOn && Number(amount) > 0 && (balance == null || Number(amount) <= balance + 0.005);
  const hint = invoice?.total_ttc != null
    ? `Montant de la facture : ${fmtEurCents(invoice.total_ttc)} TTC${payments.length ? ` · reste dû : ${fmtEurCents(balance)} TTC` : ''}. Un montant inférieur est enregistré comme acompte.`
    : undefined;
  return (
    <ActionDialog
      open={open}
      onClose={onClose}
      title={`Enregistrer un encaissement sur la facture ${invoice?.number || ''}`}
      description="Payée en totalité : le cédant reçoit une confirmation et les relances s'arrêtent. Acompte : la facture reste due pour le solde (relances sur le solde)."
      confirmLabel="Enregistrer l'encaissement"
      disabled={!valid}
      onConfirm={() => onConfirm({ paid_on: paidOn, amount: Number(amount) })}
      testId="paid-dialog"
    >
      {payments.length > 0 && (
        <div className="text-sm" data-testid="paid-history">
          <p className="font-semibold text-brand-navy">Encaissements déjà enregistrés</p>
          <ul className="mt-1 space-y-0.5 text-gray-700 tabular">
            {payments.map((p, i) => <li key={`${p.paid_on}-${i}`}>{fmtDate(p.paid_on)} : {fmtEurCents(p.amount)} TTC</li>)}
          </ul>
        </div>
      )}
      <Field id="paid-on" label="Date d'encaissement">
        <Input id="paid-on" type="date" value={paidOn} max={today()} onChange={(e) => setPaidOn(e.target.value)} className="rounded-xl" data-testid="paid-on" />
      </Field>
      <Field id="paid-amount" label="Montant encaissé (TTC, en euros)" hint={hint}>
        <Input id="paid-amount" type="number" min="0" max={balance != null ? String(balance) : undefined} step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="rounded-xl" data-testid="paid-amount" />
      </Field>
    </ActionDialog>
  );
};

// Confirmation avec note (motif d'annulation, note de résolution, note d'incident)
export const NoteDialog = ({ open, onClose, title, description, confirmLabel, noteLabel = 'Note', required = false, tone = 'navy', onConfirm, testId = 'note-dialog' }) => {
  const [note, setNote] = useState('');
  useEffect(() => { if (open) setNote(''); }, [open]);
  return (
    <ActionDialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      tone={tone}
      disabled={required && !note.trim()}
      onConfirm={() => onConfirm(note.trim())}
      testId={testId}
    >
      <Field id={`${testId}-note`} label={noteLabel}>
        <Textarea id={`${testId}-note`} value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} className="rounded-xl" data-testid={`${testId}-note`} />
      </Field>
    </ActionDialog>
  );
};
