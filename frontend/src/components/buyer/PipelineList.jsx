import { Link } from 'react-router-dom';
import { ChevronRight, FolderLock, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { propertyTitle } from '@/lib/referentiels';
import { formatPrice, formatDateFr } from '@/components/shared/formatters';
import { PIPELINE_STAGES } from './api';

// « Mes dossiers » (SPEC §5.3) : une ligne par bien, étape atteinte (contacté → dossier demandé → engagement de
// confidentialité → dossier → offre → vente), lien direct vers la page utile. Liste (pas de tableau) : lisible au doigt
// sous 640 px.

export const titleOf = (property) => {
  if (!property) return '';
  if (property.title) return property.title;
  return propertyTitle({
    propertyType: property.property_type, city: property.city, department: property.department,
    surface: property.surface, rooms: property.rooms, unitsCount: property.units_count,
  });
};

const STAGE_INDEX = PIPELINE_STAGES.reduce((acc, s, i) => { acc[s.key] = i; return acc; }, {});

const StageTrack = ({ stage }) => {
  const idx = STAGE_INDEX[stage] ?? 0;
  return (
    <ol className="flex items-center gap-1" aria-label={`Étape : ${PIPELINE_STAGES[idx].label}`}>
      {PIPELINE_STAGES.map((s, i) => (
        <li key={s.key} className="flex items-center gap-1">
          <span
            className={cn('block h-1.5 w-5 sm:w-7 rounded-full', i <= idx ? 'bg-brand-navy' : 'bg-brand-line')}
            title={s.label}
          />
        </li>
      ))}
    </ol>
  );
};

const rowLink = (row) => {
  if (row.closing?.id) return `/vente/${row.closing.id}`;
  if (row.stage === 'offer' || row.stage === 'dataroom' || row.stage === 'nda' || row.stage === 'requested') return `/dataroom/${row.propertyId}`;
  return `/messages?conversation=${encodeURIComponent(row.conversationId || row.propertyId)}`;
};

const PipelineList = ({ rows }) => {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    return (
      <div className="rounded-xl border border-dashed border-brand-line bg-white p-6 text-center" data-testid="pipeline-empty">
        <FolderLock className="w-8 h-8 text-gray-400 mx-auto mb-2" aria-hidden="true" />
        <p className="font-semibold text-brand-navy">Aucun dossier en cours</p>
        <p className="text-sm text-gray-600 mt-1">Chaque bien pour lequel vous contactez le vendeur apparaît ici, avec l&apos;étape atteinte : contact, dossier demandé, engagement de confidentialité, dossier, offre d&apos;achat, vente.</p>
      </div>
    );
  }
  return (
    <ul className="space-y-2" data-testid="pipeline-list">
      {list.map((row) => {
        const stage = PIPELINE_STAGES[STAGE_INDEX[row.stage] ?? 0];
        const title = row.title || titleOf(row.property) || 'Bien';
        const price = row.property?.asking_price;
        return (
          <li key={row.propertyId} className="min-w-0">
            <Link to={rowLink(row)} className="card card-hover card-link p-4 flex items-center gap-3 min-w-0" data-testid={`pipeline-${row.propertyId}`}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <p className="font-display font-bold text-brand-navy leading-snug break-words">{title}</p>
                  {row.unread > 0 && <span className="badge badge-warning"><MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />{row.unread} non lu{row.unread > 1 ? 's' : ''}</span>}
                </div>
                <p className="text-sm text-gray-600 mt-0.5 break-words">
                  <span className="font-medium text-brand-navy">{stage.label}</span>
                  {row.detail ? ` · ${row.detail}` : ''}
                  {price != null ? ` · ${formatPrice(price)}` : ''}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <StageTrack stage={row.stage} />
                  {row.lastAt && <span className="text-xs text-gray-500">{formatDateFr(row.lastAt)}</span>}
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-400 shrink-0" aria-hidden="true" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
};

export default PipelineList;
