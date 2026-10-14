import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, Lock, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { axiosInstance } from '@/App';
import { usePrivateSeo } from '@/lib/seo';
import AuthShell from '@/components/account/AuthShell';
import { apiErrorMessage } from '@/components/account/errors';

// Sans token : demande d'un lien par e-mail (POST /auth/forgot-password). Avec ?token= : nouveau mot de passe
// (POST /auth/reset-password). Routes : /mot-de-passe-oublie, /reset-password, /reset-password/:token (redirigé).

const inputClass = 'w-full rounded-xl border border-brand-line bg-white px-4 py-3 text-brand-navy focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30';

const ResetPasswordPage = () => {
  usePrivateSeo('Réinitialiser le mot de passe');
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const requestLink = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await axiosInstance.post('/auth/forgot-password', { email: email.trim() });
      setSent(true);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'La demande n\'a pas pu être envoyée'));
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async (e) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error('Le mot de passe doit contenir au moins 8 caractères');
      return;
    }
    if (password !== confirm) {
      toast.error('Les mots de passe ne correspondent pas');
      return;
    }
    setLoading(true);
    try {
      await axiosInstance.post('/auth/reset-password', { token, new_password: password });
      toast.success('Mot de passe modifié, vous pouvez vous connecter');
      navigate('/login');
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Lien invalide ou expiré'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title={token ? 'Nouveau mot de passe' : 'Mot de passe oublié'}
      subtitle={token ? 'Choisissez un mot de passe de 8 caractères au moins.' : 'Indiquez l\'adresse de votre compte : nous vous envoyons un lien valable une heure.'}
      testId="reset-password-page"
      footer={<Link to="/login" className="text-brand-navy font-semibold hover:underline">Retour à la connexion</Link>}
    >
      {token ? (
        <form onSubmit={resetPassword} className="space-y-5">
          <div>
            <label htmlFor="password" className="flex items-center gap-2 text-sm font-semibold text-brand-navy mb-1">
              <Lock className="w-4 h-4" aria-hidden="true" />
              Nouveau mot de passe
            </label>
            <input id="password" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required className={inputClass} />
          </div>
          <div>
            <label htmlFor="confirm" className="block text-sm font-semibold text-brand-navy mb-1">Confirmation</label>
            <input id="confirm" type="password" autoComplete="new-password" minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} required className={inputClass} />
          </div>
          <button type="submit" disabled={loading} className="btn-primary w-full py-3.5 text-base">
            {loading && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
            {loading ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </form>
      ) : sent ? (
        <p className="text-center text-gray-700 leading-relaxed" role="status">
          Si un compte existe pour <span className="font-semibold text-brand-navy break-all">{email.trim()}</span>, vous allez recevoir un e-mail avec un lien valable une heure.
        </p>
      ) : (
        <form onSubmit={requestLink} className="space-y-5">
          <div>
            <label htmlFor="email" className="flex items-center gap-2 text-sm font-semibold text-brand-navy mb-1">
              <Mail className="w-4 h-4" aria-hidden="true" />
              E-mail de votre compte
            </label>
            <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required className={inputClass} />
          </div>
          <button type="submit" disabled={loading} className="btn-primary w-full py-3.5 text-base">
            {loading && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
            {loading ? 'Envoi…' : 'Recevoir un lien'}
          </button>
        </form>
      )}
    </AuthShell>
  );
};

export default ResetPasswordPage;
