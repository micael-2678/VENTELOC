import { useId } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

// Groupe de choix (un seul ou plusieurs) avec un état coché impossible à manquer : carte pleine navy,
// coche blanche dans un disque, récapitulatif des choix au-dessus de la liste. Entrées natives (clavier, lecteur
// d'écran) : <input type="radio|checkbox"> masqué visuellement, carte = <label>.
//
// options : [{ value, label, hint? }] ; multiple : value = tableau ; sinon value = chaîne.
const ChoiceGroup = ({
  legend,
  name,
  options,
  value,
  onChange,
  multiple = false,
  columns = 2,
  hint,
  error,
  required = false,
  compact = false,
  showSummary = true,
  className = '',
  testId,
}) => {
  const uid = useId();
  const selected = multiple ? (Array.isArray(value) ? value : []) : (value ? [value] : []);
  const labelOf = (v) => options.find((o) => o.value === v)?.label || v;

  const toggle = (v) => {
    if (multiple) {
      onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
    } else {
      onChange(v);
    }
  };

  const gridCols = columns === 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : columns === 2 ? 'sm:grid-cols-2' : '';
  const errorId = error ? `${uid}-error` : undefined;
  const hintId = hint ? `${uid}-hint` : undefined;

  return (
    <fieldset className={cn('min-w-0', className)} aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined} data-testid={testId}>
      <legend className="text-sm font-semibold text-brand-navy mb-1">
        {legend}
        {required && <span aria-hidden="true"> *</span>}
        {multiple && <span className="font-normal text-gray-500"> · plusieurs choix possibles</span>}
      </legend>
      {hint && <p id={hintId} className="text-xs text-gray-500 mb-2">{hint}</p>}

      {showSummary && multiple && (
        <p className="text-sm mb-2 min-w-0 break-words" aria-live="polite">
          {selected.length === 0 ? (
            <span className="text-gray-500">Aucun choix pour l'instant.</span>
          ) : (
            <>
              <span className="font-semibold text-brand-navy">{selected.length} sélectionné{selected.length > 1 ? 's' : ''} :</span>{' '}
              <span className="text-gray-700">{selected.map(labelOf).join(', ')}</span>
              {' · '}
              <button type="button" onClick={() => onChange([])} className="btn-link text-sm">Tout effacer</button>
            </>
          )}
        </p>
      )}

      <div className={cn('grid gap-2 min-w-0', gridCols)}>
        {options.map((o) => {
          const id = `${uid}-${name}-${String(o.value).replace(/[^a-z0-9_-]/gi, '')}`;
          const checked = selected.includes(o.value);
          return (
            <div key={o.value} className="min-w-0">
              <input
                id={id}
                type={multiple ? 'checkbox' : 'radio'}
                name={name}
                value={o.value}
                checked={checked}
                onChange={() => toggle(o.value)}
                className="peer sr-only"
                data-testid={testId ? `${testId}-${o.value}` : undefined}
              />
              <label
                htmlFor={id}
                className={cn(
                  'flex items-start gap-3 rounded-xl border-2 cursor-pointer select-none transition-colors min-w-0',
                  compact ? 'px-3 py-2' : 'px-3.5 py-3',
                  'peer-focus-visible:ring-2 peer-focus-visible:ring-brand-blue peer-focus-visible:ring-offset-2',
                  checked
                    ? 'border-brand-navy bg-brand-navy text-white shadow-md'
                    : 'border-brand-line bg-white text-brand-navy hover:border-brand-navy/60 hover:bg-brand-surface',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-0.5 inline-flex items-center justify-center w-5 h-5 shrink-0 border-2',
                    multiple ? 'rounded-md' : 'rounded-full',
                    checked ? 'border-white bg-white text-brand-navy' : 'border-gray-400 bg-white',
                  )}
                >
                  {checked && <Check className="w-3.5 h-3.5" strokeWidth={3.5} />}
                </span>
                <span className="min-w-0">
                  <span className={cn('block text-sm leading-snug break-words', checked ? 'font-semibold' : 'font-medium')}>{o.label}</span>
                  {o.hint && <span className={cn('block text-xs leading-snug mt-0.5', checked ? 'text-white/80' : 'text-gray-500')}>{o.hint}</span>}
                </span>
              </label>
            </div>
          );
        })}
      </div>
      {error && <p id={errorId} role="alert" className="text-sm text-red-700 mt-2">{error}</p>}
    </fieldset>
  );
};

export default ChoiceGroup;
