import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { axiosInstance } from '@/App';
import { formatDateFr } from '@/components/shared/formatters';
import { apiErrorMessage } from '@/components/account/errors';
import { DataTable, EmptyState, Loading, Pill, Section, currentMonth, fmtEur, fmtEurCents, fmtMonth, fmtNumber, fmtPct } from '@/components/admin/shared';

// Écran du lundi (SPEC §6.3, rapport final §7.6) : les 10 KPI, semaine en cours vs semaine précédente vs cible
// (GET /admin/kpis?weeks=8), revenu = factures émises / encaissées (GET /admin/stats), coûts du mois saisis
// (PUT /admin/costs, GET /admin/costs), événements des statistiques maison par jour et par nom (GET /admin/metrics).
// Couleurs sobres : ambre quand la cible n'est pas atteinte, rien de plus.

// `unit` : count | pct | hours | ratio | eur ; `better` : up (plus c'est haut, mieux c'est) | down
export const KPI_GROUPS = [
  { n: 1, title: 'Annonces publiées', items: [
    { key: 'listings_published', label: 'Annonces publiées', unit: 'count', better: 'up' },
    { key: 'listings_blocked', label: 'Publications bloquées', unit: 'count', better: 'down' },
  ] },
  { n: 2, title: 'Conversion du parcours vendeur', items: [
    { key: 'estimates_completed', label: 'Estimations terminées', unit: 'count', better: 'up' },
    { key: 'estimate_to_listing_pct', label: 'Estimation → annonce créée', unit: 'pct', better: 'up' },
    { key: 'listing_to_mandate_pct', label: 'Annonce créée → mandat signé', unit: 'pct', better: 'up' },
  ] },
  { n: 3, title: 'Autonomie de la publication', items: [
    { key: 'publish_delay_median_h', label: 'Délai dépôt → publication (médiane)', unit: 'hours', better: 'down' },
    { key: 'auto_publish_pct', label: 'Part publiée sans intervention humaine', unit: 'pct', better: 'up' },
    { key: 'ownership_pending', label: 'Justificatifs de propriété à contrôler', unit: 'count', better: 'down' },
  ] },
  { n: 4, title: 'Santé de la demande', items: [
    { key: 'contacts', label: 'Contacts envoyés', unit: 'count', better: 'up' },
    { key: 'contacts_per_listing_30d', label: 'Contacts par annonce (30 j)', unit: 'ratio', better: 'up' },
    { key: 'nda_signed', label: 'Engagements de confidentialité signés', unit: 'count', better: 'up' },
    { key: 'nda_per_listing_30d', label: 'Engagements par annonce (30 j)', unit: 'ratio', better: 'up' },
    { key: 'offers', label: 'Offres d\'achat', unit: 'count', better: 'up' },
  ] },
  { n: 5, title: 'Réactivité des vendeurs', items: [
    { key: 'seller_response_48h_pct', label: 'Réponse du vendeur sous 48 h', unit: 'pct', better: 'up' },
    { key: 'requests_expired', label: 'Demandes de dossier expirées sans réponse', unit: 'count', better: 'down' },
  ] },
  { n: 8, title: 'Ventes et encaissement', items: [
    { key: 'offers_accepted', label: 'Offres d\'achat acceptées', unit: 'count', better: 'up' },
    { key: 'sales_declared', label: 'Actes authentiques déclarés', unit: 'count', better: 'up' },
    { key: 'invoices_issued', label: 'Factures émises', unit: 'count', better: 'up' },
    { key: 'invoices_paid', label: 'Factures encaissées', unit: 'count', better: 'up' },
    { key: 'invoices_overdue', label: 'Factures en retard', unit: 'count', better: 'down' },
  ] },
  { n: 9, title: 'Trésorerie', items: [
    { key: 'costs', label: 'Coûts du mois', unit: 'eur', better: 'down' },
  ] },
  { n: 10, title: 'Charge du fondateur', items: [
    { key: 'blocking_actions', label: 'Actions humaines bloquantes', unit: 'count', better: 'down' },
  ] },
];

// Les KPI 6 (e-mailing) et 7 (SEO) se lisent dans les outils gratuits externes ; aucune valeur n'est inventée ici.
const EXTERNAL_KPIS = [
  { n: 6, title: 'E-mailing (Brevo)', text: 'Réponses ≥ 3 %, réponses positives ≥ 1 %, positives → annonce ≥ 10 %, rebonds < 3 %, plaintes < 0,1 %.' },
  { n: 7, title: 'SEO (Search Console)', text: 'Clics par semaine en croissance mensuelle ; top 10 à M+9 sur « appartement loué à vendre », « investissement locatif » et 5 requêtes ; pages indexées.' },
];

const EVENT_LABELS = {
  page_view: 'Pages vues',
  hero_cta_seller: 'Clic vendeur (accueil)',
  estimate_started: 'Estimations commencées',
  estimate_completed: 'Estimations terminées',
  calc_used: 'Calculateur de commission',
  alert_created: 'Alertes créées',
  listing_card_click: 'Clics sur une annonce',
  contact_sent: 'Contacts envoyés',
  register_started: 'Inscriptions commencées',
  register_completed: 'Inscriptions terminées',
  front_error: 'Erreurs du site',
  report: 'Signalements',
};
const eventLabel = (name) => EVENT_LABELS[name] || String(name || '').replace(/_/g, ' ');

const PERIODS = [7, 30, 90];

const isNum = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

// Valeur d'un KPI ; zéro et valeur absente s'affichent « — » (légende sous le tableau)
export const fmtKpi = (v, unit) => {
  if (!isNum(v) || Number(v) === 0) return '—';
  const n = Number(v);
  switch (unit) {
    case 'pct': return fmtPct(n);
    case 'hours': return n < 1 ? `${Math.round(n * 60)} min` : `${Math.round(n * 10) / 10} h`;
    case 'ratio': return (Math.round(n * 10) / 10).toLocaleString('fr-FR');
    case 'eur': return fmtEur(n);
    default: return fmtNumber(n);
  }
};

// Cible atteinte ? 'ok' | 'off' | null (pas de cible ou pas de valeur)
export const kpiStatus = (value, target, better) => {
  if (!isNum(target)) return null;
  const v = isNum(value) ? Number(value) : 0;
  const t = Number(target);
  return (better === 'down' ? v <= t : v >= t) ? 'ok' : 'off';
};

// Semaine et semaine précédente à partir de la réponse de GET /admin/kpis (tolère `current` = kpis ou {start,end,kpis})
export const pickWeeks = (data) => {
  const weeks = [...(data?.weeks || [])].sort((a, b) => String(a.start || '').localeCompare(String(b.start || '')));
  const cur = data?.current;
  const current = cur && typeof cur === 'object' ? (cur.kpis && typeof cur.kpis === 'object' ? cur : { kpis: cur }) : null;
  const hasCurrent = !!(current && Object.keys(current.kpis || {}).length);
  const thisWeek = hasCurrent ? current : weeks[weeks.length - 1] || null;
  const prevWeek = hasCurrent ? weeks[weeks.length - 1] || null : weeks[weeks.length - 2] || null;
  return { weeks, thisWeek, prevWeek };
};

const weekLabel = (w) => {
  if (!w) return '';
  const start = formatDateFr(w.start, { day: 'numeric', month: 'short' });
  const end = formatDateFr(w.end, { day: 'numeric', month: 'short' });
  return start && end ? `du ${start} au ${end}` : start || end || '';
};

const TrendCell = ({ item, value, prev }) => {
  const v = isNum(value) ? Number(value) : 0;
  const p = isNum(prev) ? Number(prev) : 0;
  const delta = v - p;
  const arrow = delta === 0 ? '' : delta > 0 ? '▲' : '▼';
  const good = delta === 0 ? null : (item.better === 'down') === (delta < 0);
  return (
    <span className="inline-flex items-center gap-1 tabular-nums">
      <span className="font-semibold text-brand-navy">{fmtKpi(value, item.unit)}</span>
      {arrow && <span className={`text-[13px] ${good ? 'text-gray-600' : 'text-brand-amber'}`} aria-label={delta > 0 ? 'en hausse' : 'en baisse'}>{arrow}</span>}
    </span>
  );
};

const AdminMetrics = ({ stats }) => {
  const [kpis, setKpis] = useState(null);
  const [kpisError, setKpisError] = useState('');
  const [costs, setCosts] = useState([]);
  const [costForm, setCostForm] = useState({ month: currentMonth(), amount: '', note: '' });
  const [savingCost, setSavingCost] = useState(false);
  const [days, setDays] = useState(30);
  const [metrics, setMetrics] = useState(null);
  const [loadingMetrics, setLoadingMetrics] = useState(true);
  const [loadingKpis, setLoadingKpis] = useState(true);
  const [localStats, setLocalStats] = useState(stats || null);

  const loadKpis = useCallback(async () => {
    setLoadingKpis(true);
    try {
      const res = await axiosInstance.get('/admin/kpis', { params: { weeks: 8 } });
      setKpis(res.data || null);
      setKpisError('');
    } catch (err) {
      setKpis(null);
      setKpisError(err?.response?.status === 404 ? 'Les indicateurs hebdomadaires ne sont pas encore disponibles sur ce serveur.' : apiErrorMessage(err, 'Les indicateurs n\'ont pas pu être chargés.'));
    } finally {
      setLoadingKpis(false);
    }
  }, []);

  const loadCosts = useCallback(async () => {
    try {
      const res = await axiosInstance.get('/admin/costs');
      const list = Array.isArray(res.data) ? res.data : res.data?.costs || [];
      setCosts([...list].filter((c) => c && c.month).sort((a, b) => String(b.month).localeCompare(String(a.month))));
    } catch (err) {
      setCosts([]);
    }
  }, []);

  const loadMetrics = useCallback(async () => {
    setLoadingMetrics(true);
    try {
      const res = await axiosInstance.get('/admin/metrics', { params: { days } });
      setMetrics(res.data || null);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Les statistiques n\'ont pas pu être chargées.'));
      setMetrics(null);
    } finally {
      setLoadingMetrics(false);
    }
  }, [days]);

  useEffect(() => { loadKpis(); loadCosts(); }, [loadKpis, loadCosts]);
  useEffect(() => { loadMetrics(); }, [loadMetrics]);
  useEffect(() => { if (stats) setLocalStats(stats); }, [stats]);
  useEffect(() => {
    if (stats) return;
    axiosInstance.get('/admin/stats').then((res) => setLocalStats(res.data || null)).catch(() => setLocalStats(null));
  }, [stats]);

  const saveCost = async (e) => {
    e.preventDefault();
    if (!/^\d{4}-\d{2}$/.test(costForm.month) || !(Number(costForm.amount) >= 0)) {
      toast.error('Indiquez le mois (AAAA-MM) et un montant en euros.');
      return;
    }
    setSavingCost(true);
    try {
      await axiosInstance.put('/admin/costs', { month: costForm.month, amount: Number(costForm.amount), note: costForm.note.trim() || undefined });
      toast.success(`Coûts du mois (${fmtMonth(costForm.month)}) enregistrés.`);
      setCostForm((f) => ({ ...f, amount: '', note: '' }));
      loadCosts();
      loadKpis();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Les coûts n\'ont pas pu être enregistrés.'));
    } finally {
      setSavingCost(false);
    }
  };

  const { weeks, thisWeek, prevWeek } = useMemo(() => pickWeeks(kpis), [kpis]);
  const targets = kpis?.targets || {};
  const offTarget = useMemo(() => KPI_GROUPS.flatMap((g) => g.items).filter((it) => kpiStatus(thisWeek?.kpis?.[it.key], targets[it.key], it.better) === 'off').length, [thisWeek, targets]);

  const events = metrics?.events || null;
  const names = useMemo(() => Object.entries(events?.totals || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([name]) => name), [events]);
  const activeDays = useMemo(() => (events?.days || []).filter((d) => d.visitors > 0 || Object.values(d.events || {}).some((n) => n > 0)).slice().reverse(), [events]);
  const funnel = (metrics?.funnel || []).filter((f) => f.count > 0);

  const revenueChips = [];
  if (localStats?.total_revenue > 0) revenueChips.push(<Pill key="issued" tone="info">Facturé : {fmtEurCents(localStats.total_revenue)} HT</Pill>);
  if (localStats?.paid_revenue > 0) revenueChips.push(<Pill key="paid" tone="success">Encaissé : {fmtEurCents(localStats.paid_revenue)} HT</Pill>);
  if (localStats?.invoices_count > 0) revenueChips.push(<Pill key="count" tone="info">{localStats.invoices_count} facture{localStats.invoices_count > 1 ? 's' : ''}</Pill>);

  const dayColumns = [
    { key: 'day', label: 'Jour', primary: true, nowrap: true, render: (d) => formatDateFr(d.day, { weekday: 'short', day: 'numeric', month: 'short' }) || d.day },
    { key: 'visitors', label: 'Visiteurs', align: 'right', render: (d) => (d.visitors > 0 ? fmtNumber(d.visitors) : '') },
    ...names.map((name) => ({ key: name, label: eventLabel(name), align: 'right', render: (d) => (d.events?.[name] > 0 ? fmtNumber(d.events[name]) : '') })),
  ];

  return (
    <div className="space-y-6" data-testid="admin-metrics">
      {/* 1. Les 10 KPI */}
      <Section
        title="Écran du lundi"
        description={thisWeek ? `Semaine ${weekLabel(thisWeek)}${prevWeek ? `, comparée à la semaine ${weekLabel(prevWeek)}` : ''} et aux cibles du plan.` : 'Les 10 indicateurs du plan, semaine par semaine, comparés aux cibles.'}
        actions={(
          <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={loadKpis} disabled={loadingKpis} aria-label="Actualiser les indicateurs">
            <RefreshCw className={`w-4 h-4 ${loadingKpis ? 'animate-spin' : ''}`} aria-hidden="true" />
          </Button>
        )}
        testId="kpi-section"
      >
        {loadingKpis && !kpis ? (
          <Loading label="Chargement des indicateurs…" />
        ) : !kpis || !thisWeek ? (
          <EmptyState testId="kpi-empty">{kpisError || 'Aucune semaine mesurée pour le moment : les indicateurs apparaissent dès la première semaine d\'activité.'}</EmptyState>
        ) : (
          <>
            {offTarget > 0 && <p className="text-sm text-brand-amber mb-3" data-testid="kpi-off-target">{offTarget} indicateur{offTarget > 1 ? 's' : ''} sous la cible cette semaine.</p>}
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <table className="min-w-full text-sm" data-testid="kpi-table">
                <thead>
                  <tr className="text-left text-gray-600 border-b border-brand-line">
                    <th scope="col" className="py-2 px-3 font-medium">Indicateur</th>
                    <th scope="col" className="py-2 px-3 font-medium text-right whitespace-nowrap">Cette semaine</th>
                    <th scope="col" className="py-2 px-3 font-medium text-right whitespace-nowrap">Semaine précédente</th>
                    <th scope="col" className="py-2 px-3 font-medium text-right whitespace-nowrap">Cible</th>
                  </tr>
                </thead>
                <tbody>
                  {KPI_GROUPS.map((group) => (
                    [
                      <tr key={`g-${group.n}`} className="bg-brand-surface">
                        <th scope="rowgroup" colSpan={4} className="py-1.5 px-3 text-left text-[13px] font-semibold uppercase tracking-wide text-gray-600">{group.n}. {group.title}</th>
                      </tr>,
                      ...group.items.map((item) => {
                        const status = kpiStatus(thisWeek.kpis?.[item.key], targets[item.key], item.better);
                        return (
                          <tr key={item.key} className="border-b border-brand-line last:border-0" data-testid={`kpi-${item.key}`}>
                            <td className="py-2 px-3 text-brand-navy min-w-[12rem]">
                              <span className="inline-flex items-center gap-2">
                                <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${status === 'off' ? 'bg-brand-amber' : status === 'ok' ? 'bg-brand-navy' : 'bg-gray-300'}`} aria-hidden="true" />
                                {item.label}
                                {status === 'off' && <span className="sr-only">(sous la cible)</span>}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-right"><TrendCell item={item} value={thisWeek.kpis?.[item.key]} prev={prevWeek?.kpis?.[item.key]} /></td>
                            <td className="py-2 px-3 text-right tabular-nums text-gray-700">{fmtKpi(prevWeek?.kpis?.[item.key], item.unit)}</td>
                            <td className="py-2 px-3 text-right tabular-nums text-gray-700">{isNum(targets[item.key]) ? `${item.better === 'down' ? '≤' : '≥'} ${fmtKpi(targets[item.key], item.unit) === '—' ? '0' : fmtKpi(targets[item.key], item.unit)}` : '—'}</td>
                          </tr>
                        );
                      }),
                    ]
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[13px] text-gray-600 mt-3">— : aucun sur la période. Point ambre : cible non atteinte. ▲ ▼ : évolution par rapport à la semaine précédente.</p>
            {weeks.length > 1 && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium text-brand-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue rounded">Les {weeks.length} dernières semaines (annonces, contacts, engagements, offres, factures encaissées)</summary>
                <div className="overflow-x-auto -mx-4 sm:mx-0 mt-2">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-600 border-b border-brand-line">
                        <th scope="col" className="py-2 px-3 font-medium">Semaine</th>
                        {['listings_published', 'contacts', 'nda_signed', 'offers', 'invoices_paid'].map((k) => (
                          <th key={k} scope="col" className="py-2 px-3 font-medium text-right whitespace-nowrap">{KPI_GROUPS.flatMap((g) => g.items).find((i) => i.key === k)?.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {weeks.slice().reverse().map((w) => (
                        <tr key={w.start} className="border-b border-brand-line last:border-0">
                          <td className="py-1.5 px-3 whitespace-nowrap">{weekLabel(w) || w.start}</td>
                          {['listings_published', 'contacts', 'nda_signed', 'offers', 'invoices_paid'].map((k) => (
                            <td key={k} className="py-1.5 px-3 text-right tabular-nums">{fmtKpi(w.kpis?.[k], 'count')}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </>
        )}
        <ul className="mt-4 grid sm:grid-cols-2 gap-3">
          {EXTERNAL_KPIS.map((k) => (
            <li key={k.n} className="rounded-xl border border-brand-line bg-brand-surface p-3 text-sm min-w-0">
              <p className="font-semibold text-brand-navy">{k.n}. {k.title} — suivi hors plateforme</p>
              <p className="text-gray-700 mt-0.5">{k.text}</p>
            </li>
          ))}
        </ul>
      </Section>

      {/* 2. Revenu et coûts */}
      <div className="grid lg:grid-cols-2 gap-6">
        <Section title="Revenu" description="Factures d'honoraires émises et encaissées, montants HT (onglet Factures pour le détail)." testId="revenue-section">
          {revenueChips.length ? <div className="flex flex-wrap gap-2">{revenueChips}</div> : <EmptyState>Aucune facture émise pour le moment : le revenu apparaît à la première vente confirmée.</EmptyState>}
        </Section>

        <Section title="Coûts du mois" description="Saisie manuelle (hébergement, domaine, vérifications d'identité, publicité). Cible : 600 € par mois au plus." testId="costs-section">
          <form onSubmit={saveCost} className="grid grid-cols-1 sm:grid-cols-[8rem_1fr_auto] gap-3 items-end" data-testid="costs-form">
            <div className="space-y-1">
              <label htmlFor="cost-month" className="block text-sm font-medium text-brand-navy">Mois</label>
              <Input id="cost-month" type="month" value={costForm.month} onChange={(e) => setCostForm((f) => ({ ...f, month: e.target.value }))} className="rounded-xl" data-testid="cost-month" />
            </div>
            <div className="space-y-1">
              <label htmlFor="cost-amount" className="block text-sm font-medium text-brand-navy">Montant (euros)</label>
              <Input id="cost-amount" type="number" min="0" step="1" inputMode="numeric" value={costForm.amount} onChange={(e) => setCostForm((f) => ({ ...f, amount: e.target.value }))} className="rounded-xl" data-testid="cost-amount" />
            </div>
            <Button type="submit" size="sm" className="rounded-xl bg-brand-teal hover:bg-brand-teal-dark text-white h-9" disabled={savingCost} data-testid="cost-save">
              {savingCost && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
              Enregistrer
            </Button>
            <div className="space-y-1 sm:col-span-3">
              <label htmlFor="cost-note" className="block text-sm font-medium text-brand-navy">Détail (facultatif)</label>
              <Input id="cost-note" type="text" maxLength={500} value={costForm.note} onChange={(e) => setCostForm((f) => ({ ...f, note: e.target.value }))} placeholder="Hébergement 12 €, Stripe Identity 3 €, publicité 150 €…" className="rounded-xl" data-testid="cost-note" />
            </div>
          </form>
          {costs.length > 0 && (
            <ul className="mt-4 divide-y divide-brand-line" data-testid="costs-list">
              {costs.slice(0, 6).map((c) => (
                <li key={c.month} className="flex justify-between gap-3 py-2 text-sm min-w-0">
                  <span className="min-w-0 break-words">
                    <span className="font-medium text-brand-navy capitalize">{fmtMonth(c.month)}</span>
                    {c.note && <span className="text-gray-600"> · {c.note}</span>}
                  </span>
                  <span className={`tabular-nums shrink-0 ${Number(c.amount) > 600 ? 'text-brand-amber font-semibold' : 'text-brand-navy'}`}>{fmtEur(c.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {/* 3. Statistiques maison */}
      <Section
        title="Fréquentation et événements"
        description="Statistiques maison sans cookie : visiteurs par jour (empreinte quotidienne) et événements du site."
        actions={(
          <>
            {PERIODS.map((p) => (
              <Button key={p} type="button" size="sm" variant={days === p ? 'default' : 'outline'} className={`rounded-xl ${days === p ? 'bg-brand-teal hover:bg-brand-teal-dark text-white' : ''}`} onClick={() => setDays(p)} data-testid={`metrics-period-${p}`}>
                {p} jours
              </Button>
            ))}
            <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={loadMetrics} disabled={loadingMetrics} aria-label="Actualiser les statistiques">
              <RefreshCw className={`w-4 h-4 ${loadingMetrics ? 'animate-spin' : ''}`} aria-hidden="true" />
            </Button>
          </>
        )}
        testId="events-section"
      >
        {loadingMetrics && !metrics ? (
          <Loading label="Chargement des statistiques…" />
        ) : !events || names.length === 0 ? (
          <EmptyState testId="events-empty">Aucun événement enregistré sur les {days} derniers jours.</EmptyState>
        ) : (
          <div className={`space-y-6 ${loadingMetrics ? 'opacity-60' : ''}`}>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {events.visitor_days > 0 && (
                <div className="rounded-xl border border-brand-line p-3">
                  <p className="text-[13px] text-gray-600">Visiteurs (jours de visite)</p>
                  <p className="text-xl font-bold text-brand-navy tabular-nums">{fmtNumber(events.visitor_days)}</p>
                </div>
              )}
              {names.slice(0, 5).map((name) => (
                <div key={name} className="rounded-xl border border-brand-line p-3 min-w-0">
                  <p className="text-[13px] text-gray-600 break-words">{eventLabel(name)}</p>
                  <p className="text-xl font-bold text-brand-navy tabular-nums">{fmtNumber(events.totals[name])}</p>
                </div>
              ))}
            </div>

            <div>
              <h3 className="font-semibold text-brand-navy mb-2">Par nom d'événement</h3>
              <DataTable
                columns={[
                  { key: 'name', label: 'Événement', primary: true, render: (r) => eventLabel(r.name) },
                  { key: 'count', label: 'Total', align: 'right', render: (r) => fmtNumber(r.count) },
                ]}
                rows={names.map((name) => ({ id: name, name, count: events.totals[name] }))}
                testId="events-by-name"
              />
            </div>

            <div>
              <h3 className="font-semibold text-brand-navy mb-2">Par jour</h3>
              <DataTable columns={dayColumns} rows={activeDays.map((d) => ({ ...d, id: d.day }))} emptyText="Aucun jour avec activité sur la période." testId="events-by-day" />
            </div>

            {(events.paths || []).length > 0 && (
              <div>
                <h3 className="font-semibold text-brand-navy mb-2">Pages les plus vues</h3>
                <DataTable
                  columns={[
                    { key: 'path', label: 'Page', primary: true, render: (r) => <span className="break-all">{r.path}</span> },
                    { key: 'count', label: 'Vues', align: 'right', render: (r) => fmtNumber(r.count) },
                  ]}
                  rows={events.paths.filter((p) => p.count > 0).map((p) => ({ ...p, id: p.path }))}
                  testId="events-paths"
                />
              </div>
            )}

            {funnel.length > 0 && (
              <div>
                <h3 className="font-semibold text-brand-navy mb-2">Entonnoir acquéreurs (inscrits sur la période)</h3>
                <DataTable
                  columns={[
                    { key: 'step', label: 'Étape', primary: true },
                    { key: 'count', label: 'Comptes', align: 'right', render: (r) => fmtNumber(r.count) },
                  ]}
                  rows={funnel.map((f) => ({ ...f, id: f.step }))}
                  testId="buyer-funnel"
                />
              </div>
            )}
          </div>
        )}
      </Section>
    </div>
  );
};

export default AdminMetrics;
