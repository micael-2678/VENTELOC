import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Radar, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { axiosInstance } from '@/App';
import { apiErrorMessage, isEmailNotVerifiedError } from '@/components/account/errors';
import { ActionButton, EmptyState, ExtLink, FilterSelect, Loading, NoteDialog, Pill, Section, fmtDate, sinceText } from './shared';

// Onglet « Incidents » (SPEC §6.4) : veille BODACC sur les SIREN sous mandat, clause de suite ou NDA.
// GET /admin/incidents, PUT /admin/incidents/{id} {status, note}, POST /admin/veille/run.

const STATUS_FILTERS = [
  { value: 'open', label: 'Ouverts' },
  { value: 'closed', label: 'Clos' },
  { value: 'all', label: 'Tous' },
];

const eventTitle = (i) => {
  const ev = i.event || {};
  const kind = [ev.famille_label || ev.famille, ev.type_label].filter(Boolean).join(' · ') || 'Publication';
  return `BODACC : ${kind}`;
};

const AdminIncidents = ({ focusId, onEmailBlocked }) => {
  const [status, setStatus] = useState('open');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [dialog, setDialog] = useState(null); // {incident, next: 'closed'|'open'}

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axiosInstance.get('/admin/incidents', { params: { status } });
      setData(res.data?.incidents || []);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Les incidents n\'ont pas pu être chargés.'));
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { load(); }, [load]);

  const update = async (incident, next, note) => {
    try {
      await axiosInstance.put(`/admin/incidents/${incident.id}`, { status: next, note: note || '' });
      toast.success(next === 'closed' ? 'Incident clos.' : 'Incident rouvert.');
      load();
    } catch (err) {
      if (isEmailNotVerifiedError(err)) onEmailBlocked?.();
      toast.error(apiErrorMessage(err));
      throw err;
    }
  };

  const runVeille = async () => {
    setRunning(true);
    try {
      const res = await axiosInstance.post('/admin/veille/run');
      const r = res.data || {};
      const created = Number(r.incidents_created || 0);
      toast.success(`Veille lancée : ${r.checked ?? 0} SIREN consulté${(r.checked ?? 0) > 1 ? 's' : ''} sur ${r.sirens ?? 0} surveillé${(r.sirens ?? 0) > 1 ? 's' : ''}, ${created ? `${created} incident${created > 1 ? 's' : ''} créé${created > 1 ? 's' : ''}` : 'aucun nouvel incident'}.`);
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'La veille n\'a pas pu être lancée.'));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Section
      title="Incidents BODACC"
      description="Annonces de vente, cession ou changement de dirigeant relevées au BODACC après la signature d'un mandat, sans vente déclarée sur la plateforme. Le cédant est interrogé par e-mail."
      actions={(
        <>
          <FilterSelect id="incidents-filter" label="Afficher" value={status} onChange={setStatus} options={STATUS_FILTERS} testId="incidents-filter" />
          <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={load} disabled={loading} aria-label="Actualiser les incidents">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          </Button>
          <ActionButton tone="primary" onClick={runVeille} busy={running} testId="veille-run">
            <Radar className="w-4 h-4" aria-hidden="true" />
            Lancer la veille
          </ActionButton>
        </>
      )}
      testId="admin-incidents"
    >
      {loading && !data ? (
        <Loading label="Chargement des incidents…" />
      ) : (data || []).length === 0 ? (
        <EmptyState icon={AlertTriangle} testId="incidents-empty">{status === 'open' ? 'Aucun incident ouvert : rien à traiter.' : 'Aucun incident dans ce statut.'}</EmptyState>
      ) : (
        <ul className="space-y-3">
          {data.map((i) => {
            const ev = i.event || {};
            return (
              <li key={i.id} className={`rounded-xl border p-4 min-w-0 ${focusId === i.id ? 'border-brand-blue ring-2 ring-brand-blue' : 'border-brand-line'}`} data-testid={`incident-${i.id}`}>
                <div className="flex flex-col lg:flex-row lg:items-start gap-3 min-w-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-brand-navy break-words">{eventTitle(i)}</h3>
                      <Pill tone={i.status === 'open' ? 'danger' : 'info'}>{i.status === 'open' ? 'Ouvert' : 'Clos'}</Pill>
                    </div>
                    <p className="text-sm text-gray-700 mt-1 break-words">
                      {[i.property_label, i.siren ? `SIREN ${i.siren}` : '', ev.date ? `parution le ${fmtDate(ev.date)}` : '', ev.tribunal].filter(Boolean).join(' · ')}
                    </p>
                    {ev.description && <p className="text-sm text-gray-700 mt-1 break-words">{String(ev.description).slice(0, 400)}</p>}
                    {i.note && <p className="text-sm text-gray-700 mt-1 break-words"><span className="text-gray-600">Note : </span>{i.note}</p>}
                    <p className="text-[13px] text-gray-600 mt-1">
                      {[sinceText(i.created_at) ? `Relevé ${sinceText(i.created_at)}` : '', i.closed_at ? `clos le ${fmtDate(i.closed_at)}` : ''].filter(Boolean).join(' · ')}
                    </p>
                    {ev.url && <div className="mt-2"><ExtLink href={ev.url}>Annonce BODACC</ExtLink></div>}
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    {i.status === 'open'
                      ? <ActionButton tone="primary" onClick={() => setDialog({ incident: i, next: 'closed' })} testId={`incident-close-${i.id}`}>Clore</ActionButton>
                      : <ActionButton onClick={() => setDialog({ incident: i, next: 'open' })} testId={`incident-reopen-${i.id}`}>Rouvrir</ActionButton>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <NoteDialog
        open={!!dialog}
        onClose={() => setDialog(null)}
        title={dialog?.next === 'closed' ? 'Clore l\'incident' : 'Rouvrir l\'incident'}
        description={dialog?.next === 'closed' ? 'Indiquez ce qui a été constaté (vente déclarée, fausse alerte, cédant contacté…).' : 'L\'incident revient dans la liste « À faire ».'}
        confirmLabel={dialog?.next === 'closed' ? 'Clore' : 'Rouvrir'}
        noteLabel="Note (facultative)"
        onConfirm={(note) => update(dialog.incident, dialog.next, note)}
        testId="incident-note-dialog"
      />
    </Section>
  );
};

export default AdminIncidents;
