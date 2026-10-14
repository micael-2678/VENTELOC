import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertCircle, FileSignature, FolderOpen, Loader2, MessageSquare, PenTool, Plus } from 'lucide-react';
import { axiosInstance } from '@/App';
import { usePrivateSeo } from '@/lib/seo';
import { trackEvent } from '@/lib/analytics';
import { Checklist, listingTitle } from '@/components/shared';
import { formatPrice } from '@/components/shared/formatters';
import OtpSignatureDialog from '@/components/OtpSignatureDialog';
import { KYCVerificationButton } from '@/components/KYCVerification';
import NotFound from '@/pages/NotFound';
import { apiErrorMessage, isEmailNotVerifiedError } from '@/components/account/errors';
import ConnectedShell from '@/components/buyer/ConnectedShell';
import FundsDeclarationForm from '@/components/buyer/FundsDeclarationForm';
import DataroomDocuments from '@/components/buyer/DataroomDocuments';
import TransmissibilityPanel from '@/components/buyer/TransmissibilityPanel';
import OfferForm from '@/components/buyer/OfferForm';
import { OfferRow } from '@/components/buyer/OffersList';
import {
  fetchProperty, fetchAccessStatus, fetchKyc, fetchMyOffers, fetchDataroomDocuments, fetchTransmissibility, asList,
  isIdentityRequired, isNotAllowed, isProfileIncomplete, badgeClass,
} from '@/components/buyer/api';

// Dossier d'une entreprise (SPEC §4.3 points 5 et 6, API.md §4) : parcours en checklist
// demande → acceptation du cédant → identité (Stripe) → accord de confidentialité (code) → origine des fonds → accès,
// puis documents (visionneuse embarquée), diagnostic de transmissibilité et offre indicative.

const OPEN_OFFER_STATUSES = ['pending_signature', 'pending', 'countered', 'accepted'];

const DataroomPage = ({ user, setUser }) => {
  const { propertyId } = useParams();
  usePrivateSeo('Dossier de l\'entreprise');
  const [property, setProperty] = useState(null);
  const [access, setAccess] = useState(null);
  const [kyc, setKyc] = useState(null);
  const [offers, setOffers] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [diagnostic, setDiagnostic] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [requestMessage, setRequestMessage] = useState('');
  const [nda, setNda] = useState(null); // { contract_id, content, contract_number, terms_date }
  const [ndaLoading, setNdaLoading] = useState(false);
  const [stepError, setStepError] = useState('');
  const [showOfferForm, setShowOfferForm] = useState(false);

  const identityVerified = kyc?.verified === true || access?.steps?.identity === true || user?.identity_verified === true;

  const load = useCallback(async () => {
    const [c, a, k, o] = await Promise.all([fetchProperty(propertyId), fetchAccessStatus(propertyId, user), fetchKyc(), fetchMyOffers()]);
    if (!c) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setProperty(c);
    setAccess(a);
    setKyc(k);
    setOffers(asList(o, 'offers').filter((x) => x.property_id === propertyId));
    if (a?.accessGranted) {
      const [docs, diag] = await Promise.all([fetchDataroomDocuments(propertyId), fetchTransmissibility(propertyId)]);
      setDocuments(asList(docs, 'documents'));
      setDiagnostic(diag);
    }
    setLoading(false);
  }, [propertyId, user]);

  useEffect(() => { load(); }, [load]);

  const requestAccess = async () => {
    if (requesting) return;
    setRequesting(true);
    setStepError('');
    try {
      const res = await axiosInstance.post(`/dataroom/${propertyId}/request-access`, requestMessage.trim() ? { message: requestMessage.trim() } : {});
      const status = res.data?.status;
      toast.success(status === 'accepted' ? 'Dossier accepté automatiquement par le cédant.' : 'Demande envoyée au cédant. Nous le relançons à J+2 et J+5 s\'il ne répond pas.', { duration: 7000 });
      await load();
    } catch (error) {
      if (isEmailNotVerifiedError(error)) setStepError('Confirmez d\'abord votre adresse e-mail (bandeau en haut de page).');
      else if (isProfileIncomplete(error)) setStepError('profile');
      else setStepError(apiErrorMessage(error, 'La demande n\'a pas pu être envoyée.'));
    } finally {
      setRequesting(false);
    }
  };

  const prepareNda = async () => {
    if (ndaLoading) return;
    setNdaLoading(true);
    setStepError('');
    try {
      const res = await axiosInstance.post('/contracts/generate-for-signature', { property_id: propertyId, doc_type: 'nda' });
      const data = res.data || {};
      if (data.already_signed) {
        toast.info('Accord de confidentialité déjà signé.');
        await load();
        return;
      }
      setNda({ contract_id: data.contract_id, content: data.content, contract_number: data.contract_number, terms_date: data.terms_date });
    } catch (error) {
      if (isEmailNotVerifiedError(error)) setStepError('Confirmez d\'abord votre adresse e-mail (bandeau en haut de page).');
      else if (isIdentityRequired(error)) setStepError('identity');
      else if (isNotAllowed(error)) setStepError(apiErrorMessage(error, 'Le cédant doit d\'abord accepter votre demande de dossier.'));
      else setStepError(apiErrorMessage(error, 'L\'accord n\'a pas pu être préparé. Réessayez dans quelques instants.'));
    } finally {
      setNdaLoading(false);
    }
  };

  const signNda = async (otpCode) => {
    await axiosInstance.post(`/contracts/${nda.contract_id}/sign`, { otp_code: otpCode });
    trackEvent('nda_signed', { listing: String(propertyId) });
    setNda(null);
    toast.success('Accord de confidentialité signé. Le nom de l\'entreprise vous est révélé ; un exemplaire PDF vous est envoyé par e-mail.', { duration: 8000 });
    await load();
  };

  // Retour sur cette page après Stripe Identity (KYCCallbackPage lit sessionStorage.kyc_return_to)
  useEffect(() => {
    if (identityVerified) return;
    try { sessionStorage.setItem('kyc_return_to', `/dataroom/${propertyId}`); } catch (e) { /* stockage indisponible */ }
  }, [identityVerified, propertyId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen" role="status" aria-label="Chargement">
        <div className="spinner" />
      </div>
    );
  }
  if (notFound || !property) return <NotFound user={user} />;

  const title = listingTitle(property);
  const isSeller = access?.isSeller || user?.role === 'seller';

  if (isSeller) {
    return (
      <ConnectedShell user={user} setUser={setUser} title={title} eyebrow="Dossier de l'entreprise" backTo="/seller/dashboard" backLabel="Mon espace">
        <div className="card p-5 sm:p-6">
          <p className="text-gray-700 leading-relaxed">Vous êtes le cédant de cette annonce : les documents, les demandes de dossier et les offres se gèrent depuis votre espace.</p>
          <Link to="/seller/dashboard" className="btn-primary mt-4 px-5 py-3 text-sm">Ouvrir mon espace</Link>
        </div>
      </ConnectedShell>
    );
  }

  const a = access || { status: null, accepted: false, accessGranted: false, steps: { identity: identityVerified, nda: false, funds: false }, nextStep: null, request: null };
  const granted = a.accessGranted;
  const steps = { ...a.steps, identity: a.steps.identity || identityVerified };
  const rejected = a.status === 'rejected';
  const expired = a.status === 'expired';
  // Annonce retirée, vendue ou hors ligne : la demande est close par la plateforme
  const closedRequest = a.status === 'closed';
  const identityStepAction = (
    <div className="space-y-2">
      <KYCVerificationButton user={user} className="bg-brand-navy hover:bg-brand-navy-light rounded-xl" />
      <p className="text-xs text-gray-500">Vérification par Stripe Identity, dans cet onglet. Seul le résultat est conservé, jamais les images.</p>
    </div>
  );

  const items = [
    {
      id: 'request',
      label: 'Dossier demandé au cédant',
      state: a.status ? 'done' : 'current',
      description: a.status ? 'Votre demande est enregistrée.' : 'Le cédant reçoit votre carte repreneur (projet, budget, financement, zones) et décide d\'ouvrir son dossier.',
      action: !a.status && (
        <div className="space-y-2 max-w-xl">
          <label htmlFor="request-message" className="block text-sm font-medium text-brand-navy">Un mot pour le cédant (facultatif)</label>
          <textarea
            id="request-message"
            value={requestMessage}
            onChange={(e) => setRequestMessage(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="Pourquoi cette entreprise vous intéresse, votre calendrier."
            className="w-full rounded-xl border border-brand-line px-4 py-2.5 text-sm text-brand-navy focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
          />
          <button type="button" onClick={requestAccess} disabled={requesting} className="btn-primary px-4 py-2.5 text-sm" data-testid="request-access-btn">
            {requesting ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <FolderOpen className="w-4 h-4" aria-hidden="true" />}
            Demander le dossier
          </button>
        </div>
      ),
    },
    {
      id: 'accepted',
      label: 'Accepté par le cédant',
      state: a.accepted || granted ? 'done' : a.status === 'pending' ? 'current' : 'todo',
      description: granted || a.accepted
        ? 'Le cédant a accepté d\'ouvrir son dossier.'
        : rejected
          ? 'Le cédant n\'a pas donné suite à votre demande.'
          : closedRequest
            ? 'Cette annonce n\'est plus en ligne : votre demande de dossier est close.'
          : expired
            ? 'Le cédant n\'a pas répondu sous 10 jours : nous l\'avons relancé et vous préviendrons dès sa réponse.'
            : 'Le cédant répond en un geste. Sans réponse, nous le relançons à J+2 et J+5 ; sans réponse sous 10 jours, vous êtes prévenu.',
    },
    {
      id: 'identity',
      label: 'Identité vérifiée',
      state: steps.identity ? 'done' : a.accepted && !granted ? 'current' : 'todo',
      description: steps.identity ? 'Votre identité est vérifiée.' : 'Demandée une seule fois, avant la signature de l\'accord de confidentialité. Le cédant ne la voit qu\'après votre signature.',
      action: !steps.identity && a.accepted && identityStepAction,
    },
    {
      id: 'nda',
      label: 'Accord de confidentialité signé',
      state: steps.nda ? 'done' : a.accepted && steps.identity && !granted ? 'current' : 'todo',
      description: steps.nda
        ? 'Accord signé par code : le nom de l\'entreprise vous est révélé dans la messagerie, et vous figurez sur la liste des repreneurs présentés au cédant.'
        : 'Lecture du texte intégral puis signature par code reçu par e-mail (24 mois, usage exclusif de l\'étude de la reprise). Le nom de l\'entreprise est révélé après la signature.',
      action: !steps.nda && a.accepted && steps.identity && (
        <button type="button" onClick={prepareNda} disabled={ndaLoading} className="btn-primary px-4 py-2.5 text-sm" data-testid="nda-btn">
          {ndaLoading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <FileSignature className="w-4 h-4" aria-hidden="true" />}
          Lire et signer l&apos;accord
        </button>
      ),
    },
    {
      id: 'funds',
      label: 'Origine des fonds déclarée',
      state: steps.funds || granted ? 'done' : steps.nda && a.accepted && !granted ? 'current' : 'todo',
      description: steps.funds || granted ? 'Déclaration transmise au cédant.' : 'Origine et montant des fonds mobilisables, partenaire financier éventuel. Transmise au cédant avec votre identité.',
      action: !steps.funds && !granted && steps.nda && a.accepted && (
        <div className="max-w-2xl rounded-xl border border-brand-line bg-white p-4">
          <FundsDeclarationForm propertyId={propertyId} defaultAmount={user?.buyer_profile?.budget_max || ''} onDone={async () => { toast.success('Accès au dossier accordé.'); await load(); }} />
        </div>
      ),
    },
    {
      id: 'access',
      label: 'Accès au dossier',
      state: granted ? 'done' : 'todo',
      description: granted ? 'Documents, diagnostic de transmissibilité et offre indicative sont disponibles ci-dessous.' : 'Ouvert automatiquement dès que les trois étapes précédentes sont faites.',
    },
  ];

  const openOffers = offers.filter((o) => OPEN_OFFER_STATUSES.includes(o.status));
  const canOffer = granted && openOffers.length === 0 && property.status === 'published';

  return (
    <ConnectedShell
      user={user}
      setUser={setUser}
      title={title}
      eyebrow="Dossier de l'entreprise"
      backTo="/buyer/dashboard"
      backLabel="Mes dossiers"
      wide={granted}
      actions={(
        <>
          <Link to={`/property/${propertyId}`} className="btn-secondary px-4 py-2 text-sm">Voir l&apos;annonce</Link>
          <Link to={`/messages?conversation=${encodeURIComponent(propertyId)}`} className="btn-secondary px-4 py-2 text-sm">
            <MessageSquare className="w-4 h-4" aria-hidden="true" />
            Messagerie
          </Link>
        </>
      )}
    >
      {property.company_name && (
        <p className="mb-4 badge badge-verified" data-testid="revealed-name">Nom révélé après accord de confidentialité : {property.company_name}</p>
      )}
      {property.asking_price != null && (
        <p className="text-sm text-gray-600 mb-6">Prix demandé : <span className="font-semibold text-brand-navy tabular">{formatPrice(property.asking_price)}</span></p>
      )}

      {stepError === 'profile' && (
        <p role="alert" className="notice-amber mb-4" data-testid="profile-incomplete">
          Votre profil de projet est incomplet (40 % requis pour contacter et demander un dossier). <Link to="/profile" className="font-semibold underline underline-offset-2">Compléter mon profil</Link>
        </p>
      )}
      {stepError === 'identity' && (
        <div className="notice-amber mb-4 flex flex-col sm:flex-row sm:items-center gap-3" role="alert">
          <span className="flex-1">Votre identité doit être vérifiée avant de signer l&apos;accord de confidentialité.</span>
          {identityStepAction}
        </div>
      )}
      {stepError && stepError !== 'profile' && stepError !== 'identity' && (
        <p role="alert" className="flex items-start gap-2 text-sm text-red-800 bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4" data-testid="step-error">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{stepError}</span>
        </p>
      )}

      <div className={granted ? 'grid lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-6 min-w-0' : 'min-w-0'}>
        <section className="card p-5 sm:p-6 min-w-0 self-start" aria-labelledby="dataroom-steps-title">
          <h2 id="dataroom-steps-title" className="sr-only">Étapes d&apos;accès au dossier</h2>
          <Checklist title="Accès au dossier" items={items} />
        </section>

        {granted && (
          <div className="space-y-6 min-w-0">
            <section className="card p-5 sm:p-6 min-w-0" aria-labelledby="documents-title">
              <h2 id="documents-title" className="font-display text-lg font-bold text-brand-navy mb-3">Documents du cédant</h2>
              <DataroomDocuments propertyId={propertyId} documents={documents} />
            </section>

            <section className="card p-5 sm:p-6 min-w-0" aria-labelledby="offer-title">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <h2 id="offer-title" className="font-display text-lg font-bold text-brand-navy">Offre indicative</h2>
                {canOffer && !showOfferForm && (
                  <button type="button" onClick={() => setShowOfferForm(true)} className="btn-primary px-4 py-2 text-sm" data-testid="open-offer-form">
                    <Plus className="w-4 h-4" aria-hidden="true" />
                    Faire une offre indicative
                  </button>
                )}
              </div>
              {offers.length > 0 && (
                <ul className="space-y-3 mb-4">
                  {offers.map((o) => <OfferRow key={o.id} offer={{ ...o, property: o.property || { title } }} onChanged={load} />)}
                </ul>
              )}
              {showOfferForm && canOffer ? (
                <OfferForm property={{ ...property, title }} onCancel={() => setShowOfferForm(false)} onSigned={async () => { setShowOfferForm(false); await load(); }} />
              ) : (
                !offers.length && (
                  <p className="text-sm text-gray-600">
                    Prix, objet (titres ou fonds), plan de financement, conditions et calendrier : l&apos;offre est signée par code et contresignée par le cédant s&apos;il l&apos;accepte. {property.status !== 'published' && 'Cette annonce n\'est plus en ligne : aucune nouvelle offre n\'est possible.'}
                  </p>
                )
              )}
              {openOffers.length > 0 && !showOfferForm && (
                <p className="text-sm text-gray-600 flex items-center gap-2"><PenTool className="w-4 h-4 shrink-0 text-gray-400" aria-hidden="true" />Une offre est en cours sur ce dossier : attendez la réponse du cédant avant d&apos;en déposer une autre.</p>
              )}
            </section>

            {diagnostic?.diagnostic && (
              <section className="card p-5 sm:p-6 min-w-0" aria-label="Diagnostic de transmissibilité">
                <TransmissibilityPanel diagnostic={diagnostic.diagnostic} ademe={diagnostic.ademe} />
              </section>
            )}
          </div>
        )}
      </div>

      {!granted && a.status && (
        <p className="mt-6 text-sm text-gray-600">
          Statut : <span className={badgeClass(granted ? 'success' : a.status === 'pending' ? 'warning' : rejected ? 'danger' : 'info')}>{granted ? 'Accès accordé' : a.status === 'pending' ? 'En attente du cédant' : rejected ? 'Refusée' : expired ? 'Expirée' : 'Acceptée'}</span>
        </p>
      )}

      {nda && (
        <OtpSignatureDialog
          open
          onClose={() => setNda(null)}
          title="Accord de confidentialité"
          subtitle={nda.contract_number ? `N° ${nda.contract_number}` : undefined}
          termsDate={nda.terms_date}
          contractId={nda.contract_id}
          documentText={nda.content}
          acceptLabel="J'ai lu l'accord de confidentialité et je l'accepte. Je comprends que cette signature électronique a valeur juridique."
          signLabel="Signer l'accord"
          onSign={signNda}
        />
      )}
    </ConnectedShell>
  );
};

export default DataroomPage;
