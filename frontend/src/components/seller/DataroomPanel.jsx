import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Eye, FileText, FolderOpen, History, Loader2, Lock, Trash2, Upload } from 'lucide-react';
import { axiosInstance } from '@/App';
import { apiErrorMessage } from '@/components/account/errors';
import { formatDateTimeMinutesFr } from '@/lib/mandate';
import { fetchDocuments, fetchAccessLog } from './api';
import ConfirmDialog from './ConfirmDialog';
import PhotosPanel from './PhotosPanel';

// Dossier du bien (docs/venteloc/SPEC.md §6.3) : documents par catégorie (GET /dataroom/categories, repli sur la liste
// ci-dessous), journal des consultations, photos de l'annonce. Avertissement à l'envoi : les données personnelles du
// locataire doivent être masquées.

export const DATAROOM_CATEGORIES = [
  { id: 'bail', label: 'Bail et avenants', hint: 'Bail en cours signé, avenants, état des lieux d\'entrée en annexe si possible.' },
  { id: 'etats-des-lieux', label: 'États des lieux', hint: 'État des lieux d\'entrée (et de sortie du précédent locataire si utile).' },
  { id: 'loyers', label: 'Loyers et quittances', hint: 'Relevé des loyers encaissés sur les 12 derniers mois, quittances.' },
  { id: 'diagnostics', label: 'Diagnostics (DPE, DDT)', hint: 'DPE et dossier de diagnostic technique complet.' },
  { id: 'taxe-fonciere', label: 'Taxe foncière', hint: 'Dernier avis de taxe foncière.' },
  { id: 'copropriete', label: 'Copropriété', hint: 'Règlement, PV des 3 dernières AG, fiche synthétique, appels de charges, carnet d\'entretien.' },
  { id: 'titre-propriete', label: 'Titre de propriété', hint: 'Acte d\'achat ou attestation notariée.' },
  { id: 'assurances', label: 'Assurances', hint: 'Propriétaire non occupant, garantie loyers impayés.' },
  { id: 'travaux', label: 'Travaux', hint: 'Factures et garanties des travaux récents.' },
  { id: 'societe', label: 'Société propriétaire', hint: 'Statuts, bilans, en cas de vente des parts.' },
  { id: 'autres', label: 'Autres documents', hint: '' },
];

export const TENANT_DOCS_WARNING = 'Masquez le nom, les coordonnées et les pièces d\'identité du locataire : l\'acquéreur n\'en a pas besoin avant l\'acte.';

let categoriesCache = null;
const fetchCategories = () => {
  if (categoriesCache) return Promise.resolve(categoriesCache);
  return Promise.resolve()
    .then(() => axiosInstance.get('/dataroom/categories'))
    .then((r) => {
      const list = Array.isArray(r?.data) ? r.data.filter((c) => c && c.id && c.label) : [];
      categoriesCache = list.length ? list : null;
      return categoriesCache;
    })
    .catch(() => null);
};

const DataroomPanel = ({ propertyId }) => {
  const [docs, setDocs] = useState([]);
  const [logs, setLogs] = useState([]);
  const [categories, setCategories] = useState(categoriesCache || DATAROOM_CATEGORIES);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState('');
  const [toDelete, setToDelete] = useState(null); // { id, name }

  const load = useCallback(async () => {
    const [d, l] = await Promise.all([fetchDocuments(propertyId), fetchAccessLog(propertyId)]);
    setDocs(d);
    setLogs(l);
    setLoading(false);
  }, [propertyId]);

  useEffect(() => {
    setLoading(true);
    load();
    fetchCategories().then((list) => { if (list) setCategories(list); });
  }, [load]);

  const categoryLabel = (id) => (categories.find((c) => c.id === id) || DATAROOM_CATEGORIES.find((c) => c.id === id) || {}).label || id;

  const upload = async (e, category) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(category);
    const data = new FormData();
    data.append('file', file);
    data.append('category', category);
    try {
      await axiosInstance.post(`/dataroom/${propertyId}/documents`, data, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success(`Document ajouté au dossier du bien. Rappel : ${TENANT_DOCS_WARNING.charAt(0).toLowerCase()}${TENANT_DOCS_WARNING.slice(1)}`, { duration: 8000 });
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Le document n\'a pas pu être ajouté (PDF, JPG, PNG ou WebP, 10 Mo au maximum).'));
    } finally {
      setUploading('');
    }
  };

  const remove = async () => {
    if (!toDelete) return;
    try {
      await axiosInstance.delete(`/dataroom/${propertyId}/documents/${toDelete.id}`);
      toast.success('Document supprimé.');
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'La suppression a échoué.'));
      throw err;
    }
  };

  if (loading) return <div className="flex justify-center py-8" role="status" aria-label="Chargement"><div className="spinner" /></div>;

  return (
    <div className="space-y-6" data-testid="dataroom-panel">
      <p className="flex items-start gap-2 text-sm text-gray-700">
        <Lock className="w-4 h-4 mt-0.5 shrink-0 text-brand-navy" aria-hidden="true" />
        <span>Les documents ne sont consultables (filigranés, sans téléchargement) qu'après votre accord, l'identité vérifiée de l'acquéreur, l'engagement de confidentialité et de non-contournement signé et la déclaration d'origine des fonds. Chaque consultation est journalisée.</span>
      </p>

      <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-brand-amber-soft px-4 py-3 text-sm text-brand-amber" role="note" data-testid="tenant-data-warning">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
        <span><strong>Avant chaque envoi :</strong> {TENANT_DOCS_WARNING}</span>
      </p>

      <div>
        <h3 className="font-semibold text-brand-navy mb-2">Ajouter un document</h3>
        <div className="grid sm:grid-cols-2 gap-2">
          {categories.map((cat) => (
            <label key={cat.id} className="flex items-center justify-between gap-3 rounded-xl border border-brand-line px-3 py-2.5 cursor-pointer hover:border-brand-teal transition-colors min-w-0 focus-within:ring-2 focus-within:ring-brand-teal" data-testid={`dataroom-category-${cat.id}`}>
              <span className="flex items-start gap-2 min-w-0 text-sm">
                <FolderOpen className="w-4 h-4 mt-0.5 text-gray-500 shrink-0" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block font-medium text-brand-navy">{cat.label}</span>
                  {cat.hint && <span className="block text-xs text-gray-600 leading-snug">{cat.hint}</span>}
                </span>
              </span>
              {uploading === cat.id ? <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" /> : <Upload className="w-4 h-4 text-gray-500 shrink-0" aria-hidden="true" />}
              <input type="file" className="sr-only" onChange={(e) => upload(e, cat.id)} disabled={!!uploading} accept=".pdf,.jpg,.jpeg,.png,.webp" />
            </label>
          ))}
        </div>
      </div>

      <div>
        <h3 className="font-semibold text-brand-navy mb-2">Documents partagés</h3>
        {docs.length === 0 ? (
          <p className="text-sm text-gray-600">Aucun document pour l'instant. Le bail, le relevé des loyers, les diagnostics et, en copropriété, les PV d'assemblée générale sont les premiers demandés par un acquéreur.</p>
        ) : (
          <ul className="space-y-2">
            {docs.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between gap-3 rounded-xl bg-brand-surface px-3 py-2 min-w-0">
                <span className="flex items-center gap-2 min-w-0">
                  <FileText className="w-5 h-5 text-brand-navy shrink-0" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium truncate">{doc.filename}</span>
                    <span className="block text-xs text-gray-600">{categoryLabel(doc.category)}</span>
                  </span>
                </span>
                <button type="button" onClick={() => setToDelete({ id: doc.id, name: doc.filename })} className="text-red-700 hover:bg-red-50 p-2 rounded-lg shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400" aria-label={`Supprimer ${doc.filename}`}>
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="font-semibold text-brand-navy mb-1">Photos de l'annonce</h3>
        <PhotosPanel propertyId={propertyId} />
      </div>

      {logs.length > 0 && (
        <div>
          <h3 className="flex items-center gap-2 font-semibold text-brand-navy mb-2"><History className="w-4 h-4" aria-hidden="true" />Journal des consultations</h3>
          <ul className="space-y-1 max-h-56 overflow-y-auto text-sm">
            {logs.map((log, i) => (
              <li key={log.id || i} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg bg-brand-surface px-3 py-2 min-w-0">
                <span className="flex items-center gap-2 min-w-0"><Eye className="w-4 h-4 text-gray-500 shrink-0" aria-hidden="true" /><span className="font-medium truncate">{log.viewer_label || 'Acquéreur'}</span></span>
                <span className="text-gray-600 min-w-0 break-words">{log.document_name || 'Consultation du dossier'} · {formatDateTimeMinutesFr(log.timestamp || log.accessed_at || log.viewed_at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title="Supprimer ce document"
        description={`« ${toDelete?.name || ''} » ne sera plus visible par les acquéreurs. Cette action est définitive.`}
        confirmLabel="Supprimer"
        tone="danger"
        onConfirm={remove}
      />
    </div>
  );
};

export default DataroomPanel;
