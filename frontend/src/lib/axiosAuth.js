// Session expirée ou révoquée (401 de l'API) : page de connexion avec retour à la page en cours.
// LoginPage n'accepte que les chemins internes dans ?redirect= (pas de redirection ouverte).
export const loginRedirectPath = (location) => {
  const here = `${location?.pathname || '/'}${location?.search || ''}`;
  if (!here.startsWith('/') || here.startsWith('//') || here === '/' || here.startsWith('/login')) return '/login';
  return `/login?redirect=${encodeURIComponent(here)}`;
};
