import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FolderOpen, Upload, FileText, Trash2, Lock, Loader2, Eye, History, Image as ImageIcon, Globe } from 'lucide-react';
import { axiosInstance } from '@/App';
import { apiErrorMessage } from '@/components/account/errors';
import { formatDateTimeMinutesFr } from '@/lib/mandate';
import { fetchDocuments, fetchAccessLog, fetchPhotos } from './api';
import ConfirmDialog from './ConfirmDialog';

export const DATAROOM_CATEGORIES = [
  { id: 'bilans', label: 'Bilans et comptes annuels' },
  { id: 'kbis', label: 'Kbis et statuts' },
  { id: 'contrats_clients', label: 'Contrats clients et d\'entretien' },
  { id: 'contrats_fournisseurs', label: 'Contrats fournisseurs' },
  { id: 'baux', label: 'Baux et locaux' },
  { id: 'rge_certificats', label: 'Certificats de qualification (RGE, Qualibat…)' },
  { id: 'assurances', label: 'Assurances (décennale, RC)' },
  { id: 'ressources_humaines', label: 'Ressources humaines' },
  { id: 'autres', label: 'Autres documents' },
];

const MAX_PHOTOS = 5;

// Dossier partagé du cédant (data room, upload existant) : documents par catégorie, journal des consultations,
// photos (publiques ou réservées aux repreneurs sous accord de confidentialité).
const DataroomPanel = ({ propertyId }) => {
  const [docs, setDocs] = useState([]);
  const [logs, setLogs] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [thumbs, setThumbs] = useState({});
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState('');
  const [toDelete, setToDelete] = useState(null); // { kind: 'doc'|'photo', id, name }

  const load = async () => {
    const [d, l, p] = await Promise.all([fetchDocuments(propertyId), fetchAccessLog(propertyId), fetchPhotos(propertyId)]);
    setDocs(d);
    setLogs(l);
    setPhotos(p);
    setLoading(false);
  };

  useEffect(() => {
    setLoading(true);
    load();
  }, [propertyId]);

  // Vraies images : le contenu est servi en base64 au propriétaire
  useEffect(() => {
    photos.forEach((photo) => {
      if (thumbs[photo.id]) return;
      axiosInstance.get(`/properties/${propertyId}/photos/${photo.id}`)
        .then((r) => {
          const { content, content_type: type } = r.data || {};
          if (content) setThumbs((t) => ({ ...t, [photo.id]: `data:${type || 'image/jpeg'};base64,${content}` }));
        })
        .catch(() => {});
    });
  }, [photos]);

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
      toast.success('Document ajouté au dossier.');
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Le document n\'a pas pu être ajouté.'));
    } finally {
      setUploading('');
    }
  };

  const uploadPhoto = async (e, visibility) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (photos.length >= MAX_PHOTOS) {
      toast.error(`${MAX_PHOTOS} photos au maximum.`);
      return;
    }
    setUploading(`photo-${visibility}`);
    const data = new FormData();
    data.append('file', file);
    data.append('visibility', visibility);
    try {
      await axiosInstance.post(`/properties/${propertyId}/photos`, data, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Photo ajoutée.');
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'La photo n\'a pas pu être ajoutée.'));
    } finally {
      setUploading('');
    }
  };

  const remove = async () => {
    if (!toDelete) return;
    try {
      if (toDelete.kind === 'doc') await axiosInstance.delete(`/dataroom/${propertyId}/documents/${toDelete.id}`);
      else await axiosInstance.delete(`/properties/${propertyId}/photos/${toDelete.id}`);
      toast.success('Supprimé.');
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
        <span>Les documents ne sont consultables (filigranés, sans téléchargement) qu'après votre accord, l'identité vérifiée du repreneur, l'accord de confidentialité signé et la déclaration d'origine des fonds. Chaque consultation est journalisée.</span>
      </p>

      <div>
        <h3 className="font-semibold text-brand-navy mb-2">Ajouter un document</h3>
        <div className="grid sm:grid-cols-2 gap-2">
          {DATAROOM_CATEGORIES.map((cat) => (
            <label key={cat.id} className="flex items-center justify-between gap-3 rounded-xl border border-brand-line px-3 py-2.5 cursor-pointer hover:border-brand-navy transition-colors min-w-0 focus-within:ring-2 focus-within:ring-brand-blue">
              <span className="flex items-center gap-2 min-w-0 text-sm">
                <FolderOpen className="w-4 h-4 text-gray-500 shrink-0" aria-hidden="true" />
                <span className="truncate">{cat.label}</span>
              </span>
              {uploading === cat.id ? <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" /> : <Upload className="w-4 h-4 text-gray-500 shrink-0" aria-hidden="true" />}
              <input type="file" className="sr-only" onChange={(e) => upload(e, cat.id)} disabled={!!uploading} accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx" />
            </label>
          ))}
        </div>
      </div>

      <div>
        <h3 className="font-semibold text-brand-navy mb-2">Documents partagés</h3>
        {docs.length === 0 ? (
          <p className="text-sm text-gray-600">Aucun document pour l'instant. Les bilans, le Kbis et les certificats sont les premiers demandés par un repreneur.</p>
        ) : (
          <ul className="space-y-2">
            {docs.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between gap-3 rounded-xl bg-brand-surface px-3 py-2 min-w-0">
                <span className="flex items-center gap-2 min-w-0">
                  <FileText className="w-5 h-5 text-brand-navy shrink-0" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium truncate">{doc.filename}</span>
                    <span className="block text-xs text-gray-500">{DATAROOM_CATEGORIES.find((c) => c.id === doc.category)?.label || doc.category}</span>
                  </span>
                </span>
                <button type="button" onClick={() => setToDelete({ kind: 'doc', id: doc.id, name: doc.filename })} className="text-red-700 hover:bg-red-50 p-2 rounded-lg shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400" aria-label={`Supprimer ${doc.filename}`}>
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="font-semibold text-brand-navy mb-1">Photos</h3>
        <p className="text-sm text-gray-600 mb-2">{MAX_PHOTOS} au maximum. Attention à l'anonymat : une façade, un camion ou une enseigne révèlent votre identité ; réservez-les aux repreneurs sous accord de confidentialité.</p>
        <div className="grid grid-cols-2 gap-2 mb-3">
          {[['public', 'Photo publique (anonyme)', Globe], ['private', 'Photo réservée (après accord)', Lock]].map(([vis, label, Icon]) => (
            <label key={vis} className="flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-brand-line p-3 text-center cursor-pointer hover:border-brand-navy transition-colors text-sm min-w-0 focus-within:ring-2 focus-within:ring-brand-blue">
              {uploading === `photo-${vis}` ? <Loader2 className="w-6 h-6 animate-spin" aria-hidden="true" /> : <Icon className="w-6 h-6 text-gray-500" aria-hidden="true" />}
              <span>{label}</span>
              <input type="file" accept="image/*" className="sr-only" onChange={(e) => uploadPhoto(e, vis)} disabled={!!uploading || photos.length >= MAX_PHOTOS} />
            </label>
          ))}
        </div>
        {photos.length > 0 && (
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {photos.map((photo) => (
              <li key={photo.id} className="relative min-w-0">
                <div className="aspect-video rounded-xl overflow-hidden bg-brand-surface border border-brand-line flex items-center justify-center">
                  {thumbs[photo.id] ? <img src={thumbs[photo.id]} alt={photo.filename || 'Photo de l\'annonce'} className="w-full h-full object-cover" /> : <ImageIcon className="w-8 h-8 text-gray-400" aria-hidden="true" />}
                </div>
                <span className={`absolute top-2 left-2 ${photo.visibility === 'public' ? 'badge badge-success' : 'badge badge-locked'}`}>{photo.visibility === 'public' ? 'Publique' : 'Réservée'}</span>
                <button type="button" onClick={() => setToDelete({ kind: 'photo', id: photo.id, name: photo.filename })} className="absolute top-2 right-2 bg-white/90 text-red-700 p-1.5 rounded-lg shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400" aria-label={`Supprimer la photo ${photo.filename || ''}`}>
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {logs.length > 0 && (
        <div>
          <h3 className="flex items-center gap-2 font-semibold text-brand-navy mb-2"><History className="w-4 h-4" aria-hidden="true" />Journal des consultations</h3>
          <ul className="space-y-1 max-h-56 overflow-y-auto text-sm">
            {logs.map((log, i) => (
              <li key={log.id || i} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg bg-brand-surface px-3 py-2 min-w-0">
                <span className="flex items-center gap-2 min-w-0"><Eye className="w-4 h-4 text-gray-500 shrink-0" aria-hidden="true" /><span className="font-medium truncate">{log.viewer_label || 'Repreneur'}</span></span>
                <span className="text-gray-600 min-w-0 break-words">{log.document_name || 'Consultation du dossier'} · {formatDateTimeMinutesFr(log.timestamp || log.accessed_at || log.viewed_at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title={toDelete?.kind === 'photo' ? 'Supprimer cette photo' : 'Supprimer ce document'}
        description={`« ${toDelete?.name || ''} » ne sera plus visible par les repreneurs. Cette action est définitive.`}
        confirmLabel="Supprimer"
        tone="danger"
        onConfirm={remove}
      />
    </div>
  );
};

export default DataroomPanel;
