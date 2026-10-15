import { axiosInstance } from '@/App';

// Appels du mode test partagés par le panneau /test et les raccourcis des parcours (MODE-TEST.md §2-3).
// Après une action qui change le compte, l'utilisateur est relu et rangé comme après une connexion (localStorage
// « user » + setUser), pour que l'en-tête, les bandeaux et les gardes voient tout de suite le nouvel état.

// Personas de démonstration (SPEC §10, API.md §11) : POST /test/login-as {persona}
export const DEMO_PERSONAS = [
  { key: 'vendeur', label: 'Vendeur démo', email: 'vendeur.demo@test.local', role: 'Vendeur', hint: 'Propriétaire des 8 annonces de démonstration' },
  { key: 'acquereur', label: 'Acquéreur démo', email: 'acquereur.demo@test.local', role: 'Acquéreur', hint: 'Investisseur au profil complet' },
  { key: 'admin', label: 'Admin démo', email: 'admin.demo@test.local', role: 'Administration', hint: 'Relecture, justificatifs, ventes' },
];

// Mot de passe par défaut des comptes de démonstration (TEST_DEMO_PASSWORD côté serveur) ; le panneau affiche celui
// renvoyé par POST /test/seed dès qu'il est connu.
export const DEFAULT_DEMO_PASSWORD = 'Demo-2026!';

export const storeUser = (user, setUser) => {
  if (!user || typeof user !== 'object') return user;
  try {
    localStorage.setItem('user', JSON.stringify(user));
  } catch (e) {
    // stockage indisponible (navigation privée stricte) : l'état en mémoire suffit pour cette visite
  }
  if (typeof setUser === 'function') setUser(user);
  return user;
};

// Connexion comme LoginPage : jeton et compte dans localStorage, puis setUser
export const storeSession = (token, user, setUser) => {
  try {
    localStorage.setItem('token', token);
  } catch (e) {
    // stockage indisponible : la session ne survivra pas au rechargement
  }
  return storeUser(user, setUser);
};

export const refreshUser = async (setUser) => {
  const res = await axiosInstance.get('/auth/profile');
  return storeUser(res.data, setUser);
};

// Profil complet relu sur /auth/profile (même lecture qu'après le retour de Stripe Identity) ; à défaut, le compte
// renvoyé par la route s'il y en a un
const userFrom = async (data, setUser) => {
  try {
    return await refreshUser(setUser);
  } catch (e) {
    if (data && data.user && typeof data.user === 'object') return storeUser(data.user, setUser);
    throw e;
  }
};

// POST /test/identity/simulate {first_name?, last_name?, birth_date?} → mêmes effets que Stripe Identity
export const simulateIdentity = async (body, setUser) => {
  const payload = {};
  Object.entries(body || {}).forEach(([k, v]) => {
    const clean = typeof v === 'string' ? v.trim() : v;
    if (clean) payload[k] = clean;
  });
  const res = await axiosInstance.post('/test/identity/simulate', payload);
  const user = await userFrom(res.data, setUser);
  return { data: res.data || {}, user };
};

// POST /test/confirm-email → adresse du compte connecté confirmée
export const confirmEmailNow = async (setUser) => {
  const res = await axiosInstance.post('/test/confirm-email');
  const user = await userFrom(res.data, setUser);
  return { data: res.data || {}, user };
};
