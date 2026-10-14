import { useId, useState } from 'react';
import { HelpCircle, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

// Champs du formulaire d'annonce : libellé, aide dépliable (info-bulle accessible au clavier et au doigt),
// message d'erreur relié par aria-describedby, bornes min/max. Tout texte engageant ≥ 13 px (text-sm).

const INPUT = 'w-full rounded-xl border border-brand-line bg-white px-4 py-3 text-base text-brand-navy placeholder:text-gray-400 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30 disabled:bg-brand-surface disabled:text-gray-500';

export const inputClass = (invalid) => cn(INPUT, invalid && 'border-red-400 focus:border-red-500 focus:ring-red-200');

// Bouton « ? » qui déplie une aide sous le champ
export const HelpToggle = ({ id, text, open, onToggle }) => (
  <button
    type="button"
    onClick={onToggle}
    aria-expanded={open}
    aria-controls={id}
    className="inline-flex items-center justify-center w-6 h-6 rounded-full text-brand-blue hover:bg-brand-blue-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
    title={open ? 'Masquer l\'aide' : 'Afficher l\'aide'}
  >
    <HelpCircle className="w-4 h-4" aria-hidden="true" />
    <span className="sr-only">{open ? 'Masquer l\'aide' : `Aide : ${text}`}</span>
  </button>
);

// Enveloppe d'un champ : label, aide, erreur. `children(props)` reçoit id, aria-describedby, aria-invalid.
export const Field = ({ label, help, error, hint, optional = false, required = false, className = '', children, labelAs = 'label', htmlFor }) => {
  const autoId = useId();
  const id = htmlFor || autoId;
  const [open, setOpen] = useState(false);
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [hint ? hintId : null, help && open ? helpId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  const LabelTag = labelAs;
  return (
    <div className={cn('min-w-0', className)}>
      <div className="flex items-center gap-2 mb-1.5">
        <LabelTag htmlFor={labelAs === 'label' ? id : undefined} className="text-sm font-semibold text-brand-navy">
          {label}
          {required && <span aria-hidden="true"> *</span>}
          {optional && <span className="font-normal text-gray-500"> (facultatif)</span>}
        </LabelTag>
        {help && <HelpToggle id={helpId} text={help} open={open} onToggle={() => setOpen((v) => !v)} />}
      </div>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? 'true' : undefined, required })}
      {hint && <p id={hintId} className="text-sm text-gray-500 mt-1">{hint}</p>}
      {help && open && (
        <p id={helpId} className="mt-2 rounded-xl bg-brand-blue-soft text-sm text-gray-800 px-3 py-2 leading-relaxed" data-testid="field-help">{help}</p>
      )}
      {error && <p id={errorId} role="alert" className="text-sm text-red-700 mt-1">{error}</p>}
    </div>
  );
};

// Montant en euros ou nombre borné ; valeur conservée en chaîne dans le formulaire
export const NumberInput = ({ value, onChange, min, max, step = 1, suffix = '€', placeholder = '', disabled = false, testId, ...aria }) => (
  <div className="relative">
    <input
      type="number"
      inputMode="decimal"
      value={value}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={cn(inputClass(aria['aria-invalid']), suffix && (String(suffix).length > 3 ? 'pr-20' : 'pr-12'), 'tabular')}
      data-testid={testId}
      {...aria}
    />
    {suffix && <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-gray-500" aria-hidden="true">{suffix}</span>}
  </div>
);

export const TextInput = ({ value, onChange, type = 'text', placeholder = '', disabled = false, testId, maxLength, ...aria }) => (
  <input
    type={type}
    value={value}
    placeholder={placeholder}
    disabled={disabled}
    maxLength={maxLength}
    onChange={(e) => onChange(e.target.value)}
    className={inputClass(aria['aria-invalid'])}
    data-testid={testId}
    {...aria}
  />
);

// Liste déroulante native (accessible, lisible au doigt) : options [{ value, label }]
export const SelectInput = ({ value, onChange, options, placeholder = 'Choisir', disabled = false, testId, ...aria }) => (
  <select
    value={value}
    disabled={disabled}
    onChange={(e) => onChange(e.target.value)}
    className={cn(inputClass(aria['aria-invalid']), 'appearance-none bg-[length:1rem] bg-[right_1rem_center] bg-no-repeat pr-10')}
    style={{ backgroundImage: 'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'16\' height=\'16\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%230b1220\' stroke-width=\'2\'><path d=\'m6 9 6 6 6-6\'/></svg>")' }}
    data-testid={testId}
    {...aria}
  >
    <option value="">{placeholder}</option>
    {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
  </select>
);

// Case à cocher très visible (carte) : options du formulaire d'annonce (acceptation automatique des demandes…)
export const CheckCard = ({ checked, onChange, label, hint, disabled = false, testId, compact = false }) => {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex items-start rounded-xl border-2 cursor-pointer transition-colors min-w-0 focus-within:ring-2 focus-within:ring-brand-blue focus-within:ring-offset-1',
        // Compact (grilles à deux colonnes dès 390 px) : marges réduites pour que les libellés longs tiennent sans coupure
        compact ? 'gap-2 px-2.5 py-2.5 sm:gap-3 sm:px-3' : 'gap-3 px-4 py-3',
        checked ? 'border-brand-teal bg-brand-teal-soft' : 'border-brand-line bg-white hover:border-gray-400',
        disabled && 'opacity-60 cursor-not-allowed',
      )}
      data-testid={testId}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      <span
        className={cn('mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-md border-2 shrink-0', checked ? 'bg-brand-teal border-brand-teal text-white' : 'border-gray-400 bg-white')}
        aria-hidden="true"
      >
        {checked && <Check className="w-4 h-4" strokeWidth={3} />}
      </span>
      <span className="min-w-0">
        <span className={cn('block leading-snug break-words hyphens-auto', compact ? 'text-[13px] sm:text-sm' : 'text-sm', checked ? 'font-semibold text-brand-navy' : 'text-gray-800')}>{label}</span>
        {hint && <span className="block text-sm text-gray-500 mt-0.5 leading-snug">{hint}</span>}
      </span>
    </label>
  );
};

// Indicateur des 3 écrans
export const StepIndicator = ({ steps, current, onSelect, maxReachable }) => (
  <ol className="flex items-center gap-2 sm:gap-3 min-w-0" aria-label="Étapes de création de l'annonce">
    {steps.map((s, i) => {
      const state = s.id < current ? 'done' : s.id === current ? 'current' : 'todo';
      const reachable = typeof onSelect === 'function' && s.id <= (maxReachable || current);
      const content = (
        <>
          <span
            className={cn('inline-flex items-center justify-center w-7 h-7 rounded-full text-sm font-bold tabular shrink-0',
              state === 'done' ? 'bg-brand-navy text-white' : state === 'current' ? 'border-2 border-brand-blue text-brand-blue' : 'border-2 border-brand-line text-gray-500')}
            aria-hidden="true"
          >
            {state === 'done' ? <Check className="w-4 h-4" strokeWidth={3} /> : s.id}
          </span>
          <span className={cn('text-sm truncate', state === 'current' ? 'font-semibold text-brand-navy' : 'text-gray-600', 'hidden sm:inline')}>{s.label}</span>
          {/* Sous 640 px : libellé de l'étape courante seul (les trois ne tiennent pas à 390 px sans être tronqués),
              les autres restent lisibles par les lecteurs d'écran et nomment les boutons */}
          <span className={cn('text-sm whitespace-nowrap sm:hidden', state === 'current' ? 'font-semibold text-brand-navy' : 'sr-only')}>{s.short}</span>
        </>
      );
      return (
        <li key={s.id} className="flex items-center gap-2 min-w-0" aria-current={state === 'current' ? 'step' : undefined}>
          {reachable ? (
            <button type="button" onClick={() => onSelect(s.id)} className="flex items-center gap-2 min-w-0 min-h-11 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue">
              {content}
            </button>
          ) : (
            <span className="flex items-center gap-2 min-w-0">{content}</span>
          )}
          {i < steps.length - 1 && <span className="w-6 sm:w-10 h-px bg-brand-line shrink-0" aria-hidden="true" />}
        </li>
      );
    })}
  </ol>
);
