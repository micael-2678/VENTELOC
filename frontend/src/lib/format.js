// Formats d'affichage (français)
// Montant en euros : 450000 -> « 450 000 € »
export const formatEur = (n) => (n == null || n === '' || Number.isNaN(Number(n)) ? '—' : `${Number(n).toLocaleString('fr-FR')} €`);
