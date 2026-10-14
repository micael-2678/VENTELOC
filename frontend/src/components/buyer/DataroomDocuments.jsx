import { useState } from 'react';
import { toast } from 'sonner';
import { Eye, FileText, FolderOpen, Loader2, X } from 'lucide-react';
import { axiosInstance } from '@/App';
import SecurePdfViewer from '@/components/SecurePdfViewer';
import { apiErrorMessage } from '@/components/account/errors';
import { formatDateFr } from '@/components/shared/formatters';

// Documents du dossier du bien côté acquéreur : liste par catégorie (SPEC §6.3), consultation avec filigrane dans la
// visionneuse pdf.js embarquée (POST /dataroom/{id}/documents/{doc_id}/view → {document:{content base64}, watermark}).
// Aucun téléchargement : le filigrane porte l'e-mail et l'horodatage du lecteur.

// Catégories du dossier du bien (DATAROOM_CATEGORIES côté serveur, GET /dataroom/categories), dans l'ordre d'affichage
export const DATAROOM_CATEGORIES = [
  { id: 'bail', label: 'Bail et avenants' },
  { id: 'etats-des-lieux', label: 'États des lieux' },
  { id: 'loyers', label: 'Loyers et quittances' },
  { id: 'diagnostics', label: 'Diagnostics (DPE, dossier de diagnostic technique)' },
  { id: 'taxe-fonciere', label: 'Taxe foncière' },
  { id: 'copropriete', label: 'Copropriété (règlement, procès-verbaux d\'AG, charges)' },
  { id: 'titre-propriete', label: 'Titre de propriété' },
  { id: 'assurances', label: 'Assurances (PNO, loyers impayés)' },
  { id: 'travaux', label: 'Travaux (factures, garanties)' },
  { id: 'societe', label: 'Société (statuts, bilans)' },
  { id: 'autres', label: 'Autres documents' },
];
const ORDER = DATAROOM_CATEGORIES.reduce((acc, c, i) => { acc[c.id] = i; return acc; }, {});

export const categoryLabel = (c, fallbackLabel) => {
  const id = String(c || '').toLowerCase();
  const known = DATAROOM_CATEGORIES.find((x) => x.id === id);
  if (known) return known.label;
  return fallbackLabel || DATAROOM_CATEGORIES[DATAROOM_CATEGORIES.length - 1].label;
};

export const groupByCategory = (docs) => {
  const groups = {};
  docs.forEach((d) => {
    const id = ORDER[String(d.category || '').toLowerCase()] !== undefined ? String(d.category).toLowerCase() : 'autres';
    if (!groups[id]) groups[id] = { id, label: categoryLabel(id, d.category_label), docs: [] };
    groups[id].docs.push(d);
  });
  return Object.values(groups).sort((a, b) => ORDER[a.id] - ORDER[b.id]);
};

const DataroomDocuments = ({ propertyId, documents }) => {
  const [viewing, setViewing] = useState(null); // { filename, content, watermark }
  const [loadingId, setLoadingId] = useState(null);
  const docs = Array.isArray(documents) ? documents : [];

  const open = async (doc) => {
    if (loadingId) return;
    setLoadingId(doc.id);
    try {
      const res = await axiosInstance.post(`/dataroom/${propertyId}/documents/${doc.id}/view`);
      const data = res.data || {};
      const content = data.document?.content;
      if (!content) {
        toast.error('Ce document ne peut pas être affiché pour le moment.');
        return;
      }
      if (data.document?.content_type && !String(data.document.content_type).includes('pdf')) {
        toast.error('Seuls les documents PDF sont consultables en ligne.');
        return;
      }
      setViewing({ filename: data.document.filename || doc.filename, content, watermark: data.watermark || '' });
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Le document n\'a pas pu être ouvert.'));
    } finally {
      setLoadingId(null);
    }
  };

  if (!docs.length) {
    return (
      <div className="rounded-xl border border-dashed border-brand-line bg-white p-6 text-center" data-testid="dataroom-empty">
        <FolderOpen className="w-8 h-8 text-gray-400 mx-auto mb-2" aria-hidden="true" />
        <p className="font-semibold text-brand-navy">Le vendeur n&apos;a pas encore déposé de document.</p>
        <p className="text-sm text-gray-600 mt-1">Il est prévenu de votre accès. Vous recevrez un e-mail dès qu&apos;un document sera disponible ; vous pouvez aussi lui demander les pièces qui vous manquent (bail, quittances, diagnostics…) par la messagerie.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 min-w-0" data-testid="dataroom-documents">
      <p className="text-sm text-gray-600">
        Consultation en ligne uniquement, avec un filigrane à votre nom et la date : chaque ouverture est journalisée et visible du vendeur.
        Les données personnelles du locataire éventuellement présentes ne servent qu&apos;à l&apos;étude de l&apos;achat (engagement de confidentialité).
      </p>
      {groupByCategory(docs).map((group) => (
        <section key={group.id} aria-label={group.label} className="min-w-0" data-testid={`dataroom-category-${group.id}`}>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-2">{group.label}</h3>
          <ul className="divide-y divide-brand-line rounded-xl border border-brand-line bg-white">
            {group.docs.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between gap-3 p-3 min-w-0">
                <div className="flex items-center gap-3 min-w-0">
                  <FileText className="w-5 h-5 text-gray-500 shrink-0" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-brand-navy truncate">{doc.filename || 'Document'}</p>
                    {(doc.uploaded_at || doc.created_at) && <p className="text-xs text-gray-500">Déposé le {formatDateFr(doc.uploaded_at || doc.created_at)}</p>}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => open(doc)}
                  disabled={loadingId === doc.id}
                  className="btn-secondary px-3 py-2 text-sm shrink-0"
                  data-testid={`view-doc-${doc.id}`}
                >
                  {loadingId === doc.id ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
                  <span className="sr-only sm:not-sr-only">Consulter</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {viewing && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-2 sm:p-4" role="dialog" aria-modal="true" aria-label={`Document : ${viewing.filename}`}>
          <div className="bg-white rounded-2xl w-full max-w-5xl h-[92vh] flex flex-col min-w-0 overflow-hidden">
            <div className="flex items-center justify-between gap-3 p-3 sm:px-5 border-b border-brand-line">
              <p className="font-semibold text-brand-navy truncate min-w-0">{viewing.filename}</p>
              <button type="button" onClick={() => setViewing(null)} className="shrink-0 rounded-lg p-2 text-gray-600 hover:bg-brand-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue" aria-label="Fermer le document">
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>
            <div className="flex-1 min-h-0">
              <SecurePdfViewer base64Content={viewing.content} watermark={viewing.watermark} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DataroomDocuments;
