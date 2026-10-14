import { Checkbox } from '@/components/ui/checkbox';
import { X } from 'lucide-react';

/**
 * Liste à choix multiples lisible :
 * - mention « plusieurs choix possibles » et compteur de sélection
 * - choix sélectionnés rappelés en puces (retirables) au-dessus de la liste
 * - cases carrées + ligne surlignée quand l'option est cochée
 *
 * options : [{ value, label }] ; selected : tableau de value ; onChange(nouveauTableau)
 * columns : 1 ou 2 ; maxHeight : hauteur max de la liste (classe Tailwind) ou null pour tout afficher
 * emptyLabel : texte affiché sans sélection (vide par défaut : le composant sert à la saisie, pas au filtrage)
 */
const MultiSelectList = ({
  options,
  selected,
  onChange,
  columns = 1,
  maxHeight = null,
  disabled = false,
  showChips = true,
  compact = false,
  testIdPrefix = 'multi',
  emptyLabel = '',
}) => {
  const toggle = (value) => {
    if (disabled) return;
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };
  const labelOf = (value) => options.find((o) => o.value === value)?.label || value;

  return (
    <div>
      <div className="flex items-center justify-between mb-2 text-sm">
        <span className="text-gray-600">Plusieurs choix possibles</span>
        {selected.length > 0 ? (
          <span className="flex items-center gap-2">
            <span className="font-semibold text-brand-navy" data-testid={`${testIdPrefix}-count`}>
              {selected.length} sélectionné{selected.length > 1 ? 's' : ''}
            </span>
            {!disabled && (
              <button type="button" onClick={() => onChange([])} className="text-brand-blue hover:underline">
                Tout effacer
              </button>
            )}
          </span>
        ) : (
          emptyLabel ? <span className="text-gray-600">{emptyLabel}</span> : null
        )}
      </div>

      {showChips && selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3" data-testid={`${testIdPrefix}-chips`}>
          {selected.map((value) => (
            <span key={value} className="inline-flex items-center gap-1 max-w-full bg-brand-navy text-white text-xs rounded-full pl-3 pr-1.5 py-1">
              <span className="truncate">{labelOf(value)}</span>
              {!disabled && (
                <button type="button" onClick={() => toggle(value)} aria-label={`Retirer ${labelOf(value)}`}
                  className="rounded-full hover:bg-white/20 p-0.5">
                  <X className="w-3 h-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      <div
        className={`grid gap-2 ${columns === 2 ? 'sm:grid-cols-2' : ''} ${maxHeight ? `${maxHeight} overflow-y-auto pr-1` : ''}`}
        role="group"
      >
        {options.map((option) => {
          const checked = selected.includes(option.value);
          return (
            <label
              key={option.value}
              data-testid={`${testIdPrefix}-option`}
              className={`flex items-start gap-3 rounded-xl border-2 transition-colors ${compact ? 'px-3 py-2' : 'px-3 py-2.5'} ${
                disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
              } ${checked ? 'border-brand-navy bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}
            >
              <Checkbox checked={checked} onCheckedChange={() => toggle(option.value)} disabled={disabled} className="mt-0.5" />
              <span className={`text-sm leading-snug ${checked ? 'font-semibold text-brand-navy' : 'text-gray-700'}`}>
                {option.label}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
};

export default MultiSelectList;
