import { AlertTriangle, FileText, Info, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { leaseTypeLabel } from '@/lib/referentiels';
import { formatDateFr } from '@/components/shared/formatters';

// Fiche de reprise du bail (SPEC §6.2, API.md §4) : rendu de GET /properties/{id}/lease-transfer
// {lease_type, regime, points: [{key, title, text, level: 'info'|'attention'}], dpe?: {status, date, text}, summary, disclaimer}.
// Les textes viennent du serveur (backend/bail.py, références légales) ; rien n'est réécrit ici.

const REGIME_LABELS = {
  habitation: 'Bail d\'habitation (loi du 6 juillet 1989)',
  commercial: 'Bail commercial',
  professionnel: 'Bail professionnel',
  autre: 'Location hors statut',
};

// Décence énergétique : alerte ambre si la location est interdite ou à échéance (SPEC §5.1)
export const dpeTone = (status) => (status === 'interdit' || status === 'echeance' ? 'attention' : 'info');

const Point = ({ point }) => {
  const attention = point.level === 'attention';
  const Icon = attention ? AlertTriangle : Info;
  return (
    <li className={cn('flex items-start gap-3 rounded-xl border p-3 sm:p-4 min-w-0', attention ? 'border-amber-200 bg-brand-amber-soft' : 'border-brand-line bg-white')} data-testid={`lease-point-${point.key}`}>
      <Icon className={cn('w-5 h-5 mt-0.5 shrink-0', attention ? 'text-brand-amber' : 'text-gray-500')} aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-semibold text-brand-navy break-words">
          {point.title}
          {attention && <span className="sr-only"> (point d&apos;attention)</span>}
        </p>
        {point.text && <p className="text-sm text-gray-700 mt-0.5 leading-relaxed break-words">{point.text}</p>}
      </div>
    </li>
  );
};

const LeaseTransferPanel = ({ data }) => {
  const d = data && typeof data === 'object' ? data : null;
  if (!d) return null;
  const points = Array.isArray(d.points) ? d.points.filter((p) => p && (p.title || p.text)) : [];
  const summary = Array.isArray(d.summary) ? d.summary.filter(Boolean) : [];
  const lease = leaseTypeLabel(d.lease_type) || REGIME_LABELS[d.regime] || '';
  const dpe = d.dpe && d.dpe.text ? d.dpe : null;
  const attentionCount = points.filter((p) => p.level === 'attention').length;

  return (
    <div className="space-y-5 min-w-0" data-testid="lease-transfer">
      <header className="min-w-0">
        <p className="eyebrow">Fiche de reprise du bail</p>
        <h3 className="font-display text-lg sm:text-xl font-bold text-brand-navy mt-1 flex items-center gap-2">
          <FileText className="w-5 h-5 shrink-0 text-gray-500" aria-hidden="true" />
          Ce que devient la location quand vous achetez
        </h3>
        {lease && <p className="text-sm text-gray-600 mt-1">{lease}{attentionCount > 0 ? ` · ${attentionCount} point${attentionCount > 1 ? 's' : ''} d'attention` : ''}</p>}
      </header>

      {summary.length > 0 && (
        <section className="rounded-2xl border border-brand-line bg-brand-surface p-4 sm:p-5 min-w-0" aria-label="L'essentiel" data-testid="lease-summary">
          <p className="text-sm font-semibold text-brand-navy">L&apos;essentiel</p>
          <ul className="mt-2 space-y-1.5 text-sm text-gray-800 list-disc pl-5 leading-relaxed">
            {summary.map((line) => <li key={line} className="break-words">{line}</li>)}
          </ul>
        </section>
      )}

      {dpe && (
        <section
          className={cn('flex items-start gap-3 rounded-2xl border p-4 min-w-0', dpeTone(dpe.status) === 'attention' ? 'border-amber-300 bg-brand-amber-soft' : 'border-brand-line bg-white')}
          role={dpeTone(dpe.status) === 'attention' ? 'note' : undefined}
          aria-label="Décence énergétique"
          data-testid="lease-dpe"
        >
          <Zap className={cn('w-5 h-5 mt-0.5 shrink-0', dpeTone(dpe.status) === 'attention' ? 'text-brand-amber' : 'text-gray-500')} aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-semibold text-brand-navy">
              Décence énergétique{dpe.date ? ` · échéance du ${formatDateFr(dpe.date)}` : ''}
            </p>
            <p className="text-sm text-gray-800 mt-0.5 leading-relaxed">{dpe.text}</p>
          </div>
        </section>
      )}

      {points.length > 0 && (
        <section aria-label="Points de la reprise du bail" className="min-w-0">
          <ul className="space-y-2">
            {points.map((p) => <Point key={p.key || p.title} point={p} />)}
          </ul>
        </section>
      )}

      {d.disclaimer && <p className="text-[13px] text-gray-600 leading-relaxed" data-testid="lease-disclaimer">{d.disclaimer}</p>}
    </div>
  );
};

export default LeaseTransferPanel;
