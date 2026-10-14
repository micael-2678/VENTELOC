import { createContext, useContext } from 'react';

// Session de l'application ({ user, setUser }) fournie par App.js : l'en-tête commun (AppHeader) connaît l'utilisateur
// et peut le déconnecter sur n'importe quelle page, sans que chaque page lui transmette ces propriétés.
export const SessionContext = createContext({ user: null, setUser: null });

export const useSession = () => useContext(SessionContext);

// Déconnexion locale : jeton et compte retirés du navigateur
export const clearStoredSession = () => {
  try {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  } catch (e) {
    // stockage indisponible (navigation privée stricte) : rien à effacer
  }
};
