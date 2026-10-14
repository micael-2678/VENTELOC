import { useId, useState } from 'react';
import { Bell, Loader2, Mail } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PROPERTY_TYPES, REGIONS } from '@/lib/referentiels';
import { trackEvent } from '@/lib/analytics';

// Alerte sans compte (docs/venteloc/SPEC.md §5.3, API.md §8) : e-mail + types de biens + régions + prix maximum +
// rendement brut minimum → POST /alerts/public {email, property_types, regions, max_price, min_yield}.
// L'alerte est activée après le clic sur le lien de confirmation reçu par e-mail (double opt-in).

const BACKEND_URL = String(process.env.REACT_APP_BACKEND_URL || '').replace(/\/+$/, '');
const ALERTS_URL = `${BACKEND_URL}/api/alerts/public`;

const PRICE_OPTIONS = [
  { value: '', label: 'Sans limite de prix' },
  { value: '100000', label: 'Jusqu\'à 100 000 €' },
  { value: '150000', label: 'Jusqu\'à 150 000 €' },
  { value: '200000', label: 'Jusqu\'à 200 000 €' },
  { value: '300000', label: 'Jusqu\'à 300 000 €' },
  { value: '500000', label: 'Jusqu\'à 500 000 €' },
  { value: '1000000', label: 'Jusqu\'à 1 000 000 €' },
];

const YIELD_OPTIONS = [
  { value: '', label: 'Indifférent' },
  ...[3, 4, 5, 6, 7, 8].map((n) => ({ value: String(n), label: `${n}\u00a0% brut ou plus` })),
];

const typeOptions = () => PROPERTY_TYPES.map((t) => ({ value: t.id, label: t.id === 'autre' ? 'Autre bien' : t.short }));
const regionOptions = () => REGIONS.map((r) => ({ value: r, label: r }));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const errorMessage = async (response) => {
  let detail = '';
  try {
    const data = await response.json();
    if (typeof data?.detail === 'string') detail = data.detail;
    else if (Array.isArray(data?.detail)) detail = data.detail.map((d) => d?.msg || '').filter(Boolean).join(' ');
  } catch (e) {
    detail = '';
  }
  if (response.status === 429) return 'Trop de demandes pour le moment. Réessayez dans une minute.';
  return detail || 'L\'alerte n\'a pas pu être créée. Réessayez dans quelques instants.';
};

// Groupe de cases à cocher en pastilles (clavier et lecteur d'écran : cases natives)
const PillGroup = ({ legend, name, options, selected, onToggle, idPrefix }) => (
  <fieldset className="min-w-0">
    <legend className="text-sm font-semibold text-brand-navy mb-2">
      {legend}
      {selected.length > 0 && <span className="font-normal text-gray-500"> · {selected.length} sélectionné{selected.length > 1 ? 's' : ''}</span>}
    </legend>
    <ul className="flex flex-wrap gap-2">
      {options.map((o) => {
        const id = `${idPrefix}-${name}-${o.value}`;
        const checked = selected.includes(o.value);
        return (
          <li key={o.value} className="max-w-full">
            <input id={id} type="checkbox" name={name} value={o.value} checked={checked} onChange={() => onToggle(o.value)} className="peer sr-only" />
            <label
              htmlFor={id}
              className={cn(
                'inline-flex max-w-full items-center rounded-full border px-3 py-1.5 text-sm cursor-pointer select-none transition-colors',
                'peer-focus-visible:ring-2 peer-focus-visible:ring-brand-teal peer-focus-visible:ring-offset-1',
                checked ? 'bg-brand-teal border-brand-teal text-white' : 'bg-white border-brand-line text-brand-navy hover:border-brand-navy/50',
              )}
            >
              <span className="truncate">{o.label}</span>
            </label>
          </li>
        );
      })}
    </ul>
  </fieldset>
);

const AlertForm = ({
  defaultEmail = '',
  defaultTypes = [],
  defaultRegions = [],
  defaultMaxPrice = '',
  defaultMinYield = '',
  source = 'page',
  compact = false,
  title = 'Recevoir les prochains biens',
  intro = 'Une alerte e-mail, sans compte. Choisissez vos types de biens, vos régions, un prix maximum et le rendement visé.',
  onCreated,
  className = '',
}) => {
  const idPrefix = useId();
  const [email, setEmail] = useState(defaultEmail);
  const [types, setTypes] = useState(Array.isArray(defaultTypes) ? defaultTypes : []);
  const [regions, setRegions] = useState(Array.isArray(defaultRegions) ? defaultRegions : []);
  const [maxPrice, setMaxPrice] = useState(defaultMaxPrice ? String(defaultMaxPrice) : '');
  const [minYield, setMinYield] = useState(() => {
    const n = Math.min(8, Math.floor(Number(defaultMinYield) || 0));
    return n >= 3 ? String(n) : '';
  });
  const [status, setStatus] = useState('idle'); // idle | sending | done
  const [error, setError] = useState('');

  const toggle = (setter) => (value) => setter((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));

  const submit = async (e) => {
    e.preventDefault();
    const address = email.trim().toLowerCase();
    if (!EMAIL_RE.test(address)) {
      setError('Indiquez une adresse e-mail valide.');
      return;
    }
    setError('');
    setStatus('sending');
    const payload = {
      email: address,
      property_types: types,
      regions,
      max_price: maxPrice ? Number(maxPrice) : null,
      min_yield: minYield ? Number(minYield) : null,
    };
    try {
      const response = await fetch(ALERTS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'omit',
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        setStatus('idle');
        return;
      }
      setStatus('done');
      trackEvent('alert_created', { source, types: types.length, regions: regions.length, max_price: payload.max_price, min_yield: payload.min_yield });
      if (typeof onCreated === 'function') onCreated(payload);
    } catch (err) {
      setError('Connexion impossible. Vérifiez votre réseau puis réessayez.');
      setStatus('idle');
    }
  };

  if (status === 'done') {
    return (
      <div className={cn('card p-5 sm:p-6 min-w-0', className)} role="status" data-testid="alert-form-success">
        <div className="flex items-start gap-3">
          <span className="shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-full bg-brand-surface border border-brand-line text-brand-navy" aria-hidden="true">
            <Mail className="w-5 h-5" />
          </span>
          <div className="min-w-0">
            <p className="font-display font-bold text-brand-navy text-lg">Vérifiez votre boîte mail</p>
            <p className="text-gray-600 mt-1 leading-relaxed break-words">
              Nous venons d&apos;envoyer un e-mail à <span className="font-semibold text-brand-navy">{email.trim()}</span>.
              Cliquez sur le lien qu&apos;il contient pour activer votre alerte. Sans ce clic, rien n&apos;est envoyé.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const emailId = `${idPrefix}-email`;
  const priceId = `${idPrefix}-price`;
  const yieldId = `${idPrefix}-yield`;
  const groups = (
    <>
      <PillGroup legend="Types de biens" name="property_types" options={typeOptions()} selected={types} onToggle={toggle(setTypes)} idPrefix={idPrefix} />
      <PillGroup legend="Régions" name="regions" options={regionOptions()} selected={regions} onToggle={toggle(setRegions)} idPrefix={idPrefix} />
    </>
  );

  return (
    <form onSubmit={submit} noValidate className={cn('card p-5 sm:p-6 min-w-0 space-y-4', className)} data-testid="alert-form">
      <div className="flex items-start gap-3">
        <span className="shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-full bg-brand-surface border border-brand-line text-brand-navy" aria-hidden="true">
          <Bell className="w-5 h-5" />
        </span>
        <div className="min-w-0">
          <p className="font-display font-bold text-brand-navy text-lg">{title}</p>
          {intro && <p className="text-sm text-gray-600 mt-0.5">{intro}</p>}
        </div>
      </div>

      <div>
        <label htmlFor={emailId} className="block text-sm font-semibold text-brand-navy mb-1">Votre adresse e-mail</label>
        <input
          id={emailId}
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="prenom@exemple.fr"
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${idPrefix}-error` : undefined}
          className="w-full rounded-xl border border-brand-line bg-white px-4 py-3 text-brand-navy focus:border-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30"
        />
      </div>

      {compact ? (
        <details className="group rounded-xl border border-brand-line p-3">
          <summary className="cursor-pointer text-sm font-semibold text-brand-navy">
            Affiner : types de biens, régions
            {(types.length + regions.length) > 0 && <span className="font-normal text-gray-500"> · {types.length + regions.length} critère{types.length + regions.length > 1 ? 's' : ''}</span>}
          </summary>
          <div className="mt-3 space-y-4">{groups}</div>
        </details>
      ) : groups}

      <div className={cn('grid gap-4', !compact && 'sm:grid-cols-2')}>
        <div className="min-w-0">
          <label htmlFor={priceId} className="block text-sm font-semibold text-brand-navy mb-1">Prix maximum</label>
          <select
            id={priceId}
            name="max_price"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            className="w-full rounded-xl border border-brand-line bg-white px-4 py-3 text-brand-navy focus:border-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30"
          >
            {PRICE_OPTIONS.map((o) => <option key={o.value || 'none'} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="min-w-0">
          <label htmlFor={yieldId} className="block text-sm font-semibold text-brand-navy mb-1">Rendement brut minimum</label>
          <select
            id={yieldId}
            name="min_yield"
            value={minYield}
            onChange={(e) => setMinYield(e.target.value)}
            className="w-full rounded-xl border border-brand-line bg-white px-4 py-3 text-brand-navy focus:border-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30"
          >
            {YIELD_OPTIONS.map((o) => <option key={o.value || 'none'} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {error && <p id={`${idPrefix}-error`} role="alert" className="text-sm text-red-700">{error}</p>}

      <button type="submit" className="btn-primary w-full sm:w-auto" disabled={status === 'sending'} data-testid="alert-form-submit">
        {status === 'sending' ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Bell className="w-4 h-4" aria-hidden="true" />}
        Créer mon alerte
      </button>
      <p className="text-xs text-gray-500 leading-relaxed">
        Un e-mail de confirmation vous est envoyé ; l&apos;alerte n&apos;est active qu&apos;après votre clic. Désinscription en un clic
        dans chaque e-mail. Votre adresse ne sert à rien d&apos;autre.
      </p>
    </form>
  );
};

export default AlertForm;
