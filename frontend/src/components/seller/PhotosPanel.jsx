import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Globe, Image as ImageIcon, Loader2, Lock, Trash2 } from 'lucide-react';
import { axiosInstance } from '@/App';
import { apiErrorMessage } from '@/components/account/errors';
import { fetchPhotos } from './api';
import ConfirmDialog from './ConfirmDialog';

// Photos de l'annonce (API.md §2 : POST/GET/DELETE /properties/{id}/photos) : 5 au maximum, publiques (visibles sur
// l'annonce) ou réservées aux acquéreurs qui ont signé l'engagement de confidentialité. La première photo publique
// illustre la carte de l'annonce.
export const MAX_PHOTOS = 5;

const PhotosPanel = ({ propertyId, onChanged }) => {
  const [photos, setPhotos] = useState([]);
  const [thumbs, setThumbs] = useState({});
  const [uploading, setUploading] = useState('');
  const [toDelete, setToDelete] = useState(null);

  const load = useCallback(async () => {
    const list = await fetchPhotos(propertyId);
    setPhotos(list);
  }, [propertyId]);

  useEffect(() => { load(); }, [load]);

  // Vraies images : le contenu est servi en base64 au propriétaire
  useEffect(() => {
    photos.forEach((photo) => {
      if (thumbs[photo.id]) return;
      axiosInstance.get(`/properties/${propertyId}/photos/${photo.id}`)
        .then((r) => {
          const { content, content_type: type } = r?.data || {};
          if (content) setThumbs((t) => ({ ...t, [photo.id]: `data:${type || 'image/jpeg'};base64,${content}` }));
        })
        .catch(() => {});
    });
  }, [photos, propertyId]);

  const upload = async (e, visibility) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (photos.length >= MAX_PHOTOS) {
      toast.error(`${MAX_PHOTOS} photos au maximum.`);
      return;
    }
    setUploading(visibility);
    const data = new FormData();
    data.append('file', file);
    data.append('visibility', visibility);
    try {
      await axiosInstance.post(`/properties/${propertyId}/photos`, data, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Photo ajoutée.');
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'La photo n\'a pas pu être ajoutée (JPG, PNG ou WebP, 5 Mo au maximum).'));
    } finally {
      setUploading('');
    }
  };

  const remove = async () => {
    if (!toDelete) return;
    try {
      await axiosInstance.delete(`/properties/${propertyId}/photos/${toDelete.id}`);
      toast.success('Photo supprimée.');
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'La suppression a échoué.'));
      throw err;
    }
  };

  const full = photos.length >= MAX_PHOTOS;

  return (
    <div className="space-y-3" data-testid="photos-panel">
      <p className="text-sm text-gray-600 leading-relaxed">
        {MAX_PHOTOS} photos au maximum (JPG, PNG ou WebP). Les photos publiques s'affichent sur l'annonce : évitez le numéro de rue,
        une façade trop reconnaissable et tout effet personnel du locataire. Réservez les autres aux acquéreurs engagés.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {[['public', 'Photo publique', Globe], ['private', 'Photo réservée (après engagement)', Lock]].map(([vis, label, Icon]) => (
          <label key={vis} className={`flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-brand-line p-3 text-center text-sm min-w-0 transition-colors focus-within:ring-2 focus-within:ring-brand-teal ${full || uploading ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:border-brand-teal'}`}>
            {uploading === vis ? <Loader2 className="w-6 h-6 animate-spin" aria-hidden="true" /> : <Icon className="w-6 h-6 text-gray-500" aria-hidden="true" />}
            <span>{label}</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => upload(e, vis)} disabled={!!uploading || full} data-testid={`photo-upload-${vis}`} />
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
              <button type="button" onClick={() => setToDelete({ id: photo.id, name: photo.filename })} className="absolute top-2 right-2 bg-white/90 text-red-700 p-1.5 rounded-lg shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400" aria-label={`Supprimer la photo ${photo.filename || ''}`}>
                <Trash2 className="w-4 h-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title="Supprimer cette photo"
        description={`« ${toDelete?.name || 'Photo'} » ne sera plus visible sur l'annonce. Cette action est définitive.`}
        confirmLabel="Supprimer"
        tone="danger"
        onConfirm={remove}
      />
    </div>
  );
};

export default PhotosPanel;
