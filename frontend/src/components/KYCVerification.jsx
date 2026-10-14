import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { axiosInstance } from '@/App';
import { toast } from 'sonner';
import { usePrivateSeo } from '@/lib/seo';
import { homePathFor } from '@/lib/navigation';
import { apiErrorMessage } from '@/components/account/errors';
import { useSession } from '@/components/layout/session';
import { useTestMode } from '@/lib/testMode';
import { simulateIdentity } from '@/components/test/testActions';
import {
  ShieldCheck, AlertCircle, CheckCircle, Loader2,
  UserCheck, FileText, Camera, ArrowRight, FlaskConical,
} from 'lucide-react';

// Vérification d'identité par Stripe Identity (SPEC §0.5) : elle est demandée à l'acquéreur avant de signer
// l'engagement de confidentialité et de non-contournement, et au vendeur avant de signer le mandat de vente. Elle
// n'est pas exigée pour contacter un vendeur ni pour créer une annonce. Seul le résultat (nom, date de naissance, type de document) est
// conservé, jamais les images.
// Mode test (MODE-TEST-ET-APP.md §B.3) : bouton « Simuler la vérification (mode test) » à côté du bouton Stripe
// → POST /test/identity/simulate, puis profil relu et page rechargée, comme au retour de Stripe (/kyc/callback).

// Délai avant rechargement après une vérification simulée (le message de réussite reste lisible)
const SIMULATED_RELOAD_DELAY_MS = 1200;

// Phrase « à quoi sert la vérification » selon le rôle (profil, dialogues, pages de parcours)
export const identityPurpose = (role) => {
  if (role === 'seller') {
    return 'Demandée une seule fois, au moment de signer le mandat de vente. Votre identité n\'apparaît jamais sur l\'annonce.';
  }
  if (role === 'buyer') {
    return 'Demandée avant de signer l\'engagement de confidentialité, juste avant que l\'adresse du bien et l\'identité du vendeur vous soient révélées. Contacter un vendeur ne la nécessite pas.';
  }
  return 'Demandée avant la signature d\'un document engageant (engagement de confidentialité, mandat).';
};

// Texte d'explication selon l'action demandée (KYCGate)
const ACTION_TEXTS = {
  sign_nda: 'Pour signer l\'engagement de confidentialité et connaître l\'adresse du bien, votre identité doit d\'abord être vérifiée.',
  sign_mandate: 'Pour signer le mandat de vente, votre identité doit d\'abord être vérifiée.',
  // Anciennes valeurs encore passées par certaines pages
  publish_listing: 'Pour signer le mandat de vente et publier votre annonce, votre identité doit d\'abord être vérifiée.',
  contact_seller: 'Pour signer l\'engagement de confidentialité avec ce vendeur, votre identité doit d\'abord être vérifiée.',
  dataroom: 'Pour accéder au dossier du bien, l\'engagement de confidentialité doit être signé, ce qui demande une identité vérifiée.',
};

// Statut KYC
export const KYCStatus = ({ user, onRefresh }) => {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkStatus();
  }, []);

  const checkStatus = async () => {
    try {
      const response = await axiosInstance.get('/kyc/status');
      setStatus(response.data);
      if (typeof onRefresh === 'function') onRefresh(response.data);
    } catch (error) {
      setStatus(user?.identity_verified ? { verified: true, status: 'verified' } : null);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Alert>
        <Loader2 className="h-4 w-4 animate-spin" />
        <AlertDescription>Lecture du statut de vérification…</AlertDescription>
      </Alert>
    );
  }

  if (status?.verified) {
    return (
      <Alert className="border-brand-green/30 bg-brand-green-soft">
        <CheckCircle className="h-4 w-4 text-brand-green" />
        <AlertDescription className="text-brand-green-dark">
          Identité vérifiée{status.verified_at ? ` le ${new Date(status.verified_at).toLocaleDateString('fr-FR')}` : ''}.
        </AlertDescription>
      </Alert>
    );
  }

  if (status?.status === 'processing') {
    return (
      <Alert className="border-brand-blue/20 bg-brand-blue-soft">
        <Loader2 className="h-4 w-4 text-brand-blue animate-spin" />
        <AlertDescription className="text-brand-navy">
          Vérification en cours de traitement : cela prend en général quelques minutes.
        </AlertDescription>
      </Alert>
    );
  }

  if (status?.status === 'requires_input') {
    return (
      <Alert className="border-brand-amber/30 bg-brand-amber-soft">
        <AlertCircle className="h-4 w-4 text-brand-amber" />
        <AlertDescription className="text-brand-navy">
          La vérification n'a pas abouti : reprenez-la avec une pièce lisible et un selfie net.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert className="border-brand-line bg-brand-surface">
      <ShieldCheck className="h-4 w-4 text-brand-navy" />
      <AlertDescription className="text-brand-navy">Identité non vérifiée pour l'instant.</AlertDescription>
    </Alert>
  );
};

// Bouton qui ouvre l'explication puis lance la session Stripe Identity
export const KYCVerificationButton = ({
  user,
  variant = 'default',
  size = 'default',
  className = '',
  label = 'Vérifier mon identité',
}) => {
  const [loading, setLoading] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [error, setError] = useState(null);
  const [simulating, setSimulating] = useState(false);
  const [simulated, setSimulated] = useState(false);
  const { testMode } = useTestMode();
  const { setUser } = useSession();
  const reloadTimer = useRef(null);

  useEffect(() => () => window.clearTimeout(reloadTimer.current), []);

  // Mode test : identité simulée avec les nom et prénom du profil ; mêmes effets que Stripe côté serveur
  const simulateVerification = async () => {
    setSimulating(true);
    setError(null);
    try {
      await simulateIdentity({}, setUser);
      setSimulated(true);
      toast.success('Identité vérifiée (simulation).');
      // Rechargement complet, comme après Stripe : toutes les gardes relisent le statut
      reloadTimer.current = window.setTimeout(() => window.location.reload(), SIMULATED_RELOAD_DELAY_MS);
    } catch (err) {
      setError(apiErrorMessage(err, 'La vérification simulée a échoué. Le panneau de test (/test) permet de saisir nom, prénom et date de naissance.'));
    } finally {
      setSimulating(false);
    }
  };

  const initiateVerification = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axiosInstance.post('/kyc/create-verification-session');
      if (response.data.url) {
        window.location.href = response.data.url;
      } else {
        toast.error('Le lien de vérification n\'a pas pu être obtenu. Réessayez dans quelques instants.');
      }
    } catch (err) {
      const errorMessage = apiErrorMessage(err, 'La vérification n\'a pas pu démarrer. Réessayez dans quelques instants ; si le problème persiste, nous vous recontactons.');
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button onClick={() => setShowDialog(true)} disabled={loading} variant={variant} size={size} className={className}>
        <ShieldCheck className="w-4 h-4 mr-2" aria-hidden="true" />
        {loading ? 'Chargement…' : label}
      </Button>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center">
              <UserCheck className="w-6 h-6 mr-2 text-brand-navy" aria-hidden="true" />
              Vérification d'identité
            </DialogTitle>
            <DialogDescription>{identityPurpose(user?.role)}</DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            <div className="space-y-4">
              {[
                { icon: FileText, title: '1. Préparez votre pièce d\'identité', text: 'Carte d\'identité, passeport ou permis de conduire en cours de validité.' },
                { icon: Camera, title: '2. Photographiez le document', text: 'Les informations doivent être lisibles, sans reflet.' },
                { icon: UserCheck, title: '3. Prenez un selfie', text: 'Pour vérifier que le document est bien le vôtre.' },
              ].map((step) => (
                <div key={step.title} className="flex items-start space-x-3">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-brand-surface border border-brand-line flex items-center justify-center">
                    <step.icon className="w-4 h-4 text-brand-navy" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">{step.title}</p>
                    <p className="text-xs text-gray-500">{step.text}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-brand-surface rounded-xl p-4">
              <p className="text-xs text-gray-600 leading-relaxed">
                <strong>Confidentialité :</strong> la vérification est réalisée par Stripe Identity, dans cet onglet. Nous conservons
                uniquement le résultat (nom, date de naissance, type et pays du document, date), jamais les images, pendant
                cinq ans après la fin de la relation. Le vendeur ne voit votre identité qu'après la signature de l'engagement de confidentialité.
              </p>
            </div>

            {error && (
              <Alert className="border-red-200 bg-red-50">
                <AlertCircle className="h-4 w-4 text-red-600" />
                <AlertDescription className="text-red-800">{error}</AlertDescription>
              </Alert>
            )}

            {simulated && (
              <Alert className="border-brand-green/30 bg-brand-green-soft" data-testid="kyc-simulated">
                <CheckCircle className="h-4 w-4 text-brand-green" />
                <AlertDescription className="text-brand-green-dark">Identité vérifiée (simulation). Actualisation de la page…</AlertDescription>
              </Alert>
            )}

            <Button onClick={initiateVerification} disabled={loading || simulating || simulated} className="w-full bg-brand-teal hover:bg-brand-teal-dark rounded-xl">
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                  Ouverture…
                </>
              ) : (
                <>
                  Commencer la vérification
                  <ArrowRight className="w-4 h-4 ml-2" aria-hidden="true" />
                </>
              )}
            </Button>

            {testMode && (
              <Button
                type="button"
                variant="outline"
                onClick={simulateVerification}
                disabled={loading || simulating || simulated}
                className="w-full rounded-xl border-brand-amber/50 text-brand-navy hover:bg-brand-amber-soft h-auto min-h-10 whitespace-normal"
                data-testid="kyc-simulate-btn"
              >
                {simulating
                  ? <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                  : <FlaskConical className="w-4 h-4 mr-2 text-brand-amber" aria-hidden="true" />}
                Simuler la vérification (mode test)
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

// Garde : affiche les enfants si l'identité est vérifiée, sinon l'explication et le bouton.
// action : 'sign_nda' | 'sign_mandate' (anciennes valeurs 'publish_listing' / 'contact_seller' acceptées)
export const KYCGate = ({ user, action = 'sign_nda', children, fallback = null }) => {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkKYC();
  }, []);

  const checkKYC = async () => {
    try {
      const response = await axiosInstance.get('/kyc/status');
      setStatus(response.data);
    } catch (error) {
      setStatus({ verified: !!user?.identity_verified });
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8" role="status" aria-label="Chargement">
        <Loader2 className="w-8 h-8 animate-spin text-brand-navy" aria-hidden="true" />
      </div>
    );
  }

  if (status?.verified) return children;
  if (fallback) return fallback;

  return (
    <div className="card p-8 text-center max-w-md mx-auto">
      <ShieldCheck className="w-16 h-16 text-gray-300 mx-auto mb-4" aria-hidden="true" />
      <h3 className="text-xl font-semibold mb-2">Identité à vérifier</h3>
      <p className="text-gray-600 mb-2">{ACTION_TEXTS[action] || ACTION_TEXTS.sign_nda}</p>
      <p className="text-sm text-gray-500 mb-6">{identityPurpose(user?.role)}</p>
      <KYCVerificationButton user={user} className="w-full bg-brand-teal hover:bg-brand-teal-dark rounded-xl" />
    </div>
  );
};

// Page de retour après Stripe Identity (/kyc/callback)
export const KYCCallbackPage = ({ user }) => {
  usePrivateSeo("Vérification d'identité");
  const [status, setStatus] = useState('checking');
  const [message, setMessage] = useState('');

  useEffect(() => {
    checkVerificationResult();
  }, []);

  const nextPath = () => {
    try {
      const saved = sessionStorage.getItem('kyc_return_to');
      if (saved && saved.startsWith('/') && !saved.startsWith('//')) {
        sessionStorage.removeItem('kyc_return_to');
        return saved;
      }
    } catch (e) {
      // stockage indisponible
    }
    return homePathFor(user);
  };

  const checkVerificationResult = async () => {
    try {
      const response = await axiosInstance.get('/kyc/status');
      if (response.data.verified) {
        setStatus('success');
        setMessage('Votre identité est vérifiée. Vous pouvez reprendre là où vous en étiez.');
        try {
          const profileRes = await axiosInstance.get('/auth/profile');
          localStorage.setItem('user', JSON.stringify(profileRes.data));
        } catch (e) {
          // le profil sera relu à la prochaine connexion
        }
        // Rechargement complet : App relit l'utilisateur stocké
        const target = nextPath();
        setTimeout(() => { window.location.href = target; }, 2500);
      } else if (response.data.status === 'processing') {
        setStatus('processing');
        setMessage('Votre vérification est en cours de traitement. Cela prend en général quelques minutes ; vous serez prévenu par e-mail.');
      } else if (response.data.status === 'requires_input') {
        setStatus('error');
        setMessage('La vérification n\'a pas abouti : reprenez-la avec une pièce lisible et un selfie net.');
      } else {
        setStatus('pending');
        setMessage('Vérification en attente.');
      }
    } catch (error) {
      setStatus('error');
      setMessage(apiErrorMessage(error, 'Le statut de la vérification n\'a pas pu être lu.'));
    }
  };

  return (
    <div className="min-h-screen bg-brand-surface flex items-center justify-center p-4">
      <div className="card p-8 text-center max-w-md" aria-live="polite">
        {status === 'checking' && (
          <>
            <Loader2 className="w-16 h-16 text-brand-navy mx-auto mb-4 animate-spin" aria-hidden="true" />
            <h2 className="text-xl font-semibold mb-2">Vérification en cours…</h2>
            <p className="text-gray-600">Nous lisons le résultat de votre vérification.</p>
          </>
        )}

        {status === 'success' && (
          <>
            <CheckCircle className="w-16 h-16 text-brand-green mx-auto mb-4" aria-hidden="true" />
            <h2 className="text-xl font-semibold mb-2 text-brand-green-dark">Identité vérifiée</h2>
            <p className="text-gray-600">{message}</p>
            <p className="text-sm text-gray-500 mt-2">Redirection en cours…</p>
          </>
        )}

        {status === 'processing' && (
          <>
            <Loader2 className="w-16 h-16 text-brand-blue mx-auto mb-4 animate-spin" aria-hidden="true" />
            <h2 className="text-xl font-semibold mb-2 text-brand-navy">Traitement en cours</h2>
            <p className="text-gray-600">{message}</p>
            <Button onClick={checkVerificationResult} className="mt-4 bg-brand-teal hover:bg-brand-teal-dark rounded-xl">
              Vérifier à nouveau
            </Button>
          </>
        )}

        {status === 'error' && (
          <>
            <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" aria-hidden="true" />
            <h2 className="text-xl font-semibold mb-2 text-red-800">Vérification non aboutie</h2>
            <p className="text-gray-600">{message}</p>
            <KYCVerificationButton user={user} className="mt-4 w-full" label="Reprendre la vérification" />
          </>
        )}

        {status === 'pending' && (
          <>
            <AlertCircle className="w-16 h-16 text-brand-amber mx-auto mb-4" aria-hidden="true" />
            <h2 className="text-xl font-semibold mb-2">En attente</h2>
            <p className="text-gray-600">{message}</p>
            <Button onClick={checkVerificationResult} className="mt-4 bg-brand-teal hover:bg-brand-teal-dark rounded-xl">
              Actualiser
            </Button>
          </>
        )}
      </div>
    </div>
  );
};

export default KYCVerificationButton;
