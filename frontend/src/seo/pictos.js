// Pictogrammes au trait de la charte AlterEgo (design system « AlterEgo », groupe Pictogrammes) : trait de 1,5 px,
// extrémités arrondies, sans remplissage, grille de 26 unités (viewBox -13 -13 26 26). Ils prennent la couleur du
// texte (currentColor) : brique dans les listes de moyens, encre ailleurs. Pas d'import : aussi chargé par le pré-rendu.
export const PICTO_PATHS = {
  barres: '<path d="M-9 9 V-1 M-3 9 V-8 M3 9 V2 M9 9 V-5"/><path d="M-11 9 H11"/>',
  bulle: '<path d="M-10 -8 H10 V4 H-2 L-7 9 V4 H-10 Z"/>',
  calendrier: '<path d="M-9 -6 H9 V9 H-9 Z"/><path d="M-9 -1 H9 M-5 -10 V-4 M5 -10 V-4"/>',
  canape: '<path d="M-8 1 V-4 C-8 -6, -6.5 -7, -5 -7 H5 C6.5 -7, 8 -6, 8 -4 V1"/><path d="M-11 1 C-11 -1, -8 -1, -8 1 V3 H8 V1 C8 -1, 11 -1, 11 1 V7 H-11 Z"/><path d="M-9 7 V9 M9 7 V9"/>',
  carte: '<path d="M-10 -6 L-3 -9 L3 -6 L10 -9 V6 L3 9 L-3 6 L-10 9 Z"/><path d="M-3 -9 V6 M3 -6 V9"/>',
  check: '<path d="M-8 1 L-2 7 L9 -6"/>',
  cle: '<circle cx="-4" cy="-4" r="5"/><path d="M0 0 L9 9 M6 6 L9 3 M3 3 L6 0"/>',
  courbe: '<path d="M-10 7 L-4 1 L1 4 L10 -7"/><path d="M5 -7 H10 V-2"/>',
  euro: '<path d="M7 -7 C-2 -11, -9 -4, -9 0 C-9 4, -2 11, 7 7"/><path d="M-11 -2 H3 M-11 2 H3"/>',
  immeuble: '<path d="M-7 10 V-9 H7 V10"/><path d="M-10 10 H10"/><path d="M-3 -5 H-1 M1 -5 H3 M-3 -1 H-1 M1 -1 H3 M-3 3 H-1 M1 3 H3"/>',
  loupe: '<circle cx="-2" cy="-2" r="6.5"/><path d="M3 3 L9 9"/>',
  maison: '<path d="M-10 -1 L0 -10 L10 -1"/><path d="M-7 -3 V9 H7 V-3"/><path d="M-2 9 V3 H2 V9"/>',
  personne: '<circle cx="0" cy="-4" r="4"/><path d="M-8 10 C-7 3, 7 3, 8 10"/>',
  plan: '<path d="M-9 -8 H9 V8 H-9 Z"/><path d="M-9 -1 H1 V8 M1 -1 V-8 M4 3 H9"/>',
  signature: '<path d="M-10 8 C-6 2, -2 2, 0 6 C2 10, 5 6, 10 -8"/><path d="M-10 11 H10"/>',
};

export const pictoSvg = (name, size = 28, className = '') => (PICTO_PATHS[name]
  ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-13 -13 26 26" width="${size}" height="${size}"${className ? ` class="${className}"` : ''} aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${PICTO_PATHS[name]}</g></svg>`
  : '');
