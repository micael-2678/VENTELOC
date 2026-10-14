import { Link } from 'react-router-dom';
import { FileSignature, ShieldCheck, MessageSquare, Euro, Handshake, AlertTriangle, CalendarPlus, Inbox, FileCheck2 } from 'lucide-react';
import { KYCVerificationButton } from '@/components/KYCVerification';
import { listingTitle } from '@/components/shared';
import { formatEur } from '@/lib/format';
import { daysUntil, formatDateTimeFr } from '@/lib/mandate';
import { AccessRequestCard } from './AccessRequests';
import { blockingReasons, ownershipStatusOf } from './listingStatus';

// Bloc « À traiter » (docs/venteloc/SPEC.md §5.2 point 5) : tout ce qui attend une action du vendeur, par ordre d'urgence
// (identité, mandat, justificatif de propriété à déposer ou refusé, demandes de dossier, offres, messages, vente).
// Rien n'est affiché s'il n'y a rien à faire (aucun compteur à zéro).
const Row = ({ icon: Icon, tone = 'navy', title, text, action, testId }) => (
  <li className={`flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border p-4 min-w-0 ${tone === 'amber' ? 'border-amber-200 bg-brand-amber-soft/40' : tone === 'red' ? 'border-red-200 bg-red-50' : 'border-brand-line bg-white'}`} data-testid={testId}>
    <Icon className={`w-5 h-5 shrink-0 ${tone === 'amber' ? 'text-brand-amber' : tone === 'red' ? 'text-red-700' : 'text-brand-navy'}`} aria-hidden="true" />
    <div className="min-w-0 flex-1">
      <p className="font-semibold text-brand-navy break-words">{title}</p>
      {text && <p className="text-sm text-gray-700 break-words">{text}</p>}
    </div>
    {action && <div className="shrink-0">{action}</div>}
  </li>
);

const TodoBlock = ({ user, kyc, properties, requestsByProperty, offersByProperty, conversations, closings, mandatesByProperty, onSelect, onChanged }) => {
  const verified = !!(kyc?.verified || user?.identity_verified || user?.kyc_status === 'verified');
  const rows = [];
  const unpublished = properties.filter((c) => ['draft', 'mandat_en_attente'].includes(c.status));

  if (!verified && unpublished.length > 0) {
    rows.push(<Row key="identity" icon={ShieldCheck} tone="amber" title="Vérifiez votre identité" text="Indispensable pour signer le mandat et publier : pièce d'identité et selfie, environ 2 minutes, dans cet onglet." action={<KYCVerificationButton user={user} className="rounded-xl bg-brand-teal hover:bg-brand-teal-dark text-white" />} testId="todo-identity" />);
  }

  properties.filter((c) => c.status === 'mandat_en_attente').forEach((c) => {
    rows.push(<Row key={`mandate-${c.id}`} icon={FileSignature} tone="amber" title="Mandat de vente à signer" text={`${listingTitle(c)} : dernière étape avant la publication immédiate. Mandat simple, sans exclusivité, 12 mois, signature par code.`} action={<Link to={`/seller/mandat/${c.id}`} className="btn-primary" data-testid={`todo-sign-${c.id}`}>Signer le mandat</Link>} testId={`todo-mandate-${c.id}`} />);
  });

  // Justificatif de propriété : refusé (à remplacer) ou pas encore déposé pour une annonce non retirée
  properties.filter((c) => !['withdrawn', 'sold', 'sold_elsewhere', 'removed'].includes(c.status)).forEach((c) => {
    const st = ownershipStatusOf(c);
    if (st === 'rejected') {
      rows.push(<Row key={`ownership-${c.id}`} icon={FileCheck2} tone="red" title="Justificatif de propriété refusé" text={`${listingTitle(c)}${c.ownership?.note ? ` : ${c.ownership.note}` : ''}. Déposez un nouveau document.`} action={<button type="button" onClick={() => onSelect(c.id, 'ownership')} className="btn-primary" data-testid={`todo-ownership-${c.id}`}>Déposer un justificatif</button>} testId={`todo-ownership-rejected-${c.id}`} />);
    } else if (st === 'missing') {
      rows.push(<Row key={`ownership-${c.id}`} icon={FileCheck2} tone="amber" title="Justificatif de propriété à déposer" text={`${listingTitle(c)} : titre de propriété, attestation notariée, avis de taxe foncière ou statuts de la SCI. Indispensable pour publier.`} action={<button type="button" onClick={() => onSelect(c.id, 'ownership')} className="btn-secondary" data-testid={`todo-ownership-${c.id}`}>Déposer</button>} testId={`todo-ownership-missing-${c.id}`} />);
    }
  });

  // Motifs à corriger dans l'annonce (identité, mandat et justificatif ont leur propre ligne ci-dessus)
  const toFix = (c) => blockingReasons(c).filter((r) => ['edit', 'contact'].includes(r.action));
  properties.filter((c) => ['draft', 'mandat_en_attente'].includes(c.status) && toFix(c).length).forEach((c) => {
    const reasons = toFix(c).map((r) => r.label).join(' ; ');
    rows.push(<Row key={`blocked-${c.id}`} icon={AlertTriangle} tone="red" title="Publication bloquée" text={`${listingTitle(c)} : ${reasons}.`} action={<Link to={`/seller/edit/${c.id}`} className="btn-secondary">Corriger</Link>} testId={`todo-blocked-${c.id}`} />);
  });

  properties.filter((c) => c.status === 'draft' && !toFix(c).length && !(c.asking_price > 0 && c.rent_monthly > 0)).forEach((c) => {
    rows.push(<Row key={`draft-${c.id}`} icon={FileSignature} title="Brouillon à terminer" text={listingTitle(c)} action={<Link to={`/seller/edit/${c.id}`} className="btn-secondary">Reprendre</Link>} testId={`todo-draft-${c.id}`} />);
  });

  const pendingRequests = [];
  properties.forEach((c) => (requestsByProperty[c.id] || []).filter((r) => r.status === 'pending').forEach((r) => pendingRequests.push({ property: c, request: r })));

  properties.forEach((c) => (offersByProperty[c.id] || []).filter((o) => o.status === 'pending').forEach((o) => {
    rows.push(<Row key={`offer-${o.id}`} icon={Euro} tone="amber" title={`Offre d'achat reçue : ${formatEur(o.amount)}`} text={`${listingTitle(c)} · ${o.buyer_label || 'acquéreur'}${o.expires_at ? ` · valable jusqu'au ${formatDateTimeFr(o.expires_at)}` : ''}`} action={<button type="button" onClick={() => onSelect(c.id, 'offers')} className="btn-primary">Répondre</button>} testId={`todo-offer-${o.id}`} />);
  }));

  const unread = (conversations || []).filter((conv) => conv.unread_count > 0);
  if (unread.length) {
    const total = unread.reduce((s, conv) => s + conv.unread_count, 0);
    const first = unread[0];
    rows.push(<Row key="messages" icon={MessageSquare} title={total > 1 ? `${total} messages non lus` : 'Un message non lu'} text={unread.length > 1 ? `${unread.length} conversations avec des acquéreurs attendent une réponse.` : `${first.other_party_label || 'Un acquéreur'} vous a écrit.`} action={<Link to={unread.length === 1 ? `/messages?conversation=${encodeURIComponent(first.id)}` : '/messages'} className="btn-secondary">Répondre</Link>} testId="todo-messages" />);
  }

  (closings || []).filter((cl) => cl.status === 'declared' && cl.declared?.by && cl.declared.by !== 'seller').forEach((cl) => {
    rows.push(<Row key={`closing-confirm-${cl.id}`} icon={Handshake} tone="amber" title="Vente déclarée par l'acquéreur : à confirmer" text={`${cl.property_title || ''}${cl.declared?.final_price ? ` · ${formatEur(cl.declared.final_price)}` : ''}${cl.confirm_deadline ? ` · confirmation automatique le ${formatDateTimeFr(cl.confirm_deadline)}` : ''}`} action={<Link to={`/vente/${cl.id}`} className="btn-primary">Vérifier et confirmer</Link>} testId={`todo-closing-${cl.id}`} />);
  });
  (closings || []).filter((cl) => cl.status === 'in_progress').forEach((cl) => {
    rows.push(<Row key={`closing-${cl.id}`} icon={Handshake} title="Étape de vente en cours" text={`${cl.property_title || ''} : renseignez le notaire en charge de la vente et déclarez la vente dès la signature de l'acte authentique.`} action={<Link to={`/vente/${cl.id}`} className="btn-secondary">Suivre la vente</Link>} testId={`todo-closing-${cl.id}`} />);
  });

  properties.forEach((c) => {
    const m = mandatesByProperty[c.id];
    const days = m?.status === 'signed' ? daysUntil(m.ends_at) : null;
    if (days !== null && days <= 30 && ['published', 'paused'].includes(c.status)) {
      rows.push(<Row key={`renew-${c.id}`} icon={CalendarPlus} tone="amber" title={days > 0 ? `Mandat à échéance dans ${days} j` : 'Mandat à échéance'} text={`${listingTitle(c)} : prolongez de 12 mois par une nouvelle signature, sinon l'annonce sera retirée le ${formatDateTimeFr(m.ends_at)}.`} action={<button type="button" onClick={() => onSelect(c.id, 'mandate')} className="btn-secondary">Prolonger</button>} testId={`todo-renew-${c.id}`} />);
    }
  });

  if (!rows.length && !pendingRequests.length) return null;

  return (
    <section className="mb-8" aria-labelledby="todo-title" data-testid="todo-block">
      <h2 id="todo-title" className="flex items-center gap-2 font-display text-xl font-bold text-brand-navy mb-3">
        <Inbox className="w-5 h-5" aria-hidden="true" />
        À traiter
      </h2>
      {rows.length > 0 && <ul className="space-y-3 mb-4">{rows}</ul>}
      {pendingRequests.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-brand-navy">{pendingRequests.length > 1 ? `${pendingRequests.length} demandes de dossier à traiter` : 'Une demande de dossier à traiter'} · sans réponse sous 10 jours, la demande expire</p>
          <div className="grid gap-4 lg:grid-cols-2">
            {pendingRequests.map(({ property, request }) => (
              <div key={request.id} className="min-w-0">
                <p className="text-xs text-gray-500 mb-1 truncate">{listingTitle(property)}</p>
                <AccessRequestCard request={request} propertyId={property.id} onChanged={onChanged} compact />
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};

export default TodoBlock;
