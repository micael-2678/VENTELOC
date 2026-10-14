import { TRADES, MAX_TRADES } from '@/lib/referentiels';
import { CheckCard } from './FormFields';

// Métiers du bâtiment (1 à 4) : cases très visibles, compteur, limite expliquée. Le premier métier coché
// donne le titre généré de l'annonce (« Entreprise de … »).
const TradePicker = ({ selected, onChange, error, disabled = false }) => {
  const list = Array.isArray(selected) ? selected : [];
  const full = list.length >= MAX_TRADES;
  const toggle = (id, checked) => {
    if (disabled) return;
    if (checked) {
      if (full || list.includes(id)) return;
      onChange([...list, id]);
    } else {
      onChange(list.filter((t) => t !== id));
    }
  };
  return (
    <fieldset className="min-w-0" data-testid="trade-picker">
      <legend className="text-sm font-semibold text-brand-navy mb-1">Métiers de l'entreprise *</legend>
      <p className="text-sm text-gray-600 mb-3">
        Cochez de 1 à {MAX_TRADES} métiers, le principal en premier.{' '}
        <span className="font-semibold text-brand-navy tabular" data-testid="trade-count">{list.length} / {MAX_TRADES}</span>
        {full && <span className="text-gray-500"> · limite atteinte, décochez un métier pour en changer</span>}
      </p>
      {/* Deux colonnes dès le mobile, libellés courts sous 640 px : 8 lignes au lieu de 16 */}
      <div className="grid grid-cols-2 gap-2">
        {TRADES.map((t) => {
          const checked = list.includes(t.id);
          const rank = checked ? list.indexOf(t.id) + 1 : 0;
          return (
            <CheckCard
              key={t.id}
              checked={checked}
              disabled={disabled || (!checked && full)}
              onChange={(v) => toggle(t.id, v)}
              label={(
                <>
                  <span className="sm:hidden">{t.short}</span>
                  <span className="hidden sm:inline">{t.label}</span>
                  {rank === 1 && ' (principal)'}
                </>
              )}
              testId={`trade-${t.id}`}
              compact
            />
          );
        })}
      </div>
      {error && <p role="alert" className="text-sm text-red-700 mt-2">{error}</p>}
    </fieldset>
  );
};

export default TradePicker;
