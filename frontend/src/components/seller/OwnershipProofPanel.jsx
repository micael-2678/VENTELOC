import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, BadgeCheck, Clock, FileCheck2, Loader2, Lock, Upload } from 'lucide-react';
import { axiosInstance } from '@/App';
import { apiErrorMessage } from '@/components/account/errors';
import { formatDateTimeFr } from '@/lib/mandate';
import { fetchOwnershipProof } from './api';
import { OWNERSHIP_STATUS, badgeClass } from './listingStatus';
import { isCompanyOwner } from './listingForm';

// Justificatif de propriété (docs/venteloc/SPEC.md §5.2 point 3, API.md §2) : déposé par le vendeur avant la
// publication, stocké hors du dossier du bien, visible du seul vendeur et de l'administration. Contrôlé par l'admin :
// « Propriétaire vérifié » sur l'annonce, ou refus motivé (nouveau dépôt → de nouveau « en cours de contrôle »).
//   POST /properties/{id}/ownership-proof (multipart file + doc_type) → {ownership: {status:'pending', doc_type, uploaded_at, filename}}
//   GET  /properties/{id}/ownership-proof → métadonnées {status, doc_type, uploaded_at, filename, note?}

export const OWNERSHIP_DOC_TYPES = [
  { id: 'titre-propriete', label: 'Titre de propriété (acte de vente)', hint: 'L\'acte notarié reçu lors de votre achat, première page et désignation du bien.' },
  { id: 'attestation-notariee', label: 'Attestation notariée de propriété', hint: 'Délivrée par le notaire (succession, donation, achat récent).' },
  { id: 'taxe-fonciere', label: 'Dernier avis de taxe foncière', hint: 'À votre nom (ou au nom de la société), pour le bien vendu.' },
  { id: 'statuts-kbis', label: 'Statuts et Kbis de la société', hint: 'Si le bien appartient à une SCI ou à une société : statuts à jour et Kbis de moins de 3 mois.' },
];
export const docTypeLabel = (id) => (OWNERSHIP_DOC_TYPES.find((d) => d.id === id) || {}).label || '';

export const PROOF_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp';
export const PROOF_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
export const PROOF_MAX_BYTES = 10 * 1024 * 1024;

// Contrôle local avant l'envoi : '' si le fichier est accepté, sinon le message
export const proofFileError = (file) => {
  if (!file) return 'Choisissez un fichier.';
  if (file.type && !PROOF_TYPES.includes(file.type)) return 'Format non accepté : PDF, JPG, PNG ou WebP.';
  if (file.size > PROOF_MAX_BYTES) return 'Fichier trop volumineux : 10 Mo au maximum.';
  return '';
};

const ICONS = { missing: Upload, pending: Clock, verified: BadgeCheck, rejected: AlertTriangle };

const OwnershipProofPanel = ({ property, onChanged, compact = false }) => {
  const id = useId();
  const propertyId = property?.id;
  const [proof, setProof] = useState(property?.ownership || null);
  const [docType, setDocType] = useState(() => (isCompanyOwner(property?.owner_type) ? 'statuts-kbis' : 'titre-propriete'));
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!propertyId) return undefined;
    fetchOwnershipProof(propertyId).then((data) => {
      if (!alive || !data) return;
      setProof((p) => ({ ...(p || {}), ...(data.ownership || data) }));
    });
    return () => { alive = false; };
  }, [propertyId]);

  const status = OWNERSHIP_STATUS[proof?.status] ? proof.status : 'missing';
  const info = OWNERSHIP_STATUS[status];
  const Icon = ICONS[status];
  const canUpload = status === 'missing' || status === 'rejected';

  const upload = async (e) => {
    e.preventDefault();
    const err = proofFileError(file);
    setError(err);
    if (err) return;
    setSending(true);
    const data = new FormData();
    data.append('file', file);
    data.append('doc_type', docType);
    try {
      const res = await axiosInstance.post(`/properties/${propertyId}/ownership-proof`, data, { headers: { 'Content-Type': 'multipart/form-data' } });
      const ownership = res.data?.ownership || { status: 'pending', doc_type: docType, filename: file.name, uploaded_at: new Date().toISOString() };
      setProof(ownership);
      setFile(null);
      toast.success('Justificatif déposé. Nous le contrôlons rapidement ; vous êtes prévenu par e-mail.');
      onChanged?.(ownership);
    } catch (err2) {
      setError(apiErrorMessage(err2, 'Le justificatif n\'a pas pu être déposé. Réessayez dans quelques instants.'));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={compact ? 'space-y-4' : 'space-y-5'} data-testid="ownership-panel">
      <div className="flex flex-wrap items-center gap-2">
        <span className={badgeClass(info.tone)} data-testid="ownership-status" data-status={status}>
          <Icon className="w-3.5 h-3.5" aria-hidden="true" />{info.label}
        </span>
        {proof?.uploaded_at && status !== 'missing' && (
          <span className="text-sm text-gray-600">
            {docTypeLabel(proof.doc_type) || 'Document'}{proof.filename ? ` (${proof.filename})` : ''}, déposé le {formatDateTimeFr(proof.uploaded_at)}
          </span>
        )}
      </div>

      {status === 'missing' && (
        <p className="text-sm text-gray-700 leading-relaxed">
          Indispensable pour publier : il prouve que vous pouvez vendre ce bien. Une fois contrôlé, votre annonce porte le badge
          {' '}<span className="badge badge-verified"><BadgeCheck className="w-3.5 h-3.5" aria-hidden="true" />Propriétaire vérifié</span>.
        </p>
      )}
      {status === 'pending' && (
        <p className="text-sm text-gray-700 leading-relaxed" data-testid="ownership-pending">
          Nous contrôlons votre justificatif. Votre annonce peut être publiée pendant ce contrôle ; le badge « Propriétaire vérifié » s'affiche dès la validation.
        </p>
      )}
      {status === 'verified' && (
        <p className="text-sm text-brand-green-dark leading-relaxed">Justificatif validé{proof?.reviewed_at ? ` le ${formatDateTimeFr(proof.reviewed_at)}` : ''} : votre annonce affiche « Propriétaire vérifié ».</p>
      )}
      {status === 'rejected' && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert" data-testid="ownership-rejected">
          <p className="font-semibold">Votre justificatif n'a pas été accepté.</p>
          {proof?.note && <p className="mt-1 break-words">Motif : {proof.note}</p>}
          <p className="mt-1">Déposez un nouveau document ci-dessous : il repassera en contrôle.</p>
        </div>
      )}

      {canUpload && (
        <form onSubmit={upload} className="space-y-4" noValidate data-testid="ownership-form">
          <fieldset className="min-w-0">
            <legend className="text-sm font-semibold text-brand-navy mb-2">Type de document</legend>
            <div className="grid sm:grid-cols-2 gap-2">
              {OWNERSHIP_DOC_TYPES.map((d) => (
                <label key={d.id} className={`grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-xl border-2 px-3 py-2.5 cursor-pointer min-w-0 focus-within:ring-2 focus-within:ring-brand-teal ${docType === d.id ? 'border-brand-teal bg-brand-teal-soft' : 'border-brand-line bg-white hover:border-gray-400'}`}>
                  <input type="radio" name={`${id}-doc`} value={d.id} checked={docType === d.id} onChange={() => setDocType(d.id)} className="row-span-2 mt-1 h-4 w-4 shrink-0 accent-[#0f766e]" data-testid={`ownership-doc-${d.id}`} />
                  <span className="text-sm font-semibold text-brand-navy min-w-0">{d.label}</span>
                  <span className="text-sm text-gray-600 leading-snug min-w-0">{d.hint}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor={`${id}-file`} className="block text-sm font-semibold text-brand-navy mb-1">Fichier</label>
            <input
              id={`${id}-file`}
              type="file"
              accept={PROOF_ACCEPT}
              onChange={(e) => { setFile(e.target.files?.[0] || null); setError(''); }}
              className="block w-full text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-surface file:px-3 file:py-2 file:font-semibold file:text-brand-navy hover:file:bg-gray-100"
              aria-describedby={`${id}-file-hint`}
              data-testid="ownership-file"
            />
            <p id={`${id}-file-hint`} className="text-xs text-gray-600 mt-1">PDF, JPG, PNG ou WebP, 10 Mo au maximum.</p>
          </div>
          {error && <p role="alert" className="text-sm text-red-700" data-testid="ownership-error">{error}</p>}
          <button type="submit" disabled={sending || !file} className="btn-primary" data-testid="ownership-submit">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <FileCheck2 className="w-4 h-4" aria-hidden="true" />}
            Déposer le justificatif
          </button>
        </form>
      )}

      <p className="flex items-start gap-2 text-xs text-gray-600 leading-relaxed">
        <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
        Ce document n'est jamais montré aux acquéreurs ni ajouté au dossier du bien : seuls vous et l'équipe de contrôle y avez accès.
      </p>
    </div>
  );
};

export default OwnershipProofPanel;
