// SIRET (14 chiffres) et SIREN (9 chiffres) : saisie tolérante aux espaces, affichage « 123 456 789 00012 ».
// Sert au SIREN facultatif de l'acquéreur qui achète en société (vérifié par le serveur sur l'annuaire des entreprises :
// badge « société vérifiée ») ; le SIRET d'une SCI propriétaire est saisi dans l'annonce.
export const cleanSiret = (value) => String(value == null ? '' : value).replace(/\D/g, '').slice(0, 14);
export const cleanSiren = (value) => String(value == null ? '' : value).replace(/\D/g, '').slice(0, 9);
export const formatSiret = (value) => {
  const d = cleanSiret(value);
  return [d.slice(0, 3), d.slice(3, 6), d.slice(6, 9), d.slice(9)].filter(Boolean).join(' ');
};
export const formatSiren = (value) => {
  const d = cleanSiren(value);
  return [d.slice(0, 3), d.slice(3, 6), d.slice(6)].filter(Boolean).join(' ');
};
export const isSiret = (value) => cleanSiret(value).length === 14;
export const isSiren = (value) => cleanSiren(value).length === 9;
