import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertCircle, FileSignature, FolderOpen, KeyRound, Loader2, MapPin, MessageSquare, PenTool, Plus } from 'lucide-react';
import { axiosInstance } from '@/App';
import { usePrivateSeo } from '@/lib/seo';
import { trackEvent } from '@/lib/analytics';
import { Checklist } from '@/components/shared';
import { formatPrice, formatYield } from '@/components/shared/formatters';
import OtpSignatureDialog from '@/components/OtpSignatureDialog';
import { KYCVerificationButton } from '@/components/KYCVerification';
import NotFound from '@/pages/NotFound';
import { apiErrorMessage, isEmailNotVerifiedError } from '@/components/account/errors';
import ConnectedShell from '@/components/buyer/ConnectedShell';
import FundsDeclarationForm from '@/components/buyer/FundsDeclarationForm';
import DataroomDocuments from '@/components/buyer/DataroomDocuments';
import LeaseTransferPanel from '@/components/buyer/LeaseTransferPanel';
import { titleOf } from '@/components/buyer/PipelineList';
import OfferForm from '@/components/buyer/OfferForm';
import { OfferRow } from '@/components/buyer/OffersList';
import {
  fetchProperty, fetchAccessStatus, fetchKyc, fetchMyOffers, fetchDataroomDocuments, fetchLeaseTransfer, asList,
  isIdentityRequired, isNotAllowed, isProfileIncomplete, badgeClass, propertyPath,
} from '@/components/buyer/api';

// Dossier du bien (SPEC §5.3, API.md §4) : parcours en checklist
// demande → acceptation du vendeur → identité (Stripe) → engagement de confidentialité et de non-contournement (code)
// → origine des fonds → accès (adresse et identité révélées), puis documents (visionneuse embarquée), fiche de reprise
// du bail (GET /properties/{id}/lease-transfer) et offre d'achat.

const OPEN_OFFER_STATUSES = ['pending_signature', 'pending', 'countered', 'accepted'];

const DataroomPage = ({ user, setUser }) => {
  const { propertyId } = useParams();
  usePrivateSeo('Dossier du bien');
  const [property, setProperty] = useState(null);
  const [access, setAccess] = useState(null);
  const [kyc, setKyc] = useState(null);
  const [offers, setOffers] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [leaseTransfer, setLeaseTransfer] = useState(null);
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
      const [docs, lease] = await Promise.all([fetchDataroomDocuments(propertyId), fetchLeaseTransfer(propertyId)]);
      setDocuments(asList(docs, 'documents'));
      setLeaseTransfer(lease);
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
      toast.success(status === 'accepted' ? 'Demande acceptée automatiquement par le vendeur.' : 'Demande envoyée au vendeur. Nous le relançons à J+2 et J+5 s\'il ne répond pas.', { duration: 7000 });
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
        toast.info('Engagement de confidentialité déjà signé.');
        await load();
        return;
      }
      setNda({ contract_id: data.contract_id, content: data.content, contract_number: data.contract_number, terms_date: data.terms_date });
    } catch (error) {
      if (isEmailNotVerifiedError(error)) setStepError('Confirmez d\'abord votre adresse e-mail (bandeau en haut de page).');
      else if (isIdentityRequired(error)) setStepError('identity');
      else if (isNotAllowed(error)) setStepError(apiErrorMessage(error, 'Le vendeur doit d\'abord accepter votre demande de dossier.'));
      else setStepError(apiErrorMessage(error, 'L\'engagement n\'a pas pu être préparé. Réessayez dans quelques instants.'));
    } finally {
      setNdaLoading(false);
    }
  };

  const signNda = async (otpCode) => {
    await axiosInstance.post(`/contracts/${nda.contract_id}/sign`, { otp_code: otpCode });
    trackEvent('nda_signed', { listing: String(propertyId) });
    setNda(null);
    toast.success('Engagement de confidentialité signé. Un exemplaire PDF vous est envoyé par e-mail ; déclarez maintenant l\'origine des fonds pour ouvrir le dossier.', { duration: 8000 });
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

  const title = titleOf(property) || 'Bien loué';
  const isSeller = access?.isSeller || user?.role === 'seller';

  if (isSeller) {
    return (
      <ConnectedShell user={user} setUser={setUser} title={title} eyebrow="Dossier du bien" backTo="/seller/dashboard" backLabel="Mon espace">
        <div className="card p-5 sm:p-6">
          <p className="text-gray-700 leading-relaxed">Vous êtes le vendeur de ce bien : les documents du dossier, les demandes d&apos;accès et les offres d&apos;achat se gèrent depuis votre espace.</p>
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
      <KYCVerificationButton user={user} className="bg-brand-teal hover:bg-brand-teal-dark rounded-xl" />
      <p className="text-xs text-gray-500">Vérification par Stripe Identity, dans cet onglet. Seul le résultat est conservé, jamais les images.</p>
    </div>
  );

  const items = [
    {
      id: 'request',
      label: 'Dossier demandé au vendeur',
      state: a.status ? 'done' : 'current',
      description: a.status ? 'Votre demande est enregistrée.' : 'Le vendeur reçoit votre carte acquéreur (projet, budget, financement, rendement visé) et décide de vous ouvrir le dossier du bien.',
      action: !a.status && (
        <div className="space-y-2 max-w-xl">
          <label htmlFor="request-message" className="block text-sm font-medium text-brand-navy">Un mot pour le vendeur (facultatif)</label>
          <textarea
            id="request-message"
            value={requestMessage}
            onChange={(e) => setRequestMessage(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="Pourquoi ce bien vous intéresse, votre calendrier, votre financement."
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
      label: 'Accepté par le vendeur',
      state: a.accepted || granted ? 'done' : a.status === 'pending' ? 'current' : 'todo',
      description: granted || a.accepted
        ? 'Le vendeur a accepté de vous ouvrir le dossier.'
        : rejected
          ? 'Le vendeur n\'a pas donné suite à votre demande.'
          : closedRequest
            ? 'Cette annonce n\'est plus en ligne : votre demande de dossier est close.'
          : expired
            ? 'Le vendeur n\'a pas répondu sous 10 jours : nous l\'avons relancé et vous préviendrons dès sa réponse.'
            : 'Le vendeur répond en un geste. Sans réponse, nous le relançons à J+2 et J+5 ; sans réponse sous 10 jours, vous êtes prévenu.',
    },
    {
      id: 'identity',
      label: 'Identité vérifiée',
      state: steps.identity ? 'done' : a.accepted && !granted ? 'current' : 'todo',
      description: steps.identity ? 'Votre identité est vérifiée.' : 'Demandée une seule fois, avant la signature de l\'engagement de confidentialité. Le vendeur ne la voit qu\'après votre signature.',
      action: !steps.identity && a.accepted && identityStepAction,
    },
    {
      id: 'nda',
      label: 'Engagement de confidentialité et de non-contournement',
      state: steps.nda ? 'done' : a.accepted && steps.identity && !granted ? 'current' : 'todo',
      description: steps.nda
        ? 'Engagement signé par code : vous figurez sur la liste des acquéreurs présentés au vendeur.'
        : 'Lecture du texte intégral puis signature par code reçu par e-mail. Pendant 24 mois : informations réservées à l\'étude de l\'achat, aucun contact avec le locataire, le syndic ou l\'exploitant sans l\'accord du vendeur, pas d\'achat en dehors de la plateforme.',
      action: !steps.nda && a.accepted && steps.identity && (
        <button type="button" onClick={prepareNda} disabled={ndaLoading} className="btn-primary px-4 py-2.5 text-sm" data-testid="nda-btn">
          {ndaLoading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <FileSignature className="w-4 h-4" aria-hidden="true" />}
          Lire et signer l&apos;engagement
        </button>
      ),
    },
    {
      id: 'funds',
      label: 'Origine des fonds déclarée',
      state: steps.funds || granted ? 'done' : steps.nda && a.accepted && !granted ? 'current' : 'todo',
      description: steps.funds || granted ? 'Déclaration enregistrée.' : 'Origine et montant des fonds mobilisables, partenaire financier éventuel (obligation de lutte contre le blanchiment). Transmise au vendeur avec votre identité.',
      action: !steps.funds && !granted && steps.nda && a.accepted && (
        <div className="max-w-2xl rounded-xl border border-brand-line bg-white p-4">
          <FundsDeclarationForm propertyId={propertyId} defaultAmount={user?.buyer_profile?.budget_max || ''} onDone={async () => { toast.success('Accès au dossier accordé.'); await load(); }} />
        </div>
      ),
    },
    {
      id: 'access',
      label: 'Accès au dossier du bien',
      state: granted ? 'done' : 'todo',
      description: granted ? 'Adresse, identité du vendeur, documents, fiche de reprise du bail et offre d\'achat sont disponibles ci-dessous.' : 'Ouvert automatiquement dès que les trois étapes précédentes sont faites : l\'adresse exacte et l\'identité du vendeur vous sont alors révélées.',
    },
  ];

  const openOffers = offers.filter((o) => OPEN_OFFER_STATUSES.includes(o.status));
  const canOffer = granted && openOffers.length === 0 && property.status === 'published';

  return (
    <ConnectedShell
      user={user}
      setUser={setUser}
      title={title}
      eyebrow="Dossier du bien"
      backTo="/buyer/dashboard"
      backLabel="Mes dossiers"
      wide={granted}
      actions={(
        <>
          <Link to={propertyPath(propertyId)} className="btn-secondary px-4 py-2 text-sm">Voir l&apos;annonce</Link>
          <Link to={`/messages?conversation=${encodeURIComponent(propertyId)}`} className="btn-secondary px-4 py-2 text-sm">
            <MessageSquare className="w-4 h-4" aria-hidden="true" />
            Messagerie
          </Link>
        </>
      )}
    >
      {granted && (property.address || property.company_name) && (
        <section className="mb-6 rounded-2xl border border-brand-line bg-white p-4 sm:p-5 min-w-0" aria-labelledby="revealed-title" data-testid="revealed-info">
          <h2 id="revealed-title" className="flex items-center gap-2 text-sm font-semibold text-brand-navy">
            <KeyRound className="w-4 h-4 shrink-0 text-gray-500" aria-hidden="true" />
            Révélé après l&apos;engagement de confidentialité
          </h2>
          <dl className="mt-2 grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {property.address && (
              <div className="min-w-0">
                <dt className="text-xs text-gray-500">Adresse du bien</dt>
                <dd className="text-brand-navy font-medium break-words flex items-start gap-1.5" data-testid="revealed-address">
                  <MapPin className="w-4 h-4 mt-0.5 shrink-0 text-gray-400" aria-hidden="true" />
                  {[property.address, [property.postal_code, property.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')}
                </dd>
              </div>
            )}
            {property.company_name && (
              <div className="min-w-0">
                <dt className="text-xs text-gray-500">Société propriétaire</dt>
                <dd className="text-brand-navy font-medium break-words" data-testid="revealed-name">
                  {property.company_name}{property.siret ? ` · SIRET ${property.siret}` : ''}
                </dd>
              </div>
            )}
          </dl>
          <p className="text-[13px] text-gray-600 mt-2 leading-relaxed">
            Visites organisées par le vendeur avec l&apos;accord du locataire. Ne contactez ni le locataire, ni le syndic, ni l&apos;exploitant sans l&apos;accord du vendeur.
          </p>
        </section>
      )}
      {property.asking_price != null && (
        <p className="text-sm text-gray-600 mb-6">
          Prix demandé : <span className="font-semibold text-brand-navy tabular">{formatPrice(property.asking_price)}</span>
          {formatYield(property.gross_yield) ? <> · rendement brut <span className="font-semibold text-brand-navy tabular">{formatYield(property.gross_yield)}</span></> : null}
        </p>
      )}

      {stepError === 'profile' && (
        <p role="alert" className="notice-amber mb-4" data-testid="profile-incomplete">
          Votre profil d&apos;investisseur est incomplet (40 % requis pour contacter un vendeur et demander un dossier). <Link to="/profile" className="font-semibold underline underline-offset-2">Compléter mon profil</Link>
        </p>
      )}
      {stepError === 'identity' && (
        <div className="notice-amber mb-4 flex flex-col sm:flex-row sm:items-center gap-3" role="alert">
          <span className="flex-1">Votre identité doit être vérifiée avant de signer l&apos;engagement de confidentialité.</span>
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
          <h2 id="dataroom-steps-title" className="sr-only">Étapes d&apos;accès au dossier du bien</h2>
          <Checklist title="Accès au dossier du bien" items={items} />
        </section>

        {granted && (
          <div className="space-y-6 min-w-0">
            <section className="card p-5 sm:p-6 min-w-0" aria-labelledby="documents-title">
              <h2 id="documents-title" className="font-display text-lg font-bold text-brand-navy mb-3">Documents du dossier</h2>
              <DataroomDocuments propertyId={propertyId} documents={documents} />
            </section>

            <section className="card p-5 sm:p-6 min-w-0" aria-labelledby="offer-title">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <h2 id="offer-title" className="font-display text-lg font-bold text-brand-navy">Offre d&apos;achat</h2>
                {canOffer && !showOfferForm && (
                  <button type="button" onClick={() => setShowOfferForm(true)} className="btn-primary px-4 py-2 text-sm" data-testid="open-offer-form">
                    <Plus className="w-4 h-4" aria-hidden="true" />
                    Faire une offre d&apos;achat
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
                    Prix, financement, condition suspensive de prêt, conditions et calendrier : l&apos;offre est signée par code et contresignée par le vendeur s&apos;il l&apos;accepte. Elle n&apos;emporte pas vente : l&apos;avant-contrat et l&apos;acte authentique sont rédigés par le notaire. {property.status !== 'published' && 'Cette annonce n\'est plus en ligne : aucune nouvelle offre n\'est possible.'}
                  </p>
                )
              )}
              {openOffers.length > 0 && !showOfferForm && (
                <p className="text-sm text-gray-600 flex items-center gap-2"><PenTool className="w-4 h-4 shrink-0 text-gray-400" aria-hidden="true" />Une offre d&apos;achat est en cours sur ce bien : attendez la réponse du vendeur avant d&apos;en déposer une autre.</p>
              )}
            </section>

            {leaseTransfer && (
              <section className="card p-5 sm:p-6 min-w-0" aria-label="Fiche de reprise du bail">
                <LeaseTransferPanel data={leaseTransfer} />
              </section>
            )}
          </div>
        )}
      </div>

      {!granted && a.status && (
        <p className="mt-6 text-sm text-gray-600">
          Statut : <span className={badgeClass(granted ? 'success' : a.status === 'pending' ? 'warning' : rejected ? 'danger' : 'info')}>{granted ? 'Accès accordé' : a.status === 'pending' ? 'En attente du vendeur' : rejected ? 'Refusée' : expired ? 'Expirée' : closedRequest ? 'Close' : 'Acceptée'}</span>
        </p>
      )}

      {nda && (
        <OtpSignatureDialog
          open
          onClose={() => setNda(null)}
          title="Engagement de confidentialité et de non-contournement"
          subtitle={nda.contract_number ? `N° ${nda.contract_number}` : undefined}
          termsDate={nda.terms_date}
          contractId={nda.contract_id}
          documentText={nda.content}
          acceptLabel="J'ai lu l'engagement de confidentialité et de non-contournement et je l'accepte. Je comprends que cette signature électronique a valeur juridique."
          signLabel="Signer l'engagement"
          onSign={signNda}
        />
      )}
    </ConnectedShell>
  );
};

export default DataroomPage;
