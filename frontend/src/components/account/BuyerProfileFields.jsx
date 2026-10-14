import { useId } from 'react';
import { REGIONS, PROPERTY_TYPES, BUYER_PROJECT_TYPES, FINANCING_TYPES } from '@/lib/referentiels';
import ChoiceGroup from './ChoiceGroup';
import { HORIZONS, MIN_YIELD_MAX } from './profileScore';
import { cleanSiren, formatSiren } from './siret';

// Profil d'investissement de l'acquéreur (SPEC §4, API.md §1 `buyer_profile`) : un seul écran, libellés français,
// choix multiples très visibles. `value` : objet de forme EMPTY_BUYER_PROFILE ; onChange(next).

const PROJECT_HINTS = {
  particulier: 'Vous achetez en votre nom, seul ou en couple.',
  sci: 'Société civile immobilière existante ou à créer.',
  societe: 'Société à l\'impôt sur les sociétés, holding patrimoniale.',
  professionnel: 'Foncière, marchand de biens, investisseur institutionnel.',
};
const PROJECT_OPTIONS = BUYER_PROJECT_TYPES.map((t) => ({ value: t.id, label: t.label, hint: PROJECT_HINTS[t.id] }));
const FINANCING_OPTIONS = FINANCING_TYPES.map((t) => ({ value: t.id, label: t.label }));
const HORIZON_OPTIONS = HORIZONS.map((h) => ({ value: h.id, label: h.label }));
const ZONE_OPTIONS = REGIONS.map((r) => ({ value: r, label: r }));
const PROPERTY_TYPE_OPTIONS = PROPERTY_TYPES.map((t) => ({ value: t.id, label: t.short }));

// Le SIREN et la dénomination n'ont de sens que pour un achat en société
export const isCompanyProject = (projectType) => ['sci', 'societe', 'professionnel'].includes(projectType);

const inputClass = 'w-full rounded-xl border border-brand-line bg-white px-4 py-3 text-brand-navy focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30';

const AmountField = ({ id, label, value, onChange, hint, required, error }) => (
  <div className="min-w-0">
    <label htmlFor={id} className="block text-sm font-semibold text-brand-navy mb-1">{label}{required && ' *'}</label>
    <div className="relative">
      <input
        id={id}
        type="text"
        inputMode="numeric"
        value={value === '' || value === null || value === undefined ? '' : Number(String(value).replace(/\D/g, '') || 0).toLocaleString('fr-FR')}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
        placeholder="0"
        required={required}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={`${inputClass} pr-10 tabular`}
      />
      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden="true">€</span>
    </div>
    {hint && <p id={`${id}-hint`} className="text-xs text-gray-500 mt-1">{hint}</p>}
    {error && <p role="alert" className="text-sm text-red-700 mt-1">{error}</p>}
  </div>
);

// Rendement : chiffres et une virgule décimale, borné à 0-20 %
const cleanYield = (raw) => {
  const s = String(raw || '').replace('.', ',').replace(/[^\d,]/g, '');
  const [int, ...rest] = s.split(',');
  const dec = rest.join('').slice(0, 1);
  const out = rest.length ? `${int.slice(0, 2)},${dec}` : int.slice(0, 2);
  const n = Number(out.replace(',', '.'));
  return Number.isFinite(n) && n > MIN_YIELD_MAX ? String(MIN_YIELD_MAX) : out;
};

const BuyerProfileFields = ({ value, onChange, errors = {}, showCompany = true }) => {
  const uid = useId();
  const p = value || {};
  const set = (key, v) => onChange({ ...p, [key]: v });
  const company = isCompanyProject(p.project_type);

  return (
    <div className="space-y-6 min-w-0" data-testid="buyer-profile-fields">
      <ChoiceGroup
        legend="Vous achetez"
        name="project_type"
        options={PROJECT_OPTIONS}
        value={p.project_type}
        onChange={(v) => set('project_type', v)}
        columns={2}
        required
        error={errors.project_type}
        testId="buyer-project-type"
      />

      <div className="grid sm:grid-cols-2 gap-4">
        <AmountField id={`${uid}-budget`} label="Budget maximum" value={p.budget_max} onChange={(v) => set('budget_max', v)}
          hint="Prix d'achat que vous envisagez, hors frais de notaire." required error={errors.budget_max} />
        <AmountField id={`${uid}-apport`} label="Apport" value={p.apport} onChange={(v) => set('apport', v)}
          hint="Somme disponible sans emprunt (frais de notaire compris)." />
      </div>

      <ChoiceGroup
        legend="Financement"
        name="financing"
        options={FINANCING_OPTIONS}
        value={p.financing}
        onChange={(v) => set('financing', v)}
        columns={2}
        compact
        error={errors.financing}
        testId="buyer-financing"
      />

      <ChoiceGroup
        legend="Types de biens recherchés"
        name="property_types"
        options={PROPERTY_TYPE_OPTIONS}
        value={p.property_types}
        onChange={(v) => set('property_types', v)}
        multiple
        columns={2}
        compact
        hint="Laissez vide si tous les types de biens loués vous intéressent."
        testId="buyer-property-types"
      />

      <ChoiceGroup
        legend="Zones recherchées"
        name="zones"
        options={ZONE_OPTIONS}
        value={p.zones}
        onChange={(v) => set('zones', v)}
        multiple
        columns={3}
        compact
        hint="Laissez vide pour toute la France."
        testId="buyer-zones"
      />

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="min-w-0">
          <label htmlFor={`${uid}-yield`} className="block text-sm font-semibold text-brand-navy mb-1">Rendement brut minimum visé</label>
          <div className="relative">
            <input
              id={`${uid}-yield`}
              type="text"
              inputMode="decimal"
              value={p.min_yield ?? ''}
              onChange={(e) => set('min_yield', cleanYield(e.target.value))}
              placeholder="5"
              aria-describedby={`${uid}-yield-hint`}
              className={`${inputClass} pr-10 tabular`}
              data-testid="buyer-min-yield"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden="true">%</span>
          </div>
          <p id={`${uid}-yield-hint`} className="text-xs text-gray-500 mt-1">
            Loyer annuel hors charges divisé par le prix, entre 0 et {MIN_YIELD_MAX} %. Sert à vous proposer les bons biens.
          </p>
        </div>
      </div>

      <ChoiceGroup
        legend="Horizon d'achat"
        name="horizon"
        options={HORIZON_OPTIONS}
        value={p.horizon}
        onChange={(v) => set('horizon', v)}
        columns={3}
        compact
        error={errors.horizon}
        testId="buyer-horizon"
      />

      {showCompany && company && (
        <div className="grid sm:grid-cols-2 gap-4" data-testid="buyer-company-fields">
          <div className="min-w-0">
            <label htmlFor={`${uid}-company`} className="block text-sm font-semibold text-brand-navy mb-1">
              Société qui achète <span className="font-normal text-gray-500">(facultatif)</span>
            </label>
            <input id={`${uid}-company`} type="text" value={p.company_name || ''} onChange={(e) => set('company_name', e.target.value)}
              autoComplete="organization" className={inputClass} placeholder="Dénomination de votre SCI ou société" />
          </div>
          <div className="min-w-0">
            <label htmlFor={`${uid}-siren`} className="block text-sm font-semibold text-brand-navy mb-1">
              SIREN <span className="font-normal text-gray-500">(facultatif)</span>
            </label>
            <input id={`${uid}-siren`} type="text" inputMode="numeric" value={formatSiren(p.siren || '')} onChange={(e) => set('siren', cleanSiren(e.target.value))}
              className={`${inputClass} tabular`} placeholder="123 456 789" aria-describedby={`${uid}-siren-hint`} data-testid="buyer-siren" />
            <p id={`${uid}-siren-hint`} className="text-xs text-gray-500 mt-1">
              Vérifié sur l'annuaire des entreprises : badge « société vérifiée » sur votre carte acquéreur.
            </p>
          </div>
        </div>
      )}

      <div className="min-w-0">
        <label htmlFor={`${uid}-experience`} className="block text-sm font-semibold text-brand-navy mb-1">
          Votre expérience d'investisseur <span className="font-normal text-gray-500">(facultatif)</span>
        </label>
        <textarea id={`${uid}-experience`} rows={3} maxLength={600} value={p.experience || ''} onChange={(e) => set('experience', e.target.value)}
          className={inputClass} placeholder="Premier achat locatif, biens déjà détenus, gestion en direct ou par une agence, ce que vous cherchez…" aria-describedby={`${uid}-experience-hint`} />
        <p id={`${uid}-experience-hint`} className="text-xs text-gray-500 mt-1">
          Le vendeur lit ce texte sur votre carte acquéreur, sans votre nom tant que l'engagement de confidentialité n'est pas signé.
        </p>
      </div>
    </div>
  );
};

export default BuyerProfileFields;
