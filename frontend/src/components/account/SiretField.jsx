import { useEffect, useId, useRef } from 'react';
import { CheckCircle2, Clock, Loader2, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { cleanSiret, formatSiret } from './siret';

// Champ SIRET avec recherche automatique dès 14 chiffres (hook useCompanyLookup passé par la page).
// Jamais bloquant : « vérification différée » si l'annuaire ne répond pas.
const SiretField = ({
  value,
  onChange,
  lookup,
  label = 'SIRET de l\'entreprise',
  required = false,
  hint = 'Le numéro à 14 chiffres figure sur vos devis, factures et sur votre extrait Kbis.',
  autoLookup = true,
  inputProps = {},
  testId = 'siret-input',
}) => {
  const id = useId();
  const { status, message } = lookup;
  const last = useRef('');

  useEffect(() => {
    if (!autoLookup) return;
    const digits = cleanSiret(value);
    if (digits.length === 14 && last.current !== digits) {
      last.current = digits;
      lookup.lookup(digits);
    } else if (digits.length < 14 && last.current) {
      last.current = '';
      lookup.reset();
    }
  }, [value, autoLookup, lookup]);

  const tone = status === 'found' ? 'border-brand-green' : status === 'invalid' ? 'border-red-400' : '';
  const describedBy = [`${id}-hint`, message ? `${id}-status` : null].filter(Boolean).join(' ');

  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-sm font-semibold text-brand-navy mb-1">
        {label}{required ? ' *' : <span className="font-normal text-gray-500"> (facultatif)</span>}
      </label>
      <div className="relative">
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={formatSiret(value)}
          onChange={(e) => onChange(cleanSiret(e.target.value))}
          placeholder="123 456 789 00012"
          required={required}
          aria-describedby={describedBy}
          aria-invalid={status === 'invalid' ? 'true' : undefined}
          className={cn('w-full rounded-xl border border-brand-line bg-white px-4 py-3 pr-11 text-brand-navy tabular focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30', tone)}
          data-testid={testId}
          {...inputProps}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true">
          {status === 'loading' && <Loader2 className="w-5 h-5 animate-spin" />}
          {status === 'found' && <CheckCircle2 className="w-5 h-5 text-brand-green" />}
          {status === 'unavailable' && <Clock className="w-5 h-5 text-brand-amber" />}
          {(status === 'idle' || status === 'not_found' || status === 'invalid') && <Search className="w-5 h-5" />}
        </span>
      </div>
      <p id={`${id}-hint`} className="text-xs text-gray-500 mt-1">{hint}</p>
      {message && (
        <p id={`${id}-status`} role="status" className={cn('text-sm mt-1.5', status === 'invalid' ? 'text-red-700' : status === 'unavailable' ? 'text-brand-amber' : 'text-gray-700')}>
          {message}
        </p>
      )}
      {status === 'loading' && <p className="sr-only" role="status">Recherche de l'entreprise…</p>}
    </div>
  );
};

export default SiretField;
