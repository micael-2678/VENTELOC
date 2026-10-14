import { useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, CalendarClock, Cog, Flag, FolderOpen, Handshake, Inbox, Receipt, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LISTING_FLAG_LABELS } from '@/components/seller/listingStatus';
import { downloadPdf } from '@/lib/mandate';
import { apiErrorMessage, isEmailNotVerifiedError } from '@/components/account/errors';
import {
  ActionButton, ActionDialog, EmptyState, ExtLink, Loading, NoteDialog, PaidDialog, Pill, RemovalDialog,
  callAction, fmtDate, fmtDateTime, fmtEur, fmtEurCents, jobsRunSummary, sinceText, tabForUrl,
} from './shared';

// Onglet par défaut « À faire » (SPEC §6.3, HANDOFF §0) : sections de GET /admin/todo, chaque ligne avec ses
// actions appelées telles quelles ({method, url, body}). « Retirer avec motif » ouvre la liste des motifs ;
// « Marquer payée » demande la date et le montant ; les résolutions de vente acceptent une note.

const SECTION_ICONS = {
  listings_review: Flag,
  dataroom_unanswered: FolderOpen,
  closings_declared: Handshake,
  closings_stale: Handshake,
  todos: Receipt,
  mandates_expiring: CalendarClock,
  incidents: AlertTriangle,
  job_failures: Cog,
  kyc_manual: ShieldCheck,
};

const SECTION_TONES = { closings_declared: 'warning', incidents: 'danger', job_failures: 'danger', todos: 'warning' };

const SUCCESS_MESSAGES = {
  Valider: 'Annonce validée : la relecture est close.',
  Clore: 'Ligne close.',
  Confirmer: 'Vente confirmée : la facture d\'honoraires est émise et envoyée au cédant.',
  'Annuler la déclaration': 'Déclaration annulée : l\'étape de vente revient « en cours ».',
  'Marquer vérifiée': 'Identité marquée comme vérifiée.',
  'Marquer payée': 'Encaissement enregistré.',
  'Relancer le cédant': 'Relance envoyée au cédant.',
  'Retirer avec motif': 'Annonce retirée : le cédant est informé du motif.',
};

// Nature d'une action pour choisir l'interface (boîte de motif, de montant, de note, téléchargement, onglet)
export const actionKind = (action) => {
  const url = String(action?.url || '');
  const method = String(action?.method || 'GET').toUpperCase();
  if (action?.reasons || /<motif>/.test(url) || /status=removed/.test(url)) return 'remove';
  if (/\/admin\/invoices\/[^/?]+\/paid$/.test(url)) return 'paid';
  if (/\/resolve$/.test(url) && method !== 'GET') return 'resolve';
  if (method === 'GET') return /\.pdf$/.test(url) ? 'pdf' : 'open';
  if (/\/admin\/incidents\//.test(url)) return 'incident';
  if (/\/done$/.test(url)) return 'confirm';
  return 'call';
};

const isJobsRun = (action) => /\/admin\/jobs\/run$/.test(String(action?.url || ''));

// Données de référence d'une ligne, libellées (jamais d'identifiant brut)
const RefChips = ({ row, onNavigate }) => {
  const ref = row.ref || {};
  const chips = [];
  if (ref.company_name) chips.push(<Pill wrap key="name" tone="info">{ref.company_name}{ref.siret ? ` · SIRET ${ref.siret}` : ''}</Pill>);
  else if (ref.siret) chips.push(<Pill wrap key="siret" tone="info">SIRET {ref.siret}</Pill>);
  if (ref.siren && !ref.siret) chips.push(<Pill wrap key="siren" tone="info">SIREN {ref.siren}</Pill>);
  if (ref.asking_price > 0) chips.push(<Pill wrap key="price" tone="info">Prix demandé {fmtEur(ref.asking_price)}</Pill>);
  (ref.flags || []).forEach((f) => chips.push(<Pill wrap key={`flag-${f}`} tone="warning">{LISTING_FLAG_LABELS[f] || String(f)}</Pill>));
  if (ref.invoice_number) chips.push(<Pill wrap key="inv" tone="info">Facture {ref.invoice_number}</Pill>);
  if (ref.debtor_name) chips.push(<Pill wrap key="debtor" tone="info">Débiteur : {ref.debtor_name}</Pill>);
  if (ref.total_ttc > 0) chips.push(<Pill wrap key="ttc" tone="info">{fmtEurCents(ref.total_ttc)} TTC</Pill>);
  if (ref.due_on) chips.push(<Pill wrap key="due" tone="warning">Échéance {fmtDate(ref.due_on)}</Pill>);
  if (ref.reason) chips.push(<Pill wrap key="reason" tone="warning">Motif : {ref.reason}</Pill>);
  const links = [];
  if (ref.company_id) {
    links.push(<ExtLink key="fiche" href={`/company/${ref.company_id}`}>Fiche publique</ExtLink>);
    links.push(<button key="listing" type="button" onClick={() => onNavigate('companies', { id: ref.company_id })} className="text-sm font-medium text-brand-blue underline underline-offset-2 hover:text-brand-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue rounded">Annonce</button>);
  }
  if (ref.closing_id) links.push(<button key="closing" type="button" onClick={() => onNavigate('closings', { id: ref.closing_id })} className="text-sm font-medium text-brand-blue underline underline-offset-2 hover:text-brand-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue rounded">Étape de vente</button>);
  if (ref.invoice_id) links.push(<button key="invoice" type="button" onClick={() => onNavigate('invoices', { id: ref.invoice_id })} className="text-sm font-medium text-brand-blue underline underline-offset-2 hover:text-brand-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue rounded">Facture</button>);
  if (ref.mandate_id) links.push(<button key="mandate" type="button" onClick={() => onNavigate('mandates', { id: ref.mandate_id })} className="text-sm font-medium text-brand-blue underline underline-offset-2 hover:text-brand-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue rounded">Registre des mandats</button>);
  if (ref.user_id) links.push(<button key="user" type="button" onClick={() => onNavigate('users', { id: ref.user_id })} className="text-sm font-medium text-brand-blue underline underline-offset-2 hover:text-brand-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue rounded">Compte</button>);
  if (ref.incident_id) links.push(<button key="incident" type="button" onClick={() => onNavigate('incidents', { id: ref.incident_id })} className="text-sm font-medium text-brand-blue underline underline-offset-2 hover:text-brand-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue rounded">Incidents</button>);
  if (ref.url) links.push(<ExtLink key="bodacc" href={ref.url}>Annonce BODACC</ExtLink>);
  if (!chips.length && !links.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 mt-2">
      {chips}
      {links}
    </div>
  );
};

const AdminTodo = ({ data, loading, onReload, onNavigate, onEmailBlocked }) => {
  const [dialog, setDialog] = useState(null); // {kind, row, action}
  const [busy, setBusy] = useState('');

  const run = async (action, row, extra) => {
    const key = `${row.id}:${action.label}`;
    setBusy(key);
    try {
      const result = await callAction(action, extra);
      toast.success(isJobsRun(action) ? jobsRunSummary(result) : (SUCCESS_MESSAGES[action.label] || 'Action effectuée.'));
      onReload?.();
    } catch (err) {
      if (isEmailNotVerifiedError(err)) onEmailBlocked?.();
      toast.error(apiErrorMessage(err));
      throw err;
    } finally {
      setBusy('');
    }
  };

  const onAction = (action, row) => {
    const kind = actionKind(action);
    if (kind === 'open') {
      const tab = tabForUrl(action.url);
      if (tab) onNavigate(tab, { id: row.ref?.closing_id || row.ref?.invoice_id || row.ref?.mandate_id || row.ref?.user_id || row.ref?.company_id || null });
      return;
    }
    if (kind === 'pdf') {
      const name = String(action.url).split('/').pop() || 'document.pdf';
      downloadPdf(action.url, name);
      return;
    }
    if (kind === 'call') {
      run(action, row).catch(() => {});
      return;
    }
    setDialog({ kind, row, action });
  };

  const close = () => setDialog(null);

  if (loading && !data) return <Loading label="Chargement de la liste…" />;
  const sections = (data?.sections || []).filter((s) => (s.rows || []).length > 0);
  const total = data?.total ?? sections.reduce((n, s) => n + s.rows.length, 0);

  return (
    <div className="space-y-6" data-testid="admin-todo">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-xl sm:text-2xl font-bold text-brand-navy">À faire</h2>
          <p className="text-sm text-gray-600">
            {total > 0 ? `${total} ligne${total > 1 ? 's' : ''} à traiter` : 'Rien à traiter'}
            {data?.generated_at ? ` · liste générée le ${fmtDateTime(data.generated_at)}` : ''}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" className="rounded-xl self-start" onClick={onReload} disabled={loading} data-testid="todo-reload">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Actualiser
        </Button>
      </div>

      {sections.length === 0 ? (
        <EmptyState icon={Inbox} testId="todo-empty">Rien à traiter. Aucun e-mail « À faire » ne sera envoyé aujourd'hui.</EmptyState>
      ) : (
        sections.map((section) => {
          const Icon = SECTION_ICONS[section.key] || Inbox;
          const tone = SECTION_TONES[section.key] || 'info';
          return (
            <section key={section.key} className="rounded-2xl bg-white border border-brand-line p-4 sm:p-6 min-w-0" aria-labelledby={`todo-${section.key}`} data-testid={`todo-section-${section.key}`}>
              <h3 id={`todo-${section.key}`} className="flex items-center gap-2 font-display text-lg font-bold text-brand-navy mb-3">
                <Icon className={`w-5 h-5 shrink-0 ${tone === 'danger' ? 'text-red-700' : tone === 'warning' ? 'text-brand-amber' : 'text-brand-navy'}`} aria-hidden="true" />
                <span className="min-w-0 break-words">{section.title}</span>
                <span className="ml-auto text-sm font-medium text-gray-600 tabular-nums">{section.rows.length}</span>
              </h3>
              <ul className="space-y-3">
                {section.rows.map((row) => (
                  <li key={row.id} className="flex flex-col lg:flex-row lg:items-start gap-3 rounded-xl border border-brand-line p-4 min-w-0" data-testid={`todo-row-${row.id}`}>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-brand-navy break-words">{row.title}</p>
                      {row.detail && <p className="text-sm text-gray-700 break-words mt-0.5">{row.detail}</p>}
                      {row.since && <p className="text-[13px] text-gray-600 mt-0.5">{sinceText(row.since)}</p>}
                      <RefChips row={row} onNavigate={onNavigate} />
                    </div>
                    {(row.actions || []).length > 0 && (
                      <div className="flex flex-wrap gap-2 lg:justify-end shrink-0">
                        {row.actions.filter((a) => actionKind(a) !== 'open' || tabForUrl(a.url)).map((action) => {
                          const kind = actionKind(action);
                          const tone = kind === 'remove' ? 'danger' : ['Valider', 'Confirmer', 'Marquer payée', 'Marquer vérifiée'].includes(action.label) ? 'primary' : 'outline';
                          return (
                            <ActionButton key={action.label} tone={tone} onClick={() => onAction(action, row)} busy={busy === `${row.id}:${action.label}`} testId={`todo-action-${row.id}-${kind}`}>
                              {action.label}
                            </ActionButton>
                          );
                        })}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}

      <RemovalDialog
        open={dialog?.kind === 'remove'}
        onClose={close}
        listingLabel={dialog?.row?.title}
        onConfirm={(reason, reasonText) => run(dialog.action, dialog.row, { params: { reason, reason_text: reasonText } })}
      />
      <PaidDialog
        open={dialog?.kind === 'paid'}
        onClose={close}
        invoice={dialog ? { number: dialog.row?.ref?.invoice_number, total_ttc: dialog.row?.ref?.total_ttc } : null}
        onConfirm={(body) => run(dialog.action, dialog.row, { body })}
      />
      <NoteDialog
        open={dialog?.kind === 'resolve'}
        onClose={close}
        title={dialog?.action?.body?.action === 'cancel' ? 'Annuler la déclaration de vente' : 'Confirmer la vente'}
        description={dialog?.action?.body?.action === 'cancel'
          ? 'L\'étape de vente revient « en cours » ; la déclaration est conservée dans l\'historique.'
          : 'La vente est confirmée au nom de la plateforme : la facture d\'honoraires est émise et envoyée au cédant, l\'ordre de paiement au rédacteur d\'acte.'}
        confirmLabel={dialog?.action?.label || 'Confirmer'}
        noteLabel="Note (facultative)"
        tone={dialog?.action?.body?.action === 'cancel' ? 'danger' : 'navy'}
        onConfirm={(note) => run(dialog.action, dialog.row, { body: { ...(dialog.action.body || {}), note } })}
        testId="resolve-dialog"
      />
      <NoteDialog
        open={dialog?.kind === 'incident'}
        onClose={close}
        title="Clore l'incident"
        description="L'incident est archivé avec votre note (vente déclarée, fausse alerte, cédant contacté…)."
        confirmLabel="Clore"
        noteLabel="Note (facultative)"
        onConfirm={(note) => run(dialog.action, dialog.row, { body: { ...(dialog.action.body || {}), note } })}
        testId="incident-dialog"
      />
      <ActionDialog
        open={dialog?.kind === 'confirm'}
        onClose={close}
        title={dialog?.action?.label || 'Confirmer'}
        description={dialog?.row?.title}
        confirmLabel={dialog?.action?.label || 'Confirmer'}
        onConfirm={() => run(dialog.action, dialog.row)}
        testId="confirm-dialog"
      />
    </div>
  );
};

export default AdminTodo;
