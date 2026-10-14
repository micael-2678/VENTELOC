import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FlaskConical, Loader2, MailWarning, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { axiosInstance } from '@/App';
import { apiErrorMessage, isEmailNotVerifiedError } from '@/components/account/errors';
import { useTestMode } from '@/lib/testMode';
import { confirmEmailNow } from '@/components/test/testActions';

// Bandeau « Confirmez votre adresse » (SPEC §4.1) : affiché par App.js tant que user.email_verified === false,
// et par n'importe quelle page qui reçoit un 403 {code:'email_not_verified'} (voir isEmailNotVerifiedError).
// Renvoi de l'e-mail : POST /auth/resend-verification (1 par minute), compte à rebours local.
// Mode test (MODE-TEST-ET-APP.md §B.3) : bouton « Confirmer maintenant (mode test) » → POST /test/confirm-email.

export { isEmailNotVerifiedError };

const RESEND_DELAY_SECONDS = 60;

export const refreshStoredUser = async (setUser) => {
  const res = await axiosInstance.get('/auth/profile');
  const fresh = res.data;
  try {
    localStorage.setItem('user', JSON.stringify(fresh));
  } catch (e) {
    // stockage indisponible (navigation privée) : l'état en mémoire suffit
  }
  if (typeof setUser === 'function') setUser(fresh);
  return fresh;
};

const EmailVerificationBanner = ({ user, setUser, className = '', compact = false }) => {
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [sentOnce, setSentOnce] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const { testMode } = useTestMode();
  const timer = useRef(null);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    timer.current = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(timer.current);
  }, [cooldown]);

  if (!user || user.email_verified !== false) return null;

  const resend = async () => {
    if (sending || cooldown > 0) return;
    setSending(true);
    try {
      const res = await axiosInstance.post('/auth/resend-verification');
      if (res.data?.already_verified) {
        toast.success('Votre adresse est déjà confirmée.');
        await refreshStoredUser(setUser);
        return;
      }
      setSentOnce(true);
      setCooldown(RESEND_DELAY_SECONDS);
      toast.success(`E-mail de confirmation envoyé à ${user.email}.`);
    } catch (error) {
      if (error?.response?.status === 429) setCooldown(RESEND_DELAY_SECONDS);
      toast.error(apiErrorMessage(error, "L'e-mail n'a pas pu être envoyé. Réessayez dans une minute."));
    } finally {
      setSending(false);
    }
  };

  const check = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const fresh = await refreshStoredUser(setUser);
      if (fresh?.email_verified) toast.success('Adresse confirmée, merci.');
      else toast.info("Pas encore confirmée : ouvrez l'e-mail et cliquez sur le lien.");
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setChecking(false);
    }
  };

  const confirmNow = async () => {
    if (confirming) return;
    setConfirming(true);
    try {
      await confirmEmailNow(setUser);
      toast.success('Adresse confirmée (mode test).');
    } catch (error) {
      toast.error(apiErrorMessage(error, "L'adresse n'a pas pu être confirmée."));
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div
      role="region"
      aria-label="Adresse e-mail à confirmer"
      className={`bg-brand-amber-soft border-b border-brand-amber/30 text-brand-navy ${className}`}
      data-testid="email-verification-banner"
    >
      <div className={`max-w-7xl mx-auto px-4 sm:px-6 ${compact ? 'py-2.5' : 'py-3'} flex flex-col md:flex-row md:items-center gap-3 min-w-0`}>
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <MailWarning className="w-5 h-5 mt-0.5 text-brand-amber shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-semibold leading-snug">Confirmez votre adresse e-mail</p>
            <p className="text-sm text-gray-700 leading-relaxed break-words">
              Un lien de confirmation a été envoyé à <span className="font-semibold">{user.email}</span>.
              {!compact && <> Tant que l'adresse n'est pas confirmée, vous ne pouvez ni contacter, ni créer d'alerte, ni signer, ni publier.</>}
              {' '}Pas reçu ? Regardez vos courriers indésirables ou renvoyez-le.
              {' '}<Link to="/profile" className="underline underline-offset-2 hover:text-brand-blue">Changer d'adresse</Link>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 md:shrink-0">
          <button
            type="button"
            onClick={resend}
            disabled={sending || cooldown > 0}
            className="btn-secondary px-4 py-2 text-sm"
            data-testid="resend-verification-btn"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
            {cooldown > 0 ? `Renvoyer dans ${cooldown} s` : sentOnce ? 'Renvoyer encore' : "Renvoyer l'e-mail"}
          </button>
          <button
            type="button"
            onClick={check}
            disabled={checking}
            className="btn-link text-sm px-2"
            data-testid="check-verification-btn"
          >
            <RefreshCw className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`} aria-hidden="true" />
            J'ai cliqué sur le lien
          </button>
          {testMode && (
            <button
              type="button"
              onClick={confirmNow}
              disabled={confirming}
              className="inline-flex items-center gap-2 rounded-xl border border-brand-amber/50 bg-white px-4 py-2 text-sm font-semibold text-brand-navy hover:bg-brand-amber-soft disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2"
              data-testid="test-confirm-email-btn"
            >
              {confirming ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <FlaskConical className="w-4 h-4 text-brand-amber" aria-hidden="true" />}
              Confirmer maintenant (mode test)
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default EmailVerificationBanner;
