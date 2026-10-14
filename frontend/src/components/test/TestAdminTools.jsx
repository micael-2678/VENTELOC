import { useState } from 'react';
import { CalendarClock, Loader2, ShieldAlert, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { axiosInstance } from '@/App';
import { apiErrorMessage } from '@/components/account/errors';
import { clearStoredSession } from '@/components/layout/session';
import { BTN_PRIMARY, BTN_QUIET } from '@/components/shared/buttonStyles';
import TestPanelSection from '@/components/test/TestPanelSection';

// Outils d'administration du mode test (MODE-TEST-ET-APP.md §B.2.11, §B.3) :
// - POST /admin/jobs/run : lance tout de suite les tâches planifiées (relances, expirations, digest…) ;
// - POST /admin/test/purge?dry_run=true puis false : supprime tout ce qui est `is_test` ou rattaché à un compte de test.
// La purge est disponible même hors mode test (nettoyage avant l'ouverture réelle).

const COLLECTION_LABELS = {
  users: 'Comptes',
  companies: 'Annonces',
  company_photos: 'Photos d\'annonce',
  conversations: 'Conversations',
  messages: 'Messages',
  dataroom: 'Documents de data room',
  dataroom_access: 'Accès au dossier',
  dataroom_access_logs: 'Consultations du dossier',
  generated_contracts: 'Contrats',
  documents: 'Documents signés',
  signature_otps: 'Codes de signature',
  offers: 'Offres',
  offer_pdfs: 'PDF d\'offre',
  closings: 'Étapes de vente',
  invoices: 'Factures',
  alerts: 'Alertes',
  public_alerts: 'Alertes sans compte',
  favorites: 'Favoris',
  events: 'Événements',
  estimates: 'Estimations',
  test_emails: 'E-mails de test',
  counters: 'Compteurs de test',
  contacts: 'Mises en relation',
  followups: 'Suivis',
  todos: 'Tâches admin',
  audit_logs: 'Journal d\'audit',
  contact_reveal_logs: 'Journaux d\'identité révélée',
  'companies.presented_buyers': 'Repreneurs de test retirés des listes de présentation',
  'closings.invoice_id': 'Ventes réelles détachées de leur facture de test',
};

// Données réelles rattachées à une donnée de test, jamais supprimées (mandats du registre réel, factures réelles)
export const protectedRows = (protectedData) => [
  ...((protectedData?.generated_contracts) || []).map((c) => ({ key: `mandat-${c.id}`, label: `Mandat n° ${c.registry_number} (registre réel)` })),
  ...((protectedData?.invoices) || []).map((i) => ({ key: `facture-${i.id}`, label: `Facture ${i.number}` })),
];

export const purgeRows = (counts) => Object.entries(counts || {})
  .filter(([, n]) => Number(n) > 0)
  .map(([key, n]) => ({ key, label: COLLECTION_LABELS[key] || key, count: Number(n) }));

const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

const TestAdminTools = ({ user, setUser, testMode }) => {
  const [jobsRunning, setJobsRunning] = useState(false);
  const [jobsDone, setJobsDone] = useState(null);
  const [plan, setPlan] = useState(null); // résultat du dry-run
  const [counting, setCounting] = useState(false);
  const [purging, setPurging] = useState(false);

  const runJobs = async () => {
    setJobsRunning(true);
    try {
      const res = await axiosInstance.post('/admin/jobs/run');
      const names = Object.keys(res.data || {});
      setJobsDone(names);
      toast.success(names.length > 0 ? `Tâches planifiées exécutées (${plural(names.length, 'tâche', 'tâches')}).` : 'Tâches planifiées lancées : rien à traiter.');
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Les tâches planifiées n\'ont pas pu être lancées.'));
    } finally {
      setJobsRunning(false);
    }
  };

  const countTestData = async () => {
    setCounting(true);
    try {
      const res = await axiosInstance.post('/admin/test/purge', null, { params: { dry_run: true } });
      setPlan(res.data || { counts: {} });
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Les données de test n\'ont pas pu être comptées.'));
    } finally {
      setCounting(false);
    }
  };

  const purge = async () => {
    setPurging(true);
    try {
      const res = await axiosInstance.post('/admin/test/purge', null, { params: { dry_run: false } });
      const rows = purgeRows(res.data?.counts);
      const total = Number(res.data?.total) || rows.reduce((s, r) => s + r.count, 0);
      setPlan(null);
      // Un compte de démonstration supprime aussi son propre compte : la session n'a plus de sens
      const selfDeleted = Boolean(user?.is_test) || /@test\.local$/i.test(user?.email || '');
      if (selfDeleted) {
        clearStoredSession();
        if (typeof setUser === 'function') setUser(null);
        toast.success('Données de test supprimées, y compris ce compte de démonstration : vous êtes déconnecté.');
      } else {
        toast.success(total > 0 ? `Données de test supprimées (${plural(total, 'document', 'documents')}).` : 'Aucune donnée de test à supprimer.');
      }
    } catch (e) {
      toast.error(apiErrorMessage(e, 'La suppression des données de test a échoué.'));
    } finally {
      setPurging(false);
    }
  };

  const rows = plan ? purgeRows(plan.counts) : [];
  const total = plan ? (Number(plan.total) || rows.reduce((s, r) => s + r.count, 0)) : 0;
  const files = Number(plan?.files) || 0;
  const kept = plan ? protectedRows(plan.protected) : [];

  return (
    <TestPanelSection
      id="test-admin"
      title="Administration"
      icon={ShieldAlert}
      intro={testMode
        ? 'Faire avancer les relances sans attendre, puis nettoyer les données d\'essai.'
        : 'Avant l\'ouverture réelle : supprimez les comptes, annonces et documents créés pendant le mode test.'}
      testId="test-admin"
    >
      <div className="space-y-5">
        {testMode && (
          <div>
            <button type="button" onClick={runJobs} disabled={jobsRunning} className={`${BTN_PRIMARY} px-4 py-2.5 text-sm`} data-testid="test-run-jobs">
              {jobsRunning ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <CalendarClock className="w-4 h-4" aria-hidden="true" />}
              Lancer les tâches planifiées
            </button>
            <p className="text-sm text-gray-600 mt-1">Relances, expirations et récapitulatifs quotidiens, hebdomadaires et mensuels, exécutés maintenant.</p>
            {jobsDone && jobsDone.length > 0 && (
              <p className="text-sm text-gray-700 mt-1 break-words" data-testid="test-jobs-result">Exécutées : {jobsDone.join(', ')}.</p>
            )}
          </div>
        )}

        <div>
          {!plan ? (
            <button type="button" onClick={countTestData} disabled={counting} className={`${BTN_QUIET} px-4 py-2.5 text-sm text-red-700`} data-testid="test-purge-dry-run">
              {counting ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Trash2 className="w-4 h-4" aria-hidden="true" />}
              Supprimer toutes les données de test
            </button>
          ) : rows.length === 0 ? (
            <div className="rounded-xl border border-brand-line bg-brand-surface p-3 text-sm text-brand-navy" data-testid="test-purge-empty">
              <p>Aucune donnée de test à supprimer.</p>
              <button type="button" onClick={() => setPlan(null)} className="btn-link text-sm mt-1">Fermer</button>
            </div>
          ) : (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900" role="alert" data-testid="test-purge-plan">
              <p className="font-semibold">
                {plural(total, 'document de test sera supprimé', 'documents de test seront supprimés')} définitivement
                {files > 0 ? `, ainsi que ${plural(files, 'fichier stocké', 'fichiers stockés')}` : ''} :
              </p>
              <ul className="mt-2 grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
                {rows.map((r) => (
                  <li key={r.key} className="flex justify-between gap-3 min-w-0">
                    <span className="min-w-0 break-words">{r.label}</span>
                    <span className="tabular font-semibold">{r.count}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2">Les données réelles ne sont jamais touchées.</p>
              {kept.length > 0 && (
                <div className="mt-2" data-testid="test-purge-protected">
                  <p className="font-semibold">Conservés car réels (à examiner) :</p>
                  <ul className="list-disc pl-5">
                    {kept.map((k) => <li key={k.key} className="break-words">{k.label}</li>)}
                  </ul>
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={purge}
                  disabled={purging}
                  className="inline-flex items-center gap-2 rounded-xl bg-red-700 px-4 py-2.5 font-semibold text-white hover:bg-red-800 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2"
                  data-testid="test-purge-confirm"
                >
                  {purging && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                  Confirmer la suppression
                </button>
                <button type="button" onClick={() => setPlan(null)} disabled={purging} className={`${BTN_QUIET} px-4 py-2.5 text-sm`}>Annuler</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </TestPanelSection>
  );
};

export default TestAdminTools;
