import { useId, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { PROPERTY_TYPES, LEASE_TYPES, REGIONS, departementOptions, regionForDepartement } from '@/lib/referentiels';
import {
  PRICE_MAX_OPTIONS, YIELD_MIN_OPTIONS, SURFACE_MIN_OPTIONS, formatEurosShort, formatYieldShort,
} from './listingFilters';

// Formulaire de filtres de la page des annonces (colonne latérale sur grand écran, panneau plein écran sur mobile) :
// type de bien (cases), type de bail (cases), région puis département, prix maximum, rendement brut minimum, surface
// minimum (docs/venteloc/SPEC.md §5.1). Composant contrôlé : `value` = filtres (listingFilters.js), `onChange(next)` à
// chaque modification. Libellés : `labels` = content.listings (src/seo/content.json).

const VISIBLE_LEASES = 5;

const selectClass = 'w-full rounded-xl border border-brand-line bg-white px-3 py-2.5 text-sm text-brand-navy '
  + 'focus:border-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30';
const checkboxClass = 'h-4 w-4 shrink-0 rounded border-gray-300 accent-[#0f766e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:ring-offset-1';

const Field = ({ id, label, children }) => (
  <div className="min-w-0">
    <label htmlFor={id} className="block text-sm font-semibold text-brand-navy mb-1.5">{label}</label>
    {children}
  </div>
);

const CheckList = ({ legend, name, options, selected, onToggle, idPrefix, listId, footer }) => (
  <fieldset className="min-w-0">
    <legend className="text-sm font-semibold text-brand-navy mb-2">
      {legend}
      {selected.length > 0 && <span className="font-normal text-gray-500"> · {selected.length}</span>}
    </legend>
    <ul className="space-y-0.5" id={listId}>
      {options.map((o) => {
        const id = `${idPrefix}-${name}-${o.id}`;
        return (
          <li key={o.id}>
            <label htmlFor={id} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-sm text-gray-800 cursor-pointer hover:bg-brand-surface">
              <input id={id} type="checkbox" name={name} value={o.id} checked={selected.includes(o.id)} onChange={() => onToggle(o.id)} className={checkboxClass} />
              <span className="min-w-0 break-words">{o.short}</span>
            </label>
          </li>
        );
      })}
    </ul>
    {footer}
  </fieldset>
);

const ListingFilters = ({ value, onChange, labels, idPrefix: prefixProp, className = '' }) => {
  const autoId = useId();
  const idPrefix = prefixProp || autoId;
  const f = value;
  const [showAllLeases, setShowAllLeases] = useState(false);
  const departements = useMemo(() => departementOptions(f.region), [f.region]);
  const hiddenSelected = LEASE_TYPES.slice(VISIBLE_LEASES).some((t) => f.baux.includes(t.id));
  const leases = showAllLeases || hiddenSelected ? LEASE_TYPES : LEASE_TYPES.slice(0, VISIBLE_LEASES);

  const set = (patch) => onChange({ ...f, ...patch, page: 1 });
  const toggle = (key) => (id) => set({ [key]: f[key].includes(id) ? f[key].filter((t) => t !== id) : [...f[key], id] });

  return (
    <form onSubmit={(e) => e.preventDefault()} className={cn('space-y-6 min-w-0', className)} aria-label={labels.filtersTitle} data-testid="listing-filters">
      <CheckList legend={labels.typesLabel} name="type" options={PROPERTY_TYPES} selected={f.types} onToggle={toggle('types')} idPrefix={idPrefix} />

      <CheckList
        legend={labels.leaseLabel}
        name="bail"
        options={leases}
        selected={f.baux}
        onToggle={toggle('baux')}
        idPrefix={idPrefix}
        listId={`${idPrefix}-baux`}
        footer={!hiddenSelected && (
          <button
            type="button"
            onClick={() => setShowAllLeases((v) => !v)}
            aria-expanded={showAllLeases}
            aria-controls={`${idPrefix}-baux`}
            className="btn-link text-sm mt-1.5 px-1.5"
          >
            {showAllLeases ? 'Afficher moins de baux' : `Afficher les ${LEASE_TYPES.length} types de bail`}
          </button>
        )}
      />

      <div className="space-y-4">
        <Field id={`${idPrefix}-region`} label={labels.regionLabel}>
          <select
            id={`${idPrefix}-region`}
            name="region"
            value={f.region}
            onChange={(e) => set({ region: e.target.value, departement: '' })}
            className={selectClass}
            data-testid="filter-region"
          >
            <option value="">Toutes les régions</option>
            {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
        <Field id={`${idPrefix}-departement`} label={labels.departementLabel}>
          <select
            id={`${idPrefix}-departement`}
            name="departement"
            value={f.departement}
            onChange={(e) => set({ departement: e.target.value, region: e.target.value ? (f.region || regionForDepartement(e.target.value)) : f.region })}
            className={selectClass}
            data-testid="filter-departement"
          >
            <option value="">Tous les départements</option>
            {departements.map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}
          </select>
        </Field>
      </div>

      <div className="space-y-4">
        <Field id={`${idPrefix}-prix-max`} label={labels.priceMaxLabel}>
          <select id={`${idPrefix}-prix-max`} name="prix_max" value={f.prixMax} onChange={(e) => set({ prixMax: e.target.value })} className={selectClass} data-testid="filter-prix-max">
            <option value="">Sans limite</option>
            {PRICE_MAX_OPTIONS.map((n) => <option key={n} value={String(n)}>{`Jusqu'à ${formatEurosShort(n)}`}</option>)}
          </select>
        </Field>
        <Field id={`${idPrefix}-rendement-min`} label={labels.yieldMinLabel}>
          <select id={`${idPrefix}-rendement-min`} name="rendement_min" value={f.rendementMin} onChange={(e) => set({ rendementMin: e.target.value })} className={selectClass} data-testid="filter-rendement-min">
            <option value="">Indifférent</option>
            {YIELD_MIN_OPTIONS.map((n) => <option key={n} value={String(n)}>{`${formatYieldShort(n)} ou plus`}</option>)}
          </select>
        </Field>
        <Field id={`${idPrefix}-surface-min`} label={labels.surfaceMinLabel}>
          <select id={`${idPrefix}-surface-min`} name="surface_min" value={f.surfaceMin} onChange={(e) => set({ surfaceMin: e.target.value })} className={selectClass} data-testid="filter-surface-min">
            <option value="">Indifférente</option>
            {SURFACE_MIN_OPTIONS.map((n) => <option key={n} value={String(n)}>{`${n}\u00a0m² ou plus`}</option>)}
          </select>
        </Field>
      </div>
    </form>
  );
};

export default ListingFilters;
