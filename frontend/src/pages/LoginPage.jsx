import { useEffect, useRef, useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { FlaskConical, Loader2, Lock, Mail, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { axiosInstance } from '@/App';
import { usePrivateSeo } from '@/lib/seo';
import { BRAND } from '@/lib/brand';
import { homePathFor } from '@/lib/navigation';
import AuthShell from '@/components/account/AuthShell';
import { apiErrorMessage } from '@/components/account/errors';

// Connexion : POST /auth/login → {token, user} ou {otp_required:true, email} (administrateur : second facteur,
// code reçu par e-mail puis POST /auth/login/verify {email, code}).
// Mode test (MODE-TEST-ET-APP.md §B.2.2) : la réponse contient aussi `test_code` (jamais hors mode test) ; il est
// affiché et prérempli pour se connecter sans boîte mail.

// Code en clair renvoyé par le serveur en mode test seulement (chiffres uniquement)
const testCodeOf = (data) => {
  const raw = data && data.test_code != null ? String(data.test_code).replace(/\D/g, '').slice(0, 8) : '';
  return raw.length >= 4 ? raw : '';
};

const inputClass = 'w-full rounded-xl border border-brand-line bg-white px-4 py-3 text-brand-navy focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30';

const LoginPage = ({ setUser }) => {
  usePrivateSeo('Connexion');
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [otp, setOtp] = useState(null); // { email, expires_in, test_code? } quand un code est attendu
  const [code, setCode] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const codeRef = useRef(null);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // N'accepter que des chemins internes (évite les redirections ouvertes)
  const rawRedirect = searchParams.get('redirect');
  const redirect = rawRedirect && rawRedirect.startsWith('/') && !rawRedirect.startsWith('//') ? rawRedirect : null;

  useEffect(() => {
    if (otp && codeRef.current) codeRef.current.focus();
  }, [otp]);

  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const t = window.setTimeout(() => setResendIn((v) => v - 1), 1000);
    return () => window.clearTimeout(t);
  }, [resendIn]);

  const finishLogin = (data) => {
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    setUser(data.user);
    toast.success('Connexion réussie.');
    navigate(redirect || homePathFor(data.user));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const response = await axiosInstance.post('/auth/login', { email: formData.email.trim(), password: formData.password });
      if (response.data?.otp_required) {
        const testCode = testCodeOf(response.data);
        setOtp({ email: response.data.email || formData.email.trim(), expires_in: response.data.expires_in || 600, test_code: testCode });
        setCode(testCode);
        setResendIn(testCode ? 0 : 60);
        return;
      }
      finishLogin(response.data);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'E-mail ou mot de passe incorrect'));
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    const clean = code.replace(/\s/g, '');
    if (clean.length < 4) {
      toast.error('Saisissez le code reçu par e-mail.');
      return;
    }
    setLoading(true);
    try {
      const response = await axiosInstance.post('/auth/login/verify', { email: otp.email, code: clean });
      finishLogin(response.data);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Code invalide ou expiré'));
    } finally {
      setLoading(false);
    }
  };

  // Nouveau code : rejouer la connexion (le serveur n'en renvoie pas un nouveau avant une minute)
  const resendCode = async () => {
    if (resendIn > 0 || loading) return;
    setLoading(true);
    try {
      const response = await axiosInstance.post('/auth/login', { email: otp.email, password: formData.password });
      if (response.data?.otp_required) {
        const testCode = testCodeOf(response.data);
        if (testCode) {
          setOtp((v) => ({ ...v, test_code: testCode }));
          setCode(testCode);
          toast.success('Nouveau code émis (mode test).');
          return;
        }
        setResendIn(60);
        toast.success(response.data.resent === false ? 'Le code précédent est toujours valable (vérifiez vos courriers indésirables).' : 'Nouveau code envoyé.');
      } else {
        finishLogin(response.data);
      }
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Impossible de renvoyer un code pour le moment'));
    } finally {
      setLoading(false);
    }
  };

  if (otp) {
    return (
      <AuthShell
        title="Code de connexion"
        subtitle={`Un code à usage unique vient d'être envoyé à ${otp.email}. Il est valable ${Math.round(otp.expires_in / 60)} minutes.`}
        testId="login-otp"
        footer={<button type="button" onClick={() => setOtp(null)} className="btn-link text-sm">Revenir à la connexion</button>}
      >
        <form onSubmit={handleVerify} className="space-y-5" data-testid="login-otp-form">
          {otp.test_code && (
            <p className="flex items-start gap-2 rounded-xl border border-brand-amber/40 bg-brand-amber-soft px-3 py-2 text-sm text-brand-navy" data-testid="login-otp-test-code">
              <FlaskConical className="w-4 h-4 mt-0.5 shrink-0 text-brand-amber" aria-hidden="true" />
              <span>Code (mode test) : <strong className="font-mono tracking-widest">{otp.test_code}</strong>, déjà saisi ci-dessous.</span>
            </p>
          )}
          <div>
            <label htmlFor="login-otp-code" className="flex items-center gap-2 text-sm font-semibold text-brand-navy mb-1">
              <ShieldCheck className="w-4 h-4" aria-hidden="true" />
              Code reçu par e-mail
            </label>
            <input
              id="login-otp-code"
              ref={codeRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]*"
              maxLength={12}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, '').slice(0, 8))}
              required
              className={`${inputClass} text-center text-2xl tracking-[0.4em] tabular`}
              data-testid="login-otp-input"
            />
            <p className="text-xs text-gray-500 mt-1">Le code n'est jamais indiqué dans l'objet de l'e-mail : ouvrez le message.</p>
          </div>
          <button type="submit" disabled={loading} className="btn-primary w-full py-3.5 text-base" data-testid="login-otp-submit">
            {loading && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
            Valider le code
          </button>
          <p className="text-center text-sm text-gray-600">
            Pas reçu ?{' '}
            <button type="button" onClick={resendCode} disabled={resendIn > 0 || loading} className="btn-link text-sm disabled:opacity-60 disabled:no-underline">
              {resendIn > 0 ? `Renvoyer un code dans ${resendIn} s` : 'Renvoyer un code'}
            </button>
          </p>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Connexion"
      subtitle={`Accédez à votre espace ${BRAND.name}`}
      testId="login-page"
      footer={(
        <p>
          Pas encore de compte ?{' '}
          <Link to={redirect ? `/register?redirect=${encodeURIComponent(redirect)}` : '/register'} className="text-brand-navy font-semibold hover:underline">
            S'inscrire
          </Link>
        </p>
      )}
    >
      <form onSubmit={handleSubmit} className="space-y-5" data-testid="login-form">
        <div>
          <label htmlFor="email" className="flex items-center gap-2 text-sm font-semibold text-brand-navy mb-1">
            <Mail className="w-4 h-4" aria-hidden="true" />
            E-mail
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            data-testid="login-email-input"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            required
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="password" className="flex items-center gap-2 text-sm font-semibold text-brand-navy mb-1">
            <Lock className="w-4 h-4" aria-hidden="true" />
            Mot de passe
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            data-testid="login-password-input"
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            required
            className={inputClass}
          />
        </div>

        <button type="submit" data-testid="login-submit-btn" disabled={loading} className="btn-primary w-full py-3.5 text-base">
          {loading && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
          {loading ? 'Connexion…' : 'Se connecter'}
        </button>

        <p className="text-center">
          <Link to="/mot-de-passe-oublie" className="text-sm text-gray-600 hover:underline">Mot de passe oublié ?</Link>
        </p>
      </form>
    </AuthShell>
  );
};

export default LoginPage;
