// Page d'accueil de l'utilisateur selon son rôle
export const homePathFor = (user) => {
  if (user?.role === 'seller') return '/seller/dashboard';
  if (user?.role === 'buyer') return '/buyer/dashboard';
  if (user?.role === 'admin') return '/admin/dashboard';
  return '/';
};

// Retour arrière sans quitter le site quand la page a été ouverte directement (lien email, favori…)
export const goBack = (navigate, fallback = '/') => {
  if (window.history.state && window.history.state.idx > 0) {
    navigate(-1);
  } else {
    navigate(fallback);
  }
};
