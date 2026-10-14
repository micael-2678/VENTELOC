import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { Loader2, Lock, Mail, MailCheck, Phone, User, Megaphone } from 'lucide-react';
import { toast } from 'sonner';
import { axiosInstance } from '@/App';
import { useSeo, NOINDEX } from '@/lib/seo';
import { OFFER } from '@/lib/offer';
import { BRAND } from '@/lib/brand';
import { homePathFor } from '@/lib/navigation';
import { trackEvent } from '@/lib/analytics';
import AuthShell from '@/components/account/AuthShell';
import ChoiceGroup from '@/components/account/ChoiceGroup';
import BuyerProfileFields from '@/components/account/BuyerProfileFields';
import ScoreMeter from '@/components/account/ScoreMeter';
import { apiErrorMessage } from '@/components/account/errors';
import { computeProfileScore, buyerProfilePayload, EMPTY_BUYER_PROFILE } from '@/components/account/profileScore';

// Inscription (SPEC §4, API.md §1) : ?role=seller|buyer présélectionne le profil.
// Vendeur : prénom, nom, e-mail, mot de passe, téléphone (le SIRET n'est demandé que dans l'annonce, si le bien
// appartient à une société). Acquéreur : un seul écran avec le profil d'investisseur et le score de complétude.
// Après inscription : « Vérifiez votre boîte mail » (double opt-in), puis accès à l'espace.

const ACQUISITION_SOURCES = [
  { value: 'google', label: 'Recherche Google' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'bouche_a_oreille', label: 'Bouche-à-oreille' },
  { value: 'notaire_conseil', label: 'Notaire, conseiller en gestion de patrimoine' },
  { value: 'forum_investisseurs', label: 'Forum ou réseau d\'investisseurs' },
  { value: 'presse', label: 'Presse' },
  { value: 'autre', label: 'Autre' },
];

const ROLE_OPTIONS = [
  { value: 'seller', label: 'Je vends un bien loué', hint: 'Annonce sans adresse exacte, rien à payer avant l\'acte chez le notaire, mandat simple résiliable à tout moment.' },
  { value: 'buyer', label: 'Je cherche un investissement locatif', hint: 'Contact gratuit ; identité vérifiée seulement avant l\'engagement de confidentialité.' },
];

// France (0X XX XX XX XX ou +33) ; Belgique, Suisse et Luxembourg au format international (+32, +41, +352)
export const PHONE_RE = /^(?:(?:\+33\s?|0)[1-9](?:[\s.-]?\d{2}){4}|\+(?:32|41|352)(?:[\s.-]?\d){6,12})$/;
const inputClass = 'w-full rounded-xl border border-brand-line bg-white px-4 py-3 text-brand-navy focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30';

const readEstimate = () => {
  try {
    const raw = sessionStorage.getItem('estimate');
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
};

const Field = ({ id, label, icon: Icon, children, hint, required }) => (
  <div className="min-w-0">
    <label htmlFor={id} className="flex items-center gap-2 text-sm font-semibold text-brand-navy mb-1">
      {Icon && <Icon className="w-4 h-4" aria-hidden="true" />}
      <span>{label}{required ? ' *' : ''}</span>
    </label>
    {children}
    {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
  </div>
);

// Compte connecté stocké dans le navigateur (jeton et compte), sinon null
const storedSessionUser = () => {
  try {
    if (!localStorage.getItem('token')) return null;
    const saved = JSON.parse(localStorage.getItem('user') || 'null');
    return saved && saved.role ? saved : null;
  } catch (e) {
    return null;
  }
};

const RegisterPage = ({ setUser }) => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const rawRedirect = searchParams.get('redirect');
  const redirect = rawRedirect && rawRedirect.startsWith('/') && !rawRedirect.startsWith('//') ? rawRedirect : null;
  const roleParam = searchParams.get('role');
  const estimate = useMemo(readEstimate, []);

  const [role, setRole] = useState(roleParam === 'seller' || roleParam === 'buyer' ? roleParam : '');
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: searchParams.get('email') || '',
    password: '',
    phone: '',
    source: '',
  });
  const [profile, setProfile] = useState(EMPTY_BUYER_PROFILE);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState(null); // {user} après inscription
  const startedRef = useRef(false);

  useSeo(`Créer un compte – ${BRAND.name}`, OFFER.metaSignup, { robots: NOINDEX });

  // Déjà connecté en arrivant (lien « Déposer mon annonce » suivi depuis un compte acquéreur, par exemple) : retour à
  // son espace, sans formulaire qui remplacerait la session en cours par un nouveau compte
  useEffect(() => {
    const signedIn = storedSessionUser();
    if (signedIn) {
      toast.info('Vous êtes déjà connecté. Pour créer un autre compte, déconnectez-vous d\'abord.', { id: 'already-signed-in' });
      navigate(homePathFor(signedIn), { replace: true });
    }
  }, [navigate]); // navigate est stable : vérification à l'arrivée seulement

  useEffect(() => {
    if (roleParam === 'seller' || roleParam === 'buyer') setRole(roleParam);
  }, [roleParam]);

  const markStarted = () => {
    if (startedRef.current) return;
    startedRef.current = true;
    trackEvent('register_started', { role: role || 'unknown', from_estimate: !!estimate });
  };

  const setField = (key, value) => {
    markStarted();
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const score = useMemo(() => computeProfileScore(profile, form.phone), [profile, form.phone]);

  const validate = () => {
    const next = {};
    if (!role) next.role = 'Choisissez votre profil.';
    if (!form.first_name.trim()) next.first_name = 'Indiquez votre prénom.';
    if (!form.last_name.trim()) next.last_name = 'Indiquez votre nom.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) next.email = 'Indiquez une adresse e-mail valide.';
    if (form.password.length < 8) next.password = 'Le mot de passe doit contenir au moins 8 caractères.';
    if (!PHONE_RE.test(form.phone.trim())) next.phone = 'Indiquez un numéro de téléphone (10 chiffres en France, ou +32, +41, +352).';
    if (role === 'buyer') {
      if (!profile.project_type) next.project_type = 'Indiquez le type de votre projet.';
      if (!(Number(profile.budget_max) > 0)) next.budget_max = 'Indiquez un budget maximum.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) {
      toast.error('Vérifiez les champs signalés.');
      return;
    }
    setLoading(true);
    const payload = {
      email: form.email.trim().toLowerCase(),
      password: form.password,
      role,
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      phone: form.phone.trim(),
    };
    if (form.source) payload.source = form.source;
    if (role === 'buyer') {
      payload.buyer_profile = buyerProfilePayload(profile);
      if (payload.buyer_profile.company_name) payload.company_name = payload.buyer_profile.company_name;
    }
    try {
      const response = await axiosInstance.post('/auth/register', payload);
      const user = { email_verified: false, ...response.data.user };
      localStorage.setItem('token', response.data.token);
      localStorage.setItem('user', JSON.stringify(user));
      setUser(user);
      trackEvent('register_completed', { role, profile_score: role === 'buyer' ? (user.profile_score ?? score.score) : undefined, from_estimate: !!estimate });
      setCreated({ user });
      window.scrollTo({ top: 0 });
    } catch (error) {
      toast.error(apiErrorMessage(error, "L'inscription n'a pas pu aboutir. Vérifiez les champs puis réessayez."));
    } finally {
      setLoading(false);
    }
  };

  // ---- Écran après inscription : « Vérifiez votre boîte mail »
  if (created) {
    const { user } = created;
    const finalScore = Number.isFinite(Number(user.profile_score)) ? Number(user.profile_score) : score.score;
    const next = redirect || (role === 'seller' && estimate ? '/seller/create' : homePathFor(user));
    return (
      <AuthShell title="Vérifiez votre boîte mail" width="max-w-lg" testId="register-done">
        <div className="space-y-5 text-center">
          <MailCheck className="w-14 h-14 text-brand-navy mx-auto" aria-hidden="true" />
          <p className="text-gray-700 leading-relaxed">
            Nous venons d'envoyer un lien de confirmation à <span className="font-semibold text-brand-navy break-all">{user.email}</span>.
            Cliquez dessus pour activer votre compte : sans cette confirmation, vous ne pouvez ni contacter, ni créer d'alerte, ni signer, ni publier.
            Pas reçu ? Regardez vos courriers indésirables ; vous pourrez le renvoyer depuis votre espace.
          </p>
          {role === 'buyer' && <ScoreMeter score={finalScore} missing={score.missing} className="text-left" />}
          {role === 'seller' && estimate && (
            <p className="text-sm text-gray-700 rounded-xl bg-brand-surface border border-brand-line p-3">
              Votre estimation est conservée : elle préremplit votre annonce.
            </p>
          )}
          <button type="button" onClick={() => navigate(next)} className="btn-primary w-full py-3.5 text-base" data-testid="register-continue">
            {role === 'seller' && estimate && !redirect ? 'Déposer mon annonce' : 'Accéder à mon espace'}
          </button>
        </div>
      </AuthShell>
    );
  }

  const subtitle = role === 'seller'
    ? 'L\'adresse exacte du bien et votre nom ne sont révélés qu\'aux acquéreurs vérifiés qui ont signé un engagement de confidentialité.'
    : role === 'buyer'
      ? 'Un seul écran : vos coordonnées et votre projet d\'investissement. C\'est ce projet que les vendeurs verront, sans votre nom.'
      : `Vendez votre bien loué ou investissez dans un bien déjà loué sur ${BRAND.name}.`;

  return (
    <AuthShell
      title="Créer un compte"
      subtitle={subtitle}
      width={role === 'buyer' ? 'max-w-3xl' : 'max-w-2xl'}
      testId="register-page"
      footer={(
        <p>
          Déjà un compte ?{' '}
          <Link to={redirect ? `/login?redirect=${encodeURIComponent(redirect)}` : '/login'} className="text-brand-navy font-semibold hover:underline">
            Se connecter
          </Link>
        </p>
      )}
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-7" data-testid="register-form">
        <ChoiceGroup
          legend="Je suis"
          name="role"
          options={ROLE_OPTIONS}
          value={role}
          onChange={(v) => { markStarted(); setRole(v); setErrors((e) => ({ ...e, role: undefined })); }}
          columns={2}
          required
          error={errors.role}
          testId="register-role"
        />

        {role && (
          <>
            <section aria-labelledby="register-identity-title" className="space-y-4">
              <h2 id="register-identity-title" className="font-display text-lg font-bold text-brand-navy">Vos coordonnées</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field id="first_name" label="Prénom" icon={User} required>
                  <input id="first_name" data-testid="register-first-name-input" autoComplete="given-name" value={form.first_name} onChange={(e) => setField('first_name', e.target.value)} required className={inputClass} aria-invalid={!!errors.first_name} />
                  {errors.first_name && <p role="alert" className="text-sm text-red-700 mt-1">{errors.first_name}</p>}
                </Field>
                <Field id="last_name" label="Nom" icon={User} required>
                  <input id="last_name" data-testid="register-last-name-input" autoComplete="family-name" value={form.last_name} onChange={(e) => setField('last_name', e.target.value)} required className={inputClass} aria-invalid={!!errors.last_name} />
                  {errors.last_name && <p role="alert" className="text-sm text-red-700 mt-1">{errors.last_name}</p>}
                </Field>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field id="email" label="E-mail" icon={Mail} required hint="Un lien de confirmation vous sera envoyé.">
                  <input id="email" type="email" data-testid="register-email-input" autoComplete="email" value={form.email} onChange={(e) => setField('email', e.target.value)} required className={inputClass} aria-invalid={!!errors.email} />
                  {errors.email && <p role="alert" className="text-sm text-red-700 mt-1">{errors.email}</p>}
                </Field>
                <Field id="password" label="Mot de passe" icon={Lock} required hint="8 caractères minimum.">
                  <input id="password" type="password" data-testid="register-password-input" autoComplete="new-password" minLength={8} value={form.password} onChange={(e) => setField('password', e.target.value)} required className={inputClass} aria-invalid={!!errors.password} />
                  {errors.password && <p role="alert" className="text-sm text-red-700 mt-1">{errors.password}</p>}
                </Field>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field id="phone" label="Téléphone" icon={Phone} required hint={role === 'buyer' ? 'Jamais affiché avant l\'engagement de confidentialité ; compte pour 10 % du profil.' : 'Jamais affiché sur l\'annonce.'}>
                  <input id="phone" type="tel" data-testid="register-phone-input" autoComplete="tel" placeholder="06 12 34 56 78" value={form.phone} onChange={(e) => setField('phone', e.target.value)} required className={inputClass} aria-invalid={!!errors.phone} />
                  {errors.phone && <p role="alert" className="text-sm text-red-700 mt-1">{errors.phone}</p>}
                </Field>
                <Field id="source" label="Comment nous avez-vous connus ?" icon={Megaphone} hint="Facultatif.">
                  <select id="source" data-testid="register-source-select" value={form.source} onChange={(e) => setField('source', e.target.value)} className={inputClass}>
                    <option value="">Sélectionnez une réponse</option>
                    {ACQUISITION_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </Field>
              </div>
            </section>

            {role === 'seller' && (
              <section aria-labelledby="register-seller-title" className="space-y-3" data-testid="register-seller-info">
                <h2 id="register-seller-title" className="font-display text-lg font-bold text-brand-navy">Votre bien</h2>
                <p className="text-sm text-gray-700 leading-relaxed">
                  Vous décrirez le bien et sa location juste après l'inscription. Si le bien appartient à une SCI ou à une société,
                  sa dénomination et son SIRET vous seront demandés dans l'annonce ; ils restent confidentiels.
                </p>
                {estimate && (estimate.low || estimate.high) && (
                  <p className="text-sm text-gray-700 rounded-xl bg-brand-surface border border-brand-line p-3">
                    Votre estimation (de {Number(estimate.low).toLocaleString('fr-FR')} € à {Number(estimate.high).toLocaleString('fr-FR')} €) sera reprise dans votre annonce.
                  </p>
                )}
                <p className="text-sm text-gray-600 leading-relaxed" data-testid="register-seller-offer">{OFFER.sellerRegisterNote}</p>
              </section>
            )}

            {role === 'buyer' && (
              <section aria-labelledby="register-project-title" className="space-y-5">
                <div>
                  <h2 id="register-project-title" className="font-display text-lg font-bold text-brand-navy">Votre projet d'investissement</h2>
                  <p className="text-sm text-gray-600 mt-1 leading-relaxed">
                    Les vendeurs voient une carte acquéreur sans votre nom : type d'achat, budget, financement, biens et zones recherchés, rendement visé, horizon. Plus elle est complète, plus vite ils répondent.
                  </p>
                </div>
                <BuyerProfileFields value={profile} onChange={(p) => { markStarted(); setProfile(p); setErrors((e) => ({ ...e, project_type: undefined, budget_max: undefined })); }} errors={errors} />
                <ScoreMeter score={score.score} missing={score.missing} />
              </section>
            )}

            <div className="space-y-4">
              <button type="submit" data-testid="register-submit-btn" disabled={loading} className="btn-primary w-full py-3.5 text-base">
                {loading && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                {loading ? 'Création…' : 'Créer mon compte'}
              </button>
              <p className="text-center text-xs text-gray-500 leading-relaxed" data-testid="register-privacy-consent">
                En créant un compte, vous acceptez les <Link to="/cgu" className="underline hover:text-brand-navy">conditions d'utilisation</Link> et le traitement de vos données décrit dans la{' '}
                <Link to="/confidentialite" className="underline hover:text-brand-navy">politique de confidentialité</Link>
                {' '}(voir aussi les <Link to="/mentions-legales" className="underline hover:text-brand-navy">mentions légales</Link>).
              </p>
            </div>
          </>
        )}
      </form>
    </AuthShell>
  );
};

export default RegisterPage;
