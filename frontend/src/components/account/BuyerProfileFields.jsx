import { useId } from 'react';
import { REGIONS, TRADES } from '@/lib/referentiels';
import { PROJECT_TYPES, FINANCING, HORIZONS } from '@/components/shared/BuyerCard';
import ChoiceGroup from './ChoiceGroup';
import { cleanSiren, formatSiren } from './siret';

// Profil de projet du repreneur (SPEC §4.1, API.md §1 `buyer_profile`) : un seul écran, libellés français,
// sélecteurs à choix multiples très visibles. `value` : objet de forme EMPTY_BUYER_PROFILE ; onChange(next).

const PROJECT_OPTIONS = [
  { value: 'reprise-individuelle', label: PROJECT_TYPES['reprise-individuelle'], hint: 'Vous reprenez pour diriger vous-même.' },
  { value: 'croissance-externe', label: PROJECT_TYPES['croissance-externe'], hint: 'Vous dirigez déjà une entreprise du secteur.' },
  { value: 'groupe-investisseur', label: PROJECT_TYPES['groupe-investisseur'], hint: 'Groupe, holding, fonds ou famille d\'investisseurs.' },
  { value: 'autre', label: PROJECT_TYPES.autre },
];
const FINANCING_OPTIONS = Object.entries(FINANCING).map(([value, label]) => ({ value, label }));
const HORIZON_OPTIONS = Object.entries(HORIZONS).map(([value, label]) => ({ value, label }));
const ZONE_OPTIONS = REGIONS.map((r) => ({ value: r, label: r }));
const TRADE_OPTIONS = TRADES.map((t) => ({ value: t.id, label: t.short || t.label }));

const inputClass = 'w-full rounded-xl border border-brand-line bg-white px-4 py-3 text-brand-navy focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30';

const AmountField = ({ id, label, value, onChange, hint, required }) => (
  <div className="min-w-0">
    <label htmlFor={id} className="block text-sm font-semibold text-brand-navy mb-1">{label}{required && ' *'}</label>
    <div className="relative">
      <input
        id={id}
        type="text"
        inputMode="numeric"
        value={value === '' ? '' : Number(String(value).replace(/\D/g, '') || 0).toLocaleString('fr-FR')}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
        placeholder="0"
        required={required}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={`${inputClass} pr-10 tabular`}
      />
      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden="true">€</span>
    </div>
    {hint && <p id={`${id}-hint`} className="text-xs text-gray-500 mt-1">{hint}</p>}
  </div>
);

const BuyerProfileFields = ({ value, onChange, errors = {}, showCompany = true }) => {
  const uid = useId();
  const p = value || {};
  const set = (key, v) => onChange({ ...p, [key]: v });

  return (
    <div className="space-y-6 min-w-0" data-testid="buyer-profile-fields">
      <ChoiceGroup
        legend="Votre projet"
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
          hint="Prix d'acquisition total que vous envisagez, hors frais." required />
        <AmountField id={`${uid}-apport`} label="Apport" value={p.apport} onChange={(v) => set('apport', v)}
          hint="Fonds propres mobilisables, le reste étant financé par emprunt." />
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

      <ChoiceGroup
        legend="Métiers recherchés"
        name="trades"
        options={TRADE_OPTIONS}
        value={p.trades}
        onChange={(v) => set('trades', v)}
        multiple
        columns={2}
        compact
        hint="Laissez vide pour tous les métiers du bâtiment."
        testId="buyer-trades"
      />

      <ChoiceGroup
        legend="Horizon de reprise"
        name="horizon"
        options={HORIZON_OPTIONS}
        value={p.horizon}
        onChange={(v) => set('horizon', v)}
        columns={3}
        compact
        error={errors.horizon}
        testId="buyer-horizon"
      />

      {showCompany && (
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="min-w-0">
            <label htmlFor={`${uid}-company`} className="block text-sm font-semibold text-brand-navy mb-1">
              Société qui reprend <span className="font-normal text-gray-500">(facultatif)</span>
            </label>
            <input id={`${uid}-company`} type="text" value={p.company_name || ''} onChange={(e) => set('company_name', e.target.value)}
              autoComplete="organization" className={inputClass} placeholder="Nom de votre société ou holding" />
          </div>
          <div className="min-w-0">
            <label htmlFor={`${uid}-siren`} className="block text-sm font-semibold text-brand-navy mb-1">
              SIREN <span className="font-normal text-gray-500">(facultatif)</span>
            </label>
            <input id={`${uid}-siren`} type="text" inputMode="numeric" value={formatSiren(p.siren || '')} onChange={(e) => set('siren', cleanSiren(e.target.value))}
              className={`${inputClass} tabular`} placeholder="123 456 789" aria-describedby={`${uid}-siren-hint`} />
            <p id={`${uid}-siren-hint`} className="text-xs text-gray-500 mt-1">
              Vérifié sur l'open data : badge « société vérifiée » sur votre carte repreneur, +10 % de profil.
            </p>
          </div>
        </div>
      )}

      <div className="min-w-0">
        <label htmlFor={`${uid}-experience`} className="block text-sm font-semibold text-brand-navy mb-1">
          Votre expérience en quelques mots <span className="font-normal text-gray-500">(facultatif)</span>
        </label>
        <textarea id={`${uid}-experience`} rows={3} maxLength={600} value={p.experience || ''} onChange={(e) => set('experience', e.target.value)}
          className={inputClass} placeholder="Parcours, métier d'origine, entreprises déjà dirigées, ce que vous cherchez…" aria-describedby={`${uid}-experience-hint`} />
        <p id={`${uid}-experience-hint`} className="text-xs text-gray-500 mt-1">
          Le cédant lit ce texte sur votre carte repreneur, sans votre nom tant que l'accord de confidentialité n'est pas signé.
        </p>
      </div>
    </div>
  );
};

export default BuyerProfileFields;
