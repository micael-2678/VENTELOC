import { useId } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PROPERTY_TYPES } from '@/lib/referentiels';
import { PROPERTY_ICONS } from '@/components/shared/PropertyPhoto';

// Cartes de choix exclusif (boutons radio natifs, accessibles au clavier) : type de bien, propriétaire, objet de la
// vente… options : [{ value, label, hint?, icon? }]
export const RadioCards = ({ legend, name, options, value, onChange, error, columns = 'sm:grid-cols-2', hint, required = false, disabled = false, testIdPrefix }) => {
  const id = useId();
  return (
    <fieldset className="min-w-0" aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}>
      {legend && (
        <legend className="text-sm font-semibold text-brand-navy mb-1">
          {legend}{required && <span aria-hidden="true"> *</span>}
        </legend>
      )}
      {hint && <p id={`${id}-hint`} className="text-sm text-gray-600 mb-3">{hint}</p>}
      <div className={cn('grid grid-cols-1 gap-2', columns, !hint && legend && 'mt-2')}>
        {options.map((o) => {
          const checked = value === o.value;
          const Icon = o.icon;
          return (
            <label
              key={o.value}
              className={cn(
                'flex items-start gap-3 rounded-xl border-2 px-3.5 py-3 cursor-pointer min-w-0 transition-colors focus-within:ring-2 focus-within:ring-brand-teal focus-within:ring-offset-1',
                checked ? 'border-brand-teal bg-brand-teal-soft' : 'border-brand-line bg-white hover:border-gray-400',
                disabled && 'opacity-60 cursor-not-allowed',
              )}
              data-testid={testIdPrefix ? `${testIdPrefix}-${o.value}` : undefined}
            >
              <input type="radio" name={name || id} value={o.value} checked={checked} disabled={disabled} onChange={() => onChange(o.value)} className="sr-only" />
              {Icon ? (
                <Icon className={cn('w-5 h-5 mt-0.5 shrink-0', checked ? 'text-brand-teal' : 'text-gray-500')} aria-hidden="true" />
              ) : (
                <span className={cn('mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full border-2 shrink-0', checked ? 'border-brand-teal bg-brand-teal text-white' : 'border-gray-400 bg-white')} aria-hidden="true">
                  {checked && <Check className="w-3 h-3" strokeWidth={3} />}
                </span>
              )}
              <span className="min-w-0">
                <span className={cn('block text-sm leading-snug break-words', checked ? 'font-semibold text-brand-navy' : 'text-gray-800')}>{o.label}</span>
                {o.hint && <span className="block text-sm text-gray-600 mt-0.5 leading-snug">{o.hint}</span>}
              </span>
            </label>
          );
        })}
      </div>
      {error && <p id={`${id}-error`} role="alert" className="text-sm text-red-700 mt-2">{error}</p>}
    </fieldset>
  );
};

// Type de bien (8 cartes avec pictogramme) : donne le titre généré de l'annonce
const PropertyTypePicker = ({ value, onChange, error, disabled = false }) => (
  <RadioCards
    legend="Type de bien"
    name="property_type"
    required
    options={PROPERTY_TYPES.map((t) => ({ value: t.id, label: t.label, icon: PROPERTY_ICONS[t.id] }))}
    value={value}
    onChange={onChange}
    error={error}
    disabled={disabled}
    columns="sm:grid-cols-2 lg:grid-cols-4"
    testIdPrefix="property-type"
  />
);

export default PropertyTypePicker;
