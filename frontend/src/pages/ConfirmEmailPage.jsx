import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, Loader2, MailX, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { axiosInstance } from '@/App';
import { usePrivateSeo } from '@/lib/seo';
import { homePathFor } from '@/lib/navigation';
import { BRAND } from '@/lib/brand';
import AuthShell from '@/components/account/AuthShell';
import { apiErrorMessage } from '@/components/account/errors';
import { refreshStoredUser } from '@/components/EmailVerificationBanner';

// /confirmer-email/:token (SPEC §4.1) : POST /auth/verify-email {token}. États : succès, lien expiré, lien
// invalide, avec renvoi d'un nouvel e-mail (POST /auth/resend-verification) pour l'utilisateur connecté.

const RESEND_DELAY_SECONDS = 60;

const ConfirmEmailPage = ({ user, setUser }) => {
  usePrivateSeo('Confirmation de votre adresse e-mail');
  const { token } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState(token ? 'loading' : 'invalid'); // loading | success | already | expired | invalid
  const [email, setEmail] = useState('');
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    (async () => {
      try {
        const res = await axiosInstance.post('/auth/verify-email', { token });
        setEmail(res.data?.email || '');
        setState(res.data?.already_verified ? 'already' : 'success');
        // Compte connecté (jeton en stockage local) : l'état local reflète la confirmation sans nouvelle connexion
        let saved = null;
        try { saved = JSON.parse(localStorage.getItem('user') || 'null'); } catch (e) { saved = null; }
        if (saved && localStorage.getItem('token') && (!res.data?.email || res.data.email === saved.email)) {
          try {
            await refreshStoredUser(setUser);
          } catch (e) {
            const updated = { ...saved, email_verified: true };
            try { localStorage.setItem('user', JSON.stringify(updated)); } catch (err) { /* stockage indisponible */ }
            if (typeof setUser === 'function') setUser(updated);
          }
        }
      } catch (error) {
        const msg = apiErrorMessage(error, '');
        setState(/expir/i.test(msg) ? 'expired' : 'invalid');
      }
    })();
  }, [token, setUser]);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  const resend = async () => {
    if (!user || resending || cooldown > 0) return;
    setResending(true);
    try {
      const res = await axiosInstance.post('/auth/resend-verification');
      if (res.data?.already_verified) {
        setState('already');
        await refreshStoredUser(setUser).catch(() => null);
        return;
      }
      setCooldown(RESEND_DELAY_SECONDS);
      toast.success(`Nouvel e-mail envoyé à ${user.email}.`);
    } catch (error) {
      if (error?.response?.status === 429) setCooldown(RESEND_DELAY_SECONDS);
      toast.error(apiErrorMessage(error, "L'e-mail n'a pas pu être envoyé. Réessayez dans une minute."));
    } finally {
      setResending(false);
    }
  };

  const continueTo = user ? homePathFor(user) : '/login';
  const continueLabel = user ? 'Accéder à mon espace' : 'Se connecter';

  const titles = {
    loading: 'Confirmation en cours…',
    success: 'Adresse confirmée',
    already: 'Adresse déjà confirmée',
    expired: 'Lien expiré',
    invalid: 'Lien invalide',
  };

  return (
    <AuthShell title={titles[state]} testId="confirm-email-page">
      <div className="text-center space-y-5" aria-live="polite">
        {state === 'loading' && (
          <>
            <Loader2 className="w-12 h-12 text-brand-navy mx-auto animate-spin" aria-hidden="true" />
            <p className="text-gray-600">Nous vérifions votre lien de confirmation.</p>
          </>
        )}

        {(state === 'success' || state === 'already') && (
          <>
            <CheckCircle2 className="w-14 h-14 text-brand-green mx-auto" aria-hidden="true" />
            <p className="text-gray-700 leading-relaxed">
              {state === 'success' ? 'Merci, votre adresse' : 'Votre adresse'}
              {email ? <> <span className="font-semibold text-brand-navy break-all">{email}</span></> : ' e-mail'}
              {state === 'success' ? ' est confirmée.' : ' était déjà confirmée.'}
              {' '}Vous pouvez maintenant contacter, créer des alertes, signer et publier sur {BRAND.name}.
            </p>
            <button type="button" onClick={() => navigate(continueTo)} className="btn-primary w-full" data-testid="confirm-email-continue">
              {continueLabel}
            </button>
          </>
        )}

        {state === 'expired' && (
          <>
            <Clock className="w-14 h-14 text-brand-amber mx-auto" aria-hidden="true" />
            <p className="text-gray-700 leading-relaxed">
              Ce lien de confirmation a expiré : il était valable 48 heures. Demandez un nouvel e-mail, puis cliquez sur le lien qu'il contient.
            </p>
          </>
        )}

        {state === 'invalid' && (
          <>
            <MailX className="w-14 h-14 text-red-600 mx-auto" aria-hidden="true" />
            <p className="text-gray-700 leading-relaxed">
              Ce lien de confirmation n'est pas valide ou a déjà été utilisé. Si votre adresse n'est pas encore confirmée, demandez un nouvel e-mail.
            </p>
          </>
        )}

        {(state === 'expired' || state === 'invalid') && (
          user ? (
            <div className="space-y-3">
              <button type="button" onClick={resend} disabled={resending || cooldown > 0} className="btn-primary w-full" data-testid="confirm-email-resend">
                {resending && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                {cooldown > 0 ? `Renvoyer dans ${cooldown} s` : "Recevoir un nouvel e-mail de confirmation"}
              </button>
              <p className="text-sm text-gray-600">Il sera envoyé à <span className="font-semibold break-all">{user.email}</span>.</p>
              <Link to={homePathFor(user)} className="btn-link text-sm">Retour à mon espace</Link>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">Connectez-vous pour recevoir un nouveau lien : le bouton « Renvoyer l'e-mail » est dans le bandeau en haut de votre espace.</p>
              <Link to="/login?redirect=%2Fprofile" className="btn-primary w-full" data-testid="confirm-email-login">Se connecter</Link>
            </div>
          )
        )}
      </div>
    </AuthShell>
  );
};

export default ConfirmEmailPage;
