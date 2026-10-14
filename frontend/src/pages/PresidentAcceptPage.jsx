import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { axiosInstance } from '@/App';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { KYCVerificationButton } from '@/components/KYCVerification';
import { usePrivateSeo } from '@/lib/seo';
import { OFFER, COMMISSION } from '@/lib/offer';
import { BRAND } from '@/lib/brand';
import { listingTitle } from '@/components/shared';
import { tradeLabel, departementLabel } from '@/lib/referentiels';
import { formatEur } from '@/lib/format';
import { formatDateTimeFr, MANDATE_NOTICE_DAYS } from '@/lib/mandate';
import { apiErrorMessage } from '@/components/account/errors';
import { Building2, User, Mail, CheckCircle2, XCircle, Shield, ArrowLeft, Loader2, AlertTriangle } from 'lucide-react';

// Invitation du dirigeant (SPEC §4.4) : un vendeur qui n'est pas dirigeant peut demander au dirigeant de signer
// lui-même le mandat de vente simple. Le dirigeant crée un compte, vérifie son identité, accepte, puis signe.
export function PresidentAcceptPage({ user, setUser }) {
  usePrivateSeo('Invitation du dirigeant');
  const { token } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [invitation, setInvitation] = useState(null);
  const [property, setProperty] = useState(null);
  const [error, setError] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [showDeclineForm, setShowDeclineForm] = useState(false);
  const [refreshedUser, setRefreshedUser] = useState(null);

  const redirectPath = `/president/accept/${token}`;
  const dashboardPath = (role) => (role === 'admin' ? '/admin/dashboard' : role === 'buyer' ? '/buyer/dashboard' : '/seller/dashboard');

  useEffect(() => {
    let cancelled = false;
    axiosInstance.get(`/president/invitation/${token}`)
      .then((res) => {
        if (cancelled) return;
        setInvitation(res.data.invitation);
        setProperty(res.data.property);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err.response?.status === 404) setError('Cette invitation n\'existe pas ou a expiré.');
        else if (err.response?.status === 410) setError('Cette invitation a expiré. Demandez une nouvelle invitation à la personne qui a déposé l\'annonce.');
        else setError('Impossible de charger l\'invitation pour le moment.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  // Profil à jour (identité vérifiée) avant de tester identity_verified
  useEffect(() => {
    if (!user) return;
    axiosInstance.get('/auth/profile')
      .then((res) => {
        setRefreshedUser(res.data);
        localStorage.setItem('user', JSON.stringify(res.data));
        if (setUser) setUser(res.data);
      })
      .catch(() => {});
  }, [user?.id]);
  const currentUser = refreshedUser || user;
  const isIdentityVerified = !!(currentUser?.identity_verified || currentUser?.kyc_status === 'verified');
  const sameEmail = !!user && !!invitation?.president_email && user.email.toLowerCase() === invitation.president_email.toLowerCase();

  const handleAccept = async () => {
    if (!user) {
      localStorage.setItem('president_invitation_token', token);
      toast.info('Créez un compte pour accepter cette invitation.');
      navigate(`/register?role=seller&redirect=${encodeURIComponent(redirectPath)}&email=${encodeURIComponent(invitation?.president_email || '')}`);
      return;
    }
    if (!sameEmail) {
      toast.error(`Cette invitation est destinée à ${invitation?.president_email}.`);
      return;
    }
    if (!isIdentityVerified) {
      toast.error('Vérifiez votre identité avant d\'accepter cette invitation.');
      return;
    }
    setProcessing(true);
    try {
      await axiosInstance.post(`/president/accept/${token}`);
      toast.success('Invitation acceptée. Vous pouvez maintenant signer le mandat de vente depuis votre espace.', { duration: 8000 });
      navigate(property?.id ? `/seller/mandat/${property.id}` : dashboardPath(currentUser?.role));
    } catch (err) {
      toast.error(apiErrorMessage(err, 'L\'acceptation a échoué.'));
    } finally {
      setProcessing(false);
    }
  };

  const handleDecline = async () => {
    setProcessing(true);
    try {
      await axiosInstance.post(`/president/decline/${token}`, null, { params: { reason: declineReason || undefined } });
      toast.success('Invitation refusée.');
      navigate('/');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Le refus a échoué.'));
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-surface flex items-center justify-center" role="status" aria-label="Chargement">
        <Loader2 className="h-8 w-8 animate-spin text-brand-navy" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-brand-surface flex items-center justify-center p-4">
        <Card className="max-w-md w-full rounded-2xl">
          <CardHeader className="text-center">
            <AlertTriangle className="h-12 w-12 text-brand-amber mx-auto mb-4" aria-hidden="true" />
            <CardTitle>Invitation non disponible</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Link to="/"><Button variant="outline" className="rounded-xl"><ArrowLeft className="mr-2 h-4 w-4" />Retour à l'accueil</Button></Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (invitation?.status === 'accepted') {
    return (
      <div className="min-h-screen bg-brand-surface flex items-center justify-center p-4">
        <Card className="max-w-md w-full rounded-2xl">
          <CardHeader className="text-center">
            <CheckCircle2 className="h-12 w-12 text-brand-green mx-auto mb-4" aria-hidden="true" />
            <CardTitle>Invitation déjà acceptée</CardTitle>
            <CardDescription>Le mandat se signe depuis l'espace vendeur, par code reçu par e-mail.</CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Link to={user ? dashboardPath(currentUser?.role) : `/login?redirect=${encodeURIComponent(redirectPath)}`}>
              <Button className="rounded-xl bg-brand-navy hover:bg-brand-navy-light text-white">Accéder à mon espace</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-surface py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-navy rounded-2xl mb-4">
            <Shield className="h-8 w-8 text-white" aria-hidden="true" />
          </div>
          <h1 className="font-display text-3xl font-extrabold text-brand-navy">Signature du mandat par le dirigeant</h1>
          <p className="text-gray-700 mt-2">
            Une personne de votre société a préparé une annonce de cession anonyme sur {BRAND.name}. En tant que dirigeant, vous pouvez accepter d'en devenir cotitulaire pour signer vous-même le mandat de vente simple.
          </p>
        </div>

        <Card className="mb-6 rounded-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg"><Mail className="h-5 w-5" aria-hidden="true" />Invitation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid sm:grid-cols-2 gap-4 text-sm">
              <div><dt className="text-gray-500">Destinataire</dt><dd className="font-medium break-words">{invitation?.president_firstname} {invitation?.president_lastname}</dd></div>
              <div><dt className="text-gray-500">E-mail</dt><dd className="font-medium break-words">{invitation?.president_email}</dd></div>
              <div><dt className="text-gray-500">Envoyée par</dt><dd className="font-medium break-words">{invitation?.invited_by_email}</dd></div>
              <div><dt className="text-gray-500">Valable jusqu'au</dt><dd className="font-medium">{formatDateTimeFr(invitation?.expires_at)}</dd></div>
            </dl>
            {invitation?.message && (
              <div className="p-4 bg-brand-surface rounded-xl text-sm">
                <p className="text-gray-500">Message</p>
                <p className="mt-1 whitespace-pre-line break-words">{invitation.message}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {property && (
          <Card className="mb-6 rounded-2xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg"><Building2 className="h-5 w-5" aria-hidden="true" />Annonce concernée</CardTitle>
              <CardDescription>{listingTitle(property)}</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid sm:grid-cols-2 gap-4 text-sm">
                <div className="min-w-0"><dt className="text-gray-500">Métiers</dt><dd className="font-medium break-words">{(property.trades || []).map((t) => tradeLabel(t)).filter(Boolean).join(', ') || (property.rge_types || []).join(', ') || 'Non renseignés'}</dd></div>
                <div><dt className="text-gray-500">Localisation</dt><dd className="font-medium">{[property.region, departementLabel(property.department)].filter(Boolean).join(' · ') || 'Non renseignée'}</dd></div>
                <div><dt className="text-gray-500">Prix demandé</dt><dd className="font-medium tabular">{property.asking_price ? formatEur(property.asking_price) : 'Non renseigné'}</dd></div>
                <div><dt className="text-gray-500">Effectif</dt><dd className="font-medium">{property.staff_count ? `${property.staff_count} salariés` : 'Non renseigné'}</dd></div>
              </dl>
            </CardContent>
          </Card>
        )}

        <Card className="mb-6 rounded-2xl">
          <CardHeader>
            <CardTitle className="text-lg">Ce que vous signerez ensuite</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc list-inside text-sm text-gray-800 space-y-1">
              <li>Mandat de vente <strong>simple</strong> avec {COMMISSION.mandateHolder} (carte professionnelle T) : sans exclusivité, vous restez libre de vendre par vous-même.</li>
              <li>Durée 12 mois, résiliable à tout moment depuis votre espace avec un préavis de {MANDATE_NOTICE_DAYS} jours, sans indemnité.</li>
              <li>{OFFER.commissionShort} Due uniquement si la vente se conclut avec un repreneur nommément présenté.</li>
              <li>Signature par code reçu par e-mail, après vérification de votre identité ; dossier de preuve conservé dix ans.</li>
            </ul>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="text-lg">Votre décision</CardTitle>
            <CardDescription>En acceptant, vous confirmez être le dirigeant de la société et devenez cotitulaire de l'annonce : vous pourrez signer le mandat, suivre les repreneurs et répondre aux offres.</CardDescription>
          </CardHeader>
          <CardContent>
            {!user ? (
              <div className="space-y-4">
                <p className="p-4 bg-brand-amber-soft border border-amber-200 rounded-xl text-sm text-brand-amber flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                  Créez un compte avec l'adresse {invitation?.president_email}, puis vérifiez votre identité pour accepter cette invitation.
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <Button onClick={handleAccept} className="flex-1 rounded-xl bg-brand-navy hover:bg-brand-navy-light text-white"><User className="mr-2 h-4 w-4" />Créer un compte</Button>
                  <Link to={`/login?redirect=${encodeURIComponent(redirectPath)}`} className="flex-1"><Button variant="outline" className="w-full rounded-xl">Se connecter</Button></Link>
                </div>
              </div>
            ) : !sameEmail ? (
              <p className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-800 flex items-start gap-2">
                <XCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                <span>Cette invitation est destinée à <strong>{invitation?.president_email}</strong>. Vous êtes connecté avec <strong>{user.email}</strong>.</span>
              </p>
            ) : !isIdentityVerified ? (
              <div className="space-y-4">
                <p className="p-4 bg-brand-amber-soft border border-amber-200 rounded-xl text-sm text-brand-amber flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                  Vérifiez votre identité (pièce d'identité et selfie, environ 2 minutes) avant d'accepter : elle est exigée pour signer le mandat.
                </p>
                <KYCVerificationButton user={currentUser} className="w-full rounded-xl bg-brand-navy hover:bg-brand-navy-light text-white" />
              </div>
            ) : showDeclineForm ? (
              <div className="space-y-4">
                <Label htmlFor="decline-reason">Raison du refus (facultatif)</Label>
                <Textarea id="decline-reason" value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} rows={3} className="rounded-xl" />
                <div className="flex flex-col sm:flex-row gap-3">
                  <Button variant="outline" onClick={() => setShowDeclineForm(false)} className="flex-1 rounded-xl">Annuler</Button>
                  <Button variant="destructive" onClick={handleDecline} disabled={processing} className="flex-1 rounded-xl">
                    {processing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <XCircle className="mr-2 h-4 w-4" />}
                    Confirmer le refus
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row gap-3">
                <Button onClick={handleAccept} disabled={processing} className="flex-1 rounded-xl bg-brand-green hover:bg-brand-green-dark text-white" data-testid="president-accept">
                  {processing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                  Accepter et signer le mandat
                </Button>
                <Button variant="outline" onClick={() => setShowDeclineForm(true)} className="flex-1 rounded-xl text-red-700 border-red-200 hover:bg-red-50">
                  <XCircle className="mr-2 h-4 w-4" />
                  Refuser
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default PresidentAcceptPage;
