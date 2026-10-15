import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Database, FlaskConical, KeyRound, LayoutDashboard, Loader2, MailCheck, ShieldCheck, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { axiosInstance } from '@/App';
import { usePrivateSeo } from '@/lib/seo';
import { homePathFor } from '@/lib/navigation';
import { useTestMode } from '@/lib/testMode';
import AppLayout from '@/components/layout/AppLayout';
import { apiErrorMessage } from '@/components/account/errors';
import { BTN_PRIMARY, BTN_QUIET, BTN_SECONDARY } from '@/components/shared/buttonStyles';
import TestPanelSection from '@/components/test/TestPanelSection';
import TestInbox from '@/components/test/TestInbox';
import TestAdminTools from '@/components/test/TestAdminTools';
import {
  DEFAULT_DEMO_PASSWORD, DEMO_PERSONAS, confirmEmailNow, simulateIdentity, storeSession,
} from '@/components/test/testActions';

// Panneau du mode test (/test, MODE-TEST.md §3) : connexion rapide aux comptes de démonstration, création des
// données de démonstration, confirmation d'e-mail et identité simulées, boîte mail de test, outils admin.
// Hors mode test : message explicite (pas de 404) ; un administrateur garde la purge des données de test.

const PASSWORD_KEY = 'venteloc:test_demo_password';
const inputClass = 'w-full rounded-xl border border-brand-line bg-white px-3 py-2.5 text-brand-navy focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30';
const ROLE_LABEL = { seller: 'vendeur', buyer: 'acquéreur', admin: 'administrateur' };

const readPassword = () => {
  try {
    return sessionStorage.getItem(PASSWORD_KEY) || '';
  } catch (e) {
    return '';
  }
};

const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

// Résumé de POST /test/seed (contrat API : accounts_created / listings_created / listings_published, ou created.{users, listings})
export const seedSummary = (data) => {
  const d = data || {};
  const accounts = Number(d.accounts_created ?? d.created?.users) || 0;
  const listings = Number(d.listings_created ?? d.created?.listings) || 0;
  const parts = [];
  if (accounts > 0) parts.push(plural(accounts, 'compte créé', 'comptes créés'));
  if (listings > 0) parts.push(plural(listings, 'annonce créée', 'annonces créées'));
  if (parts.length) return `Démonstration prête : ${parts.join(' et ')}.`;
  return 'Démonstration déjà en place : comptes et annonces remis en état.';
};

const NotEnabled = ({ user, setUser }) => (
  <div className="space-y-6">
    <section className="card p-6 sm:p-8 text-center" data-testid="test-mode-disabled">
      <FlaskConical className="w-12 h-12 text-gray-300 mx-auto mb-3" aria-hidden="true" />
      <h1 className="font-display text-2xl font-bold text-brand-navy">Le mode test n'est pas activé</h1>
      <p className="text-gray-600 mt-2 max-w-xl mx-auto leading-relaxed">
        Ce panneau sert à essayer l'application sans vérification d'identité réelle ni envoi d'e-mails. Il n'est disponible que
        lorsque le serveur est lancé en mode test.
      </p>
      <Link to="/" className={`${BTN_PRIMARY} px-5 py-2.5 mt-5`}>Voir les annonces</Link>
    </section>
    {user?.role === 'admin' && <TestAdminTools user={user} setUser={setUser} testMode={false} />}
  </div>
);

const SEEDED_KEY = 'venteloc:test_demo_seeded';
const SCENARIOS_KEY = 'venteloc:test_scenarios_done';

const readSession = (key) => {
  try {
    return sessionStorage.getItem(key) || '';
  } catch (e) {
    return '';
  }
};
const writeSession = (key, value) => {
  try { sessionStorage.setItem(key, value); } catch (e) { /* stockage indisponible : l'état reste en mémoire */ }
};

// Parcours proposés à l'étape 3 : chacun se connecte au bon compte de démonstration puis ouvre la bonne page.
// `admin` : réservé à l'admin démo (affiché seulement si la connexion admin démo est permise).
export const TEST_SCENARIOS = [
  { key: 'contact', persona: 'acquereur', path: '/', title: 'Acquéreur : contacter un vendeur',
    text: 'Ouvrez une annonce puis « Présenter mon projet au vendeur » : le vendeur reçoit votre demande dans sa messagerie.' },
  { key: 'accept', persona: 'vendeur', path: '/messages', title: 'Vendeur : répondre et ouvrir le dossier du bien',
    text: 'Messages → acceptez la demande de l\'acquéreur, puis donnez-lui accès au dossier du bien.' },
  { key: 'nda', persona: 'acquereur', path: '/buyer/dashboard', title: 'Acquéreur : engagement de confidentialité et dossier',
    text: 'Signez l\'engagement de confidentialité et de non-contournement avec le code affiché à l\'écran, déclarez l\'origine des fonds, consultez le dossier et la fiche de reprise du bail.' },
  { key: 'offer', persona: 'acquereur', path: '/buyer/dashboard', title: 'Acquéreur : faire une offre d\'achat ; vendeur : l\'accepter',
    text: 'Depuis le dossier, « Faire une offre d\'achat » ; reconnectez-vous en vendeur démo pour l\'accepter avec le code affiché, puis suivez l\'étape de vente jusqu\'à l\'acte authentique.' },
  { key: 'listing', persona: null, path: '/register?role=seller', title: 'Vendeur : déposer une nouvelle annonce',
    text: 'Créez un compte vendeur, décrivez le bien et sa location, déposez un justificatif de propriété (n\'importe quel PDF), confirmez l\'e-mail et simulez l\'identité depuis le bandeau, signez le mandat avec le code affiché.' },
  { key: 'review', persona: 'admin', path: '/admin/dashboard', title: 'Admin : contrôler un justificatif de propriété', admin: true,
    text: '« À faire » → « Justificatifs de propriété à contrôler » : ouvrez le fichier, validez-le ou refusez-le avec un motif ; relisez aussi les annonces signalées.' },
];

const StepTitle = ({ n, done, children }) => (
  <span className="flex items-center gap-2">
    <span
      className={`inline-flex items-center justify-center w-7 h-7 shrink-0 rounded-full text-sm font-bold ${done ? 'bg-brand-teal text-white' : 'bg-brand-navy text-white'}`}
      aria-hidden="true"
    >
      {done ? <CheckCircle2 className="w-4 h-4" /> : n}
    </span>
    <span><span className="sr-only">{`Étape ${n}${done ? ' (faite)' : ''} : `}</span>{children}</span>
  </span>
);

// Étapes 1 à 3 du panneau : préparer la démonstration, choisir un rôle, suivre un scénario
const DemoSteps = ({ user, setUser, panelAdmin }) => {
  const navigate = useNavigate();
  const [busy, setBusy] = useState('');
  const [password, setPassword] = useState(readPassword);
  const [seeded, setSeeded] = useState(() => readSession(SEEDED_KEY) === '1');
  const [done, setDone] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(SCENARIOS_KEY) || '[]'));
    } catch (e) {
      return new Set();
    }
  });

  const seed = async ({ silent = false } = {}) => {
    const res = await axiosInstance.post('/test/seed');
    const pwd = res.data?.password;
    if (pwd) {
      setPassword(pwd);
      writeSession(PASSWORD_KEY, pwd);
    }
    setSeeded(true);
    writeSession(SEEDED_KEY, '1');
    if (!silent) toast.success(seedSummary(res.data));
    return res.data;
  };

  const runSeed = async () => {
    setBusy('seed');
    try {
      await seed();
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Les données de démonstration n\'ont pas pu être créées.'));
    } finally {
      setBusy('');
    }
  };

  // Connexion rapide ; comptes absents (404) : la démonstration est créée d'abord, puis la connexion réessayée
  const loginAs = async (persona, path) => {
    setBusy(persona);
    try {
      let res;
      try {
        res = await axiosInstance.post('/test/login-as', { persona });
      } catch (e) {
        if (e?.response?.status !== 404) throw e;
        toast.info('Création des comptes et annonces de démonstration…', { id: 'test-seed-auto' });
        await seed({ silent: true });
        res = await axiosInstance.post('/test/login-as', { persona });
      }
      const { token, user: account } = res.data || {};
      if (!token || !account) throw new Error('Réponse de connexion incomplète.');
      storeSession(token, account, setUser);
      toast.success(`Connecté en tant que ${account.email}.`);
      navigate(path || homePathFor(account));
    } catch (e) {
      toast.error(apiErrorMessage(e, 'La connexion rapide a échoué.'));
    } finally {
      setBusy('');
    }
  };

  const toggleDone = (key) => setDone((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    try { localStorage.setItem(SCENARIOS_KEY, JSON.stringify([...next])); } catch (e) { /* stockage indisponible */ }
    return next;
  });

  const personas = DEMO_PERSONAS.filter((p) => p.key !== 'admin' || panelAdmin);
  const scenarios = TEST_SCENARIOS.filter((sc) => !sc.admin || panelAdmin);
  const signedAs = (persona) => Boolean(persona) && user?.email === DEMO_PERSONAS.find((p) => p.key === persona)?.email;

  return (
    <>
      <section className="card p-5 sm:p-6 min-w-0" aria-labelledby="test-step-seed" data-testid="test-step-seed">
        <h2 id="test-step-seed" className="font-display text-lg font-bold text-brand-navy">
          <StepTitle n={1} done={seeded}>Préparer la démonstration</StepTitle>
        </h2>
        <p className="text-sm text-gray-600 mt-1 leading-relaxed">
          Trois comptes (vendeur, acquéreur, administrateur) et huit annonces de biens loués publiées et variées (studio, T2, T3,
          maison, immeuble, local commercial, parking, résidence étudiante), appartenant au vendeur démo, justificatifs de
          propriété validés. Sans risque si elles existent déjà : elles sont remises en état.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={runSeed}
            disabled={Boolean(busy)}
            className={`${seeded ? BTN_SECONDARY : BTN_PRIMARY} px-4 py-2.5 text-sm`}
            data-testid="test-seed"
          >
            {busy === 'seed' ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Database className="w-4 h-4" aria-hidden="true" />}
            {seeded ? 'Remettre la démonstration en état' : 'Créer les comptes et annonces de démonstration'}
          </button>
          {seeded && (
            <p className="flex items-center gap-1.5 text-sm text-brand-teal-dark" data-testid="test-seed-done">
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
              Démonstration prête.
            </p>
          )}
        </div>
      </section>

      <section className="card p-5 sm:p-6 min-w-0" aria-labelledby="test-quick-login" data-testid="test-quick-login">
        <h2 id="test-quick-login" className="font-display text-lg font-bold text-brand-navy">
          <StepTitle n={2} done={Boolean(user) && personas.some((p) => p.email === user.email)}>Choisir un rôle</StepTitle>
        </h2>
        <p className="text-sm text-gray-600 mt-1 leading-relaxed">
          Comptes de démonstration, e-mail confirmé et identité simulée. La connexion ouvre l'espace du rôle.
        </p>
        <div className={`mt-4 grid gap-3 ${personas.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
          {personas.map((p) => {
            const current = user?.email === p.email;
            return (
              <div
                key={p.key}
                className={`rounded-xl border p-3 min-w-0 flex flex-col ${current ? 'border-2 border-brand-teal bg-brand-teal-soft' : 'border-brand-line'}`}
                data-testid={`test-persona-${p.key}`}
              >
                <div className="flex items-center justify-between gap-2 min-w-0">
                  <p className="font-semibold text-brand-navy">{p.label}</p>
                  {current && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand-teal px-2 py-0.5 text-xs font-semibold text-white" data-testid="test-persona-current">
                      <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                      Connecté
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-600 mt-0.5 break-all">{p.email}</p>
                <p className="text-sm text-gray-500">{p.role}{p.hint ? ` · ${p.hint}` : ''}</p>
                <div className="mt-3">
                  {current ? (
                    <Link to={homePathFor(user)} className={`${BTN_SECONDARY} w-full px-3 py-2.5 text-sm`} data-testid={`test-open-${p.key}`}>
                      <LayoutDashboard className="w-4 h-4" aria-hidden="true" />
                      Ouvrir mon espace
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => loginAs(p.key)}
                      disabled={Boolean(busy)}
                      className={`${BTN_PRIMARY} w-full px-3 py-2.5 text-sm`}
                      data-testid={`test-login-${p.key}`}
                    >
                      {busy === p.key ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <UserRound className="w-4 h-4" aria-hidden="true" />}
                      Se connecter
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {!panelAdmin && (
          <p className="text-sm text-gray-600 mt-3" data-testid="test-admin-demo-closed">
            Admin démo indisponible : en production, il faut définir la clé du panneau (TEST_PANEL_KEY) et ouvrir l'application
            avec le lien qui la contient. Votre propre compte administrateur reste utilisable.
          </p>
        )}
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-gray-700 mt-3" data-testid="test-demo-password">
          <KeyRound className="w-4 h-4 text-gray-500" aria-hidden="true" />
          Mot de passe commun :
          <code className="font-mono font-semibold text-brand-navy break-all">{password || DEFAULT_DEMO_PASSWORD}</code>
        </p>
      </section>

      <section className="card p-5 sm:p-6 min-w-0" aria-labelledby="test-scenarios" data-testid="test-scenarios">
        <h2 id="test-scenarios" className="font-display text-lg font-bold text-brand-navy">
          <StepTitle n={3} done={scenarios.every((sc) => done.has(sc.key))}>Essayer les parcours</StepTitle>
        </h2>
        <p className="text-sm text-gray-600 mt-1 leading-relaxed">
          Dans cet ordre de préférence. « Commencer » vous connecte au bon compte et ouvre la bonne page ; cochez ce qui est fait.
        </p>
        <ol className="mt-4 space-y-3">
          {scenarios.map((sc, i) => {
            const checked = done.has(sc.key);
            const ready = !sc.persona || signedAs(sc.persona);
            return (
              <li key={sc.key} className="rounded-xl border border-brand-line p-3 min-w-0 flex flex-col sm:flex-row sm:items-start gap-3" data-testid={`test-scenario-${sc.key}`}>
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <input
                    id={`test-scenario-done-${sc.key}`}
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleDone(sc.key)}
                    aria-describedby={`test-scenario-text-${sc.key}`}
                    className="mt-1 h-4 w-4 shrink-0 rounded border-gray-300 text-brand-navy focus-visible:ring-2 focus-visible:ring-brand-blue"
                  />
                  <div className="min-w-0">
                    <label htmlFor={`test-scenario-done-${sc.key}`} className={`block font-semibold text-brand-navy cursor-pointer ${checked ? 'line-through decoration-brand-navy/40' : ''}`}>
                      {`${i + 1}. ${sc.title}`}
                    </label>
                    <p id={`test-scenario-text-${sc.key}`} className="text-sm text-gray-600 leading-relaxed">{sc.text}</p>
                  </div>
                </div>
                {ready ? (
                  <Link to={sc.path} className={`${BTN_QUIET} shrink-0 px-3 py-2 text-sm`} data-testid={`test-scenario-go-${sc.key}`}>
                    Commencer<ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => loginAs(sc.persona, sc.path)}
                    disabled={Boolean(busy)}
                    className={`${BTN_QUIET} shrink-0 px-3 py-2 text-sm`}
                    data-testid={`test-scenario-go-${sc.key}`}
                  >
                    {busy === sc.persona ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
                    Commencer<ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </section>
    </>
  );
};

// Panneau réservé (TEST_PANEL_KEY définie, clé absente ou fausse) : aucun outil, explication seulement
const Restricted = () => (
  <section className="card p-6 sm:p-8 text-center" data-testid="test-mode-restricted">
    <FlaskConical className="w-12 h-12 text-brand-amber mx-auto mb-3" aria-hidden="true" />
    <h1 className="font-display text-2xl font-bold text-brand-navy">Panneau de test réservé</h1>
    <p className="text-gray-600 mt-2 max-w-xl mx-auto leading-relaxed">
      L'application est en cours d'essai : les annonces affichées sont fictives et les documents sans valeur juridique. Ce
      panneau est réservé à l'équipe qui prépare l'essai ; ouvrez-le avec le lien qui vous a été communiqué.
    </p>
    <Link to="/" className={`${BTN_PRIMARY} px-5 py-2.5 mt-5`}>Voir les annonces</Link>
  </section>
);

const birthDateOf = (user) => {
  const raw = user?.verified_birth_date || user?.birth_date || '';
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : '';
};

const AccountTools = ({ user, setUser }) => {
  const [confirming, setConfirming] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [identity, setIdentity] = useState({ first_name: '', last_name: '', birth_date: '' });

  useEffect(() => {
    setIdentity({ first_name: user?.first_name || '', last_name: user?.last_name || '', birth_date: birthDateOf(user) });
  }, [user?.id]); // préremplissage au changement de compte seulement : la saisie en cours n'est pas écrasée

  const emailVerified = user?.email_verified !== false;
  const identityVerified = user?.identity_verified === true;

  const confirmEmail = async () => {
    setConfirming(true);
    try {
      const { data } = await confirmEmailNow(setUser);
      toast.success(data.already_verified ? 'Votre adresse était déjà confirmée.' : 'Adresse e-mail confirmée (mode test).');
    } catch (e) {
      toast.error(apiErrorMessage(e, 'L\'adresse n\'a pas pu être confirmée.'));
    } finally {
      setConfirming(false);
    }
  };

  const simulate = async (e) => {
    e.preventDefault();
    setSimulating(true);
    try {
      await simulateIdentity(identity, setUser);
      toast.success('Identité vérifiée (simulation) : les étapes qui l\'attendaient sont débloquées.');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'La vérification simulée a échoué.'));
    } finally {
      setSimulating(false);
    }
  };

  const set = (field) => (e) => setIdentity((v) => ({ ...v, [field]: e.target.value }));

  return (
    <TestPanelSection
      id="test-account"
      title="Mon compte"
      icon={ShieldCheck}
      intro={`Connecté en tant que ${user.email}${ROLE_LABEL[user.role] ? ` (${ROLE_LABEL[user.role]})` : ''}.`}
      testId="test-account"
    >
      <div className="grid gap-6 md:grid-cols-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-brand-navy flex items-center gap-2">
            <MailCheck className="w-4 h-4" aria-hidden="true" />
            Adresse e-mail
          </h3>
          {emailVerified ? (
            <p className="flex items-center gap-2 text-sm text-brand-green-dark mt-2" data-testid="test-email-ok">
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
              Adresse confirmée.
            </p>
          ) : (
            <>
              <p className="text-sm text-gray-600 mt-1">Sans attendre l'e-mail de confirmation.</p>
              <button type="button" onClick={confirmEmail} disabled={confirming} className={`${BTN_PRIMARY} px-4 py-2.5 text-sm mt-2`} data-testid="test-confirm-email">
                {confirming && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                Confirmer mon e-mail
              </button>
            </>
          )}
        </div>

        <div className="min-w-0">
          <h3 className="font-semibold text-brand-navy flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" aria-hidden="true" />
            Identité
          </h3>
          {identityVerified && (
            <p className="flex items-center gap-2 text-sm text-brand-green-dark mt-2" data-testid="test-identity-ok">
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
              Identité vérifiée{user.kyc_provider === 'test' ? ' (simulation)' : ''}.
            </p>
          )}
          <form onSubmit={simulate} className="mt-2 space-y-3" data-testid="test-identity-form">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="min-w-0">
                <label htmlFor="test-first-name" className="block text-sm font-medium text-gray-700 mb-1">Prénom</label>
                <input id="test-first-name" value={identity.first_name} onChange={set('first_name')} autoComplete="given-name" className={inputClass} required />
              </div>
              <div className="min-w-0">
                <label htmlFor="test-last-name" className="block text-sm font-medium text-gray-700 mb-1">Nom</label>
                <input id="test-last-name" value={identity.last_name} onChange={set('last_name')} autoComplete="family-name" className={inputClass} required />
              </div>
            </div>
            <div className="sm:w-1/2 min-w-0">
              <label htmlFor="test-birth-date" className="block text-sm font-medium text-gray-700 mb-1">Date de naissance</label>
              <input id="test-birth-date" type="date" value={identity.birth_date} onChange={set('birth_date')} autoComplete="bday" className={inputClass} />
            </div>
            <button type="submit" disabled={simulating} className={`${identityVerified ? BTN_SECONDARY : BTN_PRIMARY} px-4 py-2.5 text-sm`} data-testid="test-simulate-identity">
              {simulating && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
              {identityVerified ? 'Simuler à nouveau' : 'Simuler ma vérification d\'identité'}
            </button>
            <p className="text-sm text-gray-600">
              Comme si vous aviez passé la vérification d'identité : le mandat peut être signé, l'engagement de confidentialité
              aussi, et les étapes bloquées s'ouvrent.
            </p>
          </form>
        </div>
      </div>
    </TestPanelSection>
  );
};

const TestModePage = ({ user, setUser }) => {
  usePrivateSeo('Panneau de test');
  const { testMode, loading, panelAccess, panelAdmin } = useTestMode();

  let body;
  if (loading) {
    body = (
      <div className="flex justify-center py-16" role="status" aria-label="Chargement">
        <Loader2 className="w-8 h-8 animate-spin text-brand-navy" aria-hidden="true" />
      </div>
    );
  } else if (!testMode) {
    body = <NotEnabled user={user} setUser={setUser} />;
  } else if (!panelAccess) {
    body = <Restricted />;
  } else {
    body = (
      <div className="space-y-6" data-testid="test-mode-page">
        <header>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-brand-navy flex items-center gap-2">
            <FlaskConical className="w-7 h-7 shrink-0 text-brand-amber" aria-hidden="true" />
            Panneau de test
          </h1>
          <p className="text-gray-600 mt-2 leading-relaxed max-w-3xl">
            Essayez tous les parcours sans vérifier votre identité ni attendre d'e-mail. Les e-mails arrivent dans la boîte
            ci-dessous, les mandats sont numérotés « TEST » et chaque document porte la mention « sans valeur juridique ».
          </p>
        </header>
        <DemoSteps user={user} setUser={setUser} panelAdmin={panelAdmin} />
        {user ? (
          <>
            <AccountTools user={user} setUser={setUser} />
            <TestInbox user={user} />
            {user.role === 'admin' && <TestAdminTools user={user} setUser={setUser} testMode />}
          </>
        ) : (
          <p className="card p-5 text-sm text-gray-700" data-testid="test-signed-out">
            Connectez-vous (étape 2 ci-dessus ou <Link to="/login?redirect=/test" className="font-semibold text-brand-navy underline underline-offset-2">votre compte</Link>)
            pour confirmer votre adresse, simuler votre identité et lire vos e-mails de test.
          </p>
        )}
      </div>
    );
  }

  return (
    <AppLayout user={user} setUser={setUser} className="bg-brand-surface">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-10 min-w-0">{body}</div>
    </AppLayout>
  );
};

export default TestModePage;
