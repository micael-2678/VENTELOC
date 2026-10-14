import { AlertTriangle, CheckCircle2, HelpCircle, ShieldCheck, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDateFr } from '@/components/shared/formatters';

// Diagnostic de transmissibilité (SPEC §4.6, API.md §8) : rendu de `diagnostic` renvoyé par
// GET /properties/{id}/transmissibility (niveau, qualifications datées, règles titres/fonds, référent, décennale,
// checklist). Les textes viennent du serveur (backend/transmissibility.py) ; rien n'est réécrit ici.

const LEVEL_TONE = {
  elevee: 'border-brand-green/40 bg-brand-green-soft text-brand-green-dark',
  moyenne: 'border-amber-200 bg-brand-amber-soft text-brand-amber',
  fragile: 'border-red-200 bg-red-50 text-red-800',
  'non-applicable': 'border-brand-line bg-brand-surface text-brand-navy',
  'a-completer': 'border-brand-line bg-brand-surface text-brand-navy',
};

const QUALIF_STATUS = {
  valide: { label: 'En cours de validité', tone: 'verified' },
  expire_bientot: { label: 'À renouveler sous six mois', tone: 'warning' },
  expiree: { label: 'Expirée', tone: 'danger' },
  inconnue: { label: 'Date non vérifiée', tone: 'info' },
};

const CHECK_ICON = {
  ok: { icon: CheckCircle2, className: 'text-brand-green' },
  attention: { icon: AlertTriangle, className: 'text-brand-amber' },
  inconnu: { icon: HelpCircle, className: 'text-gray-400' },
};

const badge = (tone) => cn('badge', tone === 'verified' ? 'badge-verified' : tone === 'declared' ? 'badge-declared' : tone === 'warning' ? 'badge-warning' : tone === 'danger' ? 'badge-danger' : 'badge-info');

// Le vert est réservé à ce qui est retrouvé sur la liste ADEME : une qualification seulement déclarée par le cédant
// (SIRET absent de la base RGE) est « déclarée, en cours de validité », en ton neutre, et le diagnostic passe en ambre.
export const ademeVerified = (diag, ademe) => diag?.source === 'ademe' && ademe?.found !== false;
export const qualificationStatus = (q, verified) => {
  const st = QUALIF_STATUS[q?.status] || QUALIF_STATUS.inconnue;
  if (q?.status === 'valide' && !verified) return { label: 'Déclarée, en cours de validité', tone: 'declared' };
  return st;
};
export const levelTone = (level, verified) => {
  if (level === 'elevee' && !verified) return LEVEL_TONE.moyenne;
  return LEVEL_TONE[level] || LEVEL_TONE['a-completer'];
};

const Steps = ({ items }) => (
  <ol className="mt-2 space-y-1 text-sm text-gray-700 list-decimal list-inside">
    {items.map((s) => <li key={s} className="break-words">{s}</li>)}
  </ol>
);

const TransmissibilityPanel = ({ diagnostic, ademe }) => {
  const diag = diagnostic && typeof diagnostic === 'object' ? diagnostic : null;
  if (!diag) return null;
  const qualifications = Array.isArray(diag.qualifications) ? diag.qualifications : [];
  const checklist = Array.isArray(diag.checklist) ? diag.checklist : [];
  const transfer = diag.transfer || null;
  const verified = ademeVerified(diag, ademe);
  const hasDetails = !!(transfer || diag.referent || diag.decennale);

  return (
    <div className="space-y-5 min-w-0" data-testid="transmissibility">
      <section className={cn('rounded-2xl border p-4 sm:p-5 min-w-0', levelTone(diag.level?.value, verified))} aria-labelledby="transmissibility-level" data-testid="transmissibility-level">
        <p className="eyebrow">Diagnostic de transmissibilité</p>
        <h3 id="transmissibility-level" className="font-display text-lg sm:text-xl font-bold mt-1">{diag.level?.label || 'Diagnostic'}</h3>
        {Array.isArray(diag.level?.reasons) && diag.level.reasons.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm list-disc list-inside">
            {diag.level.reasons.map((r) => <li key={r} className="break-words">{r}</li>)}
          </ul>
        )}
        {ademe?.message && !ademe.found && <p className="text-sm mt-2">{ademe.message}</p>}
      </section>

      {qualifications.length > 0 && (
        <section aria-label="Qualifications" className="min-w-0">
          <h4 className="font-display font-bold text-brand-navy">Qualifications{diag.source === 'ademe' ? ' (liste ADEME)' : ' (déclarées par le cédant)'}</h4>
          <ul className="mt-2 divide-y divide-brand-line rounded-xl border border-brand-line bg-white">
            {qualifications.map((q) => {
              const st = qualificationStatus(q, verified);
              return (
                <li key={`${q.name}-${q.organisme}-${q.date_fin || ''}`} className="flex flex-wrap items-start justify-between gap-2 p-3 min-w-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-brand-navy break-words">{q.name}</p>
                    <p className="text-xs text-gray-500 break-words">
                      {[q.organisme_label, q.domaine].filter(Boolean).join(' · ')}
                      {q.date_fin ? ` · valide jusqu'au ${formatDateFr(q.date_fin)}` : ''}
                    </p>
                  </div>
                  <span className={badge(st.tone)} data-testid="qualification-badge">{st.label}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {checklist.length > 0 && (
        <section aria-label="Points à vérifier" className="min-w-0">
          <h4 className="font-display font-bold text-brand-navy">Points à vérifier avant l&apos;offre</h4>
          <ul className="mt-2 space-y-2">
            {checklist.map((item) => {
              const c = CHECK_ICON[item.status] || CHECK_ICON.inconnu;
              const Icon = c.icon;
              return (
                <li key={item.key || item.label} className="flex items-start gap-2 text-sm min-w-0">
                  <Icon className={cn('w-4 h-4 mt-0.5 shrink-0', c.className)} aria-hidden="true" />
                  <span className="min-w-0 break-words"><span className="font-medium text-brand-navy">{item.label}</span>{item.detail ? ` — ${item.detail}` : ''}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {hasDetails && (
      <details className="group rounded-2xl border border-brand-line bg-brand-surface p-4 sm:p-5 min-w-0" data-testid="transfer-details">
        <summary className="cursor-pointer font-display font-bold text-brand-navy select-none">Comprendre le transfert des qualifications</summary>
        <div className="mt-4 space-y-5 min-w-0">
      {transfer && (
        <section aria-label="Selon la forme de cession" className="min-w-0">
          <h4 className="font-display font-bold text-brand-navy">Que deviennent les qualifications selon la forme de cession ?</h4>
          <div className="mt-2 grid md:grid-cols-2 gap-3">
            {['titres', 'fonds'].map((key) => {
              const block = transfer[key];
              if (!block) return null;
              const chosen = transfer.chosen === key;
              return (
                <article key={key} className={cn('rounded-xl border p-4 min-w-0', chosen ? 'border-brand-navy bg-white' : 'border-brand-line bg-white')}>
                  <p className="font-semibold text-brand-navy break-words">
                    {block.label}
                    {chosen && <span className="badge badge-locked ml-2">Envisagé par le cédant</span>}
                  </p>
                  {block.summary && <p className="text-sm text-gray-700 mt-1 leading-relaxed">{block.summary}</p>}
                  {Array.isArray(block.steps) && block.steps.length > 0 && <Steps items={block.steps} />}
                </article>
              );
            })}
          </div>
          {transfer.recommendation && <p className="text-sm text-gray-700 mt-3 leading-relaxed rounded-xl bg-brand-surface border border-brand-line p-4">{transfer.recommendation}</p>}
        </section>
      )}

      <div className="grid md:grid-cols-2 gap-3">
        {diag.referent && (
          <article className="rounded-xl border border-brand-line bg-white p-4 min-w-0">
            <h4 className="font-display font-bold text-brand-navy flex items-center gap-2"><Wrench className="w-4 h-4 text-gray-500" aria-hidden="true" />{diag.referent.label}</h4>
            {diag.referent.stays === true && <p className="badge badge-verified mt-2">Le référent reste après la cession</p>}
            {diag.referent.stays === false && <p className="badge badge-warning mt-2">Le référent part : remplaçant à prévoir</p>}
            <p className="text-sm text-gray-700 mt-2 leading-relaxed">{diag.referent.text}</p>
            {Array.isArray(diag.referent.steps) && <Steps items={diag.referent.steps} />}
          </article>
        )}
        {diag.decennale && (
          <article className="rounded-xl border border-brand-line bg-white p-4 min-w-0">
            <h4 className="font-display font-bold text-brand-navy flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-gray-500" aria-hidden="true" />{diag.decennale.label}</h4>
            {diag.decennale.ok === true && <p className="badge badge-verified mt-2">Déclarée à jour par le cédant</p>}
            {diag.decennale.ok === false && <p className="badge badge-warning mt-2">Déclarée non à jour</p>}
            <dl className="text-sm mt-2 space-y-2">
              <div><dt className="font-semibold text-brand-navy">Cession de titres</dt><dd className="text-gray-700 leading-relaxed">{diag.decennale.titres}</dd></div>
              <div><dt className="font-semibold text-brand-navy">Cession de fonds</dt><dd className="text-gray-700 leading-relaxed">{diag.decennale.fonds}</dd></div>
            </dl>
            {Array.isArray(diag.decennale.steps) && <Steps items={diag.decennale.steps} />}
          </article>
        )}
      </div>
        </div>
      </details>
      )}

      {diag.disclaimer && <p className="text-xs text-gray-500 leading-relaxed">{diag.disclaimer}</p>}
    </div>
  );
};

export default TransmissibilityPanel;
