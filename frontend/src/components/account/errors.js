// Lecture uniforme des erreurs de l'API (docs/venteloc/API.md) : les routes nouvelles renvoient
// `detail` sous la forme {code, message}, les anciennes une chaîne, la validation FastAPI un tableau.

export const apiErrorCode = (error) => {
  const detail = error?.response?.data?.detail;
  if (detail && typeof detail === 'object' && !Array.isArray(detail) && detail.code) return String(detail.code);
  return '';
};

export const apiErrorMessage = (error, fallback = 'Une erreur est survenue. Réessayez dans quelques instants.') => {
  if (!error) return fallback;
  if (!error.response) {
    if (error.request) return 'Connexion impossible. Vérifiez votre réseau puis réessayez.';
    return error.message || fallback;
  }
  const { status, data } = error.response;
  const detail = data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (detail && typeof detail === 'object' && !Array.isArray(detail) && detail.message) return String(detail.message);
  if (Array.isArray(detail)) {
    const msgs = detail.map((d) => d?.msg || '').filter(Boolean);
    if (msgs.length) return msgs.join(' ');
  }
  if (status === 429) return 'Trop de demandes pour le moment. Patientez une minute puis réessayez.';
  if (status >= 500) return 'Le service est momentanément indisponible. Réessayez dans quelques instants.';
  return fallback;
};

// 403 « e-mail non confirmé » : detail {code:'email_not_verified'} ou texte commençant par « Confirmez d'abord »
export const isEmailNotVerifiedError = (error) => {
  if (error?.response?.status !== 403) return false;
  const detail = error.response?.data?.detail;
  if (detail && typeof detail === 'object' && !Array.isArray(detail) && detail.code === 'email_not_verified') return true;
  return typeof detail === 'string' && detail.startsWith("Confirmez d'abord");
};
