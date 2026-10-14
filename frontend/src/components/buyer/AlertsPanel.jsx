import { useId, useState } from 'react';
import { toast } from 'sonner';
import { Bell, BellOff, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { axiosInstance } from '@/App';
import { cn } from '@/lib/utils';
import { TRADES, REGIONS, tradeLabel } from '@/lib/referentiels';
import { trackEvent } from '@/lib/analytics';
import { formatPrice } from '@/components/shared/formatters';
import { apiErrorMessage, isEmailNotVerifiedError } from '@/components/account/errors';
import { normalizeAlert, alertPayload, alertName } from './api';

// Alertes du repreneur connecté (API.md §8) : POST/GET/PUT/DELETE /alerts avec trades, regions, max_price, rge.
// Cinq alertes au maximum ; activation / désactivation ; e-mail immédiat à la publication d'une annonce qui correspond.

const PRICE_OPTIONS = [
  { value: '', label: 'Sans limite de prix' },
  { value: '150000', label: 'Jusqu\'à 150 000 €' },
  { value: '300000', label: 'Jusqu\'à 300 000 €' },
  { value: '500000', label: 'Jusqu\'à 500 000 €' },
  { value: '1000000', label: 'Jusqu\'à 1 000 000 €' },
  { value: '2000000', label: 'Jusqu\'à 2 000 000 €' },
];
const MAX_ALERTS = 5;

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
                'peer-focus-visible:ring-2 peer-focus-visible:ring-brand-blue peer-focus-visible:ring-offset-1',
                checked ? 'bg-brand-navy border-brand-navy text-white' : 'bg-white border-brand-line text-brand-navy hover:border-brand-navy/50',
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

const AlertEditor = ({ initial, onSaved, onCancel }) => {
  const idp = useId();
  const [trades, setTrades] = useState(initial?.trades || []);
  const [regions, setRegions] = useState(initial?.regions || []);
  const [maxPrice, setMaxPrice] = useState(initial?.maxPrice ? String(initial.maxPrice) : '');
  const [rge, setRge] = useState(initial?.rge === true ? 'true' : 'all');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const toggle = (setter) => (value) => setter((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    const payload = alertPayload({ trades, regions, maxPrice, rge: rge === 'true' ? true : null, name: alertName({ trades, regions, maxPrice, rge: rge === 'true', tradeLabel: (t) => tradeLabel(t, true) || t }) });
    try {
      if (initial?.id) {
        await axiosInstance.put(`/alerts/${initial.id}`, payload);
        toast.success('Alerte mise à jour');
      } else {
        await axiosInstance.post('/alerts', payload);
        toast.success('Alerte créée : vous recevrez les annonces qui correspondent dès leur publication.');
        trackEvent('alert_created', { source: 'buyer_dashboard', trades: trades.length, regions: regions.length, max_price: payload.max_price });
      }
      await onSaved();
    } catch (err) {
      if (isEmailNotVerifiedError(err)) setError('Confirmez d\'abord votre adresse e-mail (bandeau en haut de page) pour créer une alerte.');
      else setError(apiErrorMessage(err, 'L\'alerte n\'a pas pu être enregistrée.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="rounded-xl border border-brand-line bg-white p-4 space-y-4 min-w-0" data-testid="alert-editor">
      <PillGroup legend="Métiers" name="trades" options={TRADES.map((t) => ({ value: t.id, label: t.short || t.label }))} selected={trades} onToggle={toggle(setTrades)} idPrefix={idp} />
      <PillGroup legend="Régions" name="regions" options={REGIONS.map((r) => ({ value: r, label: r }))} selected={regions} onToggle={toggle(setRegions)} idPrefix={idp} />
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor={`${idp}-price`} className="block text-sm font-semibold text-brand-navy mb-1">Prix maximum</label>
          <select id={`${idp}-price`} value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} className="w-full rounded-xl border border-brand-line bg-white px-4 py-2.5 text-sm text-brand-navy focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30">
            {PRICE_OPTIONS.map((o) => <option key={o.value || 'none'} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`${idp}-rge`} className="block text-sm font-semibold text-brand-navy mb-1">Qualification RGE</label>
          <select id={`${idp}-rge`} value={rge} onChange={(e) => setRge(e.target.value)} className="w-full rounded-xl border border-brand-line bg-white px-4 py-2.5 text-sm text-brand-navy focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30">
            <option value="all">RGE ou non</option>
            <option value="true">Entreprises RGE uniquement</option>
          </select>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-primary px-4 py-2.5 text-sm" disabled={saving} data-testid="alert-save">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Bell className="w-4 h-4" aria-hidden="true" />}
          {initial?.id ? 'Enregistrer' : 'Créer mon alerte'}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary px-4 py-2.5 text-sm"><X className="w-4 h-4" aria-hidden="true" />Annuler</button>
      </div>
    </form>
  );
};

const AlertsPanel = ({ alerts, onChanged }) => {
  const [editing, setEditing] = useState(null); // null | 'new' | alert
  const [busyId, setBusyId] = useState(null);
  const list = (Array.isArray(alerts) ? alerts : []).map(normalizeAlert);

  const toggleActive = async (alert) => {
    setBusyId(alert.id);
    try {
      await axiosInstance.put(`/alerts/${alert.id}`, { active: !alert.active });
      await onChanged();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (alert) => {
    setBusyId(alert.id);
    try {
      await axiosInstance.delete(`/alerts/${alert.id}`);
      toast.success('Alerte supprimée');
      await onChanged();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-3 min-w-0" data-testid="alerts-panel">
      {list.length === 0 && editing === null && (
        <p className="text-sm text-gray-600">Aucune alerte. Créez-en une pour recevoir par e-mail les annonces qui correspondent à vos métiers, vos régions et votre budget, dès leur publication.</p>
      )}
      {list.length > 0 && (
        <ul className="space-y-2">
          {list.map((a) => (
            <li key={a.id} className="rounded-xl border border-brand-line bg-white p-3 sm:p-4 min-w-0" data-testid={`alert-${a.id}`}>
              {editing && editing.id === a.id ? (
                <AlertEditor initial={a} onSaved={async () => { setEditing(null); await onChanged(); }} onCancel={() => setEditing(null)} />
              ) : (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 min-w-0">
                  <div className="min-w-0">
                    <p className="font-medium text-brand-navy break-words">
                      {a.trades.length ? a.trades.map((t) => tradeLabel(t, true) || t).join(', ') : 'Tous les métiers'}
                      {' · '}
                      {a.regions.length ? a.regions.join(', ') : 'Toute la France'}
                    </p>
                    <p className="text-sm text-gray-600">
                      {a.maxPrice ? `Jusqu'à ${formatPrice(a.maxPrice)}` : 'Sans limite de prix'}{a.rge === true ? ' · RGE uniquement' : ''}
                      {' · '}<span className={a.active ? 'text-brand-green-dark' : 'text-gray-500'}>{a.active ? 'Active' : 'En pause'}</span>
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1 shrink-0">
                    <button type="button" onClick={() => toggleActive(a)} disabled={busyId === a.id} className="btn-secondary px-3 py-2 text-sm" aria-label={a.active ? 'Mettre l\'alerte en pause' : 'Réactiver l\'alerte'}>
                      {a.active ? <BellOff className="w-4 h-4" aria-hidden="true" /> : <Bell className="w-4 h-4" aria-hidden="true" />}
                      <span className="sr-only sm:not-sr-only">{a.active ? 'Pause' : 'Activer'}</span>
                    </button>
                    <button type="button" onClick={() => setEditing(a)} className="btn-secondary px-3 py-2 text-sm" aria-label="Modifier l'alerte">
                      <Pencil className="w-4 h-4" aria-hidden="true" />
                      <span className="sr-only sm:not-sr-only">Modifier</span>
                    </button>
                    <button type="button" onClick={() => remove(a)} disabled={busyId === a.id} className="btn-secondary px-3 py-2 text-sm text-red-700 border-red-200" aria-label="Supprimer l'alerte">
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                      <span className="sr-only sm:not-sr-only">Supprimer</span>
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing === 'new' ? (
        <AlertEditor onSaved={async () => { setEditing(null); await onChanged(); }} onCancel={() => setEditing(null)} />
      ) : (
        list.length < MAX_ALERTS && (
          <button type="button" onClick={() => setEditing('new')} className="btn-secondary px-4 py-2.5 text-sm" data-testid="alert-new">
            <Plus className="w-4 h-4" aria-hidden="true" />
            Nouvelle alerte
          </button>
        )
      )}
      {list.length >= MAX_ALERTS && <p className="text-xs text-gray-500">Cinq alertes au maximum : modifiez-en une pour changer vos critères.</p>}
    </div>
  );
};

export default AlertsPanel;
