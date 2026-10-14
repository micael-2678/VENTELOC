import { useId, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { TRADES, REGIONS, departementOptions, regionForDepartement } from '@/lib/referentiels';
import { PRICE_MAX_OPTIONS, CA_MIN_OPTIONS, EFFECTIF_MIN_OPTIONS, formatEurosShort } from './listingFilters';

// Formulaire de filtres de la page des annonces (colonne latérale sur grand écran, panneau plein écran sur mobile).
// Composant contrôlé : `value` = filtres (listingFilters.js), `onChange(next)` à chaque modification.
// Libellés : `labels` = content.listings (src/seo/content.json).

const VISIBLE_TRADES = 8;

const selectClass = 'w-full rounded-xl border border-brand-line bg-white px-3 py-2.5 text-sm text-brand-navy '
  + 'focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30';

const Field = ({ id, label, children }) => (
  <div className="min-w-0">
    <label htmlFor={id} className="block text-sm font-semibold text-brand-navy mb-1.5">{label}</label>
    {children}
  </div>
);

const ListingFilters = ({ value, onChange, labels, idPrefix: prefixProp, className = '' }) => {
  const autoId = useId();
  const idPrefix = prefixProp || autoId;
  const f = value;
  const [showAllTrades, setShowAllTrades] = useState(false);
  const departements = useMemo(() => departementOptions(f.region), [f.region]);
  const hiddenSelected = TRADES.slice(VISIBLE_TRADES).some((t) => f.trades.includes(t.id));
  const trades = showAllTrades || hiddenSelected ? TRADES : TRADES.slice(0, VISIBLE_TRADES);

  const set = (patch) => onChange({ ...f, ...patch, page: 1 });
  const toggleTrade = (id) => set({ trades: f.trades.includes(id) ? f.trades.filter((t) => t !== id) : [...f.trades, id] });

  return (
    <form onSubmit={(e) => e.preventDefault()} className={cn('space-y-6 min-w-0', className)} aria-label={labels.filtersTitle} data-testid="listing-filters">
      <fieldset className="min-w-0">
        <legend className="text-sm font-semibold text-brand-navy mb-2">
          {labels.tradesLabel}
          {f.trades.length > 0 && <span className="font-normal text-gray-500"> · {f.trades.length}</span>}
        </legend>
        <ul className="space-y-0.5" id={`${idPrefix}-trades`}>
          {trades.map((t) => {
            const id = `${idPrefix}-metier-${t.id}`;
            return (
              <li key={t.id}>
                <label htmlFor={id} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-sm text-gray-800 cursor-pointer hover:bg-brand-surface">
                  <input
                    id={id}
                    type="checkbox"
                    name="metier"
                    value={t.id}
                    checked={f.trades.includes(t.id)}
                    onChange={() => toggleTrade(t.id)}
                    className="h-4 w-4 shrink-0 rounded border-gray-300 accent-[#0b1220] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-1"
                  />
                  <span className="min-w-0 break-words">{t.short}</span>
                </label>
              </li>
            );
          })}
        </ul>
        {!hiddenSelected && (
          <button
            type="button"
            onClick={() => setShowAllTrades((v) => !v)}
            aria-expanded={showAllTrades}
            aria-controls={`${idPrefix}-trades`}
            className="btn-link text-sm mt-1.5 px-1.5"
          >
            {showAllTrades ? 'Afficher moins de métiers' : `Afficher les ${TRADES.length} métiers`}
          </button>
        )}
      </fieldset>

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

      <fieldset className="min-w-0">
        <legend className="text-sm font-semibold text-brand-navy mb-2">{labels.rgeLabel}</legend>
        <div className="grid grid-cols-3 rounded-xl border border-brand-line bg-brand-surface p-1 gap-1" aria-describedby={labels.rgeHint ? `${idPrefix}-rge-aide` : undefined}>
          {[['', labels.rgeAny], ['1', labels.rgeYes], ['0', labels.rgeNo]].map(([v, label]) => {
            const id = `${idPrefix}-rge-${v || 'tous'}`;
            const checked = f.rge === v;
            return (
              <div key={id} className="min-w-0">
                <input id={id} type="radio" name={`${idPrefix}-rge`} value={v} checked={checked} onChange={() => set({ rge: v })} className="peer sr-only" />
                <label
                  htmlFor={id}
                  className={cn(
                    'flex items-center justify-center rounded-lg px-0.5 py-2 text-sm font-medium text-center whitespace-nowrap cursor-pointer select-none transition-colors',
                    'peer-focus-visible:ring-2 peer-focus-visible:ring-brand-blue',
                    checked ? 'bg-white text-brand-navy shadow-sm' : 'text-gray-600 hover:text-brand-navy',
                  )}
                >
                  {label}
                </label>
              </div>
            );
          })}
        </div>
        {labels.rgeHint && <p id={`${idPrefix}-rge-aide`} className="mt-1.5 text-xs text-gray-600 leading-snug">{labels.rgeHint}</p>}
      </fieldset>

      <div className="space-y-4">
        <Field id={`${idPrefix}-prix-max`} label={labels.priceMaxLabel}>
          <select id={`${idPrefix}-prix-max`} name="prix_max" value={f.prixMax} onChange={(e) => set({ prixMax: e.target.value })} className={selectClass} data-testid="filter-prix-max">
            <option value="">Sans limite</option>
            {PRICE_MAX_OPTIONS.map((n) => <option key={n} value={String(n)}>{`Jusqu'à ${formatEurosShort(n)}`}</option>)}
          </select>
        </Field>
        <Field id={`${idPrefix}-ca-min`} label={labels.caMinLabel}>
          <select id={`${idPrefix}-ca-min`} name="ca_min" value={f.caMin} onChange={(e) => set({ caMin: e.target.value })} className={selectClass} data-testid="filter-ca-min">
            <option value="">Indifférent</option>
            {CA_MIN_OPTIONS.map((n) => <option key={n} value={String(n)}>{`À partir de ${formatEurosShort(n)}`}</option>)}
          </select>
        </Field>
        <Field id={`${idPrefix}-effectif-min`} label={labels.effectifMinLabel}>
          <select id={`${idPrefix}-effectif-min`} name="effectif_min" value={f.effectifMin} onChange={(e) => set({ effectifMin: e.target.value })} className={selectClass} data-testid="filter-effectif-min">
            <option value="">Indifférent</option>
            {EFFECTIF_MIN_OPTIONS.map((n) => <option key={n} value={String(n)}>{`${n} salarié${n > 1 ? 's' : ''} ou plus`}</option>)}
          </select>
        </Field>
      </div>
    </form>
  );
};

export default ListingFilters;
