import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

// Liste d'étapes avec état (SPEC §4.3 point 5 et §4.2 point 3) : done (fait), current (en cours), todo (à faire).
// items : [{ id, label, description?, state: 'done'|'current'|'todo', action?: nœud React }]

const STATE_LABEL = { done: 'Fait', current: 'En cours', todo: 'À faire' };

const normalizeState = (state) => (state === 'done' || state === 'current' ? state : 'todo');

const Marker = ({ state, index }) => {
  if (state === 'done') {
    return (
      <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-brand-navy text-white shrink-0" aria-hidden="true">
        <Check className="w-4 h-4" strokeWidth={3} />
      </span>
    );
  }
  if (state === 'current') {
    return (
      <span className="inline-flex items-center justify-center w-8 h-8 rounded-full border-2 border-brand-blue text-brand-blue font-bold tabular shrink-0 ring-4 ring-brand-blue/15" aria-hidden="true">
        {index + 1}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-center w-8 h-8 rounded-full border-2 border-brand-line text-gray-500 font-semibold tabular shrink-0" aria-hidden="true">
      {index + 1}
    </span>
  );
};

const Checklist = ({ items, title, className = '', compact = false, ariaLabel = 'Étapes' }) => {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) return null;
  const done = list.filter((i) => normalizeState(i.state) === 'done').length;

  return (
    <div className={cn('min-w-0', className)} data-testid="checklist">
      {title && (
        <div className="flex items-center justify-between gap-3 mb-3">
          <p className="font-display font-bold text-brand-navy text-lg">{title}</p>
          <p className="text-sm text-gray-600 tabular shrink-0">{done} / {list.length}</p>
        </div>
      )}
      <ol aria-label={title ? undefined : ariaLabel} className="space-y-0">
        {list.map((item, index) => {
          const state = normalizeState(item.state);
          const last = index === list.length - 1;
          return (
            <li
              key={item.id || item.label}
              aria-current={state === 'current' ? 'step' : undefined}
              className={cn('relative flex gap-3 min-w-0', compact ? 'pb-4' : 'pb-6', last && 'pb-0')}
            >
              {!last && <span className="absolute left-4 top-8 bottom-0 w-px bg-brand-line" aria-hidden="true" />}
              <Marker state={state} index={index} />
              <div className={cn('min-w-0 flex-1', state === 'todo' && 'opacity-80')}>
                <p className={cn('leading-snug break-words', state === 'current' ? 'font-semibold text-brand-navy' : 'font-medium text-brand-navy')}>
                  {item.label}
                  <span className="sr-only"> — {STATE_LABEL[state]}</span>
                </p>
                {item.description && <p className="text-sm text-gray-600 mt-0.5 leading-relaxed break-words">{item.description}</p>}
                {item.action && state !== 'done' && <div className="mt-2">{item.action}</div>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
};

export default Checklist;
