import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2, Play, RefreshCw } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { axiosInstance } from '@/App';
import AppHeader from '@/components/layout/AppHeader';
import EmailVerificationBanner from '@/components/EmailVerificationBanner';
import { usePrivateSeo } from '@/lib/seo';
import { apiErrorMessage } from '@/components/account/errors';
import AdminMetrics from '@/components/AdminMetrics';
import AdminMandates from '@/components/AdminMandates';
import AdminTodo from '@/components/admin/AdminTodo';
import AdminProperties from '@/components/admin/AdminProperties';
import AdminUsers from '@/components/admin/AdminUsers';
import AdminInvoices from '@/components/admin/AdminInvoices';
import AdminClosings from '@/components/admin/AdminClosings';
import { fmtEurCents, fmtNumber, jobsRunSummary } from '@/components/admin/shared';

// Administration (SPEC §9, API.md §9) : onglet par défaut « À faire » (dont les justificatifs de propriété à
// contrôler), puis Annonces, Utilisateurs, Mandats, Factures, Ventes, Métriques (écran du lundi). Bouton « Lancer les
// tâches » (POST /admin/jobs/run). La veille des registres et l'onglet Incidents sont retirés (SPEC §6.4).

export const ADMIN_TABS = [
  { value: 'todo', label: 'À faire' },
  { value: 'properties', label: 'Annonces' },
  { value: 'users', label: 'Utilisateurs' },
  { value: 'mandates', label: 'Mandats' },
  { value: 'invoices', label: 'Factures' },
  { value: 'closings', label: 'Ventes' },
  { value: 'metrics', label: 'Métriques' },
];

const isTab = (v) => ADMIN_TABS.some((t) => t.value === v);

const StatTile = ({ label, value, testId }) => (
  <div className="rounded-2xl bg-white border border-brand-line px-4 py-3 min-w-0" data-testid={testId}>
    <p className="text-[13px] text-gray-600 truncate">{label}</p>
    <p className="text-xl font-bold text-brand-navy tabular-nums truncate">{value}</p>
  </div>
);

const AdminDashboard = ({ user, setUser }) => {
  usePrivateSeo('Administration');
  const [params, setParams] = useSearchParams();
  const tab = isTab(params.get('tab')) ? params.get('tab') : 'todo';

  const [stats, setStats] = useState(null);
  const [todo, setTodo] = useState(null);
  const [properties, setProperties] = useState(null);
  const [users, setUsers] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingTodo, setLoadingTodo] = useState(true);
  const [runningJobs, setRunningJobs] = useState(false);
  const [focus, setFocus] = useState({}); // {tab: id} : ligne à mettre en évidence après une navigation interne
  const [emailBlocked, setEmailBlocked] = useState(false);

  const loadTodo = useCallback(async () => {
    setLoadingTodo(true);
    try {
      const res = await axiosInstance.get('/admin/todo');
      setTodo(res.data || { total: 0, sections: [] });
    } catch (err) {
      toast.error(apiErrorMessage(err, 'La liste « À faire » n\'a pas pu être chargée.'));
      setTodo((prev) => prev || { total: 0, sections: [] });
    } finally {
      setLoadingTodo(false);
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [statsRes, propertiesRes, usersRes] = await Promise.allSettled([
      axiosInstance.get('/admin/stats'),
      axiosInstance.get('/admin/properties'),
      axiosInstance.get('/admin/users'),
    ]);
    if (statsRes.status === 'fulfilled') setStats(statsRes.value.data || null);
    if (propertiesRes.status === 'fulfilled') setProperties(propertiesRes.value.data?.properties || []);
    if (usersRes.status === 'fulfilled') setUsers(Array.isArray(usersRes.value.data) ? usersRes.value.data : usersRes.value.data?.users || []);
    const failed = [statsRes, propertiesRes, usersRes].find((r) => r.status === 'rejected');
    if (failed) toast.error(apiErrorMessage(failed.reason, 'Une partie des données n\'a pas pu être chargée.'));
    setLoading(false);
  }, []);

  useEffect(() => { loadTodo(); loadAll(); }, [loadTodo, loadAll]);

  const setTab = (value) => {
    const next = new URLSearchParams(params);
    if (value === 'todo') next.delete('tab'); else next.set('tab', value);
    setParams(next, { replace: true });
  };

  // Navigation interne depuis « À faire » (ligne mise en évidence dans l'onglet cible)
  const navigateTo = (target, { id } = {}) => {
    if (!isTab(target)) return;
    setFocus((f) => ({ ...f, [target]: id || null }));
    setTab(target);
  };

  const refreshAfterAction = () => { loadTodo(); loadAll(); };

  const runJobs = async () => {
    setRunningJobs(true);
    try {
      const res = await axiosInstance.post('/admin/jobs/run');
      toast.success(jobsRunSummary(res.data));
      loadTodo();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Les tâches n\'ont pas pu être lancées.'));
    } finally {
      setRunningJobs(false);
    }
  };

  const tiles = useMemo(() => {
    const s = stats || {};
    const out = [];
    if (s.published_properties > 0) out.push({ key: 'published', label: 'Annonces en ligne', value: fmtNumber(s.published_properties) });
    if (s.total_properties > 0) out.push({ key: 'properties', label: 'Annonces au total', value: fmtNumber(s.total_properties) });
    if (s.ownership_pending > 0) out.push({ key: 'ownership', label: 'Justificatifs à contrôler', value: fmtNumber(s.ownership_pending) });
    if (s.total_users > 0) out.push({ key: 'users', label: 'Comptes', value: fmtNumber(s.total_users) });
    if (s.total_revenue > 0) out.push({ key: 'invoiced', label: 'Facturé (HT)', value: fmtEurCents(s.total_revenue) });
    if (s.paid_revenue > 0) out.push({ key: 'paid', label: 'Encaissé (HT)', value: fmtEurCents(s.paid_revenue) });
    return out;
  }, [stats]);

  const todoTotal = todo?.total || 0;

  return (
    <div className="min-h-screen bg-brand-surface">
      <AppHeader user={user} setUser={setUser} />

      <main id="contenu" className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 min-w-0">
        {emailBlocked && user?.email_verified !== false && (
          <EmailVerificationBanner user={{ ...user, email_verified: false }} setUser={setUser} compact className="mb-4" />
        )}

        <header className="mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 min-w-0">
          <div className="min-w-0">
            <p className="eyebrow mb-1">Administration</p>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-brand-navy tracking-tight">Tableau de bord</h1>
            <p className="text-sm text-gray-600 mt-1">Tout ce qui attend une action est dans « À faire » ; l'écran du lundi est dans « Métriques ».</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0" data-testid="admin-actions">
            <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={refreshAfterAction} disabled={loading || loadingTodo} data-testid="admin-refresh">
              <RefreshCw className={`w-4 h-4 ${loading || loadingTodo ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>Actualiser</span>
            </Button>
            <Button type="button" size="sm" className="rounded-xl bg-brand-teal hover:bg-brand-teal-dark text-white" onClick={runJobs} disabled={runningJobs} data-testid="admin-run-jobs">
              {runningJobs ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Play className="w-4 h-4" aria-hidden="true" />}
              <span>Lancer les tâches</span>
            </Button>
          </div>
        </header>

        {tiles.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6" data-testid="admin-stats">
            {tiles.map((t) => <StatTile key={t.key} label={t.label} value={t.value} testId={`stat-${t.key}`} />)}
          </div>
        )}

        <Tabs value={tab} onValueChange={setTab} className="w-full min-w-0">
          <TabsList className="flex w-full h-auto justify-start gap-1 overflow-x-auto rounded-xl p-1 mb-4" aria-label="Sections de l'administration">
            {ADMIN_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="rounded-lg shrink-0 px-3 py-1.5 text-sm" data-testid={`admin-tab-${t.value}`}>
                {t.label}
                {t.value === 'todo' && todoTotal > 0 && (
                  <span className="ml-1.5 inline-flex min-w-[1.5rem] justify-center rounded-full bg-brand-amber-soft px-1.5 text-[13px] font-semibold text-brand-amber tabular-nums" data-testid="todo-count">{todoTotal}</span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="todo" className="mt-0">
            <AdminTodo data={todo} loading={loadingTodo} onReload={refreshAfterAction} onNavigate={navigateTo} onEmailBlocked={() => setEmailBlocked(true)} />
          </TabsContent>
          <TabsContent value="properties" className="mt-0">
            <AdminProperties properties={properties} loading={loading} onReload={refreshAfterAction} focusId={focus.properties} onEmailBlocked={() => setEmailBlocked(true)} />
          </TabsContent>
          <TabsContent value="users" className="mt-0">
            <AdminUsers users={users} loading={loading} onReload={refreshAfterAction} focusId={focus.users} onEmailBlocked={() => setEmailBlocked(true)} />
          </TabsContent>
          <TabsContent value="mandates" className="mt-0">
            {tab === 'mandates' && <AdminMandates focusId={focus.mandates} />}
          </TabsContent>
          <TabsContent value="invoices" className="mt-0">
            {tab === 'invoices' && <AdminInvoices focusId={focus.invoices} onEmailBlocked={() => setEmailBlocked(true)} />}
          </TabsContent>
          <TabsContent value="closings" className="mt-0">
            {tab === 'closings' && <AdminClosings focusId={focus.closings} onNavigate={navigateTo} onEmailBlocked={() => setEmailBlocked(true)} />}
          </TabsContent>
          <TabsContent value="metrics" className="mt-0">
            {tab === 'metrics' && <AdminMetrics stats={stats} />}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default AdminDashboard;
