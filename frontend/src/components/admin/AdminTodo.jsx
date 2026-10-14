import { useState } from 'react';
import { toast } from 'sonner';
import { CalendarClock, Cog, Eye, FileCheck2, Flag, FolderOpen, Handshake, Inbox, Receipt, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LISTING_FLAG_LABELS } from '@/components/seller/listingStatus';
import { downloadPdf } from '@/lib/mandate';
import { apiErrorMessage, isEmailNotVerifiedError } from '@/components/account/errors';
import { propertyPath } from '@/components/buyer/api';
import {
  ActionButton, ActionDialog, EmptyState, ExtLink, Loading, NoteDialog, OwnershipRejectDialog, PaidDialog, Pill, RemovalDialog,
  callAction, fmtDate, fmtDateTime, fmtEur, fmtEurCents, jobsRunSummary, openOwnershipProof, ownershipDocLabel, sinceText, tabForUrl,
} from './shared';

// Onglet par défaut « À faire » (SPEC §9, API.md §9) : sections de GET /admin/todo, chaque ligne avec ses actions
// appelées telles quelles ({method, url, body}). « Retirer avec motif » ouvre la liste des motifs ; « Marquer payée »
// demande la date et le montant ; les résolutions de vente acceptent une note. Section « Justificatifs de propriété à
// contrôler » (`ownership_proofs`) : aperçu du fichier, Valider, Refuser avec motif (PUT /admin/properties/{id}/ownership).

export const OWNERSHIP_SECTION = 'ownership_proofs';

const SECTION_ICONS = {
  ownership_proofs: FileCheck2,
  listings_review: Flag,
  dataroom_unanswered: FolderOpen,
  closings_declared: Handshake,
  closings_stale: Handshake,
  todos: Receipt,
  mandates_expiring: CalendarClock,
  job_failures: Cog,
  kyc_manual: ShieldCheck,
};

// Intitulés de repli quand le serveur n'en fournit pas
const SECTION_TITLES = { ownership_proofs: 'Justificatifs de propriété à contrôler' };

const SECTION_TONES = { ownership_proofs: 'warning', closings_declared: 'warning', job_failures: 'danger', todos: 'warning' };

const SUCCESS_MESSAGES = {
  Valider: 'Annonce validée : la relecture est close.',
  Clore: 'Ligne close.',
  Confirmer: 'Vente confirmée : la facture d\'honoraires est émise et envoyée au vendeur.',
  'Annuler la déclaration': 'Déclaration annulée : l\'étape de vente revient « en cours ».',
  'Marquer vérifiée': 'Identité marquée comme vérifiée.',
  'Marquer payée': 'Encaissement enregistré.',
  'Relancer le vendeur': 'Relance envoyée au vendeur.',
  'Retirer avec motif': 'Annonce retirée : le vendeur est informé du motif.',
};
const OWNERSHIP_MESSAGES = {
  verified: 'Justificatif validé : le badge « Propriétaire vérifié » est affiché et le vendeur est prévenu.',
  rejected: 'Justificatif refusé : le vendeur reçoit le motif par e-mail.',
};

// Décision sur un justificatif de propriété : PUT /admin/properties/{id}/ownership
const OWNERSHIP_URL = /\/admin\/properties\/([^/?]+)\/ownership$/;
// Aperçu du justificatif : GET /properties/{id}/ownership-proof/file (fichier authentifié, jamais public)
const PROOF_FILE_URL = /\/properties\/([^/?]+)\/ownership-proof\/file$/;
const proofPropertyId = (action, row) => (PROOF_FILE_URL.exec(String(action?.url || '').split('?')[0]) || [])[1] || row?.ref?.property_id;
const ownershipDecision = (action) => {
  const body = action?.body || {};
  if (body.status === 'rejected' || /refus/i.test(String(action?.label || ''))) return 'rejected';
  return 'verified';
};

// Actions d'une ligne : celles du serveur ; pour un justificatif sans action fournie, Valider et Refuser par défaut
export const rowActions = (section, row) => {
  const actions = Array.isArray(row?.actions) ? row.actions : [];
  const propertyId = row?.ref?.property_id;
  if (section?.key !== OWNERSHIP_SECTION || actions.length || !propertyId) return actions;
  const url = `/admin/properties/${propertyId}/ownership`;
  return [
    { label: 'Valider', method: 'PUT', url, body: { status: 'verified' } },
    { label: 'Refuser avec motif', method: 'PUT', url, body: { status: 'rejected' } },
  ];
};

// Nature d'une action pour choisir l'interface (boîte de motif, de montant, de note, téléchargement, onglet)
export const actionKind = (action) => {
  const url = String(action?.url || '');
  const method = String(action?.method || 'GET').toUpperCase();
  if (OWNERSHIP_URL.test(url.split('?')[0])) return ownershipDecision(action) === 'rejected' ? 'ownership_reject' : 'ownership_verify';
  if (PROOF_FILE_URL.test(url.split('?')[0])) return 'proof';
  if (action?.reasons || /<motif>/.test(url) || /status=removed/.test(url)) return 'remove';
  if (/\/admin\/invoices\/[^/?]+\/paid$/.test(url)) return 'paid';
  if (/\/resolve$/.test(url) && method !== 'GET') return 'resolve';
  if (method === 'GET') return /\.pdf$/.test(url) ? 'pdf' : 'open';
  if (/\/done$/.test(url)) return 'confirm';
  return 'call';
};

const isJobsRun = (action) => /\/admin\/jobs\/run$/.test(String(action?.url || ''));

// Données de référence d'une ligne, libellées (jamais d'identifiant brut)
const RefChips = ({ row, onNavigate, onPreview, previewing }) => {
  const ref = row.ref || {};
  const chips = [];
  if (ref.doc_type) chips.push(<Pill wrap key="doc" tone="info">{ownershipDocLabel(ref.doc_type)}{ref.uploaded_at ? ` · déposé le ${fmtDate(ref.uploaded_at)}` : ''}</Pill>);
  if (ref.owner_type === 'sci' || ref.owner_type === 'societe') chips.push(<Pill wrap key="owner" tone="info">Bien détenu par une société</Pill>);
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
  if (onPreview && ref.property_id) {
    links.push(
      <button key="proof" type="button" onClick={onPreview} disabled={previewing} className="inline-flex items-center gap-1 text-sm font-medium text-brand-blue underline underline-offset-2 hover:text-brand-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue rounded disabled:opacity-60" data-testid={`todo-proof-${row.id}`}>
        <Eye className="w-4 h-4" aria-hidden="true" />
        Voir le justificatif
      </button>,
    );
  }
  if (ref.property_id) {
    links.push(<ExtLink key="fiche" href={propertyPath(ref.property_id)}>Fiche publique</ExtLink>);
    links.push(<button key="listing" type="button" onClick={() => onNavigate('properties', { id: ref.property_id })} className="text-sm font-medium text-brand-blue underline underline-offset-2 hover:text-brand-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue rounded">Annonce</button>);
  }
  if (ref.closing_id) links.push(<button key="closing" type="button" onClick={() => onNavigate('closings', { id: ref.closing_id })} className="text-sm font-medium text-brand-blue underline underline-offset-2 hover:text-brand-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue rounded">Étape de vente</button>);
  if (ref.invoice_id) links.push(<button key="invoice" type="button" onClick={() => onNavigate('invoices', { id: ref.invoice_id })} className="text-sm font-medium text-brand-blue underline underline-offset-2 hover:text-brand-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue rounded">Facture</button>);
  if (ref.mandate_id) links.push(<button key="mandate" type="button" onClick={() => onNavigate('mandates', { id: ref.mandate_id })} className="text-sm font-medium text-brand-blue underline underline-offset-2 hover:text-brand-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue rounded">Registre des mandats</button>);
  if (ref.user_id) links.push(<button key="user" type="button" onClick={() => onNavigate('users', { id: ref.user_id })} className="text-sm font-medium text-brand-blue underline underline-offset-2 hover:text-brand-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue rounded">Compte</button>);
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

  const [previewing, setPreviewing] = useState('');

  const preview = async (row, propertyId = row.ref?.property_id) => {
    setPreviewing(row.id);
    try {
      await openOwnershipProof(propertyId);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Le justificatif n\'a pas pu être ouvert.'));
    } finally {
      setPreviewing('');
    }
  };

  const successMessage = (action, result) => {
    if (isJobsRun(action)) return jobsRunSummary(result);
    const kind = actionKind(action);
    if (kind === 'ownership_verify') return OWNERSHIP_MESSAGES.verified;
    if (kind === 'ownership_reject') return OWNERSHIP_MESSAGES.rejected;
    return SUCCESS_MESSAGES[action.label] || 'Action effectuée.';
  };

  const run = async (action, row, extra) => {
    const key = `${row.id}:${action.label}`;
    setBusy(key);
    try {
      const result = await callAction(action, extra);
      toast.success(successMessage(action, result));
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
      if (tab) onNavigate(tab, { id: row.ref?.closing_id || row.ref?.invoice_id || row.ref?.mandate_id || row.ref?.user_id || row.ref?.property_id || null });
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
    if (kind === 'proof') {
      preview(row, proofPropertyId(action, row));
      return;
    }
    if (kind === 'ownership_verify') {
      run(action, row, { body: { ...(action.body || {}), status: 'verified' } }).catch(() => {});
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
                <span className="min-w-0 break-words">{section.title || SECTION_TITLES[section.key] || 'À traiter'}</span>
                <span className="ml-auto text-sm font-medium text-gray-600 tabular-nums">{section.rows.length}</span>
              </h3>
              <ul className="space-y-3">
                {section.rows.map((row) => (
                  <li key={row.id} className="flex flex-col lg:flex-row lg:items-start gap-3 rounded-xl border border-brand-line p-4 min-w-0" data-testid={`todo-row-${row.id}`}>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-brand-navy break-words">{row.title}</p>
                      {row.detail && <p className="text-sm text-gray-700 break-words mt-0.5">{row.detail}</p>}
                      {row.since && <p className="text-[13px] text-gray-600 mt-0.5">{sinceText(row.since)}</p>}
                      <RefChips
                        row={row}
                        onNavigate={onNavigate}
                        onPreview={section.key === OWNERSHIP_SECTION && row.ref?.property_id && !rowActions(section, row).some((a) => actionKind(a) === 'proof') ? () => preview(row) : null}
                        previewing={previewing === row.id}
                      />
                    </div>
                    {rowActions(section, row).length > 0 && (
                      <div className="flex flex-wrap gap-2 lg:justify-end shrink-0">
                        {rowActions(section, row).filter((a) => actionKind(a) !== 'open' || tabForUrl(a.url)).map((action) => {
                          const kind = actionKind(action);
                          const tone = kind === 'remove' || kind === 'ownership_reject' ? 'danger' : kind === 'ownership_verify' || ['Valider', 'Confirmer', 'Marquer payée', 'Marquer vérifiée'].includes(action.label) ? 'primary' : 'outline';
                          return (
                            <ActionButton key={action.label} tone={tone} onClick={() => onAction(action, row)} busy={busy === `${row.id}:${action.label}` || (kind === 'proof' && previewing === row.id)} testId={`todo-action-${row.id}-${kind}`}>
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
          : 'La vente est confirmée au nom de la plateforme : la facture d\'honoraires est émise et envoyée au vendeur, l\'ordre de paiement au notaire.'}
        confirmLabel={dialog?.action?.label || 'Confirmer'}
        noteLabel="Note (facultative)"
        tone={dialog?.action?.body?.action === 'cancel' ? 'danger' : 'navy'}
        onConfirm={(note) => run(dialog.action, dialog.row, { body: { ...(dialog.action.body || {}), note } })}
        testId="resolve-dialog"
      />
      <OwnershipRejectDialog
        open={dialog?.kind === 'ownership_reject'}
        onClose={close}
        listingLabel={dialog?.row?.title}
        onConfirm={(note) => run(dialog.action, dialog.row, { body: { ...(dialog.action.body || {}), status: 'rejected', note } })}
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
